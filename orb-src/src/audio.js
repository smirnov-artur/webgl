// Audio analysis for the orb.
//
// Two rules drive the design:
//
// 1. Nothing here ever touches React state. The analyser writes into a plain
//    object that useFrame reads and copies into uniforms. A 60 Hz setState
//    would re-render the tree sixty times a second and no amount of shader
//    tuning would save the frame budget after that.
//
// 2. There is always a signal. If the microphone is denied, blocked by an
//    insecure origin, or simply absent, the same band object is filled by a
//    synthetic speech envelope so the demo still behaves like a voice agent.
//
// Bands are integrated over real Hz ranges taken from the analyser's own
// sampleRate, not over raw bin indices — bin 0..10 means something different
// at 44.1 kHz and at 48 kHz.

const BANDS = {
  bass: [30, 160],
  mid: [160, 1200],
  treble: [2200, 9000],
  voice: [220, 1400], // deliberately overlaps mid: this is the speech formant range
};

// Attack is fast so the orb answers a syllable; release is slow so it does not
// flicker between them. Per-band, because bass should sag and treble should not.
const ENV = {
  bass: { attack: 0.55, release: 0.075 },
  mid: { attack: 0.60, release: 0.10 },
  treble: { attack: 0.75, release: 0.16 },
  voice: { attack: 0.65, release: 0.09 },
  level: { attack: 0.50, release: 0.06 },
};

function smooth(prev, next, dt, spec) {
  const rate = next > prev ? spec.attack : spec.release;
  // Frame-rate independent exponential follow. Without the dt term the orb
  // reacts differently at 60 and at 120 Hz.
  const k = 1 - Math.exp(-dt / Math.max(rate * 0.25, 1e-3));
  return prev + (next - prev) * Math.min(k, 1);
}

export class AudioEngine {
  constructor() {
    /** Read by the render loop every frame. Never becomes React state. */
    this.bands = { bass: 0, mid: 0, treble: 0, voice: 0, level: 0, pulse: 0 };
    this.mode = 'demo'; // 'demo' | 'mic' | 'off'
    this.status = 'idle'; // 'idle' | 'requesting' | 'live' | 'denied' | 'unsupported' | 'error'
    this.error = '';
    this.onStatus = null;

    this.ctx = null;
    this.analyser = null;
    this.stream = null;
    this.source = null;
    this.freq = null;
    this.binHz = 0;

    // Gate ramps 0 -> 1 when a source comes up, so switching to the microphone
    // never lands as a jump in the geometry.
    this.gate = 1;
    this.gateTarget = 1;

    this.t = 0;
    this.pulseTimer = 0;
    this.prevVoice = 0;

    // Synthetic speech state: sentences with pauses, syllables inside them.
    this.phraseTimer = 0;
    this.phraseOn = true;
    this.phraseLen = 2.0;
  }

  setStatus(status, error = '') {
    this.status = status;
    this.error = error;
    if (this.onStatus) this.onStatus(status, error);
  }

  async enableMic() {
    if (this.status === 'requesting') return;

    const secure = window.isSecureContext || location.hostname === 'localhost';
    if (!navigator.mediaDevices?.getUserMedia || !secure) {
      this.setStatus(
        'unsupported',
        secure ? 'This browser exposes no microphone API.' : 'Microphone needs HTTPS.',
      );
      this.mode = 'demo';
      return;
    }

    this.setStatus('requesting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          // All three of these fight the visualiser: AGC flattens dynamics,
          // noise suppression eats the quiet tail of a word, echo cancellation
          // ducks whatever the page itself is playing.
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });

      const Ctx = window.AudioContext || window.webkitAudioContext;
      const ctx = new Ctx();
      if (ctx.state === 'suspended') await ctx.resume();

      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.55;
      analyser.minDecibels = -92;
      analyser.maxDecibels = -12;

      const source = ctx.createMediaStreamSource(stream);
      source.connect(analyser); // not connected to the destination: no feedback

      this.ctx = ctx;
      this.analyser = analyser;
      this.stream = stream;
      this.source = source;
      this.freq = new Uint8Array(analyser.frequencyBinCount);
      this.binHz = ctx.sampleRate / analyser.fftSize;

      this.mode = 'mic';
      this.gate = 0;
      this.gateTarget = 1;
      this.setStatus('live');

      stream.getAudioTracks()[0]?.addEventListener('ended', () => this.stopMic('demo'));
    } catch (err) {
      const denied = err?.name === 'NotAllowedError' || err?.name === 'SecurityError';
      const missing = err?.name === 'NotFoundError' || err?.name === 'OverconstrainedError';
      this.mode = 'demo';
      this.gate = 0;
      this.gateTarget = 1;
      this.setStatus(
        denied ? 'denied' : missing ? 'unsupported' : 'error',
        denied
          ? 'Microphone blocked — running the synthetic envelope instead.'
          : missing
            ? 'No input device found — running the synthetic envelope instead.'
            : (err?.message ?? 'Audio failed to start.'),
      );
    }
  }

  stopMic(nextMode = 'demo') {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.source?.disconnect();
    this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.analyser = null;
    this.stream = null;
    this.source = null;
    this.freq = null;
    this.mode = nextMode;
    this.gate = 0;
    this.gateTarget = 1;
    if (this.status === 'live') this.setStatus('idle');
  }

  setMode(mode) {
    if (mode === this.mode) return;
    if (mode === 'mic') {
      this.enableMic();
      return;
    }
    if (this.stream) this.stopMic(mode);
    else {
      this.mode = mode;
      this.gate = 0;
      this.gateTarget = 1;
    }
    if (mode === 'off') this.gateTarget = 0;
  }

  dispose() {
    this.stopMic('off');
  }

  /** Integrate one band over its Hz window, RMS-weighted. */
  readBand(lo, hi) {
    const f = this.freq;
    const a = Math.max(1, Math.floor(lo / this.binHz));
    const b = Math.min(f.length - 1, Math.ceil(hi / this.binHz));
    let sum = 0;
    let n = 0;
    for (let i = a; i <= b; i++) {
      const v = f[i] / 255;
      sum += v * v;
      n++;
    }
    return n ? Math.sqrt(sum / n) : 0;
  }

  /** Synthetic speech envelope — plausible cadence, no audio hardware. */
  synthetic(dt) {
    this.phraseTimer -= dt;
    if (this.phraseTimer <= 0) {
      this.phraseOn = !this.phraseOn;
      this.phraseLen = this.phraseOn ? 1.4 + Math.random() * 2.4 : 0.35 + Math.random() * 0.9;
      this.phraseTimer = this.phraseLen;
    }
    if (!this.phraseOn) return { bass: 0.02, mid: 0.02, treble: 0.02, voice: 0.01 };

    const t = this.t;
    // Syllables at ~4.5 Hz, plus a slower prosody contour and a little jitter.
    const syll = Math.max(0, Math.sin(t * 9.0) * 0.5 + 0.5) ** 1.6;
    const prosody = 0.55 + 0.45 * Math.sin(t * 0.9 + 1.3);
    const jitter = 0.5 + 0.5 * Math.sin(t * 13.7 + Math.sin(t * 5.1) * 2.0);
    const env = syll * prosody;

    return {
      bass: env * (0.30 + 0.25 * Math.sin(t * 1.7)) + 0.03,
      mid: env * (0.42 + 0.18 * jitter) + 0.03,
      treble: env * (0.22 + 0.30 * jitter) * (0.6 + 0.4 * Math.sin(t * 6.3)) + 0.02,
      voice: env * (0.55 + 0.20 * Math.sin(t * 2.9)) + 0.02,
    };
  }

  update(dt) {
    this.t += dt;

    // Clamp dt: a backgrounded tab returns with a multi-second delta and the
    // envelope would snap.
    const d = Math.min(dt, 0.05);

    this.gate += (this.gateTarget - this.gate) * Math.min(1, d * 3.2);

    let raw;
    if (this.mode === 'off') {
      raw = { bass: 0, mid: 0, treble: 0, voice: 0 };
    } else if (this.mode === 'mic' && this.analyser) {
      this.analyser.getByteFrequencyData(this.freq);
      raw = {
        bass: this.readBand(...BANDS.bass),
        mid: this.readBand(...BANDS.mid),
        treble: this.readBand(...BANDS.treble),
        voice: this.readBand(...BANDS.voice),
      };
      // A little headroom: speech rarely fills the analyser range, and the orb
      // should reach full deflection on a normal speaking voice.
      raw.bass = Math.min(1, raw.bass * 1.65);
      raw.mid = Math.min(1, raw.mid * 1.85);
      raw.treble = Math.min(1, raw.treble * 2.40);
      raw.voice = Math.min(1, raw.voice * 2.00);
    } else {
      raw = this.synthetic(d);
    }

    const g = this.gate;
    const b = this.bands;
    b.bass = smooth(b.bass, raw.bass * g, d, ENV.bass);
    b.mid = smooth(b.mid, raw.mid * g, d, ENV.mid);
    b.treble = smooth(b.treble, raw.treble * g, d, ENV.treble);
    b.voice = smooth(b.voice, raw.voice * g, d, ENV.voice);
    b.level = smooth(b.level, (raw.bass + raw.mid + raw.treble) / 3 * g, d, ENV.level);

    // Onset detection on the speech band drives the halo shockwave.
    const rise = b.voice - this.prevVoice;
    this.prevVoice = b.voice;
    if (rise > 0.055 && this.pulseTimer <= 0 && b.voice > 0.22) this.pulseTimer = 1;
    this.pulseTimer = Math.max(0, this.pulseTimer - d * 1.35);
    b.pulse = 1 - this.pulseTimer;
  }
}

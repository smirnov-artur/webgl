// Band analysis for the scene. Three sources, one output shape.
//
//   music  — the generated loop, analysed off its own master bus
//   mic    — getUserMedia
//   idle   — a synthetic envelope, so the scene still breathes before anyone
//            presses anything (browsers will not let audio start without a
//            gesture, and a demo that looks dead until you click is a demo
//            most people close)
//
// Nothing in here touches React state. The render loop reads `bands` and
// copies it into uniforms.

import { LofiMusic } from './music.js';

const BANDS = {
  bass: [30, 160],
  mid: [160, 1200],
  treble: [2200, 9000],
  voice: [220, 1400],
};

const ENV = {
  bass: { attack: 0.50, release: 0.22 },
  mid: { attack: 0.55, release: 0.16 },
  treble: { attack: 0.60, release: 0.13 },
  voice: { attack: 0.60, release: 0.14 },
  level: { attack: 0.55, release: 0.30 },
};

function smooth(prev, next, dt, spec) {
  const rate = next > prev ? spec.attack : spec.release;
  const k = 1 - Math.exp(-dt / Math.max(rate * 0.25, 1e-3));
  return prev + (next - prev) * Math.min(k, 1);
}

export class AudioEngine {
  constructor() {
    this.bands = { bass: 0, mid: 0, treble: 0, voice: 0, level: 0, beat: 0 };
    this.mode = 'idle'; // 'idle' | 'music' | 'mic' | 'off'
    this.status = 'idle';
    this.error = '';
    this.onStatus = null;

    this.music = new LofiMusic();
    this.analyser = null;
    this.freq = null;
    this.binHz = 0;

    this.micCtx = null;
    this.micStream = null;
    this.micSource = null;

    this.gate = 1;
    this.gateTarget = 1;
    this.t = 0;
    this.prevBass = 0;
    this.beatTimer = 0;
  }

  setStatus(status, error = '') {
    this.status = status;
    this.error = error;
    this.onStatus?.(status, error);
  }

  async playMusic() {
    try {
      await this.music.start();
      this.analyser = this.music.analyser;
      this.freq = new Uint8Array(this.analyser.frequencyBinCount);
      this.binHz = this.music.ctx.sampleRate / this.analyser.fftSize;
      this.stopMic();
      this.mode = 'music';
      this.gate = 0;
      this.gateTarget = 1;
      this.setStatus('music');
    } catch (err) {
      this.mode = 'idle';
      this.setStatus('error', err?.message ?? 'Audio failed to start.');
    }
  }

  async enableMic() {
    const secure = window.isSecureContext || location.hostname === 'localhost';
    if (!navigator.mediaDevices?.getUserMedia || !secure) {
      this.mode = 'idle';
      this.setStatus(
        'unsupported',
        secure ? 'This browser exposes no microphone API.' : 'Microphone needs HTTPS.',
      );
      return;
    }

    this.setStatus('requesting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });

      this.music.stop();

      const Ctx = window.AudioContext || window.webkitAudioContext;
      const ctx = new Ctx();
      if (ctx.state === 'suspended') await ctx.resume();

      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.55;
      analyser.minDecibels = -92;
      analyser.maxDecibels = -12;

      const source = ctx.createMediaStreamSource(stream);
      source.connect(analyser); // never to the destination: no feedback

      this.micCtx = ctx;
      this.micStream = stream;
      this.micSource = source;
      this.analyser = analyser;
      this.freq = new Uint8Array(analyser.frequencyBinCount);
      this.binHz = ctx.sampleRate / analyser.fftSize;

      this.mode = 'mic';
      this.gate = 0;
      this.gateTarget = 1;
      this.setStatus('live');

      stream.getAudioTracks()[0]?.addEventListener('ended', () => this.setMode('idle'));
    } catch (err) {
      const denied = err?.name === 'NotAllowedError' || err?.name === 'SecurityError';
      const missing = err?.name === 'NotFoundError' || err?.name === 'OverconstrainedError';
      this.mode = 'idle';
      this.gate = 0;
      this.gateTarget = 1;
      this.setStatus(
        denied ? 'denied' : missing ? 'unsupported' : 'error',
        denied
          ? 'Microphone blocked — the scene keeps drifting on its own.'
          : missing
            ? 'No input device found — the scene keeps drifting on its own.'
            : (err?.message ?? 'Audio failed to start.'),
      );
    }
  }

  stopMic() {
    this.micStream?.getTracks().forEach((t) => t.stop());
    this.micSource?.disconnect();
    this.micCtx?.close().catch(() => {});
    this.micCtx = null;
    this.micStream = null;
    this.micSource = null;
  }

  setMode(mode) {
    if (mode === this.mode) return;
    if (mode === 'music') return void this.playMusic();
    if (mode === 'mic') return void this.enableMic();

    this.music.stop();
    this.stopMic();
    this.analyser = null;
    this.mode = mode;
    this.gate = mode === 'off' ? this.gate : 0;
    this.gateTarget = mode === 'off' ? 0 : 1;
    this.setStatus(mode === 'off' ? 'silent' : 'idle');
  }

  dispose() {
    this.stopMic();
    this.music.dispose();
  }

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

  /** Slow drift for when nothing is playing — no beat, just breathing. */
  idle(dt) {
    const t = this.t;
    const slow = 0.5 + 0.5 * Math.sin(t * 0.21);
    const slower = 0.5 + 0.5 * Math.sin(t * 0.13 + 1.7);
    return {
      bass: 0.10 + slow * 0.14,
      mid: 0.08 + slower * 0.12,
      treble: 0.05 + (0.5 + 0.5 * Math.sin(t * 0.37)) * 0.09,
      voice: 0.07 + slow * 0.10,
    };
  }

  update(dt) {
    this.t += dt;
    const d = Math.min(dt, 0.05);

    this.gate += (this.gateTarget - this.gate) * Math.min(1, d * 3.0);

    let raw;
    if (this.mode === 'off') {
      raw = { bass: 0, mid: 0, treble: 0, voice: 0 };
    } else if (this.analyser && (this.mode === 'music' || this.mode === 'mic')) {
      this.analyser.getByteFrequencyData(this.freq);
      const boost = this.mode === 'mic' ? 1.0 : 0.85;
      raw = {
        bass: Math.min(1, this.readBand(...BANDS.bass) * 1.70 * boost),
        mid: Math.min(1, this.readBand(...BANDS.mid) * 1.85 * boost),
        treble: Math.min(1, this.readBand(...BANDS.treble) * 2.40 * boost),
        voice: Math.min(1, this.readBand(...BANDS.voice) * 2.00 * boost),
      };
    } else {
      raw = this.idle(d);
    }

    const g = this.gate;
    const b = this.bands;
    b.bass = smooth(b.bass, raw.bass * g, d, ENV.bass);
    b.mid = smooth(b.mid, raw.mid * g, d, ENV.mid);
    b.treble = smooth(b.treble, raw.treble * g, d, ENV.treble);
    b.voice = smooth(b.voice, raw.voice * g, d, ENV.voice);
    b.level = smooth(b.level, ((raw.bass + raw.mid + raw.treble) / 3) * g, d, ENV.level);

    // Kick detection on the low band, used for the one-frame push on the
    // camera. Threshold rather than onset strength — a boom-bap kick is loud
    // and unambiguous, and anything cleverer just fires on the bass line too.
    const rise = b.bass - this.prevBass;
    this.prevBass = b.bass;
    if (rise > 0.05 && b.bass > 0.30 && this.beatTimer <= 0) this.beatTimer = 1;
    this.beatTimer = Math.max(0, this.beatTimer - d * 3.6);
    b.beat = this.beatTimer;
  }
}

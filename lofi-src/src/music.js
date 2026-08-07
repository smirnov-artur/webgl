// A lo-fi loop, generated in the browser.
//
// There is no audio file anywhere in this demo — the whole thing is
// oscillators, filtered noise and a lookahead scheduler. That is partly a
// rights question (nothing here belongs to anyone else) and partly the point:
// the visuals are driven by an analyser, and an analyser needs something real
// to analyse.
//
// Signal chain:
//   voices -> bus -> tape wobble -> lowpass -> soft clip -> master -> analyser
//
// The scheduler is the standard lookahead pattern: a timer wakes up every
// 25 ms and schedules anything falling due in the next 120 ms against
// ctx.currentTime. setTimeout alone is nowhere near accurate enough for
// rhythm; the Web Audio clock is.

const BPM = 74;
const SPB = 60 / BPM; // seconds per beat
const SIXTEENTH = SPB / 4;
const SWING = 0.17; // how far the off-eighths are pushed late

// Fmaj7 – Am7 – Dm7 – Gm7. I–iii–vi–ii in F, close voiced around the middle of
// the piano: the loop half the genre is built on.
const CHORDS = [
  [174.61, 220.0, 261.63, 329.63], // F3 A3 C4 E4
  [220.0, 261.63, 329.63, 392.0], // A3 C4 E4 G4
  [146.83, 174.61, 220.0, 261.63], // D3 F3 A3 C4
  [196.0, 233.08, 293.66, 349.23], // G3 Bb3 D4 F4
];

// Root of each bar, two octaves down, for the bass.
const ROOTS = [87.31, 110.0, 73.42, 98.0];

// Pentatonic-ish set for the little melody, two octaves up.
const MELODY = [349.23, 392.0, 440.0, 523.25, 587.33, 698.46];

export class LofiMusic {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.analyser = null;
    this.playing = false;
    this.timer = null;
    this.step = 0; // sixteenth counter
    this.nextTime = 0;
  }

  /** Builds the graph. Must be called from a user gesture. */
  async start() {
    if (this.playing) return;

    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) throw new Error('Web Audio is not available in this browser.');
      const ctx = new Ctx();
      this.ctx = ctx;

      const master = ctx.createGain();
      master.gain.value = 0.0;

      // Soft clip: the "tape" part of tape. A gentle curve, not distortion.
      const shaper = ctx.createWaveShaper();
      const n = 1024;
      const curve = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const x = (i / (n - 1)) * 2 - 1;
        curve[i] = Math.tanh(x * 1.6) * 0.86;
      }
      shaper.curve = curve;
      shaper.oversample = '2x';

      // The whole point of lo-fi: nothing above ~5 kHz survives.
      const tone = ctx.createBiquadFilter();
      tone.type = 'lowpass';
      tone.frequency.value = 4800;
      tone.Q.value = 0.6;

      // Tape wobble — a few cents of drift, slowly.
      const wobble = ctx.createDelay(0.05);
      wobble.delayTime.value = 0.006;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.27;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 0.0022;
      lfo.connect(lfoGain).connect(wobble.delayTime);
      lfo.start();

      const bus = ctx.createGain();
      bus.gain.value = 0.9;

      bus.connect(wobble).connect(tone).connect(shaper).connect(master);
      master.connect(ctx.destination);

      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.5;
      analyser.minDecibels = -88;
      analyser.maxDecibels = -14;
      master.connect(analyser);

      this.master = master;
      this.bus = bus;
      this.analyser = analyser;

      this.startVinyl();
    }

    if (this.ctx.state === 'suspended') await this.ctx.resume();

    this.playing = true;
    this.step = 0;
    this.nextTime = this.ctx.currentTime + 0.08;
    // Fade in, so pressing play is not a click.
    this.master.gain.cancelScheduledValues(this.ctx.currentTime);
    this.master.gain.setValueAtTime(this.master.gain.value, this.ctx.currentTime);
    this.master.gain.linearRampToValueAtTime(0.85, this.ctx.currentTime + 0.9);

    this.timer = setInterval(() => this.schedule(), 25);
  }

  stop() {
    if (!this.playing) return;
    this.playing = false;
    clearInterval(this.timer);
    this.timer = null;
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setValueAtTime(this.master.gain.value, t);
    this.master.gain.linearRampToValueAtTime(0.0001, t + 0.5);
  }

  dispose() {
    this.stop();
    this.vinylSource?.stop();
    this.ctx?.close().catch(() => {});
    this.ctx = null;
  }

  /** Continuous crackle and hiss under everything. */
  startVinyl() {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * 4);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      // Hiss floor plus occasional pops, the way a worn record actually reads.
      let v = (Math.random() * 2 - 1) * 0.05;
      if (Math.random() < 0.00035) v += (Math.random() * 2 - 1) * 0.85;
      d[i] = v;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;

    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1400;
    const g = ctx.createGain();
    g.gain.value = 0.09;

    src.connect(hp).connect(g).connect(this.bus);
    src.start();
    this.vinylSource = src;
  }

  schedule() {
    const ctx = this.ctx;
    while (this.nextTime < ctx.currentTime + 0.12) {
      // Swing is an offset applied to the off-eighths, not a change to the
      // step length. Stretching the grid itself accumulates drift over a few
      // hundred bars; offsetting does not.
      const swing = this.step % 4 === 2 ? SIXTEENTH * SWING : 0;
      this.playStep(this.step, this.nextTime + swing);
      this.nextTime += SIXTEENTH;
      this.step = (this.step + 1) % 64; // four bars of sixteenths
    }
  }

  playStep(step, t) {
    const bar = Math.floor(step / 16);
    const inBar = step % 16;

    if (inBar === 0) this.chord(CHORDS[bar], t, SPB * 3.4);
    if (inBar === 0 || inBar === 10) this.bass(ROOTS[bar], t, SPB * 1.1);

    // Kick on 1 and the "and" of 3; snare on 2 and 4 — the boom-bap skeleton.
    if (inBar === 0 || inBar === 10) this.kick(t);
    if (inBar === 4 || inBar === 12) this.snare(t);
    if (inBar === 7 && bar % 2 === 1) this.kick(t, 0.6);

    // Hats on eighths, with a dropped one here and there.
    if (inBar % 2 === 0 && Math.random() > 0.12) {
      this.hat(t, inBar % 4 === 0 ? 0.22 : 0.13);
    }

    // A sparse melody note, only in the back half of each bar.
    if (inBar === 6 || inBar === 14) {
      if (Math.random() < 0.55) {
        const note = MELODY[Math.floor(Math.random() * MELODY.length)];
        this.pluck(note, t, SPB * 0.9);
      }
    }
  }

  env(node, t, attack, decay, peak) {
    const g = node.gain;
    g.setValueAtTime(0.0001, t);
    g.linearRampToValueAtTime(peak, t + attack);
    g.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  chord(freqs, t, dur) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.connect(this.bus);

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(700, t);
    lp.frequency.linearRampToValueAtTime(1500, t + 0.6);
    lp.frequency.linearRampToValueAtTime(650, t + dur);
    lp.Q.value = 1.1;
    lp.connect(g);

    freqs.forEach((f, i) => {
      // Two oscillators per note, detuned — the slow beating between them is
      // most of what makes a pad sound like a pad.
      for (let d = 0; d < 2; d++) {
        const o = ctx.createOscillator();
        o.type = d === 0 ? 'triangle' : 'sine';
        o.frequency.value = f * (d === 0 ? 1 : 2.002);
        o.detune.value = (d === 0 ? -6 : 7) + (i - 1.5) * 2;
        const og = ctx.createGain();
        og.gain.value = (d === 0 ? 0.10 : 0.045) / (1 + i * 0.25);
        o.connect(og).connect(lp);
        o.start(t);
        o.stop(t + dur + 0.2);
      }
    });

    this.env(g, t, 0.22, dur, 0.55);
  }

  bass(freq, t, dur) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = freq;
    const sub = ctx.createOscillator();
    sub.type = 'triangle';
    sub.frequency.value = freq;
    sub.detune.value = -4;

    const g = ctx.createGain();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 340;

    o.connect(g);
    sub.connect(g);
    g.connect(lp).connect(this.bus);

    this.env(g, t, 0.02, dur, 0.42);
    o.start(t);
    sub.start(t);
    o.stop(t + dur + 0.1);
    sub.stop(t + dur + 0.1);
  }

  kick(t, level = 1) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.09);

    const g = ctx.createGain();
    o.connect(g).connect(this.bus);
    this.env(g, t, 0.004, 0.32, 0.85 * level);

    o.start(t);
    o.stop(t + 0.4);
  }

  snare(t) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * 0.2);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buf;

    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1750;
    bp.Q.value = 0.8;

    const g = ctx.createGain();
    src.connect(bp).connect(g).connect(this.bus);
    this.env(g, t, 0.003, 0.17, 0.30);
    src.start(t);

    // A little body under the noise so it is not just a hiss.
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(210, t);
    o.frequency.exponentialRampToValueAtTime(150, t + 0.08);
    const og = ctx.createGain();
    o.connect(og).connect(this.bus);
    this.env(og, t, 0.003, 0.10, 0.16);
    o.start(t);
    o.stop(t + 0.2);
  }

  hat(t, level) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * 0.06);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.4);
    const src = ctx.createBufferSource();
    src.buffer = buf;

    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 6500;

    const g = ctx.createGain();
    src.connect(hp).connect(g).connect(this.bus);
    this.env(g, t, 0.002, 0.055, level * (0.7 + Math.random() * 0.5));
    src.start(t);
  }

  pluck(freq, t, dur) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = freq;
    o.detune.value = (Math.random() - 0.5) * 12;

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(2600, t);
    lp.frequency.exponentialRampToValueAtTime(700, t + dur);

    const g = ctx.createGain();
    o.connect(lp).connect(g).connect(this.bus);
    this.env(g, t, 0.012, dur, 0.13);

    o.start(t);
    o.stop(t + dur + 0.1);
  }
}

// Quality tiers and the runtime governor.
//
// The scene is fill-rate bound, not vertex bound — six layered quads plus a
// composite, all of them near-fullscreen. So every knob here is about pixels:
// device pixel ratio, the resolution of the offscreen target, and how much
// work each fragment does.

export const TIERS = {
  high: {
    name: 'high',
    dprCap: 2,
    rtScale: 1.0,
    rain: true,
    chroma: true,
    fbmOctaves: 4,
    dust: 620,
  },
  medium: {
    name: 'medium',
    dprCap: 1.6,
    rtScale: 0.85,
    rain: true,
    chroma: true,
    fbmOctaves: 3,
    dust: 320,
  },
  low: {
    name: 'low',
    dprCap: 1.25,
    rtScale: 0.68,
    rain: false,
    chroma: false,
    fbmOctaves: 2,
    dust: 0,
  },
};

export const TIER_ORDER = ['low', 'medium', 'high'];

export function isMobile() {
  if (typeof navigator === 'undefined') return false;
  if (navigator.userAgentData?.mobile) return true;
  const coarse = window.matchMedia?.('(pointer: coarse)').matches;
  return Boolean(coarse && navigator.maxTouchPoints > 0);
}

export function pickInitialTier() {
  const mobile = isMobile();
  const cores = navigator.hardwareConcurrency ?? 4;
  const mem = navigator.deviceMemory ?? (mobile ? 4 : 8);
  const dpr = window.devicePixelRatio ?? 1;

  if (!mobile) return cores >= 6 ? 'high' : 'medium';
  // A 3x screen is doing nine times the fill of a 1x one, so a high DPR counts
  // against the tier rather than for it.
  if (cores >= 6 && mem >= 4 && dpr <= 3) return 'medium';
  return 'low';
}

/**
 * Rolling frame-time watchdog. Feed it a delta each frame; returns a tier name
 * when it wants a change, otherwise null.
 */
export class PerfGovernor {
  constructor(startTier, { target = 58, floor = 50 } = {}) {
    this.tier = startTier;
    this.target = target;
    this.floor = floor;
    this.samples = [];
    this.fps = 60;
    this.cooldown = 2.5;
    this.upgrades = 1;
    this.badWindows = 0;
    this.goodWindows = 0;
  }

  sample(dt) {
    if (dt > 0 && dt < 1) this.samples.push(dt);
    if (this.cooldown > 0) {
      this.cooldown -= dt;
      if (this.samples.length > 90) this.samples.length = 0;
      return null;
    }
    if (this.samples.length < 60) return null;

    // Median, not mean: one 300 ms hitch from a shader compile or a GC should
    // not demote the whole scene.
    const sorted = this.samples.slice().sort((a, b) => a - b);
    const median = sorted[sorted.length >> 1];
    this.fps = 1 / median;
    this.samples.length = 0;

    const idx = TIER_ORDER.indexOf(this.tier);

    if (this.fps < this.floor) {
      this.badWindows++;
      this.goodWindows = 0;
      if (this.badWindows >= 2 && idx > 0) {
        this.badWindows = 0;
        this.cooldown = 3;
        this.upgrades = 0; // never climb back after a demotion
        this.tier = TIER_ORDER[idx - 1];
        return this.tier;
      }
    } else if (this.fps > this.target + 4) {
      this.goodWindows++;
      this.badWindows = 0;
      if (this.goodWindows >= 4 && this.upgrades > 0 && idx < TIER_ORDER.length - 1) {
        this.goodWindows = 0;
        this.upgrades--;
        this.cooldown = 3;
        this.tier = TIER_ORDER[idx + 1];
        return this.tier;
      }
    } else {
      this.badWindows = 0;
      this.goodWindows = 0;
    }
    return null;
  }
}

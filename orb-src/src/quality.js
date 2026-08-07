// Quality tiers and the runtime governor that moves between them.
//
// The brief says 60fps on mobile, so the demo does not guess once at startup
// and hope. It picks a starting tier from device hints, then watches the real
// frame time and steps down if it cannot hold the target. Stepping back up is
// allowed once, and only from a comfortable margin, so it cannot oscillate.

export const TIERS = {
  high: {
    name: 'high',
    detail: 6, // icosahedron subdivision -> 81 920 tris
    dprCap: 2,
    rtScale: 0.5, // backface target, fraction of the drawing buffer
    dispersion: true,
    hqVeins: true,
    fbmOctaves: 3,
    dust: 520,
    antialias: true,
  },
  medium: {
    name: 'medium',
    detail: 6, // 81 920 tris — the silhouette is the giveaway, and at detail 5
    // a 500 px orb shows ~9 px flats along the outline
    dprCap: 1.75,
    rtScale: 0.5,
    dispersion: true,
    hqVeins: false,
    fbmOctaves: 3,
    dust: 300,
    antialias: true,
  },
  low: {
    // Still detail 5. Dropping to 4 saves almost nothing here — the cost is in
    // the fragment stage — and it puts visible facets on the silhouette, which
    // is the one artefact that makes the whole thing look cheap.
    name: 'low',
    detail: 5,
    dprCap: 1.25,
    rtScale: 0.4,
    dispersion: false,
    hqVeins: false,
    fbmOctaves: 2,
    dust: 0,
    antialias: false,
  },
};

export const TIER_ORDER = ['low', 'medium', 'high'];

export function isMobile() {
  if (typeof navigator === 'undefined') return false;
  if (navigator.userAgentData?.mobile) return true;
  const coarse = window.matchMedia?.('(pointer: coarse)').matches;
  const touch = navigator.maxTouchPoints > 0;
  return Boolean(coarse && touch);
}

export function pickInitialTier() {
  const mobile = isMobile();
  const cores = navigator.hardwareConcurrency ?? 4;
  const mem = navigator.deviceMemory ?? (mobile ? 4 : 8);
  const dpr = window.devicePixelRatio ?? 1;

  if (!mobile) return cores >= 6 ? 'high' : 'medium';

  // A phone with a 3x screen is doing nine times the fill of a 1x one, so a
  // high DPR counts against the tier rather than for it.
  if (cores >= 6 && mem >= 4 && dpr <= 3) return 'medium';
  return 'low';
}

/**
 * Rolling frame-time watchdog. Feed it a delta each frame; it returns a tier
 * name when it wants a change, otherwise null.
 */
export class PerfGovernor {
  constructor(startTier, { target = 58, floor = 50 } = {}) {
    this.tier = startTier;
    this.target = target;
    this.floor = floor;
    this.samples = [];
    this.fps = 60;
    this.cooldown = 2.5; // seconds of grace after a change or after startup
    this.upgrades = 1; // how many times we are still allowed to move up
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

    // Median, not mean: one 300 ms hitch from a GC or a shader compile should
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

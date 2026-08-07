// Additive halo. This is the stand-in for a bloom pass: a single quad drawn
// after the orb with depth testing off, shaped so the energy sits on the
// silhouette. One extra full-screen-ish quad instead of an EffectComposer with
// two downsample chains — on a mid-range phone that difference is the whole
// frame budget.

uniform float uTime;
uniform float uBass;
uniform float uMid;
uniform float uTreble;
uniform float uVoice;
uniform float uLevel;
uniform float uEnter;
uniform float uOrbRadius;
uniform float uPlaneHalf;
uniform vec3  uGlowColor;
uniform vec3  uAccentColor;
uniform float uPulse;

varying vec2 vUv;

void main() {
  vec2 p = (vUv - 0.5) * 2.0;
  float r = length(p) * uPlaneHalf;          // radius in world units
  float a = atan(p.y, p.x);

  // Angular break-up so the ring is not a perfect circle. Cheap: two sines,
  // no noise texture.
  float wob = sin(a * 3.0 + uTime * 0.35) * 0.012
            + sin(a * 7.0 - uTime * 0.52) * 0.006 * (0.4 + uTreble * 3.0);

  float edge = uOrbRadius + wob;

  // Rim glow riding the silhouette. This quad only knows the orb's nominal
  // radius, not its displaced outline, so the ring is kept soft and wide — a
  // crisp ring would visibly cut chords across the lumps.
  float w = 0.105 + uVoice * 0.10 + uBass * 0.06;
  float ring = exp(-pow((r - edge) / w, 2.0));

  // Broad ambient bloom.
  float wide = exp(-pow(r / (uOrbRadius * 1.8), 2.0));

  // Expanding shockwave fired on speech onsets. Short travel and a squared
  // fade: a ring that crosses the whole viewport stops looking like a pulse
  // and starts looking like a bug.
  float shockR = edge + uPulse * 0.55;
  float fade = (1.0 - uPulse) * (1.0 - uPulse);
  float shock = exp(-pow((r - shockR) / 0.075, 2.0)) * fade;

  float outside = smoothstep(edge - 0.10, edge + 0.02, r);

  vec3 c = uGlowColor * ring * (0.045 + uVoice * 0.44 + uLevel * 0.13)
         + uGlowColor * wide * (0.020 + uBass * 0.20) * 0.5
         + uAccentColor * shock * (0.10 + uMid * 0.35);

  // Keep the broad term from washing the middle of the orb; the rim and the
  // shock are allowed to spill over it, which is what bloom actually does.
  c *= mix(0.35, 1.0, outside);

  gl_FragColor = vec4(c * uEnter, 1.0);

  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}

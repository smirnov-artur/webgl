// Layer 1 of 5 — sky, sun, clouds, stars and the far hills. Opaque; everything
// else is composited over it.

precision highp float;

uniform float uTime;
uniform float uAspect;
uniform float uDay;
uniform float uBass;
uniform float uMid;
uniform float uTreble;
uniform float uLevel;
uniform float uEnter;

varying vec3 vWorld;
varying vec4 vProj;

#include <lofi_common>
#include <lofi_scene>

void main() {
  vec2 uv = vProj.xy / vProj.w * 0.5 + 0.5;
  vec2 q = compose(uv, uAspect);

  vec3 zen = skyZenith(uDay);
  vec3 hor = skyHorizon(uDay);
  vec2 sun = keyPos(uDay);

  // Gradient. The exponent keeps the warm band tight near the horizon instead
  // of letting it bleed halfway up the frame.
  float h = clamp((q.y - HORIZON) / 0.62, 0.0, 1.0);
  vec3 col = mix(hor, zen, pow(h, 0.75));

  // Warm bloom around the sun, spread along the horizon.
  float sd = length((q - sun) * vec2(0.55, 1.0));
  col += keyColor(uDay) * exp(-sd * 4.2) * 0.42 * keyIntensity(uDay);
  col += keyColor(uDay) * exp(-abs(q.y - sun.y) * 8.0) * 0.07 * keyIntensity(uDay);

  // The disc itself, softened as it approaches the skyline.
  float disc = smoothstep(0.030, 0.020, length(q - sun));
  col = mix(col, keyColor(uDay) * 1.9, disc * (1.0 - smoothstep(0.5, 0.95, uDay)) * 0.85);

  // Stars, on a jittered grid so they do not read as a lattice.
  float night = smoothstep(0.55, 0.95, uDay);
  if (night > 0.001) {
    vec2 g = q * 34.0;
    vec2 cell = floor(g);
    vec2 off = hash22(cell) - 0.5;
    float d = length(fract(g) - 0.5 - off * 0.7);
    float mag = hash21(cell + 7.1);
    float tw = 0.65 + 0.35 * sin(uTime * (1.2 + mag * 2.4) + mag * 30.0);
    float star = smoothstep(0.085, 0.0, d) * step(0.965, mag) * tw;
    col += vec3(0.85, 0.90, 1.0) * star * night * (0.9 + uTreble * 1.4);
  }

  // Clouds: two fBm layers drifting at different speeds, shaded by how much of
  // the sun is behind them. Cheap stand-in for scattering and it reads.
  vec2 cp = vec2(q.x * 1.5 + uTime * 0.0075, (q.y - HORIZON) * 3.4);
  float c1 = fbm(cp * 2.1);
  float c2 = fbm(cp * 4.7 + vec2(uTime * 0.014, 0.0));
  float cloud = smoothstep(0.55, 0.86, c1 * 0.72 + c2 * 0.34);
  cloud *= smoothstep(-0.02, 0.22, q.y - HORIZON);
  // Denser and lower near the horizon, thinning out overhead.
  cloud *= 1.0 - smoothstep(0.35, 0.75, q.y - HORIZON) * 0.55;

  float toSun = 1.0 - clamp(length(q - sun) * 1.5, 0.0, 1.0);
  vec3 cloudLit = mix(mix(zen, hor, 0.5) * 0.95, keyColor(uDay) * 1.05, toSun * 0.75);
  vec3 cloudDark = mix(zen * 0.55, hor * 0.35, 0.4);
  vec3 cloudCol = mix(cloudDark, cloudLit, smoothstep(0.35, 0.85, c1));
  col = mix(col, cloudCol, cloud * mix(0.62, 0.35, night));

  // Far hills: one ridge, heavily hazed, just enough to stop the sky from
  // meeting the city on a hard line.
  float ridge = HORIZON + 0.030 + profile(q.x, 2.3, 11.0) * 0.055
                                + profile(q.x, 6.1, 3.0) * 0.018;
  float hills = smoothstep(0.004, -0.004, q.y - ridge);
  vec3 hillCol = applyHaze(mix(vec3(0.10, 0.11, 0.16), keyColor(uDay) * 0.30, toSun * 0.5),
                           0.80, uDay, q.y);
  col = mix(col, hillCol, hills);

  col *= uEnter;
  gl_FragColor = vec4(col, 1.0);
}

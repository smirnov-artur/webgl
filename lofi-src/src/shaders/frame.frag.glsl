// Layer 5 — the room. Window frame, sill, a mug, a plant and a curtain, all in
// near-silhouette and lit from behind the camera by the desk lamp. This is the
// closest layer, so under parallax it swings hardest and reads as the edge of
// the room you are sitting in.
//
// Everything on the sill is positioned as a fraction of the window's own
// half-width rather than in absolute coordinates, so the arrangement survives
// a phone in portrait, where the opening is a third of the width it has on a
// desktop.

precision highp float;

uniform float uTime;
uniform float uAspect;
uniform float uDay;
uniform float uEnter;
uniform float uBass;
uniform float uMid;
uniform float uTreble;
uniform float uLevel;

varying vec3 vWorld;
varying vec4 vProj;

#include <lofi_common>
#include <lofi_scene>

float leaf(vec2 p, vec2 at, float ang, float len, float wid) {
  vec2 lp = rot2(p - at, ang);
  // Taper toward the tip.
  lp.y /= 1.0 - clamp(lp.x / max(len, 1e-3), 0.0, 0.95) * 0.5;
  return sdSegment(lp, vec2(0.0, 0.0), vec2(len, 0.0)) - wid;
}

void main() {
  vec2 uv = vProj.xy / vProj.w * 0.5 + 0.5;
  vec2 q = compose(uv, uAspect);

  vec2 wh = winHalf(uAspect);
  float win = windowMask(q, uAspect);   // < 0 inside the glass

  float mask = 0.0;
  float edge = 0.0;      // catches light from outside
  float emissive = 0.0;

  // --- frame -------------------------------------------------------------
  float wall = smoothstep(-0.0018, 0.0018, win);
  mask = max(mask, wall);
  edge = max(edge, smoothstep(0.020, 0.0, abs(win)) * wall);

  // Mullion and transom, only where they cross the glass.
  float inside = 1.0 - wall;
  float mull = smoothstep(0.0080, 0.0058, abs(q.x - WIN_CENTER.x)) * inside;
  float tran = smoothstep(0.0070, 0.0048, abs(q.y - (WIN_CENTER.y + wh.y * 0.34))) * inside;
  float bars = max(mull, tran);
  mask = max(mask, bars);
  edge = max(edge, mull * smoothstep(0.0040, 0.0076, abs(q.x - WIN_CENTER.x)));
  edge = max(edge, tran * smoothstep(0.0032, 0.0068, abs(q.y - (WIN_CENTER.y + wh.y * 0.34))));

  // --- sill --------------------------------------------------------------
  float sillY = WIN_CENTER.y - wh.y;
  float sill = smoothstep(0.004, -0.004, q.y - (sillY + 0.022));
  mask = max(mask, sill);
  edge = max(edge, smoothstep(0.010, 0.0, abs(q.y - (sillY + 0.022))) * sill);

  // --- curtain -----------------------------------------------------------
  // Hangs on the left and overlaps the glass, which is what gives the layer
  // something for the city behind it to slide across.
  float cx = -wh.x * 0.74 + profile(q.y * 0.9 + 3.0, 1.0, 0.0) * 0.022
                          + sin(q.y * 6.0 + uTime * 0.16) * 0.005;
  float curtain = smoothstep(0.004, -0.004, q.x - cx)
                * smoothstep(0.0, 0.05, WIN_CENTER.y + wh.y - q.y)
                * step(sillY + 0.010, q.y);
  float foldShade = 0.5 + 0.5 * sin(q.x * 52.0 + profile(q.y, 1.9, 2.0) * 6.0);
  mask = max(mask, curtain);
  edge = max(edge, curtain * (0.10 + 0.30 * foldShade) * smoothstep(0.09, 0.0, cx - q.x));

  // --- mug ---------------------------------------------------------------
  float scale = clamp(wh.x / 0.615, 0.55, 1.0);   // shrink the props on a narrow window
  vec2 mugAt = vec2(wh.x * 0.46, sillY + 0.048 * scale);
  vec2 mp = (q - mugAt) / scale;
  float bodyD = sdBox(mp, vec2(0.028, 0.028)) - 0.008;
  float handleD = abs(length(mp - vec2(0.044, 0.002)) - 0.020) - 0.0055;
  handleD = max(handleD, -(mp.x - 0.030));
  float mugD = min(bodyD, handleD);
  float mug = smoothstep(0.003, -0.003, mugD);
  mask = max(mask, mug);
  edge = max(edge, smoothstep(0.011, 0.0, abs(mugD)) * mug);

  // Steam, drifting and thinning as it rises.
  float steam = 0.0;
  {
    vec2 sp = (q - (mugAt + vec2(0.0, 0.032 * scale))) / scale;
    float rise = clamp(sp.y / 0.15, 0.0, 1.0);
    sp.x -= sin(uTime * 0.5 + rise * 4.2) * 0.016 * rise + rise * rise * 0.022;
    float w = 0.007 + rise * 0.030;
    float shape = smoothstep(w, 0.0, abs(sp.x)) * step(0.0, sp.y) * (1.0 - rise);
    steam = clamp(shape * (0.25 + fbm(vec2(sp.x * 20.0, sp.y * 13.0 - uTime * 0.45)) * 0.85), 0.0, 1.0) * 0.26;
  }

  // --- plant -------------------------------------------------------------
  vec2 potAt = vec2(-wh.x * 0.40, sillY + 0.030 * scale);
  vec2 pp = (q - potAt) / scale;
  float potD = sdBox(pp - vec2(0.0, -0.004), vec2(0.028 - pp.y * 0.26, 0.024)) - 0.004;
  float leaves = 1e9;
  // Five broad leaves rather than eight thin ones — at this size a narrow leaf
  // is a spike, and five spikes read as a hand.
  for (int i = 0; i < 5; i++) {
    float fi = float(i);
    float a = 0.60 + fi * 0.48 + sin(uTime * 0.32 + fi) * 0.045;
    float len = 0.040 + hash11(fi * 4.3) * 0.026;
    vec2 at = vec2((hash11(fi * 2.1) - 0.5) * 0.014, 0.024);
    leaves = min(leaves, leaf(pp, at, a, len, 0.019 + hash11(fi * 7.7) * 0.008));
  }
  float plantD = min(potD, leaves);
  float plant = smoothstep(0.003, -0.003, plantD);
  mask = max(mask, plant);
  edge = max(edge, smoothstep(0.010, 0.0, abs(plantD)) * plant);

  if (mask < 0.004 && steam < 0.004) discard;

  // --- shading -----------------------------------------------------------
  // The desk lamp sits low and to the right, behind the camera.
  vec2 lampQ = vec2(spanX(uAspect) * 0.85, -0.40);
  float lampD = length((q - lampQ) * vec2(0.85, 1.0));
  float lamp = lampIntensity(uDay) * exp(-lampD * 2.2) * (0.85 + uBass * 0.28);

  float toSun = 1.0 - clamp(length((q - keyPos(uDay)) * vec2(0.7, 1.0)) * 1.05, 0.0, 1.0);
  float outdoor = keyIntensity(uDay) * (0.20 + 0.80 * toSun);

  // Base is nearly black. Everything readable in this layer is an edge.
  vec3 col = vec3(0.010, 0.009, 0.014);
  col += LAMP_COLOR * lamp * (0.10 + 0.85 * edge);
  col += keyColor(uDay) * edge * outdoor * 0.26;
  col += mix(skyHorizon(uDay), skyZenith(uDay), 0.5) * edge * 0.06;

  float spill = exp(-max(win, 0.0) * 7.0) * wall;
  col += mix(skyHorizon(uDay), keyColor(uDay), 0.45) * spill * outdoor * 0.13;

  // The curtain is thin: it glows a little where the window is behind it.
  col += mix(skyHorizon(uDay), keyColor(uDay), 0.5) * curtain * 0.030 * keyIntensity(uDay);

  vec3 steamCol = LAMP_COLOR * (0.12 + lamp * 0.7) + keyColor(uDay) * outdoor * 0.08;

  float alpha = clamp(mask + steam * (1.0 - mask), 0.0, 1.0);
  col = mix(steamCol, col, mask / max(alpha, 0.0001));
  col += vec3(1.0, 0.5, 0.2) * emissive;

  col *= uEnter;
  gl_FragColor = vec4(col, alpha * uEnter);
}

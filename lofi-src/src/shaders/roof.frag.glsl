// Layer 4 — the near rooftop. Almost a silhouette: a dark block with a water
// tank, antennas, cables and a slow plume. Being the closest exterior layer it
// travels the most under parallax, so it carries most of the depth cue.

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

// Slack cable between two points.
float cable(vec2 p, vec2 a, vec2 b, float sag) {
  float t = clamp((p.x - a.x) / (b.x - a.x), 0.0, 1.0);
  float y = mix(a.y, b.y, t) - sag * sin(t * 3.14159);
  return abs(p.y - y);
}

void main() {
  vec2 uv = vProj.xy / vProj.w * 0.5 + 0.5;
  vec2 q = compose(uv, uAspect);

  // Everything on this roof is placed as a fraction of the visible width, so
  // the tank and the antennas stay in frame on a phone instead of sitting off
  // to the side of a viewport a third as wide.
  float sx = spanX(uAspect);

  vec2 sun = keyPos(uDay);
  float key = keyIntensity(uDay);
  vec3 kc = keyColor(uDay);

  float mask = 0.0;      // coverage
  float rim = 0.0;       // how much of the key light this pixel catches
  float emissive = 0.0;

  // --- parapet -----------------------------------------------------------
  float parapet = HORIZON - 0.075
                + profile(q.x, 3.1, 21.0) * 0.020
                + step(0.5, profile(q.x, 1.3, 5.0)) * 0.016;
  float slab = smoothstep(0.003, -0.003, q.y - parapet);
  mask = max(mask, slab);
  // The top lip catches light from whatever direction the sun is in.
  rim = max(rim, smoothstep(0.011, 0.0, abs(q.y - parapet)) * slab);

  // --- water tank --------------------------------------------------------
  vec2 tp = q - vec2(-sx * 0.52, parapet + 0.083);
  float tankD = sdBox(tp, vec2(0.026, 0.030)) - 0.013;
  float tank = smoothstep(0.004, -0.004, tankD);
  // Four legs under it.
  float legs = 0.0;
  for (int i = 0; i < 4; i++) {
    float x = -0.028 + float(i) * 0.0187;
    legs = max(legs, smoothstep(0.0030, 0.0, sdSegment(tp, vec2(x, -0.030), vec2(x, -0.062))));
  }
  mask = max(mask, max(tank, legs * step(q.y, parapet + 0.03)));
  // Only the upper half of the tank sees the sky; outlining all of it turns the
  // silhouette into a picture frame.
  rim = max(rim, smoothstep(0.009, 0.0, abs(tankD)) * tank * smoothstep(-0.02, 0.02, tp.y));

  // --- antennas ----------------------------------------------------------
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float ax = sx * (0.20 + fi * 0.24) + hash11(fi * 3.7) * 0.03;
    float ah = 0.085 + hash11(fi * 8.1) * 0.075;
    float m = smoothstep(0.0022, 0.0, sdSegment(q, vec2(ax, parapet), vec2(ax, parapet + ah)));
    // Two cross bars near the top.
    m = max(m, smoothstep(0.0018, 0.0, sdSegment(q,
          vec2(ax - 0.016, parapet + ah * 0.78), vec2(ax + 0.016, parapet + ah * 0.78))));
    m = max(m, smoothstep(0.0018, 0.0, sdSegment(q,
          vec2(ax - 0.011, parapet + ah * 0.92), vec2(ax + 0.011, parapet + ah * 0.92))));
    mask = max(mask, m);
    rim = max(rim, m * 0.55);
    // A red aircraft light on the tallest one, pulsing.
    if (i == 2) {
      float d = length(q - vec2(ax, parapet + ah + 0.004));
      float beacon = smoothstep(0.0075, 0.0, d);
      float pulse = 0.35 + 0.65 * pow(0.5 + 0.5 * sin(uTime * 1.6), 3.0);
      mask = max(mask, beacon);
      emissive = max(emissive, beacon * pulse);
    }
  }

  // --- cables ------------------------------------------------------------
  float c1 = cable(q, vec2(-sx * 1.3, parapet + 0.150), vec2(sx * 1.3, parapet + 0.118), 0.055);
  float c2 = cable(q, vec2(-sx * 1.3, parapet + 0.104), vec2(sx * 1.3, parapet + 0.132), 0.038);
  float wires = max(smoothstep(0.0020, 0.0, c1), smoothstep(0.0016, 0.0, c2));
  // A bird or two sitting on the upper wire.
  for (int i = 0; i < 2; i++) {
    float bx = sx * (-0.45 + float(i) * 0.62);
    float t = clamp((bx + sx * 1.3) / (sx * 2.6), 0.0, 1.0);
    float by = mix(parapet + 0.150, parapet + 0.118, t) - 0.055 * sin(t * 3.14159);
    float bob = sin(uTime * 0.7 + float(i) * 2.1) * 0.0016;
    wires = max(wires, smoothstep(0.0060, 0.0, length((q - vec2(bx, by + 0.006 + bob)) * vec2(1.0, 1.5))));
  }
  mask = max(mask, wires);
  rim = max(rim, wires * 0.4);

  // --- chimney plume -----------------------------------------------------
  float plume = 0.0;
  {
    vec2 base = vec2(-sx * 0.80, parapet + 0.020);
    float chim = smoothstep(0.003, -0.003, sdBox(q - base, vec2(0.014, 0.030)));
    mask = max(mask, chim);
    rim = max(rim, smoothstep(0.008, 0.0, abs(sdBox(q - base, vec2(0.014, 0.030)))) * chim);

    vec2 sp = q - (base + vec2(0.0, 0.032));
    float rise = clamp(sp.y / 0.30, 0.0, 1.0);
    // Drift sideways and widen as it climbs.
    sp.x -= rise * rise * 0.10 + sin(uTime * 0.22 + rise * 3.0) * 0.014 * rise;
    float width = 0.014 + rise * 0.075;
    float shape = smoothstep(width, 0.0, abs(sp.x)) * step(0.0, sp.y) * (1.0 - rise);
    float turb = fbm(vec2(sp.x * 9.0, sp.y * 6.0 - uTime * 0.18));
    plume = clamp(shape * (0.35 + turb * 0.9), 0.0, 1.0) * 0.30;
  }

  if (mask < 0.004 && plume < 0.004) discard;

  // --- shading -----------------------------------------------------------
  // Silhouette, barely lifted off black, plus a hot edge on the light side.
  float toSun = 1.0 - clamp(length((q - sun) * vec2(0.75, 1.0)) * 1.15, 0.0, 1.0);
  vec3 base = vec3(0.016, 0.017, 0.024);
  base = applyHaze(base, 0.05, uDay, q.y);

  vec3 col = base;
  col += kc * rim * key * (0.35 + 0.85 * toSun);
  col += LAMP_COLOR * lampIntensity(uDay) * rim * 0.10;
  col += vec3(1.0, 0.25, 0.16) * emissive * 2.2;

  // Street light bouncing up onto the underside of everything at night.
  col += LAMP_COLOR * windowsOn(uDay) * 0.10 * smoothstep(0.10, -0.10, q.y - parapet) * mask;

  vec3 plumeCol = mix(vec3(0.055, 0.055, 0.075), kc * 0.40, toSun * 0.6);
  plumeCol = applyHaze(plumeCol, 0.22, uDay, q.y);

  float alpha = clamp(mask + plume * (1.0 - mask), 0.0, 1.0);
  col = mix(plumeCol, col, mask / max(alpha, 0.0001));

  col *= uEnter;
  gl_FragColor = vec4(col, alpha * uEnter);
}

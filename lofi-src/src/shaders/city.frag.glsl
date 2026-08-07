// Layers 2 and 3 — the city. One shader, instantiated twice with different
// uniforms: once far and hazed, once near and contrasty.
//
// Buildings are columns with hashed heights. Each one shows a front face and
// one side face, and which side is visible flips with the key light — so when
// the sun crosses the frame the whole skyline re-shades instead of just
// getting a colour wash over it. That is the part that makes a flat layer read
// as geometry.

precision highp float;

uniform float uTime;
uniform float uAspect;
uniform float uDay;
uniform float uEnter;
uniform float uBass;
uniform float uMid;
uniform float uTreble;
uniform float uLevel;

uniform float uFreq;      // buildings per unit of composition space
uniform float uSeed;
uniform float uBase;      // skyline base, relative to the horizon
uniform float uSpread;    // how much the heights vary
uniform float uHaze;
uniform vec3  uAlbedo;
uniform float uWindowRows;
uniform float uWindowCols;
uniform float uLitChance;

varying vec3 vWorld;
varying vec4 vProj;

#include <lofi_common>
#include <lofi_scene>

void main() {
  vec2 uv = vProj.xy / vProj.w * 0.5 + 0.5;
  vec2 q = compose(uv, uAspect);

  vec2 sun = keyPos(uDay);

  // Warp x before splitting into columns so the building widths are uneven.
  // Straight fract() on x gives a picket fence and no amount of shading hides
  // that rhythm.
  float wx = q.x + 0.055 * profile(q.x, uFreq * 0.31, uSeed + 4.0);
  float f = wx * uFreq + uSeed;
  float id = floor(f);
  float lx = fract(f);

  float hgt = hash11(id * 1.37 + uSeed);
  float hgt2 = hash11(id * 5.11 + uSeed * 2.0);
  float top = HORIZON + uBase + (hgt * 0.72 + hgt2 * 0.28) * uSpread;

  // Some buildings get a setback: a narrower upper section.
  float setback = step(0.62, hash11(id * 9.7 + uSeed));
  float inner = step(0.22, lx) * step(lx, 0.78);
  float topHi = top + uSpread * 0.22 * hash11(id * 3.3 + uSeed);
  float roofLine = mix(top, mix(top, topHi, inner), setback);

  float body = smoothstep(0.0035, -0.0035, q.y - roofLine);
  if (body < 0.004) discard;   // nothing below the skyline is ever transparent

  // --- faces -------------------------------------------------------------
  // The side face sits on whichever edge of the building points at the light.
  float sunSide = sign(sun.x - (id + 0.5) / uFreq + uSeed / uFreq);
  float sideW = 0.16 + 0.10 * hash11(id * 2.1 + uSeed);
  float onSide = sunSide > 0.0 ? step(1.0 - sideW, lx) : step(lx, sideW);

  float toSun = 1.0 - clamp(length((q - sun) * vec2(0.7, 1.0)) * 1.25, 0.0, 1.0);
  float key = keyIntensity(uDay) * (0.30 + 0.70 * toSun);

  vec3 albedo = uAlbedo * (0.78 + 0.44 * hash11(id * 7.7 + uSeed));

  // Front face takes a grazing amount of light; the side face takes most of it.
  float front = 0.22 + 0.16 * key;
  float side = 0.30 + 1.05 * key;
  float faceLit = mix(front, side, onSide);

  vec3 col = albedo * faceLit;
  col += keyColor(uDay) * key * onSide * 0.45;

  // Roof cap: a bright line where the top plane catches the sky.
  float cap = smoothstep(0.010, 0.0, roofLine - q.y) * body;
  col = mix(col, mix(skyHorizon(uDay), keyColor(uDay), 0.45) * (0.45 + key * 0.5), cap * 0.75);

  // --- windows -----------------------------------------------------------
  float on = windowsOn(uDay);
  vec2 wg = vec2(lx * uWindowCols, (roofLine - q.y) * uWindowRows);
  vec2 wc = floor(wg);
  vec2 wf = fract(wg);
  float pane = step(0.18, wf.x) * step(wf.x, 0.82) * step(0.22, wf.y) * step(wf.y, 0.78);
  // Skip the panes that fall on the setback edge or below the street line.
  pane *= step(0.06, lx) * step(lx, 0.94) * step(0.02, roofLine - q.y);

  float wh = hash21(wc + vec2(id * 3.0, uSeed * 5.0));
  float lit = step(1.0 - uLitChance, wh);
  // A few of them blink on and off on their own clock.
  float blink = step(0.93, hash21(wc + 19.0))
              * step(0.5, fract(uTime * (0.05 + hash21(wc + 3.0) * 0.12)));
  lit = clamp(lit + blink, 0.0, 1.0);

  vec3 warm = mix(vec3(1.0, 0.74, 0.42), vec3(0.72, 0.86, 1.0), step(0.86, wh));
  float glow = pane * lit * on * (0.55 + 0.45 * hash11(wh * 31.0)) * (0.85 + uMid * 0.55);
  col += warm * glow * 1.25;

  // Dark unlit panes give the facade some texture in daylight too.
  col -= albedo * pane * (1.0 - lit * on) * 0.10;

  // --- atmosphere --------------------------------------------------------
  float depthFade = smoothstep(-0.02, 0.30, q.y - HORIZON);
  col = applyHaze(col, uHaze * (0.55 + 0.45 * (1.0 - depthFade)), uDay, q.y);

  // Street glow rising off the bottom of the frame at night.
  col += LAMP_COLOR * 0.16 * on * smoothstep(0.18, -0.06, q.y - HORIZON);

  col *= uEnter;
  gl_FragColor = vec4(col, body);
}

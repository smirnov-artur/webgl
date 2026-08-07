// The composite. The five layers render into a linear HDR target; this pass
// turns that into the picture.
//
// The interesting part is the rain. Droplets have to sit on the glass — which
// means they must move with the *window*, not with the screen, or the illusion
// dies the moment the camera pans. So this shader reconstructs, for every
// pixel, where its view ray crosses the window plane in world space, and then
// projects that point through the same projector matrix the layers use. The
// droplet field is evaluated in that space, so it is nailed to the glass and
// parallaxes correctly, even though it is being drawn in a fullscreen pass.

precision highp float;

uniform sampler2D uScene;
uniform vec2 uResolution;
uniform float uTime;
uniform float uAspect;
uniform float uDay;
uniform float uEnter;
uniform float uRain;
uniform float uExposure;

uniform mat4 uInvViewProj;
uniform mat4 uProjector;
uniform float uGlassZ;

uniform float uBass;
uniform float uMid;
uniform float uTreble;
uniform float uLevel;

varying vec2 vUv;

#include <lofi_common>
#include <lofi_scene>

// One droplet per cell. Sliding ones fade in and out across their travel so
// they never pop at a cell boundary.
vec3 droplets(vec2 p, float scale, float seed, float t) {
  vec2 g = p * scale;
  vec2 cell = floor(g);
  vec2 f = fract(g) - 0.5;

  vec2 h = hash22(cell + seed);
  float keep = step(0.62, hash21(cell * 1.7 + seed));
  float r = (0.13 + h.x * 0.17) * (0.6 + 0.4 * hash21(cell + 5.0));
  vec2 c = (h - 0.5) * 0.5;

  float slides = step(0.80, hash21(cell + seed + 3.3));
  float y = fract(t * (0.06 + h.y * 0.16) + h.y);
  float life = sin(y * 3.14159);
  c.y = mix(c.y, 0.45 - y * 0.9, slides);

  vec2 d = f - c;
  // Sliding drops stretch vertically into a short trail.
  d.y *= mix(1.0, 0.55, slides);
  float dist = length(d);
  float m = smoothstep(r, r * 0.30, dist) * keep * mix(1.0, life, slides);

  return vec3(d / max(r, 1e-4) * m, m);
}

vec3 aces(vec3 x) {
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

void main() {
  vec2 uv = vUv;

  // --- where does this pixel meet the glass? -----------------------------
  vec2 ndc = uv * 2.0 - 1.0;
  vec4 pNear = uInvViewProj * vec4(ndc, -1.0, 1.0);
  vec4 pFar = uInvViewProj * vec4(ndc, 1.0, 1.0);
  vec3 a = pNear.xyz / pNear.w;
  vec3 b = pFar.xyz / pFar.w;
  vec3 dir = b - a;
  vec3 hit = a + dir * ((uGlassZ - a.z) / dir.z);

  vec4 pr = uProjector * vec4(hit, 1.0);
  vec2 puv = pr.xy / pr.w * 0.5 + 0.5;
  vec2 q = compose(puv, uAspect);

  float glass = smoothstep(0.004, -0.020, windowMask(q, uAspect));

  // --- rain --------------------------------------------------------------
  vec2 offset = vec2(0.0);
  float dropMask = 0.0;
  vec2 drn = vec2(0.0);

#ifdef RAIN
  if (uRain > 0.001 && glass > 0.001) {
    vec3 d1 = droplets(q, 34.0, 0.0, uTime);
    vec3 d2 = droplets(q + vec2(0.31, 0.17), 58.0, 7.0, uTime * 1.35);
    drn = d1.xy * 1.0 + d2.xy * 0.6;
    dropMask = clamp(d1.z + d2.z * 0.75, 0.0, 1.0) * glass * uRain;
    // A droplet is a little lens: it bends what is behind it and flips it.
    offset = -drn * 0.013 * glass * uRain;
  }
#endif

  // --- sample the scene --------------------------------------------------
  vec2 suv = uv + offset;
  vec3 col;

#ifdef CHROMA
  // Aberration grows toward the corners, plus a touch more inside droplets.
  float rad = length(uv - 0.5);
  vec2 ca = (uv - 0.5) * (0.0008 + rad * 0.0016) + offset * 0.14;
  col = vec3(
    texture2D(uScene, suv + ca).r,
    texture2D(uScene, suv).g,
    texture2D(uScene, suv - ca).b
  );
#else
  col = texture2D(uScene, suv).rgb;
#endif

  // Droplets pick up a highlight from wherever the key light is.
  vec2 sunQ = keyPos(uDay);
  float toSun = clamp(dot(normalize(drn + 1e-5), normalize(sunQ - q)), 0.0, 1.0);
  col += keyColor(uDay) * dropMask * (0.02 + toSun * 0.10) * keyIntensity(uDay);
  col += LAMP_COLOR * dropMask * lampIntensity(uDay) * 0.05;

  // --- grade -------------------------------------------------------------
  col *= uExposure * uEnter;
  col = aces(col);

  // Lo-fi grade: shadows lifted toward blue, highlights pulled warm. This is
  // the tape-and-dust colour that the whole genre lives on.
  float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
  vec3 shadowTint = vec3(0.009, 0.012, 0.023);
  vec3 highTint = vec3(1.030, 0.985, 0.930);
  col = col * mix(highTint, vec3(1.0), lum) + shadowTint * (1.0 - smoothstep(0.0, 0.45, lum));
  col = mix(vec3(lum), col, 0.92);   // a whisper of desaturation

  // Vignette.
  vec2 vg = (uv - 0.5) * 2.0;
  col *= 1.0 - smoothstep(0.55, 1.65, length(vg)) * 0.62;

  // Grain, heavier in the shadows the way film actually behaves. The time term
  // is quantised to ~24 fps so it flickers like tape rather than like noise.
  float g = hash21(uv * uResolution + floor(uTime * 24.0) * 137.0) - 0.5;
  col += g * (0.013 + 0.020 * (1.0 - smoothstep(0.0, 0.5, lum))) * (0.85 + uLevel * 0.4);

  gl_FragColor = vec4(max(col, 0.0), 1.0);

  #include <colorspace_fragment>
}

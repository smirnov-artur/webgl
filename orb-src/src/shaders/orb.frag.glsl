// Obsidian orb — fragment stage. Everything below is hand-written; there is no
// MeshTransmissionMaterial, no envMap texture and no post-processing chain.
//
// Per pixel:
//   1. read the far surface from the backface target (normal + distance)
//   2. refract in through the front normal, out through the back normal,
//      once per colour channel with a slightly different IOR -> dispersion
//   3. attenuate along the path through the glass (Beer-Lambert) -> obsidian
//   4. add a specular reflection of an analytic studio environment
//   5. add an internal core that lights up when the refracted ray passes near
//      the centre, and fracture veins that follow the noise ridges
//
// The environment is a function of direction, not a cubemap. That is a real
// saving on mobile: no texture fetches, no 6-face upload, and the dispersion
// loop costs three evaluations of a handful of pow() calls instead of three
// dependent texture reads.

precision highp float;

uniform vec3  uCamPos;
uniform vec3  uCenter;
uniform vec2  uResolution;
uniform float uCenterDist;
uniform float uDepthScale;
uniform sampler2D uBackface;
uniform float uHasBackface;

uniform float uTime;
uniform float uBass;
uniform float uMid;
uniform float uTreble;
uniform float uVoice;
uniform float uLevel;
uniform float uEnter;

uniform float uIOR;
uniform float uDispersion;
uniform vec3  uAbsorb;
uniform float uReflectivity;
uniform vec3  uCoreColor;
uniform float uCoreIntensity;
uniform vec3  uVeinColor;
uniform vec3  uRimColor;

uniform vec3  uKeyDir;
uniform vec3  uKeyColor;
uniform vec3  uFillDir;
uniform vec3  uFillColor;
uniform vec3  uBackDir;
uniform vec3  uBackColor;

varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying vec3 vLocalPos;
varying vec3 vLocalNormal;
varying float vRidge;

#include <orb_noise>

// ---------------------------------------------------------------------------
// Analytic environment. Two softboxes, a kicker behind, a dark floor and a
// thin horizon strip — the same setup you would build with area lights in a
// studio render, collapsed into one function of direction.
// ---------------------------------------------------------------------------
vec3 envColor(vec3 d, float rough) {
  d = normalize(d);

  // Sharpness of every lobe falls off with roughness so the same function can
  // serve both the mirror reflection and the softer transmitted background.
  float s = mix(1.0, 0.12, rough);

  vec3 c = mix(vec3(0.002, 0.0025, 0.005), vec3(0.010, 0.012, 0.019),
               smoothstep(-0.7, 0.95, d.y));

  // Every lobe is deliberately tight. Wide, soft lobes are what turn a dark
  // glass ball into a glowing bubble: they light the whole grazing rim at
  // once, where Fresnel is already at 1.
  float k = max(dot(d, uKeyDir), 0.0);
  c += uKeyColor * (pow(k, 150.0 * s + 2.0) * 3.1 + pow(k, 22.0 * s + 2.0) * 0.12);

  float f = max(dot(d, uFillDir), 0.0);
  c += uFillColor * (pow(f, 64.0 * s + 2.0) * 1.55 + pow(f, 16.0 * s + 2.0) * 0.07);

  float b = max(dot(d, uBackDir), 0.0);
  c += uBackColor * pow(b, 40.0 * s + 2.0) * 1.20;

  // Horizon strip: the giveaway that a glass ball is sitting in a real room.
  float strip = smoothstep(0.045 + rough * 0.22, 0.0, abs(d.y + 0.06));
  c += vec3(0.05, 0.06, 0.09) * strip * (0.5 - rough * 0.3);

  return c;
}

float fresnelSchlick(float cosTheta, float f0) {
  float m = clamp(1.0 - cosTheta, 0.0, 1.0);
  float m2 = m * m;
  return f0 + (1.0 - f0) * m2 * m2 * m;
}

// GGX specular against a directional light — used for the two hard glints that
// sell the surface as polished rather than matte.
float ggx(vec3 N, vec3 V, vec3 L, float rough) {
  vec3 H = normalize(V + L);
  float a = max(rough * rough, 1e-3);
  float a2 = a * a;
  float NdotH = max(dot(N, H), 0.0);
  float d = NdotH * NdotH * (a2 - 1.0) + 1.0;
  return a2 / (3.14159265 * d * d + 1e-5);
}

void main() {
  vec3 N = normalize(vWorldNormal);
  vec3 V = normalize(uCamPos - vWorldPos);
  float NdotV = max(dot(N, V), 0.0);

  // --- far surface -------------------------------------------------------
  vec2 suv = gl_FragCoord.xy / uResolution;
  vec4 back = texture2D(uBackface, suv);
  vec3 Nb = normalize(back.rgb * 2.0 - 1.0);
  float backRel = (back.a - 0.5) * uDepthScale;
  float frontRel = distance(vWorldPos, uCamPos) - uCenterDist;
  float thickness = max(backRel - frontRel, 0.0);

  // Silhouette pixels can miss the reduced-resolution target by half a texel;
  // fall back to a mirrored front normal there instead of flashing a seam.
  float valid = step(0.05, back.a) * uHasBackface;
  Nb = normalize(mix(-N, Nb, valid));
  thickness = mix(0.25, thickness, valid);

  // --- refraction with dispersion ---------------------------------------
  float rough = clamp(0.035 + uTreble * 0.05, 0.0, 1.0);
  vec3 I = -V;
  vec3 transmitted;

#ifdef DISPERSION
  // One chain per channel, unrolled. The IOR spread is small — obsidian is not
  // a prism — but it is what puts colour in the caustics instead of grey.
  float iorR = uIOR - uDispersion;
  float iorB = uIOR + uDispersion;

  vec3 rR1 = refract(I, N, 1.0 / iorR);
  vec3 rR2 = refract(rR1, -Nb, iorR);
  if (dot(rR2, rR2) < 1e-4) rR2 = reflect(rR1, -Nb);   // total internal reflection

  vec3 rG1 = refract(I, N, 1.0 / uIOR);
  vec3 rG2 = refract(rG1, -Nb, uIOR);
  if (dot(rG2, rG2) < 1e-4) rG2 = reflect(rG1, -Nb);

  vec3 rB1 = refract(I, N, 1.0 / iorB);
  vec3 rB2 = refract(rB1, -Nb, iorB);
  if (dot(rB2, rB2) < 1e-4) rB2 = reflect(rB1, -Nb);

  transmitted = vec3(
    envColor(rR2, rough + 0.10).r,
    envColor(rG2, rough + 0.10).g,
    envColor(rB2, rough + 0.10).b
  );
  vec3 rInner = rG1;
#else
  vec3 r1 = refract(I, N, 1.0 / uIOR);
  vec3 r2 = refract(r1, -Nb, uIOR);
  if (dot(r2, r2) < 1e-4) r2 = reflect(r1, -Nb);
  transmitted = envColor(r2, rough + 0.10);
  vec3 rInner = r1;
#endif

  // Beer-Lambert through the body. This is where "obsidian" actually comes
  // from: the glass is nearly clear at the rim and almost black through the
  // middle, so the silhouette stays dark without painting it dark.
  vec3 absorb = exp(-uAbsorb * (thickness + 0.15));
  transmitted *= absorb;

  // --- internal core -----------------------------------------------------
  // Perpendicular distance from the orb centre to the ray travelling inside
  // the glass. Rays that pass close to the centre pick up the emissive core,
  // so the highlight moves and focuses as the surface deforms.
  vec3 rel = vWorldPos - uCenter;
  float dPerp = length(cross(rInner, rel));
  float d2 = dPerp * dPerp;
  // Two lobes: a tight hot centre and a wider bloom around it. A single wide
  // lobe lights most of the disc and the orb stops reading as black glass.
  float core = exp(-d2 * 120.0) * 1.35 + exp(-d2 * 26.0) * 0.42;
  float voiceDrive = 0.045 + uVoice * 2.00 + uBass * 0.40;
  vec3 coreGlow = uCoreColor * core * voiceDrive * uCoreIntensity * mix(vec3(1.0), absorb, 0.35);

  // --- fracture veins ----------------------------------------------------
  // Ridged noise on the displaced position. Reads as the conchoidal fracture
  // of knapped obsidian, and it is the layer that carries the mid band.
  float ridge = vRidge;
#ifdef HQ_VEINS
  vec3 vp = vLocalPos * 3.1 + vec3(0.0, uTime * 0.07, 0.0);
  ridge = mix(ridge, 1.0 - abs(fbm3(vp)), 0.65);
#endif
  float vein = pow(smoothstep(0.74, 0.998, ridge), 3.5);
  vein *= 0.35 + 0.65 * smoothstep(0.0, 0.7, 1.0 - NdotV);
  vec3 veinGlow = uVeinColor * vein * (0.02 + uMid * 0.60 + uVoice * 0.42);

  // --- reflection --------------------------------------------------------
  vec3 R = reflect(I, N);
  vec3 reflection = envColor(R, rough) * uReflectivity;

  float F = fresnelSchlick(NdotV, 0.045);

  vec3 color = mix(transmitted, reflection, F);

  // --- hard glints -------------------------------------------------------
  color += uKeyColor  * ggx(N, V, uKeyDir,  rough) * 0.85 * (0.6 + F);
  color += uFillColor * ggx(N, V, uFillDir, rough + 0.04) * 0.40 * (0.6 + F);
  color += uBackColor * ggx(N, V, uBackDir, rough + 0.06) * 0.30;

  color += coreGlow;
  color += veinGlow;

  // Rim: a thin cold edge that keeps the silhouette readable on black. Kept
  // deliberately faint — the halo pass owns the glow, this only draws the line.
  // This one *does* follow the displaced outline, so it carries the crisp edge
  // and the halo only has to supply the bloom around it.
  float rim = pow(1.0 - NdotV, 6.0);
  color += uRimColor * rim * (0.08 + uLevel * 0.28 + uVoice * 0.26);

  // Entrance: the orb resolves out of a flat dark disc rather than popping in.
  color *= smoothstep(0.0, 0.75, uEnter);

  gl_FragColor = vec4(color, 1.0);

  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}

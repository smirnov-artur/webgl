// Obsidian orb — vertex stage.
//
// The surface is a unit sphere pushed along its own normal by a noise field.
// Three frequency bands drive three different scales of motion so the shape
// reads as a voice and not as a single "loudness" pulse:
//
//   bass   -> a few slow, wide lobes (the body of the sound)
//   voice  -> mid-scale swell around the 200-1200 Hz speech band
//   treble -> fast fine ripple, and it speeds up the whole flow
//
// Normals are recomputed analytically: the displacement is evaluated at two
// small tangential offsets and the normal comes out of the cross product.
// That costs three noise evaluations per vertex but keeps the specular
// highlights correct, which is the whole point of a glass material.

uniform float uTime;
uniform float uBass;
uniform float uMid;
uniform float uTreble;
uniform float uVoice;
uniform float uLevel;
uniform float uEnter;
uniform float uAmp;
uniform float uFreq;

varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying vec3 vLocalPos;
varying vec3 vLocalNormal;
varying float vRidge;

#include <orb_noise>

// Signed displacement along the sphere normal for a direction on the unit sphere.
// `ridge` comes back as a 0..1 mask that peaks on the zero-crossings of the
// field — those become the fracture veins in the fragment stage.
float displace(vec3 dir, out float ridge) {
  float flow = uTime * (0.16 + uTreble * 0.55);

  // Fine detail: the fBm layer. Scrolls, and tightens up with treble.
  vec3 pf = dir * (uFreq * (1.0 + uTreble * 0.35)) + vec3(0.0, flow * 0.7, flow * 0.31);
  float nf = fbm3(pf);

  // Wide lobes: a single low-frequency octave, slow, driven by bass.
  vec3 pl = dir * 1.45 + vec3(flow * 0.42, -flow * 0.23, flow * 0.17);
  float nl = snoise(pl);

  // Speech-band swell sits between the two.
  vec3 pm = dir * 2.9 + vec3(-flow * 0.5, flow * 0.28, 0.0);
  float nm = snoise(pm);

  ridge = 1.0 - abs(nf);

  // Amplitudes are capped low on purpose. The back-surface normal is sampled
  // at the front fragment's own screen position, which is a good approximation
  // only while the surface stays gently curved; push the displacement past
  // ~20% of the radius and the refraction starts to blotch.
  float d =
      nl * (0.040 + uBass * 0.200)
    + nm * (0.014 + uVoice * 0.085)
    + nf * (0.008 + uTreble * 0.050 + uVoice * 0.015);

  return d * uAmp * uEnter;
}

void main() {
  vec3 dir = normalize(position);

  // Tangent frame on the sphere. The branch is on a constant-ish axis choice,
  // not on data, so it costs nothing in practice.
  vec3 up = abs(dir.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  vec3 t1 = normalize(cross(up, dir));
  vec3 t2 = cross(dir, t1);

  const float e = 0.035;
  vec3 dirA = normalize(dir + t1 * e);
  vec3 dirB = normalize(dir + t2 * e);

  float ridge, ra, rb;
  float d0 = displace(dir, ridge);
  float da = displace(dirA, ra);
  float db = displace(dirB, rb);

  // Whole-body pulse. Kept small — a glass ball that inflates like a balloon
  // stops reading as glass.
  float pulse = 1.0 + (uBass * 0.055 + uLevel * 0.018) * uEnter;

  vec3 p0 = dir  * (1.0 + d0) * pulse;
  vec3 pa = dirA * (1.0 + da) * pulse;
  vec3 pb = dirB * (1.0 + db) * pulse;

  vec3 n = normalize(cross(pa - p0, pb - p0));
  if (dot(n, dir) < 0.0) n = -n;

  vRidge = ridge;
  vLocalPos = p0;
  vLocalNormal = n;

  vec4 world = modelMatrix * vec4(p0, 1.0);
  vWorldPos = world.xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * n);

  gl_Position = projectionMatrix * viewMatrix * world;
}

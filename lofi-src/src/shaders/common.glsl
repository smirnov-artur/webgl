// Shared maths for every layer. No uniforms in here — everything is passed as
// an argument, so the chunk can be included by shaders with different uniform
// sets without colliding.

float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  return fract(p * (p + p));
}

float hash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yxz + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash21(i + vec2(0.0, 0.0)), hash21(i + vec2(1.0, 0.0)), u.x),
    mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

// Octave count is a define so the low tier can drop it without a branch.
float fbm(vec2 p) {
  float a = 0.5;
  float s = 0.0;
  mat2 rot = mat2(0.80, 0.60, -0.60, 0.80);
  for (int i = 0; i < FBM_OCTAVES; i++) {
    s += a * vnoise(p);
    p = rot * p * 2.03;
    a *= 0.5;
  }
  return s;
}

// A 1D ridge used for skylines and hills: cheap, and stable under parallax
// because it only depends on x.
float profile(float x, float freq, float seed) {
  float f = x * freq + seed;
  float i = floor(f);
  float t = fract(f);
  t = t * t * (3.0 - 2.0 * t);
  return mix(hash11(i), hash11(i + 1.0), t);
}

float sdBox(vec2 p, vec2 b) {
  vec2 d = abs(p) - b;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}

float sdSegment(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h);
}

vec2 rot2(vec2 p, float a) {
  float c = cos(a), s = sin(a);
  return mat2(c, -s, s, c) * p;
}

// sRGB-ish soft light blend, used to grade layers toward the sky colour
// without washing them out.
vec3 softLight(vec3 base, vec3 blend) {
  return mix(
    2.0 * base * blend + base * base * (1.0 - 2.0 * blend),
    sqrt(base) * (2.0 * blend - 1.0) + 2.0 * base * (1.0 - blend),
    step(0.5, blend)
  );
}

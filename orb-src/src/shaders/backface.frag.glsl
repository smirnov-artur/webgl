// Pass 1 of 2 — the back of the orb, rendered into a half-resolution target.
//
// rgb: the outward world normal of the far surface, encoded to 0..1
// a:   distance from the camera, normalised by uDepthRange
//
// The front pass reads this to find where a ray leaves the glass, which is
// what gives real thickness and a second refraction. It is one extra draw of
// one mesh at quarter the pixel count — far cheaper than a transmission
// material, which re-renders the whole scene every frame.

precision highp float;

uniform vec3 uCamPos;
uniform float uCenterDist;   // camera -> orb centre
uniform float uDepthScale;   // 4 * radius

varying vec3 vWorldPos;
varying vec3 vWorldNormal;

void main() {
  vec3 n = normalize(vWorldNormal);

  // Distance is stored relative to the orb centre, not to the camera. The
  // camera has to move a long way back on a narrow phone viewport, and an
  // absolute distance would spend all of its range on empty space in front of
  // the orb — this keeps full precision on the two units that matter.
  float rel = distance(vWorldPos, uCamPos) - uCenterDist;
  gl_FragColor = vec4(n * 0.5 + 0.5, clamp(rel / uDepthScale + 0.5, 0.0, 1.0));
}

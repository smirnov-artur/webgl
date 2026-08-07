// Dust shell — a few hundred points orbiting the orb. One draw call, all the
// motion in the vertex shader, no per-frame buffer uploads.

uniform float uTime;
uniform float uBass;
uniform float uTreble;
uniform float uVoice;
uniform float uEnter;
uniform float uPixelRatio;

attribute vec3 aSeed;   // x: orbit speed, y: phase, z: size

varying float vFade;

void main() {
  vec3 p = position;

  float ang = uTime * (0.05 + aSeed.x * 0.10) + aSeed.y;
  float c = cos(ang), s = sin(ang);
  p = vec3(p.x * c - p.z * s, p.y, p.x * s + p.z * c);

  // Voice pushes the shell outward and treble makes it shiver.
  float breathe = 1.0 + uBass * 0.10 + uVoice * 0.06;
  p *= breathe;
  p.y += sin(uTime * 1.4 + aSeed.y * 6.0) * (0.010 + uTreble * 0.045);

  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;

  float size = aSeed.z * (1.0 + uTreble * 1.4 + uVoice * 0.5);
  gl_PointSize = size * uPixelRatio * (16.0 / max(-mv.z, 0.1));

  // Fade in with the scene, and dim the ones drifting behind the orb.
  vFade = uEnter * (0.25 + 0.75 * smoothstep(-0.4, 0.6, normalize(p).z));
}

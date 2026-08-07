// Dust in the room, sitting in real 3D between the window and the camera. It
// is the one thing in the scene that is not a projected plane, and that is on
// purpose: a few hundred points with genuine depth make the flat layers behind
// them read as further away.

uniform float uTime;
uniform float uPixelRatio;
uniform float uDay;
uniform float uBass;
uniform float uTreble;
uniform float uEnter;

attribute vec3 aSeed;   // x: drift rate, y: phase, z: size

varying float vShade;

void main() {
  vec3 p = position;

  // Slow convection: rising, with a lateral wander that never repeats exactly.
  float t = uTime * (0.045 + aSeed.x * 0.055);
  p.y += mod(t + aSeed.y, 2.0) - 1.0;
  p.y = mod(p.y + 1.2, 2.4) - 1.2;
  p.x += sin(uTime * (0.20 + aSeed.x * 0.3) + aSeed.y * 6.28) * 0.075;
  p.z += cos(uTime * (0.16 + aSeed.x * 0.25) + aSeed.y * 4.1) * 0.055;

  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;

  float size = aSeed.z * (1.0 + uTreble * 0.9);
  gl_PointSize = size * uPixelRatio * (2.6 / max(-mv.z, 0.1));

  // Motes only really show when they are in the light: bright by day, and at
  // night only the ones near the lamp side survive.
  float lit = mix(1.0, 0.35 + 0.65 * smoothstep(-0.4, 0.6, p.x), smoothstep(0.35, 0.9, uDay));
  vShade = uEnter * lit * (0.55 + uBass * 0.5);
}

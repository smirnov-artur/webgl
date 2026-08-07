// Camera mapping, shared by all five layers.
//
// Each layer is a plane sitting at its own depth. The *content* is not mapped
// with the plane's own UVs — it is looked up by projecting the world position
// through a fixed projector matrix, the view-projection of the camera as it
// stood when the scene was "painted". The live camera then moves away from
// that projector, and because each plane is at a different distance the
// projected lookup slides at a different rate on each one.
//
// That is the whole trick, and it is why the parallax has real perspective:
// the shift is not a per-layer multiplier picked by hand, it falls out of the
// projection. Layers rotate correctly, converge correctly toward the projector
// axis, and a dolly forward opens the scene up instead of just scaling it.

uniform mat4 uProjector;

varying vec3 vWorld;
varying vec4 vProj;

void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;

  // Divided per-fragment rather than here, so the lookup stays perspective
  // correct when the camera is off-axis.
  vProj = uProjector * world;

  gl_Position = projectionMatrix * viewMatrix * world;
}

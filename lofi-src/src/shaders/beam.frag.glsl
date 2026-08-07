// The shaft of light coming through the window. Additive, drawn between the
// rooftop and the room so it sits in front of the city and behind the frame.
//
// It is a wedge from the sun's position in composition space, clipped to the
// window opening and broken up by drifting noise. Not a volumetric integration
// — it is a shape that behaves like one, for the cost of one additive quad.

precision highp float;

uniform float uTime;
uniform float uAspect;
uniform float uDay;
uniform float uEnter;
uniform float uBass;
uniform float uMid;
uniform float uLevel;

varying vec3 vWorld;
varying vec4 vProj;

#include <lofi_common>
#include <lofi_scene>

void main() {
  vec2 uv = vProj.xy / vProj.w * 0.5 + 0.5;
  vec2 q = compose(uv, uAspect);

  vec2 sun = keyPos(uDay);

  // The shaft travels away from the sun and down into the room. Aiming it at a
  // point below and opposite the sun means it swings across the frame as the
  // light moves, instead of hanging in one place.
  vec2 dir = normalize(vec2(-sun.x * 1.6, -1.0));
  vec2 rel = q - sun;

  float along = dot(rel, dir);
  float across = dot(rel, vec2(-dir.y, dir.x));

  // Widens with distance and fades out along its length.
  float width = 0.030 + max(along, 0.0) * 0.20;
  float core = exp(-pow(across / max(width, 0.001), 2.0));
  float reach = smoothstep(-0.02, 0.10, along) * smoothstep(1.00, 0.20, along);

  // Two drifting noise bands so the shaft breathes instead of sitting still.
  float n = fbm(vec2(across * 6.0 + uTime * 0.05, along * 2.6 - uTime * 0.07));
  float shaft = core * reach * (0.35 + n * 0.75);

  // Only where the window actually is: light does not come through the wall.
  float glass = smoothstep(0.010, -0.035, windowMask(q, uAspect));
  shaft *= glass;

  // Strongest at golden hour, gone by night.
  float when = smoothstep(0.02, 0.30, uDay) * (1.0 - smoothstep(0.52, 0.86, uDay));
  float amount = shaft * when * keyIntensity(uDay) * (0.55 + uLevel * 0.45 + uBass * 0.30);

  vec3 col = keyColor(uDay) * amount * 0.20;

  gl_FragColor = vec4(col * uEnter, 1.0);
}

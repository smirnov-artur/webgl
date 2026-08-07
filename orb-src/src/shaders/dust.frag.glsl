// No `precision mediump float` here: uVoice is declared in both stages of this
// program, and a uniform whose precision differs between vertex and fragment
// fails link validation on strict drivers.

uniform vec3 uColor;
uniform float uVoice;

varying float vFade;

void main() {
  vec2 q = gl_PointCoord - 0.5;
  float d = dot(q, q);
  if (d > 0.25) discard;
  float a = exp(-d * 14.0);
  // Kept faint on purpose: any brighter and the shell stops being dust around
  // an object and starts being a starfield behind it.
  gl_FragColor = vec4(uColor * a * vFade * (0.055 + uVoice * 0.42), 1.0);

  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}

uniform vec3 uColor;
uniform float uDay;

varying float vShade;

void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = dot(c, c);
  if (d > 0.25) discard;
  float a = exp(-d * 12.0);
  gl_FragColor = vec4(uColor * a * vShade * 0.30, 1.0);
}

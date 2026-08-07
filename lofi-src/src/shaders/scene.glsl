// Scene layout and the day/night model. Included by every layer *and* by the
// composite pass — the window opening in particular has to be described in
// exactly one place, because the composite needs it to know where the glass is
// and therefore where rain can sit.

// Composition space. uv is 0..1 across the projector frustum; q is that space
// re-centred, normalised by height. q.y always runs -0.5..0.5 and q.x runs with
// the aspect ratio, so vertical framing is identical on every device and only
// the width changes.
vec2 compose(vec2 uv, float aspect) {
  return (uv - 0.5) * vec2(aspect, 1.0);
}

// Half the visible width, and never zero on a very narrow viewport.
float spanX(float aspect) {
  return max(aspect * 0.5, 0.16);
}

// The window opening. Its width follows the viewport with a wall margin left
// on either side, so a phone in portrait gets a tall narrow window rather than
// a landscape one with its jambs pushed off the screen. Everything outside the
// opening is frame, sill or curtain.
const vec2 WIN_CENTER = vec2(0.0, 0.055);
const float WIN_ROUND = 0.012;

vec2 winHalf(float aspect) {
  float sx = spanX(aspect);
  // The margin is a fraction of the width, not a constant: the camera travel
  // is proportional too, and a fixed margin lets the jamb drift off a narrow
  // screen while looking over-generous on a wide one.
  return vec2(min(0.600, sx * 0.70), 0.325);
}

float windowMask(vec2 q, float aspect) {
  vec2 h = winHalf(aspect);
  return sdBox(q - WIN_CENTER, h - WIN_ROUND) - WIN_ROUND;
}

// The horizon sits slightly below centre so the city has room to stack.
const float HORIZON = -0.055;

// ---------------------------------------------------------------------------
// Time of day. day = 0 afternoon, 0.5 golden hour, 1 night.
// ---------------------------------------------------------------------------

vec3 skyZenith(float day) {
  vec3 noon = vec3(0.105, 0.150, 0.255);
  vec3 gold = vec3(0.135, 0.115, 0.205);
  vec3 night = vec3(0.020, 0.024, 0.055);
  return day < 0.5 ? mix(noon, gold, day * 2.0) : mix(gold, night, (day - 0.5) * 2.0);
}

vec3 skyHorizon(float day) {
  vec3 noon = vec3(0.455, 0.395, 0.330);
  vec3 gold = vec3(0.700, 0.320, 0.150);
  vec3 night = vec3(0.115, 0.075, 0.130);
  return day < 0.5 ? mix(noon, gold, day * 2.0) : mix(gold, night, (day - 0.5) * 2.0);
}

// Colour of the key light — the sun, then the last warm bounce, then the
// street sodium glow that replaces it.
vec3 keyColor(float day) {
  vec3 noon = vec3(1.000, 0.930, 0.800);
  vec3 gold = vec3(1.000, 0.560, 0.235);
  vec3 night = vec3(0.520, 0.300, 0.180);
  return day < 0.5 ? mix(noon, gold, day * 2.0) : mix(gold, night, (day - 0.5) * 2.0);
}

float keyIntensity(float day) {
  return mix(0.80, 0.16, smoothstep(0.34, 0.92, day));
}

// How lit the city windows are. They come on through dusk and stay on.
float windowsOn(float day) {
  return smoothstep(0.30, 0.78, day);
}

// The desk lamp behind the camera. Off in daylight, the main source at night.
float lampIntensity(float day) {
  return smoothstep(0.24, 0.72, day);
}

const vec3 LAMP_COLOR = vec3(1.000, 0.620, 0.290);

// Key light position in composition space, tracked by every layer so the
// highlights all agree about where the light is.
vec2 keyPos(float day) {
  float t = clamp(day, 0.0, 1.0);
  return vec2(mix(-0.30, 0.46, t), mix(0.300, -0.085, t * t));
}

// Distance haze: far layers wash toward the sky, which is what actually sells
// the depth once the planes start sliding against each other.
vec3 applyHaze(vec3 color, float amount, float day, float height) {
  vec3 h = mix(skyHorizon(day), skyZenith(day), clamp(height * 1.6 + 0.35, 0.0, 1.0));
  return mix(color, h, clamp(amount, 0.0, 1.0));
}

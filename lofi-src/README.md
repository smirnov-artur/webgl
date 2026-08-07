# Late Shift

A lo-fi window scene built the way a matte-painted shot is built: flat layers,
projected from one fixed viewpoint, with a live camera that moves away from it.

**Live:** https://smirnov-artur.github.io/webgl/lofi/

```
?tier=low|medium|high   start on a given quality tier
?lock                   stop the runtime governor from changing it
```

Every pixel is generated. No photographs, no textures, no audio files — nothing
in this demo belongs to anyone else.

## Camera mapping

Six planes sit at real depths, from the sky at −46 to the room at −2.6. The
content on each one is *not* looked up with the plane's own UVs. It is looked up
by projecting the fragment's world position through a fixed projector matrix —
the view-projection of the camera as it stood when the scene was painted:

```glsl
vProj = uProjector * modelMatrix * vec4(position, 1.0);   // vertex
vec2 uv = vProj.xy / vProj.w * 0.5 + 0.5;                 // fragment
```

The live camera then moves away from that projector, and because every plane is
at a different distance, the projected lookup slides at a different rate on each
one. That is the whole trick, and it is why the parallax has real perspective
rather than the rubbery feel of per-layer scroll multipliers: the layers
converge correctly toward the projector axis, a dolly opens the scene up instead
of scaling it, and the amount each layer moves is a consequence of where it is,
not a number picked by hand.

The camera's travel is derived from the viewport, not fixed. The nearest layer
slides on screen by roughly `shift / distance` in tangent units, and the screen
is only `tan(fov/2) * aspect` wide in those units — so a shift that reads as
gentle on a desktop throws the window half out of frame on a phone in portrait.
The travel is set to a constant *fraction* of the frame instead. The window
opening is responsive for the same reason: on a narrow viewport you get a tall
narrow window, not a landscape one with its jambs pushed off the screen.

## The light

One key light crosses the scene from afternoon through golden hour to night, and
every layer reads its position from the same function. On the city that is not a
colour wash: each building shows a front face and one side face, and *which*
side is visible flips with the light, so the whole skyline re-shades as the sun
moves. Window lights come up through dusk. The desk lamp behind the camera takes
over as the key at night. Light spilling from the opening onto the wall around
it is what stops the room being a flat black card in daylight.

## Layers

| | z | what |
| --- | --- | --- |
| sky | −46 | gradient, sun, drifting cloud fBm, stars, far hills |
| far city | −27 | small hashed blocks, heavily hazed |
| city | −15 | main skyline, window grid, per-building setbacks |
| roof | −7.4 | water tank, antennas, cables, birds, a chimney plume |
| beam | −4.2 | additive shaft through the glass, clipped to the opening |
| room | −2.6 | frame, sill, curtain, mug and steam, plant |

Plus a few hundred dust motes — the only real 3D in the scene, and precisely why
the flat layers behind them read as far away.

## Composite

The layers render into a linear HDR target; one fullscreen pass turns it into
the picture: rain, tone mapping, grade, vignette, grain.

The rain is the part worth reading. Droplets have to sit on the *glass*, so they
must move with the window and not with the screen — otherwise the illusion dies
the first time the camera pans. So the composite reconstructs, per pixel, where
that view ray crosses the window plane in world space, and projects the hit
point through the same projector matrix the layers use:

```glsl
vec3 hit = rayOrigin + rayDir * ((uGlassZ - rayOrigin.z) / rayDir.z);
vec4 pr  = uProjector * vec4(hit, 1.0);
```

The droplet field is evaluated in that space. It is nailed to the glass and
parallaxes correctly, despite being drawn in a fullscreen quad. Each droplet
refracts what is behind it and catches a highlight from the key light.

## The music

`src/music.js` generates the loop: oscillators, filtered noise and a lookahead
scheduler. Fmaj7–Am7–Dm7–Gm7 at 74 BPM, swung sixteenths, boom-bap kick and
snare, a sparse pentatonic melody, and a vinyl bed of hiss and pops. The chain
ends in tape wobble, a lowpass at 4.8 kHz and a soft clip.

It exists because the visuals are driven by an analyser and an analyser needs
something real to analyse — and because nothing sampled could ship in a demo
that has to be clean on rights. Bands are integrated over real Hz windows with
per-band attack and release: low drives the camera push and the ambient bloom,
mid the window lights, high the dust. Microphone input is offered as an
alternative, and when neither is running a synthetic envelope keeps the scene
breathing.

Nothing in the audio path touches React state. The analyser writes into a plain
object, `useFrame` copies it into uniforms, and the FPS counter and band meters
are written straight to the DOM through refs.

## Performance

The scene is fill-rate bound — six near-fullscreen quads plus a composite — so
every quality knob is about pixels.

| | low | medium | high |
| --- | --- | --- | --- |
| DPR cap | 1.25 | 1.6 | 2 |
| offscreen target | 0.68× | 0.85× | 1.0× |
| rain refraction | off | on | on |
| chromatic aberration | off | on | on |
| fBm octaves | 2 | 3 | 4 |
| dust | none | 320 | 620 |

`src/quality.js` picks a starting tier from device hints, then watches the median
frame time — median, not mean, so one shader-compile hitch cannot demote the
scene — and steps down if it cannot hold the target. One upgrade is allowed;
after a demotion it never climbs back, so it cannot oscillate.

## Build

```
npm install
npm run dev
npm run build      # -> ../lofi, base /webgl/lofi/
```

# Obsidian Orb

An audio-reactive orb for a voice-agent widget. One React Three Fiber
component, one hand-written GLSL material, no `MeshTransmissionMaterial` and no
post-processing chain.

**Live:** https://smirnov-artur.github.io/webgl/orb/

```
?tier=low|medium|high   start on a given quality tier
?lock                   stop the runtime governor from changing it
```

## The material

`src/shaders/orb.frag.glsl` is where the look lives. Per pixel:

1. **Two-pass refraction.** Pass one renders the *back* of the orb into a
   half-resolution target: world normal in `rgb`, distance to the orb centre in
   `a`. Pass two renders the front and refracts twice — in through the front
   normal, out through the back one. That is what gives real thickness instead
   of a screen-space fake, and it costs one extra draw of one mesh at a quarter
   of the pixel count. `MeshTransmissionMaterial` re-renders the whole scene
   into a buffer every frame; on a mid-range phone that is the entire budget.
2. **Chromatic dispersion.** The refraction chain runs once per channel with
   the IOR offset by ±0.03. Dropped on the low tier via a `#define`.
3. **Beer-Lambert absorption**, per channel, over the measured thickness. Red
   is absorbed fastest, so a long path through the middle goes black and a
   short one at the rim keeps a cold blue. The obsidian look comes out of the
   geometry rather than out of a tint.
4. **An analytic environment.** `envColor(dir)` is a function, not a cubemap:
   two softboxes, a kicker behind, a dark floor, a horizon strip. No texture
   fetches, nothing to download, and the dispersion loop costs three
   evaluations of a few `pow()` calls instead of three dependent texture reads.
5. **An internal core.** The perpendicular distance from the orb centre to the
   ray travelling *inside* the glass drives an emissive lobe, so the highlight
   focuses and drifts as the surface deforms rather than sitting in the middle
   like a decal.
6. **Fracture veins** on the ridges of the noise field — the conchoidal
   fracture of knapped obsidian. They carry the mid band.

Normals are recomputed analytically in the vertex shader: the displacement is
evaluated at two small tangential offsets and the normal falls out of the cross
product. Three noise evaluations per vertex, and the specular highlights stay
correct while the surface moves.

## The audio

`src/audio.js`. Bands are integrated over real Hz windows taken from the
analyser's own `sampleRate` — bin indices mean different things at 44.1 and
48 kHz. Each band has its own attack/release envelope, frame-rate independent,
fast up and slow down.

| band | range | drives |
| --- | --- | --- |
| bass | 30–160 Hz | wide slow lobes, whole-body pulse, ambient bloom |
| mid | 160–1200 Hz | fracture veins |
| voice | 220–1400 Hz | mid-scale swell, core intensity, rim, halo |
| treble | 2.2–9 kHz | fine ripple, flow speed, dust |

Two sources: `getUserMedia` with AGC, noise suppression and echo cancellation
all switched off — every one of them fights a visualiser — and a synthetic
speech envelope (sentences, pauses, syllables at ~4.5 Hz) that runs when the
microphone is denied, missing, or on an insecure origin. The demo is never
dead, and a gate ramps 0→1 on every source change so switching never lands as a
jump in the geometry.

Nothing here touches React state. The analyser writes into a plain object,
`useFrame` copies it into uniforms, and the FPS counter and band meters are
written straight to the DOM through refs.

## Performance

`src/quality.js` picks a starting tier from device hints, then watches the
median frame time — median, not mean, so one GC hitch cannot demote the scene —
and steps down if it cannot hold the target. One upgrade is allowed; after a
demotion it never climbs back, so it cannot oscillate.

| | low | medium | high |
| --- | --- | --- | --- |
| triangles | 20 480 | 81 920 | 81 920 |
| DPR cap | 1.25 | 1.75 | 2 |
| backface target | 0.4× | 0.5× | 0.5× |
| dispersion | off | on | on |
| fBm octaves | 2 | 3 | 3 |
| dust | none | 300 | 520 |

Draw calls per frame: **3** — backface pass, orb, halo (plus dust where it is
enabled). The halo is a single additive quad standing in for a bloom pass.

## Using it

```jsx
import { Canvas } from '@react-three/fiber'
import ObsidianOrb from './ObsidianOrb'
import { AudioEngine } from './audio'
import { TIERS } from './quality'

const audio = new AudioEngine()

<Canvas dpr={[1, 2]} camera={{ fov: 32 }}>
  <ObsidianOrb audio={audio} quality={TIERS.high} radius={1} />
</Canvas>
```

`audio` is anything with `.bands = { bass, mid, treble, voice, level, pulse }`
and an `.update(dt)` — swap in your own analyser and nothing else changes. The
palette and the optical constants are in `ORB_LOOK` at the top of
`ObsidianOrb.jsx`.

## Build

```
npm install
npm run dev
npm run build      # -> ../orb, base /webgl/orb/
```

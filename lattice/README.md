# Graded Gyroid

A graded triply-periodic minimal surface, sphere-traced in real time. One HTML
file, raw WebGL 2, no library, no model file, no texture.

Live: https://smirnov-artur.github.io/webgl/lattice/

## What is actually in the frame

The object is a signed distance field, not geometry:

```glsl
float g = dot(sin(p * k), cos(p.yzx * k));   // gyroid, TPMS
float d = (abs(g) - wall) / (k * 1.7);       // shell around the surface
d = max(d, length(p) - 1.0);                 // outer skin
d = max(d, 0.30 - length(p));                // inner cavity
d = max(d, min(dot(p, A), dot(p, B)));       // section wedge subtracted
```

`k` is a function of radius, so the cell grades finer toward the core — the way
a real additively-manufactured lattice is graded for stiffness and heat
transfer. The section cut is two half-spaces subtracted from the field, which
is why the cut face shows a true cross-section of the lattice rather than a
capped shell, and why dragging the `SECTION` slider re-cuts the solid instead
of animating a pre-made mesh.

## Hand-written pieces

- **Sphere tracing** with an analytic ray/bounding-sphere entry test, so pixels
  that miss the specimen cost two dot products instead of a march.
- **Soft silhouette coverage.** Grazing rays run out of steps before they land;
  their closest approach is reused as partial coverage, which fills the rim
  holes and antialiases the edge for free.
- **Analytic environment.** No HDR file: a two-stop sky plus a warm softbox and
  a cool rim, each a broad cosine lobe with a tight core. Roughness widens the
  lobe instead of blurring a texture, so the whole IBL is a dozen instructions.
- **Metal BRDF** with roughness-aware Fresnel, per-channel dispersion (the
  reflected ray is fanned around the view tangent, wider at grazing angles) and
  heat-tempering colours — straw into blue — graded by depth into the core.
- **SDF soft shadows and AO**, skipped entirely on faces turned away from the key.
- **Volumetric core**, accumulated in front of the first hit so the glow only
  leaks through open cells and the section cut.
- **Post chain**, all four programs written here: bright-pass with a soft knee,
  two levels of separable Gaussian, then a composite doing ACES (Hill fit),
  edge-weighted chromatic aberration, unsharp, vignette, grain and dither.
  Output converts to linear Display-P3 where the display supports it.

## Performance

Quality is expressed as *ray-march pixels per CSS pixel*, so a 1× laptop is not
undersampled and a 3× phone is not melted. The scaler measures frame time
against an estimate of the refresh period rather than a fixed 16.7 ms —
otherwise vsync makes every frame look "slow" and the scale can only ratchet
down. Three compile-time tiers (step count, shadow steps, bloom levels) pick the
starting point; the resolution scale adapts continuously inside the tier.

Measured, RTX 3050, headless Chromium, hardware ANGLE/D3D11:

| | 1440×900 | 390×844 (DPR 3) |
|---|---|---|
| FPS | 60 | 61 |
| draw calls / frame | 7 | 7 |
| shader programs | 4, all hand-written | 4 |
| march resolution | 0.93× CSS | 0.82× CSS |
| page weight | 95 KB over 4 requests | same |
| geometry + textures | 0 B | 0 B |

Context is requested `alpha:false, antialias:false, depth:false, stencil:false,
powerPreference:high-performance`, with a first attempt at
`failIfMajorPerformanceCaveat:true` — a null answer means the browser would
fall back to a software rasteriser, so the low tier is selected up front.

## Controls

Drag to orbit (critically damped spring, not linear follow), wheel or pinch to
dolly, and three sliders — cell frequency, wall thickness, section angle — that
spring into the uniforms so the solid morphs instead of snapping.

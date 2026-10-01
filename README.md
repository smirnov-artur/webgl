# Artur Smirnov — real-time 3D for the browser

**Live: [smirnov-artur.github.io/webgl](https://smirnov-artur.github.io/webgl/)**

Three.js and hand-written GLSL: 3D product configurators, engineering calculators, and
interactive sites. Available for contract work — Moscow, UTC+3.

This repository is the source of every page linked below. No framework and no build step
on the hand-written pages; each one is a single HTML document you can read top to bottom.

---

## Engineering tools

These are the ones worth your time. On both pages **the browser runs the tool rather than
showing a screenshot of it** — type a dimension and the drawing, the material take-off and
the price are all recomputed from the same parameters, which is the entire point: geometry
and costing read the same numbers and therefore cannot drift apart.

| | |
|---|---|
| **[Ventprom](https://smirnov-artur.github.io/webgl/case/ventprom)** | Parametric duct-fitting configurator for a ventilation manufacturer. Width, height and length in; blank development, sheet area, weight and an indicative price out. The formulas sit under the tool on purpose. |
| **[Standes](https://smirnov-artur.github.io/webgl/case/standes)** | Shelving configurator. Bay count, heights and loads drive the drawing and the take-off. |

## Graded Gyroid — a lattice with zero bytes of geometry

**[smirnov-artur.github.io/webgl/lattice](https://smirnov-artur.github.io/webgl/lattice/)**

There is no model file on that page. No mesh, no texture, no `.glb`, no HDR environment map.
The object is a signed distance field sphere-traced per pixel — a graded gyroid, the
triply-periodic minimal surface additive manufacturing uses for stiffness without mass, with
cell frequency graded as a function of radius the way a printed lattice is graded where loads
concentrate.

Measured on desktop (RTX 3050, ANGLE/D3D11):

| | |
|---|---|
| page weight over the wire | **64.5 KB** across **4 requests** |
| of which, two web fonts | 49 KB |
| the document carrying the whole renderer | **14.9 KB** |
| geometry + textures | **0 B** — the on-screen counter says so |
| frame rate | 60 fps (vsync ceiling) |

The section slider is two half-spaces subtracted from the field, so the cut face is a genuine
cross-section through the lattice rather than a capped shell — the solid re-forms because there
was never a fixed model to violate. Written up in full:
**[Zero bytes of geometry](https://dev.to/smirnovartur/zero-bytes-of-geometry-a-metal-lattice-sphere-traced-in-a-149-kb-page-kib)**.

## Late Shift

**[smirnov-artur.github.io/webgl/lofi](https://smirnov-artur.github.io/webgl/lofi/)**

A window onto a city at dusk. The parallax is the projection itself rather than layers nudged
at different speeds: five planes are camera-mapped from a single fixed viewpoint, so moving the
cursor resolves depth the way a real window would. No photographs and no imported models — the
city, the glass, the rain and the light are hand-written GLSL, and the soundtrack is generated
too.

## Interface studies

Five standalone pages under [`work/`](work/) — `aurum`, `signal`, `vault`, `ferro`, `flux` —
each a self-contained page pairing a WebGL hero with a real layout.

---

## Repository layout

- `index.html` — the landing page. The hero is a fragment shader (domain-warped contour field
  with a metal sheen) on a fullscreen triangle. It degrades to a static gradient without WebGL
  and to a single frame under `prefers-reduced-motion`.
- `case/` — the engineering configurators.
- `lattice/`, `lofi/` — the ray-marched and camera-mapped scenes. `*-src/` holds the sources
  for the ones that are bundled.
- `work/` — the interface studies.
- `assets/` — stills used by the index and the previews.

Deployed by GitHub Pages from `main` at the repository root. `.nojekyll` is present so
directories beginning with `_` are never filtered.

Related: **[smirnov-artur/lab](https://github.com/smirnov-artur/lab)** — WebGPU and TSL
experiments, compute-shader particles.

---

## Contact

Contract work, from a single tool to a full site.

- Telegram — [@smirnovarturr](https://t.me/smirnovarturr)
- Email — paladei702@gmail.com
- Portfolio — [smirnov-artur.github.io/works/en](https://smirnov-artur.github.io/works/en)

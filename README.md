# Artur Smirnov — real-time 3D for the browser

Live: **https://smirnov-artur.github.io/webgl/**

A single-page card for contract work: Three.js, hand-written GLSL, 3D product
configurators, and the domain logic behind them.

- `index.html` — the page. No framework, no build step. The hero is a fragment
  shader (domain-warped contour field with a metal sheen) rendered on a fullscreen
  triangle; it degrades to a static gradient without WebGL and to a single frame
  under `prefers-reduced-motion`.
- `work/` — five standalone demos: `aurum`, `signal`, `vault`, `ferro`, `flux`.
- `assets/` — stills used by the index and the work previews.

Deploy is GitHub Pages from `main`, root path. `.nojekyll` is present so
directories beginning with `_` are never filtered.

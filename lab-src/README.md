# Drift

260 000 particles integrated on the GPU every frame — three.js `WebGPURenderer`,
the simulation written in TSL and dispatched as a compute pass over storage
buffers.

**Live:** https://smirnov-artur.github.io/webgl/lab/

```
?webgl        force the WebGL2 fallback (to compare the two on one machine)
?count=N      override the particle count
```

## What runs each frame

1. One compute dispatch: `ceil(260000 / 64)` workgroups × 64 lanes. Each lane
   reads its particle's position and velocity out of a storage buffer, samples
   a curl-shaped flow field, adds the cursor force and a containment term,
   integrates, ages the particle, respawns it if its life ran out, and writes
   both buffers back.
2. One draw call: a `SpriteNodeMaterial` whose `positionNode` is the same
   storage buffer, bound as an instanced attribute. Nothing round-trips to the
   CPU — the buffer the compute pass wrote is the buffer the vertex stage reads.

State resident on the GPU: 9.92 MB (position and velocity padded to 16 bytes
each in std430, age packed into 8).

## The fallback is real

`if (navigator.gpu)` is not a WebGPU check. The property exists on machines
where no adapter can be acquired — blocklisted drivers, VMs, locked-down
enterprise profiles, most headless browsers. `src/capability.js` asks for an
adapter *and then a device*, and keeps whatever it is told, because an adapter
can be handed out and still refuse to produce a device.

When there is no device, the page does not quietly degrade and keep the same
caption. WebGL2 has no compute stage and no storage buffers, so there is
nowhere to keep per-particle state — and rather than pretend, the demo swaps in
a second node graph where position is a closed-form function of index and time,
evaluated in the vertex stage. It loops, it has no momentum, and it cannot
answer the cursor. The panel says so, in those words, before you notice.

Both paths build their graph from the same TSL and feed the same material. That
shared surface is why this is one demo with two backends rather than two demos.

## Measured

RTX 3050, Chrome 151, the page's own meter. `gpu frame` is wall time around
`compute` + `renderAsync`.

| | particles | fps | ms |
| --- | --- | --- | --- |
| WebGPU, 1440×900 | 260 000 | 60 | 0.52 |
| WebGPU, 390×844 | 90 000 | 60 | 0.73 |
| WebGL2 forced, 1440×900 | 120 000 | 60 | 0.40 |
| WebGL2 forced, 390×844 | 40 000 | 60 | 0.28 |

Not measured on a physical phone — there wasn't one to hand. The counts for
coarse-pointer devices are set conservatively rather than benchmarked, and the
meter is on the page so it can be checked in one tap.

## Weight

851 KB raw, 236 KB gzip, all of it three.js. No React, no framework, no
textures, no models, no fonts — a round sprite is cheaper to compute than to
download. Under the 1 MB budget with the whole build counted, not just the
JavaScript.

## Verifying this

Worth writing down because it cost three runs: **Playwright's bundled Chromium
has no WebGPU at all.** `navigator.gpu` is undefined there in every mode,
including headed with `--enable-unsafe-webgpu`. A WebGPU demo checked with it
will silently show its fallback and look fine in the screenshot. Use real
Chrome:

```js
chromium.launch({ channel: 'chrome', headless: false })
```

and navigate to an actual page — on `about:blank`, `navigator.gpu` does not
appear even in real Chrome.

## Build

```
npm install
npm run dev
npm run build
```

`base` is `'./'`, so the same build works from the root of its own repo or from
a subdirectory of another one without rebuilding.

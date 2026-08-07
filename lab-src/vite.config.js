import { defineConfig } from 'vite';

// base './' rather than an absolute path: the same build then works whether it
// is served from the root of its own repo or from a subdirectory of another
// one. No rebuild needed if the demo moves.
export default defineConfig({
  base: './',
  build: {
    target: 'es2022', // WebGPU browsers are all modern; no point down-levelling
    assetsInlineLimit: 0,
    reportCompressedSize: true,
  },
});

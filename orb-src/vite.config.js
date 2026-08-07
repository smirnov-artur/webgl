import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Published under https://smirnov-artur.github.io/webgl/orb/, so every asset
// URL has to carry that prefix. The build lands in ../orb, next to the rest of
// the site, and the source stays checked in beside it.
export default defineConfig({
  base: '/webgl/orb/',
  plugins: [react()],
  build: {
    outDir: '../orb',
    emptyOutDir: true,
    target: 'es2020',
    assetsInlineLimit: 0,
  },
});

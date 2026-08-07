import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Published under https://smirnov-artur.github.io/webgl/lofi/. Build lands in
// ../lofi next to the rest of the site; the source stays checked in beside it.
export default defineConfig({
  base: '/webgl/lofi/',
  plugins: [react()],
  build: {
    outDir: '../lofi',
    emptyOutDir: true,
    target: 'es2020',
    assetsInlineLimit: 0,
  },
});

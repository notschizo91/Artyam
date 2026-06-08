import { defineConfig } from 'vite';
import wasm from 'vite-plugin-wasm';

export default defineConfig({
  plugins: [wasm()],
  optimizeDeps: {
    exclude: ['manifold-3d'],
  },
  build: {
    target: 'esnext',
    chunkSizeWarningLimit: 1000,
  },
  resolve: {
    alias: {
      'node:module': '/src/empty-module.js',
    },
  },
});

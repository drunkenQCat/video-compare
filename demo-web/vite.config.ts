import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 3000,
  },
  build: {
    target: 'es2020',
  },
  optimizeDeps: {
    exclude: ['@cfai/video-compare'],
  },
  assetsInclude: ['**/*.wasm'],
});

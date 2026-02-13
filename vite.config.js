// vite.config.js
import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    open: true,
    port: 3000
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
          rapier: ['@dimforge/rapier3d-compat']
        }
      }
    }
  }
});

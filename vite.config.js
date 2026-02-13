import { defineConfig } from 'vite';

const isProduction = process.env.NODE_ENV === 'production';

export default defineConfig({
  server: {
    open: true,
    port: 3000
  },
  build: {
    target: 'es2020',
    sourcemap: isProduction ? 'hidden' : true,
    minify: 'esbuild',
    cssCodeSplit: true,
    assetsInlineLimit: 4096,
    reportCompressedSize: true,
    chunkSizeWarningLimit: 1000,
    modulePreload: {
      polyfill: true
    },
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return;

          if (id.includes('/three') || id.includes('three-stdlib') || id.includes('three-bvh-csg')) {
            return 'vendor-three';
          }

          if (id.includes('@dimforge/rapier3d')) {
            return 'vendor-rapier';
          }

          if (id.includes('/firebase/')) {
            return 'vendor-firebase';
          }

          return 'vendor';
        }
      }
    },
    esbuild: isProduction
      ? {
          drop: ['console', 'debugger']
        }
      : undefined
  }
});

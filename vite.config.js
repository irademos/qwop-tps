import { defineConfig } from 'vite';

const isProduction = process.env.NODE_ENV === 'production';

// Build id for the "new version" banner (src/core/appUpdate.js): baked into the bundle as __BUILD_ID__
// and written to dist/version.json. The dev server has no build id ('dev' — no checks).
const buildId = `${process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) || 'local'}-${Date.now().toString(36)}`;
const versionFile = () => ({
  name: 'version-file',
  apply: 'build',
  generateBundle() {
    this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ id: buildId }) });
  }
});

export default defineConfig(({ command }) => ({
  define: {
    __BUILD_ID__: JSON.stringify(command === 'build' ? buildId : 'dev')
  },
  plugins: [versionFile()],
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

          if (id.includes('/three')) {
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
}));

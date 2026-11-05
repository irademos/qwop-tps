import { defineConfig } from 'vite';
import { readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

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

// Offline play (public/service-worker.js): every build also writes dist/offline-manifest.json —
// { id: the build id, files: [...] } — the app's own files (index.html, the hashed chunks / CSS)
// plus the public files the game needs to run with no network. The page asks the worker to cache
// them all once it's up (src/core/offlineCache.js). Left out (online only): Classic's map, Story's
// Tree Island, the songs (music just stays off offline), the worker itself.
const OFFLINE_SKIP = [
  /^glb_map\//,
  /^mappacks\/tree_island/,
  /^assets\/audio\/Songs\//,
  /^service-worker\.js$/,
  /\.map$/,
  /(^|\/)\./,
];
const listPublic = (dir, root = dir, out = []) => {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) listPublic(full, root, out);
    else out.push(relative(root, full).split(sep).join('/'));
  }
  return out;
};
const offlineManifest = () => ({
  name: 'offline-manifest',
  apply: 'build',
  generateBundle(_options, bundle) {
    const built = Object.keys(bundle).filter((f) => !f.endsWith('.map') && f !== 'version.json');
    let pub = [];
    try { pub = listPublic('public'); } catch (_) {}
    const files = ['/', ...[...built, ...pub]
      .filter((f) => !OFFLINE_SKIP.some((re) => re.test(f)))
      .map((f) => `/${encodeURI(f)}`)];
    this.emitFile({
      type: 'asset',
      fileName: 'offline-manifest.json',
      source: JSON.stringify({ id: buildId, files: [...new Set(files)] }),
    });
  }
});

export default defineConfig(({ command }) => ({
  define: {
    __BUILD_ID__: JSON.stringify(command === 'build' ? buildId : 'dev')
  },
  plugins: [versionFile(), offlineManifest()],
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

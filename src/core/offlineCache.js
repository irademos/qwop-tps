// Offline play: once the service worker (public/service-worker.js) is running, ask it to cache
// everything the game needs to run with no network (dist/offline-manifest.json — vite.config.js)
// for this build. Done once per build; the first time it finishes a small "Ready to play offline"
// note shows. Status for the dev console / Settings: window.offlineStatus
//   { state: 'idle' | 'caching' | 'ready' | 'failed', done, total }.
// Dev server (no build id / no worker): nothing happens.

const BUILD_ID = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev';
const START_DELAY_MS = 6000;   // let the game load first
const NOTE_MS = 5000;

const status = { state: 'idle', done: 0, total: 0 };
let noteEl = null;

function showNote(text) {
  if (!noteEl) {
    noteEl = document.createElement('div');
    noteEl.className = 'offline-note';
    noteEl.setAttribute('role', 'status');
    document.body.appendChild(noteEl);
  }
  noteEl.textContent = text;
  noteEl.classList.add('is-shown');
  clearTimeout(noteEl._t);
  noteEl._t = setTimeout(() => noteEl.classList.remove('is-shown'), NOTE_MS);
}

async function askToCache() {
  if (!navigator.onLine || status.state === 'caching' || status.state === 'ready') return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const worker = reg.active || navigator.serviceWorker.controller;
    if (!worker) return;
    status.state = 'caching';
    worker.postMessage({ type: 'precache', buildId: BUILD_ID });
  } catch (error) {
    console.warn('[offline] could not ask the service worker to cache the game:', error);
  }
}

export function setupOfflineCache() {
  window.offlineStatus = status;
  if (BUILD_ID === 'dev' || !('serviceWorker' in navigator) || location.hostname === 'localhost') return;
  navigator.serviceWorker.addEventListener('message', (event) => {
    const data = event.data || {};
    if (data.type === 'precache-progress') {
      status.state = 'caching';
      status.done = data.done;
      status.total = data.total;
    } else if (data.type === 'precache-done') {
      const first = status.state !== 'ready' && !data.already;
      status.state = 'ready';
      if (first) showNote('Ready to play offline');
    } else if (data.type === 'precache-failed') {
      status.state = 'failed'; // (tried again when the connection comes back / next load)
    }
  });
  setTimeout(askToCache, START_DELAY_MS);
  window.addEventListener('online', () => {
    if (status.state === 'failed') status.state = 'idle';
    void askToCache();
  });
}

// "There's a new version of the game" banner.
// Every build bakes its id into the bundle (__BUILD_ID__, vite.config.js) and writes the same id to
// /version.json. The service worker serves the app shell cache-first, so a player can keep running an
// old build after a deploy; this checks /version.json (never cached — vercel.json, and the worker
// leaves it alone) at start-up, every CHECK_EVERY_MS and when the tab comes back, and shows the banner
// for SHOW_MS when the deployed id differs. Update = clearCacheAndReload (the same as Settings → About
// → Clear Cache & Reload). Dev server (no build id): nothing is checked.

const BUILD_ID = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev';
const VERSION_URL = '/version.json';
const FIRST_CHECK_MS = 8000;
const CHECK_EVERY_MS = 10 * 60 * 1000;
const SHOW_MS = 15000;

// Service worker caches + the worker itself; the reload fetches fresh files and registers it again.
// localStorage / cookies are untouched.
export async function clearCacheAndReload() {
  try {
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map(key => caches.delete(key)));
    }
    const registrations = await navigator.serviceWorker?.getRegistrations?.() ?? [];
    await Promise.all(registrations.map(registration => registration.unregister()));
  } catch (error) {
    console.warn('Failed to clear cache:', error);
  }
  window.location.reload();
}

async function fetchDeployedId() {
  try {
    const res = await fetch(`${VERSION_URL}?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return null;
    const data = await res.json();
    return typeof data?.id === 'string' ? data.id : null;
  } catch {
    return null;
  }
}

let bannerEl = null;
let hideTimer = 0;

function hideBanner() {
  clearTimeout(hideTimer);
  if (!bannerEl) return;
  bannerEl.classList.remove('is-shown');
  const el = bannerEl;
  setTimeout(() => { if (!el.classList.contains('is-shown')) el.hidden = true; }, 400);
}

function showBanner() {
  if (!bannerEl) {
    bannerEl = document.createElement('div');
    bannerEl.id = 'update-banner';
    bannerEl.className = 'update-banner';
    bannerEl.setAttribute('role', 'status');
    bannerEl.hidden = true;
    const text = document.createElement('span');
    text.className = 'update-banner-text';
    text.textContent = "There's a new version of the game";
    const update = document.createElement('button');
    update.type = 'button';
    update.className = 'ui-btn update-banner-btn';
    update.textContent = 'Update';
    update.addEventListener('click', () => {
      update.disabled = true;
      update.textContent = 'Updating...';
      clearCacheAndReload();
    });
    const dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.className = 'ui-btn-ghost update-banner-btn';
    dismiss.textContent = 'Dismiss';
    dismiss.addEventListener('click', hideBanner);
    bannerEl.append(text, update, dismiss);
    document.body.appendChild(bannerEl);
  }
  bannerEl.hidden = false;
  requestAnimationFrame(() => bannerEl.classList.add('is-shown'));
  clearTimeout(hideTimer);
  hideTimer = setTimeout(hideBanner, SHOW_MS);
}

let started = false;
export function startUpdateChecks() {
  if (started || BUILD_ID === 'dev' || typeof window === 'undefined') return;
  started = true;
  const shownFor = new Set(); // each newer deploy is announced once per page load
  let checking = false;
  const check = async () => {
    if (checking || document.hidden) return;
    checking = true;
    const id = await fetchDeployedId();
    checking = false;
    if (!id || id === BUILD_ID || shownFor.has(id)) return;
    shownFor.add(id);
    showBanner();
  };
  setTimeout(check, FIRST_CHECK_MS);
  setInterval(check, CHECK_EVERY_MS);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
}

// Started on import (bootstrapGameApp.js imports this first), so it runs even if the rest of the game
// fails to boot. Dev console: window.showUpdateBanner() previews the banner.
if (typeof window !== 'undefined') window.showUpdateBanner = showBanner;
startUpdateChecks();

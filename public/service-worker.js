const CACHE_VERSION = 'v1';
const CORE_CACHE = `core-shell-${CACHE_VERSION}`;
const STATIC_CACHE = `static-assets-${CACHE_VERSION}`;

const CORE_ASSETS = [
  '/',
  '/index.html',
  '/app.js',
  '/styles.css',
  '/manifest.webmanifest',
  '/models/old_man.fbx',
  '/models/animations/Breathing Idle.fbx',
  '/models/animations/Old Man Walk.fbx',
  '/assets/audio/BGS Loops/Forest Day/Forest Day.ogg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CORE_CACHE).then((cache) => cache.addAll(CORE_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => ![CORE_CACHE, STATIC_CACHE].includes(key))
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

const isStaticAsset = (request) => {
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) {
    return false;
  }
  if (
    request.destination === 'script' ||
    request.destination === 'style' ||
    request.destination === 'image' ||
    request.destination === 'font' ||
    request.destination === 'audio' ||
    request.destination === 'model'
  ) {
    return true;
  }
  return (
    url.pathname.startsWith('/assets/') ||
    url.pathname.startsWith('/models/') ||
    url.pathname.startsWith('/areas/') ||
    url.pathname.startsWith('/scripts/') ||
    url.pathname.startsWith('/workers/')
  );
};

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') {
    return;
  }

  if (!isStaticAsset(request)) {
    return;
  }

  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const responseClone = networkResponse.clone();
          caches.open(STATIC_CACHE).then((cache) => {
            cache.put(request, responseClone);
          });
        }
        return networkResponse;
      });
    })
  );
});

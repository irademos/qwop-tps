const SHELL_CACHE_VERSION = 'v3';
const STATIC_CACHE_VERSION = 'v3';
const DYNAMIC_CACHE_VERSION = 'v3';
const CDN_CACHE_VERSION = 'v2';

const CORE_CACHE = `core-shell-${SHELL_CACHE_VERSION}`;
const STATIC_CACHE = `static-assets-${STATIC_CACHE_VERSION}`;
const DYNAMIC_CACHE = `dynamic-assets-${DYNAMIC_CACHE_VERSION}`;
const CDN_CACHE = `cdn-assets-${CDN_CACHE_VERSION}`;

const MAX_STATIC_ENTRIES = 80;
const MAX_DYNAMIC_ENTRIES = 20;
const MAX_CDN_ENTRIES = 20;
const MAX_CACHEABLE_BYTES = 8 * 1024 * 1024; // 8MB guardrail

const CORE_ASSETS = [
  '/',
  '/index.html',
  '/app.js',
  '/styles.css',
  '/icons/zombie_icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CORE_CACHE)
      .then((cache) => cache.addAll(CORE_ASSETS))
      .catch((error) => {
        console.warn('Core cache prefetch failed:', error);
      })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter(
            (key) => ![CORE_CACHE, STATIC_CACHE, DYNAMIC_CACHE, CDN_CACHE].includes(key)
          )
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

const shouldCacheResponse = (response) => {
  if (!response) {
    return false;
  }
  if (!(response.ok || response.type === 'opaque')) {
    return false;
  }

  const contentLength = response.headers.get('content-length');
  if (!contentLength) {
    return true;
  }

  const size = Number.parseInt(contentLength, 10);
  if (Number.isNaN(size)) {
    return true;
  }

  return size <= MAX_CACHEABLE_BYTES;
};

const enforceMaxEntries = async (cacheName, maxEntries) => {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();

  if (keys.length <= maxEntries) {
    return;
  }

  const overflow = keys.length - maxEntries;
  await Promise.all(keys.slice(0, overflow).map((request) => cache.delete(request)));
};

const putWithLimits = async (cacheName, request, response, maxEntries) => {
  if (!shouldCacheResponse(response)) {
    return;
  }

  const cache = await caches.open(cacheName);
  await cache.put(request, response.clone());
  await enforceMaxEntries(cacheName, maxEntries);
};

const isSameOrigin = (request) => new URL(request.url).origin === self.location.origin;

const isAppShellRequest = (request) => {
  if (!isSameOrigin(request)) {
    return false;
  }

  const url = new URL(request.url);
  return (
    request.mode === 'navigate' ||
    CORE_ASSETS.includes(url.pathname) ||
    request.destination === 'script' ||
    request.destination === 'style'
  );
};

const isDynamicMediaRequest = (request) => {
  if (!isSameOrigin(request)) {
    return false;
  }

  const url = new URL(request.url);
  return (
    request.destination === 'audio' ||
    request.destination === 'video' ||
    request.destination === 'model' ||
    url.pathname.startsWith('/models/') ||
    url.pathname.startsWith('/assets/audio/')
  );
};

const isStaticAsset = (request) => {
  if (!isSameOrigin(request)) {
    return false;
  }

  const url = new URL(request.url);
  return (
    request.destination === 'image' ||
    request.destination === 'font' ||
    request.destination === 'worker' ||
    url.pathname.startsWith('/assets/') ||
    url.pathname.startsWith('/areas/') ||
    url.pathname.startsWith('/scripts/') ||
    url.pathname.startsWith('/workers/')
  );
};

const isCdnScript = (request) => {
  const url = new URL(request.url);
  if (url.origin !== 'https://cdn.jsdelivr.net') {
    return false;
  }
  return (
    url.pathname.includes('/peerjs@') ||
    url.pathname.includes('/nipplejs@')
  );
};

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') {
    return;
  }
  if (request.headers.has('range')) {
    return;
  }

  if (isCdnScript(request)) {
    const updatePromise = fetch(request)
      .then(async (networkResponse) => {
        await putWithLimits(CDN_CACHE, request, networkResponse, MAX_CDN_ENTRIES);
        return networkResponse;
      })
      .catch(() => caches.match(request));

    event.respondWith(
      caches.match(request).then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }
        return updatePromise;
      })
    );

    event.waitUntil(updatePromise);
    return;
  }

  if (isAppShellRequest(request)) {
    event.respondWith(
      caches.match(request).then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }

        return fetch(request).then(async (networkResponse) => {
          await putWithLimits(CORE_CACHE, request, networkResponse, MAX_STATIC_ENTRIES);
          return networkResponse;
        });
      })
    );
    return;
  }

  if (isDynamicMediaRequest(request)) {
    event.respondWith(
      fetch(request)
        .then(async (networkResponse) => {
          await putWithLimits(DYNAMIC_CACHE, request, networkResponse, MAX_DYNAMIC_ENTRIES);
          return networkResponse;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  if (!isStaticAsset(request)) {
    return;
  }

  const staticUpdatePromise = fetch(request)
    .then(async (networkResponse) => {
      await putWithLimits(STATIC_CACHE, request, networkResponse, MAX_STATIC_ENTRIES);
      return networkResponse;
    })
    .catch(() => undefined);

  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }

      return staticUpdatePromise;
    })
  );

  event.waitUntil(staticUpdatePromise);
});

const SHELL_CACHE_VERSION = 'v13';
const STATIC_CACHE_VERSION = 'v20';
const DYNAMIC_CACHE_VERSION = 'v4';
const CDN_CACHE_VERSION = 'v2';

const CORE_CACHE = `core-shell-${SHELL_CACHE_VERSION}`;
const STATIC_CACHE = `static-assets-${STATIC_CACHE_VERSION}`;
const DYNAMIC_CACHE = `dynamic-assets-${DYNAMIC_CACHE_VERSION}`;
const CDN_CACHE = `cdn-assets-${CDN_CACHE_VERSION}`;

const MAX_STATIC_ENTRIES = 80;
const MAX_DYNAMIC_ENTRIES = 20;
const MAX_CDN_ENTRIES = 20;
const MAX_CACHEABLE_BYTES = 8 * 1024 * 1024; // 8MB guardrail

// Offline play: the page (src/core/offlineCache.js) posts { type: 'precache', buildId } once it's
// up; the worker fetches /offline-manifest.json (written by every build — vite.config.js) and,
// when it is the page's own build and not cached yet, caches every file it lists into
// `offline-<build id>` (no entry limit), then drops older offline caches. Every request below
// falls back to these when the network is gone. Progress goes back to the pages as
// { type: 'precache-progress', done, total } / { type: 'precache-done', id } / 'precache-failed'.
const OFFLINE_PREFIX = 'offline-';
const OFFLINE_CDN = [
  'https://cdn.jsdelivr.net/npm/nipplejs@0.10.1/dist/nipplejs.min.js',
  'https://cdn.jsdelivr.net/npm/peerjs@1.5.2/dist/peerjs.min.js'
];
const PRECACHE_PARALLEL = 6;
let precacheRunning = null;

const CORE_ASSETS = [
  '/',
  '/index.html',
  '/app.js',
  '/styles.css',
  '/manifest.webmanifest',
  '/icons/favicon.png',
  '/icons/apple-touch-icon.png',
  '/icons/app_icon_192.png',
  '/icons/app_icon_512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CORE_CACHE);
    await Promise.all(
      CORE_ASSETS.map(async (assetUrl) => {
        try {
          const response = await fetch(new Request(assetUrl, { cache: 'no-cache' }));
          if (!shouldCacheResponse(response)) {
            console.warn('[service-worker] install-prefetch skipped non-cacheable response:', assetUrl);
            return;
          }
          await cache.put(assetUrl, response.clone());
        } catch (error) {
          console.warn('[service-worker] install-prefetch failed:', assetUrl, error);
        }
      })
    );
  })());
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter(
            (key) => ![CORE_CACHE, STATIC_CACHE, DYNAMIC_CACHE, CDN_CACHE].includes(key)
              && !key.startsWith(OFFLINE_PREFIX)
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

const tellPages = async (message) => {
  const pages = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
  pages.forEach((page) => page.postMessage(message));
};

// (a completed offline cache carries this marker entry: a half-done one is redone)
const COMPLETE_MARK = '/__offline_complete__';
const precache = async (buildId) => {
  const res = await fetch('/offline-manifest.json', { cache: 'no-store' });
  if (!res.ok) throw new Error(`offline manifest: ${res.status}`);
  const manifest = await res.json();
  // (an older page — the update banner's job — or a manifest from another build: not now)
  if (!manifest?.id || (buildId && buildId !== manifest.id)) return { skipped: true };
  const name = `${OFFLINE_PREFIX}${manifest.id}`;
  const cache = await caches.open(name);
  if (await cache.match(COMPLETE_MARK)) {
    await tellPages({ type: 'precache-done', id: manifest.id, already: true });
    return { done: true };
  }
  const files = [...(manifest.files || []), ...OFFLINE_CDN];
  let done = 0;
  let failed = 0;
  let next = 0;
  const worker = async () => {
    while (next < files.length) {
      const url = files[next++];
      try {
        if (!(await cache.match(url))) {
          const response = await fetch(new Request(url, { cache: 'no-cache' }));
          if (!response.ok) throw new Error(`${response.status}`);
          await cache.put(url, response);
        }
      } catch (error) {
        // (the CDN scripts are best-effort: the joystick / phone link fetch them themselves too)
        if (!OFFLINE_CDN.includes(url)) failed += 1;
        console.warn('[service-worker] precache failed:', url, error);
      }
      done += 1;
      if (done % 10 === 0 || done === files.length) {
        await tellPages({ type: 'precache-progress', done, total: files.length });
      }
    }
  };
  await Promise.all(Array.from({ length: PRECACHE_PARALLEL }, worker));
  if (failed > 0) {
    await tellPages({ type: 'precache-failed', failed, total: files.length });
    return { failed };
  }
  await cache.put(COMPLETE_MARK, new Response(manifest.id));
  const keys = await caches.keys();
  await Promise.all(keys.filter((k) => k.startsWith(OFFLINE_PREFIX) && k !== name).map((k) => caches.delete(k)));
  await tellPages({ type: 'precache-done', id: manifest.id });
  return { done: true };
};

self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type !== 'precache') return;
  if (!precacheRunning) {
    precacheRunning = precache(data.buildId)
      .catch((error) => console.warn('[service-worker] precache:', error))
      .finally(() => { precacheRunning = null; });
  }
  event.waitUntil(precacheRunning);
});

// Any cache, the exact URL first, else the same path with another ?v= (offline: better than nothing)
const matchAnyCache = async (request) =>
  (await caches.match(request)) || (await caches.match(request, { ignoreSearch: true }));
const offlineFallback = async (request) =>
  (await matchAnyCache(request)) || new Response('', { status: 503, statusText: 'Offline' });

const rangeFromCache = async (request) => {
  const cached = await caches.match(request.url, { ignoreSearch: true });
  if (!cached) return new Response('', { status: 503, statusText: 'Offline' });
  const buf = await cached.arrayBuffer();
  const m = /bytes=(\d*)-(\d*)/.exec(request.headers.get('range') || '');
  const size = buf.byteLength;
  let start = m && m[1] ? Number(m[1]) : 0;
  let end = m && m[2] ? Number(m[2]) : size - 1;
  if (m && !m[1] && m[2]) { start = Math.max(0, size - Number(m[2])); end = size - 1; }
  end = Math.min(end, size - 1);
  if (start > end) return new Response('', { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
  return new Response(buf.slice(start, end + 1), {
    status: 206,
    headers: {
      'Content-Type': cached.headers.get('Content-Type') || 'application/octet-stream',
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Content-Length': String(end - start + 1),
      'Accept-Ranges': 'bytes'
    }
  });
};

const isFontRequest = (request) => {
  const { origin } = new URL(request.url);
  return origin === 'https://fonts.googleapis.com' || origin === 'https://fonts.gstatic.com';
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
    // (audio / video: the network as before; offline, the slice asked for out of a cached copy)
    if (isSameOrigin(request)) {
      event.respondWith(fetch(request).catch(() => rangeFromCache(request)));
    }
    return;
  }

  if (isCdnScript(request)) {
    const updatePromise = fetch(request)
      .then(async (networkResponse) => {
        await putWithLimits(CDN_CACHE, request, networkResponse, MAX_CDN_ENTRIES);
        return networkResponse;
      })
      .catch(async (error) => {
        console.warn('[service-worker] fetch failure (cdn-script):', request.url, error);
        const cachedResponse = await caches.match(request);
        return cachedResponse || new Response('', { status: 503, statusText: 'Offline' });
      });

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

  // Google Fonts: from the cache when there, refreshed in the background
  if (isFontRequest(request)) {
    const fontUpdate = fetch(request)
      .then(async (networkResponse) => {
        await putWithLimits(CDN_CACHE, request, networkResponse, MAX_CDN_ENTRIES);
        return networkResponse;
      })
      .catch(() => undefined);
    event.respondWith(
      caches.match(request).then((cached) => cached
        || fontUpdate.then((r) => r || new Response('', { status: 503, statusText: 'Offline' })))
    );
    event.waitUntil(fontUpdate);
    return;
  }

  if (isAppShellRequest(request)) {
    event.respondWith(
      caches.match(request).then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }

        return fetch(request)
          .then(async (networkResponse) => {
            await putWithLimits(CORE_CACHE, request, networkResponse, MAX_STATIC_ENTRIES);
            return networkResponse;
          })
          .catch(async (error) => {
            console.warn('[service-worker] fetch failure (app-shell):', request.url, error);
            const fallback = request.mode === 'navigate'
              ? (await caches.match('/index.html')) || (await caches.match('/'))
              : await matchAnyCache(request);
            return fallback || new Response('', { status: 503, statusText: 'Offline' });
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
        .catch(async (error) => {
          console.warn('[service-worker] fetch failure (dynamic-media):', request.url, error);
          return offlineFallback(request);
        })
    );
    return;
  }

  if (!isStaticAsset(request)) {
    // Everything else of ours (mappacks, the basis transcoder, …): the network, else a cached copy
    if (isSameOrigin(request) && !new URL(request.url).pathname.endsWith('.json')) {
      event.respondWith(fetch(request).catch(() => offlineFallback(request)));
    }
    return;
  }

  const staticUpdatePromise = fetch(request)
    .then(async (networkResponse) => {
      await putWithLimits(STATIC_CACHE, request, networkResponse, MAX_STATIC_ENTRIES);
      return networkResponse;
    })
    .catch((error) => {
      console.warn('[service-worker] fetch failure (static-asset):', request.url, error);
      return undefined;
    });

  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }

      return staticUpdatePromise.then(async (networkResponse) => networkResponse
        || (await caches.match(request, { ignoreSearch: true }))
        || Response.error());
    })
  );

  event.waitUntil(staticUpdatePromise);
});

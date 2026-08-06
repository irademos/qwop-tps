const scriptLoaders = new Map();

function loadScriptOnce(src) {
  if (scriptLoaders.has(src)) {
    return scriptLoaders.get(src);
  }

  const loader = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-external-src="${src}"]`);
    if (existing) {
      if (existing.dataset.loaded === 'true') {
        resolve();
        return;
      }
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error(`Failed to load script: ${src}`)), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.defer = true;
    script.dataset.externalSrc = src;
    script.crossOrigin = 'anonymous';
    script.onload = () => {
      script.dataset.loaded = 'true';
      resolve();
    };
    script.onerror = () => reject(new Error(`Failed to load script: ${src}`));
    document.head.appendChild(script);
  });

  scriptLoaders.set(src, loader);
  return loader;
}

export async function loadPeerJs() {
  await loadScriptOnce('https://cdn.jsdelivr.net/npm/peerjs@1.5.2/dist/peerjs.min.js');
  if (!window.Peer) {
    throw new Error('PeerJS loaded but window.Peer is unavailable.');
  }
  return window.Peer;
}

export async function loadNippleJs() {
  await loadScriptOnce('https://cdn.jsdelivr.net/npm/nipplejs@0.10.1/dist/nipplejs.min.js');
  if (!window.nipplejs) {
    throw new Error('NippleJS loaded but window.nipplejs is unavailable.');
  }
  return window.nipplejs;
}

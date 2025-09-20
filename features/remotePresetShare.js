/**
 * features/remotePresetShare.js
 *
 * Lightweight remote preset sharing for furniture presets.
 * - Exports initRemotePresetShare({ presets, multiplayer, toasts })
 * - Wraps presets.save to broadcast newly-saved presets to peers via multiplayer.send
 *
 * Design notes:
 * - Reads the same localStorage key used by the existing furniturePresets module:
 *   'ai_furniture_presets_v1' to obtain the saved payload after presets.save()
 * - On incoming 'presetShare' messages the app will merge the preset into localStorage
 *   and attempt to load it into the preview via window.furniturePresets.load(name).
 *
 * No top-level side-effects; call initRemotePresetShare(...) once after presets are available.
 */

export function initRemotePresetShare({ presets, multiplayer, toasts } = {}) {
  if (!presets) throw new Error('presets is required');
  if (!multiplayer) throw new Error('multiplayer is required');

  const STORAGE_KEY = 'ai_furniture_presets_v1';

  function _readStore() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) {
      console.error('remotePresetShare: failed to read store', e);
      return {};
    }
  }

  function _writeStore(store) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    } catch (e) {
      console.error('remotePresetShare: failed to write store', e);
    }
  }

  function broadcastPreset(name) {
    try {
      const store = _readStore();
      const entry = store?.[name];
      if (!entry || !entry.payload) return;
      const msg = {
        type: 'presetShare',
        from: multiplayer.getId?.() || 'unknown',
        name,
        payload: entry.payload,
        meta: { ts: Date.now() }
      };
      try { multiplayer.send(msg); } catch (e) { console.error('remotePresetShare: send failed', e); }
      try { toasts?.show?.(`Shared preset: ${name}`); } catch (e) {}
    } catch (e) {
      console.error('remotePresetShare: broadcast failed', e);
    }
  }

  // Wrap presets.save to broadcast after a successful save.
  if (presets && typeof presets.save === 'function') {
    const _origSave = presets.save.bind(presets);
    presets.save = function(name) {
      const res = _origSave(name);
      // Attempt best-effort broadcast; payload should be persisted to localStorage by save()
      try {
        const savedName = res || name;
        // Small timeout to allow the original save to flush localStorage
        setTimeout(() => {
          try { broadcastPreset(savedName); } catch (e) { /* best-effort */ }
        }, 50);
      } catch (e) {
        console.error('remotePresetShare: wrapped save failed', e);
      }
      return res;
    };
  }

  return {
    broadcastPreset,
  };
}

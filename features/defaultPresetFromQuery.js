/**
 * initDefaultPresetFromQuery
 *
 * - Reads URL query parameters `defaultPreset` or `preset`.
 *   Supported forms:
 *     - preset=NAME           -> looks up a saved preset by NAME and loads it
 *     - preset=payload:BASE64 -> BASE64 is JSON payload for a preset (will be saved under a generated name)
 *
 * - Persists per-player preference in localStorage under "ai_player_default_preset_v1".
 * - Attempts to apply once furniturePresets (window.furniturePresets) is available (polls up to timeout).
 * - Broadcasts a 'presetShare' message via multiplayer.send(...) when a payload preset is applied.
 *
 * No top-level side-effects. Call initDefaultPresetFromQuery(...) once after scene/app is ready.
 */

/**
 * Wait until window.furniturePresets is available (polling).
 * @param {number} timeoutMs
 * @returns {Promise<boolean>}
 */
function waitForPresets(timeoutMs = 5000) {
  const start = Date.now();
  return new Promise((resolve) => {
    if (typeof window === 'undefined') return resolve(false);
    if (window.furniturePresets) return resolve(true);
    const iv = setInterval(() => {
      if (window.furniturePresets) {
        clearInterval(iv);
        return resolve(true);
      }
      if (Date.now() - start > timeoutMs) {
        clearInterval(iv);
        return resolve(false);
      }
    }, 250);
  });
}

/**
 * Apply a preset string.
 * @param {string} presetStr
 * @param {object} opts
 */
async function applyPresetString(presetStr, { multiplayer, toasts, playerName } = {}) {
  if (!presetStr) return false;
  const PRESET_STORE_KEY = 'ai_furniture_presets_v1';
  const PLAYER_DEFAULT_KEY = 'ai_player_default_preset_v1';

  const ready = await waitForPresets(5000);
  if (!ready) {
    console.warn('furniturePresets not available to apply preset');
    return false;
  }

  try {
    // payload mode: payload:BASE64
    if (presetStr.startsWith('payload:')) {
      const b64 = presetStr.slice('payload:'.length);
      let json = null;
      try {
        json = atob(b64);
      } catch (e) {
        console.error('Failed to decode base64 preset payload', e);
        return false;
      }
      let payload = null;
      try {
        payload = JSON.parse(json);
      } catch (e) {
        console.error('Failed to parse preset JSON payload', e);
        return false;
      }

      // create a unique name and merge into the preset store
      const safePlayer = (playerName || 'guest').replace(/[^\w-]/g, '_').slice(0, 24) || 'guest';
      const name = `default_from_query_${safePlayer}_${Date.now()}`;

      try {
        const raw = localStorage.getItem(PRESET_STORE_KEY);
        const store = raw ? JSON.parse(raw) : {};
        store[name] = { payload, meta: { from: playerName || 'query', ts: Date.now() } };
        localStorage.setItem(PRESET_STORE_KEY, JSON.stringify(store));
      } catch (e) {
        console.error('Failed to merge preset into local store', e);
      }

      // Use the public API when available
      try {
        if (typeof window.furniturePresets?.load === 'function') {
          window.furniturePresets.load(name);
        }
      } catch (e) {
        console.error('furniturePresets.load failed', e);
      }

      // Broadcast to peers (so connected peers can optionally preview it)
      try {
        if (multiplayer && typeof multiplayer.send === 'function') {
          const meta = { from: (multiplayer.getId ? multiplayer.getId() : 'peer'), ts: Date.now() };
          multiplayer.send({ type: 'presetShare', name, payload, meta });
        }
      } catch (e) {
        console.error('Failed to broadcast presetShare to peers', e);
      }

      try { toasts?.show?.('Loaded default preset from URL'); } catch (e) {}
      // persist per-player default
      try {
        const mapRaw = localStorage.getItem(PLAYER_DEFAULT_KEY);
        const map = mapRaw ? JSON.parse(mapRaw) : {};
        map[playerName || 'guest'] = presetStr;
        localStorage.setItem(PLAYER_DEFAULT_KEY, JSON.stringify(map));
      } catch (e) {
        console.error('Failed to persist player default preset', e);
      }

      return true;
    }

    // name mode: try to load by name
    const name = presetStr;
    try {
      if (typeof window.furniturePresets?.load === 'function') {
        const res = window.furniturePresets.load(name);
        try { toasts?.show?.(`Loaded default preset: ${name}`); } catch (e) {}
        // persist per-player default
        try {
          const mapRaw = localStorage.getItem(PLAYER_DEFAULT_KEY);
          const map = mapRaw ? JSON.parse(mapRaw) : {};
          map[playerName || 'guest'] = presetStr;
          localStorage.setItem(PLAYER_DEFAULT_KEY, JSON.stringify(map));
        } catch (e) {
          console.error('Failed to persist player default preset', e);
        }
        return res;
      } else {
        console.warn('furniturePresets.load not available');
        return false;
      }
    } catch (e) {
      console.error('Failed to load preset by name', e);
      return false;
    }
  } catch (e) {
    console.error('applyPresetString unexpected error', e);
    return false;
  }
}

/**
 * Public init function.
 * @param {object} options
 */
export function initDefaultPresetFromQuery({ multiplayer = null, toasts = null, playerName = 'guest' } = {}) {
  if (typeof window === 'undefined') return;

  const params = new URLSearchParams(window.location.search);
  const presetParam = params.get('defaultPreset') || params.get('preset') || null;
  const PLAYER_DEFAULT_KEY = 'ai_player_default_preset_v1';

  // If query param provided, apply and persist
  if (presetParam) {
    try {
      // apply but don't block initialization
      applyPresetString(presetParam, { multiplayer, toasts, playerName }).catch(err => {
        console.error('applyPresetString failed', err);
      });
    } catch (e) {
      console.error('Failed to apply preset from query', e);
    }
    return;
  }

  // No query param -> try stored per-player default
  try {
    const raw = localStorage.getItem(PLAYER_DEFAULT_KEY);
    if (!raw) return;
    const map = JSON.parse(raw);
    const presetForPlayer = map[playerName] || map['guest'] || null;
    if (presetForPlayer) {
      applyPresetString(presetForPlayer, { multiplayer, toasts, playerName }).catch(err => {
        console.error('applyPresetString failed for stored default', err);
      });
    }
  } catch (e) {
    // ignore parse errors
  }
}

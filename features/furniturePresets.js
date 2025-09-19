/**
 * features/furniturePresets.js
 *
 * Small, resilient furniture placement presets system.
 *
 * - No top-level side-effects on import.
 * - Exposes initFurniturePresets({ furniturePlacement, furniturePreview, toasts })
 * - Stores presets in localStorage under a versioned key.
 *
 * UI: none added. Keyboard helpers are wired from app.js (KeyU = save, KeyI = load last).
 */

/**
 * @param {Object} deps
 * @param {Object} deps.furniturePlacement - optional main furniturePlacement controller
 * @param {Object} deps.furniturePreview - optional preview controller (expected to expose .group)
 * @param {Object} deps.toasts - optional toast manager with .show(text)
 */
export function initFurniturePresets({ furniturePlacement = null, furniturePreview = null, toasts = null } = {}) {
  const STORAGE_KEY = 'ai_furniture_presets_v1';
  let store = _loadStore();

  function _saveStore() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    } catch (e) {
      console.error('Failed to save furniture presets', e);
    }
  }

  function _loadStore() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return {};
      return JSON.parse(raw) || {};
    } catch (e) {
      return {};
    }
  }

  function _serializePreview() {
    // Use preview group when available; fall back to furniturePlacement.serialize() if provided.
    if (furniturePreview && furniturePreview.group) {
      const g = furniturePreview.group;
      return {
        type: 'preview-transform',
        position: [g.position.x, g.position.y, g.position.z],
        quaternion: [g.quaternion.x, g.quaternion.y, g.quaternion.z, g.quaternion.w],
        rotationY: g.rotation.y
      };
    }
    if (furniturePlacement && typeof furniturePlacement.serialize === 'function') {
      try {
        return { type: 'placement-serialized', data: furniturePlacement.serialize() };
      } catch (e) {
        console.error('furniturePlacement.serialize() failed', e);
      }
    }
    return null;
  }

  function _applyToPreview(data) {
    if (!data) return false;
    if (data.type === 'preview-transform' && furniturePreview && furniturePreview.group) {
      const g = furniturePreview.group;
      const p = data.position;
      const q = data.quaternion;
      try {
        g.position.set(p[0], p[1], p[2]);
        g.quaternion.set(q[0], q[1], q[2], q[3]);
        // ensure matrices update visually
        if (typeof g.updateMatrixWorld === 'function') g.updateMatrixWorld(true);
        return true;
      } catch (e) {
        console.error('Failed to apply preset to preview group', e);
        return false;
      }
    }
    if (data.type === 'placement-serialized' && furniturePlacement && typeof furniturePlacement.applyState === 'function') {
      try {
        furniturePlacement.applyState(data.data);
        return true;
      } catch (e) {
        console.error('furniturePlacement.applyState failed', e);
        return false;
      }
    }
    return false;
  }

  function list() {
    return Object.keys(store);
  }

  function save(name = null) {
    const payload = _serializePreview();
    if (!payload) {
      throw new Error('No furniture placement data available to save');
    }
    const key = name || `preset-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    store[key] = { created: Date.now(), payload };
    _saveStore();
    return key;
  }

  function remove(name) {
    if (store[name]) {
      delete store[name];
      _saveStore();
      return true;
    }
    return false;
  }

  function load(name) {
    const entry = store[name];
    if (!entry) return false;
    return _applyToPreview(entry.payload);
  }

  function loadLast() {
    const keys = Object.keys(store);
    if (!keys.length) return null;
    // find latest by created timestamp
    keys.sort((a, b) => (store[b].created || 0) - (store[a].created || 0));
    const latest = keys[0];
    const ok = load(latest);
    return ok ? latest : null;
  }

  // Public API
  const api = {
    list,
    save,
    load,
    loadLast,
    remove,
    _rawStore: () => store // test hook
  };

  // Friendly toast on init (non-intrusive)
  try {
    toasts?.show?.('Furniture presets available (U=save, I=load last)');
  } catch (e) {}

  return api;
}

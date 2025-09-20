/**
 * Lightweight Anchor Baker
 * Scans the scene for furniture-like objects and computes a simple "anchor" point
 * (bottom-center of the object's bounding box) and saves offsets to localStorage.
 *
 * Export: initAnchorBaker(THREE, { scene, playerModel, toasts })
 *
 * No top-level side-effects; safe to import. Small visual markers are added to the
 * scene briefly to make the bake visible when run.
 */

export function initAnchorBaker(THREE, { scene, playerModel, toasts } = {}) {
  if (!THREE) throw new Error('THREE is required');
  if (!scene) throw new Error('scene is required');

  const STORAGE_KEY = 'per_model_anchor_bakes_v1';

  function _loadStore() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
    } catch (e) {
      return {};
    }
  }

  function _saveStore(s) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    } catch (e) {
      console.error('anchorBaker: save failed', e);
    }
  }

  function _findFurnitureCandidates() {
    const list = [];
    scene.traverse(obj => {
      if (!obj || typeof obj !== 'object') return;
      const name = (obj.name || '').toLowerCase();
      if (name.includes('furniture') || name.includes('chair') || name.includes('preview') || name.includes('placement') || obj.userData?.isFurniture) {
        list.push(obj);
      }
    });
    return list;
  }

  function _computeAnchorForModel(model) {
    try {
      const bbox = new THREE.Box3().setFromObject(model);
      const center = bbox.getCenter(new THREE.Vector3());
      const anchorWorld = new THREE.Vector3(center.x, bbox.min.y, center.z);
      const anchorLocal = anchorWorld.clone().sub(model.position);
      return {
        offset: [anchorLocal.x, anchorLocal.y, anchorLocal.z],
        bbox: { min: bbox.min.toArray(), max: bbox.max.toArray() }
      };
    } catch (e) {
      console.error('anchorBaker: compute failed for', model, e);
      return null;
    }
  }

  function _placeMarkerAt(pos, color = 0x88ff88) {
    try {
      const geom = new THREE.SphereGeometry(0.08, 8, 6);
      const mat = new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: 0.6,
        transparent: true,
        opacity: 0.95,
        depthWrite: false
      });
      const m = new THREE.Mesh(geom, mat);
      m.name = 'anchor-baker-marker';
      m.position.copy(pos);
      m.renderOrder = 9999;
      scene.add(m);
      setTimeout(() => {
        try {
          scene.remove(m);
          m.geometry.dispose();
          m.material.dispose();
        } catch (e) { /* ignore */ }
      }, 6000);
      return m;
    } catch (e) {
      console.error('anchorBaker: failed to place marker', e);
      return null;
    }
  }

  async function bakeAll() {
    const candidates = _findFurnitureCandidates();
    const store = _loadStore();
    const results = [];

    for (const c of candidates) {
      const key = c.name || `model_${(c.uuid || Math.random().toString(36).slice(2))}`;
      const info = _computeAnchorForModel(c);
      if (info) {
        store[key] = { offset: info.offset, meta: { bakedAt: Date.now(), from: 'anchorBaker' } };
        results.push({ name: key, offset: info.offset });
        try {
          const worldAnchor = new THREE.Vector3().copy(c.position).add(new THREE.Vector3(...info.offset));
          _placeMarkerAt(worldAnchor);
        } catch (e) { /* ignore */ }
      }
    }

    _saveStore(store);

    // place a small confirmation marker above the player so the run is visible
    if (playerModel && playerModel.position) {
      const pos = playerModel.position.clone().add(new THREE.Vector3(0, 1.4, 0));
      _placeMarkerAt(pos, 0x66ccff);
    }

    if (results.length) {
      console.log('anchorBaker: baked', results);
      try { toasts?.show?.(`Anchor baker: baked ${results.length} model(s)`); } catch (e) {}
    } else {
      console.log('anchorBaker: no furniture candidates found');
      try { toasts?.show?.('Anchor baker: no furniture candidates found'); } catch (e) {}
    }

    return results;
  }

  function bakeModel(model) {
    if (!model) return null;
    const info = _computeAnchorForModel(model);
    if (!info) return null;
    const store = _loadStore();
    const key = model.name || `model_${(model.uuid || Math.random().toString(36).slice(2))}`;
    store[key] = { offset: info.offset, meta: { bakedAt: Date.now(), from: 'anchorBaker' } };
    _saveStore(store);
    const worldAnchor = new THREE.Vector3().copy(model.position).add(new THREE.Vector3(...info.offset));
    _placeMarkerAt(worldAnchor);
    return { name: key, offset: info.offset };
  }

  let active = true;
  return {
    bakeAll,
    bakeModel,
    setActive: (v) => { active = Boolean(v); },
    isActive: () => active
  };
}

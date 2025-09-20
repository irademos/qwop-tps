/**
 * features/perModelAnchors.js
 *
 * Small, lazy-loadable module that manages per-model anchor presets for heavy furniture.
 * - No top-level side effects on import.
 * - Export: initPerModelAnchors(THREE, { scene, furniturePlacement, furniturePreview })
 *
 * The controller:
 * - load/save presets to localStorage (key: per_model_anchors_v1)
 * - provides setPreset(name, preset), getPreset(name), applyPresetToGroup(group, preset)
 * - setActive(boolean) to enable/disable the runtime helper visuals and preview-integration.
 */

export function initPerModelAnchors(THREE, { scene = null, furniturePlacement = null, furniturePreview = null } = {}) {
  const STORAGE_KEY = 'per_model_anchors_v1';
  let store = _loadStore();
  let active = false;
  let helper = null;
  let origPreviewUpdate = null;

  function _loadStore() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return {};
      return JSON.parse(raw) || {};
    } catch (e) {
      return {};
    }
  }

  function _saveStore() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    } catch (e) {
      console.error('perModelAnchors: failed to save presets', e);
    }
  }

  function _normalizeName(name) {
    if (!name) return '';
    // strip path and extension
    return String(name).split('/').pop().replace(/\.[^.]+$/, '').toLowerCase();
  }

  function setPreset(name, preset) {
    if (!name || typeof preset !== 'object') return false;
    const key = _normalizeName(name);
    store[key] = Object.assign({}, preset);
    _saveStore();
    return true;
  }

  function getPreset(name) {
    if (!name) return null;
    return store[_normalizeName(name)] || null;
  }

  function applyPresetToGroup(group, preset) {
    if (!group || !preset) return false;
    // positionOffset: [x,y,z], rotationOffsetDeg: number
    try {
      if (Array.isArray(preset.positionOffset)) {
        group.position.x += Number(preset.positionOffset[0] || 0);
        group.position.y += Number(preset.positionOffset[1] || 0);
        group.position.z += Number(preset.positionOffset[2] || 0);
      }
      if (typeof preset.rotationOffsetDeg === 'number') {
        const rad = (preset.rotationOffsetDeg * Math.PI) / 180;
        group.rotateY(rad);
      }
      return true;
    } catch (e) {
      console.error('applyPresetToGroup failed', e);
      return false;
    }
  }

  function _detectPreviewModelKey(preview) {
    if (!preview) return null;
    // Common places modules store model identity
    const g = preview.group || preview.model || preview.scene || null;
    if (!g) return null;
    const candidateNames = [];
    if (g.userData && g.userData.modelName) candidateNames.push(g.userData.modelName);
    if (preview.modelName) candidateNames.push(preview.modelName);
    if (g.name) candidateNames.push(g.name);
    // inspect children
    for (let i = 0; i < (g.children?.length || 0); i++) {
      const c = g.children[i];
      if (c && c.name) candidateNames.push(c.name);
    }
    for (const n of candidateNames) {
      if (n) return _normalizeName(n);
    }
    return null;
  }

  function _ensureHelper() {
    if (helper || !THREE || !scene) return;
    // small visible anchor marker (non-intrusive)
    helper = new THREE.Group();
    helper.name = 'per-model-anchor-helper';
    const s = new THREE.Mesh(
      new THREE.SphereGeometry(0.06, 8, 6),
      new THREE.MeshStandardMaterial({ color: 0xffcc66, emissive: 0x663300, roughness: 0.8 })
    );
    s.castShadow = false;
    s.receiveShadow = false;
    s.renderOrder = 9999;
    helper.add(s);
    // subtle ring to indicate anchor plane
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.08, 0.12, 24),
      new THREE.MeshBasicMaterial({ color: 0xffcc66, transparent: true, opacity: 0.6, depthWrite: false })
    );
    ring.rotation.x = -Math.PI / 2;
    helper.add(ring);
    helper.visible = false;
    try { scene.add(helper); } catch (e) {}
  }

  function _attachToPreview(preview) {
    if (!preview || !preview.group) return;
    _ensureHelper();
    // Wrap preview.update so we can re-apply anchor per-frame and position helper
    try {
      if (!origPreviewUpdate) origPreviewUpdate = preview.update?.bind(preview);
      const self = this;
      preview.update = function(delta) {
        if (typeof origPreviewUpdate === 'function') origPreviewUpdate(delta);
        try {
          const key = _detectPreviewModelKey(preview);
          const preset = key ? getPreset(key) : null;
          // Reset helper visibility and position
          if (helper) helper.visible = false;
          if (preset) {
            // Apply preset non-destructively by nudging the group's position each frame
            // (furniture placement preview usually resets transforms elsewhere).
            try {
              // Apply anchor visually
              helper.visible = true;
              const pos = preview.group.position;
              // compute anchor world position (group local + preset offset)
              const off = preset.positionOffset || [0, 0, 0];
              helper.position.set(pos.x + off[0], pos.y + off[1], pos.z + off[2]);
              // keep helper small and always above ground
              helper.scale.setScalar(1);
              // Apply the preset to the preview group (best-effort; this is additive)
              applyPresetToGroup(preview.group, preset);
            } catch (e) {
              // ignore per-frame apply errors
            }
          }
        } catch (e) {}
      };
    } catch (e) {
      // ignore
    }
  }

  function setActive(v = true) {
    active = Boolean(v);
    if (active) {
      if (furniturePreview && furniturePreview.group) {
        _attachToPreview(furniturePreview);
      }
      _ensureHelper();
    } else {
      // teardown: restore preview.update if we wrapped it
      try {
        if (furniturePreview && origPreviewUpdate && typeof furniturePreview.update === 'function') {
          furniturePreview.update = origPreviewUpdate;
        }
      } catch (e) {}
      if (helper && helper.parent) {
        try { helper.parent.remove(helper); } catch (e) {}
        helper = null;
      }
    }
  }

  function destroy() {
    setActive(false);
    store = {};
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
  }

  return {
    setActive,
    setPreset,
    getPreset,
    applyPresetToGroup,
    destroy
  };
}

/**
 * features/snapToSurfaceModelOverrides.js
 *
 * Export a small, lazy-init controller that enables per-model overrides for
 * snap-to-surface behaviour used by the furniture preview system.
 *
 * - No top-level side-effects on import.
 * - Call initSnapToSurfaceModelOverrides(...) to create a controller instance.
 *
 * The controller exposes:
 * - setOverride(modelName, { positionOffset, rotationSnapDeg })
 * - clearOverride(modelName)
 * - setActive(bool)
 * - update(delta)  // should be called from the main animate loop (best-effort)
 * - destroy()
 *
 * The implementation attempts to detect the preview's current model name from
 * a few common properties (furniturePreview.getModelName, furniturePreview.modelName,
 * furniturePreview.group.children[0].name, etc). When an override matches it
 * applies a small position offset and (optionally) requests rotation snapping
 * via furniturePreview.snapRotation(deg) if available.
 */

export function initSnapToSurfaceModelOverrides(THREE, { scene, furniturePreview } = {}) {
  if (!THREE) throw new Error('THREE is required');

  let active = false;
  const overrides = new Map(); // modelName -> opts
  let helperSprite = null;
  let lastMatched = null;

  function _makeCanvasTexture(textLines = []) {
    const w = 320;
    const h = 80;
    const dpr = 1;
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    // Background
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, 0, w, h);
    // Text
    ctx.fillStyle = '#88eeff';
    ctx.font = '14px monospace';
    ctx.textBaseline = 'top';
    for (let i = 0; i < textLines.length; i++) {
      ctx.fillText(textLines[i], 8, 8 + i * 18);
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.minFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    return tex;
  }

  function _createHelperSprite() {
    const mat = new THREE.SpriteMaterial({ map: _makeCanvasTexture(['Snap Overrides: 0']), depthTest: false });
    const spr = new THREE.Sprite(mat);
    spr.scale.set(1.8, 0.45, 1.0);
    // place high above origin by default; when preview is present we will move it near preview
    spr.position.set(0, 6, 0);
    spr.renderOrder = 9999;
    return spr;
  }

  function _updateLabel() {
    if (!helperSprite) return;
    const lines = [`SnapOverrides: ${overrides.size}`];
    if (lastMatched) lines.push(`active: ${lastMatched}`);
    else lines.push('active: none');
    // replace texture
    try {
      const tex = _makeCanvasTexture(lines);
      const old = helperSprite.material.map;
      helperSprite.material.map = tex;
      helperSprite.material.needsUpdate = true;
      if (old) old.dispose && old.dispose();
    } catch (e) {
      // ignore UI failures
    }
  }

  function detectPreviewModelName() {
    if (!furniturePreview) return null;
    try {
      if (typeof furniturePreview.getModelName === 'function') {
        const n = furniturePreview.getModelName();
        if (n) return n;
      }
      if (typeof furniturePreview.modelName === 'string' && furniturePreview.modelName) return furniturePreview.modelName;
      const g = furniturePreview.group;
      if (g) {
        if (g.userData && g.userData.modelName) return g.userData.modelName;
        if (g.children && g.children.length) {
          const c = g.children[0];
          if (typeof c.name === 'string' && c.name) return c.name;
          if (c.userData && c.userData.modelName) return c.userData.modelName;
        }
      }
    } catch (e) {
      // best-effort
    }
    return null;
  }

  function applyOverrideIfNeeded() {
    if (!furniturePreview || !furniturePreview.group) {
      lastMatched = null;
      _updateLabel();
      return;
    }

    const name = detectPreviewModelName();
    if (!name) {
      lastMatched = null;
      _updateLabel();
      return;
    }

    // Try direct matches and common derivations (basename)
    const tryKeys = [name, name.toLowerCase(), name.split('/').pop(), name.split('/').pop().toLowerCase()];
    let match = null;
    for (const k of tryKeys) {
      if (overrides.has(k)) { match = overrides.get(k); break; }
    }

    if (!match) {
      lastMatched = null;
      _updateLabel();
      return;
    }

    lastMatched = name;

    const g = furniturePreview.group;
    // remember original y to avoid cumulative drift
    if (g.userData && typeof g.userData._snapOriginalY === 'undefined') {
      g.userData._snapOriginalY = g.position.y;
    }
    const baseY = (g.userData && typeof g.userData._snapOriginalY === 'number') ? g.userData._snapOriginalY : g.position.y;

    if (typeof match.positionOffset === 'number') {
      g.position.y = baseY + match.positionOffset;
    }

    if (typeof match.rotationSnapDeg === 'number' && typeof furniturePreview.snapRotation === 'function') {
      try {
        furniturePreview.snapRotation(match.rotationSnapDeg);
      } catch (e) { /* ignore if preview doesn't support it */ }
    }

    // Move helper sprite near the preview for visibility
    if (helperSprite && g) {
      const worldPos = new THREE.Vector3();
      g.getWorldPosition(worldPos);
      helperSprite.position.copy(worldPos).add(new THREE.Vector3(0, 1.8, 0));
    }

    _updateLabel();
  }

  function update() {
    if (!active) return;
    try {
      applyOverrideIfNeeded();
    } catch (e) {
      // never let errors bubble into the main loop
      console.error('model snap overrides update failed', e);
    }
  }

  function setOverride(modelName, opts = {}) {
    if (!modelName) return;
    overrides.set(modelName, Object.assign({}, opts));
    _updateLabel();
  }

  function clearOverride(modelName) {
    overrides.delete(modelName);
    _updateLabel();
  }

  function setActive(val = true) {
    const next = !!val;
    if (next === active) return;
    active = next;
    if (active) {
      if (!helperSprite) helperSprite = _createHelperSprite();
      try { scene && scene.add && scene.add(helperSprite); } catch (e) {}
      _updateLabel();
      // run one immediate application pass
      applyOverrideIfNeeded();
    } else {
      if (helperSprite && helperSprite.parent) {
        try { helperSprite.parent.remove(helperSprite); } catch (e) {}
      }
    }
  }

  function destroy() {
    if (helperSprite) {
      try {
        helperSprite.material.map && helperSprite.material.map.dispose();
        helperSprite.material.dispose();
        helperSprite.parent && helperSprite.parent.remove(helperSprite);
      } catch (e) {}
      helperSprite = null;
    }
    overrides.clear();
    active = false;
  }

  // Return a compact API; consumer should call update(delta) from animate when available.
  return {
    setActive,
    setOverride,
    clearOverride,
    update,
    destroy,
    getOverrides: () => new Map(overrides)
  };

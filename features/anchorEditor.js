/**
 * features/anchorEditor.js
 *
 * Small visual editor for per-model anchor offsets.
 * - No top-level side-effects.
 * - Export initAnchorEditor(THREE, { scene, camera, renderer })
 *
 * Controls (no on-screen buttons):
 * - Click a visible mesh in the renderer to select it.
 * - Arrow keys to nudge X/Y, PageUp/PageDown to nudge Z.
 * - +/- to change step size (small increments).
 * - Escape to deselect.
 *
 * Persisted to localStorage under "per_model_anchor_offsets_v1".
 */

export function initAnchorEditor(THREE, { scene, camera, renderer } = {}) {
  if (!THREE) throw new Error('THREE is required');
  if (!scene) throw new Error('scene is required');
  if (!camera) throw new Error('camera is required');
  if (!renderer || !renderer.domElement) throw new Error('renderer with domElement is required');

  const STORAGE_KEY = 'per_model_anchor_offsets_v1';
  let store = _loadStore();

  const root = new THREE.Group();
  root.name = 'per-model-anchor-editor';
  scene.add(root);

  const anchorMat = new THREE.MeshStandardMaterial({
    color: 0xffcc66,
    emissive: 0x442200,
    roughness: 0.6,
    metalness: 0.0,
    transparent: true,
    opacity: 0.95,
    depthWrite: false
  });

  const anchorGeom = new THREE.SphereGeometry(0.06, 8, 6);
  const anchorSphere = new THREE.Mesh(anchorGeom, anchorMat);
  anchorSphere.renderOrder = 999;
  anchorSphere.visible = false;
  root.add(anchorSphere);

  // small axis helper lines for visual affordance
  const axes = new THREE.AxesHelper(0.4);
  axes.visible = false;
  root.add(axes);

  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2();

  let active = false;
  let selected = null;
  let offset = new THREE.Vector3(0, 0, 0);
  let step = 0.02;

  // DOM label
  let label = null;
  function ensureLabel() {
    if (label) return;
    label = document.createElement('div');
    label.className = 'fa-anchor-editor-label';
    label.style.position = 'absolute';
    label.style.padding = '6px 8px';
    label.style.background = 'rgba(0,0,0,0.6)';
    label.style.color = '#fff';
    label.style.fontFamily = 'monospace';
    label.style.fontSize = '12px';
    label.style.borderRadius = '6px';
    label.style.pointerEvents = 'none';
    label.style.zIndex = '9999';
    document.body.appendChild(label);

    // scoped style for small highlight (keeps global selectors safe)
    if (!document.getElementById('fa-anchor-editor-style')) {
      const s = document.createElement('style');
      s.id = 'fa-anchor-editor-style';
      s.textContent = `
        .fa-anchor-editor-label.hide { display: none; }
      `;
      document.head.appendChild(s);
    }
  }

  function _loadStore() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return {};
      return JSON.parse(raw);
    } catch (e) { return {}; }
  }

  function _saveStore() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    } catch (e) { /* ignore quota errors */ }
  }

  function keyForObject(obj) {
    // Prefer stable name if available, otherwise fallback to uuid
    return (obj && obj.name) ? `name:${obj.name}` : `uuid:${obj.uuid}`;
  }

  function applyOffsetToSphere() {
    if (!selected) {
      anchorSphere.visible = false;
      axes.visible = false;
      if (label) label.classList.add('hide');
      return;
    }
    const worldPos = new THREE.Vector3();
    selected.getWorldPosition(worldPos);
    const worldOffset = worldPos.clone().add(offset);
    anchorSphere.position.copy(worldOffset);
    axes.position.copy(worldOffset);
    anchorSphere.visible = true;
    axes.visible = true;
    ensureLabel();
    label.classList.remove('hide');
    label.textContent = `${selected.name || selected.type}\noffset: ${offset.x.toFixed(3)}, ${offset.y.toFixed(3)}, ${offset.z.toFixed(3)}\nstep: ${step}`;
  }

  function projectLabel() {
    if (!selected || !label) return;
    const pos = anchorSphere.position.clone();
    pos.project(camera);
    const x = (pos.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-pos.y * 0.5 + 0.5) * window.innerHeight;
    label.style.left = `${Math.round(x)}px`;
    label.style.top = `${Math.round(y - 30)}px`;
  }

  function onClick(e) {
    if (!active) return;
    const rect = renderer.domElement.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    mouse.set(x, y);
    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(scene.children, true)
      .filter(i => {
        const n = i.object.name || '';
        return !n.includes('per-model-anchor-editor') && i.object.visible;
      });
    if (!intersects.length) return;
    // pick the first visible object with a parent that's not the scene root or helper
    let obj = intersects[0].object;
    // climb to find a reasonable root (stop at scene)
    while (obj.parent && obj.parent !== scene && obj.parent.type !== 'Scene' && obj.parent.name && obj.parent.name !== '') {
      // if parent has a name, treat it as candidate (helps with grouped models)
      if (obj.parent.name && obj.parent.name !== '') {
        obj = obj.parent;
        break;
      }
      obj = obj.parent;
    }

    selected = obj;
    const key = keyForObject(selected);
    const saved = store[key];
    if (saved && Array.isArray(saved)) {
      offset.set(saved[0], saved[1], saved[2]);
    } else {
      offset.set(0, 0, 0);
    }
    applyOffsetToSphere();
    projectLabel();
  }

  function onKey(e) {
    if (!active || !selected) return;
    let changed = false;
    if (e.key === 'Escape') {
      selected = null;
      applyOffsetToSphere();
      return;
    }
    // Change step
    if (e.key === '+' || e.key === '=') {
      step = Math.min(0.5, step * 2);
      applyOffsetToSphere();
      return;
    }
    if (e.key === '-' || e.key === '_') {
      step = Math.max(0.0025, step / 2);
      applyOffsetToSphere();
      return;
    }

    switch (e.code) {
      case 'ArrowUp':
        offset.y += step; changed = true; break;
      case 'ArrowDown':
        offset.y -= step; changed = true; break;
      case 'ArrowLeft':
        offset.x -= step; changed = true; break;
      case 'ArrowRight':
        offset.x += step; changed = true; break;
      case 'PageUp':
        offset.z += step; changed = true; break;
      case 'PageDown':
        offset.z -= step; changed = true; break;
      default:
        break;
    }
    if (changed) {
      const key = keyForObject(selected);
      store[key] = [offset.x, offset.y, offset.z];
      _saveStore();
      applyOffsetToSphere();
      projectLabel();
    }
  }

  function onResize() {
    projectLabel();
  }

  function setActive(v = true) {
    if (v === active) return;
    active = Boolean(v);
    if (active) {
      renderer.domElement.addEventListener('click', onClick);
      window.addEventListener('keydown', onKey);
      window.addEventListener('resize', onResize);
      ensureLabel();
      label.classList.add('hide');
    } else {
      renderer.domElement.removeEventListener('click', onClick);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
      selected = null;
      applyOffsetToSphere();
      if (label && label.parentNode) label.parentNode.removeChild(label);
      label = null;
    }
  }

  function update(/* delta */) {
    if (!active) return;
    if (selected) {
      // Keep anchor sphere in sync in case the model animates/moves.
      applyOffsetToSphere();
      projectLabel();
    }
  }

  function destroy() {
    setActive(false);
    try {
      scene.remove(root);
      anchorGeom.dispose();
      // material may be shared; best-effort
      if (anchorMat.dispose) anchorMat.dispose();
    } catch (e) {}
  }

  return {
    setActive,
    update,
    destroy
  };
}

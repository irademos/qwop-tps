/**
 * features/furniturePlacement.js
 *
 * Simple, lightweight furniture placement demo.
 *
 * Usage:
 *  - Init via initFurniturePlacement(THREE, { scene, playerModel })
 *  - Toggle active preview with `P`
 *  - Cycle furniture with `L`
 *  - Place furniture with `F`
 *  - Rotate preview with `R`
 *
 * No top-level side-effects on import. All DOM/scene changes only after init()
 */

export function initFurniturePlacement(THREE, { scene, playerModel, toasts } = {}) {
  if (!THREE) throw new Error('THREE is required');
  if (!scene) throw new Error('scene is required');
  if (!playerModel) throw new Error('playerModel is required');

  const placed = new THREE.Group();
  placed.name = 'furniture-placed';
  scene.add(placed);

  const prototypes = createPrototypes(THREE);
  let selected = 0;

  // preview mesh (will be replaced/cloned from prototypes)
  let preview = prototypes[selected].clone();
  preview.name = 'furniture-preview';
  applyPreviewMaterial(preview);
  scene.add(preview);

  let active = false;
  let raf = null;
  let rotation = 0;

  function applyPreviewMaterial(mesh) {
    mesh.traverse((m) => {
      if (m.isMesh) {
        const mat = m.material ? m.material.clone() : new THREE.MeshStandardMaterial();
        mat.transparent = true;
        mat.opacity = 0.6;
        mat.roughness = 0.8;
        mat.metalness = 0.0;
        m.material = mat;
        m.renderOrder = 999;
      }
    });
  }

  function createPrototypes(THREE) {
    // Table
    const table = new THREE.Group();
    const topGeo = new THREE.BoxGeometry(1.4, 0.08, 0.9);
    const topMat = new THREE.MeshStandardMaterial({ color: 0x8b5a2b });
    const top = new THREE.Mesh(topGeo, topMat);
    top.position.y = 0.6;
    table.add(top);
    const legGeo = new THREE.BoxGeometry(0.08, 0.6, 0.08);
    for (let i = 0; i < 4; i++) {
      const leg = new THREE.Mesh(legGeo, topMat);
      leg.position.set(i < 2 ? -0.62 : 0.62, 0.3, i % 2 ? -0.38 : 0.38);
      table.add(leg);
    }

    // Chair
    const chair = new THREE.Group();
    const seatGeo = new THREE.BoxGeometry(0.5, 0.06, 0.5);
    const chairMat = new THREE.MeshStandardMaterial({ color: 0x5c3a21 });
    const seat = new THREE.Mesh(seatGeo, chairMat);
    seat.position.y = 0.35;
    chair.add(seat);
    const backGeo = new THREE.BoxGeometry(0.5, 0.6, 0.08);
    const back = new THREE.Mesh(backGeo, chairMat);
    back.position.set(0, 0.7, -0.21);
    chair.add(back);
    const cLegGeo = new THREE.BoxGeometry(0.06, 0.35, 0.06);
    for (let i = 0; i < 4; i++) {
      const leg = new THREE.Mesh(cLegGeo, chairMat);
      leg.position.set(i < 2 ? -0.22 : 0.22, 0.175, i % 2 ? -0.22 : 0.22);
      chair.add(leg);
    }

    // Crate
    const crateMat = new THREE.MeshStandardMaterial({ color: 0x997950 });
    const crate = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.6), crateMat);
    crate.position.y = 0.3;

    return [table, chair, crate];
  }

  function updatePreviewPosition() {
    if (!preview || !playerModel) return;
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(playerModel.quaternion).normalize();
    const target = playerModel.position.clone().add(forward.multiplyScalar(2.0));
    // keep on same ground Y as player (simple)
    target.y = playerModel.position.y;
    // smooth-follow
    preview.position.lerp(target, 0.3);
    preview.rotation.y = rotation + playerModel.rotation.y;
  }

  function placeAtPreview() {
    if (!preview) return;
    const placedMesh = preview.clone(true);
    // solidify materials for placed object
    placedMesh.traverse((m) => {
      if (m.isMesh) {
        const mat = m.material ? m.material.clone() : new THREE.MeshStandardMaterial();
        mat.transparent = false;
        mat.opacity = 1.0;
        m.material = mat;
        m.castShadow = true;
        m.receiveShadow = true;
      }
    });
    placed.add(placedMesh);
    // give a subtle scale/pop animation (time-limited)
    placedMesh.scale.setScalar(0.001);
    const start = performance.now();
    const grow = (t) => {
      const p = Math.min(1, (performance.now() - start) / 220);
      const s = 0.9 + 0.1 * p;
      placedMesh.scale.set(s, s, s);
      if (p < 1) requestAnimationFrame(grow);
    };
    requestAnimationFrame(grow);

    if (toasts && typeof toasts.show === 'function') {
      toasts.show('Placed furniture');
    }
  }

  function cycle(next = true) {
    selected = (selected + (next ? 1 : -1) + prototypes.length) % prototypes.length;
    // remove old preview
    if (preview && preview.parent) {
      scene.remove(preview);
      preview.traverse((m) => { if (m.isMesh) { m.geometry?.dispose?.(); m.material?.dispose?.(); } });
    }
    preview = prototypes[selected].clone();
    applyPreviewMaterial(preview);
    preview.name = 'furniture-preview';
    scene.add(preview);
  }

  function rotatePreviewCW() {
    rotation += Math.PI / 4;
  }

  function handleKeyDown(e) {
    if (!active) {
      // allow quick toggle
      if (e.code === 'KeyP') {
        setActive(true);
      }
      return;
    }
    if (e.code === 'KeyP') {
      setActive(false);
      return;
    }
    if (e.code === 'KeyL') {
      cycle(true);
      return;
    }
    if (e.code === 'KeyF') {
      placeAtPreview();
      return;
    }
    if (e.code === 'KeyR') {
      rotatePreviewCW();
      return;
    }
  }

  function loop() {
    updatePreviewPosition();
    raf = requestAnimationFrame(loop);
  }

  function setActive(v) {
    if (v === active) return;
    active = !!v;
    if (active) {
      window.addEventListener('keydown', handleKeyDown);
      // show preview
      if (!preview.parent) scene.add(preview);
      // start loop
      if (!raf) loop();
    } else {
      window.removeEventListener('keydown', handleKeyDown);
      // hide preview
      if (preview && preview.parent) scene.remove(preview);
      if (raf) {
        cancelAnimationFrame(raf);
        raf = null;
      }
    }
  }

  function dispose() {
    setActive(false);
    // remove placed objects
    if (placed.parent) scene.remove(placed);
    placed.traverse((m) => {
      if (m.isMesh) {
        m.geometry?.dispose?.();
        m.material?.dispose?.();
      }
    });
    preview?.traverse?.((m) => {
      if (m.isMesh) {
        m.geometry?.dispose?.();
        m.material?.dispose?.();
      }
    });
  }

  // By default, keep preview disabled. Caller decides activation.
  return {
    setActive,
    dispose,
    isActive: () => active,
    cycleNext: () => cycle(true),
    place: () => placeAtPreview()
  };
}

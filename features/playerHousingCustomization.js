/**
 * Player Housing Customization
 *
 * - Adds a small customizable house near the player (no UI buttons).
 * - Keyboard controls:
 *    H -> cycle wall color
 *    K -> cycle roof style
 *
 * Exports: initPlayerHousingCustomization(THREE, { scene, playerModel, playerHousing })
 *
 * No top-level side-effects.
 */

export function initPlayerHousingCustomization(THREE, { scene, playerModel, playerHousing } = {}) {
  if (!THREE) throw new Error('THREE is required');
  if (!scene) throw new Error('scene is required');
  if (!playerModel) throw new Error('playerModel is required');

  const root = new THREE.Group();
  root.name = 'player-housing-custom';
  let active = false;

  // Simple palette + roof styles
  const COLORS = [0xa0522d, 0x8b4513, 0xffd27f, 0x7fbf7f, 0xb0c4de];
  const ROOF_TYPES = ['gable', 'flat'];

  let colorIdx = 0;
  let roofIdx = 0;

  let wallsMesh = null;
  let roofMesh = null;
  let baseMesh = null;

  // Helpers
  function disposeMesh(m) {
    if (!m) return;
    try {
      if (m.geometry) m.geometry.dispose();
      if (m.material) {
        if (Array.isArray(m.material)) {
          m.material.forEach(mat => mat.dispose && mat.dispose());
        } else {
          m.material.dispose && m.material.dispose();
        }
      }
    } catch (e) {}
  }

  function removeAll() {
    while (root.children.length) {
      const c = root.children.pop();
      disposeMesh(c);
      // Three will take care of removing from scene when root removed
    }
  }

  function buildRoof(type) {
    if (roofMesh) {
      root.remove(roofMesh);
      disposeMesh(roofMesh);
      roofMesh = null;
    }

    if (type === 'gable') {
      // Use a pyramid-like roof (scaled cone with 4 segments) for a simple gable look
      const geo = new THREE.ConeGeometry(1.15, 0.7, 4);
      geo.rotateY(Math.PI / 4);
      roofMesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.6 }));
      roofMesh.position.y = 1.3;
    } else {
      // flat roof: thin box
      const geo = new THREE.BoxGeometry(1.9, 0.14, 1.6);
      roofMesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.6 }));
      roofMesh.position.y = 1.05;
    }
    roofMesh.receiveShadow = false;
    roofMesh.castShadow = true;
    root.add(roofMesh);
  }

  function build() {
    removeAll();

    // Base platform
    const baseGeo = new THREE.BoxGeometry(2.0, 0.06, 1.7);
    baseMesh = new THREE.Mesh(baseGeo, new THREE.MeshStandardMaterial({ color: 0x5c3b2e, roughness: 0.8 }));
    baseMesh.position.y = 0.03;
    root.add(baseMesh);

    // Walls
    const wallGeo = new THREE.BoxGeometry(1.8, 1.2, 1.5);
    const wallMat = new THREE.MeshStandardMaterial({ color: COLORS[colorIdx], roughness: 0.8 });
    wallsMesh = new THREE.Mesh(wallGeo, wallMat);
    wallsMesh.position.y = 0.6;
    wallsMesh.castShadow = true;
    wallsMesh.receiveShadow = true;
    root.add(wallsMesh);

    // Door (simple inset)
    const doorGeo = new THREE.BoxGeometry(0.4, 0.7, 0.02);
    const door = new THREE.Mesh(doorGeo, new THREE.MeshStandardMaterial({ color: 0x2b160a }));
    door.position.set(0, 0.35, 0.76);
    root.add(door);

    // Roof
    buildRoof(ROOF_TYPES[roofIdx]);
  }

  function updatePosition() {
    try {
      if (playerHousing && playerHousing.root && playerHousing.root.position) {
        root.position.copy(playerHousing.root.position).add(new THREE.Vector3(2.4, 0, 0));
      } else {
        root.position.copy(playerModel.position).add(new THREE.Vector3(3, 0, 0));
      }
      root.position.y = Math.max(0, root.position.y);
    } catch (e) {}
  }

  function applyNextColor() {
    colorIdx = (colorIdx + 1) % COLORS.length;
    if (wallsMesh && wallsMesh.material) {
      wallsMesh.material.color.setHex(COLORS[colorIdx]);
      wallsMesh.material.needsUpdate = true;
    }
  }

  function applyNextRoof() {
    roofIdx = (roofIdx + 1) % ROOF_TYPES.length;
    buildRoof(ROOF_TYPES[roofIdx]);
  }

  function onKey(e) {
    if (!active) return;
    if (e.code === 'KeyH') {
      applyNextColor();
    } else if (e.code === 'KeyK') {
      applyNextRoof();
    }
  }

  // Public API
  function setActive(on) {
    if (on === active) return;
    active = !!on;
    if (active) {
      // ensure placed in scene
      if (!root.parent) scene.add(root);
      updatePosition();
      build();
      window.addEventListener('keydown', onKey);
    } else {
      window.removeEventListener('keydown', onKey);
      if (root.parent) root.parent.remove(root);
      removeAll();
    }
  }

  function update(delta) {
    if (!active) return;
    // gently bob the house for a subtle alive feel
    const t = performance.now() * 0.001;
    root.rotation.y = Math.sin(t * 0.2) * 0.02;
    updatePosition();
  }

  function dispose() {
    setActive(false);
    removeAll();
  }

  // return controller (no side-effects until setActive(true) called)
  return {
    setActive,
    update,
    dispose
  };
}

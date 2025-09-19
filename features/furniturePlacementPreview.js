/**
 * Lightweight in-world furniture placement preview.
 * - No top-level side-effects on import.
 * - Exports initFurniturePlacementPreview(THREE, options) which returns a controller:
 *   { setActive(bool), update(delta), dispose() }
 *
 * Controls (best-effort, non-invasive):
 * - R rotates preview by ~22.5deg
 * - F attempts to "place" via furniturePlacement.placeAt(...) or furniturePlacement.placeCurrentAt(...)
 * - P toggles preview visibility
 *
 * The module is defensive: it will not throw if the main furniturePlacement module
 * doesn't expose placement helpers. It only creates a translucent ghost mesh and
 * follows the player at ~2m in front so placement can be visually verified.
 */

export function initFurniturePlacementPreview(THREE, { scene, playerModel, furniturePlacement } = {}) {
  if (!THREE) throw new Error('THREE is required');
  if (!scene) throw new Error('scene is required');
  // playerModel is optional but preview will be inert without it

  const ROOT_NAME = 'furniture-placement-preview';
  const group = new THREE.Group();
  group.name = ROOT_NAME;

  // Simple ghost geometry/material (cheap). Sized to be clearly visible as a "furniture" placeholder.
  const geom = new THREE.BoxGeometry(1.2, 0.8, 0.8);
  const mat = new THREE.MeshStandardMaterial({
    color: 0x88ccff,
    transparent: true,
    opacity: 0.35,
    depthWrite: false,
    roughness: 0.7,
    metalness: 0.0
  });
  const ghost = new THREE.Mesh(geom, mat);
  ghost.castShadow = false;
  ghost.receiveShadow = false;
  ghost.name = 'furniture-ghost';
  group.add(ghost);
  group.visible = true;
  scene.add(group);

  let active = true;
  let rotationY = 0;

  function update(delta) {
    if (!active || !playerModel) return;
    try {
      // Place the ghost ~2 meters in front of the player's facing direction, slightly above ground
      const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(playerModel.quaternion).normalize();
      const pos = playerModel.position.clone().add(forward.multiplyScalar(2)).setY(playerModel.position.y + 0.5);
      group.position.copy(pos);
      group.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotationY);
    } catch (e) {
      // defensive: swallow errors so preview never breaks main loop
      console.error('furniturePreview.update error', e);
    }
  }

  function tryPlace() {
    const pos = group.position.clone();
    const rot = group.rotation.y;
    // Try known placement hooks on the main module (best-effort)
    try {
      if (furniturePlacement && typeof furniturePlacement.placeAt === 'function') {
        furniturePlacement.placeAt(pos, rot);
        return;
      }
      if (furniturePlacement && typeof furniturePlacement.placeCurrentAt === 'function') {
        furniturePlacement.placeCurrentAt(pos, rot);
        return;
      }
      // Fallback: if furniturePlacement exposes an `addFurniture` helper that accepts an object
      if (furniturePlacement && typeof furniturePlacement.addFurniture === 'function') {
        furniturePlacement.addFurniture({ position: pos, rotation: rot });
        return;
      }
    } catch (e) {
      // ignore errors from the external module
      console.error('furniturePreview.place failed', e);
    }
    // If no placement hook found, create a simple permanent mesh in the scene as demo placement
    try {
      const placedMat = mat.clone();
      placedMat.opacity = 1.0;
      placedMat.depthWrite = true;
      const placedGeom = geom.clone();
      const mesh = new THREE.Mesh(placedGeom, placedMat);
      mesh.position.copy(pos);
      mesh.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot);
      scene.add(mesh);
      // auto-cleanup after some time so demo remains light-weight
      setTimeout(() => {
        try { scene.remove(mesh); mesh.geometry.dispose(); mesh.material.dispose(); } catch (e) {}
      }, 30_000);
    } catch (e) {
      // final fallback: do nothing
    }
  }

  function onKey(e) {
    if (!e || !e.code) return;
    if (e.code === 'KeyR') {
      rotationY += (Math.PI / 8); // rotate ~22.5deg
    } else if (e.code === 'KeyF') {
      tryPlace();
    } else if (e.code === 'KeyP') {
      active = !active;
      group.visible = active;
    }
  }
  window.addEventListener('keydown', onKey);

  function setActive(v) {
    active = !!v;
    group.visible = !!v;
  }

  function dispose() {
    window.removeEventListener('keydown', onKey);
    try {
      if (group.parent) group.parent.remove(group);
    } catch (e) {}
    try { geom.dispose(); } catch (e) {}
    try { mat.dispose(); } catch (e) {}
  }

  return { setActive, update, dispose };

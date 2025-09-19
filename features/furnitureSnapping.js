/**
 * features/furnitureSnapping.js
 *
 * Visual snapping grid for furniture placement.
 * - No top-level side-effects on import.
 * - Export initFurnitureSnapping(THREE, { scene, playerModel, gridSize, gridExtent })
 *
 * Returns a controller with:
 *  - setActive(bool)
 *  - snapPosition(vec3) -> new THREE.Vector3
 *  - setPosition(vec3)
 *  - update(delta)
 *  - dispose()
 */

export function initFurnitureSnapping(THREE, { scene, playerModel, gridSize = 0.5, gridExtent = 12 } = {}) {
  if (!THREE) throw new Error('THREE is required');
  if (!scene) throw new Error('scene is required');
  if (!playerModel) throw new Error('playerModel is required');

  const group = new THREE.Group();
  group.name = 'furniture-snapping-grid';
  let active = false;

  // Build a subtle GridHelper that can be shown/hidden.
  const divisions = Math.max(4, Math.floor((gridExtent * 2) / gridSize));
  const size = gridExtent * 2;
  const grid = new THREE.GridHelper(size, divisions, 0x66ccff, 0x2a2a2a);
  grid.material = grid.material.clone();
  grid.material.opacity = 0.65;
  grid.material.transparent = true;
  grid.renderOrder = 999;
  grid.visible = false;

  // Thin, low-profile pending-placement indicator (a semi-transparent plane)
  const planeGeo = new THREE.PlaneGeometry(1, 1);
  const planeMat = new THREE.MeshBasicMaterial({ color: 0x66ccff, transparent: true, opacity: 0.08, depthWrite: false });
  const plane = new THREE.Mesh(planeGeo, planeMat);
  plane.rotation.x = -Math.PI / 2;
  plane.visible = false;
  plane.name = 'furniture-snap-plane';

  group.add(grid);
  group.add(plane);

  // We'll attach the group to the scene but keep it disabled until activated.
  scene.add(group);

  function _snapScalar(val) {
    return Math.round(val / gridSize) * gridSize;
  }

  function snapPosition(pos) {
    if (!pos) return null;
    return new THREE.Vector3(_snapScalar(pos.x), _snapScalar(pos.y), _snapScalar(pos.z));
  }

  function setPosition(pos) {
    if (!pos) return;
    const snapped = snapPosition(pos);
    group.position.set(snapped.x, snapped.y + 0.001, snapped.z);
    // plane covers one grid cell visually
    plane.scale.set(gridSize, gridSize, 1);
    plane.position.set(snapped.x, snapped.y + 0.002, snapped.z);
  }

  // Follow player's XZ by default so the grid is immediately visible near the player.
  function update() {
    if (!active) return;
    const p = playerModel.position;
    // Snap grid to player's position on XZ plane
    const snapped = snapPosition(new THREE.Vector3(p.x, 0, p.z));
    group.position.set(snapped.x, 0.001, snapped.z);
    // Keep plane slightly above ground at player's y if needed
    plane.position.set(snapped.x, 0.002, snapped.z);
  }

  function setActive(next) {
    active = !!next;
    grid.visible = active;
    plane.visible = active;
  }

  function dispose() {
    // remove visuals and free materials/geometry
    try {
      scene.remove(group);
      grid.geometry?.dispose?.();
      if (Array.isArray(grid.material)) grid.material.forEach(m => m?.dispose?.());
      else grid.material?.dispose?.();
      plane.geometry?.dispose?.();
      plane.material?.dispose?.();
    } catch (e) {}
  }

  return {
    setActive,
    snapPosition,
    setPosition,
    update,
    dispose
  };
}

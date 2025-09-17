/**
 * Companion Spirit
 * - Exports createCompanionSpirit(THREE, { scene, playerModel, audioManager })
 * - No top-level side effects; lightweight and lazy-loadable.
 *
 * Returned controller API:
 *   - setActive(boolean)
 *   - update(delta)
 *   - dispose()
 */
export function createCompanionSpirit(THREE, { scene, playerModel, audioManager } = {}) {
  if (!THREE) throw new Error('THREE is required');
  if (!scene) throw new Error('scene is required');
  if (!playerModel) throw new Error('playerModel is required');

  const group = new THREE.Group();
  group.name = 'companion-spirit';

  const geom = new THREE.SphereGeometry(0.12, 12, 10);
  const mat = new THREE.MeshStandardMaterial({
    color: 0x88ccff,
    emissive: 0x66ddff,
    emissiveIntensity: 0.9,
    roughness: 0.5,
    metalness: 0.0,
    transparent: true,
    opacity: 0.95
  });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  group.add(mesh);

  const light = new THREE.PointLight(0x66ddff, 0.8, 4);
  light.castShadow = false;
  group.add(light);

  // Initial off-stage position
  group.position.set(0, -1000, 0);

  let active = false;

  function tryPlayToggleSound() {
    try {
      audioManager?.playSFX?.('ui/toggle-on.ogg', 0.5);
    } catch (e) {
      // ignore missing assets
    }
  }

  /**
   * Activate or deactivate the companion spirit.
   * When activated, the group is added to the scene and will follow the player on update().
   */
  function setActive(next) {
    next = !!next;
    if (next === active) return;
    active = next;
    tryPlayToggleSound();
    if (active) {
      scene.add(group);
      // place near player immediately
      group.position.copy(playerModel.position).add(new THREE.Vector3(0.6, 1.6, -0.6).applyQuaternion(playerModel.quaternion));
    } else {
      if (group.parent) group.parent.remove(group);
      // move off-stage to avoid accidental visibility
      group.position.set(0, -1000, 0);
    }
  }

  /**
   * Update called from the main loop.
   * Performs a smooth follow and a small bobbing animation.
   */
  function update(dt) {
    if (!active) return;
    const desired = playerModel.position.clone().add(new THREE.Vector3(0.6, 1.6, -0.6).applyQuaternion(playerModel.quaternion));
    // smooth interpolation
    group.position.lerp(desired, Math.min(1, dt * 4));
    // gentle bob
    mesh.position.y = Math.sin(Date.now() * 0.002) * 0.08;
    light.position.copy(mesh.position);
    // subtle facing so it feels "alive"
    group.lookAt(playerModel.position);
  }

  function dispose() {
    if (group.parent) group.parent.remove(group);
    try { geom.dispose(); } catch (e) {}
    try { mat.dispose(); } catch (e) {}
  }

  return {
    setActive,
    update,
    dispose
  };
}

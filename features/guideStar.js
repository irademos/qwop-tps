/**
 * features/guideStar.js
 *
 * Lightweight, lazy-loadable "guide star" ambient waypoint.
 * - Exports createGuideStar(THREE, { scene, playerModel }) which returns a controller:
 *   { setActive(bool), update(delta), dispose(), group }
 *
 * The module performs no top-level scene mutations and is safe to dynamically import.
 */

export function createGuideStar(THREE, { scene, playerModel, distance = 3, color = 0xffcc66 } = {}) {
  if (!THREE) throw new Error('THREE is required');
  if (!scene) throw new Error('scene is required');
  if (!playerModel) throw new Error('playerModel is required');

  const group = new THREE.Group();
  group.name = 'guide-star';

  const geom = new THREE.SphereGeometry(0.12, 8, 6);
  const mat = new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: 0.6,
    roughness: 0.5,
    metalness: 0.1,
    transparent: true,
    opacity: 0.95
  });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  group.add(mesh);

  const light = new THREE.PointLight(color, 0.6, 8, 2);
  group.add(light);

  let active = false;
  let time = 0;

  /**
   * Activate/deactivate the guide star (adds/removes from scene).
   * @param {boolean} flag
   */
  function setActive(flag) {
    const next = !!flag;
    if (next === active) return;
    active = next;
    if (active) {
      scene.add(group);
    } else {
      if (group.parent) group.parent.remove(group);
    }
  }

  /**
   * Update called from the main animation loop.
   * @param {number} dt - delta seconds
   */
  function update(dt) {
    if (!active) return;
    time += dt;
    const bob = Math.sin(time * 2.0) * 0.12;
    const pulse = (Math.sin(time * 6.0) * 0.25) + 0.9;
    mesh.position.y = 1.6 + bob;
    mesh.scale.setScalar(pulse);
    light.intensity = 0.6 * pulse;

    // Position the star slightly ahead of the player and smoothly interpolate
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(playerModel.quaternion);
    const target = playerModel.position.clone().add(forward.multiplyScalar(distance)).add(new THREE.Vector3(0, 1.2, 0));
    group.position.lerp(target, Math.min(1, dt * 6));
  }

  function dispose() {
    if (group.parent) group.parent.remove(group);
    geom.dispose?.();
    mat.dispose?.();
  }

  return {
    setActive,
    update,
    dispose,
    group
  };
}

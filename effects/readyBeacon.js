/**
 * effects/readyBeacon.js
 * Small, lightweight pulsing orb that follows the player.
 * - No side effects on import.
 * - Export a factory: createReadyBeacon(THREE, { scene, playerModel })
 */

export function createReadyBeacon(THREE, { scene, playerModel } = {}) {
  if (!THREE) throw new Error('THREE is required');
  if (!scene) throw new Error('scene is required');
  if (!playerModel) throw new Error('playerModel is required');

  const group = new THREE.Group();
  group.name = 'ready-beacon';

  const geom = new THREE.SphereGeometry(0.12, 16, 12);
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffcc66,
    emissive: 0xffdd88,
    emissiveIntensity: 0.6,
    roughness: 0.8,
    metalness: 0.0,
    transparent: true,
    opacity: 0.95,
    depthWrite: false
  });

  const mesh = new THREE.Mesh(geom, mat);
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.position.set(0, 1.6, 0);
  group.add(mesh);
  scene.add(group);

  let time = 0;
  let active = true;

  /**
   * Toggle visibility/activity of the beacon.
   * @param {boolean} v
   */
  function setActive(v) {
    active = !!v;
    group.visible = active;
  }

  /**
   * Per-frame update. Smoothly follows playerModel and pulses.
   * @param {number} dt - seconds
   */
  function update(dt) {
    if (!active) return;
    time += dt;
    const pulse = 1 + Math.sin(time * 4) * 0.08;
    mesh.scale.setScalar(pulse);
    mat.emissiveIntensity = 0.5 + Math.max(0, Math.sin(time * 4)) * 0.7;

    // Follow player softly
    const target = playerModel.position.clone().add(new THREE.Vector3(0, 1.8, 0));
    group.position.lerp(target, Math.min(1, dt * 8));
  }

  function dispose() {
    scene.remove(group);
    geom.dispose?.();
    mat.dispose?.();
  }

  return {
    update,
    setActive,
    dispose,
    group
  };
}

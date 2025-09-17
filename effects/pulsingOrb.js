/**
 * effects/pulsingOrb.js
 *
 * Lightweight, lazy-loadable pulsing orb that follows the player.
 * - No top-level side effects on import.
 * - Exported factory: createPulsingOrb(THREE, { scene, playerModel }).
 *
 * Returns a controller with:
 *  - setActive(boolean)
 *  - update(delta)
 *  - dispose()
 */

export function createPulsingOrb(THREE, { scene, playerModel } = {}) {
  if (!THREE) throw new Error('THREE is required');
  if (!scene) throw new Error('scene is required');
  if (!playerModel) throw new Error('playerModel is required');

  const group = new THREE.Group();
  group.name = 'pulsing-orb-group';

  const geom = new THREE.SphereGeometry(0.12, 12, 10);
  const mat = new THREE.MeshStandardMaterial({
    color: 0x66ccff,
    emissive: 0x66ddff,
    emissiveIntensity: 0.7,
    roughness: 0.6,
    metalness: 0.0,
    transparent: true,
    opacity: 0.95,
    depthWrite: false
  });

  const orb = new THREE.Mesh(geom, mat);
  orb.castShadow = false;
  orb.receiveShadow = false;
  orb.position.set(0, 1.2, -0.6); // relative offset from player (will follow)
  group.add(orb);

  // Subtle halo using a ring
  const ringGeo = new THREE.RingGeometry(0.16, 0.26, 32);
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0x66ccff,
    transparent: true,
    opacity: 0.12,
    side: THREE.DoubleSide,
    depthWrite: false
  });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.0;
  ring.renderOrder = 1;
  group.add(ring);

  let active = false;
  let elapsed = 0;

  function setActive(v) {
    if (v && !group.parent) {
      scene.add(group);
    } else if (!v && group.parent) {
      scene.remove(group);
    }
    active = !!v;
  }

  function update(dt) {
    if (!active) return;
    elapsed += dt;
    // follow the player model with a small lerp so motion is smooth
    const target = new THREE.Vector3();
    playerModel.getWorldPosition(target);
    const offset = new THREE.Vector3(0, 1.4, -0.8).applyQuaternion(playerModel.quaternion);
    target.add(offset);
    group.position.lerp(target, Math.min(1, dt * 6));

    // Pulsing animation (scale + emissive pulse)
    const pulse = 0.85 + Math.sin(elapsed * 3.0) * 0.12;
    orb.scale.setScalar(pulse);
    mat.emissiveIntensity = 0.5 + (Math.sin(elapsed * 3.0) * 0.25 + 0.25);

    // Slow rotation for the ring
    ring.rotation.z += dt * 0.8;
  }

  function dispose() {
    if (group.parent) group.parent.remove(group);
    geom.dispose?.();
    mat.dispose?.();
    ringGeo.dispose?.();
    ringMat.dispose?.();
  }

  return {
    setActive,
    update,
    dispose
  };
}

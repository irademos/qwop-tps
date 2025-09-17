/**
 * Lightweight bird NPC that circles the player.
 * - No top-level side-effects.
 * - Exported factory returns controller with update(dt), setActive(bool), dispose().
 *
 * Usage:
 *   const bird = createBirdNPC(THREE, { scene, playerModel, audioManager });
 *   bird.setActive(true);
 */

export function createBirdNPC(THREE, { scene, playerModel, audioManager } = {}) {
  if (!THREE) throw new Error('THREE is required');
  if (!scene) throw new Error('scene is required');
  if (!playerModel) throw new Error('playerModel is required');

  const group = new THREE.Group();
  group.name = 'bird-npc';

  // simple low-poly bird body (sphere) + a small tail (cone)
  const bodyGeo = new THREE.SphereGeometry(0.06, 8, 6);
  const bodyMat = new THREE.MeshStandardMaterial({
    color: 0x222222,
    emissive: 0x221100,
    roughness: 0.5,
    metalness: 0.0
  });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.castShadow = true;
  group.add(body);

  const tailGeo = new THREE.ConeGeometry(0.03, 0.06, 6);
  const tailMat = new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.6 });
  const tail = new THREE.Mesh(tailGeo, tailMat);
  tail.position.set(0, -0.02, 0.06);
  tail.rotation.x = Math.PI / 2;
  body.add(tail);

  scene.add(group);

  // motion state
  let angle = Math.random() * Math.PI * 2;
  let radius = 2.2 + Math.random() * 2.0;
  let heightOffset = 1.2 + Math.random() * 1.0;
  let speed = 0.8 + Math.random() * 0.9;
  let active = true;

  /**
   * update bird position each frame
   * @param {number} dt - seconds since last frame
   */
  function update(dt) {
    if (!active) return;
    angle += dt * speed;
    const px = playerModel.position.x;
    const pz = playerModel.position.z;
    const x = px + Math.cos(angle) * radius;
    const z = pz + Math.sin(angle) * radius;
    const y = playerModel.position.y + heightOffset + Math.sin(angle * 2.0) * 0.18;
    group.position.set(x, y, z);

    // face along path tangent
    const forward = new THREE.Vector3(-Math.sin(angle), 0, Math.cos(angle)).normalize();
    const targetQuat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, -1), forward);
    group.quaternion.slerp(targetQuat, Math.min(1, dt * 6));
  }

  function setActive(v) {
    active = !!v;
    group.visible = !!v;
  }

  function dispose() {
    if (group.parent) group.parent.remove(group);
    bodyGeo.dispose?.();
    bodyMat.dispose?.();
    tailGeo.dispose?.();
    tailMat.dispose?.();
  }

  return { update, setActive, dispose, group };
}

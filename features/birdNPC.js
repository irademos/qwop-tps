/**
 * Lightweight bird NPC that circles the player.
 * - No top-level side-effects.
 * - Exported factory returns controller with update(dt), setActive(bool), dispose().
 *
 * Usage:
 *   const bird = createBirdNPC(THREE, { scene, playerModel, audioManager, options });
 *   bird.setActive(true);
 */

export function createBirdNPC(THREE, { scene, playerModel, audioManager, options } = {}) {
  if (!THREE) throw new Error('THREE is required');
  if (!scene) throw new Error('scene is required');
  if (!playerModel) throw new Error('playerModel is required');

  const opts = Object.assign({
    radius: 2.8 + Math.random() * 1.6,
    heightOffset: 1.2 + Math.random() * 1.0,
    speed: 0.9 + Math.random() * 0.8,
    bodyColor: 0x222222,
    tailColor: 0x333333,
    flapIntensity: 0.08
  }, options || {});

  const group = new THREE.Group();
  group.name = 'bird-npc';

  // simple low-poly bird body (sphere) + a small tail (cone)
  const bodyGeo = new THREE.SphereGeometry(0.06, 8, 6);
  const bodyMat = new THREE.MeshStandardMaterial({
    color: opts.bodyColor,
    emissive: 0x221100,
    roughness: 0.5,
    metalness: 0.0
  });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.castShadow = true;
  group.add(body);

  const tailGeo = new THREE.ConeGeometry(0.03, 0.06, 6);
  const tailMat = new THREE.MeshStandardMaterial({ color: opts.tailColor, roughness: 0.6 });
  const tail = new THREE.Mesh(tailGeo, tailMat);
  tail.position.set(0, -0.02, 0.06);
  tail.rotation.x = Math.PI / 2;
  body.add(tail);

  // small wings for visual feedback (no complex geometry)
  const wingGeo = new THREE.BoxGeometry(0.02, 0.001, 0.06);
  const wingMat = new THREE.MeshStandardMaterial({ color: opts.bodyColor, roughness: 0.6 });
  const leftWing = new THREE.Mesh(wingGeo, wingMat);
  const rightWing = new THREE.Mesh(wingGeo, wingMat);
  leftWing.position.set(-0.05, 0, 0);
  rightWing.position.set(0.05, 0, 0);
  leftWing.rotation.z = Math.PI / 8;
  rightWing.rotation.z = -Math.PI / 8;
  body.add(leftWing);
  body.add(rightWing);

  scene.add(group);

  // motion state
  let angle = Math.random() * Math.PI * 2;
  let radius = opts.radius;
  let heightOffset = opts.heightOffset;
  let speed = opts.speed;
  let active = true;
  let flapPhase = Math.random() * Math.PI * 2;

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

    // gentle wing/flap animation for visible motion
    flapPhase += dt * (4 + speed);
    const flap = Math.sin(flapPhase) * opts.flapIntensity;
    leftWing.rotation.z = Math.PI / 8 + flap;
    rightWing.rotation.z = -Math.PI / 8 - flap;
    body.scale.y = 0.98 + Math.abs(Math.sin(flapPhase)) * 0.04;
  }

  function setActive(v) {
    active = !!v;
    group.visible = !!v;
  }

  function setRadius(r) {
    radius = Math.max(0.2, Number(r) || radius);
  }

  function setSpeed(s) {
    speed = Math.max(0, Number(s) || speed);
  }

  function dispose() {
    try { if (group.parent) group.parent.remove(group); } catch (e) {}
    try { bodyGeo.dispose?.(); } catch (e) {}
    try { bodyMat.dispose?.(); } catch (e) {}
    try { tailGeo.dispose?.(); } catch (e) {}
    try { tailMat.dispose?.(); } catch (e) {}
    try { wingGeo.dispose?.(); } catch (e) {}
    try { wingMat.dispose?.(); } catch (e) {}
  }

  return { update, setActive, setRadius, setSpeed, dispose, group };
}

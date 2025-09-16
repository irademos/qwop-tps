/**
 * ai/forestBird.js
 * Lightweight, lazy-loaded "forest bird" NPC that orbits the player.
 *
 * Exports:
 *   - createForestBird(THREE, { scene, playerModel, audioManager })
 *
 * The module performs no side-effects on import. The returned controller exposes:
 *   - update(deltaSeconds): called each frame to animate the bird
 *   - setActive(boolean): show/hide and start/stop behavior
 *   - dispose(): cleanup geometries and remove from scene
 */

export function createForestBird(THREE, { scene, playerModel, audioManager } = {}) {
  if (!THREE) throw new Error('THREE is required');
  if (!scene) throw new Error('scene is required');
  if (!playerModel) throw new Error('playerModel is required');

  const group = new THREE.Group();
  group.name = 'forest-bird';
  // simple body
  const bodyGeo = new THREE.SphereGeometry(0.08, 8, 6);
  const bodyMat = new THREE.MeshStandardMaterial({
    color: 0xffcc55,
    emissive: 0xffaa33,
    roughness: 0.6,
    metalness: 0.0
  });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.castShadow = false;
  body.receiveShadow = false;
  group.add(body);

  // wings (thin boxes) - cloned for left/right
  const wingGeo = new THREE.BoxGeometry(0.12, 0.02, 0.04);
  const wingMat = new THREE.MeshStandardMaterial({ color: 0xffe6b3, roughness: 0.7, metalness: 0.0 });
  const leftWing = new THREE.Mesh(wingGeo, wingMat);
  leftWing.position.set(-0.08, 0, 0);
  leftWing.rotation.z = 0.4;
  const rightWing = leftWing.clone();
  rightWing.position.x = 0.08;
  rightWing.rotation.z = -0.4;
  group.add(leftWing, rightWing);

  // small tail
  const tailGeo = new THREE.BoxGeometry(0.06, 0.02, 0.02);
  const tailMat = new THREE.MeshStandardMaterial({ color: 0xffd699, roughness: 0.8 });
  const tail = new THREE.Mesh(tailGeo, tailMat);
  tail.position.set(0, -0.02, -0.08);
  tail.rotation.x = -0.2;
  group.add(tail);

  // initial placement
  group.visible = false;
  scene.add(group);

  let active = false;
  let phase = Math.random() * Math.PI * 2;
  let orbitRadius = 1.4 + Math.random() * 0.6;

  /**
   * Update called from the main loop.
   * @param {number} dt - seconds since last frame
   */
  function update(dt) {
    if (!active) return;
    phase += dt * 2.0; // speed
    const px = playerModel.position.x;
    const py = playerModel.position.y + 1.6;
    const pz = playerModel.position.z;
    // bob and orbit
    const x = px + Math.cos(phase) * orbitRadius;
    const z = pz + Math.sin(phase) * (orbitRadius * 0.7);
    const y = py + Math.sin(phase * 1.8) * 0.18 + 0.12;
    group.position.set(x, y, z);
    // gentle look towards player
    group.lookAt(px, py, pz);
    // wing flapping animation
    const flap = Math.sin(phase * 8) * 0.6;
    leftWing.rotation.z = 0.4 + flap;
    rightWing.rotation.z = -0.4 - flap;
    // subtle body tilt
    body.rotation.z = Math.sin(phase * 2) * 0.08;
  }

  function setActive(next) {
    const was = active;
    active = !!next;
    group.visible = active;
    if (active && !was) {
      // small chirp on activate if audioManager available
      try {
        audioManager?.playSFX?.('nature/bird-chirp.ogg', 0.35);
      } catch (e) {
        // ignore missing asset errors
      }
    }
  }

  function dispose() {
    if (group.parent) group.parent.remove(group);
    bodyGeo.dispose?.();
    bodyMat.dispose?.();
    wingGeo.dispose?.();
    wingMat.dispose?.();
    tailGeo.dispose?.();
    tailMat.dispose?.();
  }

  return { update, setActive, dispose, group };
}

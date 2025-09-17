/**
 * createWanderingDeer - lightweight, lazy-loadable ambient creature.
 * Exports a factory that returns a controller with setActive(update) and dispose.
 *
 * @param {object} THREE - three.js module
 * @param {object} options
 * @param {THREE.Scene} options.scene
 * @param {THREE.Object3D} options.playerModel
 * @param {object} [options.audioManager]
 * @returns {{ setActive: function(boolean), update: function(number), dispose: function() }}
 */
export function createWanderingDeer(THREE, { scene, playerModel, audioManager } = {}) {
  if (!THREE) throw new Error('THREE is required');
  if (!scene) throw new Error('scene is required');
  if (!playerModel) throw new Error('playerModel is required');

  const group = new THREE.Group();
  group.name = 'wandering-deer';

  // Simple low-poly body
  const bodyGeo = new THREE.SphereGeometry(0.25, 8, 6);
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x885522, roughness: 0.8 });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.position.set(0, 0.25, 0);
  group.add(body);

  // Head
  const headGeo = new THREE.SphereGeometry(0.12, 8, 6);
  const headMat = new THREE.MeshStandardMaterial({ color: 0x553311, roughness: 0.8 });
  const head = new THREE.Mesh(headGeo, headMat);
  head.position.set(0.28, 0.36, 0.12);
  group.add(head);

  // Small horn
  const hornGeo = new THREE.ConeGeometry(0.03, 0.12, 6);
  const hornMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.8 });
  const horn = new THREE.Mesh(hornGeo, hornMat);
  horn.position.set(0.38, 0.45, 0.12);
  horn.rotateX(Math.PI / 2);
  group.add(horn);

  // Start positioned near player
  const startOffset = new THREE.Vector3(2 + Math.random() * 2, 0, 0);
  group.position.copy(playerModel.position).add(startOffset);

  let active = false;
  let angle = Math.random() * Math.PI * 2;
  const radius = 3 + Math.random() * 2;
  const speed = 0.3 + Math.random() * 0.4;

  function setActive(v) {
    v = !!v;
    if (v === active) return;
    active = v;
    if (active) {
      if (!group.parent) scene.add(group);
    } else {
      if (group.parent) group.parent.remove(group);
    }
  }

  function update(dt) {
    if (!active) return;
    angle += dt * speed;
    const px = playerModel.position.x + Math.cos(angle) * radius;
    const pz = playerModel.position.z + Math.sin(angle) * radius;
    const targetY = Math.max(0, playerModel.position.y);
    // Smooth follow to avoid jumps
    group.position.lerp(new THREE.Vector3(px, targetY, pz), 0.06);
    group.lookAt(playerModel.position.x, targetY, playerModel.position.z);
    // gentle bob
    const bob = Math.sin(Date.now() / 350) * 0.012;
    group.position.y += bob;
  }

  function dispose() {
    if (group.parent) group.parent.remove(group);
    bodyGeo.dispose?.();
    bodyMat.dispose?.();
    headGeo.dispose?.();
    headMat.dispose?.();
    hornGeo.dispose?.();
    hornMat.dispose?.();
  }


  return { setActive, update, dispose };
}

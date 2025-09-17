/**
 * features/coinEffect.js
 *
 * Lightweight, lazy-loadable coin collectible that orbits the player.
 * - No top-level side-effects on import.
 * - createCoinEffect returns a controller with setActive/update/dispose.
 *
 * Usage:
 *   const ctrl = createCoinEffect(THREE, { scene, playerModel, audioManager, onCollect });
 *   ctrl.setActive(true);
 */

export function createCoinEffect(THREE, { scene, playerModel, audioManager, onCollect } = {}) {
  if (!THREE) throw new Error('THREE is required');
  if (!scene) throw new Error('scene is required');
  if (!playerModel) throw new Error('playerModel is required');

  const group = new THREE.Group();
  group.name = 'coin-effect';

  const geom = new THREE.SphereGeometry(0.12, 16, 12);
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffdd55,
    emissive: 0xffcc66,
    roughness: 0.2,
    metalness: 0.9
  });

  const mesh = new THREE.Mesh(geom, mat);
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  group.add(mesh);

  let active = false;
  let angle = 0;
  let visible = true;
  let respawnTimer = 0;
  const RESPWAN_DELAY = 5.0; // seconds

  // Initial offset from player (in local player space)
  const OFFSET = new THREE.Vector3(0.8, 1.2, -0.6);

  function worldPositionForOffset() {
    // place a point offset in front/above the player based on player rotation
    const out = new THREE.Vector3().copy(OFFSET);
    out.applyQuaternion(playerModel.quaternion);
    return playerModel.position.clone().add(out);
  }

  function tryPlayCoinSFX() {
    try {
      audioManager?.playSFX?.('ui/coin.ogg', 0.8);
    } catch (e) {
      // ignore missing assets
    }
  }

  function setActive(next) {
    active = !!next;
    if (active) {
      if (!group.parent) scene.add(group);
      visible = true;
      mesh.visible = true;
      respawnTimer = 0;
      angle = Math.random() * Math.PI * 2;
    } else {
      if (group.parent) group.parent.remove(group);
    }
  }

  function update(dt) {
    if (!active) return;
    if (!playerModel) return;

    if (respawnTimer > 0) {
      respawnTimer -= dt;
      if (respawnTimer <= 0) {
        visible = true;
        mesh.visible = true;
      } else {
        return;
      }
    }

    angle += dt * 1.2; // orbit speed
    const orbitRadius = 0.6;
    const basePos = worldPositionForOffset();
    const x = Math.cos(angle) * orbitRadius;
    const z = Math.sin(angle) * orbitRadius;
    group.position.set(basePos.x + x, basePos.y + 0.15 * Math.sin(angle * 2), basePos.z + z);
    mesh.rotation.y += dt * 2.0;

    // Check collection: simple proximity test
    const dist = group.position.distanceTo(playerModel.position);
    if (visible && dist < 1.2) {
      // Collected!
      visible = false;
      mesh.visible = false;
      respawnTimer = RESPWAN_DELAY;
      tryPlayCoinSFX();
      try {
        if (typeof onCollect === 'function') onCollect();
      } catch (e) {
        console.error('coin onCollect handler failed', e);
      }
    }
  }

  function dispose() {
    if (group.parent) group.parent.remove(group);
    geom.dispose?.();
    mat.dispose?.();
  }

  return {
    setActive,
    update,
    dispose
  };
}

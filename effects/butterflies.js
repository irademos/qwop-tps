/**
 * Lightweight butterfly swarm ambient effect.
 * - Exported factory returns a controller with setActive(boolean), update(delta), dispose()
 * - No side effects on import; scene manipulation occurs when setActive(true) is called.
 *
 * This module is intentionally small and GPU-friendly: uses simple PlaneGeometry and
 * updates positions on the CPU. It is intended to be lazy-loaded and toggled from the UI.
 */

export function createButterflies(THREE, { scene, playerModel, audioManager } = {}) {
  if (!THREE) throw new Error('THREE is required');
  if (!scene) throw new Error('scene is required');
  if (!playerModel) throw new Error('playerModel is required');

  const group = new THREE.Group();
  group.name = 'butterflies';
  const meshes = [];
  const COUNT = 10;
  const sharedGeo = new THREE.PlaneGeometry(0.12, 0.08);
  const colors = [0xffc0cb, 0xffd27f, 0xaaffaa, 0x88ccff];

  for (let i = 0; i < COUNT; i++) {
    const mat = new THREE.MeshBasicMaterial({
      color: colors[i % colors.length],
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.95,
      depthWrite: false
    });
    const m = new THREE.Mesh(sharedGeo, mat);
    // random start offset around player
    m.userData = {
      ang: Math.random() * Math.PI * 2,
      radius: 0.4 + Math.random() * 0.8,
      speed: 0.6 + Math.random() * 0.8,
      bobOffset: Math.random() * Math.PI * 2,
      tilt: (Math.random() - 0.5) * 0.8
    };
    // initial placement relative to player; actual positions computed each frame
    m.position.set(0, 0, 0);
    m.scale.setScalar(1 + Math.random() * 0.3);
    meshes.push(m);
    group.add(m);
  }

  let active = false;
  let elapsed = 0;
  const tmpVec = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);

  function setActive(next) {
    if (next === active) return;
    active = !!next;
    if (active) {
      scene.add(group);
      // place group initially at player position
      group.position.copy(playerModel.position);
      // optionally play a tiny flutter SFX if provided
      try {
        audioManager?.playSFX?.('ui/hover.ogg', 0.2);
      } catch (e) {
        // ignore missing assets
      }
    } else {
      if (group.parent) group.parent.remove(group);
    }
  }

  function update(delta) {
    if (!active) return;
    elapsed += delta;
    // keep group near the player (a little above their head)
    group.position.lerp(playerModel.position.clone().add(new THREE.Vector3(0, 1.0, 0)), 0.2);

    for (let i = 0; i < meshes.length; i++) {
      const m = meshes[i];
      const ud = m.userData;
      ud.ang += ud.speed * delta;
      const x = Math.cos(ud.ang) * ud.radius;
      const z = Math.sin(ud.ang) * ud.radius;
      const y = 0.8 + Math.sin(elapsed * 2 + ud.bobOffset) * 0.12 + (i % 2 === 0 ? 0.02 : -0.02);
      m.position.set(x, y, z);
      // make the butterfly face its flight direction + small tilt
      tmpVec.set(Math.cos(ud.ang + 0.1), 0, Math.sin(ud.ang + 0.1));
      m.lookAt(tmpVec);
      m.rotateX(ud.tilt * 0.25);
      m.rotateY(ud.tilt * 0.1);
    }
  }

  function dispose() {
    // remove from scene
    if (group.parent) group.parent.remove(group);
    // dispose geometry/materials
    sharedGeo.dispose?.();
    meshes.forEach(m => {
      m.material?.dispose?.();
    });
    meshes.length = 0;
  }

  return {
    setActive,
    update,
    dispose
  };
}

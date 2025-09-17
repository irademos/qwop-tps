/**
 * features/wanderingDeer.client.js
 *
 * Lightweight, lazy-loadable wandering deer ambient effect.
 * - No top-level side effects on import.
 * - Export: createWanderingDeer(THREE, { scene, playerModel, audioManager })
 *
 * The controller returned exposes:
 *  - setActive(boolean)
 *  - update(delta)
 *  - dispose()
 *
 * Designed to be cheap: shared geometries/materials, simple steering, no external assets.
 */

export function createWanderingDeer(THREE, { scene, playerModel, audioManager } = {}) {
  if (!THREE) throw new Error('THREE is required');
  if (!scene) throw new Error('scene is required');
  if (!playerModel) throw new Error('playerModel is required');

  const group = new THREE.Group();
  group.name = 'wandering-deer';

  const COUNT = 3;
  const SPAWN_RADIUS_MIN = 1.4;
  const SPAWN_RADIUS_MAX = 4.0;

  // Shared geometry/materials for performance
  const bodyGeo = new THREE.SphereGeometry(0.22, 8, 6);
  const headGeo = new THREE.SphereGeometry(0.11, 8, 6);
  const earGeo = new THREE.BoxGeometry(0.04, 0.06, 0.01);
  const legGeo = new THREE.CylinderGeometry(0.035, 0.035, 0.28, 6);

  const bodyMat = new THREE.MeshStandardMaterial({ color: 0xCCAA88, roughness: 0.9, metalness: 0.0 });
  const accentMat = new THREE.MeshStandardMaterial({ color: 0x7b5e3b, roughness: 0.95 });

  const deerList = [];

  function rand(min, max) { return min + Math.random() * (max - min); }

  for (let i = 0; i < COUNT; i++) {
    const d = new THREE.Group();
    d.name = `deer-${i}`;

    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.castShadow = false;
    body.receiveShadow = false;
    body.position.set(0, 0.12, 0);

    const head = new THREE.Mesh(headGeo, bodyMat);
    head.position.set(0, 0.22, 0.28);
    head.scale.set(0.9, 0.9, 0.9);

    // simple ears
    const earL = new THREE.Mesh(earGeo, accentMat);
    earL.position.set(0.06, 0.32, 0.32);
    earL.rotation.set(0, 0, 0.5);
    const earR = earL.clone();
    earR.position.x = -earL.position.x;
    earR.rotation.z = -0.5;

    // legs (four simple cylinders)
    const legs = new THREE.Group();
    const legOffsets = [
      [0.11, -0.02, 0.09],
      [-0.11, -0.02, 0.09],
      [0.11, -0.02, -0.09],
      [-0.11, -0.02, -0.09]
    ];
    legOffsets.forEach(offset => {
      const leg = new THREE.Mesh(legGeo, accentMat);
      leg.position.set(offset[0], -0.02, offset[2]);
      leg.rotation.x = Math.PI / 2;
      leg.castShadow = false;
      leg.receiveShadow = false;
      legs.add(leg);
    });

    d.add(body, head, earL, earR, legs);

    // Initial placement near player
    const theta = Math.random() * Math.PI * 2;
    const r = rand(SPAWN_RADIUS_MIN, SPAWN_RADIUS_MAX);
    d.position.copy(playerModel.position).add(new THREE.Vector3(Math.cos(theta) * r, 0, Math.sin(theta) * r));

    // Per-deer state
    d.userData = {
      speed: rand(0.3, 0.7), // units per second
      target: getRandomTargetNearPlayer(),
      nextChange: performance.now() + rand(3000, 7000),
      bob: Math.random() * Math.PI * 2
    };

    group.add(d);
    deerList.push(d);
  }

  let active = false;

  function getRandomTargetNearPlayer() {
    const theta = Math.random() * Math.PI * 2;
    const r = rand(SPAWN_RADIUS_MIN, SPAWN_RADIUS_MAX);
    const p = playerModel.position.clone().add(new THREE.Vector3(Math.cos(theta) * r, 0, Math.sin(theta) * r));
    // keep on ground (y = player's y)
    p.y = playerModel.position.y;
    return p;
  }

  function setActive(on) {
    if (on === active) return;
    active = !!on;
    try {
      if (active) {
        // ensure group follows player initial offset when enabled
        deerList.forEach(d => {
          const theta = Math.random() * Math.PI * 2;
          const r = rand(SPAWN_RADIUS_MIN, SPAWN_RADIUS_MAX);
          const pos = playerModel.position.clone().add(new THREE.Vector3(Math.cos(theta) * r, 0, Math.sin(theta) * r));
          d.position.copy(pos);
          d.userData.target = getRandomTargetNearPlayer();
          d.userData.nextChange = performance.now() + rand(2000, 7000);
        });
        scene.add(group);
      } else {
        if (group.parent) group.parent.remove(group);
      }
    } catch (err) {
      console.error('wandering-deer setActive error', err);
    }
  }

  function update(delta) {
    if (!active) return;
    const now = performance.now();
    deerList.forEach(d => {
      // occasionally retarget relative to player
      if (now >= d.userData.nextChange) {
        d.userData.target = getRandomTargetNearPlayer();
        d.userData.nextChange = now + rand(2500, 7000);
      }

      // steer toward target
      const toTarget = d.userData.target.clone().sub(d.position);
      toTarget.y = 0;
      const dist = toTarget.length();
      if (dist > 0.05) {
        const dir = toTarget.normalize();
        const step = Math.min(d.userData.speed * delta, dist);
        d.position.add(dir.multiplyScalar(step));
        // face movement direction
        const yaw = Math.atan2(d.position.x - d.userData.target.x, d.position.z - d.userData.target.z) + Math.PI;
        d.rotation.y = THREE.MathUtils.lerp(d.rotation.y, yaw, 0.08);
      } else {
        // small idle bob
        d.userData.bob += delta * 4.0;
        d.position.y = playerModel.position.y + Math.sin(d.userData.bob) * 0.02;
      }
      // gentle vertical alignment to terrain / player
      d.position.y = playerModel.position.y;
    });
  }

  function dispose() {
    try {
      if (group.parent) group.parent.remove(group);
      bodyGeo.dispose?.();
      headGeo.dispose?.();
      earGeo.dispose?.();
      legGeo.dispose?.();
      bodyMat.dispose?.();
      accentMat.dispose?.();
      deerList.length = 0;
    } catch (err) {
      console.error('wandering-deer dispose error', err);
    }
  }

  return {
    setActive,
    update,
    dispose
  };
}

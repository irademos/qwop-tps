/**
 * features/floatingLanterns.js
 *
 * Lightweight ambient: floating lanterns that drift around the player.
 *
 * - No top-level side-effects.
 * - Export initFloatingLanterns(THREE, { scene, playerModel, audioManager }) -> controller
 *
 * Usage: lazy-load and call initFloatingLanterns(THREE, { scene, playerModel, audioManager })
 */

export function initFloatingLanterns(THREE, { scene, playerModel, audioManager } = {}) {
  if (!THREE) throw new Error('THREE is required');
  if (!scene) throw new Error('scene is required');
  if (!playerModel) throw new Error('playerModel is required');

  const GROUP_NAME = 'floating-lanterns';
  const group = new THREE.Group();
  group.name = GROUP_NAME;

  const lanterns = [];
  const COUNT = 12;
  const RADIUS_MIN = 3;
  const RADIUS_MAX = 10;
  const BASE_Y = 1.6;

  // Shared geometry/material
  const bulbGeo = new THREE.SphereGeometry(0.12, 8, 6);
  const cageGeo = new THREE.CylinderGeometry(0.16, 0.16, 0.28, 8, 1, true);
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0xffd7aa,
    emissive: 0xff8c42,
    emissiveIntensity: 0.9,
    roughness: 0.6,
    metalness: 0.0,
    transparent: true,
    opacity: 0.95
  });
  const cageMat = new THREE.MeshStandardMaterial({
    color: 0x443322,
    roughness: 0.7,
    metalness: 0.3
  });

  // Create lanterns: simple glass bulb + cage + small point light
  for (let i = 0; i < COUNT; i++) {
    const lantern = new THREE.Group();
    const theta = Math.random() * Math.PI * 2;
    const r = RADIUS_MIN + Math.random() * (RADIUS_MAX - RADIUS_MIN);
    const x = Math.cos(theta) * r;
    const z = Math.sin(theta) * r;
    const y = BASE_Y + (Math.random() * 0.5 - 0.25);

    const bulb = new THREE.Mesh(bulbGeo, glassMat);
    bulb.position.set(0, 0, 0);

    const cage = new THREE.Mesh(cageGeo, cageMat);
    cage.position.set(0, 0, 0);
    cage.rotation.x = Math.PI / 2;

    const light = new THREE.PointLight(0xffcda8, 0.8, 6, 2);
    light.position.set(0, 0.05, 0);

    lantern.add(bulb, cage, light);
    lantern.userData = {
      basePos: new THREE.Vector3(x, y, z),
      theta,
      radius: r,
      speed: 0.1 + Math.random() * 0.14,
      bobOffset: Math.random() * Math.PI * 2,
      light,
      index: i
    };

    lantern.position.copy(lantern.userData.basePos);
    lantern.scale.setScalar(1 - Math.random() * 0.25);

    group.add(lantern);
    lanterns.push(lantern);
  }

  let time = 0;
  let active = false;

  function setActive(v) {
    if (Boolean(v) === active) return;
    active = Boolean(v);
    try {
      if (active) {
        scene.add(group);
      } else {
        scene.remove(group);
      }
    } catch (e) {
      // ignore
    }
  }

  function update(delta) {
    if (!active) return;
    time += delta;
    // Anchor lanterns relative to player position each frame (so they follow the player)
    const anchor = playerModel?.position ?? new THREE.Vector3(0, 0, 0);
    for (let i = 0; i < lanterns.length; i++) {
      const L = lanterns[i];
      const ud = L.userData;
      // slow orbit around the player, small radius perturbation
      ud.theta += ud.speed * delta * 0.6;
      const rr = ud.radius + Math.sin(time * ud.speed * 0.5 + ud.index) * 0.25;
      const nx = Math.cos(ud.theta) * rr;
      const nz = Math.sin(ud.theta) * rr;
      const ny = ud.basePos.y + Math.sin(time * 1.2 + ud.bobOffset) * 0.18;

      // Smooth follow
      const target = new THREE.Vector3(anchor.x + nx, anchor.y + ny, anchor.z + nz);
      L.position.lerp(target, 0.08);

      // gentle sway
      L.rotation.y = Math.sin(time * ud.speed * 0.7 + ud.index) * 0.25;

      // subtle pulsing of light intensity
      if (ud.light) {
        ud.light.intensity = 0.6 + Math.sin(time * 2 + ud.index) * 0.15;
      }
    }
  }

  function destroy() {
    try {
      group.traverse((n) => {
        if (n.isMesh) {
          if (n.geometry) n.geometry.dispose();
          if (n.material) {
            if (Array.isArray(n.material)) {
              n.material.forEach(m => m.dispose && m.dispose());
            } else {
              n.material.dispose && n.material.dispose();
            }
          }
        }
        if (n.isLight) {
          // nothing to dispose
        }
      });
      if (group.parent) group.parent.remove(group);
    } catch (e) {}
  }

  return {
    name: GROUP_NAME,
    setActive,
    update,
    destroy
  };
}

/**
 * Lightweight butterflies ambient effect.
 *
 * Exports createButterflies(THREE, { scene, playerModel, audioManager })
 * which returns a controller: { setActive(boolean), dispose() }.
 *
 * - No top-level side effects.
 * - Uses a small number of simple meshes; keeps performance low.
 */

export function createButterflies(THREE, { scene, playerModel, audioManager } = {}) {
  if (!THREE) throw new Error('THREE is required');
  if (!scene) throw new Error('scene is required');
  if (!playerModel) throw new Error('playerModel is required');

  const group = new THREE.Group();
  group.name = 'butterflies';
  scene.add(group);

  const COUNT = 12;
  const meshes = [];
  const geos = [];
  const mats = [];
  const colors = [0xffcc66, 0xff88cc, 0x66ccff, 0x99ff99];

  for (let i = 0; i < COUNT; i++) {
    const geo = new THREE.SphereGeometry(0.04, 8, 6);
    const mat = new THREE.MeshStandardMaterial({
      color: colors[i % colors.length],
      emissive: colors[i % colors.length],
      emissiveIntensity: 0.25,
      roughness: 0.7,
      metalness: 0.0,
      transparent: true,
      opacity: 0.95,
      depthWrite: false
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = false;
    mesh.receiveShadow = false;

    // Start in a random offset around the player
    mesh.userData = {
      phase: Math.random() * Math.PI * 2,
      radius: 0.6 + Math.random() * 1.2,
      speed: 0.6 + Math.random() * 1.2,
      verticalOffset: (Math.random() - 0.5) * 0.6
    };

    meshes.push(mesh);
    geos.push(geo);
    mats.push(mat);
    group.add(mesh);
  }

  let active = false;
  let rafId = null;
  let lastTime = 0;

  function _update(dt) {
    // dt in seconds
    if (!playerModel || !playerModel.position) return;
    const base = playerModel.position;
    for (let i = 0; i < meshes.length; i++) {
      const m = meshes[i];
      const ud = m.userData;
      ud.phase += ud.speed * dt;
      const x = Math.cos(ud.phase * 1.2 + i) * ud.radius;
      const z = Math.sin(ud.phase * 1.5 + i * 1.1) * (ud.radius * 0.6);
      const y = ud.verticalOffset + Math.sin(ud.phase * 2.0 + i) * 0.12 + 0.8;
      m.position.set(base.x + x, base.y + y, base.z + z);
      // subtle facing motion
      m.lookAt(base.x, base.y + 0.8, base.z);
      m.rotation.x += 0.02;
    }
  }

  function _loop(now) {
    if (!lastTime) lastTime = now;
    const dt = Math.min(0.05, (now - lastTime) / 1000);
    lastTime = now;
    if (active) _update(dt);
    rafId = requestAnimationFrame(_loop);
  }

  function setActive(next) {
    const was = active;
    active = !!next;
    if (active && !rafId) {
      lastTime = 0;
      rafId = requestAnimationFrame(_loop);
    }
    // If turning off, we keep the meshes but stop animating them.
    if (!active && rafId) {
      // Let the RAF continue but nothing will update if active === false.
      // Cancel to avoid unnecessary CPU use.
      cancelAnimationFrame(rafId);
      rafId = null;
    }

    // Play a small toggle SFX if available
    try {
      if (audioManager && typeof audioManager.playSFX === 'function') {
        audioManager.playSFX('ambient/butterflies_toggle.ogg', 0.5);
      }
    } catch (e) {
      // ignore audio failures
    }
  }

  function dispose() {
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    if (group.parent) group.parent.remove(group);
    for (const g of geos) { try { g.dispose(); } catch (e) {} }
    for (const m of mats) { try { m.dispose(); } catch (e) {} }
    meshes.length = 0;
  }

  return {
    setActive,
    dispose,
    group
  };
}

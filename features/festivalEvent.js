/**
 * features/festivalEvent.js
 *
 * Adds lightweight festival decorations (lanterns, banners, point lights)
 * and plays a themed background SFX via the provided audioManager.
 *
 * - No top-level side-effects; caller must call initFestivalEvent(...)
 * - Returns a small controller: { setActive(bool), update(delta), dispose() }
 *
 * This module is intentionally small and uses primitive geometry so it is
 * safe to lazy-load and run immediately in the running scene.
 */

export function initFestivalEvent(THREE, { scene, playerModel, audioManager } = {}) {
  if (!THREE) throw new Error('THREE is required');
  if (!scene) throw new Error('scene is required');

  const root = new THREE.Group();
  root.name = 'festival-event';
  root.userData.__festival = true;
  scene.add(root);

  // Geometry (shared)
  const lanternGeom = new THREE.SphereGeometry(0.12, 10, 8);
  const bannerGeom = new THREE.PlaneGeometry(1.6, 0.42);

  // Groups
  const lanterns = [];
  const lights = new THREE.Group();
  const banners = new THREE.Group();
  root.add(lights, banners);

  // Create a ring of lanterns + small point lights
  const RADIUS = 6;
  const COUNT = 8;
  for (let i = 0; i < COUNT; i++) {
    const a = (i / COUNT) * Math.PI * 2;
    const x = Math.cos(a) * RADIUS;
    const z = Math.sin(a) * RADIUS;
    const lanternMat = new THREE.MeshStandardMaterial({
      color: 0xffcc66,
      emissive: 0xff8a33,
      emissiveIntensity: 1.0,
      roughness: 0.9,
      metalness: 0.0
    });
    const lantern = new THREE.Mesh(lanternGeom, lanternMat);
    lantern.position.set(x, 2.6, z);
    lantern.castShadow = false;
    lantern.receiveShadow = false;
    root.add(lantern);
    lanterns.push(lantern);

    const pl = new THREE.PointLight(0xffddbb, 0.8, 6);
    pl.position.set(x, 2.6, z);
    lights.add(pl);
  }

  // Simple colorful banners placed near the center
  const bannerColors = [0xdd3333, 0x33dd77, 0x3366ff, 0xff66cc];
  for (let i = 0; i < 4; i++) {
    const mat = new THREE.MeshStandardMaterial({
      color: bannerColors[i],
      side: THREE.DoubleSide,
      roughness: 0.9,
      metalness: 0.0
    });
    const mesh = new THREE.Mesh(bannerGeom, mat);
    const ang = i * (Math.PI / 2);
    mesh.position.set(Math.cos(ang) * 3, 2.1, Math.sin(ang) * 3);
    mesh.rotation.y = -ang + Math.PI / 8;
    banners.add(mesh);
  }

  // Optional subtle ground confetti (low-poly squares)
  const confettiGroup = new THREE.Group();
  const confettiGeo = new THREE.PlaneGeometry(0.12, 0.12);
  for (let i = 0; i < 40; i++) {
    const mat = new THREE.MeshStandardMaterial({
      color: [0xffdd66, 0x66ffcc, 0xff66aa, 0x66aaff][i % 4],
      side: THREE.DoubleSide,
      roughness: 1.0,
      metalness: 0.0
    });
    const m = new THREE.Mesh(confettiGeo, mat);
    m.position.set((Math.random() - 0.5) * 4, 0.02, (Math.random() - 0.5) * 4);
    m.rotation.x = -Math.PI / 2;
    confettiGroup.add(m);
  }
  root.add(confettiGroup);

  // Play themed background SFX if audioManager supports it.
  let audioHandle = null;
  try {
    if (audioManager?.playBGS) {
      audioHandle = audioManager.playBGS('Festival/FestivalLoop.ogg', 0.55);
    } else if (audioManager?.playSFX) {
      // fall back to SFX (may not loop depending on implementation)
      audioHandle = audioManager.playSFX('Festival/FestivalLoop.ogg', 0.55);
    }
  } catch (e) {
    // ignore missing assets / autoplay blocks
  }

  let active = true;
  function setActive(next) {
    active = !!next;
    root.visible = active;
    if (!active) {
      try {
        if (audioHandle?.stop) audioHandle.stop();
        if (audioHandle?.pause) audioHandle.pause();
      } catch (e) {}
      audioHandle = null;
    } else {
      if (!audioHandle && audioManager?.playBGS) {
        try { audioHandle = audioManager.playBGS('Festival/FestivalLoop.ogg', 0.55); } catch (e) {}
      }
    }
  }

  // Update: small pulsing of lantern emissive and banner sway; gentle follow player
  function update(delta) {
    if (!active) return;
    const t = performance.now() * 0.001;
    for (let i = 0; i < lanterns.length; i++) {
      const m = lanterns[i].material;
      m.emissiveIntensity = 0.8 + Math.sin(t * 3 + i * 0.6) * 0.25;
    }
    banners.children.forEach((b, idx) => {
      b.rotation.z = Math.sin(t * 1.2 + idx) * 0.06;
    });

    // Follow player lightly so decorations feel tied to current area
    if (playerModel && playerModel.position) {
      const target = new THREE.Vector3(playerModel.position.x, 0, playerModel.position.z);
      root.position.lerp(target, Math.min(1, delta * 0.5));
    }
  }

  function dispose() {
    try {
      if (root.parent) root.parent.remove(root);
    } catch (e) {}
    // dispose geometries/materials where possible
    lanternGeom.dispose?.();
    bannerGeom.dispose?.();
    confettiGeo.dispose?.();
    // Stop audio if any
    try {
      if (audioHandle?.stop) audioHandle.stop();
    } catch (e) {}
  }

  return {
    setActive,
    update,
    dispose
  };
}

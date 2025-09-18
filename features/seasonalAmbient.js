/**
 * Seasonal ambient variations: lightweight spring/summer/winter effects.
 *
 * - Exports initSeasonalAmbient(THREE, { scene, playerModel, audioManager })
 * - No top-level side-effects on import.
 *
 * The controller returned implements:
 *  - setSeason(season) // 'spring' | 'summer' | 'winter'
 *  - setActive(bool)
 *  - update(delta)
 *
 * Implementation is intentionally small and performant: simple Points systems
 * and a warming/cooling tint; audio playback uses audioManager when available.
 */

export function initSeasonalAmbient(THREE, { scene, playerModel, audioManager } = {}) {
  if (!THREE) throw new Error('THREE is required');
  if (!scene) throw new Error('scene is required');

  const root = new THREE.Group();
  root.name = 'seasonal-ambient';
  root.userData.__seasonal = true;

  // Particle buffers (shared for reuse)
  const MAX_PARTICLES = 300;
  const positions = new Float32Array(MAX_PARTICLES * 3);
  const velocities = new Float32Array(MAX_PARTICLES * 3);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setDrawRange(0, 0);

  const material = new THREE.PointsMaterial({
    size: 0.06,
    transparent: true,
    depthWrite: false,
    opacity: 0.9,
    color: 0xffffff
  });

  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  root.add(points);

  // Simple seasonal light/tint helpers
  const seasonTint = new THREE.Color(0xffffff);
  const seasonLight = new THREE.PointLight(0xffffff, 0.0, 10);
  seasonLight.position.set(0, 4, 0);
  root.add(seasonLight);

  scene.add(root);

  let active = true;
  let particleCount = 0;
  let season = detectDefaultSeason();
  let audioHandle = null;

  function detectDefaultSeason() {
    // Simple month-based default: Mar-May = spring, Jun-Aug = summer, else winter
    const m = new Date().getMonth(); // 0..11
    if (m >= 2 && m <= 4) return 'spring';
    if (m >= 5 && m <= 7) return 'summer';
    return 'winter';
  }

  function initParticlesForSeason(s) {
    particleCount = Math.floor(MAX_PARTICLES * (s === 'summer' ? 0.25 : 0.6));
    geometry.setDrawRange(0, particleCount);
    for (let i = 0; i < particleCount; i++) {
      // spawn particles around playerModel or at origin if unset
      const base = playerModel?.position ?? new THREE.Vector3(0, 0, 0);
      const x = base.x + (Math.random() - 0.5) * 8;
      const y = base.y + 1 + Math.random() * 3;
      const z = base.z + (Math.random() - 0.5) * 8;
      positions[i * 3 + 0] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;

      // velocities: upward for spring, gentle drift for summer, downward for winter
      if (s === 'spring') {
        velocities[i * 3 + 0] = (Math.random() - 0.5) * 0.15;
        velocities[i * 3 + 1] = 0.2 + Math.random() * 0.2;
        velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.15;
      } else if (s === 'summer') {
        velocities[i * 3 + 0] = (Math.random() - 0.5) * 0.06;
        velocities[i * 3 + 1] = (Math.random() - 0.5) * 0.02;
        velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.06;
      } else {
        velocities[i * 3 + 0] = (Math.random() - 0.5) * 0.12;
        velocities[i * 3 + 1] = -0.2 - Math.random() * 0.2;
        velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.12;
      }
    }
    geometry.attributes.position.needsUpdate = true;

    // season-specific material tweaks
    if (s === 'spring') {
      material.color.set(0xa6ffda); // soft greenish petals
      material.size = 0.06;
      material.opacity = 0.9;
      seasonLight.color.set(0xa6ffda);
      seasonLight.intensity = 0.25;
      tryPlaySeasonBGS('ambient_spring.ogg', 0.5);
    } else if (s === 'summer') {
      material.color.set(0xffe9a6); // warm sparkle
      material.size = 0.045;
      material.opacity = 0.7;
      seasonLight.color.set(0xffe9a6);
      seasonLight.intensity = 0.18;
      tryPlaySeasonBGS('ambient_summer.ogg', 0.45);
    } else {
      material.color.set(0xffffff); // snow
      material.size = 0.08;
      material.opacity = 0.95;
      seasonLight.color.set(0xcfe8ff);
      seasonLight.intensity = 0.22;
      tryPlaySeasonBGS('ambient_winter.ogg', 0.35);
    }
  }

  function tryPlaySeasonBGS(path, volume = 0.5) {
    // Prefer audioManager.playBGS if available; otherwise no-op.
    try {
      if (audioManager?.playBGS) {
        // stop previous if it exposes stopBGS
        if (audioHandle?.stop) audioHandle.stop();
        audioHandle = audioManager.playBGS(path, volume);
      }
    } catch (e) {
      // silently ignore missing assets or autoplay blocks
    }
  }

  function setSeason(s) {
    if (!s || (s !== 'spring' && s !== 'summer' && s !== 'winter')) return;
    season = s;
    initParticlesForSeason(season);
  }

  function setActive(val) {
    active = !!val;
    root.visible = active;
    if (!active) {
      // stop audio but keep geometry for quick resume
      try { if (audioHandle?.stop) audioHandle.stop(); } catch (e) {}
    } else {
      // restart audio for current season
      initParticlesForSeason(season);
    }
  }

  // initialize
  initParticlesForSeason(season);

  function update(delta) {
    if (!active || particleCount === 0) return;
    // particles follow player roughly
    const base = playerModel?.position ?? new THREE.Vector3(0, 0, 0);
    for (let i = 0; i < particleCount; i++) {
      let px = positions[i * 3 + 0];
      let py = positions[i * 3 + 1];
      let pz = positions[i * 3 + 2];

      const vx = velocities[i * 3 + 0];
      const vy = velocities[i * 3 + 1];
      const vz = velocities[i * 3 + 2];

      px += vx * delta;
      py += vy * delta;
      pz += vz * delta;

      // recycle logic: keep within a region around player
      const relX = px - base.x;
      const relZ = pz - base.z;
      if (py < base.y - 2 || py > base.y + 6 || Math.hypot(relX, relZ) > 12) {
        // respawn around player
        px = base.x + (Math.random() - 0.5) * 8;
        py = base.y + 1 + Math.random() * 3;
        pz = base.z + (Math.random() - 0.5) * 8;
      }

      positions[i * 3 + 0] = px;
      positions[i * 3 + 1] = py;
      positions[i * 3 + 2] = pz;
    }
    geometry.attributes.position.needsUpdate = true;

    // gentle pulse for season light
    seasonLight.position.set(base.x, base.y + 3.5, base.z);
    seasonLight.intensity = 0.18 + Math.sin(performance.now() * 0.001 + season.length) * 0.02;
  }

  return {
    setSeason,
    setActive,
    update,
    getSeason: () => season,
    dispose() {
      try {
        scene.remove(root);
        geometry.dispose?.();
        material.dispose?.();
        if (audioHandle?.stop) audioHandle.stop();
      } catch (e) {}
    }
  };
}

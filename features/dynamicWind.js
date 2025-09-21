/**
 * features/dynamicWind.js
 *
 * Small, lazily-initialized wind/leaf particle ambient effect.
 * - No top-level side-effects. Call initDynamicWind(...) to create controller.
 *
 * Usage:
 *   const ctrl = initDynamicWind(THREE, { scene, playerModel, audioManager, options });
 *   ctrl.setActive(true);
 *   // call ctrl.update(delta) from the main loop
 *   // call ctrl.dispose() when tearing down
 */

export function initDynamicWind(THREE, { scene, playerModel, audioManager, options = {} } = {}) {
  if (!THREE) throw new Error('THREE is required');
  if (!scene) throw new Error('scene is required');
  if (!playerModel) throw new Error('playerModel is required');

  const COUNT = options.count || 120;
  const positions = new Float32Array(COUNT * 3);
  const velocities = new Float32Array(COUNT * 3);

  // Init positions in a broad area around origin; heights above ground
  for (let i = 0; i < COUNT; i++) {
    const ix = i * 3;
    positions[ix] = (Math.random() - 0.5) * 20;
    positions[ix + 1] = 2.5 + Math.random() * 3.5; // 2.5 - 6.0m
    positions[ix + 2] = (Math.random() - 0.5) * 20;
    velocities[ix] = (Math.random() - 0.5) * 0.02;
    velocities[ix + 1] = -Math.random() * 0.02;
    velocities[ix + 2] = (Math.random() - 0.5) * 0.02;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  const mat = new THREE.PointsMaterial({
    color: 0x88ccff,
    size: 0.09,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    sizeAttenuation: true
  });

  const points = new THREE.Points(geo, mat);
  points.name = 'dynamic-wind-particles';
  points.frustumCulled = false;
  scene.add(points);

  let active = false;
  const lastPlayerPos = playerModel.position.clone();
  let time = 0;
  // 0..1 measure of wind intensity (smoothed). Read via getIntensity().
  let _intensity = 0;

  /**
   * Toggle visibility / activity of wind effect
   * @param {boolean} v
   */
  function setActive(v) {
    active = !!v;
    points.visible = active;
  }

  /**
   * Update particle positions. Call once per frame from main loop.
   * @param {number} delta
   */
  function update(delta) {
    if (!active) return;
    time += delta;
    // Player movement influence (small gusts when moving)
    const dx = playerModel.position.x - lastPlayerPos.x;
    const dz = playerModel.position.z - lastPlayerPos.z;
    const moveStrength = Math.min(1, Math.hypot(dx, dz) * 8);
    lastPlayerPos.copy(playerModel.position);

    const posAttr = geo.getAttribute('position');
    const p = posAttr.array;

    // accumulate a simple measure of particle motion to help compute intensity
    let sumVel = 0;

    for (let i = 0; i < COUNT; i++) {
      const ix = i * 3;
      // simple oscillation + random jitter + player-induced gusts
      velocities[ix] += Math.sin(time * 1.2 + i) * 0.0006 + (Math.random() - 0.5) * 0.0006 + dx * 0.002;
      velocities[ix + 1] += Math.cos(time * 0.9 + i) * 0.0003 - 0.00025 + (Math.random() - 0.5) * 0.0002;
      velocities[ix + 2] += Math.cos(time * 1.05 + i) * 0.0005 + dz * 0.002;

      // accumulate horizontal velocity magnitude for intensity calculation
      sumVel += Math.hypot(velocities[ix], velocities[ix + 2]);

      p[ix] += velocities[ix] * (1 + moveStrength * 0.9);
      p[ix + 1] += velocities[ix + 1];
      p[ix + 2] += velocities[ix + 2] * (1 + moveStrength * 0.9);

      // simple vertical wrap: recycle particles that fall too low or float too high
      if (p[ix + 1] < 0.15) {
        p[ix + 1] = 3 + Math.random() * 3;
      } else if (p[ix + 1] > 8) {
        p[ix + 1] = 3 + Math.random() * 1.5;
      }

      // horizontal bounds wrap to keep particles near playable area
      if (p[ix] > 40) p[ix] = -40 + Math.random() * 2;
      if (p[ix] < -40) p[ix] = 40 - Math.random() * 2;
      if (p[ix + 2] > 40) p[ix + 2] = -40 + Math.random() * 2;
      if (p[ix + 2] < -40) p[ix + 2] = 40 - Math.random() * 2;
    }

    posAttr.needsUpdate = true;

    // subtle visual feedback: strengthen opacity when player is moving
    mat.opacity = Math.max(0.18, 0.45 + moveStrength * 0.45);

    // Compute a 0..1 intensity combining player motion and particle motion.
    // - avg particle velocity is normalized against an empirical max (~0.02)
    // - moveStrength already normalized 0..1
    try {
      const avgVel = sumVel / Math.max(1, COUNT);
      const velStrength = Math.min(1, avgVel / 0.02);
      const combined = Math.min(1, Math.max(moveStrength, velStrength));
      // smooth the intensity to avoid rapid jumps
      _intensity = _intensity * 0.92 + combined * 0.08;
    } catch (e) {
      // ignore any numeric issues
      _intensity = Math.max(0, Math.min(1, moveStrength));
    }
  }

  function dispose() {
    if (points.parent) points.parent.remove(points);
    geo.dispose && geo.dispose();
    mat.dispose && mat.dispose();
  }

  // Expose getIntensity so other ambient controllers (e.g. floating lanterns)
  // can read current wind intensity in a safe, read-only way.
  function getIntensity() {
    return Math.max(0, Math.min(1, _intensity));
  }

  return { setActive, update, dispose, getIntensity };
}

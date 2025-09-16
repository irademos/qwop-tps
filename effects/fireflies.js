export function createFireflies(THREE, { scene, playerModel, audioManager } = {}) {
  if (!THREE) throw new Error('THREE is required');
  if (!scene) throw new Error('scene is required');
  if (!playerModel) throw new Error('playerModel is required');

  // Group to hold points
  const group = new THREE.Group();
  group.name = 'fireflies';

  const COUNT = 60;
  const positions = new Float32Array(COUNT * 3);
  const baseOffsets = new Array(COUNT);

  for (let i = 0; i < COUNT; i++) {
    const r = 0.6 + Math.random() * 2.2;
    const theta = Math.random() * Math.PI * 2;
    const y = -0.2 + Math.random() * 1.6;
    positions[i * 3] = Math.cos(theta) * r;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = Math.sin(theta) * r;
    baseOffsets[i] = {
      r,
      theta,
      y,
      speed: 0.2 + Math.random() * 0.6,
      phase: Math.random() * Math.PI * 2
    };
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  const mat = new THREE.PointsMaterial({
    color: 0xffee88,
    size: 0.08,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });

  const points = new THREE.Points(geom, mat);
  group.add(points);

  let active = false;
  let time = 0;

  /**
   * Activate or deactivate the effect.
   * safe to call multiple times.
   */
  function setActive(next) {
    next = !!next;
    if (next === active) return;
    active = next;
    if (active) {
      // place near player initially
      const p = playerModel.position;
      group.position.set(p.x, p.y + 1.0, p.z);
      scene.add(group);
      try { audioManager?.playSFX?.('ui/toggle-on.ogg', 0.22); } catch (e) {}
    } else {
      if (group.parent) group.parent.remove(group);
      try { audioManager?.playSFX?.('ui/toggle-off.ogg', 0.18); } catch (e) {}
    }
  }

  /**
   * Update loop (call from app animation loop).
   */
  function update(dt) {
    if (!active) return;
    time += dt;
    const posAttr = geom.getAttribute('position');
    for (let i = 0; i < COUNT; i++) {
      const off = baseOffsets[i];
      const idx = i * 3;
      off.theta += dt * (0.2 + off.speed * 0.3);
      const r = off.r;
      posAttr.array[idx] = Math.cos(off.theta + off.phase) * r + Math.sin(time * 0.6) * 0.02;
      posAttr.array[idx + 1] = off.y + Math.sin(time * off.speed + off.phase) * 0.12;
      posAttr.array[idx + 2] = Math.sin(off.theta + off.phase) * r + Math.cos(time * 0.6) * 0.02;
    }
    posAttr.needsUpdate = true;

    // gently follow the player
    const target = new THREE.Vector3(playerModel.position.x, playerModel.position.y + 1.0, playerModel.position.z);
    group.position.lerp(target, 0.08);

    // soft flicker
    mat.opacity = 0.5 + Math.abs(Math.sin(time * 4 + 0.3)) * 0.45;
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

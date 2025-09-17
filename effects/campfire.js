/**
 * Lightweight campfire ambient effect.
 * - Lazy-loadable; no side-effects at import.
 * - Exposes setActive(enabled), update(dt), dispose().
 *
 * createCampfire(THREE, { scene, playerModel, audioManager })
 */
export function createCampfire(THREE, { scene, playerModel, audioManager } = {}) {
  if (!THREE) throw new Error('THREE is required');
  if (!scene) throw new Error('scene is required');
  if (!playerModel) throw new Error('playerModel is required');

  const group = new THREE.Group();
  group.name = 'campfire-effect';
  group.position.copy(playerModel.position).add(new THREE.Vector3(-1.2, 0, -1.2));

  // Simple logs (cylinder)
  const logGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.6, 8);
  const logMat = new THREE.MeshStandardMaterial({ color: 0x6b3e1d, roughness: 0.9 });
  const log1 = new THREE.Mesh(logGeo, logMat);
  log1.rotation.z = Math.PI * 0.15;
  log1.position.set(0, 0.12, 0);
  group.add(log1);

  const log2 = log1.clone();
  log2.rotation.z = -Math.PI * 0.15;
  log2.position.set(0, 0.12, 0);
  group.add(log2);

  // Flame (simple cone with emissive material)
  const flameGeo = new THREE.ConeGeometry(0.18, 0.4, 10);
  const flameMat = new THREE.MeshStandardMaterial({ color: 0xff8a33, emissive: 0xff6a00, emissiveIntensity: 0.9, roughness: 0.6 });
  const flame = new THREE.Mesh(flameGeo, flameMat);
  flame.position.set(0, 0.35, 0);
  group.add(flame);

  // Warm point light
  const light = new THREE.PointLight(0xffbb66, 1.0, 6);
  light.position.set(0, 0.6, 0);
  group.add(light);

  // subtle particle hint: a small sprite to simulate glow (if available)
  let sprite = null;
  try {
    const spriteMat = new THREE.SpriteMaterial({ color: 0xffc28a, opacity: 0.6, transparent: true });
    sprite = new THREE.Sprite(spriteMat);
    sprite.scale.set(0.6, 0.6, 0.6);
    sprite.position.set(0, 0.6, 0);
    group.add(sprite);
  } catch (e) {
    // ignore sprite support issues
  }

  let active = false;
  let time = 0;

  function setActive(next) {
    if (next === active) return;
    active = !!next;
    if (active) {
      if (!group.parent) scene.add(group);
      // Optionally play a small crackle SFX (best-effort; non-blocking)
      try {
        audioManager?.playSFX?.('ambient/campfire_crackle.ogg', 0.6);
      } catch (e) {
        // ignore missing asset
      }
    } else {
      if (group.parent) group.parent.remove(group);
    }
  }

  function update(dt) {
    if (!active) return;
    time += dt;
    // follow behind-left of player smoothly
    const target = playerModel.position.clone().add(new THREE.Vector3(-1.2, 0, -1.2));
    group.position.lerp(target, Math.min(1, dt * 6));

    // pulsate flame/light
    const pulse = 0.8 + Math.sin(time * 8) * 0.15 + Math.random() * 0.03;
    flame.scale.set(1, 0.9 + Math.sin(time * 10) * 0.08, 1);
    light.intensity = pulse;
    flame.material.emissiveIntensity = 0.7 + Math.abs(Math.sin(time * 10)) * 0.6;
    if (sprite) sprite.material.opacity = 0.45 + Math.abs(Math.sin(time * 6)) * 0.3;
  }

  function dispose() {
    if (group.parent) group.parent.remove(group);
    flameGeo?.dispose?.();
    flameMat?.dispose?.();
    logGeo?.dispose?.();
    logMat?.dispose?.();
    sprite?.material?.dispose?.();
    // remove references
  }

  return {
    setActive,
    update,
    dispose
  };
}

/**
 * features/campfire.js
 *
 * Small, self-contained campfire prop:
 * - creates a tiny emissive ember + point light
 * - spawns simple smoke sprites that rise and fade
 * - follows the player (keeps placement near player's feet)
 *
 * Exported API:
 *   createCampfire(THREE, { scene, playerModel, options })
 *     -> { setActive(boolean), update(delta), destroy() }
 *
 * No top-level side-effects on import.
 */

export function createCampfire(THREE, { scene, playerModel, options = {} } = {}) {
  if (!THREE) throw new Error('THREE is required');
  if (!scene) throw new Error('scene is required');
  if (!playerModel) throw new Error('playerModel is required');

  const group = new THREE.Group();
  group.name = 'campfire';
  // relative offset from player where the campfire will be placed
  const placementOffset = options.offset || new THREE.Vector3(1.4, 0, -1.4);

  // simple logs (three short cylinders)
  const logMat = new THREE.MeshStandardMaterial({ color: 0x5b2f0c, roughness: 0.9, metalness: 0.0 });
  for (let i = 0; i < 3; i++) {
    const logGeo = new THREE.CylinderGeometry(0.08, 0.08, 0.9, 8);
    const log = new THREE.Mesh(logGeo, logMat);
    log.rotation.z = (i - 1) * 0.35;
    log.rotation.y = Math.random() * 0.6 - 0.3;
    log.position.set(Math.sin(i) * 0.12, 0.05, (i - 1) * 0.06);
    log.castShadow = true;
    log.receiveShadow = true;
    group.add(log);
  }

  // ember/glow
  const emberMat = new THREE.MeshStandardMaterial({
    color: 0xff8c42,
    emissive: 0xff3300,
    emissiveIntensity: 1.0,
    roughness: 0.6,
    metalness: 0.0
  });
  const ember = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), emberMat);
  ember.position.set(0, 0.18, 0);
  group.add(ember);

  // small point light with gentle radius
  const light = new THREE.PointLight(0xffb07a, 1.0, 8, 2);
  light.position.set(0, 0.35, 0);
  group.add(light);

  // smoke sprites (simple rising/fading sprites)
  const smokeSprites = [];
  const smokeBaseCount = options.smokeCount || 6;
  const createSmokeSprite = () => {
    const mat = new THREE.SpriteMaterial({
      color: 0x777777,
      opacity: 0.0,
      transparent: true,
      depthWrite: false
    });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(0.45, 0.6, 1);
    sprite.position.set((Math.random() - 0.5) * 0.3, 0.12 + Math.random() * 0.12, (Math.random() - 0.5) * 0.3);
    group.add(sprite);
    return { sprite, life: 0, ttl: 0 };
  };
  for (let i = 0; i < smokeBaseCount; i++) {
    smokeSprites.push(createSmokeSprite());
  }

  // initial placement near player
  function getPlacement() {
    return playerModel.position.clone().add(placementOffset);
  }
  group.position.copy(getPlacement());
  scene.add(group);

  let active = true;
  let time = 0;

  function setActive(v) {
    active = Boolean(v);
    group.visible = active;
  }

  function update(delta) {
    if (!active) return;
    time += delta;

    // keep campfire near player feet
    try {
      const p = getPlacement();
      group.position.x = p.x;
      group.position.z = p.z;
      // keep on ground (y)
      group.position.y = p.y;
    } catch (e) {
      // ignore if playerModel becomes unavailable briefly
    }

    // flicker light & ember
    const flicker = 0.15 * Math.sin(time * 8) + Math.random() * 0.08;
    const intensity = 0.9 + Math.abs(flicker) + (Math.random() * 0.12);
    light.intensity = intensity;
    ember.material.emissiveIntensity = Math.max(0.2, intensity * 0.9);

    // update smoke sprites: spawn, rise, fade, recycle
    smokeSprites.forEach((rec, idx) => {
      if (rec.life <= 0) {
        // small chance to spawn this frame
        if (Math.random() < 0.035 + (idx * 0.002)) {
          rec.ttl = 1.0 + Math.random() * 1.3;
          rec.life = rec.ttl;
          rec.sprite.material.opacity = 0.65 + Math.random() * 0.25;
          rec.sprite.position.set((Math.random() - 0.5) * 0.25, 0.12, (Math.random() - 0.5) * 0.25);
          rec.sprite.scale.set(0.35 + Math.random() * 0.4, 0.5 + Math.random() * 0.6, 1);
        }
      } else {
        // alive: rise and fade
        rec.life -= delta;
        const t = 1 - (rec.life / rec.ttl);
        rec.sprite.position.y += delta * (0.25 + t * 0.6);
        rec.sprite.position.x += (Math.random() - 0.5) * delta * 0.02;
        rec.sprite.position.z += (Math.random() - 0.5) * delta * 0.02;
        rec.sprite.material.opacity = Math.max(0, (rec.life / rec.ttl) * 0.65);
        // slowly grow
        const s = 0.9 + t * 1.4;
        rec.sprite.scale.set(s * 0.35, s * 0.6, 1);

        if (rec.life <= 0) {
          // recycle: hide until respawn
          rec.sprite.material.opacity = 0.0;
        }
      }
    });
  }

  function destroy() {
    try {
      smokeSprites.forEach(r => {
        group.remove(r.sprite);
        if (r.sprite.material) r.sprite.material.dispose();
        if (r.sprite.geometry) r.sprite.geometry.dispose();
      });
      if (ember.geometry) ember.geometry.dispose();
      if (ember.material) ember.material.dispose();
      scene.remove(group);
    } catch (e) {}
  }

  return {
    setActive,
    update,
    destroy
  };
}

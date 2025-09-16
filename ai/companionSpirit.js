/**
 * ai/companionSpirit.js
 *
 * Lightweight companion "spirit" orb that follows the player.
 * - Exported factory: createCompanionSpirit(THREE, { scene, playerModel, audioManager })
 * - No top-level side-effects on import. All scene work happens when factory is called.
 *
 * The controller returned implements:
 *  - setActive(Boolean)        // toggle visible/active
 *  - update(deltaSeconds)      // called each frame to animate / follow player
 *  - dispose()                 // cleanup (remove from scene, dispose geometries/materials)
 *
 * Design notes:
 *  - Small, inexpensive THREE.Mesh (sphere) + small PointLight.
 *  - Smooth follow using lerp; small bob and orbit offset for visual interest.
 *  - Plays optional audioManager.playSFX if provided on activation.
 */

/**
 * Create a companion spirit controller.
 * @param {typeof import('three')} THREE
 * @param {{ scene: import('three').Scene, playerModel: import('three').Object3D, audioManager?: any }} opts
 */
export function createCompanionSpirit(THREE, { scene, playerModel, audioManager } = {}) {
  if (!THREE) throw new Error('THREE is required');
  if (!scene) throw new Error('scene is required');
  if (!playerModel) throw new Error('playerModel is required');

  // Visuals
  const geom = new THREE.SphereGeometry(0.14, 16, 12);
  const mat = new THREE.MeshStandardMaterial({
    color: 0x88ccff,
    emissive: 0x66ddff,
    emissiveIntensity: 0.9,
    roughness: 0.3,
    metalness: 0.0,
    transparent: true,
    opacity: 0.95,
    depthWrite: false
  });
  const orb = new THREE.Mesh(geom, mat);
  orb.castShadow = false;
  orb.receiveShadow = false;

  // Gentle glow: small PointLight parented to orb
  const light = new THREE.PointLight(0x66ddff, 0.6, 3.5, 2);
  light.castShadow = false;
  orb.add(light);

  // Group so we can offset/orbit easily
  const group = new THREE.Group();
  group.add(orb);

  // Start hidden until activated
  group.visible = false;
  scene.add(group);

  // Internal state
  let active = false;
  let time = 0;
  const followPos = new THREE.Vector3();
  const targetPos = new THREE.Vector3();
  const velocity = new THREE.Vector3();

  // Parameters (tweakable)
  const lerpFactor = 0.12; // smoothness of following
  const followHeight = 1.6;
  const orbitRadius = 0.5;
  const bobAmplitude = 0.06;
  const bobSpeed = 2.0;

  // Try to play a subtle sound when toggled on
  function tryPlayToggleSound() {
    try {
      audioManager?.playSFX?.('ui/toggle-on.ogg', 0.6);
    } catch (e) {
      // ignore missing assets
    }
  }

  function setActive(next) {
    const want = !!next;
    if (want === active) return active;
    active = want;
    group.visible = active;
    if (active) {
      // position immediately near player to avoid pop
      const p = playerModel.position;
      group.position.set(p.x, p.y + followHeight, p.z - orbitRadius);
      time = 0;
      tryPlayToggleSound();
    } else {
      try {
        audioManager?.playSFX?.('ui/toggle-off.ogg', 0.4);
      } catch (e) {}
    }
    return active;
  }

  /**
   * Per-frame update. Should be driven from app's animation loop.
   * @param {number} deltaSeconds
   */
  function update(deltaSeconds) {
    if (!active) return;
    time += deltaSeconds;

    // Target orbits slightly to the right of facing direction, so it's visible
    // Compute a small orbit offset using time
    const orbitAngle = time * 1.2;
    const ox = Math.cos(orbitAngle) * orbitRadius;
    const oz = Math.sin(orbitAngle) * orbitRadius * 0.45;

    // Target: a point offset from playerModel.position
    targetPos.copy(playerModel.position);
    targetPos.y += followHeight + Math.sin(time * bobSpeed) * bobAmplitude;
    // Apply offset in local camera/player space - simple world offset on X/Z
    targetPos.x += ox;
    targetPos.z += oz;

    // Smoothly lerp group.position -> targetPos
    followPos.lerpVectors(group.position, targetPos, lerpFactor);
    group.position.copy(followPos);

    // Subtle orientation: face the player
    const lookAt = playerModel.position.clone();
    group.lookAt(lookAt);

    // Gentle pulsing emissive intensity
    const pulse = 0.85 + Math.sin(time * 3.0) * 0.12;
    mat.emissiveIntensity = Math.max(0.4, pulse);

    // Slight scale breathing
    const s = 1 + Math.sin(time * 2.5) * 0.04;
    orb.scale.setScalar(s);
  }

  function dispose() {
    // remove from scene and dispose
    if (group.parent) group.parent.remove(group);
    geom.dispose?.();
    mat.dispose?.();
    // detach light (no dispose required)
  }

  return {
    setActive,
    update,
    dispose
  };
}

/**
 * features/companionOrb.js
 *
 * Lightweight companion orb that follows the player. Lazy-load this module and
 * create an instance via createCompanionOrb(THREE, { scene, playerModel, audioManager }).
 *
 * No top-level side-effects.
 */

/**
 * Create a simple companion orb that follows the player.
 * @param {object} THREE - three.js namespace
 * @param {object} options
 * @param {THREE.Scene} options.scene
 * @param {THREE.Object3D} options.playerModel
 * @param {object} [options.audioManager]
 * @returns {{ setActive: function(boolean), update: function(number), dispose: function() }}
 */
export function createCompanionOrb(THREE, { scene, playerModel, audioManager } = {}) {
  if (!THREE) throw new Error('THREE is required');
  if (!scene) throw new Error('scene is required');
  if (!playerModel) throw new Error('playerModel is required');

  const group = new THREE.Group();
  group.name = 'companion-orb';

  const geom = new THREE.SphereGeometry(0.14, 16, 12);
  const mat = new THREE.MeshStandardMaterial({
    color: 0x88ccff,
    emissive: 0x66ddff,
    emissiveIntensity: 1.0,
    roughness: 0.4,
    metalness: 0.0,
    transparent: true,
    opacity: 0.95
  });

  const mesh = new THREE.Mesh(geom, mat);
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.position.set(0, 0, 0);
  group.add(mesh);

  const light = new THREE.PointLight(0x66ddff, 0.9, 6, 2);
  light.position.set(0, 0, 0);
  group.add(light);

  // Start hidden until activated
  group.visible = false;
  scene.add(group);

  let active = false;
  let bobOffset = Math.random() * Math.PI * 2;

  function tryPlayToggleSound() {
    try {
      audioManager?.playSFX?.('ui/toggle-on.ogg', 0.6);
    } catch (e) {
      // ignore missing assets
    }
  }

  function setActive(next) {
    active = !!next;
    group.visible = active;
    tryPlayToggleSound();
  }

  /**
   * Update should be called from main animation loop with delta seconds.
   * Smoothly follows the player and performs a small bob.
   * @param {number} dt
   */
  function update(dt) {
    if (!active) return;
    const target = playerModel.position.clone();
    target.y += 1.6; // hover above head

    // Smooth follow (lerp)
    group.position.lerp(target, Math.min(1, dt * 6));

    // Bobbing
    bobOffset += dt * 3.0;
    const bob = Math.sin(bobOffset) * 0.12;
    mesh.position.y = bob;
    light.position.y = bob;
  }

  function dispose() {
    if (group.parent) group.parent.remove(group);
    try { geom.dispose(); } catch (e) { /* ignore */ }
    try { mat.dispose(); } catch (e) { /* ignore */ }
  }

  return { setActive, update, dispose };
}

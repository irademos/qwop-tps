/**
 * features/companionNPC.js
 *
 * Small companion NPC that gently follows the player and displays
 * occasional contextual tips via the provided toasts manager.
 *
 * - Exported factory: createCompanionNPC(THREE, { scene, playerModel, audioManager, toasts })
 * - No top-level side-effects on import.
 */

export function createCompanionNPC(THREE, { scene, playerModel, audioManager, toasts } = {}) {
  if (!THREE) throw new Error('THREE is required');
  if (!scene) throw new Error('scene is required');
  if (!playerModel) throw new Error('playerModel is required');

  const group = new THREE.Group();
  group.name = 'companion-npc';
  group.visible = false;

  // Visual: small emissive orb with subtle bob
  const geom = new THREE.SphereGeometry(0.12, 12, 10);
  const mat = new THREE.MeshStandardMaterial({
    color: 0x88ffcc,
    emissive: 0x66ffdd,
    roughness: 0.4,
    metalness: 0.0,
    transparent: true,
    opacity: 0.95
  });
  const orb = new THREE.Mesh(geom, mat);
  orb.castShadow = false;
  orb.receiveShadow = false;
  orb.renderOrder = 1000;
  group.add(orb);

  // Subtle point light to make it readable in different lighting
  const light = new THREE.PointLight(0x88ffcc, 0.6, 6);
  light.castShadow = false;
  group.add(light);

  scene.add(group);

  // State
  let active = false;
  let lastTipTs = 0;
  let tipInterval = 12000 + Math.random() * 8000; // ms
  let prevPos = playerModel.position.clone();
  let idleSince = Date.now();

  // Helpers
  function randBetween(a, b) { return a + Math.random() * (b - a); }
  function maybePlaySFX() {
    try {
      audioManager?.playSFX?.('ui/tip.ogg', 0.6);
    } catch (e) {
      // ignore missing assets
    }
  }

  function chooseTip() {
    // Prefer contextual tips: health, nearby monsters, movement, generic hint.
    try {
      if (typeof window !== 'undefined' && window.localHealth != null && window.localHealth <= 35) {
        return 'Your health is low — try finding food or resting.';
      }
      const monster = typeof window !== 'undefined' ? window.monster : null;
      if (monster && monster.position) {
        const d = monster.position.distanceTo(playerModel.position);
        if (d < 8) return 'Danger nearby — keep your distance and aim carefully.';
        if (d < 16) return 'I sense a creature not far from here.';
      }
      // Idle tip: player hasn't moved much
      const moved = playerModel.position.distanceTo(prevPos) > 0.4;
      if (!moved && (Date.now() - idleSince) > 16000) {
        return 'Try exploring the world — there are secrets all around.';
      }
      // Fallback helpful hints
      const hints = [
        'You can press B to spawn a block.',
        'Hold N to burst-fire blocks.',
        'Try toggling Ambient effects from the Actions menu.',
        'Use the Settings panel to change your character and name.'
      ];
      return hints[Math.floor(Math.random() * hints.length)];
    } catch (e) {
      return 'Hello — I am your companion.';
    }
  }

  function showTip() {
    const tip = chooseTip();
    if (!tip) return;
    try {
      if (toasts && typeof toasts.show === 'function') {
        toasts.show(tip);
      } else {
        // Fallback: console
        console.info('[companion-tip]', tip);
      }
      maybePlaySFX();
    } catch (e) {
      // ignore
    }
  }

  function setActive(next) {
    active = !!next;
    group.visible = active;
    if (!active) return;
    // Reset timers so tip doesn't immediately fire
    lastTipTs = Date.now();
    tipInterval = 12000 + Math.random() * 10000;
    prevPos.copy(playerModel.position);
    idleSince = Date.now();
  }

  function update(dt) {
    if (!active) return;
    // Follow the player with smooth damped motion, hovering slightly above and behind.
    const target = playerModel.position.clone().add(new THREE.Vector3(0, 1.6, -0.7));
    // Slight orbit offset for personality
    const t = performance.now() * 0.001;
    const orbit = new THREE.Vector3(Math.cos(t * 1.4) * 0.18, Math.sin(t * 2.2) * 0.06, Math.sin(t * 1.0) * 0.12);
    target.add(orbit);

    // Smooth approach
    group.position.lerp(target, Math.min(1, dt * 6));

    // Slight bob on orb
    orb.position.y = Math.sin(t * 3.2) * 0.03;

    // Light follows orb
    light.position.copy(orb.position);

    // Tip scheduling
    const now = Date.now();
    // Update idle tracking
    if (playerModel.position.distanceTo(prevPos) > 0.3) {
      prevPos.copy(playerModel.position);
      idleSince = now;
    }

    if (now - lastTipTs > tipInterval) {
      showTip();
      lastTipTs = now;
      tipInterval = 10000 + Math.random() * 14000;
    }
  }

  function dispose() {
    try { scene.remove(group); } catch (e) {}
    try { geom.dispose(); } catch (e) {}
    try { mat.dispose(); } catch (e) {}
  }

  return {
    setActive,
    update,
    dispose
  };
}

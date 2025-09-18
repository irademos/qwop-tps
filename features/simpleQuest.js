/**
 * Simple fetch-and-return quest system.
 *
 * - Export initSimpleQuest(THREE, { scene, playerModel, audioManager, toasts } = {})
 * - Creates a small NPC and a glowing "lost crystal" orb somewhere near the player.
 * - Player can pick up the orb by approaching it; orb attaches to player.
 * - Returning to the NPC with the orb completes the quest (toast + sfx) and respawns the orb later.
 *
 * No top-level side effects; all created objects are returned via a controller.
 */

/**
 * @param {object} THREE - three.js namespace
 * @param {object} opts
 * @param {THREE.Scene} opts.scene
 * @param {THREE.Object3D} opts.playerModel
 * @param {object} [opts.audioManager]
 * @param {object} [opts.toasts]
 * @returns {{ update: (dt:number)=>void, setActive:(b:boolean)=>void, dispose:()=>void }}
 */
export function initSimpleQuest(THREE, { scene, playerModel, audioManager, toasts } = {}) {
  if (!THREE) throw new Error('THREE is required');
  if (!scene) throw new Error('scene is required');
  if (!playerModel) throw new Error('playerModel is required');

  const root = new THREE.Group();
  root.name = 'simple-quest-npc';
  // Simple NPC body
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.28, 0.36, 1.0, 10),
    new THREE.MeshStandardMaterial({ color: 0x8b5a2b, roughness: 0.7 })
  );
  body.position.y = 0.5;
  body.castShadow = true;
  root.add(body);

  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.22, 10, 8),
    new THREE.MeshStandardMaterial({ color: 0xffe0bd, roughness: 0.8 })
  );
  head.position.y = 1.05;
  root.add(head);

  // small marker on head to indicate quest-giver
  const crown = new THREE.Mesh(
    new THREE.TorusGeometry(0.18, 0.04, 8, 16),
    new THREE.MeshStandardMaterial({ color: 0xffcc00, emissive: 0x663300, roughness: 0.6 })
  );
  crown.rotation.x = Math.PI / 2;
  crown.position.y = 1.22;
  root.add(crown);

  // initial placement: near the player's spawn point (slightly offset)
  root.position.copy(playerModel.position).add(new THREE.Vector3(3, 0, -1.5));
  root.position.y = playerModel.position.y || 0;
  scene.add(root);

  // Quest orb (the "fetch" item)
  const orbGeom = new THREE.SphereGeometry(0.12, 12, 10);
  const orbMat = new THREE.MeshStandardMaterial({
    color: 0x66ccff,
    emissive: 0x66ddff,
    metalness: 0.0,
    roughness: 0.3,
    transparent: true,
    opacity: 0.95
  });

  let orb = null;
  let orbAttached = null;
  let active = true;
  let picked = false;
  let completed = false;
  let timeAcc = 0;

  function _spawnOrb() {
    if (orb) {
      try { scene.remove(orb); } catch (e) {}
      orb = null;
    }
    const angle = Math.random() * Math.PI * 2;
    const r = 6 + Math.random() * 4;
    const pos = playerModel.position.clone().add(new THREE.Vector3(Math.cos(angle) * r, 0.4, Math.sin(angle) * r));
    orb = new THREE.Mesh(orbGeom, orbMat);
    orb.position.copy(pos);
    orb.name = 'quest-orb';
    orb.castShadow = false;
    orb.receiveShadow = false;
    scene.add(orb);
    picked = false;
    completed = false;
  }

  _spawnOrb();

  // Minimal helper to play SFX safely
  function tryPlaySFX(path, vol = 0.8) {
    try {
      audioManager?.playSFX?.(path, vol);
    } catch (e) {
      // ignore missing assets
    }
  }

  function update(delta) {
    if (!active) return;
    timeAcc += delta;

    // gentle bob for NPC and crown shimmer
    root.position.y = (playerModel.position.y || 0) + Math.sin(timeAcc * 1.5) * 0.02;
    crown.rotation.z = Math.sin(timeAcc * 3) * 0.08;

    // orb idle rotation/bob if present and not picked
    if (orb && !picked) {
      orb.rotation.y += delta * 1.2;
      orb.position.y += Math.sin(timeAcc * 2) * 0.003;
    }

    // If orb exists and player is near -> pick up
    if (orb && !picked) {
      const d = orb.position.distanceTo(playerModel.position);
      if (d < 1.4) {
        // pick up
        picked = true;
        // detach from scene and attach to player (visual)
        try {
          scene.remove(orb);
        } catch (e) {}
        orbAttached = orb;
        orbAttached.position.set(0, 1.35, 0);
        playerModel.add(orbAttached);
        tryPlaySFX('ui/collect.ogg', 0.9);
        try { toasts?.show?.('You picked up the lost crystal! Return it to the Elder.'); } catch (e) {}
        orb = null;
      }
    }

    // If picked and attached, check proximity to NPC to complete
    if (orbAttached && !completed) {
      const globalNpcPos = new THREE.Vector3();
      root.getWorldPosition(globalNpcPos);
      const playerPos = playerModel.position;
      const d2 = playerPos.distanceTo(globalNpcPos);
      if (d2 < 1.6) {
        // Complete quest
        completed = true;
        try { playerModel.remove(orbAttached); } catch (e) {}
        orbAttached = null;
        tryPlaySFX('ui/quest-complete.ogg', 0.9);
        try { toasts?.show?.('Quest complete! Thank you.'); } catch (e) {}
        // small celebratory scale pulse on NPC
        const originalScale = root.scale.clone();
        root.scale.setScalar(1.25);
        setTimeout(() => {
          if (root) root.scale.copy(originalScale);
        }, 450);

        // respawn orb after delay for repeatable quests
        setTimeout(() => {
          if (!active) return;
          _spawnOrb();
        }, 20000);
      }
    }
  }

  function setActive(v) {
    active = !!v;
    if (!active) {
      // hide objects
      try { if (orb) scene.remove(orb); } catch (e) {}
      try { if (orbAttached) playerModel.remove(orbAttached); } catch (e) {}
      root.visible = false;
    } else {
      root.visible = true;
      if (!orb && !picked) _spawnOrb();
    }
  }

  function dispose() {
    try { if (orb) scene.remove(orb); } catch (e) {}
    try { if (orbAttached) playerModel.remove(orbAttached); } catch (e) {}
    try { scene.remove(root); } catch (e) {}
  }

  return { update, setActive, dispose };
}

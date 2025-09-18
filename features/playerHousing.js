/**
 * features/playerHousing.js
 *
 * Small, lightweight player housing showcase:
 * - Creates a tiny house near the player (no UI).
 * - Opens the door when player approaches and shows a toast (if provided).
 * - Exported initializer has no top-level side effects.
 *
 * Usage:
 *   const ctrl = initPlayerHousing(THREE, { scene, playerModel, audioManager, toasts });
 *   // ctrl.setActive(true/false), ctrl.update(dt), ctrl.dispose()
 */

export function initPlayerHousing(THREE, { scene, playerModel, audioManager, toasts } = {}) {
  if (!THREE) throw new Error('THREE is required');
  if (!scene) throw new Error('scene is required');
  if (!playerModel) throw new Error('playerModel is required');

  const group = new THREE.Group();
  group.name = 'player-housing';

  // Simple materials (small memory footprint)
  const wallMat = new THREE.MeshStandardMaterial({ color: 0xeedccb, roughness: 0.9 });
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x884422, roughness: 0.8 });
  const doorMat = new THREE.MeshStandardMaterial({ color: 0x5b3411, roughness: 0.7 });

  // Floor / foundation
  const floor = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.08, 2.4), new THREE.MeshStandardMaterial({ color: 0x7a5a39, roughness: 1.0 }));
  floor.position.y = 0;
  floor.receiveShadow = true;
  group.add(floor);

  // Walls (simple box with slight thickness)
  const walls = new THREE.Mesh(new THREE.BoxGeometry(2.0, 1.2, 1.6), wallMat);
  walls.position.set(0, 0.64, -0.1);
  walls.castShadow = true;
  walls.receiveShadow = true;
  group.add(walls);

  // Roof (pyramid-ish using ConeGeometry)
  const roof = new THREE.Mesh(new THREE.ConeGeometry(1.2, 0.7, 4), roofMat);
  roof.rotation.y = Math.PI / 4;
  roof.position.set(0, 1.2, -0.1);
  roof.castShadow = true;
  group.add(roof);

  // Door (separate mesh, parented to a pivot so we can animate rotation)
  const doorPivot = new THREE.Group();
  doorPivot.position.set(-0.9, 0.28, 0.7); // pivot at left edge of door
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.9, 0.05), doorMat);
  door.position.set(0.4, 0.45, 0); // position relative to pivot so it rotates like a real door
  door.castShadow = true;
  door.userData.isDoor = true;
  doorPivot.add(door);
  group.add(doorPivot);

  // Small porch lamp (emissive point)
  const lamp = new THREE.PointLight(0xffe7b9, 0.8, 4);
  lamp.position.set(0.6, 1.0, 0.9);
  group.add(lamp);

  // Place house near player initially (offset)
  const initialOffset = new THREE.Vector3(3, 0, -4);
  const targetPos = playerModel.position.clone().add(initialOffset);
  group.position.copy(targetPos);

  scene.add(group);

  // Controller state
  let active = true;
  let doorOpen = false;
  let doorProgress = 0; // 0 closed -> 1 fully open
  let triggeredWelcome = false;

  // Public API
  function setActive(v) {
    active = !!v;
    group.visible = active;
  }

  function dispose() {
    try {
      scene.remove(group);
      group.traverse((c) => {
        if (c.geometry) { c.geometry.dispose?.(); }
        if (c.material) { if (Array.isArray(c.material)) c.material.forEach(m => m.dispose?.()); else c.material.dispose?.(); }
      });
    } catch (err) {}
  }

  // update() should be called from the main loop (app.js will call it)
  function update(dt = 0.016) {
    if (!active) return;

    // Smooth-follow the player but keep a stable offset on the XZ plane
    const desired = playerModel.position.clone().add(initialOffset);
    // Keep house on ground y = 0.0 (same as player's ground)
    desired.y = 0;
    group.position.lerp(desired, Math.min(1, dt * 2.0));

    // Distance-based interaction: open door when player is close
    const dist = group.position.distanceTo(playerModel.position);
    const wasOpen = doorOpen;
    if (dist < 3.0) {
      doorOpen = true;
      if (!triggeredWelcome) {
        triggeredWelcome = true;
        // Friendly toast if available
        try { toasts?.show?.('Welcome home!'); } catch (e) {}
        // Play door sfx if possible
        try { audioManager?.playSFX?.('ui/door-open.ogg', 0.6); } catch (e) {}
      }
    } else {
      doorOpen = false;
      triggeredWelcome = false;
    }

    // Animate door progress
    const speed = 2.4; // open/close speed
    doorProgress += (doorOpen ? 1 : -1) * speed * dt;
    doorProgress = Math.max(0, Math.min(1, doorProgress));
    // Interpolate to -90deg when open (hinge around pivot)
    const angle = -Math.PI / 2 * doorProgress;
    // doorPivot rotation around Y
    const pivot = door.parent;
    if (pivot) pivot.rotation.y = angle;
  }

  return {
    update,
    setActive,
    dispose
  };
}

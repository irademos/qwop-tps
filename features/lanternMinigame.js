/**
 * features/lanternMinigame.js
 *
 * Lightweight, lazy-loadable timed lantern release minigame.
 *
 * - Exports initLanternMinigame(THREE, { scene, playerModel, audioManager, toasts })
 * - No top-level side effects.
 *
 * Controls:
 *  - Press "G" to release a nearby lantern (no UI buttons added).
 *
 * The module returns a controller with:
 *  - setActive(boolean)
 *  - update(delta)
 *  - destroy()
 */

export function initLanternMinigame(THREE, { scene, playerModel, audioManager, toasts } = {}) {
  if (!THREE) throw new Error('THREE is required');
  if (!scene) throw new Error('scene is required');
  if (!playerModel) throw new Error('playerModel is required');

  const lanterns = new Set();
  let active = true;
  let listenerAttached = false;

  // Helper: create a small glowing lantern mesh
  function makeLanternMesh() {
    const geom = new THREE.SphereGeometry(0.18, 12, 10);
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffcc88,
      emissive: 0xff9966,
      emissiveIntensity: 0.9,
      roughness: 0.7,
      metalness: 0.0,
      transparent: true,
      opacity: 0.98,
      depthWrite: false
    });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.castShadow = false;
    mesh.receiveShadow = false;

    // Small soft point light to make it read well in the scene
    const light = new THREE.PointLight(0xffcc88, 0.6, 6);
    light.position.set(0, 0.12, 0);
    mesh.add(light);

    return mesh;
  }

  function spawnIdle lanternAt(offset = new THREE.Vector3(0.8, 1.6, 0.4)) {
    const mesh = makeLanternMesh();
    mesh.userData.state = 'idle';
    // place relative to player
    mesh.position.copy(playerModel.position).add(offset);
    scene.add(mesh);

    const obj = {
      mesh,
      state: 'idle',
      vel: new THREE.Vector3(0, 0, 0),
      life: 0
    };
    lanterns.add(obj);
    return obj;
  }

  // Create an initial visible idle lantern near the player
  let idleSpawn = spawnIdle lanternAt();

  function releaseLantern(obj) {
    if (!obj || obj.state !== 'idle') return false;
    obj.state = 'released';
    // give gentle upward velocity with small horizontal nudge
    obj.vel.set((Math.random() - 0.5) * 0.3, 1.0 + Math.random() * 0.6, (Math.random() - 0.5) * 0.3);
    obj.life = 0;
    try {
      audioManager?.playSFX?.('Ambient/lantern_release.ogg', 0.8);
    } catch (e) {
      // ignore missing assets
    }
    try {
      toasts?.show?.('Lantern released!');
    } catch (e) {}

    // spawn a new idle lantern so player can release repeatedly
    idleSpawn = spawnIdle lanternAt(new THREE.Vector3(0.9, 1.6, -0.2));
    return true;
  }

  function onKeyDown(e) {
    if (!active) return;
    if (e.code !== 'KeyG') return; // "G" releases a lantern
    // find nearest idle lantern within 2m
    let nearest = null;
    let best = Infinity;
    for (const l of lanterns) {
      if (l.state !== 'idle') continue;
      const d = l.mesh.position.distanceTo(playerModel.position);
      if (d < best && d < 2.5) {
        best = d;
        nearest = l;
      }
    }
    if (nearest) {
      releaseLantern(nearest);
    } else {
      try { toasts?.show?.('No lantern nearby to release'); } catch (e) {}
    }
  }

  function attachListener() {
    if (listenerAttached) return;
    window.addEventListener('keydown', onKeyDown);
    listenerAttached = true;
  }
  function detachListener() {
    if (!listenerAttached) return;
    window.removeEventListener('keydown', onKeyDown);
    listenerAttached = false;
  }

  function update(delta) {
    // simple physics for released lanterns
    const toRemove = [];
    for (const l of lanterns) {
      if (l.state === 'released') {
        // upward buoyancy + slight drift
        l.vel.y += 0.06 * delta; // gentle acceleration upward
        l.mesh.position.addScaledVector(l.vel, delta);
        // add a little horizontal noise
        l.mesh.position.x += Math.sin((l.life + Math.random()) * 3.1) * 0.002;
        l.mesh.position.z += Math.cos((l.life + Math.random()) * 2.7) * 0.002;

        l.life += delta;
        // fade out slightly as it rises
        const yDiff = l.mesh.position.y - playerModel.position.y;
        if (yDiff > 35 || l.life > 18) {
          // schedule removal
          toRemove.push(l);
        } else {
          // gentle emissive pulse
          const t = 0.5 + Math.sin(l.life * 1.6) * 0.15;
          l.mesh.material.emissiveIntensity = 0.5 + t * 0.6;
        }
      } else if (l.state === 'idle') {
        // follow player so it stays near them
        const target = playerModel.position.clone().add(new THREE.Vector3(0.9, 1.6, 0.4));
        l.mesh.position.lerp(target, Math.min(1, delta * 6));
      }
    }

    for (const rem of toRemove) {
      try {
        scene.remove(rem.mesh);
        if (rem.mesh.geometry) rem.mesh.geometry.dispose();
        if (rem.mesh.material) rem.mesh.material.dispose();
      } catch (e) {}
      lanterns.delete(rem);
    }
  }

  function setActive(v) {
    active = Boolean(v);
    if (active) attachListener();
    else detachListener();
    // show/hide idle lanterns
    for (const l of lanterns) {
      l.mesh.visible = active;
    }
  }

  function destroy() {
    detachListener();
    for (const l of lanterns) {
      try {
        scene.remove(l.mesh);
        if (l.mesh.geometry) l.mesh.geometry.dispose();
        if (l.mesh.material) l.mesh.material.dispose();
      } catch (e) {}
    }
    lanterns.clear();
  }

  // Start active by default and attach handler
  attachListener();

  return {
    setActive,
    update,
    destroy
  };
}

/**
 * features/lanternWindTorque.js
 *
 * Applies a light "wind torque" to floating/released lanterns so they slowly rotate
 * in response to dynamic wind strength. Designed to be lazy-loaded and tolerant of
 * various floating-lantern controller shapes (best-effort wiring).
 *
 * API:
 *   export function initLanternWindTorque(THREE, { scene, floatingLanterns, lanternMinigameController, dynamicWind, options })
 *
 * The returned controller implements:
 *   - update(dt)
 *   - setActive(bool)
 *   - destroy()
 *
 * Implementation notes:
 *  - Non-invasive: tries to wrap existing floatingLanterns.update if present so it
 *    runs each frame without requiring changes to the main animate loop.
 *  - Best-effort discovery of lantern meshes: checks common controller properties
 *    (lanterns, items, getLanterns) and falls back to scanning scene for objects
 *    with userData.isLantern or name includes "lantern".
 */

export function initLanternWindTorque(THREE, {
  scene,
  floatingLanterns = null,
  lanternMinigameController = null,
  dynamicWind = null,
  options = {}
} = {}) {
  if (!THREE) throw new Error('THREE is required');
  if (!scene) throw new Error('scene is required');

  const cfg = Object.assign({
    torqueFactor: 0.6,     // multiplier for wind -> angular acceleration
    maxAngularVel: 1.6,    // radians/sec
    damping: 0.92,         // per-frame damping applied to angular velocity
    attachIntervalMs: 800, // how often to probe for new lanterns/controllers
  }, options);

  let active = true;
  const state = new WeakMap(); // mesh -> { angVel: Vector3 }
  let lastAttach = 0;

  function isLanternObject(obj) {
    if (!obj) return false;
    if (obj.userData?.isLantern) return true;
    const n = (obj.name || '').toLowerCase();
    if (n.includes('lantern') || n.includes('floating_lantern')) return true;
    return false;
  }

  function discoverLanterns() {
    const found = new Set();

    // 1) controller-provided lists
    try {
      if (floatingLanterns) {
        if (typeof floatingLanterns.getLanterns === 'function') {
          const arr = floatingLanterns.getLanterns() || [];
          arr.forEach(o => { if (o && o.position) found.add(o); });
        } else if (Array.isArray(floatingLanterns.lanterns)) {
          floatingLanterns.lanterns.forEach(o => { if (o && o.position) found.add(o); });
        } else if (Array.isArray(floatingLanterns.items)) {
          floatingLanterns.items.forEach(o => { if (o && o.position) found.add(o); });
        }
      }
      // lanterns created by minigame controller could be returned on release
      if (lanternMinigameController) {
        if (Array.isArray(lanternMinigameController.lanterns)) {
          lanternMinigameController.lanterns.forEach(o => { if (o && o.position) found.add(o); });
        }
      }
    } catch (e) {
      // ignore probing errors
    }

    // 2) scene scan fallback (non-expensive: only when needed)
    if (found.size === 0) {
      scene.traverse(o => {
        if (o.isMesh || o.type === 'Sprite' || o.type === 'Group' || o.type === 'Object3D') {
          if (isLanternObject(o)) found.add(o);
        }
      });
    }

    // initialize state entries
    found.forEach(o => {
      if (!state.has(o)) {
        state.set(o, { angVel: new THREE.Vector3((Math.random() - 0.5) * 0.02, (Math.random()-0.5)*0.02, (Math.random()-0.5)*0.02) });
      }
    });

    // Clean up state for removed objects
    for (const key of Array.from(state.keys())) {
      if (!found.has(key)) {
        // keep for a while; let garbage collection handle removed meshes
        // but if mesh not in scene, remove immediately
        if (!key.parent) state.delete(key);
      }
    }
  }

  function applyTorqueTo(mesh, dt) {
    if (!mesh) return;
    const s = state.get(mesh);
    if (!s) return;

    // sample wind strength (0..1)
    let w = 0;
    try {
      if (dynamicWind && typeof dynamicWind.getStrength === 'function') {
        w = Number(dynamicWind.getStrength()) || 0;
      } else if (typeof window.dynamicWind !== 'undefined' && typeof window.dynamicWind.getStrength === 'function') {
        w = Number(window.dynamicWind.getStrength()) || 0;
      }
    } catch (e) { w = 0; }

    // small per-lantern variance
    const variance = (mesh.userData?.windVariance) || (mesh._lanternWindVariance = mesh._lanternWindVariance ?? (0.6 + Math.random() * 0.8));

    // target angular acceleration around Y (yaw) and small roll/pitch
    const ax = (Math.sin(performance.now() * 0.0006 + (mesh.uuid?.charCodeAt?.(0) || 0)) * 0.08) * w * cfg.torqueFactor * variance;
    const ay = (0.14 + Math.sin(performance.now() * 0.0008 + (mesh.uuid?.charCodeAt?.(1) || 0)) * 0.06) * w * cfg.torqueFactor * variance;
    const az = (Math.cos(performance.now() * 0.0005 + (mesh.uuid?.charCodeAt?.(2) || 0)) * 0.06) * w * cfg.torqueFactor * variance;

    // integrate: angVel += accel * dt
    s.angVel.x += ax * dt;
    s.angVel.y += ay * dt;
    s.angVel.z += az * dt;

    // clamp
    s.angVel.x = Math.max(-cfg.maxAngularVel, Math.min(cfg.maxAngularVel, s.angVel.x));
    s.angVel.y = Math.max(-cfg.maxAngularVel, Math.min(cfg.maxAngularVel, s.angVel.y));
    s.angVel.z = Math.max(-cfg.maxAngularVel, Math.min(cfg.maxAngularVel, s.angVel.z));

    // apply rotation (safe, non-physics)
    try {
      // small rotation increments
      mesh.rotation.x = (mesh.rotation.x || 0) + s.angVel.x * dt;
      mesh.rotation.y = (mesh.rotation.y || 0) + s.angVel.y * dt;
      mesh.rotation.z = (mesh.rotation.z || 0) + s.angVel.z * dt;
    } catch (e) {
      // some objects (like Sprites) may not tolerate rotation assignment; ignore
    }

    // damping
    s.angVel.multiplyScalar(Math.pow(cfg.damping, Math.max(0, dt * 60)));
  }

  // attempt to wrap a controller update so we run each frame without requiring the main loop to change
  function tryWrapControllerUpdate(ctrl) {
    if (!ctrl) return;
    try {
      if (typeof ctrl.update === 'function' && !ctrl._lanternWindTorqueWrapped) {
        const orig = ctrl.update.bind(ctrl);
        ctrl.update = function(delta) {
          // call original first
          const res = orig(delta);
          try {
            // discover occasionally
            const now = performance.now();
            if (now - lastAttach > cfg.attachIntervalMs) {
              discoverLanterns();
              lastAttach = now;
            }
            for (const mesh of state.keys()) {
              applyTorqueTo(mesh, delta);
            }
          } catch (e) {}
          return res;
        };
        ctrl._lanternWindTorqueWrapped = true;
      }
    } catch (e) {}
  }

  // best-effort wiring for event-style releases so we can seed newly released lanterns
  function tryWireReleaseEvents(ctrl) {
    if (!ctrl) return;
    try {
      if (typeof ctrl.on === 'function') {
        try { ctrl.on('release', (ev) => tryHandleRelease(ev)); } catch (e) {}
        try { ctrl.on('released', (ev) => tryHandleRelease(ev)); } catch (e) {}
      }
      if (typeof ctrl.addEventListener === 'function') {
        try { ctrl.addEventListener('release', (ev) => tryHandleRelease(ev?.detail || ev)); } catch (e) {}
      }
      // wrap release-like methods
      ['releaseLantern','release','spawnLantern','throwLantern'].forEach(fn => {
        if (typeof ctrl[fn] === 'function' && !ctrl[fn]._lanternWindWrapped) {
          const orig = ctrl[fn].bind(ctrl);
          ctrl[fn] = function(...args) {
            const out = orig(...args);
            try { tryHandleRelease(out || args[0]); } catch (e) {}
            return out;
          };
          ctrl[fn]._lanternWindWrapped = true;
        }
      });
    } catch (e) {}
  }

  function tryHandleRelease(obj) {
    // obj may be a mesh, group, or descriptor with position/mesh
    let mesh = null;
    try {
      if (!obj) return;
      if (obj.isMesh || obj.type === 'Sprite' || obj.isObject3D) mesh = obj;
      else if (obj.mesh && (obj.mesh.isMesh || obj.mesh.isObject3D)) mesh = obj.mesh;
      else if (obj.position && typeof obj.position.x === 'number') {
        // create a tiny invisible helper if needed (we prefer to attach to actual mesh)
        // ignore in this case
      }
      if (mesh) {
        // ensure state entry exists
        if (!state.has(mesh)) state.set(mesh, { angVel: new THREE.Vector3((Math.random()-0.5)*0.06, (Math.random()-0.5)*0.06, (Math.random()-0.5)*0.06) });
      }
    } catch (e) {}
  }

  // Periodic attach attempts
  function attach() {
    try {
      discoverLanterns();
      tryWrapControllerUpdate(floatingLanterns);
      tryWrapControllerUpdate(lanternMinigameController);
      tryWireReleaseEvents(floatingLanterns);
      tryWireReleaseEvents(lanternMinigameController);
    } catch (e) {}
  }

  attach();

  function update(dt) {
    if (!active) return;
    // refresh discovery occasionally
    const now = performance.now();
    if (now - lastAttach > cfg.attachIntervalMs) {
      attach();
      lastAttach = now;
    }
    for (const mesh of Array.from(state.keys())) {
      applyTorqueTo(mesh, dt);
    }
  }

  function setActive(v) { active = Boolean(v); }

  function destroy() {
    // undo wrappers if possible
    try {
      if (floatingLanterns && floatingLanterns._lanternWindTorqueWrapped && typeof floatingLanterns.update === 'function') {
        // we cannot reliably restore original update without storing it globally;
        // so we simply mark as unwound to avoid double-wrapping later.
        floatingLanterns._lanternWindTorqueWrapped = false;
      }
    } catch (e) {}
    state.clear();
  }

  return {
    update,
    setActive,
    destroy
  };
}

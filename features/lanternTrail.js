/**
 * features/lanternTrail.js
 *
 * Lightweight particle-trail-like lines that follow lantern objects in the scene.
 * - No top-level side-effects on import.
 * - Exposes initLanternTrail(THREE, opts) -> controller { update(delta), setActive(bool), destroy() }
 *
 * Detection strategy:
 * - Prefer hooking to lanternMinigameController if it exposes an `on`/`addEventListener` style API.
 * - Fallback: scan scene for objects whose name includes "lantern" or that set userData.isLantern/userData.lantern.
 *
 * This is intentionally small and performs sampling at a modest rate to be cheap on mobile.
 */

export function initLanternTrail(THREE, {
  scene,
  lanternMinigameController = null,
  playerModel = null,
  tailLength = 18,
  sampleInterval = 0.06,
  color = 0xffcc88,
  opacity = 0.85
} = {}) {
  if (!THREE) throw new Error('THREE is required');
  if (!scene) throw new Error('scene is required');

  const tracked = new Map(); // object.uuid -> { obj, geom, line, positions }
  let active = true;
  let sampleAcc = 0;

  function _makeLineFor(obj) {
    const segments = Math.max(4, tailLength | 0);
    const positions = new Float32Array(segments * 3);
    for (let i = 0; i < segments; i++) {
      positions[i * 3 + 0] = obj.position.x;
      positions[i * 3 + 1] = obj.position.y;
      positions[i * 3 + 2] = obj.position.z;
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity,
      depthWrite: false
    });
    const line = new THREE.Line(geom, mat);
    line.frustumCulled = false;
    line.renderOrder = 999; // draw on top of many world objects
    // keep reference
    scene.add(line);
    obj.userData._lanternTrailAttached = true;
    tracked.set(obj.uuid, { obj, geom, line, positions, segments });
  }

  function _removeByKey(uuid) {
    const entry = tracked.get(uuid);
    if (!entry) return;
    try {
      scene.remove(entry.line);
      entry.geom.dispose?.();
      entry.line.material?.dispose?.();
    } catch (e) {}
    tracked.delete(uuid);
  }

  function _findLanternsOnce() {
    const results = [];
    scene.traverse((o) => {
      if (!o || !o.position) return;
      const name = String(o.name || '').toLowerCase();
      const isLanternName = name.includes('lantern') || name.includes('floatinglantern') || name.includes('lantern-');
      const ud = o.userData || {};
      if ((ud.isLantern || ud.lantern || isLanternName)) {
        results.push(o);
      }
    });
    return results;
  }

  // Try to subscribe to a lantern release event if controller supports it.
  // Uses best-effort APIs (on / addEventListener / subscribe). If none present we fallback to scene scanning.
  function _tryHookController() {
    if (!lanternMinigameController) return;
    try {
      if (typeof lanternMinigameController.on === 'function') {
        lanternMinigameController.on('release', (lantern) => {
          if (!lantern) return;
          try { if (!lantern.userData?._lanternTrailAttached) _makeLineFor(lantern); } catch (e) {}
        });
        return;
      }
      if (typeof lanternMinigameController.addEventListener === 'function') {
        lanternMinigameController.addEventListener('release', (e) => {
          const lantern = e?.lantern || e?.detail?.lantern;
          if (!lantern) return;
          try { if (!lantern.userData?._lanternTrailAttached) _makeLineFor(lantern); } catch (e) {}
        });
        return;
      }
      // If controller exposes a `onRelease` callback setter, try to hook
      if (typeof lanternMinigameController.onRelease === 'function') {
        try {
          lanternMinigameController.onRelease((lantern) => {
            if (!lantern) return;
            try { if (!lantern.userData?._lanternTrailAttached) _makeLineFor(lantern); } catch (e) {}
          });
        } catch (e) {}
      }
    } catch (e) {
      // ignore hook failures
    }
  }

  // One-time hookup attempt (non-blocking)
  try { _tryHookController(); } catch (e) {}

  function update(delta) {
    if (!active) return;
    sampleAcc += delta;
    // Discover new lanterns occasionally if we couldn't hook an event
    if (sampleAcc >= 0.5) {
      try {
        const found = _findLanternsOnce();
        for (const o of found) {
          if (!tracked.has(o.uuid)) {
            _makeLineFor(o);
          }
        }
      } catch (e) {}
      sampleAcc = 0;
    }

    // Sample positions at sampleInterval
    let step = sampleInterval;
    // accumulate internal accumulator separate from discovery
    let inner = delta;
    if (inner < step) {
      // still update existing tails with same frame to keep them smooth
      // but only sample when enough time has passed
      inner = delta;
    }

    // Update tracked entries: shift positions and append current position
    for (const [uuid, entry] of Array.from(tracked.entries())) {
      const { obj, positions, geom, segments, line } = entry;
      // If object removed from scene, clean up
      if (!obj.parent || !obj.visible) {
        _removeByKey(uuid);
        continue;
      }
      // Shift older positions down the buffer (make oldest at index 0)
      for (let i = 0; i < segments - 1; i++) {
        const src = (i + 1) * 3;
        const dst = i * 3;
        positions[dst + 0] = positions[src + 0];
        positions[dst + 1] = positions[src + 1];
        positions[dst + 2] = positions[src + 2];
      }
      // Put newest at the end
      const li = (segments - 1) * 3;
      positions[li + 0] = obj.position.x;
      positions[li + 1] = obj.position.y;
      positions[li + 2] = obj.position.z;

      // Update buffer
      try {
        geom.attributes.position.needsUpdate = true;
        // Optionally shrink opacity as line gets longer by setting material opacity based on distance from player
        if (playerModel && line.material) {
          const dist = playerModel.position.distanceTo(obj.position);
          const max = 40;
          const rel = Math.max(0, Math.min(1, 1 - dist / max));
          line.material.opacity = opacity * (0.4 + 0.6 * rel);
        }
      } catch (e) {}
    }
  }

  function setActive(v) {
    active = Boolean(v);
    // show/hide lines
    for (const [, entry] of tracked) {
      try { entry.line.visible = active; } catch (e) {}
    }
  }

  function destroy() {
    for (const [k] of Array.from(tracked.entries())) _removeByKey(k);
    tracked.clear();
    lanternMinigameController = null;
    active = false;
  }

  return { update, setActive, destroy };
}

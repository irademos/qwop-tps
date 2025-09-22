/**
 * initLanternWindLink(THREE, { scene, lanternController, dynamicWind, playerModel })
 *
 * Small, defensive adapter that attaches warm point-lights to in-world lantern meshes
 * and modulates those lights' intensity based on a provided dynamicWind controller
 * (or window.dynamicWind if none provided). The adapter is intentionally lightweight,
 * lazy (no heavy assets), and has no top-level side-effects.
 *
 * Returned controller API:
 *  - update(delta)         // call per-frame from animate()
 *  - setActive(boolean)    // enable/disable updates (keeps lights visible when enabled)
 *  - destroy()             // remove lights and stop internal polling
 *
 * The adapter searches the scene for objects with names containing "lantern" (case-insensitive)
 * and will attach a small PointLight as a child so the glow follows the mesh.
 */

export function initLanternWindLink(THREE, { scene, lanternController = null, dynamicWind = null, playerModel = null, pollInterval = 2000, multiplier = 1.8 } = {}) {
  if (!THREE) throw new Error('THREE is required');
  if (!scene) throw new Error('scene is required');

  const attached = new Map(); // mesh -> light
  let active = true;
  let pollTimer = null;

  function probeWind() {
    try {
      const w = dynamicWind || (typeof window !== 'undefined' ? window.dynamicWind : null);
      if (!w) return 0;
      if (typeof w.getIntensity === 'function') {
        const v = Number(w.getIntensity());
        if (!Number.isFinite(v)) return 0;
        return Math.max(0, Math.min(1, v));
      }
      if (typeof w.intensity === 'number') return Math.max(0, Math.min(1, w.intensity));
      // fallback: support older controllers with a "strength" property
      if (typeof w.strength === 'number') return Math.max(0, Math.min(1, w.strength));
    } catch (e) {
      // swallow probing errors
    }
    return 0;
  }

  function findLanternMeshes() {
    // Defensive traversal: look for names that imply lanterns (common naming in project).
    scene.traverse((obj) => {
      if (!obj || !obj.name || attached.has(obj)) return;
      const name = String(obj.name || '').toLowerCase();
      if (name.includes('lantern') || name.includes('floating-lantern') || name.includes('lantern-') || name.includes('paperlantern')) {
        try {
          const light = new THREE.PointLight(0xffddaa, 0.4, 4, 2);
          light.name = '__lantern_wind_light';
          light.position.set(0, 0.08, 0);
          // Attach to mesh so it follows transforms; prefer obj.add when available.
          if (typeof obj.add === 'function') {
            obj.add(light);
          } else if (obj.parent && typeof obj.parent.add === 'function') {
            // fallback: attach to parent but position to object's world pos
            obj.parent.add(light);
            const worldPos = new THREE.Vector3();
            obj.getWorldPosition(worldPos);
            light.position.copy(worldPos);
          }
          attached.set(obj, light);
        } catch (e) {
          // ignore per-entity failures
        }
      }
    });
  }

  // Initial scan (in case lanterns exist immediately)
  try { findLanternMeshes(); } catch (e) {}

  // Periodically scan for new lanterns (safe, low-frequency)
  pollTimer = setInterval(() => {
    try { findLanternMeshes(); } catch (e) {}
  }, pollInterval);

  function update(/*delta*/) {
    if (!active) return;
    const wind = probeWind();
    // value in [0,1]
    for (const [mesh, light] of attached.entries()) {
      try {
        // base warm glow; increase with wind intensity.
        const base = 0.28;
        const target = base + wind * multiplier;
        // subtle time-based flicker for natural feel (seed from mesh.id to vary)
        const flick = 0.03 * Math.sin((Date.now() / 160) + (mesh.id || 0));
        light.intensity = Math.max(0, target + flick);
        // Optionally nudge light color slightly based on wind (warmer when calm, cooler when windy)
        if (wind > 0.5) {
          light.color.setHex(0xffe0c8);
        } else {
          light.color.setHex(0xffddaa);
        }
        light.visible = true;
      } catch (e) {
        // ignore per-light errors
      }
    }
  }

  function setActive(v) {
    active = Boolean(v);
    for (const l of attached.values()) {
      try { l.visible = active; } catch (e) {}
    }
  }

  function destroy() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    for (const [mesh, light] of attached.entries()) {
      try {
        if (light.parent) light.parent.remove(light);
      } catch (e) {}
    }
    attached.clear();
  }

  return { update, setActive, destroy };
}

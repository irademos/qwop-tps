/**
 * features/lanternMoodColor.js
 *
 * Export: initLanternMoodColor(THREE, { scene, playerModel, getMood })
 *
 * This lightweight controller scans the scene for meshes that look like
 * lanterns (name contains "lantern", userData flags, or emissive materials)
 * and gently blends their emissive/color towards a palette determined by
 * the player's "mood" (a numeric 0..1 value provided by the caller).
 *
 * No top-level side-effects. The controller starts an internal rAF loop
 * when activated so consumers don't need to call update() from the main loop.
 */

export function initLanternMoodColor(THREE, {
  scene,
  playerModel = null,
  getMood = () => 1,
  transitionSpeed = 2.0
} = {}) {
  if (!THREE) throw new Error('THREE is required');
  if (!scene) throw new Error('scene is required');

  let active = true;
  let running = false;
  let tracked = new WeakMap();

  const COOL = new THREE.Color(0x66ccff); // sad/cool
  const WARM = new THREE.Color(0xffcc66); // happy/warm
  const TEMP = new THREE.Color();
  const BASE = new THREE.Color();

  function findLanternMeshes(root = scene) {
    const out = [];
    root.traverse((obj) => {
      if (!obj.isMesh) return;
      const name = String(obj.name || '').toLowerCase();
      if (name.includes('lantern') || obj.userData?.lantern || obj.userData?.isLantern) {
        out.push(obj);
        return;
      }
      // Heuristic fallback: materials with emissive color are likely lanterns
      const mat = obj.material;
      if (mat) {
        const mats = Array.isArray(mat) ? mat : [mat];
        for (const m of mats) {
          if (m && m.emissive && m.emissive.isColor) {
            out.push(obj);
            break;
          }
        }
      }
    });
    return out;
  }

  function ensureTracked() {
    const found = findLanternMeshes();
    for (const mesh of found) {
      if (!tracked.has(mesh)) {
        // store initial observed emissive/color for smooth blending
        const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
        const initColor = new THREE.Color(0x000000);
        if (mat) {
          if (mat.emissive && mat.emissive.isColor) initColor.copy(mat.emissive);
          else if (mat.color && mat.color.isColor) initColor.copy(mat.color);
        }
        tracked.set(mesh, { initial: initColor.clone() });
      }
    }
  }

  function applyColors(dt) {
    const mood = Math.max(0, Math.min(1, (typeof getMood === 'function') ? getMood() : 1));
    TEMP.copy(COOL).lerp(WARM, mood);
    // Slightly desaturate base target for material.color nudging
    BASE.copy(TEMP).lerp(new THREE.Color(0xffffff), 0.45);

    // Walk scene and update tracked meshes (weakmap -> check presence)
    scene.traverse((obj) => {
      if (!obj.isMesh) return;
      if (!tracked.has(obj)) return;
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const m of mats) {
        if (!m) continue;
        // Ensure emissive exists
        if (!m.emissive || !m.emissive.isColor) {
          m.emissive = new THREE.Color(0x000000);
        }
        // Lerp emissive towards TEMP
        m.emissive.lerp(TEMP, Math.min(1, transitionSpeed * dt));
        // Nudge base color slightly towards BASE
        if (m.color && m.color.isColor) {
          m.color.lerp(BASE, Math.min(1, transitionSpeed * 0.35 * dt));
        }
        // Slightly vary emissive intensity by mood for visual pop
        if (typeof m.userData === 'undefined') m.userData = {};
        m.userData._lanternMoodIntensity = (0.25 + mood * 0.9);
        // For standard materials, set emissiveIntensity if present
        if (typeof m.emissiveIntensity === 'number') {
          m.emissiveIntensity = 0.6 + mood * 0.9;
        }
        m.needsUpdate = true;
      }
    });
  }

  let rafId = null;
  let lastTime = performance.now();

  function loop() {
    if (!running) return;
    const now = performance.now();
    const dt = Math.min(0.05, (now - lastTime) / 1000);
    lastTime = now;
    try {
      ensureTracked();
      applyColors(dt);
    } catch (e) {
      // swallow non-fatal errors
      console.error('lanternMoodColor loop error', e);
    }
    rafId = requestAnimationFrame(loop);
  }

  function start() {
    if (running) return;
    running = true;
    lastTime = performance.now();
    rafId = requestAnimationFrame(loop);
  }

  function stop() {
    running = false;
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }

  const controller = {
    setActive(v = true) {
      active = Boolean(v);
      if (active) start();
      else stop();
      return controller;
    },
    destroy() {
      stop();
      tracked = new WeakMap();
    }
  };

  if (active) start();
  return controller;
}

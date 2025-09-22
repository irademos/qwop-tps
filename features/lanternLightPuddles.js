/**
 * features/lanternLightPuddles.js
 *
 * Small, lazy-loadable controller that spawns soft "light puddles" on the ground
 * beneath released lanterns. No UI is added; the module exposes a small API:
 *   initLanternLightPuddles(THREE, { scene, lanternController, dynamicWind, options })
 *
 * The controller listens (best-effort) for release events from a lantern minigame
 * controller and creates a PointLight + ground sprite that fades over time.
 *
 * Exports:
 *   export function initLanternLightPuddles(THREE, opts) { ... }
 */

export function initLanternLightPuddles(THREE, { scene, lanternController = null, dynamicWind = null, options = {} } = {}) {
  if (!THREE) throw new Error('THREE is required');
  if (!scene) throw new Error('scene is required');

  const cfg = Object.assign({
    color: 0xffdca3,
    maxDistance: 6,
    baseIntensity: 0.9,
    puddleRadius: 0.9,
    lifetime: 8.0, // seconds
    spriteSizePx: 128
  }, options);

  let active = true;
  const puddles = new Set();

  function makePuddleSprite() {
    const size = cfg.spriteSizePx;
    const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
    const tex = (canvas && canvas.getContext) ? (() => {
      canvas.width = canvas.height = size;
      const ctx = canvas.getContext('2d');
      const cx = size / 2;
      const cy = size / 2;
      const r = size / 2;
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      g.addColorStop(0, 'rgba(255,240,200,0.95)');
      g.addColorStop(0.45, 'rgba(255,210,150,0.5)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, size, size);
      return new THREE.CanvasTexture(canvas);
    })() : null;

    const mat = new THREE.SpriteMaterial({
      map: tex,
      color: 0xffffff,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(cfg.puddleRadius * 2, cfg.puddleRadius * 2, 1);
    return sprite;
  }

  function spawnPuddleAt(pos, intensity = 1) {
    if (!pos) return null;
    const light = new THREE.PointLight(cfg.color, cfg.baseIntensity * intensity, cfg.maxDistance, 2);
    light.position.set(pos.x, Math.max(0.05, pos.y + 0.03), pos.z);

    const sprite = makePuddleSprite();
    sprite.position.set(pos.x, Math.max(0.02, pos.y + 0.02), pos.z);

    scene.add(light);
    scene.add(sprite);

    const created = {
      light,
      sprite,
      born: performance.now(),
      life: (cfg.lifetime * 1000),
      intensity: intensity
    };
    puddles.add(created);
    return created;
  }

  function tryAttachFromLantern(obj) {
    try {
      if (!obj) return;
      // Common shapes: obj is { position: [x,y,z] } or obj.position Vector3 or obj.mesh.position
      let pos = null;
      if (obj.position && typeof obj.position.x === 'number') {
        pos = obj.position.clone ? obj.position.clone() : new THREE.Vector3(obj.position.x, obj.position.y || 0, obj.position.z || 0);
      } else if (obj.mesh && obj.mesh.position) {
        pos = obj.mesh.position.clone();
      } else if (Array.isArray(obj) && obj.length >= 3) {
        pos = new THREE.Vector3(obj[0], obj[1], obj[2]);
      }
      // Fallback: use player location if available
      if (!pos && typeof window !== 'undefined' && window.playerModel && window.playerModel.position) {
        pos = window.playerModel.position.clone();
        pos.add(new THREE.Vector3(0, 0.5, 0));
      }
      if (!pos) return;
      // Lower puddle to sit on ground
      pos.y = Math.max(0.02, pos.y - 0.5);
      spawnPuddleAt(pos, 1);
    } catch (e) {
      // best-effort only
      console.error('lanternLightPuddles attach error', e);
    }
  }

  // Best-effort event wiring:
  // - If lanternController is an EventEmitter-style with `on('release', handler)`
  // - If it has addEventListener('release', ...)
  // - If it exposes a release/releaseLantern method, wrap it.
  function tryWireController(ctrl) {
    if (!ctrl) return;
    try {
      if (typeof ctrl.on === 'function') {
        try { ctrl.on('release', tryAttachFromLantern); } catch (e) {}
        try { ctrl.on('released', tryAttachFromLantern); } catch (e) {}
      }
      if (typeof ctrl.addEventListener === 'function') {
        try { ctrl.addEventListener('release', (ev) => tryAttachFromLantern(ev?.detail || ev?.lantern || ev)); } catch (e) {}
      }
      // Wrap common release functions (best-effort)
      ['releaseLantern', 'release', 'spawnLantern', 'throwLantern'].forEach(fn => {
        if (typeof ctrl[fn] === 'function') {
          const orig = ctrl[fn].bind(ctrl);
          ctrl[fn] = function(...args) {
            const res = orig(...args);
            // If original returns a lantern-like object, attach to it
            try {
              const out = res && (res.position || res.mesh || Array.isArray(res)) ? res : args[0];
              tryAttachFromLantern(out);
            } catch (e) {}
            return res;
          };
        }
      });
    } catch (e) {
      // ignore wiring errors
    }
  }

  tryWireController(lanternController);

  function update(dt) {
    const now = performance.now();
    const remove = [];
    for (const p of puddles) {
      const age = now - p.born;
      const t = Math.max(0, Math.min(1, age / p.life));
      const fade = 1 - t;
      // adjust light + sprite
      try {
        p.light.intensity = (cfg.baseIntensity * p.intensity) * fade;
        if (p.sprite && p.sprite.material) {
          p.sprite.material.opacity = 0.6 * fade;
        }
      } catch (e) {}
      // link to wind (if provided) to slightly modulate intensity
      if (dynamicWind && typeof dynamicWind.getStrength === 'function') {
        try {
          const w = dynamicWind.getStrength();
          p.light.intensity = p.light.intensity * (1 + 0.25 * (w || 0));
        } catch (e) {}
      }
      if (age >= p.life) {
        remove.push(p);
      }
    }
    remove.forEach(p => {
      try {
        scene.remove(p.light);
      } catch (e) {}
      try {
        scene.remove(p.sprite);
        if (p.sprite && p.sprite.material && p.sprite.material.map) p.sprite.material.map.dispose();
        if (p.sprite && p.sprite.material) p.sprite.material.dispose();
      } catch (e) {}
      puddles.delete(p);
    });
  }

  function setActive(v) {
    active = Boolean(v);
  }

  function destroy() {
    for (const p of Array.from(puddles)) {
      try { scene.remove(p.light); } catch (e) {}
      try { scene.remove(p.sprite); } catch (e) {}
    }
    puddles.clear();
    // no additional global teardown attempted
  }

  return {
    update,
    setActive,
    destroy,
    _spawnPuddleAt: spawnPuddleAt // exported for tests/debugging
  };
}

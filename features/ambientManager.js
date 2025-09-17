/**
 * features/ambientManager.js
 *
 * Small central manager to lazily initialize ambient/ambient-creature modules (companion, bird, butterflies,
 * lantern, campfire, guide star, wandering deer). Exports initAmbientManager which performs no side-effects
 * on import — it must be called to wire UI and initialize.
 *
 * Design:
 *  - Lazy-import heavy modules only when toggled (or preload deer once).
 *  - Insert toggles into the existing .ai-actions__sheet-inner container.
 *  - Respect mobile-first UX: single Actions button exists in the page; we only add toggles to that sheet.
 *
 * Returns an object { controllers, preload, teardown } where controllers is a map of named controllers (if created).
 */

export function initAmbientManager({ THREE, scene, playerModel, audioManager, toasts } = {}) {
  if (!THREE) throw new Error('THREE is required');
  if (!scene) throw new Error('scene is required');
  if (!playerModel) throw new Error('playerModel is required');

  const controllers = Object.create(null);
  // Promises for first-time imports (ensures modules fetched at most once)
  const promises = {
    companion: null,
    bird: null,
    butterflies: null,
    lantern: null,
    campfire: null,
    guide: null,
    deer: null
  };

  // Helper to create a consistent action button inside the sheet
  function makeToggleButton(id, label) {
    const btn = document.createElement('button');
    btn.id = id;
    btn.className = 'ai-actions__item';
    btn.textContent = label;
    btn.setAttribute('aria-pressed', 'false');
    return btn;
  }

  // Safe setter helper
  async function ensureController(name, factoryPromise) {
    if (controllers[name]) return controllers[name];
    if (!promises[name]) promises[name] = factoryPromise();
    const c = await promises[name];
    controllers[name] = c;
    return c;
  }

  // Wire UI toggles under existing sheet
  const sheetInner = document.querySelector('.ai-actions__sheet-inner');

  if (sheetInner) {
    // Companion
    const spiritBtn = makeToggleButton('spirit-toggle', 'Companion');
    spiritBtn.addEventListener('click', async () => {
      const next = !(spiritBtn.getAttribute('aria-pressed') === 'true');
      spiritBtn.setAttribute('aria-pressed', String(next));
      spiritBtn.textContent = next ? 'Companion: On' : 'Companion';
      try {
        const ctrl = await ensureController('companion', async () => {
          const m = await import('../ai/companionSpirit.js');
          return m.createCompanionSpirit(THREE, { scene, playerModel, audioManager });
        });
        ctrl?.setActive?.(next);
      } catch (err) {
        console.error('Companion toggle failed', err);
      }
    });
    sheetInner.appendChild(spiritBtn);

    // Bird
    const birdBtn = makeToggleButton('bird-toggle', 'Bird');
    birdBtn.addEventListener('click', async () => {
      const next = !(birdBtn.getAttribute('aria-pressed') === 'true');
      birdBtn.setAttribute('aria-pressed', String(next));
      birdBtn.textContent = next ? 'Bird: On' : 'Bird';
      try {
        const ctrl = await ensureController('bird', async () => {
          const m = await import('../ai/forestBird.js');
          return m.createForestBird(THREE, { scene, playerModel, audioManager });
        });
        ctrl?.setActive?.(next);
      } catch (err) {
        console.error('Bird toggle failed', err);
      }
    });
    sheetInner.appendChild(birdBtn);

    // Butterflies
    const butterfliesBtn = makeToggleButton('butterflies-toggle', 'Butterflies');
    butterfliesBtn.addEventListener('click', async () => {
      const next = !(butterfliesBtn.getAttribute('aria-pressed') === 'true');
      butterfliesBtn.setAttribute('aria-pressed', String(next));
      butterfliesBtn.textContent = next ? 'Butterflies: On' : 'Butterflies';
      try {
        const ctrl = await ensureController('butterflies', async () => {
          const m = await import('../effects/butterflies.js');
          return m.createButterflies(THREE, { scene, playerModel, audioManager });
        });
        ctrl?.setActive?.(next);
      } catch (err) {
        console.error('Butterflies toggle failed', err);
      }
    });
    sheetInner.appendChild(butterfliesBtn);

    // Lantern
    const lanternBtn = makeToggleButton('lantern-toggle', 'Lantern');
    lanternBtn.addEventListener('click', async () => {
      const next = !(lanternBtn.getAttribute('aria-pressed') === 'true');
      lanternBtn.setAttribute('aria-pressed', String(next));
      lanternBtn.textContent = next ? 'Lantern: On' : 'Lantern';
      try {
        const ctrl = await ensureController('lantern', async () => {
          const m = await import('../features/floatingLantern.js');
          return m.createFloatingLantern(THREE, { scene, playerModel, audioManager });
        });
        ctrl?.setActive?.(next);
      } catch (err) {
        console.error('Lantern toggle failed', err);
      }
    });
    sheetInner.appendChild(lanternBtn);

    // Campfire
    const campfireBtn = makeToggleButton('campfire-toggle', 'Campfire');
    campfireBtn.addEventListener('click', async () => {
      const next = !(campfireBtn.getAttribute('aria-pressed') === 'true');
      campfireBtn.setAttribute('aria-pressed', String(next));
      campfireBtn.textContent = next ? 'Campfire: On' : 'Campfire';
      try {
        const ctrl = await ensureController('campfire', async () => {
          const m = await import('../effects/campfire.js');
          return m.createCampfire(THREE, { scene, playerModel, audioManager });
        });
        ctrl?.setActive?.(next);
      } catch (err) {
        console.error('Campfire toggle failed', err);
      }
    });
    sheetInner.appendChild(campfireBtn);

    // Guide Star
    const guideBtn = makeToggleButton('guide-toggle', 'Guide');
    guideBtn.addEventListener('click', async () => {
      const next = !(guideBtn.getAttribute('aria-pressed') === 'true');
      guideBtn.setAttribute('aria-pressed', String(next));
      guideBtn.textContent = next ? 'Guide: On' : 'Guide';
      try {
        const ctrl = await ensureController('guide', async () => {
          const m = await import('../features/guideStar.js');
          return m.createGuideStar(THREE, { scene, playerModel });
        });
        ctrl?.setActive?.(next);
      } catch (err) {
        console.error('Guide toggle failed', err);
      }
    });
    sheetInner.appendChild(guideBtn);

    // Deer (ambient creature) — preload once but keep inactive until toggled
    const deerBtn = makeToggleButton('deer-toggle', 'Deer');
    deerBtn.addEventListener('click', async () => {
      const next = !(deerBtn.getAttribute('aria-pressed') === 'true');
      deerBtn.setAttribute('aria-pressed', String(next));
      deerBtn.textContent = next ? 'Deer: On' : 'Deer';
      try {
        const ctrl = await ensureController('deer', async () => {
          const m = await import('../features/wanderingDeer.client.js');
          return m.createWanderingDeer(THREE, { scene, playerModel, audioManager });
        });
        ctrl?.setActive?.(next);
      } catch (err) {
        console.error('Deer toggle failed', err);
      }
    });
    sheetInner.appendChild(deerBtn);

    // Preload deer module in background to keep the first toggle snappy (non-blocking)
    // Any errors are non-fatal.
    (async () => {
      try {
        if (!promises.deer) {
          promises.deer = (async () => {
            const m = await import('../features/wanderingDeer.client.js');
            const ctrl = m.createWanderingDeer(THREE, { scene, playerModel, audioManager });
            // Keep inactive by default
            ctrl?.setActive?.(false);
            controllers.deer = ctrl;
            try {
              toasts?.show?.('Wandering deer preloaded — enable in Actions');
            } catch (e) {
              // noop
            }
            return ctrl;
          })();
        }
      } catch (err) {
        console.error('Failed to preload wandering deer module', err);
      }
    })();
  }

  function teardown() {
    // Attempt to dispose controllers if they expose dispose()
    Object.values(controllers).forEach(c => {
      try {
        c?.setActive?.(false);
        if (typeof c.dispose === 'function') c.dispose();
      } catch (e) {
        console.warn('Error tearing down ambient controller', e);
      }
    });
  }

  return {
    controllers,
    _promises: promises,
    preload: (name) => promises[name] || null,
    teardown
  };
}

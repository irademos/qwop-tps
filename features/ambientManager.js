/**
 * features/ambientManager.js
 *
 * Minimal ambient manager: lazy-loads small ambient systems (wandering deer, butterflies)
 * and exposes a simple programmatic API. No DOM mutation occurs here — initialization
 * must be performed once by the entry (app.js). Designed to be safe for import and
 * for code-splitting via dynamic import().
 *
 * NOTE: app.js already dynamically imports and initializes this module. No other files
 * need to be added for this change.
 */

/**
 * @param {Object} opts
 * @param {any} opts.THREE
 * @param {THREE.Scene} opts.scene
 * @param {THREE.Object3D} opts.playerModel
 * @param {Object} opts.audioManager
 * @param {Object} [opts.toasts]
 */
export function initAmbientManager({ THREE, scene, playerModel, audioManager, toasts } = {}) {
  if (!THREE) throw new Error('THREE is required');
  if (!scene) throw new Error('scene is required');
  if (!playerModel) throw new Error('playerModel is required');

  let active = false;
  const controllers = Object.create(null);
  const loaders = Object.create(null);

  // Lazily import and construct the wandering deer controller (keeps client bundle small)
  loaders.deer = async function loadDeer() {
    if (controllers.deer) return controllers.deer;
    try {
      // Import the non-UI wandering deer (server/client module)
      const mod = await import('./wanderingDeer.js');
      if (typeof mod.createWanderingDeer === 'function') {
        controllers.deer = mod.createWanderingDeer(THREE, { scene, playerModel, audioManager });
        if (typeof controllers.deer.setActive === 'function') controllers.deer.setActive(active);
      } else {
        console.warn('wanderingDeer.js did not export createWanderingDeer');
      }
    } catch (err) {
      console.error('Failed loading wandering deer', err);
      toasts?.show?.('Failed to load wandering deer');
    }
    return controllers.deer;
  };

  // Lazily import butterflies
  loaders.butterflies = async function loadButterflies() {
    if (controllers.butterflies) return controllers.butterflies;
    try {
      const mod = await import('../effects/butterflies.js');
      if (typeof mod.createButterflies === 'function') {
        controllers.butterflies = mod.createButterflies(THREE, { scene, playerModel, audioManager });
        if (typeof controllers.butterflies.setActive === 'function') controllers.butterflies.setActive(active);
      } else {
        console.warn('effects/butterflies.js did not export createButterflies');
      }
    } catch (err) {
      console.error('Failed loading butterflies', err);
      toasts?.show?.('Failed to load butterflies');
    }
    return controllers.butterflies;
  };

  async function activateControllers() {
    // Ensure core ambient controllers are loaded (non-blocking where possible)
    await Promise.allSettled([
      loaders.deer(),
      loaders.butterflies()
    ]);

    Object.values(controllers).forEach(ctrl => {
      try {
        if (ctrl && typeof ctrl.setActive === 'function') ctrl.setActive(true);
      } catch (err) {
        console.warn('Failed to activate ambient controller', err);
      }
    });
    toasts?.show?.('Ambient enabled');
  }

  function deactivateControllers() {
    Object.entries(controllers).forEach(([name, ctrl]) => {
      try {
        if (ctrl && typeof ctrl.setActive === 'function') ctrl.setActive(false);
      } catch (err) {
        console.warn(`Failed to deactivate ${name}`, err);
      }
    });
    toasts?.show?.('Ambient disabled');
  }

  /**
   * Set global ambient active state. When enabling we lazy-load controllers.
   * @param {boolean} next
   */
  async function setActive(next) {
    next = !!next;
    if (next === active) return;
    active = next;
    if (active) {
      await activateControllers();
    } else {
      deactivateControllers();
    }
  }

  async function toggle() {
    await setActive(!active);
    return active;
  }

  async function dispose() {
    // Fully tear down controllers that expose dispose()
    Object.entries(controllers).forEach(([name, ctrl]) => {
      try {
        if (ctrl && typeof ctrl.setActive === 'function') {
          try { ctrl.setActive(false); } catch (e) { /* ignore */ }
        }
        if (ctrl && typeof ctrl.dispose === 'function') {
          try { ctrl.dispose(); } catch (e) { /* ignore */ }
        }
      } catch (err) {
        console.warn('Error disposing ambient controller', err);
      } finally {
        delete controllers[name];
      }
    });
    active = false;
  }

  return {
    isActive: () => active,
    setActive,
    toggle,
    dispose,
    // internal helpers for testing/inspection (not required to be used)
    _controllers: controllers,
    _loaders: loaders
  };
}

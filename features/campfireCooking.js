/**
 * features/campfireCooking.js
 *
 * Lightweight campfire cooking interaction:
 * - Exported initCampfireCooking(THREE, { scene, playerModel, campfire, toasts, audioManager })
 * - No side-effects at import time. Attach event handlers only when setActive(true) is called.
 * - Player presses "C" when within proximity to the campfire to cook one raw_meat -> cooked_meat.
 *
 * Usage:
 *  const ctrl = initCampfireCooking(THREE, { scene, playerModel, campfire, toasts, audioManager });
 *  ctrl.setActive(true);
 */
export function initCampfireCooking(THREE, { scene, playerModel, campfire, toasts, audioManager } = {}) {
  if (!THREE) throw new Error('THREE is required');
  if (!scene) throw new Error('scene is required');
  if (!playerModel) throw new Error('playerModel is required');

  // Config
  const COOK_KEY = 'KeyC';
  const COOK_DISTANCE = 2.0; // meters
  const COOK_DURATION = 3.5; // seconds

  // Internal state
  let active = false;
  let cooking = false;
  let cookElapsed = 0;
  let cookCallback = null;
  let keyHandler = null;

  // Safe accessors for camp position (campfire may be a Group or a controller)
  function _campPosition() {
    if (!campfire) return playerModel.position.clone();
    if (campfire.position && typeof campfire.position.x === 'number') return campfire.position.clone();
    if (campfire.group && campfire.group.position) return campfire.group.position.clone();
    if (campfire.getPosition && typeof campfire.getPosition === 'function') {
      try {
        const p = campfire.getPosition();
        if (p && p.x !== undefined) return p.clone ? p.clone() : new THREE.Vector3(p.x, p.y, p.z);
      } catch (e) {}
    }
    return playerModel.position.clone();
  }

  function _ensureInventory() {
    if (!window.playerInventory) {
      // non-invasive default inventory (safe to override elsewhere)
      window.playerInventory = { raw_meat: 0, cooked_meat: 0 };
    }
  }

  function _hasRaw() {
    _ensureInventory();
    return (window.playerInventory.raw_meat || 0) > 0;
  }

  function _consumeRaw() {
    _ensureInventory();
    if ((window.playerInventory.raw_meat || 0) > 0) {
      window.playerInventory.raw_meat = Math.max(0, window.playerInventory.raw_meat - 1);
      return true;
    }
    return false;
  }

  function _produceCooked() {
    _ensureInventory();
    window.playerInventory.cooked_meat = (window.playerInventory.cooked_meat || 0) + 1;
  }

  function _playSFX(path, vol = 0.7) {
    try { audioManager?.playSFX?.(path, vol); } catch (e) { /* ignore */ }
  }

  function _startCooking() {
    if (cooking) return;
    if (!_hasRaw()) {
      try { toasts?.show?.('No raw items to cook'); } catch (e) {}
      _playSFX('ui/error.ogg', 0.6);
      return;
    }

    cooking = true;
    cookElapsed = 0;
    try { toasts?.show?.('Cooking... (C to cancel)'); } catch (e) {}
    _playSFX('ui/cooking_start.ogg', 0.6);

    // Optional callback when cooking completes; can be used by external UI.
    cookCallback = () => {
      _produceCooked();
      try { toasts?.show?.('Cooked: +1 cooked_meat'); } catch (e) {}
      _playSFX('ui/cooking_done.ogg', 0.8);
    };
  }

  function _cancelCooking() {
    if (!cooking) return;
    cooking = false;
    cookElapsed = 0;
    cookCallback = null;
    try { toasts?.show?.('Cooking cancelled'); } catch (e) {}
    _playSFX('ui/cancel.ogg', 0.5);
  }

  function _tryToggleCook() {
    const campPos = _campPosition();
    const dist = campPos.distanceTo(playerModel.position);
    if (dist > COOK_DISTANCE) {
      try { toasts?.show?.('You are too far from the campfire to cook'); } catch (e) {}
      _playSFX('ui/error.ogg', 0.6);
      return;
    }

    if (!cooking) {
      // attempt to consume raw immediately so other systems see inventory changes during cook
      if (!_consumeRaw()) {
        try { toasts?.show?.('No raw items to cook'); } catch (e) {}
        _playSFX('ui/error.ogg', 0.6);
        return;
      }
      _startCooking();
    } else {
      // cancel and refund the raw item
      cooking = false;
      cookElapsed = 0;
      // refund
      _ensureInventory();
      window.playerInventory.raw_meat = (window.playerInventory.raw_meat || 0) + 1;
      cookCallback = null;
      try { toasts?.show?.('Cooking cancelled, item refunded'); } catch (e) {}
      _playSFX('ui/cancel.ogg', 0.5);
    }
  }

  function _onKeyDown(e) {
    if (e.code !== COOK_KEY) return;
    // Prevent typing into inputs from triggering cooking
    const activeEl = (typeof document !== 'undefined') ? document.activeElement : null;
    if (activeEl && ['INPUT', 'TEXTAREA'].includes(activeEl.tagName)) return;
    _tryToggleCook();
  }

  function setActive(v = true) {
    if (v === active) return;
    active = Boolean(v);
    if (active) {
      keyHandler = _onKeyDown;
      if (typeof document !== 'undefined') document.addEventListener('keydown', keyHandler);
    } else {
      if (typeof document !== 'undefined' && keyHandler) document.removeEventListener('keydown', keyHandler);
      keyHandler = null;
      cooking = false;
      cookElapsed = 0;
      cookCallback = null;
    }
  }

  /**
   * update(delta)
   * - called from the global animate loop; delta is seconds.
   */
  function update(delta) {
    if (!active) return;
    if (!cooking) return;
    cookElapsed += delta;
    // optional small progress toast every 1s (throttled)
    if (cookElapsed >= COOK_DURATION) {
      cooking = false;
      const cb = cookCallback;
      cookCallback = null;
      try { cb && cb(); } catch (e) { console.error('cook callback failed', e); }
    }
  }

  function destroy() {
    setActive(false);
  }

  return {
    setActive,
    update,
    destroy
  };
}

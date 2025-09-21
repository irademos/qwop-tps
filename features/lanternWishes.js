/**
 * features/lanternWishes.js
 *
 * Small, lazy-loaded helper that displays a randomized "wish" as a toast
 * each time a lantern is released by the existing lantern minigame controller.
 *
 * Exports initLanternWishes({ toasts, lanternMinigameController })
 * Returns a controller: { setActive(boolean), destroy() }
 *
 * No top-level side-effects.
 */

export function initLanternWishes({ toasts, lanternMinigameController } = {}) {
  if (!toasts) {
    throw new Error('toasts (createToastManager) is required');
  }

  let active = false;
  let attached = false;
  let _wrappedRelease = null;
  let _listenerRef = null;

  const WISHES = [
    "May your path be bright.",
    "A gentle breeze carries fortune your way.",
    "May your nights be star-lit and calm.",
    "A small kindness will find you soon.",
    "May your next journey be safe.",
    "Health and warmth to you and yours.",
    "May your lantern find its home among the stars.",
    "A quiet wish for lasting joy."
  ];

  function _pickWish() {
    return WISHES[Math.floor(Math.random() * WISHES.length)];
  }

  function _showWish() {
    try {
      const text = _pickWish();
      toasts.show(text, { duration: 3500, type: 'info' });
    } catch (e) {
      // swallow any toast failures
    }
  }

  function _attach(controller) {
    if (!controller || attached) return;
    attached = true;

    try {
      // Preferred: EventTarget-like API
      if (typeof controller.addEventListener === 'function') {
        _listenerRef = () => _showWish();
        try { controller.addEventListener('release', _listenerRef); } catch (e) { /* ignore */ }
        return;
      }

      // Common Node-style emitter
      if (typeof controller.on === 'function' && typeof controller.off === 'function') {
        _listenerRef = () => _showWish();
        try { controller.on('release', _listenerRef); } catch (e) { /* ignore */ }
        return;
      }

      // If controller provides a release() method, wrap it to show wish on release.
      if (typeof controller.release === 'function') {
        _wrappedRelease = controller.release.bind(controller);
        controller.release = function(...args) {
          try { _showWish(); } catch (e) {}
          return _wrappedRelease(...args);
        };
        return;
      }

      // Fallback: honor a callback property that some modules use.
      if (typeof controller.onLanternReleased === 'undefined') {
        controller.onLanternReleased = () => {
          try { _showWish(); } catch (e) {}
        };
        _listenerRef = 'onLanternReleased';
        return;
      }
    } catch (e) {
      // best-effort only
      attached = false;
    }
  }

  function _detach(controller) {
    if (!controller || !attached) return;
    try {
      if (_listenerRef && typeof controller.removeEventListener === 'function') {
        try { controller.removeEventListener('release', _listenerRef); } catch (e) {}
      }
      if (_listenerRef && typeof controller.off === 'function') {
        try { controller.off('release', _listenerRef); } catch (e) {}
      }
      if (_listenerRef === 'onLanternReleased') {
        try { controller.onLanternReleased = undefined; } catch (e) {}
      }
      if (_wrappedRelease) {
        try { controller.release = _wrappedRelease; } catch (e) {}
      }
    } catch (e) {
      // ignore
    } finally {
      _listenerRef = null;
      _wrappedRelease = null;
      attached = false;
    }
  }

  function setActive(v) {
    const next = Boolean(v);
    if (next === active) return;
    active = next;
    if (active) {
      _attach(lanternMinigameController);
    } else {
      _detach(lanternMinigameController);
    }
  }

  function destroy() {
    _detach(lanternMinigameController);
    active = false;
  }

  return { setActive, destroy };
}

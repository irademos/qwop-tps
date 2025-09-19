/**
 * furnitureRotationHotkeys.js
 *
 * Adds keyboard hotkeys for rotating the furniture preview in fixed snap increments
 * and for cycling the active snap angle. No UI buttons are added (UX guardrails).
 *
 * Controls:
 *  - BracketLeft  ( [ )  => rotate preview -snapAngle
 *  - BracketRight ( ] )  => rotate preview +snapAngle
 *  - KeyK                 => cycle snap angle (5° → 15° → 30°)
 *
 * Exports:
 *  - initFurnitureRotationHotkeys({ snapController, toasts })
 *    returns a controller { setActive(boolean), destroy() }
 */

export function initFurnitureRotationHotkeys({ snapController = null, toasts = null } = {}) {
  if (typeof window === 'undefined') {
    return { setActive() {}, destroy() {} };
  }

  const snapAngles = [5, 15, 30];
  let currentIndex = 1; // default to 15°
  let active = false;
  let handler = null;

  function showMessage(msg) {
    try {
      if (toasts && typeof toasts.show === 'function') {
        toasts.show(msg);
        return;
      }
    } catch (e) {
      // ignore toast failures
    }
    // Fallback to console
    console.log('[rotation-hotkeys]', msg);
  }

  function getAngle() {
    return snapAngles[currentIndex];
  }

  function cycleAngle(nextIndex = null) {
    currentIndex = (typeof nextIndex === 'number') ? (nextIndex % snapAngles.length) : ((currentIndex + 1) % snapAngles.length);
    showMessage(`Rotation snap: ${getAngle()}°`);
    return getAngle();
  }

  function onKeyDown(e) {
    // Ignore repeats and when typing into inputs
    if (e.repeat) return;
    const ae = document && document.activeElement;
    if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;

    if (e.code === 'BracketLeft') {
      const angle = getAngle();
      try {
        if (snapController && typeof snapController.rotateBy === 'function') {
          snapController.rotateBy(-angle);
        }
      } catch (err) {
        console.error('rotateBy failed', err);
      }
      e.preventDefault();
    } else if (e.code === 'BracketRight') {
      const angle = getAngle();
      try {
        if (snapController && typeof snapController.rotateBy === 'function') {
          snapController.rotateBy(angle);
        }
      } catch (err) {
        console.error('rotateBy failed', err);
      }
      e.preventDefault();
    } else if (e.code === 'KeyK') {
      cycleAngle();
      e.preventDefault();
    }
  }

  function setActive(next = true) {
    if (next === active) return;
    active = !!next;
    if (active) {
      handler = onKeyDown;
      window.addEventListener('keydown', handler);
      showMessage(`Rotation hotkeys enabled — snap ${getAngle()}° (use [ and ] to rotate, K to cycle)`);
    } else {
      if (handler) {
        window.removeEventListener('keydown', handler);
        handler = null;
      }
      showMessage('Rotation hotkeys disabled');
    }
  }

  function destroy() {
    setActive(false);
    snapController = null;
  }

  return { setActive, destroy, cycleAngle, getAngle };
}

/**
 * features/furnitureRotationHotkeys.js
 *
 * Adds keyboard hotkey modes for furniture rotation snapping.
 * - Q : cycle snap mode (Off -> 15° -> 30° -> 45°)
 * - [ : rotate -angle (or -5° when snap is Off)
 * - ] : rotate +angle (or +5° when snap is Off)
 *
 * Exports initFurnitureRotationHotkeys which returns a controller with:
 * - setActive(boolean)
 * - destroy()
 *
 * No side-effects at module import time.
 */

/**
 * @param {object} opts
 * @param {object} opts.snapController - controller with rotateBy(degrees) API
 * @param {object} [opts.toasts] - optional toast manager with show(message)
 */
export function initFurnitureRotationHotkeys({ snapController, toasts } = {}) {
  if (!snapController) {
    throw new Error('snapController is required');
  }

  const modes = [0, 15, 30, 45]; // 0 = free (small increments)
  let modeIndex = modes.indexOf(15) >= 0 ? modes.indexOf(15) : 1;
  let active = true;

  function _notify(msg) {
    try {
      if (toasts && typeof toasts.show === 'function') {
        toasts.show(msg);
      } else {
        // Fallback to console for visibility in demos
        console.log('[RotationHotkeys]', msg);
      }
    } catch (e) {
      console.log('[RotationHotkeys]', msg);
    }
  }

  function _currentAngle() {
    return modes[modeIndex] || 0;
  }

  function cycleMode() {
    modeIndex = (modeIndex + 1) % modes.length;
    const a = _currentAngle();
    _notify(`Rotation snap: ${a === 0 ? 'Off (±5°)' : `${a}°`}`);
  }

  function rotateBySign(sign) {
    const angle = _currentAngle();
    const step = angle === 0 ? 5 : angle;
    try {
      if (typeof snapController.rotateBy === 'function') {
        snapController.rotateBy(step * sign);
      } else {
        // Best-effort fallback: if controller exposes manual transform API
        console.warn('snapController.rotateBy not available');
      }
    } catch (e) {
      console.error('rotateBy failed', e);
    }
  }

  function onKeyDown(e) {
    if (!active) return;
    // Q cycles modes
    if (e.code === 'KeyQ') {
      cycleMode();
      e.preventDefault();
      return;
    }
    // BracketLeft / BracketRight rotate
    if (e.code === 'BracketLeft') {
      rotateBySign(-1);
      e.preventDefault();
      return;
    }
    if (e.code === 'BracketRight') {
      rotateBySign(1);
      e.preventDefault();
      return;
    }
  }

  window.addEventListener('keydown', onKeyDown);

  return {
    setActive(v = true) {
      active = !!v;
    },
    destroy() {
      window.removeEventListener('keydown', onKeyDown);
    }
  };
}

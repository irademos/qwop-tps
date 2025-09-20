/**
 * features/snapAnglePreference.js
 *
 * Small helper to persist per-player furniture rotation snap angle preference.
 * - No top-level side-effects. Call initSnapAnglePreference(...) to activate.
 *
 * API:
 *   initSnapAnglePreference({ snapController, toasts, storageKey })
 *     -> { setAngle(number), getAngle(): number|null, setActive(bool) }
 */

export function initSnapAnglePreference({ snapController, toasts, storageKey = 'fai_snap_angle' } = {}) {
  if (!snapController) throw new Error('snapController is required');

  let active = false;

  function _load() {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return null;
      const n = Number(raw);
      if (Number.isFinite(n)) return Math.max(1, Math.min(180, Math.round(n)));
    } catch (e) {
      // ignore
    }
    return null;
  }

  function _save(n) {
    try {
      localStorage.setItem(storageKey, String(n));
    } catch (e) {
      // ignore
    }
  }

  function _applyToController(angle) {
    try {
      if (typeof snapController.setSnapAngle === 'function') {
        snapController.setSnapAngle(angle);
      } else {
        // best-effort: some controllers expose a property
        snapController.snapAngle = angle;
      }
    } catch (e) {
      // ignore
    }
  }

  function setAngle(angle) {
    const a = Math.max(1, Math.min(180, Math.round(Number(angle) || 0)));
    _applyToController(a);
    _save(a);
    try { toasts?.show?.(`Snap angle: ${a}°`); } catch (e) {}
    return a;
  }

  function getAngle() {
    const val = typeof snapController.snapAngle === 'number' ? snapController.snapAngle : null;
    return val;
  }

  function setActive(v) {
    active = Boolean(v);
    return active;
  }

  // Initialize: apply stored preference if present
  const stored = _load();
  if (stored !== null) {
    setAngle(stored);
  }

  return { setAngle, getAngle, setActive };
}

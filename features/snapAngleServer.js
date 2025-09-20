/**
 * features/snapAngleServer.js
 *
 * Lightweight client-side helper that:
 * - Persists the local player's furniture rotation snap angle to localStorage.
 * - Broadcasts the preferred snap angle to peers via the existing Multiplayer.send API.
 * - Attaches to the runtime snap controller (window.furnitureRotationSnapping) when available
 *   and wraps common mutation methods so updates are propagated automatically.
 *
 * No top-level side-effects. Call initSnapAnglePersistence(...) from the main entry.
 */

/**
 * Initialize snap-angle persistence + peer broadcast.
 * @param {Object} multiplayer - instance with .send(obj) and .getId() methods.
 * @param {Object} [opts]
 * @param {number} [opts.pollInterval=500] - ms to poll for controller availability.
 * @returns {{destroy: Function}}
 */
export function initSnapAnglePersistence(multiplayer, { pollInterval = 500 } = {}) {
  if (!multiplayer || typeof multiplayer.send !== 'function') {
    throw new Error('multiplayer (with send()) is required');
  }

  const KEY = 'snap_angles_v1';
  const MY_KEY = 'my_snap_angle_v1';
  let stopped = false;
  let pollTimer = null;

  function send(angle) {
    try {
      multiplayer.send({ type: 'snapAngleUpdate', angle, ts: Date.now(), from: multiplayer.getId?.() });
    } catch (e) {
      // best-effort
    }
  }

  function saveMy(angle) {
    try { localStorage.setItem(MY_KEY, String(angle)); } catch (e) {}
  }

  function loadMy() {
    try {
      const v = localStorage.getItem(MY_KEY);
      return v == null ? null : parseFloat(v);
    } catch (e) { return null; }
  }

  function attachToController(ctrl) {
    if (!ctrl || ctrl._snapAnglePersistenceAttached) return;
    ctrl._snapAnglePersistenceAttached = true;

    // If controller exposes a numeric snapAngle, announce it immediately.
    try {
      if (typeof ctrl.snapAngle === 'number') {
        send(ctrl.snapAngle);
        saveMy(ctrl.snapAngle);
      }
    } catch (e) {}

    // Wrap rotateBy (a common mutator) so we pick up angle changes.
    if (typeof ctrl.rotateBy === 'function') {
      const _orig = ctrl.rotateBy.bind(ctrl);
      ctrl.rotateBy = function (deg) {
        const res = _orig(deg);
        try {
          const angle = typeof ctrl.snapAngle === 'number' ? ctrl.snapAngle : (typeof ctrl._snapAngle === 'number' ? ctrl._snapAngle : null);
          if (typeof angle === 'number') { send(angle); saveMy(angle); }
        } catch (e) {}
        return res;
      };
    }

    // If controller exposes an explicit setter, wrap it as well.
    if (typeof ctrl.setAngle === 'function') {
      const _origSet = ctrl.setAngle.bind(ctrl);
      ctrl.setAngle = function (angle) {
        const res = _origSet(angle);
        try { send(angle); saveMy(angle); } catch (e) {}
        return res;
      };
    }

    // Expose a helper consumers can call to surface peer angles (best-effort)
    if (typeof ctrl.setPeerAngle !== 'function') {
      ctrl.setPeerAngle = function (peerId, angle) {
        try {
          if (!ctrl._peerAngles) ctrl._peerAngles = {};
          ctrl._peerAngles[peerId] = angle;
        } catch (e) {}
      };
    }
  }

  // Poll for the snap controller on window (created lazily elsewhere).
  pollTimer = setInterval(() => {
    if (stopped) return;
    const ctrl = window.furnitureRotationSnapping;
    if (ctrl) {
      attachToController(ctrl);
      // If we have a saved local preference, send it to peers immediately.
      const my = loadMy();
      if (my != null) { send(my); }
      clearInterval(pollTimer);
    }
  }, pollInterval);

  // Broadcast any previously-saved preference immediately (best-effort).
  try {
    const myStored = loadMy();
    if (myStored != null) send(myStored);
  } catch (e) {}

  function destroy() {
    stopped = true;
    if (pollTimer) clearInterval(pollTimer);
  }

  return { destroy };
}

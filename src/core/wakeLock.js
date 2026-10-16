// Keeps the screen awake while the game is open (Screen Wake Lock API). The browser drops the
// lock whenever the tab is hidden, so it is re-requested each time the page becomes visible
// again, and on the next tap / key press in case a request was refused for want of a gesture.
let _sentinel = null;
let _pending = false;

async function _acquire() {
  if (_pending || (_sentinel && !_sentinel.released)) return;
  if (!('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
  _pending = true;
  try {
    _sentinel = await navigator.wakeLock.request('screen');
    _sentinel.addEventListener('release', () => { _sentinel = null; });
  } catch (_) {
    _sentinel = null; // (not allowed right now — retried on the next visibility change / gesture)
  } finally {
    _pending = false;
  }
}

export function keepScreenAwake() {
  if (typeof navigator === 'undefined' || !('wakeLock' in navigator)) return;
  _acquire();
  document.addEventListener('visibilitychange', _acquire);
  window.addEventListener('pointerdown', _acquire, { passive: true });
  window.addEventListener('keydown', _acquire);
}

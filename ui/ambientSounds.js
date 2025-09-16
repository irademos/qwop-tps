/**
 * ui/ambientSounds.js
 * Lightweight ambient sounds controller (no side-effects on import).
 *
 * Exported factory: createAmbientSounds(audioManager, options)
 * - audioManager: optional AudioManager instance with playSFX(path, volume)
 * - options: { volume } default 0.55
 *
 * The returned controller has:
 * - setActive(boolean)
 * - toggle()
 * - isActive() -> boolean
 *
 * The module intentionally avoids top-level side-effects so it can be safely
 * dynamic-imported and initialized exactly once from the entry (app.js).
 */
export function createAmbientSounds(audioManager, { volume = 0.55 } = {}) {
  let active = false;
  let audioEl = null;

  function _playLoop() {
    try {
      if (audioManager && typeof audioManager.playSFX === 'function') {
        // AudioManager.playSFX returns an HTMLAudioElement in this codebase
        audioEl = audioManager.playSFX('ambient/birds_loop.ogg', volume);
        if (audioEl) audioEl.loop = true;
      } else {
        audioEl = new Audio('assets/audio/ambient/birds_loop.ogg');
        audioEl.loop = true;
        audioEl.volume = volume;
        audioEl.play().catch(() => {});
      }
    } catch (err) {
      console.warn('ambientSounds: failed to play', err);
      audioEl = null;
    }
  }

  function _stopLoop() {
    try {
      if (!audioEl) return;
      if (typeof audioEl.pause === 'function') audioEl.pause();
      // Best-effort cleanup
      try {
        if (audioEl.src) audioEl.src = '';
      } catch (e) {}
      audioEl = null;
    } catch (err) {
      // silent
    }
  }

  return {
    setActive(on) {
      const next = !!on;
      if (next === active) return;
      active = next;
      if (active) _playLoop();
      else _stopLoop();
    },
    toggle() {
      this.setActive(!active);
    },
    isActive() {
      return active;
    }
  };
}

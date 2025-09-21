/**
 * Lightweight campfire ambient audio controller.
 * - No top-level side-effects on import.
 * - Exported initCampfireAmbient(audioManager, options) returns a small controller:
 *   { setActive(boolean), setVolume(number), destroy() }
 *
 * The controller attempts to use audioManager.playBGS() if available (for background loops).
 * Falls back to audioManager.playSFX() or a plain HTMLAudioElement when needed.
 */

export function initCampfireAmbient(audioManager, {
  campfire = null,
  src = 'Ambient/Campfire.ogg',
  volume = 0.6,
  maxDistance = 8 // optional: if campfire and player are available, we could adjust volume by distance later
} = {}) {
  let audio = null;
  let active = false;
  let currentVolume = volume;

  function _createAudioElement() {
    try {
      // Prefer background stream API if available
      if (audioManager && typeof audioManager.playBGS === 'function') {
        const a = audioManager.playBGS(src, currentVolume);
        if (a) return a;
      }
    } catch (e) {
      // ignore and fallback
    }

    try {
      if (audioManager && typeof audioManager.playSFX === 'function') {
        const a = audioManager.playSFX(src, currentVolume);
        if (a) {
          try { a.loop = true; } catch (e) {}
          return a;
        }
      }
    } catch (e) {}

    // Ultimate fallback to HTMLAudioElement
    try {
      const a = new Audio(`assets/audio/${src}`);
      a.loop = true;
      a.volume = currentVolume;
      // start attempt; callers should tolerate autoplay being blocked
      a.play().catch(() => {});
      return a;
    } catch (e) {
      return null;
    }
  }

  function setActive(next) {
    const want = Boolean(next);
    if (want === active) return;
    active = want;
    if (active) {
      try {
        audio = _createAudioElement();
        if (audio) {
          // best-effort start
          try { audio.volume = currentVolume; } catch (e) {}
          const p = audio.play && audio.play();
          if (p && typeof p.catch === 'function') p.catch(() => {});
        }
      } catch (e) {
        console.error('campfireAmbient: failed to start audio', e);
        audio = null;
      }
    } else {
      try {
        if (audio && typeof audio.pause === 'function') {
          try { audio.pause(); } catch (e) {}
          try { audio.currentTime = 0; } catch (e) {}
        }
      } catch (e) {}
      audio = null;
    }
  }

  function setVolume(v) {
    currentVolume = Math.max(0, Math.min(1, Number(v) || 0));
    try { if (audio) audio.volume = currentVolume; } catch (e) {}
  }

  function destroy() {
    setActive(false);
    audio = null;
  }

  return {
    setActive,
    setVolume,
    destroy
  };
}

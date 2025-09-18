/**
 * features/weatherMusic.js
 *
 * Lightweight weather-linked music controller.
 * - No top-level side-effects; call initWeatherMusic(...) to create controller.
 * - Smoothly crossfades between a calm track and a storm track based on "intensity" 0..1.
 *
 * @param {Object} audioManager - existing AudioManager instance (optional; used only for file path resolution)
 * @param {Object} options
 * @param {string} options.calmTrack - path relative to assets/audio/
 * @param {string} options.stormTrack - path relative to assets/audio/
 * @param {number} options.crossfade - responsiveness of crossfade (higher -> faster)
 * @param {number} options.baseVolume - master volume multiplier for both tracks
 * @returns {{ setStormIntensity(number), setActive(boolean), update(number), dispose() }}
 */
export function initWeatherMusic(audioManager, {
  calmTrack = 'Ambient/Calm.ogg',
  stormTrack = 'Ambient/Storm.ogg',
  crossfade = 1.5,
  baseVolume = 0.7
} = {}) {
  const toSrc = (p) => `assets/audio/${p}`;

  const calm = new Audio(toSrc(calmTrack));
  calm.loop = true;
  calm.preload = 'auto';
  calm.volume = 0;

  const storm = new Audio(toSrc(stormTrack));
  storm.loop = true;
  storm.preload = 'auto';
  storm.volume = 0;

  let targetIntensity = 0; // 0 = calm, 1 = storm
  let currentIntensity = 0;
  let enabled = false;

  function safePlay(audio) {
    try {
      const p = audio.play();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch (e) {
      // ignore autoplay/security errors
    }
  }

  function playIfNeeded() {
    // Attempt to play both tracks; browser may block but we'll ignore failures.
    if (calm.paused) safePlay(calm);
    if (storm.paused) safePlay(storm);
  }

  /**
   * Set desired storm intensity (0..1).
   * This will be smoothed over time by update().
   * @param {number} v
   */
  function setStormIntensity(v) {
    targetIntensity = Math.min(1, Math.max(0, Number(v) || 0));
    if (enabled) playIfNeeded();
  }

  /**
   * Enable/disable the controller. When disabled, audio is paused.
   * @param {boolean} v
   */
  function setActive(v) {
    enabled = !!v;
    if (!enabled) {
      try { calm.pause(); } catch (e) {}
      try { storm.pause(); } catch (e) {}
    } else {
      playIfNeeded();
    }
  }

  /**
   * Smoothly update crossfade. Call from main loop with delta seconds.
   * @param {number} dt
   */
  function update(dt = 0.016) {
    // simple exponential smoothing toward target
    const rate = Math.max(0.5, crossfade);
    const alpha = 1 - Math.exp(-dt * rate);
    currentIntensity += (targetIntensity - currentIntensity) * alpha;

    const calmVol = (1 - currentIntensity) * baseVolume;
    const stormVol = currentIntensity * baseVolume;

    try { calm.volume = Math.min(1, Math.max(0, calmVol)); } catch (e) {}
    try { storm.volume = Math.min(1, Math.max(0, stormVol)); } catch (e) {}
  }

  function dispose() {
    try { calm.pause(); calm.src = ''; } catch (e) {}
    try { storm.pause(); storm.src = ''; } catch (e) {}
  }

  return {
    setStormIntensity,
    setActive,
    update,
    dispose,
    // exported mainly for testing/debugging
    _internals: { calm, storm }
  };
}

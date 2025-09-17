/**
 * audio/dayNightAmbient.js
 *
 * Manages a simple day/night ambient background music cycle with crossfades.
 * - No top-level side-effects. Call initDayNightAmbient(...) to create a controller.
 *
 * API:
 *   const ctrl = initDayNightAmbient(audioManager, { dayTrack, nightTrack, dayDuration, nightDuration, crossfade });
 *   ctrl.setActive(true|false);
 *   ctrl.setTimeOfDay('day'|'night');
 *   ctrl.dispose();
 *
 * Notes:
 * - Tracks are referenced relative to "assets/audio/".
 * - This module will try to play immediately; if autoplay is blocked it will wait for a single user interaction.
 */

export function initDayNightAmbient(audioManager, {
  dayTrack = "Forest Day/Forest Day.ogg",
  nightTrack = "Forest Night/Forest Night.ogg",
  dayDuration = 90,      // seconds of "day" before switching to night
  nightDuration = 60,    // seconds of "night" before switching to day
  crossfade = 3          // seconds to crossfade between tracks
} = {}) {
  let active = true;
  let current = "day";
  let dayAudio = null;
  let nightAudio = null;
  let scheduledId = null;
  let disposed = false;

  function _makeAudio(track) {
    const a = new Audio(`assets/audio/${track}`);
    a.loop = true;
    a.preload = "auto";
    a.volume = 0;
    a.crossOrigin = "anonymous";
    return a;
  }

  async function _tryPlay(audio) {
    try {
      await audio.play();
    } catch (err) {
      // Autoplay blocked -> wait for a single user gesture then try again.
      const resume = () => {
        audio.play().catch(e => {});
        document.removeEventListener("click", resume);
        document.removeEventListener("keydown", resume);
      };
      document.addEventListener("click", resume, { once: true });
      document.addEventListener("keydown", resume, { once: true });
    }
  }

  function _crossfade(from, to, durationSeconds = 3) {
    if (!from || !to) return;
    const steps = Math.max(6, Math.floor(durationSeconds * 30)); // ~30fps ticks
    const tick = 1000 / 30;
    let i = 0;
    const fromStart = from.volume;
    to.volume = 0;
    _tryPlay(to);
    const iv = setInterval(() => {
      if (disposed) { clearInterval(iv); return; }
      i++;
      const t = i / steps;
      from.volume = Math.max(0, fromStart * (1 - t));
      to.volume = Math.min(1, t);
      if (i >= steps) {
        clearInterval(iv);
        try { from.pause(); } catch (e) {}
        to.volume = 1;
      }
    }, tick);
  }

  function _clearSchedule() {
    if (scheduledId != null) {
      clearTimeout(scheduledId);
      scheduledId = null;
    }
  }

  function _scheduleNext() {
    _clearSchedule();
    if (!active || disposed) return;
    const dur = current === "day" ? dayDuration : nightDuration;
    scheduledId = setTimeout(() => {
      if (disposed) return;
      if (current === "day") {
        _transitionTo("night");
      } else {
        _transitionTo("day");
      }
    }, Math.max(1000, dur * 1000));
  }

  function _transitionTo(target) {
    if (disposed || current === target) return;
    if (target === "night") {
      _crossfade(dayAudio, nightAudio, crossfade);
      current = "night";
    } else {
      _crossfade(nightAudio, dayAudio, crossfade);
      current = "day";
    }
    _scheduleNext();
  }

  async function _init() {
    dayAudio = _makeAudio(dayTrack);
    nightAudio = _makeAudio(nightTrack);

    // Start with day audible
    dayAudio.volume = 1;
    nightAudio.volume = 0;

    // Attempt to play both (night will be paused after first crossfade completes)
    await Promise.all([_tryPlay(dayAudio), _tryPlay(nightAudio).catch(() => {})]);

    // Some browsers will start audio but keep it paused; ensure night is paused to avoid duplicate playback
    try { if (!nightAudio.paused) nightAudio.pause(); } catch (e) {}

    current = "day";
    _scheduleNext();
  }

  // Public API
  const controller = {
    isActive() { return active && !disposed; },
    setActive(next) {
      active = !!next;
      if (!active) {
        _clearSchedule();
        // fade out both audios gently
        try {
          if (dayAudio) dayAudio.volume = 0;
          if (nightAudio) nightAudio.volume = 0;
        } catch (e) {}
      } else {
        // resume with current time-of-day
        if (current === "day") {
          try { dayAudio?.play(); dayAudio.volume = 1; } catch (e) {}
          try { nightAudio?.pause(); nightAudio.volume = 0; } catch (e) {}
        } else {
          try { nightAudio?.play(); nightAudio.volume = 1; } catch (e) {}
          try { dayAudio?.pause(); dayAudio.volume = 0; } catch (e) {}
        }
        _scheduleNext();
      }
      return active;
    },
    setTimeOfDay(which) {
      if (which !== "day" && which !== "night") return;
      _transitionTo(which);
    },
    dispose() {
      disposed = true;
      _clearSchedule();
      try { dayAudio?.pause(); dayAudio = null; } catch (e) {}
      try { nightAudio?.pause(); nightAudio = null; } catch (e) {}
    }
  };

  // initialize async but do not leak top-level side-effects
  _init().catch(err => console.error("dayNightAmbient init failed", err));

  return controller;
}

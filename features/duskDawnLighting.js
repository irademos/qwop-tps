/**
 * features/duskDawnLighting.js
 *
 * Adaptive dusk/dawn lighting presets.
 *
 * Exports:
 *   initDuskDawnLighting(THREE, { ambientLight, dirLight, scene, options })
 *
 * - No top-level side-effects.
 * - Uses requestAnimationFrame to smoothly interpolate between presets.
 * - Independent cycle (defaults match audio/dayNightAmbient durations).
 *
 * Small, lazy-loadable module so the main bundle stays small.
 */

export function initDuskDawnLighting(THREE, {
  ambientLight,
  dirLight,
  scene,
  options = {}
} = {}) {
  if (!THREE) throw new Error('THREE is required');
  if (!ambientLight) throw new Error('ambientLight is required');
  if (!dirLight) throw new Error('dirLight is required');

  const opts = Object.assign({
    dayDuration: 90,
    nightDuration: 60,
    crossfade: 3,
    baseDayAmbient: 0.6,
    baseDayDir: 1.0
  }, options);

  // Preset colors/intensities
  const presets = {
    day: {
      ambientColor: new THREE.Color(0xffffff),
      ambientIntensity: opts.baseDayAmbient,
      dirColor: new THREE.Color(0xffffff),
      dirIntensity: opts.baseDayDir
    },
    dusk: {
      ambientColor: new THREE.Color(0xffd8b8),
      ambientIntensity: Math.max(0.25, opts.baseDayAmbient * 0.65),
      dirColor: new THREE.Color(0xffb57a),
      dirIntensity: Math.max(0.4, opts.baseDayDir * 0.6)
    },
    night: {
      ambientColor: new THREE.Color(0x223344),
      ambientIntensity: Math.max(0.08, opts.baseDayAmbient * 0.25),
      dirColor: new THREE.Color(0x4f6a88),
      dirIntensity: Math.max(0.15, opts.baseDayDir * 0.2)
    },
    dawn: {
      ambientColor: new THREE.Color(0xffe6d1),
      ambientIntensity: Math.max(0.28, opts.baseDayAmbient * 0.7),
      dirColor: new THREE.Color(0xffd2a6),
      dirIntensity: Math.max(0.45, opts.baseDayDir * 0.55)
    }
  };

  let active = true;
  let phase = 'day'; // day | dusk | night | dawn
  let rafId = null;
  let timerId = null;
  let transitioning = false;
  let transitionStart = 0;
  let transitionDuration = Math.max(0.1, opts.crossfade);
  let fromPreset = null;
  let toPreset = null;

  // temp colors for lerping
  const tmpFrom = new THREE.Color();
  const tmpTo = new THREE.Color();

  function applyPresetInstant(p) {
    try {
      ambientLight.color.copy(p.ambientColor);
      ambientLight.intensity = p.ambientIntensity;
      dirLight.color.copy(p.dirColor);
      dirLight.intensity = p.dirIntensity;
    } catch (e) {}
  }

  function startTransition(targetPresetName, dur = transitionDuration) {
    if (!presets[targetPresetName]) return;
    fromPreset = {
      ambientColor: ambientLight.color.clone(),
      ambientIntensity: ambientLight.intensity,
      dirColor: dirLight.color.clone(),
      dirIntensity: dirLight.intensity
    };
    toPreset = presets[targetPresetName];
    transitioning = true;
    transitionStart = performance.now();
    transitionDuration = Math.max(0.05, dur);
    phase = targetPresetName === 'dawn' || targetPresetName === 'dusk' ? targetPresetName : targetPresetName;
    ensureRAF();
  }

  function ensureRAF() {
    if (rafId != null) return;
    function tick() {
      rafId = requestAnimationFrame(tick);
      if (!active) return;
      if (!transitioning) return;
      const now = performance.now();
      const t = Math.min(1, (now - transitionStart) / (transitionDuration * 1000));
      // Lerp ambient color and intensity
      tmpFrom.copy(fromPreset.ambientColor);
      tmpTo.copy(toPreset.ambientColor);
      tmpFrom.lerp(tmpTo, t);
      ambientLight.color.copy(tmpFrom);
      ambientLight.intensity = fromPreset.ambientIntensity + (toPreset.ambientIntensity - fromPreset.ambientIntensity) * t;
      // Lerp dir color and intensity
      tmpFrom.copy(fromPreset.dirColor);
      tmpTo.copy(toPreset.dirColor);
      tmpFrom.lerp(tmpTo, t);
      dirLight.color.copy(tmpFrom);
      dirLight.intensity = fromPreset.dirIntensity + (toPreset.dirIntensity - fromPreset.dirIntensity) * t;

      if (t >= 1) {
        transitioning = false;
        fromPreset = null;
        toPreset = null;
        // schedule next phase
        scheduleNextPhase();
      }
    }
    rafId = requestAnimationFrame(tick);
  }

  function clearRAF() {
    if (rafId != null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }

  function clearTimer() {
    if (timerId != null) {
      clearTimeout(timerId);
      timerId = null;
    }
  }

  function scheduleNextPhase() {
    clearTimer();
    if (!active) return;
    // Simple cycle: day -> dusk -> night -> dawn -> day
    let wait = 0;
    if (phase === 'day' || phase === 'dawn') {
      // wait full dayDuration before starting dusk
      wait = opts.dayDuration * 1000;
      timerId = setTimeout(() => {
        if (!active) return;
        startTransition('dusk', opts.crossfade);
      }, Math.max(1000, wait));
    } else if (phase === 'dusk') {
      // after dusk transition completes, go to night immediately (no extra wait)
      timerId = setTimeout(() => {
        if (!active) return;
        startTransition('night', opts.crossfade);
      }, Math.max(50, opts.crossfade * 1000));
    } else if (phase === 'night') {
      // wait full nightDuration then dawn
      wait = opts.nightDuration * 1000;
      timerId = setTimeout(() => {
        if (!active) return;
        startTransition('dawn', opts.crossfade);
      }, Math.max(1000, wait));
    }
  }

  // Initialize: set day preset and schedule
  applyPresetInstant(presets.day);
  phase = 'day';
  scheduleNextPhase();

  // Public API
  const controller = {
    isActive() { return active; },
    setActive(on) {
      active = !!on;
      if (!active) {
        clearTimer();
        clearRAF();
      } else {
        // resume cycle from current visuals
        ensureRAF();
        scheduleNextPhase();
      }
    },
    setDayDuration(v) { opts.dayDuration = Math.max(5, Number(v) || opts.dayDuration); },
    setNightDuration(v) { opts.nightDuration = Math.max(5, Number(v) || opts.nightDuration); },
    setCrossfade(v) { opts.crossfade = Math.max(0.05, Number(v) || opts.crossfade); transitionDuration = opts.crossfade; },
    dispose() {
      active = false;
      clearTimer();
      clearRAF();
    }
  };

  return controller;
}

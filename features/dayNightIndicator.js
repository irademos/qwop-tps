/**
 * features/dayNightIndicator.js
 *
 * Small, lazy-initialized HUD that displays the current day/night state.
 * - No top-level side-effects on import.
 * - Exported initDayNightIndicator(controller, options) returns { dispose }.
 *
 * The indicator polls the provided controller (or window.dayNightAmbient) for a
 * `.current` string ("day" | "night") and updates a compact, scoped DOM badge.
 *
 * NOTE: No additional files are required — app.js already imports and initializes
 * the day/night ambient controller (audio/dayNightAmbient.js) and this HUD.
 */

/**
 * Initialize a Day/Night HUD indicator.
 * @param {Object} controller - The day/night ambient controller (may be null).
 * @param {Object} options
 * @param {HTMLElement} options.parent - Parent node to attach the HUD (default: document.body).
 * @returns {{dispose: function()}}
 */
export function initDayNightIndicator(controller, { parent = document.body } = {}) {
  const el = document.createElement('div');
  el.className = 'ai-daynight-indicator';
  el.setAttribute('aria-hidden', 'true');
  el.textContent = 'Day';
  // Minimal inline styles to avoid touching global CSS files and keep scope local.
  Object.assign(el.style, {
    position: 'fixed',
    right: '12px',
    top: '12px',
    padding: '6px 10px',
    background: 'rgba(255,255,255,0.08)',
    color: '#ffffff',
    fontSize: '13px',
    borderRadius: '6px',
    zIndex: 9999,
    fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial',
    pointerEvents: 'none',
    transition: 'background-color 300ms ease, color 300ms ease, transform 200ms ease',
    transform: 'translateZ(0)'
  });
  parent.appendChild(el);

  let disposed = false;
  let last = null;

  function setState(state) {
    if (!state) return;
    if (state === last) return;
    last = state;
    el.textContent = state[0].toUpperCase() + state.slice(1);
    if (state === 'night') {
      el.style.background = 'linear-gradient(90deg, rgba(10,12,30,0.9), rgba(30,20,60,0.8))';
      el.style.color = '#ffd';
      el.style.boxShadow = '0 2px 8px rgba(0,0,0,0.4)';
    } else {
      el.style.background = 'linear-gradient(90deg, rgba(255,255,255,0.06), rgba(200,220,255,0.03))';
      el.style.color = '#fff';
      el.style.boxShadow = '0 2px 6px rgba(0,0,0,0.15)';
    }
  }

  // Polling loop via rAF (lightweight) so we don't depend on controller events.
  // The controller is expected to expose `.current` as "day" or "night" (or similar).
  function tick() {
    if (disposed) return;
    try {
      const ctrl = controller ?? (window && window.dayNightAmbient) ?? null;
      const cur = ctrl?.current ?? null;
      if (typeof cur === 'string') {
        setState(cur);
      }
    } catch (e) {
      // swallow; indicator is best-effort
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  return {
    dispose() {
      disposed = true;
      try { el.remove(); } catch (e) {}
    }
  };
}

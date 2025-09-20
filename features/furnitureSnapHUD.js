/**
 * features/furnitureSnapHUD.js
 *
 * Small, dependency-free HUD that displays the current furniture rotation snap angle.
 * - No top-level side-effects on import.
 * - Exported initFurnitureSnapHUD() returns a controller: { setAngle, setActive, destroy }.
 */

/**
 * @param {object} opts
 * @param {number} opts.initialAngle
 */
export function initFurnitureSnapHUD({ initialAngle = 15 } = {}) {
  if (typeof document === 'undefined') {
    return { setAngle() {}, setActive() {}, destroy() {} };
  }

  let el = null;
  let active = true;

  function ensureDOM() {
    if (el) return;
    // scoped styles
    if (!document.getElementById('fai-snap-hud-style')) {
      const style = document.createElement('style');
      style.id = 'fai-snap-hud-style';
      style.textContent = `
        .fai-snap-hud {
          position: fixed;
          right: 12px;
          bottom: 12px;
          background: rgba(0,0,0,0.6);
          color: #ffffff;
          padding: 6px 10px;
          border-radius: 6px;
          font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial;
          font-size: 13px;
          z-index: 99999;
          pointer-events: none;
          opacity: 0.95;
          min-width: 84px;
          text-align: center;
        }
        .fai-snap-hud__label {
          font-weight: 600;
          display: block;
        }
        .fai-snap-hud__val {
          font-family: monospace;
          margin-top: 2px;
        }
      `;
      document.head.appendChild(style);
    }

    el = document.createElement('div');
    el.className = 'fai-snap-hud';
    el.innerHTML = `<span class="fai-snap-hud__label">Snap Angle</span><span class="fai-snap-hud__val">${initialAngle}°</span>`;
    document.body.appendChild(el);
  }

  function setAngle(angle) {
    ensureDOM();
    const val = `${Math.round(Number(angle) || 0)}°`;
    const valEl = el.querySelector('.fai-snap-hud__val');
    if (valEl) valEl.textContent = val;
    return val;
  }

  function setActive(on) {
    ensureDOM();
    active = !!on;
    el.style.display = active ? 'block' : 'none';
  }

  function destroy() {
    if (el && el.parentNode) el.parentNode.removeChild(el);
    el = null;
  }

  // initialize visible state
  setActive(true);
  setAngle(initialAngle);

  return { setAngle, setActive, destroy };
}

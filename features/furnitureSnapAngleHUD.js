/**
 * features/furnitureSnapAngleHUD.js
 *
 * Small HUD indicator showing the current furniture snap angle.
 * - Exported initFurnitureSnapAngleHUD() has no top-level side-effects.
 * - Creates a scoped DOM element and small stylesheet.
 *
 * Usage:
 *   const hud = initFurnitureSnapAngleHUD({ initialAngle: 15 });
 *   hud.setAngle(30);
 *   hud.setActive(true|false);
 *   hud.destroy();
 */

export function initFurnitureSnapAngleHUD({ initialAngle = 15 } = {}) {
  if (typeof document === 'undefined') {
    return { setAngle() {}, setActive() {}, destroy() {} };
  }

  const styleId = 'fai-snap-angle-hud-style';
  if (!document.getElementById(styleId)) {
    const s = document.createElement('style');
    s.id = styleId;
    s.textContent = `
.fai-snap-angle-hud { position: fixed; right: 12px; bottom: 96px; z-index: 9999; pointer-events: none; font-family: Inter, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial; }
.fai-snap-angle-hud .fai-bubble { background: rgba(12,14,16,0.72); color: #fff; padding: 8px 12px; border-radius: 10px; font-size: 13px; display:flex; align-items:center; gap:10px; box-shadow: 0 6px 18px rgba(0,0,0,0.45); }
.fai-snap-angle-hud .fai-angle { font-weight:700; font-variant-numeric: tabular-nums; }
.fai-snap-angle-hud .fai-label { opacity: 0.85; font-size: 11px; color: #e6eef8; }
.fai-snap-angle-hud.fai-hidden { display: none; }
.fai-snap-angle-hud .fai-pulse { width:10px; height:10px; border-radius:50%; background: linear-gradient(135deg,#ffd166,#ff8fab); box-shadow: 0 0 10px rgba(255,140,140,0.9); transform: scale(1); transition: transform 160ms cubic-bezier(.2,.9,.4,1); }
.fai-snap-angle-hud .fai-pulse.pulse { transform: scale(1.6); }
`;
    document.head.appendChild(s);
  }

  const root = document.createElement('div');
  root.className = 'fai-snap-angle-hud fai-hidden';
  root.setAttribute('aria-hidden', 'true');

  const bubble = document.createElement('div');
  bubble.className = 'fai-bubble';

  const pulse = document.createElement('div');
  pulse.className = 'fai-pulse';

  const textWrap = document.createElement('div');
  textWrap.style.display = 'flex';
  textWrap.style.flexDirection = 'column';

  const angleEl = document.createElement('div');
  angleEl.className = 'fai-angle';
  angleEl.textContent = `${initialAngle}°`;

  const label = document.createElement('div');
  label.className = 'fai-label';
  label.textContent = 'Snap Angle';

  textWrap.appendChild(angleEl);
  textWrap.appendChild(label);

  bubble.appendChild(pulse);
  bubble.appendChild(textWrap);
  root.appendChild(bubble);
  document.body.appendChild(root);

  let active = true;
  root.classList.remove('fai-hidden');

  function setAngle(angle) {
    if (typeof angle !== 'number' || Number.isNaN(angle)) return;
    angleEl.textContent = `${Math.round(angle)}°`;
    // visual pulse to call attention
    try {
      pulse.classList.add('pulse');
      setTimeout(() => pulse.classList.remove('pulse'), 220);
    } catch (e) {}
  }

  function setActive(v) {
    active = Boolean(v);
    if (active) root.classList.remove('fai-hidden');
    else root.classList.add('fai-hidden');
  }

  function destroy() {
    try { root.remove(); } catch (e) {}
  }

  return { setAngle, setActive, destroy };
}

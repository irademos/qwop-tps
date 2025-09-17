/**
 * ui/scoreHUD.js
 *
 * Minimal score HUD. No top-level side-effects.
 * createScoreHUD() returns { el, update, dispose }.
 */

export function createScoreHUD() {
  const el = document.createElement('div');
  el.className = 'ai-score-hud';
  el.setAttribute('aria-live', 'polite');
  el.style.position = 'fixed';
  el.style.right = '12px';
  el.style.top = '12px';
  el.style.padding = '8px 10px';
  el.style.background = 'rgba(0,0,0,0.6)';
  el.style.color = '#fff';
  el.style.fontFamily = 'Press Start 2P, monospace';
  el.style.fontSize = '12px';
  el.style.borderRadius = '8px';
  el.style.zIndex = 10000;
  el.style.pointerEvents = 'none';
  el.textContent = 'Score: 0';

  document.body.appendChild(el);

  function update(score) {
    el.textContent = `Score: ${Number(score) || 0}`;
  }

  function dispose() {
    if (el.parentNode) el.parentNode.removeChild(el);
  }

  return { el, update, dispose };
}

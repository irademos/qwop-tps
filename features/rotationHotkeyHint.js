/**
 * features/rotationHotkeyHint.js
 *
 * Lightweight, lazy-initialized HUD that shows a transient hint when rotation hotkeys
 * are pressed. No side-effects at module import time.
 *
 * Usage:
 *   const hint = initRotationHotkeyHint({ toasts });
 *   hint.setActive(true); // start listening
 *   hint.setActive(false); // stop listening
 *   hint.destroy(); // remove DOM + listeners
 */

export function initRotationHotkeyHint({ toasts } = {}) {
  let active = false;
  let timeoutId = null;
  let el = null;
  let inner = null;

  function ensureDOM() {
    if (el) return;
    // Scoped style
    if (!document.getElementById('fai-rot-hint-style')) {
      const style = document.createElement('style');
      style.id = 'fai-rot-hint-style';
      style.textContent = `
.fai-rot-hint {
  position: fixed;
  right: 16px;
  bottom: 92px;
  pointer-events: none;
  z-index: 20000;
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial;
}
.fai-rot-hint__bubble {
  background: rgba(10,10,12,0.88);
  color: #e6f7ff;
  padding: 8px 12px;
  border-radius: 10px;
  font-size: 13px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.45);
  transform-origin: 100% 100%;
  opacity: 0;
  transform: translateY(6px) scale(0.98);
  transition: opacity 220ms ease, transform 220ms ease;
  max-width: 220px;
  text-align: right;
}
.fai-rot-hint__bubble.fai-visible {
  opacity: 1;
  transform: translateY(0) scale(1);
}
.fai-rot-hint__kbd {
  display: inline-block;
  background: rgba(255,255,255,0.06);
  padding: 2px 6px;
  border-radius: 6px;
  margin-left: 8px;
  font-weight: 700;
  color: #dff4ff;
}
      `;
      document.head.appendChild(style);
    }

    el = document.createElement('div');
    el.className = 'fai-rot-hint';
    inner = document.createElement('div');
    inner.className = 'fai-rot-hint__bubble';
    el.appendChild(inner);
    document.body.appendChild(el);
  }

  function show(message) {
    if (!el) ensureDOM();
    if (!inner) return;
    inner.textContent = message;
    inner.classList.add('fai-visible');
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = setTimeout(() => {
      try { inner.classList.remove('fai-visible'); } catch (e) {}
      timeoutId = null;
    }, 1400);
  }

  function keyHandler(e) {
    // Respect modifier keys so we don't interfere with e.g. Ctrl/Alt combos
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.code === 'BracketLeft') {
      show('Rotate: -15°');
    } else if (e.code === 'BracketRight') {
      show('Rotate: +15°');
    } else if (e.code === 'KeyK') {
      show('Snap: nearest');
    }
  }

  return {
    /**
     * Start / stop listening for rotation hotkeys.
     * @param {boolean} v
     */
    setActive(v = true) {
      if (v === active) return;
      active = !!v;
      if (active) {
        ensureDOM();
        window.addEventListener('keydown', keyHandler);
      } else {
        window.removeEventListener('keydown', keyHandler);
        if (inner) inner.classList.remove('fai-visible');
        if (timeoutId) { clearTimeout(timeoutId); timeoutId = null; }
      }
    },
    /**
     * Remove DOM and listeners permanently.
     */
    destroy() {
      window.removeEventListener('keydown', keyHandler);
      if (timeoutId) { clearTimeout(timeoutId); timeoutId = null; }
      if (el && el.parentNode) el.parentNode.removeChild(el);
      el = null;
      inner = null;
      active = false;
    }
  };
}

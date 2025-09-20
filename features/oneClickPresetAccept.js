/**
 * One-click preset accept flow.
 *
 * Export: initOneClickPresetAccept({ furniturePresets, toasts, timeout = 12000 })
 *
 * - No top-level side effects on import.
 * - Call notify({ name, from }) to present an accept UI for the named preset.
 * - UI is keyboard-driven (Enter = accept, Escape = dismiss) and auto-expires.
 *
 * This module purposely avoids adding persistent buttons and scopes its DOM
 * using a distinct class name to avoid global selector collisions.
 */

/**
 * @param {object} opts
 * @param {object} opts.furniturePresets - API returned by features/furniturePresets
 * @param {object} opts.toasts - toast manager (optional)
 * @param {number} opts.timeout - milliseconds before auto-expire (default 12000)
 */
export function initOneClickPresetAccept({ furniturePresets, toasts, timeout = 12000 } = {}) {
  if (typeof document === 'undefined') {
    return {
      notify() {},
      destroy() {}
    };
  }

  let queue = [];
  let active = null;
  let timer = null;

  // Create HUD element (scoped class)
  const hud = document.createElement('div');
  hud.className = 'ai-oneclick-preset-accept';
  hud.style.position = 'fixed';
  hud.style.left = '50%';
  hud.style.top = '6%';
  hud.style.transform = 'translateX(-50%)';
  hud.style.background = 'rgba(10,10,12,0.85)';
  hud.style.color = '#e6f7ff';
  hud.style.padding = '8px 12px';
  hud.style.borderRadius = '8px';
  hud.style.fontFamily = 'system-ui, Arial, sans-serif';
  hud.style.fontSize = '13px';
  hud.style.zIndex = '99999';
  hud.style.boxShadow = '0 4px 18px rgba(0,0,0,0.5)';
  hud.style.pointerEvents = 'none';
  hud.style.opacity = '0';
  hud.style.transition = 'opacity 200ms ease';
  hud.style.maxWidth = 'min(80vw, 520px)';
  hud.style.textAlign = 'center';
  hud.style.lineHeight = '1.25';
  hud.setAttribute('aria-hidden', 'true');

  const msg = document.createElement('div');
  hud.appendChild(msg);

  const hint = document.createElement('div');
  hint.style.marginTop = '6px';
  hint.style.fontSize = '11px';
  hint.style.color = '#9fd6ff';
  hud.appendChild(hint);

  document.body.appendChild(hud);

  function showHUD(text, hintText) {
    msg.textContent = text;
    hint.textContent = hintText || '';
    hud.style.opacity = '1';
    hud.setAttribute('aria-hidden', 'false');
  }
  function hideHUD() {
    hud.style.opacity = '0';
    hud.setAttribute('aria-hidden', 'true');
    msg.textContent = '';
    hint.textContent = '';
  }

  function _applyPreset(name) {
    try {
      if (furniturePresets && typeof furniturePresets.load === 'function') {
        furniturePresets.load(name);
        try { toasts?.show?.(`Applied preset: ${name}`); } catch (e) {}
      } else {
        try { toasts?.show?.(`Preset ready: ${name}`); } catch (e) {}
      }
    } catch (e) {
      console.error('Failed to apply preset via one-click accept', e);
      try { toasts?.show?.('Failed to apply preset'); } catch (e) {}
    }
  }

  function _processNext() {
    clearTimeout(timer);
    active = queue.shift() || null;
    if (!active) {
      hideHUD();
      return;
    }

    let remaining = Math.ceil(timeout / 1000);
    showHUD(`Remote preset received: "${active.name}" (from ${active.from || 'peer'})`, `Press Enter to apply · Esc to dismiss · Expires in ${remaining}s`);

    timer = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        clearInterval(timer);
        timer = null;
        // auto-expire (keep preset stored); move to next
        try { toasts?.show?.(`Preset expired: ${active.name}`); } catch (e) {}
        active = null;
        _processNext();
        return;
      }
      hint.textContent = `Press Enter to apply · Esc to dismiss · Expires in ${remaining}s`;
    }, 1000);
  }

  function notify({ name, from } = {}) {
    if (!name) return;
    queue.push({ name, from });
    if (!active) {
      _processNext();
    } else {
      try { toasts?.show?.(`Queued remote preset: ${name}`); } catch (e) {}
    }
  }

  function _onKey(e) {
    if (!active) return;
    if (e.key === 'Enter') {
      // accept
      const n = active.name;
      clearInterval(timer);
      timer = null;
      _applyPreset(n);
      active = null;
      hideHUD();
      _processNext();
    } else if (e.key === 'Escape') {
      // dismiss
      clearInterval(timer);
      timer = null;
      try { toasts?.show?.(`Dismissed preset: ${active.name}`); } catch (err) {}
      active = null;
      hideHUD();
      _processNext();
    }
  }

  window.addEventListener('keydown', _onKey);

  function destroy() {
    clearInterval(timer);
    window.removeEventListener('keydown', _onKey);
    try { hud.remove(); } catch (e) {}
    queue = [];
    active = null;
  }

  return { notify, destroy };
}

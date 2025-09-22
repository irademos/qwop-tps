/**
 * features/rotationHotkeyTTS.js
 *
 * Small, lazy-loaded accessibility helper that speaks a short hint when
 * rotation hotkeys are pressed (BracketLeft, BracketRight, KeyK).
 *
 * Export: initRotationHotkeyTTS({ toasts } = {})
 *
 * No top-level side-effects; caller must call initRotationHotkeyTTS() to attach.
 */

export function initRotationHotkeyTTS({ toasts } = {}) {
  let _active = true;
  let _lastSpoken = 0;
  const MIN_INTERVAL_MS = 900; // avoid spamming speech

  const hasTTS = typeof window !== 'undefined' && window.speechSynthesis && typeof SpeechSynthesisUtterance === 'function';

  function _speak(text) {
    const now = Date.now();
    if (now - _lastSpoken < MIN_INTERVAL_MS) return;
    _lastSpoken = now;

    if (hasTTS) {
      try {
        const u = new SpeechSynthesisUtterance(text);
        u.lang = 'en-US';
        u.rate = 1.0;
        // keep voice selection default (user/system)
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(u);
      } catch (e) {
        // Fallback to visual toast if speech fails
        try { toasts?.show?.(text); } catch (__) {}
      }
    } else {
      // no TTS available — surface via toast if possible
      try { toasts?.show?.(text); } catch (__) {}
    }
  }

  function keyHandler(e) {
    if (!_active) return;

    // Normalize to key codes to avoid keyboard layout issues (BracketLeft/Right, KeyK)
    const code = e.code;
    if (code === 'BracketLeft') {
      _speak('Rotate left. Hold or press again for finer control.');
    } else if (code === 'BracketRight') {
      _speak('Rotate right. Hold or press again for finer control.');
    } else if (code === 'KeyK') {
      _speak('Toggle rotation snap mode. Press K to switch snapping modes.');
    }
  }

  function setActive(next = true) {
    if (next === _active) return;
    _active = !!next;
  }

  function destroy() {
    if (typeof document !== 'undefined') {
      document.removeEventListener('keydown', keyHandler);
    }
    _active = false;
  }

  // Attach listener when initialized (no top-level effect on import)
  if (typeof document !== 'undefined') {
    document.addEventListener('keydown', keyHandler, { passive: true });
  }

  return {
    setActive,
    destroy
  };
}

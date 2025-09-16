/**
 * ui/actionsMenu.js
 *
 * Small, mobile-first "Actions" sheet/menu that exposes voice toggle, push-to-talk,
 * and rain toggle. Designed to show a single primary button on small screens and a
 * small popover on larger screens. No top-level side effects — call initActionsMenu()
 * from your app entry exactly once after DOM is available.
 *
 * Export: initActionsMenu(options)
 *
 * Options:
 *  - getInitialStates(): { micActive, rainActive } (optional)
 *  - onToggleVoice(): Promise<boolean|void> -> returns new mic state (true = active)
 *  - onStartTalk(): void
 *  - onStopTalk(): void
 *  - onToggleRain(next): boolean|void -> returns new rain state
 *
 * The module injects scoped CSS under the .ai-actions__* namespace to avoid collisions.
 */

/* eslint-disable no-unused-vars */
export function initActionsMenu({
  getInitialStates = () => ({}),
  onToggleVoice,
  onStartTalk,
  onStopTalk,
  onToggleRain
} = {}) {
  const css = `
  .ai-actions__container { position: fixed; right: 16px; bottom: 16px; z-index: 500; font-family: sans-serif; }
  .ai-actions__button { width: 48px; height: 48px; border-radius: 24px; background: rgba(0,0,0,0.7); color: #fff; border: none; cursor: pointer; font-size: 20px; display: flex; align-items:center; justify-content:center; }
  .ai-actions__sheet { position: absolute; right: 0; bottom: 64px; background: rgba(10,10,10,0.95); color: #fff; border-radius: 8px; padding: 8px; box-shadow: 0 8px 24px rgba(0,0,0,0.5); min-width: 140px; transform-origin: right bottom; transition: opacity 160ms ease, transform 160ms ease; }
  .ai-actions__sheet.hidden { opacity: 0; pointer-events: none; transform: scale(0.96); }
  .ai-actions__sheet .ai-actions__item { display: block; width: 100%; background: transparent; border: none; color: inherit; text-align: left; padding: 10px 12px; cursor: pointer; font-size: 14px; border-radius: 6px; }
  .ai-actions__sheet .ai-actions__item:hover { background: rgba(255,255,255,0.04); }
  .ai-actions__sheet-inner { display: flex; flex-direction: column; gap: 6px; }

  /* Mobile: expand to full-width bottom sheet */
  @media (max-width: 768px) {
    .ai-actions__container { left: 0; right: 0; display: flex; justify-content: center; bottom: 16px; }
    .ai-actions__button { width: 56px; height: 56px; border-radius: 28px; }
    .ai-actions__sheet { left: 8px; right: 8px; bottom: 80px; min-width: auto; border-radius: 12px; padding: 12px; }
  }
  `;

  // Inject CSS once
  if (typeof document !== 'undefined' && !document.getElementById('ai-actions__styles')) {
    const style = document.createElement('style');
    style.id = 'ai-actions__styles';
    style.textContent = css;
    document.head.appendChild(style);
  }

  if (typeof document === 'undefined') {
    return { open: () => {}, close: () => {} };
  }

  const btn = document.getElementById('actions-button');
  const sheet = document.getElementById('actions-sheet');
  const voiceBtn = document.getElementById('voice-toggle');
  const talkBtn = document.getElementById('talk-toggle');
  const rainBtn = document.getElementById('rain-toggle');

  const init = getInitialStates();
  let micActive = !!init.micActive;
  let rainActive = !!init.rainActive;

  function updateVoiceLabel() {
    if (!voiceBtn) return;
    voiceBtn.textContent = micActive ? 'Mute' : 'Unmute';
  }
  function updateRainLabel() {
    if (!rainBtn) return;
    rainBtn.textContent = rainActive ? '⛅ Rain Off' : '🌧️ Rain';
  }

  updateVoiceLabel();
  updateRainLabel();

  function openSheet() {
    if (!sheet) return;
    sheet.classList.remove('hidden');
    sheet.setAttribute('aria-hidden', 'false');
    if (btn) btn.setAttribute('aria-expanded', 'true');
  }
  function closeSheet() {
    if (!sheet) return;
    sheet.classList.add('hidden');
    sheet.setAttribute('aria-hidden', 'true');
    if (btn) btn.setAttribute('aria-expanded', 'false');
  }

  // toggle behavior
  if (btn) {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!sheet) return;
      if (sheet.classList.contains('hidden')) openSheet(); else closeSheet();
    });
  }

  // voice toggle
  if (voiceBtn) {
    voiceBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (typeof onToggleVoice === 'function') {
        const next = await onToggleVoice();
        micActive = !!next;
        updateVoiceLabel();
      }
    });
  }

  // push-to-talk
  if (talkBtn) {
    const start = (e) => { if (e && e.preventDefault) e.preventDefault(); if (typeof onStartTalk === 'function') onStartTalk(); };
    const stop = (e) => { if (e && e.preventDefault) e.preventDefault(); if (typeof onStopTalk === 'function') onStopTalk(); };

    talkBtn.addEventListener('mousedown', start);
    talkBtn.addEventListener('touchstart', start, { passive: false });
    window.addEventListener('mouseup', stop);
    window.addEventListener('touchend', stop);
    window.addEventListener('touchcancel', stop);
  }

  // rain toggle
  if (rainBtn) {
    rainBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      rainActive = !rainActive;
      if (typeof onToggleRain === 'function') onToggleRain(rainActive);
      updateRainLabel();
    });
  }

  // close when tapping outside
  document.addEventListener('click', (e) => {
    const target = e.target;
    if (!sheet || !btn) return;
    if (sheet.classList.contains('hidden')) return;
    if (btn.contains(target) || sheet.contains(target)) return;
    closeSheet();
  });

  // close on Escape
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeSheet();
  });

  return { open: openSheet, close: closeSheet };
}

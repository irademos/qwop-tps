// Menu / lobby button sounds (public/assets/audio/SFX/UI/) — one delegated listener for the
// start screen, the Multiplayer lobby / party / invite / results screens and the settings /
// leaderboard panels, so their buttons need no wiring of their own:
//   confirm  — a primary button (a mode, Log In, Accept, Start Battle…)
//   cancel   — backing out (Back, Cancel, Decline, Leave, Forfeit, ✕)
//   deselect — switching a tab / chip / pick / rule / the character card
//   disallow — pressing a disabled or locked one
//   error    — a login error message (`playUiSound('error')`, from the start screen's setMessage)
// In-game HUD buttons keep their own sounds (none here).

export const UI_SOUNDS = {
  confirm: ['sci_fi_confirm.ogg', 0.45],
  cancel: ['sci_fi_cancel.ogg', 0.45],
  deselect: ['sci_fi_deselect.ogg', 0.35],
  disallow: ['sci_fi_disallow.ogg', 0.45],
  error: ['sci_fi_error.ogg', 0.45]
};

// where the menu buttons live
const SCOPE = [
  '#start-overlay',
  '.duel-lobby',            // the lobby + a battle's party setup (match-setup)
  '.duel-prompt',           // challenge prompt
  '.match-invite',          // battle invite
  '.match-results',
  '.settings-overlay',      // settings + leaderboard
  '#settings-button',
  '.duel-forfeit-btn',
  '.match-leave-btn'
].join(',');

const BUTTON = 'button, [role="button"], #settings-button';
const SWITCH = '.ui-chip, [role="tab"], .settings-tab, .leaderboard-tab, .match-rule, .match-pick-btn, .match-char-nav, .match-mini-btn';
const CANCEL_CLASS = '.settings-close, .match-leave-btn, .duel-forfeit-btn';
const CANCEL_LABEL = /^\s*(back|cancel|decline|leave|forfeit|close|not right now|no thanks|✕|×)/i;

let _audio = null;

export function playUiSound(name) {
  const def = UI_SOUNDS[name];
  if (!def || !_audio?.playSFX) return;
  _audio.playSFX(`SFX/UI/${def[0]}`, def[1], { cooldownKey: 'ui-sound', cooldownMs: 60 });
}

function kindFor(btn) {
  if (btn.matches(CANCEL_CLASS) || CANCEL_LABEL.test(btn.textContent || '')) return 'cancel';
  if (btn.matches(SWITCH)) return 'deselect';
  return 'confirm';
}

const isBlocked = (btn) => btn.disabled || btn.getAttribute('aria-disabled') === 'true'
  || btn.classList.contains('locked') || btn.classList.contains('is-disabled')
  || !!btn.closest('.is-disabled');

export function installUiSounds(audioManager) {
  _audio = audioManager;
  let preloaded = false;
  const preload = () => {
    if (preloaded) return;
    preloaded = true;
    for (const [file] of Object.values(UI_SOUNDS)) void _audio.loadBuffer?.(`SFX/UI/${file}`);
  };
  // pointer events reach disabled buttons (clicks don't), so that is where "disallow" comes from
  window.addEventListener('pointerdown', (e) => {
    preload();
    const btn = e.target?.closest?.(BUTTON);
    if (btn && btn.closest(SCOPE) && isBlocked(btn)) playUiSound('disallow');
  }, { capture: true, passive: true });
  window.addEventListener('keydown', preload, { capture: true, passive: true, once: true });
  window.addEventListener('click', (e) => {
    const btn = e.target?.closest?.(BUTTON);
    if (!btn || !btn.closest(SCOPE)) return;
    if (isBlocked(btn)) {
      if (e.detail === 0) playUiSound('disallow'); // keyboard: no pointerdown came first
      return;
    }
    playUiSound(kindFor(btn));
  }, { capture: true, passive: true });
  window.playUiSound = playUiSound;
}

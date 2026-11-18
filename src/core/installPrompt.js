// "Install the app" popup for phones / tablets that aren't running the game as an installed app.
// Shown once, SHOW_AFTER_MS after the page opens, on a touch device in a browser tab (not standalone /
// fullscreen display mode, not iOS's navigator.standalone). Dismiss (or installing) remembers it in
// localStorage (DISMISS_KEY) so it doesn't come back. Where the browser offers its own install prompt
// (Chrome / Edge / Samsung on Android — `beforeinstallprompt`) the Install button opens it; elsewhere
// (iOS Safari, Firefox…) the popup says how to add it from the browser's menu.
// Dev console: window.showInstallPrompt() previews it (ignores the checks).

const DISMISS_KEY = 'sq:installPromptDismissed';
const SHOW_AFTER_MS = 2500;

let deferredPrompt = null;
let popupEl = null;

function isStandalone() {
  try {
    if (window.matchMedia('(display-mode: standalone)').matches) return true;
    if (window.matchMedia('(display-mode: fullscreen)').matches) return true;
    if (window.matchMedia('(display-mode: minimal-ui)').matches) return true;
  } catch { /* old browser */ }
  return window.navigator.standalone === true; // iOS home-screen app
}

function isMobile() {
  const ua = navigator.userAgent || '';
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(ua)) return true;
  // iPadOS reports itself as a Mac
  if (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) return true;
  try { return window.matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 900; } catch { return false; }
}

function isIOS() {
  const ua = navigator.userAgent || '';
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

function wasDismissed() {
  try { return localStorage.getItem(DISMISS_KEY) === '1'; } catch { return false; }
}

function rememberDismissed() {
  try { localStorage.setItem(DISMISS_KEY, '1'); } catch { /* private mode */ }
}

function hidePopup() {
  if (!popupEl) return;
  const el = popupEl;
  el.classList.remove('is-shown');
  setTimeout(() => { if (!el.classList.contains('is-shown')) el.hidden = true; }, 350);
}

function howToText() {
  if (isIOS()) return 'Tap the Share button, then "Add to Home Screen".';
  return 'Open your browser\'s menu and choose "Install app" or "Add to Home screen".';
}

function render() {
  const text = popupEl.querySelector('.install-prompt-text');
  const install = popupEl.querySelector('[data-install]');
  if (deferredPrompt) {
    text.textContent = 'Play full screen and offline — add Sword Showdown to your home screen.';
    install.hidden = false;
  } else {
    text.textContent = `Play full screen and offline. ${howToText()}`;
    install.hidden = true;
  }
}

function showPopup() {
  if (!popupEl) {
    popupEl = document.createElement('div');
    popupEl.id = 'install-prompt';
    popupEl.className = 'install-prompt';
    popupEl.setAttribute('role', 'dialog');
    popupEl.setAttribute('aria-label', 'Install the app');
    popupEl.hidden = true;
    popupEl.innerHTML = `
      <img class="install-prompt-icon" src="/icons/app_icon_192.png" alt="" width="48" height="48">
      <div class="install-prompt-body">
        <div class="install-prompt-title">Install the app</div>
        <div class="install-prompt-text"></div>
        <div class="install-prompt-btns">
          <button type="button" class="ui-btn install-prompt-btn" data-install>Install</button>
          <button type="button" class="ui-btn-ghost install-prompt-btn" data-dismiss>Dismiss</button>
        </div>
      </div>`;
    popupEl.querySelector('[data-install]').addEventListener('click', async () => {
      const prompt = deferredPrompt;
      if (!prompt) return;
      deferredPrompt = null;
      hidePopup();
      try {
        prompt.prompt();
        const choice = await prompt.userChoice;
        if (choice?.outcome === 'accepted') rememberDismissed();
      } catch { /* prompt already used */ }
    });
    popupEl.querySelector('[data-dismiss]').addEventListener('click', () => {
      rememberDismissed();
      hidePopup();
    });
    document.body.appendChild(popupEl);
  }
  render();
  popupEl.hidden = false;
  requestAnimationFrame(() => popupEl.classList.add('is-shown'));
}

function start() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // keep it for our own button instead of the browser's mini-infobar
    deferredPrompt = e;
    if (popupEl && !popupEl.hidden) render();
  });
  window.addEventListener('appinstalled', () => {
    rememberDismissed();
    hidePopup();
  });
  if (isStandalone() || !isMobile() || wasDismissed()) return;
  setTimeout(() => {
    if (!isStandalone() && !wasDismissed()) showPopup();
  }, SHOW_AFTER_MS);
}

if (typeof window !== 'undefined') {
  window.showInstallPrompt = showPopup;
  start();
}

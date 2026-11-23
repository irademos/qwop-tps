// Town: a brief popup in the middle of the screen for something got — a dish off the campfire
// (townCooking.js), a fish landed (townFishing.js): a big icon, a title and a line under it,
// with the menus' sci-fi confirm chime (uiSounds.js). T.popup({ icon, title, sub }); one at a
// time — a new one replaces the one showing. Pure DOM on the town HUD (.town-popup*).

import { el } from './townConfig.js';
import { playUiSound } from '../audio/uiSounds.js';

const SHOW_MS = 2200;   // on screen (its fade in / out included — styles.css)

export function installTownPopup(T) {
  const box = el('div', 'town-popup hidden');
  const icon = el('div', 'town-popup-icon');
  const text = el('div', 'town-popup-text');
  const title = el('div', 'town-popup-title');
  const sub = el('div', 'town-popup-sub');
  text.append(title, sub);
  box.append(icon, text);
  T.hud.append(box);
  let timer = 0;

  const hidePopup = () => {
    clearTimeout(timer);
    box.classList.add('hidden');
  };
  const popup = ({ icon: i = '', title: t = '', sub: s = '' } = {}) => {
    clearTimeout(timer);
    icon.textContent = i;
    title.textContent = t;
    sub.textContent = s;
    sub.classList.toggle('hidden', !s);
    // (restart the pop-in animation)
    box.classList.add('hidden');
    void box.offsetWidth;
    box.classList.remove('hidden');
    playUiSound('confirm');
    timer = setTimeout(hidePopup, SHOW_MS);
  };

  Object.assign(T, { popup, hidePopup });
}

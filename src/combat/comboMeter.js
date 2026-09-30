/**
 * Sword Showdown combo meter: counts consecutive sword hits. Being hurt, pressing
 * Block or having a swing blocked ends the combo; a combo of MIN_CASH_COMBO or more is
 * then cashed out as that many coins (onCashOut). The HUD (#combo-meter, .combo-*
 * in styles.css) shows from the second hit.
 *
 * Classic mode (setClassic(true)): no coins; every CLASSIC_EVERY-th hit flashes
 * "N-hit Combo!" at the bottom middle of the screen (#classic-combo, .classic-combo).
 */

const MIN_CASH_COMBO = 2;
const CASH_SHOW_MS = 1400; // how long the "+N coins" line stays after a combo ends
const CLASSIC_EVERY = 5;       // Classic: announce every 5th hit
const CLASSIC_SHOW_MS = 1300;  // how long a Classic "N-hit Combo!" stays up

export function createComboMeter({ onCashOut }) {
  let count = 0;
  let el = null;
  let countEl = null;
  let cashEl = null;
  let hideTimer = null;
  let classic = false;
  let classicEl = null;
  let classicTimer = null;

  const ensureDom = () => {
    if (el) return;
    el = document.createElement('div');
    el.id = 'combo-meter';
    el.className = 'combo-meter hidden';
    el.setAttribute('aria-live', 'polite');
    countEl = document.createElement('div');
    countEl.className = 'combo-count';
    cashEl = document.createElement('div');
    cashEl.className = 'combo-cash';
    el.append(countEl, cashEl);
    document.body.appendChild(el);
  };

  const restartAnimation = (node, cls) => {
    node.classList.remove(cls);
    void node.offsetWidth;
    node.classList.add(cls);
  };

  const hideClassic = () => {
    clearTimeout(classicTimer);
    classicEl?.classList.add('hidden');
  };

  const showClassic = (n) => {
    if (!classicEl) {
      classicEl = document.createElement('div');
      classicEl.id = 'classic-combo';
      classicEl.className = 'classic-combo hidden';
      classicEl.setAttribute('aria-live', 'polite');
      document.body.appendChild(classicEl);
    }
    classicEl.textContent = `${n}-hit Combo!`;
    classicEl.classList.remove('hidden');
    restartAnimation(classicEl, 'classic-combo-pop');
    clearTimeout(classicTimer);
    classicTimer = setTimeout(hideClassic, CLASSIC_SHOW_MS);
  };

  const hit = () => {
    count += 1;
    if (classic) {
      if (count % CLASSIC_EVERY === 0) showClassic(count);
      return;
    }
    if (count < MIN_CASH_COMBO) return;
    ensureDom();
    clearTimeout(hideTimer);
    el.classList.remove('hidden', 'combo-ended');
    countEl.textContent = `${count} HIT COMBO`;
    cashEl.textContent = `+${count} 🪙 when it ends`;
    el.classList.toggle('combo-hot', count >= 10);
    restartAnimation(countEl, 'combo-pop');
  };

  const hide = () => {
    clearTimeout(hideTimer);
    el?.classList.add('hidden');
  };

  /** Ends the combo; pays out unless `cashOut` is false. Returns the coins paid. */
  const end = ({ cashOut = true } = {}) => {
    const n = count;
    count = 0;
    if (classic) return 0; // Classic has no coins
    if (n < MIN_CASH_COMBO) return 0;
    if (!cashOut) { hide(); return 0; }
    ensureDom();
    el.classList.add('combo-ended');
    el.classList.remove('combo-hot');
    countEl.textContent = `${n} HIT COMBO!`;
    cashEl.textContent = `+${n} 🪙`;
    restartAnimation(cashEl, 'combo-pop');
    clearTimeout(hideTimer);
    hideTimer = setTimeout(hide, CASH_SHOW_MS);
    onCashOut?.(n);
    return n;
  };

  return {
    hit,
    end,
    reset: () => {
      end({ cashOut: false });
      hideClassic();
    },
    /** Classic mode on/off (resets the combo and hides both HUDs) */
    setClassic(on) {
      count = 0;
      hide();
      hideClassic();
      classic = !!on;
    },
    get count() { return count; },
  };
}

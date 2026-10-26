// Town mode jailbreak: pick the cell's lock. A pin slides back and forth along the lock; press
// (🔧 Now! — the button, E / Enter or the phone's interact) while it's in the gold zone.
// LOCKPICK_HITS good presses open it; LOCKPICK_MISSES misses and a guard hears. Pure DOM.
//
// const pick = createLockpick(parent); pick.start(onDone(success)); pick.press(); pick.stop();
// pick.update(dt) every frame; pick.isOpen()

export const LOCKPICK_HITS = 3;
export const LOCKPICK_MISSES = 2;
const PIN_SPEED = 1.1;          // lock widths per second
const ZONE_WIDTH = 0.18;        // share of the lock that counts…
const ZONE_SHRINK = 0.035;      // …a little narrower after each good press

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
};

export function createLockpick(parent) {
  const panel = el('div', 'town-lockpick ui-panel hidden');
  const title = el('div', 'town-market-title', 'Pick the lock');
  const hint = el('div', 'town-market-info', 'Press when the pin is in the gold.');
  const track = el('div', 'town-lockpick-track');
  const zone = el('div', 'town-lockpick-zone');
  const pin = el('div', 'town-lockpick-pin');
  track.append(zone, pin);
  const status = el('div', 'town-lockpick-status');
  panel.append(title, hint, track, status);
  parent.append(panel);

  let run = null; // { x, dir, zoneAt, zoneW, hits, misses, onDone }

  const layout = () => {
    zone.style.left = `${run.zoneAt * 100}%`;
    zone.style.width = `${run.zoneW * 100}%`;
    const left = LOCKPICK_MISSES - run.misses;
    status.textContent = `${'🔓'.repeat(run.hits)}${'🔒'.repeat(LOCKPICK_HITS - run.hits)} · ${left} slip${left === 1 ? '' : 's'} left`;
  };
  const newZone = () => {
    run.zoneAt = 0.1 + Math.random() * (0.8 - run.zoneW);
  };
  const finish = (success) => {
    const done = run.onDone;
    run = null;
    panel.classList.add('hidden');
    done?.(success);
  };

  return {
    start: (onDone) => {
      run = { x: 0, dir: 1, zoneAt: 0.4, zoneW: ZONE_WIDTH, hits: 0, misses: 0, onDone };
      newZone();
      layout();
      panel.classList.remove('hidden');
    },
    // A press: true when it landed in the zone
    press: () => {
      if (!run) return false;
      const ok = run.x >= run.zoneAt && run.x <= run.zoneAt + run.zoneW;
      if (ok) {
        run.hits += 1;
        if (run.hits >= LOCKPICK_HITS) { finish(true); return true; }
        run.zoneW = Math.max(0.08, run.zoneW - ZONE_SHRINK);
        newZone();
      } else {
        run.misses += 1;
        if (run.misses >= LOCKPICK_MISSES) { finish(false); return false; }
      }
      layout();
      return ok;
    },
    stop: () => { if (run) { run = null; panel.classList.add('hidden'); } },
    update: (dt) => {
      if (!run) return;
      run.x += run.dir * PIN_SPEED * dt;
      if (run.x > 1) { run.x = 1; run.dir = -1; }
      if (run.x < 0) { run.x = 0; run.dir = 1; }
      pin.style.left = `${run.x * 100}%`;
    },
    isOpen: () => !!run,
  };
}

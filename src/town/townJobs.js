// Town mode missions: the job talk box and the quest tracker (the jobs themselves —
// townMissions.js; the townsfolk's work in order, one job after another — townIntro.js).
// Data + DOM only.
//
// A job: { id, kind, title, desc, giverId, reward: { coins, attitude, item?, town? },
//   status: 'open' (offered — ❗ over the giver) | 'active' | 'done' (❓ — back to the giver for
//   the reward), progress?, data: { target?: { x, z, h } — its 📍 } }
// kinds: nightThanks (the sheriff's reward for bandits beaten in the night — townBandits.js)

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
};

export const MAX_ACTIVE_JOBS = 3;   // taken (active + done) at once

// ── The talk: every conversation with a townsperson — small talk, a job offered / taken
// back done, the first day's goals — shown as a subtitle at the bottom of the screen (their
// name, coloured by their mood toward the player, and the line) with the player's replies under it ──
// open({ who, sub, text, reward, choices: [{ label, primary, act, onClick }] }) / close() /
// isOpen() / pressFirst() (E / Enter / the phone's interact). mood(): 'bad' | 'low' | 'mid' |
// 'good' for the name's colour. speak(text, { who, reply, interrupt }): read a line out (their
// line as it opens — cutting off what was being said, unless it answers the player's reply —
// and the player's reply as it's picked; a choice with `act` — Give 5, Take the reward, Pay… — is
// something done, not said: not read out, it only cuts off their line). onEnd: the talk's over — closed, or a choice picked that didn't
// open another line. (`sub` — what it's about — is left off: the line says it.)
export function createJobTalk(parent, { onEnd, mood, speak } = {}) {
  let model = null;
  let replying = false;
  const box = el('div', 'town-talk hidden');
  box.addEventListener('pointerdown', (e) => e.stopPropagation());
  parent.append(box);
  const hide = () => {
    model = null;
    box.classList.add('hidden');
    document.body.classList.remove('town-market-open');
  };
  const close = () => {
    if (!model) return;
    hide();
    onEnd?.();
  };
  // (a choice may open the next line; the talk only ends if it didn't)
  const choose = (c) => {
    if (c?.label && !c.act) speak?.(c.label, { reply: true, interrupt: true });
    else speak?.('', { stop: true });
    hide();
    replying = true;
    try { c?.onClick?.(); } finally { replying = false; }
    if (!model) onEnd?.();
  };
  const open = (m) => {
    model = m;
    const line = el('div', 'town-talk-line');
    const who = el('span', 'town-talk-who', m.who);
    const key = mood?.();
    if (key) who.dataset.mood = key;
    line.append(who, document.createTextNode(m.text));
    const choices = el('div', 'town-talk-choices');
    for (const c of m.choices) {
      const b = el('button', `town-talk-choice${c.primary ? ' is-primary' : ''}`, c.label);
      b.type = 'button';
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        if (model === m) choose(c);
      });
      choices.append(b);
    }
    speak?.(m.text, { who: m.who, interrupt: !replying });
    const parts = [line];
    if (m.reward) parts.push(el('div', 'town-talk-reward', m.reward));
    parts.push(choices);
    box.replaceChildren(...parts);
    box.classList.remove('hidden');
    document.body.classList.add('town-market-open');
  };
  return {
    open,
    close,
    isOpen: () => !!model,
    pressFirst: () => {
      if (!model) return false;
      choose(model.choices[0]);
      return true;
    },
  };
}

// ── The quest tracker: the active jobs and where they stand (top right) ──
export function createQuestTracker(parent) {
  const box = el('div', 'town-quests hidden');
  parent.append(box);
  let key = '';
  let shown = [];
  return {
    // (what it shows now — also listed in the town book)
    entries: () => shown,
    // entries: [{ title, progress, icon? }] (📍 being done, ❓ back for the reward)
    render: (entries) => {
      const k = entries.map((e) => `${e.icon}|${e.title}|${e.progress}`).join('/');
      if (k === key) return;
      key = k;
      shown = entries.map((e) => ({ ...e }));
      box.replaceChildren(...entries.map((e) => {
        const row = el('div', 'town-quest');
        row.append(el('div', 'town-quest-title', `${e.icon ?? '📍'} ${e.title}`), el('div', 'town-quest-progress', e.progress));
        return row;
      }));
      box.classList.toggle('hidden', !entries.length);
    },
  };
}

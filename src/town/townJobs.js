// Town mode missions: the jobs townsfolk give out (townMode.js makes them from the town's real
// needs and runs them), the authored quest chains, the job talk box and the quest tracker.
// Data + DOM only.
//
// A job: { id, kind, title, desc, giverId, reward: { coins, attitude, item?, town? },
//   status: 'open' (offered — ❗ over the giver) | 'active' | 'done' (❓ — back to the giver for
//   the reward), shady?, data: {…}, chain?: { id, step } }
// kinds (townMode.js jobProgress / the acts that finish them):
//   deliver     { good, n, toId }          — bring goods to someone (📦 Give)
//   bounty      { targetId }               — a bandit, dead (paid when it dies)
//   killBandits { n, kills }               — any bandits
//   guardField  { field, raiders }         — beat tonight's raid on a field
//   findKid     { kidId, found, spot }     — find a lost kid and walk them home
//   debt        { debtorId, creditorId, amount } — 💰 Collect / 🤲 Let it go
//   fetchStrongbox { carried }             — take the strongbox from the bandit camp…
//   returnTo    { toId }                   — …and hand it over

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
};

export const MAX_ACTIVE_JOBS = 3;   // taken (active + done) at once
export const OPEN_JOBS = 5;         // offered around town at once (one per townsperson)

// Authored chains: a few quest lines in Brindlewick. Each step is a job spec builder;
// `who(ctx)` picks the giver (by role / family), null when nobody fits (the chain waits).
// ctx: { byRole(role) → npc | null, parentOfKid() → { parent, kid } | null, firstField(owner) }
export const CHAINS = [
  {
    id: 'strongbox',
    title: 'The Sheriff\'s Strongbox',
    who: (c) => c.byRole('sheriff'),
    steps: [
      () => ({ kind: 'killBandits', title: 'Thin out the bandits', desc: 'The bandits camped way out past town have been bleeding us dry. Soften them up for me — beat 2 of them.', data: { n: 2, kills: 0 } }),
      () => ({ kind: 'fetchStrongbox', title: 'Steal back the strongbox', desc: 'They took the town\'s strongbox. It\'s at their camp — take it back. The Chief won\'t like it.', data: { carried: false } }),
      (g) => ({ kind: 'returnTo', title: 'Return the strongbox', desc: 'Bring the strongbox back to me.', data: { toId: g.id } }),
    ],
    reward: { coins: 120, attitude: 0.6, item: 'shield' },
  },
  {
    id: 'harvest',
    title: 'A Hungry Winter',
    who: (c) => c.byRole('farmer'),
    steps: [
      (g) => ({ kind: 'deliver', title: 'Wood for the smokehouse', desc: 'I need 5 wood to smoke meat for the winter. Could you bring me some?', data: { good: 'wood', n: 5, toId: g.id } }),
      (g) => ({ kind: 'deliver', title: 'Fish for the smokehouse', desc: 'Now 3 fish for the smokehouse.', data: { good: 'fish', n: 3, toId: g.id } }),
      (g, c) => ({ kind: 'guardField', title: 'Guard the harvest', desc: 'Bandits are after my field. Be there tonight and beat them off.', data: { field: c.firstField(g), raiders: [] } }),
    ],
    reward: { coins: 80, attitude: 0.6 },
  },
  {
    id: 'lostkid',
    title: 'Lost and Found',
    who: (c) => c.parentOfKid()?.parent ?? null,
    steps: [
      (g, c) => {
        const kid = c.parentOfKid()?.kid;
        return { kind: 'findKid', title: `Find ${kid?.first ?? 'the kid'}`, desc: `My ${kid?.first ?? 'little one'} wandered off and hasn't come back. Please find them and walk them home.`, data: { kidId: kid?.id ?? null, found: false, spot: null } };
      },
    ],
    reward: { coins: 40, attitude: 0.5, town: 0.1 },
  },
];

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

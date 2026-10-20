// Town mode missions: what the job boards post (townMode.js makes them from the town's real
// needs and runs them), the authored quest chains, the job board panel and the quest tracker.
// Data + DOM only.
//
// A job: { id, board: 'law' | 'town' | 'shady', kind, title, giverId, reward: { coins, attitude,
//   item? }, status: 'open' | 'active', data: {…}, chain?: { id, step } }
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

export const BOARDS = {
  law: { label: '📋 Sheriff\'s Board', short: '📋 Sheriff\'s jobs' },
  town: { label: '📋 Town Board', short: '📋 Town jobs' },
  shady: { label: '🤫 Shady deal', short: '🤫 Job?' },
};
export const MAX_ACTIVE_JOBS = 3;
export const OPEN_PER_BOARD = 3;

// Authored chains: a few quest lines in Brindlewick. Each step is a job spec builder;
// `who(ctx)` picks the giver (by role / family), null when nobody fits (the chain waits).
// ctx: { byRole(role) → npc | null, parentOfKid() → { parent, kid } | null, firstField(owner) }
export const CHAINS = [
  {
    id: 'strongbox',
    board: 'law',
    title: 'The Sheriff\'s Strongbox',
    who: (c) => c.byRole('sheriff'),
    steps: [
      (g) => ({ kind: 'killBandits', title: 'Thin out the bandits', desc: `${g.first} wants the camp outside town softened up: beat 2 bandits.`, data: { n: 2, kills: 0 } }),
      () => ({ kind: 'fetchStrongbox', title: 'Steal back the strongbox', desc: 'The town\'s strongbox is at the bandit camp. Take it — the Chief won\'t like it.', data: { carried: false } }),
      (g) => ({ kind: 'returnTo', title: 'Return the strongbox', desc: `Bring the strongbox back to ${g.first}.`, data: { toId: g.id } }),
    ],
    reward: { coins: 120, attitude: 0.6, item: 'shield' },
  },
  {
    id: 'harvest',
    board: 'town',
    title: 'A Hungry Winter',
    who: (c) => c.byRole('farmer'),
    steps: [
      (g) => ({ kind: 'deliver', title: 'Wood for the smokehouse', desc: `${g.first} needs 5 wood to smoke meat for the winter.`, data: { good: 'wood', n: 5, toId: g.id } }),
      (g) => ({ kind: 'deliver', title: 'Fish for the smokehouse', desc: `Now 3 fish for ${g.first}'s smokehouse.`, data: { good: 'fish', n: 3, toId: g.id } }),
      (g, c) => ({ kind: 'guardField', title: 'Guard the harvest', desc: `Bandits are after ${g.first}'s field. Be there tonight and beat them off.`, data: { field: c.firstField(g), raiders: [] } }),
    ],
    reward: { coins: 80, attitude: 0.6 },
  },
  {
    id: 'lostkid',
    board: 'town',
    title: 'Lost and Found',
    who: (c) => c.parentOfKid()?.parent ?? null,
    steps: [
      (g, c) => {
        const kid = c.parentOfKid()?.kid;
        return { kind: 'findKid', title: `Find ${kid?.first ?? 'the kid'}`, desc: `${g.first}'s child wandered off and hasn't come back. Find them and walk them home.`, data: { kidId: kid?.id ?? null, found: false, spot: null } };
      },
    ],
    reward: { coins: 40, attitude: 0.5, town: 0.1 },
  },
];

// ── The job board panel ──
// open(model) / render(model) / close() / isOpen()
// model: { title, open: [{ id, title, desc, reward }], active: [{ id, title, progress }], note }
// handlers: onAccept(id), onAbandon(id), onClose()
export function createJobBoardPanel(parent, handlers) {
  let open = false;
  const panel = el('div', 'town-board ui-panel hidden');
  panel.addEventListener('pointerdown', (e) => e.stopPropagation());
  parent.append(panel);
  const button = (label, primary, enabled, onClick) => {
    const b = el('button', `${primary ? 'ui-btn' : 'ui-btn-secondary'} town-board-btn`, label);
    b.type = 'button';
    b.disabled = !enabled;
    b.addEventListener('click', () => { if (open && !b.disabled) onClick(); });
    return b;
  };
  const render = (model) => {
    if (!open || !model) return;
    const head = el('div', 'town-market-head');
    head.append(el('div', 'town-market-title', model.title));
    const close = button('✕', false, true, () => handlers.onClose());
    close.classList.add('town-market-close');
    close.setAttribute('aria-label', 'Close');
    head.append(close);
    const parts = [head];
    if (model.note) parts.push(el('div', 'town-market-note', model.note));
    parts.push(el('div', 'town-market-subtitle', 'Posted'));
    if (!model.open.length) parts.push(el('div', 'town-market-info', 'Nothing posted right now — check back later.'));
    for (const j of model.open) {
      const row = el('div', 'town-board-row');
      const left = el('div', 'town-market-left');
      left.append(el('div', 'town-board-title', j.title), el('div', 'town-board-desc', j.desc), el('div', 'town-board-reward', j.reward));
      row.append(left, button('Accept', true, j.canAccept, () => handlers.onAccept(j.id)));
      parts.push(row);
    }
    if (model.active.length) {
      parts.push(el('div', 'town-market-subtitle', 'Your jobs'));
      for (const j of model.active) {
        const row = el('div', 'town-board-row');
        const left = el('div', 'town-market-left');
        left.append(el('div', 'town-board-title', j.title), el('div', 'town-board-desc', j.progress));
        row.append(left, button('Abandon', false, !j.locked, () => handlers.onAbandon(j.id)));
        parts.push(row);
      }
    }
    panel.replaceChildren(...parts);
  };
  return {
    open: (model) => {
      open = true;
      panel.classList.remove('hidden');
      document.body.classList.add('town-market-open');
      render(model);
    },
    render,
    close: () => {
      if (!open) return;
      open = false;
      panel.classList.add('hidden');
      document.body.classList.remove('town-market-open');
    },
    isOpen: () => open,
  };
}

// ── The quest tracker: the active jobs and where they stand (top right) ──
export function createQuestTracker(parent) {
  const box = el('div', 'town-quests hidden');
  parent.append(box);
  let key = '';
  return {
    // entries: [{ title, progress }]
    render: (entries) => {
      const k = entries.map((e) => `${e.title}|${e.progress}`).join('/');
      if (k === key) return;
      key = k;
      box.replaceChildren(...entries.map((e) => {
        const row = el('div', 'town-quest');
        row.append(el('div', 'town-quest-title', `📍 ${e.title}`), el('div', 'town-quest-progress', e.progress));
        return row;
      }));
      box.classList.toggle('hidden', !entries.length);
    },
  };
}

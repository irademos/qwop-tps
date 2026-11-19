// The quest runner — runs quests made of small reusable beats, one after another. Game-agnostic:
// what a beat does in the world is the beat's (a registry each game gives — Town's in
// townQuests.js), the world it does it in is `world` (that game's adapter). So a new job is data
// (src/town/quests/*.js) made of beats that already exist, plus a new beat only for something new.
//
// A quest: { id, title, beats: [beat…], restartAt?: label, failWaitS?, … anything its beats read }
// A beat:  { do: '<type>', label?, checkpoint?, …params } — run in order; `label` names it for
//          'goto:<label>' / restartAt; a save resumes at the last `checkpoint: true` beat at or
//          before the one it was on (beats that set things up — a cart brought round, a passenger
//          seated — are checkpoints; a fight half done isn't).
//
// A beat type (beats[type]) — every hook gets the run context `c`:
//   start(c)        → true: done at once (pay, set a flag)
//   update(c, dt)   → true: done
//   end(c)          — it's over (done, failed, the quest dropped)
//   entry(c)        → the quest tracker's progress text (null: the quest's default)
//   marker(c)       → { icon, x, z, h } (❗ / 📍 over something) or null
//   acts(c)         → [{ key, label, onClick }] buttons it offers
//   highlight(c)    → the button to ring (Town's: { gear, phone, act }) or null
//   talkTo(c, who)  → true: talking to `who` is this beat's (it opened its own talk)
//   npc(c, n, dt)   → true: this beat runs townsperson n's frame
//   event(c, kind, data) → true: it counted (a goal's 'fish' / 'deliver'…)
// c = { beat, quest, s (the beat's scratch — new each start), q (the quest's scratch — kept
//       across its beats, cleared on a restart), world, next(), goto(label), fail(text),
//       later(seconds) — back to the quest's first beat after a while, done(), runActions(list) }
//
// The runner's own state (saved): { id, bi } while a quest runs, { after: id } once the last
// one's done (a quest added later after it comes next) — snapshot() / start(saved).

export function createQuestRunner({ quests, beats, world, onChange = () => {} }) {
  let cur = null;          // { qi, bi, s, q, started, waitUntil }
  let after = null;        // the last quest done (none running)
  let failedAt = -Infinity;
  const time = () => world.time();

  const quest = () => (cur ? quests[cur.qi] : null);
  const beat = () => (cur ? quest().beats[cur.bi] ?? null : null);
  const type = (b) => beats[b?.do] ?? null;
  const ctxFor = () => {
    const c = {
      beat: beat(), quest: quest(), s: cur.s, q: cur.q, world,
      next: () => advance(cur.bi + 1),
      goto: (label) => { const i = quest().beats.findIndex((b) => b.label === label); advance(i >= 0 ? i : cur.bi + 1); },
      fail: (text) => fail(text),
      later: (s) => restart({ waitS: s, keepScratch: true }),
      done: () => advance(quest().beats.length),
      runActions: (list) => world.runActions(list, c),
    };
    return c;
  };
  const endBeat = () => {
    if (!cur?.started) return;
    cur.started = false;
    type(beat())?.end?.(ctxFor());
  };
  // On to beat i (past the last: the quest's done, on to the next quest)
  const advance = (i) => {
    if (!cur) return;
    const token = cur;
    endBeat();
    if (cur !== token) return;
    if (i >= quest().beats.length) {
      const done = quest();
      world.questEnded?.(done, cur.q);
      after = done.id;
      const ni = cur.qi + 1;
      cur = null;
      if (ni < quests.length) begin(ni, { waitS: quests[ni].waitS ?? 0 });
      onChange();
      return;
    }
    cur.bi = i;
    cur.s = {};
    onChange();
  };
  const begin = (qi, { bi = 0, waitS = 0 } = {}) => {
    cur = { qi, bi, s: {}, q: {}, started: false, waitUntil: time() + waitS };
    after = null;
  };
  // Back to the quest's restart point (its first beat, or restartAt), after a while
  const restart = ({ waitS = 0, keepScratch = false } = {}) => {
    if (!cur) return;
    endBeat();
    world.questReset?.(quest(), cur.q);
    const label = quest().restartAt;
    const i = label ? Math.max(0, quest().beats.findIndex((b) => b.label === label)) : 0;
    const q = keepScratch ? cur.q : {};
    cur = { qi: cur.qi, bi: i, s: {}, q, started: false, waitUntil: time() + waitS };
    onChange();
  };
  const fail = (text) => {
    if (!cur) return;
    failedAt = time();
    if (text) world.feed?.(text);
    restart({ waitS: quest().failWaitS ?? 20 });
  };

  const update = (dt) => {
    if (!cur || time() < cur.waitUntil) return;
    // (instant beats run straight through, a few a frame at most)
    for (let k = 0; k < 8 && cur; k++) {
      const b = beat();
      const t = type(b);
      if (!t) { console.warn('[quest] unknown beat', b?.do); advance(cur.bi + 1); continue; }
      const token = cur;
      const bi = cur.bi;
      if (!cur.started) {
        cur.started = true;
        const c = ctxFor();
        if (t.start?.(c)) { if (cur === token && cur.bi === bi) c.next(); continue; }
        if (cur !== token || cur.bi !== bi) continue;
      }
      const c = ctxFor();
      if (t.update?.(c, dt) && cur === token && cur.bi === bi) { c.next(); continue; }
      break;
    }
  };

  // What the current beat says, for the game's HUD / buttons (null when there's no quest going)
  const ask = (hook, ...args) => {
    if (!cur || !cur.started || time() < cur.waitUntil) return undefined;
    return type(beat())?.[hook]?.(ctxFor(), ...args);
  };

  return {
    update,
    // (saved state → running: a quest by id at its beat (resumed at the checkpoint before it),
    // `after` → the quest after that one, none → the first)
    start: (saved) => {
      cur = null;
      after = null;
      if (saved?.id) {
        const qi = quests.findIndex((x) => x.id === saved.id);
        if (qi >= 0) {
          let bi = Math.min(Math.max(0, saved.bi | 0), quests[qi].beats.length - 1);
          while (bi > 0 && !quests[qi].beats[bi].checkpoint) bi -= 1;
          begin(qi, { bi });
          return;
        }
      }
      if (saved?.after) {
        const k = quests.findIndex((x) => x.id === saved.after);
        if (k >= 0 && k + 1 < quests.length) begin(k + 1, { waitS: quests[k + 1].waitS ?? 0 });
        else after = saved.after;
        return;
      }
      if (quests.length) begin(0, { waitS: quests[0].waitS ?? 0 });
    },
    stop: () => { endBeat(); cur = null; },
    snapshot: () => (cur ? { id: quest().id, bi: cur.bi } : after ? { after } : null),
    running: () => !!cur,
    waiting: () => !!cur && time() < cur.waitUntil,
    quest,
    beat,
    q: () => cur?.q ?? null,
    entry: () => ask('entry'),
    marker: () => ask('marker'),
    acts: () => ask('acts') ?? [],
    highlight: () => ask('highlight') ?? null,
    talkTo: (who) => !!ask('talkTo', who),
    npc: (n, dt) => !!ask('npc', n, dt),
    event: (kind, data) => !!ask('event', kind, data),
    fail,
    recentlyFailed: (s) => time() - failedAt < s,
    // (on to a quest by id — skipping ahead, the dev console — at a beat label, after a while)
    jump: (id, label = null, waitS = 0) => {
      const qi = quests.findIndex((x) => x.id === id);
      if (qi < 0) return false;
      endBeat();
      if (cur) world.questReset?.(quest(), cur.q);
      begin(qi, { waitS });
      if (label) { const i = quests[qi].beats.findIndex((b) => b.label === label); if (i >= 0) cur.bi = i; }
      onChange();
      return true;
    },
  };
}

// Town's quest beats — a fight out on the walk (wave): the player auto-walks along the nearest
// stretch of the Endless walk (the Showdown stage routes joined up) while `count` enemies come at
// them, the job's allies (townAllies.js) fighting beside them — the night defense's fight
// (townDefense.js) made a beat, for any job with a fight like it (bootstrapGameApp.js
// `_townWaveStart`, through ctx.startWave). Not the camp's bandits: just there for the fight.
//   { do: 'wave', count: 7, level: 2, allies: ['wizard'], pathLen: 110, title, sub, text }
//   level     the Endless wave its enemies are like (bombers from 2, shield bearers 3, wands 4…)
//   count     how many (default: the level's)
//   champion  true: a champion last (default none)
//   pathLen   m of the walk it plays along
//   title/sub the banner (title null: none)
// The player down → the job fails (the quest's `downText`); an ally down → fails too. No walk to
// fight along (no routes, a wave already on) → an ambush round the player instead (beats/ambush.js).
// Part of townQuests.js' registry (beats/index.js).

import { ambushBeats } from './ambush.js';

export const waveBeats = (W) => {
  const { T, ctx, fill, joinAllies, leaveAllies, questWave, stopQuestWave } = W;
  const ambush = ambushBeats(W).ambush;
  const downText = (c) => fill(c.quest.downText ?? 'You went down — {wizard} limps back up the mountain. {wizard.He}\'ll ask again.', c.q);
  return {
    wave: {
      start: (c) => {
        const { beat: b } = c;
        stopQuestWave();
        const p = T.playerPos();
        c.s.fallback = false;
        questWave.res = null;
        const total = ctx.startWave?.({
          x: p.x, z: p.z, level: b.level ?? 1, count: b.count ?? null, champion: !!b.champion, pathLen: b.pathLen ?? 120,
          banner: b.title === null ? null : { title: fill(b.title ?? 'FIGHT!', c.q), sub: fill(b.sub ?? `${b.count ?? ''} of them are coming`.trim(), c.q) },
          onEnd: (res) => { questWave.res = res; },
        }) ?? 0;
        if (!total) {
          // (no walk to fight along: an ambush round the player instead)
          c.s.fallback = true;
          ambush.start({ ...c, beat: { ...b, count: b.count ?? 5, onAlly: b.onAlly ?? 1 } });
          return;
        }
        questWave.on = true;
        c.s.total = total;
        joinAllies(c, b.allies ?? []);
        ctx.playSfx?.('unsheath');
      },
      update: (c) => {
        if (c.s.fallback) return ambush.update(c);
        if (ctx.isPlayerDead()) { c.fail(downText(c)); return false; }
        const st = ctx.waveState?.();
        if (st) { c.s.killed = st.killed; return false; }
        // (over: ctx.startWave's game side ended it — all beaten is won)
        if (questWave.res && !questWave.res.won) { c.fail(downText(c)); return false; }
        questWave.on = false;
        return true;
      },
      end: (c) => {
        if (c.s.fallback) { ambush.end(c); return; }
        stopQuestWave();
        leaveAllies(c);
      },
      entry: (c) => (c.s.fallback ? ambush.entry(c) : `${fill(c.beat.text, c.q)} (${c.s.killed ?? 0} / ${c.s.total ?? c.beat.count ?? 0})`),
      icon: '⚔️',
    },
  };
};

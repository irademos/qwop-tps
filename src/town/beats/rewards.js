// Town's quest beats — The reward (pay) and the townsperson back to their day (release).
// Part of townQuests.js' registry (beats/index.js): each beat type's hooks get the runner's
// context `c` (src/quest/questRunner.js); `W` is Town's quest world (townQuests.js).

export const rewardsBeats = (W) => {
  const { T, ctx, roleNpc, control, release, fill, unseat, sendHome, firstName, GUIDE_REACH } = W;
  return {
    pay: {
      start: (c) => {
        const { beat: b, q } = c;
        const n = roleNpc(q, b.from);
        if (b.coins > 0) { ctx.addCoins(b.coins); ctx.playSfx?.('coin'); }
        if (n) {
          n.attitude = Math.min(1, n.attitude + 0.15);
          if (b.memory) T.remember(n, 'intro', { what: b.memory });
        }
        // (their done line: said aloud near them, else in the feed)
        if (b.say) {
          const line = fill(b.say, q);
          if (n?.body && T.distToPlayer(n) < GUIDE_REACH) T.say(n, line, { big: true });
          else T.feedLine(`${n ? `${firstName(n.name)}: ` : ''}${line}`);
        }
        T.feedLine(`${c.quest.title} — done${b.coins ? ` · +${b.coins} coins` : ''}`);
        return true;
      },
    },
    release: {
      start: (c) => {
        const n = roleNpc(c.q, c.beat.who);
        if (!n) return true;
        unseat(n);
        if (c.beat.linger) {
          control(n, { kind: 'linger', until: T.simT + c.beat.linger, ax: n.x, az: n.z });
          sendHome(n);
        } else release(n);
        // (kept out of the job's cleanup)
        if (c.q.cast) delete c.q.cast[c.beat.who];
        return true;
      },
    },
  };
};

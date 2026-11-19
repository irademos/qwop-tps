// Town's quest beats — Goods brought to someone (bring) and something they make with them (build).
// Part of townQuests.js' registry (beats/index.js): each beat type's hooks get the runner's
// context `c` (src/quest/questRunner.js); `W` is Town's quest world (townQuests.js).

const BUILD_REACH = 2.2;   // m from its place they start work
const HAMMER_S = 0.9;      // s between the work's knocks (heard near by)
const GOOD_WORD = { wood: 'wood', fish: 'fish', crops: 'veg' };

export const craftBeats = (W) => {
  const { T, ctx, roleNpc, control, go, stand, fill, npcMark, placeOf, goalHighlight, firstName, dist2 } = W;
  const have = (good) => T.goods?.[good] ?? 0;
  return {
    // The player brings `who` `count` of `good` in the bag (gathered the usual way); talking to them
    // with enough hands it over, short of it they say how many more
    bring: {
      update: (c) => { c.s.n = roleNpc(c.q, c.beat.who); return !!c.s.given; },
      talkTo: (c, n) => {
        if (!n || n.role !== c.beat.who) return false;
        const { beat: b } = c;
        const what = GOOD_WORD[b.good] ?? b.good;
        const got = have(b.good);
        if (got < b.count) {
          T.jobTalk.open({
            who: firstName(n.name),
            text: got > 0 ? `That's ${got} — ${b.count - got} more ${what} and I can get started.` : `${b.count} ${what}, {name}. Fell a tree with your sword and split its logs.`.replace('{name}', ctx.getPlayerName()),
            reward: fill(b.text ?? `Bring ${b.count} ${what}`, c.q),
            choices: [{ label: 'On it', primary: true }],
          });
          return true;
        }
        T.goods[b.good] = got - b.count;
        T.renderGoods();
        ctx.playSfx?.('wood', { x: n.x, y: T.groundY(n), z: n.z });
        T.feedLine(`Gave ${firstName(n.name)} ${b.count} ${what}.`);
        c.s.given = true;
        return true;
      },
      entry: (c) => {
        const { beat: b } = c;
        const got = Math.min(b.count, have(b.good));
        const base = `${fill(b.text ?? `Bring ${b.count} ${GOOD_WORD[b.good] ?? b.good}`, c.q)}: ${got} / ${b.count}`;
        return got >= b.count && c.s.n ? `${base} — take it to ${firstName(c.s.n.name)}` : base;
      },
      marker: (c) => (have(c.beat.good) >= c.beat.count ? npcMark(c.s.n, '📍') : null),
      highlight: (c) => (have(c.beat.good) < c.beat.count && c.beat.good === 'wood' ? goalHighlight('wood') : null),
      icon: '🪵',
    },
    // `who` goes to a place and works there `s` seconds; then what it `makes` is there (W.make)
    build: {
      start: (c) => { c.s.t = 0; c.s.knockAt = 0; },
      update: (c, dt) => {
        const { beat: b, s } = c;
        const n = roleNpc(c.q, b.who);
        s.n = n;
        s.at = placeOf(b.at);
        if (!n || !s.at) return false;
        if (!n.questing || n.qmode?.kind !== 'build') { if (!control(n, { kind: 'build' })) return false; }
        if (dist2(n.x, n.z, s.at.x, s.at.z) > BUILD_REACH) return false;
        s.t += dt;
        if (T.simT > s.knockAt && T.distToPlayer(n) < 30) {
          s.knockAt = T.simT + HAMMER_S * (0.8 + Math.random() * 0.4);
          ctx.playSfx?.('chop', { x: n.x, y: T.groundY(n) + 0.6, z: n.z });
          if (Math.random() < 0.35) n.body?.character.playAction?.(W.glbCharacterConfig.throwClip);
        }
        if (s.t < (b.s ?? 20)) return false;
        W.make(b.makes, true);
        return true;
      },
      npc: (c, n, dt) => {
        const { s } = c;
        if (n !== s.n || !s.at) return false;
        const d = dist2(n.x, n.z, s.at.x, s.at.z);
        if (d > BUILD_REACH * 0.8) go(n, s.at.x, s.at.z, dt, d > 15);
        else stand(n, s.at.face?.x ?? s.at.x, s.at.face?.z ?? s.at.z + 1, dt);
        return true;
      },
      entry: (c) => {
        const { beat: b, s } = c;
        const pct = Math.min(100, Math.round((s.t / (b.s ?? 20)) * 100));
        return `${fill(b.text ?? 'Building', c.q)}${s.t > 0 ? ` (${pct}%)` : ''}`;
      },
      marker: (c) => (c.s.at && T.distToPlayer(c.s.at) > 8 ? { icon: '📍', x: c.s.at.x, z: c.s.at.z, h: 1.4 } : null),
      icon: '🔨',
    },
  };
};

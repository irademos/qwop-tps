// Town's quest beats — A goal to do n times with a guide leading the way (goal — townGuide.js); skipped if had (unless); a banner.
// Part of townQuests.js' registry (beats/index.js): each beat type's hooks get the runner's
// context `c` (src/quest/questRunner.js); `W` is Town's quest world (townQuests.js).

export const goalBeats = (W) => {
  const { T, ctx, roleNpc, canTake, control, release, fill, isNight, tipTalk, guideBuys, goalHighlight, newLead, firstName } = W;
  return {
    // Do something n times (T.questNote(kind)); the guide leads the way to it (townGuide.js)
    goal: {
      start: (c) => {
        c.s.count = 0;
        c.s.L = newLead(c.beat.at, c.q.autoWalk ?? false);
      },
      update: (c, dt) => {
        const { beat: b, s } = c;
        const g = b.guide ? roleNpc(c.q, b.guide) : null;
        s.g = g;
        // (leading while they can — not by night, nor while the player's wanted, nor busy)
        const lead = !!g && b.lead !== false && !isNight() && !T.law.stars && !T.jail && !ctx.isPlayerDead() && canTake(g) && T.guide.leading(s.L, g);
        if (lead && (!g.questing || g.qmode?.kind !== 'lead')) control(g, 'lead');
        else if (!lead && g?.questing && g.qmode?.kind === 'lead') release(g);
        T.guide.walkFrame(s.L, g, dt);
        if (b.guideBuys) guideBuys(c, g);
        return s.count >= (b.n ?? 1);
      },
      event: (c, kind) => {
        if (kind !== c.beat.kind) return false;
        c.s.count += 1;
        return true;
      },
      npc: (c, n, dt) => (n === c.s.g && n.qmode?.kind === 'lead' ? T.guide.leadFrame(n, c.s.L, dt, { tips: c.beat.tips, fill: (t) => fill(t, c.q) }) : false),
      // (talking to the guide on the way: a tip)
      talkTo: (c, n) => (n === c.s.g ? (tipTalk(c, n), true) : false),
      entry: (c) => {
        const { beat: b, s } = c;
        let progress = fill(b.progress ?? c.quest.title, c.q);
        if ((b.n ?? 1) > 1) progress += ` (${s.count} / ${b.n})`;
        if (s.g?.qmode?.kind === 'lead' && !s.L.frame?.arrived && T.distToPlayer(s.g) > T.guide.LEAD_WAIT) progress += ` — follow ${firstName(s.g.name)}`;
        return progress;
      },
      marker: (c) => T.guide.marker(c.s.L, c.s.g),
      acts: (c) => T.guide.acts(c.s.L, c.s.g),
      highlight: (c) => goalHighlight(c.beat.kind),
    },
    // The quest's skipped if the player has it already
    unless: {
      start: (c) => {
        if (c.beat.has && ctx.getItems()?.[c.beat.has]) { c.done(); return false; }
        return true;
      },
    },
    banner: {
      start: (c) => {
        ctx.showBanner(c.beat.title, c.beat.sub ?? '', 2800);
        if (c.beat.feed) T.feedLine(fill(c.beat.feed, c.q));
        return true;
      },
    },
  };
};

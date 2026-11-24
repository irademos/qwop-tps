// Town's quest beats — Someone comes to find the player (seek — `arrive`: from far off, in by a place) and talks (talk).
// Part of townQuests.js' registry (beats/index.js): each beat type's hooks get the runner's
// context `c` (src/quest/questRunner.js); `W` is Town's quest world (townQuests.js).

const ARRIVE_FAR = 60; // m off before `arrive` brings them in by its place

export const peopleBeats = (W) => {
  const { T, ctx, P, placeOf, mayApproach, hasItem, dist2, roleNpc, roleGone, canTake, control, release, stand, fill, calm, isNight, npcMark, actors, open, talker, firstName, SNOOZE_S, SEEK_STOP, SEEK_STUCK_S } = W;
  return {
    // The giver comes to find the player (❗ over them); talking to them first does too
    seek: {
      start: (c) => { c.s.since = T.simT; c.s.best = Infinity; c.s.bestAt = T.simT; },
      update: (c) => {
        const { beat: b, s } = c;
        // (nobody of the role left in town — dead, not replaced yet: on without them)
        if (b.ifGone && roleGone(b.who)) {
          if (b.ifGone === 'done') c.done();
          else c.runActions([b.ifGone]);
          return false;
        }
        const n = roleNpc(c.q, b.who);
        s.n = n;
        if (!n) return false;
        // (another branch's job under way, its giver ahead in the queue, or the player busy — in a
        // fight, out on the water, off the island: not now — townQuests.js updateBranches)
        if (!mayApproach(c)) { if (n.questing && ['seek', 'wait'].includes(n.qmode?.kind)) release(n); return false; }
        // (arrive: someone far off, with no walk to the player — the wizard on his mountain —
        // comes in by that place instead, the newcomers' way into town: once, out of sight)
        if (b.arrive && !s.arrived) {
          s.arrived = true;
          const at = placeOf(b.arrive);
          const p = T.playerPos();
          const far = T.distToPlayer(n);
          if (at && !n.inside && far > ARRIVE_FAR && dist2(at.x, at.z, p.x, p.z) < far && T.distToPlayer(at) > 20) {
            n.x = at.x;
            n.z = at.z;
            n.path = null;
          }
        }
        // (needs: they won't come till the player has it — the fisher's bow; talking to them still does)
        // (nightOnly: they come only after dark — the fisher's cousin, for the rescue)
        const off = (b.needs && !hasItem(b.needs)) || (isNight() && !b.anyTime && !b.nightOnly) || (b.nightOnly && !isNight()) || T.law.stars > 0 || T.jail || ctx.isPlayerDead() || !canTake(n, b.anyTime || b.nightOnly);
        if (off) { if (n.questing && ['seek', 'wait'].includes(n.qmode?.kind)) release(n); return false; }
        if (!n.questing || !['seek', 'wait'].includes(n.qmode?.kind)) control(n, 'seek');
        // (the player indoors and they aren't: met at the door outside)
        const pRoom = T.rooms.roomAt(T.playerPos().x, T.playerPos().z);
        const sameRoom = !pRoom || pRoom === T.rooms.roomAt(n.x, n.z);
        n.qmode.meet = sameRoom ? null : P().rooms[pRoom]?.door ?? null;
        const d = T.distToPlayer(n);
        // (no walk from their place to the player — the wizard's mountain: they wait there)
        if (d < s.best - 0.3) { s.best = d; s.bestAt = T.simT; }
        else if (n.qmode.kind === 'seek' && T.simT - s.bestAt > SEEK_STUCK_S && d > 12) control(n, 'wait');
        const reach = Math.max(SEEK_STOP + 0.6, sameRoom && pRoom ? b.talkFrom ?? 0 : 0);
        return sameRoom && d < reach && !!n.body && calm();
      },
      talkTo: (c, n) => (n === c.s.n ? (c.next(), true) : false),
      entry: (c) => {
        const n = c.s.n;
        if (!n) return 'Look around town';
        const who = c.beat.who === 'cousin' ? `${firstName(n.name)}, the fisher's cousin` : `${firstName(n.name)} the ${n.def.label.toLowerCase()}`;
        if (c.beat.needs && !hasItem(c.beat.needs)) return fill(c.beat.needsText ?? `Get what ${who} asked for, then go and see ${who}`, c.q);
        if (c.beat.nightOnly && !isNight()) return fill(c.beat.dayText ?? `${who} will come and find you tonight`, c.q);
        if (n.inside && !n.questing) return `${who} is home — back in the morning`;
        if (isNight() && !c.beat.anyTime) return `${who} will come and find you in the morning`;
        if (n.qmode?.kind === 'wait') return `Go and see ${who}`;
        return n.questing && T.distToPlayer(n) > 6 ? `${who} is coming to find you` : `Talk to ${who}`;
      },
      marker: (c) => npcMark(c.s.n),
      icon: '❗',
    },
    // A talk (lines, the last ending in choices) — its `who` stands facing the player meanwhile
    talk: {
      start: (c) => {
        const { beat: b, s } = c;
        const n = actors.has(b.who) ? null : roleNpc(c.q, b.who);
        if (!actors.has(b.who) && !n) return false; // (try again in update)
        s.n = n;
        open(c);
        return false;
      },
      update: (c) => {
        const { beat: b, s } = c;
        if (!s.opened) { s.n = roleNpc(c.q, b.who); if (s.n || actors.has(b.who)) open(c); return false; }
        if (s.actions) return !c.runActions(s.actions);
        if (talker.isOpen()) return false;
        // (closed without a choice — walked off)
        const leave = b.onLeave ?? (b.choices?.some((x) => x.then?.includes('later')) ? 'later' : 'reopen');
        if (leave === 'next') return true;
        if (leave === 'later') { c.later(SNOOZE_S); return false; }
        if (s.n && T.distToPlayer(s.n) < (b.reach ?? 3) && calm()) open(c);
        return false;
      },
      end: (c) => { if (talker.isOpen() && c.s.opened && !c.s.actions) talker.close(); },
      npc: (c, n, dt) => {
        if (n !== c.s.n) return false;
        if (n.seat || n.qmode?.kind === 'knocked') return false;
        stand(n, T.playerPos().x, T.playerPos().z, dt);
        return true;
      },
      entry: (c) => (c.beat.text ? fill(c.beat.text, c.q) : c.s.n ? `Talk to ${firstName(c.s.n.name)}` : null),
    },
  };
};

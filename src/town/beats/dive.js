// Town's quest beats — Diving with a townsperson (the fisher after the golden fish, under water):
// a check the player has what the job needs (needItem — the bow), the wizard's potion (potion:
// air under water for both of them till it's off — T.questAir), out of the canoe and under
// (diveOut), following them down to a spot (diveLead), a fish speared there with the bow — or the
// golden one (diveFish), back up (surface), the pirates' ambush (pirateBombs: three bombs, the
// screen goes black, the player wakes lying in the canoe, the townsperson taken — townQuests.js
// capture), after the ship as it gets away (chaseShip) and a few lines in the feed (feed).
// The swimming townsperson: townDiver.js (the 'swim' qmode); the dive: townDive.js (its job fish —
// ctx.dive); the canoe: townCanoe.js; the ship: townPirates.js ('lurk' / 'flee').
// Part of townQuests.js' registry (beats/index.js): each beat type's hooks get the runner's
// context `c` (src/quest/questRunner.js); `W` is Town's quest world (townQuests.js).

const LEAD_WAIT = 7;          // m (across, and up / down) the player can fall behind before they wait
const SIDE_OUT = 1.6;         // m off the canoe's side they go in
const GIVE_ARROWS = 6;        // arrows handed over with the bow when it has none
const FISH_RESPAWN_S = 3;     // s a job's fish is missing (shook free) before another's put there
const BOMB_GAP_S = 0.9;       // s between the pirates' bombs
const BOMB_LOST_S = 5;        // s a bomb's given before it's taken to have gone off
const BLACK_S = 1.4;          // s under the black before waking
const LIE_S = 3.2;            // s lying in the canoe before getting up
const CHASE_S = 38;           // s after the ship before giving up (or once it's gone)

export const diveBeats = (W) => {
  const { T, ctx, THREE, roleNpc, control, fill, placeOf, firstName, dist2, glbCharacterConfig, sayNow, capture, hasItem } = W;
  const shout = (n, text, q) => sayNow(n, fill(text, q), true);
  const pirateSay = (text) => {
    const m = T.liveCrew()[0];
    const at = m?.e.group.position ?? T.shipPose?.();
    if (at) T.speech?.say(text, { key: 'Pirate captain', kind: 'gruff', at: { x: at.x, y: (at.y ?? 0) + 1.4, z: at.z }, priority: 'talk', interrupt: true, falloff: { ref: 6, rolloff: 1, max: 60 } });
    T.feedLine(`Pirate: ${text}`);
  };
  const playerCenter = () => {
    const p = T.playerPos();
    return { x: p.x, y: (p.y ?? 0) + 0.5, z: p.z };
  };
  const dist3 = (a, b) => Math.hypot(a.x - b.x, (a.y ?? 0) - (b.y ?? 0), a.z - b.z);
  // Into the water beside the canoe (its side away from the player's, else either)
  const intoWater = (n) => {
    const cp = T.canoePose?.();
    const at = cp ? { x: cp.x + Math.cos(cp.yaw) * SIDE_OUT, z: cp.z - Math.sin(cp.yaw) * SIDE_OUT, yaw: cp.yaw } : { x: n.x, z: n.z };
    if (T.canoeHasPassenger?.()) T.canoePassenger(null);
    control(n, 'swim');
    T.diverStart(n, at);
  };
  const swimmer = (c) => {
    const n = roleNpc(c.q, c.beat.who);
    if (n && !n.dive) intoWater(n);
    return n;
  };
  const fishIds = (c) => (c.beat.golden ? ['golden'] : Array.from({ length: c.beat.count ?? 2 }, (_, i) => `${c.beat.at}${i}`));

  return {
    // The player has it (a town item: 'gun' — the bow) → on; else to `ifMissing` (a label)
    needItem: {
      update: (c) => {
        const { beat: b } = c;
        if (!hasItem(b.item)) { c.runActions([`goto:${b.ifMissing}`]); return false; }
        // (a bow with no arrows: a few to go with it — under water none are used up)
        if (b.item === 'gun' && !(ctx.getItems()?.ammo > 0) && ctx.grantItem('ammo', GIVE_ARROWS)) {
          const n = roleNpc(c.q, b.who);
          T.feedLine(`${n ? firstName(n.name) : 'Someone'} gave you ${GIVE_ARROWS} arrows.`);
        }
        return true;
      },
    },
    // The wizard's potion: air under water for the player and the job's swimmers (on) — or gone
    potion: { start: (c) => { T.questAir = c.beat.on !== false; return true; } },
    // `who` climbs out of the canoe into the water; done once the player's out and under too
    diveOut: {
      start: (c) => {
        T.canoeStop?.();
        const n = roleNpc(c.q, c.beat.who);
        if (n) intoWater(n);
        c.s.n = n;
      },
      update: (c) => {
        const n = swimmer(c);
        c.s.n = n;
        // (the player in the water: they duck under beside the canoe, showing the way)
        if (n?.dive && !T.inCanoe() && !n.dive.to) {
          const at = T.diverAt(n);
          T.diverGo(n, { x: at.x, z: at.z, y: (ctx.getWaterY?.(at.x, at.z) ?? 0) - 1.3 }, { speed: 1 });
        }
        return !!ctx.isDiving?.();
      },
      entry: (c) => (T.inCanoe() ? 'Get out of the canoe — over the side' : `Dive under — hold Dive — beside ${c.s.n ? firstName(c.s.n.name) : 'the canoe'}`),
      highlight: () => (T.inCanoe() ? { act: 'canoeout' } : null),
      icon: '🤿',
    },
    // `who` swims down to a place under water; the player follows (they wait if left behind);
    // done once both are there
    diveLead: {
      update: (c) => {
        const { beat: b, s } = c;
        const n = swimmer(c);
        s.n = n;
        const to = placeOf(b.to);
        if (!n || !to) return true;
        const me = playerCenter();
        const at = T.diverAt(n);
        const behind = dist3(me, at) > LEAD_WAIT;
        T.diverGo(n, behind ? null : to, { speed: 1.8 });
        if (behind && T.simT - (s.calledAt ?? -1e9) > 12) { s.calledAt = T.simT; shout(n, 'This way, {name}!', c.q); }
        return T.diverThere(n) && dist2(me.x, me.z, to.x, to.z) < (b.r ?? 5) && !!ctx.isDiving?.();
      },
      entry: (c) => {
        const who = c.s.n ? firstName(c.s.n.name) : 'them';
        return ctx.isDiving?.() ? fill(c.beat.text ?? `Follow ${who} under water`, c.q) : `Dive under — hold Dive — and follow ${who}`;
      },
      marker: (c) => {
        const at = c.s.n ? T.diverAt(c.s.n) : null;
        return at ? { icon: '📍', x: at.x, z: at.z, h: 1.2 } : null;
      },
      icon: '🤿',
    },
    // A fish speared with the bow under water at `at` (job fish put there — townDive.js); golden:
    // the golden fish. `who` treads water by the spot meanwhile.
    diveFish: {
      start: (c) => {
        const to = placeOf(c.beat.at);
        c.s.to = to;
        c.s.missing = {};
        if (!to) return true; // (no spot for it: on without)
        fishIds(c).forEach((id, i) => {
          const a = (i / Math.max(1, fishIds(c).length)) * Math.PI * 2;
          ctx.dive?.spawnQuestFish({ id, x: to.x + Math.sin(a) * 1.2, y: to.y, z: to.z + Math.cos(a) * 1.2, len: c.beat.golden ? 0.95 : 0.7, golden: !!c.beat.golden });
        });
        return false;
      },
      update: (c) => {
        const { s } = c;
        const n = swimmer(c);
        if (n) T.diverGo(n, null);
        if (s.done) return true;
        // (one shaken free / cut off: another put there a moment later)
        if (!ctx.dive?.isHooked()) {
          for (const id of fishIds(c)) {
            if (ctx.dive?.hasQuestFish(id)) { s.missing[id] = 0; continue; }
            s.missing[id] = (s.missing[id] ?? 0) + (T.simT - (s.lastT ?? T.simT));
            if (s.missing[id] > FISH_RESPAWN_S && s.to) {
              s.missing[id] = 0;
              ctx.dive?.spawnQuestFish({ id, x: s.to.x, y: s.to.y, z: s.to.z, len: c.beat.golden ? 0.95 : 0.7, golden: !!c.beat.golden });
            }
          }
        }
        s.lastT = T.simT;
        return false;
      },
      event: (c, kind, data) => {
        if (kind !== 'diveFish') return false;
        if (c.beat.golden && !data?.golden) return false;
        c.s.done = true;
        return true;
      },
      end: () => ctx.dive?.clearQuestFish(),
      entry: (c) => {
        if (!ctx.isDiving?.()) return 'Dive back down — hold Dive';
        if (ctx.dive?.isHooked()) return 'Reel it in!';
        return fill(c.beat.text ?? 'Spear a fish with the bow — hold Bow to aim, let go to shoot', c.q);
      },
      marker: (c) => (c.s.to ? { icon: '📍', x: c.s.to.x, z: c.s.to.z, h: 1 } : null),
      highlight: () => (ctx.isDiving?.() && !ctx.dive?.isHooked() && ctx.heldWeapon?.() !== 'pistol' ? { gear: 'pistol' } : null),
      icon: '🏹',
    },
    // Back up: `who` swims up beside the canoe; done once the player's up out of the dive too
    surface: {
      start: (c) => { c.s.t = 0; },
      update: (c, dt) => {
        const n = swimmer(c);
        c.s.t += dt;
        if (n) {
          const cp = T.canoePose?.();
          const to = cp ? { x: cp.x - Math.cos(cp.yaw) * SIDE_OUT, z: cp.z + Math.sin(cp.yaw) * SIDE_OUT } : T.diverAt(n);
          T.diverGo(n, { x: to.x, z: to.z }, { speed: 2.2 });
        }
        const up = !ctx.isDiving?.();
        return up && (!n || !T.diverUnder(n) || c.s.t > 20);
      },
      entry: (c) => fill(c.beat.text ?? 'Swim back up to the surface', c.q),
      icon: '🤿',
    },
    // The pirates: the ship's there (moved while the player was under — `ship` 'lurk'), three
    // bombs on the player and `who`, black — the player wakes lying in the canoe, `who` taken
    // (townQuests.js capture), the ship off out to sea ('flee')
    pirateBombs: {
      start: (c) => {
        const { s, beat: b } = c;
        s.t = 0;
        s.phase = 'see';
        s.thrown = 0;
        s.blasts = 0;
        if (T.shipMode?.() !== 'lurk') T.shipSail?.('lurk');
        if (!T.crewCount?.()) T.spawnCrew?.({ bombers: b.count ?? 3, archers: 0 });
      },
      update: (c, dt) => {
        const { s, beat: b, q } = c;
        const n = roleNpc(q, b.who);
        s.t += dt;
        if (s.phase === 'see') {
          if (!s.said1 && s.t > 0.4) { s.said1 = true; if (n) shout(n, 'What\'s… that ship! Where did that come from?!', q); }
          if (!s.said2 && s.t > 2.6) { s.said2 = true; pirateSay('Thank ye kindly for fetchin\' our fish, landlubbers! Now — hand it over!'); }
          if (s.t > 4.6) { s.phase = 'throw'; s.t = BOMB_GAP_S; }
          return false;
        }
        if (s.phase === 'throw') {
          const count = b.count ?? 3;
          if (s.thrown < count && s.t >= BOMB_GAP_S) {
            s.t = 0;
            const crew = T.liveCrew?.() ?? [];
            const m = crew[s.thrown % Math.max(1, crew.length)];
            const k = s.thrown;
            s.thrown++;
            // (on the player, on `who`, then between them)
            const me = T.playerPos();
            const them = n?.dive ? T.diverAt(n) : me;
            const tgt = k % 3 === 0 ? me : k % 3 === 1 ? them : { x: (me.x + them.x) / 2, z: (me.z + them.z) / 2 };
            const at = new THREE.Vector3(tgt.x, ctx.getWaterY?.(tgt.x, tgt.z) ?? T.groundAt(tgt.x, tgt.z), tgt.z);
            let gone = false;
            const blast = (pos) => {
              if (gone) return;
              gone = true;
              s.blasts++;
              T.canoeRock?.(pos, 0.8);
              ctx.playSfx?.('splash', { x: pos.x, y: pos.y, z: pos.z });
            };
            setTimeout(() => { if (!gone && T.active) blast(at); }, BOMB_LOST_S * 1000);
            if (m) {
              m.e._glbCharacter?.playAction(glbCharacterConfig.throwClip);
              const from = m.e.group.position.clone();
              from.y += 1.4;
              if (ctx.throwBomb) ctx.throwBomb(from, at, blast);
              else blast(at);
            } else blast(at);
            if (k === 1 && n) shout(n, 'Look out!', q);
          }
          if (s.blasts >= count && s.t > 0.5) {
            s.phase = 'black';
            s.t = 0;
            T.fadeTo(true);
          }
          return false;
        }
        if (s.phase === 'black') {
          if (s.t < 0.8 || s.under) { if (s.under && s.t > 0.8 + BLACK_S) { s.phase = 'lie'; s.t = 0; T.fadeTo(false); } return false; }
          s.under = true;
          // (under the black: `who` taken, the potion's air gone, the player lying in the canoe,
          // the ship off out to sea)
          T.questAir = false;
          if (n) { capture(n); T.feedLine(`${firstName(n.name)} is gone.`); }
          ctx.endDive?.();
          T.canoeStop?.();
          T.canoeBoard?.();
          ctx.putWeaponsAway?.();
          ctx.lieDown?.(true);
          T.shipSail?.('flee');
          return false;
        }
        // Lying there a moment, then up
        if (s.phase === 'lie') {
          if (s.t < LIE_S) return false;
          ctx.lieDown?.(false);
          return true;
        }
        return true;
      },
      end: (c) => { if (c.s.phase === 'black' || c.s.phase === 'lie') { T.fadeTo(false); ctx.lieDown?.(false); } },
      entry: (c) => (c.s.phase === 'see' ? 'A ship!' : c.s.phase === 'throw' ? 'Look out!' : '…'),
      icon: '💣',
    },
    // After the ship as it gets away: arrows on the water to it (the oar out); done once it's gone
    // or `s` seconds are up
    chaseShip: {
      start: (c) => { c.s.t = 0; c.s.oarAt = 0; },
      update: (c, dt) => {
        const { s, beat: b } = c;
        s.t += dt;
        const ship = T.shipPose?.();
        const gone = T.shipMode?.() !== 'flee' || !ship;
        if (!gone) T.driveTo({ x: ship.x, z: ship.z, r: 3, water: true });
        if (T.inCanoe() && ctx.heldWeapon?.() !== 'canoe_oar' && T.simT > s.oarAt && !ctx.weaponBusy?.()) {
          s.oarAt = T.simT + 1.5;
          ctx.setCanoeWeapon?.('oar');
        }
        return gone || s.t > (b.s ?? CHASE_S);
      },
      end: () => T.driveTo(null),
      entry: (c) => fill(c.beat.text ?? 'After the pirate ship!', c.q),
      marker: () => { const p = T.shipPose?.(); return p && T.shipMode?.() === 'flee' ? { icon: '📍', x: p.x, z: p.z, h: 6 } : null; },
      icon: '🛶',
    },
    // A few lines in the feed (no one to say them), and a banner over the world
    feed: {
      start: (c) => {
        for (const t of c.beat.lines ?? []) T.feedLine(fill(t, c.q));
        if (c.beat.banner) ctx.showBanner?.(fill(c.beat.banner[0], c.q), fill(c.beat.banner[1] ?? '', c.q), 3500);
        return true;
      },
    },
  };
};

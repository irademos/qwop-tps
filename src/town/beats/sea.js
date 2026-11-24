// Town's quest beats — Out on the water in the canoe with a townsperson (the fisher's golden fish):
// they climb in with the player (canoeCrew), arrows on the water to a spot (paddle), a fish caught
// there — or the golden one hooked (fishHere), the pirate ship (ship: where it waits; pirates: in
// it comes, a bomb shakes the golden fish off, then the chase — the passenger paddling, the player
// knocking the crew's bombs back at them), paddled home (pilotHome) and ashore (canoeLand).
// The canoe: townCanoe.js (T.canoePassenger / canoePilot / canoeRock / canoeLand); the sea plan,
// the ship and its crew: townPirates.js; the golden fish: townFishing.js (T.questFish / loseFish).
// Part of townQuests.js' registry (beats/index.js): each beat type's hooks get the runner's
// context `c` (src/quest/questRunner.js); `W` is Town's quest world (townQuests.js).

const CREW_BOARD_DIST = 3.5;  // m from the canoe the passenger climbs in…
const CREW_BOARD_S = 25;      // …or after this long walking to it (no walk there: simply in it)
const SHOUT_EVERY_S = [7, 11]; // s between the passenger's shouts in the chase
const ROCK_SAY_S = 2.2;       // s after the blast before the chase begins
const PILOT_LEAD = 0.45;      // rad round the ring ahead of the canoe the passenger steers for
const PILOT_SPEED = 1.6;      // m/s round it (slow: the pirates' bombs / arrows reach the player)…
const HOME_SPEED = 2.8;       // …and home
const HOME_STUCK_S = 14;      // s getting no nearer home: put there
const BOMB_MISS = 3.2;        // m off the canoe the first bomb lands (on the ship's side)

export const seaBeats = (W) => {
  const { T, ctx, THREE, roleNpc, control, go, fill, placeOf, goalHighlight, firstName, pickOf, dist2, glbCharacterConfig, sayNow, sayLines, arrive } = W;
  // Something said out loud and in the feed (out on the water nothing else shows it)
  const shout = (n, text, q) => sayNow(n, fill(text, q), true);
  const pirateSay = (text) => {
    const m = T.liveCrew()[0];
    const at = m?.e.group.position;
    if (at) T.speech?.say(text, { key: 'Pirate captain', kind: 'gruff', at: { x: at.x, y: at.y + 1.4, z: at.z }, priority: 'talk', interrupt: true, falloff: { ref: 6, rolloff: 1, max: 60 } });
    T.feedLine(`Pirate: ${text}`);
  };
  const canoeDist = (to) => { const c = T.canoePose(); return c && to ? dist2(c.x, c.z, to.x, to.z) : Infinity; };
  const ringAhead = (dir) => () => {
    const p = T.seaPlan();
    const c = T.canoePose();
    if (!p || !c) return null;
    const th = Math.atan2(c.x - p.center.x, c.z - p.center.z) + dir * PILOT_LEAD;
    return { x: p.center.x + Math.sin(th) * p.R, z: p.center.z + Math.cos(th) * p.R };
  };
  const CHASE_SHOUTS = [
    'Swing at them, {name} — send them back!',
    'Here comes another!',
    'Mind your head!',
    'Keep that sword up!',
    'They\'re not having my canoe!',
    'Ha! Paddling\'s the easy part!',
  ];
  return {
    // `who` climbs into the canoe's bow, and the player gets in too (also: a second one in the stern)
    canoeCrew: {
      start: (c) => { c.s.t = 0; c.s.t2 = 0; },
      update: (c, dt) => {
        const { beat: b, s } = c;
        const n = roleNpc(c.q, b.who);
        const n2 = b.also ? roleNpc(c.q, b.also) : null;
        s.n = n;
        s.n2 = n2;
        if (!n || !T.canoeBuilt?.()) return false;
        c.q.failOnDown = true;
        const cp = T.canoePose();
        if (!cp) return false;
        const climbIn = (who, slot, key) => {
          if (!who || who.qmode?.kind === 'canoe') return true;
          s[key] += dt;
          if (who.qmode?.kind !== 'toCanoe') control(who, 'toCanoe');
          if (dist2(who.x, who.z, cp.x, cp.z) < CREW_BOARD_DIST || s[key] > CREW_BOARD_S) {
            T.canoePassenger(who, slot);
            control(who, 'canoe');
            ctx.playSfx?.('splash', { x: cp.x, y: T.groundY(who), z: cp.z });
          }
          return false;
        };
        const in1 = climbIn(n, 0, 't');
        const in2 = !n2 || (in1 && climbIn(n2, 1, 't2'));
        return in1 && in2 && T.inCanoe();
      },
      npc: (c, n, dt) => {
        if ((n !== c.s.n && n !== c.s.n2) || n.qmode?.kind !== 'toCanoe') return false;
        const cp = T.canoePose();
        if (!cp) return false;
        // (to the bank by it — the walkable ground nearest it; off the town's ground — another
        // island, a ship's deck — straight to it)
        const nav = T.layout.nav;
        const i = nav.indexAt(cp.x, cp.z) >= 0 ? nav.nearestWalkable(cp.x, cp.z) : -1;
        const to = i >= 0 && dist2(nav.cellX(i), nav.cellZ(i), cp.x, cp.z) < 15 ? { x: nav.cellX(i), z: nav.cellZ(i) } : cp;
        go(n, to.x, to.z, dt, dist2(n.x, n.z, to.x, to.z) > 10);
        return true;
      },
      entry: (c) => {
        const n = c.s.n;
        if (!n) return null;
        const away = [n, c.s.n2].filter((x) => x && x.qmode?.kind !== 'canoe');
        if (away.length) return `${away.map((x) => firstName(x.name)).join(' and ')} ${away.length > 1 ? 'are' : 'is'} heading down to the canoe`;
        return T.inCanoe() ? null : `Get in the canoe with ${[n, c.s.n2].filter(Boolean).map((x) => firstName(x.name)).join(' and ')}`;
      },
      marker: () => {
        const cp = T.canoePose();
        return cp && !T.inCanoe() && T.distToPlayer(cp) > 6 ? { icon: '📍', x: cp.x, z: cp.z, h: 1.2 } : null;
      },
      highlight: () => {
        const cp = T.canoePose();
        return cp && !T.inCanoe() && T.distToPlayer(cp) < 4 ? { act: 'canoein' } : null;
      },
      icon: '🛶',
    },
    // Said out loud, one line after another (no talk box, no buttons); on at once
    say: {
      start: (c) => {
        sayLines(roleNpc(c.q, c.beat.who), (c.beat.lines ?? []).map((t) => fill(t, c.q)));
        return true;
      },
    },
    // Glowing arrows on the water to a place (the oar out to paddle); done once the canoe's within
    // r of it — stop: stopped there, the oar put away and the rod out
    paddle: {
      start: (c) => { c.s.oarAt = 0; },
      update: (c) => {
        const to = placeOf(c.beat.to);
        if (!to) return true; // (no open water for it: on without)
        T.driveTo({ x: to.x, z: to.z, r: Math.min(3, c.beat.r * 0.5), water: true });
        // (the rod from the last spot put away: the oar back out)
        if (T.inCanoe() && !T.fishing && ctx.heldWeapon?.() !== 'canoe_oar' && T.simT > c.s.oarAt) {
          c.s.oarAt = T.simT + 1.5;
          ctx.setCanoeWeapon?.('oar');
        }
        if (!(T.inCanoe() && canoeDist(to) < c.beat.r)) return false;
        // (there: the canoe held still till the next step's done — townQuests.js)
        arrive('canoe');
        if (c.beat.stop) {
          T.canoeStop?.();
          if (ctx.isRodAllowed?.()) ctx.setCanoeWeapon?.('rod');
        }
        return true;
      },
      end: () => T.driveTo(null),
      entry: (c) => fill(c.beat.text ?? 'Paddle there', c.q),
      highlight: () => {
        const cp = T.canoePose();
        return cp && !T.inCanoe() && T.distToPlayer(cp) < 4 ? { act: 'canoein' } : null;
      },
      marker: (c) => { const to = placeOf(c.beat.to); return to ? { icon: '📍', x: to.x, z: to.z, h: 1.4 } : null; },
      icon: '🛶',
    },
    // Fish here: a fish landed — or, golden, the golden fish hooked (it won't come in — townFishing.js)
    fishHere: {
      start: (c) => { T.questFish = { quick: true, golden: !!c.beat.golden }; },
      update: (c) => !!c.s.done,
      event: (c, kind, data) => {
        if (c.beat.golden ? kind === 'fishHooked' && data?.golden : kind === 'fish') { c.s.done = true; return true; }
        return false;
      },
      end: () => { T.questFish = null; },
      entry: (c) => (T.bagRoom() <= 0 && !T.fishing ? 'Your bag\'s full — eat or drop something to fish' : fill(c.beat.text ?? 'Catch a fish', c.q)),
      highlight: () => goalHighlight('fish'),
      icon: '🎣',
    },
    // The pirate ship: where it is (park: out on the horizon, waiting)
    ship: { start: (c) => { T.shipSail?.(c.beat.mode); return true; } },
    // In comes the ship, a bomb shakes the golden fish off the line, then the chase: `who` paddles
    // round the ring, the ship after them, its crew throwing — done once they're all down
    pirates: {
      start: (c) => {
        const { beat: b, s } = c;
        s.t = 0;
        s.dir = Math.random() < 0.5 ? 1 : -1;
        s.phase = 'arrive';
        if (T.shipMode?.() !== 'park') T.shipSail?.('park', { dir: s.dir });
        const ok = T.shipSail?.('approach', { dir: s.dir }) && T.spawnCrew({ bombers: b.bombers ?? 3, archers: ctx.hasGyro?.() ? b.archers ?? 0 : 0 }) > 0;
        // (archers only with a gyro sword: an arrow is sent back by a swing — without one there'd be
        // no beating them)
        if (!ok) { T.feedLine('The sea\'s quiet today.'); s.phase = 'none'; }
        s.total = T.crewCount();
      },
      update: (c, dt) => {
        const { beat: b, s, q } = c;
        const n = roleNpc(q, b.who);
        s.t += dt;
        if (s.phase === 'none') { T.loseFish('It got away.'); return true; }
        if (s.phase === 'arrive') {
          if (!s.said1 && s.t > 0.8) { s.said1 = true; shout(n, 'That\'s her! Golden as the sun — easy now, easy…', q); }
          if (!s.said2 && s.t > 3.5) { s.said2 = true; shout(n, 'Hang on… that ship. It\'s coming straight for us!', q); }
          if (T.shipArrived()) {
            s.phase = 'throw';
            s.t = 0;
            pirateSay('Ahoy, landlubbers! That golden fish belongs to us!');
          }
          return false;
        }
        if (s.phase === 'throw') {
          // (thrown, and lost somewhere: it goes off where it was aimed)
          if (s.thrown && s.t > 8 && !s.blasted) s.blast?.(s.at);
          if (s.t < 1.4 || s.thrown) return false;
          s.thrown = true;
          // (the first bomb — just short of the canoe, on the ship's side: it rocks the boat)
          const m = T.liveCrew()[0];
          const cp = T.canoePose();
          if (!m || !cp) { T.loseFish('It got away.'); s.phase = 'rocked'; s.t = 0; return false; }
          m.e._glbCharacter?.playAction(glbCharacterConfig.throwClip);
          const from = m.e.group.position.clone();
          from.y += 1.4;
          const dx = from.x - cp.x;
          const dz = from.z - cp.z;
          const d = Math.hypot(dx, dz) || 1;
          const at = new THREE.Vector3(cp.x + (dx / d) * BOMB_MISS, 0, cp.z + (dz / d) * BOMB_MISS);
          at.y = ctx.getWaterY?.(at.x, at.z) ?? T.groundAt(at.x, at.z);
          s.at = at;
          const blast = (pos) => {
            if (s.blasted) return;
            s.blasted = true;
            T.canoeRock(pos);
            ctx.playSfx?.('splash', { x: pos.x, y: pos.y, z: pos.z });
            T.loseFish('The golden fish slipped the hook!');
            s.phase = 'rocked';
            s.t = 0;
            shout(n, 'NO! My fish!', q);
          };
          s.blast = blast;
          if (ctx.throwBomb) ctx.throwBomb(from, at, blast);
          else blast(at);
          return false;
        }
        if (s.phase === 'rocked') {
          if (s.t < ROCK_SAY_S) return false;
          shout(n, 'Pirates! Get your sword out, {name} — swing at their bombs and arrows, send them back! I\'ll paddle!', q);
          // (no sword of their own: the fisher's old cutlass)
          if (!ctx.getItems()?.sword && ctx.grantItem('sword')) T.feedLine(`${n ? firstName(n.name) : 'The fisher'} tossed you an old cutlass.`);
          T.setCanoeArmed(true);
          T.canoePilot({ target: ringAhead(s.dir), speed: PILOT_SPEED });
          T.shipSail('chase', { dir: s.dir });
          T.crewLoose(true);
          s.phase = 'chase';
          s.t = 0;
          s.shoutAt = SHOUT_EVERY_S[0];
          return false;
        }
        // The chase: done once the crew's all down
        if (s.t > s.shoutAt) {
          s.shoutAt = s.t + SHOUT_EVERY_S[0] + Math.random() * (SHOUT_EVERY_S[1] - SHOUT_EVERY_S[0]);
          shout(n, pickOf(CHASE_SHOUTS), q);
        }
        if (T.liveCrew().length > 0) return false;
        shout(n, 'Ha! That\'s the last of them! Off you go, you scallywags!', q);
        T.shipSail('leave');
        T.setCanoeArmed(false);
        T.canoePilot(null);
        return true;
      },
      end: () => { T.questFish = null; },
      entry: (c) => {
        const { s } = c;
        if (s.phase === 'arrive') return 'Reel in the golden fish!';
        if (s.phase === 'throw' || s.phase === 'rocked') return 'Hold on!';
        if (s.phase === 'chase') return `Swing at the pirates' bombs and arrows — send them back (${s.total - T.liveCrew().length} / ${s.total})`;
        return null;
      },
      highlight: (c) => (c.s.phase === 'chase' && ctx.heldWeapon?.() !== 'foamSword' ? { gear: 'foamSword', phone: 'sword' } : null),
      icon: '⚔️',
    },
    // `who` paddles the canoe home to its mooring (through sea1 on the way, the way it came)
    pilotHome: {
      start: (c) => {
        const { s } = c;
        s.best = Infinity;
        s.bestAt = T.simT;
        s.via = placeOf('sea1');
        const home = () => T.canoePose()?.home ?? null;
        s.home = home;
        T.canoePilot({
          target: () => {
            if (s.via && canoeDist(s.via) < 6) s.via = null;
            // (well past it — nearer home than it is: straight on)
            if (s.via && home() && canoeDist(home()) < dist2(s.via.x, s.via.z, home().x, home().z)) s.via = null;
            return s.via ?? home();
          },
          speed: HOME_SPEED,
        });
      },
      update: (c) => {
        const { s } = c;
        const home = s.home();
        if (!home) return true;
        const d = canoeDist(home);
        if (d < s.best - 0.5) { s.best = d; s.bestAt = T.simT; }
        // (stuck on something on the way: there it is)
        if (T.simT - s.bestAt > HOME_STUCK_S) return true;
        return d < 3.5 || !T.inCanoe();
      },
      end: () => T.canoePilot(null),
      entry: (c) => fill(c.beat.text ?? 'Back to shore', c.q),
      icon: '🛶',
    },
    // Ashore: the player stepped out onto the bank, `who` (and `also`) too, the canoe back at its
    // mooring — or, stay: left where it is (landed on another island)
    canoeLand: (() => {
      const land = (c) => {
        const { beat: b } = c;
        c.q.failOnDown = !!b.stay;
        if (!T.canoeLand(!b.stay) && b.stay) return false; // (no shore in reach: try again)
        T.canoePassenger(null);
        if (b.stay) T.canoeStop?.(); else T.moorCanoe();
        const p = T.playerPos();
        const nav = T.layout.nav;
        const fs = T.layout.places.fishSpot;
        // (beside the player where there's ground — the town's walkable grid, else dry ground
        // off it — else the nearest walkable, else the fishing spot)
        const dry = (x, z) => T.walkable(x, z) || (b.stay && (ctx.waterDepth?.(x, z) ?? 0) <= 0 && Number.isFinite(ctx.getGroundY?.(x, z)));
        const used = [];
        for (const who of [b.who, b.also].filter(Boolean)) {
          const n = roleNpc(c.q, who);
          if (!n) continue;
          let at = null;
          for (const [ox, oz] of [[1.2, 0], [-1.2, 0], [0, 1.2], [0, -1.2], [1, 1], [-1, -1], [1.8, -1], [-1.8, 1]]) {
            const x = p.x + ox;
            const z = p.z + oz;
            if (used.some((u) => dist2(u.x, u.z, x, z) < 0.8)) continue;
            if (dry(x, z)) { at = { x, z }; break; }
          }
          const i = at || nav.indexAt(p.x, p.z) < 0 ? -1 : nav.nearestWalkable(p.x, p.z);
          if (!at) at = i >= 0 && dist2(nav.cellX(i), nav.cellZ(i), p.x, p.z) < 6 ? { x: nav.cellX(i), z: nav.cellZ(i) } : b.stay ? { x: p.x, z: p.z } : fs;
          used.push(at);
          n.seat = null;
          n.x = at.x;
          n.z = at.z;
          n.path = null;
          control(n, b.stay ? 'follow' : 'stand');
        }
        return true;
      };
      // (no shore in reach yet — stay: tried again each frame)
      return { start: land, update: land, entry: (c) => (c.beat.stay ? 'Get out onto the beach' : null), icon: '🛶' };
    })(),
  };
};

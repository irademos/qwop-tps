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
const PILOT_SPEED = 2.4;      // m/s round it…
const HOME_SPEED = 2.8;       // …and home
const HOME_STUCK_S = 14;      // s getting no nearer home: put there
const BOMB_MISS = 3.2;        // m off the canoe the first bomb lands (on the ship's side)

export const seaBeats = (W) => {
  const { T, ctx, THREE, roleNpc, control, go, fill, placeOf, goalHighlight, firstName, pickOf, dist2, glbCharacterConfig } = W;
  // Something said out loud and in the feed (out on the water nothing else shows it)
  const shout = (n, text, q) => {
    const line = fill(text, q);
    if (n?.body) T.say(n, line, { big: true });
    T.feedLine(`${n ? firstName(n.name) : '?'}: ${line}`);
  };
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
    // `who` climbs into the canoe's bow, and the player gets in too
    canoeCrew: {
      start: (c) => { c.s.t = 0; },
      update: (c, dt) => {
        const { beat: b, s } = c;
        const n = roleNpc(c.q, b.who);
        s.n = n;
        if (!n || !T.canoeBuilt?.()) return false;
        c.q.failOnDown = true;
        if (n.qmode?.kind !== 'canoe') {
          s.t += dt;
          const cp = T.canoePose();
          if (!cp) return false;
          if (n.qmode?.kind !== 'toCanoe') control(n, 'toCanoe');
          if (dist2(n.x, n.z, cp.x, cp.z) < CREW_BOARD_DIST || s.t > CREW_BOARD_S) {
            T.canoePassenger(n);
            control(n, 'canoe');
            ctx.playSfx?.('splash', { x: cp.x, y: T.groundY(n), z: cp.z });
          }
          return false;
        }
        return T.inCanoe();
      },
      npc: (c, n, dt) => {
        if (n !== c.s.n || n.qmode?.kind !== 'toCanoe') return false;
        const cp = T.canoePose();
        if (!cp) return false;
        // (to the bank by it — the walkable ground nearest it)
        const nav = T.layout.nav;
        const i = nav.nearestWalkable(cp.x, cp.z);
        const to = i >= 0 ? { x: nav.cellX(i), z: nav.cellZ(i) } : cp;
        go(n, to.x, to.z, dt, dist2(n.x, n.z, to.x, to.z) > 10);
        return true;
      },
      entry: (c) => {
        const n = c.s.n;
        if (!n) return null;
        if (n.qmode?.kind !== 'canoe') return `${firstName(n.name)} is heading down to the canoe`;
        return T.inCanoe() ? null : `Get in the canoe with ${firstName(n.name)}`;
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
    // Glowing arrows on the water to a place; done once the canoe's within r of it
    paddle: {
      update: (c) => {
        const to = placeOf(c.beat.to);
        if (!to) return true; // (no open water for it: on without)
        T.driveTo({ x: to.x, z: to.z, r: Math.min(3, c.beat.r * 0.5), water: true });
        return T.inCanoe() && canoeDist(to) < c.beat.r;
      },
      end: () => T.driveTo(null),
      entry: (c) => fill(c.beat.text ?? 'Paddle there', c.q),
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
        const ok = T.shipSail?.('approach', { dir: s.dir }) && T.spawnCrew(b.count ?? 4) > 0;
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
          shout(n, 'Pirates! Get your sword out, {name} — knock their bombs back at them! I\'ll paddle!', q);
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
        if (s.phase === 'chase') return `Knock the pirates' bombs back at them (${s.total - T.liveCrew().length} / ${s.total})`;
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
    // Ashore: the player stepped out onto the bank, `who` too, the canoe back at its mooring
    canoeLand: {
      start: (c) => {
        const n = roleNpc(c.q, c.beat.who);
        c.q.failOnDown = false;
        T.canoeLand(true);
        T.canoePassenger(null);
        T.moorCanoe();
        if (n) {
          // (beside the player where there's walkable ground — else the nearest, else the fishing spot)
          const fs = T.layout.places.fishSpot;
          const p = T.playerPos();
          const nav = T.layout.nav;
          let at = null;
          for (const [ox, oz] of [[1.2, 0], [-1.2, 0], [0, 1.2], [0, -1.2], [1, 1], [-1, -1]]) {
            if (T.walkable(p.x + ox, p.z + oz)) { at = { x: p.x + ox, z: p.z + oz }; break; }
          }
          const i = at ? -1 : nav.nearestWalkable(p.x, p.z);
          if (!at) at = i >= 0 && dist2(nav.cellX(i), nav.cellZ(i), p.x, p.z) < 6 ? { x: nav.cellX(i), z: nav.cellZ(i) } : fs;
          n.x = at.x;
          n.z = at.z;
          n.path = null;
          control(n, 'stand');
        }
        return true;
      },
    },
  };
};

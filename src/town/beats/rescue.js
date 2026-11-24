// Town's quest beats — The fisher's rescue (after the pirates took him on the dive): the island
// the pirates are moored off loaded and looked over (islandPlan), something handed over if the
// player has none (giveItem — a lock-pick), on only after dark (night), the pirate ship moored off
// the island with the fisher in a cage on its deck and one pirate on watch (pirateMoor), creeping
// up and shooting the lookout — one arrow, or the crew wakes (sneak), climbing aboard (boardShip),
// picking the cage's lock (pickCage), more pirates coming over the rails (boarders), and at home:
// the prisoner theirs no more (freeCaptive), goods handed over (giveGoods), and a townsperson who'll
// fight beside the player in the night defense from now on (defender — townDefense.js).
// The island plan, the moored ship, its cage / lookout / deck spots: townPirates.js.
// Part of townQuests.js' registry (beats/index.js): each beat type's hooks get the runner's
// context `c` (src/quest/questRunner.js); `W` is Town's quest world (townQuests.js).

const ISLAND_LOAD_S = 90;     // s waiting for the island to load before giving up
const SPOT_DIST = 34;         // m from the ship the cousin points the lookout out
const ALERT_DIST = 6;         // m from its hull the lookout sees the player
const MISS_S = 2.6;           // s after an arrow the lookout's still up: a miss — the crew's awake
const SPAWN_GAP_S = 0.55;     // s between pirates jumping down / climbing over the rail
const CAGE_REACH = 2.4;       // m from the cage's middle: Pick the lock
const BOARD_REACH = 15;       // m from the ship's hull: Climb aboard (from the shore by it — up a rope over the side)
const PIRATE_HEARTS = 2;
const PIRATE_COINS = 2;
const PIRATE_URLS = ['frogManUrl', 'url', 'pumpkinUrl', 'antlerGuyUrl', 'treeCreatureUrl'];
const PIRATE_NAMES = ['Bilge', 'One-Eye Morg', 'Scurvy Pete', 'Barnacle', 'Salty Nan', 'Gullet', 'Hooky', 'Red Rennie', 'Squall', 'Tarbrush', 'Dead-Eye Dot', 'Rumbelly'];

export const rescueBeats = (W) => {
  const { T, ctx, roleNpc, control, fill, placeOf, foes, liveFoes, firstName, dist2, glbCharacterConfig, sayNow, sayLines, isNight, capture, free, flags, hasItem } = W;
  const shout = (n, text, q) => sayNow(n, fill(text, q), true);
  const pirateSay = (text, at) => {
    if (at) T.speech?.say(text, { key: 'Pirate', kind: 'gruff', at: { x: at.x, y: (at.y ?? 0) + 1.4, z: at.z }, priority: 'talk', interrupt: true, falloff: { ref: 6, rolloff: 1, max: 60 } });
    T.feedLine(`Pirate: ${text}`);
  };
  const lookoutOf = (c) => c.q.lookout ?? null;
  const lookoutUp = (c) => { const e = lookoutOf(c); return !!e && !e.isDead; };
  // Pirates who aren't townsfolk (stage swordsmen), fighting the player — the job's foes
  const spawnPirate = (x, z, i, toward) => {
    const p = toward ?? T.playerPos();
    const e = ctx.spawnFighter({
      x, z, yaw: Math.atan2(p.x - x, p.z - z), url: glbCharacterConfig[PIRATE_URLS[i % PIRATE_URLS.length]] ?? glbCharacterConfig.frogManUrl,
      hearts: PIRATE_HEARTS, swingChance: 0.32, name: PIRATE_NAMES[i % PIRATE_NAMES.length],
    });
    if (!e) return null;
    e._fightFoe = true;
    foes.list.push({ e, paid: false });
    return e;
  };
  // Their coins on the ground as they fall
  const payFoes = () => {
    for (const f of foes.list) {
      if (f.e.isDead && !f.paid) {
        f.paid = true;
        const at = f.e.group.position.clone();
        at.y += 0.3;
        ctx.dropCoins(at, PIRATE_COINS);
      }
    }
  };
  // One at a time from a list of spots (s.queue), a splash each
  const spawnQueued = (s, dt) => {
    if (!s.queue?.length) return;
    s.spawnT = (s.spawnT ?? 0) - dt;
    if (s.spawnT > 0) return;
    s.spawnT = SPAWN_GAP_S;
    const at = s.queue.shift();
    if (spawnPirate(at.x, at.z, s.spawned ?? 0)) s.spawned = (s.spawned ?? 0) + 1;
    ctx.playSfx?.('splash', { x: at.x, y: T.groundAt(at.x, at.z), z: at.z });
  };
  const fightEntry = (c, text) => {
    const total = c.s.total ?? 0;
    return `${fill(text, c.q)} (${Math.max(0, total - liveFoes().length - (c.s.queue?.length ?? 0))} / ${total})`;
  };

  return {
    // The island loaded (it streams in — ctx.ensureIsland) and its plan found: where to land, where
    // the ship moors; none → the job's off for now
    islandPlan: {
      start: (c) => {
        const { s, beat: b } = c;
        s.t = 0;
        Promise.resolve(ctx.ensureIsland?.(b.key)).then((isl) => { s.loaded = true; s.ok = !!isl; }).catch(() => { s.loaded = true; });
      },
      update: (c, dt) => {
        const { s, beat: b } = c;
        s.t += dt;
        if (!s.loaded) {
          if (s.t > ISLAND_LOAD_S) c.fail(fill(b.failText ?? 'The sea\'s too rough to cross tonight.', c.q));
          return false;
        }
        if (s.ok && T.islandPlan?.(b.key)) return true;
        c.fail(fill(b.failText ?? 'The sea\'s too rough to cross tonight.', c.q));
        return false;
      },
      entry: (c) => (c.s.loaded ? null : 'Getting ready…'),
    },
    // Handed over by `who` unless the player has one (item: 'lockpick')
    giveItem: {
      start: (c) => {
        const { beat: b, q } = c;
        const n = roleNpc(q, b.who);
        if (b.item === 'lockpick') {
          if (T.lockpicks > 0) return true;
          T.lockpicks = 1;
          T.renderGoods?.();
        } else if (hasItem(b.item) || !ctx.grantItem(b.item)) return true;
        const what = b.item === 'lockpick' ? 'a lock-pick' : `a ${b.item}`;
        T.feedLine(`${n ? firstName(n.name) : 'Someone'} gave you ${what}.`);
        if (b.say && n?.body) T.say(n, fill(b.say, q), { big: true });
        ctx.playSfx?.('buy');
        return true;
      },
    },
    // Only after dark: on at night, else to `ifDay` (a label)
    night: {
      start: (c) => {
        if (isNight()) return true;
        c.runActions([`goto:${c.beat.ifDay}`]);
        return false;
      },
    },
    // The pirate ship moored off the island (townPirates.js — the island plan's), `who` (the one
    // they took) in a cage on its deck, one pirate on watch at the rail with a lantern
    pirateMoor: {
      start: (c) => {
        const { beat: b, q } = c;
        if (!T.shipSail?.('moor', { key: b.key })) return true; // (no ship: on without it)
        const plan = T.islandPlan(b.key);
        const cage = T.shipCage();
        const n = roleNpc(q, b.who);
        if (n && cage) {
          if (!n.captive) capture(n);
          n.hidden = false;
          n.x = cage.at.x;
          n.z = cage.at.z;
          n.path = null;
          if (n.qmode) n.qmode.at = { x: cage.at.x, z: cage.at.z };
        }
        if (T.spawnCrew({ bombers: 0, archers: 1, toward: plan.shipShore }) > 0) {
          const e = T.liveCrew()[0].e;
          q.lookout = e;
          const at = e.group.position;
          const yaw = plan.ship.yaw;
          const lx = at.x + Math.cos(yaw) * 0.8;
          const lz = at.z - Math.sin(yaw) * 0.8;
          T.shipLantern({ x: lx, y: ctx.getGroundY(lx, lz), z: lz });
        }
        return true;
      },
    },
    // Creeping up on the ship along the shore, `who` beside the player: the lookout shot with one
    // arrow — nobody wakes. A miss (or the player seen, too near) and the crew's up: `count`
    // pirates jump down and come at them, the lookout shooting. Done once they're all down.
    sneak: {
      start: (c) => {
        const { s, q, beat: b } = c;
        s.phase = 'approach';
        s.shots = ctx.arrowsShot?.() ?? 0;
        s.shotAt = null;
        const n = roleNpc(q, b.who);
        s.n = n;
        if (n) control(n, 'follow');
        if (!lookoutOf(c)) { s.phase = 'clear'; return true; }
      },
      update: (c, dt) => {
        const { s, q, beat: b } = c;
        const n = s.n;
        const p = T.playerPos();
        const look = lookoutOf(c);
        const shipAt = placeOf('ship');
        // (arrows loosed since it began)
        const shots = ctx.arrowsShot?.() ?? 0;
        if (shots > s.shots) { s.shots = shots; s.shotAt = T.simT; }
        const alert = (why) => {
          s.phase = 'fight';
          T.crewLoose(true);
          const at = look?.group.position;
          pirateSay(why === 'seen' ? 'Who goes there?! INTRUDERS! All hands!' : 'Arrrgh — we\'re under attack! All hands! ALL HANDS!', at);
          if (n) { shout(n, why === 'seen' ? 'He\'s seen us! Here they come!' : 'Missed! Here they come — fight!', q); control(n, 'stand'); }
          // (down off the ship on the shore side, into the shallows, and after the player)
          const plan = T.islandPlan(b.key);
          const out = plan?.out ?? { x: 0, z: 1 };
          const mid = shipAt ?? p;
          let base = { ...mid };
          for (let d = 0; d < 30 && T.shipHullDist(base) < 1.2; d += 1) base = { x: mid.x - out.x * d, z: mid.z - out.z * d };
          const tx = out.z;
          const tz = -out.x;
          const count = b.count ?? 7;
          s.queue = Array.from({ length: count }, (_, i) => {
            const k = (i - (count - 1) / 2) * 1.6;
            return { x: base.x + tx * k - out.x * (i % 2), z: base.z + tz * k - out.z * (i % 2) };
          });
          s.total = count + (lookoutUp(c) ? 1 : 0);
          ctx.playSfx?.('unsheath');
          if (at) ctx.turnCameraTo?.(at.x, at.z);
        };
        if (s.phase === 'approach' || s.phase === 'shoot') {
          if (!lookoutUp(c)) {
            // (one arrow — or whatever it took, unheard): nobody's woken
            s.phase = 'clear';
            if (n) shout(n, 'Got him! Not a sound… Nobody else stirred. Quick — aboard!', q);
            return true;
          }
          if (T.shipHullDist(p) < ALERT_DIST) { alert('seen'); return false; }
          if (s.shotAt != null && T.simT - s.shotAt > MISS_S) { alert('miss'); return false; }
          if (s.phase === 'approach' && shipAt && dist2(p.x, p.z, shipAt.x, shipAt.z) < SPOT_DIST) {
            s.phase = 'shoot';
            if (n) {
              control(n, 'stand');
              sayLines(n, [
                fill('There she is. See him at the rail, with the lantern? Just the one awake.', q),
                fill('Take him with one arrow — hold the Bow to aim, let go to shoot. Miss, and the whole crew wakes up.', q),
              ]);
            }
          }
          return false;
        }
        // The fight: the pirates down off the ship, the lookout still shooting
        spawnQueued(s, dt);
        payFoes();
        return !s.queue?.length && !liveFoes().length && !lookoutUp(c);
      },
      npc: (c, n, dt) => {
        // (hanging back once the ship's in sight: crouched where they are, watching)
        if (n !== c.s.n || c.s.phase === 'approach') return false;
        n.moving = false;
        n.path = null;
        const at = placeOf('ship');
        if (at) T.faceToward(n, at.x, at.z, dt);
        return true;
      },
      entry: (c) => {
        const { s } = c;
        if (s.phase === 'approach') return 'Creep along the shore toward the pirate ship';
        if (s.phase === 'shoot') return 'Shoot the lookout — one arrow. Hold Bow to aim, let go to shoot';
        if (s.phase === 'fight') return fightEntry(c, 'Fight off the pirates');
        return null;
      },
      marker: (c) => {
        if (c.s.phase === 'approach') { const to = placeOf('shipShore'); return to ? { icon: '📍', x: to.x, z: to.z, h: 1.4 } : null; }
        return null;
      },
      highlight: (c) => (c.s.phase === 'shoot' && ctx.heldWeapon?.() !== 'pistol' ? { gear: 'pistol' } : null),
      icon: '🏹',
    },
    // Climbing aboard: Climb aboard by its hull (from the shore, the shallows or swimming); done
    // once the player's on its deck
    boardShip: {
      update: () => T.onShipDeck(T.playerPos()),
      acts: () => {
        const p = T.playerPos();
        if (T.onShipDeck(p) || T.shipHullDist(p) > BOARD_REACH || T.inCanoe?.()) return [];
        return [{
          key: 'climbaboard', label: 'Climb aboard', onClick: () => {
            const at = T.shipBoardSpot();
            if (!at) return;
            ctx.endDive?.();
            ctx.teleport(at.x, at.z, at.yaw);
            ctx.playSfx?.('wood', { x: at.x, y: at.y, z: at.z });
          },
        }];
      },
      entry: (c) => fill(c.beat.text ?? 'Climb aboard the pirate ship', c.q),
      marker: () => { const to = placeOf('ship'); return to ? { icon: '📍', x: to.x, z: to.z, h: 4 } : null; },
      highlight: () => ({ act: 'climbaboard' }),
      icon: '⛵',
    },
    // The cage's lock picked (the lockpick minigame — a pick used up only once it's done, good or
    // not; none left: `who` hands one through the bars), its door swings open and `who` steps out
    pickCage: {
      start: (c) => {
        const { s, q, beat: b } = c;
        s.n = roleNpc(q, b.who);
        if (!T.shipCage?.()) return true;
        if (s.n && !s.said) { s.said = true; shout(s.n, '{name}! You came! Quick — the lock!', q); }
      },
      update: (c) => {
        const { s, q } = c;
        const cage = T.shipCage();
        if (!cage) return true;
        const p = T.playerPos();
        if (T.lockpick.isOpen() && s.picking && dist2(p.x, p.z, cage.at.x, cage.at.z) > CAGE_REACH + 1.2) { T.lockpick.stop(); s.picking = false; T.questPick = false; }
        if (!s.open) return false;
        if (s.n && !s.out) {
          s.out = true;
          const door = T.shipCageDoor();
          s.n.hidden = false;
          control(s.n, 'stand');
          if (door) { s.n.x = door.x; s.n.z = door.z; }
          shout(s.n, 'Free! {name}, I owe you my life. And look — I grabbed her back off their table!', q);
        }
        return true;
      },
      acts: (c) => {
        const { s, q } = c;
        const cage = T.shipCage?.();
        const p = T.playerPos();
        if (!cage || s.open || T.lockpick.isOpen() || !T.onShipDeck(p) || dist2(p.x, p.z, cage.at.x, cage.at.z) > CAGE_REACH) return [];
        return [{
          key: 'cagepick', label: `Pick the lock (${Math.max(1, T.lockpicks)})`, onClick: () => {
            if (T.lockpicks <= 0) {
              T.lockpicks = 1;
              T.feedLine(`${s.n ? firstName(s.n.name) : 'Someone'} passes you a bent nail through the bars.`);
            }
            s.picking = true;
            T.questPick = true; // (keeps townMode's update from closing a lockpick that isn't the jail's / a door's)
            T.lockpick.start((success) => {
              s.picking = false;
              T.questPick = false;
              T.lockpicks = Math.max(0, T.lockpicks - 1);
              ctx.playSfx?.(success ? 'unlock' : 'locked');
              if (success) { s.open = true; T.openShipCage(); return; }
              if (s.n) shout(s.n, T.lockpicks > 0 ? 'Again — gently!' : 'It snapped! Here — try this bent nail.', q);
              if (T.lockpicks <= 0) T.lockpicks = 1;
            });
          },
        }];
      },
      end: (c) => { if (c.s.picking && T.lockpick.isOpen()) T.lockpick.stop(); T.questPick = false; },
      entry: (c) => (T.onShipDeck(T.playerPos()) ? `Pick the cage's lock — free ${c.s.n ? firstName(c.s.n.name) : 'them'}` : 'Climb back aboard the pirate ship'),
      marker: () => { const cg = T.shipCage?.(); return cg ? { icon: '📍', x: cg.at.x, z: cg.at.z, h: 2.4 } : null; },
      highlight: () => ({ act: 'cagepick' }),
      icon: '🔓',
    },
    // More pirates over the rails (both sides of the deck), at the player; done once they're all down
    boarders: {
      start: (c) => {
        const { s, beat: b } = c;
        const count = b.count ?? 7;
        s.queue = T.shipDeckSpots(count).map((w) => ({ x: w.x, z: w.z }));
        s.total = s.queue.length;
        s.t = 0;
        const sp = T.shipPose?.();
        pirateSay(b.shout ?? 'The prisoner\'s loose! Over the side, lads — get them!', sp);
        if (!s.total) return true;
      },
      update: (c, dt) => {
        const { s } = c;
        s.t += dt;
        if (s.t < 1.2) return false;
        spawnQueued(s, dt);
        payFoes();
        return !s.queue.length && !liveFoes().length;
      },
      // (the freed one stands by the cage meanwhile, out of the way)
      acts: (c) => {
        const p = T.playerPos();
        if (T.onShipDeck(p) || T.shipHullDist(p) > BOARD_REACH || T.inCanoe?.()) return [];
        return [{ key: 'climbaboard', label: 'Climb aboard', onClick: () => { const at = T.shipBoardSpot(); if (at) { ctx.endDive?.(); ctx.teleport(at.x, at.z, at.yaw); } } }];
      },
      entry: (c) => fightEntry(c, c.beat.text ?? 'Fight off the boarders'),
      icon: '⚔️',
    },
    // Theirs no more (townQuests.js free — kept in the job)
    freeCaptive: {
      start: (c) => {
        const n = roleNpc(c.q, c.beat.who);
        if (n?.captive) free(n.id, { keep: true });
        return true;
      },
    },
    // Goods handed over by `who`: in the bag, what doesn't fit in the chest at home
    giveGoods: {
      start: (c) => {
        const { beat: b, q } = c;
        const n = roleNpc(q, b.who);
        const count = b.count ?? 1;
        const got = T.gain(b.good, count);
        if (got < count && T.store?.goods) { T.store.goods[b.good] = (T.store.goods[b.good] ?? 0) + (count - got); T.feedLine('Your bag\'s full — it\'s waiting in the chest at home.'); }
        if (b.popup) T.popup?.({ icon: b.popup.icon, title: fill(b.popup.title, q), sub: fill(b.popup.sub ?? '', q) });
        T.feedLine(fill(b.text ?? `${n ? firstName(n.name) : 'Someone'} gave you something.`, q));
        T.save?.();
        return true;
      },
    },
    // `who` will fight beside the player in the night defense from now on (townDefense.js)
    defender: {
      start: (c) => {
        const n = roleNpc(c.q, c.beat.who);
        const f = flags();
        if (n && !(f.defenders ?? []).includes(n.id)) f.defenders = [...(f.defenders ?? []), n.id];
        return true;
      },
    },
  };
};

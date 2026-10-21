// Town: the townsfolk themselves — making them, who runs them in a shared town (take / release),
// paths and tasks, what to do next (decide), speech bubbles and their bodies (level of detail).

import { FOLLOW_LINES, ROLES, firstName } from './townPeople.js';
import { FOOD_IDS, GOOD_IDS } from './townEconomy.js';
import { createGLBCharacterInstance } from '../models/glbCharacterModel.js';
import { makeTextSprite } from '../village/villageMode.js';
import { raycastMapSegment } from '../environment/mapCollision.js';
import {
  BODY_DIST, BODY_RELEASE_DIST, BUBBLE_S, CAMERA_CLEAR_DIST, LABEL_DIST, MERCHANT_START_CASH,
  HOME_VISIT_CHANCE, MUG_CHANCE, SHOP_BROWSE_CHANCE, TOWN_MAX_BODIES, _v, _v2, angleLerp, dist2, heightScale, inHours, pickOf, rand,
} from './townConfig.js';

// T: the town's shared state + functions (createTownMode in townMode.js); ctx: the game
export function installTownFolk(T, ctx) {
  // ── Townsfolk ──
  const makeNpc = ({ id, name, role, url, home, money = role === 'merchant' ? MERCHANT_START_CASH : rand(4, 14), attitude = 0, carry = null, vendetta = false, following = false, mem = null }) => {
    const def = ROLES[role] ?? ROLES.townsfolk;
    const { homes } = T.layout.places;
    // (bandits live at the camp: home index -1)
    const homeIndex = def.outlaw ? -1
      : Number.isInteger(home) && home >= 0 && home < homes.length ? home : Math.floor(Math.random() * homes.length);
    const homeSpot = def.outlaw ? T.layout.places.camp : homes[homeIndex];
    return {
      id, name, role, url, def,
      homeIndex,
      home: homeSpot,
      work: null,
      x: homeSpot.x, z: homeSpot.z, yaw: Math.random() * Math.PI * 2,
      alive: true, dying: null, hp: def.hp, maxHp: def.hp,
      needs: { energy: rand(0.6, 1), hunger: rand(0, 0.6), social: rand(0, 0.7) },
      money, attitude,
      carry: { wood: 0, fish: 0, crops: 0, ...(carry ?? {}) }, // goods made, on the way to the market
      speedScale: (def.speed ?? 1) * rand(0.9, 1.12),
      task: null, path: null, pathI: 0, moving: false,
      inside: false, fear: 0, hostile: false, fighter: null, lastHurtAt: -1e9, lastHitAt: -1e9,
      body: null, bodyPending: false, wantsBody: false, bubble: null, nextAmbientAt: rand(5, 25),
      patrolI: Math.floor(Math.random() * 6), workT: 0, actionAt: 0, talkBonusAt: -1e9, friendNoted: false,
      // reactions: a vendetta against the player, following the player, wanted (as an outlaw) /
      // in the cell until (sim time), the next blow in a brawl, last stepped aside
      vendetta, following, outlawUntil: 0, jailedUntil: 0, nextBlowAt: 0, avoidAt: 0,
      loot: 0, lost: false,
      // what they remember the player did (townMemory.js) and what it holds their attitude at
      mem: Array.isArray(mem) ? mem : [], memBias: 0,
    };
  };
  // Work spots handed out per role (two woodcutters don't share a tree)
  const assignWork = () => {
    const { treeSpots, fields, shore } = T.layout.places;
    const used = { tree: 0, field: 0, shore: 0 };
    for (const n of T.npcs) {
      if (!n.alive) continue;
      const w = n.def.work;
      if (w === 'tree') n.work = treeSpots.length ? treeSpots[used.tree++ % treeSpots.length] : null;
      else if (w === 'field') n.work = fields.length ? fields[used.field++ % fields.length] : null;
      else if (w === 'shore') n.work = shore.length ? shore[used.shore++ % shore.length] : null;
      // (no tree / field / shore near town: they farm, or just get by)
      if ((w === 'tree' || w === 'shore') && !n.work && fields.length) n.work = fields[used.field++ % fields.length];
    }
  };
  const groundY = (n) => T.groundAt(n.x, n.z, 0);
  const playerPos = () => ctx.getPlayerPosition();
  const distToPlayer = (n) => { const p = playerPos(); return dist2(n.x, n.z, p.x, p.z); };

  // ── Who runs a townsperson (shared town) ──
  // The host runs everyone nobody's claimed; a player's game claims those it needs for its own
  // player (take) and gives them back when they go back to normal life (release, from decide)
  const mp = () => T.netMode === 'host' || T.netMode === 'client';
  const isHost = () => T.netMode !== 'client';
  const myId = () => T.net?.id() ?? null;
  const mine = (n) => (T.netMode === 'client' ? n.ctrl === myId() : !n.ctrl || n.ctrl === myId());
  const take = (n) => {
    if (!n?.alive) return false;
    if (mine(n)) return true;
    if (T.netMode !== 'client' || n.ctrl) return false;
    n.ctrl = myId();
    n.claimAt = T.simT;
    n.claimOk = false;
    n.pendingHit = null;
    n.task = null;
    n.path = null;
    T.net.send(T.net.hostId(), { w: 1, op: 'claim', id: n.id, st: T.dynOf(n) });
    return true;
  };
  const release = (n) => {
    if (T.netMode !== 'client' || n.ctrl !== myId()) return;
    n.ctrl = null;
    n.releasedAt = T.simT;
    n.task = null;
    n.path = null;
    n.net = { x: n.x, z: n.z, yaw: n.yaw };
    T.net.send(T.net.hostId(), { w: 1, op: 'rel', id: n.id, st: T.dynOf(n) });
  };
  // At their work (the merchant behind the counter): from the task, or the host's word
  const isWorking = (n) => (mine(n) ? n.task?.type === 'work' && n.task.phase === 'do' : !!n.netWorking);
  // A townsperson's money changes (gifts, debts, bribes): the host keeps the books
  const npcMoney = (n, delta) => {
    n.money += delta;
    if (T.netMode === 'client') T.net.send(T.net.hostId(), { w: 1, op: 'money', id: n.id, d: delta });
  };

  // Line of sight from a townsperson's eyes to the player
  const sees = (n) => {
    const p = playerPos();
    _v.set(n.x, groundY(n) + 0.8, n.z);
    _v2.set(p.x, p.y + 0.8, p.z);
    return !raycastMapSegment(_v, _v2);
  };

  // ── Paths / tasks ──
  // Through a house's door: walking up to it outside, then stepping in (a jump to its room,
  // under the map — townRooms.js) and on inside; and back out the same way
  const planPath = (n, x, z) => {
    const st = T.rooms;
    const P = T.layout.places;
    const from = st.roomAt(n.x, n.z);
    const to = st.roomAt(x, z);
    if (from && from === to) {
      n.path = st.roomPath(from, n.x, n.z, x, z);
      n.pathI = 0;
      return;
    }
    const path = [];
    let sx = n.x;
    let sz = n.z;
    if (from) {
      const inDoor = st.doorInside(from);
      path.push(...st.roomPath(from, n.x, n.z, inDoor.x, inDoor.z));
      const out = P.rooms[from].door;
      path.push({ x: out.x, z: out.z, jump: true });
      sx = out.x;
      sz = out.z;
    }
    const ex = to ? P.rooms[to].door : { x, z };
    const leg = T.layout.nav.findPath(sx, sz, ex.x, ex.z) ?? [];
    // The last few metres straight onto the spot (by a tree, the door…)
    const last = leg[leg.length - 1] ?? { x: sx, z: sz };
    if (dist2(last.x, last.z, ex.x, ex.z) > 0.05 && dist2(last.x, last.z, ex.x, ex.z) < 2.6) leg.push({ x: ex.x, z: ex.z });
    path.push(...leg);
    if (to) {
      const inDoor = st.doorInside(to);
      path.push({ x: inDoor.x, z: inDoor.z, jump: true });
      path.push(...st.roomPath(to, inDoor.x, inDoor.z, x, z));
    }
    n.path = path;
    n.pathI = 0;
  };
  const setTask = (n, task) => {
    n.task = { t: 0, phase: task.to ? 'go' : 'do', ...task };
    if (task.to) planPath(n, task.to.x, task.to.z);
    else n.path = null;
  };
  // Walk along the path; true once there
  const stepPath = (n, dt, speed) => {
    const p = n.path;
    if (!p || n.pathI >= p.length) { n.moving = false; return true; }
    let left = speed * dt;
    while (left > 0 && n.pathI < p.length) {
      const wp = p[n.pathI];
      if (wp.jump) { n.x = wp.x; n.z = wp.z; n.pathI += 1; continue; }
      const dx = wp.x - n.x;
      const dz = wp.z - n.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.05) { n.pathI += 1; continue; }
      const s = Math.min(d, left);
      n.x += (dx / d) * s;
      n.z += (dz / d) * s;
      left -= s;
      n.yaw = angleLerp(n.yaw, Math.atan2(dx, dz), 1 - Math.exp(-10 * dt));
      if (s >= d) n.pathI += 1;
    }
    n.moving = true;
    if (n.pathI >= p.length) { n.moving = false; return true; }
    return false;
  };
  // Ground a townsperson can stand on: the town's walkable grid, or a room's floor
  const walkable = (x, z) => T.layout.nav.isWalkable(x, z) || T.rooms.isFree(x, z);
  const faceToward = (n, x, z, dt) => {
    if (dist2(n.x, n.z, x, z) < 0.05) return;
    n.yaw = angleLerp(n.yaw, Math.atan2(x - n.x, z - n.z), 1 - Math.exp(-8 * dt));
  };

  const fireSlot = (n) => {
    const { fire } = T.layout.places;
    const a = (n.id * 2.399) % (Math.PI * 2); // golden-angle seats around the fire
    return { x: fire.x + Math.sin(a) * 1.7, z: fire.z + Math.cos(a) * 1.7 };
  };
  const randomNear = (x, z, r) => {
    const room = T.rooms.roomAt(x, z);
    if (room) return T.rooms.spotNear(room, x, z, r);
    for (let k = 0; k < 12; k++) {
      const a = Math.random() * Math.PI * 2;
      const d = Math.random() * r;
      const tx = x + Math.sin(a) * d;
      const tz = z + Math.cos(a) * d;
      if (T.layout.nav.isWalkable(tx, tz)) return { x: tx, z: tz };
    }
    return { x, z };
  };

  // What to do next: the role's work in its hours, food when hungry, the fire when lonely,
  // bed at night, otherwise a stroll (scores + a little noise)
  const decide = (n) => {
    if (!n.alive || !mine(n)) return;
    const h = T.hour();
    const def = n.def;
    const night = h >= 21.5 || h < 6;
    // In the cell / lost / following the player / a bandit: their own routines
    if (n.jailedUntil > T.simT) { setTask(n, { type: 'jailed', dur: Infinity }); return; }
    if (n.lost) { setTask(n, { type: 'lost', dur: Infinity }); return; }
    if (n.following) {
      if ((h >= 23 || h < 6) && !n.escort) {
        n.following = false;
        say(n, pickOf(FOLLOW_LINES.late));
        T.feedLine(`🌙 ${firstName(n.name)} went home for the night.`);
      } else {
        setTask(n, { type: 'follow', dur: Infinity });
        return;
      }
    }
    // (a claim's over: back to the host's town)
    if (T.netMode === 'client') { release(n); return; }
    if (def.outlaw) { T.decideBandit(n, h); return; }
    // A drifter out at night may go after someone's purse
    if (n.role === 'drifter' && (h >= 21 || h < 4) && Math.random() < MUG_CHANCE && T.startMugging(n)) return;
    const options = [];
    const working = def.hours && inHours(h, def.hours);
    if (def.law) {
      if (working) options.push(['work', 1]);
      else options.push(['sleep', 1]);
    } else {
      if (working && (def.work === 'market' || n.work)) options.push(['work', 0.8 + Math.random() * 0.2]);
      // Something to eat in their own basket: a bite where they stand
      const ownFood = FOOD_IDS.find((g) => n.carry[g] > 0);
      if (n.needs.hunger > 0.6 && ownFood) {
        n.carry[ownFood] -= 1;
        n.needs.hunger = 0;
        say(n, '*munch*');
      }
      const open = T.marketOpen();
      // Goods made: off to sell them
      if (open && GOOD_IDS.some((g) => n.carry[g] > 0)) options.push(['deliver', 1.1]);
      const food = T.market.cheapestFood();
      if (open && food && n.money >= T.market.price(food) && n.role !== 'merchant') options.push(['eat', n.needs.hunger ** 2 * 1.3]);
      const evening = h >= 17 && h < 23.5;
      options.push(['social', n.needs.social * 0.7 + (evening ? 0.35 : 0) + (def.nightOwl && night ? 0.6 : 0)]);
      const sleepy = def.nightOwl ? (h >= 3 && h < 11) : night;
      options.push(['sleep', sleepy ? 1.25 : n.needs.energy < 0.18 ? 0.9 : 0]);
      options.push(['wander', 0.22]);
      // (a look round the weapon shop)
      if (T.gearOpen() && !night && Math.random() < SHOP_BROWSE_CHANCE) options.push(['browse', 0.3]);
    }
    let bestType = 'wander';
    let bestScore = -Infinity;
    for (const [type, score] of options) {
      const s = score + Math.random() * 0.15;
      if (s > bestScore) { bestScore = s; bestType = type; }
    }
    startTask(n, bestType);
  };
  const startTask = (n, type) => {
    const P = T.layout.places;
    if (type === 'work') {
      const w = n.def.work;
      if (w === 'market') setTask(n, { type, to: P.merchantSpot, dur: rand(60, 120), face: P.customerSpot });
      else if (w === 'patrol') {
        n.patrolI = (n.patrolI + 1) % P.patrol.length;
        setTask(n, { type, to: P.patrol[n.patrolI], dur: rand(2, 6) });
      } else if (w === 'office') setTask(n, { type, to: P.officeSpot, dur: rand(25, 60), face: P.jail });
      else if (w === 'field') {
        const f = n.work;
        setTask(n, { type, to: randomNear(f.x, f.z, 1.6), dur: rand(18, 35), anim: 'farm', face: null });
      } else if (n.work) setTask(n, { type, to: n.work, dur: rand(45, 90), face: n.work.face, anim: w === 'tree' ? 'chop' : null });
      else setTask(n, { type: 'wander', to: randomNear(n.x, n.z, 14), dur: rand(2, 6) });
    } else if (type === 'deliver') {
      setTask(n, { type, to: randomNear(P.customerSpot.x, P.customerSpot.z, 1.2), dur: 3, face: P.merchantSpot });
    } else if (type === 'eat') {
      setTask(n, { type, to: randomNear(P.customerSpot.x, P.customerSpot.z, 1.2), dur: 4, face: P.merchantSpot });
    } else if (type === 'browse') {
      // (somewhere in the weapon shop, looking at the counters)
      const c = T.stalls.spot('gear', 'counter');
      const to = randomNear(c.x, c.z + 1.6, 1.8);
      setTask(n, { type, to, dur: rand(6, 14), face: { x: to.x + (to.x < c.x ? -3 : 3), z: to.z } });
    } else if (type === 'social') {
      const seat = fireSlot(n);
      setTask(n, { type, to: seat, dur: rand(25, 45), face: P.fire });
    } else if (type === 'sleep') {
      // (in their room, by the bed — else by the house)
      setTask(n, { type, to: n.home.room ? T.rooms.bedside(n.home.room) : n.home, dur: Infinity });
    } else if (n.home.room && !n.def.outlaw && !(T.hour() >= 21.5 || T.hour() < 6) && Math.random() < HOME_VISIT_CHANCE) {
      // (a while at home)
      setTask(n, { type: 'wander', to: T.rooms.somewhereIn(n.home.room), dur: rand(10, 25) });
    } else {
      const roadish = Math.random() < 0.7;
      // (the walkable area runs far out of town: a wanderer too far out heads back)
      const C = T.layout.places.center;
      const from = n.def.outlaw || dist2(n.x, n.z, C.x, C.z) < 40 ? n : n.home;
      let to = randomNear(from.x, from.z, 18);
      if (roadish) {
        const cells = T.layout.nav.cellsWhere((i) => T.layout.nav.kindAt(i) >= 1
          && dist2(T.layout.nav.cellX(i), T.layout.nav.cellZ(i), from.x, from.z) < 22);
        if (cells.length) { const i = pickOf(cells); to = { x: T.layout.nav.cellX(i), z: T.layout.nav.cellZ(i) }; }
      }
      setTask(n, { type: 'wander', to, dur: rand(2, 7) });
    }
  };

  // ── Speech bubbles ──
  const say = (n, text, { big = false } = {}) => {
    if (text) n.lastSaid = text;
    if (text && mp() && !T.netSaying && mine(n)) {
      const msg = { w: 1, op: 'say', id: n.id, t: text, b: big ? 1 : 0 };
      if (T.netMode === 'host') T.net.broadcast(msg);
      else T.net.send(T.net.hostId(), msg);
    }
    if (!n.body || !text) return;
    if (n.bubble) { n.body.container.remove(n.bubble.sprite); n.bubble.sprite.material.map?.dispose(); n.bubble.sprite.material.dispose(); }
    const sprite = makeTextSprite(text, { height: big ? 0.26 : 0.2, bg: 'rgba(255, 255, 255, 0.92)', color: '#1a1d29', border: 'rgba(14, 17, 27, 0.25)' });
    sprite.position.set(0, 1.55 * heightScale(n.url) + (big ? 0.1 : 0), 0);
    sprite.renderOrder = 7;
    n.body.container.add(sprite);
    n.bubble = { sprite, until: T.simT + BUBBLE_S + (big ? 1.4 : 0) };
  };
  const clearBubble = (n) => {
    if (!n.bubble) return;
    n.bubble.sprite.parent?.remove(n.bubble.sprite);
    n.bubble.sprite.material.map?.dispose();
    n.bubble.sprite.material.dispose();
    n.bubble = null;
  };

  // ── Bodies (level of detail) ──
  const attachBody = (n, inst) => {
    const label = makeTextSprite(`${n.def.emoji} ${n.name}`, { height: 0.17 });
    label.position.set(0, 1.25 * heightScale(n.url), 0);
    label.visible = false;
    inst.container.add(label);
    inst.container.visible = true;
    // (yaw first: a sleeper lies down — rotation.x — facing whichever way that left them)
    inst.container.rotation.order = 'YXZ';
    inst.character.revive();
    inst.character.setMoving(false);
    n.body = { ...inst, label };
    T.root.add(inst.container);
    syncBody(n, 0);
  };
  const acquireBody = (n) => {
    if (n.body || n.bodyPending) return;
    const free = T.pool.get(n.url)?.pop();
    if (free) { attachBody(n, free); return; }
    n.bodyPending = true;
    createGLBCharacterInstance({ targetHeight: 1.0, url: n.url, armIK: false }).then((inst) => {
      n.bodyPending = false;
      if (T.active && n.wantsBody && !n.body && (n.alive || n.dying) && drawable(n, T.rooms.roomAt(T.playerPos().x, T.playerPos().z))) attachBody(n, inst);
      else toPool(n.url, inst);
    }).catch((e) => { n.bodyPending = false; console.warn('[Town] character load failed:', e); });
  };
  const toPool = (url, inst) => {
    inst.container.parent?.remove(inst.container);
    const list = T.pool.get(url) ?? [];
    if (list.length >= 3) { inst.character.dispose(); return; }
    list.push(inst);
    T.pool.set(url, list);
  };
  const releaseBody = (n) => {
    if (!n.body) return;
    clearBubble(n);
    const { container, character, label } = n.body;
    container.remove(label);
    label.material.map?.dispose();
    label.material.dispose();
    n.body = null;
    toPool(n.url, { container, character });
  };
  // Asleep at home (a room of their own): lying on the bed, a place each
  const sleepPose = (n) => {
    if (!n.inside || n.task?.type !== 'sleep' || !n.home?.room || T.rooms.roomAt(n.x, n.z) !== n.home.room) return null;
    const k = T.npcs.filter((m) => m.inside && m.alive && m.homeIndex === n.homeIndex && m.task?.type === 'sleep' && m.id < n.id).length;
    return T.rooms.sleepPose(n.home.room, k);
  };
  const syncBody = (n, dt) => {
    const b = n.body;
    if (!b) return;
    const lying = sleepPose(n);
    if (lying) {
      b.container.position.set(lying.x, lying.y, lying.z);
      b.container.rotation.set(-Math.PI / 2, lying.yaw, 0);
    } else {
      b.container.position.set(n.x, groundY(n), n.z);
      b.container.rotation.set(0, n.yaw, 0);
    }
    if (!n.dying) b.character.setMoving(n.moving);
    b.character.animate(dt);
    b.character.stepFluff(dt);
    // (not right in front of the camera, where they'd fill the screen; at a market counter
    // nobody stands between the shop camera and the counter)
    const shop = T.stalls.view();
    const chest = _v.copy(b.container.position).setY(b.container.position.y + 0.6);
    const inFront = !!shop && shop.camera.distanceTo(chest) < shop.camera.distanceTo(shop.stall) - 0.3;
    const nearCamera = inFront || ctx.camera.position.distanceTo(b.container.position) < CAMERA_CLEAR_DIST;
    b.container.visible = !inFront;
    b.label.visible = !n.dying && !nearCamera && distToPlayer(n) < LABEL_DIST;
    if (n.bubble && T.simT > n.bubble.until) clearBubble(n);
    if (n.bubble) n.bubble.sprite.visible = !nearCamera;
  };
  // Drawn at all: out and about where the player is — in town, or in the same room (where
  // those at home are seen too: asleep on the bed, hiding)
  const drawable = (n, room) => !n.fighter && T.rooms.roomAt(n.x, n.z) === room && (!n.inside || !!room);
  const updateLod = () => {
    const p = playerPos();
    const room = T.rooms.roomAt(p.x, p.z);
    const list = T.npcs.filter((n) => (n.alive || n.dying) && drawable(n, room))
      .map((n) => ({ n, d: dist2(n.x, n.z, p.x, p.z) }))
      .sort((a, b) => a.d - b.d);
    list.forEach(({ n, d }, i) => {
      n.wantsBody = i < TOWN_MAX_BODIES && d < (n.body ? BODY_RELEASE_DIST : BODY_DIST);
      if (n.wantsBody) acquireBody(n);
      else releaseBody(n);
    });
    for (const n of T.npcs) {
      if (n.body && !drawable(n, room)) { n.wantsBody = false; releaseBody(n); }
    }
  };

  Object.assign(T, {
    assignWork, clearBubble, decide, distToPlayer, faceToward, groundY, isHost, isWorking,
    makeNpc, mine, mp, myId, npcMoney, planPath, playerPos, randomNear, releaseBody, say, sees,
    setTask, startTask, stepPath, syncBody, take, updateLod, walkable,
  });
}

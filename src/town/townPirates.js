// Town: out on the water for the fisher's jobs — where they go, and the pirate ship.
//
// The sea plan (T.seaPlan(), found once from the map): a ring of open water out past the fishing
// spot — `center`, radius `R`, deep enough all the way round for the canoe, and a wider ring
// (R + SHIP_OUT) deep enough for the ship —, `sea1` (a first fishing spot, part way out), `sea2`
// (the far side of the ring, where the golden fish is), `park` (out past it on the open sea: where
// the ship waits, in sight on the horizon). Places for the beats: 'sea1' / 'sea2' (townQuests.js
// placeOf).
//
// The ship is the map's pirate ship (ctx.getShip() — the floating prop with a deck, anchored off
// the north-east shore; Showdown's voyages sail it too). A job moves it (T.shipSail(mode, …)):
//   'park'     — at `park`, broadside on, waiting
//   'approach' — in from `park` to the wide ring abreast of the canoe, turning broadside on
//   'chase'    — round the wide ring after the canoe (the fisher paddling it round the narrow
//                one), a little behind it — the crew on the near rail
//   'leave'    — off out to sea; put back at its anchor once it's well away from the player
//   'lurk'     — out of sight, it's there all at once: a little way off the canoe on the open-sea
//                side, broadside on (the fisher's dive — moved while the player's under water)
//   'flee'     — away out to sea, faster and faster — faster than the canoe can follow (the
//                fisher taken); back at its anchor once it's well away
//   'moor'     — anchored off another island's coast ({ key } — T.islandPlan(key)), broadside on
//                to the shore, close in (the fisher's rescue — beats/rescue.js)
//
// The island plan (T.islandPlan(key), once the island's loaded — ctx.ensureIsland): `landing`
// (a beach on its side facing the fishing spot, dry) and `landSea` (open water just off it,
// where the canoe stops), `ship` ({ x, z, yaw } — where it moors, a stretch along the coast)
// and `shipShore` (the dry shore beside it). On the ship moored there: a cage on its deck
// (T.shipCage — bars like the jail's, its door opened by T.openShipCage), a lookout on watch at
// the rail on the shore side (spawnCrew's `toward`), a lantern by him, and spots on the deck —
// T.shipBoardSpot (climbing aboard), T.shipDeckSpots (boarders over the rail), T.onShipDeck.
//
// The dive plan (T.divePlan(), for the fisher's dive — beats/dive.js): `dive` (where the canoe
// stops, over the seabed past the first fishing spot), `diveA` / `diveB` (spots under water on out
// from it — { x, y, z }: the first fish, then the golden one, deeper). Places 'dive' / 'diveA' /
// 'diveB' (townQuests.js placeOf).
// and puts it back at its anchor afterwards (T.resetPirates — also on leaving Town / a job
// dropped). The crew (T.spawnCrew({ bombers, archers })): bomb throwers (ctx.spawnBomber —
// BombThrowerEnemy) and archers (ctx.spawnArcher — a bow-only fighter on ranged turns this module
// hands out), none of them townsfolk, stood along the rail and carried with the ship each frame;
// held till the job lets them loose (T.crewLoose()) — then one at a time, every CREW_THROW_GAP_S.
// A bomb homes in on the player through its flight (`homing` — it arrives at sword height just
// in front of them, wherever the canoe's got to) and a sword swing knocks it back from further off
// than usual (`deflectRadius`, `deflectSwing` — a blade just held there doesn't): back home it
// always kills its thrower, and nobody else (its blast hits no one but the player). An arrow
// parried back homes in on its archer the same way (`homeParried` — projectiles.js), so the
// moving ship can't take it out of the way. An arrow is parried back
// at its archer by a sword swing (the game's parry — bootstrapGameApp.js `_swordParry`). Only the player's own: in a
// shared town the others don't see the ship sail.

import * as THREE from 'three';
import { glbCharacterConfig } from '../models/glbCharacterModel.js';

const CANOE_RING_DEPTH = 1.0;   // m of water all round the canoe's ring…
const SHIP_RING_DEPTH = 2.0;    // …and the ship's (and SHIP_RING_SPREAD either side of it)
const SHIP_RING_SPREAD = 4;     // m
const SHIP_OUT = 9;             // m further out from the middle than the canoe's ring
const PARK_OUT = 32;            // m on out past the ship's ring: where it waits
const RING_SAMPLES = 32;
const SEA1_OUT = 24;            // m out from the fishing spot (at most): the first spot
const APPROACH_S = 7;           // s in from `park`
const CHASE_LAG = 0.2;          // rad round the ring behind the canoe (the crew in the camera's reach)
const CHASE_MAX_SPEED = 4.6;    // m/s round its ring
const LEAVE_SPEED = 4;          // m/s off out to sea
const LEAVE_GONE_DIST = 70;     // m from the player: back at anchor
const TURN_RATE = 0.7;          // rad/s it turns at most
const LURK_DIST = 24;           // m off the canoe it turns up (under water: out of sight in the murk)
const FLEE_SPEED = [3, 9];      // m/s it sets off at … ends up at (the canoe can't keep up)
const FLEE_ACCEL = 0.35;        // m/s²
const FLEE_GONE_DIST = 120;     // m from the player: back at anchor
const DIVE_MIN_DEPTH = 4.5;     // m of water where the canoe stops for the dive
const DIVE_A_OUT = 8;           // m on out from there: the first fish…
const DIVE_B_OUT = 11;          // …and on from that, the golden one
const DIVE_A_UNDER = 2.2;       // m under the surface the first fish swims
const DIVE_B_UNDER = 4;         // m (at most — kept 1.2 m over the bottom) the golden one
const CREW_URLS = ['frogManUrl', 'url', 'pumpkinUrl', 'antlerGuyUrl'];
const CREW_HEARTS = 1;
const CREW_BOMB_DAMAGE = 1;     // health segments a bomb takes off the player
const CREW_THROW_GAP_S = [3, 4]; // s between bombs once loose — one pirate at a time
const CREW_FIRST_THROW_S = 1.2;  // s before the first
const CREW_BOMB_REACH = 0.55;   // m in front of the player (toward the thrower) a bomb comes to…
const CREW_BOMB_HEIGHT = 1.05;  // …this high over their feet: where the sword is
const CREW_DEFLECT_R = 0.95;    // m from the sword's tip a bomb is knocked back (0.5 usually)
const ARCHER_TURN_MAX_S = 5;    // s an archer's turn lasts at most
const ARROW_SPEED = 9;          // m/s (an enemy's arrow — PEMBERTON_BULLET_SPEED)
const LAND_SEA_DEPTH = 1.2;     // m of water where the canoe stops off an island's beach…
const LAND_SEA_MAX = 14;        // …at most this far out from it
const BEACH_RISE = 1.6;         // m the beach may rise over the sea at the shore (no cliffs)…
const BEACH_RISE_IN = 3.2;      // …and a few metres in
const MOOR_OFFSETS = [0.45, -0.45, 0.55, -0.55, 0.35, -0.35, 0.7, -0.7, 0.9, -0.9]; // rad along the coast from the landing
const MOOR_GAP = [2.5, 24];     // m between the hull and the shore (closest that's deep enough)
const MOOR_DEPTH = 2.0;         // m of water all round the hull
const CAGE_SIZE = 1.25;         // m square
const CAGE_HEIGHT = 2.0;        // m
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// T: the town's shared state + functions (createTownMode in townMode.js); ctx: the game
export function installTownPirates(T, ctx) {
  // ── The sea plan ──
  let plan;   // undefined: not looked for yet; null: no open water for it
  const deep = (x, z, min) => (ctx.waterDepth?.(x, z) ?? 0) >= min;
  const ring = (c, r, a) => ({ x: c.x + Math.sin(a) * r, z: c.z + Math.cos(a) * r });
  const ringOk = (c, r, min) => {
    for (let i = 0; i < RING_SAMPLES; i++) {
      const p = ring(c, r, (i / RING_SAMPLES) * Math.PI * 2);
      if (!deep(p.x, p.z, min)) return false;
    }
    return true;
  };
  const lineOk = (a, b, min) => {
    const n = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 2);
    for (let i = 0; i <= n; i++) if (!deep(a.x + ((b.x - a.x) * i) / n, a.z + ((b.z - a.z) * i) / n, min)) return false;
    return true;
  };
  const buildPlan = () => {
    const fs = T.layout?.places.fishSpot;
    if (!fs) return null;
    const fl = Math.hypot(fs.face.x - fs.x, fs.face.z - fs.z) || 1;
    const face = Math.atan2((fs.face.x - fs.x) / fl, (fs.face.z - fs.z) / fl);
    for (const dist of [55, 68, 45, 82, 38, 95]) {
      for (const off of [0, 0.35, -0.35, 0.7, -0.7, 1.05, -1.05]) {
        const a = face + off;
        const center = ring(fs, dist, a);
        for (const R of [18, 22, 15]) {
          if (!ringOk(center, R, CANOE_RING_DEPTH)) continue;
          if (![-SHIP_RING_SPREAD, 0, SHIP_RING_SPREAD].every((k) => ringOk(center, R + SHIP_OUT + k, SHIP_RING_DEPTH))) continue;
          // (the golden fish's spot: the ring's far side, from the shore; the ship comes in from beyond it)
          const sea2 = ring(center, R, a);
          let park = null;
          for (const out of [PARK_OUT, PARK_OUT * 0.7, PARK_OUT * 0.45]) {
            const p = ring(center, R + SHIP_OUT + out, a);
            if (lineOk(ring(center, R + SHIP_OUT, a), p, SHIP_RING_DEPTH)) { park = p; break; }
          }
          if (!park) continue;
          // (the first: part way out, before the ring)
          let sea1 = null;
          for (let d = Math.min(SEA1_OUT, dist - R - 4); d >= 8; d -= 3) {
            const p = ring(fs, d, a);
            if (deep(p.x, p.z, CANOE_RING_DEPTH)) { sea1 = p; break; }
          }
          if (!sea1) continue;
          return { center, R, shipR: R + SHIP_OUT, a2: a, sea1, sea2, park };
        }
      }
    }
    return null;
  };
  const seaPlan = () => {
    if (plan === undefined && T.layout) plan = buildPlan();
    return plan ?? null;
  };
  const seaPlace = (name) => {
    const p = seaPlan();
    if (!p) return null;
    if (name === 'sea1') return p.sea1;
    if (name === 'sea2') return p.sea2;
    if (name === 'seaPark') return p.park;
    if (name === 'dive' || name === 'diveA' || name === 'diveB') return divePlan()?.[name] ?? null;
    return null;
  };
  // ── The dive plan ──
  let dplan;
  const depthAt = (x, z) => ctx.waterDepth?.(x, z) ?? 0;
  const under = (x, z, below) => {
    const level = ctx.getWaterY?.(x, z) ?? 0;
    const d = depthAt(x, z);
    const room = Number.isFinite(d) ? d - 1.2 : below;
    return level - Math.max(0.8, Math.min(below, room));
  };
  const buildDivePlan = () => {
    const p = seaPlan();
    const fs = T.layout?.places.fishSpot;
    if (!p || !fs) return null;
    // (out from the shore through the ring's middle: the first spot along it deep enough)
    const dx = p.center.x - fs.x;
    const dz = p.center.z - fs.z;
    const dl = Math.hypot(dx, dz) || 1;
    const ux = dx / dl;
    const uz = dz / dl;
    let dive = null;
    for (let d = 20; d <= dl + p.R; d += 2) {
      const x = fs.x + ux * d;
      const z = fs.z + uz * d;
      if (depthAt(x, z) >= DIVE_MIN_DEPTH && [[3, 0], [-3, 0], [0, 3], [0, -3]].every(([ox, oz]) => depthAt(x + ox, z + oz) >= DIVE_MIN_DEPTH - 1)) { dive = { x, z }; break; }
    }
    if (!dive) dive = { ...p.center };
    const ax = dive.x + ux * DIVE_A_OUT - uz * 2.5;
    const az = dive.z + uz * DIVE_A_OUT + ux * 2.5;
    const bx = ax + ux * DIVE_B_OUT + uz * 3.5;
    const bz = az + uz * DIVE_B_OUT - ux * 3.5;
    return {
      dive, out: { x: ux, z: uz },
      diveA: { x: ax, z: az, y: under(ax, az, DIVE_A_UNDER) },
      diveB: { x: bx, z: bz, y: under(bx, bz, DIVE_B_UNDER) },
    };
  };
  const divePlan = () => {
    if (dplan === undefined && T.layout) dplan = buildDivePlan();
    return dplan ?? null;
  };

  // ── The ship ──
  // sail: { mode, t, from: { x, z, yaw }, theta (chase: its angle round the ring), dir (±1: the
  // way round), …}
  let sail = null;
  let moved = false;       // off its anchor (put back by resetPirates)
  const _v = new THREE.Vector3();
  const ship = () => ctx.getShip?.() ?? null;
  // The holder's world pose ({ x, z, yaw } — its parent, the map, isn't turned)
  const shipPose = () => {
    const s = ship();
    if (!s) return null;
    s.holder.getWorldPosition(_v);
    return { x: _v.x, z: _v.z, yaw: s.holder.rotation.y };
  };
  const setShipPose = (x, z, yaw) => {
    const s = ship();
    if (!s) return;
    moved = true;
    s.holder.parent.worldToLocal(_v.set(x, 0, z));
    s.holder.position.x = _v.x;
    s.holder.position.z = _v.z;
    s.holder.rotation.y = yaw;
    s.holder.updateMatrixWorld(true);
    s.box.setFromObject(s.model).expandByScalar(0.5);
  };
  // A heading (unit xz) → the holder's yaw (its bow is local −X); the way it's heading at a yaw
  const yawFor = (hx, hz) => Math.atan2(hz, -hx);
  // Round the ring at θ, going the way `dir` (±1): the tangent's yaw
  const tangentYaw = (theta, dir) => yawFor(Math.cos(theta) * dir, -Math.sin(theta) * dir);
  const turnToward = (yaw, want, dt) => yaw + THREE.MathUtils.clamp(wrap(want - yaw), -TURN_RATE * dt, TURN_RATE * dt);
  const canoeTheta = () => {
    const p = seaPlan();
    const c = T.canoePose?.();
    return p && c ? Math.atan2(c.x - p.center.x, c.z - p.center.z) : 0;
  };

  // A job sets it sailing: 'park' | 'approach' | 'chase' | 'leave' (dir: the way round the ring)
  const shipSail = (mode, { dir = 1, key = null } = {}) => {
    if (mode === 'moor') {
      const ip = key ? islandPlan(key) : null;
      if (!ip || !ship()) return false;
      setShipPose(ip.ship.x, ip.ship.z, ip.ship.yaw);
      sail = { mode, t: 0, dir, to: { ...ip.ship }, arrived: true, key };
      return true;
    }
    const p = seaPlan();
    const pose = shipPose();
    if (!p || !pose) { sail = null; return false; }
    if (mode === 'park') {
      setShipPose(p.park.x, p.park.z, tangentYaw(p.a2, dir));
      sail = { mode, t: 0, dir };
      return true;
    }
    if (mode === 'lurk') {
      // (off the canoe on the open-sea side — away from the shore — broadside on to it)
      const c = T.canoePose?.() ?? divePlan()?.dive ?? p.center;
      const fs = T.layout.places.fishSpot;
      let ox = c.x - fs.x;
      let oz = c.z - fs.z;
      const ol = Math.hypot(ox, oz) || 1;
      ox /= ol;
      oz /= ol;
      let at = null;
      for (const turn of [0, 0.5, -0.5, 1, -1]) {
        const hx = ox * Math.cos(turn) + oz * Math.sin(turn);
        const hz = -ox * Math.sin(turn) + oz * Math.cos(turn);
        const q = { x: c.x + hx * LURK_DIST, z: c.z + hz * LURK_DIST, hx, hz };
        if (deep(q.x, q.z, SHIP_RING_DEPTH)) { at = q; break; }
      }
      if (!at) return false;
      setShipPose(at.x, at.z, yawFor(-at.hz, at.hx));
      sail = { mode, t: 0, dir, to: { x: at.x, z: at.z, yaw: yawFor(-at.hz, at.hx) }, arrived: true };
      return true;
    }
    const theta = Math.atan2(pose.x - p.center.x, pose.z - p.center.z);
    sail = { mode, t: 0, dir, from: pose, theta };
    if (mode === 'approach') {
      // (abreast of the canoe, out on the wide ring)
      const at = canoeTheta();
      sail.to = { ...ring(p.center, p.shipR, at), yaw: tangentYaw(at, dir) };
    }
    return true;
  };
  const updateShip = (dt) => {
    if (!sail) return;
    const p = seaPlan();
    const pose = shipPose();
    if (!p || !pose) return;
    sail.t += dt;
    if (sail.mode === 'approach') {
      const k = Math.min(1, sail.t / APPROACH_S);
      const e = 1 - (1 - k) * (1 - k) * (1 - k); // (eased: slowing as it comes up)
      const x = sail.from.x + (sail.to.x - sail.from.x) * e;
      const z = sail.from.z + (sail.to.z - sail.from.z) * e;
      // (bow toward where it's going, then turning broadside on)
      const head = yawFor(sail.to.x - sail.from.x, sail.to.z - sail.from.z);
      const want = k < 0.5 ? head : sail.to.yaw;
      setShipPose(x, z, turnToward(pose.yaw, want, dt * (k < 0.5 ? 1 : 2)));
      if (k >= 1) sail.arrived = true;
    } else if (sail.mode === 'chase') {
      // (round the wide ring, a little behind the canoe — never faster than it can sail)
      const want = canoeTheta() - sail.dir * CHASE_LAG;
      const step = (CHASE_MAX_SPEED / p.shipR) * dt;
      // (it starts from wherever it is: onto the ring first)
      const r = Math.hypot(pose.x - p.center.x, pose.z - p.center.z);
      const rr = r + THREE.MathUtils.clamp(p.shipR - r, -3 * dt, 3 * dt);
      sail.theta += THREE.MathUtils.clamp(wrap(want - sail.theta), -step, step);
      const at = ring(p.center, rr, sail.theta);
      setShipPose(at.x, at.z, turnToward(pose.yaw, tangentYaw(sail.theta, sail.dir), dt * 2));
    } else if (sail.mode === 'flee') {
      // (straight out to sea — away from the island's shore — faster and faster)
      const fs = T.layout.places.fishSpot;
      let ax = pose.x - fs.x;
      let az = pose.z - fs.z;
      const al = Math.hypot(ax, az) || 1;
      ax /= al;
      az /= al;
      sail.speed = Math.min(FLEE_SPEED[1], (sail.speed ?? FLEE_SPEED[0]) + FLEE_ACCEL * dt);
      const yaw = turnToward(pose.yaw, yawFor(ax, az), dt);
      const hx = -Math.cos(yaw);
      const hz = Math.sin(yaw);
      const nx = pose.x + hx * sail.speed * dt;
      const nz = pose.z + hz * sail.speed * dt;
      setShipPose(deep(nx, nz, SHIP_RING_DEPTH) ? nx : pose.x + ax * sail.speed * dt, deep(nx, nz, SHIP_RING_DEPTH) ? nz : pose.z + az * sail.speed * dt, yaw);
      if (T.distToPlayer(pose) > FLEE_GONE_DIST) { clearCrew(); resetShip(); sail = { mode: 'gone', t: 0 }; }
    } else if (sail.mode === 'leave') {
      // (on round and out, away from the player; back at anchor once well off)
      const away = { x: pose.x - p.center.x, z: pose.z - p.center.z };
      const l = Math.hypot(away.x, away.z) || 1;
      const head = { x: -Math.cos(pose.yaw), z: Math.sin(pose.yaw) };
      const hx = head.x + (away.x / l) * 0.8;
      const hz = head.z + (away.z / l) * 0.8;
      const hl = Math.hypot(hx, hz) || 1;
      const speed = Math.min(LEAVE_SPEED, 1 + sail.t);
      const nx = pose.x + (hx / hl) * speed * dt;
      const nz = pose.z + (hz / hl) * speed * dt;
      if (deep(nx, nz, SHIP_RING_DEPTH)) setShipPose(nx, nz, turnToward(pose.yaw, yawFor(hx / hl, hz / hl), dt));
      if (T.distToPlayer(pose) > LEAVE_GONE_DIST || sail.t > 60) { clearCrew(); resetShip(); }
    }
  };
  const resetShip = () => {
    sail = null;
    if (!moved) return;
    moved = false;
    const s = ship();
    if (!s) return;
    s.holder.position.copy(s.anchor.position);
    s.holder.rotation.y = s.anchor.yaw;
    s.holder.updateMatrixWorld(true);
    s.box.setFromObject(s.model).expandByScalar(0.5);
  };

  // ── The crew ──
  const crew = [];   // { e, lx, lz }
  const liveCrew = () => crew.filter((m) => !m.e.isDead);
  const crewWorld = (m) => ship()?.holder.localToWorld(_v.set(m.lx, 0, m.lz)) ?? null;
  // Along the rail on the side the canoe will be (sail.to for an approach, else where it is now):
  // the archers among the bomb throwers
  // (toward { x, z }: the rail on that side, and nobody's on watch for it otherwise — the
  // lookout of the moored ship)
  const spawnCrew = ({ bombers = 3, archers = 0, toward = null } = {}) => {
    const n = bombers + archers;
    // (the archers spread out along the rail among the bomb throwers)
    const kinds = Array(n).fill('bomber');
    for (let j = 0; j < archers; j++) kinds[Math.min(n - 1, Math.round(((j + 0.5) * n) / archers - 0.5))] = 'archer';
    clearCrew();
    const s = ship();
    const p = seaPlan();
    if (!s || (!p && !toward)) return 0;
    const yaw = sail?.to?.yaw ?? s.holder.rotation.y;
    const at = sail?.to ?? shipPose();
    const c = toward ?? T.canoePose?.() ?? p.sea2;
    // (holder-local +Z → world (sin yaw, cos yaw): the canoe's side)
    const side = Math.sign((c.x - at.x) * Math.sin(yaw) + (c.z - at.z) * Math.cos(yaw)) || 1;
    const { minX, maxX, halfWidth } = s.deck;
    for (let i = 0; i < n; i++) {
      const m = { lx: minX + 0.6 + ((maxX - minX - 1.2) * (i + 0.5)) / n, lz: side * (halfWidth - 0.22), e: null };
      const w = crewWorld(m);
      const key = CREW_URLS[i % CREW_URLS.length];
      m.kind = kinds[i];
      const y = ctx.getGroundY(w.x, w.z);
      if (m.kind === 'archer') {
        m.e = ctx.spawnArcher?.({ x: w.x, y, z: w.z, url: glbCharacterConfig.treeCreatureUrl, hearts: CREW_HEARTS, aimAt: () => arrowTarget(m.e) }) ?? null;
        // (an arrow parried back homes in on it — the ship's moving: projectiles.js `homeParried`)
        if (m.e) m.e.homeParried = true;
      } else {
        m.e = ctx.spawnBomber?.({ x: w.x, y, z: w.z, url: glbCharacterConfig[key] ?? glbCharacterConfig.frogManUrl, hearts: CREW_HEARTS, bombDamage: CREW_BOMB_DAMAGE }) ?? null;
        if (m.e) {
          m.e.throwsHeld = true;
          m.e.aimAt = () => bombTarget(m.e);
          m.e.homing = () => bombTarget(m.e);
          m.e.deflectRadius = CREW_DEFLECT_R;
          m.e.ignoreMapMs = 700; // (over the rail)
          m.e.deflectSwing = true;
          // (its blast hurts only itself — each pirate is the player's own to knock out)
          m.e._getBlastTargets = () => [];
        }
      }
      if (!m.e) continue;
      m.e._fightFoe = true;
      crew.push(m);
    }
    return crew.length;
  };
  // Where an arrow's aimed: where the player will be when it gets there (the canoe moving)
  const _arrowAt = new THREE.Vector3();
  const arrowTarget = (e) => {
    const p = T.playerPos();
    const c = T.canoePose?.();
    const from = e?.group?.position ?? p;
    const t = Math.hypot(p.x - from.x, p.z - from.z) / ARROW_SPEED;
    return _arrowAt.set(p.x + (c?.vx ?? 0) * t, p.y ?? 0, p.z + (c?.vz ?? 0) * t);
  };
  // Where a bomb's going (it homes in on it all the way — BombThrowerEnemy `homing`): just in
  // front of the player toward its thrower, at sword height
  const bombTarget = (e) => {
    const p = T.playerPos();
    const from = e.group.position;
    const dx = from.x - p.x;
    const dz = from.z - p.z;
    const d = Math.hypot(dx, dz) || 1;
    return new THREE.Vector3(p.x + (dx / d) * CREW_BOMB_REACH, (p.y ?? 0) + CREW_BOMB_HEIGHT, p.z + (dz / d) * CREW_BOMB_REACH);
  };
  // Let loose: throwing, one pirate at a time (`turn` — its cooldown let go, the rest held), the
  // next a few seconds after it throws
  let loose = null;   // { turn, nextAt (T.simT), lastThrow }
  const turnLog = []; // (dev: who had a turn when)
  // (an archer: its ranged turn — it draws, looses one arrow and hands it back — EnemyPlayer)
  const crewLoose = (on = true) => {
    for (const m of crew) {
      if (m.kind === 'archer') m.e.releaseRangedTurn?.();
      else m.e.throwsHeld = true;
    }
    loose = on ? { turn: null, nextAt: T.simT + CREW_FIRST_THROW_S, lastThrow: 0, since: 0 } : null;
  };
  const turnOver = (m) => {
    if (m.e.isDead) return true;
    if (m.kind === 'archer') return !m.e.rangedTurn || T.simT - loose.since > ARCHER_TURN_MAX_S;
    return m.e._lastThrowTime !== loose.lastThrow;
  };
  const updateLoose = () => {
    if (!loose) return;
    const t = loose.turn;
    // (its turn's over once it's thrown / shot — or gone)
    if (t && turnOver(t)) {
      if (t.kind === 'archer') t.e.releaseRangedTurn?.();
      else t.e.throwsHeld = true;
      loose.turn = null;
      loose.nextAt = T.simT + CREW_THROW_GAP_S[0] + Math.random() * (CREW_THROW_GAP_S[1] - CREW_THROW_GAP_S[0]);
    }
    if (loose.turn || T.simT < loose.nextAt) return;
    // (an archer only once it's ready to shoot — its bow's within range of the player)
    const ready = liveCrew().filter((m) => m.kind !== 'archer' || m.e.wantsRangedTurn);
    if (!ready.length) return;
    // (bombs and arrows by turns, where both are on hand)
    const other = ready.filter((m) => m.kind !== loose.lastKind);
    const live = other.length ? other : ready;
    const m = live[Math.floor(Math.random() * live.length)];
    loose.lastKind = m.kind;
    loose.since = T.simT;
    turnLog.push(`${T.simT.toFixed(1)} ${m.kind}`);
    if (turnLog.length > 40) turnLog.shift();
    if (m.kind === 'archer') {
      m.e.rangedTurn = performance.now();
    } else {
      m.e._lastThrowTime = -Infinity;
      loose.lastThrow = m.e._lastThrowTime;
      m.e.throwsHeld = false;
    }
    loose.turn = m;
  };
  // Carried with the ship: each frame, back on its deck where they stand
  const carryCrew = () => {
    if (!crew.length || !ship()) return;
    for (const m of crew) {
      if (m.e.isDead || !m.e.rigidBody) continue;
      const w = crewWorld(m);
      const gy = ctx.getGroundY(w.x, w.z);
      const y = Number.isFinite(gy) ? gy : w.y;
      m.e.rigidBody.setTranslation({ x: w.x, y: y + 0.9, z: w.z }, true);
      m.e.rigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
      m.e.group.position.set(w.x, y, w.z);
    }
  };
  const clearCrew = () => {
    for (const m of crew) if (m.e && !m.e.isDead) ctx.removeFighter(m.e);
    crew.length = 0;
    loose = null;
  };
  // What the camera's auto-aim turns toward (townMode.js threats): the crew, and their bombs coming
  const pirateThreats = () => {
    const out = liveCrew().map((m) => m.e.group.position);
    for (const b of window._enemyBombs ?? []) {
      if (!b.deflected && crew.some((m) => m.e === b.thrower)) out.push(b.mesh.position);
    }
    return out;
  };

  const updatePirates = (dt) => {
    updateShip(dt);
    updateCage(dt);
    carryCrew();
    updateLoose();
  };
  const resetPirates = () => {
    clearCrew();
    removeCage();
    removeLantern();
    resetShip();
  };

  // ── Another island's coast: where to land, where the ship moors ──
  const islandPlans = new Map();   // key → plan | null (none found)
  // The shore along a ray out from the island's middle at angle a: the first dry ground coming in
  const shoreAt = (C, R, a) => {
    const ox = Math.sin(a);
    const oz = Math.cos(a);
    for (let d = R + 70; d > 8; d -= 1.5) {
      const x = C.x + ox * d;
      const z = C.z + oz * d;
      if ((ctx.waterDepth?.(x, z) ?? 0) <= 0.05) return { x, z, out: { x: ox, z: oz }, d };
    }
    return null;
  };
  const seaLevelNear = (S) => ctx.getWaterY?.(S.x + S.out.x * 3, S.z + S.out.z * 3) ?? ctx.getWaterY?.(S.x + S.out.x * 8, S.z + S.out.z * 8) ?? 0;
  const inland = (S, m) => ({ x: S.x - S.out.x * m, z: S.z - S.out.z * m });
  // The ship's hull in its holder's frame at yaw 0 (bow −X): its middle's offset and half sizes, world m
  let hull = null;
  const measureHull = () => {
    const s = ship();
    if (!s) return null;
    if (hull) return hull;
    const yaw = s.holder.rotation.y;
    s.holder.rotation.y = 0;
    s.holder.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(s.model);
    s.holder.getWorldPosition(_v);
    hull = { ox: (b.min.x + b.max.x) / 2 - _v.x, oz: (b.min.z + b.max.z) / 2 - _v.z, hx: (b.max.x - b.min.x) / 2, hz: (b.max.z - b.min.z) / 2 };
    s.holder.rotation.y = yaw;
    s.holder.updateMatrixWorld(true);
    return hull;
  };
  // holder-local (at yaw) → world offsets: local +X → (cos yaw, −sin yaw), +Z → (sin yaw, cos yaw)
  const rot = (lx, lz, yaw) => ({ x: lx * Math.cos(yaw) + lz * Math.sin(yaw), z: -lx * Math.sin(yaw) + lz * Math.cos(yaw) });
  const buildIslandPlan = (key) => {
    const def = ctx.islandInfo?.(key);
    const fs = T.layout?.places.fishSpot;
    const h = measureHull();
    if (!def || !fs || !h) return null;
    const C = def.at;
    const R = def.radius;
    const a0 = Math.atan2(fs.x - C.x, fs.z - C.z);
    // The landing: a beach facing home, with open water just off it
    let land = null;
    for (const off of [0, 0.12, -0.12, 0.25, -0.25, 0.4, -0.4, 0.55, -0.55, 0.7, -0.7, 0.9, -0.9]) {
      const S = shoreAt(C, R, a0 + off);
      if (!S) continue;
      const sea = seaLevelNear(S);
      const g0 = ctx.getGroundY(S.x, S.z);
      const in3 = inland(S, 3);
      const g3 = ctx.getGroundY(in3.x, in3.z);
      if (!(g0 - sea < BEACH_RISE) || !(g3 - sea < BEACH_RISE_IN) || (ctx.waterDepth?.(in3.x, in3.z) ?? 0) > 0) continue;
      let landSea = null;
      for (let t = 3; t <= LAND_SEA_MAX; t += 1) {
        const x = S.x + S.out.x * t;
        const z = S.z + S.out.z * t;
        if (deep(x, z, LAND_SEA_DEPTH) && deep(x + S.out.x * 4, z + S.out.z * 4, LAND_SEA_DEPTH)) { landSea = { x, z }; break; }
      }
      if (!landSea) continue;
      land = { S, a: a0 + off, landSea, landing: inland(S, 1.5) };
      break;
    }
    if (!land) return null;
    // The ship: a stretch along the coast, broadside on, as close in as the water lets it
    for (const off of MOOR_OFFSETS) {
      const S = shoreAt(C, R, land.a + off);
      if (!S) continue;
      const t = { x: S.out.z, z: -S.out.x };                // along the shore
      const yaw = yawFor(t.x, t.z);
      for (let gap = MOOR_GAP[0]; gap <= MOOR_GAP[1]; gap += 1.5) {
        const mid = { x: S.x + S.out.x * (gap + h.hz), z: S.z + S.out.z * (gap + h.hz) };
        let ok = true;
        for (let i = -2; i <= 2 && ok; i++) {
          for (const j of [-1, 0, 1]) {
            const o = rot((i / 2) * (h.hx + 1), j * (h.hz + 1), yaw);
            if (!deep(mid.x + o.x, mid.z + o.z, MOOR_DEPTH)) { ok = false; break; }
          }
        }
        if (!ok) continue;
        const o = rot(h.ox, h.oz, yaw);
        // (the shore side in the holder's frame: +Z or −Z)
        const side = Math.sign(Math.sin(yaw) * -S.out.x + Math.cos(yaw) * -S.out.z) || 1;
        return {
          key, landing: land.landing, landSea: land.landSea,
          ship: { x: mid.x - o.x, z: mid.z - o.z, yaw }, shipMid: mid, shipShore: inland(S, 1.5), out: S.out, side,
        };
      }
    }
    return null;
  };
  const islandPlan = (key) => {
    if (!islandPlans.has(key)) {
      const p = buildIslandPlan(key);
      if (!p && !ctx.islandInfo?.(key)) return null; // (not there yet: look again later)
      islandPlans.set(key, p);
    }
    return islandPlans.get(key);
  };
  const islandPlace = (name) => {
    const ip = sail?.key ? islandPlans.get(sail.key) : [...islandPlans.values()].find(Boolean);
    if (!ip) return null;
    if (name === 'islandSea') return ip.landSea;
    if (name === 'islandLanding') return ip.landing;
    if (name === 'shipShore') return ip.shipShore;
    if (name === 'ship') return ip.shipMid;
    return null;
  };

  // ── On the moored ship: the deck, a cage, the lookout's lantern ──
  const deckLocal = (x, z) => {
    const s = ship();
    if (!s) return null;
    return s.holder.worldToLocal(_v.set(x, 0, z)).clone();
  };
  const deckWorld = (lx, lz) => {
    const s = ship();
    if (!s) return null;
    const w = s.holder.localToWorld(_v.set(lx, 0, lz));
    return { x: w.x, z: w.z, y: ctx.getGroundY(w.x, w.z) };
  };
  // The side of the deck facing the island's shore (holder-local z sign)
  const shoreSide = () => islandPlans.get(sail?.key)?.side ?? 1;
  // Standing on its deck (its rect, up over the water)
  const onShipDeck = (p) => {
    const s = ship();
    if (!s || !p) return false;
    const l = deckLocal(p.x, p.z);
    const { minX, maxX, halfWidth } = s.deck;
    if (l.x < minX - 0.4 || l.x > maxX + 0.4 || Math.abs(l.z) > halfWidth + 0.4) return false;
    const w = ctx.getWaterY?.(p.x, p.z);
    return (p.y ?? 0) > (w ?? -Infinity) + 0.8;
  };
  // The player's way aboard: on the deck by the shore-side rail, the middle of it
  const shipBoardSpot = () => {
    const s = ship();
    if (!s) return null;
    const { minX, maxX, halfWidth } = s.deck;
    const w = deckWorld((minX + maxX) / 2, shoreSide() * (halfWidth - 0.55));
    return w && { ...w, yaw: Math.atan2(-shoreSide() * Math.sin(s.holder.rotation.y), -shoreSide() * Math.cos(s.holder.rotation.y)) };
  };
  // How far the player is from its hull (m, across the water — 0: over it)
  const shipHullDist = (p) => {
    const s = ship();
    const h = measureHull();
    if (!s || !h || !p) return Infinity;
    const l = deckLocal(p.x, p.z);
    const sc = s.holder.getWorldScale(new THREE.Vector3()).x || 1;
    const dx = Math.max(0, Math.abs(l.x * sc - h.ox) - h.hx);
    const dz = Math.max(0, Math.abs(l.z * sc - h.oz) - h.hz);
    return Math.hypot(dx, dz);
  };
  // n spots along both rails (boarders coming over the side)
  const shipDeckSpots = (n) => {
    const s = ship();
    if (!s) return [];
    const { minX, maxX, halfWidth } = s.deck;
    const out = [];
    for (let i = 0; i < n; i++) {
      const side = i % 2 ? -1 : 1;
      const k = Math.floor(i / 2) / Math.max(1, Math.ceil(n / 2) - 1);
      const w = deckWorld(minX + 0.5 + (maxX - minX - 1) * k, side * (halfWidth - 0.35));
      if (w) out.push({ ...w, side });
    }
    return out;
  };
  // A cage of iron bars (like the jail's) on the deck, its door facing the deck's middle line
  let cage = null;   // { group, door, at: { x, y, z }, open }
  const removeCage = () => { if (cage) { cage.group.removeFromParent(); cage = null; T.refreshObstacles?.(); } };
  // The cage is solid (obstacles.js via T.refreshObstacles — townRuins.js): the player walks
  // round its bars, open or shut (the one inside is a townsperson: not stopped by it)
  const cageObstacles = () => (cage ? [{
    box: true, owner: 'shipCage', x: cage.at.x, z: cage.at.z, hx: CAGE_SIZE / 2, hz: CAGE_SIZE / 2, yaw: cage.yaw,
    y0: cage.at.y - 1, y1: cage.at.y + CAGE_HEIGHT,
  }] : []);
  const shipCage = () => {
    if (cage) return cage;
    const s = ship();
    if (!s) return null;
    const { minX, maxX, halfWidth } = s.deck;
    // (on the sea side, the flattest of a few spots along it — not on a hatch or a cabin roof)
    const lz = -shoreSide() * halfWidth * 0.45;
    let best = null;
    for (const k of [0.3, 0.5, 0.7, 0.2, 0.8]) {
      const lx = minX + (maxX - minX) * k;
      const c = deckWorld(lx, lz);
      if (!c || !Number.isFinite(c.y)) continue;
      const ys = [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([a, b]) => {
        const o = rot(a * CAGE_SIZE * 0.5, b * CAGE_SIZE * 0.5, s.holder.rotation.y);
        return ctx.getGroundY(c.x + o.x, c.z + o.z);
      });
      const spread = Math.max(...ys) - Math.min(...ys);
      const score = spread + Math.abs(c.y - (best?.y ?? c.y)) * 0.2;
      if (!best || score < best.score) best = { ...c, score };
    }
    if (!best) return null;
    const g = new THREE.Group();
    const iron = new THREE.MeshStandardMaterial({ color: 0x2f2f35, roughness: 0.6, metalness: 0.3 });
    const barGeo = new THREE.CylinderGeometry(0.025, 0.025, CAGE_HEIGHT, 6).translate(0, CAGE_HEIGHT / 2, 0);
    const railGeo = new THREE.BoxGeometry(1, 0.06, 0.06);
    const h = CAGE_SIZE / 2;
    const bars = (parent, x0, z0, x1, z1, n) => {
      for (let k = 0; k <= n; k++) {
        const bar = new THREE.Mesh(barGeo, iron);
        bar.position.set(x0 + (x1 - x0) * (k / n), 0, z0 + (z1 - z0) * (k / n));
        bar.castShadow = true;
        parent.add(bar);
      }
      for (const y of [0.06, CAGE_HEIGHT - 0.05]) {
        const rail = new THREE.Mesh(railGeo, iron);
        rail.scale.x = Math.hypot(x1 - x0, z1 - z0);
        rail.position.set((x0 + x1) / 2, y, (z0 + z1) / 2);
        rail.rotation.y = -Math.atan2(z1 - z0, x1 - x0);
        parent.add(rail);
      }
    };
    // (the door on the side toward the deck's middle — local +Z here is the holder's shore side)
    bars(g, -h, -h, h, -h, 8);
    bars(g, -h, -h, -h, h, 8);
    bars(g, h, -h, h, h, 8);
    const top = new THREE.Mesh(new THREE.BoxGeometry(CAGE_SIZE, 0.05, CAGE_SIZE), iron);
    top.position.y = CAGE_HEIGHT;
    g.add(top);
    const door = new THREE.Group();
    door.position.set(-h, 0, h);
    bars(door, 0, 0, CAGE_SIZE, 0, 8);
    g.add(door);
    const yaw = s.holder.rotation.y + (shoreSide() > 0 ? 0 : Math.PI);
    g.position.set(best.x, best.y, best.z);
    g.rotation.y = yaw;
    T.root.add(g);
    cage = { group: g, door, at: { x: best.x, y: best.y, z: best.z }, open: false, yaw };
    T.refreshObstacles?.();
    return cage;
  };
  const openShipCage = () => { if (cage) cage.open = true; };
  const updateCage = (dt) => {
    if (!cage) return;
    const want = cage.open ? -1.9 : 0;
    cage.door.rotation.y += THREE.MathUtils.clamp(want - cage.door.rotation.y, -2.5 * dt, 2.5 * dt);
  };
  // Just outside the cage's door (where the one let out steps to)
  const shipCageDoor = () => {
    if (!cage) return null;
    const o = rot(0, CAGE_SIZE * 0.5 + 0.7, cage.yaw);
    return { x: cage.at.x + o.x, z: cage.at.z + o.z };
  };
  // The lookout's lantern: a warm glow on the rail beside him (no light — none added at night
  // mid-game, that would recompile every material)
  let lantern = null;
  const removeLantern = () => { if (lantern) { lantern.removeFromParent(); lantern = null; } };
  const shipLantern = (at) => {
    removeLantern();
    if (!at) return;
    const g = new THREE.Group();
    const glass = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffd98a }));
    glass.position.y = 0.95;
    const halo = new THREE.Mesh(new THREE.SphereGeometry(0.45, 12, 10), new THREE.MeshBasicMaterial({ color: 0xffb648, transparent: true, opacity: 0.18, depthWrite: false, blending: THREE.AdditiveBlending }));
    halo.position.y = 0.95;
    g.add(glass, halo);
    g.position.set(at.x, at.y, at.z);
    T.root.add(g);
    lantern = g;
  };

  Object.assign(T, {
    seaPlan, seaPlace, divePlan, shipSail, shipArrived: () => !!sail?.arrived, shipPose, shipMode: () => sail?.mode ?? null,
    spawnCrew, crewLoose, liveCrew, crewCount: () => crew.length, pirateThreats, updatePirates, resetPirates,
    islandPlan, islandPlace, onShipDeck, shipBoardSpot, shipHullDist, shipDeckSpots, shipCage, cageObstacles, openShipCage, shipCageDoor, shipLantern,
    // (dev console: town.debug().T.pirateDebug())
    pirateDebug: () => ({ plan: seaPlan(), sail, moved, turns: turnLog.slice(-20), crew: crew.map((m) => ({ kind: m.kind, lx: m.lx, lz: m.lz, dead: m.e.isDead, want: !!m.e.wantsRangedTurn, turn: loose?.turn === m })) }),
  });
}

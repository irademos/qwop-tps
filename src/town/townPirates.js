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
// and puts it back at its anchor afterwards (T.resetPirates — also on leaving Town / a job
// dropped). The crew (T.spawnCrew(n)): bomb throwers who aren't townsfolk (ctx.spawnBomber —
// BombThrowerEnemy, stationary), stood along the rail and carried with the ship each frame;
// `throwsHeld` till the job lets them loose (T.crewLoose()) — then one at a time, a bomb every
// CREW_THROW_GAP_S, aimed where the canoe's going; a bomb the sword knocks back always kills its thrower. Only the player's own: in a
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
const CREW_URLS = ['frogManUrl', 'url', 'pumpkinUrl', 'antlerGuyUrl'];
const CREW_HEARTS = 1;
const CREW_BOMB_DAMAGE = 1;     // health segments a bomb takes off the player
const CREW_THROW_GAP_S = [3, 4]; // s between bombs once loose — one pirate at a time
const CREW_FIRST_THROW_S = 1.2;  // s before the first
const CREW_SCATTER = 1.2;       // m — where a bomb's aimed, off the canoe
const BOMB_SPEED = 6;           // m/s (BombThrowerEnemy's lob)
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
    return null;
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
  const shipSail = (mode, { dir = 1 } = {}) => {
    const p = seaPlan();
    const pose = shipPose();
    if (!p || !pose) { sail = null; return false; }
    if (mode === 'park') {
      setShipPose(p.park.x, p.park.z, tangentYaw(p.a2, dir));
      sail = { mode, t: 0, dir };
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
  // Along the rail on the side the canoe will be (sail.to for an approach, else where it is now)
  const spawnCrew = (n) => {
    clearCrew();
    const s = ship();
    const p = seaPlan();
    if (!s || !p) return 0;
    const yaw = sail?.to?.yaw ?? s.holder.rotation.y;
    const at = sail?.to ?? shipPose();
    const c = T.canoePose?.() ?? p.sea2;
    // (holder-local +Z → world (sin yaw, cos yaw): the canoe's side)
    const side = Math.sign((c.x - at.x) * Math.sin(yaw) + (c.z - at.z) * Math.cos(yaw)) || 1;
    const { minX, maxX, halfWidth } = s.deck;
    for (let i = 0; i < n; i++) {
      const m = { lx: minX + 0.6 + ((maxX - minX - 1.2) * (i + 0.5)) / n, lz: side * (halfWidth - 0.35), e: null };
      const w = crewWorld(m);
      const key = CREW_URLS[i % CREW_URLS.length];
      m.e = ctx.spawnBomber?.({ x: w.x, y: ctx.getGroundY(w.x, w.z), z: w.z, url: glbCharacterConfig[key] ?? glbCharacterConfig.frogManUrl, hearts: CREW_HEARTS, bombDamage: CREW_BOMB_DAMAGE }) ?? null;
      if (!m.e) continue;
      m.e.throwsHeld = true;
      m.e._questFoe = true;
      m.e.aimAt = () => aimAtCanoe(m.e);
      crew.push(m);
    }
    return crew.length;
  };
  // Where a bomb's aimed: where the player will be by the time it comes down (the canoe moving)
  const _aim = new THREE.Vector3();
  const aimAtCanoe = (e) => {
    const p = T.playerPos();
    const c = T.canoePose?.();
    const from = e.group.position;
    const t = Math.hypot(p.x - from.x, p.z - from.z) / BOMB_SPEED;
    const a = Math.random() * Math.PI * 2;
    const r = Math.random() * CREW_SCATTER;
    _aim.set(p.x + (c?.vx ?? 0) * t + Math.sin(a) * r, 0, p.z + (c?.vz ?? 0) * t + Math.cos(a) * r);
    _aim.y = ctx.getGroundY(_aim.x, _aim.z);
    if (!Number.isFinite(_aim.y)) _aim.y = p.y ?? 0;
    return _aim;
  };
  // Let loose: throwing, one pirate at a time (`turn` — its cooldown let go, the rest held), the
  // next a few seconds after it throws
  let loose = null;   // { turn, nextAt (T.simT), lastThrow }
  const crewLoose = (on = true) => {
    for (const m of crew) m.e.throwsHeld = true;
    loose = on ? { turn: null, nextAt: T.simT + CREW_FIRST_THROW_S, lastThrow: 0 } : null;
  };
  const updateLoose = () => {
    if (!loose) return;
    const t = loose.turn;
    // (its turn's over once it's thrown — or gone)
    if (t && (t.e.isDead || t.e._lastThrowTime !== loose.lastThrow)) {
      t.e.throwsHeld = true;
      loose.turn = null;
      loose.nextAt = T.simT + CREW_THROW_GAP_S[0] + Math.random() * (CREW_THROW_GAP_S[1] - CREW_THROW_GAP_S[0]);
    }
    if (loose.turn || T.simT < loose.nextAt) return;
    const live = liveCrew();
    if (!live.length) return;
    const m = live[Math.floor(Math.random() * live.length)];
    m.e._lastThrowTime = -Infinity;
    loose.lastThrow = m.e._lastThrowTime;
    m.e.throwsHeld = false;
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
    carryCrew();
    updateLoose();
  };
  const resetPirates = () => {
    clearCrew();
    resetShip();
  };

  Object.assign(T, {
    seaPlan, seaPlace, shipSail, shipArrived: () => !!sail?.arrived, shipPose, shipMode: () => sail?.mode ?? null,
    spawnCrew, crewLoose, liveCrew, crewCount: () => crew.length, pirateThreats, updatePirates, resetPirates,
    // (dev console: town.debug().T.pirateDebug())
    pirateDebug: () => ({ plan: seaPlan(), sail, moved, crew: crew.map((m) => ({ lx: m.lx, lz: m.lz, dead: m.e.isDead })) }),
  });
}

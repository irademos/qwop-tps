// The canoe on the water: its model, where it is, and how it moves — paddled by the steer (the
// phone's tilt, the joystick or WASD — bootstrapGameApp.js `_getSteer`), slowed by drag, kept off
// water shallower than CANOE_MIN_DEPTH. Shared by Town's canoe (townCanoe.js — moored by the
// fishing spot, got in and out of) and the guest's sea start (seaStart.js — out on the open sea).
//
// The steer's forward / back pushes it along (CANOE_STEER_ACCEL; back CANOE_PADDLE_BACK as hard),
// its left / right turns it (CANOE_STEER_TURN). The oar's strokes play by themselves to fit
// (bootstrapGameApp.js `_oarPose`), and the push / turn comes with them: CANOE_STROKE_SYNC of it
// through each stroke's pull, swelling and easing like the blade's sweep (oarStrokePush — the
// same in all), so the canoe surges with each stroke and glides between. It tilts with it too:
// heeled over toward the side being paddled through the pull (CANOE_HEEL_STROKE), leaning out
// of a turn (CANOE_HEEL_TURN), the bow lifting as it surges (CANOE_PITCH_PER_ACCEL). The hull slides along easily and
// hardly sideways (CANOE_DRAG / CANOE_SIDE_DRAG). Up against the shore or a dock it slides / turns
// along it, pushed off a little (bump), instead of stopping dead.
//
// The blade splashes (waterSplash.js): going in and coming out, and drops thrown back off it
// through the pull (CANOE_SPLASH_EVERY, more for a stronger stroke).
// (The gyro-held oar that came before, its blade's sweep through the water pushing: docs/archive/canoe-gyro-paddling.md)

import * as THREE from 'three';
import { createCanoe, CANOE_FLOOR_Y, CANOE_HALF_LENGTH, CANOE_HALF_WIDTH } from '../items/canoe.js';
import { oarStrokePull, oarStrokePush } from '../items/oar.js';
import { createWaterSplash } from '../items/waterSplash.js';
import {
  CANOE_BOB, CANOE_DRAG, CANOE_HEEL_STROKE, CANOE_HEEL_TURN, CANOE_MAX_SPEED, CANOE_MIN_DEPTH, CANOE_PADDLE_BACK,
  CANOE_PITCH_PER_ACCEL, CANOE_SETTLE_DRAG, CANOE_SIDE_DRAG, CANOE_SPLASH_EVERY, CANOE_STAND_Z, CANOE_STEER_ACCEL,
  CANOE_STEER_TURN, CANOE_STROKE_SYNC, CANOE_TILT_RATE, CANOE_TURN_DRAG,
} from './townConfig.js';

// Where the hull's water depth is checked (canoe-local m: across, along)
const HULL_PROBES = [[0, 0], [0, CANOE_HALF_LENGTH - 0.3], [0, -(CANOE_HALF_LENGTH - 0.3)], [CANOE_HALF_WIDTH, 0], [-CANOE_HALF_WIDTH, 0]];

// waterY(x, z): the water's surface there; waterDepth(x, z): m of water over the ground (0: dry)
export function createCanoeBoat({ waterY, waterDepth, x = 0, z = 0, yaw = 0 }) {
  const boat = {
    group: createCanoe(),
    x, z, yaw,
    vx: 0, vz: 0, w: 0, // m/s, rad/s
    blade: null,        // the oar blade's last world position + time
    bladeIn: false,     // its blade in the water (for the splash going in / coming out)
    splashAt: 0,        // s (real clock): the next drops off a stroke
    roll: 0, pitch: 0,  // rad: its tilt (+ roll = the left side up — heeled to the right, + pitch = bow down)
    heelTo: 0, accel: 0, // this frame's paddling: the heel it wants, its push along it (m/s²)
  };
  // (world space: put beside the canoe in whatever holds it, the first time it moves)
  const splash = createWaterSplash();
  // Canoe-local (across +X — the player's left facing the bow —, along +Z) ↔ world
  const toWorld = (c, lx, lz, a = c.yaw) => ({
    x: c.x + lx * Math.cos(a) + lz * Math.sin(a),
    z: c.z - lx * Math.sin(a) + lz * Math.cos(a),
  });
  const toLocal = (wx, wz) => {
    const dx = wx - boat.x;
    const dz = wz - boat.z;
    return { x: dx * Math.cos(boat.yaw) - dz * Math.sin(boat.yaw), z: dx * Math.sin(boat.yaw) + dz * Math.cos(boat.yaw) };
  };
  // Deep enough under all of it there
  const fits = (fx, fz, fyaw) => HULL_PROBES.every(([lx, lz]) => {
    const p = toWorld({ x: fx, z: fz }, lx, lz, fyaw);
    return waterDepth(p.x, p.z) >= CANOE_MIN_DEPTH;
  });
  const floorY = () => boat.group.position.y + CANOE_FLOOR_Y;
  // Where the player stands in it
  const standPoint = () => toWorld(boat, 0, CANOE_STAND_Z);
  // Its floor's height at (x, z) inside the hull, else undefined
  const floorAt = (fx, fz) => {
    const l = toLocal(fx, fz);
    return Math.abs(l.x) < CANOE_HALF_WIDTH && Math.abs(l.z) < CANOE_HALF_LENGTH - 0.3 ? floorY() : undefined;
  };
  // On the water, bobbing (t: s)
  const place = (t) => {
    boat.group.position.set(boat.x, waterY(boat.x, boat.z) + Math.sin(t * 1.7) * CANOE_BOB, boat.z);
    // (heading, then pitch, then roll — about the canoe's own axes)
    boat.group.rotation.set(Math.sin(t * 1.1) * 0.015 + boat.pitch, boat.yaw, Math.sin(t * 1.3 + 1) * 0.02 + boat.roll, 'YXZ');
  };
  const stop = () => {
    boat.vx = 0;
    boat.vz = 0;
    boat.w = 0;
    boat.blade = null;
    boat.bladeIn = false;
  };

  // The paddler's push this frame: the steer (steer: { fwd, turn }, −1…1 — the phone's tilt, the
  // joystick or WASD), the oar's stroke playing to fit it (stroke: { side (1 left, −1 right),
  // dir (1 forward, −1 back), strength 0…1, u 0…1 } or null — its pull surges the push) and its
  // blade for the splashes (oar: the oar's model, or null)
  const _b = new THREE.Vector3();
  const paddle = (dt, oar, steer, stroke = null) => {
    const c = boat;
    const p = stroke ? oarStrokePull(stroke.u) : 0;
    const pulling = p > 0 && p < 1;
    const blade = oar?.getObjectByName('oar-blade');
    if (blade) {
      blade.updateWorldMatrix(true, false);
      blade.getWorldPosition(_b);
      const prev = c.blade;
      // (its speed by the real clock: the caller's dt may be capped on a slow frame)
      const now = performance.now() / 1000;
      c.blade = { x: _b.x, y: _b.y, z: _b.z, t: now };
      const span = prev ? now - prev.t : 0;
      if (span > 1e-3 && span < 0.5) {
        const bvx = (_b.x - prev.x) / span - c.vx;
        const bvz = (_b.z - prev.z) / span - c.vz;
        const l = toLocal(_b.x, _b.z);
        const outside = Math.abs(l.x) > CANOE_HALF_WIDTH * 0.6 || Math.abs(l.z) > CANOE_HALF_LENGTH - 0.2;
        const surface = waterY(_b.x, _b.z);
        // Splashes: in and out of the water, and drops off it through the pull
        const nowIn = _b.y < surface + 0.02 && outside;
        if (nowIn !== c.bladeIn) {
          const speed = Math.min(6, Math.hypot(bvx, bvz, (_b.y - prev.y) / span));
          splash.drops({ x: _b.x, y: surface, z: _b.z, n: nowIn ? 6 + Math.min(10, Math.round(speed * 4)) : 5, speed: 0.4, up: nowIn ? 1.4 + Math.min(1.5, speed * 0.4) : 1.1 });
          splash.ring(_b.x, surface, _b.z, nowIn ? 0.25 : 0.15);
          c.bladeIn = nowIn;
        }
        // (drops thrown the way the blade goes, more for a stronger stroke)
        if (nowIn && pulling && now >= c.splashAt) {
          const bs = Math.hypot(bvx, bvz) || 1;
          const hard = 1 + 2 * (stroke.strength ?? 0.5);
          splash.drops({ x: _b.x, y: surface, z: _b.z, n: Math.round(2 + hard * 2), dx: bvx / bs, dz: bvz / bs, speed: 0.6 + hard * 0.5, up: 1.2 + hard * 0.5, spread: 0.35 });
          if (Math.random() < 0.35) splash.ring(_b.x, surface, _b.z, 0.12);
          c.splashAt = now + CANOE_SPLASH_EVERY;
        }
      }
    } else {
      c.blade = null;
      c.bladeIn = false;
    }
    // The steer pushes / turns it — with the strokes: mostly through their pulls, as the blade
    // sweeps (the same on the whole), a little steady
    const push = stroke ? oarStrokePush(stroke.u) : 1;
    const surge = 1 - CANOE_STROKE_SYNC + CANOE_STROKE_SYNC * push;
    c.accel = 0;
    if (Math.abs(steer.fwd) > 0.05) {
      c.accel = steer.fwd * CANOE_STEER_ACCEL * (steer.fwd < 0 ? CANOE_PADDLE_BACK : 1) * surge;
      c.vx += Math.sin(c.yaw) * c.accel * dt;
      c.vz += Math.cos(c.yaw) * c.accel * dt;
    }
    if (Math.abs(steer.turn) > 0.05) c.w -= steer.turn * CANOE_STEER_TURN * surge * dt;
    // (heeled over toward the side the blade's pulling on — side 1 = left: its side down, − roll)
    c.heelTo = stroke ? -stroke.side * CANOE_HEEL_STROKE * (stroke.strength ?? 1) * Math.sin(Math.PI * oarStrokePull(stroke.u)) : 0;
  };

  // Up against the shore / a dock: the way off it (world, unit) — toward deeper water from the
  // hull probes that touch ground at that pose (else from them toward the middle); null if none do
  const SLOPE_STEP = 0.4; // m
  const awayFromShallow = (fx, fz, fyaw) => {
    let ax = 0;
    let az = 0;
    let mx = 0;
    let mz = 0;
    for (const [lx, lz] of HULL_PROBES) {
      const p = toWorld({ x: fx, z: fz }, lx, lz, fyaw);
      if (waterDepth(p.x, p.z) >= CANOE_MIN_DEPTH) continue;
      const deep = (x2, z2) => Math.min(CANOE_MIN_DEPTH * 2, waterDepth(x2, z2));
      ax += deep(p.x + SLOPE_STEP, p.z) - deep(p.x - SLOPE_STEP, p.z);
      az += deep(p.x, p.z + SLOPE_STEP) - deep(p.x, p.z - SLOPE_STEP);
      mx += fx - p.x;
      mz += fz - p.z;
    }
    if (Math.hypot(ax, az) < 1e-6) { ax = mx; az = mz; }
    const l = Math.hypot(ax, az);
    return l > 1e-6 ? { x: ax / l, z: az / l } : null;
  };
  // The move to (nx, nz, nyaw) ran it aground: rather than stopping dead, it turns / slides
  // along the bank, pushed off it a little if it has to — and loses only the speed into it
  const bump = (nx, nz, nyaw) => {
    const c = boat;
    const away = awayFromShallow(nx, nz, nyaw) || awayFromShallow(c.x, c.z, c.yaw);
    let into = 0;
    if (away) {
      into = Math.min(0, c.vx * away.x + c.vz * away.z);
      // (along the bank: the move without the part into it)
      const dx = nx - c.x;
      const dz = nz - c.z;
      const d = Math.min(0, dx * away.x + dz * away.z);
      const sx = c.x + dx - away.x * d;
      const sz = c.z + dz - away.z * d;
      // (keeping the turn if it can, pushed off as little as will do)
      for (const [px, pz, pyaw] of [[sx, sz, nyaw], [c.x, c.z, nyaw], [sx, sz, c.yaw]]) {
        for (const push of [0, 0.03, 0.08, 0.15]) {
          const tx = px + away.x * push;
          const tz = pz + away.z * push;
          if (!fits(tx, tz, pyaw)) continue;
          c.x = tx; c.z = tz;
          if (pyaw !== nyaw) c.w = 0;
          c.yaw = pyaw;
          c.vx -= away.x * into;
          c.vz -= away.z * into;
          return;
        }
      }
    }
    if (fits(c.x, c.z, nyaw)) { c.yaw = nyaw; c.vx = 0; c.vz = 0; }
    else if (fits(nx, nz, c.yaw)) { c.x = nx; c.z = nz; c.w = 0; }
    else { c.vx = 0; c.vz = 0; c.w = 0; }
  };

  // Drag (along it, sideways — it hardly slides —, turning), then moving it unless that runs it
  // aground; placed on the water at t. Returns its yaw before the move.
  const move = (dt, t) => {
    const c = boat;
    const fx = Math.sin(c.yaw);
    const fz = Math.cos(c.yaw);
    let along = c.vx * fx + c.vz * fz;
    const sx = c.vx - fx * along;
    const sz = c.vz - fz * along;
    along *= Math.exp(-CANOE_DRAG * dt);
    const side = Math.exp(-CANOE_SIDE_DRAG * dt);
    c.vx = fx * along + sx * side;
    c.vz = fz * along + sz * side;
    c.w *= Math.exp(-CANOE_TURN_DRAG * dt);
    const speed = Math.hypot(c.vx, c.vz);
    if (speed > CANOE_MAX_SPEED) { c.vx *= CANOE_MAX_SPEED / speed; c.vz *= CANOE_MAX_SPEED / speed; }

    const oldYaw = c.yaw;
    if (speed > 1e-3 || Math.abs(c.w) > 1e-4) {
      const nx = c.x + c.vx * dt;
      const nz = c.z + c.vz * dt;
      const nyaw = c.yaw + c.w * dt;
      // (stuck somewhere too shallow already: let it move off)
      if (fits(nx, nz, nyaw) || !fits(c.x, c.z, c.yaw)) { c.x = nx; c.z = nz; c.yaw = nyaw; }
      else bump(nx, nz, nyaw);
    }
    // Its tilt: heeled toward the paddle, leaning out of the turn (turning left — w + — it leans
    // right: + roll), the bow up as it surges on; eased in. Paddling's wants are used up here, so
    // with none next frame (settled, the rod out, not aboard) it eases level.
    const k = 1 - Math.exp(-CANOE_TILT_RATE * dt);
    c.roll += (c.heelTo + c.w * CANOE_HEEL_TURN - c.roll) * k;
    c.pitch += (-c.accel * CANOE_PITCH_PER_ACCEL - c.pitch) * k;
    c.heelTo = 0;
    c.accel = 0;
    place(t);
    const holder = boat.group.parent;
    if (holder && splash.group.parent !== holder) holder.add(splash.group);
    splash.update(dt);
    return oldYaw;
  };
  // Coming to rest (the rod out: no paddling, and fishing wants it to stay put)
  const settle = (dt) => {
    const k = Math.exp(-CANOE_SETTLE_DRAG * dt);
    boat.vx *= k;
    boat.vz *= k;
    boat.w *= k;
  };
  // Gone for good (the sea start's canoe): its splashes too
  const dispose = () => splash.dispose();

  return Object.assign(boat, { fits, floorY, standPoint, floorAt, place, stop, paddle, settle, move, dispose });
}

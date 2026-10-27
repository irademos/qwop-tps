// The canoe on the water: its model, where it is, and how it moves — paddled by the oar's blade
// through the water (or the joystick / WASD), slowed by drag, kept off water shallower than
// CANOE_MIN_DEPTH. Shared by Town's canoe (townCanoe.js — moored by the fishing spot, got in and
// out of) and the guest's sea start (seaStart.js — out on the open sea).
//
// Paddling is the oar's blade moving through the water: each frame its blade (`oar-blade`,
// oar.js) is sampled in the world; while it is under the water and out past the hull, its
// stroke along the hull — its speed past the canoe (a blade held still in it does nothing) —
// pushes the canoe the other way (CANOE_PADDLE_PUSH × that speed, more for a quicker stroke —
// CANOE_STROKE_SPEED; a stroke forward backs it up, CANOE_PADDLE_BACK as hard) at the blade, so
// off to the side it turns the canoe too (CANOE_PADDLE_TURN of the moment): a stroke back on the
// left drives it forward and a little to the right, on the right forward and a little to the
// left. The hull slides along easily and hardly sideways (CANOE_DRAG / CANOE_SIDE_DRAG).
//
// The blade splashes (waterSplash.js): going in and coming out, and drops thrown back off it
// while it strokes hard enough to push (CANOE_SPLASH_*) — so it shows when it's biting.

import * as THREE from 'three';
import { createCanoe, CANOE_FLOOR_Y, CANOE_HALF_LENGTH, CANOE_HALF_WIDTH } from '../items/canoe.js';
import { createWaterSplash } from '../items/waterSplash.js';
import {
  CANOE_BLADE_DEPTH, CANOE_BLADE_MAX_SPEED, CANOE_BOB, CANOE_DRAG, CANOE_MAX_SPEED, CANOE_MIN_DEPTH,
  CANOE_PADDLE_BACK, CANOE_PADDLE_PUSH, CANOE_PADDLE_TURN, CANOE_SIDE_DRAG, CANOE_SPLASH_EVERY,
  CANOE_SPLASH_STROKE, CANOE_STAND_Z, CANOE_STEER_ACCEL, CANOE_STEER_TURN, CANOE_STROKE_SPEED, CANOE_TURN_DRAG,
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
    boat.group.rotation.set(Math.sin(t * 1.1) * 0.015, boat.yaw, Math.sin(t * 1.3 + 1) * 0.02);
  };
  const stop = () => {
    boat.vx = 0;
    boat.vz = 0;
    boat.w = 0;
    boat.blade = null;
    boat.bladeIn = false;
  };

  // The paddler's push this frame: the oar's blade through the water (oar: the oar's model, or
  // null) and the joystick / WASD (steer: { fwd, turn }, −1…1)
  const _b = new THREE.Vector3();
  const paddle = (dt, oar, steer) => {
    const c = boat;
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
        // (past the canoe: its own way through the water taken off)
        let bvx = (_b.x - prev.x) / span - c.vx;
        let bvz = (_b.z - prev.z) / span - c.vz;
        // (a jump in the oar's pose isn't a stroke: capped at this)
        const bs = Math.hypot(bvx, bvz);
        if (bs > CANOE_BLADE_MAX_SPEED) { bvx *= CANOE_BLADE_MAX_SPEED / bs; bvz *= CANOE_BLADE_MAX_SPEED / bs; }
        const bite = THREE.MathUtils.clamp((waterY(_b.x, _b.z) - _b.y) / CANOE_BLADE_DEPTH + 0.25, 0, 1);
        const l = toLocal(_b.x, _b.z);
        const outside = Math.abs(l.x) > CANOE_HALF_WIDTH * 0.6 || Math.abs(l.z) > CANOE_HALF_LENGTH - 0.2;
        const surface = waterY(_b.x, _b.z);
        // Splashes: in and out of the water, and drops off a stroke that bites
        const nowIn = _b.y < surface + 0.02 && outside;
        if (nowIn !== c.bladeIn) {
          const speed = Math.hypot(bvx, bvz, (_b.y - prev.y) / span);
          splash.drops({ x: _b.x, y: surface, z: _b.z, n: nowIn ? 6 + Math.min(10, Math.round(speed * 4)) : 5, speed: 0.4, up: nowIn ? 1.4 + Math.min(1.5, speed * 0.4) : 1.1 });
          splash.ring(_b.x, surface, _b.z, nowIn ? 0.25 : 0.15);
          c.bladeIn = nowIn;
        }
        // The stroke along the hull: back drives it on, forward backs it up (weaker)
        const fwdX = Math.sin(c.yaw);
        const fwdZ = Math.cos(c.yaw);
        // (a quicker stroke bites harder: the push grows with its speed — CANOE_STROKE_SPEED)
        const stroke = bvx * fwdX + bvz * fwdZ;
        let push = -stroke * (1 + Math.abs(stroke) / CANOE_STROKE_SPEED) * CANOE_PADDLE_PUSH * bite;
        if (push < 0) push *= CANOE_PADDLE_BACK;
        // (drops thrown the way the blade goes, more the harder it strokes)
        if (nowIn && Math.abs(stroke) > CANOE_SPLASH_STROKE && now >= c.splashAt) {
          const bs2 = Math.hypot(bvx, bvz) || 1;
          const hard = Math.min(3, Math.abs(stroke) / CANOE_SPLASH_STROKE);
          splash.drops({ x: _b.x, y: surface, z: _b.z, n: Math.round(2 + hard * 2), dx: bvx / bs2, dz: bvz / bs2, speed: 0.6 + hard * 0.5, up: 1.2 + hard * 0.5, spread: 0.35 });
          if (Math.random() < 0.35) splash.ring(_b.x, surface, _b.z, 0.12);
          c.splashAt = now + CANOE_SPLASH_EVERY;
        }
        if (outside && push !== 0) {
          const fx = fwdX * push;
          const fz = fwdZ * push;
          c.vx += fx * dt;
          c.vz += fz * dt;
          // (pushed off its middle: it turns — the moment about the vertical; from the plain
          // stroke, without the quick stroke's extra bite, so fast paddling doesn't spin it)
          const rx = _b.x - c.x;
          const rz = _b.z - c.z;
          const plain = 1 / (1 + Math.abs(stroke) / CANOE_STROKE_SPEED);
          c.w += (rz * fx - rx * fz) * plain * CANOE_PADDLE_TURN * dt;
        }
      }
    } else {
      c.blade = null;
      c.bladeIn = false;
    }
    // The joystick / WASD paddle for the player
    if (Math.abs(steer.fwd) > 0.05) {
      const a = steer.fwd * CANOE_STEER_ACCEL * (steer.fwd < 0 ? CANOE_PADDLE_BACK : 1) * dt;
      c.vx += Math.sin(c.yaw) * a;
      c.vz += Math.cos(c.yaw) * a;
    }
    if (Math.abs(steer.turn) > 0.05) c.w -= steer.turn * CANOE_STEER_TURN * dt;
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
      else if (fits(c.x, c.z, nyaw)) { c.yaw = nyaw; c.vx = 0; c.vz = 0; }
      else if (fits(nx, nz, c.yaw)) { c.x = nx; c.z = nz; c.w = 0; }
      else { c.vx = 0; c.vz = 0; c.w = 0; }
    }
    place(t);
    const holder = boat.group.parent;
    if (holder && splash.group.parent !== holder) holder.add(splash.group);
    splash.update(dt);
    return oldYaw;
  };
  // Gone for good (the sea start's canoe): its splashes too
  const dispose = () => splash.dispose();

  return Object.assign(boat, { fits, floorY, standPoint, floorAt, place, stop, paddle, move, dispose });
}

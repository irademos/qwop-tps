// Town: the canoe. It's moored on the water by the fishing spot (`places.fishSpot`, the first
// spot along the bank with water deep enough for all of it); walk up to it → 🛶 Get in the
// canoe. Standing in it (the player held still on its floor — a terrain height override while
// aboard, the controls' `holdStill` + a position constraint; carried along as it moves and
// turns) the oar comes out: the sword weapon in oar form (bootstrapGameApp.js / foamSword.js),
// held by its handle pointing down, so the phone straight up holds it straight down.
//
// Paddling is the oar's blade moving through the water: each frame its blade (`oar-blade`,
// oar.js) is sampled in the world; while it is under the water and out past the hull, it pushes
// the canoe forward — only forward: the part of its push along the hull, against the way the
// blade moves back (CANOE_PADDLE_PUSH × its speed; no backing up, no braking) — at the blade, so
// off to the side it turns the canoe too (CANOE_PADDLE_TURN of the moment): a stroke back on the
// left drives it forward and a little to the right, on the right forward and a little to the
// left. The hull slides along easily and hardly sideways (CANOE_DRAG / CANOE_SIDE_DRAG).
// The joystick / WASD paddle too (forward, turn) — without a gyro that's the only way.
// It won't go where the water is shallower than CANOE_MIN_DEPTH (runs aground). 🛶 Get out
// with dry ground within CANOE_SHORE_DIST: the player steps onto it, the canoe stays there
// (back at its mooring the next time Town opens). Dying / an arrest / leaving Town gets them
// out too. Only the player's own: in a shared town the others don't see it move (they'd see
// the player standing on the water).

import * as THREE from 'three';
import { registerTerrainHeightOverride } from '../environment/terrainHeight.js';
import { createCanoe, CANOE_FLOOR_Y, CANOE_HALF_LENGTH, CANOE_HALF_WIDTH } from '../items/canoe.js';
import {
  CANOE_BLADE_DEPTH, CANOE_BLADE_MAX_SPEED, CANOE_BOARD_DIST, CANOE_BOB, CANOE_DRAG, CANOE_MAX_SPEED,
  CANOE_MIN_DEPTH, CANOE_PADDLE_PUSH, CANOE_PADDLE_TURN, CANOE_SHORE_DIST, CANOE_SIDE_DRAG, CANOE_STAND_Z,
  CANOE_STEER_ACCEL, CANOE_STEER_TURN, CANOE_TURN_DRAG, dist2,
} from './townConfig.js';

// Where the hull's water depth is checked (canoe-local m: across, along)
const HULL_PROBES = [[0, 0], [0, CANOE_HALF_LENGTH - 0.3], [0, -(CANOE_HALF_LENGTH - 0.3)], [CANOE_HALF_WIDTH, 0], [-CANOE_HALF_WIDTH, 0]];

// T: the town's shared state + functions (createTownMode in townMode.js); ctx: the game
export function installTownCanoe(T, ctx) {
  // { group, x, z, yaw, vx, vz, w (rad/s), aboard, blade (last world position + time) | null, home }
  let canoe = null;
  let unregisterFloor = null;
  let searching = false; // (looking for the shore: the canoe's floor isn't ground meanwhile)

  const waterY = (x, z) => ctx.getWaterY(x, z) ?? 0;
  // Canoe-local (across +X — the player's left facing the bow —, along +Z) ↔ world
  const toWorld = (c, lx, lz, yaw = c.yaw) => ({
    x: c.x + lx * Math.cos(yaw) + lz * Math.sin(yaw),
    z: c.z - lx * Math.sin(yaw) + lz * Math.cos(yaw),
  });
  const toLocal = (c, x, z) => {
    const dx = x - c.x;
    const dz = z - c.z;
    return { x: dx * Math.cos(c.yaw) - dz * Math.sin(c.yaw), z: dx * Math.sin(c.yaw) + dz * Math.cos(c.yaw) };
  };
  const fits = (x, z, yaw) => HULL_PROBES.every(([lx, lz]) => {
    const p = toWorld({ x, z }, lx, lz, yaw);
    return ctx.waterDepth(p.x, p.z) >= CANOE_MIN_DEPTH;
  });
  const floorY = () => canoe.group.position.y + CANOE_FLOOR_Y;
  const standPoint = () => toWorld(canoe, 0, CANOE_STAND_Z);

  // While aboard its floor is the ground there (the controls stand the player on it)
  const floorAt = (x, z) => {
    if (!canoe?.aboard || searching) return undefined;
    const l = toLocal(canoe, x, z);
    return Math.abs(l.x) < CANOE_HALF_WIDTH && Math.abs(l.z) < CANOE_HALF_LENGTH - 0.3 ? floorY() : undefined;
  };
  // (playerControls.positionConstraint) Standing in it, on the spot
  const pin = (c) => {
    if (!canoe?.aboard) return;
    const s = standPoint();
    c.playerX = s.x;
    c.playerZ = s.z;
  };

  // Its mooring: off the fishing spot's bank, lying along it, a little to one side of where the
  // line goes out
  const findMooring = () => {
    const fs = T.layout?.places.fishSpot;
    if (!fs) return null;
    let ox = fs.face.x - fs.x;
    let oz = fs.face.z - fs.z;
    const ol = Math.hypot(ox, oz) || 1;
    ox /= ol;
    oz /= ol;
    const yaw = Math.atan2(-oz, ox); // (bow along the bank)
    for (const d of [2.5, 3.5, 4.5, 6, 8]) {
      for (const a of [3.5, -3.5, 5, -5, 2, -2, 0]) {
        const x = fs.x + ox * d - oz * a;
        const z = fs.z + oz * d + ox * a;
        if (fits(x, z, yaw)) return { x, z, yaw };
      }
    }
    return null;
  };
  const setup = () => {
    const home = findMooring();
    if (!home) return false;
    canoe = { group: createCanoe(), ...home, vx: 0, vz: 0, w: 0, aboard: false, blade: null, home };
    T.layout.props.group.add(canoe.group);
    place(0);
    return true;
  };
  let setupTried = false;
  const place = (t) => {
    canoe.group.position.set(canoe.x, waterY(canoe.x, canoe.z) + Math.sin(t * 1.7) * CANOE_BOB, canoe.z);
    canoe.group.rotation.set(Math.sin(t * 1.1) * 0.015, canoe.yaw, Math.sin(t * 1.3 + 1) * 0.02);
  };

  // ── Getting in and out ──
  const board = () => {
    if (!canoe || canoe.aboard || ctx.isPlayerDead() || T.sequence || T.jail || T.inRoom) return;
    if (T.fishing) { T.fishing = null; T.stopFishingRig(); }
    if (T.held) T.dropHeld();
    canoe.aboard = true;
    canoe.vx = 0;
    canoe.vz = 0;
    canoe.w = 0;
    canoe.blade = null;
    unregisterFloor ??= registerTerrainHeightOverride(floorAt);
    const s = standPoint();
    ctx.teleport(s.x, s.z, canoe.yaw);
    ctx.holdStill(true);
    ctx.setPositionConstraint(pin);
    ctx.setOar(true);
    T.feedLine(ctx.hasGyro()
      ? '🛶 Hold the phone up — the oar points down — and sweep the blade back through the water beside the canoe. Left side: forward and right. Right side: forward and left.'
      : '🛶 Paddle with W / S or the joystick, turn with A / D.');
    T.actsAt = 0;
  };
  // Out of it where it is (dying, an arrest, a room, leaving Town); the controls let go
  const leave = () => {
    if (!canoe?.aboard) return;
    canoe.aboard = false;
    canoe.blade = null;
    unregisterFloor?.();
    unregisterFloor = null;
    ctx.holdStill(false);
    if (!T.jail && !T.inRoom) ctx.setPositionConstraint(null);
    ctx.setOar(false);
    T.actsAt = 0;
  };
  // Dry ground to step out onto: the town's walkable grid, or (past it) a ring of ground samples
  const shoreSpot = () => {
    const s = standPoint();
    searching = true;
    try {
      const nav = T.layout.nav;
      const i = nav.nearestWalkable(s.x, s.z);
      if (i >= 0 && dist2(nav.cellX(i), nav.cellZ(i), s.x, s.z) < CANOE_SHORE_DIST) return { x: nav.cellX(i), z: nav.cellZ(i) };
      for (let r = 1; r <= CANOE_SHORE_DIST; r += 0.5) {
        for (let k = 0; k < 16; k++) {
          const a = (k / 16) * Math.PI * 2;
          const x = s.x + Math.sin(a) * r;
          const z = s.z + Math.cos(a) * r;
          if (ctx.waterDepth(x, z) > 0) continue;
          const g = ctx.getGroundY(x, z);
          if (Number.isFinite(g) && g - waterY(x, z) < 1.5) return { x, z };
        }
      }
      return null;
    } finally {
      searching = false;
    }
  };
  const getOut = () => {
    if (!canoe?.aboard) return;
    const spot = shoreSpot();
    if (!spot) { T.feedLine('🛶 Paddle closer to the shore to get out.'); return; }
    const s = standPoint();
    leave();
    ctx.teleport(spot.x, spot.z, Math.atan2(spot.x - s.x, spot.z - s.z));
  };

  // ── Each frame: the oar's push, the joystick's, drag, moving it (and the player in it) ──
  const _b = new THREE.Vector3();
  const updateCanoe = (dt) => {
    if (!canoe) {
      if (!setupTried && T.layout) { setupTried = true; setup(); }
      if (!canoe) return;
    }
    if (canoe.aboard && (ctx.isPlayerDead() || T.sequence || T.jail || T.inRoom)) leave();
    const c = canoe;
    if (c.aboard) {
      // The oar's blade through the water
      const oar = ctx.getOarModel();
      const blade = oar?.getObjectByName('oar-blade');
      if (blade) {
        blade.updateWorldMatrix(true, false);
        blade.getWorldPosition(_b);
        const prev = c.blade;
        // (its speed by the real clock: the town's dt is capped on a slow frame)
        const now = performance.now() / 1000;
        c.blade = { x: _b.x, y: _b.y, z: _b.z, t: now };
        const span = prev ? now - prev.t : 0;
        if (span > 1e-3 && span < 0.5) {
          let bvx = (_b.x - prev.x) / span;
          let bvz = (_b.z - prev.z) / span;
          // (a quick flick of the phone still counts, at most this fast)
          const bs = Math.hypot(bvx, bvz);
          if (bs > CANOE_BLADE_MAX_SPEED) { bvx *= CANOE_BLADE_MAX_SPEED / bs; bvz *= CANOE_BLADE_MAX_SPEED / bs; }
          const bite = THREE.MathUtils.clamp((waterY(_b.x, _b.z) - _b.y) / CANOE_BLADE_DEPTH + 0.25, 0, 1);
          const l = toLocal(c, _b.x, _b.z);
          const outside = Math.abs(l.x) > CANOE_HALF_WIDTH * 0.6 || Math.abs(l.z) > CANOE_HALF_LENGTH - 0.2;
          // Only the stroke's push forward counts (no backing up, and a blade left in the water
          // doesn't brake it): the blade moving back along the hull drives it on
          const fwdX = Math.sin(c.yaw);
          const fwdZ = Math.cos(c.yaw);
          const push = -(bvx * fwdX + bvz * fwdZ) * CANOE_PADDLE_PUSH * bite;
          if (outside && push > 0) {
            const fx = fwdX * push;
            const fz = fwdZ * push;
            c.vx += fx * dt;
            c.vz += fz * dt;
            // (pushed off its middle: it turns — the moment about the vertical)
            const rx = _b.x - c.x;
            const rz = _b.z - c.z;
            c.w += (rz * fx - rx * fz) * CANOE_PADDLE_TURN * dt;
          }
        }
      } else {
        c.blade = null;
      }
      // The joystick / WASD paddle for the player
      const steer = ctx.getSteer();
      if (steer.fwd > 0.05) { // (forward only)
        c.vx += Math.sin(c.yaw) * steer.fwd * CANOE_STEER_ACCEL * dt;
        c.vz += Math.cos(c.yaw) * steer.fwd * CANOE_STEER_ACCEL * dt;
      }
      if (Math.abs(steer.turn) > 0.05) c.w -= steer.turn * CANOE_STEER_TURN * dt;
    }
    // Drag: along it, sideways (hardly slides), turning
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
    place(T.simT);
    if (c.aboard) {
      const s = standPoint();
      ctx.carryPlayer(s.x, floorY(), s.z, c.yaw - oldYaw);
    }
  };

  // ── Acts (townActs.js): 🛶 Get in by it; aboard, 🛶 Get out by the shore ──
  const canoeActs = (calm) => {
    if (!canoe) return [];
    if (canoe.aboard) return shoreSpot() ? [{ key: 'canoeout', label: '🛶 Get out', onClick: getOut }] : [];
    if (!calm || T.inRoom || T.jail || T.held || T.fishing || ctx.isPlayerDead()) return [];
    const p = T.playerPos();
    return dist2(p.x, p.z, canoe.x, canoe.z) < CANOE_BOARD_DIST ? [{ key: 'canoein', label: '🛶 Get in the canoe', onClick: board }] : [];
  };

  // Leaving Town: out of it, and back at its mooring for next time
  const resetCanoe = () => {
    if (!canoe) return;
    leave();
    Object.assign(canoe, { x: canoe.home.x, z: canoe.home.z, yaw: canoe.home.yaw, vx: 0, vz: 0, w: 0 });
    place(0);
  };
  const inCanoe = () => !!canoe?.aboard;

  Object.assign(T, { canoeActs, inCanoe, resetCanoe, updateCanoe });
}

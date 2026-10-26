// Town: the canoe. It's moored on the water by the fishing spot (`places.fishSpot`, the first
// spot along the bank with water deep enough for all of it); walk up to it → 🛶 Get in the
// canoe. Standing in it (the player held still on its floor — a terrain height override while
// aboard, the controls' `holdStill` + a position constraint; carried along as it moves and
// turns) the oar comes out: the sword weapon in oar form (bootstrapGameApp.js / foamSword.js),
// held by its handle pointing down, so the phone straight up holds it straight down.
//
// Paddling and how it moves on the water: canoeBoat.js (shared with the guest's sea start). The
// joystick / WASD paddle too (forward / back, turn) — without a gyro that's the only way.
// It won't go where the water is shallower than CANOE_MIN_DEPTH (runs aground). 🛶 Get out
// with dry ground within CANOE_SHORE_DIST: the player steps onto it, the canoe stays there
// (back at its mooring the next time Town opens). Dying / an arrest / leaving Town gets them
// out too. Only the player's own: in a shared town the others don't see it move (they'd see
// the player standing on the water).

import { registerTerrainHeightOverride } from '../environment/terrainHeight.js';
import { createCanoeBoat } from './canoeBoat.js';
import { CANOE_BOARD_DIST, CANOE_SHORE_DIST, dist2 } from './townConfig.js';

// T: the town's shared state + functions (createTownMode in townMode.js); ctx: the game
export function installTownCanoe(T, ctx) {
  // The boat (canoeBoat.js: group, x, z, yaw, vx, vz, w, blade…) + { aboard, home }
  let canoe = null;
  let unregisterFloor = null;
  let searching = false; // (looking for the shore: the canoe's floor isn't ground meanwhile)

  const waterY = (x, z) => ctx.getWaterY(x, z) ?? 0;

  // While aboard its floor is the ground there (the controls stand the player on it)
  const floorAt = (x, z) => (!canoe?.aboard || searching ? undefined : canoe.floorAt(x, z));
  // (playerControls.positionConstraint) Standing in it, on the spot
  const pin = (c) => {
    if (!canoe?.aboard) return;
    const s = canoe.standPoint();
    c.playerX = s.x;
    c.playerZ = s.z;
  };

  // Its mooring: off the fishing spot's bank, lying along it, a little to one side of where the
  // line goes out
  const findMooring = (boat) => {
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
        if (boat.fits(x, z, yaw)) return { x, z, yaw };
      }
    }
    return null;
  };
  const setup = () => {
    const boat = createCanoeBoat({ waterY, waterDepth: ctx.waterDepth });
    const home = findMooring(boat);
    if (!home) return false;
    canoe = Object.assign(boat, home, { aboard: false, home });
    T.layout.props.group.add(canoe.group);
    canoe.place(0);
    return true;
  };
  let setupTried = false;

  // ── Getting in and out ──
  const board = () => {
    if (!canoe || canoe.aboard || ctx.isPlayerDead() || T.sequence || T.jail || T.inRoom) return;
    if (T.fishing) { T.fishing = null; T.stopFishingRig(); }
    if (T.held) T.dropHeld();
    canoe.aboard = true;
    canoe.stop();
    unregisterFloor ??= registerTerrainHeightOverride(floorAt);
    const s = canoe.standPoint();
    ctx.teleport(s.x, s.z, canoe.yaw);
    ctx.holdStill(true);
    ctx.setPositionConstraint(pin);
    ctx.setOar(true);
    T.feedLine(ctx.hasGyro()
      ? 'Hold the phone up — the oar points down — and sweep the blade back through the water beside the canoe. Left side: forward and right. Right side: forward and left.'
      : 'Paddle with W / S or the joystick, turn with A / D.');
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
    const s = canoe.standPoint();
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
    if (!spot) { T.feedLine('Paddle closer to the shore to get out.'); return; }
    const s = canoe.standPoint();
    leave();
    ctx.teleport(spot.x, spot.z, Math.atan2(spot.x - s.x, spot.z - s.z));
  };

  // ── Each frame: the oar's push, the joystick's, drag, moving it (and the player in it) ──
  const updateCanoe = (dt) => {
    if (!canoe) {
      if (!setupTried && T.layout) { setupTried = true; setup(); }
      if (!canoe) return;
    }
    if (canoe.aboard && (ctx.isPlayerDead() || T.sequence || T.jail || T.inRoom)) leave();
    if (canoe.aboard) canoe.paddle(dt, ctx.getOarModel(), ctx.getSteer());
    const oldYaw = canoe.move(dt, T.simT);
    if (canoe.aboard) {
      const s = canoe.standPoint();
      ctx.carryPlayer(s.x, canoe.floorY(), s.z, canoe.yaw - oldYaw);
    }
  };

  // ── Acts (townActs.js): 🛶 Get in by it; aboard, 🛶 Get out by the shore ──
  const canoeActs = (calm) => {
    if (!canoe) return [];
    if (canoe.aboard) return shoreSpot() ? [{ key: 'canoeout', label: 'Get out', onClick: getOut }] : [];
    if (!calm || T.inRoom || T.jail || T.held || T.fishing || ctx.isPlayerDead()) return [];
    const p = T.playerPos();
    return dist2(p.x, p.z, canoe.x, canoe.z) < CANOE_BOARD_DIST ? [{ key: 'canoein', label: 'Get in the canoe', onClick: board }] : [];
  };

  // Leaving Town: out of it, and back at its mooring for next time
  const resetCanoe = () => {
    if (!canoe) return;
    leave();
    canoe.stop();
    Object.assign(canoe, { x: canoe.home.x, z: canoe.home.z, yaw: canoe.home.yaw });
    canoe.place(0);
  };
  const inCanoe = () => !!canoe?.aboard;

  Object.assign(T, { canoeActs, inCanoe, resetCanoe, updateCanoe });
}

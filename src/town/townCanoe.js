// Town: the canoe. It's moored on the water by the fishing spot (`places.fishSpot`, the first
// spot along the bank with water deep enough for all of it); walk up to it → 🛶 Get in the
// canoe. Standing in it (the player held still on its floor — a terrain height override while
// aboard, the controls' `holdStill` + a position constraint; carried along as it moves and
// turns) the oar comes out: the sword weapon in oar form (bootstrapGameApp.js / foamSword.js).
// The phone's tilt steers it like a joystick: tipped forward it paddles on, back it backs up,
// leaned left / right it turns that way, the oar's strokes playing by themselves to fit
// (bootstrapGameApp.js / canoeBoat.js). With a fishing rod bought, the rod comes out in the
// canoe too (its weapon button / the phone's): the player turns to face over the side and can
// fish wherever the canoe is (T.fishAnywhere / T.fishWater — townFishing.js), the canoe coming
// to rest meanwhile; the oar back, they face the bow again.
//
// Paddling and how it moves on the water: canoeBoat.js (shared with the guest's sea start). The
// joystick / WASD steer it the same way — without a gyro that's the only way.
// It won't go where the water is shallower than CANOE_MIN_DEPTH (runs aground). 🛶 Get out
// anywhere: with dry ground within CANOE_SHORE_DIST the player steps onto it, else over the side
// into the water (swimming — townDive.js to go under); swimming up to it (within CANOE_BOARD_DIST)
// 🛶 Get in the canoe climbs back in. The canoe stays where it's left (back at its mooring the
// next time Town opens). Dying / an arrest / leaving Town gets them out too. Only the player's own: in a shared town the others don't see it move (they'd see
// the player standing on the water).
// There's no canoe in Town till the fisher's built it (his first job — quests/jobs.js, the `build`
// beat → T.setCanoeBuilt(true), kept with the quests' save as a flag): hidden, no Get in.
//
// A job can take a townsperson out in it (T.canoePassenger(n) — the fisher, after the golden fish:
// beats/sea.js; a second in the stern — T.canoePassenger(n, 1)): kneeling in the bow (n.seat → T.canoeSeat, crouched like the cart's passenger),
// and while the job says so (T.canoePilot({ target: () => { x, z }, speed }) — null: the player
// paddles again) it's them paddling: their own oar stroking on alternate sides, the canoe steered
// toward the target, whatever the player holds (T.setCanoeArmed(true): the sword, to knock the
// pirates' bombs back). T.canoeRock(at) — a blast beside it rocks it and pushes it off. No Get
// out while the passenger's paddling (the job lands them — T.canoeLand); otherwise out and back in
// whenever (the fisher's dive: out over the side, both of them).

import * as THREE from 'three';
import { registerTerrainHeightOverride } from '../environment/terrainHeight.js';
import { createCanoeBoat } from './canoeBoat.js';
import { CANOE_FLOOR_Y, CANOE_HALF_WIDTH } from '../items/canoe.js';
import { createOarModel, oarStrokeDuration, oarStrokePose } from '../items/oar.js';
import { CANOE_BOARD_DIST, CANOE_SHORE_DIST, dist2 } from './townConfig.js';

const NO_STEER = { fwd: 0, turn: 0 };
const ARMED_HELD = ['foamSword', 'magic_wand', 'pistol']; // (what may be in hand while armed)
const SEAT_Z = 1.15;          // m along it (bow +): where a passenger kneels…
const SEAT_Z2 = -1.3;         // …and a second one, behind the player (the fisher's rescue: both cousins home)
const PILOT_GRIP = { y: 0.62, z: 0.1, out: 0.3 }; // m: the passenger's top hand — over the floor, ahead of their knees, out over the side
const PILOT_TURN_GAIN = 1.5;  // the steer: per rad off the heading…
const PILOT_TURN_DAMP = 0.6;  // …less per rad/s already turning
const PILOT_SLOW_DIST = 6;    // m from the target it eases off
const ROCK_ROLL = 0.34;       // rad a blast beside it heels it over
const ROCK_PUSH = 1.6;        // m/s it's pushed off
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// T: the town's shared state + functions (createTownMode in townMode.js); ctx: the game
export function installTownCanoe(T, ctx) {
  // The boat (canoeBoat.js: group, x, z, yaw, vx, vz, w, blade…) + { aboard, home }
  let canoe = null;
  let unregisterFloor = null;
  let searching = false; // (looking for the shore: the canoe's floor isn't ground meanwhile)
  let built = false;      // (the fisher's built it — T.setCanoeBuilt)

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
    canoe.group.visible = built;
    canoe.place(0);
    return true;
  };
  let setupTried = false;

  // ── Getting in and out ──
  const board = () => {
    if (!canoe || canoe.aboard || ctx.isPlayerDead() || T.sequence || T.jail || T.inRoom) return;
    // (climbing in from the water: up from under it first, out of the swim)
    ctx.endDive?.();
    if (T.fishing) { T.fishing = null; T.stopFishingRig(); }
    if (T.held) T.dropHeld();
    canoe.aboard = true;
    canoe.stop();
    ctx.playSfx?.('splash');
    unregisterFloor ??= registerTerrainHeightOverride(floorAt);
    const s = canoe.standPoint();
    ctx.teleport(s.x, s.z, canoe.yaw);
    ctx.setOar(true); // (first: off the flying broom, which lets go of the controls)
    ctx.holdStill(true);
    ctx.setPositionConstraint(pin);
    canoe.facing = 'oar';
    T.feedLine((ctx.hasGyro()
      ? 'Tip the phone forward to paddle, back to back up, and lean it left or right to turn. The further you tip it, the harder you paddle.'
      : 'Paddle with W / S or the joystick, turn with A / D.')
      + (ctx.isRodAllowed() ? ' Take the rod out to fish from the canoe.' : ''));
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
    if (armed === 'untilOar') { armed = false; faceSide = 0; }
    T.actsAt = 0;
  };
  // Dry ground to step out onto: the town's walkable grid, or (past it) a ring of ground samples
  const shoreSpot = () => {
    const s = canoe.standPoint();
    searching = true;
    try {
      const nav = T.layout.nav;
      const i = nav.indexAt(s.x, s.z) >= 0 ? nav.nearestWalkable(s.x, s.z) : -1;
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
  // Over the side into the water: beside it on whichever side the water's deep enough to swim
  const waterSpot = () => {
    const s = canoe.standPoint();
    const across = { x: Math.cos(canoe.yaw), z: -Math.sin(canoe.yaw) }; // (its left)
    for (const side of [1, -1]) {
      for (const d of [CANOE_HALF_WIDTH + 0.9, CANOE_HALF_WIDTH + 1.4]) {
        const x = s.x + across.x * side * d;
        const z = s.z + across.z * side * d;
        if (ctx.waterDepth(x, z) > 1.1) return { x, z, yaw: canoe.yaw };
      }
    }
    return null;
  };
  const getOut = () => {
    if (!canoe?.aboard) return;
    const s = canoe.standPoint();
    const spot = shoreSpot();
    if (spot) {
      leave();
      ctx.teleport(spot.x, spot.z, Math.atan2(spot.x - s.x, spot.z - s.z));
      return;
    }
    const w = waterSpot();
    if (!w) { T.feedLine('Paddle closer to the shore to get out.'); return; }
    leave();
    ctx.teleport(w.x, w.z, w.yaw);
    ctx.playSfx?.('splash');
  };

  // ── Each frame: the oar's push, the joystick's, drag, moving it (and the player in it) ──
  const updateCanoe = (dt) => {
    if (!canoe) {
      if (!setupTried && T.layout) { setupTried = true; setup(); }
      if (!canoe) return;
    }
    if (canoe.aboard && (ctx.isPlayerDead() || T.sequence || T.jail || T.inRoom)) leave();
    // (armed until the oar's picked: once it's in hand, done — and facing the bow again)
    if (armed === 'untilOar' && ctx.heldWeapon?.() === 'canoe_oar') { armed = false; faceSide = 0; }
    // (a job's fight from it — or the night octopus: the sword stays in hand, or the wand / the bow
    // for a draw; nothing while a bomb's aimed / thrown or a draw's going on)
    if (canoe.aboard && armed && !ctx.isPlayerDead() && !ARMED_HELD.includes(ctx.heldWeapon?.()) && !ctx.weaponBusy?.()
      && T.simT > (canoe.armAt ?? 0)) {
      canoe.armAt = T.simT + 1;
      ctx.setCanoeWeapon?.('sword');
    }
    // (the rod out: no paddling, it comes to rest, the player facing over its side to fish)
    const rodOut = canoe.aboard && ctx.isRodEquipped();
    // (or turned to face something over a side — the night octopus: T.canoeFaceSide)
    const want = faceSide ? `side${faceSide}` : rodOut ? 'rod' : 'oar';
    if (canoe.aboard && canoe.facing !== want) {
      canoe.facing = want;
      const s = canoe.standPoint();
      ctx.teleport(s.x, s.z, canoe.yaw + (faceSide ? faceSide * Math.PI / 2 : rodOut ? -Math.PI / 2 : 0));
    }
    // (someone talking with the player in the talk box: it comes to rest till the talk's over)
    const talking = canoe.aboard && T.jobTalk?.isOpen();
    if (talking) { canoe.paddle(dt, null, NO_STEER); canoe.settle(dt); }
    else if (pilot && canoe.aboard) {
      const steer = pilotSteer();
      canoe.paddle(dt, pOar, steer, pilotStroke(dt, steer));
    } else if (rodOut || (canoe.aboard && T.questHoldsVehicle?.('canoe'))) {
      // (the rod out — or a job holding it where it's brought them till the next step's done:
      // townQuests.js — no paddling, it comes to rest)
      canoe.paddle(dt, null, NO_STEER);
      canoe.settle(dt);
    }
    else if (canoe.aboard) canoe.paddle(dt, ctx.getOarModel(), ctx.getSteer(), ctx.getOarStroke());
    else if (passenger) canoe.settle(dt);
    const oldYaw = canoe.move(dt, T.simT);
    if (canoe.aboard) {
      const s = canoe.standPoint();
      ctx.carryPlayer(s.x, canoe.floorY(), s.z, canoe.yaw - oldYaw);
    }
  };

  // ── Acts (townActs.js): 🛶 Get in by it; aboard, 🛶 Get out by the shore ──
  const canoeActs = (calm) => {
    if (!canoe || (!built && !canoe.aboard)) return [];
    if (canoe.aboard) return !pilot && (shoreSpot() || waterSpot()) ? [{ key: 'canoeout', label: 'Get out', onClick: getOut }] : [];
    if (!calm || T.inRoom || T.jail || T.held || T.fishing || ctx.isPlayerDead() || ctx.getControls?.()?.swimLocked) return [];
    const p = T.playerPos();
    return dist2(p.x, p.z, canoe.x, canoe.z) < CANOE_BOARD_DIST ? [{ key: 'canoein', label: 'Get in the canoe', onClick: board }] : [];
  };

  // Leaving Town: out of it, and back at its mooring for next time
  const resetCanoe = () => {
    if (!canoe) return;
    canoePassenger(null);
    armed = false;
    faceSide = 0;
    leave();
    canoe.stop();
    Object.assign(canoe, { x: canoe.home.x, z: canoe.home.z, yaw: canoe.home.yaw });
    canoe.place(0);
  };
  // (built: there at its mooring from now on; not: gone — out of it first)
  const setCanoeBuilt = (on) => {
    built = !!on;
    if (!canoe) return;
    if (!built) leave();
    if (!canoe.aboard && !passenger) {
      canoe.stop();
      Object.assign(canoe, { x: canoe.home.x, z: canoe.home.z, yaw: canoe.home.yaw });
      canoe.place(0);
    }
    canoe.group.visible = built;
    T.actsAt = 0;
  };
  const inCanoe = () => !!canoe?.aboard;
  // Fishing (townFishing.js): from the canoe, anywhere; a cast lands on water, not in the canoe
  // ── A passenger (a job's: the fisher), and them paddling ──
  let passenger = null;  // the townsperson kneeling in the bow
  let passenger2 = null; // a second, kneeling in the stern (behind the player)
  let pilot = null;      // { target: () => { x, z }, speed (m/s) } — the passenger paddles
  let armed = false;     // a job's fight from it: the sword in hand
  let faceSide = 0;      // the player turned to face over its left (+1) / right (−1) side; 0: as usual
  let pOar = null;       // their oar (canoe-local, posed per stroke)
  let pStroke = null;    // { side, dir, strength, u, dur }
  const _seats = [0, 1].map(() => ({ pos: new THREE.Vector3(), quat: new THREE.Quaternion() }));
  const canoeSeat = (slot = 0) => {
    if (!canoe || !(slot ? passenger2 : passenger)) return null;
    const seat = _seats[slot ? 1 : 0];
    canoe.group.updateWorldMatrix(true, false);
    seat.pos.set(0, CANOE_FLOOR_Y, slot ? SEAT_Z2 : SEAT_Z);
    canoe.group.localToWorld(seat.pos);
    canoe.group.getWorldQuaternion(seat.quat);
    return seat;
  };
  const seat2 = () => canoeSeat(1);
  // (slot 1: the stern; null in the bow clears both)
  const canoePassenger = (n, slot = 0) => {
    if (slot) {
      if (passenger2 && passenger2 !== n) passenger2.seat = null;
      passenger2 = n ?? null;
      if (passenger2) passenger2.seat = seat2;
      T.actsAt = 0;
      return;
    }
    if (passenger && passenger !== n) passenger.seat = null;
    passenger = n ?? null;
    if (passenger) passenger.seat = canoeSeat;
    if (!passenger) {
      canoePilot(null);
      if (passenger2) { passenger2.seat = null; passenger2 = null; }
    }
    T.actsAt = 0;
  };
  const canoePilot = (p) => {
    pilot = p ?? null;
    pStroke = null;
    if (pOar) pOar.visible = !!pilot;
  };
  // on: true (the sword in hand till set back off), false (the oar back), or 'untilOar' (the
  // sword stays till the player picks the oar themselves — the night octopus beaten)
  const setCanoeArmed = (on) => {
    const v = on === 'untilOar' ? on : !!on;
    if (armed === v) return;
    const was = armed;
    armed = v;
    T.actsAt = 0;
    // (the buttons / the phone told: 'untilOar' brings the oar back onto the weapon button)
    if (!canoe?.aboard || (was && v)) { ctx.refreshButtons?.(); return; }
    ctx.setCanoeWeapon?.(armed ? 'sword' : 'oar');
  };
  // Steering for the passenger: toward the target, easing off near it
  const pilotSteer = () => {
    const to = pilot.target();
    if (!to) return NO_STEER;
    const dx = to.x - canoe.x;
    const dz = to.z - canoe.z;
    const d = Math.hypot(dx, dz);
    const diff = wrap(Math.atan2(dx, dz) - canoe.yaw);
    const turn = THREE.MathUtils.clamp(-diff * PILOT_TURN_GAIN + canoe.w * PILOT_TURN_DAMP, -1, 1);
    const along = canoe.vx * Math.sin(canoe.yaw) + canoe.vz * Math.cos(canoe.yaw);
    const speed = (pilot.speed ?? 2.5) * Math.min(1, d / PILOT_SLOW_DIST);
    const fwd = THREE.MathUtils.clamp((speed - along) * 0.8, 0, 1) * Math.max(0.2, Math.cos(diff));
    return { fwd, turn };
  };
  // Their oar: a stroke at a time, on alternate sides (or the side that turns it), its pose like
  // the player's (oar.js), its blade splashing (canoeBoat.js — the stroke surges the canoe)
  const _d = new THREE.Vector3();
  const _down = new THREE.Vector3(0, 0, -1);
  const pilotStroke = (dt, steer) => {
    if (!pOar) {
      pOar = createOarModel();
      canoe.group.add(pOar);
    }
    pOar.visible = true;
    if (!pStroke || pStroke.u >= 1) {
      const strength = Math.min(1, Math.abs(steer.fwd) + Math.abs(steer.turn) * 0.5);
      // (turning: on the side that turns it — paddling on the left turns it right; else take turns)
      const side = Math.abs(steer.turn) > 0.35 ? (steer.turn > 0 ? 1 : -1) : -(pStroke?.side ?? 1);
      pStroke = { side, dir: 1, strength, u: 0, dur: oarStrokeDuration(strength) };
    }
    pStroke.u = Math.min(1, pStroke.u + dt / pStroke.dur);
    const { tilt, swing } = oarStrokePose(pStroke.u, 1, Math.abs(steer.fwd) + Math.abs(steer.turn) < 0.05 ? 1 : 0);
    const side = pStroke.side;
    pOar.position.set(side * Math.max(CANOE_HALF_WIDTH * 0.5, PILOT_GRIP.out), CANOE_FLOOR_Y + PILOT_GRIP.y, SEAT_Z + PILOT_GRIP.z);
    // (the blade's way from the grip: tilted from straight down out over the side, swung fore / aft)
    _d.set(side * Math.sin(tilt) * Math.cos(swing), -Math.cos(tilt), Math.sin(tilt) * Math.sin(swing)).normalize();
    pOar.quaternion.setFromUnitVectors(_down, _d);
    return pStroke;
  };
  // A blast at `at` ({ x, z }) beside it: heeled over away from it, pushed off
  const canoeRock = (at, k = 1) => {
    if (!canoe) return;
    const dx = canoe.x - at.x;
    const dz = canoe.z - at.z;
    const d = Math.hypot(dx, dz) || 1;
    // (canoe-local across: + = its left)
    const across = (dx / d) * Math.cos(canoe.yaw) - (dz / d) * Math.sin(canoe.yaw);
    // (heeled away from it, then rocking side to side, dying away — canoeBoat.js)
    canoe.rock = (across >= 0 ? -1 : 1) * Math.min(ROCK_ROLL * 1.4, Math.abs(canoe.rock) * 0.5 + ROCK_ROLL * k);
    canoe.rockPh = 0;
    canoe.vx += (dx / d) * ROCK_PUSH * k;
    canoe.vz += (dz / d) * ROCK_PUSH * k;
    canoe.w += (Math.random() - 0.5) * 0.8 * k;
  };
  const canoePose = () => (canoe ? { x: canoe.x, z: canoe.z, yaw: canoe.yaw, vx: canoe.vx, vz: canoe.vz, home: canoe.home } : null);
  // The job's done with it: the player out at the nearest dry ground (true once they're out;
  // force: no shore in reach — onto the fishing spot)
  const canoeLand = (force = false) => {
    if (!canoe) return true;
    canoePilot(null);
    if (canoe.aboard) {
      const fs = T.layout?.places.fishSpot;
      const spot = shoreSpot() ?? (force && fs ? { x: fs.x, z: fs.z } : null);
      if (!spot) return false;
      const s = canoe.standPoint();
      leave();
      ctx.teleport(spot.x, spot.z, Math.atan2(spot.x - s.x, spot.z - s.z));
    }
    return true;
  };

  const fishAnywhere = inCanoe;
  const fishWater = (x, z) => (canoe?.aboard ? canoe.floorAt(x, z) === undefined && ctx.waterDepth(x, z) > 0.4 : undefined);

  // Stopped where it is (a job's fishing spot reached)
  const canoeStop = () => { if (canoe) { canoe.vx = 0; canoe.vz = 0; canoe.w = 0; } };
  // (back at its mooring — the job's over, the player not in it)
  const moorCanoe = () => {
    if (!canoe || canoe.aboard) return;
    canoe.stop();
    Object.assign(canoe, { x: canoe.home.x, z: canoe.home.z, yaw: canoe.home.yaw, roll: 0, pitch: 0 });
    canoe.place(T.simT);
  };

  Object.assign(T, {
    canoeActs, canoeBuilt: () => built, canoeBoard: () => { board(); return !!canoe?.aboard; }, fishAnywhere, fishWater, inCanoe, resetCanoe, setCanoeBuilt, updateCanoe,
    canoeStop, canoePassenger, canoeHasPassenger: () => !!passenger, canoePilot, canoeSeat, canoeRock, canoePose, canoeLand, moorCanoe,
    setCanoeArmed, canoeArmed: () => !!armed && !!canoe?.aboard,
    canoeArmedUntilOar: () => armed === 'untilOar' && !!canoe?.aboard,
    // (dev console: town.debug().T.canoeDebug() — the boat itself; .moveTo(x, z) puts it there)
    canoeDebug: () => canoe && Object.assign(canoe, { moveTo: (x, z) => { canoe.x = x; canoe.z = z; canoe.stop(); canoe.place(T.simT); } }),
    canoeFaceSide: (side) => { faceSide = side ? Math.sign(side) : 0; },
  });
}

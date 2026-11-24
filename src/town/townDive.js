// Town: diving under water. Swimming at the surface (PlayerControls SWIM_CONFIG), the Dive
// button (held — the on-screen one, the phone's, or Space) takes the player under: while it's
// held they swim the way they face (yaw + pitch — the body tipped nose down / up), playing the
// Swimming clip; let go, they hover where they are treading water, only turning. What they face:
// the phone's gyro like the bow / bomb aim — its turn turns them (an amplified offset, plus a
// steady turn while it's held turned past a dead zone) and its tip tips them forward / back
// (from START_PITCH, nose down a little, at the dive's start) — or, without a gyro, the stick /
// WASD (up = nose down, sideways = turn). The camera follows behind, looking the way they swim.
// Coming back up to the surface (or into water too shallow to be under) ends the dive and the
// normal surface swim takes over; so does a room, going down or leaving Town. Running out of
// breath under water (bootstrapGameApp.js — the swim energy bar drains under water too,
// DIVE_DRAIN×, unless an air bubble's over the head) stops the swim and sinks them from where
// they are (DROWN_SINK) until the fade washes them ashore.
//
// Under the surface the camera sees blue: fog + a blue background (scene.fog is set once, far
// off, when this is made, so turning it on doesn't recompile every material), a CSS tint
// (`.underwater-tint`), a fish or two swimming by now and then (koi_fish.glb — fishModels.js)
// and bubbles rising from the player.
//
// The bow under water: with a bow and an arrow, holding the Bow button while under stops the
// swim — they tread water (the Treading Water clip with the arms on the IK, holding the bow) and
// the gyro (or the stick) aims it as it steers the dive, the camera looking the way they aim. Let
// go and the arrow flies on a string (`shoot`): slowed by the water, it's pulled back to them when
// it misses (past STRING_LEN, too slow, the bottom or the surface) — the arrow comes back, none
// used up. One that hits a fish sticks in it: the fish tries to swim off on the line, and the
// fishing reel comes up (townFishing.js `setExtReel` — the on-screen reel, R, or the phone's) to
// wind it in; brought within HOOK_LAND_DIST it's landed (+fish, `onCatch`); left unreeled for
// HOOK_FREE_S it shakes free. The dive ending (the surface, out of breath…) cuts the line.
//
// The controls side: PlayerControls.ride { y, yaw, pitch, pivot, camPitch } + holdStill (like
// the broom), `diveAnim` for the clip (src/controls/controls.js).

import * as THREE from 'three';
import { createKoiFishMesh } from '../items/fishModels.js';

// ── Movement ──
const SWIM_SPEED = 2.4;         // m/s holding Dive
const ACCEL = 3.5;              // 1/s the speed eases up to it
const STOP_RATE = 3;            // 1/s it eases to a stop let go
const START_PITCH = -0.55;      // rad (nose down) at the dive's start, the phone held as it was
const PITCH_MAX = 1.3;          // rad either way (~75°)
// Reeling in a speared fish: both hands on the string (× the character's height scale)
const REEL_CHEST_Y = 0.68;      // m over the feet the hands pull toward
const REEL_HAND_MID = 0.3;      // m out from the chest, on average
const REEL_HAND_SWING = 0.1;    // m each hand reaches past / pulls back of that
const REEL_HAND_GAP = 0.045;    // m the hands sit apart, side to side
const REEL_HAND_SWAPS = 2;      // hand-over-hand swaps a turn of the reel
const PIVOT = 0.5;              // m over the feet the body tips about (× the character's height scale)
const BOTTOM_CLEAR = 0.45;      // m the body's middle keeps over the bottom
const SURFACE_UNDER = 0.35;     // m under the surface the body's middle keeps while under
const SURFACE_EXIT_S = 0.6;     // s into a dive before coming back up can end it
const MAX_DEPTH = 40;           // m (off the map's ground: the bottom's taken as this deep)
const START_PUSH = 1.2;         // m/s down at the start (a duck under even before moving)
const DROWN_SINK = 0.8;         // m/s out of breath under water: sinking from where they are
// ── Gyro (as _updateWeaponGyroAim in bootstrapGameApp.js) ──
const YAW_GAIN = 2.2;
const YAW_OFFSET_MAX = THREE.MathUtils.degToRad(45);
const TURN_DEADZONE = THREE.MathUtils.degToRad(8);
const TURN_RATE = 6;            // rad/s per radian past the dead zone
const TURN_RATE_MAX = 3;        // rad/s
const PITCH_GAIN = 2.2;
const GYRO_SMOOTH = 14;         // 1/s
// ── The stick (no gyro) ──
const STICK_TURN = 1.8;         // rad/s full over
const STICK_PITCH = 1.2;        // rad/s full over
// ── Camera ──
const CAM_PITCH_SHARE = 0.85;   // the camera's pitch × the body's (behind and above it diving down)
const CAM_GROUND_CLEAR = 0.4;   // m the camera keeps over the bottom
const CAM_SURFACE_UNDER = 0.15; // m the camera keeps under the surface while the player's under
const TREAD_PITCH_SHARE = 0.5;  // treading still the upright clip is tipped this × as far
const AIM_PITCH_SHARE = 0.2;    // the bow drawn: the body this × (the arms do the rest)

// ── Under water: the look ──
const FOG_NEAR = 0.5;
const FOG_FAR = 22;
const DAY_COLOR = new THREE.Color(0x1f6f8b);
const NIGHT_COLOR = new THREE.Color(0x05172a);
const FISH_MAX = 2;
const FISH_EVERY_S = [3, 7];    // s between fish turning up (random in this range)
const FISH_NEAR = [3.5, 7];       // m from the player they turn up
const FISH_LIFE_S = [12, 22];
const FISH_GONE_DIST = 16;
const FISH_SPEED = [0.7, 1.4];  // m/s
const FISH_LEN = [0.5, 0.9];   // m
const BUBBLE_MAX = 40;
const BUBBLE_EVERY_S = 0.12;    // swimming (treading: 3× slower)
const BUBBLE_RISE = 0.9;        // m/s

// ── The bow under water: an arrow on a string ──
const SHOT_SPEED = [6, 15];     // m/s, a quick tap … fully drawn
const SHOT_DRAG = 1.1;          // 1/s the water slows it
const SHOT_SLOW = 2;            // m/s: slower than this it's pulled back
const STRING_LEN = 14;          // m of string
const SHOT_RETURN_SPEED = 11;   // m/s it's pulled back on a miss
const SHOT_STUCK_S = 0.35;      // s it sticks in the bottom before it's pulled out
const HOOK_REEL_M = 1.4;        // m of string a turn of the reel winds in
const HOOK_PULL_SPEED = 0.8;    // m/s a speared fish swims off on the line (up to STRING_LEN)
const HOOK_LAND_DIST = 1.1;     // m: this close it's landed
const HOOK_FREE_S = 14;         // s without reeling and it shakes free
const HOOK_RADIUS = 0.4;        // × the fish's length: how near its middle the arrow has to pass

const rand = (a, b) => a + Math.random() * (b - a);
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * The underwater look: fog / background / tint while the camera's under the surface, fish and
 * bubbles while the player's under. update(dt, { camera, under, center, night }).
 */
export function createUnderwater({ scene, getWaterLevel, getBottom }) {
  // (set once, far off, so the materials' shaders compile with fog from the start)
  if (!scene.fog) scene.fog = new THREE.Fog(0x000000, 1e6, 2e6);
  const fog = scene.fog;
  const idleFog = { color: fog.color.clone(), near: fog.near, far: fog.far };
  const color = new THREE.Color();
  let savedBackground;      // the background while the camera's under (undefined: not under)
  let camUnder = false;
  const tint = document.createElement('div');
  tint.className = 'underwater-tint';
  document.body.appendChild(tint);

  const setCamUnder = (on, night) => {
    if (on) {
      color.copy(DAY_COLOR).lerp(NIGHT_COLOR, THREE.MathUtils.clamp(night || 0, 0, 1));
      fog.color.copy(color);
      fog.near = FOG_NEAR;
      fog.far = FOG_FAR;
      // (whatever the sky's set to meanwhile is kept for after — Town's sun may change it)
      if (scene.background !== color) { savedBackground = scene.background; scene.background = color; }
    } else if (camUnder) {
      fog.color.copy(idleFog.color);
      fog.near = idleFog.near;
      fog.far = idleFog.far;
      if (scene.background === color) scene.background = savedBackground ?? null;
      savedBackground = undefined;
    }
    if (on !== camUnder) tint.classList.toggle('on', on);
    camUnder = on;
  };

  // ── Fish ──
  const fish = [];
  let fishWait = rand(1, 3);
  const spawnFish = (center) => {
    for (let tries = 0; tries < 8; tries++) {
      const a = Math.random() * Math.PI * 2;
      const r = rand(FISH_NEAR[0], FISH_NEAR[1]);
      const x = center.x + Math.sin(a) * r, z = center.z + Math.cos(a) * r;
      const level = getWaterLevel(x, z);
      const bottom = getBottom(x, z);
      if (!Number.isFinite(level) || !Number.isFinite(bottom) || level - bottom < 1.2) continue;
      const len = rand(FISH_LEN[0], FISH_LEN[1]);
      const lo = bottom + 0.4, hi = level - 0.4;
      const y = THREE.MathUtils.clamp(center.y + rand(-1.5, 1.5), lo, hi);
      addFish(x, y, z, len, center);
      return;
    }
  };
  const addFish = (x, y, z, len, center) => {
    const holder = new THREE.Group();
    const mesh = createKoiFishMesh(len);
    holder.add(mesh);
    holder.position.set(x, y, z);
    scene.add(holder);
    // (heading roughly across the player's view — past them, not straight at them)
    const toward = Math.atan2(center.x - x, center.z - z);
    fish.push({
      holder, mesh, len,
      heading: toward + (Math.random() < 0.5 ? 1 : -1) * rand(0.5, 1.2),
      speed: rand(FISH_SPEED[0], FISH_SPEED[1]),
      turn: 0, turnT: 0, ph: Math.random() * 6, life: rand(FISH_LIFE_S[0], FISH_LIFE_S[1]),
    });
  };
  const removeFish = (f) => {
    f.holder.removeFromParent();
    f.holder.traverse((o) => { if (o.isMesh) o.geometry?.dispose?.(); });
  };
  const updateFish = (dt, center, under) => {
    if (under && center) {
      fishWait -= dt;
      if (fishWait <= 0 && fish.length < FISH_MAX) {
        spawnFish(center);
        fishWait = rand(FISH_EVERY_S[0], FISH_EVERY_S[1]);
      }
    }
    for (let i = fish.length - 1; i >= 0; i--) {
      const f = fish[i];
      f.life -= dt;
      const p = f.holder.position;
      const far = !center || Math.hypot(p.x - center.x, p.z - center.z) > FISH_GONE_DIST;
      if (!under || f.life <= 0 || far) { removeFish(f); fish.splice(i, 1); continue; }
      // (a gentle wander, turning back from shallows / the bottom / the surface)
      f.turnT -= dt;
      if (f.turnT <= 0) { f.turn = rand(-0.5, 0.5); f.turnT = rand(1, 3); }
      const ahead = 1.5;
      const ax = p.x + Math.sin(f.heading) * ahead, az = p.z + Math.cos(f.heading) * ahead;
      const levA = getWaterLevel(ax, az), botA = getBottom(ax, az);
      const shallow = !Number.isFinite(levA) || !Number.isFinite(botA) || levA - botA < 1;
      f.heading += (shallow ? 1.6 : f.turn) * dt;
      f.ph += dt * (6 + f.speed * 5);
      const step = f.speed * dt;
      p.x += Math.sin(f.heading) * step;
      p.z += Math.cos(f.heading) * step;
      const lev = getWaterLevel(p.x, p.z), bot = getBottom(p.x, p.z);
      if (Number.isFinite(lev) && Number.isFinite(bot)) {
        p.y = THREE.MathUtils.clamp(p.y + Math.sin(f.ph * 0.15) * 0.08 * dt, bot + 0.3, lev - 0.3);
      }
      // (model head = +X: turned so it heads along `heading`; the tail wags it)
      f.holder.rotation.y = f.heading - Math.PI / 2 + Math.sin(f.ph) * 0.18;
    }
  };

  // ── Bubbles (rising from the player's head) ──
  const bubbleGeo = new THREE.SphereGeometry(1, 6, 4);
  const bubbleMat = new THREE.MeshBasicMaterial({ color: 0xd9f6ff, transparent: true, opacity: 0.55, depthWrite: false });
  const bubbleMesh = new THREE.InstancedMesh(bubbleGeo, bubbleMat, BUBBLE_MAX);
  bubbleMesh.frustumCulled = false;
  bubbleMesh.count = 0;
  scene.add(bubbleMesh);
  const bubbles = [];
  let bubbleT = 0;
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const sv = new THREE.Vector3();
  const pv = new THREE.Vector3();
  const updateBubbles = (dt, under, head, moving) => {
    if (under && head) {
      bubbleT -= dt;
      if (bubbleT <= 0 && bubbles.length < BUBBLE_MAX) {
        bubbleT = BUBBLE_EVERY_S * (moving ? 1 : 3) * rand(0.6, 1.4);
        bubbles.push({ x: head.x + rand(-0.1, 0.1), y: head.y, z: head.z + rand(-0.1, 0.1), r: rand(0.012, 0.03), ph: Math.random() * 6 });
      }
    }
    let n = 0;
    for (let i = bubbles.length - 1; i >= 0; i--) {
      const b = bubbles[i];
      b.y += BUBBLE_RISE * dt * (1 + b.r * 6);
      b.ph += dt * 4;
      const lev = getWaterLevel(b.x, b.z);
      if (!Number.isFinite(lev) || b.y > lev - 0.03 || (!under && b.y > lev - 0.03)) { bubbles.splice(i, 1); continue; }
    }
    for (const b of bubbles) {
      pv.set(b.x + Math.sin(b.ph) * 0.03, b.y, b.z + Math.cos(b.ph * 0.8) * 0.03);
      m4.compose(pv, q, sv.setScalar(b.r));
      bubbleMesh.setMatrixAt(n++, m4);
    }
    bubbleMesh.count = n;
    bubbleMesh.instanceMatrix.needsUpdate = true;
  };

  // The first fish the segment a → b passes through (taken out of the wanderers — the caller
  // owns it now: its holder / mesh / len), or null
  const _seg = new THREE.Vector3();
  const _toF = new THREE.Vector3();
  const takeFishOn = (a, b) => {
    _seg.subVectors(b, a);
    const lenSq = _seg.lengthSq();
    for (let i = 0; i < fish.length; i++) {
      const f = fish[i];
      _toF.subVectors(f.holder.position, a);
      const t = lenSq > 1e-8 ? THREE.MathUtils.clamp(_toF.dot(_seg) / lenSq, 0, 1) : 0;
      _toF.addScaledVector(_seg, -t);
      const r = Math.max(0.2, f.len * HOOK_RADIUS);
      if (_toF.lengthSq() <= r * r) { fish.splice(i, 1); return f; }
    }
    return null;
  };

  return {
    takeFishOn,
    removeFish,
    /** (dev) a fish at x, y, z — townDive.debug().fishAt(…) */
    fishAt: (x, y, z, len = 0.7) => addFish(x, y, z, len, new THREE.Vector3(x, y, z - 1)),
    update(dt, { camera, under, center, head, moving, night }) {
      const cp = camera?.position;
      const lev = cp ? getWaterLevel(cp.x, cp.z) : null;
      setCamUnder(!!under && Number.isFinite(lev) && cp.y < lev, night);
      updateFish(dt, center, !!under);
      updateBubbles(dt, !!under, head, moving);
    },
    clear() {
      setCamUnder(false);
      for (const f of fish) removeFish(f);
      fish.length = 0;
      bubbles.length = 0;
      bubbleMesh.count = 0;
    },
    isCameraUnder: () => camUnder,
    fishCount: () => fish.length,
  };
}

/**
 * The dive. ctx: {
 *   scene, getControls, getPlayerModel,
 *   getWaterLevel(x, z) → surface Y | null, getBottom(x, z) → the bottom's Y (real ground),
 *   heightScale() → the character's height scale,
 *   readGyro(reset) → { yaw, pitch } (rad, the phone's turn / tip since its pose at the last
 *     reset — + = left / up) or null (no gyro),
 *   allowed() → may the player be under water now (Town, alive, not indoors…),
 *   putAway() → put whatever's in hand away, getNight() → 0…1,
 *   onChange() → the buttons / phone status, onDive(center) → a splash going under,
 * }
 */
export function createTownDive(ctx) {
  const look = createUnderwater({ scene: ctx.scene, getWaterLevel: ctx.getWaterLevel, getBottom: ctx.getBottom });
  const ride = { y: 0, yaw: 0, pitch: 0, pivot: PIVOT, camPitch: 0 };
  const center = new THREE.Vector3();   // the body's middle (the pivot)
  const head = new THREE.Vector3();
  let held = false;
  let under = false;
  let t = 0;
  let speed = 0;
  let vDown = 0;
  let baseYaw = 0, lastYaw = 0, basePitch = START_PITCH;
  let gyroYaw = 0, gyroPitch = 0, gyroOn = false;
  let stickPitch = START_PITCH;
  let aimPitch = START_PITCH;   // the way they face (ride.pitch = how far the body's shown tipped)
  let canWas = false;
  let shot = null;              // the arrow on its string (shoot) — { phase, pos, vel, mesh, fish, … }

  const pivot = () => PIVOT * (ctx.heightScale?.() || 1);
  const bottomAt = (x, z, level) => {
    const b = ctx.getBottom(x, z);
    return Number.isFinite(b) ? Math.max(b, level - MAX_DEPTH) : level - MAX_DEPTH;
  };
  const canDive = () => {
    const c = ctx.getControls();
    return !under && !!c && !!c.isSwimming && !c.swimLocked && !c.ride && !c.holdStill && !!ctx.allowed();
  };

  const start = () => {
    const c = ctx.getControls();
    const pm = ctx.getPlayerModel();
    if (!c || !pm) return false;
    under = true;
    t = 0;
    speed = 0;
    vDown = START_PUSH;
    const yaw = Number.isFinite(c._swimYaw) ? c._swimYaw : pm.rotation.y;
    baseYaw = yaw;
    c.yaw = yaw;
    lastYaw = yaw;
    basePitch = START_PITCH;
    stickPitch = START_PITCH;
    aimPitch = START_PITCH;
    gyroOn = false;
    gyroYaw = 0; gyroPitch = 0;
    ctx.readGyro(true);
    center.set(c.playerX, c.playerY + pivot(), c.playerZ);
    ride.yaw = yaw;
    ride.pitch = START_PITCH;
    ride.pivot = pivot();
    ride.camPitch = -START_PITCH * CAM_PITCH_SHARE;
    ride.y = c.playerY;
    c.ride = ride;
    c.holdStill = true;
    c.diveAnim = 'tread';
    ctx.putAway?.();
    document.body.classList.add('player-diving');
    ctx.onDive?.(center);
    ctx.onChange?.();
    return true;
  };

  // ── The arrow on a string ──
  const lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(6), 3));
  const line = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: 0xf4f1e6, transparent: true, opacity: 0.85 }));
  line.frustumCulled = false;
  line.visible = false;
  ctx.scene.add(line);
  const _from = new THREE.Vector3();
  const _to = new THREE.Vector3();
  const _prev = new THREE.Vector3();
  const _away = new THREE.Vector3();
  const _look = new THREE.Vector3();
  // Where the string starts: the bow (or the hand — the front one while reeling in) — else
  // just in front of the head
  const lineStart = (out) => (ctx.lineStart?.(out, reelHands ? reelFront : null) ? out : out.copy(head));
  // Reeling a speared fish in: both hands on the string, out toward the fish, pulling it in
  // hand over hand as the reel turns (userData.handPose — playerModel.js; the 'treadAim' clip
  // keeps the arms on the IK)
  let reelPh = 0;
  let reelHands = false;
  let reelFront = 'left';
  const _handL = new THREE.Vector3();
  const _handR = new THREE.Vector3();
  const _toFish = new THREE.Vector3();
  const _side = new THREE.Vector3();
  const setReelHands = (on) => {
    const pm = ctx.getPlayerModel();
    if (on) {
      const f = shot?.fish;
      if (!pm || !f) return false;
      const h = ctx.heightScale?.() || 1;
      // (toward the fish in the body's own frame, kept in front of the chest)
      pm.updateMatrixWorld();
      pm.worldToLocal(_toFish.copy(f.holder.position));
      _toFish.y -= REEL_CHEST_Y * h;
      _toFish.z = Math.max(_toFish.z, 0.2);
      if (_toFish.lengthSq() < 1e-6) _toFish.set(0, 0, 1);
      _toFish.normalize();
      _side.set(_toFish.z, 0, -_toFish.x).normalize();
      // (hand over hand: each turn of the reel the back hand reaches past the front one)
      const u = Math.sin(reelPh * Math.PI);
      const dl = (REEL_HAND_MID + REEL_HAND_SWING * u) * h;
      const dr = (REEL_HAND_MID - REEL_HAND_SWING * u) * h;
      _handL.copy(_toFish).multiplyScalar(dl).addScaledVector(_side, -REEL_HAND_GAP * h);
      _handR.copy(_toFish).multiplyScalar(dr).addScaledVector(_side, REEL_HAND_GAP * h);
      _handL.y += REEL_CHEST_Y * h + Math.max(0, Math.cos(reelPh * Math.PI)) * 0.03 * h;
      _handR.y += REEL_CHEST_Y * h + Math.max(0, -Math.cos(reelPh * Math.PI)) * 0.03 * h;
      reelFront = dl >= dr ? 'left' : 'right';
      pm.userData.handPose = { left: _handL, right: _handR };
      reelHands = true;
      return true;
    }
    if (reelHands && pm && pm.userData.handPose?.left === _handL) pm.userData.handPose = null;
    reelHands = false;
    return false;
  };
  const disposeArrow = (mesh) => {
    mesh.removeFromParent();
    mesh.traverse((o) => {
      if (!o.isMesh) return;
      o.geometry?.dispose?.();
      (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m?.dispose?.());
    });
  };
  const setReel = (on) => {
    ctx.setReel?.(on ? {
      onTurns: (turns) => { if (shot?.phase === 'hooked') { shot.reel += turns; shot.idle = 0; reelPh += turns * REEL_HAND_SWAPS; } },
      text: () => 'Reel it in!',
    } : null);
  };
  // The line gone: the arrow and a fish still on it with it (it swims free — out of sight)
  function cutLine() {
    if (!shot) return;
    disposeArrow(shot.mesh);
    if (shot.fish) { look.removeFish(shot.fish); setReel(false); }
    shot = null;
    line.visible = false;
    ctx.onChange?.();
  }
  /** Looses an arrow on a string from `from` along `dir` (normalised), power 0 … 1. */
  const shoot = (from, dir, power) => {
    if (!under || shot || !ctx.createArrow) return false;
    const mesh = ctx.createArrow();
    mesh.position.copy(from);
    mesh.lookAt(_look.copy(from).add(dir));
    ctx.scene.add(mesh);
    const speed = THREE.MathUtils.lerp(SHOT_SPEED[0], SHOT_SPEED[1], THREE.MathUtils.clamp(power, 0, 1));
    shot = { phase: 'fly', pos: from.clone(), vel: dir.clone().multiplyScalar(speed), mesh, fish: null, t: 0, reel: 0, idle: 0 };
    line.visible = true;
    ctx.onChange?.();
    return true;
  };
  const updateShot = (dt) => {
    if (!shot) return;
    const s = shot;
    s.t += dt;
    lineStart(_from);
    if (s.phase === 'fly') {
      _prev.copy(s.pos);
      s.vel.multiplyScalar(Math.exp(-SHOT_DRAG * dt));
      s.pos.addScaledVector(s.vel, dt);
      const f = look.takeFishOn(_prev, s.pos);
      if (f) {
        // Speared: the arrow stays in it (moved with it from now on), the reel comes up
        s.phase = 'hooked';
        s.fish = f;
        s.mesh.position.copy(s.pos).lerp(f.holder.position, 0.6);
        f.holder.attach(s.mesh);
        s.idle = 0;
        setReel(true);
        ctx.onSpear?.(f.holder.position);
        ctx.onChange?.();
      } else {
        const level = ctx.getWaterLevel(s.pos.x, s.pos.z);
        const bottom = Number.isFinite(level) ? bottomAt(s.pos.x, s.pos.z, level) : -Infinity;
        if (!Number.isFinite(level) || s.pos.y > level - 0.05) { s.pos.y = Number.isFinite(level) ? level - 0.05 : s.pos.y; s.phase = 'back'; }
        else if (s.pos.y < bottom) { s.pos.y = bottom; s.phase = 'stuck'; s.t = 0; }
        else if (s.pos.distanceTo(_from) >= STRING_LEN || s.vel.length() < SHOT_SLOW) s.phase = 'back';
        s.mesh.position.copy(s.pos);
        if (s.phase === 'fly') s.mesh.lookAt(_look.copy(s.pos).add(s.vel));
      }
    } else if (s.phase === 'stuck') {
      if (s.t >= SHOT_STUCK_S) s.phase = 'back';
    } else if (s.phase === 'back') {
      // Pulled back on the string, tail first
      _away.subVectors(s.pos, _from);
      const d = _away.length();
      if (d < 0.5) { cutLine(); return; }
      s.pos.addScaledVector(_away, -Math.min(d, SHOT_RETURN_SPEED * dt) / d);
      s.mesh.position.copy(s.pos);
      s.mesh.lookAt(_look.copy(s.pos).add(_away));
    } else if (s.phase === 'hooked') {
      const f = s.fish;
      const p = f.holder.position;
      _away.subVectors(p, center);
      let d = _away.length();
      if (d > 1e-4) _away.divideScalar(d); else _away.set(0, 0, 1);
      s.idle += dt;
      // (it swims off on the line; the reel winds it in)
      const wound = s.reel * HOOK_REEL_M;
      s.reel = 0;
      const nd = THREE.MathUtils.clamp(d + HOOK_PULL_SPEED * dt - wound, 0, STRING_LEN);
      f.ph += dt * 16;
      const side = Math.sin(f.ph * 0.35) * 0.35 * dt;
      p.set(center.x + _away.x * nd + _away.z * side, center.y + _away.y * nd, center.z + _away.z * nd - _away.x * side);
      const level = ctx.getWaterLevel(p.x, p.z);
      if (Number.isFinite(level)) p.y = THREE.MathUtils.clamp(p.y, bottomAt(p.x, p.z, level) + 0.3, level - 0.3);
      // (head = +X, turned to swim away from the player, thrashing)
      f.holder.rotation.y = Math.atan2(_away.x, _away.z) - Math.PI / 2 + Math.sin(f.ph) * 0.45;
      if (nd <= HOOK_LAND_DIST) {
        const len = f.len;
        cutLine();
        ctx.onCatch?.(len);
        return;
      }
      if (s.idle >= HOOK_FREE_S) { cutLine(); ctx.onFree?.(); return; }
    }
    if (!shot) return;
    (s.fish ? s.mesh.getWorldPosition(_to) : _to.copy(s.pos));
    const a = lineGeo.attributes.position;
    a.setXYZ(0, _from.x, _from.y, _from.z);
    a.setXYZ(1, _to.x, _to.y, _to.z);
    a.needsUpdate = true;
  };

  // Back to the surface swim (or wherever the controls put them next)
  const end = () => {
    if (!under) return;
    cutLine();
    setReelHands(false);
    under = false;
    held = false;
    const c = ctx.getControls();
    if (c) {
      if (c.ride === ride) c.ride = null;
      c.holdStill = false;
      c.diveAnim = null;
      c._swimYaw = ride.yaw;
      c.yaw = ride.yaw;
      c.playerY = center.y - pivot();
      c.pitch = Math.min(c.pitch, 0.35);
    }
    const pm = ctx.getPlayerModel();
    if (pm) pm.rotation.x = 0;
    document.body.classList.remove('player-diving');
    ctx.onChange?.();
  };

  // The way they face: the gyro (absolute tip, offset + steady turn), else the stick
  const steer = (dt, c) => {
    // (yaw turned by something else since — a touch drag on the camera)
    baseYaw += wrap(c.yaw - lastYaw);
    const g = ctx.readGyro(false);
    if (g) {
      if (!gyroOn) { gyroOn = true; gyroYaw = g.yaw; gyroPitch = g.pitch; basePitch = aimPitch - g.pitch * PITCH_GAIN; }
      const k = 1 - Math.exp(-GYRO_SMOOTH * dt);
      gyroYaw += wrap(g.yaw - gyroYaw) * k;
      gyroPitch += (g.pitch - gyroPitch) * k;
      const yawAbs = Math.abs(gyroYaw);
      if (yawAbs > TURN_DEADZONE) {
        baseYaw += Math.sign(gyroYaw) * Math.min(TURN_RATE_MAX, (yawAbs - TURN_DEADZONE) * TURN_RATE) * dt;
      }
      const off = THREE.MathUtils.clamp(gyroYaw * YAW_GAIN, -YAW_OFFSET_MAX, YAW_OFFSET_MAX);
      ride.yaw = baseYaw + off;
      aimPitch = THREE.MathUtils.clamp(basePitch + gyroPitch * PITCH_GAIN, -PITCH_MAX, PITCH_MAX);
      stickPitch = aimPitch;
    } else {
      if (gyroOn) { gyroOn = false; baseYaw = ride.yaw; }
      const s = c.stickInput || { fwd: 0, right: 0 };
      baseYaw -= s.right * STICK_TURN * dt;   // (yaw + = left)
      stickPitch = THREE.MathUtils.clamp(stickPitch - s.fwd * STICK_PITCH * dt, -PITCH_MAX, PITCH_MAX);
      ride.yaw = baseYaw;
      aimPitch = stickPitch;
    }
    c.yaw = ride.yaw;
    lastYaw = c.yaw;
  };

  return {
    /** Each frame before the controls place the player. */
    update(dt) {
      const c = ctx.getControls();
      const can = canDive();
      if (under && (!c || !ctx.allowed() || c.ride !== ride)) end();
      if (!under && held && can) start();
      if (can !== canWas) { canWas = can; ctx.onChange?.(); }
      if (!under) return;
      dt = Math.min(Math.max(dt || 0, 0), 0.1);
      t += dt;
      // (nothing comes out under water — the phone's buttons included — but the bow, drawn)
      // Out of breath (bootstrapGameApp.js — c.swimLocked): no more swimming, just sinking
      // from where they are, down to the bottom (not back up to the surface first)
      const drowning = !!c.swimLocked;
      if (drowning) { held = false; if (shot) cutLine(); }
      const aiming = !drowning && !!ctx.bowOut?.();
      if (!aiming) ctx.putAway?.();
      if (!drowning) steer(dt, c);
      else { aimPitch += (0 - aimPitch) * (1 - Math.exp(-2 * dt)); c.yaw = ride.yaw; lastYaw = c.yaw; }
      // (the bow drawn or the line out: treading water where they are)
      const moving = held && !aiming && !shot;
      speed += ((moving ? SWIM_SPEED : 0) - speed) * (1 - Math.exp(-(moving ? ACCEL : STOP_RATE) * dt));
      vDown *= Math.exp(-2.5 * dt);
      const cp = Math.cos(aimPitch), sp = Math.sin(aimPitch);
      let nx = center.x + Math.sin(ride.yaw) * cp * speed * dt;
      let nz = center.z + Math.cos(ride.yaw) * cp * speed * dt;
      let ny = center.y + sp * speed * dt - vDown * dt - (drowning ? DROWN_SINK * dt : 0);
      const level = ctx.getWaterLevel(nx, nz);
      if (!Number.isFinite(level)) { end(); return; }
      // (the bottom slides them up along it; water too shallow to be under → up, out of the dive)
      const bottom = bottomAt(nx, nz, level);
      const top = level - SURFACE_UNDER;
      if (ny < bottom + BOTTOM_CLEAR) ny = bottom + BOTTOM_CLEAR;
      if (ny > top) {
        if (bottom + BOTTOM_CLEAR > top || (!drowning && t > SURFACE_EXIT_S && aimPitch > 0.05)) {
          center.set(nx, Math.min(ny, level), nz);
          end();
          return;
        }
        ny = top;
      }
      center.set(nx, ny, nz);
      const piv = pivot();
      ride.pivot = piv;
      ride.y = center.y - piv;
      c.playerX = center.x;
      c.playerZ = center.z;
      c.playerY = ride.y;
      const swimming = speed > 0.35;
      // (a fish on the line, the bow put away: both hands on the string — setReelHands)
      const reeling = !aiming && !drowning && shot?.phase === 'hooked' && setReelHands(true);
      if (!reeling) setReelHands(false);
      // (the bow: treading, the arms on the IK holding it — or holding the string)
      c.diveAnim = swimming ? 'swim' : aiming || reeling ? 'treadAim' : 'tread';
      // (treading upright, the body isn't tipped all the way — eased between the two; aiming,
      // hardly at all: the arms point the bow)
      const shown = swimming ? aimPitch : aimPitch * (aiming ? AIM_PITCH_SHARE : TREAD_PITCH_SHARE);
      ride.pitch += (shown - ride.pitch) * (1 - Math.exp(-6 * dt));
      // (aiming, the camera looks right along the aim — the crosshair's where the arrow goes)
      ride.camPitch = -aimPitch * (aiming ? 1 : CAM_PITCH_SHARE);
    },
    /** After the controls: the camera kept over the bottom; the look; fish and bubbles. */
    afterControls(dt, camera) {
      if (under && camera) {
        const p = camera.position;
        const lev = ctx.getWaterLevel(p.x, p.z);
        if (Number.isFinite(lev)) {
          // (kept over the bottom, and under the surface — it looks on from under the water)
          const lo = bottomAt(p.x, p.z, lev) + CAM_GROUND_CLEAR;
          const hi = lev - CAM_SURFACE_UNDER;
          const y = Math.max(lo, Math.min(hi, p.y));
          if (y !== p.y) { p.y = y; camera.lookAt(center.x, center.y + 0.2, center.z); camera.updateMatrixWorld(); }
        }
      }
      head.set(center.x + Math.sin(ride.yaw) * Math.cos(aimPitch) * 0.45,
        center.y + Math.sin(aimPitch) * 0.45 + 0.1, center.z + Math.cos(ride.yaw) * Math.cos(aimPitch) * 0.45);
      if (under) updateShot(Math.min(Math.max(dt || 0, 0), 0.1));
      look.update(dt, { camera, under, center: under ? center : null, head: under ? head : null, moving: speed > 0.35, night: ctx.getNight?.() ?? 0 });
    },
    setHeld(on) {
      held = !!on;
      if (held && !under && canDive()) start();
    },
    isHeld: () => held,
    isUnder: () => under,
    /** Where the head is (a spot just ahead of the body's middle, the way they face). */
    headPos: (out) => out.copy(head),
    shoot,
    /** An arrow out on its string (no other shot till it's back / the fish is landed). */
    lineOut: () => !!shot,
    isHooked: () => shot?.phase === 'hooked',
    canDive,
    end,
    clear() { end(); held = false; look.clear(); },
    debug: () => ({ under, held, speed, shot: shot && { phase: shot.phase, pos: shot.pos.clone(), fish: !!shot.fish }, yaw: ride.yaw, pitch: aimPitch, shownPitch: ride.pitch, center: center.clone(), gyroOn,
      cameraUnder: look.isCameraUnder(), fish: look.fishCount(), start, end, fishAt: look.fishAt }),
  };
}

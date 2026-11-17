// The giant troll of Tree Island (`giant.glb`, Mixamo-rigged, no clips of its own — it plays the
// shared walk / idle clips, slowed down to ANIM_RATE). About 20× the player's height, it wanders
// the island at random: walks to a random spot on its land, looks round a while, sets off again.
// Nothing stops it — houses, trees and rocks are walked through; it follows the island's terrain
// alone (a raycast on the island's `terrain` mesh, so it never steps up onto a roof), and keeps
// off the sea (targets and the ground just ahead must be land).
//
// Footfalls: each foot's height over the giant's ground is tracked; coming down past a low mark
// after being lifted past a high one is a step — `onStep(worldPos)` (bootstrapGameApp.js: a camera
// shake like a bomb's, by distance — hitFeel 'giantStep', and a thud).
//
// Climbing (cheap): the body is a handful of capsules, one per limb / torso piece, each between two
// bones, radius measured once from the skinned mesh (the 60th percentile of the vertices nearest
// it). On it the player is a point (segment, t along it, θ round it) in that bone's frame, so they
// move with the giant. The stick's up / down / left / right (and diagonals) is the move wanted on
// screen — world up × the camera's right — projected onto the capsule's surface: along the limb and
// round it. Passing a capsule's end hops onto the next one (`ends`: leg → thigh → torso → chest →
// head / arms), the jump eased out (SWITCH_BLEND_S). Walking into a leg (or any piece in reach) head
// on grabs it; down at the foot near the ground steps off; jumping lets go. It's PlayerControls'
// `surfaceClimb` hook (`climbHook`) — it plays the wall-climb clip.
import * as THREE from 'three';
import { createGLBCharacterInstance, glbCharacterConfig } from '../models/glbCharacterModel.js';
import { createCartDust } from '../items/cart.js';

export const GIANT_MODEL_URL = glbCharacterConfig.giantUrl;
export const GIANT_HEIGHT = 16;    // m (the player is ≈ 0.8 m: 20×)
const ANIM_RATE = 0.35;            // the clips play this much slower
const WALK_SPEED = 1.7;            // m/s (about the slowed walk's stride at GIANT_HEIGHT)
const TURN_RATE = 0.2;             // rad/s
const TURN_WALK_MIN = 0.25;        // share of its speed kept while turning hard
const IDLE_CHANCE = 0.4;           // a target reached: stands a while…
const IDLE_S = [5, 14];            // …this long
const TARGET_REACHED = 8;          // m
const ROAM_SHARE = 0.9;            // of the island's radius targets are picked in
const LAND_MARGIN = 0.6;           // m over the sea a spot must be to count as land
const PROBE_AHEAD = 9;             // m: ground this far ahead must be land, or a new target
const PROBE_EVERY_S = 0.4;
const GROUND_RATE = 2.5;           // 1/s: easing to the ground's height

// Footfalls (× GIANT_HEIGHT over each foot's lowest lately)
const STEP_LO = 0.015;
const STEP_HI = 0.04;
const STEP_MIN_GAP_S = 0.5;

// Footfall dust (the cart's puffs — src/items/cart.js — giant-sized)
const DUST = { max: 64, life: [1.6, 2.6], size: [2.2, 4.2], rise: 0.9, spread: 1.2 };
const DUST_PUFFS = 10;             // a footfall
const DUST_OUT_SPEED = 2.6;        // m/s rolling out from the foot
// Kicks: the front of a foot swinging forward into the player
const KICK_MIN_SPEED = 0.8;        // m/s the foot moves the way the giant walks
const KICK_PLAYER_R = 0.3;         // m: the player's body
const KICK_COOLDOWN_S = 2;
const KICK_FOOT_SHARE = 0.6;       // of a shin's radius: the front of the foot

// Climbing
const CLIMB_SPEED = 2.2;           // m/s over its surface at full stick
const CLIMB_INPUT = 0.15;          // stick share that counts
const STANDOFF = 0.1;              // m: the hands' hold out from the capsule
const HANG = 0.45;                 // m: from the hold down to the feet
const GRAB_REACH = 0.5;            // m from the surface the player grabs on
const GRAB_HEAD_ON = 0.55;         // cos: walking toward it within this
const SWITCH_BLEND_S = 0.3;
const STEP_OFF_FEET = 0.3;         // m over the ground: going down here steps off
const CAM_FOLLOW = 1.4;            // 1/s: the camera yaw eases round behind the climber
// Standing on the head (up past the top of the head)
const HEAD_STAND_SHARE = 0.75;     // of the head's radius: the patch the player walks on
const HEAD_WALK_SPEED = 1.6;       // m/s
const ARM_LEAVE_MARGIN = 0.3;      // m out of an arm before it can be stepped onto again
const RADIUS_PERCENTILE = 0.6;
// Pieces: from bone a to bone b, turning with `frame`; `ends`: [past a, past b] — the pieces it
// goes on to ('ground' = steps off there); [tMin, tMax] of a → b
const SEGMENTS = [
  { key: 'shinL', a: 'LeftFoot', b: 'LeftLeg', frame: 'LeftLeg', ends: [['ground'], ['thighL']], t: [-0.35, 1] },
  { key: 'thighL', a: 'LeftLeg', b: 'LeftUpLeg', frame: 'LeftUpLeg', ends: [['shinL'], ['torso']], t: [0, 1] },
  { key: 'shinR', a: 'RightFoot', b: 'RightLeg', frame: 'RightLeg', ends: [['ground'], ['thighR']], t: [-0.35, 1] },
  { key: 'thighR', a: 'RightLeg', b: 'RightUpLeg', frame: 'RightUpLeg', ends: [['shinR'], ['torso']], t: [0, 1] },
  { key: 'torso', a: 'Hips', b: 'Spine2', frame: 'Spine', ends: [['thighL', 'thighR'], ['chest']], t: [0, 1] },
  { key: 'chest', a: 'Spine2', b: 'Neck', frame: 'Spine2', ends: [['torso'], ['head', 'armL', 'armR']], t: [0, 1] },
  { key: 'head', a: 'Neck', b: 'HeadTop_End', frame: 'Head', ends: [['chest'], []], t: [0, 0.9] },
  { key: 'armL', a: 'LeftArm', b: 'LeftForeArm', frame: 'LeftArm', ends: [['chest'], ['foreL']], t: [0, 1] },
  { key: 'foreL', a: 'LeftForeArm', b: 'LeftHand', frame: 'LeftForeArm', ends: [['armL'], []], t: [0, 1] },
  { key: 'armR', a: 'RightArm', b: 'RightForeArm', frame: 'RightArm', ends: [['chest'], ['foreR']], t: [0, 1] },
  { key: 'foreR', a: 'RightForeArm', b: 'RightHand', frame: 'RightForeArm', ends: [['armR'], []], t: [0, 1] },
];

const LEGS = new Set(['shinL', 'shinR', 'thighL', 'thighR']);
// Climbing up the body's sides runs into the arms hanging there: the hold steps onto the arm
const BODY = new Set(['torso', 'chest']);
const ARMS = ['armL', 'foreL', 'armR', 'foreR'];
const UP = new THREE.Vector3(0, 1, 0);
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _u = new THREE.Vector3();
const _ref = new THREE.Vector3();
const _bin = new THREE.Vector3();
const _tan = new THREE.Vector3();
const _p = new THREE.Vector3();
const _q = new THREE.Vector3();
const _r = new THREE.Vector3();
const _m = new THREE.Vector3();
const _cf = new THREE.Vector3();
const _cr = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _down = new THREE.Vector3(0, -1, 0);
const rand = (lo, hi) => lo + Math.random() * (hi - lo);
const angleDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

/**
 * @param {object} ctx
 * @param {THREE.Scene} ctx.scene
 * @param {() => ({ def, group } | null)} ctx.getIsland Tree Island's state while it's loaded and in the active map
 * @param {() => number} ctx.seaLevel world Y of the sea
 * @param {(x: number, z: number) => number} ctx.groundAt the player's ground (getTerrainHeight)
 * @param {(pos: THREE.Vector3) => void} [ctx.onStep] a foot came down
 */
export function createGiant(ctx) {
  let root = null;          // the character's container (in the scene)
  let character = null;
  let loading = null;
  let island = null;        // the island state it's on
  let terrain = null;       // its terrain mesh (the giant's ground)
  let segs = [];            // SEGMENTS with bones / radius / refLocal
  let segByKey = new Map();
  let feet = [];
  const pos = new THREE.Vector3();
  let yaw = 0;
  let groundY = null;
  let mode = 'idle';
  let modeT = 2;
  const target = new THREE.Vector3();
  let probeT = 0;
  let active = false;
  let climb = null;         // { seg, t, th, off: Vector3, offT }
  let steps = 0;            // footfalls so far (debug)
  let kicks = 0;
  let lastKick = 0;
  let kickRadius = 1.5;     // m: the front of a foot (from the shins' radius — measure())
  let dust = null;          // footfall dust (createCartDust)
  let headTopLift = 0;      // m from the head bone's end up to the top of the head
  const ray = new THREE.Raycaster();
  ray.firstHitOnly = true;

  // ── The island's ground ───────────────────────────────────────────────
  const terrainAt = (x, z) => {
    if (!terrain) return null;
    ray.set(_p.set(x, 400, z), _down);
    ray.far = 1000;
    const hit = ray.intersectObject(terrain, false)[0];
    return hit ? hit.point.y : null;
  };
  const isLand = (x, z) => {
    const y = terrainAt(x, z);
    return y != null && y > ctx.seaLevel() + LAND_MARGIN;
  };
  const pickTarget = () => {
    const { at, radius } = island.def;
    for (let i = 0; i < 30; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = Math.sqrt(Math.random()) * radius * ROAM_SHARE;
      const x = at.x + Math.cos(a) * d;
      const z = at.z + Math.sin(a) * d;
      if (Math.hypot(x - pos.x, z - pos.z) < 25) continue;
      if (isLand(x, z)) { target.set(x, 0, z); return true; }
    }
    return false;
  };

  // ── Building ──────────────────────────────────────────────────────────
  async function build(isl) {
    const { container, character: ch } = await createGLBCharacterInstance({
      url: GIANT_MODEL_URL, targetHeight: GIANT_HEIGHT, armIK: false,
    });
    ch.noRun = true;
    container.name = 'giant';
    container.traverse((o) => { if (o.isMesh) { o.frustumCulled = false; o.castShadow = true; } });
    island = isl;
    terrain = isl.group.getObjectByName('terrain');
    // A spot on its land to start from
    pos.set(isl.def.at.x, 0, isl.def.at.z);
    if (pickTarget()) pos.copy(target);
    groundY = terrainAt(pos.x, pos.z) ?? ctx.seaLevel();
    pos.y = groundY;
    yaw = Math.random() * Math.PI * 2;
    container.position.copy(pos);
    container.rotation.y = yaw;
    ctx.scene.add(container);
    container.updateMatrixWorld(true);
    root = container;
    character = ch;
    measure();
    ch.setMoving(false);
    pickTarget();
  }

  // The capsules' radii from the skinned mesh (its bind pose, before any clip)
  function measure() {
    const fl = character.fluffy;
    segs = SEGMENTS.map((s) => ({
      ...s, A: fl.getBone(s.a), B: fl.getBone(s.b), F: fl.getBone(s.frame), r: 0.5, len: 1, refLocal: new THREE.Vector3(1, 0, 0), d: [],
    })).filter((s) => s.A && s.B && s.F);
    segByKey = new Map(segs.map((s) => [s.key, s]));
    feet = ['Left', 'Right'].map((side) => ({
      bone: fl.getBone(`${side}Foot`), toe: fl.getBone(`${side}ToeBase`), tip: fl.getBone(`${side}Toe_End`),
      min: Infinity, armed: false, last: 0, prev: null,
    })).filter((f) => f.bone);
    root.updateMatrixWorld(true);
    const ends = segs.map((s) => ({ a: s.A.getWorldPosition(new THREE.Vector3()), b: s.B.getWorldPosition(new THREE.Vector3()) }));
    let mesh = null;
    let topY = -Infinity;
    root.traverse((o) => { if (o.isSkinnedMesh && !mesh) mesh = o; });
    if (mesh) {
      mesh.skeleton.update();
      const n = mesh.geometry.attributes.position.count;
      const v = new THREE.Vector3();
      for (let i = 0; i < n; i++) {
        mesh.getVertexPosition(i, v);
        v.applyMatrix4(mesh.matrixWorld);
        if (v.y > topY) topY = v.y;
        let best = -1, bestD = Infinity, bestT = 0;
        for (let k = 0; k < segs.length; k++) {
          const { a, b } = ends[k];
          _u.subVectors(b, a);
          const l2 = _u.lengthSq() || 1;
          const tt = _q.subVectors(v, a).dot(_u) / l2;
          const t = THREE.MathUtils.clamp(tt, 0, 1);
          const d = _q.copy(a).addScaledVector(_u, t).distanceTo(v);
          if (d < bestD) { bestD = d; best = k; bestT = tt; }
        }
        // (only the piece's middle: the feet / hands / joints past its ends would fatten it)
        if (best >= 0 && bestT > 0.1 && bestT < 0.9) segs[best].d.push(bestD);
      }
    }
    segs.forEach((s, k) => {
      s.d.sort((x, y) => x - y);
      s.r = s.d.length ? s.d[Math.floor(s.d.length * RADIUS_PERCENTILE)] : GIANT_HEIGHT * 0.04;
      s.d = null;
      const { a, b } = ends[k];
      _u.subVectors(b, a).normalize();
      // (a direction square to the piece, kept in its bone's frame)
      _ref.set(0, 0, 1);
      if (Math.abs(_ref.dot(_u)) > 0.8) _ref.set(1, 0, 0);
      _ref.addScaledVector(_u, -_ref.dot(_u)).normalize();
      s.F.getWorldQuaternion(_quat);
      s.refLocal.copy(_ref).applyQuaternion(_quat.invert());
    });
    // (the top of the head: the highest vertex over the head bone's end — where the player stands)
    const head = segByKey.get('head');
    if (head && Number.isFinite(topY)) headTopLift = Math.max(0, topY - head.B.getWorldPosition(_q).y);
    const shin = segByKey.get('shinL');
    if (shin) kickRadius = shin.r * KICK_FOOT_SHARE;
  }

  // A piece's frame this frame: _a, _b, _u (a → b, unit), its length, _ref / _bin square to it
  function frameOf(s) {
    s.A.getWorldPosition(_a);
    s.B.getWorldPosition(_b);
    _u.subVectors(_b, _a);
    s.len = _u.length() || 1;
    _u.divideScalar(s.len);
    s.F.getWorldQuaternion(_quat);
    _ref.copy(s.refLocal).applyQuaternion(_quat);
    _ref.addScaledVector(_u, -_ref.dot(_u));
    if (_ref.lengthSq() < 1e-6) _ref.set(1, 0, 0).addScaledVector(_u, -_u.x);
    _ref.normalize();
    _bin.crossVectors(_u, _ref);
  }
  // The hold on a piece (frameOf first) → out
  const holdOf = (s, t, th, out) => out.copy(_a).addScaledVector(_u, t * s.len)
    .addScaledVector(_ref, Math.cos(th) * (s.r + STANDOFF))
    .addScaledVector(_bin, Math.sin(th) * (s.r + STANDOFF));
  // Where a world point sits on a piece: { t, th, dist from its surface }
  function placeOn(s, p) {
    frameOf(s);
    const t = THREE.MathUtils.clamp(_q.subVectors(p, _a).dot(_u) / s.len, s.t[0], s.t[1]);
    _q.copy(_a).addScaledVector(_u, t * s.len);
    _r.subVectors(p, _q);
    _r.addScaledVector(_u, -_r.dot(_u));
    const th = Math.atan2(_r.dot(_bin), _r.dot(_ref));
    return { t, th, dist: _q.distanceTo(p) - s.r, rx: _r.x, rz: _r.z };
  }

  // ── Each frame ────────────────────────────────────────────────────────
  function update(dt, playerPos) {
    const isl = ctx.getIsland();
    if (!isl) {
      active = false;
      if (root) root.visible = false;
      return;
    }
    if (!root) {
      loading ??= build(isl).catch((err) => { console.warn('[giant] failed to load:', err); });
      return;
    }
    // (only drawn and moving while the island's land is drawn — _drawLand)
    active = isl.drawn !== false;
    root.visible = active;
    if (!active) { if (climb) climb = null; return; }

    // Wandering
    modeT -= dt;
    let speed = 0;
    if (mode === 'idle') {
      if (modeT <= 0) { if (pickTarget()) mode = 'walk'; else modeT = 3; }
    } else {
      const dx = target.x - pos.x;
      const dz = target.z - pos.z;
      const want = Math.atan2(dx, dz);
      const diff = angleDiff(want, yaw);
      yaw += THREE.MathUtils.clamp(diff, -TURN_RATE * dt, TURN_RATE * dt);
      speed = WALK_SPEED * Math.max(TURN_WALK_MIN, Math.cos(Math.min(Math.abs(diff), Math.PI / 2)));
      probeT -= dt;
      if (probeT <= 0) {
        probeT = PROBE_EVERY_S;
        if (!isLand(pos.x + Math.sin(yaw) * PROBE_AHEAD, pos.z + Math.cos(yaw) * PROBE_AHEAD)) {
          speed = 0;
          if (!pickTarget()) { mode = 'idle'; modeT = 2; }
        }
      }
      pos.x += Math.sin(yaw) * speed * dt;
      pos.z += Math.cos(yaw) * speed * dt;
      if (Math.hypot(dx, dz) < TARGET_REACHED) {
        if (Math.random() < IDLE_CHANCE) { mode = 'idle'; modeT = rand(...IDLE_S); } else pickTarget();
      }
    }
    const g = terrainAt(pos.x, pos.z);
    if (g != null) groundY = groundY == null ? g : groundY + (g - groundY) * (1 - Math.exp(-GROUND_RATE * dt));
    pos.y = groundY ?? pos.y;
    root.position.copy(pos);
    root.rotation.y = yaw;
    root.updateMatrixWorld();
    character.setMoving(mode === 'walk');
    character.animate(dt * ANIM_RATE);
    character.stepFluff?.(dt * ANIM_RATE);

    // Footfalls
    const lo = STEP_LO * GIANT_HEIGHT;
    const hi = STEP_HI * GIANT_HEIGHT;
    const now = performance.now() / 1000;
    for (const f of feet) {
      f.bone.getWorldPosition(_p);
      const h = _p.y - pos.y;
      f.min = Math.min(f.min + dt * 0.003 * GIANT_HEIGHT, h); // (creeps up slowly: the ground under it changes)
      if (h > f.min + hi) f.armed = true;
      else if (f.armed && h < f.min + lo) {
        f.armed = false;
        if (mode === 'walk' && now - f.last > STEP_MIN_GAP_S) {
          f.last = now;
          steps += 1;
          ctx.onStep?.(_p.clone().setY(pos.y), playerPos);
          // (dust puffing out round the foot — the cart's puffs, giant-sized)
          footDust(f, _p);
        }
      }
      kickCheck(f, dt, playerPos, now);
    }
    dust?.update(dt);
  }

  // A cloud of dust round a foot that's just come down (`at`: the foot bone, world)
  function footDust(f, at) {
    if (!dust) dust = createCartDust(ctx.scene, DUST);
    // (the middle of the sole: between the ankle and the toes)
    if (f.toe) f.toe.getWorldPosition(_q).lerp(at, 0.4); else _q.copy(at);
    const gy = terrainAt(_q.x, _q.z) ?? pos.y;
    const ring = GIANT_HEIGHT * 0.07;
    for (let i = 0; i < DUST_PUFFS; i++) {
      const a = (i / DUST_PUFFS) * Math.PI * 2 + Math.random() * 0.5;
      const cx = Math.sin(a), cz = Math.cos(a);
      const v = DUST_OUT_SPEED * (0.6 + Math.random() * 0.6);
      dust.emit(_q.x + cx * ring, gy, _q.z + cz * ring, cx * v, cz * v);
    }
  }

  // The front of a foot swinging forward (walking) into the player: a kick
  function kickCheck(f, dt, playerPos, now) {
    if (!f.toe || !playerPos || mode !== 'walk' || climb) { f.prev = null; return; }
    f.toe.getWorldPosition(_q);
    if (f.tip) f.tip.getWorldPosition(_r).lerp(_q, 0.5); else _r.copy(_q);
    const prev = f.prev ?? (f.prev = _r.clone());
    // (its speed the way the giant walks: the swinging foot, not the planted one)
    const fwd = ((_r.x - prev.x) * Math.sin(yaw) + (_r.z - prev.z) * Math.cos(yaw)) / Math.max(dt, 1e-4);
    prev.copy(_r);
    if (fwd < KICK_MIN_SPEED || now - lastKick < KICK_COOLDOWN_S) return;
    const reach = kickRadius + KICK_PLAYER_R;
    const dx = playerPos.x - _r.x;
    const dz = playerPos.z - _r.z;
    if (dx * dx + dz * dz > reach * reach) return;
    if (playerPos.y > _r.y + kickRadius || playerPos.y < _r.y - kickRadius - 1.5) return;
    lastKick = now;
    // (sent the way the giant walks, and out to the side the player's on)
    const side = Math.hypot(dx, dz) || 1;
    const dir = new THREE.Vector3(Math.sin(yaw) + (dx / side) * 0.5, 0, Math.cos(yaw) + (dz / side) * 0.5).normalize();
    kicks += 1;
    ctx.onKick?.(dir, _r.clone());
  }

  // ── Climbing (PlayerControls.surfaceClimb) ────────────────────────────
  function climbHook(ctrl, movement, dt) {
    if (!active || !root || !segs.length) { climb = null; return null; }
    const feetX = ctrl.playerX, feetY = ctrl.playerY, feetZ = ctrl.playerZ;
    if (!climb) {
      // (close enough to be worth a look: inside its reach round the body)
      if (Math.hypot(feetX - pos.x, feetZ - pos.z) > GIANT_HEIGHT * 0.7 || window.phoneSwordAirborne) return null;
      const mag = Math.hypot(movement.x, movement.z);
      _p.set(feetX, feetY + HANG, feetZ);
      let best = null;
      const inside = [];
      for (const s of segs) {
        const o = placeOn(s, _p);
        if (o.dist < GRAB_REACH && (!best || o.dist < best.o.dist)) best = { s, o };
        if (o.dist < 0 && LEGS.has(s.key)) inside.push(o);
      }
      // (head on: walking toward the piece grabs it)
      const rl = best ? Math.hypot(best.o.rx, best.o.rz) : 0;
      const grab = best && mag > CLIMB_INPUT && rl > 1e-3
        && -(movement.x * best.o.rx + movement.z * best.o.rz) / (rl * mag) >= GRAB_HEAD_ON;
      if (!grab) {
        // (otherwise the legs push the player out of them)
        for (const o of inside) {
          const l = Math.hypot(o.rx, o.rz);
          if (l > 1e-3) { ctrl.playerX += (o.rx / l) * -o.dist; ctrl.playerZ += (o.rz / l) * -o.dist; }
        }
        return null;
      }
      climb = { seg: best.s, t: best.o.t, th: best.o.th, off: new THREE.Vector3(), offT: 0 };
      // (from where they stand to the hold: eased)
      frameOf(climb.seg);
      holdOf(climb.seg, climb.t, climb.th, _q);
      climb.off.set(feetX, feetY, feetZ).sub(_q.addScaledVector(UP, -HANG));
      climb.offT = SWITCH_BLEND_S;
    }
    // Jumped (or blasted) off: let go — the jump code takes it from here
    if (window.phoneSwordAirborne) { climb = null; return null; }
    if (climb.stand) return standOnHead(ctrl, movement, dt);

    const s = climb.seg;
    frameOf(s);
    // The stick → the move wanted on screen (world up × the camera's right), onto the surface
    ctrl.camera.getWorldDirection(_cf);
    _cf.y = 0;
    if (_cf.lengthSq() < 1e-8) _cf.set(Math.sin(ctrl.yaw), 0, Math.cos(ctrl.yaw));
    _cf.normalize();
    _cr.crossVectors(_cf, UP).normalize();
    const f = movement.x * _cf.x + movement.z * _cf.z;
    const sd = movement.x * _cr.x + movement.z * _cr.z;
    const mag = Math.min(1, Math.hypot(f, sd));
    const moving = mag > CLIMB_INPUT;
    if (moving) {
      _m.copy(_cr).multiplyScalar(sd).addScaledVector(UP, f);
      const rr = s.r + STANDOFF;
      _tan.copy(_ref).multiplyScalar(-Math.sin(climb.th)).addScaledVector(_bin, Math.cos(climb.th));
      // (along / round it, at full speed whatever the slope — a hunched back climbs as quick)
      let mu = _m.dot(_u);
      let mt = _m.dot(_tan);
      const ml = Math.hypot(mu, mt);
      if (ml > 1e-3) { mu *= mag / ml; mt *= mag / ml; }
      const step = CLIMB_SPEED * dt;
      climb.t += (mu * step) / s.len;
      climb.th += (mt * step) / rr;
      // Down at the foot, near the ground: step off
      if (f < -0.3 && s.ends[0].includes('ground')) {
        holdOf(s, Math.max(s.t[0], climb.t), climb.th, _p).addScaledVector(UP, -HANG);
        const gy = ctx.groundAt(_p.x, _p.z);
        if (Number.isFinite(gy) && _p.y - gy < STEP_OFF_FEET) return letGo(ctrl, _p, gy);
      }
      const end = climb.t < s.t[0] ? 0 : climb.t > s.t[1] ? 1 : -1;
      if (end >= 0) {
        climb.t = THREE.MathUtils.clamp(climb.t, s.t[0], s.t[1]);
        let best = null;
        let from = null;
        const next = s.ends[end].filter((k) => k !== 'ground').map((k) => segByKey.get(k)).filter(Boolean);
        if (next.length) {
          holdOf(s, climb.t, climb.th, _p);
          from = _p.clone();
          const mLen = _m.length() || 1;
          for (const n of next) {
            const o = placeOn(n, from);
            // (the piece the push carries on into: entering at its a end goes +u, at b −u —
            // a hanging arm isn't where "up" off the chest leads)
            const inward = (o.t - n.t[0] < n.t[1] - o.t ? 1 : -1) * _m.dot(_u) / mLen;
            const score = o.dist - inward * n.len;
            if (!best || score < best.score) best = { n, o, score, inward };
          }
          // (a hanging arm against the push: not that way — stays at the shoulder)
          if (best.inward < -0.3 && ARMS.includes(best.n.key)) { frameOf(s); best = null; }
        }
        // Up past the top of the head: standing on it
        if (!next.length && s.key === 'head' && end === 1 && f > 0.3) {
          holdOf(s, climb.t, climb.th, _p).addScaledVector(UP, -HANG);
          return startStand(ctrl, _p, dt);
        }
        if (next.length && best) {
          const n = best.n;
          const span = n.t[1] - n.t[0];
          climb.seg = n;
          climb.t = THREE.MathUtils.clamp(best.o.t, n.t[0] + span * 0.02, n.t[1] - span * 0.02);
          climb.th = best.o.th;
          // (the hop between the two surfaces eased out)
          frameOf(n);
          holdOf(n, climb.t, climb.th, _q);
          climb.off.add(from.sub(_q));
          climb.offT = SWITCH_BLEND_S;
          // (off an arm onto the body: not straight back onto that arm)
          if (ARMS.includes(s.key)) climb.armBlock = s.key;
        } else frameOf(s);
      }
      if (BODY.has(climb.seg.key)) armSnap();
    }
    const cur = climb.seg;
    holdOf(cur, climb.t, climb.th, _p);
    // The body faces into the surface (kept when it's straight above / below)
    _r.subVectors(_p, _q.copy(_a).addScaledVector(_u, climb.t * cur.len));
    const rh = Math.hypot(_r.x, _r.z);
    if (rh > 0.25 * _r.length()) climb.yaw = Math.atan2(-_r.x, -_r.z);
    climb.yaw ??= ctrl.yaw;
    if (climb.offT > 0) {
      climb.offT = Math.max(0, climb.offT - dt);
      climb.off.multiplyScalar(climb.offT / (climb.offT + dt));
    } else climb.off.set(0, 0, 0);
    _p.addScaledVector(UP, -HANG).add(climb.off);
    // (never under the ground — a foot on it)
    const gy = ctx.groundAt(_p.x, _p.z);
    if (Number.isFinite(gy) && _p.y < gy) _p.y = gy;
    // The camera eases round behind the climber
    if (moving) ctrl.yaw += angleDiff(climb.yaw, ctrl.yaw) * (1 - Math.exp(-CAM_FOLLOW * dt));
    return { x: _p.x, y: _p.y, z: _p.z, yaw: climb.yaw, moving };
  }

  // On the body with the hold run into an arm hanging beside it: onto the arm's outer side
  function armSnap() {
    const body = climb.seg;
    frameOf(body);
    holdOf(body, climb.t, climb.th, _p);
    // (straight out from the body there: the arm's side facing away from it)
    _r.subVectors(_p, _q.copy(_a).addScaledVector(_u, climb.t * body.len));
    _r.addScaledVector(_u, -_r.dot(_u)).normalize();
    const hold = _p.clone();
    const out = _r.clone();
    let hit = null;
    for (const k of ARMS) {
      const arm = segByKey.get(k);
      if (!arm) continue;
      const o = placeOn(arm, hold);
      if (climb.armBlock === k) {
        if (o.dist > ARM_LEAVE_MARGIN) climb.armBlock = null;
        continue;
      }
      if (o.dist < 0 && (!hit || o.dist < hit.o.dist)) hit = { arm, o };
    }
    if (!hit) { frameOf(body); return; }
    const { arm } = hit;
    const o = placeOn(arm, _p.copy(hold).addScaledVector(out, arm.r * 3));
    climb.seg = arm;
    climb.t = o.t;
    climb.th = o.th;
    frameOf(arm);
    holdOf(arm, climb.t, climb.th, _q);
    climb.off.add(hold.sub(_q));
    climb.offT = SWITCH_BLEND_S;
  }

  // ── Standing on top of the head ───────────────────────────────────────
  // The spot is kept in the head bone's frame (so it goes where the head goes); walking moves it
  // in the world, kept within the top's patch — walking off its edge goes back to hanging on
  // the head's side there.
  const headTopCenter = (out) => {
    const head = segByKey.get('head');
    return head.B.getWorldPosition(out).addScaledVector(UP, headTopLift);
  };
  function startStand(ctrl, p, dt) {
    const head = segByKey.get('head');
    const c = headTopCenter(new THREE.Vector3());
    // (a little in from the edge, on the side they came up)
    _r.set(p.x - c.x, 0, p.z - c.z);
    const R = head.r * HEAD_STAND_SHARE;
    if (_r.lengthSq() > 1e-6) _r.normalize().multiplyScalar(R * 0.6);
    const at = c.clone().add(_r);
    climb.off.add(p.clone().sub(at));
    climb.offT = SWITCH_BLEND_S;
    climb.stand = { local: head.F.worldToLocal(at.clone()), yaw: climb.yaw ?? ctrl.yaw };
    return standOnHead(ctrl, { x: 0, z: 0 }, dt);
  }
  function standOnHead(ctrl, movement, dt) {
    const head = segByKey.get('head');
    const st = climb.stand;
    const c = headTopCenter(new THREE.Vector3());
    const at = head.F.localToWorld(_p.copy(st.local));
    const mag = Math.min(1, Math.hypot(movement.x, movement.z));
    const moving = mag > CLIMB_INPUT;
    if (moving) {
      at.x += movement.x * HEAD_WALK_SPEED * dt;
      at.z += movement.z * HEAD_WALK_SPEED * dt;
      st.yaw = Math.atan2(movement.x, movement.z);
    }
    const R = head.r * HEAD_STAND_SHARE;
    const dx = at.x - c.x, dz = at.z - c.z;
    const d = Math.hypot(dx, dz);
    if (d > R) {
      if (moving && (movement.x * dx + movement.z * dz) > 0) {
        // Off the edge: back to hanging on the head's side there, facing it
        const o = placeOn(head, _q.set(c.x + dx / d * (head.r + 1), c.y - headTopLift, c.z + dz / d * (head.r + 1)));
        const from = _q.set(at.x, c.y, at.z).clone();
        climb.stand = null;
        climb.seg = head;
        climb.t = head.t[1] - 0.02;
        climb.th = o.th;
        frameOf(head);
        holdOf(head, climb.t, climb.th, _r).addScaledVector(UP, -HANG);
        climb.off.add(from.sub(_r));
        climb.offT = SWITCH_BLEND_S;
        climb.yaw = Math.atan2(-dx, -dz);
        return { x: from.x + _r.x, y: from.y + _r.y, z: from.z + _r.z, yaw: climb.yaw, moving: true };
      }
      at.x = c.x + (dx / d) * R;
      at.z = c.z + (dz / d) * R;
    }
    at.y = c.y;
    st.local.copy(head.F.worldToLocal(at.clone()));
    if (climb.offT > 0) {
      climb.offT = Math.max(0, climb.offT - dt);
      climb.off.multiplyScalar(climb.offT / (climb.offT + dt));
    } else climb.off.set(0, 0, 0);
    at.add(climb.off);
    return { x: at.x, y: at.y, z: at.z, yaw: st.yaw, moving, standing: true };
  }

  function letGo(ctrl, p, gy) {
    climb = null;
    // (a little way out from the foot, on the ground)
    _r.set(p.x - pos.x, 0, p.z - pos.z);
    if (_r.lengthSq() > 1e-6) _r.normalize().multiplyScalar(0.3);
    ctrl.playerX = p.x + _r.x;
    ctrl.playerZ = p.z + _r.z;
    ctrl.playerY = gy;
    return null;
  }

  // Let go wherever they are (a mode change, a teleport): they fall
  function release(ctrl) {
    if (!climb) return;
    climb = null;
    ctrl?.onLedgeFall?.();
  }

  const debug = () => ({
    root, character, pos, segs, climb, mode, target, island, active, steps, kicks,
    feet: feet.map((f) => ({ min: f.min, armed: f.armed, h: f.bone.getWorldPosition(new THREE.Vector3()).y - pos.y })),
    teleportNear: (x, z) => { pos.set(x, pos.y, z); groundY = null; },
    stop: () => { mode = 'idle'; modeT = 1e9; },
    go: () => { mode = 'idle'; modeT = 0; },
  });

  return {
    update,
    climbHook,
    release,
    isClimbing: () => !!climb,
    isStandingOnHead: () => !!climb?.stand,
    debug,
  };
}

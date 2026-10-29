import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { stylizeObject } from '../environment/artStyle.js';
import { glbCharacterConfig } from '../models/glbCharacterModel.js';

// Town's flying broom (broom.glb), bought from the wizard (townEconomy.js WIZARD_WARES).
//
// The model: the stick along its own Z, the bristles at one end. createBroomModel(length) fits a
// copy to `length` m with the handle toward +Z and the bristles toward −Z, its origin on the
// stick where the rider sits (a little ahead of the bristles).
//
// Riding it (createBroomRide): the player sits on it (glbCharacterConfig.sitClip, a looping
// pose — GLBCharacter.playPose), floating BROOM_HOVER over the ground (or the water, or a roof).
// Tilting the phone leans the broom's drift that way, as far as it's tilted (TILT_DEAD …
// TILT_FULL): forward / back / left / right of how the phone was held when the player got on (or
// last recalibrated) — the lean of the rotation's up since then (ctx.getTilt), so it reads the
// same however the phone is held. The drift eases toward that (ACCEL) and the broom turns
// toward the way it's drifting (TURN_RATE), so a held sideways tilt flies a circle. Leaning back
// (more than TURN_MAX_ANGLE from forward) turns it round: the way behind it then is locked in
// (`backDir`) and it turns toward that (U_TURN_RATE), slow at first (BACK_SPEED), then flying on
// that way for as long as the lean is held back. The camera eases round behind it (CAM_FOLLOW),
// waiting a moment after the player turns it by hand, and draws back with the speed
// (CAM_BACK + CAM_BACK_PER_SPEED — controls.js `ride.camDist`). The joystick / WASD lean it the same way (the only way
// without a gyro). The player's controls stand still meanwhile (`holdStill`, `ride` —
// controls.js): this moves them. It rises quickly but comes down gently: after going up it holds
// that height SINK_HOLD_S, then sinks, speeding up to at most SINK_MAX_SPEED.
// Boost (setBoost — while the Boost button / the phone's / Shift is held): it flies forward by
// itself, BOOST_SPEED× faster, the sideways lean steering; the fore / aft lean is height then —
// leaning back climbs, forward dives (BOOST_CLIMB_RATE, up to BOOST_MAX_LIFT over the hover
// height) — BOOST_MANA_PER_S mana a second (ctx.spendMana) — off when the mana runs out; purple
// streams swirl off the bristles meanwhile (TRAIL_*). Let go: it holds its height, then sinks
// back down as above.
export const BROOM_MODEL_URL = '/assets/props/broom.glb';
export const BROOM_LENGTH = 1.25;          // m (the characters are ~1 m tall)
const SEAT_AHEAD = 0.12;                   // × length: the seat ahead of the model's middle (toward the handle)
export const BROOM_SEAT_TO_END = 0.5 + SEAT_AHEAD; // × length: the seat to the bristles' end

export const BROOM_HOVER = 0.45;           // m of air under the rider's feet
const BOB_HEIGHT = 0.04;                   // m
const BOB_RATE = 2.1;                      // rad/s
const MAX_SPEED = 6.5;                     // m/s at full tilt
const BACK_SPEED = 0.5;                    // × MAX_SPEED drifting backward
const ACCEL = 1.4;                         // 1/s — how fast the drift follows the tilt
const TURN_RATE = 0.9;                     // 1/s × the angle to the drift (at full speed)
const TURN_MIN_SPEED = 0.35;               // m/s — slower: it doesn't turn
const TURN_MAX_ANGLE = 1.9;                 // rad — leaning further back than this: turning round
const U_TURN_RATE = 1.7;                   // rad/s turning round
const BACK_RELEASE = 0.15;                 // the lean's back part under this: done turning round
const TILT_DEAD = 0.1;                     // sin of the tilt — under this, no lean
const TILT_FULL = 0.5;                     // full lean (~30°)
const LOOK_AHEAD = [0.6, 1.4];             // s of drift ahead whose ground it rises for
const RISE_RATE = 5;                       // 1/s easing up to the hover height
const SINK_HOLD_S = 0.5;                   // s at the same height before sinking back down
const SINK_RATE = 0.8;                     // 1/s easing down
const SINK_ACCEL = 0.8;                    // m/s² — how fast the sinking speeds up
const SINK_MAX_SPEED = 0.9;                // m/s
const BOOST_CLIMB_RATE = 4;                // m/s climbing / diving at full lean while boosting
const BOOST_MAX_LIFT = 15;                 // m over the hover height at most
const BOOST_SPEED = 1.6;                   // × the speed (flying forward by itself)
const BOOST_HEIGHT_RATE = 4;               // 1/s easing to the boost's height (up or down)
const BOOST_MANA_PER_S = 1;
const BANK = 0.06;                         // rad of roll per m/s sideways
const PITCH = 0.025;                       // rad of lean forward per m/s forward
const CAM_FOLLOW = 2;                      // 1/s — the camera swinging round behind it
const CAM_MANUAL_S = 1.5;                  // s after the player turns the camera by hand
const CAM_BACK = 0.6;                      // m further back on the broom
const CAM_BACK_PER_SPEED = 0.25;           // m further back per m/s
const CAM_BACK_RATE = 1.5;                 // 1/s easing the distance
const TRAIL_STREAMS = 3;                   // purple streams while boosting
const TRAIL_PER_S = 40;                    // specks a second per stream
const TRAIL_LIFE = 0.8;                    // s
const TRAIL_SPIN = 9;                      // rad/s the streams wind round the broom
const TRAIL_SWIRL = 4;                     // rad/s a speck keeps winding after
const TRAIL_RADIUS = [0.08, 0.45];         // m from the broom's line: new … old
const TRAIL_MAX = 200;
const TRAIL_COLORS = [0xb34dff, 0xe08cff, 0x7a3dff];
const SEAT_DROP = 0.07;                    // m under the hips bone
const HIPS_FALLBACK = 0.42;                // m over the feet (a rig without a Hips bone)
const TELEPORT_DIST = 1.5;                 // m moved by someone else in a frame: follow it

// ── The model ──
let templatePromise = null;
const procedural = () => {
  const g = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: 0x7a5230, roughness: 1, metalness: 0 });
  const straw = new THREE.MeshStandardMaterial({ color: 0xd9b45a, roughness: 1, metalness: 0 });
  const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1, 8), wood);
  stick.rotation.x = Math.PI / 2;
  stick.position.z = 0.15;
  const brush = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.35, 10), straw);
  brush.rotation.x = Math.PI / 2;
  brush.position.z = -0.45;
  g.add(stick, brush);
  return g;
};
// The GLB, fitted: 1 m long along Z, bristles toward −Z, centred (the procedural one if it fails)
const loadTemplate = () => {
  if (!templatePromise) {
    templatePromise = new GLTFLoader().loadAsync(BROOM_MODEL_URL)
      .then((gltf) => {
        const model = gltf.scene;
        stylizeObject(model, { materials: false });
        model.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
        model.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(model);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        // (its long axis: Z in this model — turned onto Z if a re-export moves it)
        const axis = size.x > size.z && size.x > size.y ? 'x' : size.y > size.z ? 'y' : 'z';
        const len = size[axis] || 1;
        const brush = model.getObjectByName('Brush');
        const brushAt = brush ? new THREE.Box3().setFromObject(brush).getCenter(new THREE.Vector3())[axis] : center[axis] + 1;
        const holder = new THREE.Group();
        const inner = new THREE.Group();
        inner.add(model);
        model.position.sub(center);
        inner.scale.setScalar(1 / len);
        if (axis === 'x') inner.rotation.y = -Math.PI / 2;      // +X → +Z
        else if (axis === 'y') inner.rotation.x = Math.PI / 2;  // +Y → +Z
        holder.add(inner);
        // (bristles toward −Z)
        if (brushAt > center[axis]) holder.rotation.y = Math.PI;
        const root = new THREE.Group();
        root.add(holder);
        return root;
      })
      .catch((error) => {
        console.warn('Failed to load the broom.', error);
        return procedural();
      });
  }
  return templatePromise;
};

/** A copy of the broom `length` m long: handle toward +Z, origin on the seat. */
export async function createBroomModel(length = BROOM_LENGTH) {
  const template = await loadTemplate();
  const group = new THREE.Group();
  group.name = 'broom';
  const copy = template.clone(true);
  copy.scale.setScalar(length);
  copy.position.z = -SEAT_AHEAD * length;
  group.add(copy);
  return group;
}

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const ease = (rate, dt) => 1 - Math.exp(-rate * dt);
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();

// The boost's purple streams: specks left behind the bristles, winding round the broom's line
let _speckTexture = null;
const speckTexture = () => {
  if (_speckTexture) return _speckTexture;
  const cv = document.createElement('canvas');
  cv.width = cv.height = 32;
  const g = cv.getContext('2d');
  const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.4, 'rgba(255,255,255,0.5)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 32);
  _speckTexture = new THREE.CanvasTexture(cv);
  return _speckTexture;
};
function createBoostTrail(scene) {
  const pos = new Float32Array(TRAIL_MAX * 3);
  const col = new Float32Array(TRAIL_MAX * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setDrawRange(0, 0);
  const points = new THREE.Points(geo, new THREE.PointsMaterial({
    size: 0.14, map: speckTexture(), vertexColors: true, transparent: true,
    depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  points.frustumCulled = false;
  points.renderOrder = 2;
  points.visible = false;
  scene.add(points);
  const colors = TRAIL_COLORS.map((c) => new THREE.Color(c));
  const specks = [];             // { base, right, up, a, age, c }
  const last = new THREE.Vector3();
  let hasLast = false;
  let owed = 0;
  let spin = 0;
  const _p = new THREE.Vector3();
  // (on: specks come off `at`, the broom's line along `axis`)
  const update = (dt, on, at, axis) => {
    spin += TRAIL_SPIN * dt;
    if (on) {
      const right = new THREE.Vector3().crossVectors(axis, _p.set(0, 1, 0));
      if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
      right.normalize();
      const up = new THREE.Vector3().crossVectors(right, axis).normalize();
      if (!hasLast) last.copy(at);
      owed += TRAIL_PER_S * dt;
      const n = Math.floor(owed);
      owed -= n;
      for (let i = 0; i < n; i++) {
        const f = (i + 1) / n;
        for (let s = 0; s < TRAIL_STREAMS; s++) {
          if (specks.length >= TRAIL_MAX) specks.shift();
          specks.push({
            base: last.clone().lerp(at, f), right, up,
            a: spin - (1 - f) * TRAIL_SPIN * dt + (s * Math.PI * 2) / TRAIL_STREAMS,
            age: (1 - f) * dt, c: colors[s % colors.length],
          });
        }
      }
      last.copy(at);
      hasLast = true;
    } else {
      hasLast = false;
      owed = 0;
    }
    let k = 0;
    for (let i = 0; i < specks.length; i++) {
      const sp = specks[i];
      sp.age += dt;
      if (sp.age >= TRAIL_LIFE) continue;
      specks[k++] = sp;
      const u = sp.age / TRAIL_LIFE;
      const r = TRAIL_RADIUS[0] + (TRAIL_RADIUS[1] - TRAIL_RADIUS[0]) * u;
      const a = sp.a + sp.age * TRAIL_SWIRL;
      _p.copy(sp.base).addScaledVector(sp.right, Math.cos(a) * r).addScaledVector(sp.up, Math.sin(a) * r);
      const j = (k - 1) * 3;
      pos[j] = _p.x; pos[j + 1] = _p.y; pos[j + 2] = _p.z;
      const fade = (1 - u) * (1 - u);
      col[j] = sp.c.r * fade; col[j + 1] = sp.c.g * fade; col[j + 2] = sp.c.b * fade;
    }
    specks.length = k;
    geo.setDrawRange(0, k);
    geo.attributes.position.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
    points.visible = k > 0;
  };
  const clear = () => { specks.length = 0; hasLast = false; geo.setDrawRange(0, 0); points.visible = false; };
  return { update, clear };
}

/**
 * @param {object} ctx
 *  scene
 *  getControls() → PlayerControls, getPlayerModel() → the player's group
 *  getGroundY(x, z), getWaterY(x, z) → the water's surface there or null
 *  getTilt() → the gyro's lean { x (left +), z (forward +) } (sin of the tilt each way) or null (no gyro)
 *  getSteer() → the joystick / WASD { fwd, turn } (turn > 0 = right)
 *  spendMana(n) → true if the player had n mana (taken), false if not
 *  onBoostEnd() — the boost ran out of mana
 */
export function createBroomRide(ctx) {
  let riding = false;
  let broom = null;            // the model under the rider (loaded on the first ride)
  let loading = false;
  const st = { x: 0, z: 0, y: 0, vx: 0, vz: 0, yaw: 0, t: 0, dt: 0, camYaw: null, manualAt: -Infinity, bank: 0, pitch: 0, sinkAt: 0, sinkV: 0, backDir: null, camDist: 0 };
  let trail = null;            // the boost's purple streams (made on the first boost)
  let boosting = false;
  let boostPaid = 0;           // s of boost paid for (BOOST_MANA_PER_S a second, ahead)
  let boostLift = null;        // m over the hover height it's climbing to (null: from where it is)
  const ride = { y: 0, yaw: 0, camDist: 0 }; // (controls.ride)
  const hips = new THREE.Vector3(0, HIPS_FALLBACK, 0);
  let hipsMeasured = false;

  const glbOf = () => ctx.getPlayerModel()?.userData?.qwopRig?.glbCharacter ?? null;
  const floorAt = (x, z) => {
    const g = ctx.getGroundY(x, z);
    const w = ctx.getWaterY(x, z);
    const ground = Number.isFinite(g) ? g : 0;
    return w != null && w > ground ? w : ground;
  };

  const mount = () => {
    const c = ctx.getControls();
    if (riding || !c) return false;
    riding = true;
    Object.assign(st, { x: c.playerX, z: c.playerZ, y: c.playerY, vx: 0, vz: 0, yaw: c.yaw, camYaw: null, manualAt: -Infinity, bank: 0, pitch: 0, sinkAt: 0, sinkV: 0, backDir: null, camDist: 0 });
    ride.camDist = 0;
    boosting = false;
    ride.y = st.y;
    ride.yaw = st.yaw;
    c.ride = ride;
    c.holdStill = true;
    hipsMeasured = false;
    glbOf()?.playPose(glbCharacterConfig.sitClip);
    if (!broom && !loading) {
      loading = true;
      createBroomModel().then((m) => { broom = m; broom.visible = riding; ctx.scene.add(broom); });
    }
    if (broom) broom.visible = true;
    return true;
  };

  // Off it where it is (the player drops to the ground — the controls' ledge fall)
  const dismount = () => {
    if (!riding) return;
    riding = false;
    boosting = false;
    const c = ctx.getControls();
    if (c) {
      if (c.ride === ride) c.ride = null;
      c.holdStill = false;
    }
    glbOf()?.endPose();
    const pm = ctx.getPlayerModel();
    if (pm) { pm.rotation.x = 0; pm.rotation.z = 0; }
    if (broom) broom.visible = false;
    trail?.clear();
  };

  // Boost on / off (on: pays for its first second now; false without the mana)
  const setBoost = (on) => {
    if (!riding) return false;
    if (!on) { boosting = false; return true; }
    if (boosting) return true;
    if (!ctx.spendMana?.(BOOST_MANA_PER_S)) return false;
    boosting = true;
    boostPaid = 1;
    boostLift = null;
    if (!trail) trail = createBoostTrail(ctx.scene);
    return true;
  };

  // The lean asked for, broom-local { x (left +), z (forward +) }, length ≤ 1
  const input = () => {
    let ix = 0;
    let iz = 0;
    const tilt = ctx.getTilt();
    if (tilt) {
      const lean = Math.hypot(tilt.x, tilt.z);
      const k = lean > 1e-6 ? THREE.MathUtils.clamp((lean - TILT_DEAD) / (TILT_FULL - TILT_DEAD), 0, 1) / lean : 0;
      ix = tilt.x * k;
      iz = tilt.z * k;
    }
    const steer = ctx.getSteer();
    if (Math.abs(steer.fwd) > 0.1 || Math.abs(steer.turn) > 0.1) { ix -= steer.turn; iz += steer.fwd; }
    const l = Math.hypot(ix, iz);
    if (l > 1) { ix /= l; iz /= l; }
    return { ix, iz };
  };

  // Before the controls move the player: the drift, the turn, the height, the camera
  const update = (dt) => {
    if (!riding) return;
    const c = ctx.getControls();
    if (!c) return;
    dt = Math.min(0.1, Math.max(0, dt));
    st.t += dt;
    // (moved by someone else — a teleport: carry on from there)
    if (Math.hypot(c.playerX - st.x, c.playerZ - st.z) > TELEPORT_DIST) {
      Object.assign(st, { x: c.playerX, z: c.playerZ, y: c.playerY, vx: 0, vz: 0 });
    }
    // (boosting: paid a second at a time, ahead — off when the mana's gone)
    if (boosting) {
      boostPaid -= dt;
      if (boostPaid <= 0) {
        if (ctx.spendMana?.(BOOST_MANA_PER_S)) boostPaid += 1;
        else { boosting = false; ctx.onBoostEnd?.(); }
      }
    }
    const top = MAX_SPEED * (boosting ? BOOST_SPEED : 1);
    const { ix, iz } = input();
    const sy = Math.sin(st.yaw);
    const cy = Math.cos(st.yaw);
    let wantX;
    let wantZ;
    if (boosting) {
      // Flying forward by itself, the sideways lean steering (the fore / aft lean is height)
      st.backDir = null;
      const l = Math.hypot(ix, 1);
      wantX = ((ix * cy + sy) / l) * top;
      wantZ = ((-ix * sy + cy) / l) * top;
    } else {
      // Leaning back: turning round to fly the way that was behind it
      const lean = Math.hypot(ix, iz);
      const back = lean > 1e-3 && Math.abs(Math.atan2(ix, iz)) > TURN_MAX_ANGLE;
      if (st.backDir == null && back) st.backDir = wrap(st.yaw + Math.atan2(ix, iz));
      else if (st.backDir != null && !(iz < -BACK_RELEASE)) st.backDir = null;
      if (st.backDir != null) {
        const d = wrap(st.backDir - st.yaw);
        st.yaw = wrap(st.yaw + Math.sign(d) * Math.min(Math.abs(d), U_TURN_RATE * dt));
        // (slow while it's still facing away, full speed once round)
        const facing = Math.max(0, Math.cos(wrap(st.backDir - st.yaw)));
        const sp = Math.min(1, lean) * top * (BACK_SPEED + (1 - BACK_SPEED) * facing);
        wantX = Math.sin(st.backDir) * sp;
        wantZ = Math.cos(st.backDir) * sp;
      } else {
        const fwd = iz < 0 ? iz * BACK_SPEED : iz;
        // (broom-local +X = world (cos, −sin), +Z = world (sin, cos))
        wantX = (ix * cy + fwd * sy) * top;
        wantZ = (-ix * sy + fwd * cy) * top;
      }
    }
    const k = ease(ACCEL, dt);
    st.vx += (wantX - st.vx) * k;
    st.vz += (wantZ - st.vz) * k;
    const speed = Math.hypot(st.vx, st.vz);
    if (st.backDir == null && speed > TURN_MIN_SPEED) {
      const d = wrap(Math.atan2(st.vx, st.vz) - st.yaw);
      if (Math.abs(d) < TURN_MAX_ANGLE) st.yaw = wrap(st.yaw + d * ease(TURN_RATE * Math.min(1, speed / top), dt));
    }
    st.x += st.vx * dt;
    st.z += st.vz * dt;
    // Over the ground (or the water) here and a little ahead of the drift
    let floor = floorAt(st.x, st.z);
    for (const s of LOOK_AHEAD) floor = Math.max(floor, floorAt(st.x + st.vx * s, st.z + st.vz * s));
    if (boosting) {
      // Leaning back climbs, forward dives (from wherever it is)
      if (boostLift == null) boostLift = Math.max(0, st.y - floor - BROOM_HOVER);
      boostLift = THREE.MathUtils.clamp(boostLift - iz * BOOST_CLIMB_RATE * dt, 0, BOOST_MAX_LIFT);
      const target = floor + BROOM_HOVER + boostLift;
      st.y += (target - st.y) * ease(BOOST_HEIGHT_RATE, dt);
      st.sinkAt = st.t + SINK_HOLD_S;
      st.sinkV = 0;
    } else {
      const target = floor + BROOM_HOVER;
      if (target >= st.y - 0.02) {
        // Up (or level): quickly — then held there a moment before sinking
        st.y += Math.max(0, target - st.y) * ease(RISE_RATE, dt);
        st.sinkAt = st.t + SINK_HOLD_S;
        st.sinkV = 0;
      } else if (st.t >= st.sinkAt) {
        // Down: gently, the sinking speeding up to SINK_MAX_SPEED
        st.sinkV = Math.min(SINK_MAX_SPEED, st.sinkV + SINK_ACCEL * dt);
        st.y -= Math.min((st.y - target) * ease(SINK_RATE, dt), st.sinkV * dt);
      }
    }
    st.y = Math.max(st.y, floorAt(st.x, st.z) + 0.1);
    // Lean into it (sideways: bank; forward: nose down a little)
    const side = st.vx * cy - st.vz * sy;
    const ahead = st.vx * sy + st.vz * cy;
    st.bank += (-side * BANK - st.bank) * ease(4, dt);
    st.pitch += (ahead * PITCH - st.pitch) * ease(4, dt);

    c.playerX = st.x;
    c.playerZ = st.z;
    ride.y = st.y + Math.sin(st.t * BOB_RATE) * BOB_HEIGHT;
    ride.yaw = st.yaw;
    // The camera: round behind it (unless the player just turned it themselves)
    const now = st.t;
    if (st.camYaw != null && Math.abs(wrap(c.yaw - st.camYaw)) > 1e-4) st.manualAt = now;
    if (now - st.manualAt > CAM_MANUAL_S) c.yaw += wrap(st.yaw - c.yaw) * ease(CAM_FOLLOW, dt);
    st.camYaw = c.yaw;
    // (further back the faster it goes)
    st.camDist += (CAM_BACK + speed * CAM_BACK_PER_SPEED - st.camDist) * ease(CAM_BACK_RATE, dt);
    ride.camDist = st.camDist;
    st.dt = dt;
    // (another character picked meanwhile: sit it down too)
    glbOf()?.playPose(glbCharacterConfig.sitClip);
  };

  // After the controls placed the player: the lean, and the broom under the hips
  const afterControls = () => {
    if (!riding) return;
    const pm = ctx.getPlayerModel();
    if (!pm) return;
    pm.rotation.x = st.pitch;
    pm.rotation.z = st.bank;
    pm.updateMatrixWorld(true);
    // (the hips bone, the last frame's pose — in the player's own space)
    const bone = glbOf()?.fluffy?.getBone?.('Hips');
    if (bone) {
      pm.worldToLocal(bone.getWorldPosition(_v));
      if (Number.isFinite(_v.y)) {
        if (!hipsMeasured) hips.copy(_v);
        else hips.lerp(_v, 0.3);
        hipsMeasured = true;
      }
    }
    pm.getWorldQuaternion(_q);
    // (the boost's streams, off the bristles' end)
    if (trail) {
      const axis = _v.set(0, 0, 1).applyQuaternion(_q);
      const at = _v2.set(0, hips.y - SEAT_DROP, hips.z - BROOM_SEAT_TO_END * BROOM_LENGTH);
      pm.localToWorld(at);
      trail.update(st.dt, boosting, at, axis);
    }
    if (!broom) return;
    broom.position.set(0, hips.y - SEAT_DROP, hips.z);
    pm.localToWorld(broom.position);
    broom.quaternion.copy(_q);
  };

  return {
    mount,
    dismount,
    update,
    afterControls,
    isRiding: () => riding,
    setBoost,
    isBoosting: () => boosting,
  };
}

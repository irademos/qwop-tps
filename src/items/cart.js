import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { stylizeObject } from '../environment/artStyle.js';
import { pushOutOfObstacles } from '../environment/obstacles.js';
import { glbCharacterConfig } from '../models/glbCharacterModel.js';

// Town's cart (cart.glb — a wooden wagon, the pole at its front), parked in town (townCart.js).
//
// The model: its pole toward +Z (forward), two wheel pairs on axles along X (nodes
// `pCylinder8_wood_0` front / `pCylinder9_wood_0` back — spun here as it rolls; the GLB's own
// `rotate_wheels` clip isn't used). createCartModel() scales it by CART_SCALE with its origin on
// the ground midway between the axles.
//
// Riding it (createCartRide): the player crouches in its bed (glbCharacterConfig.crouchClip, a
// looping pose — GLBCharacter.playPose, the arms left on the IK so whatever's in hand is held).
// It stays on the ground, steered like the broom by the phone's lean from how it was held when
// the player got in (ctx.getTilt — the broom's tilt): tipped forward it rolls on (as fast as it's
// tipped), back it backs up (BACK_SPEED), leaned left / right it turns that way (TURN_RATE,
// gentler when slow — TURN_STILL at a stop). The joystick / WASD do the same (the only way
// without a gyro). It follows the ground under its wheels (tipping with slopes — pitch / roll),
// rolls a little downhill (SLOPE_PULL), and stops at what it can't roll over: ground ahead
// rising steeper than MAX_UP_SLOPE, a step up of more than MAX_STEP_UP (walls, houses, steps),
// water deeper than MAX_WADE, a tree trunk. Down it goes any way: a drop steeper than it can follow
// (FALL_STEP) and it's off the edge, falling with gravity (FALL_GRAVITY) until it lands. Dust
// cartoon dust puffs pop up behind its back wheels as it rolls (DUST_*). The camera eases round behind it.
// Holding something the gyro works (ctx.isHolding): the phone's busy with it, so the cart stops
// and the rider turns in the bed to face the camera's way (the cart stays put); put away, the
// phone's pose then is the new rest (ctx.onHoldEnd) — as on the broom.
export const CART_MODEL_URL = '/assets/props/cart.glb?v=1';
const CART_SCALE = 0.18;                    // model units → m (bed ~1.3 m long, ~0.95 m wide)
// (the model's own measurements, model units)
const MODEL_GROUND_Y = -1.2145;             // the wheels' bottom
const MODEL_AXLE_FRONT_Z = 3.1;
const MODEL_AXLE_BACK_Z = -1.37;
const MODEL_MID_Z = (MODEL_AXLE_FRONT_Z + MODEL_AXLE_BACK_Z) / 2;
const MODEL_WHEEL_X = 2.45;                 // the wheels' middles out from the centre line
const MODEL_WHEEL_R = 1.11;
const MODEL_BED_FRONT_Z = 4.4;              // the bed's ends (not the pole)
const MODEL_BED_BACK_Z = -2.9;
const MODEL_HALF_WIDTH = 2.65;
const MODEL_FLOOR_FALLBACK_Y = 0.25;        // the bed's floor (measured on load when it can be)

export const CART_WHEELBASE = (MODEL_AXLE_FRONT_Z - MODEL_AXLE_BACK_Z) * CART_SCALE;
export const CART_TRACK = MODEL_WHEEL_X * 2 * CART_SCALE;
export const CART_HALF_WIDTH = MODEL_HALF_WIDTH * CART_SCALE;
export const CART_FRONT = (MODEL_BED_FRONT_Z - MODEL_MID_Z) * CART_SCALE; // m ahead of the middle
export const CART_BACK = (MODEL_MID_Z - MODEL_BED_BACK_Z) * CART_SCALE;   // m behind it
const WHEEL_R = MODEL_WHEEL_R * CART_SCALE;
const STAND_Z = 0.05;                        // m: where the rider crouches, ahead of the middle

const MAX_SPEED = 5.4;                       // m/s at full tilt
const BACK_SPEED = 0.45;                     // × MAX_SPEED backing up
const ACCEL = 1.5;                           // 1/s — how fast the speed follows the tilt
const BRAKE = 3.5;                           // 1/s — slowing (no tilt, or the other way)
const TURN_RATE = 1.5;                       // rad/s at full sideways lean, rolling
const TURN_STILL = 0.55;                     // rad/s at full lean, stopped (pushed round)
const TURN_FULL_SPEED = 1.5;                 // m/s — at this speed or more it turns at TURN_RATE
const SLOPE_PULL = 2.5;                      // m/s² downhill per unit of slope along it
const MAX_UP_SLOPE = 0.9;                    // rise / run it rolls up (~42°) — ground ahead of it, the way it rolls (down: any)
const MAX_STEP_UP = 0.3;                     // m its middle can step up in one go (a kerb; more is a wall)
const TURN_SLOPE_SLACK = 0.6;                // turning on the spot: corners may rise this much steeper (it's already there)
const AIR_CLEAR = 0.1;                       // m — in the air, ground over its bottom by this much is a wall
const FALL_STEP = 0.12;                      // m a frame (+ FALL_STEP_PER_M × the distance rolled) it follows the ground down
const FALL_STEP_PER_M = 1.3;                 // … past that it's off an edge and falls
const FALL_GRAVITY = 18;                     // m/s² falling (the jump's gravity)
const FALL_TIP_RATE = 2.5;                   // 1/s — falling, the pitch / roll easing toward the ground under it
const HARD_LANDING = 4;                      // m/s down landing: a thud
// Dust behind the back wheels
const DUST_MAX = 64;                         // puffs alive at once
const DUST_PER_M = 2.6;                    // puffs a metre rolled (both wheels)
const DUST_MIN_SPEED = 0.4;                  // m/s — slower than this, none
const DUST_LIFE = [0.55, 0.85];              // s
const DUST_SIZE = [0.35, 0.7];              // m across at full size
const DUST_POP = 0.22;                       // share of its life popping in (overshooting)
const DUST_SHRINK = 0.4;                     // … and shrinking away at the end
const DUST_RISE = 0.45;                      // m/s up
const DUST_LIGHT = '#f4e6c8';                // its colours: lit,
const DUST_SHADE = '#d6bf94';                // shaded underside,
const DUST_OUTLINE = '#6e5638';              // outline
const MAX_WADE = 0.3;                        // m of water it rolls through
const TRUNK_PROBE_R = 0.12;                  // m: a corner this near a trunk is against it
const TILT_DEAD = 0.1;                       // sin of the tilt — under this, no lean
const TILT_FULL = 0.45;                      // full lean (~27°)
const SETTLE_RATE = 10;                      // 1/s easing the height / pitch / roll onto the ground
const CAM_FOLLOW = 2;                        // 1/s — the camera swinging round behind it
const CAM_MANUAL_S = 1.5;                    // s after the player turns the camera by hand
const CAM_BACK = 1.6;                        // m further back in the cart (it fills the view otherwise)
const RIDER_TURN_RATE = 8;                   // 1/s — holding something: the rider turning to the camera's way
const TELEPORT_DIST = 1.5;                   // m moved by someone else in a frame: get out

let templatePromise = null;
let floorY = MODEL_FLOOR_FALLBACK_Y;         // the bed's floor, model units
const loadTemplate = () => {
  if (!templatePromise) {
    templatePromise = new GLTFLoader().loadAsync(CART_MODEL_URL)
      .then((gltf) => {
        const root = gltf?.scene || null;
        if (!root) return null;
        stylizeObject(root, { materials: false });
        root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
        root.updateMatrixWorld(true);
        // (the bed's floor: straight down onto it, between the side rails, just behind the middle)
        const ray = new THREE.Raycaster(new THREE.Vector3(0, 10, MODEL_MID_Z - 0.3), new THREE.Vector3(0, -1, 0));
        const hit = ray.intersectObject(root, true).find((h) => h.point.y < 1.2 && h.point.y > MODEL_GROUND_Y + MODEL_WHEEL_R * 0.5);
        if (hit) floorY = hit.point.y;
        return root;
      })
      .catch((error) => {
        console.warn('Failed to load the cart.', error);
        templatePromise = null;
        return null;
      });
  }
  return templatePromise;
};

/**
 * The cart: { group (origin on the ground midway between the axles, pole toward +Z),
 * spin(m) — turns the wheels for `m` metres rolled, floorY() — the bed's floor over the origin, m }.
 */
export function createCartModel() {
  const group = new THREE.Group();
  group.name = 'cart';
  group.rotation.order = 'YXZ';
  const holder = new THREE.Group();
  holder.scale.setScalar(CART_SCALE);
  holder.position.set(0, -MODEL_GROUND_Y * CART_SCALE, -MODEL_MID_Z * CART_SCALE);
  group.add(holder);
  let wheels = [];
  let angle = 0;
  loadTemplate().then((template) => {
    if (!template) return;
    const copy = template.clone(true);
    holder.add(copy);
    wheels = ['pCylinder8_wood_0', 'pCylinder9_wood_0'].map((n) => copy.getObjectByName(n)).filter(Boolean);
    for (const w of wheels) w.rotation.x = angle;
  });
  return {
    group,
    spin: (m) => {
      angle = (angle + m / WHEEL_R) % (Math.PI * 2);
      for (const w of wheels) w.rotation.x = angle;
    },
    floorY: () => (floorY - MODEL_GROUND_Y) * CART_SCALE,
  };
}

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// Cartoon puffs (shared by every cart's dust): a little cloud of overlapping circles in a flat
// cream, darker underneath, a highlight on top and a dark outline — a few shapes for variety
const DUST_VARIANTS = 3;
let dustTextures = null;
const getDustTextures = () => {
  if (dustTextures) return dustTextures;
  dustTextures = [];
  for (let v = 0; v < DUST_VARIANTS; v++) {
    const S = 128;
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const g = c.getContext('2d');
    // (the cloud's circles: a big middle one and a few round it, fitting inside the canvas)
    const blobs = [[64, 70, 30]];
    const n = 3 + v;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + v * 0.7;
      const r = 17 + ((i * 7 + v * 5) % 9);
      blobs.push([64 + Math.cos(a) * 26, 68 + Math.sin(a) * 20, r]);
    }
    const shape = (grow) => {
      g.beginPath();
      for (const [x, y, r] of blobs) { g.moveTo(x + r + grow, y); g.arc(x, y, r + grow, 0, Math.PI * 2); }
    };
    g.fillStyle = DUST_OUTLINE;
    shape(4);
    g.fill();
    g.save();
    shape(0);
    g.clip();
    // (shaded all over, then the lit circles shifted up over it — a dark rim stays underneath)
    g.fillStyle = DUST_SHADE;
    g.fillRect(0, 0, S, S);
    g.fillStyle = DUST_LIGHT;
    g.beginPath();
    for (const [x, y, r] of blobs) { g.moveTo(x - 3 + r * 0.92, y - 7); g.arc(x - 3, y - 7, r * 0.92, 0, Math.PI * 2); }
    g.fill();
    // (highlight: a small spot up on the middle one)
    g.fillStyle = 'rgba(255,255,255,0.9)';
    g.beginPath();
    g.ellipse(52, 54, 9, 6, -0.5, 0, Math.PI * 2);
    g.fill();
    g.restore();
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    dustTextures.push(t);
  }
  return dustTextures;
};
// Pop in past its size and settle (an overshoot), then shrink away
const easeOutBack = (x) => 1 + 2.70158 * (x - 1) ** 3 + 1.70158 * (x - 1) ** 2;
const puffScale = (u) => (u < DUST_POP ? easeOutBack(u / DUST_POP)
  : u < 1 - DUST_SHRINK ? 1 + 0.12 * ((u - DUST_POP) / (1 - DUST_POP - DUST_SHRINK))
    : 1.12 * (1 - ((u - 1 + DUST_SHRINK) / DUST_SHRINK) ** 2));

/** Dust puffs: { emit(x, y, z, vx, vz), update(dt), clear() } — sprites in `parent`. */
function createCartDust(parent) {
  const pool = [];
  let next = 0;
  const textures = getDustTextures();
  for (let i = 0; i < DUST_MAX; i++) {
    // (crisp edges, drawn solid — alphaTest, no blending to sort)
    const mat = new THREE.SpriteMaterial({ map: textures[i % textures.length], alphaTest: 0.5, transparent: false });
    const sp = new THREE.Sprite(mat);
    sp.visible = false;
    sp.renderOrder = 2;
    parent.add(sp);
    pool.push({ sp, age: 0, life: 1, size: 1, vx: 0, vy: 0, vz: 0 });
  }
  return {
    emit(x, y, z, vx, vz) {
      const p = pool[next];
      next = (next + 1) % pool.length;
      p.age = 0;
      p.life = THREE.MathUtils.lerp(DUST_LIFE[0], DUST_LIFE[1], Math.random());
      p.size = THREE.MathUtils.lerp(DUST_SIZE[0], DUST_SIZE[1], Math.random());
      p.vx = vx + (Math.random() - 0.5) * 0.6;
      p.vz = vz + (Math.random() - 0.5) * 0.6;
      p.vy = DUST_RISE * (0.6 + Math.random() * 0.8);
      p.sp.position.set(x + (Math.random() - 0.5) * 0.2, y + p.size * 0.3, z + (Math.random() - 0.5) * 0.2);
      // (a little tilt, never upside down — the shade stays underneath)
      p.sp.material.rotation = (Math.random() - 0.5) * 0.6;
      p.sp.scale.set(0.001, 0.001, 1);
      p.sp.visible = true;
    },
    update(dt) {
      for (const p of pool) {
        if (!p.sp.visible) continue;
        p.age += dt;
        const u = p.age / p.life;
        if (u >= 1) { p.sp.visible = false; continue; }
        const drag = Math.exp(-3 * dt);
        p.vx *= drag;
        p.vz *= drag;
        p.sp.position.x += p.vx * dt;
        p.sp.position.y += p.vy * dt;
        p.sp.position.z += p.vz * dt;
        const k = Math.max(0.001, p.size * puffScale(u));
        p.sp.scale.set(k, k, 1);
      }
    },
    clear() { for (const p of pool) p.sp.visible = false; },
  };
}
const ease = (rate, dt) => 1 - Math.exp(-rate * dt);
const _v = new THREE.Vector3();

/**
 * @param {object} ctx
 *  parent — the group the cart's model goes in
 *  getControls() → PlayerControls, getPlayerModel() → the player's group
 *  getGroundY(x, z), waterDepth(x, z) → m of water there (0: dry)
 *  getTilt() → the gyro's lean { x (left +), z (forward +) } (sin of the tilt each way) or null (no gyro)
 *  getSteer() → the joystick / WASD { fwd, turn } (turn > 0 = right)
 *  isHolding() → true while a held item uses the gyro (the cart stops)
 *  onHoldEnd() — that item put away
 *  onBump() — rolled into something
 */
export function createCartRide(ctx) {
  const model = createCartModel();
  ctx.parent.add(model.group);
  const dust = createCartDust(ctx.parent);
  let dustDue = 0;
  const st = { vy: 0, air: false, x: 0, z: 0, yaw: 0, y: 0, pitch: 0, roll: 0, v: 0, riderYaw: 0, camYaw: null, manualAt: -Infinity, t: 0, settled: false, bumpAt: -Infinity };
  const ride = { y: 0, yaw: 0, camDist: 0 }; // (controls.ride)
  let riding = false;
  let holding = false;

  const glbOf = () => ctx.getPlayerModel()?.userData?.qwopRig?.glbCharacter ?? null;
  // Crouched (the arms left on the IK, so whatever's in hand is held); not over a one-shot
  // action (a bomb throw) — crouched again after it
  const crouch = () => {
    const g = glbOf();
    if (g && !(g.actionActive && !g._action?.pose)) g.playPose(glbCharacterConfig.crouchClip, { armIK: true });
  };
  const groundAt = (x, z) => {
    const g = ctx.getGroundY(x, z);
    return Number.isFinite(g) ? g : NaN;
  };
  // A point of the cart (cart-local: lx left +, lz forward +) in the world, for a pose
  const worldXZ = (x, z, yaw, lx, lz) => ({
    x: x + Math.cos(yaw) * lx + Math.sin(yaw) * lz,
    z: z - Math.sin(yaw) * lx + Math.cos(yaw) * lz,
  });
  const CORNERS = [[CART_HALF_WIDTH, CART_FRONT], [-CART_HALF_WIDTH, CART_FRONT], [CART_HALF_WIDTH, -CART_BACK], [-CART_HALF_WIDTH, -CART_BACK], [0, CART_FRONT], [0, -CART_BACK]];
  // Whether the cart fits at a pose. `roll` (rolling there): { dir — +1 forward / −1 back / 0
  // turning on the spot, y — its height now, air — in the air }; without it (parking) every
  // corner's slope counts. Rolling, only the ground ahead the way it goes counts: up it's
  // limited (MAX_UP_SLOPE, MAX_STEP_UP), down never — off an edge it falls.
  const fits = (x, z, yaw, roll = null) => {
    const mid = groundAt(x, z);
    if (!Number.isFinite(mid) || ctx.waterDepth(x, z) > MAX_WADE) return false;
    if (roll && !roll.air && mid - roll.y > MAX_STEP_UP) return false;
    for (const [lx, lz] of CORNERS) {
      const p = worldXZ(x, z, yaw, lx, lz);
      const g = groundAt(p.x, p.z);
      if (!Number.isFinite(g)) return false;
      const ahead = !roll || roll.dir === 0 || Math.sign(lz) === roll.dir;
      if (roll?.air) {
        // (the ground it's leaving is still under its back end)
        if (ahead && g > roll.y + AIR_CLEAR) return false;
      } else {
        const limit = roll?.dir === 0 ? MAX_UP_SLOPE + TURN_SLOPE_SLACK : MAX_UP_SLOPE;
        if (ahead && (g - mid) / Math.abs(lz) > limit) return false;
      }
      if (ctx.waterDepth(p.x, p.z) > MAX_WADE) return false;
      if (pushOutOfObstacles(p.x, p.z, g + 0.4, TRUNK_PROBE_R)) return false;
    }
    return true;
  };
  // Onto the ground under its wheels (instantly, or eased; down by as much as it can follow —
  // `moved` m rolled this frame — and off an edge it falls)
  const settle = (dt, moved = 0) => {
    const h = (lx, lz) => {
      const p = worldXZ(st.x, st.z, st.yaw, lx, lz);
      const g = groundAt(p.x, p.z);
      return Number.isFinite(g) ? g : st.y;
    };
    const hw = CART_TRACK / 2;
    const hb = CART_WHEELBASE / 2;
    const fl = h(hw, hb);
    const fr = h(-hw, hb);
    const bl = h(hw, -hb);
    const br = h(-hw, -hb);
    const front = (fl + fr) / 2;
    const back = (bl + br) / 2;
    const y = (front + back) / 2;
    const pitch = Math.atan2(back - front, CART_WHEELBASE); // (+: nose down)
    const roll = Math.atan2((fl + bl) / 2 - (fr + br) / 2, CART_TRACK); // (+: the left side up)
    if (!st.settled || !(dt > 0)) {
      Object.assign(st, { y, pitch, roll, vy: 0, air: false, settled: true });
      return null;
    }
    if (!st.air && st.y - y > FALL_STEP + FALL_STEP_PER_M * Math.abs(moved)) {
      // Off an edge: falling (going on down the slope it was on)
      st.air = true;
      st.vy = Math.min(0, -st.v * Math.sin(st.pitch));
    }
    if (st.air) {
      st.vy -= FALL_GRAVITY * dt;
      st.y += st.vy * dt;
      const kt = ease(FALL_TIP_RATE, dt);
      st.pitch += (pitch - st.pitch) * kt;
      st.roll += (roll - st.roll) * kt;
      if (st.y > y) return null;
      // Landed
      const hard = st.vy < -HARD_LANDING;
      Object.assign(st, { y, vy: 0, air: false });
      return hard ? 'thud' : null;
    }
    // On the ground: down at once (no lag to mistake for an edge), up eased
    st.y = y < st.y ? y : st.y + (y - st.y) * ease(SETTLE_RATE, dt);
    const k = ease(SETTLE_RATE, dt);
    st.pitch += (pitch - st.pitch) * k;
    st.roll += (roll - st.roll) * k;
    return null;
  };
  // Dust behind the back wheels, rolling on the ground (not in water)
  const kickDust = (moved, dt) => {
    if (st.air || Math.abs(st.v) < DUST_MIN_SPEED) { dustDue = 0; return; }
    dustDue += Math.abs(moved) * DUST_PER_M * Math.min(1.5, Math.abs(st.v) / MAX_SPEED + 0.4);
    const back = st.v >= 0 ? -1 : 1; // (kicked out behind the way it's going)
    const vx = Math.sin(st.yaw) * back * Math.abs(st.v) * 0.1;
    const vz = Math.cos(st.yaw) * back * Math.abs(st.v) * 0.1;
    while (dustDue >= 1) {
      dustDue -= 1;
      const side = Math.random() < 0.5 ? 1 : -1;
      const p = worldXZ(st.x, st.z, st.yaw, side * CART_TRACK / 2, st.v >= 0 ? -CART_WHEELBASE / 2 - WHEEL_R * 0.6 : CART_WHEELBASE / 2 + WHEEL_R * 0.6);
      if (ctx.waterDepth(p.x, p.z) > 0.02) continue;
      const g = groundAt(p.x, p.z);
      dust.emit(p.x, Number.isFinite(g) ? g : st.y, p.z, vx, vz);
    }
  };
  const placeModel = () => {
    model.group.position.set(st.x, st.y, st.z);
    model.group.rotation.set(st.pitch, st.yaw, st.roll);
  };
  // The bed's floor where the rider crouches, in the world
  const standPoint = (out = _v) => {
    out.set(0, model.floorY(), STAND_Z);
    model.group.updateMatrixWorld(true);
    return model.group.localToWorld(out);
  };

  /** Parks it at a pose (on the ground there). */
  const place = (x, z, yaw) => {
    Object.assign(st, { x, z, yaw, v: 0, settled: false });
    dust.clear();
    settle(0);
    placeModel();
  };

  const mount = () => {
    const c = ctx.getControls();
    if (riding || !c) return false;
    riding = true;
    holding = false;
    Object.assign(st, { v: 0, riderYaw: st.yaw, camYaw: null, manualAt: -Infinity });
    const s = standPoint();
    c.playerX = s.x;
    c.playerZ = s.z;
    c.playerY = s.y;
    c.yaw = st.yaw;
    ride.y = s.y;
    ride.yaw = st.yaw;
    ride.camDist = CAM_BACK;
    c.ride = ride;
    c.holdStill = true;
    crouch();
    return true;
  };

  // Out of it (the caller puts the player beside it)
  const dismount = () => {
    if (!riding) return;
    riding = false;
    st.v = 0;
    // (out mid-fall: it lands)
    if (st.air) { st.settled = false; settle(0); placeModel(); }
    const c = ctx.getControls();
    if (c) {
      if (c.ride === ride) c.ride = null;
      c.holdStill = false;
    }
    if (glbOf()?._action?.pose === glbCharacterConfig.crouchClip) glbOf()?.endPose();
    const pm = ctx.getPlayerModel();
    if (pm) { pm.rotation.x = 0; pm.rotation.z = 0; pm.rotation.order = 'XYZ'; }
  };

  // The lean asked for { ix (left +), iz (forward +) }, each −1 … 1
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
    return { ix: THREE.MathUtils.clamp(ix, -1, 1), iz: THREE.MathUtils.clamp(iz, -1, 1) };
  };

  // Before the controls move the player: the speed, the turn, the ground, the camera
  const update = (dt) => {
    dt = Math.min(0.1, Math.max(0, dt));
    dust.update(dt);
    if (!riding) return;
    const c = ctx.getControls();
    if (!c) return;
    st.t += dt;
    // (moved by someone else — a teleport: that's out of the cart)
    const s0 = standPoint();
    if (Math.hypot(c.playerX - s0.x, c.playerZ - s0.z) > TELEPORT_DIST) return 'left';
    const hold = !!ctx.isHolding?.();
    if (hold !== holding) {
      holding = hold;
      if (!hold) ctx.onHoldEnd?.();
    }
    const { ix, iz } = holding || st.air ? { ix: 0, iz: 0 } : input();
    // Speed: toward the lean (backing up slower), braking quicker; a little pull downhill
    const want = (iz >= 0 ? iz : iz * BACK_SPEED) * MAX_SPEED;
    const braking = Math.abs(want) < Math.abs(st.v) || want * st.v < 0;
    // (in the air: it keeps going as it was)
    if (!st.air) {
      st.v += (want - st.v) * ease(braking ? BRAKE : ACCEL, dt);
      if (!holding) st.v += Math.sin(st.pitch) * SLOPE_PULL * dt;
      if (Math.abs(st.v) < 0.02 && Math.abs(want) < 0.01) st.v = 0;
    }
    // Turning: the sideways lean (left +), quicker the faster it rolls
    const turnRate = TURN_STILL + (TURN_RATE - TURN_STILL) * Math.min(1, Math.abs(st.v) / TURN_FULL_SPEED);
    const yaw = wrap(st.yaw + ix * turnRate * dt);
    const step = st.v * dt;
    const nx = st.x + Math.sin(yaw) * step;
    const nz = st.z + Math.cos(yaw) * step;
    let moved = 0;
    const dir = Math.abs(step) < 1e-6 ? 0 : Math.sign(step);
    // (on the ground: steps up measured from the ground under its middle — not its wheels'
    // average, which sits under a crest; in the air: from its bottom)
    const fromY = st.air ? st.y : groundAt(st.x, st.z);
    if (fits(nx, nz, yaw, { dir, y: Number.isFinite(fromY) ? fromY : st.y, air: st.air })) {
      Object.assign(st, { x: nx, z: nz, yaw });
      moved = step;
      if (!st.air) model.spin(step);
    } else if (fits(st.x, st.z, yaw, { dir: 0, y: Number.isFinite(fromY) ? fromY : st.y, air: st.air })) {
      // (up against something: turning still works)
      st.yaw = yaw;
      if (Math.abs(st.v) > 1 && st.t - st.bumpAt > 0.6) { st.bumpAt = st.t; ctx.onBump?.(); }
      st.v = 0;
    } else {
      if (Math.abs(st.v) > 1 && st.t - st.bumpAt > 0.6) { st.bumpAt = st.t; ctx.onBump?.(); }
      st.v = 0;
    }
    if (settle(dt, moved) === 'thud' && st.t - st.bumpAt > 0.3) { st.bumpAt = st.t; ctx.onBump?.(); }
    kickDust(moved, dt);
    placeModel();
    const s = standPoint();
    c.playerX = s.x;
    c.playerZ = s.z;
    ride.y = s.y;
    // The rider: facing the cart's way — holding something, the camera's way (the gun / bow aims)
    if (holding) st.riderYaw = wrap(st.riderYaw + wrap(c.yaw - st.riderYaw) * ease(RIDER_TURN_RATE, dt));
    else st.riderYaw = wrap(st.riderYaw + wrap(st.yaw - st.riderYaw) * ease(RIDER_TURN_RATE, dt));
    ride.yaw = st.riderYaw;
    // The camera: round behind it (unless the player just turned it themselves, or is aiming)
    if (st.camYaw != null && Math.abs(wrap(c.yaw - st.camYaw)) > 1e-4) st.manualAt = st.t;
    if (!holding && st.t - st.manualAt > CAM_MANUAL_S) c.yaw += wrap(st.yaw - c.yaw) * ease(CAM_FOLLOW, dt);
    st.camYaw = c.yaw;
    ride.camDist = CAM_BACK;
    // (another character picked meanwhile: crouch it too)
    crouch();
    return null;
  };

  // After the controls placed the player: on the bed's floor, tipped with the cart
  const afterControls = () => {
    if (!riding) return;
    const pm = ctx.getPlayerModel();
    if (!pm) return;
    pm.position.copy(standPoint());
    pm.rotation.order = 'YXZ';
    // (the cart's tip, turned into the rider's frame when they face another way)
    const d = st.riderYaw - st.yaw;
    pm.rotation.set(st.pitch * Math.cos(d) - st.roll * Math.sin(d), st.riderYaw, st.roll * Math.cos(d) + st.pitch * Math.sin(d));
    pm.updateMatrixWorld(true);
  };

  return {
    place,
    fits,
    mount,
    dismount,
    update,
    afterControls,
    standPoint: () => standPoint(new THREE.Vector3()),
    // Spots round it (world) — where the player gets out: its sides, then behind / ahead
    sideSpots: (out = 1.0) => [
      worldXZ(st.x, st.z, st.yaw, CART_HALF_WIDTH + out, 0),
      worldXZ(st.x, st.z, st.yaw, -CART_HALF_WIDTH - out, 0),
      worldXZ(st.x, st.z, st.yaw, 0, -CART_BACK - out),
      worldXZ(st.x, st.z, st.yaw, 0, CART_FRONT + out),
    ],
    pose: () => ({ x: st.x, z: st.z, yaw: st.yaw }),
    group: model.group,
    isRiding: () => riding,
    isHolding: () => riding && holding,
  };
}

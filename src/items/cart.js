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
// soft dust puffs rise behind its back wheels as it rolls (DUST_*). The camera eases round behind it.
// A tree, or a slope too steep to climb, slides it past a little off to one side (slidePast).
// Ground falling away steeper than TUMBLE_SLOPE (near and further on — a ledge is a fall) sends
// it tumbling: the rider thrown out downhill, the cart rolling over and over down the steepest
// way till the ground's gentle, then lying on its side and righting itself like a flip.
// Stuck (pushing / steering, nothing moving for STUCK_S): down on its wheels and out of whatever's
// inside it (unstick). Left alone a while, townCart.js puts it back at its parking spot.
// Pushing into a wall or a tree it can't slide past, where it hits decides what it does
// (contactAt — its leading corners, the way it rolls):
//  - head on (both leading corners, or its middle): it rears up — the leading wheels ride up
//    the wall, pivoting on the trailing axle (st.rear, REAR_*), fast and harder the faster it hit
//    (REAR_IMPACT). Past REAR_SPIN_FROM it spins round on its trailing wheels (REAR_SPIN_RATE)
//    the way the phone leans (else the way it picked on hitting), so it can be turned round off
//    a wall; as it comes down it rolls back off the wall if it must. Pushing alone holds it at an
//    angle (REAR_PUSH < REAR_GRAVITY × sin(REAR_BALANCE)); a hard hit past REAR_FLIP goes over
//    sideways (the way it's spinning).
//  - one corner (a glancing hit): that side lifts — it rolls up onto the other side's wheels
//    (st.tip, TIP_*), pivoting on the low side's edge, its footprint narrowing (× cos of the tip)
//    so a tight gap may let it through, and it turns away from what it hit — or the way the phone
//    leans (TIP_SPIN_RATE). It comes down only as far as it still fits, wobbles rolling tipped,
//    past TIP_BALANCE goes on over. In an alley (both sides blocked while narrower) it stays up.
// Past TIP_FLIP it flips over: the rider is thrown out (update() → 'flip'), it falls onto its
// side, lies there FLIP_LIE_S and rights itself (FLIP_RIGHT_S) — nobody gets in meanwhile.
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
const MAX_UP_SLOPE = 1.2;                    // rise / run it rolls up (~50°) — ground ahead of it, the way it rolls (down: see TUMBLE_SLOPE)
const WALL_RISE = 1.0;                       // m — a corner's ground this far over its middle's is a wall, not a slope
const SLIDE_ANGLES = [0.35, 0.7, 1.05];      // rad off its heading tried, each way, to slide past a tree / up a slope
const SLIDE_KEEP = 0.85;                     // share of the speed kept sliding past
const TRUNK_SIDESTEP = 1.6;                  // m/s it shuffles sideways round a tree dead ahead
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
const DUST_PER_M = 2.6;                      // puffs a metre rolled (both wheels)
const DUST_MIN_SPEED = 0.5;                  // m/s — slower than this, none
const DUST_LIFE = [0.7, 1.1];                // s
const DUST_SIZE = [0.35, 0.6];               // m across, grown
const DUST_POP = 0.3;                        // share of its life swelling up
const DUST_FADE = 0.6;                       // … and fading out at the end
const DUST_OPACITY = 0.75;
const DUST_BLUR_PX = 4;                      // soft edges (of 128 px)
const DUST_RISE = 0.35;                      // m/s up
const DUST_LIGHT = '#e9dcc0';                // its colours: lit,
const DUST_SHADE = '#cdb894';                // a little darker underneath
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
// Stuck watchdog: pushing / steering with nothing moving this long → down on its wheels and, if it
// doesn't fit where it is (a trunk inside it), moved to the nearest spot it does
const STUCK_S = 0.8;
const UNSTICK_MAX_R = 1.8;                   // m searched round it
// Tipping up against what it can't pass / flipping over
const TIP_PUSH = 8;                          // rad/s² lifting at full push into something, flat …
const TIP_PUSH_TOP = 0.6;                    // … fading to none at this tip (so pushing holds it at ~0.45)
const TIP_GRAVITY = 5;                       // rad/s² × sin(tip − TIP_BALANCE): down below it, over above it
const TIP_BALANCE = 0.85;                    // rad (~49°) — the balance point
const TIP_FLIP = 1.15;                       // rad (~66°) — past this it goes over
const TIP_DAMP = 3;                          // 1/s
const TIP_WOBBLE = 4;                        // rad/s² of random wobble rolling tipped at full speed
const TIP_CLUNK_SPEED = 0.8;                 // rad/s coming back down onto its wheels: a thud
const FLIP_LIE = Math.PI / 2;                // rad — on its side
const FLIP_LIE_S = 1.6;                      // s lying there
const FLIP_RIGHT_S = 1.1;                    // s righting itself
const TIP_IMPACT = 3;                        // rad/s of tip from hitting at full speed
const TIP_SPIN_RATE = 1.6;                   // rad/s turning away (or the lean's way) tipped up
const TIP_SPIN_FROM = 0.12;                  // rad of tip before it turns
// Rearing up against a wall (head on)
const REAR_PUSH = 14;                        // rad/s² at full push, flat …
const REAR_PUSH_TOP = 0.75;                  // … fading to none at this (pushing holds it at ~0.5)
const REAR_IMPACT = 3.5;                     // rad/s from hitting at full speed
const REAR_GRAVITY = 8;                      // rad/s² × sin(rear − REAR_BALANCE)
const REAR_BALANCE = 1.1;                    // rad (~63°)
const REAR_FLIP = 1.3;                       // rad (~74°) — over it goes (sideways)
const REAR_DAMP = 3;                         // 1/s
const REAR_SPIN_FROM = 0.3;                  // rad reared before it spins
const REAR_SPIN_RATE = 3;                    // rad/s spinning on its trailing wheels
const REAR_SLIDE_STEP = 0.04;                // m a try rolling back off the wall coming down
// Tumbling down a very steep slope: the rider thrown out, the cart rolling over and over down it
const TUMBLE_SLOPE = 1.35;                   // drop / run (~53°) downhill, near and further on, that sends it over
const TUMBLE_NEAR = 0.6;                     // m — the slope measured this far out …
const TUMBLE_FAR = 1.5;                      // … and this far (a ledge is a fall, not a slope)
const TUMBLE_G = 14;                         // m/s² down a vertical slope (× sin of the slope)
const TUMBLE_DRAG = 0.6;                     // 1/s rolling
const TUMBLE_STOP_DRAG = 4;                  // 1/s once the ground's gentle
const TUMBLE_END_SLOPE = 0.35;               // ground gentler than this: it comes to a stop
const TUMBLE_R = 0.45;                       // m — the rolling cart's middle over the ground
const TUMBLE_MAX_S = 7;                      // s at most
const TUMBLE_SETTLE_S = 0.45;                // s rolling onto its side at the bottom

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

// Dust puffs (shared by every cart's dust): a little cloud of overlapping circles, soft-edged,
// a touch darker underneath — a few shapes for variety
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
    // (soft edges: the whole cloud drawn blurred)
    g.filter = `blur(${DUST_BLUR_PX}px)`;
    g.fillStyle = '#fff';
    shape(-2);
    g.fill();
    g.filter = 'none';
    g.save();
    g.globalCompositeOperation = 'source-atop';
    // (shaded all over, then the lit circles shifted up over it — a dark rim stays underneath)
    g.fillStyle = DUST_SHADE;
    g.fillRect(0, 0, S, S);
    g.fillStyle = DUST_LIGHT;
    g.beginPath();
    for (const [x, y, r] of blobs) { g.moveTo(x + r * 0.9, y - 6); g.arc(x, y - 6, r * 0.9, 0, Math.PI * 2); }
    g.filter = `blur(${DUST_BLUR_PX * 1.5}px)`;
    g.fill();
    g.restore();
    // (and faded toward its edge — soft even where the canvas can't blur, e.g. older Safari)
    const fade = g.createRadialGradient(64, 66, 28, 64, 66, 62);
    fade.addColorStop(0, 'rgba(0,0,0,1)');
    fade.addColorStop(1, 'rgba(0,0,0,0)');
    g.globalCompositeOperation = 'destination-in';
    g.fillStyle = fade;
    g.fillRect(0, 0, S, S);
    g.globalCompositeOperation = 'source-over';
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    dustTextures.push(t);
  }
  return dustTextures;
};
// Swells quickly, keeps spreading a little; fades in fast and out slowly
const puffScale = (u) => 0.45 + 0.55 * (1 - (1 - Math.min(1, u / DUST_POP)) ** 2) + 0.25 * u;
const puffOpacity = (u) => DUST_OPACITY * Math.min(1, u / 0.12) * (u < 1 - DUST_FADE ? 1 : (1 - u) / DUST_FADE);

/**
 * Dust puffs: { emit(x, y, z, vx, vz), update(dt), clear() } — sprites in `parent`. Options
 * (the cart's by default — the giant's footfalls use bigger, slower ones): max, life, size, rise,
 * spread (m/s of random sideways drift).
 */
export function createCartDust(parent, {
  max = DUST_MAX, life = DUST_LIFE, size = DUST_SIZE, rise = DUST_RISE, spread = 0.6,
} = {}) {
  const pool = [];
  let next = 0;
  const textures = getDustTextures();
  for (let i = 0; i < max; i++) {
    const mat = new THREE.SpriteMaterial({ map: textures[i % textures.length], transparent: true, depthWrite: false, opacity: 0 });
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
      p.life = THREE.MathUtils.lerp(life[0], life[1], Math.random());
      p.size = THREE.MathUtils.lerp(size[0], size[1], Math.random());
      p.vx = vx + (Math.random() - 0.5) * spread;
      p.vz = vz + (Math.random() - 0.5) * spread;
      p.vy = rise * (0.6 + Math.random() * 0.8);
      const jitter = p.size * 0.3;
      p.sp.position.set(x + (Math.random() - 0.5) * jitter, y + p.size * 0.3, z + (Math.random() - 0.5) * jitter);
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
        p.sp.material.opacity = puffOpacity(u);
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
  const st = { tip: 0, tipV: 0, tipSide: 1, rear: 0, rearV: 0, rearDir: 1, spinDir: 1, pushDir: 1, mode: null, slideSide: 1, throwDir: null, stuckT: 0, flip: null, vy: 0, air: false, x: 0, z: 0, yaw: 0, y: 0, pitch: 0, roll: 0, v: 0, riderYaw: 0, camYaw: null, manualAt: -Infinity, t: 0, settled: false, bumpAt: -Infinity };
  const ride = { y: 0, yaw: 0, camDist: 0 }; // (controls.ride)
  let riding = false;
  let holding = false;
  let locked = false;         // held where it is (a quest: stopped on the road — lock())
  let knock = null;           // a blast coming: { side } — over it goes on the next update (knockOver)

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
  // Its footprint's corners (cart-local), tipped up `tip` rad with side `side` (+1 left, −1
  // right) lifted: narrower, from the low side's edge in
  // — and reared `rear` rad with its `rearDir` end (+1 front, −1 back) up: shorter, the raised
  // end swung in over the trailing axle
  const HB = CART_WHEELBASE / 2;
  const cornersFor = (tip = 0, side = 1, rear = 0, rearDir = 1) => {
    const c = Math.cos(tip);
    const hw = CART_HALF_WIDTH * c;
    const mx = -side * CART_HALF_WIDTH * (1 - c);
    let f = CART_FRONT;
    let b = -CART_BACK;
    if (rear > 0) {
      const cr = Math.cos(rear);
      if (rearDir > 0) f = -HB + (CART_FRONT + HB) * cr;
      else b = HB - (CART_BACK + HB) * cr;
    }
    return [[mx + hw, f], [mx - hw, f], [mx + hw, b], [mx - hw, b], [mx, f], [mx, b]];
  };
  let blockedBy = null;                       // why fits() last said no ('water' / 'trunk' / 'slope' / 'wall' / null)
  // Whether the cart fits at a pose. `roll` (rolling there): { dir — +1 forward / −1 back / 0
  // turning on the spot, y — its height now, air — in the air }; without it (parking) every
  // corner's slope counts. Rolling, only the ground ahead the way it goes counts: up it's
  // limited (MAX_UP_SLOPE, MAX_STEP_UP), down never — off an edge it falls.
  // `tilt` { tip, side }: tipped up (its narrower footprint)
  // One corner (cart-local lx, lz) at a pose, its middle's ground `mid`
  const cornerOk = (x, z, yaw, lx, lz, mid, roll) => {
    const p = worldXZ(x, z, yaw, lx, lz);
    const g = groundAt(p.x, p.z);
    if (!Number.isFinite(g)) return false;
    const ahead = !roll || roll.dir === 0 || Math.sign(lz) === roll.dir;
    if (roll?.air) {
      // (the ground it's leaving is still under its back end)
      if (ahead && g > roll.y + AIR_CLEAR) return false;
    } else {
      const limit = roll?.dir === 0 ? MAX_UP_SLOPE + TURN_SLOPE_SLACK : MAX_UP_SLOPE;
      if (ahead && Math.abs(lz) > 1e-3 && (g - mid) / Math.abs(lz) > limit) {
        blockedBy = g - mid > WALL_RISE ? 'wall' : 'slope';
        return false;
      }
    }
    if (ctx.waterDepth(p.x, p.z) > MAX_WADE) { blockedBy = 'water'; return false; }
    if (pushOutOfObstacles(p.x, p.z, g + 0.4, TRUNK_PROBE_R)) { blockedBy = 'trunk'; return false; }
    return true;
  };
  const midGround = (x, z, yaw, mx) => {
    const m = worldXZ(x, z, yaw, mx, 0);
    return { g: groundAt(m.x, m.z), wet: ctx.waterDepth(m.x, m.z) > MAX_WADE };
  };
  const fits = (x, z, yaw, roll = null, tilt = null) => {
    blockedBy = null;
    const corners = cornersFor(tilt?.tip ?? 0, tilt?.side ?? 1, tilt?.rear ?? 0, tilt?.rearDir ?? 1);
    const { g: mid, wet } = midGround(x, z, yaw, corners[4][0]);
    if (!Number.isFinite(mid)) return false;
    if (wet) { blockedBy = 'water'; return false; }
    if (roll && !roll.air && mid - roll.y > MAX_STEP_UP) { blockedBy = 'wall'; return false; }
    for (const [lx, lz] of corners) if (!cornerOk(x, z, yaw, lx, lz, mid, roll)) return false;
    return true;
  };
  // The steepest way down from a spot, `d` m out: { s — drop / run, dx, dz — that way (unit) }
  const DOWN_DIRS = 12;
  const steepestDown = (x, z, d) => {
    const g0 = groundAt(x, z);
    const out = { s: 0, dx: 0, dz: 0 };
    if (!Number.isFinite(g0)) return out;
    for (let i = 0; i < DOWN_DIRS; i++) {
      const a = (i / DOWN_DIRS) * Math.PI * 2;
      const dx = Math.sin(a);
      const dz = Math.cos(a);
      const g = groundAt(x + dx * d, z + dz * d);
      const sl = Number.isFinite(g) ? (g0 - g) / d : 0;
      if (sl > out.s) Object.assign(out, { s: sl, dx, dz });
    }
    return out;
  };
  // Whether the ground falls away too steeply to stay on (near and further on — not a ledge)
  const tooSteep = (x, z) => {
    const near = steepestDown(x, z, TUMBLE_NEAR);
    if (near.s < TUMBLE_SLOPE) return null;
    const far = steepestDown(x, z, TUMBLE_FAR);
    if (far.s < TUMBLE_SLOPE * 0.85 || far.dx * near.dx + far.dz * near.dz < 0.5) return null;
    return near;
  };
  // Where it hits rolling into a pose it doesn't fit (its leading end, the way it rolls `dir`):
  // 'head' (both leading corners, or its middle), 'left' / 'right' (that corner alone)
  const contactAt = (x, z, yaw, dir, roll) => {
    const { g: mid } = midGround(x, z, yaw, 0);
    if (!Number.isFinite(mid) || (roll && !roll.air && mid - roll.y > MAX_STEP_UP)) return 'head';
    const lz = dir > 0 ? CART_FRONT : -CART_BACK;
    const r = { ...roll, dir };
    const L = !cornerOk(x, z, yaw, CART_HALF_WIDTH, lz, mid, r);
    const R = !cornerOk(x, z, yaw, -CART_HALF_WIDTH, lz, mid, r);
    const M = !cornerOk(x, z, yaw, 0, lz, mid, r);
    if (L && !R && !M) return 'left';
    if (R && !L && !M) return 'right';
    if (L && !R) return 'left';
    if (R && !L) return 'right';
    return 'head';
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
    // (tipped up: on the low side's wheels alone — the raised side's may be over a wall)
    const tipped = st.tip > 0.02;
    const lowLeft = st.tipSide < 0;
    let front = tipped ? (lowLeft ? fl : fr) : (fl + fr) / 2;
    let back = tipped ? (lowLeft ? bl : br) : (bl + br) / 2;
    // (reared up: on the trailing wheels alone, its pitch along the ground kept as it was)
    const reared = st.rear > 0.02;
    if (reared) { if (st.rearDir > 0) front = back; else back = front; }
    const y = (front + back) / 2;
    const pitch = reared ? st.pitch : Math.atan2(back - front, CART_WHEELBASE); // (+: nose down)
    const roll = tipped ? 0 : Math.atan2((fl + bl) / 2 - (fr + br) / 2, CART_TRACK); // (+: the left side up)
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
  // (tipped: turned about the low side's bottom edge — raised, and shifted toward that side)
  // (reared: turned about the trailing wheels — raised, and shifted back)
  const placeModel = () => {
    if (st.flip?.phase === 'tumble' || st.flip?.phase === 'settle') {
      // (rolling over about its middle, TUMBLE_R over the ground)
      const a = st.flip.ang;
      const o = worldXZ(0, 0, st.yaw, TUMBLE_R * Math.sin(a), 0);
      model.group.position.set(st.x + o.x, st.y + TUMBLE_R - TUMBLE_R * Math.cos(a), st.z + o.z);
      model.group.rotation.set(0, st.yaw, a);
      return;
    }
    const { tip, rear } = st;
    const ox = tip > 1e-4 ? -st.tipSide * CART_HALF_WIDTH * (1 - Math.cos(tip)) : 0;
    const oz = rear > 1e-4 ? -st.rearDir * HB * (1 - Math.cos(rear)) : 0;
    const off = worldXZ(0, 0, st.yaw, ox, oz);
    model.group.position.set(st.x + off.x, st.y + CART_HALF_WIDTH * Math.sin(tip) + HB * Math.sin(rear), st.z + off.z);
    model.group.rotation.set(st.pitch - st.rearDir * rear, st.yaw, st.roll + st.tipSide * tip);
  };
  const tilt = (tip = st.tip, rear = st.rear) => (tip > 1e-3 || rear > 1e-3
    ? { tip, side: st.tipSide, rear, rearDir: st.rearDir } : null);
  // Turning by `da` rad about a point of the cart (cart-local lz) if it fits there
  // (`foot`: the footprint it needs — the raised wheels are up in the air / on the wall, so
  // they don't count turning)
  const turnAbout = (da, lz, roll, foot = tilt()) => {
    const P = worldXZ(st.x, st.z, st.yaw, 0, lz);
    const yaw = wrap(st.yaw + da);
    const o = worldXZ(P.x, P.z, yaw, 0, -lz);
    if (!fits(o.x, o.z, yaw, roll, foot)) return false;
    Object.assign(st, { x: o.x, z: o.z, yaw });
    return true;
  };
  // … about its trailing axle (the way it was rolling `dir`), else its middle, else a half step
  const turnAway = (da, dir, roll, foot) => turnAbout(da, -(dir || 1) * HB, roll, foot)
    || turnAbout(da, 0, roll, foot) || turnAbout(da / 2, -(dir || 1) * HB, roll, foot);
  // Coming down where it doesn't fit: moved off what it's on, a little at a time (cart-local
  // direction lx, lz) — false if it can't
  const slideOff = (lx, lz, foot, roll) => {
    for (let i = 1; i <= 6; i++) {
      const p = worldXZ(st.x, st.z, st.yaw, lx * REAR_SLIDE_STEP * i, lz * REAR_SLIDE_STEP * i);
      if (fits(p.x, p.z, st.yaw, roll, foot)) { st.x = p.x; st.z = p.z; return true; }
    }
    return false;
  };
  // Reared up (head on): pushed up, pulled down / over, spinning on its trailing wheels the way
  // it leans; coming down it rolls back off the wall if it must. → 'flip' when it goes over.
  const updateRear = (dt, lift, ix, roll) => {
    const acc = REAR_GRAVITY * Math.sin(st.rear - REAR_BALANCE) + REAR_PUSH * lift * Math.max(0, 1 - st.rear / REAR_PUSH_TOP);
    st.rearV = (st.rearV + acc * dt) * Math.exp(-REAR_DAMP * dt);
    let next = Math.max(0, st.rear + st.rearV * dt);
    if (st.rear > REAR_SPIN_FROM) {
      if (Math.abs(ix) > 0.15) st.spinDir = Math.sign(ix);
      const k = Math.min(1, (st.rear - REAR_SPIN_FROM) / 0.3) * Math.max(0.5, Math.abs(ix));
      turnAway(st.spinDir * REAR_SPIN_RATE * k * dt, st.rearDir, roll, tilt(st.tip, Math.PI / 2));
    }
    if (next < st.rear && !fits(st.x, st.z, st.yaw, roll, tilt(st.tip, next))) {
      // (coming down onto the wall: rolled back off it)
      if (!slideOff(0, -st.rearDir, tilt(st.tip, next), roll)) { next = st.rear; st.rearV = Math.max(0, st.rearV); }
    }
    if (next <= 0) {
      if (st.rearV < -TIP_CLUNK_SPEED && st.t - st.bumpAt > 0.3) { st.bumpAt = st.t; ctx.onBump?.(); }
      next = 0;
      st.rearV = 0;
    }
    st.rear = next;
    if (st.rear < REAR_FLIP) return null;
    // Over it goes — sideways, the way it was spinning (spinning left: down on its left)
    st.tipSide = st.spinDir > 0 ? -1 : 1;
    st.tip = 0.05;
    st.tipV = 2;
    st.flip = { phase: 'fall', t: 0 };
    return 'flip';
  };
  // The tip each frame riding (on the ground): `lift` — pushing into something it can't pass
  // (0 … 1). → 'flip' when it goes over.
  const updateTip = (dt, lift, ix = 0, roll = null) => {
    if (st.tip < 1e-3 && lift <= 0) { st.tip = 0; st.tipV = 0; return null; }
    // (tipped: turning away from what it hit — the raised side — or the way the phone leans)
    if (st.tip > TIP_SPIN_FROM && roll) {
      const way = Math.abs(ix) > 0.15 ? Math.sign(ix) : -st.tipSide;
      const k = Math.min(1, (st.tip - TIP_SPIN_FROM) / 0.3) * (Math.abs(ix) > 0.15 ? Math.abs(ix) : 0.6);
      turnAway(way * TIP_SPIN_RATE * k * dt, st.pushDir, roll, tilt(Math.max(st.tip, TIP_BALANCE), st.rear));
    }
    let acc = TIP_GRAVITY * Math.sin(st.tip - TIP_BALANCE) + TIP_PUSH * lift * Math.max(0, 1 - st.tip / TIP_PUSH_TOP);
    if (st.tip > 0.02) acc += (Math.random() - 0.5) * 2 * TIP_WOBBLE * Math.min(1, Math.abs(st.v) / MAX_SPEED);
    st.tipV = (st.tipV + acc * dt) * Math.exp(-TIP_DAMP * dt);
    let next = st.tip + st.tipV * dt;
    if (next < st.tip) {
      // (coming down where it doesn't fit: off the wall on the raised side, sideways — walls on
      // both sides hold it up)
      const y = groundAt(st.x, st.z);
      const r = { dir: 0, y: Number.isFinite(y) ? y : st.y, air: false };
      const foot = tilt(Math.max(0, next));
      if (!fits(st.x, st.z, st.yaw, r, foot) && !slideOff(-st.tipSide, 0, foot, r)) {
        next = st.tip;
        st.tipV = Math.max(0, st.tipV);
      }
    }
    if (next <= 0) {
      if (st.tipV < -TIP_CLUNK_SPEED && st.t - st.bumpAt > 0.3) { st.bumpAt = st.t; ctx.onBump?.(); }
      next = 0;
      st.tipV = 0;
    }
    st.tip = next;
    if (st.tip < TIP_FLIP) return null;
    st.flip = { phase: 'fall', t: 0 };
    return 'flip';
  };
  // Flipped over (nobody in it): falling onto its side, lying there, righting itself
  const updateFlip = (dt) => {
    const f = st.flip;
    f.t += dt;
    st.rear *= Math.exp(-5 * dt);
    st.rearV = 0;
    if (f.phase === 'tumble') {
      // Down the slope, rolling over and over: gravity along the steepest way down, drag, stopped
      // by walls / trees / deep water
      const down = steepestDown(st.x, st.z, TUMBLE_NEAR);
      const sn = down.s / Math.hypot(1, down.s);
      f.vx += down.dx * TUMBLE_G * sn * dt;
      f.vz += down.dz * TUMBLE_G * sn * dt;
      const drag = Math.exp(-(down.s < TUMBLE_END_SLOPE ? TUMBLE_STOP_DRAG : TUMBLE_DRAG) * dt);
      f.vx *= drag;
      f.vz *= drag;
      const sp = Math.hypot(f.vx, f.vz);
      const nx = st.x + f.vx * dt;
      const nz = st.z + f.vz * dt;
      const g0 = groundAt(st.x, st.z);
      const g1 = groundAt(nx, nz);
      const blocked = !Number.isFinite(g1) || (Number.isFinite(g0) && g1 - g0 > MAX_STEP_UP)
        || ctx.waterDepth(nx, nz) > MAX_WADE || pushOutOfObstacles(nx, nz, g1 + 0.4, TUMBLE_R * 0.6);
      if (blocked) {
        if (sp > 2) ctx.onBump?.();
        f.vx = 0;
        f.vz = 0;
      } else {
        st.x = nx;
        st.z = nz;
        st.y = g1;
        f.ang += (sp * dt) / TUMBLE_R;
        // (its side toward the way it rolls)
        if (sp > 0.3) st.yaw = wrap(st.yaw + wrap(Math.atan2(f.vx, f.vz) - Math.PI / 2 - st.yaw) * ease(6, dt));
        // (a thud each time it comes down on its wheels or its top)
        const half = Math.floor(f.ang / Math.PI);
        if (half !== f.half) { f.half = half; if (sp > 1.5) ctx.onBump?.(); }
      }
      if (blocked || f.t > TUMBLE_MAX_S || (down.s < TUMBLE_END_SLOPE && sp < 0.3)) {
        // (onto its side: the nearest turn of it lying down)
        f.phase = 'settle';
        f.t = 0;
        f.a0 = f.ang;
        f.a1 = Math.PI / 2 + Math.round((f.ang - Math.PI / 2) / (Math.PI * 2)) * Math.PI * 2;
      }
      placeModel();
      return;
    }
    if (f.phase === 'settle') {
      const u = Math.min(1, f.t / TUMBLE_SETTLE_S);
      f.ang = f.a0 + (f.a1 - f.a0) * u * u * (3 - 2 * u);
      if (u < 1) { placeModel(); return; }
      // Lying on its side: from here as a flip (its model left where it is)
      placeModel();
      const at = model.group.position.clone();
      Object.assign(st, { tip: FLIP_LIE, tipV: 0, tipSide: 1, roll: 0, pitch: 0 });
      const off = worldXZ(0, 0, st.yaw, -CART_HALF_WIDTH, 0);
      st.x = at.x - off.x;
      st.z = at.z - off.z;
      st.y = at.y - CART_HALF_WIDTH;
      f.phase = 'lie';
      f.t = 0;
      ctx.onBump?.();
    }
    if (f.phase === 'fall') {
      st.tipV += TIP_GRAVITY * 1.5 * dt;
      st.tip += st.tipV * dt;
      if (st.tip >= FLIP_LIE) {
        st.tip = FLIP_LIE;
        if (st.tipV > 1.5) st.tipV *= -0.25; // (a little bounce)
        else { st.tipV = 0; f.phase = 'lie'; f.t = 0; }
        ctx.onBump?.();
      }
    } else if (f.phase === 'lie') {
      if (f.t >= FLIP_LIE_S) {
        f.phase = 'right';
        f.t = 0;
        // (where it'll stand: the ground under its wheels there — eased onto while it rights itself)
        const keep = { y: st.y, pitch: st.pitch, roll: st.roll, settled: st.settled, tip: st.tip, rear: st.rear };
        Object.assign(st, { settled: false, tip: 0, rear: 0 }); // (upright, on all four wheels)
        settle(0);
        f.from = { y: keep.y, pitch: keep.pitch, roll: keep.roll };
        f.to = { y: st.y, pitch: st.pitch, roll: st.roll };
        Object.assign(st, keep);
      }
    } else {
      const u = Math.min(1, f.t / FLIP_RIGHT_S);
      const k = u * u * (3 - 2 * u);
      st.tip = FLIP_LIE * (1 - k);
      if (f.from && f.to) {
        st.y = f.from.y + (f.to.y - f.from.y) * k;
        st.pitch = f.from.pitch + (f.to.pitch - f.from.pitch) * k;
        st.roll = f.from.roll + (f.to.roll - f.from.roll) * k;
      }
      if (u >= 1) {
        Object.assign(st, { tip: 0, tipV: 0, rear: 0, flip: null, settled: false });
        settle(0); // (back on the ground under it)
        ctx.onBump?.();
      }
    }
    placeModel();
  };
  // The bed's floor where the rider crouches, in the world
  const standPoint = (out = _v) => {
    out.set(0, model.floorY(), STAND_Z);
    model.group.updateMatrixWorld(true);
    return model.group.localToWorld(out);
  };

  /** Parks it at a pose (on the ground there). */
  const place = (x, z, yaw) => {
    knock = null;
    Object.assign(st, { x, z, yaw, v: 0, settled: false, tip: 0, tipV: 0, rear: 0, rearV: 0, flip: null });
    dust.clear();
    settle(0);
    placeModel();
  };

  const mount = () => {
    const c = ctx.getControls();
    if (riding || !c || st.flip) return false;
    riding = true;
    holding = false;
    Object.assign(st, { v: 0, riderYaw: st.yaw, camYaw: null, manualAt: -Infinity, tip: 0, tipV: 0, rear: 0, rearV: 0, mode: null, stuckT: 0 });
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

  // Blocked by a tree / a slope too steep: the same step a little off to one side (the way the
  // phone leans first, else either), the cart turning a little that way. → true if it went.
  const slidePast = (yaw, step, rollAt, ix, why, dt) => {
    const first = Math.abs(ix) > 0.15 ? Math.sign(ix) : (st.slideSide || 1);
    // (a tree dead ahead: shuffled sideways, a little forward too, clear of it — either side,
    // the last one tried first so it keeps going round the same way)
    if (why === 'trunk') {
      const side = Math.max(Math.abs(step), TRUNK_SIDESTEP * dt);
      for (const sd of [first, -first]) {
        for (const fwd of [0.5, 0, -0.3]) {
          const p = worldXZ(st.x, st.z, yaw, sd * side, step * fwd);
          if (fits(p.x, p.z, yaw, { ...rollAt, dir: Math.sign(step) }, null)) {
            Object.assign(st, { x: p.x, z: p.z, yaw, slideSide: sd });
            return true;
          }
        }
      }
    }
    for (const a of SLIDE_ANGLES) {
      for (const sd of [first, -first]) {
        const h = yaw + sd * a * Math.sign(step);
        const len = Math.abs(step) * SLIDE_KEEP;
        const nx = st.x + Math.sin(h) * len * Math.sign(step);
        const nz = st.z + Math.cos(h) * len * Math.sign(step);
        const ny = wrap(yaw + sd * a * 0.25 * Math.sign(step));
        if (fits(nx, nz, ny, rollAt, null)) {
          Object.assign(st, { x: nx, z: nz, yaw: ny, slideSide: sd });
          return true;
        }
      }
    }
    return false;
  };

  // Freed: down on its wheels (as getting back in does) and, if it doesn't fit where it is, moved
  // to the nearest spot round it that it does
  const unstick = () => {
    Object.assign(st, { tip: 0, tipV: 0, rear: 0, rearV: 0, mode: null, v: 0, stuckT: 0 });
    const y = groundAt(st.x, st.z);
    const r = { dir: 0, y: Number.isFinite(y) ? y : st.y, air: false };
    if (!fits(st.x, st.z, st.yaw, r)) {
      search: for (let d = 0.15; d <= UNSTICK_MAX_R; d += 0.15) {
        for (let k = 0; k < 16; k++) {
          const a = (k / 16) * Math.PI * 2;
          const x = st.x + Math.sin(a) * d;
          const z = st.z + Math.cos(a) * d;
          const gy = groundAt(x, z);
          if (fits(x, z, st.yaw, { dir: 0, y: Number.isFinite(gy) ? gy : st.y, air: false })) {
            st.x = x;
            st.z = z;
            break search;
          }
        }
      }
    }
    st.settled = false;
    settle(0);
  };

  // Knocked over (a blast beside it — knockOver): onto its side away from it, as a flip does
  const startKnock = () => {
    Object.assign(st, { tipSide: knock.side, tip: 0.05, tipV: 3.2, rear: 0, rearV: 0, mode: null, v: 0, air: false });
    st.flip = { phase: 'fall', t: 0 };
    st.throwDir = null;
    knock = null;
  };
  // Before the controls move the player: the speed, the turn, the ground, the camera
  const update = (dt) => {
    dt = Math.min(0.1, Math.max(0, dt));
    dust.update(dt);
    if (!riding) {
      if (knock) { startKnock(); placeModel(); }
      if (st.flip) updateFlip(dt);
      return null;
    }
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
    // (knocked over — a bomb by it: over it goes, the rider thrown out)
    if (knock) { startKnock(); placeModel(); return 'flip'; }
    const { ix, iz } = holding || st.air || locked ? { ix: 0, iz: 0 } : input();
    // Speed: toward the lean (backing up slower), braking quicker; a little pull downhill
    const want = (iz >= 0 ? iz : iz * BACK_SPEED) * MAX_SPEED;
    const braking = Math.abs(want) < Math.abs(st.v) || want * st.v < 0;
    // (in the air: it keeps going as it was)
    if (!st.air) {
      st.v += (want - st.v) * ease(braking ? BRAKE : ACCEL, dt);
      if (!holding && !locked) st.v += Math.sin(st.pitch) * SLOPE_PULL * dt;
      if (Math.abs(st.v) < 0.02 && Math.abs(want) < 0.01) st.v = 0;
    }
    // Turning: the sideways lean (left +), quicker the faster it rolls
    const turnRate = TURN_STILL + (TURN_RATE - TURN_STILL) * Math.min(1, Math.abs(st.v) / TURN_FULL_SPEED);
    // (tipped / reared up: it turns about its wheels still down — updateTip / updateRear)
    const lifted = st.tip > 0.02 || st.rear > 0.02;
    const x0 = st.x;
    const z0 = st.z;
    const yaw0 = st.yaw;
    const yaw = lifted ? st.yaw : wrap(st.yaw + ix * turnRate * dt);
    const step = st.v * dt;
    const nx = st.x + Math.sin(yaw) * step;
    const nz = st.z + Math.cos(yaw) * step;
    let moved = 0;
    const dir = Math.abs(step) < 1e-6 ? 0 : Math.sign(step);
    // (on the ground: steps up measured from the ground under its middle — not its wheels'
    // average, which sits under a crest; in the air: from its bottom)
    const fromY = st.air ? st.y : groundAt(st.x, st.z);
    const rollAt = { dir, y: Number.isFinite(fromY) ? fromY : st.y, air: st.air };
    let lift = 0;
    const fitsThere = fits(nx, nz, yaw, rollAt, tilt());
    const why = blockedBy; // (what stopped it — the tries below overwrite blockedBy)
    if (fitsThere) {
      Object.assign(st, { x: nx, z: nz, yaw });
      moved = step;
      if (!st.air) model.spin(step);
    } else if (!st.air && dir !== 0 && (why === 'trunk' || (why === 'slope' && !lifted)) && slidePast(yaw, step, rollAt, ix, why, dt)) {
      // (glanced off a tree / found a gentler way up: slid past, steering a little that way)
      moved = Math.abs(step) * SLIDE_KEEP * Math.sign(step);
      model.spin(moved);
      st.v *= SLIDE_KEEP;
    } else {
      // Up against something: pushing on into a wall or a tree tips it up (too steep a slope, or
      // water, just stops it) — first, where it hits
      const lifts = why === 'wall' || why === 'trunk' || why === null;
      if (!st.air && !holding && lifts && Math.abs(iz) > 0.15 && dir !== 0) {
        if (st.tip < 0.02 && st.rear < 0.02) {
          // Fresh contact: where it hits — head on it rears up, a corner lifts that side
          const impact = Math.min(1, Math.abs(st.v) / MAX_SPEED);
          const hit = contactAt(nx, nz, yaw, dir, rollAt);
          st.pushDir = dir;
          if (hit === 'head') {
            st.mode = 'rear';
            st.rearDir = dir;
            st.rearV = Math.max(st.rearV, REAR_IMPACT * impact);
            st.spinDir = Math.abs(ix) > 0.15 ? Math.sign(ix) : (Math.random() < 0.5 ? 1 : -1);
          } else {
            st.mode = 'tip';
            st.tipSide = hit === 'left' ? 1 : -1;
            st.tipV = Math.max(st.tipV, TIP_IMPACT * impact);
          }
        }
        lift = Math.abs(iz);
      }
      // (turning still works)
      if (!lifted && fits(st.x, st.z, yaw, { ...rollAt, dir: 0 }, tilt())) st.yaw = yaw;
      if (Math.abs(st.v) > 1 && st.t - st.bumpAt > 0.6) { st.bumpAt = st.t; ctx.onBump?.(); }
      st.v = 0;
    }
    // (reared up: still pressing on if the cart full length couldn't go there — its raised end
    // creeping up the wall isn't getting past it)
    if (!lift && st.mode === 'rear' && !holding && Math.abs(iz) > 0.15 && Math.sign(iz) === st.rearDir
      && !fits(st.x + Math.sin(st.yaw) * st.rearDir * 0.05, st.z + Math.cos(st.yaw) * st.rearDir * 0.05, st.yaw, { ...rollAt, dir: st.rearDir }, tilt(st.tip, 0))) {
      lift = Math.abs(iz);
    }
    const spinRoll = { ...rollAt, dir: 0 };
    const liftOut = st.air ? null
      : (st.mode === 'rear' || st.rear > 1e-3) ? updateRear(dt, holding ? 0 : lift, holding ? 0 : ix, spinRoll)
        : updateTip(dt, holding ? 0 : lift, holding ? 0 : ix, spinRoll);
    if (st.rear < 1e-3 && st.tip < 1e-3 && lift <= 0) st.mode = null;
    if (liftOut === 'flip') {
      st.throwDir = null;
      placeModel();
      return 'flip';
    }
    // Over the edge of something very steep going down (not in water): it tumbles to the bottom
    if (!st.air && !lifted && !st.flip && !(ctx.waterDepth(st.x, st.z) > 0.05)) {
      const down = tooSteep(st.x, st.z);
      if (down) {
        const sp = Math.max(1, Math.abs(st.v));
        st.flip = { phase: 'tumble', t: 0, ang: 0, half: 0, vx: down.dx * sp, vz: down.dz * sp };
        Object.assign(st, { tip: 0, tipV: 0, rear: 0, rearV: 0, mode: null, roll: 0, pitch: 0 });
        st.throwDir = { x: down.dx, z: down.dz };
        placeModel();
        return 'flip';
      }
    }
    if (settle(dt, moved) === 'thud' && st.t - st.bumpAt > 0.3) { st.bumpAt = st.t; ctx.onBump?.(); }
    // (stuck: pushing or steering, nothing moving)
    const trying = !holding && !st.air && (Math.abs(iz) > 0.15 || Math.abs(ix) > 0.15);
    const went = Math.abs(moved) > 0.002 || Math.abs(wrap(st.yaw - yaw0)) > 0.002 || Math.hypot(st.x - x0, st.z - z0) > 0.002;
    st.stuckT = trying && !went ? st.stuckT + dt : 0;
    if (st.stuckT > STUCK_S) unstick();
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
    const roll = st.roll + st.tipSide * st.tip;
    const pitch = st.pitch - st.rearDir * st.rear;
    pm.rotation.set(pitch * Math.cos(d) - roll * Math.sin(d), st.riderYaw, roll * Math.cos(d) + pitch * Math.sin(d));
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
    isFlipped: () => !!st.flip,
    unstick, // (dev console)
    state: () => ({ ...st, flip: st.flip ? { ...st.flip } : null }), // (dev console)
    // The way the rider is thrown going over: toward the low side (world { x, z }, unit)
    throwDir: () => st.throwDir ?? worldXZ(0, 0, st.yaw, -st.tipSide, 0),
    isHolding: () => riding && holding,
    // Held where it is (on: no rolling, the lean ignored) — a quest stopping it on the road
    lock: (on) => { locked = !!on; if (on) st.v = 0; },
    isLocked: () => locked,
    // Knocked onto its side by a blast from `from` (world { x, z }): it falls away from it, the
    // rider thrown out that way (update() → 'flip' while riding)
    knockOver: (from) => {
      if (st.flip) return false;
      const dx = st.x - from.x;
      const dz = st.z - from.z;
      // (the cart's left, +x local, in the world: the way it falls — the low side — is away from the blast)
      const lx = dx * Math.cos(st.yaw) - dz * Math.sin(st.yaw);
      knock = { side: lx > 0 ? -1 : 1 };
      return true;
    },
    // A spot on the bed's floor (lz: m ahead of the middle) and its turn — a passenger's seat
    bedPose: (lz, pos = new THREE.Vector3(), quat = new THREE.Quaternion()) => {
      pos.set(0, model.floorY(), lz);
      model.group.updateMatrixWorld(true);
      model.group.localToWorld(pos);
      model.group.getWorldQuaternion(quat);
      return { pos, quat };
    },
  };
}

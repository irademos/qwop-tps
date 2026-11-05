// Eye fish: pairs of `eye_fish.glb` peeking out of the water like a pair of eyes — two fish nose
// to nose, side on, the water line across their big eyes and their spiny dorsal fins arched over
// them like eyebrows, watching the player.
//
//   Town  — at night, outdoors, with the player near water: 2–3 pairs come up round them
//           (`updateAmbient`, bootstrapGameApp.js), watch a while, dip under and come up elsewhere,
//           and dive if the player gets close.
//   Story — the intro: two pairs watch the boy play the flute on the stone; when the Crow flies in
//           they swim away (`spawnPair` / `flee`, storyMode.js).
//
// The GLB is one static mesh, ~1 m long (X), head toward −X, an eye on each flank, origin at its
// belly. A pair's own +Z faces whoever it watches; its right fish keeps the model's facing (nose
// toward the middle), its left one is turned round.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { stylizeObject } from './artStyle.js';

export const EYE_FISH_MODEL_URL = '/assets/props/eye_fish.glb?v=1';
const FISH_SCALE = 0.85;          // the GLB is 1 m long
const EYE_Y = 0.33;               // model units: the eyes' middle over the model's origin
const BODY_H = 0.76;              // model units: belly to the top of the fin
const NOSE_GAP = 0.12;            // m between the two noses
const EMISSIVE = 0.45;            // a faint glow so they read in the dark
const RISE_S = 1.4;               // coming up / going under
const PEEK_SINK = 0.06;           // m: how far under the eyes' middle the water line sits
const BOB_AMP = 0.05;             // m
const WIGGLE = 0.14;              // rad: each fish's tail sway
const TURN_RATE = 2.2;            // rad/s turning to face the player
const DRIFT_SPEED = 0.25;         // m/s wandering while peeking
const SWIM_SPEED = 1.5;           // m/s swimming in to its spot (spawnPair `from`), peeking
const SWIM_ACCEL = 1.2;           // m/s² getting going
const FLEE_SPEED = [2.2, 4.5];    // m/s, speeding up
const FLEE_S = 3.2;               // swimming away, then gone
const MIN_DEPTH = 0.7;            // m of water a pair needs (to go under in)

// Town (`updateAmbient`)
const AMBIENT_PAIRS = [2, 3];     // how many pairs at once
const AMBIENT_NEAR = [11, 26];    // m from the player they come up
const AMBIENT_LEAVE = 45;         // m: further than this → they go
const AMBIENT_SHY = 6;            // m: closer than this → they dive and come up elsewhere
const AMBIENT_WATCH_S = [7, 16];
const AMBIENT_UNDER_S = [2, 6];
const AMBIENT_FIRST_S = [1, 4];   // the first comes up this long after it's allowed
const AMBIENT_GAP = 4;            // m between pairs
const AMBIENT_TRIES = 14;

const rand = (a, b) => a + Math.random() * (b - a);
const easeInOut = (u) => u * u * (3 - 2 * u);
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * @param {object} o
 * @param {THREE.Scene} o.scene
 * @param {(x: number, z: number) => number|null} o.waterY  the water's surface there (null: none)
 * @param {(x: number, z: number) => number} o.waterDepth   m of water over the ground there
 */
export function createEyeFish({ scene, waterY, waterDepth }) {
  let template = null;
  let loading = null;
  const pairs = [];
  let ambientNext = rand(...AMBIENT_FIRST_S);
  let ambientWant = 0;

  const load = () => {
    if (loading) return loading;
    loading = new GLTFLoader().loadAsync(EYE_FISH_MODEL_URL).then((gltf) => {
      const model = gltf.scene;
      stylizeObject(model);
      model.traverse((o) => {
        if (!o.isMesh) return;
        o.castShadow = false;
        o.receiveShadow = false;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) {
          if (!m?.map || !('emissive' in m)) continue;
          m.emissive = new THREE.Color(0xffffff);
          m.emissiveMap = m.map;
          m.emissiveIntensity = EMISSIVE;
        }
      });
      const root = new THREE.Group();
      root.name = 'eye-fish';
      model.scale.setScalar(FISH_SCALE);
      root.add(model);
      template = root;
    }).catch((err) => { console.warn('[eyeFish] model failed to load:', err); });
    return loading;
  };

  const okWater = (x, z) => waterY(x, z) != null && waterDepth(x, z) >= MIN_DEPTH;

  // ── Pairs ──
  const makeFish = () => {
    const group = template.clone(true);
    group.visible = false;
    scene.add(group);
    return { group, phase: Math.random() * Math.PI * 2, wig: rand(5, 8), bob: rand(1.4, 2.2) };
  };

  /** A pair peeking up at (x, z) after `delay` s, watching `look` ({x, z} or a function → one).
   *  With `from` ({x, z}) it comes up there instead and swims in to (x, z), peeking, then settles. */
  const spawnPair = ({ x, z, from = null, look = null, delay = 0, watchS = Infinity, shy = 0 }) => {
    if (!template) return null;
    const pair = {
      x: from ? from.x : x,
      z: from ? from.z : z,
      swimTo: from ? { x, z } : null,
      speed: 0,
      yaw: Math.random() * Math.PI * 2,
      look,
      fish: [makeFish(), makeFish()],
      state: 'wait',     // wait → rise → (swim →) watch → dive → under → rise … / flee / gone
      t: -delay,
      sink: 1,           // 0 peeking … 1 under
      watchS,
      shy,
      drift: { x: 0, z: 0, t: 0 },
      flee: null,
    };
    // (already facing whoever it watches)
    const lp = lookPoint(pair);
    if (lp) pair.yaw = Math.atan2(lp.x - pair.x, lp.z - pair.z);
    pairs.push(pair);
    return pair;
  };

  const removePair = (p) => {
    for (const f of p.fish) scene.remove(f.group);
    const i = pairs.indexOf(p);
    if (i >= 0) pairs.splice(i, 1);
  };

  const lookPoint = (p) => (typeof p.look === 'function' ? p.look() : p.look);

  /** All pairs swim away from `from` ({x, z}; or along `dir`), going under as they go. */
  const flee = ({ from = null, dir = null } = {}) => {
    for (const p of pairs) {
      if (p.state === 'flee' || p.state === 'gone') continue;
      let dx;
      let dz;
      if (dir) { dx = dir.x; dz = dir.z; } else if (from) { dx = p.x - from.x; dz = p.z - from.z; } else { dx = Math.sin(p.yaw + Math.PI); dz = Math.cos(p.yaw + Math.PI); }
      const len = Math.hypot(dx, dz) || 1;
      dx /= len; dz /= len;
      // (each a little its own way)
      const spread = rand(-0.35, 0.35);
      const c = Math.cos(spread);
      const s = Math.sin(spread);
      const fx = dx * c + dz * s;
      const fz = -dx * s + dz * c;
      // (head = model −X: world yaw θ points it at (−cos θ, sin θ))
      const yaw = Math.atan2(fz, -fx);
      p.flee = { dx: fx, dz: fz, yaw };
      p.state = 'flee';
      p.t = 0;
      // (from here each fish swims on its own)
      p.fish.forEach((f, i) => {
        const pose = fishPose(p, i);
        f.x = pose.x; f.z = pose.z; f.yaw = pose.yaw;
        f.delay = i * rand(0.1, 0.35);
      });
    }
  };

  // A fish's spot / facing in its pair
  const _pose = { x: 0, z: 0, yaw: 0 };
  const fishPose = (p, i) => {
    const side = i ? 1 : -1;
    const sep = 0.5 * FISH_SCALE + NOSE_GAP / 2;
    // (the pair's own +X)
    const rx = Math.cos(p.yaw);
    const rz = -Math.sin(p.yaw);
    _pose.x = p.x + rx * side * sep;
    _pose.z = p.z + rz * side * sep;
    _pose.yaw = p.yaw + (side < 0 ? Math.PI : 0);
    return _pose;
  };

  const placeFish = (f, x, z, yaw, sink, t, level, wigK = 1) => {
    const peekY = level - EYE_Y * FISH_SCALE - PEEK_SINK;
    const underBy = BODY_H * FISH_SCALE + 0.25;
    const bob = Math.sin(t * f.bob + f.phase) * BOB_AMP;
    f.group.position.set(x, peekY + bob - easeInOut(Math.min(1, sink)) * underBy, z);
    f.group.rotation.set(Math.sin(t * f.bob * 0.7 + f.phase) * 0.05, yaw + Math.sin(t * f.wig * wigK + f.phase) * WIGGLE, 0);
    f.group.visible = sink < 0.999;
  };

  let clock = 0;
  const updatePairs = (dt) => {
    clock += dt;
    for (let k = pairs.length - 1; k >= 0; k -= 1) {
      const p = pairs[k];
      p.t += dt;
      const level = waterY(p.x, p.z) ?? 0;
      if (p.state === 'flee') {
        const u = p.t;
        let any = false;
        p.fish.forEach((f) => {
          const fu = Math.max(0, u - f.delay);
          const speed = FLEE_SPEED[0] + (FLEE_SPEED[1] - FLEE_SPEED[0]) * Math.min(1, fu / FLEE_S);
          f.yaw += wrapAngle(p.flee.yaw - f.yaw) * Math.min(1, dt * 6);
          if (fu > 0.15) {
            f.x += p.flee.dx * speed * dt;
            f.z += p.flee.dz * speed * dt;
          }
          const sink = Math.min(1, fu / FLEE_S);
          // (a quick tail beat while they go)
          placeFish(f, f.x, f.z, f.yaw, sink, clock * 2.2, waterY(f.x, f.z) ?? level);
          if (sink < 1) any = true;
        });
        if (!any) removePair(p);
        continue;
      }
      if (p.state === 'wait') {
        if (p.t >= 0) { p.state = 'rise'; p.t = 0; }
      } else if (p.state === 'rise') {
        p.sink = 1 - Math.min(1, p.t / RISE_S);
        if (p.t >= RISE_S) { p.state = p.swimTo ? 'swim' : 'watch'; p.t = 0; p.sink = 0; }
      } else if (p.state === 'swim') {
        // Swimming in to its spot, eyes up: speeding up, slowing to a stop there
        p.sink = 0;
        const dx = p.swimTo.x - p.x;
        const dz = p.swimTo.z - p.z;
        const left = Math.hypot(dx, dz);
        p.speed = Math.min(SWIM_SPEED, p.speed + SWIM_ACCEL * dt, 0.15 + left * 1.1);
        const step = Math.min(left, p.speed * dt);
        if (left > 1e-3) { p.x += (dx / left) * step; p.z += (dz / left) * step; }
        if (left - step < 0.03) { p.swimTo = null; p.state = 'watch'; p.t = 0; p.drift.t = rand(1.5, 3); }
      } else if (p.state === 'watch') {
        p.sink = 0;
        // (a slow wander, staying in deep enough water)
        p.drift.t -= dt;
        if (p.drift.t <= 0) {
          const a = Math.random() * Math.PI * 2;
          const s = Math.random() < 0.4 ? 0 : DRIFT_SPEED * rand(0.4, 1);
          p.drift = { x: Math.sin(a) * s, z: Math.cos(a) * s, t: rand(2, 5) };
        }
        const nx = p.x + p.drift.x * dt;
        const nz = p.z + p.drift.z * dt;
        if (okWater(nx, nz)) { p.x = nx; p.z = nz; } else p.drift.t = 0;
        if (p.t >= p.watchS) { p.state = 'dive'; p.t = 0; }
      } else if (p.state === 'dive') {
        p.sink = Math.min(1, p.t / RISE_S);
        if (p.t >= RISE_S) { p.state = 'under'; p.t = 0; p.sink = 1; p.underS = rand(...AMBIENT_UNDER_S); }
      }
      // Turning to watch whoever it watches
      const lp = lookPoint(p);
      if (lp) {
        const want = Math.atan2(lp.x - p.x, lp.z - p.z);
        const d = wrapAngle(want - p.yaw);
        p.yaw += Math.sign(d) * Math.min(Math.abs(d), TURN_RATE * dt * (p.state === 'watch' || p.state === 'swim' ? 1 : 0.5));
      }
      p.fish.forEach((f, i) => {
        const pose = fishPose(p, i);
        placeFish(f, pose.x, pose.z, pose.yaw, p.sink, clock, level, p.state === 'swim' ? 1 + p.speed : 1);
      });
    }
  };

  // ── Town: pairs come up round the player at night near the water ──
  const findSpot = (player) => {
    for (let i = 0; i < AMBIENT_TRIES; i += 1) {
      const a = Math.random() * Math.PI * 2;
      const r = rand(...AMBIENT_NEAR);
      const x = player.x + Math.sin(a) * r;
      const z = player.z + Math.cos(a) * r;
      if (!okWater(x, z)) continue;
      if (pairs.some((p) => p.state !== 'flee' && Math.hypot(p.x - x, p.z - z) < AMBIENT_GAP)) continue;
      return { x, z };
    }
    return null;
  };

  const updateAmbient = (dt, player, on) => {
    if (!template) { if (on) load(); return; }
    const look = () => player;
    if (!on) {
      // (they slip under and go)
      for (const p of pairs) if (p.state === 'watch' || p.state === 'rise' || p.state === 'swim') { p.state = 'dive'; p.t = RISE_S * p.sink; }
      for (let k = pairs.length - 1; k >= 0; k -= 1) {
        const p = pairs[k];
        if (p.state === 'wait' || p.state === 'under') removePair(p);
      }
      ambientWant = 0;
      ambientNext = rand(...AMBIENT_FIRST_S);
      return;
    }
    if (!ambientWant) ambientWant = Math.round(rand(AMBIENT_PAIRS[0], AMBIENT_PAIRS[1]));
    for (let k = pairs.length - 1; k >= 0; k -= 1) {
      const p = pairs[k];
      const d = Math.hypot(p.x - player.x, p.z - player.z);
      if (p.state === 'watch' && (d < AMBIENT_SHY || d > AMBIENT_LEAVE)) { p.state = 'dive'; p.t = 0; }
      if (p.state === 'under') {
        if (p.t < p.underS) continue;
        // Up again somewhere else near the player (or gone, if there's nowhere)
        const spot = d > AMBIENT_LEAVE * 1.5 ? null : findSpot(player);
        if (!spot) { removePair(p); continue; }
        p.x = spot.x; p.z = spot.z;
        p.yaw = Math.atan2(player.x - p.x, player.z - p.z);
        p.state = 'rise';
        p.t = 0;
        p.watchS = rand(...AMBIENT_WATCH_S);
      }
    }
    ambientNext -= dt;
    if (ambientNext <= 0 && pairs.length < ambientWant) {
      const spot = findSpot(player);
      if (spot) {
        const p = spawnPair({ ...spot, look, watchS: rand(...AMBIENT_WATCH_S) });
        if (p) p.yaw = Math.atan2(player.x - p.x, player.z - p.z);
      }
      ambientNext = rand(2, 6);
    }
  };

  const clear = () => {
    while (pairs.length) removePair(pairs[0]);
    ambientWant = 0;
    ambientNext = rand(...AMBIENT_FIRST_S);
  };

  return {
    load,
    spawnPair,
    flee,
    update: updatePairs,
    updateAmbient,
    clear,
    count: () => pairs.length,
    okWater,
    debug: () => ({ pairs }),
  };
}

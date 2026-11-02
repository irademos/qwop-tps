// Birds: now and then a little flock (1–3) of `bird.glb` flies past the player — Showdown and Town
// (bootstrapGameApp.js: `birds.update(dt, playerPos, on)` in the game loop).
//
// A flight: a straight line across the sky passing `PASS_SIDE_*` m to one side of the player,
// starting / ending `FLIGHT_HALF` m away, `ALT_*` m over the ground (kept `MIN_CLEARANCE` over
// the ground under the leader as it goes), each bird a little behind / beside the leader with its
// own sway, bob and wing-beat speed, facing where it's going and banking into its sway. The
// GLB's own clip (`Take 001.001`) flaps the wings. The model faces −Z (beak) with its tail up
// toward +Z, so it is turned round to the game's +Z forward.
//
// `on` false (another mode, indoors, night) → no new flights; leaving the mode (`clear`) takes the
// flock down at once.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { getTerrainHeight } from './terrainHeight.js';

export const BIRD_MODEL_URL = '/assets/props/bird.glb?v=1';
const FLAP_CLIP = 'Take 001.001';
const BIRD_SCALE = 2;              // the GLB is ~0.5 m wing to wing → ~1 m
const FIRST_FLIGHT_S = [6, 14];    // the first flight after the birds are allowed
const BETWEEN_FLIGHTS_S = [14, 40];
const FLIGHT_HALF = 60;            // m from the player's side of the line to where it starts / ends
const PASS_SIDE_MIN = 5;           // m to the side of the player the line passes
const PASS_SIDE_MAX = 22;
const ALT_MIN = 7;                 // m over the ground (or the player, if higher)
const ALT_MAX = 16;
const MIN_CLEARANCE = 5;           // never closer to the ground than this
const SPEED_MIN = 6.5;             // m/s
const SPEED_MAX = 9.5;
const CLIMB_RATE = 4;              // m/s rising over higher ground
const FLAP_SPEED = [0.9, 1.35];    // the clip's time scale
const BANK_MAX = 0.45;             // rad

const rand = (a, b) => a + Math.random() * (b - a);
const pickCount = () => { const r = Math.random(); return r < 0.4 ? 1 : r < 0.75 ? 2 : 3; };

export function createBirds({ scene }) {
  let template = null;
  let clip = null;
  let loading = null;
  let flock = null;          // { birds, from, dir, side, t, length, speed, alt, groundAt, groundY }
  let nextIn = rand(...FIRST_FLIGHT_S);

  const load = () => {
    if (loading) return loading;
    loading = new GLTFLoader().loadAsync(BIRD_MODEL_URL).then((gltf) => {
      const model = gltf.scene;
      // (centred on its body, turned to face +Z)
      const box = new THREE.Box3().setFromObject(model);
      const centre = box.getCenter(new THREE.Vector3());
      model.position.sub(centre);
      const turn = new THREE.Group();
      turn.rotation.y = Math.PI;
      turn.add(model);
      const root = new THREE.Group();
      root.name = 'bird';
      root.scale.setScalar(BIRD_SCALE);
      root.add(turn);
      root.traverse((o) => {
        if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; }
      });
      template = root;
      clip = gltf.animations.find((a) => a.name === FLAP_CLIP) ?? gltf.animations[0] ?? null;
    }).catch((err) => { console.warn('[birds] model failed to load:', err); });
    return loading;
  };

  const makeBird = (i) => {
    const group = template.clone(true);
    const mixer = new THREE.AnimationMixer(group);
    const flap = rand(...FLAP_SPEED);
    if (clip) {
      const action = mixer.clipAction(clip);
      action.timeScale = flap;
      action.time = Math.random() * clip.duration; // (not all in step)
      action.play();
    }
    scene.add(group);
    return {
      group,
      mixer,
      // (the leader first; the others a little behind and to either side)
      back: i === 0 ? 0 : rand(1.5, 4) * i,
      side: i === 0 ? 0 : (i % 2 ? 1 : -1) * rand(1.2, 3),
      up: i === 0 ? 0 : rand(-0.8, 0.8),
      swayAmp: rand(0.6, 1.8),
      swayFreq: rand(0.25, 0.5),
      bobAmp: rand(0.2, 0.6),
      bobFreq: rand(0.4, 0.8),
      phase: Math.random() * Math.PI * 2,
      bank: 0,
      prev: new THREE.Vector3(),
      started: false
    };
  };

  const removeFlock = () => {
    if (!flock) return;
    for (const b of flock.birds) {
      b.mixer.stopAllAction();
      scene.remove(b.group);
    }
    flock = null;
  };

  const groundAt = (x, z) => {
    const y = getTerrainHeight(x, z);
    return Number.isFinite(y) ? y : 0;
  };

  const startFlight = (player) => {
    const heading = Math.random() * Math.PI * 2;
    const dir = new THREE.Vector3(Math.sin(heading), 0, Math.cos(heading));
    const side = new THREE.Vector3(dir.z, 0, -dir.x);
    const pass = rand(PASS_SIDE_MIN, PASS_SIDE_MAX) * (Math.random() < 0.5 ? 1 : -1);
    const from = new THREE.Vector3(player.x, 0, player.z)
      .addScaledVector(side, pass)
      .addScaledVector(dir, -FLIGHT_HALF);
    const base = Math.max(groundAt(player.x, player.z), player.y);
    const birds = [];
    const n = pickCount();
    for (let i = 0; i < n; i += 1) birds.push(makeBird(i));
    flock = {
      birds,
      from,
      dir,
      side,
      t: 0,
      length: FLIGHT_HALF * 2,
      speed: rand(SPEED_MIN, SPEED_MAX),
      alt: base + rand(ALT_MIN, ALT_MAX),
      groundY: groundAt(from.x, from.z),
      groundCheck: 0
    };
  };

  const _pos = new THREE.Vector3();
  const _vel = new THREE.Vector3();
  const _look = new THREE.Matrix4();
  const _q = new THREE.Quaternion();
  const _bankQ = new THREE.Quaternion();
  const _fwd = new THREE.Vector3(0, 0, 1);
  const _up = new THREE.Vector3(0, 1, 0);
  const _origin = new THREE.Vector3();

  const updateFlock = (dt) => {
    const f = flock;
    f.t += dt;
    const dist = f.t * f.speed;
    if (dist > f.length + 10) { removeFlock(); return; }
    // (the ground under the leader, a few times a second: it climbs over hills / roofs)
    const lx = f.from.x + f.dir.x * dist;
    const lz = f.from.z + f.dir.z * dist;
    f.groundCheck -= dt;
    if (f.groundCheck <= 0) {
      f.groundCheck = 0.25;
      // (looking a little ahead too)
      f.groundY = Math.max(groundAt(lx, lz), groundAt(lx + f.dir.x * 8, lz + f.dir.z * 8));
    }
    const minAlt = f.groundY + MIN_CLEARANCE;
    if (f.alt < minAlt) f.alt = Math.min(minAlt, f.alt + CLIMB_RATE * dt);
    for (const b of f.birds) {
      const s = f.t * b.swayFreq * Math.PI * 2 + b.phase;
      const sway = Math.sin(s) * b.swayAmp;
      const bob = Math.sin(f.t * b.bobFreq * Math.PI * 2 + b.phase) * b.bobAmp;
      const along = dist - b.back;
      _pos.set(f.from.x, 0, f.from.z)
        .addScaledVector(f.dir, along)
        .addScaledVector(f.side, b.side + sway);
      _pos.y = f.alt + b.up + bob;
      if (!b.started) { b.prev.copy(_pos).addScaledVector(f.dir, -f.speed * Math.max(dt, 1 / 60)); b.started = true; }
      _vel.subVectors(_pos, b.prev);
      b.prev.copy(_pos);
      b.group.position.copy(_pos);
      if (_vel.lengthSq() > 1e-8) {
        // (facing where it's going; banked into the sway's turn)
        _look.lookAt(_vel, _origin, _up);
        _q.setFromRotationMatrix(_look);
        const turnRate = Math.cos(s) * b.swayAmp * b.swayFreq;
        const bankTarget = THREE.MathUtils.clamp(-turnRate * 0.9, -BANK_MAX, BANK_MAX);
        b.bank += (bankTarget - b.bank) * Math.min(1, dt * 3);
        _bankQ.setFromAxisAngle(_fwd, b.bank);
        b.group.quaternion.copy(_q).multiply(_bankQ);
      }
      b.mixer.update(dt);
    }
  };

  return {
    // `on`: birds wanted now (Showdown / Town, outdoors, by day). Off → no new flights; the
    // flock already up flies on out of sight.
    update(dt, player, on) {
      if (!player) return;
      if (flock) updateFlock(dt);
      if (!on || flock) return;
      if (!template) { void load(); return; }
      nextIn -= dt;
      if (nextIn > 0) return;
      nextIn = rand(...BETWEEN_FLIGHTS_S);
      startFlight(player);
    },
    // Leaving the mode: the flock gone at once, the next one after the first wait again
    clear() {
      removeFlock();
      nextIn = rand(...FIRST_FLIGHT_S);
    },
    preload: load
  };
}

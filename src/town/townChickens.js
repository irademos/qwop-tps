// Town: the chickens (`chicken.glb` — "Chicken - rigged" by Maf'j Alvarez, CC-BY 4.0; its own
// baked clips: idle, pecking, walking, sitting-down, sitting-idle, standing-up).
//
// A flock of CHICKEN_COUNT hens keeps mostly round the farms (each hen one of the fields —
// T.layout.places.fields, else the spawn), CHICKEN_ROAM_R about it: each wanders to a random
// walkable spot (the nav grid, not water), stands about, pecks; now and then (OUTING_CHANCE, at
// most OUTING_MAX at once) one sets off along the nav grid's paths to anywhere in town or along
// any road / trail the townsfolk walk (`outingCells`), pecks about there (OUTING_R) for OUTING_S
// and walks back to its farm (state 'travel', `goOut` / `goHome`); and now and then (EGG_EVERY_S) sits down and lays an egg
// (while there are fewer than EGG_MAX lying about); at night they sit and roost. The player coming
// within FLEE_DIST sends them scurrying off (FLEE_SPEED).
//
// Any weapon kills one (CHICKEN_HP): a sword swing through it (T.chickenSwordHit — first in
// trySwordHit of townMode.js), an arrow / a bomb (stand-ins in T.getWeaponTargets) or a wand blast
// (T.getMagicTargets) — a puff of feathers and it drops a drumstick (src/items/chickenGoods.js).
// Drumsticks and eggs lie on the ground till picked up: Pick up chicken / Pick up egg within
// PICKUP_DIST (T.chickenActs — townActs.js) → the goods 'chicken' / 'egg' (townEconomy.js GOODS:
// food — eaten for health, sold at the player's stand or to a farmer — SELLER_BUYS). A beaten
// hen is replaced CHICKEN_RESPAWN_S later, out of the player's sight.
//
// Only the player's own: not saved, not shared in a shared town (each game has its own flock).
// Dev console: town.debug().T.chickenDebug().

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { stylizeObject } from '../environment/artStyle.js';
import { createChickenMeatMesh, createEggMesh, loadChickenMeat } from '../items/chickenGoods.js';
import { TOWN_BOUNDS } from './townConfig.js';

export const CHICKEN_MODEL_URL = '/assets/props/chicken.glb?v=1';
const CHICKEN_COUNT = 7;
const MODEL_YAW = Math.PI;         // the GLB faces −Z: turned round to face +Z (the way it walks)
const CHICKEN_HEIGHT = 0.36;       // m (the player's ≈ 0.8)
const CHICKEN_ROAM_R = 11;         // m round the farm they keep to (mostly)
const OUTING_CHANCE = 0.04;        // each time one decides what next at its farm: off on an outing
const OUTING_MAX = 3;              // hens out round town at once (the rest stay at the farms)
const OUTING_S = [40, 120];        // s (town sim time) pecking about out there before heading back
const OUTING_R = 5;                // m round the outing's spot they wander
const OUTING_MIN_DIST = 18;        // m from the farm an outing goes at least…
const OUTING_MAX_DIST = 75;        // …and at most
const TRAVEL_SPEED = 0.85;         // m/s walking to / from an outing
const CHICKEN_HP = 1;              // hits
const CHICKEN_RESPAWN_S = 150;     // s (town sim time) before a beaten hen's replaced
const RESPAWN_UNSEEN = 14;         // m the player must be from where the new one turns up
const WALK_SPEED = 0.45;           // m/s
const WALK_CLIP_RATE = 1.1;        // the walking clip's speed at WALK_SPEED
const FLEE_SPEED = 2.4;            // m/s scurrying off
const FLEE_DIST = 2.1;             // m: the player this close sends them off
const FLEE_S = [1.2, 2.2];         // s of scurrying
const IDLE_S = [1.5, 5];
const PECK_S = [2, 5];
const TURN_RATE = 5;               // rad/s
const EGG_EVERY_S = [70, 160];     // s (town sim time) between one hen's eggs
const EGG_MAX = 10;                // eggs lying about at once
const EGG_SIZE = 0.34;             // m long, a laid egg (big, so it's easy to spot)
const EGG_SIT_S = 3.5;             // s sat (sitting-idle) laying it
const MEAT_MAX = 12;               // drumsticks lying about at once (the oldest goes)
const PICKUP_DIST = 1.3;           // m from the player to pick one up
const HIT_R = 0.42;                // m from its middle a sword tip hits it
const BODY_Y = 0.18;               // m: its middle over the ground
const DRAW_DIST = 70;              // m: further off they're hidden and not animated
const FADE_S = 0.25;               // s crossfading clips
const CLIPS = { idle: 'idle', peck: 'pecking', walk: 'walking', sitDown: 'sitting-down', sitIdle: 'sitting-idle', standUp: 'standing-up' };
// Clips that loop: their root bone's travel over the clip (the walk's ~1.9 units forward) is taken
// out, so the hen doesn't snap back each loop — the game moves it; the bob / sway stay
const LOOPED_CLIPS = ['idle', 'pecking', 'walking', 'sitting-idle'];
const ROOT_BONE = 'spine_00';
const stripRootMotion = (clip) => {
  for (const tr of clip.tracks) {
    if (tr.name !== `${ROOT_BONE}.position`) continue;
    const t = tr.times;
    const v = tr.values;
    const n = t.length;
    const dur = t[n - 1] - t[0];
    if (n < 2 || dur <= 0) continue;
    const d = [0, 1, 2].map((k) => v[3 * (n - 1) + k] - v[k]);
    for (let i = 0; i < n; i++) {
      const u = (t[i] - t[0]) / dur;
      for (let k = 0; k < 3; k++) v[3 * i + k] -= d[k] * u;
    }
  }
};
const rand = (a, b) => a + Math.random() * (b - a);
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// T: the town's shared state + functions (createTownMode in townMode.js); ctx: the game
export function installTownChickens(T, ctx) {
  let gltf = null;
  let fit = null;            // { scale, yaw, y } — the model fitted: CHICKEN_HEIGHT tall, facing +Z, feet on y = 0
  let loading = null;
  const load = () => {
    loading ??= new GLTFLoader().loadAsync(CHICKEN_MODEL_URL).then((g) => {
      stylizeObject(g.scene);
      g.scene.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
      for (const clip of g.animations) if (LOOPED_CLIPS.some((n) => clip.name.endsWith(`|${n}`) || clip.name === n)) stripRootMotion(clip);
      gltf = g;
      fit = measure(g.scene);
    }).catch((err) => { console.warn('[townChickens] chicken.glb failed to load:', err); });
    loadChickenMeat();
    return loading;
  };
  // Its size (the skinned vertices as posed — Box3 precise); the GLB faces −Z, so it's turned
  // round (MODEL_YAW) to walk head first along +Z
  const measure = (scene) => {
    scene.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(scene, true);
    const h = Math.max(box.max.y - box.min.y, 1e-6);
    return { scale: CHICKEN_HEIGHT / h, yaw: MODEL_YAW, y: -box.min.y * (CHICKEN_HEIGHT / h) };
  };

  const hens = [];             // { root, model, mixer, actions, action, state, t, until, x, z, yaw, tx, tz, hp, eggAt, proxy, lastSwing }
  const eggs = [];             // { mesh, x, z }
  const meats = [];            // { mesh, x, z }
  const respawns = [];         // T.simT each beaten hen comes back at
  let group = null;            // everything (in the scene while in Town)
  let feathers = null;
  let home = null;             // the first farm (the flock's middle — the respawns)
  let farms = [];              // every field's middle — each hen keeps to one
  let outingCells = null;      // nav cells an outing can go to: in town, or on a road / trail

  const farmSpots = () => {
    const pl = T.layout?.places;
    const fs = (pl?.fields ?? []).map((f) => ({ x: f.x, z: f.z }));
    if (fs.length) return fs;
    return pl?.spawn ? [{ x: pl.spawn.x, z: pl.spawn.z }] : [];
  };
  // (a step / a spot a hen may stand on: walkable, dry, not in a house's room)
  const okGround = (x, z) => T.layout.nav.isWalkable(x, z) && !ctx.isOverWater?.(x, z) && !T.rooms.roomAt(x, z);
  const randomSpot = (near = home, r = CHICKEN_ROAM_R) => {
    for (let i = 0; i < 20; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = Math.sqrt(Math.random()) * r;
      const x = near.x + Math.cos(a) * d;
      const z = near.z + Math.sin(a) * d;
      if (okGround(x, z) && Math.hypot(x - near.x, z - near.z) < r * 1.15) return { x, z };
    }
    return null;
  };
  // Where it keeps to now: its farm, or its outing's spot
  const baseOf = (h) => h.out ?? h.farm;
  const baseR = (h) => (h.out ? OUTING_R : CHICKEN_ROAM_R);
  const inTown = (x, z) => x > TOWN_BOUNDS.minX && x < TOWN_BOUNDS.maxX && z > TOWN_BOUNDS.minZ && z < TOWN_BOUNDS.maxZ;
  const findOutingCells = () => {
    const nav = T.layout.nav;
    return nav.cellsWhere((i) => !nav.isWater(i) && (nav.kindAt(i) >= 1 || inTown(nav.cellX(i), nav.cellZ(i))));
  };
  // Off along the paths to somewhere round town (false: nowhere it can walk to)
  const startTravel = (h, x, z) => {
    const path = T.layout.nav.findPath(h.x, h.z, x, z);
    const end = path?.[path.length - 1];
    if (!end || Math.hypot(end.x - x, end.z - z) > 3) return false;
    h.path = path;
    h.tx = path[0].x;
    h.tz = path[0].z;
    setState(h, 'travel', Math.max(60, path.length * 30));
    play(h, 'walk', { rate: WALK_CLIP_RATE * TRAVEL_SPEED / WALK_SPEED });
    return true;
  };
  const goOut = (h) => {
    outingCells ??= findOutingCells();
    if (!outingCells.length) return false;
    const nav = T.layout.nav;
    for (let i = 0; i < 12; i++) {
      const c = outingCells[(Math.random() * outingCells.length) | 0];
      const x = nav.cellX(c);
      const z = nav.cellZ(c);
      const d = Math.hypot(x - h.x, z - h.z);
      if (d < OUTING_MIN_DIST || d > OUTING_MAX_DIST || !okGround(x, z)) continue;
      if (!startTravel(h, x, z)) continue;
      h.out = { x, z };
      h.outUntil = T.simT + rand(...OUTING_S);
      return true;
    }
    return false;
  };
  const goHome = (h) => {
    const to = randomSpot(h.farm, CHICKEN_ROAM_R * 0.6) ?? h.farm;
    h.out = null;
    if (startTravel(h, to.x, to.z)) return true;
    // (no way back along the paths: it turns up at the farm, out of sight, later — just put it there)
    h.x = to.x;
    h.z = to.z;
    return false;
  };
  const groundAt = (x, z) => T.groundAt(x, z);

  // ── A hen ──
  const play = (h, key, { rate = 1, once = false } = {}) => {
    const a = h.actions[key];
    if (!a || (h.action === a && !once)) { if (a) a.timeScale = rate; return; }
    if (h.action) h.action.fadeOut(FADE_S);
    a.reset();
    a.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
    a.clampWhenFinished = once;
    a.timeScale = rate;
    a.fadeIn(FADE_S).play();
    h.action = a;
  };
  const clipDone = (h) => !h.action || !h.action.isRunning() || h.action.time >= h.action.getClip().duration - 0.02;
  const spawnHen = (at) => {
    const model = cloneSkinned(gltf.scene);
    const holder = new THREE.Group();
    holder.add(model);
    model.rotation.y = fit.yaw;
    holder.scale.setScalar(fit.scale);
    holder.position.y = fit.y;
    const root = new THREE.Group();
    root.name = 'town-chicken';
    root.add(holder);
    group.add(root);
    const mixer = new THREE.AnimationMixer(model);
    const actions = {};
    for (const [key, name] of Object.entries(CLIPS)) {
      const clip = gltf.animations.find((c) => c.name.endsWith(`|${name}`) || c.name === name);
      if (clip) actions[key] = mixer.clipAction(clip);
    }
    const h = {
      root, model, mixer, actions, action: null, state: 'idle', t: 0, until: rand(...IDLE_S),
      x: at.x, z: at.z, yaw: Math.random() * Math.PI * 2, tx: at.x, tz: at.z, hp: CHICKEN_HP,
      farm: at.farm ?? home, out: null, outUntil: 0, path: null,
      eggAt: T.simT + rand(...EGG_EVERY_S), proxy: null, lastSwing: null, lastHitAt: -9, layEgg: false,
    };
    // (each one a little different)
    root.scale.setScalar(rand(0.9, 1.1));
    mixer.setTime(Math.random() * 2);
    play(h, 'idle');
    hens.push(h);
    place(h);
    return h;
  };
  const place = (h) => {
    h.root.position.set(h.x, groundAt(h.x, h.z), h.z);
    h.root.rotation.y = h.yaw;
  };
  const setState = (h, state, until = 0) => { h.state = state; h.t = 0; h.until = until; };
  const turnTo = (h, x, z, dt) => {
    const want = Math.atan2(x - h.x, z - h.z);
    h.yaw += THREE.MathUtils.clamp(wrap(want - h.yaw), -TURN_RATE * dt, TURN_RATE * dt);
  };
  // (what next, after standing / pecking / walking)
  const decide = (h) => {
    if (T.isNight) { setState(h, 'sitDown'); h.layEgg = false; play(h, 'sitDown', { once: true }); return; }
    if (T.simT > h.eggAt && eggs.length < EGG_MAX) {
      h.eggAt = T.simT + rand(...EGG_EVERY_S);
      h.layEgg = true;
      setState(h, 'sitDown');
      play(h, 'sitDown', { once: true });
      return;
    }
    // (out round town long enough — or wandered far from its spot: back to the farm)
    if (h.out && (T.simT > h.outUntil || Math.hypot(h.x - h.out.x, h.z - h.out.z) > OUTING_R * 3)) { if (goHome(h)) return; }
    else if (!h.out && Math.hypot(h.x - h.farm.x, h.z - h.farm.z) > CHICKEN_ROAM_R * 2) { h.out = null; if (goHome(h)) return; }
    if (!h.out && Math.random() < OUTING_CHANCE && hens.filter((o) => o.out).length < OUTING_MAX && goOut(h)) return;
    const r = Math.random();
    const base = baseOf(h);
    if (r < 0.45) {
      const to = (Math.hypot(h.x - base.x, h.z - base.z) < baseR(h) ? randomSpot(h, 5) : null) ?? randomSpot(base, baseR(h));
      if (to) { h.tx = to.x; h.tz = to.z; setState(h, 'walk', 12); play(h, 'walk', { rate: WALK_CLIP_RATE }); return; }
    }
    if (r < 0.75) { setState(h, 'peck', rand(...PECK_S)); play(h, 'peck'); return; }
    setState(h, 'idle', rand(...IDLE_S));
    play(h, 'idle');
  };
  // A step toward (tx, tz) at `speed`; false when the way's blocked (water, a wall, off the farm)
  const stepToward = (h, speed, dt) => {
    turnTo(h, h.tx, h.tz, dt);
    const d = Math.hypot(h.tx - h.x, h.tz - h.z);
    if (d < 0.15) return 'there';
    const s = Math.min(d, speed * dt);
    const nx = h.x + Math.sin(h.yaw) * s;
    const nz = h.z + Math.cos(h.yaw) * s;
    if (!okGround(nx, nz) && h.state !== 'travel') return 'blocked';
    h.x = nx;
    h.z = nz;
    return 'on';
  };
  const updateHen = (h, dt, p) => {
    h.t += dt;
    const near = Math.hypot(p.x - h.x, p.z - h.z);
    // (the player too close: off it scurries — not while laying / roosting)
    if (near < FLEE_DIST && h.state !== 'flee' && h.state !== 'travel' && h.state !== 'sitIdle' && h.state !== 'sitDown' && !T.inRoom) {
      const ax = h.x - p.x;
      const az = h.z - p.z;
      const k = 3 / (Math.hypot(ax, az) || 1);
      const ang = rand(-0.7, 0.7);
      const fx = ax * Math.cos(ang) - az * Math.sin(ang);
      const fz = ax * Math.sin(ang) + az * Math.cos(ang);
      h.tx = h.x + fx * k;
      h.tz = h.z + fz * k;
      setState(h, 'flee', rand(...FLEE_S));
      play(h, 'walk', { rate: WALK_CLIP_RATE * FLEE_SPEED / WALK_SPEED * 0.55 });
    }
    switch (h.state) {
      case 'walk': {
        const r = stepToward(h, WALK_SPEED, dt);
        if (r !== 'on' || h.t > h.until) decide(h);
        break;
      }
      case 'travel': {
        // (along the nav path, waypoint by waypoint)
        const r = stepToward(h, TRAVEL_SPEED, dt);
        if (r === 'there' && h.path?.length > 1) {
          h.path.shift();
          h.tx = h.path[0].x;
          h.tz = h.path[0].z;
        } else if (r === 'there' || h.t > h.until) {
          h.path = null;
          decide(h);
        }
        break;
      }
      case 'flee': {
        const r = stepToward(h, FLEE_SPEED, dt);
        if (r === 'blocked') {
          // (try another way out)
          const to = randomSpot(h, 3);
          if (to) { h.tx = to.x; h.tz = to.z; }
        }
        if (h.t > h.until || r === 'there') decide(h);
        break;
      }
      case 'idle':
      case 'peck':
        if (h.t > h.until) decide(h);
        break;
      case 'sitDown':
        if (clipDone(h)) { setState(h, 'sitIdle', h.layEgg ? EGG_SIT_S : 0); play(h, 'sitIdle'); }
        break;
      case 'sitIdle':
        // (roosting: sat till morning; laying: EGG_SIT_S, the egg left where it sat)
        if (h.layEgg ? h.t > h.until : !T.isNight) {
          if (h.layEgg) { layEgg(h); h.layEgg = false; }
          setState(h, 'standUp');
          play(h, 'standUp', { once: true });
        }
        break;
      case 'standUp':
        if (clipDone(h)) decide(h);
        break;
      default:
        decide(h);
    }
    place(h);
  };

  // ── Eggs and drumsticks on the ground ──
  const layEgg = (h) => {
    if (eggs.length >= EGG_MAX) return;
    // (just behind where it sat, lying on its side — its middle a radius over the ground)
    const x = h.x - Math.sin(h.yaw) * 0.3;
    const z = h.z - Math.cos(h.yaw) * 0.3;
    const mesh = createEggMesh(EGG_SIZE);
    mesh.rotation.set(Math.PI / 2 * 0.9, Math.random() * Math.PI * 2, 0, 'YXZ');
    mesh.position.set(x, groundAt(x, z) + EGG_SIZE * 0.34, z);
    group.add(mesh);
    eggs.push({ mesh, x, z });
  };
  const dropMeat = (x, z) => {
    if (meats.length >= MEAT_MAX) meats.shift().mesh.removeFromParent();
    const mesh = createChickenMeatMesh(0.3);
    mesh.position.set(x, groundAt(x, z) + 0.01, z);
    mesh.rotation.y = Math.random() * Math.PI * 2;
    group.add(mesh);
    meats.push({ mesh, x, z, bornAt: T.simT });
  };
  const nearestOf = (list) => {
    const p = T.playerPos();
    let best = null;
    let bd = PICKUP_DIST;
    for (const o of list) {
      const d = Math.hypot(o.x - p.x, o.z - p.z);
      if (d < bd) { bd = d; best = o; }
    }
    return best;
  };
  const pickUp = (list, g, what) => {
    const o = nearestOf(list);
    if (!o) return;
    if (T.gain(g) < 1) return; // (the bag's full — T.bagFullNote said so)
    list.splice(list.indexOf(o), 1);
    o.mesh.removeFromParent();
    ctx.playSfx?.('pickup');
    T.feedLine(`Picked up ${what}.`);
  };
  // The interact buttons (townActs.js computeActs)
  const chickenActs = () => {
    if (!group || T.inRoom || T.jail) return [];
    const out = [];
    if (nearestOf(meats)) out.push({ key: 'pickChicken', label: 'Pick up chicken', onClick: () => pickUp(meats, 'chicken', 'a drumstick') });
    if (nearestOf(eggs)) out.push({ key: 'pickEgg', label: 'Pick up egg', onClick: () => pickUp(eggs, 'egg', 'an egg') });
    return out;
  };

  // ── Hurting them ──
  const _mid = new THREE.Vector3();
  const midOf = (h) => _mid.set(h.x, groundAt(h.x, h.z) + BODY_Y, h.z);
  const kill = (h) => {
    if (!hens.includes(h)) return;
    h.hp = 0;
    const at = midOf(h).clone();
    ctx.playSfx?.('hit', at);
    puffFeathers(at);
    dropMeat(h.x, h.z);
    h.mixer.stopAllAction();
    h.root.removeFromParent();
    hens.splice(hens.indexOf(h), 1);
    respawns.push(T.simT + CHICKEN_RESPAWN_S);
  };
  const damage = (h, n = 1) => {
    if (h.hp <= 0) return false;
    h.hp -= n;
    if (h.hp > 0) return false;
    kill(h);
    return true;
  };
  // A sword swing through one (trySwordHit of townMode.js)
  const chickenSwordHit = (tip, swingId) => {
    if (!group || T.inRoom) return false;
    for (const h of hens) {
      if (swingId != null && h.lastSwing === swingId) continue;
      const m = midOf(h);
      if (Math.hypot(tip.x - m.x, (tip.y - m.y) * 0.7, tip.z - m.z) > HIT_R) continue;
      h.lastSwing = swingId;
      damage(h, 1);
      return 'hit';
    }
    return false;
  };
  // Arrows / bombs (projectiles.js, blastEnemiesAt): a stand-in with a small box round its body
  const proxyOf = (h) => {
    if (!h.proxy) {
      const g = new THREE.Object3D();
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4), new THREE.MeshBasicMaterial({ visible: false }));
      box.position.y = BODY_Y;
      g.add(box);
      h.proxy = {
        group: g,
        get isDead() { return h.hp <= 0; },
        applyDamage: () => damage(h, 1),
        applyKnockback: () => {},
        applyDirectKnockback: () => {},
        applyBlastKnockback: () => {},
      };
    }
    h.proxy.group.position.set(h.x, groundAt(h.x, h.z), h.z);
    h.proxy.group.updateMatrixWorld(true);
    return h.proxy;
  };
  const shown = (h) => h.root.visible;
  const chickenWeaponTargets = () => (group && !T.inRoom ? hens.filter(shown).map(proxyOf) : []);
  const chickenMagicTargets = () => (group && !T.inRoom ? hens.filter(shown).map((h) => ({
    center: midOf(h).clone(),
    radius: 0.3,
    blocks: () => false,
    onBlocked: () => {},
    onHit: () => damage(h, 1),
  })) : []);

  // ── Feathers: a little white burst where one's beaten ──
  const FEATHERS = 14;
  const makeFeathers = () => {
    const geo = new THREE.PlaneGeometry(0.06, 0.03);
    const mat = new THREE.MeshBasicMaterial({ color: 0xfaf6ee, side: THREE.DoubleSide, transparent: true, depthWrite: false });
    const mesh = new THREE.InstancedMesh(geo, mat, FEATHERS * 4);
    mesh.count = 0;
    mesh.frustumCulled = false;
    return { mesh, list: [] };
  };
  const puffFeathers = (at) => {
    for (let i = 0; i < FEATHERS; i++) {
      if (feathers.list.length >= FEATHERS * 4) feathers.list.shift();
      const a = Math.random() * Math.PI * 2;
      const s = rand(0.6, 1.6);
      feathers.list.push({
        p: at.clone(), v: new THREE.Vector3(Math.cos(a) * s, rand(1, 2.4), Math.sin(a) * s),
        r: new THREE.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6), spin: rand(-8, 8), age: 0, life: rand(1.4, 2.4),
      });
    }
  };
  const _m = new THREE.Matrix4();
  const _q = new THREE.Quaternion();
  const _s = new THREE.Vector3();
  const updateFeathers = (dt) => {
    let i = 0;
    feathers.list = feathers.list.filter((f) => (f.age += dt) < f.life);
    for (const f of feathers.list) {
      f.v.y -= 2.2 * dt;
      f.v.multiplyScalar(Math.exp(-2.5 * dt)); // (light: they drift down)
      f.p.addScaledVector(f.v, dt);
      const g = groundAt(f.p.x, f.p.z) + 0.01;
      if (f.p.y < g) { f.p.y = g; f.v.set(0, 0, 0); }
      f.r.x += f.spin * dt * (f.v.lengthSq() > 0.01 ? 1 : 0);
      f.r.z += f.spin * 0.6 * dt * (f.v.lengthSq() > 0.01 ? 1 : 0);
      _q.setFromEuler(f.r);
      _s.setScalar(Math.min(1, (f.life - f.age) * 2));
      _m.compose(f.p, _q, _s);
      feathers.mesh.setMatrixAt(i++, _m);
    }
    feathers.mesh.count = i;
    feathers.mesh.instanceMatrix.needsUpdate = true;
  };

  // ── Each frame ──
  const build = () => {
    farms = farmSpots();
    home = farms[0];
    if (!home) return false;
    outingCells = null;
    group = new THREE.Group();
    group.name = 'town-chickens';
    feathers = makeFeathers();
    group.add(feathers.mesh);
    ctx.scene.add(group);
    for (let i = 0; i < CHICKEN_COUNT; i++) {
      const farm = farms[i % farms.length];
      const at = randomSpot(farm);
      if (at) spawnHen({ ...at, farm });
    }
    return true;
  };
  const updateChickens = (dt) => {
    if (!T.ready || !T.layout) return;
    if (!gltf) { load(); return; }
    if (!group && !build()) return;
    const p = T.playerPos();
    // (beaten ones replaced, where the player isn't looking — out of their sight)
    for (let i = respawns.length - 1; i >= 0; i--) {
      if (T.simT < respawns[i]) continue;
      const farm = farms[(Math.random() * farms.length) | 0];
      const at = randomSpot(farm);
      if (!at || Math.hypot(at.x - p.x, at.z - p.z) < RESPAWN_UNSEEN) continue;
      respawns.splice(i, 1);
      spawnHen({ ...at, farm });
    }
    group.visible = !T.inRoom;
    for (const h of hens.slice()) {
      updateHen(h, dt, p);
      h.root.visible = group.visible && Math.hypot(p.x - h.x, p.z - h.z) < DRAW_DIST;
      if (h.root.visible) h.mixer.update(dt);
    }
    if (feathers.list.length || feathers.mesh.count) updateFeathers(dt);
  };
  // (leaving Town: the flock taken down — a new one the next time)
  const resetChickens = () => {
    for (const h of hens) h.mixer.stopAllAction();
    hens.length = 0;
    eggs.length = 0;
    meats.length = 0;
    respawns.length = 0;
    group?.removeFromParent();
    group = null;
  };

  const chickenDebug = () => ({
    loaded: !!gltf, fit, home, farms, outingCells: outingCells?.length ?? null,
    hens: hens.map((h) => ({ x: +h.x.toFixed(1), z: +h.z.toFixed(1), state: h.state, out: h.out })),
    sendOut: () => hens.map((h) => goOut(h)),
    eggs: eggs.length, meats: meats.length, respawns: respawns.length,
    eggsAt: eggs.map((o) => ({ x: o.x, z: o.z })), meatsAt: meats.map((o) => ({ x: o.x, z: o.z })),
    layAll: () => hens.forEach((h) => { h.eggAt = 0; }),
    killOne: () => hens[0] && kill(hens[0]),
    bringHere: () => { const q = T.playerPos(); hens.forEach((h, i) => { h.x = q.x + Math.cos(i) * 2.5; h.z = q.z + Math.sin(i) * 2.5; place(h); }); },
  });

  Object.assign(T, {
    updateChickens, resetChickens, chickenSwordHit, chickenWeaponTargets, chickenMagicTargets, chickenActs, chickenDebug,
  });
}

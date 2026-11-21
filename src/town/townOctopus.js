// Town: the octopus that comes for the canoe at night.
//
// Out in the canoe at night (T.inCanoe(), T.isNight — not with a job's passenger aboard, a job
// under way or the line out), now and then (OCTO_CHECK_S, OCTO_CHANCE; OCTO_FIRST_S after
// setting out, OCTO_COOLDOWN_S after the last one) an octopus (`octopus.glb` — clips Swim, Hurt,
// Attack Left, Attack Right; faces +Z, origin at its underside) comes up out at sea
// (OCTO_SPAWN_R): the camera turns to it and the sword comes out at once (T.setCanoeArmed — the
// wand and the bow / bombs may be used too) while it peeks out of the water, watching
// (OCTO_PEEK_S), then it dives and swims in under the surface (Swim) to just off the canoe's
// left or right side, level with the player (OCTO_DIST), where it surfaces and holds the canoe
// (it stops — T.canoeStop each frame); the player turns to face it over that side
// (T.canoeFaceSide) and the camera turns to it (ctx.turnCameraTo — again as each attack starts).
//
// It attacks with a tentacle from its left or its right (Attack Left / Attack Right): a long
// wind-up — the tentacle raised on that side — then a diagonal slam down and across at
// OCTO_STRIKE_AT of the clip. Blocking it is the enemy swordsmen's rule (EnemyPlayer.js
// swingCrossesBlade): holding Block with the blade in the way (OCTO_BLOCK_REACH of where it
// lands) and across the tentacle's swing — a blade lying along the swing lets it through.
// Blocked → the Hurt clip, and while it lasts a sword swing through it hurts it (trySwordHit);
// not blocked → the player loses OCTO_DAMAGE and the canoe rocks. Arrows, bombs and wand blasts
// hurt it any time (stand-ins in T.getWeaponTargets / getMagicTargets — townTrade.js).
// OCTO_HP hits and it's had enough: it reels (Hurt) sinking and backing off (OCTO_DYING_S), then
// swims away under the water; the camera's left be and the sword stays in hand, the player still
// facing that side, till they pick the oar (T.setCanoeArmed('untilOar') — townCanoe.js). It
// swims off the same way (no reeling, the oar back) when the player gets out, goes down, a room… The camera's auto-aim turns to it (T.octopusThreats).
// Only the player's own (a shared town's others don't see it).
//
// Dev console: town.debug().T.octopusDebug() — { state, hp, side }; .spawn() brings one now.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { stylizeObject } from '../environment/artStyle.js';
import { swingCrossesBlade, PLAYER_BLOCK_MIN_ANGLE_DEG } from '../characters/EnemyPlayer.js';

export const OCTOPUS_MODEL_URL = '/assets/props/octopus.glb?v=1';
const OCTO_SCALE = 3.2;            // the model is ~0.86 m across: ~2.75 m
const OCTO_CHECK_S = 15;           // s between the dice rolls…
const OCTO_CHANCE = 0.35;          // …this likely each
const OCTO_FIRST_S = 20;           // s out on the water at night before the first roll
const OCTO_COOLDOWN_S = 90;        // s after one's gone before the next roll
const OCTO_SPAWN_R = [18, 26];     // m from the canoe it comes up
const OCTO_MIN_DEPTH = 2;          // m of water where it comes up
const OCTO_SWIM_SPEED = 4.5;       // m/s swimming in
const OCTO_FLEE_SPEED = 5;         // m/s swimming off
const OCTO_FLEE_S = 6;             // s swimming off, then gone
const OCTO_DIST = 1.9;             // m out from the player, off the canoe's side, it holds the canoe
const OCTO_SURFACE_SINK = 0.25;    // × its height under the water line its origin sits, holding on
const OCTO_DEEP_SINK = 1.6;        // m further down swimming in (rising over the last OCTO_RISE_DIST)
const OCTO_RISE_DIST = 7;
const OCTO_PEEK_S = 2.6;           // s it peeks out of the water where it comes up, before swimming in
const OCTO_PEEK_SINK = 0.62;       // × its height under the water line its origin sits, peeking (the top showing)
const OCTO_PEEK_RISE_S = 0.6;      // s coming up to peek
const OCTO_DIVE_RATE = 2.2;        // /s easing down under the water as it sets off
const OCTO_DYING_S = 2.4;          // s beaten: reeling (Hurt), sinking and backing off — then it swims away
const OCTO_DYING_BACK = 0.9;       // m/s backing off meanwhile
const OCTO_DYING_SINK = 0.5;       // m/s sinking meanwhile
const OCTO_SURFACE_S = 0.8;        // s coming up before the first attack
const OCTO_ATTACK_GAP_S = [1.0, 2.2]; // s between attacks
const OCTO_ATTACK_RATE = 1.3;      // the attack clips' speed (3.71 s: ~2.6 s of wind-up)
const OCTO_STRIKE_AT = 3.4;        // s into an attack clip: the tentacle lands
const OCTO_HURT_RATE = 1.4;        // the Hurt clip's speed (~2.65 s to strike back)
const OCTO_FADE_S = 0.2;           // s crossfading clips
const OCTO_HP = 15;                // hits
const OCTO_DAMAGE = 1;             // health segments an unblocked tentacle takes
const OCTO_BLOCK_REACH = 1.0;      // m from where the tentacle lands the blade has to be
const OCTO_BLOCK_MIN_ANGLE_DEG = PLAYER_BLOCK_MIN_ANGLE_DEG; // a blade this near the swing's line lets it through
const OCTO_HIT_R = 1.6;            // m (flat) from its middle a sword tip hurts it, while it's hurt
const OCTO_HIT_TOP = 1.7;          // m over the water: higher swings miss
const OCTO_SWING_GAP_S = 0.18;     // s between two sword hits
// The slam's way in the octopus's own frame (+X its left, +Z toward the player): its left
// tentacle comes from up on its left down across to its right, the right one mirrored
const STRIKE_DIR = {
  left: new THREE.Vector3(-0.5, -0.9, 0).normalize(),
  right: new THREE.Vector3(0.5, -0.9, 0).normalize(),
};
const CLIPS = { swim: 'Swim', hurt: 'Hurt', left: 'Attack Left', right: 'Attack Right' };
const rand = (a, b) => a + Math.random() * (b - a);
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// T: the town's shared state + functions (createTownMode in townMode.js); ctx: the game
export function installTownOctopus(T, ctx) {
  let gltf = null;
  let loading = null;
  const load = () => {
    loading ??= new GLTFLoader().loadAsync(OCTOPUS_MODEL_URL).then((g) => {
      stylizeObject(g.scene);
      g.scene.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.frustumCulled = false; } });
      gltf = g;
    }).catch((err) => { console.warn('[townOctopus] model failed to load:', err); });
    return loading;
  };

  // The one octopus: { root, model, mixer, actions, action, state, t, x, z, yaw, y, hp, side,
  // struck, lastHitAt, lastSwing, proxy }
  let o = null;
  let nextRollAt = 0;      // T.simT of the next dice roll
  let wetSince = null;     // T.simT out on the water at night since
  let armedByUs = false;
  let toldHowTo = false;

  const waterY = (x, z) => ctx.getWaterY(x, z) ?? 0;
  // Where it holds the canoe: off its left (+1) or right (−1) side (o.boatSide), level with the
  // player (the canoe's local +X is its left)
  const canoeFront = () => {
    const c = T.canoePose?.();
    const p = ctx.getPlayerPosition();
    if (!c) return null;
    const s = o?.boatSide ?? 1;
    return { x: p.x + Math.cos(c.yaw) * OCTO_DIST * s, z: p.z - Math.sin(c.yaw) * OCTO_DIST * s };
  };
  // The camera turned to it (once — ctx.turnCameraTo eases it round)
  const lookAtIt = () => ctx.turnCameraTo?.(o.x, o.z);
  const play = (key, { rate = 1, once = false } = {}) => {
    const a = o.actions[key];
    if (!a) return;
    if (o.action && o.action !== a) o.action.fadeOut(OCTO_FADE_S);
    a.reset();
    a.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
    a.clampWhenFinished = once;
    a.timeScale = rate;
    a.fadeIn(o.action && o.action !== a ? OCTO_FADE_S : 0).play();
    o.action = a;
  };
  const setState = (state, t = 0) => { o.state = state; o.t = t; };

  const arm = (on) => {
    if (on === armedByUs) return;
    armedByUs = on;
    if (!on && !T.inCanoe()) return;
    T.setCanoeArmed?.(on);
  };

  // ── Coming and going ──
  const spawn = () => {
    if (o || !gltf || !T.inCanoe()) return false;
    const c = T.canoePose();
    for (let k = 0; k < 16; k++) {
      const a = Math.random() * Math.PI * 2;
      const r = rand(...OCTO_SPAWN_R);
      const x = c.x + Math.sin(a) * r;
      const z = c.z + Math.cos(a) * r;
      if ((ctx.waterDepth(x, z) ?? 0) < OCTO_MIN_DEPTH) continue;
      const model = cloneSkinned(gltf.scene);
      model.scale.setScalar(OCTO_SCALE);
      const root = new THREE.Group();
      root.name = 'town-octopus';
      root.add(model);
      ctx.scene.add(root);
      const mixer = new THREE.AnimationMixer(model);
      const actions = {};
      for (const [key, name] of Object.entries(CLIPS)) {
        const clip = gltf.animations.find((cl) => cl.name === name);
        if (clip) actions[key] = mixer.clipAction(clip);
      }
      o = { root, model, mixer, actions, action: null, state: 'peek', t: 0, x, z, yaw: Math.atan2(c.x - x, c.z - z), y: waterY(x, z) - OCTO_DEEP_SINK,
        hp: OCTO_HP, boatSide: Math.random() < 0.5 ? 1 : -1, side: 'left', struck: false, lastHitAt: -9, lastSwing: null, proxy: null };
      play('swim', { rate: 0.4 });
      place();
      // (ready ahead of it: the sword out, the camera turned to where it's peeking)
      arm(true);
      lookAtIt();
      return true;
    }
    return false;
  };
  const remove = () => {
    if (!o) return;
    o.mixer.stopAllAction();
    o.root.removeFromParent();
    o = null;
    nextRollAt = T.simT + OCTO_COOLDOWN_S;
  };
  // (beaten: the sword stays out and the player keeps facing it till they pick the oar)
  const flee = (why = null, { beaten = false } = {}) => {
    if (!o || o.state === 'flee') return;
    setState('flee');
    play('swim', { rate: 1.4 });
    if (beaten) {
      armedByUs = false;
      T.setCanoeArmed?.('untilOar');
    } else {
      arm(false);
      T.canoeFaceSide?.(0);
    }
    if (why) T.feedLine(why);
  };
  // (leaving Town)
  const resetOctopus = () => {
    remove();
    armedByUs = false;
    wetSince = null;
    nextRollAt = 0;
  };

  // ── Hurting it ──
  const damage = (n = 1) => {
    if (!engaged()) return false;
    o.hp -= n;
    ctx.playSfx?.('hit', headPos());
    ctx.spawnBlood?.(headPos(), waterY(o.x, o.z));
    if (o.hp <= 0) {
      // (reeling, sinking and backing off — then it swims away: updateOctopus)
      setState('dying');
      play('hurt', { rate: 1, once: true });
      T.feedLine('The octopus has had enough!');
      ctx.playSfx?.('splash', headPos());
      return true;
    }
    return false;
  };
  const _head = new THREE.Vector3();
  const headPos = () => _head.set(o.x, waterY(o.x, o.z) + 0.15, o.z);
  // A sword swing through it — only while it's reeling from a block (the Hurt clip)
  const octopusSwordHit = (tip, swingId) => {
    if (!o || o.state !== 'hurt') return false;
    if (T.simT - o.lastHitAt < OCTO_SWING_GAP_S || (swingId != null && o.lastSwing === swingId)) return false;
    if (Math.hypot(tip.x - o.x, tip.z - o.z) > OCTO_HIT_R || tip.y > waterY(o.x, o.z) + OCTO_HIT_TOP) return false;
    o.lastHitAt = T.simT;
    o.lastSwing = swingId;
    damage(1);
    return 'hit';
  };
  // Arrows / bombs (projectiles.js, blastEnemiesAt): a stand-in shaped like a stage enemy, with
  // a box the size of its body above the water
  const proxy = () => {
    if (!o.proxy) {
      const group = new THREE.Object3D();
      const box = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.6, 2.2), new THREE.MeshBasicMaterial({ visible: false }));
      box.position.y = 0.6;
      group.add(box);
      o.proxy = {
        group,
        get isDead() { return !engaged(); },
        applyDamage: (amount) => damage(Math.max(1, Math.round(amount || 1))),
        applyKnockback: () => {},
        applyDirectKnockback: () => {},
        applyBlastKnockback: () => {},
      };
    }
    o.proxy.group.position.set(o.x, waterY(o.x, o.z) - 0.4, o.z);
    o.proxy.group.updateMatrixWorld(true);
    return o.proxy;
  };
  const engaged = () => !!o && o.state !== 'peek' && o.state !== 'approach' && o.state !== 'dying' && o.state !== 'flee';
  const octopusWeaponTargets = () => (engaged() ? [proxy()] : []);
  const octopusMagicTargets = () => (engaged() ? [{
    center: headPos().clone(),
    radius: 1.2,
    blocks: () => false,
    onBlocked: () => {},
    onHit: () => damage(1),
  }] : []);
  // (the camera's auto-aim — T.threats)
  const octopusThreats = () => (engaged() ? [headPos().clone()] : []);

  // ── Its tentacle landing: blocked or not ──
  const _contact = new THREE.Vector3();
  const _swing = new THREE.Vector3();
  const _blade = new THREE.Vector3();
  const _view = new THREE.Vector3();
  const _q = new THREE.Quaternion();
  const _up = new THREE.Vector3(0, 1, 0);
  const strike = () => {
    const p = ctx.getPlayerPosition();
    _q.setFromAxisAngle(_up, o.yaw);
    _view.set(p.x - o.x, 0, p.z - o.z);
    const toward = _view.clone().normalize();
    // (where it lands: in front of the player's chest, on the side it comes from — its left is
    // the player's right)
    const sideSign = o.side === 'left' ? 1 : -1;
    const across = new THREE.Vector3(sideSign, 0, 0).applyQuaternion(_q);
    _contact.set(p.x, p.y + 1.0, p.z).addScaledVector(toward, -0.45).addScaledVector(across, 0.3);
    _swing.copy(STRIKE_DIR[o.side]).applyQuaternion(_q);
    const block = ctx.getPlayerBlock?.();
    const pts = block?.blade;
    let blocked = false;
    if (block?.blocking && pts?.length >= 2 && pts.some((pp) => pp.distanceTo(_contact) < OCTO_BLOCK_REACH)) {
      _blade.subVectors(pts[pts.length - 1], pts[0]);
      blocked = swingCrossesBlade(_swing, _blade, _view, OCTO_BLOCK_MIN_ANGLE_DEG);
    }
    if (blocked) {
      ctx.blockFlash?.();
      setState('hurt');
      play('hurt', { rate: OCTO_HURT_RATE, once: true });
      return;
    }
    ctx.hurtPlayer?.(OCTO_DAMAGE);
    ctx.playSfx?.('splash', _contact);
    T.canoeRock?.(headPos(), 1);
  };

  // ── Each frame ──
  const place = () => {
    o.root.position.set(o.x, o.y, o.z);
    o.root.rotation.y = o.yaw;
  };
  const turnTo = (x, z, dt, rate = 4) => {
    const want = Math.atan2(x - o.x, z - o.z);
    o.yaw += THREE.MathUtils.clamp(wrap(want - o.yaw), -rate * dt, rate * dt);
  };
  // (something to fight it with: the sword, the bow or the wand)
  const canCome = () => T.inCanoe() && T.isNight && !!ctx.hasWeapon?.() && !ctx.isPlayerDead() && !T.canoeHasPassenger?.() && !T.questJobActive?.()
    && !T.fishing && !T.jail && !T.inRoom && !T.sequence;

  const updateOctopus = (dt) => {
    // The dice
    if (!o) {
      if (!canCome()) { wetSince = null; return; }
      wetSince ??= T.simT;
      if (T.simT - wetSince < OCTO_FIRST_S || T.simT < nextRollAt) { if (!gltf) load(); return; }
      nextRollAt = T.simT + OCTO_CHECK_S;
      if (!gltf) { load(); return; }
      if (Math.random() < OCTO_CHANCE) spawn();
      if (!o) return;
      T.feedLine('Something is watching the canoe from the water…');
    }
    o.mixer.update(dt);
    o.t += dt;
    const surfaceY = waterY(o.x, o.z) - OCTO_SURFACE_SINK * 0.39 * OCTO_SCALE;
    // Off it goes when there's no canoe to go after (out, down, a room…)
    if (o.state !== 'flee' && o.state !== 'dying' && (!T.inCanoe() || ctx.isPlayerDead() || T.jail || T.inRoom || T.sequence)) flee();
    // Beaten: reeling (the Hurt clip), sinking and backing off from the player — then off it swims
    if (o.state === 'dying') {
      const p = ctx.getPlayerPosition();
      const dx = o.x - p.x;
      const dz = o.z - p.z;
      const d = Math.hypot(dx, dz) || 1;
      o.x += (dx / d) * OCTO_DYING_BACK * dt;
      o.z += (dz / d) * OCTO_DYING_BACK * dt;
      o.y -= OCTO_DYING_SINK * dt;
      place();
      if (o.t > OCTO_DYING_S) flee('It swims off into the dark.', { beaten: true });
      return;
    }
    // Peeking out of the water where it came up, watching the canoe — then it dives and swims in
    if (o.state === 'peek') {
      const c = T.canoePose?.();
      if (c) turnTo(c.x, c.z, dt, 2);
      const peekY = waterY(o.x, o.z) - OCTO_PEEK_SINK * 0.39 * OCTO_SCALE + Math.sin(T.simT * 1.4) * 0.05;
      o.y += (peekY - o.y) * (1 - Math.exp(-dt * 3 / OCTO_PEEK_RISE_S));
      if (!o.peeked && o.t > OCTO_PEEK_RISE_S * 0.5) {
        o.peeked = true;
        ctx.playSfx?.('splash', headPos());
      }
      place();
      if (o.t > OCTO_PEEK_S) { setState('approach'); play('swim'); }
      return;
    }
    if (o.state === 'flee') {
      const p = ctx.getPlayerPosition();
      turnTo(2 * o.x - p.x, 2 * o.z - p.z, dt, 2.5);
      o.x += Math.sin(o.yaw) * OCTO_FLEE_SPEED * dt;
      o.z += Math.cos(o.yaw) * OCTO_FLEE_SPEED * dt;
      o.y = THREE.MathUtils.lerp(o.y, waterY(o.x, o.z) - OCTO_DEEP_SINK - 1, 1 - Math.exp(-1.2 * dt));
      place();
      if (o.t > OCTO_FLEE_S) remove();
      return;
    }
    const front = canoeFront();
    if (!front) return;
    if (o.state === 'approach') {
      const dx = front.x - o.x;
      const dz = front.z - o.z;
      const d = Math.hypot(dx, dz);
      turnTo(front.x, front.z, dt, 3);
      const step = Math.min(d, OCTO_SWIM_SPEED * dt);
      o.x += (dx / (d || 1)) * step;
      o.z += (dz / (d || 1)) * step;
      const deep = THREE.MathUtils.clamp((d - 1) / OCTO_RISE_DIST, 0, 1);
      // (eased: diving from its peek, rising again near the canoe)
      o.y += (surfaceY - OCTO_DEEP_SINK * deep - o.y) * (1 - Math.exp(-OCTO_DIVE_RATE * dt));
      arm(true);
      if (d < 0.3) {
        setState('surface');
        T.canoeFaceSide?.(o.boatSide); // (the player turns to face it over the side)
        lookAtIt();
        ctx.playSfx?.('splash', headPos());
        T.canoeRock?.(headPos(), 0.35);
        if (!toldHowTo) {
          toldHowTo = true;
          T.feedLine('An octopus! Hold Block with your sword across its tentacle as it swings — then strike back while it reels.');
        } else T.feedLine('An octopus has the canoe!');
      }
      place();
      return;
    }
    // Holding the canoe: just off its bow, facing the player
    T.canoeStop?.();
    const k = 1 - Math.exp(-6 * dt);
    o.x += (front.x - o.x) * k;
    o.z += (front.z - o.z) * k;
    o.y += (surfaceY + Math.sin(T.simT * 1.6) * 0.05 - o.y) * k;
    const p = ctx.getPlayerPosition();
    turnTo(p.x, p.z, dt, 5);
    place();
    if (o.state === 'surface') {
      if (o.t > OCTO_SURFACE_S) { setState('wait', -rand(...OCTO_ATTACK_GAP_S)); play('swim', { rate: 0.5 }); }
    } else if (o.state === 'wait') {
      if (o.t > 0) {
        o.side = Math.random() < 0.5 ? 'left' : 'right';
        o.struck = false;
        setState('attack');
        lookAtIt();
        play(o.side, { rate: OCTO_ATTACK_RATE, once: true });
      }
    } else if (o.state === 'attack') {
      const at = o.action?.time ?? 0;
      if (!o.struck && at >= OCTO_STRIKE_AT) { o.struck = true; strike(); }
      else if (o.struck && (!o.action?.isRunning() || at >= o.action.getClip().duration - 0.01)) {
        setState('wait', -rand(...OCTO_ATTACK_GAP_S));
        play('swim', { rate: 0.5 });
      }
    } else if (o.state === 'hurt') {
      if (!o.action?.isRunning() || o.action.time >= o.action.getClip().duration - 0.01) {
        setState('wait', -rand(...OCTO_ATTACK_GAP_S));
        play('swim', { rate: 0.5 });
      }
    }
  };

  const octopusDebug = () => ({
    state: o?.state ?? null, hp: o?.hp ?? null, side: o?.side ?? null, loaded: !!gltf,
    spawn: () => (gltf ? spawn() : load().then(() => spawn())),
  });

  Object.assign(T, {
    updateOctopus, resetOctopus, octopusSwordHit, octopusWeaponTargets, octopusMagicTargets, octopusThreats, octopusDebug,
    octopusActive: () => !!o,
  });
}

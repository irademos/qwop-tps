// Story mode — a one-player story on Tree Island (MAPS.islandTown.islands `treeIsland`). Saved as
// it goes (signed in — guests save nothing): the step, what the player has, where they are.
//
// Chapter 1, "Washed Up":
//   1. Cut scene: black, a sound (STORY_SOUNDS.intro — add the file), then a fade in on the
//      village boy lying on the beach of Tree Island; he gets up (no stand-up clip yet — he just
//      stands), walks to a rock by the shore and stands on it (no sitting clip yet), takes out a
//      flute (items/flute.js) and plays (STORY_SOUNDS.flute). The Crow (crow.js) flies in.
//   2. The Crow: "Give me your flute." → Give the flute (game over: back to the start) /
//      Throw a rock (a side quest — later) / Ask for more information (it wants a fish first).
//   3. A fish: an old fishing rod lies up the beach, a canoe is pulled up on the shore. Fish
//      (Town's fishing — townFishing.js on a small stand-in state `F`, as the sea start does),
//      from the shore or the canoe, anywhere on the water.
//   4. Bring the Crow the fish → "To be continued…".
// The Crow is a recurring character: bring it fish for information and hints (later chapters).
//
// The layout is found on the island at run time (findLayout): the rock nearest its shore, the
// beach between them, the rod up the beach to one side, the canoe moored off it.
// UI: Town's (townMode.js / townJobs.js) — the top chip, the feed, the acts (bottom centre),
// the goods pill (the catch), the quest tracker, the talk as a subtitle read out with text to
// speech — and the game's own weapon buttons (Rod / Hands; Oar / Rod in the canoe).

import * as THREE from 'three';
import { registerTerrainHeightOverride } from '../environment/terrainHeight.js';
import { createCanoeBoat } from '../town/canoeBoat.js';
import { installTownFishing } from '../town/townFishing.js';
import { BAG_MAX, CANOE_BOARD_DIST, CANOE_SHORE_DIST, dist2, el } from '../town/townConfig.js';
import { createFishingRodModel } from '../items/fishingRod.js';
import { createFluteModel, disposeFluteModel, FLUTE_HAND_AT, FLUTE_LENGTH } from '../items/flute.js';
import { makeTextSprite } from '../village/villageMode.js';
import { createCrow } from './crow.js';
import { createJobTalk, createQuestTracker } from '../town/townJobs.js';
import { createSpeech } from '../audio/speech.js';

export const STORY_SAVE_VERSION = 1;
// Sounds (add the files; a missing one is just silent)
export const STORY_SOUNDS = {
  intro: '/assets/audio/story/intro.mp3',   // over the black at the start (waves, the wreck…)
  flute: '/assets/audio/story/flute.mp3',   // the boy's flute tune on the rock
  caw: '/assets/audio/story/crow_caw.mp3',  // the Crow
};

const ISLAND_KEY = 'treeIsland';
const BLACK_S = 4;            // s of black before the fade in
const FADE_IN_S = 3;
const LIE_S = 2.5;            // lying there once it's faded in
const GET_UP_S = 1.2;         // standing, before he walks
const WALK_SPEED = 1.1;       // m/s to the rock
const WALK_MAX_S = 25;
const FLUTE_OUT_S = 1;        // on the rock, before the flute comes out
const PLAY_BEFORE_CROW_S = 6; // playing before the Crow comes…
const BACK_SHOT_AT_S = 2.2;   // …cutting to a shot from behind him this far in (the Crow comes in on it)
const NOTE_EVERY_S = 0.6;     // ♪ off the flute
const NOTE_LIFE_S = 1.8;
const SEAT_RADIUS = 0.45;     // m: the stone he sits on (stands on, for now)…
const SEAT_TOP = 0.32;        // …and how high its top is over the sand
const CROW_FROM_DIST = 30;    // m out over the sea it comes from…
const CROW_FROM_UP = 10;      // …and this high
const TALK_DIST = 2.8;        // m from the Crow: Talk
const ROD_PICK_DIST = 2;      // m from the rod: Pick it up
const CUT_FOV = 50;
const SAVE_EVERY_S = 10;
const ACT_CHECK_S = 0.2;
const NOTE_MS = 5000;
const GAME_OVER_S = 3.5;
const FADE_OUT_S = 1.5;

const CROW = 'Crow';
const LINES = {
  arrive: [[CROW, 'Caw! What a pretty tune.'], [CROW, "That's a fine flute, boy. Give me your flute."]],
  give: [[CROW, 'Caw! A wise choice. Much obliged!']],
  info: [
    [CROW, "Information? Caw! Nothing's free on this island."],
    [CROW, "Bring me a fish first. Then we'll talk."],
    [CROW, "There's an old fishing rod up the beach, and a canoe on the shore. The fish are out in the water."],
  ],
  noFish: [[CROW, 'No fish, no talk. Caw!'], [CROW, 'The rod is up the beach. The canoe is on the shore.']],
  gotFish: [[CROW, 'A fish! Caw! For me? Oh, you shouldn\'t have.'], [CROW, "A deal's a deal. Now listen closely, boy…"]],
  done: [[CROW, 'Caw! More next time, boy.']],
};
const CHOICES = [
  { key: 'give', label: 'Give the flute' },
  { key: 'rock', label: 'Throw a rock' },
  { key: 'info', label: 'Ask for more information' },
];

const fresh = () => ({ v: STORY_SAVE_VERSION, at: 0, step: 'intro', hasRod: false, fish: 0, pos: null, canoe: null, inCanoe: false });

// ctx: the game (bootstrapGameApp.js — storyCtx)
export function createStoryMode(ctx) {
  let active = false;
  let ready = false;           // the save read, the island laid out
  let token = 0;               // a newer enter / exit wins over a load still going
  let S = fresh();             // the saved state
  let L = null;                // the layout on the island (findLayout)
  let simT = 0;
  let cut = null;              // the cut scene: { phase, t, … }
  let boat = null;
  let aboard = false;
  let unregisterFloor = null;
  let held = null;             // 'rod' | 'oar' | null
  let flute = null;            // the flute model (in the player's hands / the Crow's beak)
  let fluteHeld = false;
  let rodProp = null;          // the rod lying on the beach
  let ending = null;           // game over: { t }
  let saveAt = 0;
  let actAt = 0;
  let landSpot = null;         // in the canoe: dry ground to step onto
  const notes = [];            // ♪ sprites
  let noteAt = 0;
  const crow = createCrow({ scene: ctx.scene });

  // ── Sounds ──
  let introSound = null;
  let fluteSound = null;
  const stopSound = (a) => { try { a?.pause(); } catch (_) {} return null; };

  // ── Saving (signed in only) ──
  const snapshot = () => {
    const p = ctx.getPlayerModel()?.position;
    const yaw = ctx.getControls()?.yaw ?? 0;
    return {
      ...S,
      v: STORY_SAVE_VERSION,
      at: Date.now(),
      fish: F.goods.fish,
      pos: !cut && !aboard && p ? { x: +p.x.toFixed(2), z: +p.z.toFixed(2), yaw: +yaw.toFixed(3) } : S.pos,
      canoe: boat ? { x: +boat.x.toFixed(2), z: +boat.z.toFixed(2), yaw: +boat.yaw.toFixed(3) } : S.canoe,
      inCanoe: aboard,
    };
  };
  const save = () => {
    // (not before the save's been read and the island set up — it would write over it)
    if (!active || !ready || !ctx.canSave()) return;
    S = snapshot();
    ctx.save(S);
    saveAt = simT + SAVE_EVERY_S;
  };
  const setStep = (step) => { S.step = step; save(); };
  const onHidden = () => { if (document.visibilityState === 'hidden') save(); };

  // ── HUD: Town's (townMode.js) — the top chip, the feed, the acts, the goods pill, the quest
  // tracker and the talk as a subtitle (townJobs.js); the game's own weapon buttons for Rod /
  // Hands (Oar / Rod in the canoe — controls.js refreshActionButtons) ──
  const hud = el('div', 'town-hud story-hud');
  hud.id = 'story-hud';
  const top = el('div', 'town-top ui-panel');
  top.append(el('span', 'town-top-clock', 'Tree Island'));
  const feed = el('div', 'town-feed');
  const actsEl = el('div', 'town-acts hidden');
  const goodsEl = el('div', 'town-goods hidden');
  const fishEl = el('span', 'town-good');
  goodsEl.append(fishEl);
  const fade = el('div', 'story-fade');
  hud.append(top, feed, goodsEl, actsEl, fade);
  const tracker = createQuestTracker(hud);

  // The feed: a line under the health bar's spot, gone after NOTE_MS
  const note = (text) => {
    const line = el('div', 'town-feed-line', text);
    feed.prepend(line);
    while (feed.children.length > 3) feed.lastChild.remove();
    setTimeout(() => line.classList.add('town-feed-out'), NOTE_MS);
    setTimeout(() => line.remove(), NOTE_MS + 800);
  };
  const setFade = (k) => {
    fade.style.opacity = String(THREE.MathUtils.clamp(k, 0, 1));
    fade.classList.toggle('hidden', k <= 0.001);
  };

  // ── Voices: Town's text to speech (speech.js) — the Crow gruff, from where it stands ──
  const speech = createSpeech();
  const speakTalk = (text, { who, reply = false, interrupt = false, stop = false } = {}) => {
    if (stop) { speech.stop(); return; }
    if (reply) {
      speech.say(text, { key: 'player:story', kind: 'kid', priority: 'talk', interrupt });
      return;
    }
    speech.say(text, {
      key: who ?? CROW, kind: 'gruff', at: crow.isVisible() ? crow.position() : null,
      priority: 'talk', interrupt, falloff: { ref: 3, rolloff: 1, max: 30 },
    });
  };

  // ── Talk: Town's subtitle talk box, one line at a time; the last can end in choices ──
  const talkBox = createJobTalk(hud, { speak: speakTalk });
  let talk = null; // { lines, i, choices, onDone }
  const endTalk = (choice = null) => {
    const done = talk?.onDone;
    talk = null;
    talkBox.close();
    done?.(choice);
  };
  const showLine = () => {
    const [who, text] = talk.lines[talk.i];
    const last = talk.i >= talk.lines.length - 1;
    const choices = !last
      ? [{ label: 'Go on', primary: true, act: true, onClick: () => { talk.i += 1; showLine(); } }]
      : talk.choices
        ? talk.choices.map((c, i) => ({ label: c.label, primary: i === 0, onClick: () => endTalk(c.key) }))
        : [{ label: 'Okay', primary: true, act: true, onClick: () => endTalk() }];
    if (who === CROW) { crow.flutter(0.9); playCaw(); }
    talkBox.open({ who, text, choices });
  };
  const say = (lines, { choices = null, onDone = null } = {}) => {
    talk = { lines, i: 0, choices, onDone };
    showLine();
    refreshActs();
  };
  const talkAdvance = () => { talkBox.pressFirst(); };
  let cawAt = 0;
  const playCaw = () => {
    if (simT < cawAt) return;
    cawAt = simT + 2;
    ctx.playSound(STORY_SOUNDS.caw, { volume: 0.7 });
  };

  // ── The layout on the island ──
  const waterY = (x, z) => ctx.getWaterY(x, z) ?? 0;
  const dry = (x, z) => ctx.waterDepth(x, z) <= 0.02;
  // From (x, z): the nearest water (≥ 5 cm), looking round in `n` directions out to `max` m
  const nearestWater = (x, z, max = 60, n = 48) => {
    let best = null;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      const dx = Math.sin(a);
      const dz = Math.cos(a);
      for (let d = 0.75; d <= max; d += 0.75) {
        if (best && d >= best.d) break;
        if (ctx.waterDepth(x + dx * d, z + dz * d) > 0.05) { best = { d, dx, dz }; break; }
      }
    }
    return best;
  };
  const findLayout = (island) => {
    const r = island.radius + 30;
    const objs = ctx.getMapObjects({ minX: island.at.x - r, maxX: island.at.x + r, minZ: island.at.z - r, maxZ: island.at.z + r });
    // The rock nearest the shore, with a little beach in front of it
    let rock = null;
    for (const o of objs) {
      if (!/rock/i.test(o.file) || !dry(o.x, o.z)) continue;
      const w = nearestWater(o.x, o.z, 40);
      if (!w || w.d < o.radius + 3) continue;
      if (!rock || w.d - o.radius < rock.w.d - rock.o.radius) rock = { o, w };
    }
    let centre;
    let rockR;
    let w;
    if (rock) {
      centre = { x: rock.o.x, z: rock.o.z };
      rockR = rock.o.radius;
      w = rock.w;
    } else {
      // (no rock: a spot a few m in from the island's nearest shore)
      const c = nearestWater(island.at.x, island.at.z, island.radius + 40, 72);
      if (!c) return null;
      const d = Math.max(0, c.d - 8);
      centre = { x: island.at.x + c.dx * d, z: island.at.z + c.dz * d };
      rockR = 0.5;
      w = nearestWater(centre.x, centre.z, 40) ?? { d: 8, dx: c.dx, dz: c.dz };
    }
    const dir = { x: w.dx, z: w.dz };          // rock → sea
    const tan = { x: -dir.z, z: dir.x };       // along the shore
    const at = (d, s = 0) => ({ x: centre.x + dir.x * d + tan.x * s, z: centre.z + dir.z * d + tan.z * s });
    // The beach: just short of the water
    let washD = w.d - 0.8;
    while (washD > rockR + 1 && !dry(at(washD).x, at(washD).z)) washD -= 0.4;
    const wash = at(washD);
    const seaYaw = Math.atan2(dir.x, dir.z);
    // The rock he sits on: a stone up the beach from where he washed up, a little to one side
    // (the island's own rocks are boulders — this one is ours, SEAT_*)
    let seat = null;
    for (const [d, sd] of [[washD - 4.5, 2.5], [washD - 4.5, -2.5], [washD - 3.5, 0], [washD - 2.5, 1.5]]) {
      const p = at(Math.max(rockR + SEAT_RADIUS + 0.5, d), sd);
      if (dry(p.x, p.z) && dry(p.x + dir.x * 1.2, p.z + dir.z * 1.2)) { seat = p; break; }
    }
    seat ??= at(Math.max(rockR + 1, washD - 3));
    const seatD = (seat.x - centre.x) * dir.x + (seat.z - centre.z) * dir.z;
    const seatS = (seat.x - centre.x) * tan.x + (seat.z - centre.z) * tan.z;
    // The Crow lands on the beach beside it, a little toward the sea
    let crowSpot = null;
    for (const [d, sd] of [[0.5, 1.4], [0.5, -1.4], [0, 1.6], [0, -1.6], [1.2, 0]]) {
      const p = at(Math.min(seatD + d, washD - 0.3), seatS + sd);
      if (dry(p.x, p.z)) { crowSpot = p; break; }
    }
    crowSpot ??= at(seatD - 1.2, seatS);
    // The rod: up the beach to one side
    let rodSpot = null;
    for (const s of [rockR + 3, -(rockR + 3), rockR + 5, -(rockR + 5), rockR + 2]) {
      for (const d of [washD * 0.6, washD * 0.4, 0]) {
        const p = at(d, s);
        if (dry(p.x, p.z) && dry(p.x + 0.6, p.z) && dry(p.x - 0.6, p.z)) { rodSpot = p; break; }
      }
      if (rodSpot) break;
    }
    rodSpot ??= at(washD * 0.5, rockR + 2);
    // The canoe: off the beach along the shore, the other side of the rock from the rod
    const side = rodSpot && (rodSpot.x - centre.x) * tan.x + (rodSpot.z - centre.z) * tan.z > 0 ? -1 : 1;
    const probe = createCanoeBoat({ waterY, waterDepth: ctx.waterDepth });
    const yaw = Math.atan2(tan.x, tan.z);
    let mooring = null;
    for (let d = w.d + 1.5; d <= w.d + 25 && !mooring; d += 0.5) {
      for (const s of [6, 8, 4, 10, 2, 13, 0]) {
        const p = at(d, s * side);
        if (probe.fits(p.x, p.z, yaw)) { mooring = { ...p, yaw }; break; }
      }
    }
    probe.dispose();
    return {
      rock: { ...centre, radius: rockR },
      seat,
      wash, seaYaw, dir, crowSpot, rodSpot,
      mooring: mooring ?? { ...at(w.d + 3, 6 * side), yaw },
      crowFrom: at(w.d + CROW_FROM_DIST, -12),
    };
  };
  const groundAt = (p) => new THREE.Vector3(p.x, ctx.getGroundY(p.x, p.z), p.z);

  // ── The flute: held sideways like a flute — the embouchure at his lips, out to his right
  // (the player group's −X; +X is his left), a little forward and down, holes up, both hands
  // under it on the holes ──
  const _handL = new THREE.Vector3();
  const _handR = new THREE.Vector3();
  const _fluteBase = new THREE.Quaternion();
  const _fluteBob = new THREE.Quaternion();
  const _fluteZ = new THREE.Vector3(0, 0, 1);
  // The character's height in the player group's own frame (its GLB, not the hands / gear)
  const playerHeight = () => {
    const pm = ctx.getPlayerModel();
    const body = pm?.userData?.qwopRig?.glbCharacter?.scene;
    if (!body) return 0.8;
    pm.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(body);
    if (box.isEmpty()) return 0.8;
    const top = pm.worldToLocal(new THREE.Vector3(pm.position.x, box.max.y, pm.position.z)).y;
    return THREE.MathUtils.clamp(top, 0.4, 2.5);
  };
  let fluteH = 0.8;
  const holdFlute = (on) => {
    const pm = ctx.getPlayerModel();
    if (!pm) return;
    if (on) {
      if (!flute) flute = createFluteModel();
      fluteH = playerHeight();
      const k = THREE.MathUtils.clamp(fluteH / 1.0, 0.5, 1.4);
      flute.scale.setScalar(k);
      // (basis: along = out to the right, a little forward and down; up = holes up)
      const zAxis = new THREE.Vector3(-1, -0.2, 0.32).normalize();
      const xAxis = new THREE.Vector3(0, 1, 0).cross(zAxis).normalize();
      const yAxis = zAxis.clone().cross(xAxis).normalize();
      _fluteBase.setFromRotationMatrix(new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis));
      flute.quaternion.copy(_fluteBase);
      flute.position.set(-fluteH * 0.02, fluteH * 0.82, fluteH * 0.1);
      pm.add(flute);
      // Hands under the tube on the holes: the near one (the anatomical left — the game 'right'
      // hand) by the lips, the far one (the game 'left' hand) further out
      const at = (d) => zAxis.clone().multiplyScalar(d * k).add(flute.position).addScaledVector(yAxis, -0.03 * k);
      _handR.copy(at(FLUTE_HAND_AT[0]));
      _handL.copy(at(FLUTE_HAND_AT[1]));
      pm.userData.handPose = { left: _handL, right: _handR };
    } else {
      if (flute?.parent === pm) pm.remove(flute);
      pm.userData.handPose = null;
    }
    fluteHeld = !!on;
  };
  // The tune: the flute bobs a little, ♪ float off it
  const updateFlute = (dt) => {
    if (fluteHeld && flute) {
      // (a little sway with the tune)
      _fluteBob.setFromAxisAngle(_fluteZ, Math.sin(simT * 2.3) * 0.05);
      flute.quaternion.copy(_fluteBase).multiply(_fluteBob);
      if (simT >= noteAt) {
        noteAt = simT + NOTE_EVERY_S * (0.7 + Math.random() * 0.6);
        const s = makeTextSprite(Math.random() < 0.5 ? '♪' : '♫', { height: 0.16, bg: 'rgba(0,0,0,0)', border: 'rgba(0,0,0,0)', color: '#fff6d8' });
        const tip = new THREE.Vector3(0, 0, FLUTE_LENGTH);
        flute.localToWorld(tip);
        s.position.copy(tip);
        s.userData.t = 0;
        s.userData.v = new THREE.Vector3((Math.random() - 0.5) * 0.3, 0.45, (Math.random() - 0.5) * 0.3);
        ctx.scene.add(s);
        notes.push(s);
      }
    }
    for (let i = notes.length - 1; i >= 0; i--) {
      const s = notes[i];
      s.userData.t += dt;
      s.position.addScaledVector(s.userData.v, dt);
      s.position.x += Math.sin(s.userData.t * 4 + i) * 0.003;
      s.material.opacity = 1 - s.userData.t / NOTE_LIFE_S;
      if (s.userData.t >= NOTE_LIFE_S) {
        s.parent?.remove(s);
        s.material.map?.dispose();
        s.material.dispose();
        notes.splice(i, 1);
      }
    }
  };
  const clearNotes = () => {
    for (const s of notes) { s.parent?.remove(s); s.material.map?.dispose(); s.material.dispose(); }
    notes.length = 0;
  };

  // ── The stone he sits on: a low rounded rock, its top is ground (a height override) ──
  let seatProp = null;
  let seatY = 0;
  let unregisterSeat = null;
  const seatFloor = (x, z) => (seatProp && dist2(x, z, L.seat.x, L.seat.z) < SEAT_RADIUS * 0.8 ? seatY + SEAT_TOP : undefined);
  const placeSeat = () => {
    removeSeat();
    seatY = ctx.getGroundY(L.seat.x, L.seat.z);
    const geo = new THREE.DodecahedronGeometry(1, 1);
    // (lumpy: each vertex pushed in / out a little, the same for shared corners)
    const pos = geo.attributes.position;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const n = Math.sin(v.x * 5.1 + v.z * 3.7) * 0.5 + Math.cos(v.y * 4.3 - v.x * 2.9) * 0.5;
      v.multiplyScalar(1 + n * 0.08);
      pos.setXYZ(i, v.x, v.y, v.z);
    }
    geo.computeVertexNormals();
    seatProp = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x8d8a80, roughness: 0.95, flatShading: true }));
    seatProp.name = 'story-seat';
    seatProp.scale.set(SEAT_RADIUS, SEAT_TOP * 1.4, SEAT_RADIUS * 0.85);
    seatProp.position.set(L.seat.x, seatY + SEAT_TOP * 0.3, L.seat.z);
    seatProp.rotation.y = 0.7;
    seatProp.castShadow = true;
    seatProp.receiveShadow = true;
    ctx.scene.add(seatProp);
    unregisterSeat = registerTerrainHeightOverride(seatFloor);
  };
  const removeSeat = () => {
    unregisterSeat?.();
    unregisterSeat = null;
    if (!seatProp) return;
    seatProp.parent?.remove(seatProp);
    seatProp.geometry.dispose();
    seatProp.material.dispose();
    seatProp = null;
  };

  // ── The rod on the beach ──
  const placeRod = () => {
    removeRod();
    // (it's there once the Crow has told him about it)
    if (S.hasRod || !L || (S.step !== 'fish' && S.step !== 'done')) return;
    rodProp = new THREE.Group();
    rodProp.name = 'story-rod';
    // (lying flat on the sand: the model runs along +Z from its grip)
    const rod = createFishingRodModel();
    rod.rotation.set(-0.04, 0.6, 0);
    rodProp.add(rod);
    const g = groundAt(L.rodSpot);
    rodProp.position.set(g.x, g.y + 0.03, g.z);
    rodProp.add(makeGlint());
    ctx.scene.add(rodProp);
  };
  const removeRod = () => {
    if (!rodProp) return;
    rodProp.parent?.remove(rodProp);
    rodProp.traverse((o) => { o.geometry?.dispose?.(); o.material?.dispose?.(); });
    rodProp = null;
  };
  let glintTex = null;
  const makeGlint = () => {
    if (!glintTex) {
      const c = document.createElement('canvas');
      c.width = c.height = 64;
      const g = c.getContext('2d');
      const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      grad.addColorStop(0, 'rgba(255,250,220,1)');
      grad.addColorStop(0.3, 'rgba(255,240,180,0.5)');
      grad.addColorStop(1, 'rgba(255,240,180,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, 64, 64);
      glintTex = new THREE.CanvasTexture(c);
      glintTex.colorSpace = THREE.SRGBColorSpace;
    }
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glintTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    s.name = 'glint';
    s.position.y = 0.15;
    return s;
  };
  const pickUpRod = () => {
    if (S.hasRod) return;
    S.hasRod = true;
    removeRod();
    note('You found an old fishing rod.');
    ctx.refreshButtons();
    pick('rod');
    renderCatch();
    save();
  };

  // ── Fishing: Town's (townFishing.js) on a stand-in for the town's state, as the sea start ──
  const isWater = (x, z) => !(boat && boat.floorAt(x, z) !== undefined) && ctx.waterDepth(x, z) > 0.4;
  const F = {
    hud,
    simT: 0,
    fishing: null,
    sequence: null,
    jail: null,
    goods: { fish: 0 },
    fishAnywhere: () => active && held === 'rod' && !cut,
    fishWater: (x, z) => isWater(x, z),
    layout: { places: { fishSpot: null }, nav: { indexAt: (x, z) => ({ x, z }), isWater: (p) => isWater(p.x, p.z) } },
    playerPos: () => ctx.getPlayerModel().position,
    feedLine: (text) => note(text),
    bagRoom: () => Math.max(0, BAG_MAX - F.goods.fish),
    bagFullNote: () => note(`You can't carry any more fish (${BAG_MAX}).`),
    gain: (g, n = 1) => {
      const got = Math.min(n, F.bagRoom());
      if (got < n) F.bagFullNote();
      F.goods[g] = (F.goods[g] ?? 0) + got;
      renderCatch();
      if (got > 0 && g === 'fish') {
        if (S.step === 'fish') note('A fish! Take it to the Crow.');
        save();
      }
      return got;
    },
    introNote: () => {},
    calmNow: () => true,
    stalls: { focused: () => false },
    marketPanel: { isOpen: () => false },
    jobTalk: { isOpen: () => false },
  };
  // The goods pill (Town's): the catch, once there's a rod or a fish
  const renderCatch = () => {
    fishEl.textContent = `🐟 ${F.goods.fish}`;
    goodsEl.classList.toggle('hidden', !F.goods.fish && !S.hasRod);
    renderTracker();
  };
  // The quest tracker (Town's): what the Crow wants
  const renderTracker = () => {
    if (S.step !== 'fish') { tracker.render([]); return; }
    tracker.render([F.goods.fish > 0
      ? { icon: '❓', title: 'A fish for the Crow', progress: 'Take it to the Crow' }
      : { icon: '📍', title: 'A fish for the Crow', progress: S.hasRod ? 'Catch a fish' : 'Find the rod up the beach' }]);
  };
  installTownFishing(F, {
    scene: ctx.scene,
    getPlayerModel: ctx.getPlayerModel,
    getRodModel: ctx.getRodModel,
    isRodEquipped: () => active && held === 'rod' && !!ctx.getRodModel(),
    isPlayerDead: () => false,
    getWaterY: (x, z) => waterY(x, z),
    getGroundY: ctx.getGroundY,
    hasGyro: ctx.hasGyro,
    takeReel: ctx.takeReel,
    isPhoneConnected: ctx.isPhoneConnected,
    refreshPhone: ctx.refreshPhone,
  });
  const stopFishing = () => {
    F.fishing = null;
    F.stopFishingRig();
    F.hideFishingHud();
  };

  // ── What's in hand: the rod, the oar (in the canoe), or nothing ──
  const faceFor = (kind) => {
    const s = boat.standPoint();
    let yaw = boat.yaw;
    if (kind === 'rod') {
      // (over the side with more water out from it)
      const depthOut = (a) => {
        let sum = 0;
        for (const r of [2, 4, 7]) sum += Math.min(3, ctx.waterDepth(s.x + Math.sin(a) * r, s.z + Math.cos(a) * r));
        return sum;
      };
      const right = boat.yaw - Math.PI / 2;
      const left = boat.yaw + Math.PI / 2;
      yaw = depthOut(left) > depthOut(right) + 0.2 ? left : right;
    }
    ctx.teleport(s.x, s.z, yaw);
  };
  // (what's in hand changes from here or from the game's own weapon buttons / the phone:
  // onHeld catches up each frame — in the canoe it's the oar or the rod, facing for each)
  const onHeld = (kind) => {
    if (kind !== 'rod' && F.fishing) stopFishing();
    held = kind;
    if (aboard) {
      if (!kind) { ctx.hold('oar'); held = ctx.heldKind(); }
      faceFor(held);
    }
    actAt = 0;
    ctx.refreshPhone();
  };
  const pick = (kind) => {
    if (!active || cut || ending) return;
    if (kind === 'rod' && !S.hasRod) return;
    if (aboard && !kind) kind = 'oar';
    if (!aboard && kind === 'oar') return;
    ctx.hold(kind);
    onHeld(ctx.heldKind());
  };

  // ── The canoe ──
  const floorAt = (x, z) => (aboard && boat ? boat.floorAt(x, z) : undefined);
  const pin = (c) => {
    if (!aboard || !boat) return;
    const s = boat.standPoint();
    c.playerX = s.x;
    c.playerZ = s.z;
  };
  const setupBoat = () => {
    disposeBoat();
    const m = S.canoe ?? L.mooring;
    boat = createCanoeBoat({ waterY, waterDepth: ctx.waterDepth, x: m.x, z: m.z, yaw: m.yaw });
    if (!boat.fits(boat.x, boat.z, boat.yaw)) Object.assign(boat, { x: L.mooring.x, z: L.mooring.z, yaw: L.mooring.yaw });
    boat.place(0);
    ctx.scene.add(boat.group);
  };
  const disposeBoat = () => {
    if (!boat) return;
    boat.group.parent?.remove(boat.group);
    boat.dispose();
    boat = null;
  };
  const board = () => {
    if (!boat || aboard) return;
    if (F.fishing) stopFishing();
    aboard = true;
    landSpot = null;
    unregisterFloor = registerTerrainHeightOverride(floorAt);
    const s = boat.standPoint();
    ctx.teleport(s.x, s.z, boat.yaw);
    ctx.holdStill(true);
    ctx.setPositionConstraint(pin);
    pick('oar');
    ctx.refreshButtons();
    save();
  };
  const findLandSpot = () => {
    const s = boat.standPoint();
    for (let r = 1; r <= CANOE_SHORE_DIST; r += 0.5) {
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        const x = s.x + Math.sin(a) * r;
        const z = s.z + Math.cos(a) * r;
        if (ctx.waterDepth(x, z) > 0) continue;
        const g = ctx.getGroundY(x, z);
        if (Number.isFinite(g) && g - waterY(x, z) < 1.5) return { x, z, yaw: Math.atan2(x - s.x, z - s.z) };
      }
    }
    return null;
  };
  const leaveBoat = (spot = landSpot) => {
    if (!aboard) return;
    if (F.fishing) stopFishing();
    aboard = false;
    unregisterFloor?.();
    unregisterFloor = null;
    ctx.holdStill(false);
    ctx.setPositionConstraint(null);
    boat?.stop();
    if (spot) ctx.teleport(spot.x, spot.z, spot.yaw);
    held = null;
    ctx.hold(null);
    landSpot = null;
    ctx.refreshButtons();
    save();
  };

  // ── The acts (Town's: up to 3 buttons bottom centre, the first on E / Enter / the phone's interact) ──
  let acts = [];
  let actsKey = '';
  let lobbyOfferUntil = 0;     // after "To be continued…": Back to Lobby among the acts a while
  const computeActs = () => {
    if (cut || ending || talk) return [];
    const p = ctx.getPlayerModel().position;
    const out = [];
    // (fishing without a gyro: Cast / Pull — Town's)
    if (held === 'rod') out.push(...F.fishingActs(true).map((a) => ({ key: a.key, label: a.label, run: a.onClick })));
    if (aboard) {
      if (landSpot) out.push({ key: 'out', label: 'Get out', run: () => leaveBoat() });
    } else {
      // (the nearest of what's in reach)
      const near = [];
      const within = (x, z, r) => { const d = dist2(p.x, p.z, x, z); return d < r ? d : null; };
      if (crow.isLanded() && (S.step === 'crow' || S.step === 'fish' || S.step === 'done')) {
        const d = within(crow.position().x, crow.position().z, TALK_DIST);
        if (d != null) near.push({ d, key: 'crow', label: 'Talk to the Crow', run: talkToCrow });
      }
      if (!S.hasRod && rodProp) {
        const d = within(rodProp.position.x, rodProp.position.z, ROD_PICK_DIST);
        if (d != null) near.push({ d, key: 'rod', label: 'Pick up the rod', run: pickUpRod });
      }
      if (boat && !F.fishing) {
        const d = within(boat.x, boat.z, CANOE_BOARD_DIST);
        if (d != null) near.push({ d, key: 'canoe', label: 'Get in the canoe', run: board });
      }
      near.sort((a, b) => a.d - b.d);
      if (near[0]) out.push(near[0]);
    }
    if (simT < lobbyOfferUntil) out.push({ key: 'lobby', label: 'Back to Lobby', run: () => ctx.onLobby() });
    return out.slice(0, 3);
  };
  const refreshActs = () => {
    acts = computeActs();
    const key = acts.map((a) => `${a.key}|${a.label}`).join(',');
    if (key === actsKey) return;
    actsKey = key;
    actsEl.replaceChildren(...acts.map((a, i) => {
      const b = el('button', `${i > 0 ? 'ui-btn-secondary' : 'ui-btn'} town-act`, a.label);
      b.type = 'button';
      b.addEventListener('click', (e) => { e.stopPropagation(); if (active) { a.run(); actAt = 0; } });
      return b;
    }));
    actsEl.classList.toggle('hidden', !acts.length);
  };
  const onKey = (e) => {
    if (!active || e.repeat || (e.key !== 'Enter' && e.key !== 'e' && e.key !== 'E')) return;
    if (e.target?.closest?.('input, textarea, select')) return;
    if (document.body.classList.contains('settings-open')) return;
    if (talk) { e.preventDefault(); talkAdvance(); return; }
    if (acts[0]) { e.preventDefault(); acts[0].run(); actAt = 0; }
  };

  // ── The Crow ──
  const crowFeet = () => groundAt(L.crowSpot);
  const placeCrow = () => {
    crow.landAt(crowFeet());
    crow.faceNow(L.seat);
    crow.lookAt(ctx.getPlayerModel().position);
  };
  const crowChoices = () => say(LINES.arrive.slice(1), { choices: CHOICES, onDone: onChoice });
  const talkToCrow = () => {
    crow.lookAt(ctx.getPlayerModel().position);
    if (S.step === 'crow') crowChoices();
    else if (S.step === 'fish') {
      if (F.goods.fish > 0) {
        say(LINES.gotFish, {
          onDone: () => {
            F.goods.fish -= 1;
            setStep('done');
            renderCatch();
            toBeContinued();
          },
        });
      } else say(LINES.noFish);
    } else if (S.step === 'done') say(LINES.done, { onDone: toBeContinued });
  };
  const onChoice = (key) => {
    if (key === 'give') giveFlute();
    else if (key === 'rock') {
      note('Throwing a rock at the Crow — that side quest is coming later.');
      crowChoices();
    } else if (key === 'info') {
      say(LINES.info, {
        onDone: () => {
          holdFlute(false);
          fluteSound = stopSound(fluteSound);
          endCut();
          setStep('fish');
          placeRod();
          renderCatch();
          note('Find the rod up the beach and catch the Crow a fish.');
        },
      });
    }
  };
  const toBeContinued = () => {
    ctx.showBanner('To be continued…', 'Chapter 1 — Washed Up', 6000);
    lobbyOfferUntil = simT + 30;
    actAt = 0;
  };
  // Give the flute: the Crow takes it and flies off — game over, back to the very start
  const giveFlute = () => {
    say(LINES.give, {
      onDone: () => {
        fluteSound = stopSound(fluteSound);
        const pm = ctx.getPlayerModel();
        if (flute?.parent === pm) pm.remove(flute);
        pm.userData.handPose = null;
        fluteHeld = false;
        if (flute) crow.carry(flute);
        crow.lookAt(null);
        crow.flyAway(groundAt(L.crowFrom).setY(waterY(L.crowFrom.x, L.crowFrom.z) + CROW_FROM_UP + 10));
        ending = { t: 0 };
        actAt = 0;
      },
    });
  };
  const updateEnding = (dt) => {
    if (!ending) return;
    ending.t += dt;
    if (ending.t > 2.2 && !ending.shown) {
      ending.shown = true;
      ctx.showBanner('GAME OVER', 'The Crow flew off with your flute.', GAME_OVER_S * 1000);
    }
    const outAt = 2.2 + GAME_OVER_S;
    if (ending.t > outAt) setFade((ending.t - outAt) / FADE_OUT_S);
    if (ending.t > outAt + FADE_OUT_S + 0.3) {
      ending = null;
      restart();
    }
  };

  // ── The cut scene ──
  const lockPlayer = (on) => ctx.holdStill(on);
  const startCut = () => {
    if (aboard) leaveBoat(null);
    held = null;
    ctx.hold(null);
    holdFlute(false);
    crow.hide();
    crow.carry(null);
    if (cut?.fov) { ctx.camera.fov = cut.fov; ctx.camera.updateProjectionMatrix(); }
    cut = { phase: 'black', t: 0 };
    lockPlayer(true);
    setFade(1);
    // Washed up on the beach, lying there (the death clip's last frame), facing up the beach
    const yaw = L.seaYaw + Math.PI;
    ctx.teleport(L.wash.x, L.wash.z, yaw);
    ctx.lieDown();
    introSound = ctx.playSound(STORY_SOUNDS.intro, { volume: 0.9 });
    actAt = 0;
  };
  const endCut = () => {
    if (cut?.fov) { ctx.camera.fov = cut.fov; ctx.camera.updateProjectionMatrix(); }
    cut = null;
    lockPlayer(false);
    setFade(0);
    actAt = 0;
  };
  const _camPos = new THREE.Vector3();
  const _camLook = new THREE.Vector3();
  const cutCamera = (dt, snap = false) => {
    const pm = ctx.getPlayerModel();
    const p = pm.position;
    const d = L.dir;
    const side = { x: -d.z, z: d.x };
    let pos;
    let look;
    let shot = 'side';
    if (cut.phase === 'black' || cut.phase === 'fade' || cut.phase === 'lie' || cut.phase === 'up') {
      // Low over the sand, from the side, the sea behind him
      pos = _camPos.set(p.x + side.x * 2.6 + d.x * 1.0, p.y + 1.1, p.z + side.z * 2.6 + d.z * 1.0);
      look = _camLook.set(p.x, p.y + 0.3, p.z);
    } else if (cut.phase === 'talk' && crow.isLanded()) {
      // Him on the stone and the Crow beside it, from the sea
      const c = crow.position();
      look = _camLook.set((p.x + c.x) / 2, p.y + 0.35, (p.z + c.z) / 2);
      pos = _camPos.set(look.x + d.x * 4.4 + side.x * 0.8, p.y + 1.3, look.z + d.z * 4.4 + side.z * 0.8);
    } else if ((cut.phase === 'play' && cut.t >= BACK_SHOT_AT_S) || cut.phase === 'crow') {
      // From behind him, a little to one side and low, looking past him out to sea (a cut, not
      // a pan); the Crow comes in over the water toward him
      shot = 'back';
      const cx = p.x - d.x * 2.3 + side.x * 0.7;
      const cz = p.z - d.z * 2.3 + side.z * 0.7;
      // (the beach rises behind him: kept clear of the ground there)
      const cy = Math.max(p.y + 0.95, ctx.getGroundY(cx, cz) + 0.7);
      pos = _camPos.set(cx, cy, cz);
      look = _camLook.set(p.x + d.x * 3, p.y + 0.75 - (cy - p.y - 0.95) * 0.5, p.z + d.z * 3);
    } else {
      // From the sea side, a little off, him and the stone in view
      pos = _camPos.set(p.x + d.x * 4.2 + side.x * 2.4, p.y + 1.7, p.z + d.z * 4.2 + side.z * 2.4);
      look = _camLook.set(p.x + d.x * 0.6, p.y + 0.6, p.z + d.z * 0.6);
      if (crow.isVisible() && cut.phase === 'crow' && crow.position().distanceTo(p) < 14) look.lerp(crow.position(), 0.25);
    }
    // (a new shot cuts straight to it)
    if (cut.shot && cut.shot !== shot && (shot === 'back' || cut.shot === 'back')) snap = true;
    cut.shot = shot;
    const k = snap ? 1 : 1 - Math.exp(-2.5 * dt);
    if (!cut.camPos) {
      cut.camPos = pos.clone();
      cut.camLook = look.clone();
      cut.fov = ctx.camera.fov;
    }
    // (a narrower lens than the game's while it plays — the controls ease theirs back after)
    ctx.camera.fov = CUT_FOV;
    ctx.camera.updateProjectionMatrix();
    cut.camPos.lerp(pos, k);
    cut.camLook.lerp(look, k);
    ctx.camera.position.copy(cut.camPos);
    ctx.camera.lookAt(cut.camLook);
  };
  const updateCut = (dt) => {
    cut.t += dt;
    const c = ctx.getControls();
    switch (cut.phase) {
      case 'black':
        setFade(1);
        if (cut.t >= BLACK_S) { cut.phase = 'fade'; cut.t = 0; }
        break;
      case 'fade':
        setFade(1 - cut.t / FADE_IN_S);
        if (cut.t >= FADE_IN_S) { setFade(0); cut.phase = 'lie'; cut.t = 0; }
        break;
      case 'lie':
        if (cut.t >= LIE_S) { ctx.standUp(); cut.phase = 'up'; cut.t = 0; }
        break;
      case 'up':
        if (cut.t >= GET_UP_S) { cut.phase = 'walk'; cut.t = 0; }
        break;
      case 'walk': {
        // To the stone, then up onto it
        const p = ctx.getPlayerModel().position;
        const dx = L.seat.x - p.x;
        const dz = L.seat.z - p.z;
        const dist = Math.hypot(dx, dz);
        const step = WALK_SPEED * dt;
        if (dist <= step + 0.05 || cut.t > WALK_MAX_S) {
          ctx.teleport(L.seat.x, L.seat.z, L.seaYaw);
          cut.phase = 'stand';
          cut.t = 0;
        } else if (c) {
          const yaw = Math.atan2(dx, dz);
          c.playerX = p.x + (dx / dist) * step;
          c.playerZ = p.z + (dz / dist) * step;
          c.yaw = yaw;
        }
        break;
      }
      case 'stand':
        if (c) c.yaw = L.seaYaw;
        if (cut.t >= FLUTE_OUT_S) {
          holdFlute(true);
          fluteSound = ctx.playSound(STORY_SOUNDS.flute, { volume: 0.8, loop: true });
          cut.phase = 'play';
          cut.t = 0;
        }
        break;
      case 'play':
        if (cut.t >= PLAY_BEFORE_CROW_S) {
          cut.phase = 'crow';
          cut.t = 0;
          const from = groundAt(L.crowFrom);
          from.y = waterY(L.crowFrom.x, L.crowFrom.z) + CROW_FROM_UP;
          crow.flyIn(from, crowFeet(), () => {
            crow.lookAt(ctx.getPlayerModel().position);
            cut.phase = 'talk';
            fluteSound = stopSound(fluteSound);
            setStep('crow');
            say(LINES.arrive, { choices: CHOICES, onDone: onChoice });
          });
          playCaw();
        }
        break;
      case 'talk':
        // (turned to the Crow)
        if (c && crow.isLanded()) {
          const p = ctx.getPlayerModel().position;
          const want = Math.atan2(crow.position().x - p.x, crow.position().z - p.z);
          c.yaw += Math.atan2(Math.sin(want - c.yaw), Math.cos(want - c.yaw)) * Math.min(1, dt * 4);
        }
        break;
      default:
        break;
    }
    if (cut) cutCamera(dt);
  };

  // ── Lifecycle ──
  const restart = () => {
    S = fresh();
    F.goods.fish = 0;
    renderCatch();
    removeRod();
    setupBoat();
    save();
    startCut();
  };
  // Put the player back where the save left them
  const resume = () => {
    F.goods.fish = S.fish || 0;
    renderCatch();
    placeRod();
    placeCrow();
    if (S.inCanoe && boat) {
      board();
      return;
    }
    const pos = S.pos && dry(S.pos.x, S.pos.z) ? S.pos : { x: L.seat.x, z: L.seat.z, yaw: L.seaYaw };
    ctx.teleport(pos.x, pos.z, pos.yaw);
    if (S.step === 'crow') {
      // (back on the rock with the flute, the Crow waiting)
      ctx.teleport(L.seat.x, L.seat.z, L.seaYaw);
      holdFlute(true);
      cut = { phase: 'talk', t: 0 };
      lockPlayer(true);
      crowChoices();
    } else if (S.hasRod) pick('rod');
  };

  const enter = async () => {
    if (active) return;
    active = true;
    const my = ++token;
    simT = 0;
    S = fresh();
    document.body.classList.add('story-mode');
    document.body.append(hud);
    setFade(1);
    actsKey = '\u0000';
    renderCatch();
    lockPlayer(true);
    window.addEventListener('keydown', onKey);
    document.addEventListener('visibilitychange', onHidden);
    const [island, saved] = await Promise.all([ctx.getIsland(ISLAND_KEY), ctx.canSave() ? ctx.load().catch(() => null) : null, crow.load()]);
    if (my !== token || !active) return;
    if (!island) {
      note('Tree Island failed to load.');
      setFade(0);
      return;
    }
    L = findLayout(island.def);
    if (!L) {
      note("Couldn't find the shore of Tree Island.");
      setFade(0);
      return;
    }
    if (saved?.v === STORY_SAVE_VERSION && saved.step) S = { ...fresh(), ...saved };
    ready = true;
    setupBoat();
    placeSeat();
    lockPlayer(false);
    if (S.step === 'intro') startCut();
    else {
      setFade(0);
      resume();
    }
  };

  const exit = () => {
    if (!active) return;
    save();
    active = false;
    ready = false;
    ++token;
    if (talk) { talk = null; talkBox.close(); }
    speech.stop();
    if (F.fishing) stopFishing();
    if (aboard) leaveBoat(null);
    introSound = stopSound(introSound);
    fluteSound = stopSound(fluteSound);
    holdFlute(false);
    if (flute) { crow.carry(null); flute.parent?.remove(flute); disposeFluteModel(flute); flute = null; }
    if (cut?.phase === 'lie' || cut?.phase === 'black' || cut?.phase === 'fade') ctx.standUp();
    if (cut?.fov) { ctx.camera.fov = cut.fov; ctx.camera.updateProjectionMatrix(); }
    cut = null;
    ending = null;
    lockPlayer(false);
    ctx.hold(null);
    held = null;
    crow.hide();
    clearNotes();
    removeRod();
    removeSeat();
    disposeBoat();
    feed.replaceChildren();
    tracker.render([]);
    lobbyOfferUntil = 0;
    window.removeEventListener('keydown', onKey);
    document.removeEventListener('visibilitychange', onHidden);
    hud.remove();
    document.body.classList.remove('story-mode', 'story-steer', 'story-cut');
  };

  const update = (dt) => {
    if (!active || !L) return;
    dt = Math.min(dt, 0.1);
    simT += dt;
    crow.update(dt);
    updateFlute(dt);
    updateEnding(dt);
    if (rodProp) {
      const g = rodProp.getObjectByName('glint');
      if (g) { const k = 0.5 + 0.5 * Math.sin(simT * 2.4); g.material.opacity = 0.25 + k * 0.6; g.scale.setScalar(0.25 + k * 0.2); }
    }
    if (boat) {
      const yawBefore = boat.yaw;
      if (aboard && held === 'oar') boat.paddle(dt, ctx.getOarModel(), ctx.getSteer(), ctx.getOarStroke());
      else {
        boat.blade = null;
        if (aboard && held === 'rod') boat.settle(dt);
      }
      boat.move(dt, simT);
      if (aboard) {
        const s = boat.standPoint();
        ctx.carryPlayer(s.x, boat.floorY(), s.z, boat.yaw - yawBefore);
      }
    }
    // (what's in hand: the game's weapon buttons / the phone may have changed it)
    if (!cut && !ending) {
      const kind = ctx.heldKind();
      if (kind !== held) onHeld(kind);
    }
    F.simT = simT;
    F.updateFishing(dt);
    if (cut) updateCut(dt);
    document.body.classList.toggle('story-cut', !!cut || !!ending);
    if (simT >= actAt) {
      actAt = simT + ACT_CHECK_S;
      landSpot = aboard && boat ? findLandSpot() : null;
      refreshActs();
      // (the Crow keeps an eye on the player)
      if (crow.isLanded() && !cut) crow.lookAt(ctx.getPlayerModel().position);
    }
    if (simT >= saveAt && !cut && !ending) save();
  };

  return {
    enter,
    exit,
    update,
    isActive: () => active,
    hasRod: () => active && S.hasRod,
    inCanoe: () => active && aboard,
    // The phone's Block bar as an interact button (null: nothing to do)
    interactLabel: () => {
      if (!active) return null;
      if (talk) return talk.i < talk.lines.length - 1 ? 'Go on' : talk.choices ? talk.choices[0].label : 'Okay';
      return acts[0]?.label ?? null;
    },
    interact: () => {
      if (!active) return;
      if (talk) talkAdvance();
      else if (acts[0]) { acts[0].run(); actAt = 0; }
    },
    // The phone's 🎣: rod ↔ hands (in the canoe ↔ the oar)
    toggleRod: () => {
      if (!active || !S.hasRod) return;
      pick(held === 'rod' ? (aboard ? 'oar' : null) : 'rod');
    },
    fishingHud: () => (active ? F.fishingHud() : null),
    debug: () => ({ S, L, F, boat, cut, crow, aboard, held, skipCut: () => { if (cut && cut.phase !== 'talk') { cut.t = 999; } } }),
  };
}

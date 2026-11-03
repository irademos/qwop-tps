// Story mode — the engine: a one-player story on Tree Island (MAPS.islandTown.islands
// `treeIsland`), saved as it goes (signed in — guests save nothing). It runs a chapter's data
// (chapter1.js: the talks, choices, steps, quest tracker, acts, notes) — no story text lives
// here. Pieces:
//   storyLayout.js  — where everything goes, found on the island at run time
//   storyProps.js   — the stone, the rod leaning in the canoe, the canoe's hole…
//   crow.js         — the Crow (a recurring character)
//   treeCreature.js — the sacred tree: a tree creature hiding as a tree
// This file: the cut scene, the talk (Town's subtitle talk box + text to speech), the actions a
// talk can run (ACTIONS), the acts (buttons), the canoe (holed until mended with wood), the sword
// (from the sacred tree), saving / resuming.
//
// REUSE TOWN MODE: Story builds on Town's systems wherever it can instead of writing its own —
// they're installed on a small stand-in for Town's state `T` (`F` below: the bits of T a module
// reads — simT, playerPos, goods / gain / bagRoom, feedLine, groundAt, net…), as the sea start
// does. So far: fishing (townFishing.js), chopping trees for wood (townTrees.js — chopTipNear /
// chopNear for the Chop button), the canoe (canoeBoat.js), the talk box + quest tracker
// (townJobs.js), the HUD's classes (town-*), text to speech (speech.js). Something new for Story
// that Town could use too goes in Town's module (made T-agnostic), not here.
// UI: Town's (townMode.js / townJobs.js) — the top chip, the feed, the acts (bottom centre),
// the goods pill (fish / wood), the quest tracker, the talk as a subtitle read out — and the
// game's own weapon buttons (Rod / Sword / Hands; Oar / Rod in the canoe).

import * as THREE from 'three';
import { registerTerrainHeightOverride } from '../environment/terrainHeight.js';
import { createCanoeBoat } from '../town/canoeBoat.js';
import { installTownFishing } from '../town/townFishing.js';
import { installTownTrees } from '../town/townTrees.js';
import { BAG_MAX, CANOE_BOARD_DIST, CANOE_SHORE_DIST, STUMP_RE, TREE_RE, dist2, el } from '../town/townConfig.js';
import { createFluteModel, disposeFluteModel, FLUTE_HAND_AT, FLUTE_LENGTH } from '../items/flute.js';
import { createCrow } from './crow.js';
import { createTreeCreature } from './treeCreature.js';
import { findStoryLayout, SEAT_RADIUS, SEAT_TOP } from './storyLayout.js';
import { makeSeatStone, makeLeaningRod, makeCanoeDamage, makeNote, pulseGlint, removeProp } from './storyProps.js';
import {
  CHAPTER, STEPS, stepAtLeast, WOOD_NEEDED, CROW, TREE, VOICES, TALKS, NOTES, ACTS, BANNERS,
  FIX_CANOE_THEN, quest,
} from './chapter1.js';
import { createJobTalk, createQuestTracker } from '../town/townJobs.js';
import { createSpeech } from '../audio/speech.js';

export const STORY_SAVE_VERSION = 2;
// Sounds (add the files; a missing one is just silent)
export const STORY_SOUNDS = {
  intro: '/assets/audio/story/intro.mp3',   // over the black at the start (waves, the wreck…)
  flute: '/assets/audio/story/flute.mp3',   // the boy's flute tune on the rock
  caw: '/assets/audio/story/crow_caw.mp3',  // the Crow
};

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
const CROW_FROM_UP = 10;      // m up over the sea the Crow comes from
const TALK_DIST = 2.8;        // m from the Crow: Talk
const TREE_TALK_DIST = 3.2;   // m from the sacred tree: Talk (once the Crow's told of it)
const TREE_REVEAL_HOLD_S = 4; // s it keeps its arms down after its last line
const ROD_PICK_DIST = CANOE_BOARD_DIST + 0.5; // m from the canoe's middle: Take the rod
const SACRED_GROVE_R = 7;     // m round the sacred tree: its friends — not choppable
const CUT_FOV = 50;
const SAVE_EVERY_S = 10;
const ACT_CHECK_S = 0.2;
const NOTE_MS = 5000;
const GAME_OVER_S = 3.5;
const FADE_OUT_S = 1.5;
const BROKEN_SINK = 0.09;     // m the holed canoe sits lower in the water…
const BROKEN_LIST = 0.1;      // …and rad it lists over

const fresh = () => ({
  v: STORY_SAVE_VERSION, at: 0, step: 'intro', hasRod: false, hasSword: false, fish: 0, wood: 0,
  canoeFixed: false, pos: null, canoe: null, inCanoe: false,
});
// (an older save: chapter 1 used to end at the fish — 'done' then is the sacred tree now)
const migrate = (saved) => {
  if (!saved?.step || !STEPS.includes(saved.step)) return null;
  if (saved.v === 1) return { ...fresh(), ...saved, v: STORY_SAVE_VERSION, step: saved.step === 'done' ? 'tree' : saved.step };
  if (saved.v === STORY_SAVE_VERSION) return { ...fresh(), ...saved };
  return null;
};

// ctx: the game (bootstrapGameApp.js — storyCtx)
export function createStoryMode(ctx) {
  let active = false;
  let ready = false;           // the save read, the island laid out
  let token = 0;               // a newer enter / exit wins over a load still going
  let S = fresh();             // the saved state
  let L = null;                // the layout on the island (storyLayout.js)
  let islandDef = null;        // the island (MAPS.islandTown.islands entry)
  let simT = 0;
  let cut = null;              // the cut scene: { phase, t, … }
  let boat = null;
  let aboard = false;
  let unregisterFloor = null;
  let held = null;             // 'rod' | 'oar' | 'sword' | null
  let flute = null;            // the flute model (in the player's hands / the Crow's beak)
  let fluteHeld = false;
  let rodProp = null;          // the rod leaning in the canoe
  let holeProp = null;         // the canoe's hole (until it's mended)
  let treesGroup = null;       // Town's chopping (townTrees.js) on the island's trees
  let ending = null;           // game over: { t }
  let saveAt = 0;
  let actAt = 0;
  let landSpot = null;         // in the canoe: dry ground to step onto
  let treeRevealUntil = 0;
  const told = new Set();      // one-off notes shown this visit (the log's too big, swing at it…)
  const notes = [];            // ♪ sprites
  let noteAt = 0;
  const crow = createCrow({ scene: ctx.scene });
  const tree = createTreeCreature({ scene: ctx.scene });

  // What the chapter's data sees (chapter1.js talks / quest)
  const view = () => ({
    step: S.step, fish: F.goods.fish, wood: F.goods.wood, hasRod: S.hasRod, hasSword: S.hasSword, canoeFixed: S.canoeFixed,
  });

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
      wood: F.goods.wood,
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
  const setStep = (step) => { S.step = step; renderGoods(); save(); };
  const onHidden = () => { if (document.visibilityState === 'hidden') save(); };

  // ── HUD: Town's (townMode.js) — the top chip, the feed, the acts, the goods pill, the quest
  // tracker and the talk as a subtitle (townJobs.js); the game's own weapon buttons ──
  const hud = el('div', 'town-hud story-hud');
  hud.id = 'story-hud';
  const top = el('div', 'town-top ui-panel');
  top.append(el('span', 'town-top-clock', CHAPTER.place));
  const feed = el('div', 'town-feed');
  const actsEl = el('div', 'town-acts hidden');
  const goodsEl = el('div', 'town-goods hidden');
  const fishEl = el('span', 'town-good');
  const woodEl = el('span', 'town-good');
  goodsEl.append(fishEl, woodEl);
  const fade = el('div', 'story-fade');
  hud.append(top, feed, goodsEl, actsEl, fade);
  const tracker = createQuestTracker(hud);

  // The feed: a line under the health bar's spot, gone after NOTE_MS
  const note = (text) => {
    if (!text) return;
    const line = el('div', 'town-feed-line', text);
    feed.prepend(line);
    while (feed.children.length > 3) feed.lastChild.remove();
    setTimeout(() => line.classList.add('town-feed-out'), NOTE_MS);
    setTimeout(() => line.remove(), NOTE_MS + 800);
  };
  const noteOnce = (key, text = NOTES[key]) => { if (told.has(key)) return; told.add(key); note(text); };
  const setFade = (k) => {
    fade.style.opacity = String(THREE.MathUtils.clamp(k, 0, 1));
    fade.classList.toggle('hidden', k <= 0.001);
  };

  // ── Voices: Town's text to speech (speech.js) — each speaker their own voice (VOICES), from
  // where they stand; the player's replies in the player's voice ──
  const speech = createSpeech();
  const speakerAt = (who) => {
    if (who === CROW && crow.isVisible()) return crow.position();
    if (who === TREE && tree.isPlaced()) return tree.position().clone().setY(tree.position().y + tree.height() * 0.8);
    return null;
  };
  const speakTalk = (text, { who, reply = false, interrupt = false, stop = false } = {}) => {
    if (stop) { speech.stop(); return; }
    if (reply) {
      speech.say(text, { key: `player:${ctx.getPlayerName?.() ?? 'story'}`, kind: ctx.playerVoiceKind?.() ?? 'male', priority: 'talk', interrupt });
      return;
    }
    const v = VOICES[who] ?? { kind: 'male' };
    speech.say(text, {
      key: who, kind: v.kind, family: v.family ?? null, at: speakerAt(who),
      priority: 'talk', interrupt, falloff: { ref: 3, rolloff: 1, max: 30 },
    });
  };

  // ── Talk: Town's subtitle talk box, one line at a time; the last can end in choices. The
  // talks themselves are the chapter's (TALKS); what they do when they end, ACTIONS ──
  const talkBox = createJobTalk(hud, { speak: speakTalk });
  let talk = null; // { lines, i, choices, then }
  const endTalk = (actions = null) => {
    talk = null;
    talkBox.close();
    run(actions);
  };
  const showLine = () => {
    const [who, text] = talk.lines[talk.i];
    const last = talk.i >= talk.lines.length - 1;
    const then = talk.then;
    const choices = !last
      ? [{ label: 'Go on', primary: true, act: true, onClick: () => { talk.i += 1; showLine(); } }]
      : talk.choices
        ? talk.choices.map((c, i) => ({ label: c.label, primary: i === 0, onClick: () => endTalk([...(then ?? []), ...(c.then ?? [])]) }))
        : [{ label: 'Okay', primary: true, act: true, onClick: () => endTalk(then) }];
    talk.who = who;
    if (who === CROW) { crow.flutter(0.9); playCaw(); }
    if (who === TREE) { tree.reveal(true); tree.lookAt(ctx.getPlayerModel().position); treeRevealUntil = simT + TREE_REVEAL_HOLD_S; }
    talkBox.open({ who, text, choices });
  };
  const say = (def) => {
    if (!def?.lines?.length) { run(def?.then); return; }
    talk = { lines: def.lines, i: 0, choices: def.choices ?? null, then: def.then ?? null };
    showLine();
    refreshActs();
  };
  // A character's talk: theirs for the step now (or `key`)
  const runTalk = (who, key = S.step) => {
    const def = TALKS[who]?.[key];
    if (!def) return;
    if (who === 'crow') crow.lookAt(ctx.getPlayerModel().position);
    say(typeof def === 'function' ? def(view()) : def);
  };
  const talkAdvance = () => { talkBox.pressFirst(); };
  let cawAt = 0;
  const playCaw = () => {
    if (simT < cawAt) return;
    cawAt = simT + 2;
    ctx.playSound(STORY_SOUNDS.caw, { volume: 0.7 });
  };

  // ── Actions: what a talk / choice does (chapter1.js `then`) ──
  const ACTIONS = {
    giveFlute: () => giveFlute(),
    takeFish: () => { F.goods.fish = Math.max(0, F.goods.fish - 1); renderGoods(); },
    putFluteAway: () => {
      holdFlute(false);
      fluteSound = stopSound(fluteSound);
      endCut();
    },
    giveSword: () => {
      S.hasSword = true;
      ctx.playSfx?.('unsheath');
      ctx.refreshButtons();
      pick('sword');
    },
    endChapter: () => {
      ctx.showBanner(...BANNERS.end, 6000);
      lobbyOfferUntil = simT + 30;
      actAt = 0;
    },
  };
  function run(actions) {
    for (const a of actions ?? []) {
      const [kind, arg, arg2] = a.split(':');
      if (kind === 'step') setStep(arg);
      else if (kind === 'note') note(NOTES[arg]);
      else if (kind === 'talk') runTalk(arg, arg2);
      else if (ACTIONS[kind]) ACTIONS[kind]();
      else console.warn('[story] unknown action', a);
    }
    actAt = 0;
  }

  // ── The layout on the island ──
  const waterY = (x, z) => ctx.getWaterY(x, z) ?? 0;
  const dry = (x, z) => ctx.waterDepth(x, z) <= 0.02;
  const groundAt = (p) => new THREE.Vector3(p.x, ctx.getGroundY(p.x, p.z), p.z);
  const layout = (island) => {
    const probe = createCanoeBoat({ waterY, waterDepth: ctx.waterDepth });
    try {
      return findStoryLayout(island, {
        getMapObjects: ctx.getMapObjects, waterDepth: ctx.waterDepth, getGroundY: ctx.getGroundY,
        canoeFits: (x, z, yaw) => probe.fits(x, z, yaw),
      });
    } finally { probe.dispose(); }
  };

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
        const s = makeNote();
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

  // ── The stone he stands on: its top is ground (a height override) ──
  let seatProp = null;
  let seatY = 0;
  let unregisterSeat = null;
  const seatFloor = (x, z) => (seatProp && dist2(x, z, L.seat.x, L.seat.z) < SEAT_RADIUS * 0.8 ? seatY + SEAT_TOP : undefined);
  const placeSeat = () => {
    removeSeat();
    seatY = ctx.getGroundY(L.seat.x, L.seat.z);
    seatProp = makeSeatStone();
    seatProp.position.set(L.seat.x, seatY + SEAT_TOP * 0.3, L.seat.z);
    ctx.scene.add(seatProp);
    unregisterSeat = registerTerrainHeightOverride(seatFloor);
  };
  const removeSeat = () => {
    unregisterSeat?.();
    unregisterSeat = null;
    seatProp = removeProp(seatProp);
  };

  // ── The rod, leaning in the canoe (in its group: it bobs with it) ──
  const placeRod = () => {
    rodProp = removeProp(rodProp);
    if (S.hasRod || !boat) return;
    rodProp = makeLeaningRod();
    boat.group.add(rodProp);
  };
  const takeRod = () => {
    if (S.hasRod) return;
    S.hasRod = true;
    rodProp = removeProp(rodProp);
    note(NOTES.gotRod);
    ctx.refreshButtons();
    pick('rod');
    renderGoods();
    save();
  };

  // ── The canoe's hole: it sits low and lists until it's mended (WOOD_NEEDED wood) ──
  const placeDamage = () => {
    holeProp = removeProp(holeProp);
    if (S.canoeFixed || !boat) return;
    holeProp = makeCanoeDamage();
    boat.group.add(holeProp);
  };
  const mendCanoe = () => {
    if (S.canoeFixed) return;
    if (F.goods.wood < WOOD_NEEDED) {
      note(NOTES.canoeBroken);
      return;
    }
    F.goods.wood -= WOOD_NEEDED;
    S.canoeFixed = true;
    holeProp = removeProp(holeProp);
    ctx.playSfx?.('chop', groundAt(boat));
    renderGoods();
    run(FIX_CANOE_THEN);
    save();
  };

  // ── Chopping trees: Town's (townTrees.js) on the island's trees — not the sacred tree's
  // friends round it. A sword swing (the game's phone-sword loop) or the Chop button ──
  const buildTrees = () => {
    clearTrees();
    const r = (islandDef?.radius ?? 135) + 30;
    const at = islandDef?.at ?? { x: L.wash.x, z: L.wash.z };
    const objs = ctx.getMapObjects({ minX: at.x - r, maxX: at.x + r, minZ: at.z - r, maxZ: at.z + r });
    const list = objs
      .filter((o) => TREE_RE.test(o.file) && !STUMP_RE.test(o.file) && dist2(o.x, o.z, L.tree.x, L.tree.z) > SACRED_GROVE_R)
      .map((o) => ({ x: o.x, z: o.z, id: o.id, object: o.object }));
    const stump = objs.find((o) => STUMP_RE.test(o.file))
      ?? ctx.getMapObjects({ minX: -1e5, maxX: 1e5, minZ: -1e5, maxZ: 1e5 }).find((o) => STUMP_RE.test(o.file));
    treesGroup = new THREE.Group();
    treesGroup.name = 'story-trees';
    ctx.scene.add(treesGroup);
    F.buildTrees(treesGroup, list, stump?.object ?? null);
  };
  const clearTrees = () => {
    if (!treesGroup) return;
    F.resetTrees();
    treesGroup.parent?.remove(treesGroup);
    treesGroup = null;
  };
  const canChop = () => S.hasSword && !cut && !talk && !aboard;
  const trySwordHit = (tip) => {
    if (!active || !treesGroup || held !== 'sword' || !canChop()) return false;
    return F.tryChop(tip);
  };

  // ── The sacred tree (the tree creature hiding as one) ──
  const placeTree = () => {
    const g = groundAt(L.tree);
    tree.placeAt(g, Math.atan2(L.wash.x - L.tree.x, L.wash.z - L.tree.z));
  };

  // ── Fishing: Town's (townFishing.js) on a stand-in for the town's state, as the sea start ──
  const isWater = (x, z) => !(boat && boat.floorAt(x, z) !== undefined) && ctx.waterDepth(x, z) > 0.4;
  const F = {
    hud,
    simT: 0,
    fishing: null,
    sequence: null,
    jail: null,
    goods: { fish: 0, wood: 0 },
    ready: true,
    net: null,
    netMode: 'off',
    groundAt: (x, z, fallback = 0) => { const y = ctx.getGroundY(x, z); return Number.isFinite(y) ? y : fallback; },
    fishAnywhere: () => active && held === 'rod' && !cut,
    fishWater: (x, z) => isWater(x, z),
    layout: { places: { fishSpot: null }, nav: { indexAt: (x, z) => ({ x, z }), isWater: (p) => isWater(p.x, p.z) } },
    playerPos: () => ctx.getPlayerModel().position,
    feedLine: (text) => note(text),
    bagRoom: () => Math.max(0, BAG_MAX - F.goods.fish - F.goods.wood),
    bagFullNote: () => note(NOTES.bagFull(BAG_MAX)),
    gain: (g, n = 1) => {
      const got = Math.min(n, F.bagRoom());
      if (got < n) F.bagFullNote();
      F.goods[g] = (F.goods[g] ?? 0) + got;
      renderGoods();
      if (got > 0 && g === 'fish' && S.step === 'fish') note(NOTES.fishCaught);
      if (got > 0) save();
      return got;
    },
    introNote: () => {},
    calmNow: () => true,
    stalls: { focused: () => false },
    marketPanel: { isOpen: () => false },
    jobTalk: { isOpen: () => false },
  };
  // The goods pill (Town's): the catch once there's a rod or a fish, the wood once there's some;
  // and the quest tracker (the chapter's `quest`)
  const renderGoods = () => {
    fishEl.textContent = `🐟 ${F.goods.fish}`;
    fishEl.classList.toggle('hidden', !F.goods.fish && !S.hasRod);
    woodEl.textContent = `🪵 ${F.goods.wood}`;
    woodEl.classList.toggle('hidden', !F.goods.wood);
    goodsEl.classList.toggle('hidden', !F.goods.fish && !S.hasRod && !F.goods.wood);
    tracker.render(quest(view()));
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
  installTownTrees(F, { playSfx: (kind, at) => ctx.playSfx?.(kind, at), getWaterY: ctx.getWaterY });
  const stopFishing = () => {
    F.fishing = null;
    F.stopFishingRig();
    F.hideFishingHud();
  };

  // ── What's in hand: the rod, the sword, the oar (in the canoe), or nothing ──
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
      if (!kind || kind === 'sword') { ctx.hold('oar'); held = ctx.heldKind(); }
      faceFor(held);
    }
    actAt = 0;
    ctx.refreshPhone();
  };
  const pick = (kind) => {
    if (!active || cut || ending) return;
    if (kind === 'rod' && !S.hasRod) return;
    if (kind === 'sword' && (!S.hasSword || aboard)) return;
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
    placeRod();
    placeDamage();
  };
  const disposeBoat = () => {
    if (!boat) return;
    rodProp = removeProp(rodProp);
    holeProp = removeProp(holeProp);
    boat.group.parent?.remove(boat.group);
    boat.dispose();
    boat = null;
  };
  const board = () => {
    if (!boat || aboard || !S.canoeFixed) return;
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
      if (landSpot) out.push({ key: 'out', label: ACTS.out, run: () => leaveBoat() });
    } else {
      // (the nearest of what's in reach — the canoe's: its rod and mending it / getting in)
      const near = [];
      const within = (x, z, r) => { const d = dist2(p.x, p.z, x, z); return d < r ? d : null; };
      if (crow.isLanded() && stepAtLeast(S.step, 'crow')) {
        const d = within(crow.position().x, crow.position().z, TALK_DIST);
        if (d != null) near.push({ d, key: 'crow', label: ACTS.crow, run: () => runTalk('crow') });
      }
      if (tree.isPlaced() && stepAtLeast(S.step, 'tree')) {
        const d = within(tree.position().x, tree.position().z, TREE_TALK_DIST);
        if (d != null) near.push({ d, key: 'tree', label: ACTS.tree, run: () => runTalk('tree') });
      }
      if (boat && !F.fishing) {
        if (!S.hasRod && stepAtLeast(S.step, 'fish')) {
          const d = within(boat.x, boat.z, ROD_PICK_DIST);
          if (d != null) near.push({ d: d - 0.01, key: 'rod', label: ACTS.rod, run: takeRod });
        }
        const d = within(boat.x, boat.z, CANOE_BOARD_DIST);
        if (d != null) {
          if (S.canoeFixed) near.push({ d, key: 'canoe', label: ACTS.canoe, run: board });
          else if (stepAtLeast(S.step, 'fish')) near.push({ d, key: 'fix', label: ACTS.fix, run: mendCanoe });
        }
      }
      // (a tree / log in reach, the sword given: Chop — Town's chopping; with a gyro, swing at it)
      if (canChop() && treesGroup && F.chopTipNear()) {
        if (ctx.hasGyro()) noteOnce('chopSwing');
        near.push({ d: 1.5, key: 'chop', label: ACTS.chop, run: () => { if (held !== 'sword') pick('sword'); F.chopNear(); } });
      }
      near.sort((a, b) => a.d - b.d);
      out.push(...near.slice(0, 2));
    }
    if (simT < lobbyOfferUntil) out.push({ key: 'lobby', label: ACTS.lobby, run: () => ctx.onLobby() });
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
  // Give the flute: the Crow takes it and flies off — game over, back to the very start
  const giveFlute = () => {
    say({
      ...TALKS.crow.give,
      then: ['flyOffWithFlute'],
    });
  };
  ACTIONS.flyOffWithFlute = () => {
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
  };
  const updateEnding = (dt) => {
    if (!ending) return;
    ending.t += dt;
    if (ending.t > 2.2 && !ending.shown) {
      ending.shown = true;
      ctx.showBanner(...BANNERS.gameOver, GAME_OVER_S * 1000);
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
            runTalk('crow', 'arrive');
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
  const placeWorld = () => {
    setupBoat();
    buildTrees();
    placeTree();
  };
  const restart = () => {
    S = fresh();
    F.goods.fish = 0;
    F.goods.wood = 0;
    renderGoods();
    placeWorld();
    save();
    startCut();
  };
  // Put the player back where the save left them
  const resume = () => {
    F.goods.fish = S.fish || 0;
    F.goods.wood = S.wood || 0;
    renderGoods();
    placeCrow();
    if (S.inCanoe && boat && S.canoeFixed) {
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
      runTalk('crow');
    } else if (S.hasSword) pick('sword');
    else if (S.hasRod) pick('rod');
  };

  const enter = async () => {
    if (active) return;
    active = true;
    const my = ++token;
    simT = 0;
    S = fresh();
    told.clear();
    document.body.classList.add('story-mode');
    document.body.append(hud);
    setFade(1);
    actsKey = '\u0000';
    renderGoods();
    lockPlayer(true);
    window.addEventListener('keydown', onKey);
    document.addEventListener('visibilitychange', onHidden);
    const [island, saved] = await Promise.all([
      ctx.getIsland(CHAPTER.island), ctx.canSave() ? ctx.load().catch(() => null) : null, crow.load(), tree.load(),
    ]);
    if (my !== token || !active) return;
    if (!island) {
      note(NOTES.noIsland);
      setFade(0);
      return;
    }
    islandDef = island.def;
    L = layout(islandDef);
    if (!L) {
      note(NOTES.noShore);
      setFade(0);
      return;
    }
    S = migrate(saved) ?? fresh();
    ready = true;
    placeWorld();
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
    tree.hide();
    clearNotes();
    clearTrees();
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
    // (the sacred tree lowers its arms to talk, then hides again)
    tree.reveal((talk && talk.who === TREE) || simT < treeRevealUntil);
    tree.update(dt);
    updateFlute(dt);
    updateEnding(dt);
    if (treesGroup) F.updateTrees(dt);
    if (rodProp) pulseGlint(rodProp, simT);
    if (boat) {
      const yawBefore = boat.yaw;
      if (aboard && held === 'oar') boat.paddle(dt, ctx.getOarModel(), ctx.getSteer(), ctx.getOarStroke());
      else {
        boat.blade = null;
        if (aboard && held === 'rod') boat.settle(dt);
      }
      boat.move(dt, simT);
      if (!S.canoeFixed) {
        // (holed: low in the water, listing)
        boat.group.position.y -= BROKEN_SINK;
        boat.group.rotation.z += BROKEN_LIST;
      }
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
    hasSword: () => active && S.hasSword,
    inCanoe: () => active && aboard,
    trySwordHit,
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
    // The phone's 🗡/✋: the sword ↔ hands (not in the canoe)
    toggleSword: () => {
      if (!active || !S.hasSword || aboard) return;
      pick(held === 'sword' ? null : 'sword');
    },
    fishingHud: () => (active ? F.fishingHud() : null),
    debug: () => ({
      S, L, F, boat, cut, crow, tree, aboard, held, acts,
      skipCut: () => { if (cut && cut.phase !== 'talk') { cut.t = 999; } },
      // (jump ahead: set the step and what goes with it)
      give: ({ rod, sword, fish, wood } = {}) => {
        if (rod) S.hasRod = true;
        if (sword) S.hasSword = true;
        if (fish) F.goods.fish += fish;
        if (wood) F.goods.wood += wood;
        if (rod) rodProp = removeProp(rodProp);
        ctx.refreshButtons();
        renderGoods();
      },
      setStep,
      runTalk,
      teleport: (x, z, yaw = 0) => ctx.teleport(x, z, yaw),
    }),
  };
}

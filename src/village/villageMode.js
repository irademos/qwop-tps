// Sword Showdown village: the hub between stages (replaces the old stage screen).
//
// Built around the player wherever they stand when it opens. The player walks around it
// (WASD / joystick, or tap / click the ground), kept inside a box (VILLAGE_BOUNDS) and out of
// the props; the camera follows from behind, further out and higher than the fight camera,
// and eases round to look at a station the player comes near, which shows its button
// ("🛒 Shop", "💬 Talk"… — E / Enter). The button (or tapping the thing itself) walks the
// player over and frames the camera on it.
//   • Market stall + merchant + treasure chest — the shop. Items sit on the counter; tap
//     one (or swipe / ‹ › / arrow keys) for its buy card. The chest is a mystery item.
//   • Unlocked characters idling — tap one to play as them: they walk over and take the
//     player's place, the old character goes to idle in their spot.
//   • Campfire in front of the characters — sit until night / morning (the next stage's time
//     of day).
//   • Villager (Pemberton) — stands on the next stage's path with a quest (VILLAGER_QUESTS,
//     the story: one per stage for the first ten, then the fight with him on PEMBERTON_STAGE,
//     then a rotating few). Talking plays the conversation out a line at a time, a word or
//     two at a time (tap to go on); the player's lines are a choice of two replies; it ends
//     with "accept" — the stage starts (after the sword calibration popup, ctx.confirmStart) —
//     or "not now". He steps aside when the stage starts — except on PEMBERTON_STAGE
//     (`finalBoss`): there he stands PEMBERTON_SCALE× tall, glowing red, and the stage's boss
//     takes his place (ctx.onStart's bossSpot).
// ⬅ Lobby is top left. At a station, tapping anywhere that isn't one of its items / characters
// (or a button) goes back to walking around, and so does walking off (WASD / joystick).
// After a stage win it can be built a little way ahead, the player walking in (`approach`).
//
// Game access goes through `ctx` (villageCtx in bootstrapGameApp.js); the shop logic
// (prices, stock, buying, the chest's prizes) lives there too.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { createGLBCharacterInstance, glbCharacterConfig } from '../models/glbCharacterModel.js';
import { createBombMesh, getBombGLTF } from '../characters/BombThrowerEnemy.js';
import { stylizeObject } from '../environment/artStyle.js';
import { raycastMapSegment } from '../environment/mapCollision.js';
import { PEMBERTON_SCALE, addRedGlow } from '../characters/pembertonBoss.js';

// ── Props ───────────────────────────────────────────────────────────────────
const MARKET_STALL_MODEL = '/assets/props/market_stall.glb';
const LIFE_POTION_MODEL = '/assets/props/life_potion.glb';
const MANA_POTION_MODEL = '/assets/props/mana_potion.glb';
const TREASURE_CHEST_MODEL = '/assets/props/treasure_chest.glb';
// The stall / potion / chest numbers come from a game with ~1.8 m characters; ours are
// 1 m tall, so the whole set is shrunk by this
const VILLAGE_PROP_SCALE = 0.55;
const MARKET_STALL_SIZE = 0.013;
const TREASURE_CHEST_SCALE = 0.015;
const MERCHANT_OFFSET = new THREE.Vector3(0.0, 0, -1.4);   // stall-local metres (before VILLAGE_PROP_SCALE)
// Potions are children of the stall model (offsets in the stall's own units, scale on top of its scale)
const LIFE_POTION_SCALE = 4000.0;
const MANA_POTION_SCALE = 8.0;
const LIFE_POTION_OFFSET = new THREE.Vector3(-50, 60.0, 0.45);
const MANA_POTION_OFFSET = new THREE.Vector3(-0.15, 100.0, 0.05);
const STALL_UNIT = MARKET_STALL_SIZE * VILLAGE_PROP_SCALE; // metres per stall unit
const COUNTER_SURFACE_Y = 92;      // the counter's actual top surface (stall units, measured) — items stand on it
const MERCHANT_CHARACTER_URL = glbCharacterConfig.wizardUrl;
const VILLAGER_CHARACTER_URL = glbCharacterConfig.villagerUrl;

// The villager's quest for each stage (stage 1 = index 0) — the story of Pemberton, who keeps
// sending the player down the road against "monsters" (and turns up in every village: he
// keeps a very fast carriage). `place` = the village the player is in (top chip),
// `title` = the quest (also on the stage banner), `lines` = the conversation ([who, text],
// who = 'them' (the speaker) / 'you' / 'action'). A 'you' line is offered as a choice next to
// TALK_CANCEL (back to the village). Stage
// PEMBERTON_STAGE is the fight with him (FINAL_BOSS_QUEST); after it VILLAGER_REPEAT_QUESTS take turns.
const PEMBERTON = { speaker: 'Pemberton', emoji: '🎩' };
const VILLAGER_QUESTS = [
  { place: 'Millbrook', title: 'Carry the letter to Thornwick',
    lines: [
      ['them', 'Ah, a traveler! Splendid. Would you carry this letter to Thornwick for me? Do watch the road, though. Monsters about. Nasty business.'],
      ['you', 'Monsters?'],
      ['them', 'Nothing a strong arm can’t handle. There’s a coin in it for you.'],
    ],
    accept: 'I’ll take the letter' },
  { place: 'Thornwick', title: 'Clear the granaries at Ashford',
    lines: [
      ['them', 'You made it! Don’t look so surprised, I keep a very fast carriage. Now, those creatures have been getting into my grain stores near Ashford. Be a friend and clear them out?'],
    ],
    accept: 'I’ll clear them out' },
  { place: 'Ashford', title: 'Clear the quarry at Greyhollow',
    lines: [
      ['them', 'My granaries are safe again. Funny how the beasts only ever go after the grain, isn’t it? Greedy little things. I hear there’s a whole nest in the old quarry at Greyhollow.'],
    ],
    accept: 'On my way' },
  { place: 'Greyhollow', title: 'Clear the docks at Saltmere',
    lines: [
      ['them', 'Back already? Splendid.'],
      ['you', 'One of them was holding a pickaxe.'],
      ['them', 'Monsters will use anything as a weapon. The quarry’s mine now, by the way. Bought it from the bank, after the bank took it from people who couldn’t pay the bank. Marvelous system. Now, the fishing docks at Saltmere need clearing. I’ve plans for those docks.'],
    ],
    accept: 'I’ll go' },
  { place: 'Saltmere', title: 'Clear the mill at Fenwick',
    lines: [
      ['them', 'Ah, there you are. All quiet at the docks?'],
      ['you', 'One of them tried to speak to me.'],
      ['them', 'Speak? Growl, surely. Mimicry, friend. Clever beasts pick up sounds. Don’t let it get under your skin. They’ve got into my mill at Fenwick now — off you go.'],
    ],
    accept: 'I’ll go' },
  { place: 'Fenwick', title: 'Clear the camp at Riverbend',
    lines: [
      ['them', 'They’ve been painting on my mill walls. “WAGES.” Can you imagine?'],
      ['you', 'Monsters can write?'],
      ['them', 'Learned it somewhere, I suppose. Don’t encourage them. There’s a camp by the river at Riverbend. Squatters. I mean, monsters.'],
    ],
    accept: '…I’ll go' },
  { place: 'Riverbend', title: 'Clear the road to Old Hearth',
    lines: [
      ['them', 'Well? How did it go?'],
      ['you', 'There were small ones in that camp.'],
      ['them', 'Yes, well. They breed. That’s rather the whole problem, isn’t it? Here, double the usual. You’ve earned it. Old Hearth next — same business.'],
    ],
    accept: '…Fine' },
  { place: 'Old Hearth', title: 'Clear Highcrest Gate',
    lines: [
      ['them', 'My man tells me you hesitated back there. I’d hate to think you were getting sentimental. Every village you’ve walked through, I own now. Every one. Think what we could do together. Just Highcrest Gate left.'],
    ],
    accept: 'One more' },
  { place: 'Highcrest Gate', title: 'Go to Gould Manor',
    lines: [
      ['them', 'Ah. You again. You look troubled, friend.'],
      ['you', 'I found your ledger. Every “monster” I killed had a name, and a debt next to it.'],
      ['them', 'Debts are debts, friend. I didn’t make the rules. I just bought them. Now, please don’t be tiresome.'],
    ],
    accept: 'I’m coming for you, Pemberton' },
  { place: 'Gould Manor', title: 'Get past the guards',
    lines: [
      ['them', 'Look at you. Blade dripping, boots muddy, breaking into a man’s home uninvited. If anyone here looks like a monster, it certainly isn’t me.'],
      ['action', 'He rings a bell.'],
      ['them', 'GUARDS! There’s a monster in the house!'],
    ],
    accept: 'Bring them on' },
];
// The stage after the guards: Pemberton himself (1.5× size, glowing red — see `finalBoss`)
export const PEMBERTON_STAGE = VILLAGER_QUESTS.length + 1;
const FINAL_BOSS_QUEST = {
  place: 'Gould Manor', title: 'Settle the account',
  lines: [
    ['them', 'Hired guards. Never worth the coin. Very well — if a thing’s worth doing, a gentleman does it himself.'],
    ['you', 'It’s over, Pemberton.'],
    ['them', 'Over? I own the roads, the mills, the docks — the very ground you’re standing on. Come, then, monster. Let’s settle your account.'],
  ],
  accept: 'Let’s settle it',
};
// After Pemberton: the villages are free, the road still isn't
const VILLAGER = { speaker: 'Villager', emoji: '🧑‍🌾' };
const VILLAGER_REPEAT_QUESTS = [
  { title: 'Patrol the road',
    lines: [['them', 'With Pemberton gone, the debts are torn up and the mills pay wages again. But real monsters still roam the road. Could you patrol it and send them packing?']],
    accept: 'Let’s go, I’ll help!' },
  { title: 'Deliver the mail',
    lines: [['them', 'The mail’s piled up again and the post rider won’t go out alone. Could you take this bag of letters to the next village? Watch out for the monsters.']],
    accept: 'I’ll deliver it!' },
  { title: 'Protect the village',
    lines: [['them', 'They’re attacking again! Please, protect the village!']],
    accept: 'I’ll hold them off!' },
];
const VILLAGER_DECLINE = 'Not right now';
const TALK_CANCEL = 'Never mind';   // next to each of the player's lines: back to the village
const TALK_WORDS_PER_SEC = 13;     // the line plays out a word or two at a time
export function villagerQuestForStage(stage) {
  const s = Math.max(1, Math.floor(stage) || 1);
  if (s <= VILLAGER_QUESTS.length) return { ...PEMBERTON, ...VILLAGER_QUESTS[s - 1] };
  if (s === PEMBERTON_STAGE) return { ...PEMBERTON, ...FINAL_BOSS_QUEST, finalBoss: true };
  return { ...VILLAGER, ...VILLAGER_REPEAT_QUESTS[(s - PEMBERTON_STAGE - 1) % VILLAGER_REPEAT_QUESTS.length] };
}

// ── Layout (village-local metres: x = right, z = toward the next stage) ────────
// Skinny: the shop and the characters face each other across a lane (turned a little back
// toward the village centre), the villager at its far end; the campfire is in front of the characters
const LAYOUT = {
  stall: new THREE.Vector3(-2.4, 0, 3.6),
  stallFaces: new THREE.Vector3(1.5, 0, 1.6),      // the stall's front looks at this point
  chestSide: 1.45,                 // chest: this far beside the stall (toward the centre)
  characters: new THREE.Vector3(2.4, 0, 3.6),
  charactersFace: new THREE.Vector3(-1.5, 0, 1.6), // the group faces this point
  villager: new THREE.Vector3(0, 0, 7.8),
  villagerAside: new THREE.Vector3(1.7, 0, 8.4),   // where he steps to when the stage starts
};
const CHARACTER_ARC_RADIUS = 1.35;
const PLAYER_WALK_SPEED = 2.4;     // m/s
const NPC_WALK_SPEED = 1.7;        // m/s
const VILLAGER_ASIDE_SPEED = 3.2;  // m/s — out of the player's way when the stage starts
const CAMERA_LERP = 3.2;           // 1/s
const VILLAGE_FOV = 55;            // the fight camera is very wide; the village is framed tighter
// Walking around: the camera follows the player from behind, further out and higher than the
// fight camera, looking toward the villager; near a station it eases round to look at it
const FOLLOW_DIST = 3.6;           // m behind the look point (phones / portrait: FOLLOW_DIST_COMPACT)
const FOLLOW_DIST_COMPACT = 4.5;
const FOLLOW_HEIGHT = 1.9;         // m above the look point
const FOLLOW_LOOK_HEIGHT = 0.7;    // look point: this far above the player's feet…
const FOLLOW_LOOK_PULL = 0.45;     // …pulled this far toward a station the player is near
const FOLLOW_LERP = 5;             // 1/s (position)
const FOLLOW_YAW_LERP = 2.2;       // 1/s (turning toward / away from a station)
// Blocked from behind: try these (× distance, × height) in turn
const FOLLOW_RISE = [[1, 1], [0.8, 1.6], [0.55, 2.3], [0.3, 2.9]];
const FOLLOW_CLEARANCE = 0.3;      // m kept between the camera and a wall / hill behind the player
const FOLLOW_GROUND_CLEARANCE = 0.4;
const LABEL_HIDE_DIST = 3.2;       // station labels hide this close to the camera (they'd fill the view)
// Where the player may walk (village-local metres, see LAYOUT) + round props they can't walk through
const VILLAGE_BOUNDS = { x: 5.2, zMin: -3, zMax: 9.8 };
const STALL_BLOCK_RADIUS = 0.85;
const STALL_BLOCK_BACK = 0.35;     // m behind the stall's origin
const FIRE_BLOCK_RADIUS = 0.55;
const VILLAGER_BLOCK_RADIUS = 0.45;
const WALK_STUCK_MS = 600;         // a tap-walk that stops getting closer (a prop in the way) ends there
const STATION_NAMES = { shop: '🛒 Shop', villager: '🧑‍🌾 Villager', fire: '🔥 Campfire', characters: '👥 Characters' };
const FINAL_BOSS_MARKER_BG = 'rgba(220, 38, 38, 0.92)';
const CAMPFIRE_AHEAD = 0.4;        // m from the characters' group centre toward the lane (they stand behind it)
const SIT_FADE_MS = 700;           // sitting by the fire: fade out, change the time, fade back in
const SIT_HOLD_MS = 900;
const COARSE_POINTER = typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches;
const LEAVE_REMOVE_DIST = 10;      // m from the village centre: props removed once the stage walk gets here
const LEAVE_REMOVE_MS = 4000;      // …or this long after the stage starts (the first enemies spawn close by)

// Shop items on the counter (left → right, also the swipe order). Positions in stall units.
const SHOP_ITEMS = [
  { id: 'showdown_bomb', at: [-92, COUNTER_SURFACE_Y + 10, 34], build: 'bomb' },
  { id: 'life_potion', potion: 'life' },
  { id: 'gun bullets', at: [-24, COUNTER_SURFACE_Y + 1, 36], build: 'bullets' },
  { id: 'mana_potion', potion: 'mana' },
  { id: 'pistol', at: [34, COUNTER_SURFACE_Y + 3, 32], build: 'gun' },
  { id: 'shield', at: [88, COUNTER_SURFACE_Y - 8, 12], build: 'shield' },
  { id: 'heart_upgrade', at: [-62, 150, 4], build: 'heart', hang: true },
  { id: 'bubble', at: [0, 160, 4], build: 'bubble', hang: true },
  { id: 'shield_upgrade', at: [62, 150, 4], build: 'shieldUpgrade', hang: true },
  { id: 'treasure_chest', chest: true },
];

// Sitting by the campfire: until night / until morning
const SIT_CHOICES = {
  night: { pref: 'night', button: '🌙 Sit until night', fade: '🌙 Night falls…', label: '🌙 Night' },
  day: { pref: 'day', button: '☀️ Sit until morning', fade: '☀️ Morning comes…', label: '☀️ Day' },
};

const _UP = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _ray = new THREE.Raycaster();
const _groundPlane = new THREE.Plane();
const _ndc = new THREE.Vector2();

const _loader = new GLTFLoader();
const _gltfCache = new Map();
function loadProp(url, stylize = {}) {
  let p = _gltfCache.get(url);
  if (!p) {
    p = _loader.loadAsync(url).then((gltf) => { stylizeObject(gltf.scene, stylize); return gltf; });
    p.catch(() => _gltfCache.delete(url));
    _gltfCache.set(url, p);
  }
  return p;
}

// Rounded-rect text / emoji sprite. `height` = world height (m).
function makeTextSprite(text, { height = 0.24, font = 600, size = 64, bg = 'rgba(14, 17, 27, 0.78)', border = 'rgba(244, 196, 84, 0.85)', color = '#fff', pad = 28 } = {}) {
  const canvas = document.createElement('canvas');
  const g = canvas.getContext('2d');
  const fontCss = `${font} ${size}px Outfit, Inter, "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
  g.font = fontCss;
  const w = Math.ceil(g.measureText(text).width + pad * 2);
  const h = Math.ceil(size * 1.5);
  canvas.width = w;
  canvas.height = h;
  g.font = fontCss;
  if (bg) {
    const r = h / 2.4;
    g.fillStyle = bg;
    g.beginPath();
    g.roundRect(3, 3, w - 6, h - 6, r);
    g.fill();
    if (border) { g.lineWidth = 4; g.strokeStyle = border; g.stroke(); }
  }
  g.fillStyle = color;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, w / 2, h / 2 + size * 0.04);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(height * (w / h), height, 1);
  sprite.renderOrder = 5;
  return sprite;
}
const makeEmojiSprite = (emoji, height = 0.4) => makeTextSprite(emoji, { height, size: 96, bg: null, pad: 10 });

function disposeOwned(root) {
  root.traverse((o) => {
    if (o.userData?.sharedAsset) return;
    o.geometry?.dispose?.();
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    mats.forEach((m) => { if (m && !m.userData?.shared) { m.map?.dispose?.(); m.dispose?.(); } });
  });
}
// Clones of cached GLBs share geometry / materials: never dispose those
function markShared(root) {
  root.traverse((o) => {
    o.userData.sharedAsset = true;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    mats.forEach((m) => { if (m) m.userData.shared = true; });
  });
  return root;
}

// ── Little stand-in models for counter items without a GLB ────────────────────
function buildItemMesh(kind) {
  const g = new THREE.Group();
  const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.1, ...extra });
  if (kind === 'gun') {
    const dark = std(0x2b2d33, { metalness: 0.4, roughness: 0.45 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.07, 0.24), dark);
    body.position.set(0, 0.1, 0);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.12, 12), dark);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.115, 0.17);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.11, 0.06), std(0x6b4425));
    grip.position.set(0, 0.04, -0.08);
    grip.rotation.x = -0.25;
    g.add(body, barrel, grip);
    g.rotation.y = Math.PI / 2.6;
  } else if (kind === 'shield' || kind === 'shieldUpgrade') {
    const r = kind === 'shield' ? 0.2 : 0.13;
    const face = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.035, 32), std(0x9a6a3a));
    face.rotation.x = Math.PI / 2;
    const rim = new THREE.Mesh(new THREE.TorusGeometry(r * 0.97, 0.016, 8, 32), std(0xb8bcc4, { metalness: 0.6, roughness: 0.35 }));
    const boss = new THREE.Mesh(new THREE.SphereGeometry(r * 0.25, 16, 10), std(0xb8bcc4, { metalness: 0.6, roughness: 0.35 }));
    boss.scale.z = 0.5;
    boss.position.z = 0.02;
    g.add(face, rim, boss);
    g.position.y = r;
    if (kind === 'shieldUpgrade') {
      const up = makeEmojiSprite('⬆️', 0.16);
      up.position.set(r * 0.9, r * 0.9, 0.05);
      g.add(up);
    } else {
      g.rotation.x = -0.25;
    }
  } else if (kind === 'bullets') {
    const brass = std(0xd4a640, { metalness: 0.7, roughness: 0.3 });
    const tip = std(0xb87333, { metalness: 0.6, roughness: 0.35 });
    for (let i = 0; i < 5; i++) {
      const b = new THREE.Group();
      const casing = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.07, 10), brass);
      casing.position.y = 0.035;
      const head = new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.035, 10), tip);
      head.position.y = 0.087;
      b.add(casing, head);
      b.position.set((i % 3) * 0.045 - 0.045, 0, Math.floor(i / 3) * 0.045);
      g.add(b);
    }
  } else if (kind === 'bubble') {
    const ball = new THREE.Mesh(
      new THREE.SphereGeometry(0.13, 24, 16),
      new THREE.MeshPhysicalMaterial({ color: 0x9fdcff, transparent: true, opacity: 0.38, roughness: 0.05, metalness: 0, clearcoat: 1, emissive: 0x2a6f9a, emissiveIntensity: 0.35 })
    );
    const shine = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8 }));
    shine.position.set(-0.05, 0.06, 0.09);
    g.add(ball, shine);
  } else if (kind === 'heart') {
    const s = new THREE.Shape();
    s.moveTo(0, -0.1);
    s.bezierCurveTo(-0.02, -0.07, -0.13, -0.02, -0.12, 0.05);
    s.bezierCurveTo(-0.11, 0.11, -0.03, 0.12, 0, 0.06);
    s.bezierCurveTo(0.03, 0.12, 0.11, 0.11, 0.12, 0.05);
    s.bezierCurveTo(0.13, -0.02, 0.02, -0.07, 0, -0.1);
    const geo = new THREE.ExtrudeGeometry(s, { depth: 0.05, bevelEnabled: true, bevelSize: 0.012, bevelThickness: 0.012, bevelSegments: 3 });
    geo.center();
    g.add(new THREE.Mesh(geo, std(0xe0233a, { emissive: 0x5a0010, emissiveIntensity: 0.6, roughness: 0.35 })));
  }
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}

function makeRing(radius = 0.5, color = 0xf4c454) {
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(radius * 0.82, radius, 40),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.renderOrder = 4;
  return ring;
}

// Soft round spot (white centre → transparent) for the flames / embers / glow
function makeGlowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.75)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Campfire: box logs in a little teepee, a stone ring, additive flame / ember sprites and a
// ground glow (no light: adding one would recompile every material). Animated by updateCampfire.
const FLAME_COUNT = 12;
const EMBER_COUNT = 6;
function makeCampfire() {
  const g = new THREE.Group();
  const logMat = new THREE.MeshStandardMaterial({ color: 0x6b4423, emissive: 0x3a1404, emissiveIntensity: 0.6, roughness: 1, metalness: 0 });
  const logGeo = new THREE.BoxGeometry(0.5, 0.075, 0.075);
  for (let i = 0; i < 5; i++) {
    const pivot = new THREE.Group();
    pivot.rotation.y = (i / 5) * Math.PI * 2 + 0.3;
    const log = new THREE.Mesh(logGeo, logMat);
    log.position.set(0.14, 0.12, 0);
    log.rotation.z = 0.5;           // inner end up: the logs lean together
    log.castShadow = true;
    pivot.add(log);
    g.add(pivot);
  }
  const stoneMat = new THREE.MeshStandardMaterial({ color: 0x77736b, roughness: 1, metalness: 0 });
  const stoneGeo = new THREE.DodecahedronGeometry(0.065, 0);
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    const st = new THREE.Mesh(stoneGeo, stoneMat);
    st.position.set(Math.sin(a) * 0.36, 0.03, Math.cos(a) * 0.36);
    st.rotation.set(a, a * 2, 0);
    st.scale.set(1.2, 0.75, 1);
    g.add(st);
  }
  const tex = makeGlowTexture();
  const glow = new THREE.Mesh(
    new THREE.CircleGeometry(0.9, 24),
    new THREE.MeshBasicMaterial({ map: tex, color: 0xff7a1a, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false })
  );
  glow.rotation.x = -Math.PI / 2;
  glow.position.y = 0.02;
  glow.renderOrder = 3;
  g.add(glow);
  const spark = (opacity) => {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false }));
    sp.renderOrder = 6;
    g.add(sp);
    return sp;
  };
  const flames = [];
  for (let i = 0; i < FLAME_COUNT; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.random() * 0.1;
    flames.push({ sprite: spark(0), phase: i / FLAME_COUNT, speed: 1.1 + Math.random() * 0.5, ox: Math.sin(a) * r, oz: Math.cos(a) * r });
  }
  const embers = [];
  for (let i = 0; i < EMBER_COUNT; i++) {
    embers.push({ sprite: spark(0), phase: i / EMBER_COUNT, speed: 0.35 + Math.random() * 0.2, drift: Math.random() * Math.PI * 2 });
  }
  return { group: g, flames, embers, glow };
}
const _flameHot = new THREE.Color(1, 0.85, 0.45);
const _flameCool = new THREE.Color(1, 0.28, 0.05);
function updateCampfire(fire, t) {
  for (const f of fire.flames) {
    const age = (t * f.speed + f.phase) % 1;
    const sp = f.sprite;
    sp.position.set(f.ox * (1 - age), 0.12 + age * 0.55, f.oz * (1 - age));
    const sc = 0.34 * (1 - age * 0.7);
    sp.scale.set(sc, sc * 1.25, 1);
    sp.material.color.copy(_flameHot).lerp(_flameCool, age);
    sp.material.opacity = (age < 0.15 ? age / 0.15 : 1 - (age - 0.15) / 0.85) * 0.9;
  }
  for (const e of fire.embers) {
    const age = (t * e.speed + e.phase) % 1;
    const sp = e.sprite;
    sp.position.set(Math.sin(e.drift + age * 4) * 0.12 * age, 0.25 + age * 1.1, Math.cos(e.drift + age * 3) * 0.12 * age);
    sp.scale.set(0.035, 0.035, 1);
    sp.material.color.copy(_flameCool);
    sp.material.opacity = (1 - age) * 0.9;
  }
  fire.glow.material.opacity = 0.42 + Math.sin(t * 11) * 0.05 + Math.sin(t * 7.3) * 0.05;
}

const angleLerp = (a, b, t) => {
  let d = ((b - a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
  return a + d * t;
};
const yawToward = (from, to) => Math.atan2(to.x - from.x, to.z - from.z);

/**
 * @param {object} ctx
 *  scene, camera, domElement, getTerrainHeight(x, z)
 *  getPlayer() → { model, controls }
 *  getCoins()
 *  shop: { load(), getItemState(id) → { name, desc, price, owned, status: 'ok'|'max'|'soldout'|'soon', note? },
 *          buy(id) → Promise<{ ok, text, emoji? }> }   (id 'treasure_chest' = open the chest)
 *  characters: { roster, get() → { unlocked, selected }, select(key) }
 *  time: { get(), set(pref) }
 *  confirmStart(go)   — the villager's quest was accepted: call go() to start the stage (after calibrating)
 *  onStart(pathAngle, { bossSpot }?) — start the stage (the player auto-walks along pathAngle);
 *                       bossSpot = { position, yaw } where the villager stood (finalBoss only)
 *  onLobby()           — back to the start screen
 */
export function createVillage(ctx) {
  const { scene, camera, domElement } = ctx;
  // Labels read bigger on tall phone screens (the overview is further away there)
  let labelScale = 1;
  const textSprite = (text, opts = {}) => makeTextSprite(text, { ...opts, height: (opts.height ?? 0.24) * labelScale });
  let active = false;
  let leaving = null;       // { startedMs } once the stage walk has begun
  let approaching = false;  // the player is still walking in (built ahead after a stage win)
  let starting = false;     // quest accepted, waiting on ctx.confirmStart
  let root = null;          // THREE.Group with everything
  let center = new THREE.Vector3();
  let fwd = new THREE.Vector3(0, 0, 1);
  let right = new THREE.Vector3(-1, 0, 0);
  let pathAngle = 0;
  let stageInfo = null;
  let quest = villagerQuestForStage(1);
  let finalBoss = false;    // PEMBERTON_STAGE: the villager is the boss (big + glowing red)
  let villagerScale = 1;
  let buildToken = 0;

  let stations = {};        // key → station
  let focus = null;         // focused station key or null (overview)
  let selectedItem = -1;    // SHOP_ITEMS index
  let itemEntries = [];     // { def, object, baseY, baseRotY, centerOffset, hopUntil }
  let npcs = [];            // { key, container, character, slot: Vector3, walk: { to, onArrive }, label }
  let swapBusy = false;
  let campfire = null;      // makeCampfire() result
  let sitting = false;      // sitting by the fire (screen fade) — input ignored meanwhile
  let sitTimers = [];
  let chestFx = null;
  let prizeFx = [];
  let cardRefreshedAt = 0;
  let overviewLabels = [];  // station names: only shown in the overview (huge in close-ups)

  // Player walk + facing (the body turns on its own: controls.yaw is the camera's heading,
  // so WASD / the joystick move relative to the view)
  let walk = null;          // { to: Vector3, onArrive, best, bestAt }
  let faceYaw = null;       // body heading to turn to
  let bodyYaw = 0;
  const prevPos = new THREE.Vector3();
  let obstacles = [];       // { pos: Vector3, r } — round props the player walks around
  let nearKeys = '';        // stations whose buttons are showing (free walking)
  // The villager's conversation: { i: line index, words, shown, done, choices }
  let talk = null;
  // Camera (smoothed)
  const camPos = new THREE.Vector3();
  const camLook = new THREE.Vector3();
  const wantPos = new THREE.Vector3();
  const wantLook = new THREE.Vector3();
  let camInit = false;
  let camReleased = false;
  let camFov = 60;
  let followYaw = 0;        // the follow camera's heading

  // ── DOM ──
  const ui = document.createElement('div');
  ui.className = 'village-ui hidden';
  ui.innerHTML = `
    <button type="button" class="ui-btn-secondary village-lobby-top hidden" data-v="lobby">⬅ Lobby</button>
    <div class="village-top ui-chip"><span data-v="stage"></span><span class="village-top-sep">·</span><span data-v="coins"></span></div>
    <div class="village-hint hidden" data-v="hint"></div>
    <div class="village-acts hidden" data-v="acts"></div>
    <div class="village-talk ui-panel hidden" data-v="talk">
      <div class="village-talk-head"><span class="village-talk-who" data-v="talk-who"></span><span class="village-talk-quest" data-v="talk-quest"></span></div>
      <button type="button" class="village-talk-close" data-v="talk-close" aria-label="Back to the village">✕</button>
      <div class="village-talk-text" data-v="talk-text"></div>
      <div class="village-talk-more hidden" data-v="talk-more">▼</div>
      <div class="village-talk-choices" data-v="talk-choices"></div>
    </div>
    <div class="village-panel ui-panel hidden" data-v="panel">
      <div class="village-panel-title" data-v="panel-title"></div>
      <div class="village-panel-text" data-v="panel-text"></div>
      <div class="village-panel-actions" data-v="panel-actions"></div>
    </div>
    <div class="village-card ui-panel hidden" data-v="card">
      <button type="button" class="ui-chip village-card-nav" data-v="prev" aria-label="Previous item">‹</button>
      <div class="village-card-body">
        <div class="village-card-name" data-v="card-name"></div>
        <div class="village-card-desc" data-v="card-desc"></div>
        <div class="village-card-owned" data-v="card-owned"></div>
        <button type="button" class="ui-btn village-card-buy" data-v="buy"></button>
      </div>
      <button type="button" class="ui-chip village-card-nav" data-v="next" aria-label="Next item">›</button>
    </div>
    <div class="village-fade hidden" data-v="fade"><div class="village-fade-text" data-v="fade-text"></div></div>
    <div class="village-banner hidden" data-v="banner">
      <div class="village-banner-title" data-v="banner-title"></div>
      <div class="village-banner-sub" data-v="banner-sub"></div>
      <div class="village-banner-boss" data-v="banner-boss"></div>
    </div>`;
  document.body.appendChild(ui);
  const $ = (k) => ui.querySelector(`[data-v="${k}"]`);
  const el = {
    lobby: $('lobby'), stage: $('stage'), coins: $('coins'),
    panel: $('panel'), panelTitle: $('panel-title'), panelText: $('panel-text'), panelActions: $('panel-actions'),
    card: $('card'), cardName: $('card-name'), cardDesc: $('card-desc'), cardOwned: $('card-owned'), buy: $('buy'),
    prev: $('prev'), next: $('next'),
    fade: $('fade'), fadeText: $('fade-text'),
    banner: $('banner'), bannerTitle: $('banner-title'), bannerSub: $('banner-sub'), bannerBoss: $('banner-boss'),
    hint: $('hint'), acts: $('acts'),
    talk: $('talk'), talkWho: $('talk-who'), talkQuest: $('talk-quest'), talkText: $('talk-text'),
    talkMore: $('talk-more'), talkChoices: $('talk-choices'), talkClose: $('talk-close'),
  };
  let bannerTimer = null;

  el.lobby.addEventListener('click', () => {
    if (!active || leaving || approaching || sitting) return;
    ctx.onLobby();
  });
  el.talkClose.addEventListener('click', () => { if (active && !leaving && !starting) unfocus(); });
  el.prev.addEventListener('click', () => stepItem(-1));
  el.next.addEventListener('click', () => stepItem(1));
  el.buy.addEventListener('click', () => { void buySelected(); });
  // Tapping the conversation box: finish the line / on to the next one
  el.talk.addEventListener('click', (e) => { if (!e.target.closest('button')) advanceTalk(); });

  // Phones / portrait: the camera further out, the shop framed closer on the counter
  // (decided per frame: the phone can be turned)
  const isCompact = () => (camera.aspect || 1) < 1 || COARSE_POINTER;
  let compact = false;

  const local = (x, y, z, out = new THREE.Vector3()) => out.copy(center)
    .addScaledVector(right, x).addScaledVector(fwd, z).setY(center.y + y);
  const groundY = (x, z, fallback) => {
    const y = ctx.getTerrainHeight?.(x, z);
    return Number.isFinite(y) ? y : fallback;
  };
  // Stand an object on the ground at world (x, z) + lift
  const placeOnGround = (obj, pos, lift = 0) => {
    obj.position.set(pos.x, groundY(pos.x, pos.z, center.y) + lift, pos.z);
  };

  // Marks every mesh / sprite under `obj` as a click target for `target`
  const clickables = [];
  const makeClickable = (obj, target) => {
    obj.traverse((o) => { o.userData.villageTarget = target; });
    clickables.push(obj);
  };

  // ── Build ──
  async function build(token) {
    root = new THREE.Group();
    root.name = 'Village';
    scene.add(root);
    const rootRef = root;
    const alive = () => active && token === buildToken && root === rootRef;

    // Villager on the next stage's path, facing the village, with this stage's quest
    {
      const pos = local(LAYOUT.villager.x, 0, LAYOUT.villager.z);
      pos.y = groundY(pos.x, pos.z, center.y);
      const facing = _v.subVectors(center, pos).setY(0).normalize().clone();
      // Quest marker over his head (always shown: it says "talk to me")
      const sc = villagerScale;
      const marker = finalBoss
        ? textSprite('⚔️', { height: 0.42, bg: FINAL_BOSS_MARKER_BG, border: 'rgba(255,255,255,0.9)', pad: 14 })
        : textSprite('❗', { height: 0.42, bg: 'rgba(244, 196, 84, 0.92)', border: 'rgba(255,255,255,0.9)', pad: 14 });
      marker.position.copy(pos).add(_v2.set(0, 1.45 * sc, 0));
      const label = textSprite(`${quest.emoji} ${quest.title}`, { height: 0.3 });
      label.position.copy(pos).add(_v2.set(0, 1.45 * sc + 0.4, 0));
      const ring = makeRing(0.6 * sc);
      ring.position.set(pos.x, pos.y + 0.03, pos.z);
      // Bigger tap target than the model
      const hit = new THREE.Mesh(new THREE.CylinderGeometry(0.45 * sc, 0.45 * sc, 1.3 * sc, 10), new THREE.MeshBasicMaterial({ visible: false }));
      hit.position.copy(pos).add(_v2.set(0, 0.65 * sc, 0));
      root.add(marker, label, ring, hit);
      overviewLabels.push(label);
      stations.villager = { key: 'villager', pos: pos.clone(), facing, marker, markerY: marker.position.y, label, ring, hit };
      obstacles.push({ pos: pos.clone(), r: VILLAGER_BLOCK_RADIUS * sc });
      for (const o of [marker, label, ring, hit]) makeClickable(o, { station: 'villager' });
      const npc = { key: 'villager', container: null, character: null, walk: null, villager: true };
      npcs.push(npc);
      stations.villager.npc = npc;
      createGLBCharacterInstance({ targetHeight: villagerScale, url: VILLAGER_CHARACTER_URL, armIK: false }).then(({ container, character }) => {
        if (!alive() || !npcs.includes(npc)) { character.dispose(); return; }
        npc.container = container;
        npc.character = character;
        placeOnGround(container, pos, 0);
        container.rotation.y = Math.atan2(facing.x, facing.z);
        character.setMoving(false);
        root.add(container);
        makeClickable(container, { station: 'villager' });
        if (finalBoss) npc.glow = addRedGlow(container, { height: villagerScale });
        if (leaving) {
          if (finalBoss) removeNpc(npc);
          else stepVillagerAside();
        }
      }).catch((e) => console.warn('[Village] villager load failed:', e));
    }

    // Characters: the unlocked ones (except the one being played) idle in a little arc
    {
      const pos = local(LAYOUT.characters.x, 0, LAYOUT.characters.z);
      const gy = groundY(pos.x, pos.z, center.y);
      const groupCenter = new THREE.Vector3(pos.x, gy, pos.z);
      // Arc opens across the lane, toward the shop
      const toCenter = _v.subVectors(local(LAYOUT.charactersFace.x, 0, LAYOUT.charactersFace.z), groupCenter).setY(0).normalize().clone();
      const label = textSprite('👥 Characters', { height: 0.32 });
      label.position.copy(groupCenter).add(_v2.set(0, 1.75, 0));
      root.add(label);
      overviewLabels.push(label);
      stations.characters = { key: 'characters', label, pos: groupCenter.clone(), facing: toCenter };
      makeClickable(label, { station: 'characters' });
      const { unlocked, selected } = ctx.characters.get();
      const keys = unlocked.filter((k) => k !== selected && ctx.characters.roster[k]);
      // (story characters aren't won from bosses)
      const lockedCount = Object.entries(ctx.characters.roster)
        .filter(([k, c]) => !c.story && !unlocked.includes(k)).length;
      if (lockedCount > 0) {
        const sign = textSprite(`🔒 ${lockedCount} more — beat stage bosses`, { height: 0.2, border: 'rgba(255,255,255,0.25)' });
        sign.position.copy(groupCenter).add(_v2.set(0, 1.42, 0));
        root.add(sign);
        overviewLabels.push(sign);
        makeClickable(sign, { station: 'characters' });
      }
      const slots = characterSlots(groupCenter, toCenter, Math.max(keys.length, 1));
      keys.forEach((key, i) => spawnNpc(key, slots[i], groupCenter, alive));
      stations.characters.slots = slots;

      // Campfire just in front of them: tap it to sit until night / morning
      const firePos = _v2.copy(groupCenter).addScaledVector(toCenter, CAMPFIRE_AHEAD);
      campfire = makeCampfire();
      placeOnGround(campfire.group, firePos, 0);
      root.add(campfire.group);
      const hit = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8), new THREE.MeshBasicMaterial({ visible: false }));
      hit.position.y = 0.2;
      campfire.group.add(hit);
      makeClickable(campfire.group, { station: 'fire' });
      const fireLabel = textSprite('🔥 Campfire', { height: 0.22 });
      fireLabel.position.copy(campfire.group.position).add(_v.set(0, 0.85, 0));
      root.add(fireLabel);
      overviewLabels.push(fireLabel);
      makeClickable(fireLabel, { station: 'fire' });
      stations.fire = { key: 'fire', label: fireLabel, pos: campfire.group.position.clone() };
      obstacles.push({ pos: campfire.group.position.clone(), r: FIRE_BLOCK_RADIUS });
    }

    // Shop: stall + merchant + counter items + chest
    try {
      const [stallGltf, lifeGltf, manaGltf, chestGltf, bombGltf] = await Promise.all([
        loadProp(MARKET_STALL_MODEL),
        loadProp(LIFE_POTION_MODEL, { materials: false }),
        loadProp(MANA_POTION_MODEL, { materials: false }),
        loadProp(TREASURE_CHEST_MODEL),
        getBombGLTF().catch(() => null),
      ]);
      if (!alive()) return;
      const pos = local(LAYOUT.stall.x, 0, LAYOUT.stall.z);
      const stallRoot = new THREE.Group();
      placeOnGround(stallRoot, pos, -0.005);
      // Front (+Z of the model) faces across the lane, toward the characters
      const lookAt = local(LAYOUT.stallFaces.x, 0, LAYOUT.stallFaces.z);
      const facing = _v.subVectors(lookAt, stallRoot.position).setY(0).normalize().clone();
      stallRoot.rotation.y = Math.atan2(facing.x, facing.z);
      const side = new THREE.Vector3().crossVectors(_UP, facing).normalize(); // customer's right
      // The chest goes on the side toward the village centre
      const chestSign = Math.sign(_v.subVectors(center, stallRoot.position).dot(side)) || 1;
      root.add(stallRoot);
      const stall = markShared(stallGltf.scene.clone(true));
      stall.scale.setScalar(MARKET_STALL_SIZE * VILLAGE_PROP_SCALE);
      stall.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      stallRoot.add(stall);
      makeClickable(stall, { station: 'shop' });

      // Counter items
      itemEntries = SHOP_ITEMS.map((def) => {
        let object = null;
        if (def.potion) {
          const gltf = def.potion === 'life' ? lifeGltf : manaGltf;
          object = markShared(gltf.scene.clone(true));
          object.scale.setScalar(def.potion === 'life' ? LIFE_POTION_SCALE : MANA_POTION_SCALE);
          object.position.copy(def.potion === 'life' ? LIFE_POTION_OFFSET : MANA_POTION_OFFSET);
          stall.add(object);
        } else if (def.chest) {
          object = markShared(chestGltf.scene.clone(true));
          object.scale.setScalar(TREASURE_CHEST_SCALE * VILLAGE_PROP_SCALE);
          const cp = _v2.copy(stallRoot.position).addScaledVector(side, chestSign * LAYOUT.chestSide).addScaledVector(facing, 0.35);
          placeOnGround(object, cp, 0);
          object.rotation.y = stallRoot.rotation.y - 0.25;
          root.add(object);
        } else {
          object = def.build === 'bomb' && bombGltf ? createBombMesh(bombGltf) : buildItemMesh(def.build);
          if (def.build === 'bomb') { markShared(object); object.scale.multiplyScalar(0.8); object.position.y = 0.1; }
          const holder = new THREE.Group();
          holder.add(object);
          holder.position.set(def.at[0], def.at[1], def.at[2]).multiplyScalar(STALL_UNIT);
          stallRoot.add(holder);
          object = holder;
        }
        object.traverse((o) => { if (o.isMesh) o.castShadow = true; });
        const entry = { def, object, baseY: object.position.y, baseRotY: object.rotation.y };
        return entry;
      });
      // Item centres (some models' origins are well off the mesh) + a bigger invisible tap
      // target around each small item
      root.updateMatrixWorld(true);
      const hitMat = new THREE.MeshBasicMaterial({ visible: false });
      itemEntries.forEach((entry, i) => {
        const box = new THREE.Box3().setFromObject(entry.object);
        const origin = entry.object.getWorldPosition(new THREE.Vector3());
        const c = box.isEmpty() ? origin.clone() : box.getCenter(new THREE.Vector3());
        entry.centerOffset = c.clone().sub(origin);
        makeClickable(entry.object, { station: 'shop', item: i });
        if (!entry.def.chest) {
          // (small: neighbouring items' targets would swallow each other's taps)
          const size = box.isEmpty() ? 0.12 : box.getSize(new THREE.Vector3()).length() / 2;
          const hit = new THREE.Mesh(new THREE.SphereGeometry(THREE.MathUtils.clamp(size, 0.1, 0.14), 10, 8), hitMat);
          hit.position.copy(stallRoot.worldToLocal(c.clone()));
          stallRoot.add(hit);
          makeClickable(hit, { station: 'shop', item: i });
        }
      });

      const label = textSprite('🛒 Shop', { height: 0.36 });
      label.position.copy(stallRoot.position).add(_v2.set(0, 2.35, 0));
      root.add(label);
      overviewLabels.push(label);
      makeClickable(label, { station: 'shop' });
      const chestEntry = itemEntries.find((e) => e.def.chest);
      const chestLabel = textSprite('🎁 Mystery Chest', { height: 0.24 });
      chestLabel.position.copy(chestEntry.object.position).add(_v2.set(0, 0.95, 0));
      root.add(chestLabel);
      overviewLabels.push(chestLabel);
      makeClickable(chestLabel, { station: 'shop', item: itemEntries.indexOf(chestEntry) });

      stations.shop = { key: 'shop', stallRoot, facing, side, chestSign, label, chest: chestEntry };
      obstacles.push({ pos: stallRoot.position.clone().addScaledVector(facing, -STALL_BLOCK_BACK), r: STALL_BLOCK_RADIUS });

      // Merchant behind the counter
      createGLBCharacterInstance({ targetHeight: 1.0, url: MERCHANT_CHARACTER_URL, armIK: false }).then(({ container, character }) => {
        if (!alive()) { character.dispose(); return; }
        const off = _v2.copy(MERCHANT_OFFSET).multiplyScalar(VILLAGE_PROP_SCALE).applyAxisAngle(_UP, stallRoot.rotation.y);
        const mp = _v.copy(stallRoot.position).add(off);
        placeOnGround(container, mp, 0);
        container.rotation.y = stallRoot.rotation.y;
        character.setMoving(false);
        root.add(container);
        npcs.push({ key: 'merchant', container, character, merchant: true });
        makeClickable(container, { station: 'shop' });
      }).catch((e) => console.warn('[Village] merchant load failed:', e));
    } catch (error) {
      console.warn('[Village] shop props failed to load.', error);
    }
  }

  function characterSlots(groupCenter, toCenter, n) {
    const slots = [];
    const baseAngle = Math.atan2(toCenter.x, toCenter.z);
    const spread = Math.min(Math.PI * 1.1, 0.75 * Math.max(0, n - 1));
    const radius = Math.max(CHARACTER_ARC_RADIUS * 0.55, 0.3 * n);
    for (let i = 0; i < n; i++) {
      // Slots on the far half of a circle around the group centre (they face the village)
      const a = baseAngle + Math.PI + (n === 1 ? 0 : -spread / 2 + (spread * i) / (n - 1));
      const p = new THREE.Vector3(groupCenter.x + Math.sin(a) * radius, 0, groupCenter.z + Math.cos(a) * radius);
      p.y = groundY(p.x, p.z, groupCenter.y);
      slots.push(p);
    }
    return slots;
  }

  function spawnNpc(key, slot, faceToward, alive, { at = null, onReady = null } = {}) {
    const def = ctx.characters.roster[key];
    if (!def) return;
    const npc = { key, container: null, character: null, slot: slot.clone(), walk: null, label: null };
    npcs.push(npc);
    createGLBCharacterInstance({ targetHeight: 1.0, url: def.url, armIK: false }).then(({ container, character }) => {
      if (!alive() || !npcs.includes(npc)) { character.dispose(); return; }
      npc.container = container;
      npc.character = character;
      const start = at || slot;
      placeOnGround(container, start, 0);
      container.rotation.y = yawToward(container.position, stations.characters?.facing
        ? _v.copy(container.position).add(stations.characters.facing) : faceToward);
      character.setMoving(false);
      const label = textSprite(`${def.emoji} ${def.label}`, { height: 0.15, border: 'rgba(255,255,255,0.3)' });
      label.position.set(0, 1.22, 0);
      container.add(label);
      npc.label = label;
      root.add(container);
      makeClickable(container, { station: 'characters', npc });
      onReady?.(npc);
    }).catch((e) => console.warn('[Village] character load failed:', e));
    return npc;
  }

  function removeNpc(npc) {
    const i = npcs.indexOf(npc);
    if (i >= 0) npcs.splice(i, 1);
    if (npc.container) {
      npc.container.parent?.remove(npc.container);
      const ci = clickables.indexOf(npc.container);
      if (ci >= 0) clickables.splice(ci, 1);
      if (npc.label) disposeOwned(npc.label);
    }
    npc.character?.dispose();
    npc.glow?.dispose();
    npc.glow = null;
  }

  // ── Focus / camera targets ──
  // Camera distance that fits a (halfW × halfH) box at the village fov / current aspect
  const fitDistance = (halfW, halfH) => {
    const vfov = THREE.MathUtils.degToRad(VILLAGE_FOV);
    const tanV = Math.tan(vfov / 2);
    const tanH = tanV * (camera.aspect || 1);
    return Math.max(halfH / tanV, halfW / tanH) * 1.12;
  };
  const setView = (target, dirFromTarget, halfW, halfH, minDist = 1.2) => {
    const d = Math.max(minDist, fitDistance(halfW, halfH));
    wantLook.copy(target);
    wantPos.copy(target).addScaledVector(_v.copy(dirFromTarget).normalize(), d);
  };

  // Free walking: behind the player, looking toward the villager (the village's forward) —
  // eased round to look at a station the player is near
  function followCamera(dt, near) {
    const p = playerPos();
    const look = _v2.set(p.x, p.y + FOLLOW_LOOK_HEIGHT, p.z);
    let yawWant = Math.atan2(fwd.x, fwd.z);
    const n = near[0];
    if (n) {
      yawWant = angleLerp(yawWant, n.viewYaw, n.w);
      look.lerp(n.look, FOLLOW_LOOK_PULL * n.w);
    }
    followYaw = angleLerp(followYaw, yawWant, 1 - Math.exp(-FOLLOW_YAW_LERP * dt));
    const d = compact ? FOLLOW_DIST_COMPACT : FOLLOW_DIST;
    wantLook.copy(look);
    // A wall / hill / house between the player and the camera: it rises over it (more from
    // above), and failing that comes in front of it
    for (let i = 0; i < FOLLOW_RISE.length; i++) {
      const [back, up] = FOLLOW_RISE[i];
      wantPos.set(look.x - Math.sin(followYaw) * d * back, look.y + FOLLOW_HEIGHT * up, look.z - Math.cos(followYaw) * d * back);
      const hit = raycastMapSegment(look, wantPos);
      if (!hit) break;
      if (i === FOLLOW_RISE.length - 1) {
        const keep = Math.max(0.8, hit.distance - FOLLOW_CLEARANCE) / look.distanceTo(wantPos);
        wantPos.sub(look).multiplyScalar(Math.min(1, keep)).add(look);
      }
    }
    wantPos.y = Math.max(wantPos.y, groundY(wantPos.x, wantPos.z, -Infinity) + FOLLOW_GROUND_CLEARANCE);
  }

  // Stations the player is near, closest first: w = 0 (at `outer`) → 1 (within `inner`, where
  // its button shows); viewYaw = the camera heading that looks at its front, look = what to look at
  function nearbyStations() {
    const p = playerPos();
    const out = [];
    const flat = (a) => Math.hypot(a.x - p.x, a.z - p.z);
    const add = (key, d, inner, outer, facing, look) => {
      if (!(d < outer)) return;
      const t = THREE.MathUtils.clamp((d - inner) / (outer - inner), 0, 1);
      out.push({ key, d, w: 1 - t * t * (3 - 2 * t), inRange: d <= inner, viewYaw: Math.atan2(-facing.x, -facing.z), look });
    };
    const v = stations.villager;
    if (v) {
      const sc = villagerScale;
      add('villager', flat(v.pos), 1.9 * sc, 3.0 * sc, v.facing, v.pos.clone().setY(v.pos.y + 0.7 * sc));
    }
    const sh = stations.shop;
    if (sh) {
      const sp = sh.stallRoot.position;
      const d = Math.min(flat(sp), sh.chest ? flat(sh.chest.object.position) : Infinity);
      add('shop', d, 2.3, 3.4, sh.facing, sp.clone().addScaledVector(sh.side, sh.chestSign * 0.55).setY(sp.y + 0.8));
    }
    const c = stations.characters;
    if (c) {
      add('characters', flat(c.pos), 1.9, 2.9, c.facing, c.pos.clone().setY(c.pos.y + 0.6));
      const f = stations.fire;
      if (f) add('fire', flat(f.pos), 1.3, 2.0, c.facing, f.pos.clone().setY(f.pos.y + 0.4));
    }
    return out.sort((a, b) => b.w - a.w || a.d - b.d);
  }

  // Buttons for the stations in reach (bottom right; E / Enter = the first)
  const actLabel = (key) => (key === 'villager' ? (finalBoss ? '⚔️ Confront' : '💬 Talk') : STATION_NAMES[key]);
  function refreshActs(near) {
    const keys = active && !leaving && !approaching && !sitting && !focus
      ? near.filter((n) => n.inRange).slice(0, 2).map((n) => n.key)
      : [];
    const k = keys.join(',');
    if (k === nearKeys) return;
    nearKeys = k;
    el.acts.replaceChildren(...keys.map((key, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `${i === 0 ? 'ui-btn' : 'ui-btn-secondary'} village-act`;
      b.textContent = actLabel(key);
      b.addEventListener('click', () => { if (active && !leaving && !sitting) focusStation(key); });
      return b;
    }));
    el.acts.classList.toggle('hidden', !keys.length);
  }

  // At a station: framed on it
  function computeWantedCamera(dt, near) {
    const st = focus ? stations[focus] : null;
    if (!st) { followCamera(dt, near); return; }
    if (focus === 'shop') {
      const s = stations.shop;
      const entry = itemEntries[selectedItem];
      if (entry) {
        const p = itemCenter(entry, new THREE.Vector3());
        p.y += 0.05;
        const dir = _v.copy(s.facing).addScaledVector(_UP, 0.45).clone();
        setView(p, dir, compact ? 0.62 : 0.8, 0.5, compact ? 1.2 : 1.5);
      } else if (compact) {
        // Phones: close on the counter and the items hanging over it (the chest off to the side)
        const target = _v2.copy(s.stallRoot.position).add(_v.set(0, 0.8, 0)).clone();
        const dir = _v.copy(s.facing).addScaledVector(_UP, 0.3).clone();
        setView(target, dir, 0.72, 0.5, 1.2);
      } else {
        // Stall + chest
        const target = _v2.copy(s.stallRoot.position).addScaledVector(s.side, s.chestSign * 0.55).add(_v.set(0, 0.85, 0)).clone();
        const dir = _v.copy(s.facing).addScaledVector(_UP, 0.32).clone();
        setView(target, dir, 2.3, 1.4, 2.6);
      }
    } else if (focus === 'characters') {
      const s = stations.characters;
      const target = _v2.copy(s.pos).add(_v.set(0, 0.6, 0)).clone();
      const dir = _v.copy(s.facing).addScaledVector(_UP, compact ? 0.22 : 0.35).clone();
      setView(target, dir, compact ? 1.15 : 1.35, 0.8, 2.2);
    } else if (focus === 'villager') {
      // Over the player's shoulder at the villager (from a little to the side, so the player
      // doesn't block him)
      const s = stations.villager;
      const side = _v.crossVectors(_UP, s.facing).normalize().clone();
      const sc = villagerScale;
      const target = _v2.copy(s.pos).addScaledVector(s.facing, 0.5 * sc).addScaledVector(side, -0.2 * sc).add(_v.set(0, 0.6 * sc, 0)).clone();
      const dir = side.multiplyScalar(1.1).addScaledVector(s.facing, 0.7).addScaledVector(_UP, 0.3);
      setView(target, dir, 1.1 * sc, 0.8, 2.4);
    } else if (focus === 'fire') {
      // The fire with the characters standing behind it
      const s = stations.fire;
      const target = _v2.copy(s.pos).add(_v.set(0, 0.45, 0)).clone();
      const dir = _v.copy(stations.characters.facing).addScaledVector(_UP, 0.3).clone();
      setView(target, dir, 1.2, 0.75, 2.0);
    }
  }

  // Where the player stands for a station, and what they face
  function approachFor(key) {
    if (key === 'shop') {
      const s = stations.shop;
      // Beyond the chest, out of the item close-ups
      const p = _v.copy(s.stallRoot.position).addScaledVector(s.facing, 1.3).addScaledVector(s.side, s.chestSign * 2.6).clone();
      return { to: p, face: s.stallRoot.position.clone() };
    }
    if (key === 'characters') {
      const s = stations.characters;
      const sideDir = _v2.crossVectors(_UP, s.facing).normalize();
      const p = _v.copy(s.pos).addScaledVector(s.facing, 1.5).addScaledVector(sideDir, -2.3).clone();
      return { to: p, face: s.pos.clone() };
    }
    if (key === 'villager') {
      // In front of him, a little to the side the camera isn't on
      const s = stations.villager;
      const side = _v2.crossVectors(_UP, s.facing).normalize();
      const p = _v.copy(s.pos).addScaledVector(s.facing, villagerScale).addScaledVector(side, -0.45).clone();
      return { to: p, face: s.pos.clone() };
    }
    const s = stations[key];
    const p = _v.subVectors(center, s.pos).setY(0).normalize().multiplyScalar(1.1).add(s.pos).clone();
    return { to: p, face: s.pos.clone() };
  }

  function focusStation(key, { item = -1 } = {}) {
    if (!stations[key]) return;
    if (focus !== key) {
      focus = key;
      const { to, face } = approachFor(key);
      walkTo(to, () => { faceYaw = yawToward(playerPos(), face); });
      if (key === 'villager') startTalk();
      else endTalk();
    }
    if (key === 'shop') selectItem(item);
    else selectItem(-1);
    refreshPanel();
    refreshBack();
  }

  function unfocus() {
    focus = null;
    endTalk();
    selectItem(-1);
    refreshPanel();
    refreshBack();
  }

  // ⬅ Lobby top left (not while walking in / leaving); no joystick / jump at a station
  function refreshBack() {
    document.body.classList.toggle('village-focused', !!focus && active && !leaving);
    el.lobby.classList.toggle('hidden', !active || !!leaving || approaching);
  }

  // Bottom panel: what to do at the current station
  function refreshPanel() {
    // (text: a string, or nodes — the villager's conversation)
    const show = (title, text, actions = []) => {
      el.panelTitle.textContent = title;
      if (Array.isArray(text)) el.panelText.replaceChildren(...text);
      else el.panelText.textContent = text;
      el.panelActions.replaceChildren(...actions);
      el.panel.classList.remove('hidden');
    };
    const btn = (label, onClick, cls = 'ui-btn') => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = cls;
      b.textContent = label;
      b.addEventListener('click', onClick);
      return b;
    };
    el.hint.classList.toggle('hidden', !!focus);
    el.talk.classList.toggle('hidden', focus !== 'villager' || !talk);
    if (!focus) {
      // Walking around: just a hint under the top chip
      el.panel.classList.add('hidden');
      const who = quest.speaker === 'Villager' ? 'the villager' : quest.speaker;
      el.hint.textContent = `${COARSE_POINTER ? 'Joystick or tap to walk' : 'WASD or click to walk · E to interact'} · talk to ${who} ${finalBoss ? '⚔️' : '❗'} when you’re ready`;
    } else if (focus === 'villager') {
      el.panel.classList.add('hidden');
    } else if (focus === 'shop') {
      if (selectedItem >= 0) el.panel.classList.add('hidden');
      else show('🛒 Shop', 'Tap an item on the stall — or the chest for a mystery prize.');
    } else if (focus === 'characters') {
      const sel = ctx.characters.roster[ctx.characters.get().selected];
      const any = npcs.some((n) => !n.merchant && !n.villager);
      show('👥 Characters', any
        ? `Playing as ${sel?.emoji ?? ''} ${sel?.label ?? ''}. Tap a character to switch.`
        : `Playing as ${sel?.emoji ?? ''} ${sel?.label ?? ''}. Beat a stage’s final enemy to unlock their character.`);
    } else if (focus === 'fire') {
      // Offer the one that changes the time
      const night = ctx.time.get() === 'night';
      const cur = night ? SIT_CHOICES.night : SIT_CHOICES.day;
      const next = night ? SIT_CHOICES.day : SIT_CHOICES.night;
      show('🔥 Campfire', `Next stage: ${cur.label}. Sit by the fire to pass the time.`,
        [btn(next.button, () => sitUntil(next))]);
    }
  }

  // ── The villager's conversation ──
  // One line at a time, played out a word or two at a time (tap the box: finish the line / next
  // line). A 'you' line is a choice of two replies (either one carries on); the last line ends
  // with the quest's accept / VILLAGER_DECLINE.
  function startTalk() {
    talk = { i: -1, who: 'them', words: [], shown: 0, acc: 0, done: true, choices: null };
    el.talkQuest.textContent = quest.title;
    nextLine();
  }
  function endTalk() {
    talk = null;
    el.talk.classList.add('hidden');
  }
  function nextLine() {
    if (!talk) return;
    const line = quest.lines[talk.i + 1];
    if (!line || line[0] === 'you') {
      // (a quest that opens with a reply: he just waits)
      if (talk.i < 0 && !talk.words.length) setLine('them', '…');
      talk.shown = talk.words.length;
      talk.done = true;
      renderTalkText();
      showChoices(line);
      return;
    }
    talk.i += 1;
    setLine(line[0], line[1]);
  }
  function setLine(who, text) {
    talk.who = who;
    talk.words = String(text).split(/\s+/).filter(Boolean);
    talk.shown = 0;
    talk.acc = 0;
    talk.done = false;
    talk.choices = null;
    el.talk.classList.toggle('is-action', who === 'action');
    el.talkWho.textContent = who === 'action' ? '' : `${quest.emoji} ${quest.speaker}`;
    el.talkChoices.replaceChildren();
    el.talkMore.classList.add('hidden');
    renderTalkText();
  }
  // (the rest of the line is laid out invisibly, so the box doesn't grow as it plays out)
  function renderTalkText() {
    const shown = talk.words.slice(0, talk.shown).join(' ');
    const rest = talk.words.slice(talk.shown).join(' ');
    const restEl = document.createElement('span');
    restEl.className = 'village-talk-rest';
    restEl.textContent = (shown && rest ? ' ' : '') + rest;
    el.talkText.replaceChildren(document.createTextNode(shown), restEl);
  }
  function finishLine() {
    talk.shown = talk.words.length;
    talk.done = true;
    renderTalkText();
    const next = quest.lines[talk.i + 1];
    if (!next || next[0] === 'you') showChoices(next);
    else el.talkMore.classList.remove('hidden');
  }
  // reply = the 'you' line coming up (two ways to say it), or none: accept / not now
  function showChoices(reply) {
    const onReply = () => {
      if (!talk) return;
      talk.i += 1;
      nextLine();
    };
    const options = reply
      ? [[reply[1], onReply], [TALK_CANCEL, () => unfocus()]]
      : [[quest.accept, () => requestStart(), 'ui-btn'], [VILLAGER_DECLINE, () => unfocus()]];
    talk.choices = options;
    el.talkMore.classList.add('hidden');
    el.talkChoices.replaceChildren(...options.map(([label, onClick, cls = 'ui-btn-secondary']) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `${cls} village-talk-choice`;
      b.textContent = label;
      b.addEventListener('click', () => { if (talk?.choices === options && !starting) onClick(); });
      return b;
    }));
  }
  function advanceTalk() {
    if (!talk || starting) return;
    if (!talk.done) finishLine();
    else if (!talk.choices) nextLine();
  }
  function updateTalk(dt) {
    if (!talk || talk.done) return;
    talk.acc += dt * TALK_WORDS_PER_SEC;
    const n = Math.min(talk.words.length, Math.floor(talk.acc));
    if (n === talk.shown) return;
    talk.shown = n;
    if (n >= talk.words.length) finishLine();
    else renderTalkText();
  }

  // ── Shop ──
  const itemCenter = (entry, out) => entry.object.getWorldPosition(out).add(entry.centerOffset || _v2.set(0, 0, 0));
  function selectItem(i) {
    selectedItem = i >= 0 && i < itemEntries.length ? i : -1;
    if (focus === 'shop') refreshPanel();
    refreshCard();
  }
  function stepItem(dir) {
    if (focus !== 'shop' || !itemEntries.length) return;
    const n = itemEntries.length;
    selectItem(selectedItem < 0 ? (dir > 0 ? 0 : n - 1) : (selectedItem + dir + n) % n);
  }
  function refreshCard() {
    const entry = itemEntries[selectedItem];
    if (focus !== 'shop' || !entry) { el.card.classList.add('hidden'); return; }
    const s = ctx.shop.getItemState(entry.def.id);
    el.cardName.textContent = s.name;
    el.cardDesc.textContent = s.desc || '';
    el.cardOwned.textContent = s.owned || '';
    el.cardOwned.classList.toggle('hidden', !s.owned);
    const coins = ctx.getCoins();
    let label = entry.def.chest ? `Open · ${s.price} 🪙` : `Buy · ${s.price} 🪙`;
    let disabled = false;
    if (s.status === 'soon') { label = 'Coming soon'; disabled = true; }
    else if (s.status === 'soldout') { label = 'Sold out'; disabled = true; }
    else if (s.status === 'max') { label = s.note || 'MAX'; disabled = true; }
    else if (coins < s.price) { label = `${s.price} 🪙 — need ${s.price - coins} more`; disabled = true; }
    else if (performance.now() < failedUntil) { label = 'Couldn’t buy — try again'; }
    el.buy.textContent = label;
    el.buy.disabled = disabled;
    el.card.classList.remove('hidden');
  }
  let buying = false;
  let failedUntil = 0;   // "Couldn't buy" shows on the button until then
  async function buySelected() {
    const entry = itemEntries[selectedItem];
    if (!entry || buying) return;
    buying = true;
    el.buy.disabled = true;
    try {
      const result = await ctx.shop.buy(entry.def.id).catch(() => null);
      if (result?.ok) {
        entry.hopUntil = performance.now() + 500;
        if (entry.def.chest) openChestFx(entry, result);
      } else {
        failedUntil = performance.now() + 1500;
      }
    } finally {
      buying = false;
      refreshCard();
    }
  }
  function openChestFx(entry, result) {
    chestFx = { entry, start: performance.now() };
    const sprite = makeEmojiSprite(result.emoji || '✨', 0.45);
    const start = itemCenter(entry, new THREE.Vector3()).add(_v.set(0, 0.3, 0));
    sprite.position.copy(start);
    root.add(sprite);
    prizeFx.push({ sprite, start, born: performance.now() });
  }

  // ── Campfire: sit until night / morning ──
  // Fade out, change the next stage's time of day (the lighting previews it), fade back in
  function sitUntil(choice) {
    if (sitting || !active || leaving) return;
    sitting = true;
    walk = null;
    if (stations.fire) faceYaw = yawToward(playerPos(), stations.fire.pos);
    el.fadeText.textContent = choice.fade;
    el.fade.classList.remove('hidden', 'is-on');
    void el.fade.offsetWidth;
    el.fade.classList.add('is-on');
    sitTimers.push(setTimeout(() => {
      ctx.time.set(choice.pref);
      refreshPanel();
      sitTimers.push(setTimeout(() => {
        el.fade.classList.remove('is-on');
        sitTimers.push(setTimeout(() => {
          el.fade.classList.add('hidden');
          sitting = false;
        }, SIT_FADE_MS));
      }, SIT_HOLD_MS));
    }, SIT_FADE_MS));
  }
  function cancelSit() {
    sitTimers.forEach(clearTimeout);
    sitTimers = [];
    sitting = false;
    el.fade.classList.remove('is-on');
    el.fade.classList.add('hidden');
  }

  // ── Characters ──
  function pickCharacter(npc) {
    if (swapBusy || !npc.container || npc.merchant || npc.villager) return;
    swapBusy = true;
    const player = ctx.getPlayer();
    const oldKey = ctx.characters.get().selected;
    // The new character walks over to the player...
    npc.walk = {
      to: player.model.position.clone(),
      onArrive: () => {
        // ...takes their place, and the old character steps out and goes to idle in the free slot
        const slot = npc.slot;
        const at = player.model.position.clone();
        removeNpc(npc);
        ctx.characters.select(npc.key);
        const alive = () => active && !!root;
        if (ctx.characters.roster[oldKey]) {
          spawnNpc(oldKey, slot, stations.characters.pos, alive, {
            at,
            onReady: (n) => { n.walk = { to: slot.clone(), onArrive: () => faceGroupFront(n) }; },
          });
        }
        swapBusy = false;
        refreshPanel();
      },
    };
    npc.character.setMoving(true);
  }
  function faceGroupFront(n) {
    const f = stations.characters?.facing;
    if (f && n.container) n.container.rotation.y = Math.atan2(f.x, f.z);
  }

  // ── Player movement ──
  const playerPos = () => ctx.getPlayer().model.position;
  function walkTo(to, onArrive) {
    walk = { to: to.clone(), onArrive, best: Infinity, bestAt: performance.now() };
  }
  function movePlayer(dt) {
    const { model, controls } = ctx.getPlayer();
    if (!model || !controls) return;
    if (walk) {
      const dx = walk.to.x - model.position.x;
      const dz = walk.to.z - model.position.z;
      const dist = Math.hypot(dx, dz);
      const now = performance.now();
      if (dist < walk.best - 0.02) { walk.best = dist; walk.bestAt = now; }
      // (a prop in the way: stop where it holds the player, unless walking in)
      const stuck = !approaching && now - walk.bestAt > WALK_STUCK_MS;
      if (dist < 0.08 || stuck) {
        const done = walk.onArrive;
        walk = null;
        controls.isMoving = false;
        done?.();
      } else {
        const step = Math.min(dist, PLAYER_WALK_SPEED * dt);
        const nx = model.position.x + (dx / dist) * step;
        const nz = model.position.z + (dz / dist) * step;
        setPlayerXZ(nx, nz);
        controls.isMoving = true;
        faceYaw = Math.atan2(dx, dz);
      }
    }
    if (faceYaw !== null) bodyYaw = angleLerp(bodyYaw, faceYaw, 1 - Math.exp(-8 * dt));
    model.rotation.y = bodyYaw;
    // (walking in: the controls' own camera follows the player, so it turns with them)
    if (approaching) controls.yaw = bodyYaw;
  }
  function setPlayerXZ(x, z) {
    const { model, controls } = ctx.getPlayer();
    model.position.x = x;
    model.position.z = z;
    controls.playerX = x;
    controls.playerZ = z;
    controls.lastPosition?.set(x, model.position.y, z);
    controls.body?.setNextKinematicTranslation?.({ x, y: model.position.y + 0.6, z });
  }

  // Keeps a point inside the village box (VILLAGE_BOUNDS, along the village's axes)
  function clampToVillage(pos) {
    const dx = pos.x - center.x;
    const dz = pos.z - center.z;
    const lx = THREE.MathUtils.clamp(dx * right.x + dz * right.z, -VILLAGE_BOUNDS.x, VILLAGE_BOUNDS.x);
    const lz = THREE.MathUtils.clamp(dx * fwd.x + dz * fwd.z, VILLAGE_BOUNDS.zMin, VILLAGE_BOUNDS.zMax);
    pos.x = center.x + right.x * lx + fwd.x * lz;
    pos.z = center.z + right.z * lx + fwd.z * lz;
    return pos;
  }
  // The player stays in the village box and out of the stall / fire / villager
  function constrainPlayer() {
    const { model, controls } = ctx.getPlayer();
    if (!model || !controls) return;
    const p = clampToVillage(_v.set(model.position.x, 0, model.position.z));
    for (const o of obstacles) {
      const ox = p.x - o.pos.x;
      const oz = p.z - o.pos.z;
      const d = Math.hypot(ox, oz);
      if (d >= o.r) continue;
      if (d < 1e-4) { p.x = o.pos.x + o.r; continue; }
      p.x = o.pos.x + (ox / d) * o.r;
      p.z = o.pos.z + (oz / d) * o.r;
    }
    if (Math.abs(p.x - model.position.x) > 1e-6 || Math.abs(p.z - model.position.z) > 1e-6) setPlayerXZ(p.x, p.z);
  }

  function updateNpcs(dt) {
    for (const n of npcs) {
      if (!n.character) continue;
      if (n.walk && n.container) {
        const p = n.container.position;
        const dx = n.walk.to.x - p.x;
        const dz = n.walk.to.z - p.z;
        const dist = Math.hypot(dx, dz);
        if (dist < 0.06) {
          const done = n.walk.onArrive;
          n.walk = null;
          n.character.setMoving(false);
          done?.();
          if (!n.character) continue;
        } else {
          const step = Math.min(dist, (n.walk.speed ?? NPC_WALK_SPEED) * dt);
          p.x += (dx / dist) * step;
          p.z += (dz / dist) * step;
          p.y = groundY(p.x, p.z, p.y);
          n.container.rotation.y = angleLerp(n.container.rotation.y, Math.atan2(dx, dz), 1 - Math.exp(-10 * dt));
        }
      }
      n.character.animate(dt);
      n.character.stepFluff(dt);
    }
  }

  // ── Input (tap / click / swipe on the 3D view) ──
  let down = null;
  const pick = (clientX, clientY) => {
    const rect = domElement.getBoundingClientRect();
    _ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    _ray.setFromCamera(_ndc, camera);
    const hits = _ray.intersectObjects(clickables, true);
    const targets = [];
    for (const h of hits) {
      const o = h.object;
      if (o.isSprite && (o.material?.opacity === 0 || !o.visible)) continue;
      const t = o.userData.villageTarget;
      if (t && !targets.includes(t)) targets.push(t);
    }
    // A character wins over the campfire in front of them; among counter items the one whose
    // centre is closest to the tap wins (their tap targets overlap)
    const npc = targets.find((t) => t.npc);
    if (npc) return npc;
    let best = null;
    let bestD = Infinity;
    for (const t of targets) {
      if (!Number.isInteger(t.item) || !itemEntries[t.item]) continue;
      const d = _ray.ray.distanceSqToPoint(itemCenter(itemEntries[t.item], _v));
      if (d < bestD) { bestD = d; best = t; }
    }
    return best ?? targets[0] ?? null;
  };
  const onPointerDown = (e) => {
    if (!active || leaving || approaching || sitting) return;
    down = { x: e.clientX, y: e.clientY, t: performance.now() };
  };
  const onPointerUp = (e) => {
    if (!active || leaving || approaching || !down) return;
    const dx = e.clientX - down.x;
    const dy = e.clientY - down.y;
    const dt = performance.now() - down.t;
    down = null;
    if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.4 && dt < 700) {
      // (at the shop: the next item)
      if (focus === 'shop') stepItem(dx < 0 ? 1 : -1);
      return;
    }
    if (Math.hypot(dx, dy) > 12 || sitting) return;
    const t = pick(e.clientX, e.clientY);
    if (focus) {
      // At a station: its items / characters are tapped, anywhere else goes back to the village
      const inStation = t && ((focus === 'shop' && Number.isInteger(t.item)) || (focus === 'characters' && t.npc));
      if (inStation) onTarget(t);
      else if (!starting) unfocus();
      return;
    }
    if (t) { onTarget(t); return; }
    // Walking around: tap / click the ground to walk there (pick() aimed _ray)
    if (e.target === domElement) {
      _groundPlane.set(_UP, -playerPos().y);
      if (_ray.ray.intersectPlane(_groundPlane, _v)) walkTo(clampToVillage(_v), null);
    }
  };
  const onPointerMove = (e) => {
    if (!active || leaving || approaching || e.pointerType === 'touch') return;
    domElement.style.cursor = pick(e.clientX, e.clientY) ? 'pointer' : '';
  };
  const onKeyDown = (e) => {
    if (!active || leaving || approaching || sitting) return;
    if (e.target?.closest?.('input, textarea')) return;
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    // (a focused button gets Enter / Space itself)
    if ((key === 'Enter' || key === ' ') && e.target?.closest?.('button')) return;
    if (focus === 'villager' && talk) {
      // Conversation: Enter / E / Space = finish the line / next; 1, 2 = a reply
      if (key === 'Enter' || key === 'e' || key === ' ') {
        if (talk.done && talk.choices) talk.choices[0]?.[1]();
        else advanceTalk();
        e.preventDefault();
        return;
      }
      const n = Number(key);
      if (talk.done && talk.choices && n >= 1 && n <= talk.choices.length) {
        talk.choices[n - 1][1]();
        e.preventDefault();
        return;
      }
    }
    if (key === 'Escape' && focus && !starting) { unfocus(); e.preventDefault(); return; }
    if ((key === 'e' || key === 'Enter') && !focus && nearKeys) {
      focusStation(nearKeys.split(',')[0]);
      e.preventDefault();
      return;
    }
    if (focus !== 'shop' || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
    stepItem(e.key === 'ArrowLeft' ? -1 : 1);
    e.preventDefault();
  };

  function onTarget(t) {
    if (t.station === 'villager') {
      if (focus !== 'villager') focusStation('villager');
      return;
    }
    if (t.station === 'shop') {
      if (Number.isInteger(t.item)) {
        if (focus === 'shop' && selectedItem === t.item && itemEntries[t.item]?.def.chest) { void buySelected(); return; }
        focusStation('shop', { item: t.item });
      } else if (focus !== 'shop') {
        focusStation('shop');
      }
      return;
    }
    if (t.station === 'characters') {
      if (focus === 'characters' && t.npc) pickCharacter(t.npc);
      else focusStation('characters');
      return;
    }
    if (t.station === 'fire') {
      focusStation('fire');
      return;
    }
  }

  // ── Stage start ──
  // Quest accepted: the game first makes the player calibrate the sword (ctx.confirmStart)
  function requestStart() {
    if (leaving || starting) return;
    if (!ctx.confirmStart) { startStage(); return; }
    starting = true;
    const token = buildToken;
    ctx.confirmStart(() => {
      if (token !== buildToken) return; // (this village was closed meanwhile)
      starting = false;
      if (active && !leaving) startStage();
    });
  }

  function startStage() {
    if (leaving) return;
    focus = null;
    selectItem(-1);
    walk = null;
    faceYaw = null;
    endTalk();
    el.panel.classList.add('hidden');
    el.card.classList.add('hidden');
    el.lobby.classList.add('hidden');
    el.hint.classList.add('hidden');
    hideActs();
    document.body.classList.remove('village-focused');
    ui.querySelector('.village-top')?.classList.add('hidden');
    domElement.style.cursor = '';
    document.body.classList.remove('village-mode'); // fight HUD back
    // The villager is in the way of the walk: he steps aside (his marker etc. go at once);
    // the rest goes once we're past it
    const v = stations.villager;
    if (v) [v.marker, v.label, v.ring, v.hit].forEach((o) => o.parent?.remove(o));
    leaving = { startedMs: performance.now() };
    const { controls } = ctx.getPlayer();
    if (controls) controls.yaw = Math.atan2(fwd.x, fwd.z);
    showBanner();
    if (finalBoss) {
      // Pemberton doesn't step aside: the stage's boss takes his place
      const npc = v?.npc;
      const bossSpot = v ? { position: v.pos.clone(), yaw: npc?.container?.rotation.y ?? Math.atan2(v.facing.x, v.facing.z) } : null;
      if (npc) removeNpc(npc);
      ctx.onStart(pathAngle, { bossSpot });
      return;
    }
    stepVillagerAside();
    ctx.onStart(pathAngle);
  }

  function stepVillagerAside() {
    const npc = stations.villager?.npc;
    if (!npc?.character) return;
    const to = local(LAYOUT.villagerAside.x, 0, LAYOUT.villagerAside.z);
    npc.walk = {
      to,
      speed: VILLAGER_ASIDE_SPEED,
      // ...and watches the player go
      onArrive: () => { if (npc.container) npc.container.rotation.y = Math.atan2(-right.x, -right.z); },
    };
    npc.character.setMoving(true);
  }

  function hideActs() {
    nearKeys = '';
    el.acts.replaceChildren();
    el.acts.classList.add('hidden');
  }

  function showBanner() {
    el.bannerTitle.textContent = finalBoss || stageInfo.stage > 50 ? 'FINAL STAGE' : `STAGE ${stageInfo.stage}`;
    el.bannerSub.textContent = finalBoss
      ? `${quest.title} · Defeat ${quest.speaker}`
      : `${quest.title} · Defeat ${stageInfo.count} enemies`;
    el.bannerBoss.textContent = stageInfo.boss || '';
    el.banner.classList.remove('hidden', 'village-banner-out');
    void el.banner.offsetWidth;
    el.banner.classList.add('village-banner-in');
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => {
      el.banner.classList.add('village-banner-out');
      bannerTimer = setTimeout(() => el.banner.classList.add('hidden'), 450);
    }, 3200);
  }

  // ── Lifecycle ──
  /**
   * Opens the village around the player — or, with `center`, at that spot: the player walks
   * there first (the UI shows on arrival, then `onArrive()`).
   * @param {{ stage: number, count: number, boss: string, pathAngle: number,
   *           center?: THREE.Vector3, onArrive?: () => void }} info
   *   pathAngle: next stage's direction (x = cos, z = sin, as _psBuildStage uses it)
   */
  function enter(info) {
    exit();
    active = true;
    leaving = null;
    starting = false;
    stageInfo = info;
    quest = villagerQuestForStage(info.stage);
    finalBoss = !!info.finalBoss;
    villagerScale = finalBoss ? PEMBERTON_SCALE : 1;
    pathAngle = info.pathAngle;
    buildToken += 1;
    labelScale = camera.aspect < 0.8 ? 1.6 : camera.aspect < 1.2 ? 1.25 : 1;
    compact = isCompact();
    const { model, controls } = ctx.getPlayer();
    approaching = !!info.center;
    if (info.center) center.set(info.center.x, groundY(info.center.x, info.center.z, model.position.y), info.center.z);
    else center.copy(model.position);
    fwd.set(Math.cos(pathAngle), 0, Math.sin(pathAngle)).normalize();
    right.crossVectors(fwd, _UP).normalize();
    focus = null;
    selectedItem = -1;
    walk = null;
    talk = null;
    obstacles = [];
    hideActs();
    faceYaw = Math.atan2(fwd.x, fwd.z);
    bodyYaw = controls?.yaw ?? faceYaw;
    followYaw = faceYaw;
    prevPos.copy(model.position);
    if (controls) { controls.yaw = faceYaw; controls.pitch = 0; }
    if (approaching) {
      walk = {
        to: center.clone(),
        onArrive: () => {
          approaching = false;
          faceYaw = Math.atan2(fwd.x, fwd.z);
          showUi();
          info.onArrive?.();
        },
      };
    }
    camInit = false;
    camReleased = false;
    swapBusy = false;
    stations = {};
    clickables.length = 0;
    void ctx.shop.load?.().then(() => refreshCard());
    ui.classList.remove('hidden');
    el.banner.classList.add('hidden');
    el.stage.textContent = `${finalBoss || info.stage > 50 ? 'Final stage' : `Stage ${info.stage}`}${quest.place ? ` · ${quest.place}` : ''}`;
    if (approaching) {
      el.lobby.classList.add('hidden');
      ui.querySelector('.village-top')?.classList.add('hidden');
      el.panel.classList.add('hidden');
      el.hint.classList.add('hidden');
      el.talk.classList.add('hidden');
    } else {
      showUi();
    }
    refreshCard();
    document.body.classList.add('village-mode');
    domElement.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointerup', onPointerUp);
    domElement.addEventListener('pointermove', onPointerMove);
    window.addEventListener('keydown', onKeyDown);
    void build(buildToken);
  }

  function showUi() {
    ui.querySelector('.village-top')?.classList.remove('hidden');
    refreshBack();
    refreshPanel();
  }

  // Removes the village props (the banner can keep playing)
  function teardown() {
    buildToken += 1;
    [...npcs].forEach(removeNpc);
    npcs = [];
    if (root) {
      scene.remove(root);
      disposeOwned(root);
      root = null;
    }
    clickables.length = 0;
    itemEntries = [];
    campfire = null;
    overviewLabels = [];
    prizeFx = [];
    chestFx = null;
    stations = {};
  }

  function exit() {
    const wasActive = active;
    cancelSit();
    active = false;
    leaving = null;
    approaching = false;
    starting = false;
    teardown();
    walk = null;
    faceYaw = null;
    focus = null;
    selectedItem = -1;
    endTalk();
    hideActs();
    obstacles = [];
    el.hint.classList.add('hidden');
    document.body.classList.remove('village-focused');
    domElement.removeEventListener('pointerdown', onPointerDown);
    window.removeEventListener('pointerup', onPointerUp);
    domElement.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('keydown', onKeyDown);
    domElement.style.cursor = '';
    document.body.classList.remove('village-mode');
    ui.classList.add('hidden');
    el.panel.classList.add('hidden');
    el.card.classList.add('hidden');
    el.lobby.classList.add('hidden');
    if (wasActive) {
      clearTimeout(bannerTimer);
      el.banner.classList.add('hidden');
    }
  }

  // Leaving: banner stays up on its own timer; the rest of the UI is hidden
  function finishLeaving() {
    active = false;
    leaving = null;
    teardown();
    domElement.removeEventListener('pointerdown', onPointerDown);
    window.removeEventListener('pointerup', onPointerUp);
    domElement.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('keydown', onKeyDown);
    document.body.classList.remove('village-mode', 'village-focused');
    el.panel.classList.add('hidden');
    el.card.classList.add('hidden');
    obstacles = [];
  }

  // Projects the buy card above its item
  function placeCard() {
    const entry = itemEntries[selectedItem];
    if (!entry || el.card.classList.contains('hidden')) return;
    const p = itemCenter(entry, _v).add(_v2.set(0, 0.2, 0)).project(camera);
    const w = window.innerWidth;
    const h = window.innerHeight;
    const cw = el.card.offsetWidth || 260;
    const ch = el.card.offsetHeight || 140;
    let x = (p.x * 0.5 + 0.5) * w;
    let y = (-p.y * 0.5 + 0.5) * h - 18;
    x = Math.min(w - cw / 2 - 12, Math.max(cw / 2 + 12, x));
    y = Math.min(h - 16, Math.max(ch + 70, y));
    el.card.style.left = `${x}px`;
    el.card.style.top = `${y}px`;
  }

  /** Every frame, after the player controls (it has the last word on the camera). */
  function update(dt) {
    if (!active) return;
    const now = performance.now();
    const t = now / 1000;
    dt = Math.min(dt || 0.016, 0.1);
    const { model } = ctx.getPlayer();

    if (leaving) {
      // Hand the camera back to the player controls smoothly, then take the props away
      const far = model && Math.hypot(model.position.x - center.x, model.position.z - center.z) > LEAVE_REMOVE_DIST;
      updateNpcs(dt);
      if (!camReleased) {
        _v.copy(camera.position);
        camera.getWorldDirection(_v2);
        wantPos.copy(_v);
        wantLook.copy(_v).addScaledVector(_v2, 6);
        const k = 1 - Math.exp(-CAMERA_LERP * 2 * dt);
        camPos.lerp(wantPos, k);
        camLook.lerp(wantLook, k);
        camFov += (camera.fov - camFov) * k;  // (camera.fov: the controls' value this frame)
        if (camPos.distanceTo(wantPos) < 0.05 || now - leaving.startedMs > 1500) camReleased = true;
        else {
          camera.fov = camFov;
          camera.updateProjectionMatrix();
          camera.position.copy(camPos);
          camera.lookAt(camLook);
        }
      }
      // (the fight with Pemberton is right here: the props stay until the next village)
      if (far || (!finalBoss && now - leaving.startedMs > LEAVE_REMOVE_MS)) finishLeaving();
      return;
    }

    if (isCompact() !== compact) {
      compact = !compact;
      if (!approaching) { refreshPanel(); refreshBack(); }
    }
    // Moved by WASD / the joystick this frame (the controls ran first): that cancels a tap-walk
    // and leaves a station; the body turns the way it goes
    const { controls } = ctx.getPlayer();
    if (model && controls?.isMoving && !approaching && !sitting) {
      if (walk) walk = null;
      if (focus) unfocus();
      const mx = model.position.x - prevPos.x;
      const mz = model.position.z - prevPos.z;
      if (Math.hypot(mx, mz) > 1e-3) faceYaw = Math.atan2(mx, mz);
    }
    movePlayer(dt);
    if (!approaching) constrainPlayer();
    if (model) prevPos.copy(model.position);
    updateNpcs(dt);
    updateTalk(dt);

    overviewLabels.forEach((l) => { l.visible = !focus && l.position.distanceTo(camera.position) > LABEL_HIDE_DIST * labelScale; });
    // Idle motion: quest marker bob, items on the counter
    const vil = stations.villager;
    if (vil) {
      vil.marker.position.y = vil.markerY + Math.sin(t * 2.4) * 0.06;
      vil.marker.visible = focus !== 'villager';
      const s = 1 + Math.sin(t * 3) * 0.06;
      vil.ring.scale.set(s, s, s);
      vil.npc?.glow?.update(t);
    }
    if (campfire) updateCampfire(campfire, t);
    itemEntries.forEach((entry, i) => {
      const o = entry.object;
      const sel = focus === 'shop' && i === selectedItem;
      if (entry.def.chest) {
        // Hop when opened
        const fx = chestFx?.entry === entry ? (now - chestFx.start) / 600 : 1;
        o.position.y = entry.baseY + (fx < 1 ? Math.sin(fx * Math.PI) * 0.18 : 0);
        o.rotation.z = fx < 1 ? Math.sin(fx * Math.PI * 4) * 0.06 : 0;
        return;
      }
      if (entry.def.potion) {
        // (child of the scaled stall: offsets in stall units)
        o.position.y = entry.baseY + (sel ? (0.04 + Math.sin(t * 3) * 0.02) / STALL_UNIT : 0);
        o.rotation.y = sel ? t * 1.4 : 0;
        return;
      }
      const hop = entry.hopUntil && now < entry.hopUntil ? Math.sin(((entry.hopUntil - now) / 500) * Math.PI) * 0.08 : 0;
      const hang = entry.def.hang ? Math.sin(t * 1.6 + i) * 0.03 : 0;
      o.position.y = entry.baseY + hang + hop + (sel ? 0.04 + Math.sin(t * 3) * 0.02 : 0);
      o.rotation.y = entry.baseRotY + (sel || entry.def.hang ? t * (sel ? 1.4 : 0.5) : 0);
    });
    prizeFx = prizeFx.filter((p) => {
      const age = (now - p.born) / 1800;
      if (age >= 1) { p.sprite.parent?.remove(p.sprite); disposeOwned(p.sprite); return false; }
      p.sprite.position.copy(p.start).add(_v.set(0, age * 0.9, 0));
      p.sprite.material.opacity = age < 0.7 ? 1 : 1 - (age - 0.7) / 0.3;
      const s = 0.45 + age * 0.25;
      p.sprite.scale.set(s, s, 1);
      return true;
    });

    // Walking in: the player controls' camera follows the player; on arrival it eases out to
    // the village view from wherever it is (camInit picks the pose up then)
    if (approaching) return;

    // Camera: following the player, or framed on the station they're at
    if (!camInit) {
      camFov = camera.fov;
      camPos.copy(camera.position);
      camera.getWorldDirection(_v);
      camLook.copy(camera.position).addScaledVector(_v, 6);
      followYaw = Math.atan2(_v.x, _v.z);
      camInit = true;
    }
    const near = nearbyStations();
    refreshActs(near);
    computeWantedCamera(dt, near);
    const k = 1 - Math.exp(-(focus ? CAMERA_LERP : FOLLOW_LERP) * dt);
    camPos.lerp(wantPos, k);
    camLook.lerp(wantLook, k);
    const heading = Math.atan2(camLook.x - camPos.x, camLook.z - camPos.z);
    // (at a station: the follow camera picks up from here when the player walks off)
    if (focus) followYaw = heading;
    // WASD / the joystick move relative to this view (the controls aim their camera along yaw)
    if (controls) controls.yaw = heading;
    camFov += (VILLAGE_FOV - camFov) * k;
    camera.fov = camFov;
    camera.updateProjectionMatrix();
    camera.position.copy(camPos);
    camera.lookAt(camLook);
    camera.updateMatrixWorld(); // (the controls refreshed it with their own pose this frame)

    el.coins.textContent = `🪙 ${ctx.getCoins()}`;
    if (focus === 'shop' && selectedItem >= 0) {
      // Coins can change (auto-buy, the chest): keep the button honest
      if (now - cardRefreshedAt > 400) { cardRefreshedAt = now; if (!buying) refreshCard(); }
      placeCard();
    }
  }

  return {
    enter,
    exit,
    update,
    isActive: () => active,
    /** True while the village (not the stage walk after it) has the player. */
    isOpen: () => active && !leaving,
  };
}

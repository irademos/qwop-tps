// Sword Showdown village: the hub between stages (replaces the old stage screen).
//
// Built around the player wherever they stand when it opens. Everything is in the 3D
// world and is clicked / tapped: the player walks over and the camera focuses on it.
//   • Market stall + merchant + treasure chest — the shop. Items sit on the counter; tap
//     one (or swipe / ‹ › / arrow keys) for its buy card. The chest is a mystery item.
//   • Unlocked characters idling — tap one to play as them: they walk over and take the
//     player's place, the old character goes to idle in their spot.
//   • Floating ☀️ 🌙 🎲 — the next stage's time of day.
//   • Arrow — points along the next stage's path; tap it to start the stage (after the
//     sword calibration popup, ctx.confirmStart).
// ⬅ Lobby top left (overview); ⬅ Village bottom middle (focused on something).
// Phones (portrait / touch): no high overview — the home view is low behind the player,
// on the arrow; ‹ › buttons or a swipe move the camera between the stations (STATION_ORDER).
// After a stage win it can be built a little way ahead, the player walking in (`approach`).
//
// Game access goes through `ctx` (villageCtx in bootstrapGameApp.js); the shop logic
// (prices, stock, buying, the chest's prizes) lives there too.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { createGLBCharacterInstance, glbCharacterConfig } from '../models/glbCharacterModel.js';
import { createBombMesh, getBombGLTF } from '../characters/BombThrowerEnemy.js';
import { stylizeObject } from '../environment/artStyle.js';

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

// ── Layout (village-local metres: x = right, z = toward the next stage) ────────
const LAYOUT = {
  stall: new THREE.Vector3(-3.5, 0, 3.0),
  chestSide: 1.45,                 // chest: this far beside the stall (toward the centre)
  characters: new THREE.Vector3(3.5, 0, 3.0),
  time: new THREE.Vector3(1.5, 1.3, 5.4),
  arrow: new THREE.Vector3(0, 0.3, 6.6),
};
const CHARACTER_ARC_RADIUS = 1.35;
const PLAYER_WALK_SPEED = 2.4;     // m/s
const NPC_WALK_SPEED = 1.7;        // m/s
const CAMERA_LERP = 3.2;           // 1/s
const VILLAGE_FOV = 55;            // the fight camera is very wide; the village is framed tighter
// Phone station carousel, left → right as seen from the village centre (null = home: the arrow)
const STATION_ORDER = ['shop', null, 'time', 'characters'];
const STATION_NAMES = { shop: '🛒 Shop', null: '➜ Next stage', time: '☀️ Time', characters: '👥 Characters' };
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

const TIME_CHOICES = [
  { pref: 'day', emoji: '☀️', label: 'Day' },
  { pref: 'random', emoji: '🎲', label: 'Random' },
  { pref: 'night', emoji: '🌙', label: 'Night' },
];

const _UP = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _ray = new THREE.Raycaster();
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

// Flat arrow lying over the ground, pointing along +Z (reads well from the raised camera)
function makeArrowMesh() {
  const s = new THREE.Shape();
  const hw = 0.2;   // half shaft width
  const hh = 0.55;  // half head width
  s.moveTo(-hw, -0.8);
  s.lineTo(hw, -0.8);
  s.lineTo(hw, 0.05);
  s.lineTo(hh, 0.05);
  s.lineTo(0, 0.8);
  s.lineTo(-hh, 0.05);
  s.lineTo(-hw, 0.05);
  s.closePath();
  const geo = new THREE.ExtrudeGeometry(s, { depth: 0.1, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.03, bevelSegments: 2 });
  geo.rotateX(Math.PI / 2);          // shape +Y (the tip) → +Z, extruded downward
  const mat = new THREE.MeshStandardMaterial({ color: 0xf4c454, emissive: 0xc98a12, emissiveIntensity: 0.8, roughness: 0.35, metalness: 0.2 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  const g = new THREE.Group();
  g.add(mesh);
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
 *  confirmStart(go)   — the arrow was tapped: call go() to start the stage (after calibrating)
 *  onStart(pathAngle)  — start the stage (the player auto-walks along pathAngle)
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
  let starting = false;     // arrow tapped, waiting on ctx.confirmStart
  let root = null;          // THREE.Group with everything
  let center = new THREE.Vector3();
  let fwd = new THREE.Vector3(0, 0, 1);
  let right = new THREE.Vector3(-1, 0, 0);
  let pathAngle = 0;
  let stageInfo = null;
  let buildToken = 0;

  let stations = {};        // key → station
  let focus = null;         // focused station key or null (overview)
  let selectedItem = -1;    // SHOP_ITEMS index
  let itemEntries = [];     // { def, object, baseY, baseRotY, centerOffset, hopUntil }
  let npcs = [];            // { key, container, character, slot: Vector3, walk: { to, onArrive }, label }
  let swapBusy = false;
  let timeSprites = [];
  let chestFx = null;
  let prizeFx = [];
  let cardRefreshedAt = 0;
  let overviewLabels = [];  // station names: only shown in the overview (huge in close-ups)

  // Player walk + facing
  let walk = null;          // { to: Vector3, onArrive }
  let faceYaw = null;
  // Camera (smoothed)
  const camPos = new THREE.Vector3();
  const camLook = new THREE.Vector3();
  const wantPos = new THREE.Vector3();
  const wantLook = new THREE.Vector3();
  let camInit = false;
  let camReleased = false;
  let camFov = 60;

  // ── DOM ──
  const ui = document.createElement('div');
  ui.className = 'village-ui hidden';
  ui.innerHTML = `
    <button type="button" class="ui-btn-secondary village-back" data-v="back">⬅ Lobby</button>
    <button type="button" class="ui-btn-secondary village-nav village-nav-prev hidden" data-v="nav-prev"></button>
    <button type="button" class="ui-btn-secondary village-nav village-nav-next hidden" data-v="nav-next"></button>
    <div class="village-top ui-chip"><span data-v="stage"></span><span class="village-top-sep">·</span><span data-v="coins"></span></div>
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
    <div class="village-banner hidden" data-v="banner">
      <div class="village-banner-title" data-v="banner-title"></div>
      <div class="village-banner-sub" data-v="banner-sub"></div>
      <div class="village-banner-boss" data-v="banner-boss"></div>
    </div>`;
  document.body.appendChild(ui);
  const $ = (k) => ui.querySelector(`[data-v="${k}"]`);
  const el = {
    back: $('back'), stage: $('stage'), coins: $('coins'),
    panel: $('panel'), panelTitle: $('panel-title'), panelText: $('panel-text'), panelActions: $('panel-actions'),
    card: $('card'), cardName: $('card-name'), cardDesc: $('card-desc'), cardOwned: $('card-owned'), buy: $('buy'),
    prev: $('prev'), next: $('next'), navPrev: $('nav-prev'), navNext: $('nav-next'),
    banner: $('banner'), bannerTitle: $('banner-title'), bannerSub: $('banner-sub'), bannerBoss: $('banner-boss'),
  };
  let bannerTimer = null;

  el.back.addEventListener('click', () => {
    if (!active || leaving || approaching) return;
    if (focus) unfocus();
    else ctx.onLobby();
  });
  el.prev.addEventListener('click', () => stepItem(-1));
  el.next.addEventListener('click', () => stepItem(1));
  el.buy.addEventListener('click', () => { void buySelected(); });
  el.navPrev.addEventListener('click', () => stepStation(-1));
  el.navNext.addEventListener('click', () => stepStation(1));

  // Phones: low home view on the arrow + station carousel instead of the high overview
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

    // Arrow toward the next stage
    {
      const arrow = makeArrowMesh();
      const pos = local(LAYOUT.arrow.x, 0, LAYOUT.arrow.z);
      const gy = groundY(pos.x, pos.z, center.y);
      arrow.position.set(pos.x, gy + LAYOUT.arrow.y, pos.z);
      arrow.rotation.y = Math.atan2(fwd.x, fwd.z);
      const label = textSprite(`Stage ${stageInfo.stage}  ➜`, { height: 0.38 });
      label.position.set(pos.x, gy + LAYOUT.arrow.y + 0.9, pos.z);
      const ring = makeRing(1.05);
      ring.position.set(pos.x, gy + 0.03, pos.z);
      root.add(arrow, label, ring);
      overviewLabels.push(label);
      const st = { key: 'arrow', arrow, label, ring, baseY: arrow.position.y, basePos: arrow.position.clone() };
      stations.arrow = st;
      makeClickable(arrow, { station: 'arrow' });
      makeClickable(label, { station: 'arrow' });
      makeClickable(ring, { station: 'arrow' });
    }

    // Time of day: ☀️ 🎲 🌙 floating side by side
    {
      const pos = local(LAYOUT.time.x, 0, LAYOUT.time.z);
      const gy = groundY(pos.x, pos.z, center.y);
      const base = new THREE.Vector3(pos.x, gy + LAYOUT.time.y, pos.z);
      timeSprites = TIME_CHOICES.map((c, i) => {
        const s = makeEmojiSprite(c.emoji, 0.5);
        s.position.copy(base).addScaledVector(right, (i - 1) * 0.55);
        root.add(s);
        makeClickable(s, { station: 'time', time: c.pref });
        return { ...c, sprite: s, base: s.position.clone() };
      });
      const label = textSprite('☀️ Time of day 🌙', { height: 0.28 });
      label.position.copy(base).add(_v.set(0, 0.5, 0));
      const ring = makeRing(0.45);
      ring.position.set(pos.x, gy + 0.03, pos.z);
      root.add(label, ring);
      overviewLabels.push(label);
      stations.time = { key: 'time', label, pos: base.clone() };
      makeClickable(label, { station: 'time' });
      refreshTime();
    }

    // Characters: the unlocked ones (except the one being played) idle in a little arc
    {
      const pos = local(LAYOUT.characters.x, 0, LAYOUT.characters.z);
      const gy = groundY(pos.x, pos.z, center.y);
      const groupCenter = new THREE.Vector3(pos.x, gy, pos.z);
      // Arc opens toward the village centre
      const toCenter = _v.subVectors(center, groupCenter).setY(0).normalize().clone();
      const label = textSprite('👥 Characters', { height: 0.32 });
      label.position.copy(groupCenter).add(_v2.set(0, 1.75, 0));
      root.add(label);
      overviewLabels.push(label);
      stations.characters = { key: 'characters', label, pos: groupCenter.clone(), facing: toCenter };
      makeClickable(label, { station: 'characters' });
      const { unlocked, selected } = ctx.characters.get();
      const keys = unlocked.filter((k) => k !== selected && ctx.characters.roster[k]);
      const lockedCount = Object.keys(ctx.characters.roster).length - unlocked.length;
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
      // Front (+Z of the model) faces a point behind the village centre (toward the overview camera)
      const lookAt = local(0, 0, -3);
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
          const size = box.isEmpty() ? 0.2 : box.getSize(new THREE.Vector3()).length() / 2;
          const hit = new THREE.Mesh(new THREE.SphereGeometry(Math.max(0.17, size), 10, 8), hitMat);
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

  function computeWantedCamera() {
    const st = focus ? stations[focus] : null;
    if (!st && compact) {
      // Home: low behind the player, on the arrow (the player stands in the foreground)
      const target = local(0, 0.55, LAYOUT.arrow.z - 0.4);
      const dir = _v2.copy(fwd).multiplyScalar(-1).addScaledVector(_UP, 0.3);
      setView(target, dir, 1.5, 1.0, 4.5);
      return;
    }
    if (!st) {
      // Overview from behind the village centre, a little above
      // (aimed a little short of the middle so the bottom panel doesn't cover the player)
      const target = local(0, 0.35, 2.4);
      // (steeper on tall screens: more of the height is used)
      const dir = _v2.copy(fwd).multiplyScalar(-1).addScaledVector(_UP, camera.aspect < 1 ? 1.15 : 0.55);
      setView(target, dir, 5.0, 2.9, 5);
      return;
    }
    if (focus === 'shop') {
      const s = stations.shop;
      const entry = itemEntries[selectedItem];
      if (entry) {
        const p = itemCenter(entry, new THREE.Vector3());
        p.y += 0.05;
        const dir = _v.copy(s.facing).addScaledVector(_UP, 0.45).clone();
        setView(p, dir, 0.8, 0.5, 1.5);
      } else {
        // Stall + chest
        const target = _v2.copy(s.stallRoot.position).addScaledVector(s.side, s.chestSign * 0.55).add(_v.set(0, 0.85, 0)).clone();
        const dir = _v.copy(s.facing).addScaledVector(_UP, compact ? 0.22 : 0.32).clone();
        setView(target, dir, compact ? 1.8 : 2.3, 1.4, 2.6);
      }
    } else if (focus === 'characters') {
      const s = stations.characters;
      const target = _v2.copy(s.pos).add(_v.set(0, 0.6, 0)).clone();
      const dir = _v.copy(s.facing).addScaledVector(_UP, compact ? 0.22 : 0.35).clone();
      setView(target, dir, compact ? 1.15 : 1.35, 0.8, 2.2);
    } else if (focus === 'time') {
      const s = stations.time;
      const target = _v2.copy(s.pos).clone();
      const dir = _v.subVectors(center, s.pos).setY(0).normalize().addScaledVector(_UP, 0.15).clone();
      setView(target, dir, 1.0, 0.55, 1.6);
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
    }
    if (key === 'shop') selectItem(item);
    else selectItem(-1);
    refreshPanel();
    refreshBack();
  }

  function unfocus() {
    focus = null;
    selectItem(-1);
    // (phones: the home view is from behind the village centre — the player goes back there)
    if (compact) walkTo(center, () => { faceYaw = Math.atan2(fwd.x, fwd.z); });
    refreshPanel();
    refreshBack();
  }

  // Phones: ‹ › / swipe to the neighbouring station
  function stepStation(dir) {
    if (!active || leaving || approaching) return;
    const i = STATION_ORDER.indexOf(focus);
    const n = STATION_ORDER.length;
    const key = STATION_ORDER[(Math.max(i, 0) + dir + n) % n];
    if (key === null) unfocus();
    else focusStation(key);
  }
  // ‹ › name the neighbouring stations; hidden off phones and while the buy card (its own ‹ ›) is up
  function refreshNav() {
    const show = compact && active && !leaving && !approaching && !(focus === 'shop' && selectedItem >= 0);
    el.navPrev.classList.toggle('hidden', !show);
    el.navNext.classList.toggle('hidden', !show);
    if (!show) return;
    const i = Math.max(STATION_ORDER.indexOf(focus), 0);
    const n = STATION_ORDER.length;
    el.navPrev.textContent = `‹ ${STATION_NAMES[STATION_ORDER[(i - 1 + n) % n]]}`;
    el.navNext.textContent = `${STATION_NAMES[STATION_ORDER[(i + 1) % n]]} ›`;
  }

  // ⬅ Lobby top left in the overview; ⬅ Village bottom middle when focused (the bottom
  // panel moves up above it)
  function refreshBack() {
    el.back.textContent = focus ? '⬅ Village' : '⬅ Lobby';
    el.back.classList.toggle('village-back-bottom', !!focus);
    ui.classList.toggle('village-focused', !!focus);
    refreshNav();
  }

  // Bottom panel: what to do at the current station
  function refreshPanel() {
    const show = (title, text, actions = []) => {
      el.panelTitle.textContent = title;
      el.panelText.textContent = text;
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
    if (!focus) {
      show(`Stage ${stageInfo.stage}`, compact
        ? 'Swipe or tap ‹ › for the shop, characters and time of day — tap the arrow when you’re ready to fight.'
        : 'Tap the shop, a character or the sun / moon — tap the arrow when you’re ready to fight.');
    } else if (focus === 'shop') {
      if (selectedItem >= 0) el.panel.classList.add('hidden');
      else show('🛒 Shop', 'Tap an item on the stall — or the chest for a mystery prize.');
    } else if (focus === 'characters') {
      const sel = ctx.characters.roster[ctx.characters.get().selected];
      const any = npcs.some((n) => !n.merchant);
      show('👥 Characters', any
        ? `Playing as ${sel?.emoji ?? ''} ${sel?.label ?? ''}. Tap a character to switch.`
        : `Playing as ${sel?.emoji ?? ''} ${sel?.label ?? ''}. Beat a stage’s final enemy to unlock their character.`);
    } else if (focus === 'time') {
      const cur = TIME_CHOICES.find((c) => c.pref === ctx.time.get());
      show('Time of day', `Next stage: ${cur?.emoji ?? ''} ${cur?.label ?? ''}. Tap ☀️ day, 🌙 night or 🎲 random.`);
    }
  }

  // ── Shop ──
  const itemCenter = (entry, out) => entry.object.getWorldPosition(out).add(entry.centerOffset || _v2.set(0, 0, 0));
  function selectItem(i) {
    selectedItem = i >= 0 && i < itemEntries.length ? i : -1;
    if (focus === 'shop') refreshPanel();
    refreshCard();
    refreshNav();
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

  // ── Time of day ──
  function refreshTime() {
    const pref = ctx.time.get();
    timeSprites.forEach((t) => {
      t.selected = t.pref === pref;
      t.sprite.material.opacity = t.selected ? 1 : 0.6;
    });
  }

  // ── Characters ──
  function pickCharacter(npc) {
    if (swapBusy || !npc.container || npc.merchant) return;
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
    walk = { to: to.clone(), onArrive };
  }
  function movePlayer(dt) {
    const { model, controls } = ctx.getPlayer();
    if (!model || !controls) return;
    if (walk) {
      const dx = walk.to.x - model.position.x;
      const dz = walk.to.z - model.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 0.08) {
        const done = walk.onArrive;
        walk = null;
        controls.isMoving = false;
        done?.();
      } else {
        const step = Math.min(dist, PLAYER_WALK_SPEED * dt);
        const nx = model.position.x + (dx / dist) * step;
        const nz = model.position.z + (dz / dist) * step;
        model.position.x = nx;
        model.position.z = nz;
        controls.playerX = nx;
        controls.playerZ = nz;
        controls.lastPosition?.set(nx, model.position.y, nz);
        controls.body?.setNextKinematicTranslation?.({ x: nx, y: model.position.y + 0.6, z: nz });
        controls.isMoving = true;
        faceYaw = Math.atan2(dx, dz);
      }
    }
    if (faceYaw !== null) {
      controls.yaw = angleLerp(controls.yaw, faceYaw, 1 - Math.exp(-8 * dt));
      model.rotation.y = controls.yaw;
    }
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
          const step = Math.min(dist, NPC_WALK_SPEED * dt);
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
    for (const h of hits) {
      let o = h.object;
      if (o.isSprite && o.material?.opacity === 0) continue;
      const t = o.userData.villageTarget;
      if (t) return t;
    }
    return null;
  };
  const onPointerDown = (e) => {
    if (!active || leaving || approaching) return;
    down = { x: e.clientX, y: e.clientY, t: performance.now() };
  };
  const onPointerUp = (e) => {
    if (!active || leaving || approaching || !down) return;
    const dx = e.clientX - down.x;
    const dy = e.clientY - down.y;
    const dt = performance.now() - down.t;
    down = null;
    if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.4 && dt < 700) {
      // (shop item close-up: the next item; phones otherwise: the next station)
      if (focus === 'shop' && (selectedItem >= 0 || !compact)) stepItem(dx < 0 ? 1 : -1);
      else if (compact) stepStation(dx < 0 ? 1 : -1);
      return;
    }
    if (Math.hypot(dx, dy) > 12) return;
    const t = pick(e.clientX, e.clientY);
    if (t) onTarget(t);
  };
  const onPointerMove = (e) => {
    if (!active || leaving || approaching || e.pointerType === 'touch') return;
    domElement.style.cursor = pick(e.clientX, e.clientY) ? 'pointer' : '';
  };
  const onKeyDown = (e) => {
    if (!active || leaving || approaching) return;
    if (e.target?.closest?.('input, textarea')) return;
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const dir = e.key === 'ArrowLeft' ? -1 : 1;
    if (focus === 'shop' && (selectedItem >= 0 || !compact)) stepItem(dir);
    else if (compact) stepStation(dir);
    else return;
    e.preventDefault();
  };

  function onTarget(t) {
    if (t.station === 'arrow') { requestStart(); return; }
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
    if (t.station === 'time') {
      if (t.time) {
        ctx.time.set(t.time);
        refreshTime();
      }
      focusStation('time');
      refreshPanel();
      return;
    }
  }

  // ── Stage start ──
  // The arrow: the game first makes the player calibrate the sword (ctx.confirmStart)
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
    el.panel.classList.add('hidden');
    el.card.classList.add('hidden');
    el.back.classList.add('hidden');
    el.navPrev.classList.add('hidden');
    el.navNext.classList.add('hidden');
    ui.querySelector('.village-top')?.classList.add('hidden');
    domElement.style.cursor = '';
    document.body.classList.remove('village-mode'); // fight HUD back
    // The arrow is in the way of the walk: gone at once; the rest once we're past it
    const arrow = stations.arrow;
    if (arrow) [arrow.arrow, arrow.label, arrow.ring].forEach((o) => o.parent?.remove(o));
    leaving = { startedMs: performance.now() };
    const { controls } = ctx.getPlayer();
    if (controls) controls.yaw = Math.atan2(fwd.x, fwd.z);
    showBanner();
    ctx.onStart(pathAngle);
  }

  function showBanner() {
    el.bannerTitle.textContent = stageInfo.stage <= 50 ? `STAGE ${stageInfo.stage}` : 'FINAL STAGE';
    el.bannerSub.textContent = `Defeat ${stageInfo.count} enemies`;
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
    faceYaw = Math.atan2(fwd.x, fwd.z);
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
    el.stage.textContent = info.stage <= 50 ? `Stage ${info.stage}` : 'Final stage';
    if (approaching) {
      refreshNav();
      el.back.classList.add('hidden');
      ui.querySelector('.village-top')?.classList.add('hidden');
      el.panel.classList.add('hidden');
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
    el.back.classList.remove('hidden');
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
    timeSprites = [];
    overviewLabels = [];
    prizeFx = [];
    chestFx = null;
    stations = {};
  }

  function exit() {
    const wasActive = active;
    active = false;
    leaving = null;
    approaching = false;
    starting = false;
    teardown();
    walk = null;
    faceYaw = null;
    focus = null;
    selectedItem = -1;
    domElement.removeEventListener('pointerdown', onPointerDown);
    window.removeEventListener('pointerup', onPointerUp);
    domElement.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('keydown', onKeyDown);
    domElement.style.cursor = '';
    document.body.classList.remove('village-mode');
    ui.classList.add('hidden');
    el.panel.classList.add('hidden');
    el.card.classList.add('hidden');
    refreshNav();
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
    document.body.classList.remove('village-mode');
    el.panel.classList.add('hidden');
    el.card.classList.add('hidden');
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
    y = Math.min(h - 76, Math.max(ch + 70, y)); // (above the ⬅ Village button)
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
      if (far || now - leaving.startedMs > LEAVE_REMOVE_MS) finishLeaving();
      return;
    }

    if (isCompact() !== compact) {
      compact = !compact;
      if (!approaching) { refreshPanel(); refreshBack(); }
    }
    movePlayer(dt);
    updateNpcs(dt);

    overviewLabels.forEach((l) => { l.visible = !focus; });
    // Idle motion: arrow bob, time emojis float, items on the counter
    const arrow = stations.arrow;
    if (arrow) {
      // Bob up and nudge forward, like it's beckoning
      arrow.arrow.position.y = arrow.baseY + Math.sin(t * 2.4) * 0.08;
      const nudge = (Math.sin(t * 3.2) * 0.5 + 0.5) * 0.35;
      arrow.arrow.position.x = arrow.basePos.x + fwd.x * nudge;
      arrow.arrow.position.z = arrow.basePos.z + fwd.z * nudge;
      const s = 1 + Math.sin(t * 3) * 0.06;
      arrow.ring.scale.set(s, s, s);
    }
    timeSprites.forEach((ts, i) => {
      ts.sprite.position.y = ts.base.y + Math.sin(t * 1.8 + i * 1.3) * 0.06;
      const sc = ts.selected ? 0.62 : 0.44;
      ts.sprite.scale.set(sc, sc, 1);
    });
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

    // Camera
    computeWantedCamera();
    if (!camInit) {
      camFov = camera.fov;
      camPos.copy(camera.position);
      camera.getWorldDirection(_v);
      camLook.copy(camera.position).addScaledVector(_v, 6);
      camInit = true;
    }
    const k = 1 - Math.exp(-CAMERA_LERP * dt);
    camPos.lerp(wantPos, k);
    camLook.lerp(wantLook, k);
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

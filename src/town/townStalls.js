// Town mode: the market — the shop (one of the town's houses: walking in through the door puts the
// player inside its room — townRooms.js: shop.glb, under the map) and the wizard's stall out in
// the woods (the Showdown village's market stall), shopped the Showdown village's way — the
// things for sale sit on the counters, tap one (or swipe / ‹ › / arrow keys) for its buy card.
//   • the shop sells everything: the goods (wood / fish / veg + seeds) on the back counter, where
//     the merchant townsperson stands behind it, the gear on the side counters, the mystery chest
//   • the wizard's stall: the magic wand, the potions and the flying broom (the wizard townsperson behind it)
// A button by the shop's back counter (by the stall) frames the camera on it (focus); tapping a
// thing on a counter does too. At a counter, tapping anywhere else, Esc, ⬅ Back or walking off
// goes back. Selling stays in the market panel (townMarketPanel.js).
//
// The counters' things, picking, the buy card and the camera only: the rooms themselves are
// townRooms.js; townTrade.js decides what each thing costs, whether it can be had, and does the
// buying (ctx.getState / ctx.buy).

import * as THREE from 'three';
import {
  makeTextSprite, buildItemMesh, loadTreasureChest, loadWizardStall, CHEST_PRIZE_DELAY_MS,
} from '../village/villageMode.js';
import { createBombMesh, getBombGLTF } from '../characters/BombThrowerEnemy.js';
import { createFishingRodModel } from '../items/fishingRod.js';
import { COUNTERS } from './townRooms.js';

// ── In the room (room-local metres: the middle of the floor at the origin, the doorway at +Z) ──
const BEHIND_Z = -3.95;              // behind the back counter (the shopkeeper)
export const SHOP_SPOTS = {
  merchant: { x: -0.2, z: BEHIND_Z },
  customer: { x: 0, z: -2.2 },
  counter: { x: 0, z: -2.3 },        // in front of the back counter (the buttons / market panel)
};
// The wizard's stall (stall-local metres: its front toward +Z)
export const STALL_SPOTS = {
  merchant: { x: 0, z: -0.8 },
  customer: { x: 0, z: 1.3 },
  counter: { x: 0, z: 1.2 },
};

// On the counters, in swipe order. counter / along (m along it: left / right = room z, back =
// room x) / lift (m above its top); hang: floats over it, turning
const SHOP_ITEMS = [
  { id: 'wood', counter: 'back', along: -1.6, lift: 0, build: 'wood' },
  { id: 'fish', counter: 'back', along: -0.75, lift: 0, build: 'fish' },
  { id: 'crops', counter: 'back', along: 0.1, lift: 0, build: 'veg' },
  { id: 'seeds', counter: 'back', along: 1.0, lift: 0, build: 'seeds' },
  { id: 'sword', counter: 'right', along: 2.5, lift: 0.4, build: 'sword', hang: true },
  { id: 'gun', counter: 'right', along: 1.5, lift: 0.02, build: 'gun' },
  { id: 'shield', counter: 'right', along: 0.5, lift: -0.06, build: 'shield' },
  { id: 'bubble', counter: 'right', along: -0.7, lift: 0.35, build: 'bubble', hang: true },
  { id: 'lockpick', counter: 'left', along: -0.8, lift: 0.01, build: 'lockpick' },
  { id: 'ammo', counter: 'left', along: 0.4, lift: 0.01, build: 'bullets' },
  { id: 'bomb', counter: 'left', along: 1.4, lift: 0.07, build: 'bomb' },
  { id: 'rod', counter: 'left', along: 2.75, lift: 0.02, build: 'rod' },
  { id: 'chest', chest: true },
];
// The wizard's stall: what loadWizardStall puts on its counter
const WIZARD_ITEMS = [{ id: 'life' }, { id: 'mana' }, { id: 'wand' }, { id: 'broom' }];
export const STALL_ITEMS = { shop: SHOP_ITEMS, wizard: WIZARD_ITEMS };
const CHEST_AT = { x: -2.45, z: 3.85, yaw: Math.PI / 2 - 0.25 };

const SHOP_FOV = 55;
const CAMERA_LERP = 4;               // 1/s
const RELEASE_DONE = 0.03;           // m — the camera's back with the player controls
const LEAVE_DIST = 0.6;              // m walked from where the player was when the counter was framed
const COARSE_POINTER = typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches;

const _UP = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _ray = new THREE.Raycaster();
const _ndc = new THREE.Vector2();

// A lock-pick (single use, for locked doors — townHomes.js): a ring handle and a bent pin, flat
const makeLockpickMesh = () => {
  const g = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({ color: 0xb8bcc4, roughness: 0.35, metalness: 0.8 });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.009, 8, 20), steel);
  ring.rotation.x = Math.PI / 2;
  ring.position.set(0, 0.01, -0.09);
  const pin = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.008, 0.16), steel);
  pin.position.set(0, 0.01, 0.025);
  const hook = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.008, 0.012), steel);
  hook.position.set(0.01, 0.01, 0.105);
  g.add(ring, pin, hook);
  g.scale.setScalar(1.6);
  return g;
};

// A sack of seeds: a burlap bag tied at the top, a few seeds spilled by it
const makeSeedsMesh = () => {
  const g = new THREE.Group();
  const sack = new THREE.MeshStandardMaterial({ color: 0xb08a55, roughness: 1, metalness: 0 });
  const seed = new THREE.MeshStandardMaterial({ color: 0x6b4a22, roughness: 1, metalness: 0 });
  const bag = new THREE.Mesh(new THREE.SphereGeometry(0.08, 12, 10), sack);
  bag.scale.set(1, 1.15, 1);
  bag.position.y = 0.09;
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.04, 0.05, 10), sack);
  neck.position.y = 0.19;
  const tie = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.007, 6, 14), new THREE.MeshStandardMaterial({ color: 0x3f6b2a, roughness: 1, metalness: 0 }));
  tie.rotation.x = Math.PI / 2;
  tie.position.y = 0.18;
  g.add(bag, neck, tie);
  for (let k = 0; k < 5; k++) {
    const s = new THREE.Mesh(new THREE.SphereGeometry(0.012, 6, 4), seed);
    s.position.set(0.1 + Math.cos(k * 1.7) * 0.03, 0.01, Math.sin(k * 1.7) * 0.04);
    g.add(s);
  }
  return g;
};

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
};

/**
 * @param {object} ctx
 *  camera, domElement, parent (HUD element for the buy card), rooms (townRooms.js)
 *  getCoins()
 *  getState(stall, id) → { name, desc, owned, price, verb ('Buy' | 'Open'), blocked (why not: shown on the button) }
 *  buy(stall, id) → { ok, emoji? } | null
 *  getPlayerPosition() → Vector3, setPlayerHidden(hidden)
 *  canShop(stall) → false while that shop's shut or something else has the player (a fight, jail…)
 *  canTap(stall) → a tap on that shop's things frames it (the player's in there)
 */
export function createTownStalls(ctx) {
  const { camera, domElement, rooms } = ctx;
  let active = false;
  // key → { key, root, items: [entry], labels, outdoor }
  const stalls = {};
  const clickables = [];
  let focus = null;           // stall key
  let selected = -1;          // index in stalls[focus].items
  let focusFrom = null;       // player position when the counter was framed
  let overriding = false;     // the camera is ours (framed, or easing back)
  const camPos = new THREE.Vector3();
  const camQuat = new THREE.Quaternion();
  let camFov = 60;
  let prizeFx = [];
  let failedUntil = 0;
  let cardAt = 0;

  // Stalls out in the open (the wizard's): where they stand (setOutdoor — the layout, before
  // they're built), key → { x, y, z, yaw }
  const outdoor = {};
  const setOutdoor = (key, at) => { outdoor[key] = { ...at }; };
  const fromStall = (at, p) => ({
    x: at.x + Math.sin(at.yaw) * p.z + Math.cos(at.yaw) * p.x,
    z: at.z + Math.cos(at.yaw) * p.z - Math.sin(at.yaw) * p.x,
  });
  const spot = (key, name) => (outdoor[key] ? fromStall(outdoor[key], STALL_SPOTS[name]) : rooms.toWorld(key, SHOP_SPOTS[name]));
  // Near the back counter (the buttons)
  const atCounter = (key, x, z, dist) => {
    const c = spot(key, 'counter');
    return (outdoor[key] ? !rooms.roomAt(x, z) : rooms.roomAt(x, z) === key) && Math.hypot(x - c.x, z - c.z) < dist;
  };

  // ── Buy card (the village's) ──
  const card = el('div', 'village-card ui-panel town-card hidden');
  const prev = el('button', 'ui-chip village-card-nav', '‹');
  const next = el('button', 'ui-chip village-card-nav', '›');
  const body = el('div', 'village-card-body');
  const cardName = el('div', 'village-card-name');
  const cardDesc = el('div', 'village-card-desc');
  const cardOwned = el('div', 'village-card-owned');
  const buyBtn = el('button', 'ui-btn village-card-buy');
  [prev, next, buyBtn].forEach((b) => { b.type = 'button'; });
  prev.setAttribute('aria-label', 'Previous item');
  next.setAttribute('aria-label', 'Next item');
  body.append(cardName, cardDesc, cardOwned, buyBtn);
  card.append(prev, body, next);
  card.addEventListener('pointerdown', (e) => e.stopPropagation());
  ctx.parent.append(card);
  prev.addEventListener('click', () => step(-1));
  next.addEventListener('click', () => step(1));
  buyBtn.addEventListener('click', () => buySelected());

  // ── Build ──
  const makeClickable = (obj, target) => {
    obj.traverse((o) => { o.userData.townStall = target; });
    clickables.push(obj);
  };
  // A counter thing's place / turn (room-local)
  const placeOnCounter = (object, d) => {
    const c = COUNTERS[d.counter];
    const y = c.top + (d.lift ?? 0);
    if (d.counter === 'back') object.position.set(d.along, y, (c.z0 + c.z1) / 2);
    else object.position.set((c.x0 + c.x1) / 2, y, d.along);
    object.rotation.y = c.yaw;
  };
  const makeItemMesh = (build, bombGltf) => {
    const mesh = build === 'bomb' && bombGltf ? createBombMesh(bombGltf)
      : build === 'rod' ? createFishingRodModel() : build === 'lockpick' ? makeLockpickMesh()
      : build === 'seeds' ? makeSeedsMesh() : buildItemMesh(build);
    if (build === 'bomb') { mesh.scale.multiplyScalar(0.8); mesh.position.y = 0.1; }
    // (the rod lies along the counter, tip toward the back of the shop)
    if (build === 'rod') { mesh.scale.setScalar(0.55); mesh.rotation.set(-0.08, Math.PI / 2, 0); mesh.position.y = 0.02; }
    return mesh;
  };

  // Item centres + a bigger invisible tap target round each small one (once the things are in)
  const finishItems = (stall) => {
    const { root } = stall;
    root.updateMatrixWorld(true);
    const hitMat = new THREE.MeshBasicMaterial({ visible: false });
    stall.items.forEach((entry, i) => {
      const box = new THREE.Box3().setFromObject(entry.object);
      const at = entry.object.getWorldPosition(new THREE.Vector3());
      const c = box.isEmpty() ? at.clone() : box.getCenter(new THREE.Vector3());
      entry.centerOffset = c.clone().sub(at);
      makeClickable(entry.object, { stall: stall.key, item: i });
      if (!entry.def.chest) {
        const size = box.isEmpty() ? 0.12 : box.getSize(new THREE.Vector3()).length() / 2;
        const hit = new THREE.Mesh(new THREE.SphereGeometry(THREE.MathUtils.clamp(size, 0.1, 0.16), 10, 8), hitMat);
        hit.position.copy(root.worldToLocal(c.clone()));
        root.add(hit);
        makeClickable(hit, { stall: stall.key, item: i });
      }
    });
    if (focus === stall.key) refreshCard();
  };

  // def: { key, label } — in that shop's room (townRooms.js build)
  const build = (group, def) => {
    const root = rooms.build(group, def.key);
    const stall = { key: def.key, root, items: [], labels: [] };
    stalls[def.key] = stall;
    const back = COUNTERS.back;
    const sign = makeTextSprite(def.label, { height: 0.3 });
    sign.position.set(0, 2.0, (back.z0 + back.z1) / 2 - 0.3);
    root.add(sign);
    stall.labels.push(sign);
    makeClickable(sign, { stall: def.key, item: -1 });

    const defs = STALL_ITEMS[def.key];
    const needs = [
      defs.some((d) => d.chest) ? loadTreasureChest() : null,
      defs.some((d) => d.build === 'bomb') ? getBombGLTF().catch(() => null) : null,
    ];
    Promise.all(needs).then(([chest, bombGltf]) => {
      stall.items = defs.map((d) => {
        let object;
        if (d.chest) {
          object = chest;
          object.position.set(CHEST_AT.x, 0, CHEST_AT.z);
          object.rotation.y = CHEST_AT.yaw;
          root.add(object);
        } else {
          object = new THREE.Group();
          object.add(makeItemMesh(d.build, bombGltf));
          placeOnCounter(object, d);
          root.add(object);
        }
        object.traverse((m) => { if (m.isMesh) m.castShadow = true; });
        return { def: d, object, baseY: object.position.y, baseRotY: object.rotation.y, hopUntil: 0 };
      });
      finishItems(stall);
      const chestEntry = stall.items.find((e) => e.def.chest);
      if (chestEntry) {
        const label = makeTextSprite('Mystery Chest', { height: 0.22 });
        label.position.copy(chestEntry.object.position).add(_v.set(0, 0.95, 0));
        root.add(label);
        stall.labels.push(label);
        makeClickable(label, { stall: def.key, item: stall.items.indexOf(chestEntry) });
      }
    }).catch((e) => console.warn(`[Town] ${def.key} shop failed to load:`, e));
    return stall;
  };
  // def: { key, label } — a market stall out in the open, where setOutdoor put it (the ground's
  // height there: y)
  const buildOutdoor = (group, def) => {
    const at = outdoor[def.key];
    const root = new THREE.Group();
    root.position.set(at.x, at.y ?? 0, at.z);
    root.rotation.y = at.yaw;
    group.add(root);
    const stall = { key: def.key, root, items: [], labels: [], outdoor: true };
    stalls[def.key] = stall;
    const sign = makeTextSprite(def.label, { height: 0.34 });
    sign.position.set(0, 2.35, 0);
    root.add(sign);
    stall.labels.push(sign);
    makeClickable(sign, { stall: def.key, item: -1 });
    loadWizardStall().then(({ root: model, items }) => {
      root.add(model);
      makeClickable(model, { stall: def.key, item: -1 });
      stall.items = STALL_ITEMS[def.key].map((d) => {
        const object = items[d.id];
        return { def: d, object, baseY: object.position.y, baseRotY: object.rotation.y, hopUntil: 0 };
      });
      finishItems(stall);
    }).catch((e) => console.warn(`[Town] ${def.key} stall failed to load:`, e));
    return stall;
  };

  // ── Selecting / buying ──
  const itemCenter = (entry, out) => entry.object.getWorldPosition(out).add(entry.centerOffset || _v2.set(0, 0, 0));
  const current = () => (focus ? stalls[focus]?.items[selected] ?? null : null);

  function select(i) {
    const items = focus ? stalls[focus].items : [];
    selected = i >= 0 && i < items.length ? i : -1;
    failedUntil = 0;
    refreshCard();
  }
  function step(dir) {
    if (!focus) return;
    const n = stalls[focus].items.length;
    if (!n) return;
    select(selected < 0 ? (dir > 0 ? 0 : n - 1) : (selected + dir + n) % n);
  }
  function refreshCard() {
    const entry = current();
    if (!entry) { card.classList.add('hidden'); return; }
    const s = ctx.getState(focus, entry.def.id);
    cardName.textContent = s.name;
    cardDesc.textContent = s.desc || '';
    cardOwned.textContent = s.owned || '';
    cardOwned.classList.toggle('hidden', !s.owned);
    const coins = ctx.getCoins();
    let label = `${s.verb || 'Buy'} · ${s.price} 🪙`;
    let disabled = false;
    if (s.blocked) { label = s.blocked; disabled = true; }
    else if (coins < s.price) { label = `${s.price} 🪙 — need ${s.price - coins} more`; disabled = true; }
    else if (performance.now() < failedUntil) label = 'Couldn’t buy — try again';
    buyBtn.textContent = label;
    buyBtn.disabled = disabled;
    card.classList.remove('hidden');
  }
  function buySelected() {
    const entry = current();
    if (!entry) return false;
    const result = ctx.buy(focus, entry.def.id);
    if (result?.ok) {
      entry.hopUntil = performance.now() + 500;
      entry.object.userData.lid?.open();
      if (result.emoji) {
        const sprite = makeTextSprite(result.emoji, { height: 0.45, size: 96, bg: null, pad: 10 });
        // (a chest's prize rises out of it once the lid's open; anything else pops up over it)
        const chest = !!entry.def.chest;
        const start = itemCenter(entry, new THREE.Vector3()).add(_v.set(0, chest ? 0 : 0.3, 0));
        sprite.position.copy(start);
        sprite.visible = !chest;
        stalls[focus].root.parent?.add(sprite);
        prizeFx.push({ sprite, start, born: performance.now() + (chest ? CHEST_PRIZE_DELAY_MS : 0) });
      }
    } else {
      failedUntil = performance.now() + 1500;
    }
    refreshCard();
    return !!result?.ok;
  }
  // What the phone's interact / E would buy (null: nothing)
  const buyLabel = () => {
    const entry = current();
    if (!entry) return null;
    const s = ctx.getState(focus, entry.def.id);
    if (s.blocked || ctx.getCoins() < s.price) return null;
    return `${s.verb || 'Buy'} ${s.name} (${s.price})`;
  };

  // ── Focus (the shop camera) ──
  function focusStall(key, item = -1) {
    if (!stalls[key]) return;
    if (!overriding) {
      camPos.copy(camera.position);
      camQuat.copy(camera.quaternion);
      camFov = camera.fov;
      overriding = true;
    }
    focus = key;
    focusFrom = ctx.getPlayerPosition().clone();
    select(item);
    document.body.classList.add('town-shop-open');
  }
  function unfocus() {
    if (!focus) return;
    focus = null;
    selected = -1;
    card.classList.add('hidden');
    document.body.classList.remove('town-shop-open');
  }

  // Camera distance that fits a (halfW × halfH) box at the shop fov / current aspect
  const fitDistance = (halfW, halfH) => {
    const tanV = Math.tan(THREE.MathUtils.degToRad(SHOP_FOV) / 2);
    const tanH = tanV * (camera.aspect || 1);
    return Math.max(halfH / tanV, halfW / tanH) * 1.12;
  };
  const wantPos = new THREE.Vector3();
  const wantLook = new THREE.Vector3();
  const setView = (target, dir, halfW, halfH, minDist, maxDist) => {
    wantLook.copy(target);
    wantPos.copy(target).addScaledVector(_v.copy(dir).normalize(), THREE.MathUtils.clamp(fitDistance(halfW, halfH), minDist, maxDist));
  };
  const wantedView = () => {
    const s = stalls[focus];
    const compact = (camera.aspect || 1) < 1 || COARSE_POINTER;
    const entry = current();
    if (s.outdoor) {
      // (a stall: from its front)
      const yaw = s.root.rotation.y;
      if (entry) {
        const p = itemCenter(entry, new THREE.Vector3());
        p.y += 0.05;
        setView(p, _v2.set(Math.sin(yaw), 0.5, Math.cos(yaw)).clone(), compact ? 0.6 : 0.75, 0.45, compact ? 1.1 : 1.4, 2.4);
      } else {
        const target = _v2.copy(s.root.position).add(_v.set(Math.sin(yaw) * 0.25, 0.95, Math.cos(yaw) * 0.25)).clone();
        setView(target, _v.set(Math.sin(yaw), 0.55, Math.cos(yaw)).clone(), compact ? 1.0 : 1.4, compact ? 0.55 : 0.75, 1.8, 4.5);
      }
      return;
    }
    if (entry) {
      // (from the side of the counter the customers stand on — the chest from the middle of the room)
      const c = COUNTERS[entry.def.counter];
      const p = itemCenter(entry, new THREE.Vector3());
      p.y += 0.05;
      const dir = c ? _v2.set(c.facing[0], 0.45, c.facing[1]) : _v2.set(1, 0.6, -0.4);
      setView(p, dir.clone(), compact ? 0.62 : 0.8, 0.5, compact ? 1.2 : 1.5, 2.6);
    } else {
      // (the back counter, from the middle of the room)
      const back = COUNTERS.back;
      const target = _v2.set(s.root.position.x, s.root.position.y + back.top + 0.25, s.root.position.z + (back.z0 + back.z1) / 2);
      setView(target.clone(), _v.set(0, 0.5, 1).clone(), compact ? 1.4 : 2.3, compact ? 0.6 : 0.9, 2.2, 6.4);
    }
  };

  // After the player controls posed the camera this frame
  function updateCamera(dt) {
    if (!overriding) return;
    const k = 1 - Math.exp(-CAMERA_LERP * dt);
    if (focus) {
      wantedView();
      _m.lookAt(wantPos, wantLook, _UP);
      _q.setFromRotationMatrix(_m);
      camPos.lerp(wantPos, k);
      camQuat.slerp(_q, k);
      camFov += (SHOP_FOV - camFov) * k;
    } else {
      // Easing back to the controls' camera (it's where they put it this frame)
      camPos.lerp(camera.position, k * 1.6);
      camQuat.slerp(camera.quaternion, Math.min(1, k * 1.6));
      camFov += (camera.fov - camFov) * k * 1.6;
      if (camPos.distanceTo(camera.position) < RELEASE_DONE) {
        overriding = false;
        ctx.setPlayerHidden(false);
        return;
      }
    }
    camera.position.copy(camPos);
    camera.quaternion.copy(camQuat);
    camera.fov = camFov;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    // (the counter is framed from where the player stands: out of the way meanwhile)
    ctx.setPlayerHidden(true);
  }

  // Projects the buy card above its item
  function placeCard() {
    const entry = current();
    if (!entry || card.classList.contains('hidden')) return;
    const p = itemCenter(entry, _v).add(_v2.set(0, 0.2, 0)).project(camera);
    const w = window.innerWidth;
    const h = window.innerHeight;
    const cw = card.offsetWidth || 260;
    const ch = card.offsetHeight || 140;
    const x = Math.min(w - cw / 2 - 12, Math.max(cw / 2 + 12, (p.x * 0.5 + 0.5) * w));
    const y = Math.min(h - 16, Math.max(ch + 70, (-p.y * 0.5 + 0.5) * h - 18));
    card.style.left = `${x}px`;
    card.style.top = `${y}px`;
  }

  const update = (dt, t) => {
    if (!active) return;
    const now = performance.now();
    if (focus) {
      const p = ctx.getPlayerPosition();
      if (!ctx.canShop(focus) || Math.hypot(p.x - focusFrom.x, p.z - focusFrom.z) > LEAVE_DIST) unfocus();
    }
    for (const s of Object.values(stalls)) {
      // (labels would fill the close-up)
      for (const label of s.labels) label.visible = focus !== s.key;
      s.items.forEach((entry, i) => {
        const o = entry.object;
        const sel = focus === s.key && i === selected;
        if (entry.def.chest) {
          // The lid opens when bought (and shuts again a little later)
          o.userData.lid?.update(dt);
          return;
        }
        const hop = entry.hopUntil > now ? Math.sin(((entry.hopUntil - now) / 500) * Math.PI) * 0.08 : 0;
        const hang = entry.def.hang ? Math.sin(t * 1.6 + i) * 0.03 : 0;
        o.position.y = entry.baseY + hang + hop + (sel ? 0.04 + Math.sin(t * 3) * 0.02 : 0);
        o.rotation.y = entry.baseRotY + (sel || entry.def.hang ? t * (sel ? 1.4 : 0.5) : 0);
      });
    }
    prizeFx = prizeFx.filter((p) => {
      const age = (now - p.born) / 1800;
      // (a chest's prize waits inside until the lid's open)
      p.sprite.visible = age >= 0;
      if (age < 0) return true;
      if (age >= 1) {
        p.sprite.parent?.remove(p.sprite);
        p.sprite.material.map?.dispose();
        p.sprite.material.dispose();
        return false;
      }
      p.sprite.position.copy(p.start).add(_v.set(0, age * 0.9, 0));
      p.sprite.material.opacity = age < 0.7 ? 1 : 1 - (age - 0.7) / 0.3;
      const sc = 0.45 + age * 0.25;
      p.sprite.scale.set(sc, sc, 1);
      return true;
    });
    rooms.clampCamera();
    updateCamera(dt);
    if (focus && current()) {
      // Coins / stock can change meanwhile: keep the button honest
      if (now - cardAt > 400) { cardAt = now; refreshCard(); }
      placeCard();
    }
  };

  // ── Input (tap / click / swipe on the 3D view) ──
  const pick = (clientX, clientY) => {
    const rect = domElement.getBoundingClientRect();
    _ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    _ray.setFromCamera(_ndc, camera);
    let best = null;
    let bestD = Infinity;
    let any = null;
    for (const h of _ray.intersectObjects(clickables, true)) {
      if (h.distance > 12) break;
      const tg = h.object.userData.townStall;
      if (!tg || (h.object.isSprite && !h.object.visible)) continue;
      any ??= tg;
      const entry = stalls[tg.stall]?.items[tg.item];
      if (!entry) continue;
      // (overlapping tap targets: the item whose centre is nearest the tap wins)
      const d = _ray.ray.distanceSqToPoint(itemCenter(entry, _v));
      if (d < bestD) { bestD = d; best = tg; }
    }
    return best ?? any;
  };
  let down = null;
  const onPointerDown = (e) => {
    if (!active) return;
    down = { x: e.clientX, y: e.clientY, t: performance.now() };
  };
  const onPointerUp = (e) => {
    if (!active || !down) return;
    const dx = e.clientX - down.x;
    const dy = e.clientY - down.y;
    const dt = performance.now() - down.t;
    down = null;
    if (focus && Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.4 && dt < 700) {
      step(dx < 0 ? 1 : -1);
      return;
    }
    if (Math.hypot(dx, dy) > 12) return;
    const tg = pick(e.clientX, e.clientY);
    if (focus) {
      // At a counter: its things are tapped, anywhere else goes back
      if (tg && tg.stall === focus && tg.item >= 0) select(tg.item);
      else unfocus();
      return;
    }
    if (tg && ctx.canTap?.(tg.stall)) focusStall(tg.stall, tg.item);
  };
  const onKeyDown = (e) => {
    if (!active || !focus || e.target?.closest?.('input, textarea')) return;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      step(e.key === 'ArrowLeft' ? -1 : 1);
      e.preventDefault();
    }
  };

  const setActive = (on) => {
    if (on === active) return;
    active = on;
    if (on) {
      domElement.addEventListener('pointerdown', onPointerDown);
      window.addEventListener('pointerup', onPointerUp);
      window.addEventListener('keydown', onKeyDown);
    } else {
      domElement.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('keydown', onKeyDown);
      unfocus();
      if (overriding) { overriding = false; ctx.setPlayerHidden(false); }
      down = null;
    }
  };

  return {
    build,
    buildOutdoor,
    setOutdoor,
    setActive,
    update,
    focus: focusStall,
    unfocus,
    focused: () => focus,
    step,
    buySelected,
    buyLabel,
    refresh: () => { if (focus) refreshCard(); },
    get: (key) => stalls[key] ?? null,
    // While a counter is framed: where the shop camera is and what it looks at (else null)
    view: () => (focus && overriding ? { camera: camPos, stall: wantLook } : null),
    spot, atCounter,
  };
}

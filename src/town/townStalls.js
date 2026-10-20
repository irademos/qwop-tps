// Town mode: the market's two stalls, shopped the Showdown village's way — the things for
// sale sit on the counters, tap one (or swipe / ‹ › / arrow keys) for its buy card.
//   • the goods stall (wood / fish / veg — the merchant townsperson stands behind it)
//   • the weapon stall (the village shop's gear + the mystery chest, a keeper behind it)
// Walking up shows a button that frames the camera on the counter (focus); tapping a thing
// on a counter does too. At a counter, tapping anywhere else, Esc, ⬅ Back or walking off goes
// back. Selling stays in the market panel (townMarketPanel.js).
//
// Visuals, picking, the buy card and the shop camera only: townMode.js decides what each
// thing costs, whether it can be had, and does the buying (ctx.getState / ctx.buy).

import * as THREE from 'three';
import {
  makeTextSprite, buildItemMesh, loadMarketStall, loadStallManaPotion, loadTreasureChest,
  STALL_UNIT, COUNTER_SURFACE_Y,
} from '../village/villageMode.js';
import { createBombMesh, getBombGLTF } from '../characters/BombThrowerEnemy.js';
import { createGLBCharacterInstance, glbCharacterConfig } from '../models/glbCharacterModel.js';

// On the counters, left → right (also the swipe order). Positions in stall units.
const GEAR_ITEMS = [
  { id: 'bomb', at: [-92, COUNTER_SURFACE_Y + 10, 34], build: 'bomb' },
  { id: 'sword', at: [-62, 165, 4], build: 'sword', hang: true },
  { id: 'ammo', at: [-24, COUNTER_SURFACE_Y + 1, 36], build: 'bullets' },
  { id: 'mana', potion: true },
  { id: 'bubble', at: [0, 160, 4], build: 'bubble', hang: true },
  { id: 'gun', at: [34, COUNTER_SURFACE_Y + 3, 32], build: 'gun' },
  { id: 'wand', at: [62, COUNTER_SURFACE_Y + 3, 42], build: 'wand' },
  { id: 'shield', at: [88, COUNTER_SURFACE_Y - 8, 12], build: 'shield' },
  { id: 'chest', chest: true },
];
const GOODS_ITEMS = [
  { id: 'wood', at: [-62, COUNTER_SURFACE_Y, 30], build: 'wood' },
  { id: 'fish', at: [0, COUNTER_SURFACE_Y, 30], build: 'fish' },
  { id: 'crops', at: [62, COUNTER_SURFACE_Y, 30], build: 'veg' },
];
export const STALL_ITEMS = { goods: GOODS_ITEMS, gear: GEAR_ITEMS };

const CHEST_SIDE = 1.45;             // m beside the stall (the chest)
const KEEPER_Z = -0.77;              // m behind the stall's origin (the weapon stall's keeper)
const KEEPER_URL = glbCharacterConfig.wizardUrl;
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

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
};

/**
 * @param {object} ctx
 *  camera, domElement, parent (HUD element for the buy card)
 *  getCoins()
 *  getState(stall, id) → { name, desc, owned, price, verb ('Buy' | 'Open'), blocked (why not: shown on the button) }
 *  buy(stall, id) → { ok, emoji? } | null
 *  getPlayerPosition() → Vector3, setPlayerHidden(hidden)
 *  canShop(stall) → false while that stall's shut or something else has the player (a fight, jail…)
 *  canTap(stall) → a tap on that stall's things frames it (the player's at it)
 */
export function createTownStalls(ctx) {
  const { camera, domElement } = ctx;
  let active = false;
  const stalls = {};          // key → { key, root, facing, side, items: [entry], chestSign, label }
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

  // def: { key, x, y, z, yaw, chestSign (gear: which side the chest goes), label, groundAt(x, z) }
  const build = (group, def) => {
    const root = new THREE.Group();
    root.position.set(def.x, def.y, def.z);
    root.rotation.y = def.yaw;
    group.add(root);
    const facing = new THREE.Vector3(Math.sin(def.yaw), 0, Math.cos(def.yaw));
    const side = new THREE.Vector3().crossVectors(_UP, facing).normalize(); // customer's right
    const stall = { key: def.key, root, facing, side, chestSign: def.chestSign ?? 1, items: [], keeper: null, labels: [] };
    stalls[def.key] = stall;
    const sign = makeTextSprite(def.label, { height: 0.3 });
    sign.position.set(0, 2.2, 0);
    root.add(sign);
    stall.labels.push(sign);
    makeClickable(sign, { stall: def.key, item: -1 });

    const defs = STALL_ITEMS[def.key];
    const needs = [
      loadMarketStall(),
      defs.some((d) => d.potion) ? loadStallManaPotion() : null,
      defs.some((d) => d.chest) ? loadTreasureChest() : null,
      defs.some((d) => d.build === 'bomb') ? getBombGLTF().catch(() => null) : null,
    ];
    Promise.all(needs).then(([model, potion, chest, bombGltf]) => {
      root.add(model);
      makeClickable(model, { stall: def.key, item: -1 });
      stall.items = defs.map((d) => {
        let object;
        if (d.potion) {
          object = potion;
          model.add(object); // (stall units, like the village's)
        } else if (d.chest) {
          object = chest;
          const wx = def.x + side.x * stall.chestSign * CHEST_SIDE + facing.x * 0.35;
          const wz = def.z + side.z * stall.chestSign * CHEST_SIDE + facing.z * 0.35;
          object.position.set(stall.chestSign * CHEST_SIDE, def.groundAt(wx, wz) - def.y, 0.35);
          object.rotation.y = -0.25 * stall.chestSign;
          root.add(object);
        } else {
          const mesh = d.build === 'bomb' && bombGltf ? createBombMesh(bombGltf) : buildItemMesh(d.build);
          if (d.build === 'bomb') { mesh.scale.multiplyScalar(0.8); mesh.position.y = 0.1; }
          object = new THREE.Group();
          object.add(mesh);
          object.position.set(d.at[0], d.at[1], d.at[2]).multiplyScalar(STALL_UNIT);
          root.add(object);
        }
        object.traverse((o) => { if (o.isMesh) o.castShadow = true; });
        return { def: d, object, baseY: object.position.y, baseRotY: object.rotation.y, hopUntil: 0 };
      });
      // Item centres + a bigger invisible tap target round each small one
      root.updateMatrixWorld(true);
      const hitMat = new THREE.MeshBasicMaterial({ visible: false });
      stall.items.forEach((entry, i) => {
        const box = new THREE.Box3().setFromObject(entry.object);
        const origin = entry.object.getWorldPosition(new THREE.Vector3());
        const c = box.isEmpty() ? origin.clone() : box.getCenter(new THREE.Vector3());
        entry.centerOffset = c.clone().sub(origin);
        makeClickable(entry.object, { stall: def.key, item: i });
        if (!entry.def.chest) {
          const size = box.isEmpty() ? 0.12 : box.getSize(new THREE.Vector3()).length() / 2;
          const hit = new THREE.Mesh(new THREE.SphereGeometry(THREE.MathUtils.clamp(size, 0.1, 0.14), 10, 8), hitMat);
          hit.position.copy(root.worldToLocal(c.clone()));
          root.add(hit);
          makeClickable(hit, { stall: def.key, item: i });
        }
      });
      const chestEntry = stall.items.find((e) => e.def.chest);
      if (chestEntry) {
        const label = makeTextSprite('🎁 Mystery Chest', { height: 0.22 });
        label.position.copy(chestEntry.object.position).add(_v.set(0, 0.95, 0));
        root.add(label);
        stall.labels.push(label);
        makeClickable(label, { stall: def.key, item: stall.items.indexOf(chestEntry) });
      }
      if (focus === def.key) refreshCard();
    }).catch((e) => console.warn(`[Town] ${def.key} stall failed to load:`, e));

    if (def.keeper) {
      // (a shopkeeper, not one of the townsfolk: just stands there in the market's hours)
      createGLBCharacterInstance({ targetHeight: 1.0, url: KEEPER_URL, armIK: false }).then(({ container, character }) => {
        container.position.set(0, 0, KEEPER_Z);
        character.setMoving(false);
        root.add(container);
        stall.keeper = { container, character };
        makeClickable(container, { stall: def.key, item: -1 });
      }).catch((e) => console.warn('[Town] keeper failed to load:', e));
    }
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
      if (result.emoji) {
        const sprite = makeTextSprite(result.emoji, { height: 0.45, size: 96, bg: null, pad: 10 });
        const start = itemCenter(entry, new THREE.Vector3()).add(_v.set(0, 0.3, 0));
        sprite.position.copy(start);
        stalls[focus].root.parent?.add(sprite);
        prizeFx.push({ sprite, start, born: performance.now() });
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
    return `🪙 ${s.verb || 'Buy'} ${s.name} (${s.price})`;
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
  const setView = (target, dir, halfW, halfH, minDist) => {
    wantLook.copy(target);
    wantPos.copy(target).addScaledVector(_v.copy(dir).normalize(), Math.max(minDist, fitDistance(halfW, halfH)));
  };
  const wantedView = () => {
    const s = stalls[focus];
    const compact = (camera.aspect || 1) < 1 || COARSE_POINTER;
    const entry = current();
    if (entry) {
      const p = itemCenter(entry, new THREE.Vector3());
      p.y += 0.05;
      setView(p, _v2.copy(s.facing).addScaledVector(_UP, 0.45).clone(), compact ? 0.62 : 0.8, 0.5, compact ? 1.2 : 1.5);
    } else {
      const hasChest = s.items.some((e) => e.def.chest);
      const target = _v2.copy(s.root.position).add(_v.set(0, 0.85, 0));
      if (hasChest && !compact) target.addScaledVector(s.side, s.chestSign * 0.55);
      setView(target.clone(), _v.copy(s.facing).addScaledVector(_UP, 0.32).clone(),
        compact ? 0.72 : hasChest ? 2.1 : 1.1, compact ? 0.5 : 1.0, compact ? 1.2 : 1.8);
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
      s.keeper?.character.animate(dt);
      s.items.forEach((entry, i) => {
        const o = entry.object;
        const sel = focus === s.key && i === selected;
        if (entry.def.chest) {
          const fx = entry.hopUntil > now ? 1 - (entry.hopUntil - now) / 500 : 1;
          o.position.y = entry.baseY + (fx < 1 ? Math.sin(fx * Math.PI) * 0.18 : 0);
          o.rotation.z = fx < 1 ? Math.sin(fx * Math.PI * 4) * 0.06 : 0;
          return;
        }
        const hop = entry.hopUntil > now ? Math.sin(((entry.hopUntil - now) / 500) * Math.PI) * 0.08 : 0;
        // (the potion is a child of the scaled stall model: stall units)
        const unit = entry.def.potion ? 1 / STALL_UNIT : 1;
        const hang = entry.def.hang ? Math.sin(t * 1.6 + i) * 0.03 : 0;
        o.position.y = entry.baseY + (hang + hop + (sel ? 0.04 + Math.sin(t * 3) * 0.02 : 0)) * unit;
        o.rotation.y = entry.baseRotY + (sel || entry.def.hang ? t * (sel ? 1.4 : 0.5) : 0);
      });
    }
    prizeFx = prizeFx.filter((p) => {
      const age = (now - p.born) / 1800;
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
    setActive,
    update,
    focus: focusStall,
    unfocus,
    focused: () => focus,
    step,
    buySelected,
    buyLabel,
    refresh: () => { if (focus) refreshCard(); },
    setKeeperVisible: (key, visible) => { if (stalls[key]?.keeper) stalls[key].keeper.container.visible = visible; },
    get: (key) => stalls[key] ?? null,
    // While a counter is framed: where the shop camera is and the stall it looks at (else null)
    view: () => (focus && overriding ? { camera: camPos, stall: stalls[focus].root.position } : null),
  };
}

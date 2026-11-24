// Town: farming. The farmers' fields (townLayout.js — rows of crops in planter boxes) can be
// bought — walk up to one and Buy this field (FIELD_PRICE, paid to the farmer who works it; no
// talking needed): its crops are the player's to pick from then on (no theft), and the farmer
// stops working it. Cheaper: a plot of land by the fields (`places.plots`, a signpost on each —
// Buy this land, PLOT_PRICE), on which the player builds up to PLOT_PLANTERS planter boxes
// (planter_box.glb — Build a planter box, PLANTER_WOOD wood each from the bag). Seeds come from
// the farmers (SHOP_GEAR 'seeds', SELLER_GEAR → T.seeds) and are planted only in the player's own
// planter boxes (Plant a seed — PLANTER_SLOTS spots in each, a little dirt pile on its soil); each
// grows one veg in a town day (VEG_DRY_S), or in VEG_WET_S while its soil is wet, then Pick your
// veg. The water: a hose's tap stands by each field / plot, shown only by land the player owns
// (a grabbable — townGrab.js: Grab the hose with empty hands / Drop it; the player can't walk
// further than HOSE_LENGTH from that tap meanwhile), held in the right hand and aimed with the
// gyro like the sword (no gyro: where the player faces); Water — the Block bar's place on the
// game's screen and the phone (bootstrapGameApp.js: isHoseHeld / setWatering) — or holding F
// sprays it, and the dirt piles the water lands on soak (WATER_SOAK_S of spray) and stay wet
// SOIL_DRY_S. The built planter boxes and the fields' boxes are solid (T.planterObstacles → T.refreshObstacles).
//
// Who owns which field / plot (and how many boxes a plot has) is the town's (T.fieldOwners: field
// index → { k: member key, n: name }; T.plotOwners: plot index → { k, n, b: boxes built }; a
// shared town's host keeps them — 'buyField' / 'fields', 'buyPlot' / 'buildPlanter' / 'plots'
// ops); what's planted is the player's own (T.veg, saved with their own things — others don't
// see it).

import * as THREE from 'three';
import { makeTextSprite } from '../village/villageMode.js';
import { firstName } from './townPeople.js';
import { createVeg, VEG_KINDS } from '../items/vegModels.js';
import { createPlanterBox, planterSoilY } from '../items/planterBox.js';
import {
  FIELD_ACT_DIST, FIELD_PRICE, HOSE_GRAB_DIST, HOSE_LENGTH, HOSE_SPEED, HOSE_SPLASH_R, PLANTER_SLOTS, PLANTER_WOOD,
  PLANT_DIST, PLOT_ACT_DIST, PLOT_PLANTERS, PLOT_PRICE, SEEDS_MAX, SOIL_DRY_S,
  VEG_DRY_S, VEG_MAX, VEG_PICK_DIST, VEG_WET_S, WATER_SOAK_S, dist2,
} from './townConfig.js';

const GRAVITY = 9.8;
const DROPS = 90;                   // water drops in the air at once…
const DROP_RATE = 45;               // …sprayed per second
const DROP_SPREAD = 0.06;           // rad of wobble
const DRY_COLOR = new THREE.Color(0x8a6a45);
const WET_COLOR = new THREE.Color(0x43301d);
const GYRO_MAX_AGE_MS = 500;        // (as playerModel.js: older, the gyro's not live)
const HOSE_REEL_UP = 0.55;          // m — the hose leaves the tap this high
// A plot's planter boxes (plot-local, axis-aligned — long along X): their middles' z, size, and
// the seed spots along each
const PLOT_BOX_Z = [-1.5, 0, 1.5];
const PLOT_BOX_LEN = 2.2;
const PLOT_BOX_W = 0.62;
const PLOT_BOX_H = 0.42;
const PLOT_SLOT_X = [-0.7, 0, 0.7];
const PLOT_SIGN = { x: -1.9, z: 1.9 };  // the signpost, from the plot's middle
const PLOT_STAKES = [[-1.5, -2.2], [1.5, -2.2], [-1.5, 2.2], [1.5, 2.2]];

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _s = new THREE.Vector3(1, 1, 1);
const _FWD = new THREE.Vector3(0, 0, 1);

// T: the town's shared state + functions (createTownMode in townMode.js); ctx: the game
export function installTownFarming(T, ctx) {
  T.fieldOwners = {};
  T.plotOwners = {};          // plot index → { k, n, b: planter boxes built }
  T.veg = [];                 // the player's planted seeds: [{ x, z, p, b, s (plot, box, spot), g: 0..1 (1 ripe), w: s of wet soil left }]
  T.seeds = 0;
  T.hose = null;              // { tap, watering, dropAt } while the player holds it
  let farm = null;            // the meshes (buildFarm)
  let keyDown = false;

  const fields = () => T.layout?.places.fields ?? [];
  const plots = () => T.layout?.places.plots ?? [];
  const myKey = () => (T.mp() ? ctx.memberKey() : 'me');
  const ownsField = (i) => T.fieldOwners[i]?.k === myKey();
  const ownsPlot = (i) => T.plotOwners[i]?.k === myKey();
  const myFields = () => Object.keys(T.fieldOwners).map(Number).filter(ownsField);
  const myPlots = () => Object.keys(T.plotOwners).map(Number).filter(ownsPlot);
  const builtOn = (i) => Math.max(0, Math.min(PLOT_PLANTERS, Math.floor(T.plotOwners[i]?.b || 0)));
  // A plot's planter box b: its middle (world) and the soil's height
  const boxSpot = (i, b) => {
    const p = plots()[i];
    if (!p) return null;
    const x = p.x;
    const z = p.z + PLOT_BOX_Z[b];
    const gy = T.groundAt(x, z);
    return { x, z, gy, soil: gy + planterSoilY(PLOT_BOX_H) };
  };
  const slotSpot = (i, b, k) => {
    const o = boxSpot(i, b);
    return o && { x: o.x + PLOT_SLOT_X[k], z: o.z, y: o.soil };
  };
  // Every built planter box (anyone's — they're seen by all): { i, b, x, z, gy, soil }
  const builtBoxes = () => {
    const out = [];
    plots().forEach((p, i) => { for (let b = 0; b < builtOn(i); b++) out.push({ i, b, ...boxSpot(i, b) }); });
    return out;
  };
  // The taps by land the player owns (the hose is at one of them)
  const myTaps = () => [
    ...fields().filter((f, i) => ownsField(i) && f.tap).map((f) => f.tap),
    ...plots().filter((p, i) => ownsPlot(i) && p.tap).map((p) => p.tap),
  ];
  const nearestTap = () => {
    const p = T.playerPos();
    let best = null;
    let bd = Infinity;
    for (const t of myTaps()) {
      const d = dist2(p.x, p.z, t.x, t.z);
      if (d < bd) { bd = d; best = t; }
    }
    return best;
  };
  const tapSpot = () => T.hose?.tap ?? null;
  // Whose a field is: 'mine', 'theirs' (another player's) or null (a farmer's)
  const fieldOwner = (f) => {
    const o = T.fieldOwners[fields().indexOf(f)];
    return !o ? null : o.k === myKey() ? 'mine' : 'theirs';
  };

  // ── Props: the taps (+ the hose, its nozzle, the water), the fields' signs, the plots'
  // signposts / stakes / planter boxes, the dirt piles ──
  const mat = (color) => new THREE.MeshStandardMaterial({ color, roughness: 1, metalness: 0 });
  const makeTap = (group, tap, metal, hoseMat, wood) => {
    const root = new THREE.Group();
    root.position.set(tap.x, T.groundAt(tap.x, tap.z), tap.z);
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.9, 0.14), wood);
    post.position.y = 0.45;
    const spout = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.18, 8), metal);
    spout.rotation.x = Math.PI / 2;
    spout.position.set(0, 0.82, 0.12);
    const reel = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.05, 8, 18), hoseMat);
    reel.position.set(0, HOSE_REEL_UP, 0.12);
    root.add(post, spout, reel);
    root.traverse((m) => { if (m.isMesh) m.castShadow = true; });
    const sign = makeTextSprite('Hose', { height: 0.24 });
    sign.position.set(0, 1.25, 0);
    root.add(sign);
    root.visible = false;
    group.add(root);
    tap.top = root.position.clone().add(new THREE.Vector3(0, HOSE_REEL_UP, 0.12));
    return root;
  };
  const buildFarm = (group, places) => {
    const metal = new THREE.MeshStandardMaterial({ color: 0x8a9096, roughness: 0.4, metalness: 0.7 });
    const hoseMat = mat(0x3f8a3a);
    const wood = mat(0x6b4a2b);
    farm = {
      group, fieldSigns: places.fields.map(() => ({ sign: null, text: '' })), live: [], piles: new Map(),
      pileGeo: new THREE.SphereGeometry(0.2, 10, 6).scale(1, 0.4, 1),
      stemGeo: new THREE.ConeGeometry(0.09, 0.4, 5).translate(0, 0.2, 0),
      stemMat: mat(0x5f9e3a),
      taps: [], plots: [], boxSig: '',
    };
    // A tap by every field and plot (shown once it's the player's)
    places.fields.forEach((f, i) => { if (f.tap) farm.taps.push({ tap: f.tap, root: makeTap(group, f.tap, metal, hoseMat, wood), owned: () => ownsField(i) }); });
    (places.plots ?? []).forEach((p, i) => {
      if (p.tap) farm.taps.push({ tap: p.tap, root: makeTap(group, p.tap, metal, hoseMat, wood), owned: () => ownsPlot(i) });
      // Its signpost and corner stakes
      const sx = p.x + PLOT_SIGN.x;
      const sz = p.z + PLOT_SIGN.z;
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.4, 0.1), wood);
      post.position.set(sx, T.groundAt(sx, sz) + 0.7, sz);
      post.castShadow = true;
      const board = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.36, 0.05), wood);
      board.position.set(sx, T.groundAt(sx, sz) + 1.2, sz + 0.06);
      board.castShadow = true;
      group.add(post, board);
      for (const [dx, dz] of PLOT_STAKES) {
        const stake = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.45, 0.07), wood);
        stake.position.set(p.x + dx, T.groundAt(p.x + dx, p.z + dz) + 0.2, p.z + dz);
        group.add(stake);
      }
      farm.plots.push({ sign: null, text: '', at: { x: sx, z: sz }, boxes: [] });
    });
    // The hose out to the player's hand (rebuilt each frame while held), its nozzle, the water
    farm.hose = new THREE.Mesh(new THREE.BufferGeometry(), hoseMat);
    farm.hose.visible = false;
    farm.hose.castShadow = true;
    farm.nozzle = new THREE.Group();
    farm.nozzle.add(
      new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.04, 0.2, 10).rotateX(Math.PI / 2).translate(0, 0, 0.05), metal),
      new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.12, 8).translate(0, -0.05, -0.02), hoseMat),
    );
    farm.nozzle.visible = false;
    farm.drops = new THREE.InstancedMesh(new THREE.SphereGeometry(0.035, 6, 4),
      new THREE.MeshBasicMaterial({ color: 0x9fd4ff, transparent: true, opacity: 0.75, depthWrite: false }), DROPS);
    farm.drops.count = 0;
    farm.drops.frustumCulled = false;
    group.add(farm.hose, farm.nozzle, farm.drops);
    renderSigns();
  };

  // Over each field: for sale, someone's, yours; each plot's signpost and planter boxes; the
  // taps by the player's own land
  const setSign = (o, text, x, y, z, height) => {
    if (text === o.text) return;
    o.text = text;
    if (o.sign) { o.sign.parent?.remove(o.sign); o.sign.material.map?.dispose(); o.sign.material.dispose(); }
    o.sign = makeTextSprite(text, { height });
    o.sign.position.set(x, y, z);
    farm.group.add(o.sign);
  };
  const renderSigns = () => {
    if (!farm) return;
    fields().forEach((f, i) => {
      const fs = farm.fieldSigns[i];
      if (!fs) return;
      const o = T.fieldOwners[i];
      const text = !o ? `Field for sale · ${FIELD_PRICE} 🪙` : ownsField(i) ? 'Your field' : `${o.n || 'Someone'}'s field`;
      setSign(fs, text, f.x, T.groundAt(f.x, f.z) + 1.6, f.z, 0.22);
    });
    plots().forEach((p, i) => {
      const ps = farm.plots[i];
      if (!ps) return;
      const o = T.plotOwners[i];
      const text = !o ? `Land for sale · ${PLOT_PRICE} 🪙` : ownsPlot(i) ? 'Your land' : `${o.n || 'Someone'}'s land`;
      setSign(ps, text, ps.at.x, T.groundAt(ps.at.x, ps.at.z) + 1.75, ps.at.z, 0.2);
      const n = o ? builtOn(i) : 0;
      while (ps.boxes.length < n) {
        const b = ps.boxes.length;
        const at = boxSpot(i, b);
        const box = createPlanterBox({ length: PLOT_BOX_LEN, width: PLOT_BOX_W, height: PLOT_BOX_H });
        box.position.set(at.x, at.gy, at.z);
        farm.group.add(box);
        ps.boxes.push(box);
      }
      while (ps.boxes.length > n) ps.boxes.pop().removeFromParent();
    });
    for (const t of farm.taps) t.root.visible = t.owned();
    // (the built boxes are solid: re-sent only when they change)
    const sig = builtBoxes().map((o) => `${o.i}.${o.b}`).join(',');
    if (sig !== farm.boxSig) { farm.boxSig = sig; T.refreshObstacles?.(); }
  };
  // (+ the farmers' fields: each one block over its three rows of boxes — townLayout.js f.solid)
  const planterObstacles = () => (farm ? [
    ...builtBoxes().map((o) => ({
      box: true, owner: 'planter', x: o.x, z: o.z, hx: PLOT_BOX_LEN / 2, hz: PLOT_BOX_W / 2, yaw: 0,
      y0: o.gy - 1, y1: o.gy + PLOT_BOX_H,
    })),
    ...fields().filter((f) => f.solid && Number.isFinite(f.solid.top)).map((f) => ({
      box: true, owner: 'field', x: f.x, z: f.z, hx: f.solid.hx, hz: f.solid.hz, yaw: 0,
      y0: f.solid.top - f.solid.h - 1, y1: f.solid.top,
    })),
  ] : []);

  // ── Buying a field (at the field: paid to the farmer who works it) ──
  const fieldNear = () => {
    if (T.inRoom) return -1;
    const p = T.playerPos();
    let best = -1;
    let bd = FIELD_ACT_DIST;
    fields().forEach((f, i) => {
      const d = dist2(p.x, p.z, f.x, f.z);
      if (d < bd) { bd = d; best = i; }
    });
    return best;
  };
  const buyField = (i) => {
    const f = fields()[i];
    if (!f || T.fieldOwners[i]) return;
    if (ctx.getCoins() < FIELD_PRICE) { T.feedLine(`This field costs ${FIELD_PRICE} coins.`); return; }
    const farmer = T.npcs.find((n) => n.alive && n.role === 'farmer' && n.work === f) ?? null;
    ctx.addCoins(-FIELD_PRICE);
    if (farmer) T.npcMoney(farmer, FIELD_PRICE);
    T.fieldOwners[i] = { k: myKey(), n: ctx.getPlayerName() };
    if (T.netMode === 'client') T.net.send(T.net.hostId(), { w: 1, op: 'buyField', i, k: myKey(), n: ctx.getPlayerName() });
    else if (T.netMode === 'host') T.net.broadcast({ w: 1, op: 'fields', f: T.fieldOwners });
    // (its farmer goes and farms another, if there's one left)
    T.assignWork();
    if (farmer) {
      if (farmer.task?.type === 'work') T.decide(farmer);
      T.say(farmer, 'It\'s yours now — look after it!', { big: true });
      T.remember(farmer, 'customer');
    }
    T.feedLine(`You bought ${farmer ? `${firstName(farmer.name)}'s` : 'the'} field. Its veg is yours to pick.`);
    renderSigns();
    T.save();
  };
  const fieldActs = () => {
    const i = fieldNear();
    if (i < 0 || T.fieldOwners[i]) return [];
    return [{ key: `field:${i}`, label: `Buy this field (${FIELD_PRICE} 🪙)`, onClick: () => buyField(i) }];
  };
  // ── A plot of land (at its signpost / in it): bought, then planter boxes built on it ──
  const plotNear = () => {
    if (T.inRoom) return -1;
    const p = T.playerPos();
    let best = -1;
    let bd = Infinity;
    plots().forEach((pl, i) => {
      const d = Math.min(dist2(p.x, p.z, pl.x, pl.z), dist2(p.x, p.z, pl.x + PLOT_SIGN.x, pl.z + PLOT_SIGN.z));
      if (d < PLOT_ACT_DIST && d < bd) { bd = d; best = i; }
    });
    return best;
  };
  const sendPlots = () => { if (T.netMode === 'host') T.net.broadcast({ w: 1, op: 'plots', p: T.plotOwners }); };
  const buyPlot = (i) => {
    if (!plots()[i] || T.plotOwners[i]) return;
    if (ctx.getCoins() < PLOT_PRICE) { T.feedLine(`This land costs ${PLOT_PRICE} coins.`); return; }
    ctx.addCoins(-PLOT_PRICE);
    T.plotOwners[i] = { k: myKey(), n: ctx.getPlayerName(), b: 0 };
    if (T.netMode === 'client') T.net.send(T.net.hostId(), { w: 1, op: 'buyPlot', i, k: myKey(), n: ctx.getPlayerName() });
    else sendPlots();
    T.feedLine(`You bought this land. Bring ${PLANTER_WOOD} wood to build a planter box on it (up to ${PLOT_PLANTERS}).`);
    ctx.playSfx?.('buy');
    renderSigns();
    T.save();
  };
  const buildPlanter = (i) => {
    if (!ownsPlot(i)) return;
    const b = builtOn(i);
    if (b >= PLOT_PLANTERS) return;
    if ((T.goods.wood || 0) < PLANTER_WOOD) {
      T.feedLine(`A planter box takes ${PLANTER_WOOD} wood — you have ${T.goods.wood || 0}. Chop a tree and split its logs.`);
      return;
    }
    T.goods.wood -= PLANTER_WOOD;
    T.renderGoods();
    T.plotOwners[i].b = b + 1;
    if (T.netMode === 'client') T.net.send(T.net.hostId(), { w: 1, op: 'buildPlanter', i, k: myKey(), b: b + 1 });
    else sendPlots();
    ctx.playSfx?.('wood');
    T.feedLine(b + 1 === 1
      ? 'Built a planter box. Plant seeds in it — the farmers sell them.'
      : `Built a planter box (${b + 1}/${PLOT_PLANTERS}).`);
    renderSigns();
    T.save();
  };
  const plotActs = () => {
    const i = plotNear();
    if (i < 0) return [];
    if (!T.plotOwners[i]) return [{ key: `plot:${i}`, label: `Buy this land (${PLOT_PRICE} 🪙)`, onClick: () => buyPlot(i) }];
    if (ownsPlot(i) && builtOn(i) < PLOT_PLANTERS) {
      return [{ key: `planter:${i}`, label: `Build a planter box (${PLANTER_WOOD} 🪵)`, onClick: () => buildPlanter(i) }];
    }
    return [];
  };
  const cleanPlots = (p) => {
    const out = {};
    if (!p || typeof p !== 'object') return out;
    for (const [i, v] of Object.entries(p)) {
      const idx = Number(i);
      if (Number.isInteger(idx) && idx >= 0 && idx < plots().length && typeof v?.k === 'string') {
        out[idx] = { k: v.k, n: typeof v.n === 'string' ? v.n.slice(0, 40) : '', b: Math.max(0, Math.min(PLOT_PLANTERS, Math.floor(Number(v.b) || 0))) };
      }
    }
    return out;
  };

  // Shared town: the host keeps who owns which
  const handleFarmNet = (from, d) => {
    if (d.op === 'fields') {
      if (T.netMode === 'client' && from === T.net.hostId()) { T.fieldOwners = cleanOwners(d.f); T.assignWork(); renderSigns(); }
      return true;
    }
    if (d.op === 'plots') {
      if (T.netMode === 'client' && from === T.net.hostId()) { T.plotOwners = cleanPlots(d.p); renderSigns(); }
      return true;
    }
    if (d.op === 'buyPlot' || d.op === 'buildPlanter') {
      if (T.netMode !== 'host' || !T.ready) return true;
      const i = Number(d.i);
      if (Number.isInteger(i) && i >= 0 && i < plots().length && typeof d.k === 'string') {
        const o = T.plotOwners[i];
        if (d.op === 'buyPlot' && !o) T.plotOwners[i] = { k: d.k, n: typeof d.n === 'string' ? d.n.slice(0, 40) : '', b: 0 };
        else if (d.op === 'buildPlanter' && o?.k === d.k) o.b = Math.max(o.b, Math.min(PLOT_PLANTERS, Math.floor(Number(d.b) || 0)));
        renderSigns();
      }
      sendPlots();
      return true;
    }
    if (d.op !== 'buyField') return false;
    if (T.netMode !== 'host' || !T.ready) return true;
    const i = Number(d.i);
    if (Number.isInteger(i) && i >= 0 && i < fields().length && !T.fieldOwners[i] && typeof d.k === 'string') {
      T.fieldOwners[i] = { k: d.k, n: typeof d.n === 'string' ? d.n.slice(0, 40) : '' };
      T.assignWork();
      renderSigns();
    }
    T.net.broadcast({ w: 1, op: 'fields', f: T.fieldOwners });
    return true;
  };
  const cleanOwners = (p) => {
    const out = {};
    if (!p || typeof p !== 'object') return out;
    for (const [i, v] of Object.entries(p)) {
      const idx = Number(i);
      if (Number.isInteger(idx) && idx >= 0 && idx < fields().length && typeof v?.k === 'string') out[idx] = { k: v.k, n: typeof v.n === 'string' ? v.n.slice(0, 40) : '' };
    }
    return out;
  };

  // ── Planting (only in the player's own planter boxes) / picking ──
  // Where a seed would go: the free spot in one of the player's planter boxes nearest them
  // (null: none in reach)
  const plantSpot = () => {
    if (T.inRoom || T.jail || T.seeds <= 0 || T.veg.length >= VEG_MAX) return null;
    const p = T.playerPos();
    let best = null;
    let bd = PLANT_DIST;
    for (const i of myPlots()) {
      for (let b = 0; b < builtOn(i); b++) {
        for (let k = 0; k < PLANTER_SLOTS; k++) {
          if (T.veg.some((v) => v.p === i && v.b === b && v.s === k)) continue;
          const at = slotSpot(i, b, k);
          const d = at ? dist2(p.x, p.z, at.x, at.z) : Infinity;
          if (d < bd) { bd = d; best = { p: i, b, s: k, x: at.x, z: at.z }; }
        }
      }
    }
    return best;
  };
  // (why not: the town book's Plant button)
  const plantHint = () => {
    if (T.seeds <= 0) return 'No seeds — the farmers sell them.';
    if (!myPlots().length) return `Buy some land by the fields (${PLOT_PRICE} coins at its signpost) and build a planter box on it.`;
    if (!myPlots().some((i) => builtOn(i) > 0)) return `Build a planter box on your land (${PLANTER_WOOD} wood).`;
    return 'Stand by one of your planter boxes with a free spot to plant.';
  };
  const plant = () => {
    const at = plantSpot();
    if (!at) { T.feedLine(plantHint()); return; }
    T.seeds -= 1;
    T.veg.push({ x: at.x, z: at.z, p: at.p, b: at.b, s: at.s, g: 0, w: 0 });
    T.feedLine(T.veg.length === 1
      ? 'Planted a seed. It\'ll grow a veg by tomorrow — or water it with the hose and it\'s ready in no time.'
      : `Planted a seed (${T.seeds} left).`);
  };
  const ripeVegNear = () => {
    const p = T.playerPos();
    return T.veg.find((v) => v.g >= 1 && dist2(v.x, v.z, p.x, p.z) < VEG_PICK_DIST) ?? null;
  };
  const pickVeg = () => {
    const v = ripeVegNear();
    if (!v) return;
    if (T.bagRoom() <= 0) { T.bagFullNote(); return; }
    T.gain('crops');
    T.veg = T.veg.filter((o) => o !== v);
    T.feedLine(`+1 Veg you grew (${T.goods.crops})`);
  };
  const farmActs = () => {
    const out = [];
    if (T.hose?.watering) return out;
    if (ripeVegNear()) out.push({ key: 'pickVeg', label: 'Pick your veg', onClick: pickVeg });
    out.push(...fieldActs(), ...plotActs());
    if (plantSpot()) out.push({ key: 'plant', label: `Plant a seed (${T.seeds})`, onClick: plant });
    return out;
  };

  // ── The hose ──
  const hoseConstraint = (controls) => {
    const A = tapSpot();
    if (!A) return;
    const dx = controls.playerX - A.x;
    const dz = controls.playerZ - A.z;
    const d = Math.hypot(dx, dz);
    // (a teleport — knocked out, the game's own — isn't pulled back: the hose is dropped)
    if (d <= HOSE_LENGTH || d > HOSE_LENGTH + 6) return;
    controls.playerX = A.x + (dx / d) * HOSE_LENGTH;
    controls.playerZ = A.z + (dz / d) * HOSE_LENGTH;
  };
  // The hose is a grabbable (townGrab.js — ✋ Grab the hose near its tap with empty hands, ✋ Drop
  // it; while held the Block bar is 💧 Water)
  // (the nearest tap by the player's own land — or, held, the one it's from)
  const tapDistance = () => {
    const A = tapSpot() ?? nearestTap();
    if (!A || !farm) return Infinity;
    const p = T.playerPos();
    return dist2(p.x, p.z, A.x, A.z);
  };
  T.addGrabbable({
    name: 'the hose',
    reach: HOSE_GRAB_DIST,
    distance: tapDistance,
    bar: 'water',
    use: (on) => setWatering(on),
    grab: () => {
      T.fishing = null;
      T.stopFishingRig?.();
      const tap = nearestTap();
      if (!tap) return false;
      T.hose = { tap, watering: false, dropAt: 0 };
      ctx.setPositionConstraint(hoseConstraint);
      T.feedLine(ctx.hasGyro()
        ? 'Got the hose. Point it with the phone and hold Water.'
        : 'Got the hose. Face the beds and hold Water (or F).');
      return true;
    },
    drop: ({ keepConstraint = false, quiet = false } = {}) => {
      if (!T.hose) return;
      const A = T.hose.tap;
      T.hose = null;
      keyDown = false;
      if (!keepConstraint) ctx.setPositionConstraint(null);
      if (farm) {
        farm.hose.visible = false;
        farm.nozzle.visible = false;
      }
      const p = T.playerPos();
      if (!quiet) T.feedLine(A && dist2(p.x, p.z, A.x, A.z) < HOSE_GRAB_DIST ? 'Hose hung back on the tap.' : 'The hose winds back onto its reel.');
    },
  });
  const setWatering = (on) => {
    if (!T.hose) return;
    T.hose.watering = !!on;
    T.actsAt = 0;
  };

  // Where the water leaves the nozzle and which way (world): the gyro — the player-local pose
  // the phone gives the right arm (playerModel.js gyroArmQuat, the sword's) — or where they face
  const aim = (from, dir) => {
    const pm = ctx.getPlayerModel();
    if (!pm) return false;
    pm.getWorldQuaternion(_q);
    // (the hand holding it follows the gyro — playerModel.js; empty hands don't)
    pm.userData.gyroHandAt = performance.now();
    const gq = pm.userData.gyroArmQuat;
    if (gq && performance.now() - (pm.userData.gyroArmTime || 0) < GYRO_MAX_AGE_MS) dir.set(0, 0, 1).applyQuaternion(gq).applyQuaternion(_q);
    else dir.set(0, 0.45, 1).applyQuaternion(_q);
    dir.normalize();
    const palm = pm.userData.qwopRig?.glbCharacter?.getPalmWorldPosition?.('left', from);
    if (!palm) from.copy(pm.position).add(_v2.set(0, 0.6, 0)).addScaledVector(_v2.set(0, 0, 1).applyQuaternion(_q), 0.3);
    from.addScaledVector(dir, 0.12);
    return true;
  };
  const _from = new THREE.Vector3();
  const _dir = new THREE.Vector3();
  const updateHose = (dt) => {
    const A = tapSpot();
    if (!T.hose || !farm || !A) return;
    const p = T.playerPos();
    // Let go: down, arrested, gone in somewhere, a weapon out, too far (a teleport)
    if (ctx.isPlayerDead() || T.sequence || T.jail || T.inRoom || ctx.isPlayerArmed() || ctx.isRodEquipped()
      || dist2(p.x, p.z, A.x, A.z) > HOSE_LENGTH + 3) {
      T.dropHeld({ keepConstraint: !!(T.jail || T.inRoom), quiet: !!(T.jail || T.sequence || ctx.isPlayerDead()) });
      return;
    }
    if (!aim(_from, _dir)) return;
    // The nozzle in the hand, pointing the way the water goes
    farm.nozzle.visible = true;
    farm.nozzle.position.copy(_from).addScaledVector(_dir, -0.12);
    farm.nozzle.quaternion.setFromUnitVectors(_FWD, _dir);
    // The hose: off the reel, along the ground to the player's feet, up to the nozzle
    const t0 = A.top;
    const pts = [t0.clone(), new THREE.Vector3(A.x, T.groundAt(A.x, A.z) + 0.04, A.z + 0.3)];
    const steps = 5;
    for (let k = 1; k <= steps; k++) {
      const f = k / (steps + 1);
      const x = A.x + (p.x - A.x) * f;
      const z = A.z + 0.3 + (p.z - A.z - 0.3) * f;
      pts.push(new THREE.Vector3(x + Math.sin(k * 2.1) * 0.25, T.groundAt(x, z) + 0.04, z + Math.cos(k * 1.7) * 0.25));
    }
    pts.push(new THREE.Vector3(p.x, p.y + 0.05, p.z), farm.nozzle.position.clone().addScaledVector(_dir, -0.08));
    farm.hose.geometry.dispose();
    farm.hose.geometry = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 28, 0.03, 5, false);
    farm.hose.visible = true;
    // The spray
    if (T.hose.watering) {
      if (!T.hose.wasOn) { T.hose.wasOn = true; T.hose.dropAt = T.simT; }
      while (T.hose.dropAt <= T.simT && farm.live.length < DROPS) {
        T.hose.dropAt += 1 / DROP_RATE;
        const v = _dir.clone();
        v.x += (Math.random() - 0.5) * DROP_SPREAD * 2;
        v.y += (Math.random() - 0.5) * DROP_SPREAD * 2;
        v.z += (Math.random() - 0.5) * DROP_SPREAD * 2;
        farm.live.push({ p: _from.clone(), v: v.normalize().multiplyScalar(HOSE_SPEED * (0.92 + Math.random() * 0.16)) });
      }
      T.hose.dropAt = Math.max(T.hose.dropAt, T.simT - 0.1);
    } else T.hose.wasOn = false;
  };
  // Drops fly and land: a dirt pile they land on gets wetter (WATER_SOAK_S of spray soaks it), a
  // townsperson they hit isn't pleased
  const updateDrops = (dt) => {
    if (!farm) return;
    const perDrop = SOIL_DRY_S / (DROP_RATE * WATER_SOAK_S);
    const boxes = farm.live.length ? builtBoxes() : [];
    farm.live = farm.live.filter((d) => {
      d.v.y -= GRAVITY * dt;
      d.p.addScaledVector(d.v, dt);
      for (const n of T.npcs) {
        if (!n.body || n.inside || n.fighter || Math.abs(n.x - d.p.x) > 0.5 || Math.abs(n.z - d.p.z) > 0.5) continue;
        const y = T.groundY(n);
        if (d.p.y < y || d.p.y > y + 1.2) continue;
        if (T.simT - (n.soakedAt ?? -1e9) > 4) {
          n.soakedAt = T.simT;
          n.attitude -= 0.03;
          T.say(n, ['Hey! I\'m soaked!', 'Watch where you point that!', 'Brr! That\'s cold!'][Math.floor(Math.random() * 3)]);
        }
        return false;
      }
      let gy = T.groundAt(d.p.x, d.p.z, -100);
      // (a planter box's soil)
      for (const o of boxes) {
        if (Math.abs(d.p.x - o.x) < PLOT_BOX_LEN / 2 && Math.abs(d.p.z - o.z) < PLOT_BOX_W / 2) gy = Math.max(gy, o.soil);
      }
      if (d.p.y > gy + 0.05) return d.p.y > gy - 20;
      for (const v of T.veg) {
        if (dist2(v.x, v.z, d.p.x, d.p.z) < HOSE_SPLASH_R) v.w = Math.min(SOIL_DRY_S, v.w + perDrop);
      }
      return false;
    });
    farm.drops.count = farm.live.length;
    farm.live.forEach((d, k) => farm.drops.setMatrixAt(k, _m.compose(d.p, _q.identity(), _s)));
    if (farm.live.length) farm.drops.instanceMatrix.needsUpdate = true;
  };
  // The planted seeds grow (a town day dry, VEG_WET_S wet); their dirt piles follow
  let ripeNoteAt = -1e9;
  const makePile = () => {
    const g = new THREE.Group();
    const pile = new THREE.Mesh(farm.pileGeo, new THREE.MeshStandardMaterial({ color: DRY_COLOR, roughness: 1, metalness: 0 }));
    pile.receiveShadow = true;
    const sprout = new THREE.Group();
    const stem = new THREE.Mesh(farm.stemGeo, farm.stemMat);
    // the vegetable it grows (vegetables.glb), lying on the pile by the stem
    const veg = createVeg(Math.floor(Math.random() * VEG_KINDS.length), 0.22);
    veg.position.set(0.1, 0, 0.02);
    veg.rotation.y = Math.random() * Math.PI * 2;
    stem.castShadow = true;
    sprout.add(stem, veg);
    sprout.position.y = 0.06;
    g.add(pile, sprout);
    farm.group.add(g);
    return { g, pile, sprout, veg, wet: -1 };
  };
  const updateVeg = (dt) => {
    if (!farm) return;
    let ripeNow = false;
    for (const v of T.veg) {
      if (v.g < 1) {
        v.g = Math.min(1, v.g + dt / (v.w > 0 ? VEG_WET_S : VEG_DRY_S));
        if (v.g >= 1) ripeNow = true;
      }
      if (v.w > 0) v.w = Math.max(0, v.w - dt);
    }
    if (ripeNow && T.simT - ripeNoteAt > 15) { ripeNoteAt = T.simT; T.feedLine('A veg you planted is ready to pick.'); }
    // (meshes: one per planted seed)
    for (const [v, m] of farm.piles) {
      if (T.veg.includes(v)) continue;
      m.g.parent?.remove(m.g);
      m.pile.material.dispose();
      farm.piles.delete(v);
    }
    for (const v of T.veg) {
      let m = farm.piles.get(v);
      if (!m) {
        m = makePile();
        const at = slotSpot(v.p, v.b, v.s);
        m.g.position.set(v.x, at ? at.y : T.groundAt(v.x, v.z), v.z);
        m.g.rotation.y = (v.x * 7.3 + v.z * 3.1) % (Math.PI * 2);
        farm.piles.set(v, m);
      }
      const wet = v.w > 0 ? 1 : 0;
      if (wet !== m.wet) { m.wet = wet; m.pile.material.color.copy(wet ? WET_COLOR : DRY_COLOR); }
      m.sprout.scale.setScalar(0.15 + 0.85 * v.g);
      m.veg.visible = v.g > 0.6;
    }
  };
  const updateFarm = (dt) => {
    if (!T.ready) return;
    updateHose(dt);
    updateDrops(dt);
    updateVeg(dt);
    renderSigns();
  };

  // Desktop: holding F waters
  const onKeyDown = (e) => {
    if (!T.active || !T.hose || e.repeat || e.target?.closest?.('input, textarea, select')) return;
    if (e.key === 'f' || e.key === 'F') { keyDown = true; setWatering(true); }
  };
  const onKeyUp = (e) => {
    if ((e.key === 'f' || e.key === 'F') && keyDown) { keyDown = false; setWatering(false); }
  };
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);


  // ── Saves ──
  // The world's (who owns which field) and the player's own (seeds, what they planted)
  const restoreFarm = (state, own) => {
    T.fieldOwners = cleanOwners(state?.fieldOwners);
    T.plotOwners = cleanPlots(state?.plotOwners);
    T.seeds = Math.max(0, Math.min(SEEDS_MAX, Math.floor(own?.seeds || 0)));
    // (a shared town: the player's own record of what they bought, until the host's word)
    for (const i of own?.myFields ?? []) if (!T.fieldOwners[i] && T.mp() && fields()[i]) T.fieldOwners[i] = { k: myKey(), n: ctx.getPlayerName() };
    for (const r of Array.isArray(own?.myPlots) ? own.myPlots : []) {
      const i = Number(r?.i);
      if (!T.mp() || !plots()[i] || (T.plotOwners[i] && T.plotOwners[i].k !== myKey())) continue;
      const b = Math.max(0, Math.min(PLOT_PLANTERS, Math.floor(Number(r.b) || 0)));
      T.plotOwners[i] = { k: myKey(), n: ctx.getPlayerName(), b: Math.max(b, T.plotOwners[i]?.b || 0) };
    }
    // What's planted: only in the player's planter boxes (a seed planted anywhere by an older
    // save goes back in the bag)
    const seen = new Set();
    T.veg = [];
    for (const v of (Array.isArray(own?.veg) ? own.veg : []).slice(0, VEG_MAX)) {
      const key = `${v?.p}.${v?.b}.${v?.s}`;
      const at = Number.isInteger(v?.p) && ownsPlot(v.p) && v.b < builtOn(v.p) && v.s >= 0 && v.s < PLANTER_SLOTS
        && !seen.has(key) ? slotSpot(v.p, v.b, v.s) : null;
      if (!at) { T.seeds = Math.min(SEEDS_MAX, T.seeds + 1); continue; }
      seen.add(key);
      T.veg.push({ x: at.x, z: at.z, p: v.p, b: v.b, s: v.s, g: Math.max(0, Math.min(1, Number(v.g) || 0)), w: Math.max(0, Math.min(SOIL_DRY_S, Number(v.w) || 0)) });
    }
    renderSigns();
  };
  const farmSnapshot = () => ({
    seeds: T.seeds,
    myFields: myFields(),
    myPlots: myPlots().map((i) => ({ i, b: builtOn(i) })),
    veg: T.veg.map((v) => ({ x: Math.round(v.x * 100) / 100, z: Math.round(v.z * 100) / 100, p: v.p, b: v.b, s: v.s, g: Math.round(v.g * 1000) / 1000, w: Math.round(v.w) })),
  });
  const resetFarm = () => {
    T.dropHeld({ quiet: true });
    if (farm) { farm.live = []; farm.drops.count = 0; }
  };

  Object.assign(T, {
    // (the town book's Bag page: 🌱 Plant)
    plantSeed: plant, canPlant: () => !!plantSpot(), plantHint,
    buildFarm, farmActs, farmSnapshot, fieldOwner, handleFarmNet, resetFarm, restoreFarm,
    updateFarm, planterObstacles, ownsPlot,
    applyFieldOwners: (f) => { T.fieldOwners = cleanOwners(f); renderSigns(); },
    applyPlotOwners: (p) => { T.plotOwners = cleanPlots(p); renderSigns(); },
  });
}

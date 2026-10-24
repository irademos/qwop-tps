// Town: farming. The allotment (townLayout.js — an open patch by the fields) has PLOT_COUNT farm
// plots round a water tap; a farmer sells the player one (🌱 Buy a plot, PLOT_PRICE to that
// farmer), seeds come from the shop (SHOP_GEAR 'seeds' → T.seeds), and a plot's beds are planted
// (🌱 Plant) and harvested once ripe (🥕 Harvest, HARVEST_VEG veg a bed). A bed only grows while
// its soil is wet: the hose at the tap (🚿 Grab the hose — empty hands, the player can't walk
// further than HOSE_LENGTH from the tap meanwhile) is held in the right hand and aimed with the
// gyro like the sword (no gyro: where the player faces); 💧 Water — the Block bar's place on the
// game's screen and the phone (bootstrapGameApp.js: isHoseHeld / setWatering) — or holding F
// sprays it, and the beds the water lands on soak (WATER_SOAK_S of spray) and stay wet
// SOIL_DRY_S.
//
// Who owns which plot is the town's (T.plotOwners: plot → { k: member key, n: name }; a shared
// town's host keeps it — 'buyPlot' / 'plots' ops); what grows in the player's own plots is
// theirs (T.plots, saved with their own things — others see their soil only).

import * as THREE from 'three';
import { makeTextSprite } from '../village/villageMode.js';
import { firstName } from './townPeople.js';
import {
  CROP_GROW_S, HARVEST_VEG, HOSE_GRAB_DIST, HOSE_LENGTH, HOSE_SPEED, HOSE_SPLASH_R, PLOT_ACT_DIST, PLOT_BED, PLOT_COLS,
  PLOT_COUNT, PLOT_PRICE, PLOT_ROWS, SEEDS_MAX, SOIL_DRY_S, TALK_RANGE, WATER_SOAK_S, dist2,
} from './townConfig.js';

// Plots round the tap (m from it)
const PLOT_OFFSETS = [[-2.0, -1.6], [2.0, -1.6], [-2.0, 1.6], [2.0, 1.6]];
const GRAVITY = 9.8;
const DROPS = 90;                   // water drops in the air at once…
const DROP_RATE = 45;               // …sprayed per second
const DROP_SPREAD = 0.06;           // rad of wobble
const DRY_COLOR = new THREE.Color(0x8a6a45);
const WET_COLOR = new THREE.Color(0x43301d);
const GYRO_MAX_AGE_MS = 500;        // (as playerModel.js: older, the gyro's not live)
const HOSE_REEL_UP = 0.55;          // m — the hose leaves the tap this high

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _s = new THREE.Vector3(1, 1, 1);
const _FWD = new THREE.Vector3(0, 0, 1);

// T: the town's shared state + functions (createTownMode in townMode.js); ctx: the game
export function installTownFarming(T, ctx) {
  T.plotOwners = {};
  T.plots = {};               // plot index → [{ s: 0 bare | 1 growing | 2 ripe, g: 0..1, w: s of wet soil left }]
  T.seeds = 0;
  T.hose = null;              // { watering, dropAt } while the player holds it
  let farm = null;            // the allotment's meshes (buildFarm)
  let keyDown = false;

  const allot = () => T.layout?.places.allotment ?? null;
  const myKey = () => (T.mp() ? ctx.memberKey() : 'me');
  const isMine = (i) => T.plotOwners[i]?.k === myKey();
  const myPlots = () => Object.keys(T.plotOwners).map(Number).filter(isMine);
  const freshBeds = () => Array.from({ length: PLOT_COLS * PLOT_ROWS }, () => ({ s: 0, g: 0, w: 0 }));
  const bedsOf = (i) => (T.plots[i] ??= freshBeds());

  // ── Layout (townLayout.js): the plots round a tap at c ──
  const layoutAllotment = (c) => ({
    tap: { x: c.x, z: c.z },
    plots: PLOT_OFFSETS.slice(0, PLOT_COUNT).map(([ox, oz], i) => {
      const x = c.x + ox;
      const z = c.z + oz;
      const beds = [];
      for (let r = 0; r < PLOT_ROWS; r++) {
        for (let k = 0; k < PLOT_COLS; k++) {
          beds.push({ x: x + (k - (PLOT_COLS - 1) / 2) * PLOT_BED, z: z + (r - (PLOT_ROWS - 1) / 2) * PLOT_BED });
        }
      }
      return { i, x, z, beds };
    }),
  });

  // ── Props ──
  const buildFarm = (group, A) => {
    const wood = new THREE.MeshStandardMaterial({ color: 0x6b4a2b, roughness: 1, metalness: 0 });
    const stemMat = new THREE.MeshStandardMaterial({ color: 0x5f9e3a, roughness: 1, metalness: 0 });
    const vegMat = new THREE.MeshStandardMaterial({ color: 0xe0782a, roughness: 0.9, metalness: 0 });
    const soilGeo = new THREE.BoxGeometry(PLOT_BED * 0.88, 0.08, PLOT_BED * 0.88);
    const stemGeo = new THREE.ConeGeometry(0.12, 0.4, 5).translate(0, 0.2, 0);
    const vegGeo = new THREE.SphereGeometry(0.09, 8, 6);
    const plots = A.plots.map((p) => {
      const beds = p.beds.map((b, k) => {
        const y = T.groundAt(b.x, b.z);
        const soil = new THREE.Mesh(soilGeo, new THREE.MeshStandardMaterial({ color: DRY_COLOR, roughness: 1, metalness: 0 }));
        soil.position.set(b.x, y + 0.03, b.z);
        soil.receiveShadow = true;
        const crop = new THREE.Group();
        const stem = new THREE.Mesh(stemGeo, stemMat);
        stem.castShadow = true;
        const veg = new THREE.Mesh(vegGeo, vegMat);
        veg.position.y = 0.05;
        veg.castShadow = true;
        crop.add(stem, veg);
        crop.position.set(b.x, y + 0.07, b.z);
        crop.rotation.y = k * 1.3;
        crop.visible = false;
        group.add(soil, crop);
        return { soil, crop, veg, wet: -1 };
      });
      // A low wooden edge round the plot
      const w = PLOT_COLS * PLOT_BED + 0.15;
      const d = PLOT_ROWS * PLOT_BED + 0.15;
      const y = T.groundAt(p.x, p.z);
      for (const [sx, sz, lx, lz] of [[0, -d / 2, w, 0.08], [0, d / 2, w, 0.08], [-w / 2, 0, 0.08, d], [w / 2, 0, 0.08, d]]) {
        const edge = new THREE.Mesh(new THREE.BoxGeometry(lx, 0.12, lz), wood);
        edge.position.set(p.x + sx, y + 0.06, p.z + sz);
        edge.castShadow = true;
        group.add(edge);
      }
      return { beds, sign: null, signText: '', signY: y + 1.25 };
    });
    // The tap: a post with a spout, the hose reel on it
    const tap = new THREE.Group();
    tap.position.set(A.tap.x, T.groundAt(A.tap.x, A.tap.z), A.tap.z);
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.9, 0.14), wood);
    post.position.y = 0.45;
    const metal = new THREE.MeshStandardMaterial({ color: 0x8a9096, roughness: 0.4, metalness: 0.7 });
    const spout = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.18, 8), metal);
    spout.rotation.x = Math.PI / 2;
    spout.position.set(0, 0.82, 0.12);
    const reel = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.05, 8, 18), new THREE.MeshStandardMaterial({ color: 0x3f8a3a, roughness: 0.8, metalness: 0 }));
    reel.position.set(0, HOSE_REEL_UP, 0.12);
    tap.add(post, spout, reel);
    tap.traverse((m) => { if (m.isMesh) m.castShadow = true; });
    group.add(tap);
    const tapSign = makeTextSprite('🚿 Hose', { height: 0.24 });
    tapSign.position.set(A.tap.x, tap.position.y + 1.25, A.tap.z);
    group.add(tapSign);
    // The hose out to the player's hand (rebuilt each frame while held), its nozzle, the water
    const hoseMat = new THREE.MeshStandardMaterial({ color: 0x3f8a3a, roughness: 0.8, metalness: 0 });
    const hose = new THREE.Mesh(new THREE.BufferGeometry(), hoseMat);
    hose.visible = false;
    hose.castShadow = true;
    group.add(hose);
    const nozzle = new THREE.Group();
    const nozzleBody = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.04, 0.2, 10).rotateX(Math.PI / 2).translate(0, 0, 0.05), metal);
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.12, 8).translate(0, -0.05, -0.02), hoseMat);
    nozzle.add(nozzleBody, grip);
    nozzle.visible = false;
    group.add(nozzle);
    const drops = new THREE.InstancedMesh(new THREE.SphereGeometry(0.035, 6, 4),
      new THREE.MeshBasicMaterial({ color: 0x9fd4ff, transparent: true, opacity: 0.75, depthWrite: false }), DROPS);
    drops.count = 0;
    drops.frustumCulled = false;
    group.add(drops);
    farm = { A, group, plots, tap, hose, nozzle, drops, live: [], tapTop: tap.position.clone().add(_v.set(0, HOSE_REEL_UP, 0.12)) };
    renderSigns();
  };

  // Over each plot: for sale, someone's, yours
  const renderSigns = () => {
    if (!farm) return;
    const { A } = farm;
    farm.plots.forEach((fp, i) => {
      const o = T.plotOwners[i];
      const text = !o ? `🌱 Plot for sale · ${PLOT_PRICE} 🪙 — ask a farmer` : isMine(i) ? '🌱 Your plot' : `🌱 ${o.n || 'Someone'}'s plot`;
      if (text === fp.signText) return;
      fp.signText = text;
      if (fp.sign) { fp.sign.parent?.remove(fp.sign); fp.sign.material.map?.dispose(); fp.sign.material.dispose(); }
      fp.sign = makeTextSprite(text, { height: 0.2 });
      fp.sign.position.set(A.plots[i].x, fp.signY, A.plots[i].z);
      farm.group.add(fp.sign);
    });
  };

  // ── Buying a plot (from a farmer) ──
  const freePlot = () => (allot()?.plots ?? []).findIndex((p, i) => !T.plotOwners[i]);
  const canSellPlot = (n) => n?.alive && n.role === 'farmer' && !n.fighter && n.attitude >= -0.5 && freePlot() >= 0;
  const buyPlot = (n) => {
    const i = freePlot();
    if (i < 0 || !canSellPlot(n)) return;
    if (ctx.getCoins() < PLOT_PRICE) { T.feedLine(`🪙 A plot costs ${PLOT_PRICE} coins.`); return; }
    ctx.addCoins(-PLOT_PRICE);
    T.npcMoney(n, PLOT_PRICE);
    T.plotOwners[i] = { k: myKey(), n: ctx.getPlayerName() };
    T.plots[i] = freshBeds();
    if (T.netMode === 'client') T.net.send(T.net.hostId(), { w: 1, op: 'buyPlot', i, k: myKey(), n: ctx.getPlayerName() });
    else if (T.netMode === 'host') T.net.broadcast({ w: 1, op: 'plots', p: T.plotOwners });
    T.say(n, `It's yours! Plant some seeds and keep the soil wet — the hose is by the tap.`, { big: true });
    T.feedLine(`🌱 Bought a farm plot from ${firstName(n.name)}. Seeds are at the shop.`);
    T.remember(n, 'customer');
    renderSigns();
    T.save();
  };
  // Shared town: the host keeps who owns which
  const handleFarmNet = (from, d) => {
    if (d.op === 'plots') {
      if (T.netMode === 'client' && from === T.net.hostId()) { T.plotOwners = cleanOwners(d.p); renderSigns(); }
      return true;
    }
    if (d.op !== 'buyPlot') return false;
    if (T.netMode !== 'host' || !T.ready) return true;
    const i = Number(d.i);
    if (Number.isInteger(i) && i >= 0 && i < (allot()?.plots.length ?? 0) && !T.plotOwners[i] && typeof d.k === 'string') {
      T.plotOwners[i] = { k: d.k, n: typeof d.n === 'string' ? d.n.slice(0, 40) : '' };
      renderSigns();
    }
    T.net.broadcast({ w: 1, op: 'plots', p: T.plotOwners });
    return true;
  };
  const cleanOwners = (p) => {
    const out = {};
    if (!p || typeof p !== 'object') return out;
    for (const [i, v] of Object.entries(p)) {
      const idx = Number(i);
      if (Number.isInteger(idx) && idx >= 0 && idx < PLOT_COUNT && typeof v?.k === 'string') out[idx] = { k: v.k, n: typeof v.n === 'string' ? v.n.slice(0, 40) : '' };
    }
    return out;
  };

  // ── Planting / harvesting ──
  const nearMyPlot = () => {
    const A = allot();
    if (!A || T.inRoom) return -1;
    const p = T.playerPos();
    let best = -1;
    let bd = PLOT_ACT_DIST;
    for (const i of myPlots()) {
      const d = dist2(p.x, p.z, A.plots[i].x, A.plots[i].z);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  };
  const plant = (i) => {
    const beds = bedsOf(i);
    let n = 0;
    for (const b of beds) {
      if (b.s !== 0 || T.seeds <= 0) continue;
      b.s = 1;
      b.g = 0;
      T.seeds -= 1;
      n += 1;
    }
    if (!n) return;
    const dry = beds.some((b) => b.s === 1 && b.w <= 0);
    T.feedLine(`🌱 Planted ${n} seed${n > 1 ? 's' : ''}${dry ? ' — water them with the hose to make them grow' : ''}.`);
  };
  const harvest = (i) => {
    let got = 0;
    for (const b of bedsOf(i)) {
      if (b.s !== 2 || T.bagRoom() < 1) continue;
      got += T.gain('crops', HARVEST_VEG);
      b.s = 0;
      b.g = 0;
    }
    if (got) T.feedLine(`🥕 +${got} Veg from your plot (${T.goods.crops})`);
  };
  const farmActs = () => {
    const out = [];
    const i = nearMyPlot();
    if (i < 0 || T.hose?.watering) return out;
    const beds = bedsOf(i);
    const ripe = beds.filter((b) => b.s === 2).length;
    const bare = beds.filter((b) => b.s === 0).length;
    if (ripe) out.push({ key: `harvest:${i}`, label: `🥕 Harvest (${ripe})`, onClick: () => harvest(i) });
    if (bare && T.seeds > 0) out.push({ key: `plant:${i}`, label: `🌱 Plant (${Math.min(bare, T.seeds)})`, onClick: () => plant(i) });
    return out;
  };
  // A farmer within talking range sells a plot
  const plotActs = (n) => (n && canSellPlot(n) && T.distToPlayer(n) < TALK_RANGE && myPlots().length < PLOT_COUNT
    ? [{ key: `plot:${n.id}`, label: `🌱 Buy a plot (${PLOT_PRICE} 🪙)`, onClick: () => buyPlot(n) }] : []);

  // ── The hose ──
  const hoseConstraint = (controls) => {
    const A = allot();
    if (!A) return;
    const dx = controls.playerX - A.tap.x;
    const dz = controls.playerZ - A.tap.z;
    const d = Math.hypot(dx, dz);
    // (a teleport — knocked out, the game's own — isn't pulled back: the hose is dropped)
    if (d <= HOSE_LENGTH || d > HOSE_LENGTH + 6) return;
    controls.playerX = A.tap.x + (dx / d) * HOSE_LENGTH;
    controls.playerZ = A.tap.z + (dz / d) * HOSE_LENGTH;
  };
  const nearTap = () => {
    const A = allot();
    if (!A || T.inRoom) return false;
    const p = T.playerPos();
    return dist2(p.x, p.z, A.tap.x, A.tap.z) < HOSE_GRAB_DIST;
  };
  const grabHose = () => {
    if (T.hose || !farm || ctx.isPlayerDead() || T.sequence || T.jail) return;
    T.fishing = null;
    T.stopFishingRig?.();
    ctx.putWeaponsAway?.();
    T.hose = { watering: false, dropAt: 0 };
    ctx.setPositionConstraint(hoseConstraint);
    T.feedLine(ctx.hasGyro()
      ? '🚿 Got the hose. Point it with the phone and hold 💧 Water.'
      : '🚿 Got the hose. Face the beds and hold 💧 Water (or F).');
    ctx.refreshButtons?.();
    T.actsAt = 0;
  };
  // (keepConstraint: something else has set the player's constraint since — a room, the jail)
  const dropHose = ({ keepConstraint = false, quiet = false } = {}) => {
    if (!T.hose) return;
    T.hose = null;
    keyDown = false;
    if (!keepConstraint) ctx.setPositionConstraint(null);
    if (farm) {
      farm.hose.visible = false;
      farm.nozzle.visible = false;
    }
    if (!quiet) T.feedLine('🚿 The hose winds back onto its reel.');
    ctx.refreshButtons?.();
    T.actsAt = 0;
  };
  const hoseActs = () => {
    if (T.hose) {
      // (a tap turns the water on / off — the Block bar's 💧 Water and F are held)
      const out = [{ key: 'water', label: T.hose.watering ? '💧 Stop' : '💧 Water', onClick: () => setWatering(!T.hose?.watering) }];
      out.push({ key: 'hose', label: nearTap() ? '🚿 Hang up the hose' : '✖ Drop the hose', onClick: () => dropHose() });
      return out;
    }
    return nearTap() ? [{ key: 'hose', label: '🚿 Grab the hose', onClick: grabHose }] : [];
  };
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
    const A = allot();
    if (!T.hose || !farm || !A) return;
    const p = T.playerPos();
    // Let go: down, arrested, gone in somewhere, a weapon out, too far (a teleport)
    if (ctx.isPlayerDead() || T.sequence || T.jail || T.inRoom || ctx.isPlayerArmed() || ctx.isRodEquipped()
      || dist2(p.x, p.z, A.tap.x, A.tap.z) > HOSE_LENGTH + 3) {
      dropHose({ keepConstraint: !!(T.jail || T.inRoom), quiet: !!(T.jail || T.sequence || ctx.isPlayerDead()) });
      return;
    }
    if (!aim(_from, _dir)) return;
    // The nozzle in the hand, pointing the way the water goes
    farm.nozzle.visible = true;
    farm.nozzle.position.copy(_from).addScaledVector(_dir, -0.12);
    farm.nozzle.quaternion.setFromUnitVectors(_FWD, _dir);
    // The hose: off the reel, along the ground to the player's feet, up to the nozzle
    const t0 = farm.tapTop;
    const pts = [t0.clone(), new THREE.Vector3(A.tap.x, T.groundAt(A.tap.x, A.tap.z) + 0.04, A.tap.z + 0.3)];
    const steps = 5;
    for (let k = 1; k <= steps; k++) {
      const f = k / (steps + 1);
      const x = A.tap.x + (p.x - A.tap.x) * f;
      const z = A.tap.z + 0.3 + (p.z - A.tap.z - 0.3) * f;
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
        const v = _v.copy(_dir);
        v.x += (Math.random() - 0.5) * DROP_SPREAD * 2;
        v.y += (Math.random() - 0.5) * DROP_SPREAD * 2;
        v.z += (Math.random() - 0.5) * DROP_SPREAD * 2;
        farm.live.push({ p: _from.clone(), v: v.normalize().multiplyScalar(HOSE_SPEED * (0.92 + Math.random() * 0.16)) });
      }
      T.hose.dropAt = Math.max(T.hose.dropAt, T.simT - 0.1);
    } else T.hose.wasOn = false;
  };
  // Drops fly and land: a bed they land on gets wetter (WATER_SOAK_S of spray soaks it), a
  // townsperson they hit isn't pleased
  const updateDrops = (dt) => {
    if (!farm) return;
    const A = allot();
    const mine = myPlots();
    const perDrop = SOIL_DRY_S / (DROP_RATE * WATER_SOAK_S);
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
      const gy = T.groundAt(d.p.x, d.p.z, -100);
      if (d.p.y > gy + 0.05) return d.p.y > gy - 20;
      for (const i of mine) {
        const pl = A.plots[i];
        if (Math.abs(d.p.x - pl.x) > 2.2 || Math.abs(d.p.z - pl.z) > 1.8) continue;
        const beds = bedsOf(i);
        pl.beds.forEach((b, k) => {
          if (dist2(b.x, b.z, d.p.x, d.p.z) < HOSE_SPLASH_R) beds[k].w = Math.min(SOIL_DRY_S, beds[k].w + perDrop);
        });
      }
      return false;
    });
    farm.drops.count = farm.live.length;
    farm.live.forEach((d, k) => farm.drops.setMatrixAt(k, _m.compose(d.p, _q.identity(), _s)));
    if (farm.live.length) farm.drops.instanceMatrix.needsUpdate = true;
  };
  // The player's beds grow while wet; their meshes follow (others' plots: bare soil)
  let readyNoteAt = -1e9;
  const updateBeds = (dt) => {
    if (!farm) return;
    let ripeNow = false;
    farm.plots.forEach((fp, i) => {
      const mine = isMine(i);
      const beds = mine ? bedsOf(i) : null;
      fp.beds.forEach((m, k) => {
        const b = beds?.[k];
        if (b) {
          if (b.w > 0) {
            b.w = Math.max(0, b.w - dt);
            if (b.s === 1) {
              b.g += dt / CROP_GROW_S;
              if (b.g >= 1) { b.s = 2; b.g = 1; ripeNow = true; }
            }
          }
        }
        const wet = b && b.w > 0 ? 1 : 0;
        if (wet !== m.wet) { m.wet = wet; m.soil.material.color.copy(wet ? WET_COLOR : DRY_COLOR); }
        const show = !!b && b.s > 0;
        m.crop.visible = show;
        if (show) {
          const g = b.s === 2 ? 1 : b.g;
          m.crop.scale.setScalar(0.25 + 0.75 * g);
          m.veg.visible = g > 0.6;
        }
      });
    });
    if (ripeNow && T.simT - readyNoteAt > 20) { readyNoteAt = T.simT; T.feedLine('🥕 Veg in your plot is ripe — 🥕 Harvest it.'); }
  };
  const updateFarm = (dt) => {
    if (!T.ready) return;
    updateHose(dt);
    updateDrops(dt);
    updateBeds(dt);
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
  // The world's (who owns which) and the player's own (seeds, their beds)
  const restoreFarm = (state, own) => {
    T.plotOwners = cleanOwners(state?.plots);
    T.seeds = Math.max(0, Math.min(SEEDS_MAX, Math.floor(own?.seeds || 0)));
    T.plots = {};
    for (const [i, beds] of Object.entries(own?.beds ?? {})) {
      if (!Array.isArray(beds)) continue;
      T.plots[i] = freshBeds().map((b, k) => ({
        s: [0, 1, 2].includes(beds[k]?.s) ? beds[k].s : 0,
        g: Math.max(0, Math.min(1, Number(beds[k]?.g) || 0)),
        w: Math.max(0, Math.min(SOIL_DRY_S, Number(beds[k]?.w) || 0)),
      }));
    }
    // (a shared town: the player's own record of what they bought, until the host's word)
    for (const i of own?.myPlots ?? []) if (!T.plotOwners[i] && T.mp()) T.plotOwners[i] = { k: myKey(), n: ctx.getPlayerName() };
    renderSigns();
  };
  const farmSnapshot = () => ({
    seeds: T.seeds,
    myPlots: myPlots(),
    beds: Object.fromEntries(myPlots().map((i) => [i, bedsOf(i).map((b) => ({ s: b.s, g: Math.round(b.g * 1000) / 1000, w: Math.round(b.w) }))])),
  });
  const resetFarm = () => {
    dropHose({ quiet: true });
    if (farm) { farm.live = []; farm.drops.count = 0; }
  };

  Object.assign(T, {
    buildFarm, dropHose, farmActs, farmSnapshot, handleFarmNet, hoseActs, layoutAllotment, plotActs, resetFarm,
    restoreFarm, setWatering, updateFarm,
    applyPlots: (p) => { T.plotOwners = cleanOwners(p); renderSigns(); },
    hoseHeld: () => !!T.hose,
  });
}

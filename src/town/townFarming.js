// Town: farming. The farmers' fields (townLayout.js) can be bought — walk up to one and 🌱 Buy
// this field (FIELD_PRICE, paid to the farmer who works it; no talking needed): its crops are the
// player's to pick from then on (no theft), and the farmer stops working it. Seeds come from the
// shop (SHOP_GEAR 'seeds' → T.seeds) and are planted anywhere (🌱 Plant a seed — a little dirt
// pile in front of the player); each grows one veg in a town day (VEG_DRY_S), or in VEG_WET_S
// while its soil is wet, then 🥕 Pick your veg. The water: the hose at the tap (🚿 Grab the hose —
// empty hands, the player can't walk further than HOSE_LENGTH from the tap meanwhile) is held in
// the right hand and aimed with the gyro like the sword (no gyro: where the player faces);
// 💧 Water — the Block bar's place on the game's screen and the phone (bootstrapGameApp.js:
// isHoseHeld / setWatering) — or holding F sprays it, and the dirt piles the water lands on soak
// (WATER_SOAK_S of spray) and stay wet SOIL_DRY_S.
//
// Who owns which field is the town's (T.fieldOwners: field index → { k: member key, n: name }; a
// shared town's host keeps it — 'buyField' / 'fields' ops); what's planted is the player's own
// (T.veg, saved with their own things — others don't see it).

import * as THREE from 'three';
import { makeTextSprite } from '../village/villageMode.js';
import { firstName } from './townPeople.js';
import {
  FIELD_ACT_DIST, FIELD_PRICE, HOSE_GRAB_DIST, HOSE_LENGTH, HOSE_SPEED, HOSE_SPLASH_R, SEEDS_MAX, SOIL_DRY_S,
  VEG_DRY_S, VEG_GAP, VEG_MAX, VEG_PICK_DIST, VEG_WET_S, WATER_SOAK_S, dist2,
} from './townConfig.js';

const GRAVITY = 9.8;
const DROPS = 90;                   // water drops in the air at once…
const DROP_RATE = 45;               // …sprayed per second
const DROP_SPREAD = 0.06;           // rad of wobble
const DRY_COLOR = new THREE.Color(0x8a6a45);
const WET_COLOR = new THREE.Color(0x43301d);
const GYRO_MAX_AGE_MS = 500;        // (as playerModel.js: older, the gyro's not live)
const HOSE_REEL_UP = 0.55;          // m — the hose leaves the tap this high
const PLANT_AHEAD = 0.6;            // m in front of the player a seed goes in

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _s = new THREE.Vector3(1, 1, 1);
const _FWD = new THREE.Vector3(0, 0, 1);

// T: the town's shared state + functions (createTownMode in townMode.js); ctx: the game
export function installTownFarming(T, ctx) {
  T.fieldOwners = {};
  T.veg = [];                 // the player's planted seeds: [{ x, z, g: 0..1 (1 ripe), w: s of wet soil left }]
  T.seeds = 0;
  T.hose = null;              // { watering, dropAt } while the player holds it
  let farm = null;            // the meshes (buildFarm)
  let keyDown = false;

  const tapSpot = () => T.layout?.places.tap ?? null;
  const fields = () => T.layout?.places.fields ?? [];
  const myKey = () => (T.mp() ? ctx.memberKey() : 'me');
  const ownsField = (i) => T.fieldOwners[i]?.k === myKey();
  const myFields = () => Object.keys(T.fieldOwners).map(Number).filter(ownsField);
  // Whose a field is: 'mine', 'theirs' (another player's) or null (a farmer's)
  const fieldOwner = (f) => {
    const o = T.fieldOwners[fields().indexOf(f)];
    return !o ? null : o.k === myKey() ? 'mine' : 'theirs';
  };

  // ── Props: the tap (+ the hose, its nozzle, the water), the fields' signs, the dirt piles ──
  const mat = (color) => new THREE.MeshStandardMaterial({ color, roughness: 1, metalness: 0 });
  const buildFarm = (group, places) => {
    const metal = new THREE.MeshStandardMaterial({ color: 0x8a9096, roughness: 0.4, metalness: 0.7 });
    const hoseMat = mat(0x3f8a3a);
    farm = {
      group, fieldSigns: places.fields.map(() => ({ sign: null, text: '' })), live: [], piles: new Map(),
      pileGeo: new THREE.SphereGeometry(0.25, 10, 6).scale(1, 0.4, 1),
      stemGeo: new THREE.ConeGeometry(0.09, 0.4, 5).translate(0, 0.2, 0),
      vegGeo: new THREE.SphereGeometry(0.1, 8, 6),
      stemMat: mat(0x5f9e3a), vegMat: mat(0xe0782a),
    };
    const tap = places.tap;
    if (tap) {
      const root = new THREE.Group();
      root.position.set(tap.x, T.groundAt(tap.x, tap.z), tap.z);
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.9, 0.14), mat(0x6b4a2b));
      post.position.y = 0.45;
      const spout = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.18, 8), metal);
      spout.rotation.x = Math.PI / 2;
      spout.position.set(0, 0.82, 0.12);
      const reel = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.05, 8, 18), hoseMat);
      reel.position.set(0, HOSE_REEL_UP, 0.12);
      root.add(post, spout, reel);
      root.traverse((m) => { if (m.isMesh) m.castShadow = true; });
      group.add(root);
      const sign = makeTextSprite('🚿 Hose', { height: 0.24 });
      sign.position.set(tap.x, root.position.y + 1.25, tap.z);
      group.add(sign);
      farm.tapTop = root.position.clone().add(_v.set(0, HOSE_REEL_UP, 0.12));
    }
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

  // Over each field: for sale, someone's, yours
  const renderSigns = () => {
    if (!farm) return;
    fields().forEach((f, i) => {
      const fs = farm.fieldSigns[i];
      if (!fs) return;
      const o = T.fieldOwners[i];
      const text = !o ? `🌱 Field for sale · ${FIELD_PRICE} 🪙` : ownsField(i) ? '🌱 Your field' : `🌱 ${o.n || 'Someone'}'s field`;
      if (text === fs.text) return;
      fs.text = text;
      if (fs.sign) { fs.sign.parent?.remove(fs.sign); fs.sign.material.map?.dispose(); fs.sign.material.dispose(); }
      fs.sign = makeTextSprite(text, { height: 0.22 });
      fs.sign.position.set(f.x, T.groundAt(f.x, f.z) + 1.6, f.z);
      farm.group.add(fs.sign);
    });
  };

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
    if (ctx.getCoins() < FIELD_PRICE) { T.feedLine(`🪙 This field costs ${FIELD_PRICE} coins.`); return; }
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
    T.feedLine(`🌱 You bought ${farmer ? `${firstName(farmer.name)}'s` : 'the'} field. Its veg is yours to pick.`);
    renderSigns();
    T.save();
  };
  const fieldActs = () => {
    const i = fieldNear();
    if (i < 0 || T.fieldOwners[i]) return [];
    return [{ key: `field:${i}`, label: `🌱 Buy this field (${FIELD_PRICE} 🪙)`, onClick: () => buyField(i) }];
  };
  // Shared town: the host keeps who owns which
  const handleFarmNet = (from, d) => {
    if (d.op === 'fields') {
      if (T.netMode === 'client' && from === T.net.hostId()) { T.fieldOwners = cleanOwners(d.f); T.assignWork(); renderSigns(); }
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

  // ── Planting anywhere / picking ──
  // Where a seed would go: just in front of the player, on dry open ground (null: not here)
  const plantSpot = () => {
    if (T.inRoom || T.jail || T.seeds <= 0 || T.veg.length >= VEG_MAX) return null;
    const pm = ctx.getPlayerModel();
    if (!pm) return null;
    pm.getWorldQuaternion(_q);
    const f = _v.set(0, 0, 1).applyQuaternion(_q).setY(0).normalize();
    const p = T.playerPos();
    const x = p.x + f.x * PLANT_AHEAD;
    const z = p.z + f.z * PLANT_AHEAD;
    if (ctx.isOverWater(x, z) || T.rooms.roomAt(x, z) || T.veg.some((v) => dist2(v.x, v.z, x, z) < VEG_GAP)) return null;
    if (!Number.isFinite(ctx.getGroundY(x, z)) || Math.abs(ctx.getGroundY(x, z) - p.y) > 0.6) return null;
    return { x, z };
  };
  const plant = () => {
    const at = plantSpot();
    if (!at) return;
    T.seeds -= 1;
    T.veg.push({ x: at.x, z: at.z, g: 0, w: 0 });
    T.feedLine(T.veg.length === 1
      ? '🌱 Planted a seed. It\'ll grow a veg by tomorrow — or water it with the hose and it\'s ready in no time.'
      : `🌱 Planted a seed (${T.seeds} left).`);
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
    T.feedLine(`🥕 +1 Veg you grew (${T.goods.crops})`);
  };
  const farmActs = () => {
    const out = [];
    if (T.hose?.watering) return out;
    if (ripeVegNear()) out.push({ key: 'pickVeg', label: '🥕 Pick your veg', onClick: pickVeg });
    out.push(...fieldActs());
    if (plantSpot()) out.push({ key: 'plant', label: `🌱 Plant a seed (${T.seeds})`, onClick: plant });
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
  const nearTap = () => {
    const A = tapSpot();
    if (!A || T.inRoom) return false;
    const p = T.playerPos();
    return dist2(p.x, p.z, A.x, A.z) < HOSE_GRAB_DIST;
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
    const A = tapSpot();
    if (!T.hose || !farm || !A) return;
    const p = T.playerPos();
    // Let go: down, arrested, gone in somewhere, a weapon out, too far (a teleport)
    if (ctx.isPlayerDead() || T.sequence || T.jail || T.inRoom || ctx.isPlayerArmed() || ctx.isRodEquipped()
      || dist2(p.x, p.z, A.x, A.z) > HOSE_LENGTH + 3) {
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
    const veg = new THREE.Mesh(farm.vegGeo, farm.vegMat);
    veg.position.y = 0.05;
    stem.castShadow = true;
    veg.castShadow = true;
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
    if (ripeNow && T.simT - ripeNoteAt > 15) { ripeNoteAt = T.simT; T.feedLine('🥕 A veg you planted is ready — 🥕 Pick your veg.'); }
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
        m.g.position.set(v.x, T.groundAt(v.x, v.z), v.z);
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
    T.seeds = Math.max(0, Math.min(SEEDS_MAX, Math.floor(own?.seeds || 0)));
    T.veg = (Array.isArray(own?.veg) ? own.veg : []).slice(0, VEG_MAX)
      .filter((v) => Number.isFinite(v?.x) && Number.isFinite(v?.z))
      .map((v) => ({ x: v.x, z: v.z, g: Math.max(0, Math.min(1, Number(v.g) || 0)), w: Math.max(0, Math.min(SOIL_DRY_S, Number(v.w) || 0)) }));
    // (a shared town: the player's own record of what they bought, until the host's word)
    for (const i of own?.myFields ?? []) if (!T.fieldOwners[i] && T.mp() && fields()[i]) T.fieldOwners[i] = { k: myKey(), n: ctx.getPlayerName() };
    renderSigns();
  };
  const farmSnapshot = () => ({
    seeds: T.seeds,
    myFields: myFields(),
    veg: T.veg.map((v) => ({ x: Math.round(v.x * 100) / 100, z: Math.round(v.z * 100) / 100, g: Math.round(v.g * 1000) / 1000, w: Math.round(v.w) })),
  });
  const resetFarm = () => {
    dropHose({ quiet: true });
    if (farm) { farm.live = []; farm.drops.count = 0; }
  };

  Object.assign(T, {
    buildFarm, dropHose, farmActs, farmSnapshot, fieldOwner, handleFarmNet, hoseActs, resetFarm, restoreFarm, setWatering,
    updateFarm,
    applyFieldOwners: (f) => { T.fieldOwners = cleanOwners(f); renderSigns(); },
    hoseHeld: () => !!T.hose,
  });
}

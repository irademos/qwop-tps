// Town: the layout, built once from the map — the walkability grid (townNav.js), homes, the
// shops (two of the houses), the campfire, the jail, fields, work spots, the patrol loop, the
// bandit camp — and its props.

import { makeCampfire, makeTextSprite } from '../village/villageMode.js';
import * as THREE from 'three';
import { createTownNav } from './townNav.js';
import {
  BUILDING_RE, CAMP_DIST, HOUSE_DOORS, HOUSE_DOOR_OUT, NAV_BOUNDS, NAV_CELL, NAV_START, TOWN_BOUNDS, TREE_RE,
  TREE_TRUNK_RADIUS, TREE_WOOD, dist2,
} from './townConfig.js';

// T: the town's shared state + functions (createTownMode in townMode.js); ctx: the game
export function installTownLayout(T, ctx) {
  // ── Layout (once) ──
  const buildLayout = () => {
    const nav = createTownNav({
      bounds: NAV_BOUNDS,
      cell: NAV_CELL,
      start: NAV_START,
      getGroundY: ctx.getGroundY,
      isOverWater: ctx.isOverWater,
      pathAt: ctx.pathAt,
    });
    const objects = ctx.getMapObjects(TOWN_BOUNDS);
    const buildings = objects.filter((o) => BUILDING_RE.test(o.file));
    const trees = objects.filter((o) => TREE_RE.test(o.file));
    // Trees aren't ground (the height raycast skips them): walk round their trunks (out of
    // town too — the way to the bandit camp)
    for (const t of ctx.getMapObjects(NAV_BOUNDS)) if (TREE_RE.test(t.file)) nav.block(t.x, t.z, TREE_TRUNK_RADIUS);
    nav.refresh();
    // Middle of town: the houses' centroid (or the nav start)
    const C = buildings.length
      ? { x: buildings.reduce((s, b) => s + b.x, 0) / buildings.length, z: buildings.reduce((s, b) => s + b.z, 0) / buildings.length }
      : { ...NAV_START };
    const cellPos = (i) => ({ x: nav.cellX(i), z: nav.cellZ(i) });
    const dC = (i) => dist2(nav.cellX(i), nav.cellZ(i), C.x, C.z);
    const best = (cells, score) => {
      let bi = -1;
      let bs = -Infinity;
      for (const i of cells) {
        const s = score(i);
        if (s > bs) { bs = s; bi = i; }
      }
      return bi;
    };
    const nearRoad = (i, r) => {
      const x = nav.cellX(i);
      const z = nav.cellZ(i);
      for (let dz = -r; dz <= r; dz += NAV_CELL) {
        for (let dx = -r; dx <= r; dx += NAV_CELL) {
          const j = nav.indexAt(x + dx, z + dz);
          if (j >= 0 && nav.walkableIndex(j) && nav.kindAt(j) === 2) return true;
        }
      }
      return false;
    };

    // The shops: the house nearest the middle whose model's front door is known (HOUSE_DOORS)
    // is the goods shop, the nearest other house of the same model the weapon shop (nobody
    // lives there); the campfire a little way off the goods shop; the jail by a road further out
    const offRoad = (i) => nav.kindAt(i) !== 2;
    // A house's front door: the spot just outside it, and the way out (null: model unknown, or
    // no walkable ground in front of it)
    const doorOf = (b) => {
      const spec = HOUSE_DOORS[b.file?.split('/').pop()];
      if (!spec || !b.local || b.local.isEmpty()) return null;
      const { min, max } = b.local;
      const mx = (min.x + max.x) / 2;
      const mz = (min.z + max.z) / 2;
      const hx = (max.x - min.x) / 2;
      const hz = (max.z - min.z) / 2;
      const axisX = spec.side.endsWith('x');
      const sign = spec.side[0] === '-' ? -1 : 1;
      const inset = 1 - (spec.inset ?? 0);
      const wall = axisX
        ? new THREE.Vector3(mx + sign * hx * inset, 0, mz + spec.at * hz)
        : new THREE.Vector3(mx + spec.at * hx, 0, mz + sign * hz * inset);
      const normal = axisX ? new THREE.Vector3(sign, 0, 0) : new THREE.Vector3(0, 0, sign);
      wall.applyMatrix4(b.matrix);
      normal.transformDirection(b.matrix).setY(0).normalize();
      const door = { x: wall.x + normal.x * HOUSE_DOOR_OUT, z: wall.z + normal.z * HOUSE_DOOR_OUT };
      // (townsfolk walk the last bit onto it from the grid)
      const i = nav.nearestWalkable(door.x, door.z);
      if (i < 0 || dist2(nav.cellX(i), nav.cellZ(i), door.x, door.z) > 2) return null;
      return { door, exitYaw: Math.atan2(normal.x, normal.z) };
    };
    const shopHouses = [];
    const byMiddle = [...buildings].sort((a, b2) => dist2(a.x, a.z, C.x, C.z) - dist2(b2.x, b2.z, C.x, C.z));
    const pickShopHouse = (want) => {
      for (const b of byMiddle) {
        if (buildings.length - shopHouses.length <= 1) return false;
        if (want && !want(b)) continue;
        if (shopHouses.some((h) => h.building === b || dist2(h.building.x, h.building.z, b.x, b.z) < 6)) continue;
        const d = doorOf(b);
        if (d) { shopHouses.push({ building: b, ...d }); return true; }
      }
      return false;
    };
    if (pickShopHouse()) {
      const file = shopHouses[0].building.file;
      if (!pickShopHouse((b) => b.file === file)) pickShopHouse();
    }
    // (no houses to spare: the doors stand on the most open spots off the road)
    while (shopHouses.length < 2) {
      const taken = shopHouses.map((h) => h.door);
      const cell = best(nav.cellsWhere((i) => offRoad(i) && dC(i) < 18 && nav.clearanceAt(i) >= 2.5
        && taken.every((t) => dist2(nav.cellX(i), nav.cellZ(i), t.x, t.z) > 6)), (i) => nav.clearanceAt(i) * 2 - dC(i) * 0.2);
      const door = cell >= 0 ? cellPos(cell) : { x: NAV_START.x + shopHouses.length * 6, z: NAV_START.z };
      // (walking out: away from the middle)
      const exitYaw = dist2(door.x, door.z, C.x, C.z) > 0.1 ? Math.atan2(door.x - C.x, door.z - C.z) : 0;
      shopHouses.push({ building: null, door, exitYaw });
    }
    const shops = {};
    ['goods', 'gear'].forEach((key, k) => {
      const { building, door, exitYaw } = shopHouses[k];
      shops[key] = { key, building, door, exitYaw };
    });
    const market = shops.goods.door;
    const fireCell = best(nav.cellsWhere((i) => {
      const d = dist2(nav.cellX(i), nav.cellZ(i), market.x, market.z);
      return offRoad(i) && d > 6 && d < 13 && nav.clearanceAt(i) >= 2.5
        && dist2(nav.cellX(i), nav.cellZ(i), shops.gear.door.x, shops.gear.door.z) > 4;
    }), (i) => nav.clearanceAt(i) - dC(i) * 0.1);
    const fire = fireCell >= 0 ? cellPos(fireCell) : { x: market.x + 6, z: market.z };
    const jailCell = best(nav.cellsWhere((i) => {
      const x = nav.cellX(i);
      const z = nav.cellZ(i);
      return offRoad(i) && dist2(x, z, market.x, market.z) > 14 && dist2(x, z, fire.x, fire.z) > 12 && dC(i) < 32
        && nav.clearanceAt(i) >= 2.5 && nearRoad(i, 4);
    }), (i) => nav.clearanceAt(i) - dC(i) * 0.05);
    const jailPos = jailCell >= 0 ? cellPos(jailCell) : { x: market.x - 10, z: market.z };

    // Inside the goods shop: the merchant behind the back counter, customers in front of it
    const merchantSpot = T.stalls.spot('goods', 'merchant');
    const customerSpot = T.stalls.spot('goods', 'customer');
    // The jail's door faces the nearest road
    let roadDir = null;
    {
      let bd = Infinity;
      for (const i of nav.cellsWhere((j) => nav.kindAt(j) === 2)) {
        const d = dist2(nav.cellX(i), nav.cellZ(i), jailPos.x, jailPos.z);
        if (d > 2 && d < bd) { bd = d; roadDir = { x: nav.cellX(i) - jailPos.x, z: nav.cellZ(i) - jailPos.z }; }
      }
    }
    const jailYaw = roadDir ? Math.atan2(roadDir.x, roadDir.z) : 0;
    const jailFwd = { x: Math.sin(jailYaw), z: Math.cos(jailYaw) };
    const officeSpot = { x: jailPos.x + jailFwd.x * 2.2 + jailFwd.z * 1.2, z: jailPos.z + jailFwd.z * 2.2 - jailFwd.x * 1.2 };

    nav.block(fire.x, fire.z, 0.9);
    nav.block(jailPos.x, jailPos.z, 1.7);
    nav.refresh();

    // Homes: a walkable spot by each house (not the shops)
    const homes = [];
    for (const b of buildings) {
      if (shopHouses.some((h) => h.building === b)) continue;
      const i = nav.nearestWalkable(b.x, b.z);
      if (i < 0) continue;
      const d = dist2(nav.cellX(i), nav.cellZ(i), b.x, b.z);
      if (d > b.radius + 4) continue;
      homes.push({ x: nav.cellX(i), z: nav.cellZ(i), building: b });
    }
    if (!homes.length) homes.push({ ...fire });

    // Work spots
    const treeSpots = [];
    for (const t of [...trees].sort((a, b) => dist2(a.x, a.z, C.x, C.z) - dist2(b.x, b.z, C.x, C.z))) {
      const i = nav.nearestWalkable(t.x, t.z);
      if (i < 0) continue;
      const p = cellPos(i);
      if (dist2(p.x, p.z, t.x, t.z) > 3.5) continue;
      if (treeSpots.some((s) => dist2(s.x, s.z, p.x, p.z) < 5)) continue;
      treeSpots.push({ ...p, face: { x: t.x, z: t.z } });
      if (treeSpots.length >= 6) break;
    }
    const fields = [];
    for (const i of nav.cellsWhere((j) => nav.kindAt(j) === 0 && nav.clearanceAt(j) >= 3.5 && dC(j) > 16 && dC(j) < 46)
      .sort((a, b) => nav.clearanceAt(b) - nav.clearanceAt(a))) {
      const p = cellPos(i);
      if (dist2(p.x, p.z, market.x, market.z) < 12 || dist2(p.x, p.z, jailPos.x, jailPos.z) < 8) continue;
      if (fields.some((f) => dist2(f.x, f.z, p.x, p.z) < 11)) continue;
      fields.push(p);
      if (fields.length >= 3) break;
    }
    const shore = [];
    for (const i of nav.cellsWhere((j) => nav.neighbourIndices(j).some((k) => nav.isWater(k)))
      .sort((a, b) => dC(a) - dC(b))) {
      const p = cellPos(i);
      if (shore.some((s) => dist2(s.x, s.z, p.x, p.z) < 6)) continue;
      const w = nav.neighbourIndices(i).find((k) => nav.isWater(k));
      shore.push({ ...p, face: { x: nav.cellX(w), z: nav.cellZ(w) } });
      if (shore.length >= 4) break;
    }
    // Patrol: road spots spread around the middle (farthest-point picks), walked in a loop
    const roadCells = nav.cellsWhere((i) => nav.kindAt(i) === 2 && dC(i) < 34);
    const patrol = [{ ...officeSpot }];
    for (let k = 0; k < 5 && roadCells.length; k++) {
      const i = best(roadCells, (j) => Math.min(...patrol.map((p) => dist2(nav.cellX(j), nav.cellZ(j), p.x, p.z))));
      patrol.push(cellPos(i));
    }
    patrol.sort((a, b) => Math.atan2(a.z - C.z, a.x - C.x) - Math.atan2(b.z - C.z, b.x - C.x));
    // Where newcomers walk in: the town's road furthest from the middle
    const entranceCell = best(nav.cellsWhere((i) => nav.kindAt(i) >= 1 && dC(i) < 50), (i) => dC(i));
    const entrance = entranceCell >= 0 ? cellPos(entranceCell) : { ...NAV_START };

    // The bandit camp: an open spot far out of town, off the roads (or the furthest open one)
    const campMid = (CAMP_DIST[0] + CAMP_DIST[1]) / 2;
    const campOk = (i) => {
      const d = dC(i);
      return d >= CAMP_DIST[0] && d <= CAMP_DIST[1] && nav.clearanceAt(i) >= 3 && !nearRoad(i, 8);
    };
    let campCell = best(nav.cellsWhere(campOk), (i) => Math.min(nav.clearanceAt(i), 6) - Math.abs(dC(i) - campMid) * 0.15);
    if (campCell < 0) campCell = best(nav.cellsWhere((i) => nav.clearanceAt(i) >= 2), (i) => dC(i));
    const camp = campCell >= 0 ? cellPos(campCell) : { ...entrance };
    const campFire = { x: camp.x + 2.2, z: camp.z };
    const strongbox = { x: camp.x - 1.6, z: camp.z + 1.4 };
    nav.block(camp.x, camp.z, 1.2);
    nav.block(campFire.x, campFire.z, 0.8);
    nav.refresh();

    // The fishing spot (one for now): the shore spot nearest the middle — the first fisher's too
    const fishSpot = shore[0] ?? null;
    const places = {
      center: C, market, shops, merchantSpot, customerSpot, fire, jail: jailPos, jailYaw, officeSpot,
      homes, treeSpots, fields, shore, fishSpot, patrol, entrance, camp, campFire, strongbox,
      // the player arrives between the goods shop and the fire
      spawn: (() => {
        const i = nav.nearestWalkable((market.x + fire.x) / 2, (market.z + fire.z) / 2);
        return i >= 0 ? cellPos(i) : { ...fire };
      })(),
    };
    // Every tree in town can be chopped (wood: what it has left; it grows back)
    const choppable = trees.map((t) => ({ x: t.x, z: t.z, wood: TREE_WOOD, hits: 0, growAt: 0, hitAt: -1 }));
    // (the houses, shops included: out of their reach at night the player carries a lantern)
    const houses = buildings.map((b) => ({ x: b.x, z: b.z, radius: b.radius }));
    return { nav, places, trees: choppable, buildings: houses, props: buildProps(places) };
  };

  // ── Props: the shops, campfire, jail cell, fields ──
  const groundAt = (x, z, fallback = 0) => {
    const y = ctx.getGroundY(x, z);
    return Number.isFinite(y) ? y : fallback;
  };
  const buildProps = (places) => {
    const group = new THREE.Group();
    // The shops (townStalls.js; async GLBs): the rooms, far off the island; over each shop's
    // door outside, its sign
    for (const [key, label, sign] of [['goods', '🧺 Goods', '🧺 Goods Shop'], ['gear', '⚔️ Weapons', '⚔️ Weapon Shop']]) {
      T.stalls.build(group, { key, label, keeper: key === 'gear' });
      const { door, exitYaw } = places.shops[key];
      // (a little out from the door, away from the house)
      const signSprite = makeTextSprite(sign, { height: 0.34 });
      signSprite.position.set(door.x + Math.sin(exitYaw) * 0.3, groundAt(door.x, door.z) + 2.5, door.z + Math.cos(exitYaw) * 0.3);
      group.add(signSprite);
    }
    // Campfire
    const fire = makeCampfire();
    fire.group.position.set(places.fire.x, groundAt(places.fire.x, places.fire.z), places.fire.z);
    group.add(fire.group);
    // …with a cooking pot over it (townCooking.js)
    const cookPot = T.makeCookPot();
    cookPot.position.copy(fire.group.position);
    group.add(cookPot);
    // Jail: an iron cage with a door that swings open
    const jailRoot = new THREE.Group();
    jailRoot.position.set(places.jail.x, groundAt(places.jail.x, places.jail.z), places.jail.z);
    jailRoot.rotation.y = places.jailYaw;
    const iron = new THREE.MeshStandardMaterial({ color: 0x2f2f35, roughness: 0.6, metalness: 0.3 });
    const wood = new THREE.MeshStandardMaterial({ color: 0x6b4a2b, roughness: 1, metalness: 0 });
    const barGeo = new THREE.CylinderGeometry(0.025, 0.025, 2, 6);
    barGeo.translate(0, 1, 0);
    const half = 1.1;
    const addBars = (parent, from, to, count) => {
      for (let k = 0; k <= count; k++) {
        const bar = new THREE.Mesh(barGeo, iron);
        bar.position.lerpVectors(from, to, k / count);
        bar.castShadow = true;
        parent.add(bar);
      }
    };
    addBars(jailRoot, new THREE.Vector3(-half, 0, -half), new THREE.Vector3(half, 0, -half), 10);
    addBars(jailRoot, new THREE.Vector3(-half, 0, -half), new THREE.Vector3(-half, 0, half), 10);
    addBars(jailRoot, new THREE.Vector3(half, 0, -half), new THREE.Vector3(half, 0, half), 10);
    const door = new THREE.Group();
    door.position.set(-half, 0, half); // hinge
    addBars(door, new THREE.Vector3(0, 0, 0), new THREE.Vector3(half * 2, 0, 0), 10);
    jailRoot.add(door);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(half * 2 + 0.3, 0.12, half * 2 + 0.3), wood);
    roof.position.y = 2.06;
    roof.castShadow = true;
    jailRoot.add(roof);
    const sign = makeTextSprite('⭐ Sheriff · Jail', { height: 0.32 });
    sign.position.set(0, 2.55, 0);
    jailRoot.add(sign);
    group.add(jailRoot);
    // Fields: rows of crops on dark soil
    const soilMat = new THREE.MeshStandardMaterial({ color: 0x4a3420, roughness: 1, metalness: 0 });
    const cropMat = new THREE.MeshStandardMaterial({ color: 0x5f9e3a, roughness: 1, metalness: 0 });
    const soilGeo = new THREE.BoxGeometry(3.6, 0.08, 0.5);
    const cropGeo = new THREE.ConeGeometry(0.13, 0.32, 5);
    cropGeo.translate(0, 0.16, 0);
    for (const f of places.fields) {
      f.crops = []; // { mesh, x, z, ripe, growAt } — picked by the player (townMode pick)
      for (let r = -1; r <= 1; r++) {
        const rz = f.z + r * 1.1;
        const soil = new THREE.Mesh(soilGeo, soilMat);
        soil.position.set(f.x, groundAt(f.x, rz) + 0.02, rz);
        soil.receiveShadow = true;
        group.add(soil);
        for (let c = -2; c <= 2; c++) {
          const cx = f.x + c * 0.75;
          const crop = new THREE.Mesh(cropGeo, cropMat);
          crop.position.set(cx, groundAt(cx, rz) + 0.04, rz);
          crop.rotation.y = c * 1.3 + r;
          crop.castShadow = true;
          group.add(crop);
          f.crops.push({ mesh: crop, x: cx, z: rz, ripe: true, growAt: 0 });
        }
      }
    }
    // The bandit camp: a ragged tent, a fire, the stolen strongbox
    const cloth = new THREE.MeshStandardMaterial({ color: 0x6d5a44, roughness: 1, metalness: 0, side: THREE.DoubleSide });
    const tent = new THREE.Mesh(new THREE.ConeGeometry(1.3, 1.7, 4, 1, true), cloth);
    tent.position.set(places.camp.x, groundAt(places.camp.x, places.camp.z) + 0.85, places.camp.z);
    tent.rotation.y = Math.PI / 4;
    tent.castShadow = true;
    group.add(tent);
    const campFire = makeCampfire();
    campFire.group.position.set(places.campFire.x, groundAt(places.campFire.x, places.campFire.z), places.campFire.z);
    group.add(campFire.group);
    const strongbox = new THREE.Group();
    const boxBody = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.36, 0.38), new THREE.MeshStandardMaterial({ color: 0x7a5230, roughness: 0.9, metalness: 0 }));
    boxBody.position.y = 0.18;
    const boxBand = new THREE.Mesh(new THREE.BoxGeometry(0.57, 0.06, 0.4), iron);
    boxBand.position.y = 0.3;
    strongbox.add(boxBody, boxBand);
    strongbox.position.set(places.strongbox.x, groundAt(places.strongbox.x, places.strongbox.z), places.strongbox.z);
    strongbox.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    group.add(strongbox);
    // The fishing spot: a signpost on the bank
    if (places.fishSpot) {
      const fs = places.fishSpot;
      const away = Math.atan2(fs.x - fs.face.x, fs.z - fs.face.z); // (from the water, inland)
      const px = fs.x + Math.sin(away) * 0.9;
      const pz = fs.z + Math.cos(away) * 0.9;
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.5, 0.1), wood);
      post.position.set(px, groundAt(px, pz) + 0.75, pz);
      post.castShadow = true;
      group.add(post);
      const fishSign = makeTextSprite('🎣 Fishing spot', { height: 0.26 });
      fishSign.position.set(px, groundAt(px, pz) + 1.75, pz);
      group.add(fishSign);
    }
    const campSign = makeTextSprite('💀 Bandit camp', { height: 0.28 });
    campSign.position.set(places.camp.x, groundAt(places.camp.x, places.camp.z) + 2.3, places.camp.z);
    group.add(campSign);
    return { group, fire, door, campFire, strongbox, cookPot };
  };

  Object.assign(T, {
    buildLayout, groundAt,
  });
}

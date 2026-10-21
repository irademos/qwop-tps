// Town: the layout, built once from the map — the walkability grid (townNav.js), homes, the
// market, the campfire, the jail, fields, work spots, the patrol loop, the bandit camp — and its props.

import { MARKET_STALL_MERCHANT_Z, makeCampfire, makeTextSprite } from '../village/villageMode.js';
import * as THREE from 'three';
import { createTownNav } from './townNav.js';
import {
  BUILDING_RE, CAMP_DIST, NAV_BOUNDS, NAV_CELL, NAV_START, STALL_GAP, TOWN_BOUNDS, TREE_RE,
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

    // Market: the most open spot off the road among the houses; the campfire a little way off;
    // the jail by a road further out
    const offRoad = (i) => nav.kindAt(i) !== 2;
    const marketCell = best(nav.cellsWhere((i) => offRoad(i) && dC(i) < 18 && nav.clearanceAt(i) >= 2.5),
      (i) => nav.clearanceAt(i) * 2 - dC(i) * 0.2);
    const market = marketCell >= 0 ? cellPos(marketCell) : { ...NAV_START };
    const fireCell = best(nav.cellsWhere((i) => {
      const d = dist2(nav.cellX(i), nav.cellZ(i), market.x, market.z);
      return offRoad(i) && d > 6 && d < 13 && nav.clearanceAt(i) >= 2.5;
    }), (i) => nav.clearanceAt(i) - dC(i) * 0.1);
    const fire = fireCell >= 0 ? cellPos(fireCell) : { x: market.x + 6, z: market.z };
    const jailCell = best(nav.cellsWhere((i) => {
      const x = nav.cellX(i);
      const z = nav.cellZ(i);
      return offRoad(i) && dist2(x, z, market.x, market.z) > 14 && dist2(x, z, fire.x, fire.z) > 12 && dC(i) < 32
        && nav.clearanceAt(i) >= 2.5 && nearRoad(i, 4);
    }), (i) => nav.clearanceAt(i) - dC(i) * 0.05);
    const jailPos = jailCell >= 0 ? cellPos(jailCell) : { x: market.x - 10, z: market.z };

    // The stall faces the campfire; the jail's door faces the nearest road
    const stallYaw = Math.atan2(fire.x - market.x, fire.z - market.z);
    const fwd = { x: Math.sin(stallYaw), z: Math.cos(stallYaw) };
    const merchantSpot = { x: market.x + fwd.x * MARKET_STALL_MERCHANT_Z, z: market.z + fwd.z * MARKET_STALL_MERCHANT_Z };
    // The weapon stall stands beside the goods stall (the side with more room), its chest
    // on the far side of it
    const stallSide = { x: fwd.z, z: -fwd.x }; // (the customer's right)
    const gearRoom = (sign) => {
      const i = nav.indexAt(market.x + stallSide.x * sign * (STALL_GAP + 0.8), market.z + stallSide.z * sign * (STALL_GAP + 0.8));
      return i >= 0 && nav.walkableIndex(i) ? nav.clearanceAt(i) : -1;
    };
    const gearSign = gearRoom(-1) > gearRoom(1) ? -1 : 1;
    const gearStall = { x: market.x + stallSide.x * gearSign * STALL_GAP, z: market.z + stallSide.z * gearSign * STALL_GAP };
    const customerSpot = { x: market.x + fwd.x * 1.4, z: market.z + fwd.z * 1.4 };
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

    nav.block(market.x + fwd.x * 0.2, market.z + fwd.z * 0.2, 0.9);
    nav.block(gearStall.x + fwd.x * 0.2, gearStall.z + fwd.z * 0.2, 0.9);
    nav.block(gearStall.x + stallSide.x * gearSign * 1.45, gearStall.z + stallSide.z * gearSign * 1.45, 0.45);
    nav.block(fire.x, fire.z, 0.9);
    nav.block(jailPos.x, jailPos.z, 1.7);
    nav.refresh();

    // Homes: a walkable spot by each house
    const homes = [];
    for (const b of buildings) {
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
      center: C, market, gearStall, gearSign, merchantSpot, customerSpot, stallYaw, fire, jail: jailPos, jailYaw, officeSpot,
      homes, treeSpots, fields, shore, fishSpot, patrol, entrance, camp, campFire, strongbox,
      // the player arrives between the market and the fire
      spawn: { x: (market.x + fire.x) / 2 + fwd.z * 2.2, z: (market.z + fire.z) / 2 - fwd.x * 2.2 },
    };
    // Every tree in town can be chopped (wood: what it has left; it grows back)
    const choppable = trees.map((t) => ({ x: t.x, z: t.z, wood: TREE_WOOD, hits: 0, growAt: 0, hitAt: -1 }));
    return { nav, places, trees: choppable, props: buildProps(places) };
  };

  // ── Props: market stalls, campfire, jail cell, fields ──
  const groundAt = (x, z, fallback = 0) => {
    const y = ctx.getGroundY(x, z);
    return Number.isFinite(y) ? y : fallback;
  };
  const buildProps = (places) => {
    const group = new THREE.Group();
    // Market stalls (townStalls.js; async GLBs)
    for (const [key, at, label] of [['goods', places.market, '🧺 Goods'], ['gear', places.gearStall, '⚔️ Weapons']]) {
      T.stalls.build(group, {
        key, label, x: at.x, y: groundAt(at.x, at.z) - 0.005, z: at.z, yaw: places.stallYaw,
        chestSign: places.gearSign, keeper: key === 'gear', groundAt: (x, z) => groundAt(x, z),
      });
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

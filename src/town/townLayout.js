// Town: the layout, built once from the map — the walkability grid (townNav.js), the shop and the
// jail (two of the houses) and the homes (the rest; each house with a known door opens into a
// room — townRooms.js), the campfire, fields, the allotment's farm plots (townFarming.js), work
// spots, the patrol loop, the wizard's stall in the woods, the bandit camp — and its props.

import { makeCampfire, makeTextSprite } from '../village/villageMode.js';
import * as THREE from 'three';
import { createTownNav } from './townNav.js';
import {
  BUILDING_RE, CAMP_DIST, DOOR_ENTER_DIST, HOUSE_DOORS, HOUSE_DOOR_MAX_OUT, HOUSE_DOOR_OUT, HOUSE_DOOR_STEP, NAV_BOUNDS, NAV_CELL, NAV_START, TOWN_BOUNDS, TREE_RE,
  TREE_TRUNK_RADIUS, TREE_WOOD, WIZARD_HUT_DIST, WIZARD_STALL_DIST, dist2,
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
    const woods = ctx.getMapObjects(NAV_BOUNDS).filter((t) => TREE_RE.test(t.file));
    for (const t of woods) nav.block(t.x, t.z, TREE_TRUNK_RADIUS);
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

    // The shop: the house nearest the middle whose model's front door is known (HOUSE_DOORS),
    // the jail the nearest other house of the same model (nobody lives in either); the campfire
    // a little way off the shop
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
      let wall;
      let normal;
      if (spec.point) {
        wall = new THREE.Vector3(mx + spec.point[0] * hx, 0, mz + spec.point[1] * hz);
        normal = new THREE.Vector3(spec.normal[0], 0, spec.normal[1]).normalize();
      } else {
        const axisX = spec.side.endsWith('x');
        const sign = spec.side[0] === '-' ? -1 : 1;
        const inset = 1 - (spec.inset ?? 0);
        wall = axisX
          ? new THREE.Vector3(mx + sign * hx * inset, 0, mz + spec.at * hz)
          : new THREE.Vector3(mx + spec.at * hx, 0, mz + sign * hz * inset);
        normal = axisX ? new THREE.Vector3(sign, 0, 0) : new THREE.Vector3(0, 0, sign);
      }
      wall.applyMatrix4(b.matrix);
      normal.transformDirection(b.matrix).setY(0).normalize();
      // (the ground straight out from the door: the height ray lands on a roof overhang there,
      // so the spot is the first one out on the ground — a porch step or two up at most)
      const out = [];
      const first = spec.out ?? HOUSE_DOOR_OUT;
      for (let d = first; d <= Math.max(first, HOUSE_DOOR_MAX_OUT) + 1e-6; d += 0.1) {
        out.push({ d, y: groundAt(wall.x + normal.x * d, wall.z + normal.z * d, NaN) });
      }
      const low = Math.min(...out.map((o) => o.y).filter(Number.isFinite));
      const spot = Number.isFinite(low) ? out.find((o) => o.y <= low + HOUSE_DOOR_STEP) : null;
      const d = spot?.d ?? first;
      const door = { x: wall.x + normal.x * d, z: wall.z + normal.z * d };
      // (townsfolk walk the last bit onto it from the grid)
      const i = nav.nearestWalkable(door.x, door.z);
      if (i < 0 || dist2(nav.cellX(i), nav.cellZ(i), door.x, door.z) > 2) return null;
      // (doorway: the door itself, in the wall — where its marker stands)
      const doorway = { x: wall.x + normal.x * 0.08, z: wall.z + normal.z * 0.08 };
      return { door, doorway, out: d, exitYaw: Math.atan2(normal.x, normal.z), enterDist: spec.enter ?? null };
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
    // Every room a door opens into (townRooms.js): the shop and the jail, then the homes below
    const rooms = {};
    const shops = {};
    ['shop', 'jail'].forEach((key, k) => {
      // (a door on an open spot: walked into within DOOR_ENTER_DIST of it)
      const { building, door, doorway, out = 0, exitYaw, enterDist = DOOR_ENTER_DIST } = shopHouses[k];
      shops[key] = { key, kind: key, building, door, doorway, out, exitYaw, enterDist };
      rooms[key] = shops[key];
    });
    const market = shops.shop.door;
    const jailDoor = shops.jail.door;
    const fireCell = best(nav.cellsWhere((i) => {
      const d = dist2(nav.cellX(i), nav.cellZ(i), market.x, market.z);
      return offRoad(i) && d > 6 && d < 13 && nav.clearanceAt(i) >= 2.5
        && dist2(nav.cellX(i), nav.cellZ(i), jailDoor.x, jailDoor.z) > 4;
    }), (i) => nav.clearanceAt(i) - dC(i) * 0.1);
    const fire = fireCell >= 0 ? cellPos(fireCell) : { x: market.x + 6, z: market.z };

    // Inside the shop: the merchant behind the back counter, customers in front of it
    const merchantSpot = T.stalls.spot('shop', 'merchant');
    const customerSpot = T.stalls.spot('shop', 'customer');
    // Inside the jail: the cell (the prisoner faces out of it: +Z, yaw 0), the sheriff's desk
    const { cell: jailPos, office: officeSpot } = T.rooms.jailSpots();
    const jailYaw = 0;

    nav.block(fire.x, fire.z, 0.9);
    nav.refresh();

    // Homes: a walkable spot by each house (not the shops); a house whose front door is known
    // opens into a room of its own ('home<i>' — its townsfolk sleep in there)
    const homes = [];
    for (const b of buildings) {
      if (shopHouses.some((h) => h.building === b)) continue;
      const i = nav.nearestWalkable(b.x, b.z);
      if (i < 0) continue;
      const d = dist2(nav.cellX(i), nav.cellZ(i), b.x, b.z);
      if (d > b.radius + 4) continue;
      const home = { x: nav.cellX(i), z: nav.cellZ(i), building: b, room: null };
      const door = doorOf(b);
      if (door) {
        home.room = `home${homes.length}`;
        T.rooms.add(home.room, 'home');
        rooms[home.room] = { key: home.room, kind: 'home', home: homes.length, building: b, ...door };
      }
      homes.push(home);
    }
    if (!homes.length) homes.push({ ...fire, room: null });

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
      if (dist2(p.x, p.z, market.x, market.z) < 12 || dist2(p.x, p.z, jailDoor.x, jailDoor.z) < 8) continue;
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
    // The allotment (townFarming.js): an open patch of grass by the first field (or near the
    // middle) — the farm plots round a water tap
    const anchor = fields[0] ?? C;
    const allotCell = best(nav.cellsWhere((i) => {
      const x = nav.cellX(i);
      const z = nav.cellZ(i);
      const d = dist2(x, z, anchor.x, anchor.z);
      return offRoad(i) && nav.clearanceAt(i) >= 3.5 && dC(i) < 46 && d < 30 && (fields.length ? d > 7.5 : d > 10)
        && fields.every((f) => dist2(x, z, f.x, f.z) > 7.5) && dist2(x, z, market.x, market.z) > 12
        && dist2(x, z, jailDoor.x, jailDoor.z) > 8 && dist2(x, z, fire.x, fire.z) > 9;
    }), (i) => Math.min(nav.clearanceAt(i), 6) - dist2(nav.cellX(i), nav.cellZ(i), anchor.x, anchor.z) * 0.12);
    const allotment = allotCell >= 0 ? T.layoutAllotment(cellPos(allotCell)) : null;
    // Patrol: road spots spread around the middle (farthest-point picks), walked in a loop
    // (from the jail's door)
    const roadCells = nav.cellsWhere((i) => nav.kindAt(i) === 2 && dC(i) < 34);
    const patrol = [{ ...jailDoor }];
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

    // The wizard's stall: out in the woods — the open spot with the most trees round it, well away
    // from the houses and the bandit camp — its front to the most open side; his tent behind it
    const treesNear = (x, z, r) => {
      let k = 0;
      for (const t of woods) if (Math.abs(t.x - x) < r && Math.abs(t.z - z) < r && dist2(t.x, t.z, x, z) < r) k += 1;
      return k;
    };
    const wizCells = nav.cellsWhere((i) => {
      const d = dC(i);
      const x = nav.cellX(i);
      const z = nav.cellZ(i);
      return d >= WIZARD_STALL_DIST[0] && d <= WIZARD_STALL_DIST[1] && offRoad(i) && nav.clearanceAt(i) >= 2.5
        && dist2(x, z, camp.x, camp.z) > 40 && buildings.every((b) => dist2(x, z, b.x, b.z) > b.radius + 10);
    });
    let wizCell = best(wizCells.filter((i, k) => k % 2 === 0), (i) => treesNear(nav.cellX(i), nav.cellZ(i), 11)
      + Math.min(nav.clearanceAt(i), 5) * 0.4 - Math.abs(dC(i) - 45) * 0.03);
    if (wizCell < 0) wizCell = best(nav.cellsWhere((i) => offRoad(i) && nav.clearanceAt(i) >= 2 && dC(i) > 20 && dC(i) < 60), (i) => -Math.abs(dC(i) - 35));
    const wizPos = wizCell >= 0 ? cellPos(wizCell) : { x: C.x + 30, z: C.z };
    let wizYaw = Math.atan2(C.x - wizPos.x, C.z - wizPos.z);
    {
      let bestOpen = -Infinity;
      for (let k = 0; k < 8; k++) {
        const yaw = wizYaw + k * Math.PI / 4;
        const j = nav.indexAt(wizPos.x + Math.sin(yaw) * 1.6, wizPos.z + Math.cos(yaw) * 1.6);
        const open = j >= 0 && nav.walkableIndex(j) ? nav.clearanceAt(j) - k * 0.05 : -1;
        if (open > bestOpen) { bestOpen = open; wizYaw = yaw; }
      }
    }
    const wizard = { x: wizPos.x, z: wizPos.z, yaw: wizYaw };
    T.stalls.setOutdoor('wizard', { ...wizard, y: groundAt(wizPos.x, wizPos.z) });
    const hutAt = {
      x: wizPos.x - Math.sin(wizYaw) * WIZARD_HUT_DIST + Math.cos(wizYaw) * 1.5,
      z: wizPos.z - Math.cos(wizYaw) * WIZARD_HUT_DIST - Math.sin(wizYaw) * 1.5,
    };
    const hutCell = nav.nearestWalkable(hutAt.x, hutAt.z);
    wizard.hut = hutCell >= 0 && dist2(nav.cellX(hutCell), nav.cellZ(hutCell), hutAt.x, hutAt.z) < 3 ? cellPos(hutCell) : { ...wizPos };
    wizard.keeper = T.stalls.spot('wizard', 'merchant');
    wizard.customer = T.stalls.spot('wizard', 'customer');

    // The fishing spot (one for now): the shore spot nearest the middle — the first fisher's too
    const fishSpot = shore[0] ?? null;
    const places = {
      center: C, market, shops, rooms, merchantSpot, customerSpot, fire, jail: jailPos, jailYaw, officeSpot,
      homes, treeSpots, fields, allotment, shore, fishSpot, patrol, entrance, camp, campFire, strongbox, wizard,
      // the player arrives between the shop and the fire
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
    // The rooms (townRooms.js; async GLBs), under the map: the homes', the jail's, then the shop's
    // with its counters (townStalls.js); over the shop's / the jail's door outside, its sign
    for (const key of Object.keys(places.rooms)) if (places.rooms[key].kind === 'home') T.rooms.build(group, key);
    T.rooms.build(group, 'jail');
    T.stalls.build(group, { key: 'shop', label: '🛒 Shop' });
    for (const [key, text] of [['shop', '🛒 Shop'], ['jail', '⭐ Sheriff · Jail']]) {
      const { door, exitYaw } = places.shops[key];
      // (a little out from the door, away from the house)
      const signSprite = makeTextSprite(text, { height: 0.34 });
      signSprite.position.set(door.x + Math.sin(exitYaw) * 0.3, groundAt(door.x, door.z) + 2.5, door.z + Math.cos(exitYaw) * 0.3);
      group.add(signSprite);
    }
    // A faint gold pane standing in each house's doorway (the shop, the jail, homes): where to walk in
    const paneGeo = new THREE.PlaneGeometry(0.9, 1.8).translate(0, 0.9, 0);
    const paneMat = new THREE.MeshBasicMaterial({
      color: 0xffd36b, transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide,
    });
    for (const r of Object.values(places.rooms)) {
      if (!r.building || !r.doorway) continue;
      const pane = new THREE.Mesh(paneGeo, paneMat);
      // (standing on the ground at the door spot — the ray at the doorway itself hits the roof)
      pane.position.set(r.doorway.x, groundAt(r.door.x, r.door.z), r.doorway.z);
      pane.rotation.y = r.exitYaw;
      pane.renderOrder = 1;
      group.add(pane);
    }
    // Campfire
    const fire = makeCampfire();
    fire.group.position.set(places.fire.x, groundAt(places.fire.x, places.fire.z), places.fire.z);
    group.add(fire.group);
    // …with a cooking pot over it (townCooking.js)
    const cookPot = T.makeCookPot();
    cookPot.position.copy(fire.group.position);
    group.add(cookPot);
    // The jail's cell door (townRooms.js builds the cell): swung open / shut in townMode.js
    const door = T.rooms.cellDoor();
    const iron = new THREE.MeshStandardMaterial({ color: 0x2f2f35, roughness: 0.6, metalness: 0.3 });
    const wood = new THREE.MeshStandardMaterial({ color: 0x6b4a2b, roughness: 1, metalness: 0 });
    // The wizard's stall (townStalls.js) and his tent behind it
    T.stalls.buildOutdoor(group, { key: 'wizard', label: '🔮 Wizard' });
    const robe = new THREE.MeshStandardMaterial({ color: 0x4b2f7a, roughness: 1, metalness: 0, side: THREE.DoubleSide });
    const hut = places.wizard.hut;
    const wizTent = new THREE.Mesh(new THREE.ConeGeometry(1.2, 1.9, 6, 1, true), robe);
    wizTent.position.set(hut.x, groundAt(hut.x, hut.z) + 0.95, hut.z);
    wizTent.castShadow = true;
    group.add(wizTent);
    const star = makeTextSprite('✨', { height: 0.3, size: 96, bg: null, pad: 10 });
    star.position.set(hut.x, groundAt(hut.x, hut.z) + 2.1, hut.z);
    group.add(star);
    // The allotment's plots and its tap / hose (townFarming.js)
    if (places.allotment) T.buildFarm(group, places.allotment);
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
    return { group, fire, door, campFire, strongbox, cookPot, wizTent };
  };

  Object.assign(T, {
    buildLayout, groundAt,
  });
}

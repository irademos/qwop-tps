// Town: the layout, built once from the map — the walkability grid (townNav.js), the shop and the
// jail (two of the houses) and the homes (the rest; each house with a known door opens into a
// room — townRooms.js), the campfire, fields (the player can buy them — townFarming.js), the hose's tap, work
// spots, the patrol loop, the market stalls outside the shop, the wizard's stall in the woods, the
// bandit camp — and its props.

import { makeCampfire, makeTextSprite } from '../village/villageMode.js';
import * as THREE from 'three';
import { createTownNav } from './townNav.js';
import { createDriveGrid } from './townDrive.js';
import { createVeg } from '../items/vegModels.js';

const VEG_CROP_LENGTH = 0.24; // m, the longest side of a field crop's vegetable
import {
  BUILDING_RE, CABIN_RE, CAMP_DIST, DOOR_ENTER_DIST, HOUSE_DOORS, HOUSE_DOOR_MAX_OUT, HOUSE_DOOR_OUT, HOUSE_DOOR_STEP, NAV_BOUNDS, NAV_CELL, NAV_START, STUMP_RE, TOWN_BOUNDS, TREE_RE,
  TREE_TRUNK_RADIUS, WIZARD_CABIN_STALL, WIZARD_HUT_DIST, WIZARD_STALL_DIST, dist2,
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
    const trees = objects.filter((o) => TREE_RE.test(o.file) && !STUMP_RE.test(o.file));
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
    // The market stalls (townMarket.js): two, one either side of the shop's door, a little out
    // from the house, facing the road in front of it (the way out of the door) — the stall
    // itself off the road / trail (its customers stand at the road's edge), clear of the doors
    const shopDoor = shops.shop.door;
    const outYaw = shops.shop.exitYaw;
    const out = { x: Math.sin(outYaw), z: Math.cos(outYaw) };
    const side = { x: Math.cos(outYaw), z: -Math.sin(outYaw) };
    const at = (x, z, a, b) => ({ x: x + out.x * a + side.x * b, z: z + out.z * a + side.z * b });
    const cellOk = (p, offRoadToo) => {
      const i = nav.indexAt(p.x, p.z);
      return i >= 0 && nav.walkableIndex(i) && (!offRoadToo || nav.kindAt(i) === 0);
    };
    const fits = (c, strict) => {
      // (its footprint: ±0.8 m across, ±0.5 m front to back; behind it the keeper, in front the customer)
      for (const [a, b] of [[0, 0], [0.5, 0.8], [0.5, -0.8], [-0.5, 0.8], [-0.5, -0.8]]) if (!cellOk(at(c.x, c.z, a, b), strict)) return false;
      if (!cellOk(at(c.x, c.z, -0.8, 0)) || !cellOk(at(c.x, c.z, 1.3, 0))) return false;
      return Object.values(rooms).every((r) => !r.door || dist2(c.x, c.z, r.door.x, r.door.z) > 2.2)
        && homes.every((h) => dist2(c.x, c.z, h.x, h.z) > 1.5);
    };
    const marketStalls = [];
    for (const sgn of [-1, 1]) {
      let found = null;
      for (const strict of [true, false]) {
        for (let b = 2.6; b <= 7.5 && !found; b += 0.4) {
          for (let a = 0.4; a <= 3.6 && !found; a += 0.4) {
            const c = at(shopDoor.x, shopDoor.z, a, b * sgn);
            if (fits(c, strict)) found = c;
          }
        }
        if (found) break;
      }
      if (found) marketStalls.push({ key: `mkt${marketStalls.length}`, x: found.x, z: found.z, yaw: outYaw });
    }
    for (const st of marketStalls) {
      T.stalls.setOutdoor(st.key, { x: st.x, z: st.z, yaw: st.yaw, y: groundAt(st.x, st.z) });
      st.keeper = T.stalls.spot(st.key, 'merchant');
      st.customer = T.stalls.spot(st.key, 'customer');
      nav.block(st.x, st.z, 0.55);
    }
    nav.refresh();

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
    // The hose's water tap (townFarming.js): an open patch of grass by the first field (or near
    // the middle)
    const anchor = fields[0] ?? C;
    const tapCell = best(nav.cellsWhere((i) => {
      const x = nav.cellX(i);
      const z = nav.cellZ(i);
      const d = dist2(x, z, anchor.x, anchor.z);
      return offRoad(i) && nav.clearanceAt(i) >= 2 && dC(i) < 46 && d < 20 && d > 4
        && fields.every((f) => dist2(x, z, f.x, f.z) > 4) && dist2(x, z, market.x, market.z) > 12
        && dist2(x, z, jailDoor.x, jailDoor.z) > 8 && dist2(x, z, fire.x, fire.z) > 9;
    }), (i) => Math.min(nav.clearanceAt(i), 6) - dist2(nav.cellX(i), nav.cellZ(i), anchor.x, anchor.z) * 0.12);
    const tap = tapCell >= 0 ? cellPos(tapCell) : null;
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
    nav.block(camp.x, camp.z, 1.2);
    nav.block(campFire.x, campFire.z, 0.8);
    nav.refresh();

    // (the cabin: its front the side the drive route from the arrival spot comes up to; the
    // stall WIZARD_CABIN_STALL m out past its walls — null if there's no level ground there)
    function wizardAtCabin(b) {
      const spawnAt = nav.nearestWalkable((market.x + fire.x) / 2, (market.z + fire.z) / 2);
      const from = spawnAt >= 0 ? cellPos(spawnAt) : market;
      const r = b.radius + WIZARD_CABIN_STALL;
      const route = drive.route(from, { x: b.x, z: b.z, r: r + 1.5 });
      const base = Math.min(...Array.from({ length: 16 }, (_, k) => groundAt(b.x + Math.sin(k * Math.PI / 8) * r, b.z + Math.cos(k * Math.PI / 8) * r, Infinity)));
      if (!Number.isFinite(base)) return null;
      // (the way out: toward the route's end, else the flattest side)
      const yaw0 = route ? Math.atan2(route[route.length - 1].x - b.x, route[route.length - 1].z - b.z) : 0;
      let yaw = yaw0;
      let bestFlat = Infinity;
      for (let k = 0; k < 16; k++) {
        const a = yaw0 + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * (Math.PI / 8);
        const x = b.x + Math.sin(a) * r;
        const z = b.z + Math.cos(a) * r;
        const y = groundAt(x, z, NaN);
        let rough = 0;
        for (const [dx, dz] of [[1.5, 0], [-1.5, 0], [0, 1.5], [0, -1.5]]) rough = Math.max(rough, Math.abs(groundAt(x + dx, z + dz, Infinity) - y));
        const score = rough + Math.abs(y - base) * 0.3 + Math.ceil(k / 2) * 0.12;
        if (Number.isFinite(score) && score < bestFlat) { bestFlat = score; yaw = a; }
        if (k === 0 && route && rough < 0.6) break;
      }
      const x = b.x + Math.sin(yaw) * r;
      const z = b.z + Math.cos(yaw) * r;
      // (his patch of the grid, from just out of the stall's way)
      nav.addStart(x + Math.sin(yaw) * 2, z + Math.cos(yaw) * 2);
      nav.refresh();
      const door = { x: b.x + Math.sin(yaw) * (b.radius + 0.8), z: b.z + Math.cos(yaw) * (b.radius + 0.8) };
      return { x, z, yaw, hutAt: door, cabin: { x: b.x, z: b.z, radius: b.radius } };
    }
    // The wizard's stall out in the woods: the open spot with the most trees round it, well away
    // from the houses and the bandit camp — its front to the most open side; his tent behind it
    function wizardInWoods() {
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
      return {
        x: wizPos.x, z: wizPos.z, yaw: wizYaw, tent: true,
        hutAt: {
          x: wizPos.x - Math.sin(wizYaw) * WIZARD_HUT_DIST + Math.cos(wizYaw) * 1.5,
          z: wizPos.z - Math.cos(wizYaw) * WIZARD_HUT_DIST - Math.sin(wizYaw) * 1.5,
        },
      };
    }
    // The drive grid (townDrive.js): cart routes over any ground the cart takes — up the mountain
    const driveArgs = {
      bounds: NAV_BOUNDS, getGroundY: ctx.getGroundY, waterDepth: ctx.waterDepth,
      trees: woods.filter((t) => !STUMP_RE.test(t.file)),
      // (the houses — their walls and porch posts: most of the bounds' circle — and the smaller
      // things placed round the map: lamp posts…; not the bridges / docks — driven over)
      props: ctx.getMapObjects(NAV_BOUNDS).filter((o) => !TREE_RE.test(o.file) && !/bridge|dock/i.test(o.file))
        .map((o) => ({ x: o.x, z: o.z, r: BUILDING_RE.test(o.file) ? o.radius * 0.9 : Math.min(o.radius, 1.2) })),
    };
    const drive = createDriveGrid(driveArgs);
    T.driveGridArgs = driveArgs; // (dev console: T.createDriveGrid({ ...T.driveGridArgs, maxSlope… }))
    // The wizard lives up the mountain, at the cabin there (the map's cabin.glb): his stall in
    // front of it, facing the way the cart road comes up (the drive route's end), and he sleeps
    // by its door; the patch round it is walked about on its own (nav.addStart — no walk joins
    // it to the town). A map with no cabin: out in the woods, as before (wizardInWoods)
    const cabin = ctx.getMapObjects(NAV_BOUNDS).find((o) => CABIN_RE.test(o.file)) ?? null;
    const wizard = (cabin && wizardAtCabin(cabin)) || wizardInWoods();
    T.stalls.setOutdoor('wizard', { x: wizard.x, z: wizard.z, yaw: wizard.yaw, y: groundAt(wizard.x, wizard.z) });
    nav.block(wizard.x, wizard.z, 0.55); // (solid, like the market stalls)
    nav.refresh();
    {
      const hutCell = nav.nearestWalkable(wizard.hutAt.x, wizard.hutAt.z);
      wizard.hut = hutCell >= 0 && dist2(nav.cellX(hutCell), nav.cellZ(hutCell), wizard.hutAt.x, wizard.hutAt.z) < 3 ? cellPos(hutCell) : { x: wizard.x, z: wizard.z };
    }
    wizard.keeper = T.stalls.spot('wizard', 'merchant');
    wizard.customer = T.stalls.spot('wizard', 'customer');

    // The fishing spot (one for now): the shore spot nearest the middle — the first fisher's too
    const fishSpot = shore[0] ?? null;
    const places = {
      center: C, market, marketStalls, shops, rooms, merchantSpot, customerSpot, fire, jail: jailPos, jailYaw, officeSpot,
      homes, treeSpots, fields, tap, shore, fishSpot, patrol, entrance, camp, campFire, wizard,
      // the player arrives between the shop and the fire
      spawn: (() => {
        const i = nav.nearestWalkable((market.x + fire.x) / 2, (market.z + fire.z) / 2);
        return i >= 0 ? cellPos(i) : { ...fire };
      })(),
    };
    // Every tree in town can be chopped down (townTrees.js; it grows back)
    const choppable = trees.map((t) => ({ x: t.x, z: t.z, id: t.id, object: t.object }));
    // (the houses, shops included: out of their reach at night the player carries a lantern)
    const houses = buildings.map((b) => ({ x: b.x, z: b.z, radius: b.radius }));
    const props = buildProps(places);
    // (the felled trees' stumps: the pack's own stump model, wherever it was placed)
    const stump = ctx.getMapObjects({ minX: -1e5, maxX: 1e5, minZ: -1e5, maxZ: 1e5 }).find((o) => STUMP_RE.test(o.file));
    T.buildTrees(props.group, choppable, stump?.object ?? null);
    return { nav, drive, places, trees: choppable, buildings: houses, props };
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
    T.stalls.build(group, { key: 'shop', label: 'Shop' });
    for (const [key, text] of [['shop', 'Shop'], ['jail', 'Sheriff · Jail']]) {
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
    const wood = new THREE.MeshStandardMaterial({ color: 0x6b4a2b, roughness: 1, metalness: 0 });
    // The market stalls outside the shop (townMarket.js — who's selling sets their sign / goods)
    for (const st of places.marketStalls) T.stalls.buildMarket(group, { key: st.key, label: 'Free stall' });
    // The wizard's stall (townStalls.js)
    T.stalls.buildOutdoor(group, { key: 'wizard', label: 'Wizard' });
    // (his tent — only out in the woods: up the mountain he has the cabin)
    const hut = places.wizard.hut;
    if (places.wizard.tent) {
      const robe = new THREE.MeshStandardMaterial({ color: 0x4b2f7a, roughness: 1, metalness: 0, side: THREE.DoubleSide });
      const wizTent = new THREE.Mesh(new THREE.ConeGeometry(1.2, 1.9, 6, 1, true), robe);
      wizTent.position.set(hut.x, groundAt(hut.x, hut.z) + 0.95, hut.z);
      wizTent.castShadow = true;
      group.add(wizTent);
    }
    const star = makeTextSprite('✨', { height: 0.3, size: 96, bg: null, pad: 10 });
    star.position.set(hut.x, groundAt(hut.x, hut.z) + 2.1, hut.z);
    group.add(star);
    // The hose's tap, the fields' for-sale signs (townFarming.js)
    T.buildFarm(group, places);
    // Fields: rows of crops on dark soil
    const soilMat = new THREE.MeshStandardMaterial({ color: 0x4a3420, roughness: 1, metalness: 0 });
    const cropMat = new THREE.MeshStandardMaterial({ color: 0x5f9e3a, roughness: 1, metalness: 0 });
    const soilGeo = new THREE.BoxGeometry(3.6, 0.08, 0.5);
    const cropGeo = new THREE.ConeGeometry(0.1, 0.26, 5);
    cropGeo.translate(0, 0.13, 0);
    for (const [fieldNo, f] of places.fields.entries()) {
      f.crops = []; // { mesh, x, z, ripe, growAt } — picked by the player (townMode pick)
      for (let r = -1; r <= 1; r++) {
        const rz = f.z + r * 1.1;
        const soil = new THREE.Mesh(soilGeo, soilMat);
        soil.position.set(f.x, groundAt(f.x, rz) + 0.02, rz);
        soil.receiveShadow = true;
        group.add(soil);
        for (let c = -2; c <= 2; c++) {
          const cx = f.x + c * 0.75;
          // A leafy tuft with its vegetable lying on the soil by it (vegetables.glb — a kind per
          // row of each field, picked by the field's spot)
          const crop = new THREE.Group();
          const leaves = new THREE.Mesh(cropGeo, cropMat);
          leaves.castShadow = true;
          const veg = createVeg(fieldNo * 3 + r + 1, VEG_CROP_LENGTH);
          veg.position.set(0.16, 0, 0.04);
          veg.rotation.y = 0.4 + c * 0.7;
          crop.add(leaves, veg);
          crop.position.set(cx, groundAt(cx, rz) + 0.04, rz);
          crop.rotation.y = c * 1.3 + r;
          group.add(crop);
          f.crops.push({ mesh: crop, x: cx, z: rz, ripe: true, growAt: 0 });
        }
      }
    }
    // The bandit camp: a ragged tent, a fire
    const cloth = new THREE.MeshStandardMaterial({ color: 0x6d5a44, roughness: 1, metalness: 0, side: THREE.DoubleSide });
    const tent = new THREE.Mesh(new THREE.ConeGeometry(1.3, 1.7, 4, 1, true), cloth);
    tent.position.set(places.camp.x, groundAt(places.camp.x, places.camp.z) + 0.85, places.camp.z);
    tent.rotation.y = Math.PI / 4;
    tent.castShadow = true;
    group.add(tent);
    const campFire = makeCampfire();
    campFire.group.position.set(places.campFire.x, groundAt(places.campFire.x, places.campFire.z), places.campFire.z);
    group.add(campFire.group);
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
      const fishSign = makeTextSprite('Fishing spot', { height: 0.26 });
      fishSign.position.set(px, groundAt(px, pz) + 1.75, pz);
      group.add(fishSign);
    }
    const campSign = makeTextSprite('Bandit camp', { height: 0.28 });
    campSign.position.set(places.camp.x, groundAt(places.camp.x, places.camp.z) + 2.3, places.camp.z);
    group.add(campSign);
    return { group, fire, door, campFire, cookPot };
  };

  Object.assign(T, {
    buildLayout, groundAt,
  });
}

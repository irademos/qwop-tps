// Town mode: the rooms the town's houses open into — two shops (shop.glb: walls on three sides,
// three counters; a front wall with the doorway and a ceiling added here) and every other house
// with a known door a home (home_interior.glb: the same room with its own front wall, ceiling,
// windows and a bed). Walking in through a house's door puts you in its room; each room sits far
// off the island under the seabed (ROOMS_ORIGIN, a grid ROOM_SPACING apart), out of sight, and
// only the room the player's in is drawn.
//
// Each room's floor is ground of its own (a terrain height override, while the town is active —
// it's under the map, so the map's own ground would win otherwise), the player is kept on it
// (constrainPlayer) and the follow camera inside its walls (clampCamera); townsfolk walk in and
// out through the doors (townFolk.js planPath — roomPath / doorInside here).
//
// Geometry, the rooms' shells, lights and day / night only: who goes in and out is townTrade.js
// (the player) / townFolk.js (townsfolk); what's on a shop's counters is townStalls.js.

import * as THREE from 'three';
import { loadHomeInterior, loadShopInterior } from '../village/villageMode.js';
import { registerTerrainHeightOverride } from '../environment/terrainHeight.js';
import { ROOMS_ORIGIN, ROOM_COLUMNS, ROOM_SPACING } from './townConfig.js';

// ── Room types (room-local metres: the middle of the floor at the origin, the doorway at +Z) ──
const MODEL_FLOOR_Y = -2.977;        // both models' floor (their units = metres)
// The shop's counters as boxes (from shop.glb): the side the customers stand on (facing), the
// yaw that turns a thing's front that way, the top
export const COUNTERS = {
  left: { x0: -2.528, x1: -1.701, z0: -1.801, z1: 3.028, top: 0.633, facing: [1, 0], yaw: Math.PI / 2 },
  right: { x0: 1.543, x1: 2.370, z0: -1.738, z1: 3.091, top: 0.624, facing: [-1, 0], yaw: -Math.PI / 2 },
  back: { x0: -2.202, x1: 1.969, z0: -3.543, z1: -2.717, top: 0.678, facing: [0, 1], yaw: 0 },
};
const BEHIND_Z = -3.95;              // behind the back counter (the shopkeeper)
const SIDE_GAP_X = -2.72;            // the way round the back counter (left end)
// The home's bed (from home_interior.glb), along x, its head by the left wall
const BED = { x0: -2.80, x1: -0.49, z0: -3.81, z1: -1.97, top: 0.55 };
// The chest in the back right corner (built here — a wooden box): what doesn't fit in the
// player's bag / wallet stays in there (townHomes.js); CHEST_FRONT = where to stand to open it
const CHEST = { x0: 1.85, x1: 2.85, z0: -4.4, z1: -3.7, top: 0.62 };
const CHEST_FRONT = { x: 2.35, z: -3.15 };
export const ROOM_TYPES = {
  shop: {
    load: loadShopInterior,
    halfW: 3.175, halfD: 4.613, height: 5.95,
    door: { x: 0, halfW: 0.65, h: 2.1, back: 0.08 },   // (back: the doorway's light, m behind the wall's inside)
    frontWall: true,                 // (shop.glb is open at the front: the wall + ceiling are built here)
    blocks: Object.values(COUNTERS),
    // (straight, or round the back counter's end to get behind it)
    route: (from, to) => {
      const behind = (z) => z < COUNTERS.back.z0;
      if (behind(from.z) === behind(to.z)) return [to];
      const gapFront = { x: SIDE_GAP_X, z: (COUNTERS.back.z1 + COUNTERS.left.z0) / 2 };
      const gapBack = { x: SIDE_GAP_X, z: BEHIND_Z };
      return behind(from.z) ? [gapBack, gapFront, to] : [gapFront, gapBack, to];
    },
  },
  home: {
    load: loadHomeInterior,
    halfW: 3.175, halfD: 4.613, height: 5.95,
    door: { x: 0.22, halfW: 0.86, h: 1.8, back: 0.03 },
    frontWall: false,
    blocks: [BED, CHEST],
    chest: CHEST,
    route: (from, to) => [to],
    // home_interior.glb's own dark plane behind the doorway (ours is lit day / night) and its
    // window panes, a sky behind each (node names as GLTFLoader leaves them: 'Plane.001' → 'Plane001')
    hide: /^Plane$/,
    windows: /^Plane\.?\d+$/,
  },
};
// Where a townsperson stands by the bed before turning in, and the sleepers' places on it
// (feet at x, lying head toward −x; past three, on the floor beside it)
const BEDSIDE = { x: -1.2, z: -1.2 };
const SLEEP_SLOTS = [
  { x: -0.75, z: -2.45, y: BED.top + 0.13 },
  { x: -0.75, z: -2.95, y: BED.top + 0.13 },
  { x: -0.75, z: -3.4, y: BED.top + 0.13 },
  { x: 1.3, z: -2.6, y: 0.13 },
  { x: 1.3, z: -3.3, y: 0.13 },
];
const SLEEP_YAW = Math.PI / 2;

const WALL_MARGIN = 0.28;            // m the player keeps off the walls / counters / the bed
const CAMERA_CEILING_GAP = 0.45;     // m the follow camera keeps under the ceiling
const HEIGHT_MARGIN = 2;             // m round a room that's floor too (no ledge to fall off)
const DOORWAY_DAY = 0xfff1d6;
const DOORWAY_NIGHT = 0x1a2340;
const WINDOW_DAY = 0xbfe2f7;
const WINDOW_NIGHT = 0x141c33;
// The doorway's light and the windows' sky: just behind the opening and a good bit bigger than
// it (seen at a slant, nothing of the real world past its edges)
const BACKDROP_PAD = 0.6;            // m past the opening's edges (hidden behind the wall)
const WINDOW_BACK = 0.04;            // m behind a window pane

const _v = new THREE.Vector3();

// ── Room geometry (room-local) ──
const inBlock = (type, x, z, m = 0) => type.blocks.some((c) => x > c.x0 - m && x < c.x1 + m && z > c.z0 - m && z < c.z1 + m);
// Free floor (walls / counters / the bed kept off by m)
const freeLocal = (type, x, z, m = WALL_MARGIN) => Math.abs(x) < type.halfW - m && Math.abs(z) < type.halfD - m && !inBlock(type, x, z, m);
// Pulled back onto the free floor
const clampLocal = (type, x, z) => {
  const m = WALL_MARGIN;
  x = THREE.MathUtils.clamp(x, -type.halfW + m, type.halfW - m);
  z = THREE.MathUtils.clamp(z, -type.halfD + m, type.halfD - m);
  for (const c of type.blocks) {
    if (!(x > c.x0 - m && x < c.x1 + m && z > c.z0 - m && z < c.z1 + m)) continue;
    // (out the nearest side)
    const outs = [[c.x0 - m - x, 0], [c.x1 + m - x, 0], [0, c.z0 - m - z], [0, c.z1 + m - z]];
    outs.sort((a, b) => Math.abs(a[0] + a[1]) - Math.abs(b[0] + b[1]));
    x += outs[0][0];
    z += outs[0][1];
  }
  return { x, z };
};
const doorInsideLocal = (type) => ({ x: type.door.x, z: type.halfD - 0.9 });   // where you stand on coming in
// A wooden chest filling box c (room-local): body, lid, iron bands
const makeChest = (c) => {
  const g = new THREE.Group();
  const w = c.x1 - c.x0;
  const d = c.z1 - c.z0;
  const wood = new THREE.MeshStandardMaterial({ color: 0x7a4f2a, roughness: 1, metalness: 0 });
  const iron = new THREE.MeshStandardMaterial({ color: 0x3a3a40, roughness: 0.8, metalness: 0.3 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(w, c.top * 0.72, d), wood);
  body.position.y = c.top * 0.36;
  const lid = new THREE.Mesh(new THREE.BoxGeometry(w + 0.04, c.top * 0.28, d + 0.04), wood);
  lid.position.y = c.top * 0.86;
  g.add(body, lid);
  for (const fx of [-0.3, 0.3]) {
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.06, c.top + 0.02, d + 0.06), iron);
    band.position.set(fx * w, c.top / 2, 0);
    g.add(band);
  }
  g.traverse((m) => { if (m.isMesh) m.castShadow = true; });
  g.position.set((c.x0 + c.x1) / 2, 0, (c.z0 + c.z1) / 2);
  return g;
};
const DOOR_EXIT_IN = 0.5;            // m from the front wall: walking this far into the doorway = out

// Front wall (the doorway in it) + ceiling: boxes with the walls' material, its UVs stretched
// to about the walls' texture size
const WALL_UV = [0.35, 0.44];        // texture repeats per metre (shop.glb's walls)
const wallBox = (w, h, d, material) => {
  const geo = new THREE.BoxGeometry(w, h, d);
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w * WALL_UV[0], uv.getY(i) * Math.max(h, d) * WALL_UV[1]);
  return new THREE.Mesh(geo, material);
};

// Room keys: the shops, then a home per house ('home<i>' = places.homes[i]) — each its own
// place in the grid
const roomIndex = (key) => (key === 'goods' ? 0 : key === 'gear' ? 1 : /^home\d+$/.test(key) ? 2 + Number(key.slice(4)) : -1);
const originOf = (index) => ({
  x: ROOMS_ORIGIN.x - (index % ROOM_COLUMNS) * ROOM_SPACING,
  y: ROOMS_ORIGIN.y,
  z: ROOMS_ORIGIN.z - Math.floor(index / ROOM_COLUMNS) * ROOM_SPACING,
});

/**
 * @param {object} ctx
 *  camera, getPlayerPosition() → Vector3
 */
export function createTownRooms(ctx) {
  const { camera } = ctx;
  // index → { key, type, origin, root, light, doorway, windows: [mesh] }
  const rooms = [];
  let night = false;
  let insideKey = null;
  let unregisterHeight = null;

  // A room for that key (the shops are there from the start; townLayout adds the homes)
  const add = (key, typeName) => {
    const index = roomIndex(key);
    if (index < 0) throw new Error(`[Town] bad room key ${key}`);
    rooms[index] ??= { key, type: ROOM_TYPES[typeName], typeName, origin: originOf(index), root: null, light: null, doorway: null, windows: [] };
    return rooms[index];
  };
  add('goods', 'shop');
  add('gear', 'shop');
  const get = (key) => rooms[roomIndex(key)] ?? null;

  // ── Where the rooms are (world) ──
  const toWorld = (key, p) => { const o = get(key).origin; return { x: o.x + p.x, z: o.z + p.z }; };
  const toLocal = (key, x, z) => { const o = get(key).origin; return { x: x - o.x, z: z - o.z }; };
  // The room whose grid place (x, z) is in (a room's grid place is far bigger than the room)
  const near = (x, z) => {
    const col = Math.round((ROOMS_ORIGIN.x - x) / ROOM_SPACING);
    const row = Math.round((ROOMS_ORIGIN.z - z) / ROOM_SPACING);
    if (col < 0 || col >= ROOM_COLUMNS || row < 0) return null;
    return rooms[row * ROOM_COLUMNS + col] ?? null;
  };
  // The room (x, z) is in (a little round it too), or null
  const roomAt = (x, z) => {
    const r = near(x, z);
    if (!r) return null;
    return Math.abs(x - r.origin.x) < r.type.halfW + 0.5 && Math.abs(z - r.origin.z) < r.type.halfD + 0.5 ? r.key : null;
  };
  const kindAt = (x, z) => { const key = roomAt(x, z); return key ? get(key).typeName : null; };
  // (the floor is the ground there)
  const floorHeight = (x, z) => {
    const r = near(x, z);
    if (!r) return undefined;
    const { halfW, halfD } = r.type;
    return Math.abs(x - r.origin.x) < halfW + HEIGHT_MARGIN && Math.abs(z - r.origin.z) < halfD + HEIGHT_MARGIN ? r.origin.y : undefined;
  };
  const isFree = (x, z) => {
    const key = roomAt(x, z);
    if (!key) return false;
    const l = toLocal(key, x, z);
    return freeLocal(get(key).type, l.x, l.z);
  };
  const doorInside = (key) => toWorld(key, doorInsideLocal(get(key).type));
  // Townsfolk inside a room: the waypoints from (x0, z0) to (x1, z1) (both in that room; world)
  const roomPath = (key, x0, z0, x1, z1) => {
    const { type } = get(key);
    const l = toLocal(key, x1, z1);
    const to = clampLocal(type, l.x, l.z);
    return type.route(toLocal(key, x0, z0), to).map((p) => toWorld(key, p));
  };
  // A free spot within r of (x, z) in that room (world)
  const spotNear = (key, x, z, r) => {
    for (let k = 0; k < 12; k++) {
      const a = Math.random() * Math.PI * 2;
      const d = Math.random() * r;
      const tx = x + Math.sin(a) * d;
      const tz = z + Math.cos(a) * d;
      if (isFree(tx, tz)) return { x: tx, z: tz };
    }
    return { x, z };
  };
  // A home: by the bed (turning in), or anywhere on its floor (pottering about)
  const bedside = (key) => { const b = toWorld(key, BEDSIDE); return spotNear(key, b.x, b.z, 0.5); };
  const somewhereIn = (key) => {
    const { type } = get(key);
    const c = toWorld(key, { x: 0, z: 0 });
    return spotNear(key, c.x, c.z, Math.min(type.halfW, type.halfD));
  };
  // The k-th sleeper's place in a home (world, its y the body's)
  const sleepPose = (key, k) => {
    const s = SLEEP_SLOTS[k % SLEEP_SLOTS.length];
    const w = toWorld(key, s);
    return { x: w.x, y: get(key).origin.y + s.y, z: w.z, yaw: SLEEP_YAW };
  };
  // In front of a home's chest (world), or null (a shop)
  const chestSpot = (key) => (get(key)?.type.chest ? toWorld(key, CHEST_FRONT) : null);
  // The player controls' positionConstraint while inside: on the floor, off the counters / bed
  // (the room they're in — setInside: a long frame's step may land past its walls; a teleport
  // far away — knocked out, the game's own — isn't pulled back)
  const constrainPlayer = (controls) => {
    const key = insideKey;
    if (!key) return;
    const { type, origin } = get(key);
    if (Math.hypot(controls.playerX - origin.x, controls.playerZ - origin.z) > 30) return;
    const l = toLocal(key, controls.playerX, controls.playerZ);
    // (the doorway: let them step into it — leaving is townTrade's)
    const inDoor = Math.abs(l.x - type.door.x) < type.door.halfW - 0.15 && l.z > type.halfD - 1.2;
    const c = inDoor ? { x: l.x, z: Math.min(l.z, type.halfD - 0.1) } : clampLocal(type, l.x, l.z);
    const w = toWorld(key, c);
    controls.playerX = w.x;
    controls.playerZ = w.z;
  };
  // Walked out through the doorway (the room's key), or null
  const leftThroughDoor = (x, z) => {
    const key = roomAt(x, z);
    if (!key) return null;
    const { type } = get(key);
    const l = toLocal(key, x, z);
    return l.z > type.halfD - DOOR_EXIT_IN && Math.abs(l.x - type.door.x) < type.door.halfW ? key : null;
  };

  // ── Build: a room's shell (its model, the walls it lacks, a lamp, the doorway / windows' light) ──
  // → the room's root (room-local), for what goes in it (townStalls.js: the shops' counters)
  const build = (group, key) => {
    const room = get(key);
    if (room.root) return room.root;
    const { type, origin } = room;
    const root = new THREE.Group();
    root.position.set(origin.x, origin.y, origin.z);
    root.visible = insideKey === key;
    group.add(root);
    room.root = root;

    // A warm lamp inside + a soft fill (faces turned from the lamp aren't black at night) — on
    // only while the player's in there (setInside: the fill lights the whole scene)
    const light = new THREE.Group();
    const lamp = new THREE.PointLight(0xffe2b0, 4, 18, 0.6);
    lamp.position.set(0, type.height * 0.62, 0.4);
    light.add(lamp, new THREE.HemisphereLight(0xffe8c8, 0x5a4030, 0.7));
    light.visible = insideKey === key;
    root.add(light);
    room.light = light;
    // The doorway: daylight (or the night) outside
    const doorway = new THREE.Mesh(new THREE.PlaneGeometry(type.door.halfW * 2 + BACKDROP_PAD * 2, type.door.h + BACKDROP_PAD * 2),
      new THREE.MeshBasicMaterial({ color: night ? DOORWAY_NIGHT : DOORWAY_DAY, fog: false }));
    doorway.position.set(type.door.x, type.door.h / 2, type.halfD + type.door.back);
    doorway.rotation.y = Math.PI;
    root.add(doorway);
    room.doorway = doorway;

    if (type.chest) root.add(makeChest(type.chest));

    type.load().then((model) => {
      const shell = new THREE.Group();
      model.position.set(0, -MODEL_FLOOR_Y, 0);
      shell.add(model);
      root.add(shell);
      // The walls: the mesh that's taller than a counter (its material dresses the front wall /
      // ceiling); the walls' and the floor's faces point out of the room (seen from inside
      // they'd be culled): two-sided; the counters / the bed (closed shapes) cast shadows
      let wallMat = null;
      const panes = [];
      shell.updateMatrixWorld(true);
      model.traverse((m) => {
        if (!m.isMesh) return;
        if (type.hide?.test(m.name)) { m.visible = false; return; }
        if (type.windows?.test(m.name)) { m.material.side = THREE.DoubleSide; panes.push(m); return; }
        const size = new THREE.Box3().setFromObject(m).getSize(_v);
        if (size.y > 2 || size.y < 0.1) m.material.side = THREE.DoubleSide;
        if (size.y > 2) wallMat ??= m.material;
        else if (size.y >= 0.1) m.castShadow = true;
      });
      // Behind each window pane, the sky (the room's under the map: the real outside isn't there)
      const toRoom = new THREE.Matrix4().copy(root.matrixWorld).invert();
      for (const pane of panes) {
        const box = new THREE.Box3().setFromObject(pane).applyMatrix4(toRoom);
        const c = box.getCenter(new THREE.Vector3());
        const s = box.getSize(new THREE.Vector3());
        const onX = s.x < s.z; // (in a side wall)
        const sign = Math.sign(onX ? c.x : c.z) || 1;
        const sky = new THREE.Mesh(new THREE.PlaneGeometry((onX ? s.z : s.x) + BACKDROP_PAD * 2, s.y + BACKDROP_PAD * 2),
          new THREE.MeshBasicMaterial({ color: night ? WINDOW_NIGHT : WINDOW_DAY, fog: false }));
        sky.position.copy(c);
        if (onX) sky.position.x += sign * WINDOW_BACK;
        else sky.position.z += sign * WINDOW_BACK;
        // (facing into the room)
        sky.rotation.y = onX ? (sign > 0 ? -Math.PI / 2 : Math.PI / 2) : (sign > 0 ? Math.PI : 0);
        root.add(sky);
        room.windows.push(sky);
      }
      if (type.frontWall) {
        wallMat ??= new THREE.MeshStandardMaterial({ color: 0x8a6a4a, roughness: 1, metalness: 0, side: THREE.DoubleSide });
        const { halfW, halfD, height } = type;
        const { halfW: doorHalfW, h: doorH } = type.door;
        const t = 0.12;
        const side = halfW - doorHalfW;
        for (const sx of [-1, 1]) {
          const part = wallBox(side, height, t, wallMat);
          part.position.set(sx * (doorHalfW + side / 2), height / 2, halfD + t / 2);
          part.receiveShadow = true;
          root.add(part);
        }
        const lintel = wallBox(doorHalfW * 2, height - doorH, t, wallMat);
        lintel.position.set(0, doorH + (height - doorH) / 2, halfD + t / 2);
        root.add(lintel);
        const ceiling = wallBox(halfW * 2 + t * 2, t, halfD * 2 + t * 2, wallMat);
        ceiling.position.set(0, height + t / 2, 0);
        root.add(ceiling);
      }
    }).catch((e) => console.warn(`[Town] ${key} room failed to load:`, e));
    return root;
  };

  // The follow camera inside a room: kept within its walls and under the ceiling (squeezed
  // in, it rises — looking down on the player)
  const clampCamera = () => {
    const p = ctx.getPlayerPosition();
    const key = roomAt(p.x, p.z);
    if (!key) return;
    const { type, origin } = get(key);
    const l = toLocal(key, camera.position.x, camera.position.z);
    const m = WALL_MARGIN + 0.1;
    const cx = THREE.MathUtils.clamp(l.x, -type.halfW + m, type.halfW - m);
    const cz = THREE.MathUtils.clamp(l.z, -type.halfD + m, type.halfD - m);
    const lost = Math.hypot(l.x - cx, l.z - cz);
    const top = origin.y + type.height - CAMERA_CEILING_GAP;
    if (lost < 1e-4 && camera.position.y <= top) return;
    camera.position.set(origin.x + cx, Math.min(top, camera.position.y + lost * 0.7), origin.z + cz);
    camera.lookAt(_v.set(p.x, p.y + 0.75, p.z));
    camera.updateMatrixWorld();
  };

  // The player's in that room (or none): it's drawn and lit, the others aren't
  const setInside = (key) => {
    insideKey = key;
    for (const r of rooms) {
      if (!r?.root) continue;
      r.root.visible = r.key === key;
      r.light.visible = r.key === key;
    }
  };
  const setNight = (on) => {
    night = !!on;
    for (const r of rooms) {
      if (!r) continue;
      r.doorway?.material.color.setHex(night ? DOORWAY_NIGHT : DOORWAY_DAY);
      for (const w of r.windows) w.material.color.setHex(night ? WINDOW_NIGHT : WINDOW_DAY);
    }
  };
  const setActive = (on) => {
    if (on) unregisterHeight ??= registerTerrainHeightOverride(floorHeight);
    else {
      unregisterHeight?.();
      unregisterHeight = null;
      setInside(null);
    }
  };

  return {
    add, build, get, toWorld, toLocal,
    roomAt, kindAt, isFree, doorInside, roomPath, spotNear, bedside, somewhereIn, sleepPose, chestSpot,
    constrainPlayer, leftThroughDoor, clampCamera,
    setInside, setNight, setActive,
    inside: () => insideKey,
  };
}

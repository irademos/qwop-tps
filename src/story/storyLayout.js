// Story mode: where things go on the island, found at run time from the island itself (its
// rocks, trees, water). findStoryLayout(island, ctx) → the layout storyMode.js uses, or null.
//
//   wash      — where he washes up: a beach on the island's outer coast (open sea out in front —
//               not the river or a bay: isOpenSea), by the rock nearest that shore
//   seat      — the stone he climbs onto (ours — the island's rocks are boulders)
//   crowSpot  — where the Crow lands, beside the stone; crowFrom — where it flies in from
//   mooring   — the (holed) canoe, off the beach to one side
//   tree      — the sacred tree (a tree creature hiding as one): inland, straight up the beach,
//               among the island's trees
//   frogMom   — the frog mom, sitting off to one side of the way up to it (or null)
// ctx: { getMapObjects(bounds), waterDepth(x, z), getGroundY(x, z), canoeFits(x, z, yaw) }
export const SEAT_RADIUS = 0.45;  // m: the stone he stands on…
export const SEAT_TOP = 0.32;     // …and how high its top is over the sand
const CROW_FROM_DIST = 30;        // m out over the sea it flies in from
const OPEN_SEA_REACH = 45;        // m of water straight out from the beach…
const OPEN_SEA_SPREAD = 14;       // …and to either side of it a little way out (a river is narrower)
const TREE_IN_MIN = 22;           // m inland from the beach: the sacred tree…
const TREE_IN_MAX = 75;
const TREE_CONE = 0.6;            // …within this many rad of straight up the beach

export function findStoryLayout(island, ctx) {
  const dry = (x, z) => ctx.waterDepth(x, z) <= 0.02;
  const wet = (x, z, d = 0.3) => ctx.waterDepth(x, z) > d;
  // From (x, z): the nearest water (≥ 5 cm), looking round in `n` directions out to `max` m
  const nearestWater = (x, z, max = 60, n = 48, ok = null) => {
    let best = null;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      const dx = Math.sin(a);
      const dz = Math.cos(a);
      for (let d = 0.75; d <= max; d += 0.75) {
        if (best && d >= best.d) break;
        if (ctx.waterDepth(x + dx * d, z + dz * d) > 0.05) {
          if (!ok || ok(x + dx * d, z + dz * d, dx, dz)) best = { d, dx, dz };
          break;
        }
      }
    }
    return best;
  };
  // Open sea out from a shore point (x, z) going (dx, dz): water all the way out, and to both
  // sides a little way out, and heading away from the island's middle
  const isOpenSea = (x, z, dx, dz) => {
    const ox = x - island.at.x;
    const oz = z - island.at.z;
    if (ox * dx + oz * dz < 0) return false;
    for (let d = 3; d <= OPEN_SEA_REACH; d += 3) if (!wet(x + dx * d, z + dz * d)) return false;
    const tx = -dz;
    const tz = dx;
    for (const s of [-OPEN_SEA_SPREAD, -OPEN_SEA_SPREAD / 2, OPEN_SEA_SPREAD / 2, OPEN_SEA_SPREAD]) {
      if (!wet(x + dx * 8 + tx * s, z + dz * 8 + tz * s)) return false;
    }
    return true;
  };

  const r = island.radius + 30;
  const objs = ctx.getMapObjects({ minX: island.at.x - r, maxX: island.at.x + r, minZ: island.at.z - r, maxZ: island.at.z + r });
  // The rock nearest the outer coast, with a little beach in front of it
  let rock = null;
  for (const o of objs) {
    if (!/rock/i.test(o.file) || !dry(o.x, o.z)) continue;
    const w = nearestWater(o.x, o.z, 40);
    if (!w || w.d < o.radius + 3) continue;
    if (!isOpenSea(o.x + w.dx * w.d, o.z + w.dz * w.d, w.dx, w.dz)) continue;
    if (!rock || w.d - o.radius < rock.w.d - rock.o.radius) rock = { o, w };
  }
  let centre;
  let rockR;
  let w;
  if (rock) {
    centre = { x: rock.o.x, z: rock.o.z };
    rockR = rock.o.radius;
    w = rock.w;
  } else {
    // (no rock there: a spot a few m in from the outer coast nearest the middle)
    const c = nearestWater(island.at.x, island.at.z, island.radius + 60, 96, isOpenSea)
      ?? nearestWater(island.at.x, island.at.z, island.radius + 60, 72);
    if (!c) return null;
    const d = Math.max(0, c.d - 8);
    centre = { x: island.at.x + c.dx * d, z: island.at.z + c.dz * d };
    rockR = 0.5;
    w = nearestWater(centre.x, centre.z, 40, 48, isOpenSea) ?? nearestWater(centre.x, centre.z, 40) ?? { d: 8, dx: c.dx, dz: c.dz };
  }
  const dir = { x: w.dx, z: w.dz };          // rock → sea
  const tan = { x: -dir.z, z: dir.x };       // along the shore
  const at = (d, s = 0) => ({ x: centre.x + dir.x * d + tan.x * s, z: centre.z + dir.z * d + tan.z * s });
  const dryAt = (p) => dry(p.x, p.z);
  // The beach: just short of the water
  let washD = w.d - 0.8;
  while (washD > rockR + 1 && !dryAt(at(washD))) washD -= 0.4;
  const wash = at(washD);
  const seaYaw = Math.atan2(dir.x, dir.z);
  // The stone he stands on: up the beach from where he washed up, a little to one side
  let seat = null;
  for (const [d, sd] of [[washD - 4.5, 2.5], [washD - 4.5, -2.5], [washD - 3.5, 0], [washD - 2.5, 1.5]]) {
    const p = at(Math.max(rockR + SEAT_RADIUS + 0.5, d), sd);
    if (dryAt(p) && dry(p.x + dir.x * 1.2, p.z + dir.z * 1.2)) { seat = p; break; }
  }
  seat ??= at(Math.max(rockR + 1, washD - 3));
  const seatD = (seat.x - centre.x) * dir.x + (seat.z - centre.z) * dir.z;
  const seatS = (seat.x - centre.x) * tan.x + (seat.z - centre.z) * tan.z;
  // The Crow lands on the beach beside it, a little toward the sea
  let crowSpot = null;
  for (const [d, sd] of [[0.5, 1.4], [0.5, -1.4], [0, 1.6], [0, -1.6], [1.2, 0]]) {
    const p = at(Math.min(seatD + d, washD - 0.3), seatS + sd);
    if (dryAt(p)) { crowSpot = p; break; }
  }
  crowSpot ??= at(seatD - 1.2, seatS);
  // The canoe: off the beach along the shore, the side away from the stone
  const side = seatS > 0 ? -1 : 1;
  const yaw = Math.atan2(tan.x, tan.z);
  let mooring = null;
  for (let d = w.d + 1.5; d <= w.d + 25 && !mooring; d += 0.5) {
    for (const s of [6, 8, 4, 10, 2, 13, 0]) {
      const p = at(d, s * side);
      if (ctx.canoeFits(p.x, p.z, yaw)) { mooring = { ...p, yaw }; break; }
    }
  }
  mooring ??= { ...at(w.d + 3, 6 * side), yaw };
  // The sacred tree: inland, straight up the beach, by one of the island's trees with others
  // round it — the creature stands beside it
  const inland = { x: -dir.x, z: -dir.z };
  const trees = objs.filter((o) => /tree/i.test(o.file) && !/stump/i.test(o.file) && dry(o.x, o.z));
  let best = null;
  for (const o of trees) {
    const ox = o.x - wash.x;
    const oz = o.z - wash.z;
    const d = Math.hypot(ox, oz);
    if (d < TREE_IN_MIN || d > TREE_IN_MAX) continue;
    const ang = Math.acos(Math.max(-1, Math.min(1, (ox * inland.x + oz * inland.z) / d)));
    if (ang > TREE_CONE) continue;
    let near = 0;
    for (const q of trees) if (q !== o && Math.hypot(q.x - o.x, q.z - o.z) < 12) near += 1;
    // (with trees round it, not too far in, near the line up the beach)
    const score = near * 2 - ang * 6 - Math.abs(d - 40) * 0.08;
    if (!best || score > best.score) best = { o, score };
  }
  let tree = null;
  const free = (p, around) => dryAt(p) && around.every((q) => Math.hypot(q.x - p.x, q.z - p.z) > q.radius * 0.35 + 0.9);
  if (best) {
    const o = best.o;
    const around = trees.filter((q) => Math.hypot(q.x - o.x, q.z - o.z) < 15);
    // (beside it, on the beach side, so it's met on the way in)
    for (const k of [0, 0.7, -0.7, 1.4, -1.4, Math.PI]) {
      const a = Math.atan2(dir.x, dir.z) + k;
      for (const rr of [o.radius * 0.35 + 1.4, o.radius * 0.35 + 2.4]) {
        const p = { x: o.x + Math.sin(a) * rr, z: o.z + Math.cos(a) * rr };
        if (free(p, around)) { tree = p; break; }
      }
      if (tree) break;
    }
  }
  if (!tree) {
    // (no tree there: a dry spot straight up the beach)
    for (let d = 40; d >= TREE_IN_MIN && !tree; d -= 3) {
      const p = { x: wash.x + inland.x * d, z: wash.z + inland.z * d };
      if (dryAt(p)) tree = p;
    }
  }
  tree ??= at(Math.max(rockR + 2, washD - 15));
  // The frog mom: sitting off to one side of the way up to the sacred tree, a little under
  // halfway there, facing the way (frogMom.js)
  let frogMom = null;
  const near = trees.filter((q) => Math.hypot(q.x - wash.x, q.z - wash.z) < TREE_IN_MAX + 20);
  for (const f of [0.45, 0.35, 0.55, 0.25, 0.65]) {
    const m = { x: wash.x + (tree.x - wash.x) * f, z: wash.z + (tree.z - wash.z) * f };
    for (const s of [5, -5, 7, -7, 3.5, -3.5, 9, -9]) {
      const p = { x: m.x + tan.x * s, z: m.z + tan.z * s };
      if (free(p, near) && dry(p.x - tan.x * 0.6, p.z - tan.z * 0.6) && dry(p.x + tan.x * 0.6, p.z + tan.z * 0.6)) {
        frogMom = { ...p, yaw: Math.atan2(m.x - p.x, m.z - p.z) };
        break;
      }
    }
    if (frogMom) break;
  }
  return {
    rock: { ...centre, radius: rockR },
    seat, wash, seaYaw, dir, crowSpot, mooring,
    tree: { ...tree, yaw: seaYaw },
    frogMom,
    crowFrom: at(w.d + CROW_FROM_DIST, -12),
  };
}

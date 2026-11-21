// Solid columns the player can't walk through — the map's tree trunks (measured from the
// trees' models when a map becomes active: setMapObstacles in bootstrapGameApp.js). Only the
// trunk blocks; the leaves stay walk-through. Trees aren't ground (the map's `noGround`), so
// the wall checks in controls.js don't see them: this is their collision instead.
// Props can add their own (setPropObstacles — Town's market stalls): boxes as well as columns.
// Kept in a coarse grid, so a lookup only looks at the ones in the cells round a point.

const CELL = 4; // m
let grid = new Map();

const key = (ix, iz) => `${ix},${iz}`;

let mapList = [];
const propLists = new Map(); // key → list

// list: [{ x, z, r, y0, y1 }] — a vertical column of radius r from y0 to y1 (world units)
export function setMapObstacles(list = []) {
  mapList = list;
  rebuild();
}

// A prop's obstacles under `key` (null / [] takes them away): columns as above, or boxes
// { box: true, x, z, hx, hz, yaw, y0, y1 } — centred on (x, z), half-sizes hx / hz along the
// box's own x / z, turned `yaw` (three.js rotation.y). Any of them can carry an `owner` tag, so
// that thing's own checks can skip it (pushOutOfObstacles' `ignore` — the cart's own box)
export function setPropObstacles(key, list) {
  if (list?.length) propLists.set(key, list);
  else if (!propLists.delete(key)) return;
  rebuild();
}

function rebuild() {
  grid = new Map();
  for (const list of [mapList, ...propLists.values()]) {
    for (const o of list) {
      if (o.box) {
        if (!(o.hx > 0 && o.hz > 0)) continue;
        o.cos = Math.cos(o.yaw ?? 0);
        o.sin = Math.sin(o.yaw ?? 0);
      } else if (!(o.r > 0)) continue;
      if (!Number.isFinite(o.x) || !Number.isFinite(o.z)) continue;
      const ext = (o.box ? Math.hypot(o.hx, o.hz) : o.r) + 1;
      for (let ix = Math.floor((o.x - ext) / CELL); ix <= Math.floor((o.x + ext) / CELL); ix++) {
        for (let iz = Math.floor((o.z - ext) / CELL); iz <= Math.floor((o.z + ext) / CELL); iz++) {
          const k = key(ix, iz);
          let cell = grid.get(k);
          if (!cell) grid.set(k, (cell = []));
          cell.push(o);
        }
      }
    }
  }
}

// (a box's frame: world offset from its middle → its own x / z, and back)
const toBox = (o, dx, dz) => [dx * o.cos - dz * o.sin, dx * o.sin + dz * o.cos];
const fromBox = (o, lx, lz) => [lx * o.cos + lz * o.sin, -lx * o.sin + lz * o.cos];

// A step (sx, sz) from (x, z) against a box, for a walker of radius `radius`: the part into the
// face it meets is taken off (slides along it); head on it goes round the nearer end
function slideBox(o, x, z, stepX, stepZ, radius, len) {
  const HX = o.hx + radius;
  const HZ = o.hz + radius;
  const [ex, ez] = toBox(o, x + stepX - o.x, z + stepZ - o.z);
  if (Math.abs(ex) >= HX || Math.abs(ez) >= HZ) return null;
  const [px, pz] = toBox(o, x - o.x, z - o.z);
  let [lx, lz] = toBox(o, stepX, stepZ);
  // (the face it comes in through: the one it's outside of — the deeper outside, at a corner)
  const outX = Math.abs(px) - HX;
  const outZ = Math.abs(pz) - HZ;
  if (outX < 0 && outZ < 0) return null; // (already inside: pushed out instead)
  if (outX >= outZ) {
    if (lx * Math.sign(px) >= 0) return null;
    lx = 0;
    if (Math.abs(lz) < len * 0.5) lz = (Math.sign(pz) || 1) * len * 0.8;
  } else {
    if (lz * Math.sign(pz) >= 0) return null;
    lz = 0;
    if (Math.abs(lx) < len * 0.5) lx = (Math.sign(px) || 1) * len * 0.8;
  }
  const [wx, wz] = fromBox(o, lx, lz);
  return { x: wx, z: wz };
}

// (columns of the cell a point is in, at height y)
function near(x, z, y) {
  const cell = grid.get(key(Math.floor(x / CELL), Math.floor(z / CELL)));
  if (!cell) return null;
  return Number.isFinite(y) ? cell.filter((o) => y > o.y0 && y < o.y1) : cell;
}

// A walking step from (x, z) at height y by a walker of radius `radius`: the part of it into a
// trunk is taken off, so it slides round it. Walking straight at one it steps round it (to the
// side it was already slightly on), so the auto-walk never stalls against a tree.
// Returns the step to take: { x, z }.
export function slideStep(x, z, y, stepX, stepZ, radius) {
  const len = Math.hypot(stepX, stepZ);
  if (len < 1e-6 || !grid.size) return { x: stepX, z: stepZ };
  const cols = near(x + stepX, z + stepZ, y);
  if (!cols?.length) return { x: stepX, z: stepZ };
  for (const o of cols) {
    if (o.box) {
      const st = slideBox(o, x, z, stepX, stepZ, radius, len);
      if (st) { stepX = st.x; stepZ = st.z; }
      continue;
    }
    const R = o.r + radius;
    const nx0 = x + stepX - o.x;
    const nz0 = z + stepZ - o.z;
    if (nx0 * nx0 + nz0 * nz0 >= R * R) continue;
    let nx = x - o.x;
    let nz = z - o.z;
    const nl = Math.hypot(nx, nz) || 1;
    nx /= nl;
    nz /= nl;
    const into = stepX * nx + stepZ * nz;
    if (into >= 0) continue; // moving away already
    let tx = stepX - into * nx;
    let tz = stepZ - into * nz;
    const tl = Math.hypot(tx, tz);
    if (tl < len * 0.5) {
      // head on: go round it
      const side = tl > 1e-6 ? Math.sign(tx * -nz + tz * nx) || 1 : 1;
      tx = -nz * side * len * 0.8;
      tz = nx * side * len * 0.8;
    }
    stepX = tx;
    stepZ = tz;
  }
  return { x: stepX, z: stepZ };
}

// A walker of radius `radius` at (x, z), height y, moved out of any trunk it is inside.
// Returns null when it is clear, else the spot to put it. `ignore`: an `owner` tag to skip.
export function pushOutOfObstacles(x, z, y, radius, ignore = null) {
  if (!grid.size) return null;
  const cols = near(x, z, y);
  if (!cols?.length) return null;
  let moved = false;
  for (const o of cols) {
    if (ignore && o.owner === ignore) continue;
    if (o.box) {
      const HX = o.hx + radius;
      const HZ = o.hz + radius;
      let [lx, lz] = toBox(o, x - o.x, z - o.z);
      const inX = HX - Math.abs(lx);
      const inZ = HZ - Math.abs(lz);
      if (inX <= 0 || inZ <= 0) continue;
      if (inX < inZ) lx = (Math.sign(lx) || 1) * HX;
      else lz = (Math.sign(lz) || 1) * HZ;
      const [wx, wz] = fromBox(o, lx, lz);
      x = o.x + wx;
      z = o.z + wz;
      moved = true;
      continue;
    }
    const R = o.r + radius;
    let dx = x - o.x;
    let dz = z - o.z;
    const d2 = dx * dx + dz * dz;
    if (d2 >= R * R) continue;
    const d = Math.sqrt(d2);
    if (d < 1e-6) { dx = 1; dz = 0; } else { dx /= d; dz /= d; }
    x = o.x + dx * R;
    z = o.z + dz * R;
    moved = true;
  }
  return moved ? { x, z } : null;
}

// Solid columns the player can't walk through — the map's tree trunks (measured from the
// trees' models when a map becomes active: setMapObstacles in bootstrapGameApp.js). Only the
// trunk blocks; the leaves stay walk-through. Trees aren't ground (the map's `noGround`), so
// the wall checks in controls.js don't see them: this is their collision instead.
// Kept in a coarse grid, so a lookup only looks at the trunks in the cells round a point.

const CELL = 4; // m
let grid = new Map();

const key = (ix, iz) => `${ix},${iz}`;

// list: [{ x, z, r, y0, y1 }] — a vertical column of radius r from y0 to y1 (world units)
export function setMapObstacles(list = []) {
  grid = new Map();
  for (const o of list) {
    if (!(o.r > 0) || !Number.isFinite(o.x) || !Number.isFinite(o.z)) continue;
    const ext = o.r + 1;
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
// Returns null when it is clear, else the spot to put it.
export function pushOutOfObstacles(x, z, y, radius) {
  if (!grid.size) return null;
  const cols = near(x, z, y);
  if (!cols?.length) return null;
  let moved = false;
  for (const o of cols) {
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

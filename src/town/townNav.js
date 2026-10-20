// Town mode navigation: a walkability grid over the town's area of the active map, with A*
// paths that prefer the painted roads / trails. There's no navmesh: each cell samples the
// map's ground height (getTerrainHeight — buildings are ground too, so their walls are big
// height steps), water cells and steep steps are out, and only the cells connected to the
// town's middle count (a building's roof is "walkable" but can't be reached).
//
// createTownNav({ bounds, cell, start, getGroundY, isOverWater, pathAt })
//   bounds: { minX, maxX, minZ, maxZ } (world m), cell: cell size (m), start: { x, z }
//   getGroundY(x, z) → y | undefined, isOverWater(x, z) → bool, pathAt(x, z) → 'road' | 'trail' | null

const MAX_STEP = 0.55;          // m of height change between neighbouring cells a walker takes
const COST_ROAD = 1;            // per-metre cost on a road…
const COST_TRAIL = 1.25;        // …a trail…
const COST_GRASS = 2.2;         // …and off the paths (walkers keep to the roads)
const LINE_SAMPLE = 0.5;        // m between samples when checking a straight walk

export function createTownNav({ bounds, cell, start, getGroundY, isOverWater, pathAt }) {
  const cols = Math.max(2, Math.ceil((bounds.maxX - bounds.minX) / cell));
  const rows = Math.max(2, Math.ceil((bounds.maxZ - bounds.minZ) / cell));
  const n = cols * rows;
  const height = new Float32Array(n);
  const open = new Uint8Array(n);      // ground there (not water / nothing)
  const reach = new Uint8Array(n);     // connected to the start
  const water = new Uint8Array(n);
  const cost = new Float32Array(n);
  const kind = new Uint8Array(n);      // 0 grass, 1 trail, 2 road
  const blocked = new Uint8Array(n);   // props placed by the town (stall, jail…)

  const cx = (i) => bounds.minX + ((i % cols) + 0.5) * cell;
  const cz = (i) => bounds.minZ + (Math.floor(i / cols) + 0.5) * cell;
  const indexAt = (x, z) => {
    const c = Math.floor((x - bounds.minX) / cell);
    const r = Math.floor((z - bounds.minZ) / cell);
    if (c < 0 || r < 0 || c >= cols || r >= rows) return -1;
    return r * cols + c;
  };

  for (let i = 0; i < n; i++) {
    const x = cx(i);
    const z = cz(i);
    const y = getGroundY(x, z);
    height[i] = Number.isFinite(y) ? y : -1e6;
    if (!Number.isFinite(y)) continue;
    if (isOverWater?.(x, z)) { water[i] = 1; continue; }
    open[i] = 1;
    const p = pathAt?.(x, z);
    kind[i] = p === 'road' ? 2 : p === 'trail' ? 1 : 0;
    cost[i] = p === 'road' ? COST_ROAD : p === 'trail' ? COST_TRAIL : COST_GRASS;
  }

  // 8 neighbours (diagonals only when both sides are walkable)
  const DC = [1, -1, 0, 0, 1, 1, -1, -1];
  const DR = [0, 0, 1, -1, 1, -1, 1, -1];
  const passable = (i) => open[i] && !blocked[i];
  const stepOk = (a, b) => Math.abs(height[a] - height[b]) <= MAX_STEP;
  const forNeighbours = (i, fn) => {
    const c = i % cols;
    const r = Math.floor(i / cols);
    for (let k = 0; k < 8; k++) {
      const nc = c + DC[k];
      const nr = r + DR[k];
      if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
      const j = nr * cols + nc;
      if (!passable(j) || !stepOk(i, j)) continue;
      if (k >= 4) {
        const a = r * cols + nc;
        const b = nr * cols + c;
        if (!passable(a) || !passable(b) || !stepOk(i, a) || !stepOk(i, b)) continue;
      }
      fn(j, k >= 4 ? Math.SQRT2 : 1);
    }
  };

  // Which cells can be walked to from the start (flood fill); the start snaps to the nearest open cell
  const nearestOpen = (x, z, test = passable) => {
    let best = -1;
    let bestD = Infinity;
    const i0 = indexAt(x, z);
    if (i0 >= 0 && test(i0)) return i0;
    // (a ring search would be quicker; the grid is small and this runs rarely)
    for (let i = 0; i < n; i++) {
      if (!test(i)) continue;
      const d = (cx(i) - x) ** 2 + (cz(i) - z) ** 2;
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  };
  const computeReach = () => {
    reach.fill(0);
    const s = nearestOpen(start.x, start.z);
    if (s < 0) return;
    const queue = [s];
    reach[s] = 1;
    for (let q = 0; q < queue.length; q++) {
      forNeighbours(queue[q], (j) => {
        if (reach[j]) return;
        reach[j] = 1;
        queue.push(j);
      });
    }
  };
  computeReach();

  const walkable = (i) => i >= 0 && reach[i] && !blocked[i];
  const nearestWalkable = (x, z) => nearestOpen(x, z, walkable);

  // Clearance: metres to the nearest cell that isn't walkable (open plazas score high)
  let clearance = null;
  const computeClearance = () => {
    clearance = new Float32Array(n).fill(Infinity);
    const queue = [];
    for (let i = 0; i < n; i++) {
      if (!walkable(i)) { clearance[i] = 0; queue.push(i); }
    }
    for (let q = 0; q < queue.length; q++) {
      const i = queue[q];
      const c = i % cols;
      const r = Math.floor(i / cols);
      for (let k = 0; k < 4; k++) {
        const nc = c + DC[k];
        const nr = r + DR[k];
        if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
        const j = nr * cols + nc;
        if (clearance[j] <= clearance[i] + cell) continue;
        clearance[j] = clearance[i] + cell;
        queue.push(j);
      }
    }
  };
  computeClearance();

  // Mark a disc as blocked (a prop the town placed) and refresh reach / clearance
  const block = (x, z, radius) => {
    for (let i = 0; i < n; i++) {
      if ((cx(i) - x) ** 2 + (cz(i) - z) ** 2 <= radius * radius) blocked[i] = 1;
    }
  };
  const refresh = () => { computeReach(); computeClearance(); };

  // ── A* ──
  const g = new Float32Array(n);
  const came = new Int32Array(n);
  const seen = new Uint32Array(n); // search id per cell (no per-search clears)
  const closed = new Uint32Array(n);
  let searchId = 0;
  const heap = [];
  const heapF = [];
  const push = (i, f) => {
    heap.push(i);
    heapF.push(f);
    let k = heap.length - 1;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (heapF[p] <= heapF[k]) break;
      [heap[p], heap[k]] = [heap[k], heap[p]];
      [heapF[p], heapF[k]] = [heapF[k], heapF[p]];
      k = p;
    }
  };
  const pop = () => {
    const top = heap[0];
    const lastI = heap.pop();
    const lastF = heapF.pop();
    if (heap.length) {
      heap[0] = lastI;
      heapF[0] = lastF;
      let k = 0;
      for (;;) {
        const l = 2 * k + 1;
        const r = l + 1;
        let m = k;
        if (l < heap.length && heapF[l] < heapF[m]) m = l;
        if (r < heap.length && heapF[r] < heapF[m]) m = r;
        if (m === k) break;
        [heap[m], heap[k]] = [heap[k], heap[m]];
        [heapF[m], heapF[k]] = [heapF[k], heapF[m]];
        k = m;
      }
    }
    return top;
  };

  // A straight walk from a to b stays on walkable cells with no big steps
  const lineWalkable = (ax, az, bx, bz) => {
    const len = Math.hypot(bx - ax, bz - az);
    const steps = Math.max(1, Math.ceil(len / LINE_SAMPLE));
    let prev = indexAt(ax, az);
    if (!walkable(prev)) return false;
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const i = indexAt(ax + (bx - ax) * t, az + (bz - az) * t);
      if (!walkable(i)) return false;
      if (i !== prev && !stepOk(prev, i)) return false;
      prev = i;
    }
    return true;
  };

  // Path from (x0, z0) to (x1, z1): [{ x, z }, …] ending at the goal (snapped to a walkable
  // cell), corners cut where a straight walk is clear; null when there's no way there
  const findPath = (x0, z0, x1, z1) => {
    const s = nearestWalkable(x0, z0);
    const t = nearestWalkable(x1, z1);
    if (s < 0 || t < 0) return null;
    if (s === t) return [{ x: x1, z: z1 }];
    searchId = (searchId + 1) >>> 0 || 1;
    heap.length = 0;
    heapF.length = 0;
    const tx = cx(t);
    const tz = cz(t);
    const h = (i) => Math.hypot(cx(i) - tx, cz(i) - tz) * COST_ROAD;
    g[s] = 0;
    came[s] = -1;
    seen[s] = searchId;
    push(s, h(s));
    let found = false;
    while (heap.length) {
      const i = pop();
      if (closed[i] === searchId) continue;
      closed[i] = searchId;
      if (i === t) { found = true; break; }
      forNeighbours(i, (j, d) => {
        if (!reach[j] || closed[j] === searchId) return;
        const ng = g[i] + d * cell * (cost[i] + cost[j]) * 0.5;
        if (seen[j] === searchId && ng >= g[j]) return;
        seen[j] = searchId;
        g[j] = ng;
        came[j] = i;
        push(j, ng + h(j));
      });
    }
    if (!found) return null;
    const cells = [];
    for (let i = t; i !== -1; i = came[i]) cells.push(i);
    cells.reverse();
    // String-pull: from each kept point, skip ahead while the straight walk is clear —
    // but never off a road onto grass (they keep to the roads where the path does)
    const pts = [{ x: x0, z: z0 }];
    let k = 0;
    while (k < cells.length - 1) {
      let next = k + 1;
      const from = pts[pts.length - 1];
      for (let j = cells.length - 1; j > k + 1; j--) {
        if (kind[cells[j]] < kind[cells[k]]) continue;
        if (lineWalkable(from.x, from.z, cx(cells[j]), cz(cells[j]))) { next = j; break; }
      }
      pts.push({ x: cx(cells[next]), z: cz(cells[next]) });
      k = next;
    }
    pts.shift();
    // End exactly at the goal when it's reachable from the last cell
    const last = pts[pts.length - 1];
    if (last && lineWalkable(last.x, last.z, x1, z1)) pts.push({ x: x1, z: z1 });
    return pts;
  };

  // Random walkable cell centres matching `test(i)` (for picking spots)
  const cellsWhere = (test) => {
    const out = [];
    for (let i = 0; i < n; i++) if (walkable(i) && test(i)) out.push(i);
    return out;
  };

  return {
    cols, rows, cell, bounds,
    indexAt,
    cellX: cx,
    cellZ: cz,
    heightAt: (i) => height[i],
    kindAt: (i) => kind[i],
    isWater: (i) => i >= 0 && !!water[i],
    clearanceAt: (i) => clearance[i],
    isWalkable: (x, z) => walkable(indexAt(x, z)),
    walkableIndex: walkable,
    nearestWalkable,
    lineWalkable,
    findPath,
    cellsWhere,
    neighbourIndices: (i) => {
      const c = i % cols;
      const r = Math.floor(i / cols);
      const out = [];
      for (let k = 0; k < 8; k++) {
        const nc = c + DC[k];
        const nr = r + DR[k];
        if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
        out.push(nr * cols + nc);
      }
      return out;
    },
    block,
    refresh,
  };
}

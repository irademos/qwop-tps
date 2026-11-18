// Town: driving directions — a route for the cart over open ground, and glowing arrows along it
// ahead of the player. The town's nav grid (townNav.js) keeps walkers to gentle steps, so it
// doesn't reach the mountain a cart rolls up fine (the wizard's cabin up there is a walked-about
// patch of its own — townLayout.js); this grid takes any slope the cart takes, costs steeper
// ground more (so the route winds up the gentle side) and keeps off water and tree trunks.
//
// createDriveGrid({ bounds, getGroundY, waterDepth, trees, props }) (built once with the layout —
// T.layout.drive): route(from, goal: { x, z, r }) → [{ x, z }, …] from `from` to within r of
// the goal, or null.
// installTownDrive(T, ctx): T.driveTo(target | null) — arrows along the route to target
// ({ x, z, r }) from wherever the player (or the cart they're in) is, re-planned as they go;
// T.updateDrive(dt) each frame; T.driveRoute() the route now (the town book could draw it).

import * as THREE from 'three';

const CELL = 2;             // m — route cells (heights sampled every CELL / 2, so a spike between two cells counts)
// (the cart rolls up 1.2 rise / run head on — cart.js — but its corners rear it up against a
// steep rise, and across a slope it rolls over: the route keeps well inside that)
const MAX_SLOPE = 0.7;      // rise / run between samples along the route
const MAX_GRADE = 0.8;      // the ground's slope at a cell, whichever way (a side slope)
const SLOPE_COST = 6;       // × the slope added to a metre's cost (gentle ground first)…
const GRADE_COST = 20;      // …and × the square of the ground's slope there (side slopes roll it over)
const WATER_DEPTH = 0.25;   // m — deeper than this is out
const TREE_R = 1.3;         // m round a trunk kept clear
const PROP_PAD = 0.7;       // m past a placed thing's bounds kept clear (houses: their walls; lamp posts…)

const ARROWS = 16;          // arrows shown ahead
const ARROW_GAP = 3;        // m between them
const ARROW_LIFT = 0.18;    // m over the ground
const REPLAN_S = 1.5;       // s between route updates
const OFF_ROUTE = 5;        // m off the route: re-planned at once

export function createDriveGrid({ bounds, getGroundY, waterDepth, trees = [], props = [], maxSlope = MAX_SLOPE, maxGrade = MAX_GRADE, gradeCost = GRADE_COST }) {
  const half = CELL / 2;
  const fc = Math.ceil((bounds.maxX - bounds.minX) / half) + 1;   // fine samples
  const fr = Math.ceil((bounds.maxZ - bounds.minZ) / half) + 1;
  const H = new Float32Array(fc * fr);
  for (let r = 0; r < fr; r++) {
    for (let c = 0; c < fc; c++) {
      const x = bounds.minX + c * half;
      const z = bounds.minZ + r * half;
      const y = getGroundY(x, z);
      H[r * fc + c] = Number.isFinite(y) && !(waterDepth(x, z) > WATER_DEPTH) ? y : NaN;
    }
  }
  const cols = Math.floor((fc - 1) / 2) + 1;
  const rows = Math.floor((fr - 1) / 2) + 1;
  const n = cols * rows;
  const hAt = (fcI, frI) => (fcI < 0 || frI < 0 || fcI >= fc || frI >= fr ? NaN : H[frI * fc + fcI]);
  const open = new Uint8Array(n);
  // (open: ground there, and its slope — the gradient from the fine samples either side, so the
  // spine of a narrow ridge, level across, counts as gentle as it is — no steeper than maxGrade)
  const grade = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const c = (i % cols) * 2;
    const r = Math.floor(i / cols) * 2;
    const h = hAt(c, r);
    if (!Number.isFinite(h)) continue;
    const e = hAt(c + 1, r);
    const w = hAt(c - 1, r);
    const nn = hAt(c, r + 1);
    const ss = hAt(c, r - 1);
    if (![e, w, nn, ss].every(Number.isFinite)) continue;
    const gmax = Math.hypot(e - w, nn - ss) / (2 * half);
    grade[i] = gmax;
    open[i] = gmax <= maxGrade ? 1 : 0;
  }
  const clear = (x0, z0, R) => {
    const c0 = Math.floor((x0 - R - bounds.minX) / CELL);
    const c1 = Math.ceil((x0 + R - bounds.minX) / CELL);
    const r0 = Math.floor((z0 - R - bounds.minZ) / CELL);
    const r1 = Math.ceil((z0 + R - bounds.minZ) / CELL);
    for (let r = Math.max(0, r0); r <= Math.min(rows - 1, r1); r++) {
      for (let c = Math.max(0, c0); c <= Math.min(cols - 1, c1); c++) {
        const x = bounds.minX + c * CELL;
        const z = bounds.minZ + r * CELL;
        if ((x - x0) ** 2 + (z - z0) ** 2 < R * R) open[r * cols + c] = 0;
      }
    }
  };
  for (const t of trees) clear(t.x, t.z, TREE_R);
  for (const o of props) clear(o.x, o.z, o.r + PROP_PAD);
  const cx = (i) => bounds.minX + (i % cols) * CELL;
  const cz = (i) => bounds.minZ + Math.floor(i / cols) * CELL;
  const indexAt = (x, z) => {
    const c = Math.round((x - bounds.minX) / CELL);
    const r = Math.round((z - bounds.minZ) / CELL);
    return c < 0 || r < 0 || c >= cols || r >= rows ? -1 : r * cols + c;
  };
  // The cost of a step from cell a to its neighbour (dc, dr) — Infinity if too steep; the mid
  // sample between them counts too
  const stepCost = (a, dc, dr) => {
    const c = (a % cols) * 2;
    const r = Math.floor(a / cols) * 2;
    const h0 = hAt(c, r);
    const hm = hAt(c + dc, r + dr);
    const h1 = hAt(c + dc * 2, r + dr * 2);
    if (!Number.isFinite(hm) || !Number.isFinite(h1)) return Infinity;
    const run = half * Math.hypot(dc, dr);
    const s = Math.max(Math.abs(hm - h0), Math.abs(h1 - hm)) / run;
    if (s > maxSlope) return Infinity;
    const j = a + dr * cols + dc;
    return run * 2 * (1 + SLOPE_COST * s + gradeCost * Math.max(grade[a], grade[j]) ** 2);
  };
  // (the nearest open cell to a spot — the start may be in a tree's ring, on a steep bit)
  const nearestOpen = (x, z, maxR = 8) => {
    const i0 = indexAt(x, z);
    if (i0 >= 0 && open[i0]) return i0;
    let best = -1;
    let bd = Infinity;
    const k = Math.ceil(maxR / CELL);
    const c0 = Math.round((x - bounds.minX) / CELL);
    const r0 = Math.round((z - bounds.minZ) / CELL);
    for (let r = r0 - k; r <= r0 + k; r++) {
      for (let c = c0 - k; c <= c0 + k; c++) {
        if (c < 0 || r < 0 || c >= cols || r >= rows) continue;
        const i = r * cols + c;
        if (!open[i]) continue;
        const d = (cx(i) - x) ** 2 + (cz(i) - z) ** 2;
        if (d < bd) { bd = d; best = i; }
      }
    }
    return best;
  };
  const g = new Float32Array(n);
  const came = new Int32Array(n);
  const seen = new Uint32Array(n);
  const closed = new Uint32Array(n);
  let search = 0;
  const DC = [1, -1, 0, 0, 1, 1, -1, -1];
  const DR = [0, 0, 1, -1, 1, -1, 1, -1];
  const route = (from, goal) => {
    const s = nearestOpen(from.x, from.z);
    if (s < 0) return null;
    const r2 = goal.r * goal.r;
    const isGoal = (i) => (cx(i) - goal.x) ** 2 + (cz(i) - goal.z) ** 2 <= r2;
    const h = (i) => Math.max(0, Math.hypot(cx(i) - goal.x, cz(i) - goal.z) - goal.r);
    search = (search + 1) >>> 0 || 1;
    // (a binary heap of [f, i])
    const heap = [];
    const push = (f, i) => {
      heap.push([f, i]);
      let k = heap.length - 1;
      while (k > 0) {
        const p = (k - 1) >> 1;
        if (heap[p][0] <= heap[k][0]) break;
        [heap[p], heap[k]] = [heap[k], heap[p]];
        k = p;
      }
    };
    const pop = () => {
      const top = heap[0];
      const last = heap.pop();
      if (heap.length) {
        heap[0] = last;
        let k = 0;
        for (;;) {
          const l = k * 2 + 1;
          const rr = l + 1;
          let m = k;
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
          if (rr < heap.length && heap[rr][0] < heap[m][0]) m = rr;
          if (m === k) break;
          [heap[m], heap[k]] = [heap[k], heap[m]];
          k = m;
        }
      }
      return top;
    };
    g[s] = 0;
    came[s] = -1;
    seen[s] = search;
    push(h(s), s);
    let end = -1;
    while (heap.length) {
      const [, i] = pop();
      if (closed[i] === search) continue;
      closed[i] = search;
      if (isGoal(i)) { end = i; break; }
      const c = i % cols;
      const r = Math.floor(i / cols);
      for (let k = 0; k < 8; k++) {
        const nc = c + DC[k];
        const nr = r + DR[k];
        if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
        const j = nr * cols + nc;
        if (!open[j] || closed[j] === search) continue;
        // (diagonals only past two open sides — not squeezing between trunks)
        if (k >= 4 && (!open[r * cols + nc] || !open[nr * cols + c])) continue;
        const sc = stepCost(i, DC[k], DR[k]);
        if (sc === Infinity) continue;
        const ng = g[i] + sc;
        if (seen[j] === search && ng >= g[j]) continue;
        seen[j] = search;
        g[j] = ng;
        came[j] = i;
        push(ng + h(j), j);
      }
    }
    if (end < 0) return null;
    const out = [];
    for (let i = end; i >= 0; i = came[i]) out.push({ x: cx(i), z: cz(i) });
    out.reverse();
    out[0] = { x: from.x, z: from.z };
    return out;
  };
  return { route };
}

// The arrows: a flat chevron, pointing +Z
const makeArrowGeometry = () => {
  const s = new THREE.Shape();
  s.moveTo(0, 0.55);
  s.lineTo(0.5, -0.05);
  s.lineTo(0.5, -0.38);
  s.lineTo(0, 0.2);
  s.lineTo(-0.5, -0.38);
  s.lineTo(-0.5, -0.05);
  s.closePath();
  const geo = new THREE.ShapeGeometry(s);
  geo.rotateX(-Math.PI / 2);
  // (the shape's +Y is now −Z: turn it round to point +Z)
  geo.rotateY(Math.PI);
  return geo;
};

// T: the town's shared state + functions (createTownMode in townMode.js); ctx: the game
export function installTownDrive(T, ctx) {
  let target = null;        // { x, z, r }
  let path = null;          // the route now
  let lens = null;          // distance along it at each point
  let planAt = 0;
  let group = null;
  const arrows = [];
  const ensureArrows = () => {
    if (group) return;
    group = new THREE.Group();
    group.name = 'drive-arrows';
    const geo = makeArrowGeometry();
    for (let k = 0; k < ARROWS; k++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffd36b, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide,
      });
      const m = new THREE.Mesh(geo, mat);
      m.renderOrder = 6;
      m.rotation.order = 'YXZ';
      m.visible = false;
      group.add(m);
      arrows.push(m);
    }
  };
  const hide = () => { for (const a of arrows) a.visible = false; };
  const from = () => {
    const c = T.inCart?.() ? T.cartRide?.()?.pose() : null;
    return c ?? T.playerPos();
  };
  const plan = () => {
    planAt = T.simT + REPLAN_S;
    const drive = T.layout?.drive;
    path = drive && target ? drive.route(from(), target) : null;
    // (no route — the player somewhere it can't start from: straight there)
    if (!path && target) { const p = from(); path = [{ x: p.x, z: p.z }, { x: target.x, z: target.z }]; }
    lens = path ? [0] : null;
    if (path) for (let i = 1; i < path.length; i++) lens.push(lens[i - 1] + Math.hypot(path[i].x - path[i - 1].x, path[i].z - path[i - 1].z));
  };
  // The point on the route nearest p: { d (along), off (m from it) }
  const project = (p) => {
    let best = { d: 0, off: Infinity };
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1];
      const b = path[i];
      const ex = b.x - a.x;
      const ez = b.z - a.z;
      const L2 = ex * ex + ez * ez || 1e-9;
      const t = Math.max(0, Math.min(1, ((p.x - a.x) * ex + (p.z - a.z) * ez) / L2));
      const off = Math.hypot(a.x + ex * t - p.x, a.z + ez * t - p.z);
      if (off < best.off) best = { d: lens[i - 1] + Math.sqrt(L2) * t, off };
    }
    return best;
  };
  const at = (d) => {
    let i = 1;
    while (i < path.length - 1 && lens[i] < d) i++;
    const a = path[i - 1];
    const b = path[i];
    const L = lens[i] - lens[i - 1] || 1e-9;
    const t = Math.max(0, Math.min(1, (d - lens[i - 1]) / L));
    return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, yaw: Math.atan2(b.x - a.x, b.z - a.z) };
  };
  const driveTo = (t) => {
    if (!t) { target = null; path = null; hide(); return; }
    if (target && t.x === target.x && t.z === target.z) return;
    target = { x: t.x, z: t.z, r: t.r ?? 4 };
    planAt = 0;
  };
  const updateDrive = () => {
    if (!target || T.inRoom || T.jail) { hide(); return; }
    ensureArrows();
    if (group.parent !== T.root) T.root.add(group);
    const p = from();
    if (T.simT > planAt || !path) plan();
    let pr = project(p);
    if (pr.off > OFF_ROUTE) { plan(); pr = project(p); }
    const total = lens[lens.length - 1];
    // (arrows flow along the route — a slow march toward the goal)
    const phase = (T.simT * 2.2) % ARROW_GAP;
    for (let k = 0; k < ARROWS; k++) {
      const a = arrows[k];
      const d = pr.d + 2 + k * ARROW_GAP + phase;
      if (d > total - 1) { a.visible = false; continue; }
      const q = at(d);
      const y = T.groundAt(q.x, q.z);
      const ahead = at(d + 0.8);
      const pitch = -Math.atan2(T.groundAt(ahead.x, ahead.z) - y, 0.8);
      a.position.set(q.x, y + ARROW_LIFT, q.z);
      a.rotation.set(pitch, q.yaw, 0);
      // (fading in near the player, out far ahead)
      const u = k / (ARROWS - 1);
      a.material.opacity = 0.85 * Math.min(1, (d - pr.d) / 4) * (1 - u * 0.7);
      a.visible = true;
    }
  };
  const resetDrive = () => { driveTo(null); group?.removeFromParent(); };

  Object.assign(T, { driveTo, updateDrive, resetDrive, driveRoute: () => path, createDriveGrid }); // (createDriveGrid: dev console)
}

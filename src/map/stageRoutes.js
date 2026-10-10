// Hand-authored Sword Showdown stage routes, per map (keys of MAPS in bootstrapGameApp.js).
//
// STAGE_ROUTES.<map>[stage - 1] = { points: [{ x, z }, …] }
//   points[0]  = where that stage's village is built (the stage starts there)
//   points[1…] = waypoints the player auto-walks through, in order; the last one is where
//                the stage ends (the next village is built just past it)
// Enemies, coins and heart bubbles are spread along the whole polyline (after the walk out of
// the village). A stage with no entry (or a null one, or fewer than 2 points) falls back to a
// random straight path (_psPickPathAngle). Classic (its own map) and the final Pemberton stage
// only use points[0] / nothing.
//
// Record them in the game: Settings → Dev → Free Roam → stage waypoints (Copy all → paste the
// array here). Recorded routes are kept as a draft in this browser (localStorage) and, with
// "Play draft routes" on in the Dev tab, Showdown uses the draft instead of this file.
export const STAGE_ROUTES = {
  islandTown: [
  { points: [{ x: -39.11, z: 17.73 }, { x: -18.16, z: 15.43 }, { x: -13.66, z: 20.42 }, { x: -13.66, z: 36.63 }, { x: 0.68, z: 39.72 }, { x: 7.65, z: 31.88 }, { x: 14.25, z: 23.01 }] }, // stage 1
],
};

const DRAFT_KEY = 'sq:devStageRoutes';
const USE_DRAFT_KEY = 'sq:devUseDraftRoutes';

const readJson = (key) => {
  try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (_) { return null; }
};
const writeJson = (key, value) => {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch (_) { /* storage blocked: the draft just isn't kept */ }
};

const validRoute = (route) => Array.isArray(route?.points)
  && route.points.length > 0
  && route.points.every(p => Number.isFinite(p?.x) && Number.isFinite(p?.z));

// Draft routes recorded on this device: { [mapKey]: [route | null, …] } (stage 1 = index 0)
export const loadDraftRoutes = (mapKey) => {
  const all = readJson(DRAFT_KEY);
  const list = Array.isArray(all?.[mapKey]) ? all[mapKey] : null;
  // Start from the file's routes the first time, so they can be edited
  return (list ?? STAGE_ROUTES[mapKey] ?? []).map(r => (validRoute(r)
    ? { points: r.points.map(p => ({ x: p.x, z: p.z })) }
    : null));
};
export const saveDraftRoutes = (mapKey, routes) => {
  const all = readJson(DRAFT_KEY) || {};
  all[mapKey] = routes;
  writeJson(DRAFT_KEY, all);
};
export const discardDraftRoutes = (mapKey) => {
  const all = readJson(DRAFT_KEY) || {};
  delete all[mapKey];
  writeJson(DRAFT_KEY, Object.keys(all).length ? all : null);
};
export const isUsingDraftRoutes = () => {
  try { return localStorage.getItem(USE_DRAFT_KEY) === '1'; } catch (_) { return false; }
};
export const setUsingDraftRoutes = (on) => {
  try {
    if (on) localStorage.setItem(USE_DRAFT_KEY, '1');
    else localStorage.removeItem(USE_DRAFT_KEY);
  } catch (_) { /* ignore */ }
};

// The routes Showdown plays on `mapKey` (the draft when "Play draft routes" is on)
export const routesForMap = (mapKey) => (isUsingDraftRoutes()
  ? loadDraftRoutes(mapKey)
  : (STAGE_ROUTES[mapKey] ?? []));

// The route for `stage` (1-based) on `mapKey`, or null
export const stageRoute = (mapKey, stage) => {
  const route = routesForMap(mapKey)[stage - 1];
  return validRoute(route) ? route : null;
};

// Polyline through `points` ({x, z}): total length and the point / heading at a distance
// along it (clamped to the ends).
export const createPolyline = (points) => {
  const cum = [0];
  for (let i = 1; i < points.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z));
  }
  const length = cum[cum.length - 1];
  const at = (s) => {
    if (points.length === 1) return { x: points[0].x, z: points[0].z, dx: 1, dz: 0 };
    const d = Math.min(Math.max(s, 0), length);
    let i = 1;
    while (i < points.length - 1 && cum[i] < d) i++;
    const a = points[i - 1];
    const b = points[i];
    const seg = cum[i] - cum[i - 1];
    const t = seg > 1e-6 ? (d - cum[i - 1]) / seg : 0;
    const dx = seg > 1e-6 ? (b.x - a.x) / seg : 1;
    const dz = seg > 1e-6 ? (b.z - a.z) / seg : 0;
    return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, dx, dz };
  };
  return { length, at };
};

const r2 = (v) => Math.round(v * 100) / 100;
// Route list as text to paste into STAGE_ROUTES (one stage per line)
export const formatRoutes = (routes) => {
  const lines = routes.map((r, i) => (validRoute(r)
    ? `  { points: [${r.points.map(p => `{ x: ${r2(p.x)}, z: ${r2(p.z)} }`).join(', ')}] }, // stage ${i + 1}`
    : `  null, // stage ${i + 1}`));
  return `[\n${lines.join('\n')}\n]`;
};

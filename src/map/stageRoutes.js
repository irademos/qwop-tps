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
  { points: [{ x: -52.23, z: 24.86 }, { x: -22.54, z: 20.76 }, { x: -17.67, z: 26.61 }, { x: -17.15, z: 49.96 }, { x: 0.1, z: 49.88 }, { x: 9.1, z: 42.76 }, { x: 15.83, z: 34.67 }] }, // stage 1
  { points: [{ x: 18.1, z: 29.67 }, { x: 20.9, z: 17.81 }, { x: 11.93, z: 12.08 }, { x: 9.2, z: 0.2 }, { x: -5.06, z: -6.07 }, { x: -3.99, z: -11.9 }] }, // stage 2
  { points: [{ x: -6.8, z: -18.38 }, { x: -23.14, z: -29.25 }, { x: -49.3, z: -51.95 }, { x: -39.01, z: -64.29 }, { x: -34.81, z: -75.92 }, { x: -51.83, z: -78.38 }, { x: -61.3, z: -73.74 }] }, // stage 3
  { points: [{ x: -68.11, z: -68.59 }, { x: -85.25, z: -29.63 }, { x: -84.23, z: 1.53 }, { x: -77.21, z: 36.49 }, { x: -61.49, z: 58.8 }] }, // stage 4
  { points: [{ x: -51.7, z: 65.18 }, { x: -28.5, z: 79.3 }, { x: -5.9, z: 81.78 }, { x: 11.66, z: 63.39 }, { x: 22.8, z: 72.51 }, { x: 30.95, z: 78.95 }, { x: 30.94, z: 96.92 }] }, // stage 5
  { points: [{ x: 40.12, z: 97.24 }, { x: 57.93, z: 88.41 }, { x: 67.56, z: 70.94 }, { x: 68.51, z: 42.72 }, { x: 58.66, z: 38.78 }, { x: 41.7, z: 31.25 }, { x: 41.99, z: 18.37 }] }, // stage 6
  { points: [{ x: 44.42, z: 10.09 }, { x: 56.19, z: -0.25 }, { x: 81.63, z: 0.44 }, { x: 94.82, z: -6.1 }, { x: 79, z: -58.08 }, { x: 59.44, z: -69.63 }, { x: 36.04, z: -72.5 }] }, // stage 7
  { points: [{ x: 26.7, z: -79.33 }, { x: 19.54, z: -51.27 }, { x: 10.35, z: -47.07 }, { x: 0.53, z: -42.58 }, { x: -7.84, z: -41.43 }, { x: -19.71, z: -27.82 }] }, // stage 8
  { points: [{ x: -14.68, z: -21.1 }, { x: -4.17, z: -10.53 }, { x: -0.33, z: -3.03 }, { x: 7.8, z: -0.25 }, { x: 11.26, z: 10.61 }, { x: 20.03, z: 15.39 }, { x: 21.09, z: 24.02 }] }, // stage 9
  { points: [{ x: 16.22, z: 34.5 }, { x: 3.07, z: 47.48 }, { x: -13.26, z: 50.71 }, { x: -18.1, z: 37.15 }, { x: -17.54, z: 26.79 }, { x: -22.72, z: 21.48 }, { x: -31.9, z: 22.24 }] }, // stage 10
  { points: [{ x: -43.99, z: 23.88 }] }, // stage 11
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

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
  { points: [{ x: -56.25, z: 26.77 }, { x: -24.28, z: 22.36 }, { x: -19.03, z: 28.66 }, { x: -18.47, z: 53.8 }, { x: 0.11, z: 53.72 }, { x: 9.8, z: 46.05 }, { x: 17.05, z: 37.34 }] }, // stage 1
  { points: [{ x: 19.49, z: 31.95 }, { x: 22.51, z: 19.18 }, { x: 12.85, z: 13.01 }, { x: 9.91, z: 0.21 }, { x: -5.45, z: -6.54 }, { x: -4.3, z: -12.81 }] }, // stage 2
  { points: [{ x: -7.32, z: -19.8 }, { x: -24.92, z: -31.5 }, { x: -53.09, z: -55.94 }, { x: -42.01, z: -69.23 }, { x: -37.49, z: -81.76 }, { x: -55.82, z: -84.41 }, { x: -66.01, z: -79.41 }] }, // stage 3
  { points: [{ x: -73.35, z: -73.86 }, { x: -91.81, z: -31.91 }, { x: -90.71, z: 1.65 }, { x: -83.15, z: 39.3 }, { x: -66.22, z: 63.32 }] }, // stage 4
  { points: [{ x: -55.68, z: 70.2 }, { x: -30.69, z: 85.4 }, { x: -6.36, z: 88.07 }, { x: 12.56, z: 68.26 }, { x: 24.56, z: 78.09 }, { x: 33.33, z: 85.02 }, { x: 33.32, z: 104.37 }] }, // stage 5
  { points: [{ x: 43.2, z: 104.72 }, { x: 62.38, z: 95.21 }, { x: 72.76, z: 76.4 }, { x: 73.78, z: 46 }, { x: 63.17, z: 41.76 }, { x: 44.91, z: 33.66 }, { x: 45.22, z: 19.78 }] }, // stage 6
  { points: [{ x: 47.84, z: 10.86 }, { x: 60.51, z: -0.27 }, { x: 87.91, z: 0.48 }, { x: 102.12, z: -6.57 }, { x: 85.08, z: -62.55 }, { x: 64.01, z: -74.98 }, { x: 38.81, z: -78.08 }] }, // stage 7
  { points: [{ x: 28.76, z: -85.43 }, { x: 21.04, z: -55.22 }, { x: 11.14, z: -50.69 }, { x: 0.57, z: -45.85 }, { x: -8.44, z: -44.62 }, { x: -21.22, z: -29.96 }] }, // stage 8
  { points: [{ x: -15.81, z: -22.72 }, { x: -4.49, z: -11.34 }, { x: -0.35, z: -3.26 }, { x: 8.4, z: -0.27 }, { x: 12.12, z: 11.42 }, { x: 21.57, z: 16.58 }, { x: 22.71, z: 25.87 }] }, // stage 9
  { points: [{ x: 17.47, z: 37.16 }, { x: 3.3, z: 51.13 }, { x: -14.28, z: 54.61 }, { x: -19.49, z: 40.01 }, { x: -18.89, z: 28.85 }, { x: -24.47, z: 23.13 }, { x: -34.36, z: 23.95 }] }, // stage 10
  { points: [{ x: -47.38, z: 25.72 }] }, // stage 11
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

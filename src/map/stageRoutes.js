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
  { points: [{ x: -40.18, z: 19.12 }, { x: -17.34, z: 15.97 }, { x: -13.59, z: 20.47 }, { x: -13.19, z: 38.43 }, { x: 0.08, z: 38.37 }, { x: 7, z: 32.89 }, { x: 12.18, z: 26.67 }] }, // stage 1
  { points: [{ x: 13.92, z: 22.82 }, { x: 16.08, z: 13.7 }, { x: 9.18, z: 9.29 }, { x: 7.08, z: 0.15 }, { x: -3.89, z: -4.67 }, { x: -3.07, z: -9.15 }] }, // stage 2
  { points: [{ x: -5.23, z: -14.14 }, { x: -17.8, z: -22.5 }, { x: -37.92, z: -39.96 }, { x: -30.01, z: -49.45 }, { x: -26.78, z: -58.4 }, { x: -39.87, z: -60.29 }, { x: -47.15, z: -56.72 }] }, // stage 3
  { points: [{ x: -52.39, z: -52.76 }, { x: -65.58, z: -22.79 }, { x: -64.79, z: 1.18 }, { x: -59.39, z: 28.07 }, { x: -47.3, z: 45.23 }] }, // stage 4
  { points: [{ x: -39.77, z: 50.14 }, { x: -21.92, z: 61 }, { x: -4.54, z: 62.91 }, { x: 8.97, z: 48.76 }, { x: 17.54, z: 55.78 }, { x: 23.81, z: 60.73 }, { x: 23.8, z: 74.55 }] }, // stage 5
  { points: [{ x: 30.86, z: 74.8 }, { x: 44.56, z: 68.01 }, { x: 51.97, z: 54.57 }, { x: 52.7, z: 32.86 }, { x: 45.12, z: 29.83 }, { x: 32.08, z: 24.04 }, { x: 32.3, z: 14.13 }] }, // stage 6
  { points: [{ x: 34.17, z: 7.76 }, { x: 43.22, z: -0.19 }, { x: 62.79, z: 0.34 }, { x: 72.94, z: -4.69 }, { x: 60.77, z: -44.68 }, { x: 45.72, z: -53.56 }, { x: 27.72, z: -55.77 }] }, // stage 7
  { points: [{ x: 20.54, z: -61.02 }, { x: 15.03, z: -39.44 }, { x: 7.96, z: -36.21 }, { x: 0.41, z: -32.75 }, { x: -6.03, z: -31.87 }, { x: -15.16, z: -21.4 }] }, // stage 8
  { points: [{ x: -11.29, z: -16.23 }, { x: -3.21, z: -8.1 }, { x: -0.25, z: -2.33 }, { x: 6, z: -0.19 }, { x: 8.66, z: 8.16 }, { x: 15.41, z: 11.84 }, { x: 16.22, z: 18.48 }] }, // stage 9
  { points: [{ x: 12.48, z: 26.54 }, { x: 2.36, z: 36.52 }, { x: -10.2, z: 39.01 }, { x: -13.92, z: 28.58 }, { x: -13.49, z: 20.61 }, { x: -17.48, z: 16.52 }, { x: -24.54, z: 17.11 }] }, // stage 10
  { points: [{ x: -33.84, z: 18.37 }] }, // stage 11
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

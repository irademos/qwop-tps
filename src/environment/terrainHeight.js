// Terrain height = the highest value reported by the registered resolvers (the GLB map's
// downward raycast, see bootstrapGameApp.js), never below the active map's floor (flat ground
// when none reports a height). The floor is 0 unless the map sets one (an island map: just
// under its sea level, so characters wade in the shallows instead of sinking to the sea floor).
// An override (Town's rooms, under the map) wins outright where it reports a height.
// Layered ground (bridges, roof overhangs): a resolver can also list every surface at x, z
// (`layers`), so getTerrainLayersAt can tell the ground under a bridge from the deck over it.
let terrainFloor = 0;

export function setTerrainFloor(y = 0) {
  terrainFloor = Number.isFinite(y) ? y : 0;
}

const extraHeightResolvers = new Set();
// resolver → its layers(x, z): every surface height there, highest first
const resolverLayers = new Map();

export function registerTerrainHeightResolver(resolver, { layers } = {}) {
  if (typeof resolver !== "function") return () => {};
  extraHeightResolvers.add(resolver);
  if (typeof layers === "function") resolverLayers.set(resolver, layers);
  return () => {
    extraHeightResolvers.delete(resolver);
    resolverLayers.delete(resolver);
  };
}

const heightOverrides = new Set();

export function registerTerrainHeightOverride(override) {
  if (typeof override !== "function") return () => {};
  heightOverrides.add(override);
  return () => {
    heightOverrides.delete(override);
  };
}

export function getTerrainHeight(x = 0, z = 0) {
  for (const override of heightOverrides) {
    const y = override(x, z);
    if (Number.isFinite(y)) return y;
  }
  let height = terrainFloor;
  for (const resolver of extraHeightResolvers) {
    const resolved = resolver(x, z, height);
    if (Number.isFinite(resolved) && resolved > height) {
      height = resolved;
    }
  }
  return height;
}

const _layers = { below: 0, above: Infinity, onSurface: false };

/**
 * The ground at x, z on either side of height y: { below: the highest surface at or under y
 * (never under the floor), above: the lowest one over y (Infinity: none — open sky),
 * onSurface: below is a real surface, not just the floor }. A resolver without layers (the
 * ship's deck) counts as one surface. The result is reused between calls.
 */
export function getTerrainLayersAt(x = 0, z = 0, y = 0) {
  const out = _layers;
  for (const override of heightOverrides) {
    const oy = override(x, z);
    if (Number.isFinite(oy)) {
      out.below = oy;
      out.above = Infinity;
      out.onSurface = true;
      return out;
    }
  }
  let below = -Infinity;
  let above = Infinity;
  for (const resolver of extraHeightResolvers) {
    const layers = resolverLayers.get(resolver);
    if (layers) {
      for (const h of layers(x, z)) {
        if (h > y) above = Math.min(above, h);
        else { below = Math.max(below, h); break; } // (highest first)
      }
      continue;
    }
    const h = resolver(x, z, terrainFloor);
    if (!Number.isFinite(h)) continue;
    if (h > y) above = Math.min(above, h);
    else below = Math.max(below, h);
  }
  out.onSurface = below > -Infinity;
  out.below = Math.max(below, terrainFloor);
  out.above = above;
  return out;
}

// Walls at body height between two spots (the map's sideways raycast, registered by
// bootstrapGameApp.js): tells a wall from a bridge / a roof overhang one can walk under
let wallProbe = null;

export function registerWallProbe(probe) {
  wallProbe = typeof probe === "function" ? probe : null;
  return () => {
    if (wallProbe === probe) wallProbe = null;
  };
}

// True when the map has a wall on the level line at height y from (x0, z0) to (x1, z1)
export function isMapWallBetween(x0, y, z0, x1, z1) {
  return !!wallProbe && wallProbe(x0, y, z0, x1, z1);
}

// Terrain height = the highest value reported by the registered resolvers (the GLB map's
// downward raycast, see bootstrapGameApp.js), or flat ground when none reports a height.
const FLAT_TERRAIN_HEIGHT = 0;

const extraHeightResolvers = new Set();

export function registerTerrainHeightResolver(resolver) {
  if (typeof resolver !== "function") return () => {};
  extraHeightResolvers.add(resolver);
  return () => {
    extraHeightResolvers.delete(resolver);
  };
}

export function getTerrainHeight(x = 0, z = 0) {
  let height = FLAT_TERRAIN_HEIGHT;
  for (const resolver of extraHeightResolvers) {
    const resolved = resolver(x, z, height);
    if (Number.isFinite(resolved) && resolved > height) {
      height = resolved;
    }
  }
  return height;
}

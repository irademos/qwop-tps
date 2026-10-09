// Terrain height = the highest value reported by the registered resolvers (the GLB map's
// downward raycast, see bootstrapGameApp.js), never below the active map's floor (flat ground
// when none reports a height). The floor is 0 unless the map sets one (an island map: just
// under its sea level, so characters wade in the shallows instead of sinking to the sea floor).
let terrainFloor = 0;

export function setTerrainFloor(y = 0) {
  terrainFloor = Number.isFinite(y) ? y : 0;
}

const extraHeightResolvers = new Set();

export function registerTerrainHeightResolver(resolver) {
  if (typeof resolver !== "function") return () => {};
  extraHeightResolvers.add(resolver);
  return () => {
    extraHeightResolvers.delete(resolver);
  };
}

export function getTerrainHeight(x = 0, z = 0) {
  let height = terrainFloor;
  for (const resolver of extraHeightResolvers) {
    const resolved = resolver(x, z, height);
    if (Number.isFinite(resolved) && resolved > height) {
      height = resolved;
    }
  }
  return height;
}

const FLAT_TERRAIN_HEIGHT = 0;

const stampDebugOptions = {
  showPriority: false,
  showInfluenceRadii: false
};
const extraHeightResolvers = new Set();

export function getBaseTerrainHeight() {
  return FLAT_TERRAIN_HEIGHT;
}

export function setTerrainStampsForTile() {
  // Flat terrain mode: terrain stamp data is intentionally ignored.
}

export function setBuildingStampsForTile() {
  // Flat terrain mode: terrain stamp data is intentionally ignored.
}

export function clearTerrainStampsForTile() {
  // Flat terrain mode: nothing is cached per tile.
}

export function consumeDirtyTerrainChunks() {
  return [];
}

export function getStampedTerrainHeight() {
  return FLAT_TERRAIN_HEIGHT;
}

export function setTerrainStampDebugOptions(options = {}) {
  if (typeof options.showPriority === "boolean") stampDebugOptions.showPriority = options.showPriority;
  if (typeof options.showInfluenceRadii === "boolean") stampDebugOptions.showInfluenceRadii = options.showInfluenceRadii;
}

export function getTerrainStampDebugOptions() {
  return { ...stampDebugOptions };
}

export function getTerrainStampDebugDataForChunk() {
  return [];
}

export function getTerrainStampDebugSample(x, z) {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
  return {
    x,
    z,
    chunkX: 0,
    chunkZ: 0,
    baseHeight: FLAT_TERRAIN_HEIGHT,
    stampedHeight: FLAT_TERRAIN_HEIGHT,
    slopeAngleDeg: 0,
    slopeGradient: 0,
    stampInfluence: {
      total: 0,
      normalized: 0,
      appliedCount: 0,
      strongest: null
    }
  };
}

export function getTerrainHeight(x = 0, z = 0) {
  return getTerrainHeightAt(x, z);
}

export function registerTerrainHeightResolver(resolver) {
  if (typeof resolver !== "function") return () => {};
  extraHeightResolvers.add(resolver);
  return () => {
    extraHeightResolvers.delete(resolver);
  };
}

export function getTerrainHeightAt(x = 0, z = 0) {
  let height = FLAT_TERRAIN_HEIGHT;
  for (const resolver of extraHeightResolvers) {
    const resolved = resolver(x, z, height);
    if (Number.isFinite(resolved) && resolved > height) {
      height = resolved;
    }
  }
  return height;
}

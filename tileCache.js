const METERS_PER_DEGREE_LAT = 111_132.92;

function metersPerDegreeLon(lat) {
  return 111_412.84 * Math.cos((lat * Math.PI) / 180);
}

export function createTileCache({
  tileSizeMeters = 300,
  evictRadiusTiles = 2
} = {}) {
  const cache = new Map();
  let origin = null;

  const setOrigin = (nextOrigin) => {
    if (!nextOrigin || !Number.isFinite(nextOrigin.lat) || !Number.isFinite(nextOrigin.lon)) {
      origin = null;
      return origin;
    }
    origin = { lat: nextOrigin.lat, lon: nextOrigin.lon };
    return origin;
  };

  const getOrigin = () => origin;

  const ensureOrigin = (location) => {
    if (!origin && location && Number.isFinite(location.lat) && Number.isFinite(location.lon)) {
      origin = { lat: location.lat, lon: location.lon };
    }
    return origin;
  };

  const getLocalMeters = (location) => {
    const base = ensureOrigin(location);
    if (!base) return null;
    const lonScale = metersPerDegreeLon(base.lat);
    return {
      x: -(location.lon - base.lon) * lonScale,
      z: (location.lat - base.lat) * METERS_PER_DEGREE_LAT
    };
  };

  const getTileCoords = (localMeters) => {
    if (!localMeters) return null;
    return {
      x: Math.floor(localMeters.x / tileSizeMeters),
      y: Math.floor(localMeters.z / tileSizeMeters)
    };
  };

  const getTileKey = (tile) => `${tile.x},${tile.y}`;

  const getTileCenterLocation = (tile) => {
    if (!origin) return null;
    const lonScale = metersPerDegreeLon(origin.lat);
    const centerLocal = {
      x: (tile.x + 0.5) * tileSizeMeters,
      z: (tile.y + 0.5) * tileSizeMeters
    };
    return {
      lat: origin.lat + centerLocal.z / METERS_PER_DEGREE_LAT,
      lon: origin.lon - centerLocal.x / lonScale
    };
  };

  const hasTile = (key) => cache.has(key);

  const getEntry = (key) => cache.get(key);

  const setTile = (tile, { geojson = null, meshes = null, fetchedAt = Date.now() } = {}) => {
    const key = getTileKey(tile);
    cache.set(key, {
      tile,
      geojson,
      meshes,
      fetchedAt
    });
    return key;
  };

  const evictTiles = (centerTile) => {
    const evictedKeys = [];
    for (const [key, entry] of cache.entries()) {
      const tile = entry.tile;
      const dx = Math.abs(tile.x - centerTile.x);
      const dy = Math.abs(tile.y - centerTile.y);
      if (Math.max(dx, dy) > evictRadiusTiles) {
        cache.delete(key);
        evictedKeys.push(key);
      }
    }
    return evictedKeys;
  };

  return {
    tileSizeMeters,
    evictRadiusTiles,
    cache,
    setOrigin,
    getOrigin,
    ensureOrigin,
    getLocalMeters,
    getTileCoords,
    getTileKey,
    getTileCenterLocation,
    hasTile,
    getEntry,
    setTile,
    evictTiles
  };
}

import { resolveRoadWidth } from "./roadWidths.js";

const METERS_PER_DEGREE_LAT = 111_132.92;

const BASE_NOISE_SCALE_X = 0.0035;
const BASE_NOISE_SCALE_Z = 0.0042;
const BASE_NOISE_SCALE_DIAG = 0.0024;
const BASE_HEIGHT_A = 0.35;
const BASE_HEIGHT_B = 0.25;
const BASE_HEIGHT_C = 0.15;

const BUILDING_FALLOFF_METERS = 8;
const ROAD_FALLOFF_METERS = 6;
const CHUNK_SIZE_METERS = 64;
const QUERY_CACHE_GRID_METERS = 0.5;

const STAMP_PRIORITY = Object.freeze({
  BUILDING: 300,
  ROAD_MAJOR: 200,
  ROAD_MINOR: 100
});

const MAJOR_ROAD_TYPES = new Set([
  "motorway",
  "trunk",
  "primary",
  "secondary",
  "motorway_link",
  "trunk_link",
  "primary_link",
  "secondary_link"
]);

const terrainStampTiles = new Map();
const terrainChunkStampCache = new Map();
const terrainChunkHeightCache = new Map();
const dirtyTerrainChunks = new Set();

const stampDebugOptions = {
  showPriority: false,
  showInfluenceRadii: false
};

function hashString(value) {
  let hash = 2166136261;
  const text = String(value ?? "");
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function metersPerDegreeLon(latDeg) {
  return 111_412.84 * Math.cos((latDeg * Math.PI) / 180);
}

function toLocalMeters(coord, origin, lonScale) {
  const [lon, lat] = coord;
  return {
    x: -(lon - origin.centerLon) * lonScale,
    z: (lat - origin.centerLat) * METERS_PER_DEGREE_LAT
  };
}

function quintic01(t) {
  const c = Math.min(Math.max(t, 0), 1);
  return c * c * c * (c * (c * 6 - 15) + 10);
}

function distanceToSegment2D(px, pz, ax, az, bx, bz) {
  const abx = bx - ax;
  const abz = bz - az;
  const apx = px - ax;
  const apz = pz - az;
  const denom = abx * abx + abz * abz;
  if (denom <= Number.EPSILON) return Math.hypot(apx, apz);
  const t = Math.min(Math.max((apx * abx + apz * abz) / denom, 0), 1);
  const qx = ax + abx * t;
  const qz = az + abz * t;
  return Math.hypot(px - qx, pz - qz);
}

function isPointInRing(x, z, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i].x;
    const zi = ring[i].z;
    const xj = ring[j].x;
    const zj = ring[j].z;
    const intersects = ((zi > z) !== (zj > z))
      && (x < ((xj - xi) * (z - zi)) / ((zj - zi) || Number.EPSILON) + xi);
    if (intersects) inside = !inside;
  }
  return inside;
}

function isPointInPolygonWithHoles(x, z, rings) {
  if (!Array.isArray(rings) || rings.length === 0) return false;
  if (!isPointInRing(x, z, rings[0])) return false;
  for (let i = 1; i < rings.length; i += 1) {
    if (isPointInRing(x, z, rings[i])) return false;
  }
  return true;
}

function distanceToRingEdges(x, z, ring) {
  let minDist = Infinity;
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const d = distanceToSegment2D(x, z, a.x, a.z, b.x, b.z);
    if (d < minDist) minDist = d;
  }
  return minDist;
}

function distanceToPolygonBoundary(x, z, rings) {
  let minDist = Infinity;
  for (const ring of rings) {
    if (!ring || ring.length < 2) continue;
    const d = distanceToRingEdges(x, z, ring);
    if (d < minDist) minDist = d;
  }
  return minDist;
}

function computeRoadGrade(points) {
  let total = 0;
  for (const point of points) {
    total += getBaseTerrainHeight(point.x, point.z);
  }
  return points.length > 0 ? total / points.length : 0;
}

function buildStampBoundsFromPoints(points, radius = 0) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const point of points ?? []) {
    if (!point) continue;
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minZ = Math.min(minZ, point.z);
    maxZ = Math.max(maxZ, point.z);
  }
  if (!Number.isFinite(minX)) return null;
  return {
    minX: minX - radius,
    maxX: maxX + radius,
    minZ: minZ - radius,
    maxZ: maxZ + radius
  };
}

function stampIntersectsBounds(stamp, bounds) {
  const s = stamp?.bounds;
  if (!s || !bounds) return false;
  return !(s.maxX < bounds.minX || s.minX > bounds.maxX || s.maxZ < bounds.minZ || s.minZ > bounds.maxZ);
}

function getChunkCoord(value) {
  return Math.floor(value / CHUNK_SIZE_METERS);
}

function getChunkKey(cx, cz) {
  return `${cx},${cz}`;
}

function getChunkBounds(cx, cz) {
  const minX = cx * CHUNK_SIZE_METERS;
  const minZ = cz * CHUNK_SIZE_METERS;
  return {
    minX,
    maxX: minX + CHUNK_SIZE_METERS,
    minZ,
    maxZ: minZ + CHUNK_SIZE_METERS
  };
}

function collectChunksForStamp(stamp) {
  const bounds = stamp?.bounds;
  if (!bounds) return [];
  const minChunkX = getChunkCoord(bounds.minX);
  const maxChunkX = getChunkCoord(bounds.maxX);
  const minChunkZ = getChunkCoord(bounds.minZ);
  const maxChunkZ = getChunkCoord(bounds.maxZ);
  const chunks = [];
  for (let cx = minChunkX; cx <= maxChunkX; cx += 1) {
    for (let cz = minChunkZ; cz <= maxChunkZ; cz += 1) {
      chunks.push(getChunkKey(cx, cz));
    }
  }
  return chunks;
}

function invalidateChunks(chunkKeys) {
  for (const chunkKey of chunkKeys) {
    terrainChunkStampCache.delete(chunkKey);
    terrainChunkHeightCache.delete(chunkKey);
    dirtyTerrainChunks.add(chunkKey);
  }
}

function invalidateTileChunkCache(previousTileData, nextTileData) {
  const chunkKeys = new Set();
  for (const stamp of previousTileData?.stamps ?? []) {
    for (const chunkKey of collectChunksForStamp(stamp)) {
      chunkKeys.add(chunkKey);
    }
  }
  for (const stamp of nextTileData?.stamps ?? []) {
    for (const chunkKey of collectChunksForStamp(stamp)) {
      chunkKeys.add(chunkKey);
    }
  }
  invalidateChunks(chunkKeys);
}

function compareStampsDeterministic(a, b) {
  if ((b.priority ?? 0) !== (a.priority ?? 0)) return (b.priority ?? 0) - (a.priority ?? 0);
  if ((a.type ?? "") !== (b.type ?? "")) return (a.type ?? "").localeCompare(b.type ?? "");
  return (a.id ?? 0) - (b.id ?? 0);
}

function collectAllStamps() {
  const all = [];
  for (const tileData of terrainStampTiles.values()) {
    for (const stamp of tileData?.stamps ?? []) {
      all.push(stamp);
    }
  }
  all.sort(compareStampsDeterministic);
  return all;
}

function getStampsForChunk(cx, cz) {
  const chunkKey = getChunkKey(cx, cz);
  const cached = terrainChunkStampCache.get(chunkKey);
  if (cached) return cached;

  const bounds = getChunkBounds(cx, cz);
  const stamps = collectAllStamps().filter((stamp) => stampIntersectsBounds(stamp, bounds));
  const chunkData = { bounds, stamps };
  terrainChunkStampCache.set(chunkKey, chunkData);
  return chunkData;
}

function quantizeToGrid(value, step) {
  return Math.round(value / step) * step;
}

function computeStampDistanceToCore(stamp, x, z) {
  if (!stamp) return Infinity;
  if (stamp.geometryType === "line") {
    let minDistanceToCenter = Infinity;
    const points = stamp.centerline ?? [];
    for (let i = 0; i < points.length - 1; i += 1) {
      const a = points[i];
      const b = points[i + 1];
      const d = distanceToSegment2D(x, z, a.x, a.z, b.x, b.z);
      if (d < minDistanceToCenter) minDistanceToCenter = d;
    }
    if (!Number.isFinite(minDistanceToCenter)) return Infinity;
    return Math.max(0, minDistanceToCenter - (stamp.innerRadius ?? 0));
  }

  if (stamp.geometryType === "polygon") {
    const isInside = isPointInPolygonWithHoles(x, z, stamp.rings);
    if (isInside) return 0;
    return distanceToPolygonBoundary(x, z, stamp.rings);
  }

  return Infinity;
}

function computeStampInfluence(stamp, x, z) {
  const distanceToCore = computeStampDistanceToCore(stamp, x, z);
  if (!Number.isFinite(distanceToCore)) return null;

  const falloffRadius = Math.max(stamp.falloffRadius ?? 0, 0);
  if (distanceToCore > falloffRadius) return null;
  const influence = falloffRadius <= 0 ? 1 : 1 - quintic01(distanceToCore / Math.max(falloffRadius, Number.EPSILON));
  if (influence <= 0) return null;

  const innerRadius = Math.max(stamp.innerRadius ?? 0, 0);
  const coreWeight = 1 - Math.min(distanceToCore / Math.max(innerRadius + falloffRadius, Number.EPSILON), 1);
  return {
    influence,
    coreWeight: Math.max(coreWeight, Number.EPSILON)
  };
}

function applyStampCompositor(baseHeight, stamps, x, z) {
  if (!Array.isArray(stamps) || stamps.length === 0) return baseHeight;

  const byPriority = new Map();
  for (const stamp of stamps) {
    const contribution = computeStampInfluence(stamp, x, z);
    if (!contribution) continue;
    const priority = stamp.priority ?? 0;
    if (!byPriority.has(priority)) byPriority.set(priority, []);
    byPriority.get(priority).push({ stamp, ...contribution });
  }

  if (byPriority.size === 0) return baseHeight;

  const priorities = Array.from(byPriority.keys()).sort((a, b) => b - a);
  let height = baseHeight;

  for (const priority of priorities) {
    const contributions = byPriority.get(priority) ?? [];
    if (contributions.length === 0) continue;

    let influenceTotal = 0;
    let weightedTarget = 0;
    let coreWeightTotal = 0;
    for (const item of contributions) {
      influenceTotal += item.influence;
      coreWeightTotal += item.coreWeight;
      weightedTarget += item.stamp.targetGrade * item.coreWeight;
    }
    if (influenceTotal <= 0 || coreWeightTotal <= 0) continue;

    const target = weightedTarget / coreWeightTotal;
    const blend = Math.min(influenceTotal, 1);
    height = height * (1 - blend) + target * blend;
  }

  return height;
}

function classifyRoadPriority(highwayType) {
  return MAJOR_ROAD_TYPES.has(highwayType) ? STAMP_PRIORITY.ROAD_MAJOR : STAMP_PRIORITY.ROAD_MINOR;
}

function buildRoadStamp(points, width, highwayType) {
  if (!Array.isArray(points) || points.length < 2 || !Number.isFinite(width) || width <= 0) return null;
  const innerRadius = width * 0.5;
  const falloffRadius = ROAD_FALLOFF_METERS;
  return {
    id: 0,
    type: "road",
    geometryType: "line",
    centerline: points,
    targetGrade: computeRoadGrade(points),
    innerRadius,
    falloffRadius,
    priority: classifyRoadPriority(highwayType),
    bounds: buildStampBoundsFromPoints(points, innerRadius + falloffRadius)
  };
}

function buildDeterministicStampId(tileKey, sourceType, featureIndex, partIndex) {
  return hashString(`${tileKey}:${sourceType}:${featureIndex}:${partIndex}`);
}

function collectRoads(geojson, origin, lonScale, tileKey) {
  const roads = [];
  const features = geojson?.prefiltered?.highways ?? geojson?.features ?? [];
  let featureIndex = 0;
  for (const feature of features) {
    if (!feature?.properties?.highway) continue;
    const geometry = feature.geometry;
    if (!geometry) continue;
    const classifiedWidth = resolveRoadWidth(feature.properties.highway);
    const explicitWidth = Number(feature?.properties?.width);
    const width = Number.isFinite(explicitWidth) && explicitWidth > 0 ? explicitWidth : classifiedWidth;
    const lines = geometry.type === "LineString"
      ? [geometry.coordinates]
      : geometry.type === "MultiLineString"
        ? geometry.coordinates
        : [];
    let partIndex = 0;
    for (const line of lines) {
      if (!Array.isArray(line) || line.length < 2) continue;
      const points = [];
      for (const coord of line) {
        if (!coord || coord.length < 2) continue;
        const [lon, lat] = coord;
        if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
        points.push(toLocalMeters(coord, origin, lonScale));
      }
      const stamp = buildRoadStamp(points, width, feature.properties.highway);
      if (stamp) {
        stamp.id = buildDeterministicStampId(tileKey, "road", featureIndex, partIndex);
        roads.push(stamp);
      }
      partIndex += 1;
    }
    featureIndex += 1;
  }
  return roads;
}

export function getBaseTerrainHeight(x, z) {
  return (
    Math.sin(x * BASE_NOISE_SCALE_X) * BASE_HEIGHT_A
    + Math.sin(z * BASE_NOISE_SCALE_Z) * BASE_HEIGHT_B
    + Math.sin((x + z) * BASE_NOISE_SCALE_DIAG) * BASE_HEIGHT_C
  );
}

export function setTerrainStampsForTile(tileKey, geojson, bounds) {
  if (!tileKey || !geojson || !bounds) return;
  const lonScale = metersPerDegreeLon(bounds.centerLat);
  const roads = collectRoads(geojson, bounds, lonScale, tileKey);
  const previousTileData = terrainStampTiles.get(tileKey);
  const buildings = previousTileData?.buildings ?? [];
  const nextTileData = { roads, buildings, stamps: [...roads, ...buildings] };
  terrainStampTiles.set(tileKey, nextTileData);
  invalidateTileChunkCache(previousTileData, nextTileData);
}

export function setBuildingStampsForTile(tileKey, buildings) {
  if (!tileKey) return;
  const previousTileData = terrainStampTiles.get(tileKey);
  const roads = previousTileData?.roads ?? [];
  const normalizedBuildings = (Array.isArray(buildings) ? buildings : []).map((building, index) => {
    const falloffRadius = building.falloffRadius ?? building.falloff ?? BUILDING_FALLOFF_METERS;
    const rings = building.rings ?? [];
    return {
      id: buildDeterministicStampId(tileKey, "building", index, 0),
      type: "building",
      geometryType: "polygon",
      rings,
      targetGrade: building.targetGrade ?? building.targetHeight ?? 0,
      innerRadius: Math.max(building.innerRadius ?? 0, 0),
      falloffRadius,
      priority: building.priority ?? STAMP_PRIORITY.BUILDING,
      bounds: building.bounds ?? buildStampBoundsFromPoints(rings.flat(), falloffRadius)
    };
  });
  const nextTileData = {
    roads,
    buildings: normalizedBuildings,
    stamps: [...roads, ...normalizedBuildings]
  };
  terrainStampTiles.set(tileKey, nextTileData);
  invalidateTileChunkCache(previousTileData, nextTileData);
}

export function clearTerrainStampsForTile(tileKey) {
  const previousTileData = terrainStampTiles.get(tileKey);
  terrainStampTiles.delete(tileKey);
  invalidateTileChunkCache(previousTileData, null);
}

export function consumeDirtyTerrainChunks() {
  const dirtyChunks = Array.from(dirtyTerrainChunks);
  dirtyTerrainChunks.clear();
  return dirtyChunks;
}

export function getStampedTerrainHeight(x, z) {
  const baseHeight = getBaseTerrainHeight(x, z);

  const cx = getChunkCoord(x);
  const cz = getChunkCoord(z);
  const chunkKey = getChunkKey(cx, cz);

  let heightCache = terrainChunkHeightCache.get(chunkKey);
  if (!heightCache) {
    heightCache = new Map();
    terrainChunkHeightCache.set(chunkKey, heightCache);
  }

  const qx = quantizeToGrid(x, QUERY_CACHE_GRID_METERS);
  const qz = quantizeToGrid(z, QUERY_CACHE_GRID_METERS);
  const localKey = `${qx},${qz}`;
  const cached = heightCache.get(localKey);
  if (Number.isFinite(cached)) return cached;

  const chunkData = getStampsForChunk(cx, cz);
  const compositedHeight = applyStampCompositor(baseHeight, chunkData.stamps, x, z);
  heightCache.set(localKey, compositedHeight);
  return compositedHeight;
}

export function setTerrainStampDebugOptions(options = {}) {
  if (typeof options.showPriority === "boolean") stampDebugOptions.showPriority = options.showPriority;
  if (typeof options.showInfluenceRadii === "boolean") stampDebugOptions.showInfluenceRadii = options.showInfluenceRadii;
}

export function getTerrainStampDebugOptions() {
  return { ...stampDebugOptions };
}

export function getTerrainStampDebugDataForChunk(chunkX, chunkZ) {
  if (!stampDebugOptions.showPriority && !stampDebugOptions.showInfluenceRadii) return [];
  const chunk = getStampsForChunk(chunkX, chunkZ);
  return (chunk.stamps ?? []).map((stamp) => ({
    id: stamp.id,
    type: stamp.type,
    geometryType: stamp.geometryType,
    priority: stampDebugOptions.showPriority ? stamp.priority : undefined,
    innerRadius: stampDebugOptions.showInfluenceRadii ? stamp.innerRadius : undefined,
    falloffRadius: stampDebugOptions.showInfluenceRadii ? stamp.falloffRadius : undefined,
    bounds: stamp.bounds
  }));
}

export function getTerrainHeight(x, z) {
  return getStampedTerrainHeight(x, z);
}

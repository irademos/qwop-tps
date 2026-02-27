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

const terrainStampTiles = new Map();

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

function smoothstep01(t) {
  const c = Math.min(Math.max(t, 0), 1);
  return c * c * (3 - 2 * c);
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

function normalizeRing(ring) {
  if (!Array.isArray(ring) || ring.length < 3) return null;
  const coords = ring.slice();
  const first = coords[0];
  const last = coords[coords.length - 1];
  if (first?.[0] === last?.[0] && first?.[1] === last?.[1]) {
    coords.pop();
  }
  return coords.length >= 3 ? coords : null;
}

function calcInfluence(distance, falloff) {
  if (distance <= 0) return 1;
  if (distance >= falloff) return 0;
  return 1 - smoothstep01(distance / falloff);
}

function computeRoadGrade(points) {
  let total = 0;
  for (const point of points) {
    total += getBaseTerrainHeight(point.x, point.z);
  }
  return points.length > 0 ? total / points.length : 0;
}

function buildRoadStamp(points, width) {
  if (!Array.isArray(points) || points.length < 2 || !Number.isFinite(width) || width <= 0) return null;
  const innerHalfWidth = width * 0.5;
  return {
    centerline: points,
    innerHalfWidth,
    outerHalfWidth: innerHalfWidth + ROAD_FALLOFF_METERS,
    targetHeight: computeRoadGrade(points)
  };
}

function collectRoads(geojson, origin, lonScale) {
  const roads = [];
  const features = geojson?.prefiltered?.highways ?? geojson?.features ?? [];
  for (const feature of features) {
    if (!feature?.properties?.highway) continue;
    const geometry = feature.geometry;
    if (!geometry) continue;
    const classifiedWidth = resolveRoadWidth(feature.properties.highway);
    const explicitWidth = Number(feature?.properties?.width);
    const width = Number.isFinite(explicitWidth) && explicitWidth > 0 ? explicitWidth : classifiedWidth;
    const lines = geometry.type === 'LineString'
      ? [geometry.coordinates]
      : geometry.type === 'MultiLineString'
        ? geometry.coordinates
        : [];
    for (const line of lines) {
      if (!Array.isArray(line) || line.length < 2) continue;
      const points = [];
      for (const coord of line) {
        if (!coord || coord.length < 2) continue;
        const [lon, lat] = coord;
        if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
        points.push(toLocalMeters(coord, origin, lonScale));
      }
      const stamp = buildRoadStamp(points, width);
      if (stamp) roads.push(stamp);
    }
  }
  return roads;
}

function collectBuildings(geojson, origin, lonScale) {
  const buildings = [];
  const features = geojson?.prefiltered?.buildings ?? geojson?.features ?? [];
  for (const feature of features) {
    if (!feature?.properties?.building) continue;
    const geometry = feature.geometry;
    if (!geometry) continue;
    const polygons = geometry.type === 'Polygon'
      ? [geometry.coordinates]
      : geometry.type === 'MultiPolygon'
        ? geometry.coordinates
        : [];
    for (const poly of polygons) {
      if (!Array.isArray(poly) || poly.length === 0) continue;
      const rings = [];
      for (const rawRing of poly) {
        const normalized = normalizeRing(rawRing);
        if (!normalized) continue;
        const ring = [];
        for (const coord of normalized) {
          if (!coord || coord.length < 2) continue;
          const [lon, lat] = coord;
          if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
          ring.push(toLocalMeters(coord, origin, lonScale));
        }
        if (ring.length >= 3) rings.push(ring);
      }
      if (rings.length === 0) continue;
      const outer = rings[0];
      let sx = 0;
      let sz = 0;
      for (const point of outer) {
        sx += point.x;
        sz += point.z;
      }
      const cx = sx / outer.length;
      const cz = sz / outer.length;
      buildings.push({
        rings,
        targetHeight: getBaseTerrainHeight(cx, cz),
        falloff: BUILDING_FALLOFF_METERS
      });
    }
  }
  return buildings;
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
  const roads = collectRoads(geojson, bounds, lonScale);
  const buildings = collectBuildings(geojson, bounds, lonScale);
  terrainStampTiles.set(tileKey, { roads, buildings });
}

export function clearTerrainStampsForTile(tileKey) {
  terrainStampTiles.delete(tileKey);
}

export function getStampedTerrainHeight(x, z) {
  const baseHeight = getBaseTerrainHeight(x, z);

  let roadInfluenceTotal = 0;
  let roadWeightedTarget = 0;
  for (const stampData of terrainStampTiles.values()) {
    for (const road of stampData.roads ?? []) {
      let minDistanceToCenter = Infinity;
      const points = road.centerline ?? [];
      for (let i = 0; i < points.length - 1; i += 1) {
        const a = points[i];
        const b = points[i + 1];
        const d = distanceToSegment2D(x, z, a.x, a.z, b.x, b.z);
        if (d < minDistanceToCenter) minDistanceToCenter = d;
      }
      if (!Number.isFinite(minDistanceToCenter)) continue;
      let influence = 0;
      if (minDistanceToCenter <= road.innerHalfWidth) {
        influence = 1;
      } else if (minDistanceToCenter < road.outerHalfWidth) {
        const band = Math.max(road.outerHalfWidth - road.innerHalfWidth, Number.EPSILON);
        const t = (minDistanceToCenter - road.innerHalfWidth) / band;
        influence = 1 - quintic01(t);
      }
      if (influence <= 0) continue;
      roadInfluenceTotal += influence;
      roadWeightedTarget += road.targetHeight * influence;
    }
  }

  let terrainHeight = baseHeight;
  if (roadInfluenceTotal > 0) {
    const roadBlend = Math.min(roadInfluenceTotal, 1);
    const roadTarget = roadWeightedTarget / roadInfluenceTotal;
    terrainHeight = baseHeight * (1 - roadBlend) + roadTarget * roadBlend;
  }

  let buildingInfluenceTotal = 0;
  let buildingWeightedTarget = 0;
  for (const stampData of terrainStampTiles.values()) {
    for (const building of stampData.buildings ?? []) {
      const isInside = isPointInPolygonWithHoles(x, z, building.rings);
      const distance = isInside ? 0 : distanceToPolygonBoundary(x, z, building.rings);
      const influence = calcInfluence(distance, building.falloff ?? BUILDING_FALLOFF_METERS);
      if (influence <= 0) continue;
      buildingInfluenceTotal += influence;
      buildingWeightedTarget += building.targetHeight * influence;
    }
  }

  if (buildingInfluenceTotal <= 0) return terrainHeight;
  const buildingBlend = Math.min(buildingInfluenceTotal, 1);
  const buildingTarget = buildingWeightedTarget / buildingInfluenceTotal;
  return terrainHeight * (1 - buildingBlend) + buildingTarget * buildingBlend;
}

export function getTerrainHeight(x, z) {
  return getStampedTerrainHeight(x, z);
}

import * as THREE from 'three';

// Store all water bodies for later lookup
const waterBodies = [];
const islandAreas = [];
const waterWaves = [];
let wavesScene = null;

export const SEA_FLOOR_Y = -2;
const MAX_LAKE_DEPTH = 1.5;
export const SWIM_DEPTH_THRESHOLD = 0.7;

const TERRAIN_AREA_SIZE = 220;
const TERRAIN_MICRO_GRID = 16;
const TERRAIN_HILLY_RATIO = 0.25;
const TERRAIN_MAX_HEIGHT_MIN = 1.8;
const TERRAIN_MAX_HEIGHT_MAX = 7.2;
const TERRAIN_HEIGHT_STEP = 0.28;

const FLATTEN_BUCKET_SIZE = 80;
const flattenGrid = new Map();
const flattenZoneById = new Map();
const flattenIdsBySource = new Map();
let flattenZoneIdCounter = 0;

function hash2i(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function smoothstep(t) {
  return t * t * (3 - 2 * t);
}

function valueNoise2(x, z) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const tx = x - ix;
  const tz = z - iz;
  const h00 = hash2i(ix, iz);
  const h10 = hash2i(ix + 1, iz);
  const h01 = hash2i(ix, iz + 1);
  const h11 = hash2i(ix + 1, iz + 1);
  const sx = smoothstep(tx);
  const sz = smoothstep(tz);
  const nx0 = h00 + (h10 - h00) * sx;
  const nx1 = h01 + (h11 - h01) * sx;
  return nx0 + (nx1 - nx0) * sz;
}

function quantizeHeight(height) {
  return Math.round(height / TERRAIN_HEIGHT_STEP) * TERRAIN_HEIGHT_STEP;
}

function computeProceduralHillHeight(x, z) {
  const areaX = Math.floor(x / TERRAIN_AREA_SIZE);
  const areaZ = Math.floor(z / TERRAIN_AREA_SIZE);
  const areaNoise = hash2i(areaX, areaZ);
  if (areaNoise >= TERRAIN_HILLY_RATIO) return 0;

  const maxHeightRand = hash2i(areaX + 97, areaZ - 113);
  const maxHeight = THREE.MathUtils.lerp(TERRAIN_MAX_HEIGHT_MIN, TERRAIN_MAX_HEIGHT_MAX, maxHeightRand);

  const sampleX = x / TERRAIN_MICRO_GRID;
  const sampleZ = z / TERRAIN_MICRO_GRID;
  const nA = valueNoise2(sampleX * 0.7, sampleZ * 0.7);
  const nB = valueNoise2(sampleX * 0.23 + 19.4, sampleZ * 0.23 - 11.2);
  const n = THREE.MathUtils.clamp(nA * 0.78 + nB * 0.22, 0, 1);

  const hillMask = Math.pow(n, 1.55);
  return quantizeHeight(hillMask * maxHeight);
}

function buildGridBuckets(bounds) {
  const minX = Math.floor(bounds.minX / FLATTEN_BUCKET_SIZE);
  const maxX = Math.floor(bounds.maxX / FLATTEN_BUCKET_SIZE);
  const minZ = Math.floor(bounds.minZ / FLATTEN_BUCKET_SIZE);
  const maxZ = Math.floor(bounds.maxZ / FLATTEN_BUCKET_SIZE);
  const buckets = [];
  for (let gx = minX; gx <= maxX; gx += 1) {
    for (let gz = minZ; gz <= maxZ; gz += 1) {
      buckets.push(`${gx},${gz}`);
    }
  }
  return buckets;
}

function registerFlattenZone(sourceKey, zone) {
  const id = ++flattenZoneIdCounter;
  const buckets = buildGridBuckets(zone.bounds);
  flattenZoneById.set(id, { ...zone, id, buckets });
  if (!flattenIdsBySource.has(sourceKey)) flattenIdsBySource.set(sourceKey, new Set());
  flattenIdsBySource.get(sourceKey).add(id);
  for (const bucket of buckets) {
    let entries = flattenGrid.get(bucket);
    if (!entries) {
      entries = new Set();
      flattenGrid.set(bucket, entries);
    }
    entries.add(id);
  }
}

function unregisterFlattenId(id) {
  const zone = flattenZoneById.get(id);
  if (!zone) return;
  flattenZoneById.delete(id);
  for (const bucket of zone.buckets || []) {
    const entries = flattenGrid.get(bucket);
    if (!entries) continue;
    entries.delete(id);
    if (entries.size === 0) flattenGrid.delete(bucket);
  }
}

export function clearTerrainFlatteningForSource(sourceKey) {
  if (!sourceKey) return;
  const ids = flattenIdsBySource.get(sourceKey);
  if (!ids) return;
  ids.forEach((id) => unregisterFlattenId(id));
  flattenIdsBySource.delete(sourceKey);
}

export function registerTerrainRoadSegments(sourceKey, segments = []) {
  clearTerrainFlatteningForSource(`${sourceKey}:roads`);
  const key = `${sourceKey}:roads`;
  for (const seg of segments) {
    const start = seg?.start;
    const end = seg?.end;
    if (!start || !end) continue;
    const coreRadius = Math.max(1, Number.isFinite(seg.width) ? seg.width * 0.55 : 2.5);
    const blendRadius = coreRadius + Math.max(6, coreRadius * 1.8);
    const minX = Math.min(start.x, end.x) - blendRadius;
    const maxX = Math.max(start.x, end.x) + blendRadius;
    const minZ = Math.min(start.z, end.z) - blendRadius;
    const maxZ = Math.max(start.z, end.z) + blendRadius;
    registerFlattenZone(key, {
      type: 'road',
      start: { x: start.x, z: start.z },
      end: { x: end.x, z: end.z },
      targetHeight: 0,
      coreRadius,
      blendRadius,
      bounds: { minX, maxX, minZ, maxZ }
    });
  }
}

function polygonBounds(points) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z);
    maxZ = Math.max(maxZ, p.z);
  }
  return { minX, maxX, minZ, maxZ };
}

export function registerTerrainBuildingFootprints(sourceKey, polygons = []) {
  clearTerrainFlatteningForSource(`${sourceKey}:buildings`);
  const key = `${sourceKey}:buildings`;
  for (const polygon of polygons) {
    if (!Array.isArray(polygon) || polygon.length < 3) continue;
    const corePadding = 1.2;
    const blendPadding = 8;
    const baseBounds = polygonBounds(polygon);
    registerFlattenZone(key, {
      type: 'building',
      points: polygon.map((p) => ({ x: p.x, z: p.z })),
      targetHeight: 0,
      corePadding,
      blendPadding,
      bounds: {
        minX: baseBounds.minX - blendPadding,
        maxX: baseBounds.maxX + blendPadding,
        minZ: baseBounds.minZ - blendPadding,
        maxZ: baseBounds.maxZ + blendPadding
      }
    });
  }
}

function pointToSegmentDistance(pointX, pointZ, start, end) {
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const lenSq = dx * dx + dz * dz;
  if (lenSq <= Number.EPSILON) return Math.hypot(pointX - start.x, pointZ - start.z);
  const t = THREE.MathUtils.clamp(((pointX - start.x) * dx + (pointZ - start.z) * dz) / lenSq, 0, 1);
  const px = start.x + dx * t;
  const pz = start.z + dz * t;
  return Math.hypot(pointX - px, pointZ - pz);
}

function pointInPolygon(x, z, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const xi = points[i].x;
    const zi = points[i].z;
    const xj = points[j].x;
    const zj = points[j].z;
    const intersects = ((zi > z) !== (zj > z)) && (x < ((xj - xi) * (z - zi)) / ((zj - zi) || Number.EPSILON) + xi);
    if (intersects) inside = !inside;
  }
  return inside;
}

function pointToPolygonEdgeDistance(x, z, points) {
  let minDist = Infinity;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const dist = pointToSegmentDistance(x, z, a, b);
    if (dist < minDist) minDist = dist;
  }
  return minDist;
}

function computeFlattenInfluence(x, z) {
  const gx = Math.floor(x / FLATTEN_BUCKET_SIZE);
  const gz = Math.floor(z / FLATTEN_BUCKET_SIZE);
  const zoneIds = new Set();
  for (let ox = -1; ox <= 1; ox += 1) {
    for (let oz = -1; oz <= 1; oz += 1) {
      const bucket = flattenGrid.get(`${gx + ox},${gz + oz}`);
      if (!bucket) continue;
      bucket.forEach((id) => zoneIds.add(id));
    }
  }

  let bestInfluence = 0;
  let targetHeight = 0;

  zoneIds.forEach((id) => {
    const zone = flattenZoneById.get(id);
    if (!zone) return;

    let influence = 0;
    if (zone.type === 'road') {
      const dist = pointToSegmentDistance(x, z, zone.start, zone.end);
      if (dist <= zone.coreRadius) {
        influence = 1;
      } else if (dist < zone.blendRadius) {
        const t = 1 - (dist - zone.coreRadius) / Math.max(0.001, zone.blendRadius - zone.coreRadius);
        influence = smoothstep(t);
      }
    } else if (zone.type === 'building') {
      const inFootprint = pointInPolygon(x, z, zone.points);
      if (inFootprint) {
        influence = 1;
      } else {
        const edgeDist = pointToPolygonEdgeDistance(x, z, zone.points);
        if (edgeDist <= zone.corePadding) {
          influence = 1;
        } else if (edgeDist < zone.blendPadding) {
          const t = 1 - (edgeDist - zone.corePadding) / Math.max(0.001, zone.blendPadding - zone.corePadding);
          influence = smoothstep(t);
        }
      }
    }

    if (influence > bestInfluence) {
      bestInfluence = influence;
      targetHeight = zone.targetHeight;
    }
  });

  return { influence: bestInfluence, targetHeight };
}

function isPointOnIsland(x, z) {
  for (const island of islandAreas) {
    const dx = x - island.center.x;
    const dz = z - island.center.z;
    const dist = Math.hypot(dx, dz);
    if (dist < island.surfaceRadius) return true;
  }
  return false;
}

export function registerIsland({ center, radius, surfaceRadius = radius, getHeight }) {
  islandAreas.push({
    center: { x: center.x, z: center.z },
    radius,
    surfaceRadius,
    getHeight,
  });
}

export function getTerrainHeight(x, z) {
  let height = computeProceduralHillHeight(x, z);
  const flatten = computeFlattenInfluence(x, z);
  if (flatten.influence > 0) {
    height = THREE.MathUtils.lerp(height, flatten.targetHeight, flatten.influence);
  }

  for (const island of islandAreas) {
    const dx = x - island.center.x;
    const dz = z - island.center.z;
    const dist = Math.hypot(dx, dz);
    if (dist <= island.radius) {
      if (typeof island.getHeight === 'function') {
        const h = island.getHeight(x, z);
        if (h > height) height = h;
      }
    }
  }
  return height;
}

export function getWaterDepth(x, z) {
  if (isPointOnIsland(x, z)) return 0;
  for (const body of waterBodies) {
    if (body.type === 'lake') {
      const dx = x - body.position.x;
      const dz = z - body.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist < body.radius) {
        return ((body.radius - dist) / body.radius) * MAX_LAKE_DEPTH;
      }
    } else if (body.type === 'river') {
      const halfW = body.size.width / 2;
      const halfL = body.size.length / 2;
      if (
        x >= body.position.x - halfW &&
        x <= body.position.x + halfW &&
        z >= body.position.z - halfL &&
        z <= body.position.z + halfL
      ) {
        return MAX_LAKE_DEPTH;
      }
    } else if (body.type === 'ocean') {
      const dx = x - body.position.x;
      const dz = z - body.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist < body.outerRadius) {
        const depthRatio = (body.outerRadius - dist) / (body.outerRadius - body.innerRadius);
        return depthRatio * MAX_LAKE_DEPTH;
      }
    }
  }
  return 0;
}

export function generateLake(scene, position, radius) {
  const lake = new THREE.Mesh(
    new THREE.CircleGeometry(radius, 32),
    new THREE.MeshStandardMaterial({ color: 0x1E90FF, transparent: true, opacity: 0.7 })
  );
  lake.rotation.x = -Math.PI / 2;
  lake.position.set(position.x, position.y ?? 0, position.z);
  scene.add(lake);

  waterBodies.push({
    type: 'lake',
    position: { x: position.x, z: position.z },
    radius
  });

  return lake;
}

export function generateRiver(scene, position, size) {
  const { width, length } = size;
  const river = new THREE.Mesh(
    new THREE.PlaneGeometry(width, length),
    new THREE.MeshStandardMaterial({ color: 0x1E90FF, transparent: true, opacity: 0.7 })
  );
  river.rotation.x = -Math.PI / 2;
  river.position.set(position.x, position.y ?? 0, position.z);
  scene.add(river);

  waterBodies.push({
    type: 'river',
    position: { x: position.x, z: position.z },
    size: { width, length }
  });

  return river;
}

export function generateOcean(scene, position, innerRadius, outerRadius) {
  const ocean = new THREE.Mesh(
    new THREE.RingGeometry(innerRadius, outerRadius, 64),
    new THREE.MeshStandardMaterial({ color: 0x1E90FF, transparent: true, opacity: 0.7, side: THREE.DoubleSide })
  );
  ocean.rotation.x = -Math.PI / 2;
  ocean.position.set(position.x, position.y ?? 0, position.z);
  scene.add(ocean);

  waterBodies.push({
    type: 'ocean',
    position: { x: position.x, z: position.z },
    innerRadius,
    outerRadius
  });

  return ocean;
}

export function isPointInWater(x, z) {
  return getWaterDepth(x, z) > 0;
}

// --- Wave system ---

export function initWaves(scene) {
  wavesScene = scene;
  // Remove old wave meshes if any
  for (const w of waterWaves) {
    if (w.mesh && wavesScene) wavesScene.remove(w.mesh);
  }
  waterWaves.length = 0;
}

export function spawnOceanWave({
  length,
  thickness = 3,
  height = 1.5,
  speed = 6,
  strength = 3,
  color = 0x1E90FF,
  opacity = 0.6,
} = {}) {
  const ocean = waterBodies.find(b => b.type === 'ocean');
  if (!ocean || !wavesScene) return null;

  const center = new THREE.Vector3(ocean.position.x, 0, ocean.position.z);
  const radius = ocean.outerRadius - 0.5;

  const arcLength = length ?? THREE.MathUtils.randFloat(6, 20);
  const angle = Math.random() * Math.PI * 2;

  const hillGeom = new THREE.SphereGeometry(1, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2);
  hillGeom.scale(arcLength / 2, height, thickness / 2);
  const hillMat = new THREE.MeshStandardMaterial({
    color,
    transparent: true,
    opacity,
    roughness: 0.8,
  });
  const hill = new THREE.Mesh(hillGeom, hillMat);
  hill.renderOrder = 2;

  const segment = new THREE.Group();
  segment.add(hill);
  segment.position.set(
    center.x + Math.cos(angle) * radius,
    0,
    center.z + Math.sin(angle) * radius
  );
  segment.rotation.y = angle + Math.PI / 2;
  wavesScene.add(segment);

  const wave = {
    type: 'ocean',
    center,
    radius,
    speed,
    strength,
    mesh: segment,
    angle,
    thickness,
    length: arcLength,
    height,
    innerRadius: ocean.innerRadius,
  };
  waterWaves.push(wave);
  return wave;
}

export function updateWaves(dt) {
  for (let i = waterWaves.length - 1; i >= 0; i--) {
    const w = waterWaves[i];
    w.radius -= w.speed * dt;
    if (w.mesh) {
      w.mesh.position.x = w.center.x + Math.cos(w.angle) * w.radius;
      w.mesh.position.z = w.center.z + Math.sin(w.angle) * w.radius;
    }
    if (w.radius <= w.innerRadius) {
      if (w.mesh && wavesScene) wavesScene.remove(w.mesh);
      waterWaves.splice(i, 1);
    }
  }
}

export function getWaveForceAt(x, z) {
  const force = new THREE.Vector3(0, 0, 0);
  for (const w of waterWaves) {
    if (!w.mesh) continue;
    const dx = x - w.mesh.position.x;
    const dz = z - w.mesh.position.z;
    const orient = w.angle + Math.PI / 2;
    const cos = Math.cos(orient);
    const sin = Math.sin(orient);
    const localX = cos * dx + sin * dz;
    const localZ = -sin * dx + cos * dz;
    if (
      Math.abs(localX) <= w.length * 0.5 &&
      Math.abs(localZ) <= w.thickness * 0.5
    ) {
      const dirX = -Math.cos(w.angle);
      const dirZ = -Math.sin(w.angle);
      force.x += dirX * w.strength;
      force.z += dirZ * w.strength;
    }
  }
  return force;
}

export { waterBodies, MAX_LAKE_DEPTH };

const AREA_SIZE_METERS = 180;
const HILL_AREA_CHANCE = 0.58;
const HEIGHT_QUANTIZE_MIN = 0.22;
const HEIGHT_QUANTIZE_MAX = 0.5;
const TERRAIN_SCALE = 10;
const GROUND_TILE_SIZE_METERS = 300;
const GROUND_TILE_SEGMENTS = 24;
const TERRAIN_GRID_STEP = GROUND_TILE_SIZE_METERS / GROUND_TILE_SEGMENTS;

const terrainFlatZones = [];

const hash2 = (x, z, seed = 0) => {
  const s = Math.sin(x * 127.1 + z * 311.7 + seed * 74.7) * 43758.5453123;
  return s - Math.floor(s);
};

const smoothstep = (t) => t * t * (3 - 2 * t);
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const lerp = (a, b, t) => a + (b - a) * t;

const valueNoise2 = (x, z, seed = 0) => {
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const tx = smoothstep(x - x0);
  const tz = smoothstep(z - z0);

  const v00 = hash2(x0, z0, seed);
  const v10 = hash2(x0 + 1, z0, seed);
  const v01 = hash2(x0, z0 + 1, seed);
  const v11 = hash2(x0 + 1, z0 + 1, seed);

  const a = lerp(v00, v10, tx);
  const b = lerp(v01, v11, tx);
  return lerp(a, b, tz);
};

const fbm2 = (x, z, octaves = 3, seed = 0) => {
  let value = 0;
  let amplitude = 1;
  let frequency = 1;
  let maxAmp = 0;
  for (let i = 0; i < octaves; i += 1) {
    value += (valueNoise2(x * frequency, z * frequency, seed + i * 17.0) * 2 - 1) * amplitude;
    maxAmp += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return maxAmp > 0 ? value / maxAmp : 0;
};

const areaProfile = (areaX, areaZ) => {
  const hillRoll = hash2(areaX, areaZ, 1.13);
  if (hillRoll > HILL_AREA_CHANCE) {
    return {
      minHeight: 0,
      maxHeight: 0,
      frequency: 0.008,
      quantizeStep: 0.35,
    };
  }

  const minHeight = lerp(0.4, 2.3, hash2(areaX, areaZ, 2.41));
  const maxHeight = minHeight + lerp(1.2, 4.8, hash2(areaX, areaZ, 3.71));
  const frequency = lerp(0.004, 0.012, hash2(areaX, areaZ, 5.22));
  const quantizeStep = lerp(HEIGHT_QUANTIZE_MIN, HEIGHT_QUANTIZE_MAX, hash2(areaX, areaZ, 7.93));

  return {
    minHeight,
    maxHeight,
    frequency,
    quantizeStep,
  };
};

const blendedAreaProfile = (x, z) => {
  const areaX = Math.floor(x / AREA_SIZE_METERS);
  const areaZ = Math.floor(z / AREA_SIZE_METERS);
  const fx = smoothstep((x / AREA_SIZE_METERS) - areaX);
  const fz = smoothstep((z / AREA_SIZE_METERS) - areaZ);

  const p00 = areaProfile(areaX, areaZ);
  const p10 = areaProfile(areaX + 1, areaZ);
  const p01 = areaProfile(areaX, areaZ + 1);
  const p11 = areaProfile(areaX + 1, areaZ + 1);

  const blend = (key) => {
    const a = lerp(p00[key], p10[key], fx);
    const b = lerp(p01[key], p11[key], fx);
    return lerp(a, b, fz);
  };

  return {
    minHeight: blend('minHeight'),
    maxHeight: blend('maxHeight'),
    frequency: blend('frequency'),
    quantizeStep: blend('quantizeStep'),
  };
};

const getRawVertexTerrainHeight = (x, z) => {
  const profile = blendedAreaProfile(x, z);
  const amplitude = Math.max(0, profile.maxHeight - profile.minHeight);
  if (amplitude <= 0.001) return 0;

  const n = fbm2(x * profile.frequency, z * profile.frequency, 3, 9.17);
  const normalized = (n + 1) * 0.5;
  const height = profile.minHeight + amplitude * normalized;
  const step = Math.max(0.001, profile.quantizeStep);
  return Math.round(height / step) * step * TERRAIN_SCALE;
};

const getMeshInterpolatedTerrainHeight = (x, z) => {
  const gx = x / TERRAIN_GRID_STEP;
  const gz = z / TERRAIN_GRID_STEP;
  const x0i = Math.floor(gx);
  const z0i = Math.floor(gz);
  const tx = gx - x0i;
  const tz = gz - z0i;

  const x0 = x0i * TERRAIN_GRID_STEP;
  const x1 = (x0i + 1) * TERRAIN_GRID_STEP;
  const z0 = z0i * TERRAIN_GRID_STEP;
  const z1 = (z0i + 1) * TERRAIN_GRID_STEP;

  const h00 = getRawVertexTerrainHeight(x0, z0);
  const h10 = getRawVertexTerrainHeight(x1, z0);
  const h01 = getRawVertexTerrainHeight(x0, z1);
  const h11 = getRawVertexTerrainHeight(x1, z1);

  const hx0 = lerp(h00, h10, tx);
  const hx1 = lerp(h01, h11, tx);
  return lerp(hx0, hx1, tz);
};

const applyTerrainFlatZones = (x, z, baseHeight) => {
  let result = baseHeight;
  for (const zone of terrainFlatZones) {
    const dx = x - zone.x;
    const dz = z - zone.z;
    const d = Math.hypot(dx, dz);
    const inner = Math.max(0, zone.radius);
    const outer = inner + Math.max(0, zone.blendRadius ?? 0);
    if (d > outer) continue;

    const target = zone.height;
    if (d <= inner || outer <= inner + Number.EPSILON) {
      result = target;
      continue;
    }

    const t = clamp01((d - inner) / (outer - inner));
    const blend = smoothstep(t);
    result = lerp(target, result, blend);
  }
  return result;
};

export function clearTerrainFlatZones(ownerPrefix = null) {
  if (!ownerPrefix) {
    terrainFlatZones.length = 0;
    return;
  }
  for (let i = terrainFlatZones.length - 1; i >= 0; i -= 1) {
    const owner = terrainFlatZones[i]?.owner;
    if (typeof owner === 'string' && owner.startsWith(ownerPrefix)) {
      terrainFlatZones.splice(i, 1);
    }
  }
}

export function registerTerrainFlatZone({ x, z, radius, blendRadius = 0, height = null, owner = null } = {}) {
  if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(radius) || radius <= 0) return;
  const baseHeight = getMeshInterpolatedTerrainHeight(x, z);
  terrainFlatZones.push({
    x,
    z,
    radius,
    blendRadius: Math.max(0, blendRadius),
    height: Number.isFinite(height) ? height : baseHeight,
    owner,
  });
}

export function getProceduralTerrainHeight(x, z) {
  const baseHeight = getMeshInterpolatedTerrainHeight(x, z);
  return applyTerrainFlatZones(x, z, baseHeight);
}

export function applyTerrainToGroundGeometry({ geometry, tile, tileSizeMeters = 300, elevation = 0 } = {}) {
  if (!geometry?.attributes?.position || !tile) return;

  const positions = geometry.attributes.position;
  const tileCenterX = (tile.x + 0.5) * tileSizeMeters;
  const tileCenterZ = -(tile.y + 0.5) * tileSizeMeters;

  for (let i = 0; i < positions.count; i += 1) {
    const localX = positions.getX(i);
    const localY = positions.getY(i);

    const worldX = tileCenterX + localX;
    const worldZ = tileCenterZ - localY;
    const worldHeight = getProceduralTerrainHeight(worldX, worldZ);

    positions.setZ(i, worldHeight - elevation);
  }

  positions.needsUpdate = true;
  geometry.computeVertexNormals();
}

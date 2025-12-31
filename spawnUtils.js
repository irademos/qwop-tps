import { getTerrainHeight, getWaterDepth } from './water.js';

const DEFAULT_RADIUS = 12;
const MAX_ATTEMPTS = 30;
const DEFAULT_HEIGHT_OFFSET = 0.6;
const WATER_THRESHOLD = 0.1;

function sampleXZ(radius, minRadius = 0) {
  const angle = Math.random() * Math.PI * 2;
  const clampedMin = Math.max(0, Math.min(minRadius, radius));
  const distance = clampedMin + Math.random() * (radius - clampedMin);
  const x = Math.cos(angle) * distance;
  const z = Math.sin(angle) * distance;
  return { x, z };
}

export function getSpawnPosition({
  radius = DEFAULT_RADIUS,
  minRadius = 0,
  heightOffset = DEFAULT_HEIGHT_OFFSET,
  maxAttempts = MAX_ATTEMPTS,
  allowWater = false,
  center = { x: 0, z: 0 },
} = {}) {
  let fallback = null;
  for (let i = 0; i < maxAttempts; i += 1) {
    const { x, z } = sampleXZ(radius, minRadius);
    const worldX = center.x + x;
    const worldZ = center.z + z;
    const terrainY = getTerrainHeight(worldX, worldZ);
    const waterDepth = getWaterDepth(worldX, worldZ);
    if (!allowWater && waterDepth > WATER_THRESHOLD) {
      if (!fallback) fallback = { x: worldX, z: worldZ, terrainY };
      continue;
    }
    return { x: worldX, y: terrainY + heightOffset, z: worldZ, terrainY };
  }

  if (fallback) {
    const { x, z, terrainY } = fallback;
    return { x, y: terrainY + heightOffset, z, terrainY };
  }

  const originTerrain = getTerrainHeight(0, 0);
  return { x: 0, y: originTerrain + heightOffset, z: 0, terrainY: originTerrain };
}

export function snapObjectToTerrain(object, { heightOffset = DEFAULT_HEIGHT_OFFSET } = {}) {
  if (!object) return;
  const { x, z } = object.position;
  const terrainY = getTerrainHeight(x, z);
  object.position.y = terrainY + heightOffset;
}

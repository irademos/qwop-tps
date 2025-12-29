import { getTerrainHeight, getWaterDepth } from './water.js';

const DEFAULT_RADIUS = 12;
const MAX_ATTEMPTS = 30;
const DEFAULT_HEIGHT_OFFSET = 0.6;
const WATER_THRESHOLD = 0.1;

function sampleXZ(radius) {
  const angle = Math.random() * Math.PI * 2;
  const distance = Math.random() * radius;
  const x = Math.cos(angle) * distance;
  const z = Math.sin(angle) * distance;
  return { x, z };
}

export function getSpawnPosition({
  radius = DEFAULT_RADIUS,
  heightOffset = DEFAULT_HEIGHT_OFFSET,
  maxAttempts = MAX_ATTEMPTS,
  allowWater = false,
} = {}) {
  let fallback = null;
  for (let i = 0; i < maxAttempts; i += 1) {
    const { x, z } = sampleXZ(radius);
    const terrainY = getTerrainHeight(x, z);
    const waterDepth = getWaterDepth(x, z);
    if (!allowWater && waterDepth > WATER_THRESHOLD) {
      if (!fallback) fallback = { x, z, terrainY };
      continue;
    }
    return { x, y: terrainY + heightOffset, z, terrainY };
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

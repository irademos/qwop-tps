import { getWaterDepth } from './environment/water.js';
import { getTerrainHeight } from './environment/terrainHeight.js';

const DEFAULT_RADIUS = 12;
const MAX_ATTEMPTS = 30;
const DEFAULT_HEIGHT_OFFSET = 0.6;
const WATER_THRESHOLD = 0.1;

export function getSpawnY(x, z, offset = DEFAULT_HEIGHT_OFFSET, { allowOnBuildings = false, getBuildingTopY } = {}) {
  const terrainY = getTerrainHeight(x, z);
  let spawnY = Number.isFinite(terrainY) ? terrainY + offset : offset;
  if (allowOnBuildings && typeof getBuildingTopY === 'function') {
    const buildingTopY = getBuildingTopY(x, z, spawnY, offset);
    if (Number.isFinite(buildingTopY) && buildingTopY > spawnY) {
      spawnY = buildingTopY;
    }
  }
  return spawnY;
}

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
    return { x, y: getSpawnY(x, z, heightOffset), z, terrainY };
  }

  if (fallback) {
    const { x, z, terrainY } = fallback;
    return { x, y: getSpawnY(x, z, heightOffset), z, terrainY };
  }

  const originTerrain = getTerrainHeight(0, 0);
  return { x: 0, y: getSpawnY(0, 0, heightOffset), z: 0, terrainY: originTerrain };
}

export function snapObjectToTerrain(object, { heightOffset = DEFAULT_HEIGHT_OFFSET } = {}) {
  if (!object) return;
  const { x, z } = object.position;
  object.position.y = getSpawnY(x, z, heightOffset);
}

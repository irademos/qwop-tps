import { getWaterDepth } from './environment/water.js';
import { getTerrainHeight } from './environment/terrainHeight.js';

const DEFAULT_RADIUS = 12;
const MAX_ATTEMPTS = 30;
const DEFAULT_HEIGHT_OFFSET = 0.6;
const WATER_THRESHOLD = 0.1;
let liftPositionToBuildingTopResolver = null;

export function configureSpawnAlignment({ liftPositionToBuildingTop } = {}) {
  liftPositionToBuildingTopResolver = typeof liftPositionToBuildingTop === 'function'
    ? liftPositionToBuildingTop
    : null;
}

export function getSpawnY(x, z, offset = DEFAULT_HEIGHT_OFFSET, { allowOnBuildings = false } = {}) {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
  const terrainY = getTerrainHeight(x, z);
  if (!Number.isFinite(terrainY)) return null;
  const baseY = terrainY + (Number.isFinite(offset) ? offset : 0);
  if (!allowOnBuildings || !liftPositionToBuildingTopResolver) {
    return baseY;
  }
  const candidate = { x, y: baseY, z };
  const lifted = liftPositionToBuildingTopResolver(candidate, Number.isFinite(offset) ? offset : 0);
  return lifted ? candidate.y : baseY;
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
  allowOnBuildings = false,
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
    const spawnY = getSpawnY(x, z, heightOffset, { allowOnBuildings });
    if (Number.isFinite(spawnY)) {
      return { x, y: spawnY, z, terrainY };
    }
  }

  if (fallback) {
    const { x, z, terrainY } = fallback;
    const spawnY = getSpawnY(x, z, heightOffset, { allowOnBuildings });
    return { x, y: Number.isFinite(spawnY) ? spawnY : terrainY + heightOffset, z, terrainY };
  }

  const originTerrain = getTerrainHeight(0, 0);
  const originY = getSpawnY(0, 0, heightOffset, { allowOnBuildings });
  return { x: 0, y: Number.isFinite(originY) ? originY : originTerrain + heightOffset, z: 0, terrainY: originTerrain };
}

export function snapObjectToTerrain(object, { heightOffset = DEFAULT_HEIGHT_OFFSET, allowOnBuildings = false } = {}) {
  if (!object) return;
  const { x, z } = object.position;
  const spawnY = getSpawnY(x, z, heightOffset, { allowOnBuildings });
  if (Number.isFinite(spawnY)) {
    object.position.y = spawnY;
  }
}

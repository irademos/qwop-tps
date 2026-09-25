import { getTerrainHeight } from '../environment/terrainHeight.js';

const DEFAULT_RADIUS = 12;
const MAX_ATTEMPTS = 30;
const DEFAULT_HEIGHT_OFFSET = 0.6;

export function getSpawnY(x, z, offset = DEFAULT_HEIGHT_OFFSET) {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
  const terrainY = getTerrainHeight(x, z);
  if (!Number.isFinite(terrainY)) return null;
  return terrainY + (Number.isFinite(offset) ? offset : 0);
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
  maxAttempts = MAX_ATTEMPTS
} = {}) {
  for (let i = 0; i < maxAttempts; i += 1) {
    const { x, z } = sampleXZ(radius);
    const terrainY = getTerrainHeight(x, z);
    const spawnY = getSpawnY(x, z, heightOffset);
    if (Number.isFinite(spawnY)) {
      return { x, y: spawnY, z, terrainY };
    }
  }

  const originTerrain = getTerrainHeight(0, 0);
  const originY = getSpawnY(0, 0, heightOffset);
  return { x: 0, y: Number.isFinite(originY) ? originY : originTerrain + heightOffset, z: 0, terrainY: originTerrain };
}

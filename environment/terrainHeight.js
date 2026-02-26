const AREA_SIZE_METERS = 180;
const HILL_AREA_CHANCE = 0.58;
const HEIGHT_QUANTIZE_MIN = 0.22;
const HEIGHT_QUANTIZE_MAX = 0.5;

const hash2 = (x, z, seed = 0) => {
  const s = Math.sin(x * 127.1 + z * 311.7 + seed * 74.7) * 43758.5453123;
  return s - Math.floor(s);
};

const smoothstep = (t) => t * t * (3 - 2 * t);
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

export function getProceduralTerrainHeight(x, z) {
  const profile = blendedAreaProfile(x, z);
  const amplitude = Math.max(0, profile.maxHeight - profile.minHeight);
  if (amplitude <= 0.001) return 0;

  const n = fbm2(x * profile.frequency, z * profile.frequency, 3, 9.17);
  const normalized = (n + 1) * 0.5;
  const height = profile.minHeight + amplitude * normalized;
  const step = Math.max(0.001, profile.quantizeStep);
  return Math.round(height / step) * step * 10;
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

import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { generateOcean, registerIsland, SEA_FLOOR_Y } from "./water.js";

const DEFAULT_WORLD_SEED = 0x5f3759df;
let currentWorldSeed = DEFAULT_WORLD_SEED;

function createSeededRandom(seed) {
  let state = (seed >>> 0) || 0x1a2b3c4d;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeedValue(seed, label) {
  let hash = seed >>> 0;
  const text = String(label ?? "");
  for (let i = 0; i < text.length; i += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  }
  return hash >>> 0;
}

function normalizeSeed(seed) {
  if (typeof seed === "number" && Number.isFinite(seed)) {
    return seed >>> 0;
  }
  if (typeof seed === "string") {
    let hash = 2166136261 >>> 0;
    for (let i = 0; i < seed.length; i += 1) {
      hash = Math.imul(hash ^ seed.charCodeAt(i), 16777619);
    }
    return hash >>> 0;
  }
  return DEFAULT_WORLD_SEED;
}

function getSeededRandom(label) {
  return createSeededRandom(hashSeedValue(currentWorldSeed, label));
}

export function setWorldSeed(seed) {
  currentWorldSeed = normalizeSeed(seed);
}

export function createClouds(scene) {
  const rng = getSeededRandom("clouds");

  const cloudMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    opacity: 0.95,
    transparent: true,
    roughness: 0.9,
    metalness: 0.0,
    emissive: 0xcccccc,
    emissiveIntensity: 0.2,
  });

  for (let i = 0; i < 20; i++) {
    const cloudGroup = new THREE.Group();
    const puffCount = 3 + Math.floor(rng() * 5);
    for (let j = 0; j < puffCount; j++) {
      const puffSize = 2 + rng() * 3;
      const puffGeometry = new THREE.SphereGeometry(puffSize, 7, 7);
      const puff = new THREE.Mesh(puffGeometry, cloudMaterial);
      puff.position.x = (rng() - 0.5) * 5;
      puff.position.y = (rng() - 0.5) * 2;
      puff.position.z = (rng() - 0.5) * 5;
      cloudGroup.add(puff);
    }
    const angle = rng() * Math.PI * 2;
    const distance = 20 + rng() * 60;
    cloudGroup.position.x = Math.cos(angle) * distance;
    cloudGroup.position.z = Math.sin(angle) * distance;
    cloudGroup.position.y = 20 + rng() * 15;
    cloudGroup.rotation.y = rng() * Math.PI * 2;
    scene.add(cloudGroup);
  }
}

export const MOON_RADIUS = 70;

export function createMoon(scene, rapierWorld, rbToMesh) {
  const moonGeometry = new THREE.SphereGeometry(MOON_RADIUS, 32, 32);
  const moonMaterial = new THREE.MeshStandardMaterial({ color: 0xdddddd });
  const moon = new THREE.Mesh(moonGeometry, moonMaterial);
  moon.position.set(0, 200, -30);
  moon.rotation.set(0, 0, 0);
  moon.quaternion.set(0, 0, 0, 1);
  moon.matrixAutoUpdate = false;
  moon.updateMatrix();
  scene.add(moon);
  window.moon = moon;

  if (rapierWorld) {
    const rb = rapierWorld.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(
        moon.position.x,
        moon.position.y,
        moon.position.z
      )
    );
    rapierWorld.createCollider(
      RAPIER.ColliderDesc.ball(MOON_RADIUS),
      rb
    );
    // Intentionally omit mapping to rbToMesh to keep the moon stationary
  }

  return moon;
}

const textureLoader = new THREE.TextureLoader();
const textureCache = new Map();

const TEXTURE_DOWNSCALE_POWER = 1; // Reduce to 1 / 2^power resolution (quarter size).
const USE_SEAFLOOR_TEXTURE = false;

const isPowerOfTwo = (value) => value && (value & (value - 1)) === 0;

function loadIslandTexture(key, url, repeat = 4) {
  const cacheKey = TEXTURE_DOWNSCALE_POWER
    ? `${key}-down-${TEXTURE_DOWNSCALE_POWER}`
    : key;
  if (textureCache.has(cacheKey)) return textureCache.get(cacheKey);
  const texture = textureLoader.load(url, (loadedTexture) => {
    if (
      TEXTURE_DOWNSCALE_POWER > 0 &&
      loadedTexture.image &&
      typeof document !== "undefined"
    ) {
      const { width, height } = loadedTexture.image;
      if (isPowerOfTwo(width) && isPowerOfTwo(height)) {
        const downscaleFactor = 1 << TEXTURE_DOWNSCALE_POWER;
        const targetWidth = Math.max(1, Math.floor(width / downscaleFactor));
        const targetHeight = Math.max(1, Math.floor(height / downscaleFactor));
        if (targetWidth > 0 && targetHeight > 0) {
          const canvas = document.createElement("canvas");
          canvas.width = targetWidth;
          canvas.height = targetHeight;
          const context = canvas.getContext("2d");
          context.drawImage(
            loadedTexture.image,
            0,
            0,
            targetWidth,
            targetHeight
          );
          loadedTexture.image = canvas;
          loadedTexture.needsUpdate = true;
        }
      }
    }
  });
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeat, repeat);
  if (texture.colorSpace !== undefined) {
    texture.colorSpace = THREE.SRGBColorSpace;
  }
  textureCache.set(cacheKey, texture);
  return texture;
}

const sandMaterial = new THREE.MeshStandardMaterial({
  map: loadIslandTexture(
    "sand",
    "/assets/textures/sandy_gravel_02_4k.blend/textures/sandy_gravel_02_diff_4k.jpg",
    6
  ),
  roughness: 0.95,
  metalness: 0.05,
});

const groundMaterial = new THREE.MeshStandardMaterial({
  map: loadIslandTexture(
    "ground",
    "/assets/textures/forrest_ground_01_4k.blend/textures/forrest_ground_01_diff_4k.jpg",
    4
  ),
  roughness: 0.85,
  metalness: 0.05,
});

const rockMaterial = new THREE.MeshStandardMaterial({
  map: loadIslandTexture(
    "rock",
    "/assets/textures/rock_face_03_4k.blend/textures/rock_face_03_diff_4k.jpg",
    3
  ),
  roughness: 1.0,
  metalness: 0.1,
});

const seaFloorMaterial = new THREE.MeshStandardMaterial({
  map: loadIslandTexture(
    "seafloor",
    "/assets/textures/sandy_gravel_02_4k.blend/textures/sandy_gravel_02_diff_4k.jpg",
    12
  ),
  roughness: 0.95,
  metalness: 0.02,
});

function pseudoRandom2D(x, z) {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

function smoothNoise(x, z) {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const xf = x - xi;
  const zf = z - zi;

  const topLeft = pseudoRandom2D(xi, zi);
  const topRight = pseudoRandom2D(xi + 1, zi);
  const bottomLeft = pseudoRandom2D(xi, zi + 1);
  const bottomRight = pseudoRandom2D(xi + 1, zi + 1);

  const u = xf * xf * (3 - 2 * xf);
  const v = zf * zf * (3 - 2 * zf);

  const top = topLeft * (1 - u) + topRight * u;
  const bottom = bottomLeft * (1 - u) + bottomRight * u;

  return top * (1 - v) + bottom * v;
}

function fractalNoise(x, z, octaves = 4, lacunarity = 2, gain = 0.5) {
  let frequency = 1;
  let amplitude = 1;
  let sum = 0;
  let amplitudeSum = 0;

  for (let i = 0; i < octaves; i++) {
    sum += smoothNoise(x * frequency, z * frequency) * amplitude;
    amplitudeSum += amplitude;
    frequency *= lacunarity;
    amplitude *= gain;
  }

  return amplitudeSum > 0 ? sum / amplitudeSum : 0;
}

function createHeightSampler({ center, radius, segments, heights, size }) {
  const gridSize = segments + 1;
  const halfSize = size / 2;
  const cellSize = size / segments;

  return (x, z) => {
    const localX = x - center.x;
    const localZ = z - center.z;
    const dist = Math.hypot(localX, localZ);

    if (dist > radius) return SEA_FLOOR_Y;

    const fx = (localX + halfSize) / cellSize;
    const fz = (localZ + halfSize) / cellSize;

    const ix0 = Math.floor(fx);
    const iz0 = Math.floor(fz);

    const ix = THREE.MathUtils.clamp(ix0, 0, segments - 1);
    const iz = THREE.MathUtils.clamp(iz0, 0, segments - 1);

    const tx = THREE.MathUtils.clamp(fx - ix, 0, 1);
    const tz = THREE.MathUtils.clamp(fz - iz, 0, 1);

    const ix1 = Math.min(ix + 1, segments);
    const iz1 = Math.min(iz + 1, segments);

    const i00 = iz * gridSize + ix;
    const i10 = iz * gridSize + ix1;
    const i01 = iz1 * gridSize + ix;
    const i11 = iz1 * gridSize + ix1;

    const h00 = heights[i00];
    const h10 = heights[i10];
    const h01 = heights[i01];
    const h11 = heights[i11];

    const h0 = h00 * (1 - tx) + h10 * tx;
    const h1 = h01 * (1 - tx) + h11 * tx;

    return h0 * (1 - tz) + h1 * tz;
  };
}

function estimateSurfaceRadius({ center, radius, sampleHeight, segments, cellSize }) {
  const steps = 32;
  let maxSurface = 0;

  for (let i = 0; i < steps; i++) {
    const angle = (i / steps) * Math.PI * 2;
    for (let j = 0; j <= segments; j++) {
      const r = radius - j * cellSize;
      if (r <= 0) break;
      const sampleX = center.x + Math.cos(angle) * r;
      const sampleZ = center.z + Math.sin(angle) * r;
      if (sampleHeight(sampleX, sampleZ) > 0) {
        maxSurface = Math.max(maxSurface, r);
        break;
      }
    }
  }

  const margin = cellSize * 2;
  if (maxSurface <= 0) {
    return Math.max(0, radius * 0.75);
  }
  return Math.min(radius, maxSurface + margin);
}

const island_segments = 10;

function createHillyIsland({ radius, maxHeight, center, segments = island_segments }) {
  const size = radius * 2;
  const geometry = new THREE.PlaneGeometry(size, size, segments, segments);
  geometry.rotateX(-Math.PI / 2);

  const positions = geometry.attributes.position;
  const gridSize = segments + 1;
  const heights = new Float32Array(gridSize * gridSize);
  const vertexDistances = new Float32Array(gridSize * gridSize);
  const noiseScale = 0.08;
  const cellSize = size / segments;

  let index = 0;
  for (let iz = 0; iz < gridSize; iz++) {
    const zPos = -radius + (iz / segments) * size;
    for (let ix = 0; ix < gridSize; ix++) {
      const xPos = -radius + (ix / segments) * size;
      const dist = Math.hypot(xPos, zPos);
      const normalizedDist = dist / radius;
      let height = SEA_FLOOR_Y;

      if (normalizedDist < 1) {
        const falloff = 1 - Math.pow(normalizedDist, 2.2);
        const baseHill = Math.pow(falloff, 1.35) * maxHeight;
        const largeScale = fractalNoise(xPos * noiseScale, zPos * noiseScale, 4);
        const detail = fractalNoise(xPos * noiseScale * 2.4 + 200, zPos * noiseScale * 2.4 + 200, 3);
        const noise = (largeScale * 0.7 + detail * 0.3) * 2 - 1;
        const variation = noise * maxHeight * 0.25 * falloff;
        let rawHeight = SEA_FLOOR_Y + baseHill + variation;
        const beachEase = THREE.MathUtils.clamp((radius - dist) / (radius * 0.12), 0, 1);
        height = THREE.MathUtils.lerp(SEA_FLOOR_Y, rawHeight, beachEase);
      }

      height = Math.max(height, SEA_FLOOR_Y);
      heights[index] = height;
      vertexDistances[index] = dist;
      positions.setY(index, height);
      index++;
    }
  }

  positions.needsUpdate = true;
  geometry.computeVertexNormals();

  geometry.clearGroups();
  const indices = geometry.index.array;
  const beachRadius = radius * 0.72;
  const rockHeight = SEA_FLOOR_Y + maxHeight * 0.65;

  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i];
    const b = indices[i + 1];
    const c = indices[i + 2];

    const avgHeight = (heights[a] + heights[b] + heights[c]) / 3;
    const avgDist = (vertexDistances[a] + vertexDistances[b] + vertexDistances[c]) / 3;

    let materialIndex = 1;
    if (avgDist > beachRadius || avgHeight < SEA_FLOOR_Y + maxHeight * 0.18) {
      materialIndex = 0;
    } else if (avgHeight >= rockHeight) {
      materialIndex = 2;
    }

    geometry.addGroup(i, 3, materialIndex);
  }

  if (!geometry.groups.some(group => group.materialIndex === 0)) {
    geometry.addGroup(0, 3, 0);
  }
  if (!geometry.groups.some(group => group.materialIndex === 2)) {
    geometry.addGroup(0, 0, 2);
  }

  const mesh = new THREE.Mesh(geometry, [sandMaterial, groundMaterial, groundMaterial]);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.position.set(center.x, 0, center.z);

  const getHeight = createHeightSampler({
    center,
    radius,
    segments,
    heights,
    size,
  });

  const surfaceRadius = estimateSurfaceRadius({
    center,
    radius,
    sampleHeight: getHeight,
    segments,
    cellSize,
  });

  return { mesh, getHeight, radius, surfaceRadius };
}

export function generateIsland(scene, { islandRadius = 20, outerRadius = 100 } = {}) {
  const rng = getSeededRandom("islands");
  const seaFloor = new THREE.Mesh(
    new THREE.PlaneGeometry(outerRadius * 2, outerRadius * 2, 1, 1),
    seaFloorMaterial
  );
  seaFloor.rotation.x = -Math.PI / 2;
  seaFloor.position.y = SEA_FLOOR_Y;
  seaFloor.receiveShadow = true;
  scene.add(seaFloor);

  const mainRadius = islandRadius * (0.95 + rng() * 0.3);
  const mainHeight = 8 + rng() * 5;

  const mainIsland = createHillyIsland({
    radius: mainRadius,
    maxHeight: mainHeight,
    center: { x: 0, z: 0 },
  });
  scene.add(mainIsland.mesh);
  registerIsland({
    center: { x: 0, z: 0 },
    radius: mainIsland.radius,
    surfaceRadius: mainIsland.surfaceRadius,
    getHeight: mainIsland.getHeight,
  });

  generateOcean(scene, { x: 0, z: 0 }, 0, outerRadius);

  const smallIslandCount = 4 + Math.floor(rng() * 3);
  for (let i = 0; i < smallIslandCount; i++) {
    const angle = rng() * Math.PI * 2;
    const dist = islandRadius + 18 + rng() * Math.max(10, outerRadius - islandRadius - 26);
    const center = {
      x: Math.cos(angle) * dist,
      z: Math.sin(angle) * dist,
    };
    const radius = 4.5 + rng() * 3.5;
    const height = 3.5 + rng() * 2.5;

    const island = createHillyIsland({
      radius,
      maxHeight: height,
      center,
      segments: island_segments / 2,
    });
    scene.add(island.mesh);
    registerIsland({
      center,
      radius: island.radius,
      surfaceRadius: island.surfaceRadius,
      getHeight: island.getHeight,
    });
  }
}
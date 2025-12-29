import * as THREE from 'three';

// Store all water bodies for later lookup
const waterBodies = [];
const islandAreas = [];
const waterWaves = [];
let wavesScene = null;

export const SEA_FLOOR_Y = -2;
const MAX_LAKE_DEPTH = 1.5;
export const SWIM_DEPTH_THRESHOLD = 0.7;

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
  let height = SEA_FLOOR_Y;
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
  length, // tangential length of the wave segment
  thickness = 3, // radial thickness
  height = 1.5, // vertical height of the wave
  speed = 6,
  strength = 3,
  color = 0x1E90FF,
  opacity = 0.6,
} = {}) {
  // Use the first ocean body (or all, but we’ll start with one)
  const ocean = waterBodies.find(b => b.type === 'ocean');
  if (!ocean || !wavesScene) return null;

  const center = new THREE.Vector3(ocean.position.x, 0, ocean.position.z);
  const radius = ocean.outerRadius - 0.5; // Start near outer edge

  // Randomize arc length and location if not specified
  const arcLength = length ?? THREE.MathUtils.randFloat(6, 20);
  const angle = Math.random() * Math.PI * 2;

  // Base wave – a smooth blue hill
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

  // Group the hill
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
    // Update mesh position to reflect new radius
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
    const localX = cos * dx + sin * dz; // along tangential direction
    const localZ = -sin * dx + cos * dz; // radial direction (outward)
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

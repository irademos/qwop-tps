import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const TREE_MODEL_URL = '/assets/props/low_poly_tree_pack.glb';
const TREE_SCALE = 0.016; // around 0.012 to 0.02 looks good
const TREE_PREFABS = [
  ['Circle'],                 // Eucalyptus (has multiple meshes under it)
  ['Circle001'],              // Pine
  ['Circle002'],              // Palm
  ['Circle003', 'Circle004'], // Cypress or Larch or Fir (split across 2 sibling nodes)
  ['Circle005'],              // Oak
  ['Circle006'],              // Scary / Dead tree
  ['Circle007']               // Larch or Beech
];

const PALM_TREE_INDEX = 2;
const TREE_ZONE_DEGREES = 0.0009;
const TREE_ZONE_METERS = 100;
const TREE_RADIUS_METERS = 180;
const TREE_GRID_SPACING = 20;
const TREE_SPAWN_CHANCE = 0.4;
const TREE_ROAD_CLEARANCE = 4.5;
const TREE_BUILDING_CLEARANCE = 2.5;
const TREE_MAX_COUNT = 240;
const BUILDING_RAYCAST_HEIGHT = 200;

const setTreeShadowing = (tree) => {
  tree.traverse((child) => {
    if (!child.isMesh) return;
    child.castShadow = true;
    child.receiveShadow = true;
  });
};

function pseudoRandom2D(x, z, seed = 0) {
  const value = Math.sin(x * 12.9898 + z * 78.233 + seed) * 43758.5453;
  return value - Math.floor(value);
}

function hashZoneIndex(a, b) {
  const hash = Math.abs(Math.imul(a, 73856093) ^ Math.imul(b, 19349663)) >>> 0;
  return hash;
}

function distanceToSegmentSquared(px, pz, ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  const lengthSq = dx * dx + dz * dz;
  if (lengthSq === 0) {
    const dx0 = px - ax;
    const dz0 = pz - az;
    return dx0 * dx0 + dz0 * dz0;
  }
  let t = ((px - ax) * dx + (pz - az) * dz) / lengthSq;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx;
  const cz = az + t * dz;
  const dx1 = px - cx;
  const dz1 = pz - cz;
  return dx1 * dx1 + dz1 * dz1;
}

export async function createNature({
  scene,
  playerModel,
  getTerrainHeight,
  mapRenderer,
  buildingsRenderer,
  getGeoForLocal
} = {}) {
  if (!scene || !playerModel) return null;

  const loader = new GLTFLoader();
  let gltf;
  try {
    gltf = await loader.loadAsync(TREE_MODEL_URL);
  } catch (error) {
    console.warn('Failed to load tree pack glb.', error);
    return null;
  }

  const treeTypeIndices = TREE_PREFABS.map((_, index) => index)
    .filter((index) => index !== PALM_TREE_INDEX);

  const treeTemplates = TREE_PREFABS.map((parts, index) => {
    if (index === PALM_TREE_INDEX) return null;
    const wrapper = new THREE.Group();
    wrapper.name = `tree_template_${index}`;

    for (const partName of parts) {
      const src = gltf.scene.getObjectByName(partName);
      if (!src) continue;
      const part = src.clone(true);
      setTreeShadowing(part);
      wrapper.add(part);
    }
    wrapper.scale.setScalar(TREE_SCALE);
    return wrapper;
  });

  const group = new THREE.Group();
  group.name = 'nature-group';

  const roadSegments = [];
  const tempStart = new THREE.Vector3();
  const tempEnd = new THREE.Vector3();

  if (mapRenderer?.group) {
    mapRenderer.group.traverse((child) => {
      if (!child?.geometry) return;
      if (!child.isLine && !child.userData?.isWideLine) return;

      const width = Number.isFinite(child.material?.linewidth) ? child.material.linewidth : 1;
      const clearance = width * 0.5 + TREE_ROAD_CLEARANCE;
      const geometry = child.geometry;
      const instanceStart = geometry.attributes?.instanceStart?.array;
      const instanceEnd = geometry.attributes?.instanceEnd?.array;
      const positions = geometry.attributes?.position?.array;

      if (instanceStart && instanceEnd) {
        for (let i = 0; i < instanceStart.length; i += 3) {
          tempStart.set(instanceStart[i], instanceStart[i + 1], instanceStart[i + 2]);
          tempEnd.set(instanceEnd[i], instanceEnd[i + 1], instanceEnd[i + 2]);
          child.localToWorld(tempStart);
          child.localToWorld(tempEnd);
          roadSegments.push({
            ax: tempStart.x,
            az: tempStart.z,
            bx: tempEnd.x,
            bz: tempEnd.z,
            clearance
          });
        }
      } else if (positions && positions.length >= 6) {
        for (let i = 0; i < positions.length - 3; i += 3) {
          tempStart.set(positions[i], positions[i + 1], positions[i + 2]);
          tempEnd.set(positions[i + 3], positions[i + 4], positions[i + 5]);
          child.localToWorld(tempStart);
          child.localToWorld(tempEnd);
          roadSegments.push({
            ax: tempStart.x,
            az: tempStart.z,
            bx: tempEnd.x,
            bz: tempEnd.z,
            clearance
          });
        }
      }
    });
  }

  const buildingRaycaster = new THREE.Raycaster();
  const buildingRayDirection = new THREE.Vector3(0, -1, 0);

  const isNearBuilding = (position) => {
    const buildingsGroup = buildingsRenderer?.group;
    if (!buildingsGroup) return false;
    const terrainY = getTerrainHeight?.(position.x, position.z) ?? position.y ?? 0;
    const rayOrigin = new THREE.Vector3(
      position.x,
      Math.max(position.y ?? terrainY, terrainY) + BUILDING_RAYCAST_HEIGHT,
      position.z
    );
    buildingRaycaster.set(rayOrigin, buildingRayDirection);
    const intersections = buildingRaycaster.intersectObjects(buildingsGroup.children, true);
    for (const intersection of intersections) {
      if (!intersection?.object?.userData?.isBuildingSolid) continue;
      if (intersection.distance <= BUILDING_RAYCAST_HEIGHT + TREE_BUILDING_CLEARANCE) {
        return true;
      }
      return true;
    }
    return false;
  };

  const isNearRoad = (x, z) => {
    if (roadSegments.length === 0) return false;
    for (const segment of roadSegments) {
      const clearanceSq = segment.clearance * segment.clearance;
      if (distanceToSegmentSquared(x, z, segment.ax, segment.az, segment.bx, segment.bz) <= clearanceSq) {
        return true;
      }
    }
    return false;
  };

  const resolveTreeTypeIndex = (position) => {
    const geo = getGeoForLocal?.(position);
    if (geo && Number.isFinite(geo.lat) && Number.isFinite(geo.lon)) {
      const zoneLat = Math.floor(geo.lat / TREE_ZONE_DEGREES);
      const zoneLon = Math.floor(geo.lon / TREE_ZONE_DEGREES);
      const zoneHash = hashZoneIndex(zoneLat, zoneLon);
      return treeTypeIndices[zoneHash % treeTypeIndices.length];
    }
    const zoneX = Math.floor(position.x / TREE_ZONE_METERS);
    const zoneZ = Math.floor(position.z / TREE_ZONE_METERS);
    const zoneHash = hashZoneIndex(zoneX, zoneZ);
    return treeTypeIndices[zoneHash % treeTypeIndices.length];
  };

  const center = playerModel.position.clone();
  let placedCount = 0;

  for (let x = -TREE_RADIUS_METERS; x <= TREE_RADIUS_METERS; x += TREE_GRID_SPACING) {
    for (let z = -TREE_RADIUS_METERS; z <= TREE_RADIUS_METERS; z += TREE_GRID_SPACING) {
      if (placedCount >= TREE_MAX_COUNT) break;
      const distance = Math.hypot(x, z);
      if (distance > TREE_RADIUS_METERS) continue;

      const worldX = center.x + x;
      const worldZ = center.z + z;
      if (pseudoRandom2D(worldX, worldZ, 1.2) > TREE_SPAWN_CHANCE) continue;
      if (isNearRoad(worldX, worldZ)) continue;

      const position = new THREE.Vector3(worldX, 0, worldZ);
      if (isNearBuilding(position)) continue;

      const treeTypeIndex = resolveTreeTypeIndex(position);
      const template = treeTemplates[treeTypeIndex];
      if (!template) continue;

      const tree = template.clone(true);
      const rotation = pseudoRandom2D(worldX, worldZ, 3.4) * Math.PI * 2;
      const scaleVariance = 0.9 + pseudoRandom2D(worldX, worldZ, 7.7) * 0.3;
      tree.rotation.y = rotation;
      tree.scale.multiplyScalar(scaleVariance);

      const terrainY = getTerrainHeight?.(worldX, worldZ) ?? 0;
      tree.position.set(worldX, terrainY, worldZ);
      group.add(tree);
      placedCount += 1;
    }
  }

  scene.add(group);
  return group;
}

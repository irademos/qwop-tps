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
const TREE_GRID_SPACING = 20;
const TREE_SPAWN_CHANCE = 0.4;
const TREE_TILE_BUFFER = 2;
const TREE_ROAD_CLEARANCE = 4.5;
const TREE_BUILDING_CLEARANCE = 2.5;
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
  getGeoForLocal,
  tileCache
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
  scene.add(group);

  const treeTiles = new Map();
  const roadSegmentsByTile = new Map();

  const tempStart = new THREE.Vector3();
  const tempEnd = new THREE.Vector3();
  const tempPosition = new THREE.Vector3();

  let activeTileCache = tileCache ?? null;
  let tileSizeMeters = activeTileCache?.tileSizeMeters ?? 300;
  let tileBuffer = activeTileCache?.evictRadiusTiles ?? TREE_TILE_BUFFER;

  const getTileKey = (tile) => `${tile.x},${tile.y}`;
  const parseTileKey = (tileKey) => {
    const [x, y] = tileKey.split(',').map(Number);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return { x, y };
  };

  const getTileGroup = (rootGroup, prefix, tileKey) => {
    if (!rootGroup || !tileKey) return null;
    return rootGroup.getObjectByName(`${prefix}-${tileKey}`) ?? null;
  };

  const cacheRoadSegmentsForTile = (tileKey) => {
    if (!tileKey || !mapRenderer?.group) return [];
    const tileGroup = getTileGroup(mapRenderer.group, 'osm-highways', tileKey);
    if (!tileGroup) {
      roadSegmentsByTile.set(tileKey, []);
      return [];
    }

    const segments = [];
    tileGroup.traverse((child) => {
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
          segments.push({
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
          segments.push({
            ax: tempStart.x,
            az: tempStart.z,
            bx: tempEnd.x,
            bz: tempEnd.z,
            clearance
          });
        }
      }
    });
    roadSegmentsByTile.set(tileKey, segments);
    return segments;
  };

  const getRoadSegmentsForTile = (tileKey) => {
    if (!roadSegmentsByTile.has(tileKey)) {
      cacheRoadSegmentsForTile(tileKey);
    }
    return roadSegmentsByTile.get(tileKey) ?? [];
  };

  const getNeighborTileKeys = (tileKey) => {
    const tile = parseTileKey(tileKey);
    if (!tile) return [];
    const keys = [];
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        keys.push(getTileKey({ x: tile.x + dx, y: tile.y + dy }));
      }
    }
    return keys;
  };

  const buildingRaycaster = new THREE.Raycaster();
  const buildingRayDirection = new THREE.Vector3(0, -1, 0);

  const isNearBuilding = (position, tileKey) => {
    const buildingsGroup = buildingsRenderer?.group;
    if (!buildingsGroup) return false;
    const targetTiles = tileKey ? getNeighborTileKeys(tileKey) : [];
    const groupsToCheck = targetTiles.length
      ? targetTiles
        .map((key) => getTileGroup(buildingsGroup, 'osm-buildings', key))
        .filter(Boolean)
      : [buildingsGroup];
    if (groupsToCheck.length === 0) return false;
    const terrainY = getTerrainHeight?.(position.x, position.z) ?? position.y ?? 0;
    const rayOrigin = tempPosition.set(
      position.x,
      Math.max(position.y ?? terrainY, terrainY) + BUILDING_RAYCAST_HEIGHT,
      position.z
    );
    buildingRaycaster.set(rayOrigin, buildingRayDirection);
    const intersections = buildingRaycaster.intersectObjects(groupsToCheck, true);
    if (!intersections.length) return false;
    const nearest = intersections[0];
    if (!nearest) return false;
    return nearest.distance <= BUILDING_RAYCAST_HEIGHT + TREE_BUILDING_CLEARANCE;
  };

  const isNearRoad = (x, z, tileKey) => {
    const keys = tileKey ? getNeighborTileKeys(tileKey) : [];
    for (const key of keys) {
      const roadSegments = getRoadSegmentsForTile(key);
      if (roadSegments.length === 0) continue;
      for (const segment of roadSegments) {
        const clearanceSq = segment.clearance * segment.clearance;
        if (distanceToSegmentSquared(x, z, segment.ax, segment.az, segment.bx, segment.bz) <= clearanceSq) {
          return true;
        }
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

  const createTileTrees = (tile) => {
    const tileKey = getTileKey(tile);
    if (treeTiles.has(tileKey)) return treeTiles.get(tileKey);

    const tileGroup = new THREE.Group();
    tileGroup.name = `nature-tile-${tileKey}`;
    group.add(tileGroup);

    const baseX = tile.x * tileSizeMeters;
    const baseZ = tile.y * tileSizeMeters;
    const trees = [];

    for (let ix = 0; ix <= tileSizeMeters; ix += TREE_GRID_SPACING) {
      for (let iz = 0; iz <= tileSizeMeters; iz += TREE_GRID_SPACING) {
        const worldX = baseX + ix;
        const worldZ = baseZ + iz;
        if (pseudoRandom2D(worldX, worldZ, 1.2) > TREE_SPAWN_CHANCE) continue;
        if (isNearRoad(worldX, worldZ, tileKey)) continue;

        tempPosition.set(worldX, 0, worldZ);
        if (isNearBuilding(tempPosition, tileKey)) continue;

        const treeTypeIndex = resolveTreeTypeIndex(tempPosition);
        const template = treeTemplates[treeTypeIndex];
        if (!template) continue;

        const tree = template.clone(true);
        const rotation = pseudoRandom2D(worldX, worldZ, 3.4) * Math.PI * 2;
        const scaleVariance = 0.9 + pseudoRandom2D(worldX, worldZ, 7.7) * 0.3;
        tree.rotation.y = rotation;
        tree.scale.multiplyScalar(scaleVariance);

        const terrainY = getTerrainHeight?.(worldX, worldZ) ?? 0;
        tree.position.set(worldX, terrainY, worldZ);
        tileGroup.add(tree);
        trees.push(tree);
      }
    }

    const entry = { tile, tileKey, group: tileGroup, trees };
    treeTiles.set(tileKey, entry);
    return entry;
  };

  const pruneTileTrees = (tileKey) => {
    const entry = treeTiles.get(tileKey);
    if (!entry) return;
    const remaining = [];
    for (const tree of entry.trees) {
      if (!tree) continue;
      const { x, z } = tree.position;
      if (isNearRoad(x, z, tileKey)) {
        entry.group.remove(tree);
        continue;
      }
      if (isNearBuilding(tree.position, tileKey)) {
        entry.group.remove(tree);
        continue;
      }
      remaining.push(tree);
    }
    entry.trees = remaining;
  };

  let lastPlayerTileKey = null;

  const update = (playerPosition) => {
    if (!playerPosition) return;
    const tile = {
      x: Math.floor(playerPosition.x / tileSizeMeters),
      y: Math.floor(playerPosition.z / tileSizeMeters)
    };
    const centerKey = getTileKey(tile);
    if (centerKey === lastPlayerTileKey) return;
    lastPlayerTileKey = centerKey;

    const neededKeys = new Set();
    for (let dx = -tileBuffer; dx <= tileBuffer; dx += 1) {
      for (let dy = -tileBuffer; dy <= tileBuffer; dy += 1) {
        const nextTile = { x: tile.x + dx, y: tile.y + dy };
        const nextKey = getTileKey(nextTile);
        neededKeys.add(nextKey);
        createTileTrees(nextTile);
      }
    }

    for (const [key, entry] of treeTiles.entries()) {
      if (neededKeys.has(key)) continue;
      group.remove(entry.group);
      treeTiles.delete(key);
      roadSegmentsByTile.delete(key);
    }
  };

  const refreshTile = (tileKey) => {
    if (!tileKey) return;
    cacheRoadSegmentsForTile(tileKey);
    pruneTileTrees(tileKey);
  };

  const refreshAll = () => {
    for (const tileKey of treeTiles.keys()) {
      refreshTile(tileKey);
    }
  };

  const setTileCache = (nextCache) => {
    activeTileCache = nextCache ?? null;
    tileSizeMeters = activeTileCache?.tileSizeMeters ?? tileSizeMeters;
    tileBuffer = activeTileCache?.evictRadiusTiles ?? tileBuffer;
    lastPlayerTileKey = null;
    for (const entry of treeTiles.values()) {
      entry.group.clear();
      group.remove(entry.group);
    }
    treeTiles.clear();
    roadSegmentsByTile.clear();
  };

  const dispose = () => {
    for (const entry of treeTiles.values()) {
      entry.group.clear();
      group.remove(entry.group);
    }
    treeTiles.clear();
    roadSegmentsByTile.clear();
    group.clear();
    scene?.remove(group);
  };

  return {
    group,
    update,
    refreshTile,
    refreshAll,
    setTileCache,
    dispose
  };
}

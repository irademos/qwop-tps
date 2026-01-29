import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { setClimbableAreas } from '../controls/climb.js';

const TREE_MODEL_URL = '/assets/props/low_poly_tree_pack.glb';
const TREE_SCALE_REFERENCE = 0.016;
const TREE_SCALE_MIN = 0.012;
const TREE_SCALE_MAX = 0.02;
const TREE_PREFABS = [
  ['Circle'],                 // Eucalyptus (has multiple meshes under it)
  ['Circle001'],              // Pine
  ['Circle002'],              // Palm
  ['Circle003', 'Circle004'], // Cypress or Larch or Fir (split across 2 sibling nodes)
  ['Circle005'],              // Oak
  ['Circle006'],              // Scary / Dead tree
  ['Circle007']               // Larch or Beech
];
const TREE_CLIMB_RIGHT_SHIFT_BY_TYPE = {
  0: 2.7, // eucalyptus
  5: -2.5  // scary/dead
};

const TREE_CLIMB_OVERRIDES = {
  0: { halfWidth: 0.4, halfDepth: 0.75, entryHeight: 0.0, maxYPad: 3.0 }, // eucalyptus
  5: { halfWidth: 0.75, halfDepth: 0.75, entryHeight: 0.0, minYPad: 0.0, maxYPad: 6.4 }  // dead/scary
  // others default
};

const PALM_TREE_INDEX = 2;
const TREE_ZONE_DEGREES = 0.0009;
const TREE_ZONE_METERS = 100;
const TREE_GRID_SPACING = 20;
const TREE_SPAWN_CHANCE = 0.4;
const TREE_TILE_BUFFER = 2;
const TREE_CLIMB_HALF_WIDTH = 0.6;
const TREE_CLIMB_HALF_DEPTH = 0.6;
const TREE_CLIMB_ENTRY_RADIUS = 1.0;
const TREE_CLIMB_ENTRY_HEIGHT = 1.4;

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

export async function createNature({
  scene,
  playerModel,
  getTerrainHeight,
  getGeoForLocal,
  tileCache,
  spawnApplePickup,
  removeApplePickup
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
    wrapper.scale.setScalar(1);
    return wrapper;
  });

  const group = new THREE.Group();
  group.name = 'nature-group';
  scene.add(group);

  const treeTiles = new Map();
  const climbableAreasByTile = new Map();
  const applePickupsByTile = new Map();
  const debugMaterial = new THREE.LineBasicMaterial({ color: 0xffff00 });
  const tempPosition = new THREE.Vector3();
  const tempBox = new THREE.Box3();
  const tempCenter = new THREE.Vector3();
  const tempSize = new THREE.Vector3();
  const tempWorldPos = new THREE.Vector3();

  let activeTileCache = tileCache ?? null;
  let tileSizeMeters = activeTileCache?.tileSizeMeters ?? 300;
  const getTreeTileBuffer = (cache) =>
    Math.max(0, Math.floor((cache?.evictRadiusTiles ?? TREE_TILE_BUFFER) / 3));
  let tileBuffer = getTreeTileBuffer(activeTileCache);

  const getTileKey = (tile) => `${tile.x},${tile.y}`;

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

  const refreshClimbableAreas = () => {
    const merged = [];
    for (const areas of climbableAreasByTile.values()) {
      merged.push(...areas);
    }
    setClimbableAreas('trees', merged);
  };

  const buildTreeClimbAreas = (tree) => {
    tree.updateWorldMatrix(true, true);
    tempBox.setFromObject(tree);
    if (!Number.isFinite(tempBox.min.x)) return [];
    tempBox.getSize(tempSize);
    tree.getWorldPosition(tempWorldPos);
    tempBox.getCenter(tempCenter);
    
    const typeIndex = tree.userData.treeTypeIndex;
    const o = TREE_CLIMB_OVERRIDES[typeIndex] ?? {};
    const scaleFactor = tree.scale.x / TREE_SCALE_REFERENCE;
    const scaleValue = (value) => value * scaleFactor;

    const minY = tempBox.min.y + scaleValue(o.minYPad ?? 0);
    const maxY = tempBox.max.y - scaleValue(o.maxYPad ?? 0);
    const halfHeight = (maxY - minY) * 0.5;
    const center = tempCenter.clone();
    center.y = (minY + maxY) * 0.5;

    const halfWidth = scaleValue(o.halfWidth ?? TREE_CLIMB_HALF_WIDTH);
    const halfDepth = scaleValue(o.halfDepth ?? TREE_CLIMB_HALF_DEPTH);
    const entryRadius = scaleValue(o.entryRadius ?? TREE_CLIMB_ENTRY_RADIUS);
    const entryHeight = scaleValue(o.entryHeight ?? TREE_CLIMB_ENTRY_HEIGHT);

    const entryCenter = tempCenter.clone();
    entryCenter.y = minY + scaleValue(0.2);

    const shift = scaleValue(TREE_CLIMB_RIGHT_SHIFT_BY_TYPE[typeIndex] ?? 0);

    // tree's local +X rotated by tree.rotation.y
    const rightWorld = new THREE.Vector3(1, 0, 0).applyAxisAngle(
      new THREE.Vector3(0, 1, 0),
      tree.rotation.y
    );
    center.addScaledVector(rightWorld, shift);
    entryCenter.addScaledVector(rightWorld, shift);

    const areas = [];
    const directions = [
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(-1, 0, 0),
      new THREE.Vector3(0, 0, 1),
      new THREE.Vector3(0, 0, -1)
    ];
    for (const normal of directions) {
      const rotationY = Math.atan2(normal.x, normal.z);
      const areaCenter = center.clone().addScaledVector(normal, halfDepth + scaleValue(0.05));
      areas.push({
        center: areaCenter,
        rotationY,
        halfWidth,
        halfDepth,
        halfHeight,
        minY,
        maxY,
        entryCenter: entryCenter.clone(),
        entryRadius,
        entryHeight,
        normal: normal.clone()
      });
    }
    return areas;
  };

  const addClimbDebugLines = (area, parent) => {
    if (!area || !parent) return;
    const width = (area.halfWidth ?? 0) * 2;
    const height = (area.halfHeight ?? 0) * 2;
    const depth = (area.halfDepth ?? 0) * 2;
    if (width <= 0 || height <= 0 || depth <= 0) return;
    const geometry = new THREE.BoxGeometry(width, height, depth);
    const edges = new THREE.EdgesGeometry(geometry);
    const lines = new THREE.LineSegments(edges, debugMaterial);
    lines.position.copy(area.center);
    lines.rotation.y = area.rotationY ?? 0;
    parent.add(lines);
  };

  const createTileTrees = (tile) => {
    const tileKey = getTileKey(tile);
    if (treeTiles.has(tileKey)) return treeTiles.get(tileKey);

    const tileGroup = new THREE.Group();
    tileGroup.name = `nature-tile-${tileKey}`;
    group.add(tileGroup);
    const debugGroup = new THREE.Group();
    debugGroup.name = `nature-tile-${tileKey}-climb-debug`;
    tileGroup.add(debugGroup);

    const baseX = tile.x * tileSizeMeters;
    const baseZ = tile.y * tileSizeMeters;
    const trees = [];
    const tileClimbAreas = [];
    const tileApplePickups = [];

    for (let ix = 0; ix <= tileSizeMeters; ix += TREE_GRID_SPACING) {
      for (let iz = 0; iz <= tileSizeMeters; iz += TREE_GRID_SPACING) {
        const worldX = baseX + ix;
        const worldZ = baseZ + iz;
        if (pseudoRandom2D(worldX, worldZ, 1.2) > TREE_SPAWN_CHANCE) continue;

        tempPosition.set(worldX, 0, worldZ);

        const treeTypeIndex = resolveTreeTypeIndex(tempPosition);
        const template = treeTemplates[treeTypeIndex];
        if (!template) continue;

        const tree = template.clone(true);
        tree.userData.treeTypeIndex = treeTypeIndex;
        const rotation = pseudoRandom2D(worldX, worldZ, 3.4) * Math.PI * 2;
        tree.rotation.y = rotation;
        const scale =
          TREE_SCALE_MIN +
          pseudoRandom2D(worldX, worldZ, 7.7) * (TREE_SCALE_MAX - TREE_SCALE_MIN);
        tree.scale.setScalar(scale);

        const terrainY = getTerrainHeight?.(worldX, worldZ) ?? 0;
        tree.position.set(worldX, terrainY, worldZ);
        tileGroup.add(tree);
        trees.push(tree);
        const areas = buildTreeClimbAreas(tree);
        tileClimbAreas.push(...areas);
        if (typeof spawnApplePickup === 'function') {
          tree.updateWorldMatrix(true, true);
          tempBox.setFromObject(tree);
          if (Number.isFinite(tempBox.min.y)) {
            tempBox.getSize(tempSize);
            tempBox.getCenter(tempCenter);
            const height = tempSize.y;
            if (height > 0) {
              const radius = Math.max(0.4, Math.min(tempSize.x, tempSize.z) * 0.35);
              for (let i = 0; i < 2; i += 1) {
                const angle = pseudoRandom2D(worldX + i * 13.7, worldZ + i * 9.3, 12.4) * Math.PI * 2;
                const distance = radius * (0.1 + pseudoRandom2D(worldX, worldZ, 7.1 + i) * 0.2);
                const heightFactor = 0.6 + pseudoRandom2D(worldX, worldZ, 4.9 + i) * 0.35;
                const applePosition = new THREE.Vector3(
                  tempCenter.x + Math.cos(angle) * distance,
                  tempBox.min.y + height * heightFactor,
                  tempCenter.z + Math.sin(angle) * distance
                );
                const pickup = spawnApplePickup(applePosition, { applyTerrainHeight: false, lift: 0 });
                if (pickup) {
                  tileApplePickups.push(pickup);
                }
              }
            }
          }
        }
      }
    }

    const entry = { tile, tileKey, group: tileGroup, trees };
    treeTiles.set(tileKey, entry);
    climbableAreasByTile.set(tileKey, tileClimbAreas);
    applePickupsByTile.set(tileKey, tileApplePickups);
    refreshClimbableAreas();
    return entry;
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
      climbableAreasByTile.delete(key);
      const tilePickups = applePickupsByTile.get(key) ?? [];
      if (typeof removeApplePickup === 'function') {
        tilePickups.forEach((pickup) => removeApplePickup(pickup));
      }
      applePickupsByTile.delete(key);
    }
    refreshClimbableAreas();
  };

  const refreshTile = (tileKey) => {
    if (!tileKey) return;
  };

  const refreshAll = () => {
  };

  const setTileCache = (nextCache) => {
    activeTileCache = nextCache ?? null;
    tileSizeMeters = activeTileCache?.tileSizeMeters ?? tileSizeMeters;
    tileBuffer = getTreeTileBuffer(activeTileCache);
    lastPlayerTileKey = null;
    for (const entry of treeTiles.values()) {
      entry.group.clear();
      group.remove(entry.group);
    }
    treeTiles.clear();
    climbableAreasByTile.clear();
    if (typeof removeApplePickup === 'function') {
      for (const tilePickups of applePickupsByTile.values()) {
        tilePickups.forEach((pickup) => removeApplePickup(pickup));
      }
    }
    applePickupsByTile.clear();
    refreshClimbableAreas();
  };

  const dispose = () => {
    for (const entry of treeTiles.values()) {
      entry.group.clear();
      group.remove(entry.group);
    }
    treeTiles.clear();
    climbableAreasByTile.clear();
    if (typeof removeApplePickup === 'function') {
      for (const tilePickups of applePickupsByTile.values()) {
        tilePickups.forEach((pickup) => removeApplePickup(pickup));
      }
    }
    applePickupsByTile.clear();
    refreshClimbableAreas();
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

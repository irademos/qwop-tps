import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { setClimbableAreas } from '../controls/climb.js';

const TREE_MODEL_URL = '/assets/props/low_poly_tree_pack.glb';
const TREE_SCALE_REFERENCE = 0.016;
const TREE_SCALE_MIN = 0.012;
const TREE_SCALE_MAX = 0.02;
const TREE_IMPOSTOR_TRUNK_COLOR = 0x6f4e37;
const TREE_IMPOSTOR_LEAF_PALETTE = [0x3f8f3f, 0x4fa14f, 0x5a9f42, 0x6cae52, 0x4b8c3f, 0x739f55];
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
const TREE_SPAWN_CHANCE_NEAR = 0.6;
const TREE_SPAWN_CHANCE_MID = 0.35;
const TREE_SPAWN_CHANCE_FAR = 0.15;
const TREE_TILE_SIZE_METERS = 150;
const TREE_TILE_BUFFER = 5;
// Keep high-detail, interactable GLB trees only on the player's current tile.
// Neighboring tiles and beyond should use primitive impostors.
const NEAR_TILE_DISTANCE = 1;
const ROCK_GRID_SPACING = 24;
const ROCK_SPAWN_CHANCE = 0.28;
const ROCK_MIN_RADIUS = 0.45;
const ROCK_MAX_RADIUS = 1.4;
const ROCK_COLLIDER_HEIGHT_RATIO = 0.7;
const TREE_CLIMB_HALF_WIDTH = 0.6;
const TREE_CLIMB_HALF_DEPTH = 0.6;
const TREE_CLIMB_ENTRY_RADIUS = 1.0;
const TREE_CLIMB_ENTRY_HEIGHT = 1.4;
const METERS_PER_DEGREE_LAT = 111_132.92;
const ROAD_WIDTHS = {
  footway: 0.4,
  path: 0.5,
  cycleway: 0.6,
  steps: 0.35,
  track: 0.7,
  service: 0.9,
  residential: 1.2,
  living_street: 1.1,
  unclassified: 1.1,
  tertiary: 1.5,
  secondary: 2.0,
  primary: 2.6,
  trunk: 3.0,
  motorway: 3.4
};
const DEFAULT_ROAD_WIDTH = 1.0;
const ROAD_WIDTH_SCALE = 10;

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

function getTreeSpawnChanceForTileDistance(tileDistance) {
  if (!Number.isFinite(tileDistance) || tileDistance <= 0) {
    return TREE_SPAWN_CHANCE_NEAR;
  }
  const normalizedDistance = Math.min(tileDistance, TREE_TILE_BUFFER) / TREE_TILE_BUFFER;
  return TREE_SPAWN_CHANCE_MID
    + (TREE_SPAWN_CHANCE_FAR - TREE_SPAWN_CHANCE_MID) * normalizedDistance;
}

function getTileDetailLevel(tile, centerTile) {
  if (!tile || !centerTile) return 'far';
  const dx = tile.x - centerTile.x;
  const dy = tile.y - centerTile.y;
  const tileDistance = Math.hypot(dx, dy);
  return tileDistance <= NEAR_TILE_DISTANCE ? 'near' : 'far';
}

function metersPerDegreeLon(latDeg) {
  return 111_412.84 * Math.cos((latDeg * Math.PI) / 180);
}

function toLocalMeters(coord, origin, lonScale) {
  const [lon, lat] = coord;
  return {
    x: -(lon - origin.centerLon) * lonScale,
    z: (lat - origin.centerLat) * METERS_PER_DEGREE_LAT
  };
}

function resolveRoadWidth(highway) {
  if (typeof highway !== 'string') return DEFAULT_ROAD_WIDTH;
  const baseWidth = ROAD_WIDTHS[highway] ?? DEFAULT_ROAD_WIDTH;
  return baseWidth * ROAD_WIDTH_SCALE;
}

function collectBuildingPolygons(geojson) {
  const polygons = [];
  const features = geojson?.prefiltered?.buildings ?? geojson?.features ?? [];
  for (const feature of features) {
    if (!feature?.properties?.building) continue;
    const geometry = feature.geometry;
    if (!geometry) continue;
    if (geometry.type === 'Polygon') {
      polygons.push(geometry.coordinates);
    } else if (geometry.type === 'MultiPolygon') {
      for (const polygon of geometry.coordinates) {
        polygons.push(polygon);
      }
    }
  }
  return polygons;
}

function collectHighwayLines(geojson) {
  const lines = [];
  const features = geojson?.prefiltered?.highways ?? geojson?.features ?? [];
  for (const feature of features) {
    if (!feature?.properties?.highway) continue;
    const geometry = feature.geometry;
    if (!geometry) continue;
    if (geometry.type === 'LineString') {
      lines.push({ highway: feature.properties.highway, coords: geometry.coordinates });
    } else if (geometry.type === 'MultiLineString') {
      for (const line of geometry.coordinates) {
        lines.push({ highway: feature.properties.highway, coords: line });
      }
    }
  }
  return lines;
}

function normalizeRing(ring) {
  if (!ring || ring.length === 0) return [];
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] === last[0] && first[1] === last[1]) return ring.slice(0, -1);
  return ring;
}

function ringToPoints(ring, origin, lonScale) {
  const points = [];
  const coords = normalizeRing(ring);
  for (const coord of coords) {
    if (!coord || coord.length < 2) continue;
    const local = toLocalMeters(coord, origin, lonScale);
    points.push({ x: local.x, z: local.z });
  }
  return points;
}

function computeRingBounds(points) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minZ = Math.min(minZ, point.z);
    maxZ = Math.max(maxZ, point.z);
  }
  if (!Number.isFinite(minX)) return null;
  return { minX, maxX, minZ, maxZ };
}

function pointInRing(point, ring) {
  if (!ring || ring.length < 3) return false;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const xi = ring[i].x;
    const zi = ring[i].z;
    const xj = ring[j].x;
    const zj = ring[j].z;
    const intersect = ((zi > point.z) !== (zj > point.z))
      && (point.x < ((xj - xi) * (point.z - zi)) / (zj - zi + Number.EPSILON) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function distancePointToSegment(point, a, b) {
  const abx = b.x - a.x;
  const abz = b.z - a.z;
  const apx = point.x - a.x;
  const apz = point.z - a.z;
  const abLenSq = abx * abx + abz * abz;
  const t = abLenSq > 0 ? Math.max(0, Math.min(1, (apx * abx + apz * abz) / abLenSq)) : 0;
  const closestX = a.x + abx * t;
  const closestZ = a.z + abz * t;
  const dx = point.x - closestX;
  const dz = point.z - closestZ;
  return Math.hypot(dx, dz);
}

function distanceToRing(point, ring) {
  if (!ring || ring.length < 2) return Infinity;
  let min = Infinity;
  for (let i = 0; i < ring.length; i += 1) {
    const next = (i + 1) % ring.length;
    const dist = distancePointToSegment(point, ring[i], ring[next]);
    if (dist < min) min = dist;
  }
  return min;
}

export async function createNature({
  scene,
  playerModel,
  getTerrainHeight,
  getGeoForLocal,
  tileCache,
  rapier,
  rapierWorld,
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
  const rockMaterial = new THREE.MeshStandardMaterial({
    color: 0x8b8f96,
    roughness: 0.95,
    metalness: 0.05,
    flatShading: true
  });
  const rockGeometries = [
    new THREE.DodecahedronGeometry(1, 0),
    new THREE.IcosahedronGeometry(1, 0)
  ];
  const treeImpostorTrunkGeometry = new THREE.CylinderGeometry(0.06, 0.08, 0.35, 5);
  const treeImpostorLeafGeometry = new THREE.ConeGeometry(0.28, 0.75, 6);
  const treeImpostorTrunkMaterial = new THREE.MeshStandardMaterial({
    color: TREE_IMPOSTOR_TRUNK_COLOR,
    roughness: 0.95,
    metalness: 0.02,
    flatShading: true
  });
  const treeImpostorLeafMaterials = TREE_IMPOSTOR_LEAF_PALETTE.map((color) => new THREE.MeshStandardMaterial({
    color,
    roughness: 0.9,
    metalness: 0.01,
    flatShading: true
  }));
  const tempPosition = new THREE.Vector3();
  const tempBox = new THREE.Box3();
  const tempCenter = new THREE.Vector3();
  const tempSize = new THREE.Vector3();
  const tempWorldPos = new THREE.Vector3();
  const tempTreeCenter = new THREE.Vector3();
  const tempTreeRight = new THREE.Vector3();
  const tempEntryCenter = new THREE.Vector3();
  const tempAreaCenter = new THREE.Vector3();
  const tempWorldToLocal = new THREE.Vector3();
  const tempApplePosition = new THREE.Vector3();
  const tempAxisY = new THREE.Vector3(0, 1, 0);
  const climbDirections = [
    new THREE.Vector3(1, 0, 0),
    new THREE.Vector3(-1, 0, 0),
    new THREE.Vector3(0, 0, 1),
    new THREE.Vector3(0, 0, -1)
  ];

  let activeTileCache = tileCache ?? null;
  let tileSizeMeters = TREE_TILE_SIZE_METERS;
  const getTreeTileBuffer = (cache) => {
    const evictRadius = cache?.evictRadiusTiles ?? TREE_TILE_BUFFER;
    // Keep at least one ring of neighboring tiles populated around the player.
    // This avoids trees/rocks popping right at tile boundaries while still
    // respecting larger cache radii when configured.
    return Math.max(1, Math.ceil(evictRadius / 2));
  };
  let tileBuffer = getTreeTileBuffer(activeTileCache);

  const getTileKey = (tile) => `${tile.x},${tile.y}`;
  const getTileFromKey = (tileKey) => {
    if (!tileKey) return null;
    const [x, y] = tileKey.split(',').map((value) => parseInt(value, 10));
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return { x, y };
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

  const getRenderOrigin = () => {
    if (typeof getGeoForLocal !== 'function') return null;
    tempPosition.set(0, 0, 0);
    const originGeo = getGeoForLocal(tempPosition);
    if (!originGeo || !Number.isFinite(originGeo.lat) || !Number.isFinite(originGeo.lon)) {
      return null;
    }
    return {
      centerLat: originGeo.lat,
      centerLon: originGeo.lon
    };
  };

  const resolveCacheTileKey = (tile, tileKey) => {
    if (!activeTileCache || !tile) return tileKey;
    const tileCenter = {
      x: (tile.x + 0.5) * tileSizeMeters,
      z: (tile.y + 0.5) * tileSizeMeters
    };
    const cacheTile = activeTileCache.getTileCoords?.(tileCenter);
    if (!cacheTile) return tileKey;
    return activeTileCache.getTileKey?.(cacheTile) ?? `${cacheTile.x},${cacheTile.y}`;
  };

  const buildTileBlockers = (tile, tileKey) => {
    const cacheTileKey = resolveCacheTileKey(tile, tileKey);
    const entry = activeTileCache?.getEntry?.(cacheTileKey) ?? activeTileCache?.cache?.get(cacheTileKey);
    const geojson = entry?.geojson;
    if (!geojson) return null;
    const origin = getRenderOrigin();
    if (!origin) return null;
    const lonScale = metersPerDegreeLon(origin.centerLat);

    const buildings = [];
    for (const rings of collectBuildingPolygons(geojson)) {
      if (!rings || rings.length === 0) continue;
      const outer = ringToPoints(rings[0], origin, lonScale);
      if (outer.length < 3) continue;
      const holes = [];
      for (let i = 1; i < rings.length; i += 1) {
        const hole = ringToPoints(rings[i], origin, lonScale);
        if (hole.length >= 3) holes.push(hole);
      }
      const bounds = computeRingBounds(outer);
      if (!bounds) continue;
      buildings.push({ outer, holes, bounds });
    }

    const roads = [];
    for (const line of collectHighwayLines(geojson)) {
      if (!line.coords || line.coords.length < 2) continue;
      const points = [];
      for (const coord of line.coords) {
        if (!coord || coord.length < 2) continue;
        const local = toLocalMeters(coord, origin, lonScale);
        points.push({ x: local.x, z: local.z });
      }
      if (points.length < 2) continue;
      roads.push({
        width: resolveRoadWidth(line.highway),
        points
      });
    }

    if (buildings.length === 0 && roads.length === 0) return null;
    return { buildings, roads };
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
    const centerX = tempCenter.x;
    const centerY = (minY + maxY) * 0.5;
    const centerZ = tempCenter.z;

    const halfWidth = scaleValue(o.halfWidth ?? TREE_CLIMB_HALF_WIDTH);
    const halfDepth = scaleValue(o.halfDepth ?? TREE_CLIMB_HALF_DEPTH);
    const entryRadius = scaleValue(o.entryRadius ?? TREE_CLIMB_ENTRY_RADIUS);
    const entryHeight = scaleValue(o.entryHeight ?? TREE_CLIMB_ENTRY_HEIGHT);

    tempEntryCenter.set(tempCenter.x, minY + scaleValue(0.2), tempCenter.z);

    const shift = scaleValue(TREE_CLIMB_RIGHT_SHIFT_BY_TYPE[typeIndex] ?? 0);

    // tree's local +X rotated by tree.rotation.y
    tempTreeRight.set(1, 0, 0).applyAxisAngle(tempAxisY, tree.rotation.y);
    const shiftedCenterX = centerX + tempTreeRight.x * shift;
    const shiftedCenterZ = centerZ + tempTreeRight.z * shift;
    tempEntryCenter.addScaledVector(tempTreeRight, shift);

    const areas = [];
    for (const normal of climbDirections) {
      const rotationY = Math.atan2(normal.x, normal.z);
      tempAreaCenter.set(shiftedCenterX, centerY, shiftedCenterZ)
        .addScaledVector(normal, halfDepth + scaleValue(0.05));
      areas.push({
        center: new THREE.Vector3(tempAreaCenter.x, tempAreaCenter.y, tempAreaCenter.z),
        rotationY,
        halfWidth,
        halfDepth,
        halfHeight,
        minY,
        maxY,
        entryCenter: new THREE.Vector3(tempEntryCenter.x, tempEntryCenter.y, tempEntryCenter.z),
        entryRadius,
        entryHeight,
        normal: new THREE.Vector3(normal.x, normal.y, normal.z)
      });
    }
    return areas;
  };

  const getTreeWorldCenter = (tree) => {
    if (!tree) return null;
    if (tree.userData?.boundsCenterLocal) {
      tempTreeCenter.copy(tree.userData.boundsCenterLocal).applyMatrix4(tree.matrixWorld);
    } else {
      tempTreeCenter.copy(tree.position);
    }
    const typeIndex = tree.userData?.treeTypeIndex;
    const shift = TREE_CLIMB_RIGHT_SHIFT_BY_TYPE[typeIndex] ?? 0;
    if (shift) {
      const scaleFactor = tree.scale.x / TREE_SCALE_REFERENCE;
      tempTreeRight.set(1, 0, 0).applyAxisAngle(tempAxisY, tree.rotation.y);
      tempTreeCenter.addScaledVector(tempTreeRight, shift * scaleFactor);
    }
    return tempTreeCenter;
  };

  const isTreeBlocked = (tree, blockers) => {
    if (!tree || !blockers) return false;
    const center = getTreeWorldCenter(tree);
    if (!center) return false;
    const radius = tree.userData?.boundsRadius ?? 0;
    const point = { x: center.x, z: center.z };
    for (const building of blockers.buildings ?? []) {
      const { bounds, outer, holes } = building;
      if (bounds) {
        if (point.x < bounds.minX - radius
          || point.x > bounds.maxX + radius
          || point.z < bounds.minZ - radius
          || point.z > bounds.maxZ + radius) {
          continue;
        }
      }
      const insideOuter = pointInRing(point, outer);
      const distanceToOuter = insideOuter ? 0 : distanceToRing(point, outer);
      if (insideOuter || distanceToOuter <= radius) {
        let insideHole = false;
        for (const hole of holes ?? []) {
          if (pointInRing(point, hole)) {
            insideHole = true;
            break;
          }
        }
        if (!insideHole) return true;
      }
    }
    for (const road of blockers.roads ?? []) {
      const width = road.width ?? DEFAULT_ROAD_WIDTH;
      const threshold = width * 0.5 + radius;
      const points = road.points ?? [];
      for (let i = 0; i < points.length - 1; i += 1) {
        const dist = distancePointToSegment(point, points[i], points[i + 1]);
        if (dist <= threshold) return true;
      }
    }
    return false;
  };

  const createRockCollider = (rock, radius) => {
    if (!rock || !rapier || !rapierWorld) return null;
    const center = rock.position;
    const colliderRadius = Math.max(0.1, radius * 0.92);
    const halfHeight = Math.max(0.12, radius * ROCK_COLLIDER_HEIGHT_RATIO);
    const rbDesc = rapier.RigidBodyDesc.fixed()
      .setTranslation(center.x, center.y + halfHeight, center.z);
    const rb = rapierWorld.createRigidBody(rbDesc);
    const colliderDesc = rapier.ColliderDesc.cylinder(halfHeight, colliderRadius)
      .setFriction(0.9)
      .setRestitution(0.05);
    const collider = rapierWorld.createCollider(colliderDesc, rb);
    return { rb, collider };
  };

  const createTreeImpostor = ({
    worldX,
    worldZ,
    tileKey,
    scale,
    rotation,
    terrainY,
    treeTypeIndex
  }) => {
    const impostor = new THREE.Group();
    impostor.name = 'tree-impostor';

    const trunk = new THREE.Mesh(treeImpostorTrunkGeometry, treeImpostorTrunkMaterial);
    trunk.castShadow = false;
    trunk.receiveShadow = true;
    trunk.position.y = 0.2;
    impostor.add(trunk);

    const leafMaterial = treeImpostorLeafMaterials[treeTypeIndex % treeImpostorLeafMaterials.length];
    const leaves = new THREE.Mesh(treeImpostorLeafGeometry, leafMaterial);
    leaves.castShadow = false;
    leaves.receiveShadow = true;
    leaves.position.y = 0.8;
    impostor.add(leaves);

    impostor.position.set(worldX, terrainY, worldZ);
    impostor.rotation.y = rotation;
    impostor.scale.setScalar(Math.max(0.25, scale * 20.0 / TREE_SCALE_REFERENCE));
    impostor.userData = {
      tileKey,
      interactable: false,
      isImpostor: true
    };
    return impostor;
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

  const createTileTrees = (tile, centerTile = tile) => {
    const tileKey = getTileKey(tile);
    if (treeTiles.has(tileKey)) return treeTiles.get(tileKey);
    const detailLevel = getTileDetailLevel(tile, centerTile);
    const isNearDetail = detailLevel === 'near';

    const tileGroup = new THREE.Group();
    tileGroup.name = `nature-tile-${tileKey}`;
    group.add(tileGroup);
    const debugGroup = new THREE.Group();
    debugGroup.name = `nature-tile-${tileKey}-climb-debug`;
    tileGroup.add(debugGroup);

    const baseX = tile.x * tileSizeMeters;
    const baseZ = tile.y * tileSizeMeters;
    const trees = [];
    const rocks = [];
    const rockPhysics = [];
    const tileClimbAreas = [];
    const tileApplePickups = [];
    const tileBlockers = isNearDetail ? buildTileBlockers(tile, tileKey) : null;
    const tileDx = tile.x - centerTile.x;
    const tileDy = tile.y - centerTile.y;
    const tileDistance = Math.hypot(tileDx, tileDy);
    const treeSpawnChance = getTreeSpawnChanceForTileDistance(tileDistance);

    for (let ix = 0; ix <= tileSizeMeters; ix += TREE_GRID_SPACING) {
      for (let iz = 0; iz <= tileSizeMeters; iz += TREE_GRID_SPACING) {
        const worldX = baseX + ix;
        const worldZ = baseZ + iz;
        if (pseudoRandom2D(worldX, worldZ, 1.2) > treeSpawnChance) continue;

        tempPosition.set(worldX, 0, worldZ);

        const treeTypeIndex = resolveTreeTypeIndex(tempPosition);
        const template = treeTemplates[treeTypeIndex];
        if (!template) continue;

        const rotation = pseudoRandom2D(worldX, worldZ, 3.4) * Math.PI * 2;
        const scale =
          TREE_SCALE_MIN +
          pseudoRandom2D(worldX, worldZ, 7.7) * (TREE_SCALE_MAX - TREE_SCALE_MIN);
        const terrainY = getTerrainHeight?.(worldX, worldZ) ?? 0;
        const tree = isNearDetail
          ? template.clone(true)
          : createTreeImpostor({ worldX, worldZ, tileKey, scale, rotation, terrainY, treeTypeIndex });

        if (isNearDetail) {
          tree.userData.applePickups = [];
          tree.userData.isFlammable = true;
          tree.userData.treeTypeIndex = treeTypeIndex;
          tree.userData.interactable = true;
          tree.rotation.y = rotation;
          tree.scale.setScalar(scale);
          tree.position.set(worldX, terrainY, worldZ);
          tree.userData.tileKey = tileKey;
        }

        if (isNearDetail) {
          tree.updateWorldMatrix(true, true);
          tempBox.setFromObject(tree);
          if (Number.isFinite(tempBox.min.x)) {
            tempBox.getCenter(tempCenter);
            tempWorldToLocal.copy(tempCenter);
            tree.userData.boundsCenterLocal = tree.worldToLocal(tempWorldToLocal);
            tempBox.getSize(tempSize);
            tree.userData.boundsRadius = Math.max(tempSize.x, tempSize.z) * 0.5;
          }
        }
        if (tileBlockers && isTreeBlocked(tree, tileBlockers)) {
          continue;
        }
        tileGroup.add(tree);
        trees.push(tree);
        if (isNearDetail) {
          const areas = buildTreeClimbAreas(tree);
          tree.userData.climbAreas = areas;
          tileClimbAreas.push(...areas);
          if (typeof spawnApplePickup === 'function') {
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
                  tempApplePosition.set(
                    tempCenter.x + Math.cos(angle) * distance,
                    tempBox.min.y + height * heightFactor,
                    tempCenter.z + Math.sin(angle) * distance
                  );
                  const localApplePosition = tree.worldToLocal(tempWorldToLocal.copy(tempApplePosition));
                  const pickup = spawnApplePickup(localApplePosition, {
                    applyTerrainHeight: false,
                    lift: 0,
                    parent: tree
                  });
                  if (pickup) {
                    tileApplePickups.push(pickup);
                    tree.userData.applePickups.push(pickup);
                  }
                }
              }
            }
          }
        }
      }
    }

    for (let ix = 0; ix <= tileSizeMeters; ix += ROCK_GRID_SPACING) {
      for (let iz = 0; iz <= tileSizeMeters; iz += ROCK_GRID_SPACING) {
        const worldX = baseX + ix;
        const worldZ = baseZ + iz;
        if (pseudoRandom2D(worldX, worldZ, 21.1) > ROCK_SPAWN_CHANCE) continue;

        const radius = ROCK_MIN_RADIUS
          + pseudoRandom2D(worldX, worldZ, 22.7) * (ROCK_MAX_RADIUS - ROCK_MIN_RADIUS);
        tempPosition.set(worldX, 0, worldZ);
        const rockBlockerProbe = {
          position: tempPosition,
          userData: { boundsRadius: radius * 1.05 }
        };
        if (tileBlockers && isTreeBlocked(rockBlockerProbe, tileBlockers)) {
          continue;
        }

        const geometryIndex = Math.floor(pseudoRandom2D(worldX, worldZ, 23.5) * rockGeometries.length)
          % rockGeometries.length;
        const rock = new THREE.Mesh(rockGeometries[geometryIndex], rockMaterial);
        rock.castShadow = true;
        rock.receiveShadow = true;
        const terrainY = getTerrainHeight?.(worldX, worldZ) ?? 0;
        rock.position.set(worldX, terrainY + radius * 0.36, worldZ);
        const uniformScale = radius * (1.5 + pseudoRandom2D(worldX, worldZ, 26.1) * 0.5);
        rock.scale.set(
          uniformScale,
          uniformScale * (0.7 + pseudoRandom2D(worldX, worldZ, 25.4) * 0.6),
          uniformScale * (0.8 + pseudoRandom2D(worldX, worldZ, 24.8) * 0.5)
        );
        rock.rotation.set(
          pseudoRandom2D(worldX, worldZ, 31.1) * Math.PI,
          pseudoRandom2D(worldX, worldZ, 31.7) * Math.PI * 2,
          pseudoRandom2D(worldX, worldZ, 32.3) * Math.PI
        );
        rock.userData.tileKey = tileKey;
        rock.userData.rockRadius = radius;
        tileGroup.add(rock);
        rocks.push(rock);

        const physics = createRockCollider(rock, radius);
        if (physics) {
          rockPhysics.push(physics);
          rock.userData.physics = physics;
        }
      }
    }

    const entry = { tile, tileKey, detailLevel, group: tileGroup, trees, rocks, rockPhysics };
    treeTiles.set(tileKey, entry);
    climbableAreasByTile.set(tileKey, tileClimbAreas);
    applePickupsByTile.set(tileKey, tileApplePickups);
    refreshClimbableAreas();
    return entry;
  };

  let lastPlayerTileKey = null;

  const removeTileEntry = (tileKey) => {
    const entry = treeTiles.get(tileKey);
    if (!entry) return;
    group.remove(entry.group);
    entry.group.clear();
    for (const physics of entry.rockPhysics ?? []) {
      if (physics?.collider) rapierWorld?.removeCollider(physics.collider, true);
      if (physics?.rb) rapierWorld?.removeRigidBody(physics.rb);
    }
    treeTiles.delete(tileKey);
    climbableAreasByTile.delete(tileKey);
    const tilePickups = applePickupsByTile.get(tileKey) ?? [];
    if (typeof removeApplePickup === 'function') {
      tilePickups.forEach((pickup) => removeApplePickup(pickup));
    }
    applePickupsByTile.delete(tileKey);
  };

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
        const detailLevel = getTileDetailLevel(nextTile, tile);
        const existingEntry = treeTiles.get(nextKey);
        if (existingEntry) {
          if (existingEntry.detailLevel === 'far' && detailLevel === 'near') {
            refreshTile(nextKey, tile);
            continue;
          }
          existingEntry.detailLevel = detailLevel;
          continue;
        }
        createTileTrees(nextTile, tile);
      }
    }

    for (const [key, entry] of treeTiles.entries()) {
      if (neededKeys.has(key)) continue;
      removeTileEntry(key);
    }
    refreshClimbableAreas();
  };

  const refreshTile = (tileKey, centerTileOverride = null) => {
    if (!tileKey) return;
    const entry = treeTiles.get(tileKey);
    const tile = entry?.tile ?? null;
    if (entry) {
      removeTileEntry(tileKey);
    }
    if (tile) {
      const centerTile = centerTileOverride ?? getTileFromKey(lastPlayerTileKey) ?? tile;
      createTileTrees(tile, centerTile);
      refreshClimbableAreas();
      return;
    }
    const parsedTile = getTileFromKey(tileKey);
    if (!parsedTile) return;
    const centerTile = centerTileOverride ?? getTileFromKey(lastPlayerTileKey) ?? parsedTile;
    createTileTrees(parsedTile, centerTile);
    refreshClimbableAreas();
  };

  const refreshAll = () => {
    const tiles = Array.from(treeTiles.values()).map((entry) => entry.tile);
    for (const entry of Array.from(treeTiles.keys())) {
      removeTileEntry(entry);
    }
    for (const tile of tiles) {
      if (!tile) continue;
      const centerTile = getTileFromKey(lastPlayerTileKey) ?? tile;
      createTileTrees(tile, centerTile);
    }
    refreshClimbableAreas();
  };

  const getClosestTree = (position, range) => {
    if (!position || !Number.isFinite(range)) return null;
    const maxDistance = Math.max(0, range);
    let closest = null;
    let closestDistance = Infinity;
    const searchBox = new THREE.Box3();
    const searchCenter = new THREE.Vector3();
    const worldCenter = new THREE.Vector3();
    for (const entry of treeTiles.values()) {
      for (const tree of entry.trees) {
        if (!tree?.position) continue;
        if (!tree.userData?.interactable) continue;
        tree.updateWorldMatrix(true, true);
        if (tree.userData?.boundsCenterLocal) {
          worldCenter.copy(tree.userData.boundsCenterLocal).applyMatrix4(tree.matrixWorld);
        } else {
          searchBox.setFromObject(tree);
          if (!Number.isFinite(searchBox.min.x)) continue;
          searchBox.getCenter(searchCenter);
          worldCenter.copy(searchCenter);
        }
        const dx = position.x - worldCenter.x;
        const dz = position.z - worldCenter.z;
        const distance = Math.hypot(dx, dz);
        if (distance <= maxDistance && distance < closestDistance) {
          closestDistance = distance;
          closest = tree;
        }
      }
    }
    return closest;
  };

  const removeTree = (tree) => {
    if (!tree) return false;
    const tileKey = tree.userData?.tileKey;
    const entry = tileKey ? treeTiles.get(tileKey) : null;
    if (!entry) return false;
    const index = entry.trees.indexOf(tree);
    if (index === -1) return false;
    entry.trees.splice(index, 1);
    entry.group.remove(tree);
    const tileClimbAreas = climbableAreasByTile.get(tileKey);
    const treeAreas = tree.userData?.climbAreas ?? [];
    if (Array.isArray(tileClimbAreas) && treeAreas.length > 0) {
      const remainingAreas = tileClimbAreas.filter((area) => !treeAreas.includes(area));
      climbableAreasByTile.set(tileKey, remainingAreas);
    }
    refreshClimbableAreas();
    return true;
  };

  const setTileCache = (nextCache) => {
    activeTileCache = nextCache ?? null;
    tileSizeMeters = TREE_TILE_SIZE_METERS;
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
    rockGeometries.forEach((geometry) => geometry.dispose());
    rockMaterial.dispose();
    treeImpostorTrunkGeometry.dispose();
    treeImpostorLeafGeometry.dispose();
    treeImpostorTrunkMaterial.dispose();
    treeImpostorLeafMaterials.forEach((material) => material.dispose());
    group.clear();
    scene?.remove(group);
  };

  return {
    group,
    update,
    refreshTile,
    refreshAll,
    setTileCache,
    getClosestTree,
    removeTree,
    dispose
  };
}

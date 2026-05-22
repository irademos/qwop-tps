import * as THREE from 'three';
import { setClimbableAreas } from '../controls/climb.js';
import { removeRigidBodySafely } from '../physics/rapierSafety.js';
import * as BufferGeometryUtils from
  'three/examples/jsm/utils/BufferGeometryUtils.js';

const TREE_SCALE_REFERENCE = 0.016;
const TREE_SCALE_MIN = 0.012;
const TREE_SCALE_MAX = 0.02;
const TREE_TYPE_COUNT = 7;
const TREE_IMPOSTOR_TRUNK_COLOR = 0x6f4e37;
const TREE_IMPOSTOR_LEAF_PALETTE = [0x3f8f3f, 0x4fa14f, 0x5a9f42, 0x6cae52, 0x4b8c3f, 0x739f55];
const TREE_COLLIDER_SCALE_BY_TYPE = {
  0: { radius: 0.7, height: 0.95 }, // eucalyptus
  1: { radius: 0.85, height: 0.95 }, // pine
  3: { radius: 0.8, height: 0.9 }, // cypress/fir
  4: { radius: 1.1, height: 1.0 }, // oak
  5: { radius: 0.75, height: 1.15 }, // scary/dead
  6: { radius: 0.95, height: 1.0 } // larch/beech
};

const TREE_CLIMB_OVERRIDES = {
  0: { halfWidth: 0.4, halfDepth: 0.75, entryHeight: 0.0, maxYPad: 3.0 }, // eucalyptus
  5: { halfWidth: 0.75, halfDepth: 0.75, entryHeight: 0.0, minYPad: 0.0, maxYPad: 6.4 }  // dead/scary
  // others default
};

const TREE_ZONE_DEGREES = 0.0009;
const TREE_ZONE_METERS = 100;
const TREE_GRID_SPACING = 20;
const TREE_SPAWN_CHANCE_NEAR = 0.6;
const TREE_SPAWN_CHANCE_MID = 0.35;
const TREE_SPAWN_CHANCE_FAR = 0.15;
const TREE_TILE_SIZE_METERS = 150;
const TREE_TILE_BUFFER = 5;
const NEAR_TILE_DISTANCE = 1;
const ROCK_GRID_SPACING = 24;
const ROCK_SPAWN_CHANCE = 0.28;
const BUSH_GRID_SPACING = 18;
const BUSH_SPAWN_CHANCE = 0.22;
const BUSH_MIN_RADIUS = 0.55;
const BUSH_MAX_RADIUS = 1.25;
const ROCK_MIN_RADIUS = 0.45;
const ROCK_MAX_RADIUS = 1.4;
const ROCK_COLLIDER_HEIGHT_RATIO = 0.7;
const TREE_CLIMB_HALF_WIDTH = 0.6;
const TREE_CLIMB_HALF_DEPTH = 0.6;
const TREE_CLIMB_ENTRY_RADIUS = 1.0;
const TREE_CLIMB_ENTRY_HEIGHT = 1.4;
const TREE_BASE_COLLIDER_RADIUS_MIN = 0.18;
const TREE_BASE_COLLIDER_RADIUS_MAX = 0.8;
const TREE_BASE_COLLIDER_RADIUS_FACTOR = 0.24;
const TREE_BASE_COLLIDER_HALF_HEIGHT = 1.5;
const MOUNTAIN_GRID_SPACING = 24;
const MOUNTAIN_SPAWN_CHANCE_RATIO = 0.25;
const MOUNTAIN_MIN_FOOTPRINT_METERS = 21.0;
const MOUNTAIN_MAX_FOOTPRINT_METERS = 30.0;
const MOUNTAIN_MIN_HEIGHT = 5.0;
const MOUNTAIN_MAX_HEIGHT = 35;
const MOUNTAIN_SIDE_SEGMENTS = 12;
const MOUNTAIN_HEIGHT_SEGMENTS = 4;
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

  const treeTypeIndices = Array.from({ length: TREE_TYPE_COUNT }, (_, index) => index);

  const group = new THREE.Group();
  group.name = 'nature-group';
  scene.add(group);

  const treeTiles = new Map();
  const climbableAreasByTile = new Map();
  const applePickupsByTile = new Map();
  let treeCollidersEnabled = true;
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
  const bushCoreGeometry = new THREE.DodecahedronGeometry(1, 0);
  const bushLobeGeometry = new THREE.IcosahedronGeometry(1, 0);
  const bushMaterials = [
    new THREE.MeshStandardMaterial({ color: 0x2f7d32, roughness: 0.92, metalness: 0.01, flatShading: true }),
    new THREE.MeshStandardMaterial({ color: 0x3f9a3e, roughness: 0.9, metalness: 0.01, flatShading: true }),
    new THREE.MeshStandardMaterial({ color: 0x5da23b, roughness: 0.88, metalness: 0.01, flatShading: true })
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
  const mountainMaterials = [
    new THREE.MeshStandardMaterial({ color: 0x7b5a3a, roughness: 0.97, metalness: 0.02, flatShading: true }),
    new THREE.MeshStandardMaterial({ color: 0x8b6745, roughness: 0.97, metalness: 0.02, flatShading: true }),
    new THREE.MeshStandardMaterial({ color: 0x6a4d33, roughness: 0.97, metalness: 0.02, flatShading: true }),
    new THREE.MeshStandardMaterial({ color: 0x9a744f, roughness: 0.97, metalness: 0.02, flatShading: true })
  ];
  const tempPosition = new THREE.Vector3();
  const tempBox = new THREE.Box3();
  const tempCenter = new THREE.Vector3();
  const tempSize = new THREE.Vector3();
  const tempWorldPos = new THREE.Vector3();
  const tempTreeCenter = new THREE.Vector3();
  const tempEntryCenter = new THREE.Vector3();
  const tempAreaCenter = new THREE.Vector3();
  const tempWorldToLocal = new THREE.Vector3();
  const tempApplePosition = new THREE.Vector3();
  const tempTreeWorldScale = new THREE.Vector3();
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
    const scaleFactor = tree.userData?.gameplayScaleFactor ?? (tree.scale.x / TREE_SCALE_REFERENCE);
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

    const shiftedCenterX = centerX;
    const shiftedCenterZ = centerZ;

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

  const createTreeBaseCollider = (tree) => {
    if (!tree || !rapier || !rapierWorld) return null;
    tree.updateWorldMatrix(true, true);
    tempBox.setFromObject(tree);
    if (!Number.isFinite(tempBox.min.x)) return null;
    tempBox.getCenter(tempCenter);
    tempBox.getSize(tempSize);

    const trunkWidthEstimate = Math.min(tempSize.x, tempSize.z);
    const radiusFromBounds = trunkWidthEstimate * TREE_BASE_COLLIDER_RADIUS_FACTOR;
    const typeIndex = tree.userData?.treeTypeIndex;
    const colliderScale = TREE_COLLIDER_SCALE_BY_TYPE[typeIndex] ?? { radius: 1, height: 1 };
    const colliderRadius = THREE.MathUtils.clamp(
      radiusFromBounds * colliderScale.radius,
      TREE_BASE_COLLIDER_RADIUS_MIN,
      TREE_BASE_COLLIDER_RADIUS_MAX
    );

    const scaleFactor = tree.userData?.gameplayScaleFactor ?? (tree.scale.x / TREE_SCALE_REFERENCE);

    // Keep collider short so it only blocks near the base/trunk.
    const centerX = tempCenter.x;
    const centerZ = tempCenter.z;
    const halfHeight = THREE.MathUtils.clamp(
      TREE_BASE_COLLIDER_HALF_HEIGHT * scaleFactor * colliderScale.height,
      0.3,
      0.75
    );
    const terrainY = getTerrainHeight?.(centerX, centerZ) ?? tree.position.y;
    const rbDesc = rapier.RigidBodyDesc.fixed().setTranslation(centerX, terrainY + halfHeight, centerZ);
    const rb = rapierWorld.createRigidBody(rbDesc);
    const colliderDesc = rapier.ColliderDesc.cylinder(halfHeight, colliderRadius)
      .setFriction(0.9)
      .setRestitution(0.05);
    const collider = rapierWorld.createCollider(colliderDesc, rb);
    collider.setSensor(!treeCollidersEnabled);
    return { rb, collider };
  };

  const createMountainCollider = (mountain) => {
    if (!mountain || !rapier || !rapierWorld) return null;

    let sourceMesh = null;

    mountain.traverse((child) => {
      if (child.isMesh && !sourceMesh) {
        sourceMesh = child;
      }
    });

    if (!sourceMesh?.geometry) return null;

    // Clone so we don't mutate render geometry
    let geometry = sourceMesh.geometry.clone();

    // Ensure indexed geometry for Rapier trimesh
    if (!geometry.index) {
      geometry = BufferGeometryUtils.mergeVertices(geometry);
    }

    // Bake mesh transform into geometry
    geometry.applyMatrix4(sourceMesh.matrixWorld);

    const vertices = geometry.attributes.position.array;
    const indices = geometry.index.array;

    const rbDesc = rapier.RigidBodyDesc.fixed();

    const rb = rapierWorld.createRigidBody(rbDesc);

    const colliderDesc = rapier.ColliderDesc.trimesh(
      vertices,
      indices
    )
      .setFriction(1.0)
      .setRestitution(0.0);

    const collider = rapierWorld.createCollider(
      colliderDesc,
      rb
    );

    collider.setSensor(!treeCollidersEnabled);

    geometry.dispose();

    return { rb, collider };
  };

  const createMountainImpostor = ({ worldX, worldZ, tileKey, terrainY, footprint, height, rotation }) => {
    const groupMesh = new THREE.Group();
    groupMesh.name = 'mountain-impostor';
    const halfFootprint = footprint * 0.5;
    const material = mountainMaterials[Math.floor(pseudoRandom2D(worldX, worldZ, 65.3) * mountainMaterials.length) % mountainMaterials.length];

    const baseGeometry = new THREE.ConeGeometry(
      halfFootprint,
      height,
      MOUNTAIN_SIDE_SEGMENTS,
      MOUNTAIN_HEIGHT_SEGMENTS
    );

    baseGeometry.translate(0, height * 0.5, 0);

    const pos = baseGeometry.attributes.position;
    const vertex = new THREE.Vector3();

    for (let i = 0; i < pos.count; i += 1) {
      vertex.fromBufferAttribute(pos, i);

      const normalizedHeight = THREE.MathUtils.clamp(vertex.y / height, 0, 1);

      // Stronger deformation near base
      const radialStrength =
        (1 - normalizedHeight) * footprint * 0.24;

      // Slight vertical breakup
      const verticalStrength =
        height * 0.025 * (1 - normalizedHeight * 0.7);

      // Direction away from center
      const angle = Math.atan2(vertex.z, vertex.x);

      // Layered noise
      const noiseA =
        pseudoRandom2D(
          Math.cos(angle) * 10 + normalizedHeight * 5,
          Math.sin(angle) * 10 + normalizedHeight * 5,
          70.1
        ) - 0.5;

      const noiseB =
        pseudoRandom2D(
          vertex.x * 0.2,
          vertex.z * 0.2,
          71.7
        ) - 0.5;

      const combinedNoise = noiseA * 0.7 + noiseB * 0.3;

      // Push outward/inward radially
      const currentRadius = Math.sqrt(
        vertex.x * vertex.x +
        vertex.z * vertex.z
      );

      if (currentRadius > 0.001) {
        const scale =
          1 + (combinedNoise * radialStrength) / currentRadius;

        vertex.x *= scale;
        vertex.z *= scale;
      }

      // Height breakup
      vertex.y += combinedNoise * verticalStrength;

      // Make top narrower
      const taper = 1 - normalizedHeight * 0.04;
      vertex.x *= taper;
      vertex.z *= taper;

      pos.setXYZ(i, vertex.x, vertex.y, vertex.z);
    }

    // IMPORTANT
    baseGeometry.computeVertexNormals();

    const core = new THREE.Mesh(baseGeometry, material);

    core.material.flatShading = true;
    core.material.needsUpdate = true;

    core.castShadow = true;
    core.receiveShadow = true;

    groupMesh.add(core);
    groupMesh.position.set(worldX, terrainY, worldZ);
    groupMesh.rotation.y = rotation;
    groupMesh.userData = {
      tileKey,
      isMountain: true,
      interactable: true,
      footprintMeters: footprint,
      mountainHeight: height,
      boundsRadius: halfFootprint * 0.95,
      gameplayScaleFactor: 1
    };
    return groupMesh;
  };

  const disposeMountains = (mountains = []) => {
    for (const mountain of mountains) {
      mountain?.traverse?.((node) => {
        if (node?.isMesh && node.geometry) node.geometry.dispose();
      });
    }
  };

  const createBushImpostor = ({ worldX, worldZ, tileKey, radius, rotation, terrainY, variant }) => {
    const bush = new THREE.Group();
    bush.name = 'bush-impostor';
    const material = bushMaterials[variant % bushMaterials.length];
    const core = new THREE.Mesh(bushCoreGeometry, material);
    core.castShadow = true;
    core.receiveShadow = true;
    core.position.y = radius * 0.42;
    core.scale.set(radius * 0.95, radius * 0.58, radius * 0.85);
    bush.add(core);

    const lobeCount = 4 + (variant % 3);
    for (let i = 0; i < lobeCount; i += 1) {
      const lobeMaterial = bushMaterials[(variant + i + 1) % bushMaterials.length];
      const lobe = new THREE.Mesh(bushLobeGeometry, lobeMaterial);
      const angle = (Math.PI * 2 * i) / lobeCount;
      const lobeRadius = radius * (0.46 + pseudoRandom2D(worldX + i, worldZ - i, 48.2) * 0.18);
      lobe.castShadow = true;
      lobe.receiveShadow = true;
      lobe.position.set(Math.cos(angle) * radius * 0.44, radius * 0.36, Math.sin(angle) * radius * 0.44);
      lobe.scale.set(lobeRadius, lobeRadius * 0.58, lobeRadius * 0.82);
      lobe.rotation.set(
        pseudoRandom2D(worldX, worldZ, 50 + i) * Math.PI,
        angle + pseudoRandom2D(worldX, worldZ, 51 + i) * 0.8,
        pseudoRandom2D(worldX, worldZ, 52 + i) * Math.PI
      );
      bush.add(lobe);
    }

    bush.position.set(worldX, terrainY, worldZ);
    bush.rotation.y = rotation;
    bush.userData = {
      tileKey,
      isBush: true,
      interactable: true,
      boundsRadius: radius * 1.35
    };
    return bush;
  };

  const createTreeImpostor = ({
    worldX,
    worldZ,
    tileKey,
    scale,
    rotation,
    terrainY,
    treeTypeIndex,
    groundAnchorOffset
  }) => {
    const impostor = new THREE.Group();
    impostor.name = 'tree-impostor';

    const trunk = new THREE.Mesh(treeImpostorTrunkGeometry, treeImpostorTrunkMaterial);
    trunk.castShadow = false;
    trunk.receiveShadow = true;
    trunk.position.y = 0.175;
    impostor.add(trunk);

    const leafMaterial = treeImpostorLeafMaterials[treeTypeIndex % treeImpostorLeafMaterials.length];
    const leaves = new THREE.Mesh(treeImpostorLeafGeometry, leafMaterial);
    leaves.castShadow = false;
    leaves.receiveShadow = true;
    leaves.position.y = 0.8;
    impostor.add(leaves);

    impostor.position.set(worldX, terrainY - groundAnchorOffset, worldZ);
    impostor.rotation.y = rotation;
    impostor.scale.setScalar(Math.max(0.25, scale * 20.0 / TREE_SCALE_REFERENCE));
    impostor.userData = {
      tileKey,
      applePickups: [],
      isFlammable: true,
      treeTypeIndex,
      gameplayScaleFactor: scale / TREE_SCALE_REFERENCE,
      interactable: true,
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
    const mountains = [];
    const bushes = [];
    const rockPhysics = [];
    const treePhysics = [];
    const mountainPhysics = [];
    const tileClimbAreas = [];
    const tileApplePickups = [];
    const tileBlockers = buildTileBlockers(tile, tileKey);
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

        const rotation = pseudoRandom2D(worldX, worldZ, 3.4) * Math.PI * 2;
        const scale =
          TREE_SCALE_MIN +
          pseudoRandom2D(worldX, worldZ, 7.7) * (TREE_SCALE_MAX - TREE_SCALE_MIN);
        const terrainY = getTerrainHeight?.(worldX, worldZ) ?? 0;
        const tree = createTreeImpostor({
          worldX,
          worldZ,
          tileKey,
          scale,
          rotation,
          terrainY,
          treeTypeIndex,
          groundAnchorOffset: 0
        });

        tree.updateWorldMatrix(true, true);
        tempBox.setFromObject(tree);
        if (Number.isFinite(tempBox.min.x)) {
          tempBox.getCenter(tempCenter);
          tempWorldToLocal.copy(tempCenter);
          tree.userData.boundsCenterLocal = tree.worldToLocal(tempWorldToLocal);
          tempBox.getSize(tempSize);
          tree.userData.boundsRadius = Math.max(tempSize.x, tempSize.z) * 0.5;
        }
        if (tileBlockers && isTreeBlocked(tree, tileBlockers)) {
          continue;
        }
        tileGroup.add(tree);
        trees.push(tree);

        const areas = buildTreeClimbAreas(tree);
        tree.userData.climbAreas = areas;
        tileClimbAreas.push(...areas);
        if (typeof spawnApplePickup === 'function') {
          if (Number.isFinite(tempBox.min.y)) {
            tempBox.getSize(tempSize);
            tempBox.getCenter(tempCenter);
            const height = tempSize.y;
            if (height > 0) {
              const radius = Math.max(0.8, Math.max(tempSize.x, tempSize.z) * 0.18);
              for (let i = 0; i < 2; i += 1) {
                const angle = pseudoRandom2D(worldX + i * 13.7, worldZ + i * 9.3, 12.4) * Math.PI * 2;
                const distance = radius * (0.55 + pseudoRandom2D(worldX, worldZ, 7.1 + i) * 0.35);
                const heightFactor = 0.4 + pseudoRandom2D(worldX, worldZ, 4.9 + i) * 0.3;
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
                  tree.getWorldScale(tempTreeWorldScale);
                  const worldScaleX = Math.abs(tempTreeWorldScale.x);
                  if (worldScaleX > Number.EPSILON) {
                    pickup.mesh.scale.multiplyScalar(1 / worldScaleX);
                  }
                  tileApplePickups.push(pickup);
                  tree.userData.applePickups.push(pickup);
                }
              }
            }
          }
        }
        const physics = createTreeBaseCollider(tree);
        if (physics) {
          treePhysics.push(physics);
          tree.userData.physics = physics;
        }
      }
    }

    for (let ix = 0; ix <= tileSizeMeters; ix += BUSH_GRID_SPACING) {
      for (let iz = 0; iz <= tileSizeMeters; iz += BUSH_GRID_SPACING) {
        const worldX = baseX + ix + (pseudoRandom2D(baseX + ix, baseZ + iz, 41.1) - 0.5) * BUSH_GRID_SPACING * 0.45;
        const worldZ = baseZ + iz + (pseudoRandom2D(baseX + ix, baseZ + iz, 41.7) - 0.5) * BUSH_GRID_SPACING * 0.45;
        if (pseudoRandom2D(worldX, worldZ, 42.3) > BUSH_SPAWN_CHANCE) continue;

        const radius = BUSH_MIN_RADIUS
          + pseudoRandom2D(worldX, worldZ, 43.9) * (BUSH_MAX_RADIUS - BUSH_MIN_RADIUS);
        tempPosition.set(worldX, 0, worldZ);
        const bushBlockerProbe = {
          position: tempPosition,
          userData: { boundsRadius: radius * 1.45 }
        };
        if (tileBlockers && isTreeBlocked(bushBlockerProbe, tileBlockers)) {
          continue;
        }

        const terrainY = getTerrainHeight?.(worldX, worldZ) ?? 0;
        const bush = createBushImpostor({
          worldX,
          worldZ,
          tileKey,
          radius,
          rotation: pseudoRandom2D(worldX, worldZ, 45.1) * Math.PI * 2,
          terrainY,
          variant: Math.floor(pseudoRandom2D(worldX, worldZ, 46.8) * 1000)
        });
        tileGroup.add(bush);
        bushes.push(bush);
      }
    }

    for (let ix = 0; ix <= tileSizeMeters; ix += MOUNTAIN_GRID_SPACING) {
      for (let iz = 0; iz <= tileSizeMeters; iz += MOUNTAIN_GRID_SPACING) {
        const worldX = baseX + ix + (pseudoRandom2D(baseX + ix, baseZ + iz, 61.1) - 0.5) * MOUNTAIN_GRID_SPACING * 0.5;
        const worldZ = baseZ + iz + (pseudoRandom2D(baseX + ix, baseZ + iz, 61.7) - 0.5) * MOUNTAIN_GRID_SPACING * 0.5;
        if (pseudoRandom2D(worldX, worldZ, 62.3) > treeSpawnChance * MOUNTAIN_SPAWN_CHANCE_RATIO) continue;
        const footprint = MOUNTAIN_MIN_FOOTPRINT_METERS
          + pseudoRandom2D(worldX, worldZ, 62.9) * (MOUNTAIN_MAX_FOOTPRINT_METERS - MOUNTAIN_MIN_FOOTPRINT_METERS);
        tempPosition.set(worldX, 0, worldZ);
        const mountainProbe = {
          position: tempPosition,
          userData: { boundsRadius: footprint * 0.6 }
        };
        if (tileBlockers && isTreeBlocked(mountainProbe, tileBlockers)) continue;
        const terrainY = getTerrainHeight?.(worldX, worldZ) ?? 0;
        const mountainHeight = MOUNTAIN_MIN_HEIGHT
          + pseudoRandom2D(worldX, worldZ, 63.5) * (MOUNTAIN_MAX_HEIGHT - MOUNTAIN_MIN_HEIGHT);
        const mountain = createMountainImpostor({
          worldX,
          worldZ,
          tileKey,
          terrainY,
          footprint,
          height: mountainHeight,
          rotation: pseudoRandom2D(worldX, worldZ, 64.1) * Math.PI * 2
        });
        tileGroup.add(mountain);
        mountains.push(mountain);

        const mountainAreas = buildTreeClimbAreas(mountain);
        mountain.userData.climbAreas = mountainAreas;
        tileClimbAreas.push(...mountainAreas);

        const physics = createMountainCollider(mountain);
        if (physics) {
          mountainPhysics.push(physics);
          mountain.userData.physics = physics;
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

    const entry = {
      tile,
      tileKey,
      detailLevel,
      group: tileGroup,
      trees,
      rocks,
      bushes,
      mountains,
      rockPhysics,
      treePhysics,
      mountainPhysics
    };
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
      if (physics?.rb) removeRigidBodySafely(rapierWorld, physics.rb);
    }
    for (const physics of entry.treePhysics ?? []) {
      if (physics?.collider) rapierWorld?.removeCollider(physics.collider, true);
      if (physics?.rb) removeRigidBodySafely(rapierWorld, physics.rb);
    }
    for (const physics of entry.mountainPhysics ?? []) {
      if (physics?.collider) rapierWorld?.removeCollider(physics.collider, true);
      if (physics?.rb) removeRigidBodySafely(rapierWorld, physics.rb);
    }
    disposeMountains(entry.mountains);
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

  const refreshTilesForCacheTile = (cacheTileKey, centerTileOverride = null) => {
    if (!cacheTileKey) return;
    const cacheTile = getTileFromKey(cacheTileKey);
    if (!cacheTile) return;

    const cacheTileSize = activeTileCache?.tileSizeMeters;
    if (!Number.isFinite(cacheTileSize) || cacheTileSize <= 0) {
      refreshTile(cacheTileKey, centerTileOverride);
      return;
    }

    const minX = cacheTile.x * cacheTileSize;
    const maxX = minX + cacheTileSize;
    // Cache tiles and nature tiles both index +Y in +worldZ; keep this conversion aligned.
    const minZ = cacheTile.y * cacheTileSize;
    const maxZ = minZ + cacheTileSize;

    const treeTileMinX = Math.floor(minX / tileSizeMeters);
    const treeTileMaxX = Math.floor((maxX - Number.EPSILON) / tileSizeMeters);
    const treeTileMinY = Math.floor(minZ / tileSizeMeters);
    const treeTileMaxY = Math.floor((maxZ - Number.EPSILON) / tileSizeMeters);

    for (let tx = treeTileMinX; tx <= treeTileMaxX; tx += 1) {
      for (let ty = treeTileMinY; ty <= treeTileMaxY; ty += 1) {
        const key = getTileKey({ x: tx, y: ty });
        if (!treeTiles.has(key)) continue;
        refreshTile(key, centerTileOverride);
      }
    }
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
    const treePhysics = tree.userData?.physics;
    if (treePhysics?.collider) rapierWorld?.removeCollider(treePhysics.collider, true);
    if (treePhysics?.rb) removeRigidBodySafely(rapierWorld, treePhysics.rb);
    entry.treePhysics = (entry.treePhysics ?? []).filter((physics) => physics !== treePhysics);
    const tileClimbAreas = climbableAreasByTile.get(tileKey);
    const treeAreas = tree.userData?.climbAreas ?? [];
    if (Array.isArray(tileClimbAreas) && treeAreas.length > 0) {
      const remainingAreas = tileClimbAreas.filter((area) => !treeAreas.includes(area));
      climbableAreasByTile.set(tileKey, remainingAreas);
    }
    refreshClimbableAreas();
    return true;
  };

  const getClosestBush = (position, range, { attackerModel, region = 'around' } = {}) => {
    if (!position || !Number.isFinite(range)) return null;
    const maxDistance = Math.max(0, range);
    let closest = null;
    let closestDistance = Infinity;
    const forward = new THREE.Vector3();
    const toBush = new THREE.Vector3();
    const right = new THREE.Vector3();
    if (region === 'forward' && attackerModel?.getWorldDirection) {
      attackerModel.getWorldDirection(forward);
      forward.y = 0;
      if (forward.lengthSq() < 0.0001) forward.set(0, 0, 1);
      else forward.normalize();
      right.set(forward.z, 0, -forward.x);
    }
    for (const entry of treeTiles.values()) {
      for (const bush of entry.bushes ?? []) {
        if (!bush?.position || bush.userData?.isRemoved) continue;
        toBush.subVectors(bush.position, position);
        toBush.y = 0;
        const distance = toBush.length();
        const paddedRange = maxDistance + (bush.userData?.boundsRadius ?? 0.6);
        if (distance > paddedRange) continue;
        if (region === 'forward' && forward.lengthSq() > 0) {
          const forwardDistance = toBush.dot(forward);
          const lateralDistance = Math.abs(toBush.dot(right));
          if (forwardDistance < -0.2 || forwardDistance > paddedRange || lateralDistance > paddedRange) continue;
        }
        if (distance < closestDistance) {
          closestDistance = distance;
          closest = bush;
        }
      }
    }
    return closest;
  };

  const removeBush = (bush) => {
    if (!bush) return null;
    const tileKey = bush.userData?.tileKey;
    const entry = tileKey ? treeTiles.get(tileKey) : null;
    if (!entry) return null;
    const index = (entry.bushes ?? []).indexOf(bush);
    if (index === -1) return null;
    entry.bushes.splice(index, 1);
    bush.userData.isRemoved = true;
    const position = bush.position?.clone?.() ?? null;
    entry.group.remove(bush);
    return position;
  };

  const removeBushesInRadius = (position, radius = 0) => {
    if (!position || !Number.isFinite(radius) || radius <= 0) return [];
    const removed = [];
    const radiusSq = radius * radius;
    for (const entry of treeTiles.values()) {
      if (!Array.isArray(entry?.bushes) || !entry.bushes.length) continue;
      for (let i = entry.bushes.length - 1; i >= 0; i -= 1) {
        const bush = entry.bushes[i];
        if (!bush?.position) continue;
        const dx = bush.position.x - position.x;
        const dz = bush.position.z - position.z;
        const paddedRadius = radius + (bush.userData?.boundsRadius ?? 0.6);
        if ((dx * dx) + (dz * dz) > Math.max(radiusSq, paddedRadius * paddedRadius)) continue;
        removed.push(bush.position.clone());
        bush.userData.isRemoved = true;
        entry.bushes.splice(i, 1);
        entry.group.remove(bush);
      }
    }
    return removed;
  };

  const removeBushesIntersectingBox = (box) => {
    if (!box) return [];
    const removed = [];
    const bushBox = new THREE.Box3();
    for (const entry of treeTiles.values()) {
      if (!Array.isArray(entry?.bushes) || !entry.bushes.length) continue;
      for (let i = entry.bushes.length - 1; i >= 0; i -= 1) {
        const bush = entry.bushes[i];
        if (!bush) continue;
        bushBox.setFromObject(bush);
        if (!box.intersectsBox(bushBox)) continue;
        removed.push(bush.position.clone());
        bush.userData.isRemoved = true;
        entry.bushes.splice(i, 1);
        entry.group.remove(bush);
      }
    }
    return removed;
  };

  const removeRocksInRadius = (position, radius = 0) => {
    if (!position || !Number.isFinite(radius) || radius <= 0) return [];
    const removed = [];
    const radiusSq = radius * radius;
    for (const entry of treeTiles.values()) {
      if (!Array.isArray(entry?.rocks) || !entry.rocks.length) continue;
      for (let i = entry.rocks.length - 1; i >= 0; i -= 1) {
        const rock = entry.rocks[i];
        if (!rock?.position) continue;
        const dx = rock.position.x - position.x;
        const dz = rock.position.z - position.z;
        if ((dx * dx) + (dz * dz) > radiusSq) continue;
        removed.push(rock.position.clone());
        entry.rocks.splice(i, 1);
        entry.group.remove(rock);
        const rockPhysics = rock.userData?.physics;
        if (rockPhysics?.collider) rapierWorld?.removeCollider(rockPhysics.collider, true);
        if (rockPhysics?.rb) removeRigidBodySafely(rapierWorld, rockPhysics.rb);
        entry.rockPhysics = (entry.rockPhysics ?? []).filter((physics) => physics !== rockPhysics);
      }
    }
    return removed;
  };


  const spawnQuestRock = (position) => {
    if (!position) return null;
    const tile = {
      x: Math.floor(position.x / tileSizeMeters),
      y: Math.floor(position.z / tileSizeMeters)
    };
    const tileKey = getTileKey(tile);
    let entry = treeTiles.get(tileKey);
    if (!entry) {
      const centerTile = getTileFromKey(lastPlayerTileKey) ?? tile;
      entry = createTileTrees(tile, centerTile);
    }
    if (!entry?.group) return null;

    const radius = (ROCK_MIN_RADIUS + ROCK_MAX_RADIUS) * 0.5;
    const geometryIndex = Math.floor(Math.random() * rockGeometries.length) % rockGeometries.length;
    const rock = new THREE.Mesh(rockGeometries[geometryIndex], rockMaterial);
    rock.castShadow = true;
    rock.receiveShadow = true;
    const terrainY = getTerrainHeight?.(position.x, position.z) ?? position.y ?? 0;
    rock.position.set(position.x, terrainY + radius * 0.36, position.z);
    const uniformScale = radius * 1.8;
    rock.scale.set(uniformScale, uniformScale * 0.85, uniformScale * 0.95);
    rock.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI * 2, Math.random() * Math.PI);
    rock.userData.tileKey = tileKey;
    rock.userData.rockRadius = radius;

    entry.group.add(rock);
    entry.rocks.push(rock);
    const physics = createRockCollider(rock, radius);
    if (physics) {
      entry.rockPhysics.push(physics);
      rock.userData.physics = physics;
    }
    return rock;
  };

  const setTileCache = (nextCache) => {
    activeTileCache = nextCache ?? null;
    tileSizeMeters = TREE_TILE_SIZE_METERS;
    tileBuffer = getTreeTileBuffer(activeTileCache);
    lastPlayerTileKey = null;
    for (const entry of treeTiles.values()) {
      entry.group.clear();
      group.remove(entry.group);
      for (const physics of entry.rockPhysics ?? []) {
        if (physics?.collider) rapierWorld?.removeCollider(physics.collider, true);
        if (physics?.rb) removeRigidBodySafely(rapierWorld, physics.rb);
      }
      for (const physics of entry.treePhysics ?? []) {
        if (physics?.collider) rapierWorld?.removeCollider(physics.collider, true);
        if (physics?.rb) removeRigidBodySafely(rapierWorld, physics.rb);
      }
      for (const physics of entry.mountainPhysics ?? []) {
        if (physics?.collider) rapierWorld?.removeCollider(physics.collider, true);
        if (physics?.rb) removeRigidBodySafely(rapierWorld, physics.rb);
      }
      disposeMountains(entry.mountains);
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
      for (const physics of entry.rockPhysics ?? []) {
        if (physics?.collider) rapierWorld?.removeCollider(physics.collider, true);
        if (physics?.rb) removeRigidBodySafely(rapierWorld, physics.rb);
      }
      for (const physics of entry.treePhysics ?? []) {
        if (physics?.collider) rapierWorld?.removeCollider(physics.collider, true);
        if (physics?.rb) removeRigidBodySafely(rapierWorld, physics.rb);
      }
      for (const physics of entry.mountainPhysics ?? []) {
        if (physics?.collider) rapierWorld?.removeCollider(physics.collider, true);
        if (physics?.rb) removeRigidBodySafely(rapierWorld, physics.rb);
      }
      disposeMountains(entry.mountains);
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
    bushCoreGeometry.dispose();
    bushLobeGeometry.dispose();
    bushMaterials.forEach((material) => material.dispose());
    treeImpostorTrunkGeometry.dispose();
    treeImpostorLeafGeometry.dispose();
    treeImpostorTrunkMaterial.dispose();
    treeImpostorLeafMaterials.forEach((material) => material.dispose());
    mountainMaterials.forEach((material) => material.dispose());
    group.clear();
    scene?.remove(group);
  };

  const setTreeColliderEnabled = (enabled) => {
    const nextEnabled = enabled !== false;
    if (treeCollidersEnabled === nextEnabled) return;
    treeCollidersEnabled = nextEnabled;
    for (const entry of treeTiles.values()) {
      for (const physics of entry.treePhysics ?? []) {
        physics?.collider?.setSensor(!treeCollidersEnabled);
      }
    }
  };

  return {
    group,
    update,
    refreshTile,
    refreshTilesForCacheTile,
    refreshAll,
    setTileCache,
    getClosestTree,
    getClosestBush,
    removeTree,
    removeBush,
    removeBushesInRadius,
    removeBushesIntersectingBox,
    removeRocksInRadius,
    spawnQuestRock,
    setTreeColliderEnabled,
    dispose
  };
}

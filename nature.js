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
const DEBUG_COLOR = 0xffeb3b;
const DEBUG_REMOVAL_COLOR = 0xff1744;
const DEBUG_ROAD_OPACITY = 0.9;
const DEBUG_BUILDING_OPACITY = 0.65;

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

  const debugGroup = new THREE.Group();
  debugGroup.name = 'tree-blockers-debug';
  scene.add(debugGroup);

  const treeTiles = new Map();
  const roadSegmentsByTile = new Map();
  const roadDebugByTile = new Map();
  const buildingDebugByTile = new Map();
  const buildingPolygonsByTile = new Map();
  const treeRemovalDebugByTile = new Map();

  const tempStart = new THREE.Vector3();
  const tempEnd = new THREE.Vector3();
  const tempPosition = new THREE.Vector3();
  const tempBox = new THREE.Box3();

  let activeTileCache = tileCache ?? null;
  let tileSizeMeters = activeTileCache?.tileSizeMeters ?? 300;
  let tileBuffer = activeTileCache?.evictRadiusTiles ?? TREE_TILE_BUFFER;

  // const isDebugEnabled = () => Boolean(globalThis?.DEBUG_TREE_BLOCKERS);
  const isDebugEnabled = () => Boolean(true);

  const collectBuildingPolygons = (geojson) => {
    const polygons = [];
    const features = geojson?.features ?? [];
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
  };

  const getBuildingPolygonsForTile = (tileKey) => {
    if (!tileKey || !activeTileCache?.getEntry) return [];
    if (buildingPolygonsByTile.has(tileKey)) {
      return buildingPolygonsByTile.get(tileKey) ?? [];
    }
    const entry = activeTileCache.getEntry(tileKey);
    const polygons = collectBuildingPolygons(entry?.geojson);
    buildingPolygonsByTile.set(tileKey, polygons);
    return polygons;
  };

  const normalizeRing = (ring) => {
    if (!ring || ring.length === 0) return [];
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (first[0] === last[0] && first[1] === last[1]) return ring.slice(0, -1);
    return ring;
  };

  const pointInRing = (point, ring) => {
    const [px, py] = point;
    let inside = false;
    const coords = normalizeRing(ring);
    for (let i = 0, j = coords.length - 1; i < coords.length; j = i++) {
      const [xi, yi] = coords[i];
      const [xj, yj] = coords[j];
      const intersect = ((yi > py) !== (yj > py))
        && (px < ((xj - xi) * (py - yi)) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  };

  const pointInPolygon = (point, rings) => {
    if (!rings?.length) return false;
    // Treat courtyards/holes as blocked too.
    return pointInRing(point, rings[0]);
  };

  const isInsideBuildingFootprint = (position, tileKey) => {
    const geo = getGeoForLocal?.(position);
    if (!geo || !Number.isFinite(geo.lat) || !Number.isFinite(geo.lon)) return false;
    const point = [geo.lon, geo.lat];
    const keys = tileKey ? getNeighborTileKeys(tileKey) : [];
    for (const key of keys) {
      const polygons = getBuildingPolygonsForTile(key);
      if (!polygons.length) continue;
      for (const rings of polygons) {
        if (pointInPolygon(point, rings)) return true;
      }
    }
    return false;
  };


  const disposeDebugEntry = (entry) => {
    if (!entry) return;
    entry.traverse((child) => {
      if (child.geometry?.dispose) {
        child.geometry.dispose();
      }
      if (child.material?.dispose) {
        child.material.dispose();
      }
    });
  };

  const removeDebugEntry = (map, tileKey) => {
    const entry = map.get(tileKey);
    if (!entry) return;
    debugGroup.remove(entry);
    disposeDebugEntry(entry);
    map.delete(tileKey);
  };

  const clearDebug = () => {
    for (const entry of roadDebugByTile.values()) {
      debugGroup.remove(entry);
      disposeDebugEntry(entry);
    }
    roadDebugByTile.clear();
    for (const entry of buildingDebugByTile.values()) {
      debugGroup.remove(entry);
      disposeDebugEntry(entry);
    }
    buildingDebugByTile.clear();
    for (const entry of treeRemovalDebugByTile.values()) {
      debugGroup.remove(entry);
      disposeDebugEntry(entry);
    }
    treeRemovalDebugByTile.clear();
  };

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

  const getTreeRemovalDebugGroup = (tileKey) => {
    if (!tileKey) return null;
    let groupEntry = treeRemovalDebugByTile.get(tileKey);
    if (groupEntry) return groupEntry;
    groupEntry = new THREE.Group();
    groupEntry.name = `tree-removal-debug-${tileKey}`;
    treeRemovalDebugByTile.set(tileKey, groupEntry);
    debugGroup.add(groupEntry);
    return groupEntry;
  };

  const addTreeRemovalMarker = (tileKey, position, reason) => {
    if (!isDebugEnabled()) return;
    const groupEntry = getTreeRemovalDebugGroup(tileKey);
    if (!groupEntry || !position) return;
    const size = 1.6;
    const y = position.y + 0.1;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(
        new Float32Array([
          position.x - size, y, position.z - size,
          position.x + size, y, position.z + size,
          position.x - size, y, position.z + size,
          position.x + size, y, position.z - size
        ]),
        3
      )
    );
    const material = new THREE.LineBasicMaterial({
      color: DEBUG_REMOVAL_COLOR,
      transparent: true,
      opacity: 0.95
    });
    const lines = new THREE.LineSegments(geometry, material);
    lines.name = `tree-removal-${reason ?? 'unknown'}`;
    groupEntry.add(lines);
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

    if (isDebugEnabled()) {
      removeDebugEntry(roadDebugByTile, tileKey);
      if (segments.length) {
        const positions = new Float32Array(segments.length * 6);
        segments.forEach((segment, index) => {
          const offset = index * 6;
          positions[offset] = segment.ax;
          positions[offset + 1] = 0.2;
          positions[offset + 2] = segment.az;
          positions[offset + 3] = segment.bx;
          positions[offset + 4] = 0.2;
          positions[offset + 5] = segment.bz;
        });
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        const material = new THREE.LineBasicMaterial({
          color: DEBUG_COLOR,
          transparent: true,
          opacity: DEBUG_ROAD_OPACITY
        });
        const lines = new THREE.LineSegments(geometry, material);
        lines.name = `tree-road-debug-${tileKey}`;
        roadDebugByTile.set(tileKey, lines);
        debugGroup.add(lines);
      }
    } else if (roadDebugByTile.has(tileKey)) {
      removeDebugEntry(roadDebugByTile, tileKey);
    }

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

  const getBuildingBlockerInfo = (position, tileKey) => {
    const buildingsGroup = buildingsRenderer?.group;
    if (!buildingsGroup) {
      if (isDebugEnabled()) {
        console.log('[nature] building check skipped (no buildings group).', { tileKey });
      }
      return { blocked: false, reason: 'no-buildings', intersections: [] };
    }
    const targetTiles = tileKey ? getNeighborTileKeys(tileKey) : [];
    // Footprint is lon/lat and can drift vs rendered mesh; use raycasts as truth.
    // if (isInsideBuildingFootprint(position, tileKey)) {
    //   return { blocked: true, reason: 'footprint', intersections: [] };
    // }
    let groupsToCheck = targetTiles.length
      ? targetTiles
        .map((key) => {
          const tileGroup = getTileGroup(buildingsGroup, 'osm-buildings', key);
          return tileGroup?.getObjectByName(`building-collision-${key}`) ?? tileGroup;
        })
        .filter(Boolean)
      : [buildingsGroup];
    if (groupsToCheck.length === 0) {
      groupsToCheck = [buildingsGroup];
    }
    for (const group of groupsToCheck) {
      group.updateWorldMatrix(true, true);
    }
    const terrainY = getTerrainHeight?.(position.x, position.z) ?? position.y ?? 0;
    const rayBaseY = Math.max(position.y ?? terrainY, terrainY);
    const rayOriginDown = tempPosition.set(
      position.x,
      rayBaseY + BUILDING_RAYCAST_HEIGHT,
      position.z
    );
    buildingRaycaster.near = 0;
    buildingRaycaster.far = BUILDING_RAYCAST_HEIGHT + Math.max(0, rayBaseY) + TREE_BUILDING_CLEARANCE;
    buildingRaycaster.set(rayOriginDown, buildingRayDirection);
    const intersections = buildingRaycaster.intersectObjects(groupsToCheck, true);
    if (intersections.length > 0) {
      return { blocked: true, reason: 'raycast', intersections };
    }
    return { blocked: false, reason: 'none', intersections: [] };
  };

  const isNearBuilding = (position, tileKey) => getBuildingBlockerInfo(position, tileKey).blocked;

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
    if (isDebugEnabled()) {
      removeDebugEntry(treeRemovalDebugByTile, tileKey);
    }
    const remaining = [];
    for (const tree of entry.trees) {
      if (!tree) continue;
      const { x, z } = tree.position;
      if (isNearRoad(x, z, tileKey)) {
        entry.group.remove(tree);
        addTreeRemovalMarker(tileKey, tree.position, 'road');
        console.log('[nature] removed tree near road.', {
          tileKey,
          position: { x: tree.position.x, y: tree.position.y, z: tree.position.z }
        });
        continue;
      }
      const buildingInfo = getBuildingBlockerInfo(tree.position, tileKey);
      if (buildingInfo.blocked) {
        entry.group.remove(tree);
        addTreeRemovalMarker(tileKey, tree.position, `building-${buildingInfo.reason}`);
        console.log('[nature] removed tree near building.', {
          tileKey,
          position: { x: tree.position.x, y: tree.position.y, z: tree.position.z },
          reason: buildingInfo.reason,
          intersections: buildingInfo.intersections?.length ?? 0
        });
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
      buildingPolygonsByTile.delete(key);
      removeDebugEntry(roadDebugByTile, key);
      removeDebugEntry(buildingDebugByTile, key);
      removeDebugEntry(treeRemovalDebugByTile, key);
    }
  };

  const refreshTile = (tileKey) => {
    if (!tileKey) return;
    buildingPolygonsByTile.delete(tileKey);
    cacheRoadSegmentsForTile(tileKey);
    pruneTileTrees(tileKey);
    for (const neighborKey of getNeighborTileKeys(tileKey)) {
      if (neighborKey === tileKey) continue;
      pruneTileTrees(neighborKey);
    }
    if (!isDebugEnabled()) {
      removeDebugEntry(buildingDebugByTile, tileKey);
      return;
    }
    removeDebugEntry(buildingDebugByTile, tileKey);
    const buildingsGroup = buildingsRenderer?.group;
    if (!buildingsGroup) return;
    const tileGroup = getTileGroup(buildingsGroup, 'osm-buildings', tileKey);
    if (!tileGroup) return;
    const helperGroup = new THREE.Group();
    helperGroup.name = `tree-building-debug-${tileKey}`;
    const collisionMesh =
      tileGroup.getObjectByName(`extruded-collider-${tileKey}`) ??
      tileGroup.getObjectByName(`extruded-mesh-${tileKey}`) ??
      null;
    const meshes = [];
    if (collisionMesh?.isMesh && collisionMesh.geometry) {
      meshes.push(collisionMesh);
    } else {
      tileGroup.traverse((child) => {
        if (child?.isMesh && child.geometry) meshes.push(child);
      });
    }

    for (const mesh of meshes) {
      if (!mesh.geometry?.attributes?.position) continue;
      mesh.updateWorldMatrix(true, false);
      const edges = new THREE.EdgesGeometry(mesh.geometry);
      const material = new THREE.LineBasicMaterial({
        color: DEBUG_COLOR,
        transparent: true,
        opacity: DEBUG_BUILDING_OPACITY
      });
      const lines = new THREE.LineSegments(edges, material);
      lines.matrixAutoUpdate = false;
      lines.matrix.copy(mesh.matrixWorld);
      helperGroup.add(lines);
    }

    if (!helperGroup.children.length) {
      helperGroup.clear();
      return;
    }
    buildingDebugByTile.set(tileKey, helperGroup);
    debugGroup.add(helperGroup);
  };

  const refreshAll = () => {
    for (const tileKey of treeTiles.keys()) {
      refreshTile(tileKey);
    }
    if (!isDebugEnabled()) {
      clearDebug();
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
    buildingPolygonsByTile.clear();
    clearDebug();
  };

  const dispose = () => {
    for (const entry of treeTiles.values()) {
      entry.group.clear();
      group.remove(entry.group);
    }
    treeTiles.clear();
    roadSegmentsByTile.clear();
    buildingPolygonsByTile.clear();
    clearDebug();
    group.clear();
    scene?.remove(group);
    debugGroup.clear();
    scene?.remove(debugGroup);
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

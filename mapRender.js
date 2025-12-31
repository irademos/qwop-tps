import * as THREE from "three";
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

const DEFAULT_WIDTH = 1.0;
const DEFAULT_COLOR = 0x2f2f2f;
const DEFAULT_ELEVATION = 0.02;
const METERS_PER_DEGREE_LAT = 111_132.92;
const GROUND_ELEVATION = 0.0;
const GROUND_TEXTURE_SCALE_METERS = 22;
const ROAD_TEXTURE_SCALE_METERS = 6;

const textureLoader = new THREE.TextureLoader();
const textureCache = new Map();

function loadTexture(key, url, { repeat = 1, srgb = false } = {}) {
  if (textureCache.has(key)) return textureCache.get(key);
  const texture = textureLoader.load(url);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeat, repeat);
  if (srgb && texture.colorSpace !== undefined) {
    texture.colorSpace = THREE.SRGBColorSpace;
  }
  textureCache.set(key, texture);
  return texture;
}

function metersPerDegreeLon(latDeg) {
  return 111_412.84 * Math.cos((latDeg * Math.PI) / 180);
}

function collectHighwayLines(geojson) {
  const lines = [];
  const features = geojson?.features ?? [];
  for (const feature of features) {
    if (!feature?.properties?.highway) continue;
    const highway = feature.properties.highway;
    const geometry = feature.geometry;
    if (!geometry) continue;
    if (geometry.type === "LineString") {
      lines.push({ highway, coords: geometry.coordinates });
    } else if (geometry.type === "MultiLineString") {
      for (const line of geometry.coordinates) {
        lines.push({ highway, coords: line });
      }
    }
  }
  return lines;
}

function computeBounds(lines) {
  let minLon = Infinity;
  let maxLon = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  let count = 0;
  for (const line of lines) {
    for (const coord of line.coords || []) {
      const [lon, lat] = coord;
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
      minLon = Math.min(minLon, lon);
      maxLon = Math.max(maxLon, lon);
      minLat = Math.min(minLat, lat);
      maxLat = Math.max(maxLat, lat);
      count += 1;
    }
  }
  if (!Number.isFinite(minLon) || count === 0) {
    return null;
  }
  return {
    centerLon: (minLon + maxLon) / 2,
    centerLat: (minLat + maxLat) / 2
  };
}

function toLocalMeters(coord, origin, lonScale) {
  const [lon, lat] = coord;
  return {
    x: (lon - origin.centerLon) * lonScale,
    z: -(lat - origin.centerLat) * METERS_PER_DEGREE_LAT
  };
}

function resolveLineWidth(highway) {
  if (typeof highway !== "string") return DEFAULT_WIDTH;
  return ROAD_WIDTHS[highway] ?? DEFAULT_WIDTH;
}

export function createMapRenderer({
  scene,
  renderer,
  color = DEFAULT_COLOR,
  elevation = DEFAULT_ELEVATION,
  tileSizeMeters = 300
} = {}) {
  const group = new THREE.Group();
  group.name = "osm-highways";
  scene?.add(group);

  const groundGroup = new THREE.Group();
  groundGroup.name = "osm-ground";
  scene?.add(groundGroup);

  const roadTexture = loadTexture(
    "osm-road",
    "/assets/textures/sandy_gravel_02_4k.blend/textures/sandy_gravel_02_diff_4k.jpg",
    { repeat: 1, srgb: true }
  );

  const groundTexture = loadTexture(
    "osm-ground",
    "/assets/textures/forrest_ground_01_4k.blend/textures/forrest_ground_01_diff_4k.jpg",
    { repeat: 1, srgb: true }
  );

  const roadMaterial = new THREE.MeshStandardMaterial({
    map: roadTexture,
    color,
    roughness: 0.9,
    metalness: 0.05
  });

  const groundMaterial = new THREE.MeshStandardMaterial({
    map: groundTexture,
    roughness: 0.9,
    metalness: 0.05
  });

  const roadMesh = new THREE.Mesh(new THREE.BufferGeometry(), roadMaterial);
  roadMesh.receiveShadow = true;
  roadMesh.castShadow = false;
  group.add(roadMesh);

  let groundGeometry = null;
  const groundMeshes = new Map();

  const ensureGroundGeometry = () => {
    if (groundGeometry) return groundGeometry;
    groundGeometry = new THREE.PlaneGeometry(tileSizeMeters, tileSizeMeters, 1, 1);
    groundGeometry.rotateX(-Math.PI / 2);
    return groundGeometry;
  };

  const updateGroundRepeat = () => {
    const repeat = Math.max(1, tileSizeMeters / GROUND_TEXTURE_SCALE_METERS);
    groundTexture.repeat.set(repeat, repeat);
    groundTexture.needsUpdate = true;
  };

  updateGroundRepeat();

  function updateHighways(geojson, boundsOverride) {
    const lines = collectHighwayLines(geojson);
    if (lines.length === 0) {
      roadMesh.visible = false;
      return;
    }

    const bounds = boundsOverride ?? computeBounds(lines);
    if (!bounds) {
      roadMesh.visible = false;
      return;
    }

    const lonScale = metersPerDegreeLon(bounds.centerLat);

    const positions = [];
    const uvs = [];
    const indices = [];
    let indexOffset = 0;

    for (const line of lines) {
      if (!line.coords || line.coords.length < 2) continue;
      const width = resolveLineWidth(line.highway);
      const halfWidth = width * 0.5;
      let distanceAcc = 0;
      let previous = null;

      for (const coord of line.coords) {
        if (!coord || coord.length < 2) continue;
        const [lon, lat] = coord;
        if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
        const local = toLocalMeters([lon, lat], bounds, lonScale);
        if (!previous) {
          previous = local;
          continue;
        }
        const dx = local.x - previous.x;
        const dz = local.z - previous.z;
        const segmentLength = Math.hypot(dx, dz);
        if (segmentLength <= 0.001) {
          previous = local;
          continue;
        }
        const nx = -dz / segmentLength;
        const nz = dx / segmentLength;

        const leftStart = {
          x: previous.x + nx * halfWidth,
          z: previous.z + nz * halfWidth
        };
        const rightStart = {
          x: previous.x - nx * halfWidth,
          z: previous.z - nz * halfWidth
        };
        const leftEnd = {
          x: local.x + nx * halfWidth,
          z: local.z + nz * halfWidth
        };
        const rightEnd = {
          x: local.x - nx * halfWidth,
          z: local.z - nz * halfWidth
        };

        positions.push(
          leftStart.x,
          elevation,
          leftStart.z,
          rightStart.x,
          elevation,
          rightStart.z,
          leftEnd.x,
          elevation,
          leftEnd.z,
          rightEnd.x,
          elevation,
          rightEnd.z
        );

        const vStart = distanceAcc / ROAD_TEXTURE_SCALE_METERS;
        const vEnd = (distanceAcc + segmentLength) / ROAD_TEXTURE_SCALE_METERS;
        uvs.push(0, vStart, 1, vStart, 0, vEnd, 1, vEnd);

        indices.push(
          indexOffset,
          indexOffset + 1,
          indexOffset + 2,
          indexOffset + 2,
          indexOffset + 1,
          indexOffset + 3
        );
        indexOffset += 4;
        distanceAcc += segmentLength;
        previous = local;
      }
    }

    if (positions.length === 0) {
      roadMesh.visible = false;
      return;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    roadMesh.geometry.dispose();
    roadMesh.geometry = geometry;
    roadMesh.visible = true;
  }

  function dispose() {
    roadMesh.geometry.dispose();
    roadMaterial.dispose();
    groundMaterial.dispose();
    groundGeometry?.dispose();
    for (const mesh of groundMeshes.values()) {
      mesh.geometry?.dispose?.();
    }
    groundMeshes.clear();
    group.clear();
    groundGroup.clear();
    scene?.remove(group);
    scene?.remove(groundGroup);
  }

  function updateGroundTiles(tiles = []) {
    const nextKeys = new Set();
    const geometry = ensureGroundGeometry();
    updateGroundRepeat();
    for (const tile of tiles) {
      if (!tile || !Number.isFinite(tile.x) || !Number.isFinite(tile.y)) continue;
      const key = `${tile.x},${tile.y}`;
      nextKeys.add(key);
      let mesh = groundMeshes.get(key);
      if (!mesh) {
        mesh = new THREE.Mesh(geometry, groundMaterial);
        mesh.receiveShadow = true;
        mesh.castShadow = false;
        groundGroup.add(mesh);
        groundMeshes.set(key, mesh);
      }
      mesh.position.set(
        (tile.x + 0.5) * tileSizeMeters,
        GROUND_ELEVATION,
        -(tile.y + 0.5) * tileSizeMeters
      );
    }

    for (const [key, mesh] of groundMeshes.entries()) {
      if (!nextKeys.has(key)) {
        groundGroup.remove(mesh);
        groundMeshes.delete(key);
      }
    }
  }

  function setTileSize(nextTileSize) {
    if (!Number.isFinite(nextTileSize) || nextTileSize <= 0) return;
    if (nextTileSize === tileSizeMeters) return;
    tileSizeMeters = nextTileSize;
    if (groundGeometry) {
      groundGeometry.dispose();
      groundGeometry = null;
    }
    updateGroundRepeat();
  }

  return {
    group,
    updateHighways,
    updateGroundTiles,
    setTileSize,
    dispose
  };
}

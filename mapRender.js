import * as THREE from "three";
const ROAD_WIDTH_METERS = 1.2;
const DEFAULT_ELEVATION = 0.05;
const METERS_PER_DEGREE_LAT = 111_132.92;
const ROAD_TEXTURE_METERS = 3.5;
const GROUND_TEXTURE_METERS = 8.0;

const textureLoader = new THREE.TextureLoader();

function loadTex(url, { srgb = false, repeat = 1 } = {}) {
  const tex = textureLoader.load(url);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  if (srgb && tex.colorSpace !== undefined) tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const groundBase = loadTex(
  "/assets/textures/forrest_ground_01_4k.blend/textures/forrest_ground_01_diff_4k.jpg",
  { srgb: true }
);

const groundRough = loadTex(
  "/assets/textures/forrest_ground_01_4k.blend/textures/forrest_ground_01_rough_4k.jpg"
);

const roadBase = loadTex(
  "/assets/textures/sandy_gravel_02_4k.blend/textures/sandy_gravel_02_diff_4k.jpg",
  { srgb: true }
);

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
    minLon,
    maxLon,
    minLat,
    maxLat,
    centerLon: (minLon + maxLon) / 2,
    centerLat: (minLat + maxLat) / 2
  };
}

function computeGeojsonBounds(geojson) {
  let minLon = Infinity;
  let maxLon = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  let count = 0;

  const updateBounds = (coord) => {
    if (!coord || coord.length < 2) return;
    const [lon, lat] = coord;
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;
    minLon = Math.min(minLon, lon);
    maxLon = Math.max(maxLon, lon);
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
    count += 1;
  };

  for (const feature of geojson?.features ?? []) {
    const geometry = feature?.geometry;
    if (!geometry) continue;
    if (geometry.type === "LineString") {
      geometry.coordinates.forEach(updateBounds);
    } else if (geometry.type === "MultiLineString") {
      geometry.coordinates.flat().forEach(updateBounds);
    } else if (geometry.type === "Polygon") {
      geometry.coordinates.flat().forEach(updateBounds);
    } else if (geometry.type === "MultiPolygon") {
      geometry.coordinates.flat(2).forEach(updateBounds);
    }
  }

  if (!Number.isFinite(minLon) || count === 0) {
    return null;
  }

  return {
    minLon,
    maxLon,
    minLat,
    maxLat,
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

export function createMapRenderer({
  scene,
  renderer,
  elevation = DEFAULT_ELEVATION
} = {}) {
  const group = new THREE.Group();
  group.name = "osm-map";
  scene?.add(group);

  const groundMaterial = new THREE.MeshStandardMaterial({
    map: groundBase,
    roughnessMap: groundRough,
    roughness: 1.0,
    metalness: 0.0
  });
  const groundMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), groundMaterial);
  groundMesh.receiveShadow = true;
  groundMesh.rotation.x = -Math.PI / 2;
  group.add(groundMesh);

  const roadMaterial = new THREE.MeshStandardMaterial({
    map: roadBase,
    roughness: 0.9,
    metalness: 0.0
  });
  const roadMesh = new THREE.Mesh(new THREE.BufferGeometry(), roadMaterial);
  roadMesh.receiveShadow = true;
  group.add(roadMesh);

  const resolution = new THREE.Vector2(1, 1);

  function buildRoadGeometry(lines, origin, lonScale) {
    const positions = [];
    const uvs = [];
    const halfWidth = ROAD_WIDTH_METERS * 0.5;

    for (const line of lines) {
      if (!line.coords || line.coords.length < 2) continue;
      let prevLocal = null;
      let vCoord = 0;

      for (const coord of line.coords) {
        if (!coord || coord.length < 2) continue;
        const [lon, lat] = coord;
        if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
        const local = toLocalMeters([lon, lat], origin, lonScale);
        if (!prevLocal) {
          prevLocal = local;
          continue;
        }

        const dx = local.x - prevLocal.x;
        const dz = local.z - prevLocal.z;
        const length = Math.hypot(dx, dz);
        if (length === 0) {
          prevLocal = local;
          continue;
        }

        const nx = -dz / length;
        const nz = dx / length;
        const vNext = vCoord + length / ROAD_TEXTURE_METERS;

        const v0x = prevLocal.x + nx * halfWidth;
        const v0z = prevLocal.z + nz * halfWidth;
        const v1x = prevLocal.x - nx * halfWidth;
        const v1z = prevLocal.z - nz * halfWidth;
        const v2x = local.x + nx * halfWidth;
        const v2z = local.z + nz * halfWidth;
        const v3x = local.x - nx * halfWidth;
        const v3z = local.z - nz * halfWidth;

        positions.push(
          v0x,
          elevation,
          v0z,
          v1x,
          elevation,
          v1z,
          v2x,
          elevation,
          v2z,
          v2x,
          elevation,
          v2z,
          v1x,
          elevation,
          v1z,
          v3x,
          elevation,
          v3z
        );

        uvs.push(
          0,
          vCoord,
          1,
          vCoord,
          0,
          vNext,
          0,
          vNext,
          1,
          vCoord,
          1,
          vNext
        );

        vCoord = vNext;
        prevLocal = local;
      }
    }

    const geometry = new THREE.BufferGeometry();
    if (positions.length === 0) {
      return geometry;
    }
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    return geometry;
  }

  function updateHighways(geojson, boundsOverride) {
    const lines = collectHighwayLines(geojson);
    const fallbackBounds = lines.length > 0 ? computeBounds(lines) : null;
    const computedBounds = computeGeojsonBounds(geojson) ?? fallbackBounds;
    const bounds = boundsOverride ?? computedBounds;
    if (!bounds) {
      roadMesh.visible = false;
      groundMesh.visible = false;
      return;
    }

    roadMesh.visible = true;
    groundMesh.visible = true;

    const lonScale = metersPerDegreeLon(bounds.centerLat);
    const roadGeometry = buildRoadGeometry(lines, bounds, lonScale);
    roadMesh.geometry.dispose();
    roadMesh.geometry = roadGeometry;

    if (computedBounds) {
      const minLocal = toLocalMeters([computedBounds.minLon, computedBounds.minLat], bounds, lonScale);
      const maxLocal = toLocalMeters([computedBounds.maxLon, computedBounds.maxLat], bounds, lonScale);
      const minX = Math.min(minLocal.x, maxLocal.x);
      const maxX = Math.max(minLocal.x, maxLocal.x);
      const minZ = Math.min(minLocal.z, maxLocal.z);
      const maxZ = Math.max(minLocal.z, maxLocal.z);
      const width = Math.max(1, maxX - minX);
      const height = Math.max(1, maxZ - minZ);
      const centerX = (minX + maxX) / 2;
      const centerZ = (minZ + maxZ) / 2;

      const geometry = new THREE.PlaneGeometry(width, height);
      const repeatX = width / GROUND_TEXTURE_METERS;
      const repeatY = height / GROUND_TEXTURE_METERS;
      groundBase.repeat.set(repeatX, repeatY);
      groundRough.repeat.set(repeatX, repeatY);
      groundMesh.geometry.dispose();
      groundMesh.geometry = geometry;
      groundMesh.position.set(centerX, elevation - 0.02, centerZ);
    }
  }

  function setResolution(width, height) {
    resolution.set(width, height);
  }

  function dispose() {
    roadMesh.geometry.dispose();
    groundMesh.geometry.dispose();
    roadMaterial.dispose();
    groundMaterial.dispose();
    group.clear();
    scene?.remove(group);
  }

  if (renderer) {
    const size = new THREE.Vector2();
    renderer.getSize(size);
    setResolution(size.x, size.y);
  }

  return {
    group,
    updateHighways,
    setResolution,
    dispose
  };
}

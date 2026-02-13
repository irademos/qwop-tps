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
const ROAD_WIDTH_SCALE = 10;
const DEFAULT_COLOR = 0x2f2f2f;
const DEFAULT_ELEVATION = 0.01;
const METERS_PER_DEGREE_LAT = 111_132.92;

function metersPerDegreeLon(latDeg) {
  return 111_412.84 * Math.cos((latDeg * Math.PI) / 180);
}

function collectHighwayLines(geojson) {
  const lines = [];
  const features = geojson?.prefiltered?.highways ?? geojson?.features ?? [];
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
    x: -(lon - origin.centerLon) * lonScale,
    z: (lat - origin.centerLat) * METERS_PER_DEGREE_LAT
  };
}

function makeRoadMaterial(color) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.95,
    metalness: 0.0
  });
}

function resolveLineWidth(highway) {
  if (typeof highway !== "string") return DEFAULT_WIDTH;
  const baseWidth = ROAD_WIDTHS[highway] ?? DEFAULT_WIDTH;
  return baseWidth * ROAD_WIDTH_SCALE;
}

export function createMapRenderer({
  scene,
  renderer,
  color = DEFAULT_COLOR,
  elevation = DEFAULT_ELEVATION
} = {}) {
  const group = new THREE.Group();
  group.name = "osm-highways";
  scene?.add(group);

  const tileMeshes = new Map();
  const roadMaterials = new Map();
  const baseColor = new THREE.Color(color);
  let brightness = 1;

  function getRoadMaterial(width) {
    if (!roadMaterials.has(width)) {
      const material = makeRoadMaterial(color);
      material.color.copy(baseColor).multiplyScalar(brightness);
      roadMaterials.set(width, material);
    }
    return roadMaterials.get(width);
  }

  function createRoadMesh(width) {
    const geometry = new THREE.BufferGeometry();
    const material = getRoadMaterial(width);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = true;
    return mesh;
  }

  function ensureRoadMesh(pool, parentGroup, index, width) {
    let mesh = pool[index];
    if (!mesh) {
      mesh = createRoadMesh(width);
      pool[index] = mesh;
      parentGroup.add(mesh);
    }
    mesh.visible = true;
    const material = getRoadMaterial(width);
    if (mesh.material !== material) {
      mesh.material = material;
    }
    return mesh;
  }

  function updateRoadGeometry(mesh, points, width, y) {
    if (!mesh?.geometry || !Array.isArray(points) || points.length < 2) return;

    const halfWidth = width * 0.5;
    const vertices = [];
    const indices = [];

    for (let i = 0; i < points.length - 1; i += 1) {
      const start = points[i];
      const end = points[i + 1];
      const dx = end.x - start.x;
      const dz = end.z - start.z;
      const length = Math.hypot(dx, dz);
      if (length <= Number.EPSILON) continue;

      const nx = -dz / length;
      const nz = dx / length;

      const baseIndex = vertices.length / 3;
      vertices.push(
        start.x + nx * halfWidth, y, start.z + nz * halfWidth,
        start.x - nx * halfWidth, y, start.z - nz * halfWidth,
        end.x + nx * halfWidth, y, end.z + nz * halfWidth,
        end.x - nx * halfWidth, y, end.z - nz * halfWidth
      );
      indices.push(
        baseIndex, baseIndex + 2, baseIndex + 1,
        baseIndex + 2, baseIndex + 3, baseIndex + 1
      );
    }

    mesh.geometry.dispose();
    mesh.geometry = new THREE.BufferGeometry();
    mesh.geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
    mesh.geometry.setIndex(indices);
    mesh.geometry.computeVertexNormals();
    mesh.geometry.computeBoundingSphere();
  }

  function clearUnused(pool, fromIndex) {
    for (let i = fromIndex; i < pool.length; i += 1) {
      const line = pool[i];
      if (line) {
        line.visible = false;
      }
    }
  }

  function setBrightness(nextBrightness) {
    const clamped = Math.min(Math.max(nextBrightness, 0), 1);
    if (brightness === clamped) return;
    brightness = clamped;
    for (const material of roadMaterials.values()) {
      material.color.copy(baseColor).multiplyScalar(brightness);
      material.needsUpdate = true;
    }
  }

  function ensureTile(tileKey) {
    let entry = tileMeshes.get(tileKey);
    if (entry) return entry;
    const tileGroup = new THREE.Group();
    tileGroup.name = `osm-highways-${tileKey}`;
    group.add(tileGroup);
    entry = {
      group: tileGroup,
      pool: []
    };
    tileMeshes.set(tileKey, entry);
    return entry;
  }

  function updateTileHighways(tileKey, geojson, boundsOverride) {
    if (!tileKey) return null;
    const tileEntry = ensureTile(tileKey);
    const { pool: tilePool, group: tileGroup } = tileEntry;
    const lines = collectHighwayLines(geojson);
    if (lines.length === 0) {
      clearUnused(tilePool, 0);
      return tileEntry;
    }

    const bounds = boundsOverride ?? computeBounds(lines);
    if (!bounds) {
      clearUnused(tilePool, 0);
      return tileEntry;
    }

    const lonScale = metersPerDegreeLon(bounds.centerLat);

    let activeIndex = 0;
    for (const line of lines) {
      if (!line.coords || line.coords.length < 2) continue;
      const width = resolveLineWidth(line.highway);
      const points = [];
      for (const coord of line.coords) {
        if (!coord || coord.length < 2) continue;
        const [lon, lat] = coord;
        if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
        const local = toLocalMeters([lon, lat], bounds, lonScale);
        points.push(local);
      }
      if (points.length < 2) continue;
      const roadMesh = ensureRoadMesh(tilePool, tileGroup, activeIndex, width);
      updateRoadGeometry(roadMesh, points, width, elevation);
      activeIndex += 1;
    }

    if (activeIndex === 0) {
      clearUnused(tilePool, 0);
      return tileEntry;
    }
    clearUnused(tilePool, activeIndex);
    return tileEntry;
  }

  function removeTile(tileKey) {
    const entry = tileMeshes.get(tileKey);
    if (!entry) return;
    for (const line of entry.pool) {
      line?.geometry?.dispose?.();
    }
    entry.group.clear();
    group.remove(entry.group);
    tileMeshes.delete(tileKey);
  }

  function clearTiles() {
    for (const tileKey of tileMeshes.keys()) {
      removeTile(tileKey);
    }
  }

  function setResolution() {}

  function dispose() {
    clearTiles();
    for (const material of roadMaterials.values()) {
      material.dispose();
    }
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
    updateTileHighways,
    removeTile,
    clearTiles,
    setResolution,
    setBrightness,
    dispose
  };
}

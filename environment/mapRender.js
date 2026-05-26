import * as THREE from "three";

import { resolveRoadWidth } from "./roadWidths.js";
const DEFAULT_COLOR = 0x2f2f2f;
const DEFAULT_ELEVATION = 0.01;
const ROAD_SURFACE_EPSILON = 0.025;
const ROAD_STAMP_FALLOFF_METERS = 6;
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

  function buildRoadStamp(points, width) {
    if (!Array.isArray(points) || points.length < 2 || !Number.isFinite(width) || width <= 0) return null;
    const halfWidth = width * 0.5;
    return {
      points,
      width,
      innerHalfWidth: halfWidth,
      outerHalfWidth: halfWidth + ROAD_STAMP_FALLOFF_METERS
    };
  }

  function updateRoadGeometry(mesh, stamp, elevationOffset) {
    if (!mesh?.geometry || !stamp || !Array.isArray(stamp.points) || stamp.points.length < 2) return;

    const halfWidth = stamp.innerHalfWidth;
    const points = stamp.points;
    const segmentCount = points.length - 1;
    if (segmentCount <= 0) return;

    const vertices = new Float32Array(segmentCount * 12);
    const indexArrayType = segmentCount * 4 > 65_535 ? Uint32Array : Uint16Array;
    const indices = new indexArrayType(segmentCount * 6);
    let vertexOffset = 0;
    let indexOffset = 0;
    let baseIndex = 0;

    for (let i = 0; i < points.length - 1; i += 1) {
      const start = points[i];
      const end = points[i + 1];
      const dx = end.x - start.x;
      const dz = end.z - start.z;
      const length = Math.hypot(dx, dz);
      if (length <= Number.EPSILON) {
        vertices[vertexOffset++] = start.x;
        vertices[vertexOffset++] = elevationOffset;
        vertices[vertexOffset++] = start.z;
        vertices[vertexOffset++] = start.x;
        vertices[vertexOffset++] = elevationOffset;
        vertices[vertexOffset++] = start.z;
        vertices[vertexOffset++] = end.x;
        vertices[vertexOffset++] = elevationOffset;
        vertices[vertexOffset++] = end.z;
        vertices[vertexOffset++] = end.x;
        vertices[vertexOffset++] = elevationOffset;
        vertices[vertexOffset++] = end.z;
        indices[indexOffset++] = baseIndex;
        indices[indexOffset++] = baseIndex + 2;
        indices[indexOffset++] = baseIndex + 1;
        indices[indexOffset++] = baseIndex + 2;
        indices[indexOffset++] = baseIndex + 3;
        indices[indexOffset++] = baseIndex + 1;
        baseIndex += 4;
        continue;
      }

      const nx = -dz / length;
      const nz = dx / length;

      const l0x = start.x + nx * halfWidth;
      const l0z = start.z + nz * halfWidth;
      const r0x = start.x - nx * halfWidth;
      const r0z = start.z - nz * halfWidth;
      const l1x = end.x + nx * halfWidth;
      const l1z = end.z + nz * halfWidth;
      const r1x = end.x - nx * halfWidth;
      const r1z = end.z - nz * halfWidth;
      vertices[vertexOffset++] = l0x;
      vertices[vertexOffset++] = elevationOffset;
      vertices[vertexOffset++] = l0z;
      vertices[vertexOffset++] = r0x;
      vertices[vertexOffset++] = elevationOffset;
      vertices[vertexOffset++] = r0z;
      vertices[vertexOffset++] = l1x;
      vertices[vertexOffset++] = elevationOffset;
      vertices[vertexOffset++] = l1z;
      vertices[vertexOffset++] = r1x;
      vertices[vertexOffset++] = elevationOffset;
      vertices[vertexOffset++] = r1z;
      indices[indexOffset++] = baseIndex;
      indices[indexOffset++] = baseIndex + 2;
      indices[indexOffset++] = baseIndex + 1;
      indices[indexOffset++] = baseIndex + 2;
      indices[indexOffset++] = baseIndex + 3;
      indices[indexOffset++] = baseIndex + 1;
      baseIndex += 4;
    }

    const geometry = mesh.geometry;
    const positionAttribute = geometry.getAttribute("position");
    const indexAttribute = geometry.getIndex();

    const topologyStable =
      positionAttribute &&
      positionAttribute.array.length === vertices.length &&
      indexAttribute &&
      indexAttribute.array.length === indices.length &&
      indexAttribute.array.constructor === indices.constructor;

    let vertexDataChanged = false;

    if (topologyStable) {
      const positionArray = positionAttribute.array;
      for (let i = 0; i < vertices.length; i += 1) {
        if (positionArray[i] !== vertices[i]) {
          vertexDataChanged = true;
          break;
        }
      }

      if (vertexDataChanged) {
        positionArray.set(vertices);
        positionAttribute.needsUpdate = true;
      }

      const indexArray = indexAttribute.array;
      let indexChanged = false;
      for (let i = 0; i < indices.length; i += 1) {
        if (indexArray[i] !== indices[i]) {
          indexChanged = true;
          break;
        }
      }
      if (indexChanged) {
        indexArray.set(indices);
        indexAttribute.needsUpdate = true;
      }
      vertexDataChanged ||= indexChanged;
    } else {
      geometry.setAttribute("position", new THREE.BufferAttribute(vertices, 3));
      geometry.setIndex(new THREE.BufferAttribute(indices, 1));
      vertexDataChanged = true;
    }

    if (vertexDataChanged) {
      geometry.computeVertexNormals();
      geometry.computeBoundingSphere();
    }
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
      const width = resolveRoadWidth(line.highway);
      const points = [];
      for (const coord of line.coords) {
        if (!coord || coord.length < 2) continue;
        const [lon, lat] = coord;
        if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
        const local = toLocalMeters([lon, lat], bounds, lonScale);
        points.push(local);
      }
      if (points.length < 2) continue;
      const stamp = buildRoadStamp(points, width);
      if (!stamp) continue;
      const roadMesh = ensureRoadMesh(tilePool, tileGroup, activeIndex, width);
      roadMesh.userData.roadStamp = stamp;
      updateRoadGeometry(roadMesh, stamp, elevation + ROAD_SURFACE_EPSILON);
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

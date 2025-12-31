import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

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
const DEFAULT_ELEVATION = 0.02;
const METERS_PER_DEGREE_LAT = 111_132.92;
const ROAD_REPEAT_METERS = 6;

const textureLoader = new THREE.TextureLoader();

function loadRoadTexture(url) {
  const texture = textureLoader.load(url);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  if (texture.colorSpace !== undefined) {
    texture.colorSpace = THREE.SRGBColorSpace;
  }
  return texture;
}

const roadTexture = loadRoadTexture(
  "/assets/textures/sandy_gravel_02_4k.blend/textures/sandy_gravel_02_diff_4k.jpg"
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
  elevation = DEFAULT_ELEVATION
} = {}) {
  const group = new THREE.Group();
  group.name = "osm-highways";
  scene?.add(group);

  const roadMaterial = new THREE.MeshStandardMaterial({
    map: roadTexture,
    roughness: 0.9,
    metalness: 0.0
  });

  const roadMesh = new THREE.Mesh(new THREE.BufferGeometry(), roadMaterial);
  roadMesh.name = "osm-road-mesh";
  roadMesh.receiveShadow = true;
  group.add(roadMesh);

  function disposeGeometry(mesh) {
    if (mesh.geometry) {
      mesh.geometry.dispose();
    }
  }

  function applySegmentUVs(geometry, length, width) {
    const uScale = Math.max(length / ROAD_REPEAT_METERS, 1);
    const vScale = Math.max(width / ROAD_REPEAT_METERS, 1);
    const uv = geometry.attributes.uv;
    for (let i = 0; i < uv.count; i += 1) {
      uv.setXY(i, uv.getX(i) * uScale, uv.getY(i) * vScale);
    }
  }

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
    const segmentGeometries = [];

    for (const line of lines) {
      const coords = line.coords ?? [];
      if (coords.length < 2) continue;
      const width = resolveLineWidth(line.highway);
      for (let i = 0; i < coords.length - 1; i += 1) {
        const start = coords[i];
        const end = coords[i + 1];
        if (!start || !end || start.length < 2 || end.length < 2) continue;
        const startLocal = toLocalMeters(start, bounds, lonScale);
        const endLocal = toLocalMeters(end, bounds, lonScale);
        const dx = endLocal.x - startLocal.x;
        const dz = endLocal.z - startLocal.z;
        const length = Math.hypot(dx, dz);
        if (!Number.isFinite(length) || length <= 0.001) continue;
        const angle = Math.atan2(dz, dx);
        const midX = (startLocal.x + endLocal.x) * 0.5;
        const midZ = (startLocal.z + endLocal.z) * 0.5;
        const geometry = new THREE.PlaneGeometry(length, width, 1, 1);
        applySegmentUVs(geometry, length, width);
        geometry.rotateX(-Math.PI / 2);
        geometry.rotateY(angle);
        geometry.translate(midX, elevation, midZ);
        segmentGeometries.push(geometry);
      }
    }

    disposeGeometry(roadMesh);

    if (segmentGeometries.length > 0) {
      const merged = mergeGeometries(segmentGeometries, false);
      merged.computeBoundingSphere();
      roadMesh.geometry = merged;
      roadMesh.visible = true;
    } else {
      roadMesh.geometry = new THREE.BufferGeometry();
      roadMesh.visible = false;
    }

    for (const geometry of segmentGeometries) {
      geometry.dispose();
    }
  }

  function dispose() {
    disposeGeometry(roadMesh);
    roadMaterial.dispose();
    roadTexture.dispose();
    group.clear();
    scene?.remove(group);
  }

  return {
    group,
    updateHighways,
    dispose
  };
}

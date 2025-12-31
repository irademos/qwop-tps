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
const DEFAULT_ELEVATION = 0.02;
const ROAD_TEXTURE_URL =
  "/assets/textures/sandy_gravel_02_4k.blend/textures/sandy_gravel_02_diff_4k.jpg";
const ROAD_TEXTURE_LENGTH_METERS = 4;
const ROAD_TEXTURE_WIDTH_METERS = 2;
const METERS_PER_DEGREE_LAT = 111_132.92;

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
  elevation = DEFAULT_ELEVATION
} = {}) {
  const group = new THREE.Group();
  group.name = "osm-highways";
  scene?.add(group);

  const textureLoader = new THREE.TextureLoader();
  const roadTexture = textureLoader.load(ROAD_TEXTURE_URL);
  roadTexture.wrapS = THREE.RepeatWrapping;
  roadTexture.wrapT = THREE.RepeatWrapping;
  if (roadTexture.colorSpace !== undefined) {
    roadTexture.colorSpace = THREE.SRGBColorSpace;
  }

  const roadMaterial = new THREE.MeshStandardMaterial({
    map: roadTexture,
    roughness: 0.9,
    metalness: 0.05
  });

  const roadMesh = new THREE.Mesh(new THREE.BufferGeometry(), roadMaterial);
  roadMesh.receiveShadow = true;
  group.add(roadMesh);

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
    const normals = [];
    const uvs = [];

    for (const line of lines) {
      if (!line.coords || line.coords.length < 2) continue;
      const width = resolveLineWidth(line.highway);
      const halfWidth = width / 2;
      let previous = null;
      let distanceAlong = 0;

      for (const coord of line.coords) {
        if (!coord || coord.length < 2) continue;
        const [lon, lat] = coord;
        if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
        const local = toLocalMeters([lon, lat], bounds, lonScale);
        if (previous) {
          const dx = local.x - previous.x;
          const dz = local.z - previous.z;
          const segmentLength = Math.hypot(dx, dz);
          if (segmentLength > 0.001) {
            const nx = -dz / segmentLength;
            const nz = dx / segmentLength;
            const ax = previous.x + nx * halfWidth;
            const az = previous.z + nz * halfWidth;
            const bx = previous.x - nx * halfWidth;
            const bz = previous.z - nz * halfWidth;
            const cx = local.x + nx * halfWidth;
            const cz = local.z + nz * halfWidth;
            const dx2 = local.x - nx * halfWidth;
            const dz2 = local.z - nz * halfWidth;

            const u0 = distanceAlong / ROAD_TEXTURE_LENGTH_METERS;
            const u1 = (distanceAlong + segmentLength) / ROAD_TEXTURE_LENGTH_METERS;
            const v0 = 0;
            const v1 = width / ROAD_TEXTURE_WIDTH_METERS;

            positions.push(
              ax,
              elevation,
              az,
              bx,
              elevation,
              bz,
              cx,
              elevation,
              cz,
              bx,
              elevation,
              bz,
              dx2,
              elevation,
              dz2,
              cx,
              elevation,
              cz
            );

            for (let i = 0; i < 6; i += 1) {
              normals.push(0, 1, 0);
            }

            uvs.push(
              u0,
              v0,
              u0,
              v1,
              u1,
              v0,
              u0,
              v1,
              u1,
              v1,
              u1,
              v0
            );

            distanceAlong += segmentLength;
          }
        }
        previous = local;
      }
    }

    if (positions.length === 0) {
      roadMesh.visible = false;
      return;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geometry.computeBoundingSphere();

    roadMesh.geometry.dispose();
    roadMesh.geometry = geometry;
    roadMesh.visible = true;
  }

  function setResolution() {
    return;
  }

  function dispose() {
    roadMesh.geometry.dispose();
    roadMaterial.dispose();
    group.remove(roadMesh);
    scene?.remove(group);
  }

  if (renderer) {
    renderer.getSize(new THREE.Vector2());
  }

  return {
    group,
    updateHighways,
    setResolution,
    dispose
  };
}

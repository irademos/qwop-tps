import * as THREE from "three";
// import { BufferGeometryUtils } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

const METERS_PER_DEGREE_LAT = 111_132.92;
const DEFAULT_HEIGHT = 10;
const LEVEL_HEIGHT = 3;
const EXTRUDE_DISTANCE = 250;
const BASE_ELEVATION = 0.0;

// --- building texture ---
const textureLoader = new THREE.TextureLoader();

function loadTex(url, { srgb = false, repeat = 2 } = {}) {
  const tex = textureLoader.load(url);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  if (srgb && tex.colorSpace !== undefined) tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
const repeat_val = 0.05;

const buildingBase = loadTex(
  "/assets/textures/rustic_stone_wall_02_4k.blend/textures/rustic_stone_wall_02_diff_4k.jpg",
  { srgb: true, repeat: repeat_val }
);

// Optional maps (use if you have them)
const buildingNormal = loadTex(
  "/assets/textures/rustic_stone_wall_02_4k.blend/textures/rustic_stone_wall_02_nor_gl_4k.jpg",
  { repeat: repeat_val }
);
const buildingRough = loadTex(
  "/assets/textures/rustic_stone_wall_02_4k.blend/textures/rustic_stone_wall_02_rough_4k.jpg",
  { repeat: repeat_val }
);
// const buildingAO = loadTex(
//   "/assets/textures/rustic_stone_wall_02_4k.blend/textures/rustic_stone_wall_02_ao_4k.jpg",
//   { repeat: repeat_val }
// );

function metersPerDegreeLon(latDeg) {
  return 111_412.84 * Math.cos((latDeg * Math.PI) / 180);
}

function toLocalMeters(coord, origin, lonScale) {
  const [lon, lat] = coord;
  return {
    x: (lon - origin.centerLon) * lonScale,
    z: -(lat - origin.centerLat) * METERS_PER_DEGREE_LAT
  };
}

function collectBuildingPolygons(geojson) {
  const polygons = [];
  const features = geojson?.features ?? [];
  for (const feature of features) {
    if (!feature?.properties?.building) continue;
    const geometry = feature.geometry;
    if (!geometry) continue;
    if (geometry.type === "Polygon") {
      polygons.push({ rings: geometry.coordinates, properties: feature.properties });
    } else if (geometry.type === "MultiPolygon") {
      for (const polygon of geometry.coordinates) {
        polygons.push({ rings: polygon, properties: feature.properties });
      }
    }
  }
  return polygons;
}

function computeBoundsFromPolygons(polygons) {
  let minLon = Infinity;
  let maxLon = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  let count = 0;

  for (const polygon of polygons) {
    for (const ring of polygon.rings || []) {
      for (const coord of ring || []) {
        const [lon, lat] = coord;
        if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
        minLon = Math.min(minLon, lon);
        maxLon = Math.max(maxLon, lon);
        minLat = Math.min(minLat, lat);
        maxLat = Math.max(maxLat, lat);
        count += 1;
      }
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

function normalizeRing(ring) {
  if (!ring || ring.length === 0) return [];
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] === last[0] && first[1] === last[1]) {
    return ring.slice(0, -1);
  }
  return ring;
}

function ringToPoints(ring, origin, lonScale) {
  const points = [];
  const coords = normalizeRing(ring);
  for (const coord of coords) {
    if (!coord || coord.length < 2) continue;
    const local = toLocalMeters(coord, origin, lonScale);
    points.push(new THREE.Vector2(local.x, -local.z));
  }
  return points;
}

function makeShape(rings, origin, lonScale) {
  if (!rings || rings.length === 0) return null;
  const outerPoints = ringToPoints(rings[0], origin, lonScale);
  if (outerPoints.length < 3) return null;
  const shape = new THREE.Shape(outerPoints);
  for (let i = 1; i < rings.length; i += 1) {
    const holePoints = ringToPoints(rings[i], origin, lonScale);
    if (holePoints.length < 3) continue;
    const hole = new THREE.Path(holePoints);
    shape.holes.push(hole);
  }
  return shape;
}

function estimateCentroid(points) {
  if (!points || points.length === 0) return new THREE.Vector2();
  let sumX = 0;
  let sumY = 0;
  for (const point of points) {
    sumX += point.x;
    sumY += point.y;
  }
  return new THREE.Vector2(sumX / points.length, sumY / points.length);
}

function resolveHeight(properties = {}) {
  if (properties.height != null) {
    const parsed = parseFloat(properties.height);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  if (properties["building:levels"] != null) {
    const parsed = parseFloat(properties["building:levels"]);
    if (Number.isFinite(parsed)) {
      return parsed * LEVEL_HEIGHT;
    }
  }
  return DEFAULT_HEIGHT;
}

export function createBuildingsRenderer({ scene, camera } = {}) {
  const group = new THREE.Group();
  group.name = "osm-buildings";
  scene?.add(group);

  const extrudedMaterial = new THREE.MeshStandardMaterial({
    map: buildingBase,
    normalMap: buildingNormal,
    roughnessMap: buildingRough,
    roughness: 1.0,
    metalness: 0.0
    // aoMap: buildingAO, // if you enable AO, see uv2 note below
  });

  const flatMaterial = new THREE.MeshStandardMaterial({
    color: 0x9b9b9b,
    roughness: 0.95,
    metalness: 0.0
  });

  const extrudedMesh = new THREE.Mesh(new THREE.BufferGeometry(), extrudedMaterial);
  const flatMesh = new THREE.Mesh(new THREE.BufferGeometry(), flatMaterial);
  extrudedMesh.castShadow = true;
  extrudedMesh.receiveShadow = true;
  flatMesh.receiveShadow = true;
  extrudedMesh.userData.isBuildingSolid = true;
  flatMesh.userData.isBuildingSurface = true;

  group.add(extrudedMesh);
  group.add(flatMesh);

  function disposeGeometry(mesh) {
    if (mesh.geometry) {
      mesh.geometry.dispose();
    }
  }

  function updateBuildings(geojson, boundsOverride) {
    const polygons = collectBuildingPolygons(geojson);
    if (polygons.length === 0) {
      extrudedMesh.visible = false;
      flatMesh.visible = false;
      return;
    }

    const bounds = boundsOverride ?? computeBoundsFromPolygons(polygons);
    if (!bounds) {
      extrudedMesh.visible = false;
      flatMesh.visible = false;
      return;
    }

    const lonScale = metersPerDegreeLon(bounds.centerLat);
    const cameraPos = camera?.position ?? new THREE.Vector3();

    const extrudedGeometries = [];
    const flatGeometries = [];

    for (const polygon of polygons) {
      const shape = makeShape(polygon.rings, bounds, lonScale);
      if (!shape) continue;

      const centroid = estimateCentroid(shape.getPoints());
      const dx = centroid.x - cameraPos.x;
      const dz = -centroid.y - cameraPos.z;
      const distance = Math.hypot(dx, dz);
      const height = resolveHeight(polygon.properties);

      if (distance <= EXTRUDE_DISTANCE) {
        const geometry = new THREE.ExtrudeGeometry(shape, {
          depth: height,
          bevelEnabled: false
        });
        geometry.rotateX(-Math.PI / 2);
        geometry.translate(0, BASE_ELEVATION, 0);
        extrudedGeometries.push(geometry);
      } else {
        const geometry = new THREE.ShapeGeometry(shape);
        geometry.rotateX(-Math.PI / 2);
        geometry.translate(0, BASE_ELEVATION, 0);
        flatGeometries.push(geometry);
      }
    }

    disposeGeometry(extrudedMesh);
    disposeGeometry(flatMesh);

    if (extrudedGeometries.length > 0) {
      const merged = mergeGeometries(extrudedGeometries, false);
      merged.computeBoundingSphere();
      // if (merged.attributes.uv && !merged.attributes.uv2) {
      //   merged.setAttribute("uv2", merged.attributes.uv);
      // }

      extrudedMesh.geometry = merged;
      extrudedMesh.visible = true;
    } else {
      extrudedMesh.geometry = new THREE.BufferGeometry();
      extrudedMesh.visible = false;
    }

    if (flatGeometries.length > 0) {
      const merged = mergeGeometries(flatGeometries, false);
      merged.computeBoundingSphere();
      // if (merged.attributes.uv && !merged.attributes.uv2) {
      //   merged.setAttribute("uv2", merged.attributes.uv);
      // }

      flatMesh.geometry = merged;
      flatMesh.visible = true;
    } else {
      flatMesh.geometry = new THREE.BufferGeometry();
      flatMesh.visible = false;
    }

    for (const geometry of extrudedGeometries) {
      geometry.dispose();
    }
    for (const geometry of flatGeometries) {
      geometry.dispose();
    }
  }

  function dispose() {
    disposeGeometry(extrudedMesh);
    disposeGeometry(flatMesh);
    extrudedMaterial.dispose();
    flatMaterial.dispose();
    group.clear();
    scene?.remove(group);
  }

  return {
    group,
    updateBuildings,
    getCollisionMesh: () => (extrudedMesh.visible ? extrudedMesh : null),
    dispose
  };
}

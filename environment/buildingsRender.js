import * as THREE from "three";
// import { BufferGeometryUtils } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import ClipperLib from "clipper-lib";
import { Brush, Evaluator, SUBTRACTION } from "three-bvh-csg";
import { getKtx2Loader } from "../ktx2Loader.js";
import { clearClimbableAreas, setClimbableAreas } from "../controls/climb.js";
import { clearTerrainFlatteningForSource, registerTerrainBuildingFootprints } from "./water.js";

const METERS_PER_DEGREE_LAT = 111_132.92;
const DEFAULT_HEIGHT = 10;
const LEVEL_HEIGHT = 3;
const EXTRUDE_DISTANCE = 250;
const BASE_ELEVATION = 0.0;
const CLIPPER_SCALE = 10000;

// Shell params
const WALL_THICKNESS = 0.5;
const CUT_DEPTH = WALL_THICKNESS + 0.35; // clear wall reliably
const FLOOR_THICKNESS = 0.05;
const ROOF_THICKNESS = 0.05;
// --- building texture ---
const QUALITY_TIER_OPTIONS = ["low", "medium", "high"];

function getRingWinding(points) {
  let sum = 0;
  const count = points.length;
  for (let i = 0; i < count; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % count];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum;
}

function resolveBuildingQualityTier() {
  if (typeof window === "undefined") return "high";
  const override =
    window?.gameSettings?.buildingQualityTier ??
    window?.gameSettings?.graphics?.buildingQualityTier ??
    window?.localStorage?.getItem("buildingQualityTier") ??
    window?.buildingQualityTier;
  if (override && QUALITY_TIER_OPTIONS.includes(override)) return override;

  const dpr = window.devicePixelRatio ?? 1;
  const cores = navigator?.hardwareConcurrency ?? 4;
  if (dpr <= 1.25 && cores <= 4) return "low";
  if (dpr <= 1.75 && cores <= 6) return "medium";
  return "high";
}

const BUILDING_QUALITY = resolveBuildingQualityTier();
const BUILDING_QUALITY_SETTINGS = {
  high: {
    useNormalRoughness: true,
    fullDetailDistance: EXTRUDE_DISTANCE,
    simpleDetailDistance: EXTRUDE_DISTANCE * 1.5,
    enableHollow: true,
    enableCsg: true
  },
  medium: {
    useNormalRoughness: false,
    fullDetailDistance: EXTRUDE_DISTANCE * 0.75,
    simpleDetailDistance: EXTRUDE_DISTANCE * 1.25,
    enableHollow: true,
    enableCsg: false
  },
  low: {
    useNormalRoughness: false,
    fullDetailDistance: 0,
    simpleDetailDistance: EXTRUDE_DISTANCE,
    enableHollow: false,
    enableCsg: false
  }
};

function applyKtx2ToMaterial(ktx2, material, slot, url, { srgb = false, repeat = 2, anisotropy = null } = {}) {
  if (!material || !slot || !url) return;

  ktx2.load(
    url,
    (tex) => {
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(repeat, repeat);
      if (anisotropy) tex.anisotropy = anisotropy;
      if (srgb && tex.colorSpace !== undefined) tex.colorSpace = THREE.SRGBColorSpace;

      material[slot] = tex;
      material.needsUpdate = true;
    },
    undefined,
    (err) => console.warn("KTX2 load failed:", slot, url, err)
  );
}

const repeat_val = 0.05;

const buildingTextureBasePath = "/assets/textures/planks/planks";

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

function collectBuildingPolygons(geojson) {
  const polygons = [];
  const features = geojson?.prefiltered?.buildings ?? geojson?.features ?? [];
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

  if (!Number.isFinite(minLon) || count === 0) return null;

  return {
    centerLon: (minLon + maxLon) / 2,
    centerLat: (minLat + maxLat) / 2
  };
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
    if (Number.isFinite(parsed)) return parsed;
  }
  if (properties["building:levels"] != null) {
    const parsed = parseFloat(properties["building:levels"]);
    if (Number.isFinite(parsed)) return parsed * LEVEL_HEIGHT;
  }
  return DEFAULT_HEIGHT;
}

// ----------------------
// Clipper helpers (2D inset)
// ----------------------
function v2ToClipperPath(points) {
  return points.map(p => ({
    X: Math.round(p.x * CLIPPER_SCALE),
    Y: Math.round(p.y * CLIPPER_SCALE)
  }));
}

function clipperPathToV2(path) {
  return path.map(p => new THREE.Vector2(p.X / CLIPPER_SCALE, p.Y / CLIPPER_SCALE));
}

// IMPORTANT: use shape.getPoints() (outer) and ensure no duplicate last point for Clipper
function insetShapeOuterRing(shape2D, insetMeters) {
  const outer = shape2D.getPoints();
  if (!outer || outer.length < 3) return null;

  const subj = [v2ToClipperPath(outer)];
  const co = new ClipperLib.ClipperOffset(2, 0.25 * CLIPPER_SCALE);
  co.AddPaths(subj, ClipperLib.JoinType.jtMiter, ClipperLib.EndType.etClosedPolygon);

  const solution = new ClipperLib.Paths();
  co.Execute(solution, -insetMeters * CLIPPER_SCALE);

  if (!solution || solution.length === 0) return null;

  // choose largest polygon
  let best = solution[0];
  let bestArea = Math.abs(ClipperLib.Clipper.Area(best));
  for (let i = 1; i < solution.length; i++) {
    const a = Math.abs(ClipperLib.Clipper.Area(solution[i]));
    if (a > bestArea) {
      best = solution[i];
      bestArea = a;
    }
  }

  const pts = clipperPathToV2(best);
  if (pts.length < 3) return null;

  return new THREE.Shape(pts);
}

// ----------------------
// CSG helpers
// ----------------------
function csgSubtractGeom(baseGeom, cutterGeoms) {
  if (!cutterGeoms?.length) return baseGeom;

  const mergedCutters = mergeGeometries(cutterGeoms, false);
  const evaluator = new Evaluator();

  const a = new Brush(baseGeom);
  const b = new Brush(mergedCutters);

  const result = evaluator.evaluate(a, b, SUBTRACTION);

  mergedCutters.dispose();
  baseGeom.dispose();

  // ✅ ensure bbox/sphere exist on the returned geometry
  result.geometry.computeBoundingBox();
  result.geometry.computeBoundingSphere();

  return result.geometry;
}

function hollowExtrudedGeometry(outerGeom, originalShape2D, {
  wall = WALL_THICKNESS,
  floor = FLOOR_THICKNESS,
  roof = ROOF_THICKNESS
} = {}) {
  // outerGeom MUST have bbox
  if (!outerGeom.boundingBox) outerGeom.computeBoundingBox();

  const innerShape = insetShapeOuterRing(originalShape2D, wall);
  if (!innerShape) return outerGeom; // too small to inset

  // height axis after rotateX(-pi/2) is Y; bbox already reflects that
  const fullH = outerGeom.boundingBox.max.y - outerGeom.boundingBox.min.y;
  const innerH = Math.max(0.1, fullH - floor - roof);

  const innerGeom = new THREE.ExtrudeGeometry(innerShape, { depth: innerH, bevelEnabled: false });
  innerGeom.rotateX(-Math.PI / 2);
  innerGeom.translate(0, BASE_ELEVATION + floor, 0);
  innerGeom.computeBoundingBox();

  // outer - inner
  return csgSubtractGeom(outerGeom, [innerGeom]);
}

function buildDoorCuttersFromShape(shape2D, {
  doorW = 3.0,
  doorH = 2.2,
  doorSpacing = 8,
  inset = 0.02
} = {}) {
  const cutters = [];
  const points2D = shape2D?.getPoints?.() ?? [];
  if (points2D.length < 2) return cutters;
  const winding = getRingWinding(points2D);
  const yDoorCenter = doorH * 0.5;
  const outwardFactor = CUT_DEPTH * 0.5 - inset;

  for (let i = 0; i < points2D.length; i += 1) {
    const a2 = points2D[i];
    const b2 = points2D[(i + 1) % points2D.length];
    const ax = a2.x;
    const az = -a2.y;
    const bx = b2.x;
    const bz = -b2.y;
    const edgeVec = new THREE.Vector3(bx - ax, 0, bz - az);
    const edgeLen = edgeVec.length();
    if (edgeLen < 0.1) continue;

    const doorSpan = doorW;//Math.min(doorW, edgeLen);
    if (doorSpan <= 0.01) continue;

    const edgeDir = edgeVec.clone().normalize();
    const leftNormal = new THREE.Vector3(-edgeDir.z, 0, edgeDir.x);
    const rightNormal = new THREE.Vector3(edgeDir.z, 0, -edgeDir.x);
    const outward = (winding >= 0 ? rightNormal : leftNormal).normalize();
    const spacing = Math.max(doorSpacing, doorSpan * 1.2);
    const count = Math.max(1, Math.floor(edgeLen / spacing));
    const rotationY = Math.atan2(edgeDir.x, edgeDir.z);

    for (let j = 0; j < count; j += 1) {
      const t = (count === 1) ? 0.5 : (j + 1) / (count + 1);
      const center = new THREE.Vector3(ax, 0, az)
        .addScaledVector(edgeDir, edgeLen * t)
        .addScaledVector(outward, outwardFactor);
      const g = new THREE.BoxGeometry(CUT_DEPTH, doorH, doorSpan);
      g.applyMatrix4(new THREE.Matrix4().makeRotationY(rotationY));
      g.applyMatrix4(new THREE.Matrix4().makeTranslation(center.x, yDoorCenter, center.z));
      cutters.push(g);
    }
  }

  return cutters;
}

export function createBuildingsRenderer({ scene, camera, renderer } = {}) {
  const group = new THREE.Group();
  group.name = "osm-buildings";
  scene?.add(group);

  setClimbableAreas("buildings", []);

  const qualitySettings = BUILDING_QUALITY_SETTINGS[BUILDING_QUALITY];
  const ktx2 = getKtx2Loader(renderer);
  const maxAnisotropy = renderer?.capabilities?.getMaxAnisotropy?.() ?? null;
  const extrudedMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 1.0,
    metalness: 0.0,
    emissive: 0x1a1a1a,
    emissiveIntensity: 0.2
  });

  applyKtx2ToMaterial(
    ktx2,
    extrudedMaterial,
    "map",
    `${buildingTextureBasePath}_albedo.ktx2`,
    { srgb: true, repeat: repeat_val, anisotropy: maxAnisotropy }
  );

  if (qualitySettings.useNormalRoughness) {
    applyKtx2ToMaterial(
      ktx2,
      extrudedMaterial,
      "normalMap",
      `${buildingTextureBasePath}_normal.ktx2`,
      { repeat: repeat_val, anisotropy: maxAnisotropy }
    );

    applyKtx2ToMaterial(
      ktx2,
      extrudedMaterial,
      "roughnessMap",
      `${buildingTextureBasePath}_roughness.ktx2`,
      { repeat: repeat_val, anisotropy: maxAnisotropy }
    );
  }


  extrudedMaterial.needsUpdate = true;

  const flatMaterial = new THREE.MeshStandardMaterial({ /* ... */ });

  const tileMeshes = new Map();
  function disposeGeometry(mesh) {
    if (mesh.geometry) mesh.geometry.dispose();
  }

  function createTileMeshes(tileKey) {
    const tileGroup = new THREE.Group();
    tileGroup.name = `osm-buildings-${tileKey}`;

    const extrudedMesh = new THREE.Mesh(new THREE.BufferGeometry(), extrudedMaterial);
    const flatMesh = new THREE.Mesh(new THREE.BufferGeometry(), flatMaterial);
    extrudedMesh.userData.isBuildingSolid = true;
    flatMesh.userData.isBuildingSolid = true;

    const extrudedColliderMesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial());
    extrudedColliderMesh.visible = false;
    extrudedColliderMesh.name = `extruded-collider-${tileKey}`;

    const collisionGroup = new THREE.Group();
    collisionGroup.name = `building-collision-${tileKey}`;
    collisionGroup.add(extrudedColliderMesh);

    tileGroup.add(extrudedMesh);     // render
    tileGroup.add(flatMesh);         // render
    tileGroup.add(collisionGroup);   // collision only
    group.add(tileGroup);

    return {
      group: tileGroup,
      extrudedMesh,
      flatMesh,
      extrudedColliderMesh,
      collisionGroup
    };
  }

  function ensureTile(tileKey) {
    let entry = tileMeshes.get(tileKey);
    if (entry) return entry;
    entry = createTileMeshes(tileKey);
    tileMeshes.set(tileKey, entry);
    return entry;
  }

  function updateTileBuildings(tileKey, geojson, boundsOverride) {
    if (!tileKey) return null;
    const tileEntry = ensureTile(tileKey);
    const { extrudedMesh, flatMesh, extrudedColliderMesh } = tileEntry;

    const polygons = collectBuildingPolygons(geojson);
    if (polygons.length === 0) {
      disposeGeometry(extrudedMesh);
      disposeGeometry(flatMesh);
      disposeGeometry(extrudedColliderMesh);
      extrudedMesh.geometry = new THREE.BufferGeometry();
      flatMesh.geometry = new THREE.BufferGeometry();
      extrudedColliderMesh.geometry = new THREE.BufferGeometry();
      extrudedMesh.visible = false;
      flatMesh.visible = false;
      extrudedColliderMesh.visible = false;
      clearTerrainFlatteningForSource(`buildings:${tileKey}:buildings`);
      return tileEntry;
    }

    const bounds = boundsOverride ?? computeBoundsFromPolygons(polygons);
    if (!bounds) {
      disposeGeometry(extrudedMesh);
      disposeGeometry(flatMesh);
      disposeGeometry(extrudedColliderMesh);
      extrudedMesh.geometry = new THREE.BufferGeometry();
      flatMesh.geometry = new THREE.BufferGeometry();
      extrudedColliderMesh.geometry = new THREE.BufferGeometry();
      extrudedMesh.visible = false;
      flatMesh.visible = false;
      extrudedColliderMesh.visible = false;
      clearTerrainFlatteningForSource(`buildings:${tileKey}:buildings`);
      return tileEntry;
    }

    const lonScale = metersPerDegreeLon(bounds.centerLat);
    const cameraPos = camera?.position ?? new THREE.Vector3();

    const flatGeometries = [];
    const extrudedResults = [];
    const terrainFootprints = [];
    for (const polygon of polygons) {
      const shape = makeShape(polygon.rings, bounds, lonScale);
      if (!shape) continue;

      const outerPoints = shape.getPoints();
      if (outerPoints.length >= 3) {
        terrainFootprints.push(outerPoints.map((pt) => ({ x: pt.x, z: -pt.y })));
      }
      const centroid = estimateCentroid(outerPoints);
      const dx = centroid.x - cameraPos.x;
      const dz = -centroid.y - cameraPos.z;
      const distance = Math.hypot(dx, dz);
      const height = resolveHeight(polygon.properties);

      const isFullDetail = distance <= qualitySettings.fullDetailDistance;
      const isSimpleDetail = !isFullDetail && distance <= qualitySettings.simpleDetailDistance;

      if (isFullDetail || isSimpleDetail) {
        // 1) Outer solid
        let geom = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false });
        geom.rotateX(-Math.PI / 2);
        geom.translate(0, BASE_ELEVATION, 0);
        geom.computeBoundingBox();

        if (isFullDetail && qualitySettings.enableHollow) {
          // 2) Hollow it (shell)
          geom = hollowExtrudedGeometry(geom, shape, {
            wall: WALL_THICKNESS,
            floor: FLOOR_THICKNESS,
            roof: ROOF_THICKNESS
          });
          if (!geom.boundingBox) geom.computeBoundingBox();
        }

        if (isFullDetail && qualitySettings.enableCsg) {
          const cutters = buildDoorCuttersFromShape(shape, {
            doorW: 3.0,
            doorH: 3.0,
            doorSpacing: 12
          });

          if (cutters.length) {
            geom = csgSubtractGeom(geom, cutters);
            geom.computeBoundingBox();
            for (const g of cutters) g.dispose();
          }
        }

        extrudedResults.push(geom);
      } else {
        const geom = new THREE.ShapeGeometry(shape);
        geom.rotateX(-Math.PI / 2);
        geom.translate(0, BASE_ELEVATION, 0);
        flatGeometries.push(geom);
      }
    }

    disposeGeometry(extrudedMesh);
    disposeGeometry(flatMesh);
    registerTerrainBuildingFootprints(`buildings:${tileKey}`, terrainFootprints);

    if (extrudedResults.length > 0) {
      const merged = mergeGeometries(extrudedResults, false);
      merged.computeBoundingSphere();

      extrudedMesh.geometry = merged;               // render
      extrudedColliderMesh.geometry = merged.clone(); // collision (clone to avoid shared dispose issues)

      extrudedMesh.visible = true;
      extrudedColliderMesh.visible = false;

      for (const g of extrudedResults) g.dispose();
    } else {
      extrudedMesh.geometry = new THREE.BufferGeometry();
      extrudedColliderMesh.geometry = new THREE.BufferGeometry();
      extrudedMesh.visible = false;
    }


    if (flatGeometries.length > 0) {
      const merged = mergeGeometries(flatGeometries, false);
      merged.computeBoundingSphere();
      flatMesh.geometry = merged;
      flatMesh.visible = true;
      for (const g of flatGeometries) g.dispose();
    } else {
      flatMesh.geometry = new THREE.BufferGeometry();
      flatMesh.visible = false;
    }

    return tileEntry;
  }

  function removeTile(tileKey) {
    const entry = tileMeshes.get(tileKey);
    if (!entry) return;
    clearTerrainFlatteningForSource(`buildings:${tileKey}:buildings`);
    disposeGeometry(entry.extrudedMesh);
    disposeGeometry(entry.flatMesh);
    disposeGeometry(entry.extrudedColliderMesh);
    entry.group.clear();
    group.remove(entry.group);
    tileMeshes.delete(tileKey);
  }

  function clearTiles() {
    for (const tileKey of tileMeshes.keys()) {
      removeTile(tileKey);
    }
  }

  function dispose() {
    for (const tileKey of tileMeshes.keys()) {
      removeTile(tileKey);
    }
    extrudedMaterial.dispose();
    flatMaterial.dispose();
    group.clear();
    scene?.remove(group);
    clearClimbableAreas("buildings");
  }

  return {
    group,
    materials: {
      extruded: extrudedMaterial,
      flat: flatMaterial
    },
    updateTileBuildings,
    removeTile,
    clearTiles,
    getCollisionMesh: () => group,
    getCollisionMeshes: () => {
      const meshes = [];
      for (const entry of tileMeshes.values()) {
        if (entry.extrudedColliderMesh.geometry?.attributes?.position?.count) {
          meshes.push(entry.extrudedColliderMesh);
        }
      }
      return meshes;
    },
    dispose
  };
}

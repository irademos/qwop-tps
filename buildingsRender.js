import * as THREE from "three";
// import { BufferGeometryUtils } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import ClipperLib from "clipper-lib";
import { Brush, Evaluator, SUBTRACTION } from "three-bvh-csg";

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
const CLIMB_WALL_DEPTH = 0.6;

// --- building texture ---
const textureLoader = new THREE.TextureLoader();
const QUALITY_TIER_OPTIONS = ["low", "medium", "high"];

const SIDES = ["+Z", "-Z", "+X", "-X"];

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

function buildWallClimbAreas(shape2D, bottomY, topY) {
  const points2D = shape2D.getPoints();
  if (points2D.length < 2) return [];
  const winding = getRingWinding(points2D);
  const midY = (bottomY + topY) * 0.5;
  const areas = [];

  for (let i = 0; i < points2D.length; i += 1) {
    const a = points2D[i];
    const b = points2D[(i + 1) % points2D.length];
    const ax = a.x;
    const az = -a.y;
    const bx = b.x;
    const bz = -b.y;
    const edgeVec = new THREE.Vector3(bx - ax, 0, bz - az);
    const edgeLen = edgeVec.length();
    if (edgeLen < 0.1) continue;

    const edgeDir = edgeVec.clone().normalize();
    const leftNormal = new THREE.Vector3(-edgeDir.z, 0, edgeDir.x);
    const rightNormal = new THREE.Vector3(edgeDir.z, 0, -edgeDir.x);
    const outward = (winding >= 0 ? rightNormal : leftNormal).normalize();
    const rotationY = Math.atan2(outward.x, outward.z);

    const center = new THREE.Vector3((ax + bx) * 0.5, midY, (az + bz) * 0.5)
      .addScaledVector(outward, WALL_THICKNESS * 0.5);

    areas.push({
      center,
      rotationY,
      halfWidth: edgeLen * 0.5,
      halfDepth: CLIMB_WALL_DEPTH * 0.5,
      halfHeight: (topY - bottomY) * 0.5,
      minY: bottomY,
      maxY: topY,
      normal: outward.clone()
    });
  }

  return areas;
}


// quick per-building “random” (stable-ish) based on footprint + height
function pickDisabledSide(polygon, height) {
  const ring = polygon?.rings?.[0] ?? [];
  if (!ring.length) return SIDES[(Math.random() * SIDES.length) | 0];

  // hash a few points + height
  let h = (height * 1000) | 0;
  for (let i = 0; i < ring.length; i += Math.max(1, (ring.length / 6) | 0)) {
    const [lon, lat] = ring[i];
    h = (h * 1664525 + ((lon * 1e6) | 0) + ((lat * 1e6) | 0) + 1013904223) | 0;
  }
  const idx = (h >>> 0) % SIDES.length;
  return SIDES[idx];
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
    textureTargetSize: null,
    useNormalRoughness: true,
    fullDetailDistance: EXTRUDE_DISTANCE,
    simpleDetailDistance: EXTRUDE_DISTANCE * 1.5,
    enableHollow: true,
    enableCsg: true
  },
  medium: {
    textureTargetSize: 1024,
    useNormalRoughness: false,
    fullDetailDistance: EXTRUDE_DISTANCE * 0.75,
    simpleDetailDistance: EXTRUDE_DISTANCE * 1.25,
    enableHollow: true,
    enableCsg: false
  },
  low: {
    textureTargetSize: 512,
    useNormalRoughness: false,
    fullDetailDistance: 0,
    simpleDetailDistance: EXTRUDE_DISTANCE,
    enableHollow: false,
    enableCsg: false
  }
};

function loadTex(url, { srgb = false, repeat = 2, targetSize = null } = {}) {
  const tex = textureLoader.load(url, (loaded) => {
    if (!targetSize || !loaded?.image?.width) return;
    const { width, height } = loaded.image;
    if (width <= targetSize && height <= targetSize) return;
    const canvas = document.createElement("canvas");
    const scale = Math.min(targetSize / width, targetSize / height);
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(loaded.image, 0, 0, canvas.width, canvas.height);
    loaded.image = canvas;
    loaded.needsUpdate = true;
  });
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  if (srgb && tex.colorSpace !== undefined) tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
const repeat_val = 0.05;

const buildingTextureBasePath =
  "/assets/textures/rustic_stone_wall_02_4k.blend/textures/rustic_stone_wall_02";
const buildingTextureTargetSize = BUILDING_QUALITY_SETTINGS[BUILDING_QUALITY].textureTargetSize;
const buildingBase = loadTex(
  `${buildingTextureBasePath}_diff_4k.jpg`,
  { srgb: true, repeat: repeat_val, targetSize: buildingTextureTargetSize }
);

const buildingNormal = BUILDING_QUALITY_SETTINGS[BUILDING_QUALITY].useNormalRoughness
  ? loadTex(
    `${buildingTextureBasePath}_nor_gl_4k.jpg`,
    { repeat: repeat_val }
  )
  : null;
const buildingRough = BUILDING_QUALITY_SETTINGS[BUILDING_QUALITY].useNormalRoughness
  ? loadTex(
    `${buildingTextureBasePath}_rough_4k.jpg`,
    { repeat: repeat_val }
  )
  : null;

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

// Modify buildWindowDoorCuttersFromBBox to accept a "disabledSide" and skip that wall
function buildWindowDoorCuttersFromBBox(bbox, {
  windowW = 1.0,
  windowH = 1.0,
  windowBottom = 1.2,
  windowSpacing = 2.2,
  doorW = 1.4,
  doorH = 2.2,
  inset = 0.02,
  disabledSide = null // "+Z" | "-Z" | "+X" | "-X"
} = {}) {
  const cutters = [];
  const min = bbox.min, max = bbox.max;
  const sizeX = max.x - min.x;
  const sizeZ = max.z - min.z;

  if (sizeX < windowW * 1.5 || sizeZ < windowW * 1.5) return cutters;

  const yWindowCenter = windowBottom + windowH * 0.5;
  const yDoorCenter = doorH * 0.5;
  // --- door exclusion zones (prevents windows overlapping doors) ---
  const doorTop = doorH;

  // center of the bbox footprint
  const midX = (min.x + max.x) * 0.5;
  const midZ = (min.z + max.z) * 0.5;

  // padding around door opening so nearby windows don't clip
  const doorClearance = 0.35;

  // for ±Z walls, door spans X
  const doorMinX = midX - doorW * 0.5 - doorClearance;
  const doorMaxX = midX + doorW * 0.5 + doorClearance;

  // for ±X walls, door spans Z (use doorW as its horizontal span)
  const doorMinZ = midZ - doorW * 0.5 - doorClearance;
  const doorMaxZ = midZ + doorW * 0.5 + doorClearance;


  function addWindowsOnZWall(zWall, sideTag) {
    if (disabledSide === sideTag) return;

    const usable = sizeX - windowW * 1.2;
    const count = Math.max(1, Math.floor(usable / windowSpacing));
    for (let i = 0; i < count; i++) {
      const t = (count === 1) ? 0.5 : (i + 1) / (count + 1);
      const x = min.x + t * sizeX;

      // Skip windows that would overlap the door area on ±Z walls
      const overlapsDoorZone = (x >= doorMinX && x <= doorMaxX) && (windowBottom < doorTop);
      if (overlapsDoorZone) continue;

      if (x < min.x + 1.0 || x > max.x - 1.0) continue;

      const g = new THREE.BoxGeometry(windowW, windowH, CUT_DEPTH);
      const zCenter = zWall + (zWall === max.z ? -(CUT_DEPTH * 0.5 - inset) : (CUT_DEPTH * 0.5 - inset));
      g.applyMatrix4(new THREE.Matrix4().makeTranslation(x, yWindowCenter, zCenter));
      cutters.push(g);
    }
  }

  function addWindowsOnXWall(xWall, sideTag) {
    if (disabledSide === sideTag) return;

    const usable = sizeZ - windowW * 1.2;
    const count = Math.max(1, Math.floor(usable / windowSpacing));
    for (let i = 0; i < count; i++) {
      const t = (count === 1) ? 0.5 : (i + 1) / (count + 1);
      const z = min.z + t * sizeZ;

      // Skip windows that would overlap the door area on ±X walls
      const overlapsDoorZone = (z >= doorMinZ && z <= doorMaxZ) && (windowBottom < doorTop);
      if (overlapsDoorZone) continue;

      if (z < min.z + 1.0 || z > max.z - 1.0) continue;

      const g = new THREE.BoxGeometry(CUT_DEPTH, windowH, windowW);
      const xCenter = xWall + (xWall === max.x ? -(CUT_DEPTH * 0.5 - inset) : (CUT_DEPTH * 0.5 - inset));
      g.applyMatrix4(new THREE.Matrix4().makeTranslation(xCenter, yWindowCenter, z));
      cutters.push(g);
    }
  }

  addWindowsOnZWall(max.z, "+Z");
  addWindowsOnZWall(min.z, "-Z");
  addWindowsOnXWall(max.x, "+X");
  addWindowsOnXWall(min.x, "-X");

  // Doors (skip disabled side)
  if (disabledSide !== "+Z") {
    const g = new THREE.BoxGeometry(doorW, doorH, CUT_DEPTH);
    g.applyMatrix4(new THREE.Matrix4().makeTranslation(
      (min.x + max.x) * 0.5, yDoorCenter, max.z - (CUT_DEPTH * 0.5 - inset)
    ));
    cutters.push(g);
  }
  if (disabledSide !== "-Z") {
    const g = new THREE.BoxGeometry(doorW, doorH, CUT_DEPTH);
    g.applyMatrix4(new THREE.Matrix4().makeTranslation(
      (min.x + max.x) * 0.5, yDoorCenter, min.z + (CUT_DEPTH * 0.5 - inset)
    ));
    cutters.push(g);
  }
  if (disabledSide !== "+X") {
    const g = new THREE.BoxGeometry(CUT_DEPTH, doorH, doorW);
    g.applyMatrix4(new THREE.Matrix4().makeTranslation(
      max.x - (CUT_DEPTH * 0.5 - inset), yDoorCenter, (min.z + max.z) * 0.5
    ));
    cutters.push(g);
  }
  if (disabledSide !== "-X") {
    const g = new THREE.BoxGeometry(CUT_DEPTH, doorH, doorW);
    g.applyMatrix4(new THREE.Matrix4().makeTranslation(
      min.x + (CUT_DEPTH * 0.5 - inset), yDoorCenter, (min.z + max.z) * 0.5
    ));
    cutters.push(g);
  }

  return cutters;
}

export function createBuildingsRenderer({ scene, camera } = {}) {
  const group = new THREE.Group();
  group.name = "osm-buildings";
  scene?.add(group);

  const qualitySettings = BUILDING_QUALITY_SETTINGS[BUILDING_QUALITY];

  const extrudedMaterial = new THREE.MeshStandardMaterial({
    map: buildingBase,
    normalMap: buildingNormal ?? null,
    roughnessMap: buildingRough ?? null,
    roughness: 1.0,
    metalness: 0.0,
  });

  extrudedMaterial.needsUpdate = true;

  const flatMaterial = new THREE.MeshStandardMaterial({ /* ... */ });

  const tileMeshes = new Map();
  const climbableAreasByTile = new Map();
  const climbableAreas = [];

  function disposeGeometry(mesh) {
    if (mesh.geometry) mesh.geometry.dispose();
  }

  function createTileMeshes(tileKey) {
    const tileGroup = new THREE.Group();
    tileGroup.name = `osm-buildings-${tileKey}`;

    const extrudedMesh = new THREE.Mesh(new THREE.BufferGeometry(), extrudedMaterial);
    const flatMesh = new THREE.Mesh(new THREE.BufferGeometry(), flatMaterial);

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

  function setClimbableAreas(areas) {
    climbableAreas.length = 0;
    climbableAreas.push(...areas);
    window.climbableAreas = climbableAreas;
  }

  function refreshClimbableAreas() {
    const merged = [];
    for (const areas of climbableAreasByTile.values()) {
      merged.push(...areas);
    }
    setClimbableAreas(merged);
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
      climbableAreasByTile.set(tileKey, []);
      refreshClimbableAreas();
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
      climbableAreasByTile.set(tileKey, []);
      refreshClimbableAreas();
      return tileEntry;
    }

    const lonScale = metersPerDegreeLon(bounds.centerLat);
    const cameraPos = camera?.position ?? new THREE.Vector3();

    const flatGeometries = [];
    const extrudedResults = [];
    const wallClimbAreas = [];

    for (const polygon of polygons) {
      const shape = makeShape(polygon.rings, bounds, lonScale);
      if (!shape) continue;

      const centroid = estimateCentroid(shape.getPoints());
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
          const disabledSide = pickDisabledSide(polygon, height);

          const cutters = buildWindowDoorCuttersFromBBox(geom.boundingBox, {
            windowW: 1.0,
            windowH: 1.0,
            windowBottom: 1.3,
            windowSpacing: 2.4,
            doorW: 1.5,
            doorH: 2.3,
            disabledSide
          });

          if (cutters.length) {
            geom = csgSubtractGeom(geom, cutters);
            geom.computeBoundingBox();
            for (const g of cutters) g.dispose();
          }
        }

        if (isFullDetail) {
          wallClimbAreas.push(
            ...buildWallClimbAreas(shape, geom.boundingBox.min.y, geom.boundingBox.max.y)
          );
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

    climbableAreasByTile.set(tileKey, wallClimbAreas);
    refreshClimbableAreas();
    return tileEntry;
  }

  function removeTile(tileKey) {
    const entry = tileMeshes.get(tileKey);
    if (!entry) return;
    disposeGeometry(entry.extrudedMesh);
    disposeGeometry(entry.flatMesh);
    disposeGeometry(entry.extrudedColliderMesh);
    entry.group.clear();
    group.remove(entry.group);
    tileMeshes.delete(tileKey);
    climbableAreasByTile.delete(tileKey);
    refreshClimbableAreas();
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
  }

  return {
    group,
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

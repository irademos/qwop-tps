import * as THREE from "three";
// import { BufferGeometryUtils } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import ClipperLib from "clipper-lib";
import { Brush, Evaluator, SUBTRACTION } from "three-bvh-csg";

const METERS_PER_DEGREE_LAT = 111_132.92;
const DEFAULT_HEIGHT = 10;
const LEVEL_HEIGHT = 3;
const EXTRUDE_DISTANCE = 250;
const BASE_ELEVATION = 0.0;
const DISABLED_OPENINGS_SIDE = "+Z"; // "+Z" | "-Z" | "+X" | "-X" | null
const CLIPPER_SCALE = 10000;

// Shell params
const WALL_THICKNESS = 0.5;
const CUT_DEPTH = WALL_THICKNESS + 0.35; // clear wall reliably
const FLOOR_THICKNESS = 0.05;
const ROOF_THICKNESS = 0.05;
const LADDER_WIDTH = 1.0;
const LADDER_DEPTH = 0.8;
const LADDER_OFFSET = 0.08;

// --- building texture ---
const textureLoader = new THREE.TextureLoader();

const SIDES = ["+Z", "-Z", "+X", "-X"];

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

const buildingNormal = loadTex(
  "/assets/textures/rustic_stone_wall_02_4k.blend/textures/rustic_stone_wall_02_nor_gl_4k.jpg",
  { repeat: repeat_val }
);
const buildingRough = loadTex(
  "/assets/textures/rustic_stone_wall_02_4k.blend/textures/rustic_stone_wall_02_rough_4k.jpg",
  { repeat: repeat_val }
);

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

function buildLadderPlacement(bbox, disabledSide) {
  if (!bbox || !disabledSide) return null;
  const min = bbox.min;
  const max = bbox.max;
  const midX = (min.x + max.x) * 0.5;
  const midZ = (min.z + max.z) * 0.5;
  const bottomY = min.y;
  const topY = max.y;

  let position;
  let rotationY = 0;
  let climbBox;

  switch (disabledSide) {
    case "+Z":
      position = new THREE.Vector3(midX, bottomY, max.z + LADDER_OFFSET);
      rotationY = Math.PI;
      climbBox = new THREE.Box3(
        new THREE.Vector3(midX - LADDER_WIDTH * 0.5, bottomY, max.z),
        new THREE.Vector3(midX + LADDER_WIDTH * 0.5, topY, max.z + LADDER_DEPTH)
      );
      break;
    case "-Z":
      position = new THREE.Vector3(midX, bottomY, min.z - LADDER_OFFSET);
      rotationY = 0;
      climbBox = new THREE.Box3(
        new THREE.Vector3(midX - LADDER_WIDTH * 0.5, bottomY, min.z - LADDER_DEPTH),
        new THREE.Vector3(midX + LADDER_WIDTH * 0.5, topY, min.z)
      );
      break;
    case "+X":
      position = new THREE.Vector3(max.x + LADDER_OFFSET, bottomY, midZ);
      rotationY = -Math.PI / 2;
      climbBox = new THREE.Box3(
        new THREE.Vector3(max.x, bottomY, midZ - LADDER_WIDTH * 0.5),
        new THREE.Vector3(max.x + LADDER_DEPTH, topY, midZ + LADDER_WIDTH * 0.5)
      );
      break;
    case "-X":
      position = new THREE.Vector3(min.x - LADDER_OFFSET, bottomY, midZ);
      rotationY = Math.PI / 2;
      climbBox = new THREE.Box3(
        new THREE.Vector3(min.x - LADDER_DEPTH, bottomY, midZ - LADDER_WIDTH * 0.5),
        new THREE.Vector3(min.x, topY, midZ + LADDER_WIDTH * 0.5)
      );
      break;
    default:
      return null;
  }

  return {
    position,
    rotationY,
    climbBox,
    bottomY,
    topY
  };
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
    metalness: 0.0,
  });

  extrudedMaterial.needsUpdate = true;

  const flatMaterial = new THREE.MeshStandardMaterial({ /* ... */ });

  const extrudedMesh = new THREE.Mesh(new THREE.BufferGeometry(), extrudedMaterial);
  const flatMesh = new THREE.Mesh(new THREE.BufferGeometry(), flatMaterial);

  const extrudedColliderMesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial());
  extrudedColliderMesh.visible = false;
  extrudedColliderMesh.name = "extruded-collider";

  // Collision root owns the solid meshes
  const collisionGroup = new THREE.Group();
  collisionGroup.name = "building-collision";
  collisionGroup.add(extrudedColliderMesh);

  group.add(extrudedMesh);     // render
  group.add(flatMesh);         // render
  group.add(collisionGroup);   // collision only

  const ladderGroup = new THREE.Group();
  ladderGroup.name = "building-ladders";
  group.add(ladderGroup);

  const ladderLoader = new GLTFLoader();
  let ladderTemplate = null;
  let ladderLoadPromise = null;
  let ladderVersion = 0;

  const climbableAreas = [];

  function disposeGeometry(mesh) {
    if (mesh.geometry) mesh.geometry.dispose();
  }

  function ensureLadderTemplate() {
    if (ladderTemplate || ladderLoadPromise) return ladderLoadPromise;
    ladderLoadPromise = ladderLoader.loadAsync('/assets/props/ladder.glb')
      .then((gltf) => {
        ladderTemplate = gltf.scene || gltf.scenes?.[0] || null;
        if (ladderTemplate) {
          ladderTemplate.traverse((node) => {
            if (node.isMesh) {
              node.castShadow = false;
              node.receiveShadow = false;
            }
          });
        }
        return ladderTemplate;
      })
      .catch((err) => {
        console.error('Failed to load ladder model:', err);
        ladderTemplate = null;
        return null;
      });
    return ladderLoadPromise;
  }

  function setLadders(placements) {
    ladderVersion += 1;
    const currentVersion = ladderVersion;
    ladderGroup.clear();
    climbableAreas.length = 0;
    if (!placements.length) {
      window.climbableAreas = [];
      return;
    }
    ensureLadderTemplate()?.then((template) => {
      if (!template || currentVersion !== ladderVersion) return;
      ladderGroup.clear();
      for (const placement of placements) {
        const ladder = template.clone(true);
        ladder.position.copy(placement.position);
        ladder.rotation.y = placement.rotationY;
        ladderGroup.add(ladder);
      }
    });
    for (const placement of placements) {
      const center = placement.climbBox.getCenter(new THREE.Vector3());
      climbableAreas.push({
        box: placement.climbBox,
        center,
        minY: placement.bottomY,
        maxY: placement.topY
      });
    }
    window.climbableAreas = climbableAreas;
  }

  function updateBuildings(geojson, boundsOverride) {

    const polygons = collectBuildingPolygons(geojson);
    if (polygons.length === 0) {
      extrudedMesh.visible = false;
      flatMesh.visible = false;
      setLadders([]);
      return;
    }

    const bounds = boundsOverride ?? computeBoundsFromPolygons(polygons);
    if (!bounds) {
      extrudedMesh.visible = false;
      flatMesh.visible = false;
      setLadders([]);
      return;
    }

    const lonScale = metersPerDegreeLon(bounds.centerLat);
    const cameraPos = camera?.position ?? new THREE.Vector3();

    const flatGeometries = [];
    const extrudedResults = [];
    const ladderPlacements = [];

    for (const polygon of polygons) {
      const shape = makeShape(polygon.rings, bounds, lonScale);
      if (!shape) continue;

      const centroid = estimateCentroid(shape.getPoints());
      const dx = centroid.x - cameraPos.x;
      const dz = -centroid.y - cameraPos.z;
      const distance = Math.hypot(dx, dz);
      const height = resolveHeight(polygon.properties);

      if (distance <= EXTRUDE_DISTANCE) {
        // 1) Outer solid
        let geom = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false });
        geom.rotateX(-Math.PI / 2);
        geom.translate(0, BASE_ELEVATION, 0);
        geom.computeBoundingBox();

        // 2) Hollow it (shell)
        geom = hollowExtrudedGeometry(geom, shape, {
          wall: WALL_THICKNESS,
          floor: FLOOR_THICKNESS,
          roof: ROOF_THICKNESS
        });
        if (!geom.boundingBox) geom.computeBoundingBox();

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
          for (const g of cutters) g.dispose();
        }

        const ladderPlacement = buildLadderPlacement(geom.boundingBox, disabledSide);
        if (ladderPlacement) ladderPlacements.push(ladderPlacement);

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

    setLadders(ladderPlacements);
  }

  function dispose() {
    disposeGeometry(extrudedMesh);
    disposeGeometry(flatMesh);
    disposeGeometry(extrudedColliderMesh);
    extrudedMaterial.dispose();
    flatMaterial.dispose();
    group.clear();
    scene?.remove(group);
  }

  return {
    group,
    updateBuildings,
    getCollisionMesh: () => collisionGroup,
    getCollisionMeshes: () => {
      const meshes = [];
      if (extrudedColliderMesh.geometry?.attributes?.position?.count) meshes.push(extrudedColliderMesh);
      return meshes;
    },
    dispose
  };
}

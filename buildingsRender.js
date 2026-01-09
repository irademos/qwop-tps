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
const CLIPPER_SCALE = 10000;

// Shell params
const WALL_THICKNESS = 0.5;
const CUT_DEPTH = WALL_THICKNESS + 0.35; // clear wall reliably
const FLOOR_THICKNESS = 0.05;
const ROOF_THICKNESS = 0.05;
const LADDER_WIDTH = 3.0;
const LADDER_DEPTH = 3.5;
const LADDER_OFFSET = 1.8;

// --- building texture ---
const textureLoader = new THREE.TextureLoader();

const SIDES = ["+Z", "-Z", "+X", "-X"];

function buildLadderPlacementFromShape(shape2D, bounds, lonScale, bottomY, topY) {
  const pts2 = shape2D.getPoints(); // Vector2 in (x, -z) space from your ringToPoints()
  if (pts2.length < 2) return null;

  // pick a stable edge: longest edge
  let bestI = 0;
  let bestLen = -Infinity;
  for (let i = 0; i < pts2.length; i++) {
    const a = pts2[i];
    const b = pts2[(i + 1) % pts2.length];
    const len = a.distanceTo(b);
    if (len > bestLen) { bestLen = len; bestI = i; }
  }

  const a = pts2[bestI];
  const b = pts2[(bestI + 1) % pts2.length];

  // convert Vector2 (x, y) to world (x, z) where z = -y
  const ax = a.x, az = -a.y;
  const bx = b.x, bz = -b.y;

  const midX = (ax + bx) * 0.5;
  const midZ = (az + bz) * 0.5;

  const edgeDir = new THREE.Vector3(bx - ax, 0, bz - az).normalize();

  // outward normal (pick one; you might flip based on winding)
  const outward = new THREE.Vector3(-edgeDir.z, 0, edgeDir.x).normalize();

  // ladder should face the wall: rotation so its forward points -outward
  const rotationY = Math.atan2(-outward.x, -outward.z) - Math.PI / 2;

  const position = new THREE.Vector3(midX, bottomY, midZ).addScaledVector(outward, LADDER_OFFSET);

  const climbBox = new THREE.Box3(
    new THREE.Vector3(position.x - LADDER_WIDTH * 0.5, bottomY, position.z - LADDER_DEPTH * 0.5),
    new THREE.Vector3(position.x + LADDER_WIDTH * 0.5, topY, position.z + LADDER_DEPTH * 0.5)
  );

  return { position, rotationY, climbBox, bottomY, topY, outward };
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
  let outward;

  switch (disabledSide) {
    case "+Z":
      position = new THREE.Vector3(midX, bottomY, max.z + LADDER_OFFSET);
      rotationY = Math.PI;
      outward = new THREE.Vector3(0, 0, 1);
      climbBox = new THREE.Box3(
        new THREE.Vector3(midX - LADDER_WIDTH * 0.5, bottomY, max.z),
        new THREE.Vector3(midX + LADDER_WIDTH * 0.5, topY, max.z + LADDER_DEPTH)
      );
      break;
    case "-Z":
      position = new THREE.Vector3(midX, bottomY, min.z - LADDER_OFFSET);
      rotationY = 0;
      outward = new THREE.Vector3(0, 0, -1);
      climbBox = new THREE.Box3(
        new THREE.Vector3(midX - LADDER_WIDTH * 0.5, bottomY, min.z - LADDER_DEPTH),
        new THREE.Vector3(midX + LADDER_WIDTH * 0.5, topY, min.z)
      );
      break;
    case "+X":
      position = new THREE.Vector3(max.x + LADDER_OFFSET, bottomY, midZ);
      rotationY = -Math.PI / 2;
      outward = new THREE.Vector3(1, 0, 0);
      climbBox = new THREE.Box3(
        new THREE.Vector3(max.x, bottomY, midZ - LADDER_WIDTH * 0.5),
        new THREE.Vector3(max.x + LADDER_DEPTH, topY, midZ + LADDER_WIDTH * 0.5)
      );
      break;
    case "-X":
      position = new THREE.Vector3(min.x - LADDER_OFFSET, bottomY, midZ);
      rotationY = Math.PI / 2;
      outward = new THREE.Vector3(-1, 0, 0);
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
    topY,
    outward
  };
}

export function createBuildingsRenderer({ scene, camera } = {}) {
  const ladderLoader = new GLTFLoader();
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

  const ladderColliderGroup = new THREE.Group();
  ladderColliderGroup.name = "ladder-collision";
  collisionGroup.add(ladderColliderGroup);

  group.add(extrudedMesh);     // render
  group.add(flatMesh);         // render
  group.add(collisionGroup);   // collision only

  const ladderGroup = new THREE.Group();
  ladderGroup.name = "building-ladders";
  group.add(ladderGroup);

  
  let ladderTemplate = null;
  let ladderLoadPromise = null;
  let ladderVersion = 0;

  const climbableAreas = [];
  const ladderColliders = [];

  function disposeGeometry(mesh) {
    if (mesh.geometry) mesh.geometry.dispose();
  }

  function normalizeLadderTemplate(sceneRoot) {
    // clone so we never mutate the original gltf scene graph
    const root = sceneRoot.clone(true);
    root.updateMatrixWorld(true);

    // compute bbox in its current local space
    const box = new THREE.Box3().setFromObject(root);
    const size = box.getSize(new THREE.Vector3());

    // guard
    const height = Math.max(1e-6, size.y);

    // Move bottom-center to origin (0,0,0)
    const centerX = (box.min.x + box.max.x) * 0.5;
    const centerZ = (box.min.z + box.max.z) * 0.5;
    const bottomY  = box.min.y;

    root.position.set(-centerX, -bottomY, -centerZ);
    root.updateMatrixWorld(true);

    // Scale so height becomes 1 meter
    root.scale.setScalar(1 / height);
    root.updateMatrixWorld(true);
    
    const normalizedBox = new THREE.Box3().setFromObject(root);
    root.userData.bounds = normalizedBox;
    root.userData.size = normalizedBox.getSize(new THREE.Vector3());
    root.userData.forward = (size.z <= size.x)
    ? new THREE.Vector3(0, 0, 1)   // forward +Z
    : new THREE.Vector3(1, 0, 0);  // forward +X

    // Make sure it renders and doesn’t get culled (debug friendly)
    root.traverse(n => {
      if (n.isMesh) {
        n.frustumCulled = false;
        n.castShadow = false;
        n.receiveShadow = false;
        // IMPORTANT: do NOT replace the material (keeps original look)
        if (n.material) n.material.side = THREE.DoubleSide;
        n.visible = true;
      }
    });

    return root;
  }

  function ensureLadderTemplate() {
    if (ladderTemplate || ladderLoadPromise) return ladderLoadPromise;

    ladderLoadPromise = ladderLoader.loadAsync('/assets/props/ladder.glb')
      .then((gltf) => {
        const raw = gltf.scene || gltf.scenes?.[0];
        if (!raw) return null;

        ladderTemplate = normalizeLadderTemplate(raw);
        return ladderTemplate;
      })
      .catch((err) => {
        console.error("Failed to load ladder model:", err);
        ladderTemplate = null;
        return null;
      });

    return ladderLoadPromise;
  }

  function setLadders(placements) {
    ladderVersion += 1;
    const currentVersion = ladderVersion;

    ladderGroup.clear();
    ladderColliderGroup.clear();
    ladderColliders.length = 0;

    climbableAreas.length = 0;
    window.climbableAreas = climbableAreas;

    if (!placements.length) return;

    ensureLadderTemplate().then((template) => {

      if (!template) return;
      // TEMP: disable this while debugging
      // if (currentVersion !== ladderVersion) return;

      ladderGroup.clear();
      ladderColliderGroup.clear();
      ladderColliders.length = 0;
      climbableAreas.length = 0;

      for (const p of placements) {
        const ladder = template.clone(true);

        // Choose real-world ladder height in meters
        const LADDER_HEIGHT_M = Math.max(2.5, (p.topY - p.bottomY) * 0.95);
        ladder.scale.multiplyScalar(LADDER_HEIGHT_M); // template is 1m tall

        ladder.position.copy(p.position);
        ladder.rotation.y = p.rotationY;

        // Slight outward nudge so it doesn't clip the wall
        const forwardLocal = template.userData.forward || new THREE.Vector3(0,0,1);
        const outward = forwardLocal.clone().applyAxisAngle(new THREE.Vector3(0,1,0), p.rotationY).normalize();
        ladder.position.addScaledVector(outward, LADDER_OFFSET + 0.03);

        ladderGroup.add(ladder);

        ladder.updateMatrixWorld(true);
        const ladderBounds = new THREE.Box3().setFromObject(ladder);
        const center = ladderBounds.getCenter(new THREE.Vector3());
        const scaledSize = ladderBounds.getSize(new THREE.Vector3());
        const minY = ladderBounds.min.y;
        const maxY = ladderBounds.max.y;

        const colliderGeom = new THREE.BoxGeometry(scaledSize.x, scaledSize.y, scaledSize.z);
        const colliderMesh = new THREE.Mesh(colliderGeom, new THREE.MeshBasicMaterial({ visible: false }));
        colliderMesh.position.copy(center);
        colliderMesh.rotation.y = p.rotationY;
        ladderColliderGroup.add(colliderMesh);
        ladderColliders.push(colliderMesh);

        climbableAreas.push({
          center,
          rotationY: p.rotationY,
          halfWidth: scaledSize.x * 0.5,
          halfDepth: scaledSize.z * 0.5,
          halfHeight: scaledSize.y * 0.5,
          minY,
          maxY,
          normal: outward.clone()
        });

      }
      window.rebuildBuildingColliders?.();
    }).catch((err => {
      console.error("Error in ladder loading/placement:", err);
    })
    );
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
          geom.computeBoundingBox();
          for (const g of cutters) g.dispose();
        }

        const ladderPlacement = buildLadderPlacementFromShape(
          shape, bounds, lonScale,
          geom.boundingBox.min.y,
          geom.boundingBox.max.y
        );

        if (ladderPlacement) {
          ladderPlacements.push(ladderPlacement);
        } else {
          console.warn('[no ladderPlacement]', { disabledSide, bbox: geom.boundingBox });
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
      for (const ladderCollider of ladderColliders) {
        if (ladderCollider.geometry?.attributes?.position?.count) meshes.push(ladderCollider);
      }
      return meshes;
    },
    dispose
  };
}

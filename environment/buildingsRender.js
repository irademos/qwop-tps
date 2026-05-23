import * as THREE from "three";
// import { BufferGeometryUtils } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import ClipperLib from "clipper-lib";
import { Brush, Evaluator, SUBTRACTION } from "three-bvh-csg";
import { getKtx2Loader } from "../ktx2Loader.js";
import { clearClimbableAreas, setClimbableAreas } from "../controls/climb.js";
import { getStampedTerrainHeight, setBuildingStampsForTile } from "./terrainHeight.js";

const METERS_PER_DEGREE_LAT = 111_132.92;
const DEFAULT_HEIGHT = 10;
const LEVEL_HEIGHT = 3;
const EXTRUDE_DISTANCE = 250;
const BUILDING_PERIMETER_FALLOFF_METERS = 8;
const CLIPPER_SCALE = 10000;

// Shell params
const WALL_THICKNESS = 0.5;
const CUT_DEPTH = WALL_THICKNESS + 0.35; // clear wall reliably
const FLOOR_THICKNESS = 0.05;
const ROOF_THICKNESS = 0.05;
// --- building texture ---
const QUALITY_TIER_OPTIONS = ["low", "medium", "high"];
const BUILDING_LOD = Object.freeze({
  LOD0_PROXY: "LOD0_PROXY",
  LOD1_MID: "LOD1_MID",
  LOD2_FULL: "LOD2_FULL"
});

const BUILDING_LOD_CONFIG = Object.freeze({
  thresholds: Object.freeze({
    LOD2_FULL: Object.freeze({ enter: EXTRUDE_DISTANCE * 0.9, exit: EXTRUDE_DISTANCE * 1.15 }),
    LOD1_MID: Object.freeze({ enter: EXTRUDE_DISTANCE * 1.5, exit: EXTRUDE_DISTANCE * 1.8 })
  })
});
const BUILDING_PROMOTION_DEFAULTS = Object.freeze({
  maxPromotionsPerFrame: 8,
  maxPromotionCpuMs: 1.5,
  cameraTeleportDistanceMeters: 140,
  burstSoftCap: 48
});

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
const PROXY_ON_STARTUP = resolveProxyOnStartup();

function resolveProxyOnStartup() {
  if (typeof window === "undefined") return true;
  const override =
    window?.gameSettings?.render?.buildings?.proxy_on_startup ??
    window?.gameSettings?.render?.buildings?.proxyOnStartup ??
    window?.localStorage?.getItem("render.buildings.proxy_on_startup") ??
    window?.render?.buildings?.proxy_on_startup;

  if (typeof override === "boolean") return override;
  if (typeof override === "string") {
    const normalized = override.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) return true;
    if (["false", "0", "no", "off"].includes(normalized)) return false;
  }

  return true;
}

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

function polygonRingsToLocalMeters(rings, origin, lonScale) {
  const localRings = [];
  for (const ring of rings || []) {
    const normalized = normalizeRing(ring);
    if (!normalized || normalized.length < 3) continue;
    const points = [];
    for (const coord of normalized) {
      if (!coord || coord.length < 2) continue;
      const [lon, lat] = coord;
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
      points.push(toLocalMeters(coord, origin, lonScale));
    }
    if (points.length >= 3) localRings.push(points);
  }
  return localRings;
}

function makeShapeFromLocalRings(localRings) {
  if (!localRings || localRings.length === 0) return null;
  const outerPoints = localRings[0].map((point) => new THREE.Vector2(point.x, -point.z));
  if (outerPoints.length < 3) return null;

  const shape = new THREE.Shape(outerPoints);
  for (let i = 1; i < localRings.length; i += 1) {
    const holePoints = localRings[i].map((point) => new THREE.Vector2(point.x, -point.z));
    if (holePoints.length < 3) continue;
    shape.holes.push(new THREE.Path(holePoints));
  }
  return shape;
}

function median(values) {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) * 0.5
    : sorted[mid];
}

function computeBuildingGrade(localRings, shape) {
  const outer = localRings?.[0] ?? [];
  const sampleHeights = [];
  for (const point of outer) {
    const h = getStampedTerrainHeight(point.x, point.z);
    if (Number.isFinite(h)) sampleHeights.push(h);
  }

  const centroid2 = estimateCentroid(shape?.getPoints?.() ?? []);
  const centroidHeight = getStampedTerrainHeight(centroid2.x, -centroid2.y);
  if (Number.isFinite(centroidHeight)) sampleHeights.push(centroidHeight);

  return sampleHeights.length > 0 ? median(sampleHeights) : 0;
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
  roof = ROOF_THICKNESS,
  baseElevation = 0
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
  innerGeom.translate(0, baseElevation + floor, 0);
  innerGeom.computeBoundingBox();

  // outer - inner
  return csgSubtractGeom(outerGeom, [innerGeom]);
}

function createBuildingLODProxyGeometry(localRings, height, buildingGrade) {
  const outer = localRings?.[0] ?? [];
  if (outer.length < 3) return null;

  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;

  for (const point of outer) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minZ = Math.min(minZ, point.z);
    maxZ = Math.max(maxZ, point.z);
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minZ)) return null;

  const width = Math.max(0.5, maxX - minX);
  const depth = Math.max(0.5, maxZ - minZ);
  const h = Math.max(0.5, height);
  const centerX = (minX + maxX) * 0.5;
  const centerZ = (minZ + maxZ) * 0.5;
  const topY = buildingGrade + h;

  const top = new THREE.PlaneGeometry(width, depth);
  top.rotateX(-Math.PI / 2);
  top.translate(centerX, topY, centerZ);

  const north = new THREE.PlaneGeometry(width, h);
  north.translate(centerX, buildingGrade + h * 0.5, minZ);

  const south = new THREE.PlaneGeometry(width, h);
  south.rotateY(Math.PI);
  south.translate(centerX, buildingGrade + h * 0.5, maxZ);

  const west = new THREE.PlaneGeometry(depth, h);
  west.rotateY(-Math.PI / 2);
  west.translate(minX, buildingGrade + h * 0.5, centerZ);

  const east = new THREE.PlaneGeometry(depth, h);
  east.rotateY(Math.PI / 2);
  east.translate(maxX, buildingGrade + h * 0.5, centerZ);

  const merged = mergeGeometries([top, north, south, west, east], false);
  top.dispose();
  north.dispose();
  south.dispose();
  west.dispose();
  east.dispose();

  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  return merged;
}


function createBuildingColliderGeometry(localRings, height, buildingGrade) {
  const outer = localRings?.[0] ?? [];
  if (outer.length < 3) return null;

  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const point of outer) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minZ = Math.min(minZ, point.z);
    maxZ = Math.max(maxZ, point.z);
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minZ)) return null;

  const width = Math.max(0.5, maxX - minX);
  const depth = Math.max(0.5, maxZ - minZ);
  const h = Math.max(0.5, height);
  const centerX = (minX + maxX) * 0.5;
  const centerZ = (minZ + maxZ) * 0.5;

  const collider = new THREE.BoxGeometry(width, h, depth);
  collider.translate(centerX, buildingGrade + h * 0.5, centerZ);
  collider.computeBoundingBox();
  collider.computeBoundingSphere();
  return collider;
}

function buildDoorCuttersFromShape(shape2D, {
  doorW = 3.0,
  doorH = 2.2,
  doorSpacing = 8,
  inset = 0.02,
  baseElevation = 0
} = {}) {
  const cutters = [];
  const points2D = shape2D?.getPoints?.() ?? [];
  if (points2D.length < 2) return cutters;
  const winding = getRingWinding(points2D);
  const yDoorCenter = baseElevation + doorH * 0.5;
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

  const flatMaterial = new THREE.MeshStandardMaterial({ color: 0x8b6b4c, roughness: 1.0, metalness: 0.0 });

  const tileMeshes = new Map();
  const tileLODState = new Map();
  const promotionQueue = [];
  const promotionQueueById = new Map();
  let lastCameraPosition = null;
  const lodDebugStats = {
    counts: { [BUILDING_LOD.LOD0_PROXY]: 0, [BUILDING_LOD.LOD1_MID]: 0, [BUILDING_LOD.LOD2_FULL]: 0 },
    transitions: 0,
    transitionsPerSecond: 0,
    _lastTransitionsSampleMs: performance.now(),
    _lastTransitionsSampleCount: 0,
    queueDepth: 0,
    promotionsApplied: 0,
    promotionLatencyMsAvg: 0,
    promotionLatencyMsMax: 0,
    promotionsDeferredBurst: 0
  };
  const promotionLimits = {
    maxPromotionsPerFrame: BUILDING_PROMOTION_DEFAULTS.maxPromotionsPerFrame,
    maxPromotionCpuMs: BUILDING_PROMOTION_DEFAULTS.maxPromotionCpuMs,
    cameraTeleportDistanceMeters: BUILDING_PROMOTION_DEFAULTS.cameraTeleportDistanceMeters,
    burstSoftCap: BUILDING_PROMOTION_DEFAULTS.burstSoftCap
  };
  const payloadLoadState = new Map();
  const payloadLoadDefaults = {
    timeoutMs: 2500,
    maxRetries: 2,
    retryBackoffMs: 400
  };

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

  function chooseLODWithHysteresis(entity, distanceMeters) {
    const prev = entity.currentLOD ?? BUILDING_LOD.LOD0_PROXY;
    const { LOD2_FULL, LOD1_MID } = BUILDING_LOD_CONFIG.thresholds;
    if (prev === BUILDING_LOD.LOD2_FULL) {
      if (distanceMeters <= LOD2_FULL.exit) return BUILDING_LOD.LOD2_FULL;
      return distanceMeters <= LOD1_MID.enter ? BUILDING_LOD.LOD1_MID : BUILDING_LOD.LOD0_PROXY;
    }
    if (prev === BUILDING_LOD.LOD1_MID) {
      if (distanceMeters <= LOD2_FULL.enter) return BUILDING_LOD.LOD2_FULL;
      if (distanceMeters <= LOD1_MID.exit) return BUILDING_LOD.LOD1_MID;
      return BUILDING_LOD.LOD0_PROXY;
    }
    if (distanceMeters <= LOD2_FULL.enter) return BUILDING_LOD.LOD2_FULL;
    if (distanceMeters <= LOD1_MID.enter) return BUILDING_LOD.LOD1_MID;
    return BUILDING_LOD.LOD0_PROXY;
  }

  function scorePromotion(entry) {
    const dist = Math.max(1, entry.distanceToCamera ?? Number.POSITIVE_INFINITY);
    const centerWeight = Math.max(0, 1 - Math.min(1, entry.screenCenterDistance ?? 1.5));
    const visibleWeight = entry.isVisible ? 1 : 0;
    return (visibleWeight * 1000) + (centerWeight * 200) + (1 / dist);
  }

  function getEntityLoadState(entityId) {
    let state = payloadLoadState.get(entityId);
    if (!state) {
      state = { status: "idle", requestId: 0, retries: 0, priority: 0, targetLOD: BUILDING_LOD.LOD0_PROXY };
      payloadLoadState.set(entityId, state);
    }
    return state;
  }

  function cancelPayloadLoad(entityId) {
    const state = payloadLoadState.get(entityId);
    if (!state) return;
    state.requestId += 1;
    state.status = "idle";
    state.targetLOD = BUILDING_LOD.LOD0_PROXY;
    payloadLoadState.set(entityId, state);
  }

  function requestPayloadLoad(entityId, targetLOD, priority = 0) {
    const state = getEntityLoadState(entityId);
    if (state.status === "loaded" && state.targetLOD === targetLOD) return;
    state.targetLOD = targetLOD;
    state.priority = Math.max(state.priority ?? 0, priority);
    if (state.status === "loading") return;
    state.status = "queued";
    payloadLoadState.set(entityId, state);
  }

  function simulatePayloadLoad(entityId, state) {
    const requestId = (state.requestId ?? 0) + 1;
    state.requestId = requestId;
    state.status = "loading";
    payloadLoadState.set(entityId, state);
    const startedAt = performance.now();
    const jitterMs = 20 + Math.random() * 80;
    return new Promise((resolve) => setTimeout(() => {
      const timedOut = performance.now() - startedAt > payloadLoadDefaults.timeoutMs;
      const failed = Math.random() < 0.03;
      resolve({ entityId, requestId, timedOut, failed });
    }, jitterMs));
  }

  function enqueuePromotion(entry) {
    if (!entry?.id) return;
    const queuedAt = performance.now();
    const existing = promotionQueueById.get(entry.id);
    if (existing) {
      Object.assign(existing, entry, { queuedAt: existing.queuedAt ?? queuedAt, score: scorePromotion(entry) });
      return;
    }
    const wrapped = { ...entry, queuedAt, score: scorePromotion(entry) };
    promotionQueue.push(wrapped);
    promotionQueueById.set(entry.id, wrapped);
  }

  function processPromotionQueue() {
    if (promotionQueue.length === 0) return;
    const frameStart = performance.now();
    promotionQueue.sort((a, b) => b.score - a.score);
    const initialDepth = promotionQueue.length;
    const cameraPos = camera?.position ?? new THREE.Vector3();
    if (lastCameraPosition && cameraPos.distanceTo(lastCameraPosition) > promotionLimits.cameraTeleportDistanceMeters) {
      while (promotionQueue.length > promotionLimits.burstSoftCap) {
        const dropped = promotionQueue.pop();
        if (!dropped) break;
        promotionQueueById.delete(dropped.id);
        lodDebugStats.promotionsDeferredBurst += 1;
      }
    }
    lastCameraPosition = cameraPos.clone();
    let processed = 0;
    while (promotionQueue.length > 0 && processed < promotionLimits.maxPromotionsPerFrame) {
      const elapsed = performance.now() - frameStart;
      if (Number.isFinite(promotionLimits.maxPromotionCpuMs) && promotionLimits.maxPromotionCpuMs > 0 && elapsed >= promotionLimits.maxPromotionCpuMs) break;
      const next = promotionQueue.shift();
      if (!next) break;
      promotionQueueById.delete(next.id);
      const state = tileLODState.get(next.id);
      if (!state) continue;
      if (next.targetLOD === BUILDING_LOD.LOD0_PROXY) {
        cancelPayloadLoad(next.id);
        if (state.currentLOD !== BUILDING_LOD.LOD0_PROXY) {
          state.currentLOD = BUILDING_LOD.LOD0_PROXY;
          tileLODState.set(next.id, state);
          lodDebugStats.transitions += 1;
        }
        continue;
      }
      requestPayloadLoad(next.id, next.targetLOD, next.score);
      lodDebugStats.promotionsApplied += 1;
      const latency = performance.now() - next.queuedAt;
      lodDebugStats.promotionLatencyMsMax = Math.max(lodDebugStats.promotionLatencyMsMax, latency);
      const n = lodDebugStats.promotionsApplied;
      lodDebugStats.promotionLatencyMsAvg = ((lodDebugStats.promotionLatencyMsAvg * (n - 1)) + latency) / n;
      processed += 1;
    }
    const queuedLoads = [...payloadLoadState.entries()]
      .filter(([, value]) => value.status === "queued")
      .sort((a, b) => (b[1].priority ?? 0) - (a[1].priority ?? 0))
      .slice(0, promotionLimits.maxPromotionsPerFrame);
    for (const [entityId, loadState] of queuedLoads) {
      simulatePayloadLoad(entityId, loadState).then(({ entityId: doneId, requestId, timedOut, failed }) => {
        const currentLoadState = payloadLoadState.get(doneId);
        if (!currentLoadState || currentLoadState.requestId !== requestId) return;
        if (timedOut || failed) {
          currentLoadState.status = "failed";
          const nextRetry = (currentLoadState.retries ?? 0) + 1;
          currentLoadState.retries = nextRetry;
          payloadLoadState.set(doneId, currentLoadState);
          if (nextRetry <= payloadLoadDefaults.maxRetries) {
            const backoff = payloadLoadDefaults.retryBackoffMs * nextRetry;
            setTimeout(() => {
              const latest = payloadLoadState.get(doneId);
              if (!latest || latest.requestId !== requestId || latest.targetLOD === BUILDING_LOD.LOD0_PROXY) return;
              latest.status = "queued";
              payloadLoadState.set(doneId, latest);
            }, backoff);
          }
          return;
        }
        currentLoadState.status = "loaded";
        currentLoadState.retries = 0;
        payloadLoadState.set(doneId, currentLoadState);
        const tileState = tileLODState.get(doneId);
        if (!tileState) return;
        if (tileState.currentLOD !== currentLoadState.targetLOD) {
          tileState.currentLOD = currentLoadState.targetLOD;
          tileLODState.set(doneId, tileState);
          lodDebugStats.transitions += 1;
        }
      });
    }
    lodDebugStats.queueDepth = promotionQueue.length;
    if (initialDepth > promotionLimits.burstSoftCap) {
      lodDebugStats.promotionsDeferredBurst += Math.max(0, initialDepth - promotionLimits.burstSoftCap);
    }
  }

  function updateTileBuildings(tileKey, geojson, boundsOverride) {
    if (!tileKey) return null;
    const tileEntry = ensureTile(tileKey);
    const { extrudedMesh, flatMesh, extrudedColliderMesh } = tileEntry;

    setBuildingStampsForTile(tileKey, []);

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
      return tileEntry;
    }

    const lonScale = metersPerDegreeLon(bounds.centerLat);
    const cameraPos = camera?.position ?? new THREE.Vector3();

    const flatGeometries = [];
    const extrudedResults = [];
    const proxyResults = [];
    const colliderResults = [];
    const buildingStamps = [];
    const buildingEntities = [];
    let buildingIndex = 0;
    for (const polygon of polygons) {
      const localRings = polygonRingsToLocalMeters(polygon.rings, bounds, lonScale);
      const shape = makeShapeFromLocalRings(localRings);
      if (!shape || localRings.length === 0) continue;

      const buildingGrade = computeBuildingGrade(localRings, shape);
      buildingStamps.push({
        type: "building",
        geometryType: "polygon",
        rings: localRings,
        targetGrade: buildingGrade,
        innerRadius: 0,
        falloffRadius: BUILDING_PERIMETER_FALLOFF_METERS,
        priority: 300
      });

      const centroid = estimateCentroid(shape.getPoints());
      const dx = centroid.x - cameraPos.x;
      const dz = -centroid.y - cameraPos.z;
      const distance = Math.hypot(dx, dz);
      const height = resolveHeight(polygon.properties);

      const isFullDetail = distance <= qualitySettings.fullDetailDistance;
      const isSimpleDetail = !isFullDetail && distance <= qualitySettings.simpleDetailDistance;
      const targetLOD = isFullDetail ? BUILDING_LOD.LOD2_FULL : (isSimpleDetail ? BUILDING_LOD.LOD1_MID : BUILDING_LOD.LOD0_PROXY);
      const entityId = polygon.properties?.id ?? polygon.properties?.["@id"] ?? `${tileKey}-${buildingIndex}`;
      const shapeBounds = new THREE.Box2().setFromPoints(shape.getPoints());
      const effectiveLOD = chooseLODWithHysteresis({ currentLOD: tileLODState.get(entityId)?.currentLOD }, distance);
      if (effectiveLOD !== BUILDING_LOD.LOD0_PROXY) {
        const projected = new THREE.Vector3(centroid.x, buildingGrade + Math.max(2, height * 0.5), -centroid.y).project(camera);
        const isVisible = projected.z >= 0 && projected.z <= 1 && Math.abs(projected.x) <= 1 && Math.abs(projected.y) <= 1;
        const centerDistance = Math.hypot(projected.x, projected.y);
        enqueuePromotion({
          id: entityId,
          targetLOD: effectiveLOD,
          distanceToCamera: distance,
          screenCenterDistance: centerDistance,
          isVisible
        });
      } else {
        cancelPayloadLoad(entityId);
      }
      const loadState = payloadLoadState.get(entityId);
      const appliedLOD = loadState?.status === "loaded" ? (tileLODState.get(entityId)?.currentLOD ?? BUILDING_LOD.LOD0_PROXY) : BUILDING_LOD.LOD0_PROXY;
      buildingEntities.push({
        id: entityId,
        worldPosition: { x: centroid.x, y: buildingGrade, z: -centroid.y },
        bounds: {
          min: { x: shapeBounds.min.x, y: buildingGrade, z: -shapeBounds.max.y },
          max: { x: shapeBounds.max.x, y: buildingGrade + height, z: -shapeBounds.min.y }
        },
        desiredTargetLOD: targetLOD,
        effectiveLOD: appliedLOD
      });
      buildingIndex += 1;

      const colliderGeom = createBuildingColliderGeometry(localRings, height, buildingGrade);
      if (colliderGeom) colliderResults.push(colliderGeom);

      if (PROXY_ON_STARTUP) {
        const proxyGeom = createBuildingLODProxyGeometry(localRings, height, buildingGrade);
        if (proxyGeom) proxyResults.push(proxyGeom);
        continue;
      }

      if (effectiveLOD !== BUILDING_LOD.LOD0_PROXY && !PROXY_ON_STARTUP) {
        let geom = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false });
        geom.rotateX(-Math.PI / 2);
        geom.translate(0, buildingGrade, 0);
        geom.computeBoundingBox();

        if (effectiveLOD === BUILDING_LOD.LOD2_FULL && qualitySettings.enableHollow) {
          geom = hollowExtrudedGeometry(geom, shape, {
            wall: WALL_THICKNESS,
            floor: FLOOR_THICKNESS,
            roof: ROOF_THICKNESS,
            baseElevation: buildingGrade
          });
          if (!geom.boundingBox) geom.computeBoundingBox();
        }

        if (effectiveLOD === BUILDING_LOD.LOD2_FULL && qualitySettings.enableCsg) {
          const cutters = buildDoorCuttersFromShape(shape, {
            doorW: 3.0,
            doorH: 3.0,
            doorSpacing: 12,
            baseElevation: buildingGrade
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
        geom.translate(0, buildingGrade, 0);
        flatGeometries.push(geom);
      }
    }

    setBuildingStampsForTile(tileKey, buildingStamps);
    tileEntry.group.userData.buildingEntities = buildingEntities;
    lodDebugStats.counts[BUILDING_LOD.LOD0_PROXY] = 0;
    lodDebugStats.counts[BUILDING_LOD.LOD1_MID] = 0;
    lodDebugStats.counts[BUILDING_LOD.LOD2_FULL] = 0;
    for (const entity of buildingEntities) {
      const prev = tileLODState.get(entity.id)?.currentLOD;
      tileLODState.set(entity.id, { currentLOD: entity.effectiveLOD, ready: true });
      lodDebugStats.counts[entity.effectiveLOD] += 1;
      if (prev && prev !== entity.effectiveLOD) lodDebugStats.transitions += 1;
    }
    const now = performance.now();
    const elapsed = Math.max(1, now - lodDebugStats._lastTransitionsSampleMs);
    if (elapsed >= 1000) {
      const delta = lodDebugStats.transitions - lodDebugStats._lastTransitionsSampleCount;
      lodDebugStats.transitionsPerSecond = (delta * 1000) / elapsed;
      lodDebugStats._lastTransitionsSampleCount = lodDebugStats.transitions;
      lodDebugStats._lastTransitionsSampleMs = now;
    }
    if (typeof window !== "undefined") {
      window.__buildingLODStats = { ...lodDebugStats, counts: { ...lodDebugStats.counts } };
    }

    disposeGeometry(extrudedMesh);
    disposeGeometry(flatMesh);
    disposeGeometry(extrudedColliderMesh);

    if (PROXY_ON_STARTUP && proxyResults.length > 0) {
      const merged = mergeGeometries(proxyResults, false);
      merged.computeBoundingSphere();

      extrudedMesh.geometry = merged;

      extrudedMesh.visible = true;
      extrudedColliderMesh.visible = false;

      for (const g of proxyResults) g.dispose();
    } else if (extrudedResults.length > 0) {
      const merged = mergeGeometries(extrudedResults, false);
      merged.computeBoundingSphere();

      extrudedMesh.geometry = merged;               // render

      extrudedMesh.visible = true;
      extrudedColliderMesh.visible = false;

      for (const g of extrudedResults) g.dispose();
    } else {
      extrudedMesh.geometry = new THREE.BufferGeometry();
      extrudedColliderMesh.geometry = new THREE.BufferGeometry();
      extrudedMesh.visible = false;
    }


    if (colliderResults.length > 0) {
      const mergedCollider = mergeGeometries(colliderResults, false);
      mergedCollider.computeBoundingSphere();
      extrudedColliderMesh.geometry = mergedCollider;
      for (const g of colliderResults) g.dispose();
    } else {
      extrudedColliderMesh.geometry = new THREE.BufferGeometry();
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
    processFrame: processPromotionQueue,
    setPromotionLimits: (limits = {}) => {
      if (Number.isFinite(limits.maxPromotionsPerFrame)) promotionLimits.maxPromotionsPerFrame = Math.max(1, Math.floor(limits.maxPromotionsPerFrame));
      if (limits.maxPromotionCpuMs == null) {
        promotionLimits.maxPromotionCpuMs = null;
      } else if (Number.isFinite(limits.maxPromotionCpuMs)) {
        promotionLimits.maxPromotionCpuMs = Math.max(0, limits.maxPromotionCpuMs);
      }
      if (Number.isFinite(limits.cameraTeleportDistanceMeters)) {
        promotionLimits.cameraTeleportDistanceMeters = Math.max(1, limits.cameraTeleportDistanceMeters);
      }
      if (Number.isFinite(limits.burstSoftCap)) {
        promotionLimits.burstSoftCap = Math.max(1, Math.floor(limits.burstSoftCap));
      }
    },
    removeTile,
    clearTiles,
    getCollisionMesh: () => group,
    getLodDebugStats: () => ({ ...lodDebugStats, counts: { ...lodDebugStats.counts } }),
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

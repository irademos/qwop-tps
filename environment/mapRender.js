import * as THREE from "three";

import { getTerrainHeight } from "./terrainHeight.js";
import { resolveRoadWidth } from "./roadWidths.js";
const DEFAULT_COLOR = 0x2f2f2f;
const DEFAULT_ELEVATION = 0.01;
const ROAD_SURFACE_EPSILON = 0.025;
const METERS_PER_DEGREE_LAT = 111_132.92;
const NODE_EPSILON = 0.05;

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
    if (geometry.type === "LineString") lines.push({ highway, coords: geometry.coordinates });
    else if (geometry.type === "MultiLineString") {
      for (const line of geometry.coordinates) lines.push({ highway, coords: line });
    }
  }
  return lines;
}

function computeBounds(lines) {
  let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity, count = 0;
  for (const line of lines) {
    for (const coord of line.coords || []) {
      const [lon, lat] = coord;
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
      minLon = Math.min(minLon, lon); maxLon = Math.max(maxLon, lon);
      minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat); count += 1;
    }
  }
  if (!Number.isFinite(minLon) || count === 0) return null;
  return { centerLon: (minLon + maxLon) / 2, centerLat: (minLat + maxLat) / 2 };
}

function toLocalMeters(coord, origin, lonScale) {
  const [lon, lat] = coord;
  return { x: -(lon - origin.centerLon) * lonScale, z: (lat - origin.centerLat) * METERS_PER_DEGREE_LAT };
}

function makeRoadMaterial(color) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.95, metalness: 0.0 });
}

function nodeKey(point) {
  return `${Math.round(point.x / NODE_EPSILON)}:${Math.round(point.z / NODE_EPSILON)}`;
}

function buildArchetypeGeometries() {
  const geos = new Map();
  const straight = new THREE.PlaneGeometry(1, 1, 1, 1);
  straight.rotateX(-Math.PI / 2);
  geos.set("straight", straight);

  const curveShape = new THREE.Shape();
  curveShape.moveTo(0, 0);
  curveShape.absarc(0, 0, 1, 0, Math.PI / 2, false);
  curveShape.lineTo(0, 0);
  const curve = new THREE.ShapeGeometry(curveShape);
  curve.rotateX(-Math.PI / 2);
  geos.set("curve", curve);

  const tShape = new THREE.Shape();
  tShape.moveTo(-0.5, -1);
  tShape.lineTo(0.5, -1);
  tShape.lineTo(0.5, -0.5);
  tShape.lineTo(1, -0.5);
  tShape.lineTo(1, 0.5);
  tShape.lineTo(-1, 0.5);
  tShape.lineTo(-1, -0.5);
  tShape.lineTo(-0.5, -0.5);
  tShape.lineTo(-0.5, -1);
  const tGeo = new THREE.ShapeGeometry(tShape);
  tGeo.rotateX(-Math.PI / 2);
  geos.set("t_junction", tGeo);

  const crossShape = new THREE.Shape();
  crossShape.moveTo(-0.5, -1);
  crossShape.lineTo(0.5, -1);
  crossShape.lineTo(0.5, -0.5);
  crossShape.lineTo(1, -0.5);
  crossShape.lineTo(1, 0.5);
  crossShape.lineTo(0.5, 0.5);
  crossShape.lineTo(0.5, 1);
  crossShape.lineTo(-0.5, 1);
  crossShape.lineTo(-0.5, 0.5);
  crossShape.lineTo(-1, 0.5);
  crossShape.lineTo(-1, -0.5);
  crossShape.lineTo(-0.5, -0.5);
  crossShape.lineTo(-0.5, -1);
  const cross = new THREE.ShapeGeometry(crossShape);
  cross.rotateX(-Math.PI / 2);
  geos.set("cross_junction", cross);

  const endcapShape = new THREE.Shape();
  endcapShape.moveTo(-1, 0);
  endcapShape.absarc(0, 0, 1, Math.PI, 0, false);
  endcapShape.lineTo(-1, 0);
  const endcap = new THREE.ShapeGeometry(endcapShape);
  endcap.rotateX(-Math.PI / 2);
  geos.set("endcap", endcap);
  return geos;
}

export function createMapRenderer({ scene, renderer, color = DEFAULT_COLOR, elevation = DEFAULT_ELEVATION } = {}) {
  const group = new THREE.Group();
  group.name = "osm-highways";
  scene?.add(group);

  const tileMeshes = new Map();
  const roadMaterials = new Map();
  const archetypeGeometries = buildArchetypeGeometries();
  const baseColor = new THREE.Color(color);
  let brightness = 1;
  const tempMatrix = new THREE.Matrix4();
  const tempPosition = new THREE.Vector3();
  const tempQuat = new THREE.Quaternion();
  const tempScale = new THREE.Vector3();

  const getRoadMaterial = (width) => {
    if (!roadMaterials.has(width)) {
      const m = makeRoadMaterial(color);
      m.color.copy(baseColor).multiplyScalar(brightness);
      roadMaterials.set(width, m);
    }
    return roadMaterials.get(width);
  };

  function classifyNode(degree) {
    if (degree <= 1) return "endcap";
    if (degree === 2) return "curve";
    if (degree === 3) return "t_junction";
    return "cross_junction";
  }

  function ensureTile(tileKey) {
    let entry = tileMeshes.get(tileKey);
    if (entry) return entry;
    const tileGroup = new THREE.Group();
    tileGroup.name = `osm-highways-${tileKey}`;
    group.add(tileGroup);
    entry = { group: tileGroup, pools: new Map() };
    tileMeshes.set(tileKey, entry);
    return entry;
  }

  function ensureInstancedMesh(tileEntry, archetype, width, count) {
    const key = `${archetype}:${width}`;
    const existing = tileEntry.pools.get(key);
    const geometry = archetypeGeometries.get(archetype) ?? archetypeGeometries.get("straight");
    const material = getRoadMaterial(width);
    if (existing && existing.count >= count) {
      existing.mesh.visible = true;
      existing.mesh.count = count;
      return existing.mesh;
    }
    if (existing?.mesh?.parent) existing.mesh.parent.remove(existing.mesh);
    const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, count));
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.count = count;
    tileEntry.group.add(mesh);
    tileEntry.pools.set(key, { mesh, count: Math.max(1, count) });
    return mesh;
  }

  function updateTileHighways(tileKey, geojson, boundsOverride) {
    if (!tileKey) return null;
    const tileEntry = ensureTile(tileKey);
    const lines = collectHighwayLines(geojson);
    const bounds = boundsOverride ?? computeBounds(lines);
    if (!bounds || lines.length === 0) return tileEntry;
    const lonScale = metersPerDegreeLon(bounds.centerLat);

    const segmentsByKey = new Map();
    const nodeDegree = new Map();

    for (const line of lines) {
      const width = resolveRoadWidth(line.highway);
      const points = [];
      for (const coord of line.coords || []) {
        if (!coord || coord.length < 2) continue;
        const [lon, lat] = coord;
        if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
        points.push(toLocalMeters([lon, lat], bounds, lonScale));
      }
      for (let i = 0; i < points.length - 1; i += 1) {
        const a = points[i], b = points[i + 1];
        const aKey = nodeKey(a), bKey = nodeKey(b);
        nodeDegree.set(aKey, (nodeDegree.get(aKey) ?? 0) + 1);
        nodeDegree.set(bKey, (nodeDegree.get(bKey) ?? 0) + 1);
        const key = `straight:${width}`;
        if (!segmentsByKey.has(key)) segmentsByKey.set(key, []);
        segmentsByKey.get(key).push({ a, b, width });
      }
      const endpoints = [points[0], points[points.length - 1]].filter(Boolean);
      for (const p of endpoints) {
        const deg = nodeDegree.get(nodeKey(p)) ?? 1;
        const archetype = classifyNode(deg);
        const k = `${archetype}:${width}`;
        if (!segmentsByKey.has(k)) segmentsByKey.set(k, []);
        segmentsByKey.get(k).push({ center: p, width, deg });
      }
    }

    for (const pool of tileEntry.pools.values()) pool.mesh.visible = false;

    for (const [key, items] of segmentsByKey) {
      const [archetype, widthStr] = key.split(":");
      const width = Number(widthStr);
      const mesh = ensureInstancedMesh(tileEntry, archetype, width, items.length);
      for (let i = 0; i < items.length; i += 1) {
        const item = items[i];
        if (archetype === "straight") {
          const dx = item.b.x - item.a.x;
          const dz = item.b.z - item.a.z;
          const length = Math.hypot(dx, dz);
          const yaw = Math.atan2(dz, dx);
          tempPosition.set((item.a.x + item.b.x) * 0.5, getTerrainHeight((item.a.x + item.b.x) * 0.5, (item.a.z + item.b.z) * 0.5) + elevation + ROAD_SURFACE_EPSILON, (item.a.z + item.b.z) * 0.5);
          tempQuat.setFromEuler(new THREE.Euler(0, -yaw, 0));
          tempScale.set(Math.max(length, 0.01), width, 1);
        } else {
          tempPosition.set(item.center.x, getTerrainHeight(item.center.x, item.center.z) + elevation + ROAD_SURFACE_EPSILON, item.center.z);
          tempQuat.identity();
          tempScale.set(width, width, 1);
        }
        tempMatrix.compose(tempPosition, tempQuat, tempScale);
        mesh.setMatrixAt(i, tempMatrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
    }
    return tileEntry;
  }

  function removeTile(tileKey) {
    const entry = tileMeshes.get(tileKey); if (!entry) return;
    for (const { mesh } of entry.pools.values()) mesh.removeFromParent();
    entry.group.clear(); group.remove(entry.group); tileMeshes.delete(tileKey);
  }
  const clearTiles = () => { for (const k of tileMeshes.keys()) removeTile(k); };
  const setResolution = () => {};
  function setBrightness(nextBrightness) {
    brightness = Math.min(Math.max(nextBrightness, 0), 1);
    for (const material of roadMaterials.values()) {
      material.color.copy(baseColor).multiplyScalar(brightness);
      material.needsUpdate = true;
    }
  }
  function dispose() {
    clearTiles();
    for (const material of roadMaterials.values()) material.dispose();
    for (const geo of archetypeGeometries.values()) geo.dispose();
    group.clear(); scene?.remove(group);
  }

  if (renderer) {
    const size = new THREE.Vector2(); renderer.getSize(size); setResolution(size.x, size.y);
  }

  return { group, updateTileHighways, removeTile, clearTiles, setResolution, setBrightness, dispose };
}

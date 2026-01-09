import * as THREE from "three";
import { Line2 } from "three/examples/jsm/lines/Line2.js";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";

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
const DEFAULT_COLOR = 0x2f2f2f;
const DEFAULT_ELEVATION = 0.05;
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
    z: (lat - origin.centerLat) * METERS_PER_DEGREE_LAT
  };
}

function makeLineMaterial(width, color) {
  return new LineMaterial({
    color,
    linewidth: width,
    worldUnits: true
  });
}

function makeFallbackMaterial(width, color) {
  return new THREE.LineBasicMaterial({
    color,
    linewidth: width
  });
}

function resolveLineWidth(highway) {
  if (typeof highway !== "string") return DEFAULT_WIDTH;
  return ROAD_WIDTHS[highway] ?? DEFAULT_WIDTH;
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

  const pool = [];
  const lineMaterials = new Map();
  const fallbackMaterials = new Map();
  const resolution = new THREE.Vector2(1, 1);

  const useWideLines = Boolean(Line2 && LineGeometry && LineMaterial);

  function getLineMaterial(width) {
    if (!lineMaterials.has(width)) {
      lineMaterials.set(width, makeLineMaterial(width, color));
    }
    return lineMaterials.get(width);
  }

  function getFallbackMaterial(width) {
    if (!fallbackMaterials.has(width)) {
      fallbackMaterials.set(width, makeFallbackMaterial(width, color));
    }
    return fallbackMaterials.get(width);
  }

  function createLine(width) {
    if (useWideLines) {
      const geometry = new LineGeometry();
      const material = getLineMaterial(width);
      const line = new Line2(geometry, material);
      line.userData.isWideLine = true;
      return line;
    }
    const geometry = new THREE.BufferGeometry();
    const material = getFallbackMaterial(width);
    const line = new THREE.Line(geometry, material);
    line.userData.isWideLine = false;
    return line;
  }

  function ensureLine(index, width) {
    let line = pool[index];
    if (!line) {
      line = createLine(width);
      pool[index] = line;
      group.add(line);
    }
    line.visible = true;
    const isWide = line.userData.isWideLine;
    if (isWide) {
      const material = getLineMaterial(width);
      if (line.material !== material) {
        line.material = material;
      }
    } else {
      const material = getFallbackMaterial(width);
      if (line.material !== material) {
        line.material = material;
      }
    }
    return line;
  }

  function updateLineGeometry(line, positions) {
    if (!line?.geometry) return;
    if (line.userData.isWideLine) {
      if (!line.geometry.setPositions) return;
      line.geometry.setPositions(positions);
      const positionCount = line.geometry?.attributes?.position?.count ?? 0;
      if (positionCount > 0 && typeof line.computeLineDistances === "function") {
        line.computeLineDistances();
      }
    } else {
      if (!line.geometry.setFromPoints) return;
      const points = [];
      for (let i = 0; i < positions.length; i += 3) {
        points.push(new THREE.Vector3(positions[i], positions[i + 1], positions[i + 2]));
      }
      line.geometry.setFromPoints(points);
      if (line.geometry?.attributes?.position?.count > 0) {
        line.geometry.computeBoundingSphere();
      }
    }
  }

  function clearUnused(fromIndex) {
    for (let i = fromIndex; i < pool.length; i += 1) {
      const line = pool[i];
      if (line) {
        line.visible = false;
      }
    }
  }

  function updateHighways(geojson, boundsOverride) {
    const lines = collectHighwayLines(geojson);
    if (lines.length === 0) {
      clearUnused(0);
      return;
    }

    const bounds = boundsOverride ?? computeBounds(lines);
    if (!bounds) {
      clearUnused(0);
      return;
    }

    const lonScale = metersPerDegreeLon(bounds.centerLat);

    let activeIndex = 0;
    for (const line of lines) {
      if (!line.coords || line.coords.length < 2) continue;
      const width = resolveLineWidth(line.highway);
      const positions = [];
      for (const coord of line.coords) {
        if (!coord || coord.length < 2) continue;
        const [lon, lat] = coord;
        if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
        const local = toLocalMeters([lon, lat], bounds, lonScale);
        positions.push(local.x, elevation, local.z);
      }
      if (positions.length < 6) continue;
      const lineMesh = ensureLine(activeIndex, width);
      updateLineGeometry(lineMesh, positions);
      activeIndex += 1;
    }

    if (activeIndex === 0) {
      clearUnused(0);
      return;
    }
    clearUnused(activeIndex);
  }

  function setResolution(width, height) {
    resolution.set(width, height);
    if (!useWideLines) return;
    for (const material of lineMaterials.values()) {
      material.resolution.set(width, height);
    }
  }

  function dispose() {
    for (const line of pool) {
      line?.geometry?.dispose?.();
    }
    for (const material of lineMaterials.values()) {
      material.dispose();
    }
    for (const material of fallbackMaterials.values()) {
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
    updateHighways,
    setResolution,
    dispose
  };
}

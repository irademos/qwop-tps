import { overpassRequestQueue } from "./requestQueue.js";

const OVERPASS_ENDPOINT = "https://overpass-api.de/api/interpreter";
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_STALE_DISTANCE_METERS = 1500;

const HIGHWAY_TAGS = [
  "footway",
  "path",
  "residential",
  "primary",
  "secondary",
  "tertiary",
  "service",
  "track",
  "unclassified",
  "living_street",
  "steps",
  "cycleway",
  "trunk",
  "motorway",
];

const highwayRegex = HIGHWAY_TAGS.join("|");

function buildOverpassQuery(lat, lon, radiusMeters) {
  return [
    "[out:json][timeout:10];",
    "(",
    `  way["highway"~"${highwayRegex}"](around:${radiusMeters},${lat},${lon});`,
    `  relation["highway"~"${highwayRegex}"](around:${radiusMeters},${lat},${lon});`,
    `  way["building"](around:${radiusMeters},${lat},${lon});`,
    `  relation["building"](around:${radiusMeters},${lat},${lon});`,
    ");",
    "out body;",
    ">;",
    "out skel qt;",
  ].join("\n");
}

function normalizeRing(coords) {
  if (coords.length === 0) {
    return coords;
  }
  const first = coords[0];
  const last = coords[coords.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) {
    return [...coords, first];
  }
  return coords;
}

function wayToFeature(way, nodeLookup) {
  const coords = way.nodes
    .map((nodeId) => nodeLookup.get(nodeId))
    .filter(Boolean);

  if (coords.length < 2) {
    return null;
  }

  const isClosed = coords.length >= 4 && coords[0][0] === coords[coords.length - 1][0] && coords[0][1] === coords[coords.length - 1][1];
  const geometry = isClosed
    ? { type: "Polygon", coordinates: [normalizeRing(coords)] }
    : { type: "LineString", coordinates: coords };

  return {
    type: "Feature",
    id: `way/${way.id}`,
    properties: { ...way.tags },
    geometry,
  };
}

function relationToFeature(relation, waysById, nodeLookup) {
  if (!relation.members || relation.members.length === 0) {
    return null;
  }

  const closedWays = relation.members
    .filter((member) => member.type === "way")
    .map((member) => {
      const way = waysById.get(member.ref);
      if (!way) {
        return null;
      }
      const coords = way.nodes
        .map((nodeId) => nodeLookup.get(nodeId))
        .filter(Boolean);
      if (coords.length < 4) {
        return null;
      }
      const ring = normalizeRing(coords);
      return { role: member.role, ring };
    })
    .filter(Boolean);

  if (closedWays.length === 0) {
    return null;
  }

  const outerRings = closedWays.filter((item) => item.role === "outer").map((item) => item.ring);
  const innerRings = closedWays.filter((item) => item.role === "inner").map((item) => item.ring);
  const fallbackRings = closedWays.filter((item) => item.role !== "inner").map((item) => item.ring);
  const resolvedOuter = outerRings.length > 0 ? outerRings : fallbackRings;

  if (resolvedOuter.length === 0) {
    return null;
  }

  const geometry = resolvedOuter.length === 1
    ? { type: "Polygon", coordinates: [resolvedOuter[0], ...innerRings] }
    : { type: "MultiPolygon", coordinates: resolvedOuter.map((ring) => [ring]) };

  return {
    type: "Feature",
    id: `relation/${relation.id}`,
    properties: { ...relation.tags },
    geometry,
  };
}

function overpassToGeoJSON(data) {
  const nodeLookup = new Map();
  const waysById = new Map();
  const relations = [];

  for (const element of data.elements || []) {
    if (element.type === "node") {
      nodeLookup.set(element.id, [element.lon, element.lat]);
    } else if (element.type === "way") {
      waysById.set(element.id, element);
    } else if (element.type === "relation") {
      relations.push(element);
    }
  }

  const features = [];

  for (const way of waysById.values()) {
    const feature = wayToFeature(way, nodeLookup);
    if (feature) {
      features.push(feature);
    }
  }

  for (const relation of relations) {
    const feature = relationToFeature(relation, waysById, nodeLookup);
    if (feature) {
      features.push(feature);
    }
  }

  return {
    type: "FeatureCollection",
    features,
  };
}

async function performOverpassRequest(body) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    return await fetch(OVERPASS_ENDPOINT, {
      method: "POST",
      body,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function fetchOSMFeatures(lat, lon, radiusMeters, options = {}) {
  if (typeof lat !== "number" || typeof lon !== "number" || typeof radiusMeters !== "number") {
    throw new TypeError("fetchOSMFeatures expects numeric lat, lon, and radiusMeters values.");
  }

  const query = buildOverpassQuery(lat, lon, radiusMeters);
  const body = new URLSearchParams({ data: query });

  const staleDistanceMeters = Number.isFinite(options.staleDistanceMeters)
    ? options.staleDistanceMeters
    : DEFAULT_STALE_DISTANCE_METERS;

  const response = await overpassRequestQueue.enqueue({
    lat,
    lon,
    staleDistanceMeters,
    requestFn: () => performOverpassRequest(body),
  });

  const data = await response.json();
  return overpassToGeoJSON(data);
}

// Minimal usage example:
// fetchOSMFeatures(37.7749, -122.4194, 500)
//   .then((featureCollection) => console.log(featureCollection))
//   .catch((error) => console.error("Overpass error", error));

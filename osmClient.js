import { overpassRequestQueue } from "./requestQueue.js";
import { overpassToGeoJSON } from "./osmGeoJson.js";

const OVERPASS_ENDPOINT = import.meta.env.PROD ? "/api/overpass" : "https://overpass-api.de/api/interpreter";
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_STALE_DISTANCE_METERS = 600;

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

export async function fetchOSMData(lat, lon, radiusMeters, options = {}) {
  if (typeof lat !== "number" || typeof lon !== "number" || typeof radiusMeters !== "number") {
    throw new TypeError("fetchOSMData expects numeric lat, lon, and radiusMeters values.");
  }

  const query = buildOverpassQuery(lat, lon, radiusMeters);

  const staleDistanceMeters = Number.isFinite(options.staleDistanceMeters)
    ? options.staleDistanceMeters
    : DEFAULT_STALE_DISTANCE_METERS;

  const response = await overpassRequestQueue.enqueue({
    lat,
    lon,
    staleDistanceMeters,
    requestFn: () => performOverpassRequest(new URLSearchParams({ data: query })),
  });

  return response.json();
}

export async function fetchOSMFeatures(lat, lon, radiusMeters, options = {}) {
  const data = await fetchOSMData(lat, lon, radiusMeters, options);
  return overpassToGeoJSON(data);
}

// Minimal usage example:
// fetchOSMFeatures(37.7749, -122.4194, 500)
//   .then((featureCollection) => console.log(featureCollection))
//   .catch((error) => console.error("Overpass error", error));

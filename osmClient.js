import { RequestThrottleError, overpassRequestQueue } from "./requestQueue.js";
import { overpassToGeoJSON } from "./osmGeoJson.js";

const OVERPASS_ENDPOINTS = import.meta.env.PROD
  ? ["/api/overpass"]
  : [
      "https://overpass-api.de/api/interpreter",
      "https://overpass.kumi.systems/api/interpreter",
      "https://lz4.overpass-api.de/api/interpreter",
    ];
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_STALE_DISTANCE_METERS = 600;
const EMPTY_OVERPASS_PAYLOAD = Object.freeze({ version: 0.6, generator: "fallback", elements: [] });

class OverpassHttpError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "OverpassHttpError";
    this.code = "OVERPASS_HTTP_ERROR";
    this.status = details.status ?? null;
    this.endpoint = details.endpoint ?? null;
    this.retryAfterMs = details.retryAfterMs ?? null;
    this.isRateLimited = this.status === 429;
    this.details = details;
  }
}

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

function buildDedupeKey(lat, lon, radiusMeters) {
  const latBucket = lat.toFixed(4);
  const lonBucket = lon.toFixed(4);
  return `${latBucket}:${lonBucket}:${Math.round(radiusMeters)}`;
}

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

function getEndpointPriority() {
  if (OVERPASS_ENDPOINTS.length <= 1) {
    return OVERPASS_ENDPOINTS;
  }
  const first = Math.floor(Math.random() * OVERPASS_ENDPOINTS.length);
  const ordered = [];
  for (let i = 0; i < OVERPASS_ENDPOINTS.length; i += 1) {
    ordered.push(OVERPASS_ENDPOINTS[(first + i) % OVERPASS_ENDPOINTS.length]);
  }
  return ordered;
}

async function performOverpassRequest(body) {
  const endpoints = getEndpointPriority();
  let lastResponse = null;

  for (const endpoint of endpoints) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        body,
        signal: controller.signal,
      });
      response.overpassEndpoint = endpoint;
      if (response.status !== 429) {
        return response;
      }
      lastResponse = response;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  return lastResponse;
}

export async function fetchOSMData(lat, lon, radiusMeters, options = {}) {
  if (typeof lat !== "number" || typeof lon !== "number" || typeof radiusMeters !== "number") {
    throw new TypeError("fetchOSMData expects numeric lat, lon, and radiusMeters values.");
  }

  const query = buildOverpassQuery(lat, lon, radiusMeters);

  const staleDistanceMeters = Number.isFinite(options.staleDistanceMeters)
    ? options.staleDistanceMeters
    : DEFAULT_STALE_DISTANCE_METERS;
  const dedupeKeyOverride = typeof options.dedupeKeyOverride === "string" && options.dedupeKeyOverride.length > 0
    ? options.dedupeKeyOverride
    : null;

  const response = await overpassRequestQueue.enqueue({
    lat,
    lon,
    staleDistanceMeters,
    dedupeKey: dedupeKeyOverride ?? buildDedupeKey(lat, lon, radiusMeters),
    requestFn: () => performOverpassRequest(new URLSearchParams({ data: query })),
  });

  if (!response?.ok) {
    const status = Number.isFinite(response?.status) ? response.status : null;
    const retryAfterRaw = response?.headers?.get?.("retry-after");
    const retryAfterMs = retryAfterRaw ? Number.parseFloat(retryAfterRaw) * 1000 : null;
    const details = {
      status,
      statusText: response?.statusText ?? null,
      retryAfterMs: Number.isFinite(retryAfterMs) ? retryAfterMs : null
    };
    if (options.fallbackOnNonOk === true) {
      return EMPTY_OVERPASS_PAYLOAD;
    }
    throw new OverpassHttpError(
      `Overpass response non-OK: ${status ?? "unknown"} ${response?.statusText ?? ""}`.trim(),
      details
    );
  }

  return response.json();
}

export async function fetchOSMFeatures(lat, lon, radiusMeters, options = {}) {
  const data = await fetchOSMData(lat, lon, radiusMeters, options);
  return overpassToGeoJSON(data);
}

export function isOverpassThrottleError(error) {
  if (!error) return false;
  return error instanceof RequestThrottleError
    || error instanceof OverpassHttpError && error.status === 429
    || error?.code === "OVERPASS_RATE_LIMITED"
    || error?.status === 429;
}

export { OverpassHttpError, EMPTY_OVERPASS_PAYLOAD };

// Minimal usage example:
// fetchOSMFeatures(37.7749, -122.4194, 500)
//   .then((featureCollection) => console.log(featureCollection))
//   .catch((error) => console.error("Overpass error", error));

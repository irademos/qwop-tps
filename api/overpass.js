import crypto from "node:crypto";

const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://lz4.overpass-api.de/api/interpreter",
];
const REQUEST_TIMEOUT_MS = 10_000;
const RETRYABLE_STATUS = new Set([406, 429, 502, 503, 504]);
const CACHE_TTL_MS = 30_000;
const MAX_CONCURRENT_UPSTREAM = 4;
const TOKEN_BUCKET_CAPACITY = 8;
const TOKEN_BUCKET_REFILL_PER_SEC = 4;
const DEFAULT_RETRY_AFTER_MS = 5_000;

const responseCache = new Map();
const inFlightByQueryKey = new Map();

let activeUpstreamRequests = 0;
let bucketTokens = TOKEN_BUCKET_CAPACITY;
let lastRefillAt = Date.now();
const upstreamQueue = [];

function isAllowedMethod(method) {
  return method === "POST" || method === "OPTIONS";
}

function readDataParam(body) {
  if (!body) return null;

  if (typeof body === "string") {
    const trimmed = body.trim();
    if (!trimmed) return null;
    if (trimmed.startsWith("data=")) {
      return new URLSearchParams(trimmed).get("data");
    }
    return trimmed;
  }

  if (body instanceof URLSearchParams) return body.get("data");

  if (Buffer.isBuffer(body)) return readDataParam(body.toString("utf8"));

  if (ArrayBuffer.isView(body)) {
    return readDataParam(Buffer.from(body.buffer, body.byteOffset, body.byteLength));
  }

  if (typeof body === "object") {
    return typeof body.data === "string" ? body.data : null;
  }

  return null;
}

function normalizeQuery(query) {
  return query.replace(/\s+/g, " ").trim();
}

function getQueryKey(normalizedQuery) {
  return crypto.createHash("sha256").update(normalizedQuery).digest("hex");
}

function parseRetryAfterMs(retryAfterValue) {
  if (!retryAfterValue) return null;
  const seconds = Number.parseFloat(retryAfterValue);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.round(seconds * 1000);
  }

  const retryAt = Date.parse(retryAfterValue);
  if (!Number.isNaN(retryAt)) {
    return Math.max(0, retryAt - Date.now());
  }

  return null;
}

function maybeRefillTokens() {
  const now = Date.now();
  const elapsedMs = now - lastRefillAt;
  if (elapsedMs <= 0) return;
  const refill = Math.floor((elapsedMs / 1000) * TOKEN_BUCKET_REFILL_PER_SEC);
  if (refill <= 0) return;
  bucketTokens = Math.min(TOKEN_BUCKET_CAPACITY, bucketTokens + refill);
  lastRefillAt = now;
}

function releaseUpstreamSlot() {
  activeUpstreamRequests = Math.max(0, activeUpstreamRequests - 1);
  while (upstreamQueue.length > 0) {
    maybeRefillTokens();
    if (activeUpstreamRequests >= MAX_CONCURRENT_UPSTREAM || bucketTokens < 1) break;
    const next = upstreamQueue.shift();
    activeUpstreamRequests += 1;
    bucketTokens -= 1;
    next();
  }
}

function acquireUpstreamSlot() {
  return new Promise((resolve) => {
    maybeRefillTokens();
    if (activeUpstreamRequests < MAX_CONCURRENT_UPSTREAM && bucketTokens >= 1) {
      activeUpstreamRequests += 1;
      bucketTokens -= 1;
      resolve();
      return;
    }

    const tick = setInterval(() => {
      maybeRefillTokens();
      if (activeUpstreamRequests < MAX_CONCURRENT_UPSTREAM && bucketTokens >= 1) {
        clearInterval(tick);
        activeUpstreamRequests += 1;
        bucketTokens -= 1;
        resolve();
      }
    }, 50);

    upstreamQueue.push(() => {
      clearInterval(tick);
      resolve();
    });
  });
}

async function fetchFromOverpass(body, signal) {
  await acquireUpstreamSlot();
  let lastResponse = null;

  try {
    for (let i = 0; i < OVERPASS_ENDPOINTS.length; i += 1) {
      const endpoint = OVERPASS_ENDPOINTS[i];
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
          Accept: "application/json, text/plain;q=0.9, */*;q=0.8",
        },
        body,
        signal,
      });

      if (response.ok) {
        return response;
      }

      lastResponse = response;
      if (!RETRYABLE_STATUS.has(response.status) || i === OVERPASS_ENDPOINTS.length - 1) {
        return response;
      }
    }
  } finally {
    releaseUpstreamSlot();
  }

  return lastResponse;
}

function buildErrorPayload(code, upstreamStatus, retryAfterMs) {
  return {
    code,
    retryAfterMs: Number.isFinite(retryAfterMs) ? Math.max(0, Math.round(retryAfterMs)) : null,
    upstreamStatus: Number.isFinite(upstreamStatus) ? upstreamStatus : null,
  };
}

export default async function handler(req, res) {
  if (!isAllowedMethod(req.method)) {
    res.setHeader("Allow", "POST, OPTIONS");
    return res.status(405).json({ error: "Method not allowed." });
  }

  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    return res.status(204).end();
  }

  const query = readDataParam(req.body);
  if (!query) {
    return res.status(400).json(buildErrorPayload("MISSING_QUERY", null, null));
  }

  const normalizedQuery = normalizeQuery(query);
  const queryKey = getQueryKey(normalizedQuery);
  const cached = responseCache.get(queryKey);
  if (cached && cached.expiresAt > Date.now()) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Content-Type", cached.contentType);
    res.setHeader("X-Overpass-Cache", "HIT");
    return res.status(cached.status).send(cached.responseText);
  }
  responseCache.delete(queryKey);

  if (inFlightByQueryKey.has(queryKey)) {
    const shared = await inFlightByQueryKey.get(queryKey);
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Content-Type", shared.contentType);
    res.setHeader("X-Overpass-Deduped", "1");
    return res.status(shared.status).send(shared.responseText);
  }

  const upstreamPromise = (async () => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const requestBody = new URLSearchParams({ data: normalizedQuery }).toString();
      const upstreamResponse = await fetchFromOverpass(requestBody, controller.signal);

      if (!upstreamResponse) {
        return {
          type: "error",
          status: 502,
          payload: buildErrorPayload("NO_UPSTREAM_RESPONSE", null, null),
        };
      }

      const responseText = await upstreamResponse.text();
      const upstreamContentType = upstreamResponse.headers.get("content-type") || "application/json; charset=utf-8";
      const retryAfterMs = parseRetryAfterMs(upstreamResponse.headers.get("retry-after"));
      return {
        type: "upstream",
        status: upstreamResponse.status,
        contentType: upstreamContentType,
        responseText,
        retryAfterMs,
      };
    } catch (error) {
      const status = error?.name === "AbortError" ? 504 : 502;
      const code = status === 504 ? "UPSTREAM_TIMEOUT" : "UPSTREAM_UNREACHABLE";
      return {
        type: "error",
        status,
        payload: buildErrorPayload(code, status, status === 504 ? DEFAULT_RETRY_AFTER_MS : null),
      };
    } finally {
      clearTimeout(timeoutId);
    }
  })();
  inFlightByQueryKey.set(queryKey, upstreamPromise);
  try {
    const result = await upstreamPromise;
    res.setHeader("Access-Control-Allow-Origin", "*");

    if (result.type === "error") {
      return res.status(result.status).json(result.payload);
    }

    if (result.status === 429 || result.status === 504) {
      const retryAfterMs = result.retryAfterMs ?? DEFAULT_RETRY_AFTER_MS;
      res.setHeader("Retry-After", String(Math.ceil(retryAfterMs / 1000)));
      res.setHeader("X-Retry-After-Ms", String(retryAfterMs));
      return res.status(result.status).json(
        buildErrorPayload("UPSTREAM_RETRYABLE", result.status, retryAfterMs),
      );
    }

    if (result.status >= 200 && result.status < 300) {
      responseCache.set(queryKey, {
        status: result.status,
        contentType: result.contentType,
        responseText: result.responseText,
        expiresAt: Date.now() + CACHE_TTL_MS,
      });
      res.setHeader("X-Overpass-Cache", "MISS");
    }

    res.setHeader("Content-Type", result.contentType);
    return res.status(result.status).send(result.responseText);
  } finally {
    inFlightByQueryKey.delete(queryKey);
  }
}

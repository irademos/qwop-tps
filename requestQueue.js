const DEFAULT_RATE_LIMIT_MS = 5000;
const DEFAULT_BACKOFF_MS = 1250;
const DEFAULT_MAX_RETRIES = 5;
const RETRYABLE_STATUS = new Set([429, 504]);

class StaleRequestError extends Error {
  constructor(message = "Request became stale before execution.") {
    super(message);
    this.name = "StaleRequestError";
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfterMs(retryAfterHeader) {
  if (!retryAfterHeader) {
    return null;
  }
  const seconds = Number.parseFloat(retryAfterHeader);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000;
  }
  const at = Date.parse(retryAfterHeader);
  if (Number.isFinite(at)) {
    return Math.max(0, at - Date.now());
  }
  return null;
}

function haversineMeters(a, b) {
  const R = 6371000;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

class RequestQueue {
  constructor({
    rateLimitMs = DEFAULT_RATE_LIMIT_MS,
    backoffMs = DEFAULT_BACKOFF_MS,
    maxRetries = DEFAULT_MAX_RETRIES,
    maxConcurrent = 1,
  } = {}) {
    this.rateLimitMs = rateLimitMs;
    this.backoffMs = backoffMs;
    this.maxRetries = maxRetries;
    this.maxConcurrent = Math.max(1, Math.floor(maxConcurrent));
    this.queue = [];
    this.inFlightCount = 0;
    this.processingScheduled = false;
    this.lastRequestStartedAt = 0;
    this.globalNextAllowedAt = 0;
    this.latestLocation = null;
    this.pendingByKey = new Map();
  }

  enqueue({ lat, lon, staleDistanceMeters, requestFn, dedupeKey = null }) {
    if (typeof requestFn !== "function") {
      return Promise.reject(new TypeError("requestFn must be a function."));
    }

    this.latestLocation = Number.isFinite(lat) && Number.isFinite(lon)
      ? { lat, lon }
      : this.latestLocation;

    if (dedupeKey && this.pendingByKey.has(dedupeKey)) {
      return this.pendingByKey.get(dedupeKey);
    }

    const promise = new Promise((resolve, reject) => {
      this.queue.push({
        lat,
        lon,
        staleDistanceMeters,
        requestFn,
        dedupeKey,
        resolve,
        reject,
      });
      this.processQueue();
    });

    if (dedupeKey) {
      this.pendingByKey.set(dedupeKey, promise);
      promise.finally(() => {
        if (this.pendingByKey.get(dedupeKey) === promise) {
          this.pendingByKey.delete(dedupeKey);
        }
      });
    }

    return promise;
  }

  processQueue() {
    if (this.processingScheduled) {
      return;
    }
    this.processingScheduled = true;
    queueMicrotask(() => {
      this.processingScheduled = false;
      this.pumpQueue();
    });
  }

  pumpQueue() {
    while (this.inFlightCount < this.maxConcurrent && this.queue.length > 0) {
      const entry = this.queue.shift();
      this.inFlightCount += 1;
      this.executeWithRetry(entry)
        .then((response) => entry.resolve(response))
        .catch((error) => entry.reject(error))
        .finally(() => {
          this.inFlightCount = Math.max(0, this.inFlightCount - 1);
          this.processQueue();
        });
    }
  }

  isStale(entry) {
    if (!this.latestLocation) {
      return false;
    }
    if (!Number.isFinite(entry.lat) || !Number.isFinite(entry.lon)) {
      return false;
    }
    if (!Number.isFinite(entry.staleDistanceMeters)) {
      return false;
    }
    const distance = haversineMeters(
      { lat: entry.lat, lon: entry.lon },
      this.latestLocation
    );
    return distance > entry.staleDistanceMeters;
  }

  async waitForRateLimit() {
    // Re-evaluate in a loop so concurrent workers don't all wake at once and violate spacing.
    while (true) {
      const now = Date.now();
      const elapsed = now - this.lastRequestStartedAt;
      const baseWaitMs = Math.max(0, this.rateLimitMs - elapsed);
      const globalWaitMs = Math.max(0, this.globalNextAllowedAt - now);
      const waitMs = Math.max(baseWaitMs, globalWaitMs);
      if (waitMs <= 0) {
        this.lastRequestStartedAt = Date.now();
        return;
      }
      await sleep(waitMs);
    }
  }

  async executeWithRetry(entry) {
    let attempt = 0;
    let lastError;

    while (attempt < this.maxRetries) {
      if (this.isStale(entry)) {
        throw new StaleRequestError();
      }

      await this.waitForRateLimit();

      try {
        const response = await entry.requestFn();
        if (response.ok) {
          return response;
        }
        if (RETRYABLE_STATUS.has(response.status)) {
          attempt += 1;
          lastError = new Error(`Overpass request failed: ${response.status} ${response.statusText}`);
          if (attempt >= this.maxRetries) {
            break;
          }
          const retryAfterMs = parseRetryAfterMs(response.headers?.get("retry-after"));
          const expBackoffMs = this.backoffMs * 2 ** (attempt - 1);
          const jitterMs = Math.floor(Math.random() * 350);
          const cooldownMs = Math.max(retryAfterMs ?? 0, expBackoffMs) + jitterMs;
          this.globalNextAllowedAt = Math.max(this.globalNextAllowedAt, Date.now() + cooldownMs);
          await sleep(cooldownMs);
          continue;
        }
        throw new Error(`Overpass request failed: ${response.status} ${response.statusText}`);
      } catch (error) {
        lastError = error;
        attempt += 1;
        if (attempt >= this.maxRetries || error instanceof StaleRequestError) {
          break;
        }
        await sleep(this.backoffMs * 2 ** (attempt - 1));
      }
    }

    throw lastError;
  }
}

function parseQueueNumber(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const overpassQueueDefaults = {
  maxConcurrent: parseQueueNumber(import.meta.env.VITE_OVERPASS_MAX_CONCURRENT, 2),
  rateLimitMs: parseQueueNumber(import.meta.env.VITE_OVERPASS_RATE_LIMIT_MS, DEFAULT_RATE_LIMIT_MS),
  backoffMs: parseQueueNumber(import.meta.env.VITE_OVERPASS_BACKOFF_MS, DEFAULT_BACKOFF_MS),
  maxRetries: parseQueueNumber(import.meta.env.VITE_OVERPASS_MAX_RETRIES, DEFAULT_MAX_RETRIES),
};

export const overpassRequestQueue = new RequestQueue(overpassQueueDefaults);
export { RequestQueue, StaleRequestError };

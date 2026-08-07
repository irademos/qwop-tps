const DEFAULT_RATE_LIMIT_MS = 5000;
const DEFAULT_BACKOFF_MS = 1250;
const DEFAULT_MAX_RETRIES = 5;
const RETRYABLE_STATUS = new Set([429, 504]);
const MAX_429_STORM_COUNT = 6;
const COOLDOWN_JITTER_MS = 350;

class StaleRequestError extends Error {
  constructor(message = "Request became stale before execution.") {
    super(message);
    this.name = "StaleRequestError";
  }
}

class RequestThrottleError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "RequestThrottleError";
    this.code = "OVERPASS_RATE_LIMITED";
    this.status = Number.isFinite(details.status) ? details.status : 429;
    this.endpoint = details.endpoint ?? null;
    this.attempt = Number.isFinite(details.attempt) ? details.attempt : null;
    this.retryAfterMs = Number.isFinite(details.retryAfterMs) ? details.retryAfterMs : null;
    this.diagnostics = details;
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
    this.recent429Count = 0;
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

  buildDiagnostics(entry, details = {}) {
    return {
      endpoint: details.endpoint ?? entry.endpoint ?? null,
      dedupeKey: entry.dedupeKey ?? null,
      attempt: Number.isFinite(details.attempt) ? details.attempt : null,
      retryAfterMs: Number.isFinite(details.retryAfterMs) ? details.retryAfterMs : null,
      status: Number.isFinite(details.status) ? details.status : null,
      nextAllowedAt: this.globalNextAllowedAt || null
    };
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
          this.recent429Count = 0;
          return response;
        }
        if (RETRYABLE_STATUS.has(response.status)) {
          attempt += 1;
          const retryAfterMs = parseRetryAfterMs(response.headers?.get("retry-after"));
          const diagnostics = this.buildDiagnostics(entry, {
            attempt,
            retryAfterMs,
            status: response.status,
            endpoint: response.overpassEndpoint ?? null
          });
          console.warn("[RequestQueue] retryable response", diagnostics);
          lastError = response.status === 429
            ? new RequestThrottleError(`Overpass request failed: ${response.status} ${response.statusText}`, diagnostics)
            : new Error(`Overpass request failed: ${response.status} ${response.statusText}`);
          if (attempt >= this.maxRetries) {
            break;
          }
          const expBackoffMs = this.backoffMs * 2 ** (attempt - 1);
          if (response.status === 429) {
            this.recent429Count = Math.min(MAX_429_STORM_COUNT, this.recent429Count + 1);
          }
          const stormMultiplier = response.status === 429 ? Math.max(1, this.recent429Count) : 1;
          const jitterMs = Math.floor(Math.random() * COOLDOWN_JITTER_MS);
          const cooldownMs = Math.max(retryAfterMs ?? 0, expBackoffMs) * stormMultiplier + jitterMs;
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
  maxConcurrent: parseQueueNumber(import.meta.env.VITE_OVERPASS_MAX_CONCURRENT, 1),
  rateLimitMs: parseQueueNumber(import.meta.env.VITE_OVERPASS_RATE_LIMIT_MS, DEFAULT_RATE_LIMIT_MS),
  backoffMs: parseQueueNumber(import.meta.env.VITE_OVERPASS_BACKOFF_MS, DEFAULT_BACKOFF_MS),
  maxRetries: parseQueueNumber(import.meta.env.VITE_OVERPASS_MAX_RETRIES, DEFAULT_MAX_RETRIES),
};

export const overpassRequestQueue = new RequestQueue(overpassQueueDefaults);
export { RequestQueue, StaleRequestError, RequestThrottleError };

const DEFAULT_RATE_LIMIT_MS = 2000;
const DEFAULT_BACKOFF_MS = 500;
const DEFAULT_MAX_RETRIES = 3;
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
  } = {}) {
    this.rateLimitMs = rateLimitMs;
    this.backoffMs = backoffMs;
    this.maxRetries = maxRetries;
    this.queue = [];
    this.processing = false;
    this.lastRequestStartedAt = 0;
    this.latestLocation = null;
  }

  enqueue({ lat, lon, staleDistanceMeters, requestFn }) {
    if (typeof requestFn !== "function") {
      return Promise.reject(new TypeError("requestFn must be a function."));
    }

    this.latestLocation = Number.isFinite(lat) && Number.isFinite(lon)
      ? { lat, lon }
      : this.latestLocation;

    return new Promise((resolve, reject) => {
      this.queue.push({
        lat,
        lon,
        staleDistanceMeters,
        requestFn,
        resolve,
        reject,
      });
      this.processQueue();
    });
  }

  async processQueue() {
    if (this.processing) {
      return;
    }
    this.processing = true;

    while (this.queue.length > 0) {
      const entry = this.queue.shift();
      try {
        const response = await this.executeWithRetry(entry);
        entry.resolve(response);
      } catch (error) {
        entry.reject(error);
      }
    }

    this.processing = false;
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
    const elapsed = Date.now() - this.lastRequestStartedAt;
    const waitMs = Math.max(0, this.rateLimitMs - elapsed);
    if (waitMs > 0) {
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
      this.lastRequestStartedAt = Date.now();

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
          await sleep(this.backoffMs * 2 ** (attempt - 1));
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

export const overpassRequestQueue = new RequestQueue();
export { RequestQueue, StaleRequestError };

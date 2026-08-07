const DB_NAME = "osm-tile-cache";
const STORE_NAME = "tiles";
const DB_VERSION = 1;

let dbPromise = null;

function openDatabase() {
  if (typeof indexedDB === "undefined") {
    return Promise.resolve(null);
  }
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.addEventListener("upgradeneeded", () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: "key" });
        }
      });
      request.addEventListener("success", () => resolve(request.result));
      request.addEventListener("error", () => reject(request.error));
    });
  }
  return dbPromise;
}

function wrapRequest(request) {
  return new Promise((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () => reject(request.error));
  });
}

export async function getCachedTile(key) {
  const db = await openDatabase();
  if (!db) return null;
  const transaction = db.transaction(STORE_NAME, "readonly");
  const store = transaction.objectStore(STORE_NAME);
  const result = await wrapRequest(store.get(key));
  return result || null;
}

export async function setCachedTile(key, geojson, fetchedAt = Date.now()) {
  const db = await openDatabase();
  if (!db) return null;
  const transaction = db.transaction(STORE_NAME, "readwrite");
  const store = transaction.objectStore(STORE_NAME);
  const entry = { key, geojson, fetchedAt };
  await wrapRequest(store.put(entry));
  return entry;
}

export async function clearCache() {
  const db = await openDatabase();
  if (!db) return;
  const transaction = db.transaction(STORE_NAME, "readwrite");
  const store = transaction.objectStore(STORE_NAME);
  await wrapRequest(store.clear());
}

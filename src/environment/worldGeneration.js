const DEFAULT_WORLD_SEED = 0x5f3759df;
let currentWorldSeed = DEFAULT_WORLD_SEED;

function normalizeSeed(seed) {
  if (typeof seed === "number" && Number.isFinite(seed)) {
    return seed >>> 0;
  }
  if (typeof seed === "string") {
    let hash = 2166136261 >>> 0;
    for (let i = 0; i < seed.length; i += 1) {
      hash = Math.imul(hash ^ seed.charCodeAt(i), 16777619);
    }
    return hash >>> 0;
  }
  return DEFAULT_WORLD_SEED;
}

export function setWorldSeed(seed) {
  currentWorldSeed = normalizeSeed(seed);
}

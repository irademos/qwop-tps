import * as THREE from 'three';

const SPAWN_TRAVEL_MIN_DISTANCE = 30;
const SPAWN_TRAVEL_MAX_DISTANCE = 70;
const SPAWN_MAX_WORLD_STEP_DISTANCE = 25;
const SPAWN_MIN_INTERVAL_MS = 7_000;
const SPAWN_NEARBY_MIN_DISTANCE = 24;
const SPAWN_NEARBY_MAX_DISTANCE = 42;
const SPAWN_PREDICT_MIN_AHEAD_DISTANCE = 24;
const SPAWN_PREDICT_MAX_AHEAD_DISTANCE = 42;
const SPAWN_PREDICT_LATERAL_JITTER = 10;

const DEFAULT_TYPE_WEIGHTS = [
  { type: 'monster', weight: 0.40 },
  { type: 'merchant', weight: 0.25 },
  { type: 'animal', weight: 0.15 },
  { type: 'friendly', weight: 0.20 }
];

const worldDistanceMeters = (a, b) => {
  if (!a || !b) return null;
  if (![a.x, a.z, b.x, b.z].every(Number.isFinite)) return null;
  return Math.hypot(b.x - a.x, b.z - a.z);
};

const getNextSpawnDistance = () => {
  return SPAWN_TRAVEL_MIN_DISTANCE + Math.random() * (SPAWN_TRAVEL_MAX_DISTANCE - SPAWN_TRAVEL_MIN_DISTANCE);
};

const pickSpawnType = (weights) => {
  const options = Array.isArray(weights) && weights.length ? weights : DEFAULT_TYPE_WEIGHTS;
  const total = options.reduce((sum, entry) => sum + Math.max(0, entry.weight || 0), 0);
  if (total <= 0) return 'friendly';
  let value = Math.random() * total;
  for (const entry of options) {
    value -= Math.max(0, entry.weight || 0);
    if (value <= 0) return entry.type;
  }
  return options[0]?.type || 'friendly';
};

const getSpawnPositionFromDirection = ({ basePosition, travelDirection, getSpawnPosition }) => {
  if (!basePosition) return null;

  if (!travelDirection || travelDirection.lengthSq() <= 0.0001) {
    const angle = Math.random() * Math.PI * 2;
    const distance = SPAWN_NEARBY_MIN_DISTANCE + Math.random() * (SPAWN_NEARBY_MAX_DISTANCE - SPAWN_NEARBY_MIN_DISTANCE);
    return getSpawnPosition(new THREE.Vector3(
      basePosition.x + Math.cos(angle) * distance,
      basePosition.y,
      basePosition.z + Math.sin(angle) * distance
    ));
  }

  const extraAhead = SPAWN_PREDICT_MIN_AHEAD_DISTANCE
    + Math.random() * (SPAWN_PREDICT_MAX_AHEAD_DISTANCE - SPAWN_PREDICT_MIN_AHEAD_DISTANCE);
  const predictedPos = basePosition.clone().add(travelDirection.clone().multiplyScalar(extraAhead));
  const lateral = new THREE.Vector3(-travelDirection.z, 0, travelDirection.x)
    .multiplyScalar((Math.random() - 0.5) * SPAWN_PREDICT_LATERAL_JITTER);
  predictedPos.add(lateral);
  return getSpawnPosition(predictedPos);
};

export function createCharacterSpawner({ getPlayerPosition, getSpawnPosition, spawnTypeWeights, travelMinDistance = SPAWN_TRAVEL_MIN_DISTANCE, travelMaxDistance = SPAWN_TRAVEL_MAX_DISTANCE } = {}) {
  let nextSpawnDistance = 0;
  let travelStartPosition = null;
  let lastSpawnAtMs = 0;
  let worldDistanceAccum = 0;
  let lastWorldSample = null;

  const recordWorldTravel = ({ x, y = 0, z, timestampMs } = {}) => {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return;

    const sample = {
      x,
      y: Number.isFinite(y) ? y : 0,
      z,
      timestampMs: Number.isFinite(timestampMs) ? timestampMs : Date.now()
    };

    if (!lastWorldSample) {
      lastWorldSample = sample;
      return;
    }

    const stepDistance = worldDistanceMeters(lastWorldSample, sample);
    lastWorldSample = sample;
    if (!Number.isFinite(stepDistance) || stepDistance <= 0 || stepDistance > SPAWN_MAX_WORLD_STEP_DISTANCE) {
      return;
    }

    worldDistanceAccum += stepDistance;
  };

  const getSpawnEvent = () => {
    const currentPos = getPlayerPosition?.();
    if (!currentPos) return null;

    if (!Number.isFinite(nextSpawnDistance) || nextSpawnDistance <= 0) {
      nextSpawnDistance = travelMinDistance + Math.random() * Math.max(0, travelMaxDistance - travelMinDistance);
    }

    if (!travelStartPosition) {
      travelStartPosition = currentPos.clone();
      return null;
    }

    if (worldDistanceAccum < nextSpawnDistance) {
      return null;
    }

    const now = Date.now();
    if (now - lastSpawnAtMs < SPAWN_MIN_INTERVAL_MS) return null;

    const travelDirection = currentPos.clone().sub(travelStartPosition).setY(0);
    if (travelDirection.lengthSq() > 0.0001) {
      travelDirection.normalize();
    }

    const spawnPosition = getSpawnPositionFromDirection({
      basePosition: currentPos,
      travelDirection,
      getSpawnPosition
    });

    const event = {
      type: pickSpawnType(spawnTypeWeights),
      position: spawnPosition,
      direction: travelDirection,
      timestampMs: now
    };

    worldDistanceAccum = 0;
    lastSpawnAtMs = now;
    travelStartPosition = currentPos.clone();
    nextSpawnDistance = travelMinDistance + Math.random() * Math.max(0, travelMaxDistance - travelMinDistance);

    return event;
  };

  const reset = () => {
    nextSpawnDistance = 0;
    travelStartPosition = null;
    lastSpawnAtMs = 0;
    worldDistanceAccum = 0;
    lastWorldSample = null;
  };

  return {
    recordWorldTravel,
    getSpawnEvent,
    reset
  };
}

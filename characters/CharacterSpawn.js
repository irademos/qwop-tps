import * as THREE from 'three';

const SPAWN_TRAVEL_MIN_DISTANCE = 70;
const SPAWN_TRAVEL_MAX_DISTANCE = 150;
const SPAWN_MIN_GPS_ACCURACY_METERS = 15;
const SPAWN_MAX_GPS_STEP_DISTANCE = 25;
const SPAWN_MIN_INTERVAL_MS = 20_000;
const SPAWN_NEARBY_MIN_DISTANCE = 24;
const SPAWN_NEARBY_MAX_DISTANCE = 42;
const SPAWN_PREDICT_MIN_AHEAD_DISTANCE = 24;
const SPAWN_PREDICT_MAX_AHEAD_DISTANCE = 42;
const SPAWN_PREDICT_LATERAL_JITTER = 10;

const DEFAULT_TYPE_WEIGHTS = [
  { type: 'friendly', weight: 0.35 },
  { type: 'merchant', weight: 0.15 },
  { type: 'monster', weight: 0.3 },
  { type: 'animal', weight: 0.2 }
];

const haversineMeters = (lat1, lon1, lat2, lon2) => {
  const toRad = (value) => value * (Math.PI / 180);
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6_371_000 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
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

export function createCharacterSpawner({ getPlayerPosition, getSpawnPosition, spawnTypeWeights } = {}) {
  let nextSpawnDistance = 0;
  let travelStartPosition = null;
  let lastSpawnAtMs = 0;
  let gpsDistanceAccum = 0;
  let lastGpsSample = null;

  const recordGpsTravel = ({ lat, lon, accuracyMeters, timestampMs } = {}) => {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
    if (!Number.isFinite(accuracyMeters) || accuracyMeters > SPAWN_MIN_GPS_ACCURACY_METERS) {
      return;
    }

    const sample = {
      lat,
      lon,
      timestampMs: Number.isFinite(timestampMs) ? timestampMs : Date.now()
    };

    if (!lastGpsSample) {
      lastGpsSample = sample;
      return;
    }

    const stepDistance = haversineMeters(lastGpsSample.lat, lastGpsSample.lon, sample.lat, sample.lon);
    lastGpsSample = sample;
    if (!Number.isFinite(stepDistance) || stepDistance <= 0 || stepDistance > SPAWN_MAX_GPS_STEP_DISTANCE) {
      return;
    }

    gpsDistanceAccum += stepDistance;
  };

  const getSpawnEvent = () => {
    const currentPos = getPlayerPosition?.();
    if (!currentPos) return null;

    if (!Number.isFinite(nextSpawnDistance) || nextSpawnDistance <= 0) {
      nextSpawnDistance = getNextSpawnDistance();
    }

    if (!travelStartPosition) {
      travelStartPosition = currentPos.clone();
      return null;
    }

    if (gpsDistanceAccum < nextSpawnDistance) {
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

    gpsDistanceAccum = 0;
    lastSpawnAtMs = now;
    travelStartPosition = currentPos.clone();
    nextSpawnDistance = getNextSpawnDistance();

    return event;
  };

  const reset = () => {
    nextSpawnDistance = 0;
    travelStartPosition = null;
    lastSpawnAtMs = 0;
    gpsDistanceAccum = 0;
    lastGpsSample = null;
  };

  return {
    recordGpsTravel,
    getSpawnEvent,
    reset
  };
}

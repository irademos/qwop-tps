import * as THREE from "three";
import { loadMonsterModel } from "./models/monsterModel.js";
import { FriendlyCharacter } from "./characters/FriendlyCharacter.js";
import { createLightSource, LIGHT_SOURCE_CONFIGS } from "./light_sources.js";
import { createStaticBoxColliderForObject, syncStaticBoxColliderForObject } from "./physics/staticBoxCollider.js";
import {
  initFriendlyPersistence,
  loadFriendliesSnapshot,
  subscribeFriendlyUpdates,
  persistFriendlyState,
  setFriendlyPersistenceHost,
  removeFriendlyRecord
} from "./friendlyPersistence.js";
import { BASE_HEALTH_SEGMENTS, getMaxHealthSegments, normalizeHealthSegments } from "./healthUtils.js";

const FRIENDLY_MODELS = [
  "/models/cowboy.fbx"
];
const FRIENDLY_MAX_ACTIVE = 6;
const FRIENDLY_ACTIVE_RADIUS = 360;
const FRIENDLY_SPAWN_NEARBY_MIN_DISTANCE = 24;
const FRIENDLY_SPAWN_NEARBY_MAX_DISTANCE = 42;
const FRIENDLY_SPAWN_TRAVEL_MIN_DISTANCE = 70;
const FRIENDLY_SPAWN_TRAVEL_MAX_DISTANCE = 150;
const FRIENDLY_SPAWN_MAX_STEP_DISTANCE = 14;
const FRIENDLY_SPAWN_MAX_SPEED = 20;
const FRIENDLY_SPAWN_PREDICT_MIN_AHEAD_DISTANCE = 24;
const FRIENDLY_SPAWN_PREDICT_MAX_AHEAD_DISTANCE = 42;
const FRIENDLY_SPAWN_PREDICT_LATERAL_JITTER = 10;
const FRIENDLY_PLAYER_SPAWN_BLOCK_RADIUS = 32;
const FRIENDLY_NOTICE_RADIUS = 10;
const FRIENDLY_WANDER_RADIUS = 4;
const FRIENDLY_ENGAGE_RADIUS = 5;
const FRIENDLY_DISENGAGE_RADIUS = 8;
const FRIENDLY_ANIM_MIN_INTERVAL_MS = 150;
const FRIENDLY_BASE_HEALTH = BASE_HEALTH_SEGMENTS;
const FRIENDLY_LEVEL_WEIGHTS = [
  { level: 1, weight: 0.55 },
  { level: 2, weight: 0.25 },
  { level: 3, weight: 0.15 },
  { level: 4, weight: 0.05 }
];

export function createFriendlyNpcManager({
  scene,
  playerModel,
  otherPlayers,
  attachPhysics,
  detachPhysics,
  getTerrainHeight,
  liftPositionToBuildingTop,
  isHost = false,
  debug = false
} = {}) {
  const friendlies = [];
  const records = new Map();
  const spawning = new Set();
  let snapshotLoaded = false;
  let persistenceEnabled = true;
  let unsubscribeUpdates = null;
  let currentHost = !!isHost;
  let spawnedCount = 0;
  let spawnDistanceAccum = 0;
  let nextSpawnDistance = 0;
  let lastPlayerPosition = null;
  let travelStartPosition = null;

  const getNextSpawnDistance = () => {
    return FRIENDLY_SPAWN_TRAVEL_MIN_DISTANCE
      + Math.random() * (FRIENDLY_SPAWN_TRAVEL_MAX_DISTANCE - FRIENDLY_SPAWN_TRAVEL_MIN_DISTANCE);
  };

  const isPlayerTravelAnimationActive = () => {
    const action = playerModel?.userData?.currentAction;
    return action === "walk" || action === "run";
  };

  const getSpawnNearPlayerPosition = (startPos, currentPos) => {
    const basePos = playerModel?.position;
    if (!basePos) return null;
    const start = startPos?.clone?.() || basePos.clone();
    const current = currentPos?.clone?.() || basePos.clone();
    const travelRay = current.sub(start);
    travelRay.y = 0;

    if (travelRay.lengthSq() <= 0.0001) {
      const angle = Math.random() * Math.PI * 2;
      const distance = FRIENDLY_SPAWN_NEARBY_MIN_DISTANCE
        + Math.random() * (FRIENDLY_SPAWN_NEARBY_MAX_DISTANCE - FRIENDLY_SPAWN_NEARBY_MIN_DISTANCE);
      return getSpawnPosition(new THREE.Vector3(
        basePos.x + Math.cos(angle) * distance,
        basePos.y,
        basePos.z + Math.sin(angle) * distance
      ));
    }

    const rayDirection = travelRay.normalize();
    const extraAhead = FRIENDLY_SPAWN_PREDICT_MIN_AHEAD_DISTANCE
      + Math.random() * (FRIENDLY_SPAWN_PREDICT_MAX_AHEAD_DISTANCE - FRIENDLY_SPAWN_PREDICT_MIN_AHEAD_DISTANCE);
    const predictedPos = basePos.clone().add(rayDirection.clone().multiplyScalar(extraAhead));
    const lateral = new THREE.Vector3(-rayDirection.z, 0, rayDirection.x)
      .multiplyScalar((Math.random() - 0.5) * FRIENDLY_SPAWN_PREDICT_LATERAL_JITTER);
    predictedPos.add(lateral);
    return getSpawnPosition(predictedPos);
  };


  const refreshSpawnCounterFromRecords = () => {
    let maxSpawnedId = 0;
    records.forEach((record, recordId) => {
      const slotId = record?.id || recordId;
      const match = typeof slotId === "string" ? slotId.match(/^friendly:distance:(\d+)$/) : null;
      if (!match) return;
      const value = Number.parseInt(match[1], 10);
      if (Number.isFinite(value)) {
        maxSpawnedId = Math.max(maxSpawnedId, value);
      }
    });
    spawnedCount = maxSpawnedId;
  };

  const dropFurthestFriendlyRecord = (originPosition) => {
    if (!originPosition || records.size < FRIENDLY_MAX_ACTIVE) return;
    let furthestId = null;
    let furthestDistance = -Infinity;
    records.forEach((record, id) => {
      const pos = record?.pos;
      if (!pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.y) || !Number.isFinite(pos.z)) return;
      const distance = originPosition.distanceTo(new THREE.Vector3(pos.x, pos.y, pos.z));
      if (distance > furthestDistance) {
        furthestDistance = distance;
        furthestId = id;
      }
    });
    if (!furthestId) return;

    records.delete(furthestId);
    removeFriendlyRecord(furthestId);

    const index = friendlies.findIndex(entry => entry?.id === furthestId);
    if (index >= 0) {
      cleanupFriendly(friendlies[index]);
      friendlies.splice(index, 1);
      window.friendlies = friendlies;
    }
  };
  const maybeSpawnFriendlyFromDistance = (deltaSeconds = 0) => {
    if (!playerModel) return;
    if (!Number.isFinite(nextSpawnDistance) || nextSpawnDistance <= 0) {
      nextSpawnDistance = getNextSpawnDistance();
    }
    const currentPos = playerModel.position.clone();
    if (!lastPlayerPosition) {
      lastPlayerPosition = currentPos;
      travelStartPosition = currentPos.clone();
      return;
    }
    const frameDistance = currentPos.distanceTo(lastPlayerPosition);
    lastPlayerPosition.copy(currentPos);
    if (!isPlayerTravelAnimationActive()) return;
    if (!Number.isFinite(frameDistance) || frameDistance <= 0 || frameDistance > FRIENDLY_SPAWN_MAX_STEP_DISTANCE) {
      return;
    }
    const speed = deltaSeconds > 0 ? frameDistance / deltaSeconds : 0;
    if (Number.isFinite(speed) && speed > FRIENDLY_SPAWN_MAX_SPEED) {
      return;
    }
    spawnDistanceAccum += frameDistance;
    if (spawnDistanceAccum < nextSpawnDistance) return;

    const playerIsNearFriendly = Array.from(records.values()).some((record) => {
      if (!record?.alive) return false;
      const pos = record?.pos;
      if (!pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.y) || !Number.isFinite(pos.z)) {
        return false;
      }
      const friendlyPosition = new THREE.Vector3(pos.x, pos.y, pos.z);
      return currentPos.distanceTo(friendlyPosition) <= FRIENDLY_PLAYER_SPAWN_BLOCK_RADIUS;
    });
    if (playerIsNearFriendly) return;

    dropFurthestFriendlyRecord(currentPos);
    spawnedCount += 1;
    const slotId = `friendly:distance:${spawnedCount}`;
    const spawnPos = getSpawnNearPlayerPosition(travelStartPosition, currentPos);
    if (spawnPos) {
      const level = getRandomLevel();
      const hp = getHealthForLevel(level);
      const modelPath = getRandomFriendlyModel();
      const angle = Math.random() * Math.PI * 2;
      const rot = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, angle, 0));
      const record = {
        id: slotId,
        type: modelPath,
        hp,
        level,
        alive: true,
        pos: { x: spawnPos.x, y: spawnPos.y, z: spawnPos.z },
        rot: { x: rot.x, y: rot.y, z: rot.z, w: rot.w }
      };
      records.set(slotId, record);
    }
    spawnDistanceAccum = 0;
    travelStartPosition = currentPos.clone();
    nextSpawnDistance = getNextSpawnDistance();
  };

  const setHost = (nextHost) => {
    currentHost = !!nextHost;
    setFriendlyPersistenceHost(nextHost);
  };

  const getRandomFriendlyModel = () => {
    const index = Math.floor(Math.random() * FRIENDLY_MODELS.length);
    return FRIENDLY_MODELS[index];
  };

  const getRandomLevel = () => {
    const totalWeight = FRIENDLY_LEVEL_WEIGHTS.reduce((sum, entry) => sum + entry.weight, 0);
    let pick = Math.random() * totalWeight;
    for (const entry of FRIENDLY_LEVEL_WEIGHTS) {
      pick -= entry.weight;
      if (pick <= 0) {
        return entry.level;
      }
    }
    return FRIENDLY_LEVEL_WEIGHTS[0]?.level ?? 1;
  };

const getHealthForLevel = (level) => {
    const clampedLevel = Math.max(1, Math.round(level || 1));
    return getMaxHealthSegments(clampedLevel);
  };

  const getSpawnPosition = (position) => {
    const spawnPos = position.clone();
    const terrainHeight = getTerrainHeight?.(spawnPos.x, spawnPos.z);
    spawnPos.y = Number.isFinite(terrainHeight) ? terrainHeight + 0.5 : spawnPos.y;
    liftPositionToBuildingTop?.(spawnPos, 0.5);
    return spawnPos;
  };

  const cleanupFriendly = (friendly) => {
    if (!friendly) return;
    const roadLight = friendly.model?.userData?.roadLight;
    if (roadLight?.model?.parent) {
      roadLight.model.parent.remove(roadLight.model);
    }
    if (friendly.model?.userData) {
      friendly.model.userData.roadLight = null;
      friendly.model.userData.roadLightPending = false;
      friendly.model.userData.roadLightToken = null;
    }
    friendly.model?.userData?.mixer?.stopAllAction?.();
    if (friendly.model?.parent) {
      friendly.model.parent.remove(friendly.model);
    }
    detachPhysics?.(friendly);
    if (friendly.model?.userData?.rb) {
      friendly.model.userData.rb = null;
    }
    friendly.model = null;
  };

  const getRoadLightPosition = (basePosition) => {
    const lightPosition = basePosition.clone().add(new THREE.Vector3(2.5, 0, 2));
    const terrainHeight = getTerrainHeight?.(lightPosition.x, lightPosition.z);
    lightPosition.y = Number.isFinite(terrainHeight) ? terrainHeight + 0.1 : basePosition.y;
    liftPositionToBuildingTop?.(lightPosition, 0.3);
    return lightPosition;
  };

  const ensureFriendlyRoadLight = (friendly, basePosition) => {
    if (!friendly?.model || !scene) return;
    if (friendly.model.userData.roadLight || friendly.model.userData.roadLightPending) {
      return;
    }
    const token = Symbol("friendlyRoadLight");
    friendly.model.userData.roadLightToken = token;
    friendly.model.userData.roadLightPending = true;
    const lightPosition = getRoadLightPosition(basePosition);
    createLightSource(LIGHT_SOURCE_CONFIGS.roadLight, lightPosition)
      .then((lightSource) => {
        if (!friendly.model || friendly.model.userData.roadLightToken !== token) return;
        friendly.model.userData.roadLight = lightSource;
        friendly.model.userData.roadLightPending = false;
        scene.add(lightSource.model);
        lightSource.collider = createStaticBoxColliderForObject(lightSource.model, {
          friction: 0.9,
          restitution: 0.02,
          halfExtents: new THREE.Vector3(0.35, 1.8, 0.35),
          centerOffset: new THREE.Vector3(0, 1.8, 0),
          useObjectPosition: true
        });
      })
      .catch((error) => {
        console.warn("Failed to load friendly road light:", error);
      })
      .finally(() => {
        if (friendly.model?.userData?.roadLightToken === token) {
          friendly.model.userData.roadLightPending = false;
        }
      });
  };

  const syncFriendlyRoadLight = (friendly, basePosition) => {
    if (!friendly?.model) return;
    const roadLight = friendly.model.userData.roadLight;
    if (!roadLight?.model) return;
    roadLight.model.position.copy(getRoadLightPosition(basePosition));
    syncStaticBoxColliderForObject(roadLight.collider);
  };

  const setFriendlyForSlot = (slotId, friendly) => {
    const existingIndex = friendlies.findIndex(entry => entry.id === slotId);
    if (existingIndex >= 0) {
      friendlies[existingIndex] = friendly;
    } else {
      friendlies.push(friendly);
    }
    window.friendlies = friendlies;
  };

  const spawnFriendly = (record, existing = null) => {
    const slotId = record.id;
    if (!slotId || spawning.has(slotId)) return;
    const modelPath = record.type || record.modelPath || getRandomFriendlyModel();
    spawning.add(slotId);
    loadMonsterModel(modelPath, data => {
      try {
        const friendly = new FriendlyCharacter(data);
        friendly.id = slotId;
        friendly.modelPath = modelPath;
        friendly.type = modelPath;
        if (Number.isFinite(record.version)) {
          friendly.version = record.version;
        }
        friendly.model.userData.approachToPlayer = false;
        friendly.model.userData.hideInMapView = true;
        friendly.setNoticeRadius(FRIENDLY_NOTICE_RADIUS);
        friendly.setWanderRadius(FRIENDLY_WANDER_RADIUS);
        friendly.setEngageRadius(FRIENDLY_ENGAGE_RADIUS);
        friendly.setDisengageRadius(FRIENDLY_DISENGAGE_RADIUS);
        friendly.lastAIUpdateMs = 0;
        const level = Number.isFinite(record.level) ? record.level : getRandomLevel();
        friendly.setLevel(level, { preserveHealth: false });
        friendly.resetHealth();

        if (Number.isFinite(record.hp)) {
          friendly.health = normalizeHealthSegments(record.hp, friendly.level);
          friendly.model.userData.health = friendly.health;
        }
        if (record.alive === false || (Number.isFinite(record.hp) && record.hp <= 0)) {
          friendly.markDead();
        }

        const position = record.pos;
        if (position && Number.isFinite(position.x) && Number.isFinite(position.y) && Number.isFinite(position.z)) {
          friendly.setPosition(position.x, position.y, position.z);
        }
        const rotation = record.rot;
        if (rotation && Number.isFinite(rotation.x) && Number.isFinite(rotation.y)
          && Number.isFinite(rotation.z) && Number.isFinite(rotation.w)) {
          friendly.model.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
        }
        friendly.setHomePosition(friendly.model.position.clone());
        ensureFriendlyRoadLight(friendly, friendly.model.position.clone());
        cleanupFriendly(existing);
        scene?.add(friendly.model);
        attachPhysics?.(friendly);
        if (rotation && friendly.body) {
          friendly.body.setRotation(rotation, true);
        }
        setFriendlyForSlot(slotId, friendly);
      } finally {
        spawning.delete(slotId);
      }
    });
  };

  const syncFriendlyFromRecord = (friendly, record, applyTransform) => {
    if (!friendly?.model || !record) return;
    const position = applyTransform ? record.pos : null;
    const rotation = applyTransform ? record.rot : null;
    if (position && Number.isFinite(position.x) && Number.isFinite(position.y) && Number.isFinite(position.z)) {
      friendly.model.position.set(position.x, position.y, position.z);
      friendly.body?.setTranslation({ x: position.x, y: position.y, z: position.z }, true);
      friendly.setHomePosition(friendly.model.position);
      syncFriendlyRoadLight(friendly, friendly.model.position.clone());
    }
    if (rotation && Number.isFinite(rotation.x) && Number.isFinite(rotation.y)
      && Number.isFinite(rotation.z) && Number.isFinite(rotation.w)) {
      friendly.model.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
      friendly.body?.setRotation(rotation, true);
    }
    friendly.applyPersistedState?.({
      hp: record.hp,
      alive: record.alive,
      level: record.level,
      version: record.version
    });
  };

  const updateActiveFriendlies = (applyTransform) => {
    if (!playerModel) return;
    const activeEntries = [];
    records.forEach((record, id) => {
      if (!record?.pos) return;
      const pos = record.pos;
      if (!Number.isFinite(pos.x) || !Number.isFinite(pos.y) || !Number.isFinite(pos.z)) return;
      const dist = playerModel.position.distanceTo(new THREE.Vector3(pos.x, pos.y, pos.z));
      if (dist <= FRIENDLY_ACTIVE_RADIUS) {
        activeEntries.push({ id, record, dist });
      }
    });
    activeEntries.sort((a, b) => a.dist - b.dist);
    const limitedEntries = activeEntries.slice(0, FRIENDLY_MAX_ACTIVE);
    const activeIds = new Set(limitedEntries.map(entry => entry.id));

    for (let i = friendlies.length - 1; i >= 0; i -= 1) {
      const friendly = friendlies[i];
      if (!friendly || !activeIds.has(friendly.id)) {
        cleanupFriendly(friendly);
        friendlies.splice(i, 1);
      }
    }
    window.friendlies = friendlies;

    limitedEntries.forEach(({ record, id }) => {
      const existing = friendlies.find(entry => entry.id === id);
      if (!existing) {
        spawnFriendly(record);
      } else if (applyTransform) {
        syncFriendlyFromRecord(existing, record, true);
      }
    });
  };

  const applyIncomingRecords = (incoming, { applyTransform = false, syncExisting = true } = {}) => {
    Object.entries(incoming || {}).forEach(([id, record]) => {
      if (!record) return;
      const slotId = record.id || id;
      if (!slotId) return;
      const incomingVersion = Number.isFinite(record.version) ? record.version : null;
      const existing = records.get(slotId);
      const existingVersion = Number.isFinite(existing?.version) ? existing.version : -Infinity;
      if (incomingVersion != null && incomingVersion < existingVersion) {
        return;
      }
      const merged = { ...existing, ...record, id: slotId };
      records.set(slotId, merged);
      const existingFriendly = friendlies.find(entry => entry.id === slotId);
      if (existingFriendly && syncExisting) {
        syncFriendlyFromRecord(existingFriendly, merged, applyTransform);
      }
    });
    refreshSpawnCounterFromRecords();
  };

  const onRoomReady = async ({ roomId, isHost: nextHost } = {}) => {
    if (!roomId) {
      persistenceEnabled = false;
      snapshotLoaded = true;
      return;
    }
    initFriendlyPersistence({
      roomId,
      isHost: nextHost,
      debug
    });
    currentHost = !!nextHost;
    setFriendlyPersistenceHost(currentHost);
    snapshotLoaded = false;
    try {
      const snapshot = await loadFriendliesSnapshot();
      applyIncomingRecords(snapshot, { applyTransform: true, syncExisting: !currentHost });
      snapshotLoaded = true;
      if (unsubscribeUpdates) {
        unsubscribeUpdates();
      }
      unsubscribeUpdates = subscribeFriendlyUpdates(recordsUpdate => {
        applyIncomingRecords(recordsUpdate, { applyTransform: true, syncExisting: !currentHost });
      });
    } catch (err) {
      console.warn('Failed to load friendly snapshot', err);
      snapshotLoaded = true;
    }
  };

  const update = ({ delta, isHost: hostOverride } = {}) => {
    const isHostNow = hostOverride ?? currentHost;
    if (!snapshotLoaded) return;
    const nowMs = Date.now();
    if (isHostNow) {
      maybeSpawnFriendlyFromDistance(delta);
    }
    updateActiveFriendlies(!isHostNow);
    friendlies.forEach((friendly) => {
      if (!friendly?.model) return;
      const lastUpdate = friendly.lastAIUpdateMs ?? 0;
      if (isHostNow) {
        if (nowMs - lastUpdate > FRIENDLY_ANIM_MIN_INTERVAL_MS) {
          friendly.lastAIUpdateMs = nowMs;
          friendly.updateAI(delta, playerModel, otherPlayers);
        }
        persistFriendlyState(friendly);
      } else {
        friendly.update(delta);
      }
    });
  };

  return {
    friendlies,
    setHost,
    onRoomReady,
    update
  };
}

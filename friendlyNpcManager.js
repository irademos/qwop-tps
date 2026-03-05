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
import { createCharacterSpawner } from "./characters/CharacterSpawn.js";

const FRIENDLY_MODELS = [
  "/models/cowboy.fbx"
];
const FRIENDLY_MAX_ACTIVE = 6;
const FRIENDLY_ACTIVE_RADIUS = 360;
const FRIENDLY_PLAYER_SPAWN_BLOCK_RADIUS = 32;
const FRIENDLY_NOTICE_RADIUS = 10;
const FRIENDLY_WANDER_RADIUS = 4;
const FRIENDLY_ENGAGE_RADIUS = 5;
const FRIENDLY_DISENGAGE_RADIUS = 8;
const FRIENDLY_ANIM_MIN_INTERVAL_MS = 150;
const FRIENDLY_AI_MAX_DELTA_SECONDS = 0.5;
const FRIENDLY_BASE_HEALTH = BASE_HEALTH_SEGMENTS;
const FRIENDLY_GROUND_OFFSET = 0.9;

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
  debug = false,
  onSpawnEvent,
  onBeforeSpawn
} = {}) {
  const friendlies = [];
  const records = new Map();
  const spawning = new Set();
  let snapshotLoaded = false;
  let persistenceEnabled = true;
  let unsubscribeUpdates = null;
  let currentHost = !!isHost;
  let spawnedCount = 0;
  const getSpawnNearPlayerPosition = (position) => {
    return getSpawnPosition(position);
  };

  const characterSpawner = createCharacterSpawner({
    getPlayerPosition: () => playerModel?.position?.clone?.() ?? null,
    getSpawnPosition: getSpawnNearPlayerPosition
  });

  const recordGpsTravel = (sample) => {
    characterSpawner.recordGpsTravel(sample);
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

  const removeFriendlyById = (friendlyId) => {
    if (!friendlyId) return false;
    records.delete(friendlyId);
    removeFriendlyRecord(friendlyId);
    const index = friendlies.findIndex(entry => entry?.id === friendlyId);
    if (index >= 0) {
      cleanupFriendly(friendlies[index]);
      friendlies.splice(index, 1);
      window.friendlies = friendlies;
      return true;
    }
    return true;
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
  const maybeSpawnFromDistance = () => {
    if (!playerModel) return;
    const spawnEvent = characterSpawner.getSpawnEvent();
    if (!spawnEvent?.position) return;

    const currentPos = playerModel.position.clone();
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

    if (spawnEvent.type !== 'friendly') {
      void onBeforeSpawn?.(1, spawnEvent.position);
      onSpawnEvent?.(spawnEvent);
      return;
    }

    void onBeforeSpawn?.(1, spawnEvent.position);
    dropFurthestFriendlyRecord(currentPos);
    spawnedCount += 1;
    const slotId = `friendly:distance:${spawnedCount}`;
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
      pos: { x: spawnEvent.position.x, y: spawnEvent.position.y, z: spawnEvent.position.z },
      rot: { x: rot.x, y: rot.y, z: rot.z, w: rot.w }
    };
    records.set(slotId, record);
  };


  const setHost = (nextHost) => {
    currentHost = !!nextHost;
    setFriendlyPersistenceHost(nextHost);
    if (currentHost) {
      characterSpawner.reset();
    }
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
    spawnPos.y = Number.isFinite(terrainHeight) ? terrainHeight + FRIENDLY_GROUND_OFFSET : spawnPos.y;
    liftPositionToBuildingTop?.(spawnPos, FRIENDLY_GROUND_OFFSET);
    return spawnPos;
  };

  const resolveFriendlyPosition = (position) => {
    if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.z)) {
      return null;
    }
    const resolvedPosition = new THREE.Vector3(
      position.x,
      Number.isFinite(position.y) ? position.y : 0,
      position.z
    );
    const terrainHeight = getTerrainHeight?.(resolvedPosition.x, resolvedPosition.z);
    if (Number.isFinite(terrainHeight)) {
      resolvedPosition.y = terrainHeight + FRIENDLY_GROUND_OFFSET;
    }
    liftPositionToBuildingTop?.(resolvedPosition, FRIENDLY_GROUND_OFFSET);
    return resolvedPosition;
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
    const resolvedPosition = applyTransform ? resolveFriendlyPosition(position) : null;
    if (resolvedPosition) {
      friendly.model.position.copy(resolvedPosition);
      friendly.body?.setTranslation({ x: resolvedPosition.x, y: resolvedPosition.y, z: resolvedPosition.z }, true);
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
      if (applyTransform) {
        const resolvedPosition = resolveFriendlyPosition(merged.pos);
        if (resolvedPosition) {
          const priorY = Number.isFinite(merged.pos?.y) ? merged.pos.y : null;
          merged.pos = { x: resolvedPosition.x, y: resolvedPosition.y, z: resolvedPosition.z };
          if (currentHost && priorY != null && Math.abs(priorY - resolvedPosition.y) > 1e-3) {
            const entity = {
              id: slotId,
              type: merged.type,
              modelPath: merged.modelPath || merged.type,
              version: Number.isFinite(merged.version) ? merged.version : 0,
              health: Number.isFinite(merged.hp) ? merged.hp : 0,
              level: Number.isFinite(merged.level) ? merged.level : 1,
              isDead: merged.alive === false,
              model: {
                position: resolvedPosition,
                quaternion: merged.rot || { x: 0, y: 0, z: 0, w: 1 }
              }
            };
            persistFriendlyState(entity);
          }
        }
      }
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
      maybeSpawnFromDistance();
    }
    updateActiveFriendlies(!isHostNow);
    friendlies.forEach((friendly) => {
      if (!friendly?.model) return;
      const lastUpdate = friendly.lastAIUpdateMs ?? 0;
      if (isHostNow) {
        if (nowMs - lastUpdate > FRIENDLY_ANIM_MIN_INTERVAL_MS) {
          const elapsedSeconds = Math.max(0, (nowMs - lastUpdate) / 1000);
          const aiDeltaSeconds = Math.min(
            FRIENDLY_AI_MAX_DELTA_SECONDS,
            lastUpdate > 0 ? elapsedSeconds : (Number.isFinite(delta) ? delta : 0)
          );
          friendly.lastAIUpdateMs = nowMs;
          friendly.updateAI(aiDeltaSeconds, playerModel, otherPlayers);
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
    recordGpsTravel,
    onRoomReady,
    update,
    removeFriendlyById
  };
}

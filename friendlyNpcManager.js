import * as THREE from "three";
import { loadMonsterModel } from "./models/monsterModel.js";
import { FriendlyCharacter } from "./characters/FriendlyCharacter.js";
import {
  initFriendlyPersistence,
  loadFriendliesSnapshot,
  subscribeFriendlyUpdates,
  ensureFriendlyRecord,
  persistFriendlyState,
  setFriendlyPersistenceHost
} from "./friendlyPersistence.js";

const FRIENDLY_MODELS = [
  // "/models/andy.fbx",
  // "/models/chris.fbx",
  // "/models/old_man.fbx"
  "/models/cowboy.fbx"
];
const FRIENDLY_MAX_ACTIVE = 6;
const FRIENDLY_ACTIVE_RADIUS = 360;
const FRIENDLY_SPAWN_SPACING = 150;
const FRIENDLY_NOTICE_RADIUS = 10;
const FRIENDLY_WANDER_RADIUS = 4;
const FRIENDLY_ENGAGE_RADIUS = 5;
const FRIENDLY_DISENGAGE_RADIUS = 8;
const FRIENDLY_ANIM_MIN_INTERVAL_MS = 150;
const FRIENDLY_BASE_HEALTH = 100;
const FRIENDLY_LEVEL_HEALTH_STEP = 0.5;
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
  let lastEnsureAt = 0;
  let currentHost = !!isHost;

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
    return FRIENDLY_BASE_HEALTH * (1 + FRIENDLY_LEVEL_HEALTH_STEP * (clampedLevel - 1));
  };

  const getSpawnPosition = (position) => {
    const spawnPos = position.clone();
    const terrainHeight = getTerrainHeight?.(spawnPos.x, spawnPos.z);
    spawnPos.y = Number.isFinite(terrainHeight) ? terrainHeight + 0.5 : spawnPos.y;
    liftPositionToBuildingTop?.(spawnPos, 0.5);
    return spawnPos;
  };

  const getGridKey = (x, z) => {
    return `friendly:${x}:${z}`;
  };

  const getCandidateSlots = () => {
    if (!playerModel) return [];
    const centerX = Math.round(playerModel.position.x / FRIENDLY_SPAWN_SPACING);
    const centerZ = Math.round(playerModel.position.z / FRIENDLY_SPAWN_SPACING);
    const gridRadius = Math.ceil(FRIENDLY_ACTIVE_RADIUS / FRIENDLY_SPAWN_SPACING);
    const candidates = [];
    for (let gx = centerX - gridRadius; gx <= centerX + gridRadius; gx += 1) {
      for (let gz = centerZ - gridRadius; gz <= centerZ + gridRadius; gz += 1) {
        const worldX = gx * FRIENDLY_SPAWN_SPACING;
        const worldZ = gz * FRIENDLY_SPAWN_SPACING;
        const pos = new THREE.Vector3(worldX, 0, worldZ);
        const dist = playerModel.position.distanceTo(pos);
        if (dist <= FRIENDLY_ACTIVE_RADIUS) {
          candidates.push({ key: getGridKey(gx, gz), pos, dist });
        }
      }
    }
    candidates.sort((a, b) => a.dist - b.dist);
    return candidates.slice(0, FRIENDLY_MAX_ACTIVE);
  };

  const ensureFriendlyRecords = () => {
    if (!playerModel) return;
    const candidates = getCandidateSlots();
    candidates.forEach(({ key, pos }) => {
      if (records.has(key)) return;
      const spawnPos = getSpawnPosition(pos);
      const level = getRandomLevel();
      const hp = getHealthForLevel(level);
      const modelPath = getRandomFriendlyModel();
      const angle = Math.random() * Math.PI * 2;
      const rot = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, angle, 0));
      const record = {
        id: key,
        type: modelPath,
        hp,
        level,
        alive: true,
        pos: { x: spawnPos.x, y: spawnPos.y, z: spawnPos.z },
        rot: { x: rot.x, y: rot.y, z: rot.z, w: rot.w }
      };
      records.set(key, record);
      if (persistenceEnabled) {
        ensureFriendlyRecord({
          id: key,
          modelPath,
          type: modelPath,
          health: hp,
          level,
          isDead: false,
          model: { position: spawnPos, quaternion: rot }
        });
      }
    });
  };

  const cleanupFriendly = (friendly) => {
    if (!friendly) return;
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
          friendly.health = record.hp;
          friendly.model.userData.health = record.hp;
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
    if (isHostNow && nowMs - lastEnsureAt > 5000) {
      lastEnsureAt = nowMs;
      ensureFriendlyRecords();
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

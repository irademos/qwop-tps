import { ref, get, onValue, set, update } from 'firebase/database';
import { db } from './firebase-init.js';

const POSITION_THROTTLE_MS = 2000;
const POSITION_DISTANCE_THRESHOLD = 5;
const DEFAULT_STALE_TTL_MS = 24 * 60 * 60 * 1000;

export function createEntityPersistence({
  collectionKey,
  logPrefix = 'entity',
  staleTtlMs = DEFAULT_STALE_TTL_MS
} = {}) {
  if (!collectionKey) {
    throw new Error('createEntityPersistence requires a collectionKey');
  }

  const state = {
    roomId: null,
    isHost: false,
    debug: false,
    lastPositionMeta: new Map()
  };

  const logDebug = (...args) => {
    if (state.debug) {
      console.log(`[${logPrefix}Persist]`, ...args);
    }
  };

  function getRoomRef() {
    if (!state.roomId) return null;
    return ref(db, `rooms/${state.roomId}/${collectionKey}`);
  }

  function getEntityRef(entityId) {
    if (!state.roomId || !entityId) return null;
    return ref(db, `rooms/${state.roomId}/${collectionKey}/${entityId}`);
  }

  function bumpVersion(entity) {
    const current = Number.isFinite(entity?.version) ? entity.version : 0;
    const next = current + 1;
    if (entity) {
      entity.version = next;
    }
    return next;
  }

  function buildPayload(entity, { includeTransform = false } = {}) {
    const payload = {
      id: entity.id,
      type: entity.modelPath || entity.type || 'unknown',
      hp: Number.isFinite(entity.health) ? entity.health : 0,
      level: Number.isFinite(entity.level) ? entity.level : 1,
      alive: !entity.isDead,
      updatedAt: Date.now(),
      version: bumpVersion(entity)
    };

    if (includeTransform && entity.model) {
      const pos = entity.model.position;
      const rot = entity.model.quaternion;
      if (Number.isFinite(pos?.x) && Number.isFinite(pos?.y) && Number.isFinite(pos?.z)) {
        payload.pos = { x: pos.x, y: pos.y, z: pos.z };
      }
      if (Number.isFinite(rot?.x) && Number.isFinite(rot?.y) && Number.isFinite(rot?.z) && Number.isFinite(rot?.w)) {
        payload.rot = { x: rot.x, y: rot.y, z: rot.z, w: rot.w };
      }
    }

    return payload;
  }

  function getPositionMeta(entityId) {
    if (!state.lastPositionMeta.has(entityId)) {
      state.lastPositionMeta.set(entityId, { lastPos: null, lastPersistAt: 0 });
    }
    return state.lastPositionMeta.get(entityId);
  }

  function init({ roomId, isHost, debug = false } = {}) {
    state.roomId = roomId ?? state.roomId;
    state.isHost = !!isHost;
    state.debug = !!debug;
    logDebug('init', { roomId: state.roomId, isHost: state.isHost });
  }

  function setHost(isHost) {
    state.isHost = !!isHost;
    logDebug('host update', { isHost: state.isHost });
  }

  async function loadSnapshot() {
    const roomRef = getRoomRef();
    if (!roomRef) return {};
    const snapshot = await get(roomRef);
    if (!snapshot.exists()) {
      logDebug('snapshot load 0');
      return {};
    }
    const raw = snapshot.val() || {};
    const now = Date.now();
    const filtered = {};
    Object.entries(raw).forEach(([id, record]) => {
      if (!record) return;
      const updatedAt = Number.isFinite(record.updatedAt) ? record.updatedAt : now;
      if (now - updatedAt > staleTtlMs) return;
      filtered[id] = record;
    });
    logDebug('snapshot load', Object.keys(filtered).length);
    return filtered;
  }

  function subscribeUpdates(cb) {
    const roomRef = getRoomRef();
    if (!roomRef || typeof cb !== 'function') return () => {};
    const unsubscribe = onValue(roomRef, snapshot => {
      cb(snapshot.val() || {});
    });
    return unsubscribe;
  }

  function ensureRecord(entity) {
    if (!state.isHost) return;
    const entityRef = getEntityRef(entity?.id);
    if (!entityRef) return;
    const payload = buildPayload(entity, { includeTransform: true });
    set(entityRef, payload);
    logDebug('persist spawn', entity.id, payload.version);
  }

  function persistHp(entity) {
    if (!state.isHost) return;
    const entityRef = getEntityRef(entity?.id);
    if (!entityRef) return;
    const payload = buildPayload(entity, { includeTransform: false });
    update(entityRef, payload);
    logDebug('persist hp', entity.id, payload.version);
  }

  function persistState(entity) {
    if (!state.isHost || !entity?.model) return;
    const entityRef = getEntityRef(entity?.id);
    if (!entityRef) return;

    const now = Date.now();
    const meta = getPositionMeta(entity.id);
    const pos = entity.model.position;
    if (!Number.isFinite(pos?.x) || !Number.isFinite(pos?.y) || !Number.isFinite(pos?.z)) return;

    let movedFar = false;
    if (meta.lastPos) {
      const dx = pos.x - meta.lastPos.x;
      const dy = pos.y - meta.lastPos.y;
      const dz = pos.z - meta.lastPos.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      movedFar = dist >= POSITION_DISTANCE_THRESHOLD;
    }

    if (!movedFar && now - meta.lastPersistAt < POSITION_THROTTLE_MS) {
      return;
    }

    meta.lastPersistAt = now;
    meta.lastPos = { x: pos.x, y: pos.y, z: pos.z };

    const payload = buildPayload(entity, { includeTransform: true });
    update(entityRef, payload);
    logDebug('persist state', entity.id, payload.version);
  }

  function removeRecord(entityId) {
    if (!state.isHost) return;
    const entityRef = getEntityRef(entityId);
    if (!entityRef) return;
    set(entityRef, null);
    logDebug('persist remove', entityId);
  }

  return {
    init,
    setHost,
    loadSnapshot,
    subscribeUpdates,
    ensureRecord,
    persistHp,
    persistState,
    removeRecord
  };
}

import { ref, get, onValue, set, update } from 'firebase/database';
import { db } from './firebase-init.js';

const POSITION_THROTTLE_MS = 2000;
const POSITION_DISTANCE_THRESHOLD = 5;
const STALE_MONSTER_TTL_MS = 24 * 60 * 60 * 1000;

const state = {
  roomId: null,
  isHost: false,
  debug: false,
  lastPositionMeta: new Map()
};

const logDebug = (...args) => {
  if (state.debug) {
    console.log('[monsterPersist]', ...args);
  }
};

function getRoomMonstersRef() {
  if (!state.roomId) return null;
  return ref(db, `rooms/${state.roomId}/monsters`);
}

function getMonsterRef(monsterId) {
  if (!state.roomId || !monsterId) return null;
  return ref(db, `rooms/${state.roomId}/monsters/${monsterId}`);
}

function bumpVersion(monster) {
  const current = Number.isFinite(monster?.version) ? monster.version : 0;
  const next = current + 1;
  if (monster) {
    monster.version = next;
  }
  return next;
}

function buildMonsterPayload(monster, { includeTransform = false } = {}) {
  const payload = {
    id: monster.id,
    type: monster.modelPath || monster.type || 'unknown',
    hp: Number.isFinite(monster.health) ? monster.health : 0,
    level: Number.isFinite(monster.level) ? monster.level : 1,
    alive: !monster.isDead,
    updatedAt: Date.now(),
    version: bumpVersion(monster)
  };

  if (includeTransform && monster.model) {
    const pos = monster.model.position;
    const rot = monster.model.quaternion;
    if (Number.isFinite(pos?.x) && Number.isFinite(pos?.y) && Number.isFinite(pos?.z)) {
      payload.pos = { x: pos.x, y: pos.y, z: pos.z };
    }
    if (Number.isFinite(rot?.x) && Number.isFinite(rot?.y) && Number.isFinite(rot?.z) && Number.isFinite(rot?.w)) {
      payload.rot = { x: rot.x, y: rot.y, z: rot.z, w: rot.w };
    }
  }

  return payload;
}

function getPositionMeta(monsterId) {
  if (!state.lastPositionMeta.has(monsterId)) {
    state.lastPositionMeta.set(monsterId, { lastPos: null, lastPersistAt: 0 });
  }
  return state.lastPositionMeta.get(monsterId);
}

// How it works:
// - Host writes coarse monster snapshots (hp/alive/type + optional pos/rot).
// - Clients read snapshots on join and optionally listen for new monsters.
// - Position writes are throttled (>=2s or moved >5m) to avoid realtime traffic.
export function initMonsterPersistence({ firebaseApp, roomId, isHost, debug = false } = {}) {
  state.roomId = roomId ?? state.roomId;
  state.isHost = !!isHost;
  state.debug = !!debug;
  logDebug('init', { roomId: state.roomId, isHost: state.isHost });
}

export function setMonsterPersistenceHost(isHost) {
  state.isHost = !!isHost;
  logDebug('host update', { isHost: state.isHost });
}

export async function loadMonstersSnapshot() {
  const roomRef = getRoomMonstersRef();
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
    if (now - updatedAt > STALE_MONSTER_TTL_MS) return;
    filtered[id] = record;
  });
  logDebug('snapshot load', Object.keys(filtered).length);
  return filtered;
}

export function subscribeMonsterUpdates(cb) {
  const roomRef = getRoomMonstersRef();
  if (!roomRef || typeof cb !== 'function') return () => {};
  const unsubscribe = onValue(roomRef, snapshot => {
    cb(snapshot.val() || {});
  });
  return unsubscribe;
}

export function ensureMonsterRecord(monster) {
  if (!state.isHost) return;
  const monsterRef = getMonsterRef(monster?.id);
  if (!monsterRef) return;
  const payload = buildMonsterPayload(monster, { includeTransform: true });
  set(monsterRef, payload);
  logDebug('persist spawn', monster.id, payload.version);
}

export function persistMonsterHp(monster) {
  if (!state.isHost) return;
  const monsterRef = getMonsterRef(monster?.id);
  if (!monsterRef) return;
  const payload = buildMonsterPayload(monster, { includeTransform: false });
  update(monsterRef, payload);
  logDebug('persist hp', monster.id, payload.version);
}

export function persistMonsterState(monster) {
  if (!state.isHost || !monster?.model) return;
  const monsterRef = getMonsterRef(monster?.id);
  if (!monsterRef) return;

  const now = Date.now();
  const meta = getPositionMeta(monster.id);
  const pos = monster.model.position;
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

  const payload = buildMonsterPayload(monster, { includeTransform: true });
  update(monsterRef, payload);
  logDebug('persist state', monster.id, payload.version);
}

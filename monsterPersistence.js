import { createEntityPersistence } from './npcPersistence.js';

const monsterPersistence = createEntityPersistence({
  collectionKey: 'monsters',
  logPrefix: 'monster'
});

// How it works:
// - Host writes coarse monster snapshots (hp/alive/type + optional pos/rot).
// - Clients read snapshots on join and optionally listen for new monsters.
// - Position writes are throttled (>=2s or moved >5m) to avoid realtime traffic.
export const initMonsterPersistence = monsterPersistence.init;
export const setMonsterPersistenceHost = monsterPersistence.setHost;
export const loadMonstersSnapshot = monsterPersistence.loadSnapshot;
export const subscribeMonsterUpdates = monsterPersistence.subscribeUpdates;
export const ensureMonsterRecord = monsterPersistence.ensureRecord;
export const persistMonsterHp = monsterPersistence.persistHp;
export const persistMonsterState = monsterPersistence.persistState;

import { createEntityPersistence } from './npcPersistence.js';

const friendlyPersistence = createEntityPersistence({
  collectionKey: 'friendlies',
  logPrefix: 'friendly'
});

export const initFriendlyPersistence = friendlyPersistence.init;
export const setFriendlyPersistenceHost = friendlyPersistence.setHost;
export const loadFriendliesSnapshot = friendlyPersistence.loadSnapshot;
export const subscribeFriendlyUpdates = friendlyPersistence.subscribeUpdates;
export const ensureFriendlyRecord = friendlyPersistence.ensureRecord;
export const persistFriendlyHp = friendlyPersistence.persistHp;
export const persistFriendlyState = friendlyPersistence.persistState;

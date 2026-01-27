import { ref, get, set, update, runTransaction } from 'firebase/database';
import { db } from './firebase-init.js';
import { getCookie, setCookie } from './utils.js';

const SALT = 'prototype-salt-v1';
const PIN_COOKIE_PREFIX = 'playerPinHash_';

const DEFAULT_STATS = {
  health: 100,
  hunger: 100,
  energy: 100,
  level: 1,
  strength: 5,
  agility: 5,
  smarts: 5,
  charm: 5,
  luck: 5,
  levelKills: 0,
  coins: 0
};
const DEFAULT_INVENTORY = {};
const DEFAULT_HOME_STORAGE = {};

const lastWriteByName = new Map();
const pendingStatsByName = new Map();
const pendingInventoryByName = new Map();
const pendingHomeStorageByName = new Map();
const pendingMetaByName = new Map();
const pendingTimersByName = new Map();

export function normalizeNameKey(name) {
  return name.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_');
}

export async function hashPin(nameKey, pin) {
  const encoder = new TextEncoder();
  const payload = `${nameKey}:${pin}:${SALT}`;
  const data = encoder.encode(payload);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
}

function isValidPin(pin) {
  return /^\d{4,6}$/.test(pin);
}

function pinCookieName(nameKey) {
  return `${PIN_COOKIE_PREFIX}${nameKey}`;
}

function rememberPinHash(nameKey, pinHash) {
  setCookie(pinCookieName(nameKey), pinHash);
}

function buildProfile(name) {
  const now = Date.now();
  return {
    name,
    stats: { ...DEFAULT_STATS },
    inventory: { ...DEFAULT_INVENTORY },
    homeStorage: { ...DEFAULT_HOME_STORAGE },
    lastStatUpdateAt: now,
    createdAt: now,
    updatedAt: now
  };
}

function mergeStats(stats) {
  return { ...DEFAULT_STATS, ...(stats || {}) };
}

async function loadProfileForName(profileRef, trimmedName) {
  const profileSnap = await get(profileRef);
  let profile = profileSnap.val();
  if (!profile) {
    profile = buildProfile(trimmedName);
    await set(profileRef, profile);
    console.log('✅ Created missing profile for', trimmedName);
    return profile;
  }

  const mergedStats = mergeStats(profile.stats);
  const mergedInventory = profile.inventory ? { ...profile.inventory } : { ...DEFAULT_INVENTORY };
  const mergedHomeStorage = profile.homeStorage ? { ...profile.homeStorage } : { ...DEFAULT_HOME_STORAGE };
  const statsMissing = Object.keys(DEFAULT_STATS).some(key => profile.stats?.[key] == null);
  const hasLastStatUpdateAt = Number.isFinite(profile.lastStatUpdateAt);
  const inventoryMissing = profile.inventory == null;
  const homeStorageMissing = profile.homeStorage == null;
  if (statsMissing || !hasLastStatUpdateAt || inventoryMissing || homeStorageMissing) {
    const updatePayload = { updatedAt: Date.now() };
    if (statsMissing) {
      updatePayload.stats = mergedStats;
      profile.stats = mergedStats;
    } else {
      profile.stats = mergedStats;
    }
    if (inventoryMissing) {
      updatePayload.inventory = mergedInventory;
      profile.inventory = mergedInventory;
    } else {
      profile.inventory = mergedInventory;
    }
    if (homeStorageMissing) {
      updatePayload.homeStorage = mergedHomeStorage;
      profile.homeStorage = mergedHomeStorage;
    } else {
      profile.homeStorage = mergedHomeStorage;
    }
    if (!hasLastStatUpdateAt) {
      updatePayload.lastStatUpdateAt = Date.now();
      profile.lastStatUpdateAt = updatePayload.lastStatUpdateAt;
    }
    await update(profileRef, updatePayload);
  } else {
    profile.stats = mergedStats;
    profile.inventory = mergedInventory;
    profile.homeStorage = mergedHomeStorage;
  }

  console.log('✅ Loaded profile for', trimmedName);
  return profile;
}

async function promptForNewPin(name) {
  while (true) {
    const pin = prompt(`Create a 4-6 digit PIN for ${name}`);
    if (pin === null) {
      return null;
    }
    if (!isValidPin(pin)) {
      alert('PIN must be 4–6 digits.');
      continue;
    }
    const confirm = prompt('Confirm your PIN');
    if (confirm === null) {
      return null;
    }
    if (pin !== confirm) {
      alert('PINs do not match.');
      continue;
    }
    return pin;
  }
}

async function promptForLoginPin(name) {
  while (true) {
    const pin = prompt(`Enter PIN for ${name}`);
    if (pin === null) {
      return null;
    }
    if (!isValidPin(pin)) {
      alert('PIN must be 4–6 digits.');
      continue;
    }
    return pin;
  }
}

export function getStoredPinHash(name) {
  if (!name) return null;
  const nameKey = normalizeNameKey(name);
  if (!nameKey) return null;
  return getCookie(pinCookieName(nameKey));
}

export function clearStoredPin(name) {
  if (!name) return;
  const nameKey = normalizeNameKey(name);
  if (!nameKey) return;
  setCookie(pinCookieName(nameKey), '', -1);
}

export async function renameProfile(currentName, currentNameKey, nextName) {
  const trimmedNextName = nextName?.trim();
  const nextNameKey = trimmedNextName ? normalizeNameKey(trimmedNextName) : '';
  if (!trimmedNextName || !nextNameKey) {
    return { status: 'invalid' };
  }
  if (!currentNameKey || currentNameKey === nextNameKey) {
    return { status: 'unchanged', nameKey: currentNameKey || nextNameKey };
  }

  const newClaimRef = ref(db, `nameClaims/${nextNameKey}`);
  const oldClaimRef = ref(db, `nameClaims/${currentNameKey}`);
  const oldProfileRef = ref(db, `profiles/${currentNameKey}`);
  const newProfileRef = ref(db, `profiles/${nextNameKey}`);

  const [newClaimSnap, oldProfileSnap, oldClaimSnap] = await Promise.all([
    get(newClaimRef),
    get(oldProfileRef),
    get(oldClaimRef)
  ]);

  if (newClaimSnap.exists()) {
    return { status: 'taken' };
  }
  if (!oldProfileSnap.exists()) {
    return { status: 'missing-profile' };
  }

  const pinHash = oldClaimSnap.val()?.pinHash || getStoredPinHash(currentName);
  if (!pinHash) {
    return { status: 'missing-pin' };
  }

  const now = Date.now();
  const claimResult = await runTransaction(newClaimRef, current => {
    if (current == null) {
      return { pinHash, createdAt: now, updatedAt: now };
    }
    return;
  });

  if (!claimResult.committed) {
    return { status: 'taken' };
  }

  const oldProfile = oldProfileSnap.val();
  const nextProfile = {
    ...oldProfile,
    name: trimmedNextName,
    updatedAt: now
  };

  await set(newProfileRef, nextProfile);
  await Promise.all([set(oldProfileRef, null), set(oldClaimRef, null)]);
  clearStoredPin(currentName);
  rememberPinHash(nextNameKey, pinHash);

  return { status: 'ok', nameKey: nextNameKey, profile: nextProfile };
}

export async function loadOrCreateWithPin(playerName, options = {}) {
  const trimmedName = playerName.trim();
  const nameKey = normalizeNameKey(trimmedName);
  if (!nameKey) {
    throw new Error('Invalid player name.');
  }
  const requestNewPin = options.requestNewPin || promptForNewPin;
  const requestLoginPin = options.requestLoginPin || promptForLoginPin;
  const onIncorrectPin = options.onIncorrectPin || null;
  const onInvalidPin = options.onInvalidPin || null;
  const useAlerts = options.useAlerts ?? (
    requestNewPin === promptForNewPin && requestLoginPin === promptForLoginPin
  );

  const claimRef = ref(db, `nameClaims/${nameKey}`);
  const profileRef = ref(db, `profiles/${nameKey}`);

  const claimSnap = await get(claimRef);
  if (!claimSnap.exists()) {
    let pin = await requestNewPin(trimmedName);
    while (pin && !isValidPin(pin)) {
      if (useAlerts) {
        alert('PIN must be 4–6 digits.');
      }
      onInvalidPin?.('new');
      pin = await requestNewPin(trimmedName);
    }
    if (!pin) {
      return { canceled: true };
    }
    const pinHash = await hashPin(nameKey, pin);
    const now = Date.now();
    const transactionResult = await runTransaction(claimRef, current => {
      if (current == null) {
        return {
          pinHash,
          createdAt: now,
          updatedAt: now
        };
      }
      return;
    });

    if (transactionResult.committed) {
      const profile = buildProfile(trimmedName);
      await set(profileRef, profile);
      rememberPinHash(nameKey, pinHash);
      console.log('✅ Created new profile for', trimmedName);
      return { nameKey, profile };
    }
  }

  const claim = claimSnap.val();
  const storedPinHash = getCookie(pinCookieName(nameKey));
  if (storedPinHash && claim?.pinHash === storedPinHash) {
    await update(claimRef, { updatedAt: Date.now() });
    const profile = await loadProfileForName(profileRef, trimmedName);
    return { nameKey, profile };
  }

  while (true) {
    const pin = await requestLoginPin(trimmedName);
    if (!pin) {
      return { canceled: true };
    }
    if (!isValidPin(pin)) {
      if (useAlerts) {
        alert('PIN must be 4–6 digits.');
      }
      onInvalidPin?.('login');
      continue;
    }
    const pinHash = await hashPin(nameKey, pin);
    const latestClaimSnap = await get(claimRef);
    const latestClaim = latestClaimSnap.val();
    if (!latestClaim?.pinHash) {
      console.warn('⚠️ Name claim missing for', trimmedName);
    }

    if (latestClaim?.pinHash !== pinHash) {
      console.warn('❌ Incorrect PIN for', trimmedName);
      if (useAlerts) {
        alert('Incorrect PIN. Try again.');
      }
      onIncorrectPin?.();
      continue;
    }

    await update(claimRef, { updatedAt: Date.now() });

    rememberPinHash(nameKey, pinHash);
    const profile = await loadProfileForName(profileRef, trimmedName);
    return { nameKey, profile };
  }
}

async function flushStats(nameKey) {
  pendingTimersByName.delete(nameKey);
  const stats = pendingStatsByName.get(nameKey);
  const inventory = pendingInventoryByName.get(nameKey);
  const homeStorage = pendingHomeStorageByName.get(nameKey);
  const meta = pendingMetaByName.get(nameKey) || {};
  if (!stats && !inventory && !homeStorage) {
    return;
  }
  pendingStatsByName.delete(nameKey);
  pendingInventoryByName.delete(nameKey);
  pendingHomeStorageByName.delete(nameKey);
  pendingMetaByName.delete(nameKey);
  lastWriteByName.set(nameKey, Date.now());
  try {
    const payload = {
      updatedAt: Date.now()
    };
    if (stats) {
      payload.stats = stats;
    }
    if (inventory) {
      payload.inventory = inventory;
    }
    if (homeStorage) {
      payload.homeStorage = homeStorage;
    }
    if (Number.isFinite(meta.lastStatUpdateAt)) {
      payload.lastStatUpdateAt = meta.lastStatUpdateAt;
    }
    await update(ref(db, `profiles/${nameKey}`), payload);
  } catch (error) {
    console.error('Failed to save stats for', nameKey, error);
  }
}

export function saveStatsThrottled(nameKey, stats, lastStatUpdateAt, inventory, homeStorage) {
  if (stats) {
    pendingStatsByName.set(nameKey, { ...stats });
  }
  if (inventory) {
    pendingInventoryByName.set(nameKey, { ...inventory });
  }
  if (homeStorage) {
    pendingHomeStorageByName.set(nameKey, { ...homeStorage });
  }
  if (Number.isFinite(lastStatUpdateAt)) {
    pendingMetaByName.set(nameKey, { lastStatUpdateAt });
  }
  const now = Date.now();
  const lastWrite = lastWriteByName.get(nameKey) ?? 0;
  const delay = Math.max(0, 1000 - (now - lastWrite));

  if (delay === 0) {
    void flushStats(nameKey);
    return;
  }

  if (pendingTimersByName.has(nameKey)) {
    return;
  }

  const timer = setTimeout(() => {
    void flushStats(nameKey);
  }, delay);
  pendingTimersByName.set(nameKey, timer);
}

export async function deleteProfileData(nameKey, playerName) {
  if (!nameKey) {
    return { status: 'missing-key' };
  }
  const pendingTimer = pendingTimersByName.get(nameKey);
  if (pendingTimer) {
    clearTimeout(pendingTimer);
    pendingTimersByName.delete(nameKey);
  }
  pendingStatsByName.delete(nameKey);
  pendingInventoryByName.delete(nameKey);
  pendingHomeStorageByName.delete(nameKey);
  pendingMetaByName.delete(nameKey);
  lastWriteByName.delete(nameKey);

  try {
    await Promise.all([
      set(ref(db, `profiles/${nameKey}`), null),
      set(ref(db, `nameClaims/${nameKey}`), null)
    ]);
    if (playerName) {
      clearStoredPin(playerName);
    }
    return { status: 'ok' };
  } catch (error) {
    console.error('Failed to delete profile data for', nameKey, error);
    return { status: 'error' };
  }
}

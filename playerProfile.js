import { ref, get, set, update, runTransaction } from 'firebase/database';
import { db } from './firebase-init.js';
import { getCookie, setCookie } from './utils.js';
import { BASE_HEALTH_SEGMENTS, normalizeHealthSegments } from './healthUtils.js';
import {
  BASE_HUNGER_SEGMENTS,
  BASE_MAGIC_SEGMENTS,
  HUNGER_MAX_SEGMENTS,
  MAGIC_MAX_SEGMENTS,
  clampHungerSegments,
  clampMagicSegments
} from './statSegments.js';

const SALT = 'prototype-salt-v1';
const PIN_COOKIE_PREFIX = 'playerPinHash_';

const DEFAULT_STATS = {
  health: BASE_HEALTH_SEGMENTS,
  hunger: BASE_HUNGER_SEGMENTS,
  energy: BASE_HUNGER_SEGMENTS,
  magic: BASE_MAGIC_SEGMENTS,
  maxHealthSegments: BASE_HEALTH_SEGMENTS,
  maxHungerSegments: BASE_HUNGER_SEGMENTS,
  maxMagicSegments: BASE_MAGIC_SEGMENTS,
  level: 1,
  strength: 5,
  agility: 5,
  smarts: 5,
  charm: 5,
  luck: 5,
  xp: 0,
  coins: 0
};
const DEFAULT_INVENTORY = {};
const DEFAULT_HOME_STORAGE = {};
const DEFAULT_CUSTOMIZATION = {
  skinTone: null,
  shirts: { selectedId: null, overrides: {} },
  hats: { selectedId: null, overrides: {} }
};
const DEFAULT_SPELLS = {
  shield: true,
  fly: true
};
const DEFAULT_QUESTS = {
  acceptedQuestIds: [],
  completedQuestIds: []
};
const DEFAULT_ACHIEVEMENTS = {
  trackers: {},
  achievements: {}
};
const DEFAULT_WALKING_STATS = {
  totalMiles: 0,
  dailyMiles: {},
  updatedAt: null
};

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
    customization: mergeCustomization(DEFAULT_CUSTOMIZATION),
    spells: { ...DEFAULT_SPELLS },
    quests: mergeQuests(DEFAULT_QUESTS),
    achievements: mergeAchievements(DEFAULT_ACHIEVEMENTS),
    walkingStats: { ...DEFAULT_WALKING_STATS },
    characterModel: null,
    sleepStartedAt: null,
    lastStatUpdateAt: now,
    createdAt: now,
    updatedAt: now
  };
}

function mergeQuests(quests) {
  const acceptedQuestIds = Array.isArray(quests?.acceptedQuestIds)
    ? quests.acceptedQuestIds.filter((id) => typeof id === 'string' && id.trim())
    : [];
  const completedQuestIds = Array.isArray(quests?.completedQuestIds)
    ? quests.completedQuestIds.filter((id) => typeof id === 'string' && id.trim())
    : [];
  return {
    acceptedQuestIds: Array.from(new Set(acceptedQuestIds)),
    completedQuestIds: Array.from(new Set(completedQuestIds))
  };
}


function mergeWalkingStats(walkingStats) {
  const totalMilesRaw = Number(walkingStats?.totalMiles);
  const totalMiles = Number.isFinite(totalMilesRaw) && totalMilesRaw >= 0 ? totalMilesRaw : 0;
  const sourceDaily = walkingStats?.dailyMiles && typeof walkingStats.dailyMiles === 'object' ? walkingStats.dailyMiles : {};
  const dailyMiles = {};
  for (const [date, miles] of Object.entries(sourceDaily)) {
    const parsed = Number(miles);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    if (!Number.isFinite(parsed) || parsed <= 0) continue;
    dailyMiles[date] = parsed;
  }
  const updatedAt = Number.isFinite(walkingStats?.updatedAt) ? walkingStats.updatedAt : null;
  return { totalMiles, dailyMiles, updatedAt };
}

function mergeAchievements(achievements) {
  const trackers = achievements?.trackers && typeof achievements.trackers === 'object'
    ? { ...achievements.trackers }
    : {};
  const statuses = achievements?.achievements && typeof achievements.achievements === 'object'
    ? { ...achievements.achievements }
    : {};
  return { trackers, achievements: statuses };
}

function normalizeStatValue(key, value) {
  const fallback = DEFAULT_STATS[key];
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  if (key === 'level') {
    return Math.max(1, Math.floor(numeric));
  }
  if (key === 'xp' || key === 'coins') {
    return Math.max(0, Math.floor(numeric));
  }
  if (['maxHealthSegments', 'maxHungerSegments', 'maxMagicSegments'].includes(key)) {
    return Math.max(1, Math.round(numeric));
  }
  if (['health', 'hunger', 'energy', 'magic'].includes(key)) {
    return Math.round(numeric);
  }
  return numeric;
}

function mergeStats(stats) {
  const merged = { ...DEFAULT_STATS, ...(stats || {}) };
  const normalized = {};
  for (const key of Object.keys(DEFAULT_STATS)) {
    normalized[key] = normalizeStatValue(key, merged[key]);
  }
  normalized.maxHealthSegments = Math.max(BASE_HEALTH_SEGMENTS, normalized.maxHealthSegments);
  normalized.maxHungerSegments = Math.max(BASE_HUNGER_SEGMENTS, Math.min(HUNGER_MAX_SEGMENTS, normalized.maxHungerSegments));
  normalized.maxMagicSegments = Math.max(BASE_MAGIC_SEGMENTS, Math.min(MAGIC_MAX_SEGMENTS, normalized.maxMagicSegments));
  normalized.health = normalizeHealthSegments(normalized.health, normalized.level, normalized.maxHealthSegments);
  normalized.hunger = clampHungerSegments(normalized.hunger, normalized.maxHungerSegments);
  normalized.energy = normalized.hunger;
  normalized.magic = clampMagicSegments(normalized.magic, normalized.maxMagicSegments);
  return normalized;
}

function mergeCustomization(customization) {
  return {
    skinTone: customization?.skinTone ?? DEFAULT_CUSTOMIZATION.skinTone,
    shirts: {
      selectedId: customization?.shirts?.selectedId ?? null,
      overrides: { ...(customization?.shirts?.overrides || {}) }
    },
    hats: {
      selectedId: customization?.hats?.selectedId ?? null,
      overrides: { ...(customization?.hats?.overrides || {}) }
    }
  };
}

function mergeSpells(spells) {
  return { ...DEFAULT_SPELLS, ...(spells || {}) };
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
  const mergedCustomization = mergeCustomization(profile.customization);
  const mergedSpells = mergeSpells(profile.spells);
  const mergedQuests = mergeQuests(profile.quests);
  const mergedAchievements = mergeAchievements(profile.achievements);
  const mergedCharacterModel = typeof profile.characterModel === 'string' ? profile.characterModel : null;
  const mergedWalkingStats = mergeWalkingStats(profile.walkingStats);
  const statsMissing = Object.keys(DEFAULT_STATS).some(key => profile.stats?.[key] == null);
  const hasLastStatUpdateAt = Number.isFinite(profile.lastStatUpdateAt);
  const inventoryMissing = profile.inventory == null;
  const homeStorageMissing = profile.homeStorage == null;
  const customizationMissing = profile.customization == null
    || profile.customization.shirts == null
    || profile.customization.hats == null;
  const spellsMissing = profile.spells == null;
  const questsMissing = profile.quests == null;
  const achievementsMissing = profile.achievements == null;
  const characterModelMissing = profile.characterModel !== mergedCharacterModel;
  const walkingStatsMissing = profile.walkingStats == null;
  if (statsMissing || !hasLastStatUpdateAt || inventoryMissing || homeStorageMissing || customizationMissing || spellsMissing || questsMissing || achievementsMissing || characterModelMissing || walkingStatsMissing) {
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
    if (customizationMissing) {
      updatePayload.customization = mergedCustomization;
      profile.customization = mergedCustomization;
    } else {
      profile.customization = mergedCustomization;
    }
    if (spellsMissing) {
      updatePayload.spells = mergedSpells;
      profile.spells = mergedSpells;
    } else {
      profile.spells = mergedSpells;
    }
    if (questsMissing) {
      updatePayload.quests = mergedQuests;
      profile.quests = mergedQuests;
    } else {
      profile.quests = mergedQuests;
    }
    if (achievementsMissing) {
      updatePayload.achievements = mergedAchievements;
      profile.achievements = mergedAchievements;
    } else {
      profile.achievements = mergedAchievements;
    }
    if (characterModelMissing) {
      updatePayload.characterModel = mergedCharacterModel;
      profile.characterModel = mergedCharacterModel;
    } else {
      profile.characterModel = mergedCharacterModel;
    }
    if (walkingStatsMissing) {
      updatePayload.walkingStats = mergedWalkingStats;
      profile.walkingStats = mergedWalkingStats;
    } else {
      profile.walkingStats = mergedWalkingStats;
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
    profile.customization = mergedCustomization;
    profile.spells = mergedSpells;
    profile.quests = mergedQuests;
    profile.achievements = mergedAchievements;
    profile.characterModel = mergedCharacterModel;
    profile.walkingStats = mergedWalkingStats;
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

export async function saveStatsImmediate(nameKey, stats, lastStatUpdateAt, inventory, homeStorage) {
  if (!nameKey) return;
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
  const pendingTimer = pendingTimersByName.get(nameKey);
  if (pendingTimer) {
    clearTimeout(pendingTimer);
    pendingTimersByName.delete(nameKey);
  }
  await flushStats(nameKey);
}

export async function saveCustomization(nameKey, customization) {
  if (!nameKey) return;
  try {
    await update(ref(db, `profiles/${nameKey}`), {
      customization: mergeCustomization(customization),
      updatedAt: Date.now()
    });
  } catch (error) {
    console.error('Failed to save customization for', nameKey, error);
  }
}

export async function saveCharacterModel(nameKey, modelPath) {
  if (!nameKey) return;
  if (!modelPath) return;
  try {
    await update(ref(db, `profiles/${nameKey}`), {
      characterModel: modelPath,
      updatedAt: Date.now()
    });
  } catch (error) {
    console.error('Failed to save character model for', nameKey, error);
  }
}

export async function saveSleepTimestamp(nameKey, sleepStartedAt) {
  if (!nameKey) return;
  try {
    await update(ref(db, `profiles/${nameKey}`), {
      sleepStartedAt: Number.isFinite(sleepStartedAt) ? sleepStartedAt : null,
      updatedAt: Date.now()
    });
  } catch (error) {
    console.error('Failed to save sleep timestamp for', nameKey, error);
  }
}

export async function saveQuestState(nameKey, questState) {
  if (!nameKey) return;
  try {
    await update(ref(db, `profiles/${nameKey}`), {
      quests: mergeQuests(questState),
      updatedAt: Date.now()
    });
  } catch (error) {
    console.error('Failed to save quest state for', nameKey, error);
  }
}


export async function saveAchievementState(nameKey, achievementState) {
  if (!nameKey) return;
  try {
    await update(ref(db, `profiles/${nameKey}`), {
      achievements: mergeAchievements(achievementState),
      updatedAt: Date.now()
    });
  } catch (error) {
    console.error('Failed to save achievement state for', nameKey, error);
  }
}

export async function saveWalkingStats(nameKey, walkingStats) {
  if (!nameKey) return;
  try {
    await update(ref(db, `profiles/${nameKey}`), {
      walkingStats: mergeWalkingStats(walkingStats),
      updatedAt: Date.now()
    });
  } catch (error) {
    console.error('Failed to save walking stats for', nameKey, error);
  }
}

export async function getSleepTimestamp(nameKey) {
  if (!nameKey) return null;
  try {
    const snap = await get(ref(db, `profiles/${nameKey}/sleepStartedAt`));
    const value = snap.val();
    return Number.isFinite(value) ? value : null;
  } catch (error) {
    console.error('Failed to fetch sleep timestamp for', nameKey, error);
    return null;
  }
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

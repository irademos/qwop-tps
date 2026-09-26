import { ref, get, set, update, runTransaction, query, orderByChild, limitToLast } from 'firebase/database';
import { db } from '../core/firebase-init.js';
import { getCookie, setCookie } from '../core/utils.js';
import { BASE_HEALTH_SEGMENTS, normalizeHealthSegments } from './healthUtils.js';
const SALT = 'prototype-salt-v1';
const PIN_COOKIE_PREFIX = 'playerPinHash_';

const DEFAULT_STATS = {
  health: BASE_HEALTH_SEGMENTS,
  maxHealthSegments: BASE_HEALTH_SEGMENTS,
  level: 1,
  strength: 5,
  xp: 0,
  coins: 0,
  // Shop purchases
  shieldUpgrades: 0,
  bubbles: 0,
  bombs: 0,
  // Max health (0 = not set yet on profiles from before Showdown kept its own track)
  showdownMaxHealthSegments: 0
};
const DEFAULT_INVENTORY = {};

const DEFAULT_PHONE_SWORD_STATS = {
  kills: 0,
  deaths: 0,
  highestStage: 1
};

const lastWriteByName = new Map();
const pendingStatsByName = new Map();
const pendingInventoryByName = new Map();
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
    lastStatUpdateAt: now,
    createdAt: now,
    updatedAt: now
  };
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
  if (key === 'xp' || key === 'coins' || key === 'shieldUpgrades' || key === 'bubbles' || key === 'bombs' || key === 'showdownMaxHealthSegments') {
    return Math.max(0, Math.floor(numeric));
  }
  if (key === 'maxHealthSegments') {
    return Math.max(1, Math.round(numeric));
  }
  if (key === 'health') {
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
  normalized.health = normalizeHealthSegments(normalized.health, normalized.level, normalized.maxHealthSegments);
  return normalized;
}

// ── Phone Sword leaderboard ──────────────────────────────────────────────────

async function loadPhoneSwordLeaderboardByMetric(metric, limit = 10) {
  const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(50, Math.floor(limit))) : 10;
  const lbQuery = query(
    ref(db, 'profiles'),
    orderByChild(`phoneSwordStats/${metric}`),
    limitToLast(safeLimit)
  );
  const snapshot = await get(lbQuery);
  const entries = [];
  snapshot.forEach((child) => {
    const profile = child.val();
    const psStats = profile?.phoneSwordStats && typeof profile.phoneSwordStats === 'object' ? profile.phoneSwordStats : {};
    const value = Number(psStats[metric]);
    entries.push({
      id: child.key,
      name: typeof profile?.name === 'string' && profile.name.trim() ? profile.name.trim() : child.key,
      value: Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0
    });
  });
  return entries
    .filter(e => e.value > 0)
    .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name))
    .slice(0, safeLimit);
}

export async function loadPhoneSwordLeaderboards(limit = 10) {
  const [killsResult, deathsResult, stageResult] = await Promise.allSettled([
    loadPhoneSwordLeaderboardByMetric('kills', limit),
    loadPhoneSwordLeaderboardByMetric('deaths', limit),
    loadPhoneSwordLeaderboardByMetric('highestStage', limit)
  ]);
  return {
    topKills: killsResult.status === 'fulfilled' ? killsResult.value : [],
    topDeaths: deathsResult.status === 'fulfilled' ? deathsResult.value : [],
    topStage: stageResult.status === 'fulfilled' ? stageResult.value : []
  };
}

export async function savePhoneSwordStats(nameKey, psStats) {
  if (!nameKey || !psStats) return;
  try {
    await update(ref(db, `profiles/${nameKey}/phoneSwordStats`), { ...psStats });
  } catch (err) {
    console.warn('Failed to save phone sword stats:', err);
  }
}

export async function loadPhoneSwordStats(nameKey) {
  if (!nameKey) return { ...DEFAULT_PHONE_SWORD_STATS };
  try {
    const snap = await get(ref(db, `profiles/${nameKey}/phoneSwordStats`));
    const val = snap.val();
    if (!val) return { ...DEFAULT_PHONE_SWORD_STATS };
    return {
      kills: Math.max(0, Math.floor(Number(val.kills) || 0)),
      deaths: Math.max(0, Math.floor(Number(val.deaths) || 0)),
      highestStage: Math.max(1, Math.floor(Number(val.highestStage) || 1))
    };
  } catch (err) {
    console.warn('Failed to load phone sword stats:', err);
    return { ...DEFAULT_PHONE_SWORD_STATS };
  }
}

export async function savePhoneSwordStage(nameKey, stage) {
  if (!nameKey || !Number.isFinite(stage)) return;
  try {
    await update(ref(db, `profiles/${nameKey}/phoneSwordStats`), { currentStage: Math.max(1, Math.floor(stage)) });
  } catch (err) {
    console.warn('Failed to save phone sword stage:', err);
  }
}

export async function loadPhoneSwordStage(nameKey) {
  if (!nameKey) return 1;
  try {
    const snap = await get(ref(db, `profiles/${nameKey}/phoneSwordStats/currentStage`));
    const val = snap.val();
    return Math.max(1, Math.floor(Number(val) || 1));
  } catch (err) {
    console.warn('Failed to load phone sword stage:', err);
    return 1;
  }
}

// Sword Showdown tutorial: profiles/<nameKey>/tutorialCompleted = true once finished
export function hasCompletedTutorial(profile) {
  return profile?.tutorialCompleted === true;
}

export async function saveTutorialCompleted(nameKey) {
  if (!nameKey) return;
  try {
    await update(ref(db, `profiles/${nameKey}`), { tutorialCompleted: true });
  } catch (err) {
    console.warn('Failed to save tutorial completion:', err);
  }
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
  const statsMissing = Object.keys(DEFAULT_STATS).some(key => profile.stats?.[key] == null);
  const hasLastStatUpdateAt = Number.isFinite(profile.lastStatUpdateAt);
  const inventoryMissing = profile.inventory == null;
  if (statsMissing || !hasLastStatUpdateAt || inventoryMissing) {
    const updatePayload = { updatedAt: Date.now() };
    if (statsMissing) {
      updatePayload.stats = mergedStats;
    }
    if (inventoryMissing) {
      updatePayload.inventory = mergedInventory;
    }
    if (!hasLastStatUpdateAt) {
      updatePayload.lastStatUpdateAt = Date.now();
      profile.lastStatUpdateAt = updatePayload.lastStatUpdateAt;
    }
    await update(profileRef, updatePayload);
  }
  profile.stats = mergedStats;
  profile.inventory = mergedInventory;

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
  const meta = pendingMetaByName.get(nameKey) || {};
  if (!stats && !inventory) {
    return;
  }
  pendingStatsByName.delete(nameKey);
  pendingInventoryByName.delete(nameKey);
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
    if (Number.isFinite(meta.lastStatUpdateAt)) {
      payload.lastStatUpdateAt = meta.lastStatUpdateAt;
    }
    await update(ref(db, `profiles/${nameKey}`), payload);
  } catch (error) {
    console.error('Failed to save stats for', nameKey, error);
  }
}

export function saveStatsThrottled(nameKey, stats, lastStatUpdateAt, inventory) {
  if (stats) {
    pendingStatsByName.set(nameKey, { ...stats });
  }
  if (inventory) {
    pendingInventoryByName.set(nameKey, { ...inventory });
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

export async function saveStatsImmediate(nameKey, stats, lastStatUpdateAt, inventory) {
  if (!nameKey) return;
  if (stats) {
    pendingStatsByName.set(nameKey, { ...stats });
  }
  if (inventory) {
    pendingInventoryByName.set(nameKey, { ...inventory });
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

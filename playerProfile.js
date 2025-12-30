import { ref, get, set, update, runTransaction } from 'firebase/database';
import { db } from './firebase-init.js';

const SALT = 'prototype-salt-v1';

const DEFAULT_STATS = {
  health: 100,
  hunger: 100,
  energy: 100,
  strength: 5,
  agility: 5,
  smarts: 5,
  charm: 5,
  luck: 5
};

const lastWriteByName = new Map();
const pendingStatsByName = new Map();
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

function buildProfile(name) {
  const now = Date.now();
  return {
    name,
    stats: { ...DEFAULT_STATS },
    createdAt: now,
    updatedAt: now
  };
}

function mergeStats(stats) {
  return { ...DEFAULT_STATS, ...(stats || {}) };
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

export async function loadOrCreateWithPin(playerName) {
  const trimmedName = playerName.trim();
  const nameKey = normalizeNameKey(trimmedName);
  if (!nameKey) {
    throw new Error('Invalid player name.');
  }

  const claimRef = ref(db, `nameClaims/${nameKey}`);
  const profileRef = ref(db, `profiles/${nameKey}`);

  const claimSnap = await get(claimRef);
  if (!claimSnap.exists()) {
    const pin = await promptForNewPin(trimmedName);
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
      console.log('✅ Created new profile for', trimmedName);
      return { nameKey, profile };
    }
  }

  while (true) {
    const pin = await promptForLoginPin(trimmedName);
    if (!pin) {
      return { canceled: true };
    }
    const pinHash = await hashPin(nameKey, pin);
    const latestClaimSnap = await get(claimRef);
    const claim = latestClaimSnap.val();
    if (!claim?.pinHash) {
      console.warn('⚠️ Name claim missing for', trimmedName);
    }

    if (claim?.pinHash !== pinHash) {
      console.warn('❌ Incorrect PIN for', trimmedName);
      alert('Incorrect PIN. Try again.');
      continue;
    }

    await update(claimRef, { updatedAt: Date.now() });

    const profileSnap = await get(profileRef);
    let profile = profileSnap.val();
    if (!profile) {
      profile = buildProfile(trimmedName);
      await set(profileRef, profile);
      console.log('✅ Created missing profile for', trimmedName);
      return { nameKey, profile };
    }

    const mergedStats = mergeStats(profile.stats);
    const statsMissing = Object.keys(DEFAULT_STATS).some(key => profile.stats?.[key] == null);
    if (statsMissing) {
      await update(profileRef, { stats: mergedStats, updatedAt: Date.now() });
      profile.stats = mergedStats;
    } else {
      profile.stats = mergedStats;
    }

    console.log('✅ Loaded profile for', trimmedName);
    return { nameKey, profile };
  }
}

async function flushStats(nameKey) {
  pendingTimersByName.delete(nameKey);
  const stats = pendingStatsByName.get(nameKey);
  if (!stats) {
    return;
  }
  pendingStatsByName.delete(nameKey);
  lastWriteByName.set(nameKey, Date.now());
  try {
    await update(ref(db, `profiles/${nameKey}`), {
      stats,
      updatedAt: Date.now()
    });
  } catch (error) {
    console.error('Failed to save stats for', nameKey, error);
  }
}

export function saveStatsThrottled(nameKey, stats) {
  pendingStatsByName.set(nameKey, { ...stats });
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

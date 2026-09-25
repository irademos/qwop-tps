import { get, onValue, ref, set } from 'firebase/database';
import { db } from '../core/firebase-init.js';

// Sword Showdown shop: catalog, per-room stock (Firebase) and buy/sell.
const MERCHANT_RESTOCK_MS = 60 * 60 * 1000;
const GUN_BULLETS_ITEM_ID = 'gun bullets';
const HEART_UPGRADE_ITEM_ID = 'heart_upgrade';
const SHIELD_UPGRADE_ITEM_ID = 'shield_upgrade';
const BUBBLE_ITEM_ID = 'bubble';
const SHOWDOWN_BOMB_ITEM_ID = 'showdown_bomb';

const merchantItemCatalog = {
  shield: { name: 'Shield', price: 50, count: 5 },
  pistol: { name: 'Gun', price: 200, count: 1 },
  [GUN_BULLETS_ITEM_ID]: { name: 'Gun Bullets', price: 10, count: 10, ammoAmount: 1 },
  // Upgrades — never sell out, applied immediately via appState.applyShopUpgrade
  [HEART_UPGRADE_ITEM_ID]: { name: 'Heart', price: 350, count: 1, unlimited: true, description: '+1 max health segment' },
  [SHIELD_UPGRADE_ITEM_ID]: { name: 'Shield Upgrade', price: 150, count: 1, unlimited: true, description: '+10 durability for all shields' },
  [BUBBLE_ITEM_ID]: { name: 'Bubble', price: 30, count: 1, unlimited: true, description: '10s protective bubble (tap 🫧 to use)' },
  [SHOWDOWN_BOMB_ITEM_ID]: { name: 'Bomb', price: 20, count: 1, unlimited: true, icon: '/assets/ui/items/bomb.png', description: 'Throwable bomb (tap 💣 to throw)' }
};
const SHOP_UPGRADE_ITEM_IDS = new Set([HEART_UPGRADE_ITEM_ID, SHIELD_UPGRADE_ITEM_ID, BUBBLE_ITEM_ID, SHOWDOWN_BOMB_ITEM_ID]);

let merchantState = {
  items: {},
  lastRestockAt: 0
};
let merchantRoomId = null;
let merchantUnsubscribe = null;
let merchantAppState = null;
let merchantIsHost = false;

const buildDefaultInventory = () => {
  const items = {};
  Object.entries(merchantItemCatalog).forEach(([id, entry]) => {
    items[id] = {
      count: entry.count,
      price: entry.price
    };
  });
  return {
    items,
    lastRestockAt: Date.now()
  };
};

const getMerchantPath = () => {
  if (merchantRoomId) {
    return `rooms/${merchantRoomId}/merchantInventory`;
  }
  return 'merchantInventory';
};

const getMerchantRef = () => ref(db, getMerchantPath());

const sanitizeInventory = (raw) => {
  if (!raw || typeof raw !== 'object') {
    return buildDefaultInventory();
  }
  const safeItems = {};
  Object.entries(merchantItemCatalog).forEach(([id, entry]) => {
    const existing = raw.items?.[id] || {};
    const count = Number.isFinite(existing.count) ? Math.max(0, Math.floor(existing.count)) : entry.count;
    safeItems[id] = {
      count,
      price: entry.price
    };
  });
  return {
    items: safeItems,
    lastRestockAt: Number.isFinite(raw.lastRestockAt) ? raw.lastRestockAt : 0
  };
};

const restockIfNeeded = async (record) => {
  const now = Date.now();
  const lastRestock = Number.isFinite(record.lastRestockAt) ? record.lastRestockAt : 0;
  if (now - lastRestock < MERCHANT_RESTOCK_MS) {
    return record;
  }
  const restocked = buildDefaultInventory();
  merchantState = restocked;
  if (merchantIsHost) {
    await set(getMerchantRef(), restocked);
  }
  return restocked;
};

const persistMerchantState = async () => {
  await set(getMerchantRef(), merchantState);
};

const ensureInventoryLoaded = async () => {
  const snapshot = await get(getMerchantRef());
  if (!snapshot.exists()) {
    merchantState = buildDefaultInventory();
    await set(getMerchantRef(), merchantState);
    return;
  }
  const safe = sanitizeInventory(snapshot.val());
  merchantState = await restockIfNeeded(safe);
  if (merchantIsHost && safe.lastRestockAt !== merchantState.lastRestockAt) {
    await persistMerchantState();
  }
};

const subscribeInventoryUpdates = () => {
  if (merchantUnsubscribe) merchantUnsubscribe();
  merchantUnsubscribe = onValue(getMerchantRef(), async (snapshot) => {
    const safe = sanitizeInventory(snapshot.val());
    merchantState = await restockIfNeeded(safe);
  });
};

export const getMerchantInventory = () => ({ ...merchantState.items });

export const getMerchantItemMeta = (itemId) => {
  const entry = merchantItemCatalog[itemId] || {};
  return {
    name: entry.name || itemId,
    price: entry.price || 0,
    icon: entry.icon || '',
    description: entry.description || '',
    unlimited: !!entry.unlimited
  };
};

export const buyMerchantItem = async (itemId) => {
  const item = merchantState.items?.[itemId];
  if (!item || item.count <= 0) return false;
  const catalogEntry = merchantItemCatalog[itemId] || {};
  const price = Number.isFinite(item.price) ? item.price : getMerchantItemMeta(itemId).price;
  const currentCoins = merchantAppState?.getCoins?.() ?? merchantAppState?.getPlayerStats?.()?.coins ?? 0;
  if (currentCoins < price) return false;
  if (SHOP_UPGRADE_ITEM_IDS.has(itemId)) {
    if (!merchantAppState?.applyShopUpgrade?.(itemId)) return false;
    merchantAppState?.addCoins?.(-price);
    return true;
  }
  if (itemId === GUN_BULLETS_ITEM_ID) {
    const ammoAmount = Number.isFinite(catalogEntry.ammoAmount) ? catalogEntry.ammoAmount : 1;
    merchantAppState?.addPistolAmmo?.(ammoAmount);
  } else {
    merchantAppState?.addToInventory?.(itemId, 1);
  }
  // For pistol, ensure ammo is seeded if buying the gun for the first time
  if (itemId === 'pistol') {
    merchantAppState?.seedPistolAmmoIfNeeded?.();
  }
  merchantAppState?.addCoins?.(-price);
  merchantState.items[itemId] = { ...item, count: item.count - 1 };
  await persistMerchantState();
  return true;
};

export const sellMerchantItem = async (itemId) => {
  const catalogEntry = merchantItemCatalog[itemId] || {};
  if (itemId === GUN_BULLETS_ITEM_ID) {
    const ammoAmount = Number.isFinite(catalogEntry.ammoAmount) ? catalogEntry.ammoAmount : 1;
    const currentAmmo = merchantAppState?.getPistolAmmoCount?.() ?? 0;
    if (currentAmmo < ammoAmount) return false;
    merchantAppState?.addPistolAmmo?.(-ammoAmount);
  } else {
    const inventory = merchantAppState?.getInventory?.() || {};
    const entry = inventory[itemId];
    if (!entry || (entry.count || 0) <= 0) return false;
    merchantAppState?.removeFromInventory?.(itemId, 1);
  }
  const price = getMerchantItemMeta(itemId).price;
  merchantAppState?.addCoins?.(price);
  if (merchantState.items?.[itemId]) {
    const current = merchantState.items[itemId];
    merchantState.items[itemId] = { ...current, count: (current.count || 0) + 1 };
  }
  await persistMerchantState();
  return true;
};

export const initMerchant = async ({ appState, roomId, isHost = false } = {}) => {
  merchantAppState = appState || merchantAppState;
  merchantRoomId = roomId ?? merchantRoomId;
  merchantIsHost = !!isHost;
  await ensureInventoryLoaded();
  subscribeInventoryUpdates();
};

export const setMerchantRoom = async ({ roomId, isHost = false } = {}) => {
  merchantRoomId = roomId ?? merchantRoomId;
  merchantIsHost = !!isHost;
  await ensureInventoryLoaded();
  subscribeInventoryUpdates();
};

export const setMerchantHost = (isHost) => {
  merchantIsHost = !!isHost;
};

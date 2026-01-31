import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { get, onValue, ref, set } from 'firebase/database';
import { db } from '../firebase-init.js';
import { MUSHROOM_ENTRIES } from '../environment/mushrooms.js';
import { loadMonsterModel } from '../models/monsterModel.js';
import { FriendlyCharacter } from './FriendlyCharacter.js';

const MARKET_STALL_MODEL = '/assets/props/market_stall.glb';
const MERCHANT_MODEL = '/models/cowboy.fbx';
const MERCHANT_RESTOCK_MS = 60 * 60 * 1000;
const MARKET_STALL_POSITION = new THREE.Vector3(2, 0, 2);
const MERCHANT_OFFSET = new THREE.Vector3(1.8, 0, -1.2);

const BASE_MERCHANT_ITEMS = {
  autumnSword: { name: 'Autumn Sword', price: 30, count: 1 },
  bow: { name: 'Bow', price: 30, count: 1 },
  bomb: { name: 'Bombs', price: 10, count: 5 },
  lantern: { name: 'Lantern', price: 20, count: 1 },
  apple: { name: 'Apples', price: 2, count: 5 },
  wood: { name: 'Wood', price: 1, count: 15 }
};

const merchantItemCatalog = (() => {
  const catalog = { ...BASE_MERCHANT_ITEMS };
  MUSHROOM_ENTRIES.forEach((entry) => {
    catalog[entry.id] = {
      name: entry.name,
      price: 2,
      count: 5
    };
  });
  return catalog;
})();

let merchantState = {
  items: {},
  lastRestockAt: 0
};
let merchantRoomId = null;
let merchantUnsubscribe = null;
let merchantAppState = null;
let merchantFriendly = null;
let marketStall = null;
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

const setMerchantState = (record) => {
  merchantState = sanitizeInventory(record);
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

const loadMarketStall = async ({ scene, getTerrainHeight, liftPositionToBuildingTop } = {}) => {
  if (!scene) return;
  const loader = new GLTFLoader();
  try {
    const gltf = await loader.loadAsync(MARKET_STALL_MODEL);
    marketStall = gltf.scene;
    marketStall.position.copy(MARKET_STALL_POSITION);
    const terrainHeight = getTerrainHeight?.(marketStall.position.x, marketStall.position.z);
    if (Number.isFinite(terrainHeight)) {
      marketStall.position.y = terrainHeight;
    }
    liftPositionToBuildingTop?.(marketStall.position, 0.5);
    scene.add(marketStall);
  } catch (error) {
    console.warn('Failed to load market stall model.', error);
  }
};

const loadMerchantFriendly = ({
  scene,
  attachPhysics,
  getTerrainHeight,
  liftPositionToBuildingTop
} = {}) => {
  if (!scene) return;
  loadMonsterModel(MERCHANT_MODEL, data => {
    const friendly = new FriendlyCharacter(data);
    friendly.id = 'merchant';
    friendly.modelPath = MERCHANT_MODEL;
    friendly.type = MERCHANT_MODEL;
    friendly.forceEngaged = true;
    friendly.setNoticeRadius(0);
    friendly.setWanderRadius(0);
    friendly.setEngageRadius(999);
    friendly.setDisengageRadius(999);
    friendly.setLevel(1, { preserveHealth: false });
    friendly.resetHealth();
    friendly.model.userData.npcRole = 'merchant';
    friendly.model.userData.mode = 'engaged';
    const basePosition = MARKET_STALL_POSITION.clone().add(MERCHANT_OFFSET);
    const terrainHeight = getTerrainHeight?.(basePosition.x, basePosition.z);
    if (Number.isFinite(terrainHeight)) {
      basePosition.y = terrainHeight + 0.5;
    }
    liftPositionToBuildingTop?.(basePosition, 0.5);
    friendly.setPosition(basePosition.x, basePosition.y, basePosition.z);
    friendly.setHomePosition(basePosition.clone());
    scene.add(friendly.model);
    attachPhysics?.(friendly);
    merchantFriendly = friendly;
    window.merchantFriendly = friendly;
  });
};

export const getMerchantInventory = () => ({ ...merchantState.items });

export const getMerchantItemMeta = (itemId) => {
  const entry = merchantItemCatalog[itemId] || {};
  return {
    name: entry.name || itemId,
    price: entry.price || 0,
    icon: entry.icon || ''
  };
};

export const buyMerchantItem = async (itemId) => {
  const item = merchantState.items?.[itemId];
  if (!item || item.count <= 0) return false;
  const price = Number.isFinite(item.price) ? item.price : getMerchantItemMeta(itemId).price;
  const currentCoins = merchantAppState?.getCoins?.() ?? merchantAppState?.getPlayerStats?.()?.coins ?? 0;
  if (currentCoins < price) return false;
  merchantAppState?.addToInventory?.(itemId, 1);
  merchantAppState?.addCoins?.(-price);
  merchantState.items[itemId] = { ...item, count: item.count - 1 };
  await persistMerchantState();
  return true;
};

export const sellMerchantItem = async (itemId) => {
  const inventory = merchantAppState?.getInventory?.() || {};
  const entry = inventory[itemId];
  if (!entry || (entry.count || 0) <= 0) return false;
  const price = getMerchantItemMeta(itemId).price;
  merchantAppState?.removeFromInventory?.(itemId, 1);
  merchantAppState?.addCoins?.(price);
  if (merchantState.items?.[itemId]) {
    const current = merchantState.items[itemId];
    merchantState.items[itemId] = { ...current, count: (current.count || 0) + 1 };
  }
  await persistMerchantState();
  return true;
};

export const subscribeMerchantInventory = (callback) => {
  const handler = () => {
    if (typeof callback === 'function') {
      callback(getMerchantInventory());
    }
  };
  const unsubscribe = onValue(getMerchantRef(), async (snapshot) => {
    const safe = sanitizeInventory(snapshot.val());
    merchantState = await restockIfNeeded(safe);
    handler();
  });
  return unsubscribe;
};

export const initMerchant = async ({
  scene,
  attachPhysics,
  getTerrainHeight,
  liftPositionToBuildingTop,
  appState,
  roomId,
  isHost = false
} = {}) => {
  merchantAppState = appState || merchantAppState;
  merchantRoomId = roomId ?? merchantRoomId;
  merchantIsHost = !!isHost;
  await ensureInventoryLoaded();
  subscribeInventoryUpdates();
  await loadMarketStall({ scene, getTerrainHeight, liftPositionToBuildingTop });
  loadMerchantFriendly({ scene, attachPhysics, getTerrainHeight, liftPositionToBuildingTop });
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

export const getMerchantFriendly = () => merchantFriendly;

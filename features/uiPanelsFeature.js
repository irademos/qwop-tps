import { showFeatureLoading } from './loadingState.js';
import { initHomeStoragePanel, openHomeStorage, updateUI as updateHomeStorageUI } from '../controls/homeStoragePanel.js';
import { initSettingsPanel, openSettings, updateUI as updateSettingsUI } from '../controls/settingsPanel.js';

export { initHomeStoragePanel, openHomeStorage, updateHomeStorageUI, initSettingsPanel, openSettings, updateSettingsUI };

let craftPromise = null;
let merchantPromise = null;
let merchantPanelModule = null;
let merchantModuleRef = null;
let customizePromise = null;
let spellsPromise = null;

async function loadCraftModule() {
  if (!craftPromise) {
    const hideLoading = showFeatureLoading('Loading crafting');
    craftPromise = import('../controls/craftPanel.js').finally(() => hideLoading());
  }
  return craftPromise;
}

async function loadMerchantModule() {
  if (!merchantPromise) {
    const hideLoading = showFeatureLoading('Loading merchant');
    merchantPromise = Promise.all([
      import('../controls/merchantPanel.js'),
      import('../characters/merchant.js')
    ]).then(([panelModule, merchantModule]) => {
      merchantPanelModule = panelModule;
      merchantModuleRef = merchantModule;
      return { panelModule, merchantModule };
    }).finally(() => hideLoading());
  }
  return merchantPromise;
}

function ensureMerchantLoadedSoon() {
  if (!merchantPromise) {
    void loadMerchantModule();
  }
}

async function loadCustomizeModule() {
  if (!customizePromise) {
    const hideLoading = showFeatureLoading('Loading customization');
    customizePromise = import('../controls/customize.js').finally(() => hideLoading());
  }
  return customizePromise;
}

async function loadSpellsModule() {
  if (!spellsPromise) {
    spellsPromise = import('../controls/spells.js');
  }
  return spellsPromise;
}

export async function getCraftRecipes() {
  const mod = await loadCraftModule();
  return mod.CRAFT_RECIPES;
}

export async function initCraftPanelFeature(params) {
  const mod = await loadCraftModule();
  mod.initCraftPanel(params);
}

export async function openCraftPanelFeature() {
  const mod = await loadCraftModule();
  mod.openCraftPanel();
}

export async function updateCraftUIFeature() {
  const mod = await loadCraftModule();
  mod.updateUI();
}

export async function initMerchantPanelFeature(params) {
  const { panelModule } = await loadMerchantModule();
  panelModule.initMerchantPanel(params);
}

export async function updateMerchantUIFeature() {
  if (!merchantPanelModule) return;
  merchantPanelModule.updateMerchantUI();
}

export async function initMerchantFeature(params) {
  const { merchantModule } = await loadMerchantModule();
  return merchantModule.initMerchant(params);
}


export async function spawnMerchantAtFeature(params) {
  const { merchantModule } = await loadMerchantModule();
  return merchantModule.spawnMerchantAt?.(params);
}

export function getMerchantFriendlyFeature() {
  if (!merchantModuleRef) {
    ensureMerchantLoadedSoon();
    return null;
  }
  return merchantModuleRef.getMerchantFriendly?.();
}

export function setMerchantHostFeature(value) {
  if (!merchantModuleRef) {
    ensureMerchantLoadedSoon();
    return;
  }
  merchantModuleRef.setMerchantHost(value);
}

export async function setMerchantRoomFeature(roomId) {
  const { merchantModule } = await loadMerchantModule();
  merchantModule.setMerchantRoom(roomId);
}

export async function initCustomizeUIFeature(params) {
  const mod = await loadCustomizeModule();
  mod.initCustomizeUI(params);
}

export async function initSpellsFeature(params) {
  const mod = await loadSpellsModule();
  mod.initSpells(params);
}

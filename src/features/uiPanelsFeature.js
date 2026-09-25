import { showFeatureLoading } from './loadingState.js';
import { initSettingsPanel, openSettings, updateUI as updateSettingsUI } from '../controls/settingsPanel.js';

export { initSettingsPanel, openSettings, updateSettingsUI };

let merchantPromise = null;
let merchantPanelModule = null;
let merchantModuleRef = null;

async function loadMerchantModule() {
  if (!merchantPromise) {
    const hideLoading = showFeatureLoading('Loading shop');
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

export function setMerchantHostFeature(value) {
  if (!merchantModuleRef) {
    void loadMerchantModule();
    return;
  }
  merchantModuleRef.setMerchantHost(value);
}

export async function setMerchantRoomFeature(roomId) {
  const { merchantModule } = await loadMerchantModule();
  merchantModule.setMerchantRoom(roomId);
}

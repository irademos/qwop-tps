import { appContext } from '../src/runtime/appContext.js';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const TABS = [
  { id: 'skin', label: 'Skin' },
  { id: 'shirts', label: 'Shirts' },
  { id: 'hats', label: 'Hats' }
];

const SKIN_COLORS = [
  '#f5d7c4',
  '#e5b99a',
  '#d6a07e',
  '#c6866a',
  '#b06d4d',
  '#9a5538',
  '#7f4027',
  '#5f2b1b',
  '#f2c9b6',
  '#e2a98b',
  '#b97b5b',
  '#8f5a3e'
];

const SHIRT_ITEMS = [
  { id: 'vest_armor', label: 'Vest Armor', model: '/models/clothes/vest_armor.glb', offsets: '/models/clothes/vest_armor.json' }
];
const HAT_ITEMS = [];

const DEFAULT_CUSTOMIZATION = {
  skinTone: null,
  shirts: { selectedId: null, overrides: {} },
  hats: { selectedId: null, overrides: {} }
};

const AXIS_ORDER = ['x', 'y', 'z'];
const GROUP_LABELS = {
  position: 'pos',
  scale: 'scale',
  rotation: 'rot'
};
const ADJUST_STEPS = {
  position: 0.1,
  scale: 0.01,
  rotation: 0.05
};

const loader = new GLTFLoader();
const gltfCache = new Map();
const offsetsCache = new Map();
let panel = null;
let tabButtons = new Map();
let tabPanels = new Map();
let activeTab = 'skin';
let getPlayerModel = () => window.playerModel;
let getPlayerControls = () => appContext.systems.playerControls ?? window.playerControls;
let cameraState = null;
const currentClothingBySlot = new Map();
const clothingRequestTokens = new Map();
let customizationState = cloneCustomization(DEFAULT_CUSTOMIZATION);
let onSaveCustomization = null;
let controlsBySlot = new Map();
let tilesBySlot = new Map();

function createElement(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text != null) el.textContent = text;
  return el;
}

function setActiveTab(tabId) {
  if (!tabPanels.size) return;
  activeTab = tabId;
  tabPanels.forEach((panelEl, id) => {
    panelEl.hidden = id !== tabId;
  });
  tabButtons.forEach((button, id) => {
    button.classList.toggle('is-active', id === tabId);
    button.setAttribute('aria-selected', id === tabId ? 'true' : 'false');
  });
}

function setPanelVisibility(show) {
  if (!panel) return;
  panel.classList.toggle('is-open', show);
  panel.setAttribute('aria-hidden', show ? 'false' : 'true');
}

function storeCameraState() {
  const controls = getPlayerControls?.();
  if (!controls) return;
  cameraState = {
    yaw: controls.yaw,
    pitch: controls.pitch
  };
}

function restoreCameraState() {
  const controls = getPlayerControls?.();
  if (!controls || !cameraState) return;
  controls.yaw = cameraState.yaw;
  controls.pitch = cameraState.pitch;
  cameraState = null;
}

function focusCameraOnPlayer() {
  const controls = getPlayerControls?.();
  if (!controls?.playerModel) return;
  storeCameraState();
  controls.yaw = (controls.yaw + Math.PI) % (Math.PI * 2);
  controls.pitch = 0;
}

function applyPlayerColor(color) {
  const playerModel = getPlayerModel?.();
  if (!playerModel) return;
  customizationState.skinTone = color;
  const nextColor = new THREE.Color(color);
  playerModel.traverse((child) => {
    if (!child.isMesh) return;
    if (child.userData?.customizeClothing) return;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.forEach((material) => {
      if (material?.color) {
        material.color.set(nextColor);
        material.needsUpdate = true;
      }
    });
  });
}

function cloneCustomization(data) {
  const source = data || {};
  return {
    skinTone: source.skinTone ?? null,
    shirts: {
      selectedId: source.shirts?.selectedId ?? null,
      overrides: cloneOverrides(source.shirts?.overrides)
    },
    hats: {
      selectedId: source.hats?.selectedId ?? null,
      overrides: cloneOverrides(source.hats?.overrides)
    }
  };
}

function cloneOverrides(overrides) {
  const result = {};
  if (!overrides || typeof overrides !== 'object') {
    return result;
  }
  Object.entries(overrides).forEach(([itemId, value]) => {
    result[itemId] = {
      position: { ...(value?.position || {}) },
      scale: { ...(value?.scale || {}) },
      rotation: { ...(value?.rotation || {}) }
    };
  });
  return result;
}

function getSlotState(slot) {
  return customizationState[slot] || { selectedId: null, overrides: {} };
}

function setSlotSelection(slot, itemId) {
  const slotState = getSlotState(slot);
  slotState.selectedId = itemId;
  customizationState[slot] = slotState;
  updateTileSelection(slot, itemId);
  attachTransformControls(slot, itemId);
}

function updateTileSelection(slot, selectedId) {
  const tileMap = tilesBySlot.get(slot);
  if (!tileMap) return;
  tileMap.forEach((tile, id) => {
    tile.classList.toggle('is-active', id === selectedId);
    if (id !== selectedId) {
      restoreTileLabel(tile);
    }
  });
}

function restoreTileLabel(tile) {
  if (tile.dataset.label != null) {
    tile.textContent = tile.dataset.label;
  }
}

function clearClothing(slot) {
  const currentEntry = currentClothingBySlot.get(slot);
  if (currentEntry?.mesh && currentEntry.mesh.parent) {
    currentEntry.mesh.parent.remove(currentEntry.mesh);
  }
  currentClothingBySlot.delete(slot);
  setSlotSelection(slot, null);
}

function attachTransformControls(slot, selectedId) {
  const tileMap = tilesBySlot.get(slot);
  const controls = controlsBySlot.get(slot);
  if (!tileMap || !controls) return;
  const selectedTile = tileMap.get(selectedId);
  if (!selectedTile) {
    if (controls.parentElement) {
      controls.parentElement.removeChild(controls);
    }
    return;
  }
  if (controls.parentElement && controls.parentElement !== selectedTile) {
    controls.parentElement.removeChild(controls);
  }
  selectedTile.textContent = '';
  selectedTile.appendChild(controls);
}

function findTorsoAnchor(model) {
  let anchor = null;
  model.traverse((child) => {
    if (anchor) return;
    if (child.name && /spine|chest|torso|upper/i.test(child.name)) {
      anchor = child;
    }
  });
  return anchor;
}

function getFallbackTorsoPosition(model) {
  const box = new THREE.Box3().setFromObject(model);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);
  return new THREE.Vector3(center.x, center.y + size.y * 0.15, center.z);
}

async function loadOffsets(url) {
  if (!url) return null;
  if (offsetsCache.has(url)) return offsetsCache.get(url);
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const data = await response.json();
    offsetsCache.set(url, data);
    return data;
  } catch (error) {
    console.warn('Failed to load clothing offsets', error);
    return null;
  }
}

function getGltf(url) {
  if (gltfCache.has(url)) return gltfCache.get(url);
  const promise = new Promise((resolve, reject) => {
    loader.load(url, resolve, undefined, reject);
  });
  gltfCache.set(url, promise);
  return promise;
}

async function loadClothing(item, slot) {
  const playerModel = getPlayerModel?.();
  if (!playerModel) return;
  const requestToken = (clothingRequestTokens.get(slot) || 0) + 1;
  clothingRequestTokens.set(slot, requestToken);
  let gltf = null;
  try {
    gltf = await getGltf(item.model);
  } catch (error) {
    console.warn('Failed to load clothing model', error);
    return;
  }
  if (requestToken !== clothingRequestTokens.get(slot)) {
    return;
  }
  const clothing = gltf.scene.clone(true);
  clothing.name = `customize-${item.id}`;
  clothing.traverse((child) => {
    child.userData.customizeClothing = true;
    if (child.isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });

  const currentEntry = currentClothingBySlot.get(slot);
  if (currentEntry?.mesh && currentEntry.mesh.parent) {
    currentEntry.mesh.parent.remove(currentEntry.mesh);
  }

  const anchor = findTorsoAnchor(playerModel);
  const parent = anchor || playerModel;
  const basePosition = anchor ? new THREE.Vector3() : getFallbackTorsoPosition(playerModel);
  if (!anchor) {
    playerModel.worldToLocal(basePosition);
  }
  const clothingWrapper = new THREE.Group();
  clothingWrapper.name = `customize-wrapper-${item.id}`;
  const clothingBounds = new THREE.Box3().setFromObject(clothing);
  const clothingCenter = new THREE.Vector3();
  clothingBounds.getCenter(clothingCenter);
  clothing.position.sub(clothingCenter);
  clothingWrapper.add(clothing);
  parent.add(clothingWrapper);
  const baseOffsets = (await loadOffsets(item.offsets)) || {};
  const overrides = getSlotState(slot).overrides?.[item.id] || {};
  applyOffsetsToClothing(clothingWrapper, baseOffsets, overrides, basePosition, clothingCenter);
  currentClothingBySlot.set(slot, {
    mesh: clothingWrapper,
    item,
    baseOffsets,
    basePosition,
    center: clothingCenter
  });
}

function applyOffsetsToClothing(clothing, baseOffsets, overrides, basePosition, center = new THREE.Vector3()) {
  const positionOffset = resolveOffsets(baseOffsets?.position, overrides?.position, { x: 0, y: 0, z: 0 });
  const scaleOffset = resolveOffsets(baseOffsets?.scale, overrides?.scale, { x: 1, y: 1, z: 1 });
  const rotationOffset = resolveOffsets(baseOffsets?.rotation, overrides?.rotation, { x: 0, y: 0, z: 0 });
  clothing.position.set(
    basePosition.x + positionOffset.x + center.x,
    basePosition.y + positionOffset.y + center.y,
    basePosition.z + positionOffset.z + center.z
  );
  clothing.scale.set(scaleOffset.x, scaleOffset.y, scaleOffset.z);
  clothing.rotation.set(rotationOffset.x, rotationOffset.y, rotationOffset.z);
}

function resolveOffsets(base, override, fallback) {
  return {
    x: override?.x ?? base?.x ?? fallback.x,
    y: override?.y ?? base?.y ?? fallback.y,
    z: override?.z ?? base?.z ?? fallback.z
  };
}

function buildSkinPanel() {
  const panelEl = createElement('div', 'customize-tab-panel');
  panelEl.dataset.panel = 'skin';

  const swatchList = createElement('div', 'customize-swatch-list');
  SKIN_COLORS.forEach((color) => {
    const swatch = createElement('button', 'customize-swatch');
    swatch.type = 'button';
    swatch.dataset.color = color;
    swatch.style.background = color;
    swatch.setAttribute('aria-label', `Skin color ${color}`);
    swatchList.appendChild(swatch);
  });
  panelEl.appendChild(swatchList);
  return panelEl;
}

function buildShirtsPanel() {
  const panelEl = createElement('div', 'customize-tab-panel');
  panelEl.dataset.panel = 'shirts';

  const grid = createElement('div', 'customize-grid');
  const tileMap = new Map();
  const noneTile = createElement('button', 'customize-tile', 'None');
  noneTile.type = 'button';
  noneTile.dataset.slot = 'shirts';
  noneTile.dataset.none = 'true';
  noneTile.dataset.label = 'None';
  grid.appendChild(noneTile);
  tileMap.set(null, noneTile);
  SHIRT_ITEMS.forEach((item) => {
    const tile = createElement('button', 'customize-tile', item.label);
    tile.type = 'button';
    tile.dataset.clothing = item.id;
    tile.dataset.slot = 'shirts';
    tile.dataset.label = item.label;
    grid.appendChild(tile);
    tileMap.set(item.id, tile);
  });
  panelEl.appendChild(grid);
  tilesBySlot.set('shirts', tileMap);

  const controls = buildTransformControls('shirts');
  controlsBySlot.set('shirts', controls);
  return panelEl;
}

function buildHatsPanel() {
  const panelEl = createElement('div', 'customize-tab-panel');
  panelEl.dataset.panel = 'hats';
  const grid = createElement('div', 'customize-grid');
  const tileMap = new Map();
  const noneTile = createElement('button', 'customize-tile', 'None');
  noneTile.type = 'button';
  noneTile.dataset.slot = 'hats';
  noneTile.dataset.none = 'true';
  noneTile.dataset.label = 'None';
  grid.appendChild(noneTile);
  tileMap.set(null, noneTile);
  if (!HAT_ITEMS.length) {
    const empty = createElement('div', 'customize-empty', 'No hats available yet.');
    panelEl.appendChild(empty);
  } else {
    HAT_ITEMS.forEach((item) => {
      const tile = createElement('button', 'customize-tile', item.label);
      tile.type = 'button';
      tile.dataset.clothing = item.id;
      tile.dataset.slot = 'hats';
      tile.dataset.label = item.label;
      grid.appendChild(tile);
      tileMap.set(item.id, tile);
    });
  }
  panelEl.appendChild(grid);
  tilesBySlot.set('hats', tileMap);
  const controls = buildTransformControls('hats');
  controlsBySlot.set('hats', controls);
  return panelEl;
}

function buildTransformControls(slot) {
  const wrapper = createElement('div', 'customize-transform');
  wrapper.dataset.slot = slot;
  Object.entries(GROUP_LABELS).forEach(([group, label]) => {
    const groupRow = createElement('div', 'customize-transform-group');
    const groupLabel = createElement('span', 'customize-transform-label', label);
    groupRow.appendChild(groupLabel);
    AXIS_ORDER.forEach((axis) => {
      const axisGroup = createElement('div', 'customize-transform-axis');
      const axisLabel = createElement('span', 'customize-transform-axis-label', axis);
      const upButton = createElement('button', 'customize-adjust', '▲');
      const downButton = createElement('button', 'customize-adjust', '▼');
      upButton.type = 'button';
      downButton.type = 'button';
      upButton.dataset.slot = slot;
      downButton.dataset.slot = slot;
      upButton.dataset.group = group;
      downButton.dataset.group = group;
      upButton.dataset.axis = axis;
      downButton.dataset.axis = axis;
      upButton.dataset.direction = 'up';
      downButton.dataset.direction = 'down';
      axisGroup.append(axisLabel, upButton, downButton);
      groupRow.appendChild(axisGroup);
    });
    wrapper.appendChild(groupRow);
  });
  return wrapper;
}

function buildPanel() {
  panel = createElement('section', 'customize-panel');
  panel.id = 'customize-panel';
  panel.setAttribute('aria-hidden', 'true');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Customize character');

  const header = createElement('div', 'customize-header');
  const title = createElement('h2', 'customize-title', 'Customize');
  const closeButton = createElement('button', 'customize-close', '✕');
  closeButton.type = 'button';
  closeButton.setAttribute('aria-label', 'Close customization');
  header.append(title, closeButton);

  const content = createElement('div', 'customize-content');
  const skinPanel = buildSkinPanel();
  const shirtsPanel = buildShirtsPanel();
  const hatsPanel = buildHatsPanel();
  content.append(skinPanel, shirtsPanel, hatsPanel);
  tabPanels.set('skin', skinPanel);
  tabPanels.set('shirts', shirtsPanel);
  tabPanels.set('hats', hatsPanel);

  const tablist = createElement('div', 'customize-tabs');
  tablist.setAttribute('role', 'tablist');
  TABS.forEach((tab) => {
    const button = createElement('button', 'customize-tab', tab.label);
    button.type = 'button';
    button.dataset.tab = tab.id;
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-selected', 'false');
    tablist.appendChild(button);
    tabButtons.set(tab.id, button);
  });

  panel.append(header, content, tablist);
  document.body.appendChild(panel);

  closeButton.addEventListener('click', () => {
    closeCustomizeUI();
  });

  panel.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.dataset.tab) {
      setActiveTab(target.dataset.tab);
      return;
    }
    if (target.dataset.color) {
      applyPlayerColor(target.dataset.color);
      return;
    }
    if (target.dataset.none) {
      const slot = target.dataset.slot || 'shirts';
      clearClothing(slot);
      return;
    }
    if (target.dataset.clothing) {
      const slot = target.dataset.slot || 'shirts';
      const items = slot === 'hats' ? HAT_ITEMS : SHIRT_ITEMS;
      const item = items.find((entry) => entry.id === target.dataset.clothing);
      if (item) {
        setSlotSelection(slot, item.id);
        loadClothing(item, slot);
      }
      return;
    }
    if (target.dataset.direction && target.dataset.group && target.dataset.axis) {
      const slot = target.dataset.slot || 'shirts';
      adjustClothingTransform(slot, target.dataset.group, target.dataset.axis, target.dataset.direction);
    }
  });

  setActiveTab(activeTab);
}

function adjustClothingTransform(slot, group, axis, direction) {
  const currentEntry = currentClothingBySlot.get(slot);
  if (!currentEntry?.mesh) return;
  const step = ADJUST_STEPS[group] || 0;
  const delta = direction === 'down' ? -step : step;
  const slotState = getSlotState(slot);
  if (!slotState.selectedId) return;
  const itemId = slotState.selectedId;
  const overrides = slotState.overrides?.[itemId] || {};
  const baseOffsets = currentEntry.baseOffsets || {};
  const basePosition = currentEntry.basePosition || new THREE.Vector3();
  const center = currentEntry.center || new THREE.Vector3();

  const currentOffsets = {
    position: resolveOffsets(baseOffsets.position, overrides.position, { x: 0, y: 0, z: 0 }),
    scale: resolveOffsets(baseOffsets.scale, overrides.scale, { x: 1, y: 1, z: 1 }),
    rotation: resolveOffsets(baseOffsets.rotation, overrides.rotation, { x: 0, y: 0, z: 0 })
  };
  currentOffsets[group][axis] = (currentOffsets[group][axis] || 0) + delta;

  const nextOverrides = {
    position: { ...(overrides.position || {}) },
    scale: { ...(overrides.scale || {}) },
    rotation: { ...(overrides.rotation || {}) }
  };
  nextOverrides[group][axis] = currentOffsets[group][axis];
  slotState.overrides = { ...(slotState.overrides || {}), [itemId]: nextOverrides };
  customizationState[slot] = slotState;
  applyOffsetsToClothing(currentEntry.mesh, baseOffsets, nextOverrides, basePosition, center);
}

function applyCustomizationState() {
  if (customizationState.skinTone) {
    applyPlayerColor(customizationState.skinTone);
  }
  if (customizationState.shirts?.selectedId) {
    const item = SHIRT_ITEMS.find((entry) => entry.id === customizationState.shirts.selectedId);
    if (item) {
      setSlotSelection('shirts', item.id);
      loadClothing(item, 'shirts');
    }
  } else {
    clearClothing('shirts');
  }
  if (customizationState.hats?.selectedId) {
    const item = HAT_ITEMS.find((entry) => entry.id === customizationState.hats.selectedId);
    if (item) {
      setSlotSelection('hats', item.id);
      loadClothing(item, 'hats');
    }
  } else {
    clearClothing('hats');
  }
}

export function initCustomizeUI({
  getPlayerModel: getModel,
  getPlayerControls: getControls,
  initialCustomization,
  onSaveCustomization: handleSaveCustomization
} = {}) {
  if (panel) return;
  if (typeof getModel === 'function') getPlayerModel = getModel;
  if (typeof getControls === 'function') getPlayerControls = getControls;
  if (typeof initialCustomization !== 'undefined') {
    customizationState = cloneCustomization(initialCustomization);
  }
  if (typeof handleSaveCustomization === 'function') {
    onSaveCustomization = handleSaveCustomization;
  }
  buildPanel();
  applyCustomizationState();
}

export function openCustomizeUI() {
  if (!panel) buildPanel();
  setPanelVisibility(true);
  focusCameraOnPlayer();
}

export function closeCustomizeUI() {
  if (!panel) return;
  setPanelVisibility(false);
  restoreCameraState();
  if (onSaveCustomization) {
    const result = onSaveCustomization(cloneCustomization(customizationState));
    if (result && typeof result.catch === 'function') {
      result.catch((error) => {
        console.warn('Failed to save customization', error);
      });
    }
  }
}

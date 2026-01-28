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

const CLOTHING_ITEMS = [
  { id: 'vest', label: 'Vest', model: '/models/clothes/vest.glb', offsets: '/models/clothes/vest.json' },
  { id: 'vest_armor', label: 'Vest Armor', model: '/models/clothes/vest_armor.glb', offsets: '/models/clothes/vest_armor.json' },
  { id: 'vest_rainbow', label: 'Vest Rainbow', model: '/models/clothes/vest_rainbow.glb', offsets: '/models/clothes/vest_rainbow.json' }
];

const loader = new GLTFLoader();
const gltfCache = new Map();
const offsetsCache = new Map();
let panel = null;
let tabButtons = new Map();
let tabPanels = new Map();
let activeTab = 'skin';
let getPlayerModel = () => window.playerModel;
let getPlayerControls = () => window.playerControls;
let cameraState = null;
let currentClothing = null;

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

async function loadClothing(item) {
  const playerModel = getPlayerModel?.();
  if (!playerModel) return;
  let gltf = null;
  try {
    gltf = await getGltf(item.model);
  } catch (error) {
    console.warn('Failed to load clothing model', error);
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

  if (currentClothing && currentClothing.parent) {
    currentClothing.parent.remove(currentClothing);
  }

  const anchor = findTorsoAnchor(playerModel);
  const parent = anchor || playerModel;
  parent.add(clothing);
  const basePosition = anchor ? new THREE.Vector3() : getFallbackTorsoPosition(playerModel);
  if (!anchor) {
    playerModel.worldToLocal(basePosition);
  }
  const offsets = (await loadOffsets(item.offsets)) || {};
  const positionOffset = offsets.position || {};
  const scaleOffset = offsets.scale || {};
  const rotationOffset = offsets.rotation || {};
  clothing.position.set(
    basePosition.x + (positionOffset.x || 0),
    basePosition.y + (positionOffset.y || 0),
    basePosition.z + (positionOffset.z || 0)
  );
  clothing.scale.set(
    scaleOffset.x != null ? scaleOffset.x : 1,
    scaleOffset.y != null ? scaleOffset.y : 1,
    scaleOffset.z != null ? scaleOffset.z : 1
  );
  clothing.rotation.set(
    rotationOffset.x || 0,
    rotationOffset.y || 0,
    rotationOffset.z || 0
  );
  currentClothing = clothing;
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
  CLOTHING_ITEMS.forEach((item) => {
    const tile = createElement('button', 'customize-tile', item.label);
    tile.type = 'button';
    tile.dataset.clothing = item.id;
    grid.appendChild(tile);
  });
  panelEl.appendChild(grid);
  return panelEl;
}

function buildHatsPanel() {
  const panelEl = createElement('div', 'customize-tab-panel');
  panelEl.dataset.panel = 'hats';
  const empty = createElement('div', 'customize-empty', 'No hats available yet.');
  panelEl.appendChild(empty);
  return panelEl;
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
    if (target.dataset.clothing) {
      const item = CLOTHING_ITEMS.find((entry) => entry.id === target.dataset.clothing);
      if (item) {
        loadClothing(item);
      }
    }
  });

  setActiveTab(activeTab);
}

export function initCustomizeUI({ getPlayerModel: getModel, getPlayerControls: getControls } = {}) {
  if (panel) return;
  if (typeof getModel === 'function') getPlayerModel = getModel;
  if (typeof getControls === 'function') getPlayerControls = getControls;
  buildPanel();
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
}

import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';

const TAB_KEY = 'settings:lastTab';

const TABS = [
  { id: 'character', label: 'Character' },
  { id: 'multiplayer', label: 'Multiplayer' },
  { id: 'location', label: 'Location' },
  { id: 'developer', label: 'Developer' }
];

let overlay;
let panel;
let context = {};
let elements = {};
let activeTab = 'character';
let lastFocusedElement = null;
let isMobileView = false;
let isListView = false;
let previewState = {
  active: false,
  renderer: null,
  scene: null,
  camera: null,
  model: null,
  frameId: null,
  loadingToken: null,
  resizeObserver: null
};

function createElement(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text) el.textContent = text;
  return el;
}

function formatTimestamp(ts) {
  if (!ts) return '—';
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString();
}

function formatDistance(distance) {
  if (typeof distance !== 'number' || Number.isNaN(distance)) return '—';
  if (distance < 1000) return `${distance.toFixed(0)} m`;
  return `${(distance / 1000).toFixed(2)} km`;
}

function formatCoordinate(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) return '—';
  return value.toFixed(6);
}

function formatMeters(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) return '—';
  return value.toFixed(2);
}

function buildHeader() {
  const header = createElement('div', 'settings-header');
  const backButton = createElement('button', 'settings-back', 'Back');
  backButton.type = 'button';
  backButton.dataset.action = 'back';
  backButton.setAttribute('aria-label', 'Back to settings list');
  const title = createElement('h2', 'settings-title', 'Settings');
  title.id = 'settings-title';
  title.tabIndex = 0;
  const closeButton = createElement('button', 'settings-close', '✕');
  closeButton.type = 'button';
  closeButton.setAttribute('aria-label', 'Close settings');
  closeButton.dataset.action = 'close';
  header.append(backButton, title, closeButton);
  elements.backButton = backButton;
  elements.title = title;
  elements.closeButton = closeButton;
  return header;
}

function buildTabs() {
  const tablist = createElement('div', 'settings-tabs');
  tablist.setAttribute('role', 'tablist');
  elements.tabs = {};

  TABS.forEach(tab => {
    const button = createElement('button', 'settings-tab', tab.label);
    button.type = 'button';
    button.id = `tab-${tab.id}`;
    button.dataset.tab = tab.id;
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-selected', 'false');
    button.setAttribute('aria-controls', `panel-${tab.id}`);
    tablist.appendChild(button);
    elements.tabs[tab.id] = button;
  });

  return tablist;
}

function buildCharacterPanel() {
  const panelEl = createElement('section', 'settings-tabpanel');
  panelEl.id = 'panel-character';
  panelEl.dataset.panel = 'character';
  panelEl.setAttribute('role', 'tabpanel');
  panelEl.setAttribute('aria-labelledby', 'tab-character');

  const nameGroup = createElement('div', 'settings-field');
  const nameLabel = createElement('label', 'settings-label', 'Name');
  nameLabel.setAttribute('for', 'settings-name-input');
  const nameInput = createElement('input', 'settings-input');
  nameInput.id = 'settings-name-input';
  nameInput.type = 'text';
  nameInput.autocomplete = 'nickname';
  nameGroup.append(nameLabel, nameInput);

  const characterGroup = createElement('div', 'settings-field');
  const characterLabel = createElement('label', 'settings-label', 'Character');
  characterLabel.setAttribute('for', 'settings-character-select');
  const characterSelect = createElement('select', 'settings-select');
  characterSelect.id = 'settings-character-select';
  characterGroup.append(characterLabel, characterSelect);

  const previewWrapper = createElement('div', 'character-preview');
  const previewCanvas = document.createElement('canvas');
  previewCanvas.className = 'character-preview-canvas';
  const previewFallback = createElement('div', 'character-preview-fallback', 'Preview unavailable');
  previewWrapper.append(previewCanvas, previewFallback);

  panelEl.append(nameGroup, characterGroup, previewWrapper);

  elements.nameInput = nameInput;
  elements.characterSelect = characterSelect;
  elements.previewCanvas = previewCanvas;
  elements.previewFallback = previewFallback;

  return panelEl;
}

function buildMultiplayerPanel() {
  const panelEl = createElement('section', 'settings-tabpanel');
  panelEl.id = 'panel-multiplayer';
  panelEl.dataset.panel = 'multiplayer';
  panelEl.setAttribute('role', 'tabpanel');
  panelEl.setAttribute('aria-labelledby', 'tab-multiplayer');

  const statusRow = createElement('div', 'settings-row');
  statusRow.innerHTML = '<span>Connection Status</span><span data-field="connection-status">—</span>';
  const pingRow = createElement('div', 'settings-row');
  pingRow.innerHTML = '<span>Ping</span><span data-field="ping">N/A</span>';

  const playersTitle = createElement('h3', 'settings-section-title', 'Connected Players');
  const playersList = createElement('ul', 'settings-list');
  playersList.dataset.field = 'players';

  const reconnectButton = createElement('button', 'settings-button', 'Reconnect');
  reconnectButton.type = 'button';
  reconnectButton.dataset.action = 'reconnect';

  const errorTitle = createElement('h3', 'settings-section-title', 'Connection Issues');
  const errorText = createElement('div', 'settings-muted');
  errorText.dataset.field = 'connection-error';
  errorText.textContent = 'None';

  panelEl.append(statusRow, pingRow, playersTitle, playersList, reconnectButton, errorTitle, errorText);

  elements.connectionStatus = statusRow.querySelector('[data-field="connection-status"]');
  elements.ping = pingRow.querySelector('[data-field="ping"]');
  elements.playersList = playersList;
  elements.connectionError = errorText;

  return panelEl;
}

function buildLocationPanel() {
  const panelEl = createElement('section', 'settings-tabpanel');
  panelEl.id = 'panel-location';
  panelEl.dataset.panel = 'location';
  panelEl.setAttribute('role', 'tabpanel');
  panelEl.setAttribute('aria-labelledby', 'tab-location');

  const rows = [
    ['Status', 'location-status'],
    ['Accuracy', 'location-accuracy'],
    ['Latitude', 'location-lat'],
    ['Longitude', 'location-lon'],
    ['Heading', 'location-heading'],
    ['Speed', 'location-speed'],
    ['Last Fix', 'location-time']
  ];

  rows.forEach(([label, field]) => {
    const row = createElement('div', 'settings-row');
    row.innerHTML = `<span>${label}</span><span data-field="${field}">—</span>`;
    panelEl.appendChild(row);
  });

  const guidance = createElement('div', 'settings-muted');
  guidance.dataset.field = 'location-guidance';
  guidance.textContent = '';

  const retryButton = createElement('button', 'settings-button', 'Retry');
  retryButton.type = 'button';
  retryButton.dataset.action = 'location-retry';

  panelEl.append(guidance, retryButton);

  elements.locationFields = {
    status: panelEl.querySelector('[data-field="location-status"]'),
    accuracy: panelEl.querySelector('[data-field="location-accuracy"]'),
    lat: panelEl.querySelector('[data-field="location-lat"]'),
    lon: panelEl.querySelector('[data-field="location-lon"]'),
    heading: panelEl.querySelector('[data-field="location-heading"]'),
    speed: panelEl.querySelector('[data-field="location-speed"]'),
    time: panelEl.querySelector('[data-field="location-time"]'),
    guidance
  };

  return panelEl;
}

function buildDeveloperPanel() {
  const panelEl = createElement('section', 'settings-tabpanel');
  panelEl.id = 'panel-developer';
  panelEl.dataset.panel = 'developer';
  panelEl.setAttribute('role', 'tabpanel');
  panelEl.setAttribute('aria-labelledby', 'tab-developer');

  const consoleButton = createElement('button', 'settings-button', 'Show Console');
  consoleButton.type = 'button';
  consoleButton.dataset.action = 'toggle-console';

  const copyDebugButton = createElement('button', 'settings-button', 'Copy Debug Info');
  copyDebugButton.type = 'button';
  copyDebugButton.dataset.action = 'copy-debug';

  const resetOriginButton = createElement('button', 'settings-button', 'Reset Origin');
  resetOriginButton.type = 'button';
  resetOriginButton.dataset.action = 'reset-origin';

  const levelBuilderButton = createElement('button', 'settings-button', 'Level Builder');
  levelBuilderButton.type = 'button';
  levelBuilderButton.id = 'level-builder-button';

  const originSection = createElement('div', 'settings-section');
  const originRows = [
    ['Origin', 'debug-origin'],
    ['Current', 'debug-current'],
    ['Player (x,z)', 'debug-player'],
    ['Tile', 'debug-tile']
  ];
  originRows.forEach(([label, field]) => {
    const row = createElement('div', 'settings-row');
    row.innerHTML = `<span>${label}</span><span data-field="${field}">—</span>`;
    originSection.appendChild(row);
  });

  const consoleLog = createElement('div', 'settings-console');
  consoleLog.id = 'console-log';
  consoleLog.style.display = 'none';

  panelEl.append(
    consoleButton,
    copyDebugButton,
    resetOriginButton,
    levelBuilderButton,
    originSection,
    consoleLog
  );
  elements.consoleButton = consoleButton;
  elements.consoleLog = consoleLog;
  elements.debugFields = {
    origin: originSection.querySelector('[data-field="debug-origin"]'),
    current: originSection.querySelector('[data-field="debug-current"]'),
    player: originSection.querySelector('[data-field="debug-player"]'),
    tile: originSection.querySelector('[data-field="debug-tile"]')
  };

  return panelEl;
}

function buildPanels() {
  const body = createElement('div', 'settings-body');
  const characterPanel = buildCharacterPanel();
  const multiplayerPanel = buildMultiplayerPanel();
  const locationPanel = buildLocationPanel();
  const developerPanel = buildDeveloperPanel();
  body.append(characterPanel, multiplayerPanel, locationPanel, developerPanel);
  elements.panels = {
    character: characterPanel,
    multiplayer: multiplayerPanel,
    location: locationPanel,
    developer: developerPanel
  };
  return body;
}

function setActiveTab(tabId) {
  const newTab = elements.tabs?.[tabId];
  const newPanel = elements.panels?.[tabId];
  if (!newTab || !newPanel) return;
  activeTab = tabId;
  localStorage.setItem(TAB_KEY, tabId);

  Object.entries(elements.tabs).forEach(([id, button]) => {
    const isActive = id === tabId;
    button.setAttribute('aria-selected', isActive ? 'true' : 'false');
    button.classList.toggle('is-active', isActive);
  });

  Object.entries(elements.panels).forEach(([id, panelEl]) => {
    const isActive = id === tabId;
    panelEl.hidden = !isActive;
  });

  if (isMobileView) {
    setListView(false);
  }

  if (tabId === 'character') {
    startPreview();
  } else {
    stopPreview();
  }
}

function openOverlay() {
  if (!overlay) return;
  lastFocusedElement = document.activeElement;
  overlay.style.display = 'flex';
  overlay.setAttribute('aria-hidden', 'false');
  refreshLayout();
  if (isMobileView) {
    setListView(true);
  } else {
    panel?.focus?.();
  }
  if (activeTab === 'character') {
    startPreview();
  }
  updateUI();
}

function closeOverlay() {
  if (!overlay) return;
  overlay.style.display = 'none';
  overlay.setAttribute('aria-hidden', 'true');
  stopPreview();
  if (lastFocusedElement && typeof lastFocusedElement.focus === 'function') {
    lastFocusedElement.focus();
  }
}

function handleAction(target) {
  const action = target.dataset.action;
  if (!action) return;
  if (action === 'close') {
    closeOverlay();
  } else if (action === 'back') {
    if (isMobileView) {
      setListView(true);
    }
  } else if (action === 'reconnect') {
    context.multiplayer?.reconnect?.();
  } else if (action === 'location-retry') {
    context.location?.retry?.();
  } else if (action === 'toggle-console') {
    const visible = elements.consoleLog.style.display === 'block';
    elements.consoleLog.style.display = visible ? 'none' : 'block';
    elements.consoleButton.textContent = visible ? 'Show Console' : 'Hide Console';
  } else if (action === 'copy-debug') {
    const info = collectDebugInfo();
    navigator.clipboard?.writeText?.(info);
  } else if (action === 'reset-origin') {
    context.appState?.resetWorldOrigin?.();
  }
}

function bindEvents() {
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) {
      closeOverlay();
    }
  });

  panel.addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.dataset.tab) {
      setTab(button.dataset.tab);
      return;
    }
    if (button.dataset.action) {
      handleAction(button);
    }
  });

  elements.nameInput.addEventListener('input', (event) => {
    const value = event.target.value.trim();
    if (value) {
      context.appState?.setPlayerName?.(value);
    }
  });

  elements.nameInput.addEventListener('blur', (event) => {
    if (!event.target.value.trim()) {
      event.target.value = context.appState?.getPlayerName?.() ?? '';
    }
  });

  elements.characterSelect.addEventListener('change', (event) => {
    const value = event.target.value;
    context.appState?.setCharacterModel?.(value);
    loadPreviewModel(value);
  });

  window.addEventListener('resize', () => {
    refreshLayout();
  });
}

function initPreview() {
  if (previewState.renderer) return;
  try {
    previewState.renderer = new THREE.WebGLRenderer({
      canvas: elements.previewCanvas,
      alpha: true,
      antialias: true
    });
  } catch (error) {
    elements.previewFallback.textContent = 'Preview unavailable';
    elements.previewFallback.style.display = 'flex';
    return;
  }
  previewState.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  previewState.scene = new THREE.Scene();
  previewState.camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
  previewState.camera.position.set(0, 1, 3);
  previewState.scene.add(new THREE.AmbientLight(0xffffff, 0.9));
  const dir = new THREE.DirectionalLight(0xffffff, 0.8);
  dir.position.set(2, 2, 2);
  previewState.scene.add(dir);

  previewState.resizeObserver = new ResizeObserver(() => {
    resizePreview();
  });
  previewState.resizeObserver.observe(elements.previewCanvas.parentElement);
  resizePreview();
}

function resizePreview() {
  if (!previewState.renderer || !previewState.camera) return;
  const rect = elements.previewCanvas.parentElement.getBoundingClientRect();
  const width = Math.max(rect.width, 1);
  const height = Math.max(rect.height, 1);
  previewState.renderer.setSize(width, height, false);
  previewState.camera.aspect = width / height;
  previewState.camera.updateProjectionMatrix();
}

function loadPreviewModel(modelPath) {
  if (!modelPath) return;
  initPreview();
  if (!previewState.renderer) return;
  const loader = new FBXLoader();
  const token = Symbol('preview');
  previewState.loadingToken = token;
  loader.load(
    modelPath,
    (model) => {
      if (previewState.loadingToken !== token) return;
      if (previewState.model) {
        previewState.scene.remove(previewState.model);
      }
      previewState.model = model;
      previewState.scene.add(model);

      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      model.position.sub(center);
      const maxDim = Math.max(size.x, size.y, size.z, 0.001);
      const scale = 1.2 / maxDim;
      model.scale.setScalar(scale);

      previewState.camera.position.set(0, size.y * scale * 0.6 + 0.4, maxDim * scale * 2.3 + 1);
      previewState.camera.lookAt(0, size.y * scale * 0.3, 0);
      elements.previewFallback.style.display = 'none';
    },
    undefined,
    () => {
      elements.previewFallback.style.display = 'flex';
    }
  );
}

function startPreview() {
  if (!previewState.renderer) {
    initPreview();
    loadPreviewModel(context.appState?.getCharacterModel?.());
  }
  if (!previewState.renderer) return;
  previewState.active = true;
  if (previewState.frameId) return;
  const render = () => {
    if (!previewState.active) {
      previewState.frameId = null;
      return;
    }
    if (previewState.model) {
      previewState.model.rotation.y += 0.005;
    }
    previewState.renderer.render(previewState.scene, previewState.camera);
    previewState.frameId = requestAnimationFrame(render);
  };
  previewState.frameId = requestAnimationFrame(render);
}

function stopPreview() {
  previewState.active = false;
  if (previewState.frameId) {
    cancelAnimationFrame(previewState.frameId);
    previewState.frameId = null;
  }
}

function collectDebugInfo() {
  const connectionStatus = context.appState?.getConnectionStatus?.() ?? 'Unknown';
  const lastPing = context.appState?.getLastPing?.();
  const locationState = context.location?.getState?.() ?? {};
  const lastOsmFetch = context.appState?.getLastOsmFetch?.();
  const lastError = context.appState?.getLastError?.();
  const version = context.appState?.getAppVersion?.() ?? 'unknown';
  const viewport = `${window.innerWidth}x${window.innerHeight}`;
  const originText = `${formatCoordinate(locationState.originLat)}, ${formatCoordinate(locationState.originLon)}`;
  const currentText = `${formatCoordinate(locationState.lat)}, ${formatCoordinate(locationState.lon)}`;
  const playerText = `${formatMeters(locationState.playerX)}, ${formatMeters(locationState.playerZ)}`;
  const tileText = locationState.tile ? `${locationState.tile.x},${locationState.tile.y}` : '—';
  const info = [
    `version: ${version}`,
    `userAgent: ${navigator.userAgent}`,
    `viewport: ${viewport}`,
    `connectionStatus: ${connectionStatus}`,
    `lastPing: ${typeof lastPing === 'number' ? `${lastPing} ms` : 'N/A'}`,
    `locationStatus: ${locationState.state || 'unknown'}`,
    `origin: ${originText}`,
    `current: ${currentText}`,
    `playerXZ: ${playerText}`,
    `tile: ${tileText}`,
    `lastOsmFetch: ${lastOsmFetch ? formatTimestamp(lastOsmFetch) : '—'}`,
    `lastError: ${lastError ? `${lastError.message} @ ${formatTimestamp(lastError.timestamp)}` : '—'}`
  ];
  return info.join('\n');
}

function updateCharacterOptions() {
  const options = context.appState?.getCharacterOptions?.() ?? [];
  elements.characterSelect.innerHTML = '';
  options.forEach((option) => {
    const opt = document.createElement('option');
    opt.value = option.value;
    opt.textContent = option.label;
    elements.characterSelect.appendChild(opt);
  });
}

function refreshLayout() {
  if (!panel) return;
  isMobileView = window.matchMedia('(max-width: 720px)').matches;
  panel.classList.toggle('is-mobile', isMobileView);
  panel.classList.toggle('is-desktop', !isMobileView);
  if (!isMobileView) {
    setListView(false);
    if (elements.backButton) {
      elements.backButton.style.display = 'none';
    }
  } else if (elements.backButton && isListView) {
    elements.backButton.style.display = 'none';
  }
}

function setListView(enabled) {
  isListView = enabled;
  panel.classList.toggle('show-tab-list', enabled);
  panel.classList.toggle('show-tab-panel', !enabled);
  if (elements.backButton) {
    elements.backButton.style.display = enabled ? 'none' : 'inline-flex';
  }
  if (enabled) {
    stopPreview();
  } else if (activeTab === 'character') {
    startPreview();
  }
}

export function updateUI() {
  if (!panel) return;
  if (elements.nameInput && context.appState?.getPlayerName) {
    const name = context.appState.getPlayerName();
    if (elements.nameInput.value !== name) {
      elements.nameInput.value = name;
    }
  }
  if (elements.characterSelect && context.appState?.getCharacterModel) {
    const model = context.appState.getCharacterModel();
    if (elements.characterSelect.value !== model) {
      elements.characterSelect.value = model;
      if (activeTab === 'character') {
        loadPreviewModel(model);
      }
    }
  }

  if (elements.connectionStatus) {
    elements.connectionStatus.textContent = context.appState?.getConnectionStatus?.() ?? 'Connecting';
  }
  if (elements.ping) {
    const ping = context.appState?.getLastPing?.();
    elements.ping.textContent = typeof ping === 'number' ? `${ping} ms` : 'N/A';
  }
  if (elements.playersList) {
    const players = context.appState?.getConnectedPlayers?.() ?? [];
    elements.playersList.innerHTML = '';
    if (!players.length) {
      const empty = createElement('li', 'settings-muted', 'No active connections.');
      elements.playersList.appendChild(empty);
    } else {
      players.forEach((player) => {
        const item = createElement('li', 'settings-list-item');
        const distance = player.distance != null ? ` • ${formatDistance(player.distance)}` : '';
        item.textContent = `${player.name} (${player.id})${distance}`;
        elements.playersList.appendChild(item);
      });
    }
  }
  if (elements.connectionError) {
    const lastError = context.appState?.getLastError?.();
    elements.connectionError.textContent = lastError
      ? `${lastError.message} (${formatTimestamp(lastError.timestamp)})`
      : 'None';
  }

  if (elements.locationFields && context.location?.getState) {
    const state = context.location.getState();
    elements.locationFields.status.textContent = state.state ? state.state : '—';
    elements.locationFields.accuracy.textContent = typeof state.accuracyMeters === 'number'
      ? `±${Math.round(state.accuracyMeters)} m`
      : '—';
    elements.locationFields.lat.textContent = formatCoordinate(state.lat);
    elements.locationFields.lon.textContent = formatCoordinate(state.lon);
    elements.locationFields.heading.textContent = typeof state.heading === 'number'
      ? `${state.heading.toFixed(1)}°`
      : '—';
    elements.locationFields.speed.textContent = typeof state.speed === 'number'
      ? `${state.speed.toFixed(1)} m/s`
      : '—';
    elements.locationFields.time.textContent = state.timestamp ? formatTimestamp(state.timestamp) : '—';
    if (state.permissionDenied) {
      elements.locationFields.guidance.textContent = 'Permission denied. Enable Location access in your mobile browser settings and reload the page.';
    } else {
      elements.locationFields.guidance.textContent = state.message || '';
    }
  }

  if (elements.debugFields && context.location?.getState) {
    const state = context.location.getState();
    const originText = `${formatCoordinate(state.originLat)}, ${formatCoordinate(state.originLon)}`;
    const currentText = `${formatCoordinate(state.lat)}, ${formatCoordinate(state.lon)}`;
    const playerText = `${formatMeters(state.playerX)}, ${formatMeters(state.playerZ)}`;
    const tileText = state.tile ? `${state.tile.x}, ${state.tile.y}` : '—';
    elements.debugFields.origin.textContent = originText;
    elements.debugFields.current.textContent = currentText;
    elements.debugFields.player.textContent = playerText;
    elements.debugFields.tile.textContent = tileText;
  }
}

export function setTab(tabId) {
  if (!tabId) return;
  setActiveTab(tabId);
}

export function openSettings() {
  openOverlay();
}

export function closeSettings() {
  closeOverlay();
}

export function initSettingsPanel({ appState, multiplayer, location, player } = {}) {
  context = { appState, multiplayer, location, player };
  overlay = document.getElementById('settings-overlay');
  panel = document.getElementById('settings-panel');
  if (!overlay || !panel) {
    throw new Error('Settings overlay not found.');
  }
  overlay.setAttribute('aria-hidden', 'true');
  panel.innerHTML = '';
  panel.classList.add('settings-shell');
  panel.classList.add('show-tab-panel');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-labelledby', 'settings-title');
  panel.tabIndex = -1;

  const header = buildHeader();
  const tabs = buildTabs();
  const body = buildPanels();
  panel.append(header, tabs, body);

  updateCharacterOptions();
  refreshLayout();

  const storedTab = localStorage.getItem(TAB_KEY);
  setActiveTab(storedTab && elements.tabs[storedTab] ? storedTab : 'character');

  bindEvents();
  const savedTab = localStorage.getItem(TAB_KEY) || 'character';
  setActiveTab(savedTab);
  loadPreviewModel(context.appState?.getCharacterModel?.());
  updateUI();
}

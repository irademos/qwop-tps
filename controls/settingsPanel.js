import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';

const TAB_KEY = 'settings:lastTab';

const TABS = [
  { id: 'character', label: 'Character' },
  { id: 'inventory', label: 'Inventory' },
  { id: 'multiplayer', label: 'Multiplayer' },
  { id: 'location', label: 'Location' },
  { id: 'display', label: 'Display' },
  { id: 'developer', label: 'Developer' }
];
const CHARACTER_STATS = [
  { key: 'level', label: 'Level' },
  { key: 'strength', label: 'Strength' },
  { key: 'agility', label: 'Agility' },
  { key: 'smarts', label: 'Smarts' },
  { key: 'charm', label: 'Charm' },
  { key: 'luck', label: 'Luck' },
  { key: 'coins', label: 'Coins' }
];
const PERCENT_STATS = new Set(['health', 'hunger', 'energy']);

let overlay;
let panel;
let context = {};
let elements = {};
let activeTab = 'character';
let lastFocusedElement = null;
let isMobileView = false;
let isListView = false;
let selectedInventoryId = null;
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

function formatStatValue(key, value) {
  if (typeof value !== 'number' || Number.isNaN(value)) return '—';
  if (PERCENT_STATS.has(key)) {
    return `${Math.round(value)}%`;
  }
  if (key === 'level') {
    return `${Math.max(1, Math.round(value))}`;
  }
  return `${Math.round(value)}`;
}

function formatRangeValue(value, decimals = 2) {
  if (typeof value !== 'number' || Number.isNaN(value)) return '—';
  return value.toFixed(decimals);
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

  const statsTitle = createElement('h3', 'settings-section-title', 'Stats');
  const statsGrid = createElement('div', 'settings-stats-grid');
  elements.characterStatFields = {};
  CHARACTER_STATS.forEach(({ key, label }) => {
    const statRow = createElement('div', 'settings-stat');
    const statLabel = createElement('span', 'settings-stat-label', label);
    const statValue = createElement('span', 'settings-stat-value', '—');
    statValue.dataset.field = `stat-${key}`;
    statRow.append(statLabel, statValue);
    statsGrid.appendChild(statRow);
    elements.characterStatFields[key] = statValue;
  });

  panelEl.append(nameGroup, characterGroup, previewWrapper, statsTitle, statsGrid);

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

function buildInventoryPanel() {
  const panelEl = createElement('section', 'settings-tabpanel');
  panelEl.id = 'panel-inventory';
  panelEl.dataset.panel = 'inventory';
  panelEl.setAttribute('role', 'tabpanel');
  panelEl.setAttribute('aria-labelledby', 'tab-inventory');

  const grid = createElement('div', 'inventory-grid');
  const emptyState = createElement('div', 'settings-muted');
  emptyState.classList.add('inventory-empty');
  emptyState.textContent = 'Empty';
  const details = createElement('div', 'inventory-details');
  const detailsText = createElement('div', 'inventory-details-text', 'Select an item to see details.');
  const actions = createElement('div', 'inventory-actions');
  const dropButton = createElement('button', 'settings-button', 'Drop');
  dropButton.type = 'button';
  dropButton.dataset.inventoryAction = 'drop';
  const equipButton = createElement('button', 'settings-button', 'Equip');
  equipButton.type = 'button';
  equipButton.dataset.inventoryAction = 'equip';
  const eatButton = createElement('button', 'settings-button', 'Eat');
  eatButton.type = 'button';
  eatButton.dataset.inventoryAction = 'eat';
  actions.append(dropButton, equipButton, eatButton);
  details.append(detailsText, actions);

  panelEl.append(grid, emptyState, details);

  elements.inventoryGrid = grid;
  elements.inventoryEmpty = emptyState;
  elements.inventoryDetails = detailsText;
  elements.inventoryDetailsContainer = details;
  elements.inventoryActions = actions;
  elements.inventoryDropButton = dropButton;
  elements.inventoryEquipButton = equipButton;
  elements.inventoryEatButton = eatButton;

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
    ['Source', 'location-source'],
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
    if (field === 'location-source') {
      elements.locationSourceRow = row;
    }
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
    source: panelEl.querySelector('[data-field="location-source"]'),
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

  const serverToolsTitle = createElement('h3', 'settings-section-title', 'Server Tools');
  const clearServerButton = createElement('button', 'settings-button', 'Clear Rooms/Sessions Cache');
  clearServerButton.type = 'button';
  clearServerButton.dataset.action = 'clear-server-state';
  const clearServerStatus = createElement('div', 'settings-muted');
  clearServerStatus.textContent = 'Clears server-side rooms, sessions, and caches.';

  const debugLocationTitle = createElement('h3', 'settings-section-title', 'Debug Location');

  const debugToggleRow = createElement('div', 'settings-row');
  const debugToggleLabel = createElement('label', 'settings-label', 'Enable Debug Location');
  debugToggleLabel.setAttribute('for', 'debug-location-toggle');
  const debugToggle = createElement('input', 'settings-checkbox');
  debugToggle.type = 'checkbox';
  debugToggle.id = 'debug-location-toggle';
  debugToggleRow.append(debugToggleLabel, debugToggle);

  const debugLocationGrid = createElement('div', 'settings-debug-grid');
  const debugLatGroup = createElement('div', 'settings-field');
  const debugLatLabel = createElement('label', 'settings-label', 'Latitude');
  debugLatLabel.setAttribute('for', 'debug-location-lat');
  const debugLatInput = createElement('input', 'settings-input');
  debugLatInput.id = 'debug-location-lat';
  debugLatInput.type = 'number';
  debugLatInput.step = '0.000001';
  debugLatInput.inputMode = 'decimal';
  debugLatGroup.append(debugLatLabel, debugLatInput);

  const debugLonGroup = createElement('div', 'settings-field');
  const debugLonLabel = createElement('label', 'settings-label', 'Longitude');
  debugLonLabel.setAttribute('for', 'debug-location-lon');
  const debugLonInput = createElement('input', 'settings-input');
  debugLonInput.id = 'debug-location-lon';
  debugLonInput.type = 'number';
  debugLonInput.step = '0.000001';
  debugLonInput.inputMode = 'decimal';
  debugLonGroup.append(debugLonLabel, debugLonInput);

  const debugAccuracyGroup = createElement('div', 'settings-field');
  const debugAccuracyLabel = createElement('label', 'settings-label', 'Accuracy (m)');
  debugAccuracyLabel.setAttribute('for', 'debug-location-accuracy');
  const debugAccuracyInput = createElement('input', 'settings-input');
  debugAccuracyInput.id = 'debug-location-accuracy';
  debugAccuracyInput.type = 'number';
  debugAccuracyInput.step = '0.5';
  debugAccuracyInput.min = '0.5';
  debugAccuracyInput.inputMode = 'decimal';
  debugAccuracyGroup.append(debugAccuracyLabel, debugAccuracyInput);

  debugLocationGrid.append(debugLatGroup, debugLonGroup, debugAccuracyGroup);

  const debugApplyButton = createElement('button', 'settings-button', 'Apply Debug Location');
  debugApplyButton.type = 'button';
  debugApplyButton.dataset.action = 'apply-debug-location';

  const debugStepRow = createElement('div', 'settings-debug-step');
  const debugStepLabel = createElement('label', 'settings-label', 'Step (m)');
  debugStepLabel.setAttribute('for', 'debug-location-step');
  const debugStepInput = createElement('input', 'settings-input');
  debugStepInput.id = 'debug-location-step';
  debugStepInput.type = 'number';
  debugStepInput.step = '1';
  debugStepInput.min = '1';
  debugStepInput.value = '5';
  debugStepInput.inputMode = 'decimal';
  debugStepRow.append(debugStepLabel, debugStepInput);

  const debugStepButtons = createElement('div', 'settings-debug-buttons');
  const stepNorthButton = createElement('button', 'settings-button', 'Step North');
  stepNorthButton.type = 'button';
  stepNorthButton.dataset.action = 'step-debug';
  stepNorthButton.dataset.direction = 'north';
  const stepSouthButton = createElement('button', 'settings-button', 'Step South');
  stepSouthButton.type = 'button';
  stepSouthButton.dataset.action = 'step-debug';
  stepSouthButton.dataset.direction = 'south';
  const stepEastButton = createElement('button', 'settings-button', 'Step East');
  stepEastButton.type = 'button';
  stepEastButton.dataset.action = 'step-debug';
  stepEastButton.dataset.direction = 'east';
  const stepWestButton = createElement('button', 'settings-button', 'Step West');
  stepWestButton.type = 'button';
  stepWestButton.dataset.action = 'step-debug';
  stepWestButton.dataset.direction = 'west';
  debugStepButtons.append(stepNorthButton, stepSouthButton, stepEastButton, stepWestButton);

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
    serverToolsTitle,
    clearServerButton,
    clearServerStatus,
    debugLocationTitle,
    debugToggleRow,
    debugLocationGrid,
    debugApplyButton,
    debugStepRow,
    debugStepButtons,
    levelBuilderButton,
    originSection,
    consoleLog
  );
  elements.consoleButton = consoleButton;
  elements.consoleLog = consoleLog;
  elements.clearServerButton = clearServerButton;
  elements.clearServerStatus = clearServerStatus;
  elements.debugLocationFields = {
    toggle: debugToggle,
    lat: debugLatInput,
    lon: debugLonInput,
    accuracy: debugAccuracyInput,
    step: debugStepInput
  };
  elements.debugFields = {
    origin: originSection.querySelector('[data-field="debug-origin"]'),
    current: originSection.querySelector('[data-field="debug-current"]'),
    player: originSection.querySelector('[data-field="debug-player"]'),
    tile: originSection.querySelector('[data-field="debug-tile"]')
  };

  return panelEl;
}

function buildDisplayPanel() {
  const panelEl = createElement('section', 'settings-tabpanel');
  panelEl.id = 'panel-display';
  panelEl.dataset.panel = 'display';
  panelEl.setAttribute('role', 'tabpanel');
  panelEl.setAttribute('aria-labelledby', 'tab-display');

  const modeGroup = createElement('div', 'settings-field');
  const modeLabel = createElement('label', 'settings-label', 'Day/Night Mode');
  modeLabel.setAttribute('for', 'settings-display-mode');
  const modeSelect = createElement('select', 'settings-select');
  modeSelect.id = 'settings-display-mode';
  const modeOptions = [
    { value: 'auto', label: 'Auto (8:00am / 5:30pm)' },
    { value: 'day', label: 'Day' },
    { value: 'night', label: 'Night' }
  ];
  modeOptions.forEach(({ value, label }) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    modeSelect.appendChild(option);
  });
  modeGroup.append(modeLabel, modeSelect);

  const createRangeField = ({ id, label, min, max, step }) => {
    const field = createElement('div', 'settings-field');
    const labelRow = createElement('div', 'settings-range-row');
    const fieldLabel = createElement('label', 'settings-label', label);
    fieldLabel.setAttribute('for', id);
    const valueLabel = createElement('span', 'settings-range-value', '—');
    valueLabel.dataset.valueFor = id;
    labelRow.append(fieldLabel, valueLabel);
    const input = createElement('input', 'settings-range');
    input.type = 'range';
    input.id = id;
    input.min = `${min}`;
    input.max = `${max}`;
    input.step = `${step}`;
    field.append(labelRow, input);
    return { field, input, valueLabel };
  };

  const ambientField = createRangeField({
    id: 'settings-display-ambient',
    label: 'Ambient Light',
    min: 0,
    max: 2,
    step: 0.05
  });
  const directionalField = createRangeField({
    id: 'settings-display-directional',
    label: 'Direct Light',
    min: 0,
    max: 2,
    step: 0.05
  });
  const groundField = createRangeField({
    id: 'settings-display-ground',
    label: 'Ground Brightness',
    min: 0.2,
    max: 1.6,
    step: 0.05
  });
  const buildingField = createRangeField({
    id: 'settings-display-building',
    label: 'Building Brightness',
    min: 0.2,
    max: 1.6,
    step: 0.05
  });
  const skyField = createRangeField({
    id: 'settings-display-sky',
    label: 'Sky Brightness',
    min: 0.1,
    max: 1.6,
    step: 0.05
  });

  const hint = createElement('div', 'settings-muted');
  hint.textContent = 'Auto mode uses local time to switch between day and night lighting.';

  panelEl.append(
    modeGroup,
    ambientField.field,
    directionalField.field,
    groundField.field,
    buildingField.field,
    skyField.field,
    hint
  );

  elements.displayFields = {
    modeSelect,
    sliders: {
      ambientIntensity: ambientField.input,
      directionalIntensity: directionalField.input,
      groundBrightness: groundField.input,
      buildingBrightness: buildingField.input,
      skyBrightness: skyField.input
    },
    values: {
      ambientIntensity: ambientField.valueLabel,
      directionalIntensity: directionalField.valueLabel,
      groundBrightness: groundField.valueLabel,
      buildingBrightness: buildingField.valueLabel,
      skyBrightness: skyField.valueLabel
    }
  };

  return panelEl;
}

function buildPanels() {
  const body = createElement('div', 'settings-body');
  const characterPanel = buildCharacterPanel();
  const inventoryPanel = buildInventoryPanel();
  const multiplayerPanel = buildMultiplayerPanel();
  const locationPanel = buildLocationPanel();
  const displayPanel = buildDisplayPanel();
  const developerPanel = buildDeveloperPanel();
  body.append(characterPanel, inventoryPanel, multiplayerPanel, locationPanel, displayPanel, developerPanel);
  elements.panels = {
    character: characterPanel,
    inventory: inventoryPanel,
    multiplayer: multiplayerPanel,
    location: locationPanel,
    display: displayPanel,
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

async function handleAction(target) {
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
  } else if (action === 'clear-server-state') {
    const { clearServerButton, clearServerStatus } = elements;
    if (!context.multiplayer?.clearServerState) {
      clearServerStatus.textContent = 'Server clear unavailable in this build.';
      return;
    }
    const confirmed = window.confirm(
      'Clear server-side rooms, sessions, and caches? This will disconnect players.'
    );
    if (!confirmed) return;
    clearServerButton.disabled = true;
    clearServerStatus.textContent = 'Clearing server-side state...';
    try {
      const result = await context.multiplayer.clearServerState();
      if (result.failed.length) {
        const failedList = result.failed.map(item => item.path).join(', ');
        clearServerStatus.textContent = `Cleared: ${result.cleared.join(', ')}. Failed: ${failedList}.`;
      } else {
        clearServerStatus.textContent = `Cleared: ${result.cleared.join(', ')}.`;
      }
    } catch (error) {
      console.warn('Failed to clear server-side state:', error);
      clearServerStatus.textContent = 'Failed to clear server-side state. Check console.';
    } finally {
      clearServerButton.disabled = false;
    }
  } else if (action === 'apply-debug-location') {
    const lat = parseFloat(elements.debugLocationFields?.lat?.value);
    const lon = parseFloat(elements.debugLocationFields?.lon?.value);
    context.location?.setDebugLocation?.({ lat, lon });
  } else if (action === 'step-debug') {
    const stepValue = parseFloat(elements.debugLocationFields?.step?.value);
    const stepMeters = Number.isFinite(stepValue) ? stepValue : 0;
    const direction = target.dataset.direction;
    if (!stepMeters || !direction) return;
    const delta = { northMeters: 0, eastMeters: 0 };
    if (direction === 'north') delta.northMeters = stepMeters;
    if (direction === 'south') delta.northMeters = -stepMeters;
    if (direction === 'east') delta.eastMeters = stepMeters;
    if (direction === 'west') delta.eastMeters = -stepMeters;
    context.location?.stepDebugLocation?.(delta);
  }
}

function renderInventory() {
  if (!elements.inventoryGrid) return;
  const inventory = context.appState?.getInventory?.() || {};
  const entries = Object.entries(inventory).filter(([, item]) => (item?.count || 0) > 0);
  const equippedItemId = context.appState?.getEquippedInventoryItemId?.() || null;
  const fallbackIcons = {
    iceGun: '❄️',
    bow: '🏹',
    autumnSword: '🗡️',
    lantern: '🏮'
  };

  elements.inventoryGrid.innerHTML = '';
  if (!entries.length) {
    elements.inventoryEmpty.style.display = 'block';
    elements.inventoryDetails.textContent = 'Inventory is empty.';
    if (elements.inventoryActions) {
      elements.inventoryActions.style.display = 'none';
    }
    elements.inventoryDetailsContainer?.remove();
    selectedInventoryId = null;
    return;
  }

  elements.inventoryEmpty.style.display = 'none';
  if (!selectedInventoryId || !inventory[selectedInventoryId]) {
    selectedInventoryId = entries[0][0];
  }

  let selectedTile = null;
  entries.forEach(([itemId, item]) => {
    const button = createElement('button', 'inventory-tile');
    button.type = 'button';
    button.dataset.inventoryId = itemId;
    button.setAttribute('aria-selected', itemId === selectedInventoryId ? 'true' : 'false');
    button.classList.toggle('is-selected', itemId === selectedInventoryId);
    button.classList.toggle('is-equipped', itemId === equippedItemId);
    if (itemId === selectedInventoryId) {
      selectedTile = button;
    }

    const iconWrapper = createElement('div', 'inventory-icon-wrapper');
    const fallbackIcon = fallbackIcons[itemId] || (itemId.startsWith('mushroom_') ? '🍄' : '🎒');
    if (item.icon) {
      const img = document.createElement('img');
      img.className = 'inventory-icon';
      img.alt = item.name || itemId;
      img.loading = 'lazy';
      img.src = item.icon;
      img.addEventListener('error', () => {
        img.remove();
        const fallback = createElement('div', 'inventory-icon-fallback', fallbackIcon);
        iconWrapper.appendChild(fallback);
      }, { once: true });
      iconWrapper.appendChild(img);
    } else {
      const fallback = createElement('div', 'inventory-icon-fallback', fallbackIcon);
      iconWrapper.appendChild(fallback);
    }

    button.appendChild(iconWrapper);

    if (item.count && item.count > 1) {
      const badge = createElement('span', 'inventory-badge', `${item.count}`);
      button.appendChild(badge);
    }

    if (itemId === 'iceGun') {
      const ammoCount = Number.isFinite(item?.['ice ammo']) ? item['ice ammo'] : 0;
      const ammoLabel = createElement('span', 'inventory-ammo', `Ice ammo: ${ammoCount}`);
      button.appendChild(ammoLabel);
    }
    if (itemId === 'bow') {
      const ammoCount = Number.isFinite(item?.['arrow ammo']) ? item['arrow ammo'] : 0;
      const ammoLabel = createElement('span', 'inventory-ammo', `Arrows: ${ammoCount}`);
      button.appendChild(ammoLabel);
    }

    elements.inventoryGrid.appendChild(button);
  });

  const selectedItem = inventory[selectedInventoryId];
  if (selectedItem) {
    const itemActions = context.appState?.getInventoryItemActions?.(selectedInventoryId) || ['drop', 'equip'];
    const equippedText = selectedInventoryId === equippedItemId ? ' • Equipped' : '';
    const countText = selectedItem.count ? ` • Qty ${selectedItem.count}` : '';
    const ammoText = selectedInventoryId === 'iceGun'
      ? ` • Ice ammo ${Number.isFinite(selectedItem?.['ice ammo']) ? selectedItem['ice ammo'] : 0}`
      : selectedInventoryId === 'bow'
        ? ` • Arrows ${Number.isFinite(selectedItem?.['arrow ammo']) ? selectedItem['arrow ammo'] : 0}`
        : '';
    elements.inventoryDetails.textContent = `${selectedItem.name || selectedInventoryId}${equippedText}${countText}${ammoText}`;
    if (elements.inventoryActions) {
      elements.inventoryActions.style.display = 'flex';
    }
    if (elements.inventoryEquipButton) {
      const canEquip = itemActions.includes('equip');
      elements.inventoryEquipButton.style.display = canEquip ? 'inline-flex' : 'none';
      if (canEquip) {
        elements.inventoryEquipButton.textContent = selectedInventoryId === equippedItemId ? 'Unequip' : 'Equip';
        elements.inventoryEquipButton.dataset.inventoryAction =
          selectedInventoryId === equippedItemId ? 'unequip' : 'equip';
      }
    }
    if (elements.inventoryDropButton) {
      const canDrop = itemActions.includes('drop');
      elements.inventoryDropButton.style.display = canDrop ? 'inline-flex' : 'none';
    }
    if (elements.inventoryEatButton) {
      const canEat = itemActions.includes('eat');
      elements.inventoryEatButton.style.display = canEat ? 'inline-flex' : 'none';
    }
    if (elements.inventoryDetailsContainer) {
      if (selectedTile && selectedTile.parentElement === elements.inventoryGrid) {
        selectedTile.insertAdjacentElement('afterend', elements.inventoryDetailsContainer);
      } else {
        elements.inventoryGrid.appendChild(elements.inventoryDetailsContainer);
      }
    }
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
    if (button.dataset.inventoryAction) {
      const action = button.dataset.inventoryAction;
      if (!selectedInventoryId) return;
      if (action === 'drop') {
        context.appState?.dropInventoryItem?.(selectedInventoryId);
      } else if (action === 'equip') {
        context.appState?.equipInventoryItem?.(selectedInventoryId);
      } else if (action === 'unequip') {
        context.appState?.unequipInventoryItem?.(selectedInventoryId);
      } else if (action === 'eat') {
        context.appState?.eatInventoryItem?.(selectedInventoryId);
      }
      renderInventory();
      return;
    }
    if (button.dataset.inventoryId) {
      selectedInventoryId = button.dataset.inventoryId;
      renderInventory();
      return;
    }
    if (button.dataset.tab) {
      setTab(button.dataset.tab);
      return;
    }
    if (button.dataset.action) {
      void handleAction(button);
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

  if (elements.debugLocationFields?.toggle) {
    elements.debugLocationFields.toggle.addEventListener('change', (event) => {
      context.location?.setDebugEnabled?.(event.target.checked);
      updateUI();
    });
  }

  if (elements.debugLocationFields?.accuracy) {
    elements.debugLocationFields.accuracy.addEventListener('change', (event) => {
      const value = parseFloat(event.target.value);
      context.location?.setDebugAccuracy?.(value);
    });
  }

  if (elements.displayFields?.modeSelect) {
    elements.displayFields.modeSelect.addEventListener('change', (event) => {
      const value = event.target.value;
      context.appState?.setDisplayMode?.(value);
    });
  }

  if (elements.displayFields?.sliders) {
    Object.entries(elements.displayFields.sliders).forEach(([key, slider]) => {
      slider.addEventListener('input', (event) => {
        const value = parseFloat(event.target.value);
        if (elements.displayFields?.values?.[key]) {
          elements.displayFields.values[key].textContent = formatRangeValue(value);
        }
        context.appState?.setDisplaySetting?.(key, value);
      });
    });
  }

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
  if (elements.characterStatFields && context.appState?.getPlayerStats) {
    const stats = context.appState.getPlayerStats() || {};
    Object.entries(elements.characterStatFields).forEach(([key, node]) => {
      node.textContent = formatStatValue(key, stats[key]);
    });
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
    if (elements.locationFields.source) {
      const sourceLabel = state.source === 'debug' ? 'DEBUG' : state.source === 'gps' ? 'GPS' : '—';
      elements.locationFields.source.textContent = sourceLabel;
      if (elements.locationSourceRow) {
        elements.locationSourceRow.classList.toggle('is-debug', state.source === 'debug');
      }
    }
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

  if (elements.debugLocationFields && context.location?.getDebugState) {
    const debugState = context.location.getDebugState();
    if (elements.debugLocationFields.toggle) {
      elements.debugLocationFields.toggle.checked = Boolean(debugState.enabled);
    }
    if (elements.debugLocationFields.lat) {
      const latInput = elements.debugLocationFields.lat;
      if (document.activeElement !== latInput) {
        latInput.value = Number.isFinite(debugState.lat)
          ? debugState.lat.toFixed(6)
          : '';
      }
    }
    if (elements.debugLocationFields.lon) {
      const lonInput = elements.debugLocationFields.lon;
      if (document.activeElement !== lonInput) {
        lonInput.value = Number.isFinite(debugState.lon)
          ? debugState.lon.toFixed(6)
          : '';
      }
    }
    if (elements.debugLocationFields.accuracy) {
      const accuracyInput = elements.debugLocationFields.accuracy;
      if (document.activeElement !== accuracyInput) {
        accuracyInput.value = Number.isFinite(debugState.accuracyMeters)
          ? debugState.accuracyMeters.toFixed(1)
          : '';
      }
    }
  }

  if (elements.displayFields && context.appState?.getDisplaySettings) {
    const displaySettings = context.appState.getDisplaySettings();
    if (displaySettings?.mode && elements.displayFields.modeSelect) {
      if (elements.displayFields.modeSelect.value !== displaySettings.mode) {
        elements.displayFields.modeSelect.value = displaySettings.mode;
      }
    }
    Object.entries(elements.displayFields.sliders || {}).forEach(([key, slider]) => {
      const value = displaySettings?.[key];
      if (typeof value !== 'number' || Number.isNaN(value)) return;
      if (document.activeElement !== slider) {
        slider.value = `${value}`;
      }
      if (elements.displayFields?.values?.[key]) {
        elements.displayFields.values[key].textContent = formatRangeValue(value);
      }
    });
  }

  renderInventory();
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

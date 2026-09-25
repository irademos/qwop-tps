const TAB_KEY = 'settings:lastTab';

const TABS = [
  { id: 'character', label: 'Character' },
  { id: 'multiplayer', label: 'Multiplayer' },
  { id: 'display', label: 'Display' },
  { id: 'swordgyro', label: 'Sword Gyro' },
  { id: 'about', label: 'About' },
  { id: 'account', label: 'Account' },
  { id: 'developer', label: 'Developer' }
];
const CHARACTER_STATS = [
  { key: 'level', label: 'Level' },
  { key: 'xp', label: 'XP' },
  { key: 'coins', label: 'Coins' }
];

let overlay;
let panel;
let leaderboardOverlay;
let leaderboardPanel;
let context = {};
let elements = {};
let lastFocusedElement = null;
let isMobileView = false;
let isListView = false;
let isEditingName = false;
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
  return `${Math.round(distance)} m`;
}

function formatStatValue(key, value) {
  if (typeof value !== 'number' || Number.isNaN(value)) return '—';
  if (key === 'level') {
    return `${Math.max(1, Math.round(value))}`;
  }
  return `${Math.round(value)}`;
}

function formatRangeValue(value, decimals = 2) {
  if (typeof value !== 'number' || Number.isNaN(value)) return '—';
  return value.toFixed(decimals);
}

function setNameStatus(message, tone = 'error') {
  if (!elements.nameStatus) return;
  if (!message) {
    elements.nameStatus.textContent = '';
    elements.nameStatus.hidden = true;
    elements.nameStatus.classList.remove('is-error');
    return;
  }
  elements.nameStatus.textContent = message;
  elements.nameStatus.hidden = false;
  elements.nameStatus.classList.toggle('is-error', tone === 'error');
}

function updateNameSaveState() {
  if (!elements.nameInput || !elements.nameSaveButton) return;
  const currentName = context.appState?.getPlayerName?.() ?? '';
  const proposedName = elements.nameInput.value.trim();
  const hasChange = proposedName && proposedName !== currentName;
  elements.nameSaveButton.disabled = !hasChange;
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
  const nameRow = createElement('div', 'settings-name-row');
  const nameInput = createElement('input', 'settings-input');
  nameInput.id = 'settings-name-input';
  nameInput.type = 'text';
  nameInput.autocomplete = 'nickname';
  const nameSaveButton = createElement('button', 'settings-button', 'Save');
  nameSaveButton.type = 'button';
  nameSaveButton.dataset.action = 'save-name';
  const nameStatus = createElement('div', 'settings-name-status');
  nameStatus.hidden = true;
  nameRow.append(nameInput, nameSaveButton);
  nameGroup.append(nameLabel, nameRow, nameStatus);

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

  const psStatsTitle = createElement('h3', 'settings-section-title', 'Sword Showdown Stats');
  psStatsTitle.id = 'ps-stats-title';
  const psStatsGrid = createElement('div', 'settings-stats-grid');
  psStatsGrid.id = 'ps-stats-grid';
  const PS_STAT_DEFS = [
    { key: 'kills', label: 'Kills' },
    { key: 'deaths', label: 'Deaths' },
    { key: 'highestStage', label: 'Highest Stage' }
  ];
  elements.phoneSwordStatFields = {};
  PS_STAT_DEFS.forEach(({ key, label }) => {
    const statRow = createElement('div', 'settings-stat');
    const statLabel = createElement('span', 'settings-stat-label', label);
    const statValue = createElement('span', 'settings-stat-value', '—');
    statValue.dataset.field = `ps-stat-${key}`;
    statRow.append(statLabel, statValue);
    psStatsGrid.appendChild(statRow);
    elements.phoneSwordStatFields[key] = statValue;
  });

  panelEl.append(nameGroup, statsTitle, statsGrid, psStatsTitle, psStatsGrid);

  elements.nameInput = nameInput;
  elements.nameSaveButton = nameSaveButton;
  elements.nameStatus = nameStatus;

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

  const leaderboardButton = createElement('button', 'settings-button', 'Leaderboard');
  leaderboardButton.type = 'button';
  leaderboardButton.dataset.action = 'open-leaderboard';

  const reconnectButton = createElement('button', 'settings-button', 'Reconnect');
  reconnectButton.type = 'button';
  reconnectButton.dataset.action = 'reconnect';

  const errorTitle = createElement('h3', 'settings-section-title', 'Connection Issues');
  const errorText = createElement('div', 'settings-muted');
  errorText.dataset.field = 'connection-error';
  errorText.textContent = 'None';

  panelEl.append(statusRow, pingRow, playersTitle, playersList, leaderboardButton, reconnectButton, errorTitle, errorText);

  elements.connectionStatus = statusRow.querySelector('[data-field="connection-status"]');
  elements.ping = pingRow.querySelector('[data-field="ping"]');
  elements.playersList = playersList;
  elements.connectionError = errorText;
  elements.leaderboardButton = leaderboardButton;

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

  const serverToolsTitle = createElement('h3', 'settings-section-title', 'Server Tools');
  const clearServerButton = createElement('button', 'settings-button', 'Clear Rooms/Sessions Cache');
  clearServerButton.type = 'button';
  clearServerButton.dataset.action = 'clear-server-state';
  const clearServerStatus = createElement('div', 'settings-muted');
  clearServerStatus.textContent = 'Clears server-side rooms, sessions, and caches.';

  const consoleLog = createElement('div', 'settings-console');
  consoleLog.id = 'console-log';
  consoleLog.style.display = 'none';

  panelEl.append(
    consoleButton,
    copyDebugButton,
    serverToolsTitle,
    clearServerButton,
    clearServerStatus,
    consoleLog
  );
  elements.consoleButton = consoleButton;
  elements.consoleLog = consoleLog;
  elements.clearServerButton = clearServerButton;
  elements.clearServerStatus = clearServerStatus;
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

  const performanceGroup = createElement('div', 'settings-field');
  const performanceLabel = createElement('label', 'settings-label', 'Performance Mode');
  performanceLabel.setAttribute('for', 'settings-performance-mode');
  const performanceSelect = createElement('select', 'settings-select');
  performanceSelect.id = 'settings-performance-mode';
  const performanceOptions = [
    { value: 'auto', label: 'Auto (device tuned)' },
    { value: 'quality', label: 'Quality' },
    { value: 'balanced', label: 'Balanced' },
    { value: 'performance', label: 'Performance' }
  ];
  performanceOptions.forEach(({ value, label }) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    performanceSelect.appendChild(option);
  });
  performanceGroup.append(performanceLabel, performanceSelect);
  const firstPersonGroup = createElement('div', 'settings-field');
  const firstPersonLabel = createElement('label', 'settings-label', 'First Person View');
  firstPersonLabel.setAttribute('for', 'settings-display-first-person');
  const firstPersonToggle = createElement('input', 'settings-checkbox');
  firstPersonToggle.id = 'settings-display-first-person';
  firstPersonToggle.type = 'checkbox';
  firstPersonToggle.checked = false;
  const firstPersonHint = createElement('div', 'settings-muted');
  firstPersonHint.textContent = 'Check to switch to first-person view.';
  firstPersonGroup.append(firstPersonLabel, firstPersonToggle, firstPersonHint);

  const gyroGroup = createElement('div', 'settings-field');
  const gyroLabel = createElement('label', 'settings-label', 'Gyroscope Camera');
  gyroLabel.setAttribute('for', 'settings-display-gyro');
  const gyroToggle = createElement('input', 'settings-checkbox');
  gyroToggle.id = 'settings-display-gyro';
  gyroToggle.type = 'checkbox';
  gyroToggle.checked = false;
  const gyroRecalGroup = createElement('div', 'settings-field');
  gyroRecalGroup.style.paddingTop = '0';
  gyroRecalGroup.hidden = true;
  const gyroRecalBtn = createElement('button', 'settings-button settings-button-secondary', 'Recalibrate');
  gyroRecalBtn.id = 'settings-gyro-recal';
  gyroRecalBtn.type = 'button';
  const gyroRecalHint = createElement('div', 'settings-muted');
  gyroRecalHint.textContent = 'Resets the neutral orientation to your current device position.';
  gyroRecalGroup.append(gyroRecalBtn, gyroRecalHint);
  const gyroHint = createElement('div', 'settings-muted');
  gyroHint.textContent = 'Use device orientation to control the camera direction.';
  gyroGroup.append(gyroLabel, gyroToggle, gyroHint);

  const highContrastGroup = createElement('div', 'settings-field');
  const highContrastLabel = createElement('label', 'settings-label', 'High Contrast Mode');
  highContrastLabel.setAttribute('for', 'settings-display-high-contrast');
  const highContrastToggle = createElement('input', 'settings-checkbox');
  highContrastToggle.id = 'settings-display-high-contrast';
  highContrastToggle.type = 'checkbox';
  const highContrastHint = createElement('div', 'settings-muted');
  highContrastHint.textContent = 'Boosts object contrast and lighting for better daytime phone visibility.';
  highContrastGroup.append(highContrastLabel, highContrastToggle, highContrastHint);

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

  const audioSectionTitle = createElement('h3', 'settings-section-title', 'Audio');
  const musicVolumeField = createRangeField({ id: 'settings-audio-music', label: 'Music Volume', min: 0, max: 1, step: 0.05 });
  const sfxVolumeField = createRangeField({ id: 'settings-audio-sfx', label: 'SFX Volume', min: 0, max: 1, step: 0.05 });

  const savedMusicVol = parseFloat(localStorage.getItem('sq:musicVolume') ?? '0.05');
  const savedSfxVol = parseFloat(localStorage.getItem('sq:sfxVolume') ?? '1');
  musicVolumeField.input.value = `${Number.isFinite(savedMusicVol) ? savedMusicVol : 0.05}`;
  musicVolumeField.valueLabel.textContent = `${Math.round((Number.isFinite(savedMusicVol) ? savedMusicVol : 0.05) * 100)}%`;
  sfxVolumeField.input.value = `${Number.isFinite(savedSfxVol) ? savedSfxVol : 1}`;
  sfxVolumeField.valueLabel.textContent = `${Math.round((Number.isFinite(savedSfxVol) ? savedSfxVol : 1) * 100)}%`;

  const lightSectionTitle = createElement('h3', 'settings-section-title', 'Lighting');

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
  const skyField = createRangeField({
    id: 'settings-display-sky',
    label: 'Sky Brightness',
    min: 0.1,
    max: 1.6,
    step: 0.05
  });

  const hint = createElement('div', 'settings-muted');
  hint.textContent = 'Auto mode uses local time to switch between day and night lighting.';

  const tpCameraLabel = createElement('label', 'settings-label', '3rd Person Camera');
  const tpCameraHint = createElement('div', 'settings-muted');
  tpCameraHint.textContent = 'Adjust the third-person camera position and capsule transparency.';
  const tpCameraHeaderGroup = createElement('div', 'settings-field');
  tpCameraHeaderGroup.append(tpCameraLabel, tpCameraHint);

  const cameraDistField = createRangeField({ id: 'settings-display-cam-distance', label: 'Camera Distance', min: 1, max: 20, step: 0.5 });
  const cameraHeightField = createRangeField({ id: 'settings-display-cam-height', label: 'Camera Height', min: -2, max: 10, step: 0.25 });
  const lookTargetField = createRangeField({ id: 'settings-display-cam-look-target', label: 'Look Target Height', min: 0, max: 3, step: 0.1 });
  const capsuleOpacityField = createRangeField({ id: 'settings-display-capsule-opacity', label: 'Capsule Opacity', min: 0, max: 1, step: 0.05 });
  const fovField = createRangeField({ id: 'settings-display-fov', label: 'Field of View', min: 30, max: 160, step: 1 });

  panelEl.append(
    audioSectionTitle,
    musicVolumeField.field,
    sfxVolumeField.field,
    modeGroup,
    performanceGroup,
    firstPersonGroup,
    gyroGroup,
    gyroRecalGroup,
    highContrastGroup,
    tpCameraHeaderGroup,
    cameraDistField.field,
    cameraHeightField.field,
    lookTargetField.field,
    capsuleOpacityField.field,
    fovField.field,
    lightSectionTitle,
    ambientField.field,
    directionalField.field,
    skyField.field,
    hint
  );

  elements.displayFields = {
    musicVolumeSlider: musicVolumeField.input,
    musicVolumeValue: musicVolumeField.valueLabel,
    sfxVolumeSlider: sfxVolumeField.input,
    sfxVolumeValue: sfxVolumeField.valueLabel,
    modeSelect,
    performanceSelect,
    firstPersonToggle,
    gyroToggle,
    gyroRecalBtn,
    gyroRecalGroup,
    highContrastToggle,
    camDistanceSlider: cameraDistField.input,
    camDistanceValue: cameraDistField.valueLabel,
    camHeightSlider: cameraHeightField.input,
    camHeightValue: cameraHeightField.valueLabel,
    lookTargetSlider: lookTargetField.input,
    lookTargetValue: lookTargetField.valueLabel,
    capsuleOpacitySlider: capsuleOpacityField.input,
    capsuleOpacityValue: capsuleOpacityField.valueLabel,
    fovSlider: fovField.input,
    fovValue: fovField.valueLabel,
    sliders: {
      ambientIntensity: ambientField.input,
      directionalIntensity: directionalField.input,
      skyBrightness: skyField.input
    },
    values: {
      ambientIntensity: ambientField.valueLabel,
      directionalIntensity: directionalField.valueLabel,
      skyBrightness: skyField.valueLabel
    }
  };

  return panelEl;
}

const CREDITS_PATH = `${import.meta.env.BASE_URL ?? '/'}credits.json`;

function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function buildCreditsMarkup(entries) {
  if (!entries.length) {
    return '<strong>Credits</strong><br><br>No credits found.';
  }

  const blocks = entries.map((entry) => {
    const sourceText = escapeHtml(entry.source);
    const licenseText = escapeHtml(entry.licenseLabel);
    return `“${escapeHtml(entry.title)}” by ${escapeHtml(entry.author)}
  <br>Source: <a href="${escapeHtml(entry.source)}" target="_blank" rel="noreferrer noopener">${sourceText}</a>
  <br>License: <a href="${escapeHtml(entry.license)}" target="_blank" rel="noreferrer noopener">${licenseText}</a>`;
  });

  return `<strong>Credits</strong><br><br>${blocks.join('<br><br>')}`;
}

function normalizeCredits(entries) {
  if (!Array.isArray(entries)) return [];
  return entries
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null;
      const title = typeof entry.title === 'string' ? entry.title.trim() : '';
      const source = typeof entry.source === 'string' ? entry.source.trim() : '';
      const author = typeof entry.author === 'string' ? entry.author.trim() : '';
      const license = typeof entry.license === 'string' ? entry.license.trim() : '';
      if (!title || !source || !author || !license) return null;
      return {
        title,
        source,
        author,
        license,
        licenseLabel: license.includes('/4.0') ? 'CC BY 4.0' : license
      };
    })
    .filter(Boolean);
}

async function loadCredits(textEl) {
  try {
    const response = await fetch(CREDITS_PATH, { cache: 'no-cache' });
    if (!response.ok) {
      throw new Error(`Failed to load credits: ${response.status}`);
    }
    const rawJson = await response.json();
    const entries = normalizeCredits(rawJson);
    textEl.innerHTML = buildCreditsMarkup(entries);
  } catch (error) {
    textEl.innerHTML = '<strong>Credits</strong><br><br>Unable to load credits right now.';
  }
}

function buildAboutPanel() {
  const panelEl = createElement('section', 'settings-tabpanel');
  panelEl.id = 'panel-about';
  panelEl.dataset.panel = 'about';
  panelEl.setAttribute('role', 'tabpanel');
  panelEl.setAttribute('aria-labelledby', 'tab-about');

  const title = createElement('h3', 'settings-section-title', 'About');
  const text = createElement('div', 'settings-muted');
  text.style.whiteSpace = 'pre-wrap';
  text.innerHTML = '<strong>Credits</strong><br><br>Loading credits...';
  loadCredits(text);

  panelEl.append(title, text);
  return panelEl;
}

function buildAccountPanel() {
  const panelEl = createElement('section', 'settings-tabpanel');
  panelEl.id = 'panel-account';
  panelEl.dataset.panel = 'account';
  panelEl.setAttribute('role', 'tabpanel');
  panelEl.setAttribute('aria-labelledby', 'tab-account');

  const description = createElement(
    'div',
    'settings-muted',
    'Deleting your account permanently removes your profile data from Firebase.'
  );

  const deleteButton = createElement('button', 'settings-button settings-button-danger', 'Delete Account');
  deleteButton.type = 'button';
  deleteButton.dataset.action = 'delete-account';

  const confirm = createElement('div', 'settings-confirmation');
  confirm.hidden = true;

  const confirmText = createElement('div', 'settings-confirmation-text', 'Are you sure?');
  const confirmActions = createElement('div', 'settings-confirmation-actions');
  const confirmYes = createElement('button', 'settings-button settings-button-danger', 'Yes');
  confirmYes.type = 'button';
  confirmYes.dataset.action = 'confirm-delete-account';
  const confirmCancel = createElement('button', 'settings-button settings-button-secondary', 'Cancel');
  confirmCancel.type = 'button';
  confirmCancel.dataset.action = 'cancel-delete-account';

  confirmActions.append(confirmYes, confirmCancel);
  confirm.append(confirmText, confirmActions);

  const status = createElement('div', 'settings-muted');
  status.dataset.field = 'delete-account-status';

  panelEl.append(
    description,
    deleteButton,
    confirm,
    status
  );

  elements.deleteAccountButton = deleteButton;
  elements.deleteAccountConfirm = confirm;
  elements.deleteAccountConfirmYes = confirmYes;
  elements.deleteAccountConfirmCancel = confirmCancel;
  elements.deleteAccountStatus = status;

  return panelEl;
}

function buildSwordGyroPanel() {
  const panelEl = createElement('section', 'settings-tabpanel');
  panelEl.id = 'panel-swordgyro';
  panelEl.dataset.panel = 'swordgyro';
  panelEl.setAttribute('role', 'tabpanel');
  panelEl.setAttribute('aria-labelledby', 'tab-swordgyro');

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

  // Recalibrate button
  const calibSection = createElement('h3', 'settings-section-title', 'Calibration');
  const recalGroup = createElement('div', 'settings-field');
  const recalBtn = createElement('button', 'settings-button settings-button-secondary', 'Recalibrate Sword');
  recalBtn.id = 'settings-swordgyro-recal';
  recalBtn.type = 'button';
  recalBtn.addEventListener('click', () => {
    if (window.phoneSwordRecalibrate) {
      window.phoneSwordRecalibrate();
      recalBtn.textContent = '✅ Calibrated!';
      setTimeout(() => { recalBtn.textContent = 'Recalibrate Sword'; }, 1500);
    } else {
      document.getElementById('phone-sword-calib-modal')?.classList.remove('hidden');
    }
  });
  const recalHint = createElement('div', 'settings-muted');
  recalHint.textContent = 'Hold the sword in its resting position, then tap to set neutral.';
  recalGroup.append(recalBtn, recalHint);

  // Sensitivity sliders
  const sensSection = createElement('h3', 'settings-section-title', 'Hit Detection Sensitivity');

  const cfg = window.phoneSwordSwingCfg || {};

  const swingSpeedField = createRangeField({ id: 'sg-swing-speed', label: 'Min Swing Speed (deg/s)', min: 500, max: 15000, step: 100 });
  swingSpeedField.input.value = `${cfg.speedThreshold ?? 4370}`;
  swingSpeedField.valueLabel.textContent = `${cfg.speedThreshold ?? 4370}`;

  const swingArcField = createRangeField({ id: 'sg-swing-arc', label: 'Min Swing Arc (deg)', min: 5, max: 90, step: 1 });
  swingArcField.input.value = `${cfg.minSwingDelta ?? 25}`;
  swingArcField.valueLabel.textContent = `${cfg.minSwingDelta ?? 25}°`;

  const sweepSpeedField = createRangeField({ id: 'sg-sweep-speed', label: 'Min Sweep Speed (deg/s)', min: 50, max: 5000, step: 50 });
  sweepSpeedField.input.value = `${cfg.minSweepSpeed ?? 100}`;
  sweepSpeedField.valueLabel.textContent = `${cfg.minSweepSpeed ?? 100}`;

  const sweepDistField = createRangeField({ id: 'sg-sweep-dist', label: 'Min Tip Movement (m)', min: 0.01, max: 1.0, step: 0.01 });
  sweepDistField.input.value = `${cfg.minSweepDist ?? 0.3}`;
  sweepDistField.valueLabel.textContent = `${(cfg.minSweepDist ?? 0.3).toFixed(2)}m`;

  const sensHint = createElement('div', 'settings-muted');
  sensHint.textContent = 'Lower values = easier to register hits. Higher values = harder but more deliberate.';

  panelEl.append(
    calibSection,
    recalGroup,
    sensSection,
    swingSpeedField.field,
    swingArcField.field,
    sweepSpeedField.field,
    sweepDistField.field,
    sensHint
  );

  elements.swordGyroFields = {
    recalBtn,
    swingSpeedInput: swingSpeedField.input,
    swingSpeedValue: swingSpeedField.valueLabel,
    swingArcInput: swingArcField.input,
    swingArcValue: swingArcField.valueLabel,
    sweepSpeedInput: sweepSpeedField.input,
    sweepSpeedValue: sweepSpeedField.valueLabel,
    sweepDistInput: sweepDistField.input,
    sweepDistValue: sweepDistField.valueLabel,
  };

  return panelEl;
}

function buildPanels() {
  const body = createElement('div', 'settings-body');
  elements.panels = {
    character: buildCharacterPanel(),
    multiplayer: buildMultiplayerPanel(),
    display: buildDisplayPanel(),
    swordgyro: buildSwordGyroPanel(),
    about: buildAboutPanel(),
    account: buildAccountPanel(),
    developer: buildDeveloperPanel()
  };
  body.append(...Object.values(elements.panels));
  return body;
}

function buildLeaderboardOverlay() {
  leaderboardOverlay = document.getElementById('leaderboard-overlay');
  if (!leaderboardOverlay) {
    leaderboardOverlay = createElement('div', 'settings-overlay');
    leaderboardOverlay.id = 'leaderboard-overlay';
    leaderboardOverlay.style.display = 'none';
    document.body.appendChild(leaderboardOverlay);
  }
  leaderboardOverlay.setAttribute('aria-hidden', 'true');

  leaderboardPanel = createElement('div', 'settings-shell leaderboard-shell');
  leaderboardPanel.id = 'leaderboard-panel';
  leaderboardPanel.setAttribute('role', 'dialog');
  leaderboardPanel.setAttribute('aria-modal', 'true');
  leaderboardPanel.setAttribute('aria-labelledby', 'leaderboard-title');
  leaderboardPanel.tabIndex = -1;

  const header = createElement('div', 'settings-header');
  const title = createElement('h2', 'settings-title', 'Leaderboard');
  title.id = 'leaderboard-title';
  const closeButton = createElement('button', 'settings-close', '✕');
  closeButton.type = 'button';
  closeButton.dataset.leaderboardAction = 'close';
  closeButton.setAttribute('aria-label', 'Close leaderboard');
  header.append(title, closeButton);

  const tabs = createElement('div', 'leaderboard-tabs');
  tabs.setAttribute('role', 'tablist');
  const killsTab = createElement('button', 'leaderboard-tab is-active', '⚔️ Top Kills');
  killsTab.type = 'button';
  killsTab.dataset.leaderboardTab = 'kills';
  killsTab.setAttribute('role', 'tab');
  killsTab.setAttribute('aria-selected', 'true');
  const stageTab = createElement('button', 'leaderboard-tab', '⚔️ Top Stage');
  stageTab.type = 'button';
  stageTab.dataset.leaderboardTab = 'stage';
  stageTab.setAttribute('role', 'tab');
  stageTab.setAttribute('aria-selected', 'false');
  tabs.append(killsTab, stageTab);

  const body = createElement('div', 'leaderboard-body');
  const status = createElement('div', 'settings-muted', 'Loading leaderboard...');
  const list = createElement('ol', 'leaderboard-list');
  body.append(status, list);

  const actions = createElement('div', 'leaderboard-actions');
  const okButton = createElement('button', 'settings-button', 'OK');
  okButton.type = 'button';
  okButton.dataset.leaderboardAction = 'close';
  actions.append(okButton);

  leaderboardPanel.append(header, tabs, body, actions);
  leaderboardOverlay.replaceChildren(leaderboardPanel);

  elements.leaderboardTabs = { kills: killsTab, stage: stageTab };
  elements.leaderboardList = list;
  elements.leaderboardStatus = status;
  elements.leaderboardActiveTab = 'kills';
  elements.leaderboardData = { topKills: [], topStage: [] };
}

function setLeaderboardTab(tabId) {
  const validTabs = ['kills', 'stage'];
  const safeTab = validTabs.includes(tabId) ? tabId : 'kills';
  elements.leaderboardActiveTab = safeTab;
  Object.entries(elements.leaderboardTabs || {}).forEach(([id, button]) => {
    const active = id === safeTab;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  renderLeaderboard();
}

function renderLeaderboard() {
  if (!elements.leaderboardList || !elements.leaderboardStatus) return;
  const activeTab = elements.leaderboardActiveTab;
  const rows = (activeTab === 'stage' ? elements.leaderboardData?.topStage : elements.leaderboardData?.topKills) || [];
  const valueLabel = activeTab === 'stage' ? 'stage' : 'kills';
  elements.leaderboardList.innerHTML = '';
  if (!rows.length) {
    elements.leaderboardStatus.textContent = 'No scores yet.';
    elements.leaderboardStatus.hidden = false;
    return;
  }
  elements.leaderboardStatus.hidden = true;
  rows.forEach((entry, index) => {
    const item = createElement('li', 'leaderboard-row');
    const rank = createElement('span', 'leaderboard-rank', `#${index + 1}`);
    const name = createElement('span', 'leaderboard-name', entry.name || 'Unknown Player');
    const value = createElement('span', 'leaderboard-value', `${Math.max(0, Math.floor(entry.value || 0)).toLocaleString()} ${valueLabel}`);
    item.append(rank, name, value);
    elements.leaderboardList.appendChild(item);
  });
}

async function openLeaderboardOverlay() {
  if (!leaderboardOverlay || !leaderboardPanel) return;
  closeOverlay();
  leaderboardOverlay.style.display = 'flex';
  leaderboardOverlay.setAttribute('aria-hidden', 'false');
  syncOverlayBodyState();
  leaderboardPanel.focus?.();
  elements.leaderboardStatus.hidden = false;
  elements.leaderboardStatus.textContent = 'Loading leaderboard...';
  elements.leaderboardList.innerHTML = '';
  setLeaderboardTab(elements.leaderboardActiveTab || 'kills');
  try {
    if (!context.appState?.getPhoneSwordLeaderboards) {
      throw new Error('Leaderboards unavailable');
    }
    const data = await context.appState.getPhoneSwordLeaderboards(10);
    elements.leaderboardData = {
      topKills: data?.topKills ?? [],
      topStage: data?.topStage ?? []
    };
    renderLeaderboard();
  } catch (error) {
    console.warn('Failed to load leaderboard:', error);
    elements.leaderboardStatus.hidden = false;
    elements.leaderboardStatus.textContent = 'Failed to load leaderboard.';
  }
}

function closeLeaderboardOverlay() {
  if (!leaderboardOverlay) return;
  leaderboardOverlay.style.display = 'none';
  leaderboardOverlay.setAttribute('aria-hidden', 'true');
  syncOverlayBodyState();
}

function setActiveTab(tabId) {
  const newTab = elements.tabs?.[tabId];
  const newPanel = elements.panels?.[tabId];
  if (!newTab || !newPanel) return;
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
}

function openOverlay() {
  if (!overlay) return;
  lastFocusedElement = document.activeElement;
  overlay.style.display = 'flex';
  overlay.setAttribute('aria-hidden', 'false');
  syncOverlayBodyState();
  refreshLayout();
  if (isMobileView) {
    setListView(true);
  } else {
    panel?.focus?.();
  }
  updateUI();
}

function closeOverlay() {
  if (!overlay) return;
  overlay.style.display = 'none';
  overlay.setAttribute('aria-hidden', 'true');
  syncOverlayBodyState();
  if (lastFocusedElement && typeof lastFocusedElement.focus === 'function') {
    lastFocusedElement.focus();
  }
}

function syncOverlayBodyState() {
  const isSettingsOpen = overlay?.getAttribute('aria-hidden') === 'false';
  const isLeaderboardOpen = leaderboardOverlay?.getAttribute('aria-hidden') === 'false';
  document.body.classList.toggle('settings-open', isSettingsOpen || isLeaderboardOpen);
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
  } else if (action === 'open-leaderboard') {
    await openLeaderboardOverlay();
  } else if (action === 'reconnect') {
    context.multiplayer?.reconnect?.();
  } else if (action === 'toggle-console') {
    const visible = elements.consoleLog.style.display === 'block';
    elements.consoleLog.style.display = visible ? 'none' : 'block';
    elements.consoleButton.textContent = visible ? 'Show Console' : 'Hide Console';
  } else if (action === 'copy-debug') {
    const info = collectDebugInfo();
    navigator.clipboard?.writeText?.(info);
  } else if (action === 'save-name') {
    if (!elements.nameInput) return;
    const desiredName = elements.nameInput.value.trim();
    if (!desiredName) {
      elements.nameInput.value = context.appState?.getPlayerName?.() ?? '';
      updateNameSaveState();
      return;
    }
    if (!context.appState?.savePlayerName) {
      setNameStatus('Name changes are unavailable right now.', 'error');
      return;
    }
    const button = elements.nameSaveButton;
    if (button) {
      button.disabled = true;
    }
    setNameStatus('');
    try {
      const result = await context.appState.savePlayerName(desiredName);
      if (result?.status === 'taken') {
        setNameStatus('Name is taken! Choose another one.', 'error');
      } else if (result?.status === 'invalid') {
        setNameStatus('Enter a valid name before saving.', 'error');
      } else if (result?.status === 'missing-pin') {
        setNameStatus('Unable to verify name ownership. Please re-login.', 'error');
      } else if (result?.status === 'error') {
        setNameStatus('Failed to save name. Try again.', 'error');
      } else {
        setNameStatus('');
      }
    } catch (error) {
      console.warn('Failed to save name:', error);
      setNameStatus('Failed to save name. Try again.', 'error');
    } finally {
      if (button) {
        button.disabled = false;
      }
      updateNameSaveState();
    }
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
  } else if (action === 'delete-account') {
    if (elements.deleteAccountConfirm) {
      elements.deleteAccountConfirm.hidden = false;
    }
  } else if (action === 'cancel-delete-account') {
    if (elements.deleteAccountConfirm) {
      elements.deleteAccountConfirm.hidden = true;
    }
  } else if (action === 'confirm-delete-account') {
    const { deleteAccountButton, deleteAccountConfirm, deleteAccountStatus } = elements;
    if (deleteAccountConfirm) {
      deleteAccountConfirm.hidden = true;
    }
    if (!context.appState?.deleteAccount) {
      if (deleteAccountStatus) {
        deleteAccountStatus.textContent = 'Account deletion is unavailable.';
      }
      return;
    }
    if (deleteAccountStatus) {
      deleteAccountStatus.textContent = 'Deleting account...';
    }
    if (deleteAccountButton) {
      deleteAccountButton.disabled = true;
    }
    try {
      const result = await context.appState.deleteAccount();
      if (deleteAccountStatus) {
        deleteAccountStatus.textContent = result?.status === 'ok'
          ? 'Account deleted.'
          : 'Failed to delete account. Try again.';
      }
    } catch (error) {
      console.warn('Failed to delete account:', error);
      if (deleteAccountStatus) {
        deleteAccountStatus.textContent = 'Failed to delete account. Try again.';
      }
    } finally {
      if (deleteAccountButton) {
        deleteAccountButton.disabled = false;
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
  leaderboardOverlay?.addEventListener('click', (event) => {
    if (event.target === leaderboardOverlay) {
      closeLeaderboardOverlay();
    }
  });

  const handlePanelClick = (event) => {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.dataset.leaderboardAction === 'close') {
      closeLeaderboardOverlay();
      return;
    }
    if (button.dataset.leaderboardTab) {
      setLeaderboardTab(button.dataset.leaderboardTab);
      return;
    }
    if (button.dataset.tab) {
      setTab(button.dataset.tab);
      return;
    }
    if (button.dataset.action) {
      void handleAction(button);
    }
  };

  panel.addEventListener('click', handlePanelClick);
  leaderboardPanel?.addEventListener('click', handlePanelClick);

  elements.nameInput.addEventListener('input', () => {
    setNameStatus('');
    updateNameSaveState();
  });

  elements.nameInput.addEventListener('focus', () => {
    isEditingName = true;
  });

  elements.nameInput.addEventListener('blur', (event) => {
    isEditingName = false;
    if (!event.target.value.trim()) {
      event.target.value = context.appState?.getPlayerName?.() ?? '';
    }
    updateNameSaveState();
  });

  if (elements.displayFields?.musicVolumeSlider) {
    elements.displayFields.musicVolumeSlider.addEventListener('input', (event) => {
      const value = parseFloat(event.target.value);
      if (elements.displayFields.musicVolumeValue) {
        elements.displayFields.musicVolumeValue.textContent = `${Math.round(value * 100)}%`;
      }
      window.audioManager?.setMusicVolume?.(value);
      localStorage.setItem('sq:musicVolume', `${value}`);
    });
  }

  if (elements.displayFields?.sfxVolumeSlider) {
    elements.displayFields.sfxVolumeSlider.addEventListener('input', (event) => {
      const value = parseFloat(event.target.value);
      if (elements.displayFields.sfxVolumeValue) {
        elements.displayFields.sfxVolumeValue.textContent = `${Math.round(value * 100)}%`;
      }
      window.audioManager?.setSFXVolume?.(value);
      localStorage.setItem('sq:sfxVolume', `${value}`);
    });
  }

  if (elements.displayFields?.modeSelect) {
    elements.displayFields.modeSelect.addEventListener('change', (event) => {
      const value = event.target.value;
      context.appState?.setDisplayMode?.(value);
    });
  }

  if (elements.displayFields?.performanceSelect) {
    elements.displayFields.performanceSelect.addEventListener('change', (event) => {
      const value = event.target.value;
      context.appState?.setDisplaySetting?.('performanceMode', value);
    });
  }
  if (elements.displayFields?.firstPersonToggle) {
    elements.displayFields.firstPersonToggle.addEventListener('change', (event) => {
      if (window.playerControls) {
        window.playerControls.firstPersonView = event.target.checked;
      }
    });
  }

  const _wireTpSlider = (sliderKey, valueKey, tpConfigKey, format) => {
    const slider = elements.displayFields?.[sliderKey];
    if (!slider) return;
    const syncFromControls = () => {
      const cfg = window.playerControls?.tpConfig;
      if (cfg && tpConfigKey in cfg) {
        slider.value = cfg[tpConfigKey];
        if (elements.displayFields?.[valueKey]) {
          elements.displayFields[valueKey].textContent = format(cfg[tpConfigKey]);
        }
      }
    };
    slider.addEventListener('input', (event) => {
      const value = parseFloat(event.target.value);
      if (window.playerControls?.tpConfig) {
        window.playerControls.tpConfig[tpConfigKey] = value;
      }
      if (elements.displayFields?.[valueKey]) {
        elements.displayFields[valueKey].textContent = format(value);
      }
    });
    syncFromControls();
    window.addEventListener('playercontrols-ready', syncFromControls, { once: true });
  };

  _wireTpSlider('camDistanceSlider', 'camDistanceValue', 'distance', v => v.toFixed(1));
  _wireTpSlider('camHeightSlider', 'camHeightValue', 'height', v => v.toFixed(2));
  _wireTpSlider('lookTargetSlider', 'lookTargetValue', 'lookTargetHeight', v => v.toFixed(1));
  _wireTpSlider('capsuleOpacitySlider', 'capsuleOpacityValue', 'capsuleOpacity', v => v.toFixed(2));

  if (elements.displayFields?.fovSlider) {
    const fovSlider = elements.displayFields.fovSlider;
    const syncFov = () => {
      const cam = window.playerControls?.camera;
      if (cam) {
        fovSlider.value = cam.fov;
        if (elements.displayFields?.fovValue) {
          elements.displayFields.fovValue.textContent = Math.round(cam.fov);
        }
      }
    };
    fovSlider.addEventListener('input', (event) => {
      const v = parseFloat(event.target.value);
      const controls = window.playerControls;
      if (controls) {
        controls.camera.fov = v;
        controls.camera.updateProjectionMatrix();
        controls.defaultFov = v;
        controls.defaultFovDesktop = v;
      }
      if (elements.displayFields?.fovValue) {
        elements.displayFields.fovValue.textContent = Math.round(v);
      }
    });
    syncFov();
    window.addEventListener('playercontrols-ready', syncFov, { once: true });
  }

  if (elements.displayFields?.gyroToggle) {
    elements.displayFields.gyroToggle.addEventListener('change', async (event) => {
      const controls = window.playerControls;
      if (!controls) return;
      if (event.target.checked) {
        event.target.disabled = true;
        const ok = await controls.initGyroscope();
        event.target.disabled = false;
        if (!ok) {
          event.target.checked = false;
        }
      } else {
        controls.disableGyroscope();
      }
      const active = controls.gyroActive;
      if (elements.displayFields?.gyroRecalGroup) {
        elements.displayFields.gyroRecalGroup.hidden = !active;
      }
    });
  }

  if (elements.displayFields?.gyroRecalBtn) {
    elements.displayFields.gyroRecalBtn.addEventListener('click', () => {
      window.playerControls?.calibrateGyroscope?.();
    });
  }

  if (elements.displayFields?.highContrastToggle) {
    elements.displayFields.highContrastToggle.addEventListener('change', (event) => {
      context.appState?.setDisplaySetting?.('highContrastMode', event.target.checked);
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

  if (elements.swordGyroFields) {
    const f = elements.swordGyroFields;
    const bindSwingSlider = (input, valueEl, cfgKey, fmt) => {
      input.addEventListener('input', () => {
        const v = parseFloat(input.value);
        valueEl.textContent = fmt ? fmt(v) : `${v}`;
        if (window.phoneSwordSwingCfg) window.phoneSwordSwingCfg[cfgKey] = v;
      });
    };
    bindSwingSlider(f.swingSpeedInput, f.swingSpeedValue, 'speedThreshold', v => `${Math.round(v)}`);
    bindSwingSlider(f.swingArcInput, f.swingArcValue, 'minSwingDelta', v => `${Math.round(v)}°`);
    bindSwingSlider(f.sweepSpeedInput, f.sweepSpeedValue, 'minSweepSpeed', v => `${Math.round(v)}`);
    bindSwingSlider(f.sweepDistInput, f.sweepDistValue, 'minSweepDist', v => `${v.toFixed(2)}m`);
  }
}

function collectDebugInfo() {
  const connectionStatus = context.appState?.getConnectionStatus?.() ?? 'Unknown';
  const lastPing = context.appState?.getLastPing?.();
  const lastError = context.appState?.getLastError?.();
  const version = context.appState?.getAppVersion?.() ?? 'unknown';
  const viewport = `${window.innerWidth}x${window.innerHeight}`;
  const playerPosition = window.playerModel?.position;
  const playerText = playerPosition ? `${playerPosition.x.toFixed(2)}, ${playerPosition.z.toFixed(2)}` : '—';
  const info = [
    `version: ${version}`,
    `userAgent: ${navigator.userAgent}`,
    `viewport: ${viewport}`,
    `connectionStatus: ${connectionStatus}`,
    `lastPing: ${typeof lastPing === 'number' ? `${lastPing} ms` : 'N/A'}`,
    `playerXZ: ${playerText}`,
    `lastError: ${lastError ? `${lastError.message} @ ${formatTimestamp(lastError.timestamp)}` : '—'}`
  ];
  return info.join('\n');
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
}

export function updateUI() {
  if (!panel) return;
  if (elements.nameInput && context.appState?.getPlayerName && !isEditingName) {
    const name = context.appState.getPlayerName();
    if (elements.nameInput.value !== name) {
      elements.nameInput.value = name;
    }
    updateNameSaveState();
  }
  if (elements.characterStatFields && context.appState?.getPlayerStats) {
    const stats = context.appState.getPlayerStats() || {};
    Object.entries(elements.characterStatFields).forEach(([key, node]) => {
      node.textContent = formatStatValue(key, stats[key]);
    });
  }
  if (elements.phoneSwordStatFields) {
    const psStats = context.appState?.getPhoneSwordStats?.() || {};
    Object.entries(elements.phoneSwordStatFields).forEach(([key, node]) => {
      const val = psStats[key];
      node.textContent = Number.isFinite(val) ? String(Math.max(0, Math.floor(val))) : '—';
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

  if (elements.displayFields && context.appState?.getDisplaySettings) {
    const displaySettings = context.appState.getDisplaySettings();
    if (displaySettings?.mode && elements.displayFields.modeSelect) {
      if (elements.displayFields.modeSelect.value !== displaySettings.mode) {
        elements.displayFields.modeSelect.value = displaySettings.mode;
      }
    }
    if (displaySettings?.performanceMode && elements.displayFields.performanceSelect) {
      if (elements.displayFields.performanceSelect.value !== displaySettings.performanceMode) {
        elements.displayFields.performanceSelect.value = displaySettings.performanceMode;
      }
    }
    if (elements.displayFields.highContrastToggle) {
      elements.displayFields.highContrastToggle.checked = Boolean(displaySettings?.highContrastMode);
    }
    if (elements.displayFields.gyroToggle && !elements.displayFields.gyroToggle.disabled) {
      const gyroActive = Boolean(window.playerControls?.gyroActive);
      elements.displayFields.gyroToggle.checked = gyroActive;
      if (elements.displayFields.gyroRecalGroup) {
        elements.displayFields.gyroRecalGroup.hidden = !gyroActive;
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

export function initSettingsPanel({ appState, multiplayer, player } = {}) {
  context = { appState, multiplayer, player };
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
  buildLeaderboardOverlay();

  refreshLayout();

  const storedTab = localStorage.getItem(TAB_KEY);
  setActiveTab(storedTab && elements.tabs[storedTab] ? storedTab : 'character');

  bindEvents();
  const savedTab = localStorage.getItem(TAB_KEY) || 'character';
  setActiveTab(savedTab);
  updateUI();
}

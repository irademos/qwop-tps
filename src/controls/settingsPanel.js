import { CAMERA_CONFIG_DEFAULTS } from './controls.js';
const TAB_KEY = 'settings:lastTab';

const TABS = [
  { id: 'profile', label: 'Profile' },
  { id: 'multiplayer', label: 'Multiplayer' },
  { id: 'display', label: 'Display' },
  { id: 'swordgyro', label: 'Sword Gyro' },
  { id: 'about', label: 'About' },
  { id: 'account', label: 'Account' }
];

// Settings → Profile: sections of appState.getProfileStats() (pick = the section's object)
const PROFILE_STAT_SECTIONS = [
  {
    title: 'Stats',
    pick: (stats) => stats,
    rows: [
      { key: 'level', label: 'Level' },
      { key: 'xp', label: 'XP' },
      { key: 'coins', label: 'Coins' }
    ]
  },
  {
    title: 'Sword Showdown',
    pick: (stats) => stats.showdown,
    rows: [
      { key: 'currentStage', label: 'Current Stage' },
      { key: 'highestStage', label: 'Highest Stage' },
      { key: 'kills', label: 'Kills' },
      { key: 'deaths', label: 'Deaths' },
      { key: 'maxHearts', label: 'Max Hearts' },
      { key: 'shieldUpgrades', label: 'Shield Upgrades' },
      { key: 'bombs', label: 'Bombs' },
      { key: 'bubbles', label: 'Bubbles' },
      {
        key: 'charactersUnlocked',
        label: 'Characters',
        format: (section) => (Number.isFinite(section?.charactersUnlocked)
          ? `${section.charactersUnlocked} / ${section.charactersTotal}`
          : '—')
      }
    ]
  },
  {
    title: 'Classic',
    pick: (stats) => stats.classic,
    rows: [
      { key: 'currentStage', label: 'Current Stage' },
      { key: 'highestStage', label: 'Highest Stage' },
      { key: 'kills', label: 'Kills' },
      { key: 'deaths', label: 'Deaths' }
    ]
  }
];

// Settings → Display → First Person Camera sliders (PlayerControls.cameraConfig)
const CAMERA_FIELDS = [
  { key: 'eyeHeight', label: 'Eye Height (m)', min: 0.2, max: 2, step: 0.05, decimals: 2 },
  { key: 'eyeForward', label: 'Eye Forward (m)', min: -0.5, max: 0.5, step: 0.05, decimals: 2 },
  { key: 'fov', label: 'Field of View (°)', min: 40, max: 140, step: 1, decimals: 0 }
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

function formatStatValue(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) return '—';
  return Math.max(0, Math.floor(value)).toLocaleString();
}

// Multiplayer room ids (peerConnection.js) → what the player is doing
function describeRoom(roomId) {
  if (!roomId) return '—';
  if (roomId === 'lobby') return 'Lobby';
  if (roomId.startsWith('duel-')) return 'Duel';
  if (roomId.startsWith('mm-')) return 'Matchmaking';
  if (roomId.startsWith('party-')) return 'Party';
  if (roomId.startsWith('match-')) return 'Battle';
  return roomId;
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (_) {
    // Older / non-secure contexts: copy through a hidden textarea
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (_) { ok = false; }
    area.remove();
    return ok;
  }
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

function buildProfilePanel() {
  const panelEl = createElement('section', 'settings-tabpanel');
  panelEl.id = 'panel-profile';
  panelEl.dataset.panel = 'profile';
  panelEl.setAttribute('role', 'tabpanel');
  panelEl.setAttribute('aria-labelledby', 'tab-profile');

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

  const guestNote = createElement('div', 'settings-muted', 'Playing as a guest: nothing is saved after you leave.');
  guestNote.hidden = !context.appState?.isGuest?.();

  panelEl.append(nameGroup, guestNote);

  // [{ node, pick, row }] — filled in by updateUI()
  elements.profileStatFields = [];
  PROFILE_STAT_SECTIONS.forEach(({ title, pick, rows }) => {
    const sectionTitle = createElement('h3', 'settings-section-title', title);
    const grid = createElement('div', 'settings-stats-grid');
    rows.forEach((row) => {
      const statRow = createElement('div', 'settings-stat');
      const statLabel = createElement('span', 'settings-stat-label', row.label);
      const statValue = createElement('span', 'settings-stat-value', '—');
      statRow.append(statLabel, statValue);
      grid.appendChild(statRow);
      elements.profileStatFields.push({ node: statValue, pick, row });
    });
    panelEl.append(sectionTitle, grid);
  });

  const leaderboardButton = createElement('button', 'settings-button', 'Showdown Leaderboard');
  leaderboardButton.type = 'button';
  leaderboardButton.dataset.action = 'open-leaderboard';
  panelEl.append(leaderboardButton);

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

  const offlineHint = createElement('div', 'settings-muted',
    'Multiplayer connects when you pick Multiplayer on the start screen.');

  const statusRow = createElement('div', 'settings-row');
  statusRow.innerHTML = '<span>Connection</span><span data-field="connection-status">—</span>';
  const roomRow = createElement('div', 'settings-row');
  roomRow.innerHTML = '<span>Where</span><span data-field="room">—</span>';
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

  panelEl.append(offlineHint, statusRow, roomRow, pingRow, playersTitle, playersList, reconnectButton, errorTitle, errorText);

  elements.multiplayerOfflineHint = offlineHint;
  elements.connectionStatus = statusRow.querySelector('[data-field="connection-status"]');
  elements.room = roomRow.querySelector('[data-field="room"]');
  elements.ping = pingRow.querySelector('[data-field="ping"]');
  elements.playersList = playersList;
  elements.reconnectButton = reconnectButton;
  elements.connectionError = errorText;

  return panelEl;
}

function buildDisplayPanel() {
  const panelEl = createElement('section', 'settings-tabpanel');
  panelEl.id = 'panel-display';
  panelEl.dataset.panel = 'display';
  panelEl.setAttribute('role', 'tabpanel');
  panelEl.setAttribute('aria-labelledby', 'tab-display');

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

  const cameraSectionTitle = createElement('h3', 'settings-section-title', 'First Person Camera');
  const firstPersonGroup = createElement('div', 'settings-field');
  const firstPersonLabel = createElement('label', 'settings-label', 'First Person View');
  firstPersonLabel.setAttribute('for', 'settings-display-first-person');
  const firstPersonToggle = createElement('input', 'settings-checkbox');
  firstPersonToggle.id = 'settings-display-first-person';
  firstPersonToggle.type = 'checkbox';
  const firstPersonHint = createElement('div', 'settings-muted');
  firstPersonHint.textContent = 'See through your character\'s eyes (the body is hidden, the sword stays).';
  firstPersonGroup.append(firstPersonLabel, firstPersonToggle, firstPersonHint);
  const cameraFields = {};
  CAMERA_FIELDS.forEach(({ key, label, min, max, step }) => {
    cameraFields[key] = createRangeField({ id: `settings-camera-${key}`, label, min, max, step });
  });
  const cameraActions = createElement('div', 'settings-name-row');
  const cameraCopyButton = createElement('button', 'settings-button', 'Copy Values');
  cameraCopyButton.type = 'button';
  cameraCopyButton.dataset.action = 'copy-camera';
  const cameraResetButton = createElement('button', 'settings-button settings-button-secondary', 'Reset');
  cameraResetButton.type = 'button';
  cameraResetButton.dataset.action = 'reset-camera';
  cameraActions.append(cameraCopyButton, cameraResetButton);
  const cameraHint = createElement('div', 'settings-muted');
  cameraHint.textContent = 'Eye height and forward apply in first person view; field of view applies to both views. Saved on this device.';

  panelEl.append(
    audioSectionTitle,
    musicVolumeField.field,
    sfxVolumeField.field,
    performanceGroup,
    gyroGroup,
    gyroRecalGroup,
    highContrastGroup,
    cameraSectionTitle,
    firstPersonGroup,
    ...CAMERA_FIELDS.map(({ key }) => cameraFields[key].field),
    cameraActions,
    cameraHint
  );

  elements.displayFields = {
    musicVolumeSlider: musicVolumeField.input,
    musicVolumeValue: musicVolumeField.valueLabel,
    sfxVolumeSlider: sfxVolumeField.input,
    sfxVolumeValue: sfxVolumeField.valueLabel,
    performanceSelect,
    gyroToggle,
    gyroRecalBtn,
    gyroRecalGroup,
    highContrastToggle,
    firstPersonToggle,
    cameraFields,
    cameraCopyButton
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

  const troubleTitle = createElement('h3', 'settings-section-title', 'Troubleshooting');
  const clearCacheButton = createElement('button', 'settings-button', 'Clear Cache & Reload');
  clearCacheButton.type = 'button';
  clearCacheButton.dataset.action = 'clear-cache';
  const clearCacheStatus = createElement('div', 'settings-muted',
    'Re-downloads the game files (fixes an old version or missing assets after an update). Your progress and settings are kept.');

  panelEl.append(title, text, troubleTitle, clearCacheButton, clearCacheStatus);
  elements.clearCacheButton = clearCacheButton;
  elements.clearCacheStatus = clearCacheStatus;
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
    'Deleting your account permanently removes your profile (stats, stages, characters, coins and items) and frees your name.'
  );
  const guestNote = createElement('div', 'settings-muted', 'Playing as a guest: there is no account to delete.');

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

  // Guests have no profile: only the note
  const isGuest = !!context.appState?.isGuest?.();
  description.hidden = isGuest;
  deleteButton.hidden = isGuest;
  guestNote.hidden = !isGuest;

  panelEl.append(
    description,
    guestNote,
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

  // Gyro sensitivity (saved per device): "Use This Device" and a separate phone by QR code
  const gyroSensSection = createElement('h3', 'settings-section-title', 'Gyro Sensitivity');
  const createSensField = (id, label, value) => {
    const f = createRangeField({ id, label, min: 0.5, max: 4, step: 0.1 });
    f.input.value = `${value}`;
    f.valueLabel.textContent = `${value.toFixed(1)}×`;
    return f;
  };
  const localSensField = createSensField('sg-local-sensitivity', 'This Device', window.phoneSwordLocalSensitivity ?? 2);
  const phoneSensField = createSensField('sg-phone-sensitivity', 'Phone by QR Code', window.phoneSwordPhoneSensitivity ?? 1);
  const gyroSensHint = createElement('div', 'settings-muted');
  gyroSensHint.textContent = 'How far the sword turns for each tilt of the phone. "This Device" is used when the game screen is also the sword — higher means smaller movements, so you can keep watching the screen.';

  panelEl.append(
    calibSection,
    recalGroup,
    gyroSensSection,
    localSensField.field,
    phoneSensField.field,
    gyroSensHint
  );

  elements.swordGyroFields = {
    recalBtn,
    localSensInput: localSensField.input,
    localSensValue: localSensField.valueLabel,
    phoneSensInput: phoneSensField.input,
    phoneSensValue: phoneSensField.valueLabel,
  };

  return panelEl;
}

function buildPanels() {
  const body = createElement('div', 'settings-body');
  elements.panels = {
    profile: buildProfilePanel(),
    multiplayer: buildMultiplayerPanel(),
    display: buildDisplayPanel(),
    swordgyro: buildSwordGyroPanel(),
    about: buildAboutPanel(),
    account: buildAccountPanel()
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
  syncCameraFields();
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
    getMultiplayer()?.reconnect?.();
  } else if (action === 'copy-camera') {
    const cfg = window.playerControls?.getCameraConfig?.() ?? CAMERA_CONFIG_DEFAULTS;
    const ok = await copyText(JSON.stringify(cfg));
    const button = elements.displayFields?.cameraCopyButton;
    if (button) {
      button.textContent = ok ? '✅ Copied!' : 'Copy failed';
      setTimeout(() => { button.textContent = 'Copy Values'; }, 1500);
    }
  } else if (action === 'reset-camera') {
    window.playerControls?.setCameraConfig?.({ ...CAMERA_CONFIG_DEFAULTS });
    syncCameraFields();
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
  } else if (action === 'clear-cache') {
    // Service worker caches (public/service-worker.js) + the worker itself; the reload
    // fetches fresh files and registers it again. localStorage / cookies are untouched.
    if (!window.confirm('Clear the cached game files and reload?')) return;
    elements.clearCacheButton.disabled = true;
    elements.clearCacheStatus.textContent = 'Clearing cache...';
    try {
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map(key => caches.delete(key)));
      }
      const registrations = await navigator.serviceWorker?.getRegistrations?.() ?? [];
      await Promise.all(registrations.map(registration => registration.unregister()));
    } catch (error) {
      console.warn('Failed to clear cache:', error);
    }
    window.location.reload();
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

  if (elements.displayFields?.performanceSelect) {
    elements.displayFields.performanceSelect.addEventListener('change', (event) => {
      const value = event.target.value;
      context.appState?.setDisplaySetting?.('performanceMode', value);
    });
  }
  elements.displayFields?.firstPersonToggle?.addEventListener('change', (event) => {
    window.playerControls?.setCameraConfig?.({ firstPerson: event.target.checked });
  });
  Object.entries(elements.displayFields?.cameraFields || {}).forEach(([key, { input, valueLabel }]) => {
    const { decimals } = CAMERA_FIELDS.find(field => field.key === key);
    input.addEventListener('input', () => {
      const value = parseFloat(input.value);
      valueLabel.textContent = value.toFixed(decimals);
      window.playerControls?.setCameraConfig?.({ [key]: value });
    });
  });

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

  window.addEventListener('resize', () => {
    refreshLayout();
  });

  if (elements.swordGyroFields) {
    const f = elements.swordGyroFields;
    const bindSensSlider = (input, valueEl, globalKey, storageKey) => {
      input.addEventListener('input', () => {
        const v = parseFloat(input.value);
        valueEl.textContent = `${v.toFixed(1)}×`;
        window[globalKey] = v;
        try { localStorage.setItem(storageKey, `${v}`); } catch (_) { /* ignore */ }
      });
    };
    bindSensSlider(f.localSensInput, f.localSensValue, 'phoneSwordLocalSensitivity', 'sq:swordLocalSensitivity');
    bindSensSlider(f.phoneSensInput, f.phoneSensValue, 'phoneSwordPhoneSensitivity', 'sq:swordPhoneSensitivity');
  }
}

// Camera sliders ← PlayerControls.cameraConfig (when the panel opens, after Reset)
function syncCameraFields() {
  const cfg = window.playerControls?.getCameraConfig?.() ?? CAMERA_CONFIG_DEFAULTS;
  if (elements.displayFields?.firstPersonToggle) {
    elements.displayFields.firstPersonToggle.checked = !!cfg.firstPerson;
  }
  CAMERA_FIELDS.forEach(({ key, decimals }) => {
    const field = elements.displayFields?.cameraFields?.[key];
    if (!field || !Number.isFinite(cfg[key])) return;
    field.input.value = `${cfg[key]}`;
    field.valueLabel.textContent = cfg[key].toFixed(decimals);
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
  if (elements.profileStatFields && context.appState?.getProfileStats) {
    const stats = context.appState.getProfileStats() || {};
    elements.profileStatFields.forEach(({ node, pick, row }) => {
      const section = pick(stats) || {};
      node.textContent = row.format ? row.format(section) : formatStatValue(section[row.key]);
    });
  }

  const inMultiplayer = !!getMultiplayer();
  if (elements.multiplayerOfflineHint) {
    elements.multiplayerOfflineHint.hidden = inMultiplayer;
  }
  if (elements.reconnectButton) {
    elements.reconnectButton.hidden = !inMultiplayer;
  }
  if (elements.connectionStatus) {
    elements.connectionStatus.textContent = context.appState?.getConnectionStatus?.() ?? 'Offline';
  }
  if (elements.room) {
    elements.room.textContent = describeRoom(context.appState?.getMultiplayerRoom?.());
  }
  if (elements.ping) {
    const ping = context.appState?.getLastPing?.();
    elements.ping.textContent = typeof ping === 'number' ? `${ping} ms` : 'N/A';
  }
  if (elements.playersList) {
    const players = context.appState?.getConnectedPlayers?.() ?? [];
    elements.playersList.innerHTML = '';
    if (!players.length) {
      const empty = createElement('li', 'settings-muted', inMultiplayer ? 'Nobody else here yet.' : 'Not connected.');
      elements.playersList.appendChild(empty);
    } else {
      players.forEach((player) => {
        elements.playersList.appendChild(createElement('li', 'settings-list-item', player.name));
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

// Multiplayer only exists while Multiplayer mode is on, so it's looked up when needed
const getMultiplayer = () => context?.getMultiplayer?.() ?? null;

export function initSettingsPanel({ appState, getMultiplayer, player } = {}) {
  context = { appState, getMultiplayer, player };
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

  // (A tab saved by an older version — Character, Developer — falls back to Profile)
  const storedTab = localStorage.getItem(TAB_KEY);
  setActiveTab(storedTab && elements.tabs[storedTab] ? storedTab : 'profile');

  bindEvents();
  updateUI();
}

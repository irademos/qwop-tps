const STORAGE_TABS = [
  { id: 'home', label: 'Home Storage', action: 'take-out', actionLabel: 'Take Out' },
  { id: 'carried', label: 'Carried Items', action: 'store', actionLabel: 'Store' }
];

let overlay;
let panel;
let context = {};
let activeTab = 'home';
let selectedIds = { home: null, carried: null };
let lastFocusedElement = null;
let elements = {
  tabs: {},
  panels: {},
  grids: {},
  empties: {},
  details: {},
  detailsContainers: {},
  actionButtons: {}
};

function createElement(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text) el.textContent = text;
  return el;
}

function buildHeader() {
  const header = createElement('div', 'settings-header');
  const title = createElement('h2', 'settings-title', 'Home Storage');
  title.id = 'home-storage-title';
  const closeButton = createElement('button', 'settings-close', '✕');
  closeButton.type = 'button';
  closeButton.dataset.action = 'close';
  closeButton.setAttribute('aria-label', 'Close storage');
  header.append(createElement('span'), title, closeButton);
  elements.closeButton = closeButton;
  return header;
}

function buildTabs() {
  const tablist = createElement('div', 'settings-tabs');
  tablist.setAttribute('role', 'tablist');

  STORAGE_TABS.forEach(tab => {
    const button = createElement('button', 'settings-tab', tab.label);
    button.type = 'button';
    button.id = `home-storage-tab-${tab.id}`;
    button.dataset.tab = tab.id;
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-selected', 'false');
    button.setAttribute('aria-controls', `home-storage-panel-${tab.id}`);
    tablist.appendChild(button);
    elements.tabs[tab.id] = button;
  });

  return tablist;
}

function buildPanel(tab) {
  const panelEl = createElement('section', 'settings-tabpanel');
  panelEl.id = `home-storage-panel-${tab.id}`;
  panelEl.dataset.panel = tab.id;
  panelEl.setAttribute('role', 'tabpanel');
  panelEl.setAttribute('aria-labelledby', `home-storage-tab-${tab.id}`);

  const grid = createElement('div', 'inventory-grid');
  const emptyState = createElement('div', 'inventory-empty');
  const details = createElement('div', 'inventory-details');
  const detailsText = createElement('div', 'inventory-details-text', 'Select an item to see details.');
  const actions = createElement('div', 'inventory-actions');
  const actionButton = createElement('button', 'settings-button', tab.actionLabel);
  actionButton.type = 'button';
  actionButton.dataset.storageAction = tab.action;
  actionButton.dataset.storageTab = tab.id;
  actionButton.disabled = true;

  details.append(detailsText, actions);
  actions.append(actionButton);
  panelEl.append(grid, emptyState, details);

  elements.panels[tab.id] = panelEl;
  elements.grids[tab.id] = grid;
  elements.empties[tab.id] = emptyState;
  elements.details[tab.id] = detailsText;
  elements.detailsContainers[tab.id] = details;
  elements.actionButtons[tab.id] = actionButton;

  return panelEl;
}

function buildPanels() {
  const body = createElement('div', 'settings-body');
  STORAGE_TABS.forEach(tab => {
    body.appendChild(buildPanel(tab));
  });
  return body;
}

function setActiveTab(tabId) {
  if (!tabId || !elements.tabs[tabId]) return;
  activeTab = tabId;

  Object.entries(elements.tabs).forEach(([id, button]) => {
    const isActive = id === tabId;
    button.setAttribute('aria-selected', isActive ? 'true' : 'false');
    button.classList.toggle('is-active', isActive);
  });

  Object.entries(elements.panels).forEach(([id, panelEl]) => {
    const isActive = id === tabId;
    panelEl.hidden = !isActive;
  });
}

function getTabData(tabId) {
  if (tabId === 'home') {
    return context.appState?.getHomeStorage?.() || {};
  }
  return context.appState?.getInventory?.() || {};
}

function getFallbackIcon(itemId) {
  if (itemId === 'iceGun') return '❄️';
  if (itemId === 'bow') return '🏹';
  if (itemId === 'autumnSword') return '🗡️';
  if (itemId === 'hammer') return '🔨';
  if (itemId === 'lantern') return '🏮';
  if (itemId === 'shield') return '🛡️';
  if (itemId === 'apple') return '🍎';
  if (itemId === 'wood') return '🪵';
  if (itemId.startsWith('mushroom_')) return '🍄';
  return '🎒';
}

function renderTab(tabId) {
  const grid = elements.grids[tabId];
  const emptyState = elements.empties[tabId];
  const detailsText = elements.details[tabId];
  const detailsContainer = elements.detailsContainers[tabId];
  const actionButton = elements.actionButtons[tabId];
  if (!grid || !emptyState || !detailsText || !detailsContainer || !actionButton) return;

  const data = getTabData(tabId);
  const entries = Object.entries(data).filter(([, item]) => (item?.count || 0) > 0);

  grid.innerHTML = '';
  if (!entries.length) {
    emptyState.style.display = 'block';
    detailsText.textContent = tabId === 'home' ? 'Home storage is empty.' : 'Inventory is empty.';
    detailsContainer.style.display = 'none';
    actionButton.disabled = true;
    selectedIds[tabId] = null;
    return;
  }

  emptyState.style.display = 'none';
  detailsContainer.style.display = 'flex';
  if (!selectedIds[tabId] || !data[selectedIds[tabId]]) {
    selectedIds[tabId] = entries[0][0];
  }

  let selectedTile = null;
  entries.forEach(([itemId, item]) => {
    const button = createElement('button', 'inventory-tile');
    button.type = 'button';
    button.dataset.storageItemId = itemId;
    button.dataset.storageTab = tabId;
    button.setAttribute('aria-selected', itemId === selectedIds[tabId] ? 'true' : 'false');
    button.classList.toggle('is-selected', itemId === selectedIds[tabId]);
    if (itemId === selectedIds[tabId]) {
      selectedTile = button;
    }

    const iconWrapper = createElement('div', 'inventory-icon-wrapper');
    const fallbackIcon = getFallbackIcon(itemId);
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
    if (itemId === 'bazooka') {
      const ammoCount = Number.isFinite(item?.missiles) ? item.missiles : 0;
      const ammoLabel = createElement('span', 'inventory-ammo', `Missiles: ${ammoCount}`);
      button.appendChild(ammoLabel);
    }

    grid.appendChild(button);
  });

  const selectedItem = data[selectedIds[tabId]];
  if (selectedItem) {
    const countText = selectedItem.count ? ` • Qty ${selectedItem.count}` : '';
    const ammoText = selectedIds[tabId] === 'iceGun'
      ? ` • Ice ammo ${Number.isFinite(selectedItem?.['ice ammo']) ? selectedItem['ice ammo'] : 0}`
      : selectedIds[tabId] === 'bow'
        ? ` • Arrows ${Number.isFinite(selectedItem?.['arrow ammo']) ? selectedItem['arrow ammo'] : 0}`
        : selectedIds[tabId] === 'bazooka'
          ? ` • Missiles ${Number.isFinite(selectedItem?.missiles) ? selectedItem.missiles : 0}`
          : '';
    detailsText.textContent = `${selectedItem.name || selectedIds[tabId]}${countText}${ammoText}`;
    actionButton.disabled = false;

    if (selectedTile && selectedTile.parentElement === grid) {
      selectedTile.insertAdjacentElement('afterend', detailsContainer);
    } else {
      grid.appendChild(detailsContainer);
    }
  }
}

function renderAllTabs() {
  STORAGE_TABS.forEach(tab => {
    renderTab(tab.id);
  });
}

function openOverlay() {
  if (!overlay) return;
  lastFocusedElement = document.activeElement;
  overlay.style.display = 'flex';
  overlay.setAttribute('aria-hidden', 'false');
  syncOverlayBodyState();
  panel?.focus?.();
  renderAllTabs();
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
  const isStorageOpen = overlay?.getAttribute('aria-hidden') === 'false';
  const isSettingsOpen = document.getElementById('settings-overlay')?.getAttribute('aria-hidden') === 'false';
  const isInventoryOpen = document.getElementById('inventory-overlay')?.getAttribute('aria-hidden') === 'false';
  document.body.classList.toggle('settings-open', isStorageOpen || isSettingsOpen || isInventoryOpen);
}

function handleActionClick(action, tabId) {
  if (!tabId) return;
  const selectedId = selectedIds[tabId];
  if (!selectedId) return;
  if (action === 'store') {
    context.appState?.storeHomeStorageItem?.(selectedId);
  } else if (action === 'take-out') {
    context.appState?.takeOutHomeStorageItem?.(selectedId);
  }
  renderAllTabs();
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
    if (button.dataset.action === 'close') {
      closeOverlay();
      return;
    }
    if (button.dataset.tab) {
      setActiveTab(button.dataset.tab);
      return;
    }
    if (button.dataset.storageItemId) {
      const tabId = button.dataset.storageTab;
      selectedIds[tabId] = button.dataset.storageItemId;
      renderTab(tabId);
      return;
    }
    if (button.dataset.storageAction) {
      handleActionClick(button.dataset.storageAction, button.dataset.storageTab);
    }
  });
}

export function initHomeStoragePanel({ appState } = {}) {
  context = { appState };
  overlay = document.getElementById('home-storage-overlay');
  panel = document.getElementById('home-storage-panel');
  if (!overlay || !panel) {
    throw new Error('Home storage overlay not found.');
  }
  overlay.setAttribute('aria-hidden', 'true');
  syncOverlayBodyState();
  panel.innerHTML = '';
  panel.classList.add('settings-shell');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-labelledby', 'home-storage-title');
  panel.tabIndex = -1;

  const header = buildHeader();
  const tabs = buildTabs();
  const body = buildPanels();
  panel.append(header, tabs, body);

  setActiveTab(activeTab);
  bindEvents();
  renderAllTabs();
}

export function openHomeStorage() {
  openOverlay();
}

export function closeHomeStorage() {
  closeOverlay();
}

export function updateUI() {
  renderAllTabs();
}

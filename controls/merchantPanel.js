import { buyMerchantItem, getMerchantInventory, getMerchantItemMeta, sellMerchantItem } from '../characters/merchant.js';

const MERCHANT_TABS = [
  { id: 'buy', label: 'Buy Items', action: 'buy', actionLabel: 'Buy' },
  { id: 'sell', label: 'Sell Items', action: 'sell', actionLabel: 'Sell' }
];

let overlay;
let panel;
let context = {};
let activeTab = 'buy';
let selectedIds = { buy: null, sell: null };
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
  const title = createElement('h2', 'settings-title', 'Merchant');
  title.id = 'merchant-title';
  const closeButton = createElement('button', 'settings-close', '✕');
  closeButton.type = 'button';
  closeButton.dataset.action = 'close';
  closeButton.setAttribute('aria-label', 'Close merchant');
  header.append(createElement('span'), title, closeButton);
  elements.closeButton = closeButton;
  return header;
}

function buildTabs() {
  const tablist = createElement('div', 'settings-tabs');
  tablist.setAttribute('role', 'tablist');

  MERCHANT_TABS.forEach(tab => {
    const button = createElement('button', 'settings-tab', tab.label);
    button.type = 'button';
    button.id = `merchant-tab-${tab.id}`;
    button.dataset.tab = tab.id;
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-selected', 'false');
    button.setAttribute('aria-controls', `merchant-panel-${tab.id}`);
    tablist.appendChild(button);
    elements.tabs[tab.id] = button;
  });

  return tablist;
}

function buildPanel(tab) {
  const panelEl = createElement('section', 'settings-tabpanel');
  panelEl.id = `merchant-panel-${tab.id}`;
  panelEl.dataset.panel = tab.id;
  panelEl.setAttribute('role', 'tabpanel');
  panelEl.setAttribute('aria-labelledby', `merchant-tab-${tab.id}`);

  const grid = createElement('div', 'inventory-grid');
  const emptyState = createElement('div', 'inventory-empty');
  const details = createElement('div', 'inventory-details');
  const detailsText = createElement('div', 'inventory-details-text', 'Select an item to see details.');
  const actions = createElement('div', 'inventory-actions');
  const actionButton = createElement('button', 'settings-button', tab.actionLabel);
  actionButton.type = 'button';
  actionButton.dataset.merchantAction = tab.action;
  actionButton.dataset.merchantTab = tab.id;
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
  MERCHANT_TABS.forEach(tab => {
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
  if (tabId === 'buy') {
    return getMerchantInventory() || {};
  }
  return context.appState?.getInventory?.() || {};
}

function getFallbackIcon(itemId) {
  if (itemId === 'iceGun') return '❄️';
  if (itemId === 'ice ammo') return '❄️';
  if (itemId === 'bow') return '🏹';
  if (itemId === 'arrow ammo') return '🏹';
  if (itemId === 'autumnSword') return '🗡️';
  if (itemId === 'lantern') return '🏮';
  if (itemId === 'shield') return '🛡️';
  if (itemId === 'apple') return '🍎';
  if (itemId === 'wood') return '🪵';
  if (itemId.startsWith('mushroom_')) return '🍄';
  return '🎒';
}

function getItemDisplay(itemId, item, tabId) {
  const meta = getMerchantItemMeta(itemId);
  const name = item?.name || meta.name || itemId;
  const count = tabId === 'buy' ? (item?.count || 0) : (item?.count || 0);
  const price = meta.price || 0;
  return { name, count, price };
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
    detailsText.textContent = tabId === 'buy' ? 'The merchant is sold out.' : 'Inventory is empty.';
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
    button.dataset.merchantItemId = itemId;
    button.dataset.merchantTab = tabId;
    button.setAttribute('aria-selected', itemId === selectedIds[tabId] ? 'true' : 'false');
    button.classList.toggle('is-selected', itemId === selectedIds[tabId]);
    if (itemId === selectedIds[tabId]) {
      selectedTile = button;
    }

    const iconWrapper = createElement('div', 'inventory-icon-wrapper');
    const fallbackIcon = getFallbackIcon(itemId);
    const itemMeta = getMerchantItemMeta(itemId);
    const itemIcon = item?.icon || itemMeta?.icon || '';
    if (itemIcon) {
      const img = document.createElement('img');
      img.className = 'inventory-icon';
      img.alt = item?.name || itemMeta?.name || itemId;
      img.loading = 'lazy';
      img.src = itemIcon;
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

    const display = getItemDisplay(itemId, item, tabId);
    if (display.count && display.count > 1) {
      const badge = createElement('span', 'inventory-badge', `${display.count}`);
      button.appendChild(badge);
    }
    const priceLabel = createElement('span', 'inventory-price', `${display.price}c`);
    button.appendChild(priceLabel);

    grid.appendChild(button);
  });

  const selectedItem = data[selectedIds[tabId]];
  if (selectedItem) {
    const display = getItemDisplay(selectedIds[tabId], selectedItem, tabId);
    const countText = display.count ? ` • Qty ${display.count}` : '';
    const priceText = ` • Price ${display.price} coins`;
    detailsText.textContent = `${display.name}${countText}${priceText}`;
    actionButton.disabled = false;

    if (selectedTile && selectedTile.parentElement === grid) {
      selectedTile.insertAdjacentElement('afterend', detailsContainer);
    } else {
      grid.appendChild(detailsContainer);
    }
  }
}

function renderAllTabs() {
  MERCHANT_TABS.forEach(tab => {
    renderTab(tab.id);
  });
}

function openOverlay() {
  if (!overlay) return;
  lastFocusedElement = document.activeElement;
  overlay.style.display = 'flex';
  overlay.setAttribute('aria-hidden', 'false');
  panel?.focus?.();
  renderAllTabs();
}

function closeOverlay() {
  if (!overlay) return;
  overlay.style.display = 'none';
  overlay.setAttribute('aria-hidden', 'true');
  if (lastFocusedElement && typeof lastFocusedElement.focus === 'function') {
    lastFocusedElement.focus();
  }
}

async function handleActionClick(action, tabId) {
  if (!tabId) return;
  const selectedId = selectedIds[tabId];
  if (!selectedId) return;
  if (action === 'buy') {
    await buyMerchantItem(selectedId);
  } else if (action === 'sell') {
    await sellMerchantItem(selectedId);
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
    if (button.dataset.merchantItemId) {
      const tabId = button.dataset.merchantTab;
      selectedIds[tabId] = button.dataset.merchantItemId;
      renderTab(tabId);
      return;
    }
    if (button.dataset.merchantAction) {
      void handleActionClick(button.dataset.merchantAction, button.dataset.merchantTab);
    }
  });
}

export function initMerchantPanel({ appState } = {}) {
  context = { appState };
  overlay = document.getElementById('merchant-overlay');
  panel = document.getElementById('merchant-panel');
  if (!overlay || !panel) {
    throw new Error('Merchant overlay not found.');
  }
  overlay.setAttribute('aria-hidden', 'true');
  panel.innerHTML = '';
  panel.classList.add('settings-shell');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-labelledby', 'merchant-title');
  panel.tabIndex = -1;

  const header = buildHeader();
  const tabs = buildTabs();
  const body = buildPanels();
  panel.append(header, tabs, body);

  setActiveTab(activeTab);
  bindEvents();
  renderAllTabs();
}

export function openMerchantPanel(tabId = 'buy') {
  setActiveTab(tabId);
  openOverlay();
}

export function closeMerchantPanel() {
  closeOverlay();
}

export function updateMerchantUI() {
  renderAllTabs();
}

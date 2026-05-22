import { getMerchantItemMeta } from '../characters/merchant.js';

let overlay;
let panel;
let selectedItemId = null;

const createElement = (tag, cls, txt = '') => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (txt) el.textContent = txt;
  return el;
};

const getManager = () => window.friendlyNpcManager;

function getLlamaInventory() {
  return getManager()?.getLlamaInventory?.(getManager()?.getLlamaFriendly?.()) || {};
}

function getFallbackIcon(itemId) {
  if (itemId === 'iceGun') return '❄️';
  if (itemId === 'ice ammo') return '❄️';
  if (itemId === 'bow') return '🏹';
  if (itemId === 'arrow ammo') return '🏹';
  if (itemId === 'bazooka' || itemId === 'missiles') return '🚀';
  if (itemId === 'autumnSword') return '🗡️';
  if (itemId === 'hammer') return '🔨';
  if (itemId === 'lantern') return '🏮';
  if (itemId === 'shield') return '🛡️';
  if (itemId === 'apple') return '🍎';
  if (itemId === 'wood') return '🪵';
  if (itemId === 'meat' || itemId === 'crab_meat') return '🦀';
  if (itemId === 'Salt') return '🪨';
  if (itemId === 'zombie_brains') return '🧠';
  if (itemId.startsWith('mushroom_')) return '🍄';
  return '🎒';
}

async function sellToLlama(itemId) {
  const app = window.appState;
  const inv = app?.getInventory?.() || {};
  const entry = inv[itemId];
  if (!entry?.count) return false;
  const price = Math.max(1, Math.floor((getMerchantItemMeta(itemId).price || 2) / 2));
  const coins = getManager()?.getLlamaCoins?.() || 0;
  if (coins < price) return false;
  app?.removeFromInventory?.(itemId, 1);
  getManager()?.adjustLlamaCoins?.(-price);
  const llama = getManager()?.getLlamaFriendly?.();
  if (llama?.model?.userData) {
    llama.model.userData.llamaInventory = {
      ...getLlamaInventory(),
      [itemId]: { count: ((getLlamaInventory()[itemId]?.count) || 0) + 1, type: '' }
    };
  }
  getManager()?.pushLlamaDialogueHistory?.({ type: 'trade', text: `Player sold ${itemId} for ${price} coins.` });
  return true;
}

function render() {
  panel.innerHTML = '';

  const header = createElement('div', 'settings-header');
  const title = createElement('h2', 'settings-title', `Llama Trade (${getManager()?.getLlamaCoins?.() || 0} coins)`);
  const closeButton = createElement('button', 'settings-close', '✕');
  closeButton.type = 'button';
  closeButton.setAttribute('aria-label', 'Close llama trade');
  closeButton.onclick = () => {
    overlay.style.display = 'none';
    overlay.setAttribute('aria-hidden', 'true');
  };
  header.append(createElement('span'), title, closeButton);

  const body = createElement('div', 'settings-body');
  const inventoryGrid = createElement('div', 'inventory-grid');
  const emptyState = createElement('div', 'inventory-empty', 'Llama inventory is empty.');
  const details = createElement('div', 'inventory-details');
  const detailsText = createElement('div', 'inventory-details-text', 'Select an item to see details.');

  const inv = getLlamaInventory();
  const entries = Object.entries(inv).filter(([, entry]) => (entry?.count || 0) > 0);

  if (!selectedItemId || !inv[selectedItemId]) {
    selectedItemId = entries[0]?.[0] || null;
  }

  let selectedTile = null;
  entries.forEach(([itemId, entry]) => {
    const button = createElement('button', 'inventory-tile');
    button.type = 'button';
    button.setAttribute('aria-selected', itemId === selectedItemId ? 'true' : 'false');
    button.classList.toggle('is-selected', itemId === selectedItemId);
    button.onclick = () => {
      selectedItemId = itemId;
      render();
    };

    if (itemId === selectedItemId) selectedTile = button;

    const iconWrapper = createElement('div', 'inventory-icon-wrapper');
    const fallbackIcon = getFallbackIcon(itemId);
    const itemMeta = getMerchantItemMeta(itemId);
    const itemIcon = entry?.icon || itemMeta?.icon || '';
    if (itemIcon) {
      const img = document.createElement('img');
      img.className = 'inventory-icon';
      img.alt = entry?.name || itemMeta?.name || itemId;
      img.loading = 'lazy';
      img.src = itemIcon;
      img.addEventListener('error', () => {
        img.remove();
        iconWrapper.appendChild(createElement('div', 'inventory-icon-fallback', fallbackIcon));
      }, { once: true });
      iconWrapper.appendChild(img);
    } else {
      iconWrapper.appendChild(createElement('div', 'inventory-icon-fallback', fallbackIcon));
    }

    button.appendChild(iconWrapper);

    if (entry.count > 1) {
      button.appendChild(createElement('span', 'inventory-badge', `${entry.count}`));
    }

    inventoryGrid.appendChild(button);
  });

  if (!entries.length) {
    inventoryGrid.appendChild(emptyState);
  } else {
    const selected = inv[selectedItemId];
    detailsText.textContent = `${selected?.name || selectedItemId} • Qty ${selected?.count || 0}`;
    details.append(detailsText);
    if (selectedTile && selectedTile.parentElement === inventoryGrid) {
      selectedTile.insertAdjacentElement('afterend', details);
    } else {
      inventoryGrid.appendChild(details);
    }
  }

  const sellContainer = createElement('div', 'inventory-actions');
  const pInv = window.appState?.getInventory?.() || {};
  Object.entries(pInv)
    .filter(([, entry]) => (entry?.count || 0) > 0)
    .slice(0, 20)
    .forEach(([itemId, entry]) => {
      const btn = createElement('button', 'settings-button', `Sell ${entry?.name || itemId} (${entry.count})`);
      btn.type = 'button';
      btn.onclick = async () => {
        await sellToLlama(itemId);
        render();
      };
      sellContainer.appendChild(btn);
    });

  body.append(inventoryGrid, sellContainer);
  panel.append(header, body);
}

export function openLlamaTradePanel() {
  overlay = document.getElementById('merchant-overlay');
  panel = document.getElementById('merchant-panel');
  if (!overlay || !panel) return;
  overlay.style.display = 'flex';
  overlay.setAttribute('aria-hidden', 'false');
  render();
}

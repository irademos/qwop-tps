export const CRAFT_RECIPES = [
  { id: 'torch', label: 'Torch', materials: { wood: 1 } },
  { id: 'arrow', label: 'Arrow', materials: { wood: 1 } },
  { id: 'bow', label: 'Bow', materials: { wood: 9, mushrooms: 4 } },
  { id: 'lantern', label: 'Lantern', materials: { wood: 9, apples: 4 } },
  { id: 'bed', label: 'Bed', materials: { wood: 12, mushrooms: 8 } },
  { id: 'home-storage', label: 'Home Storage', materials: { wood: 12 } },
  { id: 'mana_potion', label: 'Magic potion', materials: { zombie_brains: 4 } }
];

const MATERIAL_FILTERS = {
  apple: (itemId) => itemId === 'apple',
  wood: (itemId) => itemId === 'wood',
  mushroom: (itemId) => itemId.startsWith('mushroom_'),
  zombieBrains: (itemId) => itemId === 'zombie_brains'
};

let overlay;
let panel;
let dialogue;
let dialogueText;
let dialogueOptions;
let messageEl;
let context = {};
let view = 'menu';
let lastFocusedElement = null;
let inventoryItems = [];
let inventoryCounts = {};
let selectedMaterials = {};
let craftInventoryScrollTop = 0;

const createElement = (tag, className, text) => {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text) el.textContent = text;
  return el;
};

const getMaterialItems = (inventory = {}) => Object.entries(inventory)
  .filter(([itemId]) => MATERIAL_FILTERS.apple(itemId) || MATERIAL_FILTERS.wood(itemId) || MATERIAL_FILTERS.mushroom(itemId) || MATERIAL_FILTERS.zombieBrains(itemId))
  .map(([itemId, entry]) => ({
    id: itemId,
    name: entry?.name || itemId,
    icon: entry?.icon || '',
    count: Number.isFinite(entry?.count) ? entry.count : 0
  }));

const getSelectedTotal = () => Object.values(selectedMaterials).reduce((sum, count) => sum + count, 0);

const resetSelection = ({ restoreInventory } = {}) => {
  if (restoreInventory) {
    Object.entries(selectedMaterials).forEach(([itemId, count]) => {
      if (count > 0) {
        context.appState?.addToInventory?.(itemId, count);
      }
    });
  }
  selectedMaterials = {};
  inventoryItems = [];
  inventoryCounts = {};
};

const updateInventoryState = () => {
  const inventory = context.appState?.getInventory?.() || {};
  inventoryItems = getMaterialItems(inventory);
  inventoryCounts = inventoryItems.reduce((acc, item) => {
    acc[item.id] = item.count;
    return acc;
  }, {});
  selectedMaterials = {};
};

const buildHeader = (titleText) => {
  const header = createElement('div', 'settings-header');
  const title = createElement('h2', 'settings-title', titleText);
  title.id = 'craft-title';
  const closeButton = createElement('button', 'settings-close', '✕');
  closeButton.type = 'button';
  closeButton.dataset.action = 'close';
  closeButton.setAttribute('aria-label', 'Close crafting');
  header.append(createElement('span'), title, closeButton);
  return header;
};

const buildMenu = () => {
  const body = createElement('div', 'settings-body');
  const menu = createElement('div', 'craft-menu');
  const recipesBtn = createElement('button', 'settings-button', 'View crafting recipes');
  recipesBtn.type = 'button';
  recipesBtn.dataset.action = 'view-recipes';
  const materialsBtn = createElement('button', 'settings-button', 'Select materials for crafting');
  materialsBtn.type = 'button';
  materialsBtn.dataset.action = 'select-materials';
  menu.append(recipesBtn, materialsBtn);
  body.append(menu);
  return body;
};

const buildRecipes = () => {
  const body = createElement('div', 'settings-body');
  const list = createElement('div', 'craft-recipes');
  CRAFT_RECIPES.forEach((recipe) => {
    const card = createElement('div', 'craft-recipe');
    const title = createElement('div', 'craft-recipe-title', recipe.label);
    const materials = Object.entries(recipe.materials).map(([key, qty]) => {
      const label = key === 'mushrooms'
        ? 'Mushrooms'
        : key === 'apples'
          ? 'Apples'
          : key === 'wood'
            ? 'Wood'
            : key === 'zombie_brains'
              ? 'Zombie Brains'
              : key;
      return `${qty} x ${label}`;
    }).join(', ');
    const detail = createElement('div', 'craft-recipe-detail', materials);
    card.append(title, detail);
    list.append(card);
  });
  body.append(list);
  return body;
};

const buildSelectedMaterials = () => {
  const container = createElement('div', 'craft-selected');
  const title = createElement('div', 'craft-selected-title', 'Selected Materials');
  const list = createElement('div', 'craft-selected-list');
  const entries = Object.entries(selectedMaterials).filter(([, count]) => count > 0);
  if (!entries.length) {
    list.append(createElement('div', 'craft-selected-empty', 'None selected yet.'));
  } else {
    entries.forEach(([itemId, count]) => {
      const item = inventoryItems.find(entry => entry.id === itemId);
      const name = item?.name || itemId;
      list.append(createElement('div', 'craft-selected-item', `${name} Qty. ${count}`));
    });
  }
  container.append(title, list);
  return container;
};

const buildMaterials = () => {
  const body = createElement('div', 'settings-body craft-materials-body');
  const grid = createElement('div', 'craft-inventory');

  inventoryItems.forEach((item) => {
    const row = createElement('div', 'craft-inventory-item');
    const info = createElement('div', 'craft-item-info');
    const iconWrapper = createElement('div', 'inventory-icon-wrapper');
    if (item.icon) {
      const img = document.createElement('img');
      img.className = 'inventory-icon';
      img.alt = item.name || item.id;
      img.loading = 'lazy';
      img.src = item.icon;
      img.addEventListener('error', () => {
        img.remove();
        const fallback = createElement('div', 'inventory-icon-fallback', '🎒');
        iconWrapper.appendChild(fallback);
      }, { once: true });
      iconWrapper.appendChild(img);
    } else {
      const fallback = createElement('div', 'inventory-icon-fallback', '🎒');
      iconWrapper.appendChild(fallback);
    }
    const text = createElement('div', 'craft-item-text');
    const name = createElement('div', 'craft-item-name', item.name || item.id);
    const qty = createElement('div', 'craft-item-qty', `Qty. ${inventoryCounts[item.id] ?? 0}`);
    text.append(name, qty);
    info.append(iconWrapper, text);

    const actions = createElement('div', 'craft-item-actions');
    const minusBtn = createElement('button', 'craft-adjust', '−');
    minusBtn.type = 'button';
    minusBtn.dataset.action = 'remove';
    minusBtn.dataset.itemId = item.id;
    const plusBtn = createElement('button', 'craft-adjust', '+');
    plusBtn.type = 'button';
    plusBtn.dataset.action = 'add';
    plusBtn.dataset.itemId = item.id;
    plusBtn.disabled = (inventoryCounts[item.id] ?? 0) <= 0;
    minusBtn.disabled = (selectedMaterials[item.id] ?? 0) <= 0;
    actions.append(minusBtn, plusBtn);

    row.append(info, actions);
    grid.append(row);
  });

  const selected = buildSelectedMaterials();
  const actions = createElement('div', 'craft-actions');
  const craftButton = createElement('button', 'settings-button', 'Craft');
  craftButton.type = 'button';
  craftButton.dataset.action = 'craft';
  craftButton.disabled = getSelectedTotal() === 0;
  actions.append(craftButton);
  body.append(grid, selected, actions);
  return body;
};

const closeCraftOptions = () => {
  dialogue?.classList.add('hidden');
  if (dialogueOptions) {
    dialogueOptions.innerHTML = '';
  }
};

const render = () => {
  if (!panel) return;
  if (view === 'select') {
    const scrollContainer = panel.querySelector('.craft-inventory');
    craftInventoryScrollTop = scrollContainer ? scrollContainer.scrollTop : 0;
  }
  panel.innerHTML = '';
  const title = view === 'recipes'
    ? 'Crafting Recipes'
    : view === 'select'
      ? 'Select Materials'
      : 'Crafting';
  panel.append(buildHeader(title));
  if (view === 'recipes') {
    panel.append(buildRecipes());
    return;
  }
  if (view === 'select') {
    panel.append(buildMaterials());
    const scrollContainer = panel.querySelector('.craft-inventory');
    if (scrollContainer) {
      scrollContainer.scrollTop = craftInventoryScrollTop;
    }
    return;
  }
  panel.append(buildMenu());
};

const openOverlay = () => {
  if (!overlay) return;
  lastFocusedElement = document.activeElement;
  overlay.style.display = 'flex';
  overlay.setAttribute('aria-hidden', 'false');
  panel?.focus?.();
  closeCraftOptions();
  view = 'menu';
  updateInventoryState();
  render();
};

const closeOverlay = () => {
  if (!overlay) return;
  overlay.style.display = 'none';
  overlay.setAttribute('aria-hidden', 'true');
  if (getSelectedTotal() > 0) {
    resetSelection({ restoreInventory: true });
  }
  if (lastFocusedElement && typeof lastFocusedElement.focus === 'function') {
    lastFocusedElement.focus();
  }
};

const showCraftMessage = (message) => {
  if (!messageEl) return;
  messageEl.textContent = message;
  messageEl.classList.add('visible');
  clearTimeout(messageEl._craftTimer);
  messageEl._craftTimer = setTimeout(() => {
    messageEl.classList.remove('visible');
  }, 2000);
};

const openCraftOptions = (craftable) => {
  if (!dialogue || !dialogueText || !dialogueOptions) return;
  dialogueText.textContent = craftable.length
    ? 'Choose something to craft.'
    : 'No recipes match these materials.';
  dialogueOptions.innerHTML = '';
  craftable.forEach((recipe) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = recipe.label;
    button.dataset.craftChoice = recipe.id;
    dialogueOptions.appendChild(button);
  });
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.textContent = 'Nevermind, collect materials';
  cancel.dataset.craftChoice = 'nevermind';
  dialogueOptions.appendChild(cancel);
  dialogue.classList.remove('hidden');
};

const computeCraftable = () => {
  const counts = {
    wood: 0,
    apples: 0,
    mushrooms: 0
  };
  Object.entries(selectedMaterials).forEach(([itemId, count]) => {
    if (MATERIAL_FILTERS.wood(itemId)) counts.wood += count;
    if (MATERIAL_FILTERS.apple(itemId)) counts.apples += count;
    if (MATERIAL_FILTERS.mushroom(itemId)) counts.mushrooms += count;
  });
  return CRAFT_RECIPES.filter((recipe) => Object.entries(recipe.materials).every(([key, amount]) => {
    return counts[key] >= amount;
  }));
};

const startCraftingFlow = () => {
  if (getSelectedTotal() === 0) return;
  const selection = { ...selectedMaterials };
  const craftable = computeCraftable();
  resetSelection({ restoreInventory: false });
  closeOverlay();
  window.craftTableActions?.placeMaterials?.(selection);
  openCraftOptions(craftable);
};

const adjustMaterial = (itemId, delta) => {
  if (!itemId) return;
  const current = inventoryCounts[itemId] ?? 0;
  if (delta > 0 && current <= 0) return;
  if (delta < 0 && (selectedMaterials[itemId] ?? 0) <= 0) return;
  inventoryCounts[itemId] = current - delta;
  selectedMaterials[itemId] = (selectedMaterials[itemId] ?? 0) + delta;
  if (selectedMaterials[itemId] < 0) selectedMaterials[itemId] = 0;
  if (delta > 0) {
    context.appState?.removeFromInventory?.(itemId, 1);
  } else {
    context.appState?.addToInventory?.(itemId, 1);
  }
  render();
};

const handleCraftChoice = (choice) => {
  if (!choice) return;
  if (choice === 'nevermind') {
    window.craftTableActions?.cancelCrafting?.({ restoreInventory: true });
    closeCraftOptions();
    return;
  }
  if (choice === 'bed' || choice === 'home-storage') {
    window.craftTableActions?.cancelCrafting?.({ restoreInventory: true });
    closeCraftOptions();
    showCraftMessage('You already have this item!');
    return;
  }
  window.craftTableActions?.craftItem?.(choice);
  closeCraftOptions();
};

const bindEvents = () => {
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) {
      closeOverlay();
    }
  });

  panel.addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button) return;
    const { action } = button.dataset;
    if (action === 'close') {
      closeOverlay();
      return;
    }
    if (action === 'view-recipes') {
      view = 'recipes';
      render();
      return;
    }
    if (action === 'select-materials') {
      view = 'select';
      render();
      return;
    }
    if (action === 'craft') {
      startCraftingFlow();
      return;
    }
    if (action === 'add' || action === 'remove') {
      const delta = action === 'add' ? 1 : -1;
      adjustMaterial(button.dataset.itemId, delta);
    }
  });

  if (dialogueOptions) {
    dialogueOptions.addEventListener('click', (event) => {
      const button = event.target.closest('button');
      if (!button) return;
      handleCraftChoice(button.dataset.craftChoice);
    });
  }
};

export function initCraftPanel({ appState } = {}) {
  context = { appState };
  overlay = document.getElementById('craft-overlay');
  panel = document.getElementById('craft-panel');
  dialogue = document.getElementById('craft-dialogue');
  dialogueText = dialogue?.querySelector('.friendly-dialogue-text') || null;
  dialogueOptions = dialogue?.querySelector('.friendly-dialogue-options') || null;
  messageEl = document.getElementById('craft-message');

  if (!overlay || !panel) {
    throw new Error('Craft overlay not found.');
  }

  overlay.setAttribute('aria-hidden', 'true');
  panel.innerHTML = '';
  panel.classList.add('settings-shell', 'craft-shell');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-labelledby', 'craft-title');
  panel.tabIndex = -1;

  bindEvents();
  render();
}

export function openCraftPanel() {
  openOverlay();
}

export function closeCraftPanel() {
  closeOverlay();
}

export function updateUI() {
  if (overlay?.getAttribute('aria-hidden') === 'false') {
    if (view === 'select') {
      const inventory = context.appState?.getInventory?.() || {};
      inventoryItems.forEach((item) => {
        const entry = inventory[item.id];
        inventoryCounts[item.id] = Number.isFinite(entry?.count) ? entry.count : 0;
      });
      render();
    }
  }
}

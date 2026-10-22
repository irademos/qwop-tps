// Town mode: the chest in the player's home — move coins and goods between it and the wallet /
// bag (both have a limit: WALLET_MAX / BAG_MAX). Pure DOM, in the market panel's look;
// townHomes.js builds the model and handles the clicks.
//
// open(model) / render(model) / close() / isOpen()
// model: {
//   title, wallet, walletMax, bag, bagMax, stored (coins in the chest),
//   goods: [{ id, emoji, label, have, stored }],
// }
// handlers: onMove(id ('coins' | a good), n (> 0 into the chest, < 0 out of it)), onClose()

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
};

const COIN_STEP = 10;

export function createStoragePanel(parent, handlers) {
  let open = false;
  const panel = el('div', 'town-market ui-panel hidden');
  panel.addEventListener('pointerdown', (e) => e.stopPropagation());
  parent.append(panel);

  const button = (label, primary, enabled, onClick) => {
    const b = el('button', `${primary ? 'ui-btn' : 'ui-btn-secondary'} town-market-btn`, label);
    b.type = 'button';
    b.disabled = !enabled;
    b.addEventListener('click', () => { if (open && !b.disabled) onClick(); });
    return b;
  };
  const row = (emoji, label, info, buttons) => {
    const r = el('div', 'town-market-row');
    const name = el('div', 'town-market-name');
    name.append(el('span', 'town-market-emoji', emoji), el('span', null, label));
    const left = el('div', 'town-market-left');
    left.append(name, el('div', 'town-market-info', info));
    const right = el('div', 'town-storage-btns');
    right.append(...buttons);
    r.append(left, right);
    return r;
  };

  const render = (model) => {
    if (!open || !model) return;
    const head = el('div', 'town-market-head');
    head.append(el('div', 'town-market-title', model.title));
    const close = button('✕', false, true, () => handlers.onClose());
    close.classList.add('town-market-close');
    close.setAttribute('aria-label', 'Close');
    head.append(close);
    const purse = el('div', 'town-market-purse', `👛 ${model.wallet} / ${model.walletMax} 🪙 · 🎒 ${model.bag} / ${model.bagMax}`);
    const walletRoom = model.walletMax - model.wallet;
    const bagRoom = model.bagMax - model.bag;

    const list = el('div', 'town-market-list');
    list.append(row('🪙', 'Coins', `in the chest: ${model.stored}`, [
      button(`Store ${COIN_STEP}`, true, model.wallet > 0, () => handlers.onMove('coins', COIN_STEP)),
      button(`Take ${COIN_STEP}`, false, model.stored > 0 && walletRoom > 0, () => handlers.onMove('coins', -COIN_STEP)),
    ]));
    for (const g of model.goods) {
      list.append(row(g.emoji, g.label, `carrying ${g.have} · in the chest: ${g.stored}`, [
        button('Store', true, g.have > 0, () => handlers.onMove(g.id, 1)),
        button('Take', false, g.stored > 0 && bagRoom > 0, () => handlers.onMove(g.id, -1)),
      ]));
    }
    panel.replaceChildren(head, purse, el('div', 'town-market-subtitle', 'Your chest'), list);
  };

  return {
    open: (model) => {
      open = true;
      panel.classList.remove('hidden');
      document.body.classList.add('town-market-open');
      render(model);
    },
    render,
    close: () => {
      if (!open) return;
      open = false;
      panel.classList.add('hidden');
      document.body.classList.remove('town-market-open');
    },
    isOpen: () => open,
  };
}

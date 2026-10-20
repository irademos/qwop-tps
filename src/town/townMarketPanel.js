// Town mode: the market stall's panel — buy / sell goods at the market's prices, buy gear.
// Pure DOM; townMode.js builds the model and handles the clicks.
//
// open(model) / render(model) / close() / isOpen()
// model: {
//   title, coins, cash (the merchant's money), note,
//   goods: [{ id, emoji, label, stock, have, buy, sell, canBuy, canSell }],
//   gear:  [{ id, emoji, label, price, desc, owned, canBuy, note }],
// }
// handlers: onBuyGood(id), onSellGood(id), onBuyGear(id), onClose()

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
};

export function createMarketPanel(parent, handlers) {
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

  const render = (model) => {
    if (!open || !model) return;
    const head = el('div', 'town-market-head');
    head.append(el('div', 'town-market-title', model.title));
    const close = button('✕', false, true, () => handlers.onClose());
    close.classList.add('town-market-close');
    close.setAttribute('aria-label', 'Close');
    head.append(close);
    const purse = el('div', 'town-market-purse', `🪙 ${model.coins} · the merchant has 🪙 ${model.cash}`);

    const goodsTitle = el('div', 'town-market-subtitle', 'Goods');
    const goods = el('div', 'town-market-list');
    for (const g of model.goods) {
      const row = el('div', 'town-market-row');
      const name = el('div', 'town-market-name');
      name.append(el('span', 'town-market-emoji', g.emoji), el('span', null, g.label));
      const info = el('div', 'town-market-info', `${g.stock} in stock · you have ${g.have}`);
      const left = el('div', 'town-market-left');
      left.append(name, info);
      row.append(
        left,
        button(`Buy ${g.buy}🪙`, true, g.canBuy, () => handlers.onBuyGood(g.id)),
        button(`Sell ${g.sell}🪙`, false, g.canSell, () => handlers.onSellGood(g.id)),
      );
      goods.append(row);
    }

    const gearTitle = el('div', 'town-market-subtitle', 'Gear');
    const gear = el('div', 'town-market-list');
    for (const item of model.gear) {
      const row = el('div', 'town-market-row');
      const name = el('div', 'town-market-name');
      name.append(el('span', 'town-market-emoji', item.emoji), el('span', null, item.label));
      const left = el('div', 'town-market-left');
      left.append(name);
      if (item.note || item.desc) left.append(el('div', 'town-market-info', item.note || item.desc));
      row.append(left, button(item.owned ? 'Owned' : `${item.price}🪙`, true, item.canBuy, () => handlers.onBuyGear(item.id)));
      gear.append(row);
    }

    const parts = [head, purse];
    if (model.note) parts.push(el('div', 'town-market-note', model.note));
    parts.push(goodsTitle, goods, gearTitle, gear);
    panel.replaceChildren(...parts);
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

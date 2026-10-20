// Town mode: the market's sell panel — sell goods to the merchant at the market's prices.
// (Buying is done on the stalls' counters — townStalls.js.) Pure DOM; townMode.js builds the
// model and handles the clicks.
//
// open(model) / render(model) / close() / isOpen()
// model: {
//   title, coins, cash (the merchant's money), note,
//   goods: [{ id, emoji, label, stock, have, sell, canSell }],
// }
// handlers: onSellGood(id), onClose()

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

    const goodsTitle = el('div', 'town-market-subtitle', 'Your goods');
    const goods = el('div', 'town-market-list');
    for (const g of model.goods) {
      const row = el('div', 'town-market-row');
      const name = el('div', 'town-market-name');
      name.append(el('span', 'town-market-emoji', g.emoji), el('span', null, g.label));
      const info = el('div', 'town-market-info', `${g.stock} in stock · you have ${g.have}`);
      const left = el('div', 'town-market-left');
      left.append(name, info);
      row.append(left, button(`Sell ${g.sell}🪙`, true, g.canSell, () => handlers.onSellGood(g.id)));
      goods.append(row);
    }

    const parts = [head, purse];
    if (model.note) parts.push(el('div', 'town-market-note', model.note));
    parts.push(goodsTitle, goods);
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

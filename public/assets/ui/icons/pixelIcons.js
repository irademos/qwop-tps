// Pixel icons in place of emoji — one sheet (pixel-icons.png: 16 × 22 cells of 32 px), shared by
// the game (index.html) and the phone controller (phone-sword.html) as a plain script.
//
// Every emoji in ICONS shown anywhere in the page's DOM is drawn as its icon: a MutationObserver
// wraps each one in a <px-icon> whose text stays the emoji (transparent), so textContent — and code
// comparing it — is unchanged. Canvas text (3D signs / markers) goes through
// window.pixelIcons.drawText / measureText (makeTextSprite in src/village/villageMode.js).
// An emoji not in ICONS stays an emoji. To add one: its cell [row, column] in the sheet below.
(() => {
  const SHEET_URL = '/assets/ui/icons/pixel-icons.png';
  const COLS = 16;
  const ROWS = 22;
  const CELL = 32;
  // emoji → [row, column]
  const ICONS = {
    '💀': [0, 0], '☠': [0, 0], '👹': [0, 4], '✨': [0, 5], '🌟': [0, 5], '❤': [0, 6], '💖': [0, 6], '💕': [0, 6],
    '😴': [0, 7], '💤': [0, 7], '⚡': [0, 8], '💧': [0, 10], '🚿': [0, 10], '💦': [0, 10],
    '💪': [1, 4],
    '⬆': [2, 0], '⬇': [2, 1], '📈': [2, 2], '📉': [2, 3], '↩': [2, 5], '🔄': [2, 6], '🔁': [2, 6], '🌀': [5, 14],
    '⚔': [5, 9], '💥': [3, 11], '💨': [3, 12],
    '💬': [0, 3], '🗨': [0, 3], '🔥': [4, 2], '⛺': [4, 3], '⚒': [4, 4], '📖': [4, 7],
    '🗡': [5, 1], '🔪': [5, 3], '🪃': [6, 6], '✊': [5, 15], '👊': [5, 15],
    '🛡': [6, 1], '🏹': [6, 3], '🪄': [6, 8],
    '🎩': [7, 3], '👑': [8, 6], '💍': [8, 5],
    '✋': [8, 0], '🧤': [8, 0], '🎒': [8, 9],
    '🧪': [9, 0], '🍷': [9, 12],
    '🧳': [10, 0], '👛': [12, 6], '🪓': [10, 1], '⛏': [10, 2], '🔨': [10, 4], '🔍': [10, 8], '🏮': [10, 9],
    '💡': [10, 11], '💣': [10, 12], '⏳': [10, 15], '⌛': [10, 15],
    '🪞': [11, 1], '🔑': [11, 9], '🔧': [11, 9], '🗝': [11, 10], '🔓': [11, 10],
    '📦': [11, 11], '🎁': [11, 11], '🌿': [11, 13], '🍂': [11, 14], '🌳': [11, 15], '🌲': [11, 15],
    '🍄': [12, 0], '🌱': [12, 4], '🪴': [12, 5], '💰': [12, 11], '🪙': [12, 7], '🤲': [12, 13], '🧊': [12, 14],
    '💎': [12, 15],
    '📕': [13, 1], '📚': [13, 4], '✉': [13, 9], '📜': [13, 10], '📋': [13, 11], '🗺': [13, 12], '🎲': [13, 13],
    '🍺': [13, 15],
    '🍎': [14, 0], '🍌': [14, 1], '🍐': [14, 2], '🍋': [14, 3], '🍓': [14, 4], '🍇': [14, 5], '🥕': [14, 6],
    '🌽': [14, 7], '🌾': [14, 7], '🍅': [14, 9], '🍆': [14, 10], '🌶': [14, 11], '🍞': [14, 13], '🥖': [14, 14],
    '🍗': [15, 0], '🥩': [15, 1], '🍖': [15, 3], '🍢': [15, 4], '🥚': [15, 6], '🧀': [15, 7], '🍬': [15, 12],
    '🍰': [15, 13], '☕': [15, 14],
    '🎣': [16, 0], '🪝': [16, 1], '🪱': [16, 2], '🐟': [16, 3], '🐠': [16, 6], '🦑': [16, 9], '🐙': [16, 9],
    '🐢': [16, 10],
    '🪵': [17, 0], '🪨': [17, 1], '🧈': [17, 3], '🧶': [17, 6], '🪶': [17, 10],
    '🔮': [18, 4], '🫧': [18, 1],
    '🍳': [19, 8], '🍲': [19, 9], '🐴': [19, 10],
    '🛒': [20, 0], '🧺': [20, 0],
    '🌅': [21, 7], '☀': [21, 8], '🌄': [21, 9], '🌙': [21, 10], '❄': [21, 11],
  };
  const VS16 = '️';
  const keys = Object.keys(ICONS).sort((a, b) => b.length - a.length);
  const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const PATTERN = new RegExp(`(?:${keys.map(escape).join('|')})${VS16}?`, 'gu');
  const cellOf = (emoji) => ICONS[emoji.replace(VS16, '')] ?? null;
  const has = (text) => { PATTERN.lastIndex = 0; return PATTERN.test(text); };

  // ── DOM ──
  const style = document.createElement('style');
  style.textContent = `
px-icon {
  display: inline-block;
  width: 1.3em;
  height: 1.3em;
  margin: 0 0.04em;
  vertical-align: -0.3em;
  overflow: hidden;
  color: transparent !important;
  text-shadow: none !important;
  -webkit-text-fill-color: transparent;
  font-size: inherit;
  line-height: 1.3em;
  white-space: nowrap;
  background: url('${SHEET_URL}') 0 0 / ${COLS * 100}% ${ROWS * 100}% no-repeat;
  image-rendering: pixelated;
  filter: drop-shadow(0 1px 1px rgba(0, 0, 0, 0.55));
  user-select: none;
  pointer-events: none;
}`;
  document.head.append(style);

  const SKIP = 'px-icon, script, style, textarea, input, select, option, [data-no-icons]';
  const iconNode = (emoji) => {
    const [r, c] = cellOf(emoji);
    const node = document.createElement('px-icon');
    node.style.backgroundPosition = `${(c / (COLS - 1)) * 100}% ${(r / (ROWS - 1)) * 100}%`;
    node.textContent = emoji;
    return node;
  };
  const iconizeText = (textNode) => {
    const text = textNode.nodeValue;
    if (!text || !has(text)) return;
    const parent = textNode.parentElement;
    if (!parent || parent.closest(SKIP)) return;
    const frag = document.createDocumentFragment();
    let last = 0;
    PATTERN.lastIndex = 0;
    for (let m = PATTERN.exec(text); m; m = PATTERN.exec(text)) {
      if (m.index > last) frag.append(text.slice(last, m.index));
      frag.append(iconNode(m[0]));
      last = m.index + m[0].length;
    }
    if (last < text.length) frag.append(text.slice(last));
    textNode.replaceWith(frag);
  };
  const iconizeTree = (root) => {
    if (root.nodeType === Node.TEXT_NODE) { iconizeText(root); return; }
    if (root.nodeType !== Node.ELEMENT_NODE || root.closest?.(SKIP)) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const found = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) if (has(n.nodeValue)) found.push(n);
    found.forEach(iconizeText);
  };
  const observer = new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === 'characterData') iconizeText(r.target);
      else r.addedNodes.forEach((n) => { if (n.isConnected) iconizeTree(n); });
    }
  });
  const start = () => {
    iconizeTree(document.body);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  };
  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start, { once: true });

  // ── Canvas ──
  const sheet = new Image();
  sheet.src = SHEET_URL;
  const pending = [];
  sheet.addEventListener('load', () => pending.splice(0).forEach((fn) => fn()));
  // [{ text } | { icon: [r, c] }]
  const split = (text) => {
    const parts = [];
    let last = 0;
    PATTERN.lastIndex = 0;
    for (let m = PATTERN.exec(text); m; m = PATTERN.exec(text)) {
      if (m.index > last) parts.push({ text: text.slice(last, m.index) });
      parts.push({ icon: cellOf(m[0]) });
      last = m.index + m[0].length;
    }
    if (last < text.length) parts.push({ text: text.slice(last) });
    return parts;
  };
  const ICON_EM = 1.2;   // an icon's width, in font sizes
  // Width of `text` as drawText would draw it in the 2D context's current font at `size` px
  const measureText = (g, text, size) => split(text)
    .reduce((w, p) => w + (p.icon ? size * ICON_EM : g.measureText(p.text).width), 0);
  // Draws `text` centred on (x, y) (textBaseline 'middle'), icons for the emoji in it.
  // onReady: called once the sheet has loaded if it wasn't yet (redraw then); returns false then.
  const drawText = (g, text, x, y, size, onReady) => {
    const parts = split(text);
    const ready = sheet.complete && sheet.naturalWidth > 0;
    if (!ready && onReady && parts.some((p) => p.icon)) pending.push(onReady);
    const align = g.textAlign;
    g.textAlign = 'left';
    let cx = x - measureText(g, text, size) / 2;
    for (const p of parts) {
      if (p.icon) {
        const s = size * ICON_EM;
        if (ready) {
          const smooth = g.imageSmoothingEnabled;
          g.imageSmoothingEnabled = false;
          g.drawImage(sheet, p.icon[1] * CELL, p.icon[0] * CELL, CELL, CELL, cx, y - s / 2, s, s);
          g.imageSmoothingEnabled = smooth;
        }
        cx += s;
      } else {
        g.fillText(p.text, cx, y);
        cx += g.measureText(p.text).width;
      }
    }
    g.textAlign = align;
    return ready;
  };

  window.pixelIcons = { has, measureText, drawText, iconizeTree };
})();

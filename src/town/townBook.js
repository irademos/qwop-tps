// The town book (📖 left of 🔔 on the Town HUD; M key): two pages —
//   Map:  the town from above (the nav grid's ground / roads / water, the houses, the places) with
//         everyone on it, live — townsfolk (the law blue, bandits orange, anyone fighting the
//         player red), ❗ / ❓ over whoever has a job / a reward, 📍 where a job's work is, the
//         player's arrow and the other players of a shared town. Tap someone for who they are.
//   Town: what Settings → Town used to show — the player's bag (tap a food to eat), their jobs,
//         and everyone in town sorted by coins (T.roster(), townMode.js).
// Someone in a room (under the map — townRooms.js) is drawn at their house's door, faded.
// Nothing here pauses the town. DOM + canvas only; installed onto T like the other town modules.
import { NAV_BOUNDS, el } from './townConfig.js';

const PAGES = [
  { id: 'map', label: 'Map' },
  { id: 'town', label: 'Town' },
];
const FILTERS = [
  { id: 'all', label: 'Everyone', keep: () => true },
  { id: 'folk', label: 'Townsfolk', keep: (p) => p.kind === 'townsfolk' },
  { id: 'players', label: 'Players', keep: (p) => p.kind === 'you' || p.kind === 'player' },
  { id: 'outlaws', label: 'Bandits', keep: (p) => p.kind === 'outlaw' },
];
const REFRESH_MS = 250;        // the map, while open
const LIST_REFRESH_MS = 1000;  // the Town page, while open
const MAP_PAD_M = 6;           // around the ground the map shows
const TAP_RADIUS_PX = 16;
// Map colours (a painted map — not the UI tokens)
const C = {
  sea: '#2f5a74', water: '#3f7896', grass: '#6d8a47', rough: '#4f6a36', trail: '#b39a68', road: '#cdb684',
  house: '#8a5a3c', houseEdge: '#3a2416', mine: '#d9a441',
  folk: '#f3ead8', law: '#6fa8ff', outlaw: '#ff8a3d', enemy: '#ff3b3b', you: '#ffd25a', player: '#5fe0e6',
  ink: '#1b1410', label: 'rgba(255, 248, 230, 0.92)',
};

export function installTownBook(T, ctx) {
  // ── DOM ──
  const btn = el('button', 'town-book-btn');
  btn.type = 'button';
  btn.title = 'Town book (M)';
  btn.append(el('span', null, '📖'));
  const overlay = el('div', 'town-book-overlay hidden');
  const book = el('div', 'town-book ui-panel');
  const head = el('div', 'town-book-head');
  const tabs = el('div', 'town-book-tabs');
  const tabBtns = {};
  for (const p of PAGES) {
    const b = el('button', 'ui-chip', p.label);
    b.type = 'button';
    b.addEventListener('click', () => showPage(p.id));
    tabBtns[p.id] = b;
    tabs.append(b);
  }
  const close = el('button', 'ui-btn-ghost town-book-close', '✕');
  close.type = 'button';
  close.title = 'Close';
  close.addEventListener('click', () => toggle(false));
  head.append(el('div', 'town-book-title', 'Town Book'), tabs, close);

  // Map page
  const mapPage = el('div', 'town-book-page');
  const mapWrap = el('div', 'town-book-map');
  const canvas = el('canvas', 'town-book-canvas');
  mapWrap.append(canvas);
  const info = el('div', 'town-book-info', 'Tap someone on the map.');
  const legend = el('div', 'town-book-legend');
  for (const [cls, text] of [['you', 'You'], ['folk', 'Townsfolk'], ['law', 'Law'], ['outlaw', 'Bandits'], ['enemy', 'Fighting you'], ['player', 'Players']]) {
    const item = el('span', 'town-book-key');
    item.append(el('span', `town-book-dot town-book-dot-${cls}`), document.createTextNode(text));
    legend.append(item);
  }
  legend.append(el('span', 'town-book-key', '❗ job'), el('span', 'town-book-key', '❓ reward'), el('span', 'town-book-key', '📍 job spot'));
  mapPage.append(mapWrap, info, legend);

  // Town page (was Settings → Town)
  const townPage = el('div', 'town-book-page');
  const summary = el('div', 'settings-stats-grid');
  const summaryFields = {};
  for (const [key, label] of [['people', 'People'], ['players', 'Players'], ['coins', 'Coins in town'], ['day', 'Day']]) {
    const stat = el('div', 'settings-stat');
    const value = el('span', 'settings-stat-value', '—');
    stat.append(el('span', 'settings-stat-label', label), value);
    summary.append(stat);
    summaryFields[key] = value;
  }
  const bagTitle = el('h3', 'settings-section-title', 'Your Bag');
  const bag = el('div', 'town-book-bag');
  const jobsTitle = el('h3', 'settings-section-title', 'Jobs');
  const jobs = el('div', 'town-book-jobs');
  const filters = el('div', 'town-roster-filters');
  const filterBtns = {};
  let filter = 'all';
  for (const f of FILTERS) {
    const chip = el('button', 'ui-chip', f.label);
    chip.type = 'button';
    chip.addEventListener('click', () => { filter = f.id; renderTown(); });
    filterBtns[f.id] = chip;
    filters.append(chip);
  }
  const list = el('ol', 'town-roster');
  townPage.append(summary, bagTitle, bag, jobsTitle, jobs, el('h3', 'settings-section-title', 'People'), filters, list);

  book.append(head, mapPage, townPage);
  overlay.append(book);
  T.hud.append(btn, overlay);
  // (a tap on the dark around the book closes it)
  overlay.addEventListener('pointerdown', (e) => { if (e.target === overlay) toggle(false); });
  btn.addEventListener('click', (e) => { e.stopPropagation(); toggle(); });

  let page = 'map';
  let timer = null;
  const isOpen = () => !overlay.classList.contains('hidden');
  const showPage = (id) => {
    page = id;
    for (const p of PAGES) tabBtns[p.id].classList.toggle('is-active', p.id === id);
    mapPage.classList.toggle('hidden', id !== 'map');
    townPage.classList.toggle('hidden', id !== 'town');
    restart();
  };
  const tick = () => { if (page === 'map') drawMap(); else renderTown(); };
  const restart = () => {
    clearInterval(timer);
    timer = null;
    if (!isOpen()) return;
    tick();
    timer = setInterval(tick, page === 'map' ? REFRESH_MS : LIST_REFRESH_MS);
  };
  const toggle = (open = !isOpen()) => {
    if (open && !T.active) return;
    overlay.classList.toggle('hidden', !open);
    btn.classList.toggle('is-active', open);
    document.body.classList.toggle('town-book-open', open);
    if (open) { T.toggleLog?.(false); showPage(page); } else restart();
  };
  window.addEventListener('keydown', (e) => {
    if (!T.active || e.target?.closest?.('input, textarea, select')) return;
    if (e.key === 'Escape' && isOpen()) { toggle(false); e.preventDefault(); e.stopImmediatePropagation(); return; }
    if ((e.key === 'm' || e.key === 'M') && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) toggle();
  }, true);
  window.addEventListener('resize', () => { if (isOpen() && page === 'map') drawMap(); });

  // ── The map ──
  // The ground under it, drawn once per layout: a pixel per nav cell, cropped to where there's ground
  let base = null; // { layout, img, minX, minZ, w, h }
  const buildBase = () => {
    const nav = T.layout.nav;
    const { cols, rows, cell } = nav;
    const img = document.createElement('canvas');
    img.width = cols;
    img.height = rows;
    const g = img.getContext('2d');
    const data = g.createImageData(cols, rows);
    const rgb = (hex) => [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16));
    const col = { sea: rgb(C.sea), water: rgb(C.water), grass: rgb(C.grass), rough: rgb(C.rough), trail: rgb(C.trail), road: rgb(C.road) };
    let c0 = cols, c1 = -1, r0 = rows, r1 = -1;
    for (let i = 0; i < cols * rows; i++) {
      const hasGround = nav.heightAt(i) > -1e5; // (-1e6: nothing there — townNav.js)
      const ground = hasGround && !nav.isWater(i);
      let c;
      if (nav.isWater(i)) c = col.water;
      else if (!hasGround) c = col.sea;
      else if (!nav.walkableIndex(i)) c = col.rough;
      else c = [col.grass, col.trail, col.road][nav.kindAt(i)] ?? col.grass;
      data.data.set([...c, 255], i * 4);
      if (ground) {
        const cc = i % cols, rr = Math.floor(i / cols);
        c0 = Math.min(c0, cc); c1 = Math.max(c1, cc); r0 = Math.min(r0, rr); r1 = Math.max(r1, rr);
      }
    }
    g.putImageData(data, 0, 0);
    const b = nav.bounds ?? NAV_BOUNDS;
    const pad = MAP_PAD_M;
    const minX = c1 >= 0 ? Math.max(b.minX, b.minX + c0 * cell - pad) : b.minX;
    const maxX = c1 >= 0 ? Math.min(b.maxX, b.minX + (c1 + 1) * cell + pad) : b.maxX;
    const minZ = r1 >= 0 ? Math.max(b.minZ, b.minZ + r0 * cell - pad) : b.minZ;
    const maxZ = r1 >= 0 ? Math.min(b.maxZ, b.minZ + (r1 + 1) * cell + pad) : b.maxZ;
    base = { layout: T.layout, img, bounds: b, minX, minZ, w: maxX - minX, h: maxZ - minZ };
  };

  // Where something is on the map: a room's people at its house's door (faded)
  const mapSpot = (x, z) => {
    const room = T.rooms?.roomAt?.(x, z);
    if (!room) return { x, z, inside: false };
    const door = T.layout.places.rooms[room]?.door;
    return door ? { x: door.x, z: door.z, inside: true } : null;
  };
  const icons = () => window.pixelIcons;
  const drawIcon = (g, text, x, y, size) => {
    g.font = `700 ${size}px Inter, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    if (icons()?.drawText) icons().drawText(g, text, x, y, size, () => { if (isOpen()) drawMap(); });
    else g.fillText(text, x, y);
  };
  const drawLabel = (g, text, x, y, size = 11) => {
    g.font = `700 ${size}px Inter, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    // (kept inside the map)
    const half = g.measureText(text).width / 2 + 2;
    const w = canvas.width / Math.min(2, window.devicePixelRatio || 1);
    x = Math.min(Math.max(x, half), Math.max(half, w - half));
    g.lineWidth = 3;
    g.strokeStyle = 'rgba(20, 14, 8, 0.85)';
    g.strokeText(text, x, y);
    g.fillStyle = C.label;
    g.fillText(text, x, y);
  };

  let hits = [];   // [{ x, y, text }] the dots last drawn (for taps)
  let picked = null; // { id } of whoever was tapped
  const drawMap = () => {
    if (!T.active || !T.layout) return;
    if (!base || base.layout !== T.layout) buildBase();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const wrapW = mapWrap.clientWidth || 320;
    const wrapH = mapWrap.clientHeight || wrapW;
    const scale = Math.min(wrapW / base.w, wrapH / base.h);
    const cw = Math.round(base.w * scale);
    const ch = Math.round(base.h * scale);
    if (canvas.width !== cw * dpr || canvas.height !== ch * dpr) {
      canvas.width = cw * dpr;
      canvas.height = ch * dpr;
      canvas.style.width = `${cw}px`;
      canvas.style.height = `${ch}px`;
    }
    const g = canvas.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Top view: world +X right, +Z down
    const px = (x) => (x - base.minX) * scale;
    const pz = (z) => (z - base.minZ) * scale;
    const b = base.bounds;
    g.imageSmoothingEnabled = true;
    g.fillStyle = C.sea;
    g.fillRect(0, 0, cw, ch);
    g.drawImage(base.img, 0, 0, base.img.width, base.img.height, px(b.minX), pz(b.minZ), (b.maxX - b.minX) * scale, (b.maxZ - b.minZ) * scale);

    const P = T.layout.places;
    // Houses (the player's own outlined gold)
    const mine = T.myHome?.() ?? -1;
    const myHouse = mine >= 0 ? P.homes[mine] : null;
    for (const h of T.layout.buildings) {
      const r = Math.max(4, h.radius * 0.72 * scale);
      const own = myHouse && Math.hypot(myHouse.x - h.x, myHouse.z - h.z) < h.radius + 4;
      g.fillStyle = C.house;
      g.strokeStyle = own ? C.mine : C.houseEdge;
      g.lineWidth = own ? 2.5 : 1.5;
      g.beginPath();
      g.roundRect(px(h.x) - r, pz(h.z) - r, r * 2, r * 2, 3);
      g.fill();
      g.stroke();
    }
    // Places
    const place = (p, icon, name) => {
      if (!p) return;
      drawIcon(g, icon, px(p.x), pz(p.z), 15);
      if (name) drawLabel(g, name, px(p.x), pz(p.z) + 13, 10);
    };
    for (const f of P.fields ?? []) place(f, '🌾', null);
    place(P.rooms?.shop?.door, '🛒', 'Shop');
    place(P.rooms?.jail?.door, '🔒', 'Jail');
    place(P.fire, '🔥', null);
    place(P.fishSpot, '🎣', null);
    place(P.wizard, '🔮', 'Wizard');
    place(P.camp, '⛺', 'Bandit camp');
    if (myHouse) place(myHouse, '🏠', 'Home');

    // People
    hits = [];
    const dot = (x, y, r, fill, { faded = false, ring = null, arrow = null } = {}) => {
      g.globalAlpha = faded ? 0.45 : 1;
      if (arrow != null) {
        // (the player: an arrow the way they face — +Z is down the map)
        const fx = Math.sin(arrow), fz = Math.cos(arrow);
        g.beginPath();
        g.moveTo(x + fx * r * 1.6, y + fz * r * 1.6);
        g.lineTo(x - fx * r + fz * r, y - fz * r - fx * r);
        g.lineTo(x - fx * r * 0.4, y - fz * r * 0.4);
        g.lineTo(x - fx * r - fz * r, y - fz * r + fx * r);
        g.closePath();
      } else {
        g.beginPath();
        g.arc(x, y, r, 0, Math.PI * 2);
      }
      g.fillStyle = fill;
      g.fill();
      g.lineWidth = 1.5;
      g.strokeStyle = C.ink;
      g.stroke();
      if (ring) {
        g.beginPath();
        g.arc(x, y, r + 3 + Math.sin(performance.now() / 160) * 1.2, 0, Math.PI * 2);
        g.strokeStyle = ring;
        g.lineWidth = 2;
        g.stroke();
      }
      g.globalAlpha = 1;
    };
    for (const n of T.npcs) {
      if (!n.alive || n.dying) continue;
      const fighting = n.fighter && !n.fighter.isDead;
      const at = mapSpot(fighting ? n.fighter.group.position.x : n.x, fighting ? n.fighter.group.position.z : n.z);
      if (!at) continue;
      const kind = fighting ? 'enemy' : n.def.outlaw ? 'outlaw' : n.def.law ? 'law' : 'folk';
      const x = px(at.x), y = pz(at.z);
      const r = n.role === 'kid' ? 3.2 : 4.2;
      dot(x, y, r, C[kind], { faded: at.inside, ring: fighting ? C.enemy : picked?.id === n.id ? '#fff' : null });
      const status = T.npcStatus?.(n) ?? '';
      const bounty = n.def.bounty ? ` · 💰 ${n.def.bounty} bounty` : '';
      hits.push({ x, y, id: n.id, text: `${n.def.emoji ?? ''} ${n.name} · ${n.def.label}${status ? ` · ${status}` : ''}${bounty}` });
    }
    for (const p of T.net?.players?.() ?? []) {
      if (!Number.isFinite(p.x)) continue;
      const at = mapSpot(p.x, p.z);
      if (!at) continue;
      const x = px(at.x), y = pz(at.z);
      dot(x, y, 4.6, C.player, { faded: at.inside, ring: p.stars > 0 ? C.enemy : null });
      drawLabel(g, `${p.name}${p.stars > 0 ? ` ${'★'.repeat(p.stars)}` : ''}`, x, y - 11, 10);
      hits.push({ x, y, id: `p:${p.id}`, text: `🧍 ${p.name} · Player${p.stars > 0 ? ` · ${'★'.repeat(p.stars)} wanted` : ''}` });
    }
    // Jobs: ❗ / ❓ over the giver, 📍 at the work
    for (const m of T.jobMarks?.() ?? []) {
      const at = mapSpot(m.x, m.z);
      if (!at) continue;
      drawIcon(g, m.icon, px(at.x), pz(at.z) - (m.icon === '📍' ? 8 : 12), m.icon === '📍' ? 16 : 14);
    }
    // The player (on top)
    const me = T.playerPos();
    const at = mapSpot(me.x, me.z);
    if (at) {
      const yaw = ctx.getPlayerModel?.()?.rotation?.y ?? 0;
      dot(px(at.x), pz(at.z), 5.5, C.you, { arrow: yaw });
      hits.push({ x: px(at.x), y: pz(at.z), id: 'me', text: `🧍 ${ctx.getPlayerName()} (you)${T.law.stars > 0 ? ` · ${'★'.repeat(T.law.stars)} wanted` : ''}` });
    }
    if (picked) {
      const h = hits.find((e) => e.id === picked.id);
      info.textContent = h ? h.text : 'They\'re gone.';
    }
  };
  canvas.addEventListener('pointerdown', (e) => {
    const r = canvas.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    let best = null;
    let bd = TAP_RADIUS_PX;
    for (const h of hits) {
      const d = Math.hypot(h.x - x, h.y - y);
      if (d < bd) { bd = d; best = h; }
    }
    picked = best ? { id: best.id } : null;
    info.textContent = best ? best.text : 'Tap someone on the map.';
    drawMap();
  });

  // ── The Town page: summary, the bag, jobs, everyone and their coins (the richest crowned) ──
  const renderTown = () => {
    const roster = T.roster?.();
    if (!roster) return;
    const people = roster.people ?? [];
    const known = (p) => Number.isFinite(p.coins);
    summaryFields.people.textContent = String(people.filter((p) => p.kind === 'townsfolk' || p.kind === 'outlaw').length);
    summaryFields.players.textContent = String(people.filter((p) => p.kind === 'you' || p.kind === 'player').length);
    summaryFields.coins.textContent = `🪙 ${people.reduce((s, p) => s + (known(p) ? p.coins : 0), 0)}`;
    summaryFields.day.textContent = String(roster.day ?? '—');

    // The bag (tap a food to eat it)
    const goods = roster.bag?.goods ?? [];
    bagTitle.textContent = roster.bag ? `Your Bag · 🎒 ${goods.reduce((s, g) => s + g.n, 0)}/${roster.bag.max}` : 'Your Bag';
    bag.replaceChildren(...goods.map((g) => {
      const b = el('button', 'ui-chip town-book-good', `${g.emoji} ${g.n}`);
      b.type = 'button';
      const canEat = g.food && g.n > 0;
      b.disabled = !canEat;
      b.title = g.food ? `Eat ${g.label} (+${g.heal} health)` : g.label;
      if (canEat) b.addEventListener('click', () => { T.eat(g.id); renderTown(); });
      return b;
    }));
    if (goods.some((g) => g.food && g.n > 0)) bag.append(el('div', 'settings-muted town-book-hint', 'Tap a food to eat it.'));

    // Jobs
    const js = roster.jobs ?? [];
    jobs.replaceChildren(...(js.length ? js.map((j) => {
      const row = el('div', 'town-roster-row');
      const who = el('div', 'town-roster-who');
      who.append(el('div', 'town-roster-name', `${j.icon ?? '📍'} ${j.title}`), el('div', 'town-roster-meta', j.progress ?? ''));
      row.append(who);
      return row;
    }) : [el('div', 'settings-muted', 'No jobs right now — look for ❗ over townsfolk (or on the map).')]));

    // People
    for (const [id, chip] of Object.entries(filterBtns)) {
      chip.classList.toggle('is-active', id === filter);
      chip.classList.toggle('hidden', id === 'outlaws' && !people.some((p) => p.kind === 'outlaw'));
    }
    const keep = (FILTERS.find((f) => f.id === filter) ?? FILTERS[0]).keep;
    const top = people.reduce((m, p) => (known(p) ? Math.max(m, p.coins) : m), 0);
    const shown = people.filter(keep)
      .sort((a, b) => (known(b) ? b.coins : -1) - (known(a) ? a.coins : -1) || a.name.localeCompare(b.name));
    list.replaceChildren(...(shown.length ? shown.map((p) => {
      const crowned = top > 0 && known(p) && p.coins === top;
      const row = el('li', `town-roster-row${p.kind === 'you' ? ' is-you' : ''}${crowned ? ' is-richest' : ''}`);
      const who = el('div', 'town-roster-who');
      const name = el('div', 'town-roster-name');
      if (crowned) name.append(el('span', 'town-roster-crown', '👑'));
      name.append(el('span', null, `${p.emoji ?? ''} ${p.name}${p.kind === 'you' ? ' (you)' : ''}`.trim()));
      who.append(name, el('div', 'town-roster-meta', [p.role, p.status].filter(Boolean).join(' · ')));
      const stats = el('div', 'town-roster-stats');
      if (Number.isFinite(p.hp)) stats.append(el('span', null, `❤️ ${p.hp}${Number.isFinite(p.maxHp) ? `/${p.maxHp}` : ''}`));
      if (p.mood) { const mood = el('span', null, p.mood.emoji); mood.title = p.mood.label; stats.append(mood); }
      if (p.stars > 0) stats.append(el('span', 'town-roster-stars', '★'.repeat(p.stars)));
      if (p.bounty > 0) stats.append(el('span', null, `💰 ${p.bounty} bounty`));
      if (p.kind === 'you') {
        stats.append(el('span', null, `🎒 ${p.goods ?? 0}`));
        if (p.chest > 0) stats.append(el('span', null, `📦 🪙 ${p.chest}`));
      }
      who.append(stats);
      row.append(who, el('div', 'town-roster-coins', known(p) ? `🪙 ${p.coins}` : '🪙 ?'));
      return row;
    }) : [el('li', 'settings-muted', 'Nobody here.')]));
  };

  const resetBook = () => { toggle(false); base = null; picked = null; info.textContent = 'Tap someone on the map.'; };
  Object.assign(T, { toggleBook: toggle, isBookOpen: isOpen, resetBook });
}

// Town: homes. One resident to a house — the townsfolk and the players together fill the town's
// houses (places.homes), so a town has as many townsfolk as it has houses left over. Each player
// has a house kept for them (T.houses: home index → { k: member key, n: name, b: bought }) and
// buys it at its door (HOUSE_PRICE); in a shared town a player moving in takes a free house, or
// a townsperson moves out to make room (the least needed — FOUNDING_ROLES order — never below
// MIN_TOWNSFOLK). The host (or a town of your own) decides who lives where; the others are told
// ('houses').
//
// Doors: a townsperson's home is open in the day and locked at night unless they've asked the
// player in (a job they gave, following the player, or answering a knock — invites); ✊ Knock:
// someone at home asks them in (friends, job), comes to the door (talk to them there) or doesn't
// answer. Another player's home is always locked; the player's own is theirs once bought. A
// bought lock-pick (single use, the shop) opens any locked door — the lockpick minigame —
// and it's a break-in (a theft) if anyone sees.
//
// Belongings: the player's bag holds BAG_MAX goods and the wallet WALLET_MAX coins (the wallet's
// cap is the game's — bootstrapGameApp.js: coins that don't fit stay on the ground); the rest
// goes in the chest in their home (📦 Chest — townStoragePanel.js; T.store, saved with the
// player's own things).
//
// Planned, not built yet:
//   - Open invites / alliances: a player lets chosen players (or everyone, or a townsperson
//     friend) into their home — an `allow` list on T.houses[i] the host keeps, checked in
//     doorAccess; alliances could share it both ways and stop PvP between them.
//   - Knocking on another player's door: a 'knock' op to them (if online) with Let in / Ignore.
//   - Breaking into another player's home to steal: their chest would have to live in the room
//     state (the host's) instead of on their device; for now it's locked tight.
//   - Townsfolk's belongings in their homes (savings, goods) to steal after a break-in.
//   - Freeing the house of a member whose place in the room lapsed (townNet.js prunes them).
//   - Gear (weapons, bombs…) kept in the chest too, and a bigger bag to buy.

import { FOUNDING_ROLES, firstName, livesOut } from './townPeople.js';
import { GOODS, GOOD_IDS } from './townEconomy.js';
import { makeTextSprite } from '../village/villageMode.js';
import { createStoragePanel } from './townStoragePanel.js';
import {
  BAG_MAX, BED_ACT_DIST, CHEST_ACT_DIST, COME_OUT_S, DOOR_ACT_DIST, FRIEND_ATTITUDE, GRUDGE_ATTITUDE, HOUSE_PRICE, INVITE_S,
  KNOCK_AGAIN_S, KNOCK_S, LOCKPICK_MAX, MIN_TOWNSFOLK, NIGHT_FROM_H, WAKE_HOUR, WALLET_MAX, dist2, pickOf,
} from './townConfig.js';

const COME_IN_LINES = ['Oh — it\'s you. Come in, come in.', 'Door\'s open, come on in.', 'Ah, good. Come in, quick, it\'s cold.'];
const COME_OUT_LINES = ['Who\'s knocking at this hour?', 'Mm? What is it? It\'s the middle of the night.', 'This had better be good.'];
const JOB_IN_LINES = ['About the job? Come in.', 'You\'re here about the job — come in.'];

// T: the town's shared state + functions (createTownMode in townMode.js); ctx: the game
export function installTownHomes(T, ctx) {
  T.houses = {};
  T.store = { coins: 0, goods: Object.fromEntries(GOOD_IDS.map((g) => [g, 0])) };
  T.lockpicks = 0;
  T.homeBought = false;       // (the player's own record: a shared town's host is told on joining)
  T.invites = {};             // room key → sim time the invitation lapses
  T.knock = null;             // { key, at } — waiting on an answer
  T.knockedAt = {};           // room key → sim time
  T.doorPick = null;          // the door being picked (the lockpick minigame)
  const noteAt = {};          // room key → sim time a locked door last said so
  let sign = null;            // the sign over the player's house's door
  let signText = '';

  const storage = createStoragePanel(T.hud, {
    onMove: (id, n) => moveToChest(id, n),
    onClose: () => storage.close(),
  });

  // ── Who lives where ──
  const myKey = () => (T.mp() ? ctx.memberKey() : 'me');
  const P = () => T.layout.places;
  const myHome = () => {
    const k = myKey();
    for (const [i, h] of Object.entries(T.houses)) if (h.k === k) return Number(i);
    return -1;
  };
  const residents = (i) => T.npcs.filter((n) => n.alive && !n.def.outlaw && n.homeIndex === i);
  const roomOf = (i) => P().homes[i]?.room ?? null;
  const homeOfRoom = (key) => {
    const r = P().rooms[key];
    return r?.kind === 'home' ? r.home : -1;
  };
  const takenHomes = () => {
    const used = new Set(Object.keys(T.houses).map(Number));
    for (const n of T.npcs) if (n.alive && !n.def.outlaw && n.homeIndex >= 0) used.add(n.homeIndex);
    return used;
  };
  // A house nobody lives in (one with a room first — those can be walked into)
  const freeHome = ({ needRoom = false } = {}) => {
    const used = takenHomes();
    const free = P().homes.map((h, i) => i).filter((i) => !used.has(i));
    const roomed = free.filter((i) => roomOf(i));
    if (needRoom) return roomed[0] ?? -1;
    return roomed[0] ?? free[0] ?? -1;
  };
  // How much the town needs a townsperson (lower: more): the k-th of a role takes the place of
  // the k-th of that role in FOUNDING_ROLES; newcomers of a role there's no place for come last
  const ranks = () => {
    const seen = {};
    const out = new Map();
    const people = T.npcs.filter((n) => n.alive && !livesOut(n.def)).sort((a, b) => a.id - b.id);
    for (const n of people) {
      const k = seen[n.role] ?? 0;
      seen[n.role] = k + 1;
      let at = -1;
      for (let i = 0, c = 0; i < FOUNDING_ROLES.length; i++) {
        if (FOUNDING_ROLES[i] !== n.role) continue;
        if (c++ === k) { at = i; break; }
      }
      out.set(n, at >= 0 ? at : FOUNDING_ROLES.length + n.id);
    }
    return out;
  };
  const setHome = (n, i) => {
    n.homeIndex = i;
    n.home = P().homes[i];
  };
  // Packs up and leaves town (no house for them): gone from the roster, their jobs with them
  const moveAway = (n, why = 'no house free') => {
    if (n.fighter) { ctx.removeFighter(n.fighter); n.fighter = null; }
    for (const j of [...T.jobs]) {
      if ([j.giverId, j.data?.toId, j.data?.debtorId, j.data?.creditorId, j.data?.kidId].includes(n.id)) T.dropJob(j);
    }
    T.clearTalk(n);
    T.releaseBody(n);
    n.alive = false;
    n.dying = null;
    T.npcs = T.npcs.filter((m) => m !== n);
    return `📦 ${n.name} the ${n.def.label} packed up and left — ${why}.`;
  };
  // A house for a player (the town's authority only: a town of your own, or the host). An
  // empty one with a room, else the least needed townsperson in a house with a room moves out
  // (moved: their feed lines), else any empty house. → the home index, or -1
  const reserveHome = (k, name, moved = []) => {
    for (const [i, h] of Object.entries(T.houses)) if (h.k === k) { h.n = name || h.n; return Number(i); }
    let i = freeHome({ needRoom: true });
    if (i < 0) {
      const r = ranks();
      const count = r.size;
      const out = [...r.keys()]
        .filter((n) => roomOf(n.homeIndex) && !n.ctrl && !n.fighter && !n.following && !n.lost && !n.escort && !(n.jailedUntil > T.simT))
        .sort((a, b) => r.get(b) - r.get(a))[0];
      if (out && count > MIN_TOWNSFOLK) {
        i = out.homeIndex;
        moved.push(moveAway(out, `to make room for ${name || 'a newcomer'}`));
        // (anyone else in that house finds another, or leaves too)
        for (const n of residents(i)) {
          const f = freeHome();
          if (f >= 0 && f !== i) setHome(n, f);
          else moved.push(moveAway(n, `to make room for ${name || 'a newcomer'}`));
        }
      }
    }
    if (i < 0) i = freeHome();
    if (i < 0) return -1;
    T.houses[i] = { k, n: name || '', b: false };
    return i;
  };
  // One resident to a house: the most needed keep theirs, the rest find a free one or leave
  // (old saves had families sharing). Authority only.
  const settleHomes = () => {
    const used = new Set(Object.keys(T.houses).map(Number));
    const r = ranks();
    const moved = [];
    for (const n of [...r.keys()].sort((a, b) => r.get(a) - r.get(b))) {
      if (n.homeIndex >= 0 && !used.has(n.homeIndex)) { used.add(n.homeIndex); continue; }
      const roomed = P().homes.findIndex((h, i) => !used.has(i) && h.room);
      const f = roomed >= 0 ? roomed : P().homes.findIndex((h, i) => !used.has(i));
      if (f >= 0) { setHome(n, f); used.add(f); } else moved.push(moveAway(n));
    }
    return moved;
  };
  const cleanHouses = (h) => {
    const out = {};
    if (!h || typeof h !== 'object') return out;
    for (const [i, v] of Object.entries(h)) {
      const idx = Number(i);
      if (!Number.isInteger(idx) || idx < 0 || idx >= P().homes.length || typeof v?.k !== 'string') continue;
      out[idx] = { k: v.k, n: typeof v.n === 'string' ? v.n.slice(0, 40) : '', b: !!v.b };
    }
    return out;
  };

  // spawnTown: the town's houses (world) and the player's own things back
  const restoreHomes = (state, own) => {
    T.houses = cleanHouses(state?.houses);
    T.store.coins = Math.max(0, Math.floor(own?.store?.coins || 0));
    GOOD_IDS.forEach((g) => { T.store.goods[g] = Math.max(0, Math.floor(own?.store?.goods?.[g] || 0)); });
    T.lockpicks = Math.max(0, Math.min(LOCKPICK_MAX, Math.floor(own?.lockpicks || 0)));
    T.homeBought = !!own?.homeBought;
    T.invites = {};
    T.knock = null;
    T.knockedAt = {};
    T.doorPick = null;
    storage.close();
  };
  // Before the founding townsfolk move in (a fresh town): the player's house first, the one
  // with a room nearest the spawn
  const reserveFirst = () => {
    if (!T.isHost()) return;
    const S = P().spawn;
    const order = P().homes.map((h, i) => i).filter((i) => roomOf(i) && !T.houses[i])
      .sort((a, b) => dist2(P().homes[a].x, P().homes[a].z, S.x, S.z) - dist2(P().homes[b].x, P().homes[b].z, S.x, S.z));
    if (myHome() < 0 && order.length) T.houses[order[0]] = { k: myKey(), n: ctx.getPlayerName(), b: T.homeBought };
  };
  // After the townsfolk are in: one to a house, the player's house kept (a shared town's client
  // asks the host for one)
  const settleAfterSpawn = () => {
    if (T.isHost()) {
      const moved = [];
      const i = reserveHome(myKey(), ctx.getPlayerName(), moved);
      if (i >= 0 && T.homeBought) T.houses[i].b = true;
      moved.push(...settleHomes());
      for (const line of moved) T.feedLine(line);
      if (T.mp()) broadcastHouses(moved);
    } else {
      T.net.send(T.net.hostId(), { w: 1, op: 'home', k: myKey(), n: ctx.getPlayerName(), b: T.homeBought });
    }
    // (more than fits in the wallet / bag — an old save: it's in the chest at home)
    const extraCoins = ctx.getCoins() - WALLET_MAX;
    if (extraCoins > 0) {
      ctx.addCoins(-extraCoins);
      T.store.coins += extraCoins;
      T.feedLine(`👛 ${extraCoins} 🪙 didn't fit in your wallet — they're in your chest at home.`);
    }
    let extra = bagCount() - BAG_MAX;
    for (const g of GOOD_IDS) {
      if (extra <= 0) break;
      const n = Math.min(extra, T.goods[g]);
      T.goods[g] -= n;
      T.store.goods[g] += n;
      extra -= n;
    }
    T.renderGoods();
    const i = myHome();
    if (i >= 0 && !T.houses[i].b) T.feedLine(`🏠 A house is kept for you — buy it at its door (${HOUSE_PRICE} 🪙) to keep your things there.`);
  };

  // ── Shared town: the houses over the wire ──
  const broadcastHouses = (moved = []) => {
    if (T.netMode !== 'host') return;
    T.net.broadcast({ w: 1, op: 'houses', h: T.houses, moved });
  };
  // (host) a player asks for their house; bought: they bought it already (their own record)
  const onHomeAsk = (d) => {
    if (typeof d.k !== 'string' || !d.k) return;
    const moved = [];
    const i = reserveHome(d.k, typeof d.n === 'string' ? d.n.slice(0, 40) : '', moved);
    if (i >= 0 && d.b) T.houses[i].b = true;
    for (const line of moved) T.feedLine(line);
    broadcastHouses(moved);
    T.save();
  };
  const onBuyHome = (d) => {
    for (const h of Object.values(T.houses)) if (h.k === d.k) h.b = true;
    broadcastHouses();
  };
  const onHouses = (d) => {
    const before = myHome();
    T.houses = cleanHouses(d.h);
    for (const line of Array.isArray(d.moved) ? d.moved.slice(0, 4) : []) if (typeof line === 'string') T.feedLine(line.slice(0, 160));
    const i = myHome();
    if (i >= 0 && before < 0 && !T.houses[i].b) T.feedLine(`🏠 A house is kept for you — buy it at its door (${HOUSE_PRICE} 🪙).`);
    if (i < 0 && before < 0 && T.ready) T.feedLine('🏠 No house free in town for you right now.');
  };
  const handleHomesNet = (from, d) => {
    if (d.op === 'houses') { if (from === T.net.hostId() && T.netMode === 'client') onHouses(d); return true; }
    if (T.netMode !== 'host' || !T.ready) return d.op === 'home' || d.op === 'buyHome';
    if (d.op === 'home') { onHomeAsk(d); return true; }
    if (d.op === 'buyHome') { if (typeof d.k === 'string') onBuyHome(d); return true; }
    return false;
  };

  // ── Doors ──
  // Asked in: an invitation standing (a knock), a job one of them gave the player, or one of
  // them following the player
  const invitedTo = (key) => {
    if ((T.invites[key] ?? -1) > T.simT) return true;
    const i = homeOfRoom(key);
    return residents(i).some((n) => n.following || T.jobs.some((j) => j.giverId === n.id && (j.status === 'active' || j.status === 'done')));
  };
  // Can the player walk into that room? { open, why: 'forSale' | 'kept' | 'player' | 'night', owner }
  const doorAccess = (key) => {
    const i = homeOfRoom(key);
    if (i < 0) return { open: true };
    const h = T.houses[i];
    if (h) {
      if (h.k === myKey()) return h.b ? { open: true, mine: true } : { open: false, why: 'forSale' };
      return { open: false, why: h.b ? 'player' : 'kept', owner: h };
    }
    if (!T.isNight || !residents(i).length || invitedTo(key)) return { open: true };
    return { open: false, why: 'night' };
  };
  const whose = (key) => {
    const names = residents(homeOfRoom(key)).map((n) => firstName(n.name));
    return names.length ? `${names.join(' and ')}'s door is` : 'The door\'s';
  };
  // Walking into a locked door: why (now and then)
  const lockedNote = (key, a) => {
    if (T.simT - (noteAt[key] ?? -1e9) < 4) return;
    noteAt[key] = T.simT;
    if (a.why === 'forSale') T.feedLine(`🏠 Your house — for sale, ${HOUSE_PRICE} 🪙. Buy it here at the door.`);
    else if (a.why === 'player') T.feedLine(`🔒 ${a.owner.n || 'Another player'}'s home — locked.`);
    else if (a.why === 'kept') T.feedLine(`🔒 This house is kept for ${a.owner.n || 'another player'}.`);
    else T.feedLine(`🔒 ${whose(key)} locked for the night. Knock?`);
  };
  const knock = (key) => {
    if (T.knock || T.simT - (T.knockedAt[key] ?? -1e9) < KNOCK_AGAIN_S) return;
    T.knock = { key, at: T.simT };
    T.knockedAt[key] = T.simT;
    T.feedLine('✊ Knock knock…');
    T.actsAt = 0;
  };
  // Someone at home answers the door
  const answerKnock = (key) => {
    const i = homeOfRoom(key);
    const home = residents(i).filter((n) => !n.fighter && !(n.jailedUntil > T.simT)
      && (n.inside || T.rooms.roomAt(n.x, n.z) === key));
    if (!home.length) { T.feedLine('🚪 No answer — nobody\'s home.'); return; }
    const n = home.reduce((a, b) => (b.attitude > a.attitude ? b : a));
    const first = firstName(n.name);
    const job = T.jobs.some((j) => j.giverId === n.id && (j.status === 'active' || j.status === 'done'));
    if (job || n.following || n.attitude >= FRIEND_ATTITUDE) {
      T.invites[key] = T.simT + INVITE_S;
      T.feedLine(`🚪 ${first}: “${pickOf(job ? JOB_IN_LINES : COME_IN_LINES)}”`);
      return;
    }
    if (n.vendetta || n.attitude < GRUDGE_ATTITUDE) { T.feedLine('🚪 No answer… but someone\'s moving about in there.'); return; }
    const asleep = n.task?.type === 'sleep';
    if (Math.random() < (asleep ? 0.45 : 0.65) && comeOut(n, key)) return;
    T.feedLine(asleep ? '💤 No answer. Snoring, from somewhere inside.' : `🚪 No answer. ${first} must be busy.`);
  };
  // They come out to the door (talk to them there); back in after a while (decide)
  const comeOut = (n, key) => {
    if (!T.take(n)) return false;
    const r = P().rooms[key];
    const nx = Math.sin(r.exitYaw);
    const nz = Math.cos(r.exitYaw);
    n.inside = false;
    n.x = r.door.x;
    n.z = r.door.z;
    n.yaw = r.exitYaw;
    n.path = null;
    T.setTask(n, { type: 'wander', to: { x: r.door.x + nx * 0.7, z: r.door.z + nz * 0.7 }, dur: COME_OUT_S });
    // (woken for this)
    n.attitude = Math.max(-1, n.attitude - 0.05);
    T.say(n, pickOf(COME_OUT_LINES), { big: true });
    T.feedLine(`🚪 ${firstName(n.name)} came to the door.`);
    return true;
  };
  // A lock-pick at a locked door: the lockpick minigame, the pick used up either way; in, it's a
  // break-in if anyone sees
  const pickDoor = (key) => {
    if (T.lockpicks <= 0 || T.lockpick.isOpen()) return;
    T.lockpicks -= 1;
    T.doorPick = key;
    T.actsAt = 0;
    T.lockpick.start((success) => {
      T.doorPick = null;
      if (!success) { T.feedLine('🔧 Snap — the lock-pick broke.'); T.save(); return; }
      const victim = residents(homeOfRoom(key))[0] ?? null;
      T.crime('theft', victim);
      if (T.law.stars > 0) { T.feedLine('🔧 The lock gave — but you were seen.'); T.save(); return; }
      T.feedLine('🔓 Click. You slip inside.');
      T.enterRoom(key, { forced: true });
      T.save();
    });
  };
  const buyHouse = () => {
    const i = myHome();
    const h = T.houses[i];
    if (!h || h.b) return;
    if (ctx.getCoins() < HOUSE_PRICE) { T.feedLine(`🏠 You need ${HOUSE_PRICE} 🪙 for the house.`); return; }
    ctx.addCoins(-HOUSE_PRICE);
    h.b = true;
    T.homeBought = true;
    if (T.netMode === 'client') T.net.send(T.net.hostId(), { w: 1, op: 'buyHome', k: myKey() });
    broadcastHouses();
    ctx.showBanner('HOME SWEET HOME', 'Your things are safe in the chest inside', 2600);
    T.feedLine('🏠 The house is yours. Keep what doesn\'t fit in your bag in the chest.');
    T.actsAt = 0;
    T.save();
  };

  // ── The bag, the wallet, the chest ──
  const bagCount = () => GOOD_IDS.reduce((s, g) => s + T.goods[g], 0);
  const bagRoom = () => Math.max(0, BAG_MAX - bagCount());
  let fullNoteAt = -1e9;
  const bagFullNote = () => {
    if (T.simT - fullNoteAt < 5) return;
    fullNoteAt = T.simT;
    T.feedLine(`🎒 Your bag's full (${BAG_MAX}) — sell some, or keep it in your chest at home.`);
  };
  const chestModel = () => ({
    title: '📦 Your chest',
    wallet: ctx.getCoins(),
    walletMax: WALLET_MAX,
    bag: bagCount(),
    bagMax: BAG_MAX,
    stored: T.store.coins,
    goods: GOOD_IDS.filter((g) => !GOODS[g].cooked || T.goods[g] > 0 || T.store.goods[g] > 0).map((g) => ({
      id: g, emoji: GOODS[g].emoji, label: GOODS[g].label, have: T.goods[g], stored: T.store.goods[g],
    })),
  });
  // n > 0: into the chest; n < 0: out of it (what fits)
  const moveToChest = (id, n) => {
    if (!atChest()) { storage.close(); return; }
    if (id === 'coins') {
      const amt = n > 0 ? Math.min(n, ctx.getCoins()) : -Math.min(-n, T.store.coins, Math.max(0, WALLET_MAX - ctx.getCoins()));
      if (!amt) return;
      ctx.addCoins(-amt);
      T.store.coins += amt;
    } else if (GOODS[id]) {
      const amt = n > 0 ? Math.min(n, T.goods[id]) : -Math.min(-n, T.store.goods[id], bagRoom());
      if (!amt) return;
      T.goods[id] -= amt;
      T.store.goods[id] += amt;
      T.renderGoods();
    }
    storage.render(chestModel());
    T.save();
  };
  const atChest = () => {
    if (!T.inRoom || homeOfRoom(T.inRoom) < 0) return false;
    const c = T.rooms.chestSpot(T.inRoom);
    const p = T.playerPos();
    return !!c && dist2(p.x, p.z, c.x, c.z) < CHEST_ACT_DIST;
  };
  const openChest = () => {
    const i = homeOfRoom(T.inRoom);
    const h = T.houses[i];
    if (!h || h.k !== myKey()) { T.feedLine(`🔒 ${h?.n ? `${h.n}'s` : 'Their'} chest is locked tight.`); return; }
    storage.open(chestModel());
  };

  // ── Buttons ──
  // At a locked door outside: buy (the player's house), knock, pick the lock
  const doorActs = () => {
    if (T.inRoom || T.jail || T.lockpick.isOpen()) return [];
    const key = T.nearDoor(DOOR_ACT_DIST);
    if (!key) return [];
    const a = doorAccess(key);
    if (a.open) return [];
    const out = [];
    if (a.why === 'forSale') out.push({ key: 'buyhouse', label: `🏠 Buy house · ${HOUSE_PRICE} 🪙`, onClick: buyHouse });
    if (a.why === 'night' && !T.knock && T.simT - (T.knockedAt[key] ?? -1e9) >= KNOCK_AGAIN_S) {
      out.push({ key: `knock:${key}`, label: '✊ Knock', onClick: () => knock(key) });
    }
    if (a.why !== 'forSale' && T.lockpicks > 0) out.push({ key: `lockpick:${key}`, label: `🔧 Pick the lock (${T.lockpicks})`, onClick: () => pickDoor(key) });
    return out;
  };
  // Inside a home, by its chest
  const chestActs = () => (atChest() && !storage.isOpen() ? [{ key: 'chest', label: '📦 Chest', onClick: openChest }] : []);

  // In the player's own home, by the bed: sleep till night / till morning (the clock jumps — not
  // in a shared town, whose clock is everyone's — and the player wakes up rested, at full health)
  const atBed = () => {
    if (!T.inRoom || homeOfRoom(T.inRoom) < 0 || homeOfRoom(T.inRoom) !== myHome()) return false;
    const b = T.rooms.bedside(T.inRoom);
    const p = T.playerPos();
    return !!b && dist2(p.x, p.z, b.x, b.z) < BED_ACT_DIST;
  };
  const sleepInBed = (untilH) => {
    if (T.sequence || !atBed()) return;
    if (T.law.stars > 0) { T.feedLine('😬 Too wound up to sleep with the guards after you.'); return; }
    const token = {};
    T.sequence = token;
    T.storage.close();
    T.fadeTo(true);
    setTimeout(() => {
      if (!T.active || T.sequence !== token) return;
      const shared = T.mp();
      if (!shared) T.advanceClock(((untilH - T.hour() + 24) % 24 || 24) * 60);
      const { health, max } = ctx.getHealth();
      if (max > health) ctx.heal(max - health);
      T.feedLine(shared ? '😴 You nap a while and wake up rested. (The town\'s clock is everyone\'s — it didn\'t wait.)'
        : untilH === WAKE_HOUR ? '☀️ Good morning! You wake up rested.' : '🌙 You wake up as night falls, rested.');
      T.save();
      setTimeout(() => {
        if (T.sequence === token) T.sequence = null;
        T.fadeTo(false);
        T.actsAt = 0;
      }, 600);
    }, 900);
  };
  const bedActs = () => {
    if (!atBed() || T.storage.isOpen()) return [];
    const out = [];
    const h = T.hour();
    // (till night only by day — from evening on, it's till morning)
    if (h >= WAKE_HOUR && h < NIGHT_FROM_H - 0.5) out.push({ key: 'sleepnight', label: '🌙 Sleep till night', onClick: () => sleepInBed(NIGHT_FROM_H) });
    out.push({ key: 'sleepmorning', label: '☀️ Sleep till morning', onClick: () => sleepInBed(WAKE_HOUR) });
    return out;
  };

  // ── Each frame ──
  const updateHomes = () => {
    if (T.knock && T.simT - T.knock.at > KNOCK_S) {
      const { key } = T.knock;
      T.knock = null;
      // (walked off meanwhile: nobody to answer to)
      if (T.nearDoor(DOOR_ACT_DIST + 1.5) === key) answerKnock(key);
      T.actsAt = 0;
    }
    if (T.doorPick && T.lockpick.isOpen() && T.nearDoor(DOOR_ACT_DIST + 1) !== T.doorPick) {
      T.lockpick.stop();
      T.feedLine('🔧 You walked off — the lock-pick snapped in the lock.');
    }
    if (T.doorPick && !T.lockpick.isOpen()) T.doorPick = null;
    if (storage.isOpen() && !atChest()) storage.close();
    updateSign();
  };
  // Over the player's house's door: for sale / home
  const updateSign = () => {
    const i = myHome();
    const r = i >= 0 ? P().rooms[roomOf(i)] : null;
    const text = !r ? '' : T.houses[i].b ? '🏠 Home' : `🏠 For sale · ${HOUSE_PRICE} 🪙`;
    if (text === signText) return;
    signText = text;
    if (sign) { sign.parent?.remove(sign); sign.material.map?.dispose(); sign.material.dispose(); sign = null; }
    if (!r) return;
    sign = makeTextSprite(text, { height: 0.32 });
    sign.position.set(r.door.x, T.groundAt(r.door.x, r.door.z, 0) + 2.6, r.door.z);
    T.root.add(sign);
  };
  const resetHomes = () => {
    storage.close();
    T.knock = null;
    T.doorPick = null;
    if (sign) { sign.parent?.remove(sign); sign.material.map?.dispose(); sign.material.dispose(); sign = null; }
    signText = '';
  };
  const homesSnapshot = () => ({
    store: { coins: T.store.coins, goods: { ...T.store.goods } },
    lockpicks: T.lockpicks,
    homeBought: T.homeBought,
  });

  // (a later full town from the host: its houses, quietly)
  const applyHouses = (h) => { T.houses = cleanHouses(h); };

  Object.assign(T, {
    applyHouses, bagCount, bagFullNote, bagRoom, bedActs, chestActs, doorAccess, doorActs, freeHome, handleHomesNet, homesSnapshot,
    lockedNote, myHome, reserveFirst, resetHomes, restoreHomes, settleAfterSpawn, storage, updateHomes,
  });
}

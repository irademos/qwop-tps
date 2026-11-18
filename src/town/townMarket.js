// Town: the market — selling spots open to whoever stands at one: two market stalls outside the
// shop, either side of its door (townLayout.js places.marketStalls, built by townStalls.js
// buildMarket), and three along each of the shop's side counters (townStalls.js SHOP_SELL_SPOTS,
// inside its room). A spot shows only what whoever's at it sells; an empty one shows nothing.
//   • Sellers: each producer sells their own good (townEconomy.js SELLER_GOOD — the fisher fish,
//     the farmer veg, the woodcutter wood) out of what they carry (n.carry), and the gear of their
//     trade (SELLER_GEAR — the fisher rods, the farmer seeds), at set prices, in their selling
//     hours (ROLES sellHours — fish in the morning, veg in the afternoon, so there's always some
//     food), as long as they've goods. Two spots are kept free for the player and at most
//     SAME_GOOD_MAX of them sell the same good at once.
//   • The player buys at a seller's spot (Buy from <name> / tapping a thing on it — the buy card)
//     or by talking to them anywhere (Buy / Sell in the talk box — townActs.js), and sells a seller
//     their own good back for less (buyBackPrice).
//   • The player's stand: at a free spot, Sell here — while they stay there, townsfolk who want
//     food / firewood come to it like to anyone's; each one asks the player (the talk box: Sell /
//     No — offers), and one turned down keeps away a while. Walking off packs up.
//   • Shared town: buying / selling with a townsperson goes to the host ('trade' — townWire.js);
//     a stand is told to everyone ('stand'); the host's townsfolk at another player's stand ask
//     that player ('standAsk' → 'standAns').

import { GOODS, GOOD_IDS, FOOD_IDS, RAW_IDS, SELLER_GEAR, SELLER_GOOD, SHOP_GEAR, buyBackPrice, goodPrice } from './townEconomy.js';
import { firstName } from './townPeople.js';
import { SHOP_SELL_SPOTS } from './townStalls.js';
import {
  CARRY_MAX, DECLINED_S, FRIEND_ATTITUDE, FRIEND_DISCOUNT, GRUDGE_ATTITUDE, OFFER_WAIT_S, STALL_BUY_DIST,
  STALL_KEEPER_DIST, STAND_ACT_DIST, STAND_LEAVE_DIST, dist2, inHours, pickOf,
} from './townConfig.js';

const SAME_GOOD_MAX = 2;      // sellers of one good at the spots at once
const KEEP_FREE = 2;          // spots the townsfolk leave for the player
const DISPLAY_EVERY_S = 0.3;  // s between refreshing the spots' signs / counters
const INDOOR_ACT_DIST = 0.9;  // m from an indoor spot's keeper place — Sell here (they're close together)
const GEAR_STOCK = 99;        // (a seller's gear: always in stock)
// How a customer asks for one (else 'a <label>')
const ONE_OF = { wood: 'some firewood', crops: 'some veg', stew: 'a bowl of stew' };

// T: the town's shared state + functions (createTownMode in townMode.js); ctx: the game
export function installTownMarket(T, ctx) {
  T.stand = null;             // { key } — the player's open stand
  T.remoteStands = {};        // spot key → { peer, name, goods: { g: n } } — other players' (shared town)
  let displayAt = 0;
  let lastStandGoods = '';
  let spotsCache = null;
  const offers = [];          // customers waiting to ask the player: { n, g, price, t?, remote?, expires }
  let offerOpen = null;

  // ── The spots: { key, indoor, room, x, z (its middle), keeper, customer } (world) ──
  const spots = () => {
    if (spotsCache || !T.layout) return spotsCache ?? [];
    const out = (T.layout.places.marketStalls ?? []).map((st) => ({ ...st, indoor: false, room: null }));
    for (const sp of SHOP_SELL_SPOTS) {
      const c = T.rooms.toWorld('shop', sp.center);
      out.push({
        key: sp.key, indoor: true, room: 'shop', x: c.x, z: c.z,
        keeper: T.rooms.toWorld('shop', sp.keeper), customer: T.rooms.toWorld('shop', sp.customer),
      });
    }
    spotsCache = out;
    return out;
  };
  const spotByKey = (key) => spots().find((s) => s.key === key) ?? null;
  const isMarketKey = (key) => typeof key === 'string' && (key.startsWith('mkt') || SHOP_SELL_SPOTS.some((s) => s.key === key));
  const sellerGood = (n) => SELLER_GOOD[n.role] ?? null;
  const sellerGear = (n) => SELLER_GEAR[n.role] ?? [];
  const sameRoom = (sp) => (sp.room ?? null) === (T.inRoom ?? null);

  // ── Who's selling where ──
  // A townsperson at their spot (theirs: the task; someone else's game's: where they stand + the wire's flag)
  const sellingAt = (n, sp) => {
    if (!n.alive || n.fighter || n.inside || n.dying || !sellerGood(n)) return false;
    if (T.mine(n)) return n.task?.type === 'sell' && n.task.phase === 'do' && n.task.stall === sp.key;
    return !!n.netSelling && dist2(n.x, n.z, sp.keeper.x, sp.keeper.z) < STALL_KEEPER_DIST * 2;
  };
  // → { player: true } | { remote } | { npc } | null
  const stallSeller = (key) => {
    if (T.stand?.key === key) return { player: true };
    if (T.remoteStands[key]) return { remote: T.remoteStands[key] };
    const sp = spotByKey(key);
    if (!sp) return null;
    const n = T.npcs.find((m) => sellingAt(m, sp));
    return n ? { npc: n } : null;
  };
  // What a seller has there: { id: count } (goods; a seller's gear too)
  const stockOf = (seller) => {
    if (!seller) return {};
    if (seller.player) return Object.fromEntries(GOOD_IDS.filter((g) => T.goods[g] > 0).map((g) => [g, T.goods[g]]));
    if (seller.remote) return { ...(seller.remote.goods ?? {}) };
    const n = seller.npc;
    const g = sellerGood(n);
    const out = g && n.carry[g] > 0 ? { [g]: n.carry[g] } : {};
    for (const id of sellerGear(n)) out[id] = GEAR_STOCK;
    return out;
  };
  // Someone's headed to / at that spot (a townsperson's sell task holds it on the way)
  const stallTaken = (key, except = null) => T.stand?.key === key || !!T.remoteStands[key]
    || T.npcs.some((m) => m !== except && m.alive && m.task?.type === 'sell' && m.task.stall === key);

  // ── Sellers ──
  const wantsToSell = (n) => {
    const g = sellerGood(n);
    return !!g && !!n.def.sellHours && inHours(T.hour(), n.def.sellHours) && n.carry[g] > 0;
  };
  // A free spot for a seller (the nearest), or null
  const freeStallFor = (n) => {
    const list = spots();
    const g = sellerGood(n);
    if (list.filter((s) => stallTaken(s.key, n)).length >= list.length - KEEP_FREE) return null;
    if (T.npcs.filter((m) => m !== n && m.alive && m.task?.type === 'sell' && sellerGood(m) === g).length >= SAME_GOOD_MAX) return null;
    let best = null;
    let bd = Infinity;
    for (const s of list) {
      if (stallTaken(s.key, n)) continue;
      const d = dist2(n.x, n.z, s.x, s.z);
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  };
  // (townLife.js doActivity: a seller sold out of their good, or the spot taken from under them, packs up)
  const sellerDone = (n, t) => {
    const g = sellerGood(n);
    return !g || n.carry[g] <= 0 || T.stand?.key === t.stall || !!T.remoteStands[t.stall];
  };
  // A stint of work made goods: kept to sell (up to CARRY_MAX)
  const addMade = (n, g, k) => { n.carry[g] = Math.min(CARRY_MAX, (n.carry[g] || 0) + k); };

  // ── Townsfolk shopping ──
  // The spot a townsperson would buy from (food — or wood: kind), or null: the nearest with
  // something they can afford; one who likes the player goes to the player's stand first, one the
  // player turned away lately keeps off it
  const sourceFor = (n, kind) => {
    let best = null;
    let bs = Infinity;
    for (const sp of spots()) {
      const seller = stallSeller(sp.key);
      if (!seller || seller.npc === n) continue;
      if ((seller.player || seller.remote) && T.simT - (n.declinedAt ?? -1e9) < DECLINED_S) continue;
      const stock = stockOf(seller);
      const goods = (kind === 'food' ? FOOD_IDS : ['wood']).filter((g) => stock[g] > 0 && n.money >= goodPrice(g));
      if (!goods.length) continue;
      let score = dist2(n.x, n.z, sp.x, sp.z);
      if (seller.player && n.attitude > 0.3) score -= 15;
      if (score < bs) {
        bs = score;
        // (the cheapest of what's there — cooked food if the townsperson's flush)
        const g = [...goods].sort((a, b) => goodPrice(a) - goodPrice(b))[n.money > 40 ? goods.length - 1 : 0];
        best = { stall: sp, g };
      }
    }
    return best;
  };
  const foodSourceFor = (n) => sourceFor(n, 'food');
  const woodSourceFor = (n) => sourceFor(n, 'wood');
  // (what buying it does for them)
  const bought = (n, type) => {
    if (type === 'buyWood') n.woodDay = T.clock.day;
    else n.needs.hunger = 0;
  };
  // A townsperson got to a spot (townLife.js onArrive — eat / buyWood): buys one from whoever's
  // there — the player (or another player) is asked first
  const buyAtStall = (n, t) => {
    const seller = stallSeller(t.stall);
    const stock = stockOf(seller);
    const want = t.type === 'buyWood' ? ['wood'] : FOOD_IDS;
    const g = stock[t.g] > 0 ? t.g : want.find((x) => stock[x] > 0);
    if (!seller || !g || n.money < goodPrice(g)) {
      T.say(n, t.type === 'buyWood' ? 'No wood? I\'ll burn the furniture, then.' : 'Sold out?! I\'m starving…');
      return;
    }
    const price = goodPrice(g);
    if (seller.npc) {
      n.money -= price;
      seller.npc.carry[g] -= 1;
      seller.npc.money += price;
      bought(n, t.type);
      T.say(n, pickOf([`One ${GOODS[g].label.toLowerCase()}, please.`, `${GOODS[g].label}! Just what I needed.`]));
      setTimeout(() => { if (T.active && seller.npc.alive) T.say(seller.npc, `That's ${price} coins. Enjoy!`); }, 900);
      return;
    }
    // (a player's: they wait for an answer)
    t.dur = t.t + OFFER_WAIT_S;
    t.waiting = true;
    if (seller.player) askPlayer(n, g, t);
    else T.net.send(seller.remote.peer, { w: 1, op: 'standAsk', k: t.stall, g, p: price, id: n.id });
  };
  const buyFood = (n, t) => buyAtStall(n, t);
  const buyWood = (n, t) => buyAtStall(n, t);
  // (a townsperson waiting at a player's spot: done waiting)
  const endWait = (n, t) => { if (n.task === t) t.t = t.dur; };

  // ── A customer asking the player (the talk box: Sell / No) ──
  const askPlayer = (n, g, t = null, remote = null) => {
    if (offers.some((o) => o.n === n) || offerOpen?.n === n) return;
    offers.push({ n, g, price: goodPrice(g), t, remote, expires: T.simT + OFFER_WAIT_S });
    showNextOffer();
  };
  const offerLive = (o) => o.n.alive && T.simT < o.expires && (!o.t || o.n.task === o.t) && !!T.stand;
  const showNextOffer = () => {
    if (offerOpen || T.jobTalk.isOpen()) return;
    while (offers.length) {
      const o = offers.shift();
      if (!offerLive(o)) { if (o.remote) answerRemote(o, false); continue; }
      const g = T.goods[o.g] > 0 ? o.g : (o.t?.type === 'buyWood' ? null : FOOD_IDS.find((x) => T.goods[x] > 0));
      if (!g) { answer(o, false, { quiet: true }); continue; }
      o.g = g;
      o.price = goodPrice(g);
      offerOpen = o;
      T.talking = { npc: o.n, reach: 5 };
      const label = ONE_OF[g] ?? `a ${GOODS[g].label.toLowerCase()}`;
      T.jobTalk.open({
        who: firstName(o.n.name), sub: 'Wants to buy',
        text: pickOf([`Could I buy ${label}? ${o.price} coins.`, `I'd love ${label}, ${ctx.getPlayerName()}. ${o.price} coins?`, `${label[0].toUpperCase()}${label.slice(1)}, please — ${o.price} coins?`]),
        choices: [
          { label: `Sell ${GOODS[g].emoji} (${o.price} 🪙)`, primary: true, act: true, onClick: () => answer(o, true) },
          { label: 'No, sorry', act: true, onClick: () => answer(o, false) },
        ],
      });
      return;
    }
  };
  const answer = (o, ok, { quiet = false } = {}) => {
    if (offerOpen === o) offerOpen = null;
    const n = o.n;
    const sold = ok && n.alive && T.goods[o.g] > 0;
    if (sold) {
      T.goods[o.g] -= 1;
      T.renderGoods();
      ctx.addCoins(o.price);
      ctx.playSfx?.('coin');
      T.feedLine(`Sold ${GOODS[o.g].emoji} ${GOODS[o.g].label.toLowerCase()} to ${firstName(n.name)}. +${o.price} coins`);
      T.remember(n, 'customer');
      T.introNote('sell');
      if (!o.remote && T.mine(n)) { n.money = Math.max(0, n.money - o.price); bought(n, o.t?.type); }
      T.say(n, pickOf(['Thank you!', 'Lovely, thanks.', 'Just what I wanted.']));
      if (!GOOD_IDS.some((x) => T.goods[x] > 0)) T.feedLine('You\'ve sold out.');
    } else {
      n.declinedAt = T.simT;
      if (!quiet && n.alive) T.say(n, pickOf(['Oh. Never mind, then.', 'Fine. I\'ll go elsewhere.', 'Suit yourself.']));
    }
    if (o.remote) answerRemote(o, sold);
    else if (o.t) endWait(n, o.t);
    // (the next one in line)
    if (!T.jobTalk.isOpen()) T.talking = null;
    setTimeout(() => { if (T.active) showNextOffer(); }, 0);
  };
  const answerRemote = (o, ok) => {
    T.net?.send(o.remote.from, { w: 1, op: 'standAns', id: o.n.id, ok: ok ? 1 : 0, p: o.price, g: o.g });
  };

  // ── The player and a seller (the buy card at their spot, the talk box anywhere) ──
  const shuns = (n) => n.attitude < GRUDGE_ATTITUDE;
  const buyPrice = (n, g) => Math.max(1, Math.round(goodPrice(g) * (n.attitude >= FRIEND_ATTITUDE ? 1 - FRIEND_DISCOUNT : 1)));
  const sellPrice = (n, g) => Math.max(1, Math.round(buyBackPrice(g) * (n.attitude >= FRIEND_ATTITUDE ? 1 + FRIEND_DISCOUNT : 1)));
  // (a client's trade goes to the host, who keeps everyone's purse and stock)
  const tellTrade = (n, g, d, cash) => {
    if (T.netMode === 'client') T.net.send(T.net.hostId(), { w: 1, op: 'trade', id: n.id, g, d, cash });
  };
  const playerBuy = (n, g) => {
    const price = buyPrice(n, g);
    if (!n.alive || shuns(n) || n.carry[g] <= 0 || ctx.getCoins() < price || T.bagRoom() <= 0) return false;
    ctx.addCoins(-price);
    n.money += price;
    n.carry[g] -= 1;
    tellTrade(n, g, -1, price);
    T.gain(g);
    T.remember(n, 'customer');
    T.feedLine(`Bought ${GOODS[g].emoji} ${GOODS[g].label.toLowerCase()} from ${firstName(n.name)}.`);
    return true;
  };
  // A seller's gear (a rod, seeds): the money's theirs
  const gearOf = (id) => SHOP_GEAR.find((x) => x.id === id);
  const gearBlock = (n, id) => (shuns(n) ? `${firstName(n.name)} won’t sell to you` : T.gearState(SHOP_GEAR, id).blocked);
  const playerBuyGear = (n, id) => !gearBlock(n, id) && T.buyGear('shop', id, n);
  // (why the player can't sell a seller their good, or null)
  const sellBlock = (n, g) => {
    if (shuns(n)) return `${firstName(n.name)} won't trade with you`;
    if (T.goods[g] <= 0) return `You've no ${GOODS[g].label.toLowerCase()}`;
    if (n.money < sellPrice(n, g)) return `${firstName(n.name)} can't afford it`;
    if (n.carry[g] >= CARRY_MAX) return `${firstName(n.name)} has plenty`;
    return null;
  };
  const playerSell = (n, g) => {
    if (!n.alive || sellBlock(n, g)) return false;
    const price = sellPrice(n, g);
    T.goods[g] -= 1;
    T.renderGoods();
    n.carry[g] += 1;
    n.money -= price;
    tellTrade(n, g, 1, -price);
    ctx.addCoins(price);
    ctx.playSfx?.('coin');
    T.remember(n, 'customer');
    T.introNote('sell');
    T.feedLine(`Sold ${GOODS[g].emoji} ${GOODS[g].label.toLowerCase()} to ${firstName(n.name)}. +${price} coins`);
    return true;
  };
  // The talk box's trade buttons for a seller (townActs.js chat): Buy / Sell their good, Buy
  // their gear (reopen: shows the talk again after a trade)
  const tradeChoices = (n, reopen) => {
    const g = sellerGood(n);
    if (!g || n.fear > 0) return [];
    const out = [];
    if (n.carry[g] > 0) {
      out.push({
        label: `Buy ${GOODS[g].label.toLowerCase()} (${buyPrice(n, g)} 🪙)`, act: true,
        onClick: () => {
          const ok = playerBuy(n, g);
          if (ok) ctx.playSfx?.('buy');
          reopen(ok ? 'Pleasure.' : shuns(n) ? 'Not to you.' : n.carry[g] <= 0 ? 'That was my last one.'
            : T.bagRoom() <= 0 ? 'Your bag\'s full, friend.' : 'You can\'t afford it.');
        },
      });
    }
    for (const id of sellerGear(n)) {
      const item = gearOf(id);
      if (!item || T.gearState(SHOP_GEAR, id).blocked) continue;
      out.push({
        label: `Buy ${item.label.toLowerCase()} (${item.price} 🪙)`, act: true,
        onClick: () => {
          const ok = playerBuyGear(n, id);
          if (ok) ctx.playSfx?.('buy');
          reopen(ok ? (id === 'rod' ? 'Tight lines!' : 'Water them and they come up quick.') : shuns(n) ? 'Not to you.' : 'You can\'t afford it.');
        },
      });
    }
    if (T.goods[g] > 0) {
      out.push({
        label: `Sell ${GOODS[g].label.toLowerCase()} (${sellPrice(n, g)} 🪙)`, act: true,
        onClick: () => {
          const why = sellBlock(n, g);
          reopen(playerSell(n, g) ? `I'll take that. ${GOODS[g].emoji}` : why ? `${why.replace(`${firstName(n.name)} `, 'I ')}.` : 'No thanks.');
        },
      });
    }
    return out;
  };
  // The buy card for a thing on a spot (townStalls.js getState)
  const marketItemState = (key, id) => {
    const seller = stallSeller(key);
    const n = seller?.npc ?? null;
    if (!GOODS[id]) {
      const g = T.gearState(SHOP_GEAR, id);
      return { ...g, blocked: !n ? 'Nobody’s selling' : gearBlock(n, id) };
    }
    const g = GOODS[id];
    const stock = stockOf(seller);
    const price = n ? buyPrice(n, id) : goodPrice(id);
    return {
      name: g.label,
      desc: `${stock[id] ?? 0} left${g.food ? ` · eat it for +${g.heal} health` : ''}${n && n.attitude >= FRIEND_ATTITUDE ? ' · friend\'s price' : ''}`,
      owned: `You have ${T.goods[id]}`,
      price,
      blocked: seller?.player ? 'Your own stall' : !n ? 'Nobody’s selling' : shuns(n) ? `${firstName(n.name)} won’t sell to you`
        : !(stock[id] > 0) ? 'Sold out' : T.bagRoom() <= 0 ? 'Your bag is full' : null,
    };
  };
  const marketBuy = (key, id) => {
    const n = stallSeller(key)?.npc;
    if (!n) return { ok: false };
    return { ok: GOODS[id] ? playerBuy(n, id) : playerBuyGear(n, id) };
  };
  // A spot the player's in front of, with a seller at it (Buy from <name>)
  const stallInFront = () => {
    const p = T.playerPos();
    let best = null;
    let bd = STALL_BUY_DIST;
    for (const sp of spots()) {
      if (!sameRoom(sp)) continue;
      const d = dist2(p.x, p.z, sp.customer.x, sp.customer.z);
      if (d > bd) continue;
      const s = stallSeller(sp.key);
      if (s?.npc) { bd = d; best = { sp, n: s.npc }; }
    }
    return best;
  };
  // (the buy card / taps: someone selling, the player near it)
  const marketCanShop = (key) => !!stallSeller(key)?.npc;
  const marketCanTap = (key) => {
    const sp = spotByKey(key);
    if (!sp || !sameRoom(sp)) return false;
    const p = T.playerPos();
    return dist2(p.x, p.z, sp.x, sp.z) < 4.5 && !!stallSeller(key)?.npc;
  };

  // ── The player's stand ──
  const standNear = () => {
    if (T.stand) return null;
    const p = T.playerPos();
    let best = null;
    let bd = Infinity;
    for (const sp of spots()) {
      if (!sameRoom(sp)) continue;
      const d = dist2(p.x, p.z, sp.keeper.x, sp.keeper.z);
      if (d < (sp.indoor ? INDOOR_ACT_DIST : STAND_ACT_DIST) && d < bd) { bd = d; best = sp; }
    }
    return best;
  };
  const standGoods = () => Object.fromEntries(GOOD_IDS.filter((g) => T.goods[g] > 0).map((g) => [g, T.goods[g]]));
  const tellStand = () => {
    if (!T.mp()) return;
    const msg = { w: 1, op: 'stand', k: T.stand?.key ?? null, n: ctx.getPlayerName(), g: T.stand ? standGoods() : null };
    if (T.netMode === 'host') T.net.broadcast(msg);
    else T.net.send(T.net.hostId(), msg);
    lastStandGoods = JSON.stringify(msg.g);
  };
  const openStand = (sp) => {
    if (stallSeller(sp.key)) { T.feedLine('Someone\'s selling there already.'); return; }
    if (!GOOD_IDS.some((g) => T.goods[g] > 0)) { T.feedLine('You\'ve nothing to sell — bring fish, veg, wood or some cooking.'); return; }
    T.fishing = null;
    T.stand = { key: sp.key };
    tellStand();
    T.feedLine('You\'re selling. Wait here — townsfolk come up and ask to buy.');
    T.actsAt = 0;
  };
  const closeStand = (why = null) => {
    if (!T.stand) return;
    T.stand = null;
    tellStand();
    if (offerOpen) { const o = offerOpen; offerOpen = null; T.jobTalk.close(); if (o.remote) answerRemote(o, false); else if (o.t) endWait(o.n, o.t); }
    if (why) T.feedLine(why);
    T.actsAt = 0;
  };
  const marketActs = () => {
    const out = [];
    if (T.stand) {
      out.push({ key: 'packup', label: 'Pack up', onClick: () => closeStand('You packed up.') });
      return out;
    }
    const front = stallInFront();
    if (front) out.push({ key: `stallbuy:${front.sp.key}`, label: `Buy from ${firstName(front.n.name)}`, onClick: () => T.focusStall(front.sp.key) });
    const sp = standNear();
    if (sp && !stallSeller(sp.key)) out.push({ key: 'stand', label: 'Sell here', onClick: () => openStand(sp) });
    return out;
  };

  // ── Each frame (townMode.js update) ──
  const updateMarket = () => {
    if (T.stand) {
      const sp = spotByKey(T.stand.key);
      const p = T.playerPos();
      if (!sp || !sameRoom(sp) || T.jail || T.sequence || ctx.isPlayerDead()) closeStand();
      else if (dist2(p.x, p.z, sp.keeper.x, sp.keeper.z) > STAND_LEAVE_DIST) closeStand('You walked off — packed up.');
      else if (T.mp() && JSON.stringify(standGoods()) !== lastStandGoods) tellStand();
    }
    // A customer's question: walked off / closed → no; the customer gone → it's dropped
    if (offerOpen) {
      if (!T.jobTalk.isOpen()) answer(offerOpen, false);
      else if (!offerLive(offerOpen)) { const o = offerOpen; offerOpen = null; T.jobTalk.close(); if (o.remote) answerRemote(o, false); }
    }
    if (!offerOpen && offers.length) showNextOffer();
    if (T.simT < displayAt) return;
    displayAt = T.simT + DISPLAY_EVERY_S;
    // (the weaponsmith's gear and the chest: only while he's at the counter)
    T.stalls.setAllHidden('shop', !T.shopOpen());
    for (const sp of spots()) {
      const seller = stallSeller(sp.key);
      const stock = stockOf(seller);
      T.stalls.setGoods(sp.key, Object.keys(stock).filter((id) => stock[id] > 0));
      T.stalls.setLabel(sp.key, !seller ? (sp.indoor ? 'Free spot' : 'Free stall')
        : seller.player ? 'You'
          : seller.remote ? (seller.remote.name || 'A player')
            : `${firstName(seller.npc.name)} · ${GOODS[sellerGood(seller.npc)].label}`);
    }
  };

  // ── Shared town ('stand', 'standAsk', 'standAns'; 'trade' is townWire.js) ──
  const handleMarketNet = (from, d) => {
    if (d.op === 'stand') {
      // (the host passes a client's on to everyone)
      if (T.netMode === 'host' && from !== T.net.hostId()) T.net.broadcast({ ...d, from });
      const peer = typeof d.from === 'string' && from === T.net.hostId() ? d.from : from;
      if (peer === T.myId()) return true;
      for (const [k, r] of Object.entries(T.remoteStands)) if (r.peer === peer) delete T.remoteStands[k];
      if (isMarketKey(d.k) && spotByKey(d.k)) {
        const goods = {};
        for (const g of GOOD_IDS) if (Number.isFinite(d.g?.[g])) goods[g] = Math.max(0, Math.floor(d.g[g]));
        T.remoteStands[d.k] = { peer, name: typeof d.n === 'string' ? d.n.slice(0, 40) : '', goods };
        // (someone else's there: the player's own stand there can't be)
        if (T.stand?.key === d.k) closeStand('Someone set up at that spot.');
      }
      return true;
    }
    if (d.op === 'standAsk') {
      // The host's townsperson at the player's stand asks to buy
      const n = T.npcs.find((m) => m.id === d.id);
      if (!n || !T.stand || T.stand.key !== d.k || !GOODS[d.g]) {
        T.net.send(from, { w: 1, op: 'standAns', id: d.id, ok: 0 });
        return true;
      }
      askPlayer(n, d.g, null, { from });
      return true;
    }
    if (d.op === 'standAns') {
      // (on the host: a player answered our townsperson)
      const n = T.npcs.find((m) => m.id === d.id);
      if (!n?.alive || !T.mine(n)) return true;
      const t = n.task;
      if (d.ok) {
        n.money = Math.max(0, n.money - Math.max(0, Math.min(50, Number(d.p) || 0)));
        bought(n, t?.type);
        T.say(n, 'Thank you!');
      } else {
        n.declinedAt = T.simT;
        T.say(n, 'Oh. Never mind, then.');
      }
      if (t?.waiting) endWait(n, t);
      return true;
    }
    return false;
  };
  // A player gone from the shared town: their stand with them
  const dropRemoteStands = (peer) => {
    for (const [k, r] of Object.entries(T.remoteStands)) if (!peer || r.peer === peer) delete T.remoteStands[k];
  };

  // ── For jobs / talk: what's short in town (what sellers carry) ──
  const supplyOf = (g) => T.npcs.reduce((sum, n) => sum + (n.alive && sellerGood(n) === g ? n.carry[g] : 0), 0);
  const scarcest = () => {
    const g = [...RAW_IDS].sort((a, b) => supplyOf(a) / GOODS[a].target - supplyOf(b) / GOODS[b].target)[0];
    return supplyOf(g) < GOODS[g].target * 0.25 ? g : null;
  };
  const foodOnSale = () => spots().some((sp) => FOOD_IDS.some((g) => stockOf(stallSeller(sp.key))[g] > 0));
  // (the town's being left: no one waiting on the player)
  const resetMarket = () => {
    offers.length = 0;
    offerOpen = null;
    T.stand = null;
    T.remoteStands = {};
  };

  Object.assign(T, {
    addMade, askPlayer, buyFood, buyWood, closeStand, dropRemoteStands, foodOnSale, foodSourceFor, freeStallFor,
    handleMarketNet, isMarketKey, marketActs, marketBuy, marketCanShop, marketCanTap, marketItemState,
    marketSpots: spots, offerPending: (n) => offerOpen?.n === n || offers.some((o) => o.n === n), resetMarket, scarcest,
    sellerDone, sellerGood, stallByKey: spotByKey, stallSeller, supplyOf, tradeChoices, updateMarket, wantsToSell,
    woodSourceFor,
  });
}

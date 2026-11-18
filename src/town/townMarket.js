// Town: the market — stalls outside the shop (townLayout.js places.marketStalls, built by
// townStalls.js buildMarket), open to whoever stands behind one.
//   • Sellers: each producer sells their own good (townEconomy.js SELLER_GOOD — the fisher fish,
//     the farmer veg, the woodcutter wood) out of what they carry (n.carry), at its set price,
//     in their selling hours (ROLES sellHours — fish in the morning, veg in the afternoon, so
//     there's always some food), as long as they've stock. One stall is kept free for the player
//     and at most SAME_GOOD_MAX of them sell the same good at once.
//   • The player buys at a seller's stall (Buy from <name> / tapping a good on the counter — the
//     buy card) or by talking to them anywhere (Buy / Sell in the talk box — townActs.js), and
//     sells a seller their own good back for less (buyBackPrice).
//   • The player's stand: behind a free stall, Sell here — while they stay there, townsfolk who
//     want food / firewood come to it like to anyone's and buy from the bag. Walking off packs up.
//   • Shared town: buying / selling with a townsperson goes to the host ('trade' — townWire.js);
//     a stand is told to everyone ('stand'); the host's townsfolk buying at another player's
//     stand tell that player ('standBuy').

import { GOODS, GOOD_IDS, FOOD_IDS, RAW_IDS, SELLER_GOOD, buyBackPrice, goodPrice } from './townEconomy.js';
import { firstName } from './townPeople.js';
import {
  CARRY_MAX, FRIEND_ATTITUDE, FRIEND_DISCOUNT, GRUDGE_ATTITUDE, STALL_BUY_DIST, STALL_KEEPER_DIST,
  STAND_ACT_DIST, STAND_LEAVE_DIST, dist2, inHours, pickOf,
} from './townConfig.js';

const SAME_GOOD_MAX = 2;      // sellers of one good at the stalls at once
const DISPLAY_EVERY_S = 0.3;  // s between refreshing the stalls' signs / counters

// T: the town's shared state + functions (createTownMode in townMode.js); ctx: the game
export function installTownMarket(T, ctx) {
  T.stand = null;             // { key } — the player's open stand
  T.remoteStands = {};        // stall key → { peer, name, goods: { g: n } } — other players' (shared town)
  let displayAt = 0;
  let lastStandGoods = '';

  const stallList = () => T.layout?.places.marketStalls ?? [];
  const stallByKey = (key) => stallList().find((s) => s.key === key) ?? null;
  const isMarketKey = (key) => typeof key === 'string' && key.startsWith('mkt');
  const sellerGood = (n) => SELLER_GOOD[n.role] ?? null;

  // ── Who's selling where ──
  // A townsperson at their stall (theirs: the task; someone else's game's: where they stand + the wire's flag)
  const sellingAt = (n, st) => {
    if (!n.alive || n.fighter || n.inside || n.dying || !sellerGood(n)) return false;
    if (T.mine(n)) return n.task?.type === 'sell' && n.task.phase === 'do' && n.task.stall === st.key;
    return !!n.netSelling && dist2(n.x, n.z, st.keeper.x, st.keeper.z) < STALL_KEEPER_DIST * 2;
  };
  // → { player: true } | { remote } | { npc } | null
  const stallSeller = (key) => {
    if (T.stand?.key === key) return { player: true };
    if (T.remoteStands[key]) return { remote: T.remoteStands[key] };
    const st = stallByKey(key);
    if (!st) return null;
    const n = T.npcs.find((m) => sellingAt(m, st));
    return n ? { npc: n } : null;
  };
  // What a seller has on the counter: { g: count }
  const stockOf = (seller) => {
    if (!seller) return {};
    if (seller.player) return Object.fromEntries(GOOD_IDS.filter((g) => T.goods[g] > 0).map((g) => [g, T.goods[g]]));
    if (seller.remote) return { ...(seller.remote.goods ?? {}) };
    const g = sellerGood(seller.npc);
    return g && seller.npc.carry[g] > 0 ? { [g]: seller.npc.carry[g] } : {};
  };
  // Someone's headed to / at that stall (a townsperson's sell task holds it on the way)
  const stallTaken = (key, except = null) => T.stand?.key === key || !!T.remoteStands[key]
    || T.npcs.some((m) => m !== except && m.alive && m.task?.type === 'sell' && m.task.stall === key);

  // ── Sellers ──
  const wantsToSell = (n) => {
    const g = sellerGood(n);
    return !!g && !!n.def.sellHours && inHours(T.hour(), n.def.sellHours) && n.carry[g] > 0;
  };
  // A free stall for a seller (the nearest), or null: one is always left for the player, and no
  // more than SAME_GOOD_MAX sell one good
  const freeStallFor = (n) => {
    const list = stallList();
    const g = sellerGood(n);
    if (list.filter((s) => stallTaken(s.key, n)).length >= list.length - 1) return null;
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
  // (townLife.js doActivity: a seller sold out, or the stall taken from under them, packs up)
  const sellerDone = (n, t) => {
    const g = sellerGood(n);
    return !g || n.carry[g] <= 0 || T.stand?.key === t.stall || !!T.remoteStands[t.stall];
  };
  // A stint of work made goods: kept to sell (up to CARRY_MAX)
  const addMade = (n, g, k) => { n.carry[g] = Math.min(CARRY_MAX, (n.carry[g] || 0) + k); };

  // ── Townsfolk shopping ──
  // The stall a townsperson would buy from (food — or wood: kind), or null: the nearest with
  // something they can afford; one who likes the player goes to the player's stand first
  const sourceFor = (n, kind) => {
    let best = null;
    let bs = Infinity;
    for (const st of stallList()) {
      const seller = stallSeller(st.key);
      if (!seller || seller.npc === n) continue;
      const stock = stockOf(seller);
      const goods = (kind === 'food' ? FOOD_IDS : ['wood']).filter((g) => stock[g] > 0 && n.money >= goodPrice(g));
      if (!goods.length) continue;
      let score = dist2(n.x, n.z, st.x, st.z);
      if (seller.player && n.attitude > 0.3) score -= 15;
      if (score < bs) {
        bs = score;
        // (the cheapest of what's there — cooked food if the townsperson's flush)
        const g = [...goods].sort((a, b) => goodPrice(a) - goodPrice(b))[n.money > 40 ? goods.length - 1 : 0];
        best = { stall: st, g };
      }
    }
    return best;
  };
  const foodSourceFor = (n) => sourceFor(n, 'food');
  const woodSourceFor = (n) => sourceFor(n, 'wood');
  // A townsperson got to a stall (townLife.js onArrive — eat / buyWood): buys one from whoever's there
  const buyAtStall = (n, t) => {
    const seller = stallSeller(t.stall);
    const stock = stockOf(seller);
    const want = t.type === 'buyWood' ? ['wood'] : FOOD_IDS;
    const g = stock[t.g] > 0 ? t.g : want.find((x) => stock[x] > 0);
    if (!seller || !g || n.money < goodPrice(g)) {
      T.say(n, t.type === 'buyWood' ? 'No wood? I\'ll burn the furniture, then.' : 'Sold out?! I\'m starving…');
      return false;
    }
    const price = goodPrice(g);
    n.money -= price;
    if (seller.npc) {
      seller.npc.carry[g] -= 1;
      seller.npc.money += price;
      T.say(n, pickOf([`One ${GOODS[g].label.toLowerCase()}, please.`, `${GOODS[g].label}! Just what I needed.`]));
      setTimeout(() => { if (T.active && seller.npc.alive) T.say(seller.npc, `That's ${price} coins. Enjoy!`); }, 900);
    } else if (seller.player) {
      T.goods[g] -= 1;
      T.renderGoods();
      ctx.addCoins(price);
      ctx.playSfx?.('coin');
      T.say(n, pickOf([`I'll take a ${GOODS[g].label.toLowerCase()}, ${ctx.getPlayerName()}.`, `One ${GOODS[g].label.toLowerCase()}, please!`]));
      T.feedLine(`${firstName(n.name)} bought ${GOODS[g].emoji} ${GOODS[g].label.toLowerCase()} from your stall. +${price} coins`);
      T.remember(n, 'customer');
      T.introNote('sell');
      if (!GOOD_IDS.some((x) => T.goods[x] > 0)) T.feedLine('Your stall\'s sold out.');
    } else {
      // (another player's stand: theirs to hand over — they're told)
      T.net.send(seller.remote.peer, { w: 1, op: 'standBuy', k: t.stall, g, p: price, id: n.id });
      if (seller.remote.goods?.[g] > 0) seller.remote.goods[g] -= 1;
      T.say(n, `One ${GOODS[g].label.toLowerCase()}, please.`);
    }
    return true;
  };
  const buyFood = (n, t) => { if (buyAtStall(n, t)) n.needs.hunger = 0; };
  const buyWood = (n, t) => { if (buyAtStall(n, t)) n.woodDay = T.clock.day; };

  // ── The player and a seller (the buy card at their stall, the talk box anywhere) ──
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
  // The talk box's trade buttons for a seller (townActs.js chat): Buy / Sell their good
  // (reopen: shows the talk again after a trade)
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
  // The buy card for a good on a market stall's counter (townStalls.js getState)
  const marketItemState = (key, id) => {
    const g = GOODS[id];
    const seller = stallSeller(key);
    const n = seller?.npc ?? null;
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
    return { ok: !!n && playerBuy(n, id) };
  };
  // A stall the player's at the front of, with a seller behind it (Buy from <name>)
  const stallInFront = () => {
    if (T.inRoom) return null;
    const p = T.playerPos();
    for (const st of stallList()) {
      if (dist2(p.x, p.z, st.customer.x, st.customer.z) > STALL_BUY_DIST) continue;
      const s = stallSeller(st.key);
      if (s?.npc) return { st, n: s.npc };
    }
    return null;
  };
  // (the buy card / taps: someone selling, the player out in front of it)
  const marketCanShop = (key) => !!stallSeller(key)?.npc;
  const marketCanTap = (key) => {
    const st = stallByKey(key);
    if (!st || T.inRoom) return false;
    const p = T.playerPos();
    return dist2(p.x, p.z, st.x, st.z) < 4.5 && !!stallSeller(key)?.npc;
  };

  // ── The player's stand ──
  const standNear = () => {
    if (T.inRoom || T.stand) return null;
    const p = T.playerPos();
    return stallList().find((st) => dist2(p.x, p.z, st.keeper.x, st.keeper.z) < STAND_ACT_DIST) ?? null;
  };
  const standGoods = () => Object.fromEntries(GOOD_IDS.filter((g) => T.goods[g] > 0).map((g) => [g, T.goods[g]]));
  const tellStand = () => {
    if (!T.mp()) return;
    const msg = { w: 1, op: 'stand', k: T.stand?.key ?? null, n: ctx.getPlayerName(), g: T.stand ? standGoods() : null };
    if (T.netMode === 'host') T.net.broadcast(msg);
    else T.net.send(T.net.hostId(), msg);
    lastStandGoods = JSON.stringify(msg.g);
  };
  const openStand = (st) => {
    if (stallSeller(st.key)) { T.feedLine('Someone\'s selling there already.'); return; }
    if (!GOOD_IDS.some((g) => T.goods[g] > 0)) { T.feedLine('You\'ve nothing to sell — bring fish, veg, wood or some cooking.'); return; }
    T.fishing = null;
    T.stand = { key: st.key };
    tellStand();
    T.feedLine('Your stall\'s open. Wait here — townsfolk come to buy food and firewood.');
    T.actsAt = 0;
  };
  const closeStand = (why = null) => {
    if (!T.stand) return;
    T.stand = null;
    tellStand();
    if (why) T.feedLine(why);
    T.actsAt = 0;
  };
  const marketActs = () => {
    const out = [];
    if (T.stand) {
      out.push({ key: 'packup', label: 'Pack up', onClick: () => closeStand('You packed up your stall.') });
      return out;
    }
    const front = stallInFront();
    if (front) out.push({ key: `stallbuy:${front.st.key}`, label: `Buy from ${firstName(front.n.name)}`, onClick: () => T.focusStall(front.st.key) });
    const st = standNear();
    if (st && !stallSeller(st.key)) out.push({ key: 'stand', label: 'Sell here', onClick: () => openStand(st) });
    return out;
  };

  // ── Each frame (townMode.js update) ──
  const updateMarket = () => {
    if (T.stand) {
      const st = stallByKey(T.stand.key);
      const p = T.playerPos();
      if (!st || T.inRoom || T.jail || T.sequence || ctx.isPlayerDead()) closeStand();
      else if (dist2(p.x, p.z, st.keeper.x, st.keeper.z) > STAND_LEAVE_DIST) closeStand('You walked off — your stall\'s packed up.');
      else if (T.mp() && JSON.stringify(standGoods()) !== lastStandGoods) tellStand();
    }
    if (T.simT < displayAt) return;
    displayAt = T.simT + DISPLAY_EVERY_S;
    for (const st of stallList()) {
      const seller = stallSeller(st.key);
      const stock = stockOf(seller);
      T.stalls.setGoods(st.key, GOOD_IDS.filter((g) => stock[g] > 0));
      T.stalls.setLabel(st.key, !seller ? 'Free stall'
        : seller.player ? 'Your stall'
          : seller.remote ? `${seller.remote.name || 'A player'}'s stall`
            : `${firstName(seller.npc.name)} · ${GOODS[sellerGood(seller.npc)].label}`);
    }
  };

  // ── Shared town ('stand', 'standBuy'; 'trade' is townWire.js) ──
  const handleMarketNet = (from, d) => {
    if (d.op === 'stand') {
      // (the host passes a client's on to everyone)
      if (T.netMode === 'host' && from !== T.net.hostId()) T.net.broadcast({ ...d, from });
      const peer = typeof d.from === 'string' && from === T.net.hostId() ? d.from : from;
      if (peer === T.myId()) return true;
      for (const [k, r] of Object.entries(T.remoteStands)) if (r.peer === peer) delete T.remoteStands[k];
      if (isMarketKey(d.k) && stallByKey(d.k)) {
        const goods = {};
        for (const g of GOOD_IDS) if (Number.isFinite(d.g?.[g])) goods[g] = Math.max(0, Math.floor(d.g[g]));
        T.remoteStands[d.k] = { peer, name: typeof d.n === 'string' ? d.n.slice(0, 40) : '', goods };
        // (someone else's there: the player's own stand there can't be)
        if (T.stand?.key === d.k) closeStand('Someone set up at that stall.');
      }
      return true;
    }
    if (d.op === 'standBuy') {
      // A townsperson bought from the player's stand (on the host's game)
      if (!T.stand || T.stand.key !== d.k || !GOODS[d.g] || T.goods[d.g] <= 0) return true;
      const price = Math.max(1, Math.min(50, Math.round(Number(d.p) || goodPrice(d.g))));
      T.goods[d.g] -= 1;
      T.renderGoods();
      ctx.addCoins(price);
      ctx.playSfx?.('coin');
      const n = T.npcs.find((m) => m.id === d.id);
      T.feedLine(`${n ? firstName(n.name) : 'Someone'} bought ${GOODS[d.g].emoji} ${GOODS[d.g].label.toLowerCase()} from your stall. +${price} coins`);
      if (n) T.remember(n, 'customer');
      T.introNote('sell');
      return true;
    }
    return false;
  };
  // A player gone from the shared town: their stand with them
  const dropRemoteStands = (peer) => {
    for (const [k, r] of Object.entries(T.remoteStands)) if (!peer || r.peer === peer) delete T.remoteStands[k];
  };

  // ── For jobs / talk: what's short in town (what's on sale at the stalls + carried by sellers) ──
  const supplyOf = (g) => T.npcs.reduce((sum, n) => sum + (n.alive && sellerGood(n) === g ? n.carry[g] : 0), 0);
  const scarcest = () => {
    const g = [...RAW_IDS].sort((a, b) => supplyOf(a) / GOODS[a].target - supplyOf(b) / GOODS[b].target)[0];
    return supplyOf(g) < GOODS[g].target * 0.25 ? g : null;
  };
  const foodOnSale = () => stallList().some((st) => FOOD_IDS.some((g) => stockOf(stallSeller(st.key))[g] > 0));

  Object.assign(T, {
    buyFood, buyWood, closeStand, dropRemoteStands, foodSourceFor, freeStallFor, handleMarketNet, isMarketKey,
    marketActs, marketBuy, marketCanShop, marketCanTap, marketItemState, foodOnSale, scarcest, sellerDone,
    sellerGood, stallByKey, stallSeller, supplyOf, tradeChoices, updateMarket, wantsToSell, woodSourceFor, addMade,
  });
}

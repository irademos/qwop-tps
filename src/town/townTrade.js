// Town: the player's goods and gathering (chop, pick, eat — fishing is townFishing.js), the market — the goods and weapon
// shops (townStalls.js: entering / leaving them, their counters), the sell panel — townsfolk
// buying food and delivering goods, and the stand-ins bullets / bombs / spells hit townsfolk through.

import { FOOD_IDS, GOODS, GOOD_IDS, RAW_IDS, SHOP_GEAR } from './townEconomy.js';
import { SHOUT_EAT_BUY, firstName, shout } from './townPeople.js';
import * as THREE from 'three';
import { createTownStalls } from './townStalls.js';
import {
  CHEST_PRICE, CHOP_HITS, CHOP_REACH, CROP_REGROW_S, FIREWOOD_CHANCE, FRIEND_ATTITUDE, FRIEND_DISCOUNT, GRUDGE_ATTITUDE,
  MARKET_HOURS, PICK_DIST, PRODUCE, SHOP_DOOR_DIST, SHOP_DOOR_ENTER_DIST, TRADE_DIST, TREE_REGROW_S, TREE_WOOD, dist2,
  heightScale, inHours, pickOf, rand,
} from './townConfig.js';

// T: the town's shared state + functions (createTownMode in townMode.js); ctx: the game
export function installTownTrade(T, ctx) {
  // ── The player's goods, gathering and trade ──
  const gain = (g, n = 1) => {
    T.goods[g] += n;
    T.renderGoods();
  };
  // Food for health (the goods pill / 🍽 Eat)
  const eat = (g) => {
    if (!GOODS[g]?.food || T.goods[g] <= 0 || T.sequence || ctx.isPlayerDead()) return;
    const { health, max } = ctx.getHealth();
    if (health >= max) { T.feedLine('❤️ You\'re not hungry.'); return; }
    T.goods[g] -= 1;
    ctx.heal(GOODS[g].heal);
    T.renderGoods();
    T.feedLine(`😋 Ate a ${GOODS[g].label.toLowerCase()}. +${GOODS[g].heal} ❤️`);
  };
  const hurtFood = () => {
    const { health, max } = ctx.getHealth();
    if (health >= max) return null;
    return FOOD_IDS.filter((g) => T.goods[g] > 0).sort((a, b) => GOODS[b].heal - GOODS[a].heal)[0] ?? null;
  };
  // Chop: the sword tip in a trunk (CHOP_HITS hits a log)
  const tryChop = (tip) => {
    const p = T.playerPos();
    for (const t of T.layout.trees) {
      if (dist2(t.x, t.z, p.x, p.z) > 3) continue;
      if (dist2(t.x, t.z, tip.x, tip.z) > CHOP_REACH) continue;
      const gy = T.groundAt(t.x, t.z);
      if (tip.y < gy + 0.1 || tip.y > gy + 2.6) continue;
      if (T.simT - t.hitAt < 0.45) return true;
      t.hitAt = T.simT;
      ctx.playSfx('chop');
      if (t.wood <= 0) {
        T.feedLine('🌳 This tree needs time to grow back.');
        return true;
      }
      t.hits += 1;
      if (t.hits >= CHOP_HITS) {
        t.hits = 0;
        t.wood -= 1;
        if (t.growAt <= T.simT) t.growAt = T.simT + TREE_REGROW_S; // (grows back one at a time)
        gain('wood');
        T.feedLine(`🪵 +1 Wood (${T.goods.wood})`);
      }
      return true;
    }
    return false;
  };
  const ripeCropNear = () => {
    const p = T.playerPos();
    for (const f of T.layout.places.fields) {
      if (dist2(f.x, f.z, p.x, p.z) > 4) continue;
      for (const c of f.crops) if (c.ripe && dist2(c.x, c.z, p.x, p.z) < PICK_DIST) return { field: f, crop: c };
    }
    return null;
  };
  // Picking someone's veg is stealing — if anyone sees it
  const pickCrop = () => {
    const found = ripeCropNear();
    if (!found) return;
    const { field, crop } = found;
    crop.ripe = false;
    crop.growAt = T.simT + CROP_REGROW_S;
    crop.mesh.visible = false;
    gain('crops');
    T.feedLine(`🥕 +1 Veg (${T.goods.crops})`);
    // (helping the farmer with the harvest on the first day: allowed — townIntro.js)
    if (T.introAllowsPick(field)) { T.introNote('pick'); return; }
    const owner = T.npcs.find((n) => n.alive && n.role === 'farmer' && n.work === field) ?? null;
    T.crime('theft', owner);
  };
  // Trees and crops grow back
  const updateRegrowth = () => {
    for (const t of T.layout.trees) {
      if (t.wood < TREE_WOOD && T.simT > t.growAt) {
        t.wood += 1;
        t.growAt = T.simT + TREE_REGROW_S;
      }
    }
    for (const f of T.layout.places.fields) {
      for (const c of f.crops) {
        if (!c.ripe && T.simT > c.growAt) { c.ripe = true; c.mesh.visible = true; }
      }
    }
  };

  // ── The market: the goods shop + the weapon shop (townStalls.js — rooms off the island,
  // entered through two of the town's houses), the sell panel ──
  // The shop the player's in (null: out in town)
  const playerShop = () => { const p = T.playerPos(); return T.stalls.shopAt(p.x, p.z); };
  // At that shop's back counter (its buttons, the sell panel)
  const nearStallKey = (key) => { const p = T.playerPos(); return T.stalls.atCounter(key, p.x, p.z, TRADE_DIST); };
  // The shop whose back counter the player's at, or null
  const nearestStall = () => (nearStallKey('gear') ? 'gear' : nearStallKey('goods') ? 'goods' : null);
  const nearStall = () => nearStallKey('goods');
  // The shop door outside the player's at, or null
  const nearShopDoor = (dist = SHOP_DOOR_DIST) => {
    if (playerShop()) return null;
    const p = T.playerPos();
    for (const [key, s] of Object.entries(T.layout.places.shops)) {
      if (dist2(p.x, p.z, s.door.x, s.door.z) < dist) return key;
    }
    return null;
  };
  const canEnterShop = () => T.active && T.ready && !T.sequence && !T.jail && !ctx.isPlayerDead() && calmNow()
    && T.law.stars <= 0;
  // In through the door (weapons away: no fighting in the shops); out again by walking back
  // through it or 🚪 Leave
  const enterShop = (key) => {
    if (!canEnterShop()) {
      if (T.law.stars > 0) T.feedLine('🚪 Not with the guards after you!');
      return;
    }
    T.fishing = null;
    T.stopFishingRig?.();
    ctx.putWeaponsAway?.();
    const d = T.stalls.doorInside(key);
    ctx.teleport(d.x, d.z, Math.PI); // (facing in: the back counter)
    ctx.setPositionConstraint(T.stalls.constrainPlayer);
    T.inShop = key;
    T.stalls.setInside(key);
    T.actsAt = 0;
    if (!stallOpen(key)) T.feedLine(key === 'gear' ? '⚔️ The weapon shop\'s shut — back in the morning.' : '🧺 The merchant\'s not in.');
  };
  const leaveShop = () => {
    const key = T.inShop ?? playerShop();
    if (!key) return;
    stalls.unfocus();
    closeMarket();
    const s = T.layout.places.shops[key];
    ctx.setPositionConstraint(null);
    T.inShop = null;
    T.stalls.setInside(null);
    ctx.teleport(s.door.x, s.door.z, s.exitYaw);
    // (not straight back in: the door walks in again once the player has stepped away from it)
    T.doorRearm = key;
    T.doorLast = null;
    T.actsAt = 0;
  };
  // Outside: walking into a shop's door (close to it, heading for the house) goes in — no button
  const walkInDoor = () => {
    const p = T.playerPos();
    const last = T.doorLast;
    T.doorLast = { x: p.x, z: p.z };
    if (T.doorRearm) {
      const d = T.layout.places.shops[T.doorRearm].door;
      if (dist2(p.x, p.z, d.x, d.z) < SHOP_DOOR_DIST) return;
      T.doorRearm = null;
    }
    if (!last) return;
    const mx = p.x - last.x;
    const mz = p.z - last.z;
    const step = Math.hypot(mx, mz);
    if (step < 0.005 || step > 1) return; // (standing still, or a teleport)
    const key = nearShopDoor(SHOP_DOOR_ENTER_DIST);
    if (!key || !canEnterShop()) return;
    // (in = toward the house: against the way out)
    const yaw = T.layout.places.shops[key].exitYaw;
    if ((mx * -Math.sin(yaw) + mz * -Math.cos(yaw)) / step > 0.4) enterShop(key);
  };
  // Each frame: out through the doorway; or moved out of the shop some other way (knocked
  // out, arrested…) — its constraint and light go
  const updateShop = () => {
    if (!T.inShop && !T.jail && !T.sequence) walkInDoor();
    const p = T.playerPos();
    const at = T.stalls.shopAt(p.x, p.z);
    if (T.inShop && at === T.inShop && T.stalls.leftThroughDoor(p.x, p.z)) { leaveShop(); return; }
    if (T.inShop && at !== T.inShop) {
      if (!T.jail) ctx.setPositionConstraint(null);
      T.inShop = null;
      T.stalls.setInside(null);
    }
    // (in a shop without coming through its door — a save, a teleport: kept on its floor)
    if (!T.inShop && at && !T.jail) {
      T.inShop = at;
      ctx.setPositionConstraint(T.stalls.constrainPlayer);
      T.stalls.setInside(at);
    }
  };
  // The weapon shop keeps the market's hours (its keeper isn't one of the townsfolk)
  const gearOpen = () => inHours(T.hour(), MARKET_HOURS);
  const stallOpen = (key) => (key === 'gear' ? gearOpen() : marketOpen());
  const calmNow = () => !T.npcs.some((n) => n.fighter && T.distToPlayer(n) < 8);
  const canShop = (key) => T.active && T.ready && !!key && !T.sequence && !T.jail && !T.fishing && !ctx.isPlayerDead()
    && !T.marketPanel.isOpen() && calmNow() && stallOpen(key);
  const gearOwned = (id, items) => {
    if (!items) return false;
    if (id === 'sword') return items.sword;
    if (id === 'rod') return items.rod;
    if (id === 'shield') return items.shield >= ctx.shieldMax;
    if (id === 'gun') return items.gun;
    if (id === 'wand') return items.wand;
    if (id === 'mana') return items.mana >= ctx.maxMana;
    return false;
  };
  const gearHave = (id, items) => {
    if (!items) return '';
    if (id === 'sword' || id === 'gun' || id === 'wand' || id === 'rod') return items[id] ? 'You have one' : '';
    if (id === 'shield') return items.shield > 0 ? `Shield ${items.shield} / ${ctx.shieldMax}` : '';
    if (id === 'ammo') return items.gun ? `You have ${items.ammo}` : '';
    if (id === 'bomb') return `You have ${items.bombs}`;
    if (id === 'bubble') return `You have ${items.bubbles}`;
    if (id === 'mana') return items.wand ? `Mana ${items.mana} / ${ctx.maxMana}` : '';
    return '';
  };
  // The buy card's contents for a thing on a counter
  const stallItemState = (key, id) => {
    if (key === 'goods') {
      const g = GOODS[id];
      const merchant = workingMerchant();
      const friend = merchant && merchant.attitude >= FRIEND_ATTITUDE;
      return {
        name: `${g.emoji} ${g.label}`,
        desc: `${T.market.stock[id]} in stock${g.food ? ` · eat it for +${g.heal} ❤️` : ''}${friend ? ' · friend\'s price' : ''}`,
        owned: `You have ${T.goods[id]}`,
        price: buyPrice(id),
        blocked: !merchant ? 'The merchant isn’t here'
          : merchant.attitude < GRUDGE_ATTITUDE ? `${firstName(merchant.name)} won’t sell to you`
          : T.market.stock[id] <= 0 ? 'Sold out' : null,
      };
    }
    if (id === 'chest') {
      return {
        name: '🎁 Mystery Chest', desc: 'A random prize — coins, bombs, a shield, goods… maybe even a gun!',
        price: CHEST_PRICE, verb: 'Open', blocked: gearOpen() ? null : 'Closed',
      };
    }
    const item = SHOP_GEAR.find((x) => x.id === id);
    const items = ctx.getItems();
    const missing = item.needs && !items?.[item.needs];
    return {
      name: `${item.emoji} ${item.label}`,
      desc: item.desc || '',
      owned: gearHave(id, items),
      price: item.price,
      blocked: !gearOpen() ? 'Closed'
        : gearOwned(id, items) ? (id === 'mana' ? 'Mana is full' : id === 'shield' ? 'Shield is full' : 'Owned')
        : missing ? `Needs a ${SHOP_GEAR.find((x) => x.id === item.needs)?.label}` : null,
    };
  };
  const stalls = createTownStalls({
    camera: ctx.camera,
    domElement: ctx.domElement,
    parent: T.hud,
    getCoins: () => ctx.getCoins(),
    getState: stallItemState,
    buy: (key, id) => {
      if (!canShop(key) || stallItemState(key, id).blocked) return null;
      if (key === 'goods') return { ok: buyGood(id) };
      if (id === 'chest') return openChest();
      return { ok: buyGear(id) };
    },
    getPlayerPosition: () => ctx.getPlayerPosition(),
    setPlayerHidden: (hidden) => ctx.setPlayerHidden?.(hidden),
    canShop: (key) => canShop(key),
    canTap: (key) => canShop(key) && playerShop() === key,
  });
  const focusStall = (key) => {
    T.fishing = null;
    stalls.focus(key);
    T.actsAt = 0;
  };
  // Selling goods: the market panel
  const marketModel = () => {
    const merchant = workingMerchant();
    const cash = Math.floor(merchant?.money ?? 0);
    return {
      title: `💰 Sell · ${merchant ? firstName(merchant.name) : 'closed'}`,
      coins: ctx.getCoins(),
      cash,
      note: !merchant ? 'The merchant isn\'t here.'
        : merchantShunsPlayer() ? `${firstName(merchant.name)} won't trade with you.`
        : merchant.attitude >= FRIEND_ATTITUDE ? `${firstName(merchant.name)} gives you a friend's price.` : null,
      // (cooked food: only once the player has some to sell)
      goods: GOOD_IDS.filter((g) => !GOODS[g].cooked || T.goods[g] > 0).map((g) => ({
        id: g, emoji: GOODS[g].emoji, label: GOODS[g].label, stock: T.market.stock[g], have: T.goods[g],
        sell: playerSellPrice(g),
        canSell: !!merchant && !merchantShunsPlayer() && T.goods[g] > 0 && cash >= playerSellPrice(g),
      })),
    };
  };
  const openMarket = () => {
    if (!marketOpen()) { T.feedLine('🧺 The market\'s closed.'); return; }
    T.fishing = null;
    stalls.unfocus();
    T.marketPanel.open(marketModel());
  };
  const closeMarket = () => T.marketPanel.close();
  // What the merchant asks / pays the player: a friend gets a better deal (a grudge, no deal)
  const buyPrice = (g) => {
    const m = workingMerchant();
    const off = m && m.attitude >= FRIEND_ATTITUDE ? 1 - FRIEND_DISCOUNT : 1;
    return Math.max(1, Math.round(T.market.price(g) * off));
  };
  const playerSellPrice = (g) => {
    const m = workingMerchant();
    const up = m && m.attitude >= FRIEND_ATTITUDE ? 1 + FRIEND_DISCOUNT : 1;
    return Math.max(1, Math.round(T.market.sellPrice(g) * up));
  };
  const merchantShunsPlayer = () => (workingMerchant()?.attitude ?? 0) < GRUDGE_ATTITUDE;
  const buyGood = (g) => {
    const merchant = workingMerchant();
    const price = buyPrice(g);
    if (!merchant || merchantShunsPlayer() || ctx.getCoins() < price || !T.market.take(g)) return false;
    ctx.addCoins(-price);
    merchant.money += price;
    if (T.netMode === 'client') T.net.send(T.net.hostId(), { w: 1, op: 'trade', g, d: -1, cash: price });
    gain(g);
    noteStock();
    return true;
  };
  const sellGood = (g) => {
    const merchant = workingMerchant();
    const price = playerSellPrice(g);
    if (!merchant || merchantShunsPlayer() || T.goods[g] <= 0 || merchant.money < price) return;
    T.goods[g] -= 1;
    T.renderGoods();
    T.market.put(g);
    merchant.money -= price;
    if (T.netMode === 'client') T.net.send(T.net.hostId(), { w: 1, op: 'trade', g, d: 1, cash: -price });
    ctx.addCoins(price);
    noteStock();
    T.remember(merchant, 'customer');
    T.introNote('sell');
  };
  const buyGear = (id) => {
    const item = SHOP_GEAR.find((x) => x.id === id);
    if (!item || ctx.getCoins() < item.price) return false;
    if (!ctx.grantItem(item.kind, item.n ?? 1)) return false;
    ctx.addCoins(-item.price);
    T.feedLine(`${item.emoji} Bought: ${item.label}`);
    return true;
  };
  // The weapon shop's mystery chest: one weighted random prize (what can't be used is left out)
  const openChest = () => {
    if (ctx.getCoins() < CHEST_PRICE) return { ok: false };
    const items = ctx.getItems() ?? {};
    const good = pickOf(RAW_IDS);
    const prizes = [
      { w: 24, emoji: '🪙', give: () => { const n = 10 + 5 * Math.floor(Math.random() * 7); ctx.addCoins(n); return `${n} coins`; } },
      { w: 16, emoji: '💣', give: () => (ctx.grantItem('bomb', 2) ? '2 bombs' : null) },
      { w: 12, emoji: '🫧', give: () => (ctx.grantItem('bubble', 1) ? 'a bubble' : null) },
      { w: 14, emoji: GOODS[good].emoji, give: () => { gain(good, 3); return `3 ${GOODS[good].label.toLowerCase()}`; } },
      { w: items.shield >= ctx.shieldMax ? 0 : 10, emoji: '🛡️', give: () => (ctx.grantItem('shield') ? 'a shield' : null) },
      { w: items.gun ? 10 : 0, emoji: '🔶', give: () => (ctx.grantItem('ammo', 6) ? '6 bullets' : null) },
      { w: items.gun ? 0 : 4, emoji: '🔫', give: () => (ctx.grantItem('gun') ? 'a gun!' : null) },
      { w: items.sword ? 0 : 6, emoji: '🗡️', give: () => (ctx.grantItem('sword') ? 'a sword!' : null) },
      { w: 3, emoji: '💰', give: () => { ctx.addCoins(100); return 'the jackpot — 100 coins!'; } },
    ].filter((p) => p.w > 0);
    let r = Math.random() * prizes.reduce((sum, p) => sum + p.w, 0);
    const prize = prizes.find((p) => (r -= p.w) < 0) || prizes[0];
    ctx.addCoins(-CHEST_PRICE);
    const text = prize.give();
    if (!text) { ctx.addCoins(CHEST_PRICE); return { ok: false }; }
    T.feedLine(`🎁 Mystery Chest: ${text}`);
    return { ok: true, emoji: prize.emoji };
  };

  // Other weapons than the sword (bullets, bombs, magic) hit the townsfolk drawn nearby
  // through stand-ins shaped like stage enemies (projectiles.js / blastEnemiesAt)
  // (nobody in the shops: no fighting in there)
  const weaponTargetsFor = () => T.npcs.filter((n) => n.alive && n.body && !n.fighter && !n.inside && !n.dying
    && !stalls.shopAt(n.x, n.z));
  const fromPlayer = (n) => {
    const p = T.playerPos();
    const d = Math.hypot(n.x - p.x, n.z - p.z) || 1;
    return { x: (n.x - p.x) / d, z: (n.z - p.z) / d };
  };
  const proxyFor = (n) => {
    if (!n.proxy) {
      const group = new THREE.Object3D(); // (just a position: no box, the bullet sweep test finds it)
      n.proxy = {
        group,
        get isDead() { return !n.alive; },
        applyDamage: (amount) => {
          if (!T.active || !n.alive || n.fighter) return false;
          T.hurt(n, fromPlayer(n), Math.max(1, Math.round(amount || 1)));
          return !n.alive;
        },
        applyKnockback: () => {},
        applyDirectKnockback: () => {},
        applyBlastKnockback: () => {},
      };
    }
    n.proxy.group.position.set(n.x, T.groundY(n), n.z);
    return n.proxy;
  };
  const getWeaponTargets = () => (T.active && T.ready && !T.sequence ? weaponTargetsFor().map(proxyFor) : []);
  const getMagicTargets = () => (T.active && T.ready && !T.sequence ? weaponTargetsFor().map((n) => ({
    center: new THREE.Vector3(n.x, T.groundY(n) + 0.55 * heightScale(n.url), n.z),
    radius: 0.45,
    blocks: () => false,
    onBlocked: () => {},
    onHit: (b) => {
      if (n.alive && !n.fighter) T.hurt(n, fromPlayer(n), b.element === 'fire' ? ctx.magicDamage.fire : ctx.magicDamage.ice);
    },
  })) : []);
  // ── The market (townEconomy.js): the merchant behind the goods shop's counter buys and sells ──
  const marketOpen = () => inHours(T.hour(), MARKET_HOURS) && !!workingMerchant();
  // The merchant, if they're at the counter now
  const workingMerchant = () => T.npcs.find((m) => m.alive && !m.fighter && m.role === 'merchant'
    && T.isWorking(m)) ?? null;
  // (feed: a good running out / coming back)
  const noteStock = () => {
    for (const g of RAW_IDS) {
      if (T.market.stock[g] <= 0 && !T.soldOut.has(g)) {
        T.soldOut.add(g);
        T.feedLine(`📉 The market's out of ${GOODS[g].label.toLowerCase()}! ${GOODS[g].emoji} ${T.market.price(g)}🪙 now`);
      } else if (T.market.stock[g] > 0 && T.soldOut.has(g)) {
        T.soldOut.delete(g);
        T.feedLine(`📦 ${GOODS[g].label} is back at the market.`);
      }
    }
    if (T.marketPanel.isOpen()) T.marketPanel.render(marketModel());
  };
  // A townsperson buys a meal (and maybe firewood) from the merchant
  const buyFood = (n) => {
    const merchant = workingMerchant();
    const food = T.market.cheapestFood();
    if (!merchant || !food) {
      T.say(n, 'Sold out?! I\'m starving…');
      return;
    }
    const pay = (g) => {
      const price = T.market.price(g);
      if (n.money < price || !T.market.take(g)) return false;
      n.money -= price;
      merchant.money += price;
      return true;
    };
    if (!pay(food)) return;
    T.say(n, shout(SHOUT_EAT_BUY));
    setTimeout(() => { if (T.active && merchant.alive) T.say(merchant, `${GOODS[food].emoji} That's ${T.market.price(food)} coins!`); }, 900);
    n.needs.hunger = 0;
    if (Math.random() < FIREWOOD_CHANCE) pay('wood');
    noteStock();
  };
  // A woodcutter / farmer / fisher sells what they made to the merchant (as far as the
  // merchant's money goes)
  const deliverGoods = (n) => {
    const merchant = workingMerchant();
    if (!merchant) return;
    let sold = 0;
    for (const g of GOOD_IDS) {
      while (n.carry[g] > 0) {
        const price = T.market.sellPrice(g);
        if (merchant.money < price) break;
        n.carry[g] -= 1;
        T.market.put(g);
        merchant.money -= price;
        n.money += price;
        sold += 1;
      }
    }
    if (sold) {
      const g = GOOD_IDS.find((x) => PRODUCE[n.role]?.[0] === x) ?? 'wood';
      T.say(n, `Fresh ${GOODS[g].label.toLowerCase()}! ${GOODS[g].emoji}`);
      setTimeout(() => { if (T.active && merchant.alive) T.say(merchant, 'I\'ll take the lot.'); }, 900);
    } else {
      T.say(merchant, 'Can\'t afford it today, sorry.');
    }
    noteStock();
  };

  Object.assign(T, {
    buyFood, calmNow, closeMarket, deliverGoods, eat, enterShop, focusStall, gain, gearOpen, getMagicTargets,
    getWeaponTargets, hurtFood, leaveShop, marketOpen, nearShopDoor, nearStall, nearestStall, noteStock,
    openMarket, pickCrop, playerShop, ripeCropNear, sellGood, stallItemState, stalls, stallOpen, tryChop,
    updateRegrowth, updateShop, workingMerchant,
  });
}

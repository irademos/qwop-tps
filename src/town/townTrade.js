// Town: the player's goods and gathering (chop, pick, eat — fishing is townFishing.js, farming
// townFarming.js), going in and out of the houses (townRooms.js: the shop, the jail and the
// homes), the shop's counters and the wizard's stall (townStalls.js; the market stalls outside —
// buying food and selling — are townMarket.js), and the stand-ins bullets / bombs / spells hit
// townsfolk through.

import { GOODS, RAW_IDS, SHOP_GEAR, WIZARD_WARES } from './townEconomy.js';
import { firstName } from './townPeople.js';
import * as THREE from 'three';
import { createTownStalls } from './townStalls.js';
import { createTownRooms } from './townRooms.js';
import {
  CHEST_PRICE, LOCKPICK_MAX, SEEDS_MAX, CROP_REGROW_S, GRUDGE_ATTITUDE,
  DOOR_DIST, DOOR_ENTER_HALF_WIDTH, DOOR_ENTER_PAST, PICK_DIST, TRADE_DIST, dist2,
  heightScale, pickOf,
} from './townConfig.js';

// T: the town's shared state + functions (createTownMode in townMode.js); ctx: the game
export function installTownTrade(T, ctx) {
  // ── The player's goods, gathering and trade ──
  // (what fits in the bag — BAG_MAX, townHomes.js); → how many went in
  const gain = (g, n = 1) => {
    const got = Math.min(n, T.bagRoom());
    if (got < n) T.bagFullNote();
    T.goods[g] += got;
    T.renderGoods();
    return got;
  };
  // Food for health (the goods pill / the town book)
  const eat = (g) => {
    if (!GOODS[g]?.food || T.goods[g] <= 0 || T.sequence || ctx.isPlayerDead()) return;
    const { health, max } = ctx.getHealth();
    if (health >= max) { T.feedLine('You\'re not hungry.'); return; }
    T.goods[g] -= 1;
    ctx.heal(GOODS[g].heal);
    ctx.playSfx?.('eat');
    T.renderGoods();
    T.feedLine(`Ate a ${GOODS[g].label.toLowerCase()}. +${GOODS[g].heal} health`);
  };
  // Dropping things from the bag (the town book's Bag page): goods, seeds or lock-picks — gone for good
  const DROPPABLE = {
    seeds: { label: 'seed', get: () => T.seeds, set: (n) => { T.seeds = n; } },
    lockpick: { label: 'lock-pick', get: () => T.lockpicks, set: (n) => { T.lockpicks = n; } },
  };
  const dropItem = (id, n = 1) => {
    if (T.sequence || ctx.isPlayerDead()) return 0;
    const extra = DROPPABLE[id];
    const have = extra ? extra.get() || 0 : GOODS[id] ? T.goods[id] || 0 : 0;
    const k = Math.min(have, Math.max(1, Math.floor(n)));
    if (k <= 0) return 0;
    if (extra) extra.set(have - k);
    else T.goods[id] = have - k;
    T.renderGoods();
    const label = extra ? extra.label : GOODS[id].label.toLowerCase();
    T.feedLine(k === 1 ? `Dropped a ${label}.` : `Dropped ${k} × ${label}.`);
    return k;
  };
  const ripeCropNear = () => {
    const p = T.playerPos();
    for (const f of T.layout.places.fields) {
      if (dist2(f.x, f.z, p.x, p.z) > 4) continue;
      for (const c of f.crops) if (c.ripe && dist2(c.x, c.z, p.x, p.z) < PICK_DIST) return { field: f, crop: c };
    }
    return null;
  };
  // A field's veg are its owner's: the player picks only their own field (bought — townFarming.js)
  // or the farmer's while helping with the harvest on the first day (quests/firstDay.js)
  const mayPickField = (field) => T.fieldOwner(field) === 'mine' || T.questAllowsPick(field);
  const mayPick = () => { const f = ripeCropNear(); return !!f && mayPickField(f.field); };
  let noPickNoteAt = -99;
  const pickCrop = () => {
    const found = ripeCropNear();
    if (!found) return;
    const { field, crop } = found;
    if (!mayPickField(field)) {
      if (T.simT - noPickNoteAt > 4) {
        noPickNoteAt = T.simT;
        const farmer = T.npcs.find((n) => n.alive && n.role === 'farmer' && n.work === field);
        T.feedLine(T.fieldOwner(field) === 'theirs' ? 'That field\'s another player\'s — not yours to pick.'
          : `That's ${farmer ? `${firstName(farmer.name)}'s` : 'a farmer\'s'} field — buy a field of your own to pick from.`);
      }
      return;
    }
    if (T.bagRoom() <= 0) { T.bagFullNote(); return; }
    crop.ripe = false;
    crop.growAt = T.simT + CROP_REGROW_S;
    crop.mesh.visible = false;
    gain('crops');
    T.feedLine(`+1 Veg (${T.goods.crops})`);
    if (T.fieldOwner(field) !== 'mine') T.questNote('pick');
  };
  // Trees and crops grow back
  const updateRegrowth = () => {
    for (const f of T.layout.places.fields) {
      for (const c of f.crops) {
        if (!c.ripe && T.simT > c.growAt) { c.ripe = true; c.mesh.visible = true; }
      }
    }
  };

  // ── The houses' rooms (townRooms.js — under the map, entered through the houses' doors):
  // the shop, the jail and the homes ──
  const rooms = createTownRooms({ camera: ctx.camera, renderer: ctx.renderer, scene: ctx.scene, getPlayerPosition: () => ctx.getPlayerPosition() });
  // The room the player's in (null: out in town)
  const playerRoom = () => { const p = T.playerPos(); return rooms.roomAt(p.x, p.z); };
  // At the shop's back counter / the wizard's stall (its buttons, the sell panel)
  const nearStallKey = (key) => { const p = T.playerPos(); return T.stalls.atCounter(key, p.x, p.z, TRADE_DIST); };
  // The stall whose counter the player's at, or null
  const nearestStall = () => (nearStallKey('shop') ? 'shop' : nearStallKey('wizard') ? 'wizard' : null);
  const nearStall = () => nearStallKey('shop');
  // The door outside the player's at (its room's key), or null
  const nearDoor = (dist = DOOR_DIST) => {
    if (playerRoom()) return null;
    const p = T.playerPos();
    for (const [key, r] of Object.entries(T.layout.places.rooms)) {
      if (dist2(p.x, p.z, r.door.x, r.door.z) < dist) return key;
    }
    return null;
  };
  const canEnterRoom = () => T.active && T.ready && !T.sequence && !T.jail && !ctx.isPlayerDead() && calmNow()
    && T.law.stars <= 0;
  // Whose home it is (for the feed)
  const homeLine = (key) => {
    const home = T.layout.places.rooms[key].home;
    const house = T.houses[home];
    if (house) return T.doorAccess(key).mine ? 'Home. Your chest is in the corner.' : `${house.n || 'Another player'}'s home.`;
    const names = T.npcs.filter((n) => n.alive && n.homeIndex === home && !n.def.outlaw).map((n) => firstName(n.name));
    if (!names.length) return 'An empty house — nobody lives here yet.';
    const who = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
    return `${who}'s home.`;
  };
  // In through the door (weapons away: no fighting indoors); out again by walking back through
  // it or 🚪 Leave
  // (forced: the lock picked — townHomes.js; otherwise a locked door says why)
  const enterRoom = (key, { forced = false } = {}) => {
    // (not on the flying broom — land it first)
    if (ctx.isOnBroom?.()) { T.feedLine('Land the broom first.'); return; }
    if (T.inCart()) { T.feedLine('Get out of the cart first.'); return; }
    if (!canEnterRoom()) {
      if (T.law.stars > 0) T.feedLine('Not with the guards after you!');
      return;
    }
    const access = T.doorAccess(key);
    if (!access.open && !forced) { T.lockedNote(key, access); return; }
    ctx.playSfx?.('doorOpen');
    T.fishing = null;
    T.stopFishingRig?.();
    T.dropHeld?.({ quiet: true });
    ctx.putWeaponsAway?.();
    const d = rooms.doorInside(key);
    // (turned the way the player faced the door: in the room, π faces in — the back wall;
    // outside, exitYaw + π)
    ctx.teleportTurned(d.x, d.z, -T.layout.places.rooms[key].exitYaw);
    ctx.setPositionConstraint(rooms.constrainPlayer);
    T.inRoom = key;
    rooms.setInside(key);
    T.actsAt = 0;
    if (T.layout.places.rooms[key].kind === 'home') T.feedLine(homeLine(key));
    else if (key === 'jail') T.feedLine('The sheriff\'s office — and the cell.');
    else if (!stallOpen(key)) T.feedLine('The weaponsmith\'s not in.');
  };
  const leaveRoom = () => {
    const key = T.inRoom ?? playerRoom();
    if (!key) return;
    stalls.unfocus();
    const r = T.layout.places.rooms[key];
    ctx.setPositionConstraint(null);
    T.inRoom = null;
    rooms.setInside(null);
    ctx.playSfx?.('doorClose');
    // (facing out of the room the way the player faced its doorway)
    ctx.teleportTurned(r.door.x, r.door.z, r.exitYaw);
    // (not straight back in: the door walks in again once the player has stepped away from it)
    T.doorRearm = key;
    T.doorLast = null;
    T.actsAt = 0;
  };
  // Where walking toward a door goes in: within `enterDist` of the door spot outside, or (most
  // houses) across the line DOOR_ENTER_PAST out from it, between it and the house
  const atDoorway = (r, p) => {
    if (r.enterDist != null) return dist2(p.x, p.z, r.door.x, r.door.z) < r.enterDist;
    const nx = Math.sin(r.exitYaw);
    const nz = Math.cos(r.exitYaw);
    const dx = p.x - r.door.x;
    const dz = p.z - r.door.z;
    const along = dx * nx + dz * nz;
    return along < DOOR_ENTER_PAST && along > -(r.out + 0.3) && Math.abs(dx * nz - dz * nx) < DOOR_ENTER_HALF_WIDTH;
  };
  const doorAt = (p) => {
    if (playerRoom()) return null;
    for (const [key, r] of Object.entries(T.layout.places.rooms)) if (atDoorway(r, p)) return key;
    return null;
  };
  // Outside: walking into a house's door (close to it, heading for the house) goes in — no button
  const walkInDoor = () => {
    const p = T.playerPos();
    const last = T.doorLast;
    T.doorLast = { x: p.x, z: p.z };
    if (ctx.isOnBroom?.() || T.inCart()) return; // (flying / rolling past a door doesn't go in)
    if (T.doorRearm) {
      const r = T.layout.places.rooms[T.doorRearm];
      // (out of where walking in starts, so coming out doesn't go straight back in)
      const d = dist2(p.x, p.z, r.door.x, r.door.z);
      if (r.enterDist != null ? d < Math.max(DOOR_DIST, r.enterDist + 0.2) : d < DOOR_DIST && atDoorway(r, p)) return;
      T.doorRearm = null;
    }
    if (!last) return;
    const mx = p.x - last.x;
    const mz = p.z - last.z;
    const step = Math.hypot(mx, mz);
    if (step < 0.005 || step > 1) return; // (standing still, or a teleport)
    const key = doorAt(p);
    if (!key || !canEnterRoom()) return;
    // (in = toward the house: against the way out)
    const yaw = T.layout.places.rooms[key].exitYaw;
    if ((mx * -Math.sin(yaw) + mz * -Math.cos(yaw)) / step > 0.4) enterRoom(key);
  };
  // Each frame: out through the doorway; or moved out of the room some other way (knocked
  // out, arrested…) — its constraint and light go
  const updateRooms = () => {
    if (!T.inRoom && !T.jail && !T.sequence) walkInDoor();
    const p = T.playerPos();
    const at = rooms.roomAt(p.x, p.z);
    if (T.inRoom && at === T.inRoom && rooms.leftThroughDoor(p.x, p.z)) { leaveRoom(); return; }
    if (T.inRoom && at !== T.inRoom) {
      if (!T.jail) ctx.setPositionConstraint(null);
      T.inRoom = null;
      rooms.setInside(null);
    }
    // (in a room without coming through its door — a save, a teleport: kept on its floor)
    if (!T.inRoom && at && !T.jail) {
      T.inRoom = at;
      ctx.setPositionConstraint(rooms.constrainPlayer);
      rooms.setInside(at);
    }
  };
  // The shop: the merchant at the counter; the wizard's stall: the wizard behind it
  // (a market stall: someone selling behind it — townMarket.js)
  const stallOpen = (key) => (key === 'wizard' ? !!workingWizard() : T.isMarketKey(key) ? T.marketCanShop(key) : shopOpen());
  const calmNow = () => !T.npcs.some((n) => n.fighter && T.distToPlayer(n) < 8);
  const canShop = (key) => T.active && T.ready && !!key && !T.sequence && !T.jail && !T.fishing && !ctx.isPlayerDead()
    && calmNow() && stallOpen(key);
  const gearOwned = (id, items) => {
    if (!items) return false;
    if (id === 'sword') return items.sword;
    if (id === 'rod') return items.rod;
    if (id === 'shield') return items.shield >= ctx.shieldMax;
    if (id === 'gun') return items.gun;
    if (id === 'wand') return items.wand;
    if (id === 'broom') return items.broom;
    if (id === 'mana') return items.mana >= ctx.maxMana;
    if (id === 'lockpick') return T.lockpicks >= LOCKPICK_MAX;
    if (id === 'seeds') return T.seeds >= SEEDS_MAX;
    if (id === 'life') { const { health, max } = ctx.getHealth(); return health >= max; }
    return false;
  };
  const gearHave = (id, items) => {
    if (!items) return '';
    if (id === 'sword' || id === 'gun' || id === 'wand' || id === 'rod' || id === 'broom') return items[id] ? 'You have one' : '';
    if (id === 'shield') return items.shield > 0 ? `Shield ${items.shield} / ${ctx.shieldMax}` : '';
    if (id === 'ammo') return items.gun ? `You have ${items.ammo}` : '';
    if (id === 'bomb') return `You have ${items.bombs}`;
    if (id === 'mana') return `Mana ${items.mana} / ${ctx.maxMana}`;
    if (id === 'lockpick') return T.lockpicks ? `You have ${T.lockpicks}` : '';
    if (id === 'seeds') return T.seeds ? `You have ${T.seeds} seeds` : '';
    if (id === 'life') { const { health, max } = ctx.getHealth(); return `Health ${health} / ${max}`; }
    return '';
  };
  // Who's selling (the merchant / the wizard, at their counter) and whether they'll sell to the player
  const keeperOf = (key) => (key === 'wizard' ? workingWizard() : workingMerchant());
  const keeperBlock = (key) => {
    const k = keeperOf(key);
    if (!k) return key === 'wizard' ? 'The wizard isn’t here' : 'The weaponsmith isn’t here';
    if (k.attitude < GRUDGE_ATTITUDE) return `${firstName(k.name)} won’t sell to you`;
    return null;
  };
  // The buy card's contents for a thing on a counter
  const stallItemState = (key, id) => {
    if (T.isMarketKey(key)) return T.marketItemState(key, id);
    if (id === 'chest') {
      return {
        name: 'Mystery Chest', desc: 'A random prize — coins, bombs, a shield, goods… maybe even a gun!',
        price: CHEST_PRICE, verb: 'Open', blocked: keeperBlock(key),
      };
    }
    const g = gearState(key === 'wizard' ? WIZARD_WARES : SHOP_GEAR, id);
    return { ...g, blocked: keeperBlock(key) ?? g.blocked };
  };
  // A piece of gear's buy card, whoever's selling it (the weaponsmith, the wizard, a seller at a
  // selling spot — townMarket.js): blocked = why the player can't have it (owned, full…) or null
  const gearState = (list, id) => {
    const item = list.find((x) => x.id === id);
    const items = ctx.getItems();
    const missing = item.needs && !items?.[item.needs];
    const needLabel = { gun: 'Bow', wand: 'Magic Wand' }[item.needs];
    return {
      name: item.label,
      desc: item.desc || '',
      owned: gearHave(id, items),
      price: item.price,
      blocked: gearOwned(id, items) ? (id === 'mana' ? 'Mana is full' : id === 'shield' ? 'Shield is full' : id === 'lockpick' ? `You can carry ${LOCKPICK_MAX}`
        : id === 'seeds' ? `You can carry ${SEEDS_MAX}` : id === 'life' ? 'You’re at full health' : 'Owned')
        : missing ? `Needs a ${needLabel}` : null,
    };
  };
  const stalls = createTownStalls({
    rooms,
    camera: ctx.camera,
    domElement: ctx.domElement,
    parent: T.hud,
    getCoins: () => ctx.getCoins(),
    getState: stallItemState,
    buy: (key, id) => {
      if (!canShop(key) || stallItemState(key, id).blocked) return null;
      const res = T.isMarketKey(key) ? T.marketBuy(key, id)
        : id === 'chest' ? openChest() : { ok: buyGear(key, id) };
      if (res?.ok) ctx.playSfx?.(id === 'chest' ? 'chestPrize' : 'buy');
      return res;
    },
    getPlayerPosition: () => ctx.getPlayerPosition(),
    setPlayerHidden: (hidden) => ctx.setPlayerHidden?.(hidden),
    canShop: (key) => canShop(key),
    canTap: (key) => canShop(key) && (key === 'wizard' ? nearStallKey('wizard') : T.isMarketKey(key) ? T.marketCanTap(key) : playerRoom() === key),
  });
  const focusStall = (key) => {
    T.fishing = null;
    stalls.focus(key);
    T.actsAt = 0;
  };
  // Gear from the shop / the wizard (the money goes to whoever's behind the counter — or payTo:
  // a seller at a selling spot, townMarket.js)
  const buyGear = (key, id, payTo = null) => {
    const item = (key === 'wizard' ? WIZARD_WARES : SHOP_GEAR).find((x) => x.id === id);
    if (!item || ctx.getCoins() < item.price) return false;
    // (a lock-pick, seeds, a life potion are the town's own: townHomes.js, townFarming.js)
    if (item.kind === 'lockpick') {
      if (T.lockpicks >= LOCKPICK_MAX) return false;
      T.lockpicks += 1;
    } else if (item.kind === 'seeds') {
      if (T.seeds >= SEEDS_MAX) return false;
      T.seeds = Math.min(SEEDS_MAX, T.seeds + (item.n ?? 1));
    } else if (item.kind === 'life') {
      const { health, max } = ctx.getHealth();
      if (health >= max) return false;
      ctx.heal(max);
      ctx.playSfx?.('drink');
    } else if (!ctx.grantItem(item.kind, item.n ?? 1)) return false;
    ctx.addCoins(-item.price);
    const k = payTo ?? keeperOf(key);
    if (k) T.npcMoney(k, item.price);
    T.feedLine(`Bought: ${item.label}`);
    return true;
  };
  // The shop's mystery chest: one weighted random prize (what can't be used is left out)
  const openChest = () => {
    if (ctx.getCoins() < CHEST_PRICE) return { ok: false };
    const items = ctx.getItems() ?? {};
    const good = pickOf(RAW_IDS);
    const prizes = [
      { w: 24, emoji: '🪙', give: () => { const n = 10 + 5 * Math.floor(Math.random() * 7); ctx.addCoins(n); return `${n} coins`; } },
      { w: 16, emoji: '💣', give: () => (ctx.grantItem('bomb', 2) ? '2 bombs' : null) },
      { w: 14, emoji: GOODS[good].emoji, give: () => { const n = gain(good, 3); return n ? `${n} ${GOODS[good].label.toLowerCase()}` : null; } },
      { w: items.shield >= ctx.shieldMax ? 0 : 10, emoji: '🛡️', give: () => (ctx.grantItem('shield') ? 'a shield' : null) },
      { w: items.gun ? 10 : 0, emoji: '🪶', give: () => (ctx.grantItem('ammo', 6) ? '6 arrows' : null) },
      { w: items.gun ? 0 : 4, emoji: '🏹', give: () => (ctx.grantItem('gun') ? 'a bow!' : null) },
      { w: items.sword ? 0 : 6, emoji: '🗡️', give: () => (ctx.grantItem('sword') ? 'a sword!' : null) },
      { w: 3, emoji: '💰', give: () => { ctx.addCoins(100); return 'the jackpot — 100 coins!'; } },
    ].filter((p) => p.w > 0);
    let r = Math.random() * prizes.reduce((sum, p) => sum + p.w, 0);
    const prize = prizes.find((p) => (r -= p.w) < 0) || prizes[0];
    ctx.addCoins(-CHEST_PRICE);
    const text = prize.give();
    if (!text) { ctx.addCoins(CHEST_PRICE); return { ok: false }; }
    if (workingMerchant()) T.npcMoney(workingMerchant(), CHEST_PRICE);
    T.feedLine(`Mystery Chest: ${text}`);
    return { ok: true, emoji: prize.emoji };
  };

  // Other weapons than the sword (bullets, bombs, magic) hit the townsfolk drawn nearby
  // through stand-ins shaped like stage enemies (projectiles.js / blastEnemiesAt)
  // (nobody indoors: no fighting in there)
  const weaponTargetsFor = () => T.npcs.filter((n) => n.alive && n.body && !n.fighter && !n.questing && !n.inside && !n.dying
    && !rooms.roomAt(n.x, n.z));
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
  const getWeaponTargets = () => (T.active && T.ready && !T.sequence ? [...weaponTargetsFor().map(proxyFor), ...(T.octopusWeaponTargets?.() ?? []), ...(T.chickenWeaponTargets?.() ?? [])] : []);
  const getMagicTargets = () => (T.active && T.ready && !T.sequence ? weaponTargetsFor().map((n) => ({
    center: new THREE.Vector3(n.x, T.groundY(n) + 0.55 * heightScale(n.url), n.z),
    radius: 0.45,
    blocks: () => false,
    onBlocked: () => {},
    onHit: (b) => {
      if (n.alive && !n.fighter) T.hurt(n, fromPlayer(n), b.element === 'fire' ? ctx.magicDamage.fire : ctx.magicDamage.ice);
    },
  })).concat(T.octopusMagicTargets?.() ?? [], T.chickenMagicTargets?.() ?? []) : []);
  // ── The shop (the weaponsmith behind its counter) and the wizard's stall ──
  const shopOpen = () => !!workingMerchant();
  // The weaponsmith, if they're at the counter now
  const workingMerchant = () => T.npcs.find((m) => m.alive && !m.fighter && m.role === 'merchant'
    && T.isWorking(m)) ?? null;
  // The wizard, if he's behind his stall now
  const workingWizard = () => T.npcs.find((m) => m.alive && !m.fighter && m.role === 'wizard'
    && T.isWorking(m)) ?? null;

  Object.assign(T, {
    buyGear, calmNow, dropItem, eat, enterRoom, focusStall, gain, gearState, getMagicTargets,
    getWeaponTargets, leaveRoom, shopOpen, nearDoor, nearStall, nearestStall,
    mayPick, pickCrop, playerRoom, ripeCropNear, rooms, stallItemState, stalls, stallOpen,
    updateRegrowth, updateRooms, workingMerchant, workingWizard,
  });
}

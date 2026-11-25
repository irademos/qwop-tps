// Town mode economy: the goods townsfolk (and the player) make, buy and sell. Each producer
// sells their own at a selling spot (townMarket.js — a market stall outside the shop, or a spot
// along the shop's side counters): the fisher fish (and fishing rods), the farmer veg (and
// seeds), the woodcutter wood — goods out of what they carry (n.carry), at a set price; the
// player buys / sells with them by talking, or takes a free spot and sells to whoever comes up.
// The shop's back counter is the weaponsmith's: the rest of the gear.

// price: what one costs (coins, set — no haggling); heal: health a bite gives the player;
// cooked: made at the campfire's pot (townCooking.js — RECIPES) — nobody else makes them, so
// only the player sells them (from a stall); wild: gathered by the player (the chickens —
// townChickens.js), no townsperson makes them: like cooked, left out of shortages and shown once
// the player has some; target: for jobs (townMissions.js — what's short)
export const GOODS = {
  wood:  { label: 'Wood', emoji: '🪵', price: 4, target: 6 },
  fish:  { label: 'Fish', emoji: '🐟', price: 6, target: 6, food: true, heal: 2 },
  crops: { label: 'Veg',  emoji: '🥕', price: 3, target: 8, food: true, heal: 1 },
  grilledFish: { label: 'Grilled Fish', emoji: '🍢', price: 11, target: 4, food: true, heal: 4, cooked: true },
  stew:  { label: 'Stew', emoji: '🍲', price: 9, target: 4, food: true, heal: 3, cooked: true },
  // (the chickens' — townChickens.js: a hen hit with a weapon drops a drumstick, hens lay eggs)
  chicken: { label: 'Chicken', emoji: '🍗', price: 7, target: 4, food: true, heal: 2, wild: true },
  egg:   { label: 'Egg', emoji: '🥚', price: 3, target: 6, food: true, heal: 1, wild: true },
  // (cooked from them at the campfire — townCooking.js)
  roastChicken: { label: 'Roast Chicken', emoji: '🍖', price: 13, target: 4, food: true, heal: 5, cooked: true },
  friedEgg: { label: 'Fried Egg', emoji: '🍳', price: 6, target: 4, food: true, heal: 2, cooked: true },
  // (the fisher's golden fish — given to the player after his rescue, quests/jobs.js; one of a
  // kind: shown once held, never food, worth a fortune)
  goldenFish: { label: 'Golden Fish', emoji: '🐠', price: 150, target: 1, wild: true },
  // (the golden fish cooked at the campfire — townCooking.js: drunk, it fills the player's health
  // and for ELIXIR_S they glow gold and swim / dive fast without tiring — T.elixirLeft, townTrade.js
  // + the swim / dive in bootstrapGameApp.js. elixir: drunk even at full health, never sold to townsfolk)
  goldenElixir: { label: 'Golden Elixir', emoji: '🌟', price: 250, target: 1, food: true, heal: 99, cooked: true, elixir: true },
};
export const ELIXIR_S = 300;           // s the golden elixir lasts (its speed: ELIXIR_SWIM_SCALE in bootstrapGameApp.js)
export const GOOD_IDS = Object.keys(GOODS);
export const RAW_IDS = GOOD_IDS.filter((g) => !GOODS[g].cooked && !GOODS[g].wild);
// (cooked / wild goods: shown in the goods pill, the bag, the chest, the cart only once there are some)
export const shownWhenHeld = (g) => !!(GOODS[g].cooked || GOODS[g].wild);
export const FOOD_IDS = GOOD_IDS.filter((g) => GOODS[g].food && !GOODS[g].elixir);
// Who sells what: their own good (made at work — townConfig.js PRODUCE) and the gear of their
// trade (SHOP_GEAR ids — always in stock: they make their own)
export const SELLER_GOOD = { fisher: 'fish', farmer: 'crops', woodcutter: 'wood' };
export const SELLER_GEAR = { fisher: ['rod'], farmer: ['seeds'] };
// Goods a seller buys from the player besides their own (at buyBackPrice, like their own): the
// farmer takes chicken and eggs off the player's hands
export const SELLER_BUYS = { farmer: ['chicken', 'egg'] };
// Everything a selling spot can show (townStalls.js)
export const MARKET_WARES = [...Object.keys(GOODS), 'seeds', 'rod'];
const BUY_BACK_SHARE = 0.6; // what a seller pays the player for one of their own good, as a share of its price
export const goodPrice = (g) => GOODS[g].price;
export const buyBackPrice = (g) => Math.max(1, Math.floor(GOODS[g].price * BUY_BACK_SHARE));

// The gear (townStalls.js — the weaponsmith's on the shop's back counter, but seeds — the
// farmers' — and the rod — the fishers' — SELLER_GEAR). kind = what ctx.grantItem gets
// (seeds / lockpick are the town's own: townTrade.js); needs = a weapon that must be owned first
export const SHOP_GEAR = [
  { id: 'sword',  kind: 'sword',  label: 'Sword',      emoji: '🗡️', price: 30,  desc: 'Swing it with the phone. Chops trees too.' },
  { id: 'rod',    kind: 'rod',    label: 'Fishing Rod', emoji: '🎣', price: 25,  desc: 'Swing it forward to cast at the fishing spot, pull back to hook, reel it in.' },
  { id: 'shield', kind: 'shield', label: 'Shield',     emoji: '🛡️', price: 40,  desc: 'Stops swings, arrows and bombs from in front.' },
  { id: 'gun',    kind: 'gun',    label: 'Bow',        emoji: '🏹', price: 80,  desc: 'Hold Bow to draw, let go to shoot. Comes with 12 arrows.' },
  { id: 'ammo',   kind: 'ammo',   label: '10 Arrows',  emoji: '🪶', price: 15,  n: 10, needs: 'gun' },
  { id: 'bomb',   kind: 'bomb',   label: 'Bomb',       emoji: '💣', price: 12,  n: 1 },
  { id: 'seeds',  kind: 'seeds',  label: '3 Veg Seeds', emoji: '🌱', price: 6, n: 3, desc: 'Plant them anywhere: a veg by tomorrow, or in under a minute watered with the hose.' },
  { id: 'lockpick', kind: 'lockpick', label: 'Lock-pick', emoji: '🔧', price: 15, desc: 'Opens one locked door, then it breaks. A break-in is a crime if anyone sees.' },
];
// The town wizard's stall out in the woods (townStalls.js 'wizard'): the wand and the potions,
// as at the Showdown village's stall, and the flying broom (src/items/broom.js). life = health back to full (townTrade.js)
export const WIZARD_WARES = [
  { id: 'life',   kind: 'life',   label: 'Life Potion', emoji: '❤️', price: 25,  desc: 'Drink it for full health.' },
  { id: 'mana',   kind: 'mana',   label: 'Mana Potion', emoji: '🧪', price: 20,  desc: '+50 mana — for the wand, the bubble and the broom\'s boost.' },
  { id: 'wand',   kind: 'wand',   label: 'Magic Wand', emoji: '🪄', price: 150, desc: 'Swipe to cast fire / ice. Runs on mana.' },
  { id: 'broom',  kind: 'broom',  label: 'Flying Broom', emoji: '🧹', price: 200, desc: 'Sit on it and fly — tilt the phone (or the joystick) the way to go.' },
];

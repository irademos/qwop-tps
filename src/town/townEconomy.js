// Town mode economy: the goods townsfolk (and the player) make, buy and sell, the market's
// stock, and prices that follow it — scarce goods cost more, a glut is cheap. The merchant's
// cash is the merchant townsperson's money (townMode.js), so the market can run dry of money
// as well as goods. Weapons are sold at a fixed price.

// base: price (coins) at the target stock; heal: health a bite gives the player;
// cooked: made at the campfire's pot (townCooking.js — RECIPES) — nobody else makes them, so
// the market only has what the player sells it (they're left out of shortages and jobs)
export const GOODS = {
  wood:  { label: 'Wood', emoji: '🪵', base: 4, target: 10 },
  fish:  { label: 'Fish', emoji: '🐟', base: 6, target: 8, food: true, heal: 2 },
  crops: { label: 'Veg',  emoji: '🥕', base: 3, target: 12, food: true, heal: 1 },
  grilledFish: { label: 'Grilled Fish', emoji: '🍢', base: 11, target: 4, food: true, heal: 4, cooked: true },
  stew:  { label: 'Stew', emoji: '🍲', base: 9, target: 4, food: true, heal: 3, cooked: true },
};
export const GOOD_IDS = Object.keys(GOODS);
export const RAW_IDS = GOOD_IDS.filter((g) => !GOODS[g].cooked);
export const FOOD_IDS = GOOD_IDS.filter((g) => GOODS[g].food);

// What the market stocks the first time the town is founded
const START_STOCK = { wood: 8, fish: 6, crops: 10 };
const PRICE_MAX = 1.7;     // price multiple when sold out…
const PRICE_MIN = 0.5;     // …and at twice the target stock (or more)
const SELL_SHARE = 0.6;    // what the merchant pays, as a share of the price

// The weapon stall's gear (townStalls.js). kind = what ctx.grantItem gets; needs = a
// weapon that must be owned first
export const SHOP_GEAR = [
  { id: 'sword',  kind: 'sword',  label: 'Sword',      emoji: '🗡️', price: 30,  desc: 'Swing it with the phone. Chops trees too.' },
  { id: 'rod',    kind: 'rod',    label: 'Fishing Rod', emoji: '🎣', price: 25,  desc: 'Swing it forward to cast at the fishing spot, pull back to hook, reel it in.' },
  { id: 'shield', kind: 'shield', label: 'Shield',     emoji: '🛡️', price: 40,  desc: 'Stops swings, bullets and bombs from in front.' },
  { id: 'gun',    kind: 'gun',    label: 'Gun',        emoji: '🔫', price: 80,  desc: 'Comes with 12 bullets.' },
  { id: 'ammo',   kind: 'ammo',   label: '10 Bullets', emoji: '🔶', price: 15,  n: 10, needs: 'gun' },
  { id: 'bomb',   kind: 'bomb',   label: 'Bomb',       emoji: '💣', price: 12,  n: 1 },
  { id: 'bubble', kind: 'bubble', label: 'Bubble',     emoji: '🫧', price: 20,  n: 1 },
  { id: 'wand',   kind: 'wand',   label: 'Magic Wand', emoji: '🪄', price: 150, desc: 'Swipe to cast fire / ice. Runs on mana.' },
  { id: 'mana',   kind: 'mana',   label: 'Mana',       emoji: '🧪', price: 20,  needs: 'wand' },
];

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// stock: { wood, fish, crops } (from the town's save, or fresh)
export function createMarket(stock = null) {
  const s = { ...START_STOCK, ...(stock ?? {}) };
  GOOD_IDS.forEach((g) => { s[g] = Math.max(0, Math.floor(s[g] || 0)); });

  // What the market asks for one
  const price = (g) => {
    const { base, target } = GOODS[g];
    return Math.max(1, Math.round(base * clamp(PRICE_MAX - (PRICE_MAX - 1) * (s[g] / target), PRICE_MIN, PRICE_MAX)));
  };
  // What the merchant pays for one
  const sellPrice = (g) => Math.max(1, Math.floor(price(g) * SELL_SHARE));

  return {
    stock: s,
    price,
    sellPrice,
    // One taken off the market (true if there was one)
    take: (g) => {
      if (s[g] <= 0) return false;
      s[g] -= 1;
      return true;
    },
    put: (g, n = 1) => { s[g] += n; },
    // The cheapest food in stock, or null
    cheapestFood: () => FOOD_IDS.filter((g) => s[g] > 0).sort((a, b) => price(a) - price(b))[0] ?? null,
    // The good it's shortest of (relative to its target), when it's short
    scarcest: () => {
      const g = [...RAW_IDS].sort((a, b) => s[a] / GOODS[a].target - s[b] / GOODS[b].target)[0];
      return s[g] < GOODS[g].target * 0.25 ? g : null;
    },
    snapshot: () => ({ ...s }),
  };
}

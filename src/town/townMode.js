// Town mode (start screen → Town): Brindlewick, the town of houses on the island's north-west,
// as a living place. ~20 townsfolk with jobs, homes and needs go about their day on the town
// clock (work, the market, the campfire, bed), walking the roads (townNav.js); the player can
// talk to them, give them coins — or hit them. Hurting someone is a crime if anyone sees it:
// wanted stars, the guards come running and fight (as EnemyPlayers), and getting beaten or
// giving up lands the player in the jail cell. The dead stay dead; newcomers move in to take
// their place. Townsfolk names / roles / lines are in townPeople.js.
//
// Economy (townEconomy.js): woodcutters, farmers and fishers bring wood, veg and fish to the
// market and are paid by the merchant; everyone buys their food (and firewood) there; prices
// follow the stock. The player gathers too — chops trees with the sword, fishes from the shore,
// picks veg (stealing, if anyone sees) — and trades at the market: two stalls side by side
// (townStalls.js), shopped like the Showdown village's — the goods stall (wood / fish / veg,
// the merchant behind it) and the weapon stall (the gear + a mystery chest); selling goods is
// the market panel (townMarketPanel.js). In Town the player owns only what they bought here,
// starting with nothing at all (ctx.startLoadout — the real inventory waits outside), and the
// guards take it all on an arrest.
//
// Reactions: how townsfolk feel about the player (attitude) fades over time and shows — friends
// get a discount at the goods stall, a grudge means no trade and stepping aside; a hurt
// townsperson's family and the brave nearby come to help, and the family of the dead hold a
// vendetta (they attack on sight). Townsfolk fight each other too: drifters mug people at
// night, bandits raid; whoever's seen doing it is an outlaw for a while (hurting an outlaw is no
// crime), and a guard goes to arrest them (a brawl, then the jail cell). Good friends follow
// the player (🤝 Join me) and help in fights. Guards and the sheriff fight with gear (a shield;
// the sheriff a gun too at ★★★).
//
// Law: an arrest is two guards carrying the player off (ctx.carryPlayerOff); in the cell:
// bail, a bribe, picking the lock (townLockpick.js — a jailbreak brings the guards back) or
// sleeping it off. Bandits live at a camp outside town (BANDIT_ROLES), raid fields and mug
// people at night, attack the player on sight; the sheriff's board pays bounties on them.
//
// Missions (townJobs.js): the sheriff's board (bounties, guarding a field from a raid) and
// the town board by the fire (deliveries from real shortages, debts, a lost kid), shady jobs
// from the drifter, and three authored chains (CHAINS); up to MAX_ACTIVE_JOBS at once, shown
// in the quest tracker with 📍 markers in the world.
//
// Bodies are a level of detail: only the nearest TOWN_MAX_BODIES townsfolk get a GLB character
// (pooled per model); the rest walk the same paths as data. Someone fighting the player is
// swapped for an EnemyPlayer (ctx.spawnFighter — the stage fighting code) and back.
//
// Game access goes through `ctx` (built in bootstrapGameApp.js):
//   scene, camera, domElement, getPlayerPosition() → Vector3, setPlayerHidden(hidden),
//   getPlayerName(), isPlayerDead()
//   getGroundY(x, z), isOverWater(x, z), pathAt(x, z) → 'road' | 'trail' | null
//   getMapObjects(bounds) → [{ file, x, z, radius }]
//   teleport(x, z, yaw), revivePlayer(x, z, yaw), setPositionConstraint(fn | null)
//   setTimeOfDay('day' | 'night'), showBanner(title, sub, ms)
//   spawnFighter({ x, z, yaw, url, hearts, swingChance, gear, name }) → EnemyPlayer,
//   removeFighter(enemy), releaseFighterGear(enemy), carryPlayerOff({ carrierUrl, onDone }),
//   cancelCarry()
//   spawnBlood(position, groundY), playSfx('hit' | 'chop'), dropCoins(position, n)
//   getCoins(), addCoins(delta), profileKey() → string | null, onLobby()
//   startLoadout(items), endLoadout() → items, getItems() → items | null, grantItem(kind, n),
//   confiscate(), magicDamage { fire, ice }, getHealth() → { health, max }, heal(n)

import * as THREE from 'three';
import { createGLBCharacterInstance, glbCharacterConfig } from '../models/glbCharacterModel.js';
import { raycastMapSegment } from '../environment/mapCollision.js';
import { makeTextSprite, makeCampfire, updateCampfire, MARKET_STALL_MERCHANT_Z } from '../village/villageMode.js';
import { createTownNav } from './townNav.js';
import { GOODS, GOOD_IDS, FOOD_IDS, SHOP_GEAR, createMarket } from './townEconomy.js';
import { createMarketPanel } from './townMarketPanel.js';
import { createTownStalls } from './townStalls.js';
import { BOARDS, CHAINS, MAX_ACTIVE_JOBS, OPEN_PER_BOARD, createJobBoardPanel, createQuestTracker } from './townJobs.js';
import { createLockpick } from './townLockpick.js';
import {
  TOWN_NAME, ROLES, FOUNDING_ROLES, BANDIT_ROLES, characterForRole, randomName, firstName,
  talkLine, giftLine, chatLines, shout, relationOf, fillLine,
  SHOUT_HURT, SHOUT_HELP, SHOUT_MURDER, SHOUT_THIEF, SHOUT_FIGHT, SHOUT_LAW, SHOUT_EAT_BUY,
  SHOUT_RALLY, SHOUT_VENDETTA, SHOUT_STAY_BACK, SHOUT_MUG, SHOUT_ARREST, SHOUT_BANDIT, SHOUT_THANKS, FOLLOW_LINES,
} from './townPeople.js';

// ── Layout ──
// The town's area of the island (world m, the houses are around (−44, −48)) and a point on
// its road (stage 3's route runs through town) that the walkable area is grown from
const TOWN_BOUNDS = { minX: -90, maxX: -4, minZ: -94, maxZ: -8 };
const NAV_CELL = 1.25;
const NAV_START = { x: -24.9, z: -31.5 };
const BUILDING_RE = /house|building|cabin/i;
const TREE_RE = /tree/i;
const TREE_TRUNK_RADIUS = 0.6;

// ── Clock ── (an hour = 20 s, a day = 8 min)
const MINUTES_PER_SEC = 3;
const START_MINUTES = 8 * 60;
const NIGHT_FROM_H = 21;
const NIGHT_TO_H = 5.5;

// ── People ──
export const TOWN_MAX_BODIES = 12;   // townsfolk drawn at once (the nearest)
const BODY_DIST = 42;                // m — drawn within this…
const BODY_RELEASE_DIST = 48;        // …and put away past this
const LABEL_DIST = 7;                // m — name tags show this close
const CAMERA_CLEAR_DIST = 1.8;       // m — no name tag / bubble on someone this close to the camera
const WALK_SPEED = 1.25;             // m/s
const RUN_SPEED = 3.6;               // m/s (fleeing, guards answering a crime)
const TALK_RANGE = 2.4;              // m — 💬 shows for townsfolk this close
const BUBBLE_S = 3.6;                // s a speech bubble stays up
const PLAYER_PUSH_DIST = 0.55;       // m — townsfolk step out of the player's way
const NEEDS = { energyDrain: 1 / 420, sleepGain: 1 / 80, hungerRate: 1 / 300, socialRate: 1 / 260 };
const WORK_PAY = 1;                  // coins a guard / the sheriff earns per stint of work
const GIFT_COINS = 5;                // 🪙 Give
const FRIEND_ATTITUDE = 0.55;        // friends don't tell the guards what they saw
const NEWCOMER_DELAY_S = [45, 100];  // s until someone moves in after a death
const FOUNDING_HOUSEHOLDS = 9;       // houses the founding townsfolk share (families)
const DEAD_BODY_S = 5;               // s a body lies there before it's taken away

// ── Law ──
const WITNESS_DIST = 22;             // m — townsfolk who see a crime this close report it
const LAW_SIGHT = 28;                // m — guards keep track of a wanted player this close
const ENGAGE_DIST = 9;               // m — a guard who sees the player this close draws its sword
const DISENGAGE_DIST = 30;           // m — a fighter further away goes back to running after them
const HEAT_DECAY_S = 12;             // s unseen per star lost
const HOSTILE_CALM_S = 15;           // s without being hit before a townsperson who fought back calms down
const GIVE_UP_DIST = 5;              // m — 🙌 Give up when a guard fighter is this close
const FINE_PER_STAR = 15;            // coins
const JAIL_S = 30;                   // s in the cell (or pay bail)
const BAIL = 20;                     // coins
const KO_COIN_SHARE = 0.1;           // share of coins lost when knocked out (not wanted)

// ── Economy ──
// What a stint of work makes: [good, min, max]
const PRODUCE = { woodcutter: ['wood', 2, 3], farmer: ['crops', 2, 4], fisher: ['fish', 1, 3] };
const MERCHANT_START_CASH = 60;      // coins the merchant starts out with
const FIREWOOD_CHANCE = 0.35;        // a townsperson buying food takes some firewood home too
const MARKET_HOURS = [7, 20];
const TRADE_DIST = 3.4;              // m from a stall for its buttons (🧺 Goods / 💰 Sell, ⚔️ Weapons)
const STALL_GAP = 2.2;               // m between the goods stall and the weapon stall
const CHEST_PRICE = 30;              // the weapon stall's mystery chest
const CHOP_HITS = 3;                 // sword hits on a tree per 🪵
const TREE_WOOD = 3;                 // 🪵 a tree gives before it needs to grow back…
const TREE_REGROW_S = 40;            // …one per this many seconds
const CHOP_REACH = 0.85;             // m from the sword tip to the trunk
const CROP_REGROW_S = 70;            // s until a picked crop is back
const PICK_DIST = 1.6;               // m — 🌾 Pick near a ripe crop
const FISH_WATER_CELLS = 2;          // 🎣 Fish within this many nav cells of the water
const FISH_S = [3, 6];               // s per cast
const FISH_CHANCE = 0.6;
const FISH_CANCEL_DIST = 0.8;        // m — walking off cancels the cast

// ── Reactions ──
const ATTITUDE_FADE = 0.004;         // per second, toward 0 (fondness fades at half the rate)
const GRUDGE_ATTITUDE = -0.5;        // won't trade with the player, steps aside from them
const FRIEND_DISCOUNT = 0.15;        // friends pay this much less at the goods stall (and get more)
const AVOID_DIST = 4.5;              // m
const RALLY_DIST = 15;               // m — the brave this close (family: further) come to help
const RALLY_MAX = 2;
const VENDETTA_SIGHT = 9;            // m — the family of someone the player killed attacks on sight
const FOLLOW_ATTITUDE = 0.8;         // fond enough to come along (🤝 Join me)
const MAX_FOLLOWERS = 2;
const FOLLOW_GAP = 2.2;              // m behind the player
const FOLLOW_HELP_DIST = 12;         // m — a follower takes on hostiles this close to the player
const FOLLOW_HIT_S = 1.8;            // s between a follower's blows
const BRAWL_HIT_S = [1.0, 1.7];      // s between blows when townsfolk fight each other
const BRAWL_REACH = 1.3;             // m
const MUG_CHANCE = 0.3;              // a drifter out at night goes after someone (per decision)
const OUTLAW_S = 120;                // s someone seen attacking / robbing is wanted
const NPC_JAIL_S = 90;               // s an arrested townsperson spends in the cell

// ── Law (more) ──
const BRIBE = 35;                    // coins
const BRIBE_ODDS = 0.5;              // when no officer near likes the player
const LOCK_SLIP_S = 10;              // s added to the sentence by a slipped lockpick
const WAKE_HOUR = 7;                 // sleeping it off: out at this hour
const BANDIT_SIGHT = 9;              // m — bandits attack the player this close (and seen)
const BANDIT_RETURN_S = [180, 300];  // s until a beaten bandit's place in the gang is filled
const BANDIT_CAMP_R = 7;             // m they loiter around the camp
const RAID_CHANCE = 0.35;            // a bandit's night decision: raid a field…
const BANDIT_MUG_CHANCE = 0.2;       // …or rob someone
const RAID_TAKE = 2;                 // crops a raider takes

// ── Missions ──
const BOARD_DIST = 2.6;              // m — 📋 jobs near a board
const BOARD_REFRESH_S = 120;         // s between postings
const ACT_DIST = 2.4;                // m — a job's 📦 / 💰 near its townsperson
const KID_FOUND_DIST = 2.5;          // m
const KID_HOME_DIST = 3;             // m from their door to count as home
const RAID_HOUR = 22;                // a guarded field is raided at this hour

const SAVE_EVERY_S = 20;
const SAVE_PREFIX = 'town_';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _UP = new THREE.Vector3(0, 1, 0);

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
};
const rand = (a, b) => a + Math.random() * (b - a);
const pickOf = (list) => list[Math.floor(Math.random() * list.length)];
const dist2 = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);
const angleLerp = (a, b, t) => {
  const d = ((b - a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
  return a + d * t;
};
// Hour h in [a, b) — b may pass midnight
const inHours = (h, hours) => (hours[0] < hours[1] ? h >= hours[0] && h < hours[1] : h >= hours[0] || h < hours[1]);
const heightScale = (url) => glbCharacterConfig.heightScaleByUrl[url] ?? 1;

// Guests (and the session before a profile loads) keep the town in memory
let _memoryState = null;

export function createTownMode(ctx) {
  let active = false;
  let ready = false;          // layout built, townsfolk spawned
  let enterToken = 0;
  let layout = null;          // built once (the map doesn't change): nav, places, props
  const root = new THREE.Group();
  root.name = 'town';
  let npcs = [];
  let nextId = 1;
  let simT = 0;               // s of town time while active (pauses with the game)
  const clock = { day: 1, minutes: START_MINUTES };
  let isNight = null;
  const law = { stars: 0, peak: 0, lastSeenAt: 0, lastKnown: new THREE.Vector3(), seen: false, tickAt: 0 };
  let jail = null;            // { left } while the player is in the cell
  let sequence = null;        // busted / knocked out in progress (timeout token)
  let gossip = [];            // [{ kind, who, by, at, fresh }]
  let arrivals = [];          // [{ role, at }]
  let departed = [];          // first names of the dead (not given to newcomers)
  let talking = null;         // { npc, until }
  let saveAt = 0;
  let growAt = 0;
  let lodAt = 0;
  let actsAt = 0;
  let actsKey = '';
  let acts = [];
  const pool = new Map();     // url → [{ container, character }]
  let market = createMarket(); // the stall's stock (replaced by the saved one on enter)
  const goods = { wood: 0, fish: 0, crops: 0 }; // what the player carries
  const soldOut = new Set();  // goods the market has run out of (for the feed)
  let fishing = null;         // { left, x, z } while the player's line is out
  let jobs = [];              // posted + taken jobs (townJobs.js)
  let nextJobId = 1;
  let chainsDone = new Set();
  let boardsAt = 0;           // next posting time
  const markers = new Map();  // job id → 📍 sprite
  let strongboxHeld = false;  // (chain: the sheriff's strongbox)
  let lastItems = null;       // the town gear, as it was when the player last left

  // ── DOM ──
  const hud = el('div', 'town-hud hidden');
  const top = el('div', 'town-top ui-panel');
  const topPlace = el('span', 'town-top-place', `🏘️ ${TOWN_NAME}`);
  const topSep = el('span', 'town-top-sep', '·');
  const topClock = el('span', 'town-top-clock');
  top.append(topPlace, topSep, topClock);
  const stars = el('div', 'town-stars hidden');
  const jailChip = el('div', 'town-jail ui-panel hidden');
  const lobbyBtn = el('button', 'ui-btn ui-btn-secondary town-lobby', '⬅ Lobby');
  lobbyBtn.type = 'button';
  lobbyBtn.addEventListener('click', () => { if (active) ctx.onLobby(); });
  const feed = el('div', 'town-feed');
  const actsEl = el('div', 'town-acts hidden');
  const fade = el('div', 'town-fade');
  // What the player carries; the food can be eaten (tap) for health
  const goodsEl = el('div', 'town-goods');
  const goodEls = {};
  for (const g of GOOD_IDS) {
    const b = el('button', 'town-good');
    b.type = 'button';
    b.disabled = !GOODS[g].food;
    b.title = GOODS[g].food ? `Eat ${GOODS[g].label} (+${GOODS[g].heal} health)` : GOODS[g].label;
    b.addEventListener('click', () => { if (active) eat(g); });
    goodEls[g] = b;
    goodsEl.append(b);
  }
  hud.append(top, stars, jailChip, lobbyBtn, feed, goodsEl, actsEl);
  document.body.append(hud, fade);
  const renderGoods = () => {
    for (const g of GOOD_IDS) goodEls[g].textContent = `${GOODS[g].emoji} ${goods[g]}`;
  };
  const marketPanel = createMarketPanel(hud, {
    onSellGood: (g) => sellGood(g),
    onClose: () => closeMarket(),
  });
  // Job boards (townJobs.js), the quest tracker, the jailbreak lock
  let boardOpen = null;       // 'law' | 'town' while a board's panel is up
  const boardPanel = createJobBoardPanel(hud, {
    onAccept: (id) => acceptJob(id),
    onAbandon: (id) => abandonJob(id),
    onClose: () => closeBoard(),
  });
  const tracker = createQuestTracker(hud);
  const lockpick = createLockpick(hud);

  const feedLine = (text) => {
    const line = el('div', 'town-feed-line', text);
    feed.prepend(line);
    while (feed.children.length > 4) feed.lastChild.remove();
    setTimeout(() => { line.classList.add('town-feed-out'); }, 4200);
    setTimeout(() => { line.remove(); }, 5000);
  };

  const renderStars = () => {
    stars.classList.toggle('hidden', law.stars <= 0);
    stars.textContent = '★'.repeat(law.stars) + '☆'.repeat(Math.max(0, 3 - law.stars));
    stars.classList.toggle('town-stars-hunted', law.stars > 0 && law.seen);
  };
  const clockText = () => {
    const m = Math.floor(clock.minutes) % 1440;
    const hh = String(Math.floor(m / 60)).padStart(2, '0');
    const mm = String(Math.floor(m % 60 / 10) * 10).padStart(2, '0');
    return `Day ${clock.day} · ${hh}:${mm} ${isNight ? '🌙' : '☀️'}`;
  };
  const hour = () => (clock.minutes % 1440) / 60;

  // ── Persistence ──
  const saveKey = () => { const k = ctx.profileKey(); return k ? `${SAVE_PREFIX}${k}` : null; };
  const snapshot = () => ({
    v: 1,
    day: clock.day,
    minutes: clock.minutes,
    people: npcs.filter((n) => n.alive).map((n) => ({
      id: n.id, name: n.name, role: n.role, url: n.url, home: n.homeIndex,
      money: Math.round(n.money), attitude: Math.round(n.attitude * 100) / 100,
      carry: { ...n.carry },
      vendetta: !!n.vendetta, following: !!n.following,
    })),
    jobs: jobs.map((j) => ({ ...j, data: { ...j.data, raiders: undefined } })),
    nextJobId,
    chainsDone: [...chainsDone],
    strongboxHeld,
    pending: arrivals.map((a) => a.role),
    departed,
    nextId,
    market: market.snapshot(),
    goods: { ...goods },
    items: ctx.getItems() ?? lastItems,
  });
  const save = () => {
    if (!ready) return;
    const state = snapshot();
    _memoryState = state;
    const key = saveKey();
    if (!key) return;
    try { localStorage.setItem(key, JSON.stringify(state)); } catch (_) { /* storage blocked */ }
  };
  const load = () => {
    const key = saveKey();
    if (key) {
      try {
        const s = JSON.parse(localStorage.getItem(key) || 'null');
        if (s?.v === 1 && Array.isArray(s.people)) return s;
      } catch (_) { /* fresh town */ }
    }
    return _memoryState;
  };

  // ── Layout (once) ──
  const buildLayout = () => {
    const nav = createTownNav({
      bounds: TOWN_BOUNDS,
      cell: NAV_CELL,
      start: NAV_START,
      getGroundY: ctx.getGroundY,
      isOverWater: ctx.isOverWater,
      pathAt: ctx.pathAt,
    });
    const objects = ctx.getMapObjects(TOWN_BOUNDS);
    const buildings = objects.filter((o) => BUILDING_RE.test(o.file));
    const trees = objects.filter((o) => TREE_RE.test(o.file));
    // Trees aren't ground (the height raycast skips them): walk round their trunks
    for (const t of trees) nav.block(t.x, t.z, TREE_TRUNK_RADIUS);
    nav.refresh();
    // Middle of town: the houses' centroid (or the nav start)
    const C = buildings.length
      ? { x: buildings.reduce((s, b) => s + b.x, 0) / buildings.length, z: buildings.reduce((s, b) => s + b.z, 0) / buildings.length }
      : { ...NAV_START };
    const cellPos = (i) => ({ x: nav.cellX(i), z: nav.cellZ(i) });
    const dC = (i) => dist2(nav.cellX(i), nav.cellZ(i), C.x, C.z);
    const best = (cells, score) => {
      let bi = -1;
      let bs = -Infinity;
      for (const i of cells) {
        const s = score(i);
        if (s > bs) { bs = s; bi = i; }
      }
      return bi;
    };
    const nearRoad = (i, r) => {
      const x = nav.cellX(i);
      const z = nav.cellZ(i);
      for (let dz = -r; dz <= r; dz += NAV_CELL) {
        for (let dx = -r; dx <= r; dx += NAV_CELL) {
          const j = nav.indexAt(x + dx, z + dz);
          if (j >= 0 && nav.walkableIndex(j) && nav.kindAt(j) === 2) return true;
        }
      }
      return false;
    };

    // Market: the most open spot off the road among the houses; the campfire a little way off;
    // the jail by a road further out
    const offRoad = (i) => nav.kindAt(i) !== 2;
    const marketCell = best(nav.cellsWhere((i) => offRoad(i) && dC(i) < 18 && nav.clearanceAt(i) >= 2.5),
      (i) => nav.clearanceAt(i) * 2 - dC(i) * 0.2);
    const market = marketCell >= 0 ? cellPos(marketCell) : { ...NAV_START };
    const fireCell = best(nav.cellsWhere((i) => {
      const d = dist2(nav.cellX(i), nav.cellZ(i), market.x, market.z);
      return offRoad(i) && d > 6 && d < 13 && nav.clearanceAt(i) >= 2.5;
    }), (i) => nav.clearanceAt(i) - dC(i) * 0.1);
    const fire = fireCell >= 0 ? cellPos(fireCell) : { x: market.x + 6, z: market.z };
    const jailCell = best(nav.cellsWhere((i) => {
      const x = nav.cellX(i);
      const z = nav.cellZ(i);
      return offRoad(i) && dist2(x, z, market.x, market.z) > 14 && dist2(x, z, fire.x, fire.z) > 12 && dC(i) < 32
        && nav.clearanceAt(i) >= 2.5 && nearRoad(i, 4);
    }), (i) => nav.clearanceAt(i) - dC(i) * 0.05);
    const jailPos = jailCell >= 0 ? cellPos(jailCell) : { x: market.x - 10, z: market.z };

    // The stall faces the campfire; the jail's door faces the nearest road
    const stallYaw = Math.atan2(fire.x - market.x, fire.z - market.z);
    const fwd = { x: Math.sin(stallYaw), z: Math.cos(stallYaw) };
    const merchantSpot = { x: market.x + fwd.x * MARKET_STALL_MERCHANT_Z, z: market.z + fwd.z * MARKET_STALL_MERCHANT_Z };
    // The weapon stall stands beside the goods stall (the side with more room), its chest
    // on the far side of it
    const stallSide = { x: fwd.z, z: -fwd.x }; // (the customer's right)
    const gearRoom = (sign) => {
      const i = nav.indexAt(market.x + stallSide.x * sign * (STALL_GAP + 0.8), market.z + stallSide.z * sign * (STALL_GAP + 0.8));
      return i >= 0 && nav.walkableIndex(i) ? nav.clearanceAt(i) : -1;
    };
    const gearSign = gearRoom(-1) > gearRoom(1) ? -1 : 1;
    const gearStall = { x: market.x + stallSide.x * gearSign * STALL_GAP, z: market.z + stallSide.z * gearSign * STALL_GAP };
    const customerSpot = { x: market.x + fwd.x * 1.4, z: market.z + fwd.z * 1.4 };
    let roadDir = null;
    {
      let bd = Infinity;
      for (const i of nav.cellsWhere((j) => nav.kindAt(j) === 2)) {
        const d = dist2(nav.cellX(i), nav.cellZ(i), jailPos.x, jailPos.z);
        if (d > 2 && d < bd) { bd = d; roadDir = { x: nav.cellX(i) - jailPos.x, z: nav.cellZ(i) - jailPos.z }; }
      }
    }
    const jailYaw = roadDir ? Math.atan2(roadDir.x, roadDir.z) : 0;
    const jailFwd = { x: Math.sin(jailYaw), z: Math.cos(jailYaw) };
    const officeSpot = { x: jailPos.x + jailFwd.x * 2.2 + jailFwd.z * 1.2, z: jailPos.z + jailFwd.z * 2.2 - jailFwd.x * 1.2 };

    nav.block(market.x + fwd.x * 0.2, market.z + fwd.z * 0.2, 0.9);
    nav.block(gearStall.x + fwd.x * 0.2, gearStall.z + fwd.z * 0.2, 0.9);
    nav.block(gearStall.x + stallSide.x * gearSign * 1.45, gearStall.z + stallSide.z * gearSign * 1.45, 0.45);
    nav.block(fire.x, fire.z, 0.9);
    nav.block(jailPos.x, jailPos.z, 1.7);
    nav.refresh();

    // Homes: a walkable spot by each house
    const homes = [];
    for (const b of buildings) {
      const i = nav.nearestWalkable(b.x, b.z);
      if (i < 0) continue;
      const d = dist2(nav.cellX(i), nav.cellZ(i), b.x, b.z);
      if (d > b.radius + 4) continue;
      homes.push({ x: nav.cellX(i), z: nav.cellZ(i), building: b });
    }
    if (!homes.length) homes.push({ ...fire });

    // Work spots
    const treeSpots = [];
    for (const t of [...trees].sort((a, b) => dist2(a.x, a.z, C.x, C.z) - dist2(b.x, b.z, C.x, C.z))) {
      const i = nav.nearestWalkable(t.x, t.z);
      if (i < 0) continue;
      const p = cellPos(i);
      if (dist2(p.x, p.z, t.x, t.z) > 3.5) continue;
      if (treeSpots.some((s) => dist2(s.x, s.z, p.x, p.z) < 5)) continue;
      treeSpots.push({ ...p, face: { x: t.x, z: t.z } });
      if (treeSpots.length >= 6) break;
    }
    const fields = [];
    for (const i of nav.cellsWhere((j) => nav.kindAt(j) === 0 && nav.clearanceAt(j) >= 3.5 && dC(j) > 16 && dC(j) < 46)
      .sort((a, b) => nav.clearanceAt(b) - nav.clearanceAt(a))) {
      const p = cellPos(i);
      if (dist2(p.x, p.z, market.x, market.z) < 12 || dist2(p.x, p.z, jailPos.x, jailPos.z) < 8) continue;
      if (fields.some((f) => dist2(f.x, f.z, p.x, p.z) < 11)) continue;
      fields.push(p);
      if (fields.length >= 3) break;
    }
    const shore = [];
    for (const i of nav.cellsWhere((j) => nav.neighbourIndices(j).some((k) => nav.isWater(k)))
      .sort((a, b) => dC(a) - dC(b))) {
      const p = cellPos(i);
      if (shore.some((s) => dist2(s.x, s.z, p.x, p.z) < 6)) continue;
      const w = nav.neighbourIndices(i).find((k) => nav.isWater(k));
      shore.push({ ...p, face: { x: nav.cellX(w), z: nav.cellZ(w) } });
      if (shore.length >= 4) break;
    }
    // Patrol: road spots spread around the middle (farthest-point picks), walked in a loop
    const roadCells = nav.cellsWhere((i) => nav.kindAt(i) === 2 && dC(i) < 34);
    const patrol = [{ ...officeSpot }];
    for (let k = 0; k < 5 && roadCells.length; k++) {
      const i = best(roadCells, (j) => Math.min(...patrol.map((p) => dist2(nav.cellX(j), nav.cellZ(j), p.x, p.z))));
      patrol.push(cellPos(i));
    }
    patrol.sort((a, b) => Math.atan2(a.z - C.z, a.x - C.x) - Math.atan2(b.z - C.z, b.x - C.x));
    // Where newcomers walk in: the road furthest from the middle
    const entranceCell = best(nav.cellsWhere((i) => nav.kindAt(i) >= 1), (i) => dC(i));
    const entrance = entranceCell >= 0 ? cellPos(entranceCell) : { ...NAV_START };

    // The bandit camp: an open spot well out of town, off the roads
    const campOk = (i, strict) => {
      const d = dC(i);
      if (d < 26 || d > 54 || nav.clearanceAt(i) < (strict ? 3 : 2)) return false;
      if (!strict) return true;
      const x = nav.cellX(i);
      const z = nav.cellZ(i);
      return !nearRoad(i, 8) && dist2(x, z, jailPos.x, jailPos.z) > 20
        && fields.every((f) => dist2(x, z, f.x, f.z) > 15);
    };
    let campCell = best(nav.cellsWhere((i) => campOk(i, true)), (i) => nav.clearanceAt(i) - Math.abs(dC(i) - 38) * 0.1);
    if (campCell < 0) campCell = best(nav.cellsWhere((i) => campOk(i, false)), (i) => nav.clearanceAt(i));
    const camp = campCell >= 0 ? cellPos(campCell) : { ...entrance };
    const campFire = { x: camp.x + 2.2, z: camp.z };
    const strongbox = { x: camp.x - 1.6, z: camp.z + 1.4 };
    nav.block(camp.x, camp.z, 1.2);
    nav.block(campFire.x, campFire.z, 0.8);
    // Job boards: the sheriff's by the office, the town's by the campfire
    const walkableNear = (x, z) => {
      const i = nav.nearestWalkable(x, z);
      return i >= 0 ? cellPos(i) : { x, z };
    };
    const lawBoard = walkableNear(officeSpot.x + jailFwd.z * 1.8, officeSpot.z - jailFwd.x * 1.8);
    const toMarket = { x: market.x - fire.x, z: market.z - fire.z };
    const tm = Math.hypot(toMarket.x, toMarket.z) || 1;
    const townBoard = walkableNear(fire.x - (toMarket.z / tm) * 3.2, fire.z + (toMarket.x / tm) * 3.2);
    nav.refresh();

    const places = {
      center: C, market, gearStall, gearSign, merchantSpot, customerSpot, stallYaw, fire, jail: jailPos, jailYaw, officeSpot,
      homes, treeSpots, fields, shore, patrol, entrance, camp, campFire, strongbox,
      boards: { law: lawBoard, town: townBoard },
      // the player arrives between the market and the fire
      spawn: { x: (market.x + fire.x) / 2 + fwd.z * 2.2, z: (market.z + fire.z) / 2 - fwd.x * 2.2 },
    };
    // Every tree in town can be chopped (wood: what it has left; it grows back)
    const choppable = trees.map((t) => ({ x: t.x, z: t.z, wood: TREE_WOOD, hits: 0, growAt: 0, hitAt: -1 }));
    return { nav, places, trees: choppable, props: buildProps(places) };
  };

  // ── Props: market stalls, campfire, jail cell, fields ──
  const groundAt = (x, z, fallback = 0) => {
    const y = ctx.getGroundY(x, z);
    return Number.isFinite(y) ? y : fallback;
  };
  const buildProps = (places) => {
    const group = new THREE.Group();
    // Market stalls (townStalls.js; async GLBs)
    for (const [key, at, label] of [['goods', places.market, '🧺 Goods'], ['gear', places.gearStall, '⚔️ Weapons']]) {
      stalls.build(group, {
        key, label, x: at.x, y: groundAt(at.x, at.z) - 0.005, z: at.z, yaw: places.stallYaw,
        chestSign: places.gearSign, keeper: key === 'gear', groundAt: (x, z) => groundAt(x, z),
      });
    }
    // Campfire
    const fire = makeCampfire();
    fire.group.position.set(places.fire.x, groundAt(places.fire.x, places.fire.z), places.fire.z);
    group.add(fire.group);
    // Jail: an iron cage with a door that swings open
    const jailRoot = new THREE.Group();
    jailRoot.position.set(places.jail.x, groundAt(places.jail.x, places.jail.z), places.jail.z);
    jailRoot.rotation.y = places.jailYaw;
    const iron = new THREE.MeshStandardMaterial({ color: 0x2f2f35, roughness: 0.6, metalness: 0.3 });
    const wood = new THREE.MeshStandardMaterial({ color: 0x6b4a2b, roughness: 1, metalness: 0 });
    const barGeo = new THREE.CylinderGeometry(0.025, 0.025, 2, 6);
    barGeo.translate(0, 1, 0);
    const half = 1.1;
    const addBars = (parent, from, to, count) => {
      for (let k = 0; k <= count; k++) {
        const bar = new THREE.Mesh(barGeo, iron);
        bar.position.lerpVectors(from, to, k / count);
        bar.castShadow = true;
        parent.add(bar);
      }
    };
    addBars(jailRoot, new THREE.Vector3(-half, 0, -half), new THREE.Vector3(half, 0, -half), 10);
    addBars(jailRoot, new THREE.Vector3(-half, 0, -half), new THREE.Vector3(-half, 0, half), 10);
    addBars(jailRoot, new THREE.Vector3(half, 0, -half), new THREE.Vector3(half, 0, half), 10);
    const door = new THREE.Group();
    door.position.set(-half, 0, half); // hinge
    addBars(door, new THREE.Vector3(0, 0, 0), new THREE.Vector3(half * 2, 0, 0), 10);
    jailRoot.add(door);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(half * 2 + 0.3, 0.12, half * 2 + 0.3), wood);
    roof.position.y = 2.06;
    roof.castShadow = true;
    jailRoot.add(roof);
    const sign = makeTextSprite('⭐ Sheriff · Jail', { height: 0.32 });
    sign.position.set(0, 2.55, 0);
    jailRoot.add(sign);
    group.add(jailRoot);
    // Fields: rows of crops on dark soil
    const soilMat = new THREE.MeshStandardMaterial({ color: 0x4a3420, roughness: 1, metalness: 0 });
    const cropMat = new THREE.MeshStandardMaterial({ color: 0x5f9e3a, roughness: 1, metalness: 0 });
    const soilGeo = new THREE.BoxGeometry(3.6, 0.08, 0.5);
    const cropGeo = new THREE.ConeGeometry(0.13, 0.32, 5);
    cropGeo.translate(0, 0.16, 0);
    for (const f of places.fields) {
      f.crops = []; // { mesh, x, z, ripe, growAt } — picked by the player (townMode pick)
      for (let r = -1; r <= 1; r++) {
        const rz = f.z + r * 1.1;
        const soil = new THREE.Mesh(soilGeo, soilMat);
        soil.position.set(f.x, groundAt(f.x, rz) + 0.02, rz);
        soil.receiveShadow = true;
        group.add(soil);
        for (let c = -2; c <= 2; c++) {
          const cx = f.x + c * 0.75;
          const crop = new THREE.Mesh(cropGeo, cropMat);
          crop.position.set(cx, groundAt(cx, rz) + 0.04, rz);
          crop.rotation.y = c * 1.3 + r;
          crop.castShadow = true;
          group.add(crop);
          f.crops.push({ mesh: crop, x: cx, z: rz, ripe: true, growAt: 0 });
        }
      }
    }
    // The bandit camp: a ragged tent, a fire, the stolen strongbox
    const cloth = new THREE.MeshStandardMaterial({ color: 0x6d5a44, roughness: 1, metalness: 0, side: THREE.DoubleSide });
    const tent = new THREE.Mesh(new THREE.ConeGeometry(1.3, 1.7, 4, 1, true), cloth);
    tent.position.set(places.camp.x, groundAt(places.camp.x, places.camp.z) + 0.85, places.camp.z);
    tent.rotation.y = Math.PI / 4;
    tent.castShadow = true;
    group.add(tent);
    const campFire = makeCampfire();
    campFire.group.position.set(places.campFire.x, groundAt(places.campFire.x, places.campFire.z), places.campFire.z);
    group.add(campFire.group);
    const strongbox = new THREE.Group();
    const boxBody = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.36, 0.38), new THREE.MeshStandardMaterial({ color: 0x7a5230, roughness: 0.9, metalness: 0 }));
    boxBody.position.y = 0.18;
    const boxBand = new THREE.Mesh(new THREE.BoxGeometry(0.57, 0.06, 0.4), iron);
    boxBand.position.y = 0.3;
    strongbox.add(boxBody, boxBand);
    strongbox.position.set(places.strongbox.x, groundAt(places.strongbox.x, places.strongbox.z), places.strongbox.z);
    strongbox.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    group.add(strongbox);
    const campSign = makeTextSprite('💀 Bandit camp', { height: 0.28 });
    campSign.position.set(places.camp.x, groundAt(places.camp.x, places.camp.z) + 2.3, places.camp.z);
    group.add(campSign);
    // Job boards: a post and a board
    for (const [key, at] of Object.entries(places.boards)) {
      const board = new THREE.Group();
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.6, 0.1), wood);
      post.position.y = 0.8;
      const panel = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.7, 0.06), wood);
      panel.position.y = 1.35;
      board.add(post, panel);
      board.position.set(at.x, groundAt(at.x, at.z), at.z);
      board.lookAt(places.fire.x, board.position.y, places.fire.z);
      board.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      const sign = makeTextSprite(BOARDS[key].label, { height: 0.24 });
      sign.position.set(0, 2.0, 0);
      board.add(sign);
      group.add(board);
    }
    return { group, fire, door, campFire, strongbox };
  };

  // ── Townsfolk ──
  const makeNpc = ({ id, name, role, url, home, money = role === 'merchant' ? MERCHANT_START_CASH : rand(4, 14), attitude = 0, carry = null, vendetta = false, following = false }) => {
    const def = ROLES[role] ?? ROLES.townsfolk;
    const { homes } = layout.places;
    // (bandits live at the camp: home index -1)
    const homeIndex = def.outlaw ? -1
      : Number.isInteger(home) && home >= 0 && home < homes.length ? home : Math.floor(Math.random() * homes.length);
    const homeSpot = def.outlaw ? layout.places.camp : homes[homeIndex];
    return {
      id, name, role, url, def,
      homeIndex,
      home: homeSpot,
      work: null,
      x: homeSpot.x, z: homeSpot.z, yaw: Math.random() * Math.PI * 2,
      alive: true, dying: null, hp: def.hp, maxHp: def.hp,
      needs: { energy: rand(0.6, 1), hunger: rand(0, 0.6), social: rand(0, 0.7) },
      money, attitude,
      carry: { wood: 0, fish: 0, crops: 0, ...(carry ?? {}) }, // goods made, on the way to the market
      speedScale: (def.speed ?? 1) * rand(0.9, 1.12),
      task: null, path: null, pathI: 0, moving: false,
      inside: false, fear: 0, hostile: false, fighter: null, lastHurtAt: -1e9, lastHitAt: -1e9,
      body: null, bodyPending: false, wantsBody: false, bubble: null, nextAmbientAt: rand(5, 25),
      patrolI: Math.floor(Math.random() * 6), workT: 0, actionAt: 0, talkBonusAt: -1e9, friendNoted: false,
      // reactions: a vendetta against the player, following the player, wanted (as an outlaw) /
      // in the cell until (sim time), the next blow in a brawl, last stepped aside
      vendetta, following, outlawUntil: 0, jailedUntil: 0, nextBlowAt: 0, avoidAt: 0,
      loot: 0, lost: false,
    };
  };
  // Work spots handed out per role (two woodcutters don't share a tree)
  const assignWork = () => {
    const { treeSpots, fields, shore } = layout.places;
    const used = { tree: 0, field: 0, shore: 0 };
    for (const n of npcs) {
      if (!n.alive) continue;
      const w = n.def.work;
      if (w === 'tree') n.work = treeSpots.length ? treeSpots[used.tree++ % treeSpots.length] : null;
      else if (w === 'field') n.work = fields.length ? fields[used.field++ % fields.length] : null;
      else if (w === 'shore') n.work = shore.length ? shore[used.shore++ % shore.length] : null;
      // (no tree / field / shore near town: they farm, or just get by)
      if ((w === 'tree' || w === 'shore') && !n.work && fields.length) n.work = fields[used.field++ % fields.length];
    }
  };
  const groundY = (n) => groundAt(n.x, n.z, 0);
  const playerPos = () => ctx.getPlayerPosition();
  const distToPlayer = (n) => { const p = playerPos(); return dist2(n.x, n.z, p.x, p.z); };

  // Line of sight from a townsperson's eyes to the player
  const sees = (n) => {
    const p = playerPos();
    _v.set(n.x, groundY(n) + 0.8, n.z);
    _v2.set(p.x, p.y + 0.8, p.z);
    return !raycastMapSegment(_v, _v2);
  };

  // ── Paths / tasks ──
  const planPath = (n, x, z) => {
    const path = layout.nav.findPath(n.x, n.z, x, z) ?? [];
    // The last few metres straight onto the spot (behind the stall, by a tree…)
    const last = path[path.length - 1] ?? { x: n.x, z: n.z };
    if (dist2(last.x, last.z, x, z) > 0.05 && dist2(last.x, last.z, x, z) < 2.6) path.push({ x, z });
    n.path = path;
    n.pathI = 0;
  };
  const setTask = (n, task) => {
    n.task = { t: 0, phase: task.to ? 'go' : 'do', ...task };
    if (task.to) planPath(n, task.to.x, task.to.z);
    else n.path = null;
  };
  // Walk along the path; true once there
  const stepPath = (n, dt, speed) => {
    const p = n.path;
    if (!p || n.pathI >= p.length) { n.moving = false; return true; }
    let left = speed * dt;
    while (left > 0 && n.pathI < p.length) {
      const wp = p[n.pathI];
      const dx = wp.x - n.x;
      const dz = wp.z - n.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.05) { n.pathI += 1; continue; }
      const s = Math.min(d, left);
      n.x += (dx / d) * s;
      n.z += (dz / d) * s;
      left -= s;
      n.yaw = angleLerp(n.yaw, Math.atan2(dx, dz), 1 - Math.exp(-10 * dt));
      if (s >= d) n.pathI += 1;
    }
    n.moving = true;
    if (n.pathI >= p.length) { n.moving = false; return true; }
    return false;
  };
  const faceToward = (n, x, z, dt) => {
    if (dist2(n.x, n.z, x, z) < 0.05) return;
    n.yaw = angleLerp(n.yaw, Math.atan2(x - n.x, z - n.z), 1 - Math.exp(-8 * dt));
  };

  const fireSlot = (n) => {
    const { fire } = layout.places;
    const a = (n.id * 2.399) % (Math.PI * 2); // golden-angle seats around the fire
    return { x: fire.x + Math.sin(a) * 1.7, z: fire.z + Math.cos(a) * 1.7 };
  };
  const randomNear = (x, z, r) => {
    for (let k = 0; k < 12; k++) {
      const a = Math.random() * Math.PI * 2;
      const d = Math.random() * r;
      const tx = x + Math.sin(a) * d;
      const tz = z + Math.cos(a) * d;
      if (layout.nav.isWalkable(tx, tz)) return { x: tx, z: tz };
    }
    return { x, z };
  };

  // What to do next: the role's work in its hours, food when hungry, the fire when lonely,
  // bed at night, otherwise a stroll (scores + a little noise)
  const decide = (n) => {
    if (!n.alive) return;
    const h = hour();
    const def = n.def;
    const night = h >= 21.5 || h < 6;
    // In the cell / lost / following the player / a bandit: their own routines
    if (n.jailedUntil > simT) { setTask(n, { type: 'jailed', dur: Infinity }); return; }
    if (n.lost) { setTask(n, { type: 'lost', dur: Infinity }); return; }
    if (n.following) {
      if ((h >= 23 || h < 6) && !n.escort) {
        n.following = false;
        say(n, pickOf(FOLLOW_LINES.late));
        feedLine(`🌙 ${firstName(n.name)} went home for the night.`);
      } else {
        setTask(n, { type: 'follow', dur: Infinity });
        return;
      }
    }
    if (def.outlaw) { decideBandit(n, h); return; }
    // A drifter out at night may go after someone's purse
    if (n.role === 'drifter' && (h >= 21 || h < 4) && Math.random() < MUG_CHANCE && startMugging(n)) return;
    const options = [];
    const working = def.hours && inHours(h, def.hours);
    if (def.law) {
      if (working) options.push(['work', 1]);
      else options.push(['sleep', 1]);
    } else {
      if (working && (def.work === 'market' || n.work)) options.push(['work', 0.8 + Math.random() * 0.2]);
      // Something to eat in their own basket: a bite where they stand
      const ownFood = FOOD_IDS.find((g) => n.carry[g] > 0);
      if (n.needs.hunger > 0.6 && ownFood) {
        n.carry[ownFood] -= 1;
        n.needs.hunger = 0;
        say(n, '*munch*');
      }
      const open = marketOpen();
      // Goods made: off to sell them
      if (open && GOOD_IDS.some((g) => n.carry[g] > 0)) options.push(['deliver', 1.1]);
      const food = market.cheapestFood();
      if (open && food && n.money >= market.price(food) && n.role !== 'merchant') options.push(['eat', n.needs.hunger ** 2 * 1.3]);
      const evening = h >= 17 && h < 23.5;
      options.push(['social', n.needs.social * 0.7 + (evening ? 0.35 : 0) + (def.nightOwl && night ? 0.6 : 0)]);
      const sleepy = def.nightOwl ? (h >= 3 && h < 11) : night;
      options.push(['sleep', sleepy ? 1.25 : n.needs.energy < 0.18 ? 0.9 : 0]);
      options.push(['wander', 0.22]);
    }
    let bestType = 'wander';
    let bestScore = -Infinity;
    for (const [type, score] of options) {
      const s = score + Math.random() * 0.15;
      if (s > bestScore) { bestScore = s; bestType = type; }
    }
    startTask(n, bestType);
  };
  const startTask = (n, type) => {
    const P = layout.places;
    if (type === 'work') {
      const w = n.def.work;
      if (w === 'market') setTask(n, { type, to: P.merchantSpot, dur: rand(60, 120), face: P.customerSpot });
      else if (w === 'patrol') {
        n.patrolI = (n.patrolI + 1) % P.patrol.length;
        setTask(n, { type, to: P.patrol[n.patrolI], dur: rand(2, 6) });
      } else if (w === 'office') setTask(n, { type, to: P.officeSpot, dur: rand(25, 60), face: P.jail });
      else if (w === 'field') {
        const f = n.work;
        setTask(n, { type, to: randomNear(f.x, f.z, 1.6), dur: rand(18, 35), anim: 'farm', face: null });
      } else if (n.work) setTask(n, { type, to: n.work, dur: rand(45, 90), face: n.work.face, anim: w === 'tree' ? 'chop' : null });
      else setTask(n, { type: 'wander', to: randomNear(n.x, n.z, 14), dur: rand(2, 6) });
    } else if (type === 'deliver') {
      setTask(n, { type, to: randomNear(P.customerSpot.x, P.customerSpot.z, 1.5), dur: 3, face: P.market });
    } else if (type === 'eat') {
      setTask(n, { type, to: randomNear(P.customerSpot.x, P.customerSpot.z, 1.5), dur: 4, face: P.market });
    } else if (type === 'social') {
      const seat = fireSlot(n);
      setTask(n, { type, to: seat, dur: rand(25, 45), face: P.fire });
    } else if (type === 'sleep') {
      setTask(n, { type, to: n.home, dur: Infinity });
    } else {
      const roadish = Math.random() < 0.7;
      let to = randomNear(n.x, n.z, 18);
      if (roadish) {
        const cells = layout.nav.cellsWhere((i) => layout.nav.kindAt(i) >= 1
          && dist2(layout.nav.cellX(i), layout.nav.cellZ(i), n.x, n.z) < 22);
        if (cells.length) { const i = pickOf(cells); to = { x: layout.nav.cellX(i), z: layout.nav.cellZ(i) }; }
      }
      setTask(n, { type: 'wander', to, dur: rand(2, 7) });
    }
  };

  // ── Speech bubbles ──
  const say = (n, text, { big = false } = {}) => {
    if (!n.body || !text) return;
    if (n.bubble) { n.body.container.remove(n.bubble.sprite); n.bubble.sprite.material.map?.dispose(); n.bubble.sprite.material.dispose(); }
    const sprite = makeTextSprite(text, { height: big ? 0.26 : 0.2, bg: 'rgba(255, 255, 255, 0.92)', color: '#1a1d29', border: 'rgba(14, 17, 27, 0.25)' });
    sprite.position.set(0, 1.55 * heightScale(n.url) + (big ? 0.1 : 0), 0);
    sprite.renderOrder = 7;
    n.body.container.add(sprite);
    n.bubble = { sprite, until: simT + BUBBLE_S + (big ? 1.4 : 0) };
  };
  const clearBubble = (n) => {
    if (!n.bubble) return;
    n.bubble.sprite.parent?.remove(n.bubble.sprite);
    n.bubble.sprite.material.map?.dispose();
    n.bubble.sprite.material.dispose();
    n.bubble = null;
  };

  // ── Bodies (level of detail) ──
  const attachBody = (n, inst) => {
    const label = makeTextSprite(`${n.def.emoji} ${n.name}`, { height: 0.17 });
    label.position.set(0, 1.25 * heightScale(n.url), 0);
    label.visible = false;
    inst.container.add(label);
    inst.container.visible = true;
    inst.character.revive();
    inst.character.setMoving(false);
    n.body = { ...inst, label };
    root.add(inst.container);
    syncBody(n, 0);
  };
  const acquireBody = (n) => {
    if (n.body || n.bodyPending) return;
    const free = pool.get(n.url)?.pop();
    if (free) { attachBody(n, free); return; }
    n.bodyPending = true;
    createGLBCharacterInstance({ targetHeight: 1.0, url: n.url, armIK: false }).then((inst) => {
      n.bodyPending = false;
      if (active && n.wantsBody && !n.body && (n.alive || n.dying) && !n.fighter && !n.inside) attachBody(n, inst);
      else toPool(n.url, inst);
    }).catch((e) => { n.bodyPending = false; console.warn('[Town] character load failed:', e); });
  };
  const toPool = (url, inst) => {
    inst.container.parent?.remove(inst.container);
    const list = pool.get(url) ?? [];
    if (list.length >= 3) { inst.character.dispose(); return; }
    list.push(inst);
    pool.set(url, list);
  };
  const releaseBody = (n) => {
    if (!n.body) return;
    clearBubble(n);
    const { container, character, label } = n.body;
    container.remove(label);
    label.material.map?.dispose();
    label.material.dispose();
    n.body = null;
    toPool(n.url, { container, character });
  };
  const syncBody = (n, dt) => {
    const b = n.body;
    if (!b) return;
    b.container.position.set(n.x, groundY(n), n.z);
    b.container.rotation.y = n.yaw;
    if (!n.dying) b.character.setMoving(n.moving);
    b.character.animate(dt);
    b.character.stepFluff(dt);
    // (not right in front of the camera, where they'd fill the screen; at a market counter
    // nobody stands between the shop camera and the counter)
    const shop = stalls.view();
    const inFront = !!shop && shop.camera.distanceTo(b.container.position) < shop.camera.distanceTo(shop.stall) - 0.3;
    const nearCamera = inFront || ctx.camera.position.distanceTo(b.container.position) < CAMERA_CLEAR_DIST;
    b.container.visible = !inFront;
    b.label.visible = !n.dying && !nearCamera && distToPlayer(n) < LABEL_DIST;
    if (n.bubble && simT > n.bubble.until) clearBubble(n);
    if (n.bubble) n.bubble.sprite.visible = !nearCamera;
  };
  const updateLod = () => {
    const p = playerPos();
    const list = npcs.filter((n) => (n.alive || n.dying) && !n.inside && !n.fighter)
      .map((n) => ({ n, d: dist2(n.x, n.z, p.x, p.z) }))
      .sort((a, b) => a.d - b.d);
    list.forEach(({ n, d }, i) => {
      n.wantsBody = i < TOWN_MAX_BODIES && d < (n.body ? BODY_RELEASE_DIST : BODY_DIST);
      if (n.wantsBody) acquireBody(n);
      else releaseBody(n);
    });
    for (const n of npcs) {
      if ((n.inside || n.fighter) && n.body) { n.wantsBody = false; releaseBody(n); }
    }
  };

  // ── Fighting (a townsperson swapped for an EnemyPlayer) ──
  const promote = (n) => {
    if (n.fighter || !n.alive) return;
    releaseBody(n);
    n.inside = false;
    const e = ctx.spawnFighter({
      x: n.x, z: n.z, yaw: n.yaw, url: n.url, hearts: Math.max(1, n.hp),
      swingChance: n.def.law || n.def.outlaw ? 0.35 : 0.25,
      gear: fighterGear(n), name: `${n.def.emoji} ${n.name}`,
    });
    if (!e) return;
    n.fighter = e;
    n.hostile = true;
    n.task = { type: 'fight', t: 0, phase: 'do' };
    n.fightSince = simT;
    const baseDamage = e.applyDamage.bind(e);
    e.applyDamage = (amount) => {
      const killed = baseDamage(amount);
      onFighterHurt(n, killed);
      return killed;
    };
  };
  const demote = (n, next = null) => {
    const e = n.fighter;
    if (!e) return;
    n.fighter = null;
    n.hostile = false;
    n.x = e.group.position.x;
    n.z = e.group.position.z;
    n.yaw = e.group.rotation.y;
    n.hp = Math.max(1, e.hearts ?? n.hp);
    ctx.removeFighter(e);
    n.vendetta = false; // (they've had their go)
    if (next) next();
    else decide(n);
  };
  const onFighterHurt = (n, killed) => {
    n.lastHurtAt = simT;
    // (a follower's blow is theirs, not the player's — they only take on outlaws and townsfolk
    // already fighting the player)
    const byPlayer = !n.followerHit;
    n.followerHit = false;
    if (byPlayer) n.attitude = Math.max(-1, n.attitude - 0.3);
    if (killed) {
      n.hp = 0;
      ctx.releaseFighterGear(n.fighter);
      die(n, { byPlayer, bodyless: true });
      if (byPlayer && !isOutlaw(n)) crime('murder', n);
    } else if (byPlayer && n.def.law && law.stars < 2) {
      crime('assault', n);
    }
  };

  // ── Hurt / death ──
  const hurt = (n, dir, amount = 1) => {
    n.lastHitAt = simT;
    // Kids can't be hurt: they just run off
    if (n.def.unhurt) {
      n.attitude = Math.max(-1, n.attitude - 0.3);
      say(n, shout(SHOUT_HURT));
      flee(n);
      return;
    }
    n.lastHurtAt = simT;
    n.hp -= amount;
    n.attitude = Math.max(-1, n.attitude - 0.6);
    const outlaw = isOutlaw(n);
    const gy = groundY(n);
    ctx.spawnBlood(_v.set(n.x, gy + 0.55 * heightScale(n.url), n.z), gy);
    ctx.playSfx('hit');
    // a shove
    n.knock = { vx: dir.x * 3, vz: dir.z * 3, left: 0.25 };
    if (n.hp <= 0) {
      die(n, { byPlayer: true });
      if (outlaw) heroic(n);
      else crime('murder', n);
      return;
    }
    clearTalk(n);
    // Hitting an outlaw (a bandit, a mugger) is no crime — the town's grateful
    if (outlaw) heroic(n);
    else crime('assault', n);
    if (n.def.law || Math.random() < n.def.brave) {
      say(n, shout(n.def.law ? SHOUT_LAW : SHOUT_FIGHT));
      endBrawl(n);
      promote(n);
    } else {
      say(n, shout(SHOUT_HURT));
      flee(n);
    }
    if (!outlaw) rally(n);
  };
  const die = (n, { byPlayer = false, bodyless = false } = {}) => {
    if (!n.alive) return;
    n.alive = false;
    n.moving = false;
    clearTalk(n);
    if (!bodyless && n.body) {
      clearBubble(n);
      n.body.character.playDeath();
      n.dying = { until: simT + DEAD_BODY_S };
    }
    const at = new THREE.Vector3(n.x, groundY(n) + 0.3, n.z);
    if (n.money >= 1) ctx.dropCoins(at, Math.min(3, 1 + Math.floor(n.money / 8)));
    endBrawl(n);
    if (n.def.outlaw) {
      // A bandit: the gang finds a new one in a while; no grief in town
      feedLine(`💀 ${n.name} is down.`);
      arrivals.push({ role: n.role, at: simT + rand(...BANDIT_RETURN_S) });
      onJobDeath(n, byPlayer);
      save();
      return;
    }
    gossip.push({ kind: 'murder', who: firstName(n.name), by: byPlayer ? 'player' : null, at: simT, fresh: true });
    feedLine(`💀 ${n.name} the ${n.def.label} is dead.`);
    arrivals.push({ role: n.role, at: simT + rand(...NEWCOMER_DELAY_S) });
    departed = [...departed, firstName(n.name)].slice(-20);
    // Their family won't forget who did it
    if (byPlayer && !isOutlaw(n)) {
      for (const k of family(n)) {
        k.attitude = -1;
        if (!k.def.unhurt) { k.vendetta = true; k.vendettaFor = relationOf(n.role); }
      }
    }
    onJobDeath(n, byPlayer);
    // Everyone near runs
    for (const o of npcs) {
      if (o !== n && o.alive && !o.fighter && !o.def.law && dist2(o.x, o.z, n.x, n.z) < 14) flee(o);
    }
    save();
  };
  // (from: what they run from — the player by default)
  const flee = (n, from = null) => {
    if (!n.alive || n.fighter || n.jailedUntil > simT) return;
    n.fear = 12;
    clearTalk(n);
    endBrawl(n);
    if (n.following) n.following = false;
    const p = from ?? playerPos();
    // Home if it's away from the player, otherwise straight away from them
    const homeAway = dist2(n.home.x, n.home.z, p.x, p.z) > dist2(n.x, n.z, p.x, p.z) + 4;
    let to = n.home;
    if (!homeAway) {
      const ax = n.x - p.x;
      const az = n.z - p.z;
      const d = Math.hypot(ax, az) || 1;
      const tx = n.x + (ax / d) * 18;
      const tz = n.z + (az / d) * 18;
      const i = layout.nav.nearestWalkable(tx, tz);
      to = i >= 0 ? { x: layout.nav.cellX(i), z: layout.nav.cellZ(i) } : n.home;
    }
    setTask(n, { type: 'flee', to, dur: 0, run: true, hide: to === n.home });
  };

  // ── Crime and the law ──
  const lawNpcs = () => npcs.filter((n) => n.alive && n.def.law);
  // kind: 'assault' | 'murder' | 'theft' (victim: the owner, or null)
  const crime = (kind, victim) => {
    const p = playerPos();
    const witnesses = npcs.filter((n) => n.alive && !n.inside
      && (n === victim || n.attitude < FRIEND_ATTITUDE)
      && dist2(n.x, n.z, p.x, p.z) < WITNESS_DIST
      && ((n === victim && kind !== 'theft') || sees(n)));
    gossip.push({ kind, who: victim ? firstName(victim.name) : '', by: 'player', at: simT, fresh: true });
    if (gossip.length > 12) gossip.shift();
    if (!witnesses.length) {
      if (kind === 'murder') feedLine('🤫 Nobody saw that.');
      return;
    }
    const before = law.stars;
    if (kind === 'murder') law.stars = Math.min(3, Math.max(law.stars + 1, 2));
    else if (victim?.def.law) law.stars = Math.max(law.stars, 2);
    else law.stars = Math.max(law.stars, 1);
    law.peak = Math.max(law.peak, law.stars);
    law.lastSeenAt = simT;
    law.lastKnown.copy(p);
    for (const w of witnesses) {
      w.attitude = Math.max(-1, w.attitude - (kind === 'murder' ? 0.6 : kind === 'theft' ? 0.2 : 0.3));
      if (w === victim || w.fighter || w.def.law) continue;
      if (kind === 'theft') { say(w, shout(SHOUT_THIEF)); continue; }
      flee(w);
      if (Math.random() < 0.6) say(w, kind === 'murder' ? shout(SHOUT_MURDER) : shout(SHOUT_HELP));
    }
    if (kind === 'theft' && victim?.alive && witnesses.includes(victim)) say(victim, 'Oi! Those are mine!');
    if (law.stars > before) {
      const w = witnesses.find((x) => x !== victim) ?? witnesses[0];
      feedLine(`🚨 ${firstName(w.name)} saw that! ${'★'.repeat(law.stars)}`);
    }
    renderStars();
  };
  const respond = (n) => {
    const target = { x: law.lastKnown.x, z: law.lastKnown.z };
    setTask(n, { type: 'respond', to: target, dur: 0, run: true });
    n.task.target = target;
    n.task.plannedAt = simT;
  };
  const standDown = () => {
    law.stars = 0;
    law.peak = 0;
    for (const n of npcs) {
      if (!n.alive || !n.def.law) continue;
      if (n.fighter) demote(n);
      else if (n.task?.type === 'respond' || n.task?.type === 'search') decide(n);
    }
    renderStars();
  };
  const updateLaw = () => {
    if (law.stars <= 0 || sequence) { law.seen = false; return; }
    const p = playerPos();
    const officers = lawNpcs();
    // Who answers: the nearest guard at ★, the guards at ★★, everyone at ★★★
    officers.sort((a, b) => (a.role === 'sheriff') - (b.role === 'sheriff') || distToPlayer(a) - distToPlayer(b));
    const count = law.stars >= 3 ? officers.length : law.stars >= 2 ? Math.max(1, officers.filter((o) => o.role !== 'sheriff').length) : 1;
    const responders = officers.slice(0, count);
    let seen = false;
    for (const n of responders) {
      if (n.inside) { n.inside = false; n.x = n.home.x; n.z = n.home.z; }
      const d = distToPlayer(n);
      const sight = d < LAW_SIGHT && sees(n);
      if (sight) seen = true;
      if (n.fighter) continue;
      if (sight && d < ENGAGE_DIST && !ctx.isPlayerDead()) {
        promote(n);
        continue;
      }
      // Run to where the player was last seen (again when that's moved on)
      const t = n.task;
      const chasing = t?.type === 'respond' || t?.type === 'search';
      const moved = chasing && dist2(t.target.x, t.target.z, law.lastKnown.x, law.lastKnown.z) > 2.5;
      if (!chasing || (moved && simT - t.plannedAt > 1.5)) {
        if (!chasing && Math.random() < 0.5) say(n, shout(SHOUT_LAW));
        respond(n);
      }
    }
    // Fighters see what's in front of them
    if (officers.some((n) => n.fighter && distToPlayer(n) < LAW_SIGHT)) seen = true;
    law.seen = seen;
    if (seen) {
      law.lastSeenAt = simT;
      law.lastKnown.copy(p);
    } else if (simT - law.lastSeenAt > HEAT_DECAY_S) {
      law.stars -= 1;
      law.lastSeenAt = simT;
      if (law.stars <= 0) {
        feedLine('😮‍💨 The guards gave up looking for you.');
        standDown();
      } else {
        feedLine(`👀 Lost them… ${'★'.repeat(law.stars)}`);
      }
    }
    renderStars();
  };

  // ── Reactions ──
  const isOutlaw = (n) => !!n.def.outlaw || n.outlawUntil > simT;
  // Same house = family (bandits have none)
  const family = (n) => (n.homeIndex < 0 ? [] : npcs.filter((o) => o !== n && o.alive && o.homeIndex === n.homeIndex));
  const followers = () => npcs.filter((n) => n.alive && n.following);
  // Guards carry a shield; the sheriff a gun too once it's ★★★; bandits' gear is their role's
  const fighterGear = (n) => {
    if (n.def.gear) return n.def.gear;
    if (n.role === 'sheriff') return law.stars >= 3 ? { gun: true, shield: true } : { shield: true };
    if (n.def.law) return { shield: true };
    return null;
  };
  // Line of sight from a townsperson's eyes to a point (the player: sees)
  const seesPoint = (n, x, y, z) => {
    _v.set(n.x, groundY(n) + 0.8, n.z);
    _v2.set(x, y + 0.8, z);
    return !raycastMapSegment(_v, _v2);
  };
  // The player hurt an outlaw: those who see it think better of them
  const heroic = (victim) => {
    const p = playerPos();
    for (const w of npcs) {
      if (!w.alive || w === victim || w.def.outlaw || dist2(w.x, w.z, p.x, p.z) > WITNESS_DIST) continue;
      w.attitude = Math.min(1, w.attitude + 0.12);
      if (victim.mugVictim === w && Math.random() < 0.7) say(w, fillLine(pickOf(SHOUT_THANKS), { name: ctx.getPlayerName() }));
    }
  };
  // A townsperson the player hurt: their family and the brave nearby step in
  const rally = (victim) => {
    const kin = new Set(family(victim));
    let n = 0;
    for (const o of npcs) {
      if (n >= RALLY_MAX) break;
      if (o === victim || !o.alive || o.fighter || o.inside || o.def.law || o.def.outlaw || o.def.unhurt
        || o.following || o.jailedUntil > simT || o.attitude >= FRIEND_ATTITUDE) continue;
      const isKin = kin.has(o);
      if (distToPlayer(o) > (isKin ? RALLY_DIST * 1.6 : RALLY_DIST)) continue;
      if (!isKin && o.def.brave < 0.5) continue;
      say(o, fillLine(pickOf(SHOUT_RALLY), { who: firstName(victim.name) }));
      endBrawl(o);
      promote(o);
      n += 1;
    }
  };
  // Grudges: a vendetta attacks on sight; a deep grudge steps aside
  const reactToPlayer = (n) => {
    if (n.fighter || n.inside || n.jailedUntil > simT || sequence || ctx.isPlayerDead()) return;
    const d = distToPlayer(n);
    if (n.vendetta && d < VENDETTA_SIGHT && sees(n)) {
      say(n, fillLine(pickOf(SHOUT_VENDETTA), { rel: n.vendettaFor || 'friend' }));
      endBrawl(n);
      promote(n);
      return;
    }
    if (n.def.outlaw && d < BANDIT_SIGHT && sees(n) && !n.task?.mugging) {
      say(n, pickOf(SHOUT_BANDIT));
      endBrawl(n);
      promote(n);
      return;
    }
    if (n.attitude < GRUDGE_ATTITUDE && d < AVOID_DIST && simT > n.avoidAt && !n.def.law
      && !['flee', 'sleep', 'brawl', 'arrest', 'mug', 'raid'].includes(n.task?.type)) {
      n.avoidAt = simT + 20;
      say(n, pickOf(SHOUT_STAY_BACK));
      flee(n);
      n.fear = 4;
    }
  };

  // ── Townsfolk fighting each other (light bodies: blows on a timer, no EnemyPlayers) ──
  // mode: 'mug' (the attacker takes the purse and goes), 'arrest' (a guard, until the other
  // gives up), 'fight'
  const startBrawl = (a, b, mode) => {
    if (!a.alive || !b.alive || a.fighter || b.fighter) return;
    a.task = { type: 'brawl', t: 0, phase: 'do', foe: b, mode, attacker: true };
    b.task = { type: 'brawl', t: 0, phase: 'do', foe: a, mode, attacker: false };
    a.path = null;
    b.path = null;
    a.nextBlowAt = simT + 0.4;
    b.nextBlowAt = simT + rand(...BRAWL_HIT_S);
    if (mode === 'mug') { say(a, pickOf(SHOUT_MUG)); b.mugVictim = null; a.mugVictim = b; }
    if (mode === 'arrest') say(a, pickOf(SHOUT_ARREST));
  };
  const endBrawl = (n) => {
    const t = n.task;
    if (t?.type !== 'brawl') return;
    n.task = null;
    const o = t.foe;
    if (o?.task?.type === 'brawl' && o.task.foe === n) o.task = null;
  };
  // One townsperson's blow on another
  const npcHit = (victim, attacker, amount = 1) => {
    if (!victim.alive) return;
    if (victim.def.unhurt) { flee(victim, attacker); return; }
    victim.hp -= amount;
    victim.lastHurtAt = simT;
    if (victim.body && distToPlayer(victim) < 25) {
      const gy = groundY(victim);
      ctx.spawnBlood(_v.set(victim.x, gy + 0.55 * heightScale(victim.url), victim.z), gy);
      if (distToPlayer(victim) < 12) ctx.playSfx('hit');
    }
    const dx = victim.x - attacker.x;
    const dz = victim.z - attacker.z;
    const d = Math.hypot(dx, dz) || 1;
    victim.knock = { vx: (dx / d) * 2.5, vz: (dz / d) * 2.5, left: 0.2 };
    if (victim.hp <= 0) {
      die(victim, { byPlayer: false });
      if (!victim.def.outlaw) npcCrime(attacker, 'murder', victim);
    }
  };
  // A townsperson (or bandit) seen attacking / robbing someone is wanted: a guard comes for them
  const npcCrime = (culprit, kind, victim) => {
    const seen = npcs.some((w) => w.alive && !w.inside && w !== culprit && !w.def.outlaw
      && dist2(w.x, w.z, culprit.x, culprit.z) < WITNESS_DIST
      && (w === victim || seesPoint(w, culprit.x, groundY(culprit), culprit.z)));
    if (!seen) return;
    culprit.outlawUntil = simT + OUTLAW_S;
    gossip.push({ kind: kind === 'murder' ? 'murder' : 'assault', who: firstName(victim.name), by: firstName(culprit.name), at: simT, fresh: true });
    if (distToPlayer(culprit) < 35) feedLine(`🚨 ${firstName(culprit.name)} ${kind === 'mug' ? 'robbed' : kind === 'theft' ? 'stole from' : 'attacked'} ${firstName(victim.name)}!`);
    sendGuard(culprit);
  };
  // The nearest free guard goes to arrest an outlaw townsperson
  const sendGuard = (culprit) => {
    if (law.stars > 0 && distToPlayer(culprit) < LAW_SIGHT) return; // (busy with the player)
    const guard = lawNpcs().filter((g) => !g.fighter && !g.inside && g.jailedUntil <= simT
      && !['respond', 'search', 'arrest', 'brawl'].includes(g.task?.type))
      .sort((a, b) => dist2(a.x, a.z, culprit.x, culprit.z) - dist2(b.x, b.z, culprit.x, culprit.z))[0];
    if (!guard) return;
    guard.task = { type: 'arrest', t: 0, phase: 'go', target: culprit, run: true };
    guard.path = null;
  };
  // An outlaw in the cell for a while
  const jailNpc = (n, by) => {
    endBrawl(n);
    n.outlawUntil = 0;
    n.jailedUntil = simT + NPC_JAIL_S;
    n.hp = Math.max(n.hp, 1);
    const P = layout.places;
    n.x = P.jail.x + rand(-0.4, 0.4);
    n.z = P.jail.z + rand(-0.4, 0.4);
    n.path = null;
    setTask(n, { type: 'jailed', dur: Infinity });
    if (distToPlayer(n) < 35 || distToPlayer(by) < 35) feedLine(`👮 ${firstName(by.name)} locked up ${firstName(n.name)}.`);
    gossip.push({ kind: 'jailed', who: firstName(n.name), by: firstName(by.name), at: simT, fresh: true });
  };
  // A drifter (or bandit) picks someone out on their own
  const startMugging = (n) => {
    const victim = npcs.filter((o) => o !== n && o.alive && !o.fighter && !o.inside && !o.def.law && !o.def.outlaw
      && !o.def.unhurt && !o.following && o.jailedUntil <= simT && o.money >= 2
      && dist2(o.x, o.z, n.x, n.z) < 28)
      .sort((a, b) => dist2(a.x, a.z, n.x, n.z) - dist2(b.x, b.z, n.x, n.z))[0];
    if (!victim) return false;
    n.task = { type: 'mug', t: 0, phase: 'go', target: victim, mugging: true };
    n.path = null;
    return true;
  };
  // A bandit's day: loiter at the camp; at night raid a field or rob someone in town
  const decideBandit = (n, h) => {
    const P = layout.places;
    const night = h >= 21 || h < 4;
    if (night && !n.loot) {
      const r = Math.random();
      if (r < RAID_CHANCE && P.fields.length) { startRaid(n, pickOf(P.fields)); return; }
      if (r < RAID_CHANCE + BANDIT_MUG_CHANCE && startMugging(n)) return;
    }
    if (n.loot && dist2(n.x, n.z, P.camp.x, P.camp.z) > BANDIT_CAMP_R) {
      setTask(n, { type: 'raidHome', to: randomNear(P.camp.x, P.camp.z, 3), dur: 2, run: true });
      return;
    }
    n.loot = 0;
    const near = Math.random() < 0.5 ? P.campFire : P.camp;
    setTask(n, { type: 'camp', to: randomNear(near.x, near.z, BANDIT_CAMP_R * 0.6), dur: rand(6, 16), face: P.campFire });
  };
  const startRaid = (n, field, jobId = null) => {
    setTask(n, { type: 'raid', to: randomNear(field.x, field.z, 1.5), dur: 5, run: true, field, jobId });
  };
  // Followers: friends who come along
  const canRecruit = (n) => n.alive && !n.following && n.attitude >= FOLLOW_ATTITUDE && !n.def.law && !n.def.outlaw
    && !n.def.unhurt && n.role !== 'merchant' && followers().length < MAX_FOLLOWERS && law.stars < 2;
  const recruit = (n) => {
    if (!canRecruit(n)) return;
    n.following = true;
    clearTalk(n);
    setTask(n, { type: 'follow', dur: Infinity });
    say(n, fillLine(pickOf(FOLLOW_LINES.join), { name: ctx.getPlayerName() }), { big: true });
    feedLine(`🤝 ${firstName(n.name)} is coming with you.`);
  };
  const dismiss = (n, line = FOLLOW_LINES.leave) => {
    if (!n.following) return;
    n.following = false;
    clearTalk(n);
    say(n, fillLine(pickOf(line), { name: ctx.getPlayerName() }));
    decide(n);
  };
  // Walk toward a moving spot (re-planned now and then)
  const chase = (n, x, z, dt, run) => {
    if (!n.path || n.pathI >= n.path.length || simT > (n.replanAt ?? 0)) {
      planPath(n, x, z);
      n.replanAt = simT + 1.2;
    }
    stepPath(n, dt, (run ? RUN_SPEED : WALK_SPEED) * n.speedScale);
  };
  // A swing (the throw clip) toward something
  const swingAt = (n, x, z) => {
    n.yaw = Math.atan2(x - n.x, z - n.z);
    if (n.body) n.body.character.playAction(glbCharacterConfig.throwClip);
  };
  // Tasks with their own per-frame logic; true when handled
  const updateSpecialTask = (n, t, dt) => {
    const P = layout.places;
    switch (t.type) {
      case 'jailed':
        n.moving = false;
        faceToward(n, P.jail.x + Math.sin(P.jailYaw) * 3, P.jail.z + Math.cos(P.jailYaw) * 3, dt);
        if (simT > n.jailedUntil) {
          n.jailedUntil = 0;
          n.x = P.officeSpot.x;
          n.z = P.officeSpot.z;
          n.task = null;
          decide(n);
        }
        return true;
      case 'lost':
        n.moving = false;
        if (!n.bubble && Math.random() < dt / 6) say(n, pickOf(['Mum? Dad?', 'I want to go home…', '*sniff*']));
        return true;
      case 'follow': {
        const p = playerPos();
        if (law.stars >= 2 && !n.escort) { dismiss(n, FOLLOW_LINES.wanted); n.attitude -= 0.2; return true; }
        // Help: the nearest hostile fighter (not the law) near the player (not a kid being walked home)
        const foe = n.def.unhurt ? null : npcs.filter((o) => o.fighter && !o.def.law && !o.fighter.isDead
          && dist2(o.x, o.z, p.x, p.z) < FOLLOW_HELP_DIST)
          .sort((a, b) => dist2(a.x, a.z, n.x, n.z) - dist2(b.x, b.z, n.x, n.z))[0];
        if (foe) {
          const fp = foe.fighter.group.position;
          if (dist2(n.x, n.z, fp.x, fp.z) > BRAWL_REACH) chase(n, fp.x, fp.z, dt, true);
          else {
            n.moving = false;
            faceToward(n, fp.x, fp.z, dt);
            if (simT > n.nextBlowAt) {
              n.nextBlowAt = simT + FOLLOW_HIT_S;
              swingAt(n, fp.x, fp.z);
              foe.followerHit = true;
              const dir = new THREE.Vector3(fp.x - n.x, 0, fp.z - n.z).normalize();
              const killed = foe.fighter.applyDamage(1);
              if (!killed) foe.fighter.applyDirectKnockback?.({ direction: dir, horizSpeed: 3, upVelocity: 0.2, torqueMag: 0, ragdoll: false });
            }
          }
          return true;
        }
        // Keep up: a spot behind the player
        const d = dist2(n.x, n.z, p.x, p.z);
        if (d > FOLLOW_GAP + 1) {
          const k = (d - FOLLOW_GAP) / d;
          chase(n, n.x + (p.x - n.x) * k, n.z + (p.z - n.z) * k, dt, d > 6);
        } else {
          n.moving = false;
          n.path = null;
          faceToward(n, p.x, p.z, dt);
        }
        return true;
      }
      case 'mug': {
        const v = t.target;
        if (!v?.alive || v.fighter || v.inside || v.jailedUntil > simT) { n.task = null; decide(n); return true; }
        if (dist2(n.x, n.z, v.x, v.z) > BRAWL_REACH) chase(n, v.x, v.z, dt, true);
        else startBrawl(n, v, 'mug');
        return true;
      }
      case 'arrest': {
        const c = t.target;
        if (!c?.alive || c.fighter || c.jailedUntil > simT || !isOutlaw(c)) { n.task = null; decide(n); return true; }
        if (dist2(n.x, n.z, c.x, c.z) > BRAWL_REACH) chase(n, c.x, c.z, dt, true);
        else startBrawl(n, c, 'arrest');
        return true;
      }
      case 'brawl': {
        const o = t.foe;
        if (!o?.alive || o.task?.type !== 'brawl' || o.task.foe !== n) { n.task = null; return true; }
        n.moving = false;
        faceToward(n, o.x, o.z, dt);
        if (dist2(n.x, n.z, o.x, o.z) > BRAWL_REACH + 0.6) {
          // (knocked apart: close in again)
          if (t.attacker) chase(n, o.x, o.z, dt, true);
          return true;
        }
        if (simT < n.nextBlowAt) return true;
        n.nextBlowAt = simT + rand(...BRAWL_HIT_S);
        // The one defending may just run (the timid), or give up (an arrest)
        if (!t.attacker && t.mode === 'mug' && Math.random() > n.def.brave) {
          endBrawl(n);
          flee(n, o);
          return true;
        }
        swingAt(n, o.x, o.z);
        npcHit(o, n);
        if (!o.alive) { n.task = null; return true; }
        if (t.attacker && t.mode === 'mug') {
          // Got the purse: off with it
          const stolen = Math.ceil(o.money / 2);
          o.money -= stolen;
          n.money += stolen;
          n.loot += 1;
          endBrawl(n);
          say(o, shout(SHOUT_THIEF));
          npcCrime(n, 'mug', o);
          flee(o, n);
          if (n.def.outlaw) setTask(n, { type: 'raidHome', to: randomNear(P.camp.x, P.camp.z, 3), dur: 2, run: true });
          else startTask(n, 'wander');
          return true;
        }
        if (t.mode === 'arrest' && n.def.law && (o.hp <= 1 || Math.random() < 0.25)) {
          jailNpc(o, n);
          n.task = null;
          decide(n);
        }
        return true;
      }
      default:
        return false;
    }
  };

  // ── Busted / knocked out ──
  const fadeTo = (on) => fade.classList.toggle('town-fade-on', on);
  const later = (token, ms, fn) => setTimeout(() => { if (sequence === token && active) fn(); }, ms);
  const removeAllFighters = () => { for (const n of npcs) if (n.fighter) demote(n); };
  const busted = ({ surrendered = false } = {}) => {
    if (sequence) return;
    const token = {};
    sequence = token;
    const peak = Math.max(1, law.peak);
    const fine = Math.min(ctx.getCoins(), FINE_PER_STAR * peak);
    removeAllFighters();
    standDown();
    clearAllTalk();
    closeMarket();
    fishing = null;
    lockpick.stop();
    closeBoard();
    for (const f of followers()) dismiss(f, FOLLOW_LINES.wanted);
    ctx.showBanner('BUSTED!', surrendered ? 'You came quietly.' : 'The guards got you.', 2400);
    gossip.push({ kind: 'arrest', who: '', by: 'player', at: simT, fresh: true });
    // Two guards carry the player off (the Showdown death carry), then the cell
    later(token, 900, () => ctx.carryPlayerOff({
      carrierUrl: characterForRole('guard'),
      onDone: () => { if (sequence === token && active) toCell(); },
    }));
    const toCell = () => {
      fadeTo(true);
      later(token, 700, () => {
        const P = layout.places;
        ctx.revivePlayer(P.jail.x, P.jail.z, P.jailYaw + Math.PI);
        if (fine > 0) ctx.addCoins(-fine);
        feedLine(fine > 0 ? `⚖️ Fined ${fine} 🪙` : '⚖️ Locked up.');
        if (Object.values(ctx.getItems() ?? {}).some(Boolean)) {
          ctx.confiscate();
          feedLine('🗡️ The guards took your weapons.');
        }
        advanceClock(3 * 60);
        startJail();
        fadeTo(false);
        sequence = null;
      });
    };
  };
  const knockedOut = () => {
    if (sequence) return;
    const token = {};
    sequence = token;
    removeAllFighters();
    clearAllTalk();
    closeMarket();
    fishing = null;
    const lost = Math.floor(ctx.getCoins() * KO_COIN_SHARE);
    ctx.showBanner('KNOCKED OUT', 'You wake up by the fire…', 2400);
    later(token, 1800, () => {
      fadeTo(true);
      later(token, 700, () => {
        const P = layout.places;
        ctx.revivePlayer(P.spawn.x, P.spawn.z, Math.atan2(P.fire.x - P.spawn.x, P.fire.z - P.spawn.z));
        if (lost > 0) { ctx.addCoins(-lost); feedLine(`🪙 Someone helped themselves to ${lost} coins…`); }
        advanceClock(2 * 60);
        fadeTo(false);
        sequence = null;
      });
    });
  };
  const startJail = () => {
    const P = layout.places;
    jail = { left: JAIL_S };
    layout.props.door.rotation.y = 0;
    ctx.setPositionConstraint((controls) => {
      const dx = controls.playerX - P.jail.x;
      const dz = controls.playerZ - P.jail.z;
      const d = Math.hypot(dx, dz);
      const max = 0.75;
      if (d > max) {
        controls.playerX = P.jail.x + (dx / d) * max;
        controls.playerZ = P.jail.z + (dz / d) * max;
      }
    });
    renderJail();
  };
  const endJail = (text) => {
    if (!jail) return;
    jail = null;
    ctx.setPositionConstraint(null);
    jailChip.classList.add('hidden');
    feedLine(text);
  };
  const payBail = () => {
    if (!jail) return;
    if (ctx.getCoins() < BAIL) { feedLine(`🪙 Bail is ${BAIL} coins.`); return; }
    ctx.addCoins(-BAIL);
    ctx.playSfx('coin');
    endJail('🔓 Bail paid. Behave yourself.');
  };
  // A bribe works if an officer near the cell doesn't mind the player (or by luck)
  const bribe = () => {
    if (!jail) return;
    if (ctx.getCoins() < BRIBE) { feedLine(`🪙 A bribe takes ${BRIBE} coins.`); return; }
    ctx.addCoins(-BRIBE);
    const P = layout.places;
    const officer = lawNpcs().filter((o) => !o.inside && dist2(o.x, o.z, P.jail.x, P.jail.z) < 30)
      .sort((a, b) => b.attitude - a.attitude)[0];
    const ok = (officer && officer.attitude >= -0.2) || Math.random() < BRIBE_ODDS;
    if (ok) {
      if (officer) officer.money += BRIBE;
      endJail(`🤝 ${officer ? firstName(officer.name) : 'The guard'} looks the other way. You\'re out.`);
    } else {
      jail.left += 15;
      feedLine('😠 The guard pockets the coins and laughs. +15 s');
    }
  };
  // Sleep it off: out in the morning (the clock jumps)
  const sleepItOff = () => {
    if (!jail || sequence) return;
    const token = {};
    sequence = token;
    fadeTo(true);
    later(token, 800, () => {
      const h = hour();
      advanceClock(((WAKE_HOUR - h + 24) % 24 || 24) * 60);
      endJail('☀️ Morning. The guard lets you out.');
      fadeTo(false);
      sequence = null;
    });
  };
  // Pick the lock (townLockpick.js): out, but the guards come running
  const startLockpick = () => {
    if (!jail || lockpick.isOpen()) return;
    lockpick.start((success) => {
      if (!jail) return;
      if (success) {
        endJail('🔓 Click. The door swings open…');
        law.stars = Math.max(law.stars, 1);
        law.peak = Math.max(law.peak, law.stars);
        law.lastSeenAt = simT;
        law.lastKnown.copy(playerPos());
        feedLine('🚨 Jailbreak! The guards are after you.');
        renderStars();
      } else {
        jail.left += LOCK_SLIP_S;
        feedLine(`🔧 The pick slipped — a guard heard. +${LOCK_SLIP_S} s`);
      }
    });
  };
  const renderJail = () => {
    if (!jail) return;
    jailChip.classList.remove('hidden');
    jailChip.textContent = `🔒 In jail · ${Math.ceil(jail.left)} s`;
  };

  // ── Talking with the player ──
  const talkTo = (n) => {
    if (!n.alive || !n.body) return;
    if (n.fear > 0) { say(n, talkLine(n)); return; }
    if (n.following) { say(n, fillLine(pickOf(FOLLOW_LINES.join), { name: ctx.getPlayerName() }), { big: true }); talking = { npc: n }; return; }
    const taskType = n.task?.type === 'talk' ? n.task.prevType : n.task?.type;
    if (n.task?.type !== 'talk') {
      n.task = { type: 'talk', t: 0, phase: 'do', dur: 7, prevType: taskType };
      n.path = null;
      n.moving = false;
    } else {
      n.task.t = 0;
    }
    talking = { npc: n };
    say(n, talkLine(n, { playerName: ctx.getPlayerName(), taskType, market: marketTalk() }), { big: true });
    if (simT - n.talkBonusAt > 60) {
      n.talkBonusAt = simT;
      n.attitude = Math.min(1, n.attitude + 0.04);
    }
  };
  const gift = (n) => {
    if (!n.alive) return;
    if (ctx.getCoins() < GIFT_COINS) { say(n, giftLine(n, ctx.getPlayerName(), true), { big: true }); return; }
    ctx.addCoins(-GIFT_COINS);
    ctx.playSfx('coin');
    n.money += GIFT_COINS;
    n.attitude = Math.min(1, n.attitude + 0.25);
    if (n.task?.type === 'talk') n.task.t = 0;
    say(n, giftLine(n, ctx.getPlayerName()), { big: true });
    if (n.attitude >= FRIEND_ATTITUDE && !n.friendNoted) {
      n.friendNoted = true;
      feedLine(`🤝 ${firstName(n.name)} is your friend now — they won't tell the guards on you.`);
    }
  };
  const clearTalk = (n) => {
    if (talking?.npc === n) talking = null;
    if (n.task?.type === 'talk') n.task = null;
  };
  const clearAllTalk = () => {
    talking = null;
    for (const n of npcs) if (n.task?.type === 'talk') n.task = null;
  };

  // What the market's like, for the townsfolk's talk
  const marketTalk = () => {
    const scarce = market.scarcest();
    return {
      scarce: scarce ? { ...GOODS[scarce], price: market.price(scarce) } : null,
      foodOut: !market.cheapestFood(),
      merchantGone: !npcs.some((m) => m.alive && m.role === 'merchant'),
    };
  };

  // ── The player's goods, gathering and trade ──
  const gain = (g, n = 1) => {
    goods[g] += n;
    renderGoods();
  };
  // Food for health (the goods pill / 🍽 Eat)
  const eat = (g) => {
    if (!GOODS[g]?.food || goods[g] <= 0 || sequence || ctx.isPlayerDead()) return;
    const { health, max } = ctx.getHealth();
    if (health >= max) { feedLine('❤️ You\'re not hungry.'); return; }
    goods[g] -= 1;
    ctx.heal(GOODS[g].heal);
    renderGoods();
    feedLine(`😋 Ate a ${GOODS[g].label.toLowerCase()}. +${GOODS[g].heal} ❤️`);
  };
  const hurtFood = () => {
    const { health, max } = ctx.getHealth();
    if (health >= max) return null;
    return FOOD_IDS.filter((g) => goods[g] > 0).sort((a, b) => GOODS[b].heal - GOODS[a].heal)[0] ?? null;
  };
  // Chop: the sword tip in a trunk (CHOP_HITS hits a log)
  const tryChop = (tip) => {
    const p = playerPos();
    for (const t of layout.trees) {
      if (dist2(t.x, t.z, p.x, p.z) > 3) continue;
      if (dist2(t.x, t.z, tip.x, tip.z) > CHOP_REACH) continue;
      const gy = groundAt(t.x, t.z);
      if (tip.y < gy + 0.1 || tip.y > gy + 2.6) continue;
      if (simT - t.hitAt < 0.45) return true;
      t.hitAt = simT;
      ctx.playSfx('chop');
      if (t.wood <= 0) {
        feedLine('🌳 This tree needs time to grow back.');
        return true;
      }
      t.hits += 1;
      if (t.hits >= CHOP_HITS) {
        t.hits = 0;
        t.wood -= 1;
        if (t.growAt <= simT) t.growAt = simT + TREE_REGROW_S; // (grows back one at a time)
        gain('wood');
        feedLine(`🪵 +1 Wood (${goods.wood})`);
      }
      return true;
    }
    return false;
  };
  const ripeCropNear = () => {
    const p = playerPos();
    for (const f of layout.places.fields) {
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
    crop.growAt = simT + CROP_REGROW_S;
    crop.mesh.visible = false;
    gain('crops');
    feedLine(`🥕 +1 Veg (${goods.crops})`);
    const owner = npcs.find((n) => n.alive && n.role === 'farmer' && n.work === field) ?? null;
    crime('theft', owner);
  };
  const nearWater = () => {
    const p = playerPos();
    const nav = layout.nav;
    const r = FISH_WATER_CELLS * NAV_CELL;
    for (let dz = -r; dz <= r; dz += NAV_CELL) {
      for (let dx = -r; dx <= r; dx += NAV_CELL) {
        if (nav.isWater(nav.indexAt(p.x + dx, p.z + dz))) return true;
      }
    }
    return false;
  };
  const startFishing = () => {
    if (fishing) return;
    const p = playerPos();
    fishing = { left: rand(...FISH_S), x: p.x, z: p.z };
    feedLine('🎣 Line\'s in the water…');
  };
  const updateFishing = (dt) => {
    if (!fishing) return;
    const p = playerPos();
    if (dist2(p.x, p.z, fishing.x, fishing.z) > FISH_CANCEL_DIST || ctx.isPlayerDead()) {
      fishing = null;
      return;
    }
    fishing.left -= dt;
    if (fishing.left > 0) return;
    fishing = null;
    if (Math.random() < FISH_CHANCE) {
      gain('fish');
      feedLine(`🐟 Caught a fish! (${goods.fish})`);
    } else {
      feedLine('🐟 It got away…');
    }
  };
  // Trees and crops grow back
  const updateRegrowth = () => {
    for (const t of layout.trees) {
      if (t.wood < TREE_WOOD && simT > t.growAt) {
        t.wood += 1;
        t.growAt = simT + TREE_REGROW_S;
      }
    }
    for (const f of layout.places.fields) {
      for (const c of f.crops) {
        if (!c.ripe && simT > c.growAt) { c.ripe = true; c.mesh.visible = true; }
      }
    }
  };

  // ── The market: the goods stall + the weapon stall (townStalls.js), the sell panel ──
  const stallPos = (key) => (key === 'gear' ? layout.places.gearStall : layout.places.market);
  const nearStallKey = (key) => {
    const p = playerPos();
    const at = stallPos(key);
    return dist2(p.x, p.z, at.x, at.z) < TRADE_DIST;
  };
  // The stall the player is at (the nearer one), or null
  const nearestStall = () => {
    const p = playerPos();
    const d = (key) => dist2(p.x, p.z, stallPos(key).x, stallPos(key).z);
    const key = d('gear') < d('goods') ? 'gear' : 'goods';
    return d(key) < TRADE_DIST ? key : null;
  };
  const nearStall = () => nearStallKey('goods');
  // The weapon stall keeps the market's hours (its keeper isn't one of the townsfolk)
  const gearOpen = () => inHours(hour(), MARKET_HOURS);
  const stallOpen = (key) => (key === 'gear' ? gearOpen() : marketOpen());
  const calmNow = () => !npcs.some((n) => n.fighter && distToPlayer(n) < 8);
  const canShop = (key) => active && ready && !!key && !sequence && !jail && !fishing && !ctx.isPlayerDead()
    && !marketPanel.isOpen() && calmNow() && stallOpen(key);
  const gearOwned = (id, items) => {
    if (!items) return false;
    if (id === 'sword') return items.sword;
    if (id === 'shield') return items.shield >= ctx.shieldMax;
    if (id === 'gun') return items.gun;
    if (id === 'wand') return items.wand;
    if (id === 'mana') return items.mana >= ctx.maxMana;
    return false;
  };
  const gearHave = (id, items) => {
    if (!items) return '';
    if (id === 'sword' || id === 'gun' || id === 'wand') return items[id] ? 'You have one' : '';
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
        desc: `${market.stock[id]} in stock${g.food ? ` · eat it for +${g.heal} ❤️` : ''}${friend ? ' · friend\'s price' : ''}`,
        owned: `You have ${goods[id]}`,
        price: buyPrice(id),
        blocked: !merchant ? 'The merchant isn’t here'
          : merchant.attitude < GRUDGE_ATTITUDE ? `${firstName(merchant.name)} won’t sell to you`
          : market.stock[id] <= 0 ? 'Sold out' : null,
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
    parent: hud,
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
    canTap: (key) => canShop(key) && nearStallKey(key),
  });
  const focusStall = (key) => {
    fishing = null;
    stalls.focus(key);
    actsAt = 0;
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
      goods: GOOD_IDS.map((g) => ({
        id: g, emoji: GOODS[g].emoji, label: GOODS[g].label, stock: market.stock[g], have: goods[g],
        sell: playerSellPrice(g),
        canSell: !!merchant && !merchantShunsPlayer() && goods[g] > 0 && cash >= playerSellPrice(g),
      })),
    };
  };
  const openMarket = () => {
    if (!marketOpen()) { feedLine('🧺 The market\'s closed.'); return; }
    fishing = null;
    stalls.unfocus();
    marketPanel.open(marketModel());
  };
  const closeMarket = () => marketPanel.close();
  // What the merchant asks / pays the player: a friend gets a better deal (a grudge, no deal)
  const buyPrice = (g) => {
    const m = workingMerchant();
    const off = m && m.attitude >= FRIEND_ATTITUDE ? 1 - FRIEND_DISCOUNT : 1;
    return Math.max(1, Math.round(market.price(g) * off));
  };
  const playerSellPrice = (g) => {
    const m = workingMerchant();
    const up = m && m.attitude >= FRIEND_ATTITUDE ? 1 + FRIEND_DISCOUNT : 1;
    return Math.max(1, Math.round(market.sellPrice(g) * up));
  };
  const merchantShunsPlayer = () => (workingMerchant()?.attitude ?? 0) < GRUDGE_ATTITUDE;
  const buyGood = (g) => {
    const merchant = workingMerchant();
    const price = buyPrice(g);
    if (!merchant || merchantShunsPlayer() || ctx.getCoins() < price || !market.take(g)) return false;
    ctx.addCoins(-price);
    merchant.money += price;
    gain(g);
    noteStock();
    return true;
  };
  const sellGood = (g) => {
    const merchant = workingMerchant();
    const price = playerSellPrice(g);
    if (!merchant || merchantShunsPlayer() || goods[g] <= 0 || merchant.money < price) return;
    goods[g] -= 1;
    renderGoods();
    market.put(g);
    merchant.money -= price;
    ctx.addCoins(price);
    noteStock();
  };
  const buyGear = (id) => {
    const item = SHOP_GEAR.find((x) => x.id === id);
    if (!item || ctx.getCoins() < item.price) return false;
    if (!ctx.grantItem(item.kind, item.n ?? 1)) return false;
    ctx.addCoins(-item.price);
    feedLine(`${item.emoji} Bought: ${item.label}`);
    return true;
  };
  // The weapon stall's mystery chest: one weighted random prize (what can't be used is left out)
  const openChest = () => {
    if (ctx.getCoins() < CHEST_PRICE) return { ok: false };
    const items = ctx.getItems() ?? {};
    const good = pickOf(GOOD_IDS);
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
    feedLine(`🎁 Mystery Chest: ${text}`);
    return { ok: true, emoji: prize.emoji };
  };

  // Other weapons than the sword (bullets, bombs, magic) hit the townsfolk drawn nearby
  // through stand-ins shaped like stage enemies (projectiles.js / blastEnemiesAt)
  const weaponTargetsFor = () => npcs.filter((n) => n.alive && n.body && !n.fighter && !n.inside && !n.dying);
  const fromPlayer = (n) => {
    const p = playerPos();
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
          if (!active || !n.alive || n.fighter) return false;
          hurt(n, fromPlayer(n), Math.max(1, Math.round(amount || 1)));
          return !n.alive;
        },
        applyKnockback: () => {},
        applyDirectKnockback: () => {},
        applyBlastKnockback: () => {},
      };
    }
    n.proxy.group.position.set(n.x, groundY(n), n.z);
    return n.proxy;
  };
  const getWeaponTargets = () => (active && ready && !sequence ? weaponTargetsFor().map(proxyFor) : []);
  const getMagicTargets = () => (active && ready && !sequence ? weaponTargetsFor().map((n) => ({
    center: new THREE.Vector3(n.x, groundY(n) + 0.55 * heightScale(n.url), n.z),
    radius: 0.45,
    blocks: () => false,
    onBlocked: () => {},
    onHit: (b) => {
      if (n.alive && !n.fighter) hurt(n, fromPlayer(n), b.element === 'fire' ? ctx.magicDamage.fire : ctx.magicDamage.ice);
    },
  })) : []);

  // ── Per-frame townsperson ──
  const updateNpc = (n, dt) => {
    if (n.dying) {
      if (simT > n.dying.until) { n.dying = null; releaseBody(n); }
      else syncBody(n, dt);
      return;
    }
    if (!n.alive) return;
    if (n.fighter) {
      const e = n.fighter;
      n.x = e.group.position.x;
      n.z = e.group.position.z;
      n.hp = e.hearts ?? n.hp;
      if (e.isDead) {
        // (killed some other way than a counted hit — the stage code fades it out)
        ctx.releaseFighterGear(e);
        n.fighter = null;
        if (n.alive) die(n, { byPlayer: true, bodyless: true });
        return;
      }
      const d = distToPlayer(n);
      if (n.def.law) {
        if (d > DISENGAGE_DIST) demote(n, () => respond(n));
      } else if (n.def.outlaw) {
        // (bandits give up the chase and go back to the camp)
        if (d > DISENGAGE_DIST * 0.7 || ctx.isPlayerDead()) demote(n);
      } else if ((simT - n.lastHurtAt > HOSTILE_CALM_S && d > 6) || d > DISENGAGE_DIST) {
        demote(n, () => { flee(n); n.fear = 6; });
      }
      return;
    }

    // Needs
    const nd = n.needs;
    if (n.inside && n.task?.type === 'sleep') nd.energy = Math.min(1, nd.energy + NEEDS.sleepGain * dt);
    else nd.energy = Math.max(0, nd.energy - NEEDS.energyDrain * dt);
    nd.hunger = Math.min(1, nd.hunger + NEEDS.hungerRate * dt);
    nd.social = Math.min(1, nd.social + NEEDS.socialRate * dt);
    if (n.fear > 0) n.fear = Math.max(0, n.fear - dt);
    // Grudges and fondness fade (fondness slower)
    n.attitude -= n.attitude * ATTITUDE_FADE * dt * (n.attitude > 0 ? 0.5 : 1);
    if (simT > (n.reactAt ?? 0)) {
      n.reactAt = simT + 0.5;
      reactToPlayer(n);
      if (n.fighter) return;
    }

    // A shove from a hit
    if (n.knock?.left > 0) {
      n.knock.left -= dt;
      const nx = n.x + n.knock.vx * dt;
      const nz = n.z + n.knock.vz * dt;
      if (layout.nav.isWalkable(nx, nz)) { n.x = nx; n.z = nz; }
    }

    if (!n.task) decide(n);
    const t = n.task;
    t.t += dt;
    if (updateSpecialTask(n, t, dt)) { pushFromPlayer(n); return; }

    if (n.inside) {
      // At home: out again when it's time for something else
      const h = hour();
      const sleepy = n.def.nightOwl ? (h >= 3 && h < 11) : (h >= 21.5 || h < 6);
      const done = t.type === 'sleep'
        ? (n.def.law ? inHours(h, n.def.hours) : !sleepy && nd.energy > 0.5)
        : t.t > 20 && n.fear <= 0;
      if (done) {
        n.inside = false;
        n.x = n.home.x;
        n.z = n.home.z;
        decide(n);
      }
      return;
    }

    if (t.phase === 'go') {
      const speed = (t.run ? RUN_SPEED : WALK_SPEED) * n.speedScale;
      if (stepPath(n, dt, speed)) {
        t.phase = 'do';
        t.t = 0;
        onArrive(n, t);
      }
    } else {
      n.moving = false;
      if (t.type === 'talk') {
        const p = playerPos();
        faceToward(n, p.x, p.z, dt);
        if (t.t > t.dur || distToPlayer(n) > TALK_RANGE + 2) { clearTalk(n); decide(n); }
      } else if (t.type === 'chat') {
        const o = t.with;
        if (o?.alive) faceToward(n, o.x, o.z, dt);
        if (t.lines && !t.said2 && t.t > 2.4 && o?.task?.type === 'chat' && o.task.with === n) {
          t.said2 = true;
          say(o, t.lines[1]);
        }
        if (t.t > t.dur) decide(n);
      } else {
        if (t.face) faceToward(n, t.face.x, t.face.z, dt);
        doActivity(n, t, dt);
        if (t.t > t.dur) finishTask(n, t);
      }
    }
    pushFromPlayer(n);

    // Now and then they say something if the player's near
    if (simT > n.nextAmbientAt) {
      n.nextAmbientAt = simT + rand(14, 30);
      if (n.body && !n.bubble && distToPlayer(n) < 12 && !['talk', 'chat', 'flee', 'respond'].includes(t.type) && Math.random() < 0.3) {
        say(n, talkLine(n, { playerName: ctx.getPlayerName(), taskType: t.type, market: marketTalk() }));
      }
    }
  };
  const onArrive = (n, t) => {
    if (t.type === 'sleep') { n.inside = true; return; }
    if (t.type === 'flee') {
      if (t.hide) { n.inside = true; n.task = { type: 'hide', t: 0, phase: 'do' }; }
      else decide(n);
      return;
    }
    if (t.type === 'respond') {
      // Got there and lost them: look around
      if (!law.seen) {
        setTask(n, { type: 'search', to: randomNear(law.lastKnown.x, law.lastKnown.z, 8), dur: rand(1, 3) });
        n.task.target = { x: law.lastKnown.x, z: law.lastKnown.z };
        n.task.plannedAt = simT;
      }
      return;
    }
    if (t.type === 'eat') buyFood(n);
    if (t.type === 'deliver') deliverGoods(n);
    if (t.type === 'raid') raidField(n, t);
    if (t.type === 'raidHome') { n.loot = 0; onRaidHome(n); decide(n); return; }
    if (t.type === 'wander' && Math.random() < 0.35) tryStartChat(n);
  };
  const doActivity = (n, t, dt) => {
    if (t.type === 'social') n.needs.social = Math.max(0, n.needs.social - dt / 25);
    if ((t.anim === 'chop' || t.anim === 'farm') && n.body && simT > n.actionAt) {
      n.actionAt = simT + (t.anim === 'chop' ? 2.2 : 3.4) + Math.random();
      n.body.character.playAction(glbCharacterConfig.throwClip);
      if (t.anim === 'chop' && distToPlayer(n) < 14) setTimeout(() => { if (active) ctx.playSfx('chop'); }, 450);
    }
    if (t.type === 'social' && !n.bubble && Math.random() < dt / 9) {
      const others = npcs.filter((o) => o !== n && o.alive && o.task?.type === 'social' && o.task.phase === 'do' && dist2(o.x, o.z, n.x, n.z) < 4);
      if (others.length) {
        const lines = chatLines(gossip, ctx.getPlayerName());
        say(n, lines[0]);
        const o = pickOf(others);
        setTimeout(() => { if (active && o.alive) say(o, lines[1]); }, 2200);
      }
    }
  };
  const finishTask = (n, t) => {
    if (t.type === 'work') {
      const made = PRODUCE[n.role];
      if (made) n.carry[made[0]] += Math.round(rand(made[1], made[2]));
      else if (n.def.law) n.money += WORK_PAY; // (the town pays its guards)
    }
    // (a guard who lost the player keeps looking round where they were last seen)
    if (t.type === 'search' && law.stars > 0) {
      setTask(n, { type: 'search', to: randomNear(law.lastKnown.x, law.lastKnown.z, 8), dur: rand(1, 3) });
      n.task.target = { x: law.lastKnown.x, z: law.lastKnown.z };
      n.task.plannedAt = simT;
      return;
    }
    decide(n);
  };
  // ── The market (townEconomy.js): the merchant at the stall buys and sells ──
  const marketOpen = () => inHours(hour(), MARKET_HOURS) && !!workingMerchant();
  // The merchant, if they're at the stall now
  const workingMerchant = () => npcs.find((m) => m.alive && !m.fighter && m.role === 'merchant'
    && m.task?.type === 'work' && m.task.phase === 'do') ?? null;
  // (feed: a good running out / coming back)
  const noteStock = () => {
    for (const g of GOOD_IDS) {
      if (market.stock[g] <= 0 && !soldOut.has(g)) {
        soldOut.add(g);
        feedLine(`📉 The market's out of ${GOODS[g].label.toLowerCase()}! ${GOODS[g].emoji} ${market.price(g)}🪙 now`);
      } else if (market.stock[g] > 0 && soldOut.has(g)) {
        soldOut.delete(g);
        feedLine(`📦 ${GOODS[g].label} is back at the market.`);
      }
    }
    if (marketPanel.isOpen()) marketPanel.render(marketModel());
  };
  // A townsperson buys a meal (and maybe firewood) from the merchant
  const buyFood = (n) => {
    const merchant = workingMerchant();
    const food = market.cheapestFood();
    if (!merchant || !food) {
      say(n, 'Sold out?! I\'m starving…');
      return;
    }
    const pay = (g) => {
      const price = market.price(g);
      if (n.money < price || !market.take(g)) return false;
      n.money -= price;
      merchant.money += price;
      return true;
    };
    if (!pay(food)) return;
    say(n, shout(SHOUT_EAT_BUY));
    setTimeout(() => { if (active && merchant.alive) say(merchant, `${GOODS[food].emoji} That's ${market.price(food)} coins!`); }, 900);
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
        const price = market.sellPrice(g);
        if (merchant.money < price) break;
        n.carry[g] -= 1;
        market.put(g);
        merchant.money -= price;
        n.money += price;
        sold += 1;
      }
    }
    if (sold) {
      const g = GOOD_IDS.find((x) => PRODUCE[n.role]?.[0] === x) ?? 'wood';
      say(n, `Fresh ${GOODS[g].label.toLowerCase()}! ${GOODS[g].emoji}`);
      setTimeout(() => { if (active && merchant.alive) say(merchant, 'I\'ll take the lot.'); }, 900);
    } else {
      say(merchant, 'Can\'t afford it today, sorry.');
    }
    noteStock();
  };

  const tryStartChat = (n) => {
    const o = npcs.find((m) => m !== n && m.alive && !m.fighter && !m.inside && m.fear <= 0
      && (m.task?.type === 'wander') && dist2(m.x, m.z, n.x, n.z) < 6);
    if (!o) return;
    const lines = chatLines(gossip, ctx.getPlayerName());
    const dur = rand(6, 9);
    n.task = { type: 'chat', t: 0, phase: 'do', with: o, dur, lines };
    o.task = { type: 'chat', t: 0, phase: 'do', with: n, dur };
    n.path = null;
    o.path = null;
    o.moving = false;
    say(n, lines[0]);
    n.task.said2 = false;
  };
  const pushFromPlayer = (n) => {
    const p = playerPos();
    const dx = n.x - p.x;
    const dz = n.z - p.z;
    const d = Math.hypot(dx, dz);
    if (d >= PLAYER_PUSH_DIST || d < 1e-4) return;
    const nx = p.x + (dx / d) * PLAYER_PUSH_DIST;
    const nz = p.z + (dz / d) * PLAYER_PUSH_DIST;
    if (layout.nav.isWalkable(nx, nz)) { n.x = nx; n.z = nz; }
  };

  // ── Bandit raids ──
  // A raider at a field: takes what's ripe (stealing — if anyone sees, they're wanted)
  const raidField = (n, t) => {
    let took = 0;
    for (const c of t.field.crops) {
      if (took >= RAID_TAKE) break;
      if (!c.ripe) continue;
      c.ripe = false;
      c.growAt = simT + CROP_REGROW_S;
      c.mesh.visible = false;
      took += 1;
    }
    n.loot += took;
    if (took && distToPlayer(n) < 30) say(n, 'Heh. Supper.');
    const owner = npcs.find((o) => o.alive && o.role === 'farmer' && o.work === t.field);
    if (took && owner) npcCrime(n, 'theft', owner);
  };
  // A raider back at the camp with the loot (a guarded field's raid got away)
  const onRaidHome = (n) => {
    for (const j of jobs) {
      if (j.status === 'active' && j.kind === 'guardField' && (j.data.raiders ?? []).includes(n.id) && !j.data.failed) {
        j.data.failed = true;
        feedLine('😞 The raiders got away with the harvest.');
      }
    }
  };
  // The camp's gang: fill it up (the first time, or an old save without bandits)
  const ensureGang = () => {
    const have = npcs.filter((n) => n.def.outlaw).length + arrivals.filter((a) => ROLES[a.role]?.outlaw).length;
    for (const role of BANDIT_ROLES.slice(have)) {
      const n = makeNpc({ id: nextId++, name: randomName(role, usedNames()), role, url: characterForRole(role) });
      npcs.push(n);
    }
  };

  // ── Missions (townJobs.js): job boards, procedural jobs, authored chains, the tracker ──
  const npcById = (id) => npcs.find((n) => n.id === id && n.alive) ?? null;
  const activeJobs = () => jobs.filter((j) => j.status === 'active');
  const rewardText = (r) => [r.coins ? `🪙 ${r.coins}` : null, r.attitude ? '🤝 goodwill' : null, r.item ? `🛡️ a ${r.item}` : null].filter(Boolean).join(' · ') || 'Their thanks';
  const townsfolkFor = (test) => npcs.filter((n) => n.alive && !n.def.law && !n.def.outlaw && !n.def.unhurt
    && n.role !== 'merchant' && !n.following && n.jailedUntil <= simT && test(n));
  // Seconds of town time until the clock next reads `h` o'clock
  const secondsUntilHour = (h) => {
    const nowMin = clock.minutes % 1440;
    let mins = h * 60 - nowMin;
    if (mins <= 0) mins += 1440;
    return mins / MINUTES_PER_SEC;
  };
  const makeJob = (spec) => ({ id: nextJobId++, status: 'open', reward: { coins: 0 }, data: {}, ...spec });
  // What the boards post: a few at a time, made from what the town needs right now
  const chainCtx = () => ({
    byRole: (role) => npcs.find((n) => n.alive && n.role === role && n.jailedUntil <= simT) ?? null,
    parentOfKid: () => {
      for (const kid of npcs.filter((n) => n.alive && n.role === 'kid' && !n.lost)) {
        const parent = family(kid).find((o) => !o.def.unhurt && !o.def.law) ?? null;
        if (parent) return { parent, kid: { ...kid, first: firstName(kid.name) } };
      }
      return null;
    },
    firstField: (g) => Math.max(0, layout.places.fields.indexOf(npcById(g.id)?.work)),
  });
  const chainJob = (chain, step) => {
    const c = chainCtx();
    const giver = chain.who(c);
    if (!giver) return null;
    const g = { id: giver.id, first: firstName(giver.name) };
    const spec = chain.steps[step](g, c);
    const last = step === chain.steps.length - 1;
    return makeJob({
      board: chain.board, giverId: giver.id, ...spec,
      title: `${chain.title}: ${spec.title}`,
      reward: last ? chain.reward : { coins: 10 },
      chain: { id: chain.id, step },
    });
  };
  const postJobs = () => {
    for (const board of ['law', 'town']) {
      const open = jobs.filter((j) => j.board === board && j.status === 'open');
      // Chains first (one at a time each)
      for (const chain of CHAINS) {
        if (chain.board !== board || chainsDone.has(chain.id) || jobs.some((j) => j.chain?.id === chain.id)) continue;
        if (open.length >= OPEN_PER_BOARD) break;
        const j = chainJob(chain, 0);
        if (j) { jobs.push(j); open.push(j); }
      }
      let tries = 0;
      while (open.length < OPEN_PER_BOARD && tries++ < 6) {
        const j = board === 'law' ? lawJob() : townJob();
        if (j) { jobs.push(j); open.push(j); }
      }
    }
  };
  const lawJob = () => {
    // A bounty on a bandit not already posted
    const posted = new Set(jobs.filter((j) => j.kind === 'bounty').map((j) => j.data.targetId));
    const bandit = npcs.find((n) => n.alive && n.def.outlaw && !posted.has(n.id));
    const h = hour();
    const fields = layout.places.fields;
    if (Math.random() < 0.6 && bandit) {
      return makeJob({
        board: 'law', kind: 'bounty', giverId: chainCtx().byRole('sheriff')?.id ?? null,
        title: `Bounty: ${bandit.name}`, desc: `${bandit.name} has been robbing travellers. Bring them down — the camp's outside town.`,
        reward: { coins: bandit.def.bounty ?? 25 }, data: { targetId: bandit.id },
      });
    }
    if (h >= 10 && h < 20 && fields.length && !jobs.some((j) => j.kind === 'guardField')) {
      const field = Math.floor(Math.random() * fields.length);
      const owner = npcs.find((n) => n.alive && n.role === 'farmer' && n.work === fields[field]);
      return makeJob({
        board: 'law', kind: 'guardField', giverId: owner?.id ?? null,
        title: `Guard ${owner ? `${firstName(owner.name)}'s` : 'a'} field tonight`,
        desc: 'Bandits have been seen eyeing the crops. Be there tonight and beat them off.',
        reward: { coins: 45, attitude: 0.3 }, data: { field, raiders: [] },
      });
    }
    return null;
  };
  const townJob = () => {
    if (Math.random() < 0.7) {
      // A delivery: what the market is short of, for someone who needs it
      const g = market.scarcest() ?? pickOf(GOOD_IDS);
      const giver = pickOf(townsfolkFor((n) => !jobs.some((j) => j.giverId === n.id)));
      if (!giver) return null;
      const n = g === 'wood' ? 3 + Math.floor(Math.random() * 4) : 2 + Math.floor(Math.random() * 3);
      const why = g === 'wood' ? 'needs firewood for the cold nights' : g === 'fish' ? 'is sick of veg and wants fish' : 'needs veg for a stew';
      return makeJob({
        board: 'town', kind: 'deliver', giverId: giver.id,
        title: `Bring ${n} ${GOODS[g].emoji} to ${firstName(giver.name)}`,
        desc: `${firstName(giver.name)} ${why}${market.stock[g] <= 0 ? ' — the market\'s out' : ''}.`,
        reward: { coins: Math.round(GOODS[g].base * n * 1.8) + 4, attitude: 0.2 }, data: { good: g, n, toId: giver.id },
      });
    }
    // A debt to collect (or forgive)
    const debtor = pickOf(townsfolkFor((n) => !jobs.some((j) => j.data?.debtorId === n.id)));
    const creditor = debtor && pickOf(townsfolkFor((n) => n !== debtor && n.homeIndex !== debtor.homeIndex));
    if (!debtor || !creditor) return null;
    const amount = 8 + Math.floor(Math.random() * 12);
    return makeJob({
      board: 'town', kind: 'debt', giverId: creditor.id,
      title: `${firstName(debtor.name)} owes ${firstName(creditor.name)}`,
      desc: `${firstName(debtor.name)} owes ${firstName(creditor.name)} ${amount} coins. Collect it (you keep a cut) — or let it go.`,
      reward: { coins: Math.round(amount * 0.4) }, data: { debtorId: debtor.id, creditorId: creditor.id, amount },
    });
  };
  // The drifter's shady work: veg, no questions asked (the sheriff hears about it)
  const offerShadyJob = (n) => {
    if (jobs.some((j) => j.board === 'shady' && j.status === 'active')) { say(n, 'You\'ve got my job already.', { big: true }); return; }
    if (activeJobs().length >= MAX_ACTIVE_JOBS) { feedLine('📋 You have too many jobs on.'); return; }
    const j = makeJob({
      board: 'shady', kind: 'deliver', giverId: n.id, status: 'active',
      title: `Veg for ${firstName(n.name)}`, desc: 'Three veg, no questions asked.',
      reward: { coins: 30 }, data: { good: 'crops', n: 3, toId: n.id },
    });
    jobs.push(j);
    const sheriff = chainCtx().byRole('sheriff');
    if (sheriff) sheriff.attitude = Math.max(-1, sheriff.attitude - 0.15);
    say(n, 'Three veg. From wherever. Don\'t tell the sheriff.', { big: true });
    feedLine(`🤫 Job: ${j.title}`);
  };
  const startJob = (j) => {
    j.status = 'active';
    if (j.kind === 'guardField') {
      j.data.raidAt = simT + secondsUntilHour(RAID_HOUR);
      j.data.raiders = [];
      j.data.raidStarted = false;
    }
    if (j.kind === 'findKid') loseKid(j);
  };
  const acceptJob = (id) => {
    const j = jobs.find((x) => x.id === id);
    if (!j || j.status !== 'open') return;
    if (activeJobs().length >= MAX_ACTIVE_JOBS) { feedLine(`📋 You can take ${MAX_ACTIVE_JOBS} jobs at a time.`); return; }
    startJob(j);
    feedLine(`📋 Job taken: ${j.title}`);
    renderBoard();
  };
  const dropJob = (j) => {
    jobs = jobs.filter((x) => x !== j);
    if (j.kind === 'findKid') {
      const kid = npcById(j.data.kidId);
      if (kid) { kid.lost = false; kid.escort = false; kid.following = false; kid.task = null; }
    }
    if (j.kind === 'fetchStrongbox' || j.kind === 'returnTo') {
      strongboxHeld = false;
      layout.props.strongbox.visible = true;
    }
  };
  const abandonJob = (id) => {
    const j = jobs.find((x) => x.id === id);
    if (!j) return;
    dropJob(j);
    feedLine(`📋 Dropped: ${j.title}`);
    renderBoard();
  };
  const completeJob = (j, { coins = j.reward.coins, text = null } = {}) => {
    jobs = jobs.filter((x) => x !== j);
    const giver = npcById(j.giverId);
    if (coins > 0) ctx.addCoins(coins);
    if (giver && j.reward.attitude) giver.attitude = Math.min(1, giver.attitude + j.reward.attitude);
    if (j.reward.item) ctx.grantItem(j.reward.item);
    if (j.reward.town) for (const n of npcs) if (n.alive && !n.def.outlaw) n.attitude = Math.min(1, n.attitude + j.reward.town);
    if (giver?.body) say(giver, 'Thank you!', { big: true });
    feedLine(text ?? `✅ ${j.title}${coins > 0 ? ` · +${coins} 🪙` : ''}`);
    // A chain goes on to its next step (or ends)
    const chain = j.chain && CHAINS.find((c) => c.id === j.chain.id);
    if (chain) {
      const step = j.chain.step + 1;
      if (step < chain.steps.length) {
        const next = chainJob(chain, step);
        if (next) {
          jobs.push(next);
          startJob(next);
          feedLine(`📋 Next: ${next.title}`);
        }
      } else {
        chainsDone.add(chain.id);
        ctx.showBanner('QUEST COMPLETE!', `${chain.title}${chain.reward.coins ? ` · 🪙 +${chain.reward.coins}` : ''}`, 3000);
      }
    }
    save();
  };
  // Someone died: bounties pay, jobs for / about them end
  const onJobDeath = (n, byPlayer) => {
    const mine = byPlayer || distToPlayer(n) < 25;
    for (const j of [...jobs]) {
      if (j.kind === 'bounty' && j.data.targetId === n.id) {
        if (j.status === 'active' && mine) completeJob(j, { text: `💰 Bounty: ${n.name} · +${j.reward.coins} 🪙` });
        else jobs = jobs.filter((x) => x !== j);
      } else if (j.kind === 'killBandits' && n.def.outlaw && j.status === 'active' && mine) {
        j.data.kills += 1;
        if (j.data.kills >= j.data.n) completeJob(j);
      } else if (j.kind === 'guardField' && (j.data.raiders ?? []).includes(n.id)) {
        // (checked in updateJobs: all raiders down)
      } else if ([j.giverId, j.data.toId, j.data.debtorId, j.data.creditorId, j.data.kidId].includes(n.id) && !n.def.outlaw) {
        dropJob(j);
        if (j.status === 'active') feedLine(`✖ ${j.title}: ${firstName(n.name)} is dead.`);
      }
    }
  };
  // A lost kid: off somewhere quiet, a little way out of town
  const loseKid = (j) => {
    const kid = npcById(j.data.kidId);
    if (!kid) return;
    let spot = j.data.spot;
    if (!spot) {
      const nav = layout.nav;
      const cells = nav.cellsWhere((i) => {
        const d = dist2(nav.cellX(i), nav.cellZ(i), kid.home.x, kid.home.z);
        return d > 22 && d < 45 && nav.clearanceAt(i) >= 1.5;
      });
      const i = cells.length ? pickOf(cells) : nav.nearestWalkable(kid.home.x + 25, kid.home.z);
      spot = { x: nav.cellX(i), z: nav.cellZ(i) };
      j.data.spot = spot;
    }
    endBrawl(kid);
    kid.lost = true;
    kid.inside = false;
    kid.x = spot.x;
    kid.z = spot.z;
    kid.path = null;
    setTask(kid, { type: 'lost', dur: Infinity });
  };
  // The acts a job puts on a townsperson the player is next to
  const jobActsFor = (n) => {
    const out = [];
    for (const j of activeJobs()) {
      const d = j.data;
      if (j.kind === 'deliver' && d.toId === n.id && goods[d.good] >= d.n) {
        out.push({ key: `give:${j.id}`, label: `📦 Give ${d.n} ${GOODS[d.good].emoji}`, onClick: () => {
          if (goods[d.good] < d.n) return;
          goods[d.good] -= d.n;
          renderGoods();
          completeJob(j);
        } });
      } else if (j.kind === 'debt' && d.debtorId === n.id) {
        out.push({ key: `collect:${j.id}`, label: `💰 Collect ${d.amount}`, onClick: () => collectDebt(j, n) });
        out.push({ key: `forgive:${j.id}`, label: '🤲 Let it go', onClick: () => forgiveDebt(j, n) });
      } else if (j.kind === 'returnTo' && d.toId === n.id && strongboxHeld) {
        out.push({ key: `return:${j.id}`, label: '📦 Hand over the strongbox', onClick: () => {
          strongboxHeld = false;
          completeJob(j);
        } });
      }
    }
    return out;
  };
  const collectDebt = (j, debtor) => {
    const creditor = npcById(j.data.creditorId);
    const paid = Math.min(j.data.amount, Math.floor(debtor.money));
    if (paid <= 0) { say(debtor, 'I\'ve got nothing! Honest!', { big: true }); return; }
    debtor.money -= paid;
    const cut = Math.round(paid * 0.4);
    if (creditor) creditor.money += paid - cut;
    debtor.attitude = Math.max(-1, debtor.attitude - 0.3);
    say(debtor, paid < j.data.amount ? 'That\'s all I have…' : 'Fine. Take it.', { big: true });
    completeJob(j, { coins: cut, text: `💰 Collected ${paid} for ${creditor ? firstName(creditor.name) : 'nobody'} · +${cut} 🪙` });
  };
  const forgiveDebt = (j, debtor) => {
    const creditor = npcById(j.data.creditorId);
    debtor.attitude = Math.min(1, debtor.attitude + 0.4);
    if (creditor) creditor.attitude = Math.max(-1, creditor.attitude - 0.2);
    say(debtor, 'Bless you! I won\'t forget it.', { big: true });
    completeJob(j, { coins: 0, text: `🤲 You let ${firstName(debtor.name)}'s debt go.` });
  };
  // Per-tick job upkeep: postings, raids, the lost kid, the tracker
  const updateJobs = () => {
    if (simT > boardsAt) { boardsAt = simT + BOARD_REFRESH_S; postJobs(); renderBoard(); }
    const P = layout.places;
    for (const j of [...activeJobs()]) {
      const d = j.data;
      if (j.kind === 'guardField') {
        if (!d.raidStarted && simT >= d.raidAt) {
          d.raidStarted = true;
          d.failed = false;
          const field = P.fields[d.field] ?? P.fields[0];
          const free = npcs.filter((n) => n.alive && n.def.outlaw && !n.fighter && n.jailedUntil <= simT);
          while (free.length < 2) {
            const n = makeNpc({ id: nextId++, name: randomName('bandit', usedNames()), role: 'bandit', url: characterForRole('bandit') });
            npcs.push(n);
            free.push(n);
          }
          d.raiders = free.slice(0, 2).map((n) => { startRaid(n, field, j.id); return n.id; });
          feedLine('🌙 Raiders are heading for the field!');
        } else if (d.raidStarted && d.raiders.every((id) => !npcById(id) || npcById(id).jailedUntil > simT)) {
          completeJob(j);
        } else if (d.raidStarted && d.failed) {
          // (they got away: they'll be back tomorrow night)
          d.raidStarted = false;
          d.failed = false;
          d.raiders = [];
          d.raidAt = simT + secondsUntilHour(RAID_HOUR);
          feedLine('🌙 They\'ll be back tomorrow night.');
        }
      } else if (j.kind === 'findKid') {
        const kid = npcById(d.kidId);
        if (!kid) continue;
        if (!d.found && distToPlayer(kid) < KID_FOUND_DIST) {
          d.found = true;
          kid.lost = false;
          kid.escort = true;
          kid.following = true;
          setTask(kid, { type: 'follow', dur: Infinity });
          say(kid, 'You found me! Take me home?', { big: true });
        } else if (d.found && dist2(kid.x, kid.z, kid.home.x, kid.home.z) < KID_HOME_DIST) {
          kid.escort = false;
          kid.following = false;
          kid.task = null;
          for (const f of family(kid)) f.attitude = Math.min(1, f.attitude + 0.5);
          completeJob(j);
        }
      } else if (j.kind === 'fetchStrongbox' && strongboxHeld) {
        completeJob(j);
      }
    }
    tracker.render(activeJobs().map((j) => ({ title: j.title, progress: jobProgress(j) })));
    if (boardOpen) renderBoard();
  };
  const jobProgress = (j) => {
    const d = j.data;
    const who = (id) => (npcById(id) ? firstName(npcById(id).name) : '?');
    switch (j.kind) {
      case 'deliver': return `${Math.min(goods[d.good], d.n)} / ${d.n} ${GOODS[d.good].emoji} → ${who(d.toId)}`;
      case 'bounty': return 'Find them near the bandit camp';
      case 'killBandits': return `${d.kills} / ${d.n} bandits`;
      case 'guardField': return d.raidStarted ? 'Raiders at the field!' : `Be at the field by ${RAID_HOUR}:00`;
      case 'findKid': return d.found ? `Walk ${who(d.kidId)} home` : `Look for ${who(d.kidId)} out of town`;
      case 'debt': return `Talk to ${who(d.debtorId)}`;
      case 'fetchStrongbox': return 'At the bandit camp';
      case 'returnTo': return `Bring it to ${who(d.toId)}`;
      default: return '';
    }
  };
  // Where a job's 📍 points
  const jobTarget = (j) => {
    const d = j.data;
    const P = layout.places;
    const at = (n) => (n ? { x: n.x, z: n.z, h: 1.7 * heightScale(n.url) } : null);
    switch (j.kind) {
      case 'deliver': case 'returnTo': return at(npcById(d.toId));
      case 'bounty': return at(npcById(d.targetId));
      case 'killBandits': return { ...P.camp, h: 2.6 };
      case 'guardField': return { ...(P.fields[d.field] ?? P.fields[0]), h: 1.5 };
      case 'findKid': { const kid = npcById(d.kidId); return d.found && kid ? { ...kid.home, h: 2 } : at(kid); }
      case 'debt': return at(npcById(d.debtorId));
      case 'fetchStrongbox': return { ...P.strongbox, h: 1 };
      default: return null;
    }
  };
  const updateMarkers = () => {
    const live = new Set();
    for (const j of activeJobs()) {
      const t = jobTarget(j);
      if (!t) continue;
      live.add(j.id);
      let m = markers.get(j.id);
      if (!m) {
        m = makeTextSprite('📍', { height: 0.5, size: 96, bg: null, pad: 10 });
        m.renderOrder = 8;
        root.add(m);
        markers.set(j.id, m);
      }
      m.position.set(t.x, groundAt(t.x, t.z) + t.h + Math.sin(simT * 3) * 0.08, t.z);
    }
    for (const [id, m] of markers) {
      if (live.has(id)) continue;
      m.parent?.remove(m);
      m.material.map?.dispose();
      m.material.dispose();
      markers.delete(id);
    }
  };
  // (chain: the sheriff's strongbox — the gang wakes up when it's taken)
  const takeStrongbox = () => {
    strongboxHeld = true;
    layout.props.strongbox.visible = false;
    feedLine('📦 You have the strongbox!');
    const P = layout.places;
    for (const n of npcs) {
      if (n.alive && n.def.outlaw && !n.fighter && n.jailedUntil <= simT && dist2(n.x, n.z, P.camp.x, P.camp.z) < 20) {
        say(n, 'Oi! That\'s ours!');
        promote(n);
      }
    }
  };
  // The boards' panel
  const nearBoard = () => {
    const p = playerPos();
    for (const [key, at] of Object.entries(layout.places.boards)) {
      if (dist2(p.x, p.z, at.x, at.z) < BOARD_DIST) return key;
    }
    return null;
  };
  const boardModel = (key) => ({
    title: BOARDS[key].label,
    note: activeJobs().length >= MAX_ACTIVE_JOBS ? `You have ${MAX_ACTIVE_JOBS} jobs on — finish or drop one first.` : null,
    open: jobs.filter((j) => j.board === key && j.status === 'open').map((j) => ({
      id: j.id, title: j.title, desc: j.desc, reward: rewardText(j.reward), canAccept: activeJobs().length < MAX_ACTIVE_JOBS,
    })),
    active: activeJobs().map((j) => ({ id: j.id, title: j.title, progress: jobProgress(j) })),
  });
  const openBoard = (key) => {
    stalls.unfocus();
    closeMarket();
    boardOpen = key;
    boardPanel.open(boardModel(key));
  };
  const renderBoard = () => { if (boardOpen) boardPanel.render(boardModel(boardOpen)); };
  const closeBoard = () => { boardOpen = null; boardPanel.close(); };
  // Saved jobs back (raids are re-planned for the next night)
  const restoreJobs = (state) => {
    jobs = Array.isArray(state?.jobs) ? state.jobs.filter((j) => j && j.kind && j.data) : [];
    nextJobId = Math.max(state?.nextJobId ?? 1, ...jobs.map((j) => j.id + 1), 1);
    chainsDone = new Set(state?.chainsDone ?? []);
    strongboxHeld = !!state?.strongboxHeld;
    layout.props.strongbox.visible = !strongboxHeld && !chainsDone.has('strongbox');
    boardsAt = 0;
    for (const j of jobs) {
      if (j.status !== 'active') continue;
      if (j.kind === 'guardField') { j.data.raidStarted = false; j.data.raiders = []; j.data.raidAt = simT + secondsUntilHour(RAID_HOUR); }
      if (j.kind === 'findKid') {
        const kid = npcById(j.data.kidId);
        if (kid && !j.data.found) loseKid(j);
        else if (kid) { kid.escort = true; kid.following = true; }
      }
    }
  };

  // ── Arrivals (newcomers take the place of the dead) ──
  const usedNames = () => new Set([...npcs.filter((n) => n.alive).map((n) => firstName(n.name)), ...departed]);
  const homeForNewcomer = () => {
    const counts = layout.places.homes.map(() => 0);
    for (const n of npcs) if (n.alive) counts[n.homeIndex] = (counts[n.homeIndex] ?? 0) + 1;
    let best = 0;
    counts.forEach((c, i) => { if (c < counts[best]) best = i; });
    return best;
  };
  const updateArrivals = () => {
    for (let i = arrivals.length - 1; i >= 0; i--) {
      const a = arrivals[i];
      if (simT < a.at) continue;
      arrivals.splice(i, 1);
      const n = makeNpc({ id: nextId++, name: randomName(a.role, usedNames()), role: a.role, url: characterForRole(a.role), home: homeForNewcomer() });
      if (n.def.outlaw) {
        // (a new face at the bandit camp)
        n.x = layout.places.camp.x;
        n.z = layout.places.camp.z;
        npcs.push(n);
        decide(n);
        if (distToPlayer(n) < 40) feedLine(`💀 ${n.name} joined the bandits.`);
        continue;
      }
      const E = layout.places.entrance;
      n.x = E.x;
      n.z = E.z;
      npcs.push(n);
      assignWork();
      setTask(n, { type: 'wander', to: n.home, dur: 2 });
      gossip.push({ kind: 'newcomer', who: firstName(n.name), at: simT, fresh: true });
      feedLine(`🧳 ${n.name} the ${n.def.label} moved to ${TOWN_NAME}.`);
      save();
    }
  };

  // ── Clock / lighting ──
  const advanceClock = (minutes) => {
    clock.minutes += minutes;
    while (clock.minutes >= 1440) { clock.minutes -= 1440; clock.day += 1; }
    applyTime();
  };
  const applyTime = () => {
    const h = hour();
    const night = h >= NIGHT_FROM_H || h < NIGHT_TO_H;
    if (night !== isNight) {
      isNight = night;
      ctx.setTimeOfDay(night ? 'night' : 'day');
    }
    topClock.textContent = clockText();
  };

  // ── Interact (bottom-centre buttons, E / Enter, the phone's Block bar) ──
  const nearestTalkable = () => {
    const p = playerPos();
    const hostileNear = npcs.some((n) => n.fighter && dist2(n.x, n.z, p.x, p.z) < 8);
    if (hostileNear || ctx.isPlayerDead()) return null;
    let best = null;
    let bd = TALK_RANGE;
    for (const n of npcs) {
      if (!n.alive || !n.body || n.fighter || n.inside || n.dying || n.def.outlaw) continue;
      if (['brawl', 'mug', 'arrest'].includes(n.task?.type)) continue;
      const d = dist2(n.x, n.z, p.x, p.z);
      if (d < bd) { bd = d; best = n; }
    }
    return best;
  };
  const computeActs = () => {
    const out = [];
    if (sequence) return out;
    if (marketPanel.isOpen()) {
      out.push({ key: 'close', label: '✖ Close market', onClick: closeMarket });
      return out;
    }
    if (stalls.focused()) {
      // At a counter: buy what's picked, the next thing, back
      const buy = stalls.buyLabel();
      if (buy) out.push({ key: 'buy', label: buy, onClick: () => { stalls.buySelected(); actsAt = 0; } });
      out.push({ key: 'next', label: '› Next', onClick: () => { stalls.step(1); actsAt = 0; } });
      out.push({ key: 'back', label: '⬅ Back', onClick: () => { stalls.unfocus(); actsAt = 0; } });
      return out;
    }
    if (lockpick.isOpen()) {
      out.push({ key: 'pin', label: '🔧 Now!', onClick: () => lockpick.press() });
      out.push({ key: 'unpick', label: '✖ Stop', onClick: () => lockpick.stop() });
      return out;
    }
    if (jail) {
      out.push({ key: 'bail', label: `🔓 Bail (${BAIL} 🪙)`, onClick: payBail });
      out.push({ key: 'bribe', label: `🤝 Bribe (${BRIBE} 🪙)`, onClick: bribe });
      out.push({ key: 'pick', label: '🔧 Pick the lock', onClick: startLockpick });
      out.push({ key: 'sleep', label: '😴 Sleep it off', onClick: sleepItOff });
      return out;
    }
    if (boardOpen) {
      out.push({ key: 'closeboard', label: '✖ Close board', onClick: closeBoard });
      return out;
    }
    if (law.stars > 0) {
      const p = playerPos();
      if (npcs.some((n) => n.fighter && n.def.law && dist2(n.x, n.z, p.x, p.z) < GIVE_UP_DIST)) {
        out.push({ key: 'giveup', label: '🙌 Give up', onClick: () => busted({ surrendered: true }) });
        return out;
      }
    }
    if (fishing) {
      out.push({ key: 'fishing', label: '🎣 Fishing… (reel in)', onClick: () => { fishing = null; } });
      return out;
    }
    const calm = calmNow();
    const board = calm ? nearBoard() : null;
    if (board) out.push({ key: `board:${board}`, label: BOARDS[board].short, onClick: () => openBoard(board) });
    // (the strongbox can be snatched mid-fight: the gang guards it)
    if (!strongboxHeld && layout.props.strongbox.visible && activeJobs().some((j) => j.kind === 'fetchStrongbox')) {
      const p = playerPos();
      const sb = layout.places.strongbox;
      if (dist2(p.x, p.z, sb.x, sb.z) < 2) out.push({ key: 'strongbox', label: '📦 Take the strongbox', onClick: takeStrongbox });
    }
    const stall = calm ? nearestStall() : null;
    if (stall === 'gear' && gearOpen()) out.push({ key: 'gear', label: '⚔️ Weapons', onClick: () => focusStall('gear') });
    if (stall === 'goods' && marketOpen()) {
      out.push({ key: 'goods', label: '🧺 Goods', onClick: () => focusStall('goods') });
      out.push({ key: 'sell', label: '💰 Sell', onClick: openMarket });
    }
    // A job's townsperson within reach (not only the nearest): its 📦 / 💰 first
    if (!ctx.isPlayerDead() && calm) {
      for (const o of npcs) {
        if (o.alive && o.body && !o.fighter && !o.inside && distToPlayer(o) < ACT_DIST) out.push(...jobActsFor(o));
      }
    }
    const n = nearestTalkable();
    if (n) {
      out.push({ key: `talk:${n.id}`, label: `💬 ${firstName(n.name)}`, onClick: () => talkTo(n) });
      if (talking?.npc === n) {
        if (n.following) out.push({ key: `dismiss:${n.id}`, label: '👋 Go home', onClick: () => dismiss(n) });
        else if (canRecruit(n)) out.push({ key: `join:${n.id}`, label: '🤝 Join me', onClick: () => recruit(n) });
        else if (n.role === 'drifter' && n.attitude > -0.2) out.push({ key: `shady:${n.id}`, label: BOARDS.shady.short, onClick: () => offerShadyJob(n) });
        else out.push({ key: `gift:${n.id}`, label: `🪙 Give ${GIFT_COINS}`, onClick: () => gift(n) });
      }
    }
    if (calm) {
      if (ripeCropNear()) out.push({ key: 'pick', label: '🌾 Pick veg', onClick: pickCrop });
      if (nearWater()) out.push({ key: 'fish', label: '🎣 Fish', onClick: startFishing });
      const food = hurtFood();
      if (food) out.push({ key: `eat:${food}`, label: `🍽 Eat ${GOODS[food].emoji}`, onClick: () => eat(food) });
    }
    return out.slice(0, 3);
  };
  const refreshActs = () => {
    acts = computeActs();
    const key = acts.map((a) => `${a.key}|${a.label}`).join(',');
    if (key === actsKey) return;
    actsKey = key;
    actsEl.replaceChildren(...acts.map((a, i) => {
      const b = el('button', `${i > 0 ? 'ui-btn-secondary' : 'ui-btn'} town-act`, a.label);
      b.type = 'button';
      b.addEventListener('click', () => { if (active) a.onClick(); });
      return b;
    }));
    actsEl.classList.toggle('hidden', !acts.length);
  };
  const interact = () => {
    if (!active || !acts.length) return false;
    acts[0].onClick();
    actsAt = 0;
    return true;
  };
  const onKey = (e) => {
    if (!active || e.repeat) return;
    if (e.target?.closest?.('input, textarea, select')) return;
    if (document.body.classList.contains('settings-open')) return;
    if (e.key === 'Escape' && marketPanel.isOpen()) { closeMarket(); e.preventDefault(); return; }
    if (e.key === 'Escape' && stalls.focused()) { stalls.unfocus(); e.preventDefault(); return; }
    if (e.key === 'Escape' && boardOpen) { closeBoard(); e.preventDefault(); return; }
    if (e.key === 'Escape' && lockpick.isOpen()) { lockpick.stop(); e.preventDefault(); return; }
    if (e.key === 'e' || e.key === 'E' || (e.key === 'Enter' && !e.target?.closest?.('button'))) {
      if (interact()) e.preventDefault();
    }
  };

  // ── Lifecycle ──
  const spawnTown = () => {
    const state = load();
    npcs = [];
    gossip = [];
    arrivals = [];
    departed = Array.isArray(state?.departed) ? state.departed : [];
    market = createMarket(state?.market);
    soldOut.clear();
    GOOD_IDS.forEach((g) => { goods[g] = Math.max(0, Math.floor(state?.goods?.[g] || 0)); });
    renderGoods();
    lastItems = state?.items ?? null;
    // In Town the player has only what they bought here (nothing, the first time)
    ctx.startLoadout(lastItems ?? {});
    nextId = state?.nextId ?? 1;
    if (state) {
      clock.day = state.day ?? 1;
      clock.minutes = state.minutes ?? START_MINUTES;
      for (const p of state.people) {
        if (!ROLES[p.role]) continue;
        npcs.push(makeNpc(p));
        nextId = Math.max(nextId, (p.id ?? 0) + 1);
      }
      for (const role of state.pending ?? []) arrivals.push({ role, at: simT + rand(...NEWCOMER_DELAY_S) });
    } else {
      clock.day = 1;
      clock.minutes = START_MINUTES;
      const taken = new Set();
      // Households of two or three (the kids land with the farmers); the other houses wait
      // for newcomers
      const households = Math.max(1, Math.min(layout.places.homes.length, FOUNDING_HOUSEHOLDS));
      FOUNDING_ROLES.forEach((role, i) => {
        const name = randomName(role, taken);
        taken.add(firstName(name));
        npcs.push(makeNpc({ id: nextId++, name, role, url: characterForRole(role), home: i % households }));
      });
    }
    ensureGang();
    assignWork();
    restoreJobs(state);
    // Start mid-day: everyone already at whatever they'd be doing
    isNight = null;
    applyTime();
    for (const n of npcs) {
      decide(n);
      const t = n.task;
      if (t?.to) {
        n.x = t.to.x;
        n.z = t.to.z;
        n.path = null;
        t.phase = 'do';
        t.t = Math.random() * Math.min(t.dur, 20);
        if (t.type === 'sleep') n.inside = true;
      }
    }
    ready = true;
    save();
  };

  const enter = () => {
    if (active) return;
    active = true;
    ready = false;
    const token = ++enterToken;
    document.body.classList.add('town-mode');
    hud.classList.remove('hidden');
    renderStars();
    window.addEventListener('keydown', onKey);
    stalls.setActive(true);
    // (built on the next frame: the first nav grid samples a few thousand ground heights)
    setTimeout(() => {
      if (!active || token !== enterToken) return;
      try {
        if (!layout) layout = buildLayout();
      } catch (e) {
        console.error('[Town] layout failed:', e);
        return;
      }
      ctx.scene.add(root);
      root.add(layout.props.group);
      spawnTown();
      const P = layout.places;
      ctx.teleport(P.spawn.x, P.spawn.z, Math.atan2(P.market.x - P.spawn.x, P.market.z - P.spawn.z));
      feedLine(`Welcome to ${TOWN_NAME}! Walk up to people to talk.`);
    }, 30);
  };

  const exit = () => {
    if (!active) return;
    save();
    lastItems = ctx.endLoadout() ?? lastItems;
    closeMarket();
    closeBoard();
    lockpick.stop();
    ctx.cancelCarry();
    for (const [, m] of markers) { m.parent?.remove(m); m.material.map?.dispose(); m.material.dispose(); }
    markers.clear();
    tracker.render([]);
    stalls.setActive(false);
    fishing = null;
    active = false;
    ready = false;
    enterToken += 1;
    sequence = null;
    fadeTo(false);
    for (const n of npcs) {
      if (n.fighter) { ctx.removeFighter(n.fighter); n.fighter = null; }
      releaseBody(n);
    }
    npcs = [];
    if (jail) { jail = null; ctx.setPositionConstraint(null); }
    jailChip.classList.add('hidden');
    law.stars = 0;
    law.peak = 0;
    talking = null;
    actsKey = '';
    actsEl.replaceChildren();
    actsEl.classList.add('hidden');
    feed.replaceChildren();
    root.parent?.remove(root);
    hud.classList.add('hidden');
    document.body.classList.remove('town-mode');
    window.removeEventListener('keydown', onKey);
    isNight = null;
  };

  const update = (dt) => {
    if (!active || !ready) return;
    dt = Math.min(dt, 0.1);
    simT += dt;
    clock.minutes += dt * MINUTES_PER_SEC;
    if (clock.minutes >= 1440) { clock.minutes -= 1440; clock.day += 1; }
    applyTime();
    updateCampfire(layout.props.fire, simT);
    if (jail) {
      jail.left -= dt;
      renderJail();
      if (jail.left <= 0) endJail('🔓 Time served. You\'re free to go.');
    }
    if (!jail && lockpick.isOpen()) lockpick.stop();
    lockpick.update(dt);
    updateCampfire(layout.props.campFire, simT + 3);
    // The jail door: shut while the player (or a townsperson) is inside, open otherwise
    const door = layout.props.door;
    const occupied = jail || npcs.some((n) => n.alive && n.jailedUntil > simT);
    door.rotation.y = angleLerp(door.rotation.y, occupied ? 0 : -1.9, 1 - Math.exp(-4 * dt));

    for (const n of npcs) updateNpc(n, dt);
    npcs = npcs.filter((n) => n.alive || n.dying);
    updateFishing(dt);
    if (simT > growAt) { growAt = simT + 1; updateRegrowth(); }
    // (the market panel shuts when the merchant leaves the stall or the player walks off)
    if (marketPanel.isOpen() && (!marketOpen() || !nearStall())) closeMarket();
    for (const g of gossip) if (simT - g.at > 240) g.fresh = false;
    updateArrivals();
    if (simT > law.tickAt) { law.tickAt = simT + 0.5; updateLaw(); updateJobs(); }
    updateMarkers();
    if (simT > lodAt) { lodAt = simT + 0.4; updateLod(); }
    for (const n of npcs) if (n.body && !n.dying) syncBody(n, dt);
    if (simT > actsAt) { actsAt = simT + 0.15; refreshActs(); }
    if (simT > saveAt) { saveAt = simT + SAVE_EVERY_S; save(); }
    // (the weapon stall's keeper is there in the market's hours)
    stalls.setKeeperVisible('gear', gearOpen());
    // (last: the shop camera takes over from the player controls' pose this frame)
    stalls.update(dt, simT);
  };

  // The player's sword swing reached `tip` (world), moving along swingDir: hits the
  // townsperson it passes through (those fighting are EnemyPlayers — the stage code hits
  // them), or chops the tree it's in
  const trySwordHit = (tip, swingDir) => {
    if (!active || !ready || sequence) return false;
    for (const n of npcs) {
      if (!n.alive || !n.body || n.fighter || n.inside || n.dying) continue;
      if (simT - n.lastHitAt < 0.7) continue;
      const cy = groundY(n) + 0.55 * heightScale(n.url);
      if (Math.hypot(tip.x - n.x, tip.y - cy, tip.z - n.z) > 0.7) continue;
      const dir = _v2.set(swingDir.x, 0, swingDir.z);
      if (dir.lengthSq() < 1e-6) dir.set(n.x - playerPos().x, 0, n.z - playerPos().z);
      dir.normalize();
      hurt(n, { x: dir.x, z: dir.z });
      return true;
    }
    return tryChop(tip);
  };

  // The player went down: wanted → busted, otherwise knocked out. True when handled.
  const onPlayerDown = () => {
    if (!active) return false;
    if (law.stars > 0) busted();
    else knockedOut();
    return true;
  };

  return {
    enter,
    exit,
    update,
    trySwordHit,
    getWeaponTargets,
    getMagicTargets,
    onPlayerDown,
    interact,
    isActive: () => active,
    // The phone's Block bar label while there's something to do (undefined: it stays Block)
    interactLabel: () => (active && acts.length ? acts[0].label : undefined),
    // (dev console)
    debug: () => ({ npcs, layout, law, clock, arrivals, market, goods, stalls, ctx, jobs, chainsDone, simT: () => simT, stallItemState }),
  };
}

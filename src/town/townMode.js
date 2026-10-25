// Town mode (start screen → Town): Brindlewick, the town of houses on the island's north-west,
// as a living place. One resident to a house (townHomes.js — townsfolk and players together; the
// player's own house is bought, other homes lock at night): townsfolk with jobs, homes and needs go about their day on the town
// clock (work, the market, the campfire, bed), walking the roads (townNav.js); the player can
// talk to them, give them coins — or hit them. Hurting someone is a crime if anyone sees it:
// wanted stars, the guards come running and fight (as EnemyPlayers), and getting beaten or
// giving up lands the player in the jail cell (in the jail house — townRooms.js). The dead stay dead; newcomers move in to take
// their place. Townsfolk names / roles / lines are in townPeople.js.
//
// Economy (townEconomy.js): woodcutters, farmers and fishers bring wood, veg and fish to the
// market and are paid by the merchant; everyone buys their food (and firewood) there; prices
// follow the stock. The player gathers too — chops trees with the sword, fishes at the fishing
// spot with a rod bought at the shop (townFishing.js), picks veg (stealing, if anyone sees),
// buys the farmers' fields and plants seeds from the shop anywhere (townFarming.js — watered
// with the hose they grow fast) — and trades at the market (townStalls.js): one of the houses is
// the shop — walking in through the door puts the player in its room, shopped like the Showdown
// village's — everything in one place, run by the merchant (the goods behind the counter, the
// gear on the side counters, a mystery chest); the wizard sells the wand and potions at his
// stall out in the woods; townsfolk walk in and out of the shop too; selling goods is the market
// panel (townMarketPanel.js). In Town the player owns only what they bought here,
// starting with nothing at all (ctx.startLoadout — the real inventory waits outside), and the
// guards take it all on an arrest.
//
// Reactions: how townsfolk feel about the player (attitude) fades over time and shows — friends
// get a discount at the shop, a grudge means no trade and stepping aside; a hurt
// townsperson's family and the brave nearby come to help, and the family of the dead hold a
// vendetta (they attack on sight). Townsfolk fight each other too: drifters mug people at
// night, bandits raid; whoever's seen doing it is an outlaw for a while (hurting an outlaw is no
// crime), and a guard goes to arrest them (a brawl, then the jail cell). Good friends follow
// the player (🤝 Join me) and help in fights. Guards and the sheriff fight with gear (a shield;
// the sheriff a gun too at ★★★).
//
// Law: an arrest is two guards carrying the player off (ctx.carryPlayerOff); in the cell:
// bail, a bribe, picking the lock (townLockpick.js — a jailbreak brings the guards back) or
// sleeping it off. Bandits live at a camp far out of town (BANDIT_ROLES, CAMP_DIST), raid
// fields and mug people at night; they leave the player be unless attacked — except at their
// camp: a warning, then up close swords drawn (a standoff: they don't attack yet) and a
// countdown, then (armed) a fight that only chases the player off their ground
// (CAMP_CHASE_DIST) or (unarmed) a robbery. The sheriff pays bounties on them.
//
// Missions (townJobs.js): townsfolk give out jobs — a ❗ over whoever has one; talk to them to
// take it, and back to them (❓) for the reward once it's done. The sheriff: bounties, guarding
// a field from a raid; townsfolk: deliveries from real shortages, debts, a lost kid; the
// drifter's shady job (no ❗ — he mentions it); three authored chains (CHAINS). Up to
// MAX_ACTIVE_JOBS at once, shown in the quest tracker with 📍 markers in the world.
//
// Bodies are a level of detail: only the nearest TOWN_MAX_BODIES townsfolk get a GLB character
// (pooled per model); the rest walk the same paths as data. Someone fighting the player is
// swapped for an EnemyPlayer (ctx.spawnFighter — the stage fighting code) and back.
//
// Shared town (Multiplayer — ctx.net, townNet.js): everyone in a town room sees the same
// townsfolk. The room's host runs them (the code below, as in a town of your own) and sends
// their positions a few times a second; the others draw them (followNet). Whatever a player
// does to someone — fights them, is followed by them, talks to them, sends them running, asks
// the guards after themselves — that player's game claims them (take) and runs them itself
// (the same code, against its own player) until they go back to normal life (decide → release).
// A hit on someone another game runs goes to that game ('hit'); deaths go to the host, who
// keeps the roster (newcomers), the clock and the market's one stock (trades are 'trade' ops).
// Wanted stars, attitude, jobs, goods and gear are each player's own (saved per room); other
// players' stars show over them, a hit on a player who isn't wanted is assault, and bringing
// a wanted one down pays a bounty. With no room (offline) it's a town of your own.
//
// Game access goes through `ctx` (built in bootstrapGameApp.js):
//   scene, camera, domElement, getPlayerPosition() → Vector3, setPlayerHidden(hidden),
//   getPlayerName(), isPlayerDead()
//   getGroundY(x, z), isOverWater(x, z), pathAt(x, z) → 'road' | 'trail' | null
//   getMapObjects(bounds) → [{ file, x, z, radius }], getRoadLamps() → [{ x, y, z }] (lamp heads),
//   setRoadLampsLit(on)
//   teleport(x, z, yaw), revivePlayer(x, z, yaw), setPositionConstraint(fn | null),
//   autoWalk(dirX, dirZ, step, dt) (the first day's guide walking the player), isSteering()
//   setTimeOfDay('day' | 'night'), showBanner(title, sub, ms)
//   spawnFighter({ x, z, yaw, url, hearts, swingChance, gear, name }) → EnemyPlayer,
//   removeFighter(enemy), releaseFighterGear(enemy), carryPlayerOff({ carrierUrl, onDone }),
//   cancelCarry(), isPlayerArmed()
//   spawnBlood(position, groundY), playSfx('hit' | 'chop'), dropCoins(position, n)
//   getCoins(), addCoins(delta) (coins past the wallet's cap drop at the player's feet), profileKey() → string | null,
//   memberKey() (the player's key in a shared town — their house)
//   startLoadout(items), endLoadout() → items, getItems() → items | null, grantItem(kind, n),
//   confiscate(), magicDamage { fire, ice }, getHealth() → { health, max }, heal(n),
//   refreshButtons() (something grabbed / dropped: the Block bar is / stops being its mode — the hose's 💧 Water)
//   net (townNet.js, or null): start(), stop(), isOn(), ready(), isHost(), id(), hostId(),
//   peerIds(), send(to, data), broadcast(data), loadRoomState(), saveRoomState(state),
//   roomId(), canSave(), playerCount(), sendBounty(to, coins)

import { FOUNDING_ROLES, ROLES, TOWN_NAME, characterForRole, firstName, livesOut, randomName } from './townPeople.js';
import { GOODS, GOOD_IDS, createMarket } from './townEconomy.js';
import * as THREE from 'three';
import { createJobTalk, createQuestTracker } from './townJobs.js';
import { createLockpick } from './townLockpick.js';
import { createMarketPanel } from './townMarketPanel.js';
import { isMiiCharacterUrl } from '../models/glbCharacterModel.js';
import { updateCampfire } from '../village/villageMode.js';
import {
  BOUNTY_PER_STAR, MINUTES_PER_SEC, MP_SAVE_PREFIX, NET_JOIN_TIMEOUT_S,
  BAG_MAX, FEED_LOG_MAX, FEED_MAX_SHOWN, FEED_SHOW_MS, LANTERN_DIST, LANTERN_PUT_AWAY_DIST, NEWCOMER_DELAY_S, NIGHT_FROM_H, NIGHT_TO_H, PVP_CREDIT_S, RAID_NOTICE_DIST, SAVE_EVERY_S, SAVE_PREFIX,
  START_MINUTES, TALK_RANGE, WALLET_MAX, _v2, angleLerp, el, heightScale, rand,
} from './townConfig.js';
import { installTownLayout } from './townLayout.js';
import { installTownFolk } from './townFolk.js';
import { installTownLaw } from './townLaw.js';
import { installTownReactions } from './townReactions.js';
import { installTownBandits } from './townBandits.js';
import { installTownTrade } from './townTrade.js';
import { installTownFishing } from './townFishing.js';
import { installTownLife } from './townLife.js';
import { installTownMissions } from './townMissions.js';
import { installTownActs } from './townActs.js';
import { installTownWire } from './townWire.js';
import { installTownCooking } from './townCooking.js';
import { installTownMemory, moodOf } from './townMemory.js';
import { installTownIntro } from './townIntro.js';
import { installTownHomes } from './townHomes.js';
import { installTownLights } from './townLights.js';
import { installTownGrab } from './townGrab.js';
import { installTownFarming } from './townFarming.js';

// Guests (and the session before a profile loads) keep the town in memory
let _memoryState = null;

export function createTownMode(ctx) {
  // The town's state and functions, shared by the townMode*.js modules (each adds its own)
  const T = {};
  T.active = false;
  T.ready = false;            // layout built, townsfolk spawned
  T.enterToken = 0;
  T.layout = null;            // built once (the map doesn't change): nav, places, props
  const root = new THREE.Group();
  root.name = 'town';
  T.npcs = [];
  T.nextId = 1;
  T.simT = 0;                 // s of town time while active (pauses with the game)
  const clock = { day: 1, minutes: START_MINUTES };
  T.isNight = null;
  T.lantern = false;          // the player carries a lantern (night, out of town)
  const law = { stars: 0, peak: 0, lastSeenAt: 0, lastKnown: new THREE.Vector3(), seen: false, tickAt: 0 };
  T.jail = null;              // { left } while the player is in the cell
  T.inRoom = null;            // the room the player's in ('shop' | 'jail' | 'home<i>', townRooms.js)
  T.doorRearm = null;         // a door just walked out of (not back in till stepped away from)
  T.doorLast = null;          // the player's spot last frame (walking into a door)
  T.sequence = null;          // busted / knocked out in progress (timeout token)
  T.gossip = [];              // [{ kind, who, by, at, fresh }]
  T.arrivals = [];            // [{ role, at }]
  T.departed = [];            // first names of the dead (not given to newcomers)
  T.talking = null;           // { npc, until }
  T.saveAt = 0;
  T.growAt = 0;
  T.lodAt = 0;
  T.actsAt = 0;
  T.actsKey = '';
  T.acts = [];
  const pool = new Map();     // url → [{ container, character }]
  T.market = createMarket();   // the shop's stock of goods (replaced by the saved one on enter)
  const goods = Object.fromEntries(GOOD_IDS.map((g) => [g, 0])); // what the player carries
  const soldOut = new Set();  // goods the market has run out of (for the feed)
  T.fishing = null;           // while the player's line is out (townFishing.js)
  T.cooking = null;           // { recipe, left, x, z } while something's on the fire (townCooking.js)
  T.intro = null;             // the first day's goals (townIntro.js), null once done
  T.jobs = [];                // posted + taken jobs (townJobs.js)
  T.nextJobId = 1;
  T.chainsDone = new Set();
  T.jobsAt = 0;               // next time new jobs go out
  const markers = new Map();  // job id → 📍 / ❗ / ❓ sprite
  const campWatch = { near: false, drawn: false, closeT: 0, remindAt: 0, robbed: false, tickAt: 0 }; // the player at the bandit camp
  T.strongboxHeld = false;    // (chain: the sheriff's strongbox)
  T.raidNight = null;         // the night (its evening's day) the bandits last raided the town (townBandits.js)
  T.raidPlan = null;          // tonight's raid: { night, houses, hit, tally, reported }
  T.nightKills = { n: 0, coins: 0 }; // bandits the player beat at night, for the sheriff's thanks
  T.lastItems = null;         // the town gear, as it was when the player last left
  // Shared town: 'off' (a town of your own), 'joining', 'host' (runs the townsfolk), 'client'
  const net = ctx.net ?? null;
  T.netMode = 'off';
  const netT = { send: 0, world: 0, full: 0, save: 0, label: 0 };
  T.joinUntil = 0;            // (wall clock ms)
  T.helloAt = 0;
  T.netFailed = false;
  T.netLoading = false;       // (the host loading the room's town)
  T.netSaying = false;        // (a speech bubble that came over the wire: not sent back)
  T.laidOut = false;          // layout in the scene, the player at the spawn
  T.lastPvp = null;           // { id, at } — the last player whose sword hit us
  T.pvpCrimeAt = -1e9;
  T.memoryPersonal = null;    // a guest's own things, { room, s }

  // ── DOM ──
  const hud = el('div', 'town-hud hidden');
  const top = el('div', 'town-top ui-panel');
  const topPlace = el('span', 'town-top-place', `🏘️ ${TOWN_NAME}`);
  const topSep = el('span', 'town-top-sep', '·');
  const topClock = el('span', 'town-top-clock');
  top.append(topPlace, topSep, topClock);
  const stars = el('div', 'town-stars hidden');
  const jailChip = el('div', 'town-jail ui-panel hidden');
  const campChip = el('div', 'town-jail town-camp ui-panel hidden');
  const feed = el('div', 'town-feed');
  const actsEl = el('div', 'town-acts hidden');
  const fade = el('div', 'town-fade');
  // What the player carries; the food can be eaten (tap) for health
  const goodsEl = el('div', 'town-goods');
  const bagEl = el('span', 'town-good town-bag');
  bagEl.title = 'Your bag (the rest goes in the chest at home)';
  goodsEl.append(bagEl);
  const goodEls = {};
  for (const g of GOOD_IDS) {
    const b = el('button', 'town-good');
    b.type = 'button';
    b.disabled = !GOODS[g].food;
    b.title = GOODS[g].food ? `Eat ${GOODS[g].label} (+${GOODS[g].heal} health)` : GOODS[g].label;
    b.addEventListener('click', () => { if (T.active) T.eat(g); });
    goodEls[g] = b;
    goodsEl.append(b);
  }
  // Recent notifications: 🔔 by the ⚙️ button drops down what the feed said (newest first)
  const logBtn = el('button', 'town-log-btn');
  logBtn.type = 'button';
  logBtn.title = 'Recent notifications';
  const logBadge = el('span', 'town-log-badge hidden');
  logBtn.append(el('span', null, '🔔'), logBadge);
  const logPanel = el('div', 'town-log ui-panel hidden');
  const logList = el('div', 'town-log-list');
  logPanel.append(el('div', 'town-log-title', 'Recent'), logList);
  const feedLog = [];         // [{ text, when }] newest first
  let unread = 0;
  const renderLog = () => {
    logList.replaceChildren(...(feedLog.length ? feedLog.map((e) => {
      const row = el('div', 'town-log-line');
      row.append(el('span', 'town-log-when', e.when), el('span', null, e.text));
      return row;
    }) : [el('div', 'town-log-empty', 'Nothing yet.')]));
  };
  const renderBadge = () => {
    logBadge.textContent = unread > 9 ? '9+' : String(unread);
    logBadge.classList.toggle('hidden', unread <= 0);
  };
  const toggleLog = (open = logPanel.classList.contains('hidden')) => {
    logPanel.classList.toggle('hidden', !open);
    if (open) { unread = 0; renderBadge(); renderLog(); }
  };
  logBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleLog(); });
  // (a tap anywhere else closes it)
  document.addEventListener('pointerdown', (e) => {
    if (!logPanel.classList.contains('hidden') && !logPanel.contains(e.target) && !logBtn.contains(e.target)) toggleLog(false);
  });
  logPanel.style.pointerEvents = 'auto';
  // Phones: coins (of the wallet's cap) and the bag, compact beside the health bar
  const walletEl = el('div', 'town-wallet');
  let walletText = '';
  const renderWallet = () => {
    const carried = GOOD_IDS.reduce((sum, g) => sum + goods[g], 0);
    const coins = Math.max(0, Math.round(ctx.getCoins()));
    const text = `🪙 ${coins}/${WALLET_MAX} · 🎒 ${carried}/${BAG_MAX}`;
    if (text === walletText) return;
    walletText = text;
    walletEl.textContent = text;
    walletEl.classList.toggle('town-wallet-full', coins >= WALLET_MAX || carried >= BAG_MAX);
  };
  hud.append(top, stars, jailChip, campChip, feed, goodsEl, actsEl, logBtn, logPanel);
  document.body.append(hud, fade);
  (document.getElementById('health-display') ?? hud).append(walletEl);
  const renderGoods = () => {
    const carried = GOOD_IDS.reduce((s, g) => s + goods[g], 0);
    bagEl.textContent = `🎒 ${carried}/${BAG_MAX}`;
    bagEl.classList.toggle('town-bag-full', carried >= BAG_MAX);
    for (const g of GOOD_IDS) {
      goodEls[g].textContent = `${GOODS[g].emoji} ${goods[g]}`;
      // (cooked food only once there's some)
      goodEls[g].classList.toggle('hidden', !!GOODS[g].cooked && goods[g] <= 0);
    }
  };
  const marketPanel = createMarketPanel(hud, {
    onSellGood: (g) => T.sellGood(g),
    onClose: () => T.closeMarket(),
  });
  // The talk box with a townsperson (townJobs.js; townActs.js), the quest tracker, the jailbreak lock
  const jobTalk = createJobTalk(hud, {
    onEnd: () => T.endTalk(),
    top: () => (T.talking?.npc ? T.relationRow(T.talking.npc) : null),
  });
  const tracker = createQuestTracker(hud);
  const lockpick = createLockpick(hud);

  // On screen FEED_MAX_SHOWN at a time; the rest wait their turn (sooner gone with a queue behind)
  const feedQueue = [];
  let feedShown = 0;
  let feedGen = 0;
  const showFeed = () => {
    while (feedShown < FEED_MAX_SHOWN && feedQueue.length) {
      const line = el('div', 'town-feed-line', feedQueue.shift());
      feed.prepend(line);
      feedShown += 1;
      const gen = feedGen;
      const ms = feedQueue.length > 2 ? FEED_SHOW_MS * 0.6 : FEED_SHOW_MS;
      setTimeout(() => { line.classList.add('town-feed-out'); }, ms);
      setTimeout(() => {
        line.remove();
        if (gen !== feedGen) return;
        feedShown -= 1;
        showFeed();
      }, ms + 800);
    }
  };
  const feedLine = (text) => {
    feedQueue.push(text);
    showFeed();
    feedLog.unshift({ text, when: clockText().replace(/ [☀️🌙]+$/u, '') });
    if (feedLog.length > FEED_LOG_MAX) feedLog.length = FEED_LOG_MAX;
    if (logPanel.classList.contains('hidden')) { unread += 1; renderBadge(); } else renderLog();
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
    return `Day ${clock.day} · ${hh}:${mm} ${T.isNight ? '🌙' : '☀️'}`;
  };
  const hour = () => (clock.minutes % 1440) / 60;

  // ── Persistence ──
  const saveKey = () => { const k = ctx.profileKey(); return k ? `${SAVE_PREFIX}${k}` : null; };
  const snapshot = () => ({
    v: 1,
    day: clock.day,
    minutes: clock.minutes,
    people: T.npcs.filter((n) => n.alive).map((n) => ({
      id: n.id, name: n.name, role: n.role, url: n.url, home: n.homeIndex,
      money: Math.round(n.money), attitude: Math.round(n.attitude * 100) / 100,
      carry: { ...n.carry },
      vendetta: !!n.vendetta, following: !!n.following,
      mem: n.mem?.length ? n.mem : undefined,
    })),
    intro: T.introSnapshot(),
    jobs: T.jobs.map((j) => ({ ...j, data: { ...j.data, raiders: undefined } })),
    nextJobId: T.nextJobId,
    chainsDone: [...T.chainsDone],
    strongboxHeld: T.strongboxHeld,
    raidNight: T.raidNight,
    nightKills: { ...T.nightKills },
    pending: T.arrivals.map((a) => a.role),
    departed: T.departed,
    nextId: T.nextId,
    market: T.market.snapshot(),
    houses: T.houses,
    fieldOwners: T.fieldOwners,
    goods: { ...goods },
    items: ctx.getItems() ?? T.lastItems,
    ...T.homesSnapshot(),
    ...T.farmSnapshot(),
  });
  // Shared town: the world (the host keeps it in the room — townNet.js) and the player's own
  // things (saved per room on this device)
  const worldSnapshot = () => ({
    v: 1,
    day: clock.day,
    minutes: clock.minutes,
    people: T.npcs.filter((n) => n.alive).map((n) => ({
      id: n.id, name: n.name, role: n.role, url: n.url, home: n.homeIndex,
      money: Math.round(n.money), carry: { ...n.carry },
      jl: Math.max(0, Math.round(n.jailedUntil - T.simT)), ol: Math.max(0, Math.round(n.outlawUntil - T.simT)),
    })),
    pending: T.arrivals.map((a) => a.role),
    departed: T.departed,
    nextId: T.nextId,
    market: T.market.snapshot(),
    houses: T.houses,
    fieldOwners: T.fieldOwners,
    raidNight: T.raidNight,
    at: Date.now(),
  });
  const personalSnapshot = () => ({
    v: 1,
    goods: { ...goods },
    items: ctx.getItems() ?? T.lastItems,
    att: Object.fromEntries(T.npcs.filter((n) => n.alive && Math.abs(n.attitude) > 0.01).map((n) => [n.id, Math.round(n.attitude * 100) / 100])),
    vend: Object.fromEntries(T.npcs.filter((n) => n.alive && n.vendetta).map((n) => [n.id, n.vendettaFor || 'friend'])),
    follow: T.npcs.filter((n) => n.alive && n.following && !n.escort).map((n) => n.id),
    mem: Object.fromEntries(T.npcs.filter((n) => n.alive && n.mem?.length).map((n) => [n.id, n.mem])),
    intro: T.introSnapshot(),
    jobs: T.jobs.map((j) => ({ ...j, data: { ...j.data, raiders: undefined } })),
    nextJobId: T.nextJobId,
    chainsDone: [...T.chainsDone],
    strongboxHeld: T.strongboxHeld,
    nightKills: { ...T.nightKills },
    ...T.homesSnapshot(),
    ...T.farmSnapshot(),
  });
  const personalKey = () => {
    const k = ctx.profileKey();
    const room = net?.roomId();
    return k && room ? `${MP_SAVE_PREFIX}${k}_${room}` : null;
  };
  const loadPersonal = () => {
    const key = personalKey();
    if (key) {
      try {
        const s = JSON.parse(localStorage.getItem(key) || 'null');
        if (s?.v === 1) return s;
      } catch (_) { /* fresh */ }
    }
    return T.memoryPersonal && T.memoryPersonal.room === net?.roomId() ? T.memoryPersonal.s : null;
  };
  // What's the player's own in a shared town (attitude, grudges, followers) back on the townsfolk
  const applyOwn = (own) => {
    for (const n of T.npcs) {
      n.attitude = Number(own?.att?.[n.id]) || 0;
      const v = own?.vend?.[n.id];
      n.vendetta = !!v;
      n.vendettaFor = v || undefined;
      n.mem = Array.isArray(own?.mem?.[n.id]) ? own.mem[n.id] : [];
    }
    for (const id of own?.follow ?? []) {
      const n = T.npcById(id);
      if (n && !n.def.law && !n.def.outlaw && T.take(n)) {
        n.following = true;
        T.setTask(n, { type: 'follow', dur: Infinity });
      }
    }
  };
  const save = () => {
    if (!T.ready) return;
    if (T.mp()) {
      const s = personalSnapshot();
      T.memoryPersonal = { room: net.roomId(), s };
      const key = personalKey();
      if (key) { try { localStorage.setItem(key, JSON.stringify(s)); } catch (_) { /* storage blocked */ } }
      return;
    }
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

  // ── Arrivals (newcomers take the place of the dead) ──
  const usedNames = () => new Set([...T.npcs.filter((n) => n.alive).map((n) => firstName(n.name)), ...T.departed]);
  const updateArrivals = () => {
    for (let i = T.arrivals.length - 1; i >= 0; i--) {
      const a = T.arrivals[i];
      if (T.simT < a.at) continue;
      T.arrivals.splice(i, 1);
      // (one to a house: no house free — a player took it — no newcomer)
      const home = livesOut(ROLES[a.role]) ? -1 : T.freeHome();
      if (home < 0 && !livesOut(ROLES[a.role])) continue;
      const n = T.makeNpc({ id: T.nextId++, name: randomName(a.role, usedNames()), role: a.role, url: characterForRole(a.role), home });
      if (n.def.outlaw) {
        // (a new face at the bandit camp)
        n.x = T.layout.places.camp.x;
        n.z = T.layout.places.camp.z;
        T.npcs.push(n);
        T.decide(n);
        if (T.distToPlayer(n) < 40) feedLine(`💀 ${n.name} joined the bandits.`);
        continue;
      }
      // (they've heard what the town thinks of the player)
      n.attitude = T.reputation() * 0.4;
      const E = T.layout.places.entrance;
      n.x = E.x;
      n.z = E.z;
      T.npcs.push(n);
      T.assignWork();
      T.setTask(n, { type: 'wander', to: n.home, dur: 2 });
      T.gossip.push({ kind: 'newcomer', who: firstName(n.name), at: T.simT, fresh: true });
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
    if (night !== T.isNight) {
      T.isNight = night;
      ctx.setTimeOfDay(night ? 'night' : 'day');
      T.rooms.setNight(night);
    }
    topClock.textContent = clockText();
  };
  // At night, out past the houses, the player carries a lantern (a little nearer before it's
  // put away again, so it doesn't flicker on the edge)
  const updateLantern = () => {
    if (!T.isNight || T.inRoom || T.jail || !T.layout.buildings.length) { T.lantern = false; return; }
    const p = T.playerPos();
    let d = Infinity;
    for (const b of T.layout.buildings) d = Math.min(d, Math.hypot(p.x - b.x, p.z - b.z) - b.radius);
    T.lantern = d > (T.lantern ? LANTERN_PUT_AWAY_DIST : LANTERN_DIST);
  };

  // The wizard (out at his stall — no town house): there's always one (an old save had none)
  const ensureWizard = () => {
    if (T.npcs.some((n) => n.alive && n.role === 'wizard') || T.arrivals.some((a) => a.role === 'wizard')) return;
    T.npcs.push(T.makeNpc({ id: T.nextId++, name: randomName('wizard', usedNames()), role: 'wizard', url: characterForRole('wizard') }));
  };

  // ── Lifecycle ──
  // state: the town (a save of your own, or a shared town's world); own: the player's things
  // (the same save for a town of your own)
  const spawnTown = (state = load(), own = state) => {
    T.npcs = [];
    T.gossip = [];
    T.arrivals = [];
    T.departed = Array.isArray(state?.departed) ? state.departed : [];
    T.market = createMarket(state?.market);
    soldOut.clear();
    GOOD_IDS.forEach((g) => { goods[g] = Math.max(0, Math.floor(own?.goods?.[g] || 0)); });
    renderGoods();
    T.lastItems = own?.items ?? null;
    // In Town the player has only what they bought here (nothing, the first time)
    ctx.startLoadout(T.lastItems ?? {});
    // (the houses — who owns which — and the player's chest, lock-picks: townHomes.js)
    T.restoreHomes(state, own);
    // (the fields — whose they are — and the player's seeds / what they planted: townFarming.js)
    T.restoreFarm(state, own);
    // (the last raid night, the bandits the player beat last night — townBandits.js)
    T.restoreBandits(state, own);
    T.nextId = state?.nextId ?? 1;
    if (state) {
      clock.day = state.day ?? 1;
      clock.minutes = state.minutes ?? START_MINUTES;
      for (const p of state.people) {
        if (!ROLES[p.role]) continue;
        // (Miis are Classic's only: an old save's Mii townsperson gets another body)
        const n = T.makeNpc(isMiiCharacterUrl(p.url) ? { ...p, url: characterForRole(p.role) } : p);
        // (a shared town's world: still in the cell / wanted for this long)
        if (p.jl > 0) { n.jailedUntil = T.simT + p.jl; n.x = T.layout.places.jail.x; n.z = T.layout.places.jail.z; }
        if (p.ol > 0) n.outlawUntil = T.simT + p.ol;
        T.npcs.push(n);
        T.nextId = Math.max(T.nextId, (p.id ?? 0) + 1);
      }
      for (const role of state.pending ?? []) T.arrivals.push({ role, at: T.simT + rand(...NEWCOMER_DELAY_S) });
    } else {
      clock.day = 1;
      clock.minutes = START_MINUTES;
      const taken = new Set();
      // One to a house, the player's kept first; in the order the town needs them
      // (FOUNDING_ROLES — more houses than that: more townsfolk)
      T.reserveFirst();
      for (let k = 0, home = T.freeHome(); home >= 0; k++, home = T.freeHome()) {
        const role = FOUNDING_ROLES[k] ?? 'townsfolk';
        const name = randomName(role, taken);
        taken.add(firstName(name));
        T.npcs.push(T.makeNpc({ id: T.nextId++, name, role, url: characterForRole(role), home }));
      }
    }
    // (one to a house — old saves had families sharing — and the player's house kept)
    T.settleAfterSpawn();
    if (T.isHost()) { T.ensureGang(); ensureWizard(); }
    T.assignWork();
    if (T.mp()) applyOwn(own);
    for (const n of T.npcs) n.memBias = T.memBiasOf(n);
    T.restoreJobs(own);
    // (no save of the player's own yet: the first day starts — a save's null: it's done)
    T.startIntro(own ? own.intro : undefined);
    // Start mid-day: everyone already at whatever they'd be doing
    T.isNight = null;
    applyTime();
    for (const n of T.npcs) {
      if (!T.mine(n)) continue; // (a shared town's client: they're where the host says)
      T.decide(n);
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
    T.ready = true;
    save();
  };

  const enter = () => {
    if (T.active) return;
    T.active = true;
    T.ready = false;
    const token = ++T.enterToken;
    document.body.classList.add('town-mode');
    hud.classList.remove('hidden');
    renderStars();
    window.addEventListener('keydown', T.onKey);
    T.stalls.setActive(true);
    T.rooms.setActive(true);
    // Shared town: find the player's room meanwhile (townNet.js) — the town waits on it
    T.netMode = 'off';
    T.laidOut = false;
    if (net) {
      T.netMode = 'joining';
      T.netFailed = false;
      T.netLoading = false;
      T.helloAt = 0;
      T.joinUntil = performance.now() + NET_JOIN_TIMEOUT_S * 1000;
      net.start().then((ok) => { if (!ok && token === T.enterToken) T.netFailed = true; })
        .catch(() => { if (token === T.enterToken) T.netFailed = true; });
    }
    // (built on the next frame: the first nav grid samples a few thousand ground heights)
    setTimeout(() => {
      if (!T.active || token !== T.enterToken) return;
      try {
        if (!T.layout) T.layout = T.buildLayout();
      } catch (e) {
        console.error('[Town] layout failed:', e);
        return;
      }
      ctx.scene.add(root);
      root.add(T.layout.props.group);
      T.addLights(root);
      const P = T.layout.places;
      ctx.teleport(P.spawn.x, P.spawn.z, Math.atan2(P.market.x - P.spawn.x, P.market.z - P.spawn.z));
      T.laidOut = true;
      if (T.netMode === 'joining') { feedLine(`🏘️ Finding your town…`); return; }
      spawnTown();
      feedLine(`Welcome to ${TOWN_NAME}! Walk up to people to talk.`);
    }, 30);
  };

  const exit = () => {
    if (!T.active) return;
    save();
    if (T.netMode === 'host' && T.ready && net.canSave()) net.saveRoomState(worldSnapshot());
    T.lastItems = ctx.endLoadout() ?? T.lastItems;
    T.closeMarket();
    T.resetHomes();
    T.resetFarm();
    jobTalk.close();
    lockpick.stop();
    ctx.cancelCarry();
    for (const [, m] of markers) { m.parent?.remove(m); m.material.map?.dispose(); m.material.dispose(); }
    markers.clear();
    tracker.render([]);
    T.stalls.setActive(false);
    T.rooms.setActive(false);
    T.fishing = null;
    T.stopFishingRig();
    T.hideFishingHud();
    T.cooking = null;
    T.resetMemoryHud();
    T.active = false;
    T.ready = false;
    T.enterToken += 1;
    T.sequence = null;
    T.fadeTo(false);
    for (const n of T.npcs) {
      if (n.fighter) { ctx.removeFighter(n.fighter); n.fighter = null; }
      T.releaseBody(n);
    }
    T.npcs = [];
    if (T.jail || T.inRoom) { T.jail = null; ctx.setPositionConstraint(null); }
    // (out of a house's room first: it's under the map)
    if (T.inRoom) {
      const r = T.layout.places.rooms[T.inRoom];
      ctx.teleport(r.door.x, r.door.z, r.exitYaw);
    }
    T.inRoom = null;
    jailChip.classList.add('hidden');
    campChip.classList.add('hidden');
    Object.assign(campWatch, { near: false, drawn: false, closeT: 0, remindAt: 0, robbed: false, tickAt: 0 });
    law.stars = 0;
    law.peak = 0;
    T.lantern = false;
    T.talking = null;
    T.actsKey = '';
    actsEl.replaceChildren();
    actsEl.classList.add('hidden');
    feed.replaceChildren();
    feedQueue.length = 0;
    feedShown = 0;
    feedGen += 1;
    feedLog.length = 0;
    unread = 0;
    renderBadge();
    toggleLog(false);
    T.resetLights();
    root.parent?.remove(root);
    hud.classList.add('hidden');
    document.body.classList.remove('town-mode');
    window.removeEventListener('keydown', T.onKey);
    T.isNight = null;
    T.netMode = 'off';
    T.laidOut = false;
    net?.stop();
    topPlace.textContent = `🏘️ ${TOWN_NAME}`;
  };

  const update = (dt) => {
    if (!T.active) return;
    if (T.netMode === 'joining') { if (T.laidOut) T.tickJoin(); return; }
    if (!T.ready) return;
    dt = Math.min(dt, 0.1);
    T.simT += dt;
    clock.minutes += dt * MINUTES_PER_SEC;
    if (clock.minutes >= 1440) { clock.minutes -= 1440; clock.day += 1; }
    applyTime();
    updateLantern();
    if (T.mp()) { T.checkNetRole(); T.netTick(); }
    updateCampfire(T.layout.props.fire, T.simT);
    if (T.jail) {
      T.jail.left -= dt;
      T.renderJail();
      if (T.jail.left <= 0) T.endJail('🔓 Time served. You\'re free to go.');
    }
    if (!T.jail && !T.doorPick && lockpick.isOpen()) lockpick.stop();
    lockpick.update(dt);
    if (jobTalk.isOpen()) {
      const n = T.talking?.npc;
      if (!n || !n.alive || n.fighter || T.distToPlayer(n) > TALK_RANGE + 1.5 || ctx.isPlayerDead() || T.sequence) jobTalk.close();
      else if (n.task?.type === 'talk') n.task.t = 0;
    }
    updateCampfire(T.layout.props.campFire, T.simT + 3);
    T.updateLights(dt);
    // The jail's cell door: shut while the player (or a townsperson) is inside, open otherwise
    const door = T.layout.props.door;
    const occupied = T.jail || T.npcs.some((n) => n.alive && n.jailedUntil > T.simT);
    if (door) door.rotation.y = angleLerp(door.rotation.y, occupied ? 0 : -1.9, 1 - Math.exp(-4 * dt));

    T.updateRooms();
    T.updateHomes();
    for (const n of T.npcs) T.updateNpc(n, dt);
    T.npcs = T.npcs.filter((n) => n.alive || n.dying);
    T.updateFishing(dt);
    T.updateIntroWalk(dt);
    T.updateCooking(dt);
    T.updateFarm(dt);
    if (T.simT > T.growAt) { T.growAt = T.simT + 1; T.updateRegrowth(); }
    // (the market panel shuts when the merchant leaves the counter or the player walks off)
    if (marketPanel.isOpen() && (!T.marketOpen() || !T.nearStall())) T.closeMarket();
    for (const g of T.gossip) if (T.simT - g.at > 240) g.fresh = false;
    if (T.isHost()) updateArrivals();
    if (T.simT > law.tickAt) { law.tickAt = T.simT + 0.5; T.updateLaw(); T.updateCampWatch(); T.updateNightRaid(); T.updateIntro(); T.updateJobs(); T.updateReputation(); }
    T.updateMarkers();
    renderWallet();
    if (T.simT > T.lodAt) { T.lodAt = T.simT + 0.4; T.updateLod(); }
    for (const n of T.npcs) if (n.body && !n.dying) T.syncBody(n, dt);
    if (T.simT > T.actsAt) { T.actsAt = T.simT + 0.15; T.refreshActs(); }
    if (T.simT > T.saveAt) { T.saveAt = T.simT + SAVE_EVERY_S; save(); }
    // (last: the shop camera takes over from the player controls' pose this frame)
    T.stalls.update(dt, T.simT);
  };

  // The player's sword swing reached `tip` (world), moving along swingDir: hits the
  // townsperson it passes through (those fighting are EnemyPlayers — the stage code hits
  // them), or chops the tree it's in
  const trySwordHit = (tip, swingDir) => {
    if (!T.active || !T.ready || T.sequence || T.inRoom) return false;
    for (const n of T.npcs) {
      if (!n.alive || !n.body || n.fighter || n.inside || n.dying || T.rooms.roomAt(n.x, n.z)) continue;
      if (T.simT - n.lastHitAt < 0.7) continue;
      const cy = T.groundY(n) + 0.55 * heightScale(n.url);
      if (Math.hypot(tip.x - n.x, tip.y - cy, tip.z - n.z) > 0.7) continue;
      const dir = _v2.set(swingDir.x, 0, swingDir.z);
      if (dir.lengthSq() < 1e-6) dir.set(n.x - T.playerPos().x, 0, n.z - T.playerPos().z);
      dir.normalize();
      T.hurt(n, { x: dir.x, z: dir.z });
      return true;
    }
    return T.tryChop(tip);
  };

  // The player went down: wanted → busted, otherwise knocked out. True when handled.
  const onPlayerDown = () => {
    if (!T.active) return false;
    // (shared town: a player brought us down — wanted, that's their bounty)
    const hunter = T.lastPvp && T.simT - T.lastPvp.at < PVP_CREDIT_S ? T.lastPvp.id : null;
    T.lastPvp = null;
    if (law.stars > 0) {
      if (hunter && T.mp()) net.sendBounty(hunter, BOUNTY_PER_STAR * law.stars);
      T.busted();
    } else T.knockedOut();
    return true;
  };

  Object.assign(T, {
    actsEl, advanceClock, campChip, campWatch, clock, fade, feedLine, goods, hour, hud, jailChip,
    jobTalk, law, loadPersonal, lockpick, markers, marketPanel, net, netT, pool, renderGoods,
    renderStars, root, save, soldOut, spawnTown, top, topPlace, tracker, usedNames, worldSnapshot,
  });
  installTownLayout(T, ctx);
  installTownFolk(T, ctx);
  installTownLaw(T, ctx);
  installTownReactions(T, ctx);
  installTownBandits(T, ctx);
  installTownTrade(T, ctx);
  installTownFishing(T, ctx);
  installTownLife(T, ctx);
  installTownMissions(T, ctx);
  installTownActs(T, ctx);
  installTownWire(T, ctx);
  installTownCooking(T, ctx);
  installTownMemory(T, ctx);
  installTownIntro(T, ctx);
  installTownHomes(T, ctx);
  installTownLights(T, ctx);
  installTownGrab(T, ctx);
  installTownFarming(T, ctx);

  // ── Settings → Town (settingsPanel.js): everyone in town, their coins and a few stats ──
  const TASK_STATUS = {
    work: 'Working', eat: 'Eating', deliver: 'Selling goods', browse: 'Shopping', social: 'By the fire',
    sleep: 'Sleeping', wander: 'Out and about', chat: 'Chatting', talk: 'Talking', follow: 'Following you',
    jailed: 'In jail', lost: 'Lost', flee: 'Running away', hide: 'Hiding', fight: 'Fighting', brawl: 'Brawling',
    mug: 'Up to no good', raid: 'Raiding', raidHome: 'Raiding', camp: 'At camp', respond: 'On duty',
    search: 'On duty', arrest: 'On duty', guide: 'Showing you around', burgle: 'Breaking in', prowl: 'Prowling',
    seek: 'Looking for you',
  };
  const npcStatus = (n) => {
    if (n.fighter) return 'Fighting';
    if (n.jailedUntil > T.simT) return 'In jail';
    return TASK_STATUS[n.task?.type] ?? (n.inside ? 'Indoors' : 'Out and about');
  };
  const roster = () => {
    if (!T.active || !T.ready) return null;
    const people = T.npcs.filter((n) => n.alive).map((n) => ({
      kind: n.def.outlaw ? 'outlaw' : 'townsfolk',
      name: n.name,
      role: n.def.label,
      emoji: n.def.emoji,
      coins: Math.max(0, Math.round(n.money)),
      hp: n.hp,
      maxHp: n.maxHp,
      mood: moodOf(n.attitude),
      bounty: n.def.bounty ?? 0,
      status: npcStatus(n),
    }));
    const { health, max } = ctx.getHealth();
    people.push({
      kind: 'you',
      name: ctx.getPlayerName(),
      role: 'You',
      emoji: '🧍',
      coins: Math.max(0, Math.round(ctx.getCoins())),
      hp: health,
      maxHp: max,
      stars: law.stars,
      goods: GOOD_IDS.reduce((sum, g) => sum + (goods[g] || 0), 0),
      chest: T.store?.coins ?? 0,
      status: T.jail ? 'In jail' : T.inRoom ? 'Indoors' : 'Out and about',
    });
    for (const p of net?.players?.() ?? []) {
      people.push({
        kind: 'player', name: p.name, role: 'Player', emoji: '🧍', coins: p.coins, hp: p.hp, maxHp: p.maxHp,
        stars: p.stars, status: p.stars > 0 ? 'Wanted' : 'Out and about',
      });
    }
    // The player's bag (tap a food to eat) and jobs — on phones these live here, not on the HUD
    const bag = {
      max: BAG_MAX,
      goods: GOOD_IDS.filter((g) => !GOODS[g].cooked || goods[g] > 0).map((g) => ({
        id: g, emoji: GOODS[g].emoji, label: GOODS[g].label, n: goods[g] || 0, food: !!GOODS[g].food, heal: GOODS[g].heal ?? 0,
      })),
    };
    return {
      town: TOWN_NAME, day: clock.day, time: clockText(), shared: T.netMode === 'host' || T.netMode === 'client', people,
      bag, jobs: tracker.entries(),
    };
  };

  return {
    enter,
    exit,
    roster,
    eat: (g) => { if (T.active && T.ready) T.eat(g); },
    update,
    trySwordHit,
    // Fishing, the line out: the phone's Block bar is a reel ({ reel, cue, text, tension }) — or null
    fishingHud: () => (T.active && T.ready ? T.fishingHud() : null),
    getWeaponTargets: T.getWeaponTargets,
    getMagicTargets: T.getMagicTargets,
    onPlayerDown,
    interact: T.interact,
    // Shared town (townNet.js / bootstrapGameApp.js)
    handleNet: T.handleNet,
    getStars: () => (T.active ? law.stars : 0),
    // Another player's sword hit us (for the bounty if it brings us down)
    onPvpHurt: (fromId) => { if (T.active) T.lastPvp = { id: fromId, at: T.simT }; },
    // Our sword hit another player: hurting someone who isn't wanted is assault
    onAttackPlayer: ({ stars }) => {
      if (!T.active || !T.ready || stars > 0 || T.simT - T.pvpCrimeAt < 2) return;
      T.pvpCrimeAt = T.simT;
      T.crime('assault', null);
    },
    onBounty: (name, coins) => {
      if (!T.active) return;
      ctx.addCoins(coins);
      feedLine(`💰 You brought ${name} in · +${coins} 🪙`);
      ctx.showBanner('BOUNTY!', `${name} is off to jail · 🪙 +${coins}`, 2600);
    },
    isActive: () => T.active,
    // Who's out to hurt the player, for the sword / wand's camera auto-aim (bootstrapGameApp.js):
    // whoever's fighting them within `range` m, and raiding bandits close by at night — feet positions
    threats: (range) => {
      if (!T.active || !T.ready || T.inRoom || T.jail || T.sequence || T.stalls.focused() || T.jobTalk.isOpen()) return [];
      const out = [];
      for (const n of T.npcs) {
        if (!n.alive || n.dying) continue;
        if (n.fighter) {
          if (!n.fighter.isDead && T.distToPlayer(n) < range) out.push(n.fighter.group.position);
        } else if (n.def.outlaw && T.isNight && n.body && !n.inside && ['raid', 'burgle', 'prowl', 'mug'].includes(n.task?.type)
          && T.distToPlayer(n) < Math.min(range, RAID_NOTICE_DIST + 3) && !T.rooms.roomAt(n.x, n.z)) {
          out.push(new THREE.Vector3(n.x, T.groundY(n), n.z));
        }
      }
      return out;
    },
    // Something grabbed in hand (townGrab.js): its Block bar mode ('water' — the hose; null: none),
    // the bar held down / let go, dropping it (the phone's 🗡/✋ button)
    holding: () => !!(T.active && T.ready && T.held),
    // A panel / counter / talk / sequence has the player (no gyro turning or lean walking)
    handsBusy: () => !!(T.active && T.ready && (T.sequence || T.marketPanel.isOpen() || T.storage.isOpen()
      || T.stalls.focused() || T.lockpick.isOpen() || T.jobTalk.isOpen() || T.cooking)),
    heldBar: () => (T.active && T.ready ? T.heldBar() : null),
    useHeld: (on) => { if (T.active) T.useHeld(on); },
    dropHeld: () => { if (T.active) T.dropHeld(); },
    // Night, out of town: the player carries a lantern in their left hand
    wantsLantern: () => !!(T.active && T.ready && T.lantern),
    // The phone's Block bar label while there's something to do (undefined: it stays Block)
    interactLabel: () => (T.active && T.acts.length ? T.acts[0].label : undefined),
    // (dev console)
    debug: () => ({ T, netMode: T.netMode, room: net?.roomId(), host: net?.hostId(), peers: net?.peerIds(), npcs: T.npcs, layout: T.layout, law, clock, arrivals: T.arrivals, market: T.market, goods, stalls: T.stalls, ctx, jobs: T.jobs, chainsDone: T.chainsDone, simT: () => T.simT, stallItemState: T.stallItemState, kill: (n) => T.die(n, { byPlayer: true }) }),
  };
}

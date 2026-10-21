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
//   getMapObjects(bounds) → [{ file, x, z, radius }]
//   teleport(x, z, yaw), revivePlayer(x, z, yaw), setPositionConstraint(fn | null)
//   setTimeOfDay('day' | 'night'), showBanner(title, sub, ms)
//   spawnFighter({ x, z, yaw, url, hearts, swingChance, gear, name }) → EnemyPlayer,
//   removeFighter(enemy), releaseFighterGear(enemy), carryPlayerOff({ carrierUrl, onDone }),
//   cancelCarry(), isPlayerArmed()
//   spawnBlood(position, groundY), playSfx('hit' | 'chop'), dropCoins(position, n)
//   getCoins(), addCoins(delta), profileKey() → string | null, onLobby()
//   startLoadout(items), endLoadout() → items, getItems() → items | null, grantItem(kind, n),
//   confiscate(), magicDamage { fire, ice }, getHealth() → { health, max }, heal(n)
//   net (townNet.js, or null): start(), stop(), isOn(), ready(), isHost(), id(), hostId(),
//   peerIds(), send(to, data), broadcast(data), loadRoomState(), saveRoomState(state),
//   roomId(), canSave(), playerCount(), sendBounty(to, coins)

import { FOUNDING_ROLES, ROLES, TOWN_NAME, characterForRole, firstName, randomName } from './townPeople.js';
import { GOODS, GOOD_IDS, createMarket } from './townEconomy.js';
import * as THREE from 'three';
import { createJobTalk, createQuestTracker } from './townJobs.js';
import { createLockpick } from './townLockpick.js';
import { createMarketPanel } from './townMarketPanel.js';
import { isMiiCharacterUrl } from '../models/glbCharacterModel.js';
import { updateCampfire } from '../village/villageMode.js';
import {
  BOUNTY_PER_STAR, FOUNDING_HOUSEHOLDS, MINUTES_PER_SEC, MP_SAVE_PREFIX, NET_JOIN_TIMEOUT_S,
  NEWCOMER_DELAY_S, NIGHT_FROM_H, NIGHT_TO_H, PVP_CREDIT_S, SAVE_EVERY_S, SAVE_PREFIX,
  START_MINUTES, TALK_RANGE, _v2, angleLerp, el, heightScale, rand,
} from './townConfig.js';
import { installTownLayout } from './townLayout.js';
import { installTownFolk } from './townFolk.js';
import { installTownLaw } from './townLaw.js';
import { installTownReactions } from './townReactions.js';
import { installTownBandits } from './townBandits.js';
import { installTownTrade } from './townTrade.js';
import { installTownLife } from './townLife.js';
import { installTownMissions } from './townMissions.js';
import { installTownActs } from './townActs.js';
import { installTownWire } from './townWire.js';

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
  const law = { stars: 0, peak: 0, lastSeenAt: 0, lastKnown: new THREE.Vector3(), seen: false, tickAt: 0 };
  T.jail = null;              // { left } while the player is in the cell
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
  T.market = createMarket();   // the stall's stock (replaced by the saved one on enter)
  const goods = { wood: 0, fish: 0, crops: 0 }; // what the player carries
  const soldOut = new Set();  // goods the market has run out of (for the feed)
  T.fishing = null;           // { left, x, z } while the player's line is out
  T.jobs = [];                // posted + taken jobs (townJobs.js)
  T.nextJobId = 1;
  T.chainsDone = new Set();
  T.jobsAt = 0;               // next time new jobs go out
  const markers = new Map();  // job id → 📍 / ❗ / ❓ sprite
  const campWatch = { near: false, drawn: false, closeT: 0, remindAt: 0, robbed: false, tickAt: 0 }; // the player at the bandit camp
  T.strongboxHeld = false;    // (chain: the sheriff's strongbox)
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
  const lobbyBtn = el('button', 'ui-btn ui-btn-secondary town-lobby', '⬅ Lobby');
  lobbyBtn.type = 'button';
  lobbyBtn.addEventListener('click', () => { if (T.active) ctx.onLobby(); });
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
    b.addEventListener('click', () => { if (T.active) T.eat(g); });
    goodEls[g] = b;
    goodsEl.append(b);
  }
  hud.append(top, stars, jailChip, campChip, lobbyBtn, feed, goodsEl, actsEl);
  document.body.append(hud, fade);
  const renderGoods = () => {
    for (const g of GOOD_IDS) goodEls[g].textContent = `${GOODS[g].emoji} ${goods[g]}`;
  };
  const marketPanel = createMarketPanel(hud, {
    onSellGood: (g) => T.sellGood(g),
    onClose: () => T.closeMarket(),
  });
  // A townsperson's job talk (townJobs.js), the quest tracker, the jailbreak lock
  const jobTalk = createJobTalk(hud);
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
    })),
    jobs: T.jobs.map((j) => ({ ...j, data: { ...j.data, raiders: undefined } })),
    nextJobId: T.nextJobId,
    chainsDone: [...T.chainsDone],
    strongboxHeld: T.strongboxHeld,
    pending: T.arrivals.map((a) => a.role),
    departed: T.departed,
    nextId: T.nextId,
    market: T.market.snapshot(),
    goods: { ...goods },
    items: ctx.getItems() ?? T.lastItems,
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
    at: Date.now(),
  });
  const personalSnapshot = () => ({
    v: 1,
    goods: { ...goods },
    items: ctx.getItems() ?? T.lastItems,
    att: Object.fromEntries(T.npcs.filter((n) => n.alive && Math.abs(n.attitude) > 0.01).map((n) => [n.id, Math.round(n.attitude * 100) / 100])),
    vend: Object.fromEntries(T.npcs.filter((n) => n.alive && n.vendetta).map((n) => [n.id, n.vendettaFor || 'friend'])),
    follow: T.npcs.filter((n) => n.alive && n.following && !n.escort).map((n) => n.id),
    jobs: T.jobs.map((j) => ({ ...j, data: { ...j.data, raiders: undefined } })),
    nextJobId: T.nextJobId,
    chainsDone: [...T.chainsDone],
    strongboxHeld: T.strongboxHeld,
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
  const homeForNewcomer = () => {
    const counts = T.layout.places.homes.map(() => 0);
    for (const n of T.npcs) if (n.alive) counts[n.homeIndex] = (counts[n.homeIndex] ?? 0) + 1;
    let best = 0;
    counts.forEach((c, i) => { if (c < counts[best]) best = i; });
    return best;
  };
  const updateArrivals = () => {
    for (let i = T.arrivals.length - 1; i >= 0; i--) {
      const a = T.arrivals[i];
      if (T.simT < a.at) continue;
      T.arrivals.splice(i, 1);
      const n = T.makeNpc({ id: T.nextId++, name: randomName(a.role, usedNames()), role: a.role, url: characterForRole(a.role), home: homeForNewcomer() });
      if (n.def.outlaw) {
        // (a new face at the bandit camp)
        n.x = T.layout.places.camp.x;
        n.z = T.layout.places.camp.z;
        T.npcs.push(n);
        T.decide(n);
        if (T.distToPlayer(n) < 40) feedLine(`💀 ${n.name} joined the bandits.`);
        continue;
      }
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
    }
    topClock.textContent = clockText();
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
      // Households of two or three (the kids land with the farmers); the other houses wait
      // for newcomers
      const households = Math.max(1, Math.min(T.layout.places.homes.length, FOUNDING_HOUSEHOLDS));
      FOUNDING_ROLES.forEach((role, i) => {
        const name = randomName(role, taken);
        taken.add(firstName(name));
        T.npcs.push(T.makeNpc({ id: T.nextId++, name, role, url: characterForRole(role), home: i % households }));
      });
    }
    if (T.isHost()) T.ensureGang();
    T.assignWork();
    if (T.mp()) applyOwn(own);
    T.restoreJobs(own);
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
    jobTalk.close();
    lockpick.stop();
    ctx.cancelCarry();
    for (const [, m] of markers) { m.parent?.remove(m); m.material.map?.dispose(); m.material.dispose(); }
    markers.clear();
    tracker.render([]);
    T.stalls.setActive(false);
    T.fishing = null;
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
    if (T.jail) { T.jail = null; ctx.setPositionConstraint(null); }
    jailChip.classList.add('hidden');
    campChip.classList.add('hidden');
    Object.assign(campWatch, { near: false, drawn: false, closeT: 0, remindAt: 0, robbed: false, tickAt: 0 });
    law.stars = 0;
    law.peak = 0;
    T.talking = null;
    T.actsKey = '';
    actsEl.replaceChildren();
    actsEl.classList.add('hidden');
    feed.replaceChildren();
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
    if (T.mp()) { T.checkNetRole(); T.netTick(); }
    updateCampfire(T.layout.props.fire, T.simT);
    if (T.jail) {
      T.jail.left -= dt;
      T.renderJail();
      if (T.jail.left <= 0) T.endJail('🔓 Time served. You\'re free to go.');
    }
    if (!T.jail && lockpick.isOpen()) lockpick.stop();
    lockpick.update(dt);
    if (jobTalk.isOpen()) {
      const n = T.talking?.npc;
      if (!n || !n.alive || n.fighter || T.distToPlayer(n) > TALK_RANGE + 1.5 || ctx.isPlayerDead() || T.sequence) jobTalk.close();
      else if (n.task?.type === 'talk') n.task.t = 0;
    }
    updateCampfire(T.layout.props.campFire, T.simT + 3);
    // The jail door: shut while the player (or a townsperson) is inside, open otherwise
    const door = T.layout.props.door;
    const occupied = T.jail || T.npcs.some((n) => n.alive && n.jailedUntil > T.simT);
    door.rotation.y = angleLerp(door.rotation.y, occupied ? 0 : -1.9, 1 - Math.exp(-4 * dt));

    for (const n of T.npcs) T.updateNpc(n, dt);
    T.npcs = T.npcs.filter((n) => n.alive || n.dying);
    T.updateFishing(dt);
    if (T.simT > T.growAt) { T.growAt = T.simT + 1; T.updateRegrowth(); }
    // (the market panel shuts when the merchant leaves the stall or the player walks off)
    if (marketPanel.isOpen() && (!T.marketOpen() || !T.nearStall())) T.closeMarket();
    for (const g of T.gossip) if (T.simT - g.at > 240) g.fresh = false;
    if (T.isHost()) updateArrivals();
    if (T.simT > law.tickAt) { law.tickAt = T.simT + 0.5; T.updateLaw(); T.updateCampWatch(); T.updateJobs(); }
    T.updateMarkers();
    if (T.simT > T.lodAt) { T.lodAt = T.simT + 0.4; T.updateLod(); }
    for (const n of T.npcs) if (n.body && !n.dying) T.syncBody(n, dt);
    if (T.simT > T.actsAt) { T.actsAt = T.simT + 0.15; T.refreshActs(); }
    if (T.simT > T.saveAt) { T.saveAt = T.simT + SAVE_EVERY_S; save(); }
    // (the weapon stall's keeper is there in the market's hours)
    T.stalls.setKeeperVisible('gear', T.gearOpen());
    // (last: the shop camera takes over from the player controls' pose this frame)
    T.stalls.update(dt, T.simT);
  };

  // The player's sword swing reached `tip` (world), moving along swingDir: hits the
  // townsperson it passes through (those fighting are EnemyPlayers — the stage code hits
  // them), or chops the tree it's in
  const trySwordHit = (tip, swingDir) => {
    if (!T.active || !T.ready || T.sequence) return false;
    for (const n of T.npcs) {
      if (!n.alive || !n.body || n.fighter || n.inside || n.dying) continue;
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
    renderStars, root, save, soldOut, spawnTown, topPlace, tracker, usedNames, worldSnapshot,
  });
  installTownLayout(T, ctx);
  installTownFolk(T, ctx);
  installTownLaw(T, ctx);
  installTownReactions(T, ctx);
  installTownBandits(T, ctx);
  installTownTrade(T, ctx);
  installTownLife(T, ctx);
  installTownMissions(T, ctx);
  installTownActs(T, ctx);
  installTownWire(T, ctx);


  return {
    enter,
    exit,
    update,
    trySwordHit,
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
    // The phone's Block bar label while there's something to do (undefined: it stays Block)
    interactLabel: () => (T.active && T.acts.length ? T.acts[0].label : undefined),
    // (dev console)
    debug: () => ({ netMode: T.netMode, room: net?.roomId(), host: net?.hostId(), peers: net?.peerIds(), npcs: T.npcs, layout: T.layout, law, clock, arrivals: T.arrivals, market: T.market, goods, stalls: T.stalls, ctx, jobs: T.jobs, chainsDone: T.chainsDone, simT: () => T.simT, stallItemState: T.stallItemState, kill: (n) => T.die(n, { byPlayer: true }) }),
  };
}

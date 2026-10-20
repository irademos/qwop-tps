// Town mode (start screen → Town): Brindlewick, the town of houses on the island's north-west,
// as a living place. ~20 townsfolk with jobs, homes and needs go about their day on the town
// clock (work, the market, the campfire, bed), walking the roads (townNav.js); the player can
// talk to them, give them coins — or hit them. Hurting someone is a crime if anyone sees it:
// wanted stars, the guards come running and fight (as EnemyPlayers), and getting beaten or
// giving up lands the player in the jail cell. The dead stay dead; newcomers move in to take
// their place. Townsfolk names / roles / lines are in townPeople.js.
//
// Bodies are a level of detail: only the nearest TOWN_MAX_BODIES townsfolk get a GLB character
// (pooled per model); the rest walk the same paths as data. Someone fighting the player is
// swapped for an EnemyPlayer (ctx.spawnFighter — the stage fighting code) and back.
//
// Game access goes through `ctx` (built in bootstrapGameApp.js):
//   scene, camera, getPlayerPosition() → Vector3, getPlayerName(), isPlayerDead()
//   getGroundY(x, z), isOverWater(x, z), pathAt(x, z) → 'road' | 'trail' | null
//   getMapObjects(bounds) → [{ file, x, z, radius }]
//   teleport(x, z, yaw), revivePlayer(x, z, yaw), setPositionConstraint(fn | null)
//   setTimeOfDay('day' | 'night'), showBanner(title, sub, ms)
//   spawnFighter({ x, z, yaw, url, hearts, swingChance }) → EnemyPlayer, removeFighter(enemy)
//   spawnBlood(position, groundY), playSfx('hit' | 'chop' | 'coin'), dropCoins(position, n)
//   getCoins(), addCoins(delta), profileKey() → string | null, onLobby()

import * as THREE from 'three';
import { createGLBCharacterInstance, glbCharacterConfig } from '../models/glbCharacterModel.js';
import { raycastMapSegment } from '../environment/mapCollision.js';
import { makeTextSprite, makeCampfire, updateCampfire, loadMarketStall, MARKET_STALL_MERCHANT_Z } from '../village/villageMode.js';
import { createTownNav } from './townNav.js';
import {
  TOWN_NAME, ROLES, FOUNDING_ROLES, characterForRole, randomName, firstName,
  talkLine, giftLine, chatLines, shout,
  SHOUT_HURT, SHOUT_HELP, SHOUT_MURDER, SHOUT_FIGHT, SHOUT_LAW, SHOUT_EAT_BUY,
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
const EAT_COST = 2;                  // coins a townsperson pays the merchant for food
const WORK_PAY = 3;                  // coins earned per stint of work
const GIFT_COINS = 5;                // 🪙 Give
const FRIEND_ATTITUDE = 0.55;        // friends don't tell the guards what they saw
const NEWCOMER_DELAY_S = [45, 100];  // s until someone moves in after a death
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
  let lodAt = 0;
  let actsAt = 0;
  let actsKey = '';
  let acts = [];
  const pool = new Map();     // url → [{ container, character }]

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
  hud.append(top, stars, jailChip, lobbyBtn, feed, actsEl);
  document.body.append(hud, fade);

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
    })),
    pending: arrivals.map((a) => a.role),
    departed,
    nextId,
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

    const places = {
      center: C, market, merchantSpot, customerSpot, stallYaw, fire, jail: jailPos, jailYaw, officeSpot,
      homes, treeSpots, fields, shore, patrol, entrance,
      // the player arrives between the market and the fire
      spawn: { x: (market.x + fire.x) / 2 + fwd.z * 2.2, z: (market.z + fire.z) / 2 - fwd.x * 2.2 },
    };
    return { nav, places, props: buildProps(places) };
  };

  // ── Props: market stall, campfire, jail cell, fields ──
  const groundAt = (x, z, fallback = 0) => {
    const y = ctx.getGroundY(x, z);
    return Number.isFinite(y) ? y : fallback;
  };
  const buildProps = (places) => {
    const group = new THREE.Group();
    // Market stall (async GLB)
    const stallRoot = new THREE.Group();
    stallRoot.position.set(places.market.x, groundAt(places.market.x, places.market.z) - 0.005, places.market.z);
    stallRoot.rotation.y = places.stallYaw;
    group.add(stallRoot);
    loadMarketStall().then((stall) => stallRoot.add(stall)).catch((e) => console.warn('[Town] stall failed to load:', e));
    const marketSign = makeTextSprite('🧺 Market', { height: 0.3 });
    marketSign.position.set(0, 2.2, 0);
    stallRoot.add(marketSign);
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
        }
      }
    }
    return { group, fire, door };
  };

  // ── Townsfolk ──
  const makeNpc = ({ id, name, role, url, home, money = rand(4, 14), attitude = 0 }) => {
    const def = ROLES[role] ?? ROLES.townsfolk;
    const { homes } = layout.places;
    const homeIndex = Number.isInteger(home) && home >= 0 && home < homes.length ? home : Math.floor(Math.random() * homes.length);
    return {
      id, name, role, url, def,
      homeIndex,
      home: homes[homeIndex],
      work: null,
      x: homes[homeIndex].x, z: homes[homeIndex].z, yaw: Math.random() * Math.PI * 2,
      alive: true, dying: null, hp: def.hp, maxHp: def.hp,
      needs: { energy: rand(0.6, 1), hunger: rand(0, 0.6), social: rand(0, 0.7) },
      money, attitude,
      speedScale: (def.speed ?? 1) * rand(0.9, 1.12),
      task: null, path: null, pathI: 0, moving: false,
      inside: false, fear: 0, hostile: false, fighter: null, lastHurtAt: -1e9, lastHitAt: -1e9,
      body: null, bodyPending: false, wantsBody: false, bubble: null, nextAmbientAt: rand(5, 25),
      patrolI: Math.floor(Math.random() * 6), workT: 0, actionAt: 0, talkBonusAt: -1e9, friendNoted: false,
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
    const options = [];
    const working = def.hours && inHours(h, def.hours);
    if (def.law) {
      if (working) options.push(['work', 1]);
      else options.push(['sleep', 1]);
    } else {
      if (working && (def.work === 'market' || n.work)) options.push(['work', 0.8 + Math.random() * 0.2]);
      const marketOpen = h >= 7 && h < 20;
      if (marketOpen && n.money >= EAT_COST && n.role !== 'merchant') options.push(['eat', n.needs.hunger ** 2 * 1.3]);
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
    // (not right in front of the camera, where they'd fill the screen)
    const nearCamera = ctx.camera.position.distanceTo(b.container.position) < CAMERA_CLEAR_DIST;
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
    const e = ctx.spawnFighter({ x: n.x, z: n.z, yaw: n.yaw, url: n.url, hearts: Math.max(1, n.hp), swingChance: n.def.law ? 0.35 : 0.25 });
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
    if (next) next();
    else decide(n);
  };
  const onFighterHurt = (n, killed) => {
    n.lastHurtAt = simT;
    n.attitude = Math.max(-1, n.attitude - 0.3);
    if (killed) {
      n.hp = 0;
      die(n, { byPlayer: true, bodyless: true });
      crime('murder', n);
    } else if (n.def.law && law.stars < 2) {
      crime('assault', n);
    }
  };

  // ── Hurt / death ──
  const hurt = (n, dir) => {
    n.lastHitAt = simT;
    // Kids can't be hurt: they just run off
    if (n.def.unhurt) {
      n.attitude = Math.max(-1, n.attitude - 0.3);
      say(n, shout(SHOUT_HURT));
      flee(n);
      return;
    }
    n.lastHurtAt = simT;
    n.hp -= 1;
    n.attitude = Math.max(-1, n.attitude - 0.6);
    const gy = groundY(n);
    ctx.spawnBlood(_v.set(n.x, gy + 0.55 * heightScale(n.url), n.z), gy);
    ctx.playSfx('hit');
    // a shove
    n.knock = { vx: dir.x * 3, vz: dir.z * 3, left: 0.25 };
    if (n.hp <= 0) {
      die(n, { byPlayer: true });
      crime('murder', n);
      return;
    }
    clearTalk(n);
    if (n.def.law || Math.random() < n.def.brave) {
      say(n, shout(n.def.law ? SHOUT_LAW : SHOUT_FIGHT));
      crime('assault', n);
      promote(n);
    } else {
      say(n, shout(SHOUT_HURT));
      crime('assault', n);
      flee(n);
    }
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
    gossip.push({ kind: 'murder', who: firstName(n.name), by: byPlayer ? 'player' : null, at: simT, fresh: true });
    feedLine(`💀 ${n.name} the ${n.def.label} is dead.`);
    arrivals.push({ role: n.role, at: simT + rand(...NEWCOMER_DELAY_S) });
    departed = [...departed, firstName(n.name)].slice(-20);
    // Everyone near runs
    for (const o of npcs) {
      if (o !== n && o.alive && !o.fighter && !o.def.law && dist2(o.x, o.z, n.x, n.z) < 14) flee(o);
    }
    save();
  };
  const flee = (n) => {
    if (!n.alive || n.fighter) return;
    n.fear = 12;
    clearTalk(n);
    const p = playerPos();
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
  const crime = (kind, victim) => {
    const p = playerPos();
    const witnesses = npcs.filter((n) => n.alive && !n.inside
      && (n === victim || n.attitude < FRIEND_ATTITUDE)
      && dist2(n.x, n.z, p.x, p.z) < WITNESS_DIST
      && (n === victim || sees(n)));
    gossip.push({ kind, who: firstName(victim.name), by: 'player', at: simT, fresh: true });
    if (gossip.length > 12) gossip.shift();
    if (!witnesses.length) {
      if (kind === 'murder') feedLine('🤫 Nobody saw that.');
      return;
    }
    const before = law.stars;
    if (kind === 'murder') law.stars = Math.min(3, Math.max(law.stars + 1, 2));
    else if (victim.def.law) law.stars = Math.max(law.stars, 2);
    else law.stars = Math.max(law.stars, 1);
    law.peak = Math.max(law.peak, law.stars);
    law.lastSeenAt = simT;
    law.lastKnown.copy(p);
    for (const w of witnesses) {
      w.attitude = Math.max(-1, w.attitude - (kind === 'murder' ? 0.6 : 0.3));
      if (w === victim || w.fighter || w.def.law) continue;
      flee(w);
      if (Math.random() < 0.6) say(w, kind === 'murder' ? shout(SHOUT_MURDER) : shout(SHOUT_HELP));
    }
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
    ctx.showBanner('BUSTED!', surrendered ? 'You came quietly.' : 'The guards got you.', 2400);
    gossip.push({ kind: 'arrest', who: '', by: 'player', at: simT, fresh: true });
    later(token, 1800, () => {
      fadeTo(true);
      later(token, 700, () => {
        const P = layout.places;
        ctx.revivePlayer(P.jail.x, P.jail.z, P.jailYaw + Math.PI);
        if (fine > 0) ctx.addCoins(-fine);
        feedLine(fine > 0 ? `⚖️ Fined ${fine} 🪙` : '⚖️ Locked up.');
        advanceClock(3 * 60);
        startJail();
        fadeTo(false);
        sequence = null;
      });
    });
  };
  const knockedOut = () => {
    if (sequence) return;
    const token = {};
    sequence = token;
    removeAllFighters();
    clearAllTalk();
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
  const renderJail = () => {
    if (!jail) return;
    jailChip.classList.remove('hidden');
    jailChip.textContent = `🔒 In jail · ${Math.ceil(jail.left)} s`;
  };

  // ── Talking with the player ──
  const talkTo = (n) => {
    if (!n.alive || !n.body) return;
    if (n.fear > 0) { say(n, talkLine(n)); return; }
    const taskType = n.task?.type === 'talk' ? n.task.prevType : n.task?.type;
    if (n.task?.type !== 'talk') {
      n.task = { type: 'talk', t: 0, phase: 'do', dur: 7, prevType: taskType };
      n.path = null;
      n.moving = false;
    } else {
      n.task.t = 0;
    }
    talking = { npc: n };
    say(n, talkLine(n, { playerName: ctx.getPlayerName(), taskType }), { big: true });
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
        n.fighter = null;
        if (n.alive) die(n, { byPlayer: true, bodyless: true });
        return;
      }
      const d = distToPlayer(n);
      if (n.def.law) {
        if (d > DISENGAGE_DIST) demote(n, () => respond(n));
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
        say(n, talkLine(n, { playerName: ctx.getPlayerName(), taskType: t.type }));
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
    if (t.type === 'eat') {
      say(n, shout(SHOUT_EAT_BUY));
      const merchant = npcs.find((m) => m.alive && m.role === 'merchant' && m.task?.type === 'work' && m.task.phase === 'do');
      if (merchant) { merchant.money += EAT_COST; setTimeout(() => say(merchant, `That's ${EAT_COST} coins!`), 900); }
      n.money -= EAT_COST;
      n.needs.hunger = 0;
    }
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
    if (t.type === 'work' && n.def.work !== 'patrol') n.money += WORK_PAY;
    // (a guard who lost the player keeps looking round where they were last seen)
    if (t.type === 'search' && law.stars > 0) {
      setTask(n, { type: 'search', to: randomNear(law.lastKnown.x, law.lastKnown.z, 8), dur: rand(1, 3) });
      n.task.target = { x: law.lastKnown.x, z: law.lastKnown.z };
      n.task.plannedAt = simT;
      return;
    }
    decide(n);
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
      if (!n.alive || !n.body || n.fighter || n.inside || n.dying) continue;
      const d = dist2(n.x, n.z, p.x, p.z);
      if (d < bd) { bd = d; best = n; }
    }
    return best;
  };
  const computeActs = () => {
    const out = [];
    if (sequence) return out;
    if (jail) {
      out.push({ key: 'bail', label: `🔓 Pay bail (${BAIL} 🪙)`, onClick: payBail });
      return out;
    }
    if (law.stars > 0) {
      const p = playerPos();
      if (npcs.some((n) => n.fighter && n.def.law && dist2(n.x, n.z, p.x, p.z) < GIVE_UP_DIST)) {
        out.push({ key: 'giveup', label: '🙌 Give up', onClick: () => busted({ surrendered: true }) });
        return out;
      }
    }
    const n = nearestTalkable();
    if (n) {
      out.push({ key: `talk:${n.id}`, label: `💬 ${firstName(n.name)}`, onClick: () => talkTo(n) });
      if (talking?.npc === n) out.push({ key: `gift:${n.id}`, label: `🪙 Give ${GIFT_COINS}`, onClick: () => gift(n), secondary: true });
    }
    return out;
  };
  const refreshActs = () => {
    acts = computeActs();
    const key = acts.map((a) => `${a.key}|${a.label}`).join(',');
    if (key === actsKey) return;
    actsKey = key;
    actsEl.replaceChildren(...acts.map((a, i) => {
      const b = el('button', `${a.secondary || i > 0 ? 'ui-btn-secondary' : 'ui-btn'} town-act`, a.label);
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
      const homes = layout.places.homes.length;
      FOUNDING_ROLES.forEach((role, i) => {
        const name = randomName(role, taken);
        taken.add(firstName(name));
        npcs.push(makeNpc({ id: nextId++, name, role, url: characterForRole(role), home: i % homes }));
      });
    }
    assignWork();
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
    // The jail door: shut while the player is inside, open otherwise
    const door = layout.props.door;
    door.rotation.y = angleLerp(door.rotation.y, jail ? 0 : -1.9, 1 - Math.exp(-4 * dt));

    for (const n of npcs) updateNpc(n, dt);
    npcs = npcs.filter((n) => n.alive || n.dying);
    for (const g of gossip) if (simT - g.at > 240) g.fresh = false;
    updateArrivals();
    if (simT > law.tickAt) { law.tickAt = simT + 0.5; updateLaw(); }
    if (simT > lodAt) { lodAt = simT + 0.4; updateLod(); }
    for (const n of npcs) if (n.body && !n.dying) syncBody(n, dt);
    if (simT > actsAt) { actsAt = simT + 0.15; refreshActs(); }
    if (simT > saveAt) { saveAt = simT + SAVE_EVERY_S; save(); }
  };

  // The player's sword swing reached `tip` (world), moving along swingDir: hits the
  // townsperson it passes through (those fighting are EnemyPlayers — the stage code hits them)
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
    return false;
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
    onPlayerDown,
    interact,
    isActive: () => active,
    // The phone's Block bar label while there's something to do (undefined: it stays Block)
    interactLabel: () => (active && acts.length ? acts[0].label : undefined),
    // (dev console)
    debug: () => ({ npcs, layout, law, clock, arrivals, ctx }),
  };
}

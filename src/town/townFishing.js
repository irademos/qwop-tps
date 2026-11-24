// Town: fishing. The rod is bought from a fisher (SHOP_GEAR 'rod', SELLER_GEAR — townMarket.js) and held like the
// sword — it is the sword weapon in rod form, swung with the phone's gyro (bootstrapGameApp.js).
// At the fishing spot (one for now — the shore spot nearest the middle, `places.fishSpot`), or
// anywhere out in the canoe (T.fishAnywhere — townCanoe.js: the rod comes out there too, the
// water round it — T.fishWater — is what a cast lands on, and it may drift FISH_CANOE_DRIFT):
//   • bubbles: while the rod's out, bubbles rise on the water within a cast (createFishBubbles —
//     moving on every FISH_BUBBLE_S); a bobber within FISH_BUBBLE_HIT_R of them bites in
//     FISH_BUBBLE_BITE_S with no nibbling, and a bigger fish (FISH_SIZES `bw`)
//   • cast: swing the rod forward — the harder, the farther the bobber flies (FISH_CAST_*); the
//     swing's sideways travel aims it (back-left → out-right lands to the right, back-right →
//     out-left to the left — FISH_AIM_GAIN, up to FISH_AIM_MAX)
//   • wait: the bobber floats; a nibble first sometimes (a swipe on it scares the fish off)
//   • bite: the bobber goes under (the phone buzzes) — swipe the rod within FISH_HOOK_S
//   • the camera turns once toward where the bobber's going to land (ctx.turnCameraTo)
//   • fight: the fish swims — left, right or out (the bobber running that way; the HUD's 🐟
//     arrow only once they've been getting it wrong): swipe the other way — right / left — or up for out, within its size's `swim` s. A good
//     counter turns it and brings it in (FISH_PULL_KEEP); the wrong way or too late strains the
//     line (FISH_WRONG_TENSION / FISH_LATE_TENSION — at 1 it snaps); `pulls` good ones wear it out
//   • reel it in: worn out, the reel comes up — the phone's touch reel (its Block bar turns into
//     one), or the on-screen reel without a phone / hold R — crank it until it's at the bank.
//     Left too long (FISH_REEL_IDLE_S) it gets its breath back and swims again
// Without a gyro the cast / swipes are buttons (acts: Cast — aimed at the bubbles, roughly —,
// Pull, ⬅ / ⬆ / ➡). The game's player-local rod tip is sampled each frame; a cast / swipe is its
// travel within FISH_GESTURE_S.
// The HUD says nothing while it goes well: only after FISH_HINT_AFTER mistakes does it show the
// fish's way (🐟 ⬅ / ➡ / ⬆), which way to swipe and the reel's instruction, until a fish is landed.
//
// On foot in Town (T.castAhead) a cast goes straight out in front from wherever the player
// stands (castAheadTarget — a dock's end, a bank, a lake shore); with no open water along the line
// the bobber comes down on the ground and is reeled straight back in. What's below is for doing
// it properly — fish per water body, runs kept on water:
// Fishing anywhere there's water would mean: `atSpot` → "water within reach" over the whole map
// (the town's nav grid only covers NAV_BOUNDS — elsewhere sample `ctx.getWaterY` / the map's
// `sampleMapWaterLevel` in a ring in front of the player instead of `nav.isWater`), a cast that
// can't land on dry ground between the bank and the bobber (a few water samples along the
// line), the fish's path kept on water while it runs (step back along the line when the next
// spot is dry), and, if spots should differ, a per-water-body table (sea / lake / river → which
// fish, bite times, sizes) looked up from what the water sampler hit.

//
// The guest's sea start (seaStart.js) installs this too, on a small stand-in for the town's
// state, fishing anywhere on the water from its canoe like Town's (T.fishAnywhere / T.fishWater).
// (T.fishSpotReach / T.fishCancelReach / T.fishAwayText can still override the spot's reach, the
// drift allowed and the out-of-reach line for a stand-in with a spot of its own.)
//
// A job can steer it (T.questFish — the fisher's golden fish, beats/sea.js): { quick } — the bite
// comes sooner, no nibbling; { golden } — the next fish hooked is the golden one: it leaps
// gleaming at the end of the line (the rig's `golden`), won't tire, snap the line or run off, and
// can't be landed — T.questNote('fishHooked', { golden }) when it takes the hook, and the job
// takes it away (T.loseFish(text) — a pirate's bomb rocks the canoe).

import * as THREE from 'three';
import { createFishBubbles, createFishingRig } from '../items/fishingRod.js';
import {
  FISH_AIM_GAIN, FISH_AIM_MAX, FISH_BUBBLE_BITE_S, FISH_BUBBLE_HIT_R, FISH_BUBBLE_S, FISH_CANCEL_DIST,
  FISH_CANOE_DRIFT, FISH_CAST_DIST, FISH_CAST_REACH, FISH_CAST_SWING, FISH_GESTURE_S, FISH_HINT_AFTER, FISH_HOOK_S,
  FISH_KEY_REEL, FISH_LAND_DIST, FISH_LATE_TENSION, FISH_LINE_MAX, FISH_MIN_DEPTH, FISH_NIBBLE_CHANCE, FISH_NIBBLE_S,
  FISH_PULL_KEEP, FISH_PULL_SWING, FISH_REEL_IDLE_S, FISH_REEL_M, FISH_RUN_SPEED, FISH_SETTLE_S,
  FISH_BASE_CM, FISH_SIDE_SPEED, FISH_SIZES, FISH_SPOT_RADIUS, FISH_SWIPE_SIDE, FISH_TENSION_DECAY, FISH_TURN_S, FISH_WAIT_S,
  FISH_WRONG_TENSION, NAV_CELL, dist2, el, rand,
} from './townConfig.js';

const TURN = Math.PI * 2;
// The swipe that counters each way the fish swims (its way as the player sees it)
const COUNTER = { left: 'right', right: 'left', out: 'up' };
const ARROW = { left: '⬅', right: '➡', out: '⬆', up: '⬆' };

// T: the town's shared state + functions (createTownMode in townMode.js); ctx: the game
export function installTownFishing(T, ctx) {
  // ── HUD: the fish's way while it swims, the reel's instruction, hints once they're struggling,
  // and an on-screen reel (no gyro) ──
  const meter = el('div', 'town-fishing ui-panel hidden');
  const cueEl = el('div', 'town-fishing-cue');
  meter.append(cueEl);
  const reelEl = el('div', 'town-reel hidden');
  const reelHandle = el('div', 'town-reel-handle');
  reelEl.append(reelHandle);
  T.hud.append(meter, reelEl);

  // Cranking the on-screen reel (mouse or touch): clockwise winds in
  let screenReel = 0;
  let reelAngle = 0;
  let reelPointer = null;
  const angleOf = (e) => {
    const r = reelEl.getBoundingClientRect();
    return Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2));
  };
  reelEl.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    try { reelEl.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
    reelPointer = { id: e.pointerId, angle: angleOf(e) };
  });
  reelEl.addEventListener('pointermove', (e) => {
    if (!reelPointer || e.pointerId !== reelPointer.id) return;
    const a = angleOf(e);
    let d = a - reelPointer.angle;
    if (d > Math.PI) d -= TURN;
    if (d < -Math.PI) d += TURN;
    reelPointer.angle = a;
    reelAngle += d;
    reelHandle.style.transform = `rotate(${reelAngle}rad)`;
    if (d > 0) screenReel += d;
  });
  const endReel = (e) => { if (reelPointer?.id === e.pointerId) reelPointer = null; };
  reelEl.addEventListener('pointerup', endReel);
  reelEl.addEventListener('pointercancel', endReel);
  // (and on a keyboard: hold R)
  let keyReel = false;
  window.addEventListener('keydown', (e) => { if (e.key === 'r' || e.key === 'R') keyReel = true; });
  window.addEventListener('keyup', (e) => { if (e.key === 'r' || e.key === 'R') keyReel = false; });
  window.addEventListener('blur', () => { keyReel = false; });

  // ── Where: the fishing spot, and the water a cast can reach from it ──
  const spot = () => T.layout?.places.fishSpot ?? null;
  const anywhere = () => !!T.fishAnywhere?.();
  // (Town on foot — T.castAhead: a cast goes straight out in front, wherever the player stands;
  // over dry ground it just comes back in — so a dock, a bank, a lake shore all work)
  const ahead = () => !!T.castAhead && !anywhere();
  const atSpot = () => {
    if (anywhere() || ahead()) return true;
    const s = spot();
    if (!s) return false;
    const p = T.playerPos();
    return dist2(p.x, p.z, s.x, s.z) < (T.fishSpotReach ?? FISH_SPOT_RADIUS * FISH_SPOT_RADIUS);
  };
  const _fwd = new THREE.Vector3();
  // The player's facing on the ground, turned `aim` rad to their right
  const facing = (aim = 0) => {
    ctx.getPlayerModel()?.getWorldDirection(_fwd);
    const l = Math.hypot(_fwd.x, _fwd.z) || 1;
    const fx = _fwd.x / l;
    const fz = _fwd.z / l;
    // (right of the facing = (−fz, fx): the model faces +Z, its right is −X)
    const c = Math.cos(aim);
    const s = Math.sin(aim);
    return { x: fx * c - fz * s, z: fz * c + fx * s };
  };
  // Open water at (x, z): the surface over the ground there (not a dock's deck / a bridge over it)
  const openWater = (x, z) => {
    const wy = ctx.getWaterY(x, z);
    if (wy == null || !(ctx.waterDepth?.(x, z) > FISH_MIN_DEPTH)) return false;
    const gy = ctx.getGroundY(x, z);
    return !Number.isFinite(gy) || gy < wy - 0.05;
  };
  // Water a bobber can come down on (and bubbles rise from)
  const fishable = (x, z) => {
    if (ahead()) return openWater(x, z);
    const nav = T.layout?.nav;
    return !!(T.fishWater?.(x, z) ?? (nav && nav.isWater(nav.indexAt(x, z))));
  };
  // Straight out (T.castAhead), `aim` rad to the right of the facing: the first open water from
  // `dist` back toward the player (a short cast from the bank still lands on it), else on past
  // it; { at, dry } — dry: no water along the line, the bobber lands `dist` out on the ground and
  // comes back in
  const castAheadTarget = (dist, aim) => {
    const p = T.playerPos();
    const f = facing(aim);
    const at = (d) => ({ x: p.x + f.x * d, z: p.z + f.z * d });
    let hit = null;
    for (let d = dist; d >= 1.5 && !hit; d -= 0.5) { const q = at(d); if (openWater(q.x, q.z)) hit = q; }
    for (let d = dist + 0.5; d <= FISH_CAST_DIST[1] && !hit; d += 0.5) { const q = at(d); if (openWater(q.x, q.z)) hit = q; }
    if (hit) return { at: new THREE.Vector3(hit.x, ctx.getWaterY(hit.x, hit.z), hit.z), dry: false };
    const q = at(dist);
    const gy = ctx.getGroundY(q.x, q.z);
    return { at: new THREE.Vector3(q.x, Number.isFinite(gy) ? gy : p.y ?? 0, q.z), dry: true };
  };
  // (the spot / the canoe: the water nearest where the cast was aimed)
  const castTarget = (dist, aim) => {
    const p = T.playerPos();
    const f = facing(aim);
    const aimX = p.x + f.x * dist;
    const aimZ = p.z + f.z * dist;
    let best = null;
    let bestD = Infinity;
    const r = FISH_CAST_REACH;
    for (let dz = -r; dz <= r; dz += NAV_CELL / 2) {
      for (let dx = -r; dx <= r; dx += NAV_CELL / 2) {
        const x = p.x + dx;
        const z = p.z + dz;
        if (dx * dx + dz * dz < 1.5 * 1.5 || !fishable(x, z)) continue;
        const d = dist2(x, z, aimX, aimZ);
        if (d < bestD) { bestD = d; best = { x, z }; }
      }
    }
    if (!best) return null;
    const y = ctx.getWaterY(best.x, best.z) ?? ctx.getGroundY(best.x, best.z);
    return new THREE.Vector3(best.x, y, best.z);
  };

  // ── Bubbles where the fish are (within a cast, in front of the player) ──
  let bubbleFx = null;
  const bubblesFx = () => (bubbleFx ??= createFishBubbles(ctx.scene));
  let bub = null;          // { x, y, z, until, fromX, fromZ }
  let bubbleTryAt = -99;
  const dropBubbles = () => { bub = null; bubbleFx?.hide(); };
  const findBubbleSpot = () => {
    const p = T.playerPos();
    for (let i = 0; i < 24; i++) {
      const f = facing(rand(-FISH_AIM_MAX, FISH_AIM_MAX) * 0.85);
      const d = rand(FISH_CAST_DIST[0] + 0.5, FISH_CAST_DIST[1] - 0.5);
      const x = p.x + f.x * d;
      const z = p.z + f.z * d;
      if (!fishable(x, z)) continue;
      const y = ctx.getWaterY(x, z);
      if (y == null) continue;
      return { x, y, z };
    }
    return null;
  };
  const updateBubbles = (dt) => {
    const want = ctx.isRodEquipped() && atSpot() && !ctx.isPlayerDead() && !T.sequence && !T.jail
      && (!T.fishing || T.fishing.phase === 'cast');
    if (!want) { if (bub && !T.fishing) dropBubbles(); bubbleFx?.update(dt); return; }
    const p = T.playerPos();
    // (moved on: after a while, or the player's walked / drifted well away from where they were)
    if (bub && !T.fishing && (T.simT > bub.until || dist2(p.x, p.z, bub.fromX, bub.fromZ) > 4 * 4)) dropBubbles();
    if (!bub && T.simT - bubbleTryAt > 1) {
      bubbleTryAt = T.simT;
      const s = findBubbleSpot();
      if (s) bub = { ...s, until: T.simT + rand(...FISH_BUBBLE_S), fromX: p.x, fromZ: p.z };
    }
    if (bub) bubblesFx().place(bub.x, bub.y, bub.z);
    bubbleFx?.update(dt);
  };

  // ── The rod tip's motion (player-local), for casts and swipes ──
  const tipHistory = []; // { t, x, y, z }
  const _w = new THREE.Vector3();
  const sampleTip = () => {
    const rod = ctx.getRodModel();
    const tip = rod?.getObjectByName('rod-tip');
    const model = ctx.getPlayerModel();
    if (!tip || !model) { tipHistory.length = 0; return; }
    rod.updateWorldMatrix(true, false);
    tip.getWorldPosition(_w);
    model.worldToLocal(_w);
    tipHistory.push({ t: T.simT, x: _w.x, y: _w.y, z: _w.z });
    while (tipHistory.length && T.simT - tipHistory[0].t > FISH_GESTURE_S) tipHistory.shift();
  };
  // How far the tip went within the window (m): forward, back-or-up, sideways (+: to the
  // player's left — local +X), and sideways since the forward swing began (the cast's aim)
  const swing = () => {
    if (tipHistory.length < 2) return { fwd: 0, back: 0, side: 0, aimSide: 0 };
    const cur = tipHistory[tipHistory.length - 1];
    let minZ = cur.z; let maxZ = cur.z; let minY = cur.y; let minX = cur.x; let maxX = cur.x;
    let fromX = cur.x;
    for (const h of tipHistory) {
      if (h.z < minZ) { minZ = h.z; fromX = h.x; }
      maxZ = Math.max(maxZ, h.z);
      minY = Math.min(minY, h.y);
      minX = Math.min(minX, h.x);
      maxX = Math.max(maxX, h.x);
    }
    const toLeft = cur.x - minX;
    const toRight = maxX - cur.x;
    return {
      fwd: cur.z > 0.2 ? cur.z - minZ : 0,
      back: Math.max(maxZ - cur.z, cur.y - minY),
      side: toLeft > toRight ? toLeft : -toRight,
      aimSide: cur.x - fromX,
    };
  };
  let gestureAt = -1; // (one gesture at a time: the window starts afresh after each)
  // { kind: 'cast', power, aim } with the line in; { kind: 'left' | 'right' | 'up' } with it out
  const takeGesture = (lineOut) => {
    if (T.simT - gestureAt < FISH_GESTURE_S) return null;
    const s = swing();
    if (!lineOut) {
      if (s.fwd < FISH_CAST_SWING[0] || s.fwd < s.back) return null;
      const power = THREE.MathUtils.clamp((s.fwd - FISH_CAST_SWING[0]) / (FISH_CAST_SWING[1] - FISH_CAST_SWING[0]), 0, 1);
      // (sideways while it went forward: toward the player's right is −X)
      const aim = THREE.MathUtils.clamp(Math.atan2(-s.aimSide * FISH_AIM_GAIN, s.fwd), -FISH_AIM_MAX, FISH_AIM_MAX);
      return { kind: 'cast', power, aim };
    }
    const side = Math.abs(s.side);
    if (side >= FISH_SWIPE_SIDE && side > s.back * 0.8) return { kind: s.side > 0 ? 'left' : 'right' };
    if (s.back >= FISH_PULL_SWING) return { kind: 'up' };
    return null;
  };
  const used = () => { gestureAt = T.simT; tipHistory.length = 0; };

  // ── The line ──
  // T.fishing (null: the line's not out):
  //   { phase: 'cast' | 'wait' | 'bite' | 'fight', x, z (where the player cast from),
  //     dir {x, z} (out along the line), d (m of line out), t (s in this phase), left (s: until
  //     the bite / to hook it), nibble (s left of one), settleAt, onBubbles,
  //     fish: { size, stamina, mode: 'swim' | 'turn' | 'beaten', way: 'left' | 'right' | 'out',
  //     left, lat (m off to the side), tension, idle, golden } }
  let rig = null;
  const fishingRig = () => (rig ??= createFishingRig(ctx.scene));
  let lastCue = null;
  let misses = 0; // mistakes since the last fish landed (FISH_HINT_AFTER → hints)
  const miss = () => { misses += 1; };
  const say = (text) => T.feedLine(text);
  const finish = (caught = false) => {
    const scale = T.fishing?.fish?.scale ?? 1;
    T.fishing = null;
    rig?.golden(false);
    rig?.reel(caught, scale);
  };
  // A job takes the fish on the line away (the golden fish, shaken off by a blast): reeled in empty
  const loseFish = (text) => {
    if (!T.fishing) return false;
    const had = !!T.fishing.fish;
    finish(false);
    if (text) say(text);
    refreshHud();
    return had;
  };

  let awayHintAt = -99;
  // power 0…1 (how far), aim rad to the right of the facing
  const cast = (power, aim = 0) => {
    if (T.fishing || !ctx.isRodEquipped() || T.sequence || ctx.isPlayerDead()) return false;
    if (!atSpot()) {
      if (T.simT - awayHintAt > 5) { awayHintAt = T.simT; say(T.fishAwayText ?? 'Fish at the fishing spot by the water.'); }
      return false;
    }
    if (T.bagRoom() <= 0) { T.bagFullNote(); return false; }
    const rod = ctx.getRodModel();
    if (!rod) return false;
    const dist = FISH_CAST_DIST[0] + (FISH_CAST_DIST[1] - FISH_CAST_DIST[0]) * power;
    let at;
    let dry = false;
    if (ahead()) ({ at, dry } = castAheadTarget(dist, aim));
    else at = castTarget(dist, aim);
    if (!at) { say('No water in reach — face the water.'); return false; }
    const p = T.playerPos();
    const d = Math.max(0.5, Math.hypot(at.x - p.x, at.z - p.z));
    const quest = !!(T.questFish?.quick || T.questFish?.golden);
    const onBubbles = !dry && !!bub && dist2(at.x, at.z, bub.x, bub.z) < FISH_BUBBLE_HIT_R * FISH_BUBBLE_HIT_R;
    const quick = quest || onBubbles;
    T.fishing = {
      phase: 'cast', dry, x: p.x, z: p.z, dir: { x: (at.x - p.x) / d, z: (at.z - p.z) / d }, d, t: 0,
      left: onBubbles ? rand(...FISH_BUBBLE_BITE_S) : quest ? rand(2.5, 4.5) : rand(...FISH_WAIT_S), nibble: 0,
      nibbled: !quick && Math.random() < FISH_NIBBLE_CHANCE,
      settleAt: T.simT + FISH_SETTLE_S, fish: null, onBubbles, at: at.clone(),
    };
    fishingRig().cast(rod, at);
    // (the camera turns once toward where it's going to land — no following it after)
    if (!dry) ctx.turnCameraTo?.(at.x, at.z);
    return true;
  };
  // Without a gyro (the Cast act): at the bubbles if they're in front, roughly; else straight out
  const castAuto = () => {
    if (!bub) return cast(0.55, 0);
    const p = T.playerPos();
    const f = facing();
    const dx = bub.x - p.x;
    const dz = bub.z - p.z;
    const d = Math.hypot(dx, dz) || 1;
    // (the bubbles' bearing: + to the right — right of the facing = (−fz, fx))
    const aim = Math.atan2(dx * -f.z + dz * f.x, dx * f.x + dz * f.z);
    if (Math.abs(aim) > FISH_AIM_MAX) return cast(0.55, 0);
    const power = THREE.MathUtils.clamp((d + rand(-1.2, 1.2) - FISH_CAST_DIST[0]) / (FISH_CAST_DIST[1] - FISH_CAST_DIST[0]), 0, 1);
    return cast(power, aim + rand(-0.15, 0.15));
  };

  // The fish picks a way to swim (not back the way it was already pulled off to, too far)
  const swimOff = (fish, f) => {
    const ways = ['left', 'right', 'out'].filter((w) => w !== fish.way
      && !(w === 'left' && fish.lat > Math.min(2.5, f.d * 0.4))
      && !(w === 'right' && fish.lat < -Math.min(2.5, f.d * 0.4)));
    fish.way = ways[Math.floor(Math.random() * ways.length)] ?? 'out';
    fish.mode = 'swim';
    fish.left = fish.size.swim;
    rig?.splash?.();
  };
  // A swipe on the rod (or a button without a gyro): 'left' | 'right' | 'up' — hooks a bite,
  // scares off a nibbler, counters (or not) a swimming fish
  const swipe = (way) => {
    const f = T.fishing;
    if (!f || T.simT < f.settleAt) return;
    if (f.phase === 'wait' && f.nibble > 0) {
      f.nibble = 0;
      f.nibbled = false;
      f.left = rand(...FISH_WAIT_S) + 2;
      miss();
      say('Scared it off.');
    } else if (f.phase === 'bite') {
      const size = pickSize(f.onBubbles);
      const golden = !!T.questFish?.golden;
      f.phase = 'fight';
      f.t = 0;
      f.fish = { size, kind: size.kinds?.[Math.floor(Math.random() * size.kinds.length)] ?? 'Fish', scale: rand(...(size.scale ?? [1, 1])), stamina: golden ? Infinity : size.pulls, mode: 'turn', way: null, left: 0.5, lat: 0, tension: 0, idle: 0, golden };
      rig?.hook();
      if (golden) rig?.golden(true);
      if (f.onBubbles) say(`Off the bubbles — ${size.label}!`);
      T.questNote('fishHooked', { golden });
    } else if (f.phase === 'fight') {
      const fish = f.fish;
      if (fish.mode !== 'swim') return;
      if (way === COUNTER[fish.way]) {
        // Turned it: it comes in a way, and turns to swim off again — or it's worn out
        fish.stamina -= 1;
        f.d = Math.max(FISH_LAND_DIST + 0.4, f.d * FISH_PULL_KEEP);
        fish.lat *= 0.5;
        fish.tension = Math.max(0, fish.tension - 0.25);
        ctx.playSfx?.('splash', rig?.bobberPosition());
        if (fish.stamina <= 0) { fish.mode = 'beaten'; fish.idle = 0; } else { fish.mode = 'turn'; fish.left = FISH_TURN_S; }
      } else {
        miss();
        fish.tension += FISH_WRONG_TENSION;
      }
    }
  };
  const pickSize = (onBubbles) => {
    const w = (s) => (onBubbles ? s.bw : s.w);
    let r = Math.random() * FISH_SIZES.reduce((sum, s) => sum + w(s), 0);
    return FISH_SIZES.find((s) => (r -= w(s)) < 0) ?? FISH_SIZES[0];
  };

  const reelPhase = () => T.fishing?.phase === 'fight' && T.fishing.fish.mode === 'beaten';

  // Put away at once (leaving Town, arrests): no reeling in
  const stopFishingRig = () => {
    rig?.golden(false);
    rig?.stop();
    dropBubbles();
  };

  const _fishAt = { x: 0, z: 0 };
  const updateFishing = (dt) => {
    // Ended elsewhere (a shop, an arrest, a fight): reel in empty, or just put it away
    if (!T.fishing && rig?.isBusy() && rig.phase() !== 'reel' && rig.phase() !== 'show') {
      if (ctx.isPlayerDead() || T.jail || T.sequence || !ctx.isRodEquipped()) rig.stop();
      else rig.reel(false);
    }
    if (ctx.isRodEquipped()) sampleTip();
    else tipHistory.length = 0;
    updateBubbles(dt);
    // (the reel's turns: phone (circled / twisted, or its touch reel) + on-screen + R — taken
    // every frame, so none pile up)
    const reeled = ctx.takeReel() + screenReel + (keyReel ? FISH_KEY_REEL * TURN * dt : 0);
    screenReel = 0;
    const turns = reeled / TURN;
    // (another line on the reel — an arrow on a string in a fish under water, townDive.js)
    if (T.extReel && !T.fishing && turns > 0) T.extReel.onTurns(turns);

    const gyro = ctx.hasGyro() && ctx.isRodEquipped();
    const gesture = gyro && !reelPhase() ? takeGesture(!!T.fishing) : null;
    if (!T.fishing && gesture?.kind === 'cast' && T.calmNow() && !T.stalls.focused()
      && !T.jobTalk.isOpen()) {
      used();
      cast(gesture.power, gesture.aim);
    }

    const f = T.fishing;
    let bite = 0;
    let load = 0;
    if (f) {
      const p = T.playerPos();
      const reach = anywhere() ? FISH_CANOE_DRIFT * FISH_CANOE_DRIFT : (T.fishCancelReach ?? FISH_CANCEL_DIST * FISH_CANCEL_DIST);
      if (dist2(p.x, p.z, f.x, f.z) > reach || ctx.isPlayerDead() || !ctx.isRodEquipped()) {
        if (!ctx.isRodEquipped() || ctx.isPlayerDead()) { T.fishing = null; rig?.golden(false); rig?.stop(); }
        else { if (f.fish) say('It got away.'); finish(); }
        refreshHud();
        return;
      }
      if (gesture && gesture.kind !== 'cast') { used(); swipe(gesture.kind); }
      f.t += dt;
      if (f.phase === 'cast') {
        if (rig?.isOut()) {
          // (it came down on dry ground: back in it comes)
          if (f.dry) { finish(); say('No water there — cast out over the water.'); refreshHud(); return; }
          f.phase = 'wait';
          f.t = 0;
          if (f.onBubbles) { say('Right on the bubbles!'); dropBubbles(); }
        }
      } else if (f.phase === 'wait') {
        // Reeling in a waiting line just brings the bobber back
        if (turns > 0) f.d -= turns * FISH_REEL_M;
        if (f.d <= FISH_LAND_DIST) { finish(); refreshHud(); return; }
        f.left -= dt;
        if (f.nibbled && f.left < FISH_NIBBLE_S + 0.6 && f.left > 0.6) f.nibble = f.left - 0.6;
        else f.nibble = 0;
        if (f.nibble > 0) bite = Math.sin(f.t * 9) > 0.3 ? 0.35 : 0.1;
        if (f.left <= 0) { f.phase = 'bite'; f.t = 0; f.left = FISH_HOOK_S; }
      } else if (f.phase === 'bite') {
        bite = 1;
        f.left -= dt;
        if (f.left <= 0) {
          // Too slow: it's off with the bait — but the line's still in
          f.phase = 'wait';
          f.t = 0;
          f.left = rand(...FISH_WAIT_S);
          f.nibbled = Math.random() < FISH_NIBBLE_CHANCE;
          f.onBubbles = false;
          miss();
          say('It stole the bait.');
        }
      } else if (f.phase === 'fight') {
        const fish = f.fish;
        if (fish.mode === 'swim') {
          // It takes line its way: out along the line, or off to one side
          if (fish.way === 'out') f.d += FISH_RUN_SPEED * dt;
          else {
            f.d += FISH_RUN_SPEED * 0.35 * dt;
            fish.lat += (fish.way === 'left' ? 1 : -1) * FISH_SIDE_SPEED * dt;
          }
          fish.left -= dt;
          // (not countered in time: it pulls hard, and turns off another way)
          if (fish.left <= 0) { miss(); fish.tension += FISH_LATE_TENSION; swimOff(fish, f); }
          load = 0.85;
        } else if (fish.mode === 'turn') {
          fish.left -= dt;
          if (fish.left <= 0) swimOff(fish, f);
          load = 0.45;
        } else {
          // Worn out: wound in by the reel; left too long it gets its breath back
          f.d -= turns * FISH_REEL_M;
          fish.lat *= Math.max(0, 1 - turns * 0.5);
          fish.idle = turns > 0.01 ? 0 : fish.idle + dt;
          if (fish.idle > FISH_REEL_IDLE_S) {
            miss();
            fish.stamina = 1;
            swimOff(fish, f);
            say('It got its breath back!');
          }
          load = 0.5;
        }
        fish.tension = Math.max(0, fish.tension - FISH_TENSION_DECAY * dt);
        load = Math.min(1, load + fish.tension * 0.3);
        // (until it's worn out it won't come right in)
        if (fish.mode !== 'beaten') f.d = Math.max(FISH_LAND_DIST + 0.4, f.d);
        fish.lat = THREE.MathUtils.clamp(fish.lat, -Math.min(3.5, f.d * 0.6), Math.min(3.5, f.d * 0.6));
        // (the golden fish: on the line till the job takes it away — no snapping, no running off)
        if (fish.golden) { fish.tension = Math.min(fish.tension, 0.8); f.d = Math.min(f.d, FISH_LINE_MAX * 0.6); }
        if (fish.tension >= 1) {
          miss();
          finish();
          say('The line snapped!');
        } else if (f.d > FISH_LINE_MAX) {
          miss();
          finish();
          say('It got away.');
        } else if (f.d <= FISH_LAND_DIST) {
          const n = fish.size.n;
          misses = 0;
          finish(true);
          ctx.playSfx?.('splash');
          const got = T.gain('fish', n);
          say(`Caught ${fish.size.label}! ${got > 1 ? `+${got} fish` : '+1 fish'} (${T.goods.fish})${got < n ? ' — no room in your bag for the other' : ''}`);
          const cm = Math.round(FISH_BASE_CM * fish.scale * rand(0.95, 1.05));
          if (got > 0) T.popup?.({ icon: '🐟', title: fish.kind, sub: `${cm} cm · +${got} fish` });
          T.questNote('fish');
        }
      }
    }
    // Where the bobber is: along the cast, a hooked fish off to the side it swam
    if (T.fishing && rig) {
      const g = T.fishing;
      const lat = g.fish ? g.fish.lat : 0;
      // (its left: the line's direction turned left — (dz, −dx))
      _fishAt.x = g.x + g.dir.x * g.d + g.dir.z * lat;
      _fishAt.z = g.z + g.dir.z * g.d - g.dir.x * lat;
    }
    rig?.update(dt, { bite, load, crank: reeled, fish: T.fishing && T.fishing.phase !== 'cast' ? _fishAt : null });
    refreshHud();
  };

  // ── What it says right now (the HUD, the phone's reel) ──
  // { line: the line's out, cue, text (shown), hint (only once they've been getting it wrong) } or null
  const status = () => {
    const f = T.fishing;
    if (!f) return T.extReel ? { line: true, cue: 'reel', text: T.extReel.text?.() || 'Reel in!', hint: '' } : null;
    let cue = f.phase;
    let text = '';
    let hint = '';
    const gyro = ctx.hasGyro();
    if (f.phase === 'wait' && f.nibble > 0) cue = 'nibble';
    if (f.phase === 'bite') hint = gyro ? 'Swipe the rod!' : 'Pull!';
    if (f.phase === 'fight') {
      const fish = f.fish;
      if (fish.mode === 'swim') {
        cue = fish.way;
        text = `🐟 ${ARROW[fish.way]}`;
        hint = `Swipe ${ARROW[COUNTER[fish.way]]}`;
      } else if (fish.mode === 'turn') {
        cue = 'turn';
      } else {
        cue = 'reel';
        text = 'Reel in!';
      }
    }
    // (the fish's way, the reel's instruction and which way to swipe only once they've been
    // getting it wrong — as the old Pull / Reel in hints were)
    const struggling = misses >= FISH_HINT_AFTER;
    return { line: true, cue, text: struggling ? text : '', hint: struggling ? hint : '' };
  };
  let hudKey = '';
  const refreshHud = () => {
    const s = status();
    const shown = s ? [s.text, s.hint].filter(Boolean).join('  ·  ') : '';
    // (the DOM only when something shows differently)
    const k = s ? `${s.cue}|${shown}|${ctx.isPhoneConnected()}` : '';
    if (k === hudKey) return;
    hudKey = k;
    meter.classList.toggle('hidden', !shown);
    // (the on-screen reel only once it's time to reel in, and only without a phone — it has its own)
    reelEl.classList.toggle('hidden', !s || s.cue !== 'reel' || ctx.isPhoneConnected());
    document.body.classList.toggle('town-reeling', !!s);
    if (shown) {
      cueEl.textContent = shown;
      meter.dataset.cue = s.cue;
    }
    // A new cue: the phone hears it now (it buzzes), not on its next status tick
    const key = s ? s.cue : null;
    if (key !== lastCue) { lastCue = key; ctx.refreshPhone?.(); }
  };
  // For the phone: the line's out (its cues buzz), and its touch reel shows once it's time to reel in (show)
  const fishingHud = () => {
    const s = status();
    if (!s) return null;
    return { reel: true, show: s.cue === 'reel', cue: s.cue, text: [s.text, s.hint].filter(Boolean).join('\n') };
  };
  // The act the first day's fishing goal rings (townQuests.js goalHighlight)
  const fishActKey = () => {
    const fish = T.fishing?.fish;
    if (fish?.mode === 'swim') return fish.way === 'out' ? 'fishpull' : `fish${COUNTER[fish.way]}`;
    return T.fishing ? 'fishpull' : 'fishcast';
  };

  // ── Acts (townActs.js): only without a gyro — Cast / Pull, then ⬅ ⬆ ➡ with the rod out ──
  const fishingActs = (calm) => {
    const out = [];
    if (ctx.hasGyro()) return out;
    const f = T.fishing;
    if (f) {
      if (f.phase === 'fight') {
        if (f.fish.mode === 'beaten') return out;
        out.push(
          { key: 'fishleft', label: '⬅', onClick: () => swipe('left') },
          { key: 'fishpull', label: '⬆', onClick: () => swipe('up') },
          { key: 'fishright', label: '➡', onClick: () => swipe('right') },
        );
        return out;
      }
      out.push({ key: 'fishpull', label: 'Pull', onClick: () => swipe('up') });
      return out;
    }
    if (calm && atSpot() && ctx.isRodEquipped()) out.push({ key: 'fishcast', label: 'Cast', onClick: castAuto });
    return out;
  };
  const hideFishingHud = () => {
    hudKey = '';
    lastCue = null;
    meter.classList.add('hidden');
    reelEl.classList.add('hidden');
    document.body.classList.remove('town-reeling');
    T.extReel = null;
    reelPointer = null;
    keyReel = false;
    dropBubbles();
  };

  // ── Another line on the reel: Town's dive (townDive.js) — an arrow on a string, stuck in a
  // fish under water. setExtReel({ onTurns(turns), text() }) shows the reel (the on-screen one /
  // R / the phone's) as for a worn-out fish and hands it the turns; null takes it away.
  T.extReel = null;
  const setExtReel = (reel) => { T.extReel = reel || null; refreshHud(); };
  // A fish speared under water brought in (len: its length in m — koi 0.5 … 0.9)
  const landDiveFish = (len) => {
    const size = FISH_SIZES[len < 0.62 ? 0 : len < 0.78 ? 1 : 2];
    const n = size.n;
    ctx.playSfx?.('splash');
    const got = T.gain('fish', n);
    const kind = size.kinds[Math.floor(Math.random() * size.kinds.length)];
    const cm = Math.round(len * 100 * rand(0.95, 1.05));
    say(`Speared ${size.label}! ${got > 1 ? `+${got} fish` : got ? '+1 fish' : 'No room in your bag'}${got ? ` (${T.goods.fish})` : ''}`);
    if (got > 0) T.popup?.({ icon: '🐟', title: kind, sub: `${cm} cm · +${got} fish` });
    T.questNote('fish');
    return got;
  };

  Object.assign(T, { setExtReel, landDiveFish, fishActKey, fishingActs, fishingHud, hideFishingHud, loseFish, stopFishingRig, updateFishing });
}

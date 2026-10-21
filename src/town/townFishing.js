// Town: fishing. The rod is bought at the weapon stall (SHOP_GEAR 'rod') and held like the
// sword — it is the sword weapon in rod form, swung with the phone's gyro (bootstrapGameApp.js).
// At the fishing spot (one for now — the shore spot nearest the middle, `places.fishSpot`):
//   • cast: swing the rod forward — the harder, the farther the bobber flies (FISH_CAST_*)
//   • wait: the bobber floats; a nibble first sometimes (pulling on it scares the fish off)
//   • bite: the bobber goes under (the phone buzzes) — pull the rod back within FISH_HOOK_S
//   • fight: the fish runs (line goes out; reeling or pulling now strains the line — too much
//     and it snaps) then tires at the surface (⬆ Pull! — a good pull brings it in a long way);
//     1–3 good pulls by its size (FISH_SIZES) wear it out
//   • reel it in: crank the reel (the phone's Block bar turns into one, or the on-screen reel /
//     hold R) until it's at the bank
// Without a gyro the cast / pull are buttons (acts). The game's player-local rod tip is
// sampled each frame; a cast / pull is its travel within FISH_GESTURE_S.
//
// Fishing anywhere there's water would mean: `atSpot` → "water within reach" over the whole map
// (the town's nav grid only covers NAV_BOUNDS — elsewhere sample `ctx.getWaterY` / the map's
// `sampleMapWaterLevel` in a ring in front of the player instead of `nav.isWater`), a cast that
// can't land on dry ground between the bank and the bobber (a few water samples along the
// line), the fish's path kept on water while it runs (step back along the line when the next
// spot is dry), and, if spots should differ, a per-water-body table (sea / lake / river → which
// fish, bite times, sizes) looked up from what the water sampler hit.

import * as THREE from 'three';
import { createFishingRig } from '../items/fishingRod.js';
import {
  FISH_CANCEL_DIST, FISH_CAST_DIST, FISH_CAST_REACH, FISH_CAST_SWING, FISH_GESTURE_S, FISH_HOOK_S,
  FISH_KEY_REEL, FISH_LAND_DIST, FISH_LINE_MAX, FISH_NIBBLE_CHANCE, FISH_NIBBLE_S, FISH_PULL_KEEP,
  FISH_PULL_SWING, FISH_PULL_TENSION, FISH_REEL_M, FISH_RUN_S, FISH_RUN_SPEED, FISH_SETTLE_S, FISH_SIZES,
  FISH_SPOT_RADIUS, FISH_TENSION_DECAY, FISH_TENSION_PER_TURN, FISH_TIRED_S, FISH_WAIT_S, NAV_CELL,
  dist2, el, rand,
} from './townConfig.js';

const TURN = Math.PI * 2;
const END_CUE_S = 1.2;      // s the last cue (caught / snapped / got away) stays on the reel

// What each moment of it says (the HUD, the phone's reel); key = the phone's buzz
const CUES = {
  aim: '🎣 Swing the rod forward to cast',
  aimButton: '🎣 Cast when you\'re ready',
  cast: '🎣 …',
  wait: 'Wait for a bite… (reel to bring it in)',
  nibble: 'Something\'s nibbling… wait for it!',
  bite: '❗ BITE! Pull the rod back!',
  run: '🐟 It\'s running — ease off!',
  pull: '⬆ PULL!',
  reel: '🌀 Reel it in!',
};

// T: the town's shared state + functions (createTownMode in townMode.js); ctx: the game
export function installTownFishing(T, ctx) {
  // ── HUD: what to do + the line / tension, and an on-screen reel (no phone) ──
  const meter = el('div', 'town-fishing ui-panel hidden');
  const cueEl = el('div', 'town-fishing-cue');
  const bars = el('div', 'town-fishing-bars');
  const bar = (label) => {
    const row = el('div', 'town-fishing-row');
    const fill = el('div', 'town-fishing-fill');
    const track = el('div', 'town-fishing-track');
    track.append(fill);
    row.append(el('span', 'town-fishing-label', label), track);
    bars.append(row);
    return { row, fill };
  };
  const lineBar = bar('Line');
  const tensionBar = bar('Strain');
  meter.append(cueEl, bars);
  const reelEl = el('div', 'town-reel hidden');
  const reelHandle = el('div', 'town-reel-handle');
  reelEl.append(reelHandle, el('div', 'town-reel-label', 'Reel'));
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
  const atSpot = () => {
    const s = spot();
    if (!s) return false;
    const p = T.playerPos();
    return dist2(p.x, p.z, s.x, s.z) < FISH_SPOT_RADIUS * FISH_SPOT_RADIUS;
  };
  // Where the bobber lands: the water nearest `dist` m in front of the player
  const _fwd = new THREE.Vector3();
  const castTarget = (dist) => {
    const p = T.playerPos();
    const nav = T.layout.nav;
    ctx.getPlayerModel()?.getWorldDirection(_fwd);
    const aimX = p.x + _fwd.x * dist;
    const aimZ = p.z + _fwd.z * dist;
    let best = null;
    let bestD = Infinity;
    const r = FISH_CAST_REACH;
    for (let dz = -r; dz <= r; dz += NAV_CELL / 2) {
      for (let dx = -r; dx <= r; dx += NAV_CELL / 2) {
        const x = p.x + dx;
        const z = p.z + dz;
        if (dx * dx + dz * dz < 1.5 * 1.5 || !nav.isWater(nav.indexAt(x, z))) continue;
        const d = dist2(x, z, aimX, aimZ);
        if (d < bestD) { bestD = d; best = { x, z }; }
      }
    }
    if (!best) return null;
    const y = ctx.getWaterY(best.x, best.z) ?? ctx.getGroundY(best.x, best.z);
    return new THREE.Vector3(best.x, y, best.z);
  };

  // ── The rod tip's motion (player-local), for casts and pulls ──
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
  // How far the tip went forward / back-or-up within the window (m)
  const swing = () => {
    if (tipHistory.length < 2) return { fwd: 0, back: 0 };
    const cur = tipHistory[tipHistory.length - 1];
    let minZ = cur.z; let maxZ = cur.z; let minY = cur.y;
    for (const h of tipHistory) {
      minZ = Math.min(minZ, h.z);
      maxZ = Math.max(maxZ, h.z);
      minY = Math.min(minY, h.y);
    }
    return { fwd: cur.z > 0.2 ? cur.z - minZ : 0, back: Math.max(maxZ - cur.z, cur.y - minY) };
  };
  let gestureAt = -1; // (one gesture at a time: the window starts afresh after each)
  const takeGesture = () => {
    if (T.simT - gestureAt < FISH_GESTURE_S) return null;
    const s = swing();
    if (s.back >= FISH_PULL_SWING && s.back > s.fwd) return { kind: 'pull' };
    if (s.fwd >= FISH_CAST_SWING[0]) {
      return { kind: 'cast', power: THREE.MathUtils.clamp((s.fwd - FISH_CAST_SWING[0]) / (FISH_CAST_SWING[1] - FISH_CAST_SWING[0]), 0, 1) };
    }
    return null;
  };
  const used = () => { gestureAt = T.simT; tipHistory.length = 0; };

  // ── The line ──
  // T.fishing (null: the line's not out):
  //   { phase: 'cast' | 'wait' | 'bite' | 'fight', x, z (where the player cast from),
  //     dir {x, z}, d (m of line out), t (s in this phase), left (s: until the bite / to hook it),
  //     nibble (s left of one), settleAt, fish: { size, stamina, mode: 'run' | 'tired' | 'beaten',
  //     left, tension, side } }
  let rig = null;
  const fishingRig = () => (rig ??= createFishingRig(ctx.scene));
  let endCue = null; // { cue, text, until } — the last word, shown a moment after the line's in
  let lastCue = null;
  const say = (text) => T.feedLine(text);
  const finish = (cue, text, caught = false) => {
    T.fishing = null;
    rig?.reel(caught);
    endCue = { cue, text, until: T.simT + END_CUE_S };
  };

  let awayHintAt = -99;
  const cast = (power) => {
    if (T.fishing || !ctx.isRodEquipped() || T.sequence || ctx.isPlayerDead()) return false;
    if (!atSpot()) {
      if (T.simT - awayHintAt > 5) { awayHintAt = T.simT; say('🎣 Fish at the 🎣 Fishing spot by the water.'); }
      return false;
    }
    const rod = ctx.getRodModel();
    const at = rod && castTarget(FISH_CAST_DIST[0] + (FISH_CAST_DIST[1] - FISH_CAST_DIST[0]) * power);
    if (!at) { say('🎣 No water in reach — face the water.'); return false; }
    const p = T.playerPos();
    const d = Math.hypot(at.x - p.x, at.z - p.z);
    T.fishing = {
      phase: 'cast', x: p.x, z: p.z, dir: { x: (at.x - p.x) / d, z: (at.z - p.z) / d }, d, t: 0,
      left: rand(...FISH_WAIT_S), nibble: 0, nibbled: Math.random() < FISH_NIBBLE_CHANCE,
      settleAt: T.simT + FISH_SETTLE_S, fish: null,
    };
    endCue = null;
    fishingRig().cast(rod, at);
    return true;
  };
  // A pull on the rod: hooks a bite, scares off a nibbler, tires (or strains) a hooked fish
  const pull = () => {
    const f = T.fishing;
    if (!f || T.simT < f.settleAt) return;
    if (f.phase === 'wait' && f.nibble > 0) {
      f.nibble = 0;
      f.nibbled = false;
      f.left = rand(...FISH_WAIT_S) + 2;
      say('🐟 Too soon — you scared it off. Wait for the bobber to go under.');
    } else if (f.phase === 'bite') {
      const size = pickSize();
      f.phase = 'fight';
      f.t = 0;
      f.fish = { size, stamina: size.pulls, mode: 'run', left: rand(...FISH_RUN_S), tension: 0, side: Math.random() < 0.5 ? -1 : 1 };
      rig?.hook();
      say(`🎣 Hooked ${size.label}! Ease off while it runs, pull when it tires.`);
    } else if (f.phase === 'fight') {
      const fish = f.fish;
      if (fish.mode === 'tired') {
        fish.stamina -= 1;
        f.d = Math.max(FISH_LAND_DIST + 0.4, f.d * FISH_PULL_KEEP);
        fish.tension = Math.max(0, fish.tension - 0.3);
        if (fish.stamina <= 0) { fish.mode = 'beaten'; say('🐟 It\'s worn out — reel it in!'); }
        else { fish.mode = 'run'; fish.left = rand(...FISH_RUN_S); fish.side = -fish.side; }
      } else if (fish.mode === 'run') {
        fish.tension += FISH_PULL_TENSION;
      }
    }
  };
  const pickSize = () => {
    let r = Math.random() * FISH_SIZES.reduce((sum, s) => sum + s.w, 0);
    return FISH_SIZES.find((s) => (r -= s.w) < 0) ?? FISH_SIZES[0];
  };

  // Put away at once (leaving Town, arrests): no reeling in
  const stopFishingRig = () => { rig?.stop(); endCue = null; };

  const _fishAt = { x: 0, z: 0 };
  const updateFishing = (dt) => {
    // Ended elsewhere (a shop, an arrest, a fight): reel in empty, or just put it away
    if (!T.fishing && rig?.isBusy() && rig.phase() !== 'reel' && rig.phase() !== 'show') {
      if (ctx.isPlayerDead() || T.jail || T.sequence || !ctx.isRodEquipped()) rig.stop();
      else rig.reel(false);
    }
    if (ctx.isRodEquipped()) sampleTip();
    else tipHistory.length = 0;
    // (the reel's turns: phone + on-screen + R — taken every frame, so none pile up)
    const reeled = ctx.takeReel() + screenReel + (keyReel ? FISH_KEY_REEL * TURN * dt : 0);
    screenReel = 0;
    const turns = reeled / TURN;

    const gesture = ctx.hasGyro() && ctx.isRodEquipped() ? takeGesture() : null;
    if (!T.fishing && gesture?.kind === 'cast' && T.calmNow() && !T.stalls.focused() && !T.marketPanel.isOpen()
      && !T.jobTalk.isOpen()) {
      used();
      cast(gesture.power);
    }

    const f = T.fishing;
    let bite = 0;
    let load = 0;
    if (f) {
      const p = T.playerPos();
      if (dist2(p.x, p.z, f.x, f.z) > FISH_CANCEL_DIST * FISH_CANCEL_DIST || ctx.isPlayerDead() || !ctx.isRodEquipped()) {
        if (!ctx.isRodEquipped() || ctx.isPlayerDead()) { T.fishing = null; rig?.stop(); endCue = null; }
        else finish(f.fish ? 'lost' : 'in', f.fish ? 'It got away…' : 'Reeled in.');
        refreshHud();
        return;
      }
      if (gesture?.kind === 'pull') { used(); pull(); }
      f.t += dt;
      if (f.phase === 'cast') {
        if (rig?.isOut()) { f.phase = 'wait'; f.t = 0; }
      } else if (f.phase === 'wait') {
        // Reeling in a waiting line just brings the bobber back
        if (turns > 0) f.d -= turns * FISH_REEL_M;
        if (f.d <= FISH_LAND_DIST) { finish('in', 'Reeled in — cast again.'); refreshHud(); return; }
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
          say('🐟 Too slow — it stole the bait. Pull the rod back as soon as the bobber goes under.');
        }
      } else if (f.phase === 'fight') {
        const fish = f.fish;
        if (fish.mode === 'run') {
          // It takes line; reeling against it strains the line
          f.d += FISH_RUN_SPEED * dt;
          fish.tension += turns * FISH_TENSION_PER_TURN;
          fish.left -= dt;
          if (fish.left <= 0) { fish.mode = 'tired'; fish.left = FISH_TIRED_S; }
          load = 0.85;
        } else if (fish.mode === 'tired') {
          f.d -= turns * FISH_REEL_M * 0.6;
          fish.left -= dt;
          // (no pull in time: it gets its breath back)
          if (fish.left <= 0) { fish.mode = 'run'; fish.left = rand(...FISH_RUN_S); fish.side = -fish.side; }
          load = 0.4;
        } else {
          f.d -= turns * FISH_REEL_M;
          load = 0.5;
        }
        fish.tension = Math.max(0, fish.tension - FISH_TENSION_DECAY * dt);
        load = Math.min(1, load + fish.tension * 0.3);
        // (until it's worn out it won't come right in)
        if (fish.mode !== 'beaten') f.d = Math.max(FISH_LAND_DIST + 0.4, f.d);
        if (fish.tension >= 1) {
          finish('snap', '💥 The line snapped!');
          say('💥 Snap! You strained the line too hard — let it run, then pull when it tires.');
        } else if (f.d > FISH_LINE_MAX) {
          finish('lost', 'It took all the line…');
          say('🐟 It ran off with all your line — pull it in when it tires!');
        } else if (f.d <= FISH_LAND_DIST) {
          const n = fish.size.n;
          finish('landed', `🐟 Caught ${fish.size.label}!`, true);
          T.gain('fish', n);
          say(`🐟 Caught ${fish.size.label}! ${n > 1 ? `+${n} fish` : '+1 fish'} (${T.goods.fish})`);
          T.introNote('fish');
        }
      }
    }
    // Where the bobber is: along the cast; a hooked fish swings from side to side as it runs
    if (T.fishing && rig) {
      const g = T.fishing;
      const sway = g.fish && g.fish.mode !== 'beaten' ? Math.sin(g.t * 0.9) * Math.min(2, g.d * 0.25) * g.fish.side : 0;
      _fishAt.x = g.x + g.dir.x * g.d - g.dir.z * sway;
      _fishAt.z = g.z + g.dir.z * g.d + g.dir.x * sway;
    }
    rig?.update(dt, { bite, load, crank: reeled, fish: T.fishing && T.fishing.phase !== 'cast' ? _fishAt : null });
    refreshHud();
  };

  // ── What it says right now (the HUD, the phone's reel) ──
  // { line: the line's out, cue, text, tension, d } or null (nothing to do with fishing)
  const status = () => {
    const f = T.fishing;
    if (!f) {
      if (endCue && T.simT < endCue.until) return { line: true, cue: endCue.cue, text: endCue.text, tension: 0, d: 0 };
      if (ctx.isRodEquipped() && atSpot() && !T.sequence) {
        return { line: false, cue: 'aim', text: ctx.hasGyro() ? CUES.aim : CUES.aimButton, tension: 0, d: 0 };
      }
      return null;
    }
    let cue = f.phase;
    if (f.phase === 'wait' && f.nibble > 0) cue = 'nibble';
    if (f.phase === 'fight') cue = f.fish.mode === 'run' ? 'run' : f.fish.mode === 'tired' ? 'pull' : 'reel';
    return { line: true, cue, text: CUES[cue], tension: f.fish?.tension ?? 0, d: f.d };
  };
  let hudKey = '';
  const refreshHud = () => {
    const s = status();
    // (the DOM only when something shows differently)
    const k = s ? `${s.cue}|${s.text}|${s.line}|${Math.round(s.d * 4)}|${Math.round(s.tension * 40)}|${!!T.fishing?.fish}|${ctx.isPhoneConnected()}` : '';
    if (k === hudKey) return;
    hudKey = k;
    meter.classList.toggle('hidden', !s);
    // (the on-screen reel when there's no phone — it has its own)
    reelEl.classList.toggle('hidden', !s?.line || ctx.isPhoneConnected());
    document.body.classList.toggle('town-reeling', !!s?.line);
    if (s) {
      cueEl.textContent = s.text;
      meter.dataset.cue = s.cue;
      lineBar.row.classList.toggle('hidden', !s.line || !T.fishing);
      tensionBar.row.classList.toggle('hidden', !T.fishing?.fish);
      lineBar.fill.style.width = `${Math.round(Math.min(1, s.d / FISH_LINE_MAX) * 100)}%`;
      tensionBar.fill.style.width = `${Math.round(Math.min(1, s.tension) * 100)}%`;
      tensionBar.fill.dataset.level = s.tension > 0.75 ? 'high' : s.tension > 0.45 ? 'mid' : 'low';
    }
    // A new cue: the phone hears it now (it buzzes), not on its next status tick
    const key = s ? s.cue : null;
    if (key !== lastCue) { lastCue = key; ctx.refreshPhone?.(); }
  };
  // For the phone: the reel while the line's out
  const fishingHud = () => {
    const s = status();
    if (!s?.line) return null;
    return { reel: true, cue: s.cue, text: s.text, tension: Math.round(s.tension * 10) / 10 };
  };

  // ── Acts (townActs.js): at the spot — get the rod out / buy one; no gyro: Cast / Pull ──
  const fishingActs = (calm) => {
    const out = [];
    if (T.fishing) {
      if (!ctx.hasGyro()) out.push({ key: 'fishpull', label: '⬆ Pull', onClick: pull });
      return out;
    }
    if (!calm || !atSpot()) return out;
    if (!ctx.ownsRod()) {
      out.push({ key: 'fishrod', label: '🎣 Need a rod', onClick: () => say('🎣 Fishing rods are sold at the ⚔️ Weapons stall at the market.') });
    } else if (!ctx.isRodEquipped()) {
      out.push({ key: 'fishrod', label: '🎣 Fish', onClick: () => { ctx.equipRod(); say(ctx.hasGyro() ? '🎣 Swing the rod forward to cast.' : '🎣 Rod out — Cast when you\'re ready.'); } });
    } else if (!ctx.hasGyro()) {
      out.push({ key: 'fishcast', label: '🎣 Cast', onClick: () => cast(0.55) });
    }
    return out;
  };
  const hideFishingHud = () => {
    hudKey = '';
    lastCue = null;
    meter.classList.add('hidden');
    reelEl.classList.add('hidden');
    document.body.classList.remove('town-reeling');
    reelPointer = null;
    keyReel = false;
  };

  Object.assign(T, { fishingActs, fishingHud, hideFishingHud, stopFishingRig, updateFishing });
}

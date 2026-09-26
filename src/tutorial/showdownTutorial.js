/**
 * Sword Showdown tutorial — a scripted run through the game's mechanics:
 *
 *   1. Phone setup (QR code + calibration)
 *   2. Hitting past blocks: a swordsman holds a horizontal / vertical / diagonal block
 *      until the player lands a swing along the blade (swipe arrow drawn over it)
 *   3. Blocking: the swordsman winds up a swing and only swings once the player holds
 *      Block with the blade across the swing (block bar drawn over it)
 *   4. Deflecting bombs: a bomber throws once the sword tip is at the marker
 *   5. Coins + auto-buy + throwing a bomb at three distant swordsmen (stationary)
 *   6. Shield (bought, equipped, then hit until it breaks)
 *   7. Bubble (bought, activated, enemy swords bounce off it)
 *   8. Gun + bullets (bought, equipped, shoot a distant swordsman)
 *
 * The player can't die (bootstrapGameApp keeps health full while it runs). Every step can
 * be skipped from the panel (e.g. when playing without a phone). All game access goes
 * through `ctx` (see createShowdownTutorialContext in bootstrapGameApp.js).
 */
import * as THREE from 'three';
import { BLOCK_PRESETS, SWING_PRESETS, swingCrossesBlade } from '../characters/EnemyPlayer.js';
import { createTutorialOverlay } from './tutorialOverlay.js';

// Blocks the player has to hit past: [BLOCK_PRESETS index, name]
const ENEMY_BLOCK_LESSONS = [
  { preset: 2, name: 'HORIZONTAL', swipe: 'Swipe HORIZONTALLY — along the blade — to slip past it.' },
  { preset: 0, name: 'VERTICAL', swipe: 'Swipe straight DOWN (or up) — along the blade — to slip past it.' },
  { preset: 3, name: 'DIAGONAL', swipe: 'Swipe DIAGONALLY — along the blade — to slip past it.' }
];
// Swings the player has to block: [SWING_PRESETS index, name, which way to hold the blade]
const PLAYER_BLOCK_LESSONS = [
  { preset: 1, name: 'HORIZONTAL', block: 'Hold your sword UPRIGHT (vertical) to block it.' },
  { preset: 0, name: 'OVERHEAD', block: 'Hold your sword FLAT (horizontal) above you to block it.' },
  { preset: 3, name: 'DIAGONAL', block: 'Hold your sword along the OTHER diagonal to block it.' }
];

const BLOCK_CORRECT_MIN_ANGLE_DEG = 50; // blade vs swing, stricter than the game's 15° so the block holds
const BLOCK_HOLD_TO_RELEASE_S = 0.35;
const SWING_RESULT_TIMEOUT_MS = 1800;
const DEFLECT_MARKER_FORWARD = 0.75;    // m in front of the player
const DEFLECT_MARKER_HEIGHT = 1.15;     // m above the ground
const DEFLECT_READY_DIST = 0.45;        // sword tip → marker, to trigger the throw
const DEFLECT_READY_HOLD_S = 0.3;
const BOMBER_DISTANCE = 8;
const BOMB_TARGET_SPREAD = 1.3;         // m either side of the centre target
const GUN_TARGET_DISTANCE = 7;
const TUTORIAL_SHIELD_HEALTH = 6;       // 3 enemy sword hits
const BUBBLE_BLOCKS_NEEDED = 2;

const COLORS = {
  guide: '#facc15',
  ok: '#22c55e',
  swing: '#ef4444'
};

class StepSkipped extends Error {}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _proj = new THREE.Vector3();
const _quat = new THREE.Quaternion();

/** Lines have no direction: fold an angle into (-π/2, π/2]. */
function lineAngle(angle) {
  let a = angle;
  while (a > Math.PI / 2) a -= Math.PI;
  while (a <= -Math.PI / 2) a += Math.PI;
  return a;
}

export function createShowdownTutorial(ctx) {
  const overlay = createTutorialOverlay();
  const waits = new Set();
  const cleanups = [];
  let frameHandler = null;
  let active = false;
  let skipRequested = false;
  let hurtCount = 0;
  let swordsman = null;
  const markers = [];

  // ── plumbing ──────────────────────────────────────────────────────────────
  const waitFor = (pred) => new Promise((resolve, reject) => {
    waits.add({ pred, resolve, reject });
  });
  const delay = (ms) => {
    const end = performance.now() + ms;
    return waitFor(() => performance.now() >= end);
  };
  const onCleanup = (fn) => cleanups.push(fn);
  const runCleanups = () => {
    while (cleanups.length) {
      try { cleanups.pop()(); } catch (err) { console.warn('[tutorial] cleanup failed', err); }
    }
    frameHandler = null;
    overlay.clearGuides();
    overlay.highlight([]);
    ctx.setPhoneHighlight(null);
  };

  const toScreen = (world) => {
    _proj.copy(world).project(ctx.camera);
    if (_proj.z > 1 || _proj.z < -1) return null;
    return {
      x: (_proj.x * 0.5 + 0.5) * window.innerWidth,
      y: (-_proj.y * 0.5 + 0.5) * window.innerHeight
    };
  };
  /** Screen-space angle of the world segment from `from` along `dir` (radians). */
  const screenAngle = (from, dir) => {
    const a = toScreen(from);
    const b = toScreen(_c.copy(from).addScaledVector(dir, 0.4));
    if (!a || !b) return null;
    return Math.atan2(b.y - a.y, b.x - a.x);
  };
  const chestOf = (entity, out) => out.copy(entity.group.position).setY(entity.group.position.y + 0.95);

  const setHighlight = (name) => {
    overlay.highlight(name ? [ctx.getButton(name)] : []);
    ctx.setPhoneHighlight(name);
  };

  // 3D markers (deflect beam, bomb landing ring)
  const addMarker = (object) => {
    ctx.scene.add(object);
    markers.push(object);
    return object;
  };
  const removeMarker = (object) => {
    object.parent?.remove(object);
    object.traverse?.((o) => {
      o.geometry?.dispose?.();
      o.material?.dispose?.();
    });
    const i = markers.indexOf(object);
    if (i !== -1) markers.splice(i, 1);
  };
  const makeBeam = () => {
    const group = new THREE.Group();
    const material = new THREE.MeshBasicMaterial({ color: COLORS.guide, transparent: true, opacity: 0.75, depthWrite: false });
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1, 10), material);
    beam.name = 'beam';
    const tip = new THREE.Mesh(
      new THREE.SphereGeometry(0.13, 16, 12),
      new THREE.MeshBasicMaterial({ color: COLORS.guide, transparent: true, opacity: 0.55, depthWrite: false })
    );
    tip.name = 'tip';
    group.add(beam, tip);
    group.renderOrder = 20;
    return group;
  };
  const makeRing = () => {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.9, 1.15, 40),
      new THREE.MeshBasicMaterial({ color: COLORS.guide, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.renderOrder = 20;
    return ring;
  };

  // Ground point `dist` m from the player along the (horizontal) direction `dir`, shifted sideways by `side`
  const pointFromPlayer = (dir, dist, side = 0) => {
    const p = ctx.playerModel.position;
    const x = p.x + dir.x * dist - dir.z * side;
    const z = p.z + dir.z * dist + dir.x * side;
    return new THREE.Vector3(x, ctx.groundY(x, z) ?? p.y, z);
  };

  const removeEnemy = (enemy) => {
    if (!enemy) return;
    ctx.removeEnemy(enemy);
    if (enemy === swordsman) swordsman = null;
  };

  const ensureSwordsman = (script) => {
    if (!swordsman || swordsman.isDead || !swordsman.group?.parent) {
      if (swordsman) removeEnemy(swordsman);
      const dir = ctx.getForward(_a);
      swordsman = ctx.spawnSwordsman({ position: pointFromPlayer(dir, 2.4), hearts: 3, script });
    } else {
      swordsman.script = script;
    }
    swordsman.stationary = false;
    return swordsman;
  };
  const healSwordsman = () => {
    if (!swordsman || swordsman.isDead) return;
    swordsman.hearts = swordsman.maxHearts;
    swordsman._updateHealthBarCanvas?.(true);
  };

  // Scatter coins worth `total` around the player (inside the pickup drift radius) and wait
  const collectCoins = async (total) => {
    // Whole-coin pickups (coins are integers); 10 of them unless another count divides evenly
    const count = [10, 12, 8, 6, 5, 4].find((n) => total % n === 0) ?? 10;
    const pickups = ctx.spawnCoins(count, Math.ceil(total / count));
    onCleanup(() => ctx.removePickups(pickups));
    await waitFor(() => ctx.countPickups(pickups) === 0);
  };

  const panel = (index, total, titleText, bodyText, hintText = '') => {
    overlay.setStep({ progressText: `TUTORIAL · ${index} / ${total}`, titleText, bodyText, hintText });
  };

  // ── steps ─────────────────────────────────────────────────────────────────
  const steps = [];
  const step = (fn) => steps.push(fn);
  const TOTAL = 13;

  // 1. Phone setup
  step(async () => {
    panel(1, TOTAL, 'CONNECT YOUR SWORD',
      'Scan the QR code with your phone — it becomes your sword. Then hold it like a sword and set neutral.');
    ctx.requestPhoneSetup();
    const started = performance.now();
    // Wait for the QR modal to appear (the phone peer may still be starting), unless already connected
    await waitFor(() => ctx.isPhoneConnected() || ctx.isPhoneSetupOpen() || performance.now() - started > 15000);
    await waitFor(() => !ctx.isPhoneSetupOpen());
    if (!ctx.isPhoneConnected()) {
      panel(1, TOTAL, 'NO PHONE CONNECTED',
        'Sword moves need the phone controller. You can still follow along — use “Skip step” when a lesson needs the phone.');
      await delay(3500);
    }
  });

  // 2–4. Hit past the enemy's block
  ENEMY_BLOCK_LESSONS.forEach((lesson, i) => step(async () => {
    const enemy = ensureSwordsman({ mode: 'block', preset: lesson.preset });
    healSwordsman();
    panel(2 + i, TOTAL, `HIT PAST A ${lesson.name} BLOCK`,
      `This enemy is blocking ${lesson.name}LY. Swings that cross the blade bounce off. ${lesson.swipe}`);
    const presetDir = BLOCK_PRESETS[lesson.preset].dir;
    frameHandler = () => {
      if (!swordsman) return;
      chestOf(swordsman, _a);
      swordsman.group.getWorldQuaternion(_quat);
      _b.copy(presetDir).applyQuaternion(_quat);
      const at = toScreen(_a);
      const angle = screenAngle(_a, _b);
      overlay.setGuides(at && angle !== null ? [{
        key: 'swipe', type: 'double-arrow', x: at.x, y: at.y, angle: lineAngle(angle),
        length: 240, color: COLORS.guide, label: 'SWIPE'
      }] : []);
    };
    let bounces = enemy.swordBounces;
    const hearts = enemy.hearts;
    await waitFor(() => {
      const e = swordsman;
      if (!e || e.isDead) return true;
      if (e.swordBounces > bounces) {
        bounces = e.swordBounces;
        overlay.setHint('Blocked! That swing crossed the blade — swipe along it.', 'warn');
      }
      return e.hearts < hearts;
    });
    frameHandler = null;
    overlay.clearGuides();
    overlay.setHint('Hit! ✔', 'ok');
    await delay(1300);
    healSwordsman();
  }));

  // 5–7. Block the enemy's swing
  PLAYER_BLOCK_LESSONS.forEach((lesson, i) => step(async () => {
    const script = { mode: 'windup', preset: lesson.preset, release: false, swings: 0 };
    ensureSwordsman(script);
    healSwordsman();
    const article = /^[AEIOU]/.test(lesson.name) ? 'AN' : 'A';
    panel(5 + i, TOTAL, `BLOCK ${article} ${lesson.name} SWING`,
      `The enemy is winding up ${article.toLowerCase()} ${lesson.name} swing. Hold 🛡 BLOCK with your blade PERPENDICULAR to the swing — the bar shows how. ${lesson.block} It swings when your block is right.`);
    const preset = SWING_PRESETS[lesson.preset];
    const swingDir = new THREE.Vector3();
    const viewDir = new THREE.Vector3();
    const bladeDir = new THREE.Vector3();
    let correctFor = 0;
    let correct = false;
    let pending = null; // { at, bounces, hurt }
    let done = false;

    frameHandler = (dt) => {
      const e = swordsman;
      if (!e || e.isDead) return;
      e.script = script;
      e.group.getWorldQuaternion(_quat);
      swingDir.subVectors(preset.to, preset.from).applyQuaternion(_quat);
      viewDir.subVectors(ctx.playerModel.position, e.group.position).setY(0);
      const blade = ctx.getPlayerBladeDir(bladeDir);
      correct = ctx.isBlocking() && !!blade && e._aiState === 'attack' &&
        swingCrossesBlade(swingDir, blade, viewDir, BLOCK_CORRECT_MIN_ANGLE_DEG);
      setHighlight(ctx.isBlocking() ? null : 'block');

      const guides = [];
      chestOf(e, _a);
      const swingAt = toScreen(_a);
      const swingAngle = screenAngle(_a, swingDir);
      if (swingAt && swingAngle !== null) {
        guides.push({ key: 'swing', type: 'arrow', x: swingAt.x, y: swingAt.y, angle: swingAngle,
          length: 190, color: COLORS.swing, dashed: true, label: 'SWING' });
        // Block bar: perpendicular to the swing, between the player and the enemy
        _b.copy(ctx.playerModel.position).setY(ctx.playerModel.position.y + 1.0).lerp(_a, 0.45);
        const barAt = toScreen(_b);
        if (barAt) {
          guides.push({ key: 'bar', type: 'bar', x: barAt.x, y: barAt.y,
            angle: lineAngle(swingAngle + Math.PI / 2), length: 170,
            color: correct ? COLORS.ok : COLORS.guide, label: correct ? 'GOOD!' : 'BLOCK' });
        }
      }
      overlay.setGuides(guides);

      if (pending) {
        if (e.swordBounces > pending.bounces) {
          done = true;
        } else if (hurtCount > pending.hurt) {
          overlay.setHint('Ouch! Keep holding BLOCK with the blade across the swing.', 'warn');
          pending = null;
          correctFor = 0;
        } else if (performance.now() - pending.at > SWING_RESULT_TIMEOUT_MS) {
          pending = null;
          correctFor = 0;
        }
        return;
      }
      correctFor = correct ? correctFor + dt : 0;
      if (correctFor >= BLOCK_HOLD_TO_RELEASE_S && e._attackPhase === 'swing_hold') {
        pending = { at: performance.now(), bounces: e.swordBounces, hurt: hurtCount };
        script.release = true;
      }
    };
    await waitFor(() => done || !swordsman || swordsman.isDead);
    frameHandler = null;
    overlay.clearGuides();
    setHighlight(null);
    overlay.setHint('Blocked! ✔', 'ok');
    if (swordsman) swordsman.script = { mode: 'passive' };
    await delay(1400);
  }));

  // 8. Deflect a bomb back at the bomber
  step(async () => {
    removeEnemy(swordsman);
    const dir = ctx.getForward(new THREE.Vector3());
    const aim = new THREE.Vector3();
    const tip = new THREE.Vector3();
    const bomber = ctx.spawnBomber({
      position: pointFromPlayer(dir, BOMBER_DISTANCE),
      hearts: 1,
      throwsHeld: true,
      // Aim at the sword tip when it's at the marker (so the bomb meets the blade), else the marker
      aimAt: () => {
        const t = ctx.getSwordTip(tip);
        return (t && t.distanceTo(aim) < 0.8 ? t : aim).clone();
      }
    });
    onCleanup(() => { if (!bomber.isDead) removeEnemy(bomber); });
    const beam = addMarker(makeBeam());
    onCleanup(() => removeMarker(beam));
    panel(8, TOTAL, 'DEFLECT A BOMB',
      'Bombers lob bombs at you. Touch a bomb with your sword to knock it straight back at the thrower! Hold your sword tip in the glowing marker — the bomber throws when you’re ready.');

    let readyFor = 0;
    let throwRequested = false;
    let bombsOut = 0;
    frameHandler = (dt) => {
      if (bomber.isDead) return;
      // Marker: in front of the player, toward the bomber, at sword height
      _a.subVectors(bomber.group.position, ctx.playerModel.position).setY(0);
      if (_a.lengthSq() < 1e-4) _a.copy(dir);
      _a.normalize();
      const p = ctx.playerModel.position;
      const gx = p.x + _a.x * DEFLECT_MARKER_FORWARD;
      const gz = p.z + _a.z * DEFLECT_MARKER_FORWARD;
      const gy = ctx.groundY(gx, gz) ?? p.y;
      aim.set(gx, gy + DEFLECT_MARKER_HEIGHT, gz);
      beam.position.set(gx, gy, gz);
      const beamMesh = beam.getObjectByName('beam');
      beamMesh.scale.y = DEFLECT_MARKER_HEIGHT;
      beamMesh.position.y = DEFLECT_MARKER_HEIGHT / 2;
      beam.getObjectByName('tip').position.y = DEFLECT_MARKER_HEIGHT;

      const swordTip = ctx.getSwordTip(tip);
      const ready = !!swordTip && swordTip.distanceTo(aim) < DEFLECT_READY_DIST;
      const color = ready ? COLORS.ok : COLORS.guide;
      beam.traverse((o) => o.material?.color?.set(color));

      const inFlight = bomber._bombs?.length || 0;
      if (inFlight < bombsOut && !bomber.isDead) {
        overlay.setHint('Missed it — hold your sword tip in the marker and let the bomb touch it.', 'warn');
      }
      bombsOut = inFlight;

      if (throwRequested) {
        // One throw per request: hold the next one once this windup has started
        if (bomber._inWindup) {
          bomber.throwsHeld = true;
          throwRequested = false;
        }
        return;
      }
      if (inFlight > 0 || bomber._inWindup || bomber._glbCharacter?.actionActive) return;
      readyFor = ready ? readyFor + dt : 0;
      if (readyFor >= DEFLECT_READY_HOLD_S) {
        readyFor = 0;
        throwRequested = true;
        bomber._lastThrowTime = -Infinity;
        bomber.throwsHeld = false;
      }
    };
    await waitFor(() => bomber.isDead);
    frameHandler = null;
    removeMarker(beam);
    overlay.setHint('Deflected! ✔', 'ok');
    await delay(1800);
  });

  // 9. Coins, auto-buy, and throwing a bomb
  step(async () => {
    panel(9, TOTAL, 'COINS',
      'Coins buy items: bombs, bubbles, shields, the gun and bullets. Walk near these coins — they drift to you.');
    await collectCoins(await ctx.getPrice('showdown_bomb'));
    if (!(await ctx.buy('showdown_bomb'))) ctx.giveItem('showdown_bomb');
    setHighlight('bomb');

    // Three swordsmen right where a thrown bomb lands
    const dir = ctx.getForward(new THREE.Vector3());
    const targets = [-BOMB_TARGET_SPREAD, 0, BOMB_TARGET_SPREAD].map((side) => ctx.spawnSwordsman({
      position: pointFromPlayer(dir, ctx.bombThrowDistance, side),
      hearts: 1,
      stationary: true,
      script: { mode: 'passive' }
    }));
    onCleanup(() => targets.forEach((t) => { if (!t.isDead) removeEnemy(t); }));
    const ring = addMarker(makeRing());
    onCleanup(() => removeMarker(ring));

    panel(9, TOTAL, 'AUTO-BUY',
      'You just bought a bomb! When you run out of bombs, bubbles, shields or bullets, your coins are spent on a new one automatically.');
    await delay(4000);
    panel(10, TOTAL, 'THROW A BOMB',
      'Bombs reach distant enemies. Face the group and tap 💣 — the bomb lands where the ring is.');
    frameHandler = () => {
      setHighlight('bomb');
      const p = ctx.playerModel.position;
      const fwd = ctx.getForward(_b);
      const x = p.x + fwd.x * ctx.bombThrowDistance;
      const z = p.z + fwd.z * ctx.bombThrowDistance;
      ring.position.set(x, (ctx.groundY(x, z) ?? p.y) + 0.05, z);
      // Out of bombs with the job unfinished: hand over another
      if (ctx.getBombCount() === 0 && !ctx.isPlayerBombBusy() && targets.some((t) => !t.isDead)) {
        ctx.giveItem('showdown_bomb');
        overlay.setHint('Here’s another bomb — aim at the group and throw again.', 'warn');
      }
    };
    await waitFor(() => targets.every((t) => t.isDead));
    frameHandler = null;
    setHighlight(null);
    removeMarker(ring);
    overlay.setHint('Boom! ✔', 'ok');
    await delay(1800);
  });

  // 11. Shield
  step(async () => {
    panel(11, TOTAL, 'SHIELD',
      'Shields cost coins too. Collect these coins to buy one.');
    await collectCoins(await ctx.getPrice('shield'));
    await ctx.buy('shield');
    ctx.weakenShield(TUTORIAL_SHIELD_HEALTH);
    panel(11, TOTAL, 'EQUIP THE SHIELD', 'Tap 🛡 Shield to equip it.');
    frameHandler = () => setHighlight('shield');
    await waitFor(() => ctx.isEquipped('shield'));
    const shieldsBefore = ctx.getShieldCount();
    const enemy = ensureSwordsman(null);
    enemy.swingChance = 0.9;
    panel(11, TOTAL, 'SHIELD UP!',
      'A shield soaks up sword hits and bombs coming from the front — until it breaks. Keep facing the enemy!');
    frameHandler = () => {
      const equipped = ctx.isEquipped('shield');
      setHighlight(equipped ? null : 'shield');
      overlay.setHint(equipped ? '' : 'Equip your shield (🛡) to block!', 'warn');
    };
    await waitFor(() => ctx.getShieldCount() < shieldsBefore);
    frameHandler = null;
    setHighlight(null);
    if (swordsman) swordsman.script = { mode: 'passive' };
    overlay.setHint('Your shield broke — time for something stronger.', 'ok');
    await delay(2200);
    ctx.equipSword();
  });

  // 12. Bubble
  step(async () => {
    const enemy = ensureSwordsman({ mode: 'passive' });
    panel(12, TOTAL, 'BUBBLE', 'Collect these coins to buy a protective bubble.');
    await collectCoins(await ctx.getPrice('bubble'));
    if (!(await ctx.buy('bubble'))) ctx.giveItem('bubble');
    panel(12, TOTAL, 'USE THE BUBBLE',
      'Tap 🫧 to surround yourself with a bubble for 10 seconds. Swords and bombs bounce right off it.');
    frameHandler = () => setHighlight(ctx.isBubbleActive() ? null : 'bubble');
    await waitFor(() => ctx.isBubbleActive());
    enemy.script = null;
    enemy.swingChance = 0.9;
    let bounces = enemy.swordBounces;
    let blocked = 0;
    frameHandler = () => {
      const e = swordsman;
      if (!e) return;
      if (e.swordBounces > bounces) {
        blocked += e.swordBounces - bounces;
        bounces = e.swordBounces;
        overlay.setHint(`Bounced off! (${Math.min(blocked, BUBBLE_BLOCKS_NEEDED)} / ${BUBBLE_BLOCKS_NEEDED})`, 'ok');
      }
      if (!ctx.isBubbleActive() && blocked < BUBBLE_BLOCKS_NEEDED) {
        if (ctx.getBubbleCount() === 0) ctx.giveItem('bubble');
        setHighlight('bubble');
        overlay.setHint('The bubble popped — tap 🫧 again.', 'warn');
      } else {
        setHighlight(null);
      }
    };
    await waitFor(() => blocked >= BUBBLE_BLOCKS_NEEDED || !swordsman);
    frameHandler = null;
    setHighlight(null);
    removeEnemy(swordsman);
    await delay(1500);
  });

  // 13. Gun + bullets
  step(async () => {
    removeEnemy(swordsman);
    const ownsGun = ctx.hasItem('pistol');
    const bulletsPrice = await ctx.getPrice('gun bullets');
    panel(13, TOTAL, 'GUN',
      ownsGun ? 'Collect these coins to buy bullets for your gun.' : 'Collect these coins to buy the gun and bullets.');
    await collectCoins((ownsGun ? 0 : await ctx.getPrice('pistol')) + bulletsPrice);
    if (!ownsGun) await ctx.buy('pistol');
    await ctx.buy('gun bullets');
    if (ctx.getAmmo() < 5) ctx.addAmmo(5 - ctx.getAmmo());
    panel(13, TOTAL, 'EQUIP THE GUN', 'Tap 🔫 Gun to equip it.');
    frameHandler = () => setHighlight('gun');
    await waitFor(() => ctx.isEquipped('pistol'));

    const dir = ctx.getForward(new THREE.Vector3());
    const target = ctx.spawnSwordsman({
      position: pointFromPlayer(dir, GUN_TARGET_DISTANCE),
      hearts: 1,
      stationary: true,
      script: { mode: 'passive' }
    });
    onCleanup(() => { if (!target.isDead) removeEnemy(target); });
    panel(13, TOTAL, 'SHOOT!',
      'The gun is aimed with your phone’s gyro — point it at the enemy, then tap 🔥 Fire.');
    frameHandler = () => {
      const equipped = ctx.isEquipped('pistol');
      setHighlight(equipped ? 'fire' : 'gun');
      if (equipped && ctx.getAmmo() === 0) {
        ctx.addAmmo(5);
        overlay.setHint('Out of bullets — here are a few more.', 'warn');
      }
    };
    await waitFor(() => target.isDead);
    frameHandler = null;
    setHighlight(null);
    overlay.setHint('Got him! ✔', 'ok');
    await delay(1500);
  });

  // ── runner ────────────────────────────────────────────────────────────────
  const run = async () => {
    let completed = false;
    try {
      for (const fn of steps) {
        skipRequested = false;
        try {
          await fn();
        } catch (err) {
          if (!(err instanceof StepSkipped)) throw err;
        }
        runCleanups();
        overlay.setHint('');
      }
      completed = true;
    } catch (err) {
      console.error('[tutorial] failed', err);
    }
    runCleanups();
    removeEnemy(swordsman);
    markers.slice().forEach(removeMarker);
    overlay.hide();
    active = false;
    if (completed) await ctx.onComplete();
  };

  overlay.setSkipHandler(() => { skipRequested = true; });

  return {
    isActive: () => active,
    start() {
      if (active) return;
      active = true;
      hurtCount = 0;
      overlay.show();
      void run();
    },
    notifyPlayerHurt() {
      hurtCount += 1;
    },
    update(dt) {
      if (!active) return;
      if (!skipRequested) {
        try { frameHandler?.(dt); } catch (err) { console.warn('[tutorial] frame error', err); }
      }
      for (const w of [...waits]) {
        if (skipRequested) {
          waits.delete(w);
          w.reject(new StepSkipped());
        } else if (w.pred()) {
          waits.delete(w);
          w.resolve();
        }
      }
    }
  };
}

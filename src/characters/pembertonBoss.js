/**
 * Sword Showdown boss fighters: Pemberton — the story's final boss (stage PEMBERTON_STAGE,
 * villageMode.js) — and every stage's final enemy (createStageBoss, after its talk —
 * src/characters/stageBoss.js).
 *
 * An EnemyPlayer made bigger (`scale`), glowing red (addRedGlow, also used on Pemberton in the
 * village), with a big health bar across the top of the screen. Mostly fights with its sword,
 * and, with the gear it was given (`gear`), between sword spells it:
 *   • gun    — backs off and shoots (`ranged`, hostile bullets — ctx.fireBullet),
 *   • shield — raises a shield and advances behind it (blocks swings, bullets, bombs, blasts),
 *   • wand   — backs off and casts fire / ice blasts (EnemyPlayer's wand AI → enemy.onCast),
 *   • bombs  — lobs a bomb now and then when the player is at a distance (ctx.throwBomb),
 *   • bubble — after a hit, now and then a bubble round it stops everything for a while.
 * The gun / shield are the player's own models, held like Multiplayer Guns & Bombs bots hold
 * them (ctx.getWeaponGear). A stage boss waits (`autoStart: false`: passive, can't be hurt)
 * until start() — then it grows to its size over GROW_MS and the glow + health bar come on.
 * Game access goes through `ctx` (see createBossFighter).
 */

import * as THREE from 'three';
import { createWandModel, setWandGlow } from '../items/magicWand.js';

export const PEMBERTON_SCALE = 1.5;
export const PEMBERTON_HEARTS = 15;
export const PEMBERTON_SWING_CHANCE = 0.55;
const PEMBERTON_SWORD_SCALE = 1.3;
// Body hit sphere for the player's sword (bigger than a normal enemy's 0.65 m at 0.8 m up)
const PEMBERTON_BODY_HIT_RADIUS = 0.85;
const PEMBERTON_BODY_HIT_CENTER_Y = 1.1;
// Stage bosses (createStageBoss): a little bigger once the fight starts
export const STAGE_BOSS_SCALE = 1.25;
const STAGE_BOSS_SWORD_SCALE = 1.12;
const STAGE_BOSS_BODY_HIT_RADIUS = 0.75;
const STAGE_BOSS_BODY_HIT_CENTER_Y = 0.95;
const GROW_MS = 900;                 // start(): grows to its size over this long

// Phases: 'sword' (the normal sword AI) → 'gun', 'shield' or 'wand' (what it has) → 'sword'
const SWORD_MS = [6500, 10500];
const GUN_MS = [4000, 6500];
const SHIELD_MS = [2200, 3600];
const WAND_MS = [4500, 7000];
const GUN_CHANCE = 0.6;              // Pemberton after a sword spell: gun, else shield
const GUN_RANGE = { min: 6, max: 11 };    // keeps this far away while shooting
const SHIELD_RANGE = { min: 1.4, max: 3.2 }; // walks in behind the shield
const SHOT_MS = [850, 1600];
const SHOT_MAX_DIST = 16;
const SHOT_SPREAD = 0.06;            // radians of aim error
const MUZZLE = new THREE.Vector3(0, 1.0, 0.75); // model space (scaled with him)
const BOMB_MS = [5000, 8500];
const BOMB_RANGE = [4.5, 14];        // only from a distance
const BOMB_HAND = new THREE.Vector3(0, 1.6, 0.3);
const BUBBLE_MS = 3500;              // a bubble lasts this long…
const BUBBLE_COOLDOWN_MS = [11000, 16000]; // …and the next can't come sooner
const BUBBLE_CHANCE = 0.5;           // after a hit that didn't kill it
const BUBBLE_RADIUS = 1.0;           // model space (scaled with it)
const BUBBLE_CENTER_Y = 0.75;
const SHIELD_ARC_DOT = 0.2;          // hits from in front of the shield (cos of ~78°)
const PLAYER_CENTER_Y = 0.8;
const HUD_HIDE_MS = 2500;            // health bar stays up this long after he falls

const GLOW_COLOR = 0xff2a12;
const _yAxis = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const randIn = ([a, b]) => a + Math.random() * (b - a);

let _auraTexture = null;
function auraTexture() {
  if (_auraTexture) return _auraTexture;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 4, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255, 70, 30, 0.9)');
  grad.addColorStop(0.45, 'rgba(255, 30, 10, 0.35)');
  grad.addColorStop(1, 'rgba(255, 0, 0, 0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  _auraTexture = new THREE.CanvasTexture(c);
  _auraTexture.colorSpace = THREE.SRGBColorSpace;
  return _auraTexture;
}

/**
 * Makes `root`'s meshes glow red (own emissive material clones, pulsing) with a red aura
 * behind them. `height` = the character's height in metres.
 * @returns {{ update(t: number): void, dispose(): void }}
 */
export function addRedGlow(root, { height = 1 } = {}) {
  const materials = [];
  root.traverse((o) => {
    if (!o.isMesh || !o.visible || !o.material) return;
    const swap = (m) => {
      if (!m || !('emissive' in m)) return m;
      const c = m.clone();
      c.emissive = new THREE.Color(GLOW_COLOR);
      c.emissiveIntensity = 0.5;
      materials.push(c);
      return c;
    };
    o.material = Array.isArray(o.material) ? o.material.map(swap) : swap(o.material);
  });
  const aura = new THREE.Sprite(new THREE.SpriteMaterial({
    map: auraTexture(),
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  }));
  aura.name = 'BossAura';
  aura.renderOrder = -1;
  // (root may be scaled: the aura is sized in world metres)
  const s = root.scale.y || 1;
  aura.position.set(0, (height * 0.55) / s, 0);
  aura.scale.set((height * 1.5) / s, (height * 1.9) / s, 1);
  root.add(aura);
  return {
    update(t) {
      const k = 0.5 + 0.5 * Math.sin(t * 3.2);
      for (const m of materials) m.emissiveIntensity = 0.35 + 0.4 * k;
      aura.material.opacity = 0.45 + 0.3 * k;
    },
    dispose() {
      aura.parent?.remove(aura);
      aura.material.dispose();
      materials.forEach((m) => m.dispose());
      materials.length = 0;
    },
  };
}

// ── Health bar across the top of the screen ──
let hudEl = null;
function bossHud() {
  if (hudEl) return hudEl;
  const el = document.createElement('div');
  el.className = 'boss-health hidden';
  el.setAttribute('aria-live', 'polite');
  el.innerHTML = `
    <div class="boss-health-name"></div>
    <div class="boss-health-track"><div class="boss-health-lag"></div><div class="boss-health-fill"></div></div>`;
  document.body.appendChild(el);
  hudEl = {
    root: el,
    name: el.querySelector('.boss-health-name'),
    fill: el.querySelector('.boss-health-fill'),
    lag: el.querySelector('.boss-health-lag'),
  };
  return hudEl;
}

const bubbleMaterial = () => new THREE.MeshPhongMaterial({
  color: 0x7fd8ff,
  emissive: 0x1a5f8a,
  specular: 0xffffff,
  shininess: 90,
  transparent: true,
  opacity: 0.3,
  depthWrite: false,
  side: THREE.DoubleSide,
});

/**
 * Pemberton: sword, gun, shield and bombs, PEMBERTON_SCALE× tall from the start.
 * ctx: as createBossFighter (without gear / scale).
 */
export function createPembertonBoss(ctx) {
  return createBossFighter({
    ...ctx,
    scale: PEMBERTON_SCALE,
    swordScale: PEMBERTON_SWORD_SCALE,
    bodyHitRadius: PEMBERTON_BODY_HIT_RADIUS,
    bodyHitCenterY: PEMBERTON_BODY_HIT_CENTER_Y,
    gear: { gun: true, shield: true, bombs: true },
  });
}

/**
 * A stage's final enemy, after its talk: waits (passive, can't be hurt) until start(), then
 * grows to STAGE_BOSS_SCALE, glows red and fights with `gear` (stageBossGear in stageBoss.js).
 * ctx: as createBossFighter (without scale); also `gear`.
 */
export function createStageBoss(ctx) {
  return createBossFighter({
    ...ctx,
    scale: STAGE_BOSS_SCALE,
    swordScale: STAGE_BOSS_SWORD_SCALE,
    bodyHitRadius: STAGE_BOSS_BODY_HIT_RADIUS,
    bodyHitCenterY: STAGE_BOSS_BODY_HIT_CENTER_Y,
    autoStart: false,
  });
}

/**
 * @param {object} ctx
 *  enemy                          — the EnemyPlayer, already spawned
 *  name                           — shown over the health bar
 *  gear                           — { gun, shield, wand, bombs, bubble } (booleans)
 *  scale / swordScale             — its size (and its sword's) once fighting
 *  bodyHitRadius / bodyHitCenterY — the player's sword's hit sphere on it (at that size)
 *  autoStart                      — false: waits for start() (see createStageBoss)
 *  wandRange                      — { min, max } kept from the player while casting
 *  getTarget() → THREE.Object3D|null — the player model (null while dead)
 *  getWeaponGear() → { gun, shield } | null — as matchCtx.getWeaponGear (Guns & Bombs)
 *  fireBullet(origin, dir)        — a hostile bullet
 *  throwBomb(origin, target)      — a bomb that can blast the player
 *  onShieldBlock(position)        — its shield / bubble stopped something
 * @returns {{ enemy, start(): void, isStarted(): boolean, update(): void, dispose(): void, isShieldUp(): boolean }}
 */
export function createBossFighter(ctx) {
  const { enemy } = ctx;
  const gear = { gun: false, shield: false, wand: false, bombs: false, bubble: false, ...ctx.gear };
  const scale = ctx.scale ?? 1;
  const swordScale = ctx.swordScale ?? 1;

  let started = false;
  let growFrom = 0;       // performance.now() when start() was called (grow-in)
  let phase = 'sword';
  let phaseUntil = 0;
  let nextShotAt = 0;
  let nextBombAt = 0;
  let held = null;        // { gunMesh, shieldMesh, gripGun, gripShield }
  let wandModel = null;
  let swordParts = null;  // the sword model's meshes (hidden while the wand is out)
  let bubble = null;      // the bubble mesh (child of enemy.group)
  let bubbleUntil = 0;
  let nextBubbleAt = 0;
  let glow = null;
  let disposed = false;
  let hideTimer = null;
  let shownFrac = -1;

  const hud = bossHud();
  const setHud = (frac) => {
    if (frac === shownFrac) return;
    shownFrac = frac;
    hud.fill.style.width = `${frac * 100}%`;
    hud.lag.style.width = `${frac * 100}%`;
    hud.root.classList.toggle('boss-health-low', frac <= 0.3);
  };

  // (body.boss-health-up: the kill counter makes way for the bar — styles.css)
  const hideHud = () => {
    hud.root.classList.add('hidden');
    document.body.classList.remove('boss-health-up');
  };
  const shieldUp = () => phase === 'shield' && !!held && !enemy.isDead;
  const bubbleUp = () => started && !enemy.isDead && performance.now() < bubbleUntil;
  const facesShield = (pos) => {
    if (!pos) return true;
    const g = enemy.group;
    _v.set(pos.x - g.position.x, 0, pos.z - g.position.z);
    if (_v.lengthSq() < 1e-6) return true;
    _v.normalize();
    _v2.set(Math.sin(g.rotation.y), 0, Math.cos(g.rotation.y));
    return _v2.dot(_v) > SHIELD_ARC_DOT;
  };
  // Shield (from in front) or bubble (from anywhere) in the way
  const guarded = (fromPos) => bubbleUp() || (shieldUp() && facesShield(fromPos));

  const raiseBubble = (now) => {
    if (!bubble) {
      bubble = new THREE.Mesh(new THREE.SphereGeometry(BUBBLE_RADIUS, 28, 18), bubbleMaterial());
      bubble.name = 'BossBubble';
      bubble.position.y = BUBBLE_CENTER_Y;
      bubble.renderOrder = 10;
      enemy.group.add(bubble);
    }
    bubble.visible = true;
    bubbleUntil = now + BUBBLE_MS;
    nextBubbleAt = bubbleUntil + randIn(BUBBLE_COOLDOWN_MS);
    window.audioManager?.playSFX?.('SFX/Spells/Waterspray 1.ogg', 0.6, { cooldownKey: 'boss-bubble', cooldownMs: 200 });
  };

  // Shield / bubble stop sword swings, bullets, bombs and blasts; nothing hurts it before start()
  const baseApplyDamage = enemy.applyDamage.bind(enemy);
  enemy.applyDamage = (amount) => {
    if (!started) return false;
    if (guarded(ctx.getTarget()?.position)) {
      ctx.onShieldBlock?.(enemy.group.position);
      return false;
    }
    const killed = baseApplyDamage(amount);
    const now = performance.now();
    if (gear.bubble && !enemy.isDead && now >= nextBubbleAt && Math.random() < BUBBLE_CHANCE) raiseBubble(now);
    return killed;
  };
  const baseBlast = enemy.applyBlastKnockback.bind(enemy);
  enemy.applyBlastKnockback = (opts) => {
    if (!started || shieldUp() || bubbleUp()) return;
    baseBlast(opts);
  };
  const baseDirectKnockback = enemy.applyDirectKnockback.bind(enemy);
  enemy.applyDirectKnockback = (opts) => {
    if (!started || bubbleUp()) return;
    baseDirectKnockback(opts);
  };
  const baseFreeze = enemy.freeze.bind(enemy);
  enemy.freeze = (seconds) => {
    if (!started || bubbleUp()) return;
    baseFreeze(seconds);
  };
  const baseBlocks = enemy.blocksSwing.bind(enemy);
  enemy.blocksSwing = (swingDir, attackerPos) => guarded(attackerPos) || baseBlocks(swingDir, attackerPos);
  const baseBlocksBlast = enemy.blocksBlast.bind(enemy);
  enemy.blocksBlast = (blast) => {
    if (bubbleUp()) return true;
    if (shieldUp() && blast?.forward) {
      // (a blast flying at it from in front: its source is back along `forward`)
      _v.copy(enemy.group.position).addScaledVector(blast.forward, -3);
      if (facesShield(_v)) return true;
    }
    return baseBlocksBlast(blast);
  };
  const baseDestroy = enemy.destroy.bind(enemy);
  enemy.destroy = () => {
    dispose();
    baseDestroy();
  };

  // Gun + shield on the weapon hand (the floating hand the player's Weapon attaches to)
  const attachHeld = () => {
    const g = ctx.getWeaponGear?.();
    if (!g) return false;
    const hand = enemy._leftHandGroup;
    const place = (mesh, kind) => {
      if (!mesh) return null;
      mesh.position.copy(g[kind].offset);
      mesh.quaternion.copy(g[kind].quaternion);
      mesh.visible = false;
      hand.add(mesh);
      return mesh;
    };
    held = {
      gunMesh: gear.gun ? place(g.gun.createMesh(), 'gun') : null,
      shieldMesh: gear.shield ? place(g.shield.createMesh(), 'shield') : null,
      gripGun: g.gun.grip.clone(),
      gripShield: g.shield.grip.clone(),
    };
    return true;
  };

  // Wand out (EnemyPlayer's wand AI casts; enemy.onCast fires the blast) / sword back
  const setWandOut = (on) => {
    if (on && !wandModel) {
      swordParts = enemy._swordGroup.children.filter((c) => c !== enemy._swingGlow);
      wandModel = createWandModel();
      enemy._swordGroup.add(wandModel);
      enemy._wandModel = wandModel;
    }
    if (!wandModel) return;
    wandModel.visible = on;
    swordParts.forEach((c) => { c.visible = !on; });
    enemy.wand = on;
    enemy._cast = null;
    setWandGlow(wandModel, 0);
  };

  const setPhase = (next, now) => {
    if ((next === 'gun' || next === 'shield') && !held && !attachHeld()) next = 'sword';
    phase = next;
    phaseUntil = now + randIn(next === 'gun' ? GUN_MS : next === 'shield' ? SHIELD_MS : next === 'wand' ? WAND_MS : SWORD_MS);
    enemy.ranged = next === 'gun' ? GUN_RANGE : next === 'shield' ? SHIELD_RANGE
      : next === 'wand' ? (ctx.wandRange ?? GUN_RANGE) : null;
    enemy.gripTarget = next === 'gun' ? held.gripGun : next === 'shield' ? held.gripShield : null;
    if (gear.wand) setWandOut(next === 'wand');
    enemy._swordGroup.visible = next === 'sword' || next === 'wand';
    if (held) {
      if (held.gunMesh) held.gunMesh.visible = next === 'gun';
      if (held.shieldMesh) held.shieldMesh.visible = next === 'shield';
    }
    // (a block stance left over from the sword would still stop swings)
    enemy._attackPhase = next === 'sword' ? 'decide' : 'idle';
    if (next === 'gun') {
      nextShotAt = now + 500; // (gun up first)
    }
  };
  // After a sword spell: one of the others it has (Pemberton: gun more often than shield)
  const nextAfterSword = () => {
    if (gear.gun && gear.shield && !gear.wand) return Math.random() < GUN_CHANCE ? 'gun' : 'shield';
    const options = ['gun', 'shield', 'wand'].filter((k) => gear[k]);
    return options.length ? options[Math.floor(Math.random() * options.length)] : 'sword';
  };

  const shoot = (target) => {
    const g = enemy.group;
    g.updateMatrixWorld();
    const origin = g.localToWorld(_v.copy(MUZZLE)).clone();
    const dir = _v2.copy(target.position).setY(target.position.y + PLAYER_CENTER_Y).sub(origin);
    if (dir.lengthSq() < 1e-4) return;
    dir.normalize().applyAxisAngle(_yAxis, (Math.random() * 2 - 1) * SHOT_SPREAD);
    dir.y += (Math.random() * 2 - 1) * SHOT_SPREAD * 0.5;
    ctx.fireBullet(origin, dir.normalize().clone());
  };

  const throwBomb = (target) => {
    const g = enemy.group;
    g.updateMatrixWorld();
    const origin = g.localToWorld(_v.copy(BOMB_HAND)).clone();
    // (a little off: something to dodge, not a sure hit)
    const aim = target.position.clone().add(_v2.set((Math.random() - 0.5) * 1.6, 0, (Math.random() - 0.5) * 1.6));
    ctx.throwBomb(origin, aim);
  };

  // Its size: growing from 1 (k = 0) to `scale` (k = 1)
  const applySize = (k) => {
    const e = k * k * (3 - 2 * k);
    enemy.group.scale.setScalar(1 + (scale - 1) * e);
    enemy._swordGroup.scale.setScalar(1 + (swordScale - 1) * e);
  };

  function start() {
    if (started || disposed) return;
    started = true;
    enemy.script = null;
    enemy._attackPhase = 'decide';
    enemy.bodyHitRadius = ctx.bodyHitRadius;
    enemy.bodyHitCenterY = ctx.bodyHitCenterY;
    const now = performance.now();
    growFrom = ctx.autoStart === false ? now : now - GROW_MS;
    phase = 'sword';
    phaseUntil = now + randIn(SWORD_MS);
    nextBombAt = now + randIn(BOMB_MS);
    nextBubbleAt = 0;
    hud.name.textContent = ctx.name;
    hud.root.classList.remove('hidden', 'boss-health-out');
    document.body.classList.add('boss-health-up');
    shownFrac = -1;
    setHud(1);
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    glow?.dispose();
    glow = null;
    if (bubble) {
      bubble.parent?.remove(bubble);
      bubble.geometry.dispose();
      bubble.material.dispose();
      bubble = null;
    }
    clearTimeout(hideTimer);
    if (started) hideHud();
  }

  if (ctx.autoStart === false) {
    enemy.script = { mode: 'passive' };
  } else {
    applySize(1);
    start();
  }

  return {
    enemy,
    start,
    isStarted: () => started,
    isShieldUp: shieldUp,
    dispose,
    /** Every frame after enemy.update (not while the player is dead). */
    update() {
      if (disposed || !started) return;
      const now = performance.now();
      const grow = Math.min(1, (now - growFrom) / GROW_MS);
      if (grow < 1 || enemy.group.scale.y !== scale) applySize(grow);
      // Glow once the character has loaded (sized for the character at scale 1: grows with it)
      if (!glow && enemy._glbCharacter) glow = addRedGlow(enemy.group, { height: enemy.group.scale.y });
      glow?.update(now / 1000);
      setHud(Math.max(0, enemy.hearts) / Math.max(1, enemy.maxHearts));
      if (bubble) {
        const left = bubbleUntil - now;
        bubble.visible = left > 0 && !enemy.isDead;
        if (bubble.visible) {
          bubble.scale.setScalar(1 + Math.sin(now * 0.006) * 0.03);
          // (blinks in its last second)
          bubble.material.opacity = left < 1000 && Math.floor(left / 150) % 2 === 0 ? 0.1 : 0.3;
        }
      }
      if (enemy.isDead) {
        if (held) {
          if (held.gunMesh) held.gunMesh.visible = false;
          if (held.shieldMesh) held.shieldMesh.visible = false;
        }
        if (!hideTimer) {
          hud.root.classList.add('boss-health-out');
          hideTimer = setTimeout(hideHud, HUD_HIDE_MS);
        }
        return;
      }
      const target = ctx.getTarget();
      if (!target) return;
      const dist = enemy.group.position.distanceTo(target.position);

      if (now >= phaseUntil) {
        if (phase === 'sword') setPhase(nextAfterSword(), now);
        else setPhase('sword', now);
      }
      // (not mid-blast: it's on its back)
      if (enemy._isRagdoll) return;
      if (phase === 'gun' && now >= nextShotAt) {
        nextShotAt = now + randIn(SHOT_MS);
        if (dist <= SHOT_MAX_DIST) shoot(target);
      }
      if (gear.bombs && phase !== 'shield' && now >= nextBombAt) {
        nextBombAt = now + randIn(BOMB_MS);
        if (dist >= BOMB_RANGE[0] && dist <= BOMB_RANGE[1]) throwBomb(target);
      }
    },
  };
}

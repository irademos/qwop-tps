/**
 * Pemberton — the Sword Showdown story's final boss (stage PEMBERTON_STAGE, villageMode.js).
 *
 * An EnemyPlayer (the villager character) PEMBERTON_SCALE× tall, glowing red (addRedGlow,
 * also used on him in the village), with a big health bar across the top of the screen.
 * Mostly fights with his sword, and between sword spells he:
 *   • backs off and shoots the gun (`ranged`, hostile bullets — ctx.fireBullet),
 *   • raises a shield and advances behind it (blocks sword swings, bullets and bombs),
 *   • lobs a bomb now and then when the player is at a distance (ctx.throwBomb).
 * The gun / shield are the player's own models, held like Multiplayer Guns & Bombs bots hold
 * them (ctx.getWeaponGear). Game access goes through `ctx` (see createPembertonBoss).
 */

import * as THREE from 'three';

export const PEMBERTON_SCALE = 1.5;
export const PEMBERTON_HEARTS = 15;
export const PEMBERTON_SWING_CHANCE = 0.55;
const PEMBERTON_SWORD_SCALE = 1.3;
// Body hit sphere for the player's sword (bigger than a normal enemy's 0.65 m at 0.8 m up)
const PEMBERTON_BODY_HIT_RADIUS = 0.85;
const PEMBERTON_BODY_HIT_CENTER_Y = 1.1;

// Phases: 'sword' (the normal sword AI) → 'gun' or 'shield' → back to 'sword'
const SWORD_MS = [6500, 10500];
const GUN_MS = [4000, 6500];
const SHIELD_MS = [2200, 3600];
const GUN_CHANCE = 0.6;              // after a sword spell: gun, else shield
const GUN_RANGE = { min: 6, max: 11 };    // keeps this far away while shooting
const SHIELD_RANGE = { min: 1.4, max: 3.2 }; // walks in behind the shield
const SHOT_MS = [850, 1600];
const SHOT_MAX_DIST = 16;
const SHOT_SPREAD = 0.06;            // radians of aim error
const MUZZLE = new THREE.Vector3(0, 1.0, 0.75); // model space (scaled with him)
const BOMB_MS = [5000, 8500];
const BOMB_RANGE = [4.5, 14];        // only from a distance
const BOMB_HAND = new THREE.Vector3(0, 1.6, 0.3);
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

/**
 * @param {object} ctx
 *  enemy                          — the EnemyPlayer (villager character), already spawned
 *  name                           — shown over the health bar
 *  getTarget() → THREE.Object3D|null — the player model (null while dead)
 *  getWeaponGear() → { gun, shield } | null — as matchCtx.getWeaponGear (Guns & Bombs)
 *  fireBullet(origin, dir)        — a hostile bullet
 *  throwBomb(origin, target)      — a bomb that can blast the player
 *  onShieldBlock(position)        — his shield stopped something
 * @returns {{ enemy, update(): void, dispose(): void, isShieldUp(): boolean }}
 */
export function createPembertonBoss(ctx) {
  const { enemy } = ctx;
  enemy.group.scale.setScalar(PEMBERTON_SCALE);
  enemy._swordGroup.scale.setScalar(PEMBERTON_SWORD_SCALE);
  enemy.bodyHitRadius = PEMBERTON_BODY_HIT_RADIUS;
  enemy.bodyHitCenterY = PEMBERTON_BODY_HIT_CENTER_Y;

  let phase = 'sword';
  let phaseUntil = performance.now() + randIn(SWORD_MS);
  let nextShotAt = 0;
  let nextBombAt = performance.now() + randIn(BOMB_MS);
  let gear = null;        // { gunMesh, shieldMesh, gripGun, gripShield }
  let glow = null;
  let disposed = false;
  let hideTimer = null;
  let shownFrac = -1;

  const hud = bossHud();
  hud.name.textContent = ctx.name;
  hud.root.classList.remove('hidden', 'boss-health-out');
  const setHud = (frac) => {
    if (frac === shownFrac) return;
    shownFrac = frac;
    hud.fill.style.width = `${frac * 100}%`;
    hud.lag.style.width = `${frac * 100}%`;
    hud.root.classList.toggle('boss-health-low', frac <= 0.3);
  };
  setHud(1);

  const shieldUp = () => phase === 'shield' && !!gear && !enemy.isDead;
  const facesShield = (pos) => {
    if (!pos) return true;
    const g = enemy.group;
    _v.set(pos.x - g.position.x, 0, pos.z - g.position.z);
    if (_v.lengthSq() < 1e-6) return true;
    _v.normalize();
    _v2.set(Math.sin(g.rotation.y), 0, Math.cos(g.rotation.y));
    return _v2.dot(_v) > SHIELD_ARC_DOT;
  };

  // The shield stops sword swings, bullets and bombs from in front
  const baseApplyDamage = enemy.applyDamage.bind(enemy);
  enemy.applyDamage = (amount) => {
    const target = ctx.getTarget();
    if (shieldUp() && facesShield(target?.position)) {
      ctx.onShieldBlock?.(enemy.group.position);
      return false;
    }
    return baseApplyDamage(amount);
  };
  const baseBlast = enemy.applyBlastKnockback.bind(enemy);
  enemy.applyBlastKnockback = (opts) => {
    if (shieldUp()) return;
    baseBlast(opts);
  };
  const baseBlocks = enemy.blocksSwing.bind(enemy);
  enemy.blocksSwing = (swingDir, attackerPos) => (shieldUp() && facesShield(attackerPos))
    || baseBlocks(swingDir, attackerPos);
  const baseDestroy = enemy.destroy.bind(enemy);
  enemy.destroy = () => {
    dispose();
    baseDestroy();
  };

  // Gun + shield on the weapon hand (the floating hand the player's Weapon attaches to)
  const attachGear = () => {
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
    gear = {
      gunMesh: place(g.gun.createMesh(), 'gun'),
      shieldMesh: place(g.shield.createMesh(), 'shield'),
      gripGun: g.gun.grip.clone(),
      gripShield: g.shield.grip.clone(),
    };
    return true;
  };

  const setPhase = (next, now) => {
    if (next !== 'sword' && !gear && !attachGear()) next = 'sword';
    phase = next;
    phaseUntil = now + randIn(next === 'gun' ? GUN_MS : next === 'shield' ? SHIELD_MS : SWORD_MS);
    enemy.ranged = next === 'gun' ? GUN_RANGE : next === 'shield' ? SHIELD_RANGE : null;
    enemy.gripTarget = next === 'gun' ? gear.gripGun : next === 'shield' ? gear.gripShield : null;
    enemy._swordGroup.visible = next === 'sword';
    if (gear) {
      if (gear.gunMesh) gear.gunMesh.visible = next === 'gun';
      if (gear.shieldMesh) gear.shieldMesh.visible = next === 'shield';
    }
    if (next === 'sword') {
      enemy._attackPhase = 'decide';
    } else if (next === 'gun') {
      nextShotAt = now + 500; // (gun up first)
    }
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

  function dispose() {
    if (disposed) return;
    disposed = true;
    glow?.dispose();
    glow = null;
    clearTimeout(hideTimer);
    hud.root.classList.add('hidden');
  }

  return {
    enemy,
    isShieldUp: shieldUp,
    dispose,
    /** Every frame after enemy.update (not while the player is dead). */
    update() {
      if (disposed) return;
      const now = performance.now();
      // Glow once the character has loaded
      if (!glow && enemy._glbCharacter) glow = addRedGlow(enemy.group, { height: PEMBERTON_SCALE });
      glow?.update(now / 1000);
      setHud(Math.max(0, enemy.hearts) / Math.max(1, enemy.maxHearts));
      if (enemy.isDead) {
        if (gear) {
          if (gear.gunMesh) gear.gunMesh.visible = false;
          if (gear.shieldMesh) gear.shieldMesh.visible = false;
        }
        if (!hideTimer) {
          hud.root.classList.add('boss-health-out');
          hideTimer = setTimeout(() => hud.root.classList.add('hidden'), HUD_HIDE_MS);
        }
        return;
      }
      const target = ctx.getTarget();
      if (!target) return;
      const dist = enemy.group.position.distanceTo(target.position);

      if (now >= phaseUntil) {
        if (phase === 'sword') setPhase(Math.random() < GUN_CHANCE ? 'gun' : 'shield', now);
        else setPhase('sword', now);
      }
      // (not mid-blast: he's on his back)
      if (enemy._isRagdoll) return;
      if (phase === 'gun' && now >= nextShotAt) {
        nextShotAt = now + randIn(SHOT_MS);
        if (dist <= SHOT_MAX_DIST) shoot(target);
      }
      if (phase !== 'shield' && now >= nextBombAt) {
        nextBombAt = now + randIn(BOMB_MS);
        if (dist >= BOMB_RANGE[0] && dist <= BOMB_RANGE[1]) throwBomb(target);
      }
    },
  };
}

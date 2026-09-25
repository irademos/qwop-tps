/**
 * BombThrowerEnemy — a ranged horde enemy that keeps its distance and lobs
 * bombs at the player.  Bombs use the /assets/props/bomb.glb model and explode
 * on ground contact.  The player can deflect a bomb mid-air by hitting it with
 * the foam sword, sending it back toward the thrower (it homes in and always kills them).
 *
 * Physics: dynamic Rapier capsule (same as EnemyPlayer).
 * Bomb projectiles are purely kinematic (custom gravity, no Rapier body) so
 * we can detect hits easily without adding extra colliders.
 */

import { spawnBloodBurst } from '../combat/bloodEffect.js';
import { spawnExplosion } from '../combat/explosionEffect.js';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { getTerrainHeight } from '../environment/terrainHeight.js';
import { getKnockbackImpulse, getKnockbackMotion } from '../combat/knockback.js';

const _bloodOffset = new THREE.Vector3(0, 0.35, 0); // spray from chest height
const _homeDir = new THREE.Vector3();
const _bubbleCenter = new THREE.Vector3();

// ─── tuning constants ────────────────────────────────────────────────────────

const CAPSULE_RADIUS  = 0.28;
const CAPSULE_HEIGHT  = 1.0;
const PHYS_HALF_HEIGHT = 0.6;
const PHYS_RADIUS      = 0.3;

const PREFERRED_DIST   = 9;    // m — target standoff distance
const MAX_RETREAT_DIST = 14;   // stop retreating once this far
const CHASE_SPEED      = 2.2;  // m/s when too far
const RETREAT_SPEED    = 2.8;  // m/s when too close

const THROW_RANGE_MIN  = 5;    // min distance to throw (don't throw point-blank)
const THROW_RANGE_MAX  = 18;   // max distance to throw
const THROW_COOLDOWN_MS = 6000; // ms between throws
const THROW_WINDUP_MS   = 700;  // pre-throw animation hold
const BOMB_SPEED        = 6;    // m/s initial horizontal speed (slow, readable lob)
const BOMB_GRAVITY      = 8;    // m/s² downward acceleration (low → floaty arc)
const BOMB_SCALE        = 0.55;
const BOMB_EXPLOSION_RADIUS = 2.8;  // m — blast radius for player damage
const BOMB_EXPLOSION_DAMAGE = 3;    // health segments
const BOMB_ENEMY_DAMAGE     = 1;    // hearts taken from enemies caught in the blast
const BOMB_LIFETIME_MS  = 8000;

// Deflect: foam sword hits the bomb in this radius
const DEFLECT_RADIUS    = 0.7;  // m
// Deflected bomb travels back this fast (also used by the foam-sword deflect in bootstrapGameApp)
export const BOMB_DEFLECT_SPEED = 10;

const HEALTH_BAR_DISPLAY_MS = 2000;

// Horizontal unit vector pointing from the blast to `target` (falls back to the bomb's
// travel direction, then a random one, when the target is right on top of it).
function _blastDirection(from, target, fallbackVel = null) {
  const dir = new THREE.Vector3(target.x - from.x, 0, target.z - from.z);
  if (dir.lengthSq() < 1e-4 && fallbackVel) dir.set(fallbackVel.x, 0, fallbackVel.z);
  if (dir.lengthSq() < 1e-4) {
    const a = Math.random() * Math.PI * 2;
    dir.set(Math.cos(a), 0, Math.sin(a));
  }
  return dir.normalize();
}

// 1 at the centre of the blast, easing to 0.6 at its edge
function _blastFalloff(dist) {
  return 1 - 0.4 * THREE.MathUtils.clamp(dist / BOMB_EXPLOSION_RADIUS, 0, 1);
}

// ─── shared GLB cache ────────────────────────────────────────────────────────
let _bombGltfPromise = null;
const _gltfLoader = new GLTFLoader();

function getBombGLTF() {
  if (!_bombGltfPromise) {
    _bombGltfPromise = new Promise((resolve, reject) =>
      _gltfLoader.load('/assets/props/bomb.glb', resolve, undefined, reject)
    );
  }
  return _bombGltfPromise;
}

// ─── BombThrowerEnemy ────────────────────────────────────────────────────────

export class BombThrowerEnemy {
  /**
   * @param {THREE.Scene}   scene
   * @param {object}        rapier        – the RAPIER module
   * @param {object}        rapierWorld   – live Rapier World
   * @param {object}        [options]
   * @param {THREE.Vector3} [options.position]
   * @param {number}        [options.hearts]
   * @param {number}        [options.speedScale]
   * @param {() => object[]} [options.getBlastTargets] – other enemies a blast can hit
   *                          (each needs group, applyDamage and applyBlastKnockback/applyDirectKnockback)
   * @param {(direction: THREE.Vector3, falloff: number) => void} [options.onBlastPlayer]
   *                          – throws the player back when caught in a blast
   */
  constructor(scene, rapier, rapierWorld, options = {}) {
    this.scene       = scene;
    this.rapier      = rapier;
    this.rapierWorld = rapierWorld;
    this.type        = 'bombThrower';

    this.hearts    = options.hearts    ?? 3;
    this.maxHearts = this.hearts;
    this.isDead    = false;
    this.speedScale = options.speedScale ?? 1.0;
    this._getBlastTargets = options.getBlastTargets ?? null;
    this._onBlastPlayer   = options.onBlastPlayer ?? null;

    // Throw state
    this._lastThrowTime = -Infinity;
    this._windupEnd     = 0;      // timestamp when windup finishes → throw
    this._inWindup      = false;

    // Live bomb projectiles: {mesh, vel, spawnTime, deflected, thrower: this}[]
    this._bombs = [];

    // Visual group
    this.group = new THREE.Group();
    this.group.name = 'BombThrowerEnemy';
    const startPos = options.position ?? new THREE.Vector3(5, 0, 5);
    this.group.position.copy(startPos);

    this._buildBody();
    this._buildHealthBar();
    this._buildPhysics(startPos);

    // async GLB load
    getBombGLTF()
      .then(gltf => { this._bombGltf = gltf; })
      .catch(e => console.warn('[BombThrowerEnemy] bomb GLB load error:', e));

    scene.add(this.group);
  }

  // ─── visual body ────────────────────────────────────────────────────────────

  _buildBody() {
    // Distinctive dark capsule so players can tell it apart from sword enemies
    const mat = new THREE.MeshStandardMaterial({ color: 0x1a1a2e, roughness: 0.7, metalness: 0.15 });
    const geo = new THREE.CapsuleGeometry(CAPSULE_RADIUS, CAPSULE_HEIGHT - CAPSULE_RADIUS * 2, 8, 16);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.position.y = CAPSULE_HEIGHT / 2;
    this.group.add(mesh);
    this._bodyMesh = mesh;

    // Throwing arm indicator (bright red sphere held at chest)
    const armMat = new THREE.MeshStandardMaterial({ color: 0xff2200, roughness: 0.5, emissive: 0x440000 });
    const armSphere = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), armMat);
    armSphere.position.set(0.28, CAPSULE_HEIGHT * 0.65, 0.22);
    armSphere.name = 'throwArmIndicator';
    this.group.add(armSphere);
    this._throwArmIndicator = armSphere;
  }

  // ─── health bar ─────────────────────────────────────────────────────────────

  _buildHealthBar() {
    const canvas = document.createElement('canvas');
    canvas.width  = 96;
    canvas.height = 32;
    this._hpCtx     = canvas.getContext('2d');
    this._hpTexture = new THREE.CanvasTexture(canvas);

    const mat = new THREE.MeshBasicMaterial({
      map: this._hpTexture, transparent: true, depthWrite: false, side: THREE.DoubleSide
    });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(0.72, 0.24), mat);
    plane.position.y = CAPSULE_HEIGHT + 0.32;
    plane.visible = false;
    this.group.add(plane);
    this._hpPlane    = plane;
    this._hpShowUntil = 0;
    this._drawHealthBar();
  }

  _drawHealthBar() {
    const ctx = this._hpCtx;
    const W = 96, H = 32, heartSize = 22, gap = 3;
    ctx.clearRect(0, 0, W, H);
    const totalW = this.maxHearts * heartSize + (this.maxHearts - 1) * gap;
    const startX = (W - totalW) / 2;
    ctx.font = `${heartSize}px serif`;
    for (let i = 0; i < this.maxHearts; i++) {
      const x = startX + i * (heartSize + gap);
      ctx.globalAlpha = i < this.hearts ? 1 : 0.22;
      ctx.fillText('💣', x, H - 2);
    }
    ctx.globalAlpha = 1;
    this._hpTexture.needsUpdate = true;
  }

  _showHealthBar() {
    this._drawHealthBar();
    this._hpPlane.visible = true;
    this._hpShowUntil = Date.now() + HEALTH_BAR_DISPLAY_MS;
  }

  // ─── Rapier physics ──────────────────────────────────────────────────────────

  _buildPhysics(pos) {
    const RAPIER = this.rapier;
    const world  = this.rapierWorld;
    const rbDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(pos.x, pos.y + CAPSULE_HEIGHT / 2, pos.z)
      .setLinearDamping(2.5)
      .setAngularDamping(5.0);
    this.rigidBody = world.createRigidBody(rbDesc);
    this.rigidBody.setEnabledRotations(false, true, false, true);
    const colDesc = RAPIER.ColliderDesc.capsule(PHYS_HALF_HEIGHT, PHYS_RADIUS)
      .setFriction(0.5)
      .setRestitution(0.05);
    world.createCollider(colDesc, this.rigidBody);
  }

  // ─── bomb spawning ──────────────────────────────────────────────────────────

  _spawnBomb(targetPos) {
    const origin = this.group.position.clone();
    origin.y += CAPSULE_HEIGHT * 0.75; // throw from chest height

    // Compute initial velocity: aim for apex 1.5 m above midpoint, solve for vy.
    const dx = targetPos.x - origin.x;
    const dz = targetPos.z - origin.z;
    const horizDist = Math.sqrt(dx * dx + dz * dz);
    const horizDir  = new THREE.Vector3(dx / Math.max(0.001, horizDist), 0, dz / Math.max(0.001, horizDist));
    // Time of flight estimate based on horizontal speed
    const tFlight = horizDist / BOMB_SPEED;
    const dy = targetPos.y - origin.y;
    const vy = (dy + 0.5 * BOMB_GRAVITY * tFlight * tFlight) / Math.max(0.001, tFlight);
    const vel = new THREE.Vector3(
      horizDir.x * BOMB_SPEED,
      vy,
      horizDir.z * BOMB_SPEED
    );

    // Visual mesh: GLB if loaded, else bright orange sphere fallback
    let mesh;
    if (this._bombGltf) {
      const gltf = this._bombGltf;
      // Clone materials so each bomb can be independently manipulated
      const bombScene = gltf.scene.clone(true);
      bombScene.scale.setScalar(BOMB_SCALE);
      const group = new THREE.Group();
      group.add(bombScene);
      mesh = group;
    } else {
      const geo = new THREE.SphereGeometry(0.18, 10, 8);
      const mat = new THREE.MeshStandardMaterial({ color: 0xff6600, emissive: 0x331100, roughness: 0.6 });
      mesh = new THREE.Mesh(geo, mat);
    }
    mesh.name = 'EnemyBomb';
    mesh.position.copy(origin);
    this.scene.add(mesh);

    const bomb = {
      mesh,
      vel: vel.clone(),
      spawnTime: Date.now(),
      deflected: false,
      deflectedAt: 0,
      thrower: this,
    };
    this._bombs.push(bomb);

    // Also push to the global registry so the game loop / player sword can check it
    if (!window._enemyBombs) window._enemyBombs = [];
    window._enemyBombs.push(bomb);

    // Flash the throw arm indicator
    this._throwArmIndicator.material.emissive.setHex(0xff4400);
    setTimeout(() => {
      if (this._throwArmIndicator?.material) {
        this._throwArmIndicator.material.emissive.setHex(0x440000);
      }
    }, 300);
  }

  _removeBomb(bomb) {
    if (bomb.mesh?.parent) bomb.mesh.parent.remove(bomb.mesh);
    bomb.mesh?.traverse(obj => {
      if (!obj.isMesh) return;
      obj.geometry?.dispose?.();
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      mats.forEach(m => m?.dispose?.());
    });
    // Remove from local array
    const idx = this._bombs.indexOf(bomb);
    if (idx !== -1) this._bombs.splice(idx, 1);
    // Remove from global registry
    if (window._enemyBombs) {
      const gi = window._enemyBombs.indexOf(bomb);
      if (gi !== -1) window._enemyBombs.splice(gi, 1);
    }
  }

  // Fireball / smoke / shockwave visual + boom on explosion
  _spawnExplosion(pos) {
    const groundY = getTerrainHeight(pos.x, pos.z);
    spawnExplosion(this.scene, pos, { groundY: Number.isFinite(groundY) ? groundY : pos.y });
    window.audioManager?.playSFX?.('SFX/Explosions/Explosion 1.ogg', 0.75, {
      cooldownKey: 'bomb-explode', cooldownMs: 50
    });
  }

  // ─── update (called every frame) ────────────────────────────────────────────

  /**
   * @param {number}         dt              – seconds since last frame
   * @param {THREE.Object3D} targetModel     – player's Three.js group
   * @param {object|null}    targetControls  – PlayerControls
   */
  update(dt, targetModel, targetControls) {
    if (!this.rigidBody) return;

    // ── Sync visual from physics ───────────────────────────────────────────
    const t = this.rigidBody.translation();
    const physY = t.y - (PHYS_HALF_HEIGHT + PHYS_RADIUS);
    const terrainY = getTerrainHeight(t.x, t.z);
    const groupY = Number.isFinite(terrainY) ? Math.max(physY, terrainY) : physY;
    this.group.position.set(t.x, groupY, t.z);

    if (this.isDead) return;

    // ── Health bar billboard ───────────────────────────────────────────────
    if (this._hpPlane.visible && Date.now() > this._hpShowUntil) {
      this._hpPlane.visible = false;
    }

    // ── Update bombs in flight ─────────────────────────────────────────────
    this._updateBombs(dt, targetModel, targetControls);

    if (!targetModel) return;

    // ── Face target ────────────────────────────────────────────────────────
    const dx = targetModel.position.x - this.group.position.x;
    const dz = targetModel.position.z - this.group.position.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist > 0.01) {
      const yaw = Math.atan2(dx, dz);
      this.group.rotation.y = THREE.MathUtils.lerp(this.group.rotation.y, yaw, 1 - Math.exp(-6 * dt));
    }

    // ── Movement: kite at PREFERRED_DIST ──────────────────────────────────
    let velX = 0, velZ = 0;
    const vel = this.rigidBody.linvel();
    if (dist < PREFERRED_DIST - 1) {
      // Too close — retreat
      const speed = RETREAT_SPEED * this.speedScale;
      velX = -(dx / Math.max(0.001, dist)) * speed;
      velZ = -(dz / Math.max(0.001, dist)) * speed;
    } else if (dist > MAX_RETREAT_DIST) {
      // Wandered too far — close up
      const speed = CHASE_SPEED * this.speedScale;
      velX = (dx / Math.max(0.001, dist)) * speed;
      velZ = (dz / Math.max(0.001, dist)) * speed;
    }
    this.rigidBody.setLinvel({ x: velX, y: vel.y, z: velZ }, true);

    // ── Throw logic ────────────────────────────────────────────────────────
    const now = Date.now();
    const cooldownReady = (now - this._lastThrowTime) >= THROW_COOLDOWN_MS;
    const inRange = dist >= THROW_RANGE_MIN && dist <= THROW_RANGE_MAX;

    if (!this._inWindup && cooldownReady && inRange) {
      // Start windup
      this._inWindup  = true;
      this._windupEnd = now + THROW_WINDUP_MS;
      // Windup visual: raise throw arm indicator
      this._throwArmIndicator.position.y = CAPSULE_HEIGHT * 0.85;
    }

    if (this._inWindup && now >= this._windupEnd) {
      this._inWindup = false;
      this._lastThrowTime = now;
      // Lower arm indicator back
      this._throwArmIndicator.position.y = CAPSULE_HEIGHT * 0.65;
      // Aim a bit ahead of where the player currently is (simple lead)
      const lead = 0.4;
      const aimTarget = targetModel.position.clone();
      if (targetControls?.velocity) {
        aimTarget.x += (targetControls.velocity.x ?? 0) * lead;
        aimTarget.z += (targetControls.velocity.z ?? 0) * lead;
      }
      const aimGroundY = getTerrainHeight(aimTarget.x, aimTarget.z);
      if (Number.isFinite(aimGroundY)) aimTarget.y = aimGroundY;
      this._spawnBomb(aimTarget);
    }

    // Windup pulsing visual
    if (this._inWindup) {
      const pulse = Math.sin((now / 1000) * 12) * 0.5 + 0.5;
      this._throwArmIndicator.material.emissive.setRGB(pulse * 0.8, 0, 0);
    }
  }

  _updateBombs(dt, targetModel, targetControls) {
    const now = Date.now();
    for (let i = this._bombs.length - 1; i >= 0; i--) {
      const bomb = this._bombs[i];
      const age = now - bomb.spawnTime;

      if (bomb.deflected && this.group) {
        // Deflected: home straight at the thrower so it always lands the kill
        _homeDir.copy(this.group.position);
        _homeDir.y += CAPSULE_HEIGHT / 2;
        _homeDir.sub(bomb.mesh.position);
        if (_homeDir.lengthSq() > 1e-6) {
          bomb.vel.copy(_homeDir.normalize().multiplyScalar(BOMB_DEFLECT_SPEED));
        }
      } else {
        // Apply gravity
        bomb.vel.y -= BOMB_GRAVITY * dt;
      }

      // Move
      bomb.mesh.position.addScaledVector(bomb.vel, dt);

      // Spin for visual fun
      bomb.mesh.rotation.x += dt * 4;
      bomb.mesh.rotation.z += dt * 2.5;

      // Lifetime check (a deflected bomb always kills its thrower)
      if (age > BOMB_LIFETIME_MS) {
        this._explodeBomb(bomb, bomb.mesh.position.clone(), targetModel, targetControls, bomb.deflected);
        this._removeBomb(bomb);
        i = Math.min(i, this._bombs.length - 1);
        continue;
      }

      // Ground contact
      const groundY = getTerrainHeight(bomb.mesh.position.x, bomb.mesh.position.z);
      if (Number.isFinite(groundY) && bomb.mesh.position.y <= groundY + 0.15) {
        this._explodeBomb(bomb, bomb.mesh.position.clone(), targetModel, targetControls, bomb.deflected);
        this._removeBomb(bomb);
        i = Math.min(i, this._bombs.length - 1);
        continue;
      }

      // Protective bubble: any bomb touching the bubble (from any direction)
      // is deflected back toward the thrower.
      if (!bomb.deflected && targetModel) {
        const bubbleRadius = window.getPlayerBubbleRadius?.() || 0;
        if (bubbleRadius > 0 && window.getPlayerBubbleCenter) {
          const bubbleCenter = window.getPlayerBubbleCenter(_bubbleCenter);
          if (bomb.mesh.position.distanceTo(bubbleCenter) < bubbleRadius + 0.2) {
            this._deflectBombToThrower(bomb, 0.25);
            window.audioManager?.playSFX?.('SFX/Spells/Spell Impact 1.ogg', 0.7, {
              cooldownKey: 'bomb-bubble', cooldownMs: 80
            });
            continue;
          }
        }
      }

      // Shield intercept: if the player has shield equipped and the bomb is
      // close enough, deflect it back toward the thrower instead of exploding.
      if (!bomb.deflected && targetModel) {
        const distToPlayer = bomb.mesh.position.distanceTo(targetModel.position);
        if (distToPlayer < 0.9) {
          const shieldBlocked = typeof window.tryBlockLocalPlayerHitWithShield === 'function' &&
            window.tryBlockLocalPlayerHitWithShield({
              attackerModel: { position: bomb.mesh.position },
              damage: BOMB_EXPLOSION_DAMAGE
            });
          if (shieldBlocked) {
            this._deflectBombToThrower(bomb, 0.25);
            window.audioManager?.playSFX?.('SFX/Attacks/Sword Attacks Hits and Blocks/Sword Impact Hit 3.ogg', 0.7, {
              cooldownKey: 'bomb-shield', cooldownMs: 80
            });
            window._pswShowBlockFlash?.('player');
            continue;
          }
        }
      }

      // Deflected bomb: check if it hit the thrower
      if (bomb.deflected && this.group) {
        const throwerCenter = this.group.position.clone();
        throwerCenter.y += CAPSULE_HEIGHT / 2;
        if (bomb.mesh.position.distanceTo(throwerCenter) < 0.8) {
          // Direct hit on thrower
          this._explodeBomb(bomb, bomb.mesh.position.clone(), null, null, /*hitThrower=*/true);
          this._removeBomb(bomb);
          i = Math.min(i, this._bombs.length - 1);
          continue;
        }
      }
    }
  }

  _deflectBombToThrower(bomb, lift) {
    const throwerPos = this.group.position.clone();
    throwerPos.y += CAPSULE_HEIGHT / 2;
    const deflectDir = throwerPos.sub(bomb.mesh.position).normalize();
    deflectDir.y = lift;
    deflectDir.normalize();
    bomb.vel.copy(deflectDir.multiplyScalar(BOMB_DEFLECT_SPEED));
    bomb.deflected = true;
    bomb.deflectedAt = Date.now();
  }

  _explodeBomb(bomb, pos, targetModel, targetControls, hitThrower = false) {
    this._spawnExplosion(pos);

    if (hitThrower && !this.isDead) {
      // Deflected bomb explodes on the thrower — instant kill
      this.hearts = 0;
      this._die();
    }

    this._blastEnemies(pos);

    // The player's own deflected bomb never hurts them
    if (bomb.deflected || !targetModel) return;
    // Protective bubble: explosions can't hurt or knock back the player
    if (window.isPlayerBubbleActive?.()) return;
    const distToPlayer = pos.distanceTo(targetModel.position);
    if (distToPlayer <= BOMB_EXPLOSION_RADIUS) {
      if (typeof window.localHealth === 'number') {
        window.localHealth = Math.max(0, window.localHealth - BOMB_EXPLOSION_DAMAGE);
      }
      const dir = _blastDirection(pos, targetModel.position, bomb.vel);
      if (this._onBlastPlayer) {
        this._onBlastPlayer(dir, _blastFalloff(distToPlayer));
      } else if (targetControls) {
        targetControls.applyKnockback?.({ direction: dir, strength: 3 });
      }
    }
  }

  // Every other enemy inside the blast radius loses a heart and is thrown back.
  _blastEnemies(pos) {
    const targets = this._getBlastTargets?.();
    if (!targets?.length) return;
    for (const enemy of targets) {
      if (!enemy || enemy === this || enemy.isDead || !enemy.group) continue;
      const dist = pos.distanceTo(enemy.group.position);
      if (dist > BOMB_EXPLOSION_RADIUS) continue;
      const dir = _blastDirection(pos, enemy.group.position);
      enemy.applyDamage?.(BOMB_ENEMY_DAMAGE);
      if (typeof enemy.applyBlastKnockback === 'function') {
        enemy.applyBlastKnockback({ direction: dir, falloff: _blastFalloff(dist) });
      } else {
        enemy.applyDirectKnockback?.({ direction: dir, horizSpeed: 7 * _blastFalloff(dist), upVelocity: 3 });
      }
    }
  }

  // ─── public interface ────────────────────────────────────────────────────────

  applyDamage(amount) {
    if (this.isDead) return false;
    this.hearts = Math.max(0, this.hearts - Math.max(1, amount));
    this._showHealthBar();
    spawnBloodBurst(this.scene, this.getCenterWorldPos().add(_bloodOffset), { groundY: this.group.position.y });
    window.audioManager?.playOuch(`ouch-enemy-${this.group.uuid}`);
    if (this.hearts <= 0) {
      this._die();
      return true;
    }
    return false;
  }

  applyKnockback({ direction, strength = 2 } = {}) {
    if (!direction || !this.rigidBody) return;
    const { impulse } = getKnockbackImpulse(direction, strength);
    const { velocity } = getKnockbackMotion(direction, strength);
    this.rigidBody.applyImpulse({ x: impulse.x, y: impulse.y, z: impulse.z }, true);
    const vel = this.rigidBody.linvel();
    this.rigidBody.setLinvel({ x: velocity.x, y: vel.y, z: velocity.z }, true);
  }

  applyDirectKnockback({ direction, horizSpeed = 6, upVelocity = 2 } = {}) {
    if (!direction || !this.rigidBody) return;
    const vel = this.rigidBody.linvel();
    this.rigidBody.setLinvel(
      { x: direction.x * horizSpeed, y: vel.y + upVelocity, z: direction.z * horizSpeed },
      true
    );
  }

  getCenterWorldPos() {
    return this.group.position.clone().add(new THREE.Vector3(0, CAPSULE_HEIGHT / 2, 0));
  }

  _die() {
    if (this.isDead) return;
    this.isDead = true;
    // Remove all in-flight bombs
    for (let i = this._bombs.length - 1; i >= 0; i--) {
      this._removeBomb(this._bombs[i]);
    }

    // Fade out and destroy
    this.group.traverse(obj => {
      if (obj.isMesh && obj.material) obj.material = obj.material.clone();
    });
    const startMs = Date.now();
    const fadeDur = 1800;
    const group = this.group;
    const tick = () => {
      const t = Math.min(1, (Date.now() - startMs) / fadeDur);
      group.traverse(obj => {
        if (obj.material) { obj.material.transparent = true; obj.material.opacity = 1 - t; }
      });
      if (t < 1) requestAnimationFrame(tick);
      else this.destroy();
    };
    requestAnimationFrame(tick);
  }

  destroy() {
    if (this.group.parent)  this.scene.remove(this.group);
    // Remove any remaining bombs from the scene
    for (const b of this._bombs) {
      if (b.mesh?.parent) b.mesh.parent.remove(b.mesh);
      if (window._enemyBombs) {
        const gi = window._enemyBombs.indexOf(b);
        if (gi !== -1) window._enemyBombs.splice(gi, 1);
      }
    }
    this._bombs = [];
    if (this.rigidBody && this.rapierWorld?.getRigidBody?.(this.rigidBody.handle)) {
      this.rapierWorld.removeRigidBody(this.rigidBody);
      this.rigidBody = null;
    }
  }
}

import * as THREE from "three";
import { CharacterBase, CHARACTER_MOVEMENT } from "./CharacterBase.js";
import { ATTACKS } from "../items/melee.js";
import { getKnockbackImpulse, getKnockbackMotion } from "../knockback.js";
import { BASE_HEALTH_SEGMENTS, clampHealthSegments, getMaxHealthSegments } from "../healthUtils.js";

const AGGRO_RADIUS = 12;
const WANDER_CHANGE_MS = 2000;
const ATTACK_NAME = 'Weapon';
const JUMP_ATTACK_NAME = 'JumpAttack';
const MOVE_FADE = 0.2;
const ATTACK_FADE = 0.1;
const DEFAULT_HEALTH = BASE_HEALTH_SEGMENTS;
const MONSTER_ATTACK = ATTACKS.mutantPunch;
const ATTACK_COOLDOWN_RANGE_MS = [2000, 5000];
const STANDOFF_DISTANCE = 2.5;
const STANDOFF_BUFFER = 0.35;
const STRAFE_SPEED = 1.1;
const STRAFE_OSCILLATION = 0.004;
const ATTACK_LUNGE_DURATION_MS = 280;
const JUMP_ATTACK_CHANCE = 0.22;
const JUMP_ATTACK_DAMAGE_MULTIPLIER = 2.75;
const JUMP_ATTACK_CONTACT_WINDOW = [0.7, 0.9];
const STANDOFF_RETREAT_INTERVAL_MS = 2000;
const HEALTH_BAR_HEIGHT = 14;
const HEALTH_BAR_PADDING = 4;
const HEALTH_BAR_SEGMENT_WIDTH = 10;
const HEALTH_BAR_SEGMENT_GAP = 2;
const HEALTH_BAR_DISPLAY_MS = 1800;
const HEALTH_BAR_OFFSET_Y = 2.2;
const HEALTH_BAR_SCALE = new THREE.Vector3(1.2, 0.18, 1);
const LEVEL_SIZE_STEP = 0.5;
const LEVEL_SPEED_STEP = 0.08;
const MONSTER_RUN_SPEED_OFFSET = 1.8;
const DEATH_REMOVAL_DELAY_MS = 15000;
const FRIENDLY_APPROACH_BLEND = 0.07;
const FRIENDLY_DRIFT_LEVEL_SPEED_STEP = 0.06;
const FRIENDLY_DRIFT_MIN_MULTIPLIER = 0.45;
const FRIENDLY_DRIFT_AVOID_RADIUS = 8;
const FRIENDLY_DRIFT_AVOID_HARD_RADIUS = 3;
const FRIENDLY_DRIFT_AVOID_MIN_FACTOR = 0.02;
const ENEMY_DISENGAGE_RADIUS = 22;

export class MonsterCharacter extends CharacterBase {
  constructor({ model, mixer, actions }) {
    super(model);
    this.mixer = mixer;
    this.actions = actions;
    this.currentAction = "Idle";
    this.model.userData.currentAction = "Idle";
    this.model.userData.actions = actions;
    this.model.userData.mixer = mixer;
    this.model.userData.mode = "friendly";
    this.model.userData.direction = new THREE.Vector3();
    this.model.userData.isKnocked = false;
    this.pivot = this.model?.userData?.pivot ?? this.model;
    this.baseScale = this.pivot.scale.clone();
    this.model.userData.health = DEFAULT_HEALTH;
    this.health = DEFAULT_HEALTH;
    this.maxHealth = DEFAULT_HEALTH;
    this.level = 1;
    this.sizeScale = 1;
    this.speedMultiplier = 1;
    this.attackDamage = MONSTER_ATTACK.damage;
    this.type = null;
    this.version = 0;
    this.isDead = false;
    this.deathTime = null;
    this.lastDirectionChange = Date.now();
    this.lastAttackTime = 0;
    this.nextAttackTime = 0;
    this.attackStartTime = null;
    this.attackHasHit = false;
    this.attackAnimationName = ATTACK_NAME;
    this.isKnocked = false;
    this.knockbackEndTime = 0;
    this.knockbackVelocity = new THREE.Vector3();
    this.freezeEndTime = 0;
    this.attackDirection = new THREE.Vector3();
    this.attackLungeEndTime = 0;
    this.lastStandoffRetreatTime = 0;
    this.healthBar = this.createHealthBar();
    this.healthBarVisibleUntil = 0;
    this.backgroundMode = false;
    this.setLevel(1, { preserveHealth: false });
  }

  get body() {
    return this.model?.userData?.rb ?? null;
  }

  setMode(mode) {
    if (!mode) return;
    this.model.userData.mode = mode;
  }

  setDirection(vec) {
    this.model.userData.direction.copy(vec);
  }

  setBackgroundMode(enabled) {
    this.backgroundMode = !!enabled;
    if (this.backgroundMode) {
      this.attackStartTime = null;
      this.attackHasHit = false;
      this.attackAnimationName = ATTACK_NAME;
    }
  }

  syncBodyFromTransform({ zeroVelocity = true } = {}) {
    const body = this.body;
    if (!body || !this.model) return;
    body.setTranslation({
      x: this.model.position.x,
      y: this.model.position.y,
      z: this.model.position.z
    }, true);
    body.setRotation(this.model.quaternion, true);
    if (zeroVelocity) {
      body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }
  }

  setHorizontalMovement(direction, speed, delta = 0) {
    const dir = direction?.clone ? direction.clone() : new THREE.Vector3();
    dir.y = 0;
    if (dir.lengthSq() > 0.000001) {
      dir.normalize();
    }
    const movement = dir.multiplyScalar(Math.max(0, speed || 0));
    const body = this.body;
    if (body?.isDynamic?.()) {
      const vel = body.linvel();
      body.setLinvel({ x: movement.x, y: vel.y, z: movement.z }, true);
      return;
    }
    const dt = Number.isFinite(delta) ? Math.max(0, delta) : 0;
    const nextPosition = this.model.position.clone().addScaledVector(movement, dt);
    if (body?.setNextKinematicTranslation) {
      body.setNextKinematicTranslation({ x: nextPosition.x, y: nextPosition.y, z: nextPosition.z });
    } else if (body?.setTranslation) {
      body.setTranslation({ x: nextPosition.x, y: nextPosition.y, z: nextPosition.z }, true);
    }
    this.model.position.copy(nextPosition);
  }

  faceDirection(direction) {
    if (!direction || direction.lengthSq() <= 0.000001) return;
    const angle = Math.atan2(direction.x, direction.z);
    const rot = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, angle, 0));
    const body = this.body;
    if (body?.setRotation) {
      body.setRotation(rot, true);
    }
    this.model.quaternion.copy(rot);
  }

  applyDamage(amount) {
    if (this.isDead) return;
    const damage = Number.isFinite(amount) ? Math.max(0, Math.round(amount)) : 0;
    this.health = Math.max(0, this.health - damage);
    this.model.userData.health = this.health;
    this.showHealthBar();
    if (this.health <= 0) {
      this.markDead();
      return true;
    }
    this.playAnimation("Hit", MOVE_FADE);
    return false;
  }

  applyFreeze(durationMs = 5000) {
    if (this.isDead) return;
    const duration = Number.isFinite(durationMs) ? durationMs : 5000;
    const now = Date.now();
    this.freezeEndTime = Math.max(this.freezeEndTime || 0, now + duration);
  }

  isFrozen() {
    return Date.now() < (this.freezeEndTime || 0);
  }

  markDead() {
    if (this.isDead) return;
    this.isDead = true;
    this.deathTime = Date.now();
    this.model.userData.mode = "dead";
    this.playAnimation("Death", MOVE_FADE);
    const body = this.body;
    if (body) {
      const vel = body.linvel();
      body.setLinvel({ x: 0, y: vel.y, z: 0 }, true);
    }
  }

  resetHealth() {
    this.health = this.maxHealth;
    this.model.userData.health = this.maxHealth;
    this.isDead = false;
    this.deathTime = null;
  }

  setLevel(level, { preserveHealth = true } = {}) {
    const nextLevel = Math.max(1, Math.round(level || 1));
    this.level = nextLevel;
    this.model.userData.level = nextLevel;
    this.sizeScale = 1 + LEVEL_SIZE_STEP * (nextLevel - 1);
    this.speedMultiplier = Math.max(0.6, 1 - LEVEL_SPEED_STEP * (nextLevel - 1));
    this.attackDamage = Math.max(1, Math.round(MONSTER_ATTACK.damage * this.sizeScale));
    this.maxHealth = getMaxHealthSegments(nextLevel);
    this.model.userData.maxHealth = this.maxHealth;
    if (this.pivot?.scale) {
      this.pivot.scale.set(
        this.baseScale.x * this.sizeScale,
        this.baseScale.y * this.sizeScale,
        this.baseScale.z * this.sizeScale
      );
    }
    this.updateHealthBarScale();
    if (!preserveHealth) {
      this.health = this.maxHealth;
      this.model.userData.health = this.maxHealth;
    } else {
      this.health = clampHealthSegments(this.health, this.level);
      this.model.userData.health = this.health;
    }
    this.updateHealthBarTexture();
  }

  getFriendlyDriftSpeedMultiplier() {
    return Math.max(
      FRIENDLY_DRIFT_MIN_MULTIPLIER,
      1 - FRIENDLY_DRIFT_LEVEL_SPEED_STEP * (this.level - 1)
    );
  }

  applyKnockback({ direction, strength } = {}) {
    if (!direction) return;
    const body = this.body;
    if (!body) return;
    const { impulse, profile } = getKnockbackImpulse(direction, strength);
    const { velocity } = getKnockbackMotion(direction, strength);
    body.applyImpulse({ x: impulse.x, y: impulse.y, z: impulse.z }, true);
    const vel = body.linvel();
    body.setLinvel({ x: velocity.x, y: vel.y, z: velocity.z }, true);
    this.knockbackVelocity.copy(velocity);
    const now = Date.now();
    this.knockbackEndTime = Math.max(this.knockbackEndTime || 0, now + profile.recoveryMs);
    this.isKnocked = true;
    this.model.userData.isKnocked = true;
    this.attackStartTime = null;
    this.attackHasHit = false;
    this.attackAnimationName = ATTACK_NAME;
  }

  applyPersistedState(data = {}) {
    const incomingVersion = Number.isFinite(data.version) ? data.version : null;
    if (incomingVersion != null && Number.isFinite(this.version) && incomingVersion < this.version) {
      return false;
    }
    if (incomingVersion != null) {
      this.version = incomingVersion;
    }
    if (Number.isFinite(data.level)) {
      this.setLevel(data.level, { preserveHealth: true });
    }
    if (Number.isFinite(data.hp)) {
      const previousHealth = this.health;
      this.health = clampHealthSegments(data.hp, this.level);
      this.model.userData.health = this.health;
      if (this.health < previousHealth) {
        this.showHealthBar();
      }
    }
    const aliveFlag = data.alive;
    if (aliveFlag === false || (Number.isFinite(data.hp) && data.hp <= 0)) {
      this.markDead();
    } else if (aliveFlag === true && this.isDead) {
      this.isDead = false;
      this.deathTime = null;
      this.model.userData.mode = "friendly";
      this.playAnimation("Idle", MOVE_FADE);
    }
    return true;
  }

  shouldRemoveAfterDeath(now = Date.now()) {
    if (!this.isDead || !Number.isFinite(this.deathTime)) return false;
    return now - this.deathTime >= DEATH_REMOVAL_DELAY_MS;
  }

  getFriendlyDriftAvoidanceFactor(closestPlayer, context = {}) {
    const zones = Array.isArray(context.friendlyAvoidanceZones)
      ? context.friendlyAvoidanceZones
      : [];
    if (!closestPlayer?.model || zones.length === 0) {
      return 1;
    }

    let nearestZoneDistance = Infinity;
    for (const zonePos of zones) {
      if (!zonePos) continue;
      const dist = closestPlayer.model.position.distanceTo(zonePos);
      if (dist < nearestZoneDistance) {
        nearestZoneDistance = dist;
      }
    }

    if (!Number.isFinite(nearestZoneDistance)) {
      return 1;
    }
    if (nearestZoneDistance <= FRIENDLY_DRIFT_AVOID_HARD_RADIUS) {
      return FRIENDLY_DRIFT_AVOID_MIN_FACTOR;
    }
    if (nearestZoneDistance >= FRIENDLY_DRIFT_AVOID_RADIUS) {
      return 1;
    }

    const normalized = (nearestZoneDistance - FRIENDLY_DRIFT_AVOID_HARD_RADIUS)
      / (FRIENDLY_DRIFT_AVOID_RADIUS - FRIENDLY_DRIFT_AVOID_HARD_RADIUS);
    return Math.max(FRIENDLY_DRIFT_AVOID_MIN_FACTOR, normalized);
  }

  updateAI(deltaTime, playerModel, otherPlayers, context = {}) {
    const now = Date.now();
    if (!this.model) return;
    const body = this.body;
    if (!body) return;

    const delta = Number.isFinite(deltaTime) ? deltaTime : 0;
    if (this.isDead) {
      this.update(delta);
      return;
    }
    if (this.isFrozen()) {
      if (body) {
        const vel = body.linvel();
        body.setLinvel({ x: 0, y: vel.y, z: 0 }, true);
      }
      this.playAnimation("Idle", MOVE_FADE);
      this.update(delta);
      return;
    }
    if (this.isKnocked) {
      if (now >= this.knockbackEndTime) {
        this.isKnocked = false;
        this.model.userData.isKnocked = false;
        this.knockbackVelocity.set(0, 0, 0);
      } else {
        const vel = body.linvel();
        body.setLinvel({ x: this.knockbackVelocity.x, y: vel.y, z: this.knockbackVelocity.z }, true);
        this.update(delta);
        return;
      }
    }

    const allPlayers = [
      { id: 'local', model: playerModel },
      ...Object.entries(otherPlayers).map(([id, p]) => ({ id, model: p.model }))
    ].filter(entry => entry.model);

    let closestPlayer = null;
    let closestDistance = Infinity;

    for (const player of allPlayers) {
      const dist = this.model.position.distanceTo(player.model.position);
      if (dist < closestDistance) {
        closestDistance = dist;
        closestPlayer = player;
      }
    }

    if (!closestPlayer) {
      this.playAnimation("Idle", MOVE_FADE);
      this.update(delta);
      return;
    }

    if (this.model.userData.mode === "friendly" && closestDistance < AGGRO_RADIUS) {
      this.model.userData.mode = "enemy";
    }

    if (this.model.userData.mode === "enemy" && closestDistance > ENEMY_DISENGAGE_RADIUS) {
      this.model.userData.mode = "friendly";
      this.attackStartTime = null;
      this.attackHasHit = false;
      this.attackAnimationName = ATTACK_NAME;
    }

    if (this.model.userData.mode === "friendly") {
      if (now - this.lastDirectionChange > WANDER_CHANGE_MS) {
        this.setDirection(new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5).normalize());
        this.lastDirectionChange = now;
      }
      const wanderDirection = this.model.userData.direction.clone();
      const shouldDriftToClosestPlayer = context.enableFriendlyDrift !== false;
      if (shouldDriftToClosestPlayer) {
        const approachDirection = closestPlayer.model.position
          .clone()
          .sub(this.model.position)
          .setY(0);
        if (approachDirection.lengthSq() > 0.0001) {
          approachDirection.normalize();
          const avoidFactor = this.getFriendlyDriftAvoidanceFactor(closestPlayer, context);
          const approachBlend = FRIENDLY_APPROACH_BLEND * avoidFactor;
          wanderDirection.lerp(approachDirection, approachBlend).normalize();
          this.setDirection(wanderDirection);
        }
      }
      this.setHorizontalMovement(
        this.model.userData.direction,
        CHARACTER_MOVEMENT.walkSpeed
          * this.speedMultiplier
          * this.getFriendlyDriftSpeedMultiplier(),
        delta
      );
      this.faceDirection(this.model.userData.direction);
      this.playAnimation("Walk", MOVE_FADE);
      this.update(delta);
      return;
    }

    this.updateCombatAI(delta, closestPlayer, allPlayers, (player, hitContext = {}) => {
      const damage = Number.isFinite(hitContext.damage)
        ? Math.max(1, Math.round(hitContext.damage))
        : this.attackDamage;
      const localControls = window.playerControls;
      if (localControls?.isInvincible && Date.now() >= (localControls.invincibleUntil || 0)) {
        localControls.isInvincible = false;
        localControls.invincibleUntil = 0;
      }
      const isInvincible = localControls?.isInvincible && Date.now() < (localControls.invincibleUntil || 0);
      if (player.id === 'local' && !localControls?.isKnocked && !isInvincible) {
        window.localHealth = Math.max(0, window.localHealth - damage);
        if (localControls) {
          localControls.applyKnockback({
            direction: this.model.userData.direction.clone(),
            strength: MONSTER_ATTACK.knockbackStrength
          });
        }
      } else if (player.id !== 'local') {
        const op = otherPlayers[player.id];
        if (op) {
          const current = Number.isFinite(op.health) ? op.health : BASE_HEALTH_SEGMENTS;
          op.health = Math.max(0, current - damage);
        }
      }
    });
  }

  updateCombatAI(deltaTime, primaryTarget, targets, onHit) {
    const now = Date.now();
    if (!this.model) return;
    const body = this.body;
    if (!body && !this.backgroundMode) return;

    const delta = Number.isFinite(deltaTime) ? deltaTime : 0;
    if (this.isDead) {
      this.update(delta);
      return;
    }
    if (this.isFrozen()) {
      this.setHorizontalMovement(new THREE.Vector3(), 0, delta);
      this.playAnimation("Idle", MOVE_FADE);
      this.update(delta);
      return;
    }
    if (this.isKnocked) {
      if (now >= this.knockbackEndTime) {
        this.isKnocked = false;
        this.model.userData.isKnocked = false;
        this.knockbackVelocity.set(0, 0, 0);
      } else {
        const vel = body.linvel();
        body.setLinvel({ x: this.knockbackVelocity.x, y: vel.y, z: this.knockbackVelocity.z }, true);
        this.update(delta);
        return;
      }
    }

    if (!primaryTarget?.model) {
      this.playAnimation("Idle", MOVE_FADE);
      this.update(delta);
      return;
    }

    const targetPos = primaryTarget.model.position.clone();
    const distance = this.model.position.distanceTo(targetPos);
    const attackRange = MONSTER_ATTACK.range;
    const canAttack = !this.attackStartTime && now >= this.nextAttackTime;
    const runSpeed = (CHARACTER_MOVEMENT.runSpeed - MONSTER_RUN_SPEED_OFFSET) * this.speedMultiplier;
    const walkSpeed = CHARACTER_MOVEMENT.walkSpeed * this.speedMultiplier;

    if (this.attackStartTime) {
      if (now < this.attackLungeEndTime) {
        this.setHorizontalMovement(
          this.attackDirection,
          (CHARACTER_MOVEMENT.runSpeed + 0.75) * this.speedMultiplier,
          delta
        );
      } else {
        this.setHorizontalMovement(new THREE.Vector3(), 0, delta);
      }
      this.faceDirection(this.attackDirection);
    } else if (distance > STANDOFF_DISTANCE + STANDOFF_BUFFER) {
      const direction = targetPos.sub(this.model.position).normalize();
      this.setDirection(direction);
      this.setHorizontalMovement(this.model.userData.direction, runSpeed, delta);
      this.faceDirection(this.model.userData.direction);
      this.playAnimation("Run", MOVE_FADE);
    } else {
      const faceDir = targetPos.sub(this.model.position).normalize();
      this.setDirection(faceDir);
      const strafeDir = new THREE.Vector3(-faceDir.z, 0, faceDir.x);
      const strafeOffset = Math.sin(now * STRAFE_OSCILLATION) * STRAFE_SPEED * this.speedMultiplier;
      let forwardSpeed = 0;
      if (distance < STANDOFF_DISTANCE - STANDOFF_BUFFER) {
        if (now - this.lastStandoffRetreatTime >= STANDOFF_RETREAT_INTERVAL_MS) {
          forwardSpeed = -walkSpeed;
          this.lastStandoffRetreatTime = now;
        }
      } else if (distance > STANDOFF_DISTANCE + STANDOFF_BUFFER) {
        forwardSpeed = walkSpeed;
      }
      const movement = faceDir.clone().multiplyScalar(forwardSpeed).add(strafeDir.multiplyScalar(strafeOffset));
      this.setHorizontalMovement(movement, 1, delta);
      this.faceDirection(faceDir);
      if (canAttack && distance <= STANDOFF_DISTANCE + 0.5) {
        this.attackDirection.copy(faceDir);
        this.setDirection(this.attackDirection);
        const useJumpAttack = this.actions?.[JUMP_ATTACK_NAME] && Math.random() < JUMP_ATTACK_CHANCE;
        this.attackAnimationName = useJumpAttack ? JUMP_ATTACK_NAME : ATTACK_NAME;
        this.playAnimation(this.attackAnimationName, ATTACK_FADE);
        this.lastAttackTime = now;
        this.attackStartTime = now;
        this.attackHasHit = false;
        this.attackLungeEndTime = now + ATTACK_LUNGE_DURATION_MS;
        this.nextAttackTime = now + THREE.MathUtils.randInt(...ATTACK_COOLDOWN_RANGE_MS);
      } else {
        this.playAnimation("Walk", MOVE_FADE);
      }
    }

    this.update(delta);

    if (this.attackStartTime) {
      const elapsed = now - this.attackStartTime;
      const currentAction = this.attackAnimationName || ATTACK_NAME;
      const actionClip = this.actions?.[currentAction]?.getClip?.();
      const durationMs = Number.isFinite(actionClip?.duration) ? actionClip.duration * 1000 : 0;
      const isJumpAttack = currentAction === JUMP_ATTACK_NAME;
      const hitStart = isJumpAttack && durationMs > 0
        ? durationMs * JUMP_ATTACK_CONTACT_WINDOW[0]
        : MONSTER_ATTACK.hitTime;
      const hitEnd = isJumpAttack && durationMs > 0
        ? durationMs * JUMP_ATTACK_CONTACT_WINDOW[1]
        : MONSTER_ATTACK.hitTime + MONSTER_ATTACK.hitWindow;

      if (!this.attackHasHit && elapsed >= hitStart && elapsed <= hitEnd) {
        const hitTargets = Array.isArray(targets) && targets.length ? targets : [primaryTarget];
        const hitDamage = isJumpAttack
          ? this.attackDamage * JUMP_ATTACK_DAMAGE_MULTIPLIER
          : this.attackDamage;
        hitTargets.forEach((target) => {
          if (!target?.model) return;
          const dist = this.model.position.distanceTo(target.model.position);
          if (dist <= attackRange) {
            onHit?.(target, {
              direction: this.model.userData.direction.clone(),
              strength: MONSTER_ATTACK.knockbackStrength,
              damage: hitDamage,
              attackName: currentAction
            });
          }
        });
        this.attackHasHit = true;
      }
      if (elapsed > hitEnd) {
        this.attackStartTime = null;
        this.attackHasHit = false;
        this.attackAnimationName = ATTACK_NAME;
      }
    }
  }

  update(delta) {
    super.update(delta);
    this.updateHealthBarVisibility();
  }

  createHealthBar() {
    const canvas = document.createElement('canvas');
    const segmentCount = Math.max(1, Math.round(this.maxHealth || DEFAULT_HEALTH));
    canvas.width = HEALTH_BAR_PADDING * 2
      + segmentCount * HEALTH_BAR_SEGMENT_WIDTH
      + Math.max(0, segmentCount - 1) * HEALTH_BAR_SEGMENT_GAP;
    canvas.height = HEALTH_BAR_HEIGHT;
    const context = canvas.getContext('2d');
    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthWrite: false
    });
    const sprite = new THREE.Sprite(material);
    sprite.position.set(0, HEALTH_BAR_OFFSET_Y, 0);
    sprite.scale.copy(HEALTH_BAR_SCALE);
    sprite.visible = false;
    sprite.userData.canvas = canvas;
    sprite.userData.context = context;
    sprite.userData.texture = texture;
    sprite.userData.baseScale = HEALTH_BAR_SCALE.clone();
    sprite.userData.baseOffset = HEALTH_BAR_OFFSET_Y;
    this.updateHealthBarTexture();
    this.model.add(sprite);
    return sprite;
  }

  updateHealthBarTexture() {
    if (!this.healthBar) return;
    const context = this.healthBar.userData.context;
    if (!context) return;
    const canvas = this.healthBar.userData.canvas;
    const maxHealth = this.maxHealth || DEFAULT_HEALTH;
    const clampedHealth = Math.max(0, Math.min(maxHealth, this.health));
    const segmentCount = Math.max(1, Math.round(maxHealth));
    const width = HEALTH_BAR_PADDING * 2
      + segmentCount * HEALTH_BAR_SEGMENT_WIDTH
      + Math.max(0, segmentCount - 1) * HEALTH_BAR_SEGMENT_GAP;
    if (canvas.width !== width || canvas.height !== HEALTH_BAR_HEIGHT) {
      canvas.width = width;
      canvas.height = HEALTH_BAR_HEIGHT;
    }
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = 'rgba(0, 0, 0, 0.6)';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = 'rgba(60, 60, 60, 0.8)';
    context.fillRect(2, 2, canvas.width - 4, canvas.height - 4);
    for (let i = 0; i < segmentCount; i += 1) {
      const x = HEALTH_BAR_PADDING + i * (HEALTH_BAR_SEGMENT_WIDTH + HEALTH_BAR_SEGMENT_GAP);
      context.fillStyle = i < clampedHealth ? 'rgba(214, 53, 60, 0.9)' : 'rgba(80, 80, 80, 0.85)';
      context.fillRect(x, 4, HEALTH_BAR_SEGMENT_WIDTH, canvas.height - 8);
    }
    this.healthBar.userData.texture.needsUpdate = true;
  }

  showHealthBar() {
    if (!this.healthBar) return;
    this.updateHealthBarTexture();
    this.healthBar.visible = true;
    this.healthBarVisibleUntil = Date.now() + HEALTH_BAR_DISPLAY_MS;
  }

  updateHealthBarScale() {
    if (!this.healthBar) return;
    const scale = this.sizeScale || 1;
    const baseScale = this.healthBar.userData.baseScale || HEALTH_BAR_SCALE;
    const baseOffset = this.healthBar.userData.baseOffset ?? HEALTH_BAR_OFFSET_Y;
    const segmentScale = (this.maxHealth || DEFAULT_HEALTH) / BASE_HEALTH_SEGMENTS;
    this.healthBar.position.set(0, baseOffset * scale, 0);
    this.healthBar.scale.set(baseScale.x * scale * segmentScale, baseScale.y * scale, baseScale.z);
  }

  updateHealthBarVisibility() {
    if (!this.healthBar) return;
    if (this.healthBar.visible && Date.now() > this.healthBarVisibleUntil) {
      this.healthBar.visible = false;
    }
  }
}

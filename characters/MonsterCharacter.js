import * as THREE from "three";
import { CharacterBase, CHARACTER_MOVEMENT } from "./CharacterBase.js";
import { ATTACKS } from "../melee.js";
import { getKnockbackImpulse } from "../knockback.js";

const AGGRO_RADIUS = 12;
const WANDER_CHANGE_MS = 2000;
const ATTACK_NAME = 'Weapon';
const MOVE_FADE = 0.2;
const ATTACK_FADE = 0.1;
const DEFAULT_HEALTH = 100;
const MONSTER_ATTACK = ATTACKS.mutantPunch;
const ATTACK_COOLDOWN_RANGE_MS = [2000, 5000];
const STANDOFF_DISTANCE = 2.5;
const STANDOFF_BUFFER = 0.35;
const STRAFE_SPEED = 1.1;
const STRAFE_OSCILLATION = 0.004;
const ATTACK_LUNGE_DURATION_MS = 280;
const STANDOFF_RETREAT_INTERVAL_MS = 2000;
const HEALTH_BAR_WIDTH = 128;
const HEALTH_BAR_HEIGHT = 14;
const HEALTH_BAR_DISPLAY_MS = 1800;
const HEALTH_BAR_OFFSET_Y = 2.2;
const HEALTH_BAR_SCALE = new THREE.Vector3(1.2, 0.18, 1);
const LEVEL_SIZE_STEP = 0.5;
const LEVEL_SPEED_STEP = 0.08;

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
    this.lastDirectionChange = Date.now();
    this.lastAttackTime = 0;
    this.nextAttackTime = 0;
    this.attackStartTime = null;
    this.attackHasHit = false;
    this.isKnocked = false;
    this.knockbackEndTime = 0;
    this.freezeEndTime = 0;
    this.attackDirection = new THREE.Vector3();
    this.attackLungeEndTime = 0;
    this.lastStandoffRetreatTime = 0;
    this.healthBar = this.createHealthBar();
    this.healthBarVisibleUntil = 0;
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

  applyDamage(amount) {
    if (this.isDead) return;
    this.health = Math.max(0, this.health - amount);
    this.model.userData.health = this.health;
    this.showHealthBar();
    if (this.health <= 0) {
      this.markDead();
      return true;
    }
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
  }

  setLevel(level, { preserveHealth = true } = {}) {
    const nextLevel = Math.max(1, Math.round(level || 1));
    this.level = nextLevel;
    this.model.userData.level = nextLevel;
    this.sizeScale = 1 + LEVEL_SIZE_STEP * (nextLevel - 1);
    this.speedMultiplier = Math.max(0.6, 1 - LEVEL_SPEED_STEP * (nextLevel - 1));
    this.attackDamage = MONSTER_ATTACK.damage * this.sizeScale;
    this.maxHealth = DEFAULT_HEALTH * this.sizeScale;
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
    } else if (this.health > this.maxHealth) {
      this.health = this.maxHealth;
      this.model.userData.health = this.maxHealth;
    }
    this.updateHealthBarTexture();
  }

  applyKnockback({ direction, strength } = {}) {
    if (!direction) return;
    const body = this.body;
    if (!body) return;
    const { impulse, profile } = getKnockbackImpulse(direction, strength);
    body.applyImpulse({ x: impulse.x, y: impulse.y, z: impulse.z }, true);
    const now = Date.now();
    this.knockbackEndTime = Math.max(this.knockbackEndTime || 0, now + profile.recoveryMs);
    this.isKnocked = true;
    this.attackStartTime = null;
    this.attackHasHit = false;
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
      this.health = data.hp;
      this.model.userData.health = data.hp;
      if (data.hp < previousHealth) {
        this.showHealthBar();
      }
    }
    const aliveFlag = data.alive;
    if (aliveFlag === false || (Number.isFinite(data.hp) && data.hp <= 0)) {
      this.markDead();
    } else if (aliveFlag === true && this.isDead) {
      this.isDead = false;
      this.model.userData.mode = "friendly";
      this.playAnimation("Idle", MOVE_FADE);
    }
    return true;
  }

  updateAI(deltaTime, playerModel, otherPlayers) {
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
      } else {
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

    if (this.model.userData.mode === "friendly") {
      if (now - this.lastDirectionChange > WANDER_CHANGE_MS) {
        this.setDirection(new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5).normalize());
        this.lastDirectionChange = now;
      }
      const movement = this.model.userData.direction
        .clone()
        .multiplyScalar(CHARACTER_MOVEMENT.walkSpeed * this.speedMultiplier);
      const vel = body.linvel();
      body.setLinvel({ x: movement.x, y: vel.y, z: movement.z }, true);
      const angle = Math.atan2(this.model.userData.direction.x, this.model.userData.direction.z);
      const rot = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, angle, 0));
      body.setRotation(rot, true);
      this.playAnimation("Walk", MOVE_FADE);
      this.update(delta);
      return;
    }

    const targetPos = closestPlayer.model.position.clone();
    const distance = this.model.position.distanceTo(targetPos);
    const attackRange = MONSTER_ATTACK.range;
    const canAttack = !this.attackStartTime && now >= this.nextAttackTime;
    const runSpeed = (CHARACTER_MOVEMENT.runSpeed - 1.5) * this.speedMultiplier;
    const walkSpeed = CHARACTER_MOVEMENT.walkSpeed * this.speedMultiplier;

    if (this.attackStartTime) {
      const vel = body.linvel();
      if (now < this.attackLungeEndTime) {
        const movement = this.attackDirection
          .clone()
          .multiplyScalar((CHARACTER_MOVEMENT.runSpeed + 0.75) * this.speedMultiplier);
        body.setLinvel({ x: movement.x, y: vel.y, z: movement.z }, true);
      } else {
        body.setLinvel({ x: 0, y: vel.y, z: 0 }, true);
      }
      const angle = Math.atan2(this.attackDirection.x, this.attackDirection.z);
      const rot = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, angle, 0));
      body.setRotation(rot, true);
    } else if (distance > STANDOFF_DISTANCE + STANDOFF_BUFFER) {
      const direction = targetPos.sub(this.model.position).normalize();
      this.setDirection(direction);
      const movement = this.model.userData.direction.clone().multiplyScalar(runSpeed);
      const vel = body.linvel();
      body.setLinvel({ x: movement.x, y: vel.y, z: movement.z }, true);
      const angle = Math.atan2(this.model.userData.direction.x, this.model.userData.direction.z);
      const rot = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, angle, 0));
      body.setRotation(rot, true);
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
      const vel = body.linvel();
      body.setLinvel({ x: movement.x, y: vel.y, z: movement.z }, true);
      const angle = Math.atan2(faceDir.x, faceDir.z);
      const rot = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, angle, 0));
      body.setRotation(rot, true);
      if (canAttack && distance <= STANDOFF_DISTANCE + 0.5) {
        this.attackDirection.copy(faceDir);
        this.setDirection(this.attackDirection);
        this.playAnimation(ATTACK_NAME, ATTACK_FADE);
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
      if (!this.attackHasHit && elapsed >= MONSTER_ATTACK.hitTime && elapsed <= MONSTER_ATTACK.hitTime + MONSTER_ATTACK.hitWindow) {
        for (const player of allPlayers) {
          const dist = this.model.position.distanceTo(player.model.position);
          if (dist <= attackRange) {
            if (player.id === 'local' && !window.playerControls?.isKnocked) {
              window.localHealth = Math.max(0, window.localHealth - this.attackDamage);
              if (window.playerControls) {
                window.playerControls.applyKnockback({
                  direction: this.model.userData.direction.clone(),
                  strength: MONSTER_ATTACK.knockbackStrength
                });
              }
            } else if (player.id !== 'local') {
              const op = otherPlayers[player.id];
              if (op) {
                op.health = Math.max(0, (op.health || 100) - this.attackDamage);
              }
            }
          }
        }
        this.attackHasHit = true;
      }
      if (elapsed > MONSTER_ATTACK.hitTime + MONSTER_ATTACK.hitWindow) {
        this.attackStartTime = null;
        this.attackHasHit = false;
      }
    }
  }

  update(delta) {
    super.update(delta);
    this.updateHealthBarVisibility();
  }

  createHealthBar() {
    const canvas = document.createElement('canvas');
    canvas.width = HEALTH_BAR_WIDTH;
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
    const pct = maxHealth > 0 ? clampedHealth / maxHealth : 0;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = 'rgba(0, 0, 0, 0.6)';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = 'rgba(60, 60, 60, 0.8)';
    context.fillRect(2, 2, canvas.width - 4, canvas.height - 4);
    context.fillStyle = 'rgba(214, 53, 60, 0.9)';
    context.fillRect(4, 4, (canvas.width - 8) * pct, canvas.height - 8);
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
    this.healthBar.position.set(0, baseOffset * scale, 0);
    this.healthBar.scale.set(baseScale.x * scale, baseScale.y * scale, baseScale.z);
  }

  updateHealthBarVisibility() {
    if (!this.healthBar) return;
    if (this.healthBar.visible && Date.now() > this.healthBarVisibleUntil) {
      this.healthBar.visible = false;
    }
  }
}

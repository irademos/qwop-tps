import * as THREE from "three";
import { CHARACTER_MOVEMENT } from "./CharacterBase.js";
import { MonsterCharacter } from "./MonsterCharacter.js";
import { BASE_HEALTH_SEGMENTS, clampHealthSegments, getMaxHealthSegments } from "../healthUtils.js";

const DEFAULT_HEALTH = BASE_HEALTH_SEGMENTS;
const WANDER_CHANGE_MS = 2400;
const MOVE_FADE = 0.2;
const IDLE_SPEED_MULTIPLIER = 1.0;
const FRIENDLY_MONSTER_HELP_RADIUS = 12;
const FRIENDLY_MONSTER_DAMAGE = 1;
const DANCE_MIN_INTERVAL_MS = 3200;
const DANCE_MAX_INTERVAL_MS = 7200;
const DANCE_MIN_DURATION_MS = 1800;
const DANCE_MAX_DURATION_MS = 3200;

export class FriendlyCharacter extends MonsterCharacter {
  constructor(data) {
    super(data);
    this.homePosition = new THREE.Vector3();
    this.wanderRadius = 6;
    this.noticeRadius = 10;
    this.engageRadius = 5;
    this.disengageRadius = 8;
    this.isEngaged = false;
    this.forceEngaged = false;
    this.nextDanceAt = 0;
    this.danceUntil = 0;
    this.lastDirectionChange = Date.now();
    this.enableDanceWhileEngaged = true;
    this.followTargetModel = null;
    this.followDistance = 3;
    this.followStartDistance = 4.5;
    this.isFollowingTarget = false;
    this.helpingPlayerFight = false;
    this.monsterHelpRadius = FRIENDLY_MONSTER_HELP_RADIUS;
    this.alwaysShowHealthBar = true;
    this.model.userData.mode = "friendly";
    this.model.userData.helpingPlayerFight = false;
    this.speedMultiplier = 1;
    this.sizeScale = 1;
    this.attackDamage = FRIENDLY_MONSTER_DAMAGE;
    if (this.healthBar) {
      this.healthBar.visible = true;
    }
    this.setLevel(1, { preserveHealth: false });
  }

  setHomePosition(position) {
    if (position) {
      this.homePosition.copy(position);
    }
  }

  setWanderRadius(radius) {
    if (Number.isFinite(radius)) {
      this.wanderRadius = Math.max(0, radius);
    }
  }

  setNoticeRadius(radius) {
    if (Number.isFinite(radius)) {
      this.noticeRadius = Math.max(0, radius);
    }
  }

  setEngageRadius(radius) {
    if (Number.isFinite(radius)) {
      this.engageRadius = Math.max(0, radius);
    }
  }

  setDisengageRadius(radius) {
    if (Number.isFinite(radius)) {
      this.disengageRadius = Math.max(0, radius);
    }
  }

  scheduleNextDance(now) {
    const interval = DANCE_MIN_INTERVAL_MS
      + Math.random() * (DANCE_MAX_INTERVAL_MS - DANCE_MIN_INTERVAL_MS);
    this.nextDanceAt = now + interval;
  }

  setFollowTarget(model, { followDistance = 3, followStartDistance = 4.5, helpingPlayerFight = null } = {}) {
    this.followTargetModel = model || null;
    if (helpingPlayerFight != null) {
      this.helpingPlayerFight = !!helpingPlayerFight;
      this.model.userData.helpingPlayerFight = this.helpingPlayerFight;
    }
    if (Number.isFinite(followDistance)) {
      this.followDistance = Math.max(0, followDistance);
    }
    if (Number.isFinite(followStartDistance)) {
      this.followStartDistance = Math.max(this.followDistance + 0.1, followStartDistance);
    }
    this.isFollowingTarget = false;
  }

  setLevel(level, { preserveHealth = true } = {}) {
    const nextLevel = Math.max(1, Math.round(level || 1));
    this.level = nextLevel;
    this.model.userData.level = nextLevel;
    this.sizeScale = 1;
    this.speedMultiplier = 1;
    this.attackDamage = FRIENDLY_MONSTER_DAMAGE;
    this.maxHealth = getMaxHealthSegments(nextLevel);
    this.model.userData.maxHealth = this.maxHealth;
    if (!preserveHealth) {
      this.health = this.maxHealth;
      this.model.userData.health = this.maxHealth;
    } else {
      this.health = clampHealthSegments(this.health, this.level);
      this.model.userData.health = this.health;
    }
    this.updateHealthBarScale();
    this.updateHealthBarTexture();
  }

  updateHealthBarScale() {
    super.updateHealthBarScale();
  }

  updateHealthBarVisibility() {
    if (!this.healthBar) return;
    if (this.isDead || this.model.userData.npcRole === 'merchant') {
      this.healthBar.visible = false;
      return;
    }
    if (this.alwaysShowHealthBar) {
      this.healthBar.visible = true;
      return;
    }
    if (this.healthBar.visible && Date.now() > this.healthBarVisibleUntil) {
      this.healthBar.visible = false;
    }
  }

  findClosestMonster(monsters = []) {
    if (!this.model?.position || !Array.isArray(monsters)) return null;
    let closest = null;
    let closestDistance = Infinity;
    monsters.forEach((monster) => {
      if (!monster?.model?.position || monster.isDead) return;
      const distance = this.model.position.distanceTo(monster.model.position);
      if (distance <= this.monsterHelpRadius && distance < closestDistance) {
        closest = monster;
        closestDistance = distance;
      }
    });
    return closest ? { id: closest.id, model: closest.model, entity: closest, distance: closestDistance } : null;
  }

  updateAI(deltaTime, playerModel, otherPlayers = {}, monsters = [], context = {}) {
    if (!this.model) return;
    const body = this.body;
    if (!body) return;
    if (typeof body.isValid === "function" && !body.isValid()) return;
    const delta = Number.isFinite(deltaTime) ? deltaTime : 0;
    const now = Date.now();

    if (this.isDead) {
      this.update(delta);
      return;
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

    if (closestPlayer) {
      if (this.isEngaged) {
        if (closestDistance > this.disengageRadius) {
          this.isEngaged = false;
          this.model.userData.mode = "friendly";
        }
      } else if (closestDistance <= this.engageRadius) {
        this.isEngaged = true;
        this.model.userData.mode = "engaged";
        this.danceUntil = 0;
        this.scheduleNextDance(now);
      }
    } else if (this.isEngaged) {
      this.isEngaged = false;
      this.model.userData.mode = "friendly";
    }

    if (this.forceEngaged) {
      this.isEngaged = true;
      this.model.userData.mode = "engaged";
    }

    const canHelpFightMonsters = this.helpingPlayerFight || this.model.userData.isQuestFriend === true;
    const closestMonster = canHelpFightMonsters ? this.findClosestMonster(monsters) : null;
    if (closestMonster) {
      this.isEngaged = true;
      this.model.userData.mode = "engaged";
      this.danceUntil = 0;
      this.updateCombatAI(delta, closestMonster, [closestMonster], (monsterTarget, hitContext = {}) => {
        const monster = monsterTarget?.entity;
        if (!monster?.model || monster.isDead) return;
        const damage = Number.isFinite(hitContext.damage)
          ? Math.max(1, Math.round(hitContext.damage))
          : this.attackDamage;
        const killed = monster.applyDamage?.(damage, { attackTypes: hitContext.attackTypes || ['friendly', 'melee'] });
        if (!killed) {
          monster.applyKnockback?.({
            direction: monster.model.position.clone().sub(this.model.position).normalize(),
            strength: hitContext.strength
          });
        }
        context.onMonsterHit?.(monster, {
          damage,
          killed: !!killed,
          sourceId: this.id,
          attackTypes: hitContext.attackTypes || ['friendly', 'melee']
        });
        if (killed) {
          window.onMonsterKill?.(monster, { withFriend: true });
        }
      }, context);
      return;
    }

    if (this.followTargetModel?.position && !this.forceEngaged) {
      const toTarget = this.followTargetModel.position.clone().sub(this.model.position);
      toTarget.y = 0;
      const followDistance = toTarget.length();
      const followDir = followDistance > 0.0001 ? toTarget.clone().multiplyScalar(1 / followDistance) : null;

      if (followDistance > this.followStartDistance && followDir) {
        this.isFollowingTarget = true;
      } else if (followDistance <= this.followDistance) {
        this.isFollowingTarget = false;
      }

      if (this.isFollowingTarget && followDir) {
        this.setDirection(followDir);
        this.setHorizontalMovement(
          followDir,
          CHARACTER_MOVEMENT.walkSpeed * IDLE_SPEED_MULTIPLIER,
          delta,
          context
        );
        this.faceDirection(followDir);
        this.playAnimation("Walk", MOVE_FADE);
      } else {
        this.setHorizontalMovement(new THREE.Vector3(), 0, delta, context);
        if (followDir) {
          this.setDirection(followDir);
          this.faceDirection(followDir);
        }
        this.playAnimation("Idle", MOVE_FADE);
      }
      this.update(delta);
      return;
    }
    this.isFollowingTarget = false;

    if (this.isEngaged && (closestPlayer || this.forceEngaged)) {
      const targetSource = closestPlayer?.model?.position || this.homePosition;
      const targetPos = targetSource.clone();
      const faceDir = targetPos.sub(this.model.position).normalize();
      this.setDirection(faceDir);
      this.setHorizontalMovement(new THREE.Vector3(), 0, delta, context);
      this.faceDirection(faceDir);

      if (this.enableDanceWhileEngaged && now >= this.danceUntil && now >= this.nextDanceAt) {
        const duration = DANCE_MIN_DURATION_MS
          + Math.random() * (DANCE_MAX_DURATION_MS - DANCE_MIN_DURATION_MS);
        this.danceUntil = now + duration;
        this.scheduleNextDance(this.danceUntil);
      }

      if (this.enableDanceWhileEngaged && now < this.danceUntil) {
        this.playAnimation("TwistDance", MOVE_FADE);
      } else {
        this.playAnimation("Idle", MOVE_FADE);
      }

      this.update(delta);
      return;
    }

    const distanceToHome = this.homePosition.distanceTo(this.model.position);
    if (distanceToHome > this.wanderRadius || now - this.lastDirectionChange > WANDER_CHANGE_MS) {
      const direction = distanceToHome > this.wanderRadius
        ? this.homePosition.clone().sub(this.model.position).normalize()
        : new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5).normalize();
      this.setDirection(direction);
      this.lastDirectionChange = now;
    }

    const movement = this.model.userData.direction
      .clone()
      .multiplyScalar(CHARACTER_MOVEMENT.walkSpeed * IDLE_SPEED_MULTIPLIER);
    this.setHorizontalMovement(
      this.model.userData.direction,
      CHARACTER_MOVEMENT.walkSpeed * IDLE_SPEED_MULTIPLIER,
      delta,
      context
    );
    this.faceDirection(this.model.userData.direction);
    if (movement.lengthSq() > 0.0001) {
      this.playAnimation("Walk", MOVE_FADE);
    } else {
      this.playAnimation("Idle", MOVE_FADE);
    }
    this.update(delta);
  }
}

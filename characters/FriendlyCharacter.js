import * as THREE from "three";
import { CHARACTER_MOVEMENT } from "./CharacterBase.js";
import { MonsterCharacter } from "./MonsterCharacter.js";
import { BASE_HEALTH_SEGMENTS, clampHealthSegments, getMaxHealthSegments } from "../healthUtils.js";

const DEFAULT_HEALTH = BASE_HEALTH_SEGMENTS;
const WANDER_CHANGE_MS = 2400;
const MOVE_FADE = 0.2;
const FRIENDLY_MOVE_SPEED = CHARACTER_MOVEMENT.runSpeed;
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
    this.model.userData.mode = "friendly";
    this.speedMultiplier = 1;
    this.sizeScale = 1;
    this.attackDamage = 0;
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

  setLevel(level, { preserveHealth = true } = {}) {
    const nextLevel = Math.max(1, Math.round(level || 1));
    this.level = nextLevel;
    this.model.userData.level = nextLevel;
    this.sizeScale = 1;
    this.speedMultiplier = 1;
    this.attackDamage = 0;
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

  updateAI(deltaTime, playerModel, otherPlayers) {
    if (!this.model) return;
    const body = this.body;
    if (!body) return;
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

    if (this.isEngaged && (closestPlayer || this.forceEngaged)) {
      const targetSource = closestPlayer?.model?.position || this.homePosition;
      const targetPos = targetSource.clone();
      const faceDir = targetPos.sub(this.model.position).normalize();
      this.setDirection(faceDir);
      const vel = body.linvel();
      body.setLinvel({ x: 0, y: vel.y, z: 0 }, true);
      const angle = Math.atan2(faceDir.x, faceDir.z);
      const rot = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, angle, 0));
      body.setRotation(rot, true);

      if (now >= this.danceUntil && now >= this.nextDanceAt) {
        const duration = DANCE_MIN_DURATION_MS
          + Math.random() * (DANCE_MAX_DURATION_MS - DANCE_MIN_DURATION_MS);
        this.danceUntil = now + duration;
        this.scheduleNextDance(this.danceUntil);
      }

      if (now < this.danceUntil) {
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
      .multiplyScalar(FRIENDLY_MOVE_SPEED);
    const vel = body.linvel();
    body.setLinvel({ x: movement.x, y: vel.y, z: movement.z }, true);
    const angle = Math.atan2(this.model.userData.direction.x, this.model.userData.direction.z);
    const rot = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, angle, 0));
    body.setRotation(rot, true);
    if (movement.lengthSq() > 0.0001) {
      this.playAnimation("Walk", MOVE_FADE);
    } else {
      this.playAnimation("Idle", MOVE_FADE);
    }
    this.update(delta);
  }
}

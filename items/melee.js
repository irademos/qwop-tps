import { appContext } from '../src/runtime/appContext.js';
import * as THREE from 'three';
import { BASE_HEALTH_SEGMENTS, convertPointsToSegments } from '../healthUtils.js';

export const ATTACKS = {
  mutantPunch: { damage: 1, range: 1.5, hitTime: 100, hitWindow: 300, knockbackStrength: 2, region: 'forward', types: ['melee', 'punch'] },
  swordSlash: { damage: 2, range: 2.5, hitTime: 100, hitWindow: 300, knockbackStrength: 3, region: 'forward', types: ['cut'] },
  swordSlashLeft: { damage: 2, range: 2.5, hitTime: 200, hitWindow: 300, knockbackStrength: 3, region: 'forward', types: ['cut'] },
  swordFwdSpin: { damage: 3, range: 2.0, hitTime: 280, hitWindow: 500, knockbackStrength: 5, region: 'forward', types: ['cut'] },
  swordSpin: { damage: 4, range: 4.0, hitTime: 800, hitWindow: 300, knockbackStrength: 12, region: 'around', types: ['cut'] },
  hammerSlash: { damage: 1, range: 2.5, hitTime: 100, hitWindow: 300, knockbackStrength: 7, region: 'forward', types: ['smash'] },
  hammerSlashLeft: { damage: 1, range: 2.5, hitTime: 200, hitWindow: 300, knockbackStrength: 7, region: 'forward', types: ['pummel'] },
  hammerFwdSpin: { damage: 2, range: 2.0, hitTime: 280, hitWindow: 500, knockbackStrength: 10, region: 'forward', types: ['smash'] },
  hammerSpin: { damage: 2, range: 4.0, hitTime: 800, hitWindow: 300, knockbackStrength: 18, region: 'around', types: ['pummel'] },
  hurricaneKick: { damage: 1, range: 2.0, hitTime: 280, hitWindow: 800, knockbackStrength: 5, region: 'around', types: ['melee', 'kick'] },
  mmaKick: { damage: 1, range: 1.7, hitTime: 100, hitWindow: 300, knockbackStrength: 8, region: 'forward', types: ['melee', 'kick'] },
  torchSwing: { damage: 1, range: 1.5, hitTime: 100, hitWindow: 300, knockbackStrength: 2, region: 'forward', types: ['fire'] },
  lanternSwing: { damage: 1, range: 1.5, hitTime: 100, hitWindow: 300, knockbackStrength: 2, region: 'forward', types: ['fire'] },
  bombExplosion: { types: ['explosive', 'fire'] },
  bowArrowProjectile: { types: ['arrow'] },
  iceMistProjectile: { types: ['ice'] }
};

export function getAttackTypes(attackName, fallback = []) {
  const raw = ATTACKS?.[attackName]?.types;
  if (!Array.isArray(raw) || raw.length === 0) {
    return Array.isArray(fallback) ? [...fallback] : [];
  }
  return [...new Set(raw.filter(type => typeof type === 'string' && type.trim()))];
}

const tempToTarget = new THREE.Vector3();
const tempForward = new THREE.Vector3();
const tempRight = new THREE.Vector3();

function getEquippedMeleeAttackName(attackName, equippedWeaponType) {
  if (equippedWeaponType === 'hammer') {
    if (attackName === 'mutantPunch' || attackName === 'swordSlash') return 'hammerSlash';
    if (attackName === 'swordSlashLeft') return 'hammerSlashLeft';
    if (attackName === 'swordFwdSpin') return 'hammerFwdSpin';
    if (attackName === 'swordSpin') return 'hammerSpin';
  }
  if (equippedWeaponType === 'sword' && attackName === 'mutantPunch') {
    return 'swordSlash';
  }
  return attackName;
}

function getAnimationActionForAttack(attackName) {
  return ({
    hammerSlash: 'swordSlash',
    hammerSlashLeft: 'swordSlashLeft',
    hammerFwdSpin: 'swordFwdSpin',
    hammerSpin: 'swordSpin'
  })[attackName] || attackName;
}

function isTargetInAttackRange(attackerModel, targetPosition, cfg) {
  if (!attackerModel?.position || !targetPosition || !cfg) return false;
  const range = Number.isFinite(cfg.range) ? cfg.range : 0;
  if (range <= 0) return false;

  tempToTarget.subVectors(targetPosition, attackerModel.position);
  if ((cfg.region || 'around') !== 'forward') {
    return tempToTarget.lengthSq() <= range * range;
  }

  attackerModel.getWorldDirection(tempForward);
  tempForward.y = 0;
  if (tempForward.lengthSq() < 0.0001) {
    tempForward.set(0, 0, 1);
  } else {
    tempForward.normalize();
  }

  tempToTarget.y = 0;
  const forwardDistance = tempToTarget.dot(tempForward);
  if (forwardDistance < 0 || forwardDistance > range) {
    return false;
  }

  tempRight.set(tempForward.z, 0, -tempForward.x);
  const lateralDistance = tempToTarget.dot(tempRight);
  return Math.abs(lateralDistance) <= range;
}

function getStrengthDamage(attackerId, baseDamage) {
  if (attackerId === 'local' && typeof window.getPlayerStrength === 'function') {
    const strength = window.getPlayerStrength();
    if (Number.isFinite(strength)) {
      const bonus = convertPointsToSegments(strength, { minimum: 0 });
      return Math.max(0, baseDamage + bonus);
    }
  }
  return baseDamage;
}

function isAttackInterrupted(attacker, attackName) {
  const model = attacker?.model;
  if (!model?.userData) return true;
  if (model.userData.isKnocked) return true;
  if (model.userData.currentAction === 'hit') return true;
  const resolved = getAnimationActionForAttack(attackName);
  if (resolved && model.userData.currentAction && model.userData.currentAction !== resolved) {
    return true;
  }
  return false;
}

export function updateMeleeAttacks({
  playerModel,
  otherPlayers,
  monsters,
  audioManager,
  multiplayer,
  sendMonsterAttack,
  onMonsterHit,
  onSwordHit,
  onTorchHit,
  onBuildHit,
  onEntityHit
}) {
  const now = Date.now();
  const isHost = !multiplayer || multiplayer.isHost;
  const players = [
    { id: 'local', model: playerModel },
    ...Object.entries(otherPlayers).map(([id, p]) => ({ id, model: p.model }))
  ].filter((player) => player.model && player.model.position);

  for (const attacker of players) {
    if (!attacker.model || !attacker.model.userData) continue;
    const info = attacker.model.userData.attack;
    if (!info) continue;
    const attackName = getEquippedMeleeAttackName(info.name, attacker.model.userData?.equippedWeaponType);
    const cfg = ATTACKS[attackName];
    if (!cfg) continue;
    const attackCfg = info.overrides ? { ...cfg, ...info.overrides } : cfg;
    if (isAttackInterrupted(attacker, attackName)) {
      info.hasHit = true;
      continue;
    }
    const elapsed = now - info.start;
    if (elapsed >= attackCfg.hitTime && elapsed <= attackCfg.hitTime + attackCfg.hitWindow && !info.hasHit) {
      let hit = false;
      const attackDamage = getStrengthDamage(attacker.id, attackCfg.damage);
      const attackTypes = getAttackTypes(
        attacker.model.userData?.equippedWeaponType === 'torch'
          ? 'torchSwing'
          : attacker.model.userData?.equippedWeaponType === 'lantern'
            ? 'lanternSwing'
            : attacker.model.userData?.equippedWeaponType === 'hammer'
              ? attackName
              : attackName,
        ['melee']
      );
      if (attacker.id === 'local'
        && attacker.model.userData?.equippedWeaponType === 'sword'
        && Array.isArray(attackCfg.types)
        && attackCfg.types.includes('cut')) {
        onSwordHit?.({ attacker, range: attackCfg.range });
      }
      if (attackName === 'mutantPunch'
        && attacker.id === 'local'
        && attacker.model.userData?.equippedWeaponType === 'torch') {
        onTorchHit?.({ attacker, range: attackCfg.range });
      }
      if (attacker.id === 'local') {
        hit = onBuildHit?.({
          attacker,
          range: attackCfg.range,
          region: attackCfg.region || 'around',
          damage: attackDamage,
          attackTypes
        }) || hit;
      }
      for (const target of players) {
        if (target === attacker) continue;
        if (!target.model || !target.model.position) continue;
        if (isTargetInAttackRange(attacker.model, target.model.position, attackCfg)) {
          hit = true;
          onEntityHit?.({
            targetType: target.id === 'local' ? 'player' : 'remotePlayer',
            targetId: target.id,
            targetPosition: target.model.position.clone(),
            attackTypes
          });
          if (target.id === 'local') {
            window.localHealth = Math.max(0, window.localHealth - attackDamage);
            window.lastHitAttackTypes = attackTypes;
            const playerControls = appContext.systems.playerControls ?? window.playerControls;
            if (playerControls) {
              const dir = new THREE.Vector3().subVectors(target.model.position, attacker.model.position).normalize();
              playerControls.applyKnockback({ direction: dir, strength: attackCfg.knockbackStrength });
            }
          } else {
            const tp = otherPlayers[target.id];
            if (tp) {
              const previousHealth = Number.isFinite(tp.health) ? tp.health : BASE_HEALTH_SEGMENTS;
              const nextHealth = Math.max(0, previousHealth - attackDamage);
              tp.health = nextHealth;
              tp.lastHitAttackTypes = attackTypes;
              if (nextHealth <= 0 && previousHealth > 0) {
                tp.isDead = true;
                if (attacker.id === 'local') {
                  window.onPlayerKill?.(target.id);
                }
              } else if (nextHealth > 0 && tp.isDead) {
                tp.isDead = false;
              }
            }
          }
        }
      }

      if (isHost && Array.isArray(monsters)) {
        for (const monster of monsters) {
          if (!monster?.model?.position) continue;
          if (isTargetInAttackRange(attacker.model, monster.model.position, attackCfg)) {
            hit = true;
            const killed = monster.applyDamage(attackDamage, { attackTypes });
            if (!killed) {
              const dir = new THREE.Vector3()
                .subVectors(monster.model.position, attacker.model.position)
                .normalize();
              monster.applyKnockback({ direction: dir, strength: attackCfg.knockbackStrength });
            }
            onMonsterHit?.(monster, { damage: attackDamage, killed, sourceId: attacker.id, attackTypes });
            onEntityHit?.({ targetType: 'monster', targetId: monster.id, targetPosition: monster.model.position.clone(), attackTypes });
            if (killed && attacker.id === 'local') {
              const withFriend = window.questManager?.isFriendActive?.() ?? false;
              window.onMonsterKill?.(monster, { withFriend });
            }
          }
        }
      } else if (!isHost && Array.isArray(monsters)) {
        for (const monster of monsters) {
          if (!monster?.model?.position) continue;
          if (isTargetInAttackRange(attacker.model, monster.model.position, attackCfg)) {
            hit = true;
            sendMonsterAttack?.({
              monsterId: monster.id,
              damage: attackDamage,
              sourcePlayerId: attacker.id,
              attackTypes,
              at: Date.now()
            });
          }
        }
      }

      if (hit) {
        audioManager?.playSFX('SFX/Attacks/Sword Attacks Hits and Blocks/Sword Impact Hit 1.ogg', 0.6);
      }
      info.hasHit = true;
    }
    if (elapsed > attackCfg.hitTime + attackCfg.hitWindow) {
      info.hasHit = true;
    }
  }
}

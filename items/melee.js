import * as THREE from 'three';
import { BASE_HEALTH_SEGMENTS, convertPointsToSegments } from '../healthUtils.js';

export const ATTACKS = {
  mutantPunch: { damage: 1, range: 1.5, hitTime: 300, hitWindow: 300, knockbackStrength: 2 },
  swordSlash: { damage: 2, range: 1.7, hitTime: 300, hitWindow: 300, knockbackStrength: 3 },
  hurricaneKick: { damage: 2, range: 2.0, hitTime: 400, hitWindow: 400, knockbackStrength: 5 },
  mmaKick: { damage: 1, range: 1.7, hitTime: 350, hitWindow: 300, knockbackStrength: 4 }
};

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

export function updateMeleeAttacks({
  playerModel,
  otherPlayers,
  monsters,
  audioManager,
  multiplayer,
  sendMonsterAttack,
  onMonsterHit,
  onSwordHit,
  onTorchHit
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
    const attackName = info.name === 'mutantPunch' && attacker.model.userData?.equippedWeaponType === 'sword'
      ? 'swordSlash'
      : info.name;
    const cfg = ATTACKS[attackName];
    if (!cfg) continue;
    const elapsed = now - info.start;
    if (elapsed >= cfg.hitTime && elapsed <= cfg.hitTime + cfg.hitWindow && !info.hasHit) {
      let hit = false;
      const attackDamage = getStrengthDamage(attacker.id, cfg.damage);
      if (attackName === 'swordSlash' && attacker.id === 'local') {
        onSwordHit?.({ attacker, range: cfg.range });
      }
      if (attackName === 'mutantPunch'
        && attacker.id === 'local'
        && attacker.model.userData?.equippedWeaponType === 'torch') {
        onTorchHit?.({ attacker, range: cfg.range });
      }
      for (const target of players) {
        if (target === attacker) continue;
        if (!target.model || !target.model.position) continue;
        const dist = attacker.model.position.distanceTo(target.model.position);
        if (dist <= cfg.range) {
          hit = true;
          if (target.id === 'local') {
            window.localHealth = Math.max(0, window.localHealth - attackDamage);
            if (window.playerControls) {
              const dir = new THREE.Vector3().subVectors(target.model.position, attacker.model.position).normalize();
              window.playerControls.applyKnockback({ direction: dir, strength: cfg.knockbackStrength });
            }
          } else {
            const tp = otherPlayers[target.id];
            if (tp) {
              const previousHealth = Number.isFinite(tp.health) ? tp.health : BASE_HEALTH_SEGMENTS;
              const nextHealth = Math.max(0, previousHealth - attackDamage);
              tp.health = nextHealth;
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
          const dist = attacker.model.position.distanceTo(monster.model.position);
          if (dist <= cfg.range) {
            hit = true;
            const killed = monster.applyDamage(attackDamage);
            if (!killed) {
              const dir = new THREE.Vector3()
                .subVectors(monster.model.position, attacker.model.position)
                .normalize();
              monster.applyKnockback({ direction: dir, strength: cfg.knockbackStrength });
            }
            onMonsterHit?.(monster, { damage: attackDamage, killed, sourceId: attacker.id });
            if (killed && attacker.id === 'local') {
              const withFriend = window.questManager?.isFriendActive?.() ?? false;
              window.onMonsterKill?.(monster, { withFriend });
            }
          }
        }
      } else if (!isHost && Array.isArray(monsters)) {
        for (const monster of monsters) {
          if (!monster?.model?.position) continue;
          const dist = attacker.model.position.distanceTo(monster.model.position);
          if (dist <= cfg.range) {
            hit = true;
            sendMonsterAttack?.({
              monsterId: monster.id,
              damage: attackDamage,
              sourcePlayerId: attacker.id,
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
    if (elapsed > cfg.hitTime + cfg.hitWindow) {
      info.hasHit = true;
    }
  }
}

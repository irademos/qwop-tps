import * as THREE from 'three';

export const ATTACKS = {
  mutantPunch: { damage: 10, range: 1.5, hitTime: 300, hitWindow: 300 },
  swordSlash: { damage: 18, range: 1.7, hitTime: 300, hitWindow: 300 },
  hurricaneKick: { damage: 15, range: 2.0, hitTime: 400, hitWindow: 400 },
  mmaKick: { damage: 12, range: 1.7, hitTime: 350, hitWindow: 300 }
};

function getStrengthDamage(attackerId, baseDamage) {
  if (attackerId === 'local' && typeof window.getPlayerStrength === 'function') {
    const strength = window.getPlayerStrength();
    if (Number.isFinite(strength)) {
      return Math.max(0, baseDamage + strength);
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
  onMonsterHit
}) {
  const now = Date.now();
  const isHost = !multiplayer || multiplayer.isHost;
  const players = [
    { id: 'local', model: playerModel },
    ...Object.entries(otherPlayers).map(([id, p]) => ({ id, model: p.model }))
  ];

  for (const attacker of players) {
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
      for (const target of players) {
        if (target === attacker) continue;
        const dist = attacker.model.position.distanceTo(target.model.position);
        if (dist <= cfg.range) {
          hit = true;
          if (target.id === 'local') {
            window.localHealth = Math.max(0, window.localHealth - attackDamage);
            if (window.playerControls) {
              const dir = new THREE.Vector3().subVectors(target.model.position, attacker.model.position).normalize();
              const impulse = dir.multiplyScalar(0.15);
              window.playerControls.applyKnockback(impulse);
            }
          } else {
            const tp = otherPlayers[target.id];
            if (tp) {
              const previousHealth = tp.health || 100;
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
          if (!monster) continue;
          const dist = attacker.model.position.distanceTo(monster.model.position);
          if (dist <= cfg.range) {
            hit = true;
            const killed = monster.applyDamage(attackDamage);
            onMonsterHit?.(monster, { damage: attackDamage, killed, sourceId: attacker.id });
            if (killed && attacker.id === 'local') {
              window.onMonsterKill?.();
            }
          }
        }
      } else if (!isHost && Array.isArray(monsters)) {
        for (const monster of monsters) {
          if (!monster) continue;
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

      if (window.breakManager) {
        for (const [id, data] of window.breakManager.registry.entries()) {
          const center = data.center || data.object.position;
          const dist = attacker.model.position.distanceTo(center);
          if (dist <= cfg.range) {
            hit = true;
          const dir = new THREE.Vector3()
            .subVectors(center, attacker.model.position)
            .normalize();
          const impulse = dir.multiplyScalar(2);
          window.breakManager.onHit(id, attackDamage, impulse);
          const remaining = window.breakManager.registry.get(id)?.health ?? 0;
          console.log(`🪓 ${id} health: ${remaining}`);

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

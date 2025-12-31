import * as THREE from 'three';

export const ATTACKS = {
  mutantPunch: { damage: 10, range: 1.5, hitTime: 300, hitWindow: 300 },
  hurricaneKick: { damage: 15, range: 2.0, hitTime: 400, hitWindow: 400 },
  mmaKick: { damage: 12, range: 1.7, hitTime: 350, hitWindow: 300 }
};

export function updateMeleeAttacks({ playerModel, otherPlayers, monsters, audioManager, multiplayer }) {
  const now = Date.now();
  const isHost = !multiplayer || multiplayer.isHost;
  const players = [
    { id: 'local', model: playerModel },
    ...Object.entries(otherPlayers).map(([id, p]) => ({ id, model: p.model }))
  ];

  for (const attacker of players) {
    const info = attacker.model.userData.attack;
    if (!info) continue;
    const cfg = ATTACKS[info.name];
    if (!cfg) continue;
    const elapsed = now - info.start;
    if (elapsed >= cfg.hitTime && elapsed <= cfg.hitTime + cfg.hitWindow && !info.hasHit) {
      let hit = false;
      for (const target of players) {
        if (target === attacker) continue;
        const dist = attacker.model.position.distanceTo(target.model.position);
        if (dist <= cfg.range) {
          hit = true;
          if (target.id === 'local') {
            window.localHealth = Math.max(0, window.localHealth - cfg.damage);
            if (window.playerControls) {
              const dir = new THREE.Vector3().subVectors(target.model.position, attacker.model.position).normalize();
              const impulse = dir.multiplyScalar(0.15);
              window.playerControls.applyKnockback(impulse);
            }
          } else {
            const tp = otherPlayers[target.id];
            if (tp) {
              tp.health = Math.max(0, (tp.health || 100) - cfg.damage);
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
            monster.applyDamage(cfg.damage);
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
            window.breakManager.onHit(id, cfg.damage, impulse);
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

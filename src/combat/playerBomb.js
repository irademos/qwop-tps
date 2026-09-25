/**
 * Player bombs (Sword Showdown, bought in the shop and thrown with the 💣 button).
 *
 * Same projectile as a BombThrowerEnemy's bomb (bomb.glb, lob arc under BOMB_GRAVITY,
 * explodes on ground contact or after BOMB_LIFETIME_MS) and the same blast: every enemy
 * inside the radius loses a heart and is thrown back. A player bomb also goes off when it
 * reaches an enemy's body, and never hurts the player.
 */

import * as THREE from 'three';
import { getTerrainHeight } from '../environment/terrainHeight.js';
import {
  BOMB_GRAVITY,
  BOMB_LIFETIME_MS,
  blastEnemiesAt,
  computeBombLobVelocity,
  createBombMesh,
  createHeldBombMesh,
  disposeBombMesh,
  getBombGLTF,
  spawnBombExplosion,
} from '../characters/BombThrowerEnemy.js';

const ENEMY_CONTACT_RADIUS = 0.6; // m — bomb touching an enemy's body (centre at half height)
const ENEMY_CENTER_HEIGHT = 0.5;

const _enemyCenter = new THREE.Vector3();

/**
 * @param {object} opts
 * @param {THREE.Scene} opts.scene
 * @param {() => object[]} opts.getBlastTargets – enemies a blast can hit (horde enemies)
 */
export function createPlayerBombs({ scene, getBlastTargets }) {
  const bombs = []; // { mesh, vel, spawnTime }
  let gltf = null;
  let held = null;

  getBombGLTF()
    .then((loaded) => {
      gltf = loaded;
      held = createHeldBombMesh(loaded);
      held.name = 'PlayerHeldBomb';
      scene.add(held);
    })
    .catch((e) => console.warn('[playerBomb] bomb GLB load error:', e));

  const explode = (bomb) => {
    const pos = bomb.mesh.position.clone();
    spawnBombExplosion(scene, pos);
    blastEnemiesAt(pos, getBlastTargets?.());
    disposeBombMesh(bomb.mesh);
    bombs.splice(bombs.indexOf(bomb), 1);
  };

  const touchesEnemy = (pos) => {
    const targets = getBlastTargets?.();
    if (!targets?.length) return false;
    for (const enemy of targets) {
      if (!enemy || enemy.isDead || !enemy.group) continue;
      _enemyCenter.copy(enemy.group.position);
      _enemyCenter.y += ENEMY_CENTER_HEIGHT;
      if (pos.distanceTo(_enemyCenter) < ENEMY_CONTACT_RADIUS) return true;
    }
    return false;
  };

  return {
    /** Shows the held bomb at `worldPos` (the throwing palm), or hides it with null. */
    setHeld(worldPos) {
      if (!held) return;
      held.visible = !!worldPos;
      if (worldPos) held.position.copy(worldPos);
    },

    /** Lobs a bomb from `origin` so it lands on `target` (both world space). */
    throw(origin, target) {
      const mesh = createBombMesh(gltf);
      mesh.name = 'PlayerBomb';
      mesh.position.copy(origin);
      scene.add(mesh);
      bombs.push({ mesh, vel: computeBombLobVelocity(origin, target), spawnTime: Date.now() });
      if (held) held.visible = false;
    },

    update(dt) {
      const now = Date.now();
      for (let i = bombs.length - 1; i >= 0; i--) {
        const bomb = bombs[i];
        const p = bomb.mesh.position;
        bomb.vel.y -= BOMB_GRAVITY * dt;
        p.addScaledVector(bomb.vel, dt);
        bomb.mesh.rotation.x += dt * 4;
        bomb.mesh.rotation.z += dt * 2.5;

        const groundY = getTerrainHeight(p.x, p.z);
        if (now - bomb.spawnTime > BOMB_LIFETIME_MS ||
            (Number.isFinite(groundY) && p.y <= groundY + 0.15) ||
            touchesEnemy(p)) {
          explode(bomb);
        }
      }
    },

    /** Removes every bomb in flight without exploding (stage restart). */
    clear() {
      for (const bomb of bombs) disposeBombMesh(bomb.mesh);
      bombs.length = 0;
      if (held) held.visible = false;
    },
  };
}

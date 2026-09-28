import * as THREE from "three";
import RAPIER from '@dimforge/rapier3d-compat';
import { BASE_HEALTH_SEGMENTS, convertPointsToSegments } from "../player/healthUtils.js";
import { removeRigidBodySafely } from '../physics/rapierSafety.js';

const disposeProjectileMesh = (mesh) => {
  if (!mesh) return;
  if (mesh.parent) {
    mesh.parent.remove(mesh);
  }
  mesh.traverse(child => {
    if (!child.isMesh) return;
    if (child.geometry) {
      child.geometry.dispose();
    }
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.forEach(material => material?.dispose?.());
  });
};

const getObjectBox = (object) => {
  if (!object || typeof object.updateWorldMatrix !== 'function') {
    return null;
  }
  const box = new THREE.Box3();
  box.setFromObject(object);
  return box;
};

// Fast shots (pistol: ~0.5 m/frame) can skip past a slim enemy between frames, or be
// bounced off its physics capsule before the boxes overlap, so also test the segment
// travelled this frame against the enemy's vertical body axis.
const ENEMY_HIT_RADIUS = 0.45;
const ENEMY_HIT_HEIGHT = 1.4;
const _segDir = new THREE.Vector3();
const _segToAxis = new THREE.Vector3();
const sweptHitsEnemy = (from, to, enemy) => {
  const base = enemy?.group?.position;
  if (!base) return false;
  _segDir.subVectors(to, from);
  _segDir.y = 0;
  const lenSq = _segDir.lengthSq();
  // Closest point on the (horizontal) segment to the enemy's axis
  _segToAxis.set(base.x - from.x, 0, base.z - from.z);
  const t = lenSq > 1e-8 ? THREE.MathUtils.clamp(_segToAxis.dot(_segDir) / lenSq, 0, 1) : 0;
  const px = from.x + (to.x - from.x) * t;
  const py = from.y + (to.y - from.y) * t;
  const pz = from.z + (to.z - from.z) * t;
  if (py < base.y - 0.1 || py > base.y + ENEMY_HIT_HEIGHT) return false;
  const dx = px - base.x;
  const dz = pz - base.z;
  return dx * dx + dz * dz < ENEMY_HIT_RADIUS * ENEMY_HIT_RADIUS;
};

function removeProjectileAt(projectiles, index) {
  const projectile = projectiles[index];
  if (!projectile) return;
  const body = projectile.userData?.rb;
  disposeProjectileMesh(projectile);
  projectiles.splice(index, 1);
  if (body) {
    window.rbToMesh?.delete?.(body);
    removeRigidBodySafely(window.rapierWorld, body);
  }
}

export function spawnProjectile(scene, projectiles, position, direction, shooterId, options = {}) {
  const size = 0.5;
  const half = size / 2;
  const geometry = options.geometry || new THREE.BoxGeometry(size, size, size);
  const color = options.color || new THREE.Color(Math.random(), Math.random(), Math.random());
  const material = new THREE.MeshStandardMaterial({ color });
  const mesh = new THREE.Mesh(geometry, material);
  const spawnPosition = position.clone();
  mesh.position.copy(spawnPosition);
  // Rapier body
  const world = window.rapierWorld;
  const rbDesc = RAPIER.RigidBodyDesc.dynamic().setTranslation(mesh.position.x, mesh.position.y, mesh.position.z);
  const rb = world.createRigidBody(rbDesc);
  const colDesc = options.colliderDesc || RAPIER.ColliderDesc.cuboid(half, half, half)
    .setRestitution(0.2)
    .setFriction(0.5);
  world.createCollider(colDesc, rb);
  const speed = Number.isFinite(options.speed) ? options.speed : 10;
  const vel = direction.clone().normalize().multiplyScalar(speed);
  rb.setLinvel({ x: vel.x, y: vel.y, z: vel.z }, true);

  window.rbToMesh.set(rb, mesh);

  mesh.userData.rb = rb;
  mesh.userData.lifetime = Number.isFinite(options.lifetime) ? options.lifetime : 4000;
  mesh.userData.spawnPosition = spawnPosition.clone();
  mesh.userData.shooterId = shooterId;
  mesh.userData.damage = Number.isFinite(options.damage) ? options.damage : 1;
  scene.add(mesh);
  projectiles.push(mesh);
}

export function updateProjectiles({
  projectiles,
  otherPlayers,
  multiplayer,
  hordeEnemies
}) {
  const localId = multiplayer?.getId?.() ?? 'local'; // 'local' = single player (see PlayerControls)
  const getStrengthDamage = baseDamage => {
    if (typeof window.getPlayerStrength === 'function') {
      const strength = window.getPlayerStrength();
      if (Number.isFinite(strength)) {
        const bonus = convertPointsToSegments(strength, { minimum: 0 });
        return Math.max(0, baseDamage + bonus);
      }
    }
    return baseDamage;
  };
  const getDamage = (proj) => {
    const baseDamage = Number.isFinite(proj.userData.damage) ? proj.userData.damage : 1;
    return proj.userData.shooterId === localId ? getStrengthDamage(baseDamage) : baseDamage;
  };
  const removeProjectile = (index) => {
    removeProjectileAt(projectiles, index);
  };

  for (let i = projectiles.length - 1; i >= 0; i--) {
    const proj = projectiles[i];
    const rb = proj.userData.rb;

    let linvel;
    try {
      const body = window.rapierWorld?.getRigidBody(rb.handle);
      if (!body) {
        removeProjectile(i);
        continue;
      }
      linvel = body.linvel();
    } catch (e) {
      removeProjectile(i);
      continue;
    }
    const vel = new THREE.Vector3(linvel.x, linvel.y, linvel.z);

    proj.userData.lifetime -= 16;
    if (proj.userData.lifetime <= 0) {
      removeProjectile(i);
      continue;
    }

    let removed = false;
    const projBox = getObjectBox(proj);
    if (!projBox) {
      continue;
    }
    // Skip hits until the projectile has left the shooter's immediate vicinity (~0.08 m).
    const leftShooter = !proj.userData.spawnPosition
      || proj.position.distanceToSquared(proj.userData.spawnPosition) >= 0.0064;

    // PvP: other players
    for (const [id, { model }] of Object.entries(otherPlayers)) {
      if (proj.userData.shooterId && proj.userData.shooterId === id) continue;
      if (!leftShooter) continue;
      const playerBox = getObjectBox(model);
      if (!playerBox) continue;
      if (projBox.intersectsBox(playerBox)) {
        const player = otherPlayers[id];
        if (player) {
          const damage = getDamage(proj);
          const previousHealth = Number.isFinite(player.health) ? player.health : BASE_HEALTH_SEGMENTS;
          const nextHealth = Math.max(0, previousHealth - damage);
          player.health = nextHealth;
          if (nextHealth <= 0 && previousHealth > 0) {
            player.isDead = true;
            if (proj.userData.shooterId === localId) {
              window.onPlayerKill?.(id);
            }
          } else if (nextHealth > 0 && player.isDead) {
            player.isDead = false;
          }
          console.log(`💥 Hit player: ${id}, Health: ${player.health}`);
        }
        removeProjectile(i);
        removed = true;
        break;
      }
    }

    if (removed) continue;

    // Showdown enemies are always local — call applyDamage directly.
    if (Array.isArray(hordeEnemies) && hordeEnemies.length > 0 && leftShooter) {
      const prevPos = proj.userData.prevPos ?? proj.position;
      for (const enemy of hordeEnemies) {
        if (enemy.isDead) continue;
        const enemyBox = getObjectBox(enemy.group);
        if (!enemyBox) continue;
        if (projBox.intersectsBox(enemyBox) || sweptHitsEnemy(prevPos, proj.position, enemy)) {
          const damage = getDamage(proj);
          const dir = vel.clone().normalize();
          const killed = enemy.applyDamage(Math.max(1, Math.round(damage)));
          if (killed) {
            enemy.applyDirectKnockback({ direction: dir, horizSpeed: 9, upVelocity: 3.5, torqueMag: 70, ragdoll: true });
          } else {
            enemy.applyKnockback({ direction: dir, strength: 3 });
          }
          removeProjectile(i);
          removed = true;
          break;
        }
      }
      if (!removed) (proj.userData.prevPos ??= new THREE.Vector3()).copy(proj.position);
    }
  }
}

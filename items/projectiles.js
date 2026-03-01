import { appContext } from '../src/runtime/appContext.js';
import * as THREE from "three";
import RAPIER from '@dimforge/rapier3d-compat';
import { updateArrowProjectile } from "./arrow.js";
import { BASE_HEALTH_SEGMENTS, convertPointsToSegments } from "../healthUtils.js";
import { getTerrainHeight } from '../environment/terrainHeight.js';

const detachProjectileMesh = (mesh) => {
  if (!mesh) return;
  if (mesh.parent) {
    mesh.parent.remove(mesh);
  }
};

const disposeProjectileMesh = (mesh) => {
  if (!mesh) return;
  detachProjectileMesh(mesh);
  mesh.traverse(child => {
    if (!child.isMesh) return;
    if (child.geometry) {
      child.geometry.dispose();
    }
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.forEach(material => material?.dispose?.());
  });
};


const playArrowBlockedSFX = () => {
  window.audioManager?.playSFX?.('SFX/Attacks/Bow Attacks Hits and Blocks/Bow Blocked 1.ogg', 0.58, {
    cooldownKey: 'bow-blocked',
    cooldownMs: 60
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

export function removeProjectileAt(projectiles, index) {
  const projectile = projectiles[index];
  if (!projectile) return;
  const body = projectile.userData?.rb;
  if (typeof projectile.userData?.releaseMesh === 'function') {
    detachProjectileMesh(projectile);
    projectile.userData.releaseMesh(projectile);
  } else {
    disposeProjectileMesh(projectile);
  }
  projectiles.splice(index, 1);
  if (body) {
    window.rbToMesh?.delete?.(body);
    if (window.rapierWorld?.getRigidBody(body.handle)) {
      window.rapierWorld.removeRigidBody(body);
    }
  }
}

export function spawnProjectile(scene, projectiles, position, direction, shooterId, options = {}) {
  const size = 0.5;
  const half = size / 2;
  const geometry = options.geometry || new THREE.BoxGeometry(size, size, size);
  const color = options.color || new THREE.Color(Math.random(), Math.random(), Math.random());
  const material = new THREE.MeshStandardMaterial({ color });
  let mesh = options.createMesh ? options.createMesh() : null;
  if (!mesh) {
    mesh = new THREE.Mesh(geometry, material);
  }
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
  mesh.userData.velocity = vel.clone();
  mesh.userData.prevY = mesh.position.y;
  mesh.userData.lifetime = Number.isFinite(options.lifetime) ? options.lifetime : 4000;
  mesh.userData.spawnTime = Date.now();
  mesh.userData.shooterId = shooterId;
  mesh.userData.pickupOnRest = options.pickupOnRest ?? false;
  mesh.userData.pickupAmount = options.pickupAmount ?? 0;
  mesh.userData.spawnPickup = options.spawnPickup ?? null;
  mesh.userData.isArrow = options.isArrow ?? false;
  mesh.userData.releaseMesh = options.releaseMesh ?? null;
  mesh.userData.onGroundHit = options.onGroundHit ?? null;
  mesh.userData.hasHitGround = false;
  scene.add(mesh);
  projectiles.push(mesh);
}

export function updateProjectiles({
  scene,
  projectiles,
  otherPlayers,
  playerModel,
  multiplayer,
  monsters,
  sendMonsterAttack,
  onMonsterHit
}) {
  const localId = multiplayer?.getId?.();
  const isHost = !multiplayer || multiplayer.isHost;
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
        if (proj.userData?.isArrow) playArrowBlockedSFX();
        removeProjectile(i);
        continue;
      }
      linvel = body.linvel();
    } catch (e) {
      removeProjectile(i);
      continue;
    }

    const vel = new THREE.Vector3(linvel.x, linvel.y, linvel.z);
    proj.userData.velocity = vel.clone();
    const sampledGroundY = getTerrainHeight(proj.position.x, proj.position.z);
    const prevY = Number.isFinite(proj.userData.prevY) ? proj.userData.prevY : proj.position.y;
    const crossedGround = Number.isFinite(sampledGroundY)
      ? (prevY > sampledGroundY && proj.position.y <= sampledGroundY)
      : false;
    updateArrowProjectile(proj, rb, vel, sampledGroundY, crossedGround);

    if (typeof proj.userData.onGroundHit === 'function' && !proj.userData.hasHitGround) {
      if (crossedGround && vel.y <= 0.1) {
        proj.userData.hasHitGround = true;
        proj.userData.onGroundHit(proj.position.clone(), proj);
        if (proj.userData?.isArrow) playArrowBlockedSFX();
        removeProjectile(i);
        continue;
      }
    }

    proj.userData.lifetime -= 16;
    if (proj.userData.lifetime <= 0) {
      if (proj.userData.pickupOnRest && typeof proj.userData.spawnPickup === 'function') {
        proj.userData.spawnPickup(proj.position.clone(), proj.userData.pickupAmount || 1);
      }
      removeProjectile(i);
      continue;
    }

    if (proj.userData.pickupOnRest && !proj.userData.arrowStuck && typeof proj.userData.spawnPickup === 'function') {
      const speed = vel.length();
      if (speed < 0.6 && proj.position.y <= 1.0) {
        proj.userData.spawnPickup(proj.position.clone(), proj.userData.pickupAmount || 1);
        if (proj.userData?.isArrow) playArrowBlockedSFX();
        removeProjectile(i);
        continue;
      }
    }

    proj.userData.prevY = proj.position.y;
    const age = Date.now() - proj.userData.spawnTime;

    let removed = false;
    const projBox = getObjectBox(proj);
    if (!projBox) {
      continue;
    }

    for (const [id, { model }] of Object.entries(otherPlayers)) {
      if (proj.userData.shooterId && proj.userData.shooterId === id) continue;
      if (age < 80) continue;
      const playerBox = getObjectBox(model);
      if (!playerBox) continue;
      if (projBox.intersectsBox(playerBox)) {
        const player = otherPlayers[id];
        if (player) {
          const damage = proj.userData.shooterId === localId ? getStrengthDamage(1) : 1;
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
        if (proj.userData?.isArrow) playArrowBlockedSFX();
        removeProjectile(i);
        removed = true;
        break;
      }
    }

    if (removed) continue;

    const localBox = getObjectBox(playerModel);
    if (!localBox) continue;
    if (projBox.intersectsBox(localBox) && age >= 80 && proj.userData.shooterId !== localId) {
      console.log(`💥 You were hit`);
      if (proj.userData?.isArrow) playArrowBlockedSFX();
      removeProjectile(i);
      removed = true;

      if (typeof window.localHealth === 'number') {
        const damage = proj.userData.shooterId === localId ? getStrengthDamage(1) : 1;
        window.localHealth = Math.max(0, window.localHealth - damage);
        console.log(`❤️ Your Health: ${window.localHealth}`);
      }

      const playerControls = appContext.systems.playerControls ?? window.playerControls;
      if (playerControls) {
        playerControls.applyKnockback({ direction: vel, strength: 3 });
      }
    }

    if (removed) continue;

    if (isHost && Array.isArray(monsters)) {
      for (const monster of monsters) {
        const monsterBox = getObjectBox(monster?.model);
        if (!monsterBox) continue;
        if (projBox.intersectsBox(monsterBox) && age >= 80) {
          console.log(`💥 Monster was hit`);
          const damage = proj.userData.shooterId === localId ? getStrengthDamage(1) : 1;
          const killed = monster.applyDamage(damage);
          if (!killed) {
            const direction = vel.clone();
            monster.applyKnockback({ direction, strength: 3 });
          }
          onMonsterHit?.(monster, { damage, killed, sourceId: proj.userData.shooterId });
          if (killed && proj.userData.shooterId === localId) {
            const withFriend = window.questManager?.isFriendActive?.() ?? false;
            window.onMonsterKill?.(monster, { withFriend });
          }
          if (proj.userData?.isArrow) playArrowBlockedSFX();
          removeProjectile(i);
          removed = true;
          break;
        }
      }
    } else if (!isHost && Array.isArray(monsters)) {
      for (const monster of monsters) {
        const monsterBox = getObjectBox(monster?.model);
        if (!monsterBox) continue;
        if (projBox.intersectsBox(monsterBox) && age >= 80) {
          const damage = proj.userData.shooterId === localId ? getStrengthDamage(1) : 1;
          sendMonsterAttack?.({
            monsterId: monster.id,
            damage,
            sourcePlayerId: proj.userData.shooterId || localId,
            at: Date.now()
          });
          if (proj.userData?.isArrow) playArrowBlockedSFX();
          removeProjectile(i);
          removed = true;
          break;
        }
      }
    }
  }
}

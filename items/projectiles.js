import * as THREE from "three";
import RAPIER from '@dimforge/rapier3d-compat';
import { updateArrowProjectile } from "./arrow.js";

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
  const groundY = half;
  if (mesh.position.y < groundY) {
    mesh.position.y = groundY;
  }

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
  mesh.userData.lifetime = Number.isFinite(options.lifetime) ? options.lifetime : 4000;
  mesh.userData.spawnTime = Date.now();
  mesh.userData.shooterId = shooterId;
  mesh.userData.pickupOnRest = options.pickupOnRest ?? false;
  mesh.userData.pickupAmount = options.pickupAmount ?? 0;
  mesh.userData.spawnPickup = options.spawnPickup ?? null;
  mesh.userData.isArrow = options.isArrow ?? false;
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
        return Math.max(0, baseDamage + strength);
      }
    }
    return baseDamage;
  };
  const removeProjectile = (index) => {
    const p = projectiles[index];
    const body = p.userData.rb;
    disposeProjectileMesh(p);
    projectiles.splice(index, 1);
    window.rbToMesh.delete(body);
    if (window.rapierWorld?.getRigidBody(body.handle)) {
      window.rapierWorld.removeRigidBody(body);
    }
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
    proj.userData.velocity = vel.clone();
    updateArrowProjectile(proj, rb, vel);

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
        removeProjectile(i);
        continue;
      }
    }

    const age = Date.now() - proj.userData.spawnTime;

    let removed = false;

    for (const [id, { model }] of Object.entries(otherPlayers)) {
      if (proj.userData.shooterId && proj.userData.shooterId === id) continue;
      if (age < 80) continue;
      const projBox = new THREE.Box3().setFromObject(proj);
      const playerBox = new THREE.Box3().setFromObject(model);
      if (projBox.intersectsBox(playerBox)) {
        const player = otherPlayers[id];
        if (player) {
          const damage = proj.userData.shooterId === localId ? getStrengthDamage(10) : 10;
          const previousHealth = player.health || 100;
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

    // Check destructible props loaded via LevelLoader
    if (window.breakManager) {
      for (const [id, data] of window.breakManager.registry.entries()) {
        const projBox = new THREE.Box3().setFromObject(proj);
        if (projBox.intersectsBox(data.bbox)) {
          window.breakManager.onHit(id, 25, proj.userData.velocity.clone());
          const remaining = window.breakManager.registry.get(id)?.health ?? 0;
          console.log(`🎯 ${id} health: ${remaining}`);
          removeProjectile(i);
          removed = true;
          break;
        }
      }
    }

    if (removed) continue;

    const projBox = new THREE.Box3().setFromObject(proj);
    const localBox = new THREE.Box3().setFromObject(playerModel);
    if (projBox.intersectsBox(localBox) && age >= 80 && proj.userData.shooterId !== localId) {
      console.log(`💥 You were hit`);
      removeProjectile(i);
      removed = true;

      if (typeof window.localHealth === 'number') {
        const damage = proj.userData.shooterId === localId ? getStrengthDamage(10) : 10;
        window.localHealth = Math.max(0, window.localHealth - damage);
        console.log(`❤️ Your Health: ${window.localHealth}`);
      }

      if (window.playerControls) {
        window.playerControls.applyKnockback({ direction: vel, strength: 3 });
      }
    }

    if (removed) continue;

    if (isHost && Array.isArray(monsters)) {
      for (const monster of monsters) {
        if (!monster) continue;
        const monsterBox = new THREE.Box3().setFromObject(monster.model);
        if (projBox.intersectsBox(monsterBox) && age >= 80) {
          console.log(`💥 Monster was hit`);
          const damage = proj.userData.shooterId === localId ? getStrengthDamage(10) : 10;
          const killed = monster.applyDamage(damage);
          if (!killed) {
            const direction = vel.clone();
            monster.applyKnockback({ direction, strength: 3 });
          }
          onMonsterHit?.(monster, { damage, killed, sourceId: proj.userData.shooterId });
          if (killed && proj.userData.shooterId === localId) {
            window.onMonsterKill?.();
          }
          removeProjectile(i);
          removed = true;
          break;
        }
      }
    } else if (!isHost && Array.isArray(monsters)) {
      for (const monster of monsters) {
        if (!monster) continue;
        const monsterBox = new THREE.Box3().setFromObject(monster.model);
        if (projBox.intersectsBox(monsterBox) && age >= 80) {
          const damage = proj.userData.shooterId === localId ? getStrengthDamage(10) : 10;
          sendMonsterAttack?.({
            monsterId: monster.id,
            damage,
            sourcePlayerId: proj.userData.shooterId || localId,
            at: Date.now()
          });
          removeProjectile(i);
          removed = true;
          break;
        }
      }
    }
  }
}

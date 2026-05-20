import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { MonsterCharacter } from '../characters/MonsterCharacter.js';

const ANIMAL_TYPES = ['Deer', 'Crab'];
const SPAWN_MIN_RADIUS = 10;
const SPAWN_MAX_RADIUS = 26;
const SPAWN_ATTEMPTS = 10;
const DEATH_REMOVE_DELAY_MS = 15000;
const DEER_HIT_REACT_ANIMATIONS = [
  'AnimalArmature|Idle_HitReact_Left',
  'AnimalArmature|Idle_HitReact_Right'
];

const loader = new GLTFLoader();
const animalTemplateCache = new Map();
let animalSpawnCursor = 0;

const randomRange = (min, max) => min + Math.random() * (max - min);

function getModelBounds(modelRoot) {
  if (!modelRoot) return null;
  modelRoot.updateWorldMatrix(true, true);

  const meshBounds = new THREE.Box3();
  let hasMeshBounds = false;

  modelRoot.traverse((obj) => {
    if (!obj?.isMesh || !obj.geometry) return;
    if (!obj.geometry.boundingBox) {
      obj.geometry.computeBoundingBox();
    }
    const localBounds = obj.geometry.boundingBox;
    if (!localBounds) return;
    const worldBounds = localBounds.clone().applyMatrix4(obj.matrixWorld);
    if (!hasMeshBounds) {
      meshBounds.copy(worldBounds);
      hasMeshBounds = true;
    } else {
      meshBounds.union(worldBounds);
    }
  });

  if (hasMeshBounds) return meshBounds;

  const fallback = new THREE.Box3().setFromObject(modelRoot);
  if (fallback.isEmpty()) return null;
  return fallback;
}

async function loadAnimalTemplate(typeName) {
  const cached = animalTemplateCache.get(typeName);
  if (cached) return cached;

  const configPath = `/models/animals/${encodeURIComponent(typeName)}.json`;
  const modelPath = `/models/animals/${encodeURIComponent(typeName)}.glb`;
  const config = await fetch(configPath)
    .then(res => (res.ok ? res.json() : {}))
    .catch(() => ({}));

  const gltf = await loader.loadAsync(modelPath);
  const baseScene = gltf.scene;
  const clips = Array.isArray(gltf.animations) ? gltf.animations : [];

  const template = { typeName, config, baseScene, clips };
  animalTemplateCache.set(typeName, template);
  return template;
}

function findClip(clips, ...names) {
  for (const name of names) {
    if (!name) continue;
    const clip = clips.find(entry => entry?.name === name);
    if (clip) return clip;
  }
  return null;
}

function resolveAnimationMap(config = {}, clips = []) {
  const aliases = config.animations || {};
  const pick = (key, ...fallbacks) => findClip(clips, aliases[key], ...fallbacks);
  const animationMap = {
    Idle: pick('Idle', 'Idle', 'AnimalArmature|Idle', 'Idle_2', 'AnimalArmature|Idle_2', 'Idle_Headlow', 'AnimalArmature|Idle_Headlow'),
    Walk: pick('Walk', 'Walk', 'AnimalArmature|Walk'),
    Run: pick('Run', 'Gallop', 'AnimalArmature|Gallop'),
    Weapon: pick('Attack', 'Attack_Headbutt', 'AnimalArmature|Attack_Headbutt', 'Attack_Kick', 'AnimalArmature|Attack_Kick'),
    Death: pick('Death', 'Death', 'AnimalArmature|Death'),
    Hit: pick('Hit', 'Idle_HitReact_Left', 'AnimalArmature|Idle_HitReact_Left', 'Idle_HitReact_Right', 'AnimalArmature|Idle_HitReact_Right')
  };
  DEER_HIT_REACT_ANIMATIONS.forEach((name, index) => {
    const clip = findClip(clips, name);
    if (clip) {
      animationMap[`HitReact${index + 1}`] = clip;
    }
  });
  return animationMap;
}

async function spawnAnimal({ scene, getPlayerModel, getTerrainHeight, forcedPosition = null, forcedType = null }) {
  const playerModel = getPlayerModel?.();
  if (!scene || !playerModel?.position) return null;
  const typeName = forcedType || ANIMAL_TYPES[animalSpawnCursor % ANIMAL_TYPES.length];
  animalSpawnCursor += 1;
  const template = await loadAnimalTemplate(typeName);

  const modelRoot = SkeletonUtils.clone(template.baseScene);
  modelRoot.traverse(obj => {
    if (!obj.isMesh) return;
    obj.castShadow = true;
    obj.receiveShadow = true;
  });

  const scale = Number.isFinite(template.config.scale) ? template.config.scale : 1;
  console.log(`Spawning animal of type "${typeName}" with scale ${scale}.`);
  modelRoot.scale.setScalar(scale);

  const box = getModelBounds(modelRoot) || new THREE.Box3(new THREE.Vector3(-0.5, 0, -0.5), new THREE.Vector3(0.5, 1, 0.5));
  const center = box.getCenter(new THREE.Vector3());
  const yOffset = (template.config.yOffset ?? 0) - box.min.y;
  const zOffset = template.config.zOffset ?? 0;

  const group = new THREE.Group();
  const pivot = new THREE.Group();
  pivot.position.set(-center.x, yOffset, -center.z - zOffset);
  pivot.add(modelRoot);
  group.add(pivot);
  group.userData.pivot = pivot;
  group.userData.modelRoot = modelRoot;

  const mixer = new THREE.AnimationMixer(modelRoot);
  const animationMap = resolveAnimationMap(template.config, template.clips);
  const actions = {};
  Object.entries(animationMap).forEach(([key, clip]) => {
    if (!clip) return;
    const action = mixer.clipAction(clip);
    if (key === 'Weapon' || key === 'Death' || key === 'Hit') {
      action.loop = THREE.LoopOnce;
      action.clampWhenFinished = true;
    }
    actions[key] = action;
  });

  const animal = new MonsterCharacter({ model: group, mixer, actions });
  animal.id = `animal:${Date.now()}:${Math.floor(Math.random() * 1e6)}`;
  animal.type = typeName;
  animal.model.userData.type = typeName;
  animal.model.userData.animal = true;
  animal.model.userData.behavior = template.config.behavior || 'runAway';
  animal.playAnimation('Idle', 0.01);
  animal.setMode('friendly');

  const maxHealth = Number.isFinite(template.config.health) ? Math.max(1, Math.round(template.config.health)) : animal.maxHealth;
  animal.maxHealth = maxHealth;
  animal.health = maxHealth;
  animal.model.userData.maxHealth = maxHealth;
  animal.model.userData.health = maxHealth;
  animal.updateHealthBarTexture();
  animal.updateHealthBarScale();

  let spawnPosition = null;
  if (forcedPosition?.clone) {
    spawnPosition = forcedPosition.clone();
    const forcedTerrain = getTerrainHeight?.(spawnPosition.x, spawnPosition.z);
    if (Number.isFinite(forcedTerrain)) {
      spawnPosition.y = forcedTerrain + 0.4;
    }
  }

  for (let attempt = 0; !spawnPosition && attempt < SPAWN_ATTEMPTS; attempt += 1) {
    const angle = Math.random() * Math.PI * 2;
    const radius = randomRange(SPAWN_MIN_RADIUS, SPAWN_MAX_RADIUS);
    const x = playerModel.position.x + Math.cos(angle) * radius;
    const z = playerModel.position.z + Math.sin(angle) * radius;
    const terrain = getTerrainHeight?.(x, z);
    if (!Number.isFinite(terrain)) continue;
    spawnPosition = new THREE.Vector3(x, terrain + 0.4, z);
    break;
  }
  if (!spawnPosition) {
    spawnPosition = playerModel.position.clone();
    spawnPosition.x += SPAWN_MIN_RADIUS;
    spawnPosition.y = (getTerrainHeight?.(spawnPosition.x, spawnPosition.z) ?? playerModel.position.y) + 0.4;
  }

  animal.setPosition(spawnPosition.x, spawnPosition.y, spawnPosition.z);
  animal.model.rotation.y = Math.random() * Math.PI * 2;
  animal.userData = {
    state: 'idle',
    decisionAt: Date.now() + randomRange(1200, 3200),
    stateUntil: Date.now() + randomRange(1800, 4000),
    wanderDir: new THREE.Vector3(),
    runAwayUntil: 0,
    nextHitReactIndex: 0
  };

  animal.getNextHitAnimationName = () => {
    if (animal.type !== 'Deer') return 'Hit';
    const options = ['HitReact1', 'HitReact2'].filter(name => !!animal.actions?.[name]);
    if (!options.length) {
      return animal.actions?.Hit ? 'Hit' : null;
    }
    const nextIndex = animal.userData?.nextHitReactIndex ?? 0;
    const animationName = options[nextIndex % options.length];
    animal.userData.nextHitReactIndex = (nextIndex + 1) % options.length;
    return animationName;
  };

  scene.add(animal.model);

  return { animal, config: template.config };
}


function getCombatTargetPosition(target) {
  if (!target) return null;
  if (target.model?.position) return target.model.position;
  if (target.position) return target.position;
  return null;
}

function isCombatTargetDead(target) {
  if (!target) return true;
  if (target.isDead || target.model?.userData?.isDead || target.userData?.isDead) return true;
  const health = target.model?.userData?.health ?? target.userData?.health ?? target.health;
  return Number.isFinite(health) && health <= 0;
}

function applyCompanionDamageToMonster(target, damage, { animal, onMonsterAttack } = {}) {
  if (!target || isCombatTargetDead(target) || !Number.isFinite(damage) || damage <= 0) return false;
  const attackTypes = ['companion', 'dog', 'melee'];
  let killed = false;
  if (typeof target.applyDamage === 'function') {
    killed = !!target.applyDamage(damage, { attackTypes });
    if (!killed && typeof target.applyKnockback === 'function' && animal?.model?.position && target.model?.position) {
      const direction = target.model.position.clone().sub(animal.model.position).setY(0);
      if (direction.lengthSq() > 0.0001) {
        target.applyKnockback({ direction: direction.normalize(), strength: 1.1 });
      }
    }
  } else if (target.userData) {
    target.userData.health = Math.max(0, (target.userData.health || 10) - damage);
    killed = target.userData.health <= 0;
    target.userData.isDead = killed || target.userData.isDead;
  }
  onMonsterAttack?.(target, {
    damage,
    killed,
    sourceId: animal?.id || null,
    attackTypes,
    at: Date.now()
  });
  return killed;
}

function isHitReactPlaying(animal) {
  if (!animal?.currentAction || !animal?.actions) return false;
  if (animal.currentAction === 'Hit') {
    return !!animal.actions.Hit?.isRunning?.();
  }
  if (!animal.currentAction.startsWith('HitReact')) return false;
  const action = animal.actions[animal.currentAction];
  return !!action?.isRunning?.();
}

function updateAnimalMovement({ animal, config, getPlayerModel, getTerrainHeight, getNearbyMonster, onMonsterAttack, delta }) {
  const playerModel = getPlayerModel?.();
  if (!animal?.model || !playerModel?.position) return;
  if (animal.isDead) {
    animal.update(delta);
    return;
  }

  const now = Date.now();
  const behavior = config.behavior || 'runAway';
  const fleeDistance = Number.isFinite(config.fleeDistance) ? config.fleeDistance : 8;
  const walkSpeed = Number.isFinite(config.walkSpeed) ? config.walkSpeed : 1.2;
  const runSpeed = Number.isFinite(config.runSpeed) ? config.runSpeed : 4.8;
  const attackDistance = Number.isFinite(config.attackDistance) ? config.attackDistance : 2.3;
  const monsterAttackRange = Number.isFinite(config.attackRange) ? Math.max(0.5, config.attackRange) : attackDistance;
  const monsterDetectRange = Number.isFinite(config.monsterDetectRange) ? Math.max(monsterAttackRange, config.monsterDetectRange) : 9;
  const ownerReturnDistance = Number.isFinite(config.ownerReturnDistance) ? Math.max(1, config.ownerReturnDistance) : 18;
  const companionAttackDamage = Number.isFinite(config.attackDamage) ? Math.max(1, config.attackDamage) : 3;

  const distanceToPlayer = animal.model.position.distanceTo(playerModel.position);
  const data = animal.userData || {};

  const isCompanionBehavior = behavior === 'companion';
  const isCompanion = !!animal.model?.userData?.isCompanion;
  let nearbyMonster = null;
  if (isCompanion) {
    const currentTarget = data.companionAttackTarget;
    const currentTargetPosition = getCombatTargetPosition(currentTarget);
    if (currentTargetPosition
      && !isCombatTargetDead(currentTarget)
      && currentTargetPosition.distanceTo(animal.model.position) <= monsterDetectRange * 1.5
      && distanceToPlayer <= ownerReturnDistance) {
      nearbyMonster = currentTarget;
    } else {
      data.companionAttackTarget = null;
      nearbyMonster = getNearbyMonster?.(animal.model.position, monsterDetectRange) || null;
    }
  }

  if (isCompanionBehavior && isCompanion && nearbyMonster && distanceToPlayer <= ownerReturnDistance) {
    data.state = 'companionAttack';
    data.companionAttackTarget = nearbyMonster;
  } else if (isCompanionBehavior && isCompanion) {
    data.companionAttackTarget = null;
    data.companionAttackPhase = null;
    data.companionAttackHasHit = false;

    data.state = 'companionFollow';
  } else if (behavior === 'runAway' && distanceToPlayer <= fleeDistance) {
    data.state = 'runAway';
    data.runAwayUntil = now + 1600;
  } else if (behavior === 'attack' && distanceToPlayer <= attackDistance) {
    data.state = 'attack';
    data.stateUntil = now + 900;
  } else if (behavior === 'idle') {
    if (data.state === 'runAway' || data.state === 'attack') {
      data.state = 'idle';
    }
  } else if (data.state === 'runAway' && now > (data.runAwayUntil || 0)) {
    data.state = 'idle';
    data.stateUntil = now + randomRange(1000, 2200);
  } else if (data.state === 'attack' && now > (data.stateUntil || 0)) {
    data.state = 'idle';
    data.stateUntil = now + randomRange(1000, 2200);
  }

  if ((data.state === 'idle' || data.state === 'walk') && now >= (data.decisionAt || 0)) {
    const shouldWalk = Math.random() > 0.45;
    data.state = shouldWalk ? 'walk' : 'idle';
    data.decisionAt = now + randomRange(1500, 3200);
    data.stateUntil = now + randomRange(1500, 3500);
    if (shouldWalk) {
      const angle = Math.random() * Math.PI * 2;
      data.wanderDir = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle)).normalize();
    }
  }

  const hitReactLocked = isHitReactPlaying(animal);

  if (data.state === 'companionFollow') {
    if (!Number.isFinite(data.followRadius)) {
      data.followRadius = randomRange(2.8, 6.2);
    }
    if (!Number.isFinite(data.followStartPadding)) {
      data.followStartPadding = randomRange(0.9, 1.8);
    }
    if (!Number.isFinite(data.nextFollowRetargetAt)) {
      data.nextFollowRetargetAt = now;
    }
    if (!Number.isFinite(data.followSlotAngle)) {
      data.followSlotAngle = Math.random() * Math.PI * 2;
    }

    if (now >= data.nextFollowRetargetAt || !data.followAnchor) {
      data.followSlotAngle += randomRange(-0.9, 0.9);
      const offset = new THREE.Vector3(
        Math.cos(data.followSlotAngle) * data.followRadius,
        0,
        Math.sin(data.followSlotAngle) * data.followRadius
      );
      data.followAnchor = playerModel.position.clone().add(offset);
      data.nextFollowRetargetAt = now + randomRange(3000, 10000);
    }

    const direction = new THREE.Vector3().subVectors(data.followAnchor, animal.model.position).setY(0);
    const distance = direction.length();
    const followStartDistance = data.followRadius + data.followStartPadding;
    if (distance > followStartDistance) {
      data.isFollowingAnchor = true;
    } else if (distance <= data.followRadius) {
      data.isFollowingAnchor = false;
    }

    if (data.isFollowingAnchor && distance > 0.0001) {
      direction.normalize();
      animal.model.position.addScaledVector(direction, runSpeed * 0.8 * delta);
      animal.model.lookAt(animal.model.position.clone().add(direction));
      if (!hitReactLocked) animal.playAnimation('Run', 0.12);
    } else if (!hitReactLocked) {
      animal.playAnimation('Idle', 0.15);
    }
  } else if (data.state === 'companionAttack') {
    const target = data.companionAttackTarget || getNearbyMonster?.(animal.model.position, monsterDetectRange);
    const targetPosition = getCombatTargetPosition(target);
    if (!targetPosition || isCombatTargetDead(target) || distanceToPlayer > ownerReturnDistance) {
      data.companionAttackTarget = null;
      data.companionAttackPhase = null;
      data.companionAttackHasHit = false;
      data.state = 'companionFollow';
      if (!hitReactLocked) animal.playAnimation('Idle', 0.12);
    } else {
      data.companionAttackTarget = target;
      const direction = new THREE.Vector3().subVectors(targetPosition, animal.model.position).setY(0);
      const distance = direction.length();
      if (direction.lengthSq() < 0.0001) {
        direction.set(Math.random() - 0.5, 0, Math.random() - 0.5);
      }
      direction.normalize();
      const nowMs = now;
      const standoffDistance = Math.max(monsterAttackRange + 0.45, 1.4);
      const canStartAttack = nowMs >= (data.nextCompanionAttackAt || 0);

      if (!data.companionAttackPhase && distance <= standoffDistance && canStartAttack) {
        data.companionAttackPhase = 'retreat';
        data.companionAttackPhaseUntil = nowMs + 1000;
        data.companionAttackHasHit = false;
      }

      if (data.companionAttackPhase === 'retreat') {
        const retreatDirection = direction.clone().multiplyScalar(-1);
        animal.model.position.addScaledVector(retreatDirection, walkSpeed * 0.9 * delta);
        animal.model.lookAt(animal.model.position.clone().add(direction));
        if (!hitReactLocked) animal.playAnimation('Walk', 0.12);
        if (nowMs >= (data.companionAttackPhaseUntil || 0)) {
          data.companionAttackPhase = 'lunge';
          data.companionAttackPhaseStartedAt = nowMs;
          data.companionAttackPhaseUntil = nowMs + 520;
          data.companionAttackHasHit = false;
          animal.currentAction = animal.currentAction === 'Weapon' ? null : animal.currentAction;
        }
      } else if (data.companionAttackPhase === 'lunge') {
        animal.model.position.addScaledVector(direction, (runSpeed + 1.2) * delta);
        animal.model.lookAt(animal.model.position.clone().add(direction));
        if (!hitReactLocked) animal.playAnimation('Weapon', 0.08);
        const elapsed = nowMs - (data.companionAttackPhaseStartedAt || nowMs);
        if (!data.companionAttackHasHit && elapsed >= 180) {
          const latestTargetPosition = getCombatTargetPosition(target);
          const latestDistance = latestTargetPosition
            ? animal.model.position.distanceTo(latestTargetPosition)
            : Number.POSITIVE_INFINITY;
          if (latestDistance <= monsterAttackRange) {
            const killed = applyCompanionDamageToMonster(target, companionAttackDamage, { animal, onMonsterAttack });
            if (killed) {
              data.companionAttackTarget = null;
            }
          }
          data.companionAttackHasHit = true;
        }
        if (nowMs >= (data.companionAttackPhaseUntil || 0)) {
          data.companionAttackPhase = null;
          data.nextCompanionAttackAt = nowMs + 1000;
          if (!hitReactLocked) animal.playAnimation('Run', 0.08);
        }
      } else if (distance > standoffDistance) {
        animal.model.position.addScaledVector(direction, runSpeed * delta);
        animal.model.lookAt(animal.model.position.clone().add(direction));
        if (!hitReactLocked) animal.playAnimation('Run', 0.1);
      } else if (!canStartAttack) {
        animal.model.lookAt(animal.model.position.clone().add(direction));
        if (distance < monsterAttackRange * 0.75) {
          animal.model.position.addScaledVector(direction, -walkSpeed * 0.7 * delta);
          if (!hitReactLocked) animal.playAnimation('Walk', 0.12);
        } else if (!hitReactLocked) {
          animal.playAnimation('Idle', 0.12);
        }
      }
    }
  } else if (data.state === 'runAway') {
    const direction = new THREE.Vector3().subVectors(animal.model.position, playerModel.position).setY(0);
    if (direction.lengthSq() < 0.0001) {
      direction.set(Math.random() - 0.5, 0, Math.random() - 0.5);
    }
    direction.normalize();
    animal.model.position.addScaledVector(direction, runSpeed * delta);
    animal.model.lookAt(animal.model.position.clone().add(direction));
    if (!hitReactLocked) {
      animal.playAnimation('Run', 0.12);
    }
  } else if (data.state === 'attack') {
    if (!hitReactLocked) {
      animal.playAnimation('Weapon', 0.08);
    }
  } else if (data.state === 'walk') {
    if (!data.wanderDir || data.wanderDir.lengthSq() < 0.0001) {
      data.wanderDir = new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5).normalize();
    }
    animal.model.position.addScaledVector(data.wanderDir, walkSpeed * delta);
    animal.model.lookAt(animal.model.position.clone().add(data.wanderDir));
    if (!hitReactLocked) {
      animal.playAnimation('Walk', 0.15);
    }
  } else if (!hitReactLocked) {
    animal.playAnimation('Idle', 0.15);
  }

  const terrain = getTerrainHeight?.(animal.model.position.x, animal.model.position.z);
  if (Number.isFinite(terrain)) {
    animal.model.position.y = terrain + 0.4;
  }

  animal.update(delta);
}

export function createAnimalManager({
  scene,
  getPlayerModel,
  getTerrainHeight,
  onAnimalRemoved,
  getNearbyMonster,
  onMonsterAttack,
  isHost = false,
  onRemoteSpawnRequest
} = {}) {
  const animals = [];
  let currentHost = !!isHost;
  let lastDogSpawnPlayerPosition = null;
  let lastDogSpawnAt = 0;
  const removeAnimal = (entry) => {
    if (!entry?.animal) return;
    const index = animals.indexOf(entry);
    if (index >= 0) {
      animals.splice(index, 1);
    }
    const model = entry.animal.model;
    const wasDead = !!entry.animal.isDead;
    const lastPosition = model?.position?.clone?.() || null;
    if (model?.parent) {
      model.parent.remove(model);
    }
    model?.userData?.mixer?.stopAllAction?.();
    onAnimalRemoved?.({ animal: entry.animal, wasDead, position: lastPosition });
  };

  const removeAnimalById = (animalId) => {
    if (!animalId) return false;
    const entry = animals.find((candidate) => candidate?.animal?.id === animalId);
    if (!entry) return false;
    removeAnimal(entry);
    return true;
  };

  const update = (delta) => {
    const now = Date.now();
    for (let i = animals.length - 1; i >= 0; i -= 1) {
      const entry = animals[i];
      const animal = entry?.animal;
      if (!animal?.model) {
        animals.splice(i, 1);
        continue;
      }
      if (animal.isDead && Number.isFinite(animal.deathTime) && now - animal.deathTime >= DEATH_REMOVE_DELAY_MS) {
        removeAnimal(entry);
        continue;
      }
      if (animal.model.userData?.remoteSynced) {
        animal.update(delta);
        continue;
      }
      updateAnimalMovement({ animal, config: entry.config || {}, getPlayerModel, getTerrainHeight, getNearbyMonster, onMonsterAttack, delta });
    }
  };

  const getAnimals = () => animals.map(entry => entry.animal).filter(Boolean);

  const pickWildAnimalType = () => (Math.random() < 0.8 ? 'Crab' : 'Deer');

  const spawnWildAnimalAt = async (position) => {
    const entry = await spawnAnimal({
      scene,
      getPlayerModel,
      getTerrainHeight,
      forcedPosition: position || null,
      forcedType: pickWildAnimalType()
    });
    if (entry) animals.push(entry);
    return entry?.animal || null;
  };

  const spawnDeerAt = async (position) => {
    const entry = await spawnAnimal({
      scene,
      getPlayerModel,
      getTerrainHeight,
      forcedPosition: position || null,
      forcedType: "Deer"
    });
    if (entry) {
      animals.push(entry);
    }
    return entry?.animal || null;
  };


  const hasLivingDog = () => animals.some((entry) => {
    const animal = entry?.animal;
    return animal?.model && !animal.isDead && String(animal.type).toLowerCase() === 'dog';
  });

  const spawnDogAt = async (position) => {
    const entry = await spawnAnimal({
      scene,
      getPlayerModel,
      getTerrainHeight,
      forcedPosition: position || null,
      forcedType: 'dog'
    });
    if (entry) {
      animals.push(entry);
      lastDogSpawnPlayerPosition = getPlayerModel?.()?.position?.clone?.() || null;
      lastDogSpawnAt = Date.now();
    }
    return entry?.animal || null;
  };

  const maybeSpawnDogByTravelDistance = async ({ minTravelDistance = 220, minSpawnIntervalMs = 90000 } = {}) => {
    const playerPosition = getPlayerModel?.()?.position;
    if (!playerPosition || hasLivingDog()) return null;
    const now = Date.now();
    if (now - lastDogSpawnAt < minSpawnIntervalMs) return null;
    if (lastDogSpawnPlayerPosition && playerPosition.distanceTo(lastDogSpawnPlayerPosition) < minTravelDistance) return null;
    if (!currentHost) {
      onRemoteSpawnRequest?.({
        type: 'companionDog',
        position: playerPosition.clone()
      });
      lastDogSpawnPlayerPosition = playerPosition.clone();
      lastDogSpawnAt = now;
      return null;
    }
    return spawnDogAt();
  };

  const setHost = (nextHost) => {
    currentHost = !!nextHost;
  };

  const getNearestFeedableDog = (position, maxDistance = 2.5) => {
    if (!position) return null;
    let best = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    animals.forEach((entry) => {
      const animal = entry?.animal;
      if (!animal?.model?.position || animal.isDead) return;
      if (String(animal.type).toLowerCase() !== 'dog') return;
      const dist = animal.model.position.distanceTo(position);
      if (dist <= maxDistance && dist < bestDistance) { best = animal; bestDistance = dist; }
    });
    return best ? { animal: best, distance: bestDistance } : null;
  };

  const feedDog = (dog, healthGain = 10) => {
    if (!dog?.model || dog.isDead) return false;
    dog.health = Math.min(dog.maxHealth || 1, (dog.health || 0) + healthGain);
    dog.model.userData.health = dog.health;
    dog.model.userData.isCompanion = true;
    dog.updateHealthBarTexture?.();
    return true;
  };

  return {
    update,
    getAnimals,
    removeAnimal,
    removeAnimalById,
    spawnDeerAt,
    spawnWildAnimalAt,
    spawnDogAt,
    maybeSpawnDogByTravelDistance,
    setHost,
    getNearestFeedableDog,
    feedDog
  };
}

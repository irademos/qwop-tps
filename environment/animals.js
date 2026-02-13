import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { MonsterCharacter } from '../characters/MonsterCharacter.js';

const TARGET_ANIMAL_COUNT = 3;
const ANIMAL_TYPES = ['Deer'];
const SPAWN_MIN_RADIUS = 10;
const SPAWN_MAX_RADIUS = 26;
const SPAWN_ATTEMPTS = 10;
const DEATH_REMOVE_DELAY_MS = 15000;

const loader = new GLTFLoader();
const animalTemplateCache = new Map();
let animalSpawnCursor = 0;

const randomRange = (min, max) => min + Math.random() * (max - min);

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
  return {
    Idle: pick('Idle', 'Idle', 'AnimalArmature|Idle', 'Idle_2', 'AnimalArmature|Idle_2', 'Idle_Headlow', 'AnimalArmature|Idle_Headlow'),
    Walk: pick('Walk', 'Walk', 'AnimalArmature|Walk'),
    Run: pick('Run', 'Gallop', 'AnimalArmature|Gallop'),
    Weapon: pick('Attack', 'Attack_Headbutt', 'AnimalArmature|Attack_Headbutt', 'Attack_Kick', 'AnimalArmature|Attack_Kick'),
    Death: pick('Death', 'Death', 'AnimalArmature|Death'),
    Hit: pick('Hit', 'Idle_HitReact_Left', 'AnimalArmature|Idle_HitReact_Left', 'Idle_HitReact_Right', 'AnimalArmature|Idle_HitReact_Right')
  };
}

async function spawnAnimal({ scene, getPlayerModel, getTerrainHeight }) {
  const playerModel = getPlayerModel?.();
  if (!scene || !playerModel?.position) return null;
  const typeName = ANIMAL_TYPES[animalSpawnCursor % ANIMAL_TYPES.length];
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

  const box = new THREE.Box3().setFromObject(modelRoot);
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
  for (let attempt = 0; attempt < SPAWN_ATTEMPTS; attempt += 1) {
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
    runAwayUntil: 0
  };

  scene.add(animal.model);
  return { animal, config: template.config };
}

function updateAnimalMovement({ animal, config, getPlayerModel, getTerrainHeight, delta }) {
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

  const distanceToPlayer = animal.model.position.distanceTo(playerModel.position);
  const data = animal.userData || {};

  if (behavior === 'runAway' && distanceToPlayer <= fleeDistance) {
    data.state = 'runAway';
    data.runAwayUntil = now + 1600;
  } else if (behavior === 'attack' && distanceToPlayer <= attackDistance) {
    data.state = 'attack';
    data.stateUntil = now + 900;
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

  if (data.state === 'runAway') {
    const direction = new THREE.Vector3().subVectors(animal.model.position, playerModel.position).setY(0);
    if (direction.lengthSq() < 0.0001) {
      direction.set(Math.random() - 0.5, 0, Math.random() - 0.5);
    }
    direction.normalize();
    animal.model.position.addScaledVector(direction, runSpeed * delta);
    animal.model.lookAt(animal.model.position.clone().add(direction));
    animal.playAnimation('Run', 0.12);
  } else if (data.state === 'attack') {
    animal.playAnimation('Weapon', 0.08);
  } else if (data.state === 'walk') {
    if (!data.wanderDir || data.wanderDir.lengthSq() < 0.0001) {
      data.wanderDir = new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5).normalize();
    }
    animal.model.position.addScaledVector(data.wanderDir, walkSpeed * delta);
    animal.model.lookAt(animal.model.position.clone().add(data.wanderDir));
    animal.playAnimation('Walk', 0.15);
  } else {
    animal.playAnimation('Idle', 0.15);
  }

  const terrain = getTerrainHeight?.(animal.model.position.x, animal.model.position.z);
  if (Number.isFinite(terrain)) {
    animal.model.position.y = terrain + 0.4;
  }

  animal.update(delta);
}

export function createAnimalManager({ scene, getPlayerModel, getTerrainHeight } = {}) {
  const animals = [];
  let spawningCount = 0;

  const removeAnimal = (entry) => {
    if (!entry?.animal) return;
    const index = animals.indexOf(entry);
    if (index >= 0) {
      animals.splice(index, 1);
    }
    const model = entry.animal.model;
    if (model?.parent) {
      model.parent.remove(model);
    }
    model?.userData?.mixer?.stopAllAction?.();
  };

  const ensureAnimals = async () => {
    if (!scene || !getPlayerModel?.()) return;
    while (animals.length + spawningCount < TARGET_ANIMAL_COUNT) {
      spawningCount += 1;
      spawnAnimal({ scene, getPlayerModel, getTerrainHeight })
        .then((entry) => {
          if (entry) animals.push(entry);
        })
        .catch((error) => {
          console.warn('Failed to spawn animal.', error);
        })
        .finally(() => {
          spawningCount = Math.max(0, spawningCount - 1);
        });
      break;
    }
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
      updateAnimalMovement({ animal, config: entry.config || {}, getPlayerModel, getTerrainHeight, delta });
    }
    ensureAnimals();
  };

  const getAnimals = () => animals.map(entry => entry.animal).filter(Boolean);

  return {
    update,
    ensureAnimals,
    getAnimals,
    removeAnimal
  };
}

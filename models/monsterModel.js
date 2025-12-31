// /models/monsterModel.js
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import * as THREE from 'three';

export const MONSTER_MODEL_PATHS = [
  '/models/rainbow_troll.fbx',
  '/models/swamp_guy.fbx',
  '/models/wizard.fbx',
  '/models/gemhorn_monster.fbx',
  '/models/alien_bumpy_bump.fbx'
];

const DEFAULT_ATTACKS = ['mutantPunch', 'mmaKick', 'runningKick', 'hurricaneKick'];

const ANIMATION_FILES = {
  idle: 'Breathing Idle.fbx',
  walk: 'Old Man Walk.fbx',
  run: 'Drunk Run Forward.fbx',
  hit: 'Flying Back Death.fbx',
  mutantPunch: 'Mutant Punch.fbx',
  mmaKick: 'Mma Kick.fbx',
  runningKick: 'Stand To Roll.fbx',
  hurricaneKick: 'Hurricane Kick.fbx',
  die: 'Dying.fbx'
};

function applyUnlitMaterials(model) {
  const lightsToRemove = [];

  model.traverse((obj) => {
    if (obj.isLight) {
      lightsToRemove.push(obj);
      return;
    }

    if (obj.isMesh) {
      obj.castShadow = false;
      obj.receiveShadow = false;

      const toBasic = (mat) => {
        if (!mat) return mat;
        const basicParams = {
          map: mat.map || null,
          color: (mat.color && mat.color.clone()) || new THREE.Color(0xffffff),
          transparent: !!mat.transparent,
          opacity: typeof mat.opacity === 'number' ? mat.opacity : 1,
          side: mat.side ?? THREE.FrontSide,
          vertexColors: !!mat.vertexColors,
          alphaMap: mat.alphaMap || null,
        };

        const newMat = new THREE.MeshBasicMaterial(basicParams);
        if (obj.isSkinnedMesh === true) newMat.skinning = true;
        if (typeof mat.dispose === 'function') {
          queueMicrotask(() => mat.dispose());
        }
        return newMat;
      };

      if (Array.isArray(obj.material)) {
        obj.material = obj.material.map(toBasic);
      } else if (obj.material) {
        obj.material = toBasic(obj.material);
      }
    }
  });

  for (const light of lightsToRemove) {
    if (light.parent) light.parent.remove(light);
  }
}

function loadMonsterModelWithPath(scene, modelPath, callback) {
  const loader = new FBXLoader();
  const configPath = modelPath.replace(/\.[^/.]+$/, '.json');

  fetch(configPath)
    .then((res) => (res.ok ? res.json() : {}))
    .catch(() => ({}))
    .then((config) => {
      loader.load(
        modelPath,
        (fbx) => {
          if (!fbx || typeof fbx.traverse !== 'function') {
            console.warn('FBXLoader returned an unexpected result:', fbx);
            return;
          }

          const monsterGroup = new THREE.Group();
          const model = fbx;

          try {
            applyUnlitMaterials(model);
          } catch (err) {
            console.error('While making monster FBX unlit:', err);
          }

          model.traverse((obj) => {
            if (obj.isSkinnedMesh || obj.isMesh) obj.frustumCulled = false;
            if (obj.material?.skinning === true) obj.material.skinning = true;
          });

          const scale = config.scale ?? 1;
          model.scale.set(scale, scale, scale);

          model.updateMatrixWorld(true);
          const box = new THREE.Box3().setFromObject(model);
          const center = box.getCenter(new THREE.Vector3());

          const pivot = new THREE.Group();
          const yOffset = (config.yOffset ?? 0) - box.min.y;
          const zOffset = config.zOffset ?? 0;
          pivot.position.set(-center.x, yOffset, -center.z - zOffset);
          pivot.add(model);
          monsterGroup.add(pivot);
          monsterGroup.userData.pivot = pivot;

          scene.add(monsterGroup);

          const mixer = new THREE.AnimationMixer(model);
          const rawActions = {};
          const animationSpeed = config.animationSpeed ?? 1;
          const perAnimationSpeeds = config.animationSpeeds ?? {};

          const fbxLoader = new FBXLoader();
          const promises = Object.entries(ANIMATION_FILES).map(([name, file]) => {
            return new Promise((resolve, reject) => {
              fbxLoader.load(
                `/models/animations/${encodeURIComponent(file)}`,
                (anim) => {
                  const clip = anim.animations[0];
                  if (!clip) {
                    resolve();
                    return;
                  }
                  const action = mixer.clipAction(clip);
                  if (['hit', 'mutantPunch', 'mmaKick', 'runningKick', 'hurricaneKick', 'die'].includes(name)) {
                    action.loop = THREE.LoopOnce;
                    action.clampWhenFinished = true;
                  }
                  const timeScale = perAnimationSpeeds[name] ?? animationSpeed;
                  action.setEffectiveTimeScale(timeScale);
                  rawActions[name] = action;
                  resolve();
                },
                undefined,
                reject
              );
            });
          });

          Promise.all(promises).then(() => {
            const attackOptions = DEFAULT_ATTACKS.filter((name) => rawActions[name]);
            const chosenAttack =
              attackOptions[Math.floor(Math.random() * attackOptions.length)] || 'mutantPunch';

            const actions = {
              Idle: rawActions.idle,
              Walk: rawActions.walk,
              Run: rawActions.run,
              HitReact: rawActions.hit,
              Death: rawActions.die,
              Weapon: rawActions[chosenAttack],
            };

            monsterGroup.userData.defaultAnimationSpeed = animationSpeed;
            monsterGroup.userData.animationSpeeds = {
              ...perAnimationSpeeds,
              Idle: perAnimationSpeeds.Idle ?? perAnimationSpeeds.idle,
              Walk: perAnimationSpeeds.Walk ?? perAnimationSpeeds.walk,
              Run: perAnimationSpeeds.Run ?? perAnimationSpeeds.run,
              Weapon: perAnimationSpeeds.Weapon ?? perAnimationSpeeds[chosenAttack],
              Death: perAnimationSpeeds.Death ?? perAnimationSpeeds.die,
              HitReact: perAnimationSpeeds.HitReact ?? perAnimationSpeeds.hit
            };
            monsterGroup.userData.selectedAttack = chosenAttack;

            actions.Idle?.play();
            monsterGroup.userData.currentAction = actions.Idle ? 'Idle' : null;

            callback({ model: monsterGroup, mixer, actions });
          });
        },
        undefined,
        (err) => {
          console.error('Failed to load monster model:', err);
        }
      );
    });
}

export function loadMonsterModel(scene, modelPath, callback) {
  loadMonsterModelWithPath(scene, modelPath, callback);
}

export function loadRandomMonsterModel(scene, callback) {
  const modelPath = MONSTER_MODEL_PATHS[Math.floor(Math.random() * MONSTER_MODEL_PATHS.length)];
  loadMonsterModelWithPath(scene, modelPath, callback);
}

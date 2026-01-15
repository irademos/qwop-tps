// /models/monsterModel.js
import * as THREE from "three";
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';

const animationFiles = {
  Idle: 'Breathing Idle.fbx',
  Walk: 'Old Man Walk.fbx',
  Run: 'Drunk Run Forward.fbx',
  Weapon: 'Mutant Punch.fbx',
  Death: 'Dying.fbx',
  TwistDance: 'Twist Dance.fbx'
};

const animationClipCache = new Map();
const missingAnimationLogs = new Set();

function normalizeLodConfigs(config) {
  if (!Array.isArray(config?.lods)) return [];
  return config.lods
    .filter((lod) => lod && typeof lod.path === 'string' && lod.path.trim())
    .map((lod) => ({
      path: lod.path,
      distance: Number.isFinite(lod.distance) ? lod.distance : null,
    }))
    .filter((lod) => lod.distance !== null);
}

function makeModelUnlit(model) {
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
          opacity: (typeof mat.opacity === 'number') ? mat.opacity : 1,
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

function logMissingAnimation(name, modelPath) {
  const key = `${modelPath}:${name}`;
  if (missingAnimationLogs.has(key)) return;
  missingAnimationLogs.add(key);
  console.warn(`Missing monster animation clip "${name}" for model ${modelPath}. Falling back to Idle.`);
}

export function loadMonsterModel(modelPath, callback) {
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

          const model = fbx;
          const modelName = modelPath.split('/').pop().toLowerCase();
          const fastModels = ['cowboy'];
          const forceFast = fastModels.some(n => modelName.includes(n));
          const lodConfigs = normalizeLodConfigs(config);

          makeModelUnlit(model);

          model.traverse(o => {
            if (o.isSkinnedMesh || o.isMesh) o.frustumCulled = false;
            if (o.material?.skinning === true) o.material.skinning = true;
          });

          const scale = config.scale ?? 1;
          model.scale.set(scale, scale, scale);

          model.updateMatrixWorld(true);
          const box = new THREE.Box3().setFromObject(model);
          const center = box.getCenter(new THREE.Vector3());

          const monsterGroup = lodConfigs.length ? new THREE.LOD() : new THREE.Group();
          const pivot = new THREE.Group();
          const yOffset = (config.yOffset ?? 0) - box.min.y;
          pivot.position.set(-center.x, yOffset, -center.z - (config.zOffset ?? 0));
          pivot.add(model);
          if (monsterGroup.isLOD) {
            monsterGroup.addLevel(pivot, 0);
          } else {
            monsterGroup.add(pivot);
          }
          monsterGroup.userData.pivot = pivot;
          monsterGroup.userData.modelRoot = model;

          const mixer = new THREE.AnimationMixer(model);
          const actions = {};
          const fbxLoader = new FBXLoader();
          const lodLoader = new FBXLoader();

          const promises = Object.entries(animationFiles).map(([name, file]) => {
            return new Promise((resolve, reject) => {
              const cachedClip = animationClipCache.get(file);
              if (cachedClip) {
                const action = mixer.clipAction(cachedClip);
                if (forceFast) {
                  action.setEffectiveTimeScale(10.0);
                }
                if (['Weapon', 'Death'].includes(name)) {
                  action.loop = THREE.LoopOnce;
                  action.clampWhenFinished = true;
                }
                actions[name] = action;
                resolve();
                return;
              }

              fbxLoader.load(
                `/models/animations/${encodeURIComponent(file)}`,
                (anim) => {
                  const clip = anim?.animations?.[0];
                  if (!clip) {
                    resolve();
                    return;
                  }
                  animationClipCache.set(file, clip);
                  const action = mixer.clipAction(clip);
                  if (forceFast) {
                    action.setEffectiveTimeScale(10.0);
                  }
                  if (['Weapon', 'Death'].includes(name)) {
                    action.loop = THREE.LoopOnce;
                    action.clampWhenFinished = true;
                  }
                  actions[name] = action;
                  resolve();
                },
                undefined,
                reject
              );
            });
          });

          const lodPromises = lodConfigs.map((lod) => {
            return new Promise((resolve) => {
              lodLoader.load(
                lod.path,
                (lodFbx) => {
                  if (!lodFbx || typeof lodFbx.traverse !== 'function') {
                    console.warn('LOD FBXLoader returned an unexpected result:', lodFbx);
                    resolve();
                    return;
                  }
                  const lodModel = lodFbx;
                  makeModelUnlit(lodModel);
                  lodModel.traverse(o => {
                    if (o.isSkinnedMesh || o.isMesh) o.frustumCulled = false;
                    if (o.material?.skinning === true) o.material.skinning = true;
                  });

                  lodModel.scale.set(scale, scale, scale);
                  lodModel.updateMatrixWorld(true);
                  const lodBox = new THREE.Box3().setFromObject(lodModel);
                  const lodCenter = lodBox.getCenter(new THREE.Vector3());
                  const lodPivot = new THREE.Group();
                  const lodYOffset = (config.yOffset ?? 0) - lodBox.min.y;
                  lodPivot.position.set(
                    -lodCenter.x,
                    lodYOffset,
                    -lodCenter.z - (config.zOffset ?? 0)
                  );
                  lodPivot.add(lodModel);
                  if (monsterGroup.isLOD) {
                    monsterGroup.addLevel(lodPivot, lod.distance);
                  } else {
                    monsterGroup.add(lodPivot);
                  }
                  resolve();
                },
                undefined,
                (err) => {
                  console.warn('Failed to load monster LOD model:', lod.path, err);
                  resolve();
                }
              );
            });
          });

          Promise.all([...promises, ...lodPromises]).then(() => {
            if (!actions.Idle) {
              logMissingAnimation('Idle', modelPath);
            }
            Object.keys(animationFiles).forEach((name) => {
              if (!actions[name]) {
                logMissingAnimation(name, modelPath);
                if (actions.Idle) {
                  actions[name] = actions.Idle;
                }
              }
            });

            actions.Idle?.play();
            monsterGroup.userData.currentAction = 'Idle';
            monsterGroup.userData.mixer = mixer;
            monsterGroup.userData.actions = actions;
            callback({ model: monsterGroup, mixer, actions, pivot, modelRoot: model });
          });
        },
        undefined,
        (err) => {
          console.error("Failed to load monster model:", err);
        }
      );
    });
}

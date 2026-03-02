// /models/monsterModel.js
import * as THREE from "three";
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';

const animationFiles = {
  Idle: 'Breathing Idle.fbx',
  Walk: 'Old Man Walk.fbx',
  Run: 'Drunk Run Forward.fbx',
  Weapon: 'Mutant Punch.fbx',
  JumpAttack: 'Jump Attack.fbx',
  Death: 'Dying.fbx',
  Hit: 'Flying Back Death.fbx',
  TwistDance: 'Twist Dance.fbx'
};

const animationClipCache = new Map();
const missingAnimationLogs = new Set();
const DEFAULT_MATERIAL_BRIGHTNESS = 1;
const BOUNDS_REFRESH_INTERVAL_MS = 250;
const CONSERVATIVE_BOUNDS_PADDING = 1.15;

function applyMaterialBrightness(model, brightness) {
  if (!Number.isFinite(brightness) || brightness === DEFAULT_MATERIAL_BRIGHTNESS) return;
  const clamped = THREE.MathUtils.clamp(brightness, 0, 2);
  const processedMaterials = new Set();
  model.traverse((obj) => {
    if (!obj.isMesh || !obj.material) return;
    const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
    materials.forEach((material) => {
      if (!material || processedMaterials.has(material)) return;
      processedMaterials.add(material);
      if (material?.color?.multiplyScalar) {
        material.color.multiplyScalar(clamped);
      }
      if (typeof material?.emissiveIntensity === 'number') {
        material.emissiveIntensity *= clamped;
      }
      material.needsUpdate = true;
    });
  });
}

function normalizeLodConfigs(config) {
  if (!Array.isArray(config?.lods)) return [];
  return config.lods
    .filter((lod) => lod && typeof lod.path === 'string' && lod.path.trim())
    .map((lod) => ({
      path: lod.path,
      distance: Number.isFinite(lod.distance) ? lod.distance : null,
    }))
    .filter((lod) => lod.distance !== null && lod.distance > 0)
    .sort((a, b) => a.distance - b.distance)
    .filter((lod, index, lods) => index === 0 || lod.distance > lods[index - 1].distance);
}

function configureMeshCulling(model) {
  const skinnedMeshes = [];
  model.traverse((obj) => {
    if (obj.material?.skinning === true) obj.material.skinning = true;
    if (!obj.isMesh) return;
    // Animated FBX characters can report stale/undersized bounds when far from
    // origin (common in GPS-sized worlds), which causes them to be culled even
    // while their gameplay/map positions are valid. Keep character meshes always
    // renderable to avoid disappearing NPCs.
    obj.frustumCulled = false;
    if (obj.geometry) {
      if (!obj.geometry.boundingBox) {
        obj.geometry.computeBoundingBox();
      }
      if (!obj.geometry.boundingSphere) {
        obj.geometry.computeBoundingSphere();
      }
    }
    if (!obj.isSkinnedMesh) return;
    skinnedMeshes.push(obj);

    const boundingSphere = obj.geometry?.boundingSphere;
    if (boundingSphere) {
      boundingSphere.radius *= CONSERVATIVE_BOUNDS_PADDING;
    }
    const boundingBox = obj.geometry?.boundingBox;
    if (boundingBox) {
      const padding = boundingBox.getSize(new THREE.Vector3()).length() * 0.08;
      boundingBox.expandByScalar(padding);
    }
  });
  return skinnedMeshes;
}

function createSkinnedBoundsUpdater(skinnedMeshes) {
  if (!Array.isArray(skinnedMeshes) || skinnedMeshes.length === 0) {
    return () => {};
  }
  let lastUpdateTime = -Infinity;

  return () => {
    const now = performance.now();
    if (now - lastUpdateTime < BOUNDS_REFRESH_INTERVAL_MS) return;
    lastUpdateTime = now;

    for (const mesh of skinnedMeshes) {
      if (!mesh?.isSkinnedMesh) continue;
      mesh.computeBoundingBox();
      mesh.computeBoundingSphere();
      if (mesh.boundingSphere) {
        mesh.boundingSphere.radius *= 1.05;
      }
    }
  };
}

function bindSkinnedMeshesToBaseSkeleton(baseModel, lodModel) {
  const baseBoneMap = new Map();
  baseModel.traverse((obj) => {
    if (obj.isBone && obj.name) {
      baseBoneMap.set(obj.name, obj);
    }
  });

  if (baseBoneMap.size === 0) return;

  lodModel.traverse((obj) => {
    if (!obj.isSkinnedMesh || !obj.skeleton) return;
    const bones = obj.skeleton.bones.map((bone) => baseBoneMap.get(bone.name) ?? bone);
    const skeleton = new THREE.Skeleton(bones, obj.skeleton.boneInverses);
    skeleton.calculateInverses();
    obj.bind(skeleton, obj.bindMatrix);
    obj.skeleton = skeleton;
  });
}

function stripEmbeddedLights(model) {
  const lightsToRemove = [];
  model.traverse((obj) => {
    if (obj.isLight) {
      lightsToRemove.push(obj);
      return;
    }

    if (obj.isMesh) {
      obj.castShadow = false;
      obj.receiveShadow = false;
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
          const lodConfigs = normalizeLodConfigs(config);

          stripEmbeddedLights(model);

          const skinnedMeshes = configureMeshCulling(model);

          const scale = config.scale ?? 1;
          const materialBrightness = config.materialBrightness ?? DEFAULT_MATERIAL_BRIGHTNESS;
          model.scale.set(scale, scale, scale);
          applyMaterialBrightness(model, materialBrightness);

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
                if (['Weapon', 'JumpAttack', 'Death', 'Hit'].includes(name)) {
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
                  if (['Weapon', 'JumpAttack', 'Death', 'Hit'].includes(name)) {
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
                  stripEmbeddedLights(lodModel);
                  skinnedMeshes.push(...configureMeshCulling(lodModel));

                  lodModel.scale.set(scale, scale, scale);
                  applyMaterialBrightness(lodModel, materialBrightness);
                  bindSkinnedMeshesToBaseSkeleton(model, lodModel);
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
            monsterGroup.userData.updateSkinnedBounds = createSkinnedBoundsUpdater(skinnedMeshes);
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

// /models/playerModel.js
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import * as THREE from 'three';

const EPSILON = 1e-4;
const animationClipCache = new Map();
const DEFAULT_MATERIAL_BRIGHTNESS = 1;

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
    .filter((lod) => lod.distance !== null);
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

function clampIndexRange(times, startTime, endTime) {
  let startIndex = 0;
  while (startIndex < times.length && times[startIndex] < startTime - EPSILON) {
    startIndex++;
  }
  if (startIndex > 0) startIndex -= 1;

  let endIndex = times.length - 1;
  while (endIndex >= 0 && times[endIndex] > endTime + EPSILON) {
    endIndex--;
  }
  if (endIndex < times.length - 1) endIndex += 1;
  if (endIndex < startIndex) endIndex = startIndex;
  return { startIndex, endIndex };
}

function sliceTrackByTime(track, startTime, endTime) {
  const { startIndex, endIndex } = clampIndexRange(track.times, startTime, endTime);
  const TrackClass = track.constructor;
  const valueSize = track.getValueSize();

  const timesSlice = track.times.slice(startIndex, endIndex + 1);
  if (timesSlice.length === 0) {
    const fallbackValues = track.values.slice(0, valueSize);
    const TimesCtor = track.times.constructor;
    const fallbackTimes = new TimesCtor(1);
    fallbackTimes[0] = 0;
    return new TrackClass(track.name, fallbackTimes, fallbackValues);
  }

  const baseTime = timesSlice[0];
  const TimesCtor = track.times.constructor;
  const adjustedTimes = new TimesCtor(timesSlice.length);
  for (let i = 0; i < timesSlice.length; i++) {
    adjustedTimes[i] = timesSlice[i] - baseTime;
  }

  const valuesSlice = track.values.slice(startIndex * valueSize, (endIndex + 1) * valueSize);
  const ValuesCtor = track.values.constructor;
  const adjustedValues = new ValuesCtor(valuesSlice.length);
  adjustedValues.set(valuesSlice);

  return new TrackClass(track.name, adjustedTimes, adjustedValues);
}

function combineTrackSegments(firstTrack, secondTrack) {
  if (!secondTrack) return firstTrack;

  const TrackClass = firstTrack.constructor;
  const valueSize = firstTrack.getValueSize();

  const secondTimesCtor = secondTrack.times.constructor;
  const secondValuesCtor = secondTrack.values.constructor;

  let trimmedSecondTimes = secondTrack.times;
  let trimmedSecondValues = secondTrack.values;
  if (trimmedSecondTimes.length > 1) {
    trimmedSecondTimes = trimmedSecondTimes.slice(1);
    trimmedSecondValues = trimmedSecondValues.slice(valueSize);
  } else {
    trimmedSecondTimes = new secondTimesCtor(0);
    trimmedSecondValues = new secondValuesCtor(0);
  }

  const TimesCtor = firstTrack.times.constructor;
  const ValuesCtor = firstTrack.values.constructor;
  const combinedTimes = new TimesCtor(firstTrack.times.length + trimmedSecondTimes.length);
  combinedTimes.set(firstTrack.times, 0);
  const offset = firstTrack.times.length > 0 ? firstTrack.times[firstTrack.times.length - 1] : 0;
  for (let i = 0; i < trimmedSecondTimes.length; i++) {
    combinedTimes[firstTrack.times.length + i] = trimmedSecondTimes[i] + offset;
  }

  const combinedValues = new ValuesCtor(firstTrack.values.length + trimmedSecondValues.length);
  combinedValues.set(firstTrack.values, 0);
  combinedValues.set(trimmedSecondValues, firstTrack.values.length);

  return new TrackClass(firstTrack.name, combinedTimes, combinedValues);
}

function clipWithExistingTargetsOnly(clip, root) {
  const names = new Set();
  root.traverse(o => names.add(o.name));
  const tracks = clip.tracks.filter(t => names.has(t.name.split('.')[0]));
  return new THREE.AnimationClip(clip.name, clip.duration, tracks);
}

function stripRootTranslationTracks(clip, rootName) {
  const candidates = new Set([
    rootName,
    'Hips',
    'mixamorig:Hips',
    'Root',
    'mixamorig:Root',
    'Armature'
  ].filter(Boolean).map(name => name.toLowerCase()));
  const tracks = clip.tracks.filter((track) => {
    if (!track.name.endsWith('.position') && !track.name.endsWith('.matrix')) return true;
    const nodeName = track.name.split('.')[0].toLowerCase();
    return !candidates.has(nodeName);
  });
  return new THREE.AnimationClip(clip.name, clip.duration, tracks);
}

export function createPlayerModel(
  THREE,
  username,
  onLoad,
  modelPath = '/models/cowboy.fbx'
) {
  const playerGroup = new THREE.Group();
  const loader = new FBXLoader();

  const configPath = modelPath.replace(/\.[^/.]+$/, '.json');
  fetch(configPath)
    .then((res) => (res.ok ? res.json() : {}))
    .catch(() => ({}))
    .then((config) => {
      loader.load(
        modelPath,
        (fbx) => {
          // Guard: make sure we actually got an Object3D
          if (!fbx || typeof fbx.traverse !== 'function') {
            console.warn('FBXLoader returned an unexpected result:', fbx);
            return;
          }

          const model = fbx;
          const lodConfigs = normalizeLodConfigs(config);
          const materialBrightness = config.materialBrightness ?? DEFAULT_MATERIAL_BRIGHTNESS;

          try {
            stripEmbeddedLights(model);
            console.log('✅ FBX lights stripped (no in-traverse mutations)');
          } catch (err) {
            console.error('While stripping FBX lights:', err);
          }

          model.traverse(o => {
            if (o.isSkinnedMesh || o.isMesh) o.frustumCulled = false;
            if (o.material?.skinning === true) o.material.skinning = true;
          });


          // Scale and center the model so it rotates around its midpoint
          const scale = config.scale ?? 1;
          model.scale.set(scale, scale, scale);
          applyMaterialBrightness(model, materialBrightness);

          // Center the FBX so rotations pivot around the model itself
          model.updateMatrixWorld(true);
          const box = new THREE.Box3().setFromObject(model);
          const center = box.getCenter(new THREE.Vector3());

          // Offset the model inside a pivot group instead of shifting the mesh directly
          const lodGroup = lodConfigs.length ? new THREE.LOD() : new THREE.Group();
          playerGroup.add(lodGroup);
          const pivot = new THREE.Group();
          const yOffset = (config.yOffset ?? 0) - box.min.y;
          pivot.position.set(-center.x, yOffset, -center.z - (config.zOffset ?? 0));
          pivot.add(model);
          if (lodGroup.isLOD) {
            lodGroup.addLevel(pivot, 0);
          } else {
            lodGroup.add(pivot);
          }
          playerGroup.userData.pivot = pivot;

          const mixer = new THREE.AnimationMixer(model);
          const actions = {};

          // Load Mixamo animations
          const fbxLoader = new FBXLoader();
          const lodLoader = new FBXLoader();
          const animationFiles = {
            idle: 'Breathing Idle.fbx',
            walk: 'Old Man Walk.fbx',
            run: 'Drunk Run Forward.fbx',
            jump: 'Joyful Jump.fbx',
            hit: 'Flying Back Death.fbx',
            mutantPunch: 'Mutant Punch.fbx',
            leftPunch: 'Left Punch.fbx',
            mmaKick: 'Mma Kick.fbx',
            runningKick: 'Stand To Roll.fbx',
            hurricaneKick: 'Hurricane Kick.fbx',
            projectile: 'Projectile.fbx',
            die: 'Dying.fbx',
            float: 'Floating.fbx',
            swim: 'Swimming.fbx',
            sit: 'Sitting Rubbing Arm.fbx',
            climb: 'Climbing Up Wall.fbx'
          };

          const promises = Object.entries(animationFiles).map(([name, file]) => {
            return new Promise((resolve, reject) => {
              const cachedClip = animationClipCache.get(file);
              if (cachedClip) {
                const rootName = model.name || 'Root';
                const clean = stripRootTranslationTracks(cachedClip, rootName);
                const action = mixer.clipAction(clean);
                if (name === 'walk') {
                  action.setEffectiveTimeScale(1.8);
                }
                if (
                  ['jump', 'hit', 'mutantPunch', 'leftPunch', 'mmaKick', 'runningKick', 'hurricaneKick', 'projectile', 'die'].includes(name)
                ) {
                  action.loop = THREE.LoopOnce;
                  action.clampWhenFinished = true;
                }
                if (name === 'climb') {
                  action.loop = THREE.LoopRepeat;
                }
                actions[name] = action;
                resolve();
                return;
              }

              fbxLoader.load(
                `/models/animations/${encodeURIComponent(file)}`,
                (anim) => {
                  const clip = anim.animations[0];
                  if (!clip) {
                    resolve();
                    return;
                  }
                  const rootName = model.name || 'Root';
                  const cleanClip = stripRootTranslationTracks(clip, rootName);
                  animationClipCache.set(file, cleanClip);
                  const action = mixer.clipAction(cleanClip);
                  if (name === 'walk') {
                    action.setEffectiveTimeScale(1.8);
                  }
                  if (
                    ['jump', 'hit', 'mutantPunch', 'leftPunch', 'mmaKick', 'runningKick', 'hurricaneKick', 'projectile', 'die'].includes(name)
                  ) {
                    action.loop = THREE.LoopOnce;
                    action.clampWhenFinished = true;
                  }
                  if (name === 'climb') {
                    action.loop = THREE.LoopRepeat;
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
                  try {
                    stripEmbeddedLights(lodModel);
                  } catch (err) {
                    console.error('While stripping LOD FBX lights:', err);
                  }

                  lodModel.traverse(o => {
                    if (o.isSkinnedMesh || o.isMesh) o.frustumCulled = false;
                    if (o.material?.skinning === true) o.material.skinning = true;
                  });

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
                  if (lodGroup.isLOD) {
                    lodGroup.addLevel(lodPivot, lod.distance);
                  } else {
                    lodGroup.add(lodPivot);
                  }
                  resolve();
                },
                undefined,
                (err) => {
                  console.warn('Failed to load player LOD model:', lod.path, err);
                  resolve();
                }
              );
            });
          });

          Promise.all([...promises, ...lodPromises]).then(() => {
            actions.idle.play();
            playerGroup.userData.currentAction = 'idle';
            playerGroup.userData.mixer = mixer;
            playerGroup.userData.actions = actions;
            if (onLoad) onLoad({ mixer, actions });
          });
        },
        undefined,
        (err) => {
          console.error('Failed to load player model:', err);
        }
      );
    });

  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const context = canvas.getContext('2d');
  context.fillStyle = 'rgba(0, 0, 0, 0)';
  context.fillRect(0, 0, canvas.width, canvas.height);

  const texture = new THREE.CanvasTexture(canvas);
  const chatMaterial = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const chatPlane = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.25), chatMaterial);
  chatPlane.position.y = 1.61;
  chatPlane.rotation.x = Math.PI / 12;
  chatPlane.visible = false;
  chatPlane.name = 'chatBillboard';
  playerGroup.add(chatPlane);

  const label = document.createElement('div');
  label.className = 'name-label';
  label.innerText = username;
  label.style.position = 'absolute';
  label.style.color = 'white';
  label.style.fontSize = '14px';
  label.style.pointerEvents = 'none';
  label.style.textShadow = '0 0 4px black';

  return { model: playerGroup, nameLabel: label };
}

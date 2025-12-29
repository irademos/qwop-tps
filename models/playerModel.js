// /models/playerModel.js
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import * as THREE from 'three';

const EPSILON = 1e-4;

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

function splitPaddlingClip(THREE, clip) {
  const duration = clip.duration;
  const leftStart = duration * 0.25;
  const leftEnd = duration * 0.75;

  const leftTracks = clip.tracks.map((track) => sliceTrackByTime(track, leftStart, leftEnd));
  const leftClip = new THREE.AnimationClip('paddleLeft', -1, leftTracks);
  leftClip.resetDuration();

  const firstHalfTracks = clip.tracks.map((track) => sliceTrackByTime(track, leftEnd, duration + EPSILON));
  const secondHalfTracks = clip.tracks.map((track) => sliceTrackByTime(track, 0, leftStart));
  const rightTracks = firstHalfTracks.map((track, index) => combineTrackSegments(track, secondHalfTracks[index]));
  const rightClip = new THREE.AnimationClip('paddleRight', -1, rightTracks);
  rightClip.resetDuration();

  return { leftClip, rightClip };
}

function clipWithExistingTargetsOnly(clip, root) {
  const names = new Set();
  root.traverse(o => names.add(o.name));
  const tracks = clip.tracks.filter(t => names.has(t.name.split('.')[0]));
  return new THREE.AnimationClip(clip.name, clip.duration, tracks);
}

function stripRootTracks(clip, rootName) {
  const blocked = new Set([
    `${rootName}.position`,
    `${rootName}.quaternion`,
    `${rootName}.scale`,
    `${rootName}.matrix`,
    `${rootName}.visible`,
  ]);
  const tracks = clip.tracks.filter(t => !blocked.has(t.name));
  return new THREE.AnimationClip(clip.name, clip.duration, tracks);
}

export function createPlayerModel(
  THREE,
  username,
  onLoad,
  modelPath = '/models/old_man.fbx'
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

          try {
            const lightsToRemove = [];

            model.traverse((obj) => {
              // Mark embedded lights for removal (don't remove yet!)
              if (obj.isLight) {
                lightsToRemove.push(obj);
                return;
              }

              // Make meshes unlit
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
                    skinning: obj.isSkinnedMesh === true, // keep skinning for skinned meshes
                  };

                  // dispose AFTER replacement to avoid disposing a material that might
                  // still be referenced during traversal in some engines
                  const newMat = new THREE.MeshBasicMaterial(basicParams);
                  if (typeof mat.dispose === 'function') {
                    // dispose old material on next tick to be extra safe
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

            // Now it's safe to remove the lights
            for (const light of lightsToRemove) {
              if (light.parent) light.parent.remove(light);
            }

            console.log('✅ FBX made unlit and internal lights removed (no in-traverse mutations)');
          } catch (err) {
            console.error('While making FBX unlit:', err);
          }

          model.traverse(o => {
            if (o.isSkinnedMesh || o.isMesh) o.frustumCulled = false;
            if (o.material?.skinning === true) o.material.skinning = true;
          });


          // Scale and center the model so it rotates around its midpoint
          const scale = config.scale ?? 1;
          model.scale.set(scale, scale, scale);

          // Center the FBX so rotations pivot around the model itself
          model.updateMatrixWorld(true);
          const box = new THREE.Box3().setFromObject(model);
          const center = box.getCenter(new THREE.Vector3());

          // Offset the model inside a pivot group instead of shifting the mesh directly
          const pivot = new THREE.Group();
          const yOffset = (config.yOffset ?? 0) - box.min.y;
          pivot.position.set(-center.x, yOffset, -center.z - (config.zOffset ?? 0));
          pivot.add(model);
          playerGroup.add(pivot);
          playerGroup.userData.pivot = pivot;

          const mixer = new THREE.AnimationMixer(model);
          const actions = {};

          // Load Mixamo animations
          const fbxLoader = new FBXLoader();
          const animationFiles = {
            idle: 'Breathing Idle.fbx',
            walk: 'Old Man Walk.fbx',
            run: 'Drunk Run Forward.fbx',
            jump: 'Joyful Jump.fbx',
            hit: 'Flying Back Death.fbx',
            mutantPunch: 'Mutant Punch.fbx',
            mmaKick: 'Mma Kick.fbx',
            runningKick: 'Stand To Roll.fbx',
            hurricaneKick: 'Hurricane Kick.fbx',
            projectile: 'Projectile.fbx',
            die: 'Dying.fbx',
            float: 'Floating.fbx',
            swim: 'Swimming.fbx',
            sit: 'Sitting Rubbing Arm.fbx'
          };

          const promises = Object.entries(animationFiles).map(([name, file]) => {
            return new Promise((resolve, reject) => {
              fbxLoader.load(
                `/models/animations/${encodeURIComponent(file)}`,
                (anim) => {
                  const clip = anim.animations[0];
                  // const rootName = model.name || 'Root';
                  // const src = anim.animations[0];
                  // const clean = stripRootTracks(src, rootName);
                  // const action = mixer.clipAction(clean);
                  const action = mixer.clipAction(clip);
                  if (
                    ['jump', 'hit', 'mutantPunch', 'mmaKick', 'runningKick', 'hurricaneKick', 'projectile', 'die'].includes(name)
                  ) {
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

          promises.push(new Promise((resolve, reject) => {
            fbxLoader.load(
              '/models/animations/Paddling.fbx',
              (anim) => {

                const baseClip = anim?.animations?.[0];
                if (!baseClip) {
                  resolve();
                  return;
                }

                const { leftClip, rightClip } = splitPaddlingClip(THREE, baseClip);

                const leftAction = mixer.clipAction(leftClip);
                leftAction.loop = THREE.LoopOnce;
                leftAction.clampWhenFinished = true;
                actions.paddleLeft = leftAction;

                const rightAction = mixer.clipAction(rightClip);
                rightAction.loop = THREE.LoopOnce;
                rightAction.clampWhenFinished = true;
                actions.paddleRight = rightAction;
                resolve();
              },
              undefined,
              reject
            );
          }));

          Promise.all(promises).then(() => {
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


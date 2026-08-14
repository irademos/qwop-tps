/**
 * Loads the shared GLB character and retargets FBX animations onto its skeleton.
 *
 * Retargeting uses bindPose correction — each keyframe quaternion is pre-multiplied
 * by (glbBoneRestInv × fbxBoneRest) to compensate for rest-pose differences between
 * the two skeletons.
 *
 * The facing direction is fixed by rotating the scene group itself Y+180° so both
 * the static rest pose and the animated pose agree — no track-level Y180 needed.
 * A small X rotation on the scene corrects any backward lean (fbxAnimConfig.sceneRotX).
 *
 * Fine-tuning is available at runtime via the debug panel (window.__fbxAnimDebug).
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { fbxAnimConfig, boneInfoRegistry } from './fbxAnimDebug.js';

const _gltfLoader = new GLTFLoader();
const _fbxLoader = new FBXLoader();

let _glbPromise = null;
let _fbxGroupPromise = null;
let _walkClipPromise = null;

function getGLBGltf() {
  if (!_glbPromise) {
    _glbPromise = new Promise((resolve, reject) =>
      _gltfLoader.load('/models/glb_characters/character.glb', resolve, undefined, reject)
    );
  }
  return _glbPromise;
}

function getFbxGroup() {
  if (!_fbxGroupPromise) {
    _fbxGroupPromise = new Promise((resolve, reject) =>
      _fbxLoader.load('/models/animations/Old Man Walk.fbx', resolve, undefined, reject)
    );
  }
  return _fbxGroupPromise;
}

function getWalkClip() {
  if (!_walkClipPromise) {
    _walkClipPromise = getFbxGroup().then(fbx => {
      const clip = fbx.animations?.[0];
      if (!clip) throw new Error('[GLBCharacter] No animations found in Old Man Walk.fbx');
      return clip;
    });
  }
  return _walkClipPromise;
}

// ── Rest-pose helpers ──────────────────────────────────────────────────────

function buildRestPoseMap(root) {
  root.updateWorldMatrix(true, true);
  const map = new Map();
  root.traverse(obj => { if (obj.name) map.set(obj.name, obj.quaternion.clone()); });
  return map;
}

function populateBoneInfo(glbScene, fbxGroup, trackedBoneNames) {
  glbScene.traverse(obj => {
    if (!obj.name) return;
    if (!boneInfoRegistry[obj.name]) boneInfoRegistry[obj.name] = {};
    boneInfoRegistry[obj.name].glbRest = obj.quaternion.clone();
    boneInfoRegistry[obj.name].tracked = trackedBoneNames.has(obj.name);
  });
  fbxGroup?.traverse(obj => {
    if (!obj.name) return;
    if (!boneInfoRegistry[obj.name]) boneInfoRegistry[obj.name] = {};
    boneInfoRegistry[obj.name].fbxRest = obj.quaternion.clone();
  });
}

// ── Clip retargeting ───────────────────────────────────────────────────────

const ROOT_CANDIDATES = new Set([
  'Hips', 'mixamorig:Hips', 'Root', 'mixamorig:Root', 'Armature', 'mixamorigHips',
]);

function retargetClip(rawClip, scene, fbxGroup) {
  const existingNames = new Set();
  scene.traverse(o => { if (o.name) existingNames.add(o.name); });

  const trackedBones = new Set(
    rawClip.tracks
      .map(t => { const d = t.name.lastIndexOf('.'); return d !== -1 ? t.name.slice(0, d) : t.name; })
      .filter(n => existingNames.has(n))
  );

  populateBoneInfo(scene, fbxGroup, trackedBones);
  try { window.__fbxAnimDebug?.refreshPanel(); } catch (_) {}

  // bindPose rest-delta maps
  const glbRestMap = buildRestPoseMap(scene);
  const fbxRestMap = fbxGroup ? buildRestPoseMap(fbxGroup) : null;

  // Debug-panel optional extras
  const globalFlip = new THREE.Quaternion().setFromEuler(new THREE.Euler(
    fbxAnimConfig.flipCorrectX ? Math.PI : 0,
    fbxAnimConfig.flipCorrectY ? Math.PI : 0,
    fbxAnimConfig.flipCorrectZ ? Math.PI : 0,
  ));
  const hasGlobalFlip = fbxAnimConfig.flipCorrectX || fbxAnimConfig.flipCorrectY || fbxAnimConfig.flipCorrectZ;

  // Debug-panel extra root pre-rotation
  const debugPreRot = new THREE.Quaternion().setFromEuler(new THREE.Euler(
    THREE.MathUtils.degToRad(fbxAnimConfig.rootPreRotX),
    THREE.MathUtils.degToRad(fbxAnimConfig.rootPreRotY),
    THREE.MathUtils.degToRad(fbxAnimConfig.rootPreRotZ),
    'XYZ',
  ));
  const hasDebugPreRot = fbxAnimConfig.rootPreRotX !== 0 || fbxAnimConfig.rootPreRotY !== 0 || fbxAnimConfig.rootPreRotZ !== 0;

  const tracks = [];
  const q = new THREE.Quaternion();
  const v = new THREE.Vector3();

  for (const track of rawClip.tracks) {
    const dotIdx = track.name.lastIndexOf('.');
    const boneName = dotIdx !== -1 ? track.name.slice(0, dotIdx) : track.name;
    const prop    = dotIdx !== -1 ? track.name.slice(dotIdx + 1) : '';

    if (!existingNames.has(boneName)) continue;

    const isRoot = ROOT_CANDIDATES.has(boneName);

    if (prop === 'position') {
      if (!fbxAnimConfig.keepPosition) continue;
      if (fbxAnimConfig.stripRootPosition && isRoot) continue;
      // Apply any extra debug pre-rotation to the root position track
      if (hasDebugPreRot && isRoot) {
        const values = track.values.slice();
        for (let i = 0; i < values.length; i += 3) {
          v.set(values[i], values[i + 1], values[i + 2]).applyQuaternion(debugPreRot);
          values[i] = v.x; values[i + 1] = v.y; values[i + 2] = v.z;
        }
        tracks.push(new THREE.VectorKeyframeTrack(track.name, track.times.slice(), values));
        continue;
      }
    }
    if (prop === 'quaternion' && !fbxAnimConfig.keepQuaternion) continue;
    if (prop === 'scale'     && !fbxAnimConfig.keepScale)       continue;

    if (prop === 'quaternion') {
      // bindPose delta: glbRestInv × fbxRest
      let bindDelta = null;
      const glbRest = glbRestMap.get(boneName);
      const fbxRest = fbxRestMap?.get(boneName);
      if (glbRest && fbxRest) {
        bindDelta = glbRest.clone().invert().multiply(fbxRest);
      }

      const boneCfg = fbxAnimConfig.boneCorrections[boneName];
      let eulerQ = null;
      if (boneCfg && (boneCfg.ex !== 0 || boneCfg.ey !== 0 || boneCfg.ez !== 0)) {
        eulerQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(
          THREE.MathUtils.degToRad(boneCfg.ex),
          THREE.MathUtils.degToRad(boneCfg.ey),
          THREE.MathUtils.degToRad(boneCfg.ez),
        ));
      }

      const needsMod = (isRoot && hasDebugPreRot) || bindDelta || eulerQ || hasGlobalFlip ||
        (boneCfg && (boneCfg.flipX || boneCfg.flipY || boneCfg.flipZ));

      if (needsMod) {
        const values = track.values.slice();
        for (let i = 0; i < values.length; i += 4) {
          q.set(values[i], values[i + 1], values[i + 2], values[i + 3]);

          // 1. Debug-panel extra root rotation
          if (isRoot && hasDebugPreRot) q.premultiply(debugPreRot);

          // 2. Global flip (debug panel)
          if (hasGlobalFlip) q.premultiply(globalFlip);

          // 3. bindPose rest-delta correction
          if (bindDelta) q.premultiply(bindDelta);

          // 4. Per-bone component sign flip (debug panel)
          if (boneCfg) {
            if (boneCfg.flipX) q.x = -q.x;
            if (boneCfg.flipY) q.y = -q.y;
            if (boneCfg.flipZ) q.z = -q.z;
            if (boneCfg.flipX || boneCfg.flipY || boneCfg.flipZ) q.normalize();
          }

          // 5. Per-bone euler offset (debug panel)
          if (eulerQ) q.multiply(eulerQ);

          values[i] = q.x; values[i + 1] = q.y; values[i + 2] = q.z; values[i + 3] = q.w;
        }
        tracks.push(new THREE.QuaternionKeyframeTrack(track.name, track.times.slice(), values));
        continue;
      }
    }

    tracks.push(track);
  }

  return new THREE.AnimationClip(rawClip.name, rawClip.duration, tracks);
}

// ── Scene normalization ────────────────────────────────────────────────────

function applySceneOrientation(scene) {
  // Y180 aligns the static rest pose with the walking animation direction.
  // sceneRotX corrects any backward lean (negative = tilt forward).
  scene.rotation.set(
    THREE.MathUtils.degToRad(fbxAnimConfig.sceneRotX),
    Math.PI,  // hardcoded — do not expose; scene group handles facing, not tracks
    0,
  );
}

function normalizeSceneHeight(scene, targetHeight) {
  scene.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(scene);
  if (box.isEmpty()) return;
  const height = box.max.y - box.min.y;
  if (height > 0.001) {
    const scale = (targetHeight / height) * fbxAnimConfig.sceneScaleMultiplier;
    scene.scale.setScalar(scale);
    scene.updateWorldMatrix(true, true);
    const box2 = new THREE.Box3().setFromObject(scene);
    scene.position.y = -box2.min.y + fbxAnimConfig.sceneOffsetY;
  } else {
    scene.position.y = -box.min.y + fbxAnimConfig.sceneOffsetY;
  }
}

// ── Hot-rebuild loop ───────────────────────────────────────────────────────

const _instances = new Set();
let _pollRafId = null;

function rebuildInstance(inst) {
  applySceneOrientation(inst.scene);
  const walkClip = retargetClip(inst.rawWalkClip, inst.scene, inst.fbxGroup);
  inst.mixer.stopAllAction();
  const walkAction = inst.mixer.clipAction(walkClip);
  walkAction.setLoop(THREE.LoopRepeat, Infinity);
  inst.mixer.timeScale = fbxAnimConfig.timeScale;
  inst.walkAction = walkAction;
  inst.onRebuild?.(walkAction);
}

function ensureDebugPoll() {
  if (_pollRafId !== null) return;
  (function poll() {
    _pollRafId = requestAnimationFrame(poll);
    if (!fbxAnimConfig._dirty) return;
    fbxAnimConfig._dirty = false;
    for (const inst of _instances) {
      rebuildInstance(inst);
      inst.scene.position.y = inst.scene.position.y - (inst._lastOffsetY ?? 0) + fbxAnimConfig.sceneOffsetY;
      inst._lastOffsetY = fbxAnimConfig.sceneOffsetY;
      inst.mixer.timeScale = fbxAnimConfig.timeScale;
    }
  })();
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * @param {object} [opts]
 * @param {number} [opts.targetHeight=1.0]
 * @param {function} [opts.onRebuild]
 */
export async function createGLBCharacterInstance(opts = {}) {
  const targetHeight = opts.targetHeight ?? fbxAnimConfig.targetHeight;

  const [gltf, rawWalkClip, fbxGroup] = await Promise.all([
    getGLBGltf(), getWalkClip(), getFbxGroup(),
  ]);

  const scene = SkeletonUtils.clone(gltf.scene);
  scene.name = 'GLBCharacterScene';
  scene.traverse(obj => {
    if (obj.isMesh) { obj.castShadow = true; obj.receiveShadow = true; }
  });

  const container = new THREE.Group();
  container.name = 'GLBCharacterContainer';
  container.add(scene);

  normalizeSceneHeight(scene, targetHeight);
  applySceneOrientation(scene);

  const walkClip = retargetClip(rawWalkClip, scene, fbxGroup);

  const mixer = new THREE.AnimationMixer(scene);
  mixer.timeScale = fbxAnimConfig.timeScale;
  const walkAction = mixer.clipAction(walkClip);
  walkAction.setLoop(THREE.LoopRepeat, Infinity);

  const inst = {
    scene, mixer, rawWalkClip, fbxGroup,
    walkAction,
    onRebuild: opts.onRebuild ?? null,
    _lastOffsetY: fbxAnimConfig.sceneOffsetY,
  };
  _instances.add(inst);
  ensureDebugPoll();

  container.userData._fbxDebugInst = inst;
  return { container, mixer, walkAction };
}

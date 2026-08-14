/**
 * Loads the shared GLB character and retargets FBX animations onto its skeleton.
 *
 * Two retargeting modes (selected via fbxAnimConfig.retargetMode):
 *
 *  'direct'   – maps FBX tracks to GLB bones by name, with optional per-bone
 *               quaternion component flips + euler offsets.
 *
 *  'bindPose' – additionally pre-multiplies each keyframe by the delta between
 *               the FBX rest pose and the GLB rest pose for that bone:
 *                 correctedQ = glbRestInv * fbxRest * rawQ
 *               This compensates for bones that are oriented differently in the
 *               two skeletons — the root cause of "upside-down legs" artifacts.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { fbxAnimConfig, boneInfoRegistry } from './fbxAnimDebug.js';

const _gltfLoader = new GLTFLoader();
const _fbxLoader = new FBXLoader();

let _glbPromise = null;
let _walkClipPromise = null;
// Also cache the raw FBX group (for rest-pose extraction)
let _fbxGroupPromise = null;

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
    _fbxGroupPromise = new Promise((resolve, reject) => {
      _fbxLoader.load('/models/animations/Old Man Walk.fbx', resolve, undefined, reject);
    });
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

/** Build boneName → world-space quaternion map from a scene graph. */
function buildRestPoseMap(root) {
  root.updateWorldMatrix(true, true);
  const map = new Map();
  root.traverse(obj => {
    if (obj.isBone || obj.type === 'Bone' || obj.name) {
      map.set(obj.name, obj.quaternion.clone());
    }
  });
  return map;
}

/**
 * Populate boneInfoRegistry with GLB rest poses and FBX rest poses,
 * and mark which bones actually have animation tracks.
 */
function populateBoneInfo(glbScene, fbxGroup, trackedBoneNames) {
  glbScene.traverse(obj => {
    if (!obj.name) return;
    if (!boneInfoRegistry[obj.name]) boneInfoRegistry[obj.name] = {};
    boneInfoRegistry[obj.name].glbRest = obj.quaternion.clone();
    boneInfoRegistry[obj.name].tracked = trackedBoneNames.has(obj.name);
  });
  if (fbxGroup) {
    fbxGroup.traverse(obj => {
      if (!obj.name) return;
      if (!boneInfoRegistry[obj.name]) boneInfoRegistry[obj.name] = {};
      boneInfoRegistry[obj.name].fbxRest = obj.quaternion.clone();
    });
  }
}

// ── Clip retargeting ───────────────────────────────────────────────────────

/**
 * Build a corrected AnimationClip from `rawClip` targeting `scene`.
 * Reads all settings from fbxAnimConfig at call time.
 */
function retargetClip(rawClip, scene, fbxGroup) {
  // Which bones exist in the GLB?
  const existingNames = new Set();
  scene.traverse(o => { if (o.name) existingNames.add(o.name); });

  // All names that could be the animation root bone
  const ROOT_CANDIDATES = new Set([
    'Hips', 'mixamorig:Hips', 'Root', 'mixamorig:Root', 'Armature',
    'mixamorigHips',
  ]);

  // Collect bone names that have tracks (for boneInfoRegistry)
  const trackedBones = new Set(
    rawClip.tracks
      .map(t => { const d = t.name.lastIndexOf('.'); return d !== -1 ? t.name.slice(0, d) : t.name; })
      .filter(n => existingNames.has(n))
  );

  // Populate registry once
  populateBoneInfo(scene, fbxGroup, trackedBones);
  // Refresh panel rest-pose hints if available
  try { window.__fbxAnimDebug?.refreshPanel(); } catch (_) {}

  // Build rest-pose correction maps for bindPose mode
  let glbRestMap = null;
  let fbxRestMap = null;
  if (fbxAnimConfig.retargetMode === 'bindPose') {
    glbRestMap = buildRestPoseMap(scene);
    fbxRestMap = fbxGroup ? buildRestPoseMap(fbxGroup) : null;
  }

  // Global flip quaternion
  const globalFlip = new THREE.Quaternion().setFromEuler(new THREE.Euler(
    fbxAnimConfig.flipCorrectX ? Math.PI : 0,
    fbxAnimConfig.flipCorrectY ? Math.PI : 0,
    fbxAnimConfig.flipCorrectZ ? Math.PI : 0,
  ));
  const hasGlobalFlip = fbxAnimConfig.flipCorrectX || fbxAnimConfig.flipCorrectY || fbxAnimConfig.flipCorrectZ;

  // Root pre-rotation — compensates for FBX global axis transform not surviving
  // clip extraction (Mixamo commonly bakes ±90° X into the skeleton root).
  // Applied as a premultiply to the Hips quaternion track and used to rotate
  // the Hips position track so the character stands upright.
  const preRot = new THREE.Quaternion().setFromEuler(new THREE.Euler(
    THREE.MathUtils.degToRad(fbxAnimConfig.rootPreRotX),
    THREE.MathUtils.degToRad(fbxAnimConfig.rootPreRotY),
    THREE.MathUtils.degToRad(fbxAnimConfig.rootPreRotZ),
    'XYZ',
  ));
  const hasPreRot = fbxAnimConfig.rootPreRotX !== 0 || fbxAnimConfig.rootPreRotY !== 0 || fbxAnimConfig.rootPreRotZ !== 0;

  const tracks = [];
  const q = new THREE.Quaternion();
  const v = new THREE.Vector3();

  for (const track of rawClip.tracks) {
    const dotIdx = track.name.lastIndexOf('.');
    const boneName = dotIdx !== -1 ? track.name.slice(0, dotIdx) : track.name;
    const prop = dotIdx !== -1 ? track.name.slice(dotIdx + 1) : '';

    if (!existingNames.has(boneName)) continue;

    if (prop === 'position') {
      if (!fbxAnimConfig.keepPosition) continue;
      if (fbxAnimConfig.stripRootPosition && ROOT_CANDIDATES.has(boneName)) continue;
      // Apply pre-rotation to root position track so vertical orientation is correct
      if (hasPreRot && ROOT_CANDIDATES.has(boneName)) {
        const values = track.values.slice();
        for (let i = 0; i < values.length; i += 3) {
          v.set(values[i], values[i + 1], values[i + 2]).applyQuaternion(preRot);
          values[i] = v.x; values[i + 1] = v.y; values[i + 2] = v.z;
        }
        tracks.push(new THREE.VectorKeyframeTrack(track.name, track.times.slice(), values));
        continue;
      }
    }
    if (prop === 'quaternion' && !fbxAnimConfig.keepQuaternion) continue;
    if (prop === 'scale' && !fbxAnimConfig.keepScale) continue;

    if (prop === 'quaternion') {
      const boneCfg = fbxAnimConfig.boneCorrections[boneName];

      // Build bind-pose correction delta for this bone (bindPose mode only)
      let bindDelta = null;
      if (fbxAnimConfig.retargetMode === 'bindPose' && glbRestMap && fbxRestMap) {
        const glbRest = glbRestMap.get(boneName);
        const fbxRest = fbxRestMap.get(boneName);
        if (glbRest && fbxRest) {
          // delta = glbRestInv * fbxRest
          bindDelta = glbRest.clone().invert().multiply(fbxRest);
        }
      }

      // Build bone euler correction quaternion
      let eulerQ = null;
      if (boneCfg && (boneCfg.ex !== 0 || boneCfg.ey !== 0 || boneCfg.ez !== 0)) {
        eulerQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(
          THREE.MathUtils.degToRad(boneCfg.ex),
          THREE.MathUtils.degToRad(boneCfg.ey),
          THREE.MathUtils.degToRad(boneCfg.ez),
        ));
      }

      // Root pre-rotation applies to the Hips/root quaternion track
      const isRoot = ROOT_CANDIDATES.has(boneName);

      const needsMod = hasGlobalFlip || bindDelta || eulerQ || (isRoot && hasPreRot) ||
        (boneCfg && (boneCfg.flipX || boneCfg.flipY || boneCfg.flipZ));

      if (needsMod) {
        const values = track.values.slice();
        for (let i = 0; i < values.length; i += 4) {
          q.set(values[i], values[i + 1], values[i + 2], values[i + 3]);

          // 1. Root pre-rotation (world-space re-orient for Hips/root only)
          if (isRoot && hasPreRot) q.premultiply(preRot);

          // 2. Global flip
          if (hasGlobalFlip) q.premultiply(globalFlip);

          // 3. bindPose rest-delta correction
          if (bindDelta) q.premultiply(bindDelta);

          // 4. Per-bone axis component negation (manual sign flip)
          if (boneCfg) {
            if (boneCfg.flipX) q.x = -q.x;
            if (boneCfg.flipY) q.y = -q.y;
            if (boneCfg.flipZ) q.z = -q.z;
            if (boneCfg.flipX || boneCfg.flipY || boneCfg.flipZ) q.normalize();
          }

          // 5. Per-bone euler offset (local, post-multiply)
          if (eulerQ) q.multiply(eulerQ);

          values[i] = q.x; values[i + 1] = q.y;
          values[i + 2] = q.z; values[i + 3] = q.w;
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
  const { scene, mixer, rawWalkClip, fbxGroup, onRebuild } = inst;
  const walkClip = retargetClip(rawWalkClip, scene, fbxGroup);
  mixer.stopAllAction();
  const walkAction = mixer.clipAction(walkClip);
  walkAction.setLoop(THREE.LoopRepeat, Infinity);
  mixer.timeScale = fbxAnimConfig.timeScale;
  inst.walkAction = walkAction;
  if (onRebuild) onRebuild(walkAction);
}

function ensureDebugPoll() {
  if (_pollRafId !== null) return;
  (function poll() {
    _pollRafId = requestAnimationFrame(poll);
    if (!fbxAnimConfig._dirty) return;
    fbxAnimConfig._dirty = false;
    for (const inst of _instances) {
      rebuildInstance(inst);
      // Re-apply Y offset without full height re-normalisation
      inst.scene.position.y = inst.scene.position.y - (inst._lastOffsetY ?? 0) + fbxAnimConfig.sceneOffsetY;
      inst._lastOffsetY = fbxAnimConfig.sceneOffsetY;
      inst.mixer.timeScale = fbxAnimConfig.timeScale;
    }
  })();
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Creates one independent GLB character instance with its own mixer.
 *
 * @param {object} [opts]
 * @param {number} [opts.targetHeight=1.0]
 * @param {function} [opts.onRebuild] – called with new walkAction after a debug rebuild
 */
export async function createGLBCharacterInstance(opts = {}) {
  const targetHeight = opts.targetHeight ?? fbxAnimConfig.targetHeight;

  const [gltf, rawWalkClip, fbxGroup] = await Promise.all([
    getGLBGltf(),
    getWalkClip(),
    getFbxGroup(),
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

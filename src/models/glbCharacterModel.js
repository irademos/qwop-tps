/**
 * Loads the shared GLB character and retargets FBX animations onto its skeleton.
 * The FBX animation bone names are expected to match the GLB bone names directly.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { fbxAnimConfig } from './fbxAnimDebug.js';

const _gltfLoader = new GLTFLoader();
const _fbxLoader = new FBXLoader();

// Cached promises — the source assets are loaded once and cloned per instance
let _glbPromise = null;
let _walkClipPromise = null;

function getGLBGltf() {
  if (!_glbPromise) {
    _glbPromise = new Promise((resolve, reject) =>
      _gltfLoader.load('/models/glb_characters/character.glb', resolve, undefined, reject)
    );
  }
  return _glbPromise;
}

function getWalkClip() {
  if (!_walkClipPromise) {
    _walkClipPromise = new Promise((resolve, reject) => {
      _fbxLoader.load('/models/animations/Old Man Walk.fbx', (fbx) => {
        const clip = fbx.animations?.[0];
        if (!clip) {
          reject(new Error('[GLBCharacter] No animations found in Old Man Walk.fbx'));
          return;
        }
        resolve(clip);
      }, undefined, reject);
    });
  }
  return _walkClipPromise;
}

/**
 * Filters and corrects an AnimationClip based on the current fbxAnimConfig.
 *
 * - Removes tracks whose target bone doesn't exist in `scene`
 * - Optionally strips position/quaternion/scale tracks
 * - Optionally strips root-bone position to prevent drift
 * - Optionally applies per-axis quaternion flips to fix upside-down limbs
 * - Optionally applies per-bone euler rotation corrections to every keyframe
 */
function retargetClip(clip, scene) {
  const existingNames = new Set();
  scene.traverse(o => existingNames.add(o.name));

  const ROOT_CANDIDATES = new Set([
    'Hips', 'mixamorig:Hips', 'Root', 'mixamorig:Root', 'Armature',
  ]);

  // Pre-build quaternion correction from flip flags
  const flipQ = new THREE.Quaternion();
  const euler = new THREE.Euler(
    fbxAnimConfig.flipCorrectX ? Math.PI : 0,
    fbxAnimConfig.flipCorrectY ? Math.PI : 0,
    fbxAnimConfig.flipCorrectZ ? Math.PI : 0,
  );
  flipQ.setFromEuler(euler);
  const hasFlip = fbxAnimConfig.flipCorrectX || fbxAnimConfig.flipCorrectY || fbxAnimConfig.flipCorrectZ;

  const tracks = [];

  for (const track of clip.tracks) {
    const dotIdx = track.name.lastIndexOf('.');
    const boneName = dotIdx !== -1 ? track.name.slice(0, dotIdx) : track.name;
    const prop = dotIdx !== -1 ? track.name.slice(dotIdx + 1) : '';

    // Bone must exist in the scene
    if (!existingNames.has(boneName)) continue;

    // Track type filtering
    if (prop === 'position') {
      if (!fbxAnimConfig.keepPosition) continue;
      if (fbxAnimConfig.stripRootPosition && ROOT_CANDIDATES.has(boneName)) continue;
    }
    if (prop === 'quaternion' && !fbxAnimConfig.keepQuaternion) continue;
    if (prop === 'scale' && !fbxAnimConfig.keepScale) continue;

    // Quaternion corrections: per-axis flip + per-bone euler offset
    if (prop === 'quaternion') {
      const correction = fbxAnimConfig.boneCorrections[boneName];
      const hasBoneCorrection = correction &&
        (correction.x !== 0 || correction.y !== 0 || correction.z !== 0);

      if (hasFlip || hasBoneCorrection) {
        // Clone so we don't mutate the cached source clip
        const values = track.values.slice();

        const boneEuler = hasBoneCorrection
          ? new THREE.Euler(
              THREE.MathUtils.degToRad(correction.x),
              THREE.MathUtils.degToRad(correction.y),
              THREE.MathUtils.degToRad(correction.z),
            )
          : null;
        const boneQ = boneEuler ? new THREE.Quaternion().setFromEuler(boneEuler) : null;

        const q = new THREE.Quaternion();
        for (let i = 0; i < values.length; i += 4) {
          q.set(values[i], values[i + 1], values[i + 2], values[i + 3]);
          if (hasFlip) q.premultiply(flipQ);
          if (boneQ) q.multiply(boneQ);
          values[i] = q.x;
          values[i + 1] = q.y;
          values[i + 2] = q.z;
          values[i + 3] = q.w;
        }

        const correctedTrack = new THREE.QuaternionKeyframeTrack(
          track.name,
          track.times.slice(),
          values,
        );
        tracks.push(correctedTrack);
        continue;
      }
    }

    tracks.push(track);
  }

  return new THREE.AnimationClip(clip.name, clip.duration, tracks);
}

/**
 * Translates the scene so its bounding-box bottom sits at y=0, scales it to
 * `targetHeight`, then applies the multiplier and Y offset from fbxAnimConfig.
 */
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

// ── Per-instance state so we can hot-rebuild clips on debug changes ─────────
const _instances = new Set();

function rebuildInstance(inst) {
  const { scene, mixer, rawWalkClip, onRebuild } = inst;
  const walkClip = retargetClip(rawWalkClip, scene);
  mixer.stopAllAction();
  const walkAction = mixer.clipAction(walkClip);
  walkAction.setLoop(THREE.LoopRepeat, Infinity);
  mixer.timeScale = fbxAnimConfig.timeScale;
  inst.walkAction = walkAction;
  if (onRebuild) onRebuild(walkAction);
}

// Poll for dirty flag each frame (called from createGLBCharacterInstance callers via mixer.update)
let _pollRafId = null;
function ensureDebugPoll() {
  if (_pollRafId !== null) return;
  function poll() {
    _pollRafId = requestAnimationFrame(poll);
    if (!fbxAnimConfig._dirty) return;
    fbxAnimConfig._dirty = false;
    for (const inst of _instances) {
      rebuildInstance(inst);
      // Re-apply scene offset
      inst.scene.position.y = -new THREE.Box3().setFromObject(inst.scene).min.y + fbxAnimConfig.sceneOffsetY;
    }
    // Sync time scale on all mixers without full rebuild
    for (const inst of _instances) {
      inst.mixer.timeScale = fbxAnimConfig.timeScale;
    }
  }
  poll();
}

/**
 * Creates one independent GLB character instance with its own mixer.
 *
 * @param {object} [opts]
 * @param {number} [opts.targetHeight=1.0] – scale the character to this world-space height
 * @param {function} [opts.onRebuild] – called with new walkAction after a debug rebuild
 * @returns {Promise<{container: THREE.Group, mixer: THREE.AnimationMixer, walkAction: THREE.AnimationAction}>}
 */
export async function createGLBCharacterInstance(opts = {}) {
  const targetHeight = opts.targetHeight ?? fbxAnimConfig.targetHeight;

  const [gltf, rawWalkClip] = await Promise.all([getGLBGltf(), getWalkClip()]);

  // Clone so each instance has independent skeleton/bones
  const scene = SkeletonUtils.clone(gltf.scene);
  scene.name = 'GLBCharacterScene';
  scene.traverse(obj => {
    if (obj.isMesh) {
      obj.castShadow = true;
      obj.receiveShadow = true;
    }
  });

  const container = new THREE.Group();
  container.name = 'GLBCharacterContainer';
  container.add(scene);

  // Normalize height & foot position
  normalizeSceneHeight(scene, targetHeight);

  // Build a retargeted walk clip for this scene's skeleton
  const walkClip = retargetClip(rawWalkClip, scene);

  const mixer = new THREE.AnimationMixer(scene);
  mixer.timeScale = fbxAnimConfig.timeScale;
  const walkAction = mixer.clipAction(walkClip);
  walkAction.setLoop(THREE.LoopRepeat, Infinity);

  // Register for hot-rebuild on debug changes
  const inst = { scene, mixer, rawWalkClip, walkAction, onRebuild: opts.onRebuild ?? null };
  _instances.add(inst);
  ensureDebugPoll();

  // Expose on container so callers can get fresh walkAction after debug rebuilds
  container.userData._fbxDebugInst = inst;

  return { container, mixer, walkAction };
}

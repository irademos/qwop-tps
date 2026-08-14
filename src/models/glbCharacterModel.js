/**
 * Loads the shared GLB character and retargets FBX animations onto its skeleton.
 * The FBX animation bone names are expected to match the GLB bone names directly.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';

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
 * Filters an AnimationClip so only tracks targeting bones that actually exist
 * in `scene` are kept. Also strips root-bone position tracks to prevent
 * the character sliding around when the animation plays.
 */
function retargetClip(clip, scene) {
  const existingNames = new Set();
  scene.traverse(o => existingNames.add(o.name));

  const ROOT_CANDIDATES = new Set([
    'Hips', 'mixamorig:Hips', 'Root', 'mixamorig:Root', 'Armature',
  ]);

  const tracks = clip.tracks.filter(track => {
    const boneName = track.name.split('.')[0];
    if (!existingNames.has(boneName)) return false;
    // Strip position tracks on root-like bones to avoid lateral drift
    if (track.name.endsWith('.position') && ROOT_CANDIDATES.has(boneName)) return false;
    return true;
  });

  return new THREE.AnimationClip(clip.name, clip.duration, tracks);
}

/**
 * Translates the scene so its bounding-box bottom sits at y=0 and scales it
 * so its height matches `targetHeight`.
 */
function normalizeSceneHeight(scene, targetHeight) {
  scene.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(scene);
  if (box.isEmpty()) return;

  const height = box.max.y - box.min.y;
  if (height > 0.001) {
    const scale = targetHeight / height;
    scene.scale.setScalar(scale);
    scene.updateWorldMatrix(true, true);
    // Re-compute box after scale
    const box2 = new THREE.Box3().setFromObject(scene);
    scene.position.y = -box2.min.y;
  } else {
    scene.position.y = -box.min.y;
  }
}

/**
 * Creates one independent GLB character instance with its own mixer.
 *
 * @param {object} [opts]
 * @param {number} [opts.targetHeight=1.0] – scale the character to this world-space height
 * @returns {Promise<{container: THREE.Group, mixer: THREE.AnimationMixer, walkAction: THREE.AnimationAction}>}
 */
export async function createGLBCharacterInstance(opts = {}) {
  const targetHeight = opts.targetHeight ?? 1.0;

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
  const walkAction = mixer.clipAction(walkClip);
  walkAction.setLoop(THREE.LoopRepeat, Infinity);

  return { container, mixer, walkAction };
}

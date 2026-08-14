// /models/playerModel.js
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import * as THREE from 'three';
import { initHandRotationDebug, handRotConfig, handPosOffset, armConfig, getOffsetQuaternion, handRollDiag } from './handRotationDebug.js';
import { createGLBCharacterInstance } from './glbCharacterModel.js';

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

function createLimbSegment(THREE, name, { length, radius, color, mass, shape = 'capsule' }) {
  const group = new THREE.Group();
  group.name = name;
  group.userData.mass = mass;

  const material = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.75,
    metalness: 0.05
  });
  const geometry = shape === 'box'
    ? new THREE.BoxGeometry(radius * 2, length, radius * 2)
    : new THREE.CapsuleGeometry(radius, Math.max(0.01, length - radius * 2), 6, 12);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = `${name}Mesh`;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.position.y = -length / 2;
  group.add(mesh);

  return { group, mesh, length, mass, restRotation: 0, angularVelocity: 0 };
}

export function createProceduralBody(THREE) {
  const root = new THREE.Group();
  root.name = 'ProceduralGangBeastsPlayerBody';

  // Simple upright capsule body — no legs, no head, no physics simulation
  const CAPSULE_RADIUS = 0.28;
  const CAPSULE_HEIGHT = 1.0; // total height including rounded ends
  const capsuleMat = new THREE.MeshStandardMaterial({ color: 0x2e86de, roughness: 0.75, metalness: 0.05 });
  const capsuleGeo = new THREE.CapsuleGeometry(CAPSULE_RADIUS, CAPSULE_HEIGHT - CAPSULE_RADIUS * 2, 8, 16);
  const capsuleMesh = new THREE.Mesh(capsuleGeo, capsuleMat);
  capsuleMesh.name = 'bodyCapsulemesh';
  capsuleMesh.castShadow = true;
  capsuleMesh.receiveShadow = true;
  // Center the capsule so its bottom is at y=0 and top at y=CAPSULE_HEIGHT
  capsuleMesh.position.y = CAPSULE_HEIGHT / 2;
  root.add(capsuleMesh);

  // Shoulder anchors attached directly to root at shoulder height
  const leftShoulderAnchor = new THREE.Group();
  leftShoulderAnchor.name = 'leftShoulderAnchor';
  leftShoulderAnchor.position.set(-CAPSULE_RADIUS - 0.08, CAPSULE_HEIGHT * 0.82, 0);
  root.add(leftShoulderAnchor);

  const rightShoulderAnchor = new THREE.Group();
  rightShoulderAnchor.name = 'rightShoulderAnchor';
  rightShoulderAnchor.position.set(CAPSULE_RADIUS + 0.08, CAPSULE_HEIGHT * 0.82, 0);
  root.add(rightShoulderAnchor);

  return {
    root,
    parts: {},
    shoulderAnchors: { left: leftShoulderAnchor, right: rightShoulderAnchor }
  };
}


const TORSO_MAX_TWIST = Math.PI / 2;
const TARGET_RETURN_SPEED = 1.35;
const TARGET_FOLLOW_SPEED = 15;

// Compute Euler rotation angles (x = pitch, z = roll) so the arm group points
// from its shoulder attachment toward a world-space target position.
// Returns null if the rig isn't ready or the target is too close to compute.
function computeArmAnglesForWorldTarget(side, rig, playerGroup, worldTargetPos) {
  const armName = side === 'right' ? 'rightArm' : 'leftArm';
  const armPart = rig?.parts?.[armName];
  if (!armPart?.group) return null;

  const shoulderWorldPos = new THREE.Vector3();
  armPart.group.getWorldPosition(shoulderWorldPos);

  const toTarget = new THREE.Vector3().subVectors(worldTargetPos, shoulderWorldPos);
  if (toTarget.length() < 0.05) return null;
  toTarget.normalize();

  // Convert world direction to the arm parent's (torso's) local space
  const parentWorldQuat = new THREE.Quaternion();
  (armPart.group.parent || playerGroup).getWorldQuaternion(parentWorldQuat);
  const localDir = toTarget.clone().applyQuaternion(parentWorldQuat.clone().invert());

  // Arm local -Y is the "pointing" axis.
  // rotation.x = θ  →  arm direction: (0, -cos θ, -sin θ)
  // rotation.z = φ  →  arm direction: (sin φ, -cos φ, 0)
  // Independent decomposition (good approximation for normal reach ranges):
  const rotX = Math.atan2(-localDir.z, -localDir.y);
  const rotZ = Math.atan2(localDir.x, -localDir.y);

  return {
    x: THREE.MathUtils.clamp(rotX, -1.65, 1.35),
    y: 0,
    z: THREE.MathUtils.clamp(rotZ, -1.2, 1.2),
  };
}

const GANG_BEASTS_STEP_SWITCH_SECONDS = 0.18;
const GANG_BEASTS_STEP_LENGTH = 0.5;
const GANG_BEASTS_STEP_WIDTH = 0.22;
const GANG_BEASTS_SUPPORT_LIMIT = 0.15;
const GANG_BEASTS_MOTOR_LAG_SPEED = 4.2;

function getRigFootPlants(rig) {
  if (!rig.footPlants) {
    rig.footPlants = {
      left: { planted: true, anchor: new THREE.Vector2(-GANG_BEASTS_STEP_WIDTH, 0.04), age: 0, swing: 0, seed: 1.7, stuckTimer: 0 },
      right: { planted: true, anchor: new THREE.Vector2(GANG_BEASTS_STEP_WIDTH, -0.04), age: GANG_BEASTS_STEP_SWITCH_SECONDS * 0.5, swing: 0, seed: 4.9, stuckTimer: 0 },
      nextFoot: 'left'
    };
  }
  return rig.footPlants;
}

function updateFootPlant(foot, desiredAnchor, shouldPlant, dt, moving = false, fallPressure = 0, flopTime = 0) {
  foot.age = (foot.age || 0) + dt;
  foot.stuckTimer = Math.max(0, (foot.stuckTimer || 0) - dt);
  const stumbleNoise = Math.sin(flopTime * (3.1 + (foot.seed || 1)) + (foot.seed || 0));
  if (moving && foot.planted && foot.age > 0.18 && foot.stuckTimer <= 0 && stumbleNoise > 0.965 - fallPressure * 0.04) {
    foot.stuckTimer = 0.12 + Math.abs(stumbleNoise) * 0.18;
  }
  if (foot.stuckTimer > 0) shouldPlant = true;
  const messyAnchor = desiredAnchor.clone();
  messyAnchor.x += Math.sin(flopTime * 7.3 + (foot.seed || 0)) * 0.025 * (moving ? 1 : 0.18);
  messyAnchor.y *= 1 + Math.sin(flopTime * 4.7 + (foot.seed || 0)) * 0.12;
  if (shouldPlant) {
    if (!foot.planted) {
      foot.anchor.copy(messyAnchor);
      foot.age = 0;
    } else {
      // Very low drift when planted — foot stays firmly on the ground spot.
      foot.anchor.lerp(messyAnchor, 1 - Math.exp((foot.stuckTimer > 0 ? -0.25 : -0.6) * dt));
    }
    foot.planted = true;
    foot.swing = dampToward(foot.swing || 0, 0, 18, dt);
    return;
  }

  foot.planted = false;
  // Swing foot quickly to desired position so it plants ahead of the body.
  foot.anchor.lerp(messyAnchor, 1 - Math.exp(-16 * dt));
  foot.swing = dampToward(foot.swing || 0, 1, 18, dt);
}

function anchorToLegPose(anchor, sideLean, swingLift = 0) {
  const foreAft = THREE.MathUtils.clamp(anchor.y, -0.42, 0.42);
  const side = THREE.MathUtils.clamp(anchor.x, -0.42, 0.42);
  return {
    upper: THREE.MathUtils.clamp(0.14 - foreAft * 1.85 + swingLift * 0.28, -1.25, 1.18),
    calf: THREE.MathUtils.clamp(-0.22 + Math.abs(foreAft) * 0.78 + swingLift * 0.72, -0.85, 0.86),
    side: THREE.MathUtils.clamp(sideLean + side * 0.62, -0.55, 0.55)
  };
}

function ensurePartControlTarget(part) {
  if (!part.group.userData.qwopTarget) {
    part.group.userData.qwopTarget = {
      x: part.group.rotation.x || 0,
      y: part.group.rotation.y || 0,
      z: part.group.rotation.z || 0
    };
  }
  return part.group.userData.qwopTarget;
}


function ensurePartDesiredTarget(part) {
  if (!part.group.userData.qwopDesiredTarget) {
    part.group.userData.qwopDesiredTarget = {
      x: part.group.rotation.x || 0,
      y: part.group.rotation.y || 0,
      z: part.group.rotation.z || 0
    };
  }
  return part.group.userData.qwopDesiredTarget;
}

function dampToward(current, target, speed, dt) {
  return THREE.MathUtils.lerp(current, target, 1 - Math.exp(-speed * dt));
}

// Map normalized camera palm position + hand size to a 3D position in playerGroup local space.
// palmX: 0=left edge of raw camera frame, 1=right edge (back camera: user's right is on the right)
// palmY: 0=top, 1=bottom
// handSize: wrist-to-middletip distance in normalized coords; small = far = hands pulled back
function palmToLocalHandPos(palmX, palmY, handSize) {
  // Back camera is not mirrored, so flip x to match the front-camera coordinate convention
  // that the rest of the rig expects (user's right hand → negative x in local space).
  const x = (0.5 - palmX) * 1.5;
  const y = (1 - palmY) * 1.1 + 0.25;
  // Map palm size (wrist→middleMCP) [0.10, 0.28] → z [0.65, 0.0]:
  // small = hand far from camera = arms outstretched; large = close = arms pulled back.
  const sizeNorm = THREE.MathUtils.clamp((handSize - 0.10) / (0.28 - 0.10), 0, 1);
  const z = (1 - sizeNorm) * 0.65;
  return new THREE.Vector3(x, y, z);
}

const _sWorld = new THREE.Vector3();
const _hWorld = new THREE.Vector3();
const _upAxis = new THREE.Vector3(0, 1, 0);
const _rootQ = new THREE.Quaternion();
const _armQ = new THREE.Quaternion();
const _fsHandTarget = new THREE.Vector3();

// === GLB HAND MODEL SUPPORT ===

// Uniform scale applied to the loaded right_hand.glb model.
// Adjust if the hand appears too large or small.
const HAND_MODEL_SCALE = 0.7;

// Maps bone name prefix (e.g. "Bone.005") → [startLandmark, endLandmark].
// Bones 004/008/012/016 are metacarpals with no direct mediapipe data – left at rest.
// Bones are listed root→tip so the Map iteration order matches FK dependency order.
const HAND_BONE_DRIVE = new Map([
  ['Bone.001', [1, 2]],   // thumb CMC → MCP
  ['Bone.002', [2, 3]],   // thumb MCP → IP
  ['Bone.003', [3, 4]],   // thumb IP  → tip
  ['Bone.005', [5, 6]],   // index  MCP → PIP
  ['Bone.006', [6, 7]],   // index  PIP → DIP
  ['Bone.007', [7, 8]],   // index  DIP → tip
  ['Bone.009', [9, 10]],  // middle MCP → PIP
  ['Bone.010', [10, 11]], // middle PIP → DIP
  ['Bone.011', [11, 12]], // middle DIP → tip
  ['Bone.013', [13, 14]], // ring   MCP → PIP
  ['Bone.014', [14, 15]], // ring   PIP → DIP
  ['Bone.015', [15, 16]], // ring   DIP → tip
  ['Bone.017', [17, 18]], // pinky  MCP → PIP
  ['Bone.018', [18, 19]], // pinky  PIP → DIP
  ['Bone.019', [19, 20]], // pinky  DIP → tip
]);

// Resolve the canonical drive-key from a bone's scene name (handles "Bone.003_Armature" etc.)
function boneNameToKey(name) {
  // Handles both "Bone.001_Armature" and "Bone001_Armature" naming conventions
  const m = name.match(/Bone\.?(\d+)/i);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return `Bone.${String(n).padStart(3, '0')}`;
}

/**
 * After scene.updateWorldMatrix(true,true), walk every bone in the scene and
 * build a Map of { bone, restLocalQuat, restLocalDir } for each driven bone.
 * restLocalDir is the direction the bone points in its parent's local space at rest.
 */
function setupGLBHandBones(scene) {
  scene.updateWorldMatrix(true, true);
  const boneData = new Map(); // key → { bone, restLocalQuat, restLocalDir, landmarks }

  scene.traverse(obj => {
    if (!obj.isBone) return;
    const key = boneNameToKey(obj.name);
    if (!key || !HAND_BONE_DRIVE.has(key)) return;

    const restLocalQuat = obj.quaternion.clone();

    // The bone's pointing direction in its parent's local space at rest:
    // rotate the bone's natural +Y axis by restLocalQuat.
    const restLocalDir = new THREE.Vector3(0, 1, 0).applyQuaternion(restLocalQuat);

    boneData.set(key, {
      bone: obj,
      restLocalQuat,
      restLocalDir,
      landmarks: HAND_BONE_DRIVE.get(key),
    });
  });

  scene.userData.handBoneData = boneData;
  return boneData;
}

const _glbLoader = new GLTFLoader();
let _glbHandPromise = null;

function getGLBHandGLTF() {
  if (!_glbHandPromise) {
    _glbHandPromise = new Promise((resolve, reject) =>
      _glbLoader.load('/models/hands/right_hand.glb', resolve, undefined, reject)
    );
  }
  return _glbHandPromise;
}

function createHandGroup(mat, side) {
  const group = new THREE.Group();
  group.name = side + 'FloatingHand';
  group.userData.glbHandSide = side;
  group.userData.glbReady = false;
  return group;
}

/**
 * Async: loads the GLB and populates both hand groups with the skinned mesh + bones.
 * Called once from createPlayerModel; both groups are patched when ready.
 */
async function initGLBHands(leftGroup, rightGroup) {
  let gltf;
  try {
    gltf = await getGLBHandGLTF();
  } catch (e) {
    console.warn('[HandModel] Failed to load right_hand.glb:', e);
    return;
  }

  // --- Right hand ---
  const rightScene = SkeletonUtils.clone(gltf.scene);
  rightScene.scale.setScalar(HAND_MODEL_SCALE);
  rightScene.position.set(0, 0, 0); // strip any origin offset baked into the GLB
  rightScene.rotation.set(-Math.PI / 2, Math.PI, 0);
  // Zero out any armature-level offset on direct children (e.g. Armature_rootJoint)
  rightScene.children.forEach(child => {
    if (!child.isMesh) { child.position.set(0, 0, 0); child.rotation.set(0, 0, 0); }
  });

  // Wrap in a pivot group so rotations happen around Bone_Armature (the wrist joint).
  // Offset rightScene within the pivot so Bone_Armature lands at the pivot's origin,
  // which coincides with the floatingHand group origin (= wrist landmark position).
  const rightPivot = new THREE.Group();
  rightPivot.name = 'rightHandPivot';
  rightPivot.add(rightScene);
  rightGroup.add(rightPivot);
  rightScene.updateWorldMatrix(true, true);
  const rightWristBone = rightScene.getObjectByName('Bone_Armature');
  if (rightWristBone) {
    const _bonePos = new THREE.Vector3();
    rightWristBone.getWorldPosition(_bonePos);
    rightPivot.worldToLocal(_bonePos);
    rightScene.position.sub(_bonePos);
    rightScene.updateWorldMatrix(true, true);
  }

  setupGLBHandBones(rightScene);
  rightScene.traverse(obj => {
    if (obj.isMesh) {
      obj.castShadow = true;
      obj.receiveShadow = true;
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      mats.forEach(m => {
        if (m) { m.color.setHex(0xf1c27d); m.roughness = 0.8; m.transparent = true; m.opacity = 0.70; }
      });
    }
  });
  rightGroup.userData.glbScene = rightScene;  // bone data lives here
  rightGroup.userData.glbPivot = rightPivot;  // rotation/position pivot (wrist joint)
  rightGroup.userData.glbReady = true;
  // --- Left hand (mirror of right) ---
  const leftScene = SkeletonUtils.clone(gltf.scene);
  leftScene.scale.set(-HAND_MODEL_SCALE, HAND_MODEL_SCALE, HAND_MODEL_SCALE); // mirror on X
  leftScene.position.set(0, 0, 0);
  leftScene.rotation.set(-Math.PI / 2, Math.PI, 0);
  leftScene.children.forEach(child => {
    if (!child.isMesh) { child.position.set(0, 0, 0); child.rotation.set(0, 0, 0); }
  });

  const leftPivot = new THREE.Group();
  leftPivot.name = 'leftHandPivot';
  leftPivot.add(leftScene);
  leftGroup.add(leftPivot);
  leftScene.updateWorldMatrix(true, true);
  const leftWristBone = leftScene.getObjectByName('Bone_Armature');
  if (leftWristBone) {
    const _bonePos = new THREE.Vector3();
    leftWristBone.getWorldPosition(_bonePos);
    leftPivot.worldToLocal(_bonePos);
    leftScene.position.sub(_bonePos);
    leftScene.updateWorldMatrix(true, true);
  }

  setupGLBHandBones(leftScene);
  leftScene.traverse(obj => {
    if (obj.isMesh) {
      obj.castShadow = true;
      obj.receiveShadow = true;
      // Negative X scale flips winding; DoubleSide corrects the lighting.
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      mats.forEach(m => {
        if (m) { m.side = THREE.DoubleSide; m.color.setHex(0xf1c27d); m.roughness = 0.8; m.transparent = true; m.opacity = 0.70; }
      });
    }
  });
  leftGroup.userData.glbScene = leftScene;  // bone data lives here
  leftGroup.userData.glbPivot = leftPivot;  // rotation/position pivot (wrist joint)
  leftGroup.userData.glbReady = true;
}

// Reusable scratch objects for updateGLBHandBones
const _bqDelta = new THREE.Quaternion();
const _bqNew   = new THREE.Quaternion();
const _bvStart = new THREE.Vector3();
const _bvEnd   = new THREE.Vector3();
const _bvDir   = new THREE.Vector3();
const _parentMatInv = new THREE.Matrix4();

// Scratch objects for scene-level hand orientation
const _bqSceneTarget = new THREE.Quaternion();
const _bvFinger      = new THREE.Vector3();
const _bvAcross      = new THREE.Vector3();
const _bvThumb       = new THREE.Vector3();
const _bvNormal      = new THREE.Vector3();
const _bvHandRight   = new THREE.Vector3();
const _sceneM4       = new THREE.Matrix4();
// (tilt offset is now read live from handRotConfig via getOffsetQuaternion())

/**
 * Rotate the GLB scene root to match the overall hand orientation derived from
 * mediapipe landmarks, so the whole hand (not just fingers) tracks rotation.
 *
 * Coordinate mapping (derived from Q_rest = Euler(-π/2, π, 0)):
 *   GLB +X  →  pts-space "across palm" axis  (pinky→index for right, index→pinky for left)
 *   GLB +Y  →  pts-space "finger" axis        (wrist → middle MCP)
 *   GLB +Z  →  pts-space "palm normal" axis   (out of palm, upward when palm faces sky)
 */
function updateGLBHandSceneRotation(glbScene, pts, side, dt) {
  // Finger direction — landmark indices tunable in debug panel
  const { fingerLmA, fingerLmB, acrossLmA, acrossLmB } = handRotConfig;
  _bvFinger.subVectors(pts[fingerLmB], pts[fingerLmA]);
  if (_bvFinger.lengthSq() < 1e-8) return;
  _bvFinger.normalize();

  // Across-palm direction (for pitch/yaw basis only — roll is handled separately below).
  const s = (side === 'right' ? 1 : -1) * handRotConfig.acrossSign;
  _bvAcross.subVectors(pts[acrossLmA], pts[acrossLmB]).multiplyScalar(s);
  if (_bvAcross.lengthSq() < 1e-8) return;
  _bvAcross.normalize();

  // Wrist roll from thumb tip (landmark 4): project wrist→thumbTip onto the plane
  // perpendicular to the finger axis. In pts space x comes from camera 2D (reliable)
  // and z from MediaPipe depth (noisier). atan2(z, x) gives the roll angle in that
  // plane; this is added to offsetZ inside getOffsetQuaternion() each frame.
  _bvThumb.subVectors(pts[4], pts[0]);
  const thumbProj = _bvThumb.dot(_bvFinger);
  const tpX = _bvThumb.x - thumbProj * _bvFinger.x;
  const tpZ = _bvThumb.z - thumbProj * _bvFinger.z;
  const rollDeg = Math.atan2(tpZ, tpX) * (180 / Math.PI);
  handRotConfig.wristRollDeg = rollDeg;

  // Diagnostics for the debug panel.
  handRollDiag.rollDeg = rollDeg;
  handRollDiag.acrossX = tpX;
  handRollDiag.acrossZ = tpZ;

  // Palm normal — cross order tunable; optional normal flip
  if (handRotConfig.crossOrder === 'across_x_finger') {
    _bvNormal.crossVectors(_bvAcross, _bvFinger);
  } else {
    _bvNormal.crossVectors(_bvFinger, _bvAcross);
  }
  if (_bvNormal.lengthSq() < 1e-8) return;
  _bvNormal.normalize();
  if (handRotConfig.flipNormal) _bvNormal.negate();

  // Re-orthogonalize across ("right" of hand frame)
  _bvHandRight.crossVectors(_bvNormal, _bvFinger).normalize();

  // Build rotation matrix then apply live Euler offset from debug panel
  _sceneM4.makeBasis(_bvHandRight, _bvFinger, _bvNormal);
  _bqSceneTarget.setFromRotationMatrix(_sceneM4).multiply(getOffsetQuaternion());

  // Apply per-component sign corrections (tunable in debug panel)
  _bqSceneTarget.w *= handRotConfig.signW;
  _bqSceneTarget.x *= handRotConfig.signX;
  _bqSceneTarget.y *= handRotConfig.signY;
  _bqSceneTarget.z *= handRotConfig.signZ;

  // Ensure slerp always takes the short arc (prevent hemisphere-flip pop).
  // Use manual dot + component negation instead of Quaternion.dot()/.negate()
  // to avoid runtime errors on Three.js builds that lack those prototype methods.
  const _qdot = glbScene.quaternion.w * _bqSceneTarget.w
              + glbScene.quaternion.x * _bqSceneTarget.x
              + glbScene.quaternion.y * _bqSceneTarget.y
              + glbScene.quaternion.z * _bqSceneTarget.z;
  if (_qdot < 0) {
    _bqSceneTarget.w *= -1;
    _bqSceneTarget.x *= -1;
    _bqSceneTarget.y *= -1;
    _bqSceneTarget.z *= -1;
  }

  // Smooth toward target orientation
  glbScene.quaternion.slerp(_bqSceneTarget, 1 - Math.exp(-handRotConfig.smoothing * dt));
  glbScene.updateWorldMatrix(true, true);
}

/**
 * Reset all driven GLB hand bones to their rest pose (stored at setup time).
 * Call this instead of updateGLBHandBones when the hands should hold a fixed pose.
 */
function resetGLBHandBonesToRest(handGroup) {
  if (!handGroup.userData.glbReady) return;
  const glbScene = handGroup.userData.glbScene;
  const boneData = glbScene?.userData?.handBoneData;
  if (!boneData) return;
  for (const [, data] of boneData) {
    data.bone.quaternion.copy(data.restLocalQuat);
  }
}

/**
 * Drive the loaded GLB hand bones from mediapipe landmarks each frame.
 * pts[i] must be 21 THREE.Vector3 positions in playerGroup local space (same as
 * the existing landmark mapping used for the procedural hand segments).
 */
function updateGLBHandBones(handGroup, pts, playerGroup) {
  if (!handGroup.userData.glbReady) return;
  const glbScene = handGroup.userData.glbScene;
  const boneData = glbScene?.userData?.handBoneData;
  if (!boneData || boneData.size === 0) return;

  // Ensure bone world matrices are current before starting
  glbScene.updateWorldMatrix(true, true);

  const playerMat = playerGroup.matrixWorld;

  for (const [, data] of boneData) {
    const { bone, restLocalQuat, restLocalDir, landmarks: [a, b] } = data;

    // pts are in playerGroup local space; transform to world space
    _bvStart.copy(pts[a]).applyMatrix4(playerMat);
    _bvEnd.copy(pts[b]).applyMatrix4(playerMat);
    _bvDir.subVectors(_bvEnd, _bvStart);
    if (_bvDir.lengthSq() < 1e-6) continue;
    _bvDir.normalize();

    // Express targetDir in the parent bone's local space
    bone.parent.updateWorldMatrix(true, false);
    _parentMatInv.copy(bone.parent.matrixWorld).invert();
    _bvDir.transformDirection(_parentMatInv);
    if (_bvDir.lengthSq() < 1e-6) continue;
    _bvDir.normalize();

    // Delta rotation: from rest local direction to target local direction
    _bqDelta.setFromUnitVectors(restLocalDir, _bvDir);

    // New local quaternion: delta applied on top of rest
    _bqNew.multiplyQuaternions(_bqDelta, restLocalQuat);
    bone.quaternion.copy(_bqNew);

    // Propagate this bone's updated matrix so child bones see correct parent
    bone.updateWorldMatrix(false, false);
  }
}

function updateElasticArm(armMesh, shoulderAnchor, handMesh, root) {
  shoulderAnchor.getWorldPosition(_sWorld);
  handMesh.getWorldPosition(_hWorld);

  const dist = _sWorld.distanceTo(_hWorld);
  if (dist < 0.01) return;

  const midX = (_sWorld.x + _hWorld.x) * 0.5;
  const midY = (_sWorld.y + _hWorld.y) * 0.5;
  const midZ = (_sWorld.z + _hWorld.z) * 0.5;
  const mid = new THREE.Vector3(midX, midY, midZ);
  armMesh.position.copy(root.worldToLocal(mid));
  armMesh.scale.set(armConfig.thickness, dist, armConfig.thickness);

  const dir = _hWorld.clone().sub(_sWorld).normalize();
  root.getWorldQuaternion(_rootQ);
  _armQ.setFromUnitVectors(_upAxis, dir);
  armMesh.quaternion.copy(_rootQ.clone().invert().multiply(_armQ));
}

export function updateProceduralPlayerRig(playerGroup, keysPressed, deltaSeconds) {
  const rig = playerGroup?.userData?.qwopRig;
  if (!rig) return { forwardIntent: 0, balance: 0 };

  const dt = THREE.MathUtils.clamp(Number.isFinite(deltaSeconds) ? deltaSeconds : 0, 0, 0.05);

  // Update floating hands and elastic arms from hand tracking data
  if (rig.floatingHands && rig.elasticArms && rig.shoulderAnchors) {
    const handTracking = playerGroup.userData.handTrackingArms;

    // Foam sword directional mode: FoamSword.update() sets foamSwordMode=true and writes
    // foamSwordHandTarget with the desired hand position derived from index-finger direction.
    // In this mode we skip mediapipe bone animation and lock the hands to a rest/fist pose.
    if (playerGroup.userData.foamSwordMode) {
      playerGroup.userData.foamSwordMode = false; // consume the flag
      const fst = playerGroup.userData.foamSwordHandTarget;
      if (fst) {
        for (const side of ['left', 'right']) {
          const floatingHand = rig.floatingHands[side];
          // Right tracking slot (support hand) sits slightly lower on the handle
          const yOff = side === 'right' ? -0.08 : 0;
          _fsHandTarget.set(fst.x, fst.y + yOff, fst.z);
          floatingHand.position.lerp(_fsHandTarget, 1 - Math.exp(-18 * dt));
          updateElasticArm(rig.elasticArms[side], rig.shoulderAnchors[side], floatingHand, playerGroup);
          if (floatingHand.userData.glbReady) {
            const glbPivot = floatingHand.userData.glbPivot ?? floatingHand.userData.glbScene;
            if (glbPivot) glbPivot.position.set(handPosOffset.x, handPosOffset.y, handPosOffset.z);
            resetGLBHandBonesToRest(floatingHand);
          }
        }
      }
    } else {
      for (const side of ['left', 'right']) {
        const trackData = handTracking?.[side];
        const floatingHand = rig.floatingHands[side];
        const defaultX = side === 'left' ? -0.5 : 0.5;
        const defaultPos = new THREE.Vector3(defaultX, 0.82, 0.25);

        // Use wrist landmark (lm 0) for hand group position so the GLB armature
        // root sits at the wrist; fall back to palm-centre when no landmarks.
        const landmarks = trackData?.landmarks;
        const palmSize  = trackData?.size ?? 0.20;
        let targetPos;
        if (landmarks?.length >= 1) {
          const wlm = landmarks[0];
          targetPos = palmToLocalHandPos(wlm.x, wlm.y, palmSize);
        } else if (trackData) {
          targetPos = palmToLocalHandPos(trackData.x, trackData.y, palmSize);
        } else {
          targetPos = defaultPos;
        }

        const depthOverride = playerGroup.userData.handDepthOverride?.[side];
        if (depthOverride !== undefined) {
          const palmX = landmarks?.[0]?.x ?? trackData?.x ?? 0.5;
          targetPos = targetPos.clone();
          targetPos.z = typeof depthOverride === 'function' ? depthOverride(palmX) : depthOverride;
        }

        floatingHand.position.lerp(targetPos, 1 - Math.exp(-18 * dt));
        updateElasticArm(rig.elasticArms[side], rig.shoulderAnchors[side], floatingHand, playerGroup);

        // Drive GLB hand bones and overall hand rotation from mediapipe landmarks
        if (floatingHand.userData.glbReady && landmarks?.length >= 21) {
          const wrist = landmarks[0];
          const wrist3d = palmToLocalHandPos(wrist.x, wrist.y, palmSize);
          const lmScale = 0.085 / Math.max(palmSize, 0.05);
          const pts = landmarks.map(lm => new THREE.Vector3(
            wrist3d.x - (lm.x - wrist.x) * lmScale,
            wrist3d.y - (lm.y - wrist.y) * lmScale,
            wrist3d.z - (lm.z - wrist.z) * lmScale * 2
          ));
          // Rotate the pivot (wrist joint) to match overall hand orientation before driving bones.
          // glbPivot is the rotation root centered at Bone_Armature; fall back to glbScene for
          // setups that predate the pivot (shouldn't occur in practice).
          const glbPivot = floatingHand.userData.glbPivot ?? floatingHand.userData.glbScene;
          if (glbPivot) glbPivot.position.set(handPosOffset.x, handPosOffset.y, handPosOffset.z);
          if (glbPivot) updateGLBHandSceneRotation(glbPivot, pts, side, dt);
          updateGLBHandBones(floatingHand, pts, playerGroup);
        } else if (floatingHand.userData.glbReady) {
          const glbPivot = floatingHand.userData.glbPivot ?? floatingHand.userData.glbScene;
          if (glbPivot) glbPivot.position.set(handPosOffset.x, handPosOffset.y, handPosOffset.z);
        }
      }
    }
  }

  return { forwardIntent: 0, balance: 0, forwardWeight: 0 };
}

export function updateProceduralMonsterRig(monsterGroup, options = {}, deltaSeconds = 0) {
  const rig = monsterGroup?.userData?.qwopRig;
  if (!rig) return { forwardIntent: 0, balance: 0 };

  const dt = THREE.MathUtils.clamp(Number.isFinite(deltaSeconds) ? deltaSeconds : 0, 0, 0.08);
  const now = options.now ?? performance.now();
  const movementAmount = THREE.MathUtils.clamp(Number.isFinite(options.movementAmount) ? options.movementAmount : 0, 0, 1);
  const attacking = Boolean(options.attacking);
  const attackPhase = THREE.MathUtils.clamp(Number.isFinite(options.attackPhase) ? options.attackPhase : 0, 0, 1);
  const strafe = THREE.MathUtils.clamp(Number.isFinite(options.strafe) ? options.strafe : 0, -1, 1);
  const targetYaw = THREE.MathUtils.clamp(Number.isFinite(options.targetYaw) ? options.targetYaw : 0, -TORSO_MAX_TWIST, TORSO_MAX_TWIST);
  const gaitPhase = (rig.gaitPhase || 0) + dt * (attacking ? 7.5 : 5.2) * Math.max(0.25, movementAmount);
  rig.gaitPhase = gaitPhase;

  const setTarget = (name, x, y = 0, z = 0) => {
    const part = rig.parts[name];
    if (!part) return;
    const target = ensurePartControlTarget(part);
    target.x = x;
    target.y = y;
    target.z = z;
  };

  const stride = Math.sin(gaitPhase) * movementAmount;
  const counterStride = Math.sin(gaitPhase + Math.PI) * movementAmount;
  setTarget('leftLeg', 0.25 - stride * 0.95, 0, strafe * -0.18);
  setTarget('rightLeg', 0.25 - counterStride * 0.95, 0, strafe * 0.18);
  setTarget('hips', movementAmount > 0.05 ? Math.sin(gaitPhase * 2) * 0.08 : 0, 0, strafe * 0.12);
  setTarget('torso', attacking ? -0.22 + Math.sin(attackPhase * Math.PI) * 0.2 : -0.05 * movementAmount, targetYaw * 0.55, strafe * 0.12);
  setTarget('head', attacking ? -0.05 : 0, targetYaw * 0.35, strafe * 0.08);

  const leftPunchActive = monsterGroup.userData.currentAction === 'leftPunch';
  if (attacking) {
    const windup = Math.sin(attackPhase * Math.PI);
    if (leftPunchActive) {
      setTarget('leftArm', -1.2 + windup * 0.8, 0, 0.2 - windup * 0.75);
      setTarget('rightArm', 0.45 - windup * 0.35, 0, 0.25);
    } else {
      setTarget('rightArm', -1.2 + windup * 0.8, 0, -0.2 + windup * 0.75);
      setTarget('leftArm', 0.45 - windup * 0.35, 0, -0.25);
    }
  } else {
    setTarget('rightArm', 0.65 - counterStride * 0.45, 0, -0.15);
    setTarget('leftArm', 0.65 - stride * 0.45, 0, 0.15);
  }

  const specs = {
    hips: { min: -0.5, max: 0.5, sideMin: -0.45, sideMax: 0.45, twistMin: -0.8, twistMax: 0.8 },
    leftLeg: { min: -1.45, max: 1.35, sideMin: -0.65, sideMax: 0.65, twistMin: -0.5, twistMax: 0.5 },
    rightLeg: { min: -1.45, max: 1.35, sideMin: -0.65, sideMax: 0.65, twistMin: -0.5, twistMax: 0.5 },
    leftArm: { min: -1.45, max: 1.35, sideMin: -1.1, sideMax: 1.1, twistMin: -0.8, twistMax: 0.8 },
    rightArm: { min: -1.45, max: 1.35, sideMin: -1.1, sideMax: 1.1, twistMin: -0.8, twistMax: 0.8 },
    torso: { min: -0.95, max: 0.95, sideMin: -0.35, sideMax: 0.35, twistMin: -TORSO_MAX_TWIST, twistMax: TORSO_MAX_TWIST },
    head: { min: -0.45, max: 0.45, sideMin: -0.55, sideMax: 0.55, twistMin: -0.9, twistMax: 0.9 }
  };

  Object.entries(rig.parts).forEach(([name, part]) => {
    const spec = specs[name];
    if (!part || !spec) return;
    const target = ensurePartControlTarget(part);
    part.group.rotation.x = dampToward(part.group.rotation.x, THREE.MathUtils.clamp(target.x, spec.min, spec.max), TARGET_FOLLOW_SPEED, dt);
    part.group.rotation.y = dampToward(part.group.rotation.y, THREE.MathUtils.clamp(target.y, spec.twistMin, spec.twistMax), TARGET_FOLLOW_SPEED, dt);
    part.group.rotation.z = dampToward(part.group.rotation.z, THREE.MathUtils.clamp(target.z, spec.sideMin, spec.sideMax), TARGET_FOLLOW_SPEED, dt);
  });

  if (!attacking) {
    monsterGroup.userData.currentAction = movementAmount > 0.08 ? 'qwop' : 'idle';
  }
  return { forwardIntent: movementAmount, balance: 0 };
}

export function createPlayerModel(
  THREE,
  username,
  onLoad,
  modelPath = '/models/cowboy.fbx'
) {
  const playerGroup = new THREE.Group();
  playerGroup.name = 'ProceduralGangBeastsPlayer';

  const { root: bodyRoot, parts, shoulderAnchors } = createProceduralBody(THREE);
  playerGroup.add(bodyRoot);

  // Floating hands and elastic arms are direct children of playerGroup so they remain
  // visible in first-person even when bodyRoot is hidden.
  const skinMat = new THREE.MeshStandardMaterial({ color: 0xf1c27d, roughness: 0.8, transparent: true, opacity: 0.70 });

  const leftFloatingHand = createHandGroup(skinMat, 'left');
  leftFloatingHand.position.set(-0.5, 0.82, 0.25);
  playerGroup.add(leftFloatingHand);

  const rightFloatingHand = createHandGroup(skinMat.clone(), 'right');
  rightFloatingHand.position.set(0.5, 0.82, 0.25);
  playerGroup.add(rightFloatingHand);

  // Kick off async GLB load; groups are patched in-place when the model arrives.
  initGLBHands(leftFloatingHand, rightFloatingHand).catch(e =>
    console.warn('[HandModel] initGLBHands error:', e)
  );

  const elasticMat = new THREE.MeshStandardMaterial({ color: 0xf1c27d, roughness: 0.8, transparent: true, opacity: 0.70 });
  const leftElasticArm = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 1, 8), elasticMat);
  leftElasticArm.name = 'leftElasticArm';
  leftElasticArm.castShadow = true;
  leftElasticArm.receiveShadow = true;
  playerGroup.add(leftElasticArm);

  const rightElasticArm = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 1, 8), elasticMat.clone());
  rightElasticArm.name = 'rightElasticArm';
  rightElasticArm.castShadow = true;
  rightElasticArm.receiveShadow = true;
  playerGroup.add(rightElasticArm);

  playerGroup.userData.qwopRig = {
    parts,
    bodyRoot,
    floatingHands: { left: leftFloatingHand, right: rightFloatingHand },
    elasticArms: { left: leftElasticArm, right: rightElasticArm },
    shoulderAnchors,
    forwardIntent: 0,
    balance: 0,
    modelPath,
    description: 'Procedural floppy Gang Beasts-style player body',
    glbMixer: null,
    glbWalkAction: null,
    glbIsWalking: false,
  };
  playerGroup.userData.currentAction = 'idle';
  playerGroup.userData.actions = {};
  playerGroup.userData.mixer = null;

  // Hide the capsule and load the GLB character in its place
  const capsuleMesh = bodyRoot.getObjectByName('bodyCapsulemesh');
  if (capsuleMesh) capsuleMesh.visible = false;

  createGLBCharacterInstance({ targetHeight: 1.0 }).then(({ container, mixer, walkAction }) => {
    bodyRoot.add(container);
    const rig = playerGroup.userData.qwopRig;
    rig.glbMixer = mixer;
    rig.glbWalkAction = walkAction;
  }).catch(e => console.warn('[PlayerModel] GLB character load failed:', e));

  if (onLoad) {
    queueMicrotask(() => onLoad({ mixer: null, actions: {} }));
  }

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

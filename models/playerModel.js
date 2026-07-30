// /models/playerModel.js
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
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

  const materials = {
    shirt: 0x2e86de,
    shorts: 0x1f2d3d,
    skin: 0xf1c27d,
    shoe: 0x222222
  };

  const hips = new THREE.Group();
  hips.name = 'hips';
  // The player group is positioned at the physics capsule center. Keep the hips
  // near that origin so the legs reach the ground instead of hovering above it.
  hips.position.y = 0;
  root.add(hips);

  const torso = createLimbSegment(THREE, 'torso', {
    length: 0.74,
    radius: 0.23,
    color: materials.shirt,
    mass: 7,
    shape: 'box'
  });
  torso.group.position.y = 0.05;
  torso.mesh.position.y = torso.length / 2;
  torso.mesh.scale.x = 1.35;
  hips.add(torso.group);

  const neck = new THREE.Group();
  neck.name = 'neck';
  neck.userData.mass = 7;
  neck.position.y = torso.length + 0.1;
  torso.group.add(neck);

  const headGeometry = new THREE.SphereGeometry(0.24, 22, 18);
  const headMaterial = new THREE.MeshStandardMaterial({ color: materials.skin, roughness: 0.8 });
  const head = new THREE.Mesh(headGeometry, headMaterial);
  head.name = 'head';
  head.castShadow = true;
  head.receiveShadow = true;
  head.position.y = 0.18;
  neck.add(head);

  const face = new THREE.Mesh(
    new THREE.SphereGeometry(0.025, 8, 8),
    new THREE.MeshBasicMaterial({ color: 0x111111 })
  );
  face.name = 'faceDirectionDot';
  face.position.set(0, 0.18, 0.225);
  neck.add(face);

  const leftLeg = createLimbSegment(THREE, 'leftLeg', {
    length: 0.44,
    radius: 0.095,
    color: materials.shorts,
    mass: 10
  });
  leftLeg.group.position.set(-0.14, 0, 0);
  hips.add(leftLeg.group);

  const rightLeg = createLimbSegment(THREE, 'rightLeg', {
    length: 0.44,
    radius: 0.095,
    color: materials.shorts,
    mass: 10
  });
  rightLeg.group.position.set(0.14, 0, 0);
  hips.add(rightLeg.group);

  const leftCalf = createLimbSegment(THREE, 'leftCalf', {
    length: 0.42,
    radius: 0.08,
    color: materials.skin,
    mass: 8
  });
  leftCalf.group.position.y = -leftLeg.length;
  leftLeg.group.add(leftCalf.group);

  const rightCalf = createLimbSegment(THREE, 'rightCalf', {
    length: 0.42,
    radius: 0.08,
    color: materials.skin,
    mass: 8
  });
  rightCalf.group.position.y = -rightLeg.length;
  rightLeg.group.add(rightCalf.group);

  for (const calf of [leftCalf, rightCalf]) {
    const knee = new THREE.Mesh(
      new THREE.SphereGeometry(0.095, 14, 10),
      new THREE.MeshStandardMaterial({ color: materials.shorts, roughness: 0.75 })
    );
    knee.name = `${calf.group.name}Knee`;
    knee.castShadow = true;
    knee.receiveShadow = true;
    calf.group.add(knee);

    const shoe = new THREE.Mesh(
      new THREE.BoxGeometry(0.18, 0.08, 0.28),
      new THREE.MeshStandardMaterial({ color: materials.shoe, roughness: 0.7 })
    );
    shoe.name = `${calf.group.name}Shoe`;
    shoe.castShadow = true;
    shoe.receiveShadow = true;
    shoe.position.set(0, -calf.length - 0.02, 0.06);
    calf.group.add(shoe);
  }

  // Shoulder anchors — invisible groups attached to torso, used to get world-space shoulder origin
  const leftShoulderAnchor = new THREE.Group();
  leftShoulderAnchor.name = 'leftShoulderAnchor';
  leftShoulderAnchor.position.set(-0.38, 0.64, 0);
  torso.group.add(leftShoulderAnchor);

  const rightShoulderAnchor = new THREE.Group();
  rightShoulderAnchor.name = 'rightShoulderAnchor';
  rightShoulderAnchor.position.set(0.38, 0.64, 0);
  torso.group.add(rightShoulderAnchor);

  torso.restRotation = 0;
  leftLeg.restRotation = 0.18;
  rightLeg.restRotation = 0.18;
  leftCalf.restRotation = 0.1;
  rightCalf.restRotation = 0.1;

  const hipsPart = {
    group: hips,
    mesh: null,
    length: 0,
    mass: 5,
    restRotation: 0,
    restRotationY: 0,
    restRotationZ: 0,
    angularVelocity: 0
  };

  const headPart = {
    group: neck,
    mesh: head,
    length: 0.36,
    mass: 7,
    restRotation: 0,
    restRotationY: 0,
    restRotationZ: 0,
    angularVelocity: 0
  };

  const parts = {
    hips: hipsPart,
    torso,
    head: headPart,
    leftLeg,
    rightLeg,
    leftCalf,
    rightCalf
  };

  Object.values(parts).forEach((part) => {
    part.group.rotation.x = part.restRotation;
    part.group.rotation.y = part.restRotationY || 0;
    part.group.rotation.z = part.restRotationZ || 0;
    part.group.userData.physics = {
      mass: part.mass,
      angularVelocity: 0,
      gravityScale: 1,
      groundLimit: part.group.name.includes('Leg') ? 0.95 : 1.25
    };
    part.group.userData.qwopTarget = {
      x: part.group.rotation.x,
      y: part.group.rotation.y,
      z: part.group.rotation.z
    };
    part.group.userData.qwopDesiredTarget = {
      x: part.group.rotation.x,
      y: part.group.rotation.y,
      z: part.group.rotation.z
    };
  });

  return {
    root,
    parts,
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
  rightGroup.add(rightScene);
  // Also zero out any armature-level offset on direct children
  rightScene.children.forEach(child => {
    if (!child.isMesh) { child.position.set(0, 0, 0); child.rotation.set(0, 0, 0); }
  });
  rightScene.updateWorldMatrix(true, true);
  setupGLBHandBones(rightScene);
  rightScene.traverse(obj => {
    if (obj.isMesh) {
      obj.castShadow = true;
      obj.receiveShadow = true;
    }
  });
  rightGroup.userData.glbScene = rightScene;
  rightGroup.userData.glbReady = true;

  // --- Left hand (mirror of right) ---
  const leftScene = SkeletonUtils.clone(gltf.scene);
  leftScene.scale.set(-HAND_MODEL_SCALE, HAND_MODEL_SCALE, HAND_MODEL_SCALE); // mirror on X
  leftScene.position.set(0, 0, 0);
  leftScene.rotation.set(-Math.PI / 2, Math.PI, 0);
  leftGroup.add(leftScene);
  leftScene.children.forEach(child => {
    if (!child.isMesh) { child.position.set(0, 0, 0); child.rotation.set(0, 0, 0); }
  });
  leftScene.updateWorldMatrix(true, true);
  setupGLBHandBones(leftScene);
  leftScene.traverse(obj => {
    if (obj.isMesh) {
      obj.castShadow = true;
      obj.receiveShadow = true;
      // Negative X scale flips winding; DoubleSide corrects the lighting.
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      mats.forEach(m => { if (m) m.side = THREE.DoubleSide; });
    }
  });
  leftGroup.userData.glbScene = leftScene;
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
const _bvNormal      = new THREE.Vector3();
const _bvHandRight   = new THREE.Vector3();
const _sceneM4       = new THREE.Matrix4();
// 90° offset around the GLB's local X axis so fingers point forward rather than down
const _handTiltOffset = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);

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
  // Finger direction: wrist (lm 0) → middle finger MCP (lm 9)
  _bvFinger.subVectors(pts[9], pts[0]);
  if (_bvFinger.lengthSq() < 1e-8) return;
  _bvFinger.normalize();

  // Across-palm: for right hand pts[17]→pts[5] gives ≈(+1,0,0) at rest;
  // for left hand negate so both reference axes point the same way (matching the mirrored GLB).
  const s = side === 'right' ? 1 : -1;
  _bvAcross.subVectors(pts[17], pts[5]).multiplyScalar(s);
  if (_bvAcross.lengthSq() < 1e-8) return;
  _bvAcross.normalize();

  // Palm normal = cross(across, finger) → +Y when palm faces sky at rest
  _bvNormal.crossVectors(_bvAcross, _bvFinger);
  if (_bvNormal.lengthSq() < 1e-8) return;
  _bvNormal.normalize();

  // Re-orthogonalize across ("right" of hand frame)
  _bvHandRight.crossVectors(_bvNormal, _bvFinger).normalize();

  // Build rotation matrix: makeBasis(xCol, yCol, zCol) maps GLB local axes to world
  // then post-multiply a 90° tilt so fingers point forward rather than down
  _sceneM4.makeBasis(_bvHandRight, _bvFinger, _bvNormal);
  _bqSceneTarget.setFromRotationMatrix(_sceneM4).multiply(_handTiltOffset);

  // Ensure slerp always takes the short arc (prevent hemisphere-flip pop)
  if (glbScene.quaternion.dot(_bqSceneTarget) < 0) _bqSceneTarget.negate();

  // Smooth toward target orientation
  glbScene.quaternion.slerp(_bqSceneTarget, 1 - Math.exp(-14 * dt));
  glbScene.updateWorldMatrix(true, true);
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
  armMesh.scale.set(1, dist, 1);

  const dir = _hWorld.clone().sub(_sWorld).normalize();
  root.getWorldQuaternion(_rootQ);
  _armQ.setFromUnitVectors(_upAxis, dir);
  armMesh.quaternion.copy(_rootQ.clone().invert().multiply(_armQ));
}

export function updateProceduralPlayerRig(playerGroup, keysPressed, deltaSeconds) {
  const rig = playerGroup?.userData?.qwopRig;
  if (!rig) return { forwardIntent: 0, balance: 0 };

  const dt = THREE.MathUtils.clamp(Number.isFinite(deltaSeconds) ? deltaSeconds : 0, 0, 0.05);
  const pressed = (key) => keysPressed?.has?.(key);
  const moveX = (pressed('a') ? 1 : 0) + (pressed('d') ? -1 : 0);
  const moveZ = (pressed('w') ? 1 : 0) + (pressed('s') ? -1 : 0);
  const movementAmount = THREE.MathUtils.clamp(Math.hypot(moveX, moveZ), 0, 1);
  const moving = movementAmount > 0.05;
  const attack = playerGroup.userData.attack;
  const currentAction = playerGroup.userData.currentAction;
  const attackName = attack?.name || currentAction;
  const attackElapsed = attack?.start ? Math.max(0, Date.now() - attack.start) : 0;
  const attackPhase = attack?.start ? THREE.MathUtils.clamp(attackElapsed / 420, 0, 1) : 0;
  const leftPunch = currentAction === 'leftPunch' || attackName === 'leftPunch';
  const rightPunch = currentAction === 'mutantPunch' || attackName === 'mutantPunch' || attackName === 'swordSlash' || attackName === 'hammerSlash';
  const knocked = Boolean(playerGroup.userData.isKnocked || (rig.knockedUntil && Date.now() < rig.knockedUntil));

  rig.gaitPhase = (rig.gaitPhase || 0) + dt * (moving ? 5.4 + movementAmount * 3.1 : 1.1);
  rig.flopTime = (rig.flopTime || 0) + dt;

  const footPlants = getRigFootPlants(rig);
  const stepCycle = rig.gaitPhase / (Math.PI * 2);
  const leftStep = (footPlants.left.age || 0) > (footPlants.right.age || 0) + Math.sin(rig.flopTime * 2.9) * 0.11;
  const desiredStep = moving ? (leftStep ? 'left' : 'right') : null;
  const supportFoot = moving ? (desiredStep === 'left' ? footPlants.right : footPlants.left) : null;
  const supportAnchor = supportFoot?.anchor ?? new THREE.Vector2(0, 0);
  const rawComOffset = new THREE.Vector2(
    moveX * 0.16 + (rig.parts.torso?.group.rotation.z || 0) * 0.38,
    moveZ * 0.24 - (rig.parts.torso?.group.rotation.x || 0) * 0.44
  );
  const supportError = rawComOffset.clone().sub(supportAnchor);
  const fallPressure = THREE.MathUtils.clamp(supportError.length() / GANG_BEASTS_SUPPORT_LIMIT, 0, 1.8);
  const nowMs = Date.now();
  const recoveryElapsedMs = Math.max(0, nowMs - (rig.knockedUntil || 0));
  const recoveryFactor = knocked
    ? 0
    : (rig.knockedUntil ? THREE.MathUtils.clamp(recoveryElapsedMs / 1100, 0.28, 1) : 1);
  rig.recoveryFactor = dampToward(rig.recoveryFactor ?? recoveryFactor, recoveryFactor, knocked ? 2.5 : 5, dt);
  rig.balanceError = supportError;

  if (rig.bodyRoot) {
    const stumbleBob = moving && !knocked ? Math.sin(stepCycle * Math.PI * 4) * 0.018 - fallPressure * 0.012 : 0;
    rig.bodyRoot.position.y = dampToward(rig.bodyRoot.position.y, stumbleBob, moving ? 8 : 4, dt);
  }

  const setTarget = (name, x, y = 0, z = 0) => {
    const part = rig.parts[name];
    if (!part) return;
    const target = ensurePartDesiredTarget(part);
    target.x = x;
    target.y = y;
    target.z = z;
  };

  const balanceCorrection = THREE.MathUtils.clamp(fallPressure * 0.12, 0, 0.22);
  const headLag = rig.parts.head?.group.rotation.x || 0;
  const sideLean = THREE.MathUtils.clamp(-supportError.x * 0.34 + Math.sin(rig.flopTime * 2.1) * 0.04, -0.42, 0.42);
  const forwardLean = moving
    ? THREE.MathUtils.clamp(-0.16 - movementAmount * 0.34 - supportError.y * 0.26 + headLag * 0.18, -0.62, 0.28)
    : THREE.MathUtils.clamp(-supportError.y * 0.1 + Math.sin(rig.flopTime * 1.7) * 0.035, -0.16, 0.16);
  const idleFlop = Math.sin(rig.flopTime * 2.3) * (0.035 + (1 - (rig.recoveryFactor || 1)) * 0.08);
  const punchArc = Math.sin(attackPhase * Math.PI);
  const punchWindup = Math.sin(Math.min(attackPhase, 0.45) / 0.45 * Math.PI);
  const stepForward = THREE.MathUtils.clamp(moveZ || movementAmount, -1, 1) * GANG_BEASTS_STEP_LENGTH;
  const stepSide = THREE.MathUtils.clamp(moveX, -1, 1) * 0.18;
  const leftDesiredAnchor = new THREE.Vector2(-GANG_BEASTS_STEP_WIDTH + stepSide, 0.02 + stepForward + supportError.y * 0.7);
  const rightDesiredAnchor = new THREE.Vector2(GANG_BEASTS_STEP_WIDTH + stepSide, -0.02 + stepForward + supportError.y * 0.7);
  const canSwitchStep = Math.max(footPlants.left.age || 0, footPlants.right.age || 0) > GANG_BEASTS_STEP_SWITCH_SECONDS;

  if (moving && canSwitchStep && Math.sin(rig.flopTime * 5.1 + fallPressure) > -0.55) footPlants.nextFoot = desiredStep;
  updateFootPlant(footPlants.left, leftDesiredAnchor, !moving || footPlants.nextFoot !== 'left', dt, moving, fallPressure, rig.flopTime);
  updateFootPlant(footPlants.right, rightDesiredAnchor, !moving || footPlants.nextFoot !== 'right', dt, moving, fallPressure, rig.flopTime);
  if (moving && footPlants[footPlants.nextFoot]?.swing > 0.86 && Math.sin(rig.flopTime * 3.7) > -0.25) {
    footPlants.nextFoot = footPlants.nextFoot === 'left' ? 'right' : 'left';
  }
  const leftPose = anchorToLegPose(footPlants.left.anchor, sideLean, footPlants.left.swing || 0);
  const rightPose = anchorToLegPose(footPlants.right.anchor, sideLean, footPlants.right.swing || 0);

  if (knocked) {
    setTarget('hips', -0.18, 0, 0);
    setTarget('torso', -1.18, 0, rig.knockDirection?.x ? THREE.MathUtils.clamp(-rig.knockDirection.x * 0.45, -0.55, 0.55) : 0.35);
    setTarget('head', -0.65, 0, 0.25);
    setTarget('leftLeg', 0.45, 0, 0.22);
    setTarget('rightLeg', 0.45, 0, -0.22);
    setTarget('leftCalf', -0.85, 0, 0.08);
    setTarget('rightCalf', -0.85, 0, -0.08);
  } else {
    setTarget('hips', (moving ? -supportError.y * 0.22 : idleFlop) + balanceCorrection, 0, sideLean - supportError.x * 0.35);
    setTarget('torso', forwardLean + idleFlop, -supportError.x * 0.16, sideLean * 0.55 - supportError.x * 0.25);
    setTarget('head', -forwardLean * 0.28, supportError.x * 0.1, sideLean * 0.35);

    // Foot planting drives the gait: planted feet lag and push against the pelvis,
    // while the off-balance foot swings toward the next support point.
    setTarget('leftLeg', leftPose.upper, 0, leftPose.side);
    setTarget('rightLeg', rightPose.upper, 0, rightPose.side);
    setTarget('leftCalf', leftPose.calf, 0, sideLean * 0.18);
    setTarget('rightCalf', rightPose.calf, 0, sideLean * 0.18);

    if (leftPunch) {
      setTarget('torso', forwardLean - punchArc * 0.28, 0.18 * punchArc, sideLean + 0.1 * punchArc);
    }
    if (rightPunch) {
      setTarget('torso', forwardLean - punchArc * 0.28, -0.18 * punchArc, sideLean - 0.1 * punchArc);
    }
  }

  const motorStrength = knocked ? 0.18 : 0.22 + (rig.recoveryFactor || 1) * 0.34;
  const torsoMotorStrength = knocked ? 0.12 : 0.18 + (rig.recoveryFactor || 1) * 0.3;
  const specs = {
    hips: { min: -0.65, max: 0.65, sideMin: -0.55, sideMax: 0.55, twistMin: -0.7, twistMax: 0.7, stiffness: 3.1 * motorStrength, damping: 0.9 + motorStrength * 0.25, gravity: 7.5, lag: 3.2 },
    leftLeg: { min: -1.45, max: 1.25, sideMin: -0.8, sideMax: 0.8, twistMin: -0.55, twistMax: 0.55, stiffness: 9.5 * motorStrength, damping: 1.05 + motorStrength * 0.35, gravity: 24, lag: 13 },
    rightLeg: { min: -1.45, max: 1.25, sideMin: -0.8, sideMax: 0.8, twistMin: -0.55, twistMax: 0.55, stiffness: 9.5 * motorStrength, damping: 1.05 + motorStrength * 0.35, gravity: 24, lag: 12 },
    leftCalf: { min: -1.15, max: 1.25, sideMin: -0.45, sideMax: 0.45, twistMin: -0.35, twistMax: 0.35, stiffness: 10.5 * motorStrength, damping: 0.95 + motorStrength * 0.35, gravity: 26, parent: 'leftLeg', lag: 14 },
    rightCalf: { min: -1.15, max: 1.25, sideMin: -0.45, sideMax: 0.45, twistMin: -0.35, twistMax: 0.35, stiffness: 10.5 * motorStrength, damping: 0.95 + motorStrength * 0.35, gravity: 26, parent: 'rightLeg', lag: 13 },
    torso: { min: -1.25, max: 0.75, sideMin: -0.75, sideMax: 0.75, twistMin: -TORSO_MAX_TWIST, twistMax: TORSO_MAX_TWIST, stiffness: 2.7 * torsoMotorStrength, damping: knocked ? 0.55 : 0.75 + torsoMotorStrength * 0.25, gravity: knocked ? 34 : 13, lag: 2.7 },
    head: { min: -1.05, max: 0.8, sideMin: -0.85, sideMax: 0.85, twistMin: -1.05, twistMax: 1.05, stiffness: 1.6 * torsoMotorStrength, damping: knocked ? 0.45 : 0.55 + torsoMotorStrength * 0.18, gravity: knocked ? 30 : 22, lag: 2.1 }
  };

  Object.entries(rig.parts).forEach(([name, part]) => {
    const spec = specs[name];
    if (!part || !spec) return;
    const physics = part.group.userData.physics || (part.group.userData.physics = { angularVelocity: 0 });
    const target = ensurePartControlTarget(part);
    const desired = ensurePartDesiredTarget(part);
    const lag = spec.lag || GANG_BEASTS_MOTOR_LAG_SPEED;
    target.x = dampToward(target.x, desired.x, lag, dt);
    target.y = dampToward(target.y, desired.y, lag * 0.85, dt);
    target.z = dampToward(target.z, desired.z, lag * 0.85, dt);
    const angle = part.group.rotation.x;
    if (spec.noInertia) {
      physics.angularVelocity = 0;
      part.group.rotation.x = THREE.MathUtils.clamp(dampToward(angle, target.x, spec.lag || GANG_BEASTS_MOTOR_LAG_SPEED, dt), spec.min, spec.max);
    } else {
      const parentAngle = spec.parent ? rig.parts[spec.parent]?.group.rotation.x || 0 : 0;
      const gravityPull = Math.sin(angle + parentAngle - (part.restRotation || 0)) * spec.gravity * 0.08;
      const spring = (THREE.MathUtils.clamp(target.x, spec.min, spec.max) - angle) * spec.stiffness;
      const noise = Math.sin(rig.flopTime * (name.length + 2.7)) * (knocked ? 0.35 : 0.14);
      physics.angularVelocity = (physics.angularVelocity || 0) + (spring - gravityPull + noise) * dt;
      physics.angularVelocity *= Math.exp(-spec.damping * dt);
      part.group.rotation.x = THREE.MathUtils.clamp(angle + physics.angularVelocity * dt, spec.min, spec.max);
    }
    part.group.rotation.y = dampToward(part.group.rotation.y, THREE.MathUtils.clamp(target.y, spec.twistMin, spec.twistMax), knocked ? 2.5 : 5.5, dt);
    part.group.rotation.z = dampToward(part.group.rotation.z, THREE.MathUtils.clamp(target.z, spec.sideMin, spec.sideMax), knocked ? 2.2 : 4.8, dt);
  });

  rig.balance = sideLean;
  rig.forwardIntent = movementAmount;
  rig.forwardWeight = forwardLean;
  rig.lastControls = {
    mode: 'gang-beasts',
    movementAmount,
    leftPunch,
    rightPunch,
    knocked
  };

  if (!playerGroup.userData.isKnocked && !leftPunch && !rightPunch) {
    playerGroup.userData.currentAction = moving ? 'walk' : 'idle';
  }

  // Update floating hands and elastic arms from hand tracking data
  if (rig.floatingHands && rig.elasticArms && rig.shoulderAnchors) {
    const handTracking = playerGroup.userData.handTrackingArms;
    for (const side of ['left', 'right']) {
      const trackData = handTracking?.[side];
      const floatingHand = rig.floatingHands[side];
      const defaultX = side === 'left' ? -0.5 : 0.5;
      const defaultPos = new THREE.Vector3(defaultX, 0.65, 0.25);

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
        // Rotate the scene root to match overall hand orientation before driving bones
        const glbScene = floatingHand.userData.glbScene;
        if (glbScene) updateGLBHandSceneRotation(glbScene, pts, side, dt);
        updateGLBHandBones(floatingHand, pts, playerGroup);
      }
    }
  }

  return { forwardIntent: rig.forwardIntent, balance: rig.balance, forwardWeight: rig.forwardWeight };
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
  leftFloatingHand.position.set(-0.5, 0.65, 0.25);
  playerGroup.add(leftFloatingHand);

  const rightFloatingHand = createHandGroup(skinMat.clone(), 'right');
  rightFloatingHand.position.set(0.5, 0.65, 0.25);
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
    description: 'Procedural floppy Gang Beasts-style player body'
  };
  playerGroup.userData.currentAction = 'idle';
  playerGroup.userData.actions = {};
  playerGroup.userData.mixer = null;

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

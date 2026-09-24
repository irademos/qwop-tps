// /models/playerModel.js
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import * as THREE from 'three';
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

  return { root, parts: {} };
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

const _fsHandTarget = new THREE.Vector3();
const _defaultHandPos = new THREE.Vector3();

// Animate the GLB character body, then pose its arms so the hands reach the floating hands.
// The floating hand groups are invisible IK targets / weapon attach points; solveArm() moves
// them to where the GLB hand actually ended up.
function updateGLBCharacter(rig, dt, isMoving) {
  const character = rig.glbCharacter;
  if (!character) return;
  character.setMoving(isMoving);
  character.animate(dt);
  character.solveArm('right', rig.floatingHands.right);
  character.solveArm('left', rig.floatingHands.left);
  character.stepFluff(dt);
}

export function updateProceduralPlayerRig(playerGroup, keysPressed, deltaSeconds, options = {}) {
  const rig = playerGroup?.userData?.qwopRig;
  if (!rig) return { forwardIntent: 0, balance: 0 };

  const dt = THREE.MathUtils.clamp(Number.isFinite(deltaSeconds) ? deltaSeconds : 0, 0, 0.05);

  // Move the floating hand targets from the held weapon or hand tracking data
  if (rig.floatingHands) {
    const handTracking = playerGroup.userData.handTrackingArms;

    // Foam sword directional mode: FoamSword.update() (and shield/pistol in phone sword mode)
    // sets foamSwordMode=true and writes foamSwordHandTarget with the desired grip position.
    if (playerGroup.userData.foamSwordMode) {
      playerGroup.userData.foamSwordMode = false; // consume the flag
      const fst = playerGroup.userData.foamSwordHandTarget;
      if (fst) {
        for (const side of ['left', 'right']) {
          // Right tracking slot (support hand) sits slightly lower on the handle
          const yOff = side === 'right' ? -0.08 : 0;
          _fsHandTarget.set(fst.x, fst.y + yOff, fst.z);
          rig.floatingHands[side].position.lerp(_fsHandTarget, 1 - Math.exp(-18 * dt));
        }
      }
    } else {
      for (const side of ['left', 'right']) {
        const trackData = handTracking?.[side];
        const floatingHand = rig.floatingHands[side];

        // Use the wrist landmark (lm 0) when available, else the palm centre
        const landmarks = trackData?.landmarks;
        const palmSize  = trackData?.size ?? 0.20;
        let targetPos;
        if (landmarks?.length >= 1) {
          targetPos = palmToLocalHandPos(landmarks[0].x, landmarks[0].y, palmSize);
        } else if (trackData) {
          targetPos = palmToLocalHandPos(trackData.x, trackData.y, palmSize);
        } else {
          targetPos = _defaultHandPos.set(side === 'left' ? -0.5 : 0.5, 0.82, 0.25);
        }

        const depthOverride = playerGroup.userData.handDepthOverride?.[side];
        if (depthOverride !== undefined) {
          const palmX = landmarks?.[0]?.x ?? trackData?.x ?? 0.5;
          targetPos = targetPos.clone();
          targetPos.z = typeof depthOverride === 'function' ? depthOverride(palmX) : depthOverride;
        }

        floatingHand.position.lerp(targetPos, 1 - Math.exp(-18 * dt));
      }
    }
  }

  updateGLBCharacter(rig, dt, !!options.isMoving);

  return { forwardIntent: 0, balance: 0, forwardWeight: 0 };
}

/**
 * Per-frame update for remote players' models (no local input): walk/idle is picked
 * from how fast the model moved since the last frame; hands stay at their defaults.
 */
export function updateRemotePlayerRig(playerGroup, deltaSeconds) {
  const rig = playerGroup?.userData?.qwopRig;
  if (!rig) return;
  const dt = THREE.MathUtils.clamp(Number.isFinite(deltaSeconds) ? deltaSeconds : 0, 0, 0.05);
  const pos = playerGroup.position;
  if (!rig.lastRemotePos) rig.lastRemotePos = pos.clone();
  const speed = dt > 0 ? Math.hypot(pos.x - rig.lastRemotePos.x, pos.z - rig.lastRemotePos.z) / dt : 0;
  rig.lastRemotePos.copy(pos);
  updateGLBCharacter(rig, dt, speed > 0.4);
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

  const { root: bodyRoot, parts } = createProceduralBody(THREE);
  playerGroup.add(bodyRoot);

  // Floating hands: invisible targets the GLB character's arms reach for (see
  // glbCharacterModel.js) and the attach points held weapons follow. They are direct
  // children of playerGroup so weapons stay placed in first-person when bodyRoot is hidden.
  // `proceduralHand` marks them for Weapon._getHandBone() so the GLB's own
  // mixamorig hand bones are never picked as weapon attach points.
  const leftFloatingHand = new THREE.Group();
  leftFloatingHand.name = 'leftFloatingHand';
  leftFloatingHand.userData.proceduralHand = 'left';
  leftFloatingHand.position.set(-0.5, 0.82, 0.25);
  playerGroup.add(leftFloatingHand);

  const rightFloatingHand = new THREE.Group();
  rightFloatingHand.name = 'rightFloatingHand';
  rightFloatingHand.userData.proceduralHand = 'right';
  rightFloatingHand.position.set(0.5, 0.82, 0.25);
  playerGroup.add(rightFloatingHand);

  playerGroup.userData.qwopRig = {
    parts,
    bodyRoot,
    floatingHands: { left: leftFloatingHand, right: rightFloatingHand },
    forwardIntent: 0,
    balance: 0,
    modelPath,
    description: 'GLB character with IK arms reaching for floating hand targets',
    glbCharacter: null,
  };
  playerGroup.userData.currentAction = 'idle';
  playerGroup.userData.actions = {};
  playerGroup.userData.mixer = null;

  // Hide the capsule and load the GLB character in its place
  const capsuleMesh = bodyRoot.getObjectByName('bodyCapsulemesh');
  if (capsuleMesh) capsuleMesh.visible = false;

  createGLBCharacterInstance({ targetHeight: 1.0 }).then(({ container, character }) => {
    bodyRoot.add(container);
    playerGroup.userData.qwopRig.glbCharacter = character;
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

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

  const leftArm = createLimbSegment(THREE, 'leftArm', {
    length: 0.64,
    radius: 0.075,
    color: materials.skin,
    mass: 4
  });
  leftArm.group.position.set(-0.38, 0.64, 0);
  torso.group.add(leftArm.group);

  const rightArm = createLimbSegment(THREE, 'rightArm', {
    length: 0.64,
    radius: 0.075,
    color: materials.skin,
    mass: 4
  });
  rightArm.group.position.set(0.38, 0.64, 0);
  torso.group.add(rightArm.group);

  for (const arm of [leftArm, rightArm]) {
    const hand = new THREE.Mesh(
      new THREE.SphereGeometry(0.085, 12, 10),
      new THREE.MeshStandardMaterial({ color: materials.skin, roughness: 0.8 })
    );
    hand.name = `${arm.group.name}Hand`;
    hand.userData.proceduralHand = arm.group.name === 'leftArm' ? 'left' : 'right';
    hand.castShadow = true;
    hand.receiveShadow = true;
    hand.position.y = -arm.length - 0.03;
    arm.group.add(hand);
  }

  torso.restRotation = 0;
  leftLeg.restRotation = 0.18;
  rightLeg.restRotation = 0.18;
  leftCalf.restRotation = 0.1;
  rightCalf.restRotation = 0.1;
  leftArm.restRotation = -0.18;
  rightArm.restRotation = -0.18;

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
    rightCalf,
    leftArm,
    rightArm
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

  return { root, parts };
}


const TORSO_MAX_TWIST = Math.PI / 2;
const TARGET_RETURN_SPEED = 1.35;
const TARGET_FOLLOW_SPEED = 15;

const GANG_BEASTS_STEP_SWITCH_SECONDS = 0.28;
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
  messyAnchor.x += Math.sin(flopTime * 7.3 + (foot.seed || 0)) * 0.035 * (moving ? 1 : 0.25);
  messyAnchor.y *= 1 + Math.sin(flopTime * 4.7 + (foot.seed || 0)) * 0.18;
  if (shouldPlant) {
    if (!foot.planted) {
      foot.anchor.copy(messyAnchor);
      foot.age = 0;
    } else {
      foot.anchor.lerp(messyAnchor, 1 - Math.exp((foot.stuckTimer > 0 ? -0.45 : -1.7) * dt));
    }
    foot.planted = true;
    foot.swing = dampToward(foot.swing || 0, 0, 12, dt);
    return;
  }

  foot.planted = false;
  foot.anchor.lerp(messyAnchor, 1 - Math.exp(-8.5 * dt));
  foot.swing = dampToward(foot.swing || 0, 1, 10, dt);
}

function anchorToLegPose(anchor, sideLean, swingLift = 0) {
  const foreAft = THREE.MathUtils.clamp(anchor.y, -0.42, 0.42);
  const side = THREE.MathUtils.clamp(anchor.x, -0.42, 0.42);
  return {
    upper: THREE.MathUtils.clamp(0.14 - foreAft * 1.85 + swingLift * 0.16, -1.25, 1.18),
    calf: THREE.MathUtils.clamp(-0.22 + Math.abs(foreAft) * 0.78 + swingLift * 0.52, -0.85, 0.86),
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
  const sideLean = THREE.MathUtils.clamp(moveX * 0.18 - supportError.x * 0.34 + Math.sin(rig.flopTime * 2.1) * 0.04, -0.42, 0.42);
  const forwardLean = moving
    ? THREE.MathUtils.clamp(-0.16 - moveZ * 0.34 - supportError.y * 0.26 + headLag * 0.18, -0.62, 0.28)
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
    setTarget('leftArm', -1.15, 0.15, 0.8);
    setTarget('rightArm', -1.15, -0.15, -0.8);
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

    const armCounter = (footPlants.left.swing || 0) - (footPlants.right.swing || 0);
    setTarget('leftArm', 0.44 + armCounter * 0.32 - fallPressure * 0.08, 0, 0.22 + sideLean * 0.35);
    setTarget('rightArm', 0.44 - armCounter * 0.32 - fallPressure * 0.08, 0, -0.22 + sideLean * 0.35);

    if (leftPunch) {
      setTarget('leftArm', 0.48 - punchArc * 1.72 + punchWindup * 0.22, 0.2 * punchArc, 0.2 + punchArc * 0.38);
      setTarget('torso', forwardLean - punchArc * 0.14, 0.2 * punchArc, sideLean + 0.1 * punchArc);
    }
    if (rightPunch) {
      setTarget('rightArm', 0.48 - punchArc * 1.72 + punchWindup * 0.22, -0.2 * punchArc, -0.2 - punchArc * 0.38);
      setTarget('torso', forwardLean - punchArc * 0.14, -0.2 * punchArc, sideLean - 0.1 * punchArc);
    }
  }

  const motorStrength = knocked ? 0.18 : 0.22 + (rig.recoveryFactor || 1) * 0.34;
  const torsoMotorStrength = knocked ? 0.12 : 0.18 + (rig.recoveryFactor || 1) * 0.3;
  const specs = {
    hips: { min: -0.65, max: 0.65, sideMin: -0.55, sideMax: 0.55, twistMin: -0.7, twistMax: 0.7, stiffness: 3.1 * motorStrength, damping: 0.9 + motorStrength * 0.25, gravity: 7.5, lag: 3.2 },
    leftLeg: { min: -1.45, max: 1.25, sideMin: -0.8, sideMax: 0.8, twistMin: -0.55, twistMax: 0.55, stiffness: 5.6 * motorStrength, damping: 0.95 + motorStrength * 0.35, gravity: 24, lag: 4.7 },
    rightLeg: { min: -1.45, max: 1.25, sideMin: -0.8, sideMax: 0.8, twistMin: -0.55, twistMax: 0.55, stiffness: 5.6 * motorStrength, damping: 0.95 + motorStrength * 0.35, gravity: 24, lag: 4.3 },
    leftCalf: { min: -1.15, max: 1.25, sideMin: -0.45, sideMax: 0.45, twistMin: -0.35, twistMax: 0.35, stiffness: 6.4 * motorStrength, damping: 0.85 + motorStrength * 0.35, gravity: 26, parent: 'leftLeg', lag: 5.1 },
    rightCalf: { min: -1.15, max: 1.25, sideMin: -0.45, sideMax: 0.45, twistMin: -0.35, twistMax: 0.35, stiffness: 6.4 * motorStrength, damping: 0.85 + motorStrength * 0.35, gravity: 26, parent: 'rightLeg', lag: 4.8 },
    leftArm: { min: -1.65, max: 1.35, sideMin: -1.2, sideMax: 1.2, twistMin: -0.9, twistMax: 0.9, stiffness: 3.9 * motorStrength, damping: 0.75 + motorStrength * 0.25, gravity: 13, lag: 3.8 },
    rightArm: { min: -1.65, max: 1.35, sideMin: -1.2, sideMax: 1.2, twistMin: -0.9, twistMax: 0.9, stiffness: 3.9 * motorStrength, damping: 0.75 + motorStrength * 0.25, gravity: 13, lag: 3.8 },
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
    const parentAngle = spec.parent ? rig.parts[spec.parent]?.group.rotation.x || 0 : 0;
    const gravityPull = Math.sin(angle + parentAngle - (part.restRotation || 0)) * spec.gravity * 0.08;
    const spring = (THREE.MathUtils.clamp(target.x, spec.min, spec.max) - angle) * spec.stiffness;
    const noise = Math.sin(rig.flopTime * (name.length + 2.7)) * (knocked ? 0.35 : 0.14);
    physics.angularVelocity = (physics.angularVelocity || 0) + (spring - gravityPull + noise) * dt;
    physics.angularVelocity *= Math.exp(-spec.damping * dt);
    part.group.rotation.x = THREE.MathUtils.clamp(angle + physics.angularVelocity * dt, spec.min, spec.max);
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

  if (attacking) {
    const windup = Math.sin(attackPhase * Math.PI);
    setTarget('rightArm', -1.2 + windup * 0.8, 0, -0.2 + windup * 0.75);
    setTarget('leftArm', 0.45 - windup * 0.35, 0, -0.25);
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

  monsterGroup.userData.currentAction = attacking ? 'swordSlash' : movementAmount > 0.08 ? 'qwop' : 'idle';
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
  playerGroup.userData.qwopRig = {
    parts,
    bodyRoot,
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

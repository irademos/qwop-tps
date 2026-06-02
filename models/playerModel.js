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

function createProceduralBody(THREE) {
  const root = new THREE.Group();
  root.name = 'ProceduralQwopPlayerBody';

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
    length: 0.78,
    radius: 0.24,
    color: materials.shirt,
    mass: 12,
    shape: 'box'
  });
  torso.group.position.y = 0.05;
  torso.mesh.position.y = torso.length / 2;
  torso.mesh.scale.x = 1.35;
  hips.add(torso.group);

  const neck = new THREE.Group();
  neck.name = 'neck';
  neck.position.y = torso.length + 0.08;
  torso.group.add(neck);

  const headGeometry = new THREE.SphereGeometry(0.18, 20, 16);
  const headMaterial = new THREE.MeshStandardMaterial({ color: materials.skin, roughness: 0.8 });
  const head = new THREE.Mesh(headGeometry, headMaterial);
  head.name = 'head';
  head.castShadow = true;
  head.receiveShadow = true;
  head.position.y = 0.14;
  neck.add(head);

  const face = new THREE.Mesh(
    new THREE.SphereGeometry(0.025, 8, 8),
    new THREE.MeshBasicMaterial({ color: 0x111111 })
  );
  face.name = 'faceDirectionDot';
  face.position.set(0, 0.14, 0.165);
  neck.add(face);

  const leftLeg = createLimbSegment(THREE, 'leftLeg', {
    length: 0.82,
    radius: 0.095,
    color: materials.shorts,
    mass: 7
  });
  leftLeg.group.position.set(-0.14, 0, 0);
  hips.add(leftLeg.group);

  const rightLeg = createLimbSegment(THREE, 'rightLeg', {
    length: 0.82,
    radius: 0.095,
    color: materials.shorts,
    mass: 7
  });
  rightLeg.group.position.set(0.14, 0, 0);
  hips.add(rightLeg.group);

  for (const leg of [leftLeg, rightLeg]) {
    const shoe = new THREE.Mesh(
      new THREE.BoxGeometry(0.18, 0.08, 0.28),
      new THREE.MeshStandardMaterial({ color: materials.shoe, roughness: 0.7 })
    );
    shoe.name = `${leg.group.name}Shoe`;
    shoe.castShadow = true;
    shoe.receiveShadow = true;
    shoe.position.set(0, -leg.length - 0.02, 0.06);
    leg.group.add(shoe);
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
    hand.castShadow = true;
    hand.receiveShadow = true;
    hand.position.y = -arm.length - 0.03;
    arm.group.add(hand);
  }

  torso.restRotation = 0;
  leftLeg.restRotation = 0.18;
  rightLeg.restRotation = 0.18;
  leftArm.restRotation = -0.18;
  rightArm.restRotation = -0.18;

  const hipsPart = {
    group: hips,
    mesh: null,
    length: 0,
    mass: 10,
    restRotation: 0,
    restRotationY: 0,
    restRotationZ: 0,
    angularVelocity: 0
  };

  const parts = {
    hips: hipsPart,
    torso,
    leftLeg,
    rightLeg,
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
  });

  return { root, parts };
}


const QWOP_PART_SELECTORS = Object.freeze({
  q: 'leftArm',
  w: 'torso',
  e: 'rightArm',
  a: 'leftLeg',
  s: 'hips',
  d: 'rightLeg'
});
const QWOP_ARROW_INPUTS = Object.freeze({
  up: ['arrowup', 'ArrowUp'],
  down: ['arrowdown', 'ArrowDown'],
  left: ['arrowleft', 'ArrowLeft'],
  right: ['arrowright', 'ArrowRight']
});
const TORSO_MAX_TWIST = Math.PI / 2;
const TARGET_NUDGE_SPEED = 2.4;
const TARGET_RETURN_SPEED = 1.35;
const TARGET_FOLLOW_SPEED = 11;

function hasAnyKey(keysPressed, keys) {
  return keys.some((key) => keysPressed?.has?.(key));
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

function dampToward(current, target, speed, dt) {
  return THREE.MathUtils.lerp(current, target, 1 - Math.exp(-speed * dt));
}

export function updateProceduralPlayerRig(playerGroup, keysPressed, deltaSeconds) {
  const rig = playerGroup?.userData?.qwopRig;
  if (!rig) return { forwardIntent: 0, balance: 0 };

  const dt = THREE.MathUtils.clamp(Number.isFinite(deltaSeconds) ? deltaSeconds : 0, 0, 0.05);
  const pressed = (key) => keysPressed?.has?.(key);
  const selectedParts = Object.entries(QWOP_PART_SELECTORS)
    .filter(([key]) => pressed(key))
    .map(([, partName]) => partName);
  const selectedSet = new Set(selectedParts);
  const arrows = {
    up: hasAnyKey(keysPressed, QWOP_ARROW_INPUTS.up),
    down: hasAnyKey(keysPressed, QWOP_ARROW_INPUTS.down),
    left: hasAnyKey(keysPressed, QWOP_ARROW_INPUTS.left),
    right: hasAnyKey(keysPressed, QWOP_ARROW_INPUTS.right)
  };
  const hasArrowInput = arrows.up || arrows.down || arrows.left || arrows.right;

  const specs = {
    hips: { rest: 0, restY: 0, restZ: 0, min: -0.5, max: 0.5, sideMin: -0.45, sideMax: 0.45, gravity: 3.2, damping: 6.2, torque: 10 },
    leftLeg: { rest: 0.55, restY: 0, restZ: 0, min: -1.45, max: 1.35, sideMin: -0.65, sideMax: 0.65, gravity: 6.2, damping: 5.2, torque: 13 },
    rightLeg: { rest: 0.55, restY: 0, restZ: 0, min: -1.45, max: 1.35, sideMin: -0.65, sideMax: 0.65, gravity: 6.2, damping: 5.2, torque: 13 },
    leftArm: { rest: 0.9, restY: 0, restZ: 0, min: -1.45, max: 1.35, sideMin: -1.1, sideMax: 1.1, gravity: 5.4, damping: 4.8, torque: 12 },
    rightArm: { rest: 0.9, restY: 0, restZ: 0, min: -1.45, max: 1.35, sideMin: -1.1, sideMax: 1.1, gravity: 5.4, damping: 4.8, torque: 12 },
    torso: { rest: 0.05, restY: 0, restZ: 0, min: -0.95, max: 0.95, sideMin: -0.35, sideMax: 0.35, twistMin: -TORSO_MAX_TWIST, twistMax: TORSO_MAX_TWIST, gravity: 3.4, damping: 5.8, torque: 9 }
  };

  for (const name of selectedParts) {
    const part = rig.parts[name];
    const spec = specs[name];
    if (!part || !spec || !hasArrowInput) continue;

    const target = ensurePartControlTarget(part);
    const nudge = TARGET_NUDGE_SPEED * dt;
    if (arrows.up) target.x -= nudge;
    if (arrows.down) target.x += nudge;

    if (name === 'torso') {
      if (arrows.left) target.y += nudge;
      if (arrows.right) target.y -= nudge;
      target.y = THREE.MathUtils.clamp(target.y, spec.twistMin, spec.twistMax);
      target.z = dampToward(target.z, spec.restZ, TARGET_RETURN_SPEED, dt);
    } else {
      if (arrows.left) target.z += nudge;
      if (arrows.right) target.z -= nudge;
      target.y = dampToward(target.y, spec.restY, TARGET_RETURN_SPEED, dt);
      target.z = THREE.MathUtils.clamp(target.z, spec.sideMin, spec.sideMax);
    }

    target.x = THREE.MathUtils.clamp(target.x, spec.min, spec.max);
  }

  const stepPart = (name) => {
    const part = rig.parts[name];
    if (!part) return;
    const spec = specs[name];
    const physics = part.group.userData.physics;
    const target = ensurePartControlTarget(part);
    const isSelected = selectedSet.has(name);

    if (!isSelected) {
      target.x = dampToward(target.x, spec.rest, TARGET_RETURN_SPEED, dt);
      target.y = dampToward(target.y, spec.restY, TARGET_RETURN_SPEED, dt);
      target.z = dampToward(target.z, spec.restZ, TARGET_RETURN_SPEED, dt);
    }

    const angle = part.group.rotation.x;
    const weightFall = spec.gravity * physics.mass * 0.025 * Math.sin(angle - spec.rest);
    const holdTorque = isSelected ? (target.x - angle) * spec.torque : 0;
    const passiveTorque = !isSelected ? (spec.rest - angle) * spec.gravity * 0.35 : 0;
    physics.angularVelocity += (holdTorque + passiveTorque - weightFall) * dt;
    physics.angularVelocity *= Math.exp(-spec.damping * dt);
    part.group.rotation.x = THREE.MathUtils.clamp(angle + physics.angularVelocity * dt, spec.min, spec.max);

    const lateralFollowSpeed = isSelected ? TARGET_FOLLOW_SPEED : TARGET_RETURN_SPEED;
    part.group.rotation.y = dampToward(part.group.rotation.y, target.y, lateralFollowSpeed, dt);
    part.group.rotation.z = dampToward(part.group.rotation.z, target.z, lateralFollowSpeed, dt);
  };

  stepPart('hips');
  stepPart('leftLeg');
  stepPart('rightLeg');
  stepPart('leftArm');
  stepPart('rightArm');
  stepPart('torso');

  const leftLeg = rig.parts.leftLeg.group.rotation.x;
  const rightLeg = rig.parts.rightLeg.group.rotation.x;
  const torso = rig.parts.torso.group.rotation.x;
  const armCounterBalance = (rig.parts.rightArm.group.rotation.x - rig.parts.leftArm.group.rotation.x) * 0.08;
  const legStride = Math.abs(leftLeg - rightLeg);
  const anyLegDriving = selectedSet.has('leftLeg') || selectedSet.has('rightLeg');
  const forwardWeight = THREE.MathUtils.clamp(
    (-torso * 0.55)
      + Math.max(0, -leftLeg) * 0.2
      + Math.max(0, -rightLeg) * 0.2
      - Math.max(0, torso) * 0.65,
    -1,
    1
  );
  rig.balance = THREE.MathUtils.clamp((-torso * 0.9) + armCounterBalance, -1, 1);
  // Only active leg selection can produce forward drive. Resting limb pose should not
  // generate constant translation; otherwise the player drifts without physics input.
  rig.forwardIntent = anyLegDriving
    ? THREE.MathUtils.clamp(Math.max(0, -leftLeg, -rightLeg) * legStride * (0.35 + Math.max(0, -torso)), 0, 1)
    : 0;
  rig.forwardWeight = forwardWeight;
  rig.lastControls = {
    selectedParts,
    arrows,
    leftLeg: selectedSet.has('leftLeg'),
    rightLeg: selectedSet.has('rightLeg'),
    torso: selectedSet.has('torso'),
    leftArm: selectedSet.has('leftArm'),
    rightArm: selectedSet.has('rightArm'),
    hips: selectedSet.has('hips')
  };

  playerGroup.userData.currentAction = rig.forwardIntent > 0.08 ? 'qwop' : 'idle';
  return { forwardIntent: rig.forwardIntent, balance: rig.balance, forwardWeight };
}

export function createPlayerModel(
  THREE,
  username,
  onLoad,
  modelPath = '/models/cowboy.fbx'
) {
  const playerGroup = new THREE.Group();
  playerGroup.name = 'ProceduralQwopPlayer';

  const { root: bodyRoot, parts } = createProceduralBody(THREE);
  playerGroup.add(bodyRoot);
  playerGroup.userData.qwopRig = {
    parts,
    forwardIntent: 0,
    balance: 0,
    modelPath,
    description: 'Procedural weighted QWOP-style player body'
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

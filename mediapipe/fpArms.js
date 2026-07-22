// First-person arm meshes attached to the camera for hand-tracking mode.
// Each arm is a capsule (upper arm) + sphere (hand) rendered as a camera child
// so they always appear in front of the scene regardless of scene depth.

let _camera = null;
let _leftArm = null;
let _rightArm = null;
let _THREE = null;

const ARM_LENGTH = 0.42;
const ARM_RADIUS = 0.055;
const HAND_RADIUS = 0.065;
const SKIN_COLOR = 0xf1c27d;
const DEPTH = 0.6; // meters in front of camera

function makeFPArmGroup(THREE) {
  const mat = new THREE.MeshStandardMaterial({
    color: SKIN_COLOR,
    roughness: 0.75,
    depthTest: false,
  });

  const group = new THREE.Group();
  group.renderOrder = 999;

  const capGeo = new THREE.CapsuleGeometry(ARM_RADIUS, ARM_LENGTH - ARM_RADIUS * 2, 6, 12);
  const capMesh = new THREE.Mesh(capGeo, mat);
  capMesh.renderOrder = 999;
  capMesh.position.y = ARM_LENGTH / 2;
  group.add(capMesh);

  const handGeo = new THREE.SphereGeometry(HAND_RADIUS, 12, 10);
  const handMesh = new THREE.Mesh(handGeo, mat);
  handMesh.renderOrder = 999;
  handMesh.position.y = ARM_LENGTH;
  group.add(handMesh);

  group.visible = false;
  return group;
}

export function initFPArms(camera, THREE) {
  _camera = camera;
  _THREE = THREE;

  _leftArm = makeFPArmGroup(THREE);
  _leftArm.name = 'fpLeftArm';
  camera.add(_leftArm);

  _rightArm = makeFPArmGroup(THREE);
  _rightArm.name = 'fpRightArm';
  camera.add(_rightArm);
}

function updateArm(armGroup, shoulderPos, palmData, THREE) {
  if (!palmData) {
    armGroup.visible = false;
    return;
  }

  const mx = 1 - palmData.palmX; // mirror to match display
  const nx = (mx - 0.5) * 2;
  const ny = (0.5 - palmData.palmY) * 2; // +1 top, -1 bottom

  // Hand target position in camera local space
  const handPos = new THREE.Vector3(nx * DEPTH * 0.65, ny * DEPTH * 0.45, -DEPTH);

  // Arm origin at shoulder (fixed, off the bottom edge)
  armGroup.position.copy(shoulderPos);

  // Direction from shoulder to hand
  const dir = handPos.clone().sub(shoulderPos);
  const dist = dir.length();
  if (dist < 0.01) {
    armGroup.visible = false;
    return;
  }
  dir.normalize();

  // Orient arm group so Y+ points toward hand
  const up = new THREE.Vector3(0, 1, 0);
  armGroup.quaternion.setFromUnitVectors(up, dir);

  // Scale arm length so it reaches the hand
  const scale = Math.min(dist / ARM_LENGTH, 2.0);
  armGroup.scale.setScalar(scale);

  armGroup.visible = true;
}

export function updateFPArms(handData) {
  if (!_leftArm || !_rightArm || !_THREE) return;
  const THREE = _THREE;

  const hw = DEPTH * 0.45; // rough half-width at DEPTH
  const hy = DEPTH * 0.35; // rough half-height at DEPTH

  const leftShoulder = new THREE.Vector3(-hw * 0.8, -hy * 1.1, -DEPTH);
  const rightShoulder = new THREE.Vector3(hw * 0.8, -hy * 1.1, -DEPTH);

  updateArm(_leftArm, leftShoulder, handData?.left, THREE);
  updateArm(_rightArm, rightShoulder, handData?.right, THREE);
}

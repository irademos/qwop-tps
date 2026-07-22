// Repurposes the procedural player's hand sphere meshes as floating world-space
// hands driven by MediaPipe. The arm capsule meshes are hidden and replaced by
// elastic cylinder arms that stretch from each shoulder to the floating hand.

const FORWARD_REACH = 0.65;
const H_SPREAD      = 1.0;
const Y_HIGH        = 1.55;  // hand height (relative to playerPos.y) when hand is at top of frame
const Y_LOW         = 0.55;  // hand height when hand is at bottom of frame

let _scene  = null;
let _THREE  = null;
let _meshes = null;   // { leftHand, rightHand, leftArm, rightArm }
let _rigReady = false;

export function initFloatingHands(scene, THREE) {
  _scene = scene;
  _THREE = THREE;

  // Elastic arm cylinders — unit length along Y, centred at origin.
  const armGeo = new THREE.CylinderGeometry(0.05, 0.065, 1, 8);
  const mat    = () => new THREE.MeshStandardMaterial({ color: 0xf1c27d, roughness: 0.75 });

  const leftArm  = new THREE.Mesh(armGeo,        mat()); leftArm.name  = 'elasticLeftArm';
  const rightArm = new THREE.Mesh(armGeo.clone(), mat()); rightArm.name = 'elasticRightArm';
  for (const m of [leftArm, rightArm]) { m.visible = false; m.castShadow = true; scene.add(m); }

  // Hand sphere slots — filled lazily from the rig.
  _meshes = { leftHand: null, rightHand: null, leftArm, rightArm };
  _rigReady = false;
}

// Called once on first frame where the rig is available.
// Detaches the procedural hand spheres from their arm groups,
// adds them to the scene, and hides the arm capsule meshes.
function adoptRigHands(rig) {
  if (_rigReady || !rig?.parts || !_scene) return;
  _rigReady = true;

  for (const side of ['left', 'right']) {
    const partName = side === 'left' ? 'leftArm' : 'rightArm';
    const armPart  = rig.parts[partName];
    if (!armPart?.group) continue;

    // Hide the capsule arm mesh.
    if (armPart.mesh) armPart.mesh.visible = false;

    // Find the hand sphere and reparent it to the scene.
    let handMesh = null;
    armPart.group.traverse(child => {
      if (child.userData?.proceduralHand === side) handMesh = child;
    });
    if (handMesh) {
      _scene.attach(handMesh);  // preserves world position during reparent
      handMesh.visible = false;
      _meshes[side === 'left' ? 'leftHand' : 'rightHand'] = handMesh;
    }
  }
}

// Map normalised MediaPipe palm coords + player transform → world position.
export function palmToWorldPos(palmX, palmY, playerPos, yaw) {
  const mx     = 1 - palmX;                      // mirror: display-left = player-left
  const right  = (mx - 0.5) * H_SPREAD;          // positive = player's right
  const height = Y_HIGH - palmY * (Y_HIGH - Y_LOW);

  // forward = (sin yaw, 0, cos yaw),  right-axis = (cos yaw, 0, -sin yaw)
  return new _THREE.Vector3(
    playerPos.x + right * Math.cos(yaw) + FORWARD_REACH * Math.sin(yaw),
    playerPos.y + height,
    playerPos.z - right * Math.sin(yaw) + FORWARD_REACH * Math.cos(yaw)
  );
}

function stretchArm(armMesh, from, to) {
  const dir = new _THREE.Vector3().subVectors(to, from);
  const len = dir.length();
  if (len < 0.02) { armMesh.visible = false; return; }
  armMesh.position.lerpVectors(from, to, 0.5);
  armMesh.scale.set(1, len, 1);
  armMesh.quaternion.setFromUnitVectors(new _THREE.Vector3(0, 1, 0), dir.normalize());
  armMesh.visible = true;
}

// Call every frame. Returns { left: Vector3|null, right: Vector3|null } for IK.
export function updateFloatingHands(handData, playerPos, yaw, rig) {
  if (!_meshes) return { left: null, right: null };

  adoptRigHands(rig);

  const result = { left: null, right: null };

  for (const side of ['left', 'right']) {
    const handMesh = _meshes[side === 'left' ? 'leftHand' : 'rightHand'];
    const armMesh  = _meshes[side === 'left' ? 'leftArm'  : 'rightArm'];
    const pd = handData?.[side];

    if (!pd) {
      if (handMesh) handMesh.visible = false;
      if (armMesh)  armMesh.visible  = false;
      continue;
    }

    const worldPos = palmToWorldPos(pd.palmX, pd.palmY, playerPos, yaw);
    result[side] = worldPos;

    if (handMesh) {
      handMesh.position.copy(worldPos);
      handMesh.visible = true;
    }

    const armPartName = side === 'left' ? 'leftArm' : 'rightArm';
    const shoulder    = new _THREE.Vector3();
    rig?.parts?.[armPartName]?.group?.getWorldPosition(shoulder);
    if (shoulder.lengthSq() > 0 && armMesh) stretchArm(armMesh, shoulder, worldPos);
    else if (armMesh) armMesh.visible = false;
  }

  return result;
}

export function hideFloatingHands() {
  if (!_meshes) return;
  for (const m of Object.values(_meshes)) if (m) m.visible = false;
}

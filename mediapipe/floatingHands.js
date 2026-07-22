// World-space floating hand spheres + elastic arm cylinders.
// Hand position is derived directly from the MediaPipe palm screen coords
// mapped into the player's forward half-space, so left/right/up/down in the
// camera feed correspond exactly to the same directions in the game world.

const SKIN_COLOR = 0xf1c27d;
const FORWARD_REACH = 0.65;  // metres in front of player
const H_SPREAD     = 1.0;    // max left–right spread (metres)
const Y_HIGH       = 1.55;   // hand height at top of frame (near head)
const Y_LOW        = 0.55;   // hand height at bottom of frame (near waist)

let _scene  = null;
let _THREE  = null;
let _meshes = null; // { leftHand, rightHand, leftArm, rightArm }

function buildMeshes(THREE) {
  const mat = () => new THREE.MeshStandardMaterial({ color: SKIN_COLOR, roughness: 0.75 });

  const handGeo = new THREE.SphereGeometry(0.08, 12, 10);
  // Unit cylinder along Y, length=1, centred at origin.
  const armGeo  = new THREE.CylinderGeometry(0.05, 0.065, 1, 8);

  const leftHand  = new THREE.Mesh(handGeo,        mat()); leftHand.name  = 'floatLeftHand';
  const rightHand = new THREE.Mesh(handGeo.clone(), mat()); rightHand.name = 'floatRightHand';
  const leftArm   = new THREE.Mesh(armGeo,          mat()); leftArm.name   = 'floatLeftArm';
  const rightArm  = new THREE.Mesh(armGeo.clone(),  mat()); rightArm.name  = 'floatRightArm';

  for (const m of [leftHand, rightHand, leftArm, rightArm]) {
    m.visible = false;
    m.castShadow = true;
  }

  return { leftHand, rightHand, leftArm, rightArm };
}

export function initFloatingHands(scene, THREE) {
  _scene  = scene;
  _THREE  = THREE;
  _meshes = buildMeshes(THREE);
  for (const m of Object.values(_meshes)) scene.add(m);
}

// Convert normalised MediaPipe palm coords + player transform → world position.
// palmX, palmY: 0–1 from the raw (un-mirrored) camera frame.
// yaw: player facing angle (matches controls.js convention: forward = (sin,0,cos)).
export function palmToWorldPos(palmX, palmY, playerPos, yaw) {
  const mx = 1 - palmX;                       // mirror so display-left = game-left
  const right   = (mx - 0.5) * H_SPREAD;     // positive = player's right
  const heightY = Y_HIGH - palmY * (Y_HIGH - Y_LOW);

  // right-axis = (cos yaw, 0, -sin yaw), forward-axis = (sin yaw, 0, cos yaw)
  return new _THREE.Vector3(
    playerPos.x + right * Math.cos(yaw) + FORWARD_REACH * Math.sin(yaw),
    playerPos.y + heightY,
    playerPos.z - right * Math.sin(yaw) + FORWARD_REACH * Math.cos(yaw)
  );
}

function stretchArm(armMesh, fromPos, toPos) {
  const dir = new _THREE.Vector3().subVectors(toPos, fromPos);
  const len = dir.length();
  if (len < 0.02) { armMesh.visible = false; return; }

  armMesh.position.lerpVectors(fromPos, toPos, 0.5);
  armMesh.scale.set(1, len, 1);
  armMesh.quaternion.setFromUnitVectors(new _THREE.Vector3(0, 1, 0), dir.normalize());
  armMesh.visible = true;
}

// Call every frame.
// Returns { left: Vector3|null, right: Vector3|null } world positions for IK.
export function updateFloatingHands(handData, playerPos, yaw, rig) {
  if (!_meshes) return { left: null, right: null };

  const result = { left: null, right: null };

  function update(side, handMesh, armMesh) {
    const pd = handData?.[side];
    if (!pd) {
      handMesh.visible = false;
      armMesh.visible  = false;
      return;
    }

    const worldPos = palmToWorldPos(pd.palmX, pd.palmY, playerPos, yaw);
    handMesh.position.copy(worldPos);
    handMesh.visible = true;
    result[side] = worldPos;

    const armPartName = side === 'left' ? 'leftArm' : 'rightArm';
    const armPart = rig?.parts?.[armPartName];
    if (armPart?.group) {
      const shoulder = new _THREE.Vector3();
      armPart.group.getWorldPosition(shoulder);
      stretchArm(armMesh, shoulder, worldPos);
    } else {
      armMesh.visible = false;
    }
  }

  update('left',  _meshes.leftHand,  _meshes.leftArm);
  update('right', _meshes.rightHand, _meshes.rightArm);

  return result;
}

export function hideFloatingHands() {
  if (!_meshes) return;
  for (const m of Object.values(_meshes)) m.visible = false;
}

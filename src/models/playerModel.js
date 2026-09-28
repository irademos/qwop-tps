import * as THREE from 'three';
import { createGLBCharacterInstance } from './glbCharacterModel.js';

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

  // Move the floating hand targets to the held weapon's grip
  if (rig.floatingHands) {
    // FoamSword.update() (and shield/pistol)
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
        const floatingHand = rig.floatingHands[side];
        let targetPos = _defaultHandPos.set(side === 'left' ? -0.5 : 0.5, 0.82, 0.25);
        const depthOverride = playerGroup.userData.handDepthOverride?.[side];
        if (depthOverride !== undefined) {
          targetPos = targetPos.clone();
          targetPos.z = typeof depthOverride === 'function' ? depthOverride(0.5) : depthOverride;
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
  // Duel opponent: both hands grip the sword where the other player's game says it is
  const handTarget = playerGroup.userData.remoteHandTarget;
  if (handTarget && rig.floatingHands) {
    for (const side of ['left', 'right']) {
      const yOff = side === 'right' ? -0.08 : 0;
      _fsHandTarget.set(handTarget.x, handTarget.y + yOff, handTarget.z);
      rig.floatingHands[side].position.lerp(_fsHandTarget, 1 - Math.exp(-18 * dt));
    }
  }
  updateGLBCharacter(rig, dt, speed > 0.4);
}

export function createPlayerModel(
  THREE,
  username,
  onLoad
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

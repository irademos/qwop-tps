import * as THREE from 'three';
import { createGLBCharacterInstance, glbCharacterConfig, characterHold } from './glbCharacterModel.js';

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
const _gyroArmDir = new THREE.Vector3();

// Unarmed gyro arm (game 'left' hand = the anatomical right arm): the hand follows the
// direction the phone points like the sword grip does, one-handed, beside the body
const GYRO_ARM_MAX_AGE_MS = 500; // gyro older than this → both arms back on the clip
const GYRO_ARM_X = -0.2;
const GYRO_ARM_SPREAD = 0.3;
const GYRO_ARM_Y = 0.6;
const GYRO_ARM_HEIGHT_GAIN = 0.35;
const GYRO_ARM_Z = 0.22;
const GYRO_ARM_DEPTH_GAIN = 0.18;

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

// Town lantern (userData.lanternHeld, bootstrapGameApp.js): the game 'right' hand (the
// anatomical left arm) carries it low at the side; whatever else is held is one-handed
const LANTERN_HAND = Object.freeze({ x: 0.3, y: 0.52, z: 0.18 });

const CLIMB_HAND_CYCLES_PER_M = 1.2; // hand-over-hand cycles per m of wall climbed

export function updateProceduralPlayerRig(playerGroup, keysPressed, deltaSeconds, options = {}) {
  const rig = playerGroup?.userData?.qwopRig;
  if (!rig) return { forwardIntent: 0, balance: 0 };

  const dt = THREE.MathUtils.clamp(Number.isFinite(deltaSeconds) ? deltaSeconds : 0, 0, 0.05);

  // Move the floating hand targets to the held weapon's grip
  if (rig.floatingHands) {
    // FoamSword.update() (and shield/pistol)
    // sets foamSwordMode=true and writes foamSwordHandTarget with the desired grip position.
    // Per-character hold (e.g. the small village boy grips lower and closer in)
    const grip = characterHold(rig.characterUrl).grip;
    // Unarmed with the phone gyro live: it moves only the anatomical right arm ('left'),
    // the clip animates the other one (both while there's no gyro)
    const gyroQ = playerGroup.userData.gyroArmQuat;
    const gyroLive = !!gyroQ && performance.now() - (playerGroup.userData.gyroArmTime || 0) < GYRO_ARM_MAX_AGE_MS;
    const armed = !!playerGroup.userData.foamSwordMode;
    const lantern = !!playerGroup.userData.lanternHeld;
    rig.glbCharacter?.setArmIKHands(armed || options.climbing
      ? { left: true, right: true }
      : { left: gyroLive, right: lantern });
    if (lantern) {
      _fsHandTarget.set(LANTERN_HAND.x, LANTERN_HAND.y, LANTERN_HAND.z).multiplyScalar(grip);
      rig.floatingHands.right.position.lerp(_fsHandTarget, 1 - Math.exp(-18 * dt));
    }
    if (armed) {
      playerGroup.userData.foamSwordMode = false; // consume the flag
      const fst = playerGroup.userData.foamSwordHandTarget;
      if (fst) {
        for (const side of lantern ? ['left'] : ['left', 'right']) {
          // Right tracking slot (support hand) sits slightly lower on the handle
          const yOff = side === 'right' ? -0.08 : 0;
          _fsHandTarget.set(fst.x, fst.y + yOff, fst.z).multiplyScalar(grip);
          rig.floatingHands[side].position.lerp(_fsHandTarget, 1 - Math.exp(-18 * dt));
        }
      }
    } else if (gyroLive) {
      _gyroArmDir.set(0, 0, 1).applyQuaternion(gyroQ);
      _fsHandTarget.set(
        GYRO_ARM_X + _gyroArmDir.x * GYRO_ARM_SPREAD,
        GYRO_ARM_Y + _gyroArmDir.y * GYRO_ARM_HEIGHT_GAIN,
        Math.max(0.08, GYRO_ARM_Z + _gyroArmDir.z * GYRO_ARM_DEPTH_GAIN),
      ).multiplyScalar(grip);
      rig.floatingHands.left.position.lerp(_fsHandTarget, 1 - Math.exp(-18 * dt));
    } else {
      for (const side of lantern ? ['left'] : ['left', 'right']) {
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

  // Wall climbing (PlayerControls._updateClimb): hand over hand up the wall in front,
  // overriding the weapon grip while it lasts
  if (options.climbing && rig.floatingHands) {
    const phase = (options.climbPhase || 0) * CLIMB_HAND_CYCLES_PER_M * Math.PI * 2;
    for (const side of ['left', 'right']) {
      const reach = side === 'left' ? Math.sin(phase) : -Math.sin(phase);
      _fsHandTarget.set(side === 'left' ? -0.25 : 0.25, 1.75 + reach * 0.2, 0.35);
      rig.floatingHands[side].position.lerp(_fsHandTarget, 1 - Math.exp(-12 * dt));
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
  // Duel opponent: both hands grip the sword where the other player's game says it is.
  // Empty-handed (Town: `remoteArmed` false — no sword in their hand) the clip moves the arms.
  const armed = playerGroup.userData.remoteArmed !== false;
  rig.glbCharacter?.setArmIKHands(armed ? { left: true, right: true } : { left: false, right: false });
  const handTarget = armed ? playerGroup.userData.remoteHandTarget : null;
  if (handTarget && rig.floatingHands) {
    for (const side of ['left', 'right']) {
      const yOff = side === 'right' ? -0.08 : 0;
      _fsHandTarget.set(handTarget.x, handTarget.y + yOff, handTarget.z).multiplyScalar(characterHold(rig.characterUrl).grip);
      rig.floatingHands[side].position.lerp(_fsHandTarget, 1 - Math.exp(-18 * dt));
    }
  }
  updateGLBCharacter(rig, dt, speed > 0.4);
}

// Another player's dodge roll (their duel / battle `state` says `ro` while it lasts): the
// roll clip plays once when it starts; their own yaw already faces the roll
export function setRemoteRolling(playerGroup, rolling) {
  const ud = playerGroup?.userData;
  if (!ud) return;
  rolling = !!rolling;
  if (rolling && !ud.remoteRolling) ud.qwopRig?.glbCharacter?.playAction(glbCharacterConfig.rollClip);
  ud.remoteRolling = rolling;
}

// Swap the GLB character a player group wears (Multiplayer team / free-for-all picks).
// The newest request wins if several loads are in flight.
export function setPlayerCharacterUrl(playerGroup, url) {
  const rig = playerGroup?.userData?.qwopRig;
  if (!rig || !url || rig.characterUrl === url) return;
  rig.characterUrl = url;
  const token = (rig.characterLoadToken || 0) + 1;
  rig.characterLoadToken = token;
  createGLBCharacterInstance({ targetHeight: 1.0, url }).then(({ container, character }) => {
    if (rig.characterLoadToken !== token) { character.dispose(); return; }
    const old = rig.glbCharacter;
    const oldContainer = rig.characterContainer;
    if (oldContainer?.parent) oldContainer.parent.remove(oldContainer);
    old?.dispose();
    rig.bodyRoot.add(container);
    rig.characterContainer = container;
    rig.glbCharacter = character;
    if (old?.isDead) character.playDeath();
  }).catch(e => console.warn('[PlayerModel] GLB character swap failed:', e));
}

export function createPlayerModel(
  THREE,
  username,
  onLoad,
  { characterUrl = glbCharacterConfig.villageBoyUrl } = {}
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
    characterContainer: null,
    characterUrl,
    characterLoadToken: 0,
  };
  playerGroup.userData.currentAction = 'idle';
  playerGroup.userData.actions = {};
  playerGroup.userData.mixer = null;

  // Hide the capsule and load the GLB character in its place
  const capsuleMesh = bodyRoot.getObjectByName('bodyCapsulemesh');
  if (capsuleMesh) capsuleMesh.visible = false;

  createGLBCharacterInstance({ targetHeight: 1.0, url: characterUrl }).then(({ container, character }) => {
    const rig = playerGroup.userData.qwopRig;
    // Superseded by setPlayerCharacterUrl() while loading
    if (rig.characterLoadToken !== 0) { character.dispose(); return; }
    bodyRoot.add(container);
    rig.characterContainer = container;
    rig.glbCharacter = character;
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

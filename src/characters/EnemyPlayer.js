/**
 * EnemyPlayer — a horde-mode opponent that looks like the player
 * (capsule body, GLB hands, elastic arms) and always wields a foam sword.
 *
 * AI: chases the player; enters attack mode when close; swings right hand
 * sinusoidally so the sword tip sweeps through the player's hit sphere.
 *
 * Physics: dynamic Rapier capsule.  Sword hit detection is frame-by-frame
 * distance/sweep rather than a dedicated Rapier body (same approach the
 * rest of the game uses for melee weapons).
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { getKnockbackImpulse, getKnockbackMotion, RAGDOLL_STRENGTH_THRESHOLD } from '../combat/knockback.js';

// ─── constants ───────────────────────────────────────────────────────────────

const CAPSULE_RADIUS   = 0.28;
const CAPSULE_HEIGHT   = 1.0;
const SHOULDER_Y_FRAC  = 0.82;
const HAND_MODEL_SCALE = 0.7;

const CHASE_SPEED   = 3.2;   // m/s while chasing
const ATTACK_RANGE  = 2.8;   // switch to attack mode when this close
const CHASE_RANGE   = 0.9;   // stop moving closer when this close (during attack)
const BACKOFF_SPEED = 1.6;   // m/s retreat speed when yielding attack slot
const BACKOFF_DIST  = 3.8;   // target distance while backing off

// Sword tip distance threshold for registering a hit
const SWORD_TIP_HIT_RADIUS  = 0.55;
// Extra sphere at pommel (guard) for block detection
const SWORD_GUARD_HIT_RADIUS = 0.38;

const SWORD_DAMAGE          = 2;  // health segments per hit
const HIT_COOLDOWN_MS       = 1200;

// Sword tip offset in the sword group's local space (+Z points toward tip)
const SWORD_TIP_LOCAL = new THREE.Vector3(0, 0, 0.69);
const SWORD_GUARD_LOCAL = new THREE.Vector3(0, 0, 0);

// Swing parameters when in attack mode
const SWING_FREQ       = 2.8;  // radians/second oscillation frequency
const SWING_AMP_X      = 1.4;  // arm pitch amplitude (rad)
const SWING_AMP_Z      = 0.8;  // arm roll amplitude (rad)
const SWING_OFFSET_Y   = 0.9;  // hand height in body-local space during swing
const SWING_OFFSET_Z   = 0.55; // hand forward offset during swing

// Rapier capsule dimensions (must match body visual)
const PHYS_HALF_HEIGHT = 0.6;
const PHYS_RADIUS      = 0.3;

// Sword blade goes in +Z; default rest orientation (Euler, YXZ)
const DEG = Math.PI / 180;
const REST_SWORD_EULER = new THREE.Euler(360 * DEG, 90 * DEG, -90 * DEG, 'YXZ');

// ─── shared GLB cache (re-use the same GLTF across all EnemyPlayer instances) ─
let _glbHandPromise = null;
const _glbLoader = new GLTFLoader();
function getGLBHandGLTF() {
  if (!_glbHandPromise) {
    _glbHandPromise = new Promise((resolve, reject) =>
      _glbLoader.load('/models/hands/right_hand.glb', resolve, undefined, reject)
    );
  }
  return _glbHandPromise;
}

// ─── scratch objects (not per-instance, module-level) ────────────────────────
const _upAxis  = new THREE.Vector3(0, 1, 0);
const _sWorld  = new THREE.Vector3();
const _hWorld  = new THREE.Vector3();
const _rootQ   = new THREE.Quaternion();
const _armQ    = new THREE.Quaternion();
const _tipWorld = new THREE.Vector3();
const _toTarget = new THREE.Vector3();
const _tmpV    = new THREE.Vector3();
const _tmpQ    = new THREE.Quaternion();
const _swordTipWorld  = new THREE.Vector3();
const _swordGuardWorld = new THREE.Vector3();
const _fwdAxis = new THREE.Vector3(0, 0, 1);
const _handVelDir = new THREE.Vector3();

// ─── EnemyPlayer ─────────────────────────────────────────────────────────────

export class EnemyPlayer {
  /**
   * @param {THREE.Scene}  scene
   * @param {object}       rapier   – the RAPIER module
   * @param {object}       rapierWorld – the live Rapier World
   * @param {object}       [options]
   * @param {THREE.Vector3} [options.position]
   */
  constructor(scene, rapier, rapierWorld, options = {}) {
    this.scene       = scene;
    this.rapier      = rapier;
    this.rapierWorld = rapierWorld;

    this.health    = 10;
    this.maxHealth = 10;
    this.isDead    = false;

    this._swingT       = 0;        // oscillation time accumulator
    this._lastHitTime  = 0;        // timestamp of last sword hit on player
    this._aiState      = 'chase';  // 'chase' | 'attack'
    this._prevRightHandWorldPos = new THREE.Vector3();

    this._isRagdoll    = false;
    this._ragdollTimeout = null;

    // Sword quaternion (updated each frame)
    this._swordQuaternion = new THREE.Quaternion().setFromEuler(REST_SWORD_EULER);

    // ── Three.js hierarchy ──────────────────────────────────────────────────
    this.group = new THREE.Group();
    this.group.name = 'EnemyPlayer';

    const startPos = options.position ?? new THREE.Vector3(5, 0, 5);
    this.group.position.copy(startPos);

    this._buildBody();
    this._buildSword();
    this._buildHealthBar();
    this._buildPhysics(startPos);

    // async hand GLB load
    this._loadHands().catch(e =>
      console.warn('[EnemyPlayer] hand GLB load error:', e)
    );

    scene.add(this.group);
  }

  // ─── body / arms ───────────────────────────────────────────────────────────

  _buildBody() {
    // Capsule — red/orange to distinguish from blue player
    const capsuleMat = new THREE.MeshStandardMaterial({ color: 0xcc3300, roughness: 0.75, metalness: 0.05 });
    const capsuleGeo = new THREE.CapsuleGeometry(CAPSULE_RADIUS, CAPSULE_HEIGHT - CAPSULE_RADIUS * 2, 8, 16);
    const capsuleMesh = new THREE.Mesh(capsuleGeo, capsuleMat);
    capsuleMesh.name = 'enemyBodyCapsule';
    capsuleMesh.castShadow = true;
    capsuleMesh.receiveShadow = true;
    capsuleMesh.position.y = CAPSULE_HEIGHT / 2;
    this.group.add(capsuleMesh);
    this._capsuleMesh = capsuleMesh;

    // Shoulder anchors
    const shoulderY = CAPSULE_HEIGHT * SHOULDER_Y_FRAC;
    this._leftShoulder  = new THREE.Group();
    this._leftShoulder.name  = 'enemyLeftShoulder';
    this._leftShoulder.position.set(-(CAPSULE_RADIUS + 0.08), shoulderY, 0);
    this.group.add(this._leftShoulder);

    this._rightShoulder = new THREE.Group();
    this._rightShoulder.name = 'enemyRightShoulder';
    this._rightShoulder.position.set( (CAPSULE_RADIUS + 0.08), shoulderY, 0);
    this.group.add(this._rightShoulder);

    // Elastic arm cylinders
    const armMat = new THREE.MeshStandardMaterial({ color: 0xf1c27d, roughness: 0.8, transparent: true, opacity: 0.70 });
    this._leftArm  = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 1, 8), armMat);
    this._leftArm.name  = 'enemyLeftArm';
    this._leftArm.castShadow = true;
    this.group.add(this._leftArm);

    this._rightArm = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 1, 8), armMat.clone());
    this._rightArm.name = 'enemyRightArm';
    this._rightArm.castShadow = true;
    this.group.add(this._rightArm);

    // Floating hand groups — these are what move around each frame
    this._leftHandGroup  = new THREE.Group();
    this._leftHandGroup.name  = 'enemyLeftFloatingHand';
    this._leftHandGroup.userData.glbReady = false;
    this._leftHandGroup.position.set(-0.5, 0.82, 0.25);
    this.group.add(this._leftHandGroup);

    this._rightHandGroup = new THREE.Group();
    this._rightHandGroup.name = 'enemyRightFloatingHand';
    this._rightHandGroup.userData.glbReady = false;
    this._rightHandGroup.position.set( 0.5, 0.82, 0.25);
    this.group.add(this._rightHandGroup);
  }

  async _loadHands() {
    let gltf;
    try { gltf = await getGLBHandGLTF(); } catch (e) {
      console.warn('[EnemyPlayer] GLB load failed:', e);
      return;
    }

    // ── Right hand ──────────────────────────────────────────────────────────
    const rightScene = SkeletonUtils.clone(gltf.scene);
    rightScene.scale.setScalar(HAND_MODEL_SCALE);
    rightScene.position.set(0, 0, 0);
    rightScene.rotation.set(-Math.PI / 2, Math.PI, 0);
    rightScene.children.forEach(c => {
      if (!c.isMesh) { c.position.set(0, 0, 0); c.rotation.set(0, 0, 0); }
    });

    const rightPivot = new THREE.Group();
    rightPivot.name = 'enemyRightHandPivot';
    rightPivot.add(rightScene);
    this._rightHandGroup.add(rightPivot);
    rightScene.updateWorldMatrix(true, true);

    const rightWristBone = rightScene.getObjectByName('Bone_Armature');
    if (rightWristBone) {
      const bp = new THREE.Vector3();
      rightWristBone.getWorldPosition(bp);
      rightPivot.worldToLocal(bp);
      rightScene.position.sub(bp);
      rightScene.updateWorldMatrix(true, true);
    }

    rightScene.traverse(obj => {
      if (!obj.isMesh) return;
      obj.castShadow = true;
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      mats.forEach(m => { if (m) { m.color.setHex(0xf1c27d); m.roughness = 0.8; m.transparent = true; m.opacity = 0.70; } });
    });
    this._rightHandGroup.userData.glbReady = true;

    // ── Left hand (mirror) ──────────────────────────────────────────────────
    const leftScene = SkeletonUtils.clone(gltf.scene);
    leftScene.scale.set(-HAND_MODEL_SCALE, HAND_MODEL_SCALE, HAND_MODEL_SCALE);
    leftScene.position.set(0, 0, 0);
    leftScene.rotation.set(-Math.PI / 2, Math.PI, 0);
    leftScene.children.forEach(c => {
      if (!c.isMesh) { c.position.set(0, 0, 0); c.rotation.set(0, 0, 0); }
    });

    const leftPivot = new THREE.Group();
    leftPivot.name = 'enemyLeftHandPivot';
    leftPivot.add(leftScene);
    this._leftHandGroup.add(leftPivot);
    leftScene.updateWorldMatrix(true, true);

    const leftWristBone = leftScene.getObjectByName('Bone_Armature');
    if (leftWristBone) {
      const bp = new THREE.Vector3();
      leftWristBone.getWorldPosition(bp);
      leftPivot.worldToLocal(bp);
      leftScene.position.sub(bp);
      leftScene.updateWorldMatrix(true, true);
    }

    leftScene.traverse(obj => {
      if (!obj.isMesh) return;
      obj.castShadow = true;
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      mats.forEach(m => { if (m) { m.side = THREE.DoubleSide; m.color.setHex(0xf1c27d); m.roughness = 0.8; m.transparent = true; m.opacity = 0.70; } });
    });
    this._leftHandGroup.userData.glbReady = true;
  }

  // ─── foam sword ────────────────────────────────────────────────────────────

  _buildSword() {
    const swordGroup = new THREE.Group();
    swordGroup.name = 'enemyFoamSword';

    // Blade
    const bladeGeo = new THREE.CylinderGeometry(0.022, 0.032, 0.62, 12);
    bladeGeo.rotateX(Math.PI / 2);
    const blade = new THREE.Mesh(bladeGeo, new THREE.MeshStandardMaterial({ color: 0x2255dd, roughness: 0.55 }));
    blade.position.set(0, 0, 0.31);
    blade.castShadow = true;
    swordGroup.add(blade);

    // Tip
    const tipGeo = new THREE.CylinderGeometry(0, 0.022, 0.07, 10);
    tipGeo.rotateX(Math.PI / 2);
    const tip = new THREE.Mesh(tipGeo, new THREE.MeshStandardMaterial({ color: 0x66aaff }));
    tip.position.set(0, 0, 0.655);
    swordGroup.add(tip);

    // Guard
    const guard = new THREE.Mesh(
      new THREE.CylinderGeometry(0.11, 0.11, 0.035, 14),
      new THREE.MeshStandardMaterial({ color: 0xcc2222 })
    );
    guard.position.set(0, 0, 0);
    swordGroup.add(guard);

    // Handle
    const handleGeo = new THREE.CylinderGeometry(0.028, 0.032, 0.16, 10);
    handleGeo.rotateX(Math.PI / 2);
    const handle = new THREE.Mesh(handleGeo, new THREE.MeshStandardMaterial({ color: 0xdd3333 }));
    handle.position.set(0, 0, -0.08);
    swordGroup.add(handle);

    // Pommel
    const pommel = new THREE.Mesh(
      new THREE.SphereGeometry(0.038, 10, 8),
      new THREE.MeshStandardMaterial({ color: 0xaa1111 })
    );
    pommel.position.set(0, 0, -0.175);
    swordGroup.add(pommel);

    this._swordGroup = swordGroup;
    this.scene.add(swordGroup); // added directly to scene so world transforms are straightforward
  }

  // ─── health bar ────────────────────────────────────────────────────────────

  _buildHealthBar() {
    const canvas = document.createElement('canvas');
    canvas.width  = 128;
    canvas.height = 16;
    this._hpCanvas  = canvas;
    this._hpCtx     = canvas.getContext('2d');
    this._hpTexture = new THREE.CanvasTexture(canvas);

    const mat = new THREE.MeshBasicMaterial({ map: this._hpTexture, transparent: true, depthWrite: false, side: THREE.DoubleSide });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.11), mat);
    plane.name = 'enemyHealthBar';
    plane.position.y = CAPSULE_HEIGHT + 0.22;
    this.group.add(plane);
    this._hpPlane = plane;
    this._updateHealthBarCanvas();
  }

  _updateHealthBarCanvas() {
    const ctx = this._hpCtx;
    const W = 128, H = 16;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#333';
    ctx.fillRect(0, 0, W, H);
    const pct = Math.max(0, this.health / this.maxHealth);
    ctx.fillStyle = pct > 0.5 ? '#44dd44' : pct > 0.25 ? '#ddcc22' : '#dd3322';
    ctx.fillRect(0, 0, Math.round(W * pct), H);
    this._hpTexture.needsUpdate = true;
  }

  // ─── Rapier physics ────────────────────────────────────────────────────────

  _buildPhysics(pos) {
    const RAPIER = this.rapier;
    const world  = this.rapierWorld;

    const rbDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(pos.x, pos.y + CAPSULE_HEIGHT / 2, pos.z)
      .setLinearDamping(2.0)
      .setAngularDamping(5.0);
    this.rigidBody = world.createRigidBody(rbDesc);
    // Lock rotations so the capsule stays upright
    this.rigidBody.setEnabledRotations(false, true, false, true);

    const colDesc = RAPIER.ColliderDesc.capsule(PHYS_HALF_HEIGHT, PHYS_RADIUS)
      .setFriction(0.5)
      .setRestitution(0.1);
    world.createCollider(colDesc, this.rigidBody);
  }

  // ─── update (called each frame) ────────────────────────────────────────────

  /**
   * @param {number}        dt          – seconds since last frame
   * @param {THREE.Object3D} targetModel – the player's Three.js group
   * @param {object|null}   targetControls – PlayerControls (for applyKnockback / applyDamage)
   * @param {boolean}       shieldActive – whether the player has shield equipped and facing us
   * @param {boolean}       allowAttack  – if false, yield attack slot: retreat and hold idle pose
   */
  update(dt, targetModel, targetControls, shieldActive, allowAttack = true) {
    if (this.isDead || !this.rigidBody) return;

    // ── Sync visual group from physics ──────────────────────────────────────
    const t = this.rigidBody.translation();
    this.group.position.set(t.x, t.y - CAPSULE_HEIGHT / 2, t.z);

    // ── Ragdoll: sync full rotation from physics body ──────────────────────
    if (this._isRagdoll) {
      const rot = this.rigidBody.rotation();
      this.group.quaternion.set(rot.x, rot.y, rot.z, rot.w);
      // Still update arms/sword visuals but skip AI
      this._updateHandPositions(dt, Infinity);
      this._updateElasticArm(this._leftArm,  this._leftShoulder,  this._leftHandGroup);
      this._updateElasticArm(this._rightArm, this._rightShoulder, this._rightHandGroup);
      this._updateSword(dt);
      return;
    }

    // ── Face the player ────────────────────────────────────────────────────
    if (targetModel) {
      _toTarget.subVectors(targetModel.position, this.group.position);
      _toTarget.y = 0;
      if (_toTarget.lengthSq() > 0.001) {
        const targetYaw = Math.atan2(_toTarget.x, _toTarget.z);
        this.group.rotation.y = THREE.MathUtils.lerp(
          this.group.rotation.y, targetYaw, 1 - Math.exp(-8 * dt)
        );
      }
    }

    const distToTarget = targetModel
      ? this.group.position.distanceTo(targetModel.position)
      : Infinity;

    // ── AI state ───────────────────────────────────────────────────────────
    if (!allowAttack && distToTarget < BACKOFF_DIST) {
      this._aiState = 'backoff';
    } else if (distToTarget < ATTACK_RANGE && allowAttack) {
      this._aiState = 'attack';
    } else {
      this._aiState = 'chase';
    }

    // ── Movement ───────────────────────────────────────────────────────────
    if (this._aiState === 'backoff') {
      // Retreat away from player until we reach BACKOFF_DIST
      if (targetModel) {
        _toTarget.subVectors(this.group.position, targetModel.position);
        _toTarget.y = 0;
        if (_toTarget.lengthSq() > 0.001) {
          _toTarget.normalize().multiplyScalar(BACKOFF_SPEED);
          const vel = this.rigidBody.linvel();
          this.rigidBody.setLinvel({ x: _toTarget.x, y: vel.y, z: _toTarget.z }, true);
        }
      }
    } else if (this._aiState === 'chase' || distToTarget > CHASE_RANGE * 1.5) {
      if (targetModel && distToTarget > CHASE_RANGE) {
        _toTarget.subVectors(targetModel.position, this.group.position);
        _toTarget.y = 0;
        if (_toTarget.lengthSq() > 0.001) {
          _toTarget.normalize().multiplyScalar(CHASE_SPEED);
          const vel = this.rigidBody.linvel();
          this.rigidBody.setLinvel(
            { x: _toTarget.x, y: vel.y, z: _toTarget.z }, true
          );
        }
      }
    } else {
      // Slow to a stop horizontally
      const vel = this.rigidBody.linvel();
      this.rigidBody.setLinvel({ x: vel.x * 0.8, y: vel.y, z: vel.z * 0.8 }, true);
    }

    // ── Animate hands ──────────────────────────────────────────────────────
    this._updateHandPositions(dt, distToTarget);

    // ── Update elastic arms ────────────────────────────────────────────────
    this._updateElasticArm(this._leftArm,  this._leftShoulder,  this._leftHandGroup);
    this._updateElasticArm(this._rightArm, this._rightShoulder, this._rightHandGroup);

    // ── Billboard health bar toward camera ─────────────────────────────────
    if (this._camera) {
      this._hpPlane.lookAt(this._camera.position);
    }

    // ── Position + orient sword at right hand tip ──────────────────────────
    this._updateSword(dt);

    // ── Sword hit detection ────────────────────────────────────────────────
    if (this._aiState === 'attack' && targetModel) {
      this._checkSwordHitOnTarget(targetModel, targetControls, shieldActive);
    }
  }

  _updateHandPositions(dt, distToTarget) {
    if (!this._handTargetR) {
      this._handTargetR = new THREE.Vector3();
      this._handTargetL = new THREE.Vector3();
    }
    const lerpR = 1 - Math.exp(-12 * dt);
    const lerpL = 1 - Math.exp(-8 * dt);

    if (this._aiState === 'attack') {
      this._swingT += dt * SWING_FREQ;
      const sinT = Math.sin(this._swingT);
      const cosT = Math.cos(this._swingT * 0.7);

      this._handTargetR.set(
        sinT * SWING_AMP_X * 0.5 + 0.6,
        SWING_OFFSET_Y + cosT * 0.1,
        sinT * SWING_AMP_Z * 0.5 + 0.3
      );
      this._handTargetL.set(-0.35, 0.65, 0.2);
    } else {
      // idle / chase / backoff — arms at sides, no swing
      const gait = this._aiState === 'backoff' ? 0 : Math.sin(Date.now() * 0.004);
      this._handTargetR.set( 0.4,  0.75 + gait * 0.06, 0.2);
      this._handTargetL.set(-0.4,  0.75 - gait * 0.06, 0.2);
      this._swingT = 0;
    }

    this._rightHandGroup.position.lerp(this._handTargetR, lerpR);
    this._leftHandGroup.position.lerp(this._handTargetL, lerpL);
  }

  _updateElasticArm(armMesh, shoulderGroup, handGroup) {
    shoulderGroup.getWorldPosition(_sWorld);
    handGroup.getWorldPosition(_hWorld);

    const dist = _sWorld.distanceTo(_hWorld);
    if (dist < 0.01) return;

    const mid = _sWorld.clone().add(_hWorld).multiplyScalar(0.5);
    // Express mid in group-local space for the mesh position
    armMesh.position.copy(this.group.worldToLocal(mid.clone()));
    armMesh.scale.set(1, dist, 1);

    const dir = _hWorld.clone().sub(_sWorld).normalize();
    this.group.getWorldQuaternion(_rootQ);
    _armQ.setFromUnitVectors(_upAxis, dir);
    armMesh.quaternion.copy(_rootQ.clone().invert().multiply(_armQ));
  }

  _updateSword(dt) {
    // Sword origin = right hand world position
    this._rightHandGroup.getWorldPosition(_tmpV);

    // Derive sword orientation from hand velocity (makes blade trail hand motion)
    const prevPos = this._prevRightHandWorldPos;
    const vx = _tmpV.x - prevPos.x;
    const vy = _tmpV.y - prevPos.y;
    const vz = _tmpV.z - prevPos.z;
    const velLen = Math.sqrt(vx * vx + vy * vy + vz * vz);

    if (velLen > 0.0005 && this._aiState === 'attack') {
      // Orient sword so +Z axis (blade direction) aligns with hand velocity
      _handVelDir.set(vx / velLen, vy / velLen, vz / velLen);
      _tmpQ.setFromUnitVectors(_fwdAxis, _handVelDir);
      // Blend with rest orientation so it doesn't flip wildly
      this._swordQuaternion.slerp(_tmpQ, 1 - Math.exp(-6 * dt));
    } else {
      // Rest orientation: blade points forward from the hand
      this._rightHandGroup.getWorldQuaternion(_tmpQ);
      const restQ = new THREE.Quaternion().setFromEuler(REST_SWORD_EULER);
      _tmpQ.multiply(restQ);
      this._swordQuaternion.slerp(_tmpQ, 1 - Math.exp(-4 * dt));
    }

    this._prevRightHandWorldPos.copy(_tmpV);

    this._swordGroup.position.copy(_tmpV);
    this._swordGroup.quaternion.copy(this._swordQuaternion);
  }

  _checkSwordHitOnTarget(targetModel, targetControls, shieldActive) {
    const now = Date.now();
    if (now - this._lastHitTime < HIT_COOLDOWN_MS) return;

    // Compute sword tip in world space
    _swordTipWorld.copy(SWORD_TIP_LOCAL).applyQuaternion(this._swordGroup.quaternion).add(this._swordGroup.position);

    const targetCenter = _tmpV.copy(targetModel.position);
    targetCenter.y += 0.7; // roughly torso height

    const dist = _swordTipWorld.distanceTo(targetCenter);
    if (dist > SWORD_TIP_HIT_RADIUS) return;

    // Shield check — delegate to existing game logic
    if (shieldActive && typeof window.tryBlockLocalPlayerHitWithShield === 'function') {
      const blocked = window.tryBlockLocalPlayerHitWithShield({
        attackerModel: this.group,
        damage: SWORD_DAMAGE
      });
      if (blocked) {
        this._lastHitTime = now;
        return; // hit absorbed by shield
      }
    }

    // Apply knockback & damage to player
    const hitDir = new THREE.Vector3().subVectors(targetModel.position, this.group.position).normalize();
    hitDir.y = 0;

    // Visual knockback via callback set by the game loop
    if (typeof this._onHitPlayer === 'function') {
      this._onHitPlayer(hitDir);
    }

    // Reduce player health via window.localHealth
    if (typeof window.localHealth === 'number') {
      window.localHealth = Math.max(0, window.localHealth - SWORD_DAMAGE);
    }

    this._lastHitTime = now;

    // Flash the sword red briefly
    this._flashSword();
  }

  _flashSword() {
    this._swordGroup.traverse(obj => {
      if (!obj.isMesh) return;
      const mat = Array.isArray(obj.material) ? obj.material[0] : obj.material;
      if (!mat) return;
      const origColor = mat.color.getHex();
      mat.color.setHex(0xff2200);
      setTimeout(() => { if (mat) mat.color.setHex(origColor); }, 120);
    });
  }

  // ─── take damage (called externally when player's sword hits this enemy) ────

  applyDamage(amount) {
    if (this.isDead) return false;
    this.health = Math.max(0, this.health - amount);
    this._updateHealthBarCanvas();
    if (this.health <= 0) {
      this._die();
      return true;
    }
    return false;
  }

  // Direct knockback — bypasses the strength/profile system for easy tuning.
  applyDirectKnockback({ direction, horizSpeed = 6, upVelocity = 2, torqueMag = 80, ragdoll = false } = {}) {
    if (!direction || !this.rigidBody) return;
    const vel = this.rigidBody.linvel();
    this.rigidBody.setLinvel({ x: direction.x * horizSpeed, y: vel.y + upVelocity, z: direction.z * horizSpeed }, true);
    if (ragdoll) {
      if (this._ragdollTimeout) clearTimeout(this._ragdollTimeout);
      this._isRagdoll = true;
      try {
        this.rigidBody.setEnabledRotations(true, true, true, true);
        const torqueAxis = new THREE.Vector3(-direction.z, 0.1, direction.x).normalize();
        this.rigidBody.applyTorqueImpulse(
          { x: torqueAxis.x * torqueMag, y: torqueAxis.y * torqueMag, z: torqueAxis.z * torqueMag }, true
        );
      } catch (e) {
        console.warn('[EnemyPlayer] direct ragdoll error:', e);
      }
      this._ragdollTimeout = setTimeout(() => this._endRagdoll(), 2000);
    }
  }

  applyKnockback({ direction, strength = 2 } = {}) {
    if (!direction || !this.rigidBody) return;
    const { impulse } = getKnockbackImpulse(direction, strength);
    const { velocity } = getKnockbackMotion(direction, strength);

    // Small upward pop that grows with strength — strong enough to feel physical, not
    // enough to send the enemy straight into the sky.
    const upwardVelocity = Math.max(0, (strength - 2) * 0.3);
    this.rigidBody.applyImpulse({ x: impulse.x, y: impulse.y, z: impulse.z }, true);
    const vel = this.rigidBody.linvel();
    this.rigidBody.setLinvel({ x: velocity.x, y: vel.y + upwardVelocity, z: velocity.z }, true);

    if (strength >= RAGDOLL_STRENGTH_THRESHOLD) {
      this._startRagdoll(direction, strength);
    }
  }

  _startRagdoll(direction, strength) {
    if (this._ragdollTimeout) clearTimeout(this._ragdollTimeout);
    this._isRagdoll = true;
    try {
      this.rigidBody.setEnabledRotations(true, true, true, true);
      const torqueAxis = new THREE.Vector3(-direction.z, 0.1, direction.x).normalize();
      const torqueMag = strength * 10;
      this.rigidBody.applyTorqueImpulse(
        { x: torqueAxis.x * torqueMag, y: torqueAxis.y * torqueMag, z: torqueAxis.z * torqueMag },
        true
      );
    } catch (e) {
      console.warn('[EnemyPlayer] ragdoll start error:', e);
    }
    const durationMs = 1800 + (strength - RAGDOLL_STRENGTH_THRESHOLD) * 150;
    this._ragdollTimeout = setTimeout(() => this._endRagdoll(), durationMs);
  }

  _endRagdoll() {
    if (!this.rigidBody || this.isDead) return;
    this._isRagdoll = false;
    try {
      this.rigidBody.setEnabledRotations(false, true, false, true);
      this.rigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
    } catch (e) {
      console.warn('[EnemyPlayer] ragdoll end error:', e);
    }
    this.group.rotation.x = 0;
    this.group.rotation.z = 0;
  }

  _die() {
    this.isDead = true;
    if (this._ragdollTimeout) { clearTimeout(this._ragdollTimeout); this._ragdollTimeout = null; }
    this._isRagdoll = false;
    // Tip capsule over on death
    this.group.rotation.z = Math.PI / 2;
    this._capsuleMesh.material.color.setHex(0x333333);
    this._swordGroup.visible = false;

    // Remove physics body
    if (this.rigidBody && this.rapierWorld?.getRigidBody(this.rigidBody.handle)) {
      this.rapierWorld.removeRigidBody(this.rigidBody);
      this.rigidBody = null;
    }

    // Fade out and remove after 3 s
    setTimeout(() => this.destroy(), 3000);
  }

  /**
   * Call when the enemy should be fully removed from the scene.
   */
  destroy() {
    if (this._ragdollTimeout) { clearTimeout(this._ragdollTimeout); this._ragdollTimeout = null; }
    if (this._swordGroup.parent) this.scene.remove(this._swordGroup);
    if (this.group.parent)       this.scene.remove(this.group);
    if (this.rigidBody && this.rapierWorld?.getRigidBody?.(this.rigidBody.handle)) {
      this.rapierWorld.removeRigidBody(this.rigidBody);
      this.rigidBody = null;
    }
  }

  /**
   * World-space position of the sword tip — used by external hit checks.
   */
  getSwordTipWorldPos() {
    _swordTipWorld.copy(SWORD_TIP_LOCAL)
      .applyQuaternion(this._swordGroup.quaternion)
      .add(this._swordGroup.position);
    return _swordTipWorld.clone();
  }

  /**
   * World-space AABB center of the enemy capsule — used for sword hit tests
   * against the enemy from the player's side.
   */
  getCenterWorldPos() {
    return this.group.position.clone().add(new THREE.Vector3(0, CAPSULE_HEIGHT / 2, 0));
  }
}

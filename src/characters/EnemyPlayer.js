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
import { createGLBCharacterInstance } from '../models/glbCharacterModel.js';
import { getTerrainHeight } from '../environment/terrainHeight.js';

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

// ── Swing presets: hold position + swing target (body-local space) ────────────
// Each enemy randomly picks one; holds 2-4s then swings to the target quickly.
const SWING_PRESETS = [
  { hold: new THREE.Vector3( 0.0,  1.55, 0.25), swing: new THREE.Vector3( 0.15, 0.45, 0.55) }, // straight up → slam down
  { hold: new THREE.Vector3(-0.9,  0.90, 0.30), swing: new THREE.Vector3( 0.85, 0.85, 0.35) }, // far left → right sweep
  { hold: new THREE.Vector3( 0.80, 1.25, 0.25), swing: new THREE.Vector3(-0.65, 0.80, 0.38) }, // upper-right → lower-left
  { hold: new THREE.Vector3(-0.65, 1.30, 0.25), swing: new THREE.Vector3( 0.70, 0.75, 0.40) }, // upper-left → lower-right
  { hold: new THREE.Vector3( 0.90, 0.80, 0.35), swing: new THREE.Vector3(-0.50, 1.20, 0.30) }, // right → upper-left
];

// ── Block hand positions (body-local) ─────────────────────────────────────────
// Each enemy randomly picks one when entering a block phase.
// Z values are low (close to body) to mirror the player's blocking stance.
const BLOCK_HAND_PRESETS = [
  new THREE.Vector3( 0.10, 1.00, 0.22),  // center-high guard
  new THREE.Vector3(-0.05, 1.05, 0.22),  // slight left guard
  new THREE.Vector3( 0.20, 0.90, 0.20),  // right mid-guard
  new THREE.Vector3( 0.05, 1.10, 0.20),  // high center guard
];

// Trail rendering for sword swings
const TRAIL_DURATION_MS  = 380;  // how long trail history is kept (ms)
const TRAIL_FADE_MS      = 450;  // how long trail fades after swing (ms)
const TRAIL_COLORS       = [0xff4986, 0xff79ab, 0xffaad0]; // three stacked lines

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

    const initHearts = options.hearts ?? 3;
    this.hearts    = initHearts;
    this.maxHearts = initHearts;
    this.isDead    = false;
    this.speedScale = options.speedScale ?? 1.0;

    this._swingT       = 0;
    this._lastHitTime  = 0;
    this._aiState      = 'chase';  // 'chase' | 'attack'

    // ── Attack phase state machine ──────────────────────────────────────────
    // Phases: 'decide' | 'block' | 'swing_hold' | 'swing_execute'
    this._attackPhase    = 'decide';
    this._attackPhaseT   = 0;
    this._attackPhaseDur = 0;

    // Block state
    this._blockBasePos = new THREE.Vector3();
    this._blockSeed    = Math.random() * 100;  // unique wobble offset per enemy

    // Swing state
    this._swingPreset    = null;          // chosen SWING_PRESETS entry
    this._swingStartR    = new THREE.Vector3(); // hand position at swing start
    this._swingStartSwordQ = new THREE.Quaternion(); // sword quaternion captured at swing start

    // Trail state (sampled during swing_execute, fades afterwards)
    this._trailPoints    = [];            // { pos: THREE.Vector3, t: number }[]
    this._trailLines     = [];            // THREE.Line objects in scene
    this._trailFadeStart = -1;            // ms timestamp when fade began


    this._isRagdoll    = false;
    this._ragdollTimeout = null;

    // Sword bounce state (triggered when player sword collides with this sword)
    this._bounceActive  = false;
    this._bounceEndTime = 0;

    // Sword quaternion (updated each frame)
    this._swordQuaternion = new THREE.Quaternion().setFromEuler(REST_SWORD_EULER);

    // ── Three.js hierarchy ──────────────────────────────────────────────────
    this.group = new THREE.Group();
    this.group.name = 'EnemyPlayer';

    const startPos = options.position ?? new THREE.Vector3(5, 0, 5);
    this.group.position.copy(startPos);

    this._buildBody();
    this._buildSword();
    this._buildTrail();
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
    // Capsule — kept as physics reference but hidden; replaced by GLB character below
    const capsuleMat = new THREE.MeshStandardMaterial({ color: 0xcc3300, roughness: 0.75, metalness: 0.05 });
    const capsuleGeo = new THREE.CapsuleGeometry(CAPSULE_RADIUS, CAPSULE_HEIGHT - CAPSULE_RADIUS * 2, 8, 16);
    const capsuleMesh = new THREE.Mesh(capsuleGeo, capsuleMat);
    capsuleMesh.name = 'enemyBodyCapsule';
    capsuleMesh.castShadow = true;
    capsuleMesh.receiveShadow = true;
    capsuleMesh.position.y = CAPSULE_HEIGHT / 2;
    capsuleMesh.visible = false;
    this.group.add(capsuleMesh);
    this._capsuleMesh = capsuleMesh;

    // GLB character — loaded async
    this._glbMixer = null;
    this._glbWalkAction = null;
    this._glbIsWalking = false;
    createGLBCharacterInstance({
      targetHeight: CAPSULE_HEIGHT,
      onRebuild: (newWalkAction) => {
        this._glbWalkAction = newWalkAction;
        if (this._glbIsWalking) newWalkAction.reset().fadeIn(0.15).play();
      },
    }).then(({ container, mixer, walkAction }) => {
      this.group.add(container);
      this._glbMixer = mixer;
      this._glbWalkAction = walkAction;
    }).catch(e => console.warn('[EnemyPlayer] GLB character load failed:', e));

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
    const handMat = new THREE.MeshStandardMaterial({
      color: 0xf1c27d, roughness: 0.8, transparent: true, opacity: 0.70,
    });

    if (window.phoneSwordMode) {
      // Phone sword mode: use a simple sphere instead of the GLB hand model
      const sphereGeo = new THREE.SphereGeometry(0.065, 10, 8);
      const rightSphere = new THREE.Mesh(sphereGeo, handMat);
      rightSphere.castShadow = true;
      this._rightHandGroup.add(rightSphere);
      this._rightHandGroup.userData.glbReady = true;

      const leftSphere = new THREE.Mesh(sphereGeo, handMat.clone());
      leftSphere.castShadow = true;
      this._leftHandGroup.add(leftSphere);
      this._leftHandGroup.userData.glbReady = true;
      return;
    }

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

  // ─── sword trail ──────────────────────────────────────────────────────────

  _buildTrail() {
    for (let i = 0; i < TRAIL_COLORS.length; i++) {
      const mat = new THREE.LineBasicMaterial({
        color: TRAIL_COLORS[i],
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const geo = new THREE.BufferGeometry();
      const line = new THREE.Line(geo, mat);
      line.frustumCulled = false;
      this.scene.add(line);
      this._trailLines.push(line);
    }
  }

  _sampleTrail(nowMs) {
    // Sample the sword tip world position
    const tip = new THREE.Vector3();
    tip.copy(SWORD_TIP_LOCAL).applyQuaternion(this._swordGroup.quaternion).add(this._swordGroup.position);
    this._trailPoints.push({ pos: tip, t: nowMs });
    // Trim old points
    const cutoff = nowMs - TRAIL_DURATION_MS;
    while (this._trailPoints.length && this._trailPoints[0].t < cutoff) {
      this._trailPoints.shift();
    }
  }

  _updateTrailMeshes(nowMs) {
    const pts = this._trailPoints;
    const fading = this._trailFadeStart > 0;

    if (pts.length < 2) {
      this._trailLines.forEach(l => { l.material.opacity = 0; });
      return;
    }

    // Fade multiplier
    let fadeMult = 1;
    if (fading) {
      fadeMult = Math.max(0, 1 - (nowMs - this._trailFadeStart) / TRAIL_FADE_MS);
      if (fadeMult <= 0) {
        // Trail fully faded — clear points so we stop rendering
        this._trailPoints = [];
        this._trailFadeStart = -1;
        this._trailLines.forEach(l => { l.material.opacity = 0; });
        return;
      }
    }

    // Build positions for each stacked line (slight horizontal offsets for width)
    const offsets = [-0.018, 0, 0.018];
    this._trailLines.forEach((line, li) => {
      const off = offsets[li];
      const positions = new Float32Array(pts.length * 3);
      pts.forEach((p, i) => {
        positions[i * 3]     = p.pos.x + off;
        positions[i * 3 + 1] = p.pos.y;
        positions[i * 3 + 2] = p.pos.z;
      });
      line.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      line.geometry.setDrawRange(0, pts.length);
      line.geometry.computeBoundingSphere();

      const baseOpacity = li === 0 ? 0.82 : li === 1 ? 0.55 : 0.35;
      line.material.opacity = baseOpacity * fadeMult;
    });
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
    const guardGeo = new THREE.CylinderGeometry(0.11, 0.11, 0.035, 14);
    guardGeo.rotateX(Math.PI / 2); // circular face perpendicular to blade
    const guard = new THREE.Mesh(
      guardGeo,
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

  // ─── heart display ─────────────────────────────────────────────────────────

  _buildHealthBar() {
    const canvas = document.createElement('canvas');
    canvas.width  = 96;
    canvas.height = 32;
    this._hpCanvas  = canvas;
    this._hpCtx     = canvas.getContext('2d');
    this._hpTexture = new THREE.CanvasTexture(canvas);

    const mat = new THREE.MeshBasicMaterial({ map: this._hpTexture, transparent: true, depthWrite: false, side: THREE.DoubleSide });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(0.72, 0.24), mat);
    plane.name = 'enemyHealthBar';
    plane.position.y = CAPSULE_HEIGHT + 0.3;
    plane.visible = false;
    this.group.add(plane);
    this._hpPlane = plane;
    this._hpShowUntil = 0;
    this._updateHealthBarCanvas(true);
  }

  _updateHealthBarCanvas(silent = false) {
    const ctx = this._hpCtx;
    const W = 96, H = 32;
    ctx.clearRect(0, 0, W, H);
    const heartSize = 24;
    const gap = 4;
    const totalW = this.maxHearts * heartSize + (this.maxHearts - 1) * gap;
    const startX = (W - totalW) / 2;
    ctx.font = `${heartSize}px serif`;
    for (let i = 0; i < this.maxHearts; i++) {
      const x = startX + i * (heartSize + gap);
      const filled = i < this.hearts;
      ctx.globalAlpha = filled ? 1 : 0.25;
      ctx.fillStyle = filled ? '#ff2244' : '#000000';
      ctx.fillText('❤', x, H - 4);
    }
    ctx.globalAlpha = 1;
    this._hpTexture.needsUpdate = true;
    if (!silent) {
      // Show hearts for 3 seconds after a hit
      this._hpShowUntil = Date.now() + 3000;
      if (this._hpPlane) this._hpPlane.visible = true;
    }
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
    if (!this.rigidBody) return;

    // ── Sync visual group from physics ──────────────────────────────────────
    const t = this.rigidBody.translation();
    const physY = t.y - (PHYS_HALF_HEIGHT + PHYS_RADIUS);
    const terrainY = getTerrainHeight(t.x, t.z);
    const groupY = Number.isFinite(terrainY) ? Math.max(physY, terrainY) : physY;
    this.group.position.set(t.x, groupY, t.z);

    // Dead: only sync position/rotation, skip all AI and combat logic
    if (this.isDead) {
      if (this._isRagdoll && this.rigidBody) {
        const rot = this.rigidBody.rotation();
        this.group.quaternion.set(rot.x, rot.y, rot.z, rot.w);
      }
      return;
    }

    // ── Ragdoll: sync full rotation from physics body ──────────────────────
    if (this._isRagdoll) {
      const rot = this.rigidBody.rotation();
      this.group.quaternion.set(rot.x, rot.y, rot.z, rot.w);
      // Still update arms/sword visuals but skip AI
      this._updateHandPositions(dt, Infinity);
      this._updateElasticArm(this._rightArm, this._rightShoulder, this._rightHandGroup);
      this._updateSword(dt);
      this._updateLeftHandToPommel(dt);
      this._updateElasticArm(this._leftArm, this._leftShoulder, this._leftHandGroup);
      this._updateTrailMeshes(Date.now());
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
          _toTarget.normalize().multiplyScalar(BACKOFF_SPEED * this.speedScale);
          const vel = this.rigidBody.linvel();
          this.rigidBody.setLinvel({ x: _toTarget.x, y: vel.y, z: _toTarget.z }, true);
        }
      }
    } else if (this._aiState === 'chase' || distToTarget > CHASE_RANGE * 1.5) {
      if (targetModel && distToTarget > CHASE_RANGE) {
        _toTarget.subVectors(targetModel.position, this.group.position);
        _toTarget.y = 0;
        if (_toTarget.lengthSq() > 0.001) {
          _toTarget.normalize().multiplyScalar(CHASE_SPEED * this.speedScale);
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

    // ── GLB character walk animation ──────────────────────────────────────
    if (this._glbMixer) {
      this._glbMixer.update(dt);
      const isMoving = this._aiState === 'chase' || this._aiState === 'backoff';
      if (isMoving && !this._glbIsWalking) {
        this._glbWalkAction?.reset().fadeIn(0.15).play();
        this._glbIsWalking = true;
      } else if (!isMoving && this._glbIsWalking) {
        this._glbWalkAction?.fadeOut(0.15);
        this._glbIsWalking = false;
      }
    }

    // ── Right hand (drives sword position) ────────────────────────────────
    this._updateHandPositions(dt, distToTarget);
    this._updateElasticArm(this._rightArm, this._rightShoulder, this._rightHandGroup);

    // ── Sword (orientation depends on right hand) ──────────────────────────
    this._updateSword(dt);

    // ── Left hand grips pommel (depends on sword orientation) ─────────────
    this._updateLeftHandToPommel(dt);
    this._updateElasticArm(this._leftArm, this._leftShoulder, this._leftHandGroup);

    // ── Billboard health bar toward camera ─────────────────────────────────
    if (this._camera) {
      this._hpPlane.lookAt(this._camera.position);
    }
    if (this._hpPlane.visible && Date.now() > this._hpShowUntil) {
      this._hpPlane.visible = false;
    }

    // ── Update sword swing trail ───────────────────────────────────────────
    this._updateTrailMeshes(Date.now());

    // ── Sword hit detection ────────────────────────────────────────────────
    if (this._aiState === 'attack' && targetModel) {
      this._checkSwordHitOnTarget(targetModel, targetControls, shieldActive);
    }
  }

  // ─── internal helpers ──────────────────────────────────────────────────────

  /** Pick next attack phase randomly: 60% block, 40% swing. */
  _decideNextPhase() {
    if (Math.random() < 0.60) {
      // Enter block
      this._attackPhase    = 'block';
      this._attackPhaseDur = 1.5 + Math.random() * 2.5;
      this._blockSeed      = Math.random() * 100;
      const preset = BLOCK_HAND_PRESETS[Math.floor(Math.random() * BLOCK_HAND_PRESETS.length)];
      this._blockBasePos.copy(preset);
    } else {
      // Enter swing hold
      this._attackPhase    = 'swing_hold';
      this._attackPhaseDur = 2.0 + Math.random() * 2.0;
      this._swingPreset    = SWING_PRESETS[Math.floor(Math.random() * SWING_PRESETS.length)];
    }
    this._attackPhaseT = 0;
  }

  _updateHandPositions(dt, distToTarget) {
    if (!this._handTargetR) {
      this._handTargetR = new THREE.Vector3();
      this._handTargetL = new THREE.Vector3();
    }
    const lerpR = 1 - Math.exp(-(this._attackPhase === 'swing_execute' ? 22 : 12) * dt);

    if (this._aiState === 'attack') {
      this._attackPhaseT += dt;

      // ── Phase transitions ────────────────────────────────────────────────
      if (this._attackPhase === 'decide' || this._attackPhaseT >= this._attackPhaseDur) {
        if (this._attackPhase === 'swing_hold') {
          // Move to swing execute
          this._attackPhase    = 'swing_execute';
          this._attackPhaseDur = 0.32 + Math.random() * 0.10;
          this._attackPhaseT   = 0;
          // Record right hand position at start of swing for lerping
          this._swingStartR.copy(this._rightHandGroup.position);
          // Capture sword quaternion so swing rotation starts from current pose
          this._swingStartSwordQ.copy(this._swordQuaternion);
          // Clear old trail points, start fresh
          this._trailPoints    = [];
          this._trailFadeStart = -1;
        } else if (this._attackPhase === 'swing_execute') {
          // Swing done — hold final pose for 2s, then fade trail and decide next
          this._trailFadeStart = Date.now();
          this._attackPhase    = 'swing_end_hold';
          this._attackPhaseDur = 2.0;
          this._attackPhaseT   = 0;
          // Capture the final sword quaternion so we can hold it exactly
          this._swingEndSwordQ = this._swordQuaternion.clone();
          // Capture final hand position (swing target) to hold
          this._swingEndHandPos = new THREE.Vector3(
            this._swingPreset.swing.x, this._swingPreset.swing.y, this._swingPreset.swing.z
          );
        } else {
          // block or decide
          this._decideNextPhase();
        }
      }

      // ── Per-phase hand targeting ─────────────────────────────────────────
      const p = Math.min(this._attackPhaseT / Math.max(0.001, this._attackPhaseDur), 1);
      const t = this._attackPhaseT;

      switch (this._attackPhase) {

        case 'block': {
          // Natural wobble: two overlapping sin waves at different frequencies
          const wx = Math.sin(t * 3.1 + this._blockSeed) * 0.048
                   + Math.sin(t * 1.9 + this._blockSeed * 0.5) * 0.022;
          const wy = Math.sin(t * 2.4 + this._blockSeed * 0.7) * 0.035
                   + Math.sin(t * 4.3 + this._blockSeed * 1.3) * 0.018;
          this._handTargetR.set(
            this._blockBasePos.x + wx,
            this._blockBasePos.y + wy,
            this._blockBasePos.z
          );
          break;
        }

        case 'swing_hold': {
          const hold = this._swingPreset.hold;
          // Subtle tension wobble while winding up
          const wob = Math.sin(t * 5.0) * 0.025;
          this._handTargetR.set(hold.x + wob, hold.y, hold.z);
          break;
        }

        case 'swing_execute': {
          // Ease-in-out from hold → swing target (fast!)
          const eased = p < 0.5 ? 2 * p * p : -1 + (4 - 2 * p) * p;
          const hold  = this._swingPreset.hold;
          const tgt   = this._swingPreset.swing;
          this._handTargetR.set(
            hold.x + (tgt.x - hold.x) * eased,
            hold.y + (tgt.y - hold.y) * eased,
            hold.z + (tgt.z - hold.z) * eased
          );
          // Sample trail tip this frame
          this._sampleTrail(Date.now());
          break;
        }

        case 'swing_end_hold': {
          // Hold at the final swing-target position for 2 seconds
          if (this._swingEndHandPos) {
            this._handTargetR.copy(this._swingEndHandPos);
          }
          break;
        }

        default:
          this._handTargetR.set(0.4, 0.85, 0.35);
      }

    } else {
      // idle / chase / backoff — arms at sides, reset attack phase
      const gait = this._aiState === 'backoff' ? 0 : Math.sin(Date.now() * 0.004);
      this._handTargetR.set( 0.4,  0.75 + gait * 0.06, 0.2);
      this._swingT       = 0;
      this._attackPhase  = 'decide';
      this._attackPhaseT = 0;
    }

    this._rightHandGroup.position.lerp(this._handTargetR, lerpR);
  }

  /**
   * Position the left hand at the sword pommel so both hands grip the sword.
   * Must be called AFTER _updateSword() so the sword quaternion is current.
   */
  _updateLeftHandToPommel(dt) {
    if (this._aiState !== 'attack') {
      // Idle/chase: natural arm swing at the side
      const gait = this._aiState === 'backoff' ? 0 : Math.sin(Date.now() * 0.004);
      this._handTargetL.set(-0.4, 0.75 - gait * 0.06, 0.2);
      this._leftHandGroup.position.lerp(this._handTargetL, 1 - Math.exp(-8 * dt));
      return;
    }

    // Pommel is at z = -0.175 in sword-local space; map to world then body-local
    _tmpV.set(0, 0, -0.175)
      .applyQuaternion(this._swordGroup.quaternion)
      .add(this._swordGroup.position);
    this.group.worldToLocal(_tmpV);
    this._handTargetL.copy(_tmpV);
    // Fast lerp during swing, a bit slower during block/hold so it feels natural
    const speed = this._attackPhase === 'swing_execute' ? 22 : 12;
    this._leftHandGroup.position.lerp(this._handTargetL, 1 - Math.exp(-speed * dt));
  }

  _updateElasticArm(armMesh, shoulderGroup, handGroup) {
    shoulderGroup.getWorldPosition(_sWorld);
    handGroup.getWorldPosition(_hWorld);

    const dist = _sWorld.distanceTo(_hWorld);
    if (dist < 0.01) return;

    const mid = _sWorld.clone().add(_hWorld).multiplyScalar(0.5);
    // Express mid in group-local space for the mesh position
    armMesh.position.copy(this.group.worldToLocal(mid.clone()));
    armMesh.scale.set(0.4, dist, 0.4);

    const dir = _hWorld.clone().sub(_sWorld).normalize();
    this.group.getWorldQuaternion(_rootQ);
    _armQ.setFromUnitVectors(_upAxis, dir);
    armMesh.quaternion.copy(_rootQ.clone().invert().multiply(_armQ));
  }

  /** Called externally when the player's sword hits this sword. */
  applySwordBounce() {
    const dur = (window.phoneSwordSwingCfg?.enemyBounceHoldDur ?? 2.0) * 1000;
    this._bounceActive    = true;
    this._bounceEndTime   = Date.now() + dur;
    this._bounceInitDone  = false; // force recoil target rebuild on next _updateSword
    // Cancel any in-flight swing so the bounce doesn't immediately re-hit
    if (this._attackPhase === 'swing_execute') {
      this._attackPhase    = 'swing_hold';
      this._attackPhaseT   = 0;
      this._attackPhaseDur = 0.6;
    }
    // Show enemy block flash (gray spiky) if a callback is registered
    window._pswShowBlockFlash?.('enemy');
  }

  _updateSword(dt) {
    // Sword origin = right hand world position
    this._rightHandGroup.getWorldPosition(_tmpV);

    // Bounce overrides normal sword motion for 0.5 s
    if (this._bounceActive) {
      if (Date.now() > this._bounceEndTime) {
        this._bounceActive = false;
      } else {
        const cfg = window.phoneSwordSwingCfg;
        const snapSpeed  = cfg?.bounceSnapSpeed ?? 18;
        const bounceAngle = ((cfg?.bounceAngle ?? 90) * Math.PI) / 180;
        // Build recoil target: rotate current sword Q by bounceAngle around world Y
        if (!this._bounceTargetQ) this._bounceTargetQ = new THREE.Quaternion();
        if (!this._bounceInitDone) {
          const yRot = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), bounceAngle);
          this._bounceTargetQ.copy(yRot).multiply(this._swordQuaternion);
          this._bounceInitDone = true;
        }
        this._swordQuaternion.slerp(this._bounceTargetQ, 1 - Math.exp(-snapSpeed * dt));
        this._swordGroup.position.copy(_tmpV);
        this._swordGroup.quaternion.copy(this._swordQuaternion);
        return;
      }
    }

    if (this._attackPhase === 'block') {
      // ── Block: hold sword upright close to body, matching player's block stance ─
      this.group.getWorldQuaternion(_rootQ);
      // Blade points upward-forward with slight tilt, like the player holding in guard
      const blockEuler = new THREE.Euler(
        -Math.PI * 0.15 + Math.sin(this._attackPhaseT * 2.7 + this._blockSeed) * 0.04,
         0,
         Math.PI * 0.08 + Math.sin(this._attackPhaseT * 1.8 + this._blockSeed * 0.6) * 0.04,
        'YXZ'
      );
      _tmpQ.setFromEuler(blockEuler);
      _tmpQ.premultiply(_rootQ);
      this._swordQuaternion.slerp(_tmpQ, 1 - Math.exp(-8 * dt));

    } else if (this._attackPhase === 'swing_execute') {
      // ── Swing: rotate blade in sync with hand motion using the same eased progress ──
      const p = Math.min(this._attackPhaseT / Math.max(0.001, this._attackPhaseDur), 1);
      const eased = p < 0.5 ? 2 * p * p : -1 + (4 - 2 * p) * p;
      const hold = this._swingPreset.hold;
      const tgt  = this._swingPreset.swing;
      // Swing direction in body-local space → world space
      this.group.getWorldQuaternion(_rootQ);
      _handVelDir.set(tgt.x - hold.x, tgt.y - hold.y, tgt.z - hold.z).normalize()
        .applyQuaternion(_rootQ);
      _tmpQ.setFromUnitVectors(_fwdAxis, _handVelDir);
      this._swordQuaternion.slerpQuaternions(this._swingStartSwordQ, _tmpQ, eased);

    } else if (this._attackPhase === 'swing_end_hold') {
      // ── Post-swing: freeze sword at final swing position for 2 seconds ────
      if (this._swingEndSwordQ) {
        this._swordQuaternion.copy(this._swingEndSwordQ);
      }

    } else if (this._attackPhase === 'swing_hold') {
      // ── Windup: tilt blade toward target direction before swing ───────────
      this.group.getWorldQuaternion(_rootQ);
      const hold = this._swingPreset?.hold ?? _tmpV;
      const holdEuler = new THREE.Euler(
        -Math.PI * 0.35,
        Math.atan2(hold.x, hold.z + 0.001),
        0,
        'YXZ'
      );
      _tmpQ.setFromEuler(holdEuler);
      _tmpQ.premultiply(_rootQ);
      this._swordQuaternion.slerp(_tmpQ, 1 - Math.exp(-6 * dt));

    } else {
      // Rest / chase orientation: blade points forward from hand
      this._rightHandGroup.getWorldQuaternion(_tmpQ);
      const restQ = new THREE.Quaternion().setFromEuler(REST_SWORD_EULER);
      _tmpQ.multiply(restQ);
      this._swordQuaternion.slerp(_tmpQ, 1 - Math.exp(-4 * dt));
    }

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

    // Player sword block: if the player's blade points are near this sword's tip, deflect.
    const playerBladePoints = window.phoneSwordBladePoints;
    if (playerBladePoints?.length) {
      const _playerBlocking = !!window.phoneSwordGyro?.blocking;
      const _blockRadius = _playerBlocking ? 0.55 : 0.32;
      for (const pp of playerBladePoints) {
        if (_swordTipWorld.distanceTo(pp) < _blockRadius) {
          // Player sword intercepted — bounce this enemy sword, no damage
          this.applySwordBounce();
          this._lastHitTime = now;
          return;
        }
      }
    }

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
    window.audioManager?.playSFX('SFX/Attacks/Sword Attacks Hits and Blocks/Sword Impact Hit 3.ogg', 0.6, { cooldownKey: 'psw-hit', cooldownMs: 200 });

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
    this.hearts = Math.max(0, this.hearts - 1);
    this._updateHealthBarCanvas();
    if (this.hearts <= 0) {
      this._die();
      return true; // killing blow
    }
    return false; // survived
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
    this._swordGroup.visible = false;

    // Keep rigid body alive so knockback applied after _die() still has something to push.
    // destroy() will remove it when the fade finishes.

    // Fade out the group over 2 s then destroy.
    // Clone materials first so the fade doesn't corrupt shared material state
    // (SkeletonUtils.clone shares materials by reference across all character instances).
    this.group.traverse(obj => {
      if (obj.isMesh && obj.material) {
        obj.material = obj.material.clone();
      }
    });
    const _startMs = Date.now();
    const _fadeDur = 2000;
    const _fadeGroup = this.group;
    const _fadeHp = this._hpPlane;
    const _tick = () => {
      const t = Math.min(1, (Date.now() - _startMs) / _fadeDur);
      const opacity = 1 - t;
      _fadeGroup.traverse(obj => {
        if (obj.material) {
          obj.material.transparent = true;
          obj.material.opacity = opacity;
        }
      });
      if (_fadeHp) _fadeHp.material.opacity = opacity;
      if (t < 1) requestAnimationFrame(_tick);
      else this.destroy();
    };
    requestAnimationFrame(_tick);
  }

  /**
   * Call when the enemy should be fully removed from the scene.
   */
  destroy() {
    if (this._ragdollTimeout) { clearTimeout(this._ragdollTimeout); this._ragdollTimeout = null; }
    if (this._swordGroup.parent) this.scene.remove(this._swordGroup);
    if (this.group.parent)       this.scene.remove(this.group);
    // Remove trail lines
    this._trailLines.forEach(l => {
      if (l.parent) l.parent.remove(l);
      l.geometry?.dispose?.();
      l.material?.dispose?.();
    });
    this._trailLines = [];
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

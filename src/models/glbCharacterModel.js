/**
 * GLB character used by the local player, remote players and EnemyPlayers.
 *
 * The character (gemhorn_rigged.glb, Mixamo skeleton) is animated with Mixamo FBX
 * clips through fluffyCharacter.ts, which retargets by world-space rotation deltas
 * and adds fluffy secondary motion + shell fur. The clip drives the whole body
 * EXCEPT the arm chains (Shoulder → Arm → ForeArm → Hand): those are posed every
 * frame by a two-bone IK that reaches for the game's floating-hand targets (gyro
 * sword grip, fixed shield/gun hold, enemy AI swing/block targets). When a target
 * is beyond the arm's reach the arm stretches (up to armMaxStretch), in the spirit
 * of the elastic arms this replaces.
 *
 * Orientation: the GLB and Mixamo clips both face +Z, which is the game's
 * model-forward, so no Y180 correction is needed.
 *
 * Hand labels: the game's floating hands are mirrored — the 'right' hand group sits
 * at local +X, which is the character's anatomical LEFT when it faces +Z (and the
 * 'left' group sits at -X). ARM_CHAIN_FOR_HAND maps each floating hand to the arm on
 * the same side of the body so arms never cross.
 *
 * Frame order per character:
 *   setMoving() → animate(dt) → solveArm(...) for each hand → stepFluff(dt)
 *
 * Death: playDeath() plays deathClip once over the whole body (arm IK suspended, the
 * floating hands just follow the palms) until revive().
 *
 * One-shot actions: playAction(url) plays a clip once over the whole body (arm IK
 * suspended like death), then returns to walk/idle; actionProgress / actionActive
 * let the caller time events (e.g. the bomb thrower's release) against the clip.
 *
 * armIK: false (createGLBCharacterInstance option) leaves the arms to the clips
 * entirely — for characters with no floating-hand targets (the bomb thrower).
 * solveArm() then only snaps the target to the palm.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { FluffyCharacter } from './fluffyCharacter.ts';

export const glbCharacterConfig = {
  url: '/models/glb_characters/gemhorn_rigged.glb',
  walkClip: '/models/animations/Old Man Walk.fbx',
  idleClip: '/models/animations/Breathing Idle.fbx',
  deathClip: '/models/animations/Flying Back Death.fbx', // played once (whole body, arms included) by playDeath()
  throwClip: '/models/animations/Throw.fbx', // bomb thrower's throw (playAction); right-handed
  clipFade: 0.2,           // seconds to crossfade walk <-> idle
  targetHeight: 1.0,       // world height of the character (bind pose)

  // Arm IK
  armMaxStretch: 5,        // arms may stretch up to this multiple of their rest length
  armStretchSlack: 0.92,   // start stretching just before full extension so elbows keep a slight bend
  elbowPole: { x: 0.35, y: -1, z: -0.45 }, // elbow direction hint in rig space (x is mirrored per side)

  // fluffyCharacter settings (fur length is in the GLB's own units, before targetHeight scaling)
  fluffy: {
    enabled: true, softness: 0.55, bounce: 0.45, amount: 0.8, flutter: 0.3, fuzz: 0.5,
    shells: 8, furLength: 0.06, shellsHairOnly: false,
  },
};

// Floating-hand label → Mixamo arm on the same local-X side (see header)
const ARM_CHAIN_FOR_HAND = { right: 'Left', left: 'Right' };
// Clip-excluded subtrees: the clavicles and everything below them
const ARM_ROOT_BONES = ['LeftShoulder', 'RightShoulder'];

const _gltfLoader = new GLTFLoader();
let _gltfPromise = null;

function getCharacterGLTF() {
  if (!_gltfPromise) {
    _gltfPromise = _gltfLoader.loadAsync(glbCharacterConfig.url);
    _gltfPromise.catch(() => { _gltfPromise = null; });
  }
  return _gltfPromise;
}

// ── Scratch objects ─────────────────────────────────────────────────────────

const _Y = new THREE.Vector3(0, 1, 0);
const _rigInv = new THREE.Matrix4();
const _shRig = new THREE.Matrix4();
const _mU = new THREE.Matrix4();
const _mF = new THREE.Matrix4();
const _mH = new THREE.Matrix4();
const _mTmp = new THREE.Matrix4();
const _shQ = new THREE.Quaternion();
const _qU = new THREE.Quaternion();
const _qF = new THREE.Quaternion();
const _qH = new THREE.Quaternion();
const _qSwing = new THREE.Quaternion();
const _target = new THREE.Vector3();
const _S = new THREE.Vector3();
const _E = new THREE.Vector3();
const _W = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _pole = new THREE.Vector3();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _stretch = new THREE.Vector3();

// ── Character ───────────────────────────────────────────────────────────────

export class GLBCharacter {
  constructor(scene, { armIK = true } = {}) {
    this.scene = scene;
    this._armIK = armIK;
    this.fluffy = new FluffyCharacter(scene, glbCharacterConfig.fluffy);
    this.arms = {};
    scene.updateMatrixWorld(true);
    for (const [hand, side] of Object.entries(ARM_CHAIN_FOR_HAND)) {
      this.arms[hand] = this._buildArm(side);
    }
    this._moving = null;
    this._dead = false;
    this._action = null; // { started } while a playAction() clip owns the body
    if (!armIK) this._setArmIK(false);
    this.setMoving(false);
  }

  _buildArm(side) {
    const upper = this.fluffy.getBone(`${side}Arm`);
    const fore = this.fluffy.getBone(`${side}ForeArm`);
    const hand = this.fluffy.getBone(`${side}Hand`);
    if (!upper || !fore || !hand || !upper.parent) return null;
    // The IK writes these bones' matrices directly (they can be stretched)
    for (const b of [upper, fore, hand]) {
      b.updateMatrix();
      b.matrixAutoUpdate = false;
    }
    const restHandWorld = hand.getWorldPosition(new THREE.Vector3());
    const restShoulderWorld = upper.getWorldPosition(new THREE.Vector3());
    const len2 = hand.position.length();
    return {
      upper, fore, hand,
      upperPos: upper.position.clone(), upperRest: upper.quaternion.clone(),
      forePos: fore.position.clone(), foreRest: fore.quaternion.clone(),
      handPos: hand.position.clone(), handRest: hand.quaternion.clone(), handScale: hand.scale.clone(),
      len1: fore.position.length(),
      len2,
      palm: this._measurePalm(hand) || len2 * 0.3,
      // Which way is "outward" for the elbow hint, in rig space
      sideSign: Math.sign(this.fluffy.rigSpace.worldToLocal(restHandWorld).x
        - this.fluffy.rigSpace.worldToLocal(restShoulderWorld).x) || 1,
    };
  }

  // Distance from the wrist to the middle of the hand mesh, along the hand bone (+Y)
  _measurePalm(hand) {
    let maxY = 0;
    const v = new THREE.Vector3();
    const m = new THREE.Matrix4();
    this.scene.traverse((o) => {
      if (!o.isSkinnedMesh) return;
      const idx = o.skeleton.bones.indexOf(hand);
      if (idx < 0) return;
      const { position, skinIndex, skinWeight } = o.geometry.attributes;
      if (!position || !skinIndex || !skinWeight) return;
      m.multiplyMatrices(o.skeleton.boneInverses[idx], o.bindMatrix);
      for (let i = 0; i < position.count; i++) {
        let best = 0;
        for (let c = 1; c < 4; c++) if (skinWeight.getComponent(i, c) > skinWeight.getComponent(i, best)) best = c;
        if (skinIndex.getComponent(i, best) !== idx) continue;
        v.fromBufferAttribute(position, i).applyMatrix4(m);
        if (v.y > maxY) maxY = v.y;
      }
    });
    return maxY * 0.5;
  }

  /** Switches between the walk and idle clips (crossfaded); no-op if unchanged. */
  setMoving(moving) {
    if (this._dead) return;
    moving = !!moving;
    if (moving === this._moving) return;
    this._moving = moving;
    if (this._action) return; // picked up when the action clip ends
    const cfg = glbCharacterConfig;
    this.fluffy.play(moving ? cfg.walkClip : cfg.idleClip, {
      inPlace: true,
      fade: cfg.clipFade,
      excludeBones: this._armIK ? ARM_ROOT_BONES : [],
    }).catch((e) => console.warn('[GLBCharacter] clip load failed:', e));
  }

  /**
   * Plays `url` once over the whole body (arm IK suspended), then crossfades back to
   * walk/idle. Ignored while dead; a later playDeath() cancels it.
   */
  playAction(url, { fade = 0.1 } = {}) {
    if (this._dead) return;
    const action = { started: false };
    this._action = action;
    this._setArmIK(false);
    this.fluffy.play(url, { inPlace: true, fade, loop: false })
      .then(() => { if (this._action === action) action.started = true; })
      .catch((e) => {
        console.warn('[GLBCharacter] action clip load failed:', e);
        if (this._action === action) this._endAction();
      });
  }

  /** True from playAction() until its clip has finished. */
  get actionActive() { return !!this._action; }

  /** Playback position (0..1) of the playAction() clip; 0 while it is still loading. */
  get actionProgress() {
    if (!this._action) return 1;
    return this._action.started ? this.fluffy.clipProgress : 0;
  }

  _endAction() {
    this._action = null;
    if (this._dead) return;
    this._setArmIK(this._armIK);
    const moving = this._moving;
    this._moving = null;
    this.setMoving(moving);
  }

  /**
   * Plays the death clip once and holds its last frame. The clip drives the arms too
   * (IK is suspended) until revive(); setMoving() is ignored meanwhile.
   */
  playDeath() {
    if (this._dead) return;
    this._dead = true;
    this._action = null;
    this._setArmIK(false);
    const cfg = glbCharacterConfig;
    this.fluffy.play(cfg.deathClip, { inPlace: true, fade: 0.15, loop: false })
      .catch((e) => console.warn('[GLBCharacter] death clip load failed:', e));
  }

  /** Undoes playDeath(): arms back on IK, walk/idle clips resume. */
  revive() {
    if (!this._dead) return;
    this._dead = false;
    this._setArmIK(this._armIK);
    this._moving = null;
    this.setMoving(false);
  }

  get isDead() { return this._dead; }

  // IK on: solveArm() writes the arm bones' matrices. Off: the clip drives them normally.
  _setArmIK(enabled) {
    for (const arm of Object.values(this.arms)) {
      if (!arm) continue;
      for (const b of [arm.upper, arm.fore, arm.hand]) {
        b.matrixAutoUpdate = !enabled;
        if (!enabled) b.updateMatrix();
      }
    }
  }

  /** Body animation for this frame (arms excluded). */
  animate(dt) {
    this.fluffy.animate(dt);
    if (this._action?.started && this.fluffy.clipFinished) this._endAction();
    // Bring the rig (and its ancestors) up to date so solveArm() works on this frame's pose
    this.fluffy.rigSpace.updateWorldMatrix(true, true);
  }

  /**
   * Poses the arm for floating hand `hand` ('left' | 'right', the game's labels) so the
   * palm reaches `targetObject`'s world position. With `writeBack`, `targetObject` is moved
   * to where the palm actually ended up (differs only when the target is out of reach),
   * so anything attached to it (weapons, the enemy sword) stays in the hand.
   */
  solveArm(hand, targetObject, { writeBack = true } = {}) {
    const arm = this.arms[hand];
    if (!arm || !targetObject) return;
    if (this._dead || this._action || !this._armIK) {
      // A clip owns the arms: just keep the floating hand (and anything held) on the palm
      if (writeBack && targetObject.parent) {
        targetObject.position.copy(targetObject.parent.worldToLocal(this.getPalmWorldPosition(hand, _v)));
      }
      return;
    }
    const cfg = glbCharacterConfig;
    const rig = this.fluffy.rigSpace;
    _rigInv.copy(rig.matrixWorld).invert();

    // Everything below is in rig space
    targetObject.getWorldPosition(_target).applyMatrix4(_rigInv);
    _shRig.multiplyMatrices(_rigInv, arm.upper.parent.matrixWorld);
    _S.copy(arm.upperPos).applyMatrix4(_shRig);
    _shRig.decompose(_v, _shQ, _v2);

    _dir.subVectors(_target, _S);
    const d = _dir.length();
    if (d < 1e-5) return;
    _dir.divideScalar(d);

    // Stretch the upper arm + forearm (not the hand) when the target is far away
    const restReach = arm.len1 + arm.len2 + arm.palm;
    const k = THREE.MathUtils.clamp(d / (restReach * cfg.armStretchSlack), 1, cfg.armMaxStretch);
    const l1 = arm.len1 * k;
    const l2 = arm.len2 * k + arm.palm;
    const dc = THREE.MathUtils.clamp(d, Math.abs(l1 - l2) + 1e-4, (l1 + l2) * 0.999);

    // Elbow position: law of cosines, bent toward the pole hint
    const a = (l1 * l1 - l2 * l2 + dc * dc) / (2 * dc);
    const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
    _pole.set(cfg.elbowPole.x * arm.sideSign, cfg.elbowPole.y, cfg.elbowPole.z);
    _pole.addScaledVector(_dir, -_pole.dot(_dir));
    if (_pole.lengthSq() < 1e-8) _pole.set(0, 0, -1).addScaledVector(_dir, _dir.z); // reaching straight down/up
    if (_pole.lengthSq() < 1e-8) _pole.set(arm.sideSign, 0, 0);
    _pole.normalize();
    _E.copy(_S).addScaledVector(_dir, a).addScaledVector(_pole, h);

    // Upper arm: swing the orientation it would inherit from the clavicle onto S→E
    _stretch.set(1, k, 1);
    _qU.copy(_shQ).multiply(arm.upperRest);
    _v.copy(_Y).applyQuaternion(_qU);
    _v2.subVectors(_E, _S).normalize();
    _qU.premultiply(_qSwing.setFromUnitVectors(_v, _v2));
    _mU.compose(_S, _qU, _stretch);

    // Forearm: inherit the upper arm's twist, then bend at the elbow toward the target
    _E.copy(arm.forePos).applyMatrix4(_mU);
    _qF.copy(_qU).multiply(arm.foreRest);
    _v.copy(_Y).applyQuaternion(_qF);
    _v2.copy(_S).addScaledVector(_dir, dc).sub(_E).normalize();
    _qF.premultiply(_qSwing.setFromUnitVectors(_v, _v2));
    _mF.compose(_E, _qF, _stretch);

    // Hand: straight wrist, unstretched
    _W.copy(arm.handPos).applyMatrix4(_mF);
    _qH.copy(_qF).multiply(arm.handRest);
    _mH.compose(_W, _qH, arm.handScale);

    arm.upper.matrix.copy(_mTmp.copy(_shRig).invert().multiply(_mU));
    arm.fore.matrix.copy(_mTmp.copy(_mU).invert().multiply(_mF));
    arm.hand.matrix.copy(_mTmp.copy(_mF).invert().multiply(_mH));
    arm.upper.updateMatrixWorld(true);

    if (writeBack && targetObject.parent) {
      _v.set(0, arm.palm, 0).applyMatrix4(_mH).applyMatrix4(rig.matrixWorld);
      targetObject.position.copy(targetObject.parent.worldToLocal(_v));
    }
  }

  /**
   * World position of the middle of the palm for floating hand `hand` (game labels:
   * 'left' is the anatomical right arm). Valid after animate()/solveArm() this frame.
   */
  getPalmWorldPosition(hand, out = new THREE.Vector3()) {
    const arm = this.arms[hand];
    if (!arm) return out;
    arm.hand.updateMatrixWorld(true);
    return out.set(0, arm.palm, 0).applyMatrix4(arm.hand.matrixWorld);
  }

  /** Fur springs; call after solveArm() so the fur follows the final arm pose. */
  stepFluff(dt) {
    this.fluffy.stepFluff(dt);
  }

  /** Turns the fur shader on/off (e.g. off before fading materials out on death). */
  setFurEnabled(enabled) {
    this.fluffy.setFluffy({ enabled: !!enabled });
  }

  dispose() {
    this.fluffy.dispose();
  }
}

/**
 * Loads (once) and clones the character.
 * @param {object} [opts]
 * @param {number} [opts.targetHeight] world height of the character
 * @param {boolean} [opts.armIK] false: the clips drive the arms (no floating-hand IK)
 * @returns {Promise<{ container: THREE.Group, character: GLBCharacter }>}
 */
export async function createGLBCharacterInstance(opts = {}) {
  const targetHeight = opts.targetHeight ?? glbCharacterConfig.targetHeight;
  const gltf = await getCharacterGLTF();

  const scene = SkeletonUtils.clone(gltf.scene);
  scene.name = 'GLBCharacterScene';
  scene.traverse((obj) => {
    if (obj.isMesh) { obj.castShadow = true; obj.receiveShadow = true; }
  });

  // Normalise height from the bind-pose geometry and stand the feet on y = 0
  scene.updateMatrixWorld(true);
  const box = new THREE.Box3();
  scene.traverse((obj) => {
    if (!obj.isMesh) return;
    if (!obj.geometry.boundingBox) obj.geometry.computeBoundingBox();
    box.union(obj.geometry.boundingBox.clone().applyMatrix4(obj.matrixWorld));
  });
  if (!box.isEmpty()) {
    const height = box.max.y - box.min.y;
    const scale = height > 1e-3 ? targetHeight / height : 1;
    scene.scale.setScalar(scale);
    scene.position.y = -box.min.y * scale;
  }

  const container = new THREE.Group();
  container.name = 'GLBCharacterContainer';
  container.add(scene);

  const character = new GLBCharacter(scene, { armIK: opts.armIK ?? true });
  container.userData.glbCharacter = character;
  return { container, character };
}

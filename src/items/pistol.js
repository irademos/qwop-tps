import * as THREE from 'three';
import { Weapon } from './weapon.js';
import { createBowMesh, setBowDraw, bowNockZ } from './bowModel.js';
import { characterHold } from '../models/glbCharacterModel.js';

// The bow — the weapon that was the gun (item id 'pistol', type 'gun', so the inventory,
// shop, saves and the net are unchanged; its mesh is bowModel.js' bow). It's only in hand
// while its button is held (bootstrapGameApp.js `_bowDraw`): the bow hand (the game's 'left'
// floating hand — the anatomical right arm, labels mirrored) holds it out toward the aim
// point, the other hand draws the string back by `draw` (0 … 1), and the bow points at the
// crosshair (PlayerControls.getBowAimPoint).
//
// Hands, in the holder's model space (× the character's grip — characterHold): the bow hand
// swings on an arc round the shoulder with the aim pitch; the draw hand starts at the string
// and comes back toward the chin.
const BOW_ARM_PIVOT = new THREE.Vector3(-0.05, 0.86, 0.1);
const BOW_ARM_REACH = 0.5;
const DRAW_ANCHOR = new THREE.Vector3(-0.02, 0.9, 0.12); // the chin, at full draw
const AIM_MIN_PITCH = THREE.MathUtils.degToRad(-55);
const AIM_MAX_PITCH = THREE.MathUtils.degToRad(70);
const AIM_SMOOTH = 16;
const BOW_CANT = THREE.MathUtils.degToRad(-10);      // the top limb leaned a little outward

const _aimDir = new THREE.Vector3();
const _aimPoint = new THREE.Vector3();
const _bowPos = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _cant = new THREE.Quaternion();
const _zAxis = new THREE.Vector3(0, 0, 1);
const _up = new THREE.Vector3(0, 1, 0);
const _local = new THREE.Vector3();

export class Pistol extends Weapon {
  constructor(scene) {
    super(scene, {
      itemId: 'pistol',
      type: 'gun',
      fallbackColor: 0x7a5230,
      fallbackSize: new THREE.Vector3(0.04, 0.78, 0.1),
      holdOffset: new THREE.Vector3(0, 0, 0),
      holdRotation: new THREE.Euler(0, 0, 0, 'YXZ')
    });
    this._aimPitch = 0;
    this._lastUpdateMs = 0;
    /** how far the string is drawn (0 … 1), set by the game while the button is held */
    this.draw = 0;
    /** an arrow on the string (false right after loosing one) */
    this.nocked = true;
  }

  /** The bow model (no GLB of its own to load: bowModel.js has it). */
  async load() {
    this.mesh = createBowMesh();
    this.mesh.visible = false;
    this.scene.add(this.mesh);
  }

  _targetAimPitch() {
    const pm = this.holder?.playerModel;
    const point = this.holder?.getBowAimPoint?.(_aimPoint);
    if (pm && point) {
      // (from the shoulder, so a close aim point tips the arm the right way)
      _aimDir.copy(point).sub(pm.localToWorld(_local.copy(BOW_ARM_PIVOT)));
    } else {
      const dir = this.holder?.getAimDirection?.();
      if (!dir) return 0;
      _aimDir.copy(dir);
    }
    if (_aimDir.lengthSq() < 1e-6) return this._aimPitch;
    _aimDir.normalize();
    const pitch = Math.asin(THREE.MathUtils.clamp(_aimDir.y, -1, 1));
    return THREE.MathUtils.clamp(pitch, AIM_MIN_PITCH, AIM_MAX_PITCH);
  }

  /** Where the bow hand holds it (holder's model space) when aiming at `pitch` radians. */
  getGripTarget(out = new THREE.Vector3(), pitch = 0) {
    out.x = BOW_ARM_PIVOT.x;
    out.y = BOW_ARM_PIVOT.y + Math.sin(pitch) * BOW_ARM_REACH;
    out.z = BOW_ARM_PIVOT.z + Math.cos(pitch) * BOW_ARM_REACH;
    return out;
  }

  // The draw hand: on the string at the nock, eased back toward the chin
  _drawHandTarget(out, grip, pitch, draw, scale) {
    // the nock in model space: the bow hand back along the aim by the string's distance
    const back = -bowNockZ(draw) * scale;
    out.set(grip.x, grip.y - Math.sin(pitch) * back, grip.z - Math.cos(pitch) * back);
    // (it ends up nearer the face than the arrow's line: the anchor)
    out.lerp(DRAW_ANCHOR, 0.35 * draw);
    return out;
  }

  update() {
    const pm = this.holder?.playerModel;
    const url = pm?.userData?.qwopRig?.characterUrl;
    const hold = characterHold(url);
    if (pm) {
      const now = performance.now();
      const dt = this._lastUpdateMs ? Math.min(0.1, (now - this._lastUpdateMs) / 1000) : 0;
      this._lastUpdateMs = now;
      const target = this._targetAimPitch();
      this._aimPitch += (target - this._aimPitch) * (dt ? 1 - Math.exp(-AIM_SMOOTH * dt) : 1);

      pm.userData.foamSwordMode = true;
      if (!pm.userData.foamSwordHandTarget) pm.userData.foamSwordHandTarget = { x: 0, y: BOW_ARM_PIVOT.y, z: 0.5 };
      const grip = this.getGripTarget(pm.userData.foamSwordHandTarget, this._aimPitch);
      // (rig hand targets are scaled by the character's grip; the bow by its sword size)
      const scale = hold.sword / Math.max(0.01, hold.grip);
      pm.userData.foamSwordSupport = this._drawHandTarget(
        this._support || (this._support = new THREE.Vector3()), grip, this._aimPitch, this.draw, scale
      );
    } else {
      this._lastUpdateMs = 0;
    }
    super.update();
    if (!pm || !this.mesh) return;
    const activeMesh = this.useHeldMeshWhenHeld && this.heldMesh ? this.heldMesh : this.mesh;
    activeMesh.scale.setScalar(hold.sword);
    // Point the bow at the aim point (+Z of the bow toward it), limbs up, canted a little
    activeMesh.getWorldPosition(_bowPos);
    const point = this.holder?.getBowAimPoint?.(_aimPoint);
    if (point && point.distanceToSquared(_bowPos) > 0.25) {
      _m.lookAt(point, _bowPos, _up);
      _q.setFromRotationMatrix(_m);
    } else {
      _q.copy(pm.quaternion).multiply(_cant.setFromAxisAngle(_aimDir.set(1, 0, 0), -this._aimPitch));
    }
    // (lookAt for a non-camera: +Z toward the target)
    activeMesh.quaternion.copy(_q).multiply(_cant.setFromAxisAngle(_zAxis, BOW_CANT));
    if (activeMesh !== this.mesh) this.mesh.quaternion.copy(activeMesh.quaternion);
    setBowDraw(activeMesh, this.draw, this.nocked);
  }
}

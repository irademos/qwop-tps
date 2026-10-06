import * as THREE from 'three';
import { Weapon } from './weapon.js';

// Gun aim: the hands swing on an arc around the shoulders toward the camera's aim pitch
// (arms raise when aiming up, lower when aiming down) and the gun pitches with them
const GUN_AIM_PIVOT_Y = 0.85;
const GUN_AIM_PIVOT_Z = 0.15;
const GUN_AIM_REACH = 0.47;
const GUN_AIM_MIN_PITCH = THREE.MathUtils.degToRad(-55);
const GUN_AIM_MAX_PITCH = THREE.MathUtils.degToRad(70);
const GUN_AIM_SMOOTH = 14;

const _aimDir = new THREE.Vector3();
const _pitchQuat = new THREE.Quaternion();
const _xAxis = new THREE.Vector3(1, 0, 0);

export class Pistol extends Weapon {
  constructor(scene) {
    super(scene, {
      itemId: 'pistol',
      type: 'gun',
      fallbackColor: 0x222222,
      fallbackSize: new THREE.Vector3(0.12, 0.18, 0.35),
      holdOffset: new THREE.Vector3(0.0, 0.0, 0.0),
      holdRotation: new THREE.Euler(0, Math.PI, 0, 'YXZ')
    });
    this.infiniteAmmo = false;
    this._aimPitch = 0;
    this._lastUpdateMs = 0;
  }

  _targetAimPitch() {
    const dir = this.holder?.getAimDirection?.();
    if (!dir) return 0;
    _aimDir.copy(dir).normalize();
    const pitch = Math.asin(THREE.MathUtils.clamp(_aimDir.y, -1, 1));
    return THREE.MathUtils.clamp(pitch, GUN_AIM_MIN_PITCH, GUN_AIM_MAX_PITCH);
  }

  /** Where both hands hold the gun (holder's model space) when aiming at `pitch` radians. */
  getGripTarget(out = new THREE.Vector3(), pitch = 0) {
    out.x = 0;
    out.y = GUN_AIM_PIVOT_Y + Math.sin(pitch) * GUN_AIM_REACH;
    out.z = GUN_AIM_PIVOT_Z + Math.cos(pitch) * GUN_AIM_REACH;
    return out;
  }

  update() {
    const pm = this.holder?.playerModel;
    if (pm) {
      const now = performance.now();
      const dt = this._lastUpdateMs ? Math.min(0.1, (now - this._lastUpdateMs) / 1000) : 0;
      this._lastUpdateMs = now;
      const target = this._targetAimPitch();
      this._aimPitch += (target - this._aimPitch) * (dt ? 1 - Math.exp(-GUN_AIM_SMOOTH * dt) : 1);

      pm.userData.foamSwordMode = true;
      if (!pm.userData.foamSwordHandTarget) {
        pm.userData.foamSwordHandTarget = { x: 0, y: GUN_AIM_PIVOT_Y, z: 0.6 };
      }
      this.getGripTarget(pm.userData.foamSwordHandTarget, this._aimPitch);
    } else {
      this._lastUpdateMs = 0;
    }
    super.update();
    if (!pm || !this.mesh) return;
    // Point the gun along the aim pitch (player forward is +Z; Rx(-p) tips +Z up toward +Y)
    const activeMesh = this.useHeldMeshWhenHeld && this.heldMesh ? this.heldMesh : this.mesh;
    _pitchQuat.setFromAxisAngle(_xAxis, -this._aimPitch);
    activeMesh.quaternion.copy(pm.quaternion).multiply(_pitchQuat).multiply(this._holdQuaternion);
    if (activeMesh !== this.mesh) this.mesh.quaternion.copy(activeMesh.quaternion);
  }
}

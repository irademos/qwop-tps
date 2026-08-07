import * as THREE from 'three';
import { Weapon } from './weapon.js';

const _swordBaseQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI, 0, 'YXZ'));
const _swordYawQuat = new THREE.Quaternion();
const _swordYawEuler = new THREE.Euler(0, 0, 0, 'YXZ');

export class AutumnSword extends Weapon {
  constructor(scene) {
    super(scene, {
      itemId: 'autumnSword',
      type: 'sword',
      modelUrl: '/assets/props/autumn_sword.glb',
      scale: 2.0,
      holdOffset: new THREE.Vector3(0.75, 0.0, 0.0),
      fallbackSize: new THREE.Vector3(0.1, 0.8, 0.2),
      fallbackColor: 0xe2b14b
    });
  }

  update() {
    if (this.holder?.playerModel) {
      const htd = this.holder.playerModel.userData.handTrackingArms;
      // Tracking slot 'left' = right physical hand (back-camera swap)
      const slot = htd?.left;
      const palmX = slot?.landmarks?.[0]?.x ?? slot?.x ?? 0.5;
      // Map screen X to yaw: center (0.5) → forward, sides → sideways
      // palmX=0 is left side of camera (player's right in back-cam), palmX=1 is right side (player's left)
      // Negate so hand to screen-right (palmX→1) rotates sword to right in screen space
      const sideAmount = (0.5 - palmX) * 2; // -1 when screen-right, +1 when screen-left
      _swordYawEuler.set(0, Math.PI + sideAmount * Math.PI / 2, 0, 'YXZ');
      this._holdQuaternion.setFromEuler(_swordYawEuler);
    }
    super.update();
  }
}

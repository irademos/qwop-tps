import * as THREE from 'three';
import { Weapon } from './weapon.js';

const _pistolDir = new THREE.Vector3();

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
    this.infiniteAmmo = true;
  }

  update() {
    if (window.phoneSwordMode && this.holder?.playerModel) {
      const pm = this.holder.playerModel;
      pm.userData.foamSwordMode = true;
      _pistolDir.set(0, 0, 1).applyQuaternion(this._holdQuaternion);
      if (!pm.userData.foamSwordHandTarget) {
        pm.userData.foamSwordHandTarget = { x: 0, y: 0.85, z: 0.45 };
      }
      const tgt = pm.userData.foamSwordHandTarget;
      tgt.x = THREE.MathUtils.clamp(_pistolDir.x * 0.35, -0.6, 0.6);
      tgt.y = THREE.MathUtils.clamp(0.85 + _pistolDir.y * 0.18, 0.4, 1.3);
      tgt.z = THREE.MathUtils.clamp(0.45 - (_pistolDir.z - 0.2) * 0.14, 0.2, 0.7);
    }
    super.update();
  }
}

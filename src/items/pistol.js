import * as THREE from 'three';
import { Weapon } from './weapon.js';

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
}

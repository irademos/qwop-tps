import * as THREE from 'three';
import { Weapon } from './weapon.js';

export class Bazooka extends Weapon {
  constructor(scene) {
    super(scene, {
      itemId: 'bazooka',
      type: 'bazooka',
      modelUrl: '/assets/props/bazooka.glb',
      scale: 0.22,
      fallbackColor: 0x3f5f3f,
      fallbackSize: new THREE.Vector3(0.9, 0.28, 0.28),
      holdOffset: new THREE.Vector3(-0.08, 0.16, 0.12),
      holdRotation: new THREE.Euler(-Math.PI / 2, Math.PI, 0, 'YXZ')
    });
  }
}

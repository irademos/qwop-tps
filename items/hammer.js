import * as THREE from 'three';
import { Weapon } from './weapon.js';

export class Hammer extends Weapon {
  constructor(scene) {
    super(scene, {
      itemId: 'hammer',
      type: 'hammer',
      hand: 'right',
      modelUrl: '/assets/props/hammer.glb',
      scale: 0.72,
      holdOffset: new THREE.Vector3(0.18, 0.02, 0.04),
      fallbackSize: new THREE.Vector3(0.22, 0.85, 0.32),
      recenterModel: true,
      fallbackColor: 0x8a6a4a
    });
  }
}

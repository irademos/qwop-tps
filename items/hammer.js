import * as THREE from 'three';
import { Weapon } from './weapon.js';

export class Hammer extends Weapon {
  constructor(scene) {
    super(scene, {
      itemId: 'hammer',
      type: 'hammer',
      hand: 'right',
      modelUrl: '/assets/props/hammer.glb',
      scale: 100.0,
      holdOffset: new THREE.Vector3(0.45, -0.05, 0.0),
      fallbackSize: new THREE.Vector3(0.22, 0.85, 0.32),
      fallbackColor: 0x8a6a4a
    });
  }
}

import * as THREE from 'three';
import { Weapon } from './weapon.js';

export class AutumnSword extends Weapon {
  constructor(scene) {
    super(scene, {
      itemId: 'autumnSword',
      type: 'sword',
      modelUrl: '/assets/props/autumn_sword.glb',
      scale: 0.16,
      fallbackSize: new THREE.Vector3(0.1, 0.8, 0.2),
      fallbackColor: 0xe2b14b
    });
  }
}

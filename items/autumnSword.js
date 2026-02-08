import * as THREE from 'three';
import { Weapon } from './weapon.js';

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
}

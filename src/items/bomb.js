import { Weapon } from './weapon.js';

export class Bomb extends Weapon {
  constructor(scene) {
    super(scene, {
      itemId: 'bomb',
      type: 'bomb',
      modelUrl: '/assets/props/bomb.glb',
      scale: 0.85,
      fallbackColor: 0x3b3b3b
    });
  }
}

import { Weapon } from './weapon.js';

export class Bow extends Weapon {
  constructor(scene) {
    super(scene, {
      itemId: 'bow',
      type: 'bow',
      modelUrl: '/assets/props/bow.glb',
      scale: 0.3,
      fallbackColor: 0x8b5a2b
    });
  }
}

import { Weapon } from './weapon.js';

export class IceGun extends Weapon {
  constructor(scene) {
    super(scene, {
      itemId: 'iceGun',
      type: 'gun',
      modelUrl: '/assets/props/ice_gun.glb',
      scale: 0.001,
      fallbackColor: 0x99ccff
    });
  }
}

import { showFeatureLoading } from './loadingState.js';
import { spawnProjectile, updateProjectiles, removeProjectileAt } from '../items/projectiles.js';
import { spawnArrowProjectile } from '../items/arrow.js';
import { ATTACKS, updateMeleeAttacks } from '../items/melee.js';
import { Torch, TORCH_PICKUP_LOCATION } from '../items/torch.js';

let specialWeaponsPromise = null;

export {
  spawnProjectile,
  updateProjectiles,
  removeProjectileAt,
  spawnArrowProjectile,
  ATTACKS,
  updateMeleeAttacks,
  Torch,
  TORCH_PICKUP_LOCATION
};

export async function loadSpecialWeapons() {
  if (!specialWeaponsPromise) {
    const hideLoading = showFeatureLoading('Loading special weapons');
    specialWeaponsPromise = Promise.all([
      import('../items/iceGun.js'),
      import('../items/bow.js'),
      import('../items/lantern.js'),
      import('../items/autumnSword.js'),
      import('../items/hammer.js'),
      import('../items/bomb.js'),
      import('../items/shield.js')
    ]).then(([iceGunModule, bowModule, lanternModule, autumnSwordModule, hammerModule, bombModule, shieldModule]) => ({
      IceGun: iceGunModule.IceGun,
      Bow: bowModule.Bow,
      Lantern: lanternModule.Lantern,
      AutumnSword: autumnSwordModule.AutumnSword,
      Hammer: hammerModule.Hammer,
      Bomb: bombModule.Bomb,
      Shield: shieldModule.Shield,
      SHIELD_ITEM_ID: shieldModule.SHIELD_ITEM_ID,
      DEFAULT_SHIELD_HEALTH: shieldModule.DEFAULT_SHIELD_HEALTH
    })).finally(() => {
      hideLoading();
    });
  }
  return specialWeaponsPromise;
}

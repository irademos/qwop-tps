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
      import('../items/bomb.js')
    ]).then(([iceGunModule, bowModule, lanternModule, autumnSwordModule, bombModule]) => ({
      IceGun: iceGunModule.IceGun,
      Bow: bowModule.Bow,
      Lantern: lanternModule.Lantern,
      AutumnSword: autumnSwordModule.AutumnSword,
      Bomb: bombModule.Bomb
    })).finally(() => {
      hideLoading();
    });
  }
  return specialWeaponsPromise;
}

import { showFeatureLoading } from './loadingState.js';
import { spawnProjectile, updateProjectiles } from '../items/projectiles.js';

let specialWeaponsPromise = null;

export { spawnProjectile, updateProjectiles };

export async function loadSpecialWeapons() {
  if (!specialWeaponsPromise) {
    const hideLoading = showFeatureLoading('Loading weapons');
    specialWeaponsPromise = Promise.all([
      import('../items/shield.js'),
      import('../items/pistol.js'),
      import('../items/foamSword.js')
    ]).then(([shieldModule, pistolModule, foamSwordModule]) => ({
      FoamSword: foamSwordModule.FoamSword,
      FOAM_SWORD_ITEM_ID: foamSwordModule.FOAM_SWORD_ITEM_ID,
      Shield: shieldModule.Shield,
      SHIELD_ITEM_ID: shieldModule.SHIELD_ITEM_ID,
      DEFAULT_SHIELD_HEALTH: shieldModule.DEFAULT_SHIELD_HEALTH,
      Pistol: pistolModule.Pistol
    })).finally(() => {
      hideLoading();
    });
  }
  return specialWeaponsPromise;
}

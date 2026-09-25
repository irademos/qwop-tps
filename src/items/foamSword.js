import * as THREE from 'three';
import { getTerrainHeight } from '../environment/terrainHeight.js';
import { Weapon } from './weapon.js';

export const FOAM_SWORD_ITEM_ID = 'foamSword';

const BLADE_COLOR   = 0x2255dd;
const BLADE_TIP_COLOR = 0x66aaff;
const GUARD_COLOR   = 0xcc2222;
const HANDLE_COLOR  = 0xdd3333;
const POMMEL_COLOR  = 0xaa1111;

// Scratch objects for directional mode (no per-frame allocation)
const _fsSwordDir   = new THREE.Vector3();

// How far the hands spread from center in player-local units at max lateral.
const FS_HAND_SPREAD  = 0.75;
// Vertical range added to the center height when the blade points straight up/down.
const FS_HAND_HEIGHT_GAIN = 0.4;
// Default center position of the hands.
const FS_HAND_CENTER_Y = 0.82;
const FS_HAND_Z        = 0.50;

export class FoamSword extends Weapon {
  constructor(scene) {
    super(scene, {
      itemId: FOAM_SWORD_ITEM_ID,
      type: 'sword',
      hand: 'right',
      scale: 1,
      fallbackColor: BLADE_COLOR,
      holdOffset: new THREE.Vector3(0, 0, 0),
    });
    this._groundOffset = 0.35;
  }

  async load(position = this._defaultPosition) {
    const group = new THREE.Group();
    group.name = 'foam-sword';

    // Blade: thin rod extending in +Z direction (base at z=0, tip at z=0.62)
    const bladeMat = new THREE.MeshStandardMaterial({ color: BLADE_COLOR, roughness: 0.55, metalness: 0.05 });
    const bladeGeo = new THREE.CylinderGeometry(0.022, 0.032, 0.62, 12);
    bladeGeo.rotateX(Math.PI / 2);
    const blade = new THREE.Mesh(bladeGeo, bladeMat);
    blade.position.set(0, 0, 0.31); // center of blade sits 0.31 along +Z
    blade.castShadow = true;
    group.add(blade);

    // Blade tip: small tapered cap
    const tipMat = new THREE.MeshStandardMaterial({ color: BLADE_TIP_COLOR, roughness: 0.5, metalness: 0.05 });
    const tipGeo = new THREE.CylinderGeometry(0, 0.022, 0.07, 10);
    tipGeo.rotateX(Math.PI / 2);
    const tip = new THREE.Mesh(tipGeo, tipMat);
    tip.position.set(0, 0, 0.655);
    tip.castShadow = true;
    group.add(tip);

    // Guard (cross-guard): flat cylinder perpendicular to blade, at z=0
    const guardMat = new THREE.MeshStandardMaterial({ color: GUARD_COLOR, roughness: 0.7, metalness: 0.02 });
    const guardGeo = new THREE.CylinderGeometry(0.11, 0.11, 0.035, 14);
    guardGeo.rotateX(Math.PI / 2); // rotate so circular face is perpendicular to blade (+Z)
    const guard = new THREE.Mesh(guardGeo, guardMat);
    guard.position.set(0, 0, 0);
    guard.castShadow = true;
    group.add(guard);

    // Handle: behind the guard (negative Z direction from attachment point)
    const handleMat = new THREE.MeshStandardMaterial({ color: HANDLE_COLOR, roughness: 0.75, metalness: 0.01 });
    const handleGeo = new THREE.CylinderGeometry(0.028, 0.032, 0.16, 10);
    handleGeo.rotateX(Math.PI / 2);
    const handle = new THREE.Mesh(handleGeo, handleMat);
    handle.position.set(0, 0, -0.08); // extends behind attachment point
    handle.castShadow = true;
    group.add(handle);

    // Pommel: small sphere at the very end of the handle
    const pommelMat = new THREE.MeshStandardMaterial({ color: POMMEL_COLOR, roughness: 0.6, metalness: 0.04 });
    const pommelGeo = new THREE.SphereGeometry(0.038, 10, 8);
    const pommel = new THREE.Mesh(pommelGeo, pommelMat);
    pommel.position.set(0, 0, -0.175);
    pommel.castShadow = true;
    group.add(pommel);

    const targetPos = position.clone();
    const terrainHeight = getTerrainHeight(targetPos.x, targetPos.z);
    targetPos.y = (Number.isFinite(terrainHeight) ? terrainHeight : targetPos.y) + this._groundOffset;
    group.position.copy(targetPos);
    group.userData.hideInMapView = true;

    this.mesh = group;
    this.scene.add(this.mesh);
  }

  update() {
    // The phone-sword gyro loop owns _holdQuaternion; position hands to match where
    // the sword is pointing so they feel like they're gripping the handle at that angle.
    if (this.holder?.playerModel) {
      const pm = this.holder.playerModel;
      pm.userData.foamSwordMode = true;

      // Derive where the blade points (+Z axis of sword in player-local space)
      _fsSwordDir.set(0, 0, 1).applyQuaternion(this._holdQuaternion);

      // Expose for the debug direction HUD
      if (!window.phoneSwordDir) window.phoneSwordDir = { x: 0, y: 0, z: 0 };
      window.phoneSwordDir.x = _fsSwordDir.x;
      window.phoneSwordDir.y = _fsSwordDir.y;
      window.phoneSwordDir.z = _fsSwordDir.z;

      if (!pm.userData.foamSwordHandTarget) {
        pm.userData.foamSwordHandTarget = { x: 0, y: FS_HAND_CENTER_Y, z: FS_HAND_Z };
      }
      const tgt = pm.userData.foamSwordHandTarget;
      const blocking = !!window.phoneSwordGyro?.blocking;
      const blockSign = blocking ? -1 : 1;
      // Lateral: sword right → hands right (inverted + compressed toward center in blocking mode)
      const _blockLatScale = blocking ? (window.phoneSwordSwingCfg?.blockLateralScale ?? 0.3) : 1;
      tgt.x = THREE.MathUtils.clamp(_fsSwordDir.x * FS_HAND_SPREAD * blockSign * _blockLatScale, -1.2, 1.2);
      // Vertical: sword up → hands up (inverted in blocking mode)
      tgt.y = THREE.MathUtils.clamp(FS_HAND_CENTER_Y + _fsSwordDir.y * FS_HAND_HEIGHT_GAIN * blockSign, 0.2, 1.6);
      // Depth: mirrored in blocking mode
      tgt.z = THREE.MathUtils.clamp(FS_HAND_Z - (_fsSwordDir.z - 0.2) * 0.35 * blockSign, 0.15, 0.7);
    }
    super.update();
  }
}

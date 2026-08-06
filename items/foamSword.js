import * as THREE from 'three';
import { getTerrainHeight } from '../environment/terrainHeight.js';
import { Weapon } from './weapon.js';

export const FOAM_SWORD_ITEM_ID = 'foamSword';

const BLADE_COLOR   = 0x2255dd;
const BLADE_TIP_COLOR = 0x66aaff;
const GUARD_COLOR   = 0xcc2222;
const HANDLE_COLOR  = 0xdd3333;
const POMMEL_COLOR  = 0xaa1111;

const _foamYawEuler = new THREE.Euler(0, 0, 0, 'YXZ');

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
    // Leave guard in default CylinderGeometry orientation (Y-axis), no rotation
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
    if (this.holder?.playerModel) {
      const htd = this.holder.playerModel.userData.handTrackingArms;
      // Tracking slot 'left' = right physical hand (back-camera swap)
      const slot = htd?.left;
      const palmX = slot?.landmarks?.[0]?.x ?? slot?.x ?? 0.5;
      // Match autumnSword rotation: center → forward, sides → rotate outward
      const sideAmount = (0.5 - palmX) * 2;
      _foamYawEuler.set(0, Math.PI + sideAmount * Math.PI / 2, 0, 'YXZ');
      this._holdQuaternion.setFromEuler(_foamYawEuler);
    }
    super.update();
  }
}

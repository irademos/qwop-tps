import * as THREE from 'three';
import { getTerrainHeight } from '../environment/terrainHeight.js';
import { Weapon } from './weapon.js';
import { foamSwordConfig } from '../models/handRotationDebug.js';

export const FOAM_SWORD_ITEM_ID = 'foamSword';

const BLADE_COLOR   = 0x2255dd;
const BLADE_TIP_COLOR = 0x66aaff;
const GUARD_COLOR   = 0xcc2222;
const HANDLE_COLOR  = 0xdd3333;
const POMMEL_COLOR  = 0xaa1111;

const _foamEuler = new THREE.Euler(0, 0, 0, 'YXZ');
const DEG = Math.PI / 180;

// Scratch objects for directional mode (no per-frame allocation)
const _fsSwordDir   = new THREE.Vector3();
const _fsq_default  = new THREE.Quaternion();
const _fsq_delta    = new THREE.Quaternion();
const _fsv_default  = new THREE.Vector3();
const _fsv_target   = new THREE.Vector3();
const _fsEulerDef   = new THREE.Euler(0, 0, 0, 'YXZ');

// Normalizer: expected max 2D distance (normalized coords) for a fully lateral finger point.
const FS_MAX_LATERAL  = 0.15;
// How far the hands spread from center in player-local units at max lateral.
const FS_HAND_SPREAD  = 0.75;
// Vertical range added to center height per FS_MAX_LATERAL of upward finger movement.
const FS_HAND_HEIGHT_GAIN = 0.4;
// Default center position of hands in foam sword directional mode.
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
    // In Phone Sword mode: gyro loop owns _holdQuaternion; position hands to match where
    // the sword is pointing so they feel like they're gripping the handle at that angle.
    if (window.phoneSwordMode) {
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
        // Lateral: sword right → hands right, sword left → hands left
        tgt.x = THREE.MathUtils.clamp(_fsSwordDir.x * FS_HAND_SPREAD, -1.2, 1.2);
        // Vertical: sword up → hands up, sword down → hands down
        tgt.y = THREE.MathUtils.clamp(FS_HAND_CENTER_Y + _fsSwordDir.y * FS_HAND_HEIGHT_GAIN, 0.2, 1.6);
        // Depth: sword straight forward (z≈1) → hands extended toward camera (small z);
        // sword tilted away → hands pulled back slightly.
        tgt.z = THREE.MathUtils.clamp(FS_HAND_Z - (_fsSwordDir.z - 0.2) * 0.35, 0.15, 0.7);
      }
      super.update();
      return;
    }
    if (this.holder?.playerModel) {
      const pm = this.holder.playerModel;
      const htd = pm.userData.handTrackingArms;
      // Tracking slot 'left' = right physical hand (back-camera swap)
      const slot = htd?.left;
      const landmarks = slot?.landmarks;

      if (landmarks && landmarks.length >= 9) {
        // --- Directional mode: index finger direction drives position + rotation ---
        const idx5 = landmarks[5]; // index MCP (base of index finger)
        const idx8 = landmarks[8]; // index tip
        // Direction vector in camera normalized space
        const dirX = idx8.x - idx5.x;
        const dirY = idx8.y - idx5.y;

        // Convert to player-local 2D direction.
        // Back camera x is mirrored vs player-local x (camera-left = player-right),
        // same flip used by palmToLocalHandPos: Δlocal_x = -Δcamera_x.
        // Camera y is also inverted: up in camera (neg y) = up in player space.
        const pdx = -dirX; // positive = player's right
        const pdy = -dirY; // positive = player's up

        // Normalize lateral component onto [0,1] range
        const lateralDist = Math.sqrt(pdx * pdx + pdy * pdy);
        const lateralNorm = Math.min(1, lateralDist / FS_MAX_LATERAL);

        // Desired sword direction on the unit hemisphere in player-local space.
        // Small lateralDist (pointing straight out) → (0, 0, 1) = forward.
        // Large lateral component → direction follows the finger.
        let nx = 0, ny = 0, nz = 1;
        if (lateralDist > 0.001) {
          nx = (pdx / lateralDist) * lateralNorm;
          ny = (pdy / lateralDist) * lateralNorm;
          nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
        }

        // Build holdQuaternion: rotate the default "straight out" orientation so
        // the blade points toward (nx, ny, nz).
        _fsEulerDef.set(
          foamSwordConfig.defaultX * DEG,
          foamSwordConfig.defaultY * DEG,
          foamSwordConfig.defaultZ * DEG,
          'YXZ'
        );
        _fsq_default.setFromEuler(_fsEulerDef);
        // Where the blade points (+Z) under the default quaternion
        _fsv_default.set(0, 0, 1).applyQuaternion(_fsq_default);
        _fsv_target.set(nx, ny, nz);
        _fsq_delta.setFromUnitVectors(_fsv_default, _fsv_target);
        // New holdQuaternion preserves the guard orientation of the default, then
        // rotates it to point the blade in the desired direction.
        this._holdQuaternion.copy(_fsq_delta).multiply(_fsq_default);

        // Signal playerModel to override hand positioning and lock bones to rest/fist.
        pm.userData.foamSwordMode = true;
        if (!pm.userData.foamSwordHandTarget) {
          pm.userData.foamSwordHandTarget = { x: 0, y: FS_HAND_CENTER_Y, z: FS_HAND_Z };
        }
        const tgt = pm.userData.foamSwordHandTarget;
        tgt.x = THREE.MathUtils.clamp(pdx * (FS_HAND_SPREAD / FS_MAX_LATERAL), -1.2, 1.2);
        tgt.y = THREE.MathUtils.clamp(FS_HAND_CENTER_Y + pdy * (FS_HAND_HEIGHT_GAIN / FS_MAX_LATERAL), 0.2, 1.6);
        tgt.z = FS_HAND_Z;
      } else {
        // Fallback when no landmarks: use existing palm-position-based rotation
        const palmX = slot?.x ?? 0.5;
        const palmY = slot?.y ?? 0.5;
        const coord = foamSwordConfig.handCoord === 'y' ? palmY : palmX;
        const sign = foamSwordConfig.invert ? -1 : 1;
        const sideAmount = (foamSwordConfig.handCenter - coord) * 2 * sign;
        const ex = (foamSwordConfig.defaultX + sideAmount * foamSwordConfig.gainX + foamSwordConfig.dynOffset) * DEG;
        const ey = (foamSwordConfig.defaultY + sideAmount * foamSwordConfig.gainY) * DEG;
        const ez = (foamSwordConfig.defaultZ + sideAmount * foamSwordConfig.gainZ) * DEG;
        _foamEuler.set(ex, ey, ez, 'YXZ');
        this._holdQuaternion.setFromEuler(_foamEuler);
      }
    }
    super.update();
  }
}

import * as THREE from 'three';

// Sword Showdown magic wand: a procedural wand, built like the swords — origin at the grip,
// pointing along +Z — so the player holds it exactly like the sword (FoamSword's 'wand'
// variant) and wand enemies hold it in their sword group (EnemyPlayer `wand` option).
// The orb on the tip glows (setWandGlow) while a spell charges.

export const WAND_LENGTH = 0.6;                                  // grip → orb centre (m)
export const WAND_TIP_LOCAL = new THREE.Vector3(0, 0, WAND_LENGTH);

const WOOD_COLOR = 0x4a2a17;
const GRIP_COLOR = 0x2b1609;
const GOLD_COLOR = 0xe2b64a;
const ORB_COLOR = 0xb07cff;

let _glowTexture = null;
const glowTexture = () => {
  if (_glowTexture) return _glowTexture;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  _glowTexture = new THREE.CanvasTexture(c);
  _glowTexture.colorSpace = THREE.SRGBColorSpace;
  return _glowTexture;
};

const along = (geometry) => geometry.rotateX(Math.PI / 2); // cylinder axis Y → Z

/** A new wand model (own materials, so each one's orb glows on its own). */
export function createWandModel() {
  const group = new THREE.Group();
  group.name = 'magic-wand';
  const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0.05, ...extra });

  // Grip (behind the hands → just past the top hand), then the shaft tapering to the tip
  const grip = new THREE.Mesh(along(new THREE.CylinderGeometry(0.024, 0.028, 0.2, 10)), std(GRIP_COLOR));
  grip.position.z = -0.02;
  const pommel = new THREE.Mesh(new THREE.SphereGeometry(0.032, 10, 8), std(GOLD_COLOR, { metalness: 0.6, roughness: 0.35 }));
  pommel.position.z = -0.125;
  const shaft = new THREE.Mesh(along(new THREE.CylinderGeometry(0.011, 0.022, WAND_LENGTH - 0.12, 10)), std(WOOD_COLOR));
  shaft.position.z = 0.08 + (WAND_LENGTH - 0.12) / 2;
  group.add(grip, pommel, shaft);
  for (const z of [0.08, WAND_LENGTH - 0.05]) {
    const band = new THREE.Mesh(along(new THREE.CylinderGeometry(0.026, 0.026, 0.022, 12)), std(GOLD_COLOR, { metalness: 0.6, roughness: 0.35 }));
    band.position.z = z;
    band.scale.setScalar(z > 0.3 ? 0.6 : 1);
    group.add(band);
  }

  // Orb + glow halo on the tip
  const orbMat = new THREE.MeshStandardMaterial({ color: ORB_COLOR, emissive: ORB_COLOR, emissiveIntensity: 0.9, roughness: 0.2 });
  const orb = new THREE.Mesh(new THREE.SphereGeometry(0.042, 16, 12), orbMat);
  orb.name = 'wand-orb';
  orb.position.z = WAND_LENGTH;
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTexture(), color: ORB_COLOR, transparent: true, opacity: 0.55,
    blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
  }));
  halo.name = 'wand-halo';
  halo.scale.setScalar(0.2);
  halo.position.z = WAND_LENGTH;
  group.add(orb, halo);
  group.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  // (plain data only: Object3D.clone() deep-copies userData through JSON)
  group.userData.wand = true;
  return group;
}

/**
 * Orb glow: `level` 0 (resting) … 1 (about to cast), tinted toward `color` (the spell's
 * element) as it charges.
 */
const _orbColor = new THREE.Color(ORB_COLOR);
const _tint = new THREE.Color();
export function setWandGlow(model, level = 0, color = null) {
  if (!model?.userData?.wand) return;
  const orb = model.getObjectByName('wand-orb');
  const halo = model.getObjectByName('wand-halo');
  if (!orb || !halo) return;
  const k = THREE.MathUtils.clamp(level, 0, 1);
  _tint.copy(_orbColor);
  if (color) _tint.lerp(color, k);
  orb.material.emissive.copy(_tint);
  orb.material.color.copy(_tint);
  orb.material.emissiveIntensity = 0.9 + k * 2.5;
  halo.material.color.copy(_tint);
  halo.material.opacity = 0.55 + k * 0.45;
  halo.scale.setScalar(0.2 + k * 0.35);
}

/** Frees a wand model's geometries / materials (the glow texture is shared). */
export function disposeWandModel(model) {
  model?.traverse((o) => {
    o.geometry?.dispose?.();
    o.material?.dispose?.();
  });
}

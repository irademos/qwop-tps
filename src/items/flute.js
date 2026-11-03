import * as THREE from 'three';

// Story mode's flute: a procedural wooden recorder-style flute, built like the wand and the
// fishing rod — origin at the mouthpiece (where it meets the lips), the body along +Z to the
// bell. It is held end-on in front of the mouth, pointing forward and down, both hands on the
// tone holes (storyMode.js poses the hands on FLUTE_HAND_AT).

export const FLUTE_LENGTH = 0.34;   // m, mouthpiece tip → bell
// Where the hands go along it (m from the mouthpiece): the top hand, then the bottom hand
export const FLUTE_HAND_AT = Object.freeze([0.15, 0.25]);

const WOOD_COLOR = 0x9a6334;
const WOOD_DARK = 0x5e3519;
const BAND_COLOR = 0xd9c08a;
const HOLE_COLOR = 0x1b0d05;

const along = (geometry) => geometry.rotateX(Math.PI / 2); // cylinder axis Y → Z

/** A new flute model (own materials). */
export function createFluteModel() {
  const group = new THREE.Group();
  group.name = 'flute';
  const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.65, metalness: 0.02, ...extra });
  const wood = std(WOOD_COLOR);
  const dark = std(WOOD_DARK);
  const band = std(BAND_COLOR, { roughness: 0.45, metalness: 0.25 });

  // Mouthpiece: a short tapered beak, flattened on top, with the window (the dark slot) behind it
  const beak = new THREE.Mesh(along(new THREE.CylinderGeometry(0.011, 0.016, 0.05, 12)), dark);
  beak.scale.set(1, 0.7, 1);
  beak.position.z = 0.025;
  const head = new THREE.Mesh(along(new THREE.CylinderGeometry(0.017, 0.017, 0.06, 14)), wood);
  head.position.z = 0.08;
  const windowSlot = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.004, 0.014), std(HOLE_COLOR));
  windowSlot.position.set(0, 0.016, 0.068);
  // Body: a long tapering bore down to the bell
  const bodyLen = FLUTE_LENGTH - 0.15;
  const body = new THREE.Mesh(along(new THREE.CylinderGeometry(0.0145, 0.013, bodyLen, 14)), wood);
  body.position.z = 0.11 + bodyLen / 2;
  const bell = new THREE.Mesh(along(new THREE.CylinderGeometry(0.0135, 0.019, 0.04, 14)), wood);
  bell.position.z = FLUTE_LENGTH - 0.02;
  group.add(beak, head, windowSlot, body, bell);
  // Rings where the joints meet
  for (const z of [0.11, FLUTE_LENGTH - 0.04]) {
    const ring = new THREE.Mesh(along(new THREE.CylinderGeometry(0.0175, 0.0175, 0.008, 14)), band);
    ring.position.z = z;
    group.add(ring);
  }
  // Tone holes along the top (and the thumb hole underneath)
  const holeGeo = along(new THREE.CylinderGeometry(0.0042, 0.0042, 0.004, 8)).rotateX(Math.PI / 2);
  const holeMat = std(HOLE_COLOR);
  const holes = [0.135, 0.158, 0.181, 0.215, 0.238, 0.261, 0.284];
  holes.forEach((z, i) => {
    const hole = new THREE.Mesh(holeGeo, holeMat);
    const r = 0.0145 - (z - 0.11) * 0.006;
    hole.position.set(0, r, z);
    hole.scale.setScalar(i === holes.length - 1 ? 0.8 : 1);
    group.add(hole);
  });
  const thumb = new THREE.Mesh(holeGeo, holeMat);
  thumb.position.set(0, -0.0145, 0.125);
  group.add(thumb);
  group.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  group.userData.flute = true;
  return group;
}

/** Frees a flute model's geometries / materials. */
export function disposeFluteModel(model) {
  model?.traverse((o) => {
    o.geometry?.dispose?.();
    o.material?.dispose?.();
  });
}

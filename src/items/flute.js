import * as THREE from 'three';

// Story mode's flute: a procedural wooden transverse flute (a fife), built like the wand and the
// fishing rod — origin at the embouchure (the hole blown across, held at the lips), the body
// along +Z out to the open end, a short stopped head behind the origin (−Z). The tone holes are
// on top (+Y). It is held sideways out to the player's right, the hands under it on the holes
// (storyMode.js poses the hands on FLUTE_HAND_AT).

export const FLUTE_LENGTH = 0.42;   // m, embouchure → the open end
export const FLUTE_HEAD = 0.06;     // m, the stopped head behind the embouchure
// Where the hands go along it (m from the embouchure): the near hand, then the far hand
export const FLUTE_HAND_AT = Object.freeze([0.15, 0.29]);

const WOOD_COLOR = 0x9a6334;
const WOOD_DARK = 0x6a3d1d;
const BAND_COLOR = 0xd9c08a;
const HOLE_COLOR = 0x1b0d05;
const RADIUS = 0.016;

const along = (geometry) => geometry.rotateX(Math.PI / 2); // cylinder axis Y → Z

/** A new flute model (own materials). */
export function createFluteModel() {
  const group = new THREE.Group();
  group.name = 'flute';
  const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.02, ...extra });
  const wood = std(WOOD_COLOR);
  const dark = std(WOOD_DARK);
  const band = std(BAND_COLOR, { roughness: 0.4, metalness: 0.3 });
  const holeMat = std(HOLE_COLOR);

  // The tube: head (stopped, a little darker) and the body out to the open end
  const tubeLen = FLUTE_LENGTH + FLUTE_HEAD;
  const tube = new THREE.Mesh(along(new THREE.CylinderGeometry(RADIUS, RADIUS * 0.92, tubeLen, 16)), wood);
  tube.position.z = (FLUTE_LENGTH - FLUTE_HEAD) / 2;
  const cap = new THREE.Mesh(new THREE.SphereGeometry(RADIUS * 1.05, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), dark);
  cap.rotation.x = -Math.PI / 2;
  cap.position.z = -FLUTE_HEAD;
  group.add(tube, cap);
  // Rings: by the head, the middle joint and the open end
  for (const z of [-FLUTE_HEAD + 0.012, 0.09, FLUTE_LENGTH - 0.01]) {
    const ring = new THREE.Mesh(along(new THREE.CylinderGeometry(RADIUS * 1.12, RADIUS * 1.12, 0.012, 16)), band);
    ring.position.z = z;
    group.add(ring);
  }
  // The embouchure (oval, a bit bigger) and six tone holes in two groups of three, on top
  const holeGeo = new THREE.CylinderGeometry(1, 1, 0.003, 12);
  const hole = (z, r, sx = 1) => {
    const h = new THREE.Mesh(holeGeo, holeMat);
    h.scale.set(r * sx, 1, r);
    h.position.set(0, RADIUS * 0.98, z);
    group.add(h);
  };
  hole(0, 0.0055, 0.8);
  for (const z of [0.13, 0.155, 0.18, 0.25, 0.275, 0.3]) hole(z, 0.0042);
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

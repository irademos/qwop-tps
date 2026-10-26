import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { stylizeObject } from '../environment/artStyle.js';

// Town's canoe (canoe.glb — "Canoe" by SkyeSladeUT, CC BY 4.0, credits.json). The model is
// 2 units long along Z (±1), 0.43 wide (X), its hull from y −0.14 (the keel) to −0.03 (the
// gunwale amidships, the ends rising to +0.14), seats across it at the gunwale. It is scaled to
// CANOE_LENGTH and lifted so the group's origin sits on the water: the keel just under it, the
// floor inside (where the player stands — CANOE_FLOOR_Y) just over it. Bow = +Z.
export const CANOE_MODEL_URL = '/assets/props/canoe.glb';
export const CANOE_LENGTH = 4.2;                 // m
const MODEL_LENGTH = 2;
const SCALE = CANOE_LENGTH / MODEL_LENGTH;
const MODEL_KEEL_Y = -0.141;
const MODEL_FLOOR_Y = -0.12;                     // the inside of the hull, amidships
const KEEL_DRAFT = 0.02;                         // m of the keel under the water
export const CANOE_HALF_WIDTH = 0.215 * SCALE;   // m, gunwale to the middle
export const CANOE_HALF_LENGTH = CANOE_LENGTH / 2;
export const CANOE_FLOOR_Y = (MODEL_FLOOR_Y - MODEL_KEEL_Y) * SCALE - KEEL_DRAFT; // m over the water

let templatePromise = null;
const loadTemplate = () => {
  if (!templatePromise) {
    templatePromise = new GLTFLoader().loadAsync(CANOE_MODEL_URL)
      .then((gltf) => {
        const root = gltf?.scene || null;
        stylizeObject(root, { materials: false });
        root?.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
        return root;
      })
      .catch((error) => {
        console.warn('Failed to load the canoe.', error);
        templatePromise = null;
        return null;
      });
  }
  return templatePromise;
};

/** The canoe: a group whose origin sits on the water line (the model shows once loaded). */
export function createCanoe() {
  const group = new THREE.Group();
  group.name = 'canoe';
  const holder = new THREE.Group();
  holder.scale.setScalar(SCALE);
  holder.position.y = (-MODEL_KEEL_Y * SCALE) - KEEL_DRAFT;
  group.add(holder);
  loadTemplate().then((template) => { if (template) holder.add(template.clone(true)); });
  return group;
}

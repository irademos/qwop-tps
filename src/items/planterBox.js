// Town's planter box (public/assets/props/planter_box.glb — a long raised bed: a wooden box with
// soil at the top, long along the model's Z). createPlanterBox({ length, width, height }) returns a
// group at once (callers are synchronous) that gets its model as soon as the GLB is in: origin
// on the ground at its middle, long along local X (like the fields' rows), stretched to
// `length` × `height` × `width` m. The soil's top is PLANTER_SOIL_FRAC of the height up
// (planterSoilY). Used by the farmers' fields (townLayout.js) and the boxes the player builds on
// their land (townFarming.js).
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { stylizeObject } from '../environment/artStyle.js';

export const PLANTER_MODEL_URL = '/assets/props/planter_box.glb?v=1';
export const PLANTER_SOIL_FRAC = 0.875;   // the soil's top, of the box's height (the GLB's soil plane)
export const PLANTER_HEIGHT = 0.42;       // m, the default
export const PLANTER_WIDTH = 0.7;         // m, the default
export const planterSoilY = (height = PLANTER_HEIGHT) => height * PLANTER_SOIL_FRAC;

let model = null;       // { object (origin at its bottom centre, long along X), size }
let loading = null;
const waiting = new Set();

export function loadPlanterBox() {
  if (!loading) {
    loading = new GLTFLoader().loadAsync(PLANTER_MODEL_URL).then((gltf) => {
      const root = gltf.scene;
      stylizeObject(root);
      root.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(root);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      const inner = new THREE.Group();
      inner.add(root);
      root.position.sub(new THREE.Vector3(center.x, box.min.y, center.z));
      // (long along X: the model is long along Z)
      const object = new THREE.Group();
      inner.rotation.y = Math.PI / 2;
      object.add(inner);
      object.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      model = { object, size: new THREE.Vector3(size.z, size.y, size.x) };
      for (const g of waiting) fill(g);
      waiting.clear();
      return model;
    });
    loading.catch((err) => {
      console.warn('[planter] planter_box.glb failed to load', err);
      loading = null;
    });
  }
  return loading;
}

function fill(g) {
  if (!model) return;
  const { length, width, height } = g.userData.planter;
  const copy = model.object.clone();
  copy.scale.set(length / (model.size.x || 1), height / (model.size.y || 1), width / (model.size.z || 1));
  g.add(copy);
}

export function createPlanterBox({ length = 3.6, width = PLANTER_WIDTH, height = PLANTER_HEIGHT } = {}) {
  const g = new THREE.Group();
  g.name = 'planter-box';
  g.userData.planter = { length, width, height };
  if (model) fill(g);
  else { waiting.add(g); loadPlanterBox().catch(() => {}); }
  return g;
}

// Town's vegetables: public/assets/props/vegetables.glb ("Collection of Vegetables" by Johan Hoof,
// CC BY 4.0 — credits.json) — one node per vegetable (VEG_KINDS), all on one texture.
// createVeg(kind, length) returns a group at once (callers are synchronous) that gets its model
// as soon as the GLB is in: origin at the bottom centre, sized so its longest side = `length` m.
// It lies the way the pack has it (on its side, long along X). Only Town uses veg.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { stylizeObject } from '../environment/artStyle.js';

export const VEG_MODEL_URL = '/assets/props/vegetables.glb?v=1';
export const VEG_KINDS = ['Carrot', 'Tomato', 'Cucumber', 'Corn', 'Broccoli', 'Pepper'];

let models = null;      // kind → { object (origin at its bottom centre), longest (m) }
let loading = null;
const waiting = new Set();

const _box = new THREE.Box3();
const _size = new THREE.Vector3();
const _center = new THREE.Vector3();

export function loadVegModels() {
  if (!loading) {
    loading = new GLTFLoader().loadAsync(VEG_MODEL_URL).then((gltf) => {
      stylizeObject(gltf.scene);
      gltf.scene.updateMatrixWorld(true);
      const out = {};
      for (const kind of VEG_KINDS) {
        const node = gltf.scene.getObjectByName(kind);
        if (!node) continue;
        const object = new THREE.Group();
        const copy = node.clone();
        object.add(copy);
        object.updateMatrixWorld(true);
        _box.setFromObject(copy);
        _box.getSize(_size);
        _box.getCenter(_center);
        copy.position.sub(new THREE.Vector3(_center.x, _box.min.y, _center.z));
        object.traverse((o) => { if (o.isMesh) { o.castShadow = true; } });
        out[kind] = { object, longest: Math.max(_size.x, _size.y, _size.z) || 1 };
      }
      models = out;
      for (const g of waiting) fill(g);
      waiting.clear();
      return models;
    });
    loading.catch((err) => {
      console.warn('[veg] vegetables.glb failed to load', err);
      loading = null;
    });
  }
  return loading;
}

function fill(g) {
  const m = models?.[g.userData.vegKind];
  if (!m) return;
  const copy = m.object.clone();
  copy.scale.setScalar(g.userData.vegLength / m.longest);
  g.add(copy);
}

// kind: one of VEG_KINDS (a number picks one by index, wrapping); length: its longest side, m
export function createVeg(kind, length = 0.15) {
  if (typeof kind === 'number') kind = VEG_KINDS[((kind % VEG_KINDS.length) + VEG_KINDS.length) % VEG_KINDS.length];
  const g = new THREE.Group();
  g.name = `veg-${kind}`;
  g.userData.vegKind = kind;
  g.userData.vegLength = length;
  if (models) fill(g);
  else { waiting.add(g); loadVegModels().catch(() => {}); }
  return g;
}

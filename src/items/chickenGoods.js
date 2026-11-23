// Town's chicken goods (townChickens.js): an egg (a lathe-turned egg shape) and a drumstick
// (`chicken_meat.glb` — "Chicken leg low poly" by oksanaArthouse, CC-BY 4.0). Both are returned
// at once as a group (the drumstick filled in once its GLB is in), origin at the bottom centre,
// so counters (villageMode.js buildItemMesh 'chicken' / 'egg'), the cart's crates and the
// dropped ones on the ground share them.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { stylizeObject } from '../environment/artStyle.js';

export const CHICKEN_MEAT_MODEL_URL = '/assets/props/chicken_meat.glb?v=1';

// An egg's outline (x = radius, y = height, an egg 1 tall): fuller at the bottom, pointier on top
let eggGeo = null;
const eggGeometry = () => {
  if (eggGeo) return eggGeo;
  const pts = [];
  const N = 18;
  for (let i = 0; i <= N; i++) {
    const t = i / N;                      // 0 bottom … 1 top
    const a = t * Math.PI;
    const r = Math.sin(a) * 0.38 * (1 - 0.18 * t); // (narrower toward the top)
    pts.push(new THREE.Vector2(Math.max(r, 1e-4), (1 - Math.cos(a)) / 2));
  }
  eggGeo = new THREE.LatheGeometry(pts, 20);
  eggGeo.computeVertexNormals();
  return eggGeo;
};
let eggMat = null;
const eggMaterial = () => (eggMat ??= new THREE.MeshStandardMaterial({ color: 0xf1e2c6, roughness: 0.75, metalness: 0 }));

// One egg `height` m tall, standing on its round end (origin at its bottom)
export function createEggMesh(height = 0.08) {
  const m = new THREE.Mesh(eggGeometry(), eggMaterial());
  m.scale.setScalar(height);
  m.castShadow = true;
  return m;
}

// The drumstick's GLB, normalised once: lying flat, `1` long along X, its bottom at y = 0, centred
let meatTemplate = null;
let meatLoading = null;
export function loadChickenMeat() {
  meatLoading ??= new GLTFLoader().loadAsync(CHICKEN_MEAT_MODEL_URL).then((g) => {
    stylizeObject(g.scene);
    const inner = g.scene;
    inner.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(inner);
    const size = box.getSize(new THREE.Vector3());
    const long = Math.max(size.x, size.z, 1e-6);
    const wrap = new THREE.Group();
    // (centred on x / z, its bottom on y = 0)
    const c = box.getCenter(new THREE.Vector3());
    inner.position.x -= c.x;
    inner.position.z -= c.z;
    inner.position.y -= box.min.y;
    const holder = new THREE.Group();
    holder.add(inner);
    // (the long way along X)
    if (size.z > size.x) holder.rotation.y = Math.PI / 2;
    holder.scale.setScalar(1 / long);
    wrap.add(holder);
    wrap.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    meatTemplate = wrap;
    return wrap;
  }).catch((err) => { console.warn('[chickenGoods] chicken_meat.glb failed to load:', err); return null; });
  return meatLoading;
}

// A drumstick `length` m long (filled in when the GLB is in)
export function createChickenMeatMesh(length = 0.22) {
  const g = new THREE.Group();
  const fill = (t) => { if (t) { const c = t.clone(true); c.scale.setScalar(length); g.add(c); } };
  if (meatTemplate) fill(meatTemplate);
  else loadChickenMeat().then(fill);
  return g;
}

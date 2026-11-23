// Town's fish models: `koi_fish.glb` (every fish — the catch on the hook, the counters' / crates'
// fish) and `golden_fish.glb` (the golden fish of the fisher's job — fishingRod.js). Each is
// returned at once as a group, filled in once its GLB is in, so callers needn't wait.
//
// Normalised once per model: `1` long, centred on its middle, lying along +X with its head at
// +X and its back up (+Y). (The GLBs face +Z with their back up once their node's turn is
// applied.)

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { stylizeObject } from '../environment/artStyle.js';

export const KOI_FISH_MODEL_URL = '/assets/props/koi_fish.glb?v=1';
export const GOLDEN_FISH_MODEL_URL = '/assets/props/golden_fish.glb?v=1';

const templates = new Map(); // url → normalised group
const loading = new Map();   // url → promise

function loadFishModel(url, { golden = false } = {}) {
  if (loading.has(url)) return loading.get(url);
  const p = new GLTFLoader().loadAsync(url).then((g) => {
    const inner = g.scene;
    stylizeObject(inner);
    inner.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      // (a gold sheen of its own — there's no environment map for its metal to reflect)
      if (golden) {
        o.material.emissive = new THREE.Color(0x6b4500);
        o.material.emissiveIntensity = 0.55;
        if (o.material.map) o.material.emissiveMap = o.material.map;
        o.material.needsUpdate = true;
      }
      o.castShadow = true;
    });
    inner.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(inner);
    const size = box.getSize(new THREE.Vector3());
    const c = box.getCenter(new THREE.Vector3());
    inner.position.sub(c);
    const holder = new THREE.Group();
    holder.add(inner);
    holder.rotation.y = Math.PI / 2; // (head +Z → +X)
    holder.scale.setScalar(1 / Math.max(size.z, 1e-6));
    const wrap = new THREE.Group();
    wrap.add(holder);
    templates.set(url, wrap);
    return wrap;
  }).catch((err) => { console.warn(`[fishModels] ${url} failed to load:`, err); return null; });
  loading.set(url, p);
  return p;
}

function fishMesh(url, length, opts) {
  const g = new THREE.Group();
  const fill = (t) => { if (t) { const c = t.clone(true); c.scale.setScalar(length); g.add(c); } };
  const t = templates.get(url);
  if (t) fill(t);
  else loadFishModel(url, opts).then(fill);
  return g;
}

/** A koi `length` m long, head +X, back +Y, centred (filled in when the GLB is in). */
export const createKoiFishMesh = (length = 0.25) => fishMesh(KOI_FISH_MODEL_URL, length);

/** The golden fish, `length` m long — the same pose as the koi. */
export const createGoldenFishMesh = (length = 0.25) => fishMesh(GOLDEN_FISH_MODEL_URL, length, { golden: true });

/** Start both loading (e.g. when the rod first comes out). */
export function preloadFishModels() {
  loadFishModel(KOI_FISH_MODEL_URL);
  loadFishModel(GOLDEN_FISH_MODEL_URL, { golden: true });
}

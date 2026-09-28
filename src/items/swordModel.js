import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// The sword GLB (player + enemy swords). Sword convention everywhere else: the
// origin is the grip (hand), the blade points along +Z and the tip is ~0.69 ahead
// (hit checks use that fixed tip, see SWORD_TIP_LOCAL in EnemyPlayer.js).
// ?v= busts browser caches: vercel.json marks /assets/* immutable, so a 404 served
// before the file existed would otherwise stick. Bump it when sword.glb changes.
export const SWORD_MODEL_URL = '/assets/props/sword.glb?v=3';

// Auto-fit: the model's longest axis is turned onto +Z and scaled to this length
// before the debug adjust is applied (0.8: sword.glb's grip lands at the hand and
// its tip near the 0.69 hit tip).
const SWORD_FIT_LENGTH = 0.8;

// The GLB's blade is fully metallic (metalness texture) and the scene has no
// environment map to reflect, so it renders dark: metalness is capped at this.
const SWORD_METALNESS = 0.35;

// Grip → model placement (tuned in game)
const SWORD_GRIP = Object.freeze({
  position: new THREE.Vector3(0, 0, 0.31), // m, sword-local
  rotation: new THREE.Euler(0, Math.PI, 0), // sword.glb's handle is at its +X end
  scale: 1.16,
});

// The base-color texture is added as self-light (emissive) at this intensity
const SWORD_BRIGHTNESS = 1.08;

let _templatePromise = null;
let _template = null;

// Loads sword.glb once. Resolves to a template group (translation stripped, fitted
// to the sword convention) or null when the file is missing/broken.
export function loadSwordModelTemplate() {
  if (_templatePromise) return _templatePromise;
  _templatePromise = new GLTFLoader().loadAsync(SWORD_MODEL_URL)
    .then(gltf => {
      _template = buildTemplate(gltf.scene);
      return _template;
    })
    .catch(error => {
      console.warn('Failed to load sword.glb, keeping the foam sword.', error);
      return null;
    });
  return _templatePromise;
}

function buildTemplate(gltfScene) {
  // Remove the translation baked into the GLB: zero the root node offset (a lone
  // top-level node too — several nodes keep their relative layout), then recenter
  // the geometry bounds on the origin.
  gltfScene.position.set(0, 0, 0);
  if (gltfScene.children.length === 1) gltfScene.children[0].position.set(0, 0, 0);
  gltfScene.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(gltfScene);
  const center = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  gltfScene.position.sub(center);

  gltfScene.traverse(child => {
    if (!child.isMesh) return;
    child.castShadow = true;
    child.receiveShadow = true;
    forEachMaterial(child, mat => {
      if ('metalness' in mat) mat.metalness = Math.min(mat.metalness, SWORD_METALNESS);
      if (mat.emissive && mat.map) {
        mat.emissive.set(0xffffff);
        mat.emissiveMap = mat.map;
        mat.emissiveIntensity = SWORD_BRIGHTNESS;
        mat.needsUpdate = true;
      }
    });
  });

  // Fit: longest axis → +Z, scaled to SWORD_FIT_LENGTH
  const fit = new THREE.Group();
  fit.name = 'sword-glb-fit';
  fit.add(gltfScene);
  const longest = Math.max(size.x, size.y, size.z) || 1;
  if (longest === size.x) fit.rotation.y = -Math.PI / 2;      // +X → +Z
  else if (longest === size.y) fit.rotation.x = Math.PI / 2;  // +Y → +Z
  fit.scale.setScalar(SWORD_FIT_LENGTH / longest);
  return fit;
}

function forEachMaterial(mesh, fn) {
  if (Array.isArray(mesh.material)) mesh.material.forEach(m => m && fn(m));
  else if (mesh.material) fn(mesh.material);
}

// A new sword model instance (grip group → fit → GLB), or null before the GLB has
// loaded. cloneMaterials gives the instance its own materials (enemy hit flash).
export function createSwordModelInstance({ cloneMaterials = false } = {}) {
  if (!_template) return null;
  const grip = new THREE.Group();
  grip.name = 'sword-glb-grip';
  grip.position.copy(SWORD_GRIP.position);
  grip.rotation.copy(SWORD_GRIP.rotation);
  grip.scale.setScalar(SWORD_GRIP.scale);
  const model = _template.clone(true);
  if (cloneMaterials) {
    model.traverse(child => {
      if (!child.isMesh) return;
      child.material = Array.isArray(child.material)
        ? child.material.map(m => m.clone())
        : child.material?.clone();
    });
  }
  grip.add(model);
  return grip;
}

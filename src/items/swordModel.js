import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { isMiiCharacterUrl } from '../models/glbCharacterModel.js';

// The sword GLBs (player + enemy swords). Sword convention everywhere else: the
// origin is the grip (hand), the blade points along +Z and the tip is ~0.69 ahead
// (hit checks use that fixed tip, see SWORD_TIP_LOCAL in EnemyPlayer.js).
// Two variants: 'default' (sword.glb) and 'wii' (wii_sword.glb, held by the armless
// Mii characters — its instances carry two brown ball "hands" on the handle).
// ?v= busts browser caches: vercel.json marks /assets/* immutable, so a 404 served
// before the file existed would otherwise stick. Bump it when a sword GLB changes.
export const SWORD_MODEL_URL = '/assets/props/sword.glb?v=4';
export const WII_SWORD_MODEL_URL = '/assets/props/wii_sword.glb?v=1';

// The GLB's blade is fully metallic (metalness texture) and the scene has no
// environment map to reflect, so it renders dark: metalness is capped at this.
const SWORD_METALNESS = 0.35;

// The base-color texture is added as self-light (emissive) at this intensity
const SWORD_BRIGHTNESS = 1.08;

// Mii hands on the Wii sword: brown balls on the handle (sword-local, around the grip)
const MII_HAND_COLOR = 0x8b5a2b;
const MII_HAND_RADIUS = 0.045; // the handle is ~0.031 thick, ~0.125 long

const SWORD_VARIANTS = {
  default: {
    url: SWORD_MODEL_URL,
    // Auto-fit: the model's longest axis is turned onto +Z and scaled to this length
    // before the grip placement is applied (0.8: sword.glb's grip lands at the hand
    // and its tip near the 0.69 hit tip).
    fitLength: 0.8,
    // Grip → model placement (tuned in game)
    grip: Object.freeze({
      position: new THREE.Vector3(0, 0, 0.32), // m, sword-local
      // sword.glb stands on +Y (blade up), so the fit already points it along +Z;
      // then turned 86° around the blade
      rotation: new THREE.Euler(0, 0, THREE.MathUtils.degToRad(86)),
      scale: 1.16,
    }),
    hands: null,
  },
  wii: {
    url: WII_SWORD_MODEL_URL,
    // wii_sword.glb also stands on +Y. At this length the middle of the handle sits
    // 0.353 behind the model's center and the tip lands ~0.79 ahead of the grip.
    fitLength: 0.865,
    grip: Object.freeze({
      position: new THREE.Vector3(0, 0, 0.353),
      rotation: new THREE.Euler(0, 0, 0),
      scale: 1,
    }),
    // Mii hand balls along the handle (sword-local z), guard-side hand first
    hands: [0.018, -0.03],
  },
};

// Which sword a character holds: the Mii characters (no arms) hold the Wii sword
export function swordVariantForCharacter(characterUrl) {
  return isMiiCharacterUrl(characterUrl) ? 'wii' : 'default';
}

const _templatePromises = new Map(); // variant → Promise<template | null>
const _templates = new Map();        // variant → template

// Loads a sword GLB once. Resolves to a template group (translation stripped, fitted
// to the sword convention) or null when the file is missing/broken.
export function loadSwordModelTemplate(variant = 'default') {
  const cfg = SWORD_VARIANTS[variant] ?? SWORD_VARIANTS.default;
  variant = SWORD_VARIANTS[variant] ? variant : 'default';
  let promise = _templatePromises.get(variant);
  if (promise) return promise;
  promise = new GLTFLoader().loadAsync(cfg.url)
    .then(gltf => {
      const template = buildTemplate(gltf.scene, cfg);
      _templates.set(variant, template);
      return template;
    })
    .catch(error => {
      console.warn(`Failed to load ${cfg.url}, keeping the foam sword.`, error);
      return null;
    });
  _templatePromises.set(variant, promise);
  return promise;
}

// Loads every sword variant (enemy swords are built synchronously from the templates)
export function loadAllSwordModelTemplates() {
  return Promise.all(Object.keys(SWORD_VARIANTS).map(v => loadSwordModelTemplate(v)));
}

function buildTemplate(gltfScene, cfg) {
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

  // Fit: longest axis → +Z, scaled to the variant's fitLength
  const fit = new THREE.Group();
  fit.name = 'sword-glb-fit';
  fit.add(gltfScene);
  const longest = Math.max(size.x, size.y, size.z) || 1;
  if (longest === size.x) fit.rotation.y = -Math.PI / 2;      // +X → +Z
  else if (longest === size.y) fit.rotation.x = Math.PI / 2;  // +Y → +Z
  fit.scale.setScalar(cfg.fitLength / longest);
  return fit;
}

function forEachMaterial(mesh, fn) {
  if (Array.isArray(mesh.material)) mesh.material.forEach(m => m && fn(m));
  else if (mesh.material) fn(mesh.material);
}

// A new sword model instance (sword group → grip group → fit → GLB, plus the Mii hand
// balls for the Wii sword), or null before that variant's GLB has loaded.
// `characterUrl` picks the variant the character holds (swordVariantForCharacter).
// cloneMaterials gives the instance its own materials (enemy hit flash).
export function createSwordModelInstance({ cloneMaterials = false, variant, characterUrl } = {}) {
  variant = variant ?? swordVariantForCharacter(characterUrl);
  const cfg = SWORD_VARIANTS[variant] ?? SWORD_VARIANTS.default;
  const template = _templates.get(SWORD_VARIANTS[variant] ? variant : 'default');
  if (!template) return null;
  const root = new THREE.Group();
  root.name = 'sword-glb';
  root.userData.swordVariant = variant;
  const grip = new THREE.Group();
  grip.name = 'sword-glb-grip';
  grip.position.copy(cfg.grip.position);
  grip.rotation.copy(cfg.grip.rotation);
  grip.scale.setScalar(cfg.grip.scale);
  const model = template.clone(true);
  if (cloneMaterials) {
    model.traverse(child => {
      if (!child.isMesh) return;
      child.material = Array.isArray(child.material)
        ? child.material.map(m => m.clone())
        : child.material?.clone();
    });
  }
  grip.add(model);
  root.add(grip);
  if (cfg.hands) {
    const handMat = new THREE.MeshStandardMaterial({ color: MII_HAND_COLOR, roughness: 0.7, metalness: 0 });
    for (const z of cfg.hands) {
      const hand = new THREE.Mesh(_miiHandGeometry(), handMat);
      hand.name = 'mii-hand';
      hand.position.set(0, 0, z);
      hand.castShadow = true;
      root.add(hand);
    }
  }
  return root;
}

let _miiHandGeo = null;
function _miiHandGeometry() {
  if (!_miiHandGeo) _miiHandGeo = new THREE.SphereGeometry(MII_HAND_RADIUS, 16, 12);
  return _miiHandGeo;
}

// /models/monsterModel.js
import * as THREE from "three";
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { createProceduralBody } from './playerModel.js';

const AUTUMN_SWORD_MODEL_URL = '/assets/props/autumn_sword.glb';
const AUTUMN_SWORD_SCALE = 2.0;
const AUTUMN_SWORD_HOLD_OFFSET = new THREE.Vector3(0.75, 0, 0);
const AUTUMN_SWORD_HOLD_ROTATION = new THREE.Euler(-Math.PI / 2, Math.PI, 0, 'YXZ');
const AUTUMN_SWORD_HOLD_QUATERNION = new THREE.Quaternion().setFromEuler(AUTUMN_SWORD_HOLD_ROTATION);
let autumnSwordTemplatePromise = null;

function findProceduralHand(root, hand = 'right') {
  let match = null;
  const wanted = hand === 'left' ? 'left' : 'right';
  root?.traverse?.((child) => {
    if (match) return;
    const name = String(child.name || '').toLowerCase();
    if (child.userData?.proceduralHand === wanted || name === `${wanted}armhand`) {
      match = child;
    }
  });
  return match;
}

function createFallbackAutumnSword() {
  const group = new THREE.Group();
  group.name = 'monsterAutumnSwordFallback';
  const blade = new THREE.Mesh(
    new THREE.BoxGeometry(0.1, 0.8, 0.2),
    new THREE.MeshStandardMaterial({ color: 0xe2b14b, roughness: 0.45, metalness: 0.35 })
  );
  blade.name = 'autumnSwordBlade';
  blade.castShadow = true;
  blade.receiveShadow = true;
  group.add(blade);
  return group;
}

async function loadAutumnSwordTemplate() {
  if (!autumnSwordTemplatePromise) {
    const loader = new GLTFLoader();
    autumnSwordTemplatePromise = loader.loadAsync(AUTUMN_SWORD_MODEL_URL)
      .then((gltf) => gltf?.scene || createFallbackAutumnSword())
      .catch((error) => {
        console.warn('Failed to load monster autumn sword model, using placeholder.', error);
        return createFallbackAutumnSword();
      });
  }
  return autumnSwordTemplatePromise;
}

function configureSwordMesh(mesh) {
  mesh.name = 'monsterAutumnSword';
  mesh.scale.setScalar(AUTUMN_SWORD_SCALE);
  mesh.position.copy(AUTUMN_SWORD_HOLD_OFFSET);
  mesh.quaternion.copy(AUTUMN_SWORD_HOLD_QUATERNION);
  mesh.traverse?.((child) => {
    if (!child.isMesh) return;
    child.castShadow = true;
    child.receiveShadow = true;
  });
  return mesh;
}

function attachAutumnSword(monsterGroup) {
  const rightHand = findProceduralHand(monsterGroup, 'right');
  if (!rightHand) return;
  const fallback = configureSwordMesh(createFallbackAutumnSword());
  rightHand.add(fallback);
  monsterGroup.userData.equippedWeaponType = 'sword';
  monsterGroup.userData.weaponHitMesh = fallback;
  monsterGroup.userData.weaponHand = 'right';
  monsterGroup.userData.swordHitCooldowns = new Map();

  loadAutumnSwordTemplate().then((template) => {
    if (!rightHand.parent) return;
    const sword = configureSwordMesh(template.clone(true));
    rightHand.remove(fallback);
    rightHand.add(sword);
    monsterGroup.userData.weaponHitMesh = sword;
  });
}

export function loadMonsterModel(modelPath, callback) {
  const monsterGroup = new THREE.Group();
  monsterGroup.name = 'ProceduralQwopMonster';

  const { root: bodyRoot, parts } = createProceduralBody(THREE);
  monsterGroup.add(bodyRoot);
  monsterGroup.userData.pivot = bodyRoot;
  monsterGroup.userData.modelRoot = bodyRoot;
  monsterGroup.userData.monsterConfig = {};
  monsterGroup.userData.qwopRig = {
    parts,
    bodyRoot,
    forwardIntent: 0,
    balance: 0,
    modelPath,
    description: 'Procedural weighted QWOP-style monster body'
  };
  monsterGroup.userData.currentAction = 'Idle';
  monsterGroup.userData.actions = {};
  monsterGroup.userData.mixer = null;
  monsterGroup.userData.updateSkinnedBounds = () => {};
  monsterGroup.userData.itemEquipped = null;
  monsterGroup.userData.equippedWeaponType = null;

  queueMicrotask(() => callback?.({
    model: monsterGroup,
    mixer: null,
    actions: {},
    pivot: bodyRoot,
    modelRoot: bodyRoot,
    monsterConfig: {}
  }));
}

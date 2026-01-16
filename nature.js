import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const TREE_MODEL_URL = '/assets/props/low_poly_tree_pack.glb';
const TREE_SCALE = 0.016; // around 0.012 to 0.02 looks good
const TREE_PREFABS = [
  ['Circle'],                 // Eucalyptus (has multiple meshes under it)
  ['Circle001'],              // Pine
  ['Circle002'],              // Palm
  ['Circle003', 'Circle004'], // Cypress or Larch or Fir (split across 2 sibling nodes)
  ['Circle005'],              // Oak
  ['Circle006'],              // Scary / Dead tree
  ['Circle007']               // Larch or Beech
];

const DEFAULT_OFFSETS = [
  new THREE.Vector3(0, 0, 0),
  new THREE.Vector3(2, 0, 2),
  new THREE.Vector3(-2, 0, 2),
  new THREE.Vector3(4, 0, 4),
  new THREE.Vector3(-4, 0, 4),
  new THREE.Vector3(6, 0, 6),
  new THREE.Vector3(-6, 0, 6),
  new THREE.Vector3(0, 0, 8)
];

const WORLD_UP = new THREE.Vector3(0, 1, 0);

const setTreeShadowing = (tree) => {
  tree.traverse((child) => {
    if (!child.isMesh) return;
    child.castShadow = true;
    child.receiveShadow = true;
  });
};

export async function createNature({ scene, playerModel, getTerrainHeight }) {
  if (!scene || !playerModel) return null;

  const loader = new GLTFLoader();
  let gltf;
  try {
    gltf = await loader.loadAsync(TREE_MODEL_URL);
  } catch (error) {
    console.warn('Failed to load tree pack glb.', error);
    return null;
  }

  gltf.scene.traverse((o) => {
    const indent = '  '.repeat(o.parent ? o.parent.children.indexOf(o) + 1 : 0);
    console.log(`${o.type}: "${o.name || '(no name)'}"`);
  });


  const forward = new THREE.Vector3(0, 0, -1)
    .applyQuaternion(playerModel.quaternion)
    .setY(0)
    .normalize();
  if (forward.lengthSq() < 0.0001) {
    forward.set(0, 0, -1);
  }
  const right = new THREE.Vector3().crossVectors(WORLD_UP, forward).normalize();
  const basePosition = playerModel.position.clone().addScaledVector(forward, 12);

  const group = new THREE.Group();
  group.name = 'nature-group';

  TREE_PREFABS.forEach((parts, i) => {
    const wrapper = new THREE.Group();
    wrapper.name = `tree_${i}`;

    for (const partName of parts) {
      const src = gltf.scene.getObjectByName(partName);
      if (!src) continue;

      const part = src.clone(true);
      setTreeShadowing(part);
      wrapper.add(part);
    }

    wrapper.scale.setScalar(TREE_SCALE);
    const offset = DEFAULT_OFFSETS[i] ?? DEFAULT_OFFSETS[0];
    const position = basePosition.clone()
      .addScaledVector(right, offset.x)
      .addScaledVector(forward, offset.z);

    position.y = 0;
    wrapper.position.copy(position);
    group.add(wrapper);
  });

  scene.add(group);
  return group;
}

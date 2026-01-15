import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const TREE_MODEL_URL = '/assets/props/low_poly_tree_pack.glb';
const TREE_NODE_NAMES = [
  'Circle',
  'Circle.001',
  'Circle.002',
  'Circle.003',
  'Circle.004',
  'Circle.005',
  'Circle.006',
  'Circle.007'
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

  TREE_NODE_NAMES.forEach((name, index) => {
    const source = gltf.scene.getObjectByName(name);
    if (!source) return;

    const tree = source.clone(true);
    setTreeShadowing(tree);

    const offset = DEFAULT_OFFSETS[index] ?? DEFAULT_OFFSETS[0];
    const position = basePosition.clone()
      .addScaledVector(right, offset.x)
      .addScaledVector(forward, offset.z);

    const terrainY = getTerrainHeight?.(position.x, position.z);
    position.y = Number.isFinite(terrainY) ? terrainY : playerModel.position.y;

    tree.position.copy(position);
    group.add(tree);
  });

  scene.add(group);
  return group;
}

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const APPLE_MODEL_URL = '/assets/props/apple.glb';
const APPLE_SCALE = 0.25;
const APPLE_LIFT = 0.25;

export const APPLE_ITEM_ID = 'apple';

const DEFAULT_APPLE_POSITIONS = [
  new THREE.Vector3(1.5, 0, 1.2),
  new THREE.Vector3(-1.2, 0, 0.4)
];

const toVector3 = (position) => {
  if (!position) return null;
  if (position.isVector3) return position.clone();
  if (Array.isArray(position) && position.length >= 3) {
    return new THREE.Vector3(position[0], position[1], position[2]);
  }
  if (Number.isFinite(position.x) && Number.isFinite(position.z)) {
    return new THREE.Vector3(position.x, position.y ?? 0, position.z);
  }
  return null;
};

const setAppleShadows = (apple) => {
  apple.traverse((child) => {
    if (!child.isMesh) return;
    child.castShadow = true;
    child.receiveShadow = true;
  });
};

const cloneApple = (source) => {
  const clone = source.clone(true);
  clone.userData.appleId = APPLE_ITEM_ID;
  clone.userData.itemId = APPLE_ITEM_ID;
  clone.scale.setScalar(APPLE_SCALE);
  setAppleShadows(clone);
  return clone;
};

export async function createApples({
  scene,
  getTerrainHeight,
  spawnPositions = DEFAULT_APPLE_POSITIONS,
  allowDefaultPositions = true
} = {}) {
  if (!scene) return null;

  const loader = new GLTFLoader();
  let gltf;
  try {
    gltf = await loader.loadAsync(APPLE_MODEL_URL);
  } catch (error) {
    console.warn('Failed to load apple glb.', error);
    return null;
  }

  const modelRoot = gltf.scene.getObjectByName('GLTF_SceneRootNode') || gltf.scene;
  const group = new THREE.Group();
  group.name = 'apples-group';
  scene.add(group);

  const pickups = [];
  const positions = Array.isArray(spawnPositions) && spawnPositions.length > 0
    ? spawnPositions
    : (allowDefaultPositions ? DEFAULT_APPLE_POSITIONS : []);

  const createPickupMesh = (position, options = {}) => {
    const spawnPosition = toVector3(position);
    if (!spawnPosition) return null;
    const applyTerrainHeight = options.applyTerrainHeight ?? true;
    if (applyTerrainHeight) {
      const terrainY = getTerrainHeight?.(spawnPosition.x, spawnPosition.z);
      if (Number.isFinite(terrainY)) {
        spawnPosition.y = terrainY;
      }
    }
    const mesh = cloneApple(modelRoot);
    mesh.position.copy(spawnPosition);
    mesh.position.y += options.lift ?? APPLE_LIFT;
    mesh.rotation.y = Math.random() * Math.PI * 2;
    const parent = options.parent ?? group;
    parent.add(mesh);
    return mesh;
  };

  positions.forEach((position) => {
    const mesh = createPickupMesh(position);
    if (!mesh) return;
    pickups.push({ id: APPLE_ITEM_ID, mesh });
  });

  const spawnPickup = (position, options = {}) => {
    if (!position) return null;
    const mesh = createPickupMesh(position, options);
    if (!mesh) return null;
    const pickup = { id: APPLE_ITEM_ID, mesh };
    pickups.push(pickup);
    return pickup;
  };

  const removePickup = (pickup) => {
    if (!pickup) return false;
    const index = pickups.indexOf(pickup);
    if (index === -1) return false;
    pickups.splice(index, 1);
    pickup.mesh?.parent?.remove(pickup.mesh);
    return true;
  };

  return {
    group,
    pickups,
    spawnPickup,
    removePickup
  };
}

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const CABIN_MODEL_URL = '/assets/props/cabin.glb';
const CABIN_POSITION = new THREE.Vector3(6.5, 0, -6.5);

const setCabinShadows = (cabin) => {
  cabin.traverse((child) => {
    if (!child.isMesh) return;
    child.castShadow = true;
    child.receiveShadow = true;
  });
};

export async function createCabin({ scene, getTerrainHeight } = {}) {
  if (!scene) return null;

  const loader = new GLTFLoader();
  let gltf;
  try {
    gltf = await loader.loadAsync(CABIN_MODEL_URL);
  } catch (error) {
    console.warn('Failed to load cabin glb.', error);
    return null;
  }

  const cabin = gltf.scene;
  cabin.name = 'cabin';
  setCabinShadows(cabin);

  const x = CABIN_POSITION.x;
  const z = CABIN_POSITION.z;
  const y = getTerrainHeight?.(x, z) ?? CABIN_POSITION.y;
  cabin.position.set(x, y, z);
  cabin.rotation.y = Math.PI * 0.15;

  scene.add(cabin);
  return cabin;
}

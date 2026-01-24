import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const MUSHROOM_MODEL_URL = '/assets/props/mushrooms.glb';
const MUSHROOM_SCALE = 0.1; // tweak (0.5 = half size)
const MUSHROOM_LIFT = 0.4; // tweak (0.5 = half size)

export const MUSHROOM_ENTRIES = [
  { nodeName: 'Cylinder_0', id: 'mushroom_cylinder_0', name: 'Mushroom 1', lift: 0.25 }, // #12
  { nodeName: 'Cylinder001_1', id: 'mushroom_cylinder_001', name: 'Mushroom 2', lift: 0.4 },  // #10
  { nodeName: 'Cylinder002_2', id: 'mushroom_cylinder_002', name: 'Mushroom 3', lift: 0.15 }, // #5
  { nodeName: 'Cylinder003_3', id: 'mushroom_cylinder_003', name: 'Mushroom 4', lift: 0.35 }, // #9
  { nodeName: 'Cylinder004_4', id: 'mushroom_cylinder_004', name: 'Mushroom 5', lift: 0.3 }, // #8
  { nodeName: 'Cylinder005_5', id: 'mushroom_cylinder_005', name: 'Mushroom 6', lift: 0.3 },  // #6
  { nodeName: 'Cylinder007_6', id: 'mushroom_cylinder_007', name: 'Mushroom 7', lift: 0.4 }, // #7
  { nodeName: 'Cylinder008_7', id: 'mushroom_cylinder_008', name: 'Mushroom 8', lift: 0.7 }, // #3
  { nodeName: 'Cylinder009_8', id: 'mushroom_cylinder_009', name: 'Mushroom 9', lift: 0.31 }, // #4
  { nodeName: 'Cylinder010_9', id: 'mushroom_cylinder_010', name: 'Mushroom 10', lift: 0.4 }, // #2
  { nodeName: 'Cylinder011_10', id: 'mushroom_cylinder_011', name: 'Mushroom 11', lift: 0.31 }, // #1
  { nodeName: 'Cylinder006_11', id: 'mushroom_cylinder_006', name: 'Mushroom 12', lift: 0.24 },  // #11
  { nodeName: 'Cylinder012_12', id: 'mushroom_cylinder_012', name: 'Mushroom 13', lift: 0.2 },  //  #13
  { nodeName: 'Cylinder013_13', id: 'mushroom_cylinder_013', name: 'Mushroom 14', lift: 0.22 }, // #14
  { nodeName: 'Cylinder024_14', id: 'mushroom_cylinder_024', name: 'Mushroom 15', lift: 0.35 } // #15
];

const MUSHROOM_OFFSETS = [
  new THREE.Vector3(-4.5, 0, -2.5),
  new THREE.Vector3(-2.2, 0, 1.2),
  new THREE.Vector3(-1.1, 0, 4.4),
  new THREE.Vector3(2.4, 0, -3.6),
  new THREE.Vector3(3.5, 0, 2.1),
  new THREE.Vector3(4.8, 0, 4.9),
  new THREE.Vector3(-5.6, 0, 3.3),
  new THREE.Vector3(1.6, 0, -5.1),
  new THREE.Vector3(5.2, 0, -1.4),
  new THREE.Vector3(-3.4, 0, -5.4),
  new THREE.Vector3(0.6, 0, 2.6),
  new THREE.Vector3(6.2, 0, 1.1),
  new THREE.Vector3(-6.4, 0, -0.8),
  new THREE.Vector3(2.2, 0, 6.1),
  new THREE.Vector3(-1.8, 0, -6.6)
];

const setMushroomShadows = (mushroom) => {
  mushroom.traverse((child) => {
    if (!child.isMesh) return;
    child.castShadow = true;
    child.receiveShadow = true;
  });
};

const cloneMushroom = (source, itemId) => {
  const clone = source.clone(true);
  clone.userData.mushroomId = itemId;
  clone.userData.itemId = itemId;
  clone.scale.setScalar(MUSHROOM_SCALE);   // <-- add this
  setMushroomShadows(clone);
  return clone;
};

export async function createMushrooms({ scene, getTerrainHeight } = {}) {
  if (!scene) return null;

  const loader = new GLTFLoader();
  let gltf;
  try {
    gltf = await loader.loadAsync(MUSHROOM_MODEL_URL);
  } catch (error) {
    console.warn('Failed to load mushrooms glb.', error);
    return null;
  }

  const modelRoot = gltf.scene.getObjectByName('GLTF_SceneRootNode') || gltf.scene;
  const group = new THREE.Group();
  group.name = 'mushrooms-group';
  scene.add(group);

  const templates = new Map();
  const pickups = [];

  MUSHROOM_ENTRIES.forEach((entry, index) => {
    const source = modelRoot.getObjectByName(entry.nodeName);
    if (!source) {
      console.warn(`Missing mushroom node ${entry.nodeName}.`);
      return;
    }
    source.userData.lift = entry.lift ?? MUSHROOM_LIFT;
    templates.set(entry.id, source);

    const offset = MUSHROOM_OFFSETS[index] || new THREE.Vector3();
    const x = offset.x;
    const z = offset.z;
    const y = getTerrainHeight?.(x, z) ?? 0;

    const mesh = cloneMushroom(source, entry.id);
    mesh.position.set(x, y, z);
    mesh.position.y += entry.lift ?? MUSHROOM_LIFT; // small lift, tune as needed
    mesh.rotation.y = Math.random() * Math.PI * 2;
    group.add(mesh);
    pickups.push({ id: entry.id, mesh });
  });

  const spawnPickup = (itemId, position) => {
    const source = templates.get(itemId);
    if (!source || !position) return null;
    const mesh = cloneMushroom(source, itemId);
    const x = position.x;
    const z = position.z;
    const y = getTerrainHeight?.(x, z) ?? position.y ?? 0;
    mesh.position.set(x, y, z);
    mesh.position.y += source.userData.lift ?? MUSHROOM_LIFT; // small lift, tune as needed
    mesh.rotation.y = Math.random() * Math.PI * 2;
    group.add(mesh);
    const pickup = { id: itemId, mesh };
    pickups.push(pickup);
    return pickup;
  };

  return {
    group,
    pickups,
    spawnPickup
  };
}

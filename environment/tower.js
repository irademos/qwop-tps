import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { setClimbableAreas } from '../controls/climb.js';

const TOWER_MODEL_URL = '/assets/props/tower.glb';
const TOWER_SCALE = 1;
const TOWER_POSITION = new THREE.Vector3(-8, 0, -4);
const TOWER_Y_OFFSET = -1.08;
const TOWER_COLLIDER_SIZE = new THREE.Vector3(6.0, 10.5, 6.0);
const TOWER_CLIMB_AREA_SIZE = {
  widthRatio: 0.15,
  depthRatio: 0.1,
  entryRadius: 0.9,
  entryHeight: 1.4,
  surfaceOffset: -1.5
};
const TOWER_CLIMB_SIDE = 'south';

const setTowerShadows = (tower) => {
  tower.traverse((child) => {
    if (!child.isMesh) return;
    child.castShadow = true;
    child.receiveShadow = true;
  });
};

const resolveSideNormal = (side) => {
  switch (side) {
    case 'west':
      return new THREE.Vector3(-1, 0, 0);
    case 'north':
      return new THREE.Vector3(0, 0, -1);
    case 'south':
      return new THREE.Vector3(0, 0, 1);
    case 'east':
    default:
      return new THREE.Vector3(1, 0, 0);
  }
};

const buildClimbArea = (tower) => {
  const bounds = new THREE.Box3().setFromObject(tower);
  if (!Number.isFinite(bounds.min.y)) return null;

  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  const minY = bounds.min.y;
  const maxY = bounds.max.y;

  const halfHeight = (maxY - minY) * 0.5;
  const halfWidth = (size.x * TOWER_CLIMB_AREA_SIZE.widthRatio) * 0.5;
  const halfDepth = (size.z * TOWER_CLIMB_AREA_SIZE.depthRatio) * 0.5;

  const normal = resolveSideNormal(TOWER_CLIMB_SIDE);
  const rotationY = Math.atan2(normal.x, normal.z);
  const sideExtent = (Math.abs(normal.x) > 0.5 ? size.x : size.z) * 0.5;

  const areaCenter = center.clone();
  areaCenter.y = (minY + maxY) * 0.5;
  areaCenter.addScaledVector(normal, sideExtent + halfDepth + TOWER_CLIMB_AREA_SIZE.surfaceOffset);

  const entryCenter = areaCenter.clone();
  entryCenter.y = minY + TOWER_CLIMB_AREA_SIZE.entryHeight * 0.5;

  return {
    center: areaCenter,
    rotationY,
    halfWidth,
    halfDepth,
    halfHeight,
    minY,
    maxY,
    entryCenter,
    entryRadius: TOWER_CLIMB_AREA_SIZE.entryRadius,
    entryHeight: TOWER_CLIMB_AREA_SIZE.entryHeight,
    normal
  };
};

const addTowerCollider = ({ tower, rapierWorld, rapier }) => {
  if (!tower || !rapierWorld || !rapier) return null;
  const bounds = new THREE.Box3().setFromObject(tower);
  if (!Number.isFinite(bounds.min.y)) return null;

  const center = bounds.getCenter(new THREE.Vector3());
  const halfSize = TOWER_COLLIDER_SIZE.clone().multiplyScalar(0.5);
  const colliderCenter = new THREE.Vector3(
    center.x,
    bounds.min.y + halfSize.y,
    center.z
  );

  const rbDesc = rapier.RigidBodyDesc.fixed()
    .setTranslation(colliderCenter.x, colliderCenter.y, colliderCenter.z);
  const rb = rapierWorld.createRigidBody(rbDesc);

  const colDesc = rapier.ColliderDesc.cuboid(halfSize.x, halfSize.y, halfSize.z)
    .setRestitution(0)
    .setFriction(1);
  rapierWorld.createCollider(colDesc, rb);
  return rb;
};

export async function createTower({ scene, getTerrainHeight, rapierWorld, rapier } = {}) {
  if (!scene) return null;

  const loader = new GLTFLoader();
  let gltf;
  try {
    gltf = await loader.loadAsync(TOWER_MODEL_URL);
  } catch (error) {
    console.warn('Failed to load tower glb.', error);
    return null;
  }

  const tower = gltf.scene;
  tower.name = 'tower';
  setTowerShadows(tower);
  tower.scale.setScalar(TOWER_SCALE);

  const x = TOWER_POSITION.x;
  const z = TOWER_POSITION.z;
  const y = getTerrainHeight?.(x, z) + TOWER_Y_OFFSET ?? TOWER_POSITION.y;
  tower.position.set(x, y, z);

  tower.updateWorldMatrix(true, true);
  const climbArea = buildClimbArea(tower);
  if (climbArea) {
    setClimbableAreas('tower', [climbArea]);
  }

  addTowerCollider({ tower, rapierWorld, rapier });

  scene.add(tower);
  return tower;
}

export {
  TOWER_CLIMB_AREA_SIZE,
  TOWER_CLIMB_SIDE,
  TOWER_COLLIDER_SIZE,
  TOWER_POSITION,
  TOWER_SCALE
};

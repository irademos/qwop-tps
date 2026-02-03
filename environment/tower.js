import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { setClimbableAreas } from '../controls/climb.js';

const TOWER_MODEL_URL = '/assets/props/tower.glb';
const TOWER_SCALE = 1;
const TOWER_POSITION = new THREE.Vector3(4, 0, -2);
const TOWER_CLIMB_AREA_SIZE = {
  widthRatio: 0.5,
  depthRatio: 0.25,
  entryRadius: 0.9,
  entryHeight: 1.4,
  surfaceOffset: 0.05
};
const TOWER_CLIMB_SIDE = 'east';

const debugMaterial = new THREE.LineBasicMaterial({ color: 0xffff00 });

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

const addClimbDebugLines = (area, parent) => {
  if (!area || !parent) return;
  const width = (area.halfWidth ?? 0) * 2;
  const height = (area.halfHeight ?? 0) * 2;
  const depth = (area.halfDepth ?? 0) * 2;
  if (width <= 0 || height <= 0 || depth <= 0) return;
  const geometry = new THREE.BoxGeometry(width, height, depth);
  const edges = new THREE.EdgesGeometry(geometry);
  const lines = new THREE.LineSegments(edges, debugMaterial);
  lines.position.copy(area.center);
  lines.rotation.y = area.rotationY ?? 0;
  parent.add(lines);
};

export async function createTower({ scene, getTerrainHeight } = {}) {
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
  const y = getTerrainHeight?.(x, z) ?? TOWER_POSITION.y;
  tower.position.set(x, y, z);

  tower.updateWorldMatrix(true, true);
  const climbArea = buildClimbArea(tower);
  if (climbArea) {
    setClimbableAreas('tower', [climbArea]);
    const debugGroup = new THREE.Group();
    debugGroup.name = 'tower-climb-debug';
    addClimbDebugLines(climbArea, debugGroup);
    tower.add(debugGroup);
  }

  scene.add(tower);
  return tower;
}

export {
  TOWER_CLIMB_AREA_SIZE,
  TOWER_CLIMB_SIDE,
  TOWER_POSITION,
  TOWER_SCALE
};

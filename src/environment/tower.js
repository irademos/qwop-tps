import * as THREE from 'three';
import { setClimbableAreas } from '../controls/climb.js';

const TOWER_POSITION = new THREE.Vector3(96, 0, -72);
const TOWER_HEIGHT = 38;
const TOWER_RADIUS = 6.5;
const CORE_RADIUS = 2.2;
const PLATFORM_RADIUS = 7.8;
const STAIR_WIDTH = 1.4;
const STAIR_THICKNESS = 0.24;
const STAIR_RISE = 0.55;
const SPIRAL_TURNS = 7;
const TOWER_FENCE_HEIGHT = 1.2;
const TOWER_FENCE_THICKNESS = 0.7;
const TOWER_COLLIDER_SIZE = new THREE.Vector3(11.5, 19.5, 11.5);
const TOWER_CLIMB_AREA_SIZE = {
  widthRatio: 0.2,
  depthRatio: 0.15,
  entryRadius: 1.3,
  entryHeight: 1.5,
  surfaceOffset: -1.6
};
const TOWER_CLIMB_SIDE = 'south';

const setTowerShadows = (tower) => {
  tower.traverse((child) => {
    if (!child.isMesh) return;
    child.castShadow = true;
    child.receiveShadow = true;
  });
};

const makeSwirlColumn = (color, phase) => {
  const points = [];
  const steps = 160;
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const angle = phase + t * Math.PI * 2 * SPIRAL_TURNS;
    const y = t * TOWER_HEIGHT;
    points.push(new THREE.Vector3(Math.cos(angle) * (TOWER_RADIUS - 0.6), y, Math.sin(angle) * (TOWER_RADIUS - 0.6)));
  }
  const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
  const geometry = new THREE.TubeGeometry(curve, steps, 0.5, 12, false);
  const material = new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.1, emissive: color, emissiveIntensity: 0.08 });
  return new THREE.Mesh(geometry, material);
};

const createGeneratedTower = () => {
  const tower = new THREE.Group();
  tower.name = 'generated-swirl-tower';
  

  const core = new THREE.Mesh(
    new THREE.CylinderGeometry(CORE_RADIUS, CORE_RADIUS + 0.6, TOWER_HEIGHT, 36, 1, false),
    new THREE.MeshStandardMaterial({ color: 0x1f1f2a, roughness: 0.65, metalness: 0.2 })
  );
  core.position.y = TOWER_HEIGHT * 0.5;
  tower.add(core);

  tower.add(makeSwirlColumn(0xff2b2b, 0));
  tower.add(makeSwirlColumn(0x2a64ff, (Math.PI * 2) / 3));
  tower.add(makeSwirlColumn(0xffe548, (Math.PI * 4) / 3));

  const stairCount = Math.floor(TOWER_HEIGHT / STAIR_RISE);
  const stairMaterial = new THREE.MeshStandardMaterial({ color: 0x8f98ad, roughness: 0.75, metalness: 0.15 });
  const stepGeometry = new THREE.BoxGeometry(STAIR_WIDTH, STAIR_THICKNESS, 1.8);
  const stairMeshes = [];
  for (let i = 0; i < stairCount; i += 1) {
    const step = new THREE.Mesh(stepGeometry, stairMaterial);
    const t = i / stairCount;
    const angle = t * Math.PI * 2 * SPIRAL_TURNS;
    const radius = TOWER_RADIUS + 1.2;
    step.position.set(
      Math.cos(angle) * radius,
      0.9 + (i * STAIR_RISE),
      Math.sin(angle) * radius
    );
    step.rotation.y = angle + Math.PI * 0.5;
    tower.add(step);
    stairMeshes.push(step);
  }
  tower.userData.stairMeshes = stairMeshes;

  const topPlatform = new THREE.Mesh(
    new THREE.CylinderGeometry(PLATFORM_RADIUS, PLATFORM_RADIUS + 0.7, 1.2, 40),
    new THREE.MeshStandardMaterial({ color: 0x2f3745, roughness: 0.55, metalness: 0.25 })
  );
  topPlatform.position.y = TOWER_HEIGHT + 0.8;
  tower.add(topPlatform);

  const rail = new THREE.Mesh(
    new THREE.TorusGeometry(PLATFORM_RADIUS - 0.4, 0.22, 12, 70),
    new THREE.MeshStandardMaterial({ color: 0xe8edf5, roughness: 0.25, metalness: 0.55 })
  );
  rail.rotation.x = Math.PI * 0.5;
  rail.position.y = TOWER_HEIGHT + 1.6;
  tower.add(rail);

  setTowerShadows(tower);
  return tower;
};

const resolveSideNormal = (side) => {
  switch (side) {
    case 'west': return new THREE.Vector3(-1, 0, 0);
    case 'north': return new THREE.Vector3(0, 0, -1);
    case 'south': return new THREE.Vector3(0, 0, 1);
    case 'east':
    default: return new THREE.Vector3(1, 0, 0);
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
  return { center: areaCenter, rotationY, halfWidth, halfDepth, halfHeight, minY, maxY, entryCenter, entryRadius: TOWER_CLIMB_AREA_SIZE.entryRadius, entryHeight: TOWER_CLIMB_AREA_SIZE.entryHeight, normal };
};

const addTowerCollider = ({ tower, rapierWorld, rapier }) => {
  if (!tower || !rapierWorld || !rapier) return null;
  const bounds = new THREE.Box3().setFromObject(tower);
  if (!Number.isFinite(bounds.min.y)) return null;
  const center = bounds.getCenter(new THREE.Vector3());
  const halfSize = TOWER_COLLIDER_SIZE.clone().multiplyScalar(0.5);
  const colliderCenter = new THREE.Vector3(center.x, bounds.min.y + halfSize.y, center.z);
  const fenceCenterY = bounds.min.y + TOWER_COLLIDER_SIZE.y + (TOWER_FENCE_HEIGHT * 0.5);
  const rbDesc = rapier.RigidBodyDesc.fixed().setTranslation(colliderCenter.x, colliderCenter.y, colliderCenter.z);
  const rb = rapierWorld.createRigidBody(rbDesc);
  rapierWorld.createCollider(rapier.ColliderDesc.cuboid(halfSize.x, halfSize.y, halfSize.z).setRestitution(0).setFriction(1), rb);
  const fenceHalfHeight = TOWER_FENCE_HEIGHT * 0.5;
  const fenceHalfThickness = TOWER_FENCE_THICKNESS * 0.5;
  const fenceOffsets = [
    new THREE.Vector3(center.x, fenceCenterY, center.z + halfSize.z + fenceHalfThickness),
    new THREE.Vector3(center.x, fenceCenterY, center.z - halfSize.z - fenceHalfThickness),
    new THREE.Vector3(center.x + halfSize.x + fenceHalfThickness, fenceCenterY, center.z),
    new THREE.Vector3(center.x - halfSize.x - fenceHalfThickness, fenceCenterY, center.z)
  ];
  const fenceSizes = [
    new THREE.Vector3(halfSize.x, fenceHalfHeight, fenceHalfThickness),
    new THREE.Vector3(halfSize.x, fenceHalfHeight, fenceHalfThickness),
    new THREE.Vector3(fenceHalfThickness, fenceHalfHeight, halfSize.z),
    new THREE.Vector3(fenceHalfThickness, fenceHalfHeight, halfSize.z)
  ];
  fenceOffsets.forEach((offset, index) => {
    const fenceSize = fenceSizes[index];
    const localOffset = offset.clone().sub(colliderCenter);
    const fenceDesc = rapier.ColliderDesc.cuboid(fenceSize.x, fenceSize.y, fenceSize.z)
      .setTranslation(localOffset.x, localOffset.y, localOffset.z)
      .setRestitution(0)
      .setFriction(1);
    rapierWorld.createCollider(fenceDesc, rb);
  });
  return rb;
};

const addTowerStairColliders = ({ stairMeshes, rapierWorld, rapier }) => {
  if (!stairMeshes || !rapierWorld || !rapier) return;

  stairMeshes.forEach((step) => {
    step.updateWorldMatrix(true, false);

    const worldPos = new THREE.Vector3();
    const worldQuat = new THREE.Quaternion();

    step.getWorldPosition(worldPos);
    step.getWorldQuaternion(worldQuat);

    const rb = rapierWorld.createRigidBody(
      rapier.RigidBodyDesc.fixed()
        .setTranslation(worldPos.x, worldPos.y, worldPos.z)
        .setRotation(worldQuat)
    );

    const collider = rapier.ColliderDesc.cuboid(
      STAIR_WIDTH * 0.5,
      STAIR_THICKNESS * 0.5,
      0.9 // half of step depth (1.8)
    )
      .setFriction(1.2)
      .setRestitution(0);

    rapierWorld.createCollider(collider, rb);
  });
};

export async function createTower({ scene, getTerrainHeight, rapierWorld, rapier } = {}) {
  if (!scene) return null;
  const tower = createGeneratedTower();
  const x = TOWER_POSITION.x;
  const z = TOWER_POSITION.z;
  const terrainY = getTerrainHeight?.(x, z);
  const y = Number.isFinite(terrainY) ? terrainY : TOWER_POSITION.y;
  tower.position.set(x, y, z);
  tower.updateWorldMatrix(true, true);
  tower.position.set(x, y, z);
  tower.updateWorldMatrix(true, true);

  addTowerStairColliders({
    stairMeshes: tower.userData.stairMeshes,
    rapierWorld,
    rapier
  });
  // const climbArea = buildClimbArea(tower);
  // if (climbArea) setClimbableAreas('tower', [climbArea]);
  // addTowerCollider({ tower, rapierWorld, rapier });
  scene.add(tower);
  return tower;
}

export { TOWER_CLIMB_AREA_SIZE, TOWER_CLIMB_SIDE, TOWER_COLLIDER_SIZE, TOWER_POSITION };

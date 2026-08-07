import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const MUSHROOM_MODEL_URL = '/assets/props/mushrooms.glb';
const MUSHROOM_SCALE = 0.1; // tweak (0.5 = half size)
const MUSHROOM_LIFT = 0.4; // tweak (0.5 = half size)
const DEFAULT_MUSHROOM_SPAWN_RADIUS = 225;
const DEFAULT_MUSHROOMS_PER_VARIANT = 10;
const MUSHROOM_SHADOWS_ENABLED = false;

export const MUSHROOM_ENTRIES = [
  { nodeName: 'Cylinder_0', id: 'mushroom_cylinder_0', name: 'Mushroom 1', lift: 0.25, icon_name: 'mushroom12' }, // #12
  { nodeName: 'Cylinder001_1', id: 'mushroom_cylinder_001', name: 'Mushroom 2', lift: 0.4, icon_name: 'mushroom10' },  // #10
  { nodeName: 'Cylinder002_2', id: 'mushroom_cylinder_002', name: 'Mushroom 3', lift: 0.15, icon_name: 'mushroom5' }, // #5
  { nodeName: 'Cylinder003_3', id: 'mushroom_cylinder_003', name: 'Mushroom 4', lift: 0.35, icon_name: 'mushroom9' }, // #9
  { nodeName: 'Cylinder004_4', id: 'mushroom_cylinder_004', name: 'Mushroom 5', lift: 0.3, icon_name: 'mushroom8' }, // #8
  { nodeName: 'Cylinder005_5', id: 'mushroom_cylinder_005', name: 'Mushroom 6', lift: 0.3, icon_name: 'mushroom6' },  // #6
  { nodeName: 'Cylinder007_6', id: 'mushroom_cylinder_007', name: 'Mushroom 7', lift: 0.4, icon_name: 'mushroom7' }, // #7
  { nodeName: 'Cylinder008_7', id: 'mushroom_cylinder_008', name: 'Mushroom 8', lift: 0.7, icon_name: 'mushroom3' }, // #3
  { nodeName: 'Cylinder009_8', id: 'mushroom_cylinder_009', name: 'Mushroom 9', lift: 0.31, icon_name: 'mushroom4' }, // #4
  { nodeName: 'Cylinder010_9', id: 'mushroom_cylinder_010', name: 'Mushroom 10', lift: 0.4, icon_name: 'mushroom2' }, // #2
  { nodeName: 'Cylinder011_10', id: 'mushroom_cylinder_011', name: 'Mushroom 11', lift: 0.31, icon_name: 'mushroom1' }, // #1
  { nodeName: 'Cylinder006_11', id: 'mushroom_cylinder_006', name: 'Mushroom 12', lift: 0.24, icon_name: 'mushroom11' },  // #11
  { nodeName: 'Cylinder012_12', id: 'mushroom_cylinder_012', name: 'Mushroom 13', lift: 0.2, icon_name: 'mushroom13' },  //  #13
  { nodeName: 'Cylinder013_13', id: 'mushroom_cylinder_013', name: 'Mushroom 14', lift: 0.22, icon_name: 'mushroom14' }, // #14
  { nodeName: 'Cylinder024_14', id: 'mushroom_cylinder_024', name: 'Mushroom 15', lift: 0.35, icon_name: 'mushroom15' } // #15
];

const getRandomScatterPosition = (center, radius) => {
  if (!center) return null;
  const distance = radius * Math.sqrt(Math.random());
  const angle = Math.random() * Math.PI * 2;
  return new THREE.Vector3(
    center.x + Math.cos(angle) * distance,
    0,
    center.z + Math.sin(angle) * distance
  );
};

const setMushroomShadows = (mushroom, enabled = MUSHROOM_SHADOWS_ENABLED) => {
  mushroom.traverse((child) => {
    if (!child.isMesh) return;
    child.castShadow = Boolean(enabled);
    child.receiveShadow = Boolean(enabled);
  });
};

const getTemplateMesh = (source) => {
  if (!source) return null;
  if (source.isMesh) return source;
  let templateMesh = null;
  source.traverse((child) => {
    if (templateMesh || !child.isMesh) return;
    templateMesh = child;
  });
  return templateMesh;
};

const getTemplateLocalMatrix = (source, templateMesh) => {
  if (!source || !templateMesh) return new THREE.Matrix4();
  source.updateWorldMatrix(true, true);
  templateMesh.updateWorldMatrix(true, false);
  const sourceWorldInverse = new THREE.Matrix4().copy(source.matrixWorld).invert();
  return new THREE.Matrix4().multiplyMatrices(sourceWorldInverse, templateMesh.matrixWorld);
};

const applyRootTransformToMatrix = ({
  targetMatrix,
  rootPosition,
  rootRotationY,
  templateLocalMatrix,
  rootScale = MUSHROOM_SCALE
}) => {
  const rootMatrix = new THREE.Matrix4();
  const rootQuaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rootRotationY || 0, 0));
  const rootScaleVector = new THREE.Vector3(rootScale, rootScale, rootScale);
  rootMatrix.compose(rootPosition, rootQuaternion, rootScaleVector);
  targetMatrix.multiplyMatrices(rootMatrix, templateLocalMatrix || new THREE.Matrix4());
  return targetMatrix;
};

const createSharedMeshInstance = (templateMesh, itemId) => {
  if (!templateMesh?.geometry || !templateMesh?.material) return null;
  const mesh = new THREE.Mesh(templateMesh.geometry, templateMesh.material);
  mesh.userData.mushroomId = itemId;
  mesh.userData.itemId = itemId;
  mesh.scale.setScalar(MUSHROOM_SCALE);
  setMushroomShadows(mesh);
  return mesh;
};

export async function createMushrooms({
  scene,
  getTerrainHeight,
  scatterCenter,
  scatterRadius = DEFAULT_MUSHROOM_SPAWN_RADIUS
} = {}) {
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
  const variantBuckets = new Map();
  const variantInstancedMeshes = new Map();
  const pickups = [];

  const registerPickup = (pickup) => {
    pickups.push(pickup);
    return pickup;
  };

  MUSHROOM_ENTRIES.forEach((entry) => {
    const source = modelRoot.getObjectByName(entry.nodeName);
    if (!source) {
      console.warn(`Missing mushroom node ${entry.nodeName}.`);
      return;
    }
    const templateMesh = getTemplateMesh(source);
    if (!templateMesh) {
      console.warn(`Missing mesh for mushroom node ${entry.nodeName}.`);
      return;
    }
    templates.set(entry.id, {
      mesh: templateMesh,
      localMatrix: getTemplateLocalMatrix(source, templateMesh),
      lift: entry.lift ?? MUSHROOM_LIFT
    });

    const spawnCount = Number.isFinite(entry.spawnCount)
      ? Math.max(1, Math.round(entry.spawnCount))
      : DEFAULT_MUSHROOMS_PER_VARIANT;

    for (let i = 0; i < spawnCount; i += 1) {
      let spawnPosition = null;
      let attempts = 0;
      while (!spawnPosition && attempts < 8) {
        attempts += 1;
        const candidate = getRandomScatterPosition(scatterCenter, scatterRadius);
        if (!candidate) break;
        const terrainHeight = getTerrainHeight?.(candidate.x, candidate.z);
        if (!Number.isFinite(terrainHeight)) continue;
        candidate.y = terrainHeight;
        spawnPosition = candidate;
      }
      if (!spawnPosition) continue;

      const pickup = {
        id: entry.id,
        position: spawnPosition.clone(),
        rotationY: Math.random() * Math.PI * 2,
        active: true,
        type: 'instanced'
      };
      pickup.position.y += entry.lift ?? MUSHROOM_LIFT;

      if (!variantBuckets.has(entry.id)) {
        variantBuckets.set(entry.id, []);
      }
      variantBuckets.get(entry.id).push(pickup);
      registerPickup(pickup);
    }
  });

  const tempMatrix = new THREE.Matrix4();
  const tempPosition = new THREE.Vector3();

  variantBuckets.forEach((bucket, itemId) => {
    const template = templates.get(itemId);
    if (!template?.mesh || bucket.length === 0) return;
    const instancedMesh = new THREE.InstancedMesh(template.mesh.geometry, template.mesh.material, bucket.length);
    instancedMesh.name = `mushroom-instanced-${itemId}`;
    instancedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    instancedMesh.castShadow = false;
    instancedMesh.receiveShadow = false;
    instancedMesh.frustumCulled = false;

    bucket.forEach((pickup, index) => {
      tempPosition.copy(pickup.position);
      applyRootTransformToMatrix({
        targetMatrix: tempMatrix,
        rootPosition: tempPosition,
        rootRotationY: pickup.rotationY,
        templateLocalMatrix: template.localMatrix,
        rootScale: MUSHROOM_SCALE
      });
      instancedMesh.setMatrixAt(index, tempMatrix);
      pickup.instanceIndex = index;
      pickup.instanceMesh = instancedMesh;
    });

    instancedMesh.instanceMatrix.needsUpdate = true;
    group.add(instancedMesh);
    variantInstancedMeshes.set(itemId, instancedMesh);
  });

  const setPickupActiveState = (pickup, active) => {
    if (!pickup) return;
    pickup.active = Boolean(active);
    if (pickup.type === 'instanced' && pickup.instanceMesh && Number.isInteger(pickup.instanceIndex)) {
      const instancedMesh = pickup.instanceMesh;
      if (active) {
        tempPosition.copy(pickup.position);
      } else {
        tempPosition.set(0, -10000, 0);
      }
      applyRootTransformToMatrix({
        targetMatrix: tempMatrix,
        rootPosition: tempPosition,
        rootRotationY: pickup.rotationY || 0,
        templateLocalMatrix: templates.get(pickup.id)?.localMatrix,
        rootScale: MUSHROOM_SCALE
      });
      instancedMesh.setMatrixAt(pickup.instanceIndex, tempMatrix);
      instancedMesh.instanceMatrix.needsUpdate = true;
      return;
    }
    if (pickup.mesh) {
      pickup.mesh.visible = Boolean(active);
      if (!active && pickup.mesh.parent) {
        pickup.mesh.parent.remove(pickup.mesh);
      }
    }
  };

  const spawnPickup = (itemId, position) => {
    const template = templates.get(itemId);
    if (!template || !position) return null;
    const mesh = createSharedMeshInstance(template.mesh, itemId);
    if (!mesh) return null;
    const x = position.x;
    const z = position.z;
    const y = getTerrainHeight?.(x, z) ?? position.y ?? 0;
    const rootPosition = new THREE.Vector3(x, y + (template.lift ?? MUSHROOM_LIFT), z);
    const rootRotationY = Math.random() * Math.PI * 2;
    applyRootTransformToMatrix({
      targetMatrix: tempMatrix,
      rootPosition,
      rootRotationY,
      templateLocalMatrix: template.localMatrix,
      rootScale: MUSHROOM_SCALE
    });
    tempMatrix.decompose(mesh.position, mesh.quaternion, mesh.scale);
    group.add(mesh);
    return registerPickup({
      id: itemId,
      position: mesh.position,
      rotationY: rootRotationY,
      active: true,
      type: 'mesh',
      mesh
    });
  };


  const updatePickupPosition = (pickup, position) => {
    if (!pickup?.active || !position) return false;
    if (pickup.position) {
      pickup.position.copy(position);
    }
    if (pickup.type === 'instanced' && pickup.instanceMesh && Number.isInteger(pickup.instanceIndex)) {
      tempPosition.copy(position);
      applyRootTransformToMatrix({
        targetMatrix: tempMatrix,
        rootPosition: tempPosition,
        rootRotationY: pickup.rotationY || 0,
        templateLocalMatrix: templates.get(pickup.id)?.localMatrix,
        rootScale: MUSHROOM_SCALE
      });
      pickup.instanceMesh.setMatrixAt(pickup.instanceIndex, tempMatrix);
      pickup.instanceMesh.instanceMatrix.needsUpdate = true;
      return true;
    }
    if (pickup.mesh) {
      pickup.mesh.position.copy(position);
      return true;
    }
    return false;
  };

  const removePickup = (pickup) => {
    if (!pickup) return false;
    setPickupActiveState(pickup, false);
    return true;
  };

  const createProjectileMesh = (itemId) => {
    const template = templates.get(itemId) || templates.values().next().value;
    if (!template) return null;
    const mesh = createSharedMeshInstance(template.mesh, itemId || 'mushroom_projectile');
    return mesh;
  };

  return {
    group,
    pickups,
    spawnPickup,
    removePickup,
    updatePickupPosition,
    createProjectileMesh,
    variantInstancedMeshes
  };
}

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { getTerrainHeight } from '../environment/water.js';

export const CRAFT_TABLE_SCALE = 0.02;
export const CRAFT_TABLE_POSITION = new THREE.Vector3(1.5, 0, 0.5);
const CRAFT_TABLE_LIFT = 0.1;
const DEFAULT_INTERACT_DISTANCE = 3;

const disposeMaterial = (material) => {
  if (!material) return;
  if (Array.isArray(material)) {
    material.forEach(entry => entry?.dispose?.());
    return;
  }
  material.dispose?.();
};

const disposeMesh = (mesh) => {
  if (!mesh) return;
  mesh.traverse(child => {
    if (!child.isMesh) return;
    child.geometry?.dispose?.();
    disposeMaterial(child.material);
  });
};

export class CraftTable {
  constructor(scene, options = {}) {
    this.scene = scene;
    this.mesh = null;
    this.modelUrl = options.modelUrl || '/assets/props/table.glb';
    this.position = (options.position || CRAFT_TABLE_POSITION).clone();
    this.scale = Number.isFinite(options.scale) ? options.scale : CRAFT_TABLE_SCALE;
    this.useTerrainHeight = options.useTerrainHeight !== false;
    this.interactDistance = Number.isFinite(options.interactDistance)
      ? options.interactDistance
      : DEFAULT_INTERACT_DISTANCE;
  }

  async load(position = this.position) {
    const loader = new GLTFLoader();
    try {
      const gltf = await loader.loadAsync(this.modelUrl);
      this.mesh = gltf.scene;
    } catch (error) {
      console.warn('Failed to load craft table model, using placeholder box.', error);
      const geometry = new THREE.BoxGeometry(1.6, 0.8, 1);
      const material = new THREE.MeshStandardMaterial({ color: 0x8a6b4e });
      this.mesh = new THREE.Mesh(geometry, material);
    }

    if (!this.mesh) return;

    const targetPos = position.clone();
    if (this.useTerrainHeight) {
      const terrainHeight = getTerrainHeight(targetPos.x, targetPos.z);
      if (Number.isFinite(terrainHeight)) {
        targetPos.y = terrainHeight + CRAFT_TABLE_LIFT;
      }
    }

    this.mesh.traverse(child => {
      if (!child.isMesh) return;
      child.castShadow = true;
      child.receiveShadow = true;
    });

    this.mesh.position.copy(targetPos);
    this.mesh.scale.setScalar(this.scale);
    this.mesh.userData.hideInMapView = true;
    this.scene.add(this.mesh);
  }

  getInteractionDistance() {
    return this.interactDistance;
  }

  getWorldPosition(target = new THREE.Vector3()) {
    if (!this.mesh) return null;
    this.mesh.getWorldPosition(target);
    return target;
  }

  getCraftSurfacePosition(offset = new THREE.Vector3()) {
    if (!this.mesh) return null;
    const bounds = new THREE.Box3().setFromObject(this.mesh);
    const center = new THREE.Vector3();
    bounds.getCenter(center);
    center.y = bounds.max.y + 0.2;
    return center.add(offset);
  }

  removeFromScene() {
    if (!this.mesh) return;
    this.scene.remove(this.mesh);
    disposeMesh(this.mesh);
    this.mesh = null;
  }
}

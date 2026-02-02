import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { getTerrainHeight } from '../environment/water.js';

export const BED_SIZE = new THREE.Vector3(2.2, 0.6, 1.4);
export const BED_LOCATION = new THREE.Vector3(-2, 0, 2);
const BED_LIFT = 0.5;
const SLEEP_Y_OFFSET = -0.8;
const SLEEP_X_OFFSET = 1.3;
const DEFAULT_SCALE = 0.02;
const DEFAULT_SLEEP_INSET = 0.08;

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

export class Bed {
  constructor(scene, options = {}) {
    this.scene = scene;
    this.mesh = null;
    this.modelUrl = options.modelUrl || '/assets/props/bed.glb';
    this.size = (options.size || BED_SIZE).clone();
    this.location = (options.position || BED_LOCATION).clone();
    this.scale = Number.isFinite(options.scale) ? options.scale : DEFAULT_SCALE;
    this.sleepInset = Number.isFinite(options.sleepInset) ? options.sleepInset : DEFAULT_SLEEP_INSET;
    this.interactDistance = Number.isFinite(options.interactDistance)
      ? options.interactDistance
      : Math.max(this.size.x, this.size.z) * 0.75;
    this.bounds = null;
    this.boundingSize = this.size.clone();
  }

  async load(position = this.location) {
    const loader = new GLTFLoader();
    try {
      const gltf = await loader.loadAsync(this.modelUrl);
      this.mesh = gltf.scene;
    } catch (error) {
      console.warn('Failed to load bed model, using placeholder box.', error);
      const geometry = new THREE.BoxGeometry(this.size.x, this.size.y, this.size.z);
      const material = new THREE.MeshStandardMaterial({ color: 0x9a7b61 });
      this.mesh = new THREE.Mesh(geometry, material);
    }

    if (!this.mesh) return;

    const targetPos = position.clone();
    const terrainHeight = getTerrainHeight(targetPos.x, targetPos.z);
    if (Number.isFinite(terrainHeight)) {
      targetPos.y = terrainHeight + BED_LIFT;
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

    this.updateBounds();
  }

  updateBounds() {
    if (!this.mesh) return;
    this.bounds = new THREE.Box3().setFromObject(this.mesh);
    const size = new THREE.Vector3();
    this.bounds.getSize(size);
    if (size.lengthSq() > 0) {
      this.boundingSize.copy(size);
    }
  }

  getInteractionDistance() {
    return this.interactDistance;
  }

  getSleepSurfaceY() {
    if (this.bounds) {
      return this.bounds.max.y - this.sleepInset;
    }
    return this.mesh ? this.mesh.position.y + this.boundingSize.y - this.sleepInset : 0;
  }

  getSleepPosition() {
    if (!this.mesh) return null;
    const pos = this.mesh.position.clone();
    pos.y = this.getSleepSurfaceY() + SLEEP_Y_OFFSET;
    pos.x = pos.x + SLEEP_X_OFFSET;
    return pos;
  }

  getWakePosition() {
    if (!this.mesh) return null;
    const offset = new THREE.Vector3(this.boundingSize.x * 0.7, 0, 0);
    offset.applyQuaternion(this.mesh.quaternion);
    const pos = this.mesh.position.clone().add(offset);
    const terrainHeight = getTerrainHeight(pos.x, pos.z);
    if (Number.isFinite(terrainHeight)) {
      pos.y = terrainHeight;
    }
    return pos;
  }

  removeFromScene() {
    if (!this.mesh) return;
    this.scene.remove(this.mesh);
    disposeMesh(this.mesh);
    this.mesh = null;
  }
}

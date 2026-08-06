import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { getTerrainHeight } from '../environment/terrainHeight.js';
import {
  createStaticBoxColliderForObject,
  removeStaticBoxCollider,
  syncStaticBoxColliderForObject
} from '../physics/staticBoxCollider.js';

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
    this.useTerrainHeight = options.useTerrainHeight !== false;
    this.interactDistance = Number.isFinite(options.interactDistance)
      ? options.interactDistance
      : Math.max(this.size.x, this.size.z) * 1.35;
    this.bounds = null;
    this.boundingSize = this.size.clone();
    this.collider = null;
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
    if (this.useTerrainHeight) {
      const terrainHeight = getTerrainHeight(targetPos.x, targetPos.z);
      if (Number.isFinite(terrainHeight)) {
        targetPos.y = terrainHeight + BED_LIFT;
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

    this.updateBounds();
    const colliderHalfExtents = new THREE.Vector3(
      Math.max(this.boundingSize.x * 0.42, 0.45),
      Math.max(this.boundingSize.y * 0.28, 0.16),
      Math.max(this.boundingSize.z * 0.42, 0.35)
    );
    this.collider = createStaticBoxColliderForObject(this.mesh, {
      friction: 0.95,
      restitution: 0.01,
      halfExtents: colliderHalfExtents,
      useObjectPosition: false
    });
    this.syncCollider();
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
    if (!this.mesh) return 0;
    const bounds = new THREE.Box3().setFromObject(this.mesh);
    return bounds.max.y - this.sleepInset;
  }

  getSleepPosition() {
    if (!this.mesh) return null;
    const pos = this.getWorldPosition();
    pos.y = this.getSleepSurfaceY() + SLEEP_Y_OFFSET;
    pos.x = pos.x + SLEEP_X_OFFSET;
    return pos;
  }

  getWakePosition() {
    if (!this.mesh) return null;
    const offset = new THREE.Vector3(this.boundingSize.x * 0.7, 0, 0);
    const worldQuaternion = new THREE.Quaternion();
    this.mesh.getWorldQuaternion(worldQuaternion);
    offset.applyQuaternion(worldQuaternion);
    const basePos = this.getWorldPosition();
    const pos = basePos.clone().add(offset);
    if (this.useTerrainHeight) {
      const terrainHeight = getTerrainHeight(pos.x, pos.z);
      if (Number.isFinite(terrainHeight)) {
        pos.y = terrainHeight;
      }
    } else {
      pos.y = basePos.y - BED_LIFT;
    }
    return pos;
  }

  getWorldPosition(target = new THREE.Vector3()) {
    if (!this.mesh) return null;
    this.mesh.getWorldPosition(target);
    return target;
  }

  syncCollider() {
    if (!this.collider) return;
    syncStaticBoxColliderForObject(this.collider);
  }

  removeFromScene() {
    if (!this.mesh) return;
    this.scene.remove(this.mesh);
    removeStaticBoxCollider(this.collider);
    this.collider = null;
    disposeMesh(this.mesh);
    this.mesh = null;
  }
}

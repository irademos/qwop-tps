import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { getTerrainHeight } from '../environment/water.js';
import { createStaticBoxColliderForObject, removeStaticBoxCollider, syncStaticBoxColliderForObject } from '../physics/staticBoxCollider.js';

const DEFAULT_CHEST_POSITION = new THREE.Vector3(1.5, 0, 1.5);
const DEFAULT_SCALE = 0.015;
const DEFAULT_PICKUP_RADIUS = 3;
const DEFAULT_GROUND_OFFSET = 0.0;

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

export class TreasureChest {
  constructor(scene, options = {}) {
    this.scene = scene;
    this.mesh = null;
    this.isOpen = false;
    this.onOpen = null;
    this.modelUrl = options.modelUrl || '/assets/props/treasure_chest.glb';
    this._defaultPosition = options.defaultPosition || DEFAULT_CHEST_POSITION;
    this._scale = Number.isFinite(options.scale) ? options.scale : DEFAULT_SCALE;
    this._pickupRadius = Number.isFinite(options.pickupRadius)
      ? options.pickupRadius
      : DEFAULT_PICKUP_RADIUS;
    this._groundOffset = Number.isFinite(options.groundOffset)
      ? options.groundOffset
      : DEFAULT_GROUND_OFFSET;
    this.collider = null;
  }

  async load(position = this._defaultPosition) {
    const loader = new GLTFLoader();
    try {
      const gltf = await loader.loadAsync(this.modelUrl);
      this.mesh = gltf.scene;
    } catch (error) {
      console.warn('Failed to load treasure chest model, using placeholder box.', error);
      const geometry = new THREE.BoxGeometry(0.8, 0.6, 0.6);
      const material = new THREE.MeshStandardMaterial({ color: 0x8b5a2b });
      this.mesh = new THREE.Mesh(geometry, material);
    }

    if (!this.mesh) return;

    const targetPos = position.clone();
    const terrainHeight = getTerrainHeight(targetPos.x, targetPos.z);
    if (Number.isFinite(terrainHeight)) {
      targetPos.y = terrainHeight + this._groundOffset;
    }

    this.mesh.traverse(child => {
      if (!child.isMesh) return;
      child.castShadow = true;
      child.receiveShadow = true;
    });

    this.mesh.position.copy(targetPos);
    this.mesh.scale.setScalar(this._scale);
    this.mesh.userData.hideInMapView = true;
    this.scene.add(this.mesh);
    this.collider = createStaticBoxColliderForObject(this.mesh, {
      friction: 0.9,
      restitution: 0.02,
      halfExtents: new THREE.Vector3(0.38, 0.34, 0.30),
      centerOffset: new THREE.Vector3(0, 0.34, 0)
    });
  }

  syncCollider() {
    syncStaticBoxColliderForObject(this.collider);
  }

  tryOpen(playerControls) {
    if (!this.mesh || this.isOpen) return;
    if (!playerControls?.playerModel) return;
    const distance = playerControls.playerModel.position.distanceTo(this.mesh.position);
    if (distance > this._pickupRadius) return;

    this.isOpen = true;
    if (typeof this.onOpen === 'function') {
      this.onOpen(playerControls);
    }
    this.removeFromScene();
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

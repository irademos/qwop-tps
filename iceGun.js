import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { getTerrainHeight } from './water.js';

const DEFAULT_POSITION = new THREE.Vector3(-6, 0, 5);
const PICKUP_RADIUS = 3;

export class IceGun {
  constructor(scene) {
    this.scene = scene;
    this.mesh = null;
    this.holder = null;
    this.type = 'iceGun';
    this._holdOffset = new THREE.Vector3(-0.05, 0.15, 0.08);
    this._holdRotation = new THREE.Euler(-Math.PI / 2, Math.PI, 0, 'YXZ');
    this._holdQuaternion = new THREE.Quaternion().setFromEuler(this._holdRotation);
    this._handBones = new WeakMap();
    this._tempPosition = new THREE.Vector3();
    this._tempQuaternion = new THREE.Quaternion();
    this._tempOffset = new THREE.Vector3();
  }

  async load(position = DEFAULT_POSITION) {
    const loader = new GLTFLoader();
    try {
      const gltf = await loader.loadAsync('/assets/props/ice_gun.glb');
      this.mesh = gltf.scene;
    } catch (error) {
      console.warn('Failed to load ice gun model, using placeholder box.', error);
      const geometry = new THREE.BoxGeometry(0.6, 0.2, 0.8);
      const material = new THREE.MeshStandardMaterial({ color: 0x99ccff });
      this.mesh = new THREE.Mesh(geometry, material);
    }

    if (!this.mesh) return;

    const targetPos = position.clone();
    const terrainHeight = getTerrainHeight(targetPos.x, targetPos.z);
    targetPos.y = terrainHeight + 0.5;

    this.mesh.traverse(child => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
        const materials = Array.isArray(child.material)
          ? child.material
          : [child.material];
        materials.forEach(material => {
          if (!material) return;
          material.depthWrite = true;
          material.depthTest = true;
        });
      }
    });

    this.mesh.position.copy(targetPos);
    this.mesh.scale.setScalar(0.001);
    this.scene.add(this.mesh);
  }

  tryPickup(playerControls) {
    if (!this.mesh || !playerControls?.playerModel) return;
    if (this.holder === playerControls) {
      this.drop();
      return;
    }
    if (this.holder) return;
    const distance = playerControls.playerModel.position.distanceTo(this.mesh.position);
    if (distance > PICKUP_RADIUS) return;

    this.holder = playerControls;
    console.log('Player picked up the ice gun');
  }

  drop() {
    if (!this.holder || !this.mesh) return;
    const player = this.holder.playerModel;
    if (player) {
      const dropPosition = player.position.clone();
      const terrainHeight = getTerrainHeight(dropPosition.x, dropPosition.z);
      dropPosition.y = terrainHeight + 0.5;
      this.mesh.position.copy(dropPosition);
      this.mesh.quaternion.copy(player.quaternion);
    }
    this.holder = null;
  }

  update() {
    if (!this.mesh) return;
    if (!this.holder || !this.holder.playerModel) return;

    const player = this.holder.playerModel;
    const handBone = this._getHandBone(player);

    if (handBone) {
      handBone.updateWorldMatrix(true, false);
      handBone.getWorldPosition(this._tempPosition);
      handBone.getWorldQuaternion(this._tempQuaternion);

      this.mesh.position.copy(this._tempPosition);
      this._tempOffset.copy(this._holdOffset).applyQuaternion(this._tempQuaternion);
      this.mesh.position.add(this._tempOffset);

      this.mesh.quaternion.copy(this._tempQuaternion).multiply(this._holdQuaternion);
      return;
    }

    const quaternion = player.quaternion;
    this._tempOffset.copy(this._holdOffset).applyQuaternion(quaternion);
    this.mesh.position.copy(player.position).add(this._tempOffset);
    this.mesh.quaternion.copy(quaternion).multiply(this._holdQuaternion);
  }

  _getHandBone(playerModel) {
    if (!playerModel) return null;

    if (this._handBones.has(playerModel)) {
      return this._handBones.get(playerModel);
    }

    const root = playerModel.userData?.pivot ?? playerModel;
    let handBone = null;

    root.traverse(child => {
      if (handBone || !child.isBone || !child.name) return;
      const name = child.name.toLowerCase();
      if (name.includes('righthand')) {
        handBone = child;
      }
    });

    if (!handBone) {
      root.traverse(child => {
        if (handBone || !child.isBone || !child.name) return;
        if (child.name.toLowerCase().includes('hand')) {
          handBone = child;
        }
      });
    }

    this._handBones.set(playerModel, handBone || null);
    return handBone || null;
  }
}

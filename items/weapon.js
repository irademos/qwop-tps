import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { getTerrainHeight } from '../environment/terrainHeight.js';

const DEFAULT_POSITION = new THREE.Vector3(-6, 0, 5);
const DEFAULT_PICKUP_RADIUS = 3;

export class Weapon {
  constructor(scene, options = {}) {
    this.scene = scene;
    this.mesh = null;
    this.holder = null;
    this.type = options.type || 'weapon';
    this.itemId = options.itemId || this.type;
    this.modelUrl = options.modelUrl || '';
    this.hand = options.hand || 'right';
    this.onPickup = null;
    this.onDrop = null;
    this.heldMesh = null;
    this.useHeldMeshWhenHeld = false;
    this._holdOffset = options.holdOffset || new THREE.Vector3(-0.05, 0.15, 0.08);
    this._holdRotation = options.holdRotation || new THREE.Euler(-Math.PI / 2, Math.PI, 0, 'YXZ');
    this._holdQuaternion = new THREE.Quaternion().setFromEuler(this._holdRotation);
    this._handBones = new WeakMap();
    this._tempPosition = new THREE.Vector3();
    this._tempQuaternion = new THREE.Quaternion();
    this._tempOffset = new THREE.Vector3();
    this._defaultPosition = options.defaultPosition || DEFAULT_POSITION;
    this._pickupRadius = Number.isFinite(options.pickupRadius)
      ? options.pickupRadius
      : DEFAULT_PICKUP_RADIUS;
    this._scale = Number.isFinite(options.scale) ? options.scale : 0.001;
    this._fallbackSize = options.fallbackSize || new THREE.Vector3(0.6, 0.2, 0.8);
    this._fallbackColor = options.fallbackColor || 0x99ccff;
  }

  async load(position = this._defaultPosition) {
    const loader = new GLTFLoader();
    try {
      const gltf = await loader.loadAsync(this.modelUrl);
      this.mesh = gltf.scene;
    } catch (error) {
      console.warn(`Failed to load ${this.itemId} model, using placeholder box.`, error);
      const geometry = new THREE.BoxGeometry(
        this._fallbackSize.x,
        this._fallbackSize.y,
        this._fallbackSize.z
      );
      const material = new THREE.MeshStandardMaterial({ color: this._fallbackColor });
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
    this.mesh.scale.setScalar(this._scale);
    this.scene.add(this.mesh);
  }

  tryPickup(playerControls) {
    if (!this.mesh || !playerControls?.playerModel) return;
    if (!this.mesh.visible) return;
    if (this.holder === playerControls) {
      this.drop();
      return;
    }
    if (this.holder) return;
    const distance = playerControls.playerModel.position.distanceTo(this.mesh.position);
    if (distance > this._pickupRadius) return;

    this.holder = playerControls;
    if (typeof this.onPickup === 'function') {
      this.onPickup(playerControls);
    }
    if (window.DEBUG_PICKUPS) {
      console.log(`Player picked up ${this.itemId}`);
    }
  }

  drop({ removeFromInventory = true } = {}) {
    if (!this.holder || !this.mesh) return;
    const previousHolder = this.holder;
    const player = previousHolder.playerModel;
    const usingHeldMesh = this.useHeldMeshWhenHeld && this.heldMesh;
    const activeMesh = usingHeldMesh ? this.heldMesh : this.mesh;
    if (player) {
      if (usingHeldMesh && this.mesh.visible) {
        const pickupClone = this.mesh.clone(true);
        pickupClone.position.copy(this.mesh.position);
        pickupClone.quaternion.copy(this.mesh.quaternion);
        pickupClone.visible = true;
        pickupClone.userData.hideInMapView = this.mesh.userData?.hideInMapView;
        this.scene.add(pickupClone);
      }
      const dropPosition = player.position.clone();
      const terrainHeight = getTerrainHeight(dropPosition.x, dropPosition.z);
      dropPosition.y = terrainHeight + 0.5;
      this.mesh.position.copy(dropPosition);
      this.mesh.quaternion.copy(player.quaternion);
      if (usingHeldMesh) {
        activeMesh.position.copy(dropPosition);
        activeMesh.quaternion.copy(player.quaternion);
      }
    }
    this.holder = null;
    this.mesh.visible = true;
    if (usingHeldMesh) {
      activeMesh.visible = false;
    }
    if (typeof this.onDrop === 'function') {
      this.onDrop(previousHolder, { removeFromInventory });
    }
  }

  update() {
    if (!this.mesh) return;
    if (!this.holder || !this.holder.playerModel) return;

    const player = this.holder.playerModel;
    const handBone = this._getHandBone(player);
    const activeMesh = this.useHeldMeshWhenHeld && this.heldMesh ? this.heldMesh : this.mesh;
    if (!activeMesh) return;

    if (handBone) {
      handBone.updateWorldMatrix(true, false);
      handBone.getWorldPosition(this._tempPosition);
      handBone.getWorldQuaternion(this._tempQuaternion);

      activeMesh.position.copy(this._tempPosition);
      this._tempOffset.copy(this._holdOffset).applyQuaternion(this._tempQuaternion);
      activeMesh.position.add(this._tempOffset);

      activeMesh.quaternion.copy(this._tempQuaternion).multiply(this._holdQuaternion);
      if (activeMesh !== this.mesh && this.mesh) {
        this.mesh.position.copy(activeMesh.position);
        this.mesh.quaternion.copy(activeMesh.quaternion);
      }
      return;
    }

    const quaternion = player.quaternion;
    this._tempOffset.copy(this._holdOffset).applyQuaternion(quaternion);
    activeMesh.position.copy(player.position).add(this._tempOffset);
    activeMesh.quaternion.copy(quaternion).multiply(this._holdQuaternion);
    if (activeMesh !== this.mesh && this.mesh) {
      this.mesh.position.copy(activeMesh.position);
      this.mesh.quaternion.copy(activeMesh.quaternion);
    }
  }

  _getHandBone(playerModel) {
    if (!playerModel) return null;

    if (this._handBones.has(playerModel)) {
      const cached = this._handBones.get(playerModel);
      if (cached?.[this.hand]) {
        return cached[this.hand];
      }
    }

    const root = playerModel.userData?.pivot ?? playerModel;
    let leftHandBone = null;
    let rightHandBone = null;
    let anyHandBone = null;

    root.traverse(child => {
      if ((!child.isBone || !child.name)) return;
      const name = child.name.toLowerCase();
      if (!rightHandBone && name.includes('righthand')) {
        rightHandBone = child;
      }
      if (!leftHandBone && name.includes('lefthand')) {
        leftHandBone = child;
      }
      if (!anyHandBone && name.includes('hand')) {
        anyHandBone = child;
      }
    });

    const resolved = this.hand === 'left'
      ? leftHandBone || anyHandBone || rightHandBone
      : rightHandBone || anyHandBone || leftHandBone;

    this._handBones.set(playerModel, {
      left: leftHandBone || anyHandBone || null,
      right: rightHandBone || anyHandBone || null,
      any: anyHandBone || null
    });
    return resolved || null;
  }
}

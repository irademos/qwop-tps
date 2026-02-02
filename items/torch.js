import * as THREE from 'three';
import { getTerrainHeight } from '../environment/water.js';
import { Weapon } from './weapon.js';
import { applyEmissiveGlow, LIGHT_SOURCE_CONFIGS } from '../light_sources.js';

export const TORCH_SIZE = new THREE.Vector3(0.24, 0.9, 0.24);
export const TORCH_PICKUP_LOCATION = new THREE.Vector3(1.4, 0, 1.2);

const DROP_OFFSET = new THREE.Vector3(0.8, 0, 0.6);
const TORCH_HOLD_OFFSET = new THREE.Vector3(0.0, 0.08, 0.08);
const TORCH_HOLD_ROTATION = new THREE.Euler(Math.PI + Math.PI / 7, Math.PI, 0 - Math.PI / 9, 'YXZ');
const TORCH_MIST_OFFSET = new THREE.Vector3(0, 3.2, 0);
const TORCH_MIST_PARTICLE_COUNT = 6;
const TORCH_MIST_SPREAD = 1.2;

export class Torch extends Weapon {
  constructor(scene) {
    const config = LIGHT_SOURCE_CONFIGS.torch;
    super(scene, {
      itemId: 'torch',
      type: 'torch',
      hand: 'left',
      modelUrl: config.modelUrl,
      scale: config.scale,
      fallbackSize: TORCH_SIZE.clone(),
      fallbackColor: config.emissiveColor,
      holdOffset: TORCH_HOLD_OFFSET.clone(),
      holdRotation: TORCH_HOLD_ROTATION
    });
    this.light = null;
    this._groundOffset = 0.2;
    this._lightOffset = config.lightOffset.clone();
    this._lightColor = config.lightColor;
    this._lightSettings = config.settings;
    this._emissiveColor = config.emissiveColor;
    this._mistGroup = null;
    this._mistMaterials = [];
  }

  async load(position) {
    await super.load(position);
    if (!this.mesh) return;

    const terrainHeight = getTerrainHeight(this.mesh.position.x, this.mesh.position.z);
    if (Number.isFinite(terrainHeight)) {
      this.mesh.position.y = terrainHeight + this._groundOffset;
    }

    applyEmissiveGlow(this.mesh, this._emissiveColor, this._lightSettings.emissiveIntensity);

    this.light = new THREE.PointLight(
      this._lightColor,
      this._lightSettings.intensity,
      this._lightSettings.distance,
      this._lightSettings.decay
    );
    this.light.position.copy(this._lightOffset);
    this.mesh.add(this.light);

    this._mistGroup = this._createMist();
    if (this._mistGroup) {
      this._mistGroup.position.copy(TORCH_MIST_OFFSET);
      this._mistGroup.visible = false;
      this.mesh.add(this._mistGroup);
    }
  }

  drop({ removeFromInventory = true } = {}) {
    if (!this.holder || !this.mesh) return;
    const previousHolder = this.holder;
    const player = previousHolder.playerModel;
    if (player) {
      const dropOffset = DROP_OFFSET.clone().applyQuaternion(player.quaternion);
      const dropPosition = player.position.clone().add(dropOffset);
      const terrainHeight = getTerrainHeight(dropPosition.x, dropPosition.z);
      dropPosition.y = Number.isFinite(terrainHeight)
        ? terrainHeight + this._groundOffset
        : dropPosition.y;
      this.mesh.position.copy(dropPosition);
      this.mesh.quaternion.copy(player.quaternion);
    }
    this.holder = null;
    this.mesh.visible = true;
    if (this._mistGroup) {
      this._mistGroup.visible = false;
    }
    if (typeof this.onDrop === 'function') {
      this.onDrop(previousHolder, { removeFromInventory });
    }
  }

  update() {
    super.update();
    if (!this._mistGroup || !this.mesh) return;
    const shouldShow = !!this.holder;
    if (this._mistGroup.visible !== shouldShow) {
      this._mistGroup.visible = shouldShow;
    }
    if (!shouldShow) return;
    const pulse = 0.65 + Math.sin(performance.now() * 0.004) * 0.15;
    this._mistMaterials.forEach(material => {
      material.opacity = THREE.MathUtils.clamp(pulse, 0.35, 0.8);
      material.emissiveIntensity = THREE.MathUtils.clamp(pulse, 0.35, 0.9);
    });
  }

  _createMist() {
    const mistGroup = new THREE.Group();
    const yellowMaterial = new THREE.MeshStandardMaterial({
      color: 0xffd166,
      emissive: 0xffb703,
      emissiveIntensity: 0.6,
      transparent: true,
      opacity: 0.65,
      depthWrite: false
    });
    const redMaterial = new THREE.MeshStandardMaterial({
      color: 0xff7b54,
      emissive: 0xff3b1f,
      emissiveIntensity: 0.5,
      transparent: true,
      opacity: 0.55,
      depthWrite: false
    });
    this._mistMaterials = [yellowMaterial, redMaterial];

    const createParticle = (material) => {
      const size = THREE.MathUtils.lerp(0.14, 0.39, Math.random());
      const geometry = new THREE.SphereGeometry(size, 8, 6);
      const particle = new THREE.Mesh(geometry, material);
      particle.position.set(
        (Math.random() - 0.5) * TORCH_MIST_SPREAD,
        Math.random() * TORCH_MIST_SPREAD,
        (Math.random() - 0.5) * TORCH_MIST_SPREAD
      );
      particle.castShadow = false;
      particle.receiveShadow = false;
      return particle;
    };

    for (let i = 0; i < TORCH_MIST_PARTICLE_COUNT; i += 1) {
      mistGroup.add(createParticle(yellowMaterial));
    }
    for (let i = 0; i < Math.ceil(TORCH_MIST_PARTICLE_COUNT / 2); i += 1) {
      mistGroup.add(createParticle(redMaterial));
    }

    return mistGroup;
  }
}

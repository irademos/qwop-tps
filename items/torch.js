import * as THREE from 'three';
import { getTerrainHeight } from '../environment/water.js';
import { createFire } from '../environment/fire.js';
import { Weapon } from './weapon.js';
import { applyEmissiveGlow, LIGHT_SOURCE_CONFIGS } from '../light_sources.js';

export const TORCH_SIZE = new THREE.Vector3(0.24, 0.9, 0.24);
export const TORCH_PICKUP_LOCATION = new THREE.Vector3(1.4, 0, 1.2);

const DROP_OFFSET = new THREE.Vector3(0.8, 0, 0.6);
const TORCH_HOLD_OFFSET = new THREE.Vector3(0.0, 0.08, 0.08);
const TORCH_HOLD_ROTATION = new THREE.Euler(Math.PI + Math.PI / 7, Math.PI, 0 - Math.PI / 9, 'YXZ');
const TORCH_FIRE_OFFSET = new THREE.Vector3(0, 3.2, 0);
const TORCH_FIRE_PARTICLE_COUNT = 6;
const TORCH_FIRE_SPREAD = 1.2;
const TORCH_FIRE_SIZE_RANGE = [0.14, 0.39];

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
    this._fire = null;
  }

  async load(position) {
    await super.load(position);
    if (!this.mesh) return;

    const terrainHeight = getTerrainHeight(this.mesh.position.x, this.mesh.position.z);
    if (Number.isFinite(terrainHeight)) {
      this.mesh.position.y = terrainHeight + this._groundOffset;
    }

    applyEmissiveGlow(this.mesh, this._emissiveColor, this._lightSettings.emissiveIntensity);

    const fire = createFire({
      particleCount: TORCH_FIRE_PARTICLE_COUNT,
      spread: TORCH_FIRE_SPREAD,
      sizeRange: TORCH_FIRE_SIZE_RANGE,
      lightSettings: {
        color: this._lightColor,
        intensity: this._lightSettings.intensity,
        distance: this._lightSettings.distance,
        decay: this._lightSettings.decay
      },
      lightOffset: this._lightOffset.clone().sub(TORCH_FIRE_OFFSET),
      pulse: {
        base: 0.65,
        variance: 0.15,
        opacityRange: [0.35, 0.8],
        emissiveRange: [0.35, 0.9],
        lightIntensityRange: [0.75, 1.15]
      }
    });
    this._fire = fire;
    this.light = fire?.light ?? null;
    if (fire?.group) {
      fire.group.position.copy(TORCH_FIRE_OFFSET);
      fire.group.visible = false;
      this.mesh.add(fire.group);
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
    if (this._fire?.group) {
      this._fire.group.visible = false;
    }
    if (typeof this.onDrop === 'function') {
      this.onDrop(previousHolder, { removeFromInventory });
    }
  }

  update() {
    super.update();
    if (!this._fire?.group || !this.mesh) return;
    const shouldShow = !!this.holder;
    if (this._fire.group.visible !== shouldShow) {
      this._fire.group.visible = shouldShow;
    }
    if (!shouldShow) return;
    this._fire.update?.(performance.now());
  }
}

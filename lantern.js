import * as THREE from 'three';
import { getTerrainHeight } from './water.js';
import { Weapon } from './weapon.js';
import { applyEmissiveGlow, LIGHT_SOURCE_CONFIGS } from './light_sources.js';

const DROP_OFFSET = new THREE.Vector3(0.8, 0, 0.6);

export class Lantern extends Weapon {
  constructor(scene) {
    const config = LIGHT_SOURCE_CONFIGS.lantern;
    super(scene, {
      itemId: 'lantern',
      type: 'lantern',
      modelUrl: config.modelUrl,
      scale: config.scale,
      fallbackSize: new THREE.Vector3(0.25, 0.4, 0.25),
      fallbackColor: config.emissiveColor,
      holdOffset: new THREE.Vector3(0.05, 0.1, 0.08),
      holdRotation: new THREE.Euler(0, Math.PI, 0, 'YXZ')
    });
    this.light = null;
    this._groundOffset = 0.2;
    this._lightOffset = config.lightOffset.clone();
    this._lightColor = config.lightColor;
    this._lightSettings = config.settings;
    this._emissiveColor = config.emissiveColor;
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
    if (typeof this.onDrop === 'function') {
      this.onDrop(previousHolder, { removeFromInventory });
    }
  }
}

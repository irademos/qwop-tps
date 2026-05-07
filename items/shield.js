import * as THREE from 'three';
import { getTerrainHeight } from '../environment/terrainHeight.js';
import { Weapon } from './weapon.js';

export const SHIELD_ITEM_ID = 'shield';
export const DEFAULT_SHIELD_HEALTH = 60;

const SHIELD_RADIUS = 0.42;
const SHIELD_THICKNESS = 0.12;
const SHIELD_COLOR = 0x7a4a20;
const SHIELD_RIM_COLOR = 0x4d2c12;
const BAR_VISIBLE_MS = 1200;

export class Shield extends Weapon {
  constructor(scene) {
    super(scene, {
      itemId: SHIELD_ITEM_ID,
      type: SHIELD_ITEM_ID,
      hand: 'left',
      scale: 1,
      fallbackColor: SHIELD_COLOR,
      holdOffset: new THREE.Vector3(-0.18, 0.2, 0.2),
      holdRotation: new THREE.Euler(Math.PI / 2, 0, 0, 'YXZ')
    });
    this.maxHealth = DEFAULT_SHIELD_HEALTH;
    this._groundOffset = 0.45;
  }

  async load(position = this._defaultPosition) {
    const group = new THREE.Group();
    group.name = 'wooden-shield';

    const faceGeometry = new THREE.CylinderGeometry(SHIELD_RADIUS, SHIELD_RADIUS, SHIELD_THICKNESS, 48);
    faceGeometry.rotateX(Math.PI / 2);
    const faceMaterial = new THREE.MeshStandardMaterial({
      color: SHIELD_COLOR,
      roughness: 0.82,
      metalness: 0.02
    });
    const face = new THREE.Mesh(faceGeometry, faceMaterial);
    face.castShadow = true;
    face.receiveShadow = true;
    group.add(face);

    const rimGeometry = new THREE.TorusGeometry(SHIELD_RADIUS * 0.98, SHIELD_THICKNESS * 0.45, 10, 48);
    const rimMaterial = new THREE.MeshStandardMaterial({
      color: SHIELD_RIM_COLOR,
      roughness: 0.86,
      metalness: 0.01
    });
    const rim = new THREE.Mesh(rimGeometry, rimMaterial);
    rim.castShadow = true;
    rim.receiveShadow = true;
    group.add(rim);

    const bossGeometry = new THREE.CylinderGeometry(0.12, 0.12, SHIELD_THICKNESS * 1.25, 24);
    bossGeometry.rotateX(Math.PI / 2);
    const boss = new THREE.Mesh(bossGeometry, rimMaterial.clone());
    boss.position.z = SHIELD_THICKNESS * 0.42;
    boss.castShadow = true;
    boss.receiveShadow = true;
    group.add(boss);

    const targetPos = position.clone();
    const terrainHeight = getTerrainHeight(targetPos.x, targetPos.z);
    targetPos.y = (Number.isFinite(terrainHeight) ? terrainHeight : targetPos.y) + this._groundOffset;
    group.position.copy(targetPos);
    group.userData.hideInMapView = true;
    group.userData.shieldHealth = DEFAULT_SHIELD_HEALTH;
    group.userData.shieldMaxHealth = DEFAULT_SHIELD_HEALTH;

    this.mesh = group;
    this.scene.add(this.mesh);
  }

  showHealthBar(health, maxHealth = this.maxHealth) {
    const target = (this.useHeldMeshWhenHeld && this.heldMesh) ? this.heldMesh : this.mesh;
    if (!target) return;
    const bar = this._ensureHealthBar(target);
    const safeMax = Number.isFinite(maxHealth) && maxHealth > 0 ? maxHealth : this.maxHealth;
    const ratio = THREE.MathUtils.clamp((Number.isFinite(health) ? health : safeMax) / safeMax, 0, 1);
    const fill = bar.userData.fill;
    if (fill) {
      fill.scale.x = ratio;
      fill.position.x = -0.22 + (0.22 * ratio);
      fill.material.color.setHex(ratio > 0.35 ? 0x43d15a : 0xff5c45);
    }
    bar.visible = true;
    bar.userData.visibleUntil = performance.now() + BAR_VISIBLE_MS;
  }

  update() {
    super.update();
    const targets = [this.mesh, this.heldMesh].filter(Boolean);
    const now = performance.now();
    targets.forEach((target) => {
      const bar = target.userData?.shieldHealthBar;
      if (bar?.visible && now > (bar.userData.visibleUntil || 0)) {
        bar.visible = false;
      }
    });
  }

  _ensureHealthBar(target) {
    if (target.userData.shieldHealthBar) return target.userData.shieldHealthBar;
    const group = new THREE.Group();
    group.name = 'shield-health-bar';
    group.position.set(0, SHIELD_RADIUS + 0.18, 0.08);
    group.visible = false;

    const bg = new THREE.Mesh(
      new THREE.PlaneGeometry(0.5, 0.055),
      new THREE.MeshBasicMaterial({ color: 0x120904, depthTest: false, depthWrite: false })
    );
    const fill = new THREE.Mesh(
      new THREE.PlaneGeometry(0.44, 0.032),
      new THREE.MeshBasicMaterial({ color: 0x43d15a, depthTest: false, depthWrite: false })
    );
    fill.position.z = 0.002;
    group.add(bg, fill);
    group.userData.fill = fill;
    target.add(group);
    target.userData.shieldHealthBar = group;
    return group;
  }
}

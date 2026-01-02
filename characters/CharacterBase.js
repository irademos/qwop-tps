// /characters/CharacterBase.js
import * as THREE from "three";

export const CHARACTER_MOVEMENT = {
  walkSpeed: 5,
  runSpeed: 5,
  turnRate: 0.03
};

export class CharacterBase {
  constructor(model) {
    this.model = model;
    this.health = 100;
    this.velocity = new THREE.Vector3();
    this.actions = {};
    this.currentAction = null;
    this.mixer = null;
  }

  setPosition(x, y, z) {
    this.model.position.set(x, y, z);
  }

  setRotationY(angle) {
    this.model.rotation.y = angle;
  }

  update(delta) {
    if (!this.mixer || !Number.isFinite(delta) || delta <= 0) return;
    this.mixer.update(delta);
  }

  playAnimation(name, fadeDuration = 0.2) {
    if (!name) return;
    if (this.currentAction === name || !this.actions[name]) return;
    this.actions[this.currentAction]?.fadeOut(fadeDuration);
    this.actions[name].reset().fadeIn(fadeDuration).play();
    this.currentAction = name;
    if (this.model?.userData) {
      this.model.userData.currentAction = name;
    }
  }
}

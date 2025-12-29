import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { getWaterDepth, getTerrainHeight } from './water.js';

const FLOAT_HEIGHT = -0.1;
const LINEAR_DAMPING = 0.9;
const ANGULAR_DAMPING = 3.2;
const PADDLE_FORWARD_IMPULSE = 2.2;
const PADDLE_SIDE_IMPULSE = 0.7;
const PADDLE_TURN_RATE = 1.5;
const PADDLE_COOLDOWN = 0.25;

const MOUNT_LOCAL_POSITION = new THREE.Vector3(0, 0.15, 0);
const MOUNT_LOCAL_ROTATION = new THREE.Euler(-Math.PI/2, Math.PI / 2, 0, 'YXZ');
const UNIT_SCALE = new THREE.Vector3(1, 1, 1);
const IDLE_ACTION = 'swim';
const LEFT_PADDLE_ACTION = 'paddleLeft';
const RIGHT_PADDLE_ACTION = 'paddleRight';

const TEMP_POSITION = new THREE.Vector3();
const TEMP_QUATERNION = new THREE.Quaternion();
const TEMP_LOCAL_MATRIX = new THREE.Matrix4();
const TEMP_WORLD_MATRIX = new THREE.Matrix4();
const TEMP_SCALE = new THREE.Vector3();
const TEMP_FORWARD = new THREE.Vector3();
const TEMP_RIGHT = new THREE.Vector3();
const TEMP_EULER = new THREE.Euler();

// Extra rotation you want the mesh to have relative to the player (in radians)
      // const HOLDING_ROT_OFFSET_EULER = new THREE.Euler(Math.PI, Math.PI/2, Math.PI/2, 'YXZ');         // adjust if you need a tilt when holding
      // const SWIM_ROT_OFFSET_EULER    = new THREE.Euler(-Math.PI / 2, Math.PI, 0, 'YXZ'); // e.g., lay flat when swimming
// const HOLDING_OFFSET = new THREE.Vector3(0.1, -0.5, -1.2); // right/forward/up relative to player
//       const SWIM_OFFSET    = new THREE.Vector3(-0.55, -0.1, -1.1); // under/forward while swimming
export class Surfboard {
  constructor(scene) {
    this.scene = scene;
    this.mesh = null;
    this.occupant = null;
    this.type = 'surfboard';
    this.standing = false;
    this.holdingOffset = new THREE.Vector3(0.5, 0.1, -0.5);
    this.swimOffset = new THREE.Vector3(-0.55, -0.1, -1.1);

    this.velocity = new THREE.Vector3();
    this.angularVelocity = 0;
    this.paddleCooldown = 0;
    this.paddleResetTime = 0;
    this.paddleActionName = null;
    this.paddleResetAction = IDLE_ACTION;
    this.lastUpdateTime = null;
    this._pendingImpulse = null;
    this._wasBoatMode = false;
  }

  async load(position = { x: 0, y: 0, z: 0 }) {
    try {
      const loader = new GLTFLoader();
      const gltf = await loader.loadAsync('/assets/props/surfboard__tabla_de_surf.glb');
      this.mesh = gltf.scene;
      this.mesh.scale.setScalar(0.008);
    } catch (e) {
      const geometry = new THREE.BoxGeometry(2, 0.1, 0.5);
      const material = new THREE.MeshStandardMaterial({ color: 0xffe0bd });
      this.mesh = new THREE.Mesh(geometry, material);
    }
    this.mesh.position.set(position.x, position.y, position.z);
    this.mesh.castShadow = true;
    this.mesh.rotation.set(-Math.PI / 2, 0, 0);
    this.scene.add(this.mesh);
  }

  tryMount(playerControls) {
    if (this.occupant || !playerControls?.playerModel) return;
    const dist = playerControls.playerModel.position.distanceTo(this.mesh.position);
    if (dist < 3) {
      this.occupant = playerControls;
      playerControls.vehicle = this;
      playerControls.isMoving = false;
      playerControls.yaw = -this.mesh.rotation.y;
      this.velocity.set(0, 0, 0);
      this.angularVelocity = 0;
      this.paddleCooldown = 0;
      this.paddleResetTime = 0;
      this.paddleActionName = null;
      this._pendingImpulse = null;
      this.lastUpdateTime = null;
    }
  }

  dismount() {
    if (!this.occupant) return;
    const playerControls = this.occupant;
    const playerModel = playerControls.playerModel;

    const exitPos = this.mesh.position.clone();
    const forward = this.getForwardVector(TEMP_FORWARD);
    exitPos.addScaledVector(forward, -1.0);
    exitPos.y += 0.2;

    if (playerModel) {
      playerModel.position.copy(exitPos);
      if (forward.lengthSq() > 0.0001) {
        const yaw = Math.atan2(forward.x, forward.z);
        playerModel.quaternion.setFromEuler(TEMP_EULER.set(0, yaw + Math.PI, 0));
      } else {
        playerModel.quaternion.setFromEuler(TEMP_EULER.set(0, this.mesh.rotation.y, 0));
      }
      this.playOccupantAction('idle', { immediate: true });
    }

    if (playerControls.body) {
      playerControls.body.setTranslation({ x: exitPos.x, y: exitPos.y, z: exitPos.z }, true);
      playerControls.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      playerControls.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }

    playerControls.vehicle = null;
    this.occupant = null;
    this.standing = false;
    this.velocity.set(0, 0, 0);
    this.angularVelocity = 0;
    this.paddleCooldown = 0;
    this.paddleResetTime = 0;
    this.paddleActionName = null;
    this._pendingImpulse = null;
    this.lastUpdateTime = null;
  }

  toggleStand() {
    if (!this.occupant) return;
    this.standing = !this.standing;
    const actions = this.occupant.playerModel?.userData?.actions;
    const current = this.occupant.playerModel?.userData?.currentAction;
    if (actions) {
      const target = this.standing ? 'idle' : 'swim';
      if (current !== target) {
        actions[current]?.fadeOut(0.2);
        actions[target]?.reset().fadeIn(0.2).play();
        this.occupant.playerModel.userData.currentAction = target;
      }
    }
  }

  usesBoatControls() {
    return !!(this.occupant && !this.standing && this.occupant.isInWater);
  }

  getMountWorldTransform(outPosition = TEMP_POSITION, outQuaternion = TEMP_QUATERNION) {
    if (!this.mesh) {
      outPosition.set(0, 0, 0);
      outQuaternion.identity();
      return { position: outPosition, quaternion: outQuaternion };
    }

    TEMP_LOCAL_MATRIX.compose(MOUNT_LOCAL_POSITION, TEMP_QUATERNION.setFromEuler(MOUNT_LOCAL_ROTATION), UNIT_SCALE);
    TEMP_WORLD_MATRIX.multiplyMatrices(this.mesh.matrixWorld, TEMP_LOCAL_MATRIX);
    TEMP_WORLD_MATRIX.decompose(outPosition, outQuaternion, TEMP_SCALE);
    return { position: outPosition, quaternion: outQuaternion };
  }

  playOccupantAction(name, { immediate = false } = {}) {
    if (!this.occupant) return null;
    const actions = this.occupant.playerModel?.userData?.actions;
    if (!actions) return null;

    let chosen = name;
    if (!actions[chosen]) {
      if (actions[IDLE_ACTION]) {
        chosen = IDLE_ACTION;
      } else if (actions.idle) {
        chosen = 'idle';
      } else {
        return null;
      }
    }

    const current = this.occupant.playerModel.userData.currentAction;
    if (current === chosen && !immediate) return chosen;

    actions[current]?.fadeOut(0.2);
    actions[chosen].reset().fadeIn(immediate ? 0.05 : 0.1).play();
    this.occupant.playerModel.userData.currentAction = chosen;
    return chosen;
  }

  alignOccupant() {
    if (!this.occupant || !this.mesh) return;
    if (!this.usesBoatControls()) return;

    this.mesh.updateMatrixWorld(true);
    const { position, quaternion } = this.getMountWorldTransform();
    const { playerModel, body } = this.occupant;

    if (playerModel) {
      playerModel.position.copy(position);
      playerModel.quaternion.copy(quaternion);
    }
    if (body) {
      body.setTranslation({ x: position.x, y: position.y, z: position.z }, true);
      body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }
  }

  getForwardVector(out = TEMP_FORWARD) {
    const yaw = this.mesh?.rotation?.y ?? 0;
    out.set(Math.sin(yaw), 0, Math.cos(yaw));
    if (out.lengthSq() > 0.0001) {
      out.normalize();
    }
    return out;
  }

  getRightVector(out = TEMP_RIGHT) {
    const yaw = this.mesh?.rotation?.y ?? 0;
    out.set(Math.cos(yaw), 0, -Math.sin(yaw));
    if (out.lengthSq() > 0.0001) {
      out.normalize();
    }
    return out;
  }

  enterBoatMode() {
    this.velocity.set(0, 0, 0);
    this.angularVelocity = 0;
    this.paddleCooldown = 0;
    this.paddleResetTime = 0;
    this.paddleActionName = null;
    this._pendingImpulse = null;
    this.lastUpdateTime = null;
    this.playOccupantAction(IDLE_ACTION, { immediate: true });
    if (this.occupant) {
      this.occupant.isMoving = false;
      if (this.occupant.playerModel) {
        this.alignOccupant();
      }
    }
  }

  exitBoatMode() {
    this.velocity.set(0, 0, 0);
    this.angularVelocity = 0;
    this.paddleCooldown = 0;
    this.paddleActionName = null;
    this.paddleResetTime = 0;
    this._pendingImpulse = null;
    this.lastUpdateTime = null;
  }

  paddleLeft() {
    this.triggerPaddle(LEFT_PADDLE_ACTION, 1);
  }

  paddleRight() {
    this.triggerPaddle(RIGHT_PADDLE_ACTION, -1);
  }

  triggerPaddle(actionName, lateralSign) {
    if (!this.usesBoatControls() || !this.mesh) return;
    if (this.paddleCooldown > 0) return;

    const actions = this.occupant.playerModel?.userData?.actions;
    const chosen = this.playOccupantAction(actionName, { immediate: true });
    if (chosen) {
      const clip = actions?.[chosen]?._clip || actions?.[chosen]?.getClip?.();
      const duration = clip?.duration ?? 0.8;
      this.paddleActionName = chosen;
      if (actions?.[IDLE_ACTION]) {
        this.paddleResetAction = IDLE_ACTION;
      } else if (actions?.idle) {
        this.paddleResetAction = 'idle';
      } else {
        this.paddleResetAction = chosen;
      }
      this.paddleResetTime = performance.now() + duration * 1000 * 0.9;
    } else {
      this.paddleActionName = null;
      if (actions?.[IDLE_ACTION]) {
        this.paddleResetAction = IDLE_ACTION;
      } else if (actions?.idle) {
        this.paddleResetAction = 'idle';
      } else {
        this.paddleResetAction = null;
      }
      this.paddleResetTime = performance.now() + 400;
    }

    this.paddleCooldown = PADDLE_COOLDOWN;

    this._pendingImpulse = {
      at: performance.now() + 240,
      lateralSign: -lateralSign
    };
  }

  updateBoatPhysics(deltaOverride) {
    const now = performance.now();
    if (this.lastUpdateTime === null) {
      this.lastUpdateTime = now;
    }
    const delta = deltaOverride ?? (now - this.lastUpdateTime) / 1000;
    this.lastUpdateTime = now;

    if (this.paddleCooldown > 0) {
      this.paddleCooldown = Math.max(0, this.paddleCooldown - delta);
    }

    const dampingFactor = Math.exp(-LINEAR_DAMPING * delta);
    this.velocity.multiplyScalar(dampingFactor);
    this.velocity.y = 0;
    const angularDamping = Math.exp(-ANGULAR_DAMPING * delta);
    this.angularVelocity *= angularDamping;

    this.mesh.position.addScaledVector(this.velocity, delta);
    this.mesh.rotation.y += this.angularVelocity * delta;

    const waterDepth = getWaterDepth(this.mesh.position.x, this.mesh.position.z);
    if (waterDepth > 0) {
      this.mesh.position.y = FLOAT_HEIGHT;
    } else {
      const groundY = getTerrainHeight(this.mesh.position.x, this.mesh.position.z);
      this.mesh.position.y = groundY + FLOAT_HEIGHT * 0.2;
    }

    this.mesh.updateMatrixWorld(true);
    this.alignOccupant();

    if (this.paddleResetTime && now >= this.paddleResetTime) {
      if (this.paddleResetAction) {
        this.playOccupantAction(this.paddleResetAction);
      }
      this.paddleActionName = null;
      this.paddleResetTime = 0;
    }

    if (this._pendingImpulse && now >= this._pendingImpulse.at) {
      const { lateralSign } = this._pendingImpulse;
      const forward = this.getForwardVector(TEMP_FORWARD);
      const right = this.getRightVector(TEMP_RIGHT);
      this.velocity.addScaledVector(forward, PADDLE_FORWARD_IMPULSE);
      this.velocity.addScaledVector(right, PADDLE_SIDE_IMPULSE * lateralSign);
      this.angularVelocity += lateralSign * PADDLE_TURN_RATE;
      this._pendingImpulse = null;
    }
  }

  update(deltaOverride) {
    if (!this.mesh) return;

    const boatMode = this.usesBoatControls();
    if (boatMode && !this._wasBoatMode) {
      this.enterBoatMode();
    } else if (!boatMode && this._wasBoatMode) {
      this.exitBoatMode();
    }
    this._wasBoatMode = boatMode;

    if (boatMode) {
      this.updateBoatPhysics(deltaOverride);
      return;
    }

    this.lastUpdateTime = null;

    if (this.occupant) {
      const HOLDING_OFFSET = new THREE.Vector3(0.1, -0.5, -1.2);
      const SWIM_OFFSET = new THREE.Vector3(-0.55, -0.1, -1.1);
      const HOLDING_ROT_OFFSET_EULER = new THREE.Euler(Math.PI, Math.PI / 2, Math.PI / 2, 'YXZ');
      const SWIM_ROT_OFFSET_EULER = new THREE.Euler(-Math.PI / 2, Math.PI, 0, 'YXZ');
      const POS_LERP = 0.0;
      const ROT_SLERP = 0.0;

      const player = this.occupant;
      const playerWorldPos = player.playerModel.getWorldPosition(new THREE.Vector3());
      const playerWorldQ = player.playerModel.getWorldQuaternion(new THREE.Quaternion());

      const localPosOffset = (player.isInWater ? SWIM_OFFSET : HOLDING_OFFSET);
      const rotOffsetEuler = (player.isInWater ? SWIM_ROT_OFFSET_EULER : HOLDING_ROT_OFFSET_EULER);

      const worldOffset = localPosOffset.clone().applyQuaternion(playerWorldQ);
      const targetPos = playerWorldPos.clone().add(worldOffset);

      const rotOffsetQ = new THREE.Quaternion().setFromEuler(rotOffsetEuler);
      const targetQ = playerWorldQ.clone().multiply(rotOffsetQ);

      if (POS_LERP > 0) {
        this.mesh.position.lerp(targetPos, POS_LERP);
      } else {
        this.mesh.position.copy(targetPos);
      }

      if (ROT_SLERP > 0) {
        this.mesh.quaternion.slerp(targetQ, ROT_SLERP);
      } else {
        this.mesh.quaternion.copy(targetQ);
      }

      this.velocity.set(0, 0, 0);
      this.angularVelocity = 0;
      this.mesh.updateMatrixWorld(true);
    } else {
      const lastNetwork = this.mesh?.userData?.lastNetworkUpdate || 0;
      if (performance.now() - lastNetwork < 200) {
        return;
      }
      const t = this.mesh.position;
      const waterDepth = getWaterDepth(t.x, t.z);
      const onWater = waterDepth > 0;
      const halfThickness = 0.05;
      if (onWater) {
        this.mesh.position.y = 0 + halfThickness;
      } else {
        this.mesh.position.y = getTerrainHeight(t.x, t.z) + halfThickness;
      }
    }
  }
}

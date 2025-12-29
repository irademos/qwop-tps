import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { getWaterDepth, getTerrainHeight } from './water.js';

// Easily tweakable placement and gameplay constants
const DEFAULT_BOAT_POSITION = new THREE.Vector3(8, 0, 14);
const BOAT_SCALE = 0.01;
const createOarTransform = (position, rotation) => {
  const quaternion = new THREE.Quaternion().setFromEuler(rotation);
  return { position, quaternion };
};

// Sweep angles for the PIVOT (yaw-like stroke). Tune +/- degrees.
const deg = THREE.MathUtils.degToRad;
const OAR_PIVOT_TARGETS = {
  stowed: new THREE.Quaternion().setFromEuler(new THREE.Euler(0,  deg(-60), 0, 'YXZ')),
  idle:   new THREE.Quaternion().setFromEuler(new THREE.Euler(0,  deg(  0), 0, 'YXZ')),
  paddleLeft:  new THREE.Quaternion().setFromEuler(new THREE.Euler(0, deg(+35), 0, 'YXZ')),
  paddleRight: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, deg(-35), 0, 'YXZ')),
};

const OAR_INTERPOLATION_SPEED = 7.5;
const MOUNT_LOCAL_POSITION = new THREE.Vector3(-20.0, 95.0, 0.0);
const MOUNT_LOCAL_ROTATION = new THREE.Euler(0, Math.PI/2, 0, 'YXZ');
const FLOAT_HEIGHT = -0.15;
const LINEAR_DAMPING = 0.9;
const ANGULAR_DAMPING = 3.2;
const PADDLE_FORWARD_IMPULSE = 2.2;
const PADDLE_SIDE_IMPULSE = 0.7;
const PADDLE_TURN_RATE = 1.5;
const PADDLE_COOLDOWN = 0.25; // seconds

const TEMP_POSITION = new THREE.Vector3();
const TEMP_QUATERNION = new THREE.Quaternion();
const TEMP_LOCAL_MATRIX = new THREE.Matrix4();
const TEMP_WORLD_MATRIX = new THREE.Matrix4();
const TEMP_OFFSET = new THREE.Vector3();
const TEMP_FORWARD = new THREE.Vector3();
const TEMP_RIGHT = new THREE.Vector3();
const TEMP_UP = new THREE.Vector3();
const UNIT_SCALE = new THREE.Vector3(1, 1, 1);
const TEMP_SCALE = new THREE.Vector3();
const STROKE_DURATION = 0.6;   // seconds, full out-and-back
const CATCH_FRACTION  = 0.4;   // when the blade "bites" (0..1)


export class RowBoat {
  constructor(scene) {
    this.scene = scene;
    this.mesh = null;
    this.oar = null;
    this.occupant = null;
    this.type = 'rowboat';

    this.velocity = new THREE.Vector3();
    this.angularVelocity = 0;
    this.paddleCooldown = 0;
    this.paddleResetTime = 0;
    this.paddleActionName = null;
    this.oarResetTime = 0;
    this.lastUpdateTime = null;
    this.oarState = 'stowed';
    this.oarTargetPosition = new THREE.Vector3();
    this.oarTargetQuaternion = new THREE.Quaternion();

    this.boundingSize = new THREE.Vector3(4, 1.5, 1.5);
    this.boundingCenterOffset = new THREE.Vector3();
    this.oarPivot = null;
    this.oarStroke = null; // { side:'left'|'right', start:number(ms), dur:number(ms), returning:boolean }
  }

  

  async load(position = DEFAULT_BOAT_POSITION) {
    const loader = new GLTFLoader();

    try {
      const boatGltf = await loader.loadAsync('/assets/props/row_boat.glb');
      this.mesh = boatGltf.scene;
    } catch (error) {
      console.warn('Failed to load row boat model, using placeholder box.', error);
      const geometry = new THREE.BoxGeometry(4, 1, 1.5);
      const material = new THREE.MeshStandardMaterial({ color: 0x8d5524 });
      this.mesh = new THREE.Mesh(geometry, material);
    }

    this.mesh.name = 'RowBoat';
    this.mesh.scale.setScalar(BOAT_SCALE);
    this.mesh.position.copy(position);
    // this.mesh.rotation.set(0, -Math.PI / 2, 0);
    this.scene.add(this.mesh);
    this.mesh.updateMatrixWorld(true);

    try {
      const oarGltf = await loader.loadAsync('/assets/props/oar.glb');
      this.oar = oarGltf.scene;
    } catch (error) {
      console.warn('Failed to load oar model, using placeholder cylinder.', error);
      const geometry = new THREE.CylinderGeometry(0.03, 0.03, 3, 8);
      const material = new THREE.MeshStandardMaterial({ color: 0xdeb887 });
      this.oar = new THREE.Mesh(geometry, material);
    }

    if (this.oar) {
      this.oar.name = 'RowBoatOar';
      this.oar.scale.setScalar(5.0);
      // Hinge/pivot placed at the oarlock (use your idle state position)
      this.oarPivot = new THREE.Object3D();
      this.oarPivot.position.set(0, 90.0, -0.2); // was idle.position
      this.mesh.add(this.oarPivot);
      // Fix the oar under the pivot; orient once
      this.oarPivot.add(this.oar);
      this.oar.position.set(0, 0, 0);
      this.oar.rotation.set(-Math.PI/2 + 0.1, 0, 0);
      this.setOarState('idle', { immediate: true });
    }

    const bbox = new THREE.Box3().setFromObject(this.mesh);
    bbox.getSize(this.boundingSize);
    const center = new THREE.Vector3();
    bbox.getCenter(center);
    this.boundingCenterOffset.copy(center).sub(this.mesh.position);

    return this.mesh;
  }

  setOarState(stateName, { immediate = false } = {}) {
    if (!this.oarPivot) return;
    const qTarget = OAR_PIVOT_TARGETS[stateName] || OAR_PIVOT_TARGETS.idle;
    this.oarTargetQuaternion.copy(qTarget);
    this.oarState = stateName in OAR_PIVOT_TARGETS ? stateName : 'idle';
    if (immediate) this.oarPivot.quaternion.copy(this.oarTargetQuaternion);
  }

  updateOar(delta) {
    if (!this.oarPivot) return;
    const f = 1 - Math.exp(-OAR_INTERPOLATION_SPEED * delta);
    if (!Number.isFinite(f)) return;
    this.oarPivot.quaternion.slerp(this.oarTargetQuaternion, f);
  }

  getMountWorldTransform(outPosition = TEMP_POSITION, outQuaternion = TEMP_QUATERNION) {
    if (!this.mesh) {
      outPosition.set(0, 0, 0);
      outQuaternion.identity();
      return { position: outPosition, quaternion: outQuaternion };
    }

    TEMP_OFFSET.copy(MOUNT_LOCAL_POSITION);
    TEMP_QUATERNION.setFromEuler(MOUNT_LOCAL_ROTATION);
    TEMP_LOCAL_MATRIX.compose(TEMP_OFFSET, TEMP_QUATERNION, UNIT_SCALE);

    TEMP_WORLD_MATRIX.multiplyMatrices(this.mesh.matrixWorld, TEMP_LOCAL_MATRIX);
    // outPosition.setFromMatrixPosition(TEMP_WORLD_MATRIX);
    // outQuaternion.setFromRotationMatrix(TEMP_WORLD_MATRIX);
    
    TEMP_WORLD_MATRIX.decompose(outPosition, outQuaternion, TEMP_SCALE);

    return { position: outPosition, quaternion: outQuaternion };
  }

  tryMount(playerControls) {
    if (!this.mesh || this.occupant) return;
    if (!playerControls?.playerModel) return;

    const playerPosition = playerControls.playerModel.position;
    const distance = playerPosition.distanceTo(this.mesh.position);
    if (distance > 4) return;

    this.occupant = playerControls;
    playerControls.vehicle = this;
    playerControls.isMoving = false;
    this.alignOccupant();
    this.playOccupantAction('sit');
    this.setOarState('idle');
    this.paddleCooldown = 0;
    this.paddleActionName = null;
    this.paddleResetTime = 0;
    this.oarResetTime = 0;
    playerControls.yaw = -this.mesh.rotation.y;
  }

  dismount() {
    if (!this.occupant) return;

    const exitPos = this.mesh.position.clone();
    TEMP_FORWARD.set(0, 0, 1).applyQuaternion(this.mesh.quaternion);
    exitPos.addScaledVector(TEMP_FORWARD, -1.2);
    exitPos.y += 0.2;

    const playerControls = this.occupant;
    const { playerModel, body } = playerControls;
    if (playerModel) {
      playerModel.position.copy(exitPos);
      playerModel.rotation.y = this.mesh.rotation.y;
      playerModel.userData.currentAction = playerModel.userData.currentAction || 'idle';
      this.playOccupantAction('idle');
    }
    if (body) {
      body.setTranslation({ x: exitPos.x, y: exitPos.y, z: exitPos.z }, true);
      body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    }

    playerControls.vehicle = null;
    this.occupant = null;
    this.paddleActionName = null;
    this.setOarState('stowed');
    this.oarResetTime = 0;
  }

  paddleLeft() {
    this.triggerPaddle('paddleLeft', 1);
  }

  paddleRight() {
    this.triggerPaddle('paddleRight', -1);
  }

  triggerPaddle(actionName, lateralSign) {
    lateralSign *= -1;
    if (!this.occupant || !this.mesh) return;
    if (this.paddleCooldown > 0) return;

    const actions = this.occupant.playerModel?.userData?.actions;
    if (!actions || !actions[actionName]) return;

    this.playOccupantAction(actionName, { immediate: true });

    const actionClip = actions[actionName]._clip || actions[actionName].getClip?.();
    const duration = actionClip?.duration ?? 0.8;
    this.paddleActionName = actionName;
    this.paddleResetTime = performance.now() + duration * 1000 * 0.9;
    this.paddleCooldown = PADDLE_COOLDOWN;
    this.setOarState(actionName === 'paddleLeft' ? 'paddleLeft' : 'paddleRight');
    this.oarResetTime = this.paddleResetTime;

    const forward = TEMP_FORWARD;//.set(0, 0, 1).applyQuaternion(this.mesh.quaternion);
    this.mesh.getWorldDirection(forward);
    forward.applyAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);

    const right = TEMP_RIGHT;//.copy(forward).cross(TEMP_UP.set(0, 1, 0)).normalize();
    right.copy(new THREE.Vector3(0, 1, 0)).cross(forward).normalize();
    // const right = TEMP_RIGHT.copy(forward).cross(new THREE.Vector3(0, 1, 0)).normalize();
    // const right = TEMP_RIGHT.set(1, 0, 0).applyQuaternion(this.mesh.quaternion);

    // Defer forces to mid-stroke for better feel
    this._pendingImpulse = {
      at: performance.now() + 240, // ~0.24s into the stroke; tune
      lateralSign
    };
  }

  playOccupantAction(name, { immediate = false } = {}) {
    if (!this.occupant) return;
    const actions = this.occupant.playerModel?.userData?.actions;
    if (!actions || !actions[name]) return;

    const current = this.occupant.playerModel.userData.currentAction;
    if (current === name && !immediate) return;

    actions[current]?.fadeOut(0.2);
    actions[name].reset().fadeIn(0.1).play();
    this.occupant.playerModel.userData.currentAction = name;
  }

  alignOccupant() {
    if (!this.occupant) return;
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

  update(deltaOverride) {
    if (!this.mesh) return;

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
    this.updateOar(delta);

    if (this.occupant) {
      this.alignOccupant();
      if (this.paddleActionName && now >= this.paddleResetTime) {
        this.playOccupantAction('sit');
        this.paddleActionName = null;
        this.setOarState('idle');
      }
      if (this.oarResetTime && now >= this.oarResetTime) {
        this.setOarState('idle');
        this.oarResetTime = 0;
      }
    } else if (this.oarState !== 'stowed') {
      this.setOarState('stowed');
      this.oarResetTime = 0;
    }
    // apply deferred stroke forces at the catch
    if (this._pendingImpulse && performance.now() >= this._pendingImpulse.at) {
      const { lateralSign } = this._pendingImpulse;
      const forward = TEMP_FORWARD;
      this.mesh.getWorldDirection(forward);
      forward.applyAxisAngle(TEMP_UP.set(0,1,0), Math.PI / 2);
      const right = TEMP_RIGHT.copy(TEMP_UP).cross(forward).normalize();
      this.velocity.addScaledVector(forward, PADDLE_FORWARD_IMPULSE);
      this.velocity.addScaledVector(right, PADDLE_SIDE_IMPULSE * lateralSign);
      this.angularVelocity += lateralSign * PADDLE_TURN_RATE;
      this._pendingImpulse = null;
    }
  }
}

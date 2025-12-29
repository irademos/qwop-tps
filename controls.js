import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { getWaterDepth, SWIM_DEPTH_THRESHOLD, getTerrainHeight } from './water.js';
import { MOON_RADIUS } from "./worldGeneration.js";
import { getSpawnPosition } from './spawnUtils.js';

// Movement constants
const SPEED = 5;
const SWIM_SPEED = 2;
const JUMP_FORCE = 5;
const PLAYER_RADIUS = 0.3;
const PLAYER_HALF_HEIGHT = 0.6;
const FLOAT_IDLE_DISPLAY_OFFSET = 0.2;

export class PlayerControls {
  constructor({ scene, camera, playerModel, renderer, multiplayer, spawnProjectile, projectiles, audioManager }) {
    this.yaw = 0;
    this.pitch = 0;
    this.pointerLocked = false;
    this.renderer = renderer;
    this.domElement = this.renderer.domElement;
    this.scene = scene;
    this.playerModel = playerModel;
    this.camera = camera;
    this.multiplayer = multiplayer;
    this.lastPosition = new THREE.Vector3();
    this.wasMoving = false;
    this.isMoving = false;
    this.spawnProjectile = spawnProjectile;
    this.projectiles = projectiles;
    this.audioManager = audioManager;
    this.isKnocked = false;
    this.knockbackRestYaw = 0;
    this.slideMomentum = new THREE.Vector3();
    this.lastMoveDirection = new THREE.Vector3();
    this.grabbedTarget = null;
    this.isGrabbed = false;
    this.grabberId = null;
    this.externalGrabPos = null;

    this.vehicle = null;

    this.isInWater = false;
    this.waterDepth = 0;

    this.parachute = null;

    // Player state
    this.canJump = true;
    this.keysPressed = new Set();
    this.isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    this.hasDoubleJumped = false;
    this.currentSpecialAction = null;
    this.runningKickTimer = null;
    this.runningKickOriginalY = 0;
    
    // Mobile control variables
    this.joystick = null;
    this.touchStartX = 0;
    this.touchStartY = 0;
    this.touchSensitivity = 0.005;
    this.moveVector = { x: 0, z: 0 };
    this.jumpButtonPressed = false;
    this.moveForward = 0;
    this.moveRight = 0;
    
    // Initial player position
    const spawn = getSpawnPosition();
    this.playerX = spawn.x;
    this.playerY = spawn.y;
    this.playerZ = spawn.z;

    
    // Set initial player model position if it exists
    if (this.playerModel) {
      this.playerModel.position.set(this.playerX, this.playerY, this.playerZ);
      this.lastPosition.set(this.playerX, this.playerY, this.playerZ);
    }
    
    const world = window.rapierWorld;
    if (world) {
      const rbDesc = RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(this.playerX, this.playerY, this.playerZ)
        .setLinearDamping(0.9)
        .setAngularDamping(0.9);
      this.body = world.createRigidBody(rbDesc);
      const colDesc = RAPIER.ColliderDesc
        .capsule(PLAYER_HALF_HEIGHT, PLAYER_RADIUS)
        .setRestitution(0)
        .setFriction(1);
      world.createCollider(colDesc, this.body);
    }

    // Set camera to third-person perspective
    this.camera.position.set(this.playerX, this.playerY + 2, this.playerZ + 5);
    this.camera.lookAt(this.playerX, this.playerY + 1, this.playerZ);
    // Store the initial camera offset (relative to player's target position)
    this.cameraOffset = new THREE.Vector3();
    this.cameraOffset.copy(this.camera.position).sub(new THREE.Vector3(this.playerX, this.playerY + 1, this.playerZ));

    // Initialize controls based on device
    this.initializeControls();

    // Setup event listeners
    this.setupEventListeners();

    this.enabled = true; // Add enabled flag for chat input

    this.interactionPromptEl = document.getElementById('interaction-tooltip');

    if (this.isMobile && this.interactionPromptEl) {
      const activateInteraction = (event) => {
        if (!this.interactionPromptEl.classList.contains('visible')) return;
        event.preventDefault();
        this.handleInteractionAction();
      };
      this.interactionPromptEl.addEventListener('touchstart', activateInteraction, { passive: false });
      this.interactionPromptEl.addEventListener('click', activateInteraction);
    }

    this.ammo = 10;
    this.maxAmmo = 30;
    this.ammoContainerEl = document.getElementById('ammo-display');
    this.ammoCountEl = document.getElementById('ammo-count');
    this.lastAmmoValue = null;
    this.lastAmmoEmpty = null;
    this.lastHasGun = null;
    this.updateAmmoUI(window.iceGun?.holder === this);
  }

  setPlayerModel(newModel) {
    if (this.parachute && this.playerModel && this.parachute.parent === this.playerModel) {
      this.playerModel.remove(this.parachute);
    }

    this.playerModel = newModel;

    if (this.parachute && this.playerModel) {
      this.playerModel.add(this.parachute);
    }

    if (this.playerModel) {
      if (this.body && typeof this.body.translation === 'function') {
        const t = this.body.translation();
        this.playerModel.position.set(t.x, t.y, t.z);
      }
      this.lastPosition.copy(this.playerModel.position);
    }
  }

  initializeControls() {
    if (this.isMobile) {
      this.initializeMobileControls();
    } else {
      // this.setupPointerLock(); // leave pointer lock in PlayerControls
    }
  }
  
  initializeMobileControls() {
    // Add joystick container for mobile
    const joystickContainer = document.getElementById('joystick-container');
    if (!joystickContainer) {
      const newJoystickContainer = document.createElement('div');
      newJoystickContainer.id = 'joystick-container';
      document.body.appendChild(newJoystickContainer);
    }
    
    // Add jump button for mobile
    const jumpButton = document.getElementById('jump-button');
    if (!jumpButton) {
      const newJumpButton = document.createElement('div');
      newJumpButton.id = 'jump-button';
      newJumpButton.innerText = 'JUMP';
      document.body.appendChild(newJumpButton);
    }
    
    // Jump button event listeners
    document.getElementById('jump-button').addEventListener('touchstart', (event) => {
      if (!this.enabled || this.isInWater) return;
      this.jumpButtonPressed = true;
      if (this.canJump && this.body) {
        this.body.applyImpulse({ x: 0, y: JUMP_FORCE, z: 0 }, true);
        this.canJump = false;
      }
      event.preventDefault();
    });

    document.getElementById('jump-button').addEventListener('touchend', (event) => {
      if (!this.enabled || this.isInWater) return;
      this.jumpButtonPressed = false;
      event.preventDefault();
    });
    
    // Initialize joystick with improved behavior
    this.joystick = nipplejs.create({
      zone: document.getElementById('joystick-container'),
      mode: 'static',
      position: { left: '50%', top: '50%' },
      color: 'rgba(255, 255, 255, 0.5)',
      size: 100
    });
    
    this.joystick.on('move', (evt, data) => {
      const angle = data.angle.radian;
      this.joystickAngle = angle;
      this.joystickForce = Math.min(data.force, 1);
    
      // this.yaw = -angle; // Flip joystick angle to align with world yaw
    });
    
    this.joystick.on('end', () => {
      this.joystickForce = 0;
    });

    // Touch camera control
    this.cameraTouchId = null;
    this.domElement.addEventListener('touchstart', (event) => {
      if (!this.enabled) return;
      for (const touch of event.changedTouches) {
        const target = document.elementFromPoint(touch.clientX, touch.clientY);
        if (target && !target.closest('#joystick-container') && !target.closest('#jump-button') && !target.closest('#action-buttons')) {
          this.cameraTouchId = touch.identifier;
          this.touchStartX = touch.clientX;
          this.touchStartY = touch.clientY;
          event.preventDefault();
          break;
        }
      }
    }, { passive: false });

    this.domElement.addEventListener('touchmove', (event) => {
      if (!this.enabled || this.cameraTouchId === null) return;
      for (const touch of event.changedTouches) {
        if (touch.identifier === this.cameraTouchId) {
          const deltaX = touch.clientX - this.touchStartX;
          const deltaY = touch.clientY - this.touchStartY;
          this.touchStartX = touch.clientX;
          this.touchStartY = touch.clientY;

          this.yaw -= deltaX * this.touchSensitivity;
          this.pitch -= deltaY * this.touchSensitivity;

          const maxPitch = Math.PI / 3;
          const minPitch = -Math.PI / 8;
          this.pitch = Math.max(minPitch, Math.min(maxPitch, this.pitch));
          event.preventDefault();
          break;
        }
      }
    }, { passive: false });

    this.domElement.addEventListener('touchend', (event) => {
      for (const touch of event.changedTouches) {
        if (touch.identifier === this.cameraTouchId) {
          this.cameraTouchId = null;
          break;
        }
      }
    });

    // Action buttons container
    const actionContainer = document.getElementById('action-buttons');

    const toggleButton = document.getElementById('mobile-action-toggle');
    if (actionContainer && toggleButton) {
      const setExpanded = (expanded) => {
        actionContainer.classList.toggle('mobile-expanded', expanded);
        toggleButton.setAttribute('aria-expanded', expanded ? 'true' : 'false');
        toggleButton.textContent = expanded ? '✕' : '⋯';
      };

      setExpanded(false);

      const handleToggle = (event) => {
        event.preventDefault();
        const nextState = !actionContainer.classList.contains('mobile-expanded');
        setExpanded(nextState);
      };

      toggleButton.addEventListener('touchstart', handleToggle, { passive: false });
      toggleButton.addEventListener('click', handleToggle);
    }

    // Fire button
    if (!document.getElementById('fire-button')) {
      const newFireButton = document.createElement('button');
      newFireButton.id = 'fire-button';
      newFireButton.className = 'action-button mobile-action';
      newFireButton.innerText = 'FIRE';
      actionContainer.appendChild(newFireButton);
    }

    document.getElementById('fire-button').addEventListener('touchstart', (event) => {
      if (!this.enabled) return;
      if (this.attemptFireProjectile()) {
        event.preventDefault();
      }
    });

    // Kick button
    if (!document.getElementById('kick-button')) {
      const kickButton = document.createElement('button');
      kickButton.id = 'kick-button';
      kickButton.className = 'action-button mobile-action';
      kickButton.innerText = 'KICK';
      actionContainer.appendChild(kickButton);
      kickButton.addEventListener('touchstart', (event) => {
        if (!this.enabled || this.isInWater) return;
        this.playAction('mmaKick');
        event.preventDefault();
      });
    }

    // Punch button
    if (!document.getElementById('punch-button')) {
      const punchButton = document.createElement('button');
      punchButton.id = 'punch-button';
      punchButton.className = 'action-button mobile-action';
      punchButton.innerText = 'PUNCH';
      actionContainer.appendChild(punchButton);
      punchButton.addEventListener('touchstart', (event) => {
        if (!this.enabled || this.isInWater) return;
        this.playAction('mutantPunch');
        event.preventDefault();
      });
    }
  }
  
  setupEventListeners() {
    // Listen for key events (for desktop controls)
    document.addEventListener("keydown", (e) => {
      if (!this.enabled) return;
      const key = e.key.toLowerCase();
      this.keysPressed.add(key);

      if (this.vehicle) {
        if (key === 'x') {
          this.vehicle.dismount();
          return;
        }

        const boatControls = this.vehicle.type === 'rowboat' ||
          (this.vehicle.type === 'surfboard' && this.vehicle.usesBoatControls?.());

        if (boatControls) {
          if (e.repeat) return;
          if (key === 'z') {
            this.vehicle.paddleLeft?.();
            return;
          } else if (key === 'c') {
            this.vehicle.paddleRight?.();
            return;
          }
          if (this.vehicle.type === 'rowboat') {
            return;
          }
        }

        if (this.vehicle.type !== 'surfboard') {
          return;
        }

      }

      if (key === 'x') {
        this.handleInteractionAction();
        return;
      }

      if (e.key === " ") {
        if (this.parachute) {
          this.removeParachute();
          return;
        }
        if (this.isInWater) return;
        if (this.canJump && this.body) {
          this.body.applyImpulse({ x: 0, y: JUMP_FORCE, z: 0 }, true);
          this.canJump = false;
          this.hasDoubleJumped = false;
        } else if (!this.hasDoubleJumped && this.body) {
          this.body.applyImpulse({ x: 0, y: JUMP_FORCE, z: 0 }, true);
          this.hasDoubleJumped = true;
          this.playAction('hurricaneKick');
        }
      } else if (key === 'e') {
        if (this.vehicle) if (this.vehicle.type === 'surfboard') this.vehicle.toggleStand();
        if (this.isInWater) return;
        if (this.isMoving) {
          this.slideMomentum.copy(this.lastMoveDirection).multiplyScalar(0.5);
        }
        this.playAction('mutantPunch');
        this.audioManager?.playAttack();
      } else if (key === 'r') {
        if (this.isInWater) return;
        if (this.isMoving) {
          this.slideMomentum.copy(this.lastMoveDirection).multiplyScalar(1.4);
          this.playAction('runningKick');
          this.audioManager?.playAttack();
        } else {
          this.playAction('mmaKick');
          this.audioManager?.playAttack();
        }
      } else if (key === 'g') {
        if (this.grabbedTarget) {
          this.releaseGrab();
        } else {
          this.attemptGrab();
        }
      }
    });

    document.addEventListener("keyup", (e) => {
      this.keysPressed.delete(e.key.toLowerCase());
    });
    
    // Handle window resize
    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      if (this.renderer) {
        this.renderer.setSize(window.innerWidth, window.innerHeight);
      }
    });

    this.domElement.addEventListener("click", (event) => {
      // Don't fire if chat or settings are open
      if (!this.enabled || this.isMobile) return;
      this.attemptFireProjectile();
    });
  }

  handleInteractionAction() {
    if (!this.enabled) return;

    if (this.vehicle) {
      this.vehicle.dismount?.();
      return;
    }

    const iceGun = window.iceGun;
    if (iceGun?.holder === this) {
      iceGun.tryPickup?.(this);
      return;
    }

    window.spaceship?.tryMount(this);
    window.surfboard?.tryMount(this);
    window.rowBoat?.tryMount(this);
    iceGun?.tryPickup?.(this);
  }

  playAction(actionName) {
    if (!this.playerModel) return;
    const actions = this.playerModel.userData.actions;
    if (!actions || !actions[actionName]) return;

    if (this.runningKickTimer) {
      clearTimeout(this.runningKickTimer);
      this.runningKickTimer = null;
      const pivot = this.playerModel.userData.pivot;
      if (pivot) {
        pivot.rotation.y = this.runningKickOriginalY;
      }
    }

    const current = this.playerModel.userData.currentAction;
    const action = actions[actionName];
    actions[current]?.fadeOut(0.1);
    action.reset().fadeIn(0.1).play();
    this.playerModel.userData.currentAction = actionName;
    this.currentSpecialAction = actionName;

    if (["mutantPunch", "hurricaneKick", "mmaKick", "runningKick"].includes(actionName)) {
      this.playerModel.userData.attack = {
        name: actionName,
        start: Date.now(),
        hasHit: false,
      };
    }

    const mixer = this.playerModel.userData.mixer;
    const onFinished = (e) => {
      if (e.action === action) {
        mixer.removeEventListener("finished", onFinished);
        this.currentSpecialAction = null;
      }
    };
    mixer.addEventListener("finished", onFinished);
  }

  applyKnockback(impulse) {
    if (this.body) {
      this.body.applyImpulse({ x: impulse.x, y: impulse.y, z: impulse.z }, true);
    }
    this.isKnocked = true;
    this.knockbackRestYaw = this.playerModel.rotation.y;
    const actions = this.playerModel.userData.actions;
    const current = this.playerModel.userData.currentAction;
    const hitAction = actions?.hit;
    if (hitAction) {
      actions[current]?.fadeOut(0.1);
      hitAction.reset().fadeIn(0.1).play();
      this.playerModel.userData.currentAction = 'hit';
    }
  }

  processMovement() {
    if (!this.enabled) return;

    if (this.vehicle && this.vehicle.type === 'spaceship') {
      const yaw = (this.keysPressed.has("a") ? 1 : 0) + (this.keysPressed.has("d") ? -1 : 0);
      const thrust = this.keysPressed.has(" ");
      const pitch = thrust ? (this.keysPressed.has("w") ? 1 : 0) + (this.keysPressed.has("s") ? -1 : 0) : 0;
      this.vehicle.applyInput({ thrust, yaw, pitch });
      this.isMoving = thrust;
      return;
    }

    if (this.vehicle) {
      const boatControls = this.vehicle.type === 'rowboat' ||
        (this.vehicle.type === 'surfboard' && this.vehicle.usesBoatControls?.());
      if (boatControls) {
        this.isMoving = false;
        this.vehicle.alignOccupant?.();
        return;
      }
    }

    if (!this.body) return;
    const t = this.body.translation();
    const vel = this.body.linvel();

    this.waterDepth = getWaterDepth(t.x, t.z);
    const surfaceY = 0;
    const floatTargetY = surfaceY + PLAYER_HALF_HEIGHT + PLAYER_RADIUS;
    this.isInWater = this.waterDepth > SWIM_DEPTH_THRESHOLD && t.y < floatTargetY;

    if (this.isGrabbed) {
      // Freeze movement and follow externally provided position
      this.body.setLinvel({ x: 0, y: vel.y, z: 0 }, true);
      if (this.externalGrabPos) {
        t.x = this.externalGrabPos.x;
        t.y = this.externalGrabPos.y;
        t.z = this.externalGrabPos.z;
        this.body.setTranslation(this.externalGrabPos, true);
      }
      if (this.playerModel) {
        this.playerModel.position.set(t.x, t.y, t.z);
      }
      return;
    }

    const terrainY = getTerrainHeight(t.x, t.z);
    let groundY = terrainY;
    const world = window.rapierWorld;
    if (world) {
      const ray = new RAPIER.Ray({ x: t.x, y: t.y, z: t.z }, { x: 0, y: -1, z: 0 });
      const hit = world.castRay(ray, t.y + 10, true, undefined, undefined, undefined, this.body);
      if (hit) {
        const hitDist = hit.toi ?? hit.timeOfImpact;
        const hitY = t.y - hitDist;
        if (hitY > groundY) groundY = hitY;
      }
    }
    const groundExpectedY = groundY + PLAYER_HALF_HEIGHT + PLAYER_RADIUS;
    const grounded = !this.isInWater && t.y <= groundExpectedY + 0.05;
    if (grounded && !this.isInWater) {
      this.canJump = true;
      this.hasDoubleJumped = false;
    } else {
      this.canJump = false;
    }
    if (this.isInWater) {
      if (this.keysPressed.has(" ")) {
        const newY = t.y - 0.2;
        this.body.setTranslation({ x: t.x, y: newY, z: t.z }, true);
        this.body.setLinvel({ x: vel.x, y: -1, z: vel.z }, true);
        t.y = newY;
      } else if (t.y < floatTargetY) {
        const newY = t.y + (floatTargetY - t.y) * 0.1;
        this.body.setTranslation({ x: t.x, y: newY, z: t.z }, true);
        if (vel.y < 0) {
          this.body.setLinvel({ x: vel.x, y: 0, z: vel.z }, true);
        }
        t.y = newY;
      }
    } else if (t.y < groundExpectedY) {
      this.body.setTranslation({ x: t.x, y: groundExpectedY, z: t.z }, true);
      if (vel.y < 0) {
        this.body.setLinvel({ x: vel.x, y: 0, z: vel.z }, true);
      }
      t.y = groundExpectedY;
    }
    const moveDirection = new THREE.Vector3(0, 0, 0);
    const movementLocked = ['mutantPunch', 'mmaKick', 'runningKick'].includes(this.currentSpecialAction);
    if (!movementLocked) {
      if (this.isMobile) {
        if (this.joystickForce > 0.1) {
          const cameraForward = new THREE.Vector3();
          this.camera.getWorldDirection(cameraForward);
          cameraForward.y = 0;
          cameraForward.normalize();
          const cameraRight = new THREE.Vector3().crossVectors(cameraForward, new THREE.Vector3(0, 1, 0)).normalize();
          const dx = Math.cos(this.joystickAngle);
          const dz = Math.sin(this.joystickAngle);
          moveDirection.addScaledVector(cameraForward, dz * this.joystickForce);
          moveDirection.addScaledVector(cameraRight, dx * this.joystickForce);
        }
      } else {
        if (this.keysPressed.has("w")) moveDirection.z = 1;
        if (this.keysPressed.has("s")) moveDirection.z = -1;
        if (this.keysPressed.has("a")) moveDirection.x = 1;
        if (this.keysPressed.has("d")) moveDirection.x = -1;
      }
    }
    if (!this.isMobile && moveDirection.length() > 0) moveDirection.normalize();
    const cameraDirection = new THREE.Vector3();
    this.camera.getWorldDirection(cameraDirection);
    cameraDirection.y = 0;
    cameraDirection.normalize();
    const rightVector = new THREE.Vector3();
    rightVector.crossVectors(this.camera.up, cameraDirection).normalize();
    const movement = new THREE.Vector3();
    if (!this.isMobile) {
      if (moveDirection.z !== 0) movement.add(cameraDirection.clone().multiplyScalar(moveDirection.z));
      if (moveDirection.x !== 0) movement.add(rightVector.clone().multiplyScalar(moveDirection.x));
      if (movement.length() > 0) movement.normalize();
    } else {
      movement.copy(moveDirection);
    }
    if (movementLocked) {
      movement.copy(this.slideMomentum);
      this.slideMomentum.multiplyScalar(0.99);
      if (this.slideMomentum.length() < 0.01) this.slideMomentum.set(0, 0, 0);
    } else if (movement.length() > 0) {
      this.lastMoveDirection.copy(movement);
    }
    if (this.isKnocked) {
      if (Math.hypot(vel.x, vel.y, vel.z) < 0.05) {
        this.isKnocked = false;
        this.playerModel.rotation.set(0, this.knockbackRestYaw || this.playerModel.rotation.y, 0);
        const actions = this.playerModel.userData.actions;
        actions?.hit?.fadeOut(0.2);
        actions?.idle?.reset().fadeIn(0.2).play();
        this.playerModel.userData.currentAction = 'idle';
      }
    } else {
      const speed = this.isInWater ? SWIM_SPEED : SPEED;
      this.body.setLinvel({ x: movement.x * speed, y: vel.y, z: movement.z * speed }, true);
      }
    const newX = t.x;
    const newY = t.y;
    const newZ = t.z;
    const sink = this.isInWater ? newY - surfaceY : 0;
    const isMovingNow = movement.length() > 0;
    this.isMoving = isMovingNow;
    if (isMovingNow && this.canJump) {
      this.audioManager?.playFootstep();
    }
    if (this.playerModel) {
      let displayY = newY - sink;
      if (this.isInWater && !isMovingNow && !this.vehicle) {
        displayY -= FLOAT_IDLE_DISPLAY_OFFSET;
      }
      this.playerModel.position.set(newX, displayY, newZ);
      let yawAngle = this.playerModel.rotation.y;
      if (movement.length() > 0) {
        yawAngle = Math.atan2(movement.x, movement.z);
        // this.playerModel.rotation.y = yawAngle;
      }

      const moon = window.moon;
      if (moon) {
        const playerPos = this.playerModel.position;
        const moonPos = moon.position;
        const dist = playerPos.distanceTo(moonPos);
        if (dist < MOON_RADIUS * 2) {
          const up = new THREE.Vector3().subVectors(playerPos, moonPos).normalize();
          this.playerModel.up.copy(up);
          let forward;
          if (movement.length() > 0) {
            forward = movement.clone().normalize();
          } else {
            forward = new THREE.Vector3(0, 0, 1).applyQuaternion(this.playerModel.quaternion);
          }
          forward.projectOnPlane(up).normalize();
          const target = playerPos.clone().add(forward);
          this.playerModel.lookAt(target);
          this.camera.up.copy(up);
        } else {
          this.playerModel.rotation.set(0, yawAngle, 0);
          this.playerModel.up.set(0, 1, 0);
          this.camera.up.set(0, 1, 0);
        }
      } else {
        this.playerModel.rotation.set(0, yawAngle, 0);
        this.playerModel.up.set(0, 1, 0);
        this.camera.up.set(0, 1, 0);
      }
      const actions = this.playerModel.userData.actions;
      if (actions && !this.isKnocked && !this.currentSpecialAction) {
        let actionName;
        if (this.vehicle && this.vehicle.type === 'surfboard') {
          if (this.isInWater) {
            actionName = isMovingNow ? 'swim' : 'sit';
            if (this.vehicle.standing) {
              actionName = 'idle';
            }
          } else {
            actionName = 'idle';
            if (!this.canJump) actionName = 'jump';
            else if (isMovingNow) actionName = 'run';
          }
        } else {
          if (this.isInWater) {
            actionName = isMovingNow ? 'swim' : 'float';
          } else {
            actionName = 'idle';
            if (!this.canJump) actionName = 'jump';
            else if (isMovingNow) actionName = 'run';
          }
        }
        const current = this.playerModel.userData.currentAction;
        if (actionName && current !== actionName) {
          actions[current]?.fadeOut(0.2);
          actions[actionName].reset().fadeIn(0.2).play();
          this.playerModel.userData.currentAction = actionName;
        }
      }
      const newTarget = new THREE.Vector3(this.playerModel.position.x, this.playerModel.position.y + 1, this.playerModel.position.z);
      if (this.controls) {
        this.controls.target.copy(newTarget);
      }
      if (this.multiplayer && (Math.abs(this.lastPosition.x - newX) > 0.01 || Math.abs(this.lastPosition.y - displayY) > 0.01 || Math.abs(this.lastPosition.z - newZ) > 0.01 || this.isMoving !== this.wasMoving)) {
        this.multiplayer.send({ x: newX, y: displayY, z: newZ, rotation: yawAngle, moving: this.isMoving, action: this.playerModel.userData.currentAction });
        this.lastPosition.set(newX, displayY, newZ);
        this.wasMoving = this.isMoving;
      }
    } else {
      this.camera.position.set(newX, newY + 1.2, newZ);
    }
    if (this.isMobile && this.controls) {
      this.controls.target.set(newX, newY + 1, newZ);
      this.controls.update();
    } else if (!this.isMobile && this.controls) {
      this.controls.update();
    }
  }
  
  update() {
    if (!this.keys) {
      this.keys = new Set();
      document.addEventListener('keydown', (e) => this.keys.add(e.key));
      document.addEventListener('keyup', (e) => this.keys.delete(e.key));
    }

    const rotateSpeed = 0.03;
    if (this.keys.has('ArrowLeft')) this.yaw += rotateSpeed;
    if (this.keys.has('ArrowRight')) this.yaw -= rotateSpeed;

    const maxPitch = Math.PI / 3;   // ~60° upward
    const minPitch = -Math.PI / 8;  // ~30° downward

    if (this.keys.has('ArrowUp')) {
      this.pitch = Math.min(maxPitch, this.pitch + 0.02);
    }
    if (this.keys.has('ArrowDown')) {
      this.pitch = Math.max(minPitch, this.pitch - 0.02);
    }

    let orbitCenter;
    let offset;
    if (this.vehicle && this.vehicle.mesh && this.vehicle.type !== 'surfboard') {
      const size = this.vehicle.boundingSize;
      const centerOffset = this.vehicle.boundingCenterOffset || new THREE.Vector3();
      orbitCenter = this.vehicle.mesh.position.clone().add(centerOffset);
      const maxDim = Math.max(size.x, size.y, size.z);
      const fov = THREE.MathUtils.degToRad(this.camera.fov);
      const distance = (maxDim * 0.5) / Math.tan(fov / 2) + maxDim * 0.5;
      offset = new THREE.Vector3(0, maxDim * 0.5, distance);
    } else {
      orbitCenter = this.playerModel.position.clone().add(new THREE.Vector3(0, 1, 0));
      offset = this.cameraOffset;
    }
    const rotatedOffset = new THREE.Vector3(
      offset.x * Math.cos(this.yaw) - offset.z * Math.sin(this.yaw),
      offset.y + 5 * Math.sin(this.pitch),
      offset.x * Math.sin(this.yaw) + offset.z * Math.cos(this.yaw)
    );

    this.camera.position.copy(orbitCenter).add(rotatedOffset);
    this.camera.lookAt(orbitCenter);

      const now = performance.now();
      if (!this.lastUpdate) this.lastUpdate = now;
      const delta = (now - this.lastUpdate) / 1000;
      this.lastUpdate = now;
      this.time = (now * 0.01) % 1000; // Use performance.now() for consistent timing

      if (this.playerModel && this.playerModel.userData.mixer) {
        this.playerModel.userData.mixer.update(delta);
      }

      if (this.enabled) {
        this.processMovement();
      }
      if (this.grabbedTarget) {
        this.updateGrabbedTarget();
      }

      // Always update controls even when movement is disabled
      if (this.controls) {
        this.controls.update();
      }

      this.updateInteractionPrompt();

      const hasGun = window.iceGun?.holder === this;
      if (hasGun !== this.lastHasGun) {
        this.updateAmmoUI(hasGun);
      }
  }

  updateInteractionPrompt() {
    if (!this.interactionPromptEl || !this.playerModel) return;

    let promptText = '';
    let visible = false;

    if (this.vehicle) {
      const type = this.vehicle.type;
      if (type === 'spaceship') {
        promptText = "'x' exit spaceship";
      } else if (type === 'rowboat') {
        promptText = "'x' exit rowboat";
      } else if (type === 'surfboard') {
        promptText = "'x' exit surfboard";
      }
      visible = !!promptText;
    } else {
      const iceGun = window.iceGun;
      if (iceGun?.holder === this) {
        promptText = "'x' drop gun";
        visible = true;
      } else {
        const playerPos = this.playerModel.position;
        let closestDist = Infinity;

        const consider = (object, maxDistance, message) => {
          if (!object) return;
          const target = object.mesh || object;
          if (!target || !target.position) return;
          if (object.occupant) return;
          if (object.holder) return;
          const dist = playerPos.distanceTo(target.position);
          if (dist <= maxDistance && dist < closestDist) {
            closestDist = dist;
            promptText = message;
            visible = true;
          }
        };

        consider(window.spaceship, 10, "'x' enter spaceship");
        consider(window.rowBoat, 4, "'x' enter rowboat");
        consider(window.surfboard, 3, "'x' enter surfboard");
        consider(window.iceGun, 3, "'x' pick up gun");
      }
    }

    if (visible) {
      this.interactionPromptEl.textContent = promptText;
      this.interactionPromptEl.classList.add('visible');
    } else {
      this.interactionPromptEl.classList.remove('visible');
      this.interactionPromptEl.textContent = '';
    }
  }
  
  getCamera() {
    return this.camera;
  }
  
  getPlayerModel() {
    return this.playerModel;
  }

  /**
   * Trigger a jump action programmatically.
   * Useful for alternative input methods like voice commands.
   */
  triggerJump() {
    if (!this.enabled || !this.body) return;
    if (this.canJump) {
      this.body.applyImpulse({ x: 0, y: JUMP_FORCE, z: 0 }, true);
      this.canJump = false;
    }
  }

  /**
   * Trigger a projectile fire action programmatically.
   * Useful for alternative input methods like voice commands.
   */
  triggerFire() {
    if (!this.enabled) return;
    this.attemptFireProjectile();
  }

  canFireProjectile() {
    const iceGun = window.iceGun;
    return !!iceGun && iceGun.holder === this && this.ammo > 0 && this.playerModel;
  }

  consumeAmmo() {
    if (this.ammo <= 0) return false;
    this.ammo -= 1;
    this.updateAmmoUI(window.iceGun?.holder === this);
    return true;
  }

  attemptFireProjectile() {
    if (!this.canFireProjectile()) return false;

    const direction = new THREE.Vector3(0, 0, 1).applyQuaternion(this.playerModel.quaternion).normalize();
    const position = this.getProjectileSpawnPosition(direction);

    this.consumeAmmo();

    this.multiplayer.send({
      type: 'projectile',
      id: this.multiplayer.getId(),
      position: position.toArray(),
      direction: direction.toArray()
    });

    this.playAction('projectile');
    this.spawnProjectile(
      this.scene,
      this.projectiles,
      position,
      direction,
      this.multiplayer.getId()
    );
    return true;
  }

  getProjectileSpawnPosition(direction) {
    const offsetDistance = 0.6;
    const normalizedDirection = direction.clone().normalize();
    const iceGun = window.iceGun;

    if (iceGun?.mesh) {
      const gunPosition = new THREE.Vector3();
      iceGun.mesh.getWorldPosition(gunPosition);
      return gunPosition.add(normalizedDirection.clone().multiplyScalar(offsetDistance));
    }

    return this.playerModel.position
      .clone()
      .add(new THREE.Vector3(0, 0.7, 0))
      .add(normalizedDirection.clone().multiplyScalar(offsetDistance));
  }

  addAmmo(amount) {
    if (typeof amount !== 'number' || amount <= 0) return;
    const normalized = Math.floor(amount);
    if (normalized <= 0) return;
    const nextAmmo = Math.min(this.maxAmmo, this.ammo + normalized);
    if (nextAmmo !== this.ammo) {
      this.ammo = nextAmmo;
      this.updateAmmoUI(window.iceGun?.holder === this);
    }
  }

  updateAmmoUI(hasGun = window.iceGun?.holder === this) {
    if (this.ammoCountEl && this.lastAmmoValue !== this.ammo) {
      this.ammoCountEl.textContent = `${this.ammo}`;
      this.lastAmmoValue = this.ammo;
    }

    if (this.ammoContainerEl) {
      if (this.lastHasGun !== hasGun) {
        this.ammoContainerEl.classList.toggle('inactive', !hasGun);
      }

      const isEmpty = this.ammo === 0;
      if (this.lastAmmoEmpty !== isEmpty) {
        this.ammoContainerEl.classList.toggle('empty', isEmpty);
        this.lastAmmoEmpty = isEmpty;
      }
    }

    this.lastHasGun = hasGun;
  }

  updateGrabbedTarget() {
    if (!this.grabbedTarget || !this.playerModel) return;
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(this.playerModel.quaternion).normalize();
    const targetPos = this.playerModel.position.clone().addScaledVector(forward, 1);
    const target = this.grabbedTarget;
    if (target.type === 'player') {
      target.model.position.copy(targetPos);
      this.multiplayer.send({ type: 'grabMove', from: this.multiplayer.getId(), target: target.id, position: targetPos.toArray() });
    } else if (target.type === 'monster') {
      target.model.position.copy(targetPos);
      target.model.userData.rb?.setTranslation(targetPos, true);
    } else if (target.type === 'object') {
      target.object.position.copy(targetPos);
      if (target.object.userData?.rb) {
        target.object.userData.rb.setTranslation(targetPos, true);
      }
    }
  }

  attemptGrab() {
    const playerPos = this.playerModel.position;
    let closest = null;
    let minDist = 1.5;

    const others = window.otherPlayers || {};
    for (const [id, p] of Object.entries(others)) {
      const dist = playerPos.distanceTo(p.model.position);
      if (dist < minDist) {
        closest = { type: 'player', id, model: p.model };
        minDist = dist;
      }
    }

    const mon = window.monster;
    if (mon) {
      const dist = playerPos.distanceTo(mon.position);
      if (dist < minDist) {
        closest = { type: 'monster', model: mon };
        minDist = dist;
      }
    }

    const bm = window.breakManager;
    if (bm) {
      for (const [id, data] of bm.registry.entries()) {
        const obj = data.object;
        const dist = playerPos.distanceTo(obj.position);
        if (dist < minDist) {
          closest = { type: 'object', id, object: obj };
          minDist = dist;
        }
      }
    }

    if (closest) {
      this.grabbedTarget = closest;
      if (closest.type === 'player') {
        this.multiplayer.send({ type: 'grab', from: this.multiplayer.getId(), target: closest.id, active: true });
      }
    }
  }

  releaseGrab() {
    if (this.grabbedTarget && this.grabbedTarget.type === 'player') {
      this.multiplayer.send({ type: 'grab', from: this.multiplayer.getId(), target: this.grabbedTarget.id, active: false });
    }
    this.grabbedTarget = null;
  }

  setGrabbed(active, grabberId = null) {
    this.isGrabbed = active;
    this.grabberId = grabberId;
    if (!active) {
      this.externalGrabPos = null;
    }
  }

  updateGrabbedPosition(pos) {
    this.externalGrabPos = new THREE.Vector3(...pos);
  }

  deployParachute() {
    if (!this.playerModel || this.parachute) return;
    const geom = new THREE.SphereGeometry(1.5, 16, 8, 0, Math.PI * 2, Math.PI/2, Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({ color: 0xff0000, side: THREE.DoubleSide });
    const chute = new THREE.Mesh(geom, mat);
    chute.rotation.x = Math.PI;
    chute.position.set(0, 3, 0);
    this.playerModel.add(chute);
    this.parachute = chute;
  }

  removeParachute() {
    if (this.parachute) {
      this.parachute.parent.remove(this.parachute);
      this.parachute = null;
    }
  }

  setupPointerLock() {
    this.domElement.addEventListener('click', () => {
      this.domElement.requestPointerLock();
    });
  
    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === this.domElement;
    });
  
    document.addEventListener('mousemove', (event) => {
      if (this.pointerLocked) {
        const sensitivity = 0.002;
        this.yaw -= event.movementX * sensitivity;
        this.pitch -= event.movementY * sensitivity;
    
        // Clamp pitch to stay above ground
        const maxPitch = Math.PI / 3;    // ~60° upward
        const minPitch = -Math.PI / 8;   // ~30° downward
        this.pitch = Math.max(minPitch, Math.min(maxPitch, this.pitch));
      }
    });
    
  
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        document.exitPointerLock();
      }
    });
  }

}

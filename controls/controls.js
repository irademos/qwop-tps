import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { getWaterDepth, SWIM_DEPTH_THRESHOLD, getTerrainHeight } from '../environment/water.js';
import { getSpawnPosition } from '../spawnUtils.js';
import { CHARACTER_MOVEMENT } from "../characters/CharacterBase.js";
import { getKnockbackImpulse } from "../knockback.js";
import { QuestManager } from "../quest.js";

// Movement constants
const SWIM_SPEED = 2;
const ENERGY_DEPLETED_SPEED_MULTIPLIER = 1.2;
const JUMP_FORCE = 4;
const PLAYER_RADIUS = 0.3;
const PLAYER_HALF_HEIGHT = 0.6;
const FLOAT_IDLE_DISPLAY_OFFSET = 0.2;
const CLIMB_SPEED = 1.6;
const CLIMB_SNAP_DISTANCE = 0.6;
const CLIMB_ENTRY_BUFFER_Y = 0.4;
const FRIENDLY_INTERACT_RANGE = 6;
const MUSHROOM_INTERACT_RANGE = 1.2;
const APPLE_INTERACT_RANGE = 3;
const ENGAGED_MODE_DISTANCE = 7;
const FRIENDLY_DIALOGUE_POOL = [
  {
    blocks: [
      "Hey friend! It's nice to see another traveler out here.",
      "If you get lost, just follow the glowing towers. They always lead somewhere safe."
    ],
    responses: [
      {
        label: "Any survival tips?",
        reply: "Stay light on your feet and keep an eye on the waterline."
      },
      {
        label: "Heard any rumors?",
        reply: "People say a sky ship drifts near the old ridge every dusk."
      }
    ]
  },
  {
    blocks: [
      "You're closer than the wind. I like that.",
      "I'm keeping watch while I dance away the boredom."
    ],
    responses: [
      {
        label: "Need company?",
        reply: "Just a quick hello keeps me smiling."
      },
      {
        label: "Anything to trade?",
        reply: "Not yet, but come back later and I might have something shiny."
      }
    ]
  },
  {
    blocks: [
      "The forest is calmer today. Perfect for a wander.",
      "If you hear splashing, it's probably just the fish playing."
    ],
    responses: [
      {
        label: "Thanks for the heads-up.",
        reply: "Anytime. Stay curious!"
      },
      {
        label: "I'll keep moving.",
        reply: "Safe travels, friend."
      }
    ]
  }
];
const ACTION_LOCKED_ATTACKS = ['mutantPunch', 'leftPunch', 'mmaKick', 'runningKick', 'roll'];

export class PlayerControls {
  constructor({
    scene,
    camera,
    playerModel,
    renderer,
    multiplayer,
    getCameraOccluders,
    spawnProjectile,
    projectiles,
    spawnArrowProjectile,
    spawnIceMist,
    iceMists,
    audioManager,
    initialAmmo,
    onAmmoChange
  }) {
    this.yaw = 0;
    this.pitch = 0;
    this.pointerLocked = false;
    this.renderer = renderer;
    this.domElement = this.renderer.domElement;
    this.scene = scene;
    this.playerModel = playerModel;
    this.camera = camera;
    this.multiplayer = multiplayer;
    this.getCameraOccluders = getCameraOccluders || null;
    this.lastPosition = new THREE.Vector3();
    this.wasMoving = false;
    this.isMoving = false;
    this.spawnProjectile = spawnProjectile;
    this.spawnArrowProjectile = spawnArrowProjectile;
    this.projectiles = projectiles;
    this.spawnIceMist = spawnIceMist;
    this.iceMists = iceMists;
    this.audioManager = audioManager;
    this.isKnocked = false;
    this.knockbackRestYaw = 0;
    this.knockbackEndTime = 0;
    this.freezeEndTime = 0;
    this.wasFrozen = false;
    this.slideMomentum = new THREE.Vector3();
    this.lastMoveDirection = new THREE.Vector3();
    this.grabbedTarget = null;
    this.isGrabbed = false;
    this.grabberId = null;
    this.externalGrabPos = null;
    this.isClimbing = false;
    this.activeClimbArea = null;

    this.vehicle = null;

    this.isInWater = false;
    this.waterDepth = 0;

    this.parachute = null;

    this.geoCenterLatLon = null;
    this.geoBoundsCenterXZ = null;
    this.geoBoundsShiftMeters = { x: 0, z: 0 };
    this.geoBoundHalfSizeM = 8;
    this.geoEdgeEpsM = 0.75;
    this.geoBoundsDebug = null;
    this.geoBoundsDebugHeight = 2;
    this.gpsMoveTarget = null;
    this.gpsMoveEpsilon = 0.35;
    this.groundOverrideY = null;

    // Player state
    this.canJump = true;
    this.keysPressed = new Set();
    this.isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    this.hasDoubleJumped = false;
    this.currentSpecialAction = null;
    this.runningKickTimer = null;
    this.runningKickOriginalY = 0;
    this.energyDepleted = false;
    
    // Mobile control variables
    this.joystick = null;
    this.touchStartX = 0;
    this.touchStartY = 0;
    this.touchSensitivity = 0.006;
    this.moveVector = { x: 0, z: 0 };
    this.jumpButtonPressed = false;
    this.moveForward = 0;
    this.moveRight = 0;
    this.deltaSeconds = 0;
    
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
    this.friendlyInteractButton = document.getElementById('friendly-interact');
    this.friendlyDialogueEl = document.getElementById('friendly-dialogue');
    this.friendlyDialogueTextEl = this.friendlyDialogueEl?.querySelector('.friendly-dialogue-text') || null;
    this.friendlyDialogueOptionsEl = this.friendlyDialogueEl?.querySelector('.friendly-dialogue-options') || null;
    this.activeFriendly = null;
    this.isInteracting = false;
    this.activeDialogue = null;
    this.dialogueIndex = 0;
    this.awaitingResponse = false;
    this.awaitingExit = false;
    this.questManager = new QuestManager({
      scene: this.scene,
      getPlayerModel: () => this.playerModel,
      attachPhysics: (npc) => window.attachMonsterPhysics?.(npc),
      detachPhysics: (npc) => window.detachNpcPhysics?.(npc),
      adjustPlayerLevel: (level) => window.adjustPlayerLevel?.(level)
    });
    this.crosshairEl = document.querySelector('.crosshair');
    this.defaultFov = this.camera.fov;
    this.aimFov = Math.max(40, this.defaultFov - 15);
    this.isAiming = false;
    this.isFireHeld = false;
    this.baseCameraOffset = this.cameraOffset.clone();
    this.aimCameraOffset = this.baseCameraOffset.clone().add(new THREE.Vector3(0, 0, -3.2));
    this.baseCameraTargetOffset = new THREE.Vector3();
    this.aimCameraTargetOffset = new THREE.Vector3(1.3, 0, 0);
    this.cameraTargetOffset = new THREE.Vector3();
    this.aimZoomInSpeed = 6;
    this.aimZoomOutSpeed = 3;
    this.aimReleaseDelayMs = 500;
    this.aimReleaseHoldUntil = null;
    this.cameraRaycaster = new THREE.Raycaster();
    this.lastOcclusionOrbitCenter = null;
    this.lastOcclusionDesiredPosition = null;
    this.lastOcclusionPosition = null;
    this.lastOcclusionDistance = null;
    this.lastOcclusionYaw = null;
    this.lastOcclusionPitch = null;
    this.isEngaged = false;
    this.engagedTarget = null;
    this.engagedModeDistanceSq = ENGAGED_MODE_DISTANCE * ENGAGED_MODE_DISTANCE;
    this.engagedTargetPosition = new THREE.Vector3();
    this.engagedOrbitCenter = new THREE.Vector3();
    this.engagedFacingDirection = new THREE.Vector3();

    if (this.isMobile && this.interactionPromptEl) {
      const activateInteraction = (event) => {
        if (!this.interactionPromptEl.classList.contains('visible')) return;
        event.preventDefault();
        this.handlePickupAction();
      };
      this.interactionPromptEl.addEventListener('touchstart', activateInteraction, { passive: false });
      this.interactionPromptEl.addEventListener('click', activateInteraction);
    }

    if (this.friendlyInteractButton) {
      const activateFriendly = (event) => {
        if (this.friendlyInteractButton.classList.contains('hidden')) return;
        event.preventDefault();
        this.handleFriendlyInteractionAction();
      };
      this.friendlyInteractButton.addEventListener('click', activateFriendly);
      this.friendlyInteractButton.addEventListener('touchstart', activateFriendly, { passive: false });
    }

    this.onAmmoChange = typeof onAmmoChange === 'function' ? onAmmoChange : null;
    this.ammo = Number.isFinite(initialAmmo) ? Math.max(0, Math.floor(initialAmmo)) : 10;
    this.maxAmmo = 30;
    this.ammoContainerEl = document.getElementById('ammo-display');
    this.ammoCountEl = document.getElementById('ammo-count');
    this.ammoIconEl = document.getElementById('ammo-icon');
    this.ammoLabel = 'Ice ammo';
    this.ammoIcon = '❄️';
    this.lastAmmoValue = null;
    this.lastAmmoEmpty = null;
    this.lastHasGun = null;
    if (this.ammoIconEl) {
      this.ammoIconEl.textContent = this.ammoIcon;
    }
    this.updateAmmoUI(!!this.getEquippedGun());
    this.onAmmoChange?.(this.ammo);
  }

  setEnergyDepleted(value) {
    this.energyDepleted = Boolean(value);
  }

  applyFreeze(durationMs = 5000) {
    const duration = Number.isFinite(durationMs) ? durationMs : 5000;
    const now = Date.now();
    this.freezeEndTime = Math.max(this.freezeEndTime || 0, now + duration);
    if (this.playerModel?.userData?.actions) {
      const actions = this.playerModel.userData.actions;
      const current = this.playerModel.userData.currentAction;
      if (current && current !== 'idle') {
        actions[current]?.fadeOut(0.1);
      }
      actions?.idle?.reset().fadeIn(0.1).play();
      this.playerModel.userData.currentAction = 'idle';
    }
  }

  isFrozen() {
    return Date.now() < (this.freezeEndTime || 0);
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
      if (this.isClimbing && this.body) {
        this.stopClimbing();
        this.body.applyImpulse({ x: 0, y: JUMP_FORCE, z: 0 }, true);
        this.canJump = false;
        this.hasDoubleJumped = false;
      } else if (this.canJump && this.body) {
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
    let setActionState = null;
    if (actionContainer && toggleButton) {
      setActionState = (state) => {
        this.mobileActionState = state;
        const expanded = state === 'expanded';
        const punchMode = state === 'punch';
        actionContainer.classList.toggle('mobile-expanded', expanded);
        actionContainer.classList.toggle('mobile-punch-mode', punchMode);
        toggleButton.setAttribute('aria-expanded', expanded || punchMode ? 'true' : 'false');
        toggleButton.textContent = expanded ? '✕' : '⋯';
      };

      setActionState('collapsed');

      const handleToggle = (event) => {
        event.preventDefault();
        if (this.mobileActionState === 'punch') {
          setActionState('expanded');
          return;
        }
        const nextState = this.mobileActionState === 'expanded' ? 'collapsed' : 'expanded';
        setActionState(nextState);
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

    const fireButton = document.getElementById('fire-button');
    fireButton.addEventListener('touchstart', (event) => {
      if (!this.enabled) return;
      if (this.shouldHoldToFire()) {
        this.isFireHeld = true;
        this.setAiming(true);
        event.preventDefault();
        return;
      }
      if (this.attemptFireProjectile()) {
        event.preventDefault();
      }
    });
    fireButton.addEventListener('touchend', (event) => {
      if (!this.enabled) return;
      if (!this.isFireHeld) return;
      this.isFireHeld = false;
      this.setAiming(false);
      this.attemptFireProjectile();
      event.preventDefault();
    });
    fireButton.addEventListener('touchcancel', () => {
      if (!this.enabled) return;
      this.isFireHeld = false;
      this.setAiming(false);
    });

    // Punch button
    if (!document.getElementById('punch-button')) {
      const punchButton = document.createElement('button');
      punchButton.id = 'punch-button';
      punchButton.className = 'action-button mobile-action';
      punchButton.innerText = 'PUNCH';
      actionContainer.appendChild(punchButton);
    }

    const punchButton = document.getElementById('punch-button');
    punchButton.addEventListener('touchstart', (event) => {
      if (!this.enabled) return;
      setActionState?.('punch');
      event.preventDefault();
    });

    if (!document.getElementById('left-punch-button')) {
      const leftPunchButton = document.createElement('button');
      leftPunchButton.id = 'left-punch-button';
      leftPunchButton.className = 'action-button mobile-punch-action';
      leftPunchButton.innerText = 'LEFT';
      actionContainer.appendChild(leftPunchButton);
      leftPunchButton.addEventListener('touchstart', (event) => {
        if (!this.enabled || this.isInWater) return;
        this.playAction('leftPunch');
        event.preventDefault();
      });
    }

    if (!document.getElementById('punch-kick-button')) {
      const punchKickButton = document.createElement('button');
      punchKickButton.id = 'punch-kick-button';
      punchKickButton.className = 'action-button mobile-punch-action';
      punchKickButton.innerText = 'KICK';
      actionContainer.appendChild(punchKickButton);
      punchKickButton.addEventListener('touchstart', (event) => {
        if (!this.enabled || this.isInWater) return;
        this.playAction('mmaKick');
        event.preventDefault();
      });
    }

    if (!document.getElementById('right-punch-button')) {
      const rightPunchButton = document.createElement('button');
      rightPunchButton.id = 'right-punch-button';
      rightPunchButton.className = 'action-button mobile-punch-action';
      rightPunchButton.innerText = 'RIGHT';
      actionContainer.appendChild(rightPunchButton);
      rightPunchButton.addEventListener('touchstart', (event) => {
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
        this.handlePickupAction();
        return;
      }

      if (e.key === " ") {
        if (this.parachute) {
          this.removeParachute();
          return;
        }
        if (this.isInWater) return;
        if (this.isClimbing && this.body) {
          this.stopClimbing();
          this.body.applyImpulse({ x: 0, y: JUMP_FORCE, z: 0 }, true);
          this.canJump = false;
          this.hasDoubleJumped = false;
        } else if (this.canJump && this.body) {
          this.body.applyImpulse({ x: 0, y: JUMP_FORCE, z: 0 }, true);
          this.canJump = false;
          this.hasDoubleJumped = false;
        } else if (!this.hasDoubleJumped && this.body) {
          this.body.applyImpulse({ x: 0, y: (JUMP_FORCE - 3), z: 0 }, true);
          this.hasDoubleJumped = true;
          this.playAction('hurricaneKick');
        }
      } else if (key === 'e') {
        if (this.vehicle) if (this.vehicle.type === 'surfboard') this.vehicle.toggleStand();
        if (this.isInWater) return;
        if (this.isMoving && !this.isSlideMomentumActive()) {
          this.slideMomentum.copy(this.lastMoveDirection).multiplyScalar(0.35);
        }
        this.playAction('mutantPunch');
        this.audioManager?.playAttack();
      } else if (key === 'q') {
        if (this.isInWater) return;
        if (this.isMoving && !this.isSlideMomentumActive()) {
          this.slideMomentum.copy(this.lastMoveDirection).multiplyScalar(0.35);
        }
        this.playAction('leftPunch');
        this.audioManager?.playAttack();
      } else if (key === 'r') {
        if (this.isInWater) return;
        if (this.isMoving && !this.isSlideMomentumActive()) {
          this.slideMomentum.copy(this.lastMoveDirection).multiplyScalar(1.1);
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

    this.domElement.addEventListener('mousedown', (event) => {
      if (!this.enabled || this.isMobile) return;
      if (event.button !== 0) return;
      if (this.shouldHoldToFire()) {
        this.isFireHeld = true;
        this.setAiming(true);
      }
    });

    this.domElement.addEventListener('mouseup', (event) => {
      if (!this.enabled || this.isMobile) return;
      if (event.button !== 0) return;
      if (this.isFireHeld) {
        this.isFireHeld = false;
        this.setAiming(false);
        this.attemptFireProjectile();
      }
    });

    this.domElement.addEventListener("click", (event) => {
      // Don't fire if chat or settings are open
      if (!this.enabled || this.isMobile) return;
      if (this.shouldHoldToFire()) return;
      this.attemptFireProjectile();
    });
  }

  handleFriendlyInteractionAction() {
    if (!this.enabled) return;

    if (this.isInteracting) {
      this.advanceFriendlyDialogue();
      return;
    }

    const nearbyFriendly = this.getClosestFriendly(FRIENDLY_INTERACT_RANGE);
    if (nearbyFriendly?.friendly) {
      this.startFriendlyInteraction(nearbyFriendly.friendly);
      return;
    }
  }

  handlePickupAction() {
    if (!this.enabled) return;

    if (this.isInteracting) {
      this.advanceFriendlyDialogue();
      return;
    }

    if (this.vehicle) {
      this.vehicle.dismount?.();
      return;
    }

    const closest = this.getClosestInteractionTarget();
    if (!closest) return;

    if (closest.type?.startsWith?.('home-')) {
      window.homeSystem?.handleInteraction?.(closest);
      return;
    }

    if (closest.type === 'friendly') {
      this.startFriendlyInteraction(closest.friendly);
      return;
    }

    if (closest.type === 'weapon') {
      closest.weapon.tryPickup?.(this);
      return;
    }

    if (closest.type === 'treasureChest') {
      closest.treasureChest.tryOpen?.(this);
      return;
    }
    
    if (closest.type === 'mushroom') {
      window.pickupMushroom?.(closest.pickup);
      return;
    }

    if (closest.type === 'apple') {
      window.pickupApple?.(closest.pickup);
      return;
    }

    if (closest.type === 'vehicle') {
      closest.vehicle.tryMount?.(this);
    }
  }

  getClosestFriendly(maxDistance) {
    if (!this.playerModel) return null;
    const friendlies = Array.isArray(window.friendlies) ? window.friendlies : [];
    let closest = null;
    let closestDistance = Infinity;
    friendlies.forEach((friendly) => {
      if (!friendly?.model || friendly.isDead) return;
      const dist = this.playerModel.position.distanceTo(friendly.model.position);
      if (dist <= maxDistance && dist < closestDistance) {
        closestDistance = dist;
        closest = friendly;
      }
    });
    const questFriend = this.questManager?.getQuestFriend();
    if (questFriend?.model && !questFriend.isDead) {
      const dist = this.playerModel.position.distanceTo(questFriend.model.position);
      if (dist <= maxDistance && dist < closestDistance) {
        closestDistance = dist;
        closest = questFriend;
      }
    }
    return closest ? { friendly: closest, distance: closestDistance } : null;
  }

  getClosestInteractionTarget() {
    if (!this.playerModel) return null;
    const playerPos = this.playerModel.position;
    let closest = null;
    let closestDistance = Infinity;

    const homeTarget = window.homeSystem?.getInteractionTarget?.(playerPos, this.isMobile);
    const homeEnterTarget = homeTarget?.type === 'home-enter' ? homeTarget : null;
    if (homeTarget && !homeEnterTarget) {
      return homeTarget;
    }

    const consider = (distance, data) => {
      if (distance <= data.maxDistance && distance < closestDistance) {
        closestDistance = distance;
        closest = { ...data, distance };
      }
    };

    const nearbyFriendly = this.getClosestFriendly(FRIENDLY_INTERACT_RANGE);
    if (nearbyFriendly?.friendly) {
      consider(nearbyFriendly.distance, {
        type: 'friendly',
        friendly: nearbyFriendly.friendly,
        maxDistance: FRIENDLY_INTERACT_RANGE,
        promptText: "'x' interact"
      });
    }

    const vehicles = [
      { vehicle: window.spaceship, maxDistance: 10, promptText: "'x' enter spaceship" },
      { vehicle: window.rowBoat, maxDistance: 4, promptText: "'x' enter rowboat" },
      { vehicle: window.surfboard, maxDistance: 3, promptText: "'x' enter surfboard" }
    ];

    vehicles.forEach(({ vehicle, maxDistance, promptText }) => {
      if (!vehicle) return;
      const target = vehicle.mesh || vehicle;
      if (!target?.position) return;
      if (vehicle.occupant) return;
      const dist = playerPos.distanceTo(target.position);
      consider(dist, { type: 'vehicle', vehicle, maxDistance, promptText });
    });

    const getWeaponLabel = (weapon) => {
      if (!weapon) return 'weapon';
      if (weapon.type === 'sword') return 'sword';
      if (weapon.type === 'gun') return 'gun';
      if (weapon.type === 'bow') return 'bow';
      if (weapon.type === 'lantern') return 'lantern';
      return 'weapon';
    };

    this.getWeapons().forEach((weapon) => {
      if (!weapon || weapon.holder) return;
      if (weapon.mesh && !weapon.mesh.visible) return;
      const target = weapon.mesh || weapon;
      if (!target?.position) return;
      const dist = playerPos.distanceTo(target.position);
      const weaponLabel = getWeaponLabel(weapon);
      consider(dist, {
        type: 'weapon',
        weapon,
        maxDistance: 3,
        promptText: `'x' pick up ${weaponLabel}`
      });
    });

    const treasureChest = window.treasureChest;
    if (treasureChest?.mesh && !treasureChest.isOpen) {
      const target = treasureChest.mesh;
      if (target?.position) {
        const dist = playerPos.distanceTo(target.position);
        const promptText = this.isMobile
          ? 'click to open chest'
          : "press 'x' to open chest";
        consider(dist, {
          type: 'treasureChest',
          treasureChest,
          maxDistance: 3,
          promptText
        });
      }
    }
    
    const mushroomPickups = Array.isArray(window.mushroomPickups) ? window.mushroomPickups : [];
    mushroomPickups.forEach((pickup) => {
      if (!pickup?.mesh || !pickup.mesh.visible) return;
      const dist = playerPos.distanceTo(pickup.mesh.position);
      consider(dist, {
        type: 'mushroom',
        pickup,
        maxDistance: MUSHROOM_INTERACT_RANGE,
        promptText: "'x' pick up mushroom"
      });
    });

    const applePickups = Array.isArray(window.applePickups) ? window.applePickups : [];
    applePickups.forEach((pickup) => {
      if (!pickup?.mesh || !pickup.mesh.visible) return;
      const dist = playerPos.distanceTo(pickup.mesh.position);
      consider(dist, {
        type: 'apple',
        pickup,
        maxDistance: APPLE_INTERACT_RANGE,
        promptText: "'x' pick up apple"
      });
    });

    return closest ?? homeEnterTarget;
  }

  isFriendlyWithinRange(friendly, range) {
    if (!friendly?.model || !this.playerModel) return false;
    return this.playerModel.position.distanceTo(friendly.model.position) <= range;
  }

  startFriendlyInteraction(friendly) {
    if (!friendly) return;
    const choice = this.questManager?.getDialogueForFriendly(friendly, FRIENDLY_DIALOGUE_POOL) || null;
    this.isInteracting = true;
    this.activeFriendly = friendly;
    this.activeDialogue = choice;
    this.dialogueIndex = 0;
    this.awaitingResponse = false;
    this.awaitingExit = false;
    this.renderFriendlyDialogue();
    this.updateFriendlyInteractionUI();
  }

  advanceFriendlyDialogue() {
    if (!this.isInteracting) return;
    if (this.awaitingExit) {
      this.endFriendlyInteraction();
      return;
    }
    if (this.awaitingResponse || !this.activeDialogue) return;
    const blocks = this.activeDialogue.blocks || [];
    if (this.dialogueIndex < blocks.length - 1) {
      this.dialogueIndex += 1;
      this.renderFriendlyDialogue();
      return;
    }
    this.awaitingResponse = true;
    this.renderFriendlyDialogue();
  }

  endFriendlyInteraction() {
    this.isInteracting = false;
    this.activeFriendly = null;
    this.activeDialogue = null;
    this.dialogueIndex = 0;
    this.awaitingResponse = false;
    this.awaitingExit = false;
    if (this.friendlyDialogueEl) {
      this.friendlyDialogueEl.classList.add('hidden');
    }
    this.updateFriendlyInteractionUI();
  }

  renderFriendlyDialogue() {
    if (!this.friendlyDialogueTextEl || !this.friendlyDialogueOptionsEl || !this.activeDialogue) return;
    const blocks = this.activeDialogue.blocks || [];
    const message = blocks[this.dialogueIndex] || '';
    this.friendlyDialogueTextEl.textContent = message;
    this.friendlyDialogueOptionsEl.innerHTML = '';

    if (this.awaitingResponse) {
      const responses = this.activeDialogue.responses || [];
      responses.forEach((option) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = option.label;
        button.addEventListener('click', () => {
          this.friendlyDialogueOptionsEl.innerHTML = '';
          this.friendlyDialogueTextEl.textContent = option.reply;
          this.awaitingResponse = false;
          this.awaitingExit = true;
          this.handleDialogueOption(option);
          this.updateFriendlyInteractionUI();
        });
        this.friendlyDialogueOptionsEl.appendChild(button);
      });
    }
  }

  updateFriendlyInteractionUI() {
    if (!this.friendlyInteractButton) return;

    if (this.isInteracting) {
      if (this.activeFriendly && !this.isFriendlyWithinRange(this.activeFriendly, FRIENDLY_INTERACT_RANGE * 1.6)) {
        this.endFriendlyInteraction();
        return;
      }
      this.friendlyInteractButton.classList.remove('hidden');
      this.friendlyInteractButton.disabled = this.awaitingResponse;
      this.friendlyInteractButton.textContent = this.awaitingResponse
        ? 'Choose Reply'
        : this.awaitingExit
          ? 'Close'
          : 'Next';
      this.friendlyDialogueEl?.classList.remove('hidden');
      return;
    }

    const nearby = this.getClosestFriendly(FRIENDLY_INTERACT_RANGE);
    const closest = this.getClosestInteractionTarget();
    if (nearby?.friendly && closest?.type === 'friendly' && closest.friendly === nearby.friendly) {
      this.friendlyInteractButton.classList.remove('hidden');
      this.friendlyInteractButton.disabled = false;
      this.friendlyInteractButton.textContent = this.isMobile ? 'Talk' : 'Interact (X)';
      return;
    }

    this.friendlyInteractButton.classList.add('hidden');
    this.friendlyDialogueEl?.classList.add('hidden');
  }

  isSlideMomentumActive() {
    return this.slideMomentum.length() > 0.01;
  }

  playAction(actionName) {
    if (!this.playerModel) return;
    const actions = this.playerModel.userData.actions;
    if (!actions || !actions[actionName]) return;
    if (ACTION_LOCKED_ATTACKS.includes(actionName) && ACTION_LOCKED_ATTACKS.includes(this.currentSpecialAction)) return;

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

    if (["mutantPunch", "leftPunch", "hurricaneKick", "mmaKick", "runningKick"].includes(actionName)) {
      const isPunch = actionName === 'mutantPunch' || actionName === 'leftPunch';
      const attackName = isPunch && this.getEquippedSword()
        ? 'swordSlash'
        : isPunch
          ? 'mutantPunch'
          : actionName;
      this.playerModel.userData.attack = {
        name: attackName,
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

  applyKnockback({ direction, strength } = {}) {
    if (!direction || !this.playerModel) return;
    const { impulse, profile } = getKnockbackImpulse(direction, strength);
    if (this.body) {
      this.body.applyImpulse({ x: impulse.x, y: impulse.y, z: impulse.z }, true);
    }
    this.isKnocked = true;
    const now = Date.now();
    this.knockbackEndTime = Math.max(this.knockbackEndTime || 0, now + profile.recoveryMs);
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

  getClimbInput(moveDirection, cameraDirection) {
    if (this.isMobile) {
      if (this.joystickForce > 0.1 && moveDirection.length() > 0) {
        const forwardDot = moveDirection.dot(cameraDirection);
        if (forwardDot > 0.25) return 1;
        if (forwardDot < -0.25) return -1;
      }
      return 0;
    }
    if (this.keysPressed.has("w")) return 1;
    if (this.keysPressed.has("s")) return -1;
    return 0;
  }

  getClimbLocalPosition(area, position) {
    if (!area?.center) return null;
    const local = position.clone().sub(area.center);
    local.applyAxisAngle(new THREE.Vector3(0, 1, 0), -(area.rotationY ?? 0));
    return local;
  }

  isWithinClimbEntry(area, position) {
    if (!area?.entryCenter || !Number.isFinite(area.entryRadius)) return false;
    const dx = position.x - area.entryCenter.x;
    const dz = position.z - area.entryCenter.z;
    const horizontalDist = Math.hypot(dx, dz);
    if (horizontalDist > area.entryRadius) return false;
    const minY = (area.minY ?? area.entryCenter.y) - CLIMB_ENTRY_BUFFER_Y;
    const entryHeight = area.entryHeight ?? CLIMB_SNAP_DISTANCE * 2;
    const maxY = minY + entryHeight + CLIMB_ENTRY_BUFFER_Y;
    return position.y >= minY && position.y <= maxY;
  }

  findClimbableArea(position) {
    const areas = window.climbableAreas || [];
    if (!areas.length) return null;
    let closest = null;
    let closestDist = Infinity;
    for (const area of areas) {
      if (!area?.center) continue;
      const local = this.getClimbLocalPosition(area, position);
      if (!local) continue;
      const halfWidth = area.halfWidth ?? 0;
      const halfDepth = area.halfDepth ?? 0;
      const halfHeight = area.halfHeight ?? 0;
      const withinWidth = Math.abs(local.x) <= halfWidth + CLIMB_SNAP_DISTANCE;
      const withinHeight = local.y >= -halfHeight - CLIMB_SNAP_DISTANCE && local.y <= halfHeight + CLIMB_SNAP_DISTANCE;
      const minDepth = halfDepth - CLIMB_SNAP_DISTANCE;
      const maxDepth = halfDepth + CLIMB_SNAP_DISTANCE + PLAYER_RADIUS;
      const withinDepth = local.z >= minDepth && local.z <= maxDepth;
      const withinEntry = this.isWithinClimbEntry(area, position);
      if (!withinWidth || !withinHeight || (!withinDepth && !withinEntry)) continue;
      const dist = area.center?.distanceTo(position) ?? 0;
      if (dist < closestDist) {
        closest = area;
        closestDist = dist;
      }
    }
    return closest;
  }

  startClimbing(area) {
    this.isClimbing = true;
    this.activeClimbArea = area;
    this.canJump = false;
  }

  stopClimbing() {
    if (!this.isClimbing) return;
    const actions = this.playerModel?.userData?.actions;
    if (actions?.climb) {
      actions.climb.paused = false;
      actions.climb.timeScale = 1;
    }
    this.isClimbing = false;
    this.activeClimbArea = null;
  }

  isMovingTowardClimbArea(area, movement) {
    if (!area?.normal) return false;
    if (!movement || movement.length() === 0) return false;
    const moveDir = movement.clone().normalize();
    return moveDir.dot(area.normal) < -0.2;
  }

  getClimbSnapPosition(area, position) {
    const local = this.getClimbLocalPosition(area, position);
    if (!local) return position.clone();
    const maxX = Math.max(0.01, (area.halfWidth ?? 0) - PLAYER_RADIUS * 0.5);
    const clampedX = THREE.MathUtils.clamp(local.x, -maxX, maxX);
    local.x = clampedX;
    local.z = (area.halfDepth ?? 0) + PLAYER_RADIUS * 0.1;
    local.applyAxisAngle(new THREE.Vector3(0, 1, 0), area.rotationY ?? 0);
    return local.add(area.center);
  }

  updateClimbing({ area, climbInput, position, velocity, groundExpectedY }) {
    const actions = this.playerModel?.userData?.actions;
    if (actions?.climb) {
      const current = this.playerModel.userData.currentAction;
      if (current !== 'climb') {
        actions[current]?.fadeOut(0.1);
        actions.climb.reset().fadeIn(0.1).play();
        this.playerModel.userData.currentAction = 'climb';
      }
      if (climbInput !== 0) {
        actions.climb.paused = false;
        actions.climb.timeScale = climbInput > 0 ? 1 : -1;
        const clipDuration = actions.climb.getClip()?.duration ?? 0;
        if (climbInput < 0 && actions.climb.time <= 0.05 && clipDuration) {
          actions.climb.time = clipDuration;
        }
      } else {
        actions.climb.paused = true;
      }
    }

    const delta = this.deltaSeconds || 0.016;
    const direction = climbInput === 0 ? 0 : climbInput > 0 ? 1 : -1;
    let newY = position.y + direction * CLIMB_SPEED * delta;
    const minY = Math.max(groundExpectedY, area.minY ?? groundExpectedY);
    const maxY = area.maxY ?? position.y;
    if (position.y > maxY + 0.05) {
      this.stopClimbing();
      return;
    }
    if (direction > 0 && newY >= maxY) {
      newY = maxY;
    } else if (direction < 0 && newY <= minY) {
      newY = minY;
    }

    const snapped = this.getClimbSnapPosition(area, position);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setTranslation({ x: snapped.x, y: newY, z: snapped.z }, true);

    if (direction < 0 && newY <= minY + 0.01) {
      this.stopClimbing();
    }
    if (direction > 0 && newY >= maxY - 0.01) {
      this.stopClimbing();
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
    this.updateAimingRotation();
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

    const freezeActive = this.isFrozen();
    if (freezeActive) {
      this.body.setLinvel({ x: 0, y: vel.y, z: 0 }, true);
      if (this.isClimbing) {
        this.stopClimbing();
      }
      this.wasFrozen = true;
    } else if (this.wasFrozen) {
      if (this.playerModel?.userData) {
        this.playerModel.userData.currentAction = null;
      }
      this.wasFrozen = false;
    }

    const terrainY = getTerrainHeight(t.x, t.z);
    let groundY = Number.isFinite(this.groundOverrideY) ? this.groundOverrideY : terrainY;
    const world = window.rapierWorld;
    if (world && !Number.isFinite(this.groundOverrideY)) {
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
    const movementLocked = freezeActive || ['mutantPunch', 'leftPunch', 'mmaKick', 'runningKick'].includes(this.currentSpecialAction);
    const position = new THREE.Vector3(t.x, t.y, t.z);
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
    const hasPlayerInput = moveDirection.length() > 0;
    if (hasPlayerInput && this.gpsMoveTarget) {
      this.clearGpsMoveTarget();
    }
    if (movementLocked && !freezeActive) {
      movement.copy(this.slideMomentum);
      this.slideMomentum.multiplyScalar(0.97);
      if (this.slideMomentum.length() < 0.01) this.slideMomentum.set(0, 0, 0);
    } else if (freezeActive) {
      movement.set(0, 0, 0);
      this.slideMomentum.set(0, 0, 0);
    } else if (movement.length() > 0) {
      this.lastMoveDirection.copy(movement);
    } else if (this.isSlideMomentumActive()) {
      this.slideMomentum.multiplyScalar(0.9);
      if (this.slideMomentum.length() < 0.01) this.slideMomentum.set(0, 0, 0);
    }
    if (this.isClimbing) {
      movement.set(0, 0, 0);
    }

    const climbInput = this.getClimbInput(moveDirection, cameraDirection);
    const climbArea = this.findClimbableArea(position);
    const nearEntry = climbArea && this.isWithinClimbEntry(climbArea, position);
    const shouldStartClimb = !this.isClimbing && climbArea && climbInput > 0
      && (nearEntry || this.isMovingTowardClimbArea(climbArea, movement));
    if (this.isClimbing || shouldStartClimb) {
      if (!climbArea) {
        this.stopClimbing();
      } else {
        if (!this.isClimbing) this.startClimbing(climbArea);
        this.updateClimbing({
          area: climbArea,
          climbInput,
          position,
          velocity: vel,
          groundExpectedY
        });
      }
    }
    const gpsMove = this.getGpsMoveDirection(position);
    const allowGpsMove = this.isOutsideGeoBounds(position);
    if (gpsMove && allowGpsMove && !movementLocked && !this.isClimbing && !this.isKnocked) {
      movement.copy(gpsMove.direction);
      this.lastMoveDirection.copy(movement);
    }
    if (this.isKnocked) {
      if (Date.now() >= this.knockbackEndTime) {
        this.isKnocked = false;
        this.playerModel.rotation.set(0, this.knockbackRestYaw || this.playerModel.rotation.y, 0);
        const actions = this.playerModel.userData.actions;
        actions?.hit?.fadeOut(0.2);
        actions?.idle?.reset().fadeIn(0.2).play();
        this.playerModel.userData.currentAction = 'idle';
      }
    } else if (!this.isClimbing) {
      const speed = this.isInWater
        ? SWIM_SPEED
        : (this.energyDepleted
          ? CHARACTER_MOVEMENT.walkSpeed * ENERGY_DEPLETED_SPEED_MULTIPLIER
          : CHARACTER_MOVEMENT.runSpeed);
      this.body.setLinvel({ x: movement.x * speed, y: vel.y, z: movement.z * speed }, true);
      }
      
    let { x: newX, y: newY, z: newZ } = this.body.translation();

    const sink = this.isInWater ? newY - surfaceY : 0;

    let pushedByGeo = false;
    let clampedByGeo = false;
    const gpsMoveActive = !!this.gpsMoveTarget;

    if (gpsMoveActive && this.geoBoundsShiftMeters) {
      this.geoBoundsShiftMeters.x = 0;
      this.geoBoundsShiftMeters.z = 0;
    }

    if (this.geoBoundsCenterXZ && !gpsMoveActive) {
      const halfSize = this.geoBoundHalfSizeM;

      const shiftX = this.geoBoundsShiftMeters?.x ?? 0;
      const shiftZ = this.geoBoundsShiftMeters?.z ?? 0;

      const prevCenterX = this.geoBoundsCenterXZ.x - shiftX;
      const prevCenterZ = this.geoBoundsCenterXZ.z - shiftZ;

      const edgeEps = this.geoEdgeEpsM;

      let targetX = newX;
      let targetZ = newZ;

      // "Conveyor" push only if player was near the OLD edge
      if (shiftX > 0 && newX >= prevCenterX + halfSize - edgeEps) { targetX += shiftX; pushedByGeo = true; }
      else if (shiftX < 0 && newX <= prevCenterX - halfSize + edgeEps) { targetX += shiftX; pushedByGeo = true; }

      if (shiftZ > 0 && newZ >= prevCenterZ + halfSize - edgeEps) { targetZ += shiftZ; pushedByGeo = true; }
      else if (shiftZ < 0 && newZ <= prevCenterZ - halfSize + edgeEps) { targetZ += shiftZ; pushedByGeo = true; }

      const minX = this.geoBoundsCenterXZ.x - halfSize;
      const maxX = this.geoBoundsCenterXZ.x + halfSize;
      const minZ = this.geoBoundsCenterXZ.z - halfSize;
      const maxZ = this.geoBoundsCenterXZ.z + halfSize;

      const clampedX = Math.min(maxX, Math.max(minX, targetX));
      const clampedZ = Math.min(maxZ, Math.max(minZ, targetZ));

      clampedByGeo = (clampedX !== targetX) || (clampedZ !== targetZ);

      if (clampedByGeo || clampedX !== newX || clampedZ !== newZ) {
        // Cancel velocity into the wall (otherwise you'll "fight" the clamp forever)
        const v = this.body.linvel();
        let vx = v.x, vz = v.z;

        if (clampedX <= minX + 1e-6 && vx < 0) vx = 0;
        if (clampedX >= maxX - 1e-6 && vx > 0) vx = 0;
        if (clampedZ <= minZ + 1e-6 && vz < 0) vz = 0;
        if (clampedZ >= maxZ - 1e-6 && vz > 0) vz = 0;

        this.body.setLinvel({ x: vx, y: v.y, z: vz }, true);
        this.body.setTranslation({ x: clampedX, y: newY, z: clampedZ }, true);

        newX = clampedX;
        newZ = clampedZ;
      }

      this.geoBoundsShiftMeters.x = 0;
      this.geoBoundsShiftMeters.z = 0;
    }
    if (clampedByGeo && this.gpsMoveTarget) {
      this.clearGpsMoveTarget();
    }


    const isMovingNow = movement.length() > 0 || pushedByGeo;
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
      const slideMomentumActive = movementLocked && this.isSlideMomentumActive();
      if (movement.length() > 0 && !slideMomentumActive) {
        yawAngle = Math.atan2(movement.x, movement.z);
        // this.playerModel.rotation.y = yawAngle;
      }
      if (this.isFireHeld && this.shouldHoldToFire() && !slideMomentumActive) {
        const aimDirection = this.getAimDirection(true);
        yawAngle = Math.atan2(aimDirection.x, aimDirection.z);
      }

      
      this.playerModel.rotation.set(0, yawAngle, 0);
      this.playerModel.up.set(0, 1, 0);
      this.camera.up.set(0, 1, 0);
      
      const actions = this.playerModel.userData.actions;
      if (actions && !this.isKnocked && !this.currentSpecialAction && !this.isClimbing) {
        let actionName;
        const moveAction = this.energyDepleted ? 'walk' : 'run';
        if (this.vehicle && this.vehicle.type === 'surfboard') {
          if (this.isInWater) {
            actionName = isMovingNow ? 'swim' : 'sit';
            if (this.vehicle.standing) {
              actionName = 'idle';
            }
          } else {
            actionName = 'idle';
            if (!this.canJump) actionName = 'jump';
            else if (isMovingNow) actionName = moveAction;
          }
        } else {
          if (this.isInWater) {
            actionName = isMovingNow ? 'swim' : 'float';
          } else {
            actionName = 'idle';
            if (!this.canJump) actionName = 'jump';
            else if (isMovingNow) actionName = moveAction;
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
        this.lastPosition.set(newX, displayY, newZ);
        this.wasMoving = this.isMoving;
      }
      this.updateGeoBoundsDebug(this.playerModel.position);
    } else {
      this.camera.position.set(newX, newY + 1.2, newZ);
      this.updateGeoBoundsDebug(new THREE.Vector3(newX, newY, newZ));
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

    const now = performance.now();
    if (!this.lastUpdate) this.lastUpdate = now;
    const delta = (now - this.lastUpdate) / 1000;
    this.lastUpdate = now;
    this.time = (now * 0.01) % 1000; // Use performance.now() for consistent timing
    this.deltaSeconds = delta;

    const rotateSpeed = CHARACTER_MOVEMENT.turnRate * 3.5;
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

    this.updateEngagedState();

    const shouldHoldAim = !this.isAiming && this.aimReleaseHoldUntil && now < this.aimReleaseHoldUntil;
    const aimingActive = this.isAiming || shouldHoldAim;
    const aimLerpSpeed = aimingActive ? this.aimZoomInSpeed : this.aimZoomOutSpeed;
    const aimLerpFactor = 1 - Math.exp(-aimLerpSpeed * this.deltaSeconds);
    const targetOffset = aimingActive ? this.aimCameraOffset : this.baseCameraOffset;
    const targetFov = aimingActive ? this.aimFov : this.defaultFov;
    this.cameraOffset.lerp(targetOffset, aimLerpFactor);
    const targetCameraTargetOffset = aimingActive ? this.aimCameraTargetOffset : this.baseCameraTargetOffset;
    this.cameraTargetOffset.lerp(targetCameraTargetOffset, aimLerpFactor);
    this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, targetFov, aimLerpFactor);
    this.camera.updateProjectionMatrix();

    let orbitCenter;
    let offset;
    if (this.isEngaged && this.engagedTarget?.model) {
      this.engagedTarget.model.getWorldPosition(this.engagedTargetPosition);
      this.engagedOrbitCenter.copy(this.engagedTargetPosition);
      this.engagedOrbitCenter.y += 1;
      orbitCenter = this.engagedOrbitCenter;
      offset = this.cameraOffset;
    } else if (this.vehicle && this.vehicle.mesh && this.vehicle.type !== 'surfboard') {
      const size = this.vehicle.boundingSize;
      const centerOffset = this.vehicle.boundingCenterOffset || new THREE.Vector3();
      orbitCenter = this.vehicle.mesh.position.clone().add(centerOffset);
      const maxDim = Math.max(size.x, size.y, size.z);
      const fov = THREE.MathUtils.degToRad(this.camera.fov);
      const distance = (maxDim * 0.5) / Math.tan(fov / 2) + maxDim * 0.5;
      offset = new THREE.Vector3(0, maxDim * 0.5, distance);
    } else {
      orbitCenter = this.playerModel.position.clone().add(new THREE.Vector3(0, 1, 0));
      const targetOffset = this.cameraTargetOffset;
      if (targetOffset.lengthSq() > 0) {
        const rotatedTargetOffset = new THREE.Vector3(
          targetOffset.x * Math.cos(this.yaw) - targetOffset.z * Math.sin(this.yaw),
          targetOffset.y,
          targetOffset.x * Math.sin(this.yaw) + targetOffset.z * Math.cos(this.yaw)
        );
        orbitCenter.add(rotatedTargetOffset);
      }
      offset = this.cameraOffset;
    }
    const rotatedOffset = new THREE.Vector3(
      offset.x * Math.cos(this.yaw) - offset.z * Math.sin(this.yaw),
      offset.y + 5 * Math.sin(this.pitch),
      offset.x * Math.sin(this.yaw) + offset.z * Math.cos(this.yaw)
    );

    const desiredCameraPosition = orbitCenter.clone().add(rotatedOffset);
    const occlusionEpsilon = 0.02;
    const occlusionEpsilonSq = occlusionEpsilon * occlusionEpsilon;
    const yawPitchEpsilon = 0.0005;
    const shouldRaycast = (() => {
      if (!this.lastOcclusionOrbitCenter || !this.lastOcclusionDesiredPosition) return true;
      if (this.lastOcclusionOrbitCenter.distanceToSquared(orbitCenter) > occlusionEpsilonSq) return true;
      if (this.lastOcclusionDesiredPosition.distanceToSquared(desiredCameraPosition) > occlusionEpsilonSq) return true;
      if (this.lastOcclusionYaw === null || this.lastOcclusionPitch === null) return true;
      if (Math.abs(this.yaw - this.lastOcclusionYaw) > yawPitchEpsilon) return true;
      if (Math.abs(this.pitch - this.lastOcclusionPitch) > yawPitchEpsilon) return true;
      return false;
    })();

    let resolvedCameraPosition = desiredCameraPosition;
    if (this.isClimbing) {
      this.lastOcclusionOrbitCenter = null;
      this.lastOcclusionDesiredPosition = null;
      this.lastOcclusionPosition = null;
      this.lastOcclusionDistance = null;
      this.lastOcclusionYaw = null;
      this.lastOcclusionPitch = null;
    } else if (shouldRaycast && this.getCameraOccluders) {
      const occluders = this.getCameraOccluders() || [];
      const direction = desiredCameraPosition.clone().sub(orbitCenter);
      const distance = direction.length();
      let resolvedDistance = distance;
      if (distance > 0.0001 && occluders.length) {
        direction.normalize();
        this.cameraRaycaster.set(orbitCenter, direction);
        this.cameraRaycaster.far = distance;
        const intersections = this.cameraRaycaster.intersectObjects(occluders, true);
        if (intersections.length) {
          const padding = 0.3;
          resolvedDistance = Math.max(intersections[0].distance - padding, 0.05);
          resolvedCameraPosition = orbitCenter.clone().addScaledVector(direction, resolvedDistance);
        }
      }

      this.lastOcclusionOrbitCenter = orbitCenter.clone();
      this.lastOcclusionDesiredPosition = desiredCameraPosition.clone();
      this.lastOcclusionPosition = resolvedCameraPosition.clone();
      this.lastOcclusionDistance = resolvedDistance;
      this.lastOcclusionYaw = this.yaw;
      this.lastOcclusionPitch = this.pitch;
    } else if (this.lastOcclusionDistance !== null) {
      const direction = desiredCameraPosition.clone().sub(orbitCenter);
      const distance = direction.length();
      if (distance > 0.0001) {
        direction.normalize();
        const clampedDistance = Math.min(this.lastOcclusionDistance, distance);
        resolvedCameraPosition = orbitCenter.clone().addScaledVector(direction, clampedDistance);
      }
    } else if (this.lastOcclusionPosition) {
      resolvedCameraPosition = this.lastOcclusionPosition.clone();
    }

    this.camera.position.copy(resolvedCameraPosition);
    this.camera.lookAt(orbitCenter);

    if (this.playerModel && this.playerModel.userData.mixer) {
      this.playerModel.userData.mixer.update(delta);
    }

    if (this.enabled) {
      this.processMovement();
    }
    this.updateEngagedFacing();
    if (this.grabbedTarget) {
      this.updateGrabbedTarget();
    }

    // Always update controls even when movement is disabled
    if (this.controls) {
      this.controls.update();
    }

    this.questManager?.setDeltaSeconds(this.deltaSeconds);
    this.questManager?.update();
    this.updateFriendlyInteractionUI();
    this.updateInteractionPrompt();

    const hasGun = !!this.getEquippedGun();
    if (hasGun !== this.lastHasGun) {
      this.updateAmmoUI(hasGun);
    }
  }

  handleDialogueOption(option) {
    this.questManager?.handleDialogueOption(option, this.activeFriendly);
  }

  getWeapons() {
    const weapons = Object.values(window.weapons || {}).filter(Boolean);
    const pickups = Array.isArray(window.weaponPickups) ? window.weaponPickups : [];
    return weapons.concat(pickups);
  }

  getEquippedWeapon() {
    return this.getWeapons().find(weapon => weapon.holder === this) || null;
  }

  getEquippedGun() {
    return this.getWeapons().find(
      weapon => weapon.holder === this && (weapon.type === 'gun' || weapon.type === 'bow')
    ) || null;
  }

  getEquippedSword() {
    return this.getWeapons().find(weapon => weapon.holder === this && weapon.type === 'sword') || null;
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
      const closest = this.getClosestInteractionTarget();
      if (closest?.promptText) {
        if (closest.type !== 'friendly' || !this.friendlyInteractButton) {
          promptText = closest.promptText;
          visible = true;
        }
      }
    }

    if (visible) {
      this.interactionPromptEl.textContent = this.formatInteractionPrompt(promptText);
      this.interactionPromptEl.classList.add('visible');
    } else {
      this.interactionPromptEl.classList.remove('visible');
      this.interactionPromptEl.textContent = '';
    }
  }

  formatInteractionPrompt(text) {
    if (!text || !this.isMobile) return text;
    return text.replace(/^'x'\s*/i, 'touch ');
  }

  setGeoCenter({ lat, lon }) {
    if (typeof lat !== 'number' || typeof lon !== 'number') return;
    if (!this.geoCenterLatLon) {
      const currentPos = this.body?.translation?.() ?? this.playerModel?.position ?? { x: this.playerX, z: this.playerZ };
      this.geoCenterLatLon = { lat, lon };
      this.geoBoundsCenterXZ = new THREE.Vector3(currentPos.x, 0, currentPos.z);
      this.geoBoundsShiftMeters = { x: 0, z: 0 };
      return;
    }

    const prevLat = this.geoCenterLatLon.lat;
    const prevLon = this.geoCenterLatLon.lon;
    const deltaLat = lat - prevLat;
    const deltaLon = lon - prevLon;
    const lonScale = 111_412.84 * Math.cos((prevLat * Math.PI) / 180);
    const dxMeters = -deltaLon * lonScale;
    const dzMeters = deltaLat * 111_132.92; // north => -z

    this.geoCenterLatLon = { lat, lon };
    if (!this.geoBoundsCenterXZ) {
      const currentPos = this.body?.translation?.() ?? this.playerModel?.position ?? { x: this.playerX, z: this.playerZ };
      this.geoBoundsCenterXZ = new THREE.Vector3(currentPos.x, 0, currentPos.z);
    }
    this.geoBoundsCenterXZ.x += dxMeters;
    this.geoBoundsCenterXZ.z += dzMeters;
    this.geoBoundsShiftMeters.x += dxMeters;
    this.geoBoundsShiftMeters.z += dzMeters;
  }

  setGpsMoveTarget(target) {
    if (!target || !Number.isFinite(target.x) || !Number.isFinite(target.z)) return;
    const nextY = Number.isFinite(target.y) ? target.y : this.playerY ?? 0;
    if (!this.gpsMoveTarget) {
      this.gpsMoveTarget = new THREE.Vector3();
    }
    this.gpsMoveTarget.set(target.x, nextY, target.z);
  }

  clearGpsMoveTarget() {
    this.gpsMoveTarget = null;
  }

  isOutsideGeoBounds(position) {
    if (!position || !this.geoBoundsCenterXZ || !Number.isFinite(this.geoBoundHalfSizeM)) {
      return true;
    }
    const halfSize = this.geoBoundHalfSizeM;
    const minX = this.geoBoundsCenterXZ.x - halfSize;
    const maxX = this.geoBoundsCenterXZ.x + halfSize;
    const minZ = this.geoBoundsCenterXZ.z - halfSize;
    const maxZ = this.geoBoundsCenterXZ.z + halfSize;
    return position.x < minX || position.x > maxX || position.z < minZ || position.z > maxZ;
  }

  getGpsMoveDirection(position) {
    if (!this.gpsMoveTarget || !position) return null;
    const dx = this.gpsMoveTarget.x - position.x;
    const dz = this.gpsMoveTarget.z - position.z;
    const distance = Math.hypot(dx, dz);
    if (!Number.isFinite(distance) || distance <= this.gpsMoveEpsilon) {
      this.gpsMoveTarget = null;
      return null;
    }
    return { direction: new THREE.Vector3(dx / distance, 0, dz / distance), distance };
  }

  updateGeoBoundsDebug(position) {
    if (!this.scene) return;
    if (!this.geoBoundsCenterXZ || !Number.isFinite(this.geoBoundHalfSizeM)) {
      if (this.geoBoundsDebug) {
        this.geoBoundsDebug.visible = false;
      }
      return;
    }
    if (!this.geoBoundsDebug) {
      const geometry = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
      const material = new THREE.LineBasicMaterial({ color: 0x1e90ff });
      this.geoBoundsDebug = new THREE.LineSegments(geometry, material);
      this.geoBoundsDebug.name = 'geo-bounds-debug';
      this.geoBoundsDebug.frustumCulled = false;
      this.scene.add(this.geoBoundsDebug);
    }
    const size = this.geoBoundHalfSizeM * 2;
    const height = this.geoBoundsDebugHeight;
    const centerY = position?.y ?? 0;
    this.geoBoundsDebug.scale.set(size, height, size);
    this.geoBoundsDebug.position.set(this.geoBoundsCenterXZ.x, centerY, this.geoBoundsCenterXZ.z);
    this.geoBoundsDebug.visible = true;
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
    const gun = this.getEquippedGun();
    return !!gun && this.ammo > 0 && this.playerModel;
  }

  consumeAmmo() {
    if (this.ammo <= 0) return false;
    this.setAmmo(this.ammo - 1);
    return true;
  }

  attemptFireProjectile() {
    if (!this.canFireProjectile()) return false;

    const gun = this.getEquippedGun();
    const usesIceMist = gun?.itemId === 'iceGun' && typeof this.spawnIceMist === 'function';
    const usesArrow = gun?.itemId === 'bow' && typeof this.spawnArrowProjectile === 'function';
    const direction = usesIceMist ? this.getPlayerFacingDirection() : this.getAimDirection(usesArrow);
    const position = this.getProjectileSpawnPosition(direction);

    this.consumeAmmo();

    if (usesIceMist) {
      this.multiplayer.send({
        type: 'iceMist',
        id: this.multiplayer.getId(),
        position: position.toArray(),
        direction: direction.toArray()
      });

      this.playAction('projectile');
      this.spawnIceMist(
        this.scene,
        this.iceMists,
        position,
        direction,
        this.multiplayer.getId()
      );
    } else if (usesArrow) {
      this.multiplayer.send({
        type: 'projectile',
        id: this.multiplayer.getId(),
        position: position.toArray(),
        direction: direction.toArray(),
        weapon: 'bow'
      });

      this.playAction('projectile');
      this.spawnArrowProjectile(
        this.scene,
        this.projectiles,
        position,
        direction,
        this.multiplayer.getId()
      );
    } else {
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
    }
    return true;
  }

  shouldHoldToFire() {
    const weapon = this.getEquippedWeapon();
    return weapon?.itemId === 'bow';
  }

  setAiming(active) {
    if (this.isAiming === active) return;
    this.isAiming = active;
    if (this.crosshairEl) {
      this.crosshairEl.classList.toggle('visible', active);
    }
    if (active) {
      this.aimReleaseHoldUntil = null;
    } else {
      this.aimReleaseHoldUntil = performance.now() + this.aimReleaseDelayMs;
    }
  }

  getAimDirection(invertForBow = false) {
    const sourceQuaternion = this.camera?.quaternion ?? this.playerModel.quaternion;
    const direction = new THREE.Vector3(0, 0, 1).applyQuaternion(sourceQuaternion).normalize();
    if (invertForBow) {
      direction.multiplyScalar(-1);
    }
    return direction;
  }

  getPlayerFacingDirection() {
    if (!this.playerModel) return new THREE.Vector3(0, 0, 1);
    return new THREE.Vector3(0, 0, 1).applyQuaternion(this.playerModel.quaternion).normalize();
  }

  updateAimingRotation() {
    if (!this.isFireHeld || !this.shouldHoldToFire()) return;
    const direction = this.getAimDirection(true);
    this.alignPlayerToDirection(direction);
  }

  alignPlayerToDirection(direction) {
    if (!this.playerModel) return;
    const yaw = Math.atan2(direction.x, direction.z);
    this.playerModel.rotation.set(0, yaw, 0);
  }

  updateEngagedState() {
    if (!this.playerModel) {
      this.isEngaged = false;
      this.engagedTarget = null;
      return;
    }
    const monsters = window.monsters || [];
    let closest = null;
    let closestDistanceSq = Infinity;
    for (const monster of monsters) {
      if (!monster?.model || monster.isDead || monster.model.userData?.mode === 'dead') continue;
      const distanceSq = this.playerModel.position.distanceToSquared(monster.model.position);
      if (distanceSq < closestDistanceSq) {
        closestDistanceSq = distanceSq;
        closest = monster;
      }
    }
    if (closest && closestDistanceSq <= this.engagedModeDistanceSq) {
      this.isEngaged = true;
      this.engagedTarget = closest;
    } else {
      this.isEngaged = false;
      this.engagedTarget = null;
    }
  }

  updateEngagedFacing() {
    if (!this.isEngaged || !this.engagedTarget?.model || !this.playerModel) return;
    this.engagedTarget.model.getWorldPosition(this.engagedTargetPosition);
    this.engagedFacingDirection
      .copy(this.engagedTargetPosition)
      .sub(this.playerModel.position);
    this.engagedFacingDirection.y = 0;
    if (this.engagedFacingDirection.lengthSq() < 0.0001) return;
    this.engagedFacingDirection.normalize();
    this.alignPlayerToDirection(this.engagedFacingDirection);
  }

  getProjectileSpawnPosition(direction) {
    const offsetDistance = 0.6;
    const normalizedDirection = direction.clone().normalize();
    const gun = this.getEquippedGun();

    if (gun?.mesh) {
      const gunPosition = new THREE.Vector3();
      gun.mesh.getWorldPosition(gunPosition);
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
    this.setAmmo(nextAmmo);
  }

  setAmmo(value, label = this.ammoLabel, icon = this.ammoIcon) {
    const nextAmmo = Math.max(0, Math.floor(value));
    if (label) {
      this.ammoLabel = label;
    }
    if (icon) {
      this.ammoIcon = icon;
      if (this.ammoIconEl) {
        this.ammoIconEl.textContent = icon;
      }
    }
    if (nextAmmo === this.ammo) return;
    this.ammo = nextAmmo;
    this.updateAmmoUI(!!this.getEquippedGun());
    this.onAmmoChange?.(this.ammo);
  }

  updateAmmoUI(hasGun = !!this.getEquippedGun()) {
    if (this.ammoCountEl && this.lastAmmoValue !== this.ammo) {
      this.ammoCountEl.textContent = `${this.ammo}`;
      this.lastAmmoValue = this.ammo;
    }

    if (this.ammoContainerEl) {
      // Hide completely unless a gun is equipped
      if (this.lastHasGun !== hasGun) {
        this.ammoContainerEl.classList.toggle('hidden', !hasGun);
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

    const monsterList = window.monsters || [];
    for (const mon of monsterList) {
      const model = mon?.model || mon;
      if (!model) continue;
      const dist = playerPos.distanceTo(model.position);
      if (dist < minDist) {
        closest = { type: 'monster', model };
        minDist = dist;
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
        const sensitivity = 0.0025;
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

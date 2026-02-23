import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { getWaterDepth, SWIM_DEPTH_THRESHOLD, getTerrainHeight } from '../environment/water.js';
import { getSpawnPosition } from '../spawnUtils.js';
import { CHARACTER_MOVEMENT } from "../characters/CharacterBase.js";
import { getKnockbackImpulse, getKnockbackMotion } from "../knockback.js";
import { QuestManager } from "../quest.js";
import { loadNippleJs } from '../externalDeps.js';

// Movement constants
const SWIM_SPEED = 2;
const ENERGY_DEPLETED_SPEED_MULTIPLIER = 1.2;
const JUMP_FORCE = 4;
const FLY_JUMP_FORCE_MULTIPLIER = 2;
const PLAYER_RADIUS = 0.3;
const PLAYER_HALF_HEIGHT = 0.6;
const FLOAT_IDLE_DISPLAY_OFFSET = 0.2;
const CLIMB_SPEED = 1.6;
const CLIMB_SNAP_DISTANCE = 0.6;
const CLIMB_ENTRY_BUFFER_Y = 0.4;
const FRIENDLY_INTERACT_RANGE = 6;
const MUSHROOM_INTERACT_RANGE = 1.2;
const APPLE_INTERACT_RANGE = 3;
const WOOD_INTERACT_RANGE = 3;
const MEAT_INTERACT_RANGE = 3;
const ENGAGED_MODE_DISTANCE = 7;
const WEAPON_CAMERA_OFFSET = new THREE.Vector3(0, 0, -1.8);
const WEAPON_CAMERA_TARGET_OFFSET = new THREE.Vector3(0.75, 0, 0);
const WEAPON_CAMERA_FOV_DELTA = 8;
const MOBILE_PORTRAIT_CAMERA_DISTANCE_MULTIPLIER = 2.1;
const MOBILE_PORTRAIT_CAMERA_HEIGHT_BONUS = 0.8;
const MOBILE_PORTRAIT_CAMERA_FOV_BONUS = 14;
const ENGAGED_CAMERA_OFFSET = {
  right: 0.65,
  up: 0.4
};
const BED_SLEEP_PROMPT = "click or press 'x' to sleep";
const BED_WAKE_PROMPT = "click or press 'x' to wake";
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
const MERCHANT_DIALOGUE = {
  blocks: [
    "Welcome! Looking to trade?"
  ],
  responses: [
    {
      label: "Buy items",
      reply: "Here's what I have for sale.",
      merchantAction: "buy"
    },
    {
      label: "Sell items",
      reply: "Let's see what you've got.",
      merchantAction: "sell"
    }
  ]
};
const ACTION_LOCKED_ATTACKS = ['mutantPunch', 'swordSlash', 'swordSlashLeft', 'swordSpin', 'swordFwdSpin', 'leftPunch', 'mmaKick', 'runningKick', 'roll'];

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
    onAmmoChange,
    onSleepStart,
    onSleepEnd
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
    this.knockbackVelocity = new THREE.Vector3();
    this.freezeEndTime = 0;
    this.wasFrozen = false;
    this.isInvincible = false;
    this.invincibleUntil = 0;
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
    this.isSleeping = false;
    this.sleepData = null;
    this.onSleepStart = typeof onSleepStart === 'function' ? onSleepStart : null;
    this.onSleepEnd = typeof onSleepEnd === 'function' ? onSleepEnd : null;

    this.geoCenterLatLon = null;
    this.geoBoundsCenterXZ = null;
    this.geoBoundsShiftMeters = { x: 0, z: 0 };
    this.geoBoundHalfSizeM = 8;
    this.geoEdgeEpsM = 0.75;
    this.geoBoundsDebug = null;
    this.geoBoundsDebugArrow = null;
    this.geoBoundsLastMoveDirection = new THREE.Vector3(0, 0, 1);
    this.geoBoundsDebugHeight = 2;
    this.gpsMoveTarget = null;
    this.gpsMoveEpsilon = 0.35;
    this.groundOverrideY = null;

    // Player state
    this.canJump = true;
    this.keysPressed = new Set();
    this.isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    this.hasDoubleJumped = false;
    this.flySpellActive = false;
    this.flySpellEndsAt = 0;
    this.onFlyJump = null;
    this.currentSpecialAction = null;
    this.runningKickTimer = null;
    this.runningKickOriginalY = 0;
    this.energyDepleted = false;
    this.swordComboIndex = 0;
    
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
      this.playerModel.userData.isKnocked = false;
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
    this.climbOverlayEl = document.getElementById('climb-overlay');
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
      addXp: (amount) => window.addPlayerXp?.(amount),
      getMonsterXpForLevel: (level) => window.getMonsterXpForLevel?.(level)
    });
    window.questManager = this.questManager;
    this.crosshairEl = document.querySelector('.crosshair');
    this.defaultFov = this.camera.fov;
    this.aimFov = Math.max(40, this.defaultFov - 15);
    this.isAiming = false;
    this.isFireHeld = false;
    this.baseCameraOffset = this.cameraOffset.clone();
    this.aimCameraOffset = this.baseCameraOffset.clone().add(new THREE.Vector3(0, 0, -3.2));
    this.weaponCameraOffset = this.baseCameraOffset.clone().add(WEAPON_CAMERA_OFFSET);
    this.baseCameraOffsetDesktop = this.baseCameraOffset.clone();
    this.defaultFovDesktop = this.defaultFov;
    this.applyMobilePortraitCameraTuning();
    this.baseCameraTargetOffset = new THREE.Vector3();
    this.aimCameraTargetOffset = new THREE.Vector3(1.3, 0, 0);
    this.weaponCameraTargetOffset = WEAPON_CAMERA_TARGET_OFFSET.clone();
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
    this.engagedDirection = null;
    this.freeYaw = null;
    this.freePitch = null;
    this.firstPersonEnabled = false;

    if (this.interactionPromptEl) {
      const activateInteraction = (event) => {
        if (!this.interactionPromptEl.classList.contains('visible')) return;
        this.safePreventDefault(event);
        this.handlePickupAction();
      };
      if (this.isMobile) {
        this.interactionPromptEl.addEventListener('touchstart', activateInteraction, { passive: false });
      }
      this.interactionPromptEl.addEventListener('click', activateInteraction);
    }

    if (this.climbOverlayEl) {
      const activateClimb = (event) => {
        if (this.climbOverlayEl.classList.contains('hidden')) return;
        this.safePreventDefault(event);
        this.handleClimbAction();
      };
      this.climbOverlayEl.addEventListener('click', activateClimb);
      this.climbOverlayEl.addEventListener('touchstart', activateClimb, { passive: false });
    }

    if (this.friendlyInteractButton) {
      const activateFriendly = (event) => {
        if (this.friendlyInteractButton.classList.contains('hidden')) return;
        this.safePreventDefault(event);
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
    this.initializeActionButtons();
    if (this.isMobile) {
      this.initializeMobileControls().catch((error) => {
        console.warn('Mobile controls failed to initialize.', error);
      });
    } else {
      // this.setupPointerLock(); // leave pointer lock in PlayerControls
    }
  }
  
  safePreventDefault(event) {
    if (event?.cancelable) {
      event.preventDefault();
    }
  }

  async initializeMobileControls() {
    const nipplejs = await loadNippleJs();
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
      this.tryJump();
      this.safePreventDefault(event);
    });

    document.getElementById('jump-button').addEventListener('touchend', (event) => {
      if (!this.enabled || this.isInWater) return;
      this.jumpButtonPressed = false;
      this.safePreventDefault(event);
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
    });

    this.joystick.on('end', () => {
      this.joystickForce = 0;
    });

    // Touch camera control
    this.cameraTouchId = null;
    this.domElement.addEventListener('touchstart', (event) => {
      if (!this.enabled || this.isEngaged) return;
      for (const touch of event.changedTouches) {
        const target = document.elementFromPoint(touch.clientX, touch.clientY);
        if (target && !target.closest('#joystick-container') && !target.closest('#jump-button') && !target.closest('#action-buttons')) {
          this.cameraTouchId = touch.identifier;
          this.touchStartX = touch.clientX;
          this.touchStartY = touch.clientY;
          this.safePreventDefault(event);
          break;
        }
      }
    }, { passive: false });

    this.domElement.addEventListener('touchmove', (event) => {
      if (!this.enabled || this.isEngaged || this.cameraTouchId === null) return;
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
          this.safePreventDefault(event);
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
  }

  initializeActionButtons() {
    const actionContainer = document.getElementById('action-buttons');
    if (!actionContainer) return;

    actionContainer.innerHTML = '';

    const createButton = (id, className, label) => {
      const button = document.createElement('button');
      button.id = id;
      button.className = `action-button ${className}`;
      button.textContent = label;
      actionContainer.appendChild(button);
      return button;
    };

    this.punchButton = createButton('punch-button', 'mobile-primary-action', 'Attack');
    this.spellsButton = createButton('spells-button', 'mobile-primary-action', 'Spells');
    this.equipButton = createButton('equip-button', 'mobile-primary-action', 'EQUIP');
    this.optionLeftButton = createButton('left-punch-button', 'mobile-option-action', 'Shield');
    this.optionCenterButton = createButton('punch-kick-button', 'mobile-option-action', '🎤');
    this.optionRightButton = createButton('right-punch-button', 'mobile-option-action', '—');

    this.mobileEquipButtons = [];
    this.mobileActionState = 'default';
    this.mobileMeleeComboIndex = 0;
    this.mobileStatusToastTimer = null;
    this.mobileAttackHoldActive = false;
    this.mobileAttackPressStartedAt = 0;
    this.mobileAttackPressActive = false;
    this.lastTouchButtonTime = 0;

    const bindActionPress = (button, { onPressStart = null, onPressEnd = null }) => {
      if (!button) return;

      const canRunMouseHandler = () => (performance.now() - this.lastTouchButtonTime) > 550;

      button.addEventListener('touchstart', (event) => {
        this.lastTouchButtonTime = performance.now();
        if (onPressStart) onPressStart(event);
        this.safePreventDefault(event);
      }, { passive: false });

      button.addEventListener('touchend', (event) => {
        this.lastTouchButtonTime = performance.now();
        if (onPressEnd) onPressEnd(event);
        this.safePreventDefault(event);
      }, { passive: false });

      button.addEventListener('touchcancel', (event) => {
        this.lastTouchButtonTime = performance.now();
        if (onPressEnd) onPressEnd(event);
        this.safePreventDefault(event);
      }, { passive: false });

      button.addEventListener('mousedown', (event) => {
        if (!canRunMouseHandler()) return;
        if (onPressStart) onPressStart(event);
      });

      button.addEventListener('mouseup', (event) => {
        if (!canRunMouseHandler()) return;
        if (onPressEnd) onPressEnd(event);
      });

      button.addEventListener('mouseleave', (event) => {
        if (!canRunMouseHandler()) return;
        if (onPressEnd) onPressEnd(event);
      });

      button.addEventListener('click', (event) => event.preventDefault());
    };

    const onAttackPressStart = (event) => {
      if (!this.enabled) return;
      this.mobileAttackPressStartedAt = performance.now();
      this.mobileAttackPressActive = true;
      if (this.shouldHoldToFire()) {
        this.mobileAttackHoldActive = true;
        this.isFireHeld = true;
        this.setAiming(true);
      }
      if (event) this.safePreventDefault(event);
    };

    const onAttackPressEnd = (event) => {
      if (!this.enabled) return;
      if (!this.mobileAttackPressActive) return;
      this.mobileAttackPressActive = false;
      if (this.mobileAttackHoldActive) {
        this.mobileAttackHoldActive = false;
        this.isFireHeld = false;
        this.setAiming(false);
        this.attemptFireProjectile();
      } else {
        this.handlePrimaryAttackPress();
      }
      if (event) this.safePreventDefault(event);
    };

    bindActionPress(this.punchButton, {
      onPressStart: onAttackPressStart,
      onPressEnd: onAttackPressEnd
    });

    const onSpellsToggle = (event) => {
      if (!this.enabled) return;
      this.mobileActionState = this.mobileActionState === 'spell-options' ? 'default' : 'spell-options';
      this.refreshActionButtons();
      if (event) this.safePreventDefault(event);
    };
    bindActionPress(this.spellsButton, {
      onPressStart: onSpellsToggle
    });

    const openEquip = (event) => {
      if (!this.enabled) return;
      this.showMobileEquipMenu();
      if (event) this.safePreventDefault(event);
    };
    bindActionPress(this.equipButton, {
      onPressStart: openEquip
    });

    const handleOptionPick = (slot) => (event) => {
      if (!this.enabled) return;
      if (this.mobileActionState === 'spell-options') {
        if (slot === 'left') {
          const casted = this.castSpellById?.('shield');
          if (casted) {
            this.mobileActionState = 'default';
          }
        } else if (slot === 'right') {
          const casted = this.castSpellById?.('fly');
          if (casted) {
            this.mobileActionState = 'default';
          }
        } else if (slot === 'kick') {
          if (this.isVoiceListening?.()) {
            this.stopVoiceListening?.();
            this.mobileActionState = 'default';
          } else {
            this.handleVoiceMicPress?.();
          }
          if (event) this.safePreventDefault(event);
        }
      } else if (this.mobileActionState === 'freeze') {
        this.attemptFireProjectileForHand('right');
      } else {
        this.handlePrimaryAttackPress();
      }
      this.refreshActionButtons();
      if (event) this.safePreventDefault(event);
    };

    bindActionPress(this.optionLeftButton, { onPressStart: handleOptionPick('left') });
    bindActionPress(this.optionCenterButton, { onPressStart: handleOptionPick('kick') });
    bindActionPress(this.optionRightButton, { onPressStart: handleOptionPick('right') });

    this.refreshActionButtons();
  }


  getNextSwordAttackAction({ advance = true } = {}) {
    const swordCombo = ['swordSlash', 'swordSlashLeft', 'swordSpin', 'swordFwdSpin'];
    const action = swordCombo[this.swordComboIndex % swordCombo.length];
    if (advance) {
      this.swordComboIndex = (this.swordComboIndex + 1) % swordCombo.length;
    }
    return action;
  }

  getMobileAttackLabel() {
    const weapon = this.getEquippedWeapon('right');
    if (weapon?.itemId === 'bow') return 'Bow';
    if (weapon?.itemId === 'bomb') return 'Bomb';
    return 'Attack';
  }

  performAttackForSlot(slot) {
    if (!this.enabled || this.isInWater) return false;
    if (slot === 'kick') {
      return this.playAction('mmaKick');
    }

    const hand = slot === 'left' ? 'left' : 'right';
    const weapon = this.getEquippedWeapon(hand);
    if (this.isProjectileWeapon(weapon)) {
      if (this.shouldHoldToFire(hand)) {
        this.isFireHeld = true;
        this.setAiming(true);
        setTimeout(() => {
          this.isFireHeld = false;
          this.setAiming(false);
          this.attemptFireProjectileForHand(hand);
        }, 150);
      } else {
        this.attemptFireProjectileForHand(hand);
      }
      return true;
    }

    return this.playAction(hand === 'left' ? 'leftPunch' : 'mutantPunch');
  }

  handlePrimaryAttackPress() {
    const weapon = this.getEquippedWeapon('right');
    if (weapon?.itemId === 'bow' || weapon?.itemId === 'bomb') {
      this.attemptFireProjectileForHand('right');
      return;
    }
    if (weapon?.itemId === 'autumnSword') {
      const attackAction = this.getNextSwordAttackAction({ advance: false });
      const started = this.playAction(attackAction);
      if (!started) return;
      this.swordComboIndex = (this.swordComboIndex + 1) % 4;
      if (attackAction === 'swordSlash' || attackAction === 'swordSlashLeft') {
        this.audioManager?.playSFX('SFX/Attacks/Sword Attacks Hits and Blocks/Sword Attack 1.ogg', 0.6, {
          cooldownKey: 'sword-attack',
          cooldownMs: this.audioManager?.performanceProfile?.attackCooldownMs ?? 120
        });
      }
      return;
    }
    const cycle = ['right', 'left', 'kick'];
    const slot = cycle[this.mobileMeleeComboIndex % cycle.length];
    const started = this.performAttackForSlot(slot);
    if (!started) return;
    this.mobileMeleeComboIndex = (this.mobileMeleeComboIndex + 1) % cycle.length;
  }

  showMobileEquipMenu() {
    const actionContainer = document.getElementById('action-buttons');
    if (!actionContainer) return;

    const appState = window.appState;
    const inventory = appState?.getInventory?.() || {};
    const equipCandidates = [
      { id: 'bomb', label: 'Bomb' },
      { id: 'bow', label: 'Bow' },
      { id: 'iceGun', label: 'Ice Gun' },
      { id: 'autumnSword', label: 'Sword' },
      { id: 'lantern', label: 'Lantern' },
      { id: 'torch', label: 'Torch' }
    ];

    this.mobileEquipButtons.forEach(button => button.remove());
    this.mobileEquipButtons = [];

    const hasInventoryItem = (itemId) => {
      const entry = inventory[itemId];
      const count = Number(entry?.count);
      return Number.isFinite(count) && count > 0;
    };

    const itemsToShow = equipCandidates.filter(item => hasInventoryItem(item.id));
    if (!itemsToShow.length) {
      this.mobileActionState = 'default';
      this.refreshActionButtons();
      this.showMobileStatusToast('No items in inventory!');
      return;
    }

    this.mobileActionState = 'equip';

    itemsToShow.forEach((item) => {
      const button = document.createElement('button');
      button.className = 'action-button mobile-equip-action';
      button.textContent = item.label;
      const onEquip = (event) => {
        if (!this.enabled) return;
        const isEquipped = appState?.isInventoryItemEquipped?.(item.id);
        if (isEquipped) appState?.unequipInventoryItem?.(item.id);
        else appState?.equipInventoryItem?.(item.id);
        this.mobileActionState = 'default';
        this.refreshActionButtons();
        if (event) this.safePreventDefault(event);
      };
      button.addEventListener('touchstart', (event) => {
        this.lastTouchButtonTime = performance.now();
        onEquip(event);
      }, { passive: false });
      button.addEventListener('mousedown', (event) => {
        if ((performance.now() - this.lastTouchButtonTime) <= 550) return;
        onEquip(event);
      });
      button.addEventListener('click', (event) => event.preventDefault());
      this.mobileEquipButtons.push(button);
      actionContainer.appendChild(button);
    });

    this.refreshActionButtons();
  }

  showMobileStatusToast(message) {
    if (!message) return;

    let toast = document.getElementById('mobile-action-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'mobile-action-toast';
      document.body.appendChild(toast);
    }

    toast.textContent = message;
    toast.classList.add('visible');

    if (this.mobileStatusToastTimer) {
      clearTimeout(this.mobileStatusToastTimer);
    }

    this.mobileStatusToastTimer = setTimeout(() => {
      toast.classList.remove('visible');
    }, 1400);
  }

  refreshActionButtons() {
    const actionContainer = document.getElementById('action-buttons');
    if (!actionContainer || !this.punchButton) return;

    const voiceState = this.getVoiceMicState?.() || { disabled: false, remainingSeconds: 0 };
    const rightWeapon = this.getEquippedWeapon('right');
    const isIceGunEquipped = rightWeapon?.itemId === 'iceGun';

    let state = this.mobileActionState || 'default';
    if (state === 'freeze' && !isIceGunEquipped) {
      state = 'default';
      this.mobileActionState = 'default';
    }

    if (state === 'default' && isIceGunEquipped) {
      state = 'freeze';
      this.mobileActionState = 'freeze';
    }

    actionContainer.classList.toggle('mobile-spell-options', state === 'spell-options');
    actionContainer.classList.toggle('mobile-equip-mode', state === 'equip');
    actionContainer.classList.toggle('mobile-freeze-mode', state === 'freeze');

    this.punchButton.textContent = this.getMobileAttackLabel();
    this.spellsButton.textContent = 'Spells';
    this.spellsButton.disabled = false;

    this.optionLeftButton.textContent = isIceGunEquipped ? 'Freeze' : 'Shield';
    this.optionLeftButton.disabled = false;
    this.optionCenterButton.textContent = '🎤';
    this.optionCenterButton.disabled = false;
    this.optionRightButton.textContent = 'Fly';
    this.optionRightButton.disabled = false;

    this.punchButton.style.display = '';

    if (state === 'spell-options') {
      const shieldState = this.getSpellStateById?.('shield') || { disabled: true, remainingSeconds: 0 };
      const flyState = this.getSpellStateById?.('fly') || { disabled: true, remainingSeconds: 0 };
      this.optionLeftButton.textContent = shieldState.remainingSeconds > 0 ? `Shield ${shieldState.remainingSeconds}s` : 'Shield';
      this.optionLeftButton.disabled = !!shieldState.disabled;
      this.optionRightButton.textContent = flyState.remainingSeconds > 0 ? `Fly ${flyState.remainingSeconds}s` : 'Fly';
      this.optionRightButton.disabled = !!flyState.disabled;

      if (this.isVoiceListening?.()) {
        this.optionCenterButton.textContent = '■';
      } else {
        this.optionCenterButton.textContent = voiceState.remainingSeconds > 0 ? `🎤 ${voiceState.remainingSeconds}s` : '🎤';
        this.optionCenterButton.disabled = !!voiceState.disabled;
      }
    } else if (state === 'freeze') {
      this.optionCenterButton.disabled = true;
      this.optionRightButton.disabled = true;
    }

    if (state !== 'equip') {
      this.mobileEquipButtons.forEach(button => button.remove());
      this.mobileEquipButtons = [];
    }

    this.layoutMobileActionButtons(state);
  }

  getMobileActionSlots(buttonCount) {
    if (buttonCount <= 0) return [];
    const slots = [
      // btn1, btn2, btn3 map to Equip, Spells, Attack positions.
      { x: 1, y: 1 },
      { x: 0, y: 1 },
      { x: 1, y: 0 }
    ];

    if (buttonCount <= slots.length) return slots.slice(0, buttonCount);

    // Layer expansion:
    // 1) Fill the new top row above current area (excluding the new left column),
    // 2) Then fill the new left column from bottom to top.
    for (let layer = 2; slots.length < buttonCount; layer += 1) {
      for (let x = layer - 1; x >= 0; x -= 1) {
        slots.push({ x, y: layer });
        if (slots.length >= buttonCount) return slots.slice(0, buttonCount);
      }

      for (let y = 0; y <= layer; y += 1) {
        slots.push({ x: layer, y });
        if (slots.length >= buttonCount) return slots.slice(0, buttonCount);
      }
    }

    return slots.slice(0, buttonCount);
  }

  applyMobileButtonPosition(button, slot) {
    if (!button || !slot) return;
    button.style.setProperty('--mobile-grid-x', String(slot.x));
    button.style.setProperty('--mobile-grid-y', String(slot.y));
  }

  layoutMobileActionButtons(state) {
    const clearButtonPos = (button) => {
      button?.style?.removeProperty('--mobile-grid-x');
      button?.style?.removeProperty('--mobile-grid-y');
    };

    [
      this.punchButton,
      this.spellsButton,
      this.equipButton,
      this.optionLeftButton,
      this.optionCenterButton,
      this.optionRightButton,
      ...(this.mobileEquipButtons || [])
    ].forEach(clearButtonPos);

    if (state === 'spell-options') {
      this.applyMobileButtonPosition(this.optionLeftButton, { x: 1, y: 1 });
      this.applyMobileButtonPosition(this.optionCenterButton, { x: 0, y: 1 });
      this.applyMobileButtonPosition(this.optionRightButton, { x: 1, y: 0 });
      return;
    }

    if (state === 'freeze') {
      // Keep the core layout visible and add Freeze as an extra row above.
      this.applyMobileButtonPosition(this.punchButton, { x: 1, y: 0 });
      this.applyMobileButtonPosition(this.spellsButton, { x: 0, y: 1 });
      this.applyMobileButtonPosition(this.equipButton, { x: 1, y: 1 });
      this.applyMobileButtonPosition(this.optionLeftButton, { x: 1, y: 2 });
      this.applyMobileButtonPosition(this.optionCenterButton, { x: 0, y: 2 });
      this.applyMobileButtonPosition(this.optionRightButton, { x: 0, y: 0 });
      return;
    }

    if (state === 'equip') {
      const slots = this.getMobileActionSlots((this.mobileEquipButtons || []).length);
      this.mobileEquipButtons.forEach((button, index) => {
        this.applyMobileButtonPosition(button, slots[index]);
      });
      return;
    }

    this.applyMobileButtonPosition(this.punchButton, { x: 1, y: 0 });
    this.applyMobileButtonPosition(this.spellsButton, { x: 0, y: 1 });
    this.applyMobileButtonPosition(this.equipButton, { x: 1, y: 1 });
  }

  setupEventListeners() {
    // Listen for key events (for desktop controls)
    document.addEventListener("keydown", (e) => {
      if (!this.enabled && !this.isSleeping) return;
      const key = e.key.toLowerCase();
      this.keysPressed.add(key);

      if (this.isSleeping) {
        if (key === 'x') {
          this.wakeFromSleep();
        }
        return;
      }

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
        if (this.handleClimbAction()) {
          return;
        }
        this.handlePickupAction();
        return;
      }

      if (e.key === " ") {
        if (e.repeat) return;
        if (this.parachute) {
          this.removeParachute();
          return;
        }
        if (this.isInWater) return;
        this.tryJump();
      } else if (key === 'e') {
        if (this.vehicle) if (this.vehicle.type === 'surfboard') this.vehicle.toggleStand();
        if (this.isInWater) return;
        if (this.isMoving && !this.isSlideMomentumActive()) {
          this.slideMomentum.copy(this.lastMoveDirection).multiplyScalar(0.35);
        }
        const sword = this.getEquippedSword();
        const attackAction = sword ? this.getNextSwordAttackAction({ advance: false }) : 'mutantPunch';
        const started = this.playAction(attackAction);
        if (!started) return;
        if (sword) {
          this.swordComboIndex = (this.swordComboIndex + 1) % 4;
        }
        if (attackAction === 'swordSlash' || attackAction === 'swordSlashLeft') {
          this.audioManager?.playSFX('SFX/Attacks/Sword Attacks Hits and Blocks/Sword Attack 1.ogg', 0.6, {
            cooldownKey: 'sword-attack',
            cooldownMs: this.audioManager?.performanceProfile?.attackCooldownMs ?? 120
          });
        } else {
          this.audioManager?.playAttack();
        }
      } else if (key === 'q') {
        if (this.isInWater) return;
        if (this.isMoving && !this.isSlideMomentumActive()) {
          this.slideMomentum.copy(this.lastMoveDirection).multiplyScalar(0.35);
        }
        const started = this.playAction('leftPunch');
        if (!started) return;
        const leftHandItem = this.getEquippedWeapon('left')?.itemId;
        if (leftHandItem === 'torch' || leftHandItem === 'lantern') {
          this.audioManager?.playSFX('SFX/Torch/Torch Attack Strike 1.ogg', 0.65, {
            cooldownKey: 'torch-strike',
            cooldownMs: this.audioManager?.performanceProfile?.attackCooldownMs ?? 120
          });
        } else {
          this.audioManager?.playAttack();
        }
      } else if (key === 'r') {
        if (this.isInWater) return;
        if (this.isMoving && !this.isSlideMomentumActive()) {
          this.slideMomentum.copy(this.lastMoveDirection).multiplyScalar(1.1);
          const started = this.playAction('runningKick');
          if (!started) return;
          this.audioManager?.playAttack();
        } else {
          const started = this.playAction('mmaKick');
          if (!started) return;
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
      this.applyMobilePortraitCameraTuning();
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      if (this.renderer) {
        this.renderer.setSize(window.innerWidth, window.innerHeight);
      }
    });

    window.addEventListener('orientationchange', () => {
      this.applyMobilePortraitCameraTuning();
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

  applyMobilePortraitCameraTuning() {
    const isPortraitMobile = this.isMobile && window.innerHeight > window.innerWidth;
    const nextBaseCameraOffset = this.baseCameraOffsetDesktop.clone();
    const nextDefaultFov = this.defaultFovDesktop;

    if (isPortraitMobile) {
      nextBaseCameraOffset.z *= MOBILE_PORTRAIT_CAMERA_DISTANCE_MULTIPLIER;
      nextBaseCameraOffset.y += MOBILE_PORTRAIT_CAMERA_HEIGHT_BONUS;
      this.defaultFov = nextDefaultFov + MOBILE_PORTRAIT_CAMERA_FOV_BONUS;
    } else {
      this.defaultFov = nextDefaultFov;
    }

    this.baseCameraOffset.copy(nextBaseCameraOffset);
    this.aimCameraOffset.copy(this.baseCameraOffset).add(new THREE.Vector3(0, 0, -3.2));
    this.weaponCameraOffset.copy(this.baseCameraOffset).add(WEAPON_CAMERA_OFFSET);
    this.aimFov = Math.max(40, this.defaultFov - 15);
  }

  handleFriendlyInteractionAction() {
    if (!this.enabled || this.isSleeping) return;

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

  handleClimbAction() {
    if (!this.enabled || this.isSleeping || this.vehicle || this.isInteracting) return false;
    if (this.isClimbing) return false;
    if (!this.playerModel) return false;

    const position = this.playerModel.position;
    const climbArea = this.findClimbableArea(position);
    if (!climbArea) return false;

    const nearEntry = this.isWithinClimbEntry(climbArea, position);
    const movement = this.lastMoveDirection?.length?.() > 0 ? this.lastMoveDirection : null;
    if (!nearEntry && !this.isMovingTowardClimbArea(climbArea, movement)) return false;

    this.startClimbing(climbArea);
    return true;
  }

  handlePickupAction() {
    if (!this.enabled && !this.isSleeping) return;

    if (this.isSleeping) {
      this.wakeFromSleep();
      return;
    }

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

    if (closest.type === 'wood') {
      window.pickupWood?.(closest.pickup);
      return;
    }

    if (closest.type === 'meat') {
      window.pickupMeat?.(closest.pickup);
      return;
    }

    if (closest.type === 'craft-table') {
      window.openCraftPanel?.();
      return;
    }

    if (closest.type === 'bed') {
      this.startSleep(closest.bed);
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
    const merchant = window.merchantFriendly;
    if (merchant?.model && !merchant.isDead) {
      const dist = this.playerModel.position.distanceTo(merchant.model.position);
      if (dist <= maxDistance && dist < closestDistance) {
        closestDistance = dist;
        closest = merchant;
      }
    }
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

    const bed = window.bed;
    if (bed?.mesh) {
      const bedPosition = bed.getWorldPosition?.(new THREE.Vector3()) ?? bed.mesh.position;
      const dist = playerPos.distanceTo(bedPosition);
      const maxDistance = bed.getInteractionDistance?.() ?? 2.5;
      consider(dist, {
        type: 'bed',
        bed,
        maxDistance,
        promptText: BED_SLEEP_PROMPT
      });
    }

    const craftTable = window.craftTable;
    if (craftTable?.mesh) {
      const tablePosition = craftTable.getWorldPosition?.(new THREE.Vector3()) ?? craftTable.mesh.position;
      const dist = playerPos.distanceTo(tablePosition);
      const maxDistance = craftTable.getInteractionDistance?.() ?? 3;
      const promptText = this.isMobile
        ? 'click to craft'
        : "Press 'x' to craft";
      consider(dist, {
        type: 'craft-table',
        craftTable,
        maxDistance,
        promptText
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
      const pickupPosition = pickup.mesh.getWorldPosition?.(new THREE.Vector3()) ?? pickup.mesh.position;
      const dist = playerPos.distanceTo(pickupPosition);
      consider(dist, {
        type: 'apple',
        pickup,
        maxDistance: APPLE_INTERACT_RANGE,
        promptText: "'x' pick up apple"
      });
    });

    const woodPickups = Array.isArray(window.woodPickups) ? window.woodPickups : [];
    woodPickups.forEach((pickup) => {
      if (!pickup?.mesh || !pickup.mesh.visible) return;
      const dist = playerPos.distanceTo(pickup.mesh.position);
      consider(dist, {
        type: 'wood',
        pickup,
        maxDistance: WOOD_INTERACT_RANGE,
        promptText: "'x' pick up wood"
      });
    });

    const meatPickups = Array.isArray(window.meatPickups) ? window.meatPickups : [];
    meatPickups.forEach((pickup) => {
      if (!pickup?.mesh || !pickup.mesh.visible) return;
      const dist = playerPos.distanceTo(pickup.mesh.position);
      consider(dist, {
        type: 'meat',
        pickup,
        maxDistance: MEAT_INTERACT_RANGE,
        promptText: "'x' pick up meat"
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
    const isMerchant = friendly?.model?.userData?.npcRole === 'merchant';
    const choice = isMerchant
      ? MERCHANT_DIALOGUE
      : this.questManager?.getDialogueForFriendly(friendly, FRIENDLY_DIALOGUE_POOL) || null;
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
    if (this.isSleeping) {
      this.friendlyInteractButton?.classList.add('hidden');
      this.friendlyDialogueEl?.classList.add('hidden');
      return;
    }
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
    if (!this.playerModel) return false;
    const resolvedAction = actionName === 'mutantPunch' && this.getEquippedSword() ? 'swordSlash' : actionName;
    const swordAttackActions = ['swordSlash', 'swordSlashLeft', 'swordSpin', 'swordFwdSpin'];
    const actions = this.playerModel.userData.actions;
    if (!actions || !actions[resolvedAction]) return false;
    if (ACTION_LOCKED_ATTACKS.includes(resolvedAction) && ACTION_LOCKED_ATTACKS.includes(this.currentSpecialAction)) return false;

    if (this.runningKickTimer) {
      clearTimeout(this.runningKickTimer);
      this.runningKickTimer = null;
      const pivot = this.playerModel.userData.pivot;
      if (pivot) {
        pivot.rotation.y = this.runningKickOriginalY;
      }
    }

    const current = this.playerModel.userData.currentAction;
    const action = actions[resolvedAction];
    actions[current]?.fadeOut(0.1);
    action.reset().fadeIn(0.1).play();
    this.playerModel.userData.currentAction = resolvedAction;
    this.currentSpecialAction = resolvedAction;

    if (["mutantPunch", "swordSlash", "swordSlashLeft", "swordSpin", "swordFwdSpin", "leftPunch", "hurricaneKick", "mmaKick", "runningKick"].includes(resolvedAction)) {
      const isPunch = resolvedAction === 'mutantPunch' || resolvedAction === 'leftPunch' || swordAttackActions.includes(resolvedAction);
      const attackName = isPunch && this.getEquippedSword()
        ? (swordAttackActions.includes(resolvedAction) ? resolvedAction : 'swordSlash')
        : isPunch
          ? 'mutantPunch'
          : resolvedAction;
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
    return true;
  }

  applyKnockback({ direction, strength } = {}) {
    if (!direction || !this.playerModel) return;
    if (this.isClimbing) {
      this.stopClimbing();
    }
    const { impulse, profile } = getKnockbackImpulse(direction, strength);
    const { velocity } = getKnockbackMotion(direction, strength);
    if (this.body) {
      this.body.applyImpulse({ x: impulse.x, y: impulse.y, z: impulse.z }, true);
      const vel = this.body.linvel();
      this.body.setLinvel({ x: velocity.x, y: vel.y, z: velocity.z }, true);
    }
    this.knockbackVelocity.copy(velocity);
    this.isKnocked = true;
    this.playerModel.userData.isKnocked = true;
    const now = Date.now();
    this.knockbackEndTime = Math.max(this.knockbackEndTime || 0, now + profile.recoveryMs);
    this.knockbackRestYaw = this.playerModel.rotation.y;
    this.playerModel.userData.attack = null;
    const actions = this.playerModel.userData.actions;
    const current = this.playerModel.userData.currentAction;
    const hitAction = actions?.hit;
    this.currentSpecialAction = null;
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
    this.currentSpecialAction = null;
    window.natureController?.setTreeColliderEnabled?.(false);
  }

  stopClimbing() {
    if (!this.isClimbing) return;
    const actions = this.playerModel?.userData?.actions;
    if (actions?.climb) {
      actions.climb.paused = false;
      actions.climb.timeScale = 1;
      if (this.playerModel?.userData?.currentAction === 'climb') {
        actions.climb.fadeOut(0.1);
        this.playerModel.userData.currentAction = null;
      }
    }
    this.isClimbing = false;
    this.activeClimbArea = null;
    window.natureController?.setTreeColliderEnabled?.(true);
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
    const movementLocked = freezeActive || ['mutantPunch', 'swordSlash', 'swordSlashLeft', 'swordSpin', 'swordFwdSpin', 'leftPunch', 'mmaKick', 'runningKick'].includes(this.currentSpecialAction);
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
    if (this.isClimbing) {
      if (!climbArea) {
        this.stopClimbing();
      } else {
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
        this.playerModel.userData.isKnocked = false;
        this.knockbackVelocity.set(0, 0, 0);
        this.playerModel.rotation.set(0, this.knockbackRestYaw || this.playerModel.rotation.y, 0);
        const actions = this.playerModel.userData.actions;
        actions?.hit?.fadeOut(0.2);
        actions?.idle?.reset().fadeIn(0.2).play();
        this.playerModel.userData.currentAction = 'idle';
      } else {
        this.body.setLinvel({ x: this.knockbackVelocity.x, y: vel.y, z: this.knockbackVelocity.z }, true);
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
      const radius = this.geoBoundHalfSizeM;

      const shiftX = this.geoBoundsShiftMeters?.x ?? 0;
      const shiftZ = this.geoBoundsShiftMeters?.z ?? 0;

      const prevCenterX = this.geoBoundsCenterXZ.x - shiftX;
      const prevCenterZ = this.geoBoundsCenterXZ.z - shiftZ;

      const edgeEps = this.geoEdgeEpsM;

      let targetX = newX;
      let targetZ = newZ;

      // "Conveyor" push only if player was near the OLD boundary edge
      const prevDx = newX - prevCenterX;
      const prevDz = newZ - prevCenterZ;
      const prevDistance = Math.hypot(prevDx, prevDz);
      if (prevDistance >= radius - edgeEps) {
        targetX += shiftX;
        targetZ += shiftZ;
        pushedByGeo = (shiftX !== 0) || (shiftZ !== 0);
      }

      const centerDx = targetX - this.geoBoundsCenterXZ.x;
      const centerDz = targetZ - this.geoBoundsCenterXZ.z;
      const centerDistance = Math.hypot(centerDx, centerDz);

      let clampedX = targetX;
      let clampedZ = targetZ;
      if (centerDistance > radius) {
        const scale = radius / Math.max(centerDistance, 1e-6);
        clampedX = this.geoBoundsCenterXZ.x + centerDx * scale;
        clampedZ = this.geoBoundsCenterXZ.z + centerDz * scale;
      }

      clampedByGeo = (clampedX !== targetX) || (clampedZ !== targetZ);

      if (clampedByGeo || clampedX !== newX || clampedZ !== newZ) {
        // Cancel outward velocity into the boundary wall.
        const v = this.body.linvel();
        let vx = v.x, vz = v.z;
        if (centerDistance > 1e-6) {
          const outwardX = centerDx / centerDistance;
          const outwardZ = centerDz / centerDistance;
          const outwardVel = vx * outwardX + vz * outwardZ;
          if (outwardVel > 0) {
            vx -= outwardX * outwardVel;
            vz -= outwardZ * outwardVel;
          }
        }

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
      if (this.engagedDirection) {
        yawAngle = Math.atan2(this.engagedDirection.x, this.engagedDirection.z);
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

    this.updateEngagedMode();

    const rotateSpeed = CHARACTER_MOVEMENT.turnRate * 3.5;
    if (!this.isEngaged) {
      if (this.keys.has('ArrowLeft')) this.yaw += rotateSpeed;
      if (this.keys.has('ArrowRight')) this.yaw -= rotateSpeed;
    }

    const maxPitch = Math.PI / 3;   // ~60° upward
    const minPitch = -Math.PI / 8;  // ~30° downward

    if (!this.isEngaged) {
      if (this.keys.has('ArrowUp')) {
        this.pitch = Math.min(maxPitch, this.pitch + 0.02);
      }
      if (this.keys.has('ArrowDown')) {
        this.pitch = Math.max(minPitch, this.pitch - 0.02);
      }
    }

    const shouldHoldAim = !this.isAiming && this.aimReleaseHoldUntil && now < this.aimReleaseHoldUntil;
    const aimingActive = !this.isEngaged && (this.isAiming || shouldHoldAim);
    const engagedCameraActive = this.isEngaged;
    const weaponCameraActive = !engagedCameraActive && !aimingActive;
    const closeCameraActive = aimingActive || weaponCameraActive || engagedCameraActive;
    const aimLerpSpeed = closeCameraActive ? this.aimZoomInSpeed : this.aimZoomOutSpeed;
    const aimLerpFactor = 1 - Math.exp(-aimLerpSpeed * this.deltaSeconds);
    const targetOffset = aimingActive
      ? this.aimCameraOffset
      : weaponCameraActive
        ? this.weaponCameraOffset
        : this.baseCameraOffset;
    const shoulderFov = Math.max(45, this.defaultFov - WEAPON_CAMERA_FOV_DELTA);
    const targetFov = aimingActive
      ? this.aimFov
      : (weaponCameraActive || engagedCameraActive)
        ? shoulderFov
        : this.defaultFov;
    this.cameraOffset.lerp(targetOffset, aimLerpFactor);
    const targetCameraTargetOffset = aimingActive
      ? this.aimCameraTargetOffset
      : weaponCameraActive
        ? this.weaponCameraTargetOffset
        : this.baseCameraTargetOffset;
    this.cameraTargetOffset.lerp(targetCameraTargetOffset, aimLerpFactor);
    this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, targetFov, aimLerpFactor);
    this.camera.updateProjectionMatrix();

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
    let desiredCameraPosition;
    let cameraLookTarget = orbitCenter;
    if (this.firstPersonEnabled) {
      desiredCameraPosition = orbitCenter.clone().add(new THREE.Vector3(0, 0.62, 0));
      const cosPitch = Math.cos(this.pitch);
      const forward = new THREE.Vector3(
        Math.sin(this.yaw) * cosPitch,
        Math.sin(this.pitch),
        Math.cos(this.yaw) * cosPitch
      ).normalize();
      cameraLookTarget = desiredCameraPosition.clone().addScaledVector(forward, 10);
    } else if (this.isEngaged && this.engagedDirection) {
      const engagedYaw = Math.atan2(this.engagedDirection.x, this.engagedDirection.z);
      this.yaw = engagedYaw;
      this.pitch = 0;
      const shoulderOffset = this.weaponCameraOffset || this.baseCameraOffset || this.cameraOffset;
      const cameraDistance = Math.max(2.5, Math.abs(shoulderOffset?.z ?? this.cameraOffset.z));
      const cameraHeight = shoulderOffset?.y ?? this.cameraOffset.y ?? 1;
      const behindOffset = this.engagedDirection.clone().multiplyScalar(-cameraDistance);
      const engagedRight = new THREE.Vector3(-this.engagedDirection.z, 0, this.engagedDirection.x).normalize();
      desiredCameraPosition = orbitCenter.clone()
        .add(new THREE.Vector3(0, cameraHeight + ENGAGED_CAMERA_OFFSET.up, 0))
        .add(behindOffset)
        .addScaledVector(engagedRight, ENGAGED_CAMERA_OFFSET.right);
    } else {
      const rotatedOffset = new THREE.Vector3(
        offset.x * Math.cos(this.yaw) - offset.z * Math.sin(this.yaw),
        offset.y + 5 * Math.sin(this.pitch),
        offset.x * Math.sin(this.yaw) + offset.z * Math.cos(this.yaw)
      );
      desiredCameraPosition = orbitCenter.clone().add(rotatedOffset);
    }
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
    this.camera.lookAt(cameraLookTarget);

    if (this.playerModel && this.playerModel.userData.mixer) {
      this.playerModel.userData.mixer.update(delta);
    }
    this.updateFlyWingsAnimation?.(delta);

    if (this.enabled && !this.isSleeping) {
      this.processMovement();
    }
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
    this.updateClimbOverlay();

    const hasGun = !!this.getEquippedGun();
    if (hasGun !== this.lastHasGun) {
      this.updateAmmoUI(hasGun);
    }
  }

  handleDialogueOption(option) {
    this.questManager?.handleDialogueOption(option, this.activeFriendly);
    if (option?.merchantAction) {
      void import('./merchantPanel.js').then(({ openMerchantPanel }) => openMerchantPanel(option.merchantAction));
    }
  }

  getWeapons() {
    const weapons = Object.values(window.weapons || {}).filter(Boolean);
    const pickups = Array.isArray(window.weaponPickups) ? window.weaponPickups : [];
    return weapons.concat(pickups);
  }

  getEquippedWeapon(hand = 'right') {
    return this.getWeapons().find(weapon => weapon.holder === this && (hand === 'left' ? weapon.hand === 'left' : weapon.hand !== 'left')) || null;
  }

  getEquippedGun(hand = 'right') {
    return this.getWeapons().find(
      weapon => weapon.holder === this
        && (hand === 'left' ? weapon.hand === 'left' : weapon.hand !== 'left')
        && (weapon.type === 'gun' || weapon.type === 'bow')
    ) || null;
  }

  getEquippedSword(hand = 'right') {
    return this.getWeapons().find(
      weapon => weapon.holder === this
        && (hand === 'left' ? weapon.hand === 'left' : weapon.hand !== 'left')
        && weapon.type === 'sword'
    ) || null;
  }

  updateClimbOverlay() {
    if (!this.climbOverlayEl || !this.playerModel) return;
    if (this.isClimbing || this.isSleeping || this.vehicle || this.isInteracting) {
      this.climbOverlayEl.classList.add('hidden');
      return;
    }

    const position = this.playerModel.position;
    const climbArea = this.findClimbableArea(position);
    const nearEntry = climbArea && this.isWithinClimbEntry(climbArea, position);
    const movement = this.lastMoveDirection?.length?.() > 0 ? this.lastMoveDirection : null;
    const movingToward = climbArea && this.isMovingTowardClimbArea(climbArea, movement);
    const canStartClimbing = !!climbArea && (nearEntry || movingToward);

    if (canStartClimbing) {
      this.climbOverlayEl.textContent = this.isMobile ? 'Tap to climb' : "Press X to climb";
      this.climbOverlayEl.classList.remove('hidden');
    } else {
      this.climbOverlayEl.classList.add('hidden');
    }
  }

  updateInteractionPrompt() {
    if (!this.interactionPromptEl || !this.playerModel) return;

    let promptText = '';
    let visible = false;

    if (this.isSleeping) {
      promptText = BED_WAKE_PROMPT;
      visible = true;
    } else if (this.vehicle) {
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

  startSleep(bed) {
    if (this.isSleeping || !bed?.mesh || !this.playerModel) return;
    const maxDistance = bed.getInteractionDistance?.() ?? 2.5;
    const bedPosition = bed.getWorldPosition?.(new THREE.Vector3()) ?? bed.mesh.position;
    const distance = this.playerModel.position.distanceTo(bedPosition);
    if (distance > maxDistance) return;

    const sleepPosition = bed.getSleepPosition?.();
    if (!sleepPosition) return;

    this.sleepData = {
      bed,
      previousQuaternion: this.playerModel.quaternion.clone(),
      previousYaw: this.playerModel.rotation.y
    };
    this.isSleeping = true;
    this.isMoving = false;
    this.keysPressed.clear();
    this.setAiming(false);
    if (this.playerModel.userData?.actions) {
      Object.values(this.playerModel.userData.actions).forEach(action => action?.stop?.());
    }
    this.playerModel.userData.currentAction = null;

    const bedQuaternion = new THREE.Quaternion();
    bed.mesh.getWorldQuaternion(bedQuaternion);
    const bedYaw = new THREE.Euler().setFromQuaternion(bedQuaternion, 'YXZ').y;

    this.playerModel.position.copy(sleepPosition);
    this.playerModel.quaternion.setFromEuler(new THREE.Euler(Math.PI / 2, bedYaw - Math.PI / 2, 0, 'YXZ')); // Math.PI / 2, bedYaw, 0

    if (this.body) {
      this.body.setTranslation({ x: sleepPosition.x, y: sleepPosition.y, z: sleepPosition.z }, true);
      this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }

    this.onSleepStart?.({ bed });
  }

  wakeFromSleep() {
    if (!this.isSleeping) return;
    const bed = this.sleepData?.bed;
    const wakePosition = bed?.getWakePosition?.();
    if (wakePosition && this.playerModel) {
      this.playerModel.position.copy(wakePosition);
      const yaw = this.sleepData?.previousYaw ?? this.playerModel.rotation.y;
      this.playerModel.rotation.set(0, yaw, 0);
      const actions = this.playerModel.userData?.actions;
      if (actions?.idle) {
        actions.idle.reset().fadeIn(0.2).play();
        this.playerModel.userData.currentAction = 'idle';
      }
      if (this.body) {
        this.body.setTranslation({ x: wakePosition.x, y: wakePosition.y, z: wakePosition.z }, true);
        this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      }
    }

    this.isSleeping = false;
    this.keysPressed.clear();
    this.onSleepEnd?.({ bed });
    this.sleepData = null;
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
    const moveDistance = Math.hypot(dxMeters, dzMeters);
    if (moveDistance > 1e-4) {
      this.geoBoundsLastMoveDirection.set(dxMeters / moveDistance, 0, dzMeters / moveDistance);
    }
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
    const dx = position.x - this.geoBoundsCenterXZ.x;
    const dz = position.z - this.geoBoundsCenterXZ.z;
    return Math.hypot(dx, dz) > this.geoBoundHalfSizeM;
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
      if (this.geoBoundsDebugArrow) {
        this.geoBoundsDebugArrow.visible = false;
      }
      return;
    }
    if (!this.geoBoundsDebug) {
      const geometry = new THREE.BufferGeometry().setFromPoints(
        new THREE.EllipseCurve(0, 0, 1, 1, 0, Math.PI * 2, false, 0)
          .getPoints(64)
          .map((point) => new THREE.Vector3(point.x, point.y, 0))
      );
      const material = new THREE.LineBasicMaterial({ color: 0x1e90ff });
      this.geoBoundsDebug = new THREE.LineLoop(geometry, material);
      this.geoBoundsDebug.name = 'geo-bounds-debug-circle';
      this.geoBoundsDebug.frustumCulled = false;
      this.geoBoundsDebug.rotation.x = Math.PI / 2;
      this.scene.add(this.geoBoundsDebug);
    }
    if (!this.geoBoundsDebugArrow) {
      this.geoBoundsDebugArrow = new THREE.ArrowHelper(
        new THREE.Vector3(0, 0, 1),
        new THREE.Vector3(),
        1.6,
        0x1e90ff,
        0.55,
        0.35
      );
      this.geoBoundsDebugArrow.name = 'geo-bounds-debug-arrow';
      this.geoBoundsDebugArrow.frustumCulled = false;
      this.scene.add(this.geoBoundsDebugArrow);
    }
    const radius = this.geoBoundHalfSizeM;
    const centerY = (position?.y ?? 0) + 0.1;
    this.geoBoundsDebug.scale.set(radius, radius, 1);
    this.geoBoundsDebug.position.set(this.geoBoundsCenterXZ.x, centerY, this.geoBoundsCenterXZ.z);
    this.geoBoundsDebug.visible = true;

    const hasDirection = !!this.geoBoundsLastMoveDirection && this.geoBoundsLastMoveDirection.lengthSq() > 0;
    const dir = hasDirection
      ? this.geoBoundsLastMoveDirection.clone().normalize()
      : new THREE.Vector3(0, 0, 1);
    this.geoBoundsDebugArrow.setDirection(dir);
    this.geoBoundsDebugArrow.setLength(Math.max(1.2, radius * 0.45), 0.55, 0.35);
    this.geoBoundsDebugArrow.position.set(this.geoBoundsCenterXZ.x, centerY + 0.02, this.geoBoundsCenterXZ.z);
    this.geoBoundsDebugArrow.visible = true;
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
    this.tryJump();
  }

  tryJump() {
    if (!this.body) return false;

    const isFlyActive = this.flySpellActive && Date.now() < (this.flySpellEndsAt || 0);
    const jumpForce = isFlyActive ? JUMP_FORCE * FLY_JUMP_FORCE_MULTIPLIER : JUMP_FORCE;

    if (this.isClimbing) {
      this.stopClimbing();
      this.body.applyImpulse({ x: 0, y: jumpForce, z: 0 }, true);
      this.canJump = false;
      this.hasDoubleJumped = false;
      if (isFlyActive) this.onFlyJump?.();
      return true;
    }

    if (this.canJump) {
      this.body.applyImpulse({ x: 0, y: jumpForce, z: 0 }, true);
      this.canJump = false;
      this.hasDoubleJumped = false;
      if (isFlyActive) this.onFlyJump?.();
      return true;
    }

    if (isFlyActive) {
      this.body.applyImpulse({ x: 0, y: jumpForce, z: 0 }, true);
      this.hasDoubleJumped = false;
      this.onFlyJump?.();
      return true;
    }

    if (!this.hasDoubleJumped) {
      this.body.applyImpulse({ x: 0, y: (JUMP_FORCE - 3), z: 0 }, true);
      this.hasDoubleJumped = true;
      this.playAction('hurricaneKick');
      return true;
    }

    return false;
  }

  /**
   * Trigger a projectile fire action programmatically.
   * Useful for alternative input methods like voice commands.
   */
  triggerFire() {
    if (!this.enabled) return;
    this.attemptFireProjectile();
  }

  canFireProjectile(hand = 'right') {
    const gun = this.getEquippedGun(hand);
    return !!gun && this.ammo > 0 && this.playerModel;
  }

  consumeAmmo() {
    if (this.ammo <= 0) return false;
    this.setAmmo(this.ammo - 1);
    return true;
  }

  attemptFireProjectile() {
    return this.attemptFireProjectileForHand('right');
  }

  attemptFireProjectileForHand(hand = 'right') {
    const equippedWeapon = this.getEquippedWeapon(hand);
    if (equippedWeapon?.itemId === 'bomb' && typeof this.throwBomb === 'function') {
      const direction = this.getAimDirection(true);
      const position = this.getProjectileSpawnPosition(direction);
      const fired = this.throwBomb(position, direction);
      if (fired) {
        this.playAction('projectile');
      }
      return fired;
    }
    if (!this.canFireProjectile(hand)) return false;

    const gun = this.getEquippedGun(hand);
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
      this.audioManager?.playSFX('SFX/Spells/Waterspray 1.ogg', 0.55, {
        cooldownKey: 'ice-mist-fire',
        cooldownMs: this.audioManager?.performanceProfile?.attackCooldownMs ?? 120
      });
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
      this.audioManager?.playSFX('SFX/Attacks/Bow Attacks Hits and Blocks/Bow Attack 2.ogg', 0.6, {
        cooldownKey: 'bow-fire',
        cooldownMs: this.audioManager?.performanceProfile?.attackCooldownMs ?? 120
      });
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

  shouldHoldToFire(hand = 'right') {
    const weapon = this.getEquippedWeapon(hand);
    return weapon?.itemId === 'bow' || weapon?.itemId === 'bomb';
  }

  isProjectileWeapon(weapon) {
    return !!weapon && (weapon.type === 'gun' || weapon.type === 'bow' || weapon.type === 'bomb');
  }

  setFirstPersonEnabled(enabled) {
    this.firstPersonEnabled = Boolean(enabled);
    if (this.firstPersonEnabled) {
      this.setAiming(false);
    }
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
    if (!this.isFireHeld || !this.shouldHoldToFire() || this.isWeaponShoulderCameraActive()) return;
    const weapon = this.getEquippedWeapon();
    const invertForBow = weapon?.itemId === 'bow';
    const direction = this.getAimDirection(invertForBow);
    this.alignPlayerToDirection(direction);
  }

  isWeaponShoulderCameraActive() {
    return !this.isEngaged && !this.isAiming;
  }


  alignPlayerToDirection(direction) {
    if (!this.playerModel) return;
    const yaw = Math.atan2(direction.x, direction.z);
    this.playerModel.rotation.set(0, yaw, 0);
  }

  getProjectileSpawnPosition(direction) {
    const offsetDistance = 0.6;
    const normalizedDirection = direction.clone().normalize();
    const gun = this.getEquippedGun();

    const activeGunMesh = gun?.useHeldMeshWhenHeld && gun?.heldMesh
      ? gun.heldMesh
      : gun?.mesh;

    if (activeGunMesh) {
      const gunPosition = new THREE.Vector3();
      activeGunMesh.getWorldPosition(gunPosition);
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
      if (this.pointerLocked && !this.isEngaged) {
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

  updateEngagedMode() {
    if (!this.playerModel) {
      this.setEngaged(false);
      return;
    }
    const monsters = window.monsters || [];
    let closest = null;
    let closestDistance = Infinity;
    for (const monster of monsters) {
      if (!monster?.model || monster.isDead) continue;
      const distance = this.playerModel.position.distanceTo(monster.model.position);
      if (distance < closestDistance) {
        closest = monster;
        closestDistance = distance;
      }
    }
    const shouldEngage = closest && closestDistance <= ENGAGED_MODE_DISTANCE;
    if (shouldEngage) {
      if (!this.isEngaged) {
        this.freeYaw = this.yaw;
        this.freePitch = this.pitch;
        this.cameraTouchId = null;
      }
      this.isEngaged = true;
      this.engagedTarget = closest;
      this.engagedDirection = closest.model.position.clone().sub(this.playerModel.position);
      this.engagedDirection.y = 0;
      if (this.engagedDirection.lengthSq() > 0) {
        this.engagedDirection.normalize();
      }
    } else {
      this.setEngaged(false);
    }
  }

  setEngaged(active) {
    if (active) return;
    if (this.isEngaged) {
      if (Number.isFinite(this.freeYaw)) {
        this.yaw = this.freeYaw;
      }
      if (Number.isFinite(this.freePitch)) {
        this.pitch = this.freePitch;
      }
    }
    this.isEngaged = false;
    this.engagedTarget = null;
    this.engagedDirection = null;
    this.freeYaw = null;
    this.freePitch = null;
  }

}

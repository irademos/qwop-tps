import { appContext } from '../core/appContext.js';
import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { getTerrainHeight } from '../environment/terrainHeight.js';
import { getSpawnPosition } from '../map/spawnUtils.js';
import { CHARACTER_MOVEMENT } from "../characters/CharacterBase.js";
import { getKnockbackImpulse, getKnockbackMotion } from "../combat/knockback.js";
import { updateProceduralPlayerRig } from '../models/playerModel.js';
import { loadNippleJs } from '../core/externalDeps.js';

const PLAYER_RADIUS = 0.3;
const PLAYER_HALF_HEIGHT = 0.6;
const FIRST_PERSON_EYE_HEIGHT = 0.7;
const MAX_WALKABLE_SLOPE_DEGREES = 42;
const WEAPON_CAMERA_FOV_DELTA = 8;
const CAMERA_FOV_LERP_SPEED = 6;
const GYRO_LERP_SPEED = 12; // rad/s convergence for gyroscope smoothing
const MOBILE_PORTRAIT_CAMERA_FOV_BONUS = 20;
const GANG_BEASTS_ATTACK_DURATION_MS = 420;
const GANG_BEASTS_PARALYSIS_MS = 1000;

export class PlayerControls {
  constructor({
    scene,
    camera,
    playerModel,
    renderer,
    multiplayer,
    spawnProjectile,
    projectiles,
    audioManager,
    onAmmoChange
  }) {
    this.yaw = 0;
    this.pitch = 0;
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
    this.knockbackEndTime = 0;
    this.knockbackVelocity = new THREE.Vector3();
    this.isInvincible = false;
    this.invincibleUntil = 0;

    // Player state
    this.canJump = true;
    this.keysPressed = new Set();
    this.isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    this.currentSpecialAction = null;

    // Mobile control variables
    this.joystick = null;
    this.joystickAngle = 0;
    this.joystickForce = 0;
    this.touchStartX = 0;
    this.touchStartY = 0;
    this.touchSensitivity = 0.006;
    this.deltaSeconds = 0;

    // Gyroscope state
    this.gyroActive = false;
    this.gyroLastAlpha = null;
    this.gyroLastBeta = null;
    this.gyroLastGamma = null;
    this.gyroCalibQ = null;
    this.gyroCalibYaw = 0;
    this.gyroCalibPitch = 0;
    this._gyroDeviceQ = new THREE.Quaternion();
    this._gyroRelQ = new THREE.Quaternion();
    this._gyroTempQ = new THREE.Quaternion();
    this._gyroQ1 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5));
    this._gyroQ0 = new THREE.Quaternion();
    this._gyroZee = new THREE.Vector3(0, 0, 1);
    this._gyroEuler = new THREE.Euler();
    this._gyroForwardRef = new THREE.Vector3();
    this._gyroForwardCur = new THREE.Vector3();
    this._gyroOrientHandler = null;

    // Initial player position
    const spawn = getSpawnPosition();
    const spawnX = Number.isFinite(spawn?.x) ? spawn.x : 0;
    const spawnY = Number.isFinite(spawn?.y) ? spawn.y : 0.9;
    const spawnZ = Number.isFinite(spawn?.z) ? spawn.z : 0;
    this.playerX = spawnX;
    this.playerY = spawnY;
    this.playerZ = spawnZ;

    // Set initial player model position if it exists
    if (this.playerModel) {
      this.playerModel.position.set(this.playerX, this.playerY, this.playerZ);
      this.lastPosition.set(this.playerX, this.playerY, this.playerZ);
      this.playerModel.userData.isKnocked = false;
      this.playerModel.rotation.x = 0;
    }

    // No physics collider — simple direct position movement

    // Set camera to third-person perspective
    this.camera.position.set(this.playerX, this.playerY + 2, this.playerZ + 5);
    this.camera.lookAt(this.playerX, this.playerY + 1, this.playerZ);

    this.firstPersonView = false;
    this.tpConfig = { distance: 1.0, height: 0.0, lookTargetHeight: 1.5, capsuleOpacity: 0.6 };
    this.defaultFovDesktop = this.camera.fov;
    this.applyMobilePortraitCameraTuning();

    // Initialize controls based on device
    this.initializeControls();

    // Setup event listeners
    this.setupEventListeners();

    this.enabled = true; // Add enabled flag for chat input

    this.onAmmoChange = typeof onAmmoChange === 'function' ? onAmmoChange : null;
    this.ammo = 0;
    this.ammoContainerEl = document.getElementById('ammo-display');
    this.ammoCountEl = document.getElementById('ammo-count');
    this.ammoIconEl = document.getElementById('ammo-icon');
    this.ammoLabel = 'Bullets';
    this.ammoIcon = '🔫';
    this.lastAmmoValue = null;
    this.lastAmmoEmpty = null;
    this.lastHasGun = null;
    if (this.ammoIconEl) {
      this.ammoIconEl.textContent = this.ammoIcon;
    }
    this.updateAmmoUI(!!this.getEquippedGun());
  }

  // Portrait phones get a wider field of view
  applyMobilePortraitCameraTuning() {
    const isPortraitMobile = this.isMobile && window.innerHeight > window.innerWidth;
    this.defaultFov = this.defaultFovDesktop + (isPortraitMobile ? MOBILE_PORTRAIT_CAMERA_FOV_BONUS : 0);
  }

  initializeControls() {
    this.initializeActionButtons();
    if (this.isMobile) {
      this.initializeMobileControls().catch((error) => {
        console.warn('Mobile controls failed to initialize.', error);
      });
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
    // The jump itself runs in the game loop (see phoneSwordJumpPressed in bootstrapGameApp.js)
    document.getElementById('jump-button').addEventListener('touchstart', (event) => {
      if (!this.enabled) return;
      window.phoneSwordJumpPressed = true;
      this.safePreventDefault(event);
    });

    document.getElementById('jump-button').addEventListener('touchend', (event) => {
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
      if (!this.enabled) return;
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
      if (!this.enabled || this.cameraTouchId === null) return;
      for (const touch of event.changedTouches) {
        if (touch.identifier === this.cameraTouchId) {
          const deltaX = touch.clientX - this.touchStartX;
          const deltaY = touch.clientY - this.touchStartY;
          this.touchStartX = touch.clientX;
          this.touchStartY = touch.clientY;

          const maxPitch = Math.PI / 3;
          const minPitch = -Math.PI / 8;
          if (this.gyroActive) {
            // Shift the gyro calibration reference so touch drag offsets the gyro aim
            this.gyroCalibYaw = (this.gyroCalibYaw + deltaX * this.touchSensitivity) % (2 * Math.PI);
            this.gyroCalibPitch = Math.max(minPitch, Math.min(maxPitch, this.gyroCalibPitch - deltaY * this.touchSensitivity));
          } else {
            this.yaw -= deltaX * this.touchSensitivity;
            this.pitch -= deltaY * this.touchSensitivity;
            this.pitch = Math.max(minPitch, Math.min(maxPitch, this.pitch));
          }
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

    // Remove any existing gyro button (no longer supported)
    const _existingGyroBtn = document.getElementById('gyro-button');
    if (_existingGyroBtn) _existingGyroBtn.remove();
  }

  // Compute device-orientation quaternion using the Three.js DeviceOrientationControls approach
  _computeDeviceOrientationQ(alpha, beta, gamma) {
    const DEG2RAD = Math.PI / 180;
    this._gyroEuler.set(beta * DEG2RAD, alpha * DEG2RAD, -gamma * DEG2RAD, 'YXZ');
    this._gyroDeviceQ.setFromEuler(this._gyroEuler);
    this._gyroDeviceQ.multiply(this._gyroQ1);
    const screenAngle = ((window.screen.orientation?.angle) ?? 0) * DEG2RAD;
    this._gyroQ0.setFromAxisAngle(this._gyroZee, -screenAngle);
    this._gyroDeviceQ.multiply(this._gyroQ0);
  }

  // Store current phone orientation as the neutral "looking forward" pose
  calibrateGyroscope() {
    if (this.gyroLastAlpha === null) return;
    this._computeDeviceOrientationQ(this.gyroLastAlpha, this.gyroLastBeta, this.gyroLastGamma);
    this.gyroCalibQ = this._gyroDeviceQ.clone();
    this.gyroCalibYaw = this.yaw;
    this.gyroCalibPitch = this.pitch;
  }

  async initGyroscope() {
    if (typeof DeviceOrientationEvent === 'undefined') {
      console.warn('[Gyro] DeviceOrientationEvent not supported on this device.');
      return false;
    }
    // iOS 13+ requires explicit permission request from a user gesture
    if (typeof DeviceOrientationEvent.requestPermission === 'function') {
      try {
        const permission = await DeviceOrientationEvent.requestPermission();
        if (permission !== 'granted') return false;
      } catch (e) {
        console.warn('[Gyro] Permission denied:', e);
        return false;
      }
    }

    // Remove any previous listener
    if (this._gyroOrientHandler) {
      window.removeEventListener('deviceorientation', this._gyroOrientHandler, true);
    }

    this._gyroOrientHandler = (event) => {
      if (event.alpha === null) return;
      this.gyroLastAlpha = event.alpha;
      this.gyroLastBeta = event.beta;
      this.gyroLastGamma = event.gamma;
    };
    window.addEventListener('deviceorientation', this._gyroOrientHandler, true);

    // Wait for first sensor reading, then calibrate
    await new Promise((resolve) => {
      const once = (event) => {
        if (event.alpha === null) return;
        window.removeEventListener('deviceorientation', once, true);
        resolve();
      };
      window.addEventListener('deviceorientation', once, true);
    });

    this.calibrateGyroscope();
    this.gyroActive = true;
    return true;
  }

  disableGyroscope() {
    this.gyroActive = false;
    if (this._gyroOrientHandler) {
      window.removeEventListener('deviceorientation', this._gyroOrientHandler, true);
      this._gyroOrientHandler = null;
    }
  }

  // Called each frame to slerp camera yaw/pitch toward the gyroscope target
  _applyGyroUpdate(delta) {
    if (!this.gyroActive || !this.gyroCalibQ || this.gyroLastAlpha === null) return;

    this._computeDeviceOrientationQ(this.gyroLastAlpha, this.gyroLastBeta, this.gyroLastGamma);

    // Relative rotation from calibration pose to current pose
    this._gyroTempQ.copy(this.gyroCalibQ).invert();
    this._gyroRelQ.copy(this._gyroTempQ).multiply(this._gyroDeviceQ);

    // Apply relative rotation to the reference forward direction (at calibration time)
    this._gyroForwardRef.set(
      Math.sin(this.gyroCalibYaw) * Math.cos(this.gyroCalibPitch),
      Math.sin(this.gyroCalibPitch),
      Math.cos(this.gyroCalibYaw) * Math.cos(this.gyroCalibPitch)
    );
    this._gyroForwardCur.copy(this._gyroForwardRef).applyQuaternion(this._gyroRelQ);

    const targetYaw = Math.atan2(this._gyroForwardCur.x, this._gyroForwardCur.z);
    const targetPitch = Math.asin(Math.max(-1, Math.min(1, this._gyroForwardCur.y)));

    const maxPitch = Math.PI / 3;
    const minPitch = -Math.PI / 8;
    const clampedPitch = Math.max(minPitch, Math.min(maxPitch, targetPitch));

    const lerpFactor = 1 - Math.exp(-GYRO_LERP_SPEED * delta);
    // Shortest-path yaw lerp (handles 0/360 wraparound)
    const yawDelta = ((targetYaw - this.yaw + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;
    this.yaw += yawDelta * lerpFactor;
    this.pitch += (clampedPitch - this.pitch) * lerpFactor;
  }

  initializeActionButtons() {
    const actionContainer = document.getElementById('action-buttons');
    if (!actionContainer) return;

    actionContainer.innerHTML = '';
    this.lastTouchButtonTime = 0;

    const createButton = (id, className, label) => {
      const button = document.createElement('button');
      button.id = id;
      button.className = `action-button ${className}`;
      button.textContent = label;
      actionContainer.appendChild(button);
      return button;
    };
    const getAppState = () => appContext.uiState.appState ?? window.appState;
    // Touch fires first on mobile; ignore the emulated mouse event that follows it
    const bindPress = (button, onPress) => {
      button.addEventListener('touchstart', (event) => {
        this.lastTouchButtonTime = performance.now();
        onPress(event);
      }, { passive: false });
      button.addEventListener('mousedown', (event) => {
        if ((performance.now() - this.lastTouchButtonTime) <= 550) return;
        onPress(event);
      });
    };

    // Block (sword) / Fire (gun) button
    this.punchButton = createButton('punch-button', 'mobile-primary-action ps-block-btn', 'Attack');

    // Weapon switch buttons (two slots showing the non-equipped weapons)
    this.psWeaponBtn1 = createButton('ps-weapon-btn-1', 'mobile-primary-action ps-weapon-btn', '');
    this.psWeaponBtn2 = createButton('ps-weapon-btn-2', 'mobile-primary-action ps-weapon-btn', '');
    const makePsWeaponHandler = (btnRef) => (event) => {
      if (!this.enabled) return;
      const itemId = btnRef.dataset.psWeaponId;
      if (!itemId) return;
      getAppState()?.equipInventoryItem?.(itemId);
      this.refreshActionButtons();
      if (event) this.safePreventDefault(event);
    };
    bindPress(this.psWeaponBtn1, makePsWeaponHandler(this.psWeaponBtn1));
    bindPress(this.psWeaponBtn2, makePsWeaponHandler(this.psWeaponBtn2));

    // Protective bubble (bought in the shop); label/count kept fresh by the game loop
    this.psBubbleBtn = createButton('ps-bubble-btn', 'mobile-primary-action ps-bubble-btn', `🫧 ${getAppState()?.getBubbleCount?.() ?? 0}`);
    this.psBubbleBtn.setAttribute('aria-label', 'Activate protective bubble');
    bindPress(this.psBubbleBtn, (event) => {
      if (!this.enabled) return;
      getAppState()?.activateBubble?.();
      if (event) this.safePreventDefault(event);
    });

    // Bombs (bought in the shop): throws one forward; label/count kept fresh by the game loop
    this.psBombBtn = createButton('ps-bomb-btn', 'mobile-primary-action ps-bomb-btn', `💣 ${getAppState()?.getBombCount?.() ?? 0}`);
    this.psBombBtn.setAttribute('aria-label', 'Throw a bomb');
    bindPress(this.psBombBtn, (event) => {
      if (!this.enabled) return;
      getAppState()?.throwBomb?.();
      if (event) this.safePreventDefault(event);
    });

    // The block/fire button blocks while held (sword) or fires on release (gun)
    const setBlocking = (val) => {
      if (!window.phoneSwordGyro) return;
      window.phoneSwordGyro.blocking = val;
      this.punchButton.classList.toggle('ps-blocking-active', val);
    };
    const releaseBlockOrFire = () => {
      setBlocking(false);
      if (this.enabled && this.getEquippedWeapon('right')?.itemId === 'pistol') {
        this.attemptFireProjectile();
      }
    };
    this.punchButton.addEventListener('touchstart', (e) => {
      this.safePreventDefault(e);
      setBlocking(true);
    }, { passive: false });
    this.punchButton.addEventListener('touchend', (e) => {
      this.safePreventDefault(e);
      releaseBlockOrFire();
    }, { passive: false });
    this.punchButton.addEventListener('touchcancel', () => setBlocking(false), { passive: false });
    this.punchButton.addEventListener('mousedown', () => setBlocking(true));
    this.punchButton.addEventListener('mouseup', releaseBlockOrFire);
    this.punchButton.addEventListener('mouseleave', () => setBlocking(false));

    this.refreshActionButtons();
  }

  getMobileAttackLabel() {
    const itemId = this.getEquippedWeapon('right')?.itemId ?? 'foamSword';
    if (itemId === 'pistol') return 'Fire';
    if (itemId === 'foamSword') return '🛡 Block';
    return 'Attack';
  }

  refreshActionButtons() {
    if (!this.punchButton) return;
    const appState = appContext.uiState.appState ?? window.appState;
    const inventory = appState?.getInventory?.() || {};
    const hasGun = (inventory.pistol?.count ?? 0) > 0;
    const hasShield = (inventory.shield?.count ?? 0) > 0;
    const weapons = [
      { id: 'foamSword', label: 'Sword' },
      ...(hasGun ? [{ id: 'pistol', label: 'Gun' }] : []),
      ...(hasShield ? [{ id: 'shield', label: 'Shield' }] : []),
    ];
    // Default to foamSword when nothing detected
    const equippedId = this.getEquippedWeapon('right')?.itemId ?? 'foamSword';
    const others = weapons.filter(w => w.id !== equippedId);
    [this.psWeaponBtn1, this.psWeaponBtn2].forEach((button, index) => {
      const w = others[index];
      button.dataset.psWeaponId = w ? w.id : '';
      button.textContent = w ? w.label : '';
      button.style.display = w ? '' : 'none';
    });
    // Block button only shown for sword; gun shows Fire; shield hides it
    const showPunch = equippedId === 'foamSword' || equippedId === 'pistol';
    this.punchButton.textContent = this.getMobileAttackLabel();
    this.punchButton.style.display = showPunch ? '' : 'none';
    this.layoutMobileActionButtons();
  }

  applyMobileButtonPosition(button, slot) {
    if (!button || !slot) return;
    button.style.setProperty('--mobile-grid-x', String(slot.x));
    button.style.setProperty('--mobile-grid-y', String(slot.y));
  }

  // Block/fire button + two weapon switch buttons, bubble and bomb
  layoutMobileActionButtons() {
    [this.punchButton, this.psWeaponBtn1, this.psWeaponBtn2, this.psBubbleBtn, this.psBombBtn].forEach((button) => {
      button?.style?.removeProperty('--mobile-grid-x');
      button?.style?.removeProperty('--mobile-grid-y');
    });
    if (this.punchButton.style.display !== 'none') {
      this.applyMobileButtonPosition(this.punchButton, { x: 1, y: 0 });
    }
    if (this.psWeaponBtn1.dataset.psWeaponId) {
      this.applyMobileButtonPosition(this.psWeaponBtn1, { x: 2, y: 0 });
    }
    if (this.psWeaponBtn2.dataset.psWeaponId) {
      this.applyMobileButtonPosition(this.psWeaponBtn2, { x: 2, y: 1 });
    }
    // Bubble sits in the free slot above Block/Fire, clear of the weapon buttons
    this.applyMobileButtonPosition(this.psBubbleBtn, { x: 1, y: 1 });
    // Bomb sits above the bubble (the jump/gyro column and weapon buttons stay clear)
    this.applyMobileButtonPosition(this.psBombBtn, { x: 1, y: 2 });
  }

  setupEventListeners() {
    // Listen for key events (for desktop controls)
    document.addEventListener("keydown", (e) => {
      if (!this.enabled) return;
      const key = e.key.toLowerCase();
      this.keysPressed.add(key);
      if (key === 'w' || key === 'a' || key === 's' || key === 'd' || key === ' ') {
        this.safePreventDefault(e);
      }
      if (e.key === " ") {
        if (e.repeat) return;
        // The jump itself runs in the game loop (see phoneSwordJumpPressed in bootstrapGameApp.js)
        window.phoneSwordJumpPressed = true;
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

    this.domElement.addEventListener("click", () => {
      // Don't fire if chat or settings are open
      if (!this.enabled || this.isMobile) return;
      this.attemptFireProjectile();
    });
  }

  getAnimationAction(actionName) {
    if (!actionName || !this.playerModel?.userData?.actions) return null;
    const action = this.playerModel.userData.actions[actionName];
    return action && typeof action.reset === 'function' ? action : null;
  }

  setMovementAction(actionName, fadeDuration = 0.2) {
    if (!this.playerModel?.userData || !actionName) return false;
    const action = this.getAnimationAction(actionName);
    if (!action) return false;

    const current = this.playerModel.userData.currentAction;
    if (current === actionName) return true;

    const currentAction = this.getAnimationAction(current);
    currentAction?.fadeOut(fadeDuration);
    action.reset().fadeIn(fadeDuration).play();
    this.playerModel.userData.currentAction = actionName;
    return true;
  }

  // Plays a one-shot action (e.g. 'projectile' when firing the gun)
  playAction(actionName) {
    if (!this.playerModel) return false;
    const action = this.getAnimationAction(actionName);
    const usingProceduralRig = !!this.playerModel.userData.qwopRig;
    if (!action && !usingProceduralRig) return false;

    const current = this.playerModel.userData.currentAction;
    this.getAnimationAction(current)?.fadeOut(0.1);
    action?.reset?.().fadeIn(0.1).play();
    this.playerModel.userData.currentAction = actionName;
    this.currentSpecialAction = actionName;

    const mixer = this.playerModel.userData.mixer;
    if (mixer && action) {
      const onFinished = (e) => {
        if (e.action === action) {
          mixer.removeEventListener("finished", onFinished);
          this.currentSpecialAction = null;
        }
      };
      mixer.addEventListener("finished", onFinished);
    } else {
      setTimeout(() => {
        if (this.currentSpecialAction === actionName) {
          this.currentSpecialAction = null;
        }
        if (this.playerModel?.userData?.currentAction === actionName) {
          this.playerModel.userData.currentAction = 'idle';
        }
      }, GANG_BEASTS_ATTACK_DURATION_MS);
    }
    return true;
  }

  applyKnockback({ direction, strength } = {}) {
    if (!direction || !this.playerModel) return;
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
    const recoveryMs = this.playerModel.userData.qwopRig ? GANG_BEASTS_PARALYSIS_MS : profile.recoveryMs;
    this.knockbackEndTime = Math.max(this.knockbackEndTime || 0, now + recoveryMs);
    this.knockbackRestYaw = this.playerModel.rotation.y;
    this.playerModel.userData.attack = null;
    if (this.playerModel.userData.qwopRig) {
      this.playerModel.userData.qwopRig.knockedUntil = this.knockbackEndTime;
      this.playerModel.userData.qwopRig.knockDirection = direction.clone?.() || null;
    }
    const actions = this.playerModel.userData.actions;
    const current = this.playerModel.userData.currentAction;
    const hitAction = actions?.hit;
    this.currentSpecialAction = null;
    if (hitAction) {
      actions[current]?.fadeOut(0.1);
      hitAction.reset().fadeIn(0.1).play();
    }
    this.playerModel.userData.currentAction = 'hit';
  }

  resolveGroundY(x, y, z, options = {}) {
    const {
      includeSolidHit = true,
      maxRayDistance = 12,
      walkableSlopeDegrees = MAX_WALKABLE_SLOPE_DEGREES,
      fallbackGroundY = Number.isFinite(y) ? y - (PLAYER_HALF_HEIGHT + PLAYER_RADIUS) : 0,
      excludedColliderHandles = null
    } = options;

    const metadata = {
      surfaceType: 'terrain',
      slopeDegrees: 0,
      walkable: true
    };

    let terrainHeight = Number.isFinite(this.groundOverrideY) ? this.groundOverrideY : NaN;
    if (!Number.isFinite(terrainHeight)) {
      terrainHeight = getTerrainHeight(x, z);
    }
    if (!Number.isFinite(terrainHeight)) {
      terrainHeight = fallbackGroundY;
      metadata.surfaceType = 'fallback';
    }

    let groundY = terrainHeight;
    const world = window.rapierWorld;
    if (includeSolidHit && world && !Number.isFinite(this.groundOverrideY)) {
      const ray = new RAPIER.Ray({ x, y, z }, { x: 0, y: -1, z: 0 });
      const blockedColliderHandles = new Set();
      if (this.body && typeof this.body.numColliders === 'function' && typeof this.body.collider === 'function') {
        const colliderCount = this.body.numColliders();
        for (let i = 0; i < colliderCount; i += 1) {
          const collider = this.body.collider(i);
          if (typeof collider?.handle === 'number') {
            blockedColliderHandles.add(collider.handle);
          }
        }
      }
      if (excludedColliderHandles) {
        const handles = Array.isArray(excludedColliderHandles)
          ? excludedColliderHandles
          : Array.from(excludedColliderHandles);
        handles.forEach((handle) => {
          if (typeof handle === 'number') {
            blockedColliderHandles.add(handle);
          }
        });
      }
      const excludeSelfCollider = blockedColliderHandles.size
        ? (collider) => !blockedColliderHandles.has(collider?.handle)
        : undefined;
      const rayHit = world.castRayAndGetNormal
        ? world.castRayAndGetNormal(
          ray,
          maxRayDistance,
          true,
          undefined,
          undefined,
          undefined,
          undefined,
          excludeSelfCollider
        )
        : null;
      const simpleHit = rayHit
        ? null
        : world.castRay(
          ray,
          maxRayDistance,
          true,
          undefined,
          undefined,
          undefined,
          undefined,
          excludeSelfCollider
        );
      const hitDistance = rayHit?.toi ?? rayHit?.timeOfImpact ?? simpleHit?.toi ?? simpleHit?.timeOfImpact;
      if (Number.isFinite(hitDistance)) {
        const hitY = y - hitDistance;
        if (hitY > groundY) {
          groundY = hitY;
          metadata.surfaceType = 'solid';
        }
      }

      const normal = rayHit?.normal;
      if (normal && Number.isFinite(normal.y)) {
        const upDot = Math.min(Math.max(normal.y, -1), 1);
        metadata.slopeDegrees = THREE.MathUtils.radToDeg(Math.acos(upDot));
      }
    }

    if (!Number.isFinite(groundY)) {
      groundY = fallbackGroundY;
      metadata.surfaceType = 'fallback';
    }

    metadata.walkable = metadata.slopeDegrees <= walkableSlopeDegrees;

    return {
      groundY,
      terrainHeight,
      metadata
    };
  }

  processMovement() {
    if (!this.enabled) return;

    // Simple direct position movement — no physics, no gravity, no collider
    {
      // Build move direction from WASD or joystick (on-screen, or the phone-sword page's
      // remote joystick, which also drives desktop)
      const moveDirection = new THREE.Vector3(0, 0, 0);
      const useJoystick = this.isMobile || this.joystickForce > 0.1;
      if (useJoystick) {
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

      const cameraDirection = new THREE.Vector3();
      this.camera.getWorldDirection(cameraDirection);
      cameraDirection.y = 0;
      cameraDirection.normalize();
      const rightVector = new THREE.Vector3().crossVectors(this.camera.up, cameraDirection).normalize();

      const movement = new THREE.Vector3();
      if (!useJoystick) {
        if (moveDirection.z !== 0) movement.add(cameraDirection.clone().multiplyScalar(moveDirection.z));
        if (moveDirection.x !== 0) movement.add(rightVector.clone().multiplyScalar(moveDirection.x));
        if (movement.length() > 0) movement.normalize();
      } else {
        movement.copy(moveDirection);
      }

      const deltaSeconds = Number.isFinite(this.deltaSeconds) && this.deltaSeconds > 0
        ? this.deltaSeconds
        : 0.016;
      const speed = CHARACTER_MOVEMENT.walkSpeed * 1.05;

      this.playerX += movement.x * speed * deltaSeconds;
      this.playerZ += movement.z * speed * deltaSeconds;

      if (!window.phoneSwordAirborne) {
        const { groundY } = this.resolveGroundY(
          this.playerX,
          this.playerY + PLAYER_HALF_HEIGHT,
          this.playerZ,
          { includeSolidHit: false }
        );
        this.playerY = groundY;
      }

      const newX = this.playerX;
      const newY = this.playerY;
      const newZ = this.playerZ;
      const isMovingNow = movement.length() > 0;
      this.isMoving = isMovingNow;

      if (this.playerModel) {
        this.playerModel.position.set(newX, newY, newZ);
        this.playerModel.rotation.set(0, this.yaw, 0);
        this.playerModel.up.set(0, 1, 0);
        this.camera.up.set(0, 1, 0);

        const newTarget = new THREE.Vector3(newX, newY + 1, newZ);
        if (this.controls) {
          this.controls.target.copy(newTarget);
        }
        if (this.multiplayer && (Math.abs(this.lastPosition.x - newX) > 0.01 || Math.abs(this.lastPosition.z - newZ) > 0.01 || this.isMoving !== this.wasMoving)) {
          this.lastPosition.set(newX, newY, newZ);
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

    updateProceduralPlayerRig(this.playerModel, this.keysPressed, delta, { isMoving: !!this.isMoving });

    // Arrow keys turn the camera (or shift the gyro reference while the camera gyro is active)
    const rotateSpeed = CHARACTER_MOVEMENT.turnRate * 3.5;
    if (this.keys.has('ArrowLeft')) {
      if (this.gyroActive) {
        this.gyroCalibYaw = (this.gyroCalibYaw + rotateSpeed) % (2 * Math.PI);
      } else {
        this.yaw += rotateSpeed;
      }
    }
    if (this.keys.has('ArrowRight')) {
      if (this.gyroActive) {
        this.gyroCalibYaw = (this.gyroCalibYaw - rotateSpeed + 2 * Math.PI) % (2 * Math.PI);
      } else {
        this.yaw -= rotateSpeed;
      }
    }

    const maxPitch = Math.PI / 3;   // ~60° upward
    const minPitch = -Math.PI / 8;  // ~30° downward
    if (this.keys.has('ArrowUp')) {
      if (this.gyroActive) {
        this.gyroCalibPitch = Math.min(maxPitch, this.gyroCalibPitch + 0.02);
      } else {
        this.pitch = Math.min(maxPitch, this.pitch + 0.02);
      }
    }
    if (this.keys.has('ArrowDown')) {
      if (this.gyroActive) {
        this.gyroCalibPitch = Math.max(minPitch, this.gyroCalibPitch - 0.02);
      } else {
        this.pitch = Math.max(minPitch, this.pitch - 0.02);
      }
    }

    // Gyroscope: smoothly slerp yaw/pitch toward device orientation target
    this._applyGyroUpdate(delta);

    const fovLerpFactor = 1 - Math.exp(-CAMERA_FOV_LERP_SPEED * this.deltaSeconds);
    const targetFov = Math.max(45, this.defaultFov - WEAPON_CAMERA_FOV_DELTA);
    this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, targetFov, fovLerpFactor);
    this.camera.updateProjectionMatrix();

    const lookDirection = new THREE.Vector3(
      Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      Math.cos(this.yaw) * Math.cos(this.pitch)
    );
    if (this.firstPersonView) {
      // First-person view: place camera at player's eye and look in yaw/pitch direction
      const eyePosition = this.playerModel.position.clone().add(new THREE.Vector3(0, FIRST_PERSON_EYE_HEIGHT, 0));
      this.camera.position.copy(eyePosition);
      this.camera.lookAt(eyePosition.clone().add(lookDirection));
      if (this.playerModel) {
        // Hide the body but keep floating hands/arms (direct playerGroup children) visible
        const bodyRoot = this.playerModel.userData?.qwopRig?.bodyRoot;
        if (bodyRoot) bodyRoot.visible = false;
        else this.playerModel.visible = false;
      }
    } else {
      // Third-person view: orbit camera around player using yaw + pitch
      const { distance, height, lookTargetHeight, capsuleOpacity } = this.tpConfig;
      const tpCenter = this.playerModel.position.clone().add(new THREE.Vector3(0, lookTargetHeight, 0));
      const pitchClamped = Math.max(-Math.PI / 3, Math.min(Math.PI / 3, this.pitch));
      const horizontalDist = distance * Math.cos(pitchClamped);
      const verticalOffset = height + distance * Math.sin(pitchClamped);
      this.camera.position.set(
        tpCenter.x - Math.sin(this.yaw) * horizontalDist,
        tpCenter.y + verticalOffset,
        tpCenter.z - Math.cos(this.yaw) * horizontalDist
      );
      this.camera.lookAt(tpCenter);
      if (this.playerModel) {
        const bodyRoot = this.playerModel.userData?.qwopRig?.bodyRoot;
        if (bodyRoot) bodyRoot.visible = true;
        else this.playerModel.visible = true;
      }
      // apply capsule opacity
      const capsuleMesh = this.playerModel.getObjectByName('bodyCapsulemesh');
      if (capsuleMesh) {
        const mat = capsuleMesh.material;
        const wantsTransparent = capsuleOpacity < 1.0;
        if (mat.transparent !== wantsTransparent) {
          mat.transparent = wantsTransparent;
          mat.needsUpdate = true;
        }
        mat.opacity = capsuleOpacity;
      }
    }

    if (this.playerModel && this.playerModel.userData.mixer) {
      this.playerModel.userData.mixer.update(delta);
    }

    if (this.enabled) {
      this.processMovement();
    }

    const hasGun = !!this.getEquippedGun();
    if (hasGun !== this.lastHasGun) {
      this.updateAmmoUI(hasGun);
    }
  }

  getWeapons() {
    const weapons = Object.values(appContext.entities.weapons || window.weapons || {}).filter(Boolean);
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
        && weapon.type === 'gun'
    ) || null;
  }

  /**
   * Trigger a jump action programmatically.
   * Useful for alternative input methods like voice commands.
   */

  /**
   * Trigger a projectile fire action programmatically.
   * Useful for alternative input methods like voice commands.
   */

  /**
   * Process fist state for one MediaPipe tracking slot.
   * trackingSlot 'left' corresponds to the in-game RIGHT hand (and vice versa)
   * because the back-camera swaps the slots.
   */

  canFireProjectile(hand = 'right') {
    const gun = this.getEquippedGun(hand);
    if (!gun || !this.playerModel) return false;
    if (gun.infiniteAmmo) return true;
    return this.ammo > 0;
  }

  consumeAmmo() {
    const gun = this.getEquippedGun();
    if (gun?.infiniteAmmo) return true;
    if (this.ammo <= 0) return false;
    this.setAmmo(this.ammo - 1);
    return true;
  }

  attemptFireProjectile() {
    return this.attemptFireProjectileForHand('right');
  }

  attemptFireProjectileForHand(hand = 'right') {
    if (!this.canFireProjectile(hand)) return false;
    const direction = this.getAimDirection();
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
      this.multiplayer.getId(),
      {
        geometry: new THREE.SphereGeometry(0.08, 8, 8),
        colliderDesc: RAPIER.ColliderDesc.ball(0.08).setRestitution(0.3).setFriction(0.5),
        color: new THREE.Color(0xffee44),
        speed: 28,
        lifetime: 2500
      }
    );
    return true;
  }

  getAimDirection() {
    const sourceQuaternion = this.camera?.quaternion ?? this.playerModel.quaternion;
    // Camera looks down its -Z axis, so (0,0,-1) is the actual forward direction.
    return new THREE.Vector3(0, 0, -1).applyQuaternion(sourceQuaternion).normalize();
  }

  getProjectileSpawnPosition(direction) {
    const gun = this.getEquippedGun();
    const offsetDistance = 0.6;
    const normalizedDirection = direction.clone().normalize();

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

}

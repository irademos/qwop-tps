// app.js
import * as THREE from "three";
import { PlayerCharacter } from "./characters/PlayerCharacter.js";
import { loadMonsterModel } from "./models/monsterModel.js";
import { MonsterCharacter } from "./characters/MonsterCharacter.js";
import { createFriendlyNpcManager } from "./friendlyNpcManager.js";
import { createClouds } from "./environment/worldGeneration.js";
import { getTerrainHeight } from './environment/water.js';
import { Multiplayer } from './peerConnection.js';
import { PlayerControls } from './controls/controls.js';
import { getCookie, setCookie } from './utils.js';
import { spawnProjectile, updateProjectiles } from './items/projectiles.js';
import { spawnArrowProjectile } from './items/arrow.js';
import { updateMeleeAttacks } from './items/melee.js';
import { initSpeechCommands } from './controls/speechCommands.js';
import { AudioManager } from './audioManager.js';
import { IceGun } from './items/iceGun.js';
import { Bow } from './items/bow.js';
import { Lantern } from './items/lantern.js';
import { AutumnSword } from './items/autumnSword.js';
import { TreasureChest } from './items/treasure_chest.js';
import { createNature } from './environment/nature.js';
import { createCabin } from './environment/cabin.js';
import { createMushrooms, MUSHROOM_ENTRIES } from './environment/mushrooms.js';
import { createApples, APPLE_ITEM_ID } from './items/apple.js';
import { createHomeSystem } from './home.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import RAPIER from '@dimforge/rapier3d-compat';
import { getSpawnPosition } from './spawnUtils.js';
import { createLocationProvider } from './location.js';
import { fetchOSMData } from './osmClient.js';
import { overpassToGeoJSON } from './osmGeoJson.js';
import { createMapRenderer } from './environment/mapRender.js';
import { createBuildingsRenderer } from './environment/buildingsRender.js';
import { createTileCache } from './tileCache.js';
import { createGroundTiles } from './environment/groundTiles.js';
import { clearCache, getCachedTile, setCachedTile } from './idbCache.js';
import { initHomeStoragePanel, openHomeStorage, updateUI as updateHomeStorageUI } from './controls/homeStoragePanel.js';
import { initSettingsPanel, openSettings, updateUI as updateSettingsUI } from './controls/settingsPanel.js';
import { initCustomizeUI } from './controls/customize.js';
import { initMapView, setMapViewEnabled, update as updateMapView, zoomIn, zoomOut } from './environment/mapView.js';
import {
  clearStoredPin,
  deleteProfileData,
  getStoredPinHash,
  loadOrCreateWithPin,
  renameProfile,
  saveCustomization,
  saveStatsThrottled
} from './playerProfile.js';
import {
  initMonsterPersistence,
  loadMonstersSnapshot,
  subscribeMonsterUpdates,
  ensureMonsterRecord,
  persistMonsterHp,
  persistMonsterState,
  setMonsterPersistenceHost
} from './monsterPersistence.js';

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    if (location.hostname !== 'localhost') {
      navigator.serviceWorker.register('/service-worker.js').catch((error) => {
        console.error('Service worker registration failed:', error);
      });
    }
  });
}

const DEFAULT_CHARACTER_MODEL = "/models/base_character.fbx";
const MAX_MONSTERS = 2;
const MONSTER_MODELS = [
  "/models/zombie.fbx"
];
const MONSTER_SPAWN_MIN_RADIUS = 25;
const MONSTER_SPAWN_MAX_RADIUS = 80;
const MONSTER_RESPAWN_DELAY_RANGE_MS = [3000, 5000];
const MONSTER_SPAWN_ATTEMPTS = 12;
const MONSTER_LEVEL_WEIGHTS = [
  { level: 1, weight: 0.55 },
  { level: 2, weight: 0.25 },
  { level: 3, weight: 0.15 },
  { level: 4, weight: 0.05 }
];

const PERF = {
  throttleAI: true,
  throttlePickups: true,
  throttleUI: true,
  disableMonsters: false,
  disablePickups: false,
  disableMapUpdates: false
};

window.PERF = PERF;
window.DEBUG_CONSOLE = false;

const clock = new THREE.Clock();
const mixerClock = new THREE.Clock();
const REMOTE_ANIM_FPS = 8;
const REMOTE_ANIM_INTERVAL = 1 / REMOTE_ANIM_FPS;
const MONSTER_ANIM_FPS = 8;
const MONSTER_ANIM_INTERVAL = 1 / MONSTER_ANIM_FPS;
const MONSTER_SWORD_MODEL_URL = '/assets/props/autumn_sword.glb';
const MONSTER_SWORD_SCALE = 0.16;
const MONSTER_SWORD_HOLD_OFFSET = new THREE.Vector3(-0.05, 0.15, 0.08);
const MONSTER_SWORD_HOLD_ROTATION = new THREE.Euler(-Math.PI / 2, Math.PI, 0, 'YXZ');
const MONSTER_SWORD_HOLD_QUATERNION = new THREE.Quaternion().setFromEuler(MONSTER_SWORD_HOLD_ROTATION);
const ARROW_MODEL_URL = '/assets/props/arrow.glb';
const ARROW_PROJECTILE_SCALE = 2.2;
const ARROW_PROJECTILE_SPEED = 55;
const ARROW_PROJECTILE_LIFETIME = 6000;


// --- Rapier demo state ---
let rapierWorld;
const rbToMesh = new Map(); // RigidBody -> THREE.Mesh
let physicsAccumulator = 0;
const FIXED_DT = 1 / 60;
let monsterSwordTemplate = null;
let monsterSwordTemplatePromise = null;
let arrowTemplate = null;
let arrowTemplatePromise = null;
const WORLD_ORIGIN_STORAGE_KEY = 'worldOrigin';
const METERS_PER_DEGREE_LAT = 111_132.92;
const PLAYER_VISIBILITY_RADIUS_M = 200;
const PRESENCE_STALE_MS = 5000;
const PRESENCE_SEND_MS = 250;
const PRESENCE_SWEEP_MS = 250;
const REMOTE_LERP_ALPHA = 0.15;
const REMOTE_TELEPORT_THRESHOLD_M = 25;
const DISPLAY_SETTINGS_KEY = 'settings:display';
const DISPLAY_PRESETS = {
  day: {
    ambientIntensity: 0.6,
    directionalIntensity: 1.1,
    groundBrightness: 1.05,
    buildingBrightness: 1.0,
    skyBrightness: 1.1
  },
  night: {
    ambientIntensity: 0.0,
    directionalIntensity: 0.0,
    groundBrightness: 0.6,
    buildingBrightness: 0.65,
    skyBrightness: 0.25
  }
};

function metersPerDegreeLon(latDeg) {
  return 111_412.84 * Math.cos((latDeg * Math.PI) / 180);
}

function distanceMeters(lat1, lon1, lat2, lon2) {
  if (![lat1, lon1, lat2, lon2].every(Number.isFinite)) return null;
  const toRad = value => (value * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function createArcadeOverlay(startOverlay) {
  const message = startOverlay.querySelector('[data-arcade-message]');
  const welcomeSection = startOverlay.querySelector('[data-arcade-welcome]');
  const welcomeText = startOverlay.querySelector('[data-arcade-welcome-text]');
  const switchButton = startOverlay.querySelector('[data-arcade-switch]');
  const form = startOverlay.querySelector('[data-arcade-form]');
  const nameInput = startOverlay.querySelector('[data-arcade-name]');
  const pinInput = startOverlay.querySelector('[data-arcade-pin]');
  const confirmField = startOverlay.querySelector('[data-arcade-confirm-field]');
  const confirmInput = startOverlay.querySelector('[data-arcade-confirm]');
  const loginButton = startOverlay.querySelector('[data-arcade-login]');
  const signupButton = startOverlay.querySelector('[data-arcade-signup]');
  const backButton = startOverlay.querySelector('[data-arcade-back]');
  const startButton = startOverlay.querySelector('[data-arcade-start]');

  let mode = 'login';
  let currentName = '';
  let authInProgress = false;
  let authToken = 0;
  let resolveAuth = null;
  let startHandler = null;
  let activeLoadProfile = loadOrCreateWithPin;

  const createWaiter = () => {
    const queue = [];
    let resolver = null;
    return {
      push(value) {
        if (resolver) {
          resolver(value);
          resolver = null;
          return;
        }
        queue.push(value);
      },
      wait() {
        return new Promise(resolve => {
          if (queue.length > 0) {
            resolve(queue.shift());
          } else {
            resolver = resolve;
          }
        });
      }
    };
  };

  const loginWaiter = createWaiter();
  const signupWaiter = createWaiter();

  const setMessage = text => {
    if (!message) return;
    message.textContent = text || '';
  };

  const setMode = nextMode => {
    mode = nextMode;
    if (mode === 'signup') {
      confirmField?.classList.remove('hidden');
      loginButton?.classList.add('hidden');
      backButton?.classList.remove('hidden');
      signupButton?.classList.remove('arcade-secondary');
      confirmInput.value = '';
    } else {
      confirmField?.classList.add('hidden');
      loginButton?.classList.remove('hidden');
      backButton?.classList.add('hidden');
      signupButton?.classList.add('arcade-secondary');
      confirmInput.value = '';
    }
  };

  const showLoginForm = ({ name, preserveMessage = false } = {}) => {
    form?.classList.remove('hidden');
    welcomeSection?.classList.add('hidden');
    startButton?.classList.add('hidden');
    setMode('login');
    if (!preserveMessage) {
      setMessage('');
    }
    nameInput.value = name || '';
    pinInput.value = '';
    confirmInput.value = '';
  };

  const showWelcome = (name, { ready = false } = {}) => {
    welcomeText.textContent = `Welcome back ${name}`;
    welcomeSection?.classList.remove('hidden');
    form?.classList.add('hidden');
    startButton?.classList.remove('hidden');
    startButton.disabled = !ready;
  };

  const hideOverlay = () => {
    startOverlay.setAttribute('aria-hidden', 'true');
    startOverlay.classList.add('hidden');
    startOverlay.style.display = 'none';
  };

  const requestLoginPin = async name => {
    showLoginForm({ name, preserveMessage: true });
    return loginWaiter.wait();
  };

  const requestNewPin = async name => {
    showLoginForm({ name, preserveMessage: true });
    setMode('signup');
    return signupWaiter.wait();
  };

  const startAuthFlow = async (name, { autoStart = false } = {}) => {
    if (!name) return;
    const token = ++authToken;
    authInProgress = true;
    setMessage('Checking your save...');
    try {
      const result = await activeLoadProfile(name, {
        requestLoginPin,
        requestNewPin,
        onIncorrectPin: () => setMessage('Incorrect PIN. Try again.'),
        onInvalidPin: () => setMessage('PIN must be 4–6 digits.'),
        useAlerts: false
      });
      if (token !== authToken) return;
      authInProgress = false;
      if (result?.canceled) {
        setMessage('Login canceled.');
        showLoginForm({ name: nameInput.value });
        return;
      }
      currentName = result.profile?.name || name;
      setMessage('');
      if (autoStart) {
        if (startHandler) {
          startHandler();
        }
        hideOverlay();
      } else {
        showWelcome(currentName, { ready: true });
      }
      resolveAuth?.(result);
    } catch (err) {
      if (token !== authToken) return;
      authInProgress = false;
      setMessage('Login failed. Try again.');
      showLoginForm({ name: nameInput.value });
      console.warn('Login flow failed', err);
    }
  };

  const handleLoginSubmit = event => {
    event.preventDefault();
    if (mode !== 'login') return;
    const name = nameInput.value.trim();
    const pin = pinInput.value.trim();
    if (!name) {
      setMessage('Enter your name to continue.');
      return false;
    }
    if (!pin) {
      setMessage('Enter your PIN to continue.');
      return false;
    }
    if (authInProgress && name !== currentName) {
      setMessage('Switch user to log in with a different name.');
      return false;
    }
    currentName = name;
    loginWaiter.push(pin);
    return true;
  };

  const handleSignupSubmit = event => {
    event.preventDefault();
    if (mode !== 'signup') {
      setMode('signup');
      setMessage('');
      return false;
    }
    const name = nameInput.value.trim();
    const pin = pinInput.value.trim();
    const confirm = confirmInput.value.trim();
    if (!name) {
      setMessage('Enter your name to continue.');
      return false;
    }
    if (!pin || !confirm) {
      setMessage('Enter and confirm your PIN.');
      return false;
    }
    if (pin !== confirm) {
      setMessage('PINs do not match.');
      return false;
    }
    if (authInProgress && name !== currentName) {
      setMessage('Switch user to sign up with a different name.');
      return false;
    }
    currentName = name;
    signupWaiter.push(pin);
    return true;
  };

  const handleBackToLogin = event => {
    event.preventDefault();
    setMode('login');
    setMessage('');
  };

  const handleSwitchUser = () => {
    authToken += 1;
    authInProgress = false;
    if (currentName) {
      clearStoredPin(currentName);
      setCookie('playerName', '', -1);
      localStorage.removeItem('playerName');
    }
    currentName = '';
    showLoginForm();
    setMessage('Enter a new name to continue.');
  };

  loginButton?.addEventListener('click', event => {
    const queued = handleLoginSubmit(event);
    if (queued && !authInProgress && nameInput.value.trim()) {
      startAuthFlow(nameInput.value.trim(), { autoStart: true });
    }
  });

  form?.addEventListener('submit', event => {
    if (mode === 'login') {
      const queued = handleLoginSubmit(event);
      if (queued && !authInProgress && nameInput.value.trim()) {
        startAuthFlow(nameInput.value.trim(), { autoStart: true });
      }
    } else if (mode === 'signup') {
      const queued = handleSignupSubmit(event);
      if (queued && !authInProgress && nameInput.value.trim()) {
        startAuthFlow(nameInput.value.trim(), { autoStart: true });
      }
    }
  });

  signupButton?.addEventListener('click', event => {
    if (mode === 'login') {
      handleSignupSubmit(event);
      return;
    }
    const queued = handleSignupSubmit(event);
    if (queued && !authInProgress && nameInput.value.trim()) {
      startAuthFlow(nameInput.value.trim(), { autoStart: true });
    }
  });

  backButton?.addEventListener('click', handleBackToLogin);
  switchButton?.addEventListener('click', handleSwitchUser);

  startButton?.addEventListener('click', () => {
    if (startHandler) {
      startHandler();
    }
    hideOverlay();
  });

  return {
    async authenticate({ initialName, hasStoredPin, loadProfile }) {
      if (loadProfile) {
        activeLoadProfile = loadProfile;
      }
      const authPromise = new Promise(resolve => {
        resolveAuth = resolve;
      });
      if (initialName) {
        nameInput.value = initialName;
      }
      if (initialName && hasStoredPin) {
        currentName = initialName;
        showWelcome(initialName, { ready: false });
        startAuthFlow(initialName, { autoStart: false });
      } else {
        showLoginForm({ name: initialName });
      }
      return authPromise;
    },
    setStartHandler(handler) {
      startHandler = handler;
    },
    hideOverlay
  };
}

async function main() {
  document.body.addEventListener('touchstart', () => {}, { once: true });

  const audioManager = new AudioManager();
  const startOverlay = document.getElementById('start-overlay');
  const arcadeOverlay = createArcadeOverlay(startOverlay);
  let hasStartedAudio = false;

  const resumeAudioContext = async () => {
    const context = THREE.AudioContext?.getContext?.();
    if (context?.state === 'suspended') {
      try {
        await context.resume();
      } catch (err) {
        console.warn('AudioContext resume failed', err);
      }
    }
  };

  const focusGameCanvas = () => {
    const canvas = document.querySelector('#game-container canvas');
    if (canvas) {
      canvas.tabIndex = 0;
      canvas.focus();
    } else {
      document.body?.focus?.();
    }
  };

  const startAudioAndGameOnce = async () => {
    if (hasStartedAudio) return;
    hasStartedAudio = true;
    await resumeAudioContext();
    audioManager.playBGS('Forest Day/Forest Day.ogg');
    focusGameCanvas?.();
  };

  arcadeOverlay.setStartHandler(startAudioAndGameOnce);

  let playerName = localStorage.getItem('playerName') || getCookie("playerName");
  const hasStoredPin = !!getStoredPinHash(playerName);
  const profileResult = await arcadeOverlay.authenticate({
    initialName: playerName,
    hasStoredPin,
    loadProfile: loadOrCreateWithPin
  });
  playerName = profileResult.profile?.name || playerName;
  let { nameKey: profileNameKey, profile: playerProfile } = profileResult;

  setCookie("playerName", playerName);
  localStorage.setItem('playerName', playerName);

  let updatePlayerInfoUI = () => {};

  const FOOD_HUNGER_GAIN = 25;
  const FOOD_ENERGY_GAIN = 15;
  const HEALTH_PICKUP_GAIN = 20;
  const MUSHROOM_HEALTH_GAIN = 6;
  const MUSHROOM_HUNGER_GAIN = 6;
  const MUSHROOM_ENERGY_GAIN = 6;
  const APPLE_HEALTH_GAIN = 4;
  const APPLE_HUNGER_GAIN = 4;
  const APPLE_ENERGY_GAIN = 4;
  const HUNGER_DECAY_PER_HOUR = 6;
  const ENERGY_DECAY_PER_SECOND_WHILE_MOVING = 0.6;
  const HUNGER_HEALTH_DECAY_PER_SECOND = 0.2;
  const PICKUP_RADIUS = 1.2;
  const MAX_AMMO_PICKUPS = 60;
  const MAX_FOOD_PICKUPS = 80;
  const MAX_HEALTH_PICKUPS = 60;
  const MAX_COIN_PICKUPS = 80;
  const TILE_STOCK_AMMO_COUNT = 0;
  const TILE_STOCK_FOOD_COUNT = 500;
  const TILE_STOCK_HEALTH_COUNT = 800;
  const TILE_STOCK_COIN_COUNT = 500;
  const TILE_STOCK_WEAPON_COUNT = 100;
  const PICKUP_SPAWN_RADIUS = 225;
  const PICKUP_STOCK_COOLDOWN_MS = 1 * 5 * 1000;
  const ICE_GUN_AMMO_CLUSTER_COUNT = 3;
  const ICE_GUN_AMMO_CLUSTER_RADIUS = 1.4;

  let characterModel = localStorage.getItem('characterModel') || getCookie("characterModel") || DEFAULT_CHARACTER_MODEL;
  setCookie("characterModel", characterModel);
  localStorage.setItem('characterModel', characterModel);

  let multiplayer = null;
  let isHost = false;
  let playerControls = null;
  let friendlyNpcManager = null;
  let homeSystem = null;
  let scene = null;
  let mapRenderer = null;
  let buildingsRenderer = null;
  let natureController = null;
  let groundTiles = null;
  let ambientLight = null;
  let dirLight = null;
  let tileCache = null;
  let worldOrigin = null;
  let currentRenderOrigin = null;
  let activeTileKey = null;
  let pendingMapRebuild = false;
  let mapRebuildToken = 0;
  const networkedEntities = new Map();
  const pendingEntityStates = new Map();
  const authoritativeEntityStates = new Map();
  let lastEntityBroadcast = 0;
  let lastFullEntityBroadcast = 0;
  let lastControlSend = 0;
  const ENTITY_BROADCAST_INTERVAL = 200;
  const ENTITY_STATE_DIRTY_THRESHOLD = 0.01;
  const ENTITY_FULL_SNAPSHOT_INTERVAL = 5000;
  const CONTROL_SEND_INTERVAL = 140;
  const projectiles = [];
  const iceMists = [];
  const ammoPickups = [];
  const droppedAmmoPickups = new Map();
  const pendingDropRemovals = new Set();
  const AMMO_PICKUP_AMOUNT = 5;
  const ICE_AMMO_KEY = 'ice ammo';
  const ARROW_AMMO_KEY = 'arrow ammo';
  const DEFAULT_ICE_AMMO = 10;
  const DEFAULT_ARROW_AMMO = 5;
  const COIN_PICKUP_GAIN = 1;
  const foodPickups = [];
  const healthPickups = [];
  const coinPickups = [];
  let mushroomController = null;
  let mushroomPickups = [];
  let appleController = null;
  let applePickups = [];
  const mushroomItemIds = new Set(MUSHROOM_ENTRIES.map((entry) => entry.id));
  const appleItemIds = new Set([APPLE_ITEM_ID]);
  const PICKUP_CHECK_INTERVAL_MS = 250;
  let lastPickupCheckMs = 0;

  const otherPlayers = {};
  window.otherPlayers = otherPlayers;
  const remotePresenceMeta = {};
  let lastPresenceSend = 0;
  let lastPresenceSweep = 0;
  let remoteAnimAccumulator = 0;
  let monsterAnimAccumulator = 0;

  let monsters = [];
  window.monsters = monsters;
  const monsterSlotIds = ["monster:0", "monster:1"];
  const spawningSlots = new Set();
  const respawnTimers = new Map();
  let monstersSeeded = false;
  let monsterSnapshotLoaded = false;
  let unsubscribeMonsterUpdates = null;
  const recentMonsterHits = new Map();


  scene = new THREE.Scene();
  const rotateSkyboxFaceClockwise = (image) => {
    if (!image) return image;
    const canvas = document.createElement('canvas');
    canvas.width = image.height;
    canvas.height = image.width;
    const context = canvas.getContext('2d');
    if (!context) return image;
    context.translate(canvas.width / 2, canvas.height / 2);
    context.rotate(Math.PI / 2);
    context.drawImage(image, -image.width / 2, -image.height / 2);
    return canvas;
  };
  const skyboxTexture = new THREE.CubeTextureLoader()
    .setPath('/assets/textures/sky/')
    .load(
      ['px.jpg', 'nx.jpg', 'py.jpg', 'ny.jpg', 'pz.jpg', 'nz.jpg'],
      (texture) => {
        texture.image[2] = rotateSkyboxFaceClockwise(texture.image[2]);
        texture.needsUpdate = true;
      }
    );
  scene.background = skyboxTexture;
  createClouds(scene);

  const DISPLAY_MODES = new Set(['auto', 'day', 'night']);
  const clampValue = (value, min, max) => Math.min(Math.max(value, min), max);
  const pickupEmissiveMaterials = new Set();
  let pickupEmissiveBrightness = 1;
  const captureMaterialBase = (material) => {
    if (!material) return null;
    const color = material.color?.clone ? material.color.clone() : new THREE.Color(0xffffff);
    const emissiveIntensity = typeof material.emissiveIntensity === 'number' ? material.emissiveIntensity : 0;
    return { color, emissiveIntensity };
  };
  const registerPickupEmissiveMaterials = (target) => {
    const registerMaterial = (material) => {
      if (!material || typeof material.emissiveIntensity !== 'number') return;
      material.userData = material.userData || {};
      if (typeof material.userData.baseEmissiveIntensity !== 'number') {
        material.userData.baseEmissiveIntensity = material.emissiveIntensity;
      }
      pickupEmissiveMaterials.add(material);
      material.emissiveIntensity = material.userData.baseEmissiveIntensity * pickupEmissiveBrightness;
      material.needsUpdate = true;
    };
    if (!target) return;
    if (Array.isArray(target)) {
      target.forEach(registerMaterial);
      return;
    }
    if (target.isMaterial) {
      registerMaterial(target);
      return;
    }
    if (target.isMesh) {
      const materials = Array.isArray(target.material) ? target.material : [target.material];
      materials.forEach(registerMaterial);
      return;
    }
    if (typeof target.traverse === 'function') {
      target.traverse((child) => {
        if (!child.isMesh) return;
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        materials.forEach(registerMaterial);
      });
    }
  };
  const applyMaterialBrightness = (material, base, brightness) => {
    if (!material || !base) return;
    const clamped = clampValue(brightness, 0, 2);
    if (material.color?.copy) {
      material.color.copy(base.color).multiplyScalar(clamped);
    }
    material.emissiveIntensity = base.emissiveIntensity * clamped;
    material.needsUpdate = true;
  };
  const getAutoMode = () => {
    const now = new Date();
    const minutes = now.getHours() * 60 + now.getMinutes();
    if (minutes >= 17 * 60 + 30 || minutes < 8 * 60) {
      return 'night';
    }
    return 'day';
  };
  const loadDisplaySettings = () => {
    const defaults = { mode: 'auto', ...DISPLAY_PRESETS.day };
    const raw = localStorage.getItem(DISPLAY_SETTINGS_KEY);
    if (!raw) return defaults;
    try {
      const parsed = JSON.parse(raw);
      return { ...defaults, ...parsed };
    } catch (error) {
      console.warn('Failed to parse display settings, using defaults.', error);
      return defaults;
    }
  };
  const saveDisplaySettings = () => {
    localStorage.setItem(DISPLAY_SETTINGS_KEY, JSON.stringify(displaySettings));
  };
  const applyPresetForMode = (mode) => {
    const preset = DISPLAY_PRESETS[mode] || DISPLAY_PRESETS.day;
    displaySettings = { ...displaySettings, ...preset };
  };

  let displaySettings = loadDisplaySettings();
  let lastAutoMode = null;
  let groundMaterialBase = null;
  let buildingMaterialBase = null;

  if (!DISPLAY_MODES.has(displaySettings.mode)) {
    displaySettings.mode = 'auto';
  }
  if (displaySettings.mode === 'auto') {
    lastAutoMode = getAutoMode();
    applyPresetForMode(lastAutoMode);
  }

  const applyDisplaySettings = () => {
    const effectiveMode = displaySettings.mode === 'auto'
      ? (lastAutoMode || getAutoMode())
      : displaySettings.mode;
    const pickupBrightness = clampValue(
      (displaySettings.ambientIntensity + displaySettings.directionalIntensity) / 2,
      0,
      1
    );
    pickupEmissiveBrightness = pickupBrightness;
    if (scene) {
      if (effectiveMode === 'night') {
        scene.background = new THREE.Color(0x000000);
      } else {
        scene.background = skyboxTexture;
      }
    }
    if (ambientLight) {
      ambientLight.intensity = clampValue(displaySettings.ambientIntensity, 0, 2);
    }
    if (dirLight) {
      dirLight.intensity = clampValue(displaySettings.directionalIntensity, 0, 2);
    }
    applyMaterialBrightness(groundTiles?.material, groundMaterialBase, displaySettings.groundBrightness);
    applyMaterialBrightness(buildingsRenderer?.materials?.extruded, buildingMaterialBase?.extruded, displaySettings.buildingBrightness);
    applyMaterialBrightness(buildingsRenderer?.materials?.flat, buildingMaterialBase?.flat, displaySettings.buildingBrightness);
    mapRenderer?.setBrightness?.(pickupBrightness);
    for (const material of pickupEmissiveMaterials) {
      if (!material || typeof material.emissiveIntensity !== 'number') continue;
      const base = material.userData?.baseEmissiveIntensity ?? material.emissiveIntensity;
      material.emissiveIntensity = base * pickupBrightness;
      material.needsUpdate = true;
    }
  };

  const updateAutoDisplayMode = () => {
    if (displaySettings.mode !== 'auto') return;
    const nextMode = getAutoMode();
    if (nextMode === lastAutoMode) return;
    lastAutoMode = nextMode;
    applyPresetForMode(nextMode);
    saveDisplaySettings();
    applyDisplaySettings();
    updateSettingsUI();
  };

  const setDisplayMode = (mode) => {
    if (!DISPLAY_MODES.has(mode)) return;
    displaySettings.mode = mode;
    if (mode === 'auto') {
      lastAutoMode = getAutoMode();
      applyPresetForMode(lastAutoMode);
    } else {
      lastAutoMode = mode;
      applyPresetForMode(mode);
    }
    saveDisplaySettings();
    applyDisplaySettings();
    updateSettingsUI();
  };

  const setDisplaySetting = (key, value) => {
    if (!Number.isFinite(value)) return;
    displaySettings[key] = value;
    saveDisplaySettings();
    applyDisplaySettings();
  };

  const logNet = (...args) => {
    if (window.DEBUG_NET) {
      console.log('[net]', ...args);
    }
  };

  const logMonsterPersist = (...args) => {
    if (window.DEBUG_MONSTER_PERSIST) {
      console.log('[monsterPersist]', ...args);
    }
  };

  const sendMonsterAttackIntent = ({ monsterId, damage, sourcePlayerId, at }) => {
    if (!multiplayer || multiplayer.isHost) return;
    const hostId = multiplayer.getHostId?.();
    if (!hostId || !monsterId || !Number.isFinite(damage)) return;
    multiplayer.sendTo(hostId, {
      type: 'attackMonster',
      monsterId,
      damage,
      sourcePlayerId: sourcePlayerId ?? multiplayer.getId?.(),
      at: at ?? Date.now()
    });
  };

  const handleMonsterDamage = (monster) => {
    if (!multiplayer?.isHost || !monster) return;
    persistMonsterHp(monster);
  };

  const removeRemotePlayer = (remoteId, reason = 'unknown') => {
    const existing = otherPlayers[remoteId];
    if (existing) {
      if (existing.model && existing.model.parent) {
        existing.model.parent.remove(existing.model);
      }
      if (existing.nameLabel && existing.nameLabel.parentNode) {
        existing.nameLabel.parentNode.removeChild(existing.nameLabel);
      }
      delete otherPlayers[remoteId];
    }
    if (remotePresenceMeta[remoteId]) {
      delete remotePresenceMeta[remoteId];
    }
    logNet('despawn', remoteId, reason);
  };

  function cloneState(state) {
    return state ? JSON.parse(JSON.stringify(state)) : state;
  }

  function applyNetworkedState(id, state) {
    if (!state) return;
    const entry = networkedEntities.get(id);
    if (entry && typeof entry.applyState === 'function') {
      entry.applyState(state);
    } else {
      pendingEntityStates.set(id, cloneState(state));
    }
  }

  function registerNetworkedEntity(id, entry) {
    networkedEntities.set(id, entry);
    if (pendingEntityStates.has(id)) {
      const pending = pendingEntityStates.get(id);
      pendingEntityStates.delete(id);
      entry.applyState?.(pending);
    }
  }

  function updateAuthoritativeState(id, state, sourceId) {
    const copy = cloneState(state);
    const existing = authoritativeEntityStates.get(id);
    const baselineState = existing?.lastSentState ?? existing?.state;
    const isDirty = !existing
      || isStateDifferent(baselineState, copy)
      || existing.sourceId !== sourceId;
    authoritativeEntityStates.set(id, {
      state: copy,
      lastSentState: existing?.lastSentState ?? cloneState(copy),
      sourceId,
      timestamp: performance.now(),
      dirty: existing?.dirty || isDirty
    });
    applyNetworkedState(id, copy);
  }

  function isStateDifferent(previous, next) {
    if (previous === next) return false;
    if (previous == null || next == null) return previous !== next;
    if (typeof previous !== typeof next) return true;
    if (typeof previous === 'number' && typeof next === 'number') {
      if (!Number.isFinite(previous) || !Number.isFinite(next)) {
        return previous !== next;
      }
      return Math.abs(previous - next) > ENTITY_STATE_DIRTY_THRESHOLD;
    }
    if (Array.isArray(previous) || Array.isArray(next)) {
      if (!Array.isArray(previous) || !Array.isArray(next)) return true;
      if (previous.length !== next.length) return true;
      return previous.some((value, index) => isStateDifferent(value, next[index]));
    }
    if (typeof previous === 'object') {
      const previousKeys = Object.keys(previous);
      const nextKeys = Object.keys(next);
      if (previousKeys.length !== nextKeys.length) return true;
      return previousKeys.some(key => !Object.prototype.hasOwnProperty.call(next, key)
        || isStateDifferent(previous[key], next[key]));
    }
    return previous !== next;
  }

  function serializeDirtyAuthoritativeStates() {
    const payload = {};
    authoritativeEntityStates.forEach((entry, id) => {
      if (!entry.dirty) return;
      payload[id] = { ...cloneState(entry.state), sourceId: entry.sourceId };
      entry.lastSentState = cloneState(entry.state);
      entry.dirty = false;
    });
    return payload;
  }

  function serializeFullAuthoritativeStates() {
    const payload = {};
    authoritativeEntityStates.forEach((entry, id) => {
      payload[id] = { ...cloneState(entry.state), sourceId: entry.sourceId };
      entry.lastSentState = cloneState(entry.state);
      entry.dirty = false;
    });
    return payload;
  }

  function collectLocalControlStates() {
    const result = new Map();
    const myId = multiplayer?.getId?.();
    if (!myId) return result;
    networkedEntities.forEach((entry, id) => {
      if (typeof entry.isLocallyControlled === 'function' && entry.isLocallyControlled()) {
        const state = entry.getState?.();
        if (state) {
          result.set(id, { state, sourceId: myId });
        }
      }
    });
    return result;
  }

  const worldAnchorMatchesLocal = (anchor) => {
    if (!anchor) return false;
    const mapOrigin = getLocalMapOrigin();
    if (!mapOrigin) return false;
    const { centerLat, centerLon } = anchor;
    if (!Number.isFinite(centerLat) || !Number.isFinite(centerLon)) return false;
    const dist = distanceMeters(mapOrigin.centerLat, mapOrigin.centerLon, centerLat, centerLon);
    return dist != null && dist <= 50;
  };

  function handleIncomingData(peerId, data) {
    // console.log('📡 Incoming data:', data);
    const isObject = value => value && typeof value === 'object' && !Array.isArray(value);
    const isFiniteNumber = value => Number.isFinite(value);
    const isVector3Array = value => Array.isArray(value)
      && value.length === 3
      && value.every(isFiniteNumber);

    const logInvalidPayload = (typeLabel, payload) => {
      console.warn(`[net] Dropping invalid ${typeLabel} payload`, payload);
    };

    const isPresenceMessage = payload => {
      if (!isObject(payload) || payload.type !== 'presence') return false;
      if (typeof payload.name !== 'string' || typeof payload.model !== 'string') return false;
      if (payload.id != null && typeof payload.id !== 'string') return false;
      if (payload.action != null && typeof payload.action !== 'string') return false;
      const numberFields = ['lat', 'lon', 'x', 'y', 'z', 'rotation', 'heading'];
      if (numberFields.some(field => payload[field] != null && !isFiniteNumber(payload[field]))) return false;
      if (payload.worldAnchor != null) {
        if (!isObject(payload.worldAnchor)) return false;
        const { centerLat, centerLon } = payload.worldAnchor;
        if (centerLat != null && !isFiniteNumber(centerLat)) return false;
        if (centerLon != null && !isFiniteNumber(centerLon)) return false;
      }
      return true;
    };

    const isEntityControlMessage = payload => isObject(payload)
      && payload.type === 'entityControl'
      && typeof payload.id === 'string'
      && typeof payload.sourceId === 'string'
      && isObject(payload.state);

    const isEntityStatesMessage = payload => {
      if (!isObject(payload) || payload.type !== 'entityStates' || !isObject(payload.states)) return false;
      return Object.entries(payload.states).every(([, entry]) => {
        if (!isObject(entry)) return false;
        return entry.sourceId == null || typeof entry.sourceId === 'string';
      });
    };

    const isEntitySnapshotMessage = payload => {
      if (!isObject(payload) || payload.type !== 'entitySnapshot' || !isObject(payload.states)) return false;
      return Object.entries(payload.states).every(([, entry]) => {
        if (!isObject(entry)) return false;
        return entry.sourceId == null || typeof entry.sourceId === 'string';
      });
    };

    const isEntityStateRequestMessage = payload => isObject(payload)
      && payload.type === 'entityStateRequest'
      && typeof payload.requesterId === 'string'
      && typeof payload.previousHostId === 'string';

    const isProjectileMessage = payload => isObject(payload)
      && payload.type === 'projectile'
      && typeof payload.id === 'string'
      && isVector3Array(payload.position)
      && isVector3Array(payload.direction)
      && (payload.weapon == null || typeof payload.weapon === 'string');

    const isIceMistMessage = payload => isObject(payload)
      && payload.type === 'iceMist'
      && typeof payload.id === 'string'
      && isVector3Array(payload.position)
      && isVector3Array(payload.direction);

    const isInventoryDropMessage = payload => {
      if (!isObject(payload) || payload.type !== 'inventoryDrop' || !Array.isArray(payload.drops)) return false;
      return payload.drops.every(drop => {
        if (!isObject(drop)) return false;
        if (typeof drop.id !== 'string') return false;
        if (!isVector3Array(drop.position)) return false;
        if (drop.amount != null && !isFiniteNumber(drop.amount)) return false;
        return true;
      });
    };

    const isDropPickupMessage = payload => isObject(payload)
      && payload.type === 'dropPickup'
      && typeof payload.dropId === 'string';

    const isGrabMessage = payload => isObject(payload)
      && payload.type === 'grab'
      && typeof payload.target === 'string'
      && typeof payload.active === 'boolean'
      && (payload.from == null || typeof payload.from === 'string');

    const isGrabMoveMessage = payload => isObject(payload)
      && payload.type === 'grabMove'
      && typeof payload.target === 'string'
      && isVector3Array(payload.position);

    const isAttackMonsterMessage = payload => isObject(payload)
      && payload.type === 'attackMonster'
      && typeof payload.monsterId === 'string'
      && isFiniteNumber(payload.damage)
      && (payload.sourcePlayerId == null || typeof payload.sourcePlayerId === 'string')
      && (payload.at == null || isFiniteNumber(payload.at));

    if (!isObject(data)) {
      logInvalidPayload('payload', data);
      return;
    }

    if (data.type === 'entityControl') {
      if (!isEntityControlMessage(data)) {
        logInvalidPayload('entityControl', data);
        return;
      }
      if (multiplayer?.isHost && data.id && data.state && data.sourceId) {
        updateAuthoritativeState(data.id, data.state, data.sourceId);
      }
      return;
    }

    if (data.type === 'entityStates') {
      if (!isEntityStatesMessage(data)) {
        logInvalidPayload('entityStates', data);
        return;
      }
      Object.entries(data.states).forEach(([id, entry]) => {
        if (!entry) return;
        const { sourceId, ...state } = entry;
        if (sourceId && sourceId === multiplayer?.getId?.()) {
          const localEntry = networkedEntities.get(id);
          if (localEntry?.isLocallyControlled?.()) {
            updateAuthoritativeState(id, state, sourceId);
            return;
          }
        }
        updateAuthoritativeState(id, state, sourceId ?? null);
      });
      return;
    }

    if (data.type === 'entitySnapshot' && multiplayer?.isHost) {
      if (!isEntitySnapshotMessage(data)) {
        logInvalidPayload('entitySnapshot', data);
        return;
      }
      authoritativeEntityStates.clear();
      Object.entries(data.states).forEach(([id, entry]) => {
        if (!entry) return;
        const { sourceId, ...state } = entry;
        updateAuthoritativeState(id, state, sourceId ?? null);
      });
      lastEntityBroadcast = 0;
      return;
    }

    if (data.type === 'entityStateRequest') {
      if (!isEntityStateRequestMessage(data)) {
        logInvalidPayload('entityStateRequest', data);
        return;
      }
      if (data.previousHostId !== multiplayer?.getId?.()) {
        return;
      }
      const snapshot = serializeFullAuthoritativeStates();
      if (Object.keys(snapshot).length > 0) {
        multiplayer.sendTo(data.requesterId, { type: 'entitySnapshot', states: snapshot });
      }
      return;
    }

    if (data.type === 'attackMonster') {
      if (!isAttackMonsterMessage(data)) {
        logInvalidPayload('attackMonster', data);
        return;
      }
      if (!multiplayer?.isHost) return;
      const monsterId = data.monsterId;
      const monster = monsters.find(entry => entry.id === monsterId);
      if (!monster) return;
      const sourceId = data.sourcePlayerId || peerId;
      const nowMs = Date.now();
      const eventAt = Number.isFinite(data.at) ? data.at : nowMs;
      const key = `${sourceId}:${monsterId}`;
      const lastHitAt = recentMonsterHits.get(key) || 0;
      if (eventAt - lastHitAt < 250) return;
      recentMonsterHits.set(key, eventAt);
      logMonsterPersist('attack intent', { monsterId, damage: data.damage, sourceId });
      const killed = monster.applyDamage(data.damage);
      persistMonsterHp(monster);
      if (killed && sourceId === multiplayer.getId()) {
        window.onMonsterKill?.();
      }
      return;
    }

    if (data.type === 'presence') {
      if (!isPresenceMessage(data)) {
        logInvalidPayload('presence', data);
        return;
      }
      const remoteId = data.id || peerId;
      const desiredModel = data.model || DEFAULT_CHARACTER_MODEL;
      const now = performance.now();
      if (!remotePresenceMeta[remoteId]) {
        remotePresenceMeta[remoteId] = { lastSeenMs: now, lastLat: null, lastLon: null };
      } else {
        remotePresenceMeta[remoteId].lastSeenMs = now;
      }

      if (Number.isFinite(data.lat) && Number.isFinite(data.lon)) {
        remotePresenceMeta[remoteId].lastLat = data.lat;
        remotePresenceMeta[remoteId].lastLon = data.lon;
      }
      if (data.worldAnchor?.centerLat && data.worldAnchor?.centerLon) {
        remotePresenceMeta[remoteId].worldAnchor = {
          centerLat: data.worldAnchor.centerLat,
          centerLon: data.worldAnchor.centerLon
        };
      }

      const localFix = getLatestLocationFix();
      const mapOrigin = getLocalMapOrigin();
      
      // Adopt remote world anchor if we don't have one yet
      if (!getLocalMapOrigin() && data.worldAnchor?.centerLat && data.worldAnchor?.centerLon) {
        setWorldOrigin({
          lat: data.worldAnchor.centerLat,
          lon: data.worldAnchor.centerLon
        });
        rebuildMapFromCache();
      }

      if (localFix && mapOrigin && Number.isFinite(data.lat) && Number.isFinite(data.lon)
        && worldAnchorMatchesLocal(data.worldAnchor)) {
        const dist = distanceMeters(localFix.lat, localFix.lon, data.lat, data.lon);
        remotePresenceMeta[remoteId].lastDistance = dist;
        if (dist != null && dist > PLAYER_VISIBILITY_RADIUS_M) {
          removeRemotePlayer(remoteId, 'out-of-range');
          return;
        }
      }

      const existing = otherPlayers[remoteId];
      if (!existing || existing.modelPath !== desiredModel) {
        if (existing) {
          if (existing.model && existing.model.parent) {
            existing.model.parent.remove(existing.model);
          }
          if (existing.nameLabel && existing.nameLabel.parentNode) {
            existing.nameLabel.parentNode.removeChild(existing.nameLabel);
          }
        }

        const other = new PlayerCharacter(data.name, desiredModel);
        other.model.userData.hideInMapView = true;
        scene.add(other.model);
        document.body.appendChild(other.nameLabel);
        otherPlayers[remoteId] = {
          model: other.model,
          nameLabel: other.nameLabel,
          name: data.name,
          health: existing?.health ?? 100,
          modelPath: desiredModel,
          targetPos: new THREE.Vector3(),
          targetQuat: new THREE.Quaternion(),
          targetRotY: 0
        };
        logNet('spawn', remoteId, data.name);
      }

      const player = otherPlayers[remoteId];
      player.name = data.name;
      player.modelPath = desiredModel;
      if (player.nameLabel) {
        player.nameLabel.innerText = data.name;
      }

      let targetX = null;
      let targetZ = null;
      if (Number.isFinite(data.lat) && Number.isFinite(data.lon)) {
        const local = mapOrigin ? geoToLocalMeters(data.lat, data.lon, mapOrigin) : null;
        if (local) {
          targetX = local.x;
          targetZ = local.z;
        }
      }
      if (targetX == null && targetZ == null && Number.isFinite(data.x) && Number.isFinite(data.z)) {
        targetX = data.x;
        targetZ = data.z;
      }

      if (targetX == null || targetZ == null) {
        return;
      }

      const terrainY = getTerrainHeight(targetX, targetZ);
      const hasAuthoritativeY = Number.isFinite(data.y);
      const targetY = hasAuthoritativeY ? data.y : terrainY;

      if (!player.targetPos) {
        player.targetPos = new THREE.Vector3(targetX, targetY, targetZ);
      } else {
        player.targetPos.set(targetX, targetY, targetZ);
      }

      const targetRotY = Number.isFinite(data.rotation)
        ? data.rotation
        : Number.isFinite(data.heading)
          ? THREE.MathUtils.degToRad(data.heading)
          : player.model.rotation.y;
      player.targetRotY = targetRotY;
      if (!player.targetQuat) {
        player.targetQuat = new THREE.Quaternion();
      }
      player.targetQuat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), targetRotY);

      if (!player.model.visible) {
        player.model.visible = true;
      }

      // Sync animation state if provided
      const actions = player.model.userData.actions;
      const current = player.model.userData.currentAction;
      if (actions && data.action && current !== data.action) {
        actions[current]?.fadeOut(0.2);
        actions[data.action]?.reset().fadeIn(0.2).play();
        player.model.userData.currentAction = data.action;
        if (['mutantPunch','hurricaneKick','mmaKick'].includes(data.action)) {
          player.model.userData.attack = {
            name: data.action,
            start: Date.now(),
            hasHit: false
          };
        }
      }

      return;
    }

    if (data.type === 'projectile') {
      if (!isProjectileMessage(data)) {
        logInvalidPayload('projectile', data);
        return;
      }
      const position = new THREE.Vector3(...data.position);
      const direction = new THREE.Vector3(...data.direction);
      if (data.weapon === 'bow') {
        spawnArrowProjectileWithPerfFlags(scene, projectiles, position, direction, data.id);
      } else {
        spawnProjectileWithPerfFlags(scene, projectiles, position, direction, data.id);
      }

      const shooter = otherPlayers[data.id];
      if (shooter) {
        const actions = shooter.model.userData.actions;
        const current = shooter.model.userData.currentAction;
        const projAction = actions?.projectile;
        if (projAction) {
          actions[current]?.fadeOut(0.1);
          projAction.reset().fadeIn(0.1).play();
          shooter.model.userData.currentAction = 'projectile';
        }
      }
      return;
    }

    if (data.type === 'iceMist') {
      if (!isIceMistMessage(data)) {
        logInvalidPayload('iceMist', data);
        return;
      }
      const position = new THREE.Vector3(...data.position);
      const direction = new THREE.Vector3(...data.direction);
      spawnIceMist(scene, iceMists, position, direction, data.id);

      const shooter = otherPlayers[data.id];
      if (shooter) {
        const actions = shooter.model.userData.actions;
        const current = shooter.model.userData.currentAction;
        const projAction = actions?.projectile;
        if (projAction) {
          actions[current]?.fadeOut(0.1);
          projAction.reset().fadeIn(0.1).play();
          shooter.model.userData.currentAction = 'projectile';
        }
      }
      return;
    }

    if (data.type === 'monster') {
      // Legacy messages handled by networked system; ignore to avoid conflicts.
      return;
    }

    if (data.type === 'inventoryDrop' && multiplayer?.isHost) {
      if (!isInventoryDropMessage(data)) {
        logInvalidPayload('inventoryDrop', data);
        return;
      }
      const drops = Array.isArray(data.drops) ? data.drops : [];
      drops.forEach(drop => {
        if (!drop?.id || !Array.isArray(drop.position)) return;
        addDroppedAmmoPickup({
          id: drop.id,
          position: new THREE.Vector3(...drop.position),
          amount: drop.amount
        });
      });
      return;
    }

    if (data.type === 'dropPickup' && multiplayer?.isHost) {
      if (!isDropPickupMessage(data)) {
        logInvalidPayload('dropPickup', data);
        return;
      }
      if (data.dropId) {
        removeDroppedAmmoPickup(data.dropId);
      }
      return;
    }

    if (data.type === 'grab') {
      if (!isGrabMessage(data)) {
        logInvalidPayload('grab', data);
        return;
      }
      if (data.target === multiplayer.getId()) {
        playerControls?.setGrabbed(data.active, data.from);
      } else {
        const targetPlayer = otherPlayers[data.target];
        if (targetPlayer) {
          targetPlayer.grabbed = data.active;
        }
      }
      return;
    }

    if (data.type === 'grabMove') {
      if (!isGrabMoveMessage(data)) {
        logInvalidPayload('grabMove', data);
        return;
      }
      const pos = new THREE.Vector3(...data.position);
      if (data.target === multiplayer.getId()) {
        playerControls?.updateGrabbedPosition(data.position);
      } else {
        const targetPlayer = otherPlayers[data.target];
        if (targetPlayer) {
          targetPlayer.model.position.copy(pos);
        }
      }
      return;
    }
  }

  multiplayer = new Multiplayer(playerName, handleIncomingData);
  multiplayer.onHostChange = ({ previousHostId, newHostId, isCurrentHost }) => {
    isHost = !!isCurrentHost;
    setMonsterPersistenceHost(isHost);
    friendlyNpcManager?.setHost(isHost);
    logMonsterPersist('isHost', isHost);
    if (previousHostId && previousHostId === multiplayer.getId() && previousHostId !== newHostId) {
      const snapshot = serializeFullAuthoritativeStates();
      if (newHostId) {
        multiplayer.sendTo(newHostId, { type: 'entitySnapshot', states: snapshot });
      }
    }

    if (isCurrentHost) {
      lastEntityBroadcast = 0;
      if (previousHostId && previousHostId !== multiplayer.getId()) {
        multiplayer.sendTo(previousHostId, {
          type: 'entityStateRequest',
          requesterId: multiplayer.getId(),
          previousHostId
        });
      }
    }
  };
  multiplayer.onReady = async ({ roomId }) => {
    if (!roomId) {
      monstersSeeded = true;
      friendlyNpcManager?.onRoomReady({ roomId: null, isHost: multiplayer.isHost });
      return;
    }
    initMonsterPersistence({
      roomId,
      isHost: multiplayer.isHost,
      debug: window.DEBUG_MONSTER_PERSIST
    });
    isHost = !!multiplayer.isHost;
    setMonsterPersistenceHost(isHost);
    logMonsterPersist('isHost', isHost);
    monstersSeeded = false;
    friendlyNpcManager?.onRoomReady({ roomId, isHost: multiplayer.isHost });
    try {
      const snapshot = await loadMonstersSnapshot();
      const snapshotEntries = Object.entries(snapshot || {});
      snapshotEntries.forEach(([id, record]) => {
        applyMonsterRecord(record, id, { applyTransform: true });
      });
      monsterSnapshotLoaded = true;
      monstersSeeded = true;
      if (unsubscribeMonsterUpdates) {
        unsubscribeMonsterUpdates();
      }
      unsubscribeMonsterUpdates = subscribeMonsterUpdates(records => {
        Object.entries(records || {}).forEach(([id, record]) => {
          if (!record) return;
          if (!monsters.find(entry => entry.id === (record.id || id))) {
            applyMonsterRecord(record, id, { applyTransform: true });
          } else {
            applyMonsterRecord(record, id, { applyTransform: false });
          }
        });
      });
    } catch (err) {
      console.warn('Failed to load monster snapshot', err);
      monsterSnapshotLoaded = true;
      monstersSeeded = true;
    }
  };

  let iceGun;
  let bow;
  let autumnSword;
  let lantern;
  let treasureChest;

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.getElementById('game-container').appendChild(renderer.domElement);

  const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
  mapRenderer = createMapRenderer({ scene, renderer });
  buildingsRenderer = createBuildingsRenderer({ scene, camera, renderer });
  window.mapRenderer = mapRenderer;
  window.buildingsRenderer = buildingsRenderer;
  if (buildingsRenderer?.materials) {
    buildingMaterialBase = {
      extruded: captureMaterialBase(buildingsRenderer.materials.extruded),
      flat: captureMaterialBase(buildingsRenderer.materials.flat)
    };
  }
  if (pendingMapRebuild) {
    rebuildMapFromCache();
  }

  const handleResize = () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    mapRenderer.setResolution(window.innerWidth, window.innerHeight);
  };
  window.addEventListener('resize', handleResize);
  handleResize();

  ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
  scene.add(ambientLight);

  dirLight = new THREE.DirectionalLight(0xffffff, 1);
  dirLight.position.set(5, 10, 5);
  dirLight.castShadow = true;
  scene.add(dirLight);
  applyDisplaySettings();



  // --- RAPIER INIT ---
  await RAPIER.init();
  rapierWorld = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  window.rapierWorld = rapierWorld;
  window.rbToMesh = rbToMesh;

  // Ground collider
  {
    const groundRb = rapierWorld.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(0, -1, 0)
    );
    rapierWorld.createCollider(
      RAPIER.ColliderDesc.cuboid(200, 1, 200),
      groundRb
    );
  }

  // Prime with an initial distant wave

  const setPlayerWeaponType = (controls, weaponType) => {
    if (!controls?.playerModel) return;
    controls.playerModel.userData.equippedWeaponType = weaponType || null;
  };

  const clearPlayerWeaponType = (controls, weaponType) => {
    if (!controls?.playerModel) return;
    if (!weaponType || controls.playerModel.userData.equippedWeaponType === weaponType) {
      controls.playerModel.userData.equippedWeaponType = null;
    }
  };

  const updateRemoteWeaponType = (weapon, holderId, previousHolderId) => {
    const localId = multiplayer?.getId?.();
    if (previousHolderId && previousHolderId !== localId) {
      const previousHolder = otherPlayers[previousHolderId];
      if (previousHolder?.model?.userData?.equippedWeaponType === weapon.type) {
        previousHolder.model.userData.equippedWeaponType = null;
      }
    }
    if (holderId && holderId !== localId) {
      const nextHolder = otherPlayers[holderId];
      if (nextHolder?.model) {
        nextHolder.model.userData.equippedWeaponType = weapon.type;
      }
    }
  };

  const dropOtherWeapons = (activeWeapon) => {
    [iceGun, bow, autumnSword].forEach(weapon => {
      if (!weapon || weapon === activeWeapon) return;
      if (weapon.holder === playerControls) {
        weapon.drop({ removeFromInventory: true });
      }
    });
  };

  const createWeaponMarker = (color = 0xffd400) => {
    const geometry = new THREE.ConeGeometry(0.25, 0.5, 4);
    const material = new THREE.MeshStandardMaterial({ color });
    const marker = new THREE.Mesh(geometry, material);
    marker.rotation.x = Math.PI;
    marker.castShadow = false;
    marker.receiveShadow = false;
    marker.visible = false;
    scene.add(marker);
    return marker;
  };

  const droppedWeaponPickups = [];
  window.weaponPickups = droppedWeaponPickups;

  const updateWeaponMarker = (weapon, marker, rotationSpeed, offsetY = 1.2) => {
    if (!weapon?.mesh || !marker) return;
    const shouldShow = weapon.mesh.visible && !weapon.holder;
    marker.visible = shouldShow;
    if (!shouldShow) return;
    marker.position.copy(weapon.mesh.position);
    marker.position.y += offsetY;
    marker.rotation.y += rotationSpeed;
  };

  iceGun = new IceGun(scene);
  await iceGun.load();
  window.iceGun = iceGun;
  const iceGunMarker = createWeaponMarker(0xffd400);
  iceGun.onPickup = (holder) => {
    if (holder !== playerControls) return;
    if (lantern?.holder === playerControls) {
      iceGun.holder = null;
      return;
    }
    dropOtherWeapons(iceGun);
    addToInventory('iceGun', 1);
    setPlayerWeaponType(holder, iceGun.type);
    playerControls.updateAmmoUI?.(true);
    playerControls.setAmmo?.(
      inventoryState.iceGun?.[ICE_AMMO_KEY] ?? 0,
      getAmmoLabelForType('ammo'),
      getAmmoIconForType('ammo')
    );
  };
  iceGun.onDrop = (holder, { removeFromInventory: shouldRemoveFromInventory } = {}) => {
    if (holder !== playerControls) return;
    if (shouldRemoveFromInventory) {
      removeFromInventory('iceGun', 1);
    }
    clearPlayerWeaponType(holder, iceGun.type);
    playerControls?.updateAmmoUI?.(false);
  };
  if (iceGun.mesh) {
    iceGun.mesh.userData.hideInMapView = true;
    iceGun.mesh.visible = false;
  }
  registerNetworkedEntity('icegun', {
    getState: () => {
      if (!iceGun?.mesh) return null;
      const pos = iceGun.mesh.position;
      const q = iceGun.mesh.quaternion;
      return {
        position: [pos.x, pos.y, pos.z],
        rotation: [q.x, q.y, q.z, q.w],
        holderId: iceGun.holder === playerControls ? multiplayer?.getId?.() : null
      };
    },
    applyState: state => {
      if (!iceGun?.mesh || !state) return;
      const [px, py, pz] = state.position || [];
      const [rx, ry, rz, rw] = state.rotation || [];
      if (Number.isFinite(px) && Number.isFinite(py) && Number.isFinite(pz)) {
        iceGun.mesh.position.set(px, py, pz);
      }
      if (Number.isFinite(rx) && Number.isFinite(ry) && Number.isFinite(rz) && Number.isFinite(rw)) {
        iceGun.mesh.quaternion.set(rx, ry, rz, rw);
      }
      const previousHolderId = iceGun.remoteHolderId ?? null;
      iceGun.remoteHolderId = state.holderId ?? null;
      updateRemoteWeaponType(iceGun, iceGun.remoteHolderId, previousHolderId);
      if (state.holderId !== multiplayer?.getId?.() && iceGun.holder === playerControls) {
        iceGun.holder = null;
        clearPlayerWeaponType(playerControls, iceGun.type);
      }
    },
    isLocallyControlled: () => iceGun?.holder === playerControls
  });

  bow = new Bow(scene);
  await bow.load();
  window.bow = bow;
  await loadArrowTemplate();
  let bowHeldArrow = null;
  let bowHeldMesh = null;
  const ensureBowHeldMesh = () => {
    if (bowHeldMesh || !bow?.mesh) return bowHeldMesh;
    bowHeldMesh = bow.mesh.clone(true);
    bowHeldMesh.traverse(child => {
      if (!child.isMesh) return;
      child.castShadow = true;
      child.receiveShadow = true;
    });
    bowHeldMesh.visible = false;
    bowHeldMesh.userData.hideInMapView = true;
    scene.add(bowHeldMesh);
    bow.heldMesh = bowHeldMesh;
    return bowHeldMesh;
  };
  const ensureBowHeldArrow = () => {
    if (bowHeldArrow || !arrowTemplate) return bowHeldArrow;
    bowHeldArrow = cloneArrowMesh(arrowTemplate, 0.12);
    if (!bowHeldArrow) return null;
    bowHeldArrow.traverse(child => {
      if (!child.isMesh) return;
      child.castShadow = true;
      child.receiveShadow = true;
    });
    bowHeldArrow.visible = false;
    bowHeldArrow.userData.hideInMapView = true;
    return bowHeldArrow;
  };
  const attachBowHeldArrow = (targetMesh) => {
    const heldArrow = ensureBowHeldArrow();
    if (!heldArrow || !targetMesh) return;
    if (heldArrow.parent === targetMesh) return;
    heldArrow.parent?.remove(heldArrow);
    targetMesh.add(heldArrow);
    heldArrow.position.set(0, 0, 0);
    heldArrow.quaternion.identity();
  };
  const bowMarker = createWeaponMarker(0xffc26b);
  bow.onPickup = (holder) => {
    if (holder !== playerControls) return;
    unequipOtherInventoryItems('bow');
    bow.useHeldMeshWhenHeld = false;
    if (bowHeldMesh) {
      bowHeldMesh.visible = false;
    }
    addToInventory('bow', 1);
    setPlayerWeaponType(holder, bow.type);
    playerControls.updateAmmoUI?.(true);
    playerControls.setAmmo?.(
      inventoryState.bow?.[ARROW_AMMO_KEY] ?? 0,
      getAmmoLabelForType('arrow'),
      getAmmoIconForType('arrow')
    );
    attachBowHeldArrow(bow.mesh);
  };
  bow.onDrop = (holder, { removeFromInventory: shouldRemoveFromInventory } = {}) => {
    if (holder !== playerControls) return;
    if (shouldRemoveFromInventory) {
      removeFromInventory('bow', 1);
    }
    clearPlayerWeaponType(holder, bow.type);
    playerControls?.updateAmmoUI?.(false);
    playerControls?.setAiming?.(false);
    if (bowHeldArrow) {
      bowHeldArrow.visible = false;
    }
    bow.useHeldMeshWhenHeld = false;
    if (bowHeldMesh) {
      bowHeldMesh.visible = false;
    }
  };
  if (bow.mesh) {
    bow.mesh.userData.hideInMapView = true;
    bow.mesh.visible = false;
  }
  registerNetworkedEntity('bow', {
    getState: () => {
      if (!bow?.mesh) return null;
      const pos = bow.mesh.position;
      const q = bow.mesh.quaternion;
      return {
        position: [pos.x, pos.y, pos.z],
        rotation: [q.x, q.y, q.z, q.w],
        holderId: bow.holder === playerControls ? multiplayer?.getId?.() : null
      };
    },
    applyState: state => {
      if (!bow?.mesh || !state) return;
      const [px, py, pz] = state.position || [];
      const [rx, ry, rz, rw] = state.rotation || [];
      if (Number.isFinite(px) && Number.isFinite(py) && Number.isFinite(pz)) {
        bow.mesh.position.set(px, py, pz);
      }
      if (Number.isFinite(rx) && Number.isFinite(ry) && Number.isFinite(rz) && Number.isFinite(rw)) {
        bow.mesh.quaternion.set(rx, ry, rz, rw);
      }
      const previousHolderId = bow.remoteHolderId ?? null;
      bow.remoteHolderId = state.holderId ?? null;
      updateRemoteWeaponType(bow, bow.remoteHolderId, previousHolderId);
      if (state.holderId !== multiplayer?.getId?.() && bow.holder === playerControls) {
        bow.holder = null;
        clearPlayerWeaponType(playerControls, bow.type);
      }
    },
    isLocallyControlled: () => bow?.holder === playerControls
  });

  autumnSword = new AutumnSword(scene);
  await autumnSword.load();
  window.autumnSword = autumnSword;
  const autumnSwordMarker = createWeaponMarker(0xffd400);
  autumnSword.onPickup = (holder) => {
    if (holder !== playerControls) return;
    if (lantern?.holder === playerControls) {
      autumnSword.holder = null;
      return;
    }
    dropOtherWeapons(autumnSword);
    addToInventory('autumnSword', 1);
    setPlayerWeaponType(holder, autumnSword.type);
  };
  autumnSword.onDrop = (holder, { removeFromInventory: shouldRemoveFromInventory } = {}) => {
    if (holder !== playerControls) return;
    if (shouldRemoveFromInventory) {
      removeFromInventory('autumnSword', 1);
    }
    clearPlayerWeaponType(holder, autumnSword.type);
  };
  if (autumnSword.mesh) {
    autumnSword.mesh.userData.hideInMapView = true;
    autumnSword.mesh.visible = false;
  }
  registerNetworkedEntity('autumnsword', {
    getState: () => {
      if (!autumnSword?.mesh) return null;
      const pos = autumnSword.mesh.position;
      const q = autumnSword.mesh.quaternion;
      return {
        position: [pos.x, pos.y, pos.z],
        rotation: [q.x, q.y, q.z, q.w],
        holderId: autumnSword.holder === playerControls ? multiplayer?.getId?.() : null
      };
    },
    applyState: state => {
      if (!autumnSword?.mesh || !state) return;
      const [px, py, pz] = state.position || [];
      const [rx, ry, rz, rw] = state.rotation || [];
      if (Number.isFinite(px) && Number.isFinite(py) && Number.isFinite(pz)) {
        autumnSword.mesh.position.set(px, py, pz);
      }
      if (Number.isFinite(rx) && Number.isFinite(ry) && Number.isFinite(rz) && Number.isFinite(rw)) {
        autumnSword.mesh.quaternion.set(rx, ry, rz, rw);
      }
      const previousHolderId = autumnSword.remoteHolderId ?? null;
      autumnSword.remoteHolderId = state.holderId ?? null;
      updateRemoteWeaponType(autumnSword, autumnSword.remoteHolderId, previousHolderId);
      if (state.holderId !== multiplayer?.getId?.() && autumnSword.holder === playerControls) {
        autumnSword.holder = null;
        clearPlayerWeaponType(playerControls, autumnSword.type);
      }
    },
    isLocallyControlled: () => autumnSword?.holder === playerControls
  });

  window.weapons = { iceGun, bow, autumnSword };

  function attachMonsterPhysics(monster) {
    const model = monster.model;
    const scale = monster.sizeScale || 1;
    const rbDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(model.position.x, model.position.y, model.position.z)
      .setLinearDamping(0.5)
      .setAngularDamping(0.5);
    const rb = rapierWorld.createRigidBody(rbDesc);
    const colDesc = RAPIER.ColliderDesc.capsule(0.6 * scale, 0.3 * scale);
    rapierWorld.createCollider(colDesc, rb);
    model.userData.rb = rb;
    rbToMesh.set(rb, model);
  }

  const detachNpcPhysics = (npc) => {
    const body = npc?.body;
    if (body && rapierWorld?.getRigidBody(body.handle)) {
      rbToMesh.delete(body);
      rapierWorld.removeRigidBody(body);
    }
  };

  window.attachMonsterPhysics = attachMonsterPhysics;
  window.detachNpcPhysics = detachNpcPhysics;



  let player = new PlayerCharacter(playerName, characterModel);
  let playerModel = player.model;
  playerModel.userData.hideInMapView = true;
  scene.add(playerModel);
  window.playerModel = playerModel;
  lantern = new Lantern(scene);
  await lantern.load(playerModel.position.clone().add(new THREE.Vector3(2.5, 0, 2)));
  window.lantern = lantern;
  const lanternMarker = createWeaponMarker(0xffd400);
  lantern.onPickup = (holder) => {
    if (holder !== playerControls) return;
    addToInventory('lantern', 1);
  };
  lantern.onDrop = (holder, { removeFromInventory: shouldRemoveFromInventory } = {}) => {
    if (holder !== playerControls) return;
    if (shouldRemoveFromInventory) {
      removeFromInventory('lantern', 1);
    }
  };
  if (lantern.mesh) {
    lantern.mesh.userData.hideInMapView = true;
  }
  registerNetworkedEntity('lantern', {
    getState: () => {
      if (!lantern?.mesh) return null;
      const pos = lantern.mesh.position;
      const q = lantern.mesh.quaternion;
      return {
        position: [pos.x, pos.y, pos.z],
        rotation: [q.x, q.y, q.z, q.w],
        holderId: lantern.holder === playerControls ? multiplayer?.getId?.() : null
      };
    },
    applyState: state => {
      if (!lantern?.mesh || !state) return;
      const [px, py, pz] = state.position || [];
      const [rx, ry, rz, rw] = state.rotation || [];
      if (Number.isFinite(px) && Number.isFinite(py) && Number.isFinite(pz)) {
        lantern.mesh.position.set(px, py, pz);
      }
      if (Number.isFinite(rx) && Number.isFinite(ry) && Number.isFinite(rz) && Number.isFinite(rw)) {
        lantern.mesh.quaternion.set(rx, ry, rz, rw);
      }
      lantern.remoteHolderId = state.holderId ?? null;
      if (state.holderId !== multiplayer?.getId?.() && lantern.holder === playerControls) {
        lantern.holder = null;
      }
    },
    isLocallyControlled: () => lantern?.holder === playerControls
  });

  window.weapons = { iceGun, bow, autumnSword, lantern };
  treasureChest = new TreasureChest(scene);
  await treasureChest.load();
  window.treasureChest = treasureChest;
  if (treasureChest.mesh) {
    treasureChest.mesh.visible = false;
  }
  treasureChest.onOpen = (holder) => {
    if (holder !== playerControls) return;
    const rewards = [
      {
        label: '5 arrows',
        apply: () => {
          const current = Number.isFinite(inventoryState.bow?.[ARROW_AMMO_KEY])
            ? inventoryState.bow[ARROW_AMMO_KEY]
            : 0;
          setArrowAmmoCount(current + 5);
        }
      },
      {
        label: 'Autumn Sword',
        apply: () => addToInventory('autumnSword', 1)
      },
      {
        label: 'Bow',
        apply: () => addToInventory('bow', 1)
      },
      {
        label: 'Ice Gun',
        apply: () => addToInventory('iceGun', 1)
      },
      {
        label: 'Lantern',
        apply: () => addToInventory('lantern', 1)
      },
      {
        label: '5 ice ammo',
        apply: () => {
          const current = Number.isFinite(inventoryState.iceGun?.[ICE_AMMO_KEY])
            ? inventoryState.iceGun[ICE_AMMO_KEY]
            : 0;
          setIceAmmoCount(current + 5);
        }
      },
      {
        label: '5 mushrooms',
        apply: () => {
          const entry = MUSHROOM_ENTRIES[Math.floor(Math.random() * MUSHROOM_ENTRIES.length)];
          addToInventory(entry.id, 5);
        }
      },
      {
        label: '20 coins',
        apply: () => {
          const nextCoins = (Number.isFinite(statsState.coins) ? statsState.coins : 0) + 20;
          setStat('coins', nextCoins, { skipSave: true });
          showCoinPopup(statsState.coins);
        }
      }
    ];
    const reward = rewards[Math.floor(Math.random() * rewards.length)];
    reward?.apply?.();
    showTreasurePopup(`You received a ${reward?.label ?? 'treasure'}`);
  };
  const getTreeGeoForLocal = (position) => {
    if (!position) return null;
    const origin = worldOrigin
      ? { centerLat: worldOrigin.lat, centerLon: worldOrigin.lon }
      : currentRenderOrigin;
    if (!origin) return null;
    const lonScale = metersPerDegreeLon(origin.centerLat);
    return {
      lat: origin.centerLat + position.z / METERS_PER_DEGREE_LAT,
      lon: origin.centerLon - position.x / lonScale
    };
  };
  appleController = await createApples({
    scene,
    getTerrainHeight,
    allowDefaultPositions: false
  });
  applePickups = appleController?.pickups || [];
  window.applePickups = applePickups;
  natureController = await createNature({
    scene,
    playerModel,
    getTerrainHeight,
    mapRenderer,
    buildingsRenderer,
    getGeoForLocal: getTreeGeoForLocal,
    tileCache,
    spawnApplePickup: appleController?.spawnPickup,
    removeApplePickup: appleController?.removePickup
  });
  natureController?.update(playerModel?.position);
  await createCabin({ scene, getTerrainHeight });
  mushroomController = await createMushrooms({
    scene,
    getTerrainHeight,
    scatterCenter: playerModel?.position,
    scatterRadius: PICKUP_SPAWN_RADIUS
  });
  mushroomPickups = mushroomController?.pickups || [];
  window.mushroomPickups = mushroomPickups;
  let didInitialGpsSnap = false;

  const getRandomMonsterModel = () => {
    const index = Math.floor(Math.random() * MONSTER_MODELS.length);
    return MONSTER_MODELS[index];
  };

  const getRandomMonsterLevel = () => {
    const totalWeight = MONSTER_LEVEL_WEIGHTS.reduce((sum, entry) => sum + entry.weight, 0);
    let pick = Math.random() * totalWeight;
    for (const entry of MONSTER_LEVEL_WEIGHTS) {
      pick -= entry.weight;
      if (pick <= 0) {
        return entry.level;
      }
    }
    return MONSTER_LEVEL_WEIGHTS[0]?.level ?? 1;
  };

  const BUILDING_RAYCAST_HEIGHT = 200;
  const BUILDING_LIFT_EPSILON = 0.05;
  const buildingRaycaster = new THREE.Raycaster();
  const buildingRayDirection = new THREE.Vector3(0, -1, 0);

  const getBuildingIntersection = (position) => {
    const buildingsGroup = buildingsRenderer?.group;
    if (!buildingsGroup) return null;
    const terrainY = getTerrainHeight(position.x, position.z) ?? position.y;
    const rayOrigin = new THREE.Vector3(
      position.x,
      Math.max(position.y, terrainY) + BUILDING_RAYCAST_HEIGHT,
      position.z
    );
    buildingRaycaster.set(rayOrigin, buildingRayDirection);
    const intersections = buildingRaycaster.intersectObjects(buildingsGroup.children, true);
    for (const intersection of intersections) {
      if (intersection.object?.userData?.isBuildingSolid) {
        return intersection;
      }
    }
    return null;
  };

  const liftPositionToBuildingTop = (position, heightOffset = 0.6) => {
    const intersection = getBuildingIntersection(position);
    if (!intersection) return false;
    const targetY = intersection.point.y + heightOffset;
    if (targetY <= position.y + BUILDING_LIFT_EPSILON) return false;
    position.y = targetY;
    return true;
  };

  const liftMeshToBuildingTop = (mesh, heightOffset = 0.6) => {
    if (!mesh) return false;
    const lifted = liftPositionToBuildingTop(mesh.position, heightOffset);
    if (lifted) {
      mesh.userData.baseY = mesh.position.y;
    }
    return lifted;
  };

  window.lightSources = [];

  const liftMonsterToBuildingTop = (monster, heightOffset = 0.5) => {
    if (!monster?.model) return false;
    const lifted = liftPositionToBuildingTop(monster.model.position, heightOffset);
    if (lifted) {
      const body = monster.body;
      if (body) {
        body.setTranslation(
          { x: monster.model.position.x, y: monster.model.position.y, z: monster.model.position.z },
          true
        );
      }
    }
    return lifted;
  };

  friendlyNpcManager = createFriendlyNpcManager({
    scene,
    playerModel,
    otherPlayers,
    attachPhysics: attachMonsterPhysics,
    detachPhysics: detachNpcPhysics,
    getTerrainHeight,
    liftPositionToBuildingTop,
    isHost,
    debug: window.DEBUG_FRIENDLY_PERSIST
  });
  if (multiplayer?.roomId) {
    friendlyNpcManager.onRoomReady({ roomId: multiplayer.roomId, isHost: multiplayer.isHost });
  }

  const liftPlayerToBuildingTop = (heightOffset = 0.6) => {
    if (!playerModel) return false;
    const lifted = liftPositionToBuildingTop(playerModel.position, heightOffset);
    if (lifted && playerControls?.body) {
      playerControls.body.setTranslation(
        { x: playerModel.position.x, y: playerModel.position.y, z: playerModel.position.z },
        true
      );
      playerControls.playerX = playerModel.position.x;
      playerControls.playerY = playerModel.position.y;
      playerControls.playerZ = playerModel.position.z;
      playerControls.lastPosition.copy(playerModel.position);
    }
    return lifted;
  };

  const liftPickupsToBuildingTop = () => {
    ammoPickups.forEach(pickup => liftMeshToBuildingTop(pickup, 0.6));
    droppedAmmoPickups.forEach(entry => liftMeshToBuildingTop(entry?.mesh, 0.6));
    foodPickups.forEach(pickup => liftMeshToBuildingTop(pickup, 0.6));
    healthPickups.forEach(pickup => liftMeshToBuildingTop(pickup, 0.6));
    coinPickups.forEach(pickup => liftMeshToBuildingTop(pickup, 0.6));
    if (!iceGun?.holder) {
      liftMeshToBuildingTop(iceGun?.mesh, 0.5);
    }
    if (!autumnSword?.holder) {
      liftMeshToBuildingTop(autumnSword?.mesh, 0.5);
    }
    if (!lantern?.holder) {
      liftMeshToBuildingTop(lantern?.mesh, 0.3);
    }
  };

  const liftEntitiesToBuildingTop = () => {
    liftPlayerToBuildingTop(0.6);
    monsters.forEach(monster => liftMonsterToBuildingTop(monster, 0.5));
    Object.values(otherPlayers).forEach(entry => {
      if (!entry?.model) return;
      liftPositionToBuildingTop(entry.model.position, 0.6);
    });
    liftPickupsToBuildingTop();
  };

  let buildingColliderBody = null;
  const rebuildBuildingColliders = () => {
    if (!rapierWorld) return;

    if (buildingColliderBody && rapierWorld.getRigidBody(buildingColliderBody.handle)) {
      rapierWorld.removeRigidBody(buildingColliderBody);
      buildingColliderBody = null;
    }

    const meshes = buildingsRenderer?.getCollisionMeshes?.() ?? [];
    if (!meshes.length) return;

    // ensure transforms are current
    for (const m of meshes) m.updateMatrixWorld(true);

    const allVerts = [];
    const allIndices = [];
    let vertOffset = 0;
    const tmpV = new THREE.Vector3();

    for (const obj of meshes) {
      if (!obj?.isMesh) continue;
      const geom = obj.geometry;
      const posAttr = geom?.attributes?.position;
      if (!posAttr || posAttr.count === 0) continue;

      // verts
      for (let i = 0; i < posAttr.count; i++) {
        tmpV.fromBufferAttribute(posAttr, i).applyMatrix4(obj.matrixWorld);
        allVerts.push(tmpV.x, tmpV.y, tmpV.z);
      }

      // indices
      const indexAttr = geom.index;
      if (indexAttr?.array?.length) {
        const idx = indexAttr.array;
        for (let i = 0; i < idx.length; i++) allIndices.push(vertOffset + idx[i]);
      } else {
        if (posAttr.count % 3 !== 0) continue; // not triangles
        for (let i = 0; i < posAttr.count; i += 3) {
          allIndices.push(vertOffset + i, vertOffset + i + 1, vertOffset + i + 2);
        }
      }

      vertOffset += posAttr.count;
    }

    if (allVerts.length === 0 || allIndices.length === 0) return;

    const vertices = new Float32Array(allVerts);
    const indices = new Uint32Array(allIndices);

    const rbDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(0, 0, 0);
    buildingColliderBody = rapierWorld.createRigidBody(rbDesc);

    const colDesc = RAPIER.ColliderDesc.trimesh(vertices, indices)
      .setRestitution(0)
      .setFriction(1);

    const collider = rapierWorld.createCollider(colDesc, buildingColliderBody);
    console.log('building collider created', String(collider.handle), 'verts', vertices.length / 3, 'idx', indices.length);
  };
  window.rebuildBuildingColliders = rebuildBuildingColliders;



  const getMonsterSpawnPosition = () => {
    for (let attempt = 0; attempt < MONSTER_SPAWN_ATTEMPTS; attempt += 1) {
      const angle = Math.random() * Math.PI * 2;
      const radius = THREE.MathUtils.randFloat(MONSTER_SPAWN_MIN_RADIUS, MONSTER_SPAWN_MAX_RADIUS);
      const spawnPos = new THREE.Vector3(
        playerModel.position.x + Math.cos(angle) * radius,
        0,
        playerModel.position.z + Math.sin(angle) * radius
      );
      const terrainHeight = getTerrainHeight(spawnPos.x, spawnPos.z);
      spawnPos.y = Number.isFinite(terrainHeight) ? terrainHeight + 0.5 : 0.5;
      if (spawnPos.distanceTo(playerModel.position) < MONSTER_SPAWN_MIN_RADIUS) {
        continue;
      }
      liftPositionToBuildingTop(spawnPos, 0.5);
      return spawnPos;
    }
    const fallback = playerModel.position.clone();
    fallback.x += MONSTER_SPAWN_MIN_RADIUS;
    fallback.y = getTerrainHeight(fallback.x, fallback.z) + 0.5;
    return fallback;
  };

  const disposeWeaponMesh = (mesh) => {
    if (!mesh) return;
    if (mesh.parent) {
      mesh.parent.remove(mesh);
    }
    mesh.traverse(child => {
      if (!child.isMesh) return;
      if (child.geometry) {
        child.geometry.dispose();
      }
      const materials = Array.isArray(child.material)
        ? child.material
        : [child.material];
      materials.forEach(material => material?.dispose?.());
    });
  };

  const disposeSceneObject = (object) => {
    if (!object) return;
    if (object.parent) {
      object.parent.remove(object);
    }
    object.traverse(child => {
      if (!child.isMesh) return;
      child.geometry?.dispose?.();
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.forEach(material => material?.dispose?.());
    });
  };

  const loadMonsterSwordTemplate = async () => {
    if (monsterSwordTemplate) return monsterSwordTemplate;
    if (!monsterSwordTemplatePromise) {
      const loader = new GLTFLoader();
      monsterSwordTemplatePromise = loader.loadAsync(MONSTER_SWORD_MODEL_URL)
        .then(gltf => {
          monsterSwordTemplate = gltf.scene;
          return monsterSwordTemplate;
        })
        .catch(error => {
          console.warn('Failed to load monster sword model.', error);
          monsterSwordTemplate = null;
          return null;
        })
        .finally(() => {
          monsterSwordTemplatePromise = null;
        });
    }
    return monsterSwordTemplatePromise;
  };

  const cloneMonsterSwordMesh = (template) => {
    if (!template) return null;
    const swordMesh = template.clone(true);
    swordMesh.traverse(child => {
      if (!child.isMesh) return;
      child.geometry = child.geometry?.clone?.() ?? child.geometry;
      if (Array.isArray(child.material)) {
        child.material = child.material.map(material => material?.clone?.() ?? material);
      } else {
        child.material = child.material?.clone?.() ?? child.material;
      }
      child.castShadow = true;
      child.receiveShadow = true;
    });
    swordMesh.scale.setScalar(MONSTER_SWORD_SCALE);
    return swordMesh;
  };

  async function loadArrowTemplate() {
    if (arrowTemplate) return arrowTemplate;
    if (!arrowTemplatePromise) {
      const loader = new GLTFLoader();
      arrowTemplatePromise = loader.loadAsync(ARROW_MODEL_URL)
        .then(gltf => {
          arrowTemplate = gltf.scene;
          return arrowTemplate;
        })
        .catch(error => {
          console.warn('Failed to load arrow model.', error);
          arrowTemplate = null;
          return null;
        })
        .finally(() => {
          arrowTemplatePromise = null;
        });
    }
    return arrowTemplatePromise;
  }

  function cloneArrowMesh(template, scale = ARROW_PROJECTILE_SCALE) {
    if (!template) return null;
    const arrowMesh = template.clone(true);
    arrowMesh.traverse(child => {
      if (!child.isMesh) return;
      child.geometry = child.geometry?.clone?.() ?? child.geometry;
      if (Array.isArray(child.material)) {
        child.material = child.material.map(material => material?.clone?.() ?? material);
      } else {
        child.material = child.material?.clone?.() ?? child.material;
      }
      child.castShadow = true;
      child.receiveShadow = true;
    });
    arrowMesh.scale.setScalar(scale);
    return arrowMesh;
  }

  function cleanupMonster(monster) {
    if (!monster) return;
    monster.model?.userData?.mixer?.stopAllAction?.();
    if (monster.weaponMesh) {
      disposeWeaponMesh(monster.weaponMesh);
      monster.weaponMesh = null;
      monster.weaponType = null;
      monster.weaponBaseScale = null;
    }
    if (monster.model?.userData?.equippedWeaponType) {
      monster.model.userData.equippedWeaponType = null;
    }
    if (monster.model?.parent) {
      monster.model.parent.remove(monster.model);
    }
    const body = monster.body;
    if (body && rapierWorld?.getRigidBody(body.handle)) {
      rbToMesh.delete(body);
      rapierWorld.removeRigidBody(body);
    }
    if (monster.model?.userData?.rb) {
      monster.model.userData.rb = null;
    }
    monster.model = null;
  };

  function setMonsterForSlot(slotId, monster) {
    const existingIndex = monsters.findIndex(entry => entry.id === slotId);
    if (existingIndex >= 0) {
      monsters[existingIndex] = monster;
    } else {
      monsters.push(monster);
    }
  };

  function spawnMonsterInSlot(slotId, modelPath, oldMonster = null, options = {}) {
    if (PERF.disableMonsters) return;
    if (spawningSlots.has(slotId)) return;
    spawningSlots.add(slotId);
    loadMonsterModel(modelPath, data => {
      try {
        const monster = new MonsterCharacter(data);
        monster.id = slotId;
        monster.modelPath = modelPath;
        monster.type = options.type ?? modelPath;
        if (Number.isFinite(options.version)) {
          monster.version = options.version;
        }
        monster.model.userData.hideInMapView = true;
        monster.setMode("friendly");
        monster.setDirection(new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5).normalize());
        monster.lastDirectionChange = Date.now();
        monster.lastAIUpdateMs = 0;
        const level = Number.isFinite(options.level) ? options.level : getRandomMonsterLevel();
        monster.setLevel(level, { preserveHealth: false });
        monster.resetHealth();

        if (Number.isFinite(options.health)) {
          monster.health = options.health;
          monster.model.userData.health = options.health;
        }
        if (options.alive === false || (Number.isFinite(options.health) && options.health <= 0)) {
          monster.markDead();
        }

        const spawnPos = options.position
          && Number.isFinite(options.position.x)
          && Number.isFinite(options.position.y)
          && Number.isFinite(options.position.z)
          ? options.position
          : getMonsterSpawnPosition();
        monster.setPosition(spawnPos.x, spawnPos.y, spawnPos.z);

        cleanupMonster(oldMonster);
        scene.add(monster.model);
        if (modelPath === "/models/rainbow_troll.fbx") {
          const attachSwordToMonster = async () => {
            try {
              const template = await loadMonsterSwordTemplate();
              const swordMesh = cloneMonsterSwordMesh(template);
              if (!swordMesh) return;
              if (!monster.model) {
                disposeWeaponMesh(swordMesh);
                return;
              }
              const root = monster.model.userData?.pivot ?? monster.model;
              let handBone = null;
              root.traverse(child => {
                if (handBone || !child.isBone || !child.name) return;
                const name = child.name.toLowerCase();
                if (name.includes('righthand')) {
                  handBone = child;
                }
              });
              if (!handBone) {
                root.traverse(child => {
                  if (handBone || !child.isBone || !child.name) return;
                  if (child.name.toLowerCase().includes('hand')) {
                    handBone = child;
                  }
                });
              }
              if (handBone) {
                handBone.add(swordMesh);
              } else {
                monster.model.add(swordMesh);
              }
              swordMesh.position.copy(MONSTER_SWORD_HOLD_OFFSET);
              swordMesh.quaternion.copy(MONSTER_SWORD_HOLD_QUATERNION);
              monster.weaponType = "sword";
              monster.weaponMesh = swordMesh;
              monster.weaponBaseScale = swordMesh.scale.clone();
              monster.model.userData.equippedWeaponType = "sword";
            } catch (error) {
              console.warn('Failed to attach autumn sword to monster.', error);
            }
          };
          attachSwordToMonster();
        }
        if (rapierWorld) {
          attachMonsterPhysics(monster);
        }
        if (options.rotation
          && Number.isFinite(options.rotation.x)
          && Number.isFinite(options.rotation.y)
          && Number.isFinite(options.rotation.z)
          && Number.isFinite(options.rotation.w)) {
          monster.model.quaternion.set(options.rotation.x, options.rotation.y, options.rotation.z, options.rotation.w);
          monster.body?.setRotation(options.rotation, true);
        }
        setMonsterForSlot(slotId, monster);
        if (isHost && monsterSnapshotLoaded && !options.skipPersist) {
          ensureMonsterRecord(monster);
        }
      } finally {
        spawningSlots.delete(slotId);
      }
    });
  };

  function applyMonsterRecord(record, recordId, { applyTransform = false } = {}) {
    if (!record) return;
    const slotId = record.id || recordId;
    if (!slotId) return;

    const incomingVersion = Number.isFinite(record.version) ? record.version : null;
    const existing = monsters.find(entry => entry.id === slotId);
    const existingVersion = Number.isFinite(existing?.version) ? existing.version : -Infinity;

    if (incomingVersion != null && incomingVersion < existingVersion) return;

    const modelPath = record.type || record.modelPath || existing?.modelPath;
    if (!modelPath) return;

    const needsSpawn = !existing || existing.modelPath !== modelPath;
    const rotation = applyTransform ? record.rot : null;
    const position = applyTransform ? record.pos : null;

    if (needsSpawn) {
      if (!existing || (incomingVersion != null && incomingVersion > existingVersion)) {
        spawnMonsterInSlot(slotId, modelPath, existing, {
          position,
          rotation,
          health: record.hp,
          alive: record.alive,
          level: record.level,
          version: incomingVersion,
          type: record.type,
          skipPersist: true
        });
      }
      return;
    }

    if (!existing?.model) return;

    if (Number.isFinite(record.level)) {
      existing.setLevel(record.level, { preserveHealth: true });
    }

    if (position && Number.isFinite(position.x) && Number.isFinite(position.y) && Number.isFinite(position.z)) {
      existing.model.position.set(position.x, position.y, position.z);
      existing.body?.setTranslation({ x: position.x, y: position.y, z: position.z }, true);
    }

    if (rotation && Number.isFinite(rotation.x) && Number.isFinite(rotation.y) && Number.isFinite(rotation.z) && Number.isFinite(rotation.w)) {
      existing.model.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
      existing.body?.setRotation(rotation, true);
    }

    existing.applyPersistedState?.({
      hp: record.hp,
      alive: record.alive,
      level: record.level,
      version: incomingVersion
    });
  }


  const ensureMonsters = () => {
    if (PERF.disableMonsters) {
      monsters.forEach(monster => cleanupMonster(monster));
      monsters = [];
      window.monsters = monsters;
      respawnTimers.forEach((timer) => clearTimeout(timer));
      respawnTimers.clear();
      return;
    }
    const seenSlots = new Set();
    monsters = monsters.filter((monster) => {
      if (!monster) return false;
      if (!monsterSlotIds.includes(monster.id)) {
        cleanupMonster(monster);
        return false;
      }
      if (seenSlots.has(monster.id)) {
        cleanupMonster(monster);
        return false;
      }
      seenSlots.add(monster.id);
      return true;
    });
    window.monsters = monsters;

    monsterSlotIds.forEach((slotId) => {
      const existing = monsters.find(entry => entry.id === slotId);
      if (!existing && !spawningSlots.has(slotId) && !respawnTimers.has(slotId)) {
        spawnMonsterInSlot(slotId, getRandomMonsterModel());
      }
    });
  };

  monsterSlotIds.forEach((slotId) => {
    registerNetworkedEntity(slotId, {
      getState: () => {
        const monster = monsters.find(entry => entry.id === slotId);
        if (!monster) return null;
        try {
          if (!monster.model) return null;
        }
        catch {
          return null;
        }
        const pos = monster.model.position;
        const q = monster.model.quaternion;
        return {
          position: [pos.x, pos.y, pos.z],
          rotation: [q.x, q.y, q.z, q.w],
          mode: monster.model.userData.mode,
          action: monster.model.userData.currentAction,
          health: monster.model.userData.health,
          level: monster.level,
          modelPath: monster.modelPath,
          version: monster.version
        };
      },
      applyState: state => {
        if (!state) return;
        const [px, py, pz] = state.position || [];
        const [rx, ry, rz, rw] = state.rotation || [];
        const current = monsters.find(entry => entry.id === slotId);
        const currentVersion = Number.isFinite(current?.version) ? current.version : -Infinity;
        const incomingVersion = Number.isFinite(state.version) ? state.version : null;
        if (incomingVersion != null && incomingVersion < currentVersion) {
          return;
        }
        if (state.modelPath && (!current || current.modelPath !== state.modelPath)) {
          if (!current || (incomingVersion != null && incomingVersion > currentVersion)) {
            spawnMonsterInSlot(slotId, state.modelPath, current, {
              level: state.level,
              version: incomingVersion,
              type: state.modelPath,
              skipPersist: true
            });
          }
          return;
        }
        const monster = monsters.find(entry => entry.id === slotId);
        if (!monster?.model) return;
        if (Number.isFinite(state.level)) {
          monster.setLevel(state.level, { preserveHealth: true });
        }
        if (Number.isFinite(px) && Number.isFinite(py) && Number.isFinite(pz)) {
          monster.model.position.set(px, py, pz);
          monster.body?.setTranslation({ x: px, y: py, z: pz }, true);
        }
        if (Number.isFinite(rx) && Number.isFinite(ry) && Number.isFinite(rz) && Number.isFinite(rw)) {
          monster.model.quaternion.set(rx, ry, rz, rw);
          monster.body?.setRotation({ x: rx, y: ry, z: rz, w: rw }, true);
        }
        if (typeof state.mode === 'string') {
          monster.model.userData.mode = state.mode;
        }
        if (typeof state.health === 'number') {
          monster.health = state.health;
          monster.model.userData.health = state.health;
        }
        const aliveFlag = typeof state.mode === 'string' ? state.mode !== 'dead' : undefined;
        monster.applyPersistedState?.({
          hp: state.health,
          alive: aliveFlag,
          level: state.level,
          version: incomingVersion
        });
        if (state.action && monster.model.userData.currentAction !== state.action) {
          const fade = state.action === 'Weapon' ? 0.1 : 0.2;
          monster.playAnimation(state.action, fade);
        }
      },
      isLocallyControlled: () => multiplayer?.isHost && monsters.some(entry => entry.id === slotId)
    });
  });


  function applyOfflineHungerDecay(profile) {
    const now = Date.now();
    const lastUpdate = Number.isFinite(profile?.lastStatUpdateAt) ? profile.lastStatUpdateAt : now;
    const elapsedSeconds = Math.max(0, (now - lastUpdate) / 1000);
    const hungerDecay = HUNGER_DECAY_PER_HOUR * (elapsedSeconds / 3600);
    const currentHunger = Number.isFinite(profile?.stats?.hunger) ? profile.stats.hunger : 0;
    const nextHunger = Math.max(0, Math.min(100, currentHunger - hungerDecay));
    const updatedStats = { ...profile.stats, hunger: nextHunger };
    const changed = nextHunger !== currentHunger || !Number.isFinite(profile?.lastStatUpdateAt);
    return {
      stats: updatedStats,
      lastStatUpdateAt: now,
      changed
    };
  }

  const offlineDecay = applyOfflineHungerDecay(playerProfile);
  playerProfile.stats = offlineDecay.stats;
  let lastStatUpdateAt = offlineDecay.lastStatUpdateAt;

  const statsState = {
    health: playerProfile.stats.health,
    hunger: playerProfile.stats.hunger,
    energy: playerProfile.stats.energy,
    level: playerProfile.stats.level,
    strength: playerProfile.stats.strength,
    agility: playerProfile.stats.agility,
    smarts: playerProfile.stats.smarts,
    charm: playerProfile.stats.charm,
    luck: playerProfile.stats.luck,
    levelKills: playerProfile.stats.levelKills,
    coins: playerProfile.stats.coins
  };
  const STAT_KEYS_FOR_LEVEL = ['health', 'hunger', 'energy', 'strength', 'agility', 'smarts', 'charm', 'luck'];
  const playerNameDisplay = document.getElementById('player-name-display');
  const playerLevelDisplay = document.getElementById('player-level');
  const levelPopup = document.getElementById('level-popup');
  const ammoPopup = document.getElementById('ammo-popup');
  const coinPopup = document.getElementById('coin-popup');
  const treasurePopup = document.getElementById('treasure-popup');
  let levelPopupTimer = null;
  let ammoPopupTimer = null;
  let coinPopupTimer = null;
  let treasurePopupTimer = null;
  updatePlayerInfoUI = () => {
    if (playerNameDisplay) {
      playerNameDisplay.textContent = playerName;
    }
    if (playerLevelDisplay) {
      const levelValue = Number.isFinite(statsState.level) ? statsState.level : 1;
      playerLevelDisplay.textContent = levelValue;
    }
  };
  updatePlayerInfoUI();
  const showLevelPopup = level => {
    if (!levelPopup) return;
    levelPopup.textContent = `You've reached level ${level}!`;
    levelPopup.classList.add('visible');
    if (levelPopupTimer) {
      clearTimeout(levelPopupTimer);
    }
    levelPopupTimer = setTimeout(() => {
      levelPopup.classList.remove('visible');
      levelPopupTimer = null;
    }, 2200);
  };
  const showAmmoPopup = (ammoCount, label) => {
    if (!ammoPopup) return;
    const displayCount = Number.isFinite(ammoCount) ? Math.max(0, Math.floor(ammoCount)) : 0;
    const safeLabel = label || 'Ammo';
    ammoPopup.textContent = `${safeLabel}: ${displayCount}`;
    ammoPopup.classList.add('visible');
    if (ammoPopupTimer) {
      clearTimeout(ammoPopupTimer);
    }
    ammoPopupTimer = setTimeout(() => {
      ammoPopup.classList.remove('visible');
      ammoPopupTimer = null;
    }, 1600);
  };
  const showCoinPopup = totalCoins => {
    if (!coinPopup) return;
    const displayCount = Number.isFinite(totalCoins) ? Math.max(0, Math.floor(totalCoins)) : 0;
    coinPopup.textContent = `Coins: ${displayCount}`;
    coinPopup.classList.add('visible');
    if (coinPopupTimer) {
      clearTimeout(coinPopupTimer);
    }
    coinPopupTimer = setTimeout(() => {
      coinPopup.classList.remove('visible');
      coinPopupTimer = null;
    }, 1600);
  };
  const showTreasurePopup = (message) => {
    if (!treasurePopup) return;
    treasurePopup.textContent = message;
    treasurePopup.classList.add('visible');
    if (treasurePopupTimer) {
      clearTimeout(treasurePopupTimer);
    }
    treasurePopupTimer = setTimeout(() => {
      treasurePopup.classList.remove('visible');
      treasurePopupTimer = null;
    }, 2000);
  };
  const inventoryCatalog = {
    iceGun: {
      name: 'Ice Gun',
      icon: '/assets/ui/items/icegun.png'
    },
    bow: {
      name: 'Bow',
      icon: ''
    },
    autumnSword: {
      name: 'Autumn Sword',
      icon: ''
    },
    lantern: {
      name: 'Lantern',
      icon: ''
    }
  };
  inventoryCatalog[APPLE_ITEM_ID] = {
    name: 'Apple',
    icon: ''
  };
  MUSHROOM_ENTRIES.forEach((entry) => {
    inventoryCatalog[entry.id] = {
      name: entry.name,
      icon: ''
    };
  });
  const ensureCatalogEntry = (itemId, entry) => {
    const itemConfig = inventoryCatalog[itemId] || {};
    return {
      ...entry,
      icon: entry?.icon || itemConfig.icon || '',
      name: entry?.name || itemConfig.name || itemId
    };
  };
  const inventoryState = { ...(playerProfile.inventory || {}) };
  const homeStorageState = { ...(playerProfile.homeStorage || {}) };
  let inventoryDirty = false;
  let homeStorageDirty = false;
  Object.entries(inventoryState).forEach(([itemId, entry]) => {
    const nextEntry = ensureCatalogEntry(itemId, entry);
    if (nextEntry.name !== entry?.name || nextEntry.icon !== entry?.icon) {
      inventoryDirty = true;
    }
    inventoryState[itemId] = nextEntry;
  });
  Object.entries(homeStorageState).forEach(([itemId, entry]) => {
    const nextEntry = ensureCatalogEntry(itemId, entry);
    if (nextEntry.name !== entry?.name || nextEntry.icon !== entry?.icon) {
      homeStorageDirty = true;
    }
    homeStorageState[itemId] = nextEntry;
  });
  if (!Number.isFinite(inventoryState.iceGun?.[ICE_AMMO_KEY])) {
    const iceGunEntry = inventoryState.iceGun || {};
    inventoryState.iceGun = {
      ...iceGunEntry,
      [ICE_AMMO_KEY]: DEFAULT_ICE_AMMO,
      icon: iceGunEntry.icon || inventoryCatalog.iceGun.icon,
      name: iceGunEntry.name || inventoryCatalog.iceGun.name
    };
    inventoryDirty = true;
  }
  if (!Number.isFinite(inventoryState.bow?.[ARROW_AMMO_KEY])) {
    const bowEntry = inventoryState.bow || {};
    inventoryState.bow = {
      ...bowEntry,
      [ARROW_AMMO_KEY]: DEFAULT_ARROW_AMMO,
      icon: bowEntry.icon || inventoryCatalog.bow.icon,
      name: bowEntry.name || inventoryCatalog.bow.name
    };
    inventoryDirty = true;
  }
  if (inventoryDirty || homeStorageDirty) {
    saveStatsThrottled(profileNameKey, statsState, lastStatUpdateAt, inventoryState, homeStorageState);
  }

  const equippableItems = new Set(['lantern', 'iceGun', 'bow', 'autumnSword']);
  const isMushroomItem = (itemId) => mushroomItemIds.has(itemId);
  const isAppleItem = (itemId) => appleItemIds.has(itemId);
  const isFoodItem = (itemId) => isMushroomItem(itemId) || isAppleItem(itemId);
  const getInventoryItemActions = (itemId) => {
    if (isFoodItem(itemId)) {
      return ['drop', 'eat'];
    }
    if (equippableItems.has(itemId)) {
      return ['drop', 'equip'];
    }
    return ['drop'];
  };

  function getInventory() {
    return inventoryState;
  }

  function getHomeStorage() {
    return homeStorageState;
  }

  function persistInventoryAndStorage() {
    saveStatsThrottled(profileNameKey, statsState, lastStatUpdateAt, inventoryState, homeStorageState);
    updateSettingsUI();
    updateHomeStorageUI();
  }

  function setIceAmmoCount(amount) {
    if (!Number.isFinite(amount)) return;
    const normalized = Math.max(0, Math.floor(amount));
    const current = inventoryState.iceGun || {};
    inventoryState.iceGun = {
      ...current,
      [ICE_AMMO_KEY]: normalized,
      icon: current.icon || inventoryCatalog.iceGun.icon,
      name: current.name || inventoryCatalog.iceGun.name
    };
    persistInventoryAndStorage();
  }

  function setArrowAmmoCount(amount) {
    if (!Number.isFinite(amount)) return;
    const normalized = Math.max(0, Math.floor(amount));
    const current = inventoryState.bow || {};
    inventoryState.bow = {
      ...current,
      [ARROW_AMMO_KEY]: normalized,
      icon: current.icon || inventoryCatalog.bow.icon,
      name: current.name || inventoryCatalog.bow.name
    };
    persistInventoryAndStorage();
  }

  function addToInventory(itemId, amount = 1) {
    if (!itemId || !Number.isFinite(amount) || amount <= 0) return;
    const current = inventoryState[itemId];
    const nextCount = (current?.count || 0) + amount;
    inventoryState[itemId] = ensureCatalogEntry(itemId, { ...current, count: nextCount });
    if (window.DEBUG_INVENTORY) {
      console.log('[inventory] added', itemId, amount, inventoryState[itemId]);
    }
    persistInventoryAndStorage();
  }

  function removeFromInventory(itemId, amount = 1) {
    if (!itemId || !Number.isFinite(amount) || amount <= 0) return;
    const current = inventoryState[itemId];
    if (!current) return;
    const nextCount = current.count - amount;
    if (nextCount > 0) {
      inventoryState[itemId] = { ...current, count: nextCount };
    } else {
      if (itemId === 'iceGun' && Number.isFinite(current?.[ICE_AMMO_KEY])) {
        const { count, ...rest } = current;
        inventoryState[itemId] = rest;
      } else if (itemId === 'bow' && Number.isFinite(current?.[ARROW_AMMO_KEY])) {
        const { count, ...rest } = current;
        inventoryState[itemId] = rest;
      } else {
        delete inventoryState[itemId];
      }
    }
    if (window.DEBUG_INVENTORY) {
      console.log('[inventory] removed', itemId, amount, inventoryState[itemId]);
    }
    persistInventoryAndStorage();
  }

  function storeHomeStorageItem(itemId) {
    if (!itemId) return;
    const current = inventoryState[itemId];
    if (!current || !current.count) return;

    const nextCount = current.count - 1;
    if (nextCount > 0) {
      inventoryState[itemId] = { ...current, count: nextCount };
    } else {
      if (isInventoryItemEquipped(itemId)) {
        unequipInventoryItem(itemId);
      }
      delete inventoryState[itemId];
    }

    const existingStorage = homeStorageState[itemId];
    const storageCount = (existingStorage?.count || 0) + 1;
    homeStorageState[itemId] = ensureCatalogEntry(itemId, {
      ...existingStorage,
      ...current,
      count: storageCount
    });

    persistInventoryAndStorage();
  }

  function takeOutHomeStorageItem(itemId) {
    if (!itemId) return;
    const current = homeStorageState[itemId];
    if (!current || !current.count) return;

    const nextStorageCount = current.count - 1;
    if (nextStorageCount > 0) {
      homeStorageState[itemId] = { ...current, count: nextStorageCount };
    } else {
      delete homeStorageState[itemId];
    }

    const inventoryEntry = inventoryState[itemId] || {};
    const nextInventoryCount = (inventoryEntry.count || 0) + 1;
    const mergedEntry = ensureCatalogEntry(itemId, {
      ...inventoryEntry,
      ...current,
      count: nextInventoryCount
    });
    inventoryState[itemId] = mergedEntry;

    persistInventoryAndStorage();
  }

  function isInventoryItemEquipped(itemId) {
    if (itemId === 'lantern') {
      return lantern?.holder === playerControls;
    }
    if (itemId === 'iceGun') {
      return iceGun?.holder === playerControls;
    }
    if (itemId === 'bow') {
      return bow?.holder === playerControls;
    }
    if (itemId === 'autumnSword') {
      return autumnSword?.holder === playerControls;
    }
    return false;
  }

  function getEquippedInventoryItemId() {
    if (isInventoryItemEquipped('lantern')) return 'lantern';
    if (isInventoryItemEquipped('iceGun')) return 'iceGun';
    if (isInventoryItemEquipped('bow')) return 'bow';
    if (isInventoryItemEquipped('autumnSword')) return 'autumnSword';
    return null;
  }

  function unequipOtherInventoryItems(nextItemId) {
    const equippedId = getEquippedInventoryItemId();
    if (equippedId && equippedId !== nextItemId) {
      unequipInventoryItem(equippedId);
    }
  }

  function equipInventoryItem(itemId) {
    if (!itemId || !inventoryState[itemId]) return;
    unequipOtherInventoryItems(itemId);
    if (itemId === 'lantern') {
      if (!lantern?.mesh || !playerControls) return;
      if (lantern.remoteHolderId && lantern.remoteHolderId !== multiplayer?.getId?.()) return;
      lantern.mesh.visible = true;
      lantern.holder = playerControls;
      updateSettingsUI();
      return;
    }
    if (itemId === 'iceGun') {
      if (!iceGun?.mesh || !playerControls) return;
      if (iceGun.remoteHolderId && iceGun.remoteHolderId !== multiplayer?.getId?.()) return;
      iceGun.mesh.visible = true;
      iceGun.holder = playerControls;
      setPlayerWeaponType(playerControls, iceGun.type);
      playerControls.updateAmmoUI?.(true);
      playerControls.setAmmo?.(
        inventoryState.iceGun?.[ICE_AMMO_KEY] ?? 0,
        getAmmoLabelForType('ammo'),
        getAmmoIconForType('ammo')
      );
      updateSettingsUI();
      return;
    }
    if (itemId === 'bow') {
      if (!bow?.mesh || !playerControls) return;
      if (bow.remoteHolderId && bow.remoteHolderId !== multiplayer?.getId?.()) return;
      const heldMesh = ensureBowHeldMesh();
      if (!heldMesh) return;
      bow.useHeldMeshWhenHeld = true;
      heldMesh.visible = true;
      bow.holder = playerControls;
      setPlayerWeaponType(playerControls, bow.type);
      playerControls.updateAmmoUI?.(true);
      playerControls.setAmmo?.(
        inventoryState.bow?.[ARROW_AMMO_KEY] ?? 0,
        getAmmoLabelForType('arrow'),
        getAmmoIconForType('arrow')
      );
      attachBowHeldArrow(heldMesh);
      updateSettingsUI();
      return;
    }
    if (itemId === 'autumnSword') {
      if (!autumnSword?.mesh || !playerControls) return;
      if (autumnSword.remoteHolderId && autumnSword.remoteHolderId !== multiplayer?.getId?.()) return;
      autumnSword.mesh.visible = true;
      autumnSword.holder = playerControls;
      setPlayerWeaponType(playerControls, autumnSword.type);
      updateSettingsUI();
    }
  }

  function unequipInventoryItem(itemId) {
    if (itemId === 'lantern') {
      if (lantern?.holder !== playerControls) return;
      lantern.holder = null;
      if (lantern.mesh) {
        lantern.mesh.visible = false;
      }
      updateSettingsUI();
      return;
    }
    if (itemId === 'iceGun') {
      if (iceGun?.holder !== playerControls) return;
      iceGun.holder = null;
      if (iceGun.mesh) {
        iceGun.mesh.visible = false;
      }
      clearPlayerWeaponType(playerControls, iceGun.type);
      playerControls?.updateAmmoUI?.(false);
      updateSettingsUI();
      return;
    }
    if (itemId === 'bow') {
      if (bow?.holder !== playerControls) return;
      bow.holder = null;
      if (bow.useHeldMeshWhenHeld && bowHeldMesh) {
        bowHeldMesh.visible = false;
      } else if (bow.mesh) {
        bow.mesh.visible = false;
      }
      bow.useHeldMeshWhenHeld = false;
      clearPlayerWeaponType(playerControls, bow.type);
      playerControls?.updateAmmoUI?.(false);
      playerControls?.setAiming?.(false);
      updateSettingsUI();
      return;
    }
    if (itemId === 'autumnSword') {
      if (autumnSword?.holder !== playerControls) return;
      autumnSword.holder = null;
      if (autumnSword.mesh) {
        autumnSword.mesh.visible = false;
      }
      clearPlayerWeaponType(playerControls, autumnSword.type);
      updateSettingsUI();
    }
  }

  function getInventoryDropPosition() {
    if (!playerControls?.playerModel) return null;
    const dropPosition = playerControls.playerModel.position.clone();
    const angle = Math.random() * Math.PI * 2;
    const radius = 1.2;
    dropPosition.x += Math.cos(angle) * radius;
    dropPosition.z += Math.sin(angle) * radius;
    dropPosition.y = getTerrainHeight(dropPosition.x, dropPosition.z) + 0.5;
    return dropPosition;
  }

  function disposeMushroomPickup(pickup) {
    if (!pickup?.mesh) return;
    const mesh = pickup.mesh;
    if (mesh.parent) {
      mesh.parent.remove(mesh);
    } else {
      scene.remove(mesh);
    }
    mesh.visible = false;
    mesh.traverse(child => {
      if (!child.isMesh) return;
      child.geometry?.dispose?.();
      if (Array.isArray(child.material)) {
        child.material.forEach(material => material?.dispose?.());
      } else {
        child.material?.dispose?.();
      }
    });
  }

  function disposeApplePickup(pickup) {
    if (!pickup?.mesh) return;
    const mesh = pickup.mesh;
    if (mesh.parent) {
      mesh.parent.remove(mesh);
    } else {
      scene.remove(mesh);
    }
    mesh.visible = false;
    mesh.traverse(child => {
      if (!child.isMesh) return;
      child.geometry?.dispose?.();
      if (Array.isArray(child.material)) {
        child.material.forEach(material => material?.dispose?.());
      } else {
        child.material?.dispose?.();
      }
    });
  }

  function pickupMushroom(pickup) {
    if (!pickup?.mesh) return false;
    if (playerControls?.playerModel) {
      const distance = playerControls.playerModel.position.distanceTo(pickup.mesh.position);
      if (distance > PICKUP_RADIUS) return false;
    }
    addToInventory(pickup.id, 1);
    disposeMushroomPickup(pickup);
    const index = mushroomPickups.indexOf(pickup);
    if (index >= 0) {
      mushroomPickups.splice(index, 1);
    }
    return true;
  }

  function pickupApple(pickup) {
    if (!pickup?.mesh) return false;
    if (playerControls?.playerModel) {
      const distance = playerControls.playerModel.position.distanceTo(pickup.mesh.position);
      if (distance > PICKUP_RADIUS) return false;
    }
    addToInventory(pickup.id, 1);
    disposeApplePickup(pickup);
    const index = applePickups.indexOf(pickup);
    if (index >= 0) {
      applePickups.splice(index, 1);
    }
    return true;
  }

  function spawnMushroomPickup(itemId, position) {
    if (!mushroomController?.spawnPickup || !position) return null;
    return mushroomController.spawnPickup(itemId, position);
  }

  function spawnApplePickup(position) {
    if (!appleController?.spawnPickup || !position) return null;
    return appleController.spawnPickup(position);
  }

  function disposeDroppedWeaponPickup(pickup) {
    if (!pickup) return;
    const mesh = pickup.mesh;
    if (mesh) {
      scene.remove(mesh);
      mesh.traverse(child => {
        if (!child.isMesh) return;
        child.geometry?.dispose?.();
        if (Array.isArray(child.material)) {
          child.material.forEach(material => material?.dispose?.());
        } else {
          child.material?.dispose?.();
        }
      });
    }
    if (pickup.marker) {
      scene.remove(pickup.marker);
      pickup.marker.geometry?.dispose?.();
      pickup.marker.material?.dispose?.();
    }
  }

  function createDroppedWeaponPickup(item, { itemId, markerColor, markerOffsetY } = {}) {
    if (!item?.mesh || !item.mesh.visible) return;
    const pickupMesh = item.mesh.clone(true);
    pickupMesh.position.copy(item.mesh.position);
    pickupMesh.quaternion.copy(item.mesh.quaternion);
    pickupMesh.visible = true;
    pickupMesh.userData.hideInMapView = item.mesh.userData?.hideInMapView;
    scene.add(pickupMesh);
    const marker = createWeaponMarker(markerColor);
    const pickup = {
      mesh: pickupMesh,
      marker,
      itemId,
      type: item?.type || itemId,
      holder: null,
      markerOffsetY,
      tryPickup: (playerControls) => {
        if (!pickupMesh?.visible || !playerControls?.playerModel) return;
        const distance = playerControls.playerModel.position.distanceTo(pickupMesh.position);
        if (distance > 3) return;
        addToInventory(itemId, 1);
        equipInventoryItem(itemId);
        const index = droppedWeaponPickups.indexOf(pickup);
        if (index !== -1) {
          droppedWeaponPickups.splice(index, 1);
        }
        disposeDroppedWeaponPickup(pickup);
      }
    };
    droppedWeaponPickups.push(pickup);
    return pickup;
  }

  function dropInventoryItem(itemId) {
    if (!itemId || !inventoryState[itemId]) return;
    if (isFoodItem(itemId)) {
      const dropPosition = getInventoryDropPosition();
      if (!dropPosition) return;
      const pickup = isMushroomItem(itemId)
        ? spawnMushroomPickup(itemId, dropPosition)
        : spawnApplePickup(dropPosition);
      if (!pickup) return;
      removeFromInventory(itemId, 1);
      return;
    }
    const dropPosition = getInventoryDropPosition();
    if (!dropPosition) return;
    const itemMap = {
      iceGun,
      bow,
      autumnSword,
      lantern
    };
    const item = itemMap[itemId];
    if (!item?.mesh) {
      removeFromInventory(itemId, 1);
      updateSettingsUI();
      return;
    }
    const shouldDuplicatePickup = (itemId === 'bow' || itemId === 'lantern')
      && item.mesh.visible
      && item.holder !== playerControls;
    if (item.holder === playerControls) {
      item.drop({ removeFromInventory: true });
      updateSettingsUI();
      return;
    }
    if (shouldDuplicatePickup) {
      const markerColor = itemId === 'bow' ? 0xffc26b : 0xffd400;
      createDroppedWeaponPickup(item, { itemId, markerColor, markerOffsetY: 1.2 });
    }
    item.holder = null;
    item.mesh.visible = true;
    item.mesh.position.copy(dropPosition);
    if (playerControls?.playerModel?.quaternion) {
      item.mesh.quaternion.copy(playerControls.playerModel.quaternion);
    }
    removeFromInventory(itemId, 1);
    updateSettingsUI();
  }

  function eatInventoryItem(itemId) {
    if (!itemId || !inventoryState[itemId]) return;
    if (!isFoodItem(itemId)) return;
    if (isMushroomItem(itemId)) {
      setStat('health', statsState.health + MUSHROOM_HEALTH_GAIN, { skipSave: true });
      setStat('hunger', statsState.hunger + MUSHROOM_HUNGER_GAIN, { skipSave: true });
      setStat('energy', statsState.energy + MUSHROOM_ENERGY_GAIN, { skipSave: true });
    } else if (isAppleItem(itemId)) {
      setStat('health', statsState.health + APPLE_HEALTH_GAIN, { skipSave: true });
      setStat('hunger', statsState.hunger + APPLE_HUNGER_GAIN, { skipSave: true });
      setStat('energy', statsState.energy + APPLE_ENERGY_GAIN, { skipSave: true });
    }
    lastStatUpdateAt = Date.now();
    removeFromInventory(itemId, 1);
  }

  let mapViewEnabled = false;
  let playerDead = false;
  const updateControlAvailability = () => {
    if (!playerControls) return;
    playerControls.enabled = !mapViewEnabled && !playerDead;
  };
  const updateEnergyEffects = () => {
    if (!playerControls) return;
    const energyDepleted = statsState.energy <= 0;
    playerControls.setEnergyDepleted?.(energyDepleted);
  };

  const healthFill = document.getElementById('health-fill');
  const hungerFill = document.getElementById('hunger-fill');
  const energyFill = document.getElementById('energy-fill');

  const createDropId = (index = 0) => {
    const owner = multiplayer?.getId?.() || 'local';
    const randomSeed = Math.floor(Math.random() * 10000);
    return `${owner}-${Date.now()}-${index}-${randomSeed}`;
  };

  const createAmmoDrops = (center, totalAmmo) => {
    const drops = [];
    if (!center || !Number.isFinite(totalAmmo) || totalAmmo <= 0) return drops;
    const radius = 1.6;
    let remaining = totalAmmo;
    let index = 0;
    while (remaining > 0) {
      const amount = Math.min(AMMO_PICKUP_AMOUNT, remaining);
      remaining -= amount;
      const angle = (index / Math.max(1, Math.ceil(totalAmmo / AMMO_PICKUP_AMOUNT))) * Math.PI * 2;
      const x = center.x + Math.cos(angle) * radius;
      const z = center.z + Math.sin(angle) * radius;
      drops.push({
        id: createDropId(index),
        position: [x, center.y, z],
        amount
      });
      index += 1;
    }
    return drops;
  };

  const createRingPositions = (center, count, radius = 1.6) => {
    const positions = [];
    if (!center || !Number.isFinite(count) || count <= 0) return positions;
    for (let index = 0; index < count; index += 1) {
      const angle = (index / count) * Math.PI * 2;
      positions.push(new THREE.Vector3(
        center.x + Math.cos(angle) * radius,
        center.y,
        center.z + Math.sin(angle) * radius
      ));
    }
    return positions;
  };

  const spawnIceGunAmmoCluster = (center) => {
    if (!center) return;
    const positions = createRingPositions(center, ICE_GUN_AMMO_CLUSTER_COUNT, ICE_GUN_AMMO_CLUSTER_RADIUS);
    positions.forEach(position => {
      spawnAmmoPickup(position, AMMO_PICKUP_AMOUNT);
    });
  };

  const clearInventoryState = () => {
    Object.keys(inventoryState).forEach(key => {
      delete inventoryState[key];
    });
    persistInventoryAndStorage();
    playerControls?.updateAmmoUI?.(false);
  };

  const dropInventoryOnDeath = () => {
    if (!playerModel) return;
    const deathPosition = playerModel.position.clone();
    let ammoCount = 0;
    if (playerControls?.ammoLabel === 'Arrows') {
      ammoCount = Number.isFinite(playerControls?.ammo)
        ? playerControls.ammo
        : (Number.isFinite(inventoryState.bow?.[ARROW_AMMO_KEY])
          ? inventoryState.bow[ARROW_AMMO_KEY]
          : 0);
    } else {
      ammoCount = Number.isFinite(playerControls?.ammo)
        ? playerControls.ammo
        : (Number.isFinite(inventoryState.iceGun?.[ICE_AMMO_KEY])
          ? inventoryState.iceGun[ICE_AMMO_KEY]
          : 0);
    }
    const ammoDrops = createAmmoDrops(deathPosition, ammoCount);
    ammoDrops.forEach(drop => {
      addDroppedAmmoPickup({
        id: drop.id,
        position: new THREE.Vector3(...drop.position),
        amount: drop.amount
      });
    });
    if (ammoDrops.length > 0 && multiplayer && !multiplayer.isHost) {
      multiplayer.send({ type: 'inventoryDrop', drops: ammoDrops });
    }

    const weaponDrops = [];
    if ((inventoryState.iceGun?.count || 0) > 0) weaponDrops.push('iceGun');
    if ((inventoryState.bow?.count || 0) > 0) weaponDrops.push('bow');
    if ((inventoryState.autumnSword?.count || 0) > 0) weaponDrops.push('autumnSword');
    if ((inventoryState.lantern?.count || 0) > 0) weaponDrops.push('lantern');
    const weaponPositions = createRingPositions(deathPosition, weaponDrops.length, 2.2);
    weaponDrops.forEach((weaponId, index) => {
      const position = weaponPositions[index] || deathPosition;
      if (weaponId === 'iceGun') {
        spawnIceGunPickup(position);
      } else if (weaponId === 'bow') {
        spawnBowPickup(position);
      } else if (weaponId === 'autumnSword') {
        spawnAutumnSwordPickup(position);
      } else if (weaponId === 'lantern') {
        spawnLanternPickup(position);
      }
    });

    playerControls?.setAmmo?.(0);
    clearInventoryState();
  };

  function updateHealthUI() {
    if (healthFill) {
      healthFill.style.width = `${statsState.health}%`;
    }
  }

  function updateHungerUI() {
    if (hungerFill) {
      hungerFill.style.width = `${statsState.hunger}%`;
    }
  }

  function updateEnergyUI() {
    if (energyFill) {
      energyFill.style.width = `${statsState.energy}%`;
    }
  }

  const clampStat = (key, value) => {
    if (['health', 'hunger', 'energy'].includes(key)) {
      const num = Number(value);
      if (!Number.isFinite(num)) {
        return 0;
      }
      return Math.max(0, Math.min(100, num));
    }
    if (key === 'level') {
      const num = Number(value);
      if (!Number.isFinite(num)) {
        return 1;
      }
      return Math.max(1, Math.round(num));
    }
    if (key === 'levelKills') {
      const num = Number(value);
      if (!Number.isFinite(num)) {
        return 0;
      }
      return Math.max(0, Math.floor(num));
    }
    if (key === 'coins') {
      const num = Number(value);
      if (!Number.isFinite(num)) {
        return 0;
      }
      return Math.max(0, Math.floor(num));
    }
    return value;
  };

  function setStat(key, value, { skipSave = false } = {}) {
    statsState[key] = clampStat(key, value);
    if (key === 'health') {
      updateHealthUI();
    }
    if (key === 'hunger') {
      updateHungerUI();
    }
    if (key === 'energy') {
      updateEnergyUI();
      updateEnergyEffects();
    }
    if (key === 'level') {
      updatePlayerInfoUI();
    }
    if (!skipSave) {
      if (key === 'hunger' || key === 'energy') {
        lastStatUpdateAt = Date.now();
      }
      saveStatsThrottled(profileNameKey, statsState, lastStatUpdateAt);
    }
  }

  window.setStat = setStat;
  window.getPlayerStrength = () => (Number.isFinite(statsState.strength) ? statsState.strength : 0);
  const applyLevelBonus = delta => {
    if (!Number.isFinite(delta) || delta === 0) {
      return;
    }
    const adjustment = delta * 2;
    for (const key of STAT_KEYS_FOR_LEVEL) {
      const current = Number.isFinite(statsState[key]) ? statsState[key] : 0;
      const nextValue = key === 'health' || key === 'hunger' || key === 'energy'
        ? clampStat(key, current + adjustment)
        : current + adjustment;
      setStat(key, nextValue, { skipSave: true });
    }
    saveStatsThrottled(profileNameKey, statsState, lastStatUpdateAt);
  };
  const adjustLevel = delta => {
    const currentLevel = Number.isFinite(statsState.level) ? statsState.level : 1;
    const nextLevel = clampStat('level', currentLevel + delta);
    if (nextLevel === currentLevel) {
      return;
    }
    setStat('level', nextLevel, { skipSave: true });
    applyLevelBonus(nextLevel - currentLevel);
    showLevelPopup(nextLevel);
  };
  window.adjustPlayerLevel = adjustLevel;

  const getKillsRequiredForNextLevel = level => Math.max(1, level);
  const registerKillProgress = () => {
    const currentLevel = Number.isFinite(statsState.level) ? statsState.level : 1;
    const currentKills = Number.isFinite(statsState.levelKills) ? statsState.levelKills : 0;
    const nextKills = clampStat('levelKills', currentKills + 1);
    if (nextKills >= getKillsRequiredForNextLevel(currentLevel)) {
      setStat('levelKills', 0, { skipSave: true });
      adjustLevel(1);
      return;
    }
    setStat('levelKills', nextKills);
  };

  window.onMonsterKill = () => registerKillProgress();
  window.onPlayerKill = () => registerKillProgress();
  window.onPlayerDeath = () => {
    setStat('levelKills', 0, { skipSave: true });
    adjustLevel(-1);
  };

  Object.defineProperty(window, 'localHealth', {
    configurable: true,
    get: () => statsState.health,
    set: value => setStat('health', value)
  });

  Object.defineProperty(window, 'hunger', {
    configurable: true,
    get: () => statsState.hunger,
    set: value => setStat('hunger', value)
  });

  Object.defineProperty(window, 'energy', {
    configurable: true,
    get: () => statsState.energy,
    set: value => setStat('energy', value)
  });

  updateHealthUI();
  updateHungerUI();
  updateEnergyUI();

  if (offlineDecay.changed) {
    saveStatsThrottled(profileNameKey, statsState, lastStatUpdateAt);
  }

  function spawnProjectileWithPerfFlags(...args) {
    spawnProjectile(...args);
    const latest = projectiles[projectiles.length - 1];
    if (latest) {
      latest.userData.skipTerrainCorrection = true;
    }
  }

  function spawnArrowProjectileWithPerfFlags(scene, list, position, direction, shooterId) {
    const latest = spawnArrowProjectile({
      scene,
      list,
      position,
      direction,
      shooterId,
      template: arrowTemplate,
      cloneArrowMesh,
      scale: ARROW_PROJECTILE_SCALE,
      speed: ARROW_PROJECTILE_SPEED,
      lifetime: ARROW_PROJECTILE_LIFETIME,
      spawnProjectile,
      spawnPickup: (pickupPosition, amount) => spawnArrowPickup(pickupPosition, amount, { noFloat: true })
    });
    if (latest) {
      latest.userData.skipTerrainCorrection = true;
    }
  }

  const ICE_MIST_RANGE = 5;
  const ICE_MIST_SPEED = 3.2;
  const ICE_MIST_LIFETIME_MS = (ICE_MIST_RANGE / ICE_MIST_SPEED) * 1000;
  const ICE_MIST_PARTICLE_COUNT = 7;
  const ICE_MIST_FREEZE_MS = 5000;
  const ICE_MIST_RADIUS = 0.9;

  function spawnIceMist(scene, mistList, position, direction, shooterId) {
    const mistGroup = new THREE.Group();
    const material = new THREE.MeshStandardMaterial({
      color: 0x66ccff,
      transparent: true,
      opacity: 0.65,
      emissive: 0x3aa5ff,
      emissiveIntensity: 0.6,
      depthWrite: false
    });

    for (let i = 0; i < ICE_MIST_PARTICLE_COUNT; i++) {
      const size = THREE.MathUtils.lerp(0.2, 0.45, Math.random());
      const geometry = new THREE.SphereGeometry(size, 10, 8);
      const particle = new THREE.Mesh(geometry, material);
      const spread = 0.35;
      particle.position.set(
        (Math.random() - 0.5) * spread,
        (Math.random() - 0.3) * spread,
        (Math.random() - 0.5) * spread
      );
      particle.castShadow = false;
      particle.receiveShadow = false;
      mistGroup.add(particle);
    }

    mistGroup.position.copy(position);
    mistGroup.userData.skipTerrainCorrection = true;
    scene.add(mistGroup);

    const normalizedDirection = direction.clone().normalize();
    const speed = ICE_MIST_SPEED * THREE.MathUtils.lerp(0.9, 1.15, Math.random());
    const drift = new THREE.Vector3(
      (Math.random() - 0.5) * 0.3,
      Math.random() * 0.2,
      (Math.random() - 0.5) * 0.3
    );
    const velocity = normalizedDirection.multiplyScalar(speed).add(drift);

    mistList.push({
      group: mistGroup,
      material,
      velocity,
      spawnTime: performance.now(),
      lifetimeMs: ICE_MIST_LIFETIME_MS,
      traveled: 0,
      maxDistance: ICE_MIST_RANGE,
      radius: ICE_MIST_RADIUS,
      hitTargets: new Set(),
      shooterId
    });
  }

  function updateIceMists({
    scene,
    mistList,
    deltaSeconds,
    playerModel,
    playerControls,
    monsters,
    multiplayer
  }) {
    if (!mistList.length) return;
    const now = performance.now();
    const isHost = !multiplayer || multiplayer.isHost;
    const localId = multiplayer?.getId?.();

    const removeMist = (index) => {
      const mist = mistList[index];
      if (!mist) return;
      if (mist.group) {
        scene.remove(mist.group);
        mist.group.traverse(child => {
          if (child.isMesh && child.geometry) {
            child.geometry.dispose();
          }
        });
      }
      mist.material?.dispose?.();
      mistList.splice(index, 1);
    };

    for (let i = mistList.length - 1; i >= 0; i--) {
      const mist = mistList[i];
      const moveStep = mist.velocity.clone().multiplyScalar(deltaSeconds);
      mist.group.position.add(moveStep);
      mist.traveled += moveStep.length();

      const ageMs = now - mist.spawnTime;
      const progress = Math.min(1, ageMs / mist.lifetimeMs);
      mist.material.opacity = THREE.MathUtils.lerp(0.65, 0, progress);
      mist.material.emissiveIntensity = THREE.MathUtils.lerp(0.6, 0, progress);

      if (playerModel && playerControls && !mist.hitTargets.has('local')) {
        if (mist.shooterId && localId && mist.shooterId === localId) {
          mist.hitTargets.add('local');
        } else {
          const distance = mist.group.position.distanceTo(playerModel.position);
          if (distance <= mist.radius + 0.6) {
            playerControls.applyFreeze(ICE_MIST_FREEZE_MS);
            mist.hitTargets.add('local');
          }
        }
      }

      if (isHost && Array.isArray(monsters)) {
        for (const monster of monsters) {
          if (!monster || !monster.model) continue;
          if (mist.hitTargets.has(monster.id)) continue;
          const distance = mist.group.position.distanceTo(monster.model.position);
          if (distance <= mist.radius + 0.8) {
            monster.applyFreeze?.(ICE_MIST_FREEZE_MS);
            mist.hitTargets.add(monster.id);
          }
        }
      }

      if (ageMs >= mist.lifetimeMs || mist.traveled >= mist.maxDistance) {
        removeMist(i);
      }
    }
  }

  const asVec3 = (p) => (
    p?.isVector3 ? p.clone()
    : p && Number.isFinite(p.x) && Number.isFinite(p.z) ? new THREE.Vector3(p.x, p.y ?? 0, p.z)
    : null
  );

  function spawnAmmoPickup(position, amount = AMMO_PICKUP_AMOUNT, options = {}) {
    const spawnPos = asVec3(position);
    if (!spawnPos) return;
    const terrainHeight = getTerrainHeight(spawnPos.x, spawnPos.z);
    if (options.noFloat) {
      const groundOffset = Number.isFinite(options.groundOffset) ? options.groundOffset : 0.08;
      spawnPos.y = terrainHeight + groundOffset;
    } else {
      spawnPos.y = terrainHeight + 0.6;
      liftPositionToBuildingTop(spawnPos, 0.6);
    }

    const geometry = options.geometry || new THREE.IcosahedronGeometry(0.25, 0);
    const material = options.material || new THREE.MeshStandardMaterial({
      color: 0x7fd0ff,
      emissive: 0x225577,
      emissiveIntensity: 0.4,
      metalness: 0.1,
      roughness: 0.4,
    });

    let pickup = options.createMesh ? options.createMesh() : null;
    if (!pickup) {
      pickup = new THREE.Mesh(geometry, material);
    }
    registerPickupEmissiveMaterials(pickup);
    pickup.position.copy(spawnPos);
    pickup.castShadow = true;
    pickup.userData.skipTerrainCorrection = true;
    pickup.userData.baseY = spawnPos.y;
    pickup.userData.phase = Math.random() * Math.PI * 2;
    pickup.userData.amount = amount;
    pickup.userData.type = options.type || 'ammo';
    pickup.userData.sparkle = !!options.sparkle;
    pickup.userData.noFloat = !!options.noFloat;
    if (options.sparkle) {
      const light = new THREE.PointLight(0xfff2a8, 0.6, 2);
      light.position.set(0, 0.4, 0);
      pickup.add(light);
      pickup.userData.sparkleLight = light;
    }
    scene.add(pickup);
    ammoPickups.push(pickup);
    return pickup;
  }

  function spawnArrowPickup(position, amount = 1, options = {}) {
    return spawnAmmoPickup(position, amount, {
      type: 'arrow',
      sparkle: true,
      noFloat: options.noFloat,
      groundOffset: options.groundOffset,
      createMesh: () => {
        const arrowMesh = cloneArrowMesh(arrowTemplate, ARROW_PROJECTILE_SCALE);
        if (arrowMesh) {
          if (amount > 1) {
            arrowMesh.scale.multiplyScalar(1.3);
          }
          arrowMesh.rotation.set(0, Math.PI / 2, Math.PI / 2);
          return arrowMesh;
        }
        const geometry = new THREE.CylinderGeometry(0.04, 0.05, 0.6, 8);
        const material = new THREE.MeshStandardMaterial({
          color: 0x7b5530,
          emissive: 0x2b1a0a,
          emissiveIntensity: 0.35
        });
        const fallback = new THREE.Mesh(geometry, material);
        fallback.rotation.x = Math.PI / 2;
        return fallback;
      }
    });
  }

  function getAmmoLabelForType(type) {
    return type === 'arrow' ? 'Arrows' : 'Ice ammo';
  }

  function getAmmoIconForType(type) {
    return type === 'arrow' ? '🏹' : '❄️';
  }

  function addAmmoForType(type, amount) {
    if (!Number.isFinite(amount) || amount <= 0) return;
    if (type === 'arrow') {
      if (bow?.holder === playerControls) {
        playerControls.addAmmo(amount);
      } else {
        const current = Number.isFinite(inventoryState.bow?.[ARROW_AMMO_KEY])
          ? inventoryState.bow[ARROW_AMMO_KEY]
          : 0;
        setArrowAmmoCount(current + amount);
      }
      return;
    }
    if (iceGun?.holder === playerControls) {
      playerControls.addAmmo(amount);
    } else {
      const current = Number.isFinite(inventoryState.iceGun?.[ICE_AMMO_KEY])
        ? inventoryState.iceGun[ICE_AMMO_KEY]
        : 0;
      setIceAmmoCount(current + amount);
    }
  }

  function spawnDroppedAmmoPickup(position, amount, dropId) {
    const spawnPos = asVec3(position);
    if (!spawnPos) return null;
    const terrainHeight = getTerrainHeight(spawnPos.x, spawnPos.z);
    spawnPos.y = terrainHeight + 0.6;
    liftPositionToBuildingTop(spawnPos, 0.6);

    const geometry = new THREE.IcosahedronGeometry(0.25, 0);
    const material = new THREE.MeshStandardMaterial({
      color: 0x7fd0ff,
      emissive: 0x225577,
      emissiveIntensity: 0.4,
      metalness: 0.1,
      roughness: 0.4,
    });

    const pickup = new THREE.Mesh(geometry, material);
    registerPickupEmissiveMaterials(pickup);
    pickup.position.copy(spawnPos);
    pickup.castShadow = true;
    pickup.userData.skipTerrainCorrection = true;
    pickup.userData.baseY = spawnPos.y;
    pickup.userData.phase = Math.random() * Math.PI * 2;
    pickup.userData.noFloat = true;
    pickup.userData.isDropped = true;
    pickup.userData.dropId = dropId;
    pickup.userData.amount = amount;
    scene.add(pickup);
    return pickup;
  }

  function addDroppedAmmoPickup({ id, position, amount }) {
    if (!id || !position || droppedAmmoPickups.has(id)) return;
    const pickup = spawnDroppedAmmoPickup(position, amount, id);
    if (!pickup) return;
    droppedAmmoPickups.set(id, { mesh: pickup, amount });
  }

  function removeDroppedAmmoPickup(id) {
    const entry = droppedAmmoPickups.get(id);
    if (!entry) return;
    disposePickup(entry.mesh);
    droppedAmmoPickups.delete(id);
  }

  function syncDroppedAmmoState(stateDrops = []) {
    const seen = new Set();
    stateDrops.forEach(drop => {
      if (!drop?.id || !Array.isArray(drop.position)) return;
      if (pendingDropRemovals.has(drop.id)) return;
      seen.add(drop.id);
      if (!droppedAmmoPickups.has(drop.id)) {
        addDroppedAmmoPickup({
          id: drop.id,
          position: new THREE.Vector3(...drop.position),
          amount: drop.amount
        });
      } else {
        const entry = droppedAmmoPickups.get(drop.id);
        const mesh = entry?.mesh;
        const [x, y, z] = drop.position;
        if (mesh && Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
          mesh.position.set(x, y, z);
          mesh.userData.baseY = y;
        }
      }
    });

    Array.from(droppedAmmoPickups.keys()).forEach(id => {
      if (!seen.has(id)) {
        removeDroppedAmmoPickup(id);
      }
    });

    Array.from(pendingDropRemovals).forEach(id => {
      if (!seen.has(id)) {
        pendingDropRemovals.delete(id);
      }
    });
  }

  function spawnFoodPickup(position) {
    const spawnPos = asVec3(position);
    if (!spawnPos) return;
    const terrainHeight = getTerrainHeight(spawnPos.x, spawnPos.z);
    spawnPos.y = terrainHeight + 0.6;
    liftPositionToBuildingTop(spawnPos, 0.6);

    const geometry = new THREE.IcosahedronGeometry(0.25, 0);
    const material = new THREE.MeshStandardMaterial({
      color: 0xc7a77a,
      emissive: 0x2a1a0a,
      emissiveIntensity: 0.2,
      metalness: 0.05,
      roughness: 0.8
    });

    const pickup = new THREE.Mesh(geometry, material);
    registerPickupEmissiveMaterials(pickup);
    pickup.position.copy(spawnPos);
    pickup.castShadow = true;
    pickup.userData.skipTerrainCorrection = true;
    pickup.userData.baseY = spawnPos.y;
    pickup.userData.phase = Math.random() * Math.PI * 2;
    pickup.userData.type = 'food';
    scene.add(pickup);
    foodPickups.push(pickup);
    return pickup;
  }

  function spawnHealthPickup(position) {
    const spawnPos = asVec3(position);
    if (!spawnPos) return;
    const terrainHeight = getTerrainHeight(spawnPos.x, spawnPos.z);
    spawnPos.y = terrainHeight + 0.6;
    liftPositionToBuildingTop(spawnPos, 0.6);

    const geometry = new THREE.IcosahedronGeometry(0.25, 0);
    const material = new THREE.MeshStandardMaterial({
      color: 0xff5a5a,
      emissive: 0x5a1111,
      emissiveIntensity: 0.4,
      metalness: 0.05,
      roughness: 0.7
    });

    const pickup = new THREE.Mesh(geometry, material);
    registerPickupEmissiveMaterials(pickup);
    pickup.position.copy(spawnPos);
    pickup.castShadow = true;
    pickup.userData.skipTerrainCorrection = true;
    pickup.userData.baseY = spawnPos.y;
    pickup.userData.phase = Math.random() * Math.PI * 2;
    pickup.userData.type = 'health';
    scene.add(pickup);
    healthPickups.push(pickup);
    return pickup;
  }

  function spawnCoinPickup(position) {
    const spawnPos = asVec3(position);
    if (!spawnPos) return;
    const terrainHeight = getTerrainHeight(spawnPos.x, spawnPos.z);
    spawnPos.y = terrainHeight + 0.6;
    liftPositionToBuildingTop(spawnPos, 0.6);

    const geometry = new THREE.CylinderGeometry(0.2, 0.2, 0.06, 24);
    const material = new THREE.MeshStandardMaterial({
      color: 0xf8cf45,
      emissive: 0x7a5a00,
      emissiveIntensity: 0.45,
      metalness: 0.7,
      roughness: 0.25
    });

    const pickup = new THREE.Mesh(geometry, material);
    registerPickupEmissiveMaterials(pickup);
    pickup.position.copy(spawnPos);
    pickup.castShadow = true;
    pickup.userData.skipTerrainCorrection = true;
    pickup.userData.baseY = spawnPos.y;
    pickup.userData.phase = Math.random() * Math.PI * 2;
    pickup.userData.type = 'coin';
    pickup.rotation.x = Math.PI / 2;
    scene.add(pickup);
    coinPickups.push(pickup);
    return pickup;
  }

  function applyFoodPickupEffects() {
    setStat('hunger', statsState.hunger + FOOD_HUNGER_GAIN, { skipSave: true });
    setStat('energy', statsState.energy + FOOD_ENERGY_GAIN, { skipSave: true });
    lastStatUpdateAt = Date.now();
    saveStatsThrottled(profileNameKey, statsState, lastStatUpdateAt);
  }

  function applyHealthPickupEffects() {
    setStat('health', statsState.health + HEALTH_PICKUP_GAIN, { skipSave: true });
    lastStatUpdateAt = Date.now();
    saveStatsThrottled(profileNameKey, statsState, lastStatUpdateAt);
  }

  function applyCoinPickupEffects() {
    const nextCoins = (Number.isFinite(statsState.coins) ? statsState.coins : 0) + COIN_PICKUP_GAIN;
    setStat('coins', nextCoins, { skipSave: true });
    saveStatsThrottled(profileNameKey, statsState, lastStatUpdateAt);
    showCoinPopup(statsState.coins);
  }

  function spawnIceGunPickup(position) {
    if (!iceGun?.mesh) return;
    const spawnPos = asVec3(position);
    if (!spawnPos) return;

    const terrainHeight = getTerrainHeight(spawnPos.x, spawnPos.z);
    if (!Number.isFinite(terrainHeight)) return;

    spawnPos.y = terrainHeight + 0.5;
    liftPositionToBuildingTop(spawnPos, 0.5);
    iceGun.mesh.position.copy(spawnPos);
    iceGun.mesh.quaternion.set(0, 0, 0, 1);
    iceGun.mesh.visible = true;
    iceGun.holder = null;
    spawnIceGunAmmoCluster(spawnPos);
  }

  function spawnBowPickup(position) {
    if (!bow?.mesh) return;
    const spawnPos = asVec3(position);
    if (!spawnPos) return;

    const terrainHeight = getTerrainHeight(spawnPos.x, spawnPos.z);
    if (!Number.isFinite(terrainHeight)) return;

    spawnPos.y = terrainHeight + 0.5;
    liftPositionToBuildingTop(spawnPos, 0.5);
    bow.mesh.position.copy(spawnPos);
    bow.mesh.quaternion.set(0, 0, 0, 1);
    bow.mesh.visible = true;
    bow.holder = null;
  }

  function spawnAutumnSwordPickup(position) {
    if (!autumnSword?.mesh) return;
    const spawnPos = asVec3(position);
    if (!spawnPos) return;

    const terrainHeight = getTerrainHeight(spawnPos.x, spawnPos.z);
    if (!Number.isFinite(terrainHeight)) return;

    spawnPos.y = terrainHeight + 0.5;
    liftPositionToBuildingTop(spawnPos, 0.5);
    autumnSword.mesh.position.copy(spawnPos);
    autumnSword.mesh.quaternion.set(0, 0, 0, 1);
    autumnSword.mesh.visible = true;
    autumnSword.holder = null;
  }

  function spawnLanternPickup(position) {
    if (!lantern?.mesh) return;
    const spawnPos = asVec3(position);
    if (!spawnPos) return;

    const terrainHeight = getTerrainHeight(spawnPos.x, spawnPos.z);
    if (!Number.isFinite(terrainHeight)) return;

    spawnPos.y = terrainHeight + 0.2;
    lantern.mesh.position.copy(spawnPos);
    lantern.mesh.quaternion.set(0, 0, 0, 1);
    lantern.mesh.visible = true;
    lantern.holder = null;
  }

  function spawnTreasureChestPickup(position) {
    if (!treasureChest?.mesh || treasureChest.isOpen) return;
    const spawnPos = asVec3(position);
    if (!spawnPos) return;

    const terrainHeight = getTerrainHeight(spawnPos.x, spawnPos.z);
    if (!Number.isFinite(terrainHeight)) return;

    spawnPos.y = terrainHeight;
    treasureChest.mesh.position.copy(spawnPos);
    treasureChest.mesh.visible = true;
  }

  registerNetworkedEntity('droppedAmmo', {
    getState: () => {
      const drops = Array.from(droppedAmmoPickups.entries()).map(([id, entry]) => {
        const mesh = entry?.mesh;
        if (!mesh) return null;
        const pos = mesh.position;
        return {
          id,
          position: [pos.x, pos.y, pos.z],
          amount: entry.amount ?? mesh.userData.amount
        };
      }).filter(Boolean);
      return { drops };
    },
    applyState: state => {
      if (!state) return;
      const drops = Array.isArray(state.drops) ? state.drops : [];
      syncDroppedAmmoState(drops);
    },
    isLocallyControlled: () => multiplayer?.isHost
  });

  let statDecayAccumulator = 0;

  playerControls = new PlayerControls({
    scene,
    camera,
    playerModel,
    renderer,
    multiplayer,
    getCameraOccluders: () => {
      const occluders = [];
      if (buildingsRenderer?.getCollisionMeshes) {
        occluders.push(...buildingsRenderer.getCollisionMeshes());
      } else if (buildingsRenderer?.group) {
        occluders.push(buildingsRenderer.group);
      }
      if (natureController?.group) {
        occluders.push(natureController.group);
      }
      return occluders;
    },
    spawnProjectile: spawnProjectileWithPerfFlags,
    spawnArrowProjectile: spawnArrowProjectileWithPerfFlags,
    projectiles,
    spawnIceMist,
    iceMists,
    audioManager,
    initialAmmo: inventoryState.iceGun?.[ICE_AMMO_KEY],
    onAmmoChange: (amount) => {
      if (playerControls?.ammoLabel === 'Arrows') {
        setArrowAmmoCount(amount);
      } else {
        setIceAmmoCount(amount);
      }
    }
  });
  window.playerControls = playerControls;
  updateControlAvailability();
  updateEnergyEffects();


  const starterPosition = playerModel?.position?.clone?.() || getSpawnPosition();
  if (starterPosition) {
    const bowSpawn = starterPosition.clone().add(new THREE.Vector3(2.2, 0, 1.2));
    const arrowSingle = starterPosition.clone().add(new THREE.Vector3(1.2, 0, -1.4));
    const arrowBundle = starterPosition.clone().add(new THREE.Vector3(-1.4, 0, -1.1));
    spawnBowPickup(bowSpawn);
    spawnArrowPickup(arrowSingle, 1);
    spawnArrowPickup(arrowBundle, 5);
  }

  initMapView({ camera, scene, player: playerModel });

  const mapControls = document.createElement('div');
  mapControls.className = 'map-controls';
  const mapToggleButton = document.createElement('button');
  mapToggleButton.className = 'map-control-button map-toggle-button';
  mapToggleButton.textContent = 'Map';
  const zoomInButton = document.createElement('button');
  zoomInButton.className = 'map-control-button map-zoom-button';
  zoomInButton.textContent = '+';
  const zoomOutButton = document.createElement('button');
  zoomOutButton.className = 'map-control-button map-zoom-button';
  zoomOutButton.textContent = '–';
  mapControls.appendChild(mapToggleButton);
  mapControls.appendChild(zoomInButton);
  mapControls.appendChild(zoomOutButton);
  document.body.appendChild(mapControls);

  mapToggleButton.addEventListener('click', () => {
    mapViewEnabled = !mapViewEnabled;
    setMapViewEnabled(mapViewEnabled);
    updateControlAvailability();
    mapToggleButton.classList.toggle('active', mapViewEnabled);
    mapControls.classList.toggle('map-enabled', mapViewEnabled);
  });

  zoomInButton.addEventListener('click', () => {
    zoomIn();
  });
  zoomOutButton.addEventListener('click', () => {
    zoomOut();
  });

  const TILE_SIZE_METERS = 300;
  const TILE_EVICT_RADIUS = 2;
  const GROUND_TILE_RADIUS = 2;
  const TILE_FETCH_RADIUS_METERS = TILE_SIZE_METERS * Math.SQRT2 * 0.5;
  const TILE_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
  tileCache = createTileCache({
    tileSizeMeters: TILE_SIZE_METERS,
    evictRadiusTiles: TILE_EVICT_RADIUS
  });
  natureController?.setTileCache?.(tileCache);
  natureController?.refreshAll?.();
  if (pendingMapRebuild) {
    rebuildMapFromCache();
  }
  groundTiles = createGroundTiles({
    scene,
    renderer,
    tileSizeMeters: TILE_SIZE_METERS
  });
  window.groundTiles = groundTiles.tiles;
  groundMaterialBase = captureMaterialBase(groundTiles.material);
  applyDisplaySettings();
  const getRandomPickupPosition = (center) => {
    if (!center) return null;
    const radius = PICKUP_SPAWN_RADIUS * Math.sqrt(Math.random());
    const angle = Math.random() * Math.PI * 2;
    const x = center.x + Math.cos(angle) * radius;
    const z = center.z + Math.sin(angle) * radius;
    return new THREE.Vector3(x, 0, z);
  };
  const spawnScatteredPickups = ({ center, count, maxTotal, spawnFn }) => {
    let spawned = 0;
    let attempts = 0;
    const maxAttempts = count * 6;
    while (spawned < count && attempts < maxAttempts && maxTotal()) {
      attempts += 1;
      const spawnPos = getRandomPickupPosition(center);
      if (!spawnPos) continue;
      const terrainHeight = getTerrainHeight(spawnPos.x, spawnPos.z);
      if (!Number.isFinite(terrainHeight)) continue;
      spawnFn(spawnPos);
      spawned += 1;
    }
    return spawned;
  };
  let lastPickupStockAt = 0;
  let activeGroundTileKey = null;
  let lastPickupTilesUpdateAt = 0;
  let lastPickupTilesPosition = null;
  const PICKUP_TILE_UPDATE_COOLDOWN_MS = 1000;
  const PICKUP_TILE_UPDATE_DISTANCE_METERS = 10;
  const getGroundTileCoords = (position) => {
    if (!position) return null;
    return {
      x: Math.floor(position.x / TILE_SIZE_METERS),
      y: Math.floor(-position.z / TILE_SIZE_METERS)
    };
  };
  const updateGroundTiles = (position) => {
    const centerTile = getGroundTileCoords(position);
    if (!centerTile) return;
    const centerKey = `${centerTile.x},${centerTile.y}`;
    if (centerKey === activeGroundTileKey && groundTiles.tiles.size > 0) {
      return;
    }
    activeGroundTileKey = centerKey;
    const desiredKeys = new Set();
    for (let dx = -GROUND_TILE_RADIUS; dx <= GROUND_TILE_RADIUS; dx += 1) {
      for (let dy = -GROUND_TILE_RADIUS; dy <= GROUND_TILE_RADIUS; dy += 1) {
        const tile = {
          x: centerTile.x + dx,
          y: centerTile.y + dy
        };
        const key = `${tile.x},${tile.y}`;
        desiredKeys.add(key);
        groundTiles.ensureTile(tile, key);
      }
    }
    for (const key of Array.from(groundTiles.tiles.keys())) {
      if (!desiredKeys.has(key)) {
        groundTiles.removeTile(key);
      }
    }
  };
  const disposePickup = (pickup) => {
    scene.remove(pickup);
    pickup.geometry?.dispose();
    pickup.material?.dispose();
  };
  const removePickupOutsideRadius = (pickups, center, radius) => {
    for (let i = pickups.length - 1; i >= 0; i--) {
      const pickup = pickups[i];
      if (!pickup) continue;
      if (center.distanceTo(pickup.position) > radius) {
        disposePickup(pickup);
        pickups.splice(i, 1);
      }
    }
  };
  const updatePickupTiles = (position) => {
    if (!position) return;
    const center = position.clone();
    removePickupOutsideRadius(ammoPickups, center, PICKUP_SPAWN_RADIUS);
    removePickupOutsideRadius(foodPickups, center, PICKUP_SPAWN_RADIUS);
    removePickupOutsideRadius(healthPickups, center, PICKUP_SPAWN_RADIUS);
    removePickupOutsideRadius(coinPickups, center, PICKUP_SPAWN_RADIUS);

    const now = Date.now();
    if (now - lastPickupStockAt < PICKUP_STOCK_COOLDOWN_MS) {
      return;
    }
    lastPickupStockAt = now;

    spawnScatteredPickups({
      center,
      count: TILE_STOCK_AMMO_COUNT,
      maxTotal: () => ammoPickups.length < MAX_AMMO_PICKUPS,
      spawnFn: spawnAmmoPickup
    });
    spawnScatteredPickups({
      center,
      count: TILE_STOCK_FOOD_COUNT,
      maxTotal: () => foodPickups.length < MAX_FOOD_PICKUPS,
      spawnFn: spawnFoodPickup
    });
    spawnScatteredPickups({
      center,
      count: TILE_STOCK_HEALTH_COUNT,
      maxTotal: () => healthPickups.length < MAX_HEALTH_PICKUPS,
      spawnFn: spawnHealthPickup
    });
    spawnScatteredPickups({
      center,
      count: TILE_STOCK_COIN_COUNT,
      maxTotal: () => coinPickups.length < MAX_COIN_PICKUPS,
      spawnFn: spawnCoinPickup
    });

    const isHost = !multiplayer || multiplayer.isHost;
    if (isHost && TILE_STOCK_WEAPON_COUNT > 0) {
      const hasIceGun = (inventoryState?.iceGun?.count || 0) > 0;
      const canSpawnIceGun = iceGun?.mesh && !iceGun.holder && !hasIceGun && !iceGun.mesh.visible;
      if (canSpawnIceGun) {
        const spawnPos = getRandomPickupPosition(center);
        if (spawnPos) {
          spawnIceGunPickup(spawnPos);
        }
      }

      const hasBow = (inventoryState?.bow?.count || 0) > 0;
      const canSpawnBow = bow?.mesh && !bow.holder && !hasBow && !bow.mesh.visible;
      if (canSpawnBow) {
        const spawnPos = getRandomPickupPosition(center);
        if (spawnPos) {
          spawnBowPickup(spawnPos);
        }
      }

      const hasSword = (inventoryState?.autumnSword?.count || 0) > 0;
      const canSpawnSword = autumnSword?.mesh && !autumnSword.holder && !hasSword && !autumnSword.mesh.visible;
      if (canSpawnSword) {
        const spawnPos = getRandomPickupPosition(center);
        if (spawnPos) {
          spawnAutumnSwordPickup(spawnPos);
        }
      }
    }

    const canSpawnTreasureChest = treasureChest?.mesh
      && !treasureChest.isOpen
      && !treasureChest.mesh.visible;
    if (canSpawnTreasureChest) {
      const spawnPos = getRandomPickupPosition(center);
      if (spawnPos) {
        spawnTreasureChestPickup(spawnPos);
      }
    }

    [iceGun, bow, autumnSword].forEach((weapon) => {
      if (!weapon?.mesh || weapon.holder || !weapon.mesh.visible) return;
      if (center.distanceTo(weapon.mesh.position) > PICKUP_SPAWN_RADIUS) {
        weapon.mesh.visible = false;
      }
    });
    if (treasureChest?.mesh && !treasureChest.isOpen && treasureChest.mesh.visible) {
      if (center.distanceTo(treasureChest.mesh.position) > PICKUP_SPAWN_RADIUS) {
        treasureChest.mesh.visible = false;
      }
    }
  };
  const shouldUpdatePickupTiles = (position) => {
    if (!position) return false;
    const now = Date.now();
    if (lastPickupTilesUpdateAt === 0) {
      lastPickupTilesUpdateAt = now;
      lastPickupTilesPosition = { x: position.x, z: position.z };
      return true;
    }
    const elapsed = now - lastPickupTilesUpdateAt;
    let movedEnough = false;
    if (lastPickupTilesPosition) {
      const dx = position.x - lastPickupTilesPosition.x;
      const dz = position.z - lastPickupTilesPosition.z;
      movedEnough = Math.hypot(dx, dz) >= PICKUP_TILE_UPDATE_DISTANCE_METERS;
    }
    if (movedEnough || elapsed >= PICKUP_TILE_UPDATE_COOLDOWN_MS) {
      lastPickupTilesUpdateAt = now;
      lastPickupTilesPosition = { x: position.x, z: position.z };
      return true;
    }
    return false;
  };
  const mapFetchInFlight = new Set();
  const debugPerf = {
    monsters: 0,
    ammoPickups: 0,
    foodPickups: 0,
    healthPickups: 0,
    coinPickups: 0,
    tileCacheSize: 0
  };
  window.debugPerf = debugPerf;
  let lastPerfUpdateMs = 0;
  let lastMapUpdateAt = 0;
  let lastMapUpdateTileKey = null;
  const MAP_UPDATE_THROTTLE_MS = 1500;

  function loadWorldOrigin() {
    try {
      const stored = localStorage.getItem(WORLD_ORIGIN_STORAGE_KEY);
      if (!stored) return null;
      const parsed = JSON.parse(stored);
      if (!Number.isFinite(parsed?.lat) || !Number.isFinite(parsed?.lon)) return null;
      return { lat: parsed.lat, lon: parsed.lon };
    } catch (error) {
      console.warn('Failed to parse stored world origin:', error);
      return null;
    }
  }

  function setWorldOrigin(origin) {
    if (!origin || !Number.isFinite(origin.lat) || !Number.isFinite(origin.lon)) return;
    worldOrigin = { lat: origin.lat, lon: origin.lon };
    localStorage.setItem(WORLD_ORIGIN_STORAGE_KEY, JSON.stringify(worldOrigin));
    if (tileCache) {
      tileCache.setOrigin(worldOrigin);
    } else {
      pendingMapRebuild = true;
    }
    currentRenderOrigin = { centerLat: origin.lat, centerLon: origin.lon };
  }

  function resetWorldOrigin() {
    worldOrigin = null;
    localStorage.removeItem(WORLD_ORIGIN_STORAGE_KEY);
    if (tileCache) {
      tileCache.setOrigin(null);
    } else {
      pendingMapRebuild = true;
    }
    currentRenderOrigin = null;
  }

  const GPS_SNAP_DISTANCE_METERS = 20;
  const GPS_TARGET_EPSILON_METERS = 0.35;
  const GPS_PATH_EPSILON_METERS = 0.05;

  const computePlayerMeters = (location) => {
    if (!worldOrigin || !location) return null;
    if (!Number.isFinite(location.lat) || !Number.isFinite(location.lon)) return null;
    const lonScale = metersPerDegreeLon(worldOrigin.lat);
    return {
      x: -(location.lon - worldOrigin.lon) * lonScale,
      z: (location.lat - worldOrigin.lat) * METERS_PER_DEGREE_LAT
    };
  };

  const isGpsPathBlocked = (from, to) => {
    if (!rapierWorld || !playerControls?.body) return false;
    if (!Number.isFinite(from?.x) || !Number.isFinite(from?.z)) return false;
    if (!Number.isFinite(to?.x) || !Number.isFinite(to?.z)) return false;
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const distance = Math.hypot(dx, dz);
    if (!Number.isFinite(distance) || distance <= GPS_TARGET_EPSILON_METERS) return false;
    const direction = new THREE.Vector3(dx / distance, 0, dz / distance);
    const ray = new RAPIER.Ray(
      { x: from.x, y: from.y ?? playerModel?.position?.y ?? 0, z: from.z },
      { x: direction.x, y: direction.y, z: direction.z }
    );
    const hit = rapierWorld.castRay(
      ray,
      distance,
      true,
      undefined,
      undefined,
      undefined,
      playerControls.body
    );
    if (!hit) return false;
    const hitDistance = hit.toi ?? hit.timeOfImpact ?? distance;
    return hitDistance < distance - GPS_PATH_EPSILON_METERS;
  };

  function getLocalMapOrigin() {
    if (worldOrigin) {
      return { centerLat: worldOrigin.lat, centerLon: worldOrigin.lon };
    }
    return currentRenderOrigin;
  }

  const geoToLocalMeters = (lat, lon, origin) => {
    if (!origin || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    const lonScale = metersPerDegreeLon(origin.centerLat);
    return {
      x: -(lon - origin.centerLon) * lonScale,
      z: (lat - origin.centerLat) * METERS_PER_DEGREE_LAT
    };
  };

  const localMetersToGeo = (x, z, origin) => {
    if (!origin || !Number.isFinite(x) || !Number.isFinite(z)) return null;
    const lonScale = metersPerDegreeLon(origin.centerLat);
    return {
      lat: origin.centerLat + z / METERS_PER_DEGREE_LAT,
      lon: origin.centerLon - x / lonScale
    };
  };

  homeSystem = createHomeSystem({
    scene,
    playerModel,
    playerControls,
    renderer,
    buildingsRenderer,
    profileNameKey,
    initialHome: playerProfile?.home ?? null,
    getLocalOrigin: getLocalMapOrigin,
    localMetersToGeo,
    geoToLocal: geoToLocalMeters
  });
  void homeSystem.loadStorageChest?.();
  window.homeSystem = homeSystem;

  function getLatestLocationFix() {
    const latest = window.latestLocation;
    if (!latest || !Number.isFinite(latest.lat) || !Number.isFinite(latest.lon)) {
      return null;
    }
    return latest;
  }

  const applyPlayerMeters = (playerMeters) => {
    if (!playerMeters || !playerModel || !playerControls) return;
    const nextY = playerModel.position.y;
    playerModel.position.set(playerMeters.x, nextY, playerMeters.z);
    playerControls.playerX = playerMeters.x;
    playerControls.playerY = nextY;
    playerControls.playerZ = playerMeters.z;
    playerControls.lastPosition.set(playerMeters.x, nextY, playerMeters.z);
    if (playerControls.body) {
      playerControls.body.setTranslation({ x: playerMeters.x, y: nextY, z: playerMeters.z }, true);
    }
    if (playerControls.geoBoundsCenterXZ) {
      playerControls.geoBoundsCenterXZ.set(playerMeters.x, 0, playerMeters.z);
    }
    if (playerControls.geoBoundsShiftMeters) {
      playerControls.geoBoundsShiftMeters.x = 0;
      playerControls.geoBoundsShiftMeters.z = 0;
    }
    playerControls.clearGpsMoveTarget?.();

  };

  worldOrigin = loadWorldOrigin();
  if (worldOrigin) {
    tileCache.setOrigin(worldOrigin);
  }

  const computeGeojsonBounds = (geojson) => {
    let minLon = Infinity;
    let maxLon = -Infinity;
    let minLat = Infinity;
    let maxLat = -Infinity;
    let count = 0;

    const updateBounds = (coord) => {
      if (!coord || coord.length < 2) return;
      const [lon, lat] = coord;
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;
      minLon = Math.min(minLon, lon);
      maxLon = Math.max(maxLon, lon);
      minLat = Math.min(minLat, lat);
      maxLat = Math.max(maxLat, lat);
      count += 1;
    };

    for (const feature of geojson?.features ?? []) {
      const geometry = feature?.geometry;
      if (!geometry) continue;
      if (geometry.type === "LineString") {
        geometry.coordinates.forEach(updateBounds);
      } else if (geometry.type === "MultiLineString") {
        geometry.coordinates.flat().forEach(updateBounds);
      } else if (geometry.type === "Polygon") {
        geometry.coordinates.flat().forEach(updateBounds);
      } else if (geometry.type === "MultiPolygon") {
        geometry.coordinates.flat(2).forEach(updateBounds);
      }
    }

    if (!Number.isFinite(minLon) || count === 0) {
      return null;
    }

    return {
      centerLon: (minLon + maxLon) / 2,
      centerLat: (minLat + maxLat) / 2
    };
  };

  const getRenderOrigin = (geojson) => {
    if (worldOrigin) {
      return { centerLat: worldOrigin.lat, centerLon: worldOrigin.lon };
    }
    if (currentRenderOrigin) {
      return currentRenderOrigin;
    }
    return computeGeojsonBounds(geojson);
  };

  const osmWorkerPending = new Map();
  let osmWorkerRequestId = 0;
  let osmWorker = null;

  const disableOsmWorker = (error) => {
    if (!osmWorker) return;
    console.warn('Disabling OSM worker due to error:', error);
    osmWorker.terminate();
    osmWorker = null;
    for (const { reject } of osmWorkerPending.values()) {
      reject(error);
    }
    osmWorkerPending.clear();
  };

  const initOsmWorker = () => {
    if (typeof Worker === "undefined") {
      return;
    }
    try {
      osmWorker = new Worker(new URL("./workers/osmWorker.js", import.meta.url), { type: "module" });
      osmWorker.addEventListener("message", (event) => {
        const { id, geojson, error } = event.data || {};
        if (id == null) return;
        const pending = osmWorkerPending.get(id);
        if (!pending) return;
        osmWorkerPending.delete(id);
        if (error) {
          pending.reject(new Error(error));
        } else {
          pending.resolve(geojson);
        }
      });
      osmWorker.addEventListener("error", (event) => disableOsmWorker(event));
    } catch (error) {
      console.warn('Failed to initialize OSM worker, falling back to main thread parsing.', error);
      osmWorker = null;
    }
  };

  const parseOverpassData = async (data) => {
    if (!osmWorker) {
      return overpassToGeoJSON(data);
    }
    const requestId = osmWorkerRequestId += 1;
    return new Promise((resolve, reject) => {
      osmWorkerPending.set(requestId, { resolve, reject });
      try {
        osmWorker.postMessage({ id: requestId, data });
      } catch (error) {
        osmWorkerPending.delete(requestId);
        reject(error);
      }
    });
  };

  initOsmWorker();

  function rebuildMapFromCache() {
    if (!tileCache || !mapRenderer || !buildingsRenderer) {
      pendingMapRebuild = true;
      return;
    }
    pendingMapRebuild = false;
    mapRebuildToken += 1;
    const rebuildId = mapRebuildToken;
    mapRenderer.clearTiles?.();
    buildingsRenderer.clearTiles?.();

    const combined = {
      type: 'FeatureCollection',
      features: []
    };
    for (const entry of tileCache.cache.values()) {
      if (entry.geojson?.features?.length) {
        combined.features.push(...entry.geojson.features);
      }
    }
    const bounds = getRenderOrigin(combined);
    if (bounds) {
      currentRenderOrigin = bounds;
    }

    for (const [tileKey, entry] of tileCache.cache.entries()) {
      if (!entry.geojson) continue;
      mapRenderer.updateTileHighways?.(tileKey, entry.geojson, bounds);
      buildingsRenderer.updateTileBuildings?.(tileKey, entry.geojson, bounds);
    }

    const finishBuildingRender = () => {
      if (rebuildId !== mapRebuildToken) return;
      rebuildBuildingColliders();
      liftEntitiesToBuildingTop();
      natureController?.refreshAll?.();
    };

    if (typeof requestIdleCallback === "function") {
      requestIdleCallback(finishBuildingRender, { timeout: 200 });
    } else {
      finishBuildingRender();
    }
  }

  window.clearTileCache = () => {
    tileCache.cache.clear();
    groundTiles.clear();
    clearCache().catch((error) => console.warn('Failed to clear persistent tile cache:', error));
    rebuildMapFromCache();
  };

  let buildingRefreshPending = false;
  const scheduleBuildingRefresh = () => {
    if (buildingRefreshPending) return;
    buildingRefreshPending = true;
    const refresh = () => {
      buildingRefreshPending = false;
      rebuildBuildingColliders();
      liftEntitiesToBuildingTop();
    };
    if (typeof requestIdleCallback === "function") {
      requestIdleCallback(refresh, { timeout: 200 });
    } else {
      setTimeout(refresh, 0);
    }
  };

  const updateTileMeshes = (tileKey, geojson) => {
    if (!tileKey || !geojson || !mapRenderer || !buildingsRenderer) return;
    const bounds = getRenderOrigin(geojson);
    if (bounds) {
      currentRenderOrigin = bounds;
    }
    mapRenderer.updateTileHighways?.(tileKey, geojson, bounds);

    const finishBuildingRender = () => {
      buildingsRenderer.updateTileBuildings?.(tileKey, geojson, bounds);
      scheduleBuildingRefresh();
      natureController?.refreshTile?.(tileKey);
    };

    if (typeof requestIdleCallback === "function") {
      requestIdleCallback(finishBuildingRender, { timeout: 200 });
    } else {
      finishBuildingRender();
    }
  };

  const shouldRequestMapUpdate = (location) => {
    if (!location || PERF.disableMapUpdates) return false;
    const localMeters = tileCache.getLocalMeters(location);
    const tile = tileCache.getTileCoords(localMeters);
    if (!tile) return false;
    const tileKey = tileCache.getTileKey(tile);
    const now = Date.now();
    if (lastMapUpdateAt === 0) {
      lastMapUpdateAt = now;
      lastMapUpdateTileKey = tileKey;
      return true;
    }
    const elapsed = now - lastMapUpdateAt;
    const tileChanged = tileKey !== lastMapUpdateTileKey;
    if (tileChanged || elapsed >= MAP_UPDATE_THROTTLE_MS) {
      lastMapUpdateAt = now;
      lastMapUpdateTileKey = tileKey;
      return true;
    }
    return false;
  };

  const requestMapUpdate = async (location) => {
    if (!location || PERF.disableMapUpdates) return;
    const localMeters = tileCache.getLocalMeters(location);
    const tile = tileCache.getTileCoords(localMeters);
    if (!tile) return;

    const tileKey = tileCache.getTileKey(tile);
    if (tileKey === activeTileKey && (tileCache.hasTile(tileKey) || mapFetchInFlight.has(tileKey))) {
      return;
    }
    activeTileKey = tileKey;

    const evictedKeys = tileCache.evictTiles(tile);
    if (evictedKeys.length) {
      for (const key of evictedKeys) {
        mapRenderer.removeTile?.(key);
        buildingsRenderer.removeTile?.(key);
      }
      scheduleBuildingRefresh();
    }

    if (tileCache.hasTile(tileKey) || mapFetchInFlight.has(tileKey)) {
      return;
    }

    const cachedTile = await getCachedTile(tileKey);
    if (cachedTile?.geojson) {
      tileCache.setTile(tile, {
        geojson: cachedTile.geojson,
        meshes: { highways: null, buildings: null },
        fetchedAt: cachedTile.fetchedAt
      });
      updateTileMeshes(tileKey, cachedTile.geojson);
      if (Date.now() - cachedTile.fetchedAt < TILE_CACHE_MAX_AGE_MS) {
        return;
      }
    }

    const tileCenter = tileCache.getTileCenterLocation(tile);
    if (!tileCenter) return;

    mapFetchInFlight.add(tileKey);
    let geojson;
    try {
      const overpassData = await fetchOSMData(tileCenter.lat, tileCenter.lon, TILE_FETCH_RADIUS_METERS);
      debugState.lastOsmFetchAt = Date.now();
      try {
        geojson = await parseOverpassData(overpassData);
      } catch (parseError) {
        console.warn('OSM worker parse failed, falling back to main thread:', parseError);
        geojson = overpassToGeoJSON(overpassData);
      }
    } catch (error) {
      console.warn('OSM fetch failed:', error);
      debugState.lastError = {
        message: error?.message || 'OSM fetch failed',
        timestamp: Date.now()
      };
      mapFetchInFlight.delete(tileKey);
      return;
    }

    try {
      tileCache.setTile(tile, {
        geojson,
        meshes: { highways: null, buildings: null },
        fetchedAt: Date.now()
      });
      setCachedTile(tileKey, geojson).catch((error) => {
        console.warn('Failed to persist tile cache:', error);
      });
      updateTileMeshes(tileKey, geojson);
    } catch (error) {
      console.warn('OSM render failed:', error);
      debugState.lastError = {
        message: error?.message || 'OSM render failed',
        timestamp: Date.now()
      };
    } finally {
      mapFetchInFlight.delete(tileKey);
    }
  };

  const locationState = {
    state: 'requesting',
    accuracyMeters: null,
    lat: null,
    lon: null,
    source: null,
    originLat: worldOrigin?.lat ?? null,
    originLon: worldOrigin?.lon ?? null,
    playerX: null,
    playerZ: null,
    tile: null,
    heading: null,
    speed: null,
    timestamp: null,
    message: null,
    permissionDenied: false
  };

  const debugState = {
    lastError: null,
    lastOsmFetchAt: null
  };

  const locationProvider = createLocationProvider({
    onUpdate: (location) => {
      window.latestLocation = location;
      if (!homeSystem?.isInsideHome) {
        playerControls?.setGeoCenter({ lat: location.lat, lon: location.lon });
      }
      if (!worldOrigin && Number.isFinite(location.accuracyMeters) && location.accuracyMeters <= 50) {
        setWorldOrigin({ lat: location.lat, lon: location.lon });
        rebuildMapFromCache();
      }
      locationState.state = 'found';
      locationState.lat = location.lat;
      locationState.lon = location.lon;
      locationState.accuracyMeters = location.accuracyMeters;
      locationState.source = location.source || null;
      locationState.originLat = worldOrigin?.lat ?? null;
      locationState.originLon = worldOrigin?.lon ?? null;
      locationState.heading = location.heading;
      locationState.speed = location.speed;
      locationState.timestamp = location.timestamp;
      locationState.message = null;
      locationState.permissionDenied = false;
      const playerMeters = computePlayerMeters(location);
      if (playerMeters) {
        locationState.playerX = playerMeters.x;
        locationState.playerZ = playerMeters.z;

        let allowGpsSnap = !homeSystem?.isInsideHome;
        if (homeSystem?.isInsideHome) {
          const homeGeo = homeSystem.getHomeGeo?.();
          const homeDistance = homeGeo
            ? distanceMeters(location.lat, location.lon, homeGeo.lat, homeGeo.lon)
            : null;
          if (location.source !== 'debug' && homeDistance != null && homeDistance > 50) {
            homeSystem.exitHome();
            allowGpsSnap = true;
          } else {
            allowGpsSnap = false;
          }
        }

        if (allowGpsSnap) {
          if (mapViewEnabled) {
            applyPlayerMeters(playerMeters);
            didInitialGpsSnap = true;
            playerControls?.clearGpsMoveTarget?.();
          } else if (!didInitialGpsSnap) {
            applyPlayerMeters(playerMeters);
            didInitialGpsSnap = true;
          } else if (playerControls && playerModel) {
            const currentPos = playerControls.body?.translation?.() ?? playerModel.position;
            if (currentPos && Number.isFinite(currentPos.x) && Number.isFinite(currentPos.z)) {
              const dx = playerMeters.x - currentPos.x;
              const dz = playerMeters.z - currentPos.z;
              const distance = Math.hypot(dx, dz);
              if (distance > GPS_SNAP_DISTANCE_METERS) {
                playerControls.clearGpsMoveTarget?.();
                applyPlayerMeters(playerMeters);
              } else if (distance > GPS_TARGET_EPSILON_METERS) {
                const blocked = isGpsPathBlocked(
                  currentPos,
                  {
                    x: playerMeters.x,
                    y: currentPos.y ?? playerModel.position.y,
                    z: playerMeters.z
                  }
                );
                if (blocked) {
                  playerControls.clearGpsMoveTarget?.();
                  applyPlayerMeters(playerMeters);
                } else {
                  playerControls.setGpsMoveTarget?.({
                    x: playerMeters.x,
                    y: currentPos.y ?? playerModel.position.y,
                    z: playerMeters.z
                  });
                }
              } else {
                playerControls.clearGpsMoveTarget?.();
              }
            }
          }
        }
      } else {
        locationState.playerX = null;
        locationState.playerZ = null;
      }

      const localMeters = tileCache.getLocalMeters(location);
      locationState.tile = tileCache.getTileCoords(localMeters);
      if (shouldRequestMapUpdate(location)) {
        requestMapUpdate(location);
      }
      const playerPosition = playerModel?.position;
      if (shouldUpdatePickupTiles(playerPosition)) {
        updatePickupTiles(playerPosition);
      }
    },
    onError: (error, message) => {
      console.warn('Location error:', message, error);
      locationState.state = 'error';
      locationState.message = message;
      locationState.permissionDenied = error?.code === error?.PERMISSION_DENIED;
      debugState.lastError = { message, timestamp: Date.now() };
    },
    onStatus: (status) => {
      locationState.state = status.state;
      locationState.message = status.message || null;
      locationState.accuracyMeters = status.accuracy ?? locationState.accuracyMeters;
      if (status.source) {
        locationState.source = status.source;
      }
      if (status.state === 'requesting' || status.state === 'found') {
        locationState.permissionDenied = false;
      }
    }
  });

  homeSystem?.setLocationProvider?.(locationProvider);
  locationProvider.start();
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      locationProvider.stop();
    } else {
      locationProvider.start();
    }
  });
  window.addEventListener('beforeunload', () => locationProvider.stop());

  // --- RAPIER HELPERS ---
  function spawnBlock({
    pos = new THREE.Vector3(0, 5, 0),
    half = new THREE.Vector3(0.25, 0.25, 0.25),
    linvel = new THREE.Vector3(),
    angvel = new THREE.Vector3(Math.random(), Math.random(), Math.random()),
    color = 0x66ccff,
  } = {}) {
    // Three mesh
    const geom = new THREE.BoxGeometry(half.x * 2, half.y * 2, half.z * 2);
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.0 });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.skipTerrainCorrection = true;
    mesh.position.copy(pos);
    scene.add(mesh);

    // Rapier body + collider
    const rbDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(pos.x, pos.y, pos.z)
      .setLinearDamping(0.02)
      .setAngularDamping(0.02);
    const rb = rapierWorld.createRigidBody(rbDesc);

    // Give it a fun impulse/velocity
    rb.setLinvel({ x: linvel.x, y: linvel.y, z: linvel.z }, true);
    rb.setAngvel({ x: angvel.x, y: angvel.y, z: angvel.z }, true);

    const colDesc = RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z)
      .setRestitution(0.2)
      .setFriction(0.6);
    rapierWorld.createCollider(colDesc, rb);

    rbToMesh.set(rb, mesh);
    return rb;
  }

  function shootBlockFromPlayer(speed = 18) {
    const origin = playerModel.position.clone().add(new THREE.Vector3(0, 0, 0));

    // forward from camera so it goes where you're looking
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion).normalize();
    const linvel = dir.multiplyScalar(speed);

    spawnBlock({
      pos: origin.add(dir.clone().multiplyScalar(1.2)),
      linvel,
      color: 0xff8855,
      half: new THREE.Vector3(0.3, 0.3, 0.3),
    });
  }

  // Little “machine gun” for fun
  let burstInterval = null;
  function startBurst() {
    if (burstInterval) return;
    burstInterval = setInterval(() => shootBlockFromPlayer(22), 120);
  }
  function stopBurst() {
    if (!burstInterval) return;
    clearInterval(burstInterval);
    burstInterval = null;
  }

  // Keyboard shortcuts
  window.addEventListener('keydown', (e) => {
    
    if (e.code === 'KeyB') {
      shootBlockFromPlayer(); // tap B to fire one block
      console.log("b key pressed");
    }
    if (e.code === 'KeyN') startBurst();          // hold N to start burst
  });
  window.addEventListener('keyup', (e) => {
    if (e.code === 'KeyN') stopBurst();
  });

  // Expose for console testing
  window.spawnBlock = spawnBlock;
  window.shootBlockFromPlayer = shootBlockFromPlayer;



  // Game Over UI elements
  const gameOverOverlay = document.getElementById('game-over-overlay');
  const gameOverMessage = document.getElementById('game-over-message');
  const continueSection = document.getElementById('continue-section');
  const countdownEl = document.getElementById('countdown');
  const yesBtn = document.getElementById('continue-yes');
  const noBtn = document.getElementById('continue-no');

  function showGameOver() {
    gameOverOverlay.classList.remove('hidden');
    continueSection.classList.add('hidden');
    gameOverMessage.style.opacity = 0;
    gameOverMessage.classList.remove('hidden');
    setTimeout(() => {
      gameOverMessage.style.opacity = 1;
      setTimeout(() => {
        gameOverMessage.style.opacity = 0;
        setTimeout(() => {
          gameOverMessage.classList.add('hidden');
          showContinue();
        }, 1000);
      }, 1500);
    }, 50);
  }

  function showContinue() {
    continueSection.classList.remove('hidden');
    let countdown = 9;
    countdownEl.textContent = countdown;
    const interval = setInterval(() => {
      countdown--;
      countdownEl.textContent = countdown;
      if (countdown <= 0) {
        clearInterval(interval);
        hideGameOver();
      }
    }, 1000);

    yesBtn.onclick = () => {
      clearInterval(interval);
      hideGameOver();
      respawnPlayer();
    };

    noBtn.onclick = () => {
      clearInterval(interval);
      hideGameOver();
    };
  }

  function hideGameOver() {
    gameOverOverlay.classList.add('hidden');
    continueSection.classList.add('hidden');
    gameOverMessage.classList.add('hidden');
    gameOverMessage.style.opacity = 0;
  }

  function respawnPlayer() {
    setStat('health', 100);
    setStat('hunger', 100);
    setStat('energy', 100);
    const spawn = getSpawnPosition();
    liftPositionToBuildingTop(spawn, 0.6);
    playerModel.position.set(spawn.x, spawn.y, spawn.z);
    playerControls.playerX = spawn.x;
    playerControls.playerY = spawn.y;
    playerControls.playerZ = spawn.z;
    playerControls.lastPosition.set(spawn.x, spawn.y, spawn.z);
    if (playerControls.body) {
      playerControls.body.setTranslation({ x: spawn.x, y: spawn.y, z: spawn.z }, true);
      playerControls.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      playerControls.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }
    playerDead = false;
    updateControlAvailability();
    const actions = playerModel.userData.actions;
    const current = playerModel.userData.currentAction;
    actions?.[current]?.fadeOut(0.2);
    actions?.idle?.reset().fadeIn(0.2).play();
    playerModel.userData.currentAction = 'idle';
  }

  const voiceTranscript = document.getElementById('voice-transcript');
  let voiceTranscriptTimer = null;
  const showVoiceTranscript = (text) => {
    if (!voiceTranscript) return;
    voiceTranscript.textContent = text;
    voiceTranscript.classList.add('visible');
    if (voiceTranscriptTimer) {
      clearTimeout(voiceTranscriptTimer);
    }
    voiceTranscriptTimer = setTimeout(() => {
      voiceTranscript.classList.remove('visible');
    }, 2500);
  };

  // Initialize speech-to-text overlay for voice input
  const speech = initSpeechCommands({
    onTranscript: showVoiceTranscript
  });
  const talkButton = document.getElementById('talk-button');
  if (talkButton) {
    let talking = false;
    const startTalking = (e) => {
      e.preventDefault();
      if (!talking) {
        talking = true;
        speech.start();
      }
    };
    const stopTalking = (e) => {
      if (talking) {
        if (e) e.preventDefault();
        talking = false;
        speech.stop();
      }
    };
    talkButton.addEventListener('mousedown', startTalking);
    talkButton.addEventListener('touchstart', startTalking);
    window.addEventListener('mouseup', stopTalking);
    window.addEventListener('touchend', stopTalking);
    window.addEventListener('touchcancel', stopTalking);
  }


  function swapPlayerCharacter(newModelPath) {
    if (!newModelPath || newModelPath === characterModel) {
      return;
    }

    const previousModel = playerModel;
    const previousLabel = player?.nameLabel;
    const currentPosition = previousModel ? previousModel.position.clone() : new THREE.Vector3();
    const currentRotation = previousModel ? previousModel.rotation.clone() : new THREE.Euler();
    const currentUp = previousModel ? previousModel.up.clone() : new THREE.Vector3(0, 1, 0);

    if (playerControls?.parachute && previousModel && playerControls.parachute.parent === previousModel) {
      previousModel.remove(playerControls.parachute);
    }

    const newPlayer = new PlayerCharacter(playerName, newModelPath);
    const newModel = newPlayer.model;
    newModel.userData.hideInMapView = true;
    newModel.position.copy(currentPosition);
    newModel.rotation.copy(currentRotation);
    newModel.up.copy(currentUp);

    scene.add(newModel);

    if (playerControls?.parachute) {
      newModel.add(playerControls.parachute);
    }

    if (previousModel?.parent) {
      previousModel.parent.remove(previousModel);
    }
    if (previousLabel?.parentNode) {
      previousLabel.parentNode.removeChild(previousLabel);
    }

    player = newPlayer;
    playerModel = newModel;
    window.playerModel = playerModel;
    playerControls?.setPlayerModel(playerModel);
    initMapView({ camera, scene, player: playerModel });
  }

  const settingsBtn = document.getElementById('settings-button');
  const characterOptions = ['base_character', 'andy', 'chris', 'old_man', 'wizard', 'rainbow_troll', 'alien_bumpy_bump', 'swamp_guy', 'cowboy'].map(name => ({
    label: name,
    value: `/models/${name}.fbx`
  }));

  multiplayer.onConnectionError = (error) => {
    debugState.lastError = error;
  };

  const appState = {
    getPlayerName: () => playerName,
    setPlayerName: (name) => {
      if (!name) return;
      playerName = name;
      if (player?.nameLabel) {
        player.nameLabel.innerText = playerName;
      }
      updatePlayerInfoUI();
      setCookie("playerName", playerName);
      localStorage.setItem('playerName', playerName);
      if (multiplayer) {
        multiplayer.playerName = playerName;
      }
    },
    savePlayerName: async (nextName) => {
      const trimmedName = nextName?.trim();
      if (!trimmedName) {
        return { status: 'invalid' };
      }
      if (trimmedName === playerName) {
        return { status: 'unchanged' };
      }
      try {
        const result = await renameProfile(playerName, profileNameKey, trimmedName);
        if (result.status === 'ok') {
          profileNameKey = result.nameKey;
          playerProfile.name = result.profile?.name || trimmedName;
          appState.setPlayerName(result.profile?.name || trimmedName);
          if (homeSystem) {
            homeSystem.profileNameKey = profileNameKey;
          }
        }
        return result;
      } catch (error) {
        console.error('Failed to rename profile:', error);
        return { status: 'error' };
      }
    },
    getCharacterModel: () => characterModel,
    setCharacterModel: (modelPath) => {
      if (!modelPath || modelPath === characterModel) return;
      characterModel = modelPath;
      swapPlayerCharacter(characterModel);
      setCookie("characterModel", characterModel);
      localStorage.setItem('characterModel', characterModel);
    },
    getPlayerStats: () => ({ ...statsState }),
    getCharacterOptions: () => characterOptions,
    getInventory: () => getInventory(),
    getHomeStorage: () => getHomeStorage(),
    getEquippedInventoryItemId: () => getEquippedInventoryItemId(),
    isInventoryItemEquipped: (itemId) => isInventoryItemEquipped(itemId),
    getInventoryItemActions: (itemId) => getInventoryItemActions(itemId),
    equipInventoryItem: (itemId) => equipInventoryItem(itemId),
    unequipInventoryItem: (itemId) => unequipInventoryItem(itemId),
    dropInventoryItem: (itemId) => dropInventoryItem(itemId),
    eatInventoryItem: (itemId) => eatInventoryItem(itemId),
    addToInventory: (itemId, amount) => addToInventory(itemId, amount),
    removeFromInventory: (itemId, amount) => removeFromInventory(itemId, amount),
    storeHomeStorageItem: (itemId) => storeHomeStorageItem(itemId),
    takeOutHomeStorageItem: (itemId) => takeOutHomeStorageItem(itemId),
    getConnectedPlayers: () => {
      const players = [];
      const playerPos = playerModel?.position;
      const localFix = getLatestLocationFix();
      const connections = multiplayer?.connections || {};
      Object.keys(connections).forEach((id) => {
        const other = otherPlayers[id];
        let distance = remotePresenceMeta[id]?.lastDistance ?? null;
        if (distance == null && localFix && Number.isFinite(remotePresenceMeta[id]?.lastLat) && Number.isFinite(remotePresenceMeta[id]?.lastLon)) {
          distance = distanceMeters(localFix.lat, localFix.lon, remotePresenceMeta[id].lastLat, remotePresenceMeta[id].lastLon);
        }
        if (distance == null && other?.model && playerPos) {
          distance = playerPos.distanceTo(other.model.position);
        }
        players.push({
          id,
          name: other?.name || `Player ${id.slice(0, 4)}`,
          distance
        });
      });
      return players;
    },
    getConnectionStatus: () => {
      if (!multiplayer?.peer) return 'Connecting';
      if (multiplayer.peer.destroyed) return 'Disconnected';
      if (multiplayer.peer.disconnected) return 'Disconnected';
      if (multiplayer.peer.open) return 'Connected';
      return 'Connecting';
    },
    getLastPing: () => multiplayer?.lastPingMs,
    getLastOsmFetch: () => debugState.lastOsmFetchAt,
    getLastError: () => {
      const networkError = multiplayer?.lastError;
      const generalError = debugState.lastError;
      if (!networkError) return generalError;
      if (!generalError) return networkError;
      return (networkError.timestamp || 0) >= (generalError.timestamp || 0) ? networkError : generalError;
    },
    getAppVersion: () => import.meta.env?.VITE_APP_VERSION || import.meta.env?.VITE_GIT_COMMIT || 'unknown',
    getDisplaySettings: () => ({ ...displaySettings }),
    setDisplayMode: (mode) => setDisplayMode(mode),
    setDisplaySetting: (key, value) => setDisplaySetting(key, value),
    resetWorldOrigin: () => {
      resetWorldOrigin();
      locationState.originLat = null;
      locationState.originLon = null;
      locationState.playerX = null;
      locationState.playerZ = null;
      locationState.tile = null;
      rebuildMapFromCache();
      didInitialGpsSnap = false;
      window.clearTileCache?.();
    },
    deleteAccount: async () => {
      if (!profileNameKey) {
        return { status: 'missing-key' };
      }
      const result = await deleteProfileData(profileNameKey, playerName);
      if (result.status === 'ok') {
        localStorage.removeItem('playerName');
        localStorage.removeItem('characterModel');
        setCookie('playerName', '', -1);
        setCookie('characterModel', '', -1);
        clearStoredPin(playerName);
        window.location.reload();
      }
      return result;
    }
  };

  window.getInventory = getInventory;
  window.addToInventory = addToInventory;
  window.removeFromInventory = removeFromInventory;
  window.openHomeStorage = openHomeStorage;
  window.pickupMushroom = pickupMushroom;
  window.pickupApple = pickupApple;

  const locationAdapter = {
    getState: () => ({ ...locationState }),
    retry: () => locationProvider.retry(),
    getDebugState: () => locationProvider.getDebugState(),
    setDebugEnabled: (enabled) => locationProvider.setDebugEnabled(enabled),
    setDebugLocation: (coords) => locationProvider.setDebugLocation(coords),
    setDebugAccuracy: (accuracyMeters) => locationProvider.setDebugAccuracy(accuracyMeters),
    stepDebugLocation: (delta) => locationProvider.stepDebugLocation(delta)
  };

  initSettingsPanel({
    appState,
    multiplayer,
    location: locationAdapter,
    player
  });
  initCustomizeUI({
    getPlayerModel: () => playerModel,
    getPlayerControls: () => playerControls,
    initialCustomization: playerProfile?.customization,
    onSaveCustomization: async (customization) => {
      playerProfile.customization = customization;
      if (!profileNameKey) return;
      await saveCustomization(profileNameKey, customization);
    }
  });
  initHomeStoragePanel({ appState });

  settingsBtn.addEventListener('click', () => {
    openSettings();
  });

  setInterval(() => {
    updateSettingsUI();
    updateHomeStorageUI();
  }, 1000);
  updateAutoDisplayMode();
  setInterval(() => {
    updateAutoDisplayMode();
  }, 60 * 1000);

  const consoleDiv = document.getElementById("console-log");
  if (window.DEBUG_CONSOLE === true) {
    (function() {
      const originalLog = console.log;
      console.log = function(...args) {
        originalLog(...args);
        if (!consoleDiv) return;
        const msg = document.createElement("div");
        msg.textContent = args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(" ");
        consoleDiv.appendChild(msg);
        consoleDiv.scrollTop = consoleDiv.scrollHeight;
      };
    })();
  }

  function animate() {
    requestAnimationFrame(animate);

    // --- RAPIER FIXED-STEP & SYNC ---
    // Accumulate variable rAF time into fixed physics steps
    const frameDelta = clock.getDelta();
    if (mapViewEnabled && playerControls?.body && playerModel) {
      const { x, y, z } = playerModel.position;
      playerControls.body.setTranslation({ x, y, z }, true);
      playerControls.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      playerControls.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }
    physicsAccumulator += frameDelta;
    while (physicsAccumulator >= FIXED_DT) {
      // applyGlobalGravity(rapierWorld, window.moon);
      rapierWorld.step();
      physicsAccumulator -= FIXED_DT;
    }

    // Sync Rapier bodies -> Three meshes
    for (const [rb, mesh] of rbToMesh.entries()) {
      const t = rb.translation();
      const r = rb.rotation();
      mesh.position.set(t.x, t.y, t.z);
      mesh.quaternion.set(r.x, r.y, r.z, r.w);

      if (!mesh.userData?.isTerrain && !mesh.userData?.skipTerrainCorrection) {
        mesh.updateMatrixWorld();
        const bbox = new THREE.Box3().setFromObject(mesh);
        const terrainY = getTerrainHeight(mesh.position.x, mesh.position.z);
        if (bbox.min.y < terrainY) {
          const correction = terrainY - bbox.min.y;
          mesh.position.y += correction;
          rb.setTranslation({ x: mesh.position.x, y: mesh.position.y, z: mesh.position.z }, true);
          const lv = rb.linvel();
          if (lv.y < 0) {
            rb.setLinvel({ x: lv.x, y: 0, z: lv.z }, true);
          }
        }
      }

      // Simple cleanup: remove if it falls far below the world
      if (mesh.position.y < -50) {
        disposeSceneObject(mesh);
        rbToMesh.delete(rb);
        rapierWorld.removeRigidBody(rb);
      }
    }



    const playerPosition = playerModel?.position;
    updateGroundTiles(playerPosition);
    natureController?.update(playerPosition);
    if (shouldUpdatePickupTiles(playerPosition)) {
      updatePickupTiles(playerPosition);
    }

    if (!mapViewEnabled) {
      playerControls.update();
    }
    updateMapView(frameDelta, {
      monsters,
      friendlies: friendlyNpcManager?.friendlies
    });

    const now = performance.now();
    if (now - lastPerfUpdateMs >= 1000) {
      debugPerf.monsters = monsters.length;
      debugPerf.ammoPickups = ammoPickups.length;
      debugPerf.foodPickups = foodPickups.length;
      debugPerf.healthPickups = healthPickups.length;
      debugPerf.coinPickups = coinPickups.length;
      debugPerf.tileCacheSize = tileCache.cache.size;
      lastPerfUpdateMs = now;
    }
    statDecayAccumulator += frameDelta;
    if (statDecayAccumulator >= 1) {
      const elapsedSeconds = statDecayAccumulator;
      statDecayAccumulator = 0;
      let statsChanged = false;

      if (statsState.hunger > 0) {
        const hungerDecay = HUNGER_DECAY_PER_HOUR * (elapsedSeconds / 3600);
        if (hungerDecay > 0) {
          setStat('hunger', statsState.hunger - hungerDecay, { skipSave: true });
          statsChanged = true;
        }
      }

      const isMoving = playerControls?.isMoving;
      if (isMoving && statsState.energy > 0) {
        const energyDecay = ENERGY_DECAY_PER_SECOND_WHILE_MOVING * elapsedSeconds;
        if (energyDecay > 0) {
          setStat('energy', statsState.energy - energyDecay, { skipSave: true });
          statsChanged = true;
        }
      }

      if (statsState.hunger <= 0 && statsState.health > 0) {
        const healthDecay = HUNGER_HEALTH_DECAY_PER_SECOND * elapsedSeconds;
        if (healthDecay > 0) {
          setStat('health', statsState.health - healthDecay, { skipSave: true });
          statsChanged = true;
        }
      }

      if (statsChanged) {
        lastStatUpdateAt = Date.now();
        saveStatsThrottled(profileNameKey, statsState, lastStatUpdateAt);
      }
    }

    const pickupTime = performance.now() * 0.002;
    const shouldCheckPickups = !PERF.throttlePickups || now - lastPickupCheckMs >= PICKUP_CHECK_INTERVAL_MS;
    if (shouldCheckPickups) {
      lastPickupCheckMs = now;
    }

    if (PERF.disablePickups) {
      for (let i = ammoPickups.length - 1; i >= 0; i--) {
        const pickup = ammoPickups[i];
        if (!pickup) continue;
        disposePickup(pickup);
        ammoPickups.splice(i, 1);
      }
      droppedAmmoPickups.forEach((entry, id) => {
        if (!entry?.mesh) return;
        disposePickup(entry.mesh);
        droppedAmmoPickups.delete(id);
      });
      for (let i = foodPickups.length - 1; i >= 0; i--) {
        const pickup = foodPickups[i];
        if (!pickup) continue;
        disposePickup(pickup);
        foodPickups.splice(i, 1);
      }
      for (let i = healthPickups.length - 1; i >= 0; i--) {
        const pickup = healthPickups[i];
        if (!pickup) continue;
        disposePickup(pickup);
        healthPickups.splice(i, 1);
      }
      for (let i = coinPickups.length - 1; i >= 0; i--) {
        const pickup = coinPickups[i];
        if (!pickup) continue;
        disposePickup(pickup);
        coinPickups.splice(i, 1);
      }
      for (let i = mushroomPickups.length - 1; i >= 0; i--) {
        const pickup = mushroomPickups[i];
        if (!pickup) continue;
        disposeMushroomPickup(pickup);
        mushroomPickups.splice(i, 1);
      }
      for (let i = applePickups.length - 1; i >= 0; i--) {
        const pickup = applePickups[i];
        if (!pickup) continue;
        disposeApplePickup(pickup);
        applePickups.splice(i, 1);
      }
    } else {
      for (let i = ammoPickups.length - 1; i >= 0; i--) {
        const pickup = ammoPickups[i];
        if (!pickup) continue;

        if (pickup.userData.baseY === undefined) {
          pickup.userData.baseY = pickup.position.y;
        }

        const phase = pickup.userData.phase ?? 0;
        if (!pickup.userData.noFloat) {
          pickup.rotation.y += 0.03;
          pickup.position.y = pickup.userData.baseY + Math.sin(pickupTime + phase) * 0.1;
        }
        if (pickup.userData.sparkle && pickup.userData.sparkleLight) {
          pickup.userData.sparkleLight.intensity = 0.4 + Math.sin(pickupTime * 2 + phase) * 0.3;
        }

        if (shouldCheckPickups && !playerDead && playerModel.position.distanceTo(pickup.position) < 1.2) {
          const ammoType = pickup.userData.type || 'ammo';
          const amount = Number.isFinite(pickup.userData.amount)
            ? pickup.userData.amount
            : AMMO_PICKUP_AMOUNT;
          addAmmoForType(ammoType, amount);
          const popupLabel = getAmmoLabelForType(ammoType);
          const displayAmount = ammoType === 'arrow'
            ? (bow?.holder === playerControls
              ? playerControls.ammo
              : inventoryState.bow?.[ARROW_AMMO_KEY] ?? amount)
            : (iceGun?.holder === playerControls
              ? playerControls.ammo
              : inventoryState.iceGun?.[ICE_AMMO_KEY] ?? amount);
          showAmmoPopup(displayAmount, popupLabel);
          disposePickup(pickup);
          ammoPickups.splice(i, 1);
        }
      }

      droppedAmmoPickups.forEach((entry, id) => {
        const pickup = entry?.mesh;
        if (!pickup) return;

        if (pickup.userData.baseY === undefined) {
          pickup.userData.baseY = pickup.position.y;
        }

        if (!pickup.userData.noFloat) {
          pickup.rotation.y += 0.03;
          const phase = pickup.userData.phase ?? 0;
          pickup.position.y = pickup.userData.baseY + Math.sin(pickupTime + phase) * 0.1;
        }

        if (shouldCheckPickups && !playerDead && playerModel.position.distanceTo(pickup.position) < 1.2) {
          const amount = Number.isFinite(entry.amount)
            ? entry.amount
            : (Number.isFinite(pickup.userData.amount) ? pickup.userData.amount : AMMO_PICKUP_AMOUNT);
          addAmmoForType('ammo', amount);
          const displayAmount = iceGun?.holder === playerControls
            ? playerControls.ammo
            : (inventoryState.iceGun?.[ICE_AMMO_KEY] ?? amount);
          showAmmoPopup(displayAmount, getAmmoLabelForType('ammo'));
          removeDroppedAmmoPickup(id);
          if (multiplayer && !multiplayer.isHost) {
            pendingDropRemovals.add(id);
            multiplayer.send({ type: 'dropPickup', dropId: id });
          }
        }
      });

      for (let i = foodPickups.length - 1; i >= 0; i--) {
        const pickup = foodPickups[i];
        if (!pickup) continue;

        if (pickup.userData.baseY === undefined) {
          pickup.userData.baseY = pickup.position.y;
        }

        pickup.rotation.y += 0.03;
        const phase = pickup.userData.phase ?? 0;
        pickup.position.y = pickup.userData.baseY + Math.sin(pickupTime + phase) * 0.1;

        if (shouldCheckPickups && !playerDead && playerModel.position.distanceTo(pickup.position) < PICKUP_RADIUS) {
          applyFoodPickupEffects();
          disposePickup(pickup);
          foodPickups.splice(i, 1);
        }
      }

      for (let i = healthPickups.length - 1; i >= 0; i--) {
        const pickup = healthPickups[i];
        if (!pickup) continue;

        if (pickup.userData.baseY === undefined) {
          pickup.userData.baseY = pickup.position.y;
        }

        pickup.rotation.y += 0.03;
        const phase = pickup.userData.phase ?? 0;
        pickup.position.y = pickup.userData.baseY + Math.sin(pickupTime + phase) * 0.1;

        if (shouldCheckPickups && !playerDead && playerModel.position.distanceTo(pickup.position) < PICKUP_RADIUS) {
          applyHealthPickupEffects();
          disposePickup(pickup);
          healthPickups.splice(i, 1);
        }
      }

      for (let i = coinPickups.length - 1; i >= 0; i--) {
        const pickup = coinPickups[i];
        if (!pickup) continue;

        if (pickup.userData.baseY === undefined) {
          pickup.userData.baseY = pickup.position.y;
        }

        pickup.rotation.z += 0.10;
        const phase = pickup.userData.phase ?? 0;
        pickup.position.y = pickup.userData.baseY + Math.sin(pickupTime + phase) * 0.1;

        if (shouldCheckPickups && !playerDead && playerModel.position.distanceTo(pickup.position) < PICKUP_RADIUS) {
          applyCoinPickupEffects();
          disposePickup(pickup);
          coinPickups.splice(i, 1);
        }
      }

      for (let i = mushroomPickups.length - 1; i >= 0; i--) {
        const pickup = mushroomPickups[i];
        if (!pickup?.mesh) {
          mushroomPickups.splice(i, 1);
          continue;
        }
      }
      for (let i = applePickups.length - 1; i >= 0; i--) {
        const pickup = applePickups[i];
        if (!pickup?.mesh) {
          applePickups.splice(i, 1);
          continue;
        }
      }
    }

    iceGun?.update();
    bow?.update();
    autumnSword?.update();
    lantern?.update();
    if (bowHeldArrow) {
      const shouldShowArrow = bow?.holder === playerControls && playerControls?.isFireHeld;
      bowHeldArrow.visible = shouldShowArrow;
    }
    updateWeaponMarker(iceGun, iceGunMarker, 0.03);
    updateWeaponMarker(bow, bowMarker, 0.03);
    updateWeaponMarker(autumnSword, autumnSwordMarker, 0.03);
    updateWeaponMarker(lantern, lanternMarker, 0.03);
    droppedWeaponPickups.forEach(pickup => {
      updateWeaponMarker(pickup, pickup.marker, 0.03, pickup.markerOffsetY ?? 1.2);
    });
    const localStates = collectLocalControlStates();

    if (multiplayer.isHost) {
      localStates.forEach(({ state, sourceId }, id) => {
        updateAuthoritativeState(id, state, sourceId);
      });

      if (now - lastEntityBroadcast >= ENTITY_BROADCAST_INTERVAL) {
        const shouldSendFull = now - lastFullEntityBroadcast >= ENTITY_FULL_SNAPSHOT_INTERVAL;
        const payload = shouldSendFull
          ? serializeFullAuthoritativeStates()
          : serializeDirtyAuthoritativeStates();
        if (Object.keys(payload).length > 0) {
          multiplayer.send({ type: 'entityStates', states: payload });
          if (shouldSendFull) {
            lastFullEntityBroadcast = now;
          }
        }
        lastEntityBroadcast = now;
      }
    } else if (localStates.size > 0 && now - lastControlSend >= CONTROL_SEND_INTERVAL) {
      localStates.forEach(({ state, sourceId }, id) => {
        multiplayer.send({ type: 'entityControl', id, state, sourceId });
      });
      lastControlSend = now;
    }

    if (window.localHealth <= 0 && !playerDead) {
      playerDead = true;
      window.onPlayerDeath?.();
      dropInventoryOnDeath();
      updateControlAvailability();
      const actions = playerModel.userData.actions;
      const current = playerModel.userData.currentAction;
      const die = actions?.die;
      if (die) {
        actions[current]?.fadeOut(0.2);
        die.reset().fadeIn(0.2).play();
        playerModel.userData.currentAction = 'die';
      }
      showGameOver();
    }

    const mixerDelta = mixerClock.getDelta();

    // 1) Always advance animation mixers (every frame)
    Object.values(otherPlayers).forEach(p => {
      p.model?.userData?.mixer?.update(mixerDelta);
    });

    for (const monster of monsters) {
      monster?.model?.userData?.mixer?.update(mixerDelta);
    }

    // 2) AI can still be throttled, but pass a real delta when you DO run it
    const aiNowMs = Date.now();
    monsters.forEach(monster => {
      if (!monster?.model) return;
      if (monster.shouldRemoveAfterDeath?.(aiNowMs)) {
        cleanupMonster(monster);
      }
    });
    const isHostNow = !multiplayer || multiplayer.isHost;

    if (isHostNow) {
      if (monstersSeeded) {
        ensureMonsters();
        monsters.forEach(monster => {
          if (!monster || !monster.model) return;

          if (monster.isDead) return; // your respawn logic here...

          if (PERF.throttleAI) {
            const last = monster.lastAIUpdateMs ?? 0;
            if (aiNowMs - last > 150) {
              monster.lastAIUpdateMs = aiNowMs;
              monster.updateAI(mixerDelta, playerModel, otherPlayers); // <-- use mixerDelta
            }
          } else {
            monster.updateAI(mixerDelta, playerModel, otherPlayers);   // <-- use mixerDelta
          }
        });
      }
    } else {
      // non-host prediction
      monsters.forEach(monster => monster?.update?.(mixerDelta));
    }

    // Friendlies: same idea—do NOT pass 0 deltas
    friendlyNpcManager?.update({ delta: mixerDelta, isHost: isHostNow });


    if (now - lastPresenceSweep >= PRESENCE_SWEEP_MS) {
      lastPresenceSweep = now;
      const localFix = getLatestLocationFix();
      const mapOrigin = getLocalMapOrigin();
      Object.entries(remotePresenceMeta).forEach(([remoteId, meta]) => {
        if (!meta) return;
        if (now - meta.lastSeenMs > PRESENCE_STALE_MS) {
          removeRemotePlayer(remoteId, 'stale');
          return;
        }
        const player = otherPlayers[remoteId];
        if (!localFix || !mapOrigin) {
          if (player?.model) {
            player.model.visible = true;
          }
          if (player?.nameLabel) {
            player.nameLabel.style.display = 'block';
          }
          return;
        }
        if (!worldAnchorMatchesLocal(meta.worldAnchor)) {
          if (player?.model) {
            player.model.visible = true;
          }
          if (player?.nameLabel) {
            player.nameLabel.style.display = 'block';
          }
          return;
        }
        let dist = null;
        if (Number.isFinite(meta.lastLat) && Number.isFinite(meta.lastLon)) {
          dist = distanceMeters(localFix.lat, localFix.lon, meta.lastLat, meta.lastLon);
        } else if (player?.model && playerModel) {
          dist = playerModel.position.distanceTo(player.model.position);
        }
        meta.lastDistance = dist;
        logNet('distance', remoteId, dist);
        if (dist != null && dist > PLAYER_VISIBILITY_RADIUS_M) {
          removeRemotePlayer(remoteId, 'out-of-range');
        } else if (player?.model) {
          player.model.visible = true;
        }
      });
    }

    Object.values(otherPlayers).forEach(player => {
      if (!player?.model || !player?.targetPos || !player?.targetQuat) return;
      const currentPos = player.model.position;
      const distance = currentPos.distanceTo(player.targetPos);
      if (distance > REMOTE_TELEPORT_THRESHOLD_M) {
        currentPos.copy(player.targetPos);
      } else {
        currentPos.lerp(player.targetPos, REMOTE_LERP_ALPHA);
      }
      player.model.quaternion.slerp(player.targetQuat, REMOTE_LERP_ALPHA);
    });

    if (now - lastPresenceSend >= PRESENCE_SEND_MS) {
      const localFix = getLatestLocationFix();
      const mapOrigin = getLocalMapOrigin();
      const payload = {
        type: "presence",
        id: multiplayer.getId(),
        name: playerName,
        model: characterModel,
        x: playerModel.position.x,
        y: playerModel.position.y,
        z: playerModel.position.z,
        rotation: playerModel.rotation.y,
        action: playerModel.userData.currentAction
      };
      const derivedGeo = mapOrigin
        ? localMetersToGeo(playerModel.position.x, playerModel.position.z, mapOrigin)
        : null;
      if (derivedGeo) {
        payload.lat = derivedGeo.lat;
        payload.lon = derivedGeo.lon;
      } else if (localFix) {
        payload.lat = localFix.lat;
        payload.lon = localFix.lon;
      }
      if (Number.isFinite(localFix?.heading)) {
        payload.heading = localFix.heading;
      }
      if (mapOrigin) {
        payload.worldAnchor = {
          centerLat: mapOrigin.centerLat,
          centerLon: mapOrigin.centerLon
        };
      }
      multiplayer.send(payload);
      lastPresenceSend = now;
    }

    Object.entries(otherPlayers).forEach(([id, { model, nameLabel }]) => {
      if (!model.visible) {
        nameLabel.style.display = "none";
        return;
      }
      const pos = model.position.clone().add(new THREE.Vector3(0, 2, 0));
      pos.project(camera);
      if (pos.z < 0 || pos.z > 1) {
        nameLabel.style.display = "none";
        return;
      }
      const x = (pos.x * 0.5 + 0.5) * window.innerWidth;
      const y = (-pos.y * 0.5 + 0.5) * window.innerHeight;
      const cameraDist = camera.position.distanceTo(model.position);
      const scale = Math.max(0.5, 1.5 - cameraDist / 30);
      const opacity = Math.max(0, 1 - cameraDist / 40);
      nameLabel.style.display = "block";
      nameLabel.style.left = `${x}px`;
      nameLabel.style.top = `${y}px`;
      nameLabel.style.transform = `translate(-50%, -50%) scale(${scale})`;
      nameLabel.style.opacity = opacity.toFixed(2);
    });

    updateProjectiles({
      scene,
      projectiles,
      playerModel,
      otherPlayers,
      multiplayer,
      monsters,
      sendMonsterAttack: sendMonsterAttackIntent,
      onMonsterHit: handleMonsterDamage
    });

    updateIceMists({
      scene,
      mistList: iceMists,
      deltaSeconds: frameDelta,
      playerModel,
      playerControls,
      monsters,
      multiplayer
    });

    updateMeleeAttacks({
      playerModel,
      otherPlayers,
      monsters,
      audioManager,
      multiplayer,
      sendMonsterAttack: sendMonsterAttackIntent,
      onMonsterHit: handleMonsterDamage
    });

    renderer.render(scene, camera);
  }

  animate();
}

window.addEventListener('DOMContentLoaded', main);

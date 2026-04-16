// app.js
import * as THREE from "three";
import { PlayerCharacter } from "../characters/PlayerCharacter.js";
import { loadMonsterModel } from "../models/monsterModel.js";
import { MonsterCharacter } from "../characters/MonsterCharacter.js";
import { createFriendlyNpcManager } from "../friendlyNpcManager.js";
import {
  clearTerrainStampsForTile,
  consumeDirtyTerrainChunks,
  getTerrainHeight,
  getTerrainStampDebugSample,
  setTerrainStampsForTile
} from '../environment/terrainHeight.js';
import { createFire } from '../environment/fire.js';
import { Multiplayer } from '../peerConnection.js';
import { PlayerControls } from '../controls/controls.js';
import { getCookie, setCookie } from '../utils.js';
import { PickupSpatialGrid } from '../pickupSpatialGrid.js';
import { initSpeechCommands } from '../controls/speechCommands.js';
import { createAudioManager } from '../features/audioFeature.js';
import {
  spawnProjectile,
  updateProjectiles,
  removeProjectileAt,
  spawnArrowProjectile,
  ATTACKS,
  updateMeleeAttacks,
  Torch,
  TORCH_PICKUP_LOCATION,
  loadSpecialWeapons
} from '../features/combatFeature.js';
import { TreasureChest } from '../items/treasure_chest.js';
import { Bed } from '../items/bed.js';
import { CraftTable } from '../items/craft_table.js';
import { createNature } from '../environment/nature.js';
import { createCabin } from '../environment/cabin.js';
import { createTower } from '../environment/tower.js';
import { createMushrooms, MUSHROOM_ENTRIES } from '../environment/mushrooms.js';
import { createAnimalManager } from '../environment/animals.js';
import { createApples, APPLE_ITEM_ID } from '../items/apple.js';
import { createHomeSystem } from '../home.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import RAPIER from '@dimforge/rapier3d-compat';
import { removeRigidBodySafely } from '../physics/rapierSafety.js';
import { configureSpawnAlignment, getSpawnPosition, getSpawnY } from '../spawnUtils.js';
import { createLocationProvider } from '../location.js';
import { fetchOSMData } from '../osmClient.js';
import { overpassToGeoJSON } from '../osmGeoJson.js';
import { createMapRenderer } from '../environment/mapRender.js';
import { createBuildingsRenderer } from '../environment/buildingsRender.js';
import {
  BASE_HEALTH_SEGMENTS,
  HEALTH_SEGMENT_VALUE,
  clampHealthSegments,
  convertPointsToSegments,
  normalizeHealthSegments
} from '../healthUtils.js';
import {
  BASE_HUNGER_SEGMENTS,
  BASE_MAGIC_SEGMENTS,
  HUNGER_MAX_SEGMENTS,
  MAGIC_MAX_SEGMENTS,
  clampHungerSegments,
  clampMagicSegments
} from '../statSegments.js';
import { createTileCache } from '../tileCache.js';
import { createGroundTiles } from '../environment/groundTiles.js';
import { createTerrainStampDebugOverlay } from '../environment/terrainStampDebugOverlay.js';
import { clearCache, getCachedTile, setCachedTile } from '../idbCache.js';
import {
  initHomeStoragePanel,
  openHomeStorage,
  updateHomeStorageUI,
  initSettingsPanel,
  openSettings,
  openInventory,
  updateSettingsUI,
  getCraftRecipes,
  initCraftPanelFeature,
  openCraftPanelFeature,
  updateCraftUIFeature,
  initMerchantPanelFeature,
  updateMerchantUIFeature,
  initMerchantFeature,
  spawnMerchantAtFeature,
  clearMerchantSpawnFeature,
  getMerchantFriendlyFeature,
  setMerchantHostFeature,
  setMerchantRoomFeature,
  initCustomizeUIFeature,
  initSpellsFeature
} from '../features/uiPanelsFeature.js';
import {
  initMapViewFeature,
  setMapViewEnabledFeature,
  updateMapViewFeature,
  isMapViewTransitionActiveFeature,
  zoomInMapFeature,
  zoomOutMapFeature
} from '../features/mapFeature.js';
import { appContext } from '../src/runtime/appContext.js';
import { getAttackTypes } from '../items/melee.js';
import { exposeDebugGlobals } from '../src/runtime/exposeDebugGlobals.js';
import { claimAchievement, getAchievementView, mergeAchievementState, recordAchievementProgress } from '../achievements.js';

import {
  clearStoredPin,
  deleteProfileData,
  getStoredPinHash,
  getSleepTimestamp,
  loadOrCreateWithPin,
  renameProfile,
  saveCharacterModel,
  saveCustomization,
  saveQuestState,
  saveAchievementState,
  saveSleepTimestamp,
  saveStatsImmediate,
  saveStatsThrottled,
  initMonsterPersistence,
  loadMonstersSnapshot,
  subscribeMonsterUpdates,
  ensureMonsterRecord,
  persistMonsterHp,
  persistMonsterState,
  removeMonsterRecord,
  setMonsterPersistenceHost
} from '../features/persistenceFeature.js';

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    if (location.hostname !== 'localhost') {
      navigator.serviceWorker.register('/service-worker.js').catch((error) => {
        console.error('Service worker registration failed:', error);
      });
    }
  });
}

const DEFAULT_CHARACTER_MODEL = "/models/base_character_2.fbx";
const MAX_MONSTERS_TOTAL = 24;
const MAX_TRAVEL_SPAWN_CHARACTERS_TOTAL = 32;
const MONSTER_CLUSTER_MAX_SIZE = 5;
const MAX_MONSTERS_ACTIVE = 8;
const MONSTER_COMBAT_RADIUS = 26;
const MONSTER_BACKGROUND_RADIUS = 70;
const MONSTER_BACKGROUND_AI_INTERVAL_MS = 700;
const MONSTER_SPAWN_GROUND_OFFSET = 0.9;
const MONSTER_MODELS = [
  "/models/zombie.fbx",
  "/models/zombie_boy.fbx",
  "/models/zombie_green.fbx",
  "/models/golem.fbx"
];
const MONSTER_SPAWN_MIN_RADIUS = 25;
const MONSTER_SPAWN_MAX_RADIUS = 160;
const MONSTER_RESPAWN_DELAY_RANGE_MS = [3000, 5000];
const MONSTER_SPAWN_ATTEMPTS = 12;
const MONSTER_SNAPSHOT_TIMEOUT_MS = 6000;
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

appContext.debugFlags.PERF = PERF;
appContext.debugFlags.DEBUG_CONSOLE = false;
exposeDebugGlobals({
  enableDebugMirror: appContext.debugFlags.DEBUG_CONSOLE === true,
  enableCompatibilityShims: true
});

const clock = new THREE.Clock();
const mixerClock = new THREE.Clock();
const REMOTE_ANIM_FPS = 8;
const REMOTE_ANIM_INTERVAL = 1 / REMOTE_ANIM_FPS;
const MONSTER_ANIM_FPS = 8;
const MONSTER_ANIM_INTERVAL = 1 / MONSTER_ANIM_FPS;
const MONSTER_ANIM_MID_FPS = 4;
const MONSTER_ANIM_MID_INTERVAL_MS = 1000 / MONSTER_ANIM_MID_FPS;
const MONSTER_SWORD_MODEL_URL = '/assets/props/autumn_sword.glb';
const MONSTER_SWORD_SCALE = 0.16;
const MONSTER_SWORD_HOLD_OFFSET = new THREE.Vector3(-0.05, 0.15, 0.08);
const MONSTER_SWORD_HOLD_ROTATION = new THREE.Euler(-Math.PI / 2, Math.PI, 0, 'YXZ');
const MONSTER_SWORD_HOLD_QUATERNION = new THREE.Quaternion().setFromEuler(MONSTER_SWORD_HOLD_ROTATION);
const ARROW_MODEL_URL = '/assets/props/arrow.glb';
const MANA_POTION_MODEL_URL = '/assets/props/mana_potion.glb';
const MANA_POTION_SCALE = 8.0;
const ARROW_PROJECTILE_SCALE = 2.2;
const ARROW_PROJECTILE_SPEED = 55;
const ARROW_PROJECTILE_LIFETIME = 6000;
const BOMB_THROW_SPEED = 11;
const BOMB_THROW_LIFETIME = 15000;
const BOMB_THROW_UPWARD_BIAS = 0.25;
const INVENTORY_THROW_SPEED = 2;
const INVENTORY_THROW_LIFETIME = 12000;
const INVENTORY_THROW_UPWARD_BIAS = 0.22;
const BOMB_DAMAGE_RADIUS = 5;
const BOMB_BASE_DAMAGE = 6;
const BOMB_KNOCKBACK_STRENGTH = 6;
const BOMB_MIST_LIFETIME_MS = 8000;
const BOMB_MIST_PARTICLE_COUNT = 35;
const ATTACK_WINDOW_MIST_OPACITY = 0.52;
const ATTACK_WINDOW_MIST_HEIGHT = 1.6;
const ATTACK_WINDOW_VISUAL_MULTIPLIER = 1;
const HIT_RIBBON_STREAK_COUNT = 9;
const HIT_RIBBON_LIFETIME_MS = 260;
const TORCH_ITEM_ID = 'torch';
const TORCH_HEALTH_KEY = 'healths';
const DEFAULT_TORCH_HEALTH = 100;
const TORCH_HEALTH_DECAY_PER_SECOND = 0.6;
const NPC_AUDIO_HEAR_RADIUS = 30;
const FRIENDLY_VOICE_MAX_VOLUME = 0.35;
const ZOMBIE_VOICE_MAX_VOLUME = 0.4;
const MERCHANT_LOOP_MAX_VOLUME = 0.38;
const FRIENDLY_VOICE_INTERVAL_MS = [5000, 11000];
const FRIENDLY_VOICE_CLIPS = [
  'NPC Sounds/friendly_sound_1.ogg',
  'NPC Sounds/friendly_sound_2.ogg',
  'NPC Sounds/friendly_sound_3.ogg',
  'NPC Sounds/friendly_sound_4.ogg'
];
const ZOMBIE_VOICE_CLIPS = [
  'NPC Sounds/zombie_sound_1.ogg',
  'NPC Sounds/zombie_sound_2.ogg'
];
const MERCHANT_LOOP_CLIP = 'NPC Sounds/merchant_loop.ogg';
const TERRAIN_STAMP_REGRESSION_SCENE = Object.freeze({
  seed: 'terrain-stamp-regression-v1',
  location: { lat: 37.7749, lon: -122.4194 }
});


// --- Rapier demo state ---
let rapierWorld;
const rbToMesh = new Map(); // RigidBody -> THREE.Mesh
let physicsAccumulator = 0;
const FIXED_DT = 1 / 60;
let monsterSwordTemplate = null;
let monsterSwordTemplatePromise = null;
let arrowTemplate = null;
let arrowTemplatePromise = null;
let manaPotionTemplate = null;
let manaPotionTemplatePromise = null;
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
const PERFORMANCE_MODES = new Set(['auto', 'quality', 'balanced', 'performance']);
const PERFORMANCE_PROFILE_CAPS = {
  low: 1.0,
  mid: 1.5,
  high: 2.0
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

async function initCore(runtimeContext) {
  document.body.addEventListener('touchstart', () => {}, { once: true });

  const audioManager = createAudioManager();
  runtimeContext.systems.audioManager = audioManager;
  window.audioManager = audioManager;
  let syncBackgroundLoopForDisplayMode = () => {
    audioManager.playBGS('Forest Day/Forest Day.ogg');
  };
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
    syncBackgroundLoopForDisplayMode();
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

  let characterModel = DEFAULT_CHARACTER_MODEL;
  const storedCharacterModel = playerProfile?.characterModel
    || localStorage.getItem('characterModel')
    || getCookie("characterModel")
    || DEFAULT_CHARACTER_MODEL;
  characterModel = storedCharacterModel;
  if (profileNameKey && playerProfile?.characterModel !== storedCharacterModel) {
    playerProfile = playerProfile || {};
    playerProfile.characterModel = storedCharacterModel;
    await saveCharacterModel(profileNameKey, storedCharacterModel);
  }

  let updatePlayerInfoUI = () => {};

  const FOOD_HUNGER_GAIN = 8;
  const HEALTH_PICKUP_SEGMENTS = 2;
  const MUSHROOM_HEALTH_SEGMENTS = 1;
  const MUSHROOM_HUNGER_GAIN = 3;
  const APPLE_HEALTH_SEGMENTS = 1;
  const APPLE_HUNGER_GAIN = 2;
  const APPLE_DROP_LIFT = 0.25;
  const HUNGER_DECAY_PER_HOUR = 1.6;
  const ENERGY_DECAY_PER_SECOND_WHILE_MOVING = 0.09;
  const HUNGER_HEALTH_DECAY_PER_SECOND = 0.2;
  const SLEEP_RECOVERY_PER_SECOND = HUNGER_MAX_SEGMENTS / 3600;
  const HUNGER_HEALTH_DECAY_SEGMENTS_PER_SECOND = HUNGER_HEALTH_DECAY_PER_SECOND / HEALTH_SEGMENT_VALUE;
  const SLEEP_RECOVERY_SEGMENTS_PER_SECOND = SLEEP_RECOVERY_PER_SECOND / HEALTH_SEGMENT_VALUE;
  const PICKUP_RADIUS = 1.2;
  const APPLE_PICKUP_RADIUS = 3;
  const WOOD_ITEM_ID = 'wood';
  const MEAT_ITEM_ID = 'meat';
  const ZOMBIE_BRAINS_ITEM_ID = 'zombie_brains';
  const LIFE_POTION_ITEM_ID = 'life_potion';
  const MANA_POTION_ITEM_ID = 'mana_potion';
  const SALT_ITEM_ID = 'salt';
  const SAUTEED_MUSHROOMS_ITEM_ID = 'sauteed_mushrooms';
  const WOOD_PICKUP_RADIUS = 3;
  const MEAT_PICKUP_RADIUS = 3;
  const SALT_PICKUP_RADIUS = 3;
  const MEAT_HEALTH_SEGMENTS = 4;
  const MEAT_HUNGER_GAIN = 16;
  const SALT_HEALTH_SEGMENTS = 1;
  const SALT_HUNGER_GAIN = 2;
  const SAUTEED_MUSHROOMS_HEALTH_SEGMENTS = 12;
  const SAUTEED_MUSHROOMS_HUNGER_GAIN = 28;
  const WOOD_DROP_LIFT = 0.12;
  const TREE_HITS_TO_CUT = 3;
  const TREE_SWING_TILT_STEP = 0.08;
  const TREE_HIT_RANGE_BOOST = 3.5;
  const MAX_AMMO_PICKUPS = 60;
  const MAX_FOOD_PICKUPS = 0;
  const MAX_HEALTH_PICKUPS = 0;
  const MAX_COIN_PICKUPS = 160;
  const MAX_WEAPON_PICKUPS = 24;
  const TILE_STOCK_AMMO_COUNT = 0;
  const TILE_STOCK_FOOD_COUNT = 0;
  const TILE_STOCK_HEALTH_COUNT = 0;
  const TILE_STOCK_COIN_COUNT = 1000;
  const TILE_STOCK_WEAPON_COUNT = 24;
  const PICKUP_SPAWN_RADIUS = 225;
  const PICKUP_STOCK_COOLDOWN_MS = 1 * 5 * 1000;
  const ICE_GUN_AMMO_CLUSTER_COUNT = 3;
  const ICE_GUN_AMMO_CLUSTER_RADIUS = 1.4;

  let multiplayer = null;
  let isHost = false;
  var playerControls = null;
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
  let lastRenderOrigin = null;
  let activeTileKey = null;
  let pendingMapRebuild = false;
  let mapRebuildToken = 0;
  const networkedEntities = new Map();
  const networkedLocalControlState = new Map();
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
  const bombMists = [];
  const attackWindowMists = [];
  const hitRibbonBursts = [];
  const treeFires = [];
  const ammoPickups = [];
  const droppedAmmoPickups = new Map();
  const pendingDropRemovals = new Set();
  const droppedWorldPickups = new Map();
  const pendingWorldDropRemovals = new Set();
  const localHeldWeaponMeshes = new Map();
  const remoteHeldWeaponMeshes = new Map();
  const remotePresenceEquipment = new Map();
  const remoteHoldTempPosition = new THREE.Vector3();
  const remoteHoldTempQuaternion = new THREE.Quaternion();
  const remoteHoldTempOffset = new THREE.Vector3();
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
  const mushroomPickupGrid = new PickupSpatialGrid(4);
  window.mushroomPickupGrid = mushroomPickupGrid;
  window.pickupSpatialIndices = {
    ...(window.pickupSpatialIndices || {}),
    mushrooms: mushroomPickupGrid
  };
  let appleController = null;
  let applePickups = [];
  let woodPickups = [];
  let meatPickups = [];
  let zombieBrainsPickups = [];
  let saltPickups = [];
  const mushroomItemIds = new Set(MUSHROOM_ENTRIES.map((entry) => entry.id));
  const appleItemIds = new Set([APPLE_ITEM_ID]);
  const woodItemIds = new Set([WOOD_ITEM_ID]);
  const meatItemIds = new Set([MEAT_ITEM_ID]);
  const zombieBrainsItemIds = new Set([ZOMBIE_BRAINS_ITEM_ID]);
  const saltItemIds = new Set([SALT_ITEM_ID]);
  const sauteedMushroomsItemIds = new Set([SAUTEED_MUSHROOMS_ITEM_ID]);
  const potionItemIds = new Set([LIFE_POTION_ITEM_ID, MANA_POTION_ITEM_ID]);
  const PICKUP_CHECK_INTERVAL_MS = 250;
  let lastPickupCheckMs = 0;

  const otherPlayers = {};
  runtimeContext.entities.otherPlayers = otherPlayers;
  window.otherPlayers = otherPlayers;
  const pendingIncomingPeerData = [];
  let canProcessIncomingPeerData = false;
  const remotePresenceMeta = {};
  let lastPresenceSend = 0;
  let lastPresenceSweep = 0;
  let remoteAnimAccumulator = 0;
  let monsterAnimAccumulator = 0;
  const monsterAnimFrustum = new THREE.Frustum();
  const monsterAnimProjMatrix = new THREE.Matrix4();

  let monsters = [];
  runtimeContext.entities.monsters = monsters;
  window.monsters = monsters;
  let animalManager = null;
  let animals = [];
  runtimeContext.entities.animals = animals;
  window.animals = animals;
  const npcVoiceSchedule = new Map();
  const zombieVoiceLoops = new Map();
  const getRandomDelayMs = ([min, max]) => {
    const safeMin = Number.isFinite(min) ? min : 0;
    const safeMax = Number.isFinite(max) ? max : safeMin;
    if (safeMax <= safeMin) return safeMin;
    return safeMin + Math.random() * (safeMax - safeMin);
  };
  const getVolumeByDistance = (distance, maxDistance, maxVolume) => {
    if (!Number.isFinite(distance) || !Number.isFinite(maxDistance) || maxDistance <= 0) return 0;
    if (distance >= maxDistance) return 0;
    const normalized = 1 - (distance / maxDistance);
    return Math.max(0, Math.min(1, maxVolume * normalized));
  };
  const maybePlayNpcVoice = ({
    entityId,
    position,
    now,
    intervalRange,
    clips,
    maxVolume,
    playerPosition,
    cooldownPrefix
  }) => {
    if (!entityId || !position || !clips?.length || !playerPosition || !audioManager) return;
    const distance = playerPosition.distanceTo(position);
    const volume = getVolumeByDistance(distance, NPC_AUDIO_HEAR_RADIUS, maxVolume);
    if (volume <= 0.01) {
      npcVoiceSchedule.delete(entityId);
      return;
    }

    const nextAt = npcVoiceSchedule.get(entityId) ?? 0;
    if (now < nextAt) return;

    const clip = clips[Math.floor(Math.random() * clips.length)];
    audioManager.playSFX(clip, volume, {
      cooldownKey: `${cooldownPrefix}:${entityId}`,
      cooldownMs: 800
    });
    npcVoiceSchedule.set(entityId, now + getRandomDelayMs(intervalRange));
  };
  const isZombieMonsterType = (monster) => {
    const typeLabel = String(monster?.type || monster?.modelPath || '').toLowerCase();
    return typeLabel.includes('zombie');
  };
  const updateMerchantLoopVoice = ({ merchant, playerPosition }) => {
    const loopId = 'merchant-voice-loop';
    if (!merchant?.model?.position || !playerPosition || !audioManager) {
      audioManager?.stopLoopingSFX(loopId);
      return;
    }
    const distance = playerPosition.distanceTo(merchant.model.position);
    const volume = getVolumeByDistance(distance, NPC_AUDIO_HEAR_RADIUS, MERCHANT_LOOP_MAX_VOLUME);
    if (volume <= 0.01) {
      audioManager.stopLoopingSFX(loopId);
      return;
    }
    audioManager.startLoopingSFX(loopId, MERCHANT_LOOP_CLIP, volume);
    audioManager.setLoopingSFXVolume(loopId, volume);
  };
  const stopZombieLoopVoice = (monsterId) => {
    if (!monsterId || !audioManager) return;
    const loopId = zombieVoiceLoops.get(monsterId);
    if (!loopId) return;
    audioManager.stopLoopingSFX(loopId);
    zombieVoiceLoops.delete(monsterId);
  };
  const updateZombieLoopVoice = ({ monster, playerPosition }) => {
    const monsterId = monster?.id;
    if (!monsterId || !audioManager || !playerPosition || !isZombieMonsterType(monster) || monster?.isDead || !monster?.model?.position) {
      stopZombieLoopVoice(monsterId);
      return;
    }

    const distance = playerPosition.distanceTo(monster.model.position);
    const volume = getVolumeByDistance(distance, NPC_AUDIO_HEAR_RADIUS, ZOMBIE_VOICE_MAX_VOLUME);
    if (volume <= 0.01) {
      stopZombieLoopVoice(monsterId);
      return;
    }

    let loopId = zombieVoiceLoops.get(monsterId);
    if (!loopId) {
      const randomClip = ZOMBIE_VOICE_CLIPS[Math.floor(Math.random() * ZOMBIE_VOICE_CLIPS.length)] || ZOMBIE_VOICE_CLIPS[0];
      loopId = `zombie-voice-loop:${monsterId}`;
      zombieVoiceLoops.set(monsterId, loopId);
      audioManager.startLoopingSFX(loopId, randomClip, volume);
    }
    audioManager.setLoopingSFXVolume(loopId, volume);
  };
  const monsterSlotIds = Array.from({ length: MAX_MONSTERS_TOTAL }, (_, index) => `monster:${index}`);
  const spawningSlots = new Set();
  const respawnTimers = new Map();
  let monstersSeeded = false;
  let monsterSnapshotLoaded = false;
  let monsterSnapshotTimeout = null;
  let unsubscribeMonsterUpdates = null;
  const recentMonsterHits = new Map();
  const damageableCreaturesBuffer = [];

  const refillCombinedList = (target, first, second) => {
    target.length = 0;
    if (Array.isArray(first) && first.length > 0) {
      target.push(...first);
    }
    if (Array.isArray(second) && second.length > 0) {
      target.push(...second);
    }
    return target;
  };

  const getDamageableCreatures = () => refillCombinedList(damageableCreaturesBuffer, monsters, animals);
  const findDamageableCreatureById = (id) => {
    if (!id) return null;
    if (Array.isArray(monsters)) {
      for (const monster of monsters) {
        if (monster?.id === id) return monster;
      }
    }
    if (Array.isArray(animals)) {
      for (const animal of animals) {
        if (animal?.id === id) return animal;
      }
    }
    return null;
  };

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
  const getDevicePerformanceProfile = () => {
    const hardwareConcurrency = Number.isFinite(navigator.hardwareConcurrency) ? navigator.hardwareConcurrency : 4;
    const memory = Number.isFinite(navigator.deviceMemory) ? navigator.deviceMemory : 4;
    const shortestSide = Math.min(window.innerWidth || 0, window.innerHeight || 0);
    const isTouchCapable = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
    const mobileUA = /android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent || '');
    const isMobileLike = mobileUA || (isTouchCapable && shortestSide > 0 && shortestSide <= 900);

    const severeConstraint = hardwareConcurrency <= 4 || memory <= 4 || shortestSide <= 720;
    const moderateConstraint = hardwareConcurrency <= 6 || memory <= 6 || shortestSide <= 1080;
    if (isMobileLike && severeConstraint) {
      return { tier: 'low', isMobileLike };
    }
    if (severeConstraint || (isMobileLike && moderateConstraint)) {
      return { tier: 'mid', isMobileLike };
    }
    return { tier: 'high', isMobileLike };
  };

  const resolvePerformanceTier = (mode) => {
    if (mode === 'performance') return 'low';
    if (mode === 'quality') return 'high';
    const profile = getDevicePerformanceProfile();
    if (mode === 'balanced') {
      return profile.tier === 'high' ? 'mid' : profile.tier;
    }
    return profile.tier;
  };

  const getPixelRatioCapForTier = (tier) => PERFORMANCE_PROFILE_CAPS[tier] ?? PERFORMANCE_PROFILE_CAPS.mid;
  const isLowEndTier = (tier) => tier === 'low';
  const markOptionalShadow = (target) => {
    if (!target) return;
    target.userData = target.userData || {};
    target.userData.shadowProfileManaged = true;
    target.userData.shadowImportance = 'optional';
  };
  const applyOptionalShadowState = (target, allowOptionalShadows) => {
    if (!target) return;
    markOptionalShadow(target);
    if (typeof target.traverse === 'function') {
      target.traverse((child) => {
        if (!child?.isMesh) return;
        child.userData = child.userData || {};
        child.userData.shadowProfileManaged = true;
        child.userData.shadowImportance = 'optional';
        child.castShadow = !!allowOptionalShadows;
      });
      return;
    }
    if (target.isMesh) {
      target.castShadow = !!allowOptionalShadows;
    }
  };

  const loadDisplaySettings = () => {
    const defaults = { mode: 'auto', performanceMode: 'auto', ...DISPLAY_PRESETS.day };
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
  let renderer = null;
  let currentPerformanceTier = resolvePerformanceTier(displaySettings.performanceMode);
  let optionalShadowsEnabled = !isLowEndTier(currentPerformanceTier);

  if (!DISPLAY_MODES.has(displaySettings.mode)) {
    displaySettings.mode = 'auto';
  }
  if (!PERFORMANCE_MODES.has(displaySettings.performanceMode)) {
    displaySettings.performanceMode = 'auto';
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

  const applyRendererPerformanceSettings = () => {
    const nextTier = resolvePerformanceTier(displaySettings.performanceMode);
    currentPerformanceTier = nextTier;
    optionalShadowsEnabled = !isLowEndTier(nextTier);
    if (renderer) {
      const pixelRatioCap = getPixelRatioCapForTier(nextTier);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, pixelRatioCap));
      const lowEnd = isLowEndTier(nextTier);
      renderer.shadowMap.enabled = !lowEnd;
      renderer.shadowMap.type = lowEnd ? THREE.BasicShadowMap : (nextTier === 'high' ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap);
    }
    if (dirLight) {
      const lowEnd = isLowEndTier(nextTier);
      dirLight.castShadow = !lowEnd;
      dirLight.shadow.mapSize.set(lowEnd ? 512 : 1024, lowEnd ? 512 : 1024);
    }
    if (scene) {
      scene.traverse((child) => {
        if (!child?.isMesh) return;
        if (child.userData?.shadowProfileManaged && child.userData?.shadowImportance === 'optional') {
          child.castShadow = optionalShadowsEnabled;
        }
      });
    }
  };


  syncBackgroundLoopForDisplayMode = () => {
    const effectiveMode = displaySettings.mode === 'auto'
      ? (lastAutoMode || getAutoMode())
      : displaySettings.mode;
    if (effectiveMode === 'night') {
      audioManager.playBGS('Interior Night/Inside Night.ogg');
      return;
    }
    audioManager.playBGS('Forest Day/Forest Day.ogg');
  };

  const updateAutoDisplayMode = () => {
    if (displaySettings.mode !== 'auto') return;
    const nextMode = getAutoMode();
    if (nextMode === lastAutoMode) return;
    lastAutoMode = nextMode;
    applyPresetForMode(nextMode);
    saveDisplaySettings();
    applyDisplaySettings();
    syncBackgroundLoopForDisplayMode();
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
    applyRendererPerformanceSettings();
    applyDisplaySettings();
    syncBackgroundLoopForDisplayMode();
    updateSettingsUI();
  };

  const setDisplaySetting = (key, value) => {
    if (key === 'performanceMode') {
      if (!PERFORMANCE_MODES.has(value)) return;
      displaySettings.performanceMode = value;
      saveDisplaySettings();
      applyRendererPerformanceSettings();
      updateSettingsUI();
      return;
    }
    if (!Number.isFinite(value)) return;
    displaySettings[key] = value;
    saveDisplaySettings();
    applyRendererPerformanceSettings();
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

  const sendMonsterAttackIntent = ({ monsterId, damage, sourcePlayerId, attackTypes, at }) => {
    if (!multiplayer || multiplayer.isHost) return;
    const hostId = multiplayer.getHostId?.();
    if (!hostId || !monsterId || !Number.isFinite(damage)) return;
    multiplayer.sendTo(hostId, {
      type: 'attackMonster',
      monsterId,
      damage,
      sourcePlayerId: sourcePlayerId ?? multiplayer.getId?.(),
      attackTypes: getAttackTypes(null, attackTypes || []),
      at: at ?? Date.now()
    });
  };

  const handleMonsterDamage = (monster) => {
    if (!multiplayer?.isHost || !monster) return;
    persistMonsterHp(monster);
  };

  const handleCombatEntityHit = ({ targetPosition }) => {
    if (!targetPosition) return;
    spawnHitRibbonBurst(scene, targetPosition);
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
    clearRemoteHeldWeaponsForHolder(remoteId);
    remotePresenceEquipment.delete(remoteId);
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
      const isLocallyControlled = typeof entry.isLocallyControlled === 'function' && entry.isLocallyControlled();
      const wasLocallyControlled = networkedLocalControlState.get(id) === true;
      if (!isLocallyControlled && !wasLocallyControlled) {
        return;
      }
      const state = entry.getState?.();
      if (state) {
        result.set(id, { state, sourceId: myId });
      }
      networkedLocalControlState.set(id, isLocallyControlled);
    });
    return result;
  }

  function sendImmediateEntityControl(id) {
    if (!id || !multiplayer) return;
    const entry = networkedEntities.get(id);
    const myId = multiplayer.getId?.();
    if (!entry || !myId) return;
    const state = entry.getState?.();
    if (!state) return;
    if (multiplayer.isHost) {
      updateAuthoritativeState(id, state, myId);
      return;
    }
    multiplayer.send({ type: 'entityControl', id, state, sourceId: myId });
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
    if (!canProcessIncomingPeerData) {
      pendingIncomingPeerData.push([peerId, data]);
      if (pendingIncomingPeerData.length > 200) {
        pendingIncomingPeerData.shift();
      }
      return;
    }
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
      if (payload.equippedLeft != null && typeof payload.equippedLeft !== 'string') return false;
      if (payload.equippedRight != null && typeof payload.equippedRight !== 'string') return false;
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

    const isInventoryThrowProjectileMessage = payload => isObject(payload)
      && payload.type === 'inventoryThrowProjectile'
      && typeof payload.id === 'string'
      && typeof payload.itemId === 'string'
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

    const isInventoryWorldDropMessage = payload => {
      if (!isObject(payload) || payload.type !== 'inventoryWorldDrop' || !Array.isArray(payload.drops)) return false;
      return payload.drops.every(drop => {
        if (!isObject(drop)) return false;
        if (typeof drop.id !== 'string') return false;
        if (typeof drop.itemId !== 'string') return false;
        if (!isVector3Array(drop.position)) return false;
        if (drop.amount != null && !isFiniteNumber(drop.amount)) return false;
        return true;
      });
    };

    const isInventoryWeaponDropMessage = payload => {
      if (!isObject(payload) || payload.type !== 'inventoryWeaponDrop' || !Array.isArray(payload.drops)) return false;
      return payload.drops.every(drop => {
        if (!isObject(drop)) return false;
        if (typeof drop.id !== 'string') return false;
        if (typeof drop.itemId !== 'string') return false;
        if (!isVector3Array(drop.position)) return false;
        if (!Array.isArray(drop.rotation) || drop.rotation.length !== 4 || !drop.rotation.every(isFiniteNumber)) return false;
        if (drop.quantity != null && !isFiniteNumber(drop.quantity)) return false;
        if (drop.torchHealth != null && !isFiniteNumber(drop.torchHealth)) return false;
        return true;
      });
    };

    const isDropPickupMessage = payload => isObject(payload)
      && payload.type === 'dropPickup'
      && typeof payload.dropId === 'string';

    const isDropWorldPickupMessage = payload => isObject(payload)
      && payload.type === 'dropWorldPickup'
      && typeof payload.dropId === 'string';

    const isDropWeaponPickupMessage = payload => isObject(payload)
      && payload.type === 'dropWeaponPickup'
      && typeof payload.dropId === 'string'
      && (payload.itemId == null || typeof payload.itemId === 'string')
      && (payload.quantity == null || isFiniteNumber(payload.quantity))
      && (payload.torchHealth == null || isFiniteNumber(payload.torchHealth));

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
      && (payload.attackTypes == null || (Array.isArray(payload.attackTypes) && payload.attackTypes.every(type => typeof type === 'string')))
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
      const monster = findDamageableCreatureById(monsterId);
      if (!monster) return;
      const sourceId = data.sourcePlayerId || peerId;
      const nowMs = Date.now();
      const eventAt = Number.isFinite(data.at) ? data.at : nowMs;
      const key = `${sourceId}:${monsterId}`;
      const lastHitAt = recentMonsterHits.get(key) || 0;
      if (eventAt - lastHitAt < 250) return;
      recentMonsterHits.set(key, eventAt);
      logMonsterPersist('attack intent', { monsterId, damage: data.damage, sourceId });
      const attackTypes = getAttackTypes(null, data.attackTypes || []);
      const killed = monster.applyDamage(data.damage, { attackTypes });
      persistMonsterHp(monster);
      if (killed && sourceId === multiplayer.getId()) {
        const withFriend = window.questManager?.isFriendActive?.() ?? false;
        window.onMonsterKill?.(monster, { withFriend });
      }
      return;
    }

    if (data.type === 'presence') {
      if (!isPresenceMessage(data)) {
        logInvalidPayload('presence', data);
        return;
      }
      const remoteId = data.id || peerId;
      if (remoteId === multiplayer.getId()) {
        return;
      }
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
          health: existing?.health ?? BASE_HEALTH_SEGMENTS,
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
      syncPresenceRemoteEquipment(remoteId, data);
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

      const hasAuthoritativeY = Number.isFinite(data.y);
      const resolvedNetworkY = getSpawnY(targetX, targetZ, 0.6, { allowOnBuildings: true });
      const targetY = hasAuthoritativeY ? data.y : (Number.isFinite(resolvedNetworkY) ? resolvedNetworkY : getTerrainHeight(targetX, targetZ));

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
        if (['mutantPunch', 'swordSlash', 'swordSlashLeft', 'swordSpin', 'swordFwdSpin', 'leftPunch', 'hurricaneKick', 'mmaKick'].includes(data.action)) {
          const attackName = data.action === 'leftPunch'
            ? 'mutantPunch'
            : data.action;
          player.model.userData.attack = {
            name: attackName,
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

    if (data.type === 'inventoryThrowProjectile') {
      if (!isInventoryThrowProjectileMessage(data)) {
        logInvalidPayload('inventoryThrowProjectile', data);
        return;
      }
      const position = new THREE.Vector3(...data.position);
      const direction = new THREE.Vector3(...data.direction);
      spawnInventoryThrowProjectileWithPerfFlags(scene, projectiles, position, direction, data.id, {
        itemId: data.itemId,
        createPickupOnGround: false
      });

      const shooter = otherPlayers[data.id];
      if (shooter) {
        const actions = shooter.model.userData.actions;
        const current = shooter.model.userData.currentAction;
        const hand = getInventoryItemHand(data.itemId) || 'right';
        const actionName = hand === 'left' ? 'throwLeft' : 'throw';
        const throwAction = actions?.[actionName] || actions?.throw;
        if (throwAction) {
          actions[current]?.fadeOut(0.1);
          throwAction.reset().fadeIn(0.1).play();
          shooter.model.userData.currentAction = actionName;
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

    if (data.type === 'inventoryWorldDrop' && multiplayer?.isHost) {
      if (!isInventoryWorldDropMessage(data)) {
        logInvalidPayload('inventoryWorldDrop', data);
        return;
      }
      const drops = Array.isArray(data.drops) ? data.drops : [];
      drops.forEach(drop => {
        if (!drop?.id || !drop?.itemId || !Array.isArray(drop.position)) return;
        addDroppedWorldPickup({
          id: drop.id,
          itemId: drop.itemId,
          position: new THREE.Vector3(...drop.position),
          amount: drop.amount
        });
      });
      return;
    }

    if (data.type === 'dropWorldPickup' && multiplayer?.isHost) {
      if (!isDropWorldPickupMessage(data)) {
        logInvalidPayload('dropWorldPickup', data);
        return;
      }
      if (data.dropId) {
        removeDroppedWorldPickup(data.dropId);
      }
      return;
    }

    if (data.type === 'inventoryWeaponDrop' && multiplayer?.isHost) {
      if (!isInventoryWeaponDropMessage(data)) {
        logInvalidPayload('inventoryWeaponDrop', data);
        return;
      }
      const drops = Array.isArray(data.drops) ? data.drops : [];
      drops.forEach(drop => {
        addDroppedWeaponPickupFromState(drop);
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

    if (data.type === 'dropWeaponPickup' && multiplayer?.isHost) {
      if (!isDropWeaponPickupMessage(data)) {
        logInvalidPayload('dropWeaponPickup', data);
        return;
      }
      if (data.dropId) {
        removeDroppedWeaponPickupById(data.dropId);
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
  window.multiplayer = multiplayer;
  multiplayer.onHostChange = ({ previousHostId, newHostId, isCurrentHost }) => {
    isHost = !!isCurrentHost;
    setMonsterPersistenceHost(isHost);
    friendlyNpcManager?.setHost(isHost);
    setMerchantHostFeature(isHost);
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

    if (previousHostId !== newHostId) {
      clearAllRemoteHeldWeaponMeshes();
      [iceGun, bow, bomb, autumnSword, lantern, torch].forEach((weapon) => {
        if (!weapon) return;
        weapon.remoteHolderId = null;
      });
    }
  };
  multiplayer.onReady = async ({ roomId }) => {
    if (!roomId) {
      monstersSeeded = true;
      monsterSnapshotLoaded = true;
      if (monsterSnapshotTimeout) {
        clearTimeout(monsterSnapshotTimeout);
        monsterSnapshotTimeout = null;
      }
      friendlyNpcManager?.onRoomReady({ roomId: null, isHost: multiplayer.isHost });
      await setMerchantRoomFeature({ roomId: null, isHost: multiplayer.isHost });
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
    monsterSnapshotLoaded = false;
    if (monsterSnapshotTimeout) {
      clearTimeout(monsterSnapshotTimeout);
    }
    monsterSnapshotTimeout = setTimeout(() => {
      if (monsterSnapshotLoaded) return;
      console.warn('Monster snapshot load timed out, seeding defaults.');
      monsterSnapshotLoaded = true;
      monstersSeeded = true;
    }, MONSTER_SNAPSHOT_TIMEOUT_MS);
    friendlyNpcManager?.onRoomReady({ roomId, isHost: multiplayer.isHost });
    await setMerchantRoomFeature({ roomId, isHost: multiplayer.isHost });
    try {
      const snapshot = await loadMonstersSnapshot();
      const snapshotEntries = Object.entries(snapshot || {});
      snapshotEntries.forEach(([id, record]) => {
        applyMonsterRecord(record, id, { applyTransform: true });
      });
      monsterSnapshotLoaded = true;
      monstersSeeded = true;
      if (monsterSnapshotTimeout) {
        clearTimeout(monsterSnapshotTimeout);
        monsterSnapshotTimeout = null;
      }
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
      if (monsterSnapshotTimeout) {
        clearTimeout(monsterSnapshotTimeout);
        monsterSnapshotTimeout = null;
      }
    }
  };

  let iceGun;
  let bow;
  let autumnSword;
  let lantern;
  let torch;
  let bomb;
  let treasureChest;
  let bed;
  let craftTable;
  let craftTableColliderBody;
  let craftTableColliderLastCenter = null;
  const craftTableColliderBounds = new THREE.Box3();
  const craftTableColliderCenter = new THREE.Vector3();

  const initialTier = resolvePerformanceTier(displaySettings.performanceMode);
  renderer = new THREE.WebGLRenderer({ antialias: !isLowEndTier(initialTier) });
  currentPerformanceTier = initialTier;
  optionalShadowsEnabled = !isLowEndTier(initialTier);
  applyRendererPerformanceSettings();
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.getElementById('game-container').appendChild(renderer.domElement);

  const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
  mapRenderer = createMapRenderer({ scene, renderer });
  buildingsRenderer = createBuildingsRenderer({ scene, camera, renderer });
  runtimeContext.systems.mapRenderer = mapRenderer;
  window.mapRenderer = mapRenderer;
  runtimeContext.systems.buildingsRenderer = buildingsRenderer;
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
    applyRendererPerformanceSettings();
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
  applyRendererPerformanceSettings();
  applyDisplaySettings();



  // --- RAPIER INIT ---
  await RAPIER.init();
  rapierWorld = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  runtimeContext.systems.rapierWorld = rapierWorld;
  window.rapierWorld = rapierWorld;
  runtimeContext.systems.rbToMesh = rbToMesh;
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
      clearRemoteHeldWeaponFor(weapon.type, previousHolderId);
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

  const getPresenceHolderForWeaponType = (weaponType) => {
    if (!weaponType) return null;
    for (const [remoteId, equipState] of remotePresenceEquipment.entries()) {
      if (!equipState) continue;
      if (equipState.left === weaponType || equipState.right === weaponType) {
        return remoteId;
      }
    }
    return null;
  };

  const dropOtherWeapons = (activeWeapon) => {
    [iceGun, bow, autumnSword, bomb].forEach(weapon => {
      if (!weapon || weapon === activeWeapon) return;
      if (weapon.holder === playerControls) {
        if (weapon.itemId) {
          unequipInventoryItem(weapon.itemId);
        }
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
  const networkDroppedWeaponPickups = new Map();
  window.weaponPickups = droppedWeaponPickups;

  const disposeLocalHeldWeaponMesh = (key) => {
    const mesh = localHeldWeaponMeshes.get(key);
    if (!mesh) return;
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
    localHeldWeaponMeshes.delete(key);
  };

  const ensureLocalHeldWeaponMesh = (weapon, key = weapon?.type, options = {}) => {
    const { forceNew = false } = options;
    if (!weapon?.mesh || !key) return null;
    if (forceNew && localHeldWeaponMeshes.has(key)) {
      disposeLocalHeldWeaponMesh(key);
    }
    if (localHeldWeaponMeshes.has(key)) return localHeldWeaponMeshes.get(key);
    const heldMesh = weapon.mesh.clone(true);
    heldMesh.traverse(child => {
      if (!child.isMesh) return;
      child.castShadow = true;
      child.receiveShadow = true;
    });
    heldMesh.visible = false;
    heldMesh.userData.hideInMapView = true;
    scene.add(heldMesh);
    localHeldWeaponMeshes.set(key, heldMesh);
    weapon.heldMesh = heldMesh;
    return heldMesh;
  };

  const makeRemoteHeldKey = (weaponType, holderId) => `${weaponType}:${holderId}`;

  const disposeRemoteHeldWeaponMesh = (key) => {
    const entry = remoteHeldWeaponMeshes.get(key);
    if (!entry) return;
    scene.remove(entry.mesh);
    entry.mesh.traverse(child => {
      if (!child.isMesh) return;
      child.geometry?.dispose?.();
      if (Array.isArray(child.material)) {
        child.material.forEach(material => material?.dispose?.());
      } else {
        child.material?.dispose?.();
      }
    });
    remoteHeldWeaponMeshes.delete(key);
  };

  const clearRemoteHeldWeaponFor = (weaponType, holderId) => {
    if (!weaponType || !holderId) return;
    disposeRemoteHeldWeaponMesh(makeRemoteHeldKey(weaponType, holderId));
  };

  const clearRemoteHeldWeaponsForHolder = (holderId) => {
    if (!holderId) return;
    Array.from(remoteHeldWeaponMeshes.keys()).forEach((key) => {
      if (key.endsWith(`:${holderId}`)) {
        disposeRemoteHeldWeaponMesh(key);
      }
    });
  };

  const ensureRemoteHeldWeaponMesh = (weapon, holderId) => {
    if (!weapon?.mesh || !holderId) return null;
    const key = makeRemoteHeldKey(weapon.type, holderId);
    if (remoteHeldWeaponMeshes.has(key)) {
      return remoteHeldWeaponMeshes.get(key).mesh;
    }
    const mesh = weapon.mesh.clone(true);
    mesh.traverse(child => {
      if (!child.isMesh) return;
      child.castShadow = true;
      child.receiveShadow = true;
    });
    mesh.visible = true;
    mesh.userData.hideInMapView = true;
    mesh.userData.isRemoteEquipped = true;
    scene.add(mesh);
    remoteHeldWeaponMeshes.set(key, { mesh, weaponType: weapon.type, holderId });
    return mesh;
  };

  const syncRemoteHeldWeaponMesh = (weapon) => {
    if (!weapon?.mesh) return;
    const localId = multiplayer?.getId?.();
    const holderId = weapon.remoteHolderId ?? null;
    if (!holderId || holderId === localId) {
      clearRemoteHeldWeaponFor(weapon.type, holderId);
      return;
    }
    const remotePlayer = otherPlayers[holderId];
    const remoteModel = remotePlayer?.model;
    if (!remoteModel) {
      clearRemoteHeldWeaponFor(weapon.type, holderId);
      return;
    }
    const remoteHeldMesh = ensureRemoteHeldWeaponMesh(weapon, holderId);
    if (!remoteHeldMesh) return;
    const handBone = weapon._getHandBone?.(remoteModel);
    const holdQuaternion = weapon._holdQuaternion || new THREE.Quaternion();
    const holdOffset = weapon._holdOffset || new THREE.Vector3();
    if (handBone) {
      handBone.updateWorldMatrix(true, false);
      handBone.getWorldPosition(remoteHoldTempPosition);
      handBone.getWorldQuaternion(remoteHoldTempQuaternion);
      remoteHeldMesh.position.copy(remoteHoldTempPosition);
      remoteHoldTempOffset.copy(holdOffset).applyQuaternion(remoteHoldTempQuaternion);
      remoteHeldMesh.position.add(remoteHoldTempOffset);
      remoteHeldMesh.quaternion.copy(remoteHoldTempQuaternion).multiply(holdQuaternion);
    } else {
      const quaternion = remoteModel.quaternion;
      remoteHoldTempOffset.copy(holdOffset).applyQuaternion(quaternion);
      remoteHeldMesh.position.copy(remoteModel.position).add(remoteHoldTempOffset);
      remoteHeldMesh.quaternion.copy(quaternion).multiply(holdQuaternion);
    }
    weapon.mesh.visible = false;
  };

  const syncPresenceRemoteEquipment = (remoteId, payload) => {
    if (!remoteId || !payload) return;
    const localId = multiplayer?.getId?.();
    if (!remoteId || remoteId === localId) return;
    const remotePlayer = otherPlayers[remoteId];
    if (!remotePlayer?.model) return;

    const nextLeft = typeof payload.equippedLeft === 'string' ? payload.equippedLeft : null;
    const nextRight = typeof payload.equippedRight === 'string' ? payload.equippedRight : null;

    remotePresenceEquipment.set(remoteId, { left: nextLeft, right: nextRight });

    const remoteEquipByType = {
      lantern,
      torch,
      iceGun: iceGun,
      bow,
      bomb,
      sword: autumnSword
    };

    const setRemoteEquipState = (weaponType, isEquipped) => {
      const weapon = remoteEquipByType[weaponType];
      if (!weapon) return;
      const previousHolderId = weapon.remoteHolderId ?? null;
      const nextHolderId = isEquipped ? remoteId : null;
      if (previousHolderId === nextHolderId) return;
      weapon.remoteHolderId = nextHolderId;
      updateRemoteWeaponType(weapon, nextHolderId, previousHolderId);
    };

    setRemoteEquipState('lantern', nextLeft === 'lantern');
    setRemoteEquipState('torch', nextLeft === 'torch');
    setRemoteEquipState('iceGun', nextRight === 'iceGun');
    setRemoteEquipState('bow', nextRight === 'bow');
    setRemoteEquipState('bomb', nextRight === 'bomb');
    setRemoteEquipState('sword', nextRight === 'sword');

    remotePlayer.model.userData.equippedWeaponType = nextRight || nextLeft || null;
  };

  const clearAllRemoteHeldWeaponMeshes = () => {
    Array.from(remoteHeldWeaponMeshes.keys()).forEach(disposeRemoteHeldWeaponMesh);
  };

  const { IceGun, Bow, Lantern, AutumnSword, Bomb } = await loadSpecialWeapons();

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
    const heldMesh = ensureLocalHeldWeaponMesh(iceGun, 'iceGun');
    iceGun.useHeldMeshWhenHeld = true;
    if (heldMesh) heldMesh.visible = true;
    if (lantern?.holder === playerControls) {
      iceGun.holder = null;
      iceGun.localHoldOrigin = null;
      return;
    }
    dropOtherWeapons(iceGun);
    addToInventory('iceGun', 1);
    iceGun.localHoldOrigin = 'world';
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
    iceGun.localHoldOrigin = null;
    if (shouldRemoveFromInventory) {
      removeFromInventory('iceGun', 1);
    }
    clearPlayerWeaponType(holder, iceGun.type);
    if (iceGun.heldMesh) {
      iceGun.heldMesh.visible = false;
    }
    iceGun.useHeldMeshWhenHeld = true;
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
        holderId: (iceGun.holder === playerControls && iceGun.localHoldOrigin === 'world') ? multiplayer?.getId?.() : null
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
      iceGun.remoteHolderId = state.holderId ?? getPresenceHolderForWeaponType(iceGun.type);
      updateRemoteWeaponType(iceGun, iceGun.remoteHolderId, previousHolderId);
      if (state.holderId !== multiplayer?.getId?.() && iceGun.holder === playerControls && iceGun.localHoldOrigin === 'world') {
        iceGun.holder = null;
        iceGun.localHoldOrigin = null;
        clearPlayerWeaponType(playerControls, iceGun.type);
      }
    },
    isLocallyControlled: () => iceGun?.holder === playerControls
  });

  bow = new Bow(scene);
  await bow.load();
  window.bow = bow;
  await loadArrowTemplate();
  await loadManaPotionTemplate();
  let bowHeldArrow = null;
  let bowHeldMesh = null;
  const ensureBowHeldMesh = ({ forceNew = false } = {}) => {
    if (!bow?.mesh) return bowHeldMesh;
    if (forceNew && bowHeldMesh) {
      scene.remove(bowHeldMesh);
      bowHeldMesh.traverse(child => {
        if (!child.isMesh) return;
        child.geometry?.dispose?.();
        if (Array.isArray(child.material)) {
          child.material.forEach(material => material?.dispose?.());
        } else {
          child.material?.dispose?.();
        }
      });
      bowHeldMesh = null;
      bow.heldMesh = null;
    }
    if (bowHeldMesh) return bowHeldMesh;
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
    notifyAchievementProgress('weaponsCollected', 1);
    bow.localHoldOrigin = 'world';
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
    bow.localHoldOrigin = null;
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
        holderId: (bow.holder === playerControls && bow.localHoldOrigin === 'world') ? multiplayer?.getId?.() : null
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
      bow.remoteHolderId = state.holderId ?? getPresenceHolderForWeaponType(bow.type);
      updateRemoteWeaponType(bow, bow.remoteHolderId, previousHolderId);
      if (state.holderId !== multiplayer?.getId?.() && bow.holder === playerControls && bow.localHoldOrigin === 'world') {
        bow.holder = null;
        bow.localHoldOrigin = null;
        clearPlayerWeaponType(playerControls, bow.type);
      }
    },
    isLocallyControlled: () => bow?.holder === playerControls
  });

  bomb = new Bomb(scene);
  await bomb.load();
  window.bomb = bomb;
  const bombMarker = createWeaponMarker(0xff4d4d);
  bomb.onPickup = (holder) => {
    if (holder !== playerControls) return;
    const heldMesh = ensureLocalHeldWeaponMesh(bomb, 'bomb');
    bomb.useHeldMeshWhenHeld = true;
    if (heldMesh) heldMesh.visible = true;
    unequipOtherInventoryItems('bomb');
    addToInventory('bomb', 1);
    notifyAchievementProgress('weaponsCollected', 1);
    bomb.localHoldOrigin = 'world';
    setPlayerWeaponType(holder, bomb.type);
  };
  bomb.onDrop = (holder, { removeFromInventory: shouldRemoveFromInventory } = {}) => {
    if (holder !== playerControls) return;
    bomb.localHoldOrigin = null;
    if (shouldRemoveFromInventory) {
      removeFromInventory('bomb', 1);
    }
    clearPlayerWeaponType(holder, bomb.type);
    if (bomb.heldMesh) {
      bomb.heldMesh.visible = false;
    }
    bomb.useHeldMeshWhenHeld = true;
  };
  if (bomb.mesh) {
    bomb.mesh.userData.hideInMapView = true;
    bomb.mesh.visible = false;
  }
  registerNetworkedEntity('bomb', {
    getState: () => {
      if (!bomb?.mesh) return null;
      const pos = bomb.mesh.position;
      const q = bomb.mesh.quaternion;
      return {
        position: [pos.x, pos.y, pos.z],
        rotation: [q.x, q.y, q.z, q.w],
        holderId: (bomb.holder === playerControls && bomb.localHoldOrigin === 'world') ? multiplayer?.getId?.() : null
      };
    },
    applyState: state => {
      if (!bomb?.mesh || !state) return;
      const [px, py, pz] = state.position || [];
      const [rx, ry, rz, rw] = state.rotation || [];
      if (Number.isFinite(px) && Number.isFinite(py) && Number.isFinite(pz)) {
        bomb.mesh.position.set(px, py, pz);
      }
      if (Number.isFinite(rx) && Number.isFinite(ry) && Number.isFinite(rz) && Number.isFinite(rw)) {
        bomb.mesh.quaternion.set(rx, ry, rz, rw);
      }
      const previousHolderId = bomb.remoteHolderId ?? null;
      bomb.remoteHolderId = state.holderId ?? getPresenceHolderForWeaponType(bomb.type);
      updateRemoteWeaponType(bomb, bomb.remoteHolderId, previousHolderId);
      if (state.holderId !== multiplayer?.getId?.() && bomb.holder === playerControls && bomb.localHoldOrigin === 'world') {
        bomb.holder = null;
        bomb.localHoldOrigin = null;
        clearPlayerWeaponType(playerControls, bomb.type);
      }
    },
    isLocallyControlled: () => bomb?.holder === playerControls
  });

  autumnSword = new AutumnSword(scene);
  await autumnSword.load();
  window.autumnSword = autumnSword;
  const autumnSwordMarker = createWeaponMarker(0xffd400);
  autumnSword.onPickup = (holder) => {
    if (holder !== playerControls) return;
    const heldMesh = ensureLocalHeldWeaponMesh(autumnSword, 'autumnSword');
    autumnSword.useHeldMeshWhenHeld = true;
    if (heldMesh) heldMesh.visible = true;
    unequipOtherInventoryItems('autumnSword');
    addToInventory('autumnSword', 1);
    notifyAchievementProgress('weaponsCollected', 1);
    autumnSword.localHoldOrigin = 'world';
    setPlayerWeaponType(holder, autumnSword.type);
  };
  autumnSword.onDrop = (holder, { removeFromInventory: shouldRemoveFromInventory } = {}) => {
    if (holder !== playerControls) return;
    autumnSword.localHoldOrigin = null;
    if (shouldRemoveFromInventory) {
      removeFromInventory('autumnSword', 1);
    }
    clearPlayerWeaponType(holder, autumnSword.type);
    if (autumnSword.heldMesh) {
      autumnSword.heldMesh.visible = false;
    }
    autumnSword.useHeldMeshWhenHeld = true;
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
        holderId: (autumnSword.holder === playerControls && autumnSword.localHoldOrigin === 'world') ? multiplayer?.getId?.() : null
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
      autumnSword.remoteHolderId = state.holderId ?? getPresenceHolderForWeaponType(autumnSword.type);
      updateRemoteWeaponType(autumnSword, autumnSword.remoteHolderId, previousHolderId);
      if (state.holderId !== multiplayer?.getId?.() && autumnSword.holder === playerControls && autumnSword.localHoldOrigin === 'world') {
        autumnSword.holder = null;
        autumnSword.localHoldOrigin = null;
        clearPlayerWeaponType(playerControls, autumnSword.type);
      }
    },
    isLocallyControlled: () => autumnSword?.holder === playerControls
  });

  runtimeContext.entities.weapons = { iceGun, bow, bomb, autumnSword };
  window.weapons = { iceGun, bow, bomb, autumnSword };

  function attachMonsterPhysics(monster, { mode = 'dynamic' } = {}) {
    const model = monster?.model;
    if (!model || !rapierWorld) return null;
    const existingBody = monster.body;
    if (existingBody && rapierWorld.getRigidBody(existingBody.handle)) {
      rbToMesh.delete(existingBody);
      removeRigidBodySafely(rapierWorld, existingBody);
      model.userData.rb = null;
    }

    const scale = monster.sizeScale || 1;
    const isKinematic = mode === 'kinematic';
    const rbDesc = isKinematic
      ? RAPIER.RigidBodyDesc.kinematicPositionBased()
      : RAPIER.RigidBodyDesc.dynamic();
    rbDesc
      .setTranslation(model.position.x, model.position.y, model.position.z)
      .setLinearDamping(0.5)
      .setAngularDamping(0.5);
    const rb = rapierWorld.createRigidBody(rbDesc);
    rb.setEnabledRotations(false, true, false, true);
    const colDesc = RAPIER.ColliderDesc.capsule(0.6 * scale, 0.3 * scale);
    rapierWorld.createCollider(colDesc, rb);
    model.userData.rb = rb;
    rbToMesh.set(rb, model);
    if (monster.syncBodyFromTransform) {
      monster.syncBodyFromTransform({ zeroVelocity: true });
    }
    if (monster.setBackgroundMode) {
      monster.setBackgroundMode(isKinematic);
    }
    return rb;
  }

  function detachMonsterPhysics(monster) {
    if (!monster?.model) return;
    const body = monster.body;
    if (body && rapierWorld?.getRigidBody(body.handle)) {
      rbToMesh.delete(body);
      removeRigidBodySafely(rapierWorld, body);
    }
    monster.model.userData.rb = null;
    monster.setBackgroundMode?.(true);
  }

  function setMonsterPhysicsMode(monster, mode = 'dynamic') {
    if (!monster?.model || !rapierWorld) return;
    const body = monster.body;
    const wantsDynamic = mode === 'dynamic';
    const wantsKinematic = mode === 'kinematic';
    const isDynamic = !!body?.isDynamic?.();
    const isKinematic = !!body?.isKinematic?.();
    if (wantsDynamic && isDynamic) {
      monster.setBackgroundMode?.(false);
      monster.syncBodyFromTransform?.({ zeroVelocity: false });
      return;
    }
    if (wantsKinematic && isKinematic) {
      monster.setBackgroundMode?.(true);
      monster.syncBodyFromTransform?.({ zeroVelocity: true });
      return;
    }
    attachMonsterPhysics(monster, { mode });
  }

  const detachNpcPhysics = (npc) => {
    const body = npc?.body;
    if (body && rapierWorld?.getRigidBody(body.handle)) {
      rbToMesh.delete(body);
      removeRigidBodySafely(rapierWorld, body);
    }
  };

  window.attachMonsterPhysics = attachMonsterPhysics;
  window.detachNpcPhysics = detachNpcPhysics;
  window.setMonsterPhysicsMode = setMonsterPhysicsMode;



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
    const heldMesh = ensureLocalHeldWeaponMesh(lantern, 'lantern');
    if (heldMesh) {
      lantern.useHeldMeshWhenHeld = true;
      heldMesh.visible = true;
    }
    unequipOtherInventoryItems('lantern');
    addToInventory('lantern', 1);
    lantern.localHoldOrigin = 'world';
  };
  lantern.onDrop = (holder, { removeFromInventory: shouldRemoveFromInventory } = {}) => {
    if (holder !== playerControls) return;
    lantern.localHoldOrigin = null;
    if (shouldRemoveFromInventory) {
      removeFromInventory('lantern', 1);
    }
  };
  if (lantern.mesh) {
    lantern.mesh.userData.hideInMapView = true;
    lantern.mesh.visible = false;
  }
  registerNetworkedEntity('lantern', {
    getState: () => {
      if (!lantern?.mesh) return null;
      const pos = lantern.mesh.position;
      const q = lantern.mesh.quaternion;
      return {
        position: [pos.x, pos.y, pos.z],
        rotation: [q.x, q.y, q.z, q.w],
        holderId: (lantern.holder === playerControls && lantern.localHoldOrigin === 'world') ? multiplayer?.getId?.() : null
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
      const previousHolderId = lantern.remoteHolderId ?? null;
      lantern.remoteHolderId = state.holderId ?? getPresenceHolderForWeaponType(lantern.type);
      updateRemoteWeaponType(lantern, lantern.remoteHolderId, previousHolderId);
      if (state.holderId !== multiplayer?.getId?.() && lantern.holder === playerControls && lantern.localHoldOrigin === 'world') {
        lantern.holder = null;
        lantern.localHoldOrigin = null;
      }
    },
    isLocallyControlled: () => lantern?.holder === playerControls
  });

  torch = new Torch(scene);
  await torch.load(TORCH_PICKUP_LOCATION.clone());
  window.torch = torch;
  const torchMarker = createWeaponMarker(0xffa54c);
  torch.onPickup = (holder) => {
    if (holder !== playerControls) return;
    const heldMesh = ensureLocalHeldWeaponMesh(torch, 'torch');
    if (heldMesh) {
      torch.useHeldMeshWhenHeld = true;
      heldMesh.visible = true;
    }
    if (lantern?.holder === holder) {
      unequipInventoryItem('lantern');
    }
    unequipOtherInventoryItems(TORCH_ITEM_ID);
    const pickupHealth = normalizeTorchHealth(torch.mesh?.userData?.torchHealth);
    addToInventory(TORCH_ITEM_ID, 1, { torchHealth: pickupHealth });
    torch.localHoldOrigin = 'world';
    const torchEntry = inventoryState[TORCH_ITEM_ID];
    const healths = getTorchHealths(torchEntry);
    equippedTorchIndex = healths.length ? healths.length - 1 : null;
    torch.mesh.userData.torchHealth = pickupHealth;
    setPlayerWeaponType(holder, torch.type);
  };
  torch.onDrop = (holder, { removeFromInventory: shouldRemoveFromInventory } = {}) => {
    if (holder !== playerControls) return;
    torch.localHoldOrigin = null;
    if (shouldRemoveFromInventory) {
      const result = takeTorchHealth(inventoryState, equippedTorchIndex);
      if (result?.health != null) {
        torch.mesh.userData.torchHealth = result.health;
      }
      equippedTorchIndex = null;
      persistInventoryAndStorage();
    }
    clearPlayerWeaponType(holder, torch.type);
  };
  if (torch.mesh) {
    torch.mesh.userData.hideInMapView = true;
    torch.mesh.userData.torchHealth = DEFAULT_TORCH_HEALTH;
    torch.mesh.visible = false;
  }
  registerNetworkedEntity('torch', {
    getState: () => {
      if (!torch?.mesh) return null;
      const pos = torch.mesh.position;
      const q = torch.mesh.quaternion;
      return {
        position: [pos.x, pos.y, pos.z],
        rotation: [q.x, q.y, q.z, q.w],
        holderId: (torch.holder === playerControls && torch.localHoldOrigin === 'world') ? multiplayer?.getId?.() : null,
        torchHealth: torch.mesh.userData.torchHealth ?? DEFAULT_TORCH_HEALTH
      };
    },
    applyState: state => {
      if (!torch?.mesh || !state) return;
      const [px, py, pz] = state.position || [];
      const [rx, ry, rz, rw] = state.rotation || [];
      if (Number.isFinite(px) && Number.isFinite(py) && Number.isFinite(pz)) {
        torch.mesh.position.set(px, py, pz);
      }
      if (Number.isFinite(rx) && Number.isFinite(ry) && Number.isFinite(rz) && Number.isFinite(rw)) {
        torch.mesh.quaternion.set(rx, ry, rz, rw);
      }
      if (Number.isFinite(state.torchHealth)) {
        torch.mesh.userData.torchHealth = normalizeTorchHealth(state.torchHealth);
      }
      const previousHolderId = torch.remoteHolderId ?? null;
      torch.remoteHolderId = state.holderId ?? getPresenceHolderForWeaponType(torch.type);
      updateRemoteWeaponType(torch, torch.remoteHolderId, previousHolderId);
      if (state.holderId !== multiplayer?.getId?.() && torch.holder === playerControls && torch.localHoldOrigin === 'world') {
        torch.holder = null;
        torch.localHoldOrigin = null;
        clearPlayerWeaponType(playerControls, torch.type);
      }
    },
    isLocallyControlled: () => torch?.holder === playerControls
  });

  runtimeContext.entities.weapons = { iceGun, bow, bomb, autumnSword, lantern, torch };
  window.weapons = { iceGun, bow, bomb, autumnSword, lantern, torch };
  treasureChest = new TreasureChest(scene);
  await treasureChest.load();
  window.treasureChest = treasureChest;
  if (treasureChest.mesh) {
    treasureChest.mesh.visible = false;
  }
  treasureChest.onOpen = (holder) => {
    if (holder !== playerControls) return;
    audioManager?.playSFX('SFX/Doors Gates and Chests/Door Open 1.ogg', 0.65, {
      cooldownKey: 'door-open-chest',
      cooldownMs: 120
    });
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
    spawnPositions: [],
    allowDefaultPositions: false
  });
  applePickups = appleController?.pickups || [];
  window.applePickups = applePickups;
  window.woodPickups = woodPickups;
  window.meatPickups = meatPickups;
  window.zombieBrainsPickups = zombieBrainsPickups;
  window.saltPickups = saltPickups;
  natureController = await createNature({
    scene,
    playerModel,
    getTerrainHeight,
    mapRenderer,
    buildingsRenderer,
    getGeoForLocal: getTreeGeoForLocal,
    tileCache,
    rapier: RAPIER,
    rapierWorld,
    spawnApplePickup: appleController?.spawnPickup,
    removeApplePickup: appleController?.removePickup
  });
  window.natureController = natureController;
  natureController?.update(playerModel?.position);
  // await createCabin({ scene, getTerrainHeight });
  mushroomController = await createMushrooms({
    scene,
    getTerrainHeight,
    scatterCenter: playerModel?.position,
    scatterRadius: PICKUP_SPAWN_RADIUS
  });
  await createTower({ scene, getTerrainHeight, rapierWorld, rapier: RAPIER });
  mushroomPickups = mushroomController?.pickups || [];
  mushroomPickups.forEach((pickup) => {
    const pickupPosition = pickup?.mesh?.position || pickup?.position;
    if (pickup?.active && pickupPosition) {
      mushroomPickupGrid.add(pickup, pickupPosition);
    }
  });
  window.mushroomPickups = mushroomPickups;
  animalManager = createAnimalManager({
    scene,
    getPlayerModel: () => playerModel,
    getTerrainHeight,
    onAnimalRemoved: ({ animal, wasDead, position }) => {
      if (!wasDead || !position) return;
      notifyAchievementProgress('animalsKilled', 1);
      window.questManager?.handleAnimalKilled?.(animal);
      for (let i = 0; i < 2; i += 1) {
        const angle = (i / 2) * Math.PI * 2;
        const offset = new THREE.Vector3(Math.cos(angle) * 0.35, 0, Math.sin(angle) * 0.35);
        spawnMeatPickup(position.clone().add(offset));
      }
    }
  });
  animals = animalManager.getAnimals();
  runtimeContext.entities.animals = animals;
  window.animals = animals;
  let didInitialGpsSnap = false;
  let currentPlayerLevel = 1;

  const getRandomMonsterModel = () => {
    const index = Math.floor(Math.random() * MONSTER_MODELS.length);
    return MONSTER_MODELS[index];
  };

  const getRandomMonsterLevel = (playerLevel = currentPlayerLevel) => {
    const safePlayerLevel = Math.max(1, Math.round(playerLevel || 1));
    const cap = Math.max(1, Math.min(8, safePlayerLevel + 1));
    const weighted = MONSTER_LEVEL_WEIGHTS
      .map((entry) => {
        const baseWeight = Math.max(0, Number(entry.weight) || 0);
        if (entry.level > cap) return null;
        const distanceFromPlayer = Math.abs(entry.level - safePlayerLevel);
        const closenessBoost = 1 + Math.max(0, safePlayerLevel - distanceFromPlayer) * 0.15;
        const highLevelBias = 1 + Math.max(0, safePlayerLevel - 1) * (entry.level / cap) * 0.08;
        return { level: entry.level, weight: baseWeight * closenessBoost * highLevelBias };
      })
      .filter(Boolean);
    const totalWeight = weighted.reduce((sum, entry) => sum + entry.weight, 0);
    if (totalWeight <= 0) return 1;
    let pick = Math.random() * totalWeight;
    for (const entry of weighted) {
      pick -= entry.weight;
      if (pick <= 0) {
        return entry.level;
      }
    }
    return weighted[0]?.level ?? 1;
  };

  const getMonsterClusterSizeForLevel = (playerLevel = currentPlayerLevel) => {
    const safePlayerLevel = Math.max(1, Math.round(playerLevel || 1));
    const guaranteed = 1 + Math.floor((safePlayerLevel - 1) / 4);
    const bonusChance = Math.min(0.75, (safePlayerLevel - 1) * 0.08);
    const withBonus = guaranteed + (Math.random() < bonusChance ? 1 : 0);
    return Math.max(1, Math.min(MONSTER_CLUSTER_MAX_SIZE, withBonus));
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

  configureSpawnAlignment({ liftPositionToBuildingTop });

  window.lightSources = [];

  friendlyNpcManager = createFriendlyNpcManager({
    scene,
    playerModel,
    otherPlayers,
    attachPhysics: attachMonsterPhysics,
    detachPhysics: detachMonsterPhysics,
    getTerrainHeight,
    liftPositionToBuildingTop,
    isHost,
    debug: window.DEBUG_FRIENDLY_PERSIST,
    onSpawnEvent: handleCharacterSpawnEvent,
    onBeforeSpawn: (...args) => trimTravelSpawnPopulationIfNeeded(...args)
  });
  if (multiplayer?.roomId) {
    friendlyNpcManager.onRoomReady({ roomId: multiplayer.roomId, isHost: multiplayer.isHost });
  }

  let buildingColliderBody = null;
  const rebuildBuildingColliders = () => {
    if (!rapierWorld) return;

    if (buildingColliderBody && rapierWorld.getRigidBody(buildingColliderBody.handle)) {
      removeRigidBodySafely(rapierWorld, buildingColliderBody);
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

  const removeMonsterById = (monsterId) => {
    const index = monsters.findIndex((entry) => entry?.id === monsterId);
    if (index < 0) return false;
    const [monster] = monsters.splice(index, 1);
    stopZombieLoopVoice(monsterId);
    cleanupMonster(monster);
    runtimeContext.entities.monsters = monsters;
  window.monsters = monsters;
    return true;
  };

  const countSpawnedTravelCharacters = () => {
    const livingMonsters = monsters.filter((monster) => monster?.model && !monster?.isDead).length;
    const livingFriendlies = (friendlyNpcManager?.friendlies || []).filter((friendly) => friendly?.model && !friendly?.isDead).length;
    const livingAnimals = (animals || []).filter((animal) => animal?.model && !animal?.isDead).length;
    const merchantCount = getMerchantFriendlyFeature()?.model ? 1 : 0;
    return livingMonsters + livingFriendlies + livingAnimals + merchantCount;
  };

  const trimTravelSpawnPopulationIfNeeded = async (incomingCount = 1, originPosition = playerModel?.position) => {
    const targetOrigin = originPosition?.clone?.() || playerModel?.position?.clone?.();
    if (!targetOrigin) return;
    let total = countSpawnedTravelCharacters();
    while (total + incomingCount > MAX_TRAVEL_SPAWN_CHARACTERS_TOTAL) {
      const candidates = [];
      monsters.forEach((monster) => {
        if (!monster?.model || monster?.isDead) return;
        candidates.push({ type: 'monster', id: monster.id, distance: monster.model.position.distanceTo(targetOrigin) });
      });
      (friendlyNpcManager?.friendlies || []).forEach((friendly) => {
        if (!friendly?.model || friendly?.isDead) return;
        candidates.push({ type: 'friendly', id: friendly.id, distance: friendly.model.position.distanceTo(targetOrigin) });
      });
      (animals || []).forEach((animal) => {
        if (!animal?.model || animal?.isDead) return;
        candidates.push({ type: 'animal', id: animal.id, distance: animal.model.position.distanceTo(targetOrigin) });
      });
      const merchantFriendly = getMerchantFriendlyFeature();
      if (merchantFriendly?.model) {
        candidates.push({ type: 'merchant', distance: merchantFriendly.model.position.distanceTo(targetOrigin) });
      }
      if (!candidates.length) return;
      candidates.sort((a, b) => b.distance - a.distance);
      const furthest = candidates[0];
      if (!furthest) return;
      if (furthest.type === 'monster') {
        removeMonsterById(furthest.id);
      } else if (furthest.type === 'friendly') {
        friendlyNpcManager?.removeFriendlyById?.(furthest.id);
      } else if (furthest.type === 'animal') {
        animalManager?.removeAnimalById?.(furthest.id);
      } else if (furthest.type === 'merchant') {
        await clearMerchantSpawnFeature?.();
      }
      total = countSpawnedTravelCharacters();
    }
  };

  function spawnEncounterMonster(spawnEvent) {
    if (!spawnEvent?.position) return;
    const playerLevel = currentPlayerLevel;
    const clusterSize = getMonsterClusterSizeForLevel(playerLevel);
    const yaw = Math.atan2(spawnEvent.direction?.x || 0, spawnEvent.direction?.z || 1);
    const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0));
    void trimTravelSpawnPopulationIfNeeded(clusterSize, spawnEvent.position).then(() => {
      for (let index = 0; index < clusterSize; index += 1) {
        const slotId = monsterSlotIds.find((id) => (
          !monsters.some((monster) => monster?.id === id)
          && !spawningSlots.has(id)
          && !respawnTimers.has(id)
        ));
        if (!slotId) continue;
        const modelPath = getRandomMonsterModel();
        const offsetAngle = Math.random() * Math.PI * 2;
        const offsetRadius = index === 0 ? 0 : THREE.MathUtils.randFloat(1.5, 5.5);
        const clusterPosition = spawnEvent.position.clone().add(new THREE.Vector3(
          Math.cos(offsetAngle) * offsetRadius,
          0,
          Math.sin(offsetAngle) * offsetRadius
        ));
        applySpawnY(clusterPosition, 0.5, { allowOnBuildings: true });
        spawnMonsterInSlot(slotId, modelPath, null, {
          position: clusterPosition,
          rotation,
          level: getRandomMonsterLevel(playerLevel),
          skipPersist: false
        });
      }
    });
  }

  async function handleCharacterSpawnEvent(spawnEvent) {
    if (!spawnEvent?.position) return;
    if (spawnEvent.type === 'merchant') {
      await trimTravelSpawnPopulationIfNeeded(1, spawnEvent.position);
      await spawnMerchantAtFeature({
        position: spawnEvent.position,
        scene,
        attachPhysics: attachMonsterPhysics,
        getTerrainHeight,
        liftPositionToBuildingTop
      });
      return;
    }
    if (spawnEvent.type === 'monster') {
      spawnEncounterMonster(spawnEvent);
      return;
    }
    if (spawnEvent.type === 'animal') {
      await trimTravelSpawnPopulationIfNeeded(1, spawnEvent.position);
      await animalManager?.spawnDeerAt?.(spawnEvent.position);
      return;
    }
  }


  const getMonsterGroundOffset = (monsterLikeOrLevel = null) => {
    if (monsterLikeOrLevel && Number.isFinite(monsterLikeOrLevel.sizeScale)) {
      return MONSTER_SPAWN_GROUND_OFFSET * Math.max(0.75, monsterLikeOrLevel.sizeScale);
    }
    if (Number.isFinite(monsterLikeOrLevel)) {
      const level = Math.max(1, Math.round(monsterLikeOrLevel));
      const estimatedScale = 1 + (0.5 * (level - 1));
      return MONSTER_SPAWN_GROUND_OFFSET * Math.max(0.75, estimatedScale);
    }
    return MONSTER_SPAWN_GROUND_OFFSET;
  };

  const getMonsterSpawnPosition = (monsterLikeOrLevel = null) => {
    const groundOffset = getMonsterGroundOffset(monsterLikeOrLevel);
    for (let attempt = 0; attempt < MONSTER_SPAWN_ATTEMPTS; attempt += 1) {
      const angle = Math.random() * Math.PI * 2;
      const radius = THREE.MathUtils.randFloat(MONSTER_SPAWN_MIN_RADIUS, MONSTER_SPAWN_MAX_RADIUS);
      const spawnPos = new THREE.Vector3(
        playerModel.position.x + Math.cos(angle) * radius,
        0,
        playerModel.position.z + Math.sin(angle) * radius
      );
      const spawnY = getSpawnY(spawnPos.x, spawnPos.z, groundOffset, { allowOnBuildings: true });
      spawnPos.y = Number.isFinite(spawnY) ? spawnY : 0.5;
      if (spawnPos.distanceTo(playerModel.position) < MONSTER_SPAWN_MIN_RADIUS) {
        continue;
      }
      return spawnPos;
    }
    const fallback = playerModel.position.clone();
    fallback.x += MONSTER_SPAWN_MIN_RADIUS;
    const fallbackY = getSpawnY(fallback.x, fallback.z, groundOffset, { allowOnBuildings: true });
    fallback.y = Number.isFinite(fallbackY) ? fallbackY : fallback.y;
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
    arrowMesh.visible = true;
    arrowMesh.traverse(child => {
      if (!child.isMesh) return;
      child.visible = true;
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

  async function loadManaPotionTemplate() {
    if (manaPotionTemplate) return manaPotionTemplate;
    if (!manaPotionTemplatePromise) {
      const loader = new GLTFLoader();
      manaPotionTemplatePromise = loader.loadAsync(MANA_POTION_MODEL_URL)
        .then(gltf => {
          manaPotionTemplate = gltf.scene;
          return manaPotionTemplate;
        })
        .catch(error => {
          console.warn('Failed to load mana potion model.', error);
          manaPotionTemplate = null;
          return null;
        })
        .finally(() => {
          manaPotionTemplatePromise = null;
        });
    }
    return manaPotionTemplatePromise;
  }

  function cloneManaPotionMesh(template, scale = MANA_POTION_SCALE) {
    if (!template) return null;
    const potionMesh = template.clone(true);
    potionMesh.visible = true;
    potionMesh.traverse(child => {
      if (!child.isMesh) return;
      child.visible = true;
      child.geometry = child.geometry?.clone?.() ?? child.geometry;
      if (Array.isArray(child.material)) {
        child.material = child.material.map(material => material?.clone?.() ?? material);
      } else {
        child.material = child.material?.clone?.() ?? child.material;
      }
      child.castShadow = true;
      child.receiveShadow = true;
    });
    potionMesh.scale.setScalar(scale);
    return potionMesh;
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
      removeRigidBodySafely(rapierWorld, body);
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
        monster.lastAnimUpdateMs = 0;
        const level = Number.isFinite(options.level) ? options.level : getRandomMonsterLevel();
        monster.setLevel(level, { preserveHealth: false });
        monster.resetHealth();

        if (Number.isFinite(options.health)) {
          monster.health = normalizeHealthSegments(options.health, monster.level);
          monster.model.userData.health = monster.health;
        }
        if (options.alive === false || (Number.isFinite(options.health) && options.health <= 0)) {
          monster.markDead();
        }

        const spawnPos = options.position
          && Number.isFinite(options.position.x)
          && Number.isFinite(options.position.z)
          ? normalizeNetworkSpawnPosition(
            options.position,
            getMonsterGroundOffset(monster),
            { allowOnBuildings: true }
          ) || getMonsterSpawnPosition(monster)
          : getMonsterSpawnPosition(monster);
        monster.setPosition(spawnPos.x, spawnPos.y, spawnPos.z);

        cleanupMonster(oldMonster);
        scene.add(monster.model);
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


  function resolvePersistedMonsterModelPath(record, fallbackModelPath = null) {
    const modelPath = typeof record?.modelPath === 'string' ? record.modelPath.trim() : '';
    if (modelPath) return modelPath;

    const legacyType = typeof record?.type === 'string' ? record.type.trim() : '';
    if (legacyType.startsWith('/models/')) return legacyType;

    return fallbackModelPath;
  }

  function applyMonsterRecord(record, recordId, { applyTransform = false } = {}) {
    if (!record) return;
    const slotId = record.id || recordId;
    if (!slotId) return;

    const recordIsDead = record.alive === false
      || (Number.isFinite(record.hp) && record.hp <= 0);
    if (recordIsDead && isHost) {
      const existing = monsters.find(entry => entry.id === slotId);
      if (existing) {
        existing.applyPersistedState?.({
          hp: record.hp,
          alive: false,
          level: record.level,
          version: Number.isFinite(record.version) ? record.version : null
        });
        if (!existing.isDead) {
          existing.markDead?.();
        }
      }
      return;
    }

    const incomingVersion = Number.isFinite(record.version) ? record.version : null;
    const existing = monsters.find(entry => entry.id === slotId);
    const existingVersion = Number.isFinite(existing?.version) ? existing.version : -Infinity;

    if (incomingVersion != null && incomingVersion < existingVersion) return;

    const modelPath = resolvePersistedMonsterModelPath(record, existing?.modelPath);
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
      runtimeContext.entities.monsters = monsters;
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
    runtimeContext.entities.monsters = monsters;
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
        if (Number.isFinite(px) && Number.isFinite(pz)) {
          const normalizedPos = normalizeNetworkSpawnPosition(
            { x: px, y: py, z: pz },
            getMonsterGroundOffset(monster),
            { allowOnBuildings: true }
          );
          if (normalizedPos) {
            monster.model.position.copy(normalizedPos);
            monster.body?.setTranslation({ x: normalizedPos.x, y: normalizedPos.y, z: normalizedPos.z }, true);
          }
        }
        if (Number.isFinite(rx) && Number.isFinite(ry) && Number.isFinite(rz) && Number.isFinite(rw)) {
          monster.model.quaternion.set(rx, ry, rz, rw);
          monster.body?.setRotation({ x: rx, y: ry, z: rz, w: rw }, true);
        }
        if (typeof state.mode === 'string') {
          monster.model.userData.mode = state.mode;
        }
        if (typeof state.health === 'number') {
          monster.health = normalizeHealthSegments(state.health, monster.level);
          monster.model.userData.health = monster.health;
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
    const nextHunger = clampHungerSegments(currentHunger - hungerDecay);
    const updatedStats = { ...profile.stats, hunger: nextHunger, energy: nextHunger };
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
    energy: playerProfile.stats.hunger,
    magic: playerProfile.stats.magic,
    maxHealthSegments: playerProfile.stats.maxHealthSegments,
    maxHungerSegments: playerProfile.stats.maxHungerSegments,
    maxMagicSegments: playerProfile.stats.maxMagicSegments,
    level: playerProfile.stats.level,
    strength: playerProfile.stats.strength,
    agility: playerProfile.stats.agility,
    smarts: playerProfile.stats.smarts,
    charm: playerProfile.stats.charm,
    luck: playerProfile.stats.luck,
    xp: playerProfile.stats.xp,
    coins: playerProfile.stats.coins
  };
  statsState.maxHealthSegments = Math.max(BASE_HEALTH_SEGMENTS, Math.round(statsState.maxHealthSegments || BASE_HEALTH_SEGMENTS));
  statsState.maxHungerSegments = Math.max(BASE_HUNGER_SEGMENTS, Math.min(HUNGER_MAX_SEGMENTS, Math.round(statsState.maxHungerSegments || BASE_HUNGER_SEGMENTS)));
  statsState.maxMagicSegments = Math.max(BASE_MAGIC_SEGMENTS, Math.min(MAGIC_MAX_SEGMENTS, Math.round(statsState.maxMagicSegments || BASE_MAGIC_SEGMENTS)));
  statsState.health = normalizeHealthSegments(statsState.health, statsState.level, statsState.maxHealthSegments);
  statsState.hunger = clampHungerSegments(statsState.hunger, statsState.maxHungerSegments);
  statsState.energy = statsState.hunger;
  statsState.magic = clampMagicSegments(statsState.magic, statsState.maxMagicSegments);
  currentPlayerLevel = Math.max(1, Math.round(statsState.level || 1));
  const spellsAvailable = { ...(playerProfile?.spells || {}) };
  const playerNameDisplay = document.getElementById('player-name-display');
  const playerLevelDisplay = document.getElementById('player-level');
  const levelPopup = document.getElementById('level-popup');
  const levelUpPanel = document.getElementById('level-up-panel');
  const levelUpTitle = document.getElementById('level-up-title');
  const levelUpSubtitle = document.getElementById('level-up-subtitle');
  const levelUpRemaining = document.getElementById('level-up-remaining');
  const levelUpStrengthButton = document.getElementById('level-up-strength');
  const levelUpMagicButton = document.getElementById('level-up-magic');
  const levelUpHungerButton = document.getElementById('level-up-hunger');
  const levelUpHealthButton = document.getElementById('level-up-health');
  const xpBar = document.getElementById('xp-bar');
  const xpBarFill = document.getElementById('xp-bar-fill');
  const xpGainText = document.getElementById('xp-gain');
  const xpLevelUpText = document.getElementById('xp-level-up');
  const ammoPopup = document.getElementById('ammo-popup');
  const coinPopup = document.getElementById('coin-popup');
  const treasurePopup = document.getElementById('treasure-popup');
  let levelPopupTimer = null;
  let ammoPopupTimer = null;
  let coinPopupTimer = null;
  let treasurePopupTimer = null;
  let xpBarHideTimer = null;
  let xpGainTimer = null;
  let xpLevelUpTimer = null;
  let xpAnimationRunning = false;
  let xpAnimationQueue = [];
  let displayedLevel = Number.isFinite(statsState.level) ? statsState.level : 1;
  let displayedXp = Number.isFinite(statsState.xp) ? statsState.xp : 0;
  let pendingLevelUpChoices = 0;
  let pendingLevelUpLevel = displayedLevel;
  let levelUpSelectionActive = false;
  updatePlayerInfoUI = () => {
    if (playerNameDisplay) {
      playerNameDisplay.textContent = playerName;
    }
    if (playerLevelDisplay) {
      const levelValue = Number.isFinite(displayedLevel) ? displayedLevel : 1;
      playerLevelDisplay.textContent = levelValue;
    }
  };
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
  const achievementBanner = document.createElement('div');
  achievementBanner.className = 'achievement-banner hidden';
  achievementBanner.setAttribute('aria-live', 'polite');
  achievementBanner.setAttribute('aria-atomic', 'true');
  achievementBanner.innerHTML = '<div class="achievement-banner-title"></div><div class="achievement-banner-subtitle"></div>';
  document.body.appendChild(achievementBanner);
  const achievementBannerTitle = achievementBanner.querySelector('.achievement-banner-title');
  const achievementBannerSubtitle = achievementBanner.querySelector('.achievement-banner-subtitle');
  let achievementBannerTimer = null;
  const achievementState = mergeAchievementState(playerProfile?.achievements);
  let questCompletionsTracked = Array.isArray(playerProfile?.quests?.completedQuestIds)
    ? playerProfile.quests.completedQuestIds.length
    : 0;
  let climbedSinceGrounded = false;
  const showAchievementBanner = (title, xpAmount) => {
    if (!achievementBannerTitle || !achievementBannerSubtitle) return;
    achievementBannerTitle.textContent = `Achievement Unlocked: ${title}`;
    achievementBannerSubtitle.textContent = `+${Math.max(0, Math.floor(xpAmount || 0))} XP`;
    achievementBanner.classList.remove('hidden');
    if (achievementBannerTimer) {
      clearTimeout(achievementBannerTimer);
    }
    achievementBannerTimer = setTimeout(() => {
      achievementBanner.classList.add('hidden');
      achievementBannerTimer = null;
    }, 2200);
  };
  const persistAchievementProgress = () => {
    if (!profileNameKey) return;
    void saveAchievementState(profileNameKey, achievementState);
  };
  const applyAchievementRewards = (rewards = {}) => {
    const grants = [];
    Object.entries(rewards).forEach(([itemId, value]) => {
      const amount = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
      if (!amount) return;
      if (itemId === 'coins') {
        setStat('coins', (Number.isFinite(statsState.coins) ? statsState.coins : 0) + amount);
        grants.push(`${amount} coins`);
      } else {
        addToInventory(itemId, amount);
        const label = inventoryCatalog[itemId]?.name || itemId;
        grants.push(`${amount} ${label}`);
      }
    });
    if (grants.length) {
      showTreasurePopup(`Reward claimed: ${grants.join(', ')}`);
    }
    return grants;
  };
  const notifyAchievementProgress = (metric, amount = 1) => {
    const unlocked = recordAchievementProgress(achievementState, metric, amount);
    if (!unlocked.length) return;
    unlocked.forEach((achievement) => {
      addPlayerXp(achievement.xp);
      showAchievementBanner(achievement.title, achievement.xp);
    });
    persistAchievementProgress();
    updateSettingsUI();
  };
  const XP_GAIN_DISPLAY_MS = 900;
  const XP_LEVEL_UP_DISPLAY_MS = 900;
  const XP_BAR_HIDE_DELAY_MS = 1400;
  const XP_SEGMENT_MIN_MS = 260;
  const XP_SEGMENT_MAX_MS = 1200;
  const XP_SEGMENT_SPEED = 6;

  const getTotalXpForLevel = (level) => {
    const safeLevel = Math.max(1, Math.floor(level || 1));
    return 50 * safeLevel * (safeLevel - 1);
  };

  const getLevelForXp = (totalXp) => {
    const safeXp = Math.max(0, Math.floor(totalXp || 0));
    const rawLevel = (1 + Math.sqrt(1 + safeXp / 12.5)) / 2;
    return Math.max(1, Math.floor(rawLevel));
  };

  const getXpProgress = (totalXp, level) => {
    const levelStart = getTotalXpForLevel(level);
    const levelEnd = getTotalXpForLevel(level + 1);
    const span = Math.max(1, levelEnd - levelStart);
    const progress = Math.max(0, Math.min(1, (totalXp - levelStart) / span));
    return { progress, levelStart, levelEnd };
  };

  const setXpBarProgress = (totalXp, level) => {
    if (!xpBarFill) return;
    const { progress } = getXpProgress(totalXp, level);
    xpBarFill.style.width = `${Math.round(progress * 1000) / 10}%`;
  };

  const showXpGain = (amount) => {
    if (!xpGainText) return;
    xpGainText.textContent = `+${amount} XP`;
    xpGainText.classList.add('visible');
    if (xpGainTimer) {
      clearTimeout(xpGainTimer);
    }
    xpGainTimer = setTimeout(() => {
      xpGainText.classList.remove('visible');
      xpGainTimer = null;
    }, XP_GAIN_DISPLAY_MS);
  };

  const showXpLevelUp = () => {
    if (!xpLevelUpText) return;
    xpLevelUpText.classList.add('visible');
    if (xpLevelUpTimer) {
      clearTimeout(xpLevelUpTimer);
    }
    xpLevelUpTimer = setTimeout(() => {
      xpLevelUpText.classList.remove('visible');
      xpLevelUpTimer = null;
    }, XP_LEVEL_UP_DISPLAY_MS);
  };

  const showXpBar = () => {
    if (!xpBar) return;
    xpBar.classList.remove('hidden');
    if (xpBarHideTimer) {
      clearTimeout(xpBarHideTimer);
      xpBarHideTimer = null;
    }
  };

  const hideXpBarLater = () => {
    if (!xpBar) return;
    if (xpBarHideTimer) {
      clearTimeout(xpBarHideTimer);
    }
    xpBarHideTimer = setTimeout(() => {
      xpBar.classList.add('hidden');
      xpBarHideTimer = null;
    }, XP_BAR_HIDE_DELAY_MS);
  };

  const animateXpSegment = (startXp, endXp, level) => new Promise(resolve => {
    const delta = Math.max(0, endXp - startXp);
    if (delta === 0) {
      setXpBarProgress(endXp, level);
      resolve();
      return;
    }
    const duration = Math.min(
      XP_SEGMENT_MAX_MS,
      Math.max(XP_SEGMENT_MIN_MS, delta * XP_SEGMENT_SPEED)
    );
    const startTime = performance.now();
    const tick = (now) => {
      const elapsed = now - startTime;
      const t = Math.min(1, elapsed / duration);
      const currentXp = startXp + delta * t;
      setXpBarProgress(currentXp, level);
      if (t < 1) {
        requestAnimationFrame(tick);
      } else {
        resolve();
      }
    };
    requestAnimationFrame(tick);
  });

  const queueXpAnimation = (amount) => {
    xpAnimationQueue.push(amount);
    if (!xpAnimationRunning) {
      runXpAnimationQueue();
    }
  };

  const runXpAnimationQueue = async () => {
    xpAnimationRunning = true;
    while (xpAnimationQueue.length > 0) {
      const amount = xpAnimationQueue.shift();
      if (!Number.isFinite(amount) || amount <= 0) {
        continue;
      }
      showXpBar();
      showXpGain(amount);
      let segmentStartXp = displayedXp;
      const targetXp = displayedXp + amount;
      let segmentLevel = getLevelForXp(segmentStartXp);
      while (segmentStartXp < targetXp) {
        const nextLevelXp = getTotalXpForLevel(segmentLevel + 1);
        const segmentEndXp = Math.min(targetXp, nextLevelXp);
        await animateXpSegment(segmentStartXp, segmentEndXp, segmentLevel);
        segmentStartXp = segmentEndXp;
        displayedXp = segmentStartXp;
        if (segmentStartXp >= nextLevelXp && segmentStartXp < targetXp) {
          segmentLevel += 1;
          displayedLevel = segmentLevel;
          updatePlayerInfoUI();
          showLevelPopup(segmentLevel);
          showXpLevelUp();
          setXpBarProgress(segmentStartXp, segmentLevel);
          await new Promise(resolve => setTimeout(resolve, 320));
        }
      }
      displayedXp = targetXp;
      setXpBarProgress(displayedXp, segmentLevel);
    }
    xpAnimationRunning = false;
    hideXpBarLater();
  };
  const initialXp = Number.isFinite(statsState.xp) ? statsState.xp : 0;
  const initialLevel = getLevelForXp(initialXp);
  let statsNeedsSave = false;
  if (initialXp !== statsState.xp) {
    statsState.xp = initialXp;
    statsNeedsSave = true;
  }
  if (initialLevel !== statsState.level) {
    statsState.level = initialLevel;
    statsNeedsSave = true;
  }
  if (statsNeedsSave) {
    saveStatsThrottled(profileNameKey, statsState, lastStatUpdateAt);
  }
  displayedLevel = initialLevel;
  displayedXp = initialXp;
  setXpBarProgress(displayedXp, displayedLevel);
  updatePlayerInfoUI();
  const normalizeTorchHealth = (value) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      return DEFAULT_TORCH_HEALTH;
    }
    return Math.max(0, Math.min(DEFAULT_TORCH_HEALTH, numeric));
  };
  const normalizeTorchEntry = (entry = {}) => {
    const countValue = Number.isFinite(entry.count) ? Math.max(0, Math.floor(entry.count)) : 0;
    const healths = Array.isArray(entry[TORCH_HEALTH_KEY])
      ? entry[TORCH_HEALTH_KEY].map(normalizeTorchHealth).filter(health => health > 0)
      : [];
    while (healths.length < countValue) {
      healths.push(DEFAULT_TORCH_HEALTH);
    }
    if (healths.length > countValue) {
      healths.length = countValue;
    }
    return {
      ...entry,
      count: healths.length,
      [TORCH_HEALTH_KEY]: healths
    };
  };
  const getTorchHealths = (entry) => (
    Array.isArray(entry?.[TORCH_HEALTH_KEY]) ? [...entry[TORCH_HEALTH_KEY]] : []
  );
  const inventoryCatalog = {
    iceGun: {
      name: 'Ice Gun',
      icon: '/assets/ui/items/icegun.png'
    },
    bow: {
      name: 'Bow',
      icon: '/assets/ui/items/bow.png'
    },
    bomb: {
      name: 'Bomb',
      icon: '/assets/ui/items/bomb.png'
    },
    autumnSword: {
      name: 'Autumn Sword',
      icon: '/assets/ui/items/sword.png'
    },
    lantern: {
      name: 'Lantern (Left Hand)',
      icon: '/assets/ui/items/lantern.png'
    },
    torch: {
      name: 'Torch (Left Hand)',
      icon: '/assets/ui/items/torch.png'
    },
    [LIFE_POTION_ITEM_ID]: {
      name: 'Life Potion',
      icon: '/assets/ui/items/life_potion.png'
    },
    [MANA_POTION_ITEM_ID]: {
      name: 'Mana Potion',
      icon: '/assets/ui/items/mana_potion.png'
    }
  };
  inventoryCatalog[APPLE_ITEM_ID] = {
    name: 'Apple',
    icon: ''
  };
  inventoryCatalog[WOOD_ITEM_ID] = {
    name: 'Wood',
    icon: ''
  };
  inventoryCatalog[MEAT_ITEM_ID] = {
    name: 'Meat',
    icon: ''
  };
  inventoryCatalog[ZOMBIE_BRAINS_ITEM_ID] = {
    name: 'Zombie Brains',
    icon: ''
  };
  inventoryCatalog[SALT_ITEM_ID] = {
    name: 'Salt',
    icon: ''
  };
  inventoryCatalog[SAUTEED_MUSHROOMS_ITEM_ID] = {
    name: 'Sauteed Mushrooms',
    icon: ''
  };
  MUSHROOM_ENTRIES.forEach((entry) => {
    inventoryCatalog[entry.id] = {
      name: entry.name,
      icon: '/assets/ui/items/{entry.icon_name}.png'.replace('{entry.icon_name}', entry.icon_name)
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
    const catalogEntry = ensureCatalogEntry(itemId, entry);
    const nextEntry = itemId === TORCH_ITEM_ID
      ? normalizeTorchEntry(catalogEntry)
      : catalogEntry;
    const healthsChanged = itemId === TORCH_ITEM_ID
      && JSON.stringify(nextEntry[TORCH_HEALTH_KEY]) !== JSON.stringify(entry?.[TORCH_HEALTH_KEY]);
    if (nextEntry.name !== entry?.name || nextEntry.icon !== entry?.icon || healthsChanged) {
      inventoryDirty = true;
    }
    inventoryState[itemId] = nextEntry;
  });
  Object.entries(homeStorageState).forEach(([itemId, entry]) => {
    const catalogEntry = ensureCatalogEntry(itemId, entry);
    const nextEntry = itemId === TORCH_ITEM_ID
      ? normalizeTorchEntry(catalogEntry)
      : catalogEntry;
    const healthsChanged = itemId === TORCH_ITEM_ID
      && JSON.stringify(nextEntry[TORCH_HEALTH_KEY]) !== JSON.stringify(entry?.[TORCH_HEALTH_KEY]);
    if (nextEntry.name !== entry?.name || nextEntry.icon !== entry?.icon || healthsChanged) {
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
  if (inventoryState.lantern?.name !== inventoryCatalog.lantern.name) {
    inventoryState.lantern = {
      ...(inventoryState.lantern || {}),
      name: inventoryCatalog.lantern.name
    };
    inventoryDirty = true;
  }
  if (inventoryState[TORCH_ITEM_ID]?.name !== inventoryCatalog.torch.name) {
    inventoryState[TORCH_ITEM_ID] = {
      ...(inventoryState[TORCH_ITEM_ID] || {}),
      name: inventoryCatalog.torch.name
    };
    inventoryDirty = true;
  }
  if (homeStorageState.lantern?.name !== inventoryCatalog.lantern.name) {
    homeStorageState.lantern = {
      ...(homeStorageState.lantern || {}),
      name: inventoryCatalog.lantern.name
    };
    homeStorageDirty = true;
  }
  if (homeStorageState[TORCH_ITEM_ID]?.name !== inventoryCatalog.torch.name) {
    homeStorageState[TORCH_ITEM_ID] = {
      ...(homeStorageState[TORCH_ITEM_ID] || {}),
      name: inventoryCatalog.torch.name
    };
    homeStorageDirty = true;
  }
  if (inventoryDirty || homeStorageDirty) {
    saveStatsThrottled(profileNameKey, statsState, lastStatUpdateAt, inventoryState, homeStorageState);
  }

  const equippableItems = new Set(['lantern', 'torch', 'iceGun', 'bow', 'bomb', 'autumnSword']);
  const inventoryHandSlots = {
    lantern: 'left',
    torch: 'left',
    iceGun: 'right',
    bow: 'right',
    bomb: 'right',
    autumnSword: 'right'
  };
  const getInventoryItemHand = (itemId) => inventoryHandSlots[itemId] || null;
  const isMushroomItem = (itemId) => mushroomItemIds.has(itemId);
  const isAppleItem = (itemId) => appleItemIds.has(itemId);
  const isWoodItem = (itemId) => woodItemIds.has(itemId);
  const isMeatItem = (itemId) => meatItemIds.has(itemId);
  const isSaltItem = (itemId) => saltItemIds.has(itemId);
  const isSauteedMushroomsItem = (itemId) => sauteedMushroomsItemIds.has(itemId);
  const isZombieBrainsItem = (itemId) => zombieBrainsItemIds.has(itemId);
  const isFoodItem = (itemId) => isMushroomItem(itemId)
    || isAppleItem(itemId)
    || isMeatItem(itemId)
    || isSaltItem(itemId)
    || isSauteedMushroomsItem(itemId);
  const isPotionItem = (itemId) => potionItemIds.has(itemId);
  const getInventoryItemActions = (itemId) => {
    if (isFoodItem(itemId)) {
      return ['drop', 'eat'];
    }
    if (isPotionItem(itemId)) {
      return ['drop', 'use'];
    }
    if (equippableItems.has(itemId)) {
      return ['drop', 'equip'];
    }
    if (isZombieBrainsItem(itemId)) {
      return ['drop', 'info'];
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

  let equippedTorchIndex = null;
  let torchHealthDirty = false;
  let lastTorchHealthSaveAt = 0;

  const updateTorchEntry = (state, entry) => {
    if (!entry || !entry.count || !Array.isArray(entry[TORCH_HEALTH_KEY]) || !entry[TORCH_HEALTH_KEY].length) {
      delete state[TORCH_ITEM_ID];
      return;
    }
    state[TORCH_ITEM_ID] = ensureCatalogEntry(TORCH_ITEM_ID, entry);
  };

  const applyTorchHealths = (state, entry, healths) => {
    const nextEntry = {
      ...(entry || {}),
      count: healths.length,
      [TORCH_HEALTH_KEY]: healths
    };
    updateTorchEntry(state, nextEntry);
  };

  const takeTorchHealth = (state, preferredIndex = null) => {
    const entry = state[TORCH_ITEM_ID];
    if (!entry) return null;
    const healths = getTorchHealths(entry);
    if (!healths.length) return null;
    let index = Number.isInteger(preferredIndex) ? preferredIndex : healths.length - 1;
    if (index < 0 || index >= healths.length) {
      index = healths.length - 1;
    }
    const [health] = healths.splice(index, 1);
    applyTorchHealths(state, entry, healths);
    return { health, index };
  };

  const addTorchHealths = (state, entry, healthsToAdd) => {
    const healths = getTorchHealths(entry);
    healths.push(...healthsToAdd);
    applyTorchHealths(state, entry, healths);
  };

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

  function getIceAmmoCount() {
    return Number.isFinite(inventoryState.iceGun?.[ICE_AMMO_KEY])
      ? inventoryState.iceGun[ICE_AMMO_KEY]
      : 0;
  }

  function getArrowAmmoCount() {
    return Number.isFinite(inventoryState.bow?.[ARROW_AMMO_KEY])
      ? inventoryState.bow[ARROW_AMMO_KEY]
      : 0;
  }

  function addIceAmmo(amount) {
    if (!Number.isFinite(amount)) return;
    const nextAmount = getIceAmmoCount() + amount;
    setIceAmmoCount(nextAmount);
  }

  function addArrowAmmo(amount) {
    if (!Number.isFinite(amount)) return;
    const nextAmount = getArrowAmmoCount() + amount;
    setArrowAmmoCount(nextAmount);
  }

  function addToInventory(itemId, amount = 1, options = {}) {
    if (!itemId || !Number.isFinite(amount) || amount <= 0) return;
    const current = inventoryState[itemId];
    if (itemId === TORCH_ITEM_ID) {
      const healthsToAdd = Array.isArray(options.torchHealths)
        ? options.torchHealths.map(normalizeTorchHealth)
        : [];
      const singleHealth = Number.isFinite(options.torchHealth)
        ? normalizeTorchHealth(options.torchHealth)
        : null;
      while (healthsToAdd.length < amount) {
        if (singleHealth != null && healthsToAdd.length === 0) {
          healthsToAdd.push(singleHealth);
        } else {
          healthsToAdd.push(DEFAULT_TORCH_HEALTH);
        }
      }
      addTorchHealths(inventoryState, current, healthsToAdd);
      persistInventoryAndStorage();
      return;
    }
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
    if (itemId === TORCH_ITEM_ID) {
      const healths = getTorchHealths(current);
      const nextHealths = healths.slice(0, Math.max(0, healths.length - amount));
      applyTorchHealths(inventoryState, current, nextHealths);
      if (equippedTorchIndex != null && equippedTorchIndex >= nextHealths.length) {
        equippedTorchIndex = nextHealths.length ? nextHealths.length - 1 : null;
      }
      persistInventoryAndStorage();
      return;
    }
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
    if (itemId === TORCH_ITEM_ID) {
      const current = inventoryState[itemId];
      if (!current || !current.count) return;
      const preferredIndex = isInventoryItemEquipped(itemId) ? equippedTorchIndex : null;
      const result = takeTorchHealth(inventoryState, preferredIndex);
      if (!result) return;
      if (isInventoryItemEquipped(itemId) && result.index === equippedTorchIndex) {
        equippedTorchIndex = null;
        unequipInventoryItem(itemId);
      }
      const existingStorage = homeStorageState[itemId];
      addTorchHealths(homeStorageState, existingStorage, [result.health]);
      persistInventoryAndStorage();
      return;
    }
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
    if (itemId === TORCH_ITEM_ID) {
      const current = homeStorageState[itemId];
      if (!current || !current.count) return;
      const result = takeTorchHealth(homeStorageState);
      if (!result) return;
      const inventoryEntry = inventoryState[itemId];
      addTorchHealths(inventoryState, inventoryEntry, [result.health]);
      persistInventoryAndStorage();
      return;
    }
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
    if (itemId === 'torch') {
      return torch?.holder === playerControls;
    }
    if (itemId === 'iceGun') {
      return iceGun?.holder === playerControls;
    }
    if (itemId === 'bow') {
      return bow?.holder === playerControls;
    }
    if (itemId === 'bomb') {
      return bomb?.holder === playerControls;
    }
    if (itemId === 'autumnSword') {
      return autumnSword?.holder === playerControls;
    }
    return false;
  }

  function getEquippedInventoryItemIdForHand(hand) {
    if (hand === 'left') {
      if (isInventoryItemEquipped('torch')) return 'torch';
      if (isInventoryItemEquipped('lantern')) return 'lantern';
      return null;
    }
    if (hand === 'right') {
      if (isInventoryItemEquipped('iceGun')) return 'iceGun';
      if (isInventoryItemEquipped('bow')) return 'bow';
      if (isInventoryItemEquipped('bomb')) return 'bomb';
      if (isInventoryItemEquipped('autumnSword')) return 'autumnSword';
    }
    return null;
  }

  function getEquippedInventoryItemIds() {
    const equipped = [];
    const left = getEquippedInventoryItemIdForHand('left');
    const right = getEquippedInventoryItemIdForHand('right');
    if (left) equipped.push(left);
    if (right) equipped.push(right);
    return equipped;
  }

  function getEquippedInventoryItemId() {
    return getEquippedInventoryItemIdForHand('right')
      || getEquippedInventoryItemIdForHand('left');
  }

  function unequipOtherInventoryItems(nextItemId) {
    const hand = getInventoryItemHand(nextItemId);
    if (!hand) return;
    const equippedId = getEquippedInventoryItemIdForHand(hand);
    if (equippedId && equippedId !== nextItemId) {
      unequipInventoryItem(equippedId);
    }
  }

  function equipInventoryItem(itemId) {
    if (!itemId || !inventoryState[itemId]) return;
    unequipOtherInventoryItems(itemId);
    if (itemId === 'lantern') {
      if (!lantern?.mesh || !playerControls) return;
      const shouldDuplicateDrop = lantern.mesh.visible && lantern.holder !== playerControls;
      if (shouldDuplicateDrop) {
        createDroppedWeaponPickup(lantern, {
          itemId: 'lantern',
          markerColor: 0xffd400,
          markerOffsetY: 1.2
        });
      }
      const heldMesh = ensureLocalHeldWeaponMesh(lantern, 'lantern', { forceNew: true });
      lantern.useHeldMeshWhenHeld = true;
      if (heldMesh) {
        heldMesh.visible = true;
      }
      lantern.mesh.visible = false;
      lantern.localHoldOrigin = 'inventory';
      lantern.holder = playerControls;
      audioManager?.playSFX('SFX/Torch/Light Torch 1.ogg', 0.6, { cooldownKey: 'light-lantern', cooldownMs: 100 });
      audioManager?.startLoopingSFX('torch-loop', 'SFX/Torch/Torch Loop.ogg', 0.32);
      updateSettingsUI();
      return;
    }
    if (itemId === TORCH_ITEM_ID) {
      if (!torch?.mesh || !playerControls) return;
      const entry = inventoryState[TORCH_ITEM_ID];
      const healths = getTorchHealths(entry);
      if (!healths.length) {
        updateTorchEntry(inventoryState, null);
        persistInventoryAndStorage();
        return;
      }
      if (!Number.isInteger(equippedTorchIndex) || equippedTorchIndex >= healths.length) {
        equippedTorchIndex = healths.findIndex(health => health > 0);
      }
      if (equippedTorchIndex < 0) {
        updateTorchEntry(inventoryState, null);
        persistInventoryAndStorage();
        return;
      }
      const shouldDuplicateDrop = torch.mesh.visible && torch.holder !== playerControls;
      if (shouldDuplicateDrop) {
        createDroppedWeaponPickup(torch, {
          itemId: TORCH_ITEM_ID,
          markerColor: 0xffa54c,
          markerOffsetY: 1.2,
          torchHealth: healths[equippedTorchIndex]
        });
      }
      torch.mesh.userData.torchHealth = healths[equippedTorchIndex];
      const heldMesh = ensureLocalHeldWeaponMesh(torch, 'torch', { forceNew: true });
      torch.useHeldMeshWhenHeld = true;
      if (heldMesh) {
        heldMesh.userData.torchHealth = healths[equippedTorchIndex];
        heldMesh.visible = true;
      }
      torch.mesh.visible = false;
      torch.localHoldOrigin = 'inventory';
      torch.holder = playerControls;
      setPlayerWeaponType(playerControls, torch.type);
      audioManager?.playSFX('SFX/Torch/Light Torch 1.ogg', 0.6, { cooldownKey: 'light-torch', cooldownMs: 100 });
      audioManager?.startLoopingSFX('torch-loop', 'SFX/Torch/Torch Loop.ogg', 0.32);
      updateSettingsUI();
      return;
    }
    if (itemId === 'iceGun') {
      if (!iceGun?.mesh || !playerControls) return;
      const heldMesh = ensureLocalHeldWeaponMesh(iceGun, 'iceGun', { forceNew: true });
      iceGun.useHeldMeshWhenHeld = true;
      if (heldMesh) {
        heldMesh.visible = true;
      }
      iceGun.mesh.visible = false;
      iceGun.localHoldOrigin = 'inventory';
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
      const heldMesh = ensureBowHeldMesh({ forceNew: true });
      if (!heldMesh) return;
      bow.useHeldMeshWhenHeld = true;
      heldMesh.visible = true;
      bow.mesh.visible = false;
      bow.localHoldOrigin = 'inventory';
      bow.holder = playerControls;
      audioManager?.playSFX('SFX/Attacks/Bow Attacks Hits and Blocks/Bow Take Out 1.ogg', 0.6, { cooldownKey: 'bow-equip', cooldownMs: 100 });
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
    if (itemId === 'bomb') {
      if (!bomb?.mesh || !playerControls) return;
      const heldMesh = ensureLocalHeldWeaponMesh(bomb, 'bomb', { forceNew: true });
      bomb.useHeldMeshWhenHeld = true;
      if (heldMesh) {
        heldMesh.visible = true;
      }
      bomb.mesh.visible = false;
      bomb.localHoldOrigin = 'inventory';
      bomb.holder = playerControls;
      setPlayerWeaponType(playerControls, bomb.type);
      updateSettingsUI();
      return;
    }
    if (itemId === 'autumnSword') {
      if (!autumnSword?.mesh || !playerControls) return;
      const heldMesh = ensureLocalHeldWeaponMesh(autumnSword, 'autumnSword', { forceNew: true });
      autumnSword.useHeldMeshWhenHeld = true;
      if (heldMesh) {
        heldMesh.visible = true;
      }
      autumnSword.mesh.visible = false;
      autumnSword.localHoldOrigin = 'inventory';
      autumnSword.holder = playerControls;
      setPlayerWeaponType(playerControls, autumnSword.type);
      audioManager?.playSFX('SFX/Attacks/Sword Attacks Hits and Blocks/Sword Unsheath 1.ogg', 0.62, { cooldownKey: 'sword-equip', cooldownMs: 100 });
      updateSettingsUI();
    }
  }

  function unequipInventoryItem(itemId) {
    if (itemId === 'lantern') {
      if (lantern?.holder !== playerControls) return;
      lantern.holder = null;
      lantern.localHoldOrigin = null;
      if (lantern.mesh) {
        lantern.mesh.visible = false;
      }
      if (lantern.heldMesh) {
        lantern.heldMesh.visible = false;
      }
      audioManager?.stopLoopingSFX('torch-loop');
      updateSettingsUI();
      return;
    }
    if (itemId === TORCH_ITEM_ID) {
      if (torch?.holder !== playerControls) return;
      torch.holder = null;
      torch.localHoldOrigin = null;
      if (torch.mesh) {
        torch.mesh.visible = false;
      }
      if (torch.heldMesh) {
        torch.heldMesh.visible = false;
      }
      clearPlayerWeaponType(playerControls, torch.type);
      audioManager?.stopLoopingSFX('torch-loop');
      updateSettingsUI();
      return;
    }
    if (itemId === 'iceGun') {
      if (iceGun?.holder !== playerControls) return;
      iceGun.holder = null;
      iceGun.localHoldOrigin = null;
      if (iceGun.mesh) {
        iceGun.mesh.visible = false;
      }
      if (iceGun.heldMesh) {
        iceGun.heldMesh.visible = false;
      }
      clearPlayerWeaponType(playerControls, iceGun.type);
      playerControls?.updateAmmoUI?.(false);
      updateSettingsUI();
      return;
    }
    if (itemId === 'bow') {
      if (bow?.holder !== playerControls) return;
      bow.holder = null;
      bow.localHoldOrigin = null;
      if (bow.useHeldMeshWhenHeld && bowHeldMesh) {
        bowHeldMesh.visible = false;
      } else if (bow.mesh) {
        bow.mesh.visible = false;
      }
      bow.useHeldMeshWhenHeld = false;
      audioManager?.playSFX('SFX/Attacks/Bow Attacks Hits and Blocks/Bow Put Away 1.ogg', 0.58, { cooldownKey: 'bow-unequip', cooldownMs: 100 });
      clearPlayerWeaponType(playerControls, bow.type);
      playerControls?.updateAmmoUI?.(false);
      playerControls?.setAiming?.(false);
      updateSettingsUI();
      return;
    }
    if (itemId === 'bomb') {
      if (bomb?.holder !== playerControls) return;
      bomb.holder = null;
      bomb.localHoldOrigin = null;
      if (bomb.mesh) {
        bomb.mesh.visible = false;
      }
      if (bomb.heldMesh) {
        bomb.heldMesh.visible = false;
      }
      clearPlayerWeaponType(playerControls, bomb.type);
      playerControls?.setAiming?.(false);
      updateSettingsUI();
      return;
    }
    if (itemId === 'autumnSword') {
      if (autumnSword?.holder !== playerControls) return;
      autumnSword.holder = null;
      autumnSword.localHoldOrigin = null;
      if (autumnSword.mesh) {
        autumnSword.mesh.visible = false;
      }
      if (autumnSword.heldMesh) {
        autumnSword.heldMesh.visible = false;
      }
      clearPlayerWeaponType(playerControls, autumnSword.type);
      audioManager?.playSFX('SFX/Attacks/Sword Attacks Hits and Blocks/Sword Sheath 1.ogg', 0.58, { cooldownKey: 'sword-unequip', cooldownMs: 100 });
      updateSettingsUI();
    }
  }

  function createNetworkDropId(prefix = 'drop') {
    const owner = multiplayer?.getId?.() || 'local';
    return `${prefix}-${owner}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function getInventoryDropPosition() {
    if (!playerControls?.playerModel) return null;
    const dropPosition = playerControls.playerModel.position.clone();
    const angle = Math.random() * Math.PI * 2;
    const radius = 1.2;
    dropPosition.x += Math.cos(angle) * radius;
    dropPosition.z += Math.sin(angle) * radius;
    if (!applySpawnY(dropPosition, 0.5, { allowOnBuildings: true })) {
      return null;
    }
    return dropPosition;
  }

  function disposeMushroomPickup(pickup) {
    if (!pickup) return;
    mushroomController?.removePickup?.(pickup);
    if (!pickup.mesh) return;
    const mesh = pickup.mesh;
    mesh.visible = false;
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

  function disposeWoodPickup(pickup) {
    if (!pickup?.mesh) return;
    const mesh = pickup.mesh;
    if (mesh.parent) {
      mesh.parent.remove(mesh);
    } else {
      scene.remove(mesh);
    }
    mesh.visible = false;
    mesh.geometry?.dispose?.();
    if (Array.isArray(mesh.material)) {
      mesh.material.forEach(material => material?.dispose?.());
    } else {
      mesh.material?.dispose?.();
    }
  }

  function handleDroppedWorldPickupCollected(pickup) {
    const dropId = pickup?.dropId;
    if (!dropId) return;
    droppedWorldPickups.delete(dropId);
    if (multiplayer && !multiplayer.isHost) {
      pendingWorldDropRemovals.add(dropId);
      multiplayer.send({ type: 'dropWorldPickup', dropId });
    }
  }

  function pickupMushroom(pickup) {
    if (!pickup?.active) return false;
    const pickupPosition = pickup.position || pickup.mesh?.position;
    if (!pickupPosition) return false;
    if (playerControls?.playerModel) {
      const playerPosition = playerControls.playerModel.position;
      const horizontalDistance = Math.hypot(
        playerPosition.x - pickupPosition.x,
        playerPosition.z - pickupPosition.z
      );
      if (horizontalDistance > PICKUP_RADIUS) return false;
    }
    addToInventory(pickup.id, 1);
    disposeMushroomPickup(pickup);
    const index = mushroomPickups.indexOf(pickup);
    if (index >= 0) {
      mushroomPickups.splice(index, 1);
    }
    mushroomPickupGrid.remove(pickup);
    handleDroppedWorldPickupCollected(pickup);
    window.questManager?.handleMushroomCollected?.(pickup);
    notifyAchievementProgress('mushroomsCollected', 1);
    return true;
  }

  function pickupApple(pickup) {
    if (!pickup?.mesh) return false;
    if (playerControls?.playerModel) {
      const playerPosition = playerControls.playerModel.position;
      const applePosition = pickup.mesh.getWorldPosition
        ? pickup.mesh.getWorldPosition(tempTreePosition)
        : pickup.mesh.position;
      const horizontalDistance = Math.hypot(
        playerPosition.x - applePosition.x,
        playerPosition.z - applePosition.z
      );
      if (horizontalDistance > APPLE_PICKUP_RADIUS) return false;
    }
    addToInventory(pickup.id, 1);
    disposeApplePickup(pickup);
    const index = applePickups.indexOf(pickup);
    if (index >= 0) {
      applePickups.splice(index, 1);
    }
    handleDroppedWorldPickupCollected(pickup);
    return true;
  }

  function pickupWood(pickup) {
    if (!pickup?.mesh) return false;
    if (playerControls?.playerModel) {
      const playerPosition = playerControls.playerModel.position;
      const woodPosition = pickup.mesh.position;
      const horizontalDistance = Math.hypot(
        playerPosition.x - woodPosition.x,
        playerPosition.z - woodPosition.z
      );
      if (horizontalDistance > WOOD_PICKUP_RADIUS) return false;
    }
    addToInventory(pickup.id, 1);
    disposeWoodPickup(pickup);
    const index = woodPickups.indexOf(pickup);
    if (index >= 0) {
      woodPickups.splice(index, 1);
    }
    handleDroppedWorldPickupCollected(pickup);
    return true;
  }


  function pickupMeat(pickup) {
    if (!pickup?.mesh) return false;
    if (playerControls?.playerModel) {
      const playerPosition = playerControls.playerModel.position;
      const meatPosition = pickup.mesh.position;
      const horizontalDistance = Math.hypot(
        playerPosition.x - meatPosition.x,
        playerPosition.z - meatPosition.z
      );
      if (horizontalDistance > MEAT_PICKUP_RADIUS) return false;
    }
    addToInventory(pickup.id, 1);
    disposeWoodPickup(pickup);
    const index = meatPickups.indexOf(pickup);
    if (index >= 0) {
      meatPickups.splice(index, 1);
    }
    handleDroppedWorldPickupCollected(pickup);
    return true;
  }

  function disposeSaltPickup(pickup) {
    if (!pickup?.mesh) return;
    const mesh = pickup.mesh;
    if (mesh.parent) {
      mesh.parent.remove(mesh);
    } else {
      scene.remove(mesh);
    }
    mesh.visible = false;
    mesh.traverse?.((child) => {
      if (!child?.isMesh) return;
      child.geometry?.dispose?.();
      if (Array.isArray(child.material)) {
        child.material.forEach(material => material?.dispose?.());
      } else {
        child.material?.dispose?.();
      }
    });
  }

  function pickupSalt(pickup) {
    if (!pickup?.mesh || !pickup?.id) return false;
    if (playerControls?.playerModel) {
      const playerPosition = playerControls.playerModel.position;
      const pickupPosition = pickup.mesh.position;
      const horizontalDistance = Math.hypot(
        playerPosition.x - pickupPosition.x,
        playerPosition.z - pickupPosition.z
      );
      if (horizontalDistance > SALT_PICKUP_RADIUS) return false;
    }
    const amount = Math.max(1, Math.floor(Number.isFinite(pickup.amount) ? pickup.amount : 1));
    addToInventory(pickup.id, amount);
    disposeSaltPickup(pickup);
    const index = saltPickups.indexOf(pickup);
    if (index >= 0) {
      saltPickups.splice(index, 1);
    }
    handleDroppedWorldPickupCollected(pickup);
    return true;
  }

  function pickupZombieBrains(pickup) {
    if (!pickup?.mesh) return false;
    if (playerControls?.playerModel) {
      const playerPosition = playerControls.playerModel.position;
      const brainPosition = pickup.mesh.position;
      const horizontalDistance = Math.hypot(
        playerPosition.x - brainPosition.x,
        playerPosition.z - brainPosition.z
      );
      if (horizontalDistance > MEAT_PICKUP_RADIUS) return false;
    }
    addToInventory(pickup.id, 1);
    disposeWoodPickup(pickup);
    const index = zombieBrainsPickups.indexOf(pickup);
    if (index >= 0) {
      zombieBrainsPickups.splice(index, 1);
    }
    handleDroppedWorldPickupCollected(pickup);
    return true;
  }

  function spawnMushroomPickup(itemId, position) {
    if (!mushroomController?.spawnPickup || !position) return null;
    const pickup = mushroomController.spawnPickup(itemId, position);
    if (pickup?.mesh?.position) {
      mushroomPickupGrid.add(pickup, pickup.mesh.position);
    }
    return pickup;
  }

  function spawnApplePickup(position) {
    if (!appleController?.spawnPickup || !position) return null;
    return appleController.spawnPickup(position);
  }

  function spawnWoodPickup(position) {
    const spawnPos = asVec3(position);
    if (!spawnPos) return null;
    applySpawnY(spawnPos, WOOD_DROP_LIFT, { allowOnBuildings: true });
    const geometry = new THREE.BoxGeometry(3.0, 0.36, 0.6);
    const material = new THREE.MeshStandardMaterial({
      color: 0x8b5a2b,
      roughness: 0.7,
      metalness: 0.05
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.position.copy(spawnPos);
    mesh.rotation.y = Math.random() * Math.PI * 2;
    scene.add(mesh);
    const pickup = { id: WOOD_ITEM_ID, mesh };
    woodPickups.push(pickup);
    return pickup;
  }


  function spawnMeatPickup(position) {
    const spawnPos = asVec3(position);
    if (!spawnPos) return null;
    applySpawnY(spawnPos, WOOD_DROP_LIFT, { allowOnBuildings: true });
    const geometry = new THREE.BoxGeometry(1.1, 0.45, 0.7);
    const material = new THREE.MeshStandardMaterial({
      color: 0x6b3f23,
      roughness: 0.85,
      metalness: 0.02
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.position.copy(spawnPos);
    mesh.rotation.y = Math.random() * Math.PI * 2;
    scene.add(mesh);
    const pickup = { id: MEAT_ITEM_ID, mesh };
    meatPickups.push(pickup);
    return pickup;
  }

  function spawnSaltPickup(position, { itemId = SALT_ITEM_ID, amount = 1, groupedMushrooms = 0, useTerrainHeight = true } = {}) {
    const spawnPos = asVec3(position);
    if (!spawnPos) return null;
    if (useTerrainHeight) {
      applySpawnY(spawnPos, WOOD_DROP_LIFT, { allowOnBuildings: true });
    }
    const group = new THREE.Group();
    const pieces = groupedMushrooms > 0 ? groupedMushrooms : 3;
    for (let i = 0; i < pieces; i += 1) {
      const isMushroomCluster = itemId === SAUTEED_MUSHROOMS_ITEM_ID;
      const mesh = isMushroomCluster
        ? mushroomController?.createProjectileMesh?.(MUSHROOM_ENTRIES[Math.floor(Math.random() * MUSHROOM_ENTRIES.length)]?.id)
        : new THREE.Mesh(
          new THREE.OctahedronGeometry(0.16 + Math.random() * 0.05, 0),
          new THREE.MeshStandardMaterial({
            color: 0xd9d9d9,
            emissive: 0x4a4a4a,
            emissiveIntensity: 0.25,
            roughness: 0.35,
            metalness: 0.45
          })
        );
      if (!mesh) continue;
      mesh.position.set((Math.random() - 0.5) * 0.42, 0.1 + Math.random() * 0.14, (Math.random() - 0.5) * 0.42);
      mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
      applyOptionalShadowState(mesh, optionalShadowsEnabled);
      mesh.receiveShadow = true;
      group.add(mesh);
    }
    group.position.copy(spawnPos);
    group.userData.baseY = spawnPos.y;
    group.userData.phase = Math.random() * Math.PI * 2;
    group.userData.type = itemId;
    scene.add(group);
    const pickup = { id: itemId, mesh: group, amount: Math.max(1, Math.floor(amount)) };
    saltPickups.push(pickup);
    return pickup;
  }

  function createZombieBrainsGroup() {
    const brainGroup = new THREE.Group();
    const lobeMaterial = new THREE.MeshStandardMaterial({
      color: 0xff8ccf,
      emissive: 0x5a1f49,
      emissiveIntensity: 0.28,
      roughness: 0.78,
      metalness: 0.02,
      flatShading: true
    });
    const stemMaterial = new THREE.MeshStandardMaterial({
      color: 0xe46bb6,
      emissive: 0x4b1537,
      emissiveIntensity: 0.24,
      roughness: 0.82,
      metalness: 0.01,
      flatShading: true
    });

    const leftLobe = new THREE.Mesh(new THREE.IcosahedronGeometry(0.26, 0), lobeMaterial);
    const rightLobe = new THREE.Mesh(new THREE.IcosahedronGeometry(0.26, 0), lobeMaterial.clone());
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.22, 6), stemMaterial);

    leftLobe.position.set(-0.18, 0, 0);
    rightLobe.position.set(0.18, 0, 0);
    stem.position.set(0, -0.18, 0);

    brainGroup.add(leftLobe, rightLobe, stem);
    brainGroup.traverse((child) => {
      if (!child.isMesh) return;
      child.castShadow = true;
      child.receiveShadow = true;
    });
    return brainGroup;
  }

  function spawnZombieBrainsPickup(position) {
    const spawnPos = asVec3(position);
    if (!spawnPos) return null;
    applySpawnY(spawnPos, WOOD_DROP_LIFT, { allowOnBuildings: true });

    const brainGroup = createZombieBrainsGroup();
    brainGroup.position.copy(spawnPos);
    brainGroup.rotation.y = Math.random() * Math.PI * 2;
    scene.add(brainGroup);

    const pickup = { id: ZOMBIE_BRAINS_ITEM_ID, mesh: brainGroup };
    zombieBrainsPickups.push(pickup);
    return pickup;
  }

  function spawnMonsterDrops(monster) {
    if (!monster?.model?.position) return;
    const configuredDrops = monster.monsterProperties?.drops;
    if (!Array.isArray(configuredDrops) || configuredDrops.length === 0) return;
    const dropOrigin = monster.model.position.clone();
    const dropCount = configuredDrops.length;
    const dropPositions = createRingPositions(dropOrigin, dropCount, 0.65);
    configuredDrops.forEach((itemId, index) => {
      const dropPosition = dropPositions[index] || dropOrigin;
      if (isZombieBrainsItem(itemId)) {
        spawnZombieBrainsPickup(dropPosition);
        return;
      }
      if (isMushroomItem(itemId)) {
        spawnMushroomPickup(itemId, dropPosition);
        return;
      }
      if (isSaltItem(itemId) || itemId === SAUTEED_MUSHROOMS_ITEM_ID) {
        spawnSaltPickup(dropPosition, { itemId });
      }
    });
  }

  const tempTreePosition = new THREE.Vector3();
  const tempTreeDirection = new THREE.Vector3();
  const tempTreeCenter = new THREE.Vector3();
  const tempTreeCenterNext = new THREE.Vector3();

  function dropTreeApples(tree) {
    if (!tree) return;
    const apples = tree.userData?.applePickups ?? [];
    if (!apples.length) return;
    const appleParent = appleController?.group || scene;
    apples.forEach((pickup) => {
      if (!pickup?.mesh) return;
      const mesh = pickup.mesh;
      mesh.getWorldPosition(tempTreePosition);
      appleParent.add(mesh);
      mesh.position.copy(tempTreePosition);
      if (applySpawnY(mesh.position, APPLE_DROP_LIFT, { allowOnBuildings: true })) {
        mesh.userData.baseY = mesh.position.y;
      }
      mesh.rotation.y = Math.random() * Math.PI * 2;
    });
  }

  function handleSwordTreeHit({ attacker, range }) {
    if (!attacker?.model?.position) return;
    const effectiveRange = (Number.isFinite(range) ? range : 0) + TREE_HIT_RANGE_BOOST;
    const tree = natureController?.getClosestTree?.(attacker.model.position, effectiveRange);
    if (!tree || tree.userData?.isCutDown) return;
    const centerLocal = tree.userData?.boundsCenterLocal;
    if (centerLocal) {
      tempTreeCenter.copy(centerLocal).applyMatrix4(tree.matrixWorld);
    }
    tree.userData.swordHits = (tree.userData.swordHits ?? 0) + 1;
    tempTreeDirection.subVectors(tree.position, attacker.model.position);
    tempTreeDirection.y = 0;
    if (tempTreeDirection.lengthSq() === 0) {
      tempTreeDirection.set(0, 0, 1);
    }
    tempTreeDirection.normalize();
    const tiltX = (tree.userData.tiltX ?? tree.rotation.x) + tempTreeDirection.z * TREE_SWING_TILT_STEP;
    const tiltZ = (tree.userData.tiltZ ?? tree.rotation.z) + -tempTreeDirection.x * TREE_SWING_TILT_STEP;
    tree.userData.tiltX = tiltX;
    tree.userData.tiltZ = tiltZ;
    tree.rotation.x = tiltX;
    tree.rotation.z = tiltZ;
    if (centerLocal) {
      tree.updateWorldMatrix(true, true);
      tempTreeCenterNext.copy(centerLocal).applyMatrix4(tree.matrixWorld);
      tempTreePosition.subVectors(tempTreeCenter, tempTreeCenterNext);
      tree.position.add(tempTreePosition);
      tree.updateWorldMatrix(true, true);
    }
    if (tree.userData.swordHits >= TREE_HITS_TO_CUT) {
      tree.userData.isCutDown = true;
      dropTreeApples(tree);
      tree.getWorldPosition(tempTreePosition);
      if (centerLocal) {
        tempTreePosition.copy(centerLocal).applyMatrix4(tree.matrixWorld);
      }
      for (let i = 0; i < 3; i += 1) {
        const angle = (i / 3) * Math.PI * 2 + Math.random() * 0.4;
        const radius = 0.6 + Math.random() * 0.2;
        const dropPosition = tempTreePosition.clone();
        dropPosition.x += Math.cos(angle) * radius;
        dropPosition.z += Math.sin(angle) * radius;
        spawnWoodPickup(dropPosition);
      }
      natureController?.removeTree?.(tree);
    }
  }

  function handleTorchTreeHit({ attacker, range }) {
    if (!attacker?.model?.position) return;
    const effectiveRange = (Number.isFinite(range) ? range : 0) + TREE_HIT_RANGE_BOOST;
    const tree = natureController?.getClosestTree?.(attacker.model.position, effectiveRange);
    if (!tree || tree.userData?.isCutDown || !tree.userData?.isFlammable) return;
    if (tree.userData?.isBurning) return;
    tree.userData.isBurning = true;
    const centerLocal = tree.userData?.boundsCenterLocal;
    if (centerLocal) {
      tempTreePosition.copy(centerLocal).applyMatrix4(tree.matrixWorld);
    } else {
      tree.getWorldPosition(tempTreePosition);
    }
    const treeFireRadius = Math.max(2.6, tree.userData?.boundsRadius ?? 0);
    const treeFire = createFire({
      particleCount: 36,
      spread: treeFireRadius * 1.1,
      sizeRange: [0.4, 1.1],
      lightSettings: {
        color: 0xffc077,
        intensity: 4.5,
        distance: 70,
        decay: 1.1
      },
      lightOffset: new THREE.Vector3(0, treeFireRadius * 0.9, 0),
      pulse: {
        base: 0.8,
        variance: 0.2,
        opacityRange: [0.4, 1],
        emissiveRange: [0.4, 1.2],
        lightIntensityRange: [0.8, 1.35]
      }
    });
    if (treeFire?.group) {
      treeFire.group.position.copy(tempTreePosition);
      treeFire.group.position.y += -6.0;//treeFireRadius * 0.7 - 11.0;
      treeFire.group.userData.skipTerrainCorrection = true;
      scene.add(treeFire.group);
      tree.userData.fireEffect = treeFire;
      treeFires.push({ tree, fire: treeFire });
    }
    tree.userData.burnTimeout = setTimeout(() => {
      if (!tree.userData?.isBurning) return;
      const fireEffect = tree.userData?.fireEffect;
      if (fireEffect?.group) {
        scene.remove(fireEffect.group);
        fireEffect.dispose?.();
      }
      if (fireEffect) {
        const fireIndex = treeFires.findIndex(entry => entry.fire === fireEffect);
        if (fireIndex >= 0) {
          treeFires.splice(fireIndex, 1);
        }
      }
      natureController?.removeTree?.(tree);
    }, BOMB_MIST_LIFETIME_MS);
  }

  function removeDroppedWeaponPickupById(dropId) {
    if (!dropId) return;
    const index = droppedWeaponPickups.findIndex(pickup => pickup?.dropId === dropId);
    if (index === -1) return;
    const [pickup] = droppedWeaponPickups.splice(index, 1);
    disposeDroppedWeaponPickup(pickup);
    networkDroppedWeaponPickups.delete(dropId);
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

  function createDroppedWeaponPickup(
    item,
    {
      itemId,
      quantity = 1,
      markerColor,
      markerOffsetY,
      position,
      quaternion,
      allowHidden = false,
      torchHealth,
      dropId,
      shouldBroadcastRemoval = true,
      onPickup
    } = {}
  ) {
    if (!item?.mesh || (!allowHidden && !item.mesh.visible)) return;
    const pickupMesh = item.mesh.clone(true);
    if (position) {
      pickupMesh.position.copy(position);
    } else {
      pickupMesh.position.copy(item.mesh.position);
    }
    if (quaternion) {
      pickupMesh.quaternion.copy(quaternion);
    } else {
      pickupMesh.quaternion.copy(item.mesh.quaternion);
    }
    pickupMesh.visible = true;
    pickupMesh.userData.hideInMapView = item.mesh.userData?.hideInMapView;
    if (itemId === TORCH_ITEM_ID && Number.isFinite(torchHealth)) {
      pickupMesh.userData.torchHealth = normalizeTorchHealth(torchHealth);
    }
    scene.add(pickupMesh);
    const marker = createWeaponMarker(markerColor);
    const pickup = {
      mesh: pickupMesh,
      marker,
      itemId,
      quantity: Number.isFinite(quantity) ? Math.max(1, Math.floor(quantity)) : 1,
      type: item?.type || itemId,
      holder: null,
      torchHealth: Number.isFinite(torchHealth) ? normalizeTorchHealth(torchHealth) : null,
      markerOffsetY,
      dropId: dropId || null,
      shouldBroadcastRemoval: !!shouldBroadcastRemoval,
      tryPickup: (playerControls) => {
        if (!pickupMesh?.visible || !playerControls?.playerModel) return;
        const distance = playerControls.playerModel.position.distanceTo(pickupMesh.position);
        if (distance > 3) return;
        if (itemId === TORCH_ITEM_ID) {
          addToInventory(itemId, pickup.quantity, {
            torchHealth: pickup.torchHealth ?? pickupMesh.userData.torchHealth ?? DEFAULT_TORCH_HEALTH
          });
        } else {
          addToInventory(itemId, pickup.quantity);
        }
        equipInventoryItem(itemId);
        const index = droppedWeaponPickups.indexOf(pickup);
        if (index !== -1) {
          droppedWeaponPickups.splice(index, 1);
        }
        if (pickup.dropId && pickup.shouldBroadcastRemoval && multiplayer && !multiplayer.isHost) {
          multiplayer.send({ type: 'dropWeaponPickup', dropId: pickup.dropId, itemId: pickup.itemId, quantity: pickup.quantity, torchHealth: pickup.torchHealth });
        }
        if (pickup.dropId) {
          networkDroppedWeaponPickups.delete(pickup.dropId);
        }
        disposeDroppedWeaponPickup(pickup);
        if (typeof onPickup === 'function') {
          onPickup(pickup);
        }
      }
    };
    droppedWeaponPickups.push(pickup);
    return pickup;
  }

  const craftState = {
    materials: [],
    selection: null,
    swirl: null,
    craftTimeout: null
  };
  const craftRecipes = await getCraftRecipes();
  const craftRecipeMap = new Map(craftRecipes.map((recipe) => [recipe.id, recipe]));

  const getCraftMaterialKey = (itemId) => {
    if (itemId === WOOD_ITEM_ID) return 'wood';
    if (itemId === APPLE_ITEM_ID) return 'apples';
    if (itemId?.startsWith?.('mushroom_')) return 'mushrooms';
    if (itemId === ZOMBIE_BRAINS_ITEM_ID) return 'zombie_brains';
    if (itemId === SALT_ITEM_ID) return 'salt';
    return null;
  };

  const getSelectionMaterialCounts = (selection) => {
    const totals = { wood: 0, apples: 0, mushrooms: 0, zombie_brains: 0, salt: 0 };
    if (!selection) return totals;
    Object.entries(selection).forEach(([itemId, count]) => {
      const key = getCraftMaterialKey(itemId);
      if (!key) return;
      totals[key] += count;
    });
    return totals;
  };

  const computeCraftCount = (recipe, selection) => {
    if (!recipe) return 0;
    const totals = getSelectionMaterialCounts(selection);
    const limits = Object.entries(recipe.materials).map(([key, amount]) => (
      amount > 0 ? Math.floor((totals[key] || 0) / amount) : 0
    ));
    if (!limits.length) return 0;
    return Math.max(0, Math.min(...limits));
  };

  const returnUnusedCraftMaterials = (selection, recipe, craftCount) => {
    if (!selection) return;
    const required = {};
    if (recipe?.materials) {
      Object.entries(recipe.materials).forEach(([key, amount]) => {
        required[key] = (required[key] || 0) + amount * craftCount;
      });
    }
    Object.entries(selection).forEach(([itemId, count]) => {
      if (!count) return;
      const key = getCraftMaterialKey(itemId);
      let used = 0;
      if (key && required[key] > 0) {
        used = Math.min(count, required[key]);
        required[key] -= used;
      }
      const leftover = count - used;
      if (leftover > 0) {
        addToInventory(itemId, leftover);
      }
    });
  };

  const clearCraftSwirl = () => {
    if (!craftState.swirl) return;
    scene.remove(craftState.swirl.line);
    craftState.swirl.geometry?.dispose?.();
    craftState.swirl.material?.dispose?.();
    craftState.swirl = null;
  };

  const clearCraftMaterials = () => {
    craftState.materials.forEach((entry) => {
      if (!entry?.mesh) return;
      scene.remove(entry.mesh);
      entry.mesh.traverse?.((child) => {
        if (!child?.isMesh) return;
        child.geometry?.dispose?.();
        if (Array.isArray(child.material)) {
          child.material.forEach(material => material?.dispose?.());
        } else {
          child.material?.dispose?.();
        }
      });
      entry.mesh.geometry?.dispose?.();
      if (Array.isArray(entry.mesh.material)) {
        entry.mesh.material.forEach(material => material?.dispose?.());
      } else {
        entry.mesh.material?.dispose?.();
      }
    });
    craftState.materials = [];
  };

  const restoreCraftInventory = () => {
    if (!craftState.selection) return;
    Object.entries(craftState.selection).forEach(([itemId, count]) => {
      if (count > 0) {
        addToInventory(itemId, count);
      }
    });
    craftState.selection = null;
  };

  const createCraftMaterialMesh = (itemId) => {
    if (itemId === APPLE_ITEM_ID) {
      const geometry = new THREE.SphereGeometry(0.18, 16, 16);
      const material = new THREE.MeshStandardMaterial({ color: 0xd73a3a });
      return new THREE.Mesh(geometry, material);
    }
    if (itemId.startsWith('mushroom_')) {
      const randomEntry = MUSHROOM_ENTRIES[Math.floor(Math.random() * MUSHROOM_ENTRIES.length)]?.id;
      const mushroomMesh = randomEntry ? mushroomController?.createProjectileMesh?.(randomEntry) : null;
      if (mushroomMesh) {
        mushroomMesh.rotation.set(0, Math.random() * Math.PI * 2, 0);
        return mushroomMesh;
      }
      const geometry = new THREE.CylinderGeometry(0.12, 0.16, 0.28, 10);
      const material = new THREE.MeshStandardMaterial({ color: 0xc98b4a });
      return new THREE.Mesh(geometry, material);
    }
    if (itemId === WOOD_ITEM_ID) {
      const geometry = new THREE.BoxGeometry(0.35, 0.14, 0.2);
      const material = new THREE.MeshStandardMaterial({ color: 0x8b5a2b });
      return new THREE.Mesh(geometry, material);
    }
    if (itemId === ZOMBIE_BRAINS_ITEM_ID) {
      return createZombieBrainsGroup();
    }
    if (itemId === SALT_ITEM_ID) {
      const group = new THREE.Group();
      for (let i = 0; i < 3; i += 1) {
        const crystal = new THREE.Mesh(
          new THREE.OctahedronGeometry(0.11 + Math.random() * 0.03, 0),
          new THREE.MeshStandardMaterial({
            color: 0xd9d9d9,
            emissive: 0x3a3a3a,
            emissiveIntensity: 0.25,
            roughness: 0.45,
            metalness: 0.35
          })
        );
        crystal.position.set((Math.random() - 0.5) * 0.22, 0.1 + Math.random() * 0.12, (Math.random() - 0.5) * 0.22);
        applyOptionalShadowState(crystal, optionalShadowsEnabled);
        crystal.receiveShadow = true;
        group.add(crystal);
      }
      return group;
    }
    return null;
  };

  const createManaPotionDisplayMesh = () => {
    const group = new THREE.Group();
    const bottle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.11, 0.14, 0.3, 14),
      new THREE.MeshStandardMaterial({
        color: 0x5f8bff,
        transparent: true,
        opacity: 0.85,
        roughness: 0.2,
        metalness: 0.1
      })
    );
    applyOptionalShadowState(bottle, optionalShadowsEnabled);
    bottle.receiveShadow = true;
    const cork = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.06, 0.08, 12),
      new THREE.MeshStandardMaterial({ color: 0x7a5b39, roughness: 0.9 })
    );
    cork.position.y = 0.19;
    applyOptionalShadowState(cork, optionalShadowsEnabled);
    cork.receiveShadow = true;
    group.add(bottle, cork);
    group.scale.setScalar(1.15);
    group.rotation.x = Math.PI * 0.04;
    return group;
  };

  const createCraftSwirl = (position) => {
    if (!position) return null;
    const points = [];
    const loops = 3;
    const radius = 0.6;
    const height = 0.6;
    const segments = 80;
    for (let i = 0; i <= segments; i += 1) {
      const t = i / segments;
      const angle = t * Math.PI * 2 * loops;
      const y = t * height;
      points.push(new THREE.Vector3(
        Math.cos(angle) * radius,
        y,
        Math.sin(angle) * radius
      ));
    }
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({ color: 0x7fd0ff, transparent: true, opacity: 0.8 });
    const line = new THREE.Line(geometry, material);
    line.position.copy(position);
    line.userData.skipTerrainCorrection = true;
    scene.add(line);
    return { line, geometry, material };
  };

  const spawnCraftArrowPickup = (position) => {
    const spawnPos = asVec3(position);
    if (!spawnPos) return null;
    const arrowMesh = cloneArrowMesh(arrowTemplate, ARROW_PROJECTILE_SCALE);
    const pickupMesh = arrowMesh || new THREE.Mesh(
      new THREE.CylinderGeometry(0.04, 0.05, 0.6, 8),
      new THREE.MeshStandardMaterial({
        color: 0x7b5530,
        emissive: 0x2b1a0a,
        emissiveIntensity: 0.35
      })
    );
    pickupMesh.rotation.set(0, Math.PI / 2, Math.PI / 2);
    registerPickupEmissiveMaterials(pickupMesh);
    pickupMesh.position.copy(spawnPos);
    applyOptionalShadowState(pickupMesh, optionalShadowsEnabled);
    pickupMesh.userData.skipTerrainCorrection = true;
    pickupMesh.userData.baseY = spawnPos.y;
    pickupMesh.userData.phase = Math.random() * Math.PI * 2;
    pickupMesh.userData.amount = 1;
    pickupMesh.userData.type = 'arrow';
    pickupMesh.userData.sparkle = true;
    pickupMesh.userData.noFloat = true;
    const light = new THREE.PointLight(0xfff2a8, 0.6, 2);
    light.position.set(0, 0.4, 0);
    pickupMesh.add(light);
    pickupMesh.userData.sparkleLight = light;
    scene.add(pickupMesh);
    ammoPickups.push(pickupMesh);
    return pickupMesh;
  };

  const spawnCraftedPickup = (itemId, position, amount = 1) => {
    if (!itemId || !position) return;
    const dropPos = position.clone().add(new THREE.Vector3(0, 0.4, 0));
    if (itemId === 'arrow') {
      const pickup = spawnCraftArrowPickup(dropPos);
      if (pickup) {
        pickup.userData.amount = Math.max(1, Math.floor(amount));
      }
      return;
    }
    if (itemId === MANA_POTION_ITEM_ID) {
      const potionMesh = cloneManaPotionMesh(manaPotionTemplate, MANA_POTION_SCALE);
      if (!potionMesh) return;
      potionMesh.position.copy(dropPos);
      potionMesh.userData.skipTerrainCorrection = true;
      createDroppedWeaponPickup(
        { mesh: potionMesh, type: MANA_POTION_ITEM_ID },
        {
          itemId: MANA_POTION_ITEM_ID,
          quantity: amount,
          markerColor: 0x7f7dff,
          markerOffsetY: 1.0,
          position: dropPos,
          allowHidden: true
        }
      );
      return;
    }
    if (itemId === SAUTEED_MUSHROOMS_ITEM_ID) {
      const pickup = spawnSaltPickup(dropPos, { itemId: SAUTEED_MUSHROOMS_ITEM_ID, amount, groupedMushrooms: 3, useTerrainHeight: false });
      if (pickup?.mesh) {
        pickup.mesh.position.copy(dropPos);
        pickup.mesh.userData.baseY = dropPos.y;
      }
      return;
    }
    const pickupConfig = {
      bow: { item: bow, itemId: 'bow', markerColor: 0xffc26b },
      lantern: { item: lantern, itemId: 'lantern', markerColor: 0xffd400 },
      torch: {
        item: torch,
        itemId: TORCH_ITEM_ID,
        markerColor: 0xffa54c,
        torchHealth: DEFAULT_TORCH_HEALTH
      }
    }[itemId];
    if (pickupConfig?.item?.mesh) {
      const dropId = createNetworkDropId('weapon');
      createDroppedWeaponPickup(pickupConfig.item, {
        itemId: pickupConfig.itemId,
        quantity: amount,
        markerColor: pickupConfig.markerColor,
        markerOffsetY: 1.2,
        position: dropPos,
        allowHidden: true,
        torchHealth: pickupConfig.torchHealth,
        dropId
      });
      if (multiplayer && !multiplayer.isHost) {
        multiplayer.send({
          type: 'inventoryWeaponDrop',
          drops: [{
            id: dropId,
            itemId: pickupConfig.itemId,
            position: [dropPos.x, dropPos.y, dropPos.z],
            rotation: [pickupConfig.item.mesh.quaternion.x, pickupConfig.item.mesh.quaternion.y, pickupConfig.item.mesh.quaternion.z, pickupConfig.item.mesh.quaternion.w],
            quantity: Math.max(1, Math.floor(amount)),
            torchHealth: pickupConfig.torchHealth
          }]
        });
      }
    }
  };

  const placeCraftMaterials = (selection) => {
    if (!selection || !craftTable?.mesh) return;
    clearCraftMaterials();
    clearCraftSwirl();
    if (craftState.craftTimeout) {
      clearTimeout(craftState.craftTimeout);
      craftState.craftTimeout = null;
    }
    craftState.selection = { ...selection };
    const entries = Object.entries(selection).filter(([, count]) => count > 0);
    const basePos = craftTable.getCraftSurfacePosition?.() || craftTable.mesh.position.clone();
    entries.forEach(([itemId], index) => {
      const mesh = createCraftMaterialMesh(itemId);
      if (!mesh) return;
      const angle = (index / Math.max(entries.length, 1)) * Math.PI * 2;
      const offset = new THREE.Vector3(Math.cos(angle) * 0.35, 0, Math.sin(angle) * 0.35);
      mesh.position.copy(basePos).add(offset);
      applyOptionalShadowState(mesh, optionalShadowsEnabled);
      mesh.receiveShadow = true;
      mesh.userData.skipTerrainCorrection = true;
      scene.add(mesh);
      craftState.materials.push({ itemId, mesh });
    });
  };

  const cancelCrafting = ({ restoreInventory = false } = {}) => {
    if (craftState.craftTimeout) {
      clearTimeout(craftState.craftTimeout);
      craftState.craftTimeout = null;
    }
    clearCraftSwirl();
    clearCraftMaterials();
    if (restoreInventory) {
      restoreCraftInventory();
    } else {
      craftState.selection = null;
    }
  };

  const craftItem = (itemId) => {
    if (!craftState.selection || !craftTable?.mesh) return;
    if (craftState.craftTimeout) {
      clearTimeout(craftState.craftTimeout);
    }
    const recipe = craftRecipeMap.get(itemId);
    const craftCount = computeCraftCount(recipe, craftState.selection);
    if (craftCount <= 0) {
      returnUnusedCraftMaterials(craftState.selection, recipe, 0);
      craftState.selection = null;
      clearCraftMaterials();
      clearCraftSwirl();
      return;
    }
    const basePos = craftTable.getCraftSurfacePosition?.() || craftTable.mesh.position.clone();
    craftState.swirl = createCraftSwirl(basePos);
    craftState.craftTimeout = setTimeout(() => {
      clearCraftMaterials();
      clearCraftSwirl();
      if (craftCount > 0) {
        const bundleCount = Math.min(craftCount, 5);
        const bundleBaseAmount = Math.floor(craftCount / bundleCount);
        const bundleRemainder = craftCount % bundleCount;
        const radius = 0.4;
        for (let i = 0; i < bundleCount; i += 1) {
          const bundleAmount = bundleBaseAmount + (i < bundleRemainder ? 1 : 0);
          const angle = (i / Math.max(bundleCount, 1)) * Math.PI * 2;
          const offset = new THREE.Vector3(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
          spawnCraftedPickup(itemId, basePos.clone().add(offset), bundleAmount);
        }
        window.questManager?.handleCraftedItem?.();
      }
      returnUnusedCraftMaterials(craftState.selection, recipe, craftCount);
      craftState.selection = null;
      craftState.craftTimeout = null;
    }, 4000);
  };

  function dropInventoryItem(itemId) {
    if (!itemId || !inventoryState[itemId]) return;
    if (isFoodItem(itemId) || isWoodItem(itemId) || isZombieBrainsItem(itemId)) {
      const dropPosition = getInventoryDropPosition();
      if (!dropPosition) return;
      const dropId = createNetworkDropId('world');
      if (multiplayer && !multiplayer.isHost) {
        multiplayer.send({
          type: 'inventoryWorldDrop',
          drops: [{
            id: dropId,
            itemId,
            position: [dropPosition.x, dropPosition.y, dropPosition.z],
            amount: 1
          }]
        });
      } else {
        addDroppedWorldPickup({ id: dropId, itemId, position: dropPosition, amount: 1 });
      }
      removeFromInventory(itemId, 1);
      return;
    }
    const dropPosition = getInventoryDropPosition();
    if (!dropPosition) return;
    const itemMap = {
      iceGun,
      bow,
      bomb,
      autumnSword,
      lantern,
      torch
    };
    const item = itemMap[itemId];
    if (!item?.mesh) {
      removeFromInventory(itemId, 1);
      updateSettingsUI();
      return;
    }
    const shouldDuplicatePickup = item.mesh.visible
      && item.holder !== playerControls;
    if (item.holder === playerControls) {
      const markerColor = itemId === 'bow'
        ? 0xffc26b
        : itemId === TORCH_ITEM_ID
          ? 0xffa54c
          : itemId === 'bomb'
            ? 0xff4d4d
            : 0xffd400;
      const torchPickupHealth = itemId === TORCH_ITEM_ID
        ? takeTorchHealth(inventoryState)?.health
        : null;
      const dropId = createNetworkDropId('weapon');
      const q = playerControls?.playerModel?.quaternion || item.mesh?.quaternion;
      item.mesh?.position?.copy?.(dropPosition);
      if (q && item.mesh?.quaternion) {
        item.mesh.quaternion.copy(q);
      }
      item.drop({ removeFromInventory: true });
      if (item.mesh) {
        item.mesh.visible = false;
      }
      createDroppedWeaponPickup(item, {
        itemId,
        markerColor,
        markerOffsetY: 1.2,
        position: dropPosition,
        quaternion: q,
        torchHealth: torchPickupHealth ?? undefined,
        dropId,
        allowHidden: true
      });
      if (multiplayer && !multiplayer.isHost) {
        const pos = dropPosition;
        multiplayer.send({
          type: 'inventoryWeaponDrop',
          drops: [{
            id: dropId,
            itemId,
            position: [pos.x, pos.y, pos.z],
            rotation: [q.x, q.y, q.z, q.w],
            quantity: 1,
            torchHealth: torchPickupHealth ?? undefined
          }]
        });
      }
      if (itemId === TORCH_ITEM_ID) {
        persistInventoryAndStorage();
      }
      updateSettingsUI();
      return;
    }
    if (shouldDuplicatePickup) {
      const markerColor = itemId === 'bow'
        ? 0xffc26b
        : itemId === TORCH_ITEM_ID
          ? 0xffa54c
          : itemId === 'bomb'
            ? 0xff4d4d
            : 0xffd400;
      const torchPickupHealth = itemId === TORCH_ITEM_ID
        ? takeTorchHealth(inventoryState)?.health
        : null;
      const dropId = createNetworkDropId('weapon');
      createDroppedWeaponPickup(item, {
        itemId,
        markerColor,
        markerOffsetY: 1.2,
        position: dropPosition,
        quaternion: playerControls?.playerModel?.quaternion,
        torchHealth: torchPickupHealth ?? undefined,
        dropId
      });
      if (multiplayer && !multiplayer.isHost) {
        const pos = dropPosition;
        const q = playerControls?.playerModel?.quaternion || item.mesh.quaternion;
        multiplayer.send({
          type: 'inventoryWeaponDrop',
          drops: [{
            id: dropId,
            itemId,
            position: [pos.x, pos.y, pos.z],
            rotation: [q.x, q.y, q.z, q.w],
            quantity: 1,
            torchHealth: torchPickupHealth ?? undefined
          }]
        });
      }
      if (itemId === TORCH_ITEM_ID) {
        persistInventoryAndStorage();
      }
      updateSettingsUI();
      return;
    }
    item.holder = null;
    item.mesh.visible = true;
    item.mesh.position.copy(dropPosition);
    if (playerControls?.playerModel?.quaternion) {
      item.mesh.quaternion.copy(playerControls.playerModel.quaternion);
    }
    if (itemId === TORCH_ITEM_ID) {
      const result = takeTorchHealth(inventoryState);
      if (result?.health != null) {
        item.mesh.userData.torchHealth = result.health;
      }
      persistInventoryAndStorage();
    } else {
      removeFromInventory(itemId, 1);
    }
    updateSettingsUI();
  }

  function eatInventoryItem(itemId) {
    if (!itemId || !inventoryState[itemId]) return;
    if (!isFoodItem(itemId)) return;
    if (isMushroomItem(itemId)) {
      setStat('health', statsState.health + MUSHROOM_HEALTH_SEGMENTS, { skipSave: true });
      setStat('hunger', statsState.hunger + MUSHROOM_HUNGER_GAIN, { skipSave: true });
    } else if (isAppleItem(itemId)) {
      setStat('health', statsState.health + APPLE_HEALTH_SEGMENTS, { skipSave: true });
      setStat('hunger', statsState.hunger + APPLE_HUNGER_GAIN, { skipSave: true });
    } else if (isMeatItem(itemId)) {
      setStat('health', statsState.health + MEAT_HEALTH_SEGMENTS, { skipSave: true });
      setStat('hunger', statsState.hunger + MEAT_HUNGER_GAIN, { skipSave: true });
    } else if (isSaltItem(itemId)) {
      setStat('health', statsState.health + SALT_HEALTH_SEGMENTS, { skipSave: true });
      setStat('hunger', statsState.hunger + SALT_HUNGER_GAIN, { skipSave: true });
    } else if (isSauteedMushroomsItem(itemId)) {
      setStat('health', statsState.health + SAUTEED_MUSHROOMS_HEALTH_SEGMENTS, { skipSave: true });
      setStat('hunger', statsState.hunger + SAUTEED_MUSHROOMS_HUNGER_GAIN, { skipSave: true });
    }
    lastStatUpdateAt = Date.now();
    removeFromInventory(itemId, 1);
  }

  function useInventoryItem(itemId) {
    if (!itemId || !inventoryState[itemId]) return;
    if (!isPotionItem(itemId)) return;
    if (itemId === LIFE_POTION_ITEM_ID) {
      setStat('health', statsState.maxHealthSegments, { skipSave: true });
    }
    if (itemId === MANA_POTION_ITEM_ID) {
      setStat('magic', statsState.maxMagicSegments, { skipSave: true });
    }
    removeFromInventory(itemId, 1);
  }

  let mapViewEnabled = false;
  let playerDead = false;
  const updateControlAvailability = () => {
    if (!playerControls) return;
    playerControls.enabled = !mapViewEnabled && !playerDead && !levelUpSelectionActive;
  };
  const updateEnergyEffects = () => {
    if (!playerControls) return;
    const energyDepleted = statsState.hunger <= 0;
    playerControls.setEnergyDepleted?.(energyDepleted);
  };

  const healthBar = document.getElementById('health-bar');
  const healthLabel = document.getElementById('health-label');
  const hungerBar = document.getElementById('hunger-bar');
  const magicBar = document.getElementById('magic-bar');
  const hungerWarning = document.getElementById('hunger-warning');
  let hungerWarningTimer = null;

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
    if ((inventoryState.bomb?.count || 0) > 0) weaponDrops.push('bomb');
    if ((inventoryState.autumnSword?.count || 0) > 0) weaponDrops.push('autumnSword');
    if ((inventoryState.lantern?.count || 0) > 0) weaponDrops.push('lantern');
    if ((inventoryState[TORCH_ITEM_ID]?.count || 0) > 0) weaponDrops.push(TORCH_ITEM_ID);
    const weaponPositions = createRingPositions(deathPosition, weaponDrops.length, 2.2);
    weaponDrops.forEach((weaponId, index) => {
      const position = weaponPositions[index] || deathPosition;
      if (weaponId === 'iceGun') {
        spawnIceGunPickup(position);
      } else if (weaponId === 'bow') {
        spawnBowPickup(position);
      } else if (weaponId === 'bomb') {
        spawnBombPickup(position);
      } else if (weaponId === 'autumnSword') {
        spawnAutumnSwordPickup(position);
      } else if (weaponId === 'lantern') {
        spawnLanternPickup(position);
      } else if (weaponId === TORCH_ITEM_ID) {
        const torchEntry = inventoryState[TORCH_ITEM_ID];
        const torchHealth = getTorchHealths(torchEntry)[0] ?? DEFAULT_TORCH_HEALTH;
        spawnTorchPickup(position, torchHealth);
      }
    });

    playerControls?.setAmmo?.(0);
    clearInventoryState();
  };

  function updateHealthUI() {
    if (!healthBar) return;
    const maxSegments = Math.max(BASE_HEALTH_SEGMENTS, Math.round(statsState.maxHealthSegments || BASE_HEALTH_SEGMENTS));
    const currentSegments = clampHealthSegments(statsState.health, statsState.level, maxSegments);
    const healthRatio = maxSegments > 0 ? currentSegments / maxSegments : 0;
    if (healthBar.childElementCount !== maxSegments) {
      healthBar.innerHTML = '';
      for (let i = 0; i < maxSegments; i += 1) {
        const segment = document.createElement('span');
        segment.className = 'health-segment';
        healthBar.appendChild(segment);
      }
    }
    Array.from(healthBar.children).forEach((segment, index) => {
      segment.classList.toggle('filled', index < currentSegments);
    });
    if (healthRatio > 0.75) {
      healthBar.dataset.healthLevel = 'high';
    } else if (healthRatio > 0.5) {
      healthBar.dataset.healthLevel = 'mid';
    } else if (healthRatio > 0.25) {
      healthBar.dataset.healthLevel = 'low';
    } else {
      healthBar.dataset.healthLevel = 'critical';
    }
    if (healthLabel) {
      healthLabel.textContent = 'Health';
    }
  }

  function updateSegmentedBar(barElement, maxSegments, currentSegments, filledClass = 'filled') {
    if (!barElement) return;
    if (barElement.childElementCount !== maxSegments) {
      barElement.innerHTML = '';
      for (let i = 0; i < maxSegments; i += 1) {
        const segment = document.createElement('span');
        segment.className = 'stat-segment';
        barElement.appendChild(segment);
      }
    }
    Array.from(barElement.children).forEach((segment, index) => {
      segment.classList.toggle(filledClass, index < currentSegments);
    });
  }

  function updateHungerUI() {
    updateSegmentedBar(hungerBar, statsState.maxHungerSegments, clampHungerSegments(statsState.hunger, statsState.maxHungerSegments));
  }

  function updateMagicUI() {
    updateSegmentedBar(magicBar, statsState.maxMagicSegments, clampMagicSegments(statsState.magic, statsState.maxMagicSegments));
  }

  const showHungerWarning = () => {
    if (!hungerWarning) return;
    hungerWarning.classList.add('visible');
    if (hungerWarningTimer) {
      clearTimeout(hungerWarningTimer);
    }
    hungerWarningTimer = setTimeout(() => {
      hungerWarning.classList.remove('visible');
    }, 3500);
  };

  const clampStat = (key, value) => {
    if (['health', 'hunger', 'energy', 'magic'].includes(key)) {
      const num = Number(value);
      if (!Number.isFinite(num)) {
        return 0;
      }
      if (key === 'health') {
        return clampHealthSegments(num, statsState.level, statsState.maxHealthSegments);
      }
      if (key === 'magic') {
        return clampMagicSegments(num, statsState.maxMagicSegments);
      }
      return clampHungerSegments(num, statsState.maxHungerSegments);
    }
    if (key === 'level') {
      const num = Number(value);
      if (!Number.isFinite(num)) {
        return 1;
      }
      return Math.max(1, Math.round(num));
    }
    if (key === 'maxHealthSegments') {
      const num = Number(value);
      if (!Number.isFinite(num)) return BASE_HEALTH_SEGMENTS;
      return Math.max(BASE_HEALTH_SEGMENTS, Math.round(num));
    }
    if (key === 'maxHungerSegments') {
      const num = Number(value);
      if (!Number.isFinite(num)) return BASE_HUNGER_SEGMENTS;
      return Math.max(BASE_HUNGER_SEGMENTS, Math.min(HUNGER_MAX_SEGMENTS, Math.round(num)));
    }
    if (key === 'maxMagicSegments') {
      const num = Number(value);
      if (!Number.isFinite(num)) return BASE_MAGIC_SEGMENTS;
      return Math.max(BASE_MAGIC_SEGMENTS, Math.min(MAGIC_MAX_SEGMENTS, Math.round(num)));
    }
    if (key === 'xp') {
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
    if (key === 'energy') {
      setStat('hunger', value, { skipSave });
      return;
    }
    statsState[key] = clampStat(key, value);
    if (key === 'health') {
      updateHealthUI();
    }
    if (key === 'hunger') {
      updateHungerUI();
      statsState.energy = statsState.hunger;
      updateEnergyEffects();
    }
    if (key === 'magic') {
      updateMagicUI();
    }
    if (key === 'level') {
      currentPlayerLevel = statsState.level;
      updatePlayerInfoUI();
      statsState.health = clampHealthSegments(statsState.health, statsState.level, statsState.maxHealthSegments);
      updateHealthUI();
    }
    if (key === 'maxHealthSegments') {
      statsState.health = clampHealthSegments(statsState.health, statsState.level, statsState.maxHealthSegments);
      updateHealthUI();
    }
    if (key === 'maxHungerSegments') {
      statsState.hunger = clampHungerSegments(statsState.hunger, statsState.maxHungerSegments);
      statsState.energy = statsState.hunger;
      updateHungerUI();
      updateEnergyEffects();
    }
    if (key === 'maxMagicSegments') {
      statsState.magic = clampMagicSegments(statsState.magic, statsState.maxMagicSegments);
      updateMagicUI();
    }
    if (!skipSave) {
      if (key === 'hunger') {
        lastStatUpdateAt = Date.now();
      }
      saveStatsThrottled(profileNameKey, statsState, lastStatUpdateAt);
    }
  }

  const sleepState = {
    active: false,
    startedAt: null,
    startHealth: null,
    startHunger: null,
    bed: null
  };

  const getSleepRecoveryValue = (key, startValue, elapsedSeconds) => {
    const base = Number.isFinite(startValue) ? startValue : 0;
    if (key === 'health') {
      return clampStat(key, base + elapsedSeconds * SLEEP_RECOVERY_SEGMENTS_PER_SECOND);
    }
    return clampStat(key, base + elapsedSeconds * SLEEP_RECOVERY_PER_SECOND);
  };

  const startSleepSession = ({ bed } = {}) => {
    if (sleepState.active) return;
    const startedAt = Date.now();
    sleepState.active = true;
    sleepState.startedAt = startedAt;
    sleepState.startHealth = statsState.health;
    sleepState.startHunger = statsState.hunger;
    sleepState.bed = bed || null;
    if (profileNameKey) {
      playerProfile.sleepStartedAt = startedAt;
      void saveSleepTimestamp(profileNameKey, startedAt);
    }
  };

  const endSleepSession = async () => {
    if (!sleepState.active) return;
    sleepState.active = false;
    const now = Date.now();
    const storedStart = profileNameKey ? await getSleepTimestamp(profileNameKey) : null;
    const startAt = Number.isFinite(storedStart) ? storedStart : sleepState.startedAt;
    const elapsedSeconds = startAt ? Math.max(0, (now - startAt) / 1000) : 0;
    const expectedHealth = getSleepRecoveryValue('health', sleepState.startHealth ?? statsState.health, elapsedSeconds);
    const expectedHunger = getSleepRecoveryValue('hunger', sleepState.startHunger ?? statsState.hunger, elapsedSeconds);
    const nextHealth = Math.max(statsState.health, expectedHealth);
    const nextHunger = Math.max(statsState.hunger, expectedHunger);
    setStat('health', nextHealth, { skipSave: true });
    setStat('hunger', nextHunger, { skipSave: true });
    lastStatUpdateAt = Date.now();
    saveStatsThrottled(profileNameKey, statsState, lastStatUpdateAt);
  };

  window.setStat = setStat;
  window.getPlayerStrength = () => (Number.isFinite(statsState.strength) ? statsState.strength : 0);

  const getPowerUpsForLevel = (level) => {
    const safeLevel = Math.max(1, Math.round(level || 1));
    if (safeLevel >= 15) return 4;
    if (safeLevel >= 10) return 3;
    if (safeLevel >= 5) return 2;
    return 1;
  };

  const updateLevelUpPanelUI = () => {
    if (!levelUpPanel) return;
    if (levelUpTitle) {
      levelUpTitle.textContent = `You've reached Level ${pendingLevelUpLevel}`;
    }
    if (levelUpSubtitle) {
      levelUpSubtitle.textContent = 'Choose your power ups / stat increases.';
    }
    if (levelUpRemaining) {
      levelUpRemaining.textContent = `You have ${pendingLevelUpChoices} power ups to choose.`;
    }
  };

  const closeLevelUpPanel = () => {
    pendingLevelUpChoices = 0;
    levelUpSelectionActive = false;
    if (levelUpPanel) {
      levelUpPanel.classList.add('hidden');
    }
    updateControlAvailability();
  };

  const openLevelUpPanel = () => {
    if (!levelUpPanel) return;
    levelUpSelectionActive = pendingLevelUpChoices > 0;
    updateLevelUpPanelUI();
    levelUpPanel.classList.remove('hidden');
    updateControlAvailability();
  };

  const applyLevelUpChoice = (choiceKey) => {
    if (pendingLevelUpChoices <= 0) {
      closeLevelUpPanel();
      return;
    }
    if (choiceKey === 'strength') {
      setStat('strength', (Number.isFinite(statsState.strength) ? statsState.strength : 0) + 1, { skipSave: true });
    }
    if (choiceKey === 'health') {
      setStat('maxHealthSegments', statsState.maxHealthSegments + 1, { skipSave: true });
      setStat('health', statsState.health + 1, { skipSave: true });
    }
    if (choiceKey === 'hunger') {
      setStat('maxHungerSegments', statsState.maxHungerSegments + 1, { skipSave: true });
      setStat('hunger', statsState.hunger + 1, { skipSave: true });
    }
    if (choiceKey === 'magic') {
      setStat('maxMagicSegments', statsState.maxMagicSegments + 1, { skipSave: true });
      setStat('magic', statsState.magic + 1, { skipSave: true });
    }
    pendingLevelUpChoices = Math.max(0, pendingLevelUpChoices - 1);
    if (pendingLevelUpChoices <= 0) {
      void saveStatsImmediate(profileNameKey, statsState, lastStatUpdateAt);
      closeLevelUpPanel();
      return;
    }
    updateLevelUpPanelUI();
    void saveStatsImmediate(profileNameKey, statsState, lastStatUpdateAt);
  };

  levelUpStrengthButton?.addEventListener('click', () => applyLevelUpChoice('strength'));
  levelUpMagicButton?.addEventListener('click', () => applyLevelUpChoice('magic'));
  levelUpHungerButton?.addEventListener('click', () => applyLevelUpChoice('hunger'));
  levelUpHealthButton?.addEventListener('click', () => applyLevelUpChoice('health'));

  const queueLevelUpChoices = (fromLevel, toLevel) => {
    if (!Number.isFinite(fromLevel) || !Number.isFinite(toLevel) || toLevel <= fromLevel) {
      return;
    }
    for (let level = fromLevel + 1; level <= toLevel; level += 1) {
      pendingLevelUpChoices += getPowerUpsForLevel(level);
      pendingLevelUpLevel = level;
    }
    if (pendingLevelUpChoices > 0) {
      openLevelUpPanel();
    }
  };

  const getMonsterXpForLevel = (level) => {
    const safeLevel = Math.max(1, Math.round(level || 1));
    return 50 + (safeLevel - 1) * 25;
  };
  const addPlayerXp = (amount) => {
    const normalized = clampStat('xp', amount);
    if (!Number.isFinite(normalized) || normalized <= 0) {
      return;
    }
    const previousTotalXp = Number.isFinite(statsState.xp) ? statsState.xp : 0;
    const nextTotalXp = clampStat('xp', previousTotalXp + normalized);
    if (nextTotalXp === previousTotalXp) {
      return;
    }
    const previousLevel = getLevelForXp(previousTotalXp);
    const nextLevel = getLevelForXp(nextTotalXp);
    statsState.xp = nextTotalXp;
    if (nextLevel !== statsState.level) {
      const currentLevel = Number.isFinite(statsState.level) ? statsState.level : previousLevel;
      if (nextLevel > currentLevel) {
        queueLevelUpChoices(currentLevel, nextLevel);
      }
      setStat('level', nextLevel, { skipSave: true });
    }
    saveStatsThrottled(profileNameKey, statsState, lastStatUpdateAt);
    queueXpAnimation(normalized);
  };
  window.addPlayerXp = addPlayerXp;
  window.getMonsterXpForLevel = getMonsterXpForLevel;

  window.onMonsterKill = (monster, { withFriend = false } = {}) => {
    const monsterLevel = Number.isFinite(monster?.level) ? monster.level : 1;
    const baseXp = getMonsterXpForLevel(monsterLevel);
    const bonusXp = withFriend ? 50 : 0;
    addPlayerXp(baseXp + bonusXp);
    notifyAchievementProgress('monstersKilled', 1);
    if (isZombieMonsterType(monster)) {
      notifyAchievementProgress('zombiesKilled', 1);
    }
    window.questManager?.handleMonsterKilled?.(monster);
    const typeLabel = String(monster?.type || monster?.modelPath || '').toLowerCase();
    if (typeLabel.includes('golem')) {
      notifyAchievementProgress('golemsKilled', 1);
    }
  };
  window.onPlayerKill = () => {
    const currentLevel = Number.isFinite(statsState.level) ? statsState.level : 1;
    addPlayerXp(currentLevel * 100);
  };
  window.onPlayerDeath = () => {};

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
  Object.defineProperty(window, 'magic', {
    configurable: true,
    get: () => statsState.magic,
    set: value => setStat('magic', value)
  });

  updateHealthUI();
  updateHungerUI();
  updateMagicUI();
  updateEnergyEffects();

  const getHungerWarningThresholdSegments = () => {
    const maxSegments = clampHungerSegments(statsState.maxHungerSegments, statsState.maxHungerSegments);
    return Math.max(1, Math.ceil(maxSegments * 0.25));
  };

  const HUNGER_WARNING_INTERVAL_MS = 3 * 60 * 1000;
  setInterval(() => {
    const threshold = getHungerWarningThresholdSegments();
    if (statsState.hunger <= threshold) {
      showHungerWarning();
    }
  }, HUNGER_WARNING_INTERVAL_MS);

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

  function getBombDamage(shooterId) {
    if (shooterId && shooterId === multiplayer?.getId?.()) {
      if (typeof window.getPlayerStrength === 'function') {
        const strength = window.getPlayerStrength();
        if (Number.isFinite(strength)) {
          const bonus = convertPointsToSegments(strength, { minimum: 0 });
          return Math.max(0, BOMB_BASE_DAMAGE + bonus);
        }
      }
    }
    return BOMB_BASE_DAMAGE;
  }

  function applyBombImpactDamage(hitPosition, shooterId) {
    if (!hitPosition) return;
    const localId = multiplayer?.getId?.();
    const isHost = !multiplayer || multiplayer.isHost;
    const damage = getBombDamage(shooterId);

    if (playerModel?.position) {
      const distance = hitPosition.distanceTo(playerModel.position);
      if (distance <= BOMB_DAMAGE_RADIUS) {
        const localControls = runtimeContext.systems.playerControls ?? window.playerControls;
        if (localControls?.isInvincible && Date.now() >= (localControls.invincibleUntil || 0)) {
          localControls.isInvincible = false;
          localControls.invincibleUntil = 0;
        }
        const isInvincible = localControls?.isInvincible && Date.now() < (localControls.invincibleUntil || 0);
        if (!isInvincible) {
          const attackTypes = getAttackTypes('bombExplosion', ['explosive']);
          window.localHealth = Math.max(0, window.localHealth - damage);
          window.lastHitAttackTypes = attackTypes;
          if (localControls) {
            const direction = new THREE.Vector3()
              .subVectors(playerModel.position, hitPosition)
              .normalize();
            localControls.applyKnockback({
              direction,
              strength: BOMB_KNOCKBACK_STRENGTH
            });
          }
        }
      }
    }

    for (const [id, { model }] of Object.entries(otherPlayers)) {
      if (!model?.position) continue;
      const distance = hitPosition.distanceTo(model.position);
      if (distance > BOMB_DAMAGE_RADIUS) continue;
      const player = otherPlayers[id];
      if (!player) continue;
      const attackTypes = getAttackTypes('bombExplosion', ['explosive']);
      const previousHealth = Number.isFinite(player.health) ? player.health : BASE_HEALTH_SEGMENTS;
      const nextHealth = Math.max(0, previousHealth - damage);
      player.health = nextHealth;
      player.lastHitAttackTypes = attackTypes;
      if (nextHealth <= 0 && previousHealth > 0) {
        player.isDead = true;
        if (shooterId && shooterId === localId) {
          window.onPlayerKill?.(id);
        }
      } else if (nextHealth > 0 && player.isDead) {
        player.isDead = false;
      }
    }

    const creatures = getDamageableCreatures();
    if (Array.isArray(creatures) && creatures.length) {
      if (isHost) {
        for (const monster of creatures) {
          if (!monster?.model?.position) continue;
          const distance = hitPosition.distanceTo(monster.model.position);
          if (distance > BOMB_DAMAGE_RADIUS) continue;
          const attackTypes = getAttackTypes('bombExplosion', ['explosive']);
          const killed = monster.applyDamage(damage, { attackTypes });
          if (!killed) {
            const direction = new THREE.Vector3()
              .subVectors(monster.model.position, hitPosition)
              .normalize();
            monster.applyKnockback({ direction, strength: BOMB_KNOCKBACK_STRENGTH });
          }
          handleMonsterDamage?.(monster, { damage, killed, sourceId: shooterId ?? localId, attackTypes });
          if (killed && shooterId && shooterId === localId) {
            const withFriend = window.questManager?.isFriendActive?.() ?? false;
            window.onMonsterKill?.(monster, { withFriend });
          }
        }
      } else {
        for (const monster of creatures) {
          if (!monster?.model?.position) continue;
          const distance = hitPosition.distanceTo(monster.model.position);
          if (distance > BOMB_DAMAGE_RADIUS) continue;
          sendMonsterAttackIntent?.({
            monsterId: monster.id,
            damage,
            sourcePlayerId: shooterId ?? localId,
            attackTypes: getAttackTypes('bombExplosion', ['explosive']),
            at: Date.now()
          });
        }
      }
    }

    if (natureController?.removeRocksInRadius) {
      const removedRockPositions = natureController.removeRocksInRadius(hitPosition, BOMB_DAMAGE_RADIUS);
      if (removedRockPositions.length > 0) {
        notifyAchievementProgress('rocksBlownUp', removedRockPositions.length);
        window.questManager?.handleRockBlownUp?.(removedRockPositions.length);
      }
      removedRockPositions.forEach((rockPosition) => {
        for (let i = 0; i < 3; i += 1) {
          const angle = (i / 3) * Math.PI * 2;
          const offset = new THREE.Vector3(Math.cos(angle) * 0.28, 0, Math.sin(angle) * 0.28);
          spawnSaltPickup(rockPosition.clone().add(offset));
        }
      });
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
      const localId = multiplayer?.getId?.();
      if (!shooterId || (localId && shooterId === localId)) {
        notifyAchievementProgress('bowShots', 1);
      }
    }
  }

  const createMeshPool = ({ create }) => {
    const available = [];
    return {
      acquire() {
        const mesh = available.pop();
        if (mesh) {
          mesh.visible = true;
          return mesh;
        }
        return create();
      },
      release(mesh) {
        if (!mesh) return;
        mesh.visible = false;
        available.push(mesh);
      }
    };
  };

  const bombProjectileMeshPool = createMeshPool({
    create: () => {
      const clone = bomb.mesh.clone(true);
      clone.traverse(child => {
        if (!child.isMesh) return;
        child.castShadow = true;
        child.receiveShadow = true;
      });
      clone.visible = true;
      return clone;
    }
  });

  function spawnBombProjectileWithPerfFlags(scene, list, position, direction, shooterId) {
    if (!bomb?.mesh) return;

    // const lobDirection = direction.clone().multiplyScalar(-1).normalize();
    tempLobDirection.copy(direction).normalize();
    tempLobDirection.y += BOMB_THROW_UPWARD_BIAS;
    tempLobDirection.normalize();

    spawnProjectile(scene, list, position, tempLobDirection, shooterId, {
      createMesh: () => bombProjectileMeshPool.acquire(),
      releaseMesh: (mesh) => bombProjectileMeshPool.release(mesh),
      speed: BOMB_THROW_SPEED,
      lifetime: BOMB_THROW_LIFETIME,
      colliderDesc: RAPIER.ColliderDesc.ball(0.18).setRestitution(0.3).setFriction(0.8),
      groundContactOffset: 0.18,
      onGroundHit: (hitPosition) => {
        spawnBombMist(scene, bombMists, hitPosition);
        applyBombImpactDamage(hitPosition, shooterId);
      }
    });

    const latest = list[list.length - 1];
    if (latest) {
      latest.userData.skipTerrainCorrection = true;
    }
  }

  function spawnInventoryThrowProjectileWithPerfFlags(
    scene,
    list,
    position,
    direction,
    shooterId,
    {
      itemId,
      sourceItem,
      damage,
      thrownTorchHealth,
      createPickupOnGround = true
    } = {}
  ) {
    if (!itemId) return false;
    const itemMap = { iceGun, bow, autumnSword, lantern, torch };
    const resolvedItem = sourceItem || itemMap[itemId];
    if (!resolvedItem?.mesh) return false;

    const markerColorMap = {
      bow: 0xffc26b,
      torch: 0xffa54c,
      lantern: 0xffd400,
      autumnSword: 0xffd400,
      iceGun: 0xffd400
    };

    tempLobDirection.copy(direction).normalize();
    tempLobDirection.y += INVENTORY_THROW_UPWARD_BIAS;
    tempLobDirection.normalize();

    spawnProjectile(scene, list, position, tempLobDirection, shooterId, {
      createMesh: () => {
        const clone = resolvedItem.mesh.clone(true);
        clone.visible = true;
        return clone;
      },
      speed: INVENTORY_THROW_SPEED,
      lifetime: INVENTORY_THROW_LIFETIME,
      gravity: 9.8,
      colliderDesc: RAPIER.ColliderDesc.ball(0.2).setRestitution(0.25).setFriction(0.8),
      groundContactOffset: 0.2,
      damage: Number.isFinite(damage) ? damage : (itemId === 'autumnSword' ? 2 : 1),
      attackLabel: 'thrownItemProjectile',
      attackTypes: ['projectile', 'throw'],
      onGroundHit: createPickupOnGround ? (hitPosition) => {
        createDroppedWeaponPickup(resolvedItem, {
          itemId,
          quantity: 1,
          markerColor: markerColorMap[itemId] ?? 0xffd400,
          markerOffsetY: 1.2,
          position: hitPosition,
          allowHidden: true,
          torchHealth: itemId === TORCH_ITEM_ID ? thrownTorchHealth : undefined
        });
      } : null
    });

    return true;
  }

  const ICE_MIST_RANGE = 5;
  const ICE_MIST_SPEED = 3.2;
  const ICE_MIST_LIFETIME_MS = (ICE_MIST_RANGE / ICE_MIST_SPEED) * 1000;
  const ICE_MIST_PARTICLE_COUNT = 7;
  const ICE_MIST_FREEZE_MS = 5000;
  const ICE_MIST_RADIUS = 0.9;
  const tempLobDirection = new THREE.Vector3();
  const tempMistDirection = new THREE.Vector3();
  const tempMistMoveStep = new THREE.Vector3();
  const tempAttackMistForward = new THREE.Vector3();

  const createMistPool = ({ particleCount, color, emissive, opacity, emissiveIntensity, spread, yRandom, sizeRange }) => {
    const available = [];
    const sphereGeometry = new THREE.SphereGeometry(1, 10, 8);
    return {
      acquire() {
        const pooled = available.pop();
        if (pooled) {
          pooled.group.visible = true;
          return pooled;
        }
        const group = new THREE.Group();
        const material = new THREE.MeshStandardMaterial({
          color,
          transparent: true,
          opacity,
          emissive,
          emissiveIntensity,
          depthWrite: false
        });
        for (let i = 0; i < particleCount; i++) {
          const particle = new THREE.Mesh(sphereGeometry, material);
          particle.castShadow = false;
          particle.receiveShadow = false;
          group.add(particle);
        }
        return { group, material };
      },
      setup(entry) {
        entry.material.opacity = opacity;
        entry.material.emissiveIntensity = emissiveIntensity;
        entry.group.children.forEach((particle) => {
          const size = THREE.MathUtils.lerp(sizeRange[0], sizeRange[1], Math.random());
          particle.scale.setScalar(size);
          particle.position.set(
            (Math.random() - 0.5) * spread,
            Math.random() * yRandom,
            (Math.random() - 0.5) * spread
          );
        });
      },
      release(entry) {
        if (!entry) return;
        entry.group.visible = false;
        available.push(entry);
      }
    };
  };

  const iceMistPool = createMistPool({
    particleCount: ICE_MIST_PARTICLE_COUNT,
    color: 0x66ccff,
    emissive: 0x3aa5ff,
    opacity: 0.65,
    emissiveIntensity: 0.6,
    spread: 0.35,
    yRandom: 0.35,
    sizeRange: [0.2, 0.45]
  });

  const bombMistPool = createMistPool({
    particleCount: BOMB_MIST_PARTICLE_COUNT,
    color: 0xd94b4b,
    emissive: 0x7a1010,
    opacity: 0.7,
    emissiveIntensity: 0.5,
    spread: 8.0,
    yRandom: 0.4,
    sizeRange: [0.25, 0.6]
  });

  function spawnIceMist(scene, mistList, position, direction, shooterId) {
    const pooled = iceMistPool.acquire();
    const mistGroup = pooled.group;
    iceMistPool.setup(pooled);

    mistGroup.position.copy(position);
    mistGroup.userData.skipTerrainCorrection = true;
    scene.add(mistGroup);

    tempMistDirection.copy(direction).normalize();
    const speed = ICE_MIST_SPEED * THREE.MathUtils.lerp(0.9, 1.15, Math.random());
    const drift = new THREE.Vector3(
      (Math.random() - 0.5) * 0.3,
      Math.random() * 0.2,
      (Math.random() - 0.5) * 0.3
    );
    const velocity = new THREE.Vector3().copy(tempMistDirection).multiplyScalar(speed).add(drift);

    mistList.push({
      pooled,
      group: mistGroup,
      material: pooled.material,
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

  function spawnBombMist(scene, mistList, position) {
    const pooled = bombMistPool.acquire();
    const mistGroup = pooled.group;
    bombMistPool.setup(pooled);

    mistGroup.position.copy(position);
    mistGroup.userData.skipTerrainCorrection = true;
    scene.add(mistGroup);

    const drift = new THREE.Vector3(
      (Math.random() - 0.5) * 0.12,
      0.15 + Math.random() * 0.2,
      (Math.random() - 0.5) * 0.12
    );

    mistList.push({
      pooled,
      group: mistGroup,
      material: pooled.material,
      velocity: drift,
      spawnTime: performance.now(),
      lifetimeMs: BOMB_MIST_LIFETIME_MS
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
      }
      iceMistPool.release(mist.pooled);
      mistList.splice(index, 1);
    };

    for (let i = mistList.length - 1; i >= 0; i--) {
      const mist = mistList[i];
      tempMistMoveStep.copy(mist.velocity).multiplyScalar(deltaSeconds);
      mist.group.position.add(tempMistMoveStep);
      mist.traveled += tempMistMoveStep.length();

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
            window.lastHitAttackTypes = getAttackTypes('iceMistProjectile', ['ice']);
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
            monster.model.userData.lastHitAttackTypes = getAttackTypes('iceMistProjectile', ['ice']);
            mist.hitTargets.add(monster.id);
          }
        }
      }

      if (ageMs >= mist.lifetimeMs || mist.traveled >= mist.maxDistance) {
        removeMist(i);
      }
    }
  }

  function updateBombMists({ scene, mistList, deltaSeconds }) {
    if (!mistList.length) return;
    const now = performance.now();

    const removeMist = (index) => {
      const mist = mistList[index];
      if (!mist) return;
      if (mist.group) {
        scene.remove(mist.group);
      }
      bombMistPool.release(mist.pooled);
      mistList.splice(index, 1);
    };

    for (let i = mistList.length - 1; i >= 0; i--) {
      const mist = mistList[i];
      if (mist.velocity) {
        tempMistMoveStep.copy(mist.velocity).multiplyScalar(deltaSeconds);
        mist.group.position.add(tempMistMoveStep);
      }
      const ageMs = now - mist.spawnTime;
      const progress = Math.min(1, ageMs / mist.lifetimeMs);
      mist.material.opacity = THREE.MathUtils.lerp(0.7, 0, progress);
      mist.material.emissiveIntensity = THREE.MathUtils.lerp(0.5, 0, progress);
      if (ageMs >= mist.lifetimeMs) {
        removeMist(i);
      }
    }
  }

  function updateAttackWindowMist({ scene, playerModel }) {
    if (!scene || !playerModel?.userData) return;
    const activeAttack = playerModel.userData.attack;
    if (!activeAttack?.name || !Number.isFinite(activeAttack.start)) {
      if (attackWindowMists.length) {
        for (let i = attackWindowMists.length - 1; i >= 0; i--) {
          const entry = attackWindowMists[i];
          if (entry?.mesh?.parent) {
            entry.mesh.parent.remove(entry.mesh);
          }
          attackWindowMists.splice(i, 1);
        }
      }
      return;
    }

    const attackName = activeAttack.name === 'mutantPunch' && playerModel.userData?.equippedWeaponType === 'sword'
      ? 'swordSlash'
      : activeAttack.name;
    const cfg = ATTACKS[attackName];
    if (!cfg) return;

    const elapsed = Date.now() - activeAttack.start;
    const visualWindowMs = Math.max(cfg.hitWindow * ATTACK_WINDOW_VISUAL_MULTIPLIER, 220);
    const inHitWindow = elapsed >= cfg.hitTime && elapsed <= cfg.hitTime + visualWindowMs;

    if (!inHitWindow) {
      if (attackWindowMists.length) {
        for (let i = attackWindowMists.length - 1; i >= 0; i--) {
          const entry = attackWindowMists[i];
          if (entry?.mesh?.parent) {
            entry.mesh.parent.remove(entry.mesh);
          }
          attackWindowMists.splice(i, 1);
        }
      }
      return;
    }

    const attackRegion = cfg.region || 'around';
    const expectedShape = attackRegion === 'forward' ? 'box' : 'circle';

    if (!attackWindowMists.length || attackWindowMists[0]?.shape !== expectedShape) {
      if (attackWindowMists.length) {
        for (let i = attackWindowMists.length - 1; i >= 0; i--) {
          const staleEntry = attackWindowMists[i];
          if (staleEntry?.mesh?.parent) {
            staleEntry.mesh.parent.remove(staleEntry.mesh);
          }
          attackWindowMists.splice(i, 1);
        }
      }

      const geometry = expectedShape === 'box'
        ? new THREE.BoxGeometry(1, ATTACK_WINDOW_MIST_HEIGHT, 1)
        : new THREE.CylinderGeometry(1, 1, ATTACK_WINDOW_MIST_HEIGHT, 24, 1, true);
      const material = new THREE.MeshBasicMaterial({
        color: 0xffdd33,
        transparent: true,
        opacity: ATTACK_WINDOW_MIST_OPACITY,
        depthWrite: false,
        side: THREE.DoubleSide
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.userData.skipTerrainCorrection = true;
      attackWindowMists.push({ mesh, shape: expectedShape });
      scene.add(mesh);
    }

    const entry = attackWindowMists[0];
    const mesh = entry.mesh;
    const range = Math.max(0.4, cfg.range);
    mesh.position.copy(playerModel.position);
    mesh.position.y += ATTACK_WINDOW_MIST_HEIGHT * 0.5;

    if (attackRegion === 'forward') {
      const width = range;
      mesh.scale.set(width, 1, range);
      mesh.rotation.set(0, playerModel.rotation.y, 0);
      playerModel.getWorldDirection(tempAttackMistForward);
      tempAttackMistForward.y = 0;
      if (tempAttackMistForward.lengthSq() < 0.0001) {
        tempAttackMistForward.set(0, 0, 1);
      } else {
        tempAttackMistForward.normalize();
      }
      mesh.position.addScaledVector(tempAttackMistForward, range * 0.5);
    } else {
      mesh.scale.set(range, 1, range);
      mesh.rotation.set(0, 0, 0);
    }
  }

  function spawnHitRibbonBurst(scene, position) {
    if (!scene || !position) return;
    const group = new THREE.Group();
    const material = new THREE.MeshStandardMaterial({
      color: 0xff3344,
      emissive: 0xbb0f20,
      emissiveIntensity: 0.9,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      side: THREE.DoubleSide
    });

    const streaks = [];
    for (let i = 0; i < HIT_RIBBON_STREAK_COUNT; i++) {
      const geometry = new THREE.PlaneGeometry(0.08, THREE.MathUtils.lerp(0.5, 0.95, Math.random()));
      const streak = new THREE.Mesh(geometry, material);
      const angle = (Math.PI * 2 * i) / HIT_RIBBON_STREAK_COUNT + (Math.random() - 0.5) * 0.45;
      streak.position.set(0, THREE.MathUtils.lerp(0.15, 0.55, Math.random()), 0);
      streak.rotation.x = -Math.PI / 2;
      streak.rotation.z = angle;
      const direction = new THREE.Vector3(Math.cos(angle), 0.08 + Math.random() * 0.22, Math.sin(angle)).normalize();
      const speed = THREE.MathUtils.lerp(4.0, 7.2, Math.random());
      streaks.push({ mesh: streak, velocity: direction.multiplyScalar(speed) });
      group.add(streak);
    }

    group.position.copy(position);
    group.userData.skipTerrainCorrection = true;
    scene.add(group);

    hitRibbonBursts.push({
      group,
      material,
      streaks,
      spawnTime: performance.now(),
      lifetimeMs: HIT_RIBBON_LIFETIME_MS
    });
  }

  function updateHitRibbonBursts({ scene, deltaSeconds }) {
    if (!hitRibbonBursts.length) return;
    const now = performance.now();

    for (let i = hitRibbonBursts.length - 1; i >= 0; i--) {
      const burst = hitRibbonBursts[i];
      const ageMs = now - burst.spawnTime;
      const progress = Math.min(1, ageMs / burst.lifetimeMs);
      burst.material.opacity = THREE.MathUtils.lerp(0.95, 0, progress);
      burst.material.emissiveIntensity = THREE.MathUtils.lerp(0.9, 0.1, progress);

      burst.streaks.forEach(({ mesh, velocity }) => {
        tempMistMoveStep.copy(velocity).multiplyScalar(deltaSeconds);
        mesh.position.add(tempMistMoveStep);
      });

      if (ageMs >= burst.lifetimeMs) {
        if (burst.group?.parent) {
          burst.group.parent.remove(burst.group);
        }
        hitRibbonBursts.splice(i, 1);
      }
    }
  }

  function asVec3(p) {
    return p?.isVector3 ? p.clone()
      : p && Number.isFinite(p.x) && Number.isFinite(p.z) ? new THREE.Vector3(p.x, p.y ?? 0, p.z)
      : null;
  }

  function resolveSpawnY(position, offset, { allowOnBuildings = false } = {}) {
    if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.z)) return null;
    return getSpawnY(position.x, position.z, offset, { allowOnBuildings });
  }

  function applySpawnY(position, offset, { allowOnBuildings = false } = {}) {
    const resolvedY = resolveSpawnY(position, offset, { allowOnBuildings });
    if (!Number.isFinite(resolvedY)) return false;
    position.y = resolvedY;
    return true;
  }

  function normalizeNetworkSpawnPosition(position, offset, { allowOnBuildings = false } = {}) {
    const spawnPos = asVec3(position);
    if (!spawnPos) return null;
    const resolvedY = resolveSpawnY(spawnPos, offset, { allowOnBuildings });
    if (!Number.isFinite(resolvedY)) return null;
    spawnPos.y = resolvedY;
    return spawnPos;
  }

  function spawnAmmoPickup(position, amount = AMMO_PICKUP_AMOUNT, options = {}) {
    const spawnPos = asVec3(position);
    if (!spawnPos) return;
    if (options.noFloat) {
      const groundOffset = Number.isFinite(options.groundOffset) ? options.groundOffset : 0.08;
      if (!applySpawnY(spawnPos, groundOffset, { allowOnBuildings: true })) return;
    } else if (!applySpawnY(spawnPos, 0.6, { allowOnBuildings: true })) {
      return;
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
    applyOptionalShadowState(pickup, optionalShadowsEnabled);
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
    if (!applySpawnY(spawnPos, 0.6, { allowOnBuildings: true })) return null;

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
    applyOptionalShadowState(pickup, optionalShadowsEnabled);
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
        if (mesh && Number.isFinite(x) && Number.isFinite(z)) {
          const normalizedPos = normalizeNetworkSpawnPosition({ x, y, z }, 0.6, { allowOnBuildings: true });
          if (normalizedPos) {
            mesh.position.copy(normalizedPos);
            mesh.userData.baseY = normalizedPos.y;
          }
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


  function removeSpecificPickup(list, pickup) {
    const index = list.indexOf(pickup);
    if (index >= 0) {
      list.splice(index, 1);
    }
  }

  function spawnDroppedWorldPickup(itemId, position, amount, dropId) {
    const normalizedAmount = Number.isFinite(amount) ? Math.max(1, Math.floor(amount)) : 1;
    let pickup = null;
    if (isMushroomItem(itemId)) {
      pickup = spawnMushroomPickup(itemId, position);
    } else if (isAppleItem(itemId)) {
      pickup = spawnApplePickup(position);
    } else if (isMeatItem(itemId)) {
      pickup = spawnMeatPickup(position);
    } else if (isWoodItem(itemId)) {
      pickup = spawnWoodPickup(position);
    } else if (isZombieBrainsItem(itemId)) {
      pickup = spawnZombieBrainsPickup(position);
    } else if (isSaltItem(itemId) || itemId === SAUTEED_MUSHROOMS_ITEM_ID) {
      pickup = spawnSaltPickup(position, { itemId, amount: normalizedAmount });
    }
    if (!pickup) return null;
    pickup.dropId = dropId;
    pickup.networkDropped = true;
    return pickup;
  }

  function addDroppedWorldPickup({ id, itemId, position, amount }) {
    if (!id || !itemId || !position || droppedWorldPickups.has(id)) return;
    const pickup = spawnDroppedWorldPickup(itemId, position, amount, id);
    if (!pickup) return;
    droppedWorldPickups.set(id, {
      id,
      itemId,
      amount: Number.isFinite(amount) ? Math.max(1, Math.floor(amount)) : 1,
      pickup
    });
  }

  function removeDroppedWorldPickup(id) {
    const entry = droppedWorldPickups.get(id);
    if (!entry) return;
    const pickup = entry.pickup;
    if (pickup) {
      if (isMushroomItem(entry.itemId)) {
        disposeMushroomPickup(pickup);
        removeSpecificPickup(mushroomPickups, pickup);
        mushroomPickupGrid.remove(pickup);
      } else if (isAppleItem(entry.itemId)) {
        disposeApplePickup(pickup);
        removeSpecificPickup(applePickups, pickup);
      } else if (isMeatItem(entry.itemId)) {
        disposeWoodPickup(pickup);
        removeSpecificPickup(meatPickups, pickup);
      } else if (isWoodItem(entry.itemId)) {
        disposeWoodPickup(pickup);
        removeSpecificPickup(woodPickups, pickup);
      } else if (isZombieBrainsItem(entry.itemId)) {
        disposeWoodPickup(pickup);
        removeSpecificPickup(zombieBrainsPickups, pickup);
      } else if (isSaltItem(entry.itemId) || entry.itemId === SAUTEED_MUSHROOMS_ITEM_ID) {
        disposeSaltPickup(pickup);
        removeSpecificPickup(saltPickups, pickup);
      }
    }
    droppedWorldPickups.delete(id);
  }

  function syncDroppedWorldState(stateDrops = []) {
    const seen = new Set();
    stateDrops.forEach(drop => {
      if (!drop?.id || typeof drop.itemId !== 'string' || !Array.isArray(drop.position)) return;
      if (pendingWorldDropRemovals.has(drop.id)) return;
      seen.add(drop.id);
      if (!droppedWorldPickups.has(drop.id)) {
        addDroppedWorldPickup({
          id: drop.id,
          itemId: drop.itemId,
          position: new THREE.Vector3(...drop.position),
          amount: drop.amount
        });
      }
    });

    Array.from(droppedWorldPickups.keys()).forEach((id) => {
      if (!seen.has(id)) {
        removeDroppedWorldPickup(id);
      }
    });

    Array.from(pendingWorldDropRemovals).forEach((id) => {
      if (!seen.has(id)) {
        pendingWorldDropRemovals.delete(id);
      }
    });
  }

  function spawnFoodPickup(position) {
    const spawnPos = asVec3(position);
    if (!spawnPos) return;
    if (!applySpawnY(spawnPos, 0.6, { allowOnBuildings: true })) return null;

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
    applyOptionalShadowState(pickup, optionalShadowsEnabled);
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
    if (!applySpawnY(spawnPos, 0.6, { allowOnBuildings: true })) return null;

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
    applyOptionalShadowState(pickup, optionalShadowsEnabled);
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
    if (!applySpawnY(spawnPos, 0.6, { allowOnBuildings: true })) return null;

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
    applyOptionalShadowState(pickup, optionalShadowsEnabled);
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
    lastStatUpdateAt = Date.now();
    saveStatsThrottled(profileNameKey, statsState, lastStatUpdateAt);
  }

  function applyHealthPickupEffects() {
    setStat('health', statsState.health + HEALTH_PICKUP_SEGMENTS, { skipSave: true });
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

    if (!applySpawnY(spawnPos, 0.5, { allowOnBuildings: true })) return;
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

    if (!applySpawnY(spawnPos, 0.5, { allowOnBuildings: true })) return;
    bow.mesh.position.copy(spawnPos);
    bow.mesh.quaternion.set(0, 0, 0, 1);
    bow.mesh.visible = true;
    bow.holder = null;
    scatterArrowPickups(spawnPos);
  }

  const scatterArrowPickups = (center) => {
    if (!center) return;
    const offsets = [
      new THREE.Vector3(1.2, 0, 0.6),
      new THREE.Vector3(-1.1, 0, 0.9),
      new THREE.Vector3(0.8, 0, -1.2),
      new THREE.Vector3(-0.7, 0, -1.0),
      new THREE.Vector3(1.0, 0, -0.4)
    ];
    const shuffled = offsets
      .map(offset => ({ offset, order: Math.random() }))
      .sort((a, b) => a.order - b.order);
    const amounts = [1, 1, 3];
    shuffled.slice(0, amounts.length).forEach((entry, index) => {
      const arrowPos = center.clone().add(entry.offset);
      spawnArrowPickup(arrowPos, amounts[index]);
    });
  };

  function spawnBombPickup(position) {
    if (!bomb?.mesh) return;
    const spawnPos = asVec3(position);
    if (!spawnPos) return;

    if (!applySpawnY(spawnPos, 0.4, { allowOnBuildings: true })) return;
    bomb.mesh.position.copy(spawnPos);
    bomb.mesh.quaternion.set(0, 0, 0, 1);
    bomb.mesh.visible = true;
    bomb.holder = null;
  }



  const getTutorialNearbyPosition = (radius = 4.5) => {
    if (!playerModel?.position) return null;
    const angle = Math.random() * Math.PI * 2;
    const x = playerModel.position.x + Math.cos(angle) * radius;
    const z = playerModel.position.z + Math.sin(angle) * radius;
    const y = (getTerrainHeight?.(x, z) ?? playerModel.position.y) + 0.3;
    return new THREE.Vector3(x, y, z);
  };

  window.spawnTutorialMerchantNearby = async () => {
    const position = getTutorialNearbyPosition(5.5);
    if (!position) return;
    await spawnMerchantAtFeature({
      position,
      scene,
      attachPhysics: attachMonsterPhysics,
      getTerrainHeight,
      liftPositionToBuildingTop
    });
  };

  window.spawnTutorialDeerNearby = async () => {
    const position = getTutorialNearbyPosition(6.5);
    if (!position) return;
    await animalManager?.spawnDeerAt?.(position);
  };

  window.spawnTutorialBowAndArrowsNearby = () => {
    const bowPos = getTutorialNearbyPosition(4.2);
    if (bowPos) {
      spawnBowPickup(bowPos);
    }
    const arrowPos = getTutorialNearbyPosition(3.6);
    if (arrowPos) {
      spawnArrowPickup(arrowPos, 18);
    }
  };

  window.spawnTutorialRockAndBombNearby = () => {
    const rockPos = getTutorialNearbyPosition(6.2);
    if (rockPos) {
      natureController?.spawnQuestRock?.(rockPos);
    }
    const bombPos = getTutorialNearbyPosition(4.6);
    if (bombPos) {
      spawnBombPickup(bombPos);
    }
  };

  function spawnAutumnSwordPickup(position) {
    if (!autumnSword?.mesh) return;
    const spawnPos = asVec3(position);
    if (!spawnPos) return;

    if (!applySpawnY(spawnPos, 0.5, { allowOnBuildings: true })) return;
    autumnSword.mesh.position.copy(spawnPos);
    autumnSword.mesh.quaternion.set(0, 0, 0, 1);
    autumnSword.mesh.visible = true;
    autumnSword.holder = null;
  }

  function spawnLanternPickup(position) {
    if (!lantern?.mesh) return;
    const spawnPos = asVec3(position);
    if (!spawnPos) return;

    if (!applySpawnY(spawnPos, 0.2, { allowOnBuildings: true })) return;
    lantern.mesh.position.copy(spawnPos);
    lantern.mesh.quaternion.set(0, 0, 0, 1);
    lantern.mesh.visible = true;
    lantern.holder = null;
  }

  function spawnTorchPickup(position, torchHealth = DEFAULT_TORCH_HEALTH) {
    if (!torch?.mesh) return;
    const spawnPos = asVec3(position);
    if (!spawnPos) return;

    if (!applySpawnY(spawnPos, 0.2, { allowOnBuildings: true })) return;
    torch.mesh.position.copy(spawnPos);
    torch.mesh.quaternion.set(0, 0, 0, 1);
    torch.mesh.visible = true;
    torch.mesh.userData.torchHealth = normalizeTorchHealth(torchHealth);
    torch.holder = null;
  }

  function spawnTreasureChestPickup(position) {
    if (!treasureChest?.mesh || treasureChest.isOpen) return;
    const spawnPos = asVec3(position);
    if (!spawnPos) return;

    if (!applySpawnY(spawnPos, 0, { allowOnBuildings: true })) return;
    treasureChest.mesh.position.copy(spawnPos);
    treasureChest.mesh.visible = true;
    treasureChest.syncCollider?.();
  }

  function addDroppedWeaponPickupFromState(drop) {
    if (!drop?.id || typeof drop.itemId !== 'string') return;
    const dropId = drop.id;
    if (droppedWeaponPickups.some(pickup => pickup?.dropId === dropId)) {
      networkDroppedWeaponPickups.set(dropId, true);
      return;
    }
    const pickupConfig = {
      bow: { item: bow, markerColor: 0xffc26b },
      lantern: { item: lantern, markerColor: 0xffd400 },
      torch: { item: torch, markerColor: 0xffa54c },
      bomb: { item: bomb, markerColor: 0xff4d4d },
      autumnSword: { item: autumnSword, markerColor: 0xffd400 },
      iceGun: { item: iceGun, markerColor: 0xffd400 }
    }[drop.itemId];
    if (!pickupConfig?.item?.mesh) return;
    const amount = Number.isFinite(drop.quantity) ? Math.max(1, Math.floor(drop.quantity)) : 1;
    const pos = Array.isArray(drop.position) ? new THREE.Vector3(...drop.position) : null;
    const quat = Array.isArray(drop.rotation) && drop.rotation.length === 4
      ? new THREE.Quaternion(drop.rotation[0], drop.rotation[1], drop.rotation[2], drop.rotation[3])
      : undefined;
    createDroppedWeaponPickup(pickupConfig.item, {
      itemId: drop.itemId,
      quantity: amount,
      markerColor: pickupConfig.markerColor,
      markerOffsetY: 1.2,
      position: pos,
      quaternion: quat,
      allowHidden: true,
      torchHealth: Number.isFinite(drop.torchHealth) ? drop.torchHealth : undefined,
      dropId,
      shouldBroadcastRemoval: false
    });
    networkDroppedWeaponPickups.set(dropId, true);
  }

  function syncDroppedWeaponState(stateDrops = []) {
    const seen = new Set();
    stateDrops.forEach(drop => {
      if (!drop?.id || typeof drop.itemId !== 'string') return;
      const dropId = drop.id;
      seen.add(dropId);
      const existing = droppedWeaponPickups.find(pickup => pickup?.dropId === dropId);
      const amount = Number.isFinite(drop.quantity) ? Math.max(1, Math.floor(drop.quantity)) : 1;
      if (existing) {
        networkDroppedWeaponPickups.set(dropId, true);
        existing.quantity = amount;
        if (Number.isFinite(drop.torchHealth)) {
          const normalizedHealth = normalizeTorchHealth(drop.torchHealth);
          existing.torchHealth = normalizedHealth;
          if (existing.mesh) {
            existing.mesh.userData.torchHealth = normalizedHealth;
          }
        }
        return;
      }
      addDroppedWeaponPickupFromState(drop);
    });

    for (let i = droppedWeaponPickups.length - 1; i >= 0; i -= 1) {
      const pickup = droppedWeaponPickups[i];
      const dropId = pickup?.dropId;
      if (!dropId || !networkDroppedWeaponPickups.has(dropId)) continue;
      if (seen.has(dropId)) continue;
      droppedWeaponPickups.splice(i, 1);
      disposeDroppedWeaponPickup(pickup);
      networkDroppedWeaponPickups.delete(dropId);
    }
  }

  registerNetworkedEntity('droppedWeapons', {
    getState: () => {
      const drops = droppedWeaponPickups
        .filter(pickup => pickup?.dropId)
        .map(pickup => {
          const pos = pickup.mesh?.position;
          const q = pickup.mesh?.quaternion;
          if (!pos || !q) return null;
          return {
            id: pickup.dropId,
            itemId: pickup.itemId,
            position: [pos.x, pos.y, pos.z],
            rotation: [q.x, q.y, q.z, q.w],
            quantity: pickup.quantity,
            torchHealth: pickup.torchHealth
          };
        })
        .filter(Boolean);
      return { drops };
    },
    applyState: state => {
      if (!state) return;
      const drops = Array.isArray(state.drops) ? state.drops : [];
      syncDroppedWeaponState(drops);
    },
    isLocallyControlled: () => multiplayer?.isHost
  });

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


  registerNetworkedEntity('droppedWorld', {
    getState: () => {
      const drops = Array.from(droppedWorldPickups.entries()).map(([id, entry]) => {
        const pickup = entry?.pickup;
        const pos = pickup?.mesh?.position || pickup?.position;
        if (!pos || typeof entry?.itemId !== 'string') return null;
        return {
          id,
          itemId: entry.itemId,
          position: [pos.x, pos.y, pos.z],
          amount: entry.amount
        };
      }).filter(Boolean);
      return { drops };
    },
    applyState: state => {
      if (!state) return;
      const drops = Array.isArray(state.drops) ? state.drops : [];
      syncDroppedWorldState(drops);
    },
    isLocallyControlled: () => multiplayer?.isHost
  });

  let statDecayAccumulator = 0;
  let healthRecoveryRemainder = 0;
  let healthDecayRemainder = 0;
  let hungerRecoveryRemainder = 0;
  let hungerDecayRemainder = 0;
  let movementHungerDecayRemainder = 0;

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
      if (homeSystem?.isInsideHome && homeSystem?.interiorGroup) {
        occluders.push(homeSystem.interiorGroup);
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
    },
    onSleepStart: startSleepSession,
    onSleepEnd: endSleepSession
  });
  window.questManager?.hydratePersistentState?.(playerProfile?.quests);
  window.questManager?.setQuestStateChangeListener?.((questState) => {
    const completedCount = Array.isArray(questState?.completedQuestIds)
      ? questState.completedQuestIds.length
      : 0;
    const newlyCompleted = Math.max(0, completedCount - questCompletionsTracked);
    if (newlyCompleted > 0) {
      notifyAchievementProgress('questsCompleted', newlyCompleted);
      questCompletionsTracked = completedCount;
    }
    playerProfile = playerProfile || {};
    playerProfile.quests = questState;
    if (profileNameKey) {
      void saveQuestState(profileNameKey, questState);
    }
  });
  playerControls.throwBomb = (position, direction) => {
    if (!bomb?.mesh || bomb.holder !== playerControls) return false;
    if ((inventoryState.bomb?.count || 0) <= 0) return false;
    const shooterId = multiplayer?.getId?.();
    spawnBombProjectileWithPerfFlags(scene, projectiles, position, direction, shooterId);
    unequipInventoryItem('bomb');
    removeFromInventory('bomb', 1);
    notifyAchievementProgress('bombsThrown', 1);
    return true;
  };
  playerControls.getInventoryItemHand = (itemId) => getInventoryItemHand(itemId);
  playerControls.throwInventoryItem = (itemId, position, direction) => {
    if (!itemId || !position || !direction) return false;
    if ((inventoryState[itemId]?.count || 0) <= 0) return false;
    if (itemId === 'bomb') {
      return playerControls.throwBomb(position, direction);
    }

    const itemMap = { iceGun, bow, autumnSword, lantern, torch };
    const sourceItem = itemMap[itemId];
    if (!sourceItem?.mesh) return false;

    let thrownTorchHealth = null;
    if (itemId === TORCH_ITEM_ID) {
      const torchTakeResult = takeTorchHealth(inventoryState, equippedTorchIndex);
      thrownTorchHealth = normalizeTorchHealth(
        torchTakeResult?.health ?? torch?.mesh?.userData?.torchHealth ?? DEFAULT_TORCH_HEALTH
      );
      equippedTorchIndex = null;
      persistInventoryAndStorage();
    } else {
      removeFromInventory(itemId, 1);
    }

    if (isInventoryItemEquipped(itemId)) {
      unequipInventoryItem(itemId);
    }

    const shooterId = multiplayer?.getId?.();
    if (typeof shooterId === 'string') {
      multiplayer?.send?.({
        type: 'inventoryThrowProjectile',
        id: shooterId,
        itemId,
        position: position.toArray(),
        direction: direction.toArray()
      });
    }

    return spawnInventoryThrowProjectileWithPerfFlags(scene, projectiles, position, direction, shooterId, {
      itemId,
      sourceItem,
      damage: itemId === 'autumnSword' ? 2 : 1,
      thrownTorchHealth,
      createPickupOnGround: true
    });
  };
  const voiceMicState = {
    listening: false,
    lastTranscript: '',
    pendingSpellResolution: false,
    pendingSpellTimeout: null,
    cooldownUntil: 0,
    transcriptTimer: null
  };
  const VOICE_COOLDOWN_MS = 60_000;

  playerControls.handleVoiceMicPress = () => {
    startVoiceListening();
  };
  playerControls.stopVoiceListening = () => {
    stopVoiceListening();
  };
  playerControls.isVoiceListening = () => voiceMicState.listening;
  playerControls.getVoiceMicState = () => getVoiceMicState();

  runtimeContext.systems.playerControls = playerControls;
  window.playerControls = playerControls;
  await initSpellsFeature({
    playerControls,
    getPlayerModel: () => playerModel,
    getCharacterModel: () => characterModel,
    spellsAvailable,
    getMagic: () => statsState.magic,
    setMagic: (value) => setStat('magic', value)
  });
  updateControlAvailability();
  updateEnergyEffects();


  await initMapViewFeature({ camera, scene, player: playerModel });

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
    void setMapViewEnabledFeature(mapViewEnabled);
    updateControlAvailability();
    mapToggleButton.classList.toggle('active', mapViewEnabled);
    mapControls.classList.toggle('map-enabled', mapViewEnabled);
  });

  zoomInButton.addEventListener('click', () => {
    void zoomInMapFeature();
  });
  zoomOutButton.addEventListener('click', () => {
    void zoomOutMapFeature();
  });

  const TILE_SIZE_METERS = 300;
  let terrainStampDebugOverlay = null;
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
    tileSizeMeters: TILE_SIZE_METERS,
    terrainSeed: TERRAIN_STAMP_REGRESSION_SCENE.seed
  });
  terrainStampDebugOverlay = createTerrainStampDebugOverlay({
    scene,
    getTargetPosition: () => playerModel?.position ?? null
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
      const pickupMesh = pickup?.position ? pickup : pickup?.mesh;
      if (!pickupMesh?.position) {
        pickups.splice(i, 1);
        continue;
      }
      if (center.distanceTo(pickupMesh.position) > radius) {
        if (pickupMesh === pickup) {
          disposePickup(pickupMesh);
        } else {
          disposeWoodPickup(pickup);
        }
        pickups.splice(i, 1);
      }
    }
  };
  const removeDroppedWeaponPickupsOutsideRadius = (pickups, center, radius) => {
    for (let i = pickups.length - 1; i >= 0; i--) {
      const pickup = pickups[i];
      const mesh = pickup?.mesh;
      if (!mesh) {
        pickups.splice(i, 1);
        continue;
      }
      if (center.distanceTo(mesh.position) > radius) {
        disposeDroppedWeaponPickup(pickup);
        pickups.splice(i, 1);
      }
    }
  };
  const getWeaponPickupConfigs = () => ([
    {
      itemId: 'iceGun',
      item: iceGun,
      markerColor: 0xffd400,
      markerOffsetY: 1.2,
      groundOffset: 0.5,
    },
    {
      itemId: 'bow',
      item: bow,
      markerColor: 0xffc26b,
      markerOffsetY: 1.2,
      groundOffset: 0.5,
    },
    {
      itemId: 'bomb',
      item: bomb,
      markerColor: 0xff4d4d,
      markerOffsetY: 1.2,
      groundOffset: 0.4,
    },
    {
      itemId: 'autumnSword',
      item: autumnSword,
      markerColor: 0xffd400,
      markerOffsetY: 1.2,
      groundOffset: 0.5,
    }
  ]);
  const spawnWeaponPickupCopy = (position) => {
    const spawnPos = asVec3(position);
    if (!spawnPos) return;
    const configs = getWeaponPickupConfigs().filter(config => config.item?.mesh);
    if (configs.length === 0) return;
    const config = configs[Math.floor(Math.random() * configs.length)];
    if (!applySpawnY(spawnPos, config.groundOffset, { allowOnBuildings: true })) return;
    createDroppedWeaponPickup(config.item, {
      itemId: config.itemId,
      markerColor: config.markerColor,
      markerOffsetY: config.markerOffsetY,
      position: spawnPos,
      allowHidden: true
    });
  };
  const updatePickupTiles = (position) => {
    if (!position) return;
    const center = position.clone();
    removePickupOutsideRadius(ammoPickups, center, PICKUP_SPAWN_RADIUS);
    removePickupOutsideRadius(foodPickups, center, PICKUP_SPAWN_RADIUS);
    removePickupOutsideRadius(healthPickups, center, PICKUP_SPAWN_RADIUS);
    removePickupOutsideRadius(coinPickups, center, PICKUP_SPAWN_RADIUS);
    removePickupOutsideRadius(zombieBrainsPickups, center, PICKUP_SPAWN_RADIUS);
    removeDroppedWeaponPickupsOutsideRadius(droppedWeaponPickups, center, PICKUP_SPAWN_RADIUS);

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
    spawnScatteredPickups({
      center,
      count: TILE_STOCK_WEAPON_COUNT,
      maxTotal: () => droppedWeaponPickups.length < MAX_WEAPON_PICKUPS,
      spawnFn: spawnWeaponPickupCopy
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

      const hasBomb = (inventoryState?.bomb?.count || 0) > 0;
      const canSpawnBomb = bomb?.mesh && !bomb.holder && !hasBomb && !bomb.mesh.visible;
      if (canSpawnBomb) {
        const spawnPos = getRandomPickupPosition(center);
        if (spawnPos) {
          spawnBombPickup(spawnPos);
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

    [iceGun, bow, autumnSword, bomb].forEach((weapon) => {
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
  const MAP_FRAME_BUDGET_MS = 18;
  const MAP_DEFER_TIMEOUT_MS = 200;
  const MAP_DEFER_MAX_WAIT_MS = 900;
  let lastFrameDurationMs = 0;

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
    refreshRenderOriginFromBounds();
  }

  const GPS_SNAP_DISTANCE_METERS = 20;
  const GPS_TARGET_EPSILON_METERS = 0.35;
  const GPS_PATH_EPSILON_METERS = 0.05;
  const ORIGIN_RESET_WINDOW_MS = 3 * 60 * 1000;
  const ORIGIN_RESET_MAX_ACCURACY_METERS = 15;
  const ORIGIN_RESET_JUMP_DISTANCE_METERS = 200;
  const appStartedAtMs = Date.now();
  let originWasAutoReset = false;

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
    const excludedColliderHandles = new Set();
    const body = playerControls.body;
    if (body && typeof body.numColliders === 'function' && typeof body.collider === 'function') {
      const colliderCount = body.numColliders();
      for (let i = 0; i < colliderCount; i += 1) {
        const collider = body.collider(i);
        if (typeof collider?.handle === 'number') {
          excludedColliderHandles.add(collider.handle);
        }
      }
    }
    const hit = rapierWorld.castRay(
      ray,
      distance,
      true,
      undefined,
      undefined,
      undefined,
      undefined,
      excludedColliderHandles.size ? (collider) => !excludedColliderHandles.has(collider?.handle) : undefined
    );
    if (!hit) return false;
    const hitDistance = hit.toi ?? hit.timeOfImpact ?? distance;
    return hitDistance < distance - GPS_PATH_EPSILON_METERS;
  };

  const getClosestPointWithinGeoBounds = (position) => {
    if (!position || !playerControls?.geoBoundsCenterXZ) return null;
    const radius = playerControls.geoBoundHalfSizeM;
    if (!Number.isFinite(radius)) return null;
    if (!Number.isFinite(position.x) || !Number.isFinite(position.z)) return null;
    const dx = position.x - playerControls.geoBoundsCenterXZ.x;
    const dz = position.z - playerControls.geoBoundsCenterXZ.z;
    const distance = Math.hypot(dx, dz);
    if (!Number.isFinite(distance) || distance <= radius) return null;
    const scale = radius / Math.max(distance, 1e-6);
    return {
      x: playerControls.geoBoundsCenterXZ.x + dx * scale,
      y: position.y ?? playerModel?.position?.y ?? 0,
      z: playerControls.geoBoundsCenterXZ.z + dz * scale
    };
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
    profileNameKey,
    initialHome: playerProfile?.home ?? null,
    getLocalOrigin: getLocalMapOrigin,
    localMetersToGeo,
    geoToLocal: geoToLocalMeters
  });
  void homeSystem.loadStorageChest?.();
  window.homeSystem = homeSystem;
  const interiorScene = homeSystem?.interiorGroup ?? scene;
  bed = new Bed(interiorScene, {
    position: new THREE.Vector3(-3, 0.5, 3),
    useTerrainHeight: false
  });
  await bed.load();
  window.bed = bed;

  craftTable = new CraftTable(interiorScene, {
    position: new THREE.Vector3(2.5, 0.5, -2.5),
    useTerrainHeight: false
  });
  await craftTable.load();
  window.craftTable = craftTable;
  homeSystem?.registerPlacedObjects?.({ bed, craftTable });
  if (rapierWorld && craftTable?.mesh) {
    if (craftTableColliderBody && rapierWorld.getRigidBody(craftTableColliderBody.handle)) {
      removeRigidBodySafely(rapierWorld, craftTableColliderBody);
      craftTableColliderBody = null;
    }
    const bounds = new THREE.Box3().setFromObject(craftTable.mesh);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    bounds.getSize(size);
    bounds.getCenter(center);
    const half = size.multiplyScalar(0.5);
    const rbDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(center.x, center.y, center.z);
    craftTableColliderBody = rapierWorld.createRigidBody(rbDesc);
    const colDesc = RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z)
      .setRestitution(0.05)
      .setFriction(0.9);
    rapierWorld.createCollider(colDesc, craftTableColliderBody);
    craftTableColliderLastCenter = center.clone();
  }

  const syncCraftTableCollider = () => {
    if (!craftTable?.mesh || !craftTableColliderBody) return;
    craftTableColliderBounds.setFromObject(craftTable.mesh);
    craftTableColliderBounds.getCenter(craftTableColliderCenter);
    if (craftTableColliderLastCenter?.equals?.(craftTableColliderCenter)) return;
    craftTableColliderBody.setTranslation(
      { x: craftTableColliderCenter.x, y: craftTableColliderCenter.y, z: craftTableColliderCenter.z },
      true
    );
    if (!craftTableColliderLastCenter) {
      craftTableColliderLastCenter = new THREE.Vector3();
    }
    craftTableColliderLastCenter.copy(craftTableColliderCenter);
  };

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
      minLon,
      maxLon,
      minLat,
      maxLat,
      centerLon: (minLon + maxLon) / 2,
      centerLat: (minLat + maxLat) / 2
    };
  };

  const tileRenderBounds = new Map();
  const renderedTileGeojson = new Map();
  const isSameRenderOrigin = (nextOrigin, prevOrigin) => {
    if (!nextOrigin || !prevOrigin) {
      return nextOrigin === prevOrigin;
    }
    return nextOrigin.centerLat === prevOrigin.centerLat
      && nextOrigin.centerLon === prevOrigin.centerLon;
  };

  const refreshRenderOriginFromBounds = () => {
    if (worldOrigin) {
      currentRenderOrigin = { centerLat: worldOrigin.lat, centerLon: worldOrigin.lon };
      return currentRenderOrigin;
    }
    let minLon = Infinity;
    let maxLon = -Infinity;
    let minLat = Infinity;
    let maxLat = -Infinity;
    let count = 0;
    for (const bounds of tileRenderBounds.values()) {
      if (!bounds) continue;
      minLon = Math.min(minLon, bounds.minLon);
      maxLon = Math.max(maxLon, bounds.maxLon);
      minLat = Math.min(minLat, bounds.minLat);
      maxLat = Math.max(maxLat, bounds.maxLat);
      count += 1;
    }
    if (count === 0 || !Number.isFinite(minLon)) {
      currentRenderOrigin = null;
      return null;
    }
    currentRenderOrigin = {
      centerLat: (minLat + maxLat) / 2,
      centerLon: (minLon + maxLon) / 2
    };
    return currentRenderOrigin;
  };

  const updateTileRenderBounds = (tileKey, geojson) => {
    if (!tileKey) return;
    if (worldOrigin) {
      currentRenderOrigin = { centerLat: worldOrigin.lat, centerLon: worldOrigin.lon };
      return;
    }
    const bounds = computeGeojsonBounds(geojson);
    if (bounds) {
      tileRenderBounds.set(tileKey, bounds);
    } else {
      tileRenderBounds.delete(tileKey);
    }
  };

  const prefilterGeojson = (geojson) => {
    if (!geojson) return geojson;
    const highways = [];
    const buildings = [];
    const features = geojson?.features ?? [];
    for (const feature of features) {
      const props = feature?.properties;
      if (!props) continue;
      if (props.highway) {
        highways.push(feature);
      }
      if (props.building) {
        buildings.push(feature);
      }
    }
    geojson.prefiltered = { highways, buildings };
    return geojson;
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
      osmWorker = new Worker(new URL("../workers/osmWorker.js", import.meta.url), { type: "module" });
      osmWorker.addEventListener("message", (event) => {
        const { id, geojson, prefiltered, error } = event.data || {};
        if (id == null) return;
        const pending = osmWorkerPending.get(id);
        if (!pending) return;
        osmWorkerPending.delete(id);
        if (error) {
          pending.reject(new Error(error));
        } else {
          if (geojson && prefiltered) {
            geojson.prefiltered = prefiltered;
          }
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
      return prefilterGeojson(overpassToGeoJSON(data));
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
    const desiredKeys = new Set();
    const changedTileKeys = new Set();
    let boundsDirty = false;

    for (const [tileKey, entry] of tileCache.cache.entries()) {
      desiredKeys.add(tileKey);
      if (!entry.geojson) continue;
      const previousGeojson = renderedTileGeojson.get(tileKey);
      if (previousGeojson === entry.geojson) continue;
      renderedTileGeojson.set(tileKey, entry.geojson);
      updateTileRenderBounds(tileKey, entry.geojson);
      boundsDirty = true;
      changedTileKeys.add(tileKey);
    }

    for (const tileKey of Array.from(renderedTileGeojson.keys())) {
      if (desiredKeys.has(tileKey)) continue;
      renderedTileGeojson.delete(tileKey);
      tileRenderBounds.delete(tileKey);
      mapRenderer.removeTile?.(tileKey);
      buildingsRenderer.removeTile?.(tileKey);
      clearTerrainStampsForTile(tileKey);
      boundsDirty = true;
      changedTileKeys.add(tileKey);
    }

    if (boundsDirty) {
      refreshRenderOriginFromBounds();
      rebuildGroundTilesForDirtyTerrainChunks();
    }
    const originChanged = !isSameRenderOrigin(currentRenderOrigin, lastRenderOrigin);
    if (originChanged) {
      for (const tileKey of desiredKeys) {
        const entry = tileCache.cache.get(tileKey);
        if (entry?.geojson) {
          changedTileKeys.add(tileKey);
        }
      }
    }

    const bounds = currentRenderOrigin;
    for (const tileKey of changedTileKeys) {
      const entry = tileCache.cache.get(tileKey);
      if (!entry?.geojson) continue;
      setTerrainStampsForTile(tileKey, entry.geojson, bounds);
      mapRenderer.updateTileHighways?.(tileKey, entry.geojson, bounds);
      buildingsRenderer.updateTileBuildings?.(tileKey, entry.geojson, bounds);
    }
    rebuildGroundTilesForDirtyTerrainChunks();

    const finishBuildingRender = () => {
      if (rebuildId !== mapRebuildToken) return;
      if (changedTileKeys.size === 0) return;
      scheduleBuildingRefresh();
      if (typeof natureController?.refreshTile === "function") {
        for (const tileKey of changedTileKeys) {
          natureController.refreshTile(tileKey);
        }
      } else {
        natureController?.refreshAll?.();
      }
    };

    if (typeof requestIdleCallback === "function") {
      requestIdleCallback(finishBuildingRender, { timeout: 200 });
    } else {
      finishBuildingRender();
    }
    lastRenderOrigin = bounds ?? null;
  }

  window.clearTileCache = () => {
    tileCache.cache.clear();
    groundTiles.clear();
    clearCache().catch((error) => console.warn('Failed to clear persistent tile cache:', error));
    rebuildMapFromCache();
  };

  const deferredTileUpdates = new Map();
  let deferredMapWorkHandle = null;
  let deferredMapWorkQueuedAt = 0;
  let deferredBuildingRefresh = false;

  const shouldDeferMapWork = () => {
    if (mapFetchInFlight.size > 0) return true;
    if (!Number.isFinite(lastFrameDurationMs) || lastFrameDurationMs <= 0) return false;
    return lastFrameDurationMs > MAP_FRAME_BUDGET_MS;
  };

  const scheduleDeferredMapWork = () => {
    if (deferredMapWorkHandle) return;
    if (!deferredMapWorkQueuedAt) {
      deferredMapWorkQueuedAt = performance.now();
    }
    const runDeferred = (deadline) => {
      deferredMapWorkHandle = null;
      const now = performance.now();
      const waitedMs = deferredMapWorkQueuedAt ? now - deferredMapWorkQueuedAt : 0;
      const canRun = !shouldDeferMapWork()
        || deadline?.didTimeout
        || waitedMs >= MAP_DEFER_MAX_WAIT_MS;
      if (!canRun) {
        scheduleDeferredMapWork();
        return;
      }
      deferredMapWorkQueuedAt = 0;
      const queuedUpdates = Array.from(deferredTileUpdates.entries());
      deferredTileUpdates.clear();
      for (const [tileKey, geojson] of queuedUpdates) {
        if (!tileCache.hasTile(tileKey)) {
          continue;
        }
        updateTileMeshes(tileKey, geojson, { force: true });
      }
      if (deferredBuildingRefresh) {
        deferredBuildingRefresh = false;
        scheduleBuildingRefresh({ force: true });
      }
    };
    if (typeof requestIdleCallback === "function") {
      deferredMapWorkHandle = requestIdleCallback(runDeferred, { timeout: MAP_DEFER_TIMEOUT_MS });
    } else {
      deferredMapWorkHandle = setTimeout(() => runDeferred({ didTimeout: true }), 0);
    }
  };

  const queueTileUpdate = (tileKey, geojson) => {
    deferredTileUpdates.set(tileKey, geojson);
    scheduleDeferredMapWork();
  };

  let buildingRefreshPending = false;
  const scheduleBuildingRefresh = ({ force = false } = {}) => {
    if (!force && shouldDeferMapWork()) {
      deferredBuildingRefresh = true;
      scheduleDeferredMapWork();
      return;
    }
    if (buildingRefreshPending) return;
    buildingRefreshPending = true;
    const refresh = () => {
      buildingRefreshPending = false;
      rebuildBuildingColliders();
    };
    if (typeof requestIdleCallback === "function") {
      requestIdleCallback(refresh, { timeout: 200 });
    } else {
      setTimeout(refresh, 0);
    }
  };

  const rebuildGroundTilesForDirtyTerrainChunks = () => {
    const dirtyChunks = consumeDirtyTerrainChunks();
    if (dirtyChunks.length === 0) return 0;
    return groundTiles?.rebuildTilesForChunks?.(dirtyChunks) ?? 0;
  };

  const updateTileMeshesImmediate = (tileKey, geojson) => {
    if (!tileKey || !geojson || !mapRenderer || !buildingsRenderer) return;
    const previousGeojson = renderedTileGeojson.get(tileKey);
    if (previousGeojson === geojson) return;
    renderedTileGeojson.set(tileKey, geojson);
    updateTileRenderBounds(tileKey, geojson);
    const bounds = refreshRenderOriginFromBounds();
    const originChanged = !isSameRenderOrigin(bounds, lastRenderOrigin);
    const tilesToUpdate = new Set();
    if (originChanged) {
      for (const [key, entry] of tileCache.cache.entries()) {
        if (entry?.geojson) {
          tilesToUpdate.add(key);
        }
      }
    } else {
      tilesToUpdate.add(tileKey);
    }

    for (const key of tilesToUpdate) {
      const entry = tileCache.cache.get(key);
      if (!entry?.geojson) continue;
      setTerrainStampsForTile(key, entry.geojson, bounds);
      mapRenderer.updateTileHighways?.(key, entry.geojson, bounds);
    }

    const finishBuildingRender = () => {
      if (tilesToUpdate.size === 0) return;
      for (const key of tilesToUpdate) {
        const entry = tileCache.cache.get(key);
        if (!entry?.geojson) continue;
        buildingsRenderer.updateTileBuildings?.(key, entry.geojson, bounds);
      }
      rebuildGroundTilesForDirtyTerrainChunks();
      scheduleBuildingRefresh();
      if (typeof natureController?.refreshTilesForCacheTile === "function") {
        for (const key of tilesToUpdate) {
          natureController.refreshTilesForCacheTile(key);
        }
      } else if (typeof natureController?.refreshTile === "function") {
        for (const key of tilesToUpdate) {
          natureController.refreshTile(key);
        }
      } else {
        natureController?.refreshAll?.();
      }
    };

    if (typeof requestIdleCallback === "function") {
      requestIdleCallback(finishBuildingRender, { timeout: 200 });
    } else {
      finishBuildingRender();
    }
    lastRenderOrigin = bounds ?? null;
  };

  const updateTileMeshes = (tileKey, geojson, { force = false } = {}) => {
    if (!tileKey || !geojson || !mapRenderer || !buildingsRenderer) return;
    if (!force && shouldDeferMapWork()) {
      queueTileUpdate(tileKey, geojson);
      return;
    }
    updateTileMeshesImmediate(tileKey, geojson);
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
        clearTerrainStampsForTile(key);
        renderedTileGeojson.delete(key);
        tileRenderBounds.delete(key);
        deferredTileUpdates.delete(key);
      }
      rebuildGroundTilesForDirtyTerrainChunks();
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
      const overpassData = await fetchOSMData(tileCenter.lat, tileCenter.lon, TILE_FETCH_RADIUS_METERS, {
        staleDistanceMeters: TILE_SIZE_METERS * 2
      });
      debugState.lastOsmFetchAt = Date.now();
      try {
        geojson = await parseOverpassData(overpassData);
      } catch (parseError) {
        console.warn('OSM worker parse failed, falling back to main thread:', parseError);
        geojson = prefilterGeojson(overpassToGeoJSON(overpassData));
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
    permissionDenied: false,
    originWasReset: false
  };

  const debugState = {
    lastError: null,
    lastOsmFetchAt: null
  };

  const locationProvider = createLocationProvider({
    onUpdate: (location) => {
      window.latestLocation = location;
      friendlyNpcManager?.recordGpsTravel?.({
        lat: location.lat,
        lon: location.lon,
        accuracyMeters: location.accuracyMeters,
        timestampMs: location.timestamp
      });
      if (!homeSystem?.isInsideHome) {
        playerControls?.setGeoCenter({ lat: location.lat, lon: location.lon });
      }
      if (!worldOrigin && Number.isFinite(location.accuracyMeters) && location.accuracyMeters <= 50) {
        setWorldOrigin({ lat: location.lat, lon: location.lon });
        rebuildMapFromCache();
      }
      const withinOriginResetWindow = Date.now() - appStartedAtMs <= ORIGIN_RESET_WINDOW_MS;
      const canEvaluateOriginReset = !originWasAutoReset
        && withinOriginResetWindow
        && worldOrigin
        && Number.isFinite(location.accuracyMeters)
        && location.accuracyMeters <= ORIGIN_RESET_MAX_ACCURACY_METERS;
      if (canEvaluateOriginReset) {
        const originDeltaMeters = distanceMeters(worldOrigin.lat, worldOrigin.lon, location.lat, location.lon);
        if (Number.isFinite(originDeltaMeters) && originDeltaMeters >= ORIGIN_RESET_JUMP_DISTANCE_METERS) {
          setWorldOrigin({ lat: location.lat, lon: location.lon });
          rebuildMapFromCache();
          didInitialGpsSnap = false;
          originWasAutoReset = true;
        }
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
      locationState.originWasReset = originWasAutoReset;
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
                const outsideGeoBounds = playerControls.isOutsideGeoBounds?.(currentPos) ?? true;
                const closestWithinBounds = outsideGeoBounds
                  ? getClosestPointWithinGeoBounds(currentPos)
                  : null;
                const gpsTarget = {
                  x: playerMeters.x,
                  y: currentPos.y ?? playerModel.position.y,
                  z: playerMeters.z
                };
                const moveTarget = closestWithinBounds ?? gpsTarget;
                const blocked = isGpsPathBlocked(currentPos, moveTarget);
                if (blocked) {
                  playerControls.clearGpsMoveTarget?.();
                } else {
                  playerControls.setGpsMoveTarget?.(moveTarget);
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
    setStat('health', statsState.maxHealthSegments);
    setStat('hunger', statsState.maxHungerSegments);
    setStat('magic', statsState.maxMagicSegments);
    const spawn = getSpawnPosition({ allowOnBuildings: true });
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

  const showVoiceTranscript = (text) => {
    if (!voiceTranscript) return;
    voiceTranscript.textContent = text;
    voiceTranscript.classList.add('visible');
    if (voiceMicState.transcriptTimer) {
      clearTimeout(voiceMicState.transcriptTimer);
    }
    voiceMicState.transcriptTimer = setTimeout(() => {
      voiceTranscript.classList.remove('visible');
    }, 2500);
  };

  const voiceSpellDefs = {
    apples: { magicCost: 4 },
    mushrooms: { magicCost: 4 },
    bombs: { magicCost: 9 },
    freeze: { magicCost: 2 }
  };

  const getVoiceSpellFromTranscript = (transcript) => {
    const normalized = String(transcript || '').trim().toLowerCase();
    if (!normalized) return null;
    if (normalized.includes('apple')) return 'apples';
    if (normalized.includes('mushroom')) return 'mushrooms';
    if (normalized.includes('bomb')) return 'bombs';
    if (normalized.includes('freeze')) return 'freeze';
    return null;
  };

  const castVoiceSpellFromTranscript = (transcript) => {
    const spellId = getVoiceSpellFromTranscript(transcript);
    if (!spellId || !playerControls || !playerModel) return false;

    const spellDef = voiceSpellDefs[spellId];
    const currentMagic = Number.isFinite(statsState.magic) ? statsState.magic : 0;
    if (currentMagic < spellDef.magicCost) {
      showVoiceTranscript('Not enough magic for that spell.');
      return false;
    }

    // Use the same camera-relative direction convention as bomb throwing.
    const aimDirection = playerControls.getAimDirection(true);
    playerControls.alignPlayerToDirection(aimDirection);
    playerControls.playAction('projectile');

    const origin = playerControls.getProjectileSpawnPosition(aimDirection);
    const sprinkleDirection = () => {
      const d = aimDirection.clone();
      d.x += (Math.random() - 0.5) * 0.25;
      d.y += (Math.random() - 0.5) * 0.15;
      d.z += (Math.random() - 0.5) * 0.25;
      return d.normalize();
    };

    const createAppleProjectileMesh = () => {
      const source = applePickups.find(entry => entry?.mesh)?.mesh;
      if (!source) return null;
      const mesh = source.clone(true);
      mesh.visible = true;
      mesh.traverse((child) => {
        if (!child.isMesh) return;
        child.castShadow = true;
        child.receiveShadow = true;
      });
      return mesh;
    };

    const createMushroomProjectileMesh = (itemId) => {
      const mesh = mushroomController?.createProjectileMesh?.(itemId);
      if (!mesh) return null;
      mesh.visible = true;
      return mesh;
    };

    const launchProduceProjectile = ({ direction, spawnPickup, createMesh, color = 0xd9d9d9 }) => {
      const shooterId = multiplayer?.getId?.();
      spawnProjectile(scene, projectiles, origin.clone(), direction, shooterId, {
        color,
        createMesh,
        speed: BOMB_THROW_SPEED * 0.45,
        lifetime: Math.floor(BOMB_THROW_LIFETIME * 0.75),
        pickupOnRest: true,
        pickupAmount: 1,
        spawnPickup,
        colliderDesc: RAPIER.ColliderDesc.ball(0.11).setRestitution(0.25).setFriction(0.8)
      });
    };

    if (spellId === 'apples') {
      for (let i = 0; i < 10; i++) {
        const d = sprinkleDirection();
        launchProduceProjectile({
          direction: d,
          color: 0xd14b33,
          createMesh: createAppleProjectileMesh,
          spawnPickup: (pickupPosition) => {
            spawnApplePickup(pickupPosition);
          }
        });
      }
    } else if (spellId === 'mushrooms') {
      for (let i = 0; i < 10; i++) {
        const entry = MUSHROOM_ENTRIES[Math.floor(Math.random() * MUSHROOM_ENTRIES.length)];
        if (!entry?.id) continue;
        const d = sprinkleDirection();
        launchProduceProjectile({
          direction: d,
          color: 0x8f6ad9,
          createMesh: () => createMushroomProjectileMesh(entry.id),
          spawnPickup: (pickupPosition) => {
            spawnMushroomPickup(entry.id, pickupPosition);
          }
        });
      }
    } else if (spellId === 'bombs') {
      const shooterId = multiplayer?.getId?.();
      for (let i = 0; i < 5; i++) {
        const d = sprinkleDirection();
        spawnBombProjectileWithPerfFlags(scene, projectiles, origin.clone(), d, shooterId);
      }
    } else if (spellId === 'freeze') {
      const shooterId = multiplayer?.getId?.();
      for (let i = 0; i < 3; i++) {
        const d = sprinkleDirection();
        spawnIceMist(scene, iceMists, origin.clone(), d, shooterId);
      }
    }

    setStat('magic', Math.max(0, currentMagic - spellDef.magicCost));
    return true;
  };

  function getVoiceMicState() {
    const remainingMs = Math.max(0, voiceMicState.cooldownUntil - Date.now());
    return {
      disabled: voiceMicState.listening || remainingMs > 0,
      remainingSeconds: remainingMs > 0 ? Math.ceil(remainingMs / 1000) : 0
    };
  }

  const stopVoiceListening = () => {
    if (!voiceMicState.listening) return;
    voiceMicState.listening = false;
    speech.stop();

    const finalizeTranscript = (text) => {
      if (!text) return;
      showVoiceTranscript(text);
      castVoiceSpellFromTranscript(text);
    };

    if (voiceMicState.lastTranscript) {
      finalizeTranscript(voiceMicState.lastTranscript);
    } else {
      voiceMicState.pendingSpellResolution = true;
      if (voiceMicState.pendingSpellTimeout) {
        clearTimeout(voiceMicState.pendingSpellTimeout);
      }
      voiceMicState.pendingSpellTimeout = setTimeout(() => {
        voiceMicState.pendingSpellResolution = false;
      }, 1200);
    }

    voiceMicState.cooldownUntil = Date.now() + VOICE_COOLDOWN_MS;
    playerControls?.refreshActionButtons?.();
  };

  const startVoiceListening = () => {
    const state = getVoiceMicState();
    if (state.disabled) return false;
    voiceMicState.lastTranscript = '';
    voiceMicState.pendingSpellResolution = false;
    if (voiceMicState.pendingSpellTimeout) {
      clearTimeout(voiceMicState.pendingSpellTimeout);
      voiceMicState.pendingSpellTimeout = null;
    }
    voiceMicState.listening = true;
    speech.start();
    playerControls?.refreshActionButtons?.();
    return true;
  };

  // Initialize speech-to-text overlay for voice input
  const speech = initSpeechCommands({
    onTranscript: (text) => {
      voiceMicState.lastTranscript = text;
      if (voiceMicState.pendingSpellResolution) {
        voiceMicState.pendingSpellResolution = false;
        if (voiceMicState.pendingSpellTimeout) {
          clearTimeout(voiceMicState.pendingSpellTimeout);
          voiceMicState.pendingSpellTimeout = null;
        }
        showVoiceTranscript(text);
        castVoiceSpellFromTranscript(text);
      } else if (!voiceMicState.listening) {
        showVoiceTranscript(text);
      }
    }
  });

  setInterval(() => {
    playerControls?.refreshActionButtons?.();
  }, 250);


  function swapPlayerCharacter(newModelPath) {
    if (!newModelPath) {
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
    void initMapViewFeature({ camera, scene, player: playerModel });
  }

  const settingsBtn = document.getElementById('settings-button');
  const inventoryBtn = document.getElementById('inventory-button');
  const characterOptions = ['base_character_2', 'cowboy', 'Chimpanzee', 'seagull'].map(name => ({
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
      getEquippedInventoryItemIds().forEach((equippedItemId) => {
        unequipInventoryItem(equippedItemId);
      });
      swapPlayerCharacter(modelPath);
      characterModel = modelPath;
      playerProfile = playerProfile || {};
      playerProfile.characterModel = modelPath;
      if (profileNameKey) {
        void saveCharacterModel(profileNameKey, modelPath);
      }
    },
    getPlayerStats: () => ({ ...statsState }),
    getQuestLog: () => window.questManager?.getQuestLog?.() || [],
    getAchievements: () => getAchievementView(achievementState),
    claimAchievementReward: (achievementId) => {
      const claimed = claimAchievement(achievementState, achievementId);
      if (!claimed) return { status: 'unavailable' };
      const grants = applyAchievementRewards(claimed.rewards);
      persistAchievementProgress();
      updateSettingsUI();
      return { status: 'ok', achievement: claimed, grants };
    },
    getCoins: () => (Number.isFinite(statsState.coins) ? statsState.coins : 0),
    addCoins: (delta) => {
      const safeDelta = Number.isFinite(delta) ? delta : 0;
      if (safeDelta === 0) return;
      const current = Number.isFinite(statsState.coins) ? statsState.coins : 0;
      const nextCoins = current + safeDelta;
      setStat('coins', nextCoins, { skipSave: true });
      showCoinPopup(statsState.coins);
    },
    getCharacterOptions: () => characterOptions,
    getInventory: () => getInventory(),
    getIceAmmoCount: () => getIceAmmoCount(),
    getArrowAmmoCount: () => getArrowAmmoCount(),
    addIceAmmo: (amount) => addIceAmmo(amount),
    addArrowAmmo: (amount) => addArrowAmmo(amount),
    getHomeStorage: () => getHomeStorage(),
    getEquippedInventoryItemId: () => getEquippedInventoryItemId(),
    getEquippedInventoryItemIds: () => getEquippedInventoryItemIds(),
    isInventoryItemEquipped: (itemId) => isInventoryItemEquipped(itemId),
    getInventoryItemActions: (itemId) => getInventoryItemActions(itemId),
    equipInventoryItem: (itemId) => equipInventoryItem(itemId),
    unequipInventoryItem: (itemId) => unequipInventoryItem(itemId),
    dropInventoryItem: (itemId) => dropInventoryItem(itemId),
    eatInventoryItem: (itemId) => eatInventoryItem(itemId),
    useInventoryItem: (itemId) => useInventoryItem(itemId),
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
    getTerrainStampDebugSample: (x, z, options) => getTerrainStampDebugSample(x, z, options),
    setTerrainStampDebugOverlay: (enabled, options = {}) => {
      terrainStampDebugOverlay?.setOptions?.(options);
      terrainStampDebugOverlay?.setEnabled?.(enabled);
      return terrainStampDebugOverlay?.getState?.() ?? null;
    },
    getTerrainStampDebugOverlayState: () => terrainStampDebugOverlay?.getState?.() ?? null,
    loadTerrainStampRegressionScene: () => {
      locationProvider.setDebugLocation(TERRAIN_STAMP_REGRESSION_SCENE.location);
      locationProvider.setDebugAccuracy(5);
      locationProvider.setDebugEnabled(true);
      terrainStampDebugOverlay?.setOptions?.({ showHeatmap: true });
      terrainStampDebugOverlay?.setEnabled?.(true);
      return { ...TERRAIN_STAMP_REGRESSION_SCENE, debugLocationEnabled: true };
    },
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
    clearHomeLocation: async () => {
      if (!homeSystem?.clearHomeSelection) {
        return { status: 'unavailable' };
      }
      const result = await homeSystem.clearHomeSelection();
      if (playerProfile) {
        playerProfile.home = null;
      }
      return result;
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

  runtimeContext.uiState.appState = appState;
  window.appState = appState;
  window.getInventory = getInventory;
  window.addToInventory = addToInventory;
  window.removeFromInventory = removeFromInventory;
  window.openHomeStorage = openHomeStorage;
  window.openCraftPanel = () => void openCraftPanelFeature();
  window.craftTableActions = {
    placeMaterials: placeCraftMaterials,
    cancelCrafting,
    craftItem
  };
  window.pickupMushroom = pickupMushroom;
  window.pickupApple = pickupApple;
  window.pickupWood = pickupWood;
  window.pickupMeat = pickupMeat;
  window.pickupSalt = pickupSalt;
  window.pickupZombieBrains = pickupZombieBrains;
  window.loadTerrainStampRegressionScene = () => appState.loadTerrainStampRegressionScene();
  window.setTerrainStampDebugOverlay = (enabled, options) => appState.setTerrainStampDebugOverlay(enabled, options);
  window.getTerrainStampDebugSample = (x, z, options) => appState.getTerrainStampDebugSample(x, z, options);

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
  await initCustomizeUIFeature({
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
  await initMerchantPanelFeature({ appState });
  await initCraftPanelFeature({ appState });
  void initMerchantFeature({
    scene,
    attachPhysics: attachMonsterPhysics,
    getTerrainHeight,
    liftPositionToBuildingTop,
    appState,
    roomId: multiplayer?.roomId,
    isHost
  });

  settingsBtn.addEventListener('click', () => {
    openSettings();
  });
  inventoryBtn?.addEventListener('click', () => {
    openInventory();
  });

  const settingsOverlay = document.getElementById('settings-overlay');
  const inventoryOverlay = document.getElementById('inventory-overlay');
  const homeStorageOverlay = document.getElementById('home-storage-overlay');
  const merchantOverlay = document.getElementById('merchant-overlay');
  const craftOverlay = document.getElementById('craft-overlay');
  const isOverlayVisible = (overlay) => overlay?.getAttribute('aria-hidden') === 'false';

  setInterval(() => {
    if (isOverlayVisible(settingsOverlay)) {
      updateSettingsUI();
    }
    if (isOverlayVisible(inventoryOverlay)) {
      updateSettingsUI();
    }
    if (isOverlayVisible(homeStorageOverlay)) {
      updateHomeStorageUI();
    }
    if (isOverlayVisible(merchantOverlay)) {
      void updateMerchantUIFeature();
    }
    if (isOverlayVisible(craftOverlay)) {
      void updateCraftUIFeature();
    }
  }, 1000);
  updateAutoDisplayMode();
  setInterval(() => {
    updateAutoDisplayMode();
  }, 60 * 1000);

  const consoleDiv = document.getElementById("console-log");
  if (runtimeContext.debugFlags.DEBUG_CONSOLE === true) {
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

  const getMeshWorldBounds = (mesh) => {
    const geometry = mesh.geometry;
    const userData = mesh.userData ?? {};
    mesh.userData = userData;
    if (!userData.boundsState) {
      userData.boundsState = {
        worldBox: new THREE.Box3(),
        tempBox: new THREE.Box3(),
        lastPosition: new THREE.Vector3(),
        lastQuaternion: new THREE.Quaternion()
      };
      userData.boundsDirty = true;
    }
    const { boundsState } = userData;
    if (userData.boundsHasSkinned == null) {
      let hasSkinned = false;
      mesh.traverse((child) => {
        if (child.isSkinnedMesh) {
          hasSkinned = true;
        }
      });
      userData.boundsHasSkinned = hasSkinned;
    }
    const hasMoved = !boundsState.lastPosition.equals(mesh.position)
      || !boundsState.lastQuaternion.equals(mesh.quaternion);
    if (hasMoved) {
      userData.boundsDirty = true;
    }
    if (!userData.boundsDirty && !userData.boundsAlwaysDirty && !userData.boundsHasSkinned) {
      return boundsState.worldBox;
    }
    if (userData.boundsHasSkinned) {
      mesh.updateMatrixWorld(true);
      boundsState.worldBox.setFromObject(mesh);
      boundsState.lastPosition.copy(mesh.position);
      boundsState.lastQuaternion.copy(mesh.quaternion);
      userData.boundsDirty = false;
      return boundsState.worldBox;
    }
    if (geometry && !geometry.boundingBox && typeof geometry.computeBoundingBox === 'function') {
      geometry.computeBoundingBox();
    }
    if (!geometry || !geometry.boundingBox) {
      if (!mesh.isGroup && !mesh.isLOD && !mesh.isObject3D) {
        return null;
      }
      mesh.updateMatrixWorld(true);
      let hasChildBounds = false;
      boundsState.worldBox.makeEmpty();
      mesh.traverse((child) => {
        if (!child.isMesh || !child.geometry) {
          return;
        }
        if (!child.geometry.boundingBox && typeof child.geometry.computeBoundingBox === 'function') {
          child.geometry.computeBoundingBox();
        }
        if (!child.geometry.boundingBox) {
          return;
        }
        boundsState.tempBox.copy(child.geometry.boundingBox).applyMatrix4(child.matrixWorld);
        boundsState.worldBox.union(boundsState.tempBox);
        hasChildBounds = true;
      });
      if (!hasChildBounds) {
        boundsState.worldBox.setFromObject(mesh);
      }
    } else {
      mesh.updateMatrixWorld();
      boundsState.worldBox.copy(geometry.boundingBox).applyMatrix4(mesh.matrixWorld);
    }
    boundsState.lastPosition.copy(mesh.position);
    boundsState.lastQuaternion.copy(mesh.quaternion);
    userData.boundsDirty = false;
    return boundsState.worldBox;
  };

  const handleBombPickupArrowHit = () => {
    if (!bomb?.mesh || bomb.holder || !bomb.mesh.visible) return;
    const bombBounds = getMeshWorldBounds(bomb.mesh);
    if (!bombBounds) return;
    for (let i = projectiles.length - 1; i >= 0; i -= 1) {
      const projectile = projectiles[i];
      if (!projectile?.userData?.isArrow) continue;
      const projectileBounds = getMeshWorldBounds(projectile);
      if (!projectileBounds) continue;
      if (!projectileBounds.intersectsBox(bombBounds)) continue;
      const hitPosition = bomb.mesh.position.clone();
      spawnBombMist(scene, bombMists, hitPosition);
      applyBombImpactDamage(hitPosition, projectile.userData?.shooterId);
      bomb.mesh.visible = false;
      bomb.holder = null;
      bomb.localHoldOrigin = null;
      sendImmediateEntityControl('bomb');
      audioManager?.playSFX('SFX/Attacks/Bow Attacks Hits and Blocks/Bow Blocked 1.ogg', 0.58, { cooldownKey: 'bow-blocked', cooldownMs: 60 });
      removeProjectileAt(projectiles, i);
      break;
    }
  };

  function animate() {
    requestAnimationFrame(animate);

    // --- RAPIER FIXED-STEP & SYNC ---
    // Accumulate variable rAF time into fixed physics steps
    const frameDelta = clock.getDelta();
    lastFrameDurationMs = frameDelta * 1000;
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
    syncCraftTableCollider();

    // Sync Rapier bodies -> Three meshes
    const resolveGroundY = playerControls?.resolveGroundY?.bind(playerControls);
    for (const [rb, mesh] of rbToMesh.entries()) {
      {
        const t = rb.translation();
        mesh.position.set(t.x, t.y, t.z);
      }
      {
        const r = rb.rotation();
        mesh.quaternion.set(r.x, r.y, r.z, r.w);
      }

      const isStaticBody = typeof rb.isFixed === 'function' && rb.isFixed();
      if (!mesh.userData?.isTerrain && !mesh.userData?.skipTerrainCorrection && !isStaticBody) {
        const bbox = getMeshWorldBounds(mesh);
        if (bbox) {
          let excludedColliderHandles = null;
          if (typeof rb.numColliders === 'function' && typeof rb.collider === 'function') {
            excludedColliderHandles = [];
            const colliderCount = rb.numColliders();
            for (let i = 0; i < colliderCount; i += 1) {
              const collider = rb.collider(i);
              if (typeof collider?.handle === 'number') {
                excludedColliderHandles.push(collider.handle);
              }
            }
          }
          const groundResolution = resolveGroundY
            ? resolveGroundY(mesh.position.x, Math.max(mesh.position.y, bbox.max.y + 0.05), mesh.position.z, {
              excludedColliderHandles
            })
            : null;
          const resolvedGroundY = groundResolution?.groundY ?? getTerrainHeight(mesh.position.x, mesh.position.z);
          const isDeadEntity = mesh.userData?.mode === 'dead';
          const belowResolvedGround = Number.isFinite(resolvedGroundY) && bbox.min.y < resolvedGroundY - 0.01;
          const shouldSnapToGround = isDeadEntity ? belowResolvedGround : belowResolvedGround;
          if (shouldSnapToGround) {
            const correction = resolvedGroundY - bbox.min.y;
            mesh.position.y += correction;
            rb.setTranslation({ x: mesh.position.x, y: mesh.position.y, z: mesh.position.z }, true);
            let shouldClampDownwardVelocity = false;
            let clampVelocityX = 0;
            let clampVelocityZ = 0;
            {
              const lv = rb.linvel();
              shouldClampDownwardVelocity = lv.y < 0;
              clampVelocityX = lv.x;
              clampVelocityZ = lv.z;
            }
            if (shouldClampDownwardVelocity) {
              rb.setLinvel({ x: clampVelocityX, y: 0, z: clampVelocityZ }, true);
            }
          }
        }
      }

      // Simple cleanup: remove if it falls far below the world
      if (mesh.position.y < -50) {
        disposeSceneObject(mesh);
        rbToMesh.delete(rb);
        removeRigidBodySafely(rapierWorld, rb);
      }
    }



    const playerPosition = playerModel?.position;
    homeSystem?.syncHomePlacement?.();
    updateGroundTiles(playerPosition);
    natureController?.update(playerPosition);
    if (shouldUpdatePickupTiles(playerPosition)) {
      updatePickupTiles(playerPosition);
    }

    if (!mapViewEnabled) {
      playerControls.update();
      if (playerControls?.isClimbing && !climbedSinceGrounded) {
        climbedSinceGrounded = true;
        notifyAchievementProgress('treesClimbed', 1);
      }
      if (!playerControls?.isClimbing) {
        climbedSinceGrounded = false;
      }
    }
    if (craftState.swirl?.line) {
      craftState.swirl.line.rotation.y += frameDelta * 2;
    }
    const homePosition = homeSystem?.getHomeLocalPosition?.();
    const homeEnterDistance = homeSystem?.getHomeEnterDistance?.();
    const mapMerchantFriendly = getMerchantFriendlyFeature();
    const mapTreasureChests = treasureChest?.mesh?.visible ? [treasureChest.mesh] : [];
    const mapMerchants = mapMerchantFriendly?.model ? [mapMerchantFriendly.model] : [];
    if (mapViewEnabled || isMapViewTransitionActiveFeature()) {
      void updateMapViewFeature(frameDelta, {
        monsters,
        animals,
        friendlies: friendlyNpcManager?.friendlies,
        weapons: droppedWeaponPickups,
        ammoItems: ammoPickups,
        woodItems: woodPickups,
        treasureChests: mapTreasureChests,
        merchants: mapMerchants,
        otherPlayers,
        homePosition,
        homeEnterDistance
      });
    }

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
      const isSleeping = playerControls?.isSleeping;

      if (isSleeping) {
        const recovery = SLEEP_RECOVERY_PER_SECOND * elapsedSeconds;
        if (recovery > 0) {
          hungerRecoveryRemainder += recovery;
          const segments = Math.floor(hungerRecoveryRemainder);
          if (segments > 0) {
            setStat('hunger', statsState.hunger + segments, { skipSave: true });
            hungerRecoveryRemainder -= segments;
            statsChanged = true;
          }
        }
        const healthRecovery = SLEEP_RECOVERY_SEGMENTS_PER_SECOND * elapsedSeconds;
        if (healthRecovery > 0) {
          healthRecoveryRemainder += healthRecovery;
          const segments = Math.floor(healthRecoveryRemainder);
          if (segments > 0) {
            setStat('health', statsState.health + segments, { skipSave: true });
            healthRecoveryRemainder -= segments;
            statsChanged = true;
          }
        }
      } else {
        if (statsState.hunger > 0) {
          const hungerDecay = HUNGER_DECAY_PER_HOUR * (elapsedSeconds / 3600);
          if (hungerDecay > 0) {
            hungerDecayRemainder += hungerDecay;
            const segments = Math.floor(hungerDecayRemainder);
            if (segments > 0) {
              setStat('hunger', statsState.hunger - segments, { skipSave: true });
              hungerDecayRemainder -= segments;
              statsChanged = true;
            }
          }
        }

        const isMoving = playerControls?.isMoving;
        if (isMoving && statsState.hunger > 0) {
          const energyDecay = ENERGY_DECAY_PER_SECOND_WHILE_MOVING * elapsedSeconds;
          if (energyDecay > 0) {
            movementHungerDecayRemainder += energyDecay;
            const segments = Math.floor(movementHungerDecayRemainder);
            if (segments > 0) {
              setStat('hunger', statsState.hunger - segments, { skipSave: true });
              movementHungerDecayRemainder -= segments;
              statsChanged = true;
            }
          }
        }

        if (statsState.hunger <= 0 && statsState.health > 0) {
          const healthDecay = HUNGER_HEALTH_DECAY_SEGMENTS_PER_SECOND * elapsedSeconds;
          if (healthDecay > 0) {
            healthDecayRemainder += healthDecay;
            const segments = Math.floor(healthDecayRemainder);
            if (segments > 0) {
              setStat('health', statsState.health - segments, { skipSave: true });
              healthDecayRemainder -= segments;
              statsChanged = true;
            }
          }
        }
      }

      if (statsChanged) {
        lastStatUpdateAt = Date.now();
        saveStatsThrottled(profileNameKey, statsState, lastStatUpdateAt);
      }
    }
    if (torch?.holder === playerControls) {
      const entry = inventoryState[TORCH_ITEM_ID];
      const healths = getTorchHealths(entry);
      if (!healths.length) {
        equippedTorchIndex = null;
        unequipInventoryItem(TORCH_ITEM_ID);
      } else {
        if (!Number.isInteger(equippedTorchIndex) || equippedTorchIndex >= healths.length) {
          equippedTorchIndex = healths.findIndex(health => health > 0);
        }
        if (equippedTorchIndex < 0) {
          equippedTorchIndex = null;
          applyTorchHealths(inventoryState, entry, []);
          unequipInventoryItem(TORCH_ITEM_ID);
        } else {
          const currentHealth = healths[equippedTorchIndex];
          const nextHealth = Math.max(0, currentHealth - TORCH_HEALTH_DECAY_PER_SECOND * frameDelta);
          if (nextHealth <= 0) {
            healths.splice(equippedTorchIndex, 1);
            equippedTorchIndex = null;
            applyTorchHealths(inventoryState, entry, healths);
            torch.mesh.userData.torchHealth = 0;
            unequipInventoryItem(TORCH_ITEM_ID);
            persistInventoryAndStorage();
            torchHealthDirty = false;
            lastTorchHealthSaveAt = now;
          } else if (nextHealth !== currentHealth) {
            healths[equippedTorchIndex] = nextHealth;
            applyTorchHealths(inventoryState, entry, healths);
            torch.mesh.userData.torchHealth = nextHealth;
            torchHealthDirty = true;
          }
        }
      }
    }
    if (torchHealthDirty && now - lastTorchHealthSaveAt >= 1000) {
      persistInventoryAndStorage();
      torchHealthDirty = false;
      lastTorchHealthSaveAt = now;
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
      droppedWorldPickups.forEach((entry, id) => {
        removeDroppedWorldPickup(id);
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
      for (let i = zombieBrainsPickups.length - 1; i >= 0; i--) {
        const pickup = zombieBrainsPickups[i];
        if (!pickup?.mesh) continue;
        disposeWoodPickup(pickup);
        zombieBrainsPickups.splice(i, 1);
      }
      for (let i = mushroomPickups.length - 1; i >= 0; i--) {
        const pickup = mushroomPickups[i];
        if (!pickup) continue;
        disposeMushroomPickup(pickup);
        mushroomPickupGrid.remove(pickup);
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
        if (!pickup?.active) {
          mushroomPickupGrid.remove(pickup);
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
      for (let i = woodPickups.length - 1; i >= 0; i--) {
        const pickup = woodPickups[i];
        if (!pickup?.mesh) {
          woodPickups.splice(i, 1);
        }
      }
      for (let i = meatPickups.length - 1; i >= 0; i--) {
        const pickup = meatPickups[i];
        if (!pickup?.mesh) {
          meatPickups.splice(i, 1);
        }
      }
      for (let i = zombieBrainsPickups.length - 1; i >= 0; i--) {
        const pickup = zombieBrainsPickups[i];
        if (!pickup?.mesh) {
          zombieBrainsPickups.splice(i, 1);
          continue;
        }
        pickup.mesh.rotation.y += 0.02;
      }
      for (let i = saltPickups.length - 1; i >= 0; i--) {
        const pickup = saltPickups[i];
        if (!pickup?.mesh) {
          saltPickups.splice(i, 1);
          continue;
        }
        pickup.mesh.rotation.y += 0.028;
        if (pickup.mesh.userData.baseY === undefined) {
          pickup.mesh.userData.baseY = pickup.mesh.position.y;
        }
        const phase = pickup.mesh.userData.phase ?? 0;
        pickup.mesh.position.y = pickup.mesh.userData.baseY + Math.sin(pickupTime + phase) * 0.08;
      }
    }

    iceGun?.update();
    bow?.update();
    bomb?.update();
    autumnSword?.update();
    lantern?.update();
    torch?.update();
    syncRemoteHeldWeaponMesh(iceGun);
    syncRemoteHeldWeaponMesh(bow);
    syncRemoteHeldWeaponMesh(bomb);
    syncRemoteHeldWeaponMesh(autumnSword);
    syncRemoteHeldWeaponMesh(lantern);
    syncRemoteHeldWeaponMesh(torch);
    if (bowHeldArrow) {
      const shouldShowArrow = bow?.holder === playerControls && playerControls?.isFireHeld;
      bowHeldArrow.visible = shouldShowArrow;
    }
    updateWeaponMarker(iceGun, iceGunMarker, 0.03);
    updateWeaponMarker(bow, bowMarker, 0.03);
    updateWeaponMarker(bomb, bombMarker, 0.03);
    updateWeaponMarker(autumnSword, autumnSwordMarker, 0.03);
    updateWeaponMarker(lantern, lanternMarker, 0.03);
    updateWeaponMarker(torch, torchMarker, 0.03);
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

    camera.updateMatrixWorld();
    monsterAnimProjMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    monsterAnimFrustum.setFromProjectionMatrix(monsterAnimProjMatrix);

    for (const monster of monsters) {
      const model = monster?.model;
      const mixer = model?.userData?.mixer;
      if (!mixer || !model) continue;

      const mode = model.userData?.mode;
      const distanceToCamera = camera.position.distanceTo(model.position);
      const isVisible = monsterAnimFrustum.containsPoint(model.position);
      const isActiveOrNear = mode !== 'friendly' || distanceToCamera <= MONSTER_COMBAT_RADIUS;

      if (isActiveOrNear) {
        mixer.update(mixerDelta);
        monster.lastAnimUpdateMs = now;
        continue;
      }

      const isMidDistance = distanceToCamera <= MONSTER_BACKGROUND_RADIUS && isVisible;
      if (!isMidDistance) {
        continue;
      }

      const lastAnimUpdateMs = Number.isFinite(monster.lastAnimUpdateMs) ? monster.lastAnimUpdateMs : 0;
      if (lastAnimUpdateMs > 0 && now - lastAnimUpdateMs < MONSTER_ANIM_MID_INTERVAL_MS) {
        continue;
      }

      const deltaSeconds = lastAnimUpdateMs > 0
        ? (now - lastAnimUpdateMs) / 1000
        : mixerDelta;
      mixer.update(deltaSeconds);
      monster.lastAnimUpdateMs = now;
    }
    for (const animal of animals) {
      animal?.model?.userData?.mixer?.update(mixerDelta);
    }

    // 2) AI can still be throttled, but pass a real delta when you DO run it
    const aiNowMs = Date.now();
    const isHostNow = !multiplayer || multiplayer.isHost;
    let removedDeadMonsters = false;
    monsters = monsters.filter(monster => {
      if (!monster?.model) return true;
      if (!monster.shouldRemoveAfterDeath?.(aiNowMs)) return true;
      if (isHostNow && monster.isDead && !monster.hasDroppedConfiguredDrops) {
        spawnMonsterDrops(monster);
        monster.hasDroppedConfiguredDrops = true;
      }
      cleanupMonster(monster);
      if (isHostNow && monster.id) {
        removeMonsterRecord(monster.id);
      }
      removedDeadMonsters = true;
      return false;
    });
    if (removedDeadMonsters) {
      runtimeContext.entities.monsters = monsters;
  window.monsters = monsters;
    }
    if (animalManager) {
      animalManager.update(mixerDelta);
      animals = animalManager.getAnimals();
      runtimeContext.entities.animals = animals;
  window.animals = animals;
    }

    if (isHostNow) {
      if (monstersSeeded) {
        const livingMonsters = monsters.filter(monster => monster?.model && !monster.isDead);
        const activePlayers = [
          { id: 'local', model: playerModel },
          ...Object.entries(otherPlayers).map(([id, p]) => ({ id, model: p?.model }))
        ].filter((entry) => entry.model);
        const friendlyAvoidanceZones = [];
        const merchantFriendly = getMerchantFriendlyFeature();
        if (merchantFriendly?.model?.position) {
          friendlyAvoidanceZones.push(merchantFriendly.model.position.clone());
        }
        const roomFriendlies = friendlyNpcManager?.friendlies || [];
        roomFriendlies.forEach((friendly) => {
          if (friendly?.isDead || !friendly?.model?.position) return;
          friendlyAvoidanceZones.push(friendly.model.position.clone());
        });

        let activeMonsterCount = 0;
        monsters.forEach(monster => {
          if (!monster || !monster.model) return;

          if (monster.isDead) return; // your respawn logic here...

          let nearestPlayerDistance = Infinity;
          for (const player of activePlayers) {
            const dist = monster.model.position.distanceTo(player.model.position);
            if (dist < nearestPlayerDistance) {
              nearestPlayerDistance = dist;
            }
          }

          const withinCombatRadius = nearestPlayerDistance <= MONSTER_COMBAT_RADIUS;
          const withinBackgroundRadius = nearestPlayerDistance <= MONSTER_BACKGROUND_RADIUS;

          let monsterTier = 'dormant';
          if (withinCombatRadius && activeMonsterCount < MAX_MONSTERS_ACTIVE) {
            monsterTier = 'active';
            activeMonsterCount += 1;
          } else if (withinBackgroundRadius) {
            monsterTier = 'background';
          }

          const previousTier = monster.activityTier;
          monster.activityTier = monsterTier;
          monster.model.visible = monsterTier !== 'dormant';

          if (monsterTier === 'active') {
            setMonsterPhysicsMode(monster, 'dynamic');
          } else if (monsterTier === 'background') {
            setMonsterPhysicsMode(monster, 'kinematic');
          } else {
            detachMonsterPhysics(monster);
          }

          const aiContext = {
            enableFriendlyDrift: true,
            friendlyAvoidanceZones,
            resolveGroundY,
            walkableSlopeDegrees: 42,
            groundOffset: 0.9 * (Number.isFinite(monster.sizeScale) ? monster.sizeScale : 1)
          };
          const MAX_AI_DELTA_SECONDS = 0.5;

          if (monsterTier === 'active') {
            monster.syncBodyFromTransform?.({ zeroVelocity: false });
            if (PERF.throttleAI) {
              const lastAIUpdateMs = monster.lastAIUpdateMs ?? 0;
              if (aiNowMs - lastAIUpdateMs > 150) {
                const elapsedAiSeconds = Math.max(0, (aiNowMs - lastAIUpdateMs) / 1000);
                const aiDeltaSeconds = Math.min(
                  MAX_AI_DELTA_SECONDS,
                  lastAIUpdateMs > 0 ? elapsedAiSeconds : mixerDelta
                );
                monster.lastAIUpdateMs = aiNowMs;
                monster.updateAI(aiDeltaSeconds, playerModel, otherPlayers, aiContext);
              }
            } else {
              monster.updateAI(mixerDelta, playerModel, otherPlayers, aiContext);
            }
            return;
          }

          if (monsterTier === 'background') {
            const lastBackgroundAi = monster.lastBackgroundAIUpdateMs ?? 0;
            if (previousTier !== 'background' || aiNowMs - lastBackgroundAi > MONSTER_BACKGROUND_AI_INTERVAL_MS) {
              const elapsedAiSeconds = Math.max(0, (aiNowMs - lastBackgroundAi) / 1000);
              const aiDelta = Math.min(
                MAX_AI_DELTA_SECONDS,
                lastBackgroundAi > 0 ? elapsedAiSeconds : mixerDelta
              );
              monster.lastBackgroundAIUpdateMs = aiNowMs;
              monster.updateAI(aiDelta, playerModel, otherPlayers, aiContext);
            }
            return;
          }
        });
      }
    } else {
      // non-host prediction
      monsters.forEach(monster => monster?.update?.(mixerDelta));
    }

    // Friendlies: same idea—do NOT pass 0 deltas
    friendlyNpcManager?.update({ delta: mixerDelta, isHost: isHostNow });
    const merchantFriendly = getMerchantFriendlyFeature();
    if (merchantFriendly?.updateAI) {
      merchantFriendly.updateAI(mixerDelta, playerModel, otherPlayers);
    }


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
      payload.equippedLeft = isInventoryItemEquipped('torch')
        ? 'torch'
        : (isInventoryItemEquipped('lantern') ? 'lantern' : null);
      payload.equippedRight = isInventoryItemEquipped('iceGun')
        ? 'iceGun'
        : (isInventoryItemEquipped('bow')
          ? 'bow'
          : (isInventoryItemEquipped('bomb')
            ? 'bomb'
            : (isInventoryItemEquipped('autumnSword') ? 'sword' : null)));
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


    const localPlayerPosition = playerModel?.position;
    if (localPlayerPosition && audioManager) {
      const merchantFriendly = getMerchantFriendlyFeature();
      updateMerchantLoopVoice({ merchant: merchantFriendly, playerPosition: localPlayerPosition });

      const playNearFootstepsFor = (entityId, position, isMoving) => {
        if (!position || !isMoving) return;
        const distance = localPlayerPosition.distanceTo(position);
        if (!Number.isFinite(distance) || distance > 18) return;
        const volume = Math.max(0.04, 0.28 * (1 - (distance / 18)));
        audioManager.playFootstepAt(entityId, volume);
      };

      Object.entries(otherPlayers).forEach(([id, remote]) => {
        const action = remote?.model?.userData?.currentAction;
        const isMoving = action === 'run' || action === 'walk' || action === 'swim';
        playNearFootstepsFor(`remote:${id}`, remote?.model?.position, isMoving);
      });

      (friendlyNpcManager?.friendlies || []).forEach((friendly) => {
        maybePlayNpcVoice({
          entityId: `friendly-voice:${friendly?.id || 'unknown'}`,
          position: friendly?.model?.position,
          now,
          intervalRange: FRIENDLY_VOICE_INTERVAL_MS,
          clips: FRIENDLY_VOICE_CLIPS,
          maxVolume: FRIENDLY_VOICE_MAX_VOLUME,
          playerPosition: localPlayerPosition,
          cooldownPrefix: 'friendly-voice'
        });
        const action = friendly?.model?.userData?.currentAction;
        const isMoving = action === 'Run' || action === 'Walk' || action === 'run' || action === 'walk';
        playNearFootstepsFor(`friendly:${friendly?.id || 'unknown'}`, friendly?.model?.position, isMoving);
      });

      (animals || []).forEach((animal) => {
        const action = animal?.model?.userData?.currentAction;
        const isMoving = action === 'Run' || action === 'Walk' || action === 'run' || action === 'walk';
        playNearFootstepsFor(`animal:${animal?.id || 'unknown'}`, animal?.model?.position, isMoving);
      });

      (monsters || []).forEach((monster) => {
        updateZombieLoopVoice({ monster, playerPosition: localPlayerPosition });
        const action = monster?.model?.userData?.currentAction;
        const isMoving = action === 'Weapon' ? false : (action === 'Run' || action === 'Walk' || action === 'run' || action === 'walk');
        playNearFootstepsFor(`monster:${monster?.id || 'unknown'}`, monster?.model?.position, isMoving);
      });
    }

    updateProjectiles({
      scene,
      projectiles,
      playerModel,
      otherPlayers,
      multiplayer,
      monsters: getDamageableCreatures(),
      sendMonsterAttack: sendMonsterAttackIntent,
      onMonsterHit: handleMonsterDamage
    });
    handleBombPickupArrowHit();

    updateIceMists({
      scene,
      mistList: iceMists,
      deltaSeconds: frameDelta,
      playerModel,
      playerControls,
      monsters: getDamageableCreatures(),
      multiplayer
    });

    updateBombMists({
      scene,
      mistList: bombMists,
      deltaSeconds: frameDelta
    });

    if (treeFires.length) {
      const fireTime = performance.now();
      for (let i = treeFires.length - 1; i >= 0; i -= 1) {
        const entry = treeFires[i];
        if (!entry?.fire?.group) {
          treeFires.splice(i, 1);
          continue;
        }
        entry.fire.update?.(fireTime);
      }
    }

    updateAttackWindowMist({ scene, playerModel });

    updateMeleeAttacks({
      playerModel,
      otherPlayers,
      monsters: getDamageableCreatures(),
      audioManager,
      multiplayer,
      sendMonsterAttack: sendMonsterAttackIntent,
      onMonsterHit: handleMonsterDamage,
      onSwordHit: handleSwordTreeHit,
      onTorchHit: handleTorchTreeHit,
      onEntityHit: handleCombatEntityHit
    });

    updateHitRibbonBursts({ scene, deltaSeconds: frameDelta });
    terrainStampDebugOverlay?.update?.();

    renderer.render(scene, camera);
  }

  canProcessIncomingPeerData = true;
  while (pendingIncomingPeerData.length > 0) {
    const next = pendingIncomingPeerData.shift();
    if (!next) continue;
    handleIncomingData(next[0], next[1]);
  }

  animate();

  return runtimeContext;
}

async function initWorld(runtimeContext) {
  runtimeContext.settings.startupPhases = runtimeContext.settings.startupPhases || [];
  runtimeContext.settings.startupPhases.push('world');
  return runtimeContext;
}

async function initActors(runtimeContext) {
  runtimeContext.settings.startupPhases = runtimeContext.settings.startupPhases || [];
  runtimeContext.settings.startupPhases.push('actors');
  return runtimeContext;
}

async function initUI(runtimeContext) {
  runtimeContext.settings.startupPhases = runtimeContext.settings.startupPhases || [];
  runtimeContext.settings.startupPhases.push('ui');
  return runtimeContext;
}

async function initNetworkingAndPersistence(runtimeContext) {
  runtimeContext.settings.startupPhases = runtimeContext.settings.startupPhases || [];
  runtimeContext.settings.startupPhases.push('networking-and-persistence');
  return runtimeContext;
}

export async function bootstrapGameApp() {
  appContext.settings.startupPhases = [];

  await initCore(appContext);
  await initWorld(appContext);
  await initActors(appContext);
  await initUI(appContext);
  await initNetworkingAndPersistence(appContext);

  return appContext;
}

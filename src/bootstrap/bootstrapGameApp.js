// app.js
import QRCode from 'qrcode';
import * as THREE from "three";
import { spawnBloodBurst, updateBloodEffects } from "../combat/bloodEffect.js";
import { updateExplosionEffects } from "../combat/explosionEffect.js";
import { PlayerCharacter } from "../characters/PlayerCharacter.js";
import { updateRemotePlayerRig } from "../models/playerModel.js";
import { glbCharacterConfig } from "../models/glbCharacterModel.js";
import { getTerrainHeight, registerTerrainHeightResolver } from '../environment/terrainHeight.js';
import { Multiplayer } from '../multiplayer/peerConnection.js';
import { PlayerControls } from '../controls/controls.js';
import { getCookie, setCookie } from '../core/utils.js';
import { createAudioManager } from '../features/audioFeature.js';
import { spawnProjectile, updateProjectiles, loadSpecialWeapons } from '../features/combatFeature.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import RAPIER from '@dimforge/rapier3d-compat';
import { removeRigidBodySafely } from '../physics/rapierSafety.js';
import { getSpawnPosition, getSpawnY } from '../map/spawnUtils.js';
import {
  BASE_HEALTH_SEGMENTS,
  SHOWDOWN_BASE_HEALTH_SEGMENTS,
  SHOWDOWN_MAX_HEALTH_SEGMENTS,
  clampHealthSegments
} from '../player/healthUtils.js';
import {
  initSettingsPanel,
  openSettings,
  updateSettingsUI,
  initMerchantPanelFeature,
  updateMerchantUIFeature,
  initMerchantFeature,
  setMerchantHostFeature,
  setMerchantRoomFeature
} from '../features/uiPanelsFeature.js';
import { appContext } from '../core/appContext.js';
import { exposeDebugGlobals } from '../core/exposeDebugGlobals.js';
import { EnemyPlayer } from '../characters/EnemyPlayer.js';
import { BombThrowerEnemy, BOMB_DEFLECT_SPEED } from '../characters/BombThrowerEnemy.js';
import { createPlayerBombs } from '../combat/playerBomb.js';
import { createShowdownTutorial } from '../tutorial/showdownTutorial.js';

import {
  clearStoredPin,
  deleteProfileData,
  getStoredPinHash,
  loadOrCreateWithPin,
  renameProfile,
  saveStatsImmediate as saveStatsImmediateRaw,
  saveStatsThrottled as saveStatsThrottledRaw,
  loadPhoneSwordLeaderboards,
  savePhoneSwordStats,
  loadPhoneSwordStats,
  savePhoneSwordStage,
  loadPhoneSwordStage,
  hasCompletedTutorial,
  saveTutorialCompleted
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

// Max health is stored as showdownMaxHealthSegments (older profiles only have maxHealthSegments).
const statsForSave = (stats) => (stats ? { ...stats, showdownMaxHealthSegments: stats.maxHealthSegments } : stats);
const saveStatsImmediate = (nameKey, stats, ...rest) => saveStatsImmediateRaw(nameKey, statsForSave(stats), ...rest);
const saveStatsThrottled = (nameKey, stats, ...rest) => saveStatsThrottledRaw(nameKey, statsForSave(stats), ...rest);

// Sword Showdown: max "Shield Upgrade" purchases (each +SHIELD_UPGRADE_HEALTH durability → 20 + 4×10 = 60 max)
const SHOWDOWN_MAX_SHIELD_UPGRADES = 4;

const ROAD_LIGHT_GRID_SIZE = 3;
const ROAD_LIGHT_GRID_SPACING_METERS = 40;
const ROAD_LIGHT_SHIFT_DISTANCE_METERS = ROAD_LIGHT_GRID_SPACING_METERS * 1.25;
const ROAD_LIGHT_REPOSITION_INTERVAL_MS = 7000;
const ROAD_LIGHT_MODEL_URL = '/assets/props/road_light.glb';
const ROAD_LIGHT_POINT_LIGHT_CONFIG = Object.freeze({
  color: 0xfff1c1,
  intensity: 2.6,
  distance: 40,
  decay: 0.5,
  yOffset: 3.4
});

const PERF = {
  throttlePickups: true
};

const FRAME_TIME_DEGRADE_THRESHOLD_MS = 25;
const FRAME_TIME_RECOVER_THRESHOLD_MS = 18;
const FRAME_TIME_DEGRADE_MAX_LEVEL = 2;
const INCOMING_QUEUE_MAX_PER_FRAME = 40;
const INCOMING_QUEUE_BUDGET_MS = 3;
const INCOMING_QUEUE_MAX_BACKLOG = 400;
const LOW_END_BUCKET_INTERVALS = Object.freeze({
  pickups: 2,
  remoteLabels: 2,
  audio: 3
});
const NETWORK_TOPOLOGY_MODE = (import.meta.env.VITE_NETWORK_TOPOLOGY_MODE || 'star').toLowerCase() === 'mesh'
  ? 'mesh'
  : 'star';
appContext.debugFlags.PERF = PERF;
appContext.debugFlags.DEBUG_CONSOLE = false;
exposeDebugGlobals({
  enableDebugMirror: appContext.debugFlags.DEBUG_CONSOLE === true,
  enableCompatibilityShims: true
});

const clock = new THREE.Clock();
const mixerClock = new THREE.Clock();

// --- Physics + presence state ---
let rapierWorld;
const rbToMesh = new Map(); // RigidBody -> THREE.Mesh
let physicsAccumulator = 0;
const FIXED_DT = 1 / 60;
const PLAYER_VISIBILITY_RADIUS_M = 200;
const PRESENCE_STALE_MS = 5000;
const PRESENCE_SEND_MS = 350;
const PRESENCE_HEARTBEAT_MS = 2000;
const PRESENCE_SWEEP_MS = 250;
const REMOTE_LERP_ALPHA = 0.15;
const REMOTE_TELEPORT_THRESHOLD_M = 25;
const DISPLAY_SETTINGS_KEY = 'settings:display';
const DISPLAY_PRESETS = {
  day: {
    ambientIntensity: 2.0,
    directionalIntensity: 2.0,
    groundBrightness: 1.6,
    buildingBrightness: 1.6,
    skyBrightness: 1.6
  },
  night: {
    ambientIntensity: 0.0,
    directionalIntensity: 0.0,
    groundBrightness: 0.6,
    buildingBrightness: 0.65,
    skyBrightness: 0.25
  }
};
const HIGH_CONTRAST_PRESET = {
  ambientIntensity: 2.0,
  directionalIntensity: 2.0,
  groundBrightness: 2.0,
  buildingBrightness: 2.0
};
const PERFORMANCE_MODES = new Set(['auto', 'quality', 'balanced', 'performance']);
const PERFORMANCE_PROFILE_CAPS = {
  low: 1.0,
  mid: 1.5,
  high: 2.0
};

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
  const modeSelect = startOverlay.querySelector('[data-arcade-modes]');
  const tutorialButton = startOverlay.querySelector('[data-arcade-tutorial]');
  const showdownButton = startOverlay.querySelector('[data-arcade-showdown]');

  let mode = 'login';
  // Until the tutorial is done the start screen only offers "Start Game" (which runs it);
  // afterwards it offers Tutorial and Showdown.
  let tutorialCompleted = false;
  let modeHandler = null; // picks a mode once the game is running (start screen shown again)

  let currentName = '';
  let authInProgress = false;
  let authToken = 0;
  let resolveAuth = null;
  let startHandler = null;
  let pendingAuthResult = null;
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

  const showModeButtons = () => {
    startButton?.classList.toggle('hidden', tutorialCompleted);
    modeSelect?.classList.toggle('hidden', !tutorialCompleted);
  };

  const hideModeButtons = () => {
    startButton?.classList.add('hidden');
    modeSelect?.classList.add('hidden');
  };

  const showModeSelect = (authResult) => {
    // "Start Game" (tutorial) for new players, else Tutorial / Showdown.
    // A click (below) resolves auth and launches the game in that mode.
    pendingAuthResult = authResult;
    tutorialCompleted = hasCompletedTutorial(authResult?.profile);
    form?.classList.add('hidden');
    showModeButtons();
    welcomeSection?.classList.remove('hidden');
  };

  const showLoginForm = ({ name, preserveMessage = false } = {}) => {
    form?.classList.remove('hidden');
    welcomeSection?.classList.add('hidden');
    hideModeButtons();
    setMode('login');
    if (!preserveMessage) {
      setMessage('');
    }
    nameInput.value = name || '';
    pinInput.value = '';
    confirmInput.value = '';
  };

  const showWelcome = (name) => {
    welcomeText.textContent = `Welcome back ${name}`;
    welcomeSection?.classList.remove('hidden');
    form?.classList.add('hidden');
    hideModeButtons();
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
      showWelcome(currentName);
      showModeSelect(result);
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
    pendingAuthResult = null;
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

  const chooseMode = (gameMode) => {
    if (startHandler) startHandler();
    hideOverlay();
    if (resolveAuth) {
      const resolve = resolveAuth;
      resolveAuth = null;
      resolve({ ...(pendingAuthResult || {}), mode: gameMode });
    } else {
      modeHandler?.(gameMode);
    }
  };

  startButton?.addEventListener('click', () => chooseMode('tutorial'));
  tutorialButton?.addEventListener('click', () => chooseMode('tutorial'));
  showdownButton?.addEventListener('click', () => chooseMode('showdown'));

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
        welcomeText.textContent = `Welcome back ${initialName}`;
        welcomeSection?.classList.remove('hidden');
        form?.classList.add('hidden');
        startAuthFlow(initialName, { autoStart: false });
      } else {
        showLoginForm({ name: initialName });
      }
      return authPromise;
    },
    setStartHandler(handler) {
      startHandler = handler;
    },
    setModeHandler(handler) {
      modeHandler = handler;
    },
    // Back to the start screen mid-session (e.g. after the tutorial)
    showStartScreen({ tutorialDone = tutorialCompleted } = {}) {
      tutorialCompleted = !!tutorialDone;
      setMessage('');
      form?.classList.add('hidden');
      switchButton?.classList.add('hidden'); // switching user needs a fresh page load
      welcomeSection?.classList.remove('hidden');
      showModeButtons();
      startOverlay.style.display = '';
      startOverlay.classList.remove('hidden');
      startOverlay.setAttribute('aria-hidden', 'false');
    },
    hideOverlay
  };
}

const SWORD_SHOWDOWN_BGS = 'Interior Day/Inside Day.ogg';
const SWORD_SHOWDOWN_BGS_VOLUME_SCALE = 0.5;

async function initCore(runtimeContext) {
  document.body.addEventListener('touchstart', () => {}, { once: true });

  const _savedMusicVol = parseFloat(localStorage.getItem('sq:musicVolume') ?? '0.05');
  const _savedSfxVol = parseFloat(localStorage.getItem('sq:sfxVolume') ?? '1');
  const audioManager = createAudioManager({
    musicVolume: Number.isFinite(_savedMusicVol) ? _savedMusicVol : 0.05,
    sfxVolume: Number.isFinite(_savedSfxVol) ? _savedSfxVol : 1
  });
  runtimeContext.systems.audioManager = audioManager;
  window.audioManager = audioManager;
  // Sword Showdown always uses the same ambient loop, at half the SFX volume.
  const playShowdownBackgroundLoop = () => {
    audioManager.playBGS(SWORD_SHOWDOWN_BGS, { volumeScale: SWORD_SHOWDOWN_BGS_VOLUME_SCALE });
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
    audioManager.unlock();
    await resumeAudioContext();
    playShowdownBackgroundLoop();
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

  const PICKUP_RADIUS = 1.2;
  const PICKUP_ATTRACT_RADIUS = 8;
  const PICKUP_ATTRACT_SPEED = 7.5;

  let multiplayer = null;
  let isHost = false;
  var playerControls = null;
  let scene = null;
  let ambientLight = null;
  let dirLight = null;
  let presenceSendIntervalMs = PRESENCE_SEND_MS;
  const POSITION_DEADBAND_SQ = 0.03 * 0.03;
  const ROTATION_DEADBAND_RAD = 0.045;
  const NETWORK_BASE_PROFILE = Object.freeze({
    high: Object.freeze({ presenceMs: 350 }),
    mid: Object.freeze({ presenceMs: 420 }),
    low: Object.freeze({ presenceMs: 550 })
  });
  const NETWORK_ADAPTIVE_PROFILE = Object.freeze({
    backlogWarn: 40,
    backlogCritical: 140,
    processSaturated: INCOMING_QUEUE_MAX_PER_FRAME,
    overrunWarnStreak: 4,
    overrunCriticalStreak: 10,
    recoveryStableFrames: 150,
    restoreStepMs: 12,
    logWindowMs: 3000,
    presenceDeadbandMul: 0.75,
    rotationDeadbandMul: 0.7
  });
  const MIN_POSITION_DEADBAND_SQ = (0.008 * 0.008);
  const MIN_ROTATION_DEADBAND_RAD = 0.012;
  let runtimePositionDeadbandSq = POSITION_DEADBAND_SQ;
  let runtimeRotationDeadbandRad = ROTATION_DEADBAND_RAD;
  // Only presence goes through the queue (projectiles are sent directly by PlayerControls)
  const netSendQueue = [];
  const NET_SEND_BUDGETS = Object.freeze({
    high: { maxMessages: 12, maxBytes: 14000 },
    mid: { maxMessages: 9, maxBytes: 9000 },
    low: { maxMessages: 6, maxBytes: 5000 }
  });
  const netStats = {
    sentInWindow: 0,
    windowStartMs: performance.now(),
    messagesPerSecond: 0,
    dropped: 0,
    deferred: 0
  };
  const lastSentPresenceState = {
    x: null,
    y: null,
    z: null,
    rotation: null,
    action: null,
    sentAt: 0
  };
  const projectiles = [];
  const localHeldWeaponMeshes = new Map();
  const remoteHeldWeaponMeshes = new Map();
  const remotePresenceEquipment = new Map();
  const remoteHoldTempPosition = new THREE.Vector3();
  const remoteHoldTempQuaternion = new THREE.Quaternion();
  const remoteHoldTempOffset = new THREE.Vector3();
  // Phone Sword gyro scratch objects
  const _phoneSwordGyroQ = new THREE.Quaternion();
  const _phoneSwordEuler = new THREE.Euler();
  // Foam sword default hold orientation (Euler 0, π, 0) — applied after gyro rotation
  const _phoneSwordBaseQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI, 0, 'YXZ'));

  // Phone Sword: gyro swing detection & trail state
  const _psw = {
    prevBeta: null, prevGamma: null, prevAlpha: null,
    prevTime: null,
    swingActive: false,
    swingEndTime: 0,
    suppressUntil: 0,     // don't detect swings until this timestamp
    returning: false,     // true while smoothly lerping back to live gyro after swing
    returnStartTime: 0,
    returnStartQ: new THREE.Quaternion(),
    swingExaggerQ: new THREE.Quaternion(),
    swingStartQ: new THREE.Quaternion(), // gyro orientation captured at swing start, used for parry reversal
    trail: [],            // {pos: THREE.Vector3, t: number}[] — always sampled, shown during swings
    trailLines: [],       // THREE.Line[] added to scene
    _extraQ: new THREE.Quaternion(),
    // Rolling window for arc-length check
    deltaHistory: [],     // {dB, dG, dA, t}[]
    deltaWindowSec: 0.2,
    // Parry: swing cancelled because it is perpendicular to the blocker's sword direction
    parryActive: false,
    parryStartTime: 0,
    parryQ: new THREE.Quaternion(), // reversed pose held during parry (no trail, 1 s hold)
    // Swing strength tier: 0=none, 1=slow (no trail/rotation), 2=medium, 3=fast
    swingStrength: 0,
    slowHitWindow: 0,     // timestamp until which a slow swing can register hits
    // Sword-collision bounce state (replaces swing auto-rotation for player)
    prevTipWorld: null,   // THREE.Vector3 — sword tip last frame, for sweep direction
    tipHistory: [],       // {pos, t}[] — sword tip over the last ~0.12 s, for swing direction (blocks)
    prevSwordQ: new THREE.Quaternion(), // sword Q last frame
    bounceActive: false,
    bounceStartTime: 0,
    bounceDur: 0.5,
    bounceFromQ: new THREE.Quaternion(),
    bounceTargetQ: new THREE.Quaternion(),
    bounceCurrentQ: new THREE.Quaternion(),
  };
  // Block flash helper — called with 'player' (green) or 'enemy' (gray)
  window._pswShowBlockFlash = function(who) {
    const id = who === 'player' ? 'sword-block-flash-player' : 'sword-block-flash-enemy';
    const svgId = who === 'player' ? 'sword-block-svg-player' : 'sword-block-svg-enemy';
    const el = document.getElementById(id);
    const svg = document.getElementById(svgId);
    if (!el || !svg) return;
    el.style.display = 'block';
    const dur = who === 'player' ? 420 : 360;
    const animName = who === 'player' ? 'psw-block-player' : 'psw-block-enemy';
    // Re-trigger SVG animation on all children
    for (const child of svg.children) {
      child.style.animation = 'none';
      void child.offsetWidth;
      child.style.animation = animName + ' ' + (dur / 1000).toFixed(2) + 's ease-out forwards';
    }
    clearTimeout(el._bfTimer);
    el._bfTimer = setTimeout(() => { el.style.display = 'none'; }, dur + 40);
  };

  // Default weapon position/rotation config — overridden live by the debug panel
  window.phoneSwordWeaponCfg = window.phoneSwordWeaponCfg || {
    // Shield: holdOffset (meters) and holdRotation (degrees) relative to hand
    shieldPosX: -0.02, shieldPosY: -0.17, shieldPosZ: 0.2,
    shieldRotX: 0, shieldRotY: 0, shieldRotZ: 0,
    // Gun: holdOffset (meters) and holdRotation (degrees) relative to hand
    gunPosX: -0.02, gunPosY: 0.06, gunPosZ: 0.02,
    gunRotX: 7, gunRotY: 180, gunRotZ: 0,
  };
  window.phoneSwordSwingCfg = window.phoneSwordSwingCfg || {
    speedThreshold: 2100,   // deg/s — minimum speed to register as any swing (slow tier)
    mediumThreshold: 7000,  // deg/s — above this → medium tier (trail + rotation)
    fastThreshold: 11000,   // deg/s — above this → fast tier (more damage, longer hold)
    minSwingDelta: 19,      // deg — total arc in last 200ms required
    oppositeStrength: 1.0,  // 0=no swing, 1=full opposite, >1=overshoot
    holdDuration: 0.5,      // seconds — medium hold; fast gets 1.6× automatically
    returnDuration: 0.3,    // seconds — how long to smoothly return to gyro after hold
    trailDuration: 0.4,     // seconds — how long trail history is kept/shown
    trailOpacity: 0.75,
    trailColor: 0xff4986,
    trailLineCount: 3,
    trailLineSpread: 0.005,
    minSweepDist: 0.16,    // meters — minimum tip movement per frame to register a sweep hit
    minSweepSpeed: 100,    // deg/s — gyro rotation speed required for a sweep hit to register
    bounceAngle: 120,      // degrees — how far sideways the sword is knocked
    bounceSnapSpeed: 18,   // exp-decay rate — higher = snaps to recoil position faster
    bounceHoldDur: 0.7,    // seconds sword stays at peak recoil before returning
    blockLateralScale: 0.3,  // 0=fully centered, 1=full spread — how much lateral offset in block mode
    hitKnockbackWeak: 20,    // horizSpeed for non-killing hits (killing hits always use full force)
    enemyBounceHoldDur: 2.0, // seconds enemy sword stays stuck after being blocked by player
  };

  const tempVector3A = new THREE.Vector3();
  const PISTOL_AMMO_KEY = 'gun bullets';
  const DEFAULT_PISTOL_AMMO = 15;
  const COIN_PICKUP_GAIN = 1;
  const coinPickups = [];
  const PICKUP_CHECK_INTERVAL_MS = 250;
  let lastPickupCheckMs = 0;

  const otherPlayers = {};
  runtimeContext.entities.otherPlayers = otherPlayers;
  window.otherPlayers = otherPlayers;
  const pendingIncomingPeerData = [];
  let canProcessIncomingPeerData = false;
  let lastIncomingProcessCount = 0;
  let lastIncomingBacklog = 0;
  let frameIndex = 0;
  let adaptiveDegradeLevel = 0;
  let frameOverrunStreak = 0;
  let frameRecoverStreak = 0;
  let adaptiveNetworkPressureLevel = 0;
  let networkRecoveryStableFrames = 0;
  let adaptiveIntervalOffsetMs = 0;
  let deferPresence = false;
  let lastNetworkProfileLogAt = 0;
  let lastNetworkProfileLogKey = '';
  const remotePresenceMeta = {};
  let lastPresenceSend = 0;
  let lastPresenceSweep = 0;

  const wrapDeltaRad = (value) => {
    let wrapped = value;
    while (wrapped > Math.PI) wrapped -= Math.PI * 2;
    while (wrapped < -Math.PI) wrapped += Math.PI * 2;
    return wrapped;
  };
  const getNetworkTier = () => {
    const pingMs = multiplayer?.lastPingMs;
    const pingAgeMs = Number.isFinite(multiplayer?.lastPingAt) ? (Date.now() - multiplayer.lastPingAt) : Infinity;
    const hasLag = Number.isFinite(pingMs) && pingMs >= 220;
    const stalePing = pingAgeMs > 20000;
    const deviceTier = getDevicePerformanceProfile().tier;
    if (deviceTier === 'low' || hasLag || stalePing) return 'low';
    if (deviceTier === 'mid' || (Number.isFinite(pingMs) && pingMs >= 120)) return 'mid';
    return 'high';
  };
  const applyRuntimeNetworkProfile = ({
    incomingBacklog = lastIncomingBacklog,
    incomingProcessCount = lastIncomingProcessCount,
    overrunStreak = frameOverrunStreak,
    recoverStreak = frameRecoverStreak
  } = {}) => {
    const tier = getNetworkTier();
    const tierProfile = NETWORK_BASE_PROFILE[tier] || NETWORK_BASE_PROFILE.high;
    const backlog = Number.isFinite(incomingBacklog) ? incomingBacklog : 0;
    const processCount = Number.isFinite(incomingProcessCount) ? incomingProcessCount : 0;
    const safeOverrun = Number.isFinite(overrunStreak) ? overrunStreak : 0;
    const safeRecover = Number.isFinite(recoverStreak) ? recoverStreak : 0;

    const pressureCritical = backlog >= NETWORK_ADAPTIVE_PROFILE.backlogCritical
      || safeOverrun >= NETWORK_ADAPTIVE_PROFILE.overrunCriticalStreak;
    const pressureWarn = backlog >= NETWORK_ADAPTIVE_PROFILE.backlogWarn
      || processCount >= NETWORK_ADAPTIVE_PROFILE.processSaturated
      || safeOverrun >= NETWORK_ADAPTIVE_PROFILE.overrunWarnStreak;

    const previousPressure = adaptiveNetworkPressureLevel;
    if (pressureCritical) {
      adaptiveNetworkPressureLevel = 2;
      networkRecoveryStableFrames = 0;
      adaptiveIntervalOffsetMs = Math.min(220, adaptiveIntervalOffsetMs + 28);
    } else if (pressureWarn) {
      adaptiveNetworkPressureLevel = 1;
      networkRecoveryStableFrames = 0;
      adaptiveIntervalOffsetMs = Math.min(160, adaptiveIntervalOffsetMs + 16);
    } else {
      adaptiveNetworkPressureLevel = Math.max(0, adaptiveNetworkPressureLevel - (safeRecover >= 4 ? 1 : 0));
      networkRecoveryStableFrames += 1;
      if (networkRecoveryStableFrames >= NETWORK_ADAPTIVE_PROFILE.recoveryStableFrames) {
        adaptiveIntervalOffsetMs = Math.max(0, adaptiveIntervalOffsetMs - NETWORK_ADAPTIVE_PROFILE.restoreStepMs);
      }
    }

    // Under critical pressure presence updates are deferred
    deferPresence = adaptiveNetworkPressureLevel >= 2;
    presenceSendIntervalMs = tierProfile.presenceMs + Math.round(adaptiveIntervalOffsetMs * 0.65);

    const positionDeadbandMul = adaptiveNetworkPressureLevel > 0 ? NETWORK_ADAPTIVE_PROFILE.presenceDeadbandMul : 1;
    const rotationDeadbandMul = adaptiveNetworkPressureLevel > 0 ? NETWORK_ADAPTIVE_PROFILE.rotationDeadbandMul : 1;
    runtimePositionDeadbandSq = Math.max(MIN_POSITION_DEADBAND_SQ, POSITION_DEADBAND_SQ * positionDeadbandMul * positionDeadbandMul);
    runtimeRotationDeadbandRad = Math.max(MIN_ROTATION_DEADBAND_RAD, ROTATION_DEADBAND_RAD * rotationDeadbandMul);

    const now = performance.now();
    const logKey = `${tier}:${adaptiveNetworkPressureLevel}:${Math.round(adaptiveIntervalOffsetMs / 10)}:${deferPresence ? 'deferred' : 'normal'}`;
    if (logKey !== lastNetworkProfileLogKey && (now - lastNetworkProfileLogAt) >= NETWORK_ADAPTIVE_PROFILE.logWindowMs) {
      console.debug('[net-profile]', {
        tier,
        pressureLevel: adaptiveNetworkPressureLevel,
        previousPressure,
        backlog,
        processCount,
        overrunStreak: safeOverrun,
        recoverStreak: safeRecover,
        presenceSendIntervalMs,
        deferPresence
      });
      lastNetworkProfileLogAt = now;
      lastNetworkProfileLogKey = logKey;
    }
  };
  const recordNetSent = (count = 1) => {
    netStats.sentInWindow += count;
  };
  const estimatePayloadBytes = (payload) => {
    if (!payload) return 0;
    try {
      return JSON.stringify(payload).length;
    } catch {
      return 0;
    }
  };
  const queueNetMessage = (payload) => {
    if (!multiplayer || !payload) {
      netStats.dropped += 1;
      return false;
    }
    if (deferPresence) {
      netStats.deferred += 1;
      return false;
    }
    netSendQueue.push(payload);
    return true;
  };
  const flushNetSendQueue = () => {
    if (!multiplayer || netSendQueue.length === 0) return;
    const tier = getNetworkTier();
    const budget = NET_SEND_BUDGETS[tier] || NET_SEND_BUDGETS.high;
    let sent = 0;
    let sentBytes = 0;
    while (netSendQueue.length > 0) {
      if (sent >= budget.maxMessages || sentBytes >= budget.maxBytes) break;
      const payload = netSendQueue[0];
      const payloadBytes = estimatePayloadBytes(payload);
      if ((sent + 1) > budget.maxMessages || (sentBytes + payloadBytes) > budget.maxBytes) break;
      netSendQueue.shift();
      if (sendNetworkPayload(payload)) {
        sent += 1;
        sentBytes += payloadBytes;
      }
    }
    netStats.deferred += netSendQueue.length;
    recordNetSent(sent);
  };
  const sendNetworkPayload = (payload) => {
    if (!multiplayer || !payload) return false;
    multiplayer.send(payload);
    return true;
  };
  const tickNetStats = (nowMs) => {
    const elapsed = nowMs - netStats.windowStartMs;
    if (elapsed < 1000) return;
    netStats.messagesPerSecond = (netStats.sentInWindow * 1000) / elapsed;
    netStats.sentInWindow = 0;
    netStats.windowStartMs = nowMs;
    window.netRuntimeStats = {
      msgsPerSecond: Number(netStats.messagesPerSecond.toFixed(2)),
      rttMs: Number.isFinite(multiplayer?.lastPingMs) ? multiplayer.lastPingMs : null,
      dropped: netStats.dropped,
      queueDepth: netSendQueue.length,
      deferred: netStats.deferred,
      topologyMode: NETWORK_TOPOLOGY_MODE,
      presenceSendIntervalMs
    };
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
  const highContrastSkyDay = new THREE.Color(0xffffff);
  const highContrastSkyNight = new THREE.Color(0xffffff);
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
  const applyHighContrastMaterialState = (material, enabled) => {
    if (!material || !material.isMaterial) return;
    material.userData = material.userData || {};
    if (!material.userData.baseHighContrastState) {
      material.userData.baseHighContrastState = {
        toneMapped: material.toneMapped,
        color: material.color?.clone ? material.color.clone() : null,
        emissive: material.emissive?.clone ? material.emissive.clone() : null,
        emissiveIntensity: typeof material.emissiveIntensity === 'number' ? material.emissiveIntensity : null
      };
    }
    const base = material.userData.baseHighContrastState;
    if (!enabled) {
      material.toneMapped = base.toneMapped;
      if (base.color && material.color?.copy) material.color.copy(base.color);
      if (base.emissive && material.emissive?.copy) material.emissive.copy(base.emissive);
      if (typeof base.emissiveIntensity === 'number') material.emissiveIntensity = base.emissiveIntensity;
      material.needsUpdate = true;
      return;
    }
    material.toneMapped = false;
    if (material.color?.copy && base.color) {
      const luminance = base.color.r * 0.2126 + base.color.g * 0.7152 + base.color.b * 0.0722;
      const contrastBoost = luminance > 0.45 ? 1 : 0.08;
      material.color.copy(base.color).multiplyScalar(contrastBoost);
      material.color.offsetHSL(0, 0.4, luminance > 0.45 ? 0.15 : -0.03);
    }
    if (material.emissive?.copy && base.emissive) {
      material.emissive.copy(base.emissive).multiplyScalar(2.6);
    }
    if (typeof material.emissiveIntensity === 'number' && typeof base.emissiveIntensity === 'number') {
      material.emissiveIntensity = Math.max(1.2, base.emissiveIntensity * 2.4);
    }
    material.needsUpdate = true;
  };
  const applyHighContrastToScene = (enabled) => {
    if (!scene) return;
    scene.traverse((child) => {
      if (!child?.isMesh) return;
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.forEach((material) => applyHighContrastMaterialState(material, enabled));
    });
  };
  const getAutoMode = () => {
    const now = new Date();
    const minutes = now.getHours() * 60 + now.getMinutes();
    if (minutes >= 21 * 60 || minutes < 6 * 60) {
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
    const defaults = { mode: 'auto', performanceMode: 'auto', highContrastMode: false, ...DISPLAY_PRESETS.day };
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
  let renderer = null;
  let currentPerformanceTier = resolvePerformanceTier(displaySettings.performanceMode);
  let optionalShadowsEnabled = !isLowEndTier(currentPerformanceTier);

  if (!DISPLAY_MODES.has(displaySettings.mode)) {
    displaySettings.mode = 'auto';
  }
  if (!PERFORMANCE_MODES.has(displaySettings.performanceMode)) {
    displaySettings.performanceMode = 'auto';
  }
  if (typeof displaySettings.highContrastMode !== 'boolean') {
    displaySettings.highContrastMode = false;
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
    const highContrastEnabled = Boolean(displaySettings.highContrastMode);
    if (scene) {
      if (effectiveMode === 'night') {
        scene.background = highContrastEnabled ? highContrastSkyNight : new THREE.Color(0x000000);
      } else {
        scene.background = highContrastEnabled ? highContrastSkyDay : skyboxTexture;
      }
    }
    const ambientIntensity = highContrastEnabled
      ? HIGH_CONTRAST_PRESET.ambientIntensity
      : displaySettings.ambientIntensity;
    const directionalIntensity = highContrastEnabled
      ? HIGH_CONTRAST_PRESET.directionalIntensity
      : displaySettings.directionalIntensity;
    if (ambientLight) {
      ambientLight.intensity = clampValue(ambientIntensity, 0, 2);
    }
    if (dirLight) {
      dirLight.intensity = clampValue(directionalIntensity, 0, 2);
    }
    applyHighContrastToScene(highContrastEnabled);
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
  }

  const updateAutoDisplayMode = () => {
    if (_psStageActive) return;
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
    applyRendererPerformanceSettings();
    applyDisplaySettings();
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
    if (key === 'highContrastMode') {
      displaySettings.highContrastMode = Boolean(value);
      saveDisplaySettings();
      applyDisplaySettings();
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

  const attractPickupToPlayer = (meshOrPosition, targetModel, speed, deltaSeconds) => {
    const sourcePosition = meshOrPosition?.isVector3 ? meshOrPosition : meshOrPosition?.position;
    if (!sourcePosition || !targetModel?.position || !Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return false;
    const toTarget = tempVector3A.subVectors(targetModel.position, sourcePosition);
    const distance = toTarget.length();
    if (!Number.isFinite(distance) || distance <= 0.001) return true;
    const maxStep = Math.max(0, speed) * deltaSeconds;
    if (distance <= maxStep) {
      sourcePosition.copy(targetModel.position);
      return true;
    }
    toTarget.multiplyScalar(maxStep / distance);
    sourcePosition.add(toTarget);
    return false;
  };

  const getPickupAttractRadius = () => PICKUP_ATTRACT_RADIUS;

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

  function processIncomingData(peerId, data) {
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
      if (typeof payload.name !== 'string') return false;
      if (payload.id != null && typeof payload.id !== 'string') return false;
      if (payload.action != null && typeof payload.action !== 'string') return false;
      if (payload.equippedLeft != null && typeof payload.equippedLeft !== 'string') return false;
      if (payload.equippedRight != null && typeof payload.equippedRight !== 'string') return false;
      const numberFields = ['x', 'y', 'z', 'rotation', 'heading'];
      if (numberFields.some(field => payload[field] != null && !isFiniteNumber(payload[field]))) return false;
      return true;
    };

    const isProjectileMessage = payload => isObject(payload)
      && payload.type === 'projectile'
      && typeof payload.id === 'string'
      && isVector3Array(payload.position)
      && isVector3Array(payload.direction)
      && (payload.weapon == null || typeof payload.weapon === 'string');

    if (!isObject(data)) {
      logInvalidPayload('payload', data);
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
      const now = performance.now();
      if (!remotePresenceMeta[remoteId]) {
        remotePresenceMeta[remoteId] = { lastSeenMs: now, lastX: null, lastZ: null };
      } else {
        remotePresenceMeta[remoteId].lastSeenMs = now;
      }

      if (Number.isFinite(data.x) && Number.isFinite(data.z)) {
        remotePresenceMeta[remoteId].lastX = data.x;
        remotePresenceMeta[remoteId].lastZ = data.z;
      }

      const localFix = playerModel?.position;
      if (localFix && Number.isFinite(data.x) && Number.isFinite(data.z)) {
        const dist = Math.hypot(data.x - localFix.x, data.z - localFix.z);
        remotePresenceMeta[remoteId].lastDistance = dist;
        if (dist > PLAYER_VISIBILITY_RADIUS_M) {
          removeRemotePlayer(remoteId, 'out-of-range');
          return;
        }
      }

      if (!otherPlayers[remoteId]) {
        const other = new PlayerCharacter(data.name);
        scene.add(other.model);
        document.body.appendChild(other.nameLabel);
        otherPlayers[remoteId] = {
          model: other.model,
          nameLabel: other.nameLabel,
          name: data.name,
          health: BASE_HEALTH_SEGMENTS,
          targetPos: new THREE.Vector3(),
          targetQuat: new THREE.Quaternion(),
          targetRotY: 0
        };
        logNet('spawn', remoteId, data.name);
      }

      const player = otherPlayers[remoteId];
      player.name = data.name;
      syncPresenceRemoteEquipment(remoteId, data);
      if (player.nameLabel) {
        player.nameLabel.innerText = data.name;
      }

      let targetX = Number.isFinite(data.x) ? data.x : null;
      let targetZ = Number.isFinite(data.z) ? data.z : null;

      if (targetX == null || targetZ == null) {
        return;
      }

      const hasAuthoritativeY = Number.isFinite(data.y);
      const resolvedNetworkY = getSpawnY(targetX, targetZ, 0.6);
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
      spawnProjectileWithPerfFlags(scene, projectiles, position, direction, data.id);
    }
  }

  function handleIncomingData(peerId, data) {
    pendingIncomingPeerData.push([peerId, data]);
    if (pendingIncomingPeerData.length > INCOMING_QUEUE_MAX_BACKLOG) {
      pendingIncomingPeerData.shift();
    }
  }

  multiplayer = new Multiplayer(playerName, handleIncomingData);
  window.multiplayer = multiplayer;
  multiplayer.getNetRuntimeStats = () => ({ ...window.netRuntimeStats });
  multiplayer.onPingUpdate = () => {
    applyRuntimeNetworkProfile({
      incomingBacklog: lastIncomingBacklog,
      incomingProcessCount: lastIncomingProcessCount,
      overrunStreak: frameOverrunStreak,
      recoverStreak: frameRecoverStreak
    });
  };
  multiplayer.onHostChange = ({ previousHostId, newHostId, isCurrentHost }) => {
    isHost = !!isCurrentHost;
    setMerchantHostFeature(isHost);
    if (previousHostId !== newHostId) {
      clearAllRemoteHeldWeaponMeshes();
      shield.remoteHolderId = null;
    }
  };
  multiplayer.onReady = async ({ roomId }) => {
    isHost = !!multiplayer.isHost;
    await setMerchantRoomFeature({ roomId: roomId || null, isHost: multiplayer.isHost });
  };

  let foamSword;
  let shield;
  let pistol;

  const initialTier = resolvePerformanceTier(displaySettings.performanceMode);
  renderer = new THREE.WebGLRenderer({ antialias: !isLowEndTier(initialTier) });
  currentPerformanceTier = initialTier;
  optionalShadowsEnabled = !isLowEndTier(initialTier);
  applyRendererPerformanceSettings();
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.getElementById('game-container').appendChild(renderer.domElement);

  // Load the GLB map and register a downward-raycast height resolver.
  const mapGltf = await new Promise((resolve, reject) =>
    new GLTFLoader().load('/glb_map/map.glb', resolve, undefined, reject)
  );
  const mapGroup = mapGltf.scene;
  mapGroup.name = 'map';
  mapGroup.scale.setScalar(5);
  scene.add(mapGroup);

  // Build a BVH-accelerated mesh list for downward raycasting to get terrain height.
  const { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } = await import('three-mesh-bvh');
  THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
  THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
  THREE.Mesh.prototype.raycast = acceleratedRaycast;

  const glbMeshes = [];
  mapGroup.traverse(obj => {
    if (obj.isMesh) {
      obj.geometry.computeBoundsTree();
      glbMeshes.push(obj);
    }
  });
  const _glbRaycaster = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, -1, 0));

  // Cache terrain height per entity to avoid re-raycasting every frame.
  // Key: "x_z" snapped to 0.5-unit grid; value: resolved Y.
  const _glbHeightCache = new Map();
  const _CACHE_SNAP = 0.5;
  const _glbResolveHeight = (x, z) => {
    const sx = Math.round(x / _CACHE_SNAP) * _CACHE_SNAP;
    const sz = Math.round(z / _CACHE_SNAP) * _CACHE_SNAP;
    const key = `${sx}_${sz}`;
    if (_glbHeightCache.has(key)) return _glbHeightCache.get(key);
    _glbRaycaster.ray.origin.set(sx, 500, sz);
    const hits = _glbRaycaster.intersectObjects(glbMeshes, false);
    const y = hits.length > 0 ? hits[0].point.y : undefined;
    _glbHeightCache.set(key, y);
    return y;
  };

  registerTerrainHeightResolver(_glbResolveHeight);

  const camera = new THREE.PerspectiveCamera(100, window.innerWidth / window.innerHeight, 0.1, 1000);

  const handleResize = () => {
    applyRendererPerformanceSettings();
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
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
  await RAPIER.init({});
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
    controls.refreshActionButtons?.();
  };

  const clearPlayerWeaponType = (controls, weaponType) => {
    if (!controls?.playerModel) return;
    if (!weaponType || controls.playerModel.userData.equippedWeaponType === weaponType) {
      controls.playerModel.userData.equippedWeaponType = null;
      controls.refreshActionButtons?.();
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

  const droppedWeaponPickups = [];
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
      shield,
      sword: foamSword
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

    setRemoteEquipState('shield', nextLeft === 'shield');
    setRemoteEquipState('sword', nextRight === 'sword');

    remotePlayer.model.userData.equippedWeaponType = nextRight || nextLeft || null;
  };

  const clearAllRemoteHeldWeaponMeshes = () => {
    Array.from(remoteHeldWeaponMeshes.keys()).forEach(disposeRemoteHeldWeaponMesh);
  };

  const { FoamSword, FOAM_SWORD_ITEM_ID, Shield, SHIELD_ITEM_ID, DEFAULT_SHIELD_HEALTH, Pistol } = await loadSpecialWeapons();

  foamSword = new FoamSword(scene);
  await foamSword.load();
  window.foamSword = foamSword;
  foamSword.onPickup = (holder) => {
    if (holder !== playerControls) return;
    const heldMesh = ensureLocalHeldWeaponMesh(foamSword, FOAM_SWORD_ITEM_ID);
    foamSword.useHeldMeshWhenHeld = true;
    if (heldMesh) heldMesh.visible = true;
    unequipOtherInventoryItems(FOAM_SWORD_ITEM_ID);
    addToInventory(FOAM_SWORD_ITEM_ID, 1);
    foamSword.localHoldOrigin = 'world';
    setPlayerWeaponType(holder, foamSword.type);
  };
  foamSword.onDrop = (holder, { removeFromInventory: shouldRemoveFromInventory } = {}) => {
    if (holder !== playerControls) return;
    foamSword.localHoldOrigin = null;
    if (shouldRemoveFromInventory) {
      removeFromInventory(FOAM_SWORD_ITEM_ID, 1);
    }
    clearPlayerWeaponType(holder, foamSword.type);
    if (foamSword.heldMesh) {
      foamSword.heldMesh.visible = false;
    }
    foamSword.useHeldMeshWhenHeld = true;
  };
  if (foamSword.mesh) {
    foamSword.mesh.visible = false;
  }

  pistol = new Pistol(scene);
  await pistol.load();
  window.pistol = pistol;
  if (pistol.mesh) {
    pistol.mesh.visible = false;
  }
  pistol.onPickup = () => {};
  pistol.onDrop = () => {};

  // Replace the pistol's box fallback with a gun-shaped procedural mesh
  if (pistol.mesh) {
    scene.remove(pistol.mesh);
    const _darkMetal = new THREE.MeshStandardMaterial({ color: 0x1c1c1c, roughness: 0.38, metalness: 0.85 });
    const _lightMetal = new THREE.MeshStandardMaterial({ color: 0x3a3a3a, roughness: 0.5, metalness: 0.7 });
    const hordeGunGroup = new THREE.Group();
    hordeGunGroup.name = 'horde-pistol';
    // Slide (top body)
    const slideMesh = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.055, 0.18), _darkMetal.clone());
    slideMesh.position.set(0, 0.01, 0);
    slideMesh.castShadow = true;
    hordeGunGroup.add(slideMesh);
    // Barrel
    const barrelGeo = new THREE.CylinderGeometry(0.009, 0.009, 0.07, 8);
    barrelGeo.rotateX(Math.PI / 2);
    const barrelMesh = new THREE.Mesh(barrelGeo, _darkMetal.clone());
    barrelMesh.position.set(0, 0.004, -0.125);
    barrelMesh.castShadow = true;
    hordeGunGroup.add(barrelMesh);
    // Frame / grip
    const frameMesh = new THREE.Mesh(new THREE.BoxGeometry(0.038, 0.095, 0.068), _lightMetal.clone());
    frameMesh.position.set(0, -0.065, 0.042);
    frameMesh.castShadow = true;
    hordeGunGroup.add(frameMesh);
    // Trigger guard (half-torus)
    const guardGeo = new THREE.TorusGeometry(0.018, 0.004, 6, 12, Math.PI);
    const guardMesh = new THREE.Mesh(guardGeo, _lightMetal.clone());
    guardMesh.position.set(0, -0.02, -0.01);
    guardMesh.rotation.set(0, 0, Math.PI / 2);
    guardMesh.castShadow = true;
    hordeGunGroup.add(guardMesh);
    // Sight (tiny nub on top)
    const sightMesh = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.01, 0.006), _darkMetal.clone());
    sightMesh.position.set(0, 0.042, -0.075);
    hordeGunGroup.add(sightMesh);
    hordeGunGroup.visible = false;
    scene.add(hordeGunGroup);
    pistol.mesh = hordeGunGroup;
  }

  let player = new PlayerCharacter(playerName);
  let playerModel = player.model;
  scene.add(playerModel);
  window.playerModel = playerModel;
  shield = new Shield(scene);
  await shield.load(playerModel.position.clone().add(new THREE.Vector3(2, 0, 2.4)));
  window.shield = shield;
  shield.onPickup = (holder) => {
    if (holder !== playerControls) return;
    const heldMesh = ensureLocalHeldWeaponMesh(shield, SHIELD_ITEM_ID);
    if (heldMesh) {
      shield.useHeldMeshWhenHeld = true;
      heldMesh.visible = true;
    }
    unequipOtherInventoryItems(SHIELD_ITEM_ID);
    const pickupHealth = normalizeShieldHealth(shield.mesh?.userData?.shieldHealth);
    addToInventory(SHIELD_ITEM_ID, 1);
    inventoryState[SHIELD_ITEM_ID] = ensureCatalogEntry(SHIELD_ITEM_ID, normalizeShieldEntry({
      ...inventoryState[SHIELD_ITEM_ID],
      [SHIELD_HEALTH_KEY]: pickupHealth
    }));
    shield.localHoldOrigin = 'world';
    window._enableWeaponGyroCamera?.();
  };
  shield.onDrop = (holder, { removeFromInventory: shouldRemoveFromInventory } = {}) => {
    if (holder !== playerControls) return;
    shield.localHoldOrigin = null;
    if (shouldRemoveFromInventory) {
      removeFromInventory(SHIELD_ITEM_ID, 1);
    }
  };
  runtimeContext.entities.weapons = { foamSword, pistol, shield };
  window.weapons = { foamSword, pistol, shield };
  if (shield.mesh) {
    shield.mesh.userData.shieldHealth = DEFAULT_SHIELD_HEALTH;
    shield.mesh.userData.shieldMaxHealth = DEFAULT_SHIELD_HEALTH;
    shield.mesh.visible = false;
  }

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

  const lastStatUpdateAt = Date.now();

  const statsState = {
    health: playerProfile.stats.health,
    maxHealthSegments: playerProfile.stats.maxHealthSegments,
    level: playerProfile.stats.level,
    strength: playerProfile.stats.strength,
    xp: playerProfile.stats.xp,
    coins: playerProfile.stats.coins,
    shieldUpgrades: playerProfile.stats.shieldUpgrades,
    bubbles: playerProfile.stats.bubbles,
    bombs: playerProfile.stats.bombs,
    showdownMaxHealthSegments: playerProfile.stats.showdownMaxHealthSegments
  };
  // Max health: SHOWDOWN_BASE_HEALTH_SEGMENTS at level 1. Profiles saved before Showdown had its own
  // track only have the regular value; convert it from the regular base (keeps level/Heart bonuses).
  {
    const storedShowdownMax = Math.round(statsState.showdownMaxHealthSegments || 0);
    const regularMax = Math.max(BASE_HEALTH_SEGMENTS, Math.round(statsState.maxHealthSegments || BASE_HEALTH_SEGMENTS));
    const showdownMax = storedShowdownMax > 0
      ? storedShowdownMax
      : regularMax - (BASE_HEALTH_SEGMENTS - SHOWDOWN_BASE_HEALTH_SEGMENTS);
    statsState.maxHealthSegments = Math.max(SHOWDOWN_BASE_HEALTH_SEGMENTS, Math.min(SHOWDOWN_MAX_HEALTH_SEGMENTS, showdownMax));
    statsState.showdownMaxHealthSegments = statsState.maxHealthSegments;
  }
  statsState.shieldUpgrades = Math.min(SHOWDOWN_MAX_SHIELD_UPGRADES, Math.max(0, Math.floor(statsState.shieldUpgrades || 0)));
  // Every session starts at full health, so a death saved by a previous game never leaves
  // the player dead (Continue? prompt) before the first stage.
  statsState.health = statsState.maxHealthSegments;
  const playerNameDisplay = document.getElementById('player-name-display');
  const playerLevelDisplay = document.getElementById('player-level');
  const levelPopup = document.getElementById('level-popup');
  const xpBar = document.getElementById('xp-bar');
  const xpBarFill = document.getElementById('xp-bar-fill');
  const xpGainText = document.getElementById('xp-gain');
  const xpLevelUpText = document.getElementById('xp-level-up');
  const coinPopup = document.getElementById('coin-popup');
  let levelPopupTimer = null;
  let coinPopupTimer = null;
  let xpBarHideTimer = null;
  let xpGainTimer = null;
  let xpLevelUpTimer = null;
  let xpAnimationRunning = false;
  let xpAnimationQueue = [];
  let displayedLevel = Number.isFinite(statsState.level) ? statsState.level : 1;
  let displayedXp = Number.isFinite(statsState.xp) ? statsState.xp : 0;
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
    levelPopup.textContent = `You've reached level ${level}! +1 ❤ Max Health`;
    // Restart the pop animation even if the popup is already showing
    levelPopup.classList.remove('visible');
    void levelPopup.offsetWidth;
    levelPopup.classList.add('visible');
    if (levelPopupTimer) {
      clearTimeout(levelPopupTimer);
    }
    levelPopupTimer = setTimeout(() => {
      levelPopup.classList.remove('visible');
      levelPopupTimer = null;
    }, 2200);
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
    xpLevelUpText.classList.remove('hidden');
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
        if (segmentStartXp >= nextLevelXp) {
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
  const SHIELD_HEALTH_KEY = 'shieldHealth';
  const SHIELD_MAX_HEALTH_KEY = 'shieldMaxHealth';
  // Each Sword Showdown "Shield Upgrade" purchase adds this much durability to every shield
  const SHIELD_UPGRADE_HEALTH = 10;
  const getShieldMaxHealth = () => DEFAULT_SHIELD_HEALTH
    + Math.max(0, Math.floor(statsState.shieldUpgrades || 0)) * SHIELD_UPGRADE_HEALTH;
  let lastEquippedBeforeShield = null;

  const updateShieldHealthHUD = (health, maxHealth, count) => {
    const display = document.getElementById('shield-health-display');
    const fill = document.getElementById('shield-health-bar-fill');
    const countEl = document.getElementById('shield-count-hud');
    if (!display || !fill) return;
    const safeMax = (Number.isFinite(maxHealth) && maxHealth > 0) ? maxHealth : getShieldMaxHealth();
    const ratio = Math.max(0, Math.min(1, (Number.isFinite(health) ? health : safeMax) / safeMax));
    fill.style.width = `${ratio * 100}%`;
    fill.style.background = ratio > 0.35
      ? 'linear-gradient(90deg, #43d15a, #2db347)'
      : 'linear-gradient(90deg, #ff5c45, #c62828)';
    if (countEl) countEl.textContent = (Number.isFinite(count) && count > 1) ? `×${count}` : '';
    display.classList.remove('hidden');
  };

  const hideShieldHealthHUD = () => {
    document.getElementById('shield-health-display')?.classList.add('hidden');
  };
  const normalizeShieldHealth = (value) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      return getShieldMaxHealth();
    }
    return Math.max(0, Math.min(getShieldMaxHealth(), numeric));
  };
  const normalizeShieldEntry = (entry = {}) => {
    const countValue = Number.isFinite(entry.count) ? Math.max(0, Math.floor(entry.count)) : 0;
    const health = normalizeShieldHealth(entry[SHIELD_HEALTH_KEY]);
    return {
      ...entry,
      count: countValue > 0 && health > 0 ? countValue : 0,
      [SHIELD_HEALTH_KEY]: health,
      [SHIELD_MAX_HEALTH_KEY]: getShieldMaxHealth()
    };
  };
  const inventoryCatalog = {
    [FOAM_SWORD_ITEM_ID]: {
      name: 'Foam Sword',
      icon: '/assets/ui/items/sword.png'
    },
    pistol: {
      name: 'Pistol',
      icon: ''
    },
    [SHIELD_ITEM_ID]: {
      name: 'Shield',
      icon: ''
    }
  };
  const ensureCatalogEntry = (itemId, entry) => {
    const itemConfig = inventoryCatalog[itemId] || {};
    return {
      ...entry,
      icon: entry?.icon || itemConfig.icon || '',
      name: entry?.name || itemConfig.name || itemId
    };
  };
  const inventoryState = { ...(playerProfile.inventory || {}) };
  let inventoryDirty = false;
  Object.entries(inventoryState).forEach(([itemId, entry]) => {
    const catalogEntry = ensureCatalogEntry(itemId, entry);
    const nextEntry = itemId === SHIELD_ITEM_ID
      ? normalizeShieldEntry(catalogEntry)
      : catalogEntry;
    const shieldHealthChanged = itemId === SHIELD_ITEM_ID
      && (nextEntry[SHIELD_HEALTH_KEY] !== entry?.[SHIELD_HEALTH_KEY]
        || nextEntry[SHIELD_MAX_HEALTH_KEY] !== entry?.[SHIELD_MAX_HEALTH_KEY]);
    if (nextEntry.name !== entry?.name || nextEntry.icon !== entry?.icon || shieldHealthChanged) {
      inventoryDirty = true;
    }
    inventoryState[itemId] = nextEntry;
  });
  if (inventoryState[SHIELD_ITEM_ID]?.name !== inventoryCatalog[SHIELD_ITEM_ID].name) {
    inventoryState[SHIELD_ITEM_ID] = normalizeShieldEntry({
      ...(inventoryState[SHIELD_ITEM_ID] || {}),
      name: inventoryCatalog[SHIELD_ITEM_ID].name
    });
    inventoryDirty = true;
  }
  // Ensure pistol ammo field exists if pistol is in inventory
  if (inventoryState.pistol?.count > 0 && !Number.isFinite(inventoryState.pistol?.[PISTOL_AMMO_KEY])) {
    inventoryState.pistol = {
      ...inventoryState.pistol,
      [PISTOL_AMMO_KEY]: DEFAULT_PISTOL_AMMO
    };
    inventoryDirty = true;
  }
  if (inventoryDirty) {
    saveStatsThrottled(profileNameKey, statsState, lastStatUpdateAt, inventoryState);
  }

  const equippableItems = new Set([SHIELD_ITEM_ID, FOAM_SWORD_ITEM_ID, 'pistol']);
  const inventoryHandSlots = {
    [SHIELD_ITEM_ID]: 'right',
    pistol: 'right',
    [FOAM_SWORD_ITEM_ID]: 'right',
  };
  const getInventoryItemHand = (itemId) => inventoryHandSlots[itemId] || null;
  const getInventoryItemActions = (itemId) => {
    if (itemId === 'pistol') {
      return ['equip'];
    }
    if (equippableItems.has(itemId)) {
      return ['drop', 'equip'];
    }
    return ['drop'];
  };

  function getInventory() {
    return inventoryState;
  }

  function persistInventory() {
    saveStatsThrottled(profileNameKey, statsState, lastStatUpdateAt, inventoryState);
    updateSettingsUI();
  }
  let pickupToastContainer = null;
  let pickupToastTimer = null;
  let pickupToastAnimateTimer = null;

  const getPickupFallbackIcon = (itemId) => {
    if (itemId === 'coins') return '🪙';
    if (itemId === SHIELD_ITEM_ID) return '🛡️';
    if (itemId === 'pistol') return '🔫';
    if (itemId === PISTOL_AMMO_KEY) return '🔶';
    if (itemId === 'bubble') return '🫧';
    if (itemId === 'showdown_bomb') return '💣';
    return '🎒';
  };

  // options.text replaces the default "Collected …" message; options.icon overrides the item icon
  const showPickupToast = (itemId, amount = 1, explicitLabel = '', options = {}) => {
    if (!itemId || !Number.isFinite(amount) || amount <= 0) return;
    if (!pickupToastContainer) {
      pickupToastContainer = document.createElement('div');
      pickupToastContainer.id = 'pickup-toast-container';
      document.body.appendChild(pickupToastContainer);
    }
    const entry = itemId === 'coins'
      ? { name: 'Coins', icon: '' }
      : ensureCatalogEntry(itemId, inventoryState[itemId]);
    const label = explicitLabel || entry?.name || itemId;
    const amountLabel = amount > 1 ? ` x${Math.floor(amount)}` : '';
    const iconText = getPickupFallbackIcon(itemId);
    const icon = options.icon || entry?.icon;
    const text = options.text || `Collected ${label}${amountLabel}`;
    pickupToastContainer.innerHTML = `
      <div class="pickup-toast">
        ${icon ? `<img src="${icon}" alt="" class="pickup-toast-icon">` : `<span class="pickup-toast-icon pickup-toast-icon-fallback">${iconText}</span>`}
        <span class="pickup-toast-text">${text}</span>
      </div>
    `;
    const toast = pickupToastContainer.querySelector('.pickup-toast');
    if (!toast) return;
    if (pickupToastAnimateTimer) clearTimeout(pickupToastAnimateTimer);
    pickupToastAnimateTimer = setTimeout(() => {
      requestAnimationFrame(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(-24px) scale(0.9)';
      });
    }, 2200);
    if (pickupToastTimer) clearTimeout(pickupToastTimer);
    pickupToastTimer = setTimeout(() => {
      pickupToastContainer.innerHTML = '';
    }, 3050);
  };

  function setPistolAmmoCount(amount) {
    if (!Number.isFinite(amount)) return;
    const normalized = Math.max(0, Math.floor(amount));
    const current = inventoryState.pistol || {};
    inventoryState.pistol = {
      ...current,
      [PISTOL_AMMO_KEY]: normalized,
      icon: current.icon || inventoryCatalog.pistol.icon,
      name: current.name || inventoryCatalog.pistol.name
    };
    persistInventory();
  }

  function getPistolAmmoCount() {
    return Number.isFinite(inventoryState.pistol?.[PISTOL_AMMO_KEY])
      ? inventoryState.pistol[PISTOL_AMMO_KEY]
      : 0;
  }

  function addPistolAmmo(amount) {
    if (!Number.isFinite(amount)) return;
    const nextAmount = getPistolAmmoCount() + amount;
    setPistolAmmoCount(nextAmount);
    if (amount > 0) showPickupToast(PISTOL_AMMO_KEY, amount, 'Bullets');
  }

  function seedPistolAmmoIfNeeded() {
    if (!Number.isFinite(inventoryState.pistol?.[PISTOL_AMMO_KEY])) {
      inventoryState.pistol = { ...inventoryState.pistol, [PISTOL_AMMO_KEY]: DEFAULT_PISTOL_AMMO };
    }
  }

  function addToInventory(itemId, amount = 1, options = {}) {
    if (!itemId || !Number.isFinite(amount) || amount <= 0) return;
    const current = inventoryState[itemId];
    const nextCount = (current?.count || 0) + amount;
    inventoryState[itemId] = ensureCatalogEntry(itemId, { ...current, count: nextCount });
    if (window.DEBUG_INVENTORY) {
      console.log('[inventory] added', itemId, amount, inventoryState[itemId]);
    }
    persistInventory();
    showPickupToast(itemId, amount);
  }

  function removeFromInventory(itemId, amount = 1) {
    if (!itemId || !Number.isFinite(amount) || amount <= 0) return;
    const current = inventoryState[itemId];
    if (!current) return;
    const nextCount = current.count - amount;
    if (nextCount > 0) {
      inventoryState[itemId] = { ...current, count: nextCount };
    } else {
      delete inventoryState[itemId];
    }
    if (window.DEBUG_INVENTORY) {
      console.log('[inventory] removed', itemId, amount, inventoryState[itemId]);
    }
    persistInventory();
  }

  function isInventoryItemEquipped(itemId) {
    if (itemId === SHIELD_ITEM_ID) {
      return shield?.holder === playerControls;
    }
    if (itemId === FOAM_SWORD_ITEM_ID) {
      return foamSword?.holder === playerControls;
    }
    if (itemId === 'pistol') {
      return pistol?.holder === playerControls;
    }
    return false;
  }

  function getEquippedInventoryItemIdForHand(hand) {
    if (hand === 'right') {
      if (isInventoryItemEquipped(FOAM_SWORD_ITEM_ID)) return FOAM_SWORD_ITEM_ID;
      if (isInventoryItemEquipped('pistol')) return 'pistol';
      if (isInventoryItemEquipped(SHIELD_ITEM_ID)) return SHIELD_ITEM_ID;
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
    // Capture the currently held right-hand item BEFORE unequipping it,
    // so we can restore it if the shield later breaks with no spares.
    if (itemId === SHIELD_ITEM_ID) {
      const currentRight = getEquippedInventoryItemIdForHand('right');
      if (currentRight && currentRight !== SHIELD_ITEM_ID) {
        lastEquippedBeforeShield = currentRight;
      }
    }
    unequipOtherInventoryItems(itemId);
    if (itemId === SHIELD_ITEM_ID) {
      if (!shield?.mesh || !playerControls) return;
      const entry = normalizeShieldEntry(inventoryState[SHIELD_ITEM_ID]);
      if (!entry.count || entry[SHIELD_HEALTH_KEY] <= 0) {
        delete inventoryState[SHIELD_ITEM_ID];
        persistInventory();
        return;
      }
      inventoryState[SHIELD_ITEM_ID] = ensureCatalogEntry(SHIELD_ITEM_ID, entry);
      const heldMesh = ensureLocalHeldWeaponMesh(shield, SHIELD_ITEM_ID, { forceNew: true });
      shield.useHeldMeshWhenHeld = true;
      if (heldMesh) {
        heldMesh.userData.shieldHealth = entry[SHIELD_HEALTH_KEY];
        heldMesh.userData.shieldMaxHealth = entry[SHIELD_MAX_HEALTH_KEY];
        heldMesh.visible = true;
      }
      shield.mesh.userData.shieldHealth = entry[SHIELD_HEALTH_KEY];
      shield.mesh.userData.shieldMaxHealth = entry[SHIELD_MAX_HEALTH_KEY];
      shield.mesh.visible = false;
      shield.localHoldOrigin = 'inventory';
      shield.holder = playerControls;
      updateShieldHealthHUD(entry[SHIELD_HEALTH_KEY], entry[SHIELD_MAX_HEALTH_KEY], entry.count);
      updateSettingsUI();
      return;
    }
    if (itemId === FOAM_SWORD_ITEM_ID) {
      if (!foamSword?.mesh || !playerControls) return;
      const heldMesh = ensureLocalHeldWeaponMesh(foamSword, FOAM_SWORD_ITEM_ID, { forceNew: true });
      foamSword.useHeldMeshWhenHeld = true;
      if (heldMesh) {
        heldMesh.visible = true;
      }
      foamSword.mesh.visible = false;
      foamSword.localHoldOrigin = 'inventory';
      foamSword.holder = playerControls;
      setPlayerWeaponType(playerControls, foamSword.type);
      if (playerControls.playerModel) {
        playerControls.playerModel.userData.handDepthOverride = {
          left: (palmX) => {
            const sideAmount = Math.abs(palmX - 0.5) * 2;
            return THREE.MathUtils.lerp(0.45, 0.1, sideAmount);
          }
        };
      }
      audioManager?.playSFX('SFX/Attacks/Sword Attacks Hits and Blocks/Sword Unsheath 1.ogg', 0.62, { cooldownKey: 'sword-equip', cooldownMs: 100 });
      updateSettingsUI();
    }
    if (itemId === 'pistol') {
      if (!pistol?.mesh || !playerControls) return;
      const heldMesh = ensureLocalHeldWeaponMesh(pistol, 'pistol', { forceNew: true });
      pistol.useHeldMeshWhenHeld = true;
      if (heldMesh) {
        heldMesh.visible = true;
      }
      pistol.mesh.visible = false;
      pistol.localHoldOrigin = 'inventory';
      pistol.holder = playerControls;
      setPlayerWeaponType(playerControls, pistol.type);
      // Pistol: fixed depth regardless of hand size
      if (playerControls.playerModel) {
        playerControls.playerModel.userData.handDepthOverride = { left: 0.3 };
      }
      playerControls.updateAmmoUI?.(true);
      playerControls.setAmmo?.(
        getPistolAmmoCount(),
        getAmmoLabelForType('bullet'),
        getAmmoIconForType('bullet')
      );
      window._enableWeaponGyroCamera?.();
      updateSettingsUI();
    }
  }

  function unequipInventoryItem(itemId) {
    if (itemId === SHIELD_ITEM_ID) {
      hideShieldHealthHUD();
      if (shield?.holder !== playerControls) return;
      shield.holder = null;
      shield.localHoldOrigin = null;
      if (shield.mesh) {
        shield.mesh.visible = false;
      }
      if (shield.heldMesh) {
        shield.heldMesh.visible = false;
      }
      playerControls?.disableGyroscope?.();
      updateSettingsUI();
      return;
    }
    if (itemId === FOAM_SWORD_ITEM_ID) {
      if (foamSword?.holder !== playerControls) return;
      foamSword.holder = null;
      foamSword.localHoldOrigin = null;
      if (foamSword.mesh) {
        foamSword.mesh.visible = false;
      }
      if (foamSword.heldMesh) {
        foamSword.heldMesh.visible = false;
      }
      if (playerControls.playerModel) {
        delete playerControls.playerModel.userData.handDepthOverride;
      }
      clearPlayerWeaponType(playerControls, foamSword.type);
      audioManager?.playSFX('SFX/Attacks/Sword Attacks Hits and Blocks/Sword Sheath 1.ogg', 0.58, { cooldownKey: 'sword-unequip', cooldownMs: 100 });
      updateSettingsUI();
    }
    if (itemId === 'pistol') {
      if (pistol?.holder !== playerControls) return;
      pistol.holder = null;
      pistol.localHoldOrigin = null;
      if (pistol.mesh) {
        pistol.mesh.visible = false;
      }
      if (pistol.heldMesh) {
        pistol.heldMesh.visible = false;
      }
      if (playerControls.playerModel) {
        delete playerControls.playerModel.userData.handDepthOverride;
      }
      clearPlayerWeaponType(playerControls, pistol.type);
      playerControls?.updateAmmoUI?.(false);
      playerControls?.disableGyroscope?.();
      updateSettingsUI();
    }
  }

  let playerDead = false;
  const updateControlAvailability = () => {
    if (!playerControls) return;
    playerControls.enabled = !playerDead;
  };

  const healthBar = document.getElementById('health-bar');
  const healthLabel = document.getElementById('health-label');
  function updateHealthUI() {
    if (!healthBar) return;
    const maxSegments = Math.max(SHOWDOWN_BASE_HEALTH_SEGMENTS, Math.round(statsState.maxHealthSegments || SHOWDOWN_BASE_HEALTH_SEGMENTS));
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

  const clampStat = (key, value) => {
    if (key === 'health') {
      const num = Number(value);
      if (!Number.isFinite(num)) {
        return 0;
      }
      return clampHealthSegments(num, statsState.level, statsState.maxHealthSegments);
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
      if (!Number.isFinite(num)) return SHOWDOWN_BASE_HEALTH_SEGMENTS;
      return Math.max(SHOWDOWN_BASE_HEALTH_SEGMENTS, Math.min(SHOWDOWN_MAX_HEALTH_SEGMENTS, Math.round(num)));
    }
    if (key === 'xp') {
      const num = Number(value);
      if (!Number.isFinite(num)) {
        return 0;
      }
      return Math.max(0, Math.floor(num));
    }
    if (key === 'coins' || key === 'shieldUpgrades' || key === 'bubbles' || key === 'bombs') {
      const num = Number(value);
      if (!Number.isFinite(num)) {
        return 0;
      }
      if (key === 'shieldUpgrades') return Math.min(SHOWDOWN_MAX_SHIELD_UPGRADES, Math.max(0, Math.floor(num)));
      return Math.max(0, Math.floor(num));
    }
    return value;
  };

  function setStat(key, value, { skipSave = false } = {}) {
    const prevValue = statsState[key];
    statsState[key] = clampStat(key, value);
    if (key === 'health') {
      triggerPlayerHurtBlood(prevValue, statsState[key]);
      updateHealthUI();
    }
    if (key === 'level') {
      updatePlayerInfoUI();
      statsState.health = clampHealthSegments(statsState.health, statsState.level, statsState.maxHealthSegments);
      updateHealthUI();
    }
    if (key === 'maxHealthSegments') {
      statsState.health = clampHealthSegments(statsState.health, statsState.level, statsState.maxHealthSegments);
      updateHealthUI();
    }
    if (!skipSave) {
      saveStatsThrottled(profileNameKey, statsState, lastStatUpdateAt);
    }
  }

  const playerBloodOrigin = new THREE.Vector3();
  const triggerPlayerHurtBlood = (previousHealth, nextHealth) => {
    if (!Number.isFinite(previousHealth) || !Number.isFinite(nextHealth)) return;
    if (nextHealth >= previousHealth || !playerModel?.parent) return;
    playerModel.getWorldPosition(playerBloodOrigin);
    const groundY = playerBloodOrigin.y;
    playerBloodOrigin.y += 0.85;
    const intensity = THREE.MathUtils.clamp((previousHealth - nextHealth) / 2, 0.6, 2);
    spawnBloodBurst(scene, playerBloodOrigin, { groundY, intensity });
    if (nextHealth <= 0) audioManager?.playOuch('playerDeath', 'ouch-player');
    else audioManager?.playOuch('player', 'ouch-player');
  };

  window.setStat = setStat;
  window.getPlayerStrength = () => {
    return Number.isFinite(statsState.strength) ? statsState.strength : 0;
  };

  // Each level grants one extra health segment
  const queueLevelUpChoices = (fromLevel, toLevel) => {
    if (!Number.isFinite(fromLevel) || !Number.isFinite(toLevel) || toLevel <= fromLevel) {
      return;
    }
    const gained = toLevel - fromLevel;
    setStat('maxHealthSegments', statsState.maxHealthSegments + gained, { skipSave: true });
    setStat('health', statsState.health + gained, { skipSave: true });
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
  window.onPlayerKill = () => {
    const currentLevel = Number.isFinite(statsState.level) ? statsState.level : 1;
    addPlayerXp(currentLevel * 100);
  };
  window.onPlayerDeath = () => {};

  // Sword Showdown XP rewards (scale with stage so the level curve keeps pace)
  const getSwordShowdownKillXp = (stage) => 10 + Math.max(1, Math.floor(stage || 1));
  const getSwordShowdownStageXp = (stage) => 100 + Math.max(1, Math.floor(stage || 1)) * 20;

  // ── Sword Showdown: protective bubble ─────────────────────────────────────
  // While active, a sphere surrounds the player: enemy swords bounce off it,
  // enemy bombs are deflected back from any direction, and no damage lands.
  const BUBBLE_DURATION_MS = 10000;
  const BUBBLE_RADIUS = 1.3;
  const BUBBLE_CENTER_HEIGHT = 0.9;
  let bubbleActiveUntil = 0;
  let bubbleMesh = null;
  const isPlayerBubbleActive = () => Date.now() < bubbleActiveUntil && !playerDead;
  const getBubbleCount = () => Math.max(0, Math.floor(statsState.bubbles || 0));
  const ensureBubbleMesh = () => {
    if (bubbleMesh) return bubbleMesh;
    bubbleMesh = new THREE.Mesh(
      new THREE.SphereGeometry(BUBBLE_RADIUS, 32, 20),
      new THREE.MeshPhongMaterial({
        color: 0x7fd8ff,
        emissive: 0x1a5f8a,
        specular: 0xffffff,
        shininess: 90,
        transparent: true,
        opacity: 0.28,
        depthWrite: false,
        side: THREE.DoubleSide
      })
    );
    bubbleMesh.name = 'PlayerBubble';
    bubbleMesh.renderOrder = 10;
    bubbleMesh.visible = false;
    scene.add(bubbleMesh);
    return bubbleMesh;
  };
  const getPlayerBubbleCenter = (target = new THREE.Vector3()) => (
    target.copy(playerModel.position).setY(playerModel.position.y + BUBBLE_CENTER_HEIGHT)
  );
  const activatePlayerBubble = () => {
    if (playerDead || isPlayerBubbleActive()) return false;
    if (getBubbleCount() <= 0) return false;
    setStat('bubbles', getBubbleCount() - 1, { skipSave: true });
    saveStatsThrottled(profileNameKey, statsState, lastStatUpdateAt);
    bubbleActiveUntil = Date.now() + BUBBLE_DURATION_MS;
    ensureBubbleMesh().visible = true;
    audioManager?.playSFX?.('SFX/Spells/Waterspray 1.ogg', 0.6, { cooldownKey: 'player-bubble', cooldownMs: 200 });
    updatePsBubbleButton();
    return true;
  };
  const deactivatePlayerBubble = () => {
    bubbleActiveUntil = 0;
    if (bubbleMesh) bubbleMesh.visible = false;
    updatePsBubbleButton();
  };
  let lastPsBubbleButtonLabel = '';
  const updatePsBubbleButton = () => {
    const button = playerControls?.psBubbleBtn;
    if (!button) return;
    const active = isPlayerBubbleActive();
    const label = active
      ? `🫧 ${Math.ceil((bubbleActiveUntil - Date.now()) / 1000)}s`
      : `🫧 ${getBubbleCount()}`;
    if (label !== lastPsBubbleButtonLabel) {
      button.textContent = label;
      lastPsBubbleButtonLabel = label;
    }
    button.classList.toggle('ps-bubble-active', active);
    button.classList.toggle('ps-bubble-empty', !active && getBubbleCount() <= 0);
  };
  const updatePlayerBubble = () => {
    if (!bubbleMesh?.visible && !bubbleActiveUntil) {
      updatePsBubbleButton();
      return;
    }
    if (!isPlayerBubbleActive()) {
      deactivatePlayerBubble();
      return;
    }
    getPlayerBubbleCenter(bubbleMesh.position);
    const remaining = bubbleActiveUntil - Date.now();
    const pulse = 1 + Math.sin(performance.now() * 0.006) * 0.03;
    bubbleMesh.scale.setScalar(pulse);
    // Blink during the last 2 seconds as a warning that the bubble is about to pop
    bubbleMesh.material.opacity = remaining < 2000 && Math.floor(remaining / 150) % 2 === 0 ? 0.1 : 0.28;
    updatePsBubbleButton();
  };
  window.isPlayerBubbleActive = isPlayerBubbleActive;
  window.getPlayerBubbleRadius = () => (isPlayerBubbleActive() ? BUBBLE_RADIUS : 0);
  window.getPlayerBubbleCenter = getPlayerBubbleCenter;

  // Sword Showdown tutorial (created further down); while it runs the player can't be hurt
  let showdownTutorial = null;
  Object.defineProperty(window, 'localHealth', {
    configurable: true,
    get: () => statsState.health,
    set: value => {
      // The protective bubble absorbs all incoming damage
      if (isPlayerBubbleActive() && Number(value) < statsState.health) return;
      // Tutorial: show the hit, keep health full
      if (showdownTutorial?.isActive() && Number(value) < statsState.health) {
        triggerPlayerHurtBlood(statsState.health, Math.max(1, Number(value) || 0));
        showdownTutorial.notifyPlayerHurt();
        return;
      }
      setStat('health', value);
    }
  });

  const shieldBlockTempForward = new THREE.Vector3();
  const shieldBlockTempToAttacker = new THREE.Vector3();
  const isAttackerInShieldBlockArc = (attackerModel) => {
    if (!attackerModel?.position || !playerModel?.position) return false;
    shieldBlockTempToAttacker.subVectors(attackerModel.position, playerModel.position);
    shieldBlockTempToAttacker.y = 0;
    if (shieldBlockTempToAttacker.lengthSq() < 0.0001) return true;
    shieldBlockTempToAttacker.normalize();
    if (typeof playerModel.getWorldDirection === 'function') {
      playerModel.getWorldDirection(shieldBlockTempForward);
    } else {
      shieldBlockTempForward.copy(playerModel.userData?.direction || new THREE.Vector3(0, 0, 1));
    }
    shieldBlockTempForward.y = 0;
    if (shieldBlockTempForward.lengthSq() < 0.0001) {
      shieldBlockTempForward.copy(playerModel.userData?.direction || new THREE.Vector3(0, 0, 1));
      shieldBlockTempForward.y = 0;
    }
    if (shieldBlockTempForward.lengthSq() < 0.0001) shieldBlockTempForward.set(0, 0, 1);
    shieldBlockTempForward.normalize();
    return shieldBlockTempForward.dot(shieldBlockTempToAttacker) > 0.2;
  };

  const damageEquippedShield = (damage = 1) => {
    const currentEntry = normalizeShieldEntry(inventoryState[SHIELD_ITEM_ID]);
    if (!currentEntry.count || currentEntry[SHIELD_HEALTH_KEY] <= 0) return false;
    const currentHealth = currentEntry[SHIELD_HEALTH_KEY];
    const nextHealth = Math.max(0, currentHealth - Math.max(1, Math.round(damage)));
    if (shield?.mesh) {
      shield.mesh.userData.shieldHealth = nextHealth;
      shield.mesh.userData.shieldMaxHealth = getShieldMaxHealth();
    }
    if (shield?.heldMesh) {
      shield.heldMesh.userData.shieldHealth = nextHealth;
      shield.heldMesh.userData.shieldMaxHealth = getShieldMaxHealth();
    }
    shield?.showHealthBar?.(nextHealth, getShieldMaxHealth());
    if (nextHealth <= 0) {
      hideShieldHealthHUD();
      const prevCount = currentEntry.count;
      if (prevCount > 1) {
        // Consume the broken shield, reset health for the next one in inventory
        const nextEntry = normalizeShieldEntry({
          ...currentEntry,
          count: prevCount - 1,
          [SHIELD_HEALTH_KEY]: getShieldMaxHealth(),
          [SHIELD_MAX_HEALTH_KEY]: getShieldMaxHealth()
        });
        inventoryState[SHIELD_ITEM_ID] = ensureCatalogEntry(SHIELD_ITEM_ID, nextEntry);
        persistInventory();
        // Brief unequip then re-equip a fresh shield
        unequipInventoryItem(SHIELD_ITEM_ID);
        setTimeout(() => {
          if (inventoryState[SHIELD_ITEM_ID]?.count > 0) {
            equipInventoryItem(SHIELD_ITEM_ID);
          }
        }, 400);
      } else {
        // Last shield consumed — remove and restore previous item
        delete inventoryState[SHIELD_ITEM_ID];
        persistInventory();
        const restoreItemId = lastEquippedBeforeShield;
        lastEquippedBeforeShield = null;
        unequipInventoryItem(SHIELD_ITEM_ID);
        if (restoreItemId && inventoryState[restoreItemId]?.count > 0) {
          setTimeout(() => {
            equipInventoryItem(restoreItemId);
          }, 400);
        }
      }
    } else {
      const nextEntry = normalizeShieldEntry({
        ...currentEntry,
        [SHIELD_HEALTH_KEY]: nextHealth
      });
      inventoryState[SHIELD_ITEM_ID] = ensureCatalogEntry(SHIELD_ITEM_ID, nextEntry);
      updateShieldHealthHUD(nextHealth, getShieldMaxHealth(), nextEntry.count);
      persistInventory();
    }
    return true;
  };

  window.tryBlockLocalPlayerHitWithShield = ({ attackerModel, damage } = {}) => {
    if (shield?.holder !== playerControls || !inventoryState[SHIELD_ITEM_ID]?.count) return false;
    if (!isAttackerInShieldBlockArc(attackerModel)) return false;
    return damageEquippedShield(damage);
  };

  updateHealthUI();
  function spawnProjectileWithPerfFlags(...args) {
    spawnProjectile(...args);
    const latest = projectiles[projectiles.length - 1];
    if (latest) {
      latest.userData.skipTerrainCorrection = true;
    }
  }

  function asVec3(p) {
    return p?.isVector3 ? p.clone()
      : p && Number.isFinite(p.x) && Number.isFinite(p.z) ? new THREE.Vector3(p.x, p.y ?? 0, p.z)
      : null;
  }

  function resolveSpawnY(position, offset) {
    if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.z)) return null;
    return getSpawnY(position.x, position.z, offset);
  }

  function applySpawnY(position, offset) {
    const resolvedY = resolveSpawnY(position, offset);
    if (!Number.isFinite(resolvedY)) return false;
    position.y = resolvedY;
    return true;
  }

  function getAmmoLabelForType() {
    return 'Bullets';
  }

  function getAmmoIconForType() {
    return '🔫';
  }

  // `value` = coins this pickup is worth (tutorial coins are worth more than 1)
  function spawnCoinPickup(position, { value = COIN_PICKUP_GAIN } = {}) {
    const spawnPos = asVec3(position);
    if (!spawnPos) return;
    if (!applySpawnY(spawnPos, 0.6)) return null;

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
    pickup.userData.value = value;
    pickup.rotation.x = Math.PI / 2;
    scene.add(pickup);
    coinPickups.push(pickup);
    return pickup;
  }

  const disposePickup = (pickup) => {
    scene.remove(pickup);
    pickup.geometry?.dispose();
    pickup.material?.dispose();
  };

  function applyCoinPickupEffects(value = COIN_PICKUP_GAIN) {
    const nextCoins = (Number.isFinite(statsState.coins) ? statsState.coins : 0) + value;
    setStat('coins', nextCoins, { skipSave: true });
    saveStatsThrottled(profileNameKey, statsState, lastStatUpdateAt);
    showCoinPopup(statsState.coins);
    showPickupToast('coins', value);
  }

  playerControls = new PlayerControls({
    scene,
    camera,
    playerModel,
    renderer,
    multiplayer,
    spawnProjectile: spawnProjectileWithPerfFlags,
    projectiles,
    audioManager,
    onAmmoChange: (amount) => setPistolAmmoCount(amount)
  });
  playerControls.getInventoryItemHand = (itemId) => getInventoryItemHand(itemId);

  runtimeContext.systems.playerControls = playerControls;
  window.playerControls = playerControls;

  // ── Player physics collider ────────────────────────────────────────────────
  // Kinematic body that follows the visual model; impulse hits are handled
  // visually via _playerKnockback in the game loop.
  if (rapierWorld) {
    const playerPos = playerModel.position;
    const playerRbDesc = RAPIER.RigidBodyDesc.kinematicPositionBased()
      .setTranslation(playerPos.x, playerPos.y + 0.6, playerPos.z);
    const playerRb = rapierWorld.createRigidBody(playerRbDesc);
    const playerColDesc = RAPIER.ColliderDesc.capsule(0.6, 0.28)
      .setFriction(0.5)
      .setRestitution(0.1);
    rapierWorld.createCollider(playerColDesc, playerRb);
    playerControls.body = playerRb;
    window.playerRigidBody = playerRb;
  }
  // Knockback velocity applied directly to player position in the game loop
  const _playerKnockback = { vx: 0, vy: 0, vz: 0, endTime: 0 };

  updateControlAvailability();

  // Always start with the foam sword equipped (gun and shield are bought in the shop).
  if (!(inventoryState[FOAM_SWORD_ITEM_ID]?.count > 0)) {
    inventoryState[FOAM_SWORD_ITEM_ID] = ensureCatalogEntry(FOAM_SWORD_ITEM_ID, { count: 1 });
  }
  equipInventoryItem(FOAM_SWORD_ITEM_ID);

  // ── Horde-mode enemy players ───────────────────────────────────────────────
  const hordeEnemies = [];
  // Stage difficulty: how many swordsmen may attack at once (1 through stage 7, then +1
  // every 4 stages up to 4) and how often an attacking swordsman swings instead of
  // blocking/idling (20% at stage 1, rising to 60% by stage 21).
  const _psMaxAttackers = (stage) => (stage <= 7 ? 1 : Math.min(4, 2 + Math.floor((stage - 8) / 4)));
  const _psSwingChance = (stage) => Math.min(0.6, 0.2 + Math.max(0, stage - 1) * 0.02);
  const _spawnHordeEnemy = (opts = {}) => {
    const angle = Math.random() * Math.PI * 2;
    const dist  = 5 + Math.random() * 4;
    const spawnOffset = new THREE.Vector3(Math.cos(angle) * dist, 0, Math.sin(angle) * dist);
    const spawnPos = opts.position ?? playerModel.position.clone().add(spawnOffset);
    let enemy;
    if (opts.bombThrower) {
      enemy = new BombThrowerEnemy(scene, RAPIER, rapierWorld, {
        position: spawnPos,
        hearts: opts.hearts ?? 3,
        speedScale: opts.speedScale ?? 1.0,
        getBlastTargets: () => hordeEnemies,
        onBlastPlayer: _blastPlayer,
      });
    } else {
      enemy = new EnemyPlayer(scene, RAPIER, rapierWorld, {
        position: spawnPos,
        hearts: opts.hearts ?? 3,
        speedScale: opts.speedScale ?? 1.0,
        swingChance: opts.swingChance ?? _psSwingChance(_psStage),
      });
      enemy._camera = camera;
    }
    hordeEnemies.push(enemy);
    return enemy;
  };

  // ── Phone Sword: stage progression system ─────────────────────────────────
  const _psStageLsKey = () => profileNameKey ? `ps_stage_${profileNameKey}` : null;
  const _psSavedStage = () => { try { const k = _psStageLsKey(); return k ? (parseInt(localStorage.getItem(k), 10) || 1) : 1; } catch (_) { return 1; } };
  const _psSaveStage = (s) => {
    try { const k = _psStageLsKey(); if (k) localStorage.setItem(k, s); } catch (_) {}
    if (profileNameKey) {
      void savePhoneSwordStage(profileNameKey, s);
      // Also update highestStage in phoneSwordStats
      if (s > (_psStats.highestStage || 1)) {
        _psStats.highestStage = s;
        void savePhoneSwordStats(profileNameKey, { ..._psStats });
      }
    }
  };
  // Phone sword session stats (kills, deaths, highestStage)
  let _psStats = { kills: 0, deaths: 0, highestStage: 1 };
  // Load stage from Firebase first (async), fallback to localStorage
  let _psStage = _psSavedStage();
  let _psEnemyQueue = [];   // [{pos: THREE.Vector3, hearts: number, triggerDist: number}]
  let _psJumpVelY = 0;       // vertical velocity for phone sword jump
  let _psGroundY = null;     // ground Y level for phone sword mode
  const PS_JUMP_FORCE = 8.5; // initial upward speed m/s
  const PS_GRAVITY = 20;     // gravity m/s²

  // Bomb blast on the player: thrown back (and up, in Sword Showdown) a little harder than an
  // enemy's death knockback, playing the flying-back death clip once before getting back up.
  const PLAYER_BLAST_SPEED = 9;       // m/s horizontal, decays over PLAYER_BLAST_MS
  const PLAYER_BLAST_UP = 5;          // m/s upward pop (Sword Showdown jump physics)
  const PLAYER_BLAST_MS = 900;
  const PLAYER_BLAST_STUN_MS = 2000;  // flying-back clip time before getting up
  let _playerBlastReviveTimer = null;
  function _blastPlayer(direction, falloff = 1) {
    if (playerDead || !direction) return;
    const k = THREE.MathUtils.clamp(falloff, 0, 1);
    _playerKnockback.vx = direction.x * PLAYER_BLAST_SPEED * k;
    _playerKnockback.vz = direction.z * PLAYER_BLAST_SPEED * k;
    _playerKnockback.endTime = Date.now() + PLAYER_BLAST_MS;
    if (k > 0) {
      _psJumpVelY = Math.max(_psJumpVelY, PLAYER_BLAST_UP * k);
      window.phoneSwordAirborne = true;
    }
    const glbCharacter = playerModel.userData.qwopRig?.glbCharacter;
    if (!glbCharacter) return;
    glbCharacter.playDeath();
    clearTimeout(_playerBlastReviveTimer);
    _playerBlastReviveTimer = setTimeout(() => {
      _playerBlastReviveTimer = null;
      if (!playerDead) glbCharacter.revive();
    }, PLAYER_BLAST_STUN_MS);
  }

  // ── Sword Showdown: player bombs (bought in the shop, thrown with the 💣 button) ──
  // Throwing puts away whatever is held, plays Throw.fbx (bomb in the right palm until
  // the release point) and re-equips it once the clip is over. The bomb flies and blasts
  // like a bomber's (combat/playerBomb.js).
  const PLAYER_BOMB_THROW_DIST = 8;         // m ahead of the player where the bomb lands
  const PLAYER_BOMB_RELEASE_AT = 0.3;       // fraction of Throw.fbx where the bomb leaves the hand
  const PLAYER_BOMB_WINDUP_MS = 700;        // release time when the character hasn't loaded
  const PLAYER_BOMB_CLIP_TIMEOUT_MS = 2500; // release anyway if the clip is slow to load
  const PLAYER_BOMB_HAND = 'left';          // mirrored label: the anatomical right arm
  const playerBombs = createPlayerBombs({ scene, getBlastTargets: () => hordeEnemies });
  const _playerBombPalm = new THREE.Vector3();
  const _playerBombForward = new THREE.Vector3();
  let playerBombThrow = null; // { restoreIds, startedAt, usesClip, released }
  const getPlayerBombCount = () => Math.max(0, Math.floor(statsState.bombs || 0));
  let lastPsBombButtonLabel = '';
  const updatePsBombButton = () => {
    const button = playerControls?.psBombBtn;
    if (!button) return;
    const label = `💣 ${getPlayerBombCount()}`;
    if (label !== lastPsBombButtonLabel) {
      button.textContent = label;
      lastPsBombButtonLabel = label;
    }
    button.classList.toggle('ps-bomb-active', !!playerBombThrow);
    button.classList.toggle('ps-bomb-empty', !playerBombThrow && getPlayerBombCount() <= 0);
  };
  const throwPlayerBomb = () => {
    if (!playerBombs || playerDead || playerBombThrow) return false;
    if (getPlayerBombCount() <= 0) return false;
    const glbCharacter = playerModel.userData.qwopRig?.glbCharacter;
    if (glbCharacter?.isDead) return false; // knocked down by a blast
    setStat('bombs', getPlayerBombCount() - 1, { skipSave: true });
    saveStatsThrottled(profileNameKey, statsState, lastStatUpdateAt);
    const restoreIds = getEquippedInventoryItemIds();
    restoreIds.forEach((itemId) => unequipInventoryItem(itemId));
    playerControls?.refreshActionButtons?.();
    playerBombThrow = { restoreIds, startedAt: Date.now(), usesClip: !!glbCharacter, released: false };
    glbCharacter?.playAction(glbCharacterConfig.throwClip);
    updatePsBombButton();
    return true;
  };
  const releasePlayerBomb = () => {
    const glbCharacter = playerModel.userData.qwopRig?.glbCharacter;
    if (glbCharacter) {
      glbCharacter.getPalmWorldPosition(PLAYER_BOMB_HAND, _playerBombPalm);
    } else {
      _playerBombPalm.copy(playerModel.position);
      _playerBombPalm.y += 0.75;
    }
    playerModel.getWorldDirection(_playerBombForward).setY(0);
    if (_playerBombForward.lengthSq() < 1e-6) _playerBombForward.set(0, 0, 1);
    _playerBombForward.normalize();
    const target = playerModel.position.clone().addScaledVector(_playerBombForward, PLAYER_BOMB_THROW_DIST);
    const groundY = getTerrainHeight(target.x, target.z);
    if (Number.isFinite(groundY)) target.y = groundY;
    playerBombs.throw(_playerBombPalm, target);
  };
  const finishPlayerBombThrow = () => {
    const { restoreIds } = playerBombThrow;
    playerBombThrow = null;
    playerBombs.setHeld(null);
    // Put back what was held, unless something else got equipped during the throw
    if (!playerDead && getEquippedInventoryItemIds().length === 0) {
      restoreIds.forEach((itemId) => {
        if (inventoryState[itemId]?.count > 0) equipInventoryItem(itemId);
      });
      playerControls?.refreshActionButtons?.();
    }
    updatePsBombButton();
  };
  const updatePlayerBombs = (dt) => {
    if (!playerBombs) return;
    playerBombs.update(dt);
    const t = playerBombThrow;
    if (!t) {
      updatePsBombButton();
      return;
    }
    if (playerDead) {
      // Respawn re-equips the sword
      playerBombThrow = null;
      playerBombs.setHeld(null);
      updatePsBombButton();
      return;
    }
    const glbCharacter = playerModel.userData.qwopRig?.glbCharacter;
    if (!t.released) {
      if (glbCharacter?.isDead) {
        // Blasted off our feet mid-windup: throw cancelled, bomb refunded
        setStat('bombs', getPlayerBombCount() + 1, { skipSave: true });
        finishPlayerBombThrow();
        return;
      }
      const now = Date.now();
      const release = t.usesClip && glbCharacter
        ? glbCharacter.actionProgress >= PLAYER_BOMB_RELEASE_AT || !glbCharacter.actionActive ||
          now >= t.startedAt + PLAYER_BOMB_WINDUP_MS + PLAYER_BOMB_CLIP_TIMEOUT_MS
        : now >= t.startedAt + PLAYER_BOMB_WINDUP_MS;
      if (release) {
        t.released = true;
        releasePlayerBomb();
      } else {
        playerBombs.setHeld(glbCharacter ? glbCharacter.getPalmWorldPosition(PLAYER_BOMB_HAND, _playerBombPalm) : null);
      }
    }
    if (t.released && !glbCharacter?.actionActive) finishPlayerBombThrow();
  };
  let _psPathEnd = new THREE.Vector3();
  let _psAutoWalking = false;
  let _psAutoWalkDir = new THREE.Vector3();
  let _psStageActive = false;
  let _psWinShown = false;
  let _psStageKills = 0;       // enemies killed this stage
  let _psStageTotal = 0;       // enemies in this stage
  let _psKillHud = null;
  const _psUpdateKillHud = (visible = true) => {
    if (!_psKillHud) {
      _psKillHud = document.createElement('div');
      _psKillHud.id = 'ps-kill-counter';
      _psKillHud.className = 'ps-kill-counter hidden';
      _psKillHud.setAttribute('aria-live', 'polite');
      document.body.appendChild(_psKillHud);
    }
    _psKillHud.textContent = `⚔️ ${Math.min(_psStageKills, _psStageTotal)} / ${_psStageTotal}`;
    _psKillHud.classList.toggle('hidden', !visible);
  };
  const PS_SPEED = 1.1;        // auto-walk speed (m/s) — roughly 1/3 of normal walk speed
  const PS_ENEMY_SPEED = 1.0 / 3.0;   // enemy speed multiplier (1/3 of normal)
  const PS_SPAWN_TRIGGER_DIST = 18;    // spawn enemy when player gets within this distance

  // Camera auto-aim state for phone sword mode
  let _psCamTarget = null;           // currently tracked enemy
  let _psCamCandidate = null;        // new closest enemy being evaluated
  let _psCamCandidateTime = 0;       // when candidate first became closest
  let _psCamManualUntil = 0;         // timestamp until which manual camera override is active
  let _psCamLastYaw = null;          // yaw we set last frame (to detect manual camera changes)
  const PS_CAM_MANUAL_TIMEOUT = 5000;   // ms of inactivity before auto-aim resumes
  const PS_CAM_SWITCH_MIN_CLOSER = 3.0; // new target must be this many metres closer to switch immediately
  const PS_CAM_SWITCH_STABLE_MS = 2000; // or must be closest for this long
  const PS_INCOMING_BOMB_RANGE = 25;    // m — bombs farther than this are ignored

  /**
   * Closest in-flight enemy bomb that is heading toward the player (not yet
   * deflected, horizontal velocity pointing at the player), or null.
   * While one exists the camera tracks it and sword enemies hold their attacks.
   */
  function _psFindIncomingBomb() {
    const bombs = window._enemyBombs;
    if (!playerModel || !Array.isArray(bombs) || bombs.length === 0) return null;
    let closest = null;
    let closestDist = PS_INCOMING_BOMB_RANGE;
    for (const b of bombs) {
      if (!b || b.deflected || !b.mesh) continue;
      const bp = b.mesh.position;
      const dx = playerModel.position.x - bp.x;
      const dz = playerModel.position.z - bp.z;
      if (b.vel.x * dx + b.vel.z * dz <= 0) continue; // moving away / past the player
      const d = Math.hypot(dx, dz);
      if (d < closestDist) { closestDist = d; closest = b; }
    }
    return closest;
  }

  // Phone Sword: time-of-day choice ('random', 'day', 'night') and current stage night flag
  let _psTimePref = 'random';
  let _psCurrentIsNight = false;

  // Phone Sword: song shuffling
  const PS_DAY_SONGS   = ['Songs/day1.ogg','Songs/day2.ogg','Songs/day3.ogg','Songs/day4.ogg','Songs/day5.ogg','Songs/day6.ogg'];
  const PS_NIGHT_SONGS = ['Songs/night1.ogg','Songs/night2.ogg'];
  let _psSongAudio = null;
  let _psSongPool  = [];

  const _psGetNextSong = (isNight) => {
    const src = isNight ? PS_NIGHT_SONGS : PS_DAY_SONGS;
    if (_psSongPool.length === 0) _psSongPool = [...src];
    const idx = Math.floor(Math.random() * _psSongPool.length);
    const song = _psSongPool.splice(idx, 1)[0];
    return song;
  };

  const _psPlayNextSong = (isNight) => {
    const song = _psGetNextSong(isNight);
    if (!_psSongAudio) {
      _psSongAudio = new Audio(`assets/audio/${song}`);
      audioManager.phoneSwordAudio = _psSongAudio;
    } else {
      _psSongAudio.pause();
      _psSongAudio.src = `assets/audio/${song}`;
      _psSongAudio.currentTime = 0;
    }
    _psSongAudio.volume = audioManager.musicVolume;
    _psSongAudio.onended = () => { if (_psStageActive) _psPlayNextSong(isNight); };
    _psSongAudio.play().catch(() => {});
  };

  const _psStopSong = () => {
    if (_psSongAudio) {
      _psSongAudio.onended = null;
      _psSongAudio.pause();
      _psSongAudio.currentTime = 0;
    }
    _psSongPool = [];
  };

  const _psStageOverlay = document.getElementById('ps-stage-overlay');
  const _psStageBadge   = document.getElementById('ps-stage-badge');
  const _psStageEnemies = document.getElementById('ps-stage-enemies');
  const _psStageOkBtn   = document.getElementById('ps-stage-ok');
  const _psWinOverlay   = document.getElementById('ps-win-overlay');
  const _psWinTitle     = document.getElementById('ps-win-title');
  const _psWinSub       = document.getElementById('ps-win-sub');

  // Stage 1: exactly 15 enemies; +1 per stage after that (plus a little randomness), capped at 45.
  const _psEnemyCount = (stage) => (stage <= 1
    ? 15
    : Math.min(45, 15 + (stage - 1) + Math.floor(Math.random() * 3)));

  // Stage 1: every enemy has 1 heart. Each later stage raises the chance of 2+ hearts
  // (+8%/stage, max 90%) and, from stage 5, of 3 hearts (+4%/stage, max 60%).
  const _psHeartsForStage = (stage) => {
    const pTwoPlus = Math.min(0.9, Math.max(0, stage - 1) * 0.08);
    const pThree = Math.min(0.6, Math.max(0, stage - 4) * 0.04);
    const r = Math.random();
    if (r < pThree) return 3;
    if (r < pTwoPlus) return 2;
    return 1;
  };

  // Steepest ground step (m per PS_PATH_SAMPLE_STEP) along a straight line from the player,
  // or Infinity if the line leaves the map. Bails early once it exceeds `giveUpAbove`.
  const PS_PATH_CANDIDATES = 24;
  const PS_PATH_SAMPLE_STEP = 1;      // m between height samples
  const PS_PATH_MAX_OK_STEP = 0.35;   // m rise per metre (~19°) — first candidate under this wins
  const _psPathSteepness = (angle, pathLen, giveUpAbove) => {
    const ox = playerModel.position.x;
    const oz = playerModel.position.z;
    const dx = Math.cos(angle);
    const dz = Math.sin(angle);
    let prevY = getTerrainHeight(ox, oz);
    if (!Number.isFinite(prevY)) prevY = playerModel.position.y;
    let worst = 0;
    for (let d = PS_PATH_SAMPLE_STEP; d <= pathLen; d += PS_PATH_SAMPLE_STEP) {
      const y = getTerrainHeight(ox + dx * d, oz + dz * d);
      if (!Number.isFinite(y)) return Infinity;
      worst = Math.max(worst, Math.abs(y - prevY));
      if (worst > giveUpAbove) return worst;
      prevY = y;
    }
    return worst;
  };

  // Try evenly spaced directions (random order/offset for variety); take the first that is
  // gentle enough, else the flattest one found.
  const _psPickPathAngle = (pathLen) => {
    const offset = Math.random() * Math.PI * 2;
    const order = Array.from({ length: PS_PATH_CANDIDATES }, (_, i) => i)
      .sort(() => Math.random() - 0.5);
    let bestAngle = offset;
    let bestScore = Infinity;
    for (const i of order) {
      const angle = offset + (i / PS_PATH_CANDIDATES) * Math.PI * 2;
      const score = _psPathSteepness(angle, pathLen, bestScore);
      if (score < bestScore) {
        bestScore = score;
        bestAngle = angle;
        if (score <= PS_PATH_MAX_OK_STEP) break;
      }
    }
    return bestAngle;
  };

  const _psBuildStage = (stage, count = _psEnemyCount(stage)) => {
    const pathLen = 80 + stage * 3;
    const pathAngle = _psPickPathAngle(pathLen);
    const _psPathEndX = playerModel.position.x + Math.cos(pathAngle) * pathLen;
    const _psPathEndZ = playerModel.position.z + Math.sin(pathAngle) * pathLen;
    _psPathEnd.set(
      _psPathEndX,
      getTerrainHeight(_psPathEndX, _psPathEndZ) ?? playerModel.position.y,
      _psPathEndZ
    );
    _psAutoWalkDir.subVectors(_psPathEnd, playerModel.position).setY(0).normalize();
    _psEnemyQueue = [];
    for (let i = 0; i < count; i++) {
      const t = (i + 0.5) / count;
      const baseX = playerModel.position.x + _psAutoWalkDir.x * pathLen * t;
      const baseZ = playerModel.position.z + _psAutoWalkDir.z * pathLen * t;
      const scatter = 8;
      const ex = baseX + (Math.random() - 0.5) * scatter;
      const ez = baseZ + (Math.random() - 0.5) * scatter;
      const ey = getTerrainHeight(ex, ez) ?? playerModel.position.y;
      // Bomb throwers: start appearing at stage 3, ~5% chance scaling up slowly with stage
      const _btChance = stage >= 3 ? Math.min(0.15, 0.05 + (stage - 3) * 0.006) : 0;
      _psEnemyQueue.push({
        pos: new THREE.Vector3(ex, ey, ez),
        hearts: _psHeartsForStage(stage),
        triggerDist: pathLen * t - 10,
        bombThrower: Math.random() < _btChance,
      });
    }
    // Spawn coins along the path
    const coinCount = 8 + Math.floor(stage * 0.3);
    for (let ci = 0; ci < coinCount; ci++) {
      const ct = (ci + 0.5) / coinCount;
      const cx = playerModel.position.x + _psAutoWalkDir.x * pathLen * ct + (Math.random() - 0.5) * 6;
      const cz = playerModel.position.z + _psAutoWalkDir.z * pathLen * ct + (Math.random() - 0.5) * 6;
      spawnCoinPickup(new THREE.Vector3(cx, playerModel.position.y, cz));
    }
    _psAutoWalking = true;
    _psStageActive = true;
    _psWinShown = false;
    _psStageKills = 0;
    _psStageTotal = count;
    _psUpdateKillHud(true);
    window.hordeEnemies = hordeEnemies;
  };

  const _psShowWin = (onDone) => {
    _psWinShown = true;
    _psAutoWalking = false;
    _psStopSong();
    _psWinTitle.textContent = 'YOU WIN!';
    _psWinSub.textContent = `Stage ${_psStage} Cleared!`;
    // force animation restart
    _psWinTitle.style.animation = 'none';
    _psWinSub.style.animation = 'none';
    _psWinOverlay.classList.remove('hidden');
    void _psWinOverlay.offsetWidth;
    _psWinTitle.style.animation = '';
    _psWinSub.style.animation = '';
    setTimeout(() => {
      _psWinOverlay.classList.add('hidden');
      onDone();
    }, 2800);
  };

  const _psShowStageOverlay = (stage, onOk) => {
    const count = _psEnemyCount(stage);
    _psUpdateKillHud(false);
    _psStageBadge.textContent = stage <= 50 ? `STAGE ${stage}` : 'FINAL STAGE';
    _psStageEnemies.textContent = `Defeat ${count} enemies`;

    // Wire up time-picker buttons
    const _timeBtns = _psStageOverlay.querySelectorAll('.ps-stage-time-btn');
    _timeBtns.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.time === _psTimePref);
      btn.onclick = () => {
        _psTimePref = btn.dataset.time;
        _timeBtns.forEach(b => b.classList.toggle('active', b === btn));
      };
    });

    _psStageOkBtn.onclick = () => {
      _psStageOverlay.classList.add('hidden');
      onOk(count);
    };
    // Recalibrate button — snaps current gyro orientation as neutral
    const _psRecalibBtn = document.getElementById('ps-stage-recalib');
    if (_psRecalibBtn) {
      _psRecalibBtn.onclick = () => {
        window.phoneSwordRecalibrate?.();
        _psRecalibBtn.textContent = '✅ Calibrated!';
        setTimeout(() => { _psRecalibBtn.textContent = '🎯 Recalibrate Sword'; }, 1500);
      };
    }

    // Shop button — opens merchant panel if available
    let _psShopBtn = document.getElementById('ps-stage-shop-btn');
    if (!_psShopBtn) {
      _psShopBtn = document.createElement('button');
      _psShopBtn.id = 'ps-stage-shop-btn';
      _psShopBtn.className = 'ps-stage-shop-btn';
      _psShopBtn.textContent = '🛒 Shop';
      _psStageOkBtn.parentNode?.insertBefore(_psShopBtn, _psStageOkBtn);
    }
    _psShopBtn.onclick = async () => {
      const mod = await import('../controls/merchantPanel.js').catch(() => null);
      mod?.openMerchantPanel?.('buy');
    };
    _psStageOverlay.classList.remove('hidden');
  };

  const _psStartStage = (stage, count) => {
    // Never begin a stage dead (e.g. health 0 left over from a previous game)
    if (playerDead || statsState.health <= 0) {
      hideGameOver();
      respawnPlayer();
    }
    // Determine day/night for this stage
    if (_psTimePref === 'random') {
      _psCurrentIsNight = Math.random() < 0.5;
    } else {
      _psCurrentIsNight = _psTimePref === 'night';
    }
    // Reset song pool so we shuffle fresh each stage
    _psSongPool = [];
    // Apply lighting/display for day or night
    const _stageDisplayMode = _psCurrentIsNight ? 'night' : 'day';
    lastAutoMode = _stageDisplayMode;
    applyPresetForMode(_stageDisplayMode);
    applyDisplaySettings();
    clearRoadLightPool();

    // Start stage music
    _psStopSong();
    _psPlayNextSong(_psCurrentIsNight);

    // Respawn player at a random location
    const spawnAngle = Math.random() * Math.PI * 2;
    const spawnDist  = 5 + Math.random() * 10;
    const spawnX = playerModel.position.x + Math.cos(spawnAngle) * spawnDist;
    const spawnZ = playerModel.position.z + Math.sin(spawnAngle) * spawnDist;
    const spawnY = playerModel.position.y;
    playerModel.position.set(spawnX, spawnY, spawnZ);
    playerControls.playerX = spawnX;
    playerControls.playerY = spawnY;
    playerControls.playerZ = spawnZ;
    playerControls.lastPosition?.set(spawnX, spawnY, spawnZ);
    if (playerControls.body) {
      playerControls.body.setTranslation({ x: spawnX, y: spawnY + 0.6, z: spawnZ }, true);
      playerControls.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    }
    // Clear any dead enemies left over from the previous stage
    for (let _di = hordeEnemies.length - 1; _di >= 0; _di--) {
      const _de = hordeEnemies[_di];
      if (_de.isDead) {
        if (_de.group?.parent) _de.group.parent.remove(_de.group);
        try { _de.destroy?.(); } catch (_) {}
        hordeEnemies.splice(_di, 1);
      }
    }

    _psBuildStage(stage, count);
  };

  // Restart the current stage after death (clears enemies, rebuilds, shows overlay)
  const _psRestartCurrentStage = () => {
    _psStopSong();
    // Remove all living horde enemies
    for (let _ri = hordeEnemies.length - 1; _ri >= 0; _ri--) {
      const _re = hordeEnemies[_ri];
      if (_re.group?.parent) _re.group.parent.remove(_re.group);
      try { _re.destroy?.(); } catch (_) {}
    }
    hordeEnemies.length = 0;
    playerBombs?.clear();
    _psEnemyQueue = [];
    _psAutoWalking = false;
    _psStageActive = false;
    _psWinShown = false;
    _psShowStageOverlay(_psStage, (count) => _psStartStage(_psStage, count));
  };

  window.hordeEnemies = hordeEnemies;
  // Hide hunger and magic bars in phone sword mode
  const _psHungerBar = document.getElementById('hunger-bar');
  const _psMagicBar = document.getElementById('magic-bar');
  if (_psHungerBar) _psHungerBar.style.display = 'none';
  if (_psMagicBar) _psMagicBar.style.display = 'none';
  const _psInit = async () => {
    // Load PS stats and stage from Firebase (falls back gracefully)
    if (profileNameKey) {
      try {
        const [fbStats, fbStage] = await Promise.all([
          loadPhoneSwordStats(profileNameKey),
          loadPhoneSwordStage(profileNameKey)
        ]);
        _psStats = fbStats;
        // Use whichever is higher: Firebase stage or localStorage
        const lsStage = _psSavedStage();
        _psStage = Math.max(fbStage, lsStage);
        // Sync localStorage to Firebase value
        try { const k = _psStageLsKey(); if (k) localStorage.setItem(k, _psStage); } catch (_) {}
      } catch (_) { /* keep localStorage value */ }
    }
    _psShowStageOverlay(_psStage, (count) => _psStartStage(_psStage, count));
  };
  // Showdown picked on the start screen: delay briefly so the rest of init completes first
  // (the tutorial is started at the end of init instead)
  if (profileResult.mode === 'showdown') setTimeout(_psInit, 600);

  // ── Phone Sword: gyroscope receiver via PeerJS ─────────────────────────────
  window.phoneSwordGyro = { alpha: null, beta: null, gamma: null, connected: false, blocking: false };
  // Calibration: these are the "neutral" angles subtracted from live readings
  window.phoneSwordCalib = { alpha: 0, beta: 0, gamma: 0 };
  // Config: additional rotation offsets (degrees) applied on top of gyro delta
  window.phoneSwordConfig = { offsetX: 90, offsetY: 180, offsetZ: 0 };

  // Recalibrate: snapshot current gyro as neutral AND clear cached base quaternions
  // so the gyro loop re-initializes them cleanly from the weapon's _holdRotation.
  window.phoneSwordRecalibrate = () => {
    const g = window.phoneSwordGyro;
    if (g.alpha !== null) window.phoneSwordCalib.alpha = g.alpha;
    if (g.beta !== null) window.phoneSwordCalib.beta = g.beta;
    if (g.gamma !== null) window.phoneSwordCalib.gamma = g.gamma;
    // Also recalibrate the camera gyro using the same reference orientation
    if (playerControls?.gyroActive && g.alpha !== null) {
      playerControls.gyroLastAlpha = g.alpha;
      playerControls.gyroLastBeta = g.beta ?? 0;
      playerControls.gyroLastGamma = g.gamma ?? 0;
      playerControls.calibrateGyroscope?.();
    }
  };

  // Enable camera gyro when shield or gun is equipped,
  // calibrated from the current sword calibration reference (same neutral pose).
  window._enableWeaponGyroCamera = () => {
    if (!playerControls) return;
    const g = window.phoneSwordGyro;
    const calib = window.phoneSwordCalib;
    if (playerControls.gyroActive) return; // already active
    if (g && g.alpha !== null && calib) {
      // Seed the controls gyro with the calibration orientation as neutral
      playerControls.gyroLastAlpha = calib.alpha ?? g.alpha;
      playerControls.gyroLastBeta = calib.beta ?? g.beta ?? 0;
      playerControls.gyroLastGamma = calib.gamma ?? g.gamma ?? 0;
      playerControls.calibrateGyroscope?.();
      playerControls.gyroActive = true;
    } else if (g && g.alpha !== null) {
      // No calibration yet — use current position
      playerControls.gyroLastAlpha = g.alpha;
      playerControls.gyroLastBeta = g.beta ?? 0;
      playerControls.gyroLastGamma = g.gamma ?? 0;
      playerControls.calibrateGyroscope?.();
      playerControls.gyroActive = true;
    } else {
      // Fallback: try the native initGyroscope if phoneSwordGyro has no data yet
      playerControls.initGyroscope?.();
    }
  };

  const phoneSwordQrModal = document.getElementById('phone-sword-qr-modal');
  const phoneSwordQrCanvas = document.getElementById('phone-sword-qr-canvas');
  const phoneSwordQrUrl = document.getElementById('phone-sword-qr-url');
  const phoneSwordQrStatus = document.getElementById('phone-sword-qr-status');
  const phoneSwordQrDismiss = document.getElementById('phone-sword-qr-dismiss');
  const phoneSwordQrCopy = document.getElementById('phone-sword-qr-copy');
  const phoneSwordCalibModal = document.getElementById('phone-sword-calib-modal');
  const phoneSwordConnectCalib = document.getElementById('phone-sword-connect-calib');

  let _phoneSwordPeerId = null;     // gyro peer id once open (for re-showing the QR code)
  let _phoneSwordQrShownAt = 0;
  const showPhoneSwordQr = async (peerId) => {
    _phoneSwordPeerId = peerId;
    _phoneSwordQrShownAt = Date.now();
    const phoneUrl = `${location.origin}/phone-sword.html?host=${encodeURIComponent(peerId)}`;
    phoneSwordQrUrl.textContent = phoneUrl;
    phoneSwordQrUrl.dataset.url = phoneUrl;

    // Render QR code using bundled qrcode package
    try {
      await QRCode.toCanvas(phoneSwordQrCanvas, phoneUrl, {
        width: 200,
        margin: 1,
        color: { dark: '#000000', light: '#ffffff' }
      });
      phoneSwordQrCanvas.style.display = '';
    } catch (_) {
      phoneSwordQrCanvas.style.display = 'none';
    }

    phoneSwordQrModal.classList.remove('hidden');
  };

  // Copy URL to clipboard
  phoneSwordQrCopy.addEventListener('click', () => {
    const url = phoneSwordQrUrl.dataset.url || phoneSwordQrUrl.textContent;
    navigator.clipboard.writeText(url).then(() => {
      phoneSwordQrCopy.textContent = '✅ Copied!';
      phoneSwordQrCopy.classList.add('copied');
      setTimeout(() => {
        phoneSwordQrCopy.textContent = '📋 Copy URL';
        phoneSwordQrCopy.classList.remove('copied');
      }, 2000);
    }).catch(() => {
      // Fallback: select text
      const ta = document.createElement('textarea');
      ta.value = url;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      phoneSwordQrCopy.textContent = '✅ Copied!';
      phoneSwordQrCopy.classList.add('copied');
      setTimeout(() => {
        phoneSwordQrCopy.textContent = '📋 Copy URL';
        phoneSwordQrCopy.classList.remove('copied');
      }, 2000);
    });
  });

  phoneSwordQrDismiss.addEventListener('click', () => {
    phoneSwordQrModal.classList.add('hidden');
  });

  // "Use This Device" — pipe the current device's own gyroscope into phoneSwordGyro
  document.getElementById('phone-sword-use-this-device')?.addEventListener('click', async () => {
    if (typeof DeviceOrientationEvent === 'undefined') {
      alert('Gyroscope not available on this device.');
      return;
    }
    // iOS 13+ requires explicit permission from a user gesture
    if (typeof DeviceOrientationEvent.requestPermission === 'function') {
      try {
        const perm = await DeviceOrientationEvent.requestPermission();
        if (perm !== 'granted') { alert('Gyroscope permission denied.'); return; }
      } catch (e) {
        alert('Could not request gyroscope permission: ' + e.message);
        return;
      }
    }
    const _localGyroHandler = (event) => {
      if (event.alpha === null) return;
      window.phoneSwordGyro.alpha = event.alpha;
      window.phoneSwordGyro.beta = event.beta;
      window.phoneSwordGyro.gamma = event.gamma;
      // blocking not available from local device — stays false
    };
    window.addEventListener('deviceorientation', _localGyroHandler, true);
    window.phoneSwordGyro.connected = true;
    phoneSwordQrStatus.textContent = 'This device connected!';
    phoneSwordQrStatus.classList.add('connected');
    setTimeout(() => {
      phoneSwordQrModal.classList.add('hidden');
      phoneSwordConnectCalib?.classList.remove('hidden');
    }, 1200);
  });

  const closeCalibModal = () => phoneSwordCalibModal.classList.add('hidden');

  document.getElementById('phone-sword-calib-close').addEventListener('click', closeCalibModal);

  // Live readout in calibration modal
  const _calibAlphaEl = document.getElementById('phone-sword-calib-alpha');
  const _calibBetaEl = document.getElementById('phone-sword-calib-beta');
  const _calibGammaEl = document.getElementById('phone-sword-calib-gamma');

  const _updateCalibLive = () => {
    const g = window.phoneSwordGyro;
    const fmt = v => v !== null ? v.toFixed(1) + '°' : '—';
    if (_calibAlphaEl) _calibAlphaEl.textContent = 'α ' + fmt(g.alpha);
    if (_calibBetaEl) _calibBetaEl.textContent = 'β ' + fmt(g.beta);
    if (_calibGammaEl) _calibGammaEl.textContent = 'γ ' + fmt(g.gamma);
  };
  // Update live values in calib modal at ~10 Hz
  setInterval(() => {
    if (!phoneSwordCalibModal.classList.contains('hidden')) _updateCalibLive();
  }, 100);

  // "Set Neutral" — capture current gyro as calibration reference + clear base quaternions
  document.getElementById('phone-sword-calib-set').addEventListener('click', () => {
    window.phoneSwordRecalibrate?.();
    closeCalibModal();
  });

  // Quick presets — these set fixed calibration offsets for common phone holds
  document.querySelectorAll('.phone-sword-calib-preset').forEach(btn => {
    btn.addEventListener('click', () => {
      const preset = btn.dataset.preset;
      if (preset === 'flat') {
        // Phone lying flat pointing forward: beta≈0, gamma≈0
        window.phoneSwordCalib.beta = 0;
        window.phoneSwordCalib.gamma = 0;
        window.phoneSwordCalib.alpha = window.phoneSwordGyro.alpha ?? 0;
      } else if (preset === 'upright') {
        // Phone held upright like a wand: beta≈90
        window.phoneSwordCalib.beta = 90;
        window.phoneSwordCalib.gamma = 0;
        window.phoneSwordCalib.alpha = window.phoneSwordGyro.alpha ?? 0;
      } else if (preset === 'guard') {
        // Diagonal guard position: beta≈45, gamma≈-30
        window.phoneSwordCalib.beta = 45;
        window.phoneSwordCalib.gamma = -30;
        window.phoneSwordCalib.alpha = window.phoneSwordGyro.alpha ?? 0;
      }
      closeCalibModal();
    });
  });

  // ── Post-connect calibration popup ──────────────────────────────────────
  document.getElementById('phone-sword-connect-calib-ok')?.addEventListener('click', () => {
    window.phoneSwordRecalibrate?.();
    phoneSwordConnectCalib?.classList.add('hidden');
  });

  // ── Phone controller input (phone-sword.html) ─────────────────────────────
  // Besides gyro + block, the phone page has a joystick and bomb/gun/fire/shield/bubble/jump
  // buttons. The joystick rides along in each 'gyro' packet; buttons arrive as 'action'
  // messages. The host pushes a small 'status' message back so the phone can show counts.
  let _remoteJoyActive = false;
  const _applyRemoteJoystick = (angle, force) => {
    if (!playerControls) return;
    const f = Number.isFinite(force) ? Math.max(0, Math.min(1, force)) : 0;
    if (f > 0.05 && Number.isFinite(angle)) {
      playerControls.joystickAngle = angle;
      playerControls.joystickForce = f;
      _remoteJoyActive = true;
    } else if (_remoteJoyActive) {
      // Only release what the phone set, so the on-screen joystick keeps working
      playerControls.joystickForce = 0;
      _remoteJoyActive = false;
    }
  };
  // Gun/Shield buttons equip that item, or go back to the sword if it's already equipped
  const _toggleRemoteWeapon = (itemId) => {
    const appStateRef = window.appState;
    const inv = appStateRef?.getInventory?.() || {};
    if (!((inv[itemId]?.count ?? 0) > 0)) return;
    const equippedId = playerControls?.getEquippedWeapon?.('right')?.itemId;
    appStateRef.equipInventoryItem?.(equippedId === itemId ? FOAM_SWORD_ITEM_ID : itemId);
    playerControls?.refreshActionButtons?.();
  };
  const _handlePhoneAction = (action) => {
    if (!playerControls?.enabled) return;
    const appStateRef = window.appState;
    if (action === 'jump') {
      if (!playerControls.isInWater) window.phoneSwordJumpPressed = true;
    } else if (action === 'bomb') {
      appStateRef?.throwBomb?.();
    } else if (action === 'bubble') {
      appStateRef?.activateBubble?.();
    } else if (action === 'fire') {
      if (playerControls.getEquippedWeapon?.('right')?.itemId === 'pistol') playerControls.attemptFireProjectile?.();
    } else if (action === 'gun') {
      _toggleRemoteWeapon('pistol');
    } else if (action === 'shield') {
      _toggleRemoteWeapon(SHIELD_ITEM_ID);
    }
  };
  const _phoneControllerStatus = () => {
    const inv = window.appState?.getInventory?.() || {};
    return {
      bombs: getPlayerBombCount(),
      bubbles: getBubbleCount(),
      bubbleActive: isPlayerBubbleActive(),
      hasGun: (inv.pistol?.count ?? 0) > 0,
      hasShield: (inv[SHIELD_ITEM_ID]?.count ?? 0) > 0,
      ammo: getPistolAmmoCount(),
      equipped: playerControls?.getEquippedWeapon?.('right')?.itemId ?? FOAM_SWORD_ITEM_ID,
      // Tutorial: phone button to ring ('bomb' | 'bubble' | 'gun' | 'shield' | 'fire' | 'block')
      highlight: showdownTutorial?.isActive() ? _tutorialPhoneHighlight : null
    };
  };
  let _tutorialPhoneHighlight = null;
  const _attachPhoneSwordConn = (conn) => {
    window.phoneSwordGyro.connected = true;
    let lastStatusJson = '';
    const sendStatus = () => {
      if (!conn.open) return;
      const status = _phoneControllerStatus();
      const json = JSON.stringify(status);
      if (json === lastStatusJson) return;
      try {
        conn.send({ type: 'status', ...status });
        lastStatusJson = json;
      } catch (_) { /* ignore */ }
    };
    const statusTimer = setInterval(sendStatus, 300);
    conn.on('data', (data) => {
      if (!data) return;
      if (data.type === 'gyro') {
        window.phoneSwordGyro.alpha = data.alpha;
        window.phoneSwordGyro.beta = data.beta;
        window.phoneSwordGyro.gamma = data.gamma;
        window.phoneSwordGyro.blocking = !!data.blocking;
        if ('joyForce' in data) _applyRemoteJoystick(Number(data.joyAngle), Number(data.joyForce));
      } else if (data.type === 'action' && typeof data.action === 'string') {
        _handlePhoneAction(data.action);
        lastStatusJson = ''; // counts/equipped likely changed — resend soon
      }
    });
    conn.on('close', () => {
      clearInterval(statusTimer);
      window.phoneSwordGyro.connected = false;
      window.phoneSwordGyro.blocking = false;
      _applyRemoteJoystick(0, 0);
    });
  };

  // Derive a stable peer ID from the player profile so the phone-sword URL never changes.
  // Uses SHA-256 of the profile key so IDs are short, URL-safe, and unique per account.
  let _fixedPeerId = null;
  try {
    const _idSource = 'sqsword:' + (profileNameKey || playerName || 'anon');
    const _hashBuf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(_idSource));
    const _hashHex = Array.from(new Uint8Array(_hashBuf)).map(b => b.toString(16).padStart(2, '0')).join('');
    _fixedPeerId = 'sq-' + _hashHex.slice(0, 24);
  } catch (_) { /* fall back to random ID */ }

  // Create a dedicated PeerJS peer for receiving gyro data
  const { loadPeerJs: _loadPeerJs } = await import('../core/externalDeps.js');
  try {
    const PeerClass = await _loadPeerJs();

    // Fetch TURN credentials so NAT traversal works across different networks
    let _gyroIceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
    try {
      const _turnRes = await fetch('/api/turn-credentials');
      if (_turnRes.ok) {
        const _turnList = await _turnRes.json();
        if (Array.isArray(_turnList) && _turnList.length) _gyroIceServers = _turnList;
      }
    } catch (_) { /* fall back to STUN-only */ }

    const _peerOpts = { config: { iceServers: _gyroIceServers } };
    // Use fixed ID if available; PeerJS accepts it as first argument
    const gyroPeer = _fixedPeerId
      ? new PeerClass(_fixedPeerId, _peerOpts)
      : new PeerClass(_peerOpts);

    let _autoConnectTimer = null;

    gyroPeer.on('open', (id) => {
      _phoneSwordPeerId = id;
      // Give the phone 3 seconds to auto-reconnect (if it has the URL bookmarked)
      // before showing the QR modal.
      _autoConnectTimer = setTimeout(() => {
        if (!window.phoneSwordGyro.connected) {
          showPhoneSwordQr(id);
        }
      }, 3000);
    });

    gyroPeer.on('connection', (conn) => {
      clearTimeout(_autoConnectTimer);
      phoneSwordQrStatus.textContent = 'Phone connected!';
      phoneSwordQrStatus.classList.add('connected');

      // Auto-dismiss QR modal after short delay, then show calibration popup
      setTimeout(() => {
        phoneSwordQrModal.classList.add('hidden');
        phoneSwordConnectCalib?.classList.remove('hidden');
      }, 1800);

      _attachPhoneSwordConn(conn);
    });

    gyroPeer.on('error', (err) => {
      // If our fixed ID is already taken (stale session), fall back to a random ID
      if (err.type === 'unavailable-id' && _fixedPeerId) {
        console.warn('[PhoneSword] Fixed peer ID taken, falling back to random ID');
        _fixedPeerId = null;
        const fallbackPeer = new PeerClass(_peerOpts);
        fallbackPeer.on('open', (id) => showPhoneSwordQr(id));
        fallbackPeer.on('connection', (conn) => {
          phoneSwordQrStatus.textContent = 'Phone connected!';
          phoneSwordQrStatus.classList.add('connected');
          setTimeout(() => {
            phoneSwordQrModal.classList.add('hidden');
            phoneSwordConnectCalib?.classList.remove('hidden');
          }, 1800);
          _attachPhoneSwordConn(conn);
        });
        fallbackPeer.on('error', (e) => console.warn('[PhoneSword] PeerJS error:', e.message));
      } else {
        console.warn('[PhoneSword] PeerJS error:', err.message);
      }
    });
  } catch (err) {
    console.warn('[PhoneSword] Failed to init PeerJS:', err);
  }

  const debugPerf = {
    coinPickups: 0,
    incomingBacklog: 0,
    incomingProcessedPerFrame: 0,
    adaptiveDegradeLevel: 0
  };
  const subsystemPerf = {
    incomingQueue: { totalMs: 0, calls: 0, maxMs: 0, lastMs: 0 },
    pickups: { totalMs: 0, calls: 0, maxMs: 0, lastMs: 0 },
    remoteLabels: { totalMs: 0, calls: 0, maxMs: 0, lastMs: 0 },
    audio: { totalMs: 0, calls: 0, maxMs: 0, lastMs: 0 }
  };
  window.debugPerf = debugPerf;
  let lastPerfUpdateMs = 0;
  const withSubsystemTiming = (name, fn) => {
    const tracker = subsystemPerf[name];
    if (!tracker) {
      return fn();
    }
    const startedAt = performance.now();
    const result = fn();
    const elapsed = performance.now() - startedAt;
    tracker.totalMs += elapsed;
    tracker.calls += 1;
    tracker.lastMs = elapsed;
    if (elapsed > tracker.maxMs) {
      tracker.maxMs = elapsed;
    }
    return result;
  };
  const getAdaptiveInterval = (bucket) => {
    const lowEndBase = LOW_END_BUCKET_INTERVALS[bucket] ?? 1;
    const lowEndStep = Math.max(1, lowEndBase + adaptiveDegradeLevel);
    return isLowEndTier(currentPerformanceTier) ? lowEndStep : Math.max(1, 1 + adaptiveDegradeLevel);
  };
  const bucketDeltaSeconds = new Map();
  const accumulateBucketDeltas = (deltaSeconds) => {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return;
    Object.keys(LOW_END_BUCKET_INTERVALS).forEach((bucket) => {
      bucketDeltaSeconds.set(bucket, (bucketDeltaSeconds.get(bucket) || 0) + deltaSeconds);
    });
  };
  const consumeBucketDelta = (bucket, fallbackDeltaSeconds = 0) => {
    const accumulated = bucketDeltaSeconds.get(bucket);
    bucketDeltaSeconds.set(bucket, 0);
    if (Number.isFinite(accumulated) && accumulated > 0) {
      return accumulated;
    }
    return Number.isFinite(fallbackDeltaSeconds) && fallbackDeltaSeconds > 0 ? fallbackDeltaSeconds : 0;
  };
  const shouldRunBucket = (bucket) => (frameIndex % getAdaptiveInterval(bucket)) === 0;
  const processIncomingPeerDataQueue = () => withSubsystemTiming('incomingQueue', () => {
    if (!canProcessIncomingPeerData || pendingIncomingPeerData.length === 0) {
      lastIncomingProcessCount = 0;
      lastIncomingBacklog = pendingIncomingPeerData.length;
      return;
    }
    const startedAt = performance.now();
    let processed = 0;
    while (pendingIncomingPeerData.length > 0 && processed < INCOMING_QUEUE_MAX_PER_FRAME) {
      if (performance.now() - startedAt >= INCOMING_QUEUE_BUDGET_MS) {
        break;
      }
      const next = pendingIncomingPeerData.shift();
      if (!next) continue;
      processIncomingData(next[0], next[1]);
      processed += 1;
    }
    lastIncomingProcessCount = processed;
    lastIncomingBacklog = pendingIncomingPeerData.length;
  });

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
        countdownEl.textContent = '';
      }
    }, 1000);

    yesBtn.onclick = () => {
      clearInterval(interval);
      hideGameOver();
      respawnPlayer();
      _psStats.deaths = (_psStats.deaths || 0) + 1;
      if (profileNameKey) void savePhoneSwordStats(profileNameKey, { ..._psStats });
      _psRestartCurrentStage();
    };

    noBtn.onclick = () => {
      clearInterval(interval);
      window.location.reload();
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
    const spawn = getSpawnPosition();
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
    playerModel.userData.qwopRig?.glbCharacter?.revive();
    // Always re-equip the foam sword after respawn
    if (!(inventoryState[FOAM_SWORD_ITEM_ID]?.count > 0)) {
      inventoryState[FOAM_SWORD_ITEM_ID] = ensureCatalogEntry(FOAM_SWORD_ITEM_ID, { count: 1 });
    }
    equipInventoryItem(FOAM_SWORD_ITEM_ID);
    updateControlAvailability();
    const actions = playerModel.userData.actions;
    const current = playerModel.userData.currentAction;
    actions?.[current]?.fadeOut(0.2);
    actions?.idle?.reset().fadeIn(0.2).play();
    playerModel.userData.currentAction = 'idle';
  }

  const settingsBtn = document.getElementById('settings-button');
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
        }
        return result;
      } catch (error) {
        console.error('Failed to rename profile:', error);
        return { status: 'error' };
      }
    },
    getPlayerStats: () => ({ ...statsState }),
    getPhoneSwordLeaderboards: (limit = 10) => loadPhoneSwordLeaderboards(limit),
    getPhoneSwordStats: () => ({ ..._psStats }),
    getCoins: () => (Number.isFinite(statsState.coins) ? statsState.coins : 0),
    addCoins: (delta) => {
      const safeDelta = Number.isFinite(delta) ? delta : 0;
      if (safeDelta === 0) return;
      const current = Number.isFinite(statsState.coins) ? statsState.coins : 0;
      const nextCoins = current + safeDelta;
      setStat('coins', nextCoins, { skipSave: true });
      showCoinPopup(statsState.coins);
      showPickupToast('coins', safeDelta);
    },
    // Sword Showdown shop upgrades that are capped: true once the player can't buy more
    isShopItemMaxed: (itemId) => {
      if (itemId === 'heart_upgrade') return statsState.maxHealthSegments >= SHOWDOWN_MAX_HEALTH_SEGMENTS;
      if (itemId === 'shield_upgrade') return (statsState.shieldUpgrades || 0) >= SHOWDOWN_MAX_SHIELD_UPGRADES;
      return false;
    },
    // Sword Showdown shop upgrades (bought from the merchant, stored as stats)
    applyShopUpgrade: (itemId) => {
      if (appState.isShopItemMaxed(itemId)) return false;
      if (itemId === 'heart_upgrade') {
        setStat('maxHealthSegments', statsState.maxHealthSegments + 1, { skipSave: true });
        setStat('health', statsState.health + 1, { skipSave: true });
      } else if (itemId === 'shield_upgrade') {
        setStat('shieldUpgrades', (statsState.shieldUpgrades || 0) + 1, { skipSave: true });
        const shieldEntry = inventoryState[SHIELD_ITEM_ID];
        if (shieldEntry?.count > 0) {
          const nextEntry = normalizeShieldEntry({
            ...shieldEntry,
            [SHIELD_HEALTH_KEY]: (Number(shieldEntry[SHIELD_HEALTH_KEY]) || 0) + SHIELD_UPGRADE_HEALTH
          });
          inventoryState[SHIELD_ITEM_ID] = ensureCatalogEntry(SHIELD_ITEM_ID, nextEntry);
          if (shield?.holder === playerControls) {
            updateShieldHealthHUD(nextEntry[SHIELD_HEALTH_KEY], nextEntry[SHIELD_MAX_HEALTH_KEY], nextEntry.count);
          }
          persistInventory();
        }
      } else if (itemId === 'bubble') {
        setStat('bubbles', getBubbleCount() + 1, { skipSave: true });
        updatePsBubbleButton();
      } else if (itemId === 'showdown_bomb') {
        setStat('bombs', getPlayerBombCount() + 1, { skipSave: true });
        updatePsBombButton();
      } else {
        return false;
      }
      void saveStatsImmediate(profileNameKey, statsState, lastStatUpdateAt);
      return true;
    },
    getBubbleCount: () => getBubbleCount(),
    activateBubble: () => activatePlayerBubble(),
    getBombCount: () => getPlayerBombCount(),
    throwBomb: () => throwPlayerBomb(),
    getInventory: () => getInventory(),
    getPistolAmmoCount: () => getPistolAmmoCount(),
    addPistolAmmo: (amount) => addPistolAmmo(amount),
    seedPistolAmmoIfNeeded: () => seedPistolAmmoIfNeeded(),
    getEquippedInventoryItemId: () => getEquippedInventoryItemId(),
    getEquippedInventoryItemIds: () => getEquippedInventoryItemIds(),
    isInventoryItemEquipped: (itemId) => isInventoryItemEquipped(itemId),
    getInventoryItemActions: (itemId) => getInventoryItemActions(itemId),
    equipInventoryItem: (itemId) => equipInventoryItem(itemId),
    unequipInventoryItem: (itemId) => unequipInventoryItem(itemId),
    addToInventory: (itemId, amount) => addToInventory(itemId, amount),
    removeFromInventory: (itemId, amount) => removeFromInventory(itemId, amount),
    getConnectedPlayers: () => {
      const players = [];
      const playerPos = playerModel?.position;
      const connections = multiplayer?.connections || {};
      Object.keys(connections).forEach((id) => {
        const other = otherPlayers[id];
        let distance = remotePresenceMeta[id]?.lastDistance ?? null;
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
    getLastError: () => {
      return multiplayer?.lastError ?? null;
    },
    getAppVersion: () => import.meta.env?.VITE_APP_VERSION || import.meta.env?.VITE_GIT_COMMIT || 'unknown',
    getDisplaySettings: () => ({ ...displaySettings }),
    setDisplayMode: (mode) => setDisplayMode(mode),
    setDisplaySetting: (key, value) => setDisplaySetting(key, value),
    deleteAccount: async () => {
      if (!profileNameKey) {
        return { status: 'missing-key' };
      }
      const result = await deleteProfileData(profileNameKey, playerName);
      if (result.status === 'ok') {
        localStorage.removeItem('playerName');
        setCookie('playerName', '', -1);
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
  initSettingsPanel({
    appState,
    multiplayer,
    player
  });
  await initMerchantPanelFeature({ appState });
  void initMerchantFeature({ appState });

  settingsBtn.addEventListener('click', () => {
    openSettings();
  });
  const settingsOverlay = document.getElementById('settings-overlay');
  const merchantOverlay = document.getElementById('merchant-overlay');
  const isOverlayVisible = (overlay) => overlay?.getAttribute('aria-hidden') === 'false';

  // Sword Showdown auto-buy: when the player runs out of one of these, spend coins on it
  // automatically (in this priority order, one purchase per tick) and flash a purchase toast.
  const PS_AUTO_BUY_ITEMS = [
    { itemId: 'showdown_bomb', has: () => getPlayerBombCount() > 0 },
    { itemId: 'bubble', has: () => getBubbleCount() > 0 },
    { itemId: SHIELD_ITEM_ID, has: () => (inventoryState[SHIELD_ITEM_ID]?.count || 0) > 0 },
    { itemId: 'pistol', has: () => (inventoryState.pistol?.count || 0) > 0 },
    // Bullets are only useful once the gun is owned
    { itemId: PISTOL_AMMO_KEY, has: () => !(inventoryState.pistol?.count > 0) || getPistolAmmoCount() > 0 }
  ];
  let psAutoBuyBusy = false;
  const psAutoBuyTick = async () => {
    // The tutorial does its own (scripted) purchases
    if (psAutoBuyBusy || showdownTutorial?.isActive()) return;
    const needed = PS_AUTO_BUY_ITEMS.filter(entry => !entry.has());
    if (!needed.length) return;
    psAutoBuyBusy = true;
    try {
      const merchant = await import('../characters/merchant.js');
      const stock = merchant.getMerchantInventory();
      const coins = appState.getCoins();
      for (const { itemId } of needed) {
        const meta = merchant.getMerchantItemMeta(itemId);
        if ((stock[itemId]?.count || 0) <= 0 || coins < meta.price) continue;
        if (!await merchant.buyMerchantItem(itemId)) continue;
        showPickupToast(itemId, 1, '', {
          text: `Purchased ${meta.name} -${meta.price} coins`,
          icon: meta.icon
        });
        if (isOverlayVisible(merchantOverlay)) void updateMerchantUIFeature();
        break;
      }
    } catch (error) {
      console.warn('Sword Showdown auto-buy failed:', error);
    } finally {
      psAutoBuyBusy = false;
    }
  };

  setInterval(() => {
    void psAutoBuyTick();
    if (isOverlayVisible(settingsOverlay)) {
      updateSettingsUI();
    }
    if (isOverlayVisible(merchantOverlay)) {
      void updateMerchantUIFeature();
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

  const roadLightLoader = new GLTFLoader();
  let roadLightTemplate = null;
  let roadLightTemplatePromise = null;
  const roadLightPool = [];
  const roadLightScratch = {
    playerPos: new THREE.Vector3(),
    playerMove: new THREE.Vector3(),
    spawnPos: new THREE.Vector3(),
    lastPlayerPos: null,
    gridCenterX: null,
    gridCenterZ: null,
    nextRepositionAtMs: 0
  };

  const isNightDisplayMode = () => {
    if (_psStageActive) return _psCurrentIsNight;
    const effectiveMode = displaySettings.mode === 'auto'
      ? (lastAutoMode || getAutoMode())
      : displaySettings.mode;
    return effectiveMode === 'night';
  };

  const clearRoadLightPool = () => {
    roadLightPool.forEach((entry) => {
      if (!entry?.model) return;
      entry.model.visible = false;
    });
  };

  const ensureRoadLightTemplate = async () => {
    if (roadLightTemplate) return roadLightTemplate;
    if (!roadLightTemplatePromise) {
      roadLightTemplatePromise = roadLightLoader.loadAsync(ROAD_LIGHT_MODEL_URL)
        .then((gltf) => {
          roadLightTemplate = gltf?.scene || null;
          return roadLightTemplate;
        })
        .catch((error) => {
          console.warn('Failed to load road light template.', error);
          return null;
        });
    }
    return roadLightTemplatePromise;
  };

  const updateRoadLightsNearPlayer = () => {
    if (!scene || !playerModel?.position || !isNightDisplayMode()) {
      clearRoadLightPool();
      return;
    }
    const template = roadLightTemplate;
    if (!template) {
      void ensureRoadLightTemplate();
      return;
    }
    const playerPos = roadLightScratch.playerPos.copy(playerModel.position);
    const nowMs = performance.now();
    const spawnPos = roadLightScratch.spawnPos;
    const playerMove = roadLightScratch.playerMove;
    if (roadLightScratch.lastPlayerPos) {
      playerMove.copy(playerPos).sub(roadLightScratch.lastPlayerPos).setY(0);
    } else {
      playerMove.set(0, 0, 0);
    }
    if (playerMove.lengthSq() > 0.0001) {
      playerMove.normalize();
    }
    if (!roadLightScratch.lastPlayerPos) {
      roadLightScratch.lastPlayerPos = playerPos.clone();
    }
    roadLightScratch.lastPlayerPos.copy(playerPos);

    if (
      roadLightScratch.gridCenterX == null
      || roadLightScratch.gridCenterZ == null
      || nowMs >= roadLightScratch.nextRepositionAtMs
    ) {
      const shouldShiftForward = playerMove.lengthSq() > 0.01;
      const shiftOffsetX = shouldShiftForward ? playerMove.x * ROAD_LIGHT_SHIFT_DISTANCE_METERS : 0;
      const shiftOffsetZ = shouldShiftForward ? playerMove.z * ROAD_LIGHT_SHIFT_DISTANCE_METERS : 0;
      roadLightScratch.gridCenterX =
        Math.round((playerPos.x + shiftOffsetX) / ROAD_LIGHT_GRID_SPACING_METERS) * ROAD_LIGHT_GRID_SPACING_METERS;
      roadLightScratch.gridCenterZ =
        Math.round((playerPos.z + shiftOffsetZ) / ROAD_LIGHT_GRID_SPACING_METERS) * ROAD_LIGHT_GRID_SPACING_METERS;
      roadLightScratch.nextRepositionAtMs = nowMs + ROAD_LIGHT_REPOSITION_INTERVAL_MS;
    }
    const gridCenterX = roadLightScratch.gridCenterX;
    const gridCenterZ = roadLightScratch.gridCenterZ;
    const halfSpan = ((ROAD_LIGHT_GRID_SIZE - 1) * ROAD_LIGHT_GRID_SPACING_METERS) * 0.5;

    let poolIndex = 0;
    for (let row = 0; row < ROAD_LIGHT_GRID_SIZE; row += 1) {
      for (let col = 0; col < ROAD_LIGHT_GRID_SIZE; col += 1) {
        const x = gridCenterX + (col * ROAD_LIGHT_GRID_SPACING_METERS - halfSpan);
        const z = gridCenterZ + (row * ROAD_LIGHT_GRID_SPACING_METERS - halfSpan);
        spawnPos.set(x, 0, z);
        const spawnTerrain = getTerrainHeight(spawnPos.x, spawnPos.z);
        spawnPos.y = Number.isFinite(spawnTerrain) ? spawnTerrain : playerPos.y;
        let roadLight = roadLightPool[poolIndex];
        if (!roadLight) {
          const model = template.clone(true);
          model.scale.setScalar(1);
          const lampLight = new THREE.PointLight(
            ROAD_LIGHT_POINT_LIGHT_CONFIG.color,
            ROAD_LIGHT_POINT_LIGHT_CONFIG.intensity,
            ROAD_LIGHT_POINT_LIGHT_CONFIG.distance,
            ROAD_LIGHT_POINT_LIGHT_CONFIG.decay
          );
          lampLight.position.set(0, ROAD_LIGHT_POINT_LIGHT_CONFIG.yOffset, 0);
          model.add(lampLight);
          scene.add(model);
          roadLight = { model };
          roadLightPool[poolIndex] = roadLight;
        }
        roadLight.model.visible = true;
        roadLight.model.position.copy(spawnPos);
        poolIndex += 1;
      }
    }

    for (let i = poolIndex; i < roadLightPool.length; i += 1) {
      roadLightPool[i].model.visible = false;
    }
  };

  // ── Sword Showdown tutorial (src/tutorial/showdownTutorial.js) ──────────────
  // Everything the scripted tutorial needs from the game. Purchases skip the room shop
  // stock (always available) but cost the same coins as the shop.
  const _tutorialTip = new THREE.Vector3(0, 0, 0.69);
  const TUTORIAL_ENEMY_SPEED = 0.6; // a bit quicker than stage enemies, so knocked-back ones return sooner
  const _tutorialRemoveEnemy = (enemy) => {
    if (!enemy) return;
    const i = hordeEnemies.indexOf(enemy);
    if (i !== -1) hordeEnemies.splice(i, 1);
    if (enemy.group?.parent) enemy.group.parent.remove(enemy.group);
    try { enemy.destroy?.(); } catch (_) { /* already gone */ }
  };
  const _tutorialMarkEnemy = (enemy) => {
    enemy._tutorial = true;
    enemy._coinDropped = true; // no coin drop / kill counter / XP
    return enemy;
  };
  const _tutorialButton = (name) => {
    const pc = playerControls;
    if (!pc) return null;
    if (name === 'bomb') return pc.psBombBtn;
    if (name === 'bubble') return pc.psBubbleBtn;
    if (name === 'block' || name === 'fire') return pc.punchButton;
    const itemId = name === 'gun' ? 'pistol' : name === 'shield' ? SHIELD_ITEM_ID : name;
    return [pc.psWeaponBtn1, pc.psWeaponBtn2].find(b => b?.dataset.psWeaponId === itemId) || null;
  };
  const _refreshShowdownButtons = () => {
    playerControls?.refreshActionButtons?.();
    updatePsBombButton();
    updatePsBubbleButton();
  };
  const _tutorialAddAmmo = (amount) => {
    addPistolAmmo(amount);
    if (pistol?.holder === playerControls) {
      playerControls.setAmmo?.(getPistolAmmoCount(), getAmmoLabelForType('bullet'), getAmmoIconForType('bullet'));
    }
  };
  const tutorialCtx = {
    scene,
    camera,
    playerModel,
    bombThrowDistance: PLAYER_BOMB_THROW_DIST,
    groundY: (x, z) => {
      const y = getTerrainHeight(x, z);
      return Number.isFinite(y) ? y : null;
    },
    getForward: (out) => {
      playerModel.getWorldDirection(out).setY(0);
      if (out.lengthSq() < 1e-6) out.set(0, 0, 1);
      return out.normalize();
    },
    spawnSwordsman: ({ position, hearts = 3, script = null, stationary = false }) => {
      const enemy = _spawnHordeEnemy({ position, hearts, speedScale: TUTORIAL_ENEMY_SPEED, swingChance: 0.3 });
      enemy.script = script;
      enemy.stationary = stationary;
      return _tutorialMarkEnemy(enemy);
    },
    spawnBomber: ({ position, hearts = 1, throwsHeld = true, aimAt = null }) => {
      const enemy = _spawnHordeEnemy({ position, hearts, speedScale: PS_ENEMY_SPEED, bombThrower: true });
      enemy.stationary = true;
      enemy.throwsHeld = throwsHeld;
      enemy.aimAt = aimAt;
      return _tutorialMarkEnemy(enemy);
    },
    removeEnemy: _tutorialRemoveEnemy,
    // Deflect point of the player's sword (same tip the bomb-deflect check uses), or null
    getSwordTip: (out) => {
      if (foamSword?.holder !== playerControls) return null;
      const mesh = foamSword.useHeldMeshWhenHeld && foamSword.heldMesh ? foamSword.heldMesh : foamSword.mesh;
      if (!mesh?.visible) return null;
      return out.copy(_tutorialTip).applyQuaternion(mesh.quaternion).add(mesh.position);
    },
    // Guard → tip of the phone-driven blade (world), or null without a phone
    getPlayerBladeDir: (out) => {
      const pts = window.phoneSwordBladePoints;
      if (!window.phoneSwordGyro?.connected || foamSword?.holder !== playerControls || !(pts?.length >= 3)) return null;
      return out.subVectors(pts[2], pts[0]);
    },
    isBlocking: () => !!window.phoneSwordGyro?.blocking,
    isPhoneConnected: () => !!window.phoneSwordGyro?.connected,
    requestPhoneSetup: () => {
      if (window.phoneSwordGyro?.connected || !_phoneSwordPeerId) return false;
      phoneSwordQrStatus.textContent = 'Waiting for phone…';
      phoneSwordQrStatus.classList.remove('connected');
      void showPhoneSwordQr(_phoneSwordPeerId);
      return true;
    },
    isPhoneSetupOpen: () => !phoneSwordQrModal.classList.contains('hidden')
      || (!!phoneSwordConnectCalib && !phoneSwordConnectCalib.classList.contains('hidden')),
    getButton: _tutorialButton,
    setPhoneHighlight: (name) => { _tutorialPhoneHighlight = name || null; },
    // Coins in a ring around the player, inside the drift radius
    spawnCoins: (count, value) => {
      const pickups = [];
      const offset = Math.random() * Math.PI * 2;
      for (let i = 0; i < count; i++) {
        const angle = offset + (i / count) * Math.PI * 2;
        const dist = 2.2 + (i % 3) * 0.6;
        const pos = playerModel.position.clone().add(new THREE.Vector3(Math.cos(angle) * dist, 0, Math.sin(angle) * dist));
        const pickup = spawnCoinPickup(pos, { value });
        if (pickup) pickups.push(pickup);
      }
      return pickups;
    },
    countPickups: (pickups) => pickups.filter(p => coinPickups.includes(p)).length,
    removePickups: (pickups) => {
      pickups.forEach((p) => {
        const i = coinPickups.indexOf(p);
        if (i === -1) return;
        coinPickups.splice(i, 1);
        disposePickup(p);
      });
    },
    getPrice: async (itemId) => {
      const merchant = await import('../characters/merchant.js');
      return merchant.getMerchantItemMeta(itemId).price;
    },
    // Scripted "auto-buy": same price and toast as psAutoBuyTick
    buy: async (itemId) => {
      const merchant = await import('../characters/merchant.js');
      const meta = merchant.getMerchantItemMeta(itemId);
      if (appState.getCoins() < meta.price) return false;
      if (itemId === SHIELD_ITEM_ID || itemId === 'pistol') {
        addToInventory(itemId, 1);
        if (itemId === 'pistol') seedPistolAmmoIfNeeded();
      } else if (itemId === PISTOL_AMMO_KEY) {
        _tutorialAddAmmo(1);
      } else if (!appState.applyShopUpgrade(itemId)) {
        return false;
      }
      appState.addCoins(-meta.price);
      void saveStatsImmediate(profileNameKey, statsState, lastStatUpdateAt, inventoryState);
      showPickupToast(itemId, 1, '', { text: `Purchased ${meta.name} -${meta.price} coins`, icon: meta.icon });
      _refreshShowdownButtons();
      return true;
    },
    // Free replacement when a lesson needs another try
    giveItem: (itemId) => {
      if (itemId === 'showdown_bomb') setStat('bombs', getPlayerBombCount() + 1, { skipSave: true });
      else if (itemId === 'bubble') setStat('bubbles', getBubbleCount() + 1, { skipSave: true });
      _refreshShowdownButtons();
    },
    getBombCount: () => getPlayerBombCount(),
    isPlayerBombBusy: () => !!playerBombThrow || (playerBombs?.activeCount ?? 0) > 0,
    getBubbleCount: () => getBubbleCount(),
    isBubbleActive: () => isPlayerBubbleActive(),
    hasItem: (itemId) => (inventoryState[itemId]?.count || 0) > 0,
    getShieldCount: () => inventoryState[SHIELD_ITEM_ID]?.count || 0,
    isEquipped: (itemId) => isInventoryItemEquipped(itemId),
    // Lower the durability of the shield on top of the stack (a quick break for the lesson)
    weakenShield: (health) => {
      const entry = inventoryState[SHIELD_ITEM_ID];
      if (!entry?.count) return;
      const current = normalizeShieldHealth(entry[SHIELD_HEALTH_KEY]);
      inventoryState[SHIELD_ITEM_ID] = ensureCatalogEntry(SHIELD_ITEM_ID, normalizeShieldEntry({
        ...entry,
        [SHIELD_HEALTH_KEY]: Math.min(current, health)
      }));
      persistInventory();
    },
    equipSword: () => {
      if (!(inventoryState[FOAM_SWORD_ITEM_ID]?.count > 0)) {
        inventoryState[FOAM_SWORD_ITEM_ID] = ensureCatalogEntry(FOAM_SWORD_ITEM_ID, { count: 1 });
      }
      equipInventoryItem(FOAM_SWORD_ITEM_ID);
      _refreshShowdownButtons();
    },
    getAmmo: () => getPistolAmmoCount(),
    addAmmo: _tutorialAddAmmo,
    onComplete: async () => {
      if (playerProfile) playerProfile.tutorialCompleted = true;
      void saveTutorialCompleted(profileNameKey);
      _psWinTitle.textContent = 'TUTORIAL COMPLETE!';
      _psWinSub.textContent = 'You’re ready for the Showdown';
      _psWinTitle.style.animation = 'none';
      _psWinSub.style.animation = 'none';
      _psWinOverlay.classList.remove('hidden');
      void _psWinOverlay.offsetWidth;
      _psWinTitle.style.animation = '';
      _psWinSub.style.animation = '';
      await new Promise(resolve => setTimeout(resolve, 2800));
      _psWinOverlay.classList.add('hidden');
      _resetForMenu();
      arcadeOverlay.showStartScreen({ tutorialDone: true });
    }
  };
  showdownTutorial = createShowdownTutorial(tutorialCtx);

  // Clear the field (enemies, bombs, stage) and put the player back on their feet
  const _resetForMenu = () => {
    _psStopSong();
    _psStageOverlay.classList.add('hidden');
    for (let i = hordeEnemies.length - 1; i >= 0; i--) _tutorialRemoveEnemy(hordeEnemies[i]);
    playerBombs?.clear();
    _psEnemyQueue = [];
    _psAutoWalking = false;
    _psStageActive = false;
    _psWinShown = false;
    _psUpdateKillHud(false);
    if (playerDead || statsState.health <= 0) {
      hideGameOver();
      respawnPlayer();
    }
    setStat('health', statsState.maxHealthSegments);
    tutorialCtx.equipSword();
  };

  const startTutorialMode = () => {
    _resetForMenu();
    lastAutoMode = 'day';
    applyPresetForMode('day');
    applyDisplaySettings();
    clearRoadLightPool();
    showdownTutorial.start();
  };

  // Start screen shown again later (after the tutorial): Tutorial or Showdown
  arcadeOverlay.setModeHandler((gameMode) => {
    if (gameMode === 'showdown') {
      _resetForMenu();
      void _psInit();
    } else {
      startTutorialMode();
    }
  });
  if (profileResult.mode !== 'showdown') setTimeout(startTutorialMode, 600);

  function animate() {
    requestAnimationFrame(animate);
    const frameStartMs = performance.now();

    // --- RAPIER FIXED-STEP & SYNC ---
    // Accumulate variable rAF time into fixed physics steps
    const frameDelta = clock.getDelta();
    frameIndex += 1;
    accumulateBucketDeltas(frameDelta);
    physicsAccumulator += frameDelta;
    while (physicsAccumulator >= FIXED_DT) {
      // applyGlobalGravity(rapierWorld, window.moon);
      rapierWorld.step();
      physicsAccumulator -= FIXED_DT;
    }

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
        if (mesh.userData?.rb === rb) {
          mesh.userData.rb = null;
          mesh.userData.physicsMode = null;
        }
        removeRigidBodySafely(rapierWorld, rb);
      }
    }

    updateRoadLightsNearPlayer();
    playerControls.update();
    updateBloodEffects(frameDelta);
    updateExplosionEffects(frameDelta);
    updatePlayerBubble();
    updatePlayerBombs(frameDelta);
    showdownTutorial?.update(frameDelta);
    const now = performance.now();
    processIncomingPeerDataQueue();
    if (now - lastPerfUpdateMs >= 1000) {
      debugPerf.coinPickups = coinPickups.length;
      debugPerf.incomingBacklog = lastIncomingBacklog;
      debugPerf.incomingProcessedPerFrame = lastIncomingProcessCount;
      debugPerf.adaptiveDegradeLevel = adaptiveDegradeLevel;
      Object.entries(subsystemPerf).forEach(([name, tracker]) => {
        const avgMs = tracker.calls > 0 ? tracker.totalMs / tracker.calls : 0;
        debugPerf[`${name}AvgMs`] = Number(avgMs.toFixed(3));
        debugPerf[`${name}MaxMs`] = Number(tracker.maxMs.toFixed(3));
        debugPerf[`${name}LastMs`] = Number(tracker.lastMs.toFixed(3));
        tracker.totalMs = 0;
        tracker.calls = 0;
        tracker.maxMs = 0;
      });
      lastPerfUpdateMs = now;
    }
    if (shouldRunBucket('pickups')) {
      withSubsystemTiming('pickups', () => {
        const pickupDeltaSeconds = consumeBucketDelta('pickups', frameDelta);
        const pickupTime = performance.now() * 0.002;
        const shouldCheckPickups = !PERF.throttlePickups || now - lastPickupCheckMs >= PICKUP_CHECK_INTERVAL_MS;
        if (shouldCheckPickups) {
          lastPickupCheckMs = now;
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
          if (!playerDead && playerModel.position.distanceTo(pickup.position) <= getPickupAttractRadius()) {
            attractPickupToPlayer(pickup, playerModel, PICKUP_ATTRACT_SPEED, pickupDeltaSeconds);
            // Follow the ground while drifting; otherwise the bob above resets y to the spawn height
            const groundY = getSpawnY(pickup.position.x, pickup.position.z, 0.6);
            if (Number.isFinite(groundY)) pickup.userData.baseY = groundY;
          }

          if (shouldCheckPickups && !playerDead && playerModel.position.distanceTo(pickup.position) < PICKUP_RADIUS) {
            applyCoinPickupEffects(pickup.userData.value);
            disposePickup(pickup);
            coinPickups.splice(i, 1);
          }
        }
      });
    }

    // Phone Sword: read gyro quaternion and apply directly (no swing exaggeration).
    // Hit detection is now sweep-based with sword-vs-sword collision (see below).
    if (window.phoneSwordGyro?.connected) {
      const _g = window.phoneSwordGyro;
      const _c = window.phoneSwordCalib;
      const _cfg = window.phoneSwordConfig || { offsetX: 0, offsetY: 0, offsetZ: 0 };
      const _beta = _g.beta, _gamma = _g.gamma;
      if (Number.isFinite(_beta) && Number.isFinite(_gamma)) {
        const DEG = Math.PI / 180;
        const nowSec = performance.now() / 1000;

        let _dAlpha = (Number.isFinite(_g.alpha) ? _g.alpha : _c.alpha) - _c.alpha;
        if (_dAlpha > 180) _dAlpha -= 360;
        if (_dAlpha < -180) _dAlpha += 360;
        const _dBeta  = _beta  - _c.beta;
        const _dGamma = _gamma - _c.gamma;

        _phoneSwordEuler.set(
          (_dBeta  + _cfg.offsetX) * DEG,
          (_dAlpha + _cfg.offsetY) * DEG,
          (_dGamma + _cfg.offsetZ) * DEG,
          'YXZ'
        );
        _phoneSwordGyroQ.setFromEuler(_phoneSwordEuler);
        // Expose raw deltas for per-weapon axis remapping
        window.phoneSwordGyro._dBeta  = _dBeta;
        window.phoneSwordGyro._dAlpha = _dAlpha;
        window.phoneSwordGyro._dGamma = _dGamma;

        // Compute angular speed (deg/s) from quaternion delta vs previous frame
        if (_psw.prevGyroQ && _psw.prevGyroTime && nowSec > _psw.prevGyroTime) {
          const _dt = nowSec - _psw.prevGyroTime;
          const _dot = Math.abs(_phoneSwordGyroQ.dot(_psw.prevGyroQ));
          const _angleDeg = 2 * Math.acos(Math.min(1, _dot)) * (180 / Math.PI);
          window._pswDebugSpeed = _angleDeg / _dt;
        }
        if (!_psw.prevGyroQ) _psw.prevGyroQ = new THREE.Quaternion();
        _psw.prevGyroQ.copy(_phoneSwordGyroQ);
        _psw.prevGyroTime = nowSec;

        // Bounce: snap to recoil target (exp-decay), hold, then return to live gyro
        let activeGyroQ;
        if (_psw.bounceActive) {
          const _bCfg      = window.phoneSwordSwingCfg;
          const _snapSpeed = _bCfg?.bounceSnapSpeed ?? 18;
          const _holdDur   = _psw.bounceDur ?? 0.35;
          const elapsed    = nowSec - _psw.bounceStartTime;
          // Phase 1: snap to recoil target (first 0.12 s at snapSpeed)
          const _snapDur = 0.12;
          if (elapsed < _snapDur) {
            const _dt2 = nowSec - ((_psw._lastBounceT ?? nowSec - 0.016));
            _psw.bounceCurrentQ.slerp(_psw.bounceTargetQ, 1 - Math.exp(-_snapSpeed * _dt2));
            activeGyroQ = _psw.bounceCurrentQ;
          // Phase 2: hold at recoil position
          } else if (elapsed < _snapDur + _holdDur) {
            _psw.bounceCurrentQ.copy(_psw.bounceTargetQ);
            activeGyroQ = _psw.bounceCurrentQ;
          // Phase 3: return to live gyro
          } else {
            const _returnDur = 0.2;
            const _rt = Math.min((elapsed - _snapDur - _holdDur) / _returnDur, 1);
            if (_rt >= 1) { _psw.bounceActive = false; activeGyroQ = _phoneSwordGyroQ; }
            else { activeGyroQ = new THREE.Quaternion().slerpQuaternions(_psw.bounceTargetQ, _phoneSwordGyroQ, _rt); }
          }
          _psw._lastBounceT = nowSec;
        } else {
          _psw._lastBounceT = null;
          activeGyroQ = _phoneSwordGyroQ;
        }

        if (foamSword?.holder === playerControls) {
          foamSword._holdQuaternion.copy(activeGyroQ).multiply(_phoneSwordBaseQ);
        }
      }
    }
    foamSword?.update();
    // Phone Sword: override mesh quaternion, then run sword-vs-sword collision + sweep hit detection.
    if (window.phoneSwordGyro?.connected &&
        foamSword?.holder === playerControls && foamSword?.mesh && playerModel) {

      // Re-derive active Q — use bounceCurrentQ if bouncing, else live gyro
      const _nowSecPS = performance.now() / 1000;
      const _activeQ = _psw.bounceActive ? _psw.bounceCurrentQ : _phoneSwordGyroQ;
      foamSword.mesh.quaternion.copy(playerModel.quaternion).multiply(_activeQ).multiply(_phoneSwordBaseQ);

      // ── Hide any leftover trail lines from the old swing system ─────────────
      for (const l of _psw.trailLines) l.visible = false;

      // ── Compute player sword blade sample points (guard / mid / tip) ────────
      const _pswSampleOffsets = [
        new THREE.Vector3(0, 0, -0.1),
        new THREE.Vector3(0, 0,  0.3),
        new THREE.Vector3(0, 0,  0.65),
      ];
      const _playerBladePoints = _pswSampleOffsets.map(p =>
        p.clone().applyQuaternion(foamSword.mesh.quaternion).add(foamSword.mesh.position)
      );
      window.phoneSwordBladePoints = _playerBladePoints;

      const _tipWorld = _playerBladePoints[2]; // tip

      // ── Sword-vs-sword collision + sweep hit detection for horde enemies ─────
      let _swingHitOccurred = false;
      const _colAngSpd  = window._pswDebugSpeed ?? 0;
      const _colMinSpd  = window.phoneSwordSwingCfg?.minSweepSpeed ?? 100;
      const _colSweepDist = _psw.prevTipWorld ? _tipWorld.distanceTo(_psw.prevTipWorld) : 0;
      const _colMinDist = window.phoneSwordSwingCfg?.minSweepDist ?? 0.15;
      const _playerMovingFast = _colAngSpd >= _colMinSpd && _colSweepDist >= _colMinDist;
      for (const _he of hordeEnemies) {
        if (_he.isDead) continue;

        // Sword-sword collision: any player blade point within 0.15 m of any enemy blade point
        // (bombers carry no sword, so they can only be hit)
        let _swordCollision = false;
        if (_he._swordGroup) {
          const _enemyBladePoints = _pswSampleOffsets.map(p =>
            p.clone().applyQuaternion(_he._swordGroup.quaternion).add(_he._swordGroup.position)
          );
          outer: for (const pp of _playerBladePoints) {
            for (const ep of _enemyBladePoints) {
              if (pp.distanceTo(ep) < 0.15) { _swordCollision = true; break outer; }
            }
          }
        }

        // Blocks are directional and only happen while the enemy holds its block stance:
        // a swing that reaches the enemy (body or blade) is stopped only if it crosses the
        // blocking blade (see swingCrossesBlade). Otherwise blade contact is ignored and the
        // swing can land. The player can't hit while holding their own block button.
        const _playerBlocking = !!window.phoneSwordGyro?.blocking;
        if (!_playerBlocking) {
          const _enemyCenter = _he.group.position.clone();
          _enemyCenter.y += 0.8;
          const _reachesBody = _tipWorld.distanceTo(_enemyCenter) < 0.65;
          const _nowMsPS = Date.now();
          if (!_he._playerSwordLastHit) _he._playerSwordLastHit = 0;
          if ((_reachesBody || _swordCollision) && _nowMsPS - _he._playerSwordLastHit > 1000 && _psw.prevTipWorld) {
            const _sweepVec = new THREE.Vector3().subVectors(_tipWorld, _psw.prevTipWorld);
            const _sweepDist = _sweepVec.length();
            const _minSweep = window.phoneSwordSwingCfg?.minSweepDist ?? 0.015;
            const _minSweepSpd = window.phoneSwordSwingCfg?.minSweepSpeed ?? 2000;
            const _curAngSpd = window._pswDebugSpeed ?? 0;
            if (_sweepDist > _minSweep && _curAngSpd >= _minSweepSpd) {
              // Swing direction over the last few frames (steadier than one frame's delta)
              const _swingDir = _psw.tipHistory.length
                ? new THREE.Vector3().subVectors(_tipWorld, _psw.tipHistory[0].pos)
                : _sweepVec.clone();
              if (_he.blocksSwing?.(_swingDir, playerModel.position)) {
                // Enemy's block holds — both swords recoil, no damage
                _he.applySwordBounce?.();
                audioManager?.playSFX('SFX/Attacks/Sword Attacks Hits and Blocks/Sword Parry 2.ogg', 0.65, { cooldownKey: 'psw-parry', cooldownMs: 300 });
                if (!_psw.bounceActive) {
                  const _bounceCfg = window.phoneSwordSwingCfg;
                  const _bounceAngle = (_bounceCfg?.bounceAngle ?? 90) * (Math.PI / 180);
                  const _bounceDur   = _bounceCfg?.bounceHoldDur ?? 0.35;
                  const _yRot = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), _bounceAngle);
                  _psw.bounceActive    = true;
                  _psw.bounceStartTime = _nowSecPS;
                  _psw.bounceDur       = _bounceDur;
                  _psw.bounceFromQ.copy(_activeQ);
                  _psw.bounceTargetQ.copy(_yRot).multiply(_activeQ);
                  _psw.bounceCurrentQ.copy(_activeQ);
                }
                // Small step forward into the blocked swing (instead of the miss lunge)
                const _blockFwd = new THREE.Vector3(0, 0, 1).applyQuaternion(playerModel.quaternion);
                _blockFwd.y = 0; _blockFwd.normalize();
                const _bsx = playerModel.position.x + _blockFwd.x * 0.09;
                const _bsz = playerModel.position.z + _blockFwd.z * 0.09;
                playerModel.position.x = _bsx; playerModel.position.z = _bsz;
                playerControls.playerX = _bsx; playerControls.playerZ = _bsz;
                playerControls.lastPosition?.set(_bsx, playerModel.position.y, _bsz);
                if (playerControls.body) playerControls.body.setNextKinematicTranslation({ x: _bsx, y: playerModel.position.y + 0.6, z: _bsz });
                _swingHitOccurred = true; // blocked swing doesn't lunge
                _he._playerSwordLastHit = _nowMsPS; // this swing is spent
              } else if (_reachesBody) {
                const _sweepDir = _sweepVec.clone().normalize();
                _sweepDir.y = 0;
                if (_sweepDir.lengthSq() < 0.0001) _sweepDir.set(0, 0, 1);
                _sweepDir.normalize();
                const _killingBlow = _he.applyDamage(1);
                if (_killingBlow) {
                  // Full knockback on killing hit
                  _he.applyDirectKnockback({
                    direction: _sweepDir,
                    horizSpeed: 10,
                    upVelocity: 1,
                    torqueMag: 60,
                    ragdoll: true,
                  });
                } else {
                  // Weak step-back on non-killing hit
                  const _weakSpd = window.phoneSwordSwingCfg?.hitKnockbackWeak ?? 3;
                  _he.applyDirectKnockback({
                    direction: _sweepDir,
                    horizSpeed: _weakSpd,
                    upVelocity: 0.2,
                    torqueMag: 0,
                    ragdoll: false,
                  });
                }
                _swingHitOccurred = true;
                audioManager?.playSFX('SFX/Attacks/Sword Attacks Hits and Blocks/Sword Impact Hit 3.ogg', 0.6, { cooldownKey: 'psw-hit', cooldownMs: 200 });
                _he._playerSwordLastHit = _nowMsPS;
              }
            }
          }
        }
      }
      // Forward lunge on fast swing that missed all enemies
      // Suppress if any enemy is very close (prevents clipping through them)
      const _lungeProximityDist = 1.0;
      const _tooCloseToEnemy = hordeEnemies.some(_e =>
        !_e.isDead && _e.group &&
        playerModel.position.distanceTo(_e.group.position) < _lungeProximityDist
      );
      if (_playerMovingFast && !_swingHitOccurred && !_tooCloseToEnemy) {
        const _missFwd = new THREE.Vector3(0, 0, 1).applyQuaternion(playerModel.quaternion);
        _missFwd.y = 0; _missFwd.normalize();
        const _msx = playerModel.position.x + _missFwd.x * 0.15;
        const _msz = playerModel.position.z + _missFwd.z * 0.15;
        playerModel.position.x = _msx; playerModel.position.z = _msz;
        playerControls.playerX = _msx; playerControls.playerZ = _msz;
        playerControls.lastPosition?.set(_msx, playerModel.position.y, _msz);
        if (playerControls.body) playerControls.body.setNextKinematicTranslation({ x: _msx, y: playerModel.position.y + 0.6, z: _msz });
      }

      // Store previous-frame state for next frame
      _psw.prevTipWorld = _tipWorld.clone();
      _psw.prevSwordQ.copy(_activeQ);
      _psw.tipHistory.push({ pos: _psw.prevTipWorld, t: _nowSecPS });
      while (_psw.tipHistory.length && _nowSecPS - _psw.tipHistory[0].t > 0.12) _psw.tipHistory.shift();
    }
    // Phone Sword: apply fixed position/rotation config to shield and pistol,
    // and feed phoneSwordGyro data into the camera gyro system.
    const _wCfg = window.phoneSwordWeaponCfg;
    const _DEG = Math.PI / 180;
    if (_wCfg) {
      if (shield?.holder === playerControls) {
        shield._holdOffset.set(
          _wCfg.shieldPosX ?? -0.18,
          _wCfg.shieldPosY ?? 0.2,
          _wCfg.shieldPosZ ?? 0.2
        );
        shield._holdQuaternion.setFromEuler(new THREE.Euler(
          (_wCfg.shieldRotX ?? 90) * _DEG,
          (_wCfg.shieldRotY ?? 0) * _DEG,
          (_wCfg.shieldRotZ ?? 0) * _DEG,
          'YXZ'
        ));
      }
      if (pistol?.holder === playerControls) {
        pistol._holdOffset.set(
          _wCfg.gunPosX ?? 0.0,
          _wCfg.gunPosY ?? 0.0,
          _wCfg.gunPosZ ?? 0.0
        );
        pistol._holdQuaternion.setFromEuler(new THREE.Euler(
          (_wCfg.gunRotX ?? 0) * _DEG,
          (_wCfg.gunRotY ?? 180) * _DEG,
          (_wCfg.gunRotZ ?? 0) * _DEG,
          'YXZ'
        ));
      }
    }
    // Feed phoneSwordGyro data into camera gyro each frame
    const _pg = window.phoneSwordGyro;
    if (_pg?.connected && playerControls?.gyroActive && _pg.alpha !== null) {
      playerControls.gyroLastAlpha = _pg.alpha;
      playerControls.gyroLastBeta = _pg.beta ?? 0;
      playerControls.gyroLastGamma = _pg.gamma ?? 0;
    }
    pistol?.update();
    shield?.update();

    // ── Phone Sword: auto-walk + queue spawn (runs even when hordeEnemies is empty) ──
    const _tutorialActive = !!showdownTutorial?.isActive();
    if ((_psStageActive || _tutorialActive) && !playerDead) {
      // Spawn queued enemies as player approaches their positions
      for (let _qi = _psEnemyQueue.length - 1; _qi >= 0; _qi--) {
        const _qe = _psEnemyQueue[_qi];
        if (playerModel.position.distanceTo(_qe.pos) <= PS_SPAWN_TRIGGER_DIST) {
          _spawnHordeEnemy({ position: _qe.pos, hearts: _qe.hearts, speedScale: PS_ENEMY_SPEED, bombThrower: _qe.bombThrower });
          _psEnemyQueue.splice(_qi, 1);
        }
      }

      // Auto-walk: pause when an enemy is actively attacking close by,
      // or while the camera is tracking an incoming bomb
      if (_psAutoWalking) {
        const _hasNearAttacker = hordeEnemies.some(e =>
          !e.isDead &&
          e._aiState === 'attack' &&
          e.group.position.distanceTo(playerModel.position) < 3.5
        );
        if (_psFindIncomingBomb()) {
          playerControls.isMoving = false;
        } else if (!_hasNearAttacker) {
          const _ddx = _psPathEnd.x - playerModel.position.x;
          const _ddz = _psPathEnd.z - playerModel.position.z;
          const _distToEnd = Math.sqrt(_ddx * _ddx + _ddz * _ddz);
          if (_distToEnd > 1.5) {
            // Recompute direction each frame so manual movement doesn't break the path
            _psAutoWalkDir.set(_ddx / _distToEnd, 0, _ddz / _distToEnd);
            const _moveStep = PS_SPEED * frameDelta;
            const _nx = playerModel.position.x + _psAutoWalkDir.x * _moveStep;
            const _nz = playerModel.position.z + _psAutoWalkDir.z * _moveStep;
            playerModel.position.x = _nx;
            playerModel.position.z = _nz;
            playerControls.playerX = _nx;
            playerControls.playerZ = _nz;
            playerControls.lastPosition?.set(_nx, playerModel.position.y, _nz);
            if (playerControls.body) {
              playerControls.body.setNextKinematicTranslation({ x: _nx, y: playerModel.position.y + 0.6, z: _nz });
            }
            playerControls.isMoving = true;
          } else {
            _psAutoWalking = false;
            playerControls.isMoving = false;
          }
        }
      }

      // Win detection
      if (_psStageActive && !_psWinShown && _psEnemyQueue.length === 0 && hordeEnemies.length > 0 && hordeEnemies.every(e => e.isDead)) {
        _psStageActive = false;
        _psWinShown = true;
        addPlayerXp(getSwordShowdownStageXp(_psStage));
        // Stage cleared: restore the player to full health
        setStat('health', statsState.maxHealthSegments);
        const _nextStage = _psStage + 1;
        _psShowWin(() => {
          if (_nextStage <= 50) {
            _psStage = _nextStage;
            _psSaveStage(_psStage);
            _psShowStageOverlay(_nextStage, (count) => _psStartStage(_nextStage, count));
          } else {
            _psStage = 1;
            _psSaveStage(_psStage);
            _psShowStageOverlay(1, (count) => _psStartStage(1, count));
          }
        });
      }

      // ── Phone Sword: camera auto-aim at closest enemy ──
      if (playerControls && hordeEnemies.length > 0) {
        const _now = performance.now();

        // Detect manual camera movement: if yaw changed and we didn't set it, player moved camera
        const _curYaw = playerControls.yaw;
        if (_psCamLastYaw !== null) {
          const _yawDiff = Math.abs(((_curYaw - _psCamLastYaw + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
          if (_yawDiff > 0.01 && playerControls.cameraTouchId !== null) {
            _psCamManualUntil = _now + PS_CAM_MANUAL_TIMEOUT;
          }
        }

        const _incomingBomb = _psFindIncomingBomb();
        if (_now >= _psCamManualUntil && _incomingBomb) {
          // Incoming bomb takes priority over enemies: track the closest one
          const _bp = _incomingBomb.mesh.position;
          const _dx = _bp.x - playerModel.position.x;
          const _dz = _bp.z - playerModel.position.z;
          if (Math.hypot(_dx, _dz) > 0.5) {
            const _targetYaw = Math.atan2(_dx, _dz);
            const _yawDelta = ((_targetYaw - playerControls.yaw + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;
            playerControls.yaw += _yawDelta * Math.min(1, frameDelta * 6);
          }
          _psCamLastYaw = playerControls.yaw;
        } else if (_now >= _psCamManualUntil) {
          // Find closest living enemy
          let _closest = null;
          let _closestDist = Infinity;
          for (const _e of hordeEnemies) {
            if (_e.isDead) continue;
            const _ep = _e.group?.position ?? _e.model?.position;
            if (!_ep) continue;
            const _d = playerModel.position.distanceTo(_ep);
            if (_d < _closestDist) { _closestDist = _d; _closest = _e; }
          }

          if (_closest) {
            // Hysteresis: decide whether to switch camera target
            const _curTargetDist = _psCamTarget && !_psCamTarget.isDead
              ? playerModel.position.distanceTo(_psCamTarget.group?.position ?? _psCamTarget.model?.position ?? playerModel.position)
              : Infinity;

            if (!_psCamTarget || _psCamTarget.isDead) {
              // No current target — take the closest immediately
              _psCamTarget = _closest;
              _psCamCandidate = null;
            } else if (_closest === _psCamTarget) {
              // Still the same target, reset candidate
              _psCamCandidate = null;
            } else {
              // Different closest enemy — apply hysteresis
              if (_closest !== _psCamCandidate) {
                _psCamCandidate = _closest;
                _psCamCandidateTime = _now;
              }
              const _muchCloser = (_curTargetDist - _closestDist) >= PS_CAM_SWITCH_MIN_CLOSER;
              const _stableEnough = (_now - _psCamCandidateTime) >= PS_CAM_SWITCH_STABLE_MS;
              if (_muchCloser || _stableEnough) {
                _psCamTarget = _psCamCandidate;
                _psCamCandidate = null;
              }
            }

            // Aim camera yaw at target
            const _tp = _psCamTarget?.group?.position ?? _psCamTarget?.model?.position;
            if (_tp && !_psCamTarget.isDead) {
              const _dx = _tp.x - playerModel.position.x;
              const _dz = _tp.z - playerModel.position.z;
              if (Math.hypot(_dx, _dz) > 0.5) {
                const _targetYaw = Math.atan2(_dx, _dz);
                // Smooth approach to avoid snapping
                const _yawDelta = ((_targetYaw - playerControls.yaw + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;
                playerControls.yaw += _yawDelta * Math.min(1, frameDelta * 4);
                _psCamLastYaw = playerControls.yaw;
              }
            }
          } else {
            _psCamTarget = null;
            _psCamCandidate = null;
            _psCamLastYaw = playerControls.yaw;
          }
        } else {
          // Manual control active — track current yaw without overriding
          _psCamLastYaw = playerControls.yaw;
        }
      }
    }

    // ── Phone sword jump (runs regardless of enemy count) ─────────────────
    if (playerModel) {
      // Ground under the player's current XZ (the stage isn't flat, and a blast carries
      // the player several metres while airborne — landing on a stale height sank them).
      const _psGroundAt = () => {
        const _gy = playerControls?.resolveGroundY?.(
          playerModel.position.x, playerModel.position.y + 0.6, playerModel.position.z,
          { includeSolidHit: false }
        )?.groundY;
        return Number.isFinite(_gy) ? _gy : (_psGroundY ?? playerModel.position.y);
      };
      if (_psJumpVelY === 0 && !window.phoneSwordAirborne) _psGroundY = playerModel.position.y;
      if (window.phoneSwordJumpPressed) {
        window.phoneSwordJumpPressed = false;
        if (playerModel.position.y <= _psGroundY + 0.05) {
          _psJumpVelY = PS_JUMP_FORCE;
          window.phoneSwordAirborne = true;
        }
      }
      if (_psJumpVelY !== 0) {
        _psJumpVelY -= PS_GRAVITY * frameDelta;
        playerModel.position.y += _psJumpVelY * frameDelta;
        playerControls.playerY = playerModel.position.y;
        if (playerControls.body) {
          playerControls.body.setNextKinematicTranslation({
            x: playerModel.position.x,
            y: playerModel.position.y + 0.6,
            z: playerModel.position.z
          });
        }
        _psGroundY = _psGroundAt();
        if (playerModel.position.y <= _psGroundY) {
          playerModel.position.y = _psGroundY;
          playerControls.playerY = _psGroundY;
          _psJumpVelY = 0;
          window.phoneSwordAirborne = false;
          playerControls.canJump = true;
        }
      }
    }

    // ── Horde enemy update ─────────────────────────────────────────────────
    if (hordeEnemies.length > 0) {
      // Sync kinematic player body to visual position each frame
      if (playerControls?.body) {
        playerControls.body.setNextKinematicTranslation({
          x: playerModel.position.x,
          y: playerModel.position.y + 0.6,
          z: playerModel.position.z
        });
      }

      // Apply and decay visual knockback on the player
      const _nowMs = Date.now();
      if (_nowMs < _playerKnockback.endTime) {
        const decay = Math.exp(-5 * frameDelta);
        _playerKnockback.vx *= decay;
        _playerKnockback.vz *= decay;
        playerControls.playerX = (playerControls.playerX || playerModel.position.x) + _playerKnockback.vx * frameDelta;
        playerControls.playerZ = (playerControls.playerZ || playerModel.position.z) + _playerKnockback.vz * frameDelta;
      }

      const shieldEquipped = shield?.holder === playerControls &&
        !!(inventoryState[SHIELD_ITEM_ID]?.count > 0);
      const swordMesh = foamSword?.holder === playerControls && foamSword?.useHeldMeshWhenHeld && foamSword?.heldMesh
        ? foamSword.heldMesh
        : (foamSword?.holder === playerControls ? foamSword?.mesh : null);
      const _tipOffset = swordMesh ? new THREE.Vector3(0, 0, 0.69).applyQuaternion(swordMesh.quaternion) : null;
      const _tipWorld  = swordMesh ? swordMesh.position.clone().add(_tipOffset) : null;

      // Determine which swordsmen get an attack slot (closest alive ones, count by stage;
      // bombers don't use slots)
      const _MAX_ATTACKERS = _psMaxAttackers(_psStage);
      const _liveEnemies = hordeEnemies.filter(e => !e.isDead && !(e instanceof BombThrowerEnemy));
      _liveEnemies.sort((a, b) =>
        a.group.position.distanceTo(playerModel.position) -
        b.group.position.distanceTo(playerModel.position)
      );
      const _attackSlotSet = new Set(_liveEnemies.slice(0, _MAX_ATTACKERS));

      // Sword Showdown: enemies hold their attacks while a bomb is inbound
      const _pauseForBomb = !!_psFindIncomingBomb();

      for (let _hi = hordeEnemies.length - 1; _hi >= 0; _hi--) {
        const _he = hordeEnemies[_hi];
        if (_he.isDead) {
          // Drop coins on first death frame (phone sword mode)
          if (!_he._coinDropped) {
            _he._coinDropped = true;
            _psStageKills++;
            _psUpdateKillHud(true);
            addPlayerXp(getSwordShowdownKillXp(_psStage));
            const _dropPos = _he.group.position.clone();
            spawnCoinPickup(_dropPos);
            if (Math.random() < 0.4) spawnCoinPickup(_dropPos.clone().add(new THREE.Vector3((Math.random()-0.5)*1.5, 0, (Math.random()-0.5)*1.5)));
          }
          // Remove from array once the Three.js group has been removed from scene
          if (!_he.group.parent) {
            hordeEnemies.splice(_hi, 1);
            if (_he._tutorial) continue; // tutorial kills don't count
            _psStats.kills = (_psStats.kills || 0) + 1;
            if (profileNameKey) void savePhoneSwordStats(profileNameKey, { ..._psStats });
          } else {
            // Still call update so physics ragdoll position/rotation syncs to visual
            _he.update(frameDelta, null, null, false, false);
          }
          continue;
        }

        const _allowAttack = _attackSlotSet.has(_he);
        _he.update(frameDelta, playerModel, playerControls, shieldEquipped, _allowAttack, _pauseForBomb);

        // Push enemy away if it gets too close to the player (prevents clipping)
        const _pushDist = 0.5;
        const _dx = _he.group.position.x - playerModel.position.x;
        const _dz = _he.group.position.z - playerModel.position.z;
        const _dist2d = Math.sqrt(_dx * _dx + _dz * _dz);
        if (_dist2d < _pushDist && _dist2d > 0.001) {
          const _pushStep = (_pushDist - _dist2d) * 0.15;
          _he.group.position.x += (_dx / _dist2d) * _pushStep;
          _he.group.position.z += (_dz / _dist2d) * _pushStep;
        }

        _he._onHitPlayer = (direction) => {
          const speed = 4.5;
          _playerKnockback.vx = direction.x * speed;
          _playerKnockback.vz = direction.z * speed;
          _playerKnockback.endTime = Date.now() + 800;
        };

        // ── Player's foam sword hitting the enemy ──────────────────────────
        // In phone sword mode, hits only register during an active swing or slow-swing hit window.
        // Simply touching the enemy with the sword while idle or blocking deals no damage.
        if (!_he._playerSwordLastHit) _he._playerSwordLastHit = 0;
        const _nowMs2 = Date.now();
        const _phoneSwordHitOk = _psw.swingActive ||
          (_nowMs2 / 1000 < _psw.slowHitWindow);
        const _canSwordHit = swordMesh?.visible &&
          _phoneSwordHitOk &&
          (_nowMs2 - _he._playerSwordLastHit) > 1000;
        if (_canSwordHit) {
          const _enemyCenter = _he.getCenterWorldPos();
          if (_tipWorld.distanceTo(_enemyCenter) < 0.65) {
            const _hitDir = new THREE.Vector3()
              .subVectors(_he.group.position, playerModel.position);
            _hitDir.y = 0;
            if (_hitDir.lengthSq() < 0.0001) _hitDir.set(0, 0, 1);
            _hitDir.normalize();
            const _baseKB = window._hordeKB ?? { horizSpeed: 12.5, upVelocity: 0, torqueMag: 10, ragdoll: true };
            // Scale damage and knockback by swing strength tier
            const _str = _psw.swingStrength || 2;
            const _dmg = _str === 1 ? 1 : _str === 3 ? 4 : 2;
            const _kbSpeed = _str === 1 ? _baseKB.horizSpeed * 0.4 : _str === 3 ? _baseKB.horizSpeed * 1.6 : _baseKB.horizSpeed;
            _he.applyDamage(_dmg);
            _he.applyDirectKnockback({ direction: _hitDir, ..._baseKB, horizSpeed: _kbSpeed });
            audioManager?.playSFX('SFX/Attacks/Sword Attacks Hits and Blocks/Sword Impact Hit 3.ogg', 0.6, { cooldownKey: 'psw-hit', cooldownMs: 200 });
            _he._playerSwordLastHit = _nowMs2;
            // Close the slow-swing hit window after first hit so it only triggers once
            if (_psw.slowHitWindow > 0 && _nowMs2 / 1000 < _psw.slowHitWindow) {
              _psw.slowHitWindow = 0;
            }
          }
        }
      }

      // ── Foam sword deflects in-flight enemy bombs ────────────────────────
      if (swordMesh?.visible && _tipWorld) {
        const _bombs = window._enemyBombs;
        if (Array.isArray(_bombs)) {
          for (let _bi = _bombs.length - 1; _bi >= 0; _bi--) {
            const _bomb = _bombs[_bi];
            if (!_bomb || _bomb.deflected) continue;
            if (_tipWorld.distanceTo(_bomb.mesh.position) < 0.5) {
              // Deflect: send bomb back toward the thrower
              const _thrower = _bomb.thrower;
              let _deflectDir;
              if (_thrower && _thrower.group) {
                _deflectDir = _thrower.group.position.clone().sub(_bomb.mesh.position).normalize();
              } else {
                _deflectDir = _bomb.vel.clone().negate().normalize();
              }
              _deflectDir.y = 0.35;
              _deflectDir.normalize();
              _bomb.vel.copy(_deflectDir.multiplyScalar(BOMB_DEFLECT_SPEED));
              _bomb.deflected = true;
              _bomb.deflectedAt = Date.now();
              window.audioManager?.playSFX?.('SFX/Attacks/Sword Attacks Hits and Blocks/Sword Impact Hit 3.ogg', 0.75, { cooldownKey: 'bomb-deflect', cooldownMs: 80 });
              window._pswShowBlockFlash?.('player');
            }
          }
        }
      }
    }
    syncRemoteHeldWeaponMesh(shield);

    if (window.localHealth <= 0 && !playerDead) {
      playerDead = true;
      deactivatePlayerBubble();
      window.onPlayerDeath?.();
      updateControlAvailability();
      const actions = playerModel.userData.actions;
      const current = playerModel.userData.currentAction;
      const die = actions?.die;
      if (die) {
        actions[current]?.fadeOut(0.2);
        die.reset().fadeIn(0.2).play();
        playerModel.userData.currentAction = 'die';
      }
      // GLB character: play the flying-back death clip once (held until respawn)
      playerModel.userData.qwopRig?.glbCharacter?.playDeath();
      showGameOver();
    }

    const mixerDelta = mixerClock.getDelta();

    // (The local player's GLB character is animated in updateProceduralPlayerRig, via playerControls.update.)

    // 1) Always advance animation mixers (every frame)
    Object.values(otherPlayers).forEach(p => {
      p.model?.userData?.mixer?.update(mixerDelta);
      updateRemotePlayerRig(p.model, mixerDelta);
    });

    if (now - lastPresenceSweep >= PRESENCE_SWEEP_MS) {
      lastPresenceSweep = now;
      const localFix = playerModel?.position;
      Object.entries(remotePresenceMeta).forEach(([remoteId, meta]) => {
        if (!meta) return;
        if (now - meta.lastSeenMs > PRESENCE_STALE_MS) {
          removeRemotePlayer(remoteId, 'stale');
          return;
        }
        const player = otherPlayers[remoteId];
        if (!localFix) {
          if (player?.model) {
            player.model.visible = true;
          }
          if (player?.nameLabel) {
            player.nameLabel.style.display = 'block';
          }
          return;
        }
        let dist = null;
        if (Number.isFinite(meta.lastX) && Number.isFinite(meta.lastZ)) {
          dist = Math.hypot(meta.lastX - localFix.x, meta.lastZ - localFix.z);
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

    if (now - lastPresenceSend >= presenceSendIntervalMs) {
      const payload = {
        type: "presence",
        id: multiplayer.getId(),
        name: playerName,
        x: playerModel.position.x,
        y: playerModel.position.y,
        z: playerModel.position.z,
        rotation: playerModel.rotation.y,
        action: playerModel.userData.currentAction
      };
      payload.equippedLeft = isInventoryItemEquipped(SHIELD_ITEM_ID) ? SHIELD_ITEM_ID : null;
      payload.equippedRight = isInventoryItemEquipped(FOAM_SWORD_ITEM_ID) ? 'sword' : null;
      const dx = payload.x - (lastSentPresenceState.x ?? payload.x);
      const dy = payload.y - (lastSentPresenceState.y ?? payload.y);
      const dz = payload.z - (lastSentPresenceState.z ?? payload.z);
      const moved = ((dx * dx) + (dy * dy) + (dz * dz)) > runtimePositionDeadbandSq;
      const rotated = Math.abs(wrapDeltaRad((payload.rotation ?? 0) - (lastSentPresenceState.rotation ?? 0))) >= runtimeRotationDeadbandRad;
      const actionChanged = payload.action !== lastSentPresenceState.action;
      const heartbeatDue = now - (lastSentPresenceState.sentAt || 0) >= PRESENCE_HEARTBEAT_MS;
      if (lastSentPresenceState.x == null || moved || rotated || actionChanged || heartbeatDue) {
        queueNetMessage(payload);
        lastSentPresenceState.x = payload.x;
        lastSentPresenceState.y = payload.y;
        lastSentPresenceState.z = payload.z;
        lastSentPresenceState.rotation = payload.rotation ?? 0;
        lastSentPresenceState.action = payload.action ?? null;
        lastSentPresenceState.sentAt = now;
      } else {
        netStats.dropped += 1;
      }
      lastPresenceSend = now;
    }
    applyRuntimeNetworkProfile({
      incomingBacklog: lastIncomingBacklog,
      incomingProcessCount: lastIncomingProcessCount,
      overrunStreak: frameOverrunStreak,
      recoverStreak: frameRecoverStreak
    });
    flushNetSendQueue();
    tickNetStats(now);

    if (shouldRunBucket('remoteLabels')) {
      withSubsystemTiming('remoteLabels', () => {
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
      });
    }

    const localPlayerPosition = playerModel?.position;
    if (localPlayerPosition && audioManager && shouldRunBucket('audio')) {
      withSubsystemTiming('audio', () => {
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

      });
    }

    updateProjectiles({
      projectiles,
      otherPlayers,
      multiplayer,
      hordeEnemies
    });
    renderer.render(scene, camera);
    const frameTotalMs = performance.now() - frameStartMs;
    if (frameTotalMs > FRAME_TIME_DEGRADE_THRESHOLD_MS) {
      frameOverrunStreak += 1;
      frameRecoverStreak = 0;
    } else if (frameTotalMs < FRAME_TIME_RECOVER_THRESHOLD_MS) {
      frameRecoverStreak += 1;
      frameOverrunStreak = 0;
    } else {
      frameOverrunStreak = 0;
      frameRecoverStreak = 0;
    }
    if (frameOverrunStreak >= 6) {
      adaptiveDegradeLevel = Math.min(FRAME_TIME_DEGRADE_MAX_LEVEL, adaptiveDegradeLevel + 1);
      frameOverrunStreak = 0;
    } else if (frameRecoverStreak >= 30) {
      adaptiveDegradeLevel = Math.max(0, adaptiveDegradeLevel - 1);
      frameRecoverStreak = 0;
    }
  }

  canProcessIncomingPeerData = true;
  processIncomingPeerDataQueue();

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

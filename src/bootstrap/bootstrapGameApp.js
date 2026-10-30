// app.js
import QRCode from 'qrcode';
import * as THREE from "three";
import { spawnBloodBurst, updateBloodEffects, setBloodEnabled } from "../combat/bloodEffect.js";
import { updateExplosionEffects } from "../combat/explosionEffect.js";
import { PlayerCharacter } from "../characters/PlayerCharacter.js";
import { updateRemotePlayerRig, setPlayerCharacterUrl } from "../models/playerModel.js";
import { glbCharacterConfig, characterHold, preloadCharacterModel, isCharacterModelSettled } from "../models/glbCharacterModel.js";
import { createSwordModelInstance } from "../items/swordModel.js";
import { getTerrainHeight, registerTerrainHeightResolver, registerWallProbe, setTerrainFloor } from '../environment/terrainHeight.js';
import { registerMapMeshes } from '../environment/mapCollision.js';
import { updateBulletImpacts } from '../combat/bulletImpact.js';
import { presetStyleReference, setStyleReference, stylizeObject } from '../environment/artStyle.js';
import { setBlobShadowsEnabled } from '../environment/blobShadows.js';
import { showFeatureLoading } from '../features/loadingState.js';
import { Multiplayer, LOBBY_ROOM_ID } from '../multiplayer/peerConnection.js';
import { createDuelMode } from '../multiplayer/duelMode.js';
import { createMatchMode, MATCH_CHARACTERS } from '../multiplayer/matchMode.js';
import { PlayerControls } from '../controls/controls.js';
import { getCookie, setCookie } from '../core/utils.js';
import { createAudioManager } from '../features/audioFeature.js';
import { spawnProjectile, updateProjectiles, loadSpecialWeapons } from '../features/combatFeature.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import RAPIER from '@dimforge/rapier3d-compat';
import { removeRigidBodySafely } from '../physics/rapierSafety.js';
import { getSpawnPosition, getSpawnY, setSpawnCenter } from '../map/spawnUtils.js';
import {
  BASE_HEALTH_SEGMENTS,
  SHOWDOWN_BASE_HEALTH_SEGMENTS,
  SHOWDOWN_MAX_HEALTH_SEGMENTS,
  clampHealthSegments
} from '../player/healthUtils.js';
import {
  initSettingsPanel,
  openSettings,
  openLeaderboard,
  updateSettingsUI,
  initMerchantPanelFeature,
  updateMerchantUIFeature,
  initMerchantFeature
} from '../features/uiPanelsFeature.js';
import { appContext } from '../core/appContext.js';
import { exposeDebugGlobals } from '../core/exposeDebugGlobals.js';
import { keepScreenAwake } from '../core/wakeLock.js';
import { EnemyPlayer, swingCrossesBlade, PLAYER_BLOCK_MIN_ANGLE_DEG } from '../characters/EnemyPlayer.js';
import { BombThrowerEnemy, BOMB_DEFLECT_SPEED } from '../characters/BombThrowerEnemy.js';
import { createPlayerBombs } from '../combat/playerBomb.js';
import { createHeartBubbles } from '../combat/heartBubbles.js';
import { createStageChests } from '../combat/stageChests.js';
import { createComboMeter } from '../combat/comboMeter.js';
import { createDeathCarry } from '../combat/deathCarry.js';
import {
  createMagicBlasts, bladeBlocksBlast, createIceEncasing, setIceEncasingLevel, shakeIceEncasing, MAGIC_ELEMENTS
} from '../combat/magicBlast.js';
import { setWandGlow, createWandModel } from '../items/magicWand.js';
import { createFishingRodModel, ROD_HOLD_PITCH } from '../items/fishingRod.js';
import { createLantern } from '../items/lantern.js';
import { createShowdownTutorial } from '../tutorial/showdownTutorial.js';
import { createVillage, PEMBERTON_STAGE, villagerQuestReward, villagePlace, fillTalk } from '../village/villageMode.js';
import { stageRoute, createPolyline } from '../map/stageRoutes.js';
import { createDevRoam } from '../dev/devRoam.js';
import { createTownMode } from '../town/townMode.js';
import { createTownNet } from '../town/townNet.js';
import { createSeaStart } from '../town/seaStart.js';
import { OAR_REST_SWING, OAR_REST_TILT, OAR_TIP_AT, oarGripPoint, oarStrokeDuration, oarStrokePose } from '../items/oar.js';
import { CANOE_HALF_LENGTH, CANOE_HALF_WIDTH } from '../items/canoe.js';
import { createBroomRide } from '../items/broom.js';
import { CANOE_STAND_Z, WALLET_MAX as TOWN_WALLET_MAX } from '../town/townConfig.js';
import { createPembertonBoss, createStageBoss, createBossFighter, PEMBERTON_HEARTS, PEMBERTON_SWING_CHANCE } from '../characters/pembertonBoss.js';
import { createBossTalk, stageBossTalk, stageBossGear, stageBossGearIcons, SPARED_STAGE, FIRST_WAND_BOSS_STAGE, ROAM_QUESTS, roamQuestReward } from '../characters/stageBoss.js';

import {
  clearStoredPin,
  deleteProfileData,
  getStoredPinHash,
  loadOrCreateWithPin,
  renameProfile,
  saveStatsImmediate as saveStatsImmediateRaw,
  saveStatsThrottled as saveStatsThrottledRaw,
  loadPhoneSwordLeaderboards,
  loadMultiplayerLeaderboards,
  recordMultiplayerResult,
  normalizeMultiplayerStats,
  savePhoneSwordStats,
  loadPhoneSwordStats,
  savePhoneSwordStage,
  loadPhoneSwordStage,
  saveClassicStage,
  saveClassicStats,
  normalizeStageStats,
  loadClassicStage,
  saveShowdownCharacters,
  loadShowdownCharacters,
  hasCompletedTutorial,
  saveTutorialCompleted,
  loadTownSave,
  saveTownSave,
  randomGuestName,
  buildGuestProfile
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
// Guests (no profile) have nameKey null: nothing is saved.
// Multiplayer battles (matchCtx.startMatchLoadout): the pickup loadout is never saved.
let _statSavesSuspended = false;
// Town mode (startTownLoadout): the real items and stats set aside while the town's own are in
// hand — { stats: { coins, health, maxHealthSegments, bombs, … }, inventory: { itemId: entry | null } }.
// Saves write these instead, so the town's coins, health and gear never reach the profile.
let _saveAside = null;
// (stats, [lastStatUpdateAt, inventory]) → the save call's arguments after nameKey
const _statsSaveArgs = (stats, rest) => {
  if (!_saveAside) return [statsForSave(stats), ...rest];
  const [lastStatUpdateAt, inventory] = rest;
  let inv = inventory;
  if (inventory) {
    inv = { ...inventory };
    for (const [key, entry] of Object.entries(_saveAside.inventory)) {
      if (entry) inv[key] = entry;
      else delete inv[key];
    }
  }
  return [statsForSave(stats ? { ...stats, ..._saveAside.stats } : stats), lastStatUpdateAt, inv];
};
const saveStatsImmediate = (nameKey, stats, ...rest) => (nameKey && !_statSavesSuspended ? saveStatsImmediateRaw(nameKey, ..._statsSaveArgs(stats, rest)) : undefined);
const saveStatsThrottled = (nameKey, stats, ...rest) => (nameKey && !_statSavesSuspended ? saveStatsThrottledRaw(nameKey, ..._statsSaveArgs(stats, rest)) : undefined);

// Sword Showdown: max "Shield Upgrade" purchases (each +SHIELD_UPGRADE_HEALTH durability → 20 + 4×10 = 60 max)
const SHOWDOWN_MAX_SHIELD_UPGRADES = 4;

// ── Sword Showdown magic wand (bought for 500, swiped like the sword; src/combat/magicBlast.js) ──
const MAGIC_WAND_ITEM_ID = 'magic_wand';
// Town's fishing rod (bought at the shop): the sword weapon in rod form, like the wand
const FISHING_ROD_ITEM_ID = 'fishing_rod';
const OAR_ITEM_ID = 'canoe_oar';
// Town's canoe oar (and the sea start's): the phone's tilt steers the canoe like a joystick
// (_readOarTilt → _getSteer) — the top tipped forward paddles on, back backs up, leaned left /
// right turns that way; nothing within OAR_STEER_DEAD of how the phone was held when the oar came
// out (or after a gap in the gyro), all the way by OAR_STEER_FULL. The oar's strokes play by
// themselves to fit (_oarPose: side, direction and tempo from the steer). The gyro-held oar that
// came before (the tilt holding the blade, assisted strokes): docs/archive/canoe-gyro-paddling.md
const OAR_STEER_DEAD = 6 * Math.PI / 180;
const OAR_STEER_FULL = 28 * Math.PI / 180;
const OAR_POSE_RATE = 16;  // per s: the oar easing into the stroke's pose
const OAR_LEAN_RATE = 6;   // per s: the hands moving over to the other side
// The hull the oar is kept out of (player-local, the player standing at CANOE_STAND_Z facing
// the bow): CANOE_HALF_WIDTH amidships, narrowing to the ends, up to OAR_HULL_GUNWALE over the
// floor, OAR_HULL_MARGIN to spare — _oarClearHull
const OAR_HULL_GUNWALE = 0.58;  // m over the floor (canoe.glb's gunwale)
const OAR_HULL_MARGIN = 0.06;   // m
const MAX_MANA = 100;
const WAND_MANA_COST = 10;               // per blast; mana potions refill it
const WAND_SWIPE_START_SPEED = 405;      // deg/s: a swipe starts…
const WAND_SWIPE_END_SPEED = 120;        // …and ends when the wand slows down again
const WAND_SWIPE_MAX_S = 0.7;
const WAND_SWIPE_PEAK_SPEED = 405;       // deg/s the swipe has to reach at some point
const WAND_SWIPE_MIN_ANGLE = 80;         // deg the wand has to turn through during the swipe
const WAND_SWIPE_MIN_DIST = 0.4;         // m the wand tip has to travel for a spell
const WAND_CAST_COOLDOWN_S = 0.45;
const PLAYER_BLAST_SPEED_MPS = 16;
const PLAYER_BLAST_LENGTH = 1.4;         // m — the line's length
const ENEMY_BLAST_SPEED_MPS = 9;         // slower: the player has time to match the block
const ENEMY_BLAST_LENGTH = 1.3;
const MAGIC_BLAST_HEIGHT = 0.55;         // m above the caster's feet
const MAGIC_FIRE_DAMAGE = 2;             // health segments / hearts
const MAGIC_ICE_DAMAGE = 1;
const MAGIC_FREEZE_MIN_S = 3;            // frozen for 3–5 s…
const MAGIC_FREEZE_RAND_S = 2;
const FREEZE_SHAKE_SPEED = 220;          // deg/s of phone shaking that counts…
const FREEZE_SHAKE_RATE = 1.6;           // …and melts this many extra seconds per second
// Wand-casting enemies: a rising share of the swordsmen, from the stage after the first boss
// with a wand (FIRST_WAND_BOSS_STAGE, the wizard)
const PS_WAND_ENEMY_FROM_STAGE = FIRST_WAND_BOSS_STAGE + 1;
const WAND_ENEMY_RANGE = { min: 6, max: 11 };

const ROAD_LIGHT_GRID_SIZE = 3;
const ROAD_LIGHT_GRID_SPACING_METERS = 40;
const ROAD_LIGHT_SHIFT_DISTANCE_METERS = ROAD_LIGHT_GRID_SPACING_METERS * 1.25;
const ROAD_LIGHT_REPOSITION_INTERVAL_MS = 7000;
const ROAD_LIGHT_MODEL_URL = '/assets/props/road_light.glb';
// road_light.glb is 1 unit tall; the island mappack places it at ×1.307 and the map is ×1.4
// (MAPS.islandTown.scale) — the night lights match those (≈ 1.83 m)
const ROAD_LIGHT_SCALE = 1.307 * 1.4;
const ROAD_LIGHT_POINT_LIGHT_CONFIG = Object.freeze({
  color: 0xfff1c1,
  intensity: 2.6,
  distance: 40,
  decay: 0.5,
  yOffset: 0.95 // model units: just above the lamp head (its glass is at ≈ 0.77)
});
// The lamp's glass glows: texels this yellow-bright become an emissive map
const ROAD_LIGHT_GLOW = Object.freeze({ color: 0xfff4dc, intensity: 2.2, minR: 190, minG: 160, maxBlueRatio: 0.8 });

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
// Sun shadows: the light sits at this offset from the player and its shadow box (± this many
// metres) follows them, so characters' shadows show on the map wherever the stage goes
const SHADOW_LIGHT_OFFSET = new THREE.Vector3(15, 30, 15);
const SHADOW_HALF_SIZE = 18;
// Town's sun (setSunHour): it rises in the east (+X) at SUN_RISE_H, stands highest at midday
// a little to the south (+Z) and sets in the west at SUN_SET_H (Town's night hours); low, it is
// warm and dim (SUN_LOW_*), the ambient light and the sky dimmer too. Never below SUN_MIN_ELEV
// (radians) so shadows stay a sane length
const SUN_RISE_H = 5.5;
const SUN_SET_H = 21;
const SUN_SOUTH = 0.35;
const SUN_MIN_ELEV = 0.17;
const SUN_LOW_COLOR = new THREE.Color(0xff9a55);
const SUN_LOW_LIGHT = 0.3;    // sun intensity at the horizon (× the day's)
const SUN_LOW_AMBIENT = 0.45; // ambient at the horizon (× the day's)
const SUN_LOW_SKY = 0.4;      // sky brightness at the horizon
// The sea / lakes' brightness at night (× the day's): mostly dark, not black
const WATER_NIGHT_BRIGHTNESS = 0.22;
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
  const multiplayerButton = startOverlay.querySelector('[data-arcade-multiplayer]');
  const classicButton = startOverlay.querySelector('[data-arcade-classic]');
  const townButton = startOverlay.querySelector('[data-arcade-town]');
  const guestButton = startOverlay.querySelector('[data-arcade-guest]');

  let mode = 'login';
  // Until the tutorial is done the start screen only offers "Start Game" (which runs it);
  // afterwards it offers Tutorial, Showdown, Classic, Town and Multiplayer.
  let tutorialCompleted = false;
  let modeHandler = null; // picks a mode once the game is running
  let pendingGameMode = null; // mode picked before the game finished loading

  let currentName = '';
  let authInProgress = false;
  let authToken = 0;
  let resolveAuth = null;
  let startHandler = null;
  let authResolved = false;
  let activeLoadProfile = loadOrCreateWithPin;
  let isGuest = false;

  // Signing in (or switching user) once the game is loading needs a fresh page load; this
  // flag makes that load show the login form instead of starting as a guest again.
  const SHOW_LOGIN_KEY = 'sq:showLogin';
  const reloadToLoginForm = () => {
    try { sessionStorage.setItem(SHOW_LOGIN_KEY, '1'); } catch (_) {}
    window.location.reload();
  };
  const consumeShowLoginFlag = () => {
    try {
      const flag = sessionStorage.getItem(SHOW_LOGIN_KEY) === '1';
      sessionStorage.removeItem(SHOW_LOGIN_KEY);
      return flag;
    } catch (_) {
      return false;
    }
  };

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
    // "Start Game" (tutorial) for new players, else Tutorial / Showdown / Classic / Town / Multiplayer.
    // Auth resolves now, so the game (and the settings panel) loads behind the start
    // screen while the player picks; the click (below) goes to the mode handler.
    tutorialCompleted = hasCompletedTutorial(authResult?.profile);
    form?.classList.add('hidden');
    showModeButtons();
    welcomeSection?.classList.remove('hidden');
    if (resolveAuth) {
      const resolve = resolveAuth;
      resolveAuth = null;
      authResolved = true;
      if (authResult?.guest) switchButton.textContent = 'Sign In'; // reloads to the login form
      resolve(authResult);
    }
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
    if (currentName && !isGuest) {
      clearStoredPin(currentName);
      setCookie('playerName', '', -1);
      localStorage.removeItem('playerName');
    }
    // The game is already loading for this player: switching user / signing in needs a
    // fresh page load (which opens on the login form)
    if (authResolved) {
      reloadToLoginForm();
      return;
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

  // Play without signing in: a guest with a random name and no profile (nothing is saved).
  // All modes are offered right away (the tutorial can't be remembered as done).
  // The app opens as a guest unless a signed-in player is remembered; the welcome
  // section's "Sign In" button (switchButton) reloads to the login form.
  // `seaStart`: the app just opened (nobody remembered, no sign-in asked for) — the guest starts
  // out on the sea in a canoe (src/town/seaStart.js) instead of on the start screen, which
  // their ⬅ Lobby button brings up
  const startAsGuest = ({ seaStart = false } = {}) => {
    if (authResolved) return;
    authToken += 1; // drop any login in progress
    authInProgress = false;
    isGuest = true;
    currentName = randomGuestName();
    setMessage('');
    welcomeText.textContent = `Playing as guest ${currentName}`;
    const guestProfile = buildGuestProfile(currentName);
    if (seaStart) {
      hideOverlay();
      pendingGameMode = 'sea'; // started by setModeHandler once the game is ready
    }
    showModeSelect({ guest: true, nameKey: null, profile: guestProfile, seaStart });
  };

  guestButton?.addEventListener('click', event => {
    event.preventDefault();
    startAsGuest();
  });

  const chooseMode = (gameMode) => {
    if (startHandler) startHandler();
    hideOverlay();
    if (modeHandler) modeHandler(gameMode);
    else pendingGameMode = gameMode; // started by setModeHandler once the game is ready
  };

  startButton?.addEventListener('click', () => chooseMode('tutorial'));
  tutorialButton?.addEventListener('click', () => chooseMode('tutorial'));
  showdownButton?.addEventListener('click', () => chooseMode('showdown'));
  multiplayerButton?.addEventListener('click', () => chooseMode('multiplayer'));
  classicButton?.addEventListener('click', () => chooseMode('classic'));
  townButton?.addEventListener('click', () => chooseMode('town'));

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
      } else if (consumeShowLoginFlag()) {
        showLoginForm({ name: initialName }); // the player asked to sign in
      } else {
        startAsGuest({ seaStart: true });
      }
      return authPromise;
    },
    setStartHandler(handler) {
      startHandler = handler;
    },
    // Start a mode without the start screen's buttons (Settings → Dev → Free Roam; the sea
    // start's landing → Town)
    startMode: (gameMode) => chooseMode(gameMode),
    // The sea start's Sign In: a fresh page load on the login form
    signIn: () => reloadToLoginForm(),
    setModeHandler(handler) {
      modeHandler = handler;
      if (pendingGameMode) {
        const gameMode = pendingGameMode;
        pendingGameMode = null;
        // Delay briefly so the rest of init completes first (the sea start: just that — it's
        // meant to be up as soon as possible)
        setTimeout(() => handler(gameMode), gameMode === 'sea' ? 0 : 600);
      }
    },
    // Back to the start screen mid-session (e.g. after the tutorial)
    showStartScreen({ tutorialDone = tutorialCompleted } = {}) {
      tutorialCompleted = !!tutorialDone;
      setMessage('');
      form?.classList.add('hidden');
      // "Sign In" (guest) / "Switch user" stays available — it reloads to the login form
      switchButton?.classList.remove('hidden');
      welcomeSection?.classList.remove('hidden');
      showModeButtons();
      startOverlay.style.display = '';
      startOverlay.classList.remove('hidden');
      startOverlay.setAttribute('aria-hidden', 'false');
    },
    isStartScreenShown: () => startOverlay.getAttribute('aria-hidden') === 'false',
    hideOverlay
  };
}

// Swing detection is ignored this long after Block is pressed or released (the stance change
// moves the sword abruptly and would otherwise count as a swing + forward lunge).
const PSW_BLOCK_TOGGLE_IGNORE_S = 0.35;
const SWORD_SHOWDOWN_BGS = 'Interior Day/Inside Day.ogg';
const SWORD_SHOWDOWN_BGS_VOLUME_SCALE = 0.5;
// Sword gyro sensitivity: gyro angles are multiplied by window.phoneSwordLocalSensitivity
// ("Use This Device" — the game screen is also the sword, so it defaults higher: small wrist
// movements swing the sword and the screen stays in view) or window.phoneSwordPhoneSensitivity
// (a separate phone connected by QR code). Set from Settings → Sword Gyro, saved per device
// as sq:swordLocalSensitivity / sq:swordPhoneSensitivity.
const PHONE_SWORD_LOCAL_SENSITIVITY_DEFAULT = 2;
const PHONE_SWORD_PHONE_SENSITIVITY_DEFAULT = 1;
// Settings → Sword Gyro used to have hit detection sliders saved here; they're gone, so a
// leftover value is dropped and everyone gets the tuned defaults in phoneSwordSwingCfg
const SWORD_SWING_CFG_STORAGE_KEY = 'sq:swordSwingCfg';

async function initCore(runtimeContext) {
  document.body.addEventListener('touchstart', () => {}, { once: true });
  // Classic mode (Wii-style Showdown, see "Classic mode" further down); declared first
  // because inventory / controls code checks it
  let _classicMode = false;

  const _savedMusicVol = parseFloat(localStorage.getItem('sq:musicVolume') ?? '0.05');
  const _savedSfxVol = parseFloat(localStorage.getItem('sq:sfxVolume') ?? '1');
  const _savedVoiceVol = parseFloat(localStorage.getItem('sq:voiceVolume') ?? '0.5');
  const audioManager = createAudioManager({
    musicVolume: Number.isFinite(_savedMusicVol) ? _savedMusicVol : 0.05,
    sfxVolume: Number.isFinite(_savedSfxVol) ? _savedSfxVol : 1,
    voiceVolume: Number.isFinite(_savedVoiceVol) ? _savedVoiceVol : 0.5
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
  // Guest (Play Without Signing In): profileNameKey is null, so nothing is saved
  const isGuest = !!profileResult.guest;
  let { nameKey: profileNameKey, profile: playerProfile } = profileResult;
  // A guest starting out on the sea (src/town/seaStart.js)
  const _seaStartWanted = !!profileResult.seaStart;

  if (!isGuest) {
    setCookie("playerName", playerName);
    localStorage.setItem('playerName', playerName);
  }

  let updatePlayerInfoUI = () => {};

  const PICKUP_RADIUS = 1.2;
  const PICKUP_ATTRACT_RADIUS = 8;
  const PICKUP_ATTRACT_SPEED = 7.5;

  let multiplayer = null;
  let isHost = false;
  let duelMode = null; // Multiplayer mode: lobby + duels (created further down)
  let matchMode = null; // Multiplayer mode: Team Battle / Free For All (created further down)
  let devRoam = null; // Dev: Free Roam (Settings → Dev; created further down)
  let town = null; // Town mode (src/town/townMode.js; created further down)
  let seaStart = null; // The guest's sea start (src/town/seaStart.js; created with the town)
  let townNet = null; // Town's shared room (src/town/townNet.js; created with the town)
  // Multiplayer battle (Team Battle / Free For All): everyone starts with the sword and finds
  // the rest on the arena's pickups; the real inventory / stats are set aside meanwhile and
  // put back afterwards (matchCtx.startMatchLoadout / endMatchLoadout) — null outside one
  let _matchLoadout = null;
  // Town mode: the town's own gear, bought at its market, in place of the real inventory
  // (startTownLoadout / endTownLoadout, further down) — { hasSword, hasRod, hasBroom } while in Town, else null
  let _townLoadout = null;
  // Town's flying broom being ridden (src/items/broom.js; created with the town)
  let _broomRide = null;
  // Asks for a gyro recalibration when a gyro item comes out (set further down, once the
  // calibration popup is in — _equipByPlayer / the broom)
  let _gyroItemCalibPrompt = null;
  // Multiplayer duels (and the lobby) are sword only; battles use the pickups
  const _mpSwordOnly = () => !!duelMode?.isActive() && !_matchLoadout;
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
  // Orientation math is done with quaternions (not per-axis Euler deltas, which flip near
  // beta = ±90°). Device orientation per the W3C spec = Rz(alpha)·Rx(beta)·Ry(gamma) in the
  // earth frame (x east, y north, z up). _phoneSwordEarthToGameQ maps earth → the player's
  // local game frame (Y up, +Z forward, -X right) with "forward" = where the phone's back/top
  // pointed at calibration, so the sword turns exactly as the phone turns in the world.
  const _pswDeviceQ = new THREE.Quaternion();
  const _pswCalibQ = new THREE.Quaternion();
  const _pswEarthToGameQ = new THREE.Quaternion();
  const _pswYawQ = new THREE.Quaternion();
  const _pswNeutralQ = new THREE.Quaternion();
  const _pswTmpEuler = new THREE.Euler();
  const _pswTmpV = new THREE.Vector3();
  const _pswTmpV2 = new THREE.Vector3();
  const _pswTmpM = new THREE.Matrix4();
  const _PSW_UP = new THREE.Vector3(0, 1, 0);
  const _pswDeviceQuat = (alpha, beta, gamma, out) => {
    const DEG = Math.PI / 180;
    return out.setFromEuler(_pswTmpEuler.set(beta * DEG, gamma * DEG, alpha * DEG, 'ZXY'));
  };
  // Earth → game frame, with the forward heading taken from the calibration pose: the sum of
  // the horizontal parts of the phone's back (-z, upright hold) and top (+y, flat hold).
  const _pswEarthToGame = (calibQ, out) => {
    const back = _pswTmpV.set(0, 0, -1).applyQuaternion(calibQ);
    const top = _pswTmpV2.set(0, 1, 0).applyQuaternion(calibQ);
    let fx = back.x + top.x, fy = back.y + top.y;
    const len = Math.hypot(fx, fy);
    if (len < 1e-4) { fx = 0; fy = 1; } else { fx /= len; fy /= len; }
    // Rows = game X/Y/Z axes in earth coords: game +X = -right = (-fy, fx, 0),
    // game +Y = earth up, game +Z = forward (fx, fy, 0).
    _pswTmpM.set(
      -fy, fx, 0, 0,
        0,  0, 1, 0,
       fx, fy, 0, 0,
        0,  0, 0, 1
    );
    return out.setFromRotationMatrix(_pswTmpM);
  };
  // Yaw auto-recentre (see the phone-sword gyro loop): only yaw drifts — beta/gamma are
  // gravity-referenced on the phone — so during calm, non-fighting moments the sword's yaw
  // is pulled slowly back to "forward", faster the longer since the last manual calibration.
  const PSW_YAW_RECENTER_MAX_SPEED = 60;     // deg/s — stiller than this counts as "not swinging"
  const PSW_YAW_RECENTER_STILL_S = 0.5;      // must be still this long before correcting
  const PSW_YAW_RECENTER_MAX_TILT_DEG = 45;  // only while the blade is roughly upright (neutral hold)
  const PSW_YAW_RECENTER_DEADBAND_DEG = 3;   // ignore tiny offsets (intentional hold differences)
  const PSW_YAW_RECENTER_TAU_S = 4;          // pull time constant right after a manual calibration…
  const PSW_YAW_RECENTER_TAU_MIN_S = 1.5;    // …shrinking to this…
  const PSW_YAW_RECENTER_TRUST_RAMP_S = 120; // …over this long since the last manual calibration
  const PSW_YAW_RECENTER_ENEMY_DIST = 6;     // no live enemy closer than this
  // Sword smoothing: filter cutoff = MIN + GAIN × angular speed (deg/s)
  const PSW_SMOOTH_MIN_CUTOFF_HZ = 4;        // ~40 ms lag while nearly still
  const PSW_SMOOTH_SPEED_GAIN = 0.1;         // Hz per deg/s — ~34 Hz (near passthrough) at 300°/s
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

  // Puts `weapon`'s hold pose (offset + rotation on the hand) from phoneSwordWeaponCfg
  // (`kind` 'shield' | 'gun'); the constructor's pose is only a fallback
  const _WEAPON_HOLD_FALLBACK = {
    shield: { PosX: -0.18, PosY: 0.2, PosZ: 0.2, RotX: 90, RotY: 0, RotZ: 0 },
    gun: { PosX: 0, PosY: 0, PosZ: 0, RotX: 0, RotY: 180, RotZ: 0 },
  };
  const _weaponHoldEuler = new THREE.Euler(0, 0, 0, 'YXZ');
  function _applyWeaponHoldCfg(weapon, kind) {
    const cfg = window.phoneSwordWeaponCfg;
    if (!weapon || !cfg) return;
    const fb = _WEAPON_HOLD_FALLBACK[kind];
    const v = (key) => cfg[kind + key] ?? fb[key];
    const DEG = Math.PI / 180;
    weapon._holdOffset.set(v('PosX'), v('PosY'), v('PosZ'));
    weapon._holdQuaternion.setFromEuler(_weaponHoldEuler.set(v('RotX') * DEG, v('RotY') * DEG, v('RotZ') * DEG, 'YXZ'));
  }

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
  try { localStorage.removeItem(SWORD_SWING_CFG_STORAGE_KEY); } catch (_) { /* ignore */ }

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
  // Game traffic only goes to the current duel opponent or the other battle players
  // (the lobby needs none)
  const _netRecipients = () => {
    if (townNet?.isOn()) return townNet.peerIds();
    if (matchMode?.isInMatch()) return matchMode.getPeerIds();
    const opponentId = duelMode?.getOpponentId();
    return opponentId ? [opponentId] : [];
  };
  const sendNetworkPayload = (payload) => {
    const recipients = _netRecipients();
    if (!multiplayer || !payload || !recipients.length) return false;
    recipients.forEach(id => multiplayer.sendTo(id, payload));
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
  // Outside Showdown stages (which pick their own time of day) it's always day — no clock-based night
  const getAutoMode = () => 'day';
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

  // No day/night picker any more (Showdown's stage screen picks each stage's time of day,
  // Classic and Multiplayer are always day): a mode saved by older versions is ignored
  displaySettings.mode = 'auto';
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
    _applySun();
    for (const material of pickupEmissiveMaterials) {
      if (!material || typeof material.emissiveIntensity !== 'number') continue;
      const base = material.userData?.baseEmissiveIntensity ?? material.emissiveIntensity;
      material.emissiveIntensity = base * pickupBrightness;
      material.needsUpdate = true;
    }
  };

  // Town's sun: where it is in the sky (the light's offset from the player — the shadow-follow
  // block before the render uses it) and how bright / warm it is, from the town clock's hour.
  // null = no sun cycle (every other mode): the fixed offset, white light, full sky
  let _sunHour = null;
  let _sunNightLevel = 0; // Town's twilight: 0 day … 1 night (TWILIGHT_H in townConfig.js)
  // The active map's water materials (sea / lakes — MapLoader's createWaterMaterial, uBrightness)
  let _waterMatsOf = null;
  let _waterMats = [];
  const _mapWaterMaterials = () => {
    if (_waterMatsOf === _activeMap) return _waterMats;
    _waterMatsOf = _activeMap;
    _waterMats = [];
    _activeMap?.group.traverse((o) => {
      if ((o.name === 'sea' || o.name === 'water') && o.material?.uniforms?.uBrightness) _waterMats.push(o.material);
    });
    return _waterMats;
  };
  const _sunOffset = SHADOW_LIGHT_OFFSET.clone();
  const _sunWhite = new THREE.Color(0xffffff);
  const _applySun = () => {
    // (the water: dimmed with the night, whatever else applies)
    const waterK = _sunHour == null ? 1 : 1 - (1 - WATER_NIGHT_BRIGHTNESS) * _sunNightLevel;
    for (const m of _mapWaterMaterials()) m.uniforms.uBrightness.value = waterK;
    const off = displaySettings.highContrastMode || _sunHour == null
      || (lastAutoMode || getAutoMode()) === 'night';
    if (off) {
      if (_sunHour == null) _sunOffset.copy(SHADOW_LIGHT_OFFSET);
      dirLight?.color.copy(_sunWhite);
      if (scene) scene.backgroundIntensity = 1;
      return;
    }
    const u = clampValue((_sunHour - SUN_RISE_H) / (SUN_SET_H - SUN_RISE_H), 0, 1);
    const a = Math.PI * u;
    const up = Math.sin(a); // 0 at the horizon, 1 at midday
    const elev = Math.max(SUN_MIN_ELEV, up * (Math.PI / 2 - 0.25));
    const flat = Math.cos(elev);
    _sunOffset.set(Math.cos(a) * flat, Math.sin(elev), SUN_SOUTH * flat)
      .normalize().multiplyScalar(SHADOW_LIGHT_OFFSET.length());
    // (high enough up — a quarter of the way to midday — it's the full day)
    const k = clampValue(up / 0.5, 0, 1);
    const ease = k * k * (3 - 2 * k);
    const tw = 1 - _sunNightLevel; // 0 at the horizon (= night: lights off, black sky) … 1 out of twilight
    if (dirLight) {
      dirLight.intensity = clampValue(displaySettings.directionalIntensity, 0, 2) * tw * (SUN_LOW_LIGHT + (1 - SUN_LOW_LIGHT) * ease);
      dirLight.color.copy(SUN_LOW_COLOR).lerp(_sunWhite, ease);
    }
    if (ambientLight) {
      ambientLight.intensity = clampValue(displaySettings.ambientIntensity, 0, 2) * tw * (SUN_LOW_AMBIENT + (1 - SUN_LOW_AMBIENT) * ease);
    }
    if (scene) scene.backgroundIntensity = tw * (SUN_LOW_SKY + (1 - SUN_LOW_SKY) * ease);
  };
  const setSunHour = (h, nightLevel = 0) => {
    _sunHour = Number.isFinite(h) ? h : null;
    _sunNightLevel = _sunHour == null ? 0 : clampValue(Number(nightLevel) || 0, 0, 1);
    _applySun();
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
      const mapSize = lowEnd ? 512 : 1024;
      if (dirLight.shadow.mapSize.x !== mapSize) {
        dirLight.shadow.mapSize.set(mapSize, mapSize);
        dirLight.shadow.map?.dispose();
        dirLight.shadow.map = null; // re-created at the new size
      }
    }
    // The low tier has no shadow maps: characters get a cheap blob shadow instead
    setBlobShadowsEnabled(isLowEndTier(nextTier));
    if (scene) {
      scene.traverse((child) => {
        if (!child?.isMesh) return;
        if (child.userData?.shadowProfileManaged && child.userData?.shadowImportance === 'optional') {
          child.castShadow = optionalShadowsEnabled;
        }
      });
    }
  }

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

  // Model for another player (or, in a battle, a bot the host simulates) — characterUrl
  // picks the GLB (default pumpkin)
  const _spawnRemotePlayer = (remoteId, name, characterUrl = null) => {
    const other = new PlayerCharacter(name, characterUrl ? { characterUrl } : undefined);
    scene.add(other.model);
    document.body.appendChild(other.nameLabel);
    otherPlayers[remoteId] = {
      model: other.model,
      nameLabel: other.nameLabel,
      name,
      health: BASE_HEALTH_SEGMENTS,
      targetPos: new THREE.Vector3(),
      targetQuat: new THREE.Quaternion(),
      targetRotY: 0
    };
    logNet('spawn', remoteId, name);
    return otherPlayers[remoteId];
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
      if (!multiplayer || remoteId === multiplayer.getId()) {
        return;
      }
      // Only the duel opponent / battle players are shown (lobby peers stay off the map)
      if (!duelMode?.acceptsPresenceFrom(remoteId) && !matchMode?.acceptsPresenceFrom(remoteId)
        && !townNet?.acceptsPresenceFrom(remoteId)) {
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
        _spawnRemotePlayer(remoteId, data.name, matchMode?.getCharacterUrl(remoteId) ?? townNet?.getCharacterUrl(remoteId));
      }

      const player = otherPlayers[remoteId];
      player.name = data.name;
      syncPresenceRemoteEquipment(remoteId, data);
      if (player.nameLabel) {
        // (Town: a wanted player's stars after the name)
        player.nameLabel.innerText = data.name + (townNet?.nameSuffix(remoteId) ?? '');
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

    if (data.type === 'duel') {
      duelMode?.handleMessage(peerId, data);
      return;
    }

    if (data.type === 'town') {
      townNet?.handleMessage(peerId, data);
      return;
    }

    if (data.type === 'match') {
      matchMode?.handleMessage(peerId, data);
      return;
    }

    if (data.type === 'projectile') {
      // Battle: another fighter's bullet (their game deals its damage)
      const fromMatch = !!matchMode?.isInMatch() && matchMode.acceptsPresenceFrom(peerId);
      const fromTown = !!townNet?.acceptsPresenceFrom(peerId);
      if (!duelMode?.acceptsPresenceFrom(peerId) && !fromMatch && !fromTown) return;
      if (!isProjectileMessage(data)) {
        logInvalidPayload('projectile', data);
        return;
      }
      const position = new THREE.Vector3(...data.position);
      const direction = new THREE.Vector3(...data.direction);
      if (fromTown) {
        // (Town: drawn here only — the shooter's game deals the damage)
        spawnPistolBullet(position, direction, peerId);
        const shot = projectiles[projectiles.length - 1];
        if (shot) shot.userData.remoteShot = true;
      } else if (fromMatch) spawnPistolBullet(position, direction, peerId);
      else spawnProjectileWithPerfFlags(scene, projectiles, position, direction, data.id);
    }
  }

  function handleIncomingData(peerId, data) {
    pendingIncomingPeerData.push([peerId, data]);
    if (pendingIncomingPeerData.length > INCOMING_QUEUE_MAX_BACKLOG) {
      pendingIncomingPeerData.shift();
    }
  }

  // Peer multiplayer only runs in Multiplayer mode (lobby + duels) and a shared Town (its room,
  // `town-<roomId>` — townNet.js); Showdown and the tutorial are single player.
  // startMultiplayer/stopMultiplayer are driven by duelMode and townNet.
  const startMultiplayer = (roomId = LOBBY_ROOM_ID) => {
    if (multiplayer) {
      if (multiplayer.getRoomId() !== roomId) void multiplayer.joinRoom(roomId);
      return multiplayer;
    }
    multiplayer = new Multiplayer(playerName, handleIncomingData, { roomId });
    window.multiplayer = multiplayer;
    if (playerControls) playerControls.multiplayer = multiplayer;
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
      if (previousHostId !== newHostId) {
        clearAllRemoteHeldWeaponMeshes();
        if (shield) shield.remoteHolderId = null;
      }
    };
    multiplayer.onReady = () => {
      isHost = !!multiplayer?.isHost;
      duelMode?.onPeersChange();
      matchMode?.onPeersChange();
    };
    multiplayer.onPeersChange = () => {
      duelMode?.onPeersChange();
      matchMode?.onPeersChange();
    };
    return multiplayer;
  };
  const stopMultiplayer = () => {
    if (!multiplayer) return;
    multiplayer.destroy();
    multiplayer = null;
    window.multiplayer = null;
    isHost = false;
    if (playerControls) playerControls.multiplayer = null;
    Object.keys(otherPlayers).forEach(id => removeRemotePlayer(id, 'multiplayer-stopped'));
    pendingIncomingPeerData.length = 0;
    netSendQueue.length = 0;
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

  // ── Maps ──────────────────────────────────────────────────────────────────
  // Classic plays on the original GLB map; every other mode (Showdown, tutorial, Multiplayer)
  // on the island town mappack (src/map/MapLoader.ts). The mode handler switches with
  // _setActiveMap before a mode starts; a map is loaded the first time it's needed.
  //   kind 'glb':     a plain GLB scene, scaled by `scale`
  //   scale (mappacks too): uniform world scale of the whole map; coordinates written for a map
  //                   (spawn, DUEL_LOCATION / ARENA_LOCATION, STAGE_ROUTES) are in scaled world units
  //   kind 'mappack': an editor .mappack (zip); map objects whose model file matches
  //                   `noGround` (trees) aren't stood on — characters walk through them,
  //                   bullets still stop at them. A pack with a sea level gets an ocean
  //                   (MapLoader's 'sea' / 'seabed' meshes — not ground) and the ground floor
  //                   SEA_WADE_DEPTH under it (setTerrainFloor): characters wade, never sink.
  //   spawn: where (re)spawns are picked (src/map/spawnUtils.js)
  //   floating (mappacks with a sea): GLB props afloat on the sea, bobbing gently — in the pack's
  //                   own units (before `scale`): at [x, z], yaw (rad), size; they stop bullets.
  //                   List them in noGround (the map's top-down height raycast would make their
  //                   masts the ground); `deckMaxY` (model units above its origin, the waterline)
  //                   makes one ground of its own instead (_floatingGroundHeight): the highest
  //                   upward-facing surface no higher than that — the deck, climbable from the
  //                   water like any wall, masts / yards / sails above it ignored; `deck`
  //                   (model units, the bow toward −X) = where a voyage keeps everyone aboard
  //                   — one with a deck can sail (open roam's ⛵ Explore the Seas, _voyage*)
  const MAPS = {
    islandTown: {
      kind: 'mappack', url: '/mappacks/island_town.mappack', noGround: /tree|pirate_ship/i, scale: 1.4,
      spawn: { x: 14, z: -5.6, radius: 3 },   // the flat ground in the middle of the island
      // The pirate ship: anchored off the north-east shore, in water deep enough for its hull
      // (world ≈ (69, −108) — in sight of stage 7's road)
      // (deck ≈ 0.5, quarterdeck / forecastle ≈ 1.2, yards from ≈ 1.9 model units up)
      floating: [{
        url: '/assets/props/pirate_ship.glb', at: [49, -77], yaw: 1.8, size: 1.3, deckMaxY: 1.5,
        deck: { minX: -0.9, maxX: 4.4, halfWidth: 1.3 },
      }],
      // The guest's sea start (src/town/seaStart.js) runs before this map is in, so what it needs
      // of it is written down here, measured from the pack (re-measure if the pack changes):
      // the sea level (world Y), Town's fishing spot (`places.fishSpot`, townLayout.js) and the
      // way its bank faces out to the water, and the art-style reference (artStyle.js —
      // setStyleReference's numbers) so the player needn't wait on the map to be stylized
      seaStart: {
        seaLevel: -3.5,
        fishSpot: { x: -66.1, z: -96.9 },
        face: { x: -Math.SQRT1_2, z: -Math.SQRT1_2 },
        styleReference: { lum: 0.322, lumStd: 0.151, sat: 0.234 },
      },
    },
    classic: { kind: 'glb', url: '/glb_map/map.glb', scale: 5, spawn: { x: 0, z: 0, radius: 12 } },
  };
  const DEFAULT_MAP = 'islandTown';
  const SEA_WADE_DEPTH = 0.6;   // m under the sea surface characters wade at
  const MAP_NOT_GROUND = new Set(['sea', 'seabed', 'water']);   // MapLoader water meshes
  const mapForMode = (gameMode) => (gameMode === 'classic' ? 'classic' : DEFAULT_MAP);
  // The sea start doesn't wait on the map: the player is stylized with its measured look
  if (_seaStartWanted) presetStyleReference(MAPS[DEFAULT_MAP].seaStart.styleReference);

  // Build a BVH-accelerated mesh list for downward raycasting to get terrain height.
  const { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } = await import('three-mesh-bvh');
  THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
  THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
  THREE.Mesh.prototype.raycast = acceleratedRaycast;

  // The first map loaded is the art-style reference: characters are matched to its colours
  // (artStyle.js — they are stylized once, so later maps don't change them)
  let _mapStyleReferenceSet = false;
  const _loadedMaps = new Map();   // key → Promise<{ group, meshes, groundMeshes, floor, water, floatingGround }>
  const _loadMap = (key) => {
    if (_loadedMaps.has(key)) return _loadedMaps.get(key);
    const def = MAPS[key];
    const promise = (async () => {
      let group;
      let styleRoot;   // what the art-style pass reads / grades (not the KTX2 terrain / grass)
      let water = null;   // (x, z) → water surface Y or null (mappacks with water / a sea)
      let paths = null;   // (x, z) → 'road' | 'trail' | null (mappacks with painted paths)
      let floor = 0;      // lowest ground height (setTerrainFloor)
      const floating = []; // def.floating props: { holder, bob: Group, model, phase, deckMaxY, deck, anchor }
      if (def.kind === 'mappack') {
        const { MapLoader, sampleMapWaterLevel, sampleMapPath } = await import('../map/MapLoader.ts');
        group = await new MapLoader().load(def.url, { renderer, transcoderPath: '/basis/' });
        styleRoot = group.getObjectByName('objects');
        // Water data is in the pack's own units: sample unscaled, scale the level back up
        const s = def.scale ?? 1;
        const info = group.userData.water;
        if (info) {
          water = (x, z) => {
            const level = sampleMapWaterLevel(info, x / s, z / s);
            return level == null ? null : level * s;
          };
        }
        const pathInfo = group.userData.paths;
        if (pathInfo) paths = (x, z) => sampleMapPath(pathInfo, x / s, z / s);
        if (Number.isFinite(info?.seaLevel)) {
          floor = info.seaLevel * s - SEA_WADE_DEPTH;
          for (const prop of def.floating ?? []) {
            try {
              floating.push(await _loadFloatingProp(prop, info.seaLevel, group));
            } catch (err) {
              console.warn('[map] floating prop failed to load:', prop.url, err);
            }
          }
        }
      } else {
        const gltf = await new Promise((resolve, reject) =>
          new GLTFLoader().load(def.url, resolve, undefined, reject)
        );
        group = gltf.scene;
        styleRoot = group;
      }
      group.scale.setScalar(def.scale ?? 1);
      group.name = 'map';
      if (styleRoot) {
        if (!_mapStyleReferenceSet) { setStyleReference(styleRoot); _mapStyleReferenceSet = true; }
        stylizeObject(styleRoot);
      }
      floating.forEach(({ bob }) => stylizeObject(bob));
      // The map shows the characters' shadows but casts none itself: its big mesh in the shadow
      // pass would be the expensive part (see SHADOW_* / the light follow in the game loop)
      group.traverse(obj => {
        if (obj.isMesh) { obj.receiveShadow = true; obj.castShadow = false; }
      });
      // The height raycasts below use the meshes' matrixWorld, which three.js only refreshes on
      // render. Without this, spawn heights sampled before the first frame hit the unscaled map
      // (too low) and stay cached for that cell — the player spawned underground until they moved.
      group.updateMatrixWorld(true);
      // Solid meshes (bullets / bombs stop at them) and the ones characters stand on.
      // Instanced grass / scatter is neither; water stops bullets but isn't stood on.
      const meshes = [];
      const groundMeshes = [];
      group.traverse(obj => {
        if (!obj.isMesh || obj.isInstancedMesh) return;
        // Placed copies of one model share its geometry: build that BVH once, not per copy
        if (!obj.geometry.boundsTree) obj.geometry.computeBoundsTree();
        meshes.push(obj);
        if (MAP_NOT_GROUND.has(obj.name)) return;
        let o = obj;
        while (o && !o.userData.mapObject) o = o.parent;
        const file = o?.userData.mapObject?.modelFile ?? '';
        if (!(def.noGround && def.noGround.test(file))) groundMeshes.push(obj);
      });
      // Floating props with a deck to stand on (_floatingGroundHeight): their meshes and where
      // they are (world box, a little bigger: the swell moves them)
      const floatingGround = floating.filter((f) => Number.isFinite(f.deckMaxY)).map((f) => {
        const propMeshes = [];
        f.model.traverse((o) => { if (o.isMesh && !o.isInstancedMesh) propMeshes.push(o); });
        return { ...f, meshes: propMeshes, box: new THREE.Box3().setFromObject(f.model).expandByScalar(0.5) };
      });
      // Floating props bob on the swell (called every frame for the active map)
      const animate = floating.length ? (t) => {
        for (const { bob, phase } of floating) {
          bob.position.y = Math.sin(t * FLOAT_BOB_SPEED + phase) * FLOAT_BOB_HEIGHT;
          bob.rotation.x = Math.sin(t * FLOAT_ROLL_SPEED + phase) * FLOAT_ROLL;
          bob.rotation.z = Math.sin(t * FLOAT_ROLL_SPEED * 0.7 + phase + 1) * FLOAT_ROLL * 0.5;
        }
      } : null;
      // (the one that sails: a voyage moves its holder — _voyage*)
      const ship = floatingGround.find((f) => f.deck) ?? null;
      return { group, meshes, groundMeshes, floor, water, paths, animate, floatingGround, ship };
    })();
    _loadedMaps.set(key, promise);
    promise.catch(() => _loadedMaps.delete(key)); // let a later switch retry
    return promise;
  };

  // A def.floating prop, its origin on the sea surface (pack units, inside the map group):
  // holder (place, yaw, size) > bob (the swell — animate) > model
  const FLOAT_BOB_HEIGHT = 0.06;   // pack units
  const FLOAT_BOB_SPEED = 0.9;     // rad/s
  const FLOAT_ROLL = 0.025;        // rad
  const FLOAT_ROLL_SPEED = 0.6;    // rad/s
  async function _loadFloatingProp(prop, seaLevel, mapGroup) {
    const gltf = await new GLTFLoader().loadAsync(prop.url);
    const holder = new THREE.Group();
    holder.position.set(prop.at[0], seaLevel, prop.at[1]);
    holder.rotation.y = prop.yaw ?? 0;
    holder.scale.setScalar(prop.size ?? 1);
    holder.userData.mapObject = { modelFile: prop.url }; // (for the map's noGround)
    const bob = new THREE.Group();
    bob.add(gltf.scene);
    holder.add(bob);
    mapGroup.add(holder);
    return {
      holder, bob, model: gltf.scene, phase: prop.at[0] * 0.37, deckMaxY: prop.deckMaxY, deck: prop.deck ?? null,
      anchor: { position: holder.position.clone(), yaw: holder.rotation.y },
    };
  }

  let _activeMapKey = null;
  let _activeMap = null;
  let _groundMeshes = [];
  const _glbRaycaster = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, -1, 0));

  // Cache terrain height per entity to avoid re-raycasting every frame.
  // Key: "x_z" snapped to 0.5-unit grid; value: every upward-facing surface's Y there, highest
  // first (a bridge deck and the ground under it — getTerrainLayersAt), [] = none. Cleared
  // when the map changes.
  const _glbHeightCache = new Map();
  const _CACHE_SNAP = 0.5;
  const _glbNormal = new THREE.Vector3();
  const _NO_LAYERS = [];
  const _glbLayers = (x, z) => {
    const sx = Math.round(x / _CACHE_SNAP) * _CACHE_SNAP;
    const sz = Math.round(z / _CACHE_SNAP) * _CACHE_SNAP;
    const key = `${sx}_${sz}`;
    let ys = _glbHeightCache.get(key);
    if (ys) return ys;
    _glbRaycaster.ray.origin.set(sx, 500, sz);
    ys = _NO_LAYERS;
    for (const hit of _glbRaycaster.intersectObjects(_groundMeshes, false)) {
      // (a double-sided ceiling's underside isn't ground; the top surface always counts)
      if (ys.length && hit.face) {
        _glbNormal.copy(hit.face.normal).transformDirection(hit.object.matrixWorld);
        if (_glbNormal.y <= 0) continue;
      }
      // (one surface hit twice — touching meshes, a thin deck's two faces — counts once)
      if (ys.length && ys[ys.length - 1] - hit.point.y < 0.05) continue;
      if (ys === _NO_LAYERS) ys = [];
      ys.push(hit.point.y);
    }
    _glbHeightCache.set(key, ys);
    return ys;
  };
  const _glbResolveHeight = (x, z) => _glbLayers(x, z)[0];
  registerTerrainHeightResolver(_glbResolveHeight, { layers: _glbLayers });

  // A wall of the active map's ground meshes on the level line between two spots
  // (isMapWallBetween — the player walking under a bridge / an overhang vs into a wall)
  const _wallRaycaster = new THREE.Raycaster();
  _wallRaycaster.firstHitOnly = true;
  const _wallFrom = new THREE.Vector3();
  const _wallDir = new THREE.Vector3();
  registerWallProbe((x0, y, z0, x1, z1) => {
    _wallDir.set(x1 - x0, 0, z1 - z0);
    const length = _wallDir.length();
    if (length < 1e-4 || !_groundMeshes.length) return false;
    _wallRaycaster.set(_wallFrom.set(x0, y, z0), _wallDir.divideScalar(length));
    _wallRaycaster.far = length;
    return _wallRaycaster.intersectObjects(_groundMeshes, false).length > 0;
  });

  // Ground on the active map's floating props with a deck (MAPS `deckMaxY`): straight down
  // onto the highest upward-facing surface at most deckMaxY up the model. Not cached — the
  // prop bobs on the swell, and whoever stands on it bobs too.
  const _floatRaycaster = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, -1, 0));
  const _floatHitLocal = new THREE.Vector3();
  const _floatNormal = new THREE.Vector3();
  const _floatingGroundHeight = (x, z) => {
    const props = _activeMap?.floatingGround;
    if (!props?.length) return undefined;
    let best;
    for (const prop of props) {
      const { box } = prop;
      if (x < box.min.x || x > box.max.x || z < box.min.z || z > box.max.z) continue;
      _floatRaycaster.ray.origin.set(x, box.max.y + 1, z);
      for (const hit of _floatRaycaster.intersectObjects(prop.meshes, false)) {
        if (prop.model.worldToLocal(_floatHitLocal.copy(hit.point)).y > prop.deckMaxY) continue;
        if (!hit.face) continue;
        _floatNormal.copy(hit.face.normal).transformDirection(hit.object.matrixWorld);
        if (Math.abs(_floatNormal.y) < 0.6) continue; // (a wall / the side of a mast)
        if (best === undefined || hit.point.y > best) best = hit.point.y;
        break;
      }
    }
    return best;
  };
  registerTerrainHeightResolver(_floatingGroundHeight);

  // True where the active map's water (a lake or the sea) covers the ground — not on a bridge
  const _isOverWater = (x, z) => {
    const level = _activeMap?.water?.(x, z);
    if (level == null) return false;
    const ground = _glbResolveHeight(x, z);
    return !(Number.isFinite(ground) && ground >= level);
  };

  // Show `key` (loading it if needed) and make it the ground / bullet-stopping map.
  // Returns true when the map changed. A newer call wins over one still loading.
  let _mapSwitchToken = 0;
  const _setActiveMap = async (key) => {
    const token = ++_mapSwitchToken;
    if (key === _activeMapKey) return false;
    let hideLoading = null;
    if (_activeMapKey) hideLoading = showFeatureLoading('Loading map');
    let loaded;
    try {
      loaded = await _loadMap(key);
    } finally {
      hideLoading?.();
    }
    if (token !== _mapSwitchToken) return false;
    if (_activeMap) scene.remove(_activeMap.group);
    _activeMap = loaded;
    _activeMapKey = key;
    scene.add(loaded.group);
    _groundMeshes = loaded.groundMeshes;
    _glbHeightCache.clear();
    setTerrainFloor(loaded.floor);
    _syncPhysicsGround();
    setSpawnCenter(MAPS[key].spawn);
    registerMapMeshes(loaded.meshes); // bullets stop at buildings / walls (src/items/projectiles.js)
    return true;
  };
  // Flat Rapier ground (created after the first map load, below); moved to the map's floor
  let _physicsGroundRb = null;
  // (before any map: _preMapFloor — the sea start sets it to the map's own, the sea's shallows)
  let _preMapFloor = 0;
  function _syncPhysicsGround() {
    _physicsGroundRb?.setTranslation({ x: 0, y: (_activeMap?.floor ?? _preMapFloor) - 1, z: 0 }, true);
  }
  // The default map loads alongside the rest of the boot (weapons, physics, the settings panel)
  // and is awaited once the ⚙️ button is up (see `settings-ready`), so the settings button
  // doesn't wait on the mappack. Until then the spawn centre is set and the ground is the floor.
  setSpawnCenter(MAPS[DEFAULT_MAP].spawn);
  const _defaultMapReady = _setActiveMap(DEFAULT_MAP);

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
  dirLight.position.copy(SHADOW_LIGHT_OFFSET);
  dirLight.castShadow = true;
  {
    // A tight box around the player (the light follows them each frame) keeps the 1024 map sharp
    const cam = dirLight.shadow.camera;
    cam.left = -SHADOW_HALF_SIZE; cam.right = SHADOW_HALF_SIZE;
    cam.top = SHADOW_HALF_SIZE; cam.bottom = -SHADOW_HALF_SIZE;
    cam.near = 1; cam.far = SHADOW_LIGHT_OFFSET.length() + 40;
    cam.updateProjectionMatrix();
    dirLight.shadow.bias = -0.0005;
    dirLight.shadow.normalBias = 0.03;
  }
  scene.add(dirLight);
  scene.add(dirLight.target);
  applyRendererPerformanceSettings();
  applyDisplaySettings();

  // --- RAPIER INIT ---
  await RAPIER.init({});
  rapierWorld = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  runtimeContext.systems.rapierWorld = rapierWorld;
  window.rapierWorld = rapierWorld;
  runtimeContext.systems.rbToMesh = rbToMesh;
  window.rbToMesh = rbToMesh;

  // Ground collider — its top sits at the active map's floor (_syncPhysicsGround), so enemies
  // (dynamic bodies) can walk down into the sea's shallows instead of resting on y = 0
  _physicsGroundRb = rapierWorld.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  rapierWorld.createCollider(
    RAPIER.ColliderDesc.cuboid(200, 1, 200),
    _physicsGroundRb
  );
  _syncPhysicsGround();

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
    mana: playerProfile.stats.mana,
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
    levelPopup.textContent = `You've reached level ${level}! +1 Max Health`;
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
  const MATCH_SHIELD_HEALTH = 6;  // Multiplayer battles: a picked-up shield, upgrades ignored
  const getShieldMaxHealth = () => (_matchLoadout || _townLoadout ? MATCH_SHIELD_HEALTH : DEFAULT_SHIELD_HEALTH
    + Math.max(0, Math.floor(statsState.shieldUpgrades || 0)) * SHIELD_UPGRADE_HEALTH);
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
    },
    [MAGIC_WAND_ITEM_ID]: {
      name: 'Magic Wand',
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

  const equippableItems = new Set([SHIELD_ITEM_ID, FOAM_SWORD_ITEM_ID, 'pistol', MAGIC_WAND_ITEM_ID]);
  const inventoryHandSlots = {
    [SHIELD_ITEM_ID]: 'right',
    pistol: 'right',
    [FOAM_SWORD_ITEM_ID]: 'right',
    [MAGIC_WAND_ITEM_ID]: 'right',
  };
  // Magic wand: the sword weapon with the wand model (held the same way); spells instead of
  // sword hits while it's out. Showdown, the tutorial and (picked up) Multiplayer battles.
  let _wandActive = false;
  const hasMagicWand = () => (inventoryState[MAGIC_WAND_ITEM_ID]?.count || 0) > 0;
  const isWandEquipped = () => _wandActive && foamSword?.holder === playerControls;
  const getMana = () => (Number.isFinite(statsState.mana) ? statsState.mana : MAX_MANA);
  const isWandAllowed = () => hasMagicWand() && !_classicMode && (!duelMode?.isActive() || !!_matchLoadout);
  // Town's fishing rod: the sword weapon in rod form too (casts / hooks / reels instead of
  // hitting — townTrade.js); Town only, once bought (and the guest's sea start, which begins with it)
  let _rodActive = false;
  const isRodAllowed = () => !!_townLoadout?.hasRod || !!seaStart?.isActive();
  const isRodEquipped = () => _rodActive && foamSword?.holder === playerControls;
  // Town's canoe oar: the sword weapon in oar form again (held upside down — the phone up holds
  // it pointing down; townCanoe.js paddles with it); only while standing in the canoe, and then
  // nothing else comes out (the sea start's canoe: the rod too — seaStart.js)
  let _oarActive = false;
  // Town's flying broom: the phone's pose (the gyro loop) and its pose when the player got on
  // (or last recalibrated — `needRest`); the lean between them steers the broom (src/items/broom.js)
  const _broomGyro = { q: new THREE.Quaternion(), rest: new THREE.Quaternion(), needRest: true, at: 0 };
  const _broomTiltQ = new THREE.Quaternion();
  const _broomTiltV = new THREE.Vector3();
  const isOarAllowed = () => !!town?.inCanoe?.() || !!seaStart?.isActive();
  const isOarEquipped = () => _oarActive && foamSword?.holder === playerControls;
  // ── Paddling: the steer (the phone's tilt — _readOarTilt —, the joystick or WASD: _getSteer)
  // moves the canoe (canoeBoat.js); the oar's strokes play by themselves to fit it (_oarPose). A
  // stroke: { id, side (1 = left, player-local +X), dir (1 forward, −1 back), strength, u, lift, t0, dur }.
  let _oarStroke = null;
  let _oarStrokeSeq = 0;
  let _oarSide = 1;          // the side the blade's on
  const _startOarStroke = (side, dir, strength) => {
    _oarStroke = { id: ++_oarStrokeSeq, side, dir, strength, t0: performance.now() / 1000, dur: oarStrokeDuration(strength), u: 0, lift: 0 };
  };
  // The stroke going on now, or null
  const _currentOarStroke = () => {
    if (!_oarStroke) return null;
    const u = (performance.now() / 1000 - _oarStroke.t0) / _oarStroke.dur;
    if (u >= 1) { _oarStroke = null; return null; }
    _oarStroke.u = u;
    return _oarStroke;
  };
  // The phone's tilt as a joystick: steer { fwd, turn } (−1…1; turn > 0 = right), from the
  // rotation since its rest pose (rest — how it was held when the oar came out / after a gap in
  // the gyro); at = the last gyro packet (s)
  const _oarTilt = { steer: { fwd: 0, turn: 0 }, at: 0, rest: new THREE.Quaternion() };
  const _oarStrokeReset = () => { _oarStroke = null; _oarTilt.at = 0; _oarTilt.steer.fwd = 0; _oarTilt.steer.turn = 0; };
  const _oarDQ = new THREE.Quaternion();
  const _oarSteerAxis = (a) => {
    const m = Math.abs(a);
    return m <= OAR_STEER_DEAD ? 0 : Math.sign(a) * Math.min(1, (m - OAR_STEER_DEAD) / (OAR_STEER_FULL - OAR_STEER_DEAD));
  };
  // q: the phone's hold, player-local (+X the player's left, +Z ahead) — any way it's held
  const _readOarTilt = (q, now) => {
    const ot = _oarTilt;
    if (!ot.at || now - ot.at > 0.5) { ot.rest.copy(q); ot.at = now; ot.steer.fwd = 0; ot.steer.turn = 0; return; }
    ot.at = now;
    // The turn since rest, player-local, as axis × angle: about X it's tipped forward (+) / back,
    // about Z leaned right (+) / left
    _oarDQ.copy(ot.rest).invert().premultiply(q);
    if (_oarDQ.w < 0) { _oarDQ.x = -_oarDQ.x; _oarDQ.y = -_oarDQ.y; _oarDQ.z = -_oarDQ.z; _oarDQ.w = -_oarDQ.w; }
    const sinHalf = Math.sqrt(Math.max(0, 1 - _oarDQ.w * _oarDQ.w));
    const k = sinHalf > 1e-6 ? (2 * Math.acos(Math.min(1, _oarDQ.w))) / sinHalf : 2;
    ot.steer.fwd = _oarSteerAxis(_oarDQ.x * k);
    ot.steer.turn = _oarSteerAxis(_oarDQ.z * k);
  };
  // The tilt's steer while the oar's out and the gyro's live, else null
  const _oarTiltSteer = () => (_oarActive && _oarTilt.at && performance.now() / 1000 - _oarTilt.at < 0.5 ? _oarTilt.steer : null);
  // (in place) The oar's hold for the stroke going on (or at rest, lifted beside the hull on
  // its side): the blade's way from the top hand eased toward the stroke's pose, crossing over
  // the canoe lifted when it changes sides; the hands go out over that side (FoamSword.oarLean)
  const _oarPoseV = new THREE.Vector3(1, -0.5, 0).normalize();
  // (in place) Keeps the blade out of the hull: the blade's way (unit, player-local) lifted out
  // over the side (side: 1 left, −1 right) just as far as it takes for every point from the
  // shaft's middle to the tip to be outside the hull or over its gunwale — the top hand where
  // FoamSword puts it for that way (oarGripPoint), the oar sized with the character's grip
  const _hullHand = { x: 0, y: 0, z: 0 };
  const _hullUp = new THREE.Vector3();
  const _hullTry = new THREE.Vector3();
  const _hullSafe = new THREE.Vector3();
  const _oarInHull = (dir, lean, len) => {
    oarGripPoint(_hullUp.copy(dir).negate(), lean, _hullHand);
    for (let i = 0; i <= 5; i++) {
      const d = len * (0.45 + 0.11 * i);
      const y = _hullHand.y + dir.y * d;
      if (y > OAR_HULL_GUNWALE) continue;
      const zc = CANOE_STAND_Z + _hullHand.z + dir.z * d; // along the canoe (bow +)
      const along = 1 - (zc / CANOE_HALF_LENGTH) ** 2;
      if (along <= 0) continue;
      if (Math.abs(_hullHand.x + dir.x * d) < CANOE_HALF_WIDTH * Math.sqrt(along) + OAR_HULL_MARGIN) return true;
    }
    return false;
  };
  const _oarClearHull = (dir, lean, side) => {
    const mesh = foamSword?.heldMesh || foamSword?.mesh;
    const len = OAR_TIP_AT * (mesh?.scale.x || 1);
    if (!_oarInHull(dir, lean, len)) return;
    // (out level over the gunwale, a little up — always clear)
    _hullSafe.set(side, 0.35, Math.max(0, dir.z) * 0.5).normalize();
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 7; i++) {
      const t = (lo + hi) / 2;
      if (_oarInHull(_hullTry.copy(dir).lerp(_hullSafe, t).normalize(), lean, len)) lo = t; else hi = t;
    }
    dir.lerp(_hullSafe, hi).normalize();
  };
  const _oarTarget = new THREE.Vector3();
  const _oarX = new THREE.Vector3();
  const _oarY = new THREE.Vector3();
  const _oarZ = new THREE.Vector3();
  const _oarBasis = new THREE.Matrix4();
  let _oarPoseAt = 0;
  const _oarPose = (q) => {
    const now = performance.now() / 1000;
    const dt = Math.min(0.1, Math.max(0, now - _oarPoseAt));
    _oarPoseAt = now;
    // A stroke to fit the steer when the last one's done: the way it's going, on the side that
    // turns it the way it's turning (turning right: forward on the left / back on the right;
    // straight: the sides take turns), as strong — and as quick — as the steer is far over
    let st = _currentOarStroke();
    if (!st) {
      const steer = _getSteer();
      if (Math.abs(steer.fwd) > 0.12 || Math.abs(steer.turn) > 0.2) {
        const dir = steer.fwd < -0.12 ? -1 : 1;
        const side = Math.abs(steer.turn) > 0.2 ? Math.sign(steer.turn) * dir : -_oarSide;
        _startOarStroke(side, dir, Math.min(1, Math.hypot(steer.fwd, steer.turn)));
        st = _currentOarStroke();
      }
    }
    if (st) _oarSide = st.side;
    const lean = _oarSide;
    const { tilt, swing } = st ? oarStrokePose(st.u, st.dir, st.lift) : { tilt: OAR_REST_TILT, swing: OAR_REST_SWING };
    const sinT = Math.sin(tilt);
    _oarTarget.set(_oarSide * sinT * Math.cos(swing), -Math.cos(tilt), sinT * Math.sin(swing));
    if (Math.sign(_oarPoseV.x) === -_oarSide && Math.abs(_oarPoseV.x) > 0.1) _oarTarget.set(0, 0.15, 1).normalize();
    _oarPoseV.lerp(_oarTarget, 1 - Math.exp(-OAR_POSE_RATE * dt)).normalize();
    if (foamSword) foamSword.oarLean += (lean - foamSword.oarLean) * (1 - Math.exp(-OAR_LEAN_RATE * dt));
    _oarClearHull(_oarPoseV, foamSword?.oarLean ?? lean, Math.sign(lean) || _oarSide);
    // (the oar's +Z points to the handle — back up the blade's way; its blade's face fore / aft)
    _oarZ.copy(_oarPoseV).negate();
    _oarY.set(0, 0, 1).addScaledVector(_oarZ, -_oarZ.z);
    if (_oarY.lengthSq() < 1e-4) _oarY.set(1, 0, 0).addScaledVector(_oarZ, -_oarZ.x);
    _oarY.normalize();
    _oarX.crossVectors(_oarY, _oarZ);
    return q.setFromRotationMatrix(_oarBasis.makeBasis(_oarX, _oarY, _oarZ));
  };
  // Wand swipe in progress (phone-sword loop → _updateWandSwipe)
  const _wandSwipe = {
    active: false, startAt: 0, slowSince: null, cooldownUntil: 0, start: new THREE.Vector3(),
    lastAt: 0, angle: 0, peak: 0, // (turned through / fastest so far — a flick isn't a swipe)
  };
  // Frozen in ice by an ice blast: { left, total } seconds, the cubes around the player
  const _playerFreeze = { left: 0, total: 0, ice: null };
  const isPlayerFrozen = () => _playerFreeze.left > 0;
  // Mana pill under the health bar: shown once the wand is owned (Showdown / tutorial only)
  function updateManaUI() {
    const bar = document.getElementById('mana-bar');
    if (!bar) return;
    // (Town: always — mana pays for the bubble and the broom's boost too)
    const show = !!_townLoadout || (hasMagicWand() && !_classicMode && (!duelMode?.isActive() || !!_matchLoadout));
    bar.classList.toggle('hidden', !show);
    document.body.classList.toggle('has-mana', show);
    if (!show) return;
    const mana = getMana();
    const fill = document.getElementById('mana-bar-fill');
    if (fill) fill.style.width = `${Math.round((mana / MAX_MANA) * 100)}%`;
    const count = document.getElementById('mana-count');
    if (count) count.textContent = String(mana);
    bar.classList.toggle('wand-out', _wandActive && foamSword?.holder === playerControls);
    bar.classList.toggle('mana-empty', mana < WAND_MANA_COST);
  }
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
    if (_matchLoadout) return; // the battle loadout is never saved
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
    if (itemId === MAGIC_WAND_ITEM_ID) return '🪄';
    if (itemId === 'mana_potion') return '🧪';
    if (itemId === 'heart') return '❤️';
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
      return foamSword?.holder === playerControls && !_wandActive && !_rodActive && !_oarActive;
    }
    if (itemId === OAR_ITEM_ID) {
      return isOarEquipped();
    }
    if (itemId === MAGIC_WAND_ITEM_ID) {
      return isWandEquipped();
    }
    if (itemId === FISHING_ROD_ITEM_ID) {
      return isRodEquipped();
    }
    if (itemId === 'pistol') {
      return pistol?.holder === playerControls;
    }
    return false;
  }

  function getEquippedInventoryItemIdForHand(hand) {
    if (hand === 'right') {
      if (isInventoryItemEquipped(MAGIC_WAND_ITEM_ID)) return MAGIC_WAND_ITEM_ID;
      if (isInventoryItemEquipped(FISHING_ROD_ITEM_ID)) return FISHING_ROD_ITEM_ID;
      if (isInventoryItemEquipped(OAR_ITEM_ID)) return OAR_ITEM_ID;
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

  // An equip the player asked for (a weapon button, the phone's): a gyro item coming out asks
  // for a recalibration if it's been a while (_gyroItemCalibPrompt)
  function _equipByPlayer(itemId) {
    const before = getEquippedInventoryItemIdForHand('right');
    equipInventoryItem(itemId);
    const after = getEquippedInventoryItemIdForHand('right');
    if (after && after !== before) _gyroItemCalibPrompt?.();
  }

  function equipInventoryItem(itemId) {
    // Town's fishing rod: no inventory entry of its own (the sword's holds it, as for the wand)
    if (itemId === FISHING_ROD_ITEM_ID || itemId === OAR_ITEM_ID) {
      if (itemId === FISHING_ROD_ITEM_ID ? !isRodAllowed() : !isOarAllowed()) return;
      if (!inventoryState[FOAM_SWORD_ITEM_ID]) inventoryState[FOAM_SWORD_ITEM_ID] = ensureCatalogEntry(FOAM_SWORD_ITEM_ID, { count: 1 });
    } else if (!itemId || !inventoryState[itemId]) return;
    // (in Town's canoe the oar is all there is — and the rod, to fish from it)
    if (town?.inCanoe?.() && itemId !== OAR_ITEM_ID && itemId !== FISHING_ROD_ITEM_ID) return;
    // Town: the sword has to be bought (its inventory entry is also the wand's slot)
    if (_townLoadout && itemId === FOAM_SWORD_ITEM_ID && !_townLoadout.hasSword) return;
    // Multiplayer duels are sword only
    if (_mpSwordOnly() && itemId !== FOAM_SWORD_ITEM_ID) return;
    if (_classicMode && itemId !== FOAM_SWORD_ITEM_ID) return; // Classic: sword only
    // (off Town's broom first: hands on the weapon)
    if (_broomRide?.isRiding()) _broomRide.dismount();
    // The wand (and Town's fishing rod) is the sword weapon in another form: switching between
    // them just swaps the model
    if (itemId === MAGIC_WAND_ITEM_ID || itemId === FOAM_SWORD_ITEM_ID || itemId === FISHING_ROD_ITEM_ID || itemId === OAR_ITEM_ID) {
      const wand = itemId === MAGIC_WAND_ITEM_ID;
      const rod = itemId === FISHING_ROD_ITEM_ID;
      const oar = itemId === OAR_ITEM_ID;
      if (wand && _mpSwordOnly()) return; // (not in duels)
      if (foamSword?.holder === playerControls && (_wandActive !== wand || _rodActive !== rod || _oarActive !== oar)) {
        // Already in hand: just swap sword ↔ wand ↔ rod ↔ oar
        _wandActive = wand;
        _rodActive = rod;
        _oarActive = oar;
        foamSword.wand = wand;
        foamSword.rod = rod;
        foamSword.oar = oar;
        _wandSwipe.active = false;
        audioManager?.playSFX(wand ? 'SFX/Spells/Spell Impact 1.ogg' : 'SFX/Attacks/Sword Attacks Hits and Blocks/Sword Unsheath 1.ogg', rod || oar ? 0.25 : 0.45, { cooldownKey: 'sword-equip', cooldownMs: 100 });
        updateManaUI();
        updateSettingsUI();
        return;
      }
      _wandActive = wand;
      _rodActive = rod;
      _oarActive = oar;
      if (foamSword) { foamSword.wand = wand; foamSword.rod = rod; foamSword.oar = oar; }
      _wandSwipe.active = false;
      updateManaUI();
      itemId = FOAM_SWORD_ITEM_ID;
      if (!inventoryState[FOAM_SWORD_ITEM_ID]) {
        inventoryState[FOAM_SWORD_ITEM_ID] = ensureCatalogEntry(FOAM_SWORD_ITEM_ID, { count: 1 });
      }
    }
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
      // Aiming a gun: first-person camera while it is held (not saved — unequipping goes
      // back to the player's own camera setting)
      playerControls.forceFirstPerson = true;
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
        updateSettingsUI();
    }
  }

  function unequipInventoryItem(itemId) {
    if (itemId === MAGIC_WAND_ITEM_ID) {
      if (!isWandEquipped()) return;
      itemId = FOAM_SWORD_ITEM_ID;
    }
    if (itemId === FISHING_ROD_ITEM_ID) {
      if (!isRodEquipped()) return;
      itemId = FOAM_SWORD_ITEM_ID;
    }
    if (itemId === OAR_ITEM_ID) {
      if (!isOarEquipped()) return;
      itemId = FOAM_SWORD_ITEM_ID;
    }
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
      playerControls.forceFirstPerson = false;
      playerControls?.updateAmmoUI?.(false);
      updateSettingsUI();
    }
  }

  let playerDead = false;
  let duelControlsLocked = false; // Multiplayer lobby / duel countdown
  // Multiplayer duel: everyone gets the same max health, whatever they've upgraded to in
  // Showdown (null outside a duel). Never saved — statsState.maxHealthSegments is untouched.
  let duelMaxHealthOverride = null;
  const effectiveMaxHealthSegments = () => duelMaxHealthOverride ?? statsState.maxHealthSegments;
  const updateControlAvailability = () => {
    if (!playerControls) return;
    playerControls.enabled = !playerDead && !duelControlsLocked && !isPlayerFrozen();
  };

  const healthBar = document.getElementById('health-bar');
  const healthLabel = document.getElementById('health-label');
  function updateHealthUI() {
    if (!healthBar) return;
    const maxSegments = duelMaxHealthOverride
      ?? Math.max(SHOWDOWN_BASE_HEALTH_SEGMENTS, Math.round(statsState.maxHealthSegments || SHOWDOWN_BASE_HEALTH_SEGMENTS));
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
    // Classic mode HUD: one heart per remaining hit (bottom left)
    const classicHearts = document.getElementById('classic-hearts');
    if (classicHearts) {
      if (classicHearts.childElementCount !== maxSegments) {
        classicHearts.replaceChildren(...Array.from({ length: maxSegments }, () => {
          const heart = document.createElement('span');
          heart.className = 'classic-heart';
          return heart;
        }));
      }
      Array.from(classicHearts.children).forEach((heart, index) => {
        heart.classList.toggle('lost', index >= currentSegments);
      });
    }
  }

  const clampStat = (key, value) => {
    if (key === 'health') {
      const num = Number(value);
      if (!Number.isFinite(num)) {
        return 0;
      }
      return clampHealthSegments(num, statsState.level, effectiveMaxHealthSegments());
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
    if (key === 'mana') {
      const num = Number(value);
      return Number.isFinite(num) ? Math.max(0, Math.min(MAX_MANA, Math.round(num))) : MAX_MANA;
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
    if (key === 'mana') updateManaUI();
    if (!skipSave) {
      saveStatsThrottled(profileNameKey, statsState, lastStatUpdateAt);
    }
  }

  // Sword Showdown combo meter: consecutive sword hits; ends (and pays that many coins)
  // when the player is hurt, presses Block or has a swing blocked (src/combat/comboMeter.js)
  const comboMeter = createComboMeter({
    onCashOut: (coins) => {
      const nextCoins = (Number.isFinite(statsState.coins) ? statsState.coins : 0) + coins;
      setStat('coins', nextCoins, { skipSave: true });
      saveStatsThrottled(profileNameKey, statsState, lastStatUpdateAt);
      showCoinPopup(statsState.coins);
      showPickupToast('coins', coins, '', { text: `${coins} hit combo: +${coins} coins` });
    },
  });

  const playerBloodOrigin = new THREE.Vector3();
  const triggerPlayerHurtBlood = (previousHealth, nextHealth) => {
    if (!Number.isFinite(previousHealth) || !Number.isFinite(nextHealth)) return;
    if (nextHealth >= previousHealth || !playerModel?.parent) return;
    comboMeter.end();
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
  // (Town: no bubbles to buy — each one costs TOWN_BUBBLE_MANA mana; the count is how many the mana pays for)
  const TOWN_BUBBLE_MANA = 5;
  const getBubbleCount = () => (_townLoadout
    ? Math.floor(getMana() / TOWN_BUBBLE_MANA)
    : Math.max(0, Math.floor(statsState.bubbles || 0)));
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
    if (duelMode?.isActive() && !(_matchLoadout && matchMode?.isFighting())) return false; // battles only in Multiplayer
    if (getBubbleCount() <= 0) return false;
    if (_townLoadout) setStat('mana', getMana() - TOWN_BUBBLE_MANA, { skipSave: true });
    else setStat('bubbles', getBubbleCount() - 1, { skipSave: true });
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
      : _townLoadout ? '🫧' : `🫧 ${getBubbleCount()}`; // (Town: no count — it runs on mana)
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

  // A pistol bullet (same look / speed as the local player's — PlayerControls.attemptFireProjectileForHand)
  function spawnPistolBullet(position, direction, shooterId) {
    spawnProjectileWithPerfFlags(scene, projectiles, position.clone(), direction.clone(), shooterId, {
      geometry: new THREE.SphereGeometry(0.08, 8, 8),
      colliderDesc: RAPIER.ColliderDesc.ball(0.08).setRestitution(0.3).setFriction(0.5),
      color: new THREE.Color(0xffee44),
      speed: 28,
      lifetime: 2500
    });
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
  // A quest's pay: coins pop up all around the player, then slide in to be collected
  // (`holdUntil`: they sit there until then; `homing`: drawn in from any distance)
  const REWARD_COIN_MAX = 16;
  const REWARD_COIN_HOLD_MS = 600;
  const REWARD_COIN_STAGGER_MS = 45;
  function _spawnRewardCoins(total) {
    const count = Math.max(1, Math.min(REWARD_COIN_MAX, Math.ceil(total / 5)));
    const base = Math.floor(total / count);
    let extra = total - base * count;
    const offset = Math.random() * Math.PI * 2;
    const now = performance.now();
    for (let i = 0; i < count; i++) {
      const value = base + (extra-- > 0 ? 1 : 0);
      const angle = offset + (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.3;
      const dist = 2.6 + Math.random() * 1.8;
      const pos = playerModel.position.clone().add(new THREE.Vector3(Math.cos(angle) * dist, 0, Math.sin(angle) * dist));
      const pickup = spawnCoinPickup(pos, { value });
      if (!pickup) { applyCoinPickupEffects(value); continue; }
      pickup.userData.homing = true;
      pickup.userData.holdUntil = now + REWARD_COIN_HOLD_MS + i * REWARD_COIN_STAGGER_MS;
    }
  }

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
  // Shots go to the duel opponent / the other battle players (not every open connection)
  playerControls.sendProjectile = (payload) => sendNetworkPayload(payload);

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
  const _pvpLastSwordHitAt = new Map(); // per duel opponent / battle enemy: last time our sword hit or was blocked
  const _noPvpTargets = [];
  // Everyone the local sword can hit besides Showdown enemies: the duel opponent or the
  // battle's enemies (each { id, position, center, bladePoints, bladeDir, hasBlade, blocking,
  // blocksSwing?, ownBlood?, onHit(dmg, dir), onBlocked() })
  const _getPvpTargets = () => {
    if (townNet?.isOn() && town?.isActive()) return townNet.getPvpTargets();
    if (matchMode?.isFighting()) return matchMode.getEnemyCombatants();
    const opp = duelMode?.getOpponentCombat();
    return opp ? [opp] : _noPvpTargets;
  };

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
        characterUrl: opts.characterUrl,
      });
    } else {
      enemy = new EnemyPlayer(scene, RAPIER, rapierWorld, {
        position: spawnPos,
        hearts: opts.hearts ?? 3,
        speedScale: opts.speedScale ?? 1.0,
        swingChance: opts.swingChance ?? _psSwingChance(_psStage),
        characterUrl: opts.characterUrl,
        swordDamage: opts.swordDamage,
        nameTag: opts.nameTag,
        showHealthBar: !opts.pemberton && !opts.stageBoss, // (theirs is across the top of the screen)
        wand: !!opts.wand,
        ranged: opts.wand ? WAND_ENEMY_RANGE : undefined,
      });
      enemy._camera = camera;
      if (opts.wand) enemy.onCast = (cast) => _castEnemySpell(enemy, cast);
      if (Number.isFinite(opts.yaw)) enemy.group.rotation.y = opts.yaw;
      if (opts.pemberton) _psSpawnPemberton(enemy);
      else if (opts.stageBoss) _psSpawnStageBoss(enemy, opts.stageBoss);
    }
    hordeEnemies.push(enemy);
    return enemy;
  };

  // ── Sword Showdown story: Pemberton, the final boss (PEMBERTON_STAGE) ──
  // The villager who gave every quest, big and glowing red; sword, gun, shield and bombs
  // (src/characters/pembertonBoss.js). His bullets / bombs hit only the player.
  const PEMBERTON_BULLET_DAMAGE = 1;
  const PEMBERTON_BOMB_DAMAGE = 2;
  const PEMBERTON_BULLET_SPEED = 13;  // m/s — slow enough to see coming (the player's: 28)
  const PEMBERTON_WALK_STOP_DIST = 3; // m — the auto-walk closes in this far on a fighting boss
  // The stage's boss fighter (pembertonBoss.js) while it's in the stage: Pemberton, or the
  // final enemy of any other stage (createStageBoss — talks first, then fights)
  let _psBoss = null;
  const _psIsFinalStage = (stage) => !_classicMode && stage === PEMBERTON_STAGE;
  // A boss bullet / bomb reached the player (Pemberton's, or a stage boss's): bubble and a shield facing it stop it
  const _pembertonHitPlayer = (dmg, src, dir, blastFalloff = null) => {
    if (playerDead || window.isPlayerBubbleActive?.()) return;
    if (src) {
      _shieldHitFrom.position.set(src.x, playerModel.position.y, src.z);
      if (window.tryBlockLocalPlayerHitWithShield?.({ attackerModel: _shieldHitFrom, damage: dmg })) {
        duelCtx.onShieldHit();
        return;
      }
    }
    window.localHealth = Math.max(0, statsState.health - dmg);
    if (blastFalloff !== null) {
      _blastPlayer(dir, blastFalloff);
    } else if (dir) {
      _playerKnockback.vx = dir.x * 3;
      _playerKnockback.vz = dir.z * 3;
      _playerKnockback.endTime = Date.now() + 300;
    }
    audioManager?.playSFX('SFX/Attacks/Sword Attacks Hits and Blocks/Sword Impact Hit 3.ogg', 0.6, { cooldownKey: 'boss-hit-player', cooldownMs: 150 });
  };
  // What his bullets can hit (updateProjectiles' localTarget) and his bombs can blast
  const _pembertonShotTarget = {
    get position() { return playerModel.position; },
    onHit: (dir, src) => _pembertonHitPlayer(PEMBERTON_BULLET_DAMAGE, src, dir),
  };
  const _pembertonBombTargets = [{
    get group() { return playerModel; },
    get isDead() { return playerDead; },
    applyDamage: () => false,
    applyBlastKnockback: ({ direction, falloff = 1 }) => {
      const src = playerModel.position.clone().sub(direction);
      _pembertonHitPlayer(PEMBERTON_BOMB_DAMAGE, src, direction, falloff);
    },
  }];
  // What a boss fighter (Pemberton / a stage boss) gets from the game
  const _bossFighterCtx = (enemy) => ({
    enemy,
    getTarget: () => (_attacksHeld() ? null : playerModel),
    getWeaponGear: () => matchCtx.getWeaponGear(),
    fireBullet: (origin, dir) => spawnProjectileWithPerfFlags(scene, projectiles, origin, dir, 'pemberton', {
      geometry: new THREE.SphereGeometry(0.1, 8, 8),
      colliderDesc: RAPIER.ColliderDesc.ball(0.1).setRestitution(0.3).setFriction(0.5),
      color: new THREE.Color(0xff4422),
      speed: PEMBERTON_BULLET_SPEED,
      lifetime: 2500,
      hostile: true,
    }),
    throwBomb: (origin, target) => playerBombs.throw(origin, target, { getBlastTargets: () => _pembertonBombTargets, keepHeld: true }),
    onShieldBlock: () => duelCtx.onShieldHit(),
    wandRange: WAND_ENEMY_RANGE,
  });
  const _psTrackBoss = (boss, enemy) => {
    const baseDispose = boss.dispose;
    boss.dispose = () => {
      baseDispose();
      if (_psBoss === boss) _psBoss = null;
    };
    _psBoss = boss;
    enemy.onAfterUpdate = () => boss.update();
  };
  const _psSpawnPemberton = (enemy) => {
    _psBoss?.dispose();
    // (a roam quest's: he talks first, like a stage boss, then grows to his size and fights)
    const talkLines = _psRoamQuest?.def.pemberton;
    const boss = createPembertonBoss({ ..._bossFighterCtx(enemy), name: 'Pemberton', ...(talkLines ? { autoStart: false } : {}) });
    if (talkLines) boss.talk = { speaker: 'Pemberton', name: 'Pemberton', lines: talkLines, fight: 'Fight', spare: null };
    _psTrackBoss(boss, enemy);
  };
  // A stage's final enemy: waits on the path, talks when the player gets to it (_psStartBossTalk),
  // then grows, glows red and fights with the stage's gear (stageBoss.js)
  // info: { stage, key } (key: its MATCH_CHARACTERS key)
  const _psSpawnStageBoss = (enemy, { stage, key }) => {
    _psBoss?.dispose();
    const talk = stageBossTalk(stage, MATCH_CHARACTERS[key], { afterStory: stage > PEMBERTON_STAGE, key });
    const boss = createStageBoss({ ..._bossFighterCtx(enemy), name: talk.name, gear: stageBossGear(stage) });
    boss.talk = talk;
    enemy.onCast = (cast) => _castEnemySpell(enemy, cast); // (its wand spells)
    _psTrackBoss(boss, enemy);
  };

  // ── A stage boss's talk (src/characters/stageBoss.js) ──
  // Starts when the player gets this close; meanwhile nobody attacks (_attacksHeld) and the
  // auto-walk waits. Ends with the fight — or, on SPARED_STAGE, sparing it (_psSpareBoss).
  const BOSS_TALK_DIST = 5;
  const bossTalk = createBossTalk({ fill: (text) => fillTalk(text, { name: playerName || 'friend' }) });
  let _psBossTalking = false;
  const _psSparedEnemies = []; // spared stage bosses: stand there (passive) until the next village
  const _psStartBossTalk = (boss) => {
    _psBossTalking = true;
    playerControls.isMoving = false;
    bossTalk.open(boss.talk, (choice) => {
      _psBossTalking = false;
      if (_psBoss !== boss || boss.enemy.isDead) return;
      if (choice === 'spare') _psSpareBoss(boss);
      else boss.start();
    });
  };
  const _psCloseBossTalk = () => {
    bossTalk.close();
    _psBossTalking = false;
  };
  // Spared: out of the fight (no longer one of hordeEnemies), counts toward the stage, joins the
  // player (the win banner says so — _psShowWin)
  const _psSpareBoss = (boss) => {
    const enemy = boss.enemy;
    boss.dispose();
    enemy.onAfterUpdate = null;
    const i = hordeEnemies.indexOf(enemy);
    if (i !== -1) hordeEnemies.splice(i, 1);
    _psSparedEnemies.push(enemy);
    if (_psStageBoss) _psStageBoss.spared = true;
    _psStageKills++;
    _psUpdateKillHud(_psStageActive);
  };
  const _psClearSpared = () => {
    for (const e of _psSparedEnemies.splice(0)) {
      if (e.group?.parent) e.group.parent.remove(e.group);
      try { e.destroy?.(); } catch (_) {}
    }
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
  // Sword Showdown stats (kills, deaths, highestStage), from the profile loaded at login so
  // they're right before Showdown is ever started (Settings → Profile, deaths in other modes).
  // highestStage is never below the stage saved here or in Firebase; a stale stored value
  // is written back so the Top Stage leaderboard is right too.
  let _psStats = normalizeStageStats(playerProfile?.phoneSwordStats);
  if (_psSavedStage() > _psStats.highestStage) _psStats.highestStage = _psSavedStage();
  if (profileNameKey && _psStats.highestStage !== Number(playerProfile?.phoneSwordStats?.highestStage)) {
    void savePhoneSwordStats(profileNameKey, { highestStage: _psStats.highestStage });
  }
  // Multiplayer stats (wins, losses, kills, deaths — duels and battles) for Settings → Profile
  // and the Multiplayer leaderboard; guests keep them for the session only
  let _mpStats = normalizeMultiplayerStats(playerProfile?.multiplayerStats);
  const _recordMultiplayerResult = ({ won = false, lost = false, kills = 0, deaths = 0 } = {}) => {
    _mpStats = normalizeMultiplayerStats({
      wins: _mpStats.wins + (won ? 1 : 0),
      losses: _mpStats.losses + (lost ? 1 : 0),
      kills: _mpStats.kills + (Number(kills) || 0),
      deaths: _mpStats.deaths + (Number(deaths) || 0)
    });
    if (!profileNameKey) return;
    void recordMultiplayerResult(profileNameKey, { won, lost, kills, deaths }).then((saved) => {
      if (saved) _mpStats = saved;
    });
  };
  // Load stage from Firebase first (async), fallback to localStorage
  let _psStage = _psSavedStage();
  let _psEnemyQueue = [];   // [{pos, hearts, triggerDist, bombThrower, characterUrl, boss, nameTag}]

  // ── Classic mode: the Showdown stages, Wii Sports Resort style ──
  // Miis only (player and enemies; enemies get random names shown with their hearts),
  // swordsmen only (no bombers, bosses, coins, heart bubbles, blood, XP or shop items),
  // CLASSIC_HEARTS hits per stage, Block is the only button, always daytime. Own stage
  // screen ("Stage N" + stage name, OK / Recalibrate / Back), "Ready" → "Go!", and HUD:
  // hearts bottom left, Score % (enemies defeated) bottom right, "N-hit Combo!" every 5th
  // hit. Stage progress is its own (localStorage ps_classic_stage_<key> + classicStats).
  // body.classic-mode / body.classic-playing hide the rest of the HUD (styles.css).
  let _classicCountdown = false;        // "Ready" / "Go!" up: stage built, nothing moves yet
  const CLASSIC_HEARTS = 3;
  const CLASSIC_ENEMY_SWORD_DAMAGE = 1; // one heart per hit
  // (Miis are Classic's only — not in MATCH_CHARACTERS, so no other mode has them)
  const CLASSIC_MII_URLS = [glbCharacterConfig.mii1Url];
  const _classicMiiUrl = () => (CLASSIC_MII_URLS.length
    ? CLASSIC_MII_URLS[Math.floor(Math.random() * CLASSIC_MII_URLS.length)]
    : glbCharacterConfig.mii1Url);
  const CLASSIC_NAMES = [
    'Helen', 'Matt', 'Sakura', 'Takumi', 'Emma', 'Lucia', 'Pierre', 'Hiromasa', 'Sarah', 'Marco',
    'Chika', 'Abby', 'Gabriele', 'Rin', 'Tommy', 'Nelly', 'Steph', 'Vincenzo', 'Ai', 'Shinta',
    'Keiko', 'Hayley', 'Eva', 'Elisa', 'Julie', 'Miguel', 'Shouta', 'Jessie', 'Oscar', 'Yoshi',
    'Holly', 'Alex', 'Fumiko', 'George', 'Martin', 'Kathrin', 'Asami', 'Akira', 'Ursula', 'Silke',
    'Cole', 'Maria', 'Theo', 'Nick', 'Jake', 'Rainer', 'Tatsuaki', 'Sota', 'Naomi', 'Ren',
    'Pablo', 'Anna', 'Greg', 'Cleo', 'Ryan', 'Pavel', 'Nina', 'Lola', 'Hugo', 'Ida'
  ];
  let _classicNamePool = [];
  const _classicName = () => {
    if (!_classicNamePool.length) _classicNamePool = [...CLASSIC_NAMES];
    return _classicNamePool.splice(Math.floor(Math.random() * _classicNamePool.length), 1)[0];
  };
  const CLASSIC_STAGE_NAMES = [
    'Bridge at High Noon', 'Sunrise on the Trail', 'The Long Meadow', 'Hillside Ambush',
    'Windy Ridge', 'Crossroads Clash', 'Riverside Rumble', 'Old Stone Path',
    'Valley of Swords', 'Cliffside Charge', 'Forest Gate', 'The Winding Road',
    'Lighthouse Approach', 'Grassland Gauntlet', 'Ruins at Midday', 'Summit Showdown',
    'Canyon Run', 'Lakeside Standoff', 'Tower Steps', 'The Final Field'
  ];
  const _classicStageName = (stage) => CLASSIC_STAGE_NAMES[(Math.max(1, stage) - 1) % CLASSIC_STAGE_NAMES.length];
  const _classicStageLsKey = () => profileNameKey ? `ps_classic_stage_${profileNameKey}` : null;
  const _classicSavedStage = () => {
    try { const k = _classicStageLsKey(); return k ? (parseInt(localStorage.getItem(k), 10) || 1) : 1; } catch (_) { return 1; }
  };
  // Classic stats (kills, deaths, highestStage) — Classic kills/deaths don't count for Showdown
  let _classicStats = normalizeStageStats(playerProfile?.classicStats);
  if (_classicSavedStage() > _classicStats.highestStage) _classicStats.highestStage = _classicSavedStage();
  const _classicSaveStats = () => { if (profileNameKey) void saveClassicStats(profileNameKey, _classicStats); };
  const _classicSaveStage = (stage) => {
    try { const k = _classicStageLsKey(); if (k) localStorage.setItem(k, stage); } catch (_) {}
    if (profileNameKey) void saveClassicStage(profileNameKey, stage);
    if (stage > _classicStats.highestStage) {
      _classicStats.highestStage = stage;
      _classicSaveStats();
    }
  };
  const _classicScoreValue = document.getElementById('classic-score-value');
  const _classicUpdateScore = () => {
    if (!_classicScoreValue) return;
    const pct = _psStageTotal > 0 ? Math.floor((100 * Math.min(_psStageKills, _psStageTotal)) / _psStageTotal) : 0;
    _classicScoreValue.textContent = `${pct}%`;
  };
  // Gameplay HUD on/off (hearts, score, Block); the settings button hides while it's on
  const _classicSetPlaying = (on) => {
    document.body.classList.toggle('classic-playing', !!on && _classicMode);
  };

  // ── Sword Showdown characters (keys of MATCH_CHARACTERS) ──
  // Regular enemies are frog men plus every character unlocked so far; each stage ends with
  // a boss (a locked character — the frog man included, PS_BOSS_HEARTS+ hearts) whose defeat
  // unlocks it. Once all are unlocked the boss is any random character. Stage 1's boss is
  // always the frog man and the first boss with a wand (FIRST_WAND_BOSS_STAGE) the wizard.
  // The player starts as the village boy and picks who to play as in the village.
  // Saved in localStorage + profiles/<key>/phoneSwordStats/characters.
  const PS_START_CHARACTERS = ['villageBoy', 'villageGirl']; // (MATCH_CHARACTERS[k].starter — never bosses)
  const PS_ENEMY_BASE_CHARACTER = 'frog';
  const PS_FIXED_BOSSES = { 1: 'frog', [FIRST_WAND_BOSS_STAGE]: 'wizard' }; // stage → boss character
  // The story's boss for each stage (where each character lives — CHARACTER_STORIES in
  // stageBoss.js): used while still locked (else, with others still locked, a random locked one)
  // — or always when an earlier stage has that character too (the frog fisher at 4, Wren at 8)
  const PS_STORY_BOSSES = { 2: 'pumpkin', 3: 'gemhorn', 4: 'frog', 5: 'tree', 7: 'antler', 8: 'antler' };
  const PS_WAND_ENEMY_CHARACTER = 'wizard'; // wand casters are always wizards
  const PS_BOSS_HEARTS = 3;          // stage 1 boss; +1 every PS_BOSS_HEARTS_EVERY stages
  const PS_BOSS_HEARTS_EVERY = 3;
  const PS_BOSS_MAX_HEARTS = 10;
  const PS_BOSS_SWING_BONUS = 0.15;  // bosses swing more often than their stage's swordsmen
  const _psCharsLsKey = () => profileNameKey ? `ps_chars_${profileNameKey}` : null;
  // (the village boy replaced the psychic kid as the start character: old saves say 'psychic')
  const _psCharKey = (k) => (k === 'psychic' ? 'villageBoy' : k);
  const _psNormalizeChars = ({ unlocked, selected } = {}) => {
    const set = new Set(PS_START_CHARACTERS);
    unlocked = Array.isArray(unlocked) ? unlocked.map(_psCharKey) : unlocked;
    selected = _psCharKey(selected);
    // Saves from before the psychic kid (now the village boy) had the frog man as the free start
    // character (never won from a boss), so a list without it drops it: the frog man is a boss now
    const legacy = Array.isArray(unlocked) && unlocked.length > 0 && !unlocked.includes('villageBoy');
    for (const k of unlocked || []) if (MATCH_CHARACTERS[k] && !(legacy && k === 'frog')) set.add(k);
    const list = Object.keys(MATCH_CHARACTERS).filter((k) => set.has(k));
    return { unlocked: list, selected: list.includes(selected) ? selected : PS_START_CHARACTERS[0] };
  };
  const _psLoadLocalChars = () => {
    try {
      const k = _psCharsLsKey();
      return _psNormalizeChars(k ? JSON.parse(localStorage.getItem(k) || 'null') || {} : {});
    } catch (_) { return _psNormalizeChars(); }
  };
  let _psChars = _psLoadLocalChars();
  const _psSaveChars = () => {
    try { const k = _psCharsLsKey(); if (k) localStorage.setItem(k, JSON.stringify(_psChars)); } catch (_) {}
    if (profileNameKey) void saveShowdownCharacters(profileNameKey, _psChars);
  };
  let _psStageBoss = null; // { key, unlocks, stage } for the stage on the stage screen / being played
  // (story characters — MATCH_CHARACTERS[k].story — are never bosses: story mode unlocks them;
  // a fixed stage's boss is always its PS_FIXED_BOSSES character, which no earlier stage picks;
  // a story stage's is its PS_STORY_BOSSES character when that is still locked)
  const _psPickBoss = (stage) => {
    const fixed = PS_FIXED_BOSSES[stage];
    if (fixed) return { key: fixed, unlocks: !_psChars.unlocked.includes(fixed), stage };
    const reserved = [...Object.entries(PS_FIXED_BOSSES), ...Object.entries(PS_STORY_BOSSES)]
      .filter(([s]) => Number(s) > stage).map(([, k]) => k);
    const fightable = Object.keys(MATCH_CHARACTERS).filter((k) => !MATCH_CHARACTERS[k].story && !MATCH_CHARACTERS[k].starter);
    const locked = fightable.filter((k) => !_psChars.unlocked.includes(k));
    const story = PS_STORY_BOSSES[stage];
    const repeat = [...Object.entries(PS_FIXED_BOSSES), ...Object.entries(PS_STORY_BOSSES)]
      .some(([s, k]) => Number(s) < stage && k === story);
    if (story && (repeat || locked.includes(story) || !locked.length)) return { key: story, unlocks: locked.includes(story), stage };
    const lockedFree = locked.filter((k) => !reserved.includes(k));
    const pool = lockedFree.length ? lockedFree : locked.length ? locked : fightable;
    const key = pool[Math.floor(Math.random() * pool.length)];
    return { key, unlocks: locked.includes(key), stage };
  };
  const _psBossHearts = (stage) => Math.min(PS_BOSS_MAX_HEARTS,
    PS_BOSS_HEARTS + Math.floor(Math.max(0, stage - 1) / PS_BOSS_HEARTS_EVERY));
  // Regular enemies: frog men + characters won from bosses
  const _psEnemyCharacterPool = () => [PS_ENEMY_BASE_CHARACTER, ..._psChars.unlocked.filter(
    (k) => !PS_START_CHARACTERS.includes(k) && k !== PS_ENEMY_BASE_CHARACTER)];
  let _psJumpVelY = 0;       // vertical velocity for phone sword jump
  let _psGroundY = null;     // ground Y level for phone sword mode
  const PS_JUMP_FORCE = 8.5; // initial upward speed m/s
  const PS_GRAVITY = 20;     // gravity m/s²
  const CLIMB_JUMP_OFF_UP = 3; // m/s upward pop when pulling back off a wall (PlayerControls climbing)
  // Safety net: nothing keeps the player in the air this long (a jump is under a second) —
  // past it they're put on the ground under them
  const PS_AIRBORNE_MAX_S = 4;
  let _psAirborneS = 0;
  // Pulling back while climbing a wall: a small hop, then fall with the jump gravity
  // (PlayerControls drifts the player backward until they land)
  playerControls.onClimbJumpOff = () => {
    _psJumpVelY = CLIMB_JUMP_OFF_UP;
    window.phoneSwordAirborne = true;
  };
  // Walking off a ledge: fall from rest with the jump gravity (lands in the jump code below)
  playerControls.onLedgeFall = () => {
    _psJumpVelY = -0.01;
    window.phoneSwordAirborne = true;
  };

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
  const MATCH_BOMB_AIM_RANGE = 14;          // Multiplayer battles: bombs land on the closest opponent this near
  const PLAYER_BOMB_RELEASE_AT = 0.3;       // fraction of Throw.fbx where the bomb leaves the hand
  const PLAYER_BOMB_WINDUP_MS = 700;        // release time when the character hasn't loaded
  const PLAYER_BOMB_CLIP_TIMEOUT_MS = 2500; // release anyway if the clip is slow to load
  const PLAYER_BOMB_HAND = 'left';          // mirrored label: the anatomical right arm
  const playerBombs = createPlayerBombs({
    scene,
    getBlastTargets: () => (town?.isActive() ? [...hordeEnemies, ...town.getWeaponTargets()] : hordeEnemies),
  });

  // ── Sword Showdown magic: the magic wand and wand-casting enemies ──
  // A swipe of the wand (held like the sword) fires a blast shaped like the swipe
  // (src/combat/magicBlast.js), costing WAND_MANA_COST mana. Each blast is randomly fire
  // (thrown back like a bomb blast, MAGIC_FIRE_DAMAGE) or ice (MAGIC_ICE_DAMAGE, frozen in ice
  // cubes for 3–5 s — shaking the phone melts it sooner). A block stops a blast only with the
  // blade along the blast's line (bladeBlocksBlast).
  const magicBlasts = createMagicBlasts({ scene });
  const _magicFreezeSeconds = () => MAGIC_FREEZE_MIN_S + Math.random() * MAGIC_FREEZE_RAND_S;
  const _wandGlow = { level: 0, color: new THREE.Color() };
  const _magicBladeDir = new THREE.Vector3();
  const _wandSwipeVec = new THREE.Vector3();
  let _magicBlocks = 0;  // blasts the player has blocked (tutorial)
  let _playerCasts = 0;  // spells the player has cast (tutorial)
  const _magicPushDir = (blast) => {
    const dir = blast.forward.clone().setY(0);
    return dir.lengthSq() > 1e-6 ? dir.normalize() : dir.set(0, 0, 1);
  };
  // A player blast reached an enemy (not blocked)
  const _magicHitEnemy = (enemy, blast) => {
    if (enemy.isDead) return;
    const dir = _magicPushDir(blast);
    if (blast.element === 'fire') {
      enemy.applyDamage(MAGIC_FIRE_DAMAGE);
      enemy.applyBlastKnockback?.({ direction: dir, falloff: 0.75 });
    } else {
      enemy.applyDamage(MAGIC_ICE_DAMAGE);
      if (!enemy.isDead) enemy.freeze?.(_magicFreezeSeconds());
    }
    enemy.magicHits = (enemy.magicHits || 0) + 1;
    if (!enemy._tutorial && _psStageActive) comboMeter.hit();
  };
  const _playerBlastTarget = {
    center: new THREE.Vector3(),
    radius: 0.42,
    // Bubble, a shield facing the blast, or a sword / wand block along the blast's line
    blocks: (blast) => {
      if (window.isPlayerBubbleActive?.()) return true;
      _shieldHitFrom.position.copy(playerModel.position).addScaledVector(blast.forward, -3).setY(playerModel.position.y);
      if (window.tryBlockLocalPlayerHitWithShield?.({ attackerModel: _shieldHitFrom, damage: blast.element === 'fire' ? MAGIC_FIRE_DAMAGE : MAGIC_ICE_DAMAGE })) {
        duelCtx.onShieldHit();
        return true;
      }
      const pts = window.phoneSwordBladePoints;
      if (window.phoneSwordGyro?.blocking && !isPlayerFrozen() && foamSword?.holder === playerControls && pts?.length >= 3 &&
          bladeBlocksBlast(_magicBladeDir.subVectors(pts[2], pts[0]), blast.line, blast.forward)) {
        window._pswShowBlockFlash?.('player');
        audioManager?.playSFX('SFX/Attacks/Sword Attacks Hits and Blocks/Sword Parry 2.ogg', 0.65, { cooldownKey: 'psw-parry', cooldownMs: 300 });
        _magicBlocks += 1;
        return true;
      }
      return false;
    },
    onHit: (blast) => {
      if (playerDead) return;
      const dir = _magicPushDir(blast);
      if (blast.element === 'fire') {
        window.localHealth = Math.max(0, statsState.health - MAGIC_FIRE_DAMAGE);
        _blastPlayer(dir, 0.75);
      } else {
        window.localHealth = Math.max(0, statsState.health - MAGIC_ICE_DAMAGE);
        freezePlayer(_magicFreezeSeconds());
      }
    },
  };
  const _magicTargets = (blast) => {
    // Multiplayer battle blasts (anyone's): matchMode decides who they can hit
    if (blast.side === 'match') return matchMode?.getMagicTargets(blast) ?? [];
    // Another Town player's spell: it can only hit us here (their game shows it hitting nothing)
    if (blast.side === 'town') {
      if (playerDead || !town?.isActive()) return [];
      _playerBlastTarget.center.copy(playerModel.position).setY(playerModel.position.y + 0.5);
      return [{
        ..._playerBlastTarget,
        onHit: (b) => {
          town.onPvpHurt(b.caster);
          townNet?.sendHurt(b.caster, town.getStars());
          _playerBlastTarget.onHit(b);
        },
      }];
    }
    if (blast.side === 'enemy') {
      if (playerDead || _attacksHeld()) return [];
      _playerBlastTarget.center.copy(playerModel.position).setY(playerModel.position.y + 0.5);
      return [_playerBlastTarget];
    }
    const targets = [];
    for (const enemy of hordeEnemies) {
      if (enemy.isDead || !enemy.group?.parent) continue;
      targets.push({
        center: enemy.getCenterWorldPos(),
        radius: (enemy.bodyHitRadius ?? 0.45) * 0.9,
        blocks: (b) => !!enemy.blocksBlast?.(b),
        onBlocked: () => {
          enemy.applyBlockImpact?.();
          enemy.magicBlocks = (enemy.magicBlocks || 0) + 1;
          audioManager?.playSFX('SFX/Attacks/Sword Attacks Hits and Blocks/Sword Parry 2.ogg', 0.6, { cooldownKey: 'magic-parry', cooldownMs: 200 });
        },
        onHit: (b) => _magicHitEnemy(enemy, b),
      });
    }
    if (town?.isActive()) targets.push(...town.getMagicTargets());
    return targets;
  };
  // Wand enemy's spell leaves its wand (EnemyPlayer.onCast)
  const _castEnemySpell = (enemy, { origin, forward, line, element }) => {
    magicBlasts.spawn({
      origin, forward, line, element, side: 'enemy', caster: enemy,
      speed: ENEMY_BLAST_SPEED_MPS, length: ENEMY_BLAST_LENGTH,
      ignoreMap: !!enemy._tutorial, // (a tree / wall in the way would stall the lesson)
    });
  };
  // Player's spell: the swipe's line, flying the way the player faces
  let _manaToastAt = 0;
  const castPlayerSpell = (swipe) => {
    const inMatch = !!matchMode?.isInMatch();
    if (inMatch && !matchMode.isFighting()) return false;
    if (getMana() < WAND_MANA_COST) {
      const bar = document.getElementById('mana-bar');
      bar?.classList.remove('mana-flash');
      void bar?.offsetWidth;
      bar?.classList.add('mana-flash');
      if (performance.now() - _manaToastAt > 2500) {
        _manaToastAt = performance.now();
        showPickupToast('mana_potion', 1, '', { text: _matchLoadout ? 'Out of mana — grab a Mana pickup' : 'Out of mana — buy a Mana Potion' });
      }
      void psAutoBuyTick();
      return false;
    }
    if (!showdownTutorial?.isActive()) {
      setStat('mana', getMana() - WAND_MANA_COST, { skipSave: true });
      saveStatsThrottled(profileNameKey, statsState, lastStatUpdateAt);
    }
    const forward = playerModel.getWorldDirection(new THREE.Vector3()).setY(0);
    if (forward.lengthSq() < 1e-6) forward.set(0, 0, 1);
    forward.normalize();
    const origin = playerModel.position.clone().addScaledVector(forward, 0.6);
    origin.y += MAGIC_BLAST_HEIGHT;
    const blast = magicBlasts.spawn({
      origin, forward, line: swipe,
      // (battle blasts: every client spawns them, matchMode picks the targets)
      side: inMatch ? 'match' : 'player', caster: inMatch ? multiplayer?.getId?.() ?? null : null,
      speed: PLAYER_BLAST_SPEED_MPS, length: PLAYER_BLAST_LENGTH,
      ignoreMap: !!showdownTutorial?.isActive(),
    });
    if (inMatch) matchMode.onLocalCast({ origin, forward, line: blast.line, element: blast.element });
    else if (townNet?.isOn() && town?.isActive()) townNet.sendMagic({ origin, forward, line: blast.line, element: blast.element });
    _wandGlow.level = 1;
    _wandGlow.color.set(MAGIC_ELEMENTS[blast.element].glow);
    _playerCasts += 1;
    return true;
  };
  // Swipe detection: starts when the wand speeds up, ends once it has slowed for a moment;
  // the tip's travel in between is the swipe
  const _updateWandSwipe = (tipWorld, nowSec, locked) => {
    const sw = _wandSwipe;
    const speed = window._pswDebugSpeed ?? 0;
    if (locked || playerDead) { sw.active = false; return; }
    if (!sw.active) {
      if (speed >= WAND_SWIPE_START_SPEED && nowSec >= sw.cooldownUntil) {
        sw.active = true;
        sw.startAt = nowSec;
        sw.lastAt = nowSec;
        sw.angle = 0;
        sw.peak = speed;
        sw.slowSince = null;
        sw.start.copy(_psw.tipHistory.length ? _psw.tipHistory[0].pos : (_psw.prevTipWorld ?? tipWorld));
      }
      return;
    }
    sw.angle += speed * Math.min(0.1, nowSec - sw.lastAt);
    sw.lastAt = nowSec;
    sw.peak = Math.max(sw.peak, speed);
    // (at 60 fps every other frame repeats the last ~30 Hz phone packet: wait a moment)
    if (speed > WAND_SWIPE_END_SPEED) sw.slowSince = null;
    else sw.slowSince ??= nowSec;
    const ended = (sw.slowSince !== null && nowSec - sw.slowSince > 0.07) || nowSec - sw.startAt > WAND_SWIPE_MAX_S;
    if (!ended) return;
    sw.active = false;
    const swipe = _wandSwipeVec.subVectors(tipWorld, sw.start);
    if (swipe.length() < WAND_SWIPE_MIN_DIST || sw.angle < WAND_SWIPE_MIN_ANGLE || sw.peak < WAND_SWIPE_PEAK_SPEED) return;
    sw.cooldownUntil = nowSec + WAND_CAST_COOLDOWN_S;
    castPlayerSpell(swipe.clone());
  };
  // Ice on the player: controls off, the sword stuck; shaking the phone melts it faster
  function freezePlayer(seconds) {
    if (playerDead || !(seconds > 0)) return;
    _playerFreeze.left = Math.max(_playerFreeze.left, seconds);
    _playerFreeze.total = Math.max(_playerFreeze.total, _playerFreeze.left);
    if (!_playerFreeze.ice) {
      _playerFreeze.ice = createIceEncasing(1.0);
      playerModel.add(_playerFreeze.ice);
    }
    _wandSwipe.active = false;
    if (window.phoneSwordGyro) window.phoneSwordGyro.blocking = false;
    playerControls?.punchButton?.classList.remove('ps-blocking-active');
    document.body.classList.add('player-frozen');
    updateControlAvailability();
  }
  function thawPlayer() {
    _playerFreeze.left = 0;
    _playerFreeze.total = 0;
    _playerFreeze.ice?.parent?.remove(_playerFreeze.ice);
    _playerFreeze.ice = null;
    document.body.classList.remove('player-frozen');
    updateControlAvailability();
  }
  const _updatePlayerFreeze = (dt) => {
    if (!isPlayerFrozen()) return;
    const shake = window.phoneSwordGyro?.connected ? (window._pswDebugSpeed ?? 0) : 0;
    const shaking = shake > FREEZE_SHAKE_SPEED;
    const melt = dt * (1 + (shaking ? FREEZE_SHAKE_RATE * Math.min(2, shake / FREEZE_SHAKE_SPEED) : 0));
    _playerFreeze.left -= melt;
    setIceEncasingLevel(_playerFreeze.ice, _playerFreeze.left / Math.max(0.001, _playerFreeze.total));
    shakeIceEncasing(_playerFreeze.ice, shaking ? 0.07 : 0);
    if (_playerFreeze.left <= 0) {
      thawPlayer();
      audioManager?.playSFX('SFX/Spells/Waterspray 1.ogg', 0.5, { cooldownKey: 'magic-thaw', cooldownMs: 300 });
    }
  };
  const _updateMagic = (dt) => {
    magicBlasts.update(dt, _magicTargets);
    _updatePlayerFreeze(dt);
    // Wand orb: flashes the spell's colour on a cast, then settles
    if (_wandActive) {
      _wandGlow.level = Math.max(0, _wandGlow.level - dt * 3);
      setWandGlow(foamSword?.getWandModel?.(), _wandGlow.level, _wandGlow.color);
    }
  };

  // ── Sword Showdown: heart bubbles (placed mid-stage in _psBuildStage, pop when they
  // reach the player for +1 health segment; src/combat/heartBubbles.js) ──
  const heartBubbles = createHeartBubbles({ scene, getGroundY: getTerrainHeight });
  const _popHeartBubbles = (count) => {
    if (count <= 0) return;
    const before = statsState.health;
    setStat('health', statsState.health + count, { skipSave: true });
    const gained = Math.max(0, Math.round(statsState.health - before));
    audioManager?.playSFX?.('SFX/Spells/Waterspray 1.ogg', 0.7, { cooldownKey: 'heart-bubble', cooldownMs: 150 });
    showPickupToast('heart', Math.max(1, gained), '', { text: gained > 0 ? `+${gained} Health` : 'Health already full' });
  };
  // Heart bubbles per stage: 1 at the start, +1 every 5 stages (max 4), plus a rising
  // chance of one more; they sit around the middle of the path.
  const _psHeartBubbleCount = (stage) => {
    const base = Math.min(4, 1 + Math.floor((stage - 1) / 5));
    return base + (Math.random() < Math.min(0.8, stage * 0.04) ? 1 : 0);
  };
  // ── Sword Showdown: one hidden chest per stage (placed off the path in _psBuildStage);
  // swiping it with the sword opens it for a mystery-chest prize (src/combat/stageChests.js) ──
  const stageChests = createStageChests({ scene, getGroundY: getTerrainHeight });
  const PS_CHEST_SIDE_MIN = 4;   // m off the path
  const PS_CHEST_SIDE_MAX = 7;
  const _playerBombPalm = new THREE.Vector3();
  const _playerBombForward = new THREE.Vector3();
  let playerBombThrow = null; // { restoreIds, startedAt, usesClip, released }
  const getPlayerBombCount = () => Math.max(0, Math.floor(statsState.bombs || 0));
  const hasPlayerBomb = () => getPlayerBombCount() > 0;
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
    button.classList.toggle('ps-bomb-empty', !playerBombThrow && !hasPlayerBomb());
  };
  const throwPlayerBomb = () => {
    if (!playerBombs || playerDead || playerBombThrow || _mpSwordOnly()) return false;
    if (_matchLoadout && !matchMode?.isFighting()) return false;
    if (!hasPlayerBomb()) return false;
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
    let target = playerModel.position.clone().addScaledVector(_playerBombForward, PLAYER_BOMB_THROW_DIST);
    if (_matchLoadout) {
      // Battle: lob it at the closest opponent in range
      let best = null;
      let bestD = MATCH_BOMB_AIM_RANGE;
      for (const t of _getPvpTargets()) {
        const d = t.position.distanceTo(playerModel.position);
        if (d < bestD) { bestD = d; best = t; }
      }
      if (best) target = best.position.clone();
    }
    const groundY = getTerrainHeight(target.x, target.z);
    if (Number.isFinite(groundY)) target.y = groundY;
    if (_matchLoadout && matchMode?.throwLocalBomb(_playerBombPalm.clone(), target)) return;
    // (Town: the other players see it — and their games check it against them)
    if (townNet?.isOn() && town?.isActive()) townNet.sendBomb(_playerBombPalm, target);
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
  // ── Dodge roll: a swipe on the touch screen (PlayerControls.onSwipe) or on the phone
  // controller ('roll' message) rolls the player that way (PlayerControls.startRoll moves them,
  // Roll.fbx plays over the body). Whatever is held is put away for the roll and comes back
  // after, like a bomb throw.
  let playerRoll = null; // { restoreIds }
  const tryPlayerRoll = (dx, dy) => {
    if (!playerControls?.enabled || _classicMode || _gamePaused || playerDead) return false; // Classic: Block only
    if (playerRoll || playerBombThrow || isPlayerFrozen() || _wandShieldHold) return false;
    if (bossTalk.isOpen() || _isSwordCalibPromptOpen()) return false;
    if (!(playerControls.moveSpeedScale > 0)) return false; // (the village intro holds the player still)
    if (_matchLoadout && !matchMode?.isFighting()) return false;
    const glbCharacter = playerModel.userData.qwopRig?.glbCharacter;
    if (glbCharacter?.isDead || glbCharacter?.actionActive) return false; // knocked down / mid-throw
    if (!playerControls.startRoll(dx, dy)) return false;
    const restoreIds = getEquippedInventoryItemIds();
    restoreIds.forEach((itemId) => unequipInventoryItem(itemId));
    playerControls.refreshActionButtons?.();
    playerRoll = { restoreIds };
    glbCharacter?.playAction(glbCharacterConfig.rollClip);
    return true;
  };
  playerControls.onSwipe = (dx, dy) => { tryPlayerRoll(dx, dy); };
  // "Use This Device" (this screen is the gyro sword): swipes on it are sword moves, not rolls
  playerControls.swipeRollAllowed = () => !window.phoneSwordGyro?.localDevice;
  const finishPlayerRoll = () => {
    const { restoreIds } = playerRoll;
    playerRoll = null;
    playerControls?.cancelRoll();
    // Put back what was held, unless something else got equipped meanwhile
    if (!playerDead && getEquippedInventoryItemIds().length === 0) {
      restoreIds.forEach((itemId) => {
        if (inventoryState[itemId]?.count > 0) equipInventoryItem(itemId);
      });
      playerControls?.refreshActionButtons?.();
    }
  };
  const updatePlayerRoll = () => {
    if (!playerRoll) return;
    if (playerDead) {
      // Respawn re-equips the sword
      playerRoll = null;
      playerControls?.cancelRoll();
      return;
    }
    const glbCharacter = playerModel.userData.qwopRig?.glbCharacter;
    // Done once both the move and the clip are (a blast knocking us down ends the clip)
    if (!playerControls?.isRolling && !glbCharacter?.actionActive) finishPlayerRoll();
  };

  let _psPathEnd = new THREE.Vector3();
  // The current stage's path (createPolyline) and how far along it the player has got: the
  // auto-walk heads for a point a little further along it from wherever the player is (walking
  // past a bend by hand never sends them back to it). Enemies chasing from far off follow it too.
  let _psPath = null;
  let _psPathProgress = 0;
  const PS_PATH_LOOKAHEAD = 3;          // m along the path ahead of the player that the auto-walk heads for
  const PS_PATH_BACKTRACK = 5;          // m: the player's spot on the path never moves back more than this
  // …nor forward more than this in one frame (a winding route passes near its own later stretches:
  // walking off the path toward one mustn't skip the player there, or to the end)
  const PS_PATH_MAX_SKIP = 1.5;
  const PS_PATH_REACHED = 1.5;          // m: the auto-walk's target point counts as reached this close
  const PS_ENEMY_PATH_DIRECT_DIST = 7;  // m: an enemy closer than this walks straight at the player
  const PS_ENEMY_PATH_LOOKAHEAD = 3;    // m along the path toward the player
  const _psPathAheadPoint = new THREE.Vector3();
  const _psUpdatePathProgress = () => {
    if (!_psPath) return 0;
    const s = _psPath.project(playerModel.position.x, playerModel.position.z,
      _psPathProgress - PS_PATH_BACKTRACK, _psPathProgress + PS_PATH_MAX_SKIP);
    _psPathProgress = Math.max(_psPathProgress, s);
    // At a sharp bend the walk cuts the corner and reaches the point it heads for while its
    // spot on the path (above) stays short of the bend: that point is behind it now, move on
    // (else the auto-walk thinks it's at the end and waits)
    for (let i = 0; i < 20 && _psPathProgress + PS_PATH_LOOKAHEAD < _psPath.length; i++) {
      const a = _psPath.at(_psPathProgress + PS_PATH_LOOKAHEAD);
      if (Math.hypot(a.x - playerModel.position.x, a.z - playerModel.position.z) > PS_PATH_REACHED) break;
      _psPathProgress += 0.5;
    }
    return s;
  };
  // EnemyPlayer / BombThrowerEnemy `chaseVia`: walking toward the player from a way off, they
  // keep to the path (a point a little along it from their own spot, toward the player's)
  const _psEnemyChaseVia = (pos, target, out) => {
    if (!_psPath || !_psStageActive) return null;
    if (Math.hypot(target.x - pos.x, target.z - pos.z) < PS_ENEMY_PATH_DIRECT_DIST) return null;
    const se = _psPath.project(pos.x, pos.z);
    const sp = _psPath.project(target.x, target.z, _psPathProgress - PS_PATH_BACKTRACK);
    const p = _psPath.at(se + Math.sign(sp - se) * Math.min(Math.abs(sp - se), PS_ENEMY_PATH_LOOKAHEAD));
    if (Math.hypot(p.x - pos.x, p.z - pos.z) < 0.3) return null;
    return out.set(p.x, pos.y, p.z);
  };
  let _psAutoWalking = false;
  // Town: when the first day's guide last walked the player along (the town ctx's autoWalk)
  let _townAutoWalkAt = -Infinity;
  // A sword swing steps the player forward (into a blocked swing / a missed one) — in Town only
  // while walked along or fighting someone within TOWN_SWING_STEP_RANGE
  const TOWN_SWING_STEP_RANGE = 6;    // m
  const _swingStepAllowed = () => !town?.isActive() || performance.now() - _townAutoWalkAt < 250
    || town.threats(TOWN_SWING_STEP_RANGE).length > 0;
  let _psAutoWalkDir = new THREE.Vector3();
  let _psStageActive = false;
  let _psWinShown = false;
  // Settings open during a single-player stage (Showdown / Classic / tutorial) pauses the game:
  // the game loop only renders. Enemies' timers run on the wall clock, so for a moment after
  // closing the settings they hold their attacks (no wind-up finishing the instant play resumes).
  const PAUSE_RESUME_GRACE_MS = 1500;
  let _gamePaused = false;
  let _pausedAtMs = 0;
  let _pauseGraceUntil = 0;
  const _isSettingsPauseWanted = () => document.body.classList.contains('settings-open')
    && !multiplayer
    && (_psStageActive || !!showdownTutorial?.isActive() || !!town?.isActive());
  // Enemies don't attack the player: dead (body carried off) or just back from a pause
  const _attacksHeld = () => playerDead || _psBossTalking || performance.now() < _pauseGraceUntil;
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
    _psKillHud.classList.toggle('hidden', !visible || _classicMode || _psIsFinalStage(_psStage));
    if (_classicMode) _classicUpdateScore();
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
  const CAM_AIM_PITCH_SPEED = 3;        // 1/s — how fast the camera tilts toward the target's height

  /**
   * Tilt the camera up / down toward a target that stands higher / lower than the player
   * (`pos` = feet, like the player's; level ground → pitch 0). First person looks along the
   * elevation; third person orbits the other way (a raised camera looks down).
   */
  function _aimCameraPitchAt(pos, dt) {
    if (playerControls.cameraTouchId !== null) return; // the player is dragging the camera
    let target = 0;
    if (pos) {
      const horiz = Math.hypot(pos.x - playerModel.position.x, pos.z - playerModel.position.z);
      const elevation = Math.atan2(pos.y - playerModel.position.y, Math.max(0.5, horiz));
      target = playerControls.isFirstPersonView
        ? Math.max(-Math.PI / 3, Math.min(Math.PI / 3, elevation))
        : Math.max(-Math.PI / 6, Math.min(Math.PI / 3, -elevation));
    }
    playerControls.pitch += (target - playerControls.pitch) * Math.min(1, dt * CAM_AIM_PITCH_SPEED);
  }

  /**
   * Closest in-flight enemy bomb or enemy magic blast heading toward the player (bombs: not yet
   * deflected; both: horizontal velocity pointing at the player) — its position, or null.
   * While one exists the camera tracks it and sword / wand enemies hold their attacks.
   */
  function _psFindIncomingThreat() {
    if (!playerModel) return null;
    const pp = playerModel.position;
    let closest = null;
    let closestDist = PS_INCOMING_BOMB_RANGE;
    const consider = (pos, vx, vz) => {
      const dx = pp.x - pos.x;
      const dz = pp.z - pos.z;
      if (vx * dx + vz * dz <= 0) return; // moving away / past the player
      const d = Math.hypot(dx, dz);
      if (d < closestDist) { closestDist = d; closest = pos; }
    };
    const bombs = window._enemyBombs;
    if (Array.isArray(bombs)) {
      for (const b of bombs) {
        if (!b || b.deflected || !b.mesh) continue;
        consider(b.mesh.position, b.vel.x, b.vel.z);
      }
    }
    for (const b of magicBlasts.list()) {
      if (b.side !== 'enemy') continue;
      consider(b.group.position, b.forward.x, b.forward.z);
    }
    return closest;
  }

  // Phone Sword: time-of-day choice ('random', 'day', 'night') and current stage night flag
  let _psTimePref = 'day';   // 'day' | 'night' — set at the village campfire
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
    // (the audio manager's music element: unlocked on the first tap, so a stage started from
    // the phone still gets its song — see AudioManager.getMusicElement)
    if (!_psSongAudio) {
      _psSongAudio = audioManager.getMusicElement();
      audioManager.phoneSwordAudio = _psSongAudio;
    }
    _psSongAudio.pause();
    _psSongAudio.src = `assets/audio/${song}`;
    _psSongAudio.currentTime = 0;
    _psSongAudio.volume = audioManager.musicVolume;
    _psSongAudio.onended = () => { if (_psStageActive) _psPlayNextSong(isNight); };
    audioManager.playMusic();
  };

  const _psStopSong = () => {
    if (_psSongAudio) {
      _psSongAudio.onended = null;
      audioManager.stopMusic();
      _psSongAudio.currentTime = 0;
    }
    _psSongPool = [];
  };

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
  // plus PS_PATH_WATER_PENALTY per sample in water (the sea is flat, but the path should stay
  // on the island), or Infinity if the line leaves the map. Bails early once it exceeds
  // `giveUpAbove`.
  const PS_PATH_CANDIDATES = 24;
  const PS_PATH_SAMPLE_STEP = 1;      // m between height samples
  const PS_PATH_MAX_OK_STEP = 0.35;   // m rise per metre (~19°) — first candidate under this wins
  const PS_PATH_WATER_PENALTY = 0.5;
  const _psPathSteepness = (angle, pathLen, giveUpAbove, origin = playerModel.position) => {
    const ox = origin.x;
    const oz = origin.z;
    const dx = Math.cos(angle);
    const dz = Math.sin(angle);
    let prevY = getTerrainHeight(ox, oz);
    if (!Number.isFinite(prevY)) prevY = origin.y;
    let worst = 0;
    let wet = 0;
    for (let d = PS_PATH_SAMPLE_STEP; d <= pathLen; d += PS_PATH_SAMPLE_STEP) {
      const x = ox + dx * d;
      const z = oz + dz * d;
      const y = getTerrainHeight(x, z);
      if (!Number.isFinite(y)) return Infinity;
      worst = Math.max(worst, Math.abs(y - prevY));
      if (_isOverWater(x, z)) wet += PS_PATH_WATER_PENALTY;
      if (worst + wet > giveUpAbove) return worst + wet;
      prevY = y;
    }
    return worst + wet;
  };

  // Try evenly spaced directions (random order/offset for variety); take the first that is
  // gentle enough, else the flattest one found. (origin: where the path starts, default the player)
  const _psPickPathAngle = (pathLen, origin = playerModel.position) => {
    const offset = Math.random() * Math.PI * 2;
    const order = Array.from({ length: PS_PATH_CANDIDATES }, (_, i) => i)
      .sort(() => Math.random() - 0.5);
    let bestAngle = offset;
    let bestScore = Infinity;
    for (const i of order) {
      const angle = offset + (i / PS_PATH_CANDIDATES) * Math.PI * 2;
      const score = _psPathSteepness(angle, pathLen, bestScore, origin);
      if (score < bestScore) {
        bestScore = score;
        bestAngle = angle;
        if (score <= PS_PATH_MAX_OK_STEP) break;
      }
    }
    return bestAngle;
  };

  const _psPathLength = (stage) => 80 + stage * 3;
  // Showdown stages started from the village: the player walks this far out of the village
  // before the stage's enemies / coins / heart bubbles begin
  const PS_VILLAGE_EXIT_DIST = 25;
  // Hand-authored route of a Showdown stage on the active map (src/map/stageRoutes.js), or null
  const _psRoute = (stage) => (!_classicMode && _activeMapKey ? stageRoute(_activeMapKey, stage) : null);
  // A route's village is walked into after a stage win when it is this close, else teleported to
  const PS_ROUTE_WALK_IN_MAX = 30;
  const _psRouteAngle = (route) => {
    const [a, b] = route.points;
    return b ? Math.atan2(b.z - a.z, b.x - a.x) : null;
  };
  // pathAngle: the direction the village's arrow pointed (else the flattest one from here);
  // lead: metres of empty path before the stage proper (PS_VILLAGE_EXIT_DIST from the village)
  // bossSpot: { position, yaw } where Pemberton stood in the village (PEMBERTON_STAGE)
  const _psBuildStage = (stage, count = _psEnemyCount(stage), pathAngle = null, lead = 0, bossSpot = null) => {
    // The path: the stage's route waypoints (from where the player stands), else a straight
    // line along pathAngle (the flattest direction)
    const route = _psRoute(stage);
    let pathLen;
    let pts;
    if (route && route.points.length >= 2) {
      pts = [{ x: playerModel.position.x, z: playerModel.position.z }, ...route.points.slice(1)];
      const total = createPolyline(pts).length;
      // (a short route: the walk out of the village is a quarter of it at most)
      lead = Math.min(lead, total * 0.25);
      pathLen = Math.max(1, total - lead);
    } else {
      pathLen = _psPathLength(stage);
      if (!Number.isFinite(pathAngle)) pathAngle = _psPickPathAngle(lead + pathLen);
      pts = [
        { x: playerModel.position.x, z: playerModel.position.z },
        {
          x: playerModel.position.x + Math.cos(pathAngle) * (lead + pathLen),
          z: playerModel.position.z + Math.sin(pathAngle) * (lead + pathLen),
        },
      ];
    }
    const path = createPolyline(pts);
    _psPath = path;
    _psPathProgress = 0;
    const _last = pts[pts.length - 1];
    _psPathEnd.set(_last.x, getTerrainHeight(_last.x, _last.z) ?? playerModel.position.y, _last.z);
    const _first = path.at(0);
    _psAutoWalkDir.set(_first.dx, 0, _first.dz);
    // Point `t` (0–1) of the way along the stage proper (after the walk out of the village)
    const _stageAt = (t) => path.at(lead + pathLen * t);
    _psEnemyQueue = [];
    const _charPool = _psEnemyCharacterPool();
    if (!_classicMode && (!_psStageBoss || _psStageBoss.stage !== stage)) _psStageBoss = _psPickBoss(stage);
    if (_psStageBoss) _psStageBoss.spared = false; // (a retry: talks again)
    // The final stage is Pemberton alone, right where he stood (no coins or heart bubbles)
    const _final = _psIsFinalStage(stage);
    if (_final) {
      const _bp = bossSpot?.position?.clone()
        ?? playerModel.position.clone().addScaledVector(_psAutoWalkDir, 6);
      _bp.y = getTerrainHeight(_bp.x, _bp.z) ?? playerModel.position.y;
      _psEnemyQueue.push({
        pos: _bp,
        yaw: bossSpot?.yaw,
        hearts: PEMBERTON_HEARTS,
        triggerDist: 0,
        bombThrower: false,
        characterUrl: MATCH_CHARACTERS.villager.url,
        boss: true,
        pemberton: true,
        nameTag: null,
      });
      count = 1;
    }
    for (let i = 0; i < (_final ? 0 : count); i++) {
      // The last enemy is the stage boss: on the path itself (no scatter), so it comes last
      // (Classic has no bosses)
      const isBoss = !_classicMode && i === count - 1;
      const t = (i + 0.5) / count;
      const { x: baseX, z: baseZ } = _stageAt(t);
      const scatter = isBoss ? 0 : 8;
      const ex = baseX + (Math.random() - 0.5) * scatter;
      const ez = baseZ + (Math.random() - 0.5) * scatter;
      const ey = getTerrainHeight(ex, ez) ?? playerModel.position.y;
      // Bomb throwers: start appearing at stage 3, ~5% chance scaling up slowly with stage
      const _btChance = !_classicMode && stage >= 3 ? Math.min(0.15, 0.05 + (stage - 3) * 0.006) : 0;
      // Wand casters (always wizards): from PS_WAND_ENEMY_FROM_STAGE, a rising share of the swordsmen
      const _wandChance = !_classicMode && stage >= PS_WAND_ENEMY_FROM_STAGE
        ? Math.min(0.25, 0.08 + (stage - PS_WAND_ENEMY_FROM_STAGE) * 0.015) : 0;
      const _bomber = !isBoss && Math.random() < _btChance;
      const _wand = !isBoss && !_bomber && Math.random() < _wandChance;
      const charKey = isBoss ? _psStageBoss.key
        : _wand ? PS_WAND_ENEMY_CHARACTER
        : _charPool[Math.floor(Math.random() * _charPool.length)];
      // (a roam quest's final enemy is Pemberton — _psStageBoss.key 'villager')
      const _roamPemberton = isBoss && !!_psRoamQuest;
      _psEnemyQueue.push({
        pos: new THREE.Vector3(ex, ey, ez),
        hearts: _roamPemberton ? PEMBERTON_HEARTS : isBoss ? _psBossHearts(stage) : _psHeartsForStage(stage),
        triggerDist: lead + pathLen * t - 10,
        bombThrower: _bomber,
        wand: _wand,
        characterUrl: _classicMode ? _classicMiiUrl() : MATCH_CHARACTERS[charKey].url,
        boss: isBoss,
        bossKey: isBoss ? charKey : null,
        pemberton: _roamPemberton,
        nameTag: _classicMode ? _classicName() : null,
      });
    }
    // Load the enemies' characters now (an enemy is only spawned once its model is in — see
    // the queue spawn in the game loop — so none fights without a body)
    _psEnemyQueue.forEach((q) => preloadCharacterModel(q.characterUrl));
    // Spawn coins along the path (none in Classic)
    const coinCount = _classicMode || _final ? 0 : 8 + Math.floor(stage * 0.3);
    for (let ci = 0; ci < coinCount; ci++) {
      const ct = (ci + 0.5) / coinCount;
      const c = _stageAt(ct);
      const cx = c.x + (Math.random() - 0.5) * 6;
      const cz = c.z + (Math.random() - 0.5) * 6;
      spawnCoinPickup(new THREE.Vector3(cx, playerModel.position.y, cz));
    }
    // Heart bubbles around halfway (between 35% and 70% of the path)
    heartBubbles.clear();
    const heartCount = _classicMode || _final ? 0 : _psHeartBubbleCount(stage);
    for (let hi = 0; hi < heartCount; hi++) {
      const ht = heartCount === 1 ? 0.5 : 0.35 + 0.35 * (hi / (heartCount - 1));
      const h = _stageAt(ht);
      const hx = h.x + (Math.random() - 0.5) * 3;
      const hz = h.z + (Math.random() - 0.5) * 3;
      heartBubbles.spawn(new THREE.Vector3(hx, playerModel.position.y, hz));
    }
    // One hidden chest, somewhere between 20% and 85% of the way, off to one side of the path
    // (not in water: a few tries)
    stageChests.clear();
    if (!_classicMode && !_final) {
      const ct = 0.2 + Math.random() * 0.65;
      const c = _stageAt(ct);
      for (let tries = 0; tries < 6; tries++) {
        const side = Math.random() < 0.5 ? -1 : 1;
        const off = PS_CHEST_SIDE_MIN + Math.random() * (PS_CHEST_SIDE_MAX - PS_CHEST_SIDE_MIN);
        // (perpendicular to the path's direction there)
        const cx = c.x - c.dz * side * off;
        const cz = c.z + c.dx * side * off;
        if (_isOverWater(cx, cz) && tries < 5) continue;
        stageChests.spawn(new THREE.Vector3(cx, playerModel.position.y, cz), Math.atan2(c.dz * side, -c.dx * side)); // (front toward the path)
        break;
      }
    }
    comboMeter.reset();
    _psAutoWalking = true;
    _psStageActive = true;
    _psWinShown = false;
    _psStageKills = 0;
    _psStageTotal = count;
    _psUpdateKillHud(true);
    window.hordeEnemies = hordeEnemies;
  };

  // Showdown: "STAGE COMPLETE!" (+ the unlocked character) as a banner over the world — no
  // backdrop — and onDone() straight away (the next village is built ahead, the player walks
  // in under the banner). Classic: the full-screen STAGE CLEAR!, then onDone().
  let _psWinHideTimer = null;
  const _psShowWin = (onDone) => {
    _psWinShown = true;
    _psAutoWalking = false;
    _psStopSong();
    const _banner = !_classicMode;
    _psWinTitle.textContent = _classicMode ? 'STAGE CLEAR!' : 'STAGE COMPLETE!';
    _classicSetPlaying(false);
    const _unlocked = !_classicMode && _psStageBoss?.unlocks ? MATCH_CHARACTERS[_psStageBoss.key] : null;
    _psWinSub.textContent = _unlocked
      ? `${_unlocked.label} ${_psStageBoss.spared ? 'joined you' : 'unlocked'}!`
      : `Stage ${_psStage} Cleared!`;
    // The story's end: Pemberton beaten (unlocks the villager); an open-roam quest done
    if (!_classicMode && _voyage) {
      _psWinTitle.textContent = 'VOYAGE COMPLETE!';
      _psWinSub.textContent = `The ship’s home safe. +${VOYAGE_REWARD} coins`;
    } else if (!_classicMode && _psRoamQuest) {
      _psWinTitle.textContent = 'QUEST COMPLETE!';
      _psWinSub.textContent = `${_psRoamQuest.def.done} +${_psRoamQuest.reward} coins`;
    } else if (!_classicMode && _psStageBoss?.pemberton) {
      _psWinTitle.textContent = 'PEMBERTON DEFEATED!';
      _psWinSub.textContent = `The debts are settled.${_unlocked ? ` ${_unlocked.label} unlocked!` : ''}`;
    }
    // force animation restart
    _psWinTitle.style.animation = 'none';
    _psWinSub.style.animation = 'none';
    _psWinOverlay.classList.toggle('ps-win-banner', _banner);
    _psWinOverlay.classList.remove('hidden');
    void _psWinOverlay.offsetWidth;
    _psWinTitle.style.animation = '';
    _psWinSub.style.animation = '';
    clearTimeout(_psWinHideTimer);
    _psWinHideTimer = setTimeout(() => {
      _psWinOverlay.classList.add('hidden');
      if (!_banner) onDone();
    }, _banner ? 3200 : 2800);
    if (_banner) onDone();
  };

  // Sword Showdown between stages: the village (src/village/villageMode.js) — shop, character
  // pick, sword calibration, time of day, and the villager whose quest starts the stage. Created once
  // the shop (appState) exists; see villageCtx.
  let village = null;
  let deathCarry = null;
  const _psClearDeadEnemies = () => {
    _psClearSpared();
    for (let _di = hordeEnemies.length - 1; _di >= 0; _di--) {
      const _de = hordeEnemies[_di];
      if (_de.isDead) {
        if (_de.group?.parent) _de.group.parent.remove(_de.group);
        try { _de.destroy?.(); } catch (_) {}
        hordeEnemies.splice(_di, 1);
      }
    }
  };
  // Lighting preview for the next stage's time of day
  const _psPreviewTime = () => {
    const mode = _psTimePref === 'night' ? 'night' : 'day';
    lastAutoMode = mode;
    applyPresetForMode(mode);
    applyDisplaySettings();
  };
  let _psVillageStart = null; // onOk of the open village
  // Coins the villager (Pemberton) owes for the last stage's quest — paid at the next talk with
  // him (villageCtx.reward); kept in localStorage `ps_reward_<key>` (guests: this session only)
  const _psRewardLsKey = () => profileNameKey ? `ps_reward_${profileNameKey}` : null;
  let _psRewardOwed = (() => { try { const k = _psRewardLsKey(); return k ? (parseInt(localStorage.getItem(k), 10) || 0) : 0; } catch (_) { return 0; } })();
  const _psSetRewardOwed = (n) => {
    _psRewardOwed = Math.max(0, Math.floor(n) || 0);
    try { const k = _psRewardLsKey(); if (k) localStorage.setItem(k, _psRewardOwed); } catch (_) {}
  };
  // Pemberton says hello in the first village (once per profile: `ps_intro_<key>`)
  const _psIntroLsKey = () => profileNameKey ? `ps_intro_${profileNameKey}` : null;
  let _psIntroSeen = (() => { try { const k = _psIntroLsKey(); return k ? localStorage.getItem(k) === '1' : false; } catch (_) { return false; } })();
  const _psMarkIntroSeen = () => {
    _psIntroSeen = true;
    try { const k = _psIntroLsKey(); if (k) localStorage.setItem(k, '1'); } catch (_) {}
  };
  // After a stage win the village is built this far ahead along the stage path and the
  // player walks in (nearer spots are tried if the ground there is missing / a cliff)
  const PS_VILLAGE_APPROACH_DISTS = [8, 6, 4];
  const _psVillageApproachSpot = () => {
    const dir = new THREE.Vector3(_psAutoWalkDir.x, 0, _psAutoWalkDir.z);
    if (dir.lengthSq() < 1e-6) dir.set(Math.sin(playerControls?.yaw ?? 0), 0, Math.cos(playerControls?.yaw ?? 0));
    dir.normalize();
    const p = playerModel.position;
    for (const d of PS_VILLAGE_APPROACH_DISTS) {
      const x = p.x + dir.x * d;
      const z = p.z + dir.z * d;
      const y = getTerrainHeight(x, z);
      if (Number.isFinite(y) && Math.abs(y - p.y) < d * PS_PATH_MAX_OK_STEP) return new THREE.Vector3(x, y, z);
    }
    return null;
  };
  // No weapon in hand in the village: whatever is held is put away there, and the sword (or the
  // magic wand, if that was out) comes back when the next stage's calibration starts
  // (villageCtx.confirmStart) or the player leaves
  let _villageSheathed = false;
  const _villageSheathe = () => {
    // (mid-roll the weapon is already put away: it stays away and comes back with the stage)
    if (playerRoll?.restoreIds.length) {
      playerRoll.restoreIds = [];
      _villageSheathed = true;
    }
    const held = getEquippedInventoryItemIds();
    if (!held.length) return;
    held.forEach((itemId) => unequipInventoryItem(itemId));
    _villageSheathed = true;
    playerControls?.refreshActionButtons?.();
  };
  const _villageUnsheathe = () => {
    if (!_villageSheathed) return;
    _villageSheathed = false;
    if (!(inventoryState[FOAM_SWORD_ITEM_ID]?.count > 0)) {
      inventoryState[FOAM_SWORD_ITEM_ID] = ensureCatalogEntry(FOAM_SWORD_ITEM_ID, { count: 1 });
    }
    equipInventoryItem(_wandActive && isWandAllowed() ? MAGIC_WAND_ITEM_ID : FOAM_SWORD_ITEM_ID);
    playerControls?.refreshActionButtons?.();
  };
  // approach: build it a little way ahead and walk the player there (after a stage win)
  const _psShowVillage = (stage, onOk, { approach = false } = {}) => {
    magicBlasts.clear();
    thawPlayer();
    const _final = _psIsFinalStage(stage);
    const count = _final ? 1 : _psEnemyCount(stage);
    _psUpdateKillHud(false);
    // A hand-authored route: the village goes at its first point (walked into after a stage
    // win when it is close, else the player is moved there) and faces its first waypoint
    const route = _psRoute(stage);
    let _center = null;
    if (route) {
      const [start] = route.points;
      const p = playerModel.position;
      if (approach && Math.hypot(start.x - p.x, start.z - p.z) <= PS_ROUTE_WALK_IN_MAX) {
        _center = new THREE.Vector3(start.x, getTerrainHeight(start.x, start.z) ?? p.y, start.z);
      } else {
        _teleportPlayer(start.x, start.z);
      }
    } else if (approach) {
      _center = _psVillageApproachSpot();
    }
    // (walking in: the fallen enemies stay until the player gets there)
    if (!_center) _psClearDeadEnemies();
    // Final enemy (picked here so the banner can name it; kept through retries of this stage)
    // (the final stage's is Pemberton — the villager character, unlocked by beating him)
    if (_final) _psStageBoss = { key: 'villager', unlocks: !_psChars.unlocked.includes('villager'), pemberton: true, stage };
    else if (!_psStageBoss || _psStageBoss.pemberton || _psStageBoss.stage !== stage) _psStageBoss = _psPickBoss(stage);
    const _boss = MATCH_CHARACTERS[_psStageBoss.key];
    // Load the next stage's enemy characters while the player is in the village
    [..._psEnemyCharacterPool(), _psStageBoss.key, ...(stage >= PS_WAND_ENEMY_FROM_STAGE ? [PS_WAND_ENEMY_CHARACTER] : [])]
      .forEach((k) => { if (MATCH_CHARACTERS[k]) preloadCharacterModel(MATCH_CHARACTERS[k].url); });
    setPlayerCharacterUrl(playerModel, MATCH_CHARACTERS[_psChars.selected].url);
    _psPreviewTime();
    _villageSheathe();
    _psVillageStart = (pathAngle, extra = {}) => onOk(count, { pathAngle, inPlace: true, bossSpot: extra.bossSpot });
    village?.enter({
      stage,
      count,
      center: _center,
      onArrive: _center ? _psClearDeadEnemies : null,
      pathAngle: (route && _psRouteAngle(route))
        ?? _psPickPathAngle(PS_VILLAGE_EXIT_DIST + _psPathLength(stage), _center ?? playerModel.position),
      boss: _final
        ? `Pemberton (${PEMBERTON_HEARTS} ❤️)`
        : `Final enemy: ${_boss.label} (${_psBossHearts(stage)} ❤️`
          + (stage === SPARED_STAGE ? ')' : ` ${stageBossGearIcons(stage)})`)
          + (_psStageBoss.unlocks && stage !== SPARED_STAGE ? ' — beat it to unlock!' : ''),
      finalBoss: _final,
      intro: stage === 1 && !_psIntroSeen,
    });
  };

  // ── Classic mode: stage screen (banner over the world) and "Ready" / "Go!" ──
  const _classicStageOverlay = document.getElementById('classic-stage-overlay');
  const _classicStageNumberEl = document.getElementById('classic-stage-number');
  const _classicStageNameEl = document.getElementById('classic-stage-name');
  const _classicStageOk = document.getElementById('classic-stage-ok');
  const _classicStageRecalib = document.getElementById('classic-stage-recalib');
  const _classicCallout = document.getElementById('classic-callout');
  const CLASSIC_READY_MS = 1400;  // "Ready" stays up this long, then "Go!"
  const CLASSIC_GO_MS = 900;      // "Go!" fades out after this
  let _classicCalloutTimers = [];
  const _classicClearCallout = () => {
    _classicCalloutTimers.forEach(clearTimeout);
    _classicCalloutTimers = [];
    _classicCallout?.classList.add('hidden');
  };
  const _classicShowCallout = (text) => {
    if (!_classicCallout) return;
    _classicCallout.textContent = text;
    _classicCallout.classList.remove('hidden', 'classic-callout-pop');
    void _classicCallout.offsetWidth;
    _classicCallout.classList.add('classic-callout-pop');
  };
  const _classicReadyGo = (onGo) => {
    _classicClearCallout();
    _classicShowCallout('Ready');
    _classicCalloutTimers.push(setTimeout(() => {
      _classicShowCallout('Go!');
      audioManager?.playSFX?.('SFX/Attacks/Sword Attacks Hits and Blocks/Sword Impact Hit 3.ogg', 0.5);
      onGo();
      _classicCalloutTimers.push(setTimeout(_classicClearCallout, CLASSIC_GO_MS));
    }, CLASSIC_READY_MS));
  };
  const _classicShowStageOverlay = (stage, onOk) => {
    const count = _psEnemyCount(stage);
    _classicSetPlaying(false);
    _classicClearCallout();
    _psUpdateKillHud(false);
    if (_classicStageNumberEl) _classicStageNumberEl.textContent = `Stage ${stage}`;
    if (_classicStageNameEl) _classicStageNameEl.textContent = _classicStageName(stage);
    setPlayerCharacterUrl(playerModel, glbCharacterConfig.mii1Url);
    _classicStageOk.onclick = () => {
      _classicStageOverlay.classList.add('hidden');
      _classicCountdown = true;
      onOk(count);
      _classicUpdateScore();
      _classicSetPlaying(true);
      _classicReadyGo(() => { _classicCountdown = false; });
    };
    if (_classicStageRecalib) {
      _classicStageRecalib.onclick = () => {
        window.phoneSwordRecalibrate?.();
        _classicStageRecalib.textContent = 'Calibrated!';
        setTimeout(() => { _classicStageRecalib.textContent = 'Recalibrate Sword'; }, 1500);
      };
    }
    // Replay the banner's slide-in
    _classicStageOverlay.classList.add('hidden');
    void _classicStageOverlay.offsetWidth;
    _classicStageOverlay.classList.remove('hidden');
  };
  // ── Open roam: ⛵ Explore the Seas — a voyage on the pirate ship ──
  // By the pirate ship (the active map's floating prop with a `deck` — MAPS) roam shows
  // ⛵ Explore the Seas (villageMode's extraAct): the ship sails a loop out to sea and back
  // (_voyagePickRoute — open water all the way), carrying whoever is aboard (_voyageCarry),
  // and the player can't leave the deck until it's over (playerControls.positionConstraint).
  // On the way frog men climb up the hull in waves (_voyageSpawnBoarder / _voyageClimbStep)
  // and fight on deck; one knocked overboard climbs back up. Back at anchor with all of them
  // beaten: VOYAGE COMPLETE!, VOYAGE_REWARD coins, back to roam on the deck. Dying: back to roam
  // on the ship, at anchor again.
  const VOYAGE_ACT_DIST = 16;        // m from the ship's middle: the button shows
  const VOYAGE_OUT_DIST = 100;       // m out to sea (the loop's length)…
  const VOYAGE_HALF_WIDTH = 24;      // …and half its width
  const VOYAGE_SPEED = 2.6;          // m/s at full sail
  const VOYAGE_RAMP_S = 6;           // s to full sail (and to slow down coming home)
  const VOYAGE_TURN_RATE = 0.35;     // rad/s the ship turns at most
  const VOYAGE_MIN_DEPTH = 1.5;      // m of water the route needs (the hull's width either side too)
  const VOYAGE_WAVES = [0.06, 0.28, 0.5, 0.72]; // fraction of the loop sailed when a wave climbs aboard…
  const VOYAGE_WAVE_SHARE = [0.16, 0.22, 0.28, 0.34]; // …and its share of the boarders
  const VOYAGE_SPAWN_GAP_MS = 1400;  // between boarders of a wave
  const VOYAGE_MAX_ABOARD = 5;       // living boarders at once (the rest wait their turn)
  const VOYAGE_CLIMB_S = 2.4;        // s up the hull…
  const VOYAGE_HOP_S = 0.4;          // …and over the rail
  const VOYAGE_OVERBOARD = 0.6;      // m past the deck's edge: knocked overboard (climbs back up)
  const VOYAGE_REWARD = 120;
  const VOYAGE_BOARDER_URL = glbCharacterConfig.frogManUrl;
  let _voyage = null; // { ship, route, theta, speed, phase: sail / dock / docked, wave, waveSizes, toSpawn, nextSpawnAt }
  const _voyageShip = () => _activeMap?.ship ?? null;
  const _voyageV = new THREE.Vector3();
  const _voyageV2 = new THREE.Vector3();
  const _voyageM0 = new THREE.Matrix4();
  const _voyageMd = new THREE.Matrix4();
  // Ship-local (holder space: model units, up = +Y, bow toward −X) ↔ world
  const _shipToWorld = (ship, x, y, z, out = new THREE.Vector3()) => ship.holder.localToWorld(out.set(x, y, z));
  const _shipToLocal = (ship, p, out = new THREE.Vector3()) => ship.holder.worldToLocal(out.copy(p));
  const _shipMiddle = (ship) => _shipToWorld(ship, (ship.deck.minX + ship.deck.maxX) / 2, 0, 0);
  // Where the player stands on the deck (start / back after dying)
  const _voyageDeckSpot = (ship) => {
    const p = _shipToWorld(ship, (ship.deck.minX + ship.deck.maxX) / 2 + 0.6, 0, 0.5);
    return { x: p.x, z: p.z };
  };
  const _voyageOnDeck = (ship, p) => {
    const l = _shipToLocal(ship, p, _voyageV);
    const { minX, maxX, halfWidth } = ship.deck;
    return l.y > 0.2 && l.x > minX - 0.3 && l.x < maxX + 0.3 && Math.abs(l.z) < halfWidth + 0.3;
  };
  // A world heading (unit xz) → the holder's yaw (its bow is local −X)
  const _shipYawFor = (hx, hz) => Math.atan2(hz, -hx);
  const _voyageDeepAt = (x, z) => {
    const level = _activeMap?.water?.(x, z);
    if (level == null) return false;
    const ground = _glbResolveHeight(x, z);
    return !Number.isFinite(ground) || level - ground >= VOYAGE_MIN_DEPTH;
  };
  // The loop: an ellipse from the anchor A and back, its long axis `d` out to sea, going round
  // toward side s — P(θ) = C + d·a·cos θ + n·b·sin θ (n = s·d⊥, C = A + d·a), θ from π to 3π
  const _voyageLoop = (A, d, s, a, b) => {
    const n = { x: -d.z * s, z: d.x * s };
    const C = { x: A.x + d.x * a, z: A.z + d.z * a };
    return {
      at: (th) => ({
        x: C.x + d.x * a * Math.cos(th) + n.x * b * Math.sin(th),
        z: C.z + d.z * a * Math.cos(th) + n.z * b * Math.sin(th),
      }),
      tangent: (th) => ({
        x: -d.x * a * Math.sin(th) + n.x * b * Math.cos(th),
        z: -d.z * a * Math.sin(th) + n.z * b * Math.cos(th),
      }),
    };
  };
  // Out away from the island if the water allows (else turned further round, or a smaller
  // loop), going round the way the bow already points; null: no open water for it
  const _voyagePickRoute = (ship) => {
    const A = ship.holder.getWorldPosition(new THREE.Vector3());
    const spawn = MAPS[_activeMapKey]?.spawn ?? { x: 0, z: 0 };
    const away = Math.atan2(A.z - spawn.z, A.x - spawn.x);
    const bow = { x: -Math.cos(ship.anchor.yaw), z: Math.sin(ship.anchor.yaw) };
    for (const size of [1, 0.75, 0.5]) {
      const a = (VOYAGE_OUT_DIST / 2) * size;
      const b = VOYAGE_HALF_WIDTH * size;
      let best = null;
      for (const off of [0, 0.35, -0.35, 0.7, -0.7, 1.05, -1.05, 1.4, -1.4]) {
        const d = { x: Math.cos(away + off), z: Math.sin(away + off) };
        for (const s of [1, -1]) {
          const loop = _voyageLoop(A, d, s, a, b);
          let ok = true;
          for (let i = 1; i < 64 && ok; i++) {
            const th = Math.PI + (i / 64) * Math.PI * 2;
            const p = loop.at(th);
            if (Math.hypot(p.x - A.x, p.z - A.z) < 8) continue; // (where it's anchored already)
            const t = loop.tangent(th);
            const tl = Math.hypot(t.x, t.z) || 1;
            for (const side of [-5, 0, 5]) {
              if (!_voyageDeepAt(p.x - (t.z / tl) * side, p.z + (t.x / tl) * side)) { ok = false; break; }
            }
          }
          if (!ok) continue;
          const t0 = loop.tangent(Math.PI);
          const score = (t0.x * bow.x + t0.z * bow.z) / (Math.hypot(t0.x, t0.z) || 1) - Math.abs(off) * 0.3;
          if (!best || score > best.score) best = { loop, score };
        }
      }
      if (best) return best;
    }
    return null;
  };
  // The roam button (null: not by the ship)
  const _voyageAct = () => {
    const ship = _voyageShip();
    if (!ship || _voyage || playerDead) return null;
    const m = _shipMiddle(ship);
    if (Math.hypot(m.x - playerModel.position.x, m.z - playerModel.position.z) > VOYAGE_ACT_DIST) return null;
    return { label: 'Explore the Seas', onClick: _voyageStart };
  };
  const _voyageStart = () => {
    if (_voyage) return;
    _villageUnsheathe();
    _requireSwordCalibration(_voyageBegin);
  };
  const _voyageBegin = () => {
    const ship = _voyageShip();
    if (!ship || _voyage || !village?.isOpen()) return;
    const route = _voyagePickRoute(ship);
    if (!route) {
      showPickupToast('coins', 1, '', { text: 'No open water to sail today' });
      _villageSheathe();
      return;
    }
    village.exit();
    _psRoamQuest = null;
    _psStageBoss = null;
    magicBlasts.clear();
    thawPlayer();
    _psClearDeadEnemies();
    _psEnemyQueue = [];
    _psPath = null;
    _psAutoWalking = false;
    // All aboard (by the ship, not on it yet: onto the deck)
    if (!_voyageOnDeck(ship, playerModel.position)) {
      const p = _voyageDeckSpot(ship);
      _teleportPlayer(p.x, p.z);
    }
    const total = Math.max(12, Math.min(30, Math.round(_psEnemyCount(_psStage) * 0.6)));
    const waveSizes = VOYAGE_WAVE_SHARE.map((f) => Math.round(total * f));
    waveSizes[waveSizes.length - 1] += total - waveSizes.reduce((n, k) => n + k, 0);
    _voyage = {
      ship, route, theta: Math.PI, speed: 0, phase: 'sail',
      wave: 0, waveSizes, toSpawn: 0, nextSpawnAt: 0,
    };
    preloadCharacterModel(VOYAGE_BOARDER_URL);
    playerControls.positionConstraint = _voyageConstrainPlayer;
    _psStageKills = 0;
    _psStageTotal = total;
    _psStageActive = true;
    _psWinShown = false;
    _psUpdateKillHud(true);
    comboMeter.reset();
    _psCurrentIsNight = _psTimePref === 'night';
    _psSongPool = [];
    _psStopSong();
    _psPlayNextSong(_psCurrentIsNight);
    showPickupToast('coins', 1, '', { text: 'Anchors aweigh! Hold the deck till we’re home' });
  };
  // Back to how it was: anchored, nobody kept aboard
  const _voyageEnd = () => {
    const v = _voyage;
    if (!v) return;
    _voyage = null;
    if (playerControls?.positionConstraint === _voyageConstrainPlayer) playerControls.positionConstraint = null;
    const { ship } = v;
    ship.holder.position.copy(ship.anchor.position);
    ship.holder.rotation.y = ship.anchor.yaw;
    ship.holder.updateMatrixWorld(true);
    ship.box.setFromObject(ship.model).expandByScalar(0.5);
    for (const e of hordeEnemies) {
      if (e._voyageClimb) e.onAfterUpdate = null;
      e._voyageClimb = null;
    }
  };
  // (playerControls.positionConstraint) Never off the deck while it sails
  function _voyageConstrainPlayer(c) {
    const ship = _voyage?.ship;
    if (!ship) return;
    const l = _shipToLocal(ship, _voyageV2.set(c.playerX, c.playerY, c.playerZ), _voyageV2);
    const { minX, maxX, halfWidth } = ship.deck;
    const x = THREE.MathUtils.clamp(l.x, minX, maxX);
    const z = THREE.MathUtils.clamp(l.z, -halfWidth, halfWidth);
    if (x === l.x && z === l.z) return;
    ship.holder.localToWorld(l.set(x, l.y, z));
    c.playerX = l.x;
    c.playerZ = l.z;
  }
  // The ship moved by Md (turned by dYaw): everyone aboard moves with it
  const _voyageCarry = (Md, dYaw) => {
    const px = Number.isFinite(playerControls.playerX) ? playerControls.playerX : playerModel.position.x;
    const pz = Number.isFinite(playerControls.playerZ) ? playerControls.playerZ : playerModel.position.z;
    const p = _voyageV.set(px, playerModel.position.y, pz).applyMatrix4(Md);
    playerControls.playerX = p.x;
    playerControls.playerZ = p.z;
    playerModel.position.x = p.x;
    playerModel.position.z = p.z;
    playerControls.yaw += dYaw;
    for (const e of hordeEnemies) {
      if (!e.rigidBody) continue;
      const t = e.rigidBody.translation();
      const q = _voyageV.set(t.x, t.y, t.z).applyMatrix4(Md);
      e.rigidBody.setTranslation({ x: q.x, y: t.y, z: q.z }, true);
      e.group.position.x = q.x;
      e.group.position.z = q.z;
      e.group.rotation.y += dYaw;
    }
  };
  // A frog man climbs up the hull at a random spot on either side
  const _voyageSpawnBoarder = (v) => {
    const { ship } = v;
    const { minX, maxX } = ship.deck;
    const lx = minX + 0.4 + Math.random() * (maxX - minX - 0.8);
    const side = Math.random() < 0.5 ? 1 : -1;
    const start = _shipToWorld(ship, lx, 0, side * (ship.deck.halfWidth + 0.8));
    const enemy = _spawnHordeEnemy({
      position: start, hearts: _psHeartsForStage(_psStage), speedScale: PS_ENEMY_SPEED,
      characterUrl: VOYAGE_BOARDER_URL,
    });
    _voyageStartClimb(enemy, lx, side);
  };
  // Climbing: passive (no attack slot), held to the hull (onAfterUpdate has the last word)
  const _voyageStartClimb = (enemy, lx, side) => {
    enemy._voyageClimb = { lx, side, t: 0 };
    enemy.stationary = true;
    enemy.script = { mode: 'passive' };
    enemy.onAfterUpdate = (dt) => _voyageClimbStep(enemy, dt);
  };
  const _voyageEndClimb = (enemy) => {
    enemy._voyageClimb = null;
    enemy.stationary = false;
    enemy.script = null;
    enemy.onAfterUpdate = null;
  };
  const _voyageClimbStep = (enemy, dt) => {
    const c = enemy._voyageClimb;
    const ship = _voyage?.ship;
    if (!c || !ship) return;
    // (knocked off the hull: it climbs again once it's up — _voyageUpdate)
    if (enemy.isDead || enemy._isRagdoll) { _voyageEndClimb(enemy); return; }
    c.t += dt || 0;
    const hw = ship.deck.halfWidth;
    const land = _shipToWorld(ship, c.lx, 0, c.side * (hw - 0.2));
    const deckY = getTerrainHeight(land.x, land.z);
    const waterY = _shipToWorld(ship, c.lx, 0, 0, _voyageV2).y - 0.5;
    let lz;
    let y;
    if (c.t < VOYAGE_CLIMB_S) {
      // Hand over hand up the hull
      const u = c.t / VOYAGE_CLIMB_S;
      lz = c.side * (hw + 0.8 - 0.25 * u);
      y = THREE.MathUtils.lerp(waterY, deckY + 0.35, u * u * (3 - 2 * u)) + Math.sin(u * Math.PI * 6) * 0.05;
    } else if (c.t < VOYAGE_CLIMB_S + VOYAGE_HOP_S) {
      // Over the rail
      const h = (c.t - VOYAGE_CLIMB_S) / VOYAGE_HOP_S;
      lz = c.side * THREE.MathUtils.lerp(hw + 0.55, hw - 0.2, h);
      y = THREE.MathUtils.lerp(deckY + 0.35, deckY, h) + Math.sin(h * Math.PI) * 0.35;
    } else {
      enemy.rigidBody?.setTranslation({ x: land.x, y: enemy.rigidBody.translation().y, z: land.z }, true);
      enemy.group.position.copy(land).setY(deckY);
      _voyageEndClimb(enemy);
      return;
    }
    const p = _shipToWorld(ship, c.lx, 0, lz);
    enemy.rigidBody?.setTranslation({ x: p.x, y: enemy.rigidBody.translation().y, z: p.z }, true);
    enemy.rigidBody?.setLinvel({ x: 0, y: 0, z: 0 }, true);
    enemy.group.position.set(p.x, y, p.z);
    // (facing the hull)
    const inward = _shipToWorld(ship, c.lx, 0, 0, _voyageV2).sub(p);
    enemy.group.rotation.y = Math.atan2(inward.x, inward.z);
  };
  // Every frame before the player controls: sail, carry, keep the boarders aboard, waves, the end
  const _voyageUpdate = (dt) => {
    const v = _voyage;
    if (!v) return;
    const { ship, route } = v;
    const holder = ship.holder;
    // Sailing (the ship waits while the player is down)
    if (!playerDead && v.phase !== 'docked') {
      holder.updateMatrixWorld(true);
      _voyageM0.copy(holder.matrixWorld);
      const yaw0 = holder.rotation.y;
      let targetYaw = ship.anchor.yaw; // (dock: turned back the way it was anchored)
      if (v.phase === 'sail') {
        const tan = route.loop.tangent(v.theta);
        const tl = Math.hypot(tan.x, tan.z) || 1;
        // Up to full sail, slowing down for home
        const remain = (3 * Math.PI - v.theta) * tl;
        const brake = (VOYAGE_SPEED * VOYAGE_RAMP_S) / 2;
        v.speed = Math.min(v.speed + (VOYAGE_SPEED / VOYAGE_RAMP_S) * dt, VOYAGE_SPEED,
          Math.max(0.5, VOYAGE_SPEED * Math.sqrt(remain / brake)));
        v.theta = Math.min(3 * Math.PI, v.theta + (v.speed * dt) / tl);
        const p = route.loop.at(v.theta);
        holder.parent.worldToLocal(_voyageV.set(p.x, 0, p.z));
        holder.position.x = _voyageV.x;
        holder.position.z = _voyageV.z;
        targetYaw = _shipYawFor(tan.x / tl, tan.z / tl);
        if (v.theta >= 3 * Math.PI) {
          v.phase = 'dock';
          holder.position.x = ship.anchor.position.x;
          holder.position.z = ship.anchor.position.z;
        }
      }
      const dy = Math.atan2(Math.sin(targetYaw - yaw0), Math.cos(targetYaw - yaw0));
      holder.rotation.y = yaw0 + THREE.MathUtils.clamp(dy, -VOYAGE_TURN_RATE * dt, VOYAGE_TURN_RATE * dt);
      if (v.phase === 'dock' && Math.abs(dy) < 0.01) {
        holder.rotation.y = ship.anchor.yaw;
        v.phase = 'docked';
      }
      holder.updateMatrixWorld(true);
      _voyageMd.copy(holder.matrixWorld).multiply(_voyageM0.invert());
      _voyageCarry(_voyageMd, holder.rotation.y - yaw0);
      ship.box.setFromObject(ship.model).expandByScalar(0.5);
    }
    // Boarders on deck stay on it; one thrown overboard climbs back up
    const { minX, maxX, halfWidth } = ship.deck;
    for (const e of hordeEnemies) {
      if (e.isDead || e._voyageClimb || e._isRagdoll || !e.rigidBody) continue;
      const t = e.rigidBody.translation();
      const l = _shipToLocal(ship, _voyageV.set(t.x, 0, t.z), _voyageV);
      const x = THREE.MathUtils.clamp(l.x, minX, maxX);
      const z = THREE.MathUtils.clamp(l.z, -halfWidth, halfWidth);
      if (x === l.x && z === l.z) continue;
      if (Math.hypot(l.x - x, l.z - z) > VOYAGE_OVERBOARD) {
        _voyageStartClimb(e, x, l.z === z ? (Math.random() < 0.5 ? 1 : -1) : Math.sign(l.z));
        continue;
      }
      ship.holder.localToWorld(l.set(x, 0, z));
      e.rigidBody.setTranslation({ x: l.x, y: t.y, z: l.z }, true);
    }
    // Waves: they come up the hull as the ship gets further round
    const frac = (v.theta - Math.PI) / (2 * Math.PI);
    while (v.wave < VOYAGE_WAVES.length && frac >= VOYAGE_WAVES[v.wave]) {
      v.toSpawn += v.waveSizes[v.wave];
      v.wave += 1;
    }
    const now = performance.now();
    if (v.toSpawn > 0 && !playerDead && !_psWinShown && now >= v.nextSpawnAt
      && hordeEnemies.filter((e) => !e.isDead).length < VOYAGE_MAX_ABOARD
      && isCharacterModelSettled(VOYAGE_BOARDER_URL)) {
      v.toSpawn -= 1;
      v.nextSpawnAt = now + VOYAGE_SPAWN_GAP_MS;
      _voyageSpawnBoarder(v);
    }
    // Home with the deck cleared: done
    if (v.phase === 'docked' && v.toSpawn === 0 && v.wave >= VOYAGE_WAVES.length && !_psWinShown && !playerDead
      && hordeEnemies.every((e) => e.isDead)) {
      _psStageActive = false;
      _psWinShown = true;
      comboMeter.end();
      addPlayerXp(getSwordShowdownStageXp(_psStage));
      _spawnRewardCoins(VOYAGE_REWARD);
      setStat('health', statsState.maxHealthSegments);
      _psShowWin(() => {
        _voyageEnd();
        _psEnterRoam();
      });
    }
  };


  // ── Showdown after the story: open roam ──
  // Once Pemberton is beaten (PEMBERTON_STAGE won) Showdown is open roam: the player walks the
  // island freely (village.enterRoam), and the village at each story stage's start has that
  // stage's old boss in it with a quest (ROAM_QUESTS in stageBoss.js) — the stage again, with
  // Pemberton as its final enemy. Dying or finishing it goes back to roam (dying: at the quest's
  // village; finishing: where it ended, the pay popping up around the player).
  const _psStoryDone = () => !_classicMode && Math.max(_psStage, _psStats.highestStage || 0) > PEMBERTON_STAGE;
  let _psRoamQuest = null; // { stage, def (its ROAM_QUESTS entry), spot, reward } while its stage runs
  // Roam quests done at least once (their giver shows 🔁 instead of ❗): localStorage `ps_roam_done_<key>`
  const _psRoamDoneLsKey = () => profileNameKey ? `ps_roam_done_${profileNameKey}` : null;
  const _psRoamDone = new Set((() => {
    try { const k = _psRoamDoneLsKey(); return k ? JSON.parse(localStorage.getItem(k) || '[]') : []; } catch (_) { return []; }
  })());
  const _psMarkRoamDone = (stage) => {
    _psRoamDone.add(stage);
    try { const k = _psRoamDoneLsKey(); if (k) localStorage.setItem(k, JSON.stringify([..._psRoamDone])); } catch (_) {}
  };
  // A village per quest (at its stage route's first point; a stage without a route has none)
  const _psRoamSpots = () => ROAM_QUESTS.map((q) => {
    const route = _psRoute(q.stage);
    const giver = MATCH_CHARACTERS[q.char];
    if (!route || route.points.length < 2 || !giver) return null;
    const reward = roamQuestReward(q.stage);
    return {
      stage: q.stage,
      center: { x: route.points[0].x, z: route.points[0].z },
      pathAngle: _psRouteAngle(route),
      count: _psEnemyCount(q.stage),
      boss: `Final enemy: Pemberton (${PEMBERTON_HEARTS} ❤️)`,
      bannerTitle: 'QUEST',
      giverUrl: giver.url,
      def: q,
      quest: {
        speaker: q.name, emoji: giver.emoji, title: q.title, place: villagePlace(q.stage),
        lines: q.lines, accept: q.accept, reward,
        payLine: 'Do it and there’s {reward} coins in it for you.',
        giverKey: q.char, done: _psRoamDone.has(q.stage),
      },
    };
  }).filter(Boolean);
  // at: { x, z } to put the player first (null: where they are)
  const _psEnterRoam = ({ at = null } = {}) => {
    _psRoamQuest = null;
    magicBlasts.clear();
    thawPlayer();
    _psUpdateKillHud(false);
    _psClearDeadEnemies();
    _psStageBoss = null;
    _psStageActive = false;
    _psAutoWalking = false;
    const spots = _psRoamSpots();
    if (at) {
      // (facing that village's way)
      const spot = spots.find((sp) => sp.center.x === at.x && sp.center.z === at.z);
      _teleportPlayer(at.x, at.z, spot ? Math.atan2(Math.cos(spot.pathAngle), Math.sin(spot.pathAngle)) : undefined);
    }
    setPlayerCharacterUrl(playerModel, MATCH_CHARACTERS[_psChars.selected].url);
    _psPreviewTime();
    _villageSheathe();
    // (a story-era quest's pay still owed: handed over now — nobody's left to pay it at a talk)
    if (_psRewardOwed > 0) {
      const owed = _psRewardOwed;
      _psSetRewardOwed(0);
      _spawnRewardCoins(owed);
    }
    village?.enterRoam({ title: 'Free Roam', spots, onStart: _psStartRoamQuest, extraAct: _voyageAct });
  };
  // A roam village's quest accepted (after the sword calibration): its stage, from right there
  const _psStartRoamQuest = (spot, pathAngle) => {
    _psRoamQuest = { stage: spot.stage, def: spot.def, spot, reward: spot.quest.reward };
    _psStageBoss = { key: 'villager', unlocks: false, pemberton: true, roam: true, stage: spot.stage };
    _psStartStage(spot.stage, spot.count, { pathAngle, inPlace: true });
  };

  // Stage screen for the current mode (Showdown after the story: open roam)
  // (opts: _psShowVillage's, e.g. { approach } after a win; roamAt: where roam puts the player)
  const _psShowStageScreen = (stage, onOk, opts) => (_classicMode
    ? _classicShowStageOverlay(stage, onOk)
    : _psStoryDone() ? _psEnterRoam({ at: opts?.roamAt ?? null })
    : _psShowVillage(stage, onOk, opts));

  // inPlace: start where the player stands (the village) instead of a random spot nearby;
  // pathAngle: the stage's direction (the village path, where the villager stands)
  const _psStartStage = (stage, count, { pathAngle = null, inPlace = false, bossSpot = null } = {}) => {
    // Never begin a stage dead (e.g. health 0 left over from a previous game)
    if (playerDead || statsState.health <= 0) {
      hideGameOver();
      respawnPlayer();
    }
    // Classic: every stage starts with all its hearts
    if (_classicMode) setStat('health', CLASSIC_HEARTS, { skipSave: true });
    magicBlasts.clear();
    thawPlayer();
    // Determine day/night for this stage (Classic is always daytime)
    if (_classicMode) {
      _psCurrentIsNight = false;
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

    // Respawn player at a random location (not from the village: the stage starts right there)
    if (!inPlace) {
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
    }
    // Clear any dead enemies left over from the previous stage
    _psClearDeadEnemies();

    _psBuildStage(stage, count, pathAngle,
      inPlace && !_classicMode && !_psIsFinalStage(stage) ? PS_VILLAGE_EXIT_DIST : 0, bossSpot);
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
    _psClearSpared();
    _psCloseBossTalk();
    playerBombs?.clear();
    heartBubbles.clear();
    stageChests.clear();
    comboMeter.reset();
    _psEnemyQueue = [];
    _psAutoWalking = false;
    _psStageActive = false;
    _psWinShown = false;
    // (a voyage: back to roam on the ship, at anchor again)
    if (_voyage) {
      const ship = _voyage.ship;
      _voyageEnd();
      _psEnterRoam({ at: _voyageDeckSpot(ship) });
      return;
    }
    _psShowStageScreen(_psStage, (count, opts) => _psStartStage(_psStage, count, opts),
      { roamAt: _psRoamQuest?.spot.center ?? null });
  };

  window.hordeEnemies = hordeEnemies;
  // Hide hunger and magic bars in phone sword mode
  const _psHungerBar = document.getElementById('hunger-bar');
  const _psMagicBar = document.getElementById('magic-bar');
  if (_psHungerBar) _psHungerBar.style.display = 'none';
  if (_psMagicBar) _psMagicBar.style.display = 'none';
  const _psInit = async () => {
    _psStage = _psSavedStage(); // (Classic shares _psStage while it runs)
    // Load PS stats and stage from Firebase (falls back gracefully)
    if (profileNameKey) {
      try {
        const [fbStats, fbStage, fbChars] = await Promise.all([
          loadPhoneSwordStats(profileNameKey),
          loadPhoneSwordStage(profileNameKey),
          loadShowdownCharacters(profileNameKey)
        ]);
        // (Only ever grows: keep the higher of Firebase and this session, e.g. another device)
        _psStats = {
          kills: Math.max(fbStats.kills, _psStats.kills),
          deaths: Math.max(fbStats.deaths, _psStats.deaths),
          highestStage: Math.max(fbStats.highestStage, _psStats.highestStage)
        };
        // Characters: union of Firebase + localStorage unlocks; local pick wins
        // (each side normalised first, so an old save's free frog man is dropped before the union)
        const localChars = _psLoadLocalChars();
        const remoteChars = _psNormalizeChars(fbChars);
        _psChars = _psNormalizeChars({
          unlocked: [...localChars.unlocked, ...remoteChars.unlocked],
          selected: localChars.selected !== PS_START_CHARACTERS[0] ? localChars.selected : remoteChars.selected
        });
        // Use whichever is higher: Firebase stage or localStorage
        const lsStage = _psSavedStage();
        _psStage = Math.max(fbStage, lsStage);
        _psStats.highestStage = Math.max(_psStats.highestStage, _psStage);
        // Sync localStorage to Firebase value
        try { const k = _psStageLsKey(); if (k) localStorage.setItem(k, _psStage); } catch (_) {}
      } catch (_) { /* keep localStorage value */ }
    }
    // (after the story: open roam, starting in the first village)
    if (_psStoryDone()) _psEnterRoam({ at: _psRoamSpots()[0]?.center ?? null });
    else _psShowVillage(_psStage, (count, opts) => _psStartStage(_psStage, count, opts));
  };

  // ── Phone Sword: gyroscope receiver via PeerJS ─────────────────────────────
  window.phoneSwordGyro = { alpha: null, beta: null, gamma: null, connected: false, blocking: false, localDevice: false };
  // Calibration: these are the "neutral" angles subtracted from live readings
  // yawDrift (radians) = yaw correction learned by the auto-recentre in the gyro loop;
  // calibratedAt (s, performance.now) = time of the last manual calibration.
  window.phoneSwordCalib = { alpha: 0, beta: 0, gamma: 0, yawDrift: 0, calibratedAt: performance.now() / 1000 };
  const _resetSwordCalibDrift = () => {
    window.phoneSwordCalib.yawDrift = 0;
    window.phoneSwordCalib.calibratedAt = performance.now() / 1000;
  };
  // Config: additional rotation offsets (degrees) applied on top of gyro delta
  window.phoneSwordConfig = { offsetX: 90, offsetY: 180, offsetZ: 0 };
  const _loadSwordSensitivity = (key, fallback) => {
    try {
      const saved = parseFloat(localStorage.getItem(key));
      if (Number.isFinite(saved) && saved > 0) return saved;
    } catch (_) { /* storage unavailable — keep the default */ }
    return fallback;
  };
  window.phoneSwordLocalSensitivity = _loadSwordSensitivity('sq:swordLocalSensitivity', PHONE_SWORD_LOCAL_SENSITIVITY_DEFAULT);
  window.phoneSwordPhoneSensitivity = _loadSwordSensitivity('sq:swordPhoneSensitivity', PHONE_SWORD_PHONE_SENSITIVITY_DEFAULT);

  // Recalibrate: snapshot current gyro as neutral AND clear cached base quaternions
  // so the gyro loop re-initializes them cleanly from the weapon's _holdRotation.
  // (performance.now ms of the last manual calibration — the stage-start popup is skipped
  // while it is fresher than SWORD_CALIB_FRESH_MS)
  let _swordCalibratedAtMs = -Infinity;
  window.phoneSwordRecalibrate = () => {
    _swordCalibratedAtMs = performance.now();
    const g = window.phoneSwordGyro;
    if (g.alpha !== null) window.phoneSwordCalib.alpha = g.alpha;
    if (g.beta !== null) window.phoneSwordCalib.beta = g.beta;
    if (g.gamma !== null) window.phoneSwordCalib.gamma = g.gamma;
    _resetSwordCalibDrift();
    // Gun / shield gyro aim: the current pose becomes its neutral too (re-captured next frame)
    _stopWeaponGyroAim();
    // (and the broom's rest)
    _broomGyro.needRest = true;
  };

  // Gun / shield aim from the phone gyro (sword or "Use This Device"). Neutral = the phone
  // pose when the weapon was picked up (or the sword was recalibrated). The rotation since
  // then is taken in that pose's game frame (same quaternion math as the sword, so it never
  // flips with the phone's heading): its twist about game Y turns the aim left/right — an
  // amplified offset right away, plus a continuous turn while the phone stays turned past
  // the dead zone (hold it right to spin round) — and the tilt of the forward axis aims
  // up/down (amplified; tip the phone's back/top up = aim up).
  const WEAPON_AIM_YAW_GAIN = 2.2;
  const WEAPON_AIM_YAW_OFFSET_MAX = THREE.MathUtils.degToRad(45);
  const WEAPON_AIM_TURN_DEADZONE = THREE.MathUtils.degToRad(8);
  const WEAPON_AIM_TURN_RATE = 7;        // rad/s of turn per radian past the dead zone
  const WEAPON_AIM_TURN_RATE_MAX = 4.5;  // rad/s
  const WEAPON_AIM_PITCH_GAIN = 2.6;
  const WEAPON_AIM_PITCH_MIN = THREE.MathUtils.degToRad(-50);
  const WEAPON_AIM_PITCH_MAX = THREE.MathUtils.degToRad(65);
  const WEAPON_AIM_SMOOTH = 18;          // 1/s — takes the edge off amplified sensor noise
  const _weaponAim = {
    active: false,
    neutralQ: new THREE.Quaternion(),
    earthToGameQ: new THREE.Quaternion(),
    baseYaw: 0,
    lastYaw: 0,
    phoneYaw: 0,
    phonePitch: 0,
  };
  const _weaponAimDevQ = new THREE.Quaternion();
  const _weaponAimRelQ = new THREE.Quaternion();
  const _weaponAimTmpQ = new THREE.Quaternion();
  const _weaponAimV = new THREE.Vector3();
  const _stopWeaponGyroAim = () => {
    _weaponAim.active = false;
    if (playerControls) playerControls.weaponAimPitch = null;
  };
  const _updateWeaponGyroAim = (dt) => {
    const g = window.phoneSwordGyro;
    const holding = !!playerControls && (pistol?.holder === playerControls || shield?.holder === playerControls);
    if (!holding || playerDead || !g?.connected || !Number.isFinite(g.beta) || !Number.isFinite(g.gamma)) {
      if (_weaponAim.active) _stopWeaponGyroAim();
      return;
    }
    _pswDeviceQuat(Number.isFinite(g.alpha) ? g.alpha : 0, g.beta, g.gamma, _weaponAimDevQ);
    if (!_weaponAim.active) {
      _weaponAim.active = true;
      _weaponAim.neutralQ.copy(_weaponAimDevQ);
      _pswEarthToGame(_weaponAim.neutralQ, _weaponAim.earthToGameQ);
      _weaponAim.baseYaw = playerControls.yaw;
      _weaponAim.lastYaw = playerControls.yaw;
      _weaponAim.phoneYaw = 0;
      _weaponAim.phonePitch = 0;
    }
    // Yaw changed by something else since last frame (touch drag, arrow keys, respawn)
    _weaponAim.baseYaw += wrapDeltaRad(playerControls.yaw - _weaponAim.lastYaw);

    // R = E · D · N⁻¹ · E⁻¹ (rotation since neutral, in the neutral pose's game frame)
    const R = _weaponAimRelQ.copy(_weaponAimDevQ).multiply(_weaponAimTmpQ.copy(_weaponAim.neutralQ).invert());
    R.premultiply(_weaponAim.earthToGameQ).multiply(_weaponAimTmpQ.copy(_weaponAim.earthToGameQ).invert());
    if (R.w < 0) { R.x = -R.x; R.y = -R.y; R.z = -R.z; R.w = -R.w; }
    // Twist about game Y (+ = toward game +X = left, same sign as the camera yaw)
    const phoneYaw = 2 * Math.atan2(R.y, R.w);
    // Swing without the twist: how far the forward axis tilted up/down
    _weaponAimTmpQ.setFromAxisAngle(_PSW_UP, -phoneYaw).multiply(R);
    _weaponAimV.set(0, 0, 1).applyQuaternion(_weaponAimTmpQ);
    const phonePitch = Math.atan2(_weaponAimV.y, Math.hypot(_weaponAimV.x, _weaponAimV.z));
    const k = dt > 0 ? 1 - Math.exp(-WEAPON_AIM_SMOOTH * dt) : 1;
    _weaponAim.phoneYaw += (phoneYaw - _weaponAim.phoneYaw) * k;
    _weaponAim.phonePitch += (phonePitch - _weaponAim.phonePitch) * k;

    const yawAbs = Math.abs(_weaponAim.phoneYaw);
    if (yawAbs > WEAPON_AIM_TURN_DEADZONE && dt > 0) {
      const rate = Math.min(WEAPON_AIM_TURN_RATE_MAX, (yawAbs - WEAPON_AIM_TURN_DEADZONE) * WEAPON_AIM_TURN_RATE);
      _weaponAim.baseYaw += Math.sign(_weaponAim.phoneYaw) * rate * dt;
    }
    const yawOffset = THREE.MathUtils.clamp(_weaponAim.phoneYaw * WEAPON_AIM_YAW_GAIN, -WEAPON_AIM_YAW_OFFSET_MAX, WEAPON_AIM_YAW_OFFSET_MAX);
    playerControls.yaw = _weaponAim.baseYaw + yawOffset;
    _weaponAim.lastYaw = playerControls.yaw;
    // Read by PlayerControls (aim direction + camera pitch) and the pistol (arms + gun pitch)
    playerControls.weaponAimPitch = THREE.MathUtils.clamp(
      _weaponAim.phonePitch * WEAPON_AIM_PITCH_GAIN, WEAPON_AIM_PITCH_MIN, WEAPON_AIM_PITCH_MAX
    );
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
  // The automatic QR popup waits until a mode is picked (the game loads behind the start
  // screen, so it would cover the mode buttons) — see the mode handler
  let _phoneSwordQrDeferred = false;
  const autoShowPhoneSwordQr = (peerId) => {
    if (!startOverlay.classList.contains('hidden')) {
      _phoneSwordPeerId = peerId;
      _phoneSwordQrDeferred = true;
      return;
    }
    void showPhoneSwordQr(peerId);
  };
  // Settings → Sword Gyro → "Show Phone QR Code": bring the connection popup back on demand
  // (to connect a phone that dropped, or a different one). False until the gyro peer is open.
  window.phoneSwordShowQr = () => {
    if (!_phoneSwordPeerId) return false;
    const connected = !!window.phoneSwordGyro?.connected;
    phoneSwordQrStatus.textContent = connected ? 'Phone connected — scan to switch phones' : 'Waiting for phone…';
    phoneSwordQrStatus.classList.toggle('connected', connected);
    void showPhoneSwordQr(_phoneSwordPeerId);
    return true;
  };

  // Copy URL to clipboard
  phoneSwordQrCopy.addEventListener('click', () => {
    const url = phoneSwordQrUrl.dataset.url || phoneSwordQrUrl.textContent;
    navigator.clipboard.writeText(url).then(() => {
      phoneSwordQrCopy.textContent = 'Copied!';
      phoneSwordQrCopy.classList.add('copied');
      setTimeout(() => {
        phoneSwordQrCopy.textContent = 'Copy URL';
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
      phoneSwordQrCopy.textContent = 'Copied!';
      phoneSwordQrCopy.classList.add('copied');
      setTimeout(() => {
        phoneSwordQrCopy.textContent = 'Copy URL';
        phoneSwordQrCopy.classList.remove('copied');
      }, 2000);
    });
  });

  phoneSwordQrDismiss.addEventListener('click', () => {
    phoneSwordQrModal.classList.add('hidden');
  });

  // "Use This Device" — pipe the current device's own gyroscope into phoneSwordGyro
  let _localGyroHandler = null;
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
    // The screen is also the sword, so the gyro is amplified (window.phoneSwordLocalSensitivity)
    // and small wrist movements are enough while still being able to see the screen.
    // Blocking comes from the on-screen Block button.
    if (!_localGyroHandler) {
      _localGyroHandler = (event) => {
        if (!window.phoneSwordGyro.localDevice || event.alpha === null) return;
        window.phoneSwordGyro.alpha = event.alpha;
        window.phoneSwordGyro.beta = event.beta;
        window.phoneSwordGyro.gamma = event.gamma;
      };
      window.addEventListener('deviceorientation', _localGyroHandler, true);
    }
    window.phoneSwordGyro.localDevice = true;
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
      _resetSwordCalibDrift();
      closeCalibModal();
    });
  });

  // ── Post-connect calibration popup ──────────────────────────────────────
  // (also shown before every Showdown stage: accepting the villager’s quest waits on Okay —
  // unless the sword was calibrated less than SWORD_CALIB_FRESH_MS ago)
  let _connectCalibThen = null;
  document.getElementById('phone-sword-connect-calib-ok')?.addEventListener('click', () => {
    window.phoneSwordRecalibrate?.();
    phoneSwordConnectCalib?.classList.add('hidden');
    const then = _connectCalibThen;
    _connectCalibThen = null;
    then?.();
  });
  // (calibrated within this long: no popup)
  const SWORD_CALIB_FRESH_MS = 60000;
  const _requireSwordCalibration = (then) => {
    if (!phoneSwordConnectCalib || performance.now() - _swordCalibratedAtMs < SWORD_CALIB_FRESH_MS) { then(); return; }
    _connectCalibThen = then;
    phoneSwordConnectCalib.classList.remove('hidden');
  };
  // Start of every Multiplayer duel / battle: always ask (the game doesn't wait on it)
  const _promptSwordCalibration = () => {
    if (!phoneSwordConnectCalib || _connectCalibThen) return;
    phoneSwordConnectCalib.classList.remove('hidden');
  };
  const _isSwordCalibPromptOpen = () => !!phoneSwordConnectCalib && !phoneSwordConnectCalib.classList.contains('hidden');
  // A gyro item coming out (the sword, wand, rod, oar, gun, shield, the broom): the calibration
  // popup if a gyro's connected and it's been GYRO_ITEM_CALIB_FRESH_MS since the last one
  // (the game doesn't wait on it)
  const GYRO_ITEM_CALIB_FRESH_MS = 90000;
  _gyroItemCalibPrompt = () => {
    if (!window.phoneSwordGyro?.connected) return;
    if (performance.now() - _swordCalibratedAtMs < GYRO_ITEM_CALIB_FRESH_MS) return;
    _promptSwordCalibration();
  };

  // ── Phone controller input (phone-sword.html) ─────────────────────────────
  // Besides gyro + block, the phone page has a joystick and bomb/gun/fire/shield/bubble/jump
  // buttons. The joystick rides along in each 'gyro' packet; buttons arrive as 'action'
  // messages. The host pushes a small 'status' message back so the phone can show counts.
  let _remoteJoyActive = false;
  const _applyRemoteJoystick = (angle, force) => {
    if (!playerControls) return;
    // Classic has no joystick
    const f = Number.isFinite(force) && !_classicMode ? Math.max(0, Math.min(1, force)) : 0;
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
  // Wand equipped: holding the Block bar / phone Block button holds up the shield instead,
  // and letting go goes back to the wand (PlayerControls.refreshActionButtons, phone page)
  let _wandShieldHold = false;
  const setWandShieldHold = (down) => {
    if (down) {
      if (_wandShieldHold || !isWandEquipped()) return;
      if (!((getInventory()?.[SHIELD_ITEM_ID]?.count ?? 0) > 0)) return;
      _wandShieldHold = true;
      equipInventoryItem(SHIELD_ITEM_ID);
    } else {
      if (!_wandShieldHold) return;
      _wandShieldHold = false;
      // (unless they picked the gun meanwhile; a shield that broke left the sword in hand)
      if (isWandAllowed() && playerControls?.getEquippedWeapon?.('right')?.itemId !== 'pistol') {
        equipInventoryItem(MAGIC_WAND_ITEM_ID);
      }
    }
    playerControls?.refreshActionButtons?.();
  };
  // Gun/Shield buttons equip that item, or go back to the sword if it's already equipped
  // What's in hand: an item id, or null (Town: put away)
  const _heldWeaponId = () => (isWandEquipped() ? MAGIC_WAND_ITEM_ID : isRodEquipped() ? FISHING_ROD_ITEM_ID
    : isOarEquipped() ? OAR_ITEM_ID
    : playerControls?.getEquippedWeapon?.('right')?.itemId ?? null);
  // Everything put away (Town's ✋ Hands; also the town's start, purchases and arrests)
  const _putWeaponsAway = () => {
    if (playerRoll) playerRoll.restoreIds = [];
    getEquippedInventoryItemIds().forEach((itemId) => unequipInventoryItem(itemId));
    if (_wandActive) { _wandActive = false; if (foamSword) foamSword.wand = false; }
    if (_rodActive) { _rodActive = false; if (foamSword) foamSword.rod = false; }
    if (_oarActive) { _oarActive = false; if (foamSword) foamSword.oar = false; }
    playerBombThrow = null;
    playerBombs?.setHeld(null);
    lastEquippedBeforeShield = null;
    hideShieldHealthHUD();
    updateManaUI();
  };
  // Back from the gun / shield / wand: the sword, or (Town without one) empty hands
  const _backToSword = () => {
    if (_townLoadout && !_townLoadout.hasSword) _putWeaponsAway();
    else _equipByPlayer(FOAM_SWORD_ITEM_ID);
  };
  const _toggleRemoteWeapon = (itemId) => {
    const appStateRef = window.appState;
    const inv = appStateRef?.getInventory?.() || {};
    if (!((inv[itemId]?.count ?? 0) > 0)) return;
    const equippedId = playerControls?.getEquippedWeapon?.('right')?.itemId;
    // Pressing the held weapon again goes back to the sword (Town without one: empty hands)
    if (equippedId === itemId) _backToSword();
    else _equipByPlayer(itemId);
    playerControls?.refreshActionButtons?.();
  };
  const _handlePhoneAction = (action) => {
    if (action === 'wandShieldUp') { setWandShieldHold(false); return; } // (always let go)
    if (action === 'heldUp') { town?.useHeld(false); return; } // (always let go)
    if (action === 'heldDown') { if (!_gamePaused) town?.useHeld(true); return; }
    if (action === 'recalibrate') { window.phoneSwordRecalibrate?.(); return; } // phone's ⟲ button (any mode)
    if (action === 'interact') {
      // The Block bar as an interact button: the calibration popup's Okay, a boss's talk, the village
      if (_isSwordCalibPromptOpen()) document.getElementById('phone-sword-connect-calib-ok')?.click();
      else if (_gamePaused) return;
      else if (bossTalk.isOpen()) bossTalk.interact();
      else if (village?.isOpen()) village.interact();
      else if (town?.isActive()) town.interact();
      else if (seaStart?.isActive()) seaStart.interact();
      return;
    }
    if (!playerControls?.enabled || _classicMode || _gamePaused) return; // Classic: Block only
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
    } else if (action === 'wand') {
      // Magic wand ↔ sword
      if (!isWandAllowed()) return;
      if (isWandEquipped()) _backToSword();
      else _equipByPlayer(MAGIC_WAND_ITEM_ID);
      playerControls?.refreshActionButtons?.();
    } else if (action === 'rod') {
      // The sea start: the rod (from the oar)
      if (seaStart?.isActive()) { seaStart.pick('rod'); return; }
      // Town: fishing rod ↔ the sword (or empty hands); in the canoe, ↔ the oar
      if (!isRodAllowed()) return;
      if (isRodEquipped() && town?.inCanoe?.()) _equipByPlayer(OAR_ITEM_ID);
      else if (isRodEquipped()) _backToSword();
      else _equipByPlayer(FISHING_ROD_ITEM_ID);
      playerControls?.refreshActionButtons?.();
    } else if (action === 'sword') {
      // Town: 🗡 Sword out ↔ ✋ Hands (nothing in hand); something grabbed: drop it
      if (!_townLoadout || isOarAllowed()) return; // (in the canoe the oar stays in hand)
      if (town?.holding()) { town.dropHeld(); return; }
      if (_heldWeaponId()) _putWeaponsAway();
      else _equipByPlayer(FOAM_SWORD_ITEM_ID);
      playerControls?.refreshActionButtons?.();
    } else if (action === 'broom') {
      // Town: on / off the flying broom
      _toggleBroom();
    } else if (action === 'boostDown' || action === 'boostUp') {
      // Town, on the broom: boost while the button's held (uses mana)
      _setBroomBoost(action === 'boostDown');
    } else if (action === 'wandShieldDown') {
      setWandShieldHold(true);
    }
  };
  // What the phone's Block bar does as an interact button right now (undefined: it's Block / Fire…;
  // null: interact, but nothing to do) — the calibration popup, a boss's talk, the village
  const _phoneInteract = () => {
    if (_isSwordCalibPromptOpen()) return 'Okay';
    if (bossTalk.isOpen()) return bossTalk.interactLabel();
    if (village?.isOpen()) return village.interactLabel();
    // Town: only with empty hands (✋ Hands), the fishing rod or the canoe's oar — holding a weapon,
    // the bar stays Block / Fire… (and with the line out it's the reel — _phoneControllerStatus)
    if (town?.isActive()) return _heldWeaponId() && !isRodEquipped() && !isOarEquipped() ? undefined : town.interactLabel(); // (undefined when there's nothing to do: Block stays Block)
    // The sea start: 🛶 Oar / 🛶 Get out
    if (seaStart?.isActive()) return seaStart.interactLabel();
    return undefined;
  };
  const _phoneControllerStatus = () => {
    const status = _phoneControllerGearStatus();
    // Town fishing, the line out: the bar is a reel (cranked round on the phone's screen)
    const fishing = town?.isActive() ? town.fishingHud() : seaStart?.isActive() ? seaStart.fishingHud() : null;
    if (fishing?.reel) return { ...status, reelMode: true, fishCue: fishing.cue, fishText: fishing.text };
    // Town, something grabbed (the hose): the bar is its mode (💧 Water — held), 🗡/✋ drops it
    if (town?.isActive() && town.holding()) return { ...status, holding: true, heldBar: town.heldBar() };
    const interact = _phoneInteract();
    return interact === undefined ? status : { ...status, interactMode: true, interact };
  };
  const _phoneControllerGearStatus = () => {
    const inv = window.appState?.getInventory?.() || {};
    if (_classicMode) {
      // Classic: the phone shows only Block (no joystick or other buttons)
      return {
        bombs: 0, bubbles: 0, bubbleActive: false, hasGun: false, hasShield: false,
        ammo: 0, equipped: FOAM_SWORD_ITEM_ID, highlight: null, blockOnly: true
      };
    }
    if (_mpSwordOnly()) {
      // Multiplayer duels are sword only: grey out bomb/bubble/gun/shield on the phone
      return {
        bombs: 0, bubbles: 0, bubbleActive: false, hasGun: false, hasShield: false,
        ammo: 0, equipped: FOAM_SWORD_ITEM_ID, highlight: null
      };
    }
    return {
      bombs: getPlayerBombCount(),
      bubbles: getBubbleCount(),
      bubbleActive: isPlayerBubbleActive(),
      // (Town: bubbles run on mana — no count on the button)
      bubbleMana: !!_townLoadout,
      hasGun: (inv.pistol?.count ?? 0) > 0,
      hasShield: (inv[SHIELD_ITEM_ID]?.count ?? 0) > 0,
      ammo: getPistolAmmoCount(),
      hasWand: isWandAllowed(),
      mana: getMana(),
      equipped: _heldWeaponId() ?? (_townLoadout ? 'none' : FOAM_SWORD_ITEM_ID),
      // Town: the sword is bought; 🗡 / ✋ puts everything away; the fishing rod once bought
      hasSword: _townLoadout ? _townLoadout.hasSword : true,
      hasRod: isRodAllowed(),
      // Town's flying broom (once bought): on it / off it
      hasBroom: !!_townLoadout?.hasBroom,
      onBroom: !!_broomRide?.isRiding(),
      boosting: !!_broomRide?.isBoosting(),
      canUnequip: !!_townLoadout,
      // (the shield held up from the wand: Block keeps saying Shield until it's let go)
      wandShieldHeld: _wandShieldHold,
      // Tutorial: phone button to ring ('bomb' | 'bubble' | 'gun' | 'shield' | 'fire' | 'block')
      highlight: showdownTutorial?.isActive() ? _tutorialPhoneHighlight : null
    };
  };
  let _tutorialPhoneHighlight = null;
  // Town fishing: the phone's reel (radians cranked, not yet taken by town.takeReel)
  const _phoneReel = { last: null, pending: 0 };
  // Sends the phone its status now (if it changed) — fishing cues can't wait for the timer
  let _phoneSwordStatusNow = null;
  // The phone currently driving the sword. A reconnecting phone (its browser was closed) opens
  // a new connection while the old one may not have noticed it's dead yet: the new one wins,
  // and the old one closing later must not mark the phone as disconnected.
  let _phoneSwordConn = null;
  const _attachPhoneSwordConn = (conn) => {
    const prev = _phoneSwordConn;
    _phoneSwordConn = conn;
    if (prev && prev !== conn) { try { prev.close(); } catch (_) { /* ignore */ } }
    window.phoneSwordGyro.connected = true;
    _phoneReel.last = null;
    // A separate phone took over — stop using this device's own gyro
    window.phoneSwordGyro.localDevice = false;
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
    _phoneSwordStatusNow = sendStatus;
    conn.on('data', (data) => {
      if (!data || conn !== _phoneSwordConn) return;
      if (data.type === 'gyro') {
        window.phoneSwordGyro.alpha = data.alpha;
        window.phoneSwordGyro.beta = data.beta;
        window.phoneSwordGyro.gamma = data.gamma;
        window.phoneSwordGyro.blocking = !!data.blocking;
        if ('joyForce' in data) _applyRemoteJoystick(Number(data.joyAngle), Number(data.joyForce));
        // The phone's fishing reel: radians cranked so far (a running total, so a lost packet
        // loses nothing) — the turns since the last packet go to Town's fishing
        const reelTotal = Number(data.reel);
        if (Number.isFinite(reelTotal)) {
          if (_phoneReel.last !== null && reelTotal >= _phoneReel.last) _phoneReel.pending += Math.min(20, reelTotal - _phoneReel.last);
          _phoneReel.last = reelTotal;
        }
      } else if (data.type === 'action' && typeof data.action === 'string') {
        _handlePhoneAction(data.action);
        lastStatusJson = ''; // counts/equipped likely changed — resend soon
      } else if (data.type === 'roll') {
        // A swipe on the phone's screen (dx right, dy down)
        const dx = Number(data.dx);
        const dy = Number(data.dy);
        if (Number.isFinite(dx) && Number.isFinite(dy)) tryPlayerRoll(dx, dy);
        lastStatusJson = '';
      }
    });
    let closed = false;
    const onGone = () => {
      if (closed) return;
      closed = true;
      clearInterval(statusTimer);
      if (conn !== _phoneSwordConn) return; // replaced by a newer phone connection
      _phoneSwordConn = null;
      window.phoneSwordGyro.connected = false;
      window.phoneSwordGyro.blocking = false;
      _applyRemoteJoystick(0, 0);
      setWandShieldHold(false);
    };
    conn.on('close', onGone);
    conn.on('error', onGone);
  };

  // Derive a stable peer ID so the phone-sword URL never changes: signed-in players get one per
  // profile (their normalized name key), guests one per browser (a random device ID kept in
  // localStorage + a cookie, so a refresh with a new random guest name keeps the same URL).
  // Uses SHA-256 of the source so IDs are short, URL-safe, and unique per account / device.
  const _guestDeviceId = () => {
    const KEY = 'sq:guestDeviceId';
    let id = null;
    try { id = localStorage.getItem(KEY); } catch (_) { /* storage blocked */ }
    if (!id) id = getCookie(KEY);
    if (!id || !/^[a-z0-9-]{8,64}$/i.test(id)) {
      id = crypto.randomUUID ? crypto.randomUUID()
        : Array.from(crypto.getRandomValues(new Uint8Array(16))).map(b => b.toString(16).padStart(2, '0')).join('');
    }
    try { localStorage.setItem(KEY, id); } catch (_) { /* storage blocked */ }
    setCookie(KEY, id);
    return id;
  };
  let _fixedPeerId = null;
  try {
    const _idSource = profileNameKey ? 'sqsword:' + profileNameKey : 'sqsword-guest:' + _guestDeviceId();
    const _hashBuf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(_idSource));
    const _hashHex = Array.from(new Uint8Array(_hashBuf)).map(b => b.toString(16).padStart(2, '0')).join('');
    _fixedPeerId = 'sq-' + _hashHex.slice(0, 24);
  } catch (_) { /* fall back to random ID */ }

  // Create a dedicated PeerJS peer for receiving gyro data.
  // The phone finds the game through the PeerJS signalling server, so the game's peer has to
  // stay registered there the whole time: when its socket drops (network blip, the tab was in
  // the background, the laptop slept) it is reconnected, and a peer that died is recreated —
  // otherwise a phone that reloads its page can no longer reach the game ("Could not connect to peer").
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
    // Our fixed ID can be "taken" for a while by our own previous registration (a reload or a
    // dropped socket) — retry it a few times before giving up on it for a random ID
    const GYRO_ID_TAKEN_RETRIES = 4;
    const GYRO_ID_TAKEN_RETRY_MS = 5000;
    const GYRO_RECONNECT_MAX_MS = 15000;
    let _idTakenRetries = 0;
    let _reconnectDelayMs = 1000;
    let _reconnectTimer = null;
    let _autoConnectTimer = null;
    let _firstOpen = true;
    let gyroPeer = null;

    const _onPhoneConnection = (conn) => {
      clearTimeout(_autoConnectTimer);
      phoneSwordQrStatus.textContent = 'Phone connected!';
      phoneSwordQrStatus.classList.add('connected');

      // Auto-dismiss QR modal after short delay, then show calibration popup
      setTimeout(() => {
        phoneSwordQrModal.classList.add('hidden');
        phoneSwordConnectCalib?.classList.remove('hidden');
      }, 1800);

      _attachPhoneSwordConn(conn);
    };

    const _scheduleGyroReconnect = (fn, delayMs) => {
      clearTimeout(_reconnectTimer);
      _reconnectTimer = setTimeout(fn, delayMs);
    };

    const _createGyroPeer = () => {
      const id = _fixedPeerId;
      const peer = id ? new PeerClass(id, _peerOpts) : new PeerClass(_peerOpts);
      gyroPeer = peer;

      peer.on('open', (openId) => {
        if (peer !== gyroPeer) return;
        _reconnectDelayMs = 1000;
        _idTakenRetries = 0;
        const idChanged = _phoneSwordPeerId && _phoneSwordPeerId !== openId;
        _phoneSwordPeerId = openId;
        if (_firstOpen) {
          _firstOpen = false;
          // Give the phone 3 seconds to auto-reconnect (if it has the URL bookmarked)
          // before showing the QR modal.
          _autoConnectTimer = setTimeout(() => {
            if (!window.phoneSwordGyro.connected) {
              autoShowPhoneSwordQr(openId);
            }
          }, 3000);
        } else if (idChanged && !phoneSwordQrModal.classList.contains('hidden')) {
          void showPhoneSwordQr(openId); // the QR on screen pointed at the old ID
        }
      });

      peer.on('connection', (conn) => {
        if (peer !== gyroPeer) return;
        _onPhoneConnection(conn);
      });

      // Lost the signalling server (the phone link itself, if any, keeps working)
      peer.on('disconnected', () => {
        if (peer !== gyroPeer || peer.destroyed) return;
        _scheduleGyroReconnect(() => {
          if (peer !== gyroPeer || peer.destroyed || !peer.disconnected) return;
          try { peer.reconnect(); } catch (_) { /* 'error' / 'close' handle it */ }
        }, _reconnectDelayMs);
        _reconnectDelayMs = Math.min(GYRO_RECONNECT_MAX_MS, _reconnectDelayMs * 2);
      });

      // Destroyed (fatal error): start over with a new peer
      peer.on('close', () => {
        if (peer !== gyroPeer) return;
        _scheduleGyroReconnect(_createGyroPeer, _reconnectDelayMs);
        _reconnectDelayMs = Math.min(GYRO_RECONNECT_MAX_MS, _reconnectDelayMs * 2);
      });

      peer.on('error', (err) => {
        if (peer !== gyroPeer) return;
        if (err.type === 'unavailable-id' && _fixedPeerId) {
          gyroPeer = null; // (its 'close' is not ours to handle any more)
          try { peer.destroy(); } catch (_) { /* ignore */ }
          if (_idTakenRetries < GYRO_ID_TAKEN_RETRIES) {
            _idTakenRetries += 1;
            console.warn('[PhoneSword] Fixed peer ID taken, retrying shortly');
            _scheduleGyroReconnect(_createGyroPeer, GYRO_ID_TAKEN_RETRY_MS);
          } else {
            console.warn('[PhoneSword] Fixed peer ID taken, falling back to random ID');
            _fixedPeerId = null;
            _createGyroPeer();
          }
          return;
        }
        // Fatal errors destroy the peer ('close' recreates it); socket / network errors only
        // disconnect it ('disconnected' reconnects it); 'peer-unavailable' etc. change nothing
        console.warn('[PhoneSword] PeerJS error:', err.type, err.message);
        if (err.type === 'browser-incompatible') gyroPeer = null; // (no point retrying)
      });
    };

    _createGyroPeer();

    // Back from the background / sleep / offline: re-register right away instead of waiting
    // for the backoff
    const _wakeGyroPeer = () => {
      const peer = gyroPeer;
      if (!peer || document.visibilityState === 'hidden') return;
      if (peer.destroyed) { _scheduleGyroReconnect(_createGyroPeer, 0); return; }
      if (peer.disconnected) {
        _reconnectDelayMs = 1000;
        _scheduleGyroReconnect(() => {
          if (peer === gyroPeer && peer.disconnected && !peer.destroyed) {
            try { peer.reconnect(); } catch (_) { /* ignore */ }
          }
        }, 0);
      }
    };
    document.addEventListener('visibilitychange', _wakeGyroPeer);
    window.addEventListener('online', _wakeGyroPeer);
    window.addEventListener('focus', _wakeGyroPeer);
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

  // Game Over UI: just the GAME OVER text over the world (no backdrop), then straight back to
  // the stage screen (Showdown: the village; Classic: the stage banner) — no Continue? prompt
  const gameOverOverlay = document.getElementById('game-over-overlay');
  const gameOverMessage = document.getElementById('game-over-message');
  let _gameOverTimers = [];

  function showGameOver() {
    // Town: busted (wanted) or knocked out — the town takes it from here
    if (town?.onPlayerDown()) return;
    // Counted on death
    if (_classicMode) {
      _classicStats.deaths += 1;
      _classicSaveStats();
    } else if (!showdownTutorial?.isActive()) {
      _psStats.deaths = (_psStats.deaths || 0) + 1;
      if (profileNameKey) void savePhoneSwordStats(profileNameKey, { ..._psStats });
    }
    hideGameOver();
    gameOverOverlay.classList.remove('hidden');
    gameOverMessage.classList.remove('hidden');
    const backToStageScreen = () => {
      hideGameOver();
      respawnPlayer();
      _psRestartCurrentStage();
    };
    // Showdown: two frog men walk up, pick the player up and carry them off screen first
    const carry = !_classicMode && !!deathCarry;
    if (carry) {
      deathCarry.start({
        body: playerModel,
        character: playerModel.userData.qwopRig?.glbCharacter ?? null,
        onDone: backToStageScreen,
      });
    }
    _gameOverTimers.push(setTimeout(() => {
      gameOverMessage.style.opacity = 1;
      _gameOverTimers.push(setTimeout(() => {
        gameOverMessage.style.opacity = 0;
        _gameOverTimers.push(setTimeout(() => {
          if (carry) {
            gameOverOverlay.classList.add('hidden');
            gameOverMessage.classList.add('hidden');
          } else {
            backToStageScreen();
          }
        }, 1000));
      }, 1500));
    }, 50));
  }

  function hideGameOver() {
    _gameOverTimers.forEach(clearTimeout);
    _gameOverTimers = [];
    gameOverOverlay.classList.add('hidden');
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
    // Always re-equip the foam sword after respawn (Town: only one that's been bought)
    if (_townLoadout) {
      if (_townLoadout.hasSword) equipInventoryItem(FOAM_SWORD_ITEM_ID);
    } else {
      if (!(inventoryState[FOAM_SWORD_ITEM_ID]?.count > 0)) {
        inventoryState[FOAM_SWORD_ITEM_ID] = ensureCatalogEntry(FOAM_SWORD_ITEM_ID, { count: 1 });
      }
      equipInventoryItem(FOAM_SWORD_ITEM_ID);
    }
    updateControlAvailability();
    const actions = playerModel.userData.actions;
    const current = playerModel.userData.currentAction;
    actions?.[current]?.fadeOut(0.2);
    actions?.idle?.reset().fadeIn(0.2).play();
    playerModel.userData.currentAction = 'idle';
  }

  const settingsBtn = document.getElementById('settings-button');
  const appState = {
    // Settings → Back to Lobby: leave whatever mode is running for the start screen
    canReturnToLobby: () => !arcadeOverlay.isStartScreenShown(),
    returnToLobby: async () => {
      if (arcadeOverlay.isStartScreenShown()) return;
      if (showdownTutorial?.isActive()) await showdownTutorial.stop();
      matchMode?.exit();
      duelMode?.exit();
      devRoam?.exit();
      town?.exit();
      _setClassicMode(false);
      _resetForMenu();
      arcadeOverlay.showStartScreen();
    },
    // Settings → Dev
    getPlayerPose: () => _playerPose(),
    startDevRoam: async () => {
      await appState.returnToLobby(); // leave whatever mode runs (the tutorial too) first
      arcadeOverlay.startMode('roam');
    },
    setDevRoutesVisible: (on) => devRoam?.setRoutesVisible(on),
    refreshDevRoutes: () => devRoam?.refresh(),
    getPlayerName: () => playerName,
    setPlayerName: (name) => {
      if (!name) return;
      playerName = name;
      if (player?.nameLabel) {
        player.nameLabel.innerText = playerName;
      }
      updatePlayerInfoUI();
      if (!isGuest) {
        setCookie("playerName", playerName);
        localStorage.setItem('playerName', playerName);
      }
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
      if (isGuest) {
        // No profile to rename: just use the new name for this session
        playerProfile.name = trimmedName;
        appState.setPlayerName(trimmedName);
        return { status: 'ok' };
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
    getMultiplayerLeaderboards: (limit = 10) => loadMultiplayerLeaderboards(limit),
    getPhoneSwordStats: () => ({ ..._psStats }),
    // Everything Settings → Profile shows (Showdown / Classic stage stats, upgrades, characters)
    getProfileStats: () => ({
      // (in Town: Showdown's, set aside — _saveAside)
      level: _saveAside?.stats.level ?? statsState.level,
      xp: _saveAside?.stats.xp ?? statsState.xp,
      coins: _saveAside?.stats.coins ?? statsState.coins,
      showdown: {
        // (_psStage holds Classic's stage while Classic runs; guests have nothing saved)
        currentStage: profileNameKey
          ? Math.max(_psSavedStage(), Number(playerProfile?.phoneSwordStats?.currentStage) || 1)
          : (_classicMode ? 1 : _psStage),
        highestStage: _psStats.highestStage,
        kills: _psStats.kills,
        deaths: _psStats.deaths,
        maxHearts: _saveAside?.stats.maxHealthSegments ?? statsState.maxHealthSegments,
        shieldUpgrades: statsState.shieldUpgrades || 0,
        bombs: getPlayerBombCount(),
        bubbles: getBubbleCount(),
        charactersUnlocked: _psChars.unlocked.length,
        charactersTotal: Object.keys(MATCH_CHARACTERS).length
      },
      multiplayer: { ..._mpStats },
      classic: {
        currentStage: profileNameKey
          ? Math.max(_classicSavedStage(), Number(playerProfile?.classicStats?.currentStage) || 1)
          : (_classicMode ? _psStage : 1),
        highestStage: _classicStats.highestStage,
        kills: _classicStats.kills,
        deaths: _classicStats.deaths
      }
    }),
    isGuest: () => isGuest,
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
      if (itemId === 'life_potion') return statsState.health >= statsState.maxHealthSegments;
      if (itemId === 'mana_potion') return getMana() >= MAX_MANA;
      if (itemId === MAGIC_WAND_ITEM_ID) return hasMagicWand();
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
      } else if (itemId === 'life_potion') {
        setStat('health', statsState.maxHealthSegments, { skipSave: true });
      } else if (itemId === 'mana_potion') {
        setStat('mana', MAX_MANA, { skipSave: true });
      } else if (itemId === MAGIC_WAND_ITEM_ID) {
        addToInventory(MAGIC_WAND_ITEM_ID, 1);
        updateManaUI();
        playerControls?.refreshActionButtons?.();
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
    // Magic wand: owned (Showdown / the tutorial) or picked up in a Multiplayer battle
    isWandAllowed: () => isWandAllowed(),
    // Town: nothing in hand is allowed (✋ Hands), and the sword has to be bought
    isUnarmedAllowed: () => !!_townLoadout,
    ownsSword: () => !_townLoadout || _townLoadout.hasSword,
    putWeaponsAway: () => {
      if (!_townLoadout) return;
      _putWeaponsAway();
      playerControls?.refreshActionButtons?.();
    },
    isWandEquipped: () => isWandEquipped(),
    // Town's fishing rod (bought at the shop): equipped like the sword / wand
    isRodAllowed: () => isRodAllowed(),
    isRodEquipped: () => isRodEquipped(),
    isOarEquipped: () => isOarEquipped(),
    isInCanoe: () => isOarAllowed(),
    // Town's flying broom (bought from the wizard): owned / being ridden / on ↔ off
    hasBroom: () => !!_townLoadout?.hasBroom,
    isRidingBroom: () => !!_broomRide?.isRiding(),
    toggleBroom: () => _toggleBroom(),
    isBroomBoosting: () => !!_broomRide?.isBoosting(),
    setBroomBoost: (on) => _setBroomBoost(!!on),
    // Town: something grabbed — the Block bar is its mode (the hose's 'water'; null: none), held
    // down: useTownHeld(true), let go: false
    getTownHeldBar: () => (town?.isActive() ? town.heldBar() : null),
    useTownHeld: (on) => town?.useHeld(on),
    setWandShieldHold: (down) => setWandShieldHold(down),
    isWandShieldHeld: () => _wandShieldHold,
    getMana: () => getMana(),
    getMaxMana: () => MAX_MANA,
    getInventory: () => getInventory(),
    getPistolAmmoCount: () => getPistolAmmoCount(),
    addPistolAmmo: (amount) => addPistolAmmo(amount),
    seedPistolAmmoIfNeeded: () => seedPistolAmmoIfNeeded(),
    getEquippedInventoryItemId: () => getEquippedInventoryItemId(),
    getEquippedInventoryItemIds: () => getEquippedInventoryItemIds(),
    isInventoryItemEquipped: (itemId) => isInventoryItemEquipped(itemId),
    getInventoryItemActions: (itemId) => getInventoryItemActions(itemId),
    equipInventoryItem: (itemId) => _equipByPlayer(itemId),
    unequipInventoryItem: (itemId) => unequipInventoryItem(itemId),
    addToInventory: (itemId, amount) => addToInventory(itemId, amount),
    removeFromInventory: (itemId, amount) => removeFromInventory(itemId, amount),
    // Peers this client is connected to in its current room (lobby / duel / party / battle)
    getConnectedPlayers: () => Object.keys(multiplayer?.connections || {}).map((id) => ({
      id,
      name: otherPlayers[id]?.name || `Player ${id.slice(0, 4)}`
    })),
    // Room id (lobby, duel-<id>, mm-<mode>, party-<id>, match-<id>) or null outside Multiplayer
    getMultiplayerRoom: () => multiplayer?.roomId ?? null,
    getConnectionStatus: () => {
      if (!multiplayer) return 'Offline';
      if (!multiplayer.peer) return 'Connecting';
      if (multiplayer.peer.destroyed) return 'Disconnected';
      if (multiplayer.peer.disconnected) return 'Disconnected';
      if (multiplayer.peer.open) return 'Connected';
      return 'Connecting';
    },
    getLastPing: () => multiplayer?.lastPingMs,
    getLastError: () => {
      return multiplayer?.lastError ?? null;
    },
    getDisplaySettings: () => ({ ...displaySettings }),
    setDisplaySetting: (key, value) => setDisplaySetting(key, value),
    deleteAccount: async () => {
      if (!profileNameKey) {
        return { status: 'missing-key' };
      }
      const deletedKey = profileNameKey;
      const result = await deleteProfileData(deletedKey, playerName);
      if (result.status === 'ok') {
        // Local progress too, or re-registering the same name would bring the stages back
        [_psStageLsKey(), _classicStageLsKey(), _psCharsLsKey()].forEach((k) => {
          try { if (k) localStorage.removeItem(k); } catch (_) { /* ignore */ }
        });
        profileNameKey = null; // nothing more gets saved before the reload
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
    getMultiplayer: () => multiplayer,
    player
  });
  await initMerchantPanelFeature({ appState });
  // Single-player shop (Showdown has no peer multiplayer): this client keeps the stock
  void initMerchantFeature({ appState, isHost: true });

  // ── Village (between Showdown stages): shop on the market stall, mystery chest ──
  const TREASURE_CHEST_PRICE = 50;
  const VILLAGE_ITEM_TEXT = {
    life_potion: { name: 'Life Potion', desc: 'Fills your health to full' },
    mana_potion: { name: 'Mana Potion', desc: 'Fills your mana to full — the magic wand runs on mana' },
    magic_wand: { name: 'Magic Wand' },
    shield: { desc: 'Blocks hits from in front until it breaks' },
    pistol: { desc: 'Shoot enemies from afar (needs bullets)' },
    'gun bullets': { desc: 'One bullet for the gun' },
    treasure_chest: { name: 'Mystery Chest', desc: 'A random prize — coins, bombs, a shield, maybe even a gun!' },
  };
  let _villageMerchant = null;
  const _villageOwned = (itemId) => {
    switch (itemId) {
      case 'life_potion': return `Health ${statsState.health} / ${statsState.maxHealthSegments}`;
      case 'mana_potion': return `Mana ${getMana()} / ${MAX_MANA}`;
      case MAGIC_WAND_ITEM_ID: return hasMagicWand() ? 'You have it — tap Wand to use it' : `Each spell uses ${WAND_MANA_COST} mana`;
      case 'showdown_bomb': return `You have ${getPlayerBombCount()}`;
      case 'bubble': return `You have ${getBubbleCount()}`;
      case SHIELD_ITEM_ID: return `You have ${inventoryState[SHIELD_ITEM_ID]?.count || 0}`;
      case 'pistol': return (inventoryState.pistol?.count || 0) > 0 ? 'You have one' : '';
      case PISTOL_AMMO_KEY: return `You have ${getPistolAmmoCount()}`;
      case 'heart_upgrade': return `Max health ${statsState.maxHealthSegments} / ${SHOWDOWN_MAX_HEALTH_SEGMENTS}`;
      case 'shield_upgrade': return `Upgrades ${statsState.shieldUpgrades || 0} / ${SHOWDOWN_MAX_SHIELD_UPGRADES}`;
      default: return '';
    }
  };
  const _villageSaved = () => {
    void saveStatsImmediate(profileNameKey, statsState, lastStatUpdateAt, inventoryState);
    playerControls?.refreshActionButtons?.();
    updatePsBombButton();
    updatePsBubbleButton();
    updateManaUI();
  };
  // Mystery chest: pay, then one weighted random prize (things that can't be used are left out)
  // (`free`: a hidden chest found on a stage — no price)
  const _openTreasureChest = ({ free = false } = {}) => {
    if (!free && appState.getCoins() < TREASURE_CHEST_PRICE) return { ok: false };
    const hasGun = (inventoryState.pistol?.count || 0) > 0;
    const prizes = [
      { w: 24, emoji: '🪙', give: () => { const n = 20 + 10 * Math.floor(Math.random() * 9); appState.addCoins(n); return `${n} coins`; } },
      { w: 18, emoji: '💣', give: () => { setStat('bombs', getPlayerBombCount() + 3, { skipSave: true }); return '3 bombs'; } },
      { w: 14, emoji: '🫧', give: () => { setStat('bubbles', getBubbleCount() + 2, { skipSave: true }); return '2 bubbles'; } },
      { w: 12, emoji: '🛡️', give: () => { addToInventory(SHIELD_ITEM_ID, 1); return 'a shield'; } },
      { w: hasGun ? 12 : 0, emoji: '🔫', give: () => { addPistolAmmo(5); return '5 gun bullets'; } },
      { w: hasGun ? 0 : 5, emoji: '🔫', give: () => { addToInventory('pistol', 1); seedPistolAmmoIfNeeded(); return 'a gun!'; } },
      { w: appState.isShopItemMaxed('heart_upgrade') ? 0 : 4, emoji: '❤️', give: () => { appState.applyShopUpgrade('heart_upgrade'); return '+1 max health!'; } },
      { w: appState.isShopItemMaxed('shield_upgrade') ? 0 : 5, emoji: '⬆️', give: () => { appState.applyShopUpgrade('shield_upgrade'); return 'a shield upgrade'; } },
      { w: 3, emoji: '💰', give: () => { appState.addCoins(150); return 'the jackpot — 150 coins!'; } },
    ].filter((p) => p.w > 0);
    if (!free) appState.addCoins(-TREASURE_CHEST_PRICE);
    let r = Math.random() * prizes.reduce((sum, p) => sum + p.w, 0);
    const prize = prizes.find((p) => (r -= p.w) < 0) || prizes[0];
    const text = prize.give();
    _villageSaved();
    showPickupToast('coins', 1, '', { text: `${free ? 'Hidden Chest' : 'Mystery Chest'}: ${text}` });
    return { ok: true, emoji: prize.emoji, text };
  };
  const villageShop = {
    load: async () => { _villageMerchant ??= await import('../characters/merchant.js'); },
    getItemState: (itemId) => {
      const extra = VILLAGE_ITEM_TEXT[itemId] || {};
      if (itemId === 'treasure_chest') return { ...extra, price: TREASURE_CHEST_PRICE, owned: '', status: 'ok' };
      const meta = _villageMerchant?.getMerchantItemMeta(itemId);
      const stock = _villageMerchant?.getMerchantInventory()[itemId]?.count ?? 0;
      let status = 'ok';
      if (!meta) status = 'soon';
      else if (appState.isShopItemMaxed(itemId)) status = 'max';
      else if (!meta.unlimited && stock <= 0) status = 'soldout';
      return {
        name: extra.name || meta?.name || itemId,
        desc: meta?.description || extra.desc || '',
        price: meta?.price ?? 0,
        owned: _villageOwned(itemId),
        status,
        note: itemId === 'life_potion' ? 'Health is full'
          : itemId === 'mana_potion' ? 'Mana is full'
          : itemId === MAGIC_WAND_ITEM_ID ? 'Owned' : 'MAX',
      };
    },
    buy: async (itemId) => {
      if (itemId === 'treasure_chest') return _openTreasureChest();
      await villageShop.load();
      const meta = _villageMerchant.getMerchantItemMeta(itemId);
      if (!await _villageMerchant.buyMerchantItem(itemId)) return { ok: false };
      _villageSaved();
      showPickupToast(itemId, 1, '', { text: `Purchased ${meta.name} -${meta.price} coins`, icon: meta.icon });
      return { ok: true };
    },
  };
  // Showdown death: two frog men carry the player off (see showGameOver)
  deathCarry = createDeathCarry({ scene, camera, getTerrainHeight });
  village = createVillage({
    scene,
    camera,
    domElement: renderer.domElement,
    getTerrainHeight,
    getPlayer: () => ({ model: playerModel, controls: playerControls }),
    getCoins: () => appState.getCoins(),
    shop: villageShop,
    characters: {
      roster: MATCH_CHARACTERS,
      get: () => _psChars,
      select: (key) => {
        if (!_psChars.unlocked.includes(key) || !MATCH_CHARACTERS[key]) return;
        _psChars = { ..._psChars, selected: key };
        _psSaveChars();
        setPlayerCharacterUrl(playerModel, MATCH_CHARACTERS[key].url);
      },
    },
    time: {
      get: () => _psTimePref,
      set: (pref) => { _psTimePref = pref; _psPreviewTime(); },
    },
    confirmStart: (go) => {
      _villageUnsheathe();
      _requireSwordCalibration(go);
    },
    onStart: (pathAngle, extra) => _psVillageStart?.(pathAngle, extra),
    onLobby: () => {
      _resetForMenu();
      arcadeOverlay.showStartScreen();
    },
    getPlayerName: () => playerName,
    reward: {
      owed: () => _psRewardOwed,
      collect: () => {
        const n = _psRewardOwed;
        if (n <= 0) return;
        _psSetRewardOwed(0);
        _spawnRewardCoins(n);
      },
    },
    onIntroDone: _psMarkIntroSeen,
  });

  settingsBtn.addEventListener('click', () => {
    openSettings();
  });
  // The gear stays hidden until the panel exists (the start screen shows it once the game loads)
  document.body.classList.add('settings-ready');
  // The player on the map's ground at its spawn
  const _placeAtSpawn = () => {
    const spawn = getSpawnPosition();
    playerModel.position.set(spawn.x, spawn.y, spawn.z);
    playerControls.playerX = spawn.x;
    playerControls.playerY = spawn.y;
    playerControls.playerZ = spawn.z;
    playerControls.lastPosition?.set(spawn.x, spawn.y, spawn.z);
    playerControls.body?.setTranslation({ x: spawn.x, y: spawn.y + 0.6, z: spawn.z }, true);
  };
  // The map (started early in initCore) isn't waited on: the game loop starts without it (the
  // guest's sea start plays meanwhile; a mode picked waits on it in the mode handler). Once it's
  // in, the player goes to its spawn — unless they're out on the sea.
  _defaultMapReady
    .then(() => { if (!seaStart?.isActive()) _placeAtSpawn(); })
    .catch((err) => console.error('[map] the default map failed to load:', err));
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
    { itemId: PISTOL_AMMO_KEY, has: () => !(inventoryState.pistol?.count > 0) || getPistolAmmoCount() > 0 },
    // Mana: only with the wand, once there isn't enough left for a spell
    { itemId: 'mana_potion', has: () => !hasMagicWand() || getMana() >= WAND_MANA_COST }
  ];
  let psAutoBuyBusy = false;
  const psAutoBuyTick = async () => {
    // The tutorial does its own (scripted) purchases; Multiplayer duels are sword only
    if (psAutoBuyBusy || showdownTutorial?.isActive() || duelMode?.isActive() || _classicMode || _townLoadout) return;
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

  // Light up the lamp's glass (otherwise it's as dark as the rest at night): an emissive map
  // with only the yellow glass texels of its base colour texture, near white
  const _addRoadLightGlow = (root) => {
    root?.traverse((obj) => {
      const mat = obj.isMesh ? obj.material : null;
      const image = mat?.map?.image;
      if (!mat || !image || !('emissive' in mat) || mat.userData.roadLightGlow) return;
      mat.userData.roadLightGlow = true; // (once: the map's lamps share their materials)
      try {
        const w = image.width;
        const h = image.height;
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const g = canvas.getContext('2d');
        g.drawImage(image, 0, 0, w, h);
        const px = g.getImageData(0, 0, w, h);
        const d = px.data;
        const { minR, minG, maxBlueRatio } = ROAD_LIGHT_GLOW;
        for (let i = 0; i < d.length; i += 4) {
          const glass = d[i] >= minR && d[i + 1] >= minG && d[i + 2] <= d[i] * maxBlueRatio;
          const v = glass ? 255 : 0;
          d[i] = v; d[i + 1] = v; d[i + 2] = v; d[i + 3] = 255;
        }
        g.putImageData(px, 0, 0);
        const emissiveMap = new THREE.CanvasTexture(canvas);
        emissiveMap.flipY = mat.map.flipY;
        emissiveMap.colorSpace = THREE.SRGBColorSpace;
        mat.emissiveMap = emissiveMap;
        mat.emissive = new THREE.Color(ROAD_LIGHT_GLOW.color);
        mat.emissiveIntensity = ROAD_LIGHT_GLOW.intensity;
        mat.needsUpdate = true;
      } catch (error) {
        console.warn('Road light glow skipped.', error);
      }
    });
  };

  const ensureRoadLightTemplate = async () => {
    if (roadLightTemplate) return roadLightTemplate;
    if (!roadLightTemplatePromise) {
      roadLightTemplatePromise = roadLightLoader.loadAsync(ROAD_LIGHT_MODEL_URL)
        .then((gltf) => {
          roadLightTemplate = gltf?.scene || null;
          stylizeObject(roadLightTemplate, { materials: false });
          _addRoadLightGlow(roadLightTemplate);
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
    // (none in Town: the player's lantern lights the way there)
    if (!scene || !playerModel?.position || !isNightDisplayMode() || town?.isActive()) {
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
          model.scale.setScalar(ROAD_LIGHT_SCALE);
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
  let _tutorialLentWand = false;
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
    const itemId = name === 'gun' ? 'pistol' : name === 'shield' ? SHIELD_ITEM_ID : name === 'wand' ? MAGIC_WAND_ITEM_ID : name;
    return [pc.psWeaponBtn1, pc.psWeaponBtn2, pc.psWeaponBtn3].find(b => b?.dataset.psWeaponId === itemId) || null;
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
    // Wand caster (ranged, holds its spells until forceCast)
    spawnWandCaster: ({ position, hearts = 1 }) => {
      const enemy = _spawnHordeEnemy({ position, hearts, speedScale: PS_ENEMY_SPEED, wand: true });
      enemy.stationary = true;
      enemy.castsHeld = true;
      return _tutorialMarkEnemy(enemy);
    },
    removeEnemy: _tutorialRemoveEnemy,
    // Magic wand lesson: a wand to try (taken back afterwards unless the player owns one)
    lendWand: () => {
      if (hasMagicWand()) return;
      _tutorialLentWand = true;
      inventoryState[MAGIC_WAND_ITEM_ID] = ensureCatalogEntry(MAGIC_WAND_ITEM_ID, { count: 1 });
      updateManaUI();
      _refreshShowdownButtons();
    },
    returnWand: () => {
      if (!_tutorialLentWand) return;
      _tutorialLentWand = false;
      if (_wandActive) equipInventoryItem(FOAM_SWORD_ITEM_ID);
      delete inventoryState[MAGIC_WAND_ITEM_ID];
      updateManaUI();
      _refreshShowdownButtons();
    },
    getPlayerCasts: () => _playerCasts,
    getMagicBlocks: () => _magicBlocks,
    isPlayerFrozen: () => isPlayerFrozen(),
    freezePlayer: (seconds) => freezePlayer(seconds),
    thawPlayer: () => thawPlayer(),
    magicBlastsInFlight: () => magicBlasts.count(),
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
    unequipAll: () => {
      getEquippedInventoryItemIds().forEach((itemId) => unequipInventoryItem(itemId));
      _refreshShowdownButtons();
    },
    getAmmo: () => getPistolAmmoCount(),
    addAmmo: _tutorialAddAmmo,
    onComplete: async () => {
      if (playerProfile) playerProfile.tutorialCompleted = true;
      if (profileNameKey) void saveTutorialCompleted(profileNameKey);
      clearTimeout(_psWinHideTimer);
      _psWinOverlay.classList.remove('ps-win-banner');
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
    town?.exit();
    seaStart?.exit();
    _psStopSong();
    village?.exit();
    _psRoamQuest = null;
    _voyageEnd();
    _villageUnsheathe();
    deathCarry?.cancel();
    playerControls?.cancelClimb?.();
    if (playerRoll) finishPlayerRoll();
    _classicStageOverlay?.classList.add('hidden');
    _classicClearCallout();
    _classicCountdown = false;
    _classicSetPlaying(false);
    for (let i = hordeEnemies.length - 1; i >= 0; i--) _tutorialRemoveEnemy(hordeEnemies[i]);
    _psClearSpared();
    _psCloseBossTalk();
    playerBombs?.clear();
    magicBlasts.clear();
    thawPlayer();
    _wandShieldHold = false;
    // (the wand is Showdown's: other modes start with the sword)
    if (_wandActive) equipInventoryItem(FOAM_SWORD_ITEM_ID);
    heartBubbles.clear();
    stageChests.clear();
    comboMeter.reset();
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
    // Back to day (a Showdown night stage must not carry over into the menu / other modes)
    lastAutoMode = 'day';
    applyPresetForMode('day');
    applyDisplaySettings();
    clearRoadLightPool();
    tutorialCtx.equipSword();
    // Tutorial / Multiplayer play as the village boy; Showdown applies its pick on the stage screen
    setPlayerCharacterUrl(playerModel, glbCharacterConfig.villageBoyUrl);
  };

  // Classic mode on/off: HUD classes, no blood, Classic combo pop-ups, CLASSIC_HEARTS max health
  const _setClassicMode = (on) => {
    const next = !!on;
    if (next === _classicMode) return;
    _classicMode = next;
    document.body.classList.toggle('classic-mode', next);
    if (!next) _classicSetPlaying(false);
    setBloodEnabled(!next);
    comboMeter.setClassic(next);
    duelMaxHealthOverride = next ? CLASSIC_HEARTS : null;
    updateHealthUI();
    playerControls?.refreshActionButtons?.();
  };
  const startClassicMode = async () => {
    _setClassicMode(true);
    _resetForMenu();
    // Sword only (a bought gun / shield stays in the inventory for Showdown)
    tutorialCtx.equipSword();
    setStat('health', CLASSIC_HEARTS, { skipSave: true });
    lastAutoMode = 'day';
    applyPresetForMode('day');
    applyDisplaySettings();
    clearRoadLightPool();
    _psStage = _classicSavedStage();
    if (profileNameKey) {
      const fbStage = await loadClassicStage(profileNameKey).catch(() => 1);
      if (!_classicMode) return; // left Classic while loading
      _psStage = Math.max(_psStage, fbStage);
      try { const k = _classicStageLsKey(); if (k) localStorage.setItem(k, _psStage); } catch (_) {}
    }
    _classicShowStageOverlay(_psStage, (count) => _psStartStage(_psStage, count));
  };
  // "Back" on the Classic stage screen → start screen
  document.getElementById('classic-stage-back')?.addEventListener('click', () => {
    _setClassicMode(false);
    _resetForMenu();
    arcadeOverlay.showStartScreen();
  });

  // Where the tutorial is played (island town; Settings → Dev → Free Roam → "Copy location")
  const TUTORIAL_LOCATION = { x: -25.83, y: -0.17, z: -85.88, yaw: -0.11 };
  const startTutorialMode = () => {
    _resetForMenu();
    _teleportPlayer(TUTORIAL_LOCATION.x, TUTORIAL_LOCATION.z, TUTORIAL_LOCATION.yaw);
    lastAutoMode = 'day';
    applyPresetForMode('day');
    applyDisplaySettings();
    clearRoadLightPool();
    showdownTutorial.start();
  };

  // ── Multiplayer mode: lobby + 1v1 sword duels (src/multiplayer/duelMode.js) ──
  const DUEL_HEALTH_SEGMENTS = 8;      // every duelist, every round, whatever their Showdown max
  const DUEL_WALK_STOP_DIST = 1.4;     // auto-walk toward the opponent stops this close (m)
  const DUEL_MIN_SPACING = 1.0;        // closer than this, step back (too close to land a swing)
  const DUEL_SPACING_SPEED = 1.5;      // m/s while stepping back
  let _duelWalking = false;            // walking in toward the opponent after "FIGHT!"
  const _duelSwordLocalPos = new THREE.Vector3();
  const _duelSwordLocalQ = new THREE.Quaternion();
  const _round3 = (v) => Math.round(v * 1000) / 1000;
  const _round2 = (v) => Math.round(v * 100) / 100;
  const _shieldHitFrom = { position: new THREE.Vector3() };
  let _duelCamLastYaw = null;
  let _duelCamManualUntil = 0;
  // Town: the sword / wand's camera auto-aim at whoever's coming at the player (town.threats)
  let _townCamLastYaw = null;
  let _townCamManualUntil = 0;
  let _townCamTarget = null;          // the threat tracked last frame (its feet)
  const TOWN_AIM_RANGE = 12;          // m
  const TOWN_AIM_MANUAL_MS = 2500;    // ms turning by hand pauses it
  const TOWN_AIM_SWITCH_CLOSER = 2.5; // m another threat must be closer to take over
  const _teleportPlayer = (x, z, yaw) => {
    const groundY = getSpawnY(x, z, 0);
    const y = Number.isFinite(groundY) ? groundY : playerModel.position.y;
    playerModel.position.set(x, y, z);
    playerControls.playerX = x;
    playerControls.playerY = y;
    playerControls.playerZ = z;
    playerControls.lastPosition?.set(x, y, z);
    if (playerControls.body) {
      playerControls.body.setTranslation({ x, y: y + 0.6, z }, true);
      playerControls.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    }
    if (Number.isFinite(yaw)) {
      playerControls.yaw = yaw;
      playerModel.rotation.set(0, yaw, 0);
      _duelCamLastYaw = yaw;
    }
    _playerKnockback.endTime = 0;
  };
  const _duelDayLighting = () => {
    lastAutoMode = 'day';
    applyPresetForMode('day');
    applyDisplaySettings();
    clearRoadLightPool();
  };
  // Where am I? ({x, y, z, yaw}, rounded — Settings → Dev "Copy location", Free Roam)
  const _playerPose = () => {
    const yaw = Math.atan2(Math.sin(playerControls.yaw), Math.cos(playerControls.yaw));
    return {
      x: _round2(playerModel.position.x),
      y: _round2(playerModel.position.y),
      z: _round2(playerModel.position.z),
      yaw: _round2(yaw)
    };
  };
  const duelCtx = {
    scene,
    recordMultiplayerResult: _recordMultiplayerResult,
    openLeaderboard: () => openLeaderboard('mpWins'),
    getMultiplayer: () => multiplayer,
    startMultiplayer: () => startMultiplayer(),
    // (not while a shared Town holds the connection — duelMode stops it a moment after leaving)
    stopMultiplayer: () => { if (!townNet?.isOn()) stopMultiplayer(); },
    getPlayerName: () => playerName,
    // A sword for another fighter: the Wii sword (with ball hands) for Mii characters
    createSwordMesh: (characterUrl = null) => {
      const model = createSwordModelInstance({ characterUrl });
      if (!model) return foamSword?.mesh ? foamSword.mesh.clone(true) : null;
      const group = new THREE.Group();
      group.name = 'remote-sword';
      model.scale.multiplyScalar(characterHold(characterUrl).sword);
      group.add(model);
      return group;
    },
    getRemoteModel: (id) => otherPlayers[id]?.model || null,
    removeRemotePlayer: (id) => removeRemotePlayer(id, 'duel-ended'),
    setControlsLocked: (locked) => {
      duelControlsLocked = !!locked;
      if (locked && playerControls) {
        playerControls.keysPressed?.clear?.();
        playerControls.isMoving = false;
      }
      updateControlAvailability();
    },
    promptSwordCalibration: () => _promptSwordCalibration(),
    // Start of every round: back on our feet at the start spot with full duel health
    enterDuel: ({ x, z, yaw }) => {
      // Same health for both duelists, whatever they've upgraded to in Showdown
      duelMaxHealthOverride = DUEL_HEALTH_SEGMENTS;
      _duelWalking = false;
      _resetForMenu();
      _duelDayLighting();
      _teleportPlayer(x, z, yaw);
      setStat('health', DUEL_HEALTH_SEGMENTS, { skipSave: true });
      duelCtx.setControlsLocked(true);
    },
    leaveDuel: () => {
      duelMaxHealthOverride = null;
      _duelWalking = false;
      _resetForMenu();
    },
    // "FIGHT!": walk in toward the opponent until close (like Showdown enemies close in)
    startWalkIn: () => { _duelWalking = true; },
    stopWalkIn: () => {
      if (_duelWalking && playerControls) playerControls.isMoving = false;
      _duelWalking = false;
    },
    reviveRemotePlayer: (id) => otherPlayers[id]?.model?.userData?.qwopRig?.glbCharacter?.revive?.(),
    // Sword pose in the local player's model space (+ grip + block stance) for the opponent
    getLocalSwordState: () => {
      // Mid-roll the sword is put away: no sword, `ro` makes the others play the roll
      if (playerRoll) return { sword: null, hand: null, blocking: false, ro: 1 };
      if (foamSword?.holder !== playerControls || !foamSword.mesh) return null;
      playerModel.updateMatrixWorld();
      _duelSwordLocalPos.copy(foamSword.mesh.position);
      playerModel.worldToLocal(_duelSwordLocalPos);
      _duelSwordLocalQ.copy(playerModel.quaternion).invert().multiply(foamSword.mesh.quaternion);
      const hand = playerModel.userData.foamSwordHandTarget;
      return {
        sword: {
          p: _duelSwordLocalPos.toArray().map(_round3),
          q: _duelSwordLocalQ.toArray().map(_round3)
        },
        hand: hand ? [_round3(hand.x), _round3(hand.y), _round3(hand.z)] : null,
        blocking: !!window.phoneSwordGyro?.blocking
      };
    },
    // The opponent's sword landed on us (battles: also a bullet / bomb blast, `ranged` =
    // { kind, src: [x, z] where it came from } — a raised shield facing it takes the hit;
    // a bubble stops everything)
    applyHit: (dmg, dir, ranged = null) => {
      if (playerDead) return;
      if (isPlayerBubbleActive()) {
        audioManager?.playSFX('SFX/Attacks/Sword Attacks Hits and Blocks/Sword Impact Hit 3.ogg', 0.45, { cooldownKey: 'psw-bubble-block', cooldownMs: 200 });
        return;
      }
      if (ranged && Array.isArray(ranged.src)) {
        _shieldHitFrom.position.set(ranged.src[0], playerModel.position.y, ranged.src[1]);
        if (window.tryBlockLocalPlayerHitWithShield?.({ attackerModel: _shieldHitFrom, damage: dmg })) {
          duelCtx.onShieldHit();
          return;
        }
      }
      window.localHealth = statsState.health - dmg;
      if (dir) {
        const len = Math.hypot(dir[0], dir[1]);
        if (len > 1e-4) {
          _playerKnockback.vx = (dir[0] / len) * 4.5;
          _playerKnockback.vz = (dir[1] / len) * 4.5;
          _playerKnockback.endTime = Date.now() + 500;
        }
      }
      audioManager?.playSFX('SFX/Attacks/Sword Attacks Hits and Blocks/Sword Impact Hit 3.ogg', 0.6, { cooldownKey: 'duel-hurt', cooldownMs: 200 });
    },
    onShieldHit: () => {
      audioManager?.playSFX('SFX/Attacks/Sword Attacks Hits and Blocks/Sword Parry 2.ogg', 0.55, { cooldownKey: 'shield-hit', cooldownMs: 120 });
    },
    // Our block stopped the opponent's swing
    onSwingBlocked: () => {
      window._pswShowBlockFlash?.('player');
      audioManager?.playSFX('SFX/Attacks/Sword Attacks Hits and Blocks/Sword Parry 2.ogg', 0.65, { cooldownKey: 'psw-parry', cooldownMs: 300 });
    },
    // Lobby's Team Battle / Free For All buttons (rule: 'survival' | 'kills')
    openMatch: (mode, rule) => matchMode?.openSetup(mode, rule),
    // "Back" in the lobby: multiplayer is off again, show the start screen
    onExit: () => {
      matchMode?.exit();
      _resetForMenu();
      arcadeOverlay.showStartScreen();
    }
  };
  duelMode = createDuelMode(duelCtx);

  // ── Multiplayer mode: Team Battle / Free For All (src/multiplayer/matchMode.js) ──
  // Same sword rules and health as duels (but no auto-walk: players move themselves, bots
  // still walk to their enemies); up to 10 fighters, bots fill the empty spots (simulated
  // by the battle's host as EnemyPlayers). Everyone starts with the sword; the rest comes
  // from the arena's pickups (matchCtx.applyPickup) and is never saved.
  const MATCH_HEALTH_SEGMENTS = DUEL_HEALTH_SEGMENTS;
  const MATCH_BOT_SWING_CHANCE = 0.35;
  // What each pickup gives
  const MATCH_GUN_AMMO = 12;
  const MATCH_AMMO_PICKUP = 10;
  const MATCH_BOMB_PICKUP = 2;
  const MATCH_MANA_PICKUP = 50;
  const MATCH_HEART_PICKUP = 2;
  const _upAxis = new THREE.Vector3(0, 1, 0);
  const _placeRemote = (entry, x, y, z, yaw) => {
    entry.targetPos.set(x, y, z);
    if (Number.isFinite(yaw)) {
      entry.targetRotY = yaw;
      entry.targetQuat.setFromAxisAngle(_upAxis, yaw);
    }
    entry.model.visible = true;
  };
  // Battle loadout: nothing but the sword (pickups add the rest)
  const _clearMatchItems = () => {
    getEquippedInventoryItemIds().forEach((itemId) => unequipInventoryItem(itemId));
    if (_wandActive) { _wandActive = false; if (foamSword) foamSword.wand = false; }
    playerBombThrow = null;
    playerBombs?.setHeld(null);
    delete inventoryState.pistol;
    delete inventoryState[SHIELD_ITEM_ID];
    delete inventoryState[MAGIC_WAND_ITEM_ID];
    statsState.bombs = 0;
    statsState.bubbles = 0;
    statsState.mana = 0;
    if (_matchLoadout) _matchLoadout.ammoBank = 0;
    lastEquippedBeforeShield = null;
    hideShieldHealthHUD();
    equipInventoryItem(FOAM_SWORD_ITEM_ID);
    playerControls?.refreshActionButtons?.();
    updatePsBombButton();
    updatePsBubbleButton();
    updateManaUI();
  };
  // A bubble for `ms` (Most Kills spawn protection)
  const _grantPlayerBubble = (ms) => {
    bubbleActiveUntil = Math.max(bubbleActiveUntil, Date.now() + ms);
    ensureBubbleMesh().visible = true;
    updatePsBubbleButton();
  };
  const _matchToastIcon = {
    gun: 'pistol', ammo: PISTOL_AMMO_KEY, shield: SHIELD_ITEM_ID, bomb: 'showdown_bomb', wand: MAGIC_WAND_ITEM_ID,
    mana: 'mana_potion', heart: 'heart', potion: 'life_potion', bubble: 'bubble'
  };
  const matchCtx = {
    scene,
    recordMultiplayerResult: _recordMultiplayerResult,
    camera,
    matchHealth: MATCH_HEALTH_SEGMENTS,
    magicDamage: { fire: MAGIC_FIRE_DAMAGE, ice: MAGIC_ICE_DAMAGE },
    magicFreezeSeconds: () => _magicFreezeSeconds(),
    // What a host bot gets from a pickup (as the local player's applyPickup) and a blast costs it
    botLoadout: {
      gunAmmo: MATCH_GUN_AMMO,
      ammoPickup: MATCH_AMMO_PICKUP,
      bombPickup: MATCH_BOMB_PICKUP,
      manaPickup: MATCH_MANA_PICKUP,
      heartPickup: MATCH_HEART_PICKUP,
      maxMana: MAX_MANA,
      manaCost: WAND_MANA_COST
    },
    getMultiplayer: () => multiplayer,
    getPlayerName: () => playerName,
    // Free For All only offers characters unlocked in Showdown
    getUnlockedCharacters: () => _psChars.unlocked,
    getGroundY: (x, z) => getSpawnY(x, z, 0),
    // Pickups / respawns stay out of the water
    isBlocked: (x, z) => _isOverWater(x, z),
    suspendLobby: () => duelMode.suspend(),
    resumeLobby: (flash) => duelMode.resume(flash),
    isLobbyIdle: () => duelMode.isIdleInLobby(),
    createSwordMesh: duelCtx.createSwordMesh,
    // Another fighter's magic wand (posed like their sword)
    createWandMesh: () => {
      const wand = createWandModel();
      const group = new THREE.Group();
      group.name = 'remote-wand';
      group.add(wand);
      return group;
    },
    getRemoteModel: duelCtx.getRemoteModel,
    removeRemotePlayer: (id) => removeRemotePlayer(id, 'match-ended'),
    reviveRemoteModel: (id) => duelCtx.reviveRemotePlayer(id),
    // Another fighter's model, placed at its start spot
    ensureRemoteModel: (id, name, characterUrl, pose) => {
      const entry = otherPlayers[id] || _spawnRemotePlayer(id, name, characterUrl);
      if (pose) {
        const groundY = getSpawnY(pose.x, pose.z, 0);
        const y = Number.isFinite(groundY) ? groundY : playerModel.position.y;
        entry.model.position.set(pose.x, y, pose.z);
        entry.model.rotation.set(0, pose.yaw, 0);
        _placeRemote(entry, pose.x, y, pose.z, pose.yaw);
        entry.model.quaternion.copy(entry.targetQuat);
      }
      return entry;
    },
    // Position/heading from the battle's state / bots messages
    setRemotePose: (id, pos, yaw, name, characterUrl) => {
      const entry = otherPlayers[id] || _spawnRemotePlayer(id, name, characterUrl);
      _placeRemote(entry, pos[0], pos[1], pos[2], yaw);
    },
    setControlsLocked: duelCtx.setControlsLocked,
    enterMatch: ({ x, z, yaw, characterUrl }) => {
      matchCtx.endMatchLoadout();
      duelCtx.enterDuel({ x, z, yaw });
      setPlayerCharacterUrl(playerModel, characterUrl);
      matchCtx.startMatchLoadout();
      _promptSwordCalibration();
    },
    leaveMatch: () => {
      matchCtx.endMatchLoadout();
      setPlayerCharacterUrl(playerModel, glbCharacterConfig.villageBoyUrl);
      duelCtx.leaveDuel();
    },
    // Set the real gun / shield / wand / bombs / bubbles / mana aside (put back by
    // endMatchLoadout) and start with the sword only; nothing is saved meanwhile
    startMatchLoadout: () => {
      if (_matchLoadout) return;
      _matchLoadout = {
        ammoBank: 0,
        saved: {
          pistol: inventoryState.pistol,
          shield: inventoryState[SHIELD_ITEM_ID],
          wand: inventoryState[MAGIC_WAND_ITEM_ID],
          bombs: statsState.bombs,
          bubbles: statsState.bubbles,
          mana: statsState.mana
        }
      };
      _statSavesSuspended = true;
      document.body.classList.add('match-loadout');
      _clearMatchItems();
    },
    endMatchLoadout: () => {
      if (!_matchLoadout) return;
      getEquippedInventoryItemIds().forEach((itemId) => unequipInventoryItem(itemId));
      if (_wandActive) { _wandActive = false; if (foamSword) foamSword.wand = false; }
      deactivatePlayerBubble();
      playerBombThrow = null;
      playerBombs?.setHeld(null);
      playerBombs?.clear();
      const { saved } = _matchLoadout;
      _matchLoadout = null;
      document.body.classList.remove('match-loadout');
      const putBack = (key, value) => {
        if (value) inventoryState[key] = value;
        else delete inventoryState[key];
      };
      putBack('pistol', saved.pistol);
      putBack(SHIELD_ITEM_ID, saved.shield);
      putBack(MAGIC_WAND_ITEM_ID, saved.wand);
      statsState.bombs = saved.bombs;
      statsState.bubbles = saved.bubbles;
      statsState.mana = saved.mana;
      _statSavesSuspended = false;
      lastEquippedBeforeShield = null;
      hideShieldHealthHUD();
      equipInventoryItem(FOAM_SWORD_ITEM_ID);
      playerControls?.refreshActionButtons?.();
      updatePsBombButton();
      updatePsBubbleButton();
      updateManaUI();
    },
    // A pickup we walked over (granted by the battle's host)
    applyPickup: (type) => {
      if (!_matchLoadout || playerDead) return;
      const hasGun = (inventoryState.pistol?.count ?? 0) > 0;
      let text = '';
      if (type === 'gun') {
        const ammo = MATCH_GUN_AMMO + _matchLoadout.ammoBank;
        _matchLoadout.ammoBank = 0;
        if (hasGun) {
          inventoryState.pistol = { ...inventoryState.pistol, [PISTOL_AMMO_KEY]: getPistolAmmoCount() + ammo };
          text = `+${ammo} Bullets`;
        } else {
          inventoryState.pistol = ensureCatalogEntry('pistol', { count: 1, [PISTOL_AMMO_KEY]: ammo });
          text = `Gun · ${ammo} bullets`;
        }
      } else if (type === 'ammo') {
        if (hasGun) {
          inventoryState.pistol = { ...inventoryState.pistol, [PISTOL_AMMO_KEY]: getPistolAmmoCount() + MATCH_AMMO_PICKUP };
          text = `+${MATCH_AMMO_PICKUP} Bullets`;
        } else {
          _matchLoadout.ammoBank += MATCH_AMMO_PICKUP;
          text = `+${MATCH_AMMO_PICKUP} Bullets (for when you find a gun)`;
        }
      } else if (type === 'shield') {
        inventoryState[SHIELD_ITEM_ID] = ensureCatalogEntry(SHIELD_ITEM_ID, normalizeShieldEntry({
          count: 1,
          [SHIELD_HEALTH_KEY]: MATCH_SHIELD_HEALTH,
          [SHIELD_MAX_HEALTH_KEY]: MATCH_SHIELD_HEALTH
        }));
        if (isInventoryItemEquipped(SHIELD_ITEM_ID)) {
          updateShieldHealthHUD(MATCH_SHIELD_HEALTH, MATCH_SHIELD_HEALTH, 1);
        }
        text = 'Shield';
      } else if (type === 'bomb') {
        setStat('bombs', getPlayerBombCount() + MATCH_BOMB_PICKUP, { skipSave: true });
        text = `+${MATCH_BOMB_PICKUP} Bombs`;
      } else if (type === 'wand') {
        const had = hasMagicWand();
        inventoryState[MAGIC_WAND_ITEM_ID] = ensureCatalogEntry(MAGIC_WAND_ITEM_ID, { count: 1 });
        setStat('mana', MAX_MANA, { skipSave: true });
        text = had ? 'Mana refilled' : 'Magic Wand · swipe to cast';
      } else if (type === 'mana') {
        setStat('mana', Math.min(MAX_MANA, getMana() + MATCH_MANA_PICKUP), { skipSave: true });
        text = `+${MATCH_MANA_PICKUP} Mana`;
      } else if (type === 'heart' || type === 'potion') {
        const before = statsState.health;
        const next = type === 'heart' ? before + MATCH_HEART_PICKUP : effectiveMaxHealthSegments();
        setStat('health', next, { skipSave: true });
        const gained = Math.max(0, Math.round(statsState.health - before));
        text = gained > 0 ? `+${gained} Health` : 'Health already full';
      } else if (type === 'bubble') {
        setStat('bubbles', getBubbleCount() + 1, { skipSave: true });
        text = '+1 Bubble';
      } else {
        return;
      }
      // (a gun in hand shows its new bullet count)
      if ((type === 'gun' || type === 'ammo') && isInventoryItemEquipped('pistol')) {
        playerControls?.setAmmo?.(getPistolAmmoCount(), getAmmoLabelForType('bullet'), getAmmoIconForType('bullet'));
      }
      playerControls?.refreshActionButtons?.();
      updatePsBombButton();
      updatePsBubbleButton();
      updateManaUI();
      audioManager?.playSFX?.('SFX/Spells/Waterspray 1.ogg', 0.55, { cooldownKey: 'match-pickup', cooldownMs: 120 });
      showPickupToast(_matchToastIcon[type] || type, 1, '', { text });
    },
    // Most Kills: back on our feet at `pose`, full health, sword only, a spawn bubble
    respawnLocal: ({ x, z, yaw }, protectMs = 0) => {
      thawPlayer();
      respawnPlayer();
      _teleportPlayer(x, z, yaw);
      setStat('health', MATCH_HEALTH_SEGMENTS, { skipSave: true });
      _clearMatchItems();
      if (protectMs > 0) _grantPlayerBubble(protectMs);
    },
    // 'sword' | 'wand' | 'gun' | 'shield' | null — what the local player holds (sent to the
    // other fighters)
    getLocalWeapon: () => {
      if (isOarEquipped()) return null; // (Town's canoe oar: not drawn for others)
      if (isWandEquipped()) return 'wand';
      if (isRodEquipped()) return 'rod';
      if (isInventoryItemEquipped('pistol')) return 'gun';
      if (isInventoryItemEquipped(SHIELD_ITEM_ID)) return 'shield';
      if (foamSword?.holder === playerControls) return 'sword';
      return null;
    },
    isBubbleActive: () => isPlayerBubbleActive(),
    // The gun / shield other fighters hold, posed like the local player's: model clone,
    // hold offset + rotation on the weapon hand, and where both hands grip it
    getWeaponGear: () => {
      if (!pistol?.mesh || !shield?.mesh) return null;
      const cloneOf = (weapon) => () => {
        const mesh = weapon.mesh.clone(true);
        mesh.children
          .filter((child) => child.name === 'shield-health-bar')
          .forEach((child) => mesh.remove(child));
        mesh.position.set(0, 0, 0);
        mesh.traverse((child) => {
          child.visible = child.name !== 'shield-health-bar';
          if (child.isMesh) child.castShadow = true;
        });
        return mesh;
      };
      const gearOf = (weapon, kind) => {
        // The pose the player holds it in (a weapon not in hand still has its constructor's)
        _applyWeaponHoldCfg(weapon, kind);
        const { offset, quaternion } = weapon.getHoldPose();
        return { createMesh: cloneOf(weapon), offset, quaternion, grip: weapon.getGripTarget(new THREE.Vector3()) };
      };
      return { gun: gearOf(pistol, 'gun'), shield: gearOf(shield, 'shield') };
    },
    // A battle blast someone else cast (matchMode picks its targets)
    spawnMagic: ({ origin, forward, line, element, caster }) => {
      magicBlasts.spawn({
        origin, forward, line, element, side: 'match', caster,
        speed: PLAYER_BLAST_SPEED_MPS, length: PLAYER_BLAST_LENGTH,
      });
    },
    // The local player as a blast target ({ center, radius, blocks(blast), onHit(blast) })
    getLocalBlastTarget: () => _playerBlastTarget,
    // A bullet fired by another fighter (or a host bot) — damage is decided by matchMode
    spawnShot: (origin, dir, shooterId) => spawnPistolBullet(origin, dir, shooterId),
    // A bomb lobbed from `origin` to `target`; its blast hits `getBlastTargets()`
    launchBomb: (origin, target, getBlastTargets, keepHeld) => {
      playerBombs?.throw(origin, target, { getBlastTargets, keepHeld });
    },
    onShieldHit: () => duelCtx.onShieldHit(),
    stopWalk: duelCtx.stopWalkIn,
    getLocalPlayerModel: () => playerModel,
    getPlayerControls: () => playerControls,
    getLocalHealth: () => statsState.health,
    getLocalSwordState: duelCtx.getLocalSwordState,
    applyHit: duelCtx.applyHit,
    onSwingBlocked: duelCtx.onSwingBlocked,
    // A host bot's sword landed on the local player (damage is applied by EnemyPlayer)
    knockbackLocal: (dir) => {
      _playerKnockback.vx = dir.x * 4.5;
      _playerKnockback.vz = dir.z * 4.5;
      _playerKnockback.endTime = Date.now() + 500;
    },
    spawnBlood: (pos, groundY) => spawnBloodBurst(scene, pos, { groundY, intensity: 0.8 }),
    createBot: ({ x, z, yaw, characterUrl }) => {
      const groundY = getSpawnY(x, z, 0);
      const y = Number.isFinite(groundY) ? groundY : playerModel.position.y;
      const bot = new EnemyPlayer(scene, RAPIER, rapierWorld, {
        position: new THREE.Vector3(x, y, z),
        hearts: MATCH_HEALTH_SEGMENTS,
        characterUrl,
        swordDamage: 1,
        showHealthBar: false,
        swingChance: MATCH_BOT_SWING_CHANCE,
      });
      bot.group.rotation.y = yaw;
      bot._camera = camera;
      return bot;
    }
  };
  matchMode = createMatchMode(matchCtx);

  const startMultiplayerMode = () => {
    _resetForMenu();
    _duelDayLighting();
    duelMode.enter();
  };

  // ── Dev: Free Roam (Settings → Dev) — walk the map, copy locations, record stage routes ──
  devRoam = createDevRoam({
    scene,
    getPlayerPose: _playerPose,
    getGroundY: (x, z) => getTerrainHeight(x, z),
    getMapKey: () => _activeMapKey,
    teleport: (x, z) => _teleportPlayer(x, z),
    onExit: () => { void appState.returnToLobby(); },
  });
  // (Settings → Dev "Show routes in the world" is remembered)
  try { if (localStorage.getItem('sq:devShowRoutes') === '1') devRoam.setRoutesVisible(true); } catch (_) {}
  const startDevRoamMode = () => {
    _resetForMenu();
    devRoam.enter();
  };

  // ── Town loadout: the gear, coins and health the player has in Town (src/town/townMode.js
  // keeps them in its save) instead of the real inventory and stats, which are set aside
  // meanwhile (and are still what gets saved — _saveAside). Nothing to start with but a few
  // coins: even the sword is bought, and Showdown's coins / max health don't come along.
  const TOWN_ITEM_IDS = [FOAM_SWORD_ITEM_ID, 'pistol', SHIELD_ITEM_ID, MAGIC_WAND_ITEM_ID];
  // (stats Town keeps its own of: Showdown's wait in _saveAside meanwhile)
  const TOWN_ASIDE_STATS = ['coins', 'health', 'maxHealthSegments', 'level', 'xp', 'strength', 'bombs', 'bubbles', 'mana'];
  const TOWN_START_COINS = 5;
  // Town's wallet holds TOWN_WALLET_MAX coins (the rest stays on the ground, or in the chest at
  // home — townHomes.js); room left in it (Infinity outside Town)
  const _townWalletRoom = () => (_townLoadout ? Math.max(0, TOWN_WALLET_MAX - (Number.isFinite(statsState.coins) ? statsState.coins : 0)) : Infinity);
  let _townWalletToastAt = 0;
  const _townWalletFullToast = () => {
    if (performance.now() - _townWalletToastAt < 4000) return;
    _townWalletToastAt = performance.now();
    showPickupToast('coins', 1, '', { text: `Wallet full (${TOWN_WALLET_MAX}) — keep some in your chest at home` });
  };
  // Town's coins in: what fits in the wallet; the rest drops as coins at the player's feet
  // (picked up once there's room)
  const _townAddCoins = (delta) => {
    if (!(delta > 0)) { appState.addCoins(delta); return; }
    const fit = Math.min(delta, _townWalletRoom());
    if (fit > 0) appState.addCoins(fit);
    let rest = Math.floor(delta - fit);
    if (rest <= 0) return;
    _townWalletFullToast();
    const piles = Math.min(6, rest);
    for (let i = 0; i < piles; i++) {
      const value = Math.ceil(rest / (piles - i));
      rest -= value;
      spawnCoinPickup(playerModel.position.clone().add(new THREE.Vector3((Math.random() - 0.5) * 1.6, 0, (Math.random() - 0.5) * 1.6)), { value });
    }
  };
  const TOWN_HEALTH_SEGMENTS = SHOWDOWN_BASE_HEALTH_SEGMENTS;
  const TOWN_GUN_AMMO = 12;        // bullets that come with a gun
  const TOWN_MANA_REFILL = 50;     // a mana purchase
  // { sword, rod, gun, ammo, shield (health), wand, mana, bombs, bubbles, coins, health }
  const _townItems = () => ({
    coins: Number.isFinite(statsState.coins) ? statsState.coins : 0,
    health: statsState.health,
    sword: !!_townLoadout?.hasSword,
    rod: !!_townLoadout?.hasRod,
    broom: !!_townLoadout?.hasBroom,
    gun: (inventoryState.pistol?.count ?? 0) > 0,
    ammo: getPistolAmmoCount(),
    shield: (inventoryState[SHIELD_ITEM_ID]?.count ?? 0) > 0
      ? normalizeShieldEntry(inventoryState[SHIELD_ITEM_ID])[SHIELD_HEALTH_KEY] : 0,
    wand: hasMagicWand(),
    mana: getMana(),
    bombs: getPlayerBombCount(),
  });
  const _refreshGearUI = () => {
    if ((inventoryState.pistol?.count ?? 0) > 0 && isInventoryItemEquipped('pistol')) {
      playerControls?.setAmmo?.(getPistolAmmoCount(), getAmmoLabelForType('bullet'), getAmmoIconForType('bullet'));
    }
    playerControls?.refreshActionButtons?.();
    updatePsBombButton();
    updatePsBubbleButton();
    updateManaUI();
  };
  const _setTownItems = (items = {}) => {
    _townLoadout.hasSword = !!items.sword;
    _townLoadout.hasRod = !!items.rod;
    _townLoadout.hasBroom = !!items.broom;
    // (the wand and the rod are the sword in another form: they need the sword's inventory entry too)
    if (items.sword || items.wand || items.rod) inventoryState[FOAM_SWORD_ITEM_ID] = ensureCatalogEntry(FOAM_SWORD_ITEM_ID, { count: 1 });
    else delete inventoryState[FOAM_SWORD_ITEM_ID];
    if (items.gun) inventoryState.pistol = ensureCatalogEntry('pistol', { count: 1, [PISTOL_AMMO_KEY]: Math.max(0, Math.floor(items.ammo || 0)) });
    else delete inventoryState.pistol;
    if (items.shield > 0) {
      inventoryState[SHIELD_ITEM_ID] = ensureCatalogEntry(SHIELD_ITEM_ID, normalizeShieldEntry({
        count: 1, [SHIELD_HEALTH_KEY]: Math.min(MATCH_SHIELD_HEALTH, items.shield), [SHIELD_MAX_HEALTH_KEY]: MATCH_SHIELD_HEALTH,
      }));
    } else delete inventoryState[SHIELD_ITEM_ID];
    if (items.wand) inventoryState[MAGIC_WAND_ITEM_ID] = ensureCatalogEntry(MAGIC_WAND_ITEM_ID, { count: 1 });
    else delete inventoryState[MAGIC_WAND_ITEM_ID];
    statsState.mana = Math.max(0, Math.min(MAX_MANA, Math.floor(items.mana || 0)));
    statsState.bombs = Math.max(0, Math.floor(items.bombs || 0));
  };
  const startTownLoadout = (items) => {
    if (_townLoadout) return;
    _putWeaponsAway();
    const aside = { stats: {}, inventory: {} };
    TOWN_ASIDE_STATS.forEach((key) => { aside.stats[key] = statsState[key]; });
    TOWN_ITEM_IDS.forEach((id) => { aside.inventory[id] = inventoryState[id] ?? null; });
    _saveAside = aside;
    _townLoadout = { hasSword: false, hasRod: false, hasBroom: false };
    _setTownItems(items);
    // The town's own wallet and hearts (a save from before Town had its own: a few coins)
    statsState.coins = Number.isFinite(items.coins) ? Math.max(0, Math.floor(items.coins)) : TOWN_START_COINS;
    statsState.maxHealthSegments = TOWN_HEALTH_SEGMENTS;
    statsState.health = items.health > 0 ? Math.min(TOWN_HEALTH_SEGMENTS, Math.round(items.health)) : TOWN_HEALTH_SEGMENTS;
    updateHealthUI();
    _refreshGearUI();
  };
  // Back to the real inventory; returns the town's gear (for its save)
  const endTownLoadout = () => {
    if (!_townLoadout) return null;
    _broomRide?.dismount();
    const items = _townItems();
    _putWeaponsAway();
    deactivatePlayerBubble();
    playerBombs?.clear();
    const aside = _saveAside;
    _saveAside = null;
    _townLoadout = null;
    for (const [id, entry] of Object.entries(aside.inventory)) {
      if (entry) inventoryState[id] = entry;
      else delete inventoryState[id];
    }
    Object.assign(statsState, aside.stats);
    updateHealthUI();
    updatePlayerInfoUI();
    equipInventoryItem(FOAM_SWORD_ITEM_ID);
    _refreshGearUI();
    return items;
  };
  // A purchase at the town's market: 'sword' | 'rod' | 'gun' | 'ammo' | 'shield' | 'bomb' |
  // 'wand' | 'mana' | 'broom' (n: how many bullets / bombs). Returns false when it can't be had.
  const grantTownItem = (kind, n = 1) => {
    if (!_townLoadout) return false;
    const items = _townItems();
    const nothingInHand = !_heldWeaponId();
    if (kind === 'sword') items.sword = true;
    else if (kind === 'rod') { if (items.rod) return false; items.rod = true; }
    else if (kind === 'broom') { if (items.broom) return false; items.broom = true; }
    else if (kind === 'gun') { items.ammo = (items.gun ? items.ammo : 0) + TOWN_GUN_AMMO; items.gun = true; }
    else if (kind === 'ammo') { if (!items.gun) return false; items.ammo += n; }
    else if (kind === 'shield') items.shield = MATCH_SHIELD_HEALTH;
    else if (kind === 'bomb') items.bombs += n;
    else if (kind === 'wand') { items.wand = true; items.mana = MAX_MANA; }
    else if (kind === 'mana') { if (items.mana >= MAX_MANA) return false; items.mana = Math.min(MAX_MANA, items.mana + TOWN_MANA_REFILL); }
    else return false;
    const held = _heldWeaponId();
    _setTownItems(items);
    // (a gun / shield / the rod held while it's replaced: picked up again)
    if (held === 'pistol' || held === SHIELD_ITEM_ID || held === FISHING_ROD_ITEM_ID) equipInventoryItem(held);
    // A first weapon goes straight into the hand
    if (nothingInHand && (kind === 'sword' || kind === 'gun' || kind === 'wand')) {
      equipInventoryItem(kind === 'sword' ? FOAM_SWORD_ITEM_ID : kind === 'gun' ? 'pistol' : MAGIC_WAND_ITEM_ID);
    }
    _refreshGearUI();
    return true;
  };

  // ── Town mode (start screen → Town): the town of houses as a living place (src/town/townMode.js) ──
  const _townMapObjectBox = new THREE.Box3();
  // The active map's placed road lamps (townLights.js lights them at night)
  const ROAD_LAMP_FILE_RE = /road_light/i;
  let _roadLampsOf = null;
  let _roadLamps = [];
  let _roadLampsGlowing = false;
  const _mapRoadLamps = () => {
    if (_roadLampsOf === _activeMap) return _roadLamps;
    _roadLampsOf = _activeMap;
    _roadLamps = [];
    _roadLampsGlowing = false;
    const visit = (o) => {
      if (ROAD_LAMP_FILE_RE.test(o.userData?.mapObject?.modelFile ?? '')) { _roadLamps.push(o); return; }
      o.children.forEach(visit);
    };
    if (_activeMap) visit(_activeMap.group);
    return _roadLamps;
  };
  // A town fighter in a standoff (bandits at their camp): stands its ground facing the player,
  // sword drawn, and doesn't attack (nor use its gear) until let go
  const _townSetFighterPassive = (enemy, on) => {
    enemy._townPassive = on;
    enemy.script = on ? { mode: 'passive' } : null;
    enemy.stationary = on;
  };
  // Town's shared room: assignment, the connection, the other players (src/town/townNet.js)
  const TOWN_PVP_BOMB_DAMAGE = 2; // (a battle's BOMB_DAMAGE)
  townNet = createTownNet({
    scene,
    getMultiplayer: () => multiplayer,
    startMultiplayer: (roomId) => startMultiplayer(roomId),
    stopMultiplayer: () => stopMultiplayer(),
    profileKey: () => profileNameKey,
    // (a guest holds a town place by this device)
    memberKey: () => profileNameKey || `guest_${_guestDeviceId().replace(/[^a-z0-9-]/gi, '')}`,
    getPlayerName: () => playerName || 'Player',
    getRemoteModel: (id) => otherPlayers[id]?.model || null,
    setRemoteCharacter: (id, url) => setPlayerCharacterUrl(otherPlayers[id]?.model, url),
    createSwordMesh: duelCtx.createSwordMesh,
    createWandMesh: () => matchCtx.createWandMesh(),
    // Another player's fishing rod (posed like their sword)
    createRodMesh: () => {
      const group = new THREE.Group();
      group.name = 'remote-rod';
      const rod = createFishingRodModel();
      rod.rotation.x = ROD_HOLD_PITCH;
      group.add(rod);
      return group;
    },
    getLocalWeapon: () => matchCtx.getLocalWeapon(),
    getWeaponGear: () => matchCtx.getWeaponGear(),
    getLocalSwordState: duelCtx.getLocalSwordState,
    getLocalPosition: () => playerModel.position,
    // Another player's bomb: its blast can only hurt us here (BOMB_DAMAGE as in battles)
    launchRemoteBomb: (origin, target, fromId) => {
      playerBombs.throw(origin, target, {
        keepHeld: true,
        getBlastTargets: () => (playerDead || !town?.isActive() ? [] : [{
          group: playerModel,
          isDead: false,
          applyDamage: () => false,
          applyBlastKnockback: ({ direction }) => {
            const src = playerModel.position.clone().sub(direction);
            town.onPvpHurt(fromId);
            townNet.sendHurt(fromId, town.getStars());
            duelCtx.applyHit(TOWN_PVP_BOMB_DAMAGE, [direction.x, direction.z], { kind: 'bomb', src: [src.x, src.z] });
          },
        }]),
      });
    },
    spawnRemoteMagic: ({ origin, forward, line, element, caster }) => {
      magicBlasts.spawn({ origin, forward, line, element, side: 'town', caster, speed: PLAYER_BLAST_SPEED_MPS, length: PLAYER_BLAST_LENGTH });
    },
    getLocalCharacterUrl: () => playerModel.userData.qwopRig?.characterUrl ?? null,
    getStars: () => town?.getStars() ?? 0,
    getStatus: () => ({ coins: appState.getCoins(), hp: statsState.health, maxHp: effectiveMaxHealthSegments() }),
    applyPvpHit: (dmg, dir, fromId, ranged) => {
      if (!town?.isActive() || playerDead) return;
      town.onPvpHurt(fromId);
      duelCtx.applyHit(dmg, dir, ranged);
    },
    onSwingBlocked: () => duelCtx.onSwingBlocked(),
    onAttackPlayer: (info) => town?.onAttackPlayer(info),
    onBounty: (name, coins) => town?.onBounty(name, coins),
    onWorldMessage: (from, data) => town?.handleNet(from, data),
  });
  // (Town's canoe and the sea start's) m of water over the map's ground (0: dry land; out past the map's ground: deep)
  const _waterDepthAt = (x, z) => {
    const level = _activeMap?.water?.(x, z);
    if (level == null) return 0;
    const ground = _glbResolveHeight(x, z);
    return Number.isFinite(ground) ? Math.max(0, level - ground) : Infinity;
  };
  const _carryPlayer = (x, y, z, dYaw) => {
    if (!playerControls || !playerModel) return;
    playerControls.playerX = x;
    playerControls.playerZ = z;
    playerModel.position.x = x;
    playerModel.position.z = z;
    if (Number.isFinite(y) && Math.abs(y - playerControls.playerY) < 0.5) {
      playerControls.playerY = y;
      playerModel.position.y = y;
    }
    if (dYaw) {
      playerControls.yaw += dYaw;
      playerModel.rotation.y += dYaw;
      _duelCamLastYaw = playerControls.yaw;
    }
  };
  // The joystick (on screen / the phone's) or WASD as { fwd, turn } (−1…1; turn > 0 = right) —
  // else, with the oar out, the phone's tilt (_oarTiltSteer)
  const _getSteer = () => {
    if (!playerControls) return { fwd: 0, turn: 0 };
    const f = playerControls.joystickForce;
    if (f > 0.1) return { fwd: Math.sin(playerControls.joystickAngle) * f, turn: Math.cos(playerControls.joystickAngle) * f };
    const k = playerControls.keysPressed;
    const fwd = (k.has('w') ? 1 : 0) - (k.has('s') ? 1 : 0);
    const turn = (k.has('d') ? 1 : 0) - (k.has('a') ? 1 : 0);
    return (!fwd && !turn && _oarTiltSteer()) || { fwd, turn };
  };
  town = createTownMode({
    net: townNet,
    scene,
    camera,
    domElement: renderer.domElement,
    getPlayerPosition: () => playerModel.position,
    // (the market's shop camera frames a counter from where the player stands)
    setPlayerHidden: (hidden) => { playerModel.visible = !hidden; },
    getPlayerName: () => playerName || 'friend',
    getPlayerCharacterUrl: () => playerModel?.userData?.qwopRig?.characterUrl ?? null, // (the player's voice — townMode.js)
    isPlayerDead: () => playerDead,
    getGroundY: (x, z) => getTerrainHeight(x, z),
    isOverWater: (x, z) => _isOverWater(x, z),
    // The water's surface height there (null on dry ground) — the fishing bobber floats on it
    getWaterY: (x, z) => _activeMap?.water?.(x, z) ?? null,
    // The player's model (the fishing rod is held by it)
    getPlayerModel: () => playerModel,
    pathAt: (x, z) => _activeMap?.paths?.(x, z) ?? null,
    // The active map's placed objects (houses, trees…) with their centres inside `b` (`object`:
    // its placement wrapper — Town's trees are felled by posing it, townTrees.js)
    getMapObjects: (b) => {
      const out = [];
      const visit = (o) => {
        const mo = o.userData?.mapObject;
        if (mo) {
          _townMapObjectBox.setFromObject(o);
          if (!_townMapObjectBox.isEmpty()) {
            const c = _townMapObjectBox.getCenter(new THREE.Vector3());
            const size = _townMapObjectBox.getSize(new THREE.Vector3());
            if (c.x >= b.minX && c.x <= b.maxX && c.z >= b.minZ && c.z <= b.maxZ) {
              // (local: the object's own frame — its GLB's axes — and its bounds there, for
              // spots on the model like a house's front door)
              const local = new THREE.Box3();
              const inv = new THREE.Matrix4().copy(o.matrixWorld).invert();
              o.traverse((m) => {
                if (!m.isMesh || !m.geometry) return;
                if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
                local.union(m.geometry.boundingBox.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld)));
              });
              out.push({
                file: mo.modelFile ?? '', x: c.x, z: c.z, radius: Math.max(size.x, size.z) / 2,
                local, matrix: o.matrixWorld.clone(), id: mo.id, object: o,
              });
            }
          }
          return; // (its own meshes aren't separate objects)
        }
        o.children.forEach(visit);
      };
      if (_activeMap) visit(_activeMap.group);
      return out;
    },
    // Each placed road lamp's head: its light goes just under the top, like the night road
    // lights' (ROAD_LIGHT_POINT_LIGHT_CONFIG.yOffset of the 1-unit-tall model)
    getRoadLamps: () => _mapRoadLamps().map((o) => {
      _townMapObjectBox.setFromObject(o);
      const b = _townMapObjectBox;
      const c = b.getCenter(new THREE.Vector3());
      c.y = b.min.y + (b.max.y - b.min.y) * ROAD_LIGHT_POINT_LIGHT_CONFIG.yOffset;
      return c;
    }),
    // The lamps' glass glows, `level` 0 (off) … 1 (night) — fading through twilight (the
    // emissive map is made the first time; off = intensity 0)
    setRoadLampsLit: (level) => {
      const k = Math.max(0, Math.min(1, Number(level) || 0));
      const lamps = _mapRoadLamps();
      if (k > 0 && !_roadLampsGlowing) { lamps.forEach(_addRoadLightGlow); _roadLampsGlowing = true; }
      for (const o of lamps) {
        o.traverse((m) => {
          if (m.isMesh && m.material?.userData.roadLightGlow) m.material.emissiveIntensity = ROAD_LIGHT_GLOW.intensity * k;
        });
      }
    },
    teleport: (x, z, yaw) => _teleportPlayer(x, z, yaw),
    // Walk the player (the first day's guide leading the way): (dirX, dirZ) a unit direction,
    // `step` metres this frame — moved by the controls like walking (walls, climbing), turned
    // toward it
    autoWalk: (dirX, dirZ, step, dt) => {
      if (!playerControls || !(step > 0)) return;
      _townAutoWalkAt = performance.now();
      playerControls.queueAutoMove(dirX * step, dirZ * step);
      const dYaw = ((Math.atan2(dirX, dirZ) - playerControls.yaw + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;
      playerControls.yaw += dYaw * Math.min(1, dt * 5);
      _duelCamLastYaw = playerControls.yaw;
    },
    // The player is moving themselves (joystick — on screen or the phone's — or WASD)
    isSteering: () => !!playerControls && (playerControls.joystickForce > 0.1
      || ['w', 'a', 's', 'd'].some((k) => playerControls.keysPressed.has(k))),
    // (moved and turned by dYaw — camera and body alike: through a shop door, keeping the way
    // the player faced relative to it)
    teleportTurned: (x, z, dYaw) => {
      _teleportPlayer(x, z);
      playerControls.yaw += dYaw;
      playerModel.rotation.y += dYaw;
      _duelCamLastYaw = playerControls.yaw;
    },
    revivePlayer: (x, z, yaw) => {
      hideGameOver();
      respawnPlayer();
      _teleportPlayer(x, z, yaw);
    },
    setPositionConstraint: (fn) => { if (playerControls) playerControls.positionConstraint = fn; },
    setSunHour,
    setTimeOfDay: (mode) => {
      lastAutoMode = mode;
      applyPresetForMode(mode);
      applyDisplaySettings();
      if (mode === 'day') clearRoadLightPool();
    },
    // Big text over the world (the stage win banner's look)
    showBanner: (title, sub, ms = 2600) => {
      _psWinTitle.textContent = title;
      _psWinSub.textContent = sub || '';
      _psWinTitle.style.animation = 'none';
      _psWinSub.style.animation = 'none';
      _psWinOverlay.classList.add('ps-win-banner');
      _psWinOverlay.classList.remove('hidden');
      void _psWinOverlay.offsetWidth;
      _psWinTitle.style.animation = '';
      _psWinSub.style.animation = '';
      clearTimeout(_psWinHideTimer);
      _psWinHideTimer = setTimeout(() => _psWinOverlay.classList.add('hidden'), ms);
    },
    // Someone who fights the player: a stage swordsman (EnemyPlayer) in their character; with
    // `gear` ({ shield, gun, … }) it fights like a stage boss with it (createBossFighter, no
    // health bar across the top / red glow)
    // (passive: a standoff — sword drawn, facing the player, no attacks until setFighterPassive(e, false))
    spawnFighter: ({ x, z, yaw, url, hearts, swingChance, gear = null, name = '', passive = false }) => {
      const groundY = getTerrainHeight(x, z);
      const enemy = _spawnHordeEnemy({
        position: new THREE.Vector3(x, Number.isFinite(groundY) ? groundY : playerModel.position.y, z),
        hearts, characterUrl: url, swingChance, swordDamage: 1, yaw,
      });
      enemy._town = true;
      enemy._coinDropped = true; // (no stage kill count / XP; the town drops their coins)
      if (gear && Object.values(gear).some(Boolean)) {
        const fighter = createBossFighter({ ..._bossFighterCtx(enemy), name, gear, hud: false, glow: false });
        enemy._townGear = fighter;
        enemy.onAfterUpdate = () => { if (!enemy._townPassive) fighter.update(); };
        if (gear.wand) enemy.onCast = (cast) => _castEnemySpell(enemy, cast); // (its wand spells)
      }
      if (passive) _townSetFighterPassive(enemy, true);
      return enemy;
    },
    setFighterPassive: (enemy, on) => _townSetFighterPassive(enemy, on),
    removeFighter: (enemy) => {
      enemy._townGear?.dispose();
      enemy._townGear = null;
      _tutorialRemoveEnemy(enemy);
    },
    // A fighter that died (the stage code fades it out): its gun / shield go with it
    releaseFighterGear: (enemy) => {
      enemy._townGear?.dispose();
      enemy._townGear = null;
    },
    // Arrested: two guards carry the player off (the Showdown death carry), then onDone
    carryPlayerOff: ({ carrierUrl, onDone }) => {
      duelCtx.setControlsLocked(true);
      deathCarry.start({
        body: playerModel,
        character: playerModel.userData.qwopRig?.glbCharacter ?? null,
        carrierUrl,
        onDone: () => { duelCtx.setControlsLocked(false); onDone(); },
      });
    },
    cancelCarry: () => {
      deathCarry.cancel();
      duelCtx.setControlsLocked(false);
    },
    spawnBlood: (pos, groundY) => spawnBloodBurst(scene, pos, { groundY, intensity: 0.8 }),
    // (`at`: where it happened — quieter further off, audioManager's distance falloff; none = the player's own)
    playSfx: (kind, at = null) => { // (no coin sound: the coin pop-up shows)
      if (kind === 'hit') audioManager?.playSFX('SFX/Attacks/Sword Attacks Hits and Blocks/Sword Impact Hit 3.ogg', 0.6, { cooldownKey: at ? 'town-hit' : 'psw-hit', cooldownMs: 200, at });
      else if (kind === 'chop') audioManager?.playSFX('SFX/Attacks/Sword Attacks Hits and Blocks/Sword Parry 2.ogg', 0.18, { cooldownKey: 'town-chop', cooldownMs: 300, at });
      else if (kind === 'fell') { // (a tree hitting the ground: a low boom under a thump)
        audioManager?.playSFX('SFX/Explosions/Explosion 1.ogg', 0.12, { cooldownKey: 'town-fell', cooldownMs: 600, at, falloff: { ref: 6, max: 60 } });
        audioManager?.playSFX('SFX/Footsteps/Dirt/Dirt Walk 1.ogg', 0.9, { cooldownKey: 'town-fell-thud', cooldownMs: 600, at, falloff: { ref: 6, max: 60 } });
      }
    },
    dropCoins: (pos, n) => {
      for (let i = 0; i < n; i++) {
        spawnCoinPickup(pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 1.2, 0, (Math.random() - 0.5) * 1.2)));
      }
    },
    getCoins: () => appState.getCoins(),
    addCoins: (delta) => _townAddCoins(delta),
    profileKey: () => profileNameKey,
    // (a shared town's key for this player — the house kept for them, townHomes.js)
    memberKey: () => profileNameKey || `guest_${_guestDeviceId().replace(/[^a-z0-9-]/gi, '')}`,
    // The signed-in player's town saves in Firebase (localStorage is per site: each deployment
    // URL has its own) — townSaves/<key> in playerProfile.js
    loadCloudSave: () => (profileNameKey ? loadTownSave(profileNameKey) : Promise.resolve(null)),
    saveCloud: (part, data) => { if (profileNameKey) void saveTownSave(profileNameKey, part, data); },
    // The town's own gear (see the Town loadout above)
    startLoadout: (items) => startTownLoadout(items),
    endLoadout: () => endTownLoadout(),
    getItems: () => (_townLoadout ? _townItems() : null),
    // Something in hand (the bandits at their camp rob an unarmed trespasser instead of fighting);
    // a fishing rod is no weapon
    isPlayerArmed: () => !!_heldWeaponId() && !isRodEquipped() && !isOarEquipped(),
    // (on the flying broom: no going into houses — townTrade.js)
    isOnBroom: () => !!_broomRide?.isRiding(),
    // A weapon of the town's own, in hand or not (the sheriff asks such a player to stand watch at night)
    hasWeapon: () => { const it = _townLoadout ? _townItems() : null; return !!(it && (it.sword || it.gun || it.wand)); },
    putWeaponsAway: () => _putWeaponsAway(),
    // Fishing (townTrade.js): the rod in hand, its model (the tip casts the line), the reel
    isRodEquipped: () => isRodEquipped(),
    getRodModel: () => (isRodEquipped() ? foamSword?.getRodModel?.() ?? null : null),
    // Town's canoe (townCanoe.js): the oar comes out while aboard (and nothing else), its model
    // (the blade paddles); held still in it, carried along as it moves
    setOar: (on) => {
      _oarStrokeReset();
      if (on) { _putWeaponsAway(); _equipByPlayer(OAR_ITEM_ID); } else if (_oarActive) _putWeaponsAway();
      _refreshGearUI();
      _phoneSwordStatusNow?.();
    },
    getOarModel: () => (isOarEquipped() ? foamSword?.getOarModel?.() ?? null : null),
    // The paddle stroke going on (canoeBoat.js pushes through its pull), or null
    getOarStroke: () => (isOarEquipped() ? _currentOarStroke() : null),
    // (a rod bought: it comes out in the canoe too)
    isRodAllowed: () => isRodAllowed(),
    // m of water over the map's ground (0: dry land; out past the map's ground: deep)
    waterDepth: _waterDepthAt,
    holdStill: (on) => { if (playerControls) playerControls.holdStill = !!on; },
    carryPlayer: _carryPlayer,
    getSteer: _getSteer,
    // A live gyro sword (phone, or this device's own): else casting / hooking are buttons
    hasGyro: () => !!(window.phoneSwordGyro?.connected || window.phoneSwordGyro?.localDevice),
    // The phone controller's reel: radians cranked since the last call
    takeReel: () => { const r = _phoneReel.pending; _phoneReel.pending = 0; return r; },
    // A phone controller (it shows its own reel) — not "Use This Device", which needs the on-screen one
    isPhoneConnected: () => !!(window.phoneSwordGyro?.connected && !window.phoneSwordGyro?.localDevice),
    // Something grabbed / dropped: the Block bar (here and on the phone) becomes / stops being its mode
    refreshButtons: () => { _refreshGearUI(); _phoneSwordStatusNow?.(); },
    // Phone buzz on a fishing cue (status → the phone vibrates when its fishCue changes)
    refreshPhone: () => _phoneSwordStatusNow?.(),
    grantItem: (kind, n) => grantTownItem(kind, n),
    // Arrested: the guards take every weapon (a fishing rod / the broom are no weapons: kept)
    confiscate: () => {
      if (!_townLoadout) return;
      const { hasRod: rod, hasBroom: broom } = _townLoadout;
      _broomRide?.dismount();
      _putWeaponsAway();
      deactivatePlayerBubble();
      _setTownItems({ rod, broom });
      _refreshGearUI();
    },
    magicDamage: { fire: MAGIC_FIRE_DAMAGE, ice: MAGIC_ICE_DAMAGE },
    shieldMax: MATCH_SHIELD_HEALTH,
    maxMana: MAX_MANA,
    getHealth: () => ({ health: statsState.health, max: effectiveMaxHealthSegments() }),
    heal: (n) => setStat('health', Math.min(effectiveMaxHealthSegments(), statsState.health + n)),
  });
  window.town = town; // (dev console: town.debug())
  // Town's flying broom (bought from the wizard): sat on, floating, steered by the phone's lean
  // (the joystick / WASD without a gyro); the camera swings round behind it (src/items/broom.js)
  _broomRide = createBroomRide({
    scene,
    getControls: () => playerControls,
    getPlayerModel: () => playerModel,
    getGroundY: (x, z) => getTerrainHeight(x, z),
    getWaterY: (x, z) => _activeMap?.water?.(x, z) ?? null,
    // (the rotation from the rest pose, in the game's frame: the way its up leans)
    getTilt: () => {
      if (!window.phoneSwordGyro?.connected || _broomGyro.needRest || performance.now() - _broomGyro.at > 500) return null;
      _broomTiltQ.copy(_broomGyro.rest).invert().premultiply(_broomGyro.q);
      const up = _broomTiltV.set(0, 1, 0).applyQuaternion(_broomTiltQ);
      return { x: up.x, z: up.z };
    },
    getSteer: _getSteer,
    spendMana: (n) => {
      if (getMana() < n) return false;
      setStat('mana', getMana() - n, { skipSave: true });
      return true;
    },
    onBoostEnd: () => {
      showPickupToast('mana_potion', 1, '', { text: 'Out of mana — boost off' });
      playerControls?.refreshActionButtons?.();
      _phoneSwordStatusNow?.();
    },
  });
  // Boost on the broom while held (climbing, faster, BOOST_MANA_PER_S mana a second — src/items/broom.js)
  const _setBroomBoost = (on) => {
    if (!_broomRide.isRiding() || on === _broomRide.isBoosting()) return;
    if (!on) _broomRide.setBoost(false);
    else if (!_broomRide.setBoost(true)) showPickupToast('mana_potion', 1, '', { text: 'No mana to boost — buy a mana potion from the wizard' });
    playerControls?.refreshActionButtons?.();
    _phoneSwordStatusNow?.();
  };
  const _canRideBroom = () => !!_townLoadout?.hasBroom && !playerDead && !_gamePaused && !!town?.canRide();
  const _toggleBroom = () => {
    if (_broomRide.isRiding()) _broomRide.dismount();
    else if (_canRideBroom()) {
      _putWeaponsAway();
      // (the phone's pose now is its rest — level flight)
      _broomGyro.needRest = true;
      if (_broomRide.mount()) _gyroItemCalibPrompt?.();
    }
    playerControls?.refreshActionButtons?.();
    _phoneSwordStatusNow?.();
  };
  // (each frame, before the controls) Off it when Town can't have it any more (a room, jail,
  // the canoe, going down, leaving Town…)
  const _updateBroom = (dt) => {
    if (!_broomRide.isRiding()) return;
    if (!_townLoadout?.hasBroom || playerDead || !town?.canRide()) {
      _broomRide.dismount();
      playerControls?.refreshActionButtons?.();
      _phoneSwordStatusNow?.();
      return;
    }
    _broomRide.update(dt);
  };
  // Town at night, out past the houses (town.wantsLantern): a lantern on the player's left
  // hand — the game 'right' floating hand (labels are mirrored); with `lanternHeld` set,
  // updateProceduralPlayerRig poses that arm for it and grips weapons with the other hand only
  // Its light fades in / out over LANTERN_FADE_S (still held while it fades out)
  const LANTERN_FADE_S = 1.2;
  let _townLantern = null;
  let _townLanternLevel = 0;
  const _updateTownLantern = (dt) => {
    const want = !!(playerModel && town?.wantsLantern() && !playerDead);
    const step = (Number.isFinite(dt) ? dt : 0) / LANTERN_FADE_S;
    _townLanternLevel = want ? Math.min(1, _townLanternLevel + step) : Math.max(0, _townLanternLevel - step);
    if (!town?.isActive() || playerDead) _townLanternLevel = 0;
    const held = want || _townLanternLevel > 0;
    if (playerModel) playerModel.userData.lanternHeld = held;
    if (!held && !_townLantern) return;
    if (!_townLantern) _townLantern = createLantern();
    const hand = held ? playerModel.children.find((c) => c.userData?.proceduralHand === 'right') : null;
    if (hand && _townLantern.group.parent !== hand) hand.add(_townLantern.group);
    // (the light stays put while Town is on, dark, so it doesn't recompile the scene's shaders)
    if (!town?.isActive() && _townLantern.group.parent) _townLantern.group.parent.remove(_townLantern.group);
    _townLantern.setLit(held, _townLanternLevel * _townLanternLevel * (3 - 2 * _townLanternLevel));
  };
  // Where the sea start's guest stepped ashore ({ x, z, yaw }): Town starts there, not at its spawn
  let _townArrival = null;
  const startTownMode = () => {
    _resetForMenu();
    // Town plays as the character picked in the Showdown village (others in a shared town see it — townNet's `pl`)
    setPlayerCharacterUrl(playerModel, MATCH_CHARACTERS[_psChars.selected]?.url || glbCharacterConfig.villageBoyUrl);
    town.enter({ arrival: _townArrival });
    _townArrival = null;
  };

  // The guest's sea start (src/town/seaStart.js): out on the sea in a canoe, the rod in hand,
  // before the map's in. Its numbers for the island: MAPS.islandTown.seaStart
  seaStart = createSeaStart({
    scene,
    getMapWater: () => (_activeMapKey === DEFAULT_MAP ? _activeMap?.water ?? null : null),
    waterDepth: _waterDepthAt,
    getGroundY: (x, z) => getTerrainHeight(x, z),
    teleport: (x, z, yaw) => _teleportPlayer(x, z, yaw),
    holdStill: (on) => { if (playerControls) playerControls.holdStill = !!on; },
    setPositionConstraint: (fn) => { if (playerControls) playerControls.positionConstraint = fn; },
    carryPlayer: _carryPlayer,
    getSteer: _getSteer,
    getOarModel: () => (isOarEquipped() ? foamSword?.getOarModel?.() ?? null : null),
    getOarStroke: () => (isOarEquipped() ? _currentOarStroke() : null),
    // Fishing where the canoe starts out (Town's fishing — townFishing.js): as the town ctx's
    getPlayerModel: () => playerModel,
    getRodModel: () => (isRodEquipped() ? foamSword?.getRodModel?.() ?? null : null),
    takeReel: () => { const r = _phoneReel.pending; _phoneReel.pending = 0; return r; },
    isPhoneConnected: () => !!(window.phoneSwordGyro?.connected && !window.phoneSwordGyro?.localDevice),
    refreshPhone: () => _phoneSwordStatusNow?.(),
    // 'rod' | 'oar' in hand, or null: nothing
    hold: (kind) => {
      if (kind === 'rod') _equipByPlayer(FISHING_ROD_ITEM_ID);
      else if (kind === 'oar') _equipByPlayer(OAR_ITEM_ID);
      else _putWeaponsAway();
      _refreshGearUI();
      _phoneSwordStatusNow?.();
    },
    hasGyro: () => !!(window.phoneSwordGyro?.connected || window.phoneSwordGyro?.localDevice),
    isTouch: () => !!playerControls?.isTouchLayout?.(),
    // Ashore by the fishing spot: Town, as the guest, from there
    onLanded: (spot) => {
      _townArrival = spot;
      arcadeOverlay.startMode('town');
    },
    onLobby: () => {
      _resetForMenu();
      if (_activeMap) _placeAtSpawn();
      arcadeOverlay.showStartScreen();
    },
    onSignIn: () => arcadeOverlay.signIn(),
  }, MAPS[DEFAULT_MAP].seaStart);
  window.seaStart = seaStart; // (dev console: seaStart.debug())
  const startSeaMode = () => {
    _resetForMenu();
    _putWeaponsAway();
    // (before the map's in, the ground's floor is the sea's shallows as it will be then)
    if (!_activeMap) {
      _preMapFloor = MAPS[DEFAULT_MAP].seaStart.seaLevel - SEA_WADE_DEPTH;
      setTerrainFloor(_preMapFloor);
      _syncPhysicsGround();
    }
    seaStart.enter();
    // (sound needs a tap / key first: the start screen's buttons would have given one)
    const startAudio = () => {
      window.removeEventListener('pointerdown', startAudio, true);
      window.removeEventListener('keydown', startAudio, true);
      void startAudioAndGameOnce();
    };
    window.addEventListener('pointerdown', startAudio, true);
    window.addEventListener('keydown', startAudio, true);
  };

  let _modeStartToken = 0;
  const _startMode = (gameMode) => {
    if (gameMode === 'showdown') {
      _resetForMenu();
      void _psInit();
    } else if (gameMode === 'classic') {
      void startClassicMode();
    } else if (gameMode === 'multiplayer') {
      startMultiplayerMode();
    } else if (gameMode === 'roam') {
      startDevRoamMode();
    } else if (gameMode === 'town') {
      startTownMode();
    } else {
      startTutorialMode();
    }
  };

  // Mode picked on the start screen (first time, after the tutorial, leaving the lobby):
  // Tutorial, Showdown, Classic, Town or Multiplayer. Only Multiplayer runs peer multiplayer.
  // A pick made while the game was still loading runs as soon as this is set.
  arcadeOverlay.setModeHandler((gameMode) => {
    if (_phoneSwordQrDeferred) {
      _phoneSwordQrDeferred = false;
      if (!window.phoneSwordGyro?.connected && _phoneSwordPeerId) void showPhoneSwordQr(_phoneSwordPeerId);
    }
    if (gameMode !== 'multiplayer') {
      matchMode.exit();
      duelMode.exit();
    }
    if (gameMode !== 'classic') _setClassicMode(false);
    devRoam.exit();
    town.exit();
    // The guest's sea start: right away, the map or not (it waits on nothing)
    if (gameMode === 'sea') {
      ++_modeStartToken;
      startSeaMode();
      return;
    }
    // Each mode's map first (Classic: map.glb, the rest: the island town); a new map puts
    // the player at its spawn. A newer pick made while a map loads wins.
    const token = ++_modeStartToken;
    _setActiveMap(mapForMode(gameMode))
      .catch((err) => { console.error('[map] load failed, staying on the current map:', err); return false; })
      .then((changed) => {
        if (token !== _modeStartToken) return;
        if (changed) {
          const spawn = getSpawnPosition();
          _teleportPlayer(spawn.x, spawn.z);
          devRoam.refresh(); // routes drawn for the new map
        }
        _startMode(gameMode);
      });
  });

  function animate() {
    requestAnimationFrame(animate);
    const frameStartMs = performance.now();

    // --- RAPIER FIXED-STEP & SYNC ---
    // Accumulate variable rAF time into fixed physics steps
    const frameDelta = clock.getDelta();
    // Paused (settings open in a single-player stage): draw the frozen world, simulate nothing
    if (_isSettingsPauseWanted()) {
      if (!_gamePaused) { _gamePaused = true; _pausedAtMs = Date.now(); }
      renderer.render(scene, camera);
      return;
    }
    if (_gamePaused) {
      _gamePaused = false;
      _pauseGraceUntil = performance.now() + PAUSE_RESUME_GRACE_MS;
      // Bomb fuses run on the wall clock: don't let bombs in flight go off the moment play resumes
      const pausedMs = Date.now() - _pausedAtMs;
      playerBombs.delay(pausedMs);
      for (const _he of hordeEnemies) _he._bombs?.forEach((b) => { b.spawnTime += pausedMs; });
    }
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
    // A voyage on the pirate ship: it sails, carrying everyone aboard (before the player moves)
    _voyageUpdate(frameDelta);
    // Town's flying broom: it moves the player (before the controls place them), then sits
    // under them (after)
    _updateBroom(frameDelta);
    playerControls.update();
    _broomRide?.afterControls();
    updateBloodEffects(frameDelta);
    updateBulletImpacts(frameDelta);
    updateExplosionEffects(frameDelta);
    updatePlayerBubble();
    updatePlayerBombs(frameDelta);
    updatePlayerRoll();
    _updateMagic(frameDelta);
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
          // (a quest's pay: shows round the player first, then slides in from wherever it is)
          if (pickup.userData.holdUntil && performance.now() < pickup.userData.holdUntil) continue;
          if (!playerDead && _townWalletRoom() >= (pickup.userData.value ?? COIN_PICKUP_GAIN)
            && (pickup.userData.homing || playerModel.position.distanceTo(pickup.position) <= getPickupAttractRadius())) {
            attractPickupToPlayer(pickup, playerModel, PICKUP_ATTRACT_SPEED, pickupDeltaSeconds);
            // Follow the ground while drifting; otherwise the bob above resets y to the spawn height
            const groundY = getSpawnY(pickup.position.x, pickup.position.z, 0.6);
            if (Number.isFinite(groundY)) pickup.userData.baseY = groundY;
          }

          if (shouldCheckPickups && !playerDead && playerModel.position.distanceTo(pickup.position) < PICKUP_RADIUS) {
            // (Town: a full wallet leaves the coin where it is)
            if (_townWalletRoom() < (pickup.userData.value ?? COIN_PICKUP_GAIN)) { _townWalletFullToast(); continue; }
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

        // Raw rotation since calibration, in the player's game frame (unscaled):
        // G = E · D · D0⁻¹ · E⁻¹, then the yaw drift correction about game Y.
        _pswDeviceQuat(_c.alpha, _c.beta, _c.gamma, _pswCalibQ);
        _pswEarthToGame(_pswCalibQ, _pswEarthToGameQ);
        _pswDeviceQuat(Number.isFinite(_g.alpha) ? _g.alpha : _c.alpha, _beta, _gamma, _pswDeviceQ);
        const _rel = _pswDeviceQ.multiply(_pswCalibQ.invert()); // D · D0⁻¹ (reuses _pswDeviceQ)
        _rel.premultiply(_pswEarthToGameQ).multiply(_pswEarthToGameQ.invert());
        _pswYawQ.setFromAxisAngle(_PSW_UP, -(_c.yawDrift || 0));
        _rel.premultiply(_pswYawQ);
        if (_rel.w < 0) { _rel.x = -_rel.x; _rel.y = -_rel.y; _rel.z = -_rel.z; _rel.w = -_rel.w; }

        // Yaw auto-recentre during calm moments (auto-walk between fights / duel walk-in).
        const _speed = window._pswDebugSpeed ?? 0;
        const _calmMoment = (_psAutoWalking && playerControls?.isMoving && !_psFindIncomingThreat() &&
            !hordeEnemies.some(e => !e.isDead && e.group.position.distanceTo(playerModel.position) < PSW_YAW_RECENTER_ENEMY_DIST)) ||
          _duelWalking;
        if (_calmMoment && !_g.blocking && _speed < PSW_YAW_RECENTER_MAX_SPEED) {
          _psw.stillSince ??= nowSec;
        } else {
          _psw.stillSince = null;
        }
        const _dtYaw = Math.min(0.1, Math.max(0, nowSec - (_psw.prevGyroTime ?? nowSec)));
        if (_psw.stillSince !== null && nowSec - _psw.stillSince >= PSW_YAW_RECENTER_STILL_S && _dtYaw > 0) {
          // Blade tilt away from vertical (neutral blade is upright): skip odd holds (hanging down etc.)
          const _bladeUpY = _pswTmpV.set(0, 1, 0).applyQuaternion(_rel).y;
          const _twistNorm = Math.hypot(_rel.y, _rel.w);
          if (_bladeUpY > Math.cos(PSW_YAW_RECENTER_MAX_TILT_DEG * DEG) && _twistNorm > 0.5) {
            // Twist of the rotation about game Y = the current yaw offset from forward
            const _yawErr = 2 * Math.atan2(_rel.y, _rel.w);
            if (Math.abs(_yawErr) > PSW_YAW_RECENTER_DEADBAND_DEG * DEG) {
              const _trust = Math.min(1, (nowSec - (_c.calibratedAt ?? nowSec)) / PSW_YAW_RECENTER_TRUST_RAMP_S);
              const _tau = PSW_YAW_RECENTER_TAU_S + (PSW_YAW_RECENTER_TAU_MIN_S - PSW_YAW_RECENTER_TAU_S) * _trust;
              const _step = _yawErr * (1 - Math.exp(-_dtYaw / _tau));
              _c.yawDrift = (_c.yawDrift || 0) + _step;
              _pswYawQ.setFromAxisAngle(_PSW_UP, -_step);
              _rel.premultiply(_pswYawQ);
            }
          }
        }

        // Sensitivity: "Use This Device" (amplified so the screen stays visible) or QR phone.
        // Scales the rotation angle about its axis.
        const _sens = _g.localDevice
          ? (window.phoneSwordLocalSensitivity ?? PHONE_SWORD_LOCAL_SENSITIVITY_DEFAULT)
          : (window.phoneSwordPhoneSensitivity ?? PHONE_SWORD_PHONE_SENSITIVITY_DEFAULT);
        if (_sens !== 1) {
          const _half = Math.acos(Math.min(1, _rel.w));
          const _sinHalf = Math.sin(_half);
          if (_sinHalf > 1e-6) {
            const _k = Math.sin(_half * _sens) / _sinHalf;
            _rel.set(_rel.x * _k, _rel.y * _k, _rel.z * _k, Math.cos(_half * _sens));
          }
        }

        // Neutral sword pose (config offsets), rotated by the phone's rotation since calibration
        _pswNeutralQ.setFromEuler(_phoneSwordEuler.set(_cfg.offsetX * DEG, _cfg.offsetY * DEG, _cfg.offsetZ * DEG, 'YXZ'));
        _phoneSwordGyroQ.copy(_rel).multiply(_pswNeutralQ);

        // Compute angular speed (deg/s) from quaternion delta vs previous frame
        if (_psw.prevGyroQ && _psw.prevGyroTime && nowSec > _psw.prevGyroTime) {
          const _dt = nowSec - _psw.prevGyroTime;
          const _dot = Math.abs(_phoneSwordGyroQ.dot(_psw.prevGyroQ));
          const _angleDeg = 2 * Math.acos(Math.min(1, _dot)) * (180 / Math.PI);
          window._pswDebugSpeed = _angleDeg / _dt;
        }
        const _smoothDt = Math.min(0.1, nowSec - (_psw.prevGyroTime ?? nowSec));
        if (!_psw.prevGyroQ) _psw.prevGyroQ = new THREE.Quaternion();
        _psw.prevGyroQ.copy(_phoneSwordGyroQ);
        _psw.prevGyroTime = nowSec;

        // Adaptive smoothing (one-euro style): heavy while nearly still (hides hand tremor and
        // the ~30 Hz packet steps), almost none during fast swings so hits don't lag.
        // Speed is eased because at 60 fps every other frame repeats the last packet.
        _psw.smoothSpeed = (_psw.smoothSpeed ?? 0) + ((window._pswDebugSpeed ?? 0) - (_psw.smoothSpeed ?? 0)) * 0.5;
        if (!_psw.smoothQ) {
          _psw.smoothQ = _phoneSwordGyroQ.clone();
        } else if (_smoothDt > 0) {
          const _cutoffHz = PSW_SMOOTH_MIN_CUTOFF_HZ + PSW_SMOOTH_SPEED_GAIN * _psw.smoothSpeed;
          _psw.smoothQ.slerp(_phoneSwordGyroQ, 1 - Math.exp(-2 * Math.PI * _cutoffHz * _smoothDt));
        }
        _phoneSwordGyroQ.copy(_psw.smoothQ);
        // Frozen in ice: the sword is stuck where it was (the shaking still counts — speed above)
        if (isPlayerFrozen()) {
          _psw.frozenQ ??= _phoneSwordGyroQ.clone();
          _phoneSwordGyroQ.copy(_psw.frozenQ);
        } else {
          _psw.frozenQ = null;
        }

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
          // (the oar: the phone's tilt steers the canoe, the strokes that fit it pose the oar)
          if (_oarActive) { _readOarTilt(foamSword._holdQuaternion, nowSec); _oarPose(foamSword._holdQuaternion); }
        }
        // Unarmed (village): the gyro moves the player's right arm (updateProceduralPlayerRig)
        const _pmUD = playerControls?.playerModel?.userData;
        if (_pmUD) {
          (_pmUD.gyroArmQuat ??= new THREE.Quaternion()).copy(activeGyroQ).multiply(_phoneSwordBaseQ);
          _pmUD.gyroArmTime = performance.now();
        }
        // (Town's broom: the phone's pose — its lean from the rest pose steers it)
        _broomGyro.q.copy(activeGyroQ);
        if (_broomGyro.needRest) { _broomGyro.rest.copy(activeGyroQ); _broomGyro.needRest = false; }
        _broomGyro.at = performance.now();
      }
    } else if (foamSword?.holder === playerControls) {
      // No phone / gyro: hold the sword in the neutral pose (blade straight up) instead of
      // the weapon's default hold, which points the blade back at the player's face
      const DEG = Math.PI / 180;
      const _cfg = window.phoneSwordConfig || { offsetX: 0, offsetY: 0, offsetZ: 0 };
      _pswNeutralQ.setFromEuler(_phoneSwordEuler.set(_cfg.offsetX * DEG, _cfg.offsetY * DEG, _cfg.offsetZ * DEG, 'YXZ'));
      foamSword._holdQuaternion.copy(_pswNeutralQ).multiply(_phoneSwordBaseQ);
      if (_oarActive) _oarPose(foamSword._holdQuaternion);
    }
    foamSword?.update();
    // Phone Sword: override mesh quaternion, then run sword-vs-sword collision + sweep hit detection.
    if (window.phoneSwordGyro?.connected &&
        foamSword?.holder === playerControls && foamSword?.mesh && playerModel) {

      // Re-derive active Q — use bounceCurrentQ if bouncing, else live gyro
      const _nowSecPS = performance.now() / 1000;
      const _activeQ = _psw.bounceActive ? _psw.bounceCurrentQ : _phoneSwordGyroQ;
      if (_oarActive) foamSword.mesh.quaternion.copy(playerModel.quaternion).multiply(foamSword._holdQuaternion);
      else foamSword.mesh.quaternion.copy(playerModel.quaternion).multiply(_activeQ).multiply(_phoneSwordBaseQ);

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

      // Pressing/releasing Block flips the hands into/out of the block stance (and jolts
      // the phone), so the tip jumps in one frame. That isn't a swing: ignore swings for
      // a moment after every block toggle and restart the swing-direction history.
      const _blockingNow = !!window.phoneSwordGyro?.blocking;
      if (_blockingNow !== _psw.lastBlocking) {
        if (_blockingNow) comboMeter.end(); // blocking ends the combo
        _psw.lastBlocking = _blockingNow;
        _psw.blockToggleUntil = _nowSecPS + PSW_BLOCK_TOGGLE_IGNORE_S;
        _psw.tipHistory.length = 0;
        _psw.prevTipWorld = null;
      }
      // (frozen in ice: no swings either)
      const _blockToggleSettling = _nowSecPS < (_psw.blockToggleUntil ?? 0) || isPlayerFrozen();
      // Magic wand out: swipes cast spells (below) instead of sword hits (the fishing rod: no
      // hits either — Town's fishing reads its swings)
      const _wandOut = _wandActive || _rodActive || _oarActive;

      // ── Sword-vs-sword collision + sweep hit detection for horde enemies ─────
      let _swingHitOccurred = false;
      const _colAngSpd  = window._pswDebugSpeed ?? 0;
      const _colMinSpd  = window.phoneSwordSwingCfg?.minSweepSpeed ?? 100;
      const _colSweepDist = _psw.prevTipWorld ? _tipWorld.distanceTo(_psw.prevTipWorld) : 0;
      const _colMinDist = window.phoneSwordSwingCfg?.minSweepDist ?? 0.15;
      const _playerMovingFast = !_blockingNow && !_blockToggleSettling &&
        _colAngSpd >= _colMinSpd && _colSweepDist >= _colMinDist;
      // Blocked swing: knock the player's sword sideways (snap, hold, return to live gyro)
      const _startSwordBounce = () => {
        if (_psw.bounceActive) return;
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
      };
      for (const _he of (_wandOut || _psBossTalking ? [] : hordeEnemies)) { // (no hits while a boss talks)
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
        if (!_blockingNow && !_blockToggleSettling) {
          const _enemyCenter = _he.group.position.clone();
          _enemyCenter.y += _he.bodyHitCenterY ?? 0.8;
          const _reachesBody = _tipWorld.distanceTo(_enemyCenter) < (_he.bodyHitRadius ?? 0.65);
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
                // Enemy's block holds — the player's sword recoils, the enemy's stays in its block, no damage
                if (_he.applyBlockImpact) _he.applyBlockImpact(_swingDir.clone().normalize());
                else _he.applySwordBounce?.();
                if (!_he._tutorial) comboMeter.end();
                audioManager?.playSFX('SFX/Attacks/Sword Attacks Hits and Blocks/Sword Parry 2.ogg', 0.65, { cooldownKey: 'psw-parry', cooldownMs: 300 });
                _startSwordBounce();
                // Small step forward into the blocked swing (instead of the miss lunge)
                if (_swingStepAllowed()) {
                  const _blockFwd = new THREE.Vector3(0, 0, 1).applyQuaternion(playerModel.quaternion);
                  _blockFwd.y = 0; _blockFwd.normalize();
                  const _bsx = playerModel.position.x + _blockFwd.x * 0.09;
                  const _bsz = playerModel.position.z + _blockFwd.z * 0.09;
                  playerModel.position.x = _bsx; playerModel.position.z = _bsz;
                  playerControls.playerX = _bsx; playerControls.playerZ = _bsz;
                  playerControls.lastPosition?.set(_bsx, playerModel.position.y, _bsz);
                  if (playerControls.body) playerControls.body.setNextKinematicTranslation({ x: _bsx, y: playerModel.position.y + 0.6, z: _bsz });
                }
                _swingHitOccurred = true; // blocked swing doesn't lunge
                _he._playerSwordLastHit = _nowMsPS; // this swing is spent
              } else if (_reachesBody) {
                const _sweepDir = _sweepVec.clone().normalize();
                _sweepDir.y = 0;
                if (_sweepDir.lengthSq() < 0.0001) _sweepDir.set(0, 0, 1);
                _sweepDir.normalize();
                const _killingBlow = _he.applyDamage(1);
                if (!_he._tutorial && _psStageActive) comboMeter.hit();
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

      // ── Duel / battle: same sweep hit + directional block against other players ──
      // (and battle bots). The attacker detects the hit and reports it (onHit); the victim
      // applies the damage.
      const _pvpTargets = _wandOut ? _noPvpTargets : _getPvpTargets();
      if (_pvpTargets.length && !_blockingNow && !_blockToggleSettling && _psw.prevTipWorld) {
        const _nowMsD = Date.now();
        for (const _opp of _pvpTargets) {
          let _pvpSwordCollision = false;
          if (_opp.hasBlade) {
            pvpBlade: for (const pp of _playerBladePoints) {
              for (const op of _opp.bladePoints) {
                if (pp.distanceTo(op) < 0.15) { _pvpSwordCollision = true; break pvpBlade; }
              }
            }
          }
          const _pvpReachesBody = _tipWorld.distanceTo(_opp.center) < 0.65;
          if (!(_pvpReachesBody || _pvpSwordCollision) || _nowMsD - (_pvpLastSwordHitAt.get(_opp.id) || 0) <= 1000) continue;
          const _sweepVec = new THREE.Vector3().subVectors(_tipWorld, _psw.prevTipWorld);
          const _minSweep = window.phoneSwordSwingCfg?.minSweepDist ?? 0.015;
          const _minSweepSpd = window.phoneSwordSwingCfg?.minSweepSpeed ?? 2000;
          if (_sweepVec.length() <= _minSweep || (window._pswDebugSpeed ?? 0) < _minSweepSpd) continue;
          const _swingDir = _psw.tipHistory.length
            ? new THREE.Vector3().subVectors(_tipWorld, _psw.tipHistory[0].pos)
            : _sweepVec.clone();
          const _toOpp = new THREE.Vector3().subVectors(_opp.position, playerModel.position).setY(0);
          const _pvpBlocked = _opp.blocksSwing
            ? _opp.blocksSwing(_swingDir, playerModel.position)
            : _opp.blocking && _opp.hasBlade &&
              swingCrossesBlade(_swingDir, _opp.bladeDir, _toOpp, PLAYER_BLOCK_MIN_ANGLE_DEG);
          if (_pvpBlocked) {
            audioManager?.playSFX('SFX/Attacks/Sword Attacks Hits and Blocks/Sword Parry 2.ogg', 0.65, { cooldownKey: 'psw-parry', cooldownMs: 300 });
            window._pswShowBlockFlash?.('enemy');
            _startSwordBounce();
            _opp.onBlocked();
            _swingHitOccurred = true;
            _pvpLastSwordHitAt.set(_opp.id, _nowMsD);
            break; // the swing is spent
          } else if (_pvpReachesBody) {
            const _sweepDir = _sweepVec.clone().setY(0);
            if (_sweepDir.lengthSq() < 0.0001) _sweepDir.copy(_toOpp);
            if (_sweepDir.lengthSq() < 0.0001) _sweepDir.set(0, 0, 1);
            _sweepDir.normalize();
            _opp.onHit(1, _sweepDir);
            if (!_opp.ownBlood) spawnBloodBurst(scene, _opp.center, { groundY: _opp.position.y, intensity: 0.8 });
            audioManager?.playSFX('SFX/Attacks/Sword Attacks Hits and Blocks/Sword Impact Hit 3.ogg', 0.6, { cooldownKey: 'psw-hit', cooldownMs: 200 });
            _swingHitOccurred = true;
            _pvpLastSwordHitAt.set(_opp.id, _nowMsD);
          }
        }
      }

      // Forward lunge on fast swing that missed all enemies
      // Suppress if any enemy (or another player) is very close (prevents clipping through them)
      const _lungeProximityDist = 1.0;
      const _tooCloseToEnemy = hordeEnemies.some(_e =>
        !_e.isDead && _e.group &&
        playerModel.position.distanceTo(_e.group.position) < _lungeProximityDist
      ) || _pvpTargets.some(_o => playerModel.position.distanceTo(_o.position) < _lungeProximityDist);
      // Town: a swing through a townsperson (same speed rule as hitting an enemy)
      if (!_wandOut && !playerDead && town?.isActive() && !_blockingNow && !_blockToggleSettling && _psw.prevTipWorld
        && _tipWorld.distanceTo(_psw.prevTipWorld) > (window.phoneSwordSwingCfg?.minSweepDist ?? 0.015)
        && (window._pswDebugSpeed ?? 0) >= (window.phoneSwordSwingCfg?.minSweepSpeed ?? 2000)) {
        const _townSwingDir = _psw.tipHistory.length
          ? new THREE.Vector3().subVectors(_tipWorld, _psw.tipHistory[0].pos)
          : new THREE.Vector3().subVectors(_tipWorld, _psw.prevTipWorld);
        if (town.trySwordHit(_tipWorld, _townSwingDir)) _swingHitOccurred = true;
      }
      // Hidden stage chest: a sword swipe through it opens it (a random prize)
      if (!_wandOut && !playerDead && stageChests.trySwordHit(_playerBladePoints, _playerMovingFast)) {
        _swingHitOccurred = true;
        audioManager?.playSFX?.('SFX/Attacks/Sword Attacks Hits and Blocks/Sword Impact Hit 3.ogg', 0.8);
        _openTreasureChest({ free: true });
      }
      if (_wandActive) {
        _updateWandSwipe(_tipWorld, _nowSecPS, _blockingNow || _blockToggleSettling);
      } else if (!_wandOut && _playerMovingFast && !_swingHitOccurred && !_tooCloseToEnemy && _swingStepAllowed()) {
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
    // Heart bubbles: drift to the player and pop on touching them (+1 health)
    _popHeartBubbles(heartBubbles.update(frameDelta, {
      playerModel: playerDead ? null : playerModel,
    }));
    stageChests.update(frameDelta);
    // Phone Sword: apply fixed position/rotation config to shield and pistol
    if (shield?.holder === playerControls) _applyWeaponHoldCfg(shield, 'shield');
    if (pistol?.holder === playerControls) _applyWeaponHoldCfg(pistol, 'gun');
    // Gun / shield: the phone gyro turns and pitches the aim
    _updateWeaponGyroAim(frameDelta);
    pistol?.update();
    shield?.update();

    // ── Phone Sword: auto-walk + queue spawn (runs even when hordeEnemies is empty) ──
    const _tutorialActive = !!showdownTutorial?.isActive();
    if ((_psStageActive || _tutorialActive) && !playerDead && !_classicCountdown) {
      // Spawn queued enemies as player approaches their positions
      for (let _qi = _psEnemyQueue.length - 1; _qi >= 0; _qi--) {
        const _qe = _psEnemyQueue[_qi];
        // (waits for its character model: an enemy spawned before it loads would fight invisible)
        if (playerModel.position.distanceTo(_qe.pos) <= PS_SPAWN_TRIGGER_DIST
          && isCharacterModelSettled(_qe.characterUrl)) {
          const _psSpawned = _spawnHordeEnemy({
            position: _qe.pos, hearts: _qe.hearts, speedScale: PS_ENEMY_SPEED, bombThrower: _qe.bombThrower,
            wand: _qe.wand,
            characterUrl: _qe.characterUrl,
            nameTag: _qe.nameTag,
            swordDamage: _classicMode ? CLASSIC_ENEMY_SWORD_DAMAGE : undefined,
            swingChance: _qe.pemberton ? PEMBERTON_SWING_CHANCE
              : _qe.boss ? Math.min(0.75, _psSwingChance(_psStage) + PS_BOSS_SWING_BONUS) : undefined,
            pemberton: _qe.pemberton,
            stageBoss: _qe.boss && !_qe.pemberton && _qe.bossKey ? { stage: _psStage, key: _qe.bossKey } : null,
            yaw: _qe.yaw,
          });
          // (bosses wait on the path; everyone else keeps to it when chasing from a way off)
          if (!_qe.boss && !_tutorialActive) _psSpawned.chaseVia = _psEnemyChaseVia;
          _psEnemyQueue.splice(_qi, 1);
        }
      }

      // How far along the stage path the player has got (by the auto-walk or by hand)
      if (_psStageActive) _psUpdatePathProgress();

      // The stage boss talks first: when the player gets to it
      if (_psBoss && !_psBossTalking && !_psWinShown && !_psBoss.isStarted() && !_psBoss.enemy.isDead
        && playerModel.position.distanceTo(_psBoss.enemy.group.position) <= BOSS_TALK_DIST) {
        _psStartBossTalk(_psBoss);
      }

      // Auto-walk: pause when an enemy is actively attacking close by,
      // or while the camera is tracking an incoming bomb / magic blast (and while a boss talks)
      if (_psAutoWalking && _psBossTalking) {
        playerControls.isMoving = false;
      } else if (_psAutoWalking) {
        const _hasNearAttacker = hordeEnemies.some(e =>
          !e.isDead &&
          e._aiState === 'attack' &&
          e.group.position.distanceTo(playerModel.position) < 3.5
        );
        if (_psFindIncomingThreat()) {
          playerControls.isMoving = false;
        } else if (!_hasNearAttacker) {
          // A boss fighting (Pemberton / a stage boss after its talk): walk toward it (it may
          // back off to shoot / cast) instead of a path end
          const _bossPos = _psBoss?.isStarted() && !_psBoss.enemy.isDead ? _psBoss.enemy.group.position : null;
          // Along the path: a little ahead of the player's spot on it (the last point = the end)
          let _walkTo = _bossPos ?? _psPathEnd;
          if (!_bossPos && _psPath) {
            const _ahead = _psPath.at(_psPathProgress + PS_PATH_LOOKAHEAD);
            _walkTo = _psPathAheadPoint.set(_ahead.x, 0, _ahead.z);
          }
          const _ddx = _walkTo.x - playerModel.position.x;
          const _ddz = _walkTo.z - playerModel.position.z;
          const _distToEnd = Math.sqrt(_ddx * _ddx + _ddz * _ddz);
          if (_bossPos) {
            if (_distToEnd > PEMBERTON_WALK_STOP_DIST) {
              _psAutoWalkDir.set(_ddx / _distToEnd, 0, _ddz / _distToEnd);
              const _moveStep = PS_SPEED * frameDelta;
              playerControls.queueAutoMove(_psAutoWalkDir.x * _moveStep, _psAutoWalkDir.z * _moveStep);
              playerControls.isMoving = true;
            } else {
              playerControls.isMoving = false;
            }
          } else if (_distToEnd > PS_PATH_REACHED) {
            // Recompute direction each frame so manual movement doesn't break the path
            _psAutoWalkDir.set(_ddx / _distToEnd, 0, _ddz / _distToEnd);
            const _moveStep = PS_SPEED * frameDelta;
            // Moved by processMovement next frame, so it climbs steep ground like manual walking
            playerControls.queueAutoMove(_psAutoWalkDir.x * _moveStep, _psAutoWalkDir.z * _moveStep);
            playerControls.isMoving = true;
          } else {
            // At the end: wait there (walked away by hand, it picks up again)
            playerControls.isMoving = false;
          }
        }
      }

      // Classic: only the closest living enemy shows its name tag (name + hearts)
      if (_classicMode) {
        let _closestTag = null;
        let _closestTagDist = Infinity;
        for (const _ce of hordeEnemies) {
          if (_ce.isDead || !_ce.nameTag) continue;
          const _d = _ce.group.position.distanceToSquared(playerModel.position);
          if (_d < _closestTagDist) { _closestTagDist = _d; _closestTag = _ce; }
        }
        for (const _ce of hordeEnemies) _ce.setTargeted?.(_ce === _closestTag);
      }

      // Win detection
      // (a voyage ends back at anchor instead — _voyageUpdate)
      if (_psStageActive && !_psWinShown && !_voyage && _psEnemyQueue.length === 0 && (hordeEnemies.length > 0 || _psSparedEnemies.length > 0)
        && hordeEnemies.every(e => e.isDead)) {
        _psStageActive = false;
        _psWinShown = true;
        comboMeter.end();
        heartBubbles.clear();
        stageChests.clear();
        if (!_classicMode) addPlayerXp(getSwordShowdownStageXp(_psStage));
        // Boss beaten: unlock its character (the win banner names it); next stage picks a new boss
        const _clearedBoss = _psStageBoss;
        if (!_classicMode && _clearedBoss?.unlocks && !_psChars.unlocked.includes(_clearedBoss.key)) {
          _psChars = _psNormalizeChars({ ..._psChars, unlocked: [..._psChars.unlocked, _clearedBoss.key] });
          _psSaveChars();
        }
        // The quest's pay: handed over at the next talk with the villager (a roam quest's: now)
        const _roamDone = _classicMode ? null : _psRoamQuest;
        if (_roamDone) {
          _spawnRewardCoins(_roamDone.reward);
          _psMarkRoamDone(_roamDone.stage);
        } else if (!_classicMode) {
          _psSetRewardOwed(_psRewardOwed + villagerQuestReward(_psStage));
        }
        // Stage cleared: restore the player to full health
        setStat('health', statsState.maxHealthSegments);
        const _nextStage = _psStage + 1;
        _psShowWin(() => {
          if (!_classicMode) _psStageBoss = null; // (Classic leaves Showdown's next boss alone)
          // (a roam quest: back to roam, right here — the stage doesn't move on)
          if (_roamDone) { _psEnterRoam(); return; }
          const _saveStage = _classicMode ? _classicSaveStage : _psSaveStage;
          if (_nextStage <= 50) {
            _psStage = _nextStage;
            _saveStage(_psStage);
            _psShowStageScreen(_nextStage, (count, opts) => _psStartStage(_nextStage, count, opts), { approach: true });
          } else {
            _psStage = 1;
            _saveStage(_psStage);
            _psShowStageScreen(1, (count, opts) => _psStartStage(1, count, opts), { approach: true });
          }
        });
      }

      // ── Phone Sword: camera auto-aim at closest enemy (not while the phone aims a gun / shield) ──
      if (playerControls && hordeEnemies.length > 0 && !_weaponAim.active) {
        const _now = performance.now();

        // Detect manual camera movement: if yaw changed and we didn't set it, player moved camera
        const _curYaw = playerControls.yaw;
        if (_psCamLastYaw !== null) {
          const _yawDiff = Math.abs(((_curYaw - _psCamLastYaw + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
          if (_yawDiff > 0.01 && playerControls.cameraTouchId !== null) {
            _psCamManualUntil = _now + PS_CAM_MANUAL_TIMEOUT;
          }
        }

        const _incoming = _psFindIncomingThreat();
        if (_now >= _psCamManualUntil && _incoming) {
          // An incoming bomb / magic blast takes priority over enemies: track the closest one
          const _bp = _incoming;
          const _dx = _bp.x - playerModel.position.x;
          const _dz = _bp.z - playerModel.position.z;
          if (Math.hypot(_dx, _dz) > 0.5) {
            const _targetYaw = Math.atan2(_dx, _dz);
            const _yawDelta = ((_targetYaw - playerControls.yaw + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;
            playerControls.yaw += _yawDelta * Math.min(1, frameDelta * 6);
          }
          _aimCameraPitchAt(_bp, frameDelta);
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
              _aimCameraPitchAt(_tp, frameDelta);
            }
          } else {
            _psCamTarget = null;
            _psCamCandidate = null;
            _psCamLastYaw = playerControls.yaw;
            _aimCameraPitchAt(null, frameDelta);
          }
        } else {
          // Manual control active — track current yaw without overriding
          _psCamLastYaw = playerControls.yaw;
        }
      }
    }

    // ── Town: in a talk, the camera turns to whoever's talking to the player ──
    const _townTalker = town?.isActive() && playerControls && !playerDead ? town.talkFocus() : null;
    if (_townTalker) {
      const _pp = playerModel.position;
      const _dx = _townTalker.x - _pp.x;
      const _dz = _townTalker.z - _pp.z;
      if (Math.hypot(_dx, _dz) > 0.3) {
        playerControls.yaw += wrapDeltaRad(Math.atan2(_dx, _dz) - playerControls.yaw) * Math.min(1, frameDelta * 4);
      }
      _aimCameraPitchAt(_townTalker, frameDelta);
    }

    // ── Town: with the sword / wand out, the camera turns toward whoever's coming at the player
    // (townsfolk / the law / bandits fighting them, raiding bandits close by at night); turning
    // by hand pauses it ──
    if (!_townTalker && town?.isActive() && playerControls && !playerDead && foamSword?.holder === playerControls && !_rodActive && !_oarActive && !_weaponAim.active) {
      const _nowT = performance.now();
      if (_townCamLastYaw !== null && Math.abs(wrapDeltaRad(playerControls.yaw - _townCamLastYaw)) > 0.01) {
        _townCamManualUntil = _nowT + TOWN_AIM_MANUAL_MS;
      }
      const _pp = playerModel.position;
      let _tgt = null;
      let _tgtD = Infinity;
      let _keep = null;
      let _keepD = Infinity;
      for (const _p of town.threats(TOWN_AIM_RANGE)) {
        const _d = Math.hypot(_p.x - _pp.x, _p.z - _pp.z);
        if (_d < _tgtD) { _tgtD = _d; _tgt = _p; }
        // (the one tracked last frame: kept unless another is clearly closer)
        if (_townCamTarget && Math.hypot(_p.x - _townCamTarget.x, _p.z - _townCamTarget.z) < 1 && _d < _keepD) { _keepD = _d; _keep = _p; }
      }
      if (_keep && _keepD - _tgtD < TOWN_AIM_SWITCH_CLOSER) _tgt = _keep;
      _townCamTarget = _tgt ? { x: _tgt.x, z: _tgt.z } : null;
      if (_tgt && _nowT >= _townCamManualUntil) {
        const _dx = _tgt.x - _pp.x;
        const _dz = _tgt.z - _pp.z;
        if (Math.hypot(_dx, _dz) > 0.5) {
          playerControls.yaw += wrapDeltaRad(Math.atan2(_dx, _dz) - playerControls.yaw) * Math.min(1, frameDelta * 4);
        }
        _aimCameraPitchAt(_tgt, frameDelta);
      }
      _townCamLastYaw = playerControls.yaw;
    } else {
      _townCamLastYaw = null;
      _townCamTarget = null;
    }

    // ── Duel / battle: camera turns toward the (closest) opponent (keyboard / touch
    // turning pauses it) ──
    const _pvpFighting = !!(duelMode?.isFighting() || matchMode?.isFighting());
    if (_pvpFighting && playerControls) {
      let _opp = null;
      let _oppDistSq = Infinity;
      for (const _t of _getPvpTargets()) {
        const _d = _t.position.distanceToSquared(playerModel.position);
        if (_d < _oppDistSq) { _oppDistSq = _d; _opp = _t; }
      }
      const _nowD = performance.now();
      if (_duelCamLastYaw !== null && Math.abs(wrapDeltaRad(playerControls.yaw - _duelCamLastYaw)) > 0.01) {
        _duelCamManualUntil = _nowD + 2000;
      }
      if (_opp && _nowD >= _duelCamManualUntil) {
        const _dx = _opp.position.x - playerModel.position.x;
        const _dz = _opp.position.z - playerModel.position.z;
        if (Math.hypot(_dx, _dz) > 0.5) {
          playerControls.yaw += wrapDeltaRad(Math.atan2(_dx, _dz) - playerControls.yaw) * Math.min(1, frameDelta * 4);
        }
        if (!_weaponAim.active) _aimCameraPitchAt(_opp.position, frameDelta);
      }
      _duelCamLastYaw = playerControls.yaw;

      // Duel: walk in toward the opponent (they do the same on their side) and stop when close
      const _walkStop = DUEL_WALK_STOP_DIST;
      if (_duelWalking && _opp && !playerDead) {
        const _wdx = _opp.position.x - playerModel.position.x;
        const _wdz = _opp.position.z - playerModel.position.z;
        const _wDist = Math.hypot(_wdx, _wdz);
        if (_wDist > _walkStop) {
          const _step = Math.min(PS_SPEED * frameDelta, _wDist - _walkStop);
          // Moved by processMovement next frame, so it climbs steep ground like manual walking
          playerControls.queueAutoMove((_wdx / _wDist) * _step, (_wdz / _wDist) * _step);
          playerControls.isMoving = true;
        } else {
          _duelWalking = false;
          playerControls.isMoving = false;
        }
      }

      // Too close to land a swing (the blade reaches past the body): step back to
      // DUEL_MIN_SPACING. The opponent does the same on their side, so both give ground.
      if (!_duelWalking && _opp && !playerDead) {
        let _sdx = playerModel.position.x - _opp.position.x;
        let _sdz = playerModel.position.z - _opp.position.z;
        let _sDist = Math.hypot(_sdx, _sdz);
        if (_sDist < 1e-3) {
          _sdx = -Math.sin(playerControls.yaw);
          _sdz = -Math.cos(playerControls.yaw);
          _sDist = 0;
        } else {
          _sdx /= _sDist;
          _sdz /= _sDist;
        }
        const _minSpacing = DUEL_MIN_SPACING;
        if (_sDist < _minSpacing) {
          const _step = Math.min(DUEL_SPACING_SPEED * frameDelta, _minSpacing - _sDist);
          const _nx = playerModel.position.x + _sdx * _step;
          const _nz = playerModel.position.z + _sdz * _step;
          playerModel.position.x = _nx;
          playerModel.position.z = _nz;
          playerControls.playerX = _nx;
          playerControls.playerZ = _nz;
          playerControls.lastPosition?.set(_nx, playerModel.position.y, _nz);
          if (playerControls.body) {
            playerControls.body.setNextKinematicTranslation({ x: _nx, y: playerModel.position.y + 0.6, z: _nz });
          }
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
          // (lands on what's under the feet — a jump under a bridge doesn't land on its deck)
          { includeSolidHit: false, reach: playerModel.position.y + 0.6 }
        )?.groundY;
        return Number.isFinite(_gy) ? _gy : (_psGroundY ?? playerModel.position.y);
      };
      // (a broken position: back on the ground)
      if (!Number.isFinite(playerModel.position.y)) {
        const _gy = getTerrainHeight(playerModel.position.x, playerModel.position.z);
        playerModel.position.y = Number.isFinite(_gy) ? _gy : (_psGroundY ?? 0);
        playerControls.playerY = playerModel.position.y;
        _psJumpVelY = window.phoneSwordAirborne ? -0.01 : 0;
      }
      // (in the air with no fall going on: fall)
      if (window.phoneSwordAirborne && (_psJumpVelY === 0 || !Number.isFinite(_psJumpVelY))) _psJumpVelY = -0.01;
      _psAirborneS = window.phoneSwordAirborne ? _psAirborneS + frameDelta : 0;
      if (_psJumpVelY === 0 && !window.phoneSwordAirborne) _psGroundY = playerModel.position.y;
      if (window.phoneSwordJumpPressed) {
        window.phoneSwordJumpPressed = false;
        if (!_classicMode && !_broomRide?.isRiding() && playerModel.position.y <= _psGroundY + 0.05) { // no jumping in Classic (or on the broom)
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
        // (stuck in the air: down on the ground under them — PlayerControls lifts them back on
        // top if that's under the map)
        if (_psAirborneS > PS_AIRBORNE_MAX_S) playerModel.position.y = Math.min(playerModel.position.y, _psGroundY);
        if (playerModel.position.y <= _psGroundY) {
          playerModel.position.y = _psGroundY;
          playerControls.playerY = _psGroundY;
          _psJumpVelY = 0;
          _psAirborneS = 0;
          window.phoneSwordAirborne = false;
          playerControls.canJump = true;
          playerControls.landed?.();
        }
      }
    }

    // ── Horde enemy update (also runs in duels: player knockback + body sync) ──
    if (hordeEnemies.length > 0 || duelMode?.isInDuel() || matchMode?.isInMatch()) {
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
      const _liveEnemies = hordeEnemies.filter(e => !e.isDead && !(e instanceof BombThrowerEnemy) && !e.wand
        && e.script?.mode !== 'passive'); // (a stage boss waiting to talk)
      _liveEnemies.sort((a, b) =>
        a.group.position.distanceTo(playerModel.position) -
        b.group.position.distanceTo(playerModel.position)
      );
      const _attackSlotSet = new Set(_liveEnemies.slice(0, _MAX_ATTACKERS));

      // Sword Showdown: enemies hold their attacks while a bomb / magic blast is inbound
      const _pauseForBomb = !!_psFindIncomingThreat();

      for (let _hi = hordeEnemies.length - 1; _hi >= 0; _hi--) {
        const _he = hordeEnemies[_hi];
        if (_he.isDead) {
          // Drop coins on first death frame (phone sword mode)
          if (!_he._coinDropped) {
            _he._coinDropped = true;
            _psStageKills++;
            _psUpdateKillHud(_psStageActive); // (the last kill lands after the win: the village is up)
            if (!_classicMode) { // Classic: no XP or coins
              addPlayerXp(getSwordShowdownKillXp(_psStage));
              const _dropPos = _he.group.position.clone();
              const _drops = [spawnCoinPickup(_dropPos)];
              if (Math.random() < 0.4) _drops.push(spawnCoinPickup(_dropPos.clone().add(new THREE.Vector3((Math.random()-0.5)*1.5, 0, (Math.random()-0.5)*1.5))));
              // (a voyage: the ship sails on — they come to the player)
              if (_voyage) _drops.forEach((c) => { if (c) c.userData.homing = true; });
            }
          }
          // Remove from array once the Three.js group has been removed from scene
          if (!_he.group.parent) {
            hordeEnemies.splice(_hi, 1);
            if (_he._tutorial || _he._town) continue; // tutorial / town kills don't count
            if (_classicMode) {
              _classicStats.kills += 1;
              _classicSaveStats();
              continue;
            }
            _psStats.kills = (_psStats.kills || 0) + 1;
            if (profileNameKey) void savePhoneSwordStats(profileNameKey, { ..._psStats });
          } else {
            // Still call update so physics ragdoll position/rotation syncs to visual
            _he.update(frameDelta, null, null, false, false);
            _he.onAfterUpdate?.(frameDelta);
          }
          continue;
        }

        const _allowAttack = _attackSlotSet.has(_he);
        if (_attacksHeld()) {
          // (the body is being carried off / just back from a pause: no swings / bombs at it)
          _he.update(frameDelta, _he instanceof BombThrowerEnemy ? null : playerModel, playerControls, false, false, true);
        } else {
          _he.update(frameDelta, playerModel, playerControls, shieldEquipped, _allowAttack, _pauseForBomb);
        }
        if (!_he.isFrozen?.()) _he.onAfterUpdate?.(frameDelta); // (Pemberton: gun / shield / bombs; not while frozen)

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
        const _canSwordHit = swordMesh?.visible && !_wandActive && !_rodActive && !_oarActive && !_psBossTalking &&
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
      thawPlayer();
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
      // Losing a duel shows the winner and goes back to the lobby instead of Game Over;
      // in a battle the player watches until it ends
      if (duelMode?.isInDuel()) duelMode.onLocalDeath();
      else if (matchMode?.isInMatch()) matchMode.onLocalDeath();
      else showGameOver();
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

    duelMode?.update();
    devRoam?.update();
    matchMode?.update(frameDelta);
    townNet?.update();
    if (multiplayer && _netRecipients().length && now - lastPresenceSend >= presenceSendIntervalMs) {
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
      // (battles draw other fighters' shields themselves — matchMode.js)
      payload.equippedLeft = !_matchLoadout && isInventoryItemEquipped(SHIELD_ITEM_ID) ? SHIELD_ITEM_ID : null;
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
      // (Town: the townsfolk near the player too)
      hordeEnemies: town?.isActive() ? [...hordeEnemies, ...town.getWeaponTargets()] : hordeEnemies,
      pvpTargets: matchMode?.getShotTargets() ?? (townNet?.isOn() && town?.isActive() ? townNet.getShotTargets() : null),
      pvpAlsoEnemies: !!(townNet?.isOn() && town?.isActive()),
      localTarget: _attacksHeld() ? null : _pembertonShotTarget
    });
    // A stage boss's talk box; spared bosses stand there facing the player
    bossTalk.update(frameDelta);
    for (const _se of _psSparedEnemies) _se.update(frameDelta, playerModel, playerControls, false, false, true);
    // Village (between Showdown stages): walks the player around and has the last word on the camera
    village?.update(frameDelta);
    // Town mode: the townsfolk, the clock, the law
    town?.update(frameDelta);
    _updateTownLantern(frameDelta);
    // The guest's sea start: the canoe on the sea, the player in it
    seaStart?.update(frameDelta);
    // Ships on the sea bob on the swell
    _activeMap?.animate?.(performance.now() / 1000);
    // Showdown death: the carriers + the fixed camera
    deathCarry?.update(frameDelta);
    // Shadows: the sun's shadow box follows the player (snapped to whole shadow-map texels so
    // the shadow edges don't shimmer as they move)
    // (the light's offset is the sun's — it moves through Town's day — so it follows the player
    // with or without shadows)
    if (dirLight && playerModel) {
      const texel = dirLight.castShadow ? (SHADOW_HALF_SIZE * 2) / dirLight.shadow.mapSize.x : 0;
      const fx = texel ? Math.round(playerModel.position.x / texel) * texel : playerModel.position.x;
      const fz = texel ? Math.round(playerModel.position.z / texel) * texel : playerModel.position.z;
      dirLight.target.position.set(fx, playerModel.position.y, fz);
      dirLight.position.set(fx, playerModel.position.y, fz).add(_sunOffset);
      dirLight.target.updateMatrixWorld();
    }
    // Sounds in the world are heard from the player, panned by the camera's right
    // (audioManager's distance falloff — playSFX `at`, townsfolk's voices)
    if (playerModel && audioManager) {
      const m = camera.matrixWorld.elements;
      audioManager.setListener(playerModel.position, m[0], m[2]);
    }
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
  keepScreenAwake(); // phones (also "Use This Device" as the sword) shouldn't dim / sleep mid-game

  await initCore(appContext);
  await initWorld(appContext);
  await initActors(appContext);
  await initUI(appContext);
  await initNetworkingAndPersistence(appContext);

  return appContext;
}

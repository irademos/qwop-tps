// app.js
import * as THREE from "three";
import { PlayerCharacter } from "./characters/PlayerCharacter.js";
import { loadMonsterModel } from "./models/monsterModel.js";
import { MonsterCharacter } from "./characters/MonsterCharacter.js";
import { createClouds } from "./worldGeneration.js";
import { getTerrainHeight } from './water.js';
import { Multiplayer } from './peerConnection.js';
import { PlayerControls } from './controls.js';
import { getCookie, setCookie } from './utils.js';
import { spawnProjectile, updateProjectiles } from './projectiles.js';
import { updateMeleeAttacks } from './melee.js';
import { BreakManager } from './breakManager.js';
import { initSpeechCommands } from './speechCommands.js';
import { AudioManager } from './audioManager.js';
import { IceGun } from './iceGun.js';
import RAPIER from '@dimforge/rapier3d-compat';
import { getSpawnPosition } from './spawnUtils.js';
import { createLocationProvider } from './location.js';
import { fetchOSMFeatures } from './osmClient.js';
import { createMapRenderer } from './mapRender.js';
import { createBuildingsRenderer } from './buildingsRender.js';
import { createTileCache } from './tileCache.js';
import { createGroundTiles } from './groundTiles.js';
import { clearCache, getCachedTile, setCachedTile } from './idbCache.js';
import { initSettingsPanel, openSettings, updateUI as updateSettingsUI } from './settingsPanel.js';
import { initMapView, setMapViewEnabled, update as updateMapView, zoomIn, zoomOut } from './mapView.js';
import { loadOrCreateWithPin, saveStatsThrottled } from './playerProfile.js';

const DEFAULT_CHARACTER_MODEL = "/models/old_man.fbx";
const MAX_MONSTERS = 2;
const MONSTER_MODELS = [
  "/models/rainbow_troll.fbx",
  "/models/swamp_guy.fbx",
  "/models/wizard.fbx",
  "/models/gemhorn_monster.fbx",
  "/models/alien_bumpy_bump.fbx"
];
const MONSTER_SPAWN_MIN_RADIUS = 25;
const MONSTER_SPAWN_MAX_RADIUS = 80;
const MONSTER_RESPAWN_DELAY_RANGE_MS = [3000, 5000];
const MONSTER_SPAWN_ATTEMPTS = 12;

const clock = new THREE.Clock();
const mixerClock = new THREE.Clock();


// --- Rapier demo state ---
let rapierWorld;
const rbToMesh = new Map(); // RigidBody -> THREE.Mesh
let physicsAccumulator = 0;
const FIXED_DT = 1 / 60;
const WORLD_ORIGIN_STORAGE_KEY = 'worldOrigin';
const METERS_PER_DEGREE_LAT = 111_132.92;
const PLAYER_VISIBILITY_RADIUS_M = 200;
const PRESENCE_STALE_MS = 5000;
const PRESENCE_SEND_MS = 150;
const PRESENCE_SWEEP_MS = 250;
const REMOTE_LERP_ALPHA = 0.15;
const REMOTE_TELEPORT_THRESHOLD_M = 25;

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

async function main() {
  document.body.addEventListener('touchstart', () => {}, { once: true });

  let playerName = localStorage.getItem('playerName') || getCookie("playerName");
  let profileResult = null;
  while (!profileResult) {
    if (!playerName) {
      playerName = prompt("Enter your name") || `Player${Math.floor(Math.random() * 1000)}`;
    }
    const trimmedName = playerName.trim();
    if (!trimmedName) {
      playerName = null;
      continue;
    }
    const result = await loadOrCreateWithPin(trimmedName);
    if (result?.canceled) {
      playerName = null;
      continue;
    }
    profileResult = result;
    playerName = result.profile?.name || trimmedName;
  }
  const { nameKey: profileNameKey, profile: playerProfile } = profileResult;

  setCookie("playerName", playerName);
  localStorage.setItem('playerName', playerName);

  let updatePlayerInfoUI = () => {};

  const FOOD_HUNGER_GAIN = 25;
  const FOOD_ENERGY_GAIN = 15;
  const HEALTH_PICKUP_GAIN = 20;
  const HUNGER_DECAY_PER_HOUR = 6;
  const ENERGY_DECAY_PER_SECOND_WHILE_MOVING = 0.6;
  const HUNGER_HEALTH_DECAY_PER_SECOND = 0.2;
  const PICKUP_RADIUS = 1.2;
  const MAX_FOOD_PICKUPS = 12;
  const MAX_HEALTH_PICKUPS = 8;
  const FOOD_SPAWN_MIN_RADIUS = 8;
  const FOOD_SPAWN_MAX_RADIUS = 25;
  const FOOD_SPAWN_INTERVAL_RANGE = [10, 20];
  const HEALTH_SPAWN_INTERVAL_RANGE = [14, 26];
  const ICE_GUN_SPAWN_MIN_RADIUS = 20;
  const ICE_GUN_SPAWN_MAX_RADIUS = 60;
  const ICE_GUN_SPAWN_INTERVAL_RANGE = [60, 120];

  let characterModel = localStorage.getItem('characterModel') || getCookie("characterModel") || DEFAULT_CHARACTER_MODEL;
  setCookie("characterModel", characterModel);
  localStorage.setItem('characterModel', characterModel);

  let multiplayer = null;
  let playerControls = null;
  const networkedEntities = new Map();
  const pendingEntityStates = new Map();
  const authoritativeEntityStates = new Map();
  let lastEntityBroadcast = 0;
  let lastControlSend = 0;
  const ENTITY_BROADCAST_INTERVAL = 120;
  const CONTROL_SEND_INTERVAL = 80;

  const otherPlayers = {};
  window.otherPlayers = otherPlayers;
  const remotePresenceMeta = {};
  let lastPresenceSend = 0;
  let lastPresenceSweep = 0;

  const logNet = (...args) => {
    if (window.DEBUG_NET) {
      console.log('[net]', ...args);
    }
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
    authoritativeEntityStates.set(id, {
      state: copy,
      sourceId,
      timestamp: performance.now()
    });
    applyNetworkedState(id, copy);
  }

  function serializeAuthoritativeStates() {
    const payload = {};
    authoritativeEntityStates.forEach((entry, id) => {
      payload[id] = { ...cloneState(entry.state), sourceId: entry.sourceId };
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

  function handleIncomingData(peerId, data) {
    console.log('📡 Incoming data:', data);

    if (data.type === 'entityControl') {
      if (multiplayer?.isHost && data.id && data.state && data.sourceId) {
        updateAuthoritativeState(data.id, data.state, data.sourceId);
      }
      return;
    }

    if (data.type === 'entityStates' && data.states) {
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

    if (data.type === 'entitySnapshot' && data.states && multiplayer?.isHost) {
      authoritativeEntityStates.clear();
      Object.entries(data.states).forEach(([id, entry]) => {
        if (!entry) return;
        const { sourceId, ...state } = entry;
        updateAuthoritativeState(id, state, sourceId ?? null);
      });
      lastEntityBroadcast = 0;
      return;
    }

    if (data.type === 'entityStateRequest' && data.requesterId && data.previousHostId === multiplayer?.getId?.()) {
      const snapshot = serializeAuthoritativeStates();
      if (Object.keys(snapshot).length > 0) {
        multiplayer.sendTo(data.requesterId, { type: 'entitySnapshot', states: snapshot });
      }
      return;
    }

    if (data.type === 'presence') {
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

      const localFix = getLatestLocationFix();
      const mapOrigin = getLocalMapOrigin();
      if (!localFix || !mapOrigin) {
        const existing = otherPlayers[remoteId];
        if (existing?.model) {
          existing.model.visible = false;
        }
        if (existing?.nameLabel) {
          existing.nameLabel.style.display = 'none';
        }
        return;
      }

      if (Number.isFinite(data.lat) && Number.isFinite(data.lon)) {
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
        const local = geoToLocalMeters(data.lat, data.lon, mapOrigin);
        if (local) {
          targetX = local.x;
          targetZ = local.z;
        }
      } else if (Number.isFinite(data.x) && Number.isFinite(data.z)) {
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
      const position = new THREE.Vector3(...data.position);
      const direction = new THREE.Vector3(...data.direction);
      spawnProjectile(scene, projectiles, position, direction, data.id);

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

    if (data.type === 'grab') {
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
    if (previousHostId && previousHostId === multiplayer.getId() && previousHostId !== newHostId) {
      const snapshot = serializeAuthoritativeStates();
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
  const audioManager = new AudioManager();
  const startOverlay = document.getElementById('start-overlay');
  let hasStartedAudio = false;

  const focusGameCanvas = () => {
    const canvas = document.querySelector('#game-container canvas');
    if (canvas) {
      canvas.tabIndex = 0;
      canvas.focus();
    } else {
      document.body?.focus?.();
    }
  };

  const hideStartOverlay = () => {
    if (!startOverlay) return;
    startOverlay.setAttribute('aria-hidden', 'true');
    startOverlay.removeAttribute('tabindex');
    startOverlay.classList.add('hidden');
    startOverlay.style.display = 'none';
    startOverlay.blur();
    focusGameCanvas();
  };

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

  const startAudioAndGameOnce = async () => {
    if (hasStartedAudio) return;
    hasStartedAudio = true;
    removeStartOverlayListeners();
    hideStartOverlay();
    await resumeAudioContext();
    audioManager.playBGS('Forest Day/Forest Day.ogg');
  };

  const handleStartOverlayClick = () => {
    startAudioAndGameOnce();
  };

  const handleStartOverlayKeydown = event => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      startAudioAndGameOnce();
    }
  };

  const removeStartOverlayListeners = () => {
    if (!startOverlay) return;
    startOverlay.removeEventListener('click', handleStartOverlayClick);
    startOverlay.removeEventListener('keydown', handleStartOverlayKeydown);
  };

  if (startOverlay) {
    startOverlay.setAttribute('aria-hidden', 'false');
    startOverlay.tabIndex = 0;
    startOverlay.addEventListener('click', handleStartOverlayClick);
    startOverlay.addEventListener('keydown', handleStartOverlayKeydown);
  }

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87CEEB);

  createClouds(scene);

  let iceGun;

  const breakManager = new BreakManager(scene);
  // Expose to window for debugging
  window.breakManager = breakManager;

  let monsters = [];
  window.monsters = monsters;
  const monsterSlotIds = ["monster:0", "monster:1"];
  const spawningSlots = new Set();
  const respawnTimers = new Map();

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.getElementById('game-container').appendChild(renderer.domElement);

  const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
  const mapRenderer = createMapRenderer({ scene, renderer });
  const buildingsRenderer = createBuildingsRenderer({ scene, camera });
  window.mapRenderer = mapRenderer;
  window.buildingsRenderer = buildingsRenderer;

  const handleResize = () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    mapRenderer.setResolution(window.innerWidth, window.innerHeight);
  };
  window.addEventListener('resize', handleResize);
  handleResize();

  const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
  scene.add(ambientLight);

  const dirLight = new THREE.DirectionalLight(0xffffff, 1);
  dirLight.position.set(5, 10, 5);
  dirLight.castShadow = true;
  scene.add(dirLight);



  // --- RAPIER INIT ---
  await RAPIER.init();
  rapierWorld = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  window.rapierWorld = rapierWorld;
  window.rbToMesh = rbToMesh;
  breakManager.setWorld(rapierWorld);

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

  iceGun = new IceGun(scene);
  await iceGun.load();
  window.iceGun = iceGun;
  iceGun.onPickup = (holder) => {
    if (holder !== playerControls) return;
    addToInventory('iceGun', 1);
  };
  iceGun.onDrop = (holder, { removeFromInventory: shouldRemoveFromInventory } = {}) => {
    if (holder !== playerControls) return;
    if (shouldRemoveFromInventory) {
      removeFromInventory('iceGun', 1);
    }
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
      iceGun.remoteHolderId = state.holderId ?? null;
      if (state.holderId !== multiplayer?.getId?.() && iceGun.holder === playerControls) {
        iceGun.holder = null;
      }
    },
    isLocallyControlled: () => iceGun?.holder === playerControls
  });

  function attachMonsterPhysics(monster) {
    const model = monster.model;
    const rbDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(model.position.x, model.position.y, model.position.z)
      .setLinearDamping(0.5)
      .setAngularDamping(0.5);
    const rb = rapierWorld.createRigidBody(rbDesc);
    const colDesc = RAPIER.ColliderDesc.capsule(0.6, 0.3);
    rapierWorld.createCollider(colDesc, rb);
    model.userData.rb = rb;
    rbToMesh.set(rb, model);
  }



  let player = new PlayerCharacter(playerName, characterModel);
  let playerModel = player.model;
  playerModel.userData.hideInMapView = true;
  scene.add(playerModel);
  document.body.appendChild(player.nameLabel);
  window.playerModel = playerModel;
  let didInitialGpsSnap = false;

  const getRandomMonsterModel = () => {
    const index = Math.floor(Math.random() * MONSTER_MODELS.length);
    return MONSTER_MODELS[index];
  };

  const isSpawnBlockedByBuildings = (position) => {
    const buildingsGroup = buildingsRenderer?.group;
    if (!buildingsGroup) return false;
    const rayOrigin = new THREE.Vector3(position.x, position.y + 50, position.z);
    const raycaster = new THREE.Raycaster(rayOrigin, new THREE.Vector3(0, -1, 0));
    const intersections = raycaster.intersectObjects(buildingsGroup.children, true);
    if (intersections.length === 0) return false;
    return intersections[0].point.y > position.y + 0.1;
  };

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
      if (isSpawnBlockedByBuildings(spawnPos)) {
        continue;
      }
      return spawnPos;
    }
    const fallback = playerModel.position.clone();
    fallback.x += MONSTER_SPAWN_MIN_RADIUS;
    fallback.y = getTerrainHeight(fallback.x, fallback.z) + 0.5;
    return fallback;
  };

  const cleanupMonster = (monster) => {
    if (!monster) return;
    if (monster.model?.parent) {
      monster.model.parent.remove(monster.model);
    }
    const body = monster.body;
    if (body && rapierWorld?.getRigidBody(body.handle)) {
      rbToMesh.delete(body);
      rapierWorld.removeRigidBody(body);
    }
  };

  const setMonsterForSlot = (slotId, monster) => {
    const existingIndex = monsters.findIndex(entry => entry.id === slotId);
    if (existingIndex >= 0) {
      monsters[existingIndex] = monster;
    } else {
      monsters.push(monster);
    }
  };

  const spawnMonsterInSlot = (slotId, modelPath, oldMonster = null) => {
    if (spawningSlots.has(slotId)) return;
    spawningSlots.add(slotId);
    loadMonsterModel(modelPath, data => {
      try {
        const monster = new MonsterCharacter(data);
        monster.id = slotId;
        monster.modelPath = modelPath;
        monster.model.userData.hideInMapView = true;
        monster.setMode("friendly");
        monster.setDirection(new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5).normalize());
        monster.lastDirectionChange = Date.now();
        monster.resetHealth();

        const monsterSpawn = getMonsterSpawnPosition();
        monster.setPosition(monsterSpawn.x, monsterSpawn.y, monsterSpawn.z);

        cleanupMonster(oldMonster);
        scene.add(monster.model);
        if (rapierWorld) {
          attachMonsterPhysics(monster);
        }
        setMonsterForSlot(slotId, monster);
      } finally {
        spawningSlots.delete(slotId);
      }
    });
  };

  const ensureMonsters = () => {
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
        const pos = monster.model.position;
        const q = monster.model.quaternion;
        return {
          position: [pos.x, pos.y, pos.z],
          rotation: [q.x, q.y, q.z, q.w],
          mode: monster.model.userData.mode,
          action: monster.model.userData.currentAction,
          health: monster.model.userData.health,
          modelPath: monster.modelPath
        };
      },
      applyState: state => {
        if (!state) return;
        const [px, py, pz] = state.position || [];
        const [rx, ry, rz, rw] = state.rotation || [];
        const current = monsters.find(entry => entry.id === slotId);
        if (state.modelPath && (!current || current.modelPath !== state.modelPath)) {
          spawnMonsterInSlot(slotId, state.modelPath, current);
        }
        const monster = monsters.find(entry => entry.id === slotId);
        if (!monster) return;
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
          monster.isDead = state.mode === 'dead';
        }
        if (typeof state.health === 'number') {
          monster.health = state.health;
          monster.model.userData.health = state.health;
        }
        if (state.mode === 'dead' && state.health <= 0) {
          cleanupMonster(monster);
          monsters = monsters.filter(entry => entry.id !== slotId);
          window.monsters = monsters;
          return;
        }
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
    luck: playerProfile.stats.luck
  };
  const playerNameDisplay = document.getElementById('player-name-display');
  const playerLevelDisplay = document.getElementById('player-level');
  const levelPopup = document.getElementById('level-popup');
  let levelPopupTimer = null;
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
  const inventoryCatalog = {
    iceGun: {
      name: 'Ice Gun',
      icon: '/assets/ui/items/icegun.png'
    }
  };
  const inventoryState = { ...(playerProfile.inventory || {}) };
  let inventoryDirty = false;
  Object.entries(inventoryState).forEach(([itemId, entry]) => {
    const itemConfig = inventoryCatalog[itemId];
    if (!itemConfig) return;
    const nextEntry = { ...entry };
    if (!nextEntry.name) {
      nextEntry.name = itemConfig.name;
      inventoryDirty = true;
    }
    if (!nextEntry.icon) {
      nextEntry.icon = itemConfig.icon;
      inventoryDirty = true;
    }
    inventoryState[itemId] = nextEntry;
  });
  if (inventoryDirty) {
    saveStatsThrottled(profileNameKey, statsState, lastStatUpdateAt, inventoryState);
  }

  function getInventory() {
    return inventoryState;
  }

  function addToInventory(itemId, amount = 1) {
    if (!itemId || !Number.isFinite(amount) || amount <= 0) return;
    const itemConfig = inventoryCatalog[itemId] || {};
    const current = inventoryState[itemId];
    const nextCount = (current?.count || 0) + amount;
    inventoryState[itemId] = {
      count: nextCount,
      icon: current?.icon || itemConfig.icon || '',
      name: current?.name || itemConfig.name || itemId
    };
    if (window.DEBUG_INVENTORY) {
      console.log('[inventory] added', itemId, amount, inventoryState[itemId]);
    }
    saveStatsThrottled(profileNameKey, statsState, lastStatUpdateAt, inventoryState);
    updateSettingsUI();
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
    saveStatsThrottled(profileNameKey, statsState, lastStatUpdateAt, inventoryState);
    updateSettingsUI();
  }

  function isInventoryItemEquipped(itemId) {
    if (itemId === 'iceGun') {
      return iceGun?.holder === playerControls;
    }
    return false;
  }

  function getEquippedInventoryItemId() {
    return isInventoryItemEquipped('iceGun') ? 'iceGun' : null;
  }

  function equipInventoryItem(itemId) {
    if (!itemId || !inventoryState[itemId]) return;
    if (itemId === 'iceGun') {
      if (!iceGun?.mesh || !playerControls) return;
      if (iceGun.remoteHolderId && iceGun.remoteHolderId !== multiplayer?.getId?.()) return;
      iceGun.mesh.visible = true;
      iceGun.holder = playerControls;
      playerControls.updateAmmoUI?.(true);
      updateSettingsUI();
    }
  }

  function unequipInventoryItem(itemId) {
    if (itemId === 'iceGun') {
      if (iceGun?.holder !== playerControls) return;
      iceGun.holder = null;
      if (iceGun.mesh) {
        iceGun.mesh.visible = false;
      }
      removeFromInventory('iceGun', 1);
      playerControls?.updateAmmoUI?.(false);
      updateSettingsUI();
    }
  }

  let mapViewEnabled = false;
  let playerDead = false;
  const updateControlAvailability = () => {
    if (!playerControls) return;
    const energyDepleted = statsState.energy <= 0;
    playerControls.enabled = !mapViewEnabled && !playerDead && !energyDepleted;
  };

  const healthFill = document.getElementById('health-fill');
  const hungerFill = document.getElementById('hunger-fill');
  const energyFill = document.getElementById('energy-fill');

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
      updateControlAvailability();
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
  const adjustLevel = delta => {
    const currentLevel = Number.isFinite(statsState.level) ? statsState.level : 1;
    const nextLevel = clampStat('level', currentLevel + delta);
    if (nextLevel === currentLevel) {
      return;
    }
    setStat('level', nextLevel);
    showLevelPopup(nextLevel);
  };

  window.onMonsterKill = () => adjustLevel(1);
  window.onPlayerDeath = () => adjustLevel(-1);

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

  const projectiles = [];
  const ammoPickups = [];
  const AMMO_PICKUP_AMOUNT = 5;
  const foodPickups = [];
  const healthPickups = [];

  function spawnAmmoPickup(position) {
    const spawnPos = position.clone();
    const terrainHeight = getTerrainHeight(spawnPos.x, spawnPos.z);
    spawnPos.y = terrainHeight + 0.6;

    const geometry = new THREE.IcosahedronGeometry(0.25, 0);
    const material = new THREE.MeshStandardMaterial({
      color: 0x7fd0ff,
      emissive: 0x225577,
      emissiveIntensity: 0.4,
      metalness: 0.1,
      roughness: 0.4,
    });

    const pickup = new THREE.Mesh(geometry, material);
    pickup.position.copy(spawnPos);
    pickup.castShadow = true;
    pickup.userData.baseY = spawnPos.y;
    pickup.userData.phase = Math.random() * Math.PI * 2;
    scene.add(pickup);
    ammoPickups.push(pickup);
    return pickup;
  }

  function spawnFoodPickup(position) {
    const spawnPos = position.clone();
    const terrainHeight = getTerrainHeight(spawnPos.x, spawnPos.z);
    spawnPos.y = terrainHeight + 0.6;

    const geometry = new THREE.IcosahedronGeometry(0.25, 0);
    const material = new THREE.MeshStandardMaterial({
      color: 0xc7a77a,
      emissive: 0x2a1a0a,
      emissiveIntensity: 0.2,
      metalness: 0.05,
      roughness: 0.8
    });

    const pickup = new THREE.Mesh(geometry, material);
    pickup.position.copy(spawnPos);
    pickup.castShadow = true;
    pickup.userData.baseY = spawnPos.y;
    pickup.userData.phase = Math.random() * Math.PI * 2;
    pickup.userData.type = 'food';
    scene.add(pickup);
    foodPickups.push(pickup);
    return pickup;
  }

  function spawnHealthPickup(position) {
    const spawnPos = position.clone();
    const terrainHeight = getTerrainHeight(spawnPos.x, spawnPos.z);
    spawnPos.y = terrainHeight + 0.6;

    const geometry = new THREE.IcosahedronGeometry(0.25, 0);
    const material = new THREE.MeshStandardMaterial({
      color: 0xff5a5a,
      emissive: 0x5a1111,
      emissiveIntensity: 0.4,
      metalness: 0.05,
      roughness: 0.7
    });

    const pickup = new THREE.Mesh(geometry, material);
    pickup.position.copy(spawnPos);
    pickup.castShadow = true;
    pickup.userData.baseY = spawnPos.y;
    pickup.userData.phase = Math.random() * Math.PI * 2;
    pickup.userData.type = 'health';
    scene.add(pickup);
    healthPickups.push(pickup);
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

  function spawnIceGunPickup(position) {
    if (!iceGun?.mesh) return;
    const spawnPos = position.clone();
    const terrainHeight = getTerrainHeight(spawnPos.x, spawnPos.z);
    if (!Number.isFinite(terrainHeight)) return;
    spawnPos.y = terrainHeight + 0.5;
    iceGun.mesh.position.copy(spawnPos);
    iceGun.mesh.quaternion.set(0, 0, 0, 1);
    iceGun.mesh.visible = true;
    iceGun.holder = null;
  }

  let lastFoodSpawnAt = performance.now();
  let nextFoodSpawnDelay = THREE.MathUtils.randFloat(...FOOD_SPAWN_INTERVAL_RANGE) * 1000;
  let lastHealthSpawnAt = performance.now();
  let nextHealthSpawnDelay = THREE.MathUtils.randFloat(...HEALTH_SPAWN_INTERVAL_RANGE) * 1000;
  let lastIceGunSpawnAt = performance.now();
  let nextIceGunSpawnDelay = THREE.MathUtils.randFloat(...ICE_GUN_SPAWN_INTERVAL_RANGE) * 1000;
  let statDecayAccumulator = 0;

  const isHost = !multiplayer || multiplayer.isHost;
  if (isHost && !inventoryState.iceGun?.count && iceGun?.mesh && !iceGun.holder) {
    const angle = Math.random() * Math.PI * 2;
    const radius = THREE.MathUtils.randFloat(ICE_GUN_SPAWN_MIN_RADIUS, ICE_GUN_SPAWN_MAX_RADIUS);
    const spawnPos = new THREE.Vector3(
      playerModel.position.x + Math.cos(angle) * radius,
      0,
      playerModel.position.z + Math.sin(angle) * radius
    );
    spawnIceGunPickup(spawnPos);
    lastIceGunSpawnAt = performance.now();
    nextIceGunSpawnDelay = THREE.MathUtils.randFloat(...ICE_GUN_SPAWN_INTERVAL_RANGE) * 1000;
  }

  playerControls = new PlayerControls({
    scene,
    camera,
    playerModel,
    renderer,
    multiplayer,
    spawnProjectile,
    projectiles,
    audioManager
  });
  window.playerControls = playerControls;
  updateControlAvailability();

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
  const TILE_FETCH_RADIUS_METERS = TILE_SIZE_METERS * Math.SQRT2 * 0.5;
  const TILE_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
  const tileCache = createTileCache({
    tileSizeMeters: TILE_SIZE_METERS,
    evictRadiusTiles: TILE_EVICT_RADIUS
  });
  const groundTiles = createGroundTiles({
    scene,
    renderer,
    tileSizeMeters: TILE_SIZE_METERS
  });
  window.groundTiles = groundTiles.tiles;
  const mapFetchInFlight = new Set();
  let activeTileKey = null;
  let worldOrigin = null;
  let currentRenderOrigin = null;

  const loadWorldOrigin = () => {
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
  };

  const setWorldOrigin = (origin) => {
    if (!origin || !Number.isFinite(origin.lat) || !Number.isFinite(origin.lon)) return;
    worldOrigin = { lat: origin.lat, lon: origin.lon };
    localStorage.setItem(WORLD_ORIGIN_STORAGE_KEY, JSON.stringify(worldOrigin));
    tileCache.setOrigin(worldOrigin);
    currentRenderOrigin = { centerLat: origin.lat, centerLon: origin.lon };
  };

  const resetWorldOrigin = () => {
    worldOrigin = null;
    localStorage.removeItem(WORLD_ORIGIN_STORAGE_KEY);
    tileCache.setOrigin(null);
    currentRenderOrigin = null;
  };

  const computePlayerMeters = (location) => {
    if (!worldOrigin || !location) return null;
    if (!Number.isFinite(location.lat) || !Number.isFinite(location.lon)) return null;
    const lonScale = metersPerDegreeLon(worldOrigin.lat);
    return {
      x: (location.lon - worldOrigin.lon) * lonScale,
      z: -(location.lat - worldOrigin.lat) * METERS_PER_DEGREE_LAT
    };
  };

  const getLocalMapOrigin = () => {
    if (worldOrigin) {
      return { centerLat: worldOrigin.lat, centerLon: worldOrigin.lon };
    }
    return currentRenderOrigin;
  };

  const geoToLocalMeters = (lat, lon, origin) => {
    if (!origin || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    const lonScale = metersPerDegreeLon(origin.centerLat);
    return {
      x: (lon - origin.centerLon) * lonScale,
      z: -(lat - origin.centerLat) * METERS_PER_DEGREE_LAT
    };
  };

  const localMetersToGeo = (x, z, origin) => {
    if (!origin || !Number.isFinite(x) || !Number.isFinite(z)) return null;
    const lonScale = metersPerDegreeLon(origin.centerLat);
    return {
      lat: origin.centerLat - z / METERS_PER_DEGREE_LAT,
      lon: origin.centerLon + x / lonScale
    };
  };

  const getLatestLocationFix = () => {
    const latest = window.latestLocation;
    if (!latest || !Number.isFinite(latest.lat) || !Number.isFinite(latest.lon)) {
      return null;
    }
    return latest;
  };

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
    return computeGeojsonBounds(geojson);
  };

  const rebuildMapFromCache = () => {
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
    mapRenderer.updateHighways(combined, bounds);
    buildingsRenderer.updateBuildings(combined, bounds);
  };

  window.clearTileCache = () => {
    tileCache.cache.clear();
    groundTiles.clear();
    clearCache().catch((error) => console.warn('Failed to clear persistent tile cache:', error));
    rebuildMapFromCache();
  };

  const requestMapUpdate = async (location) => {
    if (!location) return;
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
      evictedKeys.forEach((key) => groundTiles.removeTile(key));
      rebuildMapFromCache();
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
      groundTiles.ensureTile(tile, tileKey);
      rebuildMapFromCache();
      if (Date.now() - cachedTile.fetchedAt < TILE_CACHE_MAX_AGE_MS) {
        return;
      }
    }

    const tileCenter = tileCache.getTileCenterLocation(tile);
    if (!tileCenter) return;

    mapFetchInFlight.add(tileKey);
    let geojson;
    try {
      geojson = await fetchOSMFeatures(tileCenter.lat, tileCenter.lon, TILE_FETCH_RADIUS_METERS);
      debugState.lastOsmFetchAt = Date.now();
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
      groundTiles.ensureTile(tile, tileKey);
      setCachedTile(tileKey, geojson).catch((error) => {
        console.warn('Failed to persist tile cache:', error);
      });
      rebuildMapFromCache();
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
      playerControls?.setGeoCenter({ lat: location.lat, lon: location.lon });
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

        if (!didInitialGpsSnap) {
          applyPlayerMeters(playerMeters);
          didInitialGpsSnap = true;
        }
      } else {
        locationState.playerX = null;
        locationState.playerZ = null;
      }

      const localMeters = tileCache.getLocalMeters(location);
      locationState.tile = tileCache.getTileCoords(localMeters);
      requestMapUpdate(location);
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
  locationProvider.start();
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      locationProvider.stop();
    } else {
      locationProvider.start();
    }
  });
  window.addEventListener('beforeunload', () => locationProvider.stop());

  spawnAmmoPickup(new THREE.Vector3(-4, 0, 4));
  spawnAmmoPickup(new THREE.Vector3(2, 0, -3));

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
      respawnPlayer();
      hideGameOver();
    };

    noBtn.onclick = () => {
      clearInterval(interval);
      hideGameOver();
    };
  }

  function hideGameOver() {
    gameOverOverlay.classList.add('hidden');
  }

  function respawnPlayer() {
    setStat('health', 100);
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
    playerControls.velocity.set(0, 0, 0);
    playerDead = false;
    updateControlAvailability();
    const actions = playerModel.userData.actions;
    const current = playerModel.userData.currentAction;
    actions?.[current]?.fadeOut(0.2);
    actions?.idle?.reset().fadeIn(0.2).play();
    playerModel.userData.currentAction = 'idle';
  }

  // Initialize speech commands for voice-controlled actions
  const speech = initSpeechCommands({
    jump: () => playerControls.triggerJump(),
    fire: () => playerControls.triggerFire(),
    shoot: () => playerControls.triggerFire()
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

  let localStream = null;
  let micActive = false;
  const voiceButton = document.getElementById('voice-button');

  voiceButton.addEventListener('click', async () => {
    if (!micActive) {
      try {
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        multiplayer.startVoice(localStream);
        micActive = true;
        voiceButton.textContent = "Mute";
      } catch (err) {
        console.error("Microphone access denied:", err);
      }
    } else {
      if (localStream) {
        multiplayer.stopVoice();
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
      }
      micActive = false;
      voiceButton.textContent = "Unmute";
    }
  });

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
    document.body.appendChild(newPlayer.nameLabel);

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
  const characterOptions = ['andy', 'chris', 'gemhorn_monster', 'old_man', 'wizard', 'rainbow_troll', 'alien_bumpy_bump', 'swamp_guy'].map(name => ({
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
    getCharacterModel: () => characterModel,
    setCharacterModel: (modelPath) => {
      if (!modelPath || modelPath === characterModel) return;
      characterModel = modelPath;
      swapPlayerCharacter(characterModel);
      setCookie("characterModel", characterModel);
      localStorage.setItem('characterModel', characterModel);
    },
    getCharacterOptions: () => characterOptions,
    getInventory: () => getInventory(),
    getEquippedInventoryItemId: () => getEquippedInventoryItemId(),
    isInventoryItemEquipped: (itemId) => isInventoryItemEquipped(itemId),
    equipInventoryItem: (itemId) => equipInventoryItem(itemId),
    unequipInventoryItem: (itemId) => unequipInventoryItem(itemId),
    addToInventory: (itemId, amount) => addToInventory(itemId, amount),
    removeFromInventory: (itemId, amount) => removeFromInventory(itemId, amount),
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
    resetWorldOrigin: () => {
      resetWorldOrigin();
      locationState.originLat = null;
      locationState.originLon = null;
      locationState.playerX = null;
      locationState.playerZ = null;
      locationState.tile = null;
      rebuildMapFromCache();
    }
  };

  window.getInventory = getInventory;
  window.addToInventory = addToInventory;
  window.removeFromInventory = removeFromInventory;

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

  settingsBtn.addEventListener('click', () => {
    openSettings();
  });

  setInterval(() => {
    updateSettingsUI();
  }, 1000);

  const consoleDiv = document.getElementById("console-log");
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

  function animate() {
    requestAnimationFrame(animate);

    // --- RAPIER FIXED-STEP & SYNC ---
    // Accumulate variable rAF time into fixed physics steps
    const frameDelta = clock.getDelta();
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

      if (!mesh.userData?.isTerrain) {
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
        scene.remove(mesh);
        mesh.geometry.dispose();
        mesh.material.dispose();
        rbToMesh.delete(rb);
        rapierWorld.removeRigidBody(rb);
      }
    }



    if (!mapViewEnabled) {
      playerControls.update();
    }
    updateMapView(frameDelta);

    const now = performance.now();
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

    if (now - lastFoodSpawnAt >= nextFoodSpawnDelay) {
      lastFoodSpawnAt = now;
      nextFoodSpawnDelay = THREE.MathUtils.randFloat(...FOOD_SPAWN_INTERVAL_RANGE) * 1000;
      if (foodPickups.length < MAX_FOOD_PICKUPS) {
        const angle = Math.random() * Math.PI * 2;
        const radius = THREE.MathUtils.randFloat(FOOD_SPAWN_MIN_RADIUS, FOOD_SPAWN_MAX_RADIUS);
        const spawnPos = new THREE.Vector3(
          playerModel.position.x + Math.cos(angle) * radius,
          0,
          playerModel.position.z + Math.sin(angle) * radius
        );
        const terrainHeight = getTerrainHeight(spawnPos.x, spawnPos.z);
        if (Number.isFinite(terrainHeight)) {
          spawnFoodPickup(spawnPos);
        }
      }
    }

    if (now - lastHealthSpawnAt >= nextHealthSpawnDelay) {
      lastHealthSpawnAt = now;
      nextHealthSpawnDelay = THREE.MathUtils.randFloat(...HEALTH_SPAWN_INTERVAL_RANGE) * 1000;
      if (healthPickups.length < MAX_HEALTH_PICKUPS) {
        const angle = Math.random() * Math.PI * 2;
        const radius = THREE.MathUtils.randFloat(FOOD_SPAWN_MIN_RADIUS, FOOD_SPAWN_MAX_RADIUS);
        const spawnPos = new THREE.Vector3(
          playerModel.position.x + Math.cos(angle) * radius,
          0,
          playerModel.position.z + Math.sin(angle) * radius
        );
        const terrainHeight = getTerrainHeight(spawnPos.x, spawnPos.z);
        if (Number.isFinite(terrainHeight)) {
          spawnHealthPickup(spawnPos);
        }
      }
    }

    if (now - lastIceGunSpawnAt >= nextIceGunSpawnDelay) {
      lastIceGunSpawnAt = now;
      nextIceGunSpawnDelay = THREE.MathUtils.randFloat(...ICE_GUN_SPAWN_INTERVAL_RANGE) * 1000;
      const isHost = !multiplayer || multiplayer.isHost;
      const hasIceGun = (inventoryState?.iceGun?.count || 0) > 0;
      const canSpawn = isHost && iceGun?.mesh && !iceGun.holder && !hasIceGun && !iceGun.mesh.visible;
      if (canSpawn) {
        const angle = Math.random() * Math.PI * 2;
        const radius = THREE.MathUtils.randFloat(ICE_GUN_SPAWN_MIN_RADIUS, ICE_GUN_SPAWN_MAX_RADIUS);
        const spawnPos = new THREE.Vector3(
          playerModel.position.x + Math.cos(angle) * radius,
          0,
          playerModel.position.z + Math.sin(angle) * radius
        );
        spawnIceGunPickup(spawnPos);
      }
    }

    const pickupTime = performance.now() * 0.002;
    for (let i = ammoPickups.length - 1; i >= 0; i--) {
      const pickup = ammoPickups[i];
      if (!pickup) continue;

      if (pickup.userData.baseY === undefined) {
        pickup.userData.baseY = pickup.position.y;
      }

      pickup.rotation.y += 0.03;
      const phase = pickup.userData.phase ?? 0;
      pickup.position.y = pickup.userData.baseY + Math.sin(pickupTime + phase) * 0.1;

      if (playerModel.position.distanceTo(pickup.position) < 1.2) {
        playerControls.addAmmo(AMMO_PICKUP_AMOUNT);
        scene.remove(pickup);
        pickup.geometry?.dispose();
        pickup.material?.dispose();
        ammoPickups.splice(i, 1);
      }
    }

    for (let i = foodPickups.length - 1; i >= 0; i--) {
      const pickup = foodPickups[i];
      if (!pickup) continue;

      if (pickup.userData.baseY === undefined) {
        pickup.userData.baseY = pickup.position.y;
      }

      pickup.rotation.y += 0.03;
      const phase = pickup.userData.phase ?? 0;
      pickup.position.y = pickup.userData.baseY + Math.sin(pickupTime + phase) * 0.1;

      if (playerModel.position.distanceTo(pickup.position) < PICKUP_RADIUS) {
        applyFoodPickupEffects();
        scene.remove(pickup);
        pickup.geometry?.dispose();
        pickup.material?.dispose();
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

      if (playerModel.position.distanceTo(pickup.position) < PICKUP_RADIUS) {
        applyHealthPickupEffects();
        scene.remove(pickup);
        pickup.geometry?.dispose();
        pickup.material?.dispose();
        healthPickups.splice(i, 1);
      }
    }

    iceGun?.update();
    const localStates = collectLocalControlStates();

    if (multiplayer.isHost) {
      localStates.forEach(({ state, sourceId }, id) => {
        updateAuthoritativeState(id, state, sourceId);
      });

      if (now - lastEntityBroadcast >= ENTITY_BROADCAST_INTERVAL) {
        const payload = serializeAuthoritativeStates();
        if (Object.keys(payload).length > 0) {
          multiplayer.send({ type: 'entityStates', states: payload });
        }
        lastEntityBroadcast = now;
      }
    } else if (localStates.size > 0 && now - lastControlSend >= CONTROL_SEND_INTERVAL) {
      localStates.forEach(({ state, sourceId }, id) => {
        multiplayer.send({ type: 'entityControl', id, state, sourceId });
      });
      lastControlSend = now;
    }

    updateHealthUI();
    if (window.localHealth <= 0 && !playerDead) {
      playerDead = true;
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
      showGameOver();
    }

    const mixerDelta = mixerClock.getDelta();

    Object.values(otherPlayers).forEach(p => {
      p.model.userData.mixer?.update(mixerDelta);
    });

    const isHost = !multiplayer || multiplayer.isHost;
    if (isHost) {
      ensureMonsters();
      const nowMs = Date.now();
      monsters.forEach(monster => {
        if (!monster) return;
        if (monster.isDead) {
          const slotId = monster.id;
          if (!respawnTimers.has(slotId)) {
            cleanupMonster(monster);
            monsters = monsters.filter(entry => entry.id !== slotId);
            window.monsters = monsters;
            const delay = THREE.MathUtils.randFloat(...MONSTER_RESPAWN_DELAY_RANGE_MS);
            const timer = setTimeout(() => {
              respawnTimers.delete(slotId);
              spawnMonsterInSlot(slotId, getRandomMonsterModel());
            }, delay);
            respawnTimers.set(slotId, timer);
          }
          return;
        }
        monster.updateAI(mixerDelta, playerModel, otherPlayers);
      });
    } else {
      monsters.forEach(monster => {
        monster?.update(mixerDelta);
      });
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
            player.model.visible = false;
          }
          if (player?.nameLabel) {
            player.nameLabel.style.display = 'none';
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
      if (!player?.targetPos || !player?.targetQuat) return;
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

    Object.entries(multiplayer.voiceAudios || {}).forEach(([peerId, { audio }]) => {
      const peerModel = otherPlayers[peerId]?.model;
      if (!peerModel || !peerModel.position) return;
      const dist = playerModel.position.distanceTo(peerModel.position);
      const maxDist = 30;
      const rawVolume = 1 - dist / maxDist;
      const volume = Math.max(0, rawVolume * rawVolume);
      audio.volume = volume;
    });

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
      monsters
    });

    updateMeleeAttacks({ playerModel, otherPlayers, monsters, audioManager, multiplayer });

    breakManager.update();

    renderer.render(scene, camera);
  }

  animate();
}

window.addEventListener('DOMContentLoaded', main);

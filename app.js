// app.js
import * as THREE from "three";
import { PlayerCharacter } from "./characters/PlayerCharacter.js";
import { loadMonsterModel } from "./models/monsterModel.js";
import { switchMonsterAnimation } from "./characters/MonsterCharacter.js";
import { createOrcVoice } from "./orcVoice.js";
import { createClouds } from "./worldGeneration.js";
// import { getTerrainHeight } from './water.js';
const getTerrainHeight = () => 0;
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
import { clearCache, getCachedTile, setCachedTile } from './idbCache.js';
import { initSettingsPanel, openSettings, updateUI as updateSettingsUI } from './settingsPanel.js';
import { initMapView, setMapViewEnabled, update as updateMapView, zoomIn, zoomOut } from './mapView.js';

const DEFAULT_CHARACTER_MODEL = "/models/old_man.fbx";

const clock = new THREE.Clock();
const mixerClock = new THREE.Clock();


// --- Rapier demo state ---
let rapierWorld;
const rbToMesh = new Map(); // RigidBody -> THREE.Mesh
let physicsAccumulator = 0;
const FIXED_DT = 1 / 60;
const WORLD_ORIGIN_STORAGE_KEY = 'worldOrigin';
const METERS_PER_DEGREE_LAT = 111_132.92;

function metersPerDegreeLon(latDeg) {
  return 111_412.84 * Math.cos((latDeg * Math.PI) / 180);
}

async function main() {
  document.body.addEventListener('touchstart', () => {}, { once: true });

  let playerName = localStorage.getItem('playerName') || getCookie("playerName");
  if (!playerName) {
    playerName = prompt("Enter your name") || `Player${Math.floor(Math.random() * 1000)}`;
  }
  setCookie("playerName", playerName);
  localStorage.setItem('playerName', playerName);

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
          modelPath: desiredModel
        };
      }

      const player = otherPlayers[remoteId];
      player.name = data.name;
      player.modelPath = desiredModel;
      if (player.nameLabel) {
        player.nameLabel.innerText = data.name;
      }
      // Update remote player position and rotation
      player.model.position.x = data.x;
      player.model.position.z = data.z;

      // Adjust vertical placement against local terrain height
      const terrainY = (Number.isFinite(data.x) && Number.isFinite(data.z))
        ? getTerrainHeight(data.x, data.z)
        : 0;
      const hasAuthoritativeY = Number.isFinite(data.y);
      player.model.position.y = hasAuthoritativeY ? data.y : terrainY;

      player.model.rotation.y = data.rotation;
      
      player.model.up.set(0, 1, 0);
      player.model.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), data.rotation);

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

  let monster = null;
  loadMonsterModel(scene, data => {
    monster = data.model;
    // Expose monster globally for interactions like grabbing
    window.monster = monster;
    monster.userData.hideInMapView = true;
    monster.userData.mixer = data.mixer;
    monster.userData.actions = data.actions;
    monster.userData.currentAction = "Idle";
    monster.userData.direction = new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5).normalize();
    // Tune monster movement speeds so it doesn't feel stuck in slow motion.
    // "wanderSpeed" is used while the monster roams around in friendly mode,
    // while "chaseSpeed" is used when it targets players in enemy mode.
    monster.userData.wanderSpeed = 0.04;
    monster.userData.chaseSpeed = 0.14;
    monster.userData.lastDirectionChange = Date.now();
    monster.userData.mode = "friendly"; // default behavior

    const monsterSpawn = getSpawnPosition({ heightOffset: 0.5 });
    monster.position.set(monsterSpawn.x, monsterSpawn.y, monsterSpawn.z);
    monster.userData.spawnPoint = monsterSpawn;
    if (monster.userData.rb) {
      monster.userData.rb.setTranslation({ x: monsterSpawn.x, y: monsterSpawn.y, z: monsterSpawn.z }, true);
    }

    const orcPhrases = [
      "Uggghh",
      "Ooo Goo",
      "grrreeeoookkk egggh uh uh",
      "errrga ooogah"
    ];
    monster.userData.voice = createOrcVoice(orcPhrases);
    if (rapierWorld) attachMonsterPhysics(monster);
    registerNetworkedEntity('monster', {
      getState: () => {
        if (!monster) return null;
        const pos = monster.position;
        const q = monster.quaternion;
        return {
          position: [pos.x, pos.y, pos.z],
          rotation: [q.x, q.y, q.z, q.w],
          mode: monster.userData.mode,
          action: monster.userData.currentAction,
          health: typeof window.monsterHealth === 'number' ? window.monsterHealth : undefined
        };
      },
      applyState: state => {
        if (!monster || !state) return;
        const [px, py, pz] = state.position || [];
        const [rx, ry, rz, rw] = state.rotation || [];
        if (Number.isFinite(px) && Number.isFinite(py) && Number.isFinite(pz)) {
          monster.position.set(px, py, pz);
          monster.userData.rb?.setTranslation({ x: px, y: py, z: pz }, true);
        }
        if (Number.isFinite(rx) && Number.isFinite(ry) && Number.isFinite(rz) && Number.isFinite(rw)) {
          monster.quaternion.set(rx, ry, rz, rw);
          monster.userData.rb?.setRotation({ x: rx, y: ry, z: rz, w: rw }, true);
        }
        if (typeof state.mode === 'string') {
          monster.userData.mode = state.mode;
        }
        if (typeof state.health === 'number') {
          window.monsterHealth = state.health;
        }
        if (state.action && monster.userData.currentAction !== state.action && monster.userData.actions) {
          switchMonsterAnimation(monster, state.action);
        }
      },
      isLocallyControlled: () => multiplayer?.isHost && !!monster
    });
  });

  // Allow mode switching from console or other scripts
  window.setMonsterMode = mode => {
    if (monster && (mode === "friendly" || mode === "enemy")) {
      monster.userData.mode = mode;
    }
  };

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
  if (iceGun.mesh) {
    iceGun.mesh.userData.hideInMapView = true;
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

  function attachMonsterPhysics(mon) {
    const rbDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(mon.position.x, mon.position.y, mon.position.z)
      .setLinearDamping(0.5)
      .setAngularDamping(0.5);
    const rb = rapierWorld.createRigidBody(rbDesc);
    const colDesc = RAPIER.ColliderDesc.capsule(0.6, 0.3);
    rapierWorld.createCollider(colDesc, rb);
    mon.userData.rb = rb;
    rbToMesh.set(rb, mon);
  }

  if (monster) attachMonsterPhysics(monster);



  let player = new PlayerCharacter(playerName, characterModel);
  let playerModel = player.model;
  playerModel.userData.hideInMapView = true;
  scene.add(playerModel);
  document.body.appendChild(player.nameLabel);
  window.playerModel = playerModel;

  window.localHealth = 100;
  window.monsterHealth = 100;

  const healthFill = document.getElementById('health-fill');
  function updateHealthUI() {
    if (healthFill) {
      healthFill.style.width = `${window.localHealth}%`;
    }
  }
  updateHealthUI();

  let playerDead = false;

  const projectiles = [];
  const ammoPickups = [];
  const AMMO_PICKUP_AMOUNT = 5;

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

  initMapView({ camera, scene, player: playerModel });

  let mapViewEnabled = false;
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
    playerControls.enabled = !mapViewEnabled;
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
  const mapFetchInFlight = new Set();
  let activeTileKey = null;
  let worldOrigin = null;

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
  };

  const resetWorldOrigin = () => {
    worldOrigin = null;
    localStorage.removeItem(WORLD_ORIGIN_STORAGE_KEY);
    tileCache.setOrigin(null);
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
    mapRenderer.updateHighways(combined, bounds);
    buildingsRenderer.updateBuildings(combined, bounds);
  };

  window.clearTileCache = () => {
    tileCache.cache.clear();
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

    const evicted = tileCache.evictTiles(tile);
    if (evicted) {
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
        applyPlayerMeters(playerMeters);
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
    window.localHealth = 100;
    updateHealthUI();
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
    playerControls.enabled = true;
    playerDead = false;
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
    getConnectedPlayers: () => {
      const players = [];
      const playerPos = playerModel?.position;
      const connections = multiplayer?.connections || {};
      Object.keys(connections).forEach((id) => {
        const other = otherPlayers[id];
        const distance = other?.model && playerPos ? playerPos.distanceTo(other.model.position) : null;
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

    iceGun?.update();

    const now = performance.now();
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
      playerControls.enabled = false;
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

    multiplayer.send({
      type: "presence",
      id: multiplayer.getId(),
      name: playerName,
      model: characterModel,
      x: playerModel.position.x,
      y: playerModel.position.y,
      z: playerModel.position.z,
      rotation: playerModel.rotation.y,
      action: playerModel.userData.currentAction
    });

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
      monster,
      delta: frameDelta
    });

    updateMeleeAttacks({ playerModel, otherPlayers, monster, audioManager });

    breakManager.update();

    renderer.render(scene, camera);
  }

  animate();
}

window.addEventListener('DOMContentLoaded', main);

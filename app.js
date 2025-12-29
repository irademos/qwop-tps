// app.js
import * as THREE from "three";
import { PlayerCharacter } from "./characters/PlayerCharacter.js";
import { loadMonsterModel } from "./models/monsterModel.js";
import { switchMonsterAnimation } from "./characters/MonsterCharacter.js";
import { createOrcVoice } from "./orcVoice.js";
import { createClouds, generateIsland, createMoon, MOON_RADIUS } from "./worldGeneration.js";
import { initWaves, spawnOceanWave, updateWaves, getWaveForceAt, getTerrainHeight } from './water.js';
import { Multiplayer } from './peerConnection.js';
import { PlayerControls } from './controls.js';
import { getCookie, setCookie } from './utils.js';
import { spawnProjectile, updateProjectiles } from './projectiles.js';
import { updateMeleeAttacks } from './melee.js';
import { LevelLoader } from './levelLoader.js';
import { BreakManager } from './breakManager.js';
import { initSpeechCommands } from './speechCommands.js';
import { LevelBuilder } from './levelBuilderMode.js';
import { AudioManager } from './audioManager.js';
import { Spaceship } from './spaceship.js';
import { Surfboard } from './surfboard.js';
import { RowBoat } from './rowboat.js';
import { IceGun } from './iceGun.js';
import RAPIER from '@dimforge/rapier3d-compat';
import { applyGlobalGravity } from "./gravity.js";
import { getSpawnPosition } from './spawnUtils.js';

const DEFAULT_CHARACTER_MODEL = "/models/old_man.fbx";

const clock = new THREE.Clock();
const mixerClock = new THREE.Clock();


// --- Rapier demo state ---
let rapierWorld;
const rbToMesh = new Map(); // RigidBody -> THREE.Mesh
let physicsAccumulator = 0;
const FIXED_DT = 1 / 60;

async function main() {
  document.body.addEventListener('touchstart', () => {}, { once: true });

  let playerName = getCookie("playerName");
  if (!playerName) {
    playerName = prompt("Enter your name") || `Player${Math.floor(Math.random() * 1000)}`;
    setCookie("playerName", playerName);
  }

  let characterModel = getCookie("characterModel") || DEFAULT_CHARACTER_MODEL;

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
      const moon = window.moon;
      if (moon) {
        const moonPos = moon.position;
        const playerPos = player.model.position;
        const dist = playerPos.distanceTo(moonPos);
        if (dist < MOON_RADIUS * 2) {
          const up = new THREE.Vector3().subVectors(playerPos, moonPos).normalize();
          player.model.up.copy(up);
          const forward = new THREE.Vector3(Math.sin(data.rotation), 0, Math.cos(data.rotation))
            .projectOnPlane(up)
            .normalize();
          const target = playerPos.clone().add(forward);
          player.model.lookAt(target);
        } else {
          player.model.up.set(0, 1, 0);
          player.model.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), data.rotation);
        }
      } else {
        player.model.up.set(0, 1, 0);
        player.model.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), data.rotation);
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

      if (!multiplayer.connections[remoteId]) {
        multiplayer.connections[remoteId] = {};
      }
      const conn = multiplayer.connections[remoteId];
      if (!conn.listItem) {
        const list = document.getElementById('connected-players-list');
        const item = document.createElement('li');
        item.id = `peer-${remoteId}`;
        conn.listItem = item;
        list.appendChild(item);
      }
      conn.listItem.textContent = `Connected to ${data.name}`;
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

    if (data.type === 'spaceship' || data.type === 'monster') {
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

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87CEEB);

  createClouds(scene);

  let spaceship;
  let surfboard;
  let rowBoat;
  let iceGun;

  // Load additional level data (destructible props, etc.)
  const breakManager = new BreakManager(scene);
  const levelLoader = new LevelLoader(scene, { breakManager });
  // await levelLoader.loadManifest('/areas/demo/demo_area.json');
  // Expose to window for debugging
  window.breakManager = breakManager;

  let monster = null;
  loadMonsterModel(scene, data => {
    monster = data.model;
    // Expose monster globally for interactions like grabbing
    window.monster = monster;
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

  generateIsland(scene);
  initWaves(scene);
  // Prime with an initial distant wave
  spawnOceanWave();
  createMoon(scene, rapierWorld, rbToMesh);

  spaceship = new Spaceship(scene, rapierWorld, rbToMesh);
  await spaceship.load();
  window.spaceship = spaceship;
  registerNetworkedEntity('spaceship', {
    getState: () => {
      if (!spaceship?.body) return null;
      const t = spaceship.body.translation();
      const r = spaceship.body.rotation();
      if (!t || !r) return null;
      return {
        position: [t.x, t.y, t.z],
        rotation: [r.x, r.y, r.z, r.w],
        thrusting: !!spaceship.thrusting
      };
    },
    applyState: state => {
      if (!state || !spaceship) return;
      const [px, py, pz] = state.position || [];
      const [rx, ry, rz, rw] = state.rotation || [];
      if (Number.isFinite(px) && Number.isFinite(py) && Number.isFinite(pz)) {
        spaceship.mesh?.position.set(px, py, pz);
        spaceship.body?.setTranslation({ x: px, y: py, z: pz }, true);
      }
      if (Number.isFinite(rx) && Number.isFinite(ry) && Number.isFinite(rz) && Number.isFinite(rw)) {
        spaceship.mesh?.quaternion.set(rx, ry, rz, rw);
        spaceship.body?.setRotation({ x: rx, y: ry, z: rz, w: rw }, true);
      }
      if (typeof state.thrusting === 'boolean') {
        spaceship.thrusting = state.thrusting;
        if (spaceship.thrusterGroup) {
          spaceship.thrusterGroup.visible = state.thrusting;
        }
      }
    },
    isLocallyControlled: () => spaceship?.occupant === playerControls
  });

  surfboard = new Surfboard(scene);
  await surfboard.load();
  window.surfboard = surfboard;
  registerNetworkedEntity('surfboard', {
    getState: () => {
      if (!surfboard?.mesh) return null;
      const pos = surfboard.mesh.position;
      const q = surfboard.mesh.quaternion;
      return {
        position: [pos.x, pos.y, pos.z],
        rotation: [q.x, q.y, q.z, q.w],
        standing: !!surfboard.standing
      };
    },
    applyState: state => {
      if (!surfboard?.mesh || !state) return;
      const [px, py, pz] = state.position || [];
      const [rx, ry, rz, rw] = state.rotation || [];
      if (Number.isFinite(px) && Number.isFinite(py) && Number.isFinite(pz)) {
        surfboard.mesh.position.set(px, py, pz);
      }
      if (Number.isFinite(rx) && Number.isFinite(ry) && Number.isFinite(rz) && Number.isFinite(rw)) {
        surfboard.mesh.quaternion.set(rx, ry, rz, rw);
      }
      if (typeof state.standing === 'boolean') {
        surfboard.standing = state.standing;
      }
      if (surfboard.mesh) {
        surfboard.mesh.userData.lastNetworkUpdate = performance.now();
      }
    },
    isLocallyControlled: () => surfboard?.occupant === playerControls
  });

  rowBoat = new RowBoat(scene);
  await rowBoat.load();
  window.rowBoat = rowBoat;
  registerNetworkedEntity('rowboat', {
    getState: () => {
      if (!rowBoat?.mesh) return null;
      const pos = rowBoat.mesh.position;
      return {
        position: [pos.x, pos.y, pos.z],
        rotationY: rowBoat.mesh.rotation.y,
        velocity: [rowBoat.velocity.x, rowBoat.velocity.y, rowBoat.velocity.z],
        angularVelocity: rowBoat.angularVelocity,
        oarState: rowBoat.oarState
      };
    },
    applyState: state => {
      if (!rowBoat?.mesh || !state) return;
      const [px, py, pz] = state.position || [];
      if (Number.isFinite(px) && Number.isFinite(py) && Number.isFinite(pz)) {
        rowBoat.mesh.position.set(px, py, pz);
      }
      if (Number.isFinite(state.rotationY)) {
        rowBoat.mesh.rotation.y = state.rotationY;
      }
      const [vx, vy, vz] = state.velocity || [];
      if (Number.isFinite(vx) && Number.isFinite(vy) && Number.isFinite(vz)) {
        rowBoat.velocity.set(vx, vy, vz);
      }
      if (Number.isFinite(state.angularVelocity)) {
        rowBoat.angularVelocity = state.angularVelocity;
      }
      if (state.oarState && rowBoat.oarState !== state.oarState) {
        rowBoat.setOarState(state.oarState, { immediate: true });
      }
    },
    isLocallyControlled: () => rowBoat?.occupant === playerControls
  });

  iceGun = new IceGun(scene);
  await iceGun.load();
  window.iceGun = iceGun;
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
  scene.add(playerModel);
  document.body.appendChild(player.nameLabel);
  window.playerModel = playerModel;
  audioManager.playBGS('Forest Day/Forest Day.ogg');

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

  spawnAmmoPickup(new THREE.Vector3(-4, 0, 4));
  spawnAmmoPickup(new THREE.Vector3(2, 0, -3));

  const levelBuilder = new LevelBuilder({ scene, camera, renderer });
  const builderBtn = document.getElementById('level-builder-button');
  builderBtn?.addEventListener('click', () => {
    levelBuilder.toggle();
    playerControls.enabled = !levelBuilder.active;
  });

  // Wave spawn timing (less frequent) and constant push during pass
  let nextWaveIn = 10 + Math.random() * 6; // seconds
  function scheduleNextWave() {
    nextWaveIn = 10 + Math.random() * 6; // 10–16s between waves
  }

  function applyWaveForces() {
    if (playerControls.body && playerControls.isInWater) {
      const t = playerControls.body.translation();
      const f = getWaveForceAt(t.x, t.z);
      if (f.x !== 0 || f.z !== 0) {
        playerControls.body.applyImpulse({ x: f.x, y: 0, z: f.z }, true);
      }
    }

  }


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

  const settingsBtn = document.getElementById('settings-button');
  const overlay = document.getElementById('settings-overlay');
  const nameInput = document.getElementById('name-input');
  const saveBtn = document.getElementById('save-settings');
  const characterSelect = document.getElementById('character-select');
  const toggleBtn = document.getElementById("toggle-console");
  const consoleDiv = document.getElementById("console-log");

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
  }

  async function populateCharacterSelect() {
    try {
      const characters = ['andy', 'chris', 'gemhorn_monster', 'old_man', 'wizard', 'rainbow_troll', 'alien_bumpy_bump', 'swamp_guy'];
      characters.forEach(name => {
        const option = document.createElement('option');
        option.value = `/models/${name}.fbx`;
        option.textContent = name;
        characterSelect.appendChild(option);
        console.log(option.value);
      });
      characterSelect.value = characterModel;
    } catch (e) {
      console.error('Failed to load character list', e);
    }
  }
  populateCharacterSelect();

  settingsBtn.addEventListener('click', () => {
    nameInput.value = playerName;
    characterSelect.value = characterModel;
    overlay.style.display = 'flex';
  });

  saveBtn.addEventListener('click', () => {
    const trimmedName = nameInput.value.trim();
    if (trimmedName) {
      playerName = trimmedName;
      if (player?.nameLabel) {
        player.nameLabel.innerText = playerName;
      }
    }
    setCookie("playerName", playerName);

    const selectedModel = characterSelect.value;
    if (selectedModel && selectedModel !== characterModel) {
      characterModel = selectedModel;
      swapPlayerCharacter(characterModel);
    }
    setCookie("characterModel", characterModel);

    overlay.style.display = 'none';
  });

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.style.display = 'none';
  });

  toggleBtn.addEventListener("click", () => {
    const visible = consoleDiv.style.display === "block";
    consoleDiv.style.display = visible ? "none" : "block";
    toggleBtn.textContent = visible ? "Show Console" : "Hide Console";
  });

  (function() {
    const originalLog = console.log;
    console.log = function(...args) {
      originalLog(...args);
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
      applyGlobalGravity(rapierWorld, window.moon);
      applyWaveForces();
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



    playerControls.update();

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

    surfboard.update();
    iceGun?.update();
    spaceship?.update();

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
    // Update visible waves and spawn new ones less frequently
    updateWaves(mixerDelta);
    nextWaveIn -= mixerDelta;
    if (nextWaveIn <= 0) {
      spawnOceanWave();
      scheduleNextWave();
    }

    Object.values(otherPlayers).forEach(p => {
      p.model.userData.mixer?.update(mixerDelta);
    });

    rowBoat.update();

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

    levelBuilder.update();

    renderer.render(scene, camera);
  }

  animate();
}

window.addEventListener('DOMContentLoaded', main);

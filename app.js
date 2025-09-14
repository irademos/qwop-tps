// app.js
import * as THREE from "three";
import { PlayerCharacter } from "./characters/PlayerCharacter.js";
import { loadMonsterModel } from "./models/monsterModel.js";
import { createOrcVoice } from "./orcVoice.js";
import { createClouds } from "./worldGeneration.js";
import { Multiplayer } from './peerConnection.js';
import { PlayerControls } from './controls.js';
import { getCookie, setCookie } from './utils.js';
import { spawnProjectile, updateProjectiles } from './projectiles.js';
import { updateMeleeAttacks } from './melee.js';
import { initSpeechCommands } from './speechCommands.js';
import { AudioManager } from './audioManager.js';
import RAPIER from '@dimforge/rapier3d-compat';
import { createPerfOverlay } from "./ui/perfOverlay.js";
import { initControlsHelp } from "./ui/controlsHelp.js";
import { createGroundGrid } from "./helpers/groundGrid.js";
import { createScreenshotButton } from "./ui/screenshotButton.js";
import { createDayNightToggle } from "./ui/dayNightToggle.js";
import { createCompassHUD } from "./ui/compassHUD.js";
import { createPositionHUD } from "./ui/positionHUD.js";
import { initScreenshotHotkey } from "./ui/screenshotHotkey.js";
import { createFullscreenButton } from "./ui/fullscreenButton.js";
import { createConnectionIndicator } from "./ui/connectionIndicator.js";
import { createPauseUI } from "./ui/pauseUI.js";
import { createResolutionToggle } from "./ui/resolutionToggle.js";
import { createHealthHUD } from "./ui/healthHUD.js";
import { createMinimap } from "./ui/minimap.js";
import { createFovControl } from "./ui/fovControl.js";
import { createToastManager } from "./ui/toast.js";

const clock = new THREE.Clock();
const mixerClock = new THREE.Clock();

// --- Rapier demo state ---
let rapierWorld;
const rbToMesh = new Map(); // RigidBody -> THREE.Mesh
let physicsAccumulator = 0;
const FIXED_DT = 1 / 60;

async function main() {
  document.body.addEventListener('touchstart', () => {}, { once: true });
  let paused = false;

  let playerName = getCookie("playerName");
  if (!playerName) {
    playerName = prompt("Enter your name") || `Player${Math.floor(Math.random() * 1000)}`;
    setCookie("playerName", playerName);
  }

  let characterModel = getCookie("characterModel") || "/models/old_man.fbx";

  const multiplayer = new Multiplayer(playerName, handleIncomingData);
  const audioManager = new AudioManager();

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87CEEB);

  createClouds(scene);
  createGroundGrid(THREE, scene);

  let monster = null;
  loadMonsterModel(scene, data => {
    monster = data.model;
    // Expose monster globally for interactions like grabbing
    window.monster = monster;
    monster.userData.mixer = data.mixer;
    monster.userData.actions = data.actions;
    monster.userData.currentAction = "Idle";
    monster.userData.direction = new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5).normalize();
    monster.userData.speed = 0.025;
    monster.userData.lastDirectionChange = Date.now();
    monster.userData.mode = "friendly"; // default behavior

    const orcPhrases = [
      "Uggghh",
      "Ooo Goo",
      "grrreeeoookkk egggh uh uh",
      "errrga ooogah"
    ];
    monster.userData.voice = createOrcVoice(orcPhrases);
    if (rapierWorld) attachMonsterPhysics(monster);
  });

  // Allow mode switching from console or other scripts
  window.setMonsterMode = mode => {
    if (monster && (mode === "friendly" || mode === "enemy")) {
      monster.userData.mode = mode;
    }
  };

  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  const initialPixelRatio = getCookie("renderPerfMode") === "true" ? 1 : Math.min(window.devicePixelRatio || 1, 2);
  renderer.setPixelRatio(initialPixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.getElementById('game-container').appendChild(renderer.domElement);
  createScreenshotButton(renderer);
  initScreenshotHotkey(renderer);
  createFullscreenButton(renderer.domElement);
  createResolutionToggle({ renderer });

  const perf = createPerfOverlay();
  initControlsHelp();

  const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
  // Keep renderer responsive and crisp on resize/rotation
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // In-game FOV control in Settings overlay
  createFovControl({ camera });

  // Toasts (welcome banner)
  const toasts = createToastManager();
  toasts.show(`Welcome, ${playerName}!`);

  const compass = createCompassHUD();
  const posHUD = createPositionHUD();
  const connIndicator = createConnectionIndicator();
  const minimap = createMinimap();

  const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
  scene.add(ambientLight);

  const dirLight = new THREE.DirectionalLight(0xffffff, 1);
  dirLight.position.set(5, 10, 5);
  dirLight.castShadow = true;
  scene.add(dirLight);
  createDayNightToggle({ scene, ambientLight, dirLight });



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

  const player = new PlayerCharacter(playerName, characterModel);
  const playerModel = player.model;
  scene.add(playerModel);
  document.body.appendChild(player.nameLabel);
  window.playerModel = playerModel;
  audioManager.playBGS('Forest Day/Forest Day.ogg');

  window.localHealth = 100;
  window.monsterHealth = 100;

  const healthFill = document.getElementById('health-fill');
  const healthHUD = createHealthHUD();
  function updateHealthUI() {
    if (healthFill) {
      healthFill.style.width = `${window.localHealth}%`;
    }
    if (healthHUD && typeof healthHUD.update === 'function') {
      healthHUD.update(window.localHealth);
    }
  }
  updateHealthUI();

  let playerDead = false;

  const projectiles = [];

  const playerControls = new PlayerControls({
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

  const pauseUI = createPauseUI({
    onToggle: (p) => {
      paused = p;
      if (playerControls) playerControls.enabled = !p;
    }
  });

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
    const newX = (Math.random() * 10) - 5;
    const newZ = (Math.random() * 10) - 5;
    const newY = 0.5;
    playerModel.position.set(newX, newY, newZ);
    playerControls.playerX = newX;
    playerControls.playerY = newY;
    playerControls.playerZ = newZ;
    playerControls.lastPosition.set(newX, newY, newZ);
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

  const otherPlayers = {};
  // Expose remote players map for global access (e.g., controls)
  window.otherPlayers = otherPlayers;

  // --- Latency (Ping) tracking shown in Settings overlay ---
  const pingDisplay = document.getElementById('ping-display');
  const peerPings = {};
  const pendingPings = new Map();
  function updatePingUIValue() {
    if (!pingDisplay) return;
    const vals = Object.values(peerPings);
    const avg = vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
    pingDisplay.textContent = avg ?? '-';
    if (connIndicator && typeof connIndicator.setStatus === 'function') {
      const peers = Object.keys(multiplayer.connections || {}).length;
      connIndicator.setStatus({ peers, avgPing: avg });
    }
  }
  function pingPeers() {
    const myId = multiplayer.getId();
    Object.keys(otherPlayers).forEach((peerId) => {
      const nonce = Math.random().toString(36).slice(2);
      pendingPings.set(peerId, { nonce, start: performance.now() });
      multiplayer.send({ type: 'ping', from: myId, to: peerId, nonce, ts: Date.now() });
    });
  }
  setInterval(pingPeers, 2000);

  function handleIncomingData(peerId, data) {
    console.log('📡 Incoming data:', data);
    // --- Ping/Pong handling for latency measurement ---
    if (data && data.type === 'ping' && data.to === multiplayer.getId()) {
      multiplayer.send({ type: 'pong', from: multiplayer.getId(), to: data.from, nonce: data.nonce, ts: data.ts });
    }
    if (data && data.type === 'pong' && data.to === multiplayer.getId()) {
      const pending = pendingPings.get(peerId);
      if (pending && pending.nonce === data.nonce) {
        const rtt = Math.round(performance.now() - pending.start);
        peerPings[peerId] = rtt;
        pendingPings.delete(peerId);
        updatePingUIValue();
      }
    }
    if (data.type === "presence") {
      if (!otherPlayers[data.id]) {
        const other = new PlayerCharacter(data.name);
        scene.add(other.model);
        document.body.appendChild(other.nameLabel);
        otherPlayers[data.id] = { model: other.model, nameLabel: other.nameLabel, name: data.name, health: 100 };
      }

      const player = otherPlayers[data.id];
      player.name = data.name;
      // Update remote player position and rotation
      player.model.position.x = data.x;
      player.model.position.z = data.z;

      // Adjust vertical placement against local terrain height
      const terrainY = 0;
      const targetY = Math.max(data.y ?? terrainY, terrainY);
      player.model.position.y = targetY;
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

      if (!multiplayer.connections[peerId]) {
        multiplayer.connections[peerId] = {};
      }
      const conn = multiplayer.connections[peerId];
      if (!conn.listItem) {
        const list = document.getElementById('connected-players-list');
        const item = document.createElement('li');
        item.id = `peer-${peerId}`;
        conn.listItem = item;
        list.appendChild(item);
      }
      conn.listItem.textContent = `Connected to ${data.name}`;
      if (connIndicator && typeof connIndicator.setStatus === 'function') {
        const peers = Object.keys(multiplayer.connections || {}).length;
        const vals = Object.values(peerPings);
        const avg = vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
        connIndicator.setStatus({ peers, avgPing: avg });
      }
    }

    if (data.type === 'projectile') {
      const position = new THREE.Vector3(...data.position);
      const direction = new THREE.Vector3(...data.direction);
      spawnProjectile(scene, projectiles, position, direction);

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
    }

    if (data.type === "monster" && monster) {
      const target = { x: data.x, y: data.y, z: data.z };
      monster.userData.rb?.setTranslation(target, true);
    }

    if (data.type === 'grab') {
      if (data.target === multiplayer.getId()) {
        playerControls.setGrabbed(data.active, data.from);
      } else {
        const targetPlayer = otherPlayers[data.target];
        if (targetPlayer) {
          targetPlayer.grabbed = data.active;
        }
      }
    }

    if (data.type === 'grabMove') {
      const pos = new THREE.Vector3(...data.position);
      if (data.target === multiplayer.getId()) {
        playerControls.updateGrabbedPosition(data.position);
      } else {
        const targetPlayer = otherPlayers[data.target];
        if (targetPlayer) {
          targetPlayer.model.position.copy(pos);
        }
      }
    }
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

  async function populateCharacterSelect() {
    try {
      const characters = ['andy', 'chris', 'gemhorn_monster', 'old_man'];
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
    playerName = nameInput.value.trim() || playerName;
    setCookie("playerName", playerName);
    characterModel = characterSelect.value;
    setCookie("characterModel", characterModel);
    overlay.style.display = 'none';
    window.location.reload();
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
    const _noop = perf && typeof perf.onFrame === 'function' ? perf.onFrame() : undefined;

    if (paused) {
      renderer.render(scene, camera);
      return;
    }

    // --- RAPIER FIXED-STEP & SYNC ---
    // Accumulate variable rAF time into fixed physics steps
    physicsAccumulator += clock.getDelta();
    while (physicsAccumulator >= FIXED_DT) {
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
        const terrainY = 0;
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

    const delta = mixerClock.getDelta();

    Object.values(otherPlayers).forEach(p => {
      p.model.userData.mixer?.update(delta);
    });

    multiplayer.send({
      type: "presence",
      id: multiplayer.getId(),
      name: playerName,
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
      clock
    });

    updateMeleeAttacks({ playerModel, otherPlayers, monster, audioManager });

    const viewDir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    const headingRad = Math.atan2(viewDir.x, viewDir.z);
    const headingDeg = (THREE.MathUtils.radToDeg(headingRad) + 360) % 360;
    if (compass && typeof compass.setHeading === 'function') {
      compass.setHeading(headingDeg);
    }
    if (minimap && typeof minimap.update === 'function') {
      minimap.update({ playerModel, otherPlayers, monster, headingDeg });
    }

    if (posHUD && typeof posHUD.update === 'function') {
      posHUD.update(playerModel.position, headingDeg);
    }
    renderer.render(scene, camera);
  }

  animate();
}

window.addEventListener('DOMContentLoaded', main);

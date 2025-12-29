// app.js
import * as THREE from "three";
import { PlayerCharacter } from "./characters/PlayerCharacter.js";
import { loadMonsterModel } from "./models/monsterModel.js";
import { createOrcVoice } from "./orcVoice.js";
import { Multiplayer } from './peerConnection.js';
import { PlayerControls } from './controls.js';
import { getCookie, setCookie } from './utils.js';
import { spawnProjectile, updateProjectiles } from './projectiles.js';
import { updateMeleeAttacks } from './melee.js';
import { AudioManager } from './audioManager.js';
import RAPIER from '@dimforge/rapier3d-compat';
import { createHealthHUD } from "./ui/healthHUD.js";

const clock = new THREE.Clock();
const mixerClock = new THREE.Clock();

let rapierWorld;
const rbToMesh = new Map();
let physicsAccumulator = 0;
const FIXED_DT = 1 / 60;

async function main() {
  document.body.addEventListener('touchstart', () => {}, { once: true });

  let playerName = getCookie("playerName");
  if (!playerName) {
    playerName = prompt("Enter your name") || `Player${Math.floor(Math.random() * 1000)}`;
    setCookie("playerName", playerName);
  }

  let characterModel = getCookie("characterModel") || "/models/old_man.fbx";

  let multiplayer;
  const audioManager = new AudioManager();

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87CEEB);

  const groundGeo = new THREE.PlaneGeometry(200, 200);
  const groundMat = new THREE.MeshStandardMaterial({ color: 0x4e6b3a });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  ground.userData.isTerrain = true;
  scene.add(ground);

  const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
  scene.add(ambientLight);

  const dirLight = new THREE.DirectionalLight(0xffffff, 0.9);
  dirLight.position.set(5, 10, 5);
  scene.add(dirLight);

  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.getElementById('game-container').appendChild(renderer.domElement);

  const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  await RAPIER.init();
  rapierWorld = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  window.rapierWorld = rapierWorld;
  window.rbToMesh = rbToMesh;

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

  let monster = null;
  loadMonsterModel(scene, data => {
    monster = data.model;
    window.monster = monster;
    monster.userData.mixer = data.mixer;
    monster.userData.actions = data.actions;
    monster.userData.currentAction = "Idle";
    monster.userData.direction = new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5).normalize();
    monster.userData.speed = 0.025;
    monster.userData.lastDirectionChange = Date.now();
    monster.userData.mode = "friendly";

    const orcPhrases = [
      "Uggghh",
      "Ooo Goo",
      "grrreeeoookkk egggh uh uh",
      "errrga ooogah"
    ];
    monster.userData.voice = createOrcVoice(orcPhrases);
    if (rapierWorld) attachMonsterPhysics(monster);
  });

  const player = new PlayerCharacter(playerName, characterModel);
  const playerModel = player.model;
  scene.add(playerModel);
  document.body.appendChild(player.nameLabel);

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
    multiplayer: null,
    spawnProjectile,
    projectiles,
    audioManager
  });
  window.playerControls = playerControls;

  const otherPlayers = {};
  window.otherPlayers = otherPlayers;

  function handleIncomingData(peerId, data) {
    if (!data) return;

    if (data.type === "presence") {
      if (!otherPlayers[data.id]) {
        const other = new PlayerCharacter(data.name);
        scene.add(other.model);
        document.body.appendChild(other.nameLabel);
        otherPlayers[data.id] = { model: other.model, nameLabel: other.nameLabel, name: data.name, health: 100 };
      }

      const player = otherPlayers[data.id];
      player.name = data.name;
      player.model.position.x = data.x;
      player.model.position.z = data.z;
      const terrainY = 0;
      const targetY = Math.max(data.y ?? terrainY, terrainY);
      player.model.position.y = targetY;
      player.model.rotation.y = data.rotation;
      player.model.up.set(0, 1, 0);
      player.model.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), data.rotation);

      const actions = player.model.userData.actions;
      const current = player.model.userData.currentAction;
      if (actions && data.action && current !== data.action) {
        actions[current]?.fadeOut(0.2);
        actions[data.action]?.reset().fadeIn(0.2).play();
        player.model.userData.currentAction = data.action;
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
      if (data.target === multiplayer?.getId()) {
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
      if (data.target === multiplayer?.getId()) {
        playerControls.updateGrabbedPosition(data.position);
      } else {
        const targetPlayer = otherPlayers[data.target];
        if (targetPlayer) {
          targetPlayer.model.position.copy(pos);
        }
      }
    }
  }

  multiplayer = new Multiplayer(playerName, handleIncomingData);
  playerControls.multiplayer = multiplayer;

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

  function updateNameLabel(model, nameLabel) {
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
  }

  function animate() {
    requestAnimationFrame(animate);

    physicsAccumulator += clock.getDelta();
    while (physicsAccumulator >= FIXED_DT) {
      rapierWorld.step();
      physicsAccumulator -= FIXED_DT;
    }

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
      setTimeout(respawnPlayer, 1500);
    }

    const delta = mixerClock.getDelta();
    playerModel.userData.mixer?.update(delta);
    monster?.userData?.mixer?.update(delta);
    Object.values(otherPlayers).forEach(p => {
      p.model.userData.mixer?.update(delta);
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

    updateNameLabel(playerModel, player.nameLabel);
    Object.values(otherPlayers).forEach(({ model, nameLabel }) => {
      updateNameLabel(model, nameLabel);
    });

    renderer.render(scene, camera);
  }

  animate();
}

window.addEventListener('DOMContentLoaded', main);

/**
 * Sword Showdown hidden chests: one treasure chest tucked off each stage's path. Swiping
 * it with the sword opens it (a hop, a burst of gold glints, then it's gone) and the game
 * hands out a random prize — the same draw as the village's mystery chest.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { stylizeObject } from '../environment/artStyle.js';

const CHEST_MODEL_URL = '/assets/props/treasure_chest.glb';
const CHEST_WIDTH = 0.75;        // m — the model is fitted to this width
const HIT_RADIUS = 0.6;          // m from the chest's middle — a blade point this close hits it
const HIT_CENTER_Y = 0.3;        // m above the ground
const OPEN_DURATION = 0.7;       // s — hop + shrink away
const GLINT_EVERY = 2.6;         // s between the little glints that give it away
const BURST_COUNT = 14;

let _gltfPromise = null;
const loadChestModel = () => {
  if (!_gltfPromise) {
    _gltfPromise = new GLTFLoader().loadAsync(CHEST_MODEL_URL)
      .then((gltf) => { stylizeObject(gltf.scene); return gltf; });
    _gltfPromise.catch(() => { _gltfPromise = null; });
  }
  return _gltfPromise;
};

// Stand-in until (or if) the GLB isn't there: a wooden box with a gold band
function buildFallbackChest() {
  const g = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: 0x7a4a20, roughness: 0.85 });
  const gold = new THREE.MeshStandardMaterial({ color: 0xd9a632, roughness: 0.4, metalness: 0.5 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.42, 0.5), wood);
  body.position.y = 0.21;
  const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.75, 16, 1, false, 0, Math.PI), wood);
  lid.rotation.z = Math.PI / 2;
  lid.position.y = 0.42;
  const band = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.44, 0.52), gold);
  band.position.y = 0.22;
  g.add(body, lid, band);
  return g;
}

let _glintTexture = null;
function getGlintTexture() {
  if (_glintTexture) return _glintTexture;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,250,210,1)');
  grad.addColorStop(0.25, 'rgba(255,215,90,0.85)');
  grad.addColorStop(1, 'rgba(255,190,40,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  _glintTexture = new THREE.CanvasTexture(c);
  _glintTexture.colorSpace = THREE.SRGBColorSpace;
  return _glintTexture;
}
const makeGlint = () => new THREE.Sprite(new THREE.SpriteMaterial({
  map: getGlintTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
}));

const _center = new THREE.Vector3();
const _box = new THREE.Box3();
const _size = new THREE.Vector3();

export function createStageChests({ scene, getGroundY }) {
  const chests = [];   // { group, model, glint, phase, opening, t, burst[] }

  const fitModel = (chest, source) => {
    const model = source.clone(true);
    _box.setFromObject(model).getSize(_size);
    const s = CHEST_WIDTH / Math.max(0.001, _size.x, _size.z);
    model.scale.multiplyScalar(s);
    _box.setFromObject(model).getCenter(_center);
    model.position.x -= _center.x;
    model.position.z -= _center.z;
    model.position.y -= _box.min.y;
    model.userData.baseY = model.position.y;
    model.userData.fitScale = model.scale.clone();
    model.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    if (chest.model) chest.group.remove(chest.model);
    chest.model = model;
    chest.group.add(model);
  };

  const spawn = (position, yaw = 0) => {
    const group = new THREE.Group();
    group.name = 'StageChest';
    const groundY = getGroundY(position.x, position.z);
    group.position.set(position.x, Number.isFinite(groundY) ? groundY : position.y, position.z);
    group.rotation.y = yaw;
    const glint = makeGlint();
    glint.position.set(0.22, 0.5, 0.18);
    glint.scale.setScalar(0.001);
    group.add(glint);
    const chest = { group, model: null, glint, phase: Math.random() * GLINT_EVERY, opening: false, t: 0, burst: [] };
    fitModel(chest, buildFallbackChest());
    scene.add(group);
    chests.push(chest);
    loadChestModel()
      .then((gltf) => { if (chests.includes(chest) && !chest.opening) fitModel(chest, gltf.scene); })
      .catch(() => {});
    return chest;
  };

  const remove = (chest) => {
    chest.group.parent?.remove(chest.group);
    chest.glint.material.dispose();
    chest.burst.forEach((b) => b.sprite.material.dispose());
    const i = chests.indexOf(chest);
    if (i >= 0) chests.splice(i, 1);
  };

  const clear = () => { while (chests.length) remove(chests[0]); };

  const open = (chest) => {
    chest.opening = true;
    chest.t = 0;
    chest.glint.visible = false;
    for (let i = 0; i < BURST_COUNT; i++) {
      const sprite = makeGlint();
      sprite.position.set(0, 0.45, 0);
      sprite.scale.setScalar(0.18);
      const a = Math.random() * Math.PI * 2;
      const vel = new THREE.Vector3(Math.cos(a) * (0.8 + Math.random()), 2 + Math.random() * 2, Math.sin(a) * (0.8 + Math.random()));
      chest.group.add(sprite);
      chest.burst.push({ sprite, vel });
    }
  };

  /**
   * A sword swing (`swinging` = moving fast enough to count) touching an unopened chest with
   * any of `bladePoints` (world) opens it. Returns how many chests it opened.
   */
  const trySwordHit = (bladePoints, swinging) => {
    if (!swinging || !chests.length) return 0;
    let opened = 0;
    for (const chest of chests) {
      if (chest.opening) continue;
      _center.copy(chest.group.position);
      _center.y += HIT_CENTER_Y;
      if (bladePoints.some((p) => p.distanceTo(_center) < HIT_RADIUS)) {
        open(chest);
        opened += 1;
      }
    }
    return opened;
  };

  const update = (dt) => {
    for (let i = chests.length - 1; i >= 0; i--) {
      const chest = chests[i];
      if (!chest.opening) {
        // A short twinkle now and then — enough to spot it if you look
        chest.phase = (chest.phase + dt) % GLINT_EVERY;
        const k = chest.phase < 0.35 ? Math.sin((chest.phase / 0.35) * Math.PI) : 0;
        chest.glint.scale.setScalar(0.001 + k * 0.32);
        continue;
      }
      chest.t += dt;
      const u = Math.min(1, chest.t / OPEN_DURATION);
      if (chest.model) {
        const { baseY, fitScale } = chest.model.userData;
        chest.model.position.y = baseY + Math.sin(Math.min(1, u * 1.6) * Math.PI) * 0.35;
        chest.model.rotation.y += dt * 6;
        const s = u < 0.55 ? 1 : 1 - (u - 0.55) / 0.45;
        chest.model.scale.copy(fitScale).multiplyScalar(Math.max(0.001, s));
      }
      for (const b of chest.burst) {
        b.vel.y -= 6 * dt;
        b.sprite.position.addScaledVector(b.vel, dt);
        b.sprite.material.opacity = 1 - u;
      }
      if (u >= 1) remove(chest);
    }
  };

  return { spawn, clear, update, trySwordHit, get count() { return chests.length; } };
}

import * as THREE from "three";

const DEFAULT_ZOOM_HEIGHT = 90;
const MIN_ZOOM_HEIGHT = 30;
const MAX_ZOOM_HEIGHT = 260;
const ZOOM_STEP = 15;
const TRANSITION_MS = 400;
const DOT_SIZE = 0.06;
const DOT_Y_OFFSET = 2;
const ICON_SIZE = 0.075;
const PLAYER_LABEL_SIZE = 0.2;

const state = {
  camera: null,
  scene: null,
  player: null,
  enabled: false,
  mapZoomHeight: DEFAULT_ZOOM_HEIGHT,
  targetZoomHeight: DEFAULT_ZOOM_HEIGHT,
  playerIcon: null,
  previousCamera: null,
  hiddenObjects: [],
  transition: null,
  mapUp: new THREE.Vector3(0,0,-1),
  tempObject: new THREE.Object3D(),
  tempPos: new THREE.Vector3(),
  tempQuat: new THREE.Quaternion(),
  tempUp: new THREE.Vector3(),
  monsterDots: [],
  friendlyDots: [],
  monsterDotMaterial: null,
  friendlyDotMaterial: null,
  weaponIconMaterial: null,
  itemIconMaterial: null,
  chestIconMaterial: null,
  merchantIconMaterial: null,
  remotePlayerIconMaterial: null,
  homeIcon: null,
  homeRadiusLine: null,
  homeRadiusValue: null,
  weaponIcons: [],
  itemIcons: [],
  chestIcons: [],
  merchantIcons: [],
  remotePlayerMarkers: new Map()
};

function createPlayerIconTexture() {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = "rgba(0, 0, 0, 0)";
  ctx.fillRect(0, 0, size, size);

  const center = size / 2;
  const radius = size * 0.24;
  ctx.beginPath();
  ctx.arc(center, center, radius, 0, Math.PI * 2);
  ctx.fillStyle = "#4fd1ff";
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = "#0b4b6f";
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(center, center - radius - 8);
  ctx.lineTo(center + 8, center - radius + 6);
  ctx.lineTo(center - 8, center - radius + 6);
  ctx.closePath();
  ctx.fillStyle = "#0b4b6f";
  ctx.fill();

  return canvas;
}

function createDotTexture(color) {
  const size = 32;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const center = size / 2;
  const radius = size * 0.35;
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(center, center, radius, 0, Math.PI * 2);
  ctx.fill();
  return canvas;
}

function createIconTexture(kind) {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.clearRect(0, 0, size, size);
  const center = size / 2;

  if (kind === "weapon") {
    ctx.fillStyle = "#fde68a";
    ctx.strokeStyle = "#92400e";
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(center, size * 0.16);
    ctx.lineTo(size * 0.78, center);
    ctx.lineTo(center, size * 0.84);
    ctx.lineTo(size * 0.22, center);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    return canvas;
  }

  if (kind === "item") {
    ctx.fillStyle = "#a7f3d0";
    ctx.strokeStyle = "#065f46";
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.rect(size * 0.2, size * 0.2, size * 0.6, size * 0.6);
    ctx.fill();
    ctx.stroke();
    return canvas;
  }

  if (kind === "chest") {
    ctx.fillStyle = "#f59e0b";
    ctx.strokeStyle = "#78350f";
    ctx.lineWidth = 5;
    ctx.fillRect(size * 0.15, size * 0.42, size * 0.7, size * 0.35);
    ctx.strokeRect(size * 0.15, size * 0.42, size * 0.7, size * 0.35);
    ctx.beginPath();
    ctx.moveTo(size * 0.15, size * 0.42);
    ctx.quadraticCurveTo(center, size * 0.16, size * 0.85, size * 0.42);
    ctx.stroke();
    ctx.fillStyle = "#78350f";
    ctx.fillRect(center - 4, size * 0.5, 8, 10);
    return canvas;
  }

  if (kind === "merchant") {
    ctx.fillStyle = "#60a5fa";
    ctx.beginPath();
    ctx.arc(center, center, size * 0.32, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#1e3a8a";
    ctx.font = "bold 34px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("M", center, center + 1);
    return canvas;
  }

  return createDotTexture("#93c5fd");
}

function createNameTexture(name) {
  const text = (name || "Player").slice(0, 24);
  const fontSize = 28;
  const padX = 12;
  const padY = 8;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.font = `600 ${fontSize}px sans-serif`;
  const width = Math.ceil(ctx.measureText(text).width + padX * 2);
  const height = fontSize + padY * 2;
  canvas.width = Math.max(64, width);
  canvas.height = Math.max(32, height);
  ctx.font = `600 ${fontSize}px sans-serif`;
  ctx.fillStyle = "rgba(0,0,0,0.6)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#e0f2fe";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, canvas.width / 2, canvas.height / 2 + 1);
  return canvas;
}

function createHomeIconTexture() {
  const size = 96;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = "rgba(0, 0, 0, 0)";
  ctx.fillRect(0, 0, size, size);

  ctx.fillStyle = "#f97316";
  ctx.strokeStyle = "#7c2d12";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(size * 0.2, size * 0.45);
  ctx.lineTo(size * 0.5, size * 0.2);
  ctx.lineTo(size * 0.8, size * 0.45);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "#fef3c7";
  ctx.beginPath();
  ctx.rect(size * 0.28, size * 0.45, size * 0.44, size * 0.35);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "#7c2d12";
  ctx.beginPath();
  ctx.rect(size * 0.47, size * 0.6, size * 0.12, size * 0.2);
  ctx.fill();

  return canvas;
}

function getDotMaterial(kind) {
  if (kind === "monster") {
    if (state.monsterDotMaterial) return state.monsterDotMaterial;
    const canvas = createDotTexture("#ef4444");
    const texture = canvas ? new THREE.CanvasTexture(canvas) : null;
    state.monsterDotMaterial = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      sizeAttenuation: false
    });
    return state.monsterDotMaterial;
  }
  if (state.friendlyDotMaterial) return state.friendlyDotMaterial;
  const canvas = createDotTexture("#22c55e");
  const texture = canvas ? new THREE.CanvasTexture(canvas) : null;
  state.friendlyDotMaterial = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    sizeAttenuation: false
  });
  return state.friendlyDotMaterial;
}

function getIconMaterial(kind) {
  const key = `${kind}IconMaterial`;
  if (state[key]) return state[key];
  const canvas = createIconTexture(kind);
  const texture = canvas ? new THREE.CanvasTexture(canvas) : null;
  state[key] = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    sizeAttenuation: false
  });
  return state[key];
}

function createDotSprite(kind) {
  const material = getDotMaterial(kind);
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(DOT_SIZE, DOT_SIZE, 1);
  sprite.visible = false;
  sprite.renderOrder = 998;
  return sprite;
}

function createIconSprite(kind) {
  const material = getIconMaterial(kind);
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(ICON_SIZE, ICON_SIZE, 1);
  sprite.visible = false;
  sprite.renderOrder = 998;
  return sprite;
}

function ensureHomeIcon() {
  if (!state.scene || state.homeIcon) return;
  const canvas = createHomeIconTexture();
  const texture = canvas ? new THREE.CanvasTexture(canvas) : null;
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    sizeAttenuation: false
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(0.05, 0.05, 0.05);
  sprite.visible = false;
  sprite.renderOrder = 999;
  state.homeIcon = sprite;
  state.scene.add(sprite);
}

function createHomeRadiusLine(radius) {
  const curve = new THREE.EllipseCurve(0, 0, radius, radius, 0, Math.PI * 2, false, 0);
  const points = curve.getPoints(64);
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const material = new THREE.LineBasicMaterial({
    color: 0xef4444,
    transparent: true,
    opacity: 0.9
  });
  const line = new THREE.LineLoop(geometry, material);
  line.rotation.x = Math.PI / 2;
  line.visible = false;
  line.renderOrder = 997;
  return line;
}

function ensureHomeRadiusLine(radius) {
  if (!state.scene || !Number.isFinite(radius)) return;
  if (state.homeRadiusLine && state.homeRadiusValue === radius) return;
  if (state.homeRadiusLine) {
    state.scene.remove(state.homeRadiusLine);
    state.homeRadiusLine.geometry.dispose();
    state.homeRadiusLine.material.dispose();
  }
  state.homeRadiusLine = createHomeRadiusLine(radius);
  state.homeRadiusValue = radius;
  state.scene.add(state.homeRadiusLine);
}

function ensurePlayerIcon() {
  if (state.playerIcon) return;
  const canvas = createPlayerIconTexture();
  const texture = canvas ? new THREE.CanvasTexture(canvas) : null;
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    sizeAttenuation: false
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(0.02, 0.02, 1);
  sprite.visible = false;
  sprite.renderOrder = 999;
  state.playerIcon = sprite;
  state.scene?.add(sprite);
}

function ensureDotPool(pool, count, kind) {
  if (!state.scene) return;
  while (pool.length < count) {
    const sprite = createDotSprite(kind);
    pool.push(sprite);
    state.scene.add(sprite);
  }
}

function ensureIconPool(pool, count, kind) {
  if (!state.scene) return;
  while (pool.length < count) {
    const sprite = createIconSprite(kind);
    pool.push(sprite);
    state.scene.add(sprite);
  }
}

function setDotVisibility(pool, visible) {
  pool.forEach((sprite) => {
    sprite.visible = visible;
  });
}


function forEachEntityPair(first, second, iteratee) {
  if (Array.isArray(first)) {
    for (const entry of first) {
      iteratee(entry);
    }
  }
  if (Array.isArray(second)) {
    for (const entry of second) {
      iteratee(entry);
    }
  }
}

function updateDotPool(entities, pool, kind) {
  let activeCount = 0;
  for (const entity of (entities ?? [])) {
    if (!entity?.model || entity.isDead) continue;
    activeCount += 1;
  }
  ensureDotPool(pool, activeCount, kind);
  let nextIndex = 0;
  for (const entity of (entities ?? [])) {
    if (!entity?.model || entity.isDead) continue;
    const sprite = pool[nextIndex];
    nextIndex += 1;
    sprite.position.set(
      entity.model.position.x,
      entity.model.position.y + DOT_Y_OFFSET,
      entity.model.position.z
    );
    sprite.visible = state.enabled;
  }
  for (let i = nextIndex; i < pool.length; i += 1) {
    pool[i].visible = false;
  }
}

function updateIconPool(entities, pool, kind, offsetY = DOT_Y_OFFSET) {
  let activeCount = 0;
  for (const entity of (entities ?? [])) {
    if (!entity) continue;
    const pos = entity.position ?? entity.mesh?.position ?? entity.model?.position;
    if (!pos) continue;
    activeCount += 1;
  }
  ensureIconPool(pool, activeCount, kind);
  let nextIndex = 0;
  for (const entity of (entities ?? [])) {
    if (!entity) continue;
    const pos = entity.position ?? entity.mesh?.position ?? entity.model?.position;
    if (!pos) continue;
    const sprite = pool[nextIndex];
    nextIndex += 1;
    sprite.position.set(pos.x, pos.y + offsetY, pos.z);
    sprite.visible = state.enabled;
  }
  for (let i = nextIndex; i < pool.length; i += 1) {
    pool[i].visible = false;
  }
}

function updateDotPoolFromLists(first, second, pool, kind) {
  let activeCount = 0;
  forEachEntityPair(first, second, (entity) => {
    if (!entity?.model || entity.isDead) return;
    activeCount += 1;
  });
  ensureDotPool(pool, activeCount, kind);
  let nextIndex = 0;
  forEachEntityPair(first, second, (entity) => {
    if (!entity?.model || entity.isDead) return;
    const sprite = pool[nextIndex];
    nextIndex += 1;
    sprite.position.set(
      entity.model.position.x,
      entity.model.position.y + DOT_Y_OFFSET,
      entity.model.position.z
    );
    sprite.visible = state.enabled;
  });
  for (let i = nextIndex; i < pool.length; i += 1) {
    pool[i].visible = false;
  }
}

function updateIconPoolFromLists(first, second, pool, kind, offsetY = DOT_Y_OFFSET) {
  let activeCount = 0;
  forEachEntityPair(first, second, (entity) => {
    if (!entity) return;
    const pos = entity.position ?? entity.mesh?.position ?? entity.model?.position;
    if (!pos) return;
    activeCount += 1;
  });
  ensureIconPool(pool, activeCount, kind);
  let nextIndex = 0;
  forEachEntityPair(first, second, (entity) => {
    if (!entity) return;
    const pos = entity.position ?? entity.mesh?.position ?? entity.model?.position;
    if (!pos) return;
    const sprite = pool[nextIndex];
    nextIndex += 1;
    sprite.position.set(pos.x, pos.y + offsetY, pos.z);
    sprite.visible = state.enabled;
  });
  for (let i = nextIndex; i < pool.length; i += 1) {
    pool[i].visible = false;
  }
}

function updateRemotePlayerMarkers(otherPlayers) {
  if (!state.scene) return;
  const entries = Object.entries(otherPlayers ?? {}).filter(([, player]) => player?.model?.position);
  const activeIds = new Set(entries.map(([id]) => id));

  state.remotePlayerMarkers.forEach((marker, id) => {
    if (activeIds.has(id)) return;
    state.scene.remove(marker.dot);
    state.scene.remove(marker.label);
    marker.label.material?.map?.dispose?.();
    marker.label.material?.dispose?.();
    state.remotePlayerMarkers.delete(id);
  });

  entries.forEach(([id, player]) => {
    let marker = state.remotePlayerMarkers.get(id);
    if (!marker) {
      const dot = createIconSprite("remotePlayer");
      const labelTexture = new THREE.CanvasTexture(createNameTexture(player.name));
      const label = new THREE.Sprite(new THREE.SpriteMaterial({
        map: labelTexture,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        sizeAttenuation: false
      }));
      label.scale.set(PLAYER_LABEL_SIZE, PLAYER_LABEL_SIZE * 0.35, 1);
      label.renderOrder = 999;
      marker = { dot, label, name: player.name || "" };
      state.remotePlayerMarkers.set(id, marker);
      state.scene.add(dot);
      state.scene.add(label);
    } else if (marker.name !== player.name) {
      marker.name = player.name || "";
      marker.label.material?.map?.dispose?.();
      marker.label.material.map = new THREE.CanvasTexture(createNameTexture(player.name));
      marker.label.material.needsUpdate = true;
    }
    const pos = player.model.position;
    marker.dot.position.set(pos.x, pos.y + DOT_Y_OFFSET, pos.z);
    marker.label.position.set(pos.x, pos.y + DOT_Y_OFFSET + 1.3, pos.z);
    marker.dot.visible = state.enabled;
    marker.label.visible = state.enabled;
  });
}

function updateHomeIndicators(homePosition, homeEnterDistance) {
  if (!state.scene) return;
  if (!homePosition) {
    if (state.homeIcon) state.homeIcon.visible = false;
    if (state.homeRadiusLine) state.homeRadiusLine.visible = false;
    return;
  }
  const hasEnterDistance = Number.isFinite(homeEnterDistance);
  ensureHomeIcon();
  if (hasEnterDistance) {
    ensureHomeRadiusLine(homeEnterDistance);
  } else if (state.homeRadiusLine) {
    state.homeRadiusLine.visible = false;
  }
  if (state.homeIcon) {
    state.homeIcon.position.set(homePosition.x, homePosition.y + DOT_Y_OFFSET, homePosition.z);
    state.homeIcon.visible = state.enabled;
  }
  if (state.homeRadiusLine && hasEnterDistance) {
    state.homeRadiusLine.position.set(homePosition.x, homePosition.y + 0.05, homePosition.z);
    state.homeRadiusLine.visible = !state.enabled;
  }
}

function getMapPose() {
  if (!state.player) return null;

  const x = state.player.position.x;
  const z = state.player.position.z;
  const y = state.player.position.y + state.mapZoomHeight;

  state.tempPos.set(x, y, z);

  // Look straight down
  state.tempObject.position.copy(state.tempPos);
  // state.tempObject.up.set(0, 0, -1);      // choose (0,0,1) or (0,0,-1) for north-up
  state.tempObject.up.copy(state.mapUp);
  state.tempObject.lookAt(x, state.player.position.y, z);

  // Force "down" direction (avoid roll)
  state.tempObject.rotation.x = -Math.PI / 2; // straight down
  // Optional: if you want north-up, add a yaw here:
  // state.tempObject.rotation.z = 0; // keep stable

  state.tempObject.updateMatrixWorld(true);
  state.tempQuat.copy(state.tempObject.quaternion);

  return { position: state.tempPos, quaternion: state.tempQuat };
}


function startTransition(mode) {
  const from = {
    position: state.camera.position.clone(),
    quaternion: state.camera.quaternion.clone(),
    up: state.camera.up.clone()
  };
  let to;
  if (mode === "disable" && state.previousCamera) {
    to = {
      position: state.previousCamera.position.clone(),
      quaternion: state.previousCamera.quaternion.clone(),
      up: state.previousCamera.up.clone()
    };
  }
  state.transition = {
    mode,
    start: performance.now(),
    duration: TRANSITION_MS,
    from,
    to
  };
}

function collectHiddenObjects() {
  const hidden = [];
  if (!state.scene) return hidden;
  state.scene.traverse((obj) => {
    if (!obj.visible) return;
    if (obj === state.playerIcon) return;
    if (obj.userData?.hideInMapView) {
      hidden.push({ object: obj, visible: obj.visible });
      obj.visible = false;
    }
  });
  return hidden;
}

function restoreHiddenObjects() {
  state.hiddenObjects.forEach(({ object, visible }) => {
    object.visible = visible;
  });
  state.hiddenObjects = [];
}

function initMapView({ camera, scene, player }) {
  state.camera = camera ?? state.camera;
  state.scene = scene ?? state.scene;
  state.player = player ?? state.player;
  if (state.scene) {
    ensurePlayerIcon();
  }
}

function setMapViewEnabled(enabled) {
  if (!state.camera || !state.scene || !state.player) return;
  if (state.enabled === enabled) return;

  if (enabled) {
    state.previousCamera = {
      position: state.camera.position.clone(),
      quaternion: state.camera.quaternion.clone(),
      up: state.camera.up.clone()
    };
    state.enabled = true;
    state.targetZoomHeight = state.mapZoomHeight;
    ensurePlayerIcon();
    state.playerIcon.visible = true;
    setDotVisibility(state.monsterDots, true);
    setDotVisibility(state.friendlyDots, true);
    state.hiddenObjects = collectHiddenObjects();
    startTransition("enable");
  } else {
    state.enabled = false;
    restoreHiddenObjects();
    if (state.playerIcon) state.playerIcon.visible = false;
    setDotVisibility(state.monsterDots, false);
    setDotVisibility(state.friendlyDots, false);
    startTransition("disable");
  }
}

function zoomIn() {
  state.targetZoomHeight = Math.max(MIN_ZOOM_HEIGHT, state.targetZoomHeight - ZOOM_STEP);
}

function zoomOut() {
  state.targetZoomHeight = Math.min(MAX_ZOOM_HEIGHT, state.targetZoomHeight + ZOOM_STEP);
}

function updatePlayerIcon() {
  if (!state.playerIcon || !state.player) return;
  state.playerIcon.position.set(
    state.player.position.x,
    state.player.position.y + 2,
    state.player.position.z
  );
  if (state.player.rotation) {
    state.playerIcon.material.rotation = -state.player.rotation.y;
  }
}

function update(dt, {
  monsters,
  animals,
  friendlies,
  weapons,
  items,
  ammoItems,
  woodItems,
  treasureChests,
  merchants,
  otherPlayers,
  homePosition,
  homeEnterDistance
} = {}) {
  if (!state.camera || !state.player) return;

  updateHomeIndicators(homePosition, homeEnterDistance);

  if (state.enabled) {
    state.mapZoomHeight = THREE.MathUtils.damp(
      state.mapZoomHeight,
      state.targetZoomHeight,
      6,
      dt
    );
    updatePlayerIcon();
    if (animals) {
      updateDotPoolFromLists(monsters, animals, state.monsterDots, "monster");
    } else {
      updateDotPool(monsters, state.monsterDots, "monster");
    }
    updateDotPool(friendlies, state.friendlyDots, "friendly");
    updateIconPool(weapons, state.weaponIcons, "weapon");
    if (ammoItems || woodItems) {
      updateIconPoolFromLists(ammoItems, woodItems, state.itemIcons, "item");
    } else {
      updateIconPool(items, state.itemIcons, "item");
    }
    updateIconPool(treasureChests, state.chestIcons, "chest");
    updateIconPool(merchants, state.merchantIcons, "merchant");
    updateRemotePlayerMarkers(otherPlayers);
  } else {
    setDotVisibility(state.monsterDots, false);
    setDotVisibility(state.friendlyDots, false);
    setDotVisibility(state.weaponIcons, false);
    setDotVisibility(state.itemIcons, false);
    setDotVisibility(state.chestIcons, false);
    setDotVisibility(state.merchantIcons, false);
    state.remotePlayerMarkers.forEach((marker) => {
      marker.dot.visible = false;
      marker.label.visible = false;
    });
  }

  if (state.transition) {
    const now = performance.now();
    const elapsed = now - state.transition.start;
    const t = Math.min(1, elapsed / state.transition.duration);
    const eased = t * t * (3 - 2 * t);

    const from = state.transition.from;
    const toPose = state.transition.mode === "enable" ? getMapPose() : state.transition.to;
    if (toPose) {
      state.camera.position.lerpVectors(from.position, toPose.position, eased);
      state.camera.quaternion.slerpQuaternions(from.quaternion, toPose.quaternion, eased);
      const toUp = state.transition.mode === "enable" ? state.mapUp : toPose.up;
      state.camera.up.lerpVectors(from.up, toUp, eased);
    }

    if (t >= 1) {
      if (state.transition.mode === "enable") {
        state.camera.up.copy(state.mapUp);
      } else if (state.transition.to) {
        state.camera.up.copy(state.transition.to.up);
      }
      state.transition = null;
    }
    return;
  }

  if (!state.enabled) return;

  const pose = getMapPose();
  if (!pose) return;
  state.camera.position.copy(pose.position);
  state.camera.quaternion.copy(pose.quaternion);
  state.camera.up.copy(state.mapUp);
}

export { initMapView, setMapViewEnabled, zoomIn, zoomOut, update };

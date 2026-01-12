import * as THREE from "three";

const DEFAULT_ZOOM_HEIGHT = 90;
const MIN_ZOOM_HEIGHT = 30;
const MAX_ZOOM_HEIGHT = 260;
const ZOOM_STEP = 15;
const TRANSITION_MS = 400;

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
  tempUp: new THREE.Vector3()
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

function ensurePlayerIcon() {
  if (state.playerIcon) return;
  const canvas = createPlayerIconTexture();
  const texture = canvas ? new THREE.CanvasTexture(canvas) : null;
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(4, 4, 4);
  sprite.visible = false;
  sprite.renderOrder = 999;
  state.playerIcon = sprite;
  state.scene?.add(sprite);
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
    state.hiddenObjects = collectHiddenObjects();
    startTransition("enable");
  } else {
    state.enabled = false;
    restoreHiddenObjects();
    if (state.playerIcon) state.playerIcon.visible = false;
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

function update(dt) {
  if (!state.camera || !state.player) return;

  if (state.enabled) {
    state.mapZoomHeight = THREE.MathUtils.damp(
      state.mapZoomHeight,
      state.targetZoomHeight,
      6,
      dt
    );
    updatePlayerIcon();
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

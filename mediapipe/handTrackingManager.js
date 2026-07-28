import { getHandLandmarker } from './mediapipeHelper.js';

let _video = null;
let _landmarker = null;
let _lastVideoTime = -1;
let _handData = { left: null, right: null };
let _enabled = false;
let _initialized = false;
let _uiContainer = null;
let _statusEl = null;

export function getHandTrackingData() {
  return _handData;
}

export function isHandTrackingEnabled() {
  return _enabled;
}

function createCameraUI() {
  if (_uiContainer) return;

  const container = document.createElement('div');
  container.id = 'hand-tracking-container';
  container.style.cssText = `
    position: fixed;
    width: 0;
    height: 0;
    overflow: hidden;
    pointer-events: none;
  `;

  const video = document.createElement('video');
  video.style.cssText = `
    width: 320px;
    height: 240px;
    display: block;
  `;
  video.autoplay = true;
  video.playsInline = true;
  video.muted = true;

  _statusEl = document.createElement('div');
  _statusEl.style.display = 'none';

  container.appendChild(video);
  document.body.appendChild(container);

  _video = video;
  _uiContainer = container;
}

function setStatus(text, color = '#4f4') {
  if (_statusEl) {
    _statusEl.textContent = text;
    _statusEl.style.color = color;
  }
}

async function startCamera() {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'environment', width: { ideal: 320 }, height: { ideal: 240 } }
  });
  _video.srcObject = stream;
  return new Promise((resolve, reject) => {
    _video.onloadedmetadata = () => {
      _video.play().then(resolve).catch(reject);
    };
    _video.onerror = reject;
  });
}

// Returns raw normalized palm position from the camera frame.
// x: 0=left edge of raw camera frame, 1=right edge (NOT mirrored here)
// y: 0=top, 1=bottom
function palmToNormalized(palmX, palmY) {
  return { x: palmX, y: palmY };
}

export function updateHandTracking() {
  if (!_enabled || !_landmarker || !_video || _video.readyState < 2) return;

  const videoTime = _video.currentTime;
  if (videoTime === _lastVideoTime) return;
  _lastVideoTime = videoTime;

  let results;
  try {
    results = _landmarker.detectForVideo(_video, performance.now());
  } catch {
    return;
  }

  const newData = { left: null, right: null };

  if (results?.landmarks?.length) {
    for (let i = 0; i < results.landmarks.length; i++) {
      const handedness = results.handednesses?.[i]?.[0]?.categoryName; // 'Left' or 'Right'
      const landmarks = results.landmarks[i];

      // Use palm center: average of wrist (0) and middle-finger MCP (9)
      const wrist = landmarks[0];
      const middleMCP = landmarks[9];
      const palmX = (wrist.x + middleMCP.x) / 2;
      const palmY = (wrist.y + middleMCP.y) / 2;

      // Hand size = distance from wrist to middle fingertip (landmark 12) in normalized coords.
      // Larger = closer to camera = hands outstretched in game.
      const middleTip = landmarks[12];
      const dx = middleTip.x - wrist.x;
      const dy = middleTip.y - wrist.y;
      const handSize = Math.sqrt(dx * dx + dy * dy);

      // Back camera: "Left" in the raw frame is the user's RIGHT hand.
      const gameSide = handedness === 'Left' ? 'right' : 'left';
      const norm = palmToNormalized(palmX, palmY);
      norm.size = handSize;
      newData[gameSide] = norm;
    }
    setStatus('✓', '#4f4');
  } else {
    setStatus('–', '#aaa');
  }

  _handData = newData;
}

export async function initHandTracking() {
  if (_initialized) return;
  _initialized = true;

  createCameraUI();
  setStatus('camera…', '#fa0');

  try {
    await startCamera();
    setStatus('model…', '#fa0');
    _landmarker = await getHandLandmarker('VIDEO');
    _enabled = true;
    setStatus('✓', '#4f4');
    console.log('[HandTracking] MediaPipe hand tracking active');
  } catch (err) {
    console.warn('[HandTracking] Failed to initialize:', err);
    setStatus('✗', '#f44');
    // Leave UI visible so the user knows something was attempted
  }
}

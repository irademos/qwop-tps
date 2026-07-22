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
    bottom: 16px;
    right: 16px;
    width: 160px;
    height: 130px;
    border-radius: 8px;
    overflow: hidden;
    border: 2px solid rgba(255, 255, 255, 0.3);
    z-index: 1000;
    background: #111;
    pointer-events: none;
    display: flex;
    flex-direction: column;
  `;

  const video = document.createElement('video');
  video.style.cssText = `
    width: 100%;
    flex: 1;
    object-fit: cover;
    transform: scaleX(-1);
    display: block;
  `;
  video.autoplay = true;
  video.playsInline = true;
  video.muted = true;

  const label = document.createElement('div');
  label.style.cssText = `
    background: rgba(0,0,0,0.65);
    color: #aef;
    font: 10px/1.4 monospace;
    text-align: center;
    padding: 2px 0;
    letter-spacing: 0.04em;
  `;
  label.textContent = '🤚 hand tracking';

  _statusEl = document.createElement('div');
  _statusEl.style.cssText = `
    position: absolute;
    top: 4px;
    left: 6px;
    color: #fa0;
    font: bold 10px monospace;
  `;
  _statusEl.textContent = 'loading…';

  container.appendChild(video);
  container.appendChild(label);
  container.appendChild(_statusEl);
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
    video: { facingMode: 'user', width: { ideal: 320 }, height: { ideal: 240 } }
  });
  _video.srcObject = stream;
  return new Promise((resolve, reject) => {
    _video.onloadedmetadata = () => {
      _video.play().then(resolve).catch(reject);
    };
    _video.onerror = reject;
  });
}

// Map a single-hand palm position (normalized camera coords) to arm rotation targets.
// x: 0=left edge of raw camera frame, 1=right edge
// y: 0=top, 1=bottom
// Front-facing camera: MediaPipe "Left" hand = user's right hand, "Right" = user's left hand.
// gameSide is already corrected by the caller.
function palmToArmAngles(palmX, palmY, gameSide) {
  // Mirror x to match mirrored camera view (what the user naturally sees)
  const mx = 1 - palmX;

  // Pitch (rotation.x): top of frame → arm up (-1.5), mid → natural rest (0.44), bottom → arm down (1.35)
  const rotX = THREE_lerp(-1.5, 1.35, palmY);

  // Roll (rotation.z): lateral offset from center
  // For left arm: right of screen → arm inward (negative z), left → arm outward (positive z)
  // For right arm: right of screen → arm outward (negative z), left → arm inward (positive z)
  const lateral = (mx - 0.5) * 2.4; // -1.2 to +1.2
  const rotZ = gameSide === 'left' ? lateral : -lateral;

  return {
    x: clamp(rotX, -1.65, 1.35),
    z: clamp(rotZ, -1.2, 1.2),
  };
}

function THREE_lerp(a, b, t) {
  return a + (b - a) * Math.max(0, Math.min(1, t));
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
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

      // MediaPipe handedness from camera view: "Left" appears on the left side of the raw
      // (non-mirrored) frame → that's the user's RIGHT hand in a front-facing camera.
      const gameSide = handedness === 'Left' ? 'right' : 'left';
      newData[gameSide] = palmToArmAngles(palmX, palmY, gameSide);
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

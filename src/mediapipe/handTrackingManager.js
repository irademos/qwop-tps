import { getHandLandmarker } from './mediapipeHelper.js';

let _video = null;
let _landmarker = null;
let _lastVideoTime = -1;
let _handData = { left: null, right: null };
let _enabled = false;
let _initialized = false;
let _uiContainer = null;
let _statusEl = null;

// Position smoothing: retain last known position per hand so brief dropouts and
// large jumps don't teleport the hand. A "jump" is treated as a dropout.
const HAND_JUMP_THRESHOLD = 0.25;  // normalized units; larger = hand teleport ignored
const HAND_DROPOUT_HOLD_MS = 400;  // how long to hold last position after losing hand
const _lastKnownHand = { left: null, right: null };
const _lastHandTime = { left: 0, right: 0 };

// Pinch/pointer detection config — mutated by debug sliders.
export const pinchConfig = {
  // Ratio of pinch distance to palm size below which isPinch is true.
  distanceThreshold: 0.2,
  // Milliseconds a state change must persist before being accepted (debounce buffer).
  bufferMs: 0,
};
let _pinchState = false;
let _pinchPendingState = false;
let _pinchPendingSince = 0;

// Handedness confirmation buffer: track[slot] = { confirmedSide, pendingSide, pendingCount }
// A new gameSide must appear HANDEDNESS_CONFIRM_FRAMES consecutive frames before it's accepted.
const HANDEDNESS_CONFIRM_FRAMES = 7;
const _handednessBuffer = [
  { confirmedSide: null, pendingSide: null, pendingCount: 0 },
  { confirmedSide: null, pendingSide: null, pendingCount: 0 },
];

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
  const stream = await _openBackCamera();
  _video.srcObject = stream;
  return new Promise((resolve, reject) => {
    _video.onloadedmetadata = () => {
      _video.play().then(resolve).catch(reject);
    };
    _video.onerror = reject;
  });
}

async function _openBackCamera() {
  // Try to find the 0.5x ultra-wide back camera by label.
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const ultraWide = devices.find(
      d => d.kind === 'videoinput' && /ultra|wide|0\.5/i.test(d.label)
    );
    if (ultraWide) {
      return await navigator.mediaDevices.getUserMedia({
        video: { deviceId: { exact: ultraWide.deviceId }, width: { ideal: 320 }, height: { ideal: 240 } }
      });
    }
  } catch {
    // fall through
  }
  // Fallback: regular back camera.
  return navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'environment', width: { ideal: 320 }, height: { ideal: 240 } }
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

      // Palm size: wrist (0) to middle MCP (9) — stable across fist/open, used for depth.
      // Larger = hand closer to camera = arms pulled back; smaller = far = arms outstretched.
      const pdx = middleMCP.x - wrist.x;
      const pdy = middleMCP.y - wrist.y;
      const palmSize = Math.sqrt(pdx * pdx + pdy * pdy);

      // Fist detection: check how many fingertips are curled toward the palm.
      // Compare each tip's distance to wrist against palm size — curled tips stay close.
      const FINGER_TIPS = [8, 12, 16, 20]; // index, middle, ring, pinky
      let curledCount = 0;
      for (const tipIdx of FINGER_TIPS) {
        const tip = landmarks[tipIdx];
        const tdx = tip.x - wrist.x;
        const tdy = tip.y - wrist.y;
        const tipDist = Math.sqrt(tdx * tdx + tdy * tdy);
        if (tipDist / palmSize < 1.5) curledCount++;
      }
      const isFist = curledCount >= 3;

      // Pinch detection: index fingertip (8) close to thumb tip (4).
      const thumbTip = landmarks[4];
      const indexTip = landmarks[8];
      const pdxP = indexTip.x - thumbTip.x;
      const pdyP = indexTip.y - thumbTip.y;
      const pdzP = (indexTip.z || 0) - (thumbTip.z || 0);
      const pinchDist = Math.sqrt(pdxP * pdxP + pdyP * pdyP + pdzP * pdzP);
      const rawPinch = pinchDist / palmSize < pinchConfig.distanceThreshold;

      // Apply millisecond buffer: a state change is only accepted after it persists for bufferMs.
      const now = performance.now();
      if (rawPinch !== _pinchPendingState) {
        _pinchPendingState = rawPinch;
        _pinchPendingSince = now;
      }
      if (_pinchPendingState !== _pinchState && (now - _pinchPendingSince) >= pinchConfig.bufferMs) {
        _pinchState = _pinchPendingState;
      }
      const isPinch = _pinchState;

      // Back camera: "Left" in the raw frame is the user's RIGHT hand.
      const rawSide = handedness === 'Left' ? 'right' : 'left';

      // Require HANDEDNESS_CONFIRM_FRAMES consecutive frames of the same label before
      // switching, so brief misclassifications don't flip the displayed side.
      const buf = _handednessBuffer[i];
      if (rawSide === buf.confirmedSide) {
        buf.pendingSide = null;
        buf.pendingCount = 0;
      } else if (rawSide === buf.pendingSide) {
        buf.pendingCount++;
        if (buf.pendingCount >= HANDEDNESS_CONFIRM_FRAMES) {
          buf.confirmedSide = rawSide;
          buf.pendingSide = null;
          buf.pendingCount = 0;
        }
      } else {
        buf.pendingSide = rawSide;
        buf.pendingCount = 1;
      }
      const gameSide = buf.confirmedSide ?? rawSide;

      const norm = palmToNormalized(palmX, palmY);
      norm.size = palmSize;
      norm.isFist = isFist;
      norm.isPinch = isPinch;
      norm.landmarks = landmarks;

      // Reject large position jumps (treat as dropout — keep last known instead).
      const prev = _lastKnownHand[gameSide];
      if (prev) {
        const dx = norm.x - prev.x;
        const dy = norm.y - prev.y;
        if (Math.sqrt(dx * dx + dy * dy) > HAND_JUMP_THRESHOLD) {
          // Jump too large — skip this frame for position but keep gesture data.
          newData[gameSide] = { ...prev, isFist, isPinch, landmarks };
          continue;
        }
      }

      _lastKnownHand[gameSide] = norm;
      _lastHandTime[gameSide] = performance.now();
      newData[gameSide] = norm;
    }
    setStatus('✓', '#4f4');
  } else {
    setStatus('–', '#aaa');
    // Reset confirmation buffers when no hands are visible.
    for (const buf of _handednessBuffer) {
      buf.confirmedSide = null;
      buf.pendingSide = null;
      buf.pendingCount = 0;
    }
  }

  // For hands not seen this frame, hold last known position during dropout window.
  const now = performance.now();
  for (const side of ['left', 'right']) {
    if (!newData[side] && _lastKnownHand[side] && (now - _lastHandTime[side]) < HAND_DROPOUT_HOLD_MS) {
      newData[side] = { ..._lastKnownHand[side], isFist: false, isPinch: false };
    }
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

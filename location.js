import * as THREE from 'three';
function createStatusElement() {
  const element = document.createElement('div');
  element.id = 'location-banner';
  element.className = 'location-banner is-hidden';

  const statusLine = document.createElement('div');
  element.appendChild(statusLine);
  document.body.appendChild(element);

  return {
    setStatus({ state, message }) {
      if (state === 'error') {
        statusLine.textContent = message ? `World position error: ${message}` : 'World position error';
        element.classList.add('is-visible');
        element.classList.remove('is-hidden');
        return;
      }
      element.classList.remove('is-visible');
      element.classList.add('is-hidden');
    },
    element
  };
}

function cloneWorldPosition(position) {
  if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.z)) {
    return null;
  }
  return {
    x: position.x,
    y: Number.isFinite(position.y) ? position.y : 0,
    z: position.z
  };
}

function getWorldDistance(a, b) {
  if (!a || !b) return null;
  if (!Number.isFinite(a.x) || !Number.isFinite(a.z) || !Number.isFinite(b.x) || !Number.isFinite(b.z)) {
    return null;
  }
  return Math.hypot(b.x - a.x, b.z - a.z);
}

function getWorldHeadingDegrees(from, to) {
  const distance = getWorldDistance(from, to);
  if (!Number.isFinite(distance) || distance <= 0.0001) return null;
  const radians = Math.atan2(to.x - from.x, to.z - from.z);
  return (THREE.MathUtils.radToDeg(radians) + 360) % 360;
}

export function createLocationTracker({
  getWorldPosition,
  onUpdate,
  onError,
  onStatus,
  throttleMs = 1000
} = {}) {
  let intervalId = null;
  let lastEmit = 0;
  let lastUpdate = null;
  const status = createStatusElement();

  const emitUpdate = () => {
    const now = performance.now();
    if (now - lastEmit < throttleMs) return;

    const position = cloneWorldPosition(getWorldPosition?.());
    if (!position) {
      const message = 'Player world position is unavailable.';
      status.setStatus({ state: 'error', message });
      onStatus?.({ state: 'error', message });
      onError?.(new Error(message), message);
      return;
    }

    const timestamp = Date.now();
    const elapsedSeconds = lastUpdate?.timestamp ? Math.max(0, (timestamp - lastUpdate.timestamp) / 1000) : 0;
    const movedMeters = getWorldDistance(lastUpdate, position) ?? 0;
    const nextUpdate = {
      ...position,
      accuracyMeters: 0,
      heading: lastUpdate ? getWorldHeadingDegrees(lastUpdate, position) : null,
      speed: elapsedSeconds > 0 ? movedMeters / elapsedSeconds : 0,
      distanceMeters: movedMeters,
      timestamp,
      source: 'world'
    };

    lastEmit = now;
    lastUpdate = nextUpdate;
    status.setStatus({ state: 'found' });
    onStatus?.({ state: 'found', accuracy: 0, timestamp, source: 'world' });
    onUpdate?.(nextUpdate);
  };

  const start = () => {
    if (intervalId) return true;
    emitUpdate();
    intervalId = setInterval(emitUpdate, throttleMs);
    return true;
  };

  const stop = () => {
    if (!intervalId) return;
    clearInterval(intervalId);
    intervalId = null;
  };

  return {
    start,
    stop,
    retry: emitUpdate,
    getLastUpdate: () => lastUpdate,
    statusElement: status.element
  };
}

export function createLocationProvider(options = {}) {
  let currentLocation = null;
  const tracker = createLocationTracker({
    ...options,
    onUpdate: (location) => {
      currentLocation = location;
      options.onUpdate?.(location);
    }
  });

  return {
    start: tracker.start,
    stop: tracker.stop,
    retry: tracker.retry,
    getCurrentLocation: () => currentLocation,
    getDebugState: () => ({ enabled: false }),
    setDebugEnabled: () => {},
    setDebugLocation: () => {},
    setDebugAccuracy: () => {},
    stepDebugLocation: () => {}
  };
}

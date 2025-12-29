const DEFAULT_OPTIONS = {
  enableHighAccuracy: true,
  maximumAge: 0,
  timeout: 10000
};

const STATUS_STYLES = {
  container: [
    'position: fixed',
    'left: 50%',
    'bottom: 20px',
    'transform: translateX(-50%)',
    'background: rgba(0, 0, 0, 0.7)',
    'color: #fff',
    'padding: 10px 14px',
    'border-radius: 8px',
    'font-family: "Press Start 2P", monospace',
    'font-size: 10px',
    'line-height: 1.4',
    'z-index: 9999',
    'max-width: 90vw',
    'text-align: center',
    'display: none'
  ].join(';')
};

function createStatusElement() {
  const element = document.createElement('div');
  element.id = 'location-status';
  element.setAttribute('style', STATUS_STYLES.container);
  document.body.appendChild(element);

  return {
    show(message) {
      element.textContent = message;
      element.style.display = 'block';
    },
    clear() {
      element.textContent = '';
      element.style.display = 'none';
    },
    element
  };
}

function getErrorMessage(error) {
  if (!error) {
    return 'Unable to read your location.';
  }
  switch (error.code) {
    case error.PERMISSION_DENIED:
      return 'Location permission denied. Enable it in your browser settings.';
    case error.POSITION_UNAVAILABLE:
      return 'Location unavailable. Check your signal and try again.';
    case error.TIMEOUT:
      return 'Location request timed out. Try again soon.';
    default:
      return error.message || 'Unable to read your location.';
  }
}

export function createLocationTracker({
  onUpdate,
  onError,
  throttleMs = 1000,
  options = DEFAULT_OPTIONS
} = {}) {
  let watchId = null;
  let lastEmit = 0;
  let lastUpdate = null;
  let requestedPermission = false;
  const status = createStatusElement();

  const emitUpdate = (position) => {
    const now = performance.now();
    if (now - lastEmit < throttleMs) return;

    lastEmit = now;
    const { coords, timestamp } = position;
    lastUpdate = {
      lat: coords.latitude,
      lon: coords.longitude,
      accuracyMeters: coords.accuracy,
      heading: coords.heading,
      speed: coords.speed,
      timestamp
    };
    status.clear();
    onUpdate?.(lastUpdate);
  };

  const handleError = (error) => {
    const message = getErrorMessage(error);
    status.show(message);
    onError?.(error, message);
  };

  const requestPermission = () => {
    if (requestedPermission) return;
    requestedPermission = true;
    navigator.geolocation.getCurrentPosition(emitUpdate, handleError, options);
  };

  const start = () => {
    if (!navigator.geolocation) {
      status.show('Geolocation is not supported in this browser.');
      return false;
    }
    requestPermission();
    if (watchId !== null) return true;
    watchId = navigator.geolocation.watchPosition(emitUpdate, handleError, options);
    return true;
  };

  const stop = () => {
    if (watchId === null) return;
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  };

  return {
    start,
    stop,
    getLastUpdate: () => lastUpdate,
    statusElement: status.element
  };
}

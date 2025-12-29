const INITIAL_FIX_OPTIONS = {
  enableHighAccuracy: false,
  maximumAge: 60000,
  timeout: 15000
};

const WATCH_OPTIONS = {
  enableHighAccuracy: true,
  maximumAge: 5000,
  timeout: 20000
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
  ].join(';'),
  button: [
    'margin-top: 6px',
    'padding: 6px 10px',
    'font-family: "Press Start 2P", monospace',
    'font-size: 9px',
    'background: #1f8bff',
    'color: #fff',
    'border: none',
    'border-radius: 6px',
    'cursor: pointer'
  ].join(';')
};

function createStatusElement() {
  const element = document.createElement('div');
  element.id = 'location-status';
  element.setAttribute('style', STATUS_STYLES.container);

  const statusLine = document.createElement('div');
  const accuracyLine = document.createElement('div');
  const retryButton = document.createElement('button');
  retryButton.type = 'button';
  retryButton.textContent = 'Retry';
  retryButton.setAttribute('style', STATUS_STYLES.button);

  element.appendChild(statusLine);
  element.appendChild(accuracyLine);
  element.appendChild(retryButton);
  document.body.appendChild(element);

  return {
    setStatus({ state, message, accuracy }) {
      statusLine.textContent = `Status: ${state}${message ? ` (${message})` : ''}`;
      if (typeof accuracy === 'number') {
        accuracyLine.textContent = `Accuracy: ${Math.round(accuracy)}m`;
      } else {
        accuracyLine.textContent = 'Accuracy: --';
      }
      element.style.display = 'block';
    },
    onRetry(handler) {
      retryButton.addEventListener('click', handler);
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
      return 'Enable Location in browser settings and reload.';
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
  throttleMs = 1000
} = {}) {
  let watchId = null;
  let lastEmit = 0;
  let lastUpdate = null;
  let retryCount = 0;
  let retryTimer = null;
  const status = createStatusElement();
  const maxRetries = 3;
  const retryDelayMs = 2000;

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
    status.setStatus({ state: 'found', accuracy: coords.accuracy });
    onUpdate?.(lastUpdate);
  };

  const stopWatch = () => {
    if (watchId === null) return;
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  };

  const clearRetryTimer = () => {
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
  };

  const scheduleRetry = () => {
    if (retryCount >= maxRetries) return;
    retryCount += 1;
    clearRetryTimer();
    retryTimer = setTimeout(() => {
      getInitialFix();
    }, retryDelayMs);
  };

  const handleInitialError = (error) => {
    const message = getErrorMessage(error);
    status.setStatus({ state: 'error', message, accuracy: lastUpdate?.accuracyMeters });
    if (error?.code === error.PERMISSION_DENIED) {
      onError?.(error, message);
      return;
    }
    if (error?.code === error.TIMEOUT || error?.code === error.POSITION_UNAVAILABLE) {
      scheduleRetry();
    }
    onError?.(error, message);
  };

  const startWatch = () => {
    if (watchId !== null) return;
    watchId = navigator.geolocation.watchPosition(emitUpdate, handleInitialError, WATCH_OPTIONS);
  };

  const handleInitialSuccess = (position) => {
    retryCount = 0;
    clearRetryTimer();
    emitUpdate(position);
    startWatch();
  };

  const getInitialFix = () => {
    status.setStatus({ state: 'requesting', accuracy: lastUpdate?.accuracyMeters });
    navigator.geolocation.getCurrentPosition(
      handleInitialSuccess,
      handleInitialError,
      INITIAL_FIX_OPTIONS
    );
  };

  const start = () => {
    if (!navigator.geolocation) {
      status.setStatus({ state: 'error', message: 'Geolocation is not supported in this browser.' });
      return false;
    }
    getInitialFix();
    return true;
  };

  const stop = () => {
    clearRetryTimer();
    stopWatch();
  };

  status.onRetry(() => {
    retryCount = 0;
    clearRetryTimer();
    stopWatch();
    if (navigator.geolocation) {
      getInitialFix();
    }
  });

  return {
    start,
    stop,
    getLastUpdate: () => lastUpdate,
    statusElement: status.element
  };
}

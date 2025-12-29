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

function createStatusElement() {
  const element = document.createElement('div');
  element.id = 'location-banner';
  element.className = 'location-banner';

  const statusLine = document.createElement('div');
  element.appendChild(statusLine);
  document.body.appendChild(element);

  let hideTimer = null;

  return {
    setStatus({ state, message, accuracy }) {
      if (hideTimer) {
        clearTimeout(hideTimer);
        hideTimer = null;
      }
      if (state === 'requesting') {
        statusLine.textContent = 'Requesting location…';
      } else if (state === 'found') {
        const accuracyText = typeof accuracy === 'number' ? ` (±${Math.round(accuracy)}m)` : '';
        statusLine.textContent = `Location found${accuracyText}`;
      } else if (state === 'error') {
        statusLine.textContent = message ? `Location error: ${message}` : 'Location error';
      } else {
        statusLine.textContent = message || 'Location status updated.';
      }
      element.classList.add('is-visible');
      element.classList.remove('is-hidden');

      if (state === 'found') {
        hideTimer = setTimeout(() => {
          element.classList.add('is-hidden');
        }, 1700);
      }
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
  onStatus,
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
    onStatus?.({ state: 'found', accuracy: coords.accuracy, timestamp });
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
    onStatus?.({ state: 'error', message, accuracy: lastUpdate?.accuracyMeters });
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
    onStatus?.({ state: 'requesting', accuracy: lastUpdate?.accuracyMeters });
    navigator.geolocation.getCurrentPosition(
      handleInitialSuccess,
      handleInitialError,
      INITIAL_FIX_OPTIONS
    );
  };

  const start = () => {
    if (!navigator.geolocation) {
      status.setStatus({ state: 'error', message: 'Geolocation is not supported in this browser.' });
      onStatus?.({ state: 'error', message: 'Geolocation is not supported in this browser.' });
      return false;
    }
    getInitialFix();
    return true;
  };

  const stop = () => {
    clearRetryTimer();
    stopWatch();
  };

  const retry = () => {
    retryCount = 0;
    clearRetryTimer();
    stopWatch();
    if (navigator.geolocation) {
      getInitialFix();
    }
  };

  return {
    start,
    stop,
    retry,
    getLastUpdate: () => lastUpdate,
    statusElement: status.element
  };
}

import { showFeatureLoading } from './loadingState.js';

let mapModulePromise = null;
let mapViewEnabledState = false;
let mapTransitionUntilMs = 0;
const MAP_TRANSITION_DURATION_MS = 450;

async function loadMapModule() {
  if (!mapModulePromise) {
    const hideLoading = showFeatureLoading('Loading map view');
    mapModulePromise = import('../environment/mapView.js').finally(() => hideLoading());
  }
  return mapModulePromise;
}

export async function initMapViewFeature(params) {
  const mapModule = await loadMapModule();
  mapModule.initMapView(params);
}

export async function setMapViewEnabledFeature(enabled) {
  mapViewEnabledState = enabled === true;
  mapTransitionUntilMs = performance.now() + MAP_TRANSITION_DURATION_MS;
  const mapModule = await loadMapModule();
  mapModule.setMapViewEnabled(enabled);
}

export async function updateMapViewFeature(delta, state) {
  if (!mapViewEnabledState && !isMapViewTransitionActiveFeature()) {
    return;
  }
  const mapModule = await loadMapModule();
  mapModule.update(delta, state);
}

export function isMapViewTransitionActiveFeature() {
  return performance.now() < mapTransitionUntilMs;
}

export async function zoomInMapFeature() {
  const mapModule = await loadMapModule();
  mapModule.zoomIn();
}

export async function zoomOutMapFeature() {
  const mapModule = await loadMapModule();
  mapModule.zoomOut();
}

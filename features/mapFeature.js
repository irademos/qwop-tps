import { showFeatureLoading } from './loadingState.js';

let mapModulePromise = null;

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
  const mapModule = await loadMapModule();
  mapModule.setMapViewEnabled(enabled);
}

export async function updateMapViewFeature(delta, state) {
  const mapModule = await loadMapModule();
  mapModule.update(delta, state);
}

export async function zoomInMapFeature() {
  const mapModule = await loadMapModule();
  mapModule.zoomIn();
}

export async function zoomOutMapFeature() {
  const mapModule = await loadMapModule();
  mapModule.zoomOut();
}

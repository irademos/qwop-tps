export const DISTANCE_UNITS_KEY = 'display:distanceUnit';

export function getDistanceUnitPreference() {
  const value = localStorage.getItem(DISTANCE_UNITS_KEY);
  return value === 'km' ? 'km' : 'miles';
}

export function setDistanceUnitPreference(unit) {
  const normalized = unit === 'km' ? 'km' : 'miles';
  localStorage.setItem(DISTANCE_UNITS_KEY, normalized);
  return normalized;
}

export function formatDistanceForDisplay(distanceMeters) {
  if (typeof distanceMeters !== 'number' || Number.isNaN(distanceMeters)) return '—';
  const unit = getDistanceUnitPreference();
  if (unit === 'km') {
    if (distanceMeters < 1000) return `${distanceMeters.toFixed(0)} m`;
    return `${(distanceMeters / 1000).toFixed(2)} km`;  
  }
  const miles = distanceMeters / 1609.344;
  if (miles >= 0.1) return `${miles.toFixed(2)} mi`;
  const feet = distanceMeters * 3.28084;
  return `${feet.toFixed(0)} ft`;
}

export function formatLongDistance(distanceMeters) {
  if (typeof distanceMeters !== 'number' || Number.isNaN(distanceMeters)) return '—';
  const unit = getDistanceUnitPreference();
  if (unit === 'km') {
    return `${(distanceMeters / 1000).toFixed(2)} km`;
  }
  return `${(distanceMeters / 1609.344).toFixed(2)} miles`;
}

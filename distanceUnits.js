export const DISTANCE_UNITS_KEY = 'display:distanceUnit';

export function getDistanceUnitPreference() {
  const value = localStorage.getItem(DISTANCE_UNITS_KEY);
  return value === 'miles' ? 'miles' : 'km';
}

export function setDistanceUnitPreference(unit) {
  const normalized = unit === 'miles' ? 'miles' : 'km';
  localStorage.setItem(DISTANCE_UNITS_KEY, normalized);
  return normalized;
}

export function formatDistanceForDisplay(distanceMeters) {
  if (typeof distanceMeters !== 'number' || Number.isNaN(distanceMeters)) return '—';
  const unit = getDistanceUnitPreference();
  if (unit === 'miles') {
    const miles = distanceMeters / 1609.344;
    if (miles >= 0.1) return `${miles.toFixed(2)} mi`;
    const feet = distanceMeters * 3.28084;
    return `${feet.toFixed(0)} ft`;
  }
  if (distanceMeters < 1000) return `${distanceMeters.toFixed(0)} m`;
  return `${(distanceMeters / 1000).toFixed(2)} km`;
}

export function formatLongDistance(distanceMeters) {
  if (typeof distanceMeters !== 'number' || Number.isNaN(distanceMeters)) return '—';
  const unit = getDistanceUnitPreference();
  if (unit === 'miles') {
    return `${(distanceMeters / 1609.344).toFixed(2)} miles`;
  }
  return `${(distanceMeters / 1000).toFixed(2)} km`;
}

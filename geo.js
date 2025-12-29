const EARTH_RADIUS_METERS = 6371000;
const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

export function latLonToMeters(origin, lat, lon) {
  const lat0 = origin.lat;
  const lon0 = origin.lon;
  const latRad = lat * DEG_TO_RAD;
  const lonRad = lon * DEG_TO_RAD;
  const lat0Rad = lat0 * DEG_TO_RAD;
  const lon0Rad = lon0 * DEG_TO_RAD;

  const x = (lonRad - lon0Rad) * Math.cos(lat0Rad) * EARTH_RADIUS_METERS;
  const z = (latRad - lat0Rad) * EARTH_RADIUS_METERS;

  return { x, y: 0, z };
}

export function metersToLatLon(origin, x, z) {
  const lat0 = origin.lat;
  const lon0 = origin.lon;
  const lat0Rad = lat0 * DEG_TO_RAD;
  const lon0Rad = lon0 * DEG_TO_RAD;

  const latRad = lat0Rad + z / EARTH_RADIUS_METERS;
  const lonRad = lon0Rad + x / (EARTH_RADIUS_METERS * Math.cos(lat0Rad));

  return { lat: latRad * RAD_TO_DEG, lon: lonRad * RAD_TO_DEG };
}

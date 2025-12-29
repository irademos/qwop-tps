import assert from 'node:assert/strict';
import { latLonToMeters, metersToLatLon } from './geo.js';

const origin = { lat: 37.7749, lon: -122.4194 };

const approxEqual = (actual, expected, tolerance, message) => {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    message ?? `Expected ${actual} to be within ${tolerance} of ${expected}`
  );
};

{
  const meters = latLonToMeters(origin, origin.lat + 0.0001, origin.lon);
  approxEqual(meters.z, 11.119, 0.2, 'Northing should match small latitude delta');
  approxEqual(meters.x, 0, 0.01, 'Easting should be near zero when longitude is unchanged');
  assert.equal(meters.y, 0);
}

{
  const meters = latLonToMeters(origin, origin.lat, origin.lon + 0.0001);
  const expectedX = Math.cos(origin.lat * Math.PI / 180) * 11.119;
  approxEqual(meters.x, expectedX, 0.3, 'Easting should match small longitude delta');
  approxEqual(meters.z, 0, 0.01, 'Northing should be near zero when latitude is unchanged');
}

{
  const meters = latLonToMeters(origin, origin.lat + 0.0001, origin.lon - 0.0001);
  const roundTrip = metersToLatLon(origin, meters.x, meters.z);
  approxEqual(roundTrip.lat, origin.lat + 0.0001, 1e-8, 'Latitude round trip');
  approxEqual(roundTrip.lon, origin.lon - 0.0001, 1e-8, 'Longitude round trip');
}

console.log('geo conversion tests passed');

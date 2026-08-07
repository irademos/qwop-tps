export function getLiveRigidBody(world, body) {
  if (!world || !body || typeof body.handle !== 'number' || typeof world.getRigidBody !== 'function') {
    return null;
  }
  const liveBody = world.getRigidBody(body.handle);
  return liveBody === body ? liveBody : null;
}

export function removeRigidBodySafely(world, body) {
  const liveBody = getLiveRigidBody(world, body);
  if (!liveBody || typeof world.removeRigidBody !== 'function') return false;
  world.removeRigidBody(liveBody);
  return true;
}

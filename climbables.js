import RAPIER from "@dimforge/rapier3d-compat";

const climbables = [];

function distanceToAabb(position, center, halfExtents) {
  const dx = Math.max(Math.abs(position.x - center.x) - halfExtents.x, 0);
  const dy = Math.max(Math.abs(position.y - center.y) - halfExtents.y, 0);
  const dz = Math.max(Math.abs(position.z - center.z) - halfExtents.z, 0);
  return Math.hypot(dx, dy, dz);
}

export function clearClimbableSensors() {
  const world = window.rapierWorld;
  if (world) {
    for (const entry of climbables) {
      try {
        if (entry.collider) {
          world.removeCollider(entry.collider, true);
        }
        if (entry.body) {
          world.removeRigidBody(entry.body);
        }
      } catch (err) {
        console.warn("Failed to remove climbable sensor:", err);
      }
    }
  }
  climbables.length = 0;
}

export function registerClimbableSensor({
  center,
  halfExtents,
  normal,
  minY,
  maxY,
  type = "ladder"
}) {
  if (!center || !halfExtents) return null;
  const world = window.rapierWorld;
  let body = null;
  let collider = null;
  if (world) {
    const rbDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(center.x, center.y, center.z);
    body = world.createRigidBody(rbDesc);
    const colliderDesc = RAPIER.ColliderDesc
      .cuboid(halfExtents.x, halfExtents.y, halfExtents.z)
      .setSensor(true);
    collider = world.createCollider(colliderDesc, body);
  }
  const entry = {
    type,
    center: { x: center.x, y: center.y, z: center.z },
    halfExtents: { x: halfExtents.x, y: halfExtents.y, z: halfExtents.z },
    normal,
    minY,
    maxY,
    body,
    collider
  };
  climbables.push(entry);
  return entry;
}

export function getNearestClimbable(position, maxDistance) {
  if (!position) return null;
  let closest = null;
  let closestDist = Number.POSITIVE_INFINITY;
  for (const entry of climbables) {
    const dist = distanceToAabb(position, entry.center, entry.halfExtents);
    if (dist <= maxDistance && dist < closestDist) {
      closest = entry;
      closestDist = dist;
    }
  }
  return closest;
}

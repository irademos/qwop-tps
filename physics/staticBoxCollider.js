import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

const DEFAULT_PADDING = new THREE.Vector3(0, 0, 0);

const toPaddingVector = (padding = DEFAULT_PADDING) => {
  if (padding instanceof THREE.Vector3) return padding;
  if (Array.isArray(padding) && padding.length >= 3) {
    return new THREE.Vector3(padding[0], padding[1], padding[2]);
  }
  if (typeof padding === 'number' && Number.isFinite(padding)) {
    return new THREE.Vector3(padding, padding, padding);
  }
  return DEFAULT_PADDING;
};

export const createStaticBoxColliderForObject = (object3D, options = {}) => {
  if (!object3D) return null;
  const rapierWorld = options.rapierWorld || window.rapierWorld;
  if (!rapierWorld) return null;

  const worldBox = new THREE.Box3().setFromObject(object3D);
  if (worldBox.isEmpty()) return null;

  const center = new THREE.Vector3();
  const size = new THREE.Vector3();
  worldBox.getCenter(center);
  worldBox.getSize(size);

  const padding = toPaddingVector(options.padding);
  size.add(padding.clone().multiplyScalar(2));

  const minHalfExtent = Number.isFinite(options.minHalfExtent) ? options.minHalfExtent : 0.05;
  const half = size.multiplyScalar(0.5);
  half.x = Math.max(half.x, minHalfExtent);
  half.y = Math.max(half.y, minHalfExtent);
  half.z = Math.max(half.z, minHalfExtent);

  const rbDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(center.x, center.y, center.z);
  const body = rapierWorld.createRigidBody(rbDesc);

  const colDesc = RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z)
    .setRestitution(Number.isFinite(options.restitution) ? options.restitution : 0.02)
    .setFriction(Number.isFinite(options.friction) ? options.friction : 0.9);

  const collider = rapierWorld.createCollider(colDesc, body);

  return {
    body,
    collider,
    half,
    center,
    worldBox,
    object3D,
    rapierWorld
  };
};

export const syncStaticBoxColliderForObject = (entry) => {
  if (!entry?.object3D || !entry?.body || !entry?.worldBox) return;
  entry.worldBox.setFromObject(entry.object3D);
  if (entry.worldBox.isEmpty()) return;
  entry.worldBox.getCenter(entry.center);
  entry.body.setTranslation(
    { x: entry.center.x, y: entry.center.y, z: entry.center.z },
    true
  );
};

export const removeStaticBoxCollider = (entry) => {
  if (!entry?.body || !entry?.rapierWorld) return;
  const existingBody = entry.rapierWorld.getRigidBody?.(entry.body.handle);
  if (!existingBody) return;
  entry.rapierWorld.removeRigidBody(entry.body);
};

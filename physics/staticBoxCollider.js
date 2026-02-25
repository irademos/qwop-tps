import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { appContext } from '../src/runtime/appContext.js';

const DEFAULT_PADDING = new THREE.Vector3(0, 0, 0);

const toVector3 = (value) => {
  if (value instanceof THREE.Vector3) return value.clone();
  if (Array.isArray(value) && value.length >= 3) {
    return new THREE.Vector3(value[0], value[1], value[2]);
  }
  return null;
};

const getObjectWorldCenter = (object3D, target = new THREE.Vector3()) => {
  if (!object3D) return target;
  object3D.updateWorldMatrix?.(true, true);
  object3D.getWorldPosition?.(target);
  return target;
};

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
  const rapierWorld = options.rapierWorld || appContext.entities.rapierWorld;
  if (!rapierWorld) return null;

  const worldBox = new THREE.Box3().setFromObject(object3D);
  if (worldBox.isEmpty()) return null;

  const center = new THREE.Vector3();
  const useObjectPosition = options.useObjectPosition === true;
  if (useObjectPosition) {
    getObjectWorldCenter(object3D, center);
  } else {
    worldBox.getCenter(center);
  }

  const explicitHalf = toVector3(options.halfExtents);
  const explicitCenterOffset = toVector3(options.centerOffset);

  if (explicitCenterOffset) {
    center.add(explicitCenterOffset);
  }

  const minHalfExtent = Number.isFinite(options.minHalfExtent) ? options.minHalfExtent : 0.05;
  const maxHalfExtent = Number.isFinite(options.maxHalfExtent) ? options.maxHalfExtent : Infinity;

  let half = explicitHalf;
  if (!half) {
    const size = new THREE.Vector3();
    worldBox.getSize(size);
    const padding = toPaddingVector(options.padding);
    size.add(padding.clone().multiplyScalar(2));
    half = size.multiplyScalar(0.5);
  }

  half.x = Math.min(maxHalfExtent, Math.max(half.x, minHalfExtent));
  half.y = Math.min(maxHalfExtent, Math.max(half.y, minHalfExtent));
  half.z = Math.min(maxHalfExtent, Math.max(half.z, minHalfExtent));

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
    centerOffset: explicitCenterOffset || null,
    useObjectPosition,
    rapierWorld
  };
};

export const syncStaticBoxColliderForObject = (entry) => {
  if (!entry?.object3D || !entry?.body || !entry?.worldBox) return;
  entry.worldBox.setFromObject(entry.object3D);
  if (entry.worldBox.isEmpty()) return;
  if (entry.useObjectPosition) {
    getObjectWorldCenter(entry.object3D, entry.center);
  } else {
    entry.worldBox.getCenter(entry.center);
  }
  if (entry.centerOffset) {
    entry.center.add(entry.centerOffset);
  }
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

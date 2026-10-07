import * as THREE from 'three';

// Line-of-fire checks against the static GLB map (buildings, walls, ground). The map's
// meshes are registered once they have their three-mesh-bvh bounds trees (bootstrapGameApp.js),
// so a short segment cast only touches the few triangles near it.

let mapMeshes = [];
const _raycaster = new THREE.Raycaster();
_raycaster.firstHitOnly = true; // three-mesh-bvh: stop at the closest triangle per mesh
const _dir = new THREE.Vector3();
const _hit = { point: new THREE.Vector3(), normal: new THREE.Vector3(), distance: 0 };

export function registerMapMeshes(meshes) {
  mapMeshes = Array.isArray(meshes) ? meshes : [];
}

/**
 * First map surface on the segment from → to, or null. The result is reused between
 * calls (copy what you keep): { point, normal (world space, facing the shooter), distance }.
 */
export function raycastMapSegment(from, to) {
  if (!mapMeshes.length || !from || !to) return null;
  _dir.subVectors(to, from);
  const length = _dir.length();
  if (length < 1e-4) return null;
  _raycaster.set(from, _dir.divideScalar(length));
  _raycaster.far = length;
  const hit = _raycaster.intersectObjects(mapMeshes, false)[0];
  if (!hit) return null;
  _hit.point.copy(hit.point);
  _hit.distance = hit.distance;
  if (hit.face) {
    _hit.normal.copy(hit.face.normal).transformDirection(hit.object.matrixWorld);
    if (_hit.normal.dot(_dir) > 0) _hit.normal.negate(); // back face: point it at the shooter
  } else {
    _hit.normal.copy(_dir).negate();
  }
  return _hit;
}

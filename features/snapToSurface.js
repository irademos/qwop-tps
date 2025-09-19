/**
 * features/snapToSurface.js
 *
 * Small, lazy-loaded controller that snaps a furniture-preview group's position and
 * orientation to nearby surfaces (useful for sloped terrain). No side-effects on import.
 *
 * Usage:
 *   const ctl = initSnapToSurface(THREE, { furniturePreview, scene, maxSlopeDeg: 45 });
 *   ctl.setActive(true);
 *
 * API:
 *   - setActive(bool)
 *   - snapNow()
 *   - destroy()
 */

export function initSnapToSurface(THREE, { furniturePreview = null, scene = null, maxSlopeDeg = 30 } = {}) {
  if (!THREE) throw new Error('THREE is required');
  if (!scene) throw new Error('scene is required');
  if (!furniturePreview) throw new Error('furniturePreview is required');

  let active = false;
  const raycaster = new THREE.Raycaster();
  const down = new THREE.Vector3(0, -1, 0);
  const up = new THREE.Vector3(0, 1, 0);
  let rafId = null;
  let targets = [];

  function collectTargets() {
    targets = [];
    scene.traverse((n) => {
      if (n && n.isMesh) targets.push(n);
    });
  }

  function _alignPreviewOnce() {
    try {
      const preview = furniturePreview && furniturePreview.group ? furniturePreview.group : null;
      if (!preview) return;

      // Ensure up-to-date target list
      if (!targets.length) collectTargets();

      const worldPos = new THREE.Vector3();
      preview.getWorldPosition(worldPos);
      const origin = worldPos.clone().add(new THREE.Vector3(0, 1.2, 0));
      raycaster.set(origin, down);

      const intersects = raycaster.intersectObjects(targets, true);
      if (intersects && intersects.length) {
        const hit = intersects[0];
        const point = hit.point.clone();
        // face normal may be in local space; transform to world
        const normal = (hit.face && hit.face.normal) ? hit.face.normal.clone() : hit.normal.clone();
        normal.transformDirection(hit.object.matrixWorld);
        normal.normalize();

        // Reject surfaces that are too steep
        const angle = Math.acos(Math.max(-1, Math.min(1, normal.dot(up))));
        const maxRad = (maxSlopeDeg * Math.PI) / 180;
        if (angle > maxRad) {
          // Too steep: leave preview upright at hit height but don't tilt
          preview.position.copy(point);
          // keep original yaw but reset tilt
          const yaw = preview.rotation ? preview.rotation.y || 0 : 0;
          preview.quaternion.setFromAxisAngle(new THREE.Vector3(0,1,0), yaw);
          return;
        }

        // Move preview to the hit point, offset slightly along normal to avoid z-fighting.
        preview.position.copy(point).add(normal.clone().multiplyScalar(0.01));

        // Align preview 'up' to the surface normal while preserving yaw where possible.
        // Compute base rotation that maps world up to surface normal.
        const alignQuat = new THREE.Quaternion().setFromUnitVectors(up, normal);
        // Preserve the preview's yaw (rotation around its local up)
        const currentYaw = preview.rotation ? preview.rotation.y || 0 : 0;
        const yawQuat = new THREE.Quaternion().setFromAxisAngle(normal.clone(), currentYaw);
        // final = align * yaw
        const finalQuat = alignQuat.multiply(yawQuat);
        preview.quaternion.copy(finalQuat);
        preview.updateMatrixWorld();
      } else {
        // No hit: fallback to ground plane y=0 (upright)
        const fallbackY = 0;
        preview.position.set(worldPos.x, fallbackY, worldPos.z);
        preview.quaternion.setFromAxisAngle(new THREE.Vector3(0,1,0), preview.rotation ? preview.rotation.y || 0 : 0);
        preview.updateMatrixWorld();
      }
    } catch (e) {
      // Defensive: do not throw during animation
      console.error('snapToSurface align error', e);
    }
  }

  function loop() {
    if (!active) return;
    _alignPreviewOnce();
    rafId = requestAnimationFrame(loop);
  }

  function setActive(v = true) {
    if (v === active) return;
    active = !!v;
    if (active) {
      collectTargets();
      // run one immediate snap then start loop
      _alignPreviewOnce();
      rafId = requestAnimationFrame(loop);
    } else {
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
    }
  }

  function snapNow() {
    _alignPreviewOnce();
  }

  function destroy() {
    setActive(false);
    targets = [];
  }

  return {
    setActive,
    snapNow,
    destroy
  };
}

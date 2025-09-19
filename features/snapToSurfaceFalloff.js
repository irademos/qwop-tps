/**
 * features/snapToSurfaceFalloff.js
 *
 * Adds automatic ground-falloff blending to an existing furniture preview.
 * - Non-blocking, no top-level side-effects.
 * - Call initSnapToSurfaceFalloff(...) and it will augment the provided preview
 *   by wrapping its update(delta) method. The preview's update will continue to run.
 *
 * API:
 *   const ctrl = initSnapToSurfaceFalloff(THREE, { furniturePreview, scene, maxSlopeDeg });
 *   ctrl.setActive(true|false);
 *   ctrl.snapNow(); // immediate sample & apply
 *   ctrl.destroy(); // restore original preview.update
 */

export function initSnapToSurfaceFalloff(THREE, {
  furniturePreview,
  scene,
  maxSlopeDeg = 45,
  maxFalloff = 1.0,
  sampleRadius = 0.6,
  sampleCount = 6,
  smoothing = 8.0
} = {}) {
  if (!THREE) throw new Error('THREE is required');
  if (!scene) throw new Error('scene is required');
  if (!furniturePreview || !furniturePreview.group) {
    throw new Error('furniturePreview with .group is required');
  }

  const group = furniturePreview.group;
  const raycaster = new THREE.Raycaster();
  const up = new THREE.Vector3(0, 1, 0);
  let active = true;
  let destroyed = false;

  // Keep references to original methods so we can restore
  const origUpdate = typeof furniturePreview.update === 'function' ? furniturePreview.update.bind(furniturePreview) : () => {};

  // Internal state for smoothing
  const targetQuat = new THREE.Quaternion();
  const tmpMat = new THREE.Matrix4();
  const tmpVec = new THREE.Vector3();
  const samplePts = [];

  function _makeSamplePoints(center, radius, count) {
    samplePts.length = 0;
    samplePts.push(center.clone());
    for (let i = 0; i < count - 1; i++) {
      const a = (i / Math.max(1, count - 1)) * Math.PI * 2;
      const r = radius * (0.4 + 0.6 * Math.random());
      samplePts.push(new THREE.Vector3(center.x + Math.cos(a) * r, center.y, center.z + Math.sin(a) * r));
    }
  }

  function _sampleGroundAt(pos) {
    // Cast from high above downwards
    const origin = new THREE.Vector3(pos.x, pos.y + 6, pos.z);
    const dir = new THREE.Vector3(0, -1, 0);
    raycaster.set(origin, dir);
    const intersects = raycaster.intersectObjects(scene.children, true);
    for (const it of intersects) {
      // ignore the preview group itself if hit
      if (group && (it.object === group || group.children.includes(it.object))) continue;
      if (it && it.point && it.face && it.face.normal) {
        // world-space normal is provided in `it.face.normal` but that is local to the geometry;
        // use the provided `it.face.normal` transformed by the object's world matrix normal transform.
        const mat = it.object.matrixWorld;
        const normalMatrix = new THREE.Matrix3().getNormalMatrix(mat);
        const worldNormal = it.face.normal.clone().applyMatrix3(normalMatrix).normalize();
        return { point: it.point.clone(), normal: worldNormal };
      }
    }
    return null;
  }

  function _computeAverage(samples) {
    if (!samples.length) return null;
    const avgN = new THREE.Vector3(0, 0, 0);
    let sumY = 0;
    let count = 0;
    for (const s of samples) {
      avgN.add(s.normal);
      sumY += s.point.y;
      count++;
    }
    if (count === 0) return null;
    avgN.normalize();
    return { normal: avgN, height: sumY / count };
  }

  function _computeTargetQuaternion(normal, preserveForward = true) {
    // Build an orthonormal basis that keeps the preview's forward-ish yaw
    // Forward in local preview space:
    const forwardLocal = new THREE.Vector3(0, 0, -1);
    // Transform forward into world space using current group quaternion
    const forwardWorld = forwardLocal.clone().applyQuaternion(group.quaternion).normalize();

    // Project forward onto plane perpendicular to normal to preserve yaw as much as possible
    const proj = forwardWorld.clone();
    const dot = proj.dot(normal);
    proj.addScaledVector(normal, -dot);
    if (proj.lengthSq() < 1e-5) {
      // forward aligned with normal; fallback to cross with X axis
      proj.set(1, 0, 0).cross(normal);
      if (proj.lengthSq() < 1e-5) {
        proj.set(0, 0, 1).cross(normal);
      }
    }
    proj.normalize();

    // Right vector
    const right = new THREE.Vector3().crossVectors(normal, proj).normalize();
    const z = proj.clone().negate(); // look-direction (pointing -Z)
    const m = tmpMat;
    m.makeBasis(right, normal.clone().normalize(), z);
    const q = new THREE.Quaternion().setFromRotationMatrix(m);
    return q;
  }

  function _clampedSlopeBlend(normal) {
    // angle between normal and world-up
    const angleRad = Math.acos(Math.max(-1, Math.min(1, normal.dot(up))));
    const angleDeg = THREE.MathUtils.radToDeg(angleRad);
    if (angleDeg <= maxSlopeDeg) return 1;
    const ramp = 12; // degrees of soft falloff after maxSlopeDeg
    if (angleDeg >= maxSlopeDeg + ramp) return 0;
    return 1 - (angleDeg - maxSlopeDeg) / ramp;
  }

  function sampleAndApply(delta) {
    if (!group || destroyed) return;
    const center = group.position.clone();
    _makeSamplePoints(center, sampleRadius, sampleCount);
    const hits = [];
    for (const p of samplePts) {
      const h = _sampleGroundAt(p);
      if (h) hits.push(h);
    }
    if (!hits.length) return; // nothing to snap to

    const avg = _computeAverage(hits);
    if (!avg) return;

    const slopeBlend = _clampedSlopeBlend(avg.normal);
    if (slopeBlend <= 0) return;

    // compute target quaternion that aligns up->avg.normal while preserving preview yaw
    const desiredQ = _computeTargetQuaternion(avg.normal);
    // Blend the influence with maxFalloff (spatial falloff multiplier)
    const influence = THREE.MathUtils.clamp(slopeBlend * Math.min(1, maxFalloff), 0, 1);

    // Smoothly slerp current towards target
    targetQuat.copy(desiredQ);
    group.quaternion.slerp(targetQuat, Math.max(0, 1 - Math.exp(-smoothing * (delta || (1 / 60)))) * influence);

    // Vertical placement: set y to the average height plus a small micro offset so it visually sits on surface
    const targetY = avg.height;
    // Smooth vertical movement
    const curY = group.position.y;
    group.position.y = THREE.MathUtils.lerp(curY, targetY, Math.max(0, 1 - Math.exp(-smoothing * (delta || (1 / 60)))) * 0.9 * influence);
  }

  // Wrap the preview.update so it continues to operate and we run our blending after.
  function wrappedUpdate(delta) {
    try {
      origUpdate(delta);
    } catch (e) {
      // ignore preview update errors
    }
    if (active) {
      try {
        sampleAndApply(delta);
      } catch (e) {
        // Protect the game loop from any unforeseen errors
        console.error('snapToSurfaceFalloff sample error', e);
      }
    }
  }

  // Replace the preview.update with our wrapped version
  furniturePreview.update = wrappedUpdate;

  return {
    setActive(v = true) {
      active = !!v;
    },
    snapNow() {
      sampleAndApply(1 / 60);
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      // restore original update method
      furniturePreview.update = origUpdate;
    }
  };
}

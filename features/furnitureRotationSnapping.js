/**
 * furnitureRotationSnapping.js
 *
 * Small helper that enables incremental rotation snapping for the furniture preview.
 * - No top-level side-effects on import.
 * - Call initFurnitureRotationSnapping(THREE, { furniturePreview, snapAngle }) to create a controller.
 *
 * Usage:
 *   const ctrl = initFurnitureRotationSnapping(THREE, { furniturePreview, snapAngle: 15 });
 *   ctrl.setActive(true);
 *
 * The controller listens for KeyR and rotates the preview by snapAngle degrees per press
 * and always keeps rotation snapped to the nearest increment.
 */

export function initFurnitureRotationSnapping(THREE, { furniturePreview, snapAngle = 15 } = {}) {
  if (!THREE) throw new Error('THREE is required');
  if (!furniturePreview) {
    return {
      setActive() {},
      snapToNearest() {}
    };
  }

  const degToRad = (d) => (d * Math.PI) / 180;
  const radToDeg = (r) => (r * 180) / Math.PI;

  const group = furniturePreview.group || null;
  let _active = false;

  function snapToNearest() {
    if (!group) return;
    const curDeg = radToDeg(group.rotation.y);
    const snapped = Math.round(curDeg / snapAngle) * snapAngle;
    group.rotation.y = degToRad(snapped);
    if (group.quaternion && typeof group.quaternion.setFromAxisAngle === 'function') {
      group.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), group.rotation.y);
    }
  }

  function rotateBy(angleDeg) {
    if (!group) return;
    const curDeg = radToDeg(group.rotation.y);
    const nextDeg = curDeg + angleDeg;
    group.rotation.y = degToRad(nextDeg);
    snapToNearest();
  }

  function _onKeyDown(e) {
    // Use KeyR to rotate by +snapAngle (matches existing UX conventions)
    if (e.code === 'KeyR') {
      // avoid interfering with typing in inputs
      const activeEl = typeof document !== 'undefined' && document.activeElement;
      if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) return;
      e.preventDefault();
      rotateBy(snapAngle);
    }
  }

  function setActive(on) {
    if (on && !_active) {
      if (typeof window !== 'undefined' && window.addEventListener) {
        window.addEventListener('keydown', _onKeyDown);
      }
      // Ensure initial snap when enabling
      try { snapToNearest(); } catch (e) {}
      _active = true;
    } else if (!on && _active) {
      if (typeof window !== 'undefined' && window.removeEventListener) {
        window.removeEventListener('keydown', _onKeyDown);
      }
      _active = false;
    }
  }

  return {
    setActive,
    snapToNearest,
    rotateBy,
    get active() { return _active; }
  };
}

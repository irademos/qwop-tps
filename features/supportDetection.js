/**
 * Small, lazy-loadable support-detection helper.
 *
 * Scans scene objects for semantic tags (mesh.userData.semanticTags array
 * or mesh.name contains common keywords) and shows subtle world-space
 * highlights for supports near the furniture preview.
 *
 * The module exports initSupportDetection(THREE, { scene, furniturePreview, maxDist })
 * which returns { update(delta), setActive(boolean), findSupports(pos) }.
 *
 * No top-level side-effects; everything is created when initSupportDetection is called.
 */

export function initSupportDetection(THREE, { scene, furniturePreview = null, maxDist = 1.5 } = {}) {
  if (!THREE) throw new Error('THREE is required');
  if (!scene) throw new Error('scene is required');

  const group = new THREE.Group();
  group.name = 'support-detection-group';
  group.userData.fai_internal = true;
  scene.add(group);

  let active = true;
  const color = 0x99ff99;
  const ringGeo = new THREE.RingGeometry(0.08, 0.12, 16);
  const ringMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide });

  function _isSupportCandidate(obj) {
    if (!obj) return false;
    const tags = obj.userData?.semanticTags;
    if (Array.isArray(tags) && tags.includes('support')) return true;
    const name = String(obj.name || '').toLowerCase();
    if (name.includes('pillar') || name.includes('post') || name.includes('rail') || name.includes('support')) return true;
    return false;
  }

  function findSupports(centerPosition = null) {
    const out = [];
    const center = centerPosition || (furniturePreview?.group?.position ? furniturePreview.group.position : null);
    scene.traverse((node) => {
      if (!node.isMesh) return;
      if (!_isSupportCandidate(node)) return;
      if (!center) {
        out.push(node);
        return;
      }
      const d = node.position.distanceTo(center);
      if (d <= maxDist) out.push(node);
    });
    return out;
  }

  function _clearMarkers() {
    for (let i = group.children.length - 1; i >= 0; i--) {
      const c = group.children[i];
      c.geometry?.dispose?.();
      c.material?.dispose?.();
      group.remove(c);
    }
  }

  function update(/*delta*/) {
    if (!active) {
      group.visible = false;
      return;
    }
    group.visible = true;
    _clearMarkers();

    const center = furniturePreview?.group?.position ? furniturePreview.group.position : null;
    const supports = findSupports(center);
    for (const s of supports) {
      // place a small ring slightly above support's base to indicate snap-support
      const ring = new THREE.Mesh(ringGeo, ringMat.clone());
      ring.renderOrder = 999;
      // position at support base (try bounding box min y)
      const bbox = new THREE.Box3().setFromObject(s);
      const baseY = bbox.min.y;
      ring.position.set(s.position.x, baseY + 0.02, s.position.z);
      ring.rotation.x = -Math.PI / 2;
      ring.userData.fai_hint = true;
      group.add(ring);
    }
  }

  function setActive(v) {
    active = Boolean(v);
    group.visible = active;
  }

  return {
    update,
    setActive,
    findSupports
  };
}

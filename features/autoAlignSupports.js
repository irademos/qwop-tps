/**
 * features/autoAlignSupports.js
 *
 * Small, lazy-loadable utility that auto-aligns the furniture preview to nearby
 * supports (pillars / rails). Exported initializer returns a tiny controller:
 *   const ctrl = initAutoAlignSupports(THREE, { scene, furniturePreview });
 *   ctrl.setActive(true);
 *
 * The module has no top-level side-effects and is safe to import lazily.
 */

export function initAutoAlignSupports(THREE, { scene, furniturePreview, maxDist = 1.5 } = {}) {
  if (!THREE) throw new Error('THREE is required');
  if (!scene) throw new Error('scene is required');

  let active = false;
  const box = new THREE.Box3();
  const center = new THREE.Vector3();
  const tmp = new THREE.Vector3();

  function computeRadiusFromBox(b) {
    const sx = b.max.x - b.min.x;
    const sz = b.max.z - b.min.z;
    return Math.max(sx, sz) / 2;
  }

  function findNearestSupport(previewPos) {
    let best = null;
    let bestDist = Infinity;

    scene.traverse(obj => {
      if (!obj.isMesh) return;
      const name = (obj.name || '').toLowerCase();
      const isSupport = obj.userData?.isSupport || name.includes('pillar') || name.includes('rail');
      if (!isSupport) return;

      box.setFromObject(obj, true);
      box.getCenter(center);
      const d = center.distanceTo(previewPos);
      if (d < bestDist && d <= maxDist) {
        bestDist = d;
        best = { obj, center: center.clone(), box: box.clone(), name };
      }
    });

    return best;
  }

  function update() {
    try {
      if (!active) return;
      if (!furniturePreview || !furniturePreview.group) return;
      const g = furniturePreview.group;

      // Preview geometry bounds
      box.setFromObject(g, true);
      const previewCenter = box.getCenter(new THREE.Vector3());
      const previewRadius = computeRadiusFromBox(box) || 0.25;

      const sup = findNearestSupport(previewCenter);
      if (!sup) return;

      // Pillar: move preview to sit beside pillar and face outward
      if (sup.name.includes('pillar') || sup.obj.userData?.supportType === 'pillar') {
        tmp.subVectors(previewCenter, sup.center);
        tmp.y = 0;
        if (tmp.lengthSq() < 1e-6) tmp.set(1, 0, 0);
        tmp.normalize();
        const supportRadius = computeRadiusFromBox(sup.box);
        const offset = supportRadius + previewRadius + 0.02;
        const target = sup.center.clone().add(tmp.multiplyScalar(offset));

        // keep preview's Y unchanged; snap X/Z and rotate to face away from pillar
        g.position.x = target.x;
        g.position.z = target.z;
        const angle = Math.atan2(target.x - sup.center.x, target.z - sup.center.z);
        g.rotation.y = angle;
        return;
      }

      // Rail: align yaw to rail's yaw and sit on top
      if (sup.name.includes('rail') || sup.obj.userData?.supportType === 'rail') {
        // align yaw and center over rail
        g.rotation.y = sup.obj.rotation.y || 0;
        const railTopY = sup.box.max.y;
        const previewHeight = box.max.y - box.min.y || 0.5;
        g.position.y = railTopY + (previewHeight / 2) + 0.02;
        g.position.x = sup.center.x;
        g.position.z = sup.center.z;
        return;
      }

    } catch (e) {
      // Non-fatal: allow the rest of the app to continue
      console.error('autoAlignSupports update error', e);
    }
  }

  return {
    setActive(v = true) { active = !!v; },
    getActive() { return active; },
    update,
    destroy() { active = false; }
  };
}

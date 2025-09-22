/**
 * Lantern soft shadow sprites
 *
 * Lightweight, cheap "soft shadows" for floating lanterns using a flat
 * transparent radial-gradient texture projected onto the ground as a
 * small plane beneath each lantern. Avoids expensive real-time shadow maps.
 *
 * Exported factory returns a controller with:
 *  - setActive(boolean)
 *  - update(delta)    // call once per-frame
 *  - destroy()
 *
 * No top-level side-effects on import.
 */

import { NoToneMapping } from "three";

export function initLanternSoftShadows(THREE, {
  scene,
  floatingLanterns = null,
  groundY = 0,
  baseSize = 0.6,
  scanInterval = 1.0 // seconds
} = {}) {
  if (!THREE) throw new Error('THREE is required');
  if (!scene) throw new Error('scene is required');

  const ctxSize = 256;
  const texture = makeShadowTexture(ctxSize);
  texture.encoding = THREE.LinearEncoding;
  texture.needsUpdate = true;

  const planeGeom = new THREE.PlaneGeometry(1, 1);
  const materialProto = new THREE.MeshBasicMaterial({
    map: texture,
    color: 0x000000,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
    // Keep shadows rendering on top of ground blends
    depthTest: true,
    side: THREE.DoubleSide,
  });

  const entries = new Map(); // lanternMesh -> { lantern, mesh }
  let enabled = true;
  let timeSinceScan = 0;

  function makeShadowMesh() {
    return new THREE.Mesh(planeGeom, materialProto.clone());
  }

  /**
   * Probe possible lantern sources:
   *  - floatingLanterns.lanterns (array)
   *  - floatingLanterns.getLanternMeshes()
   *  - scene children with name includes 'lantern' or userData.isLantern
   */
  function findLanternMeshes() {
    const found = [];
    try {
      if (floatingLanterns) {
        if (Array.isArray(floatingLanterns.lanterns)) {
          floatingLanterns.lanterns.forEach(l => { if (l && l.position) found.push(l); });
        } else if (typeof floatingLanterns.getLanternMeshes === 'function') {
          const out = floatingLanterns.getLanternMeshes();
          if (Array.isArray(out)) out.forEach(l => { if (l && l.position) found.push(l); });
        }
      }
    } catch (e) {
      // ignore
    }

    // Scene scan fallback
    scene.traverse(obj => {
      if (!obj || !obj.position) return;
      const name = (obj.name || '').toLowerCase();
      if (name.includes('lantern') || name.includes('floatinglantern') || obj.userData?.isLantern) {
        if (!found.includes(obj)) found.push(obj);
      }
    });

    return found;
  }

  function syncLanterns() {
    const lanterns = findLanternMeshes();

    // Add new
    lanterns.forEach(l => {
      if (!entries.has(l)) {
        const mesh = makeShadowMesh();
        mesh.rotation.x = -Math.PI / 2; // flat on ground
        mesh.renderOrder = 999; // try to draw after most ground geometry
        mesh.userData._softShadowFor = l.uuid;
        scene.add(mesh);
        entries.set(l, { lantern: l, mesh });
      }
    });

    // Remove orphaned
    for (const [l, item] of entries.entries()) {
      if (!l.parent || !scene) {
        scene.remove(item.mesh);
        disposeMesh(item.mesh);
        entries.delete(l);
      }
    }
  }

  function disposeMesh(m) {
    try {
      if (m.geometry) m.geometry.dispose();
      if (m.material) {
        if (m.material.map) m.material.map.dispose();
        m.material.dispose();
      }
    } catch (e) {}
  }

  function update(delta) {
    if (!enabled) return;
    // Periodic rescan to pick up newly spawned lanterns (cheap)
    timeSinceScan += delta;
    if (timeSinceScan >= scanInterval) {
      timeSinceScan = 0;
      try { syncLanterns(); } catch (e) {}
    }

    for (const { lantern, mesh } of entries.values()) {
      if (!lantern || !mesh) continue;
      const lx = lantern.position.x;
      const lz = lantern.position.z;
      const ly = lantern.position.y;

      // Position shadow on ground under lantern
      const targetY = groundY + 0.01;
      mesh.position.set(lx, targetY, lz);

      // Scale shadow according to height (higher -> larger, fainter)
      const height = Math.max(0, ly - groundY);
      const scale = baseSize * (1 + Math.min(3, height * 0.6));
      mesh.scale.set(scale, scale, 1);

      // Opacity falloff with height
      const mat = mesh.material;
      if (mat) {
        const newOpacity = Math.max(0.08, 0.9 - height * 0.18);
        mat.opacity = newOpacity;
      }

      // Keep oriented flat
      mesh.rotation.x = -Math.PI / 2;
    }
  }

  function setActive(v) {
    enabled = Boolean(v);
    for (const { mesh } of entries.values()) {
      mesh.visible = enabled;
    }
  }

  function destroy() {
    for (const { mesh } of entries.values()) {
      try { scene.remove(mesh); } catch (e) {}
      disposeMesh(mesh);
    }
    entries.clear();
    try { texture.dispose?.(); } catch (e) {}
  }

  // Initial sync
  try { syncLanterns(); } catch (e) {}

  return {
    setActive,
    update,
    destroy
  };
}

/** Create a circular radial-gradient canvas texture */
function makeShadowTexture(size = 256) {
  const cvs = typeof document !== 'undefined' ? document.createElement('canvas') : null;
  if (!cvs) {
    // fallback: create a tiny dummy texture using ImageData not available server-side
    const canvas = { width: size, height: size, toDataURL: () => '' };
    const tex = { image: canvas };
    return tex;
  }
  cvs.width = size;
  cvs.height = size;
  const ctx = cvs.getContext('2d');

  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2;

  // radial gradient: center dark, edges transparent
  const grad = ctx.createRadialGradient(cx, cy, size * 0.05, cx, cy, r);
  grad.addColorStop(0.0, 'rgba(0,0,0,0.95)');
  grad.addColorStop(0.4, 'rgba(0,0,0,0.65)');
  grad.addColorStop(0.7, 'rgba(0,0,0,0.25)');
  grad.addColorStop(1.0, 'rgba(0,0,0,0.0)');

  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  let texture = null;
  if (window.THREE) {
    texture = new window.THREE.CanvasTexture ? new window.THREE.CanvasTexture(cvs) : null;
  }
  // If THREE isn't globally available, create a plain Image texture consumer will handle
  if (texture) texture.needsUpdate = true;
  return texture || new window.Image();
}

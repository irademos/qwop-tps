import * as THREE from 'three';

const _v = new THREE.Vector3();

// A tree's trunk: its middle and radius near the ground, from the model's vertices — the
// closest ring of vertices round the base, between 0.1 and 1 m over the ground at the trunk
// (`gy`), under the leaves. (bx, bz) = the tree's placement origin. Used for the trees'
// collision (bootstrapGameApp.js → obstacles.js) and Town's chopping (townTrees.js).
export function measureTrunk(object, bx, bz, gy) {
  const pts = [];
  object.updateWorldMatrix(true, true);
  object.traverse((m) => {
    const pos = m.isMesh ? m.geometry?.attributes?.position : null;
    if (!pos) return;
    const step = Math.max(1, Math.floor(pos.count / 6000));
    for (let i = 0; i < pos.count; i += step) {
      _v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
      const h = _v.y - gy;
      if (h > 0.1 && h < 1) pts.push([_v.x, _v.z, Math.hypot(_v.x - bx, _v.z - bz)]);
    }
  });
  const out = { cx: bx, cz: bz, r: 0.25 };
  if (pts.length < 6) return out;
  pts.sort((a, b) => a[2] - b[2]);
  const near = pts.slice(0, Math.max(6, Math.floor(pts.length * 0.3)));
  out.cx = near.reduce((s, p) => s + p[0], 0) / near.length;
  out.cz = near.reduce((s, p) => s + p[1], 0) / near.length;
  const d = near.map((p) => Math.hypot(p[0] - out.cx, p[1] - out.cz)).sort((a, b) => a - b);
  out.r = THREE.MathUtils.clamp(d[Math.floor(d.length / 2)], 0.12, 0.5);
  return out;
}

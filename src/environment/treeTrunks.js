import * as THREE from 'three';

const _v = new THREE.Vector3();
const BASE_BOTTOM = 0.02; // m over the ground: the trunk's foot, from…
const BASE_TOP = 0.4;     // …to

// A tree's trunk: its middle and radius near the ground, from the model's vertices. The middle
// = the middle of its foot (the vertices up to BASE_TOP over the ground at the trunk, `gy` —
// leaves hardly ever come down that far), so a model whose trunk isn't at its origin (Tree
// Island's tree_06: ~1.3 m off it) gets it where it is; with too few there, the closest ring
// of vertices round the origin between 0.1 and 1 m up. The radius = how far that ring is from
// the middle. (bx, bz) = the tree's placement origin. Used for the trees'
// collision (bootstrapGameApp.js → obstacles.js) and Town's chopping (townTrees.js).
export function measureTrunk(object, bx, bz, gy) {
  const pts = [];
  const base = [];
  object.updateWorldMatrix(true, true);
  object.traverse((m) => {
    const pos = m.isMesh ? m.geometry?.attributes?.position : null;
    if (!pos) return;
    const step = Math.max(1, Math.floor(pos.count / 6000));
    for (let i = 0; i < pos.count; i += step) {
      _v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
      const h = _v.y - gy;
      if (h > 0.1 && h < 1) pts.push([_v.x, _v.z, Math.hypot(_v.x - bx, _v.z - bz)]);
      if (h > BASE_BOTTOM && h < BASE_TOP) base.push(_v.x, _v.z);
    }
  });
  const out = { cx: bx, cz: bz, r: 0.25 };
  if (pts.length < 6 && base.length < 12) return out;
  if (base.length >= 12) {
    let sx = 0;
    let sz = 0;
    for (let i = 0; i < base.length; i += 2) { sx += base[i]; sz += base[i + 1]; }
    out.cx = sx / (base.length / 2);
    out.cz = sz / (base.length / 2);
    for (const p of pts) p[2] = Math.hypot(p[0] - out.cx, p[1] - out.cz);
  }
  pts.sort((a, b) => a[2] - b[2]);
  const near = pts.slice(0, Math.max(6, Math.floor(pts.length * 0.3)));
  if (pts.length < 6) return out; // (the foot alone: its middle, the default radius)
  if (base.length < 12) {
    out.cx = near.reduce((s, p) => s + p[0], 0) / near.length;
    out.cz = near.reduce((s, p) => s + p[1], 0) / near.length;
  }
  const d = near.map((p) => Math.hypot(p[0] - out.cx, p[1] - out.cz)).sort((a, b) => a - b);
  out.r = THREE.MathUtils.clamp(d[Math.floor(d.length / 2)], 0.12, 0.5);
  return out;
}

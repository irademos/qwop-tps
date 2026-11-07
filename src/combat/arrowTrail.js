import * as THREE from 'three';

// Arrow trails: a short glowing streak behind every flying arrow (two crossed ribbons, so it
// reads from any side without knowing the camera), tapering and fading over TRAIL_S. Hostile
// arrows (enemies') trail red-orange, everyone else's pale gold. A trail outlives its arrow for
// a moment and fades out on its own. Driven from updateProjectiles (src/items/projectiles.js).
const TRAIL_S = 0.22;          // s a sample lasts
const TRAIL_MAX = 18;          // samples kept
const TRAIL_WIDTH = 0.07;      // m, half-width at the arrow
const TRAIL_MIN_STEP = 0.04;   // m between samples
const COLOR_OWN = new THREE.Color(0xfff0b8);
const COLOR_HOSTILE = new THREE.Color(0xff5a2a);

const _trails = [];
const _dir = new THREE.Vector3();
const _side = new THREE.Vector3();
const _up2 = new THREE.Vector3();
const _yAxis = new THREE.Vector3(0, 1, 0);
const _xAxis = new THREE.Vector3(1, 0, 0);
const _c = new THREE.Color();

// (4 vertices per sample: ribbon A = 0/1, ribbon B = 2/3)
let _index = null;
function sharedIndex() {
  if (_index) return _index;
  const idx = [];
  for (let i = 0; i < TRAIL_MAX - 1; i++) {
    const a = i * 4, b = (i + 1) * 4;
    idx.push(a, b, a + 1, a + 1, b, b + 1);
    idx.push(a + 2, b + 2, a + 3, a + 3, b + 2, b + 3);
  }
  _index = idx;
  return idx;
}

/** A trail for one arrow, in world space under `scene`. */
export function createArrowTrail(scene, hostile = false) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(TRAIL_MAX * 4 * 3);
  const col = new Float32Array(TRAIL_MAX * 4 * 3);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setIndex(sharedIndex());
  geo.setDrawRange(0, 0);
  const mat = new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  mesh.name = 'arrow-trail';
  scene.add(mesh);
  const trail = { mesh, samples: [], hostile, done: false };
  _trails.push(trail);
  return trail;
}

/** Adds the arrow's current tail point (newest first). */
export function pushArrowTrail(trail, point, hostile) {
  if (!trail || trail.done) return;
  trail.hostile = !!hostile;
  const s = trail.samples;
  if (s.length && s[0].p.distanceToSquared(point) < TRAIL_MIN_STEP * TRAIL_MIN_STEP) {
    s[0].p.copy(point); // (keep the head on the arrow)
    return;
  }
  const old = s.length >= TRAIL_MAX ? s.pop() : null;
  const sample = old ?? { p: new THREE.Vector3(), t: 0 };
  sample.p.copy(point);
  sample.t = performance.now();
  s.unshift(sample);
}

/** The arrow is gone: the trail fades out by itself. */
export function endArrowTrail(trail) {
  if (trail) trail.done = true;
}

/** Each frame: age, rebuild and drop the faded trails. */
export function updateArrowTrails() {
  const now = performance.now();
  for (let k = _trails.length - 1; k >= 0; k--) {
    const tr = _trails[k];
    const s = tr.samples;
    while (s.length && (now - s[s.length - 1].t) / 1000 > TRAIL_S) s.pop();
    if (tr.done && s.length < 2) {
      tr.mesh.parent?.remove(tr.mesh);
      tr.mesh.geometry.dispose();
      tr.mesh.material.dispose();
      _trails.splice(k, 1);
      continue;
    }
    const geo = tr.mesh.geometry;
    if (s.length < 2) { geo.setDrawRange(0, 0); continue; }
    _dir.subVectors(s[0].p, s[s.length - 1].p);
    if (_dir.lengthSq() < 1e-8) { geo.setDrawRange(0, 0); continue; }
    _dir.normalize();
    _side.crossVectors(_dir, _yAxis);
    if (_side.lengthSq() < 1e-6) _side.crossVectors(_dir, _xAxis);
    _side.normalize();
    _up2.crossVectors(_side, _dir).normalize();
    const base = tr.hostile ? COLOR_HOSTILE : COLOR_OWN;
    const pos = geo.attributes.position.array;
    const col = geo.attributes.color.array;
    for (let i = 0; i < s.length; i++) {
      const life = Math.max(0, 1 - (now - s[i].t) / 1000 / TRAIL_S);
      const along = 1 - i / (s.length - 1);   // 1 at the arrow, 0 at the end
      const w = TRAIL_WIDTH * (0.25 + 0.75 * along) * life;
      const f = life * (0.35 + 0.65 * along);
      _c.copy(base).multiplyScalar(f);
      const p = s[i].p;
      const o = i * 12;
      pos[o] = p.x + _side.x * w; pos[o + 1] = p.y + _side.y * w; pos[o + 2] = p.z + _side.z * w;
      pos[o + 3] = p.x - _side.x * w; pos[o + 4] = p.y - _side.y * w; pos[o + 5] = p.z - _side.z * w;
      pos[o + 6] = p.x + _up2.x * w; pos[o + 7] = p.y + _up2.y * w; pos[o + 8] = p.z + _up2.z * w;
      pos[o + 9] = p.x - _up2.x * w; pos[o + 10] = p.y - _up2.y * w; pos[o + 11] = p.z - _up2.z * w;
      for (let v = 0; v < 4; v++) {
        col[o + v * 3] = _c.r; col[o + v * 3 + 1] = _c.g; col[o + v * 3 + 2] = _c.b;
      }
    }
    geo.attributes.position.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
    geo.setDrawRange(0, (s.length - 1) * 12);
  }
}

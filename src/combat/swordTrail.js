import * as THREE from 'three';

// Sword swing trail: a glowing ribbon behind the player's blade on swings, like the arrows'
// (arrowTrail.js) — one strip between a point down the blade and its tip, sampled each frame
// while the tip moves fast, each sample fading over TRAIL_S (the ribbon outlives the swing for
// a moment and fades out by itself). `ready` (a combo attack charged — swordCombo.js) turns it
// gold. Driven from the phone-sword loop in bootstrapGameApp.js: update(base, tip, fast, ready)
// each frame the sword is out, update(null) otherwise.
const TRAIL_S = 0.2;            // s a sample lasts
const TRAIL_MAX = 24;           // samples kept
const TRAIL_MIN_STEP = 0.025;   // m the tip must move between samples
const COLOR = new THREE.Color(0xdff4ff);
const COLOR_READY = new THREE.Color(0xffc23a);

export function createSwordTrail(scene) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(TRAIL_MAX * 2 * 3);
  const col = new Float32Array(TRAIL_MAX * 2 * 3);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage));
  const idx = [];
  for (let i = 0; i < TRAIL_MAX - 1; i++) {
    const a = i * 2, b = (i + 1) * 2;
    idx.push(a, b, a + 1, a + 1, b, b + 1);
  }
  geo.setIndex(idx);
  geo.setDrawRange(0, 0);
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false,
  }));
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  mesh.name = 'sword-trail';
  scene.add(mesh);

  const samples = []; // newest first: { b, t: tip, at, ready }
  const _c = new THREE.Color();

  const update = (base, tip, fast = false, ready = false) => {
    const now = performance.now();
    if (base && tip && fast) {
      const s0 = samples[0];
      if (!s0 || s0.t.distanceToSquared(tip) >= TRAIL_MIN_STEP * TRAIL_MIN_STEP) {
        const s = samples.length >= TRAIL_MAX ? samples.pop() : { b: new THREE.Vector3(), t: new THREE.Vector3() };
        s.b.copy(base); s.t.copy(tip); s.at = now; s.ready = ready;
        samples.unshift(s);
      }
    }
    while (samples.length && (now - samples[samples.length - 1].at) / 1000 > TRAIL_S) samples.pop();
    if (samples.length < 2) { geo.setDrawRange(0, 0); return; }
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i];
      const life = Math.max(0, 1 - (now - s.at) / 1000 / TRAIL_S);
      const along = 1 - i / (samples.length - 1); // 1 at the blade, 0 at the tail
      const f = life * (0.25 + 0.75 * along);
      const o = i * 6;
      // (the inner edge pulled toward the tip as it fades: the ribbon tapers to a point)
      const k = 1 - life * 0.9 - 0.1;
      pos[o] = s.t.x; pos[o + 1] = s.t.y; pos[o + 2] = s.t.z;
      pos[o + 3] = s.b.x + (s.t.x - s.b.x) * k;
      pos[o + 4] = s.b.y + (s.t.y - s.b.y) * k;
      pos[o + 5] = s.b.z + (s.t.z - s.b.z) * k;
      _c.copy(s.ready ? COLOR_READY : COLOR).multiplyScalar(f * 0.85);
      col[o] = _c.r; col[o + 1] = _c.g; col[o + 2] = _c.b;
      _c.multiplyScalar(0.15); // (dim at the inner edge — a soft edge toward the hilt)
      col[o + 3] = _c.r; col[o + 4] = _c.g; col[o + 5] = _c.b;
    }
    geo.attributes.position.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
    geo.setDrawRange(0, (samples.length - 1) * 6);
  };

  const clear = () => { samples.length = 0; geo.setDrawRange(0, 0); };

  return { update, clear, mesh };
}

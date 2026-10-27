import * as THREE from 'three';

// Water splashes for the canoe's oar (canoeBoat.js): drops thrown up out of the water (pooled in
// one InstancedMesh, falling under gravity, gone when they drop back under the surface) and
// rings spreading out on the surface. In world space — added to whatever holds the canoe.

const MAX_DROPS = 160;
const MAX_RINGS = 10;
const GRAVITY = 9.8;
const DROP_LIFE_S = 1.2;
const RING_LIFE_S = 0.9;
const RING_GROW = 1.6;        // m of radius gained over its life
const DROP_COLOR = 0xeaf6ff;
const RING_COLOR = 0xf2fbff;

export function createWaterSplash() {
  const group = new THREE.Group();
  group.name = 'water-splash';

  const dropGeo = new THREE.SphereGeometry(1, 6, 4);
  const dropMat = new THREE.MeshBasicMaterial({ color: DROP_COLOR, transparent: true, opacity: 0.85, depthWrite: false });
  const dropMesh = new THREE.InstancedMesh(dropGeo, dropMat, MAX_DROPS);
  dropMesh.frustumCulled = false;
  dropMesh.count = 0;
  dropMesh.renderOrder = 2;
  group.add(dropMesh);
  const drops = []; // { x, y, z, vx, vy, vz, r, age, floor }

  const ringGeo = new THREE.RingGeometry(0.7, 1, 24).rotateX(-Math.PI / 2);
  const rings = [];
  for (let i = 0; i < MAX_RINGS; i++) {
    const mat = new THREE.MeshBasicMaterial({ color: RING_COLOR, transparent: true, opacity: 0, depthWrite: false });
    const mesh = new THREE.Mesh(ringGeo, mat);
    mesh.visible = false;
    mesh.renderOrder = 2;
    group.add(mesh);
    rings.push({ mesh, age: RING_LIFE_S, size: 0.2 });
  }
  let nextRing = 0;

  const _m = new THREE.Matrix4();
  const _q = new THREE.Quaternion();
  const _s = new THREE.Vector3();
  const _p = new THREE.Vector3();

  // n drops from (x, y, z) on the surface y = floor, thrown along (dx, dz) at about `speed` m/s
  // and up at about `up` m/s, `spread` of it random
  const drops_ = ({ x, y, z, floor = y, n = 8, dx = 0, dz = 0, speed = 1, up = 2, spread = 0.6 }) => {
    for (let i = 0; i < n; i++) {
      if (drops.length >= MAX_DROPS) drops.shift();
      const r = (Math.random() - 0.5) * 2;
      const s = speed * (0.5 + Math.random() * 0.8);
      drops.push({
        x: x + (Math.random() - 0.5) * 0.12,
        y,
        z: z + (Math.random() - 0.5) * 0.12,
        vx: dx * s + (Math.random() - 0.5) * spread * 2 + r * dz * spread,
        vy: up * (0.6 + Math.random() * 0.7),
        vz: dz * s + (Math.random() - 0.5) * spread * 2 - r * dx * spread,
        r: 0.018 + Math.random() * 0.03,
        age: 0,
        floor,
      });
    }
  };
  const ring = (x, y, z, size = 0.2) => {
    const g = rings[nextRing];
    nextRing = (nextRing + 1) % MAX_RINGS;
    g.age = 0;
    g.size = size;
    g.mesh.position.set(x, y + 0.01, z);
    g.mesh.visible = true;
  };

  const update = (dt) => {
    let n = 0;
    for (let i = drops.length - 1; i >= 0; i--) {
      const d = drops[i];
      d.age += dt;
      d.vy -= GRAVITY * dt;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      d.z += d.vz * dt;
      if (d.age > DROP_LIFE_S || (d.vy < 0 && d.y < d.floor)) { drops.splice(i, 1); }
    }
    for (const d of drops) {
      const k = 1 - d.age / DROP_LIFE_S;
      _s.setScalar(d.r * (0.5 + 0.5 * k));
      _m.compose(_p.set(d.x, d.y, d.z), _q, _s);
      dropMesh.setMatrixAt(n++, _m);
    }
    dropMesh.count = n;
    dropMesh.instanceMatrix.needsUpdate = true;
    for (const g of rings) {
      if (!g.mesh.visible) continue;
      g.age += dt;
      const t = g.age / RING_LIFE_S;
      if (t >= 1) { g.mesh.visible = false; continue; }
      g.mesh.scale.setScalar(g.size + RING_GROW * Math.sqrt(t) * (0.5 + g.size));
      g.mesh.material.opacity = 0.55 * (1 - t);
    }
  };

  const clear = () => {
    drops.length = 0;
    dropMesh.count = 0;
    for (const g of rings) g.mesh.visible = false;
  };

  const dispose = () => {
    group.parent?.remove(group);
    dropGeo.dispose();
    dropMat.dispose();
    ringGeo.dispose();
    for (const g of rings) g.mesh.material.dispose();
  };

  return { group, drops: drops_, ring, update, clear, dispose };
}

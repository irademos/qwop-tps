// A destroyed building: a low heap of dirt with logs (the felled trees' logs — src/items/woodLog.js)
// thrown across it, a few stones and broken planks. Stands in for a building that's been torn
// down — Town's wizard's cabin after the bandits' revenge (townRuins.js); the look for any home
// / cabin / building destroyed later.
//
// createRuin({ radius, groundAt, x, z, seed }) → { group, obstacles: [{ x, z, r, y0, y1 }] }
//   radius: the building's footprint (its bounds' half size, m); groundAt(x, z): the ground
//   there (the heap follows it — the group sits at (x, groundAt(x, z), z)); seed: the same heap
//   every time for the same building

import * as THREE from 'three';
import { createWoodLog } from '../items/woodLog.js';

const DIRT_COLOR = 0x6b4a2f;
const DIRT_DARK = 0x54391f;
const STONE_COLOR = 0x85807a;
const PLANK_COLOR = 0x8a6239;
const HEAP_HEIGHT = 0.75;     // m, the heap's top over the ground at its middle
const HEAP_SHARE = 0.72;      // of the footprint the heap covers
const LOGS = 13;
const STONES = 7;
const PLANKS = 6;

// A small seeded random (mulberry32)
const rng = (seed) => {
  let a = (seed >>> 0) || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
export const ruinSeed = (str) => {
  let h = 2166136261;
  for (const ch of String(str)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
};

let dirtMat = null;
let dirtDarkMat = null;
let stoneMat = null;
let plankMat = null;
const mats = () => {
  if (!dirtMat) {
    dirtMat = new THREE.MeshStandardMaterial({ color: DIRT_COLOR, roughness: 1, flatShading: true });
    dirtDarkMat = new THREE.MeshStandardMaterial({ color: DIRT_DARK, roughness: 1, flatShading: true });
    stoneMat = new THREE.MeshStandardMaterial({ color: STONE_COLOR, roughness: 1, flatShading: true });
    plankMat = new THREE.MeshStandardMaterial({ color: PLANK_COLOR, roughness: 1 });
  }
};

// A lumpy dome of dirt: a half sphere, its rim pressed into the ground, bumps on its top
const heapGeometry = (rand) => {
  const geo = new THREE.SphereGeometry(1, 22, 9, 0, Math.PI * 2, 0, Math.PI / 2);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const a = Math.atan2(v.z, v.x);
    const k = 1 + 0.16 * Math.sin(a * 3 + rand() * 0.3) + 0.1 * Math.sin(a * 5 + 1.3) + (rand() - 0.5) * 0.12;
    v.x *= k;
    v.z *= k;
    v.y = v.y > 0.02 ? v.y * (0.85 + rand() * 0.35) : -0.15; // (the rim sunk a little)
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return geo;
};

export function createRuin({ radius = 3, groundAt = () => 0, x = 0, z = 0, seed = 1 } = {}) {
  mats();
  const rand = rng(seed);
  const group = new THREE.Group();
  group.name = 'ruin';
  const baseY = groundAt(x, z);
  group.position.set(x, baseY, z);
  const R = Math.max(1.2, radius * HEAP_SHARE);
  // (the ground at a spot round the middle, relative to the middle's)
  const yAt = (dx, dz) => {
    const g = groundAt(x + dx, z + dz);
    return Number.isFinite(g) ? g - baseY : 0;
  };
  const tilt = Math.atan2(yAt(R, 0) - yAt(-R, 0), 2 * R);
  const tiltZ = Math.atan2(yAt(0, R) - yAt(0, -R), 2 * R);

  // The heap (and two smaller ones off its sides) — tipped with the slope under it
  const heaps = [[0, 0, R, HEAP_HEIGHT, dirtMat]];
  for (let k = 0; k < 2; k++) {
    const a = rand() * Math.PI * 2;
    heaps.push([Math.cos(a) * R * 0.85, Math.sin(a) * R * 0.85, R * (0.35 + rand() * 0.15), HEAP_HEIGHT * 0.55, k ? dirtDarkMat : dirtMat]);
  }
  for (const [hx, hz, hr, hh, mat] of heaps) {
    const m = new THREE.Mesh(heapGeometry(rand), mat);
    m.scale.set(hr, hh, hr * (0.8 + rand() * 0.3));
    m.position.set(hx, yAt(hx, hz), hz);
    m.rotation.set(tiltZ, rand() * Math.PI * 2, -tilt, 'YXZ');
    m.receiveShadow = true;
    m.castShadow = true;
    group.add(m);
  }
  // The heap's height over its middle at (dx, dz): 0 past its rim
  const heapTop = (dx, dz) => {
    const d = Math.hypot(dx, dz) / R;
    return d >= 1 ? 0 : HEAP_HEIGHT * Math.sqrt(1 - d * d) * 0.85;
  };

  // The logs: lying across the heap every which way, some propped up on the others
  for (let i = 0; i < LOGS; i++) {
    const a = rand() * Math.PI * 2;
    const d = Math.sqrt(rand()) * R * 0.95;
    const lx = Math.cos(a) * d;
    const lz = Math.sin(a) * d;
    const r = 0.13 + rand() * 0.08;
    const len = 1.1 + rand() * 1.4;
    const log = createWoodLog(r, len);
    const yaw = rand() * Math.PI;
    const lean = i < 3 ? 0.5 + rand() * 0.5 : (rand() - 0.5) * 0.35; // (the first few propped up)
    const dir = new THREE.Vector3(Math.cos(yaw) * Math.cos(lean), Math.sin(lean), Math.sin(yaw) * Math.cos(lean));
    log.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    log.position.set(lx, yAt(lx, lz) + heapTop(lx, lz) + r * 0.7 + Math.abs(dir.y) * len * 0.35, lz);
    group.add(log);
  }
  // Broken planks (what's left of the walls) and stones (the hearth)
  for (let i = 0; i < PLANKS; i++) {
    const a = rand() * Math.PI * 2;
    const d = R * (0.55 + rand() * 0.6);
    const px = Math.cos(a) * d;
    const pz = Math.sin(a) * d;
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.05, 0.7 + rand() * 0.9), plankMat);
    p.position.set(px, yAt(px, pz) + heapTop(px, pz) + 0.05, pz);
    p.rotation.set((rand() - 0.5) * 0.5, rand() * Math.PI, (rand() - 0.5) * 0.4);
    p.castShadow = true;
    group.add(p);
  }
  for (let i = 0; i < STONES; i++) {
    const a = rand() * Math.PI * 2;
    const d = R * (0.3 + rand() * 0.85);
    const sx = Math.cos(a) * d;
    const sz = Math.sin(a) * d;
    const s = 0.12 + rand() * 0.18;
    const m = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), stoneMat);
    m.scale.y = 0.7;
    m.position.set(sx, yAt(sx, sz) + heapTop(sx, sz) + s * 0.4, sz);
    m.rotation.set(rand() * 3, rand() * 3, rand() * 3);
    m.castShadow = true;
    group.add(m);
  }
  group.traverse((o) => { if (o.isMesh) o.userData.ruin = true; });
  // (solid where the heap stands high — walked round, like a tree's trunk)
  const obstacles = [{ x, z, r: R * 0.6, y0: baseY - 1, y1: baseY + 2 }];
  return { group, obstacles };
}

// The ruin's geometries freed (the materials are shared — kept)
export const disposeRuin = (group) => {
  group?.removeFromParent();
  group?.traverse((o) => { if (o.isMesh && o.geometry && o.geometry.type !== 'CylinderGeometry') o.geometry.dispose(); });
};

// Story mode's props: the stone he stands on, the rod leaning in the canoe, the canoe's hole,
// the driftwood logs, a glint to catch the eye, the ♪ off the flute. Models only — storyMode.js
// decides when they're there.
import * as THREE from 'three';
import { createFishingRodModel } from '../items/fishingRod.js';
import { CANOE_FLOOR_Y, CANOE_HALF_LENGTH, CANOE_HALF_WIDTH } from '../items/canoe.js';
import { makeTextSprite } from '../village/villageMode.js';
import { SEAT_RADIUS, SEAT_TOP } from './storyLayout.js';

const disposeTree = (o) => o?.traverse((m) => {
  m.geometry?.dispose?.();
  for (const mat of [m.material].flat()) if (mat && !mat.map?.userData?.shared) mat.dispose();
});
export const removeProp = (o) => { if (!o) return null; o.parent?.remove(o); disposeTree(o); return null; };

// ── The stone: a low lumpy rock (its top is ground — storyMode.js) ──
export function makeSeatStone() {
  const geo = new THREE.DodecahedronGeometry(1, 1);
  // (lumpy: each vertex pushed in / out a little, the same for shared corners)
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = Math.sin(v.x * 5.1 + v.z * 3.7) * 0.5 + Math.cos(v.y * 4.3 - v.x * 2.9) * 0.5;
    v.multiplyScalar(1 + n * 0.08);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x8d8a80, roughness: 0.95, flatShading: true }));
  mesh.name = 'story-seat';
  mesh.scale.set(SEAT_RADIUS, SEAT_TOP * 1.4, SEAT_RADIUS * 0.85);
  mesh.rotation.y = 0.7;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

// ── A glint: an additive sprite that pulses (pulseGlint) ──
let glintTex = null;
export function makeGlint(y = 0.15) {
  if (!glintTex) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,250,220,1)');
    grad.addColorStop(0.3, 'rgba(255,240,180,0.5)');
    grad.addColorStop(1, 'rgba(255,240,180,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    glintTex = new THREE.CanvasTexture(c);
    glintTex.colorSpace = THREE.SRGBColorSpace;
    glintTex.userData.shared = true;
  }
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glintTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  s.name = 'glint';
  s.position.y = y;
  return s;
}
export function pulseGlint(obj, t) {
  const g = obj?.getObjectByName('glint');
  if (!g) return;
  const k = 0.5 + 0.5 * Math.sin(t * 2.4);
  g.material.opacity = 0.25 + k * 0.6;
  g.scale.setScalar(0.25 + k * 0.2);
}

// ── The rod, leaning in the canoe: its butt on the floor near the stern, propped on the
// gunwale toward the bow, the tip up over the side. In the canoe group's frame (bow = +Z) ──
export function makeLeaningRod() {
  const g = new THREE.Group();
  g.name = 'story-rod';
  const rod = createFishingRodModel();
  // (the model runs along +Z from its grip, its butt a little behind it: the butt put at the
  // pivot, on the floor by the stern; tipped up to rest on the middle thwart, the tip over the bow)
  const box = new THREE.Box3().setFromObject(rod);
  rod.position.z = -box.min.z;
  const pivot = new THREE.Group();
  pivot.add(rod);
  pivot.rotation.set(-0.24, 0.12, 0.08, 'YXZ');
  pivot.position.set(-CANOE_HALF_WIDTH * 0.25, CANOE_FLOOR_Y + 0.03, -CANOE_HALF_LENGTH * 0.72);
  g.add(pivot);
  const glint = makeGlint(0);
  glint.position.set(0, CANOE_FLOOR_Y + 0.5, -CANOE_HALF_LENGTH * 0.2);
  g.add(glint);
  return g;
}

// ── The canoe's hole: a dark ragged patch on its side and splintered planks, in its frame ──
export function makeCanoeDamage() {
  const g = new THREE.Group();
  g.name = 'story-canoe-hole';
  const hole = new THREE.Mesh(
    new THREE.CircleGeometry(0.2, 7),
    new THREE.MeshStandardMaterial({ color: 0x1b130c, roughness: 1, side: THREE.DoubleSide }),
  );
  hole.scale.set(1.4, 0.45, 1);
  for (const s of [1, -1]) {
    const h = hole.clone();
    h.position.set(s * CANOE_HALF_WIDTH * 0.97, 0.17, 0.35 * s);
    h.rotation.y = s * Math.PI / 2;
    g.add(h);
  }
  const wood = new THREE.MeshStandardMaterial({ color: 0x8a6036, roughness: 0.9, flatShading: true });
  for (let i = 0; i < 4; i++) {
    const sp = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.02, 0.22 + i * 0.05), wood);
    sp.position.set(CANOE_HALF_WIDTH * 0.9, 0.2 + i * 0.015, 0.25 + i * 0.07);
    sp.rotation.set(0.4 - i * 0.25, 0.3 * i, 0.5);
    g.add(sp);
  }
  return g;
}

// ── A driftwood log: a weathered trunk lying on the sand with a couple of stubs. Its origin
// on the ground, along its local Z ──
export const LOG_LENGTH = 1.9;
export function makeLog() {
  const g = new THREE.Group();
  g.name = 'story-log';
  const bark = new THREE.MeshStandardMaterial({ color: 0x9a8a72, roughness: 1, flatShading: true });
  const end = new THREE.MeshStandardMaterial({ color: 0xcdb48c, roughness: 1, flatShading: true });
  const r = 0.17;
  const body = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.85, r, LOG_LENGTH, 8, 1), [bark, end, end]);
  body.rotation.x = Math.PI / 2;
  body.position.y = r * 0.85;
  body.castShadow = true;
  body.receiveShadow = true;
  g.add(body);
  for (const [z, a] of [[0.35, 0.6], [-0.5, -0.9]]) {
    const stub = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 0.32, 5), bark);
    stub.position.set(Math.sin(a) * r, r + Math.cos(a) * r * 0.6, z);
    stub.rotation.z = -a;
    stub.castShadow = true;
    g.add(stub);
  }
  g.userData.radius = r;
  return g;
}
// The log cut through: two halves falling apart, a few chips — the pieces fly / fade (updateCut)
export function splitLog(log, scene) {
  const pieces = [];
  const r = log.userData.radius ?? 0.17;
  const wood = new THREE.MeshStandardMaterial({ color: 0xcdb48c, roughness: 1, flatShading: true, transparent: true });
  for (const s of [-1, 1]) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.9, r * 0.9, LOG_LENGTH / 2, 7), wood);
    m.rotation.x = Math.PI / 2;
    const p = new THREE.Group();
    p.add(m);
    p.position.copy(log.localToWorld(new THREE.Vector3(0, r * 0.85, s * LOG_LENGTH / 4)));
    p.quaternion.copy(log.quaternion);
    p.userData.v = log.localToWorld(new THREE.Vector3(s * 0.3, 0, s * 1.2)).sub(log.position).setY(1.4);
    p.userData.spin = s * 3;
    scene.add(p);
    pieces.push(p);
  }
  for (let i = 0; i < 7; i++) {
    const c = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.02, 0.07), wood);
    c.position.copy(log.position).setY(log.position.y + r);
    c.userData.v = new THREE.Vector3((Math.random() - 0.5) * 3, 1.5 + Math.random() * 2, (Math.random() - 0.5) * 3);
    c.userData.spin = (Math.random() - 0.5) * 12;
    scene.add(c);
    pieces.push(c);
  }
  return { pieces, t: 0, groundY: log.position.y, material: wood };
}
// (true when it's over)
export function updateSplit(sp, dt) {
  sp.t += dt;
  for (const p of sp.pieces) {
    p.userData.v.y -= 9.8 * dt;
    p.position.addScaledVector(p.userData.v, dt);
    if (p.position.y < sp.groundY + 0.03) { p.position.y = sp.groundY + 0.03; p.userData.v.multiplyScalar(0.3); p.userData.spin *= 0.5; }
    p.rotation.y += p.userData.spin * dt;
  }
  sp.material.opacity = Math.max(0, 1 - Math.max(0, sp.t - 1) / 0.8);
  if (sp.t < 1.8) return false;
  for (const p of sp.pieces) { p.parent?.remove(p); p.traverse((m) => m.geometry?.dispose?.()); }
  sp.material.dispose();
  return true;
}

// ── ♪ off the flute ──
export function makeNote() {
  return makeTextSprite(Math.random() < 0.5 ? '♪' : '♫', { height: 0.16, bg: 'rgba(0,0,0,0)', border: 'rgba(0,0,0,0)', color: '#fff6d8' });
}

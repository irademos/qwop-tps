import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { stylizeObject } from '../environment/artStyle.js';

// The bow and its arrows — the game's ranged weapon (it took the gun's place: the item id is
// still 'pistol', its ammo 'gun bullets', so saves / the shop / the net are unchanged).
//
// bow.glb ("Simple Low Poly Bow" by mrpeanut, CC BY 4.0 — credits.json), in its scene units:
// the limbs run along Y (tips at ±1001, the string tied at ±964), it shoots toward +Z, the
// riser's middle (the grip) is at (−2, 0, 10.6) and the string straight across at z −293.
// The model's own string is dropped: ours is two thin pieces from the tips to the nock, so
// it can be drawn back (setBowDraw).
//
// arrow.glb ("Arrow - Medieval Fantasy Challenge" by tuturu, CC BY 4.0): along Y, its head
// at y −0.059, the fletching's end (the nock) at y 0.577.
//
// createBowMesh(): a group whose origin is the grip, shooting along +Z, limbs along Y.
// createArrowMesh(): a group whose origin is the arrow's TIP, the shaft along −Z (so a flying
// arrow's position is where it hits).
export const BOW_MODEL_URL = '/assets/props/bow.glb?v=1';
export const ARROW_MODEL_URL = '/assets/props/arrow.glb?v=1';
export const BOW_LENGTH = 0.78;            // m, tip to tip
export const ARROW_LENGTH = 0.52;          // m, tip to nock
const MODEL_BOW_LENGTH = 2002;
const MODEL_GRIP = new THREE.Vector3(-2, 0, 10.6);
const MODEL_STRING_Z = -293.4;
const MODEL_STRING_TIP_Y = 963.7;
const MODEL_ARROW_TIP_Y = -0.0594;
const MODEL_ARROW_NOCK_Y = 0.5766;
const BOW_SCALE = BOW_LENGTH / MODEL_BOW_LENGTH;
const STRING_TIP_Y = MODEL_STRING_TIP_Y * BOW_SCALE;
/** m from the grip back to the string at rest */
export const BOW_STRING_REST = (MODEL_GRIP.z - MODEL_STRING_Z) * BOW_SCALE;
/** m the string comes back past its rest at full draw */
export const BOW_DRAW_PULL = 0.3;
const STRING_RADIUS = 0.0035;
const STRING_COLOR = 0xeadfc4;
// The limbs bend in a little as it's drawn (the string's ends come forward / together)
const TIP_FLEX_Z = 0.035;
const TIP_FLEX_Y = 0.02;

let bowTemplate = null;
let arrowTemplate = null;
let loadPromise = null;

const prepare = (root) => {
  stylizeObject(root, { materials: false });
  root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return root;
};

/** Loads bow.glb + arrow.glb once (meshes made before it fills in when it's done). */
export function loadBowAssets() {
  if (!loadPromise) {
    const loader = new GLTFLoader();
    loadPromise = Promise.all([
      loader.loadAsync(BOW_MODEL_URL).then((gltf) => {
        const root = gltf.scene;
        // (our own string replaces the model's)
        const strings = [];
        root.traverse((o) => { if (o.isMesh && /string/i.test(o.name)) strings.push(o); });
        strings.forEach((o) => o.parent?.remove(o));
        bowTemplate = prepare(root);
      }).catch((error) => console.warn('Failed to load the bow.', error)),
      loader.loadAsync(ARROW_MODEL_URL).then((gltf) => {
        arrowTemplate = prepare(gltf.scene);
      }).catch((error) => console.warn('Failed to load the arrow.', error)),
    ]).then(() => !!bowTemplate);
  }
  return loadPromise;
}

// ── Arrow ──────────────────────────────────────────────────────────────────────
const arrowScale = ARROW_LENGTH / (MODEL_ARROW_NOCK_Y - MODEL_ARROW_TIP_Y);
const fallbackArrow = () => {
  const g = new THREE.Group();
  const shaft = new THREE.Mesh(
    new THREE.CylinderGeometry(0.006, 0.006, ARROW_LENGTH * 0.92, 5).rotateX(Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x8a6a45, roughness: 1 })
  );
  shaft.position.z = -ARROW_LENGTH * 0.46 - ARROW_LENGTH * 0.08;
  const head = new THREE.Mesh(
    new THREE.ConeGeometry(0.014, ARROW_LENGTH * 0.08, 5).rotateX(Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x777777, roughness: 0.8 })
  );
  head.position.z = -ARROW_LENGTH * 0.04;
  g.add(shaft, head);
  return g;
};

/**
 * An arrow: origin at its tip, the shaft back along −Z. `own` gives it its own geometry /
 * materials (a flying arrow — disposed when it's gone), else it shares the template's.
 */
export function createArrowMesh({ own = true } = {}) {
  const group = new THREE.Group();
  group.name = 'arrow';
  const fill = () => {
    let model;
    if (arrowTemplate) {
      model = arrowTemplate.clone(true);
      // −Y (the head) → +Z, then the tip to the origin
      model.rotation.x = -Math.PI / 2;
      model.scale.setScalar(arrowScale);
      model.position.z = MODEL_ARROW_TIP_Y * arrowScale;
      if (own) {
        model.traverse((o) => {
          if (!o.isMesh) return;
          o.geometry = o.geometry.clone();
          o.material = Array.isArray(o.material) ? o.material.map((m) => m.clone()) : o.material.clone();
        });
      }
    } else {
      model = fallbackArrow();
    }
    model.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    group.add(model);
  };
  fill();
  // (made before arrow.glb was in: swapped for it once it is — not for a flying one)
  if (!arrowTemplate && !own) {
    loadBowAssets().then(() => {
      if (!arrowTemplate) return;
      group.clear();
      fill();
    });
  }
  return group;
}

// ── Bow ────────────────────────────────────────────────────────────────────────
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _tip = new THREE.Vector3();
const _yAxis = new THREE.Vector3(0, 1, 0);

const stringPiece = (name) => {
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(STRING_RADIUS, STRING_RADIUS, 1, 4, 1),
    new THREE.MeshStandardMaterial({ color: STRING_COLOR, roughness: 0.9 })
  );
  mesh.name = name;
  mesh.castShadow = false;
  return mesh;
};
// A unit-length cylinder (along Y) stretched from a to b
const poseBetween = (mesh, a, b) => {
  _b.subVectors(b, a);
  const len = _b.length();
  mesh.position.addVectors(a, b).multiplyScalar(0.5);
  mesh.scale.set(1, Math.max(1e-4, len), 1);
  if (len > 1e-6) mesh.quaternion.setFromUnitVectors(_yAxis, _b.divideScalar(len));
};

// Before bow.glb is in: a plain wooden arc
const fallbackBody = () => {
  const half = STRING_TIP_Y;
  const depth = BOW_STRING_REST;
  // circle through the tips (0, ±half, −depth) and the grip (0, 0, 0)
  const r = (half * half + depth * depth) / (2 * depth);
  const arc = 2 * Math.asin(Math.min(1, half / r));
  const geo = new THREE.TorusGeometry(r, 0.012, 5, 18, arc);
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x7a5230, roughness: 1 }));
  // the torus lies in its XY plane from angle 0 (+X): +X → +Z (the arc's middle at the
  // grip), its centre r behind it
  mesh.rotation.set(0, -Math.PI / 2, 0);
  mesh.rotateZ(-arc / 2);
  mesh.position.z = -r;
  mesh.name = 'bow-fallback';
  return mesh;
};

const partsCache = new WeakMap();
const partsOf = (group) => {
  let p = partsCache.get(group);
  if (!p) {
    p = {
      top: group.getObjectByName('bow-string-top'),
      bottom: group.getObjectByName('bow-string-bottom'),
      arrow: group.getObjectByName('bow-arrow'),
      draw: -1,
    };
    partsCache.set(group, p);
  }
  return p;
};

/**
 * The bow (origin at the grip, shooting +Z). setBowDraw(group, draw) pulls its string back;
 * clones (Object3D.clone) keep working, the parts are found by name.
 */
export function createBowMesh() {
  const group = new THREE.Group();
  group.name = 'bow';
  const body = new THREE.Group();
  body.name = 'bow-body';
  group.add(body);
  const fill = () => {
    if (!bowTemplate) { body.add(fallbackBody()); return false; }
    const model = bowTemplate.clone(true);
    model.scale.setScalar(BOW_SCALE);
    model.position.copy(MODEL_GRIP).multiplyScalar(-BOW_SCALE);
    body.add(model);
    return true;
  };
  if (!fill()) {
    loadBowAssets().then(() => {
      if (!bowTemplate) return;
      body.clear();
      fill();
    });
  }
  group.add(stringPiece('bow-string-top'), stringPiece('bow-string-bottom'));
  const arrow = createArrowMesh({ own: false });
  arrow.name = 'bow-arrow';
  arrow.visible = false;
  group.add(arrow);
  setBowDraw(group, 0, false);
  return group;
}

/** How far the nock sits behind the grip at `draw` (0 … 1) */
export const bowNockZ = (draw) => -(BOW_STRING_REST + THREE.MathUtils.clamp(draw, 0, 1) * BOW_DRAW_PULL);

/** Pulls the string back to `draw` (0 rest … 1 full) with an arrow on it if `arrow`. */
export function setBowDraw(group, draw = 0, arrow = draw > 0) {
  if (!group) return;
  const p = partsOf(group);
  draw = THREE.MathUtils.clamp(draw, 0, 1);
  if (p.arrow) p.arrow.visible = !!arrow;
  if (Math.abs(p.draw - draw) < 1e-4) return;
  p.draw = draw;
  const nockZ = bowNockZ(draw);
  const tipZ = -BOW_STRING_REST + draw * TIP_FLEX_Z;
  const tipY = STRING_TIP_Y - draw * TIP_FLEX_Y;
  _a.set(0, 0, nockZ);
  if (p.top) poseBetween(p.top, _tip.set(0, tipY, tipZ), _a);
  if (p.bottom) poseBetween(p.bottom, _tip.set(0, -tipY, tipZ), _a);
  if (p.arrow) p.arrow.position.set(0, 0, nockZ + ARROW_LENGTH);
}

/** World position of the nocked arrow's tip at `draw` (where a loosed arrow starts). */
export function bowArrowTipWorld(group, draw, out = new THREE.Vector3()) {
  group.updateWorldMatrix(true, false);
  return group.localToWorld(out.set(0, 0, bowNockZ(draw) + ARROW_LENGTH));
}

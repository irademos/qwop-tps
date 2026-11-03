// Story mode's Crow — a recurring character. For now it is the birds' model (`bird.glb`, the
// same as birds.js); swap CROW_MODEL_URL for a crow GLB later (it should face −Z like the bird
// does, or change CROW_MODEL_TURN). It flies in along a curve, lands, waits (turning to face
// whoever it's talking to, a hop now and then), flutters while it speaks, and flies off — with
// something in its beak if it was handed something (carry()).
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { BIRD_MODEL_URL } from '../environment/birds.js';

export const CROW_MODEL_URL = BIRD_MODEL_URL;
const CROW_MODEL_TURN = Math.PI;  // the model faces −Z: turned round to the game's +Z forward
const FLAP_CLIP = 'Take 001.001';
const CROW_SCALE = 1.7;           // the GLB is ~0.5 m wing to wing → ~0.85 m
const FLY_SPEED = 9;              // m/s along its flight
const FLAP_FLYING = 1.3;          // the clip's time scale in the air…
const FLAP_FLUTTER = 2.2;         // …fluttering while it talks / hops
const TURN_RATE = 5;              // rad/s turning to face someone
const HOP_EVERY_S = [2.5, 6];
const HOP_S = 0.35;
const HOP_HEIGHT = 0.12;

const rand = (a, b) => a + Math.random() * (b - a);
const ease = (u) => u * u * (3 - 2 * u);

export function createCrow({ scene }) {
  const root = new THREE.Group();
  root.name = 'crow';
  root.visible = false;
  scene.add(root);
  let mixer = null;
  let action = null;
  let halfH = 0.15;          // m: its body's middle over its feet
  let loading = null;
  let state = 'hidden';      // 'hidden' | 'flying' | 'landed'
  let flight = null;         // { a, b, c, length, s, onArrive, away }
  let faceTarget = null;     // a Vector3 to turn to while landed
  let flutterFor = 0;
  let hopIn = rand(...HOP_EVERY_S);
  let hopT = -1;
  const ground = new THREE.Vector3();
  let carried = null;

  const load = () => {
    if (loading) return loading;
    loading = new GLTFLoader().loadAsync(CROW_MODEL_URL).then((gltf) => {
      const model = gltf.scene;
      const box = new THREE.Box3().setFromObject(model);
      const centre = box.getCenter(new THREE.Vector3());
      model.position.sub(centre);
      halfH = ((box.max.y - box.min.y) / 2) * CROW_SCALE;
      const turn = new THREE.Group();
      turn.rotation.y = CROW_MODEL_TURN;
      turn.add(model);
      const body = new THREE.Group();
      body.scale.setScalar(CROW_SCALE);
      body.add(turn);
      body.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; } });
      root.add(body);
      mixer = new THREE.AnimationMixer(body);
      const clip = gltf.animations.find((a) => a.name === FLAP_CLIP) ?? gltf.animations[0] ?? null;
      if (clip) {
        action = mixer.clipAction(clip);
        action.play();
      }
    }).catch((err) => { console.warn('[story] crow model failed to load:', err); });
    return loading;
  };

  const setFlap = (scale) => { if (action) action.timeScale = scale; };

  // A curved flight from `from` to `to` (world, the feet's spot at `to`), arcing up `lift` m
  const fly = (from, to, { lift = 4, onArrive = null, away = false } = {}) => {
    root.visible = true;
    const a = from.clone();
    const b = to.clone();
    const c = a.clone().lerp(b, 0.5);
    c.y = Math.max(a.y, b.y) + lift;
    const length = a.distanceTo(c) + c.distanceTo(b);
    flight = { a, b, c, length, s: 0, onArrive, away };
    state = 'flying';
    setFlap(FLAP_FLYING);
    root.position.copy(a);
  };
  const _p = new THREE.Vector3();
  const _q = new THREE.Vector3();
  const bezier = (f, u, out) => {
    const v = 1 - u;
    return out.set(
      v * v * f.a.x + 2 * v * u * f.c.x + u * u * f.b.x,
      v * v * f.a.y + 2 * v * u * f.c.y + u * u * f.b.y,
      v * v * f.a.z + 2 * v * u * f.c.z + u * u * f.b.z,
    );
  };

  const turnToward = (x, z, dt) => {
    const want = Math.atan2(x - root.position.x, z - root.position.z);
    const d = Math.atan2(Math.sin(want - root.rotation.y), Math.cos(want - root.rotation.y));
    const step = TURN_RATE * dt;
    root.rotation.y += Math.abs(d) <= step ? d : Math.sign(d) * step;
  };

  const update = (dt) => {
    if (state === 'hidden') return;
    mixer?.update(dt);
    if (state === 'flying') {
      const f = flight;
      f.s += (FLY_SPEED * dt) / Math.max(1, f.length);
      const u = Math.min(1, f.s);
      // (slowing in to land)
      const k = f.away ? u * u : ease(u) * 0.6 + u * 0.4;
      bezier(f, k, _p);
      bezier(f, Math.min(1, k + 0.02), _q);
      root.position.copy(_p);
      if (_q.distanceToSquared(_p) > 1e-6) {
        root.rotation.y = Math.atan2(_q.x - _p.x, _q.z - _p.z);
        root.rotation.x = -Math.atan2(_q.y - _p.y, Math.hypot(_q.x - _p.x, _q.z - _p.z)) * 0.5;
      }
      if (u >= 1) {
        flight = null;
        root.rotation.x = 0;
        if (f.away) { state = 'hidden'; root.visible = false; }
        else {
          state = 'landed';
          ground.copy(f.b).y -= halfH;
          root.position.copy(f.b);
          setFlap(0);
        }
        f.onArrive?.();
      }
      return;
    }
    // Landed: face whoever it's talking to, hop now and then, flutter while talking
    if (faceTarget) turnToward(faceTarget.x, faceTarget.z, dt);
    let y = ground.y + halfH;
    if (hopT >= 0) {
      hopT += dt;
      const u = hopT / HOP_S;
      if (u >= 1) hopT = -1;
      else y += Math.sin(u * Math.PI) * HOP_HEIGHT;
    } else if ((hopIn -= dt) <= 0) {
      hopIn = rand(...HOP_EVERY_S);
      hopT = 0;
      flutterFor = Math.max(flutterFor, HOP_S);
    }
    root.position.y = y;
    if (flutterFor > 0) {
      flutterFor -= dt;
      setFlap(FLAP_FLUTTER);
    } else {
      setFlap(0);
      // (wings at rest: the clip's first frame)
      if (action) action.time = 0;
    }
  };

  return {
    load,
    root,
    halfHeight: () => halfH,
    // Flies in from `from` (world) to land on `feet` (world — its feet's spot)
    flyIn: (from, feet, onArrive) => fly(from, feet.clone().setY(feet.y + halfH), { lift: 3, onArrive }),
    // Off and away toward `to`
    flyAway: (to, onArrive) => fly(root.position.clone(), to, { lift: 6, onArrive, away: true }),
    // Put down on `feet` at once
    landAt: (feet) => {
      root.visible = true;
      flight = null;
      state = 'landed';
      ground.copy(feet);
      root.position.copy(feet).setY(feet.y + halfH);
      root.rotation.set(0, root.rotation.y, 0);
      setFlap(0);
    },
    lookAt: (p) => { faceTarget = p ? p.clone() : null; },
    faceNow: (p) => { root.rotation.y = Math.atan2(p.x - root.position.x, p.z - root.position.z); },
    // Flapping while it talks (s)
    flutter: (s = 0.8) => { flutterFor = Math.max(flutterFor, s); },
    // Something held in its beak (or null)
    carry: (obj) => {
      if (carried) carried.parent?.remove(carried);
      carried = obj;
      if (obj) {
        obj.position.set(0, -halfH * 0.2, halfH * 0.9);
        obj.rotation.set(0, Math.PI / 2, 0);
        root.add(obj);
      }
    },
    hide: () => { state = 'hidden'; flight = null; root.visible = false; },
    isLanded: () => state === 'landed',
    isFlying: () => state === 'flying',
    isVisible: () => state !== 'hidden',
    position: () => root.position,
    feet: () => ground,
    update,
    dispose: () => { root.parent?.remove(root); },
  };
}

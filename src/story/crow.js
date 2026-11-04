// Story mode's Crow — a recurring character (`crow.glb`, credits.json). Its one clip,
// 'root|TakeOff', is cut into parts (CLIP_PARTS, seconds): an idle looking round (0–5), a 'Caw!'
// on the ground (5–6), then taking off, flapping, gliding and landing (6 to the end) — all in
// place, so the flight's path is ours. It flies in along a curve (flapping, gliding in, landing
// as it arrives), waits on the ground (the idle; facing whoever it's talking to), caws when it
// speaks (flutter()), and takes off and flies away — with something in its beak if it was handed
// something (carry(), held at the head bone).
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export const CROW_MODEL_URL = '/assets/props/crow.glb?v=1';
const CROW_MODEL_TURN = 0;        // the model faces +Z, the game's forward
const CROW_CLIP = 'root|TakeOff';
const CROW_HEIGHT = 0.42;         // m: standing, feet to the top of its head
// Parts of the clip (s): [from, to]
const CLIP_PARTS = {
  idle: [0, 5],
  caw: [5, 6],
  takeOff: [6.7, 7.7],            // (6–6.7 is it standing still)
  flap: [7.5, 8.4],               // one wing beat, looped
  glide: [8.8, 9.8],
  land: [9.8, 10.5],
};
const GLIDE_IN_S = 1.2;           // gliding this long before the landing
const BEAK_AHEAD = 0.07;          // m in front of the head bone a carried thing is held
const BEAK_DOWN = 0.02;
const FLY_SPEED = 9;              // m/s along its flight
const TURN_RATE = 5;              // rad/s turning to face someone

const ease = (u) => u * u * (3 - 2 * u);

export function createCrow({ scene }) {
  const root = new THREE.Group();
  root.name = 'crow';
  root.visible = false;
  scene.add(root);
  let mixer = null;
  let action = null;
  let head = null;           // the head bone (a carried thing is held in front of it)
  let halfH = CROW_HEIGHT / 2; // m: its body's middle over its feet
  let loading = null;
  let state = 'hidden';      // 'hidden' | 'flying' | 'landed'
  let flight = null;         // { a, b, c, length, s, onArrive, away }
  let faceTarget = null;     // a Vector3 to turn to while landed
  const ground = new THREE.Vector3();
  let carried = null;
  // The part of the clip playing: { name, t (s into it), loop, then (the part after it) }
  let part = { name: 'idle', t: 0, loop: true, then: null };

  const play = (name, { loop = false, then = null, at = 0 } = {}) => {
    part = { name, t: at, loop, then };
  };
  const partLength = (name) => CLIP_PARTS[name][1] - CLIP_PARTS[name][0];
  const stepClip = (dt) => {
    if (!action) return;
    const len = partLength(part.name);
    part.t += dt;
    if (part.t >= len) {
      if (part.loop) part.t %= len;
      else if (part.then) play(part.then, { loop: true });
      else part.t = len;
    }
    action.time = CLIP_PARTS[part.name][0] + Math.min(part.t, partLength(part.name));
    mixer.update(0);
  };

  const load = () => {
    if (loading) return loading;
    loading = new GLTFLoader().loadAsync(CROW_MODEL_URL).then((gltf) => {
      const model = gltf.scene;
      model.traverse((o) => {
        if (!o.isMesh) return;
        o.castShadow = true;
        o.receiveShadow = false;
        o.frustumCulled = false; // (skinned: its bounds are the bind pose's)
        // (exported as alpha blend: cut out instead, so it sorts like everything else)
        for (const m of [o.material].flat()) {
          if (!m) continue;
          m.transparent = false;
          m.alphaTest = 0.5;
          m.depthWrite = true;
        }
      });
      head = model.getObjectByName('CROW__Head_05') ?? null;
      const turn = new THREE.Group();
      turn.rotation.y = CROW_MODEL_TURN;
      turn.add(model);
      const body = new THREE.Group();
      body.add(turn);
      root.add(body);
      mixer = new THREE.AnimationMixer(model);
      const clip = gltf.animations.find((a) => a.name === CROW_CLIP) ?? gltf.animations[0] ?? null;
      if (clip) {
        action = mixer.clipAction(clip);
        action.play();
        action.paused = true; // (its time is set by stepClip)
        action.time = 0;
        mixer.update(0);
      }
      // Sized and placed from the standing pose (the clip's first frame): feet → body middle
      model.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(model, true);
      const h = Math.max(1e-6, box.max.y - box.min.y);
      const k = CROW_HEIGHT / h;
      body.scale.setScalar(k);
      const centre = box.getCenter(new THREE.Vector3());
      model.position.x -= centre.x;
      model.position.z -= centre.z;
      model.position.y -= centre.y;
      halfH = CROW_HEIGHT / 2;
      if (state === 'landed') root.position.y = ground.y + halfH;
    }).catch((err) => { console.warn('[story] crow model failed to load:', err); });
    return loading;
  };

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
    // (off the ground: the take-off, then wing beats; arriving from the air: wing beats)
    if (away) play('takeOff', { then: 'flap' });
    else play('flap', { loop: true });
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

  const _hp = new THREE.Vector3();
  const holdCarried = () => {
    if (!carried) return;
    if (head) {
      root.updateMatrixWorld(true);
      root.worldToLocal(head.getWorldPosition(_hp));
      carried.position.set(_hp.x, _hp.y - BEAK_DOWN, _hp.z + BEAK_AHEAD);
    } else carried.position.set(0, halfH * 0.6, halfH * 0.9);
  };

  const update = (dt) => {
    if (state === 'hidden') return;
    if (state === 'flying') {
      const f = flight;
      const total = Math.max(1, f.length) / FLY_SPEED; // s for the whole flight
      f.s += dt / total;
      const u = Math.min(1, f.s);
      if (!f.away) {
        // Gliding in, then the landing timed to end as it touches down
        const left = (1 - u) * total;
        const landLen = partLength('land');
        if (left <= landLen && part.name !== 'land') play('land', { at: Math.max(0, landLen - left) });
        else if (left <= landLen + GLIDE_IN_S && part.name === 'flap') play('glide', { loop: true });
      }
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
          play('idle', { loop: true });
        }
        f.onArrive?.();
      }
      stepClip(dt);
      holdCarried();
      return;
    }
    // Landed: looking round (the idle), facing whoever it's talking to
    if (faceTarget) turnToward(faceTarget.x, faceTarget.z, dt);
    root.position.y = ground.y + halfH;
    stepClip(dt);
    holdCarried();
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
      play('idle', { loop: true });
    },
    lookAt: (p) => { faceTarget = p ? p.clone() : null; },
    faceNow: (p) => { root.rotation.y = Math.atan2(p.x - root.position.x, p.z - root.position.z); },
    // A 'Caw!' as it speaks (on the ground; back to looking round after)
    flutter: () => {
      if (state === 'landed' && part.name !== 'caw') play('caw', { then: 'idle' });
    },
    // Something held in its beak (or null)
    carry: (obj) => {
      if (carried) carried.parent?.remove(carried);
      carried = obj;
      if (obj) {
        obj.rotation.set(0, Math.PI / 2, 0);
        root.add(obj);
        holdCarried();
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

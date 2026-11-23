// The "move your phone" hint: when a gyro item (sword, wand, rod, oar, shield) or a ride
// steered by the phone's lean (broom, cart, canoe) is out and the phone has stayed still for
// a while, a little arm holding a phone shows how to move it — swinging, casting, tilting or
// turning — with a line of text under it. Moving the phone puts it away; after the player has
// done that HINT_MOVES_TO_STOP times it never shows again (localStorage HINT_STORE_KEY) —
// except in the tutorial, where it always may. The first time each item / ride is out it shows
// straight away, still phone or not, whatever that count (SEEN_STORE_KEY).
//
// Like the Endless character chooser (src/endless/characterChooser.js) it is its own little
// scene, drawn with the game's renderer into the rect of a DOM element (`.gyro-hint-stage`)
// after the world (`render()`, from the game loop after renderer.render). The models
// (hint_arm.glb — a lone left arm on a Mixamo skeleton, bind pose along +X; hint_phone.glb —
// its screen on +X, long side along Y) are fetched the first time the hint is wanted.
// The motions are procedural: the arm turns about its shoulder, the elbow and wrist bend.
//
// createGyroHint({ renderer })
//   → { update(dt, { wanted, kind, item, pose, tutorial }), render(), hide(), reset(), debug() }
//   item: what's out — 'sword' | 'wand' | 'rod' | 'oar' | 'shield' | 'broom' | 'cart' (first-time hints)
//   kind: 'swing' | 'wand' | 'cast' | 'tilt' | 'aim'; pose: the phone's orientation (a
//   THREE.Quaternion — any frame, only its changes count) or null
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export const HINT_ARM_URL = '/assets/props/hint_arm.glb';
export const HINT_PHONE_URL = '/assets/props/hint_phone.glb';

const STILL_S = 4;              // the phone this still this long → the hint
const TUTORIAL_STILL_S = 2.5;
const STILL_DEG = 6;            // turning less than this counts as still
const MOVED_DEG = 22;           // while it shows: turned this far from where it was → moved
const HINT_MOVES_TO_STOP = 3;   // moved this many times with it up → never again
const HINT_STORE_KEY = 'sq:gyroHintMoves';
// The first time each item / ride is out with a gyro (whatever the count above), the hint
// shows FIRST_DELAY_S after it comes out, still or not, until the phone's moved; items that
// have had theirs: localStorage SEEN_STORE_KEY
const FIRST_DELAY_S = 0.8;
const SEEN_STORE_KEY = 'sq:gyroHintSeen';
const FADE_RATE = 6;            // 1/s, in and out

const TEXT = {
  swing: 'Swing your phone like a sword',
  wand: 'Swipe your phone to cast a spell',
  cast: 'Flick your phone forward to cast',
  tilt: 'Tilt your phone to steer',
  aim: 'Turn your phone to aim',
};

// The view
const FOV = 30;
const CAM_POS = new THREE.Vector3(0, 0.05, 1.75);
const LOOK_AT = new THREE.Vector3(0.02, 0.02, 0);
// The arm at rest: reaching up from below the view (its shoulder out of sight), a little
// right and away, the phone's screen turned toward the camera
const ARM_DIR = new THREE.Vector3(0.25, 0.5, -0.83).normalize();
const PHONE_AT = new THREE.Vector3(0.06, 0.02, 0);           // the phone at rest about here
const REACH = 0.8;                                           // shoulder → phone, m
const SHOULDER_AT = PHONE_AT.clone().addScaledVector(ARM_DIR, -REACH);
const SCREEN_DIR = new THREE.Vector3(-0.15, 0.35, 1).normalize();
const PHONE_SCALE = 0.2;        // model units (1.16 long) → ≈ 0.23 (bigger than life, to read)
const PHONE_OUT = 0.2;          // along the hand bone, past the wrist (the fist is ≈ 0.17 long)
const ELBOW_REST = 0.25;        // rad, the elbow a little bent

const BONES = { arm: 'mixamorigLeftArm', fore: 'mixamorigLeftForeArm', hand: 'mixamorigLeftHand' };

function radialTexture() {
  const size = 128;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(16,20,28,0.88)');
  grad.addColorStop(0.62, 'rgba(14,17,26,0.78)');
  grad.addColorStop(1, 'rgba(16,20,28,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const readMoves = () => {
  try { return Number(localStorage.getItem(HINT_STORE_KEY)) || 0; } catch { return 0; }
};
const writeMoves = (n) => {
  try { localStorage.setItem(HINT_STORE_KEY, String(n)); } catch { /* private mode */ }
};

const readSeen = () => {
  try { return new Set(JSON.parse(localStorage.getItem(SEEN_STORE_KEY) || '[]')); } catch { return new Set(); }
};
const writeSeen = (set) => {
  try { localStorage.setItem(SEEN_STORE_KEY, JSON.stringify([...set])); } catch { /* private mode */ }
};

// 0 → 1 quickly, hold, 1 → 0 slowly: a swipe and its way back (u in 0 … 1 over one loop)
const swipe = (u, outEnd, holdEnd) => {
  if (u < outEnd) { const k = u / outEnd; return k * k * (3 - 2 * k); }
  if (u < holdEnd) return 1;
  const k = (u - holdEnd) / (1 - holdEnd);
  return 1 - k * k * (3 - 2 * k);
};

export function createGyroHint({ renderer }) {
  // ── DOM: the stage (the 3D rect) and the line of text under it
  const root = document.createElement('div');
  root.className = 'gyro-hint';
  root.setAttribute('aria-live', 'polite');
  const stage = document.createElement('div');
  stage.className = 'gyro-hint-stage';
  const caption = document.createElement('div');
  caption.className = 'gyro-hint-text';
  root.append(stage, caption);
  document.body.appendChild(root);

  // ── The scene
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 20);
  camera.position.copy(CAM_POS);
  camera.lookAt(LOOK_AT);
  scene.add(camera);
  scene.add(new THREE.HemisphereLight(0xfff4e0, 0x4a5068, 2.6));
  const key = new THREE.DirectionalLight(0xffffff, 2.8);
  key.position.set(-1.5, 3, 4);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xb9c8ff, 1.1);
  rim.position.set(2, 1.5, -3);
  scene.add(rim);
  const backdrop = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ map: radialTexture(), transparent: true, depthWrite: false, toneMapped: false })
  );
  backdrop.renderOrder = -1;
  backdrop.position.set(0, 0, -3);
  camera.add(backdrop);

  const pivot = new THREE.Group();        // at the shoulder; turned by the motion
  pivot.position.copy(SHOULDER_AT);
  scene.add(pivot);
  const baseQ = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(
    ARM_DIR,
    SCREEN_DIR.clone().addScaledVector(ARM_DIR, -SCREEN_DIR.dot(ARM_DIR)).normalize(),
    new THREE.Vector3().crossVectors(ARM_DIR, SCREEN_DIR).normalize()
  ));
  let bones = null;
  let loading = null;
  let failed = false;

  const load = () => {
    if (loading) return loading;
    const loader = new GLTFLoader();
    loading = Promise.all([loader.loadAsync(HINT_ARM_URL), loader.loadAsync(HINT_PHONE_URL)])
      .then(([arm, phone]) => {
        const armRoot = arm.scene;
        armRoot.updateMatrixWorld(true);
        const find = (name) => {
          let b = null;
          armRoot.traverse((o) => { if (!b && o.isBone && o.name.replace(/[^A-Za-z]/g, '') === name) b = o; });
          return b;
        };
        const b = { arm: find(BONES.arm), fore: find(BONES.fore), hand: find(BONES.hand) };
        if (!b.arm || !b.fore || !b.hand) throw new Error('hint arm: bones missing');
        // The shoulder at the pivot
        const shoulder = b.arm.getWorldPosition(new THREE.Vector3());
        armRoot.position.sub(shoulder);
        armRoot.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });
        pivot.add(armRoot);
        // The phone in the hand: its long side along the hand bone (bone +Y), screen up
        // (the hand bone's −X is world +Y in the bind pose; the phone's screen is its +X)
        const p = phone.scene;
        p.scale.setScalar(PHONE_SCALE);
        p.rotation.set(0, Math.PI, 0);
        p.position.set(0, PHONE_OUT, 0);
        b.hand.add(p);
        b.rest = { fore: b.fore.quaternion.clone(), hand: b.hand.quaternion.clone() };
        bones = b;
      })
      .catch((err) => { console.warn('[gyroHint] models failed to load', err); failed = true; });
    return loading;
  };

  // ── State
  let moves = readMoves();
  let shown = false;
  let fade = 0;
  let kind = 'swing';
  let t = 0;
  let stillT = 0;
  const ref = new THREE.Quaternion();
  let hasRef = false;
  const seen = readSeen();
  let item = null;        // what's out now ('sword', 'rod', 'broom'…), how long it's been out
  let itemT = 0;
  let firstItem = null;   // showing for that item's first time
  let forced = false;   // shown from the dev console (debug().show) until hide()

  const setShown = (on) => {
    shown = on;
    if (on) t = 0;
  };

  const _q = new THREE.Quaternion();
  const _q2 = new THREE.Quaternion();
  const _ax = new THREE.Vector3();
  const Z = new THREE.Vector3(0, 0, 1);    // the bones' bend axis (bone +Z = world +Z in bind)
  const Y = new THREE.Vector3(0, 1, 0);
  const X = new THREE.Vector3(1, 0, 0);
  // Arm-frame axes (in the arm's rest frame: +X along it, +Y the screen's way, +Z across)
  const turn = (axis, angle) => _q2.setFromAxisAngle(_ax.copy(axis).normalize(), angle);

  // Pose the arm for the loop time t (s)
  // Pose the arm for the loop time t (s). The arm's own frame: +X along it, +Y the screen's
  // way (toward the camera), +Z across — `turn(Y, a)` sweeps the phone across the view,
  // `turn(Z, a)` tips it toward / away from the camera. `world` turns about the view's axes.
  const _world = new THREE.Quaternion();
  const pose = () => {
    if (!bones) return;
    const shoulder = new THREE.Quaternion();
    _world.identity();
    let elbow = ELBOW_REST;
    let wristBend = 0;   // about bone Z: the phone tipped toward the camera (+) / away
    let wristSweep = 0;  // about bone X: the phone swung across the view
    let wristRoll = 0;   // about bone Y: the phone rolled about its long side
    if (kind === 'swing' || kind === 'wand') {
      // A slash across and down, then back up (1.6 s; the wand a smaller swipe)
      const u = (t % 1.6) / 1.6;
      const s = swipe(u, 0.2, 0.45) * 2 - 1;      // −1 raised … +1 slashed through
      const reach = kind === 'wand' ? 0.26 : 0.34;
      shoulder.multiply(turn(Y, -s * reach));
      shoulder.multiply(turn(Z, (1 - s * s) * 0.15));
      wristSweep = s * 0.4;
      elbow = ELBOW_REST + (1 - s * s) * 0.2;
    } else if (kind === 'cast') {
      // Back toward the shoulder, then a flick forward (2 s)
      const u = (t % 2) / 2;
      let a;
      if (u < 0.35) { const k = u / 0.35; a = -k * k * (3 - 2 * k); }            // wind back
      else if (u < 0.47) { const k = (u - 0.35) / 0.12; a = -1 + 1.7 * k; }      // flick
      else if (u < 0.7) a = 0.7;                                                  // held out
      else { const k = (u - 0.7) / 0.3; a = 0.7 * (1 - k * k * (3 - 2 * k)); }  // ease back
      shoulder.multiply(turn(Z, -a * 0.25));
      elbow = ELBOW_REST + Math.max(0, -a) * 0.45;
      wristBend = -a * 0.5;
    } else if (kind === 'tilt') {
      // Tipped forward and back, then leaned left and right (4 s)
      const u = (t % 4) / 4;
      const w = Math.sin(u * Math.PI * 4);
      if (u < 0.5) wristBend = w * 0.6;
      else wristRoll = w * 0.75;
    } else {
      // aim: turned left and right, a little up and down (3 s)
      const u = (t % 3) / 3;
      _world.setFromAxisAngle(_ax.set(0, 1, 0), Math.sin(u * Math.PI * 2) * 0.35)
        .multiply(_q.setFromAxisAngle(_ax.set(1, 0, 0), Math.sin(u * Math.PI * 4) * 0.08));
    }
    pivot.quaternion.copy(_world).multiply(baseQ).multiply(shoulder);
    bones.fore.quaternion.copy(bones.rest.fore).multiply(_q.setFromAxisAngle(Z, elbow));
    bones.hand.quaternion.copy(bones.rest.hand)
      .multiply(_q.setFromAxisAngle(Z, wristBend))
      .multiply(_q2.setFromAxisAngle(X, wristSweep))
      .multiply(_q.setFromAxisAngle(Y, wristRoll));
  };

  const update = (dt, { wanted = false, kind: k = 'swing', item: it = null, pose: devicePose = null, tutorial = false } = {}) => {
    const can = wanted && !!devicePose;
    const allowed = can && (tutorial || moves < HINT_MOVES_TO_STOP);
    // What's out, and for how long
    const nowItem = can ? it : null;
    if (nowItem !== item) {
      item = nowItem;
      itemT = 0;
      // (a first-time hint is for the item it came up for)
      if (shown && firstItem && firstItem !== item) { setShown(false); firstItem = null; }
    } else if (item) {
      itemT += dt;
    }
    const firstTime = !!item && !seen.has(item);
    // (≈ 24 KB: fetched as soon as a gyro item's out, so a first-time hint isn't kept waiting)
    if (can) load();
    if (forced) {
      // (left as it is)
    } else if (!can || (!allowed && !firstItem && !firstTime)) {
      hasRef = false;
      stillT = 0;
      firstItem = null;
      if (shown) setShown(false);
    } else {
      if (!hasRef) { ref.copy(devicePose); hasRef = true; stillT = 0; }
      const deg = THREE.MathUtils.radToDeg(ref.angleTo(devicePose));
      if (shown) {
        if (deg > MOVED_DEG) {
          setShown(false);
          if (firstItem) { seen.add(firstItem); writeSeen(seen); firstItem = null; }
          else if (!tutorial) { moves += 1; writeMoves(moves); }
          ref.copy(devicePose);
          stillT = 0;
        }
      } else if (firstTime && itemT >= FIRST_DELAY_S && (bones || failed)) {
        // Its first time out: show it now, from where the phone is
        kind = k;
        firstItem = item;
        ref.copy(devicePose);
        stillT = 0;
        setShown(true);
      } else if (!allowed) {
        stillT = 0;
      } else if (deg > STILL_DEG) {
        ref.copy(devicePose);
        stillT = 0;
      } else {
        stillT += dt;
        const need = tutorial ? TUTORIAL_STILL_S : STILL_S;
        if (stillT > need * 0.5) load();
        if (stillT >= need && (bones || failed)) { kind = k; setShown(true); }
      }
      if (shown && k !== kind) { kind = k; t = 0; }
    }
    fade += ((shown ? 1 : 0) - fade) * Math.min(1, dt * FADE_RATE);
    if (!shown && fade < 0.01) fade = 0;
    const visible = fade > 0;
    root.classList.toggle('is-shown', shown);
    root.style.display = visible ? '' : 'none';
    if (visible) {
      caption.textContent = TEXT[kind] || TEXT.swing;
      t += dt;
      pose();
    }
  };

  const _vp = new THREE.Vector4();
  const _sc = new THREE.Vector4();
  const render = () => {
    if (fade <= 0 || !bones) return;
    const r = stage.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return;
    const c = renderer.domElement.getBoundingClientRect();
    const x = r.left - c.left;
    const y = c.bottom - r.bottom;
    camera.aspect = r.width / r.height;
    camera.updateProjectionMatrix();
    const h = 2 * Math.tan(THREE.MathUtils.degToRad(FOV / 2)) * Math.abs(backdrop.position.z);
    backdrop.scale.set(h * camera.aspect, h, 1);
    // (fading: the whole little scene shrinks in / out a touch with it)
    pivot.scale.setScalar(0.85 + 0.15 * fade);
    backdrop.material.opacity = fade;
    renderer.getViewport(_vp);
    renderer.getScissor(_sc);
    const scissorTest = renderer.getScissorTest();
    const autoClear = renderer.autoClear;
    renderer.setViewport(x, y, r.width, r.height);
    renderer.setScissor(x, y, r.width, r.height);
    renderer.setScissorTest(true);
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(scene, camera);
    renderer.autoClear = autoClear;
    renderer.setScissorTest(scissorTest);
    renderer.setScissor(_sc);
    renderer.setViewport(_vp);
  };

  const hide = () => {
    forced = false;
    firstItem = null;
    if (shown) setShown(false);
    fade = 0;
    hasRef = false;
    stillT = 0;
    root.style.display = 'none';
  };
  hide();

  return {
    update,
    render,
    hide,
    // Forget the "moved it N times" count (dev console)
    // Forget which items have had their first-time hint too
    reset: () => { moves = 0; writeMoves(0); seen.clear(); writeSeen(seen); },
    debug: () => ({
      moves, shown, fade, stillT, kind, loaded: !!bones, failed, item, firstItem, seen: [...seen],
      // Show it now with a kind, for a look (dev console: gyroHint.debug().show('cast'))
      show: async (k = 'swing') => { await load(); kind = k; forced = true; setShown(true); },
      setTime: (s) => { t = s; pose(); },
    }),
  };
}

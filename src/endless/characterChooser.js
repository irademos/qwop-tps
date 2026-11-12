// Endless: the character chooser — every character standing in a row playing its idle clip,
// swiped through (drag / ‹ › / arrow keys); the one in the middle is the pick. Locked ones
// stand as dark silhouettes.
//
// It has its own little scene, drawn with the game's renderer into the rect of a DOM element
// (the "stage") after the world is drawn (`render()`, called from the game loop after
// renderer.render): scissor + viewport there, depth cleared, a soft dark backdrop behind the
// characters. The characters never move (GLBCharacter measures its speed from its world
// position — moving them would play the walk): the camera pans along the row instead.
//
// createCharacterChooser({ renderer, roster: [{ key, label, url }], isUnlocked(key) })
//   → { mount(stageEl), select(key, { instant }), selected(), next(dir), refresh(), onChange(cb),
//       update(dt), render(), dragging() }
import * as THREE from 'three';
import { createGLBCharacterInstance, glbCharacterConfig } from '../models/glbCharacterModel.js';

const SPACING = 1.25;          // m between characters along the row
const CAM_DIST = 2.45;         // m in front of the row
const CAM_Y = 0.72;
const LOOK_Y = 0.56;
// Sizes evened out a bit (the game's sizes run 0.8 – 1.4 m): shown at height^SIZE_KEEP
const SIZE_KEEP = 0.4;
const FOV = 30;
const EASE_RATE = 9;           // the camera's pan toward the pick (1/s)
const TURN_TO_CAM = 0.32;      // rad each step off the middle turns toward the camera
const LOAD_AROUND = 2;         // characters this far either side of the pick are loaded
const DRAG_PX_PER_SLOT = 140;  // a drag this far moves one character over
const SILHOUETTE = new THREE.MeshBasicMaterial({ color: 0x10141c });

function radialTexture(stops) {
  const size = 128;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  stops.forEach(([at, col]) => grad.addColorStop(at, col));
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createCharacterChooser({ renderer, roster, isUnlocked }) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 50);
  scene.add(camera);
  scene.add(new THREE.HemisphereLight(0xfff4e0, 0x4a5068, 3.2));
  const key = new THREE.DirectionalLight(0xffffff, 3.2);
  key.position.set(-2, 4, 5);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xb9c8ff, 1.2);
  rim.position.set(3, 2, -4);
  scene.add(rim);

  // The backdrop: a dark glow behind the row, fixed to the camera, fading out at its edges
  // so the world shows round it
  const backdrop = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({
      map: radialTexture([[0, 'rgba(18,22,34,0.94)'], [0.65, 'rgba(14,17,26,0.86)'], [0.98, 'rgba(10,12,18,0)']]),
      // (depth-tested: transparent things draw after the characters whatever their renderOrder,
      // so it must lose to them on depth — it sits far behind them)
      transparent: true, depthWrite: false, depthTest: true, toneMapped: false,
    }),
  );
  backdrop.renderOrder = -10;
  backdrop.position.z = -12;
  camera.add(backdrop);

  const floorTex = radialTexture([[0, 'rgba(0,0,0,0.55)'], [0.6, 'rgba(0,0,0,0.25)'], [1, 'rgba(0,0,0,0)']]);
  const floorMat = new THREE.MeshBasicMaterial({ map: floorTex, transparent: true, depthWrite: false, toneMapped: false });
  const floorGeo = new THREE.PlaneGeometry(0.9, 0.9).rotateX(-Math.PI / 2);

  // One slot per character: its spot on the row, its instance once loaded
  const slots = roster.map((r, i) => {
    const root = new THREE.Group();
    root.position.set(i * SPACING, 0, 0);
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.position.y = 0.005;
    root.add(floor);
    scene.add(root);
    return { ...r, i, root, inst: null, loading: false, materials: null, locked: null };
  });

  let index = 0;            // the pick
  let pos = 0;              // where the camera is along the row (in slots)
  let stage = null;
  let drag = null;          // { id, x0, pos0, moved }
  let changeCb = null;

  const applyLock = (s) => {
    if (!s.inst) return;
    const locked = !isUnlocked(s.key);
    if (locked === s.locked) return;
    s.locked = locked;
    s.inst.container.traverse((o) => {
      if (!o.isMesh || o.userData.isBlobShadow) return;
      if (!o.userData.chooserMat) o.userData.chooserMat = o.material;
      o.material = locked ? SILHOUETTE : o.userData.chooserMat;
    });
  };

  const load = (s) => {
    if (s.inst || s.loading) return;
    s.loading = true;
    createGLBCharacterInstance({ url: s.url, armIK: false }).then((inst) => {
      // (no blob shadow: it would look for the world's ground under it)
      inst.container.children.filter((c) => c.userData.isBlobShadow).forEach((c) => inst.container.remove(c));
      s.inst = inst;
      const k = glbCharacterConfig.heightScaleByUrl[s.url] ?? 1;
      inst.container.scale.setScalar(k ** SIZE_KEEP / k);
      s.root.add(inst.container);
      applyLock(s);
    }).catch((err) => { s.loading = false; console.warn('[Endless] chooser character failed to load:', err); });
  };

  const clampIndex = (i) => Math.max(0, Math.min(slots.length - 1, i));
  const select = (k, { instant = false } = {}) => {
    const i = typeof k === 'number' ? k : slots.findIndex((s) => s.key === k);
    if (i < 0) return;
    const was = index;
    index = clampIndex(i);
    if (instant) pos = index;
    if (index !== was) changeCb?.(slots[index].key);
  };
  const next = (dir) => select(clampIndex(index + dir));

  // ── Swiping on the stage ──
  const onDown = (e) => {
    if (drag) return;
    drag = { id: e.pointerId, x0: e.clientX, pos0: pos, moved: false };
    stage.setPointerCapture?.(e.pointerId);
  };
  const onMove = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x0;
    if (Math.abs(dx) > 6) drag.moved = true;
    pos = Math.max(-0.4, Math.min(slots.length - 0.6, drag.pos0 - dx / DRAG_PX_PER_SLOT));
  };
  const onUp = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    if (!d.moved) {
      // A tap on a neighbour picks it
      const r = stage.getBoundingClientRect();
      const fx = (e.clientX - r.left) / r.width - 0.5;
      if (Math.abs(fx) > 0.25) next(fx > 0 ? 1 : -1);
      return;
    }
    // Let go: the nearest one, nudged on by a flick past a third of a slot
    const moved = pos - d.pos0;
    const target = Math.abs(moved) < 0.33 ? index : Math.round(pos + Math.sign(moved) * 0.2);
    select(clampIndex(target));
  };

  const mount = (el) => {
    if (stage === el) return;
    if (stage) {
      stage.removeEventListener('pointerdown', onDown);
      stage.removeEventListener('pointermove', onMove);
      stage.removeEventListener('pointerup', onUp);
      stage.removeEventListener('pointercancel', onUp);
    }
    stage = el;
    drag = null;
    if (!el) return;
    el.style.touchAction = 'none';
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
  };

  const visibleRect = () => {
    if (!stage || !stage.isConnected) return null;
    const r = stage.getBoundingClientRect();
    if (r.width < 4 || r.height < 4 || !stage.offsetParent) return null;
    return r;
  };

  const update = (dt) => {
    if (!visibleRect()) return;
    if (!drag) pos += (index - pos) * (1 - Math.exp(-EASE_RATE * dt));
    for (const s of slots) {
      const d = s.i - pos;
      if (Math.abs(s.i - index) <= LOAD_AROUND) load(s);
      s.root.visible = Math.abs(d) < 2.6;
      if (!s.inst || !s.root.visible) continue;
      applyLock(s);
      s.root.rotation.y = -Math.max(-1.5, Math.min(1.5, d)) * TURN_TO_CAM;
      s.inst.character.animate(dt);
      s.inst.character.stepFluff(dt);
    }
  };

  const _vp = new THREE.Vector4();
  const _sc = new THREE.Vector4();
  const render = () => {
    const r = visibleRect();
    if (!r) return;
    const c = renderer.domElement.getBoundingClientRect();
    const x = r.left - c.left;
    const y = c.bottom - r.bottom;
    camera.aspect = r.width / r.height;
    // (a narrow stage backs the camera off so the pick still fits across)
    const dist = CAM_DIST * Math.max(1, 0.75 / camera.aspect);
    camera.position.set(pos * SPACING, CAM_Y, dist);
    camera.lookAt(pos * SPACING, LOOK_Y, 0);
    camera.updateProjectionMatrix();
    const h = 2 * Math.tan(THREE.MathUtils.degToRad(FOV / 2)) * Math.abs(backdrop.position.z);
    // (just the frustum: the glow fades out before the stage's edges, so no hard rect)
    backdrop.scale.set(h * camera.aspect, h, 1);
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

  return {
    mount,
    select,
    next,
    selected: () => slots[index].key,
    refresh: () => slots.forEach((s) => { s.locked = null; applyLock(s); }),
    onChange: (cb) => { changeCb = cb; },
    update,
    render,
    dragging: () => !!drag,
  };
}

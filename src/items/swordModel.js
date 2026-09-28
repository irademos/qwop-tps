import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// The sword GLB (player + enemy swords). Sword convention everywhere else: the
// origin is the grip (hand), the blade points along +Z and the tip is ~0.69 ahead
// (hit checks use that fixed tip, see SWORD_TIP_LOCAL in EnemyPlayer.js).
export const SWORD_MODEL_URL = '/assets/props/sword.glb';

// Auto-fit: the model's longest axis is turned onto +Z and scaled to this length
// (the foam sword was ~0.9 from pommel to tip) before the debug adjust is applied.
const SWORD_FIT_LENGTH = 0.9;

// Grip → model placement. TEMP: tuned with the debug sliders (mountSwordDebugPanel);
// paste the copied values here once they look right.
export const SWORD_ADJUST_DEFAULTS = Object.freeze({
  px: 0, py: 0, pz: 0.24,   // position (m, sword-local)
  rx: 0, ry: 0, rz: 0,      // rotation (deg, XYZ)
  scale: 1,
});

const ADJUST_STORAGE_KEY = 'sq:swordModelAdjust';

function loadStoredAdjust() {
  try {
    const raw = localStorage.getItem(ADJUST_STORAGE_KEY);
    if (!raw) return { ...SWORD_ADJUST_DEFAULTS };
    const parsed = JSON.parse(raw);
    const out = { ...SWORD_ADJUST_DEFAULTS };
    for (const key of Object.keys(out)) {
      if (Number.isFinite(parsed?.[key])) out[key] = parsed[key];
    }
    return out;
  } catch {
    return { ...SWORD_ADJUST_DEFAULTS };
  }
}

export const swordModelAdjust = loadStoredAdjust();

let _templatePromise = null;
let _template = null;

// Loads sword.glb once. Resolves to a template group (translation stripped, fitted
// to the sword convention) or null when the file is missing/broken.
export function loadSwordModelTemplate() {
  if (_templatePromise) return _templatePromise;
  _templatePromise = new GLTFLoader().loadAsync(SWORD_MODEL_URL)
    .then(gltf => {
      _template = buildTemplate(gltf.scene);
      return _template;
    })
    .catch(error => {
      console.warn('Failed to load sword.glb, keeping the foam sword.', error);
      return null;
    });
  return _templatePromise;
}

export function getSwordModelTemplate() {
  return _template;
}

function buildTemplate(gltfScene) {
  // Remove the translation baked into the GLB: zero the root node offset (a lone
  // top-level node too — several nodes keep their relative layout), then recenter
  // the geometry bounds on the origin.
  gltfScene.position.set(0, 0, 0);
  if (gltfScene.children.length === 1) gltfScene.children[0].position.set(0, 0, 0);
  gltfScene.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(gltfScene);
  const center = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  gltfScene.position.sub(center);

  gltfScene.traverse(child => {
    if (!child.isMesh) return;
    child.castShadow = true;
    child.receiveShadow = true;
  });

  // Fit: longest axis → +Z, scaled to SWORD_FIT_LENGTH
  const fit = new THREE.Group();
  fit.name = 'sword-glb-fit';
  fit.add(gltfScene);
  const longest = Math.max(size.x, size.y, size.z) || 1;
  if (longest === size.x) fit.rotation.y = -Math.PI / 2;      // +X → +Z
  else if (longest === size.y) fit.rotation.x = Math.PI / 2;  // +Y → +Z
  fit.scale.setScalar(SWORD_FIT_LENGTH / longest);
  return fit;
}

function applyAdjust(adjustGroup) {
  const a = swordModelAdjust;
  adjustGroup.position.set(a.px, a.py, a.pz);
  adjustGroup.rotation.set(
    THREE.MathUtils.degToRad(a.rx),
    THREE.MathUtils.degToRad(a.ry),
    THREE.MathUtils.degToRad(a.rz),
  );
  adjustGroup.scale.setScalar(a.scale);
}

// A new sword model instance (adjust group → fit → GLB), or null before the GLB has
// loaded. cloneMaterials gives the instance its own materials (enemy hit flash).
export function createSwordModelInstance({ cloneMaterials = false } = {}) {
  if (!_template) return null;
  const adjust = new THREE.Group();
  adjust.name = 'sword-glb-adjust';
  adjust.userData.swordGlbAdjust = true;
  const model = _template.clone(true);
  if (cloneMaterials) {
    model.traverse(child => {
      if (!child.isMesh) return;
      child.material = Array.isArray(child.material)
        ? child.material.map(m => m.clone())
        : child.material?.clone();
    });
  }
  adjust.add(model);
  applyAdjust(adjust);
  return adjust;
}

// Re-applies the debug adjust to every sword instance in the scene (including clones
// of the player's sword: held, remote and duel meshes).
export function refreshSwordModelAdjust(scene) {
  scene?.traverse(obj => {
    if (obj.userData?.swordGlbAdjust) applyAdjust(obj);
  });
}

// ─── TEMP debug sliders ───────────────────────────────────────────────────────

const SLIDERS = [
  { key: 'px', label: 'Pos X', min: -0.6, max: 0.6, step: 0.005 },
  { key: 'py', label: 'Pos Y', min: -0.6, max: 0.6, step: 0.005 },
  { key: 'pz', label: 'Pos Z', min: -0.6, max: 0.8, step: 0.005 },
  { key: 'rx', label: 'Rot X', min: -180, max: 180, step: 1 },
  { key: 'ry', label: 'Rot Y', min: -180, max: 180, step: 1 },
  { key: 'rz', label: 'Rot Z', min: -180, max: 180, step: 1 },
  { key: 'scale', label: 'Scale', min: 0.1, max: 3, step: 0.01 },
];

export function mountSwordDebugPanel(scene) {
  if (document.getElementById('sword-debug-panel')) return;
  const panel = document.createElement('div');
  panel.id = 'sword-debug-panel';
  panel.className = 'sword-debug-panel';

  const header = document.createElement('button');
  header.type = 'button';
  header.className = 'sword-debug-toggle';
  header.textContent = '🗡 Sword adjust';
  panel.appendChild(header);

  const body = document.createElement('div');
  body.className = 'sword-debug-body';
  panel.appendChild(body);

  const save = () => {
    try { localStorage.setItem(ADJUST_STORAGE_KEY, JSON.stringify(swordModelAdjust)); } catch { /* ignore */ }
  };
  const inputs = {};
  const setValue = (key, value) => {
    swordModelAdjust[key] = value;
    inputs[key].range.value = value;
    inputs[key].out.textContent = String(+value.toFixed(3));
  };

  SLIDERS.forEach(({ key, label, min, max, step }) => {
    const row = document.createElement('label');
    row.className = 'sword-debug-row';
    const name = document.createElement('span');
    name.textContent = label;
    const range = document.createElement('input');
    range.type = 'range';
    range.min = min;
    range.max = max;
    range.step = step;
    const out = document.createElement('span');
    out.className = 'sword-debug-value';
    range.addEventListener('input', () => {
      setValue(key, parseFloat(range.value));
      refreshSwordModelAdjust(scene);
      save();
    });
    row.append(name, range, out);
    body.appendChild(row);
    inputs[key] = { range, out };
    setValue(key, swordModelAdjust[key]);
  });

  const actions = document.createElement('div');
  actions.className = 'sword-debug-actions';
  const reset = document.createElement('button');
  reset.type = 'button';
  reset.textContent = 'Reset';
  reset.addEventListener('click', () => {
    Object.entries(SWORD_ADJUST_DEFAULTS).forEach(([key, value]) => setValue(key, value));
    refreshSwordModelAdjust(scene);
    save();
  });
  const copy = document.createElement('button');
  copy.type = 'button';
  copy.textContent = 'Copy values';
  copy.addEventListener('click', () => {
    const text = JSON.stringify(swordModelAdjust);
    navigator.clipboard?.writeText(text).then(
      () => { copy.textContent = 'Copied!'; setTimeout(() => { copy.textContent = 'Copy values'; }, 1200); },
      () => window.prompt('Sword adjust values', text),
    );
  });
  actions.append(reset, copy);
  body.appendChild(actions);

  header.addEventListener('click', () => panel.classList.toggle('collapsed'));
  document.body.appendChild(panel);
}

/**
 * Debug panel for FBX→GLB animation fine-tuning.
 * bindPose retargeting + root Y180 are baked in as permanent behaviour.
 * This panel exposes additional tweaks on top of that baseline.
 * Toggle with: window.__fbxAnimDebug.toggle()
 */

import * as THREE from 'three';

export const fbxAnimConfig = {
  // Playback
  timeScale: 1.0,

  // Track type toggles
  keepPosition: true,
  keepQuaternion: true,
  keepScale: false,

  // Root bone position strip
  stripRootPosition: true,

  // Height / placement
  targetHeight: 1.0,
  sceneScaleMultiplier: 1.0,
  sceneOffsetY: 0.0,

  // X rotation applied to animation tracks to correct backward lean (degrees, negative = tilt forward).
  sceneRotX: -45,

  // Extra root bone pre-rotation on top of the baked corrections (degrees).
  // Use only if the character is still facing wrong after the scene Y180.
  rootPreRotX: 0,
  rootPreRotY: 0,
  rootPreRotZ: 0,

  // Global quaternion flip — rarely needed now that bindPose is active,
  // but left here as an escape hatch.
  flipCorrectX: false,
  flipCorrectY: false,
  flipCorrectZ: false,

  // Per-bone config keyed by exact bone name (mixamorig-prefixed).
  // Each entry: { flipX, flipY, flipZ, ex, ey, ez }
  boneCorrections: {},

  _dirty: false,
};

const DEFAULT_BONE_ROWS = [
  'mixamorigHips',
  'mixamorigLeftUpLeg',   'mixamorigRightUpLeg',
  'mixamorigLeftLeg',     'mixamorigRightLeg',
  'mixamorigLeftFoot',    'mixamorigRightFoot',
  'mixamorigLeftToeBase', 'mixamorigRightToeBase',
  'mixamorigSpine', 'mixamorigSpine1', 'mixamorigSpine2',
  'mixamorigNeck', 'mixamorigHead',
  'mixamorigLeftShoulder',  'mixamorigRightShoulder',
  'mixamorigLeftArm',    'mixamorigRightArm',
  'mixamorigLeftForeArm','mixamorigRightForeArm',
];
DEFAULT_BONE_ROWS.forEach(b => {
  fbxAnimConfig.boneCorrections[b] = { flipX: false, flipY: false, flipZ: false, ex: 0, ey: 0, ez: 0 };
});

// Bone info populated by glbCharacterModel after load
export const boneInfoRegistry = {};

// ── Panel ──────────────────────────────────────────────────────────────────
function el(tag, styles, props) {
  const e = document.createElement(tag);
  if (styles) Object.assign(e.style, styles);
  if (props)  Object.assign(e, props);
  return e;
}

function buildPanel() {
  const panel = el('div', {
    position: 'fixed', top: '60px', right: '10px',
    width: '360px', maxHeight: '85vh', overflowY: 'auto',
    background: 'rgba(8,8,18,0.94)', border: '1px solid #444',
    borderRadius: '8px', padding: '10px 14px 14px',
    fontFamily: 'monospace', fontSize: '11px', color: '#ddd',
    zIndex: 99999, userSelect: 'none',
  });

  const header = el('div', { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' });
  const title = el('b', { fontSize: '13px' });
  title.textContent = '🎞 FBX→GLB Anim Debug';
  const closeBtn = el('button', { background: 'none', border: 'none', color: '#aaa', fontSize: '18px', cursor: 'pointer', lineHeight: '1' });
  closeBtn.textContent = '×';
  closeBtn.onclick = () => { panel.style.display = 'none'; };
  header.append(title, closeBtn);
  panel.append(header);

  const baseline = el('div', { color: '#585', fontSize: '10px', marginBottom: '8px', lineHeight: '1.4' });
  baseline.textContent = '✔ bindPose retargeting active  ✔ root Y+180° baked in';
  panel.append(baseline);

  function section(label) {
    const d = el('div', { color: '#88aaff', fontWeight: 'bold', margin: '10px 0 5px', borderBottom: '1px solid #333', paddingBottom: '2px' });
    d.textContent = label;
    panel.append(d);
  }

  function note(text) {
    const d = el('div', { color: '#777', marginBottom: '5px', lineHeight: '1.4' });
    d.textContent = text;
    panel.append(d);
  }

  function slider(label, key, min, max, step) {
    const row = el('div', { display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' });
    const lbl = el('span', { width: '140px', flexShrink: '0' });
    lbl.textContent = label;
    const inp = el('input', { flex: '1', accentColor: '#5af' });
    Object.assign(inp, { type: 'range', min, max, step, value: fbxAnimConfig[key] ?? 0 });
    const decimals = step < 0.01 ? 3 : step < 0.1 ? 2 : 1;
    const valSpan = el('span', { width: '46px', textAlign: 'right' });
    valSpan.textContent = Number(inp.value).toFixed(decimals);
    inp.addEventListener('input', () => {
      fbxAnimConfig[key] = parseFloat(inp.value);
      valSpan.textContent = Number(inp.value).toFixed(decimals);
      fbxAnimConfig._dirty = true;
    });
    row.append(lbl, inp, valSpan);
    panel.append(row);
  }

  function toggle(label, key) {
    const row = el('div', { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' });
    const inp = el('input');
    inp.type = 'checkbox';
    inp.checked = !!fbxAnimConfig[key];
    inp.addEventListener('change', () => { fbxAnimConfig[key] = inp.checked; fbxAnimConfig._dirty = true; });
    const lbl = el('label', { cursor: 'pointer' });
    lbl.prepend(inp);
    lbl.append(' ' + label);
    row.append(lbl);
    panel.append(row);
  }

  // ── Bone Inspector
  section('🔍 Bone Inspector');
  const inspectBtn = el('button', {
    width: '100%', padding: '5px', background: '#1a3a1a', border: '1px solid #3a3',
    borderRadius: '4px', color: '#afa', cursor: 'pointer', fontSize: '11px', marginBottom: '4px',
  });
  inspectBtn.textContent = '📋 Dump Bone Info to Console';
  inspectBtn.onclick = () => {
    const entries = Object.entries(boneInfoRegistry);
    if (!entries.length) { console.warn('[FBXAnimDebug] No bone info yet — wait for model to load'); return; }
    console.group('[FBXAnimDebug] Bone Info');
    const matched = entries.filter(([, v]) => v.tracked);
    const unmatched = entries.filter(([, v]) => !v.tracked);
    console.log(`Matched (animated): ${matched.length}, Unmatched (GLB-only): ${unmatched.length}`);
    console.group('Matched bones');
    matched.forEach(([name, v]) => {
      const g = v.glbRest, f = v.fbxRest;
      console.log(`  ${name}  GLB=(${g?.x.toFixed(3)},${g?.y.toFixed(3)},${g?.z.toFixed(3)},${g?.w.toFixed(3)})  FBX=(${f?.x.toFixed(3)},${f?.y.toFixed(3)},${f?.z.toFixed(3)},${f?.w.toFixed(3)})`);
    });
    console.groupEnd();
    console.group('Unmatched GLB bones');
    unmatched.forEach(([name]) => console.log(`  ${name}`));
    console.groupEnd();
    console.groupEnd();
  };
  panel.append(inspectBtn);

  // ── Playback
  section('⏱ Playback');
  slider('Time Scale', 'timeScale', 0, 3, 0.01);

  // ── Track Filters
  section('🔧 Track Filters');
  toggle('Keep Position Tracks', 'keepPosition');
  toggle('Keep Quaternion Tracks', 'keepQuaternion');
  toggle('Keep Scale Tracks', 'keepScale');
  toggle('Strip Root Position', 'stripRootPosition');

  // ── Scene Transform
  section('📐 Scene Transform');
  slider('Target Height',    'targetHeight',         0.2, 3.0, 0.01);
  slider('Scale Multiplier', 'sceneScaleMultiplier', 0.1, 4.0, 0.01);
  slider('Y Offset',         'sceneOffsetY',        -2,   2,   0.01);
  slider('Lean (rotX °)',    'sceneRotX',           -30,  30,  0.5);

  // ── Extra root rotation
  section('🌍 Extra Root Rotation (°)');
  note('Added on top of the baked Y+180. Use only if something is still off.');
  slider('rootPreRotX', 'rootPreRotX', -180, 180, 1);
  slider('rootPreRotY', 'rootPreRotY', -180, 180, 1);
  slider('rootPreRotZ', 'rootPreRotZ', -180, 180, 1);

  // ── Global flip (escape hatch)
  section('🌐 Global Quaternion Flip');
  note('Flips ALL bones — rarely needed with bindPose active.');
  toggle('Flip X (all bones)', 'flipCorrectX');
  toggle('Flip Y (all bones)', 'flipCorrectY');
  toggle('Flip Z (all bones)', 'flipCorrectZ');

  // ── Per-bone corrections
  section('🦴 Per-Bone Corrections');
  note('flipX/Y/Z negates that quaternion component per keyframe. euler adds a local offset.');

  DEFAULT_BONE_ROWS.forEach(boneName => {
    const cfg = fbxAnimConfig.boneCorrections[boneName];
    const grp = el('div', {
      background: '#12121e', borderRadius: '4px',
      padding: '5px 8px', marginBottom: '5px', border: '1px solid #1e1e30',
    });

    const nameRow = el('div', { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' });
    const nameLbl = el('span', { color: '#ffa', fontSize: '10px', fontWeight: 'bold' });
    nameLbl.textContent = boneName.replace('mixamorig', '');
    const restHint = el('span', { color: '#444', fontSize: '9px' });
    restHint.id = `fbxdbg-rest-${boneName}`;
    const info = boneInfoRegistry[boneName];
    if (info?.fbxRest) {
      const f = info.fbxRest;
      restHint.textContent = `FBX: (${f.x.toFixed(2)},${f.y.toFixed(2)},${f.z.toFixed(2)},${f.w.toFixed(2)})`;
    }
    nameRow.append(nameLbl, restHint);
    grp.append(nameRow);

    // flipX/Y/Z checkboxes
    const flipRow = el('div', { display: 'flex', gap: '12px', marginBottom: '5px' });
    ['flipX', 'flipY', 'flipZ'].forEach((fkey, i) => {
      const color = ['#f66', '#6f6', '#66f'][i];
      const lbl = el('label', { cursor: 'pointer', color });
      const cb = el('input'); cb.type = 'checkbox'; cb.checked = !!cfg[fkey];
      cb.addEventListener('change', () => { cfg[fkey] = cb.checked; fbxAnimConfig._dirty = true; });
      lbl.prepend(cb);
      lbl.append(` flip${'XYZ'[i]}`);
      flipRow.append(lbl);
    });
    grp.append(flipRow);

    // euler sliders
    ['ex', 'ey', 'ez'].forEach((ekey, i) => {
      const color = ['#f66', '#6f6', '#66f'][i];
      const row = el('div', { display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '3px' });
      const axisLbl = el('span', { width: '14px', color, flexShrink: '0' });
      axisLbl.textContent = 'XYZ'[i];
      const inp = el('input', { flex: '1', accentColor: color });
      Object.assign(inp, { type: 'range', min: -180, max: 180, step: 1, value: cfg[ekey] ?? 0 });
      const valSpan = el('span', { width: '38px', textAlign: 'right' });
      valSpan.textContent = inp.value + '°';
      inp.addEventListener('input', () => {
        cfg[ekey] = parseFloat(inp.value);
        valSpan.textContent = inp.value + '°';
        fbxAnimConfig._dirty = true;
      });
      row.append(axisLbl, inp, valSpan);
      grp.append(row);
    });

    panel.append(grp);
  });

  // ── Buttons
  const rebuildBtn = el('button', {
    marginTop: '10px', width: '100%', padding: '6px',
    background: '#2255aa', border: 'none', borderRadius: '4px',
    color: '#fff', cursor: 'pointer', fontSize: '12px',
  });
  rebuildBtn.textContent = '🔁 Rebuild Animation Clip';
  rebuildBtn.onclick = () => { fbxAnimConfig._dirty = true; };
  panel.append(rebuildBtn);

  const resetBtn = el('button', {
    marginTop: '6px', width: '100%', padding: '6px',
    background: '#553322', border: 'none', borderRadius: '4px',
    color: '#fff', cursor: 'pointer', fontSize: '12px',
  });
  resetBtn.textContent = '↺ Reset All';
  resetBtn.onclick = () => {
    Object.assign(fbxAnimConfig, {
      timeScale: 1.0, keepPosition: true, keepQuaternion: true, keepScale: false,
      stripRootPosition: true, targetHeight: 1.0, sceneScaleMultiplier: 1.0, sceneOffsetY: 0.0,
      sceneRotX: -45, rootPreRotX: 0, rootPreRotY: 0, rootPreRotZ: 0,
      flipCorrectX: false, flipCorrectY: false, flipCorrectZ: false, _dirty: true,
    });
    DEFAULT_BONE_ROWS.forEach(b => {
      fbxAnimConfig.boneCorrections[b] = { flipX: false, flipY: false, flipZ: false, ex: 0, ey: 0, ez: 0 };
    });
    panel.remove();
    _panel = buildPanel();
    document.body.append(_panel);
  };
  panel.append(resetBtn);

  return panel;
}

let _panel = null;

export function initFbxAnimDebugPanel() {
  if (_panel) return;
  _panel = buildPanel();
  document.body.append(_panel);
  window.__fbxAnimDebug = {
    toggle:       () => { _panel.style.display = _panel.style.display === 'none' ? '' : 'none'; },
    show:         () => { _panel.style.display = ''; },
    hide:         () => { _panel.style.display = 'none'; },
    config:       fbxAnimConfig,
    boneInfo:     boneInfoRegistry,
    refreshPanel: () => { _panel?.remove(); _panel = buildPanel(); document.body.append(_panel); },
  };
  console.info('[FBXAnimDebug] Panel ready. window.__fbxAnimDebug.toggle() to show/hide.');
}

/**
 * Debug panel for FBX→GLB animation retargeting.
 * Exposes sliders/toggles for track filtering, per-bone corrections, and playback params.
 * Toggle visibility with: window.__fbxAnimDebug.toggle()
 *
 * Key insight: global axis flips don't work because each bone's rest pose may differ
 * between the FBX source and the GLB target. Use per-bone flips + euler offsets instead.
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

  // Height normalization
  targetHeight: 1.0,
  sceneScaleMultiplier: 1.0,
  sceneOffsetY: 0.0,

  // Root pre-rotation — applied to the Hips bone's position track to re-orient
  // the whole skeleton. Mixamo FBX exports often have a -90° or 90° X baked in
  // that doesn't survive clip extraction. Try -90 first.
  rootPreRotX: 0,
  rootPreRotY: 0,
  rootPreRotZ: 0,

  // Global quaternion flip (kept for reference, usually not enough on its own)
  flipCorrectX: false,
  flipCorrectY: false,
  flipCorrectZ: false,

  // Per-bone config — keyed by bone name
  // Each entry: { flipX, flipY, flipZ, ex, ey, ez }
  //   flipX/Y/Z: negate that quaternion component on every keyframe for this bone
  //   ex/ey/ez: additional euler offset in degrees (post-multiply)
  boneCorrections: {},

  // Retargeting mode:
  //   'direct'   – apply FBX tracks as-is to matching bone names (current behaviour)
  //   'bindPose' – pre-multiply each keyframe by (glbBoneRestInv * fbxBoneRest) to
  //                compensate for rest-pose differences (more correct but needs both skeletons)
  retargetMode: 'bindPose',

  _dirty: false,
};

// Bones to show in the panel by default — use actual mixamorig-prefixed names
const DEFAULT_BONE_ROWS = [
  'mixamorigHips',
  'mixamorigLeftUpLeg',  'mixamorigRightUpLeg',
  'mixamorigLeftLeg',    'mixamorigRightLeg',
  'mixamorigLeftFoot',   'mixamorigRightFoot',
  'mixamorigLeftToeBase','mixamorigRightToeBase',
  'mixamorigSpine', 'mixamorigSpine1', 'mixamorigSpine2',
  'mixamorigNeck', 'mixamorigHead',
  'mixamorigLeftShoulder',  'mixamorigRightShoulder',
  'mixamorigLeftArm',   'mixamorigRightArm',
  'mixamorigLeftForeArm','mixamorigRightForeArm',
];
DEFAULT_BONE_ROWS.forEach(b => {
  fbxAnimConfig.boneCorrections[b] = { flipX: false, flipY: false, flipZ: false, ex: 0, ey: 0, ez: 0 };
});

// ─── Bone info registry (filled by glbCharacterModel) ──────────────────────
// Maps boneName → { glbRest: Quaternion, fbxRest: Quaternion|null, tracked: bool }
export const boneInfoRegistry = {};

// ─── Panel helpers ─────────────────────────────────────────────────────────
function el(tag, styles, props) {
  const e = document.createElement(tag);
  if (styles) Object.assign(e.style, styles);
  if (props) Object.assign(e, props);
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

  // Header
  const header = el('div', { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' });
  const title = el('b', { fontSize: '13px' });
  title.textContent = '🎞 FBX→GLB Anim Debug';
  const closeBtn = el('button', { background: 'none', border: 'none', color: '#aaa', fontSize: '18px', cursor: 'pointer', lineHeight: '1' });
  closeBtn.textContent = '×';
  closeBtn.onclick = () => { panel.style.display = 'none'; };
  header.append(title, closeBtn);
  panel.append(header);

  function section(label) {
    const d = el('div', { color: '#88aaff', fontWeight: 'bold', margin: '10px 0 5px', borderBottom: '1px solid #333', paddingBottom: '2px' });
    d.textContent = label;
    panel.append(d);
  }

  function note(text) {
    const d = el('div', { color: '#777', marginBottom: '6px', lineHeight: '1.4' });
    d.textContent = text;
    panel.append(d);
  }

  function slider(label, key, min, max, step) {
    const row = el('div', { display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' });
    const lbl = el('span', { width: '130px', flexShrink: '0' });
    lbl.textContent = label;
    const inp = el('input', { flex: '1', accentColor: '#5af' });
    Object.assign(inp, { type: 'range', min, max, step, value: fbxAnimConfig[key] ?? 0 });
    const valSpan = el('span', { width: '46px', textAlign: 'right' });
    const decimals = step < 0.01 ? 3 : step < 0.1 ? 2 : 1;
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

  // ── Bone Inspector button
  section('🔍 Bone Inspector');
  note('Prints matched/unmatched bones and rest-pose quaternions to the console.');
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
      const g = v.glbRest;
      console.log(`  ${name}  GLB rest: xyzw=(${g.x.toFixed(3)},${g.y.toFixed(3)},${g.z.toFixed(3)},${g.w.toFixed(3)})`);
    });
    console.groupEnd();
    console.group('Unmatched GLB bones (no FBX track)');
    unmatched.forEach(([name]) => console.log(`  ${name}`));
    console.groupEnd();
    console.groupEnd();
  };
  panel.append(inspectBtn);

  // ── Retarget mode
  section('🎯 Retarget Mode');
  note('"direct" applies FBX tracks by name. "bindPose" compensates for rest-pose differences between skeletons — usually fixes upside-down limbs properly.');
  const modeRow = el('div', { display: 'flex', gap: '8px', marginBottom: '6px' });
  ['direct', 'bindPose'].forEach(mode => {
    const btn = el('button', {
      flex: '1', padding: '5px', cursor: 'pointer', borderRadius: '4px',
      border: fbxAnimConfig.retargetMode === mode ? '2px solid #5af' : '1px solid #444',
      background: fbxAnimConfig.retargetMode === mode ? '#1a3050' : '#181828',
      color: fbxAnimConfig.retargetMode === mode ? '#5af' : '#aaa',
      fontSize: '11px',
    });
    btn.textContent = mode;
    btn.onclick = () => {
      fbxAnimConfig.retargetMode = mode;
      fbxAnimConfig._dirty = true;
      // Rebuild panel to update button styles
      panel.remove();
      document.body.append(buildPanel());
    };
    modeRow.append(btn);
  });
  panel.append(modeRow);

  // ── Root pre-rotation
  section('🌍 Root Pre-Rotation (°)');
  note('Applied to the root/Hips bone to re-orient the whole skeleton. Mixamo FBX exports often bake a ±90° X-axis rotation — try rootPreRotX = -90 first if the character is upside-down or underground.');
  slider('rootPreRotX', 'rootPreRotX', -180, 180, 1);
  slider('rootPreRotY', 'rootPreRotY', -180, 180, 1);
  slider('rootPreRotZ', 'rootPreRotZ', -180, 180, 1);

  // ── Playback
  section('⏱ Playback');
  slider('Time Scale', 'timeScale', 0, 3, 0.01);

  // ── Track Filters
  section('🔧 Track Filters');
  toggle('Keep Position Tracks', 'keepPosition');
  toggle('Keep Quaternion Tracks', 'keepQuaternion');
  toggle('Keep Scale Tracks', 'keepScale');
  toggle('Strip Root Position', 'stripRootPosition');

  // ── Global flip (coarse, for reference)
  section('🌐 Global Quaternion Flip');
  note('Flips ALL bones on this axis — rarely correct by itself.');
  toggle('Flip X (all bones)', 'flipCorrectX');
  toggle('Flip Y (all bones)', 'flipCorrectY');
  toggle('Flip Z (all bones)', 'flipCorrectZ');

  // ── Scene transform
  section('📐 Scene Transform');
  slider('Target Height',      'targetHeight',         0.2, 3.0, 0.01);
  slider('Scale Multiplier',   'sceneScaleMultiplier', 0.1, 4.0, 0.01);
  slider('Y Offset',           'sceneOffsetY',        -2,   2,   0.01);

  // ── Per-bone corrections
  section('🦴 Per-Bone Corrections');
  note('flipX/Y/Z negates that quaternion component per-keyframe for this bone. euler adds a rotation on top.');

  DEFAULT_BONE_ROWS.forEach(boneName => {
    const cfg = fbxAnimConfig.boneCorrections[boneName];
    const grp = el('div', {
      background: '#12121e', borderRadius: '4px',
      padding: '5px 8px', marginBottom: '5px', border: '1px solid #222',
    });

    // Bone name + rest pose hint
    const nameRow = el('div', { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' });
    const nameLbl = el('span', { color: '#ffa', fontSize: '10px', fontWeight: 'bold' });
    nameLbl.textContent = boneName;
    const restHint = el('span', { color: '#555', fontSize: '9px' });
    restHint.id = `fbxdbg-rest-${boneName}`;
    const info = boneInfoRegistry[boneName];
    if (info?.glbRest) {
      const q = info.glbRest;
      restHint.textContent = `GLB: (${q.x.toFixed(2)},${q.y.toFixed(2)},${q.z.toFixed(2)},${q.w.toFixed(2)})`;
    } else {
      restHint.textContent = 'loading…';
    }
    nameRow.append(nameLbl, restHint);
    grp.append(nameRow);

    // Flip checkboxes
    const flipRow = el('div', { display: 'flex', gap: '12px', marginBottom: '5px' });
    ['flipX', 'flipY', 'flipZ'].forEach((fkey, i) => {
      const axis = ['X', 'Y', 'Z'][i];
      const color = ['#f66', '#6f6', '#66f'][i];
      const lbl = el('label', { cursor: 'pointer', color });
      const cb = el('input');
      cb.type = 'checkbox';
      cb.checked = !!cfg[fkey];
      cb.addEventListener('change', () => { cfg[fkey] = cb.checked; fbxAnimConfig._dirty = true; });
      lbl.prepend(cb);
      lbl.append(` flip${axis}`);
      flipRow.append(lbl);
    });
    grp.append(flipRow);

    // Euler sliders
    ['ex', 'ey', 'ez'].forEach((ekey, i) => {
      const axis = ['X', 'Y', 'Z'][i];
      const color = ['#f66', '#6f6', '#66f'][i];
      const row = el('div', { display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '3px' });
      const axisLbl = el('span', { width: '14px', color, flexShrink: '0' });
      axisLbl.textContent = axis;
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

  // ── Action buttons
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
      stripRootPosition: true, flipCorrectX: false, flipCorrectY: false, flipCorrectZ: false,
      rootPreRotX: 0, rootPreRotY: 0, rootPreRotZ: 0,
      targetHeight: 1.0, sceneScaleMultiplier: 1.0, sceneOffsetY: 0.0,
      retargetMode: 'bindPose', _dirty: true,
    });
    DEFAULT_BONE_ROWS.forEach(b => {
      fbxAnimConfig.boneCorrections[b] = { flipX: false, flipY: false, flipZ: false, ex: 0, ey: 0, ez: 0 };
    });
    panel.remove();
    document.body.append(buildPanel());
  };
  panel.append(resetBtn);

  return panel;
}

// ─── Mount ────────────────────────────────────────────────────────────────
let _panel = null;

export function initFbxAnimDebugPanel() {
  if (_panel) return;
  _panel = buildPanel();
  document.body.append(_panel);
  window.__fbxAnimDebug = {
    toggle: () => { _panel.style.display = _panel.style.display === 'none' ? '' : 'none'; },
    show:   () => { _panel.style.display = ''; },
    hide:   () => { _panel.style.display = 'none'; },
    config: fbxAnimConfig,
    boneInfo: boneInfoRegistry,
    /** Rebuild the panel UI (e.g. after bone info loads) */
    refreshPanel: () => { _panel?.remove(); _panel = buildPanel(); document.body.append(_panel); },
  };
  console.info('[FBXAnimDebug] Panel ready. window.__fbxAnimDebug.toggle() to show/hide.');
}

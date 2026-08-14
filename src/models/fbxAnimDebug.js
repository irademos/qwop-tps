/**
 * Debug panel for FBX→GLB animation retargeting.
 * Exposes sliders for track filtering, bone rotation corrections, and playback params.
 * Toggle visibility with: window.__fbxAnimDebug.toggle()
 */

import * as THREE from 'three';

// Exported config object — glbCharacterModel.js reads from this every frame/rebuild
export const fbxAnimConfig = {
  // Playback
  timeScale: 1.0,

  // Track type toggles
  keepPosition: true,
  keepQuaternion: true,
  keepScale: false,

  // Root bone position strip
  stripRootPosition: true,

  // Bone name overrides: maps bone name fragments to euler correction (degrees)
  // Applied as a pre-rotation to every keyframe on matching bones
  boneCorrections: {
    // e.g. 'LeftUpLeg': { x: 0, y: 0, z: 0 }
  },

  // Height normalization
  targetHeight: 1.0,

  // Scene Y offset (tweaks foot planting)
  sceneOffsetY: 0.0,

  // Global scene scale multiplier (applied on top of height normalization)
  sceneScaleMultiplier: 1.0,

  // Quaternion track: apply world-space flip correction (fixes upside-down legs)
  flipCorrectX: false,
  flipCorrectY: false,
  flipCorrectZ: false,

  // Force rebind — toggled true briefly to trigger a clip rebuild in glbCharacterModel
  _dirty: false,
};

// ─── Bone correction rows (user can add more via console) ──────────────────
// Pre-populate with bones most likely to misbehave
const DEFAULT_BONE_ROWS = [
  'Hips',
  'LeftUpLeg',
  'RightUpLeg',
  'LeftLeg',
  'RightLeg',
  'LeftFoot',
  'RightFoot',
  'Spine',
  'Spine1',
  'LeftArm',
  'RightArm',
];
DEFAULT_BONE_ROWS.forEach(b => {
  fbxAnimConfig.boneCorrections[b] = { x: 0, y: 0, z: 0 };
});

// ─── Panel build ──────────────────────────────────────────────────────────
function buildPanel() {
  const panel = document.createElement('div');
  panel.id = 'fbx-anim-debug';
  Object.assign(panel.style, {
    position: 'fixed',
    top: '60px',
    right: '10px',
    width: '320px',
    maxHeight: '80vh',
    overflowY: 'auto',
    background: 'rgba(10,10,20,0.92)',
    border: '1px solid #444',
    borderRadius: '8px',
    padding: '10px 14px 14px',
    fontFamily: 'monospace',
    fontSize: '11px',
    color: '#ddd',
    zIndex: 99999,
    userSelect: 'none',
  });

  // ── Header
  const header = document.createElement('div');
  Object.assign(header.style, { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' });
  const title = document.createElement('b');
  title.textContent = '🎞 FBX Anim Debug';
  title.style.fontSize = '13px';
  const closeBtn = document.createElement('button');
  closeBtn.textContent = '×';
  Object.assign(closeBtn.style, { background: 'none', border: 'none', color: '#aaa', fontSize: '18px', cursor: 'pointer', lineHeight: 1 });
  closeBtn.onclick = () => { panel.style.display = 'none'; };
  header.append(title, closeBtn);
  panel.append(header);

  function section(label) {
    const el = document.createElement('div');
    Object.assign(el.style, { color: '#88aaff', fontWeight: 'bold', margin: '10px 0 4px', borderBottom: '1px solid #333', paddingBottom: '2px' });
    el.textContent = label;
    panel.append(el);
  }

  function slider(label, key, min, max, step, onChange) {
    const row = document.createElement('div');
    Object.assign(row.style, { display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' });

    const lbl = document.createElement('span');
    lbl.style.width = '130px';
    lbl.style.flexShrink = '0';
    lbl.textContent = label;

    const inp = document.createElement('input');
    inp.type = 'range';
    inp.min = min;
    inp.max = max;
    inp.step = step;
    inp.value = fbxAnimConfig[key] ?? 0;
    Object.assign(inp.style, { flex: '1', accentColor: '#5af' });

    const val = document.createElement('span');
    val.style.width = '46px';
    val.style.textAlign = 'right';
    val.textContent = Number(inp.value).toFixed(step < 0.01 ? 3 : 2);

    inp.addEventListener('input', () => {
      fbxAnimConfig[key] = parseFloat(inp.value);
      val.textContent = Number(inp.value).toFixed(step < 0.01 ? 3 : 2);
      fbxAnimConfig._dirty = true;
      if (onChange) onChange(parseFloat(inp.value));
    });

    row.append(lbl, inp, val);
    panel.append(row);
    return inp;
  }

  function toggle(label, key, onChange) {
    const row = document.createElement('div');
    Object.assign(row.style, { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' });

    const inp = document.createElement('input');
    inp.type = 'checkbox';
    inp.checked = !!fbxAnimConfig[key];
    inp.addEventListener('change', () => {
      fbxAnimConfig[key] = inp.checked;
      fbxAnimConfig._dirty = true;
      if (onChange) onChange(inp.checked);
    });

    const lbl = document.createElement('label');
    lbl.textContent = label;
    lbl.style.cursor = 'pointer';
    lbl.prepend(inp);
    row.append(lbl);
    panel.append(row);
  }

  function boneSection(boneName) {
    const grp = document.createElement('div');
    Object.assign(grp.style, { background: '#1a1a2e', borderRadius: '4px', padding: '4px 8px', marginBottom: '4px' });

    const lbl = document.createElement('div');
    Object.assign(lbl.style, { color: '#ffa', marginBottom: '3px', fontSize: '10px' });
    lbl.textContent = boneName;
    grp.append(lbl);

    ['x', 'y', 'z'].forEach(axis => {
      const row = document.createElement('div');
      Object.assign(row.style, { display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '3px' });

      const axisLbl = document.createElement('span');
      axisLbl.style.width = '14px';
      axisLbl.style.color = axis === 'x' ? '#f66' : axis === 'y' ? '#6f6' : '#66f';
      axisLbl.textContent = axis.toUpperCase();

      const inp = document.createElement('input');
      inp.type = 'range';
      inp.min = -180;
      inp.max = 180;
      inp.step = 1;
      inp.value = fbxAnimConfig.boneCorrections[boneName]?.[axis] ?? 0;
      Object.assign(inp.style, { flex: '1', accentColor: axis === 'x' ? '#f66' : axis === 'y' ? '#6f6' : '#66f' });

      const val = document.createElement('span');
      val.style.width = '36px';
      val.style.textAlign = 'right';
      val.textContent = inp.value + '°';

      inp.addEventListener('input', () => {
        if (!fbxAnimConfig.boneCorrections[boneName]) fbxAnimConfig.boneCorrections[boneName] = { x: 0, y: 0, z: 0 };
        fbxAnimConfig.boneCorrections[boneName][axis] = parseFloat(inp.value);
        val.textContent = inp.value + '°';
        fbxAnimConfig._dirty = true;
      });

      row.append(axisLbl, inp, val);
      grp.append(row);
    });

    panel.append(grp);
  }

  // ── Playback
  section('⏱ Playback');
  slider('Time Scale', 'timeScale', 0, 3, 0.01);

  // ── Track Filters
  section('🔧 Track Filters');
  toggle('Keep Position Tracks', 'keepPosition');
  toggle('Keep Quaternion Tracks', 'keepQuaternion');
  toggle('Keep Scale Tracks', 'keepScale');
  toggle('Strip Root Position', 'stripRootPosition');

  // ── Flip Corrections
  section('🔄 Axis Flip Corrections');

  const note = document.createElement('div');
  note.style.color = '#888';
  note.style.marginBottom = '6px';
  note.textContent = 'Flips all quaternion keyframes on the chosen axis (fixes upside-down limbs)';
  panel.append(note);

  toggle('Flip X axis', 'flipCorrectX');
  toggle('Flip Y axis', 'flipCorrectY');
  toggle('Flip Z axis', 'flipCorrectZ');

  // ── Scene transform
  section('📐 Scene Transform');
  slider('Target Height', 'targetHeight', 0.2, 3.0, 0.01);
  slider('Scale Multiplier', 'sceneScaleMultiplier', 0.1, 4.0, 0.01);
  slider('Y Offset', 'sceneOffsetY', -2, 2, 0.01);

  // ── Bone corrections
  section('🦴 Bone Rotation Corrections (°)');

  const boneNote = document.createElement('div');
  boneNote.style.color = '#888';
  boneNote.style.marginBottom = '6px';
  boneNote.textContent = 'Per-bone euler offset applied to every keyframe. Use to un-flip individual bones.';
  panel.append(boneNote);

  DEFAULT_BONE_ROWS.forEach(b => boneSection(b));

  // ── Rebuild button
  const rebuildBtn = document.createElement('button');
  rebuildBtn.textContent = '🔁 Rebuild Animation Clip';
  Object.assign(rebuildBtn.style, {
    marginTop: '10px',
    width: '100%',
    padding: '6px',
    background: '#2255aa',
    border: 'none',
    borderRadius: '4px',
    color: '#fff',
    cursor: 'pointer',
    fontSize: '12px',
  });
  rebuildBtn.onclick = () => { fbxAnimConfig._dirty = true; };
  panel.append(rebuildBtn);

  // ── Reset button
  const resetBtn = document.createElement('button');
  resetBtn.textContent = '↺ Reset All to Defaults';
  Object.assign(resetBtn.style, {
    marginTop: '6px',
    width: '100%',
    padding: '6px',
    background: '#553322',
    border: 'none',
    borderRadius: '4px',
    color: '#fff',
    cursor: 'pointer',
    fontSize: '12px',
  });
  resetBtn.onclick = () => {
    fbxAnimConfig.timeScale = 1.0;
    fbxAnimConfig.keepPosition = true;
    fbxAnimConfig.keepQuaternion = true;
    fbxAnimConfig.keepScale = false;
    fbxAnimConfig.stripRootPosition = true;
    fbxAnimConfig.flipCorrectX = false;
    fbxAnimConfig.flipCorrectY = false;
    fbxAnimConfig.flipCorrectZ = false;
    fbxAnimConfig.targetHeight = 1.0;
    fbxAnimConfig.sceneScaleMultiplier = 1.0;
    fbxAnimConfig.sceneOffsetY = 0.0;
    DEFAULT_BONE_ROWS.forEach(b => { fbxAnimConfig.boneCorrections[b] = { x: 0, y: 0, z: 0 }; });
    fbxAnimConfig._dirty = true;
    // Re-render by rebuilding the panel
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
    show: () => { _panel.style.display = ''; },
    hide: () => { _panel.style.display = 'none'; },
    config: fbxAnimConfig,
  };

  console.info('[FBXAnimDebug] Panel mounted. Use window.__fbxAnimDebug.toggle() to show/hide.');
}

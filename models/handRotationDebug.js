/**
 * Debug panel for tuning GLB hand rotation mapping.
 * Import and call initHandRotationDebug() once; then read handRotConfig
 * each frame from updateGLBHandSceneRotation.
 *
 * Remove this file and its import when tuning is done.
 */

import * as THREE from 'three';

// ── shared config object (mutated by UI, read by rotation code) ──────────────
export const handRotConfig = {
  // Euler offset post-multiplied onto the computed orientation (degrees).
  offsetX: 180,
  offsetY: -180,
  offsetZ: 0,
  offsetOrder: 'XYZ',

  // Extra rotation (degrees) around the hand's own FINGER axis (GLB local Y).
  // Useful for fixing "palm 180° off" without touching the global offset.
  palmAxisDeg: 0,

  // Flip the computed palm normal before deriving the right axis.
  // Equivalent to rotating 180° around the finger axis — try this first
  // when palm faces camera instead of forward.
  flipNormal: false,

  // Signs applied to the final quaternion components (1 or -1).
  signW: 1,
  signX: 1,
  signY: -1,
  signZ: 1,

  // Across-palm axis: +1 → pts[17]-pts[5], -1 → pts[5]-pts[17]
  acrossSign: 1,

  // Palm normal cross product order
  crossOrder: 'across_x_finger',

  // Which landmark indices define the finger direction (wrist, tip-of-palm).
  // Default 0→9 (wrist→middle MCP). Try 0→12 (wrist→middle tip) for fist.
  fingerLmA: 0,
  fingerLmB: 9,

  // Which landmark indices define the across-palm axis.
  // Default 17→5 (pinky MCP → index MCP).
  acrossLmA: 17,
  acrossLmB: 5,

  // Smoothing speed (1=slow, 40=instant)
  smoothing: 14,
};

// ── cached THREE objects (no allocation in hot path) ─────────────────────────
const _offsetQ    = new THREE.Quaternion();
const _offsetE    = new THREE.Euler();
const _palmAxisQ  = new THREE.Quaternion();
const _palmAxisV  = new THREE.Vector3(0, 1, 0); // GLB local Y = finger axis

export function getOffsetQuaternion() {
  _offsetE.set(
    handRotConfig.offsetX * (Math.PI / 180),
    handRotConfig.offsetY * (Math.PI / 180),
    handRotConfig.offsetZ * (Math.PI / 180),
    handRotConfig.offsetOrder,
  );
  _offsetQ.setFromEuler(_offsetE);

  if (handRotConfig.palmAxisDeg !== 0) {
    _palmAxisQ.setFromAxisAngle(_palmAxisV, handRotConfig.palmAxisDeg * (Math.PI / 180));
    _offsetQ.multiply(_palmAxisQ);
  }
  return _offsetQ;
}

// ── hand position offset (applied on top of tracked wrist position) ───────────
export const handPosOffset = { x: 0.01, y: 0.09, z: -0.05 };

export const armConfig = { thickness: 0.4 };

// ── brush position/rotation config (painter mode only) ───────────────────────
export const brushConfig = {
  offsetX: 0,
  offsetY: 0.05,
  offsetZ: 0.05,
  rotX: Math.PI * 0.15,
  rotY: 0,
  rotZ: 0,
};

// ── debug panel (painter mode only) ─────────────────────────────────────────
let _panel = null;
let _paintBrush = null;

export function setPainterDebugBrush(brush) {
  _paintBrush = brush;
}

export function initHandRotationDebug() {
  if (window.gameMode !== '3d_painter') return;
  if (_panel) return;

  _panel = document.createElement('div');
  _panel.id = 'painter-debug-panel';
  Object.assign(_panel.style, {
    position: 'fixed',
    top: '10px',
    right: '10px',
    width: '280px',
    background: 'rgba(0,0,0,0.82)',
    color: '#fff',
    fontFamily: 'monospace',
    fontSize: '12px',
    padding: '10px 12px 12px',
    borderRadius: '8px',
    zIndex: '9999',
    userSelect: 'none',
    boxSizing: 'border-box',
  });

  function section(label) {
    const h = document.createElement('div');
    Object.assign(h.style, { margin: '10px 0 4px', fontWeight: 'bold', color: '#adf', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em' });
    h.textContent = label;
    _panel.appendChild(h);
  }

  function slider(label, min, max, step, getValue, setValue) {
    const row = document.createElement('div');
    Object.assign(row.style, { display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '3px' });

    const lbl = document.createElement('span');
    lbl.style.width = '46px';
    lbl.style.flexShrink = '0';
    lbl.textContent = label;

    const inp = document.createElement('input');
    inp.type = 'range';
    inp.min = min;
    inp.max = max;
    inp.step = step;
    inp.value = getValue();
    Object.assign(inp.style, { flex: '1', accentColor: '#6af' });

    const val = document.createElement('span');
    val.style.width = '48px';
    val.style.textAlign = 'right';
    val.style.flexShrink = '0';
    val.textContent = Number(getValue()).toFixed(3);

    inp.addEventListener('input', () => {
      const n = parseFloat(inp.value);
      setValue(n);
      val.textContent = n.toFixed(3);
    });

    row.appendChild(lbl);
    row.appendChild(inp);
    row.appendChild(val);
    _panel.appendChild(row);
  }

  // ── Brush position relative to hand ──────────────────────────────────────
  section('Brush position (hand-relative)');
  slider('pos X', -0.3, 0.3, 0.001, () => brushConfig.offsetX, v => {
    brushConfig.offsetX = v;
    if (_paintBrush) _paintBrush._holdOffset.set(brushConfig.offsetX, brushConfig.offsetY, brushConfig.offsetZ);
  });
  slider('pos Y', -0.3, 0.3, 0.001, () => brushConfig.offsetY, v => {
    brushConfig.offsetY = v;
    if (_paintBrush) _paintBrush._holdOffset.set(brushConfig.offsetX, brushConfig.offsetY, brushConfig.offsetZ);
  });
  slider('pos Z', -0.3, 0.3, 0.001, () => brushConfig.offsetZ, v => {
    brushConfig.offsetZ = v;
    if (_paintBrush) _paintBrush._holdOffset.set(brushConfig.offsetX, brushConfig.offsetY, brushConfig.offsetZ);
  });

  // ── Brush rotation relative to hand ──────────────────────────────────────
  section('Brush rotation (hand-relative, deg)');
  function updateBrushRot() {
    if (!_paintBrush) return;
    const e = new THREE.Euler(brushConfig.rotX, brushConfig.rotY, brushConfig.rotZ, 'YXZ');
    _paintBrush._holdQuaternion.setFromEuler(e);
  }
  slider('rot X', -180, 180, 0.5, () => brushConfig.rotX * (180 / Math.PI), v => {
    brushConfig.rotX = v * (Math.PI / 180);
    updateBrushRot();
  });
  slider('rot Y', -180, 180, 0.5, () => brushConfig.rotY * (180 / Math.PI), v => {
    brushConfig.rotY = v * (Math.PI / 180);
    updateBrushRot();
  });
  slider('rot Z', -180, 180, 0.5, () => brushConfig.rotZ * (180 / Math.PI), v => {
    brushConfig.rotZ = v * (Math.PI / 180);
    updateBrushRot();
  });

  // ── Hand position relative to arm ────────────────────────────────────────
  section('Hand position (arm-relative)');
  slider('pos X', -0.3, 0.3, 0.001, () => handPosOffset.x, v => { handPosOffset.x = v; });
  slider('pos Y', -0.3, 0.3, 0.001, () => handPosOffset.y, v => { handPosOffset.y = v; });
  slider('pos Z', -0.3, 0.3, 0.001, () => handPosOffset.z, v => { handPosOffset.z = v; });

  // ── Copy button ───────────────────────────────────────────────────────────
  const copyBtn = document.createElement('button');
  copyBtn.textContent = 'Copy values';
  Object.assign(copyBtn.style, {
    marginTop: '10px',
    width: '100%',
    padding: '5px 0',
    background: '#2a6',
    color: '#fff',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontFamily: 'monospace',
    fontSize: '12px',
  });
  copyBtn.addEventListener('click', () => {
    const lines = [
      '// Brush position (hand-relative)',
      `holdOffset: new THREE.Vector3(${brushConfig.offsetX.toFixed(4)}, ${brushConfig.offsetY.toFixed(4)}, ${brushConfig.offsetZ.toFixed(4)}),`,
      '// Brush rotation (hand-relative)',
      `holdRotation: new THREE.Euler(${brushConfig.rotX.toFixed(4)}, ${brushConfig.rotY.toFixed(4)}, ${brushConfig.rotZ.toFixed(4)}, 'YXZ'),`,
      '// Hand position offset (arm-relative)',
      `handPosOffset: { x: ${handPosOffset.x.toFixed(4)}, y: ${handPosOffset.y.toFixed(4)}, z: ${handPosOffset.z.toFixed(4)} },`,
    ];
    navigator.clipboard.writeText(lines.join('\n')).then(() => {
      copyBtn.textContent = 'Copied!';
      setTimeout(() => { copyBtn.textContent = 'Copy values'; }, 1500);
    });
  });
  _panel.appendChild(copyBtn);

  document.body.appendChild(_panel);
}

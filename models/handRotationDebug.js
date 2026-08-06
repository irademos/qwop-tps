/**
 * Debug panel for tuning GLB hand rotation mapping and foam sword behavior.
 * Import and call initHandRotationDebug() once; then read handRotConfig
 * each frame from updateGLBHandSceneRotation.
 *
 * Remove this file and its import when tuning is done.
 */

import * as THREE from 'three';
import { pinchConfig } from '../mediapipe/handTrackingManager.js';

// ── shared config object (mutated by UI, read by rotation code) ──────────────
export const handRotConfig = {
  // Euler offset post-multiplied onto the computed orientation (degrees).
  offsetX: 240,
  offsetY: -180,
  offsetZ: 0,
  offsetOrder: 'XYZ',

  // Extra rotation (degrees) around the hand's own FINGER axis (GLB local Y).
  palmAxisDeg: 0,

  // Flip the computed palm normal before deriving the right axis.
  flipNormal: false,

  // Signs applied to the final quaternion components (1 or -1).
  signW: 1,
  signX: 1,
  signY: -1,
  signZ: 1,

  // Across-palm axis used for pitch/yaw basis: +1 → pts[17]-pts[5], -1 → pts[5]-pts[17]
  acrossSign: 1,

  // Palm normal cross product order
  crossOrder: 'across_x_finger',

  // Which landmark indices define the finger direction (wrist, tip-of-palm).
  fingerLmA: 0,
  fingerLmB: 9,

  // Which landmark indices define the across-palm axis.
  acrossLmA: 17,
  acrossLmB: 5,

  // Dynamic wrist roll: computed each frame from thumb tip (lm 4) angle around
  // the finger axis and added to offsetZ before applying the offset quaternion.
  // rollGain scales the detected angle (negative to invert); rollBase subtracts
  // a calibration offset so neutral hand position gives roll = 0.
  wristRollDeg: 0,   // written each frame by playerModel — do not set manually
  rollGain: -1.0,
  rollBase: 0,

  // Smoothing speed (1=slow, 40=instant)
  smoothing: 14,
};

// ── foam sword tuning config (mutated by UI, read by FoamSword.update()) ─────
export const foamSwordConfig = {
  // Default (rest) rotation in degrees
  defaultX: 360,
  defaultY: 90,
  defaultZ: -90,

  // Which hand screen coordinate drives the rotation: 'x' or 'y'
  handCoord: 'x',

  // Per-axis gains (deg): how much each euler axis rotates per unit sideAmount.
  // Positive = one direction, negative = reversed. Use these instead of a single
  // rotAxis+range so you can mix axes and flip directions independently.
  gainX: 360,
  gainY: 0,
  gainZ: 0,

  // Invert the hand coordinate direction
  invert: true,

  // Where "center" is on the [0,1] normalized screen coord
  handCenter: 0.5,

  // Constant offset (deg) added to the dynamic rotation on top of the gains
  dynOffset: 0,
};

// ── cached THREE objects (no allocation in hot path) ─────────────────────────
const _offsetQ    = new THREE.Quaternion();
const _offsetE    = new THREE.Euler();
const _palmAxisQ  = new THREE.Quaternion();
const _palmAxisV  = new THREE.Vector3(0, 1, 0); // GLB local Y = finger axis

export function getOffsetQuaternion() {
  const dynamicRoll = (handRotConfig.wristRollDeg - handRotConfig.rollBase) * handRotConfig.rollGain;
  _offsetE.set(
    handRotConfig.offsetX * (Math.PI / 180),
    (handRotConfig.offsetY + dynamicRoll) * (Math.PI / 180),
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

// ── live diagnostics written each frame by playerModel, read by the debug panel ──
export const handRollDiag = { rollDeg: 0, acrossX: 0, acrossZ: 0 };

// ── hand position offset (applied on top of tracked wrist position) ───────────
export const handPosOffset = { x: 0.0140, y: -0.0050, z: -0.0050 };

export const armConfig = { thickness: 0.4 };

// ── debug panel ───────────────────────────────────────────────────────────────

let _panelEl = null;

export function initHandRotationDebug() {
  if (_panelEl) return;

  const panel = document.createElement('div');
  _panelEl = panel;
  panel.id = 'hand-rot-debug';
  panel.style.cssText = `
    position: fixed;
    top: 56px;
    right: 8px;
    background: rgba(0,0,0,0.82);
    color: #eee;
    font: 12px/1.45 monospace;
    padding: 8px 10px;
    border-radius: 7px;
    z-index: 99999;
    min-width: 270px;
    max-width: 320px;
    user-select: none;
    box-shadow: 0 2px 12px rgba(0,0,0,0.55);
    pointer-events: all;
  `;

  // ── header with minimize button ──────────────────────────────────────────
  const header = document.createElement('div');
  header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;cursor:default;';

  const title = document.createElement('span');
  title.textContent = '🗡 Foam Sword Debug';
  title.style.fontWeight = 'bold';

  const minBtn = document.createElement('button');
  minBtn.textContent = '−';
  minBtn.style.cssText = `
    background: #444; color: #eee; border: none; border-radius: 4px;
    cursor: pointer; font-size: 14px; line-height: 1; padding: 1px 7px;
  `;

  header.appendChild(title);
  header.appendChild(minBtn);
  panel.appendChild(header);

  // ── collapsible body ─────────────────────────────────────────────────────
  const body = document.createElement('div');
  panel.appendChild(body);

  let minimized = false;
  minBtn.addEventListener('click', () => {
    minimized = !minimized;
    body.style.display = minimized ? 'none' : '';
    minBtn.textContent = minimized ? '+' : '−';
  });

  // ── slider factory ────────────────────────────────────────────────────────
  function addSlider(container, label, obj, key, min, max, step) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:5px;margin-bottom:3px;';

    const lbl = document.createElement('label');
    lbl.style.cssText = 'flex:0 0 130px;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
    lbl.title = label;
    lbl.textContent = label;

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = min;
    slider.max = max;
    slider.step = step;
    slider.value = obj[key];
    slider.style.cssText = 'flex:1;min-width:0;';

    const valDisplay = document.createElement('span');
    valDisplay.style.cssText = 'flex:0 0 46px;text-align:right;font-size:11px;';
    valDisplay.textContent = Number(obj[key]).toFixed(step < 0.01 ? 3 : step < 1 ? 2 : 0);

    slider.addEventListener('input', () => {
      const v = parseFloat(slider.value);
      obj[key] = v;
      valDisplay.textContent = v.toFixed(step < 0.01 ? 3 : step < 1 ? 2 : 0);
    });

    row.appendChild(lbl);
    row.appendChild(slider);
    row.appendChild(valDisplay);
    container.appendChild(row);
    return slider;
  }

  function addSection(container, text) {
    const h = document.createElement('div');
    h.style.cssText = 'margin:7px 0 3px;font-size:11px;color:#adf;font-weight:bold;letter-spacing:.5px;';
    h.textContent = text;
    container.appendChild(h);
  }

  // ── checkbox factory ──────────────────────────────────────────────────────
  function addToggle(container, label, obj, key) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:5px;margin-bottom:3px;cursor:pointer;';

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = obj[key];
    cb.style.cssText = 'cursor:pointer;';

    const lbl = document.createElement('label');
    lbl.style.cssText = 'font-size:11px;cursor:pointer;';
    lbl.textContent = label;

    cb.addEventListener('change', () => { obj[key] = cb.checked; });
    lbl.addEventListener('click', () => { cb.checked = !cb.checked; obj[key] = cb.checked; });

    row.appendChild(cb);
    row.appendChild(lbl);
    container.appendChild(row);
    return cb;
  }

  // ── select factory (for axis pickers) ─────────────────────────────────────
  function addSelect(container, label, obj, key, options) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:5px;margin-bottom:3px;';

    const lbl = document.createElement('label');
    lbl.style.cssText = 'flex:0 0 130px;font-size:11px;';
    lbl.textContent = label;

    const sel = document.createElement('select');
    sel.style.cssText = 'flex:1;background:#222;color:#eee;border:1px solid #555;border-radius:3px;font-size:11px;padding:1px 2px;';

    options.forEach(opt => {
      const el = document.createElement('option');
      el.value = opt;
      el.textContent = opt;
      if (opt === obj[key]) el.selected = true;
      sel.appendChild(el);
    });

    sel.addEventListener('change', () => { obj[key] = sel.value; });

    row.appendChild(lbl);
    row.appendChild(sel);
    container.appendChild(row);
    return sel;
  }

  // ── Foam Sword Default Rotation ───────────────────────────────────────────
  addSection(body, '— Default Rotation (deg) —');
  addSlider(body, 'defaultX', foamSwordConfig, 'defaultX', -360, 360, 1);
  addSlider(body, 'defaultY', foamSwordConfig, 'defaultY', -360, 360, 1);
  addSlider(body, 'defaultZ', foamSwordConfig, 'defaultZ', -360, 360, 1);

  // ── Foam Sword Dynamic Rotation ───────────────────────────────────────────
  addSection(body, '— Dynamic Rotation (hand position) —');
  addSelect(body, 'hand coord (x/y)', foamSwordConfig, 'handCoord', ['x', 'y']);
  addSlider(body, 'gainX (deg/side)', foamSwordConfig, 'gainX', -360, 360, 1);
  addSlider(body, 'gainY (deg/side)', foamSwordConfig, 'gainY', -360, 360, 1);
  addSlider(body, 'gainZ (deg/side)', foamSwordConfig, 'gainZ', -360, 360, 1);
  addSlider(body, 'hand center', foamSwordConfig, 'handCenter', 0, 1, 0.01);
  addSlider(body, 'dynOffset (deg)', foamSwordConfig, 'dynOffset', -180, 180, 1);
  addToggle(body, 'invert direction', foamSwordConfig, 'invert');

  // Live readout: shows the actual resulting euler angles each frame
  {
    const readout = document.createElement('div');
    readout.style.cssText = 'font-size:10px;color:#fa8;margin-top:4px;font-family:monospace;line-height:1.5;';
    body.appendChild(readout);
    setInterval(() => {
      const sign = foamSwordConfig.invert ? -1 : 1;
      // sideAmount at left edge (coord=0)
      const sideAtEdge = (foamSwordConfig.handCenter - 0) * 2 * sign;
      const ex = foamSwordConfig.defaultX + sideAtEdge * foamSwordConfig.gainX + foamSwordConfig.dynOffset;
      const ey = foamSwordConfig.defaultY + sideAtEdge * foamSwordConfig.gainY;
      const ez = foamSwordConfig.defaultZ + sideAtEdge * foamSwordConfig.gainZ;
      readout.textContent =
        `@ left edge  X:${ex.toFixed(0)}° Y:${ey.toFixed(0)}° Z:${ez.toFixed(0)}°\n` +
        `@ center     X:${foamSwordConfig.defaultX}° Y:${foamSwordConfig.defaultY}° Z:${foamSwordConfig.defaultZ}°`;
    }, 100);
  }

  // ── Copy button ───────────────────────────────────────────────────────────
  const copyBtn = document.createElement('button');
  copyBtn.textContent = '📋 Copy Values';
  copyBtn.style.cssText = `
    margin-top: 8px;
    width: 100%;
    background: #2a5; color: #fff; border: none; border-radius: 4px;
    cursor: pointer; font-size: 12px; padding: 4px 0;
  `;
  copyBtn.addEventListener('click', () => {
    const vals = {
      foamSwordConfig: { ...foamSwordConfig },
    };
    const text = JSON.stringify(vals, null, 2);
    navigator.clipboard.writeText(text).then(() => {
      copyBtn.textContent = '✓ Copied!';
      setTimeout(() => { copyBtn.textContent = '📋 Copy Values'; }, 1500);
    }).catch(() => {
      copyBtn.textContent = '✗ Failed';
      setTimeout(() => { copyBtn.textContent = '📋 Copy Values'; }, 1500);
    });
  });
  body.appendChild(copyBtn);

  document.body.appendChild(panel);
}

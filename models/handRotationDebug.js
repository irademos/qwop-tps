/**
 * Debug panel for tuning GLB hand rotation mapping and pinch detection.
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
  offsetX: 180,
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

  // Across-palm axis: +1 → pts[17]-pts[5], -1 → pts[5]-pts[17]
  acrossSign: 1,

  // Palm normal cross product order
  crossOrder: 'across_x_finger',

  // Which landmark indices define the finger direction (wrist, tip-of-palm).
  fingerLmA: 0,
  fingerLmB: 9,

  // Which landmark indices define the across-palm axis.
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
    top: 8px;
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
  title.textContent = '🖐 Hand Debug';
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

    const update = () => {
      const v = parseFloat(slider.value);
      obj[key] = v;
      valDisplay.textContent = v.toFixed(step < 0.01 ? 3 : step < 1 ? 2 : 0);
      lbl.textContent = label;
    };
    slider.addEventListener('input', update);
    lbl.textContent = label;

    row.appendChild(lbl);
    row.appendChild(slider);
    row.appendChild(valDisplay);
    container.appendChild(row);
    return slider;
  }

  function addSection(container, title) {
    const h = document.createElement('div');
    h.style.cssText = 'margin:7px 0 3px;font-size:11px;color:#adf;font-weight:bold;letter-spacing:.5px;';
    h.textContent = title;
    container.appendChild(h);
  }

  // ── GLB default rotation sliders ──────────────────────────────────────────
  addSection(body, '— GLB Rotation Offset (deg) —');
  addSlider(body, 'offsetX', handRotConfig, 'offsetX', -360, 360, 1);
  addSlider(body, 'offsetY', handRotConfig, 'offsetY', -360, 360, 1);
  addSlider(body, 'offsetZ', handRotConfig, 'offsetZ', -360, 360, 1);
  addSlider(body, 'palmAxisDeg', handRotConfig, 'palmAxisDeg', -180, 180, 1);

  addSection(body, '— Smoothing —');
  addSlider(body, 'smoothing (1=slow 40=fast)', handRotConfig, 'smoothing', 1, 40, 0.5);

  addSection(body, '— Hand Position Offset —');
  addSlider(body, 'posOffset X', handPosOffset, 'x', -0.1, 0.1, 0.001);
  addSlider(body, 'posOffset Y', handPosOffset, 'y', -0.1, 0.1, 0.001);
  addSlider(body, 'posOffset Z', handPosOffset, 'z', -0.1, 0.1, 0.001);

  addSection(body, '— Pointer↔Thumb (Pinch) —');
  addSlider(body, 'distance threshold (ratio)', pinchConfig, 'distanceThreshold', 0.1, 1.0, 0.01);
  addSlider(body, 'buffer (ms)', pinchConfig, 'bufferMs', 0, 500, 10);

  document.body.appendChild(panel);
}

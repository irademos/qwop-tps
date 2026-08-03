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
  offsetY: 0,
  offsetZ: 0,
  offsetOrder: 'XYZ',

  // Extra rotation (degrees) around the hand's own FINGER axis (GLB local Y).
  // Useful for fixing "palm 180° off" without touching the global offset.
  palmAxisDeg: 0,

  // Flip the computed palm normal before deriving the right axis.
  // true = normal points OUT OF the palm (correct for front-camera / mirrored setup).
  // false = normal points out the back of the hand.
  flipNormal: true,

  // Signs applied to the final quaternion components (1 or -1).
  // Avoid using these for orientation fixes — they break at orientation boundaries.
  // Use flipNormal / acrossSign / crossOrder instead.
  signW: 1,
  signX: 1,
  signY: 1,
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

// ── DOM panel ─────────────────────────────────────────────────────────────────
export function initHandRotationDebug() {
  if (document.getElementById('hand-rot-debug')) return;

  const panel = document.createElement('div');
  panel.id = 'hand-rot-debug';
  Object.assign(panel.style, {
    position:   'fixed',
    top:        '8px',
    right:      '8px',
    width:      '310px',
    maxHeight:  'calc(100vh - 16px)',
    overflowY:  'auto',
    background: 'rgba(0,0,0,0.85)',
    color:      '#e8e8e8',
    fontFamily: 'monospace',
    fontSize:   '12px',
    padding:    '10px 12px 12px',
    borderRadius: '8px',
    zIndex:     '9999',
    userSelect: 'none',
    lineHeight: '1.6',
    boxShadow:  '0 2px 20px rgba(0,0,0,0.7)',
  });

  panel.innerHTML = buildHTML();
  document.body.appendChild(panel);
  wireEvents(panel);
}

// ── helpers ───────────────────────────────────────────────────────────────────
const C = {
  head:   'color:#5af;font-weight:bold;margin:8px 0 2px',
  sub:    'color:#888;font-size:11px;margin:1px 0 4px',
  hint:   'color:#fa5;font-size:10px;font-style:italic',
};

function section(title, hint = '') {
  return `<div style="${C.head}">${title}</div>
          ${hint ? `<div style="${C.hint}">${hint}</div>` : ''}`;
}

function sliderRow(id, label, min, max, step, val, hint = '') {
  return `
    <label style="display:flex;align-items:center;gap:6px;margin:3px 0" title="${hint}">
      <span style="width:90px;flex-shrink:0;color:${hint?'#fd9':'inherit'}">${label}</span>
      <input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${val}"
             style="flex:1;accent-color:#5af">
      <input type="number" id="${id}-num" value="${val}" step="${step}"
             style="width:52px;background:#222;border:1px solid #444;color:#e8e8e8;border-radius:4px;padding:1px 4px;text-align:right">
    </label>`;
}

function toggleRow(id, label, val, hint = '') {
  const on = val > 0;
  return `
    <label style="display:flex;align-items:center;gap:8px;margin:3px 0" title="${hint}">
      <span style="width:140px;flex-shrink:0;color:${hint?'#fd9':'inherit'}">${label}</span>
      <button id="${id}" data-val="${val}"
        style="padding:2px 10px;background:${on?'#1a5':'#a51'};border:none;border-radius:4px;color:#fff;cursor:pointer;font-family:monospace">
        ${on ? '+1' : '-1'}
      </button>
    </label>`;
}

function boolRow(id, label, val, hint = '') {
  return `
    <label style="display:flex;align-items:center;gap:8px;margin:3px 0" title="${hint}">
      <span style="width:140px;flex-shrink:0;color:${hint?'#fd9':'inherit'}">${label}</span>
      <button id="${id}" data-on="${val}"
        style="padding:2px 10px;background:${val?'#a51':'#333'};border:1px solid #555;border-radius:4px;color:#fff;cursor:pointer;font-family:monospace">
        ${val ? 'ON' : 'off'}
      </button>
    </label>`;
}

function selectRow(id, label, options, cur, hint = '') {
  return `
    <label style="display:flex;align-items:center;gap:8px;margin:3px 0" title="${hint}">
      <span style="width:140px;flex-shrink:0;color:${hint?'#fd9':'inherit'}">${label}</span>
      <select id="${id}" style="flex:1;background:#222;border:1px solid #444;color:#e8e8e8;border-radius:4px;padding:1px 4px">
        ${options.map(o => `<option value="${o}"${o===cur?' selected':''}>${o}</option>`).join('')}
      </select>
    </label>`;
}

function lmPairRow(idA, idB, label, valA, valB, hint = '') {
  const inp = (id, v) =>
    `<input type="number" id="${id}" value="${v}" min="0" max="20" step="1"
       style="width:36px;background:#222;border:1px solid #444;color:#e8e8e8;border-radius:4px;padding:1px 4px;text-align:center">`;
  return `
    <div style="display:flex;align-items:center;gap:6px;margin:3px 0" title="${hint}">
      <span style="width:140px;flex-shrink:0;color:${hint?'#fd9':'inherit'}">${label}</span>
      <span style="color:#888">lm</span>${inp(idA, valA)}
      <span style="color:#888">→ lm</span>${inp(idB, valB)}
    </div>`;
}

// ── HTML ──────────────────────────────────────────────────────────────────────
function buildHTML() {
  const c = handRotConfig;
  return `
<div style="font-size:13px;font-weight:bold;color:#5af;margin-bottom:4px">✋ Hand Rotation Debug</div>

${section('Global Euler offset', 'Post-multiplied onto the computed orientation')}
${sliderRow('hrd-ox', 'offset X', -360, 360, 1, c.offsetX)}
${sliderRow('hrd-oy', 'offset Y', -360, 360, 1, c.offsetY)}
${sliderRow('hrd-oz', 'offset Z', -360, 360, 1, c.offsetZ)}
${selectRow('hrd-order', 'Euler order', ['XYZ','XZY','YXZ','YZX','ZXY','ZYX'], c.offsetOrder)}

${section('Palm facing fix',
  'Use these when palm faces wrong direction (e.g. toward camera instead of forward)')}
${sliderRow('hrd-palm', 'palm axis °', -180, 180, 1, c.palmAxisDeg,
  'Rotates around the finger axis (GLB local Y). +180 / -180 flips palm facing.')}
${boolRow('hrd-flipnormal', 'flip normal', c.flipNormal,
  'Negates the computed palm normal. Equivalent to palmAxisDeg=±180 but applied earlier in the pipeline.')}
${selectRow('hrd-cross', 'normal cross order',
  ['across_x_finger','finger_x_across'], c.crossOrder,
  'Swaps which argument is left vs right in the cross product — reverses palm normal direction.')}

${section('Landmark wiring',
  'Change which mediapipe landmarks define finger / across-palm directions')}
${lmPairRow('hrd-fla', 'hrd-flb', 'finger axis lm', c.fingerLmA, c.fingerLmB,
  'Default 0→9 (wrist→middle MCP). Try 0→5 or 0→17 to test other palm vectors.')}
${lmPairRow('hrd-ala', 'hrd-alb', 'across-palm lm', c.acrossLmA, c.acrossLmB,
  'Default 17→5 (pinky MCP→index MCP). Swap to 5→17 to reverse direction (same as acrossSign).')}
${toggleRow('hrd-across', 'across sign (right)', c.acrossSign,
  'Quick-flip the across-palm direction for the right hand (+1 or -1).')}

${section('Quaternion signs', 'Fine-grained flips applied to final quat components')}
${toggleRow('hrd-sw', 'sign W', c.signW)}
${toggleRow('hrd-sx', 'sign X', c.signX)}
${toggleRow('hrd-sy', 'sign Y', c.signY)}
${toggleRow('hrd-sz', 'sign Z', c.signZ)}

${section('Misc')}
${sliderRow('hrd-smooth', 'smoothing', 1, 40, 0.5, c.smoothing)}

<button id="hrd-copy"
  style="margin-top:10px;width:100%;padding:5px;background:#335;border:1px solid #55a;border-radius:5px;color:#adf;cursor:pointer;font-family:monospace">
  📋 Copy config
</button>
<div id="hrd-copied" style="color:#5f5;font-size:11px;text-align:center;height:14px;margin-top:2px"></div>`;
}

// ── event wiring ──────────────────────────────────────────────────────────────
function wireEvents(panel) {
  const q = id => panel.querySelector(`#${id}`);

  // slider ↔ number pairs
  for (const [id, key] of [
    ['hrd-ox',   'offsetX'],
    ['hrd-oy',   'offsetY'],
    ['hrd-oz',   'offsetZ'],
    ['hrd-palm', 'palmAxisDeg'],
    ['hrd-smooth','smoothing'],
  ]) {
    const range = q(id), num = q(`${id}-num`);
    range.addEventListener('input', () => { handRotConfig[key] = +range.value; num.value = range.value; });
    num.addEventListener('change', () => { handRotConfig[key] = +num.value; range.value = num.value; });
  }

  // selects
  q('hrd-order').addEventListener('change', e => { handRotConfig.offsetOrder = e.target.value; });
  q('hrd-cross').addEventListener('change', e => { handRotConfig.crossOrder   = e.target.value; });

  // sign toggles
  for (const [id, key] of [
    ['hrd-sw','signW'], ['hrd-sx','signX'], ['hrd-sy','signY'], ['hrd-sz','signZ'],
    ['hrd-across','acrossSign'],
  ]) {
    q(id).addEventListener('click', () => {
      handRotConfig[key] *= -1;
      const btn = q(id);
      btn.dataset.val    = handRotConfig[key];
      btn.textContent    = handRotConfig[key] > 0 ? '+1' : '-1';
      btn.style.background = handRotConfig[key] > 0 ? '#1a5' : '#a51';
    });
  }

  // bool toggle (flip normal)
  q('hrd-flipnormal').addEventListener('click', () => {
    handRotConfig.flipNormal = !handRotConfig.flipNormal;
    const btn = q('hrd-flipnormal');
    btn.dataset.on         = handRotConfig.flipNormal;
    btn.textContent        = handRotConfig.flipNormal ? 'ON' : 'off';
    btn.style.background   = handRotConfig.flipNormal ? '#a51' : '#333';
  });

  // landmark index inputs
  for (const [id, key] of [
    ['hrd-fla','fingerLmA'], ['hrd-flb','fingerLmB'],
    ['hrd-ala','acrossLmA'], ['hrd-alb','acrossLmB'],
  ]) {
    q(id).addEventListener('change', e => { handRotConfig[key] = parseInt(e.target.value, 10); });
  }

  // copy
  q('hrd-copy').addEventListener('click', () => {
    const c = handRotConfig;
    const rad = v => (v * Math.PI / 180).toFixed(4);
    const out =
`// handRotConfig snapshot
offsetX: ${c.offsetX},   // Euler offset X (deg)
offsetY: ${c.offsetY},   // Euler offset Y (deg)
offsetZ: ${c.offsetZ},   // Euler offset Z (deg)
offsetOrder: '${c.offsetOrder}',
palmAxisDeg: ${c.palmAxisDeg},   // extra rotation around finger axis (GLB Y)
flipNormal: ${c.flipNormal},   // negate computed palm normal
signW: ${c.signW}, signX: ${c.signX}, signY: ${c.signY}, signZ: ${c.signZ},
acrossSign: ${c.acrossSign},  // +1 = pts[${c.acrossLmA}]-pts[${c.acrossLmB}]
crossOrder: '${c.crossOrder}',
fingerLmA: ${c.fingerLmA}, fingerLmB: ${c.fingerLmB},   // finger axis landmarks
acrossLmA: ${c.acrossLmA}, acrossLmB: ${c.acrossLmB},   // across-palm landmarks
smoothing: ${c.smoothing},

// THREE.js equivalents:
// const tiltOffset = new THREE.Quaternion().setFromEuler(
//   new THREE.Euler(${rad(c.offsetX)}, ${rad(c.offsetY)}, ${rad(c.offsetZ)}, '${c.offsetOrder}')
// );${c.palmAxisDeg !== 0 ? `
// tiltOffset.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0), ${rad(c.palmAxisDeg)}));` : ''}
// // flipNormal: ${c.flipNormal}
// quat.w *= ${c.signW}; quat.x *= ${c.signX};
// quat.y *= ${c.signY}; quat.z *= ${c.signZ};`;

    navigator.clipboard.writeText(out).then(() => {
      q('hrd-copied').textContent = 'Copied!';
      setTimeout(() => { q('hrd-copied').textContent = ''; }, 1800);
    });
  });
}

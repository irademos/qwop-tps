/**
 * Debug panel for tuning GLB hand rotation mapping.
 * Import and call initHandRotationDebug() once; then call getHandRotationDebugConfig()
 * each frame from updateGLBHandSceneRotation.
 *
 * Remove this file and its import when tuning is done.
 */

import * as THREE from 'three';

// ── shared config object (mutated by UI, read by rotation code) ──────────────
export const handRotConfig = {
  // Euler offset applied as a post-multiply on top of the computed orientation.
  // Stored as degrees for the UI; the rotation code converts to radians.
  offsetX:  90,   // degrees — original tilt that made fingers point forward
  offsetY:   0,
  offsetZ:   0,
  offsetOrder: 'XYZ',   // THREE.Euler order

  // Signs applied to the final quaternion components (1 or -1)
  signX:  1,
  signY: -1,   // original mirror correction
  signZ: -1,   // original mirror correction
  signW:  1,

  // Across-palm axis: +1 → pts[17]-pts[5], -1 → pts[5]-pts[17]
  acrossSign: 1,

  // Palm normal cross order: 'across_x_finger' or 'finger_x_across'
  crossOrder: 'across_x_finger',

  // Smoothing speed (higher = snappier)
  smoothing: 14,
};

// Cached THREE objects so we don't allocate in the hot path
const _offsetQ = new THREE.Quaternion();
const _offsetE = new THREE.Euler();

/** Returns a quaternion encoding the current Euler offset. Cached per-call. */
export function getOffsetQuaternion() {
  _offsetE.set(
    handRotConfig.offsetX * (Math.PI / 180),
    handRotConfig.offsetY * (Math.PI / 180),
    handRotConfig.offsetZ * (Math.PI / 180),
    handRotConfig.offsetOrder,
  );
  return _offsetQ.setFromEuler(_offsetE);
}

// ── DOM panel ─────────────────────────────────────────────────────────────────

export function initHandRotationDebug() {
  if (document.getElementById('hand-rot-debug')) return; // already mounted

  const panel = document.createElement('div');
  panel.id = 'hand-rot-debug';
  Object.assign(panel.style, {
    position: 'fixed',
    top: '8px',
    right: '8px',
    width: '300px',
    background: 'rgba(0,0,0,0.82)',
    color: '#e8e8e8',
    fontFamily: 'monospace',
    fontSize: '12px',
    padding: '10px 12px',
    borderRadius: '8px',
    zIndex: '9999',
    userSelect: 'none',
    lineHeight: '1.6',
    boxShadow: '0 2px 16px rgba(0,0,0,0.6)',
  });

  panel.innerHTML = buildHTML();
  document.body.appendChild(panel);
  wireEvents(panel);
}

function buildHTML() {
  const sliderRow = (id, label, min, max, step, val) => `
    <label style="display:flex;align-items:center;gap:6px;margin:3px 0">
      <span style="width:70px;flex-shrink:0">${label}</span>
      <input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${val}"
             style="flex:1;accent-color:#5af">
      <input type="number" id="${id}-num" value="${val}" step="${step}"
             style="width:52px;background:#222;border:1px solid #444;color:#e8e8e8;border-radius:4px;padding:1px 4px;text-align:right">
    </label>`;

  const toggleRow = (id, label, val) => `
    <label style="display:flex;align-items:center;gap:8px;margin:3px 0">
      <span style="width:130px;flex-shrink:0">${label}</span>
      <button id="${id}" data-val="${val}"
              style="padding:2px 10px;background:${val > 0 ? '#1a5' : '#a51'};border:none;border-radius:4px;color:#fff;cursor:pointer;font-family:monospace">
        ${val > 0 ? '+1' : '-1'}
      </button>
    </label>`;

  const selectRow = (id, label, options, cur) => `
    <label style="display:flex;align-items:center;gap:8px;margin:3px 0">
      <span style="width:130px;flex-shrink:0">${label}</span>
      <select id="${id}" style="flex:1;background:#222;border:1px solid #444;color:#e8e8e8;border-radius:4px;padding:1px 4px">
        ${options.map(o => `<option value="${o}" ${o===cur?'selected':''}>${o}</option>`).join('')}
      </select>
    </label>`;

  return `
    <div style="font-weight:bold;margin-bottom:6px;color:#5af">✋ Hand Rotation Debug</div>

    <div style="color:#aaa;margin:4px 0 2px">Euler offset (post-multiply, degrees)</div>
    ${sliderRow('hrd-ox', 'offset X', -180, 180, 1, handRotConfig.offsetX)}
    ${sliderRow('hrd-oy', 'offset Y', -180, 180, 1, handRotConfig.offsetY)}
    ${sliderRow('hrd-oz', 'offset Z', -180, 180, 1, handRotConfig.offsetZ)}
    ${selectRow('hrd-order', 'Euler order', ['XYZ','XZY','YXZ','YZX','ZXY','ZYX'], handRotConfig.offsetOrder)}

    <div style="color:#aaa;margin:6px 0 2px">Quaternion component signs</div>
    ${toggleRow('hrd-sw', 'sign W', handRotConfig.signW)}
    ${toggleRow('hrd-sx', 'sign X', handRotConfig.signX)}
    ${toggleRow('hrd-sy', 'sign Y', handRotConfig.signY)}
    ${toggleRow('hrd-sz', 'sign Z', handRotConfig.signZ)}

    <div style="color:#aaa;margin:6px 0 2px">Axis construction</div>
    ${toggleRow('hrd-across', 'across sign (R)', handRotConfig.acrossSign)}
    ${selectRow('hrd-cross', 'palm normal cross', ['across_x_finger','finger_x_across'], handRotConfig.crossOrder)}

    ${sliderRow('hrd-smooth', 'smoothing', 1, 40, 0.5, handRotConfig.smoothing)}

    <button id="hrd-copy"
            style="margin-top:8px;width:100%;padding:5px;background:#335;border:1px solid #55a;border-radius:5px;color:#adf;cursor:pointer;font-family:monospace">
      📋 Copy config
    </button>
    <div id="hrd-copied" style="color:#5f5;font-size:11px;text-align:center;height:14px;margin-top:2px"></div>`;
}

function wireEvents(panel) {
  // slider ↔ number input sync + config update
  const sliders = [
    ['hrd-ox',     'offsetX',   Number],
    ['hrd-oy',     'offsetY',   Number],
    ['hrd-oz',     'offsetZ',   Number],
    ['hrd-smooth', 'smoothing', Number],
  ];

  for (const [id, key, cast] of sliders) {
    const range = panel.querySelector(`#${id}`);
    const num   = panel.querySelector(`#${id}-num`);
    range.addEventListener('input', () => {
      handRotConfig[key] = cast(range.value);
      num.value = range.value;
    });
    num.addEventListener('change', () => {
      handRotConfig[key] = cast(num.value);
      range.value = num.value;
    });
  }

  // Euler order select
  panel.querySelector('#hrd-order').addEventListener('change', e => {
    handRotConfig.offsetOrder = e.target.value;
  });

  // cross order select
  panel.querySelector('#hrd-cross').addEventListener('change', e => {
    handRotConfig.crossOrder = e.target.value;
  });

  // toggle buttons
  const toggles = [
    ['hrd-sw', 'signW'],
    ['hrd-sx', 'signX'],
    ['hrd-sy', 'signY'],
    ['hrd-sz', 'signZ'],
    ['hrd-across', 'acrossSign'],
  ];
  for (const [id, key] of toggles) {
    const btn = panel.querySelector(`#${id}`);
    btn.addEventListener('click', () => {
      handRotConfig[key] *= -1;
      btn.dataset.val = handRotConfig[key];
      btn.textContent = handRotConfig[key] > 0 ? '+1' : '-1';
      btn.style.background = handRotConfig[key] > 0 ? '#1a5' : '#a51';
    });
  }

  // copy button
  panel.querySelector('#hrd-copy').addEventListener('click', () => {
    const out = `// handRotConfig snapshot
offsetX: ${handRotConfig.offsetX},   // Euler offset X (deg)
offsetY: ${handRotConfig.offsetY},   // Euler offset Y (deg)
offsetZ: ${handRotConfig.offsetZ},   // Euler offset Z (deg)
offsetOrder: '${handRotConfig.offsetOrder}',
signW: ${handRotConfig.signW},
signX: ${handRotConfig.signX},
signY: ${handRotConfig.signY},
signZ: ${handRotConfig.signZ},
acrossSign: ${handRotConfig.acrossSign},  // +1 = pts[17]-pts[5], -1 = pts[5]-pts[17]
crossOrder: '${handRotConfig.crossOrder}',
smoothing: ${handRotConfig.smoothing},

// THREE.js equivalents:
// tiltOffset = new THREE.Quaternion().setFromEuler(
//   new THREE.Euler(${(handRotConfig.offsetX*(Math.PI/180)).toFixed(4)}, ${(handRotConfig.offsetY*(Math.PI/180)).toFixed(4)}, ${(handRotConfig.offsetZ*(Math.PI/180)).toFixed(4)}, '${handRotConfig.offsetOrder}')
// );
// quat.w *= ${handRotConfig.signW}; quat.x *= ${handRotConfig.signX};
// quat.y *= ${handRotConfig.signY}; quat.z *= ${handRotConfig.signZ};`;
    navigator.clipboard.writeText(out).then(() => {
      const msg = panel.querySelector('#hrd-copied');
      msg.textContent = 'Copied!';
      setTimeout(() => { msg.textContent = ''; }, 1800);
    });
  });
}

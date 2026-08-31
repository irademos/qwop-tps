// Comic / graphic-novel post-processing pipeline.
//
// Usage:
//   initComicRenderer(renderer, scene, camera)  — call once after renderer+camera are ready
//   renderComic()                               — replaces renderer.render(scene, camera)
//   resizeComicRenderer(w, h)                   — call on window resize

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

// ─────────────────────────────────────────────────────────────
// Default parameters
// ─────────────────────────────────────────────────────────────
const DEFAULTS = {
  enabled: true,
  cel: {
    enabled: true,
    steps: 4,
    strength: 0.62,
  },
  outline: {
    enabled: true,
    thickness: 1.2,
    strength: 0.78,
    depthThreshold: 0.0004,
  },
  halftone: {
    enabled: true,
    dotSize: 4.0,
    strength: 0.22,
    shadowThreshold: 0.42,
  },
  grade: {
    enabled: true,
    saturation: 1.10,
    contrast: 1.07,
    brightness: 0.012,
    splitStrength: 0.09,
    vignette: 0.20,
  },
  fog: {
    enabled: true,
    color: '#8eafc4',
    near: 85,
    far: 285,
  },
};

let params = JSON.parse(JSON.stringify(DEFAULTS));

// ─────────────────────────────────────────────────────────────
// Shaders
// ─────────────────────────────────────────────────────────────

const CelShader = {
  uniforms: {
    tDiffuse: { value: null },
    uSteps:   { value: DEFAULTS.cel.steps },
    uStrength:{ value: DEFAULTS.cel.strength },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uSteps;
    uniform float uStrength;
    varying vec2 vUv;

    void main() {
      vec4 tex = texture2D(tDiffuse, vUv);
      vec3 c   = tex.rgb;
      float lum  = dot(c, vec3(0.299, 0.587, 0.114));
      // Quantise luminance; use round-to-nearest so mid-tones land on a band centre
      float qLum = floor(lum * uSteps + 0.5) / uSteps;
      // Scale each channel by the luminance ratio to preserve hue
      float ratio = clamp(qLum / max(lum, 0.0015), 0.0, 2.0);
      vec3 cel   = clamp(c * ratio, 0.0, 1.0);
      gl_FragColor = vec4(mix(c, cel, uStrength), tex.a);
    }
  `,
};

// OutlineShader reads depth from tDepth (bound in DepthOutlinePass.render below).
const OutlineShader = {
  uniforms: {
    tDiffuse:        { value: null },
    tDepth:          { value: null },
    uResolution:     { value: new THREE.Vector2(1, 1) },
    uThickness:      { value: DEFAULTS.outline.thickness },
    uStrength:       { value: DEFAULTS.outline.strength },
    uNear:           { value: 0.1 },
    uFar:            { value: 1000.0 },
    uDepthThreshold: { value: DEFAULTS.outline.depthThreshold },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform sampler2D tDepth;
    uniform vec2  uResolution;
    uniform float uThickness;
    uniform float uStrength;
    uniform float uNear;
    uniform float uFar;
    uniform float uDepthThreshold;
    varying vec2 vUv;

    float linearDepth(float raw) {
      float z = raw * 2.0 - 1.0;
      return (2.0 * uNear * uFar) / (uFar + uNear - z * (uFar - uNear));
    }

    void main() {
      vec4 col = texture2D(tDiffuse, vUv);

      // Skip outline calculation when depth texture isn't available (null uniform)
      if (uDepthThreshold <= 0.0) { gl_FragColor = col; return; }

      vec2 px = uThickness / uResolution;

      // 3×3 Sobel kernel on linearised depth
      float d[9];
      d[0] = linearDepth(texture2D(tDepth, vUv + vec2(-px.x,-px.y)).r);
      d[1] = linearDepth(texture2D(tDepth, vUv + vec2( 0.0, -px.y)).r);
      d[2] = linearDepth(texture2D(tDepth, vUv + vec2( px.x,-px.y)).r);
      d[3] = linearDepth(texture2D(tDepth, vUv + vec2(-px.x, 0.0)).r);
      // d[4] centre — not needed in Sobel
      d[5] = linearDepth(texture2D(tDepth, vUv + vec2( px.x, 0.0)).r);
      d[6] = linearDepth(texture2D(tDepth, vUv + vec2(-px.x, px.y)).r);
      d[7] = linearDepth(texture2D(tDepth, vUv + vec2( 0.0,  px.y)).r);
      d[8] = linearDepth(texture2D(tDepth, vUv + vec2( px.x, px.y)).r);

      float gx = -d[0] - 2.0*d[3] - d[6] + d[2] + 2.0*d[5] + d[8];
      float gy = -d[0] - 2.0*d[1] - d[2] + d[6] + 2.0*d[7] + d[8];
      float edge = sqrt(gx*gx + gy*gy);

      // Normalise threshold to a usable range (uDepthThreshold * 200 gives 0..0.4)
      float thresh = uDepthThreshold * 200.0;
      float outline = smoothstep(thresh * 0.35, thresh * 2.2, edge);

      // Deep, slightly warm ink colour
      vec3 ink = vec3(0.06, 0.045, 0.035);
      gl_FragColor = vec4(mix(col.rgb, ink, outline * uStrength), col.a);
    }
  `,
};

const HalftoneShader = {
  uniforms: {
    tDiffuse:         { value: null },
    uResolution:      { value: new THREE.Vector2(1, 1) },
    uDotSize:         { value: DEFAULTS.halftone.dotSize },
    uStrength:        { value: DEFAULTS.halftone.strength },
    uShadowThreshold: { value: DEFAULTS.halftone.shadowThreshold },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform vec2  uResolution;
    uniform float uDotSize;
    uniform float uStrength;
    uniform float uShadowThreshold;
    varying vec2 vUv;

    void main() {
      vec4 tex = texture2D(tDiffuse, vUv);
      vec3 c   = tex.rgb;
      float lum = dot(c, vec3(0.299, 0.587, 0.114));

      // Shadow mask — only active below uShadowThreshold
      float shadow = 1.0 - smoothstep(0.0, uShadowThreshold, lum);
      if (shadow < 0.02) { gl_FragColor = tex; return; }

      // 45° rotated halftone grid (classic print look)
      vec2 px  = vUv * uResolution;
      float s  = 0.7071067811;
      vec2 rot = vec2(px.x * s - px.y * s, px.x * s + px.y * s);
      vec2 cell   = floor(rot / uDotSize);
      vec2 centre = (cell + 0.5) * uDotSize;
      float dist  = length(rot - centre);

      // Dot radius grows in darker areas
      float dotR = shadow * uDotSize * 0.44;
      float dot  = 1.0 - smoothstep(dotR - 0.7, dotR + 0.7, dist);

      // Subtle ink darkening inside dots
      vec3 result = mix(c, c * 0.68, dot * shadow * uStrength);
      gl_FragColor = vec4(result, tex.a);
    }
  `,
};

const ColorGradeShader = {
  uniforms: {
    tDiffuse:      { value: null },
    uSaturation:   { value: DEFAULTS.grade.saturation },
    uContrast:     { value: DEFAULTS.grade.contrast },
    uBrightness:   { value: DEFAULTS.grade.brightness },
    uSplitStrength:{ value: DEFAULTS.grade.splitStrength },
    // Cool-blue shadows, warm-amber highlights — classic comic palette
    uShadowTint:   { value: new THREE.Color(0.07, 0.11, 0.22) },
    uHighlightTint:{ value: new THREE.Color(1.00, 0.96, 0.84) },
    uVignette:     { value: DEFAULTS.grade.vignette },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uSaturation;
    uniform float uContrast;
    uniform float uBrightness;
    uniform float uSplitStrength;
    uniform vec3  uShadowTint;
    uniform vec3  uHighlightTint;
    uniform float uVignette;
    varying vec2 vUv;

    vec3 applySaturation(vec3 c, float s) {
      float l = dot(c, vec3(0.299, 0.587, 0.114));
      return mix(vec3(l), c, s);
    }

    void main() {
      vec4 tex = texture2D(tDiffuse, vUv);
      vec3 c   = tex.rgb;

      c = applySaturation(c, uSaturation);
      c = (c - 0.5) * uContrast + 0.5 + uBrightness;

      // Split toning — interpolate tint by luminance
      float lum   = dot(c, vec3(0.299, 0.587, 0.114));
      vec3  tint  = mix(uShadowTint, uHighlightTint, lum);
      // Normalise tint so it doesn't brighten/darken overall
      float tLum  = dot(tint, vec3(0.299, 0.587, 0.114));
      vec3  tintN = tint / max(tLum, 0.001);
      c = mix(c, c * tintN, uSplitStrength);

      // Radial vignette
      vec2 uv2 = vUv - 0.5;
      float vig = 1.0 - dot(uv2, uv2) * uVignette * 3.5;
      c *= clamp(vig, 0.0, 1.0);

      gl_FragColor = vec4(clamp(c, 0.0, 1.0), tex.a);
    }
  `,
};

// ─────────────────────────────────────────────────────────────
// Depth-aware outline pass
// Reads readBuffer.depthTexture (populated by the preceding RenderPass)
// ─────────────────────────────────────────────────────────────
class DepthOutlinePass extends ShaderPass {
  render(renderer, writeBuffer, readBuffer, delta, maskActive) {
    if (readBuffer.depthTexture) {
      this.uniforms.tDepth.value = readBuffer.depthTexture;
    }
    super.render(renderer, writeBuffer, readBuffer, delta, maskActive);
  }
}

// ─────────────────────────────────────────────────────────────
// Module state
// ─────────────────────────────────────────────────────────────
let _composer    = null;
let _celPass     = null;
let _outlinePass = null;
let _halftonePass= null;
let _gradePass   = null;
let _renderer    = null;
let _scene       = null;
let _camera      = null;

// ─────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────

export function initComicRenderer(renderer, scene, camera) {
  _renderer = renderer;
  _scene    = scene;
  _camera   = camera;

  const w = renderer.domElement.width  || window.innerWidth;
  const h = renderer.domElement.height || window.innerHeight;

  // Render target with depth texture so DepthOutlinePass can read scene depth
  const depthTex = new THREE.DepthTexture(w, h);
  depthTex.format = THREE.DepthFormat;
  depthTex.type   = THREE.UnsignedIntType;

  const rt = new THREE.WebGLRenderTarget(w, h, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthTexture: depthTex,
    depthBuffer:  true,
  });

  _composer = new EffectComposer(renderer, rt);
  _composer.addPass(new RenderPass(scene, camera));

  _celPass = new ShaderPass(CelShader);
  _composer.addPass(_celPass);

  _outlinePass = new DepthOutlinePass(OutlineShader);
  _outlinePass.uniforms.uResolution.value.set(w, h);
  _outlinePass.uniforms.uNear.value = camera.near;
  _outlinePass.uniforms.uFar.value  = camera.far;
  _composer.addPass(_outlinePass);

  _halftonePass = new ShaderPass(HalftoneShader);
  _halftonePass.uniforms.uResolution.value.set(w, h);
  _composer.addPass(_halftonePass);

  _gradePass = new ShaderPass(ColorGradeShader);
  _composer.addPass(_gradePass);

  _composer.addPass(new OutputPass());

  _loadSavedParams();
  _applyAllUniforms();
  _buildDebugPanel();
}

export function renderComic() {
  if (!_composer || !params.enabled) {
    _renderer.render(_scene, _camera);
    return;
  }
  _composer.render();
}

export function resizeComicRenderer(w, h) {
  if (!_composer) return;
  _composer.setSize(w, h);
  _outlinePass?.uniforms.uResolution.value.set(w, h);
  _halftonePass?.uniforms.uResolution.value.set(w, h);
}

// ─────────────────────────────────────────────────────────────
// Uniform sync
// ─────────────────────────────────────────────────────────────
function _applyAllUniforms() {
  if (!_celPass) return;

  const on = params.enabled;

  _celPass.enabled = on && params.cel.enabled;
  _celPass.uniforms.uSteps.value    = params.cel.steps;
  _celPass.uniforms.uStrength.value = params.cel.strength;

  _outlinePass.enabled = on && params.outline.enabled;
  _outlinePass.uniforms.uThickness.value      = params.outline.thickness;
  _outlinePass.uniforms.uStrength.value       = params.outline.strength;
  _outlinePass.uniforms.uDepthThreshold.value = params.outline.depthThreshold;

  _halftonePass.enabled = on && params.halftone.enabled;
  _halftonePass.uniforms.uDotSize.value         = params.halftone.dotSize;
  _halftonePass.uniforms.uStrength.value        = params.halftone.strength;
  _halftonePass.uniforms.uShadowThreshold.value = params.halftone.shadowThreshold;

  _gradePass.enabled = on && params.grade.enabled;
  _gradePass.uniforms.uSaturation.value    = params.grade.saturation;
  _gradePass.uniforms.uContrast.value      = params.grade.contrast;
  _gradePass.uniforms.uBrightness.value    = params.grade.brightness;
  _gradePass.uniforms.uSplitStrength.value = params.grade.splitStrength;
  _gradePass.uniforms.uVignette.value      = params.grade.vignette;

  _applyFog();
}

function _applyFog() {
  if (!_scene) return;
  if (params.enabled && params.fog.enabled) {
    const col = new THREE.Color(params.fog.color);
    _scene.fog = new THREE.Fog(col, params.fog.near, params.fog.far);
    _renderer?.setClearColor(col, 1);
  } else {
    _scene.fog = null;
    _renderer?.setClearColor(0x000000, 1);
  }
}

// ─────────────────────────────────────────────────────────────
// Persistence
// ─────────────────────────────────────────────────────────────
function _loadSavedParams() {
  try {
    const saved = localStorage.getItem('comicRendererParams');
    if (!saved) return;
    const parsed = JSON.parse(saved);
    for (const k of Object.keys(parsed)) {
      if (typeof parsed[k] === 'object' && params[k] !== undefined) {
        Object.assign(params[k], parsed[k]);
      } else {
        params[k] = parsed[k];
      }
    }
  } catch { /* ignore */ }
}

function _saveParams() {
  try { localStorage.setItem('comicRendererParams', JSON.stringify(params)); } catch { /* ignore */ }
}

// ─────────────────────────────────────────────────────────────
// Debug panel
// ─────────────────────────────────────────────────────────────
function _buildDebugPanel() {
  if (document.getElementById('cdp-panel')) return;

  const panel = document.createElement('div');
  panel.id = 'cdp-panel';
  panel.innerHTML = _panelHTML();
  document.body.appendChild(panel);
  _injectStyles();
  _wireControls();
}

function _fmt(value, step) {
  const s = parseFloat(step);
  return parseFloat(value).toFixed(s < 0.01 ? 4 : s < 0.1 ? 3 : s < 1 ? 2 : 0);
}

function _slider(key, label, min, max, step, value) {
  const id = 'cdp-' + key.replace(/\./g, '-');
  return `
  <div class="cdp-row">
    <label for="${id}">${label}</label>
    <input type="range" id="${id}" data-key="${key}" min="${min}" max="${max}" step="${step}" value="${value}">
    <span class="cdp-val" id="${id}-val">${_fmt(value, step)}</span>
  </div>`;
}

function _colorPicker(key, label, value) {
  const id = 'cdp-' + key.replace(/\./g, '-');
  return `
  <div class="cdp-row">
    <label for="${id}">${label}</label>
    <input type="color" id="${id}" data-key="${key}" value="${value}">
  </div>`;
}

function _section(key, label, rows) {
  const en = params[key]?.enabled !== false;
  return `
<div class="cdp-section" data-section="${key}">
  <div class="cdp-sh">
    <input type="checkbox" class="cdp-stog" data-key="${key}" ${en ? 'checked' : ''}>
    <span class="cdp-sl">${label}</span>
  </div>
  <div class="cdp-sb">${rows.join('')}</div>
</div>`;
}

function _panelHTML() {
  const cel = params.cel, out = params.outline, ht = params.halftone, gr = params.grade, fg = params.fog;
  return `
<div id="cdp-head">
  <span id="cdp-title">🎨 Comic Style</span>
  <label class="cdp-main-en">
    <input type="checkbox" id="cdp-enabled" ${params.enabled ? 'checked' : ''}> On
  </label>
  <button id="cdp-tog">▾</button>
</div>
<div id="cdp-body">
  ${_section('cel', 'Cel Shading', [
    _slider('cel.steps',    'Steps',    2, 6,   1,     cel.steps),
    _slider('cel.strength', 'Strength', 0, 1,   0.01,  cel.strength),
  ])}
  ${_section('outline', 'Outlines', [
    _slider('outline.thickness',      'Thickness',  0.3, 3.0, 0.1,    out.thickness),
    _slider('outline.strength',       'Strength',   0,   1,   0.01,   out.strength),
    _slider('outline.depthThreshold', 'Sensitivity',0.0001,0.002,0.0001, out.depthThreshold),
  ])}
  ${_section('halftone', 'Halftone', [
    _slider('halftone.dotSize',         'Dot Size',   2, 10,  0.5,  ht.dotSize),
    _slider('halftone.strength',        'Strength',   0, 1,   0.01, ht.strength),
    _slider('halftone.shadowThreshold', 'Shadow Thr', 0.1, 0.8, 0.01, ht.shadowThreshold),
  ])}
  ${_section('grade', 'Color Grade', [
    _slider('grade.saturation',    'Saturation', 0.5, 2.0, 0.01, gr.saturation),
    _slider('grade.contrast',      'Contrast',   0.7, 1.6, 0.01, gr.contrast),
    _slider('grade.brightness',    'Brightness', -0.1, 0.1, 0.005, gr.brightness),
    _slider('grade.splitStrength', 'Split Tone', 0,   0.3, 0.005, gr.splitStrength),
    _slider('grade.vignette',      'Vignette',   0,   0.8, 0.01,  gr.vignette),
  ])}
  ${_section('fog', 'Depth Fog', [
    _colorPicker('fog.color', 'Color', fg.color),
    _slider('fog.near', 'Near', 10,  200, 1, fg.near),
    _slider('fog.far',  'Far',  50,  600, 5, fg.far),
  ])}
  <div id="cdp-actions">
    <button id="cdp-reset">↺ Defaults</button>
    <button id="cdp-copy">⎘ Copy JSON</button>
  </div>
</div>`;
}

function _injectStyles() {
  if (document.getElementById('cdp-style')) return;
  const s = document.createElement('style');
  s.id = 'cdp-style';
  s.textContent = `
#cdp-panel {
  position: fixed; bottom: 14px; right: 14px; z-index: 99999;
  width: 286px; font: 12px/1.4 'Consolas', monospace;
  background: rgba(11,11,15,0.93); color: #ccc8be;
  border: 1px solid rgba(255,255,255,0.10); border-radius: 9px;
  box-shadow: 0 6px 28px rgba(0,0,0,0.55);
  backdrop-filter: blur(10px);
}
#cdp-head {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 10px; cursor: default;
  border-bottom: 1px solid rgba(255,255,255,0.07);
}
#cdp-title { flex: 1; font-weight: 700; font-size: 11.5px; letter-spacing: .02em; }
.cdp-main-en { display: flex; align-items: center; gap: 4px; font-size: 11px; color: #888; }
#cdp-tog {
  background: none; border: none; color: #777; cursor: pointer;
  font-size: 13px; padding: 0 2px; line-height: 1;
}
#cdp-body { padding: 6px 8px 8px; max-height: 72vh; overflow-y: auto; }
#cdp-body::-webkit-scrollbar { width: 4px; }
#cdp-body::-webkit-scrollbar-track { background: transparent; }
#cdp-body::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.15); border-radius: 2px; }
.cdp-section {
  margin-bottom: 5px; border: 1px solid rgba(255,255,255,0.07); border-radius: 5px; overflow: hidden;
}
.cdp-sh {
  display: flex; align-items: center; gap: 7px; padding: 5px 8px;
  background: rgba(255,255,255,0.04);
  cursor: pointer;
}
.cdp-sl { font-size: 11px; font-weight: 700; letter-spacing: .04em; color: #bfbaae; }
.cdp-sb { padding: 4px 8px 6px; }
.cdp-row { display: flex; align-items: center; gap: 5px; margin: 3px 0; }
.cdp-row > label { width: 86px; color: #888; flex-shrink: 0; font-size: 11px; }
.cdp-row input[type=range] {
  flex: 1; height: 2px; cursor: pointer;
  accent-color: #6eaae8;
  -webkit-appearance: none; appearance: none;
  background: rgba(255,255,255,0.12); border-radius: 1px;
}
.cdp-row input[type=range]::-webkit-slider-thumb {
  -webkit-appearance: none; width: 10px; height: 10px;
  background: #6eaae8; border-radius: 50%;
}
.cdp-val { width: 42px; text-align: right; color: #6eaae8; font-size: 11px; }
.cdp-row input[type=color] {
  width: 28px; height: 20px; border: 1px solid rgba(255,255,255,0.15);
  background: none; border-radius: 3px; cursor: pointer; padding: 1px;
}
.cdp-stog { accent-color: #6eaae8; cursor: pointer; }
#cdp-actions {
  display: flex; gap: 7px; margin-top: 7px; padding-top: 7px;
  border-top: 1px solid rgba(255,255,255,0.06);
}
#cdp-actions button {
  flex: 1; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.10);
  color: #ccc8be; border-radius: 4px; padding: 5px 3px; cursor: pointer;
  font: 11px 'Consolas', monospace; transition: background .15s;
}
#cdp-actions button:hover { background: rgba(255,255,255,0.13); }
#cdp-copy { color: #6eaae8; }
`;
  document.head.appendChild(s);
}

function _wireControls() {
  // Master enable
  document.getElementById('cdp-enabled').addEventListener('change', e => {
    params.enabled = e.target.checked;
    _applyAllUniforms(); _saveParams();
  });

  // Collapse/expand
  document.getElementById('cdp-tog').addEventListener('click', () => {
    const body = document.getElementById('cdp-body');
    const btn  = document.getElementById('cdp-tog');
    const hide = body.style.display !== 'none';
    body.style.display = hide ? 'none' : '';
    btn.textContent = hide ? '▸' : '▾';
  });

  // Section toggles
  document.querySelectorAll('.cdp-stog').forEach(cb => {
    cb.addEventListener('change', e => {
      const k = e.target.dataset.key;
      if (params[k]) params[k].enabled = e.target.checked;
      _applyAllUniforms(); _saveParams();
    });
  });

  // Range sliders
  document.querySelectorAll('#cdp-body input[type=range]').forEach(input => {
    const valEl = document.getElementById(input.id + '-val');
    input.addEventListener('input', e => {
      const [sec, prop] = e.target.dataset.key.split('.');
      params[sec][prop] = parseFloat(e.target.value);
      if (valEl) valEl.textContent = _fmt(e.target.value, input.step);
      _applyAllUniforms(); _saveParams();
    });
  });

  // Color pickers
  document.querySelectorAll('#cdp-body input[type=color]').forEach(input => {
    input.addEventListener('input', e => {
      const [sec, prop] = e.target.dataset.key.split('.');
      params[sec][prop] = e.target.value;
      _applyAllUniforms(); _saveParams();
    });
  });

  // Reset defaults
  document.getElementById('cdp-reset').addEventListener('click', () => {
    params = JSON.parse(JSON.stringify(DEFAULTS));
    _applyAllUniforms(); _saveParams();
    _syncPanelToParams();
  });

  // Copy JSON
  document.getElementById('cdp-copy').addEventListener('click', () => {
    navigator.clipboard.writeText(JSON.stringify(params, null, 2)).then(() => {
      const btn = document.getElementById('cdp-copy');
      const orig = btn.textContent;
      btn.textContent = '✓ Copied!';
      setTimeout(() => { btn.textContent = orig; }, 1600);
    });
  });
}

function _syncPanelToParams() {
  document.getElementById('cdp-enabled').checked = params.enabled;
  document.querySelectorAll('.cdp-stog').forEach(cb => {
    const k = cb.dataset.key;
    if (params[k]) cb.checked = params[k].enabled !== false;
  });
  document.querySelectorAll('#cdp-body input[type=range]').forEach(input => {
    const [sec, prop] = input.dataset.key.split('.');
    input.value = params[sec][prop];
    const valEl = document.getElementById(input.id + '-val');
    if (valEl) valEl.textContent = _fmt(input.value, input.step);
  });
  document.querySelectorAll('#cdp-body input[type=color]').forEach(input => {
    const [sec, prop] = input.dataset.key.split('.');
    input.value = params[sec][prop];
  });
}

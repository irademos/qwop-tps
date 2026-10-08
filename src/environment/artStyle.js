/**
 * Art style unifier — makes the AI-generated characters, the map and the props read as one
 * art style. Everything here runs once per texture at load time (CPU, canvas); nothing is
 * added to the per-frame render cost.
 *
 * The characters (Tripo GLBs) have photo-ish textures with lighting baked in and wildly
 * different saturation / brightness; the map has flat, muted, painted colours. So:
 *
 *  1. Character textures (stylizeCharacter) are matched to the map:
 *     - downscaled to `maxSize` (drops the noisy high-frequency AI detail),
 *     - baked shading flattened: the broad (blurred) luminance variation is pulled toward
 *       the texture's mean, small details (eyes, mouths, outlines) are kept,
 *     - mean brightness / saturation / contrast pulled toward the map's (measured by
 *       setStyleReference from the map's own textures, defaults below until then),
 *     - colours posterized into a few flat bands like the map's paint.
 *  2. Every texture (characters, map, props) gets the same final grade: saturation,
 *     contrast and a warm tint, so they share one colour palette.
 *  3. Materials are normalised to one shading model: fully rough, non-metallic, no
 *     environment reflections (the map had a stray metallic material).
 *
 * Tune in artStyleConfig — values are read when a texture is processed, so changes need a
 * reload. `enabled: false` turns the whole pass off.
 */

import * as THREE from 'three';

export const artStyleConfig = {
  enabled: true,
  // Final grade applied to every texture (map, characters, props)
  grade: {
    saturation: 0.92,          // 1 = unchanged
    contrast: 0.96,            // around mid grey, 1 = unchanged
    tint: [1.03, 1.0, 0.95],   // warm multiply (r, g, b)
  },
  // Character texture matching (before the grade)
  character: {
    maxSize: 384,              // texture edge length cap (px)
    shadeFlatten: 0.65,        // 0–1: how much of the baked broad shading to remove
    shadeBlurSize: 24,         // px edge of the low-res copy used as the "broad shading" layer
    matchStrength: 0.85,        // 0–1: how far brightness / saturation / contrast move toward the map
    scaleClamp: [0.55, 1.5],   // limits on the saturation / contrast scale factors
    posterizeLevels: 8,       // luminance bands (0 = off)
    posterizeMix: 0.6,         // 0–1: blend toward the banded colour
  },
  // Stats the characters are matched to — replaced by the map's own (setStyleReference)
  reference: { lum: 0.5, lumStd: 0.16, sat: 0.32 },
  material: { roughness: 1, metalness: 0 },
};

const _processed = new WeakSet();       // textures already stylized
let _referenceSet = false;
let _resolveReference;
const _referenceReady = new Promise((resolve) => { _resolveReference = resolve; });

/** Resolves once the map has set the reference look (or after `timeoutMs`). */
export function whenStyleReferenceReady(timeoutMs = 4000) {
  if (_referenceSet) return Promise.resolve();
  return Promise.race([_referenceReady, new Promise((r) => setTimeout(r, timeoutMs))]);
}

// ── Pixel helpers (sRGB bytes, 0–1 maths) ───────────────────────────────────

const lumOf = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const satOf = (r, g, b) => Math.max(r, g, b) - Math.min(r, g, b);
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Mean luminance, its std dev and mean saturation over opaque pixels (sampled). */
export function measurePixels(data, step = 4) {
  let n = 0, sumL = 0, sumL2 = 0, sumS = 0;
  for (let i = 0; i < data.length; i += 4 * step) {
    if (data[i + 3] < 128) continue;
    const r = data[i] / 255, g = data[i + 1] / 255, b = data[i + 2] / 255;
    const l = lumOf(r, g, b);
    sumL += l; sumL2 += l * l; sumS += satOf(r, g, b); n++;
  }
  if (!n) return null;
  const lum = sumL / n;
  return { lum, lumStd: Math.sqrt(Math.max(0, sumL2 / n - lum * lum)), sat: sumS / n, n };
}

/** Applies `fn(r, g, b) → [r, g, b]` (0–1) to every pixel in place. */
function mapPixels(data, fn) {
  for (let i = 0; i < data.length; i += 4) {
    const out = fn(data[i] / 255, data[i + 1] / 255, data[i + 2] / 255, i);
    data[i] = out[0] * 255; data[i + 1] = out[1] * 255; data[i + 2] = out[2] * 255;
  }
}

const _rgb = [0, 0, 0];
/** Sets saturation (scale around the pixel's luminance) and returns _rgb. */
function scaleSat(r, g, b, l, s) {
  _rgb[0] = l + (r - l) * s; _rgb[1] = l + (g - l) * s; _rgb[2] = l + (b - l) * s;
  return _rgb;
}

/**
 * Character matching: flatten baked shading, match the reference stats, posterize.
 * `broad` is the same image blurred (low-res copy scaled back up), same size as `data`.
 */
export function matchCharacterPixels(data, broad, cfg = artStyleConfig.character, ref = artStyleConfig.reference) {
  const stats = measurePixels(data);
  if (!stats) return;
  const [lo, hi] = cfg.scaleClamp;
  const k = cfg.matchStrength;
  const flatten = cfg.shadeFlatten;
  // Contrast left after flattening is roughly the detail part; scale it toward the map's
  const contrastScale = THREE.MathUtils.lerp(1, THREE.MathUtils.clamp(ref.lumStd / Math.max(1e-3, stats.lumStd * (1 - flatten * 0.5)), lo, hi), k);
  const satScale = THREE.MathUtils.lerp(1, THREE.MathUtils.clamp(ref.sat / Math.max(1e-3, stats.sat), lo, hi), k);
  const targetLum = THREE.MathUtils.lerp(stats.lum, ref.lum, k);
  const levels = cfg.posterizeLevels;
  const pMix = levels > 1 ? cfg.posterizeMix : 0;

  mapPixels(data, (r, g, b, i) => {
    let l = lumOf(r, g, b);
    const bl = broad ? lumOf(broad[i] / 255, broad[i + 1] / 255, broad[i + 2] / 255) : stats.lum;
    // Remove part of the broad shading, then re-centre and rescale the contrast
    let nl = l - flatten * (bl - stats.lum);
    nl = targetLum + (nl - stats.lum) * contrastScale;
    if (pMix) nl += (Math.round(clamp01(nl) * (levels - 1)) / (levels - 1) - nl) * pMix;
    nl = clamp01(nl);
    // Shift to the new luminance, then rescale saturation around it
    const d = nl - l;
    r += d; g += d; b += d; l = nl;
    scaleSat(r, g, b, l, satScale);
    return [clamp01(_rgb[0]), clamp01(_rgb[1]), clamp01(_rgb[2])];
  });
}

/** The shared final grade (every texture). */
export function gradePixels(data, grade = artStyleConfig.grade) {
  const [tr, tg, tb] = grade.tint;
  mapPixels(data, (r, g, b) => {
    const l = lumOf(r, g, b);
    scaleSat(r, g, b, l, grade.saturation);
    _rgb[0] = 0.5 + (_rgb[0] - 0.5) * grade.contrast;
    _rgb[1] = 0.5 + (_rgb[1] - 0.5) * grade.contrast;
    _rgb[2] = 0.5 + (_rgb[2] - 0.5) * grade.contrast;
    return [clamp01(_rgb[0] * tr), clamp01(_rgb[1] * tg), clamp01(_rgb[2] * tb)];
  });
}

// ── Texture plumbing ────────────────────────────────────────────────────────

function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function imageSize(img) {
  return {
    w: img?.naturalWidth || img?.videoWidth || img?.width || 0,
    h: img?.naturalHeight || img?.videoHeight || img?.height || 0,
  };
}

/** Draws the texture's image (capped at maxSize) to a canvas; null if it can't be read. */
function readTexture(texture, maxSize = Infinity) {
  if (texture?.isCompressedTexture || texture?.isDataTexture) return null; // GPU formats (KTX2…): not drawable
  const img = texture?.image;
  const { w, h } = imageSize(img);
  if (!w || !h) return null;
  const s = Math.min(1, maxSize / Math.max(w, h));
  const cw = Math.max(1, Math.round(w * s)), ch = Math.max(1, Math.round(h * s));
  const canvas = makeCanvas(cw, ch);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, cw, ch);
  try {
    return { canvas, ctx, imageData: ctx.getImageData(0, 0, cw, ch) };
  } catch {
    return null; // tainted / unreadable
  }
}

/** Blurred copy of the canvas (downscale to `size`, scale back up), as pixel data. */
function broadLayer(canvas, size) {
  const { width: w, height: h } = canvas;
  const sw = Math.max(1, Math.round(size * (w >= h ? 1 : w / h)));
  const sh = Math.max(1, Math.round(size * (h > w ? 1 : h / w)));
  const small = makeCanvas(sw, sh);
  const sctx = small.getContext('2d');
  sctx.imageSmoothingQuality = 'high';
  sctx.drawImage(canvas, 0, 0, sw, sh);
  const big = makeCanvas(w, h);
  const bctx = big.getContext('2d', { willReadFrequently: true });
  bctx.imageSmoothingEnabled = true;
  bctx.imageSmoothingQuality = 'high';
  bctx.drawImage(small, 0, 0, w, h);
  return bctx.getImageData(0, 0, w, h).data;
}

function writeTexture(texture, read) {
  read.ctx.putImageData(read.imageData, 0, 0);
  texture.image = read.canvas;
  texture.needsUpdate = true;
}

function forEachMaterial(root, fn) {
  const seen = new Set();
  root.traverse((obj) => {
    if (!obj.isMesh && !obj.isSkinnedMesh) return;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const m of mats) {
      if (m && !seen.has(m)) { seen.add(m); fn(m); }
    }
  });
}

function normalizeMaterial(m) {
  const cfg = artStyleConfig.material;
  if ('roughness' in m && !m.roughnessMap) m.roughness = cfg.roughness;
  if ('metalness' in m && !m.metalnessMap) m.metalness = cfg.metalness;
  if ('envMapIntensity' in m) m.envMapIntensity = 0;
}

/** Grades the base colour of an untextured material the same way as the textures. */
function gradeMaterialColor(m) {
  if (!m.color || m.map) return;
  // colours are linear in three.js; grade in sRGB like the textures
  const c = m.color.clone().convertLinearToSRGB();
  const px = new Uint8ClampedArray([c.r * 255, c.g * 255, c.b * 255, 255]);
  gradePixels(px);
  m.color.setRGB(px[0] / 255, px[1] / 255, px[2] / 255).convertSRGBToLinear();
}

function stylizeTexture(texture, { character = false } = {}) {
  if (!texture || _processed.has(texture)) return;
  _processed.add(texture);
  const read = readTexture(texture, character ? artStyleConfig.character.maxSize : Infinity);
  if (!read) return;
  const data = read.imageData.data;
  if (character) {
    const broad = artStyleConfig.character.shadeFlatten > 0
      ? broadLayer(read.canvas, artStyleConfig.character.shadeBlurSize)
      : null;
    matchCharacterPixels(data, broad);
  }
  gradePixels(data);
  writeTexture(texture, read);
}

/**
 * Stylizes a loaded GLB scene in place (its textures are shared by clones, so call this
 * once on the cached gltf.scene). `character`: also match the textures to the map.
 * `materials: false` keeps the roughness / metalness (props that tune their own shine).
 */
export function stylizeObject(root, { character = false, materials = true } = {}) {
  if (!artStyleConfig.enabled || !root) return;
  forEachMaterial(root, (m) => {
    if (materials) normalizeMaterial(m);
    if (m.map) stylizeTexture(m.map, { character });
    else if (!_processed.has(m)) { _processed.add(m); gradeMaterialColor(m); }
  });
}

/**
 * Measures the map's base-colour textures (weighted by size) and makes that the look
 * the characters are matched to. Call before stylizeObject(map).
 */
export function setStyleReference(root) {
  if (!artStyleConfig.enabled || !root) return;
  let wSum = 0, lum = 0, lumStd = 0, sat = 0;
  const seen = new Set();
  forEachMaterial(root, (m) => {
    const tex = m.map;
    if (!tex || seen.has(tex) || m.transparent) return;
    seen.add(tex);
    const read = readTexture(tex, 128);
    const stats = read && measurePixels(read.imageData.data, 1);
    if (!stats) return;
    const { w, h } = imageSize(tex.image);
    const weight = w * h;
    wSum += weight; lum += stats.lum * weight; lumStd += stats.lumStd * weight; sat += stats.sat * weight;
  });
  if (wSum > 0) {
    artStyleConfig.reference = { lum: lum / wSum, lumStd: lumStd / wSum, sat: sat / wSum };
  }
  _referenceSet = true;
  _resolveReference();
}

/**
 * MapLoader.ts – shared map runtime.
 *
 * Single source of truth for all map data formats and rendering logic.
 * Both the editor (App.tsx) and any downstream Three.js project use
 * this file directly — no separate copy is maintained.
 *
 * For downstream use, copy this file and install:
 *   npm install three jszip
 *   npm install --save-dev @types/three
 *
 * For KTX2 texture support, also copy basis_transcoder.js and
 * basis_transcoder.wasm (from public/basis/) to your project's static
 * directory, then pass your WebGLRenderer when loading:
 *   const group = await new MapLoader().load(zipFile, { renderer, transcoderPath: '/basis/' })
 *
 * Usage (no textures):
 *   import { MapLoader } from './MapLoader'
 *   const group = await new MapLoader().load(zipFileOrUrl)
 *   scene.add(group)
 *
 * The returned Group has three named children:
 *   group.getObjectByName('terrain')  – MeshStandard terrain with vertex colours or KTX2 splat
 *   group.getObjectByName('grass')    – instanced grass blade chunks
 *   group.getObjectByName('objects')  – all placed GLB models
 */

import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js'
import JSZip from 'jszip'
import { registerTerrainHeightResolver } from './terrainHeight.js'

// ── Exported constants ─────────────────────────────────────────────────────
// These define the fixed terrain resolution used by both editor and runtime.
// Change them here and both sides update automatically.

export const TERRAIN_VERTS = 65          // vertex count per axis (64 quads)
export const TERRAIN_SIZE  = 50          // world-space extent in units
export const GRASS_CHUNKS  = 8           // chunk grid dimension (8×8 = 64 chunks)
export const MAX_BLADES_PER_CHUNK = 2000  // instanced mesh capacity per chunk

// ── Splat shader constants (shared between MapLoader and the editor) ────────

export const MAX_TERRAIN_SPLAT_TEXTURES = 4
export const MAX_STEEPNESS_STOPS = 4

// Individual per-stop uniform names (avoids driver dynamic-indexing issues)
export const SPLAT_STOP_NAMES = [0,1,2,3,4,5,6,7].map((i) => ({
  h: `uSH${i}`, c: `uSC${i}`, t: `uST${i}`,
}))
export const STEEP_STOP_NAMES = [0,1,2,3].map((i) => ({
  h: `uSSH${i}`, c: `uSSC${i}`, t: `uSST${i}`,
}))

// ── Exported manifest types ────────────────────────────────────────────────

export interface MapTerrainColorStop {
  color: string      // hex e.g. '#4a7850'
  minHeight: number  // world-space Y threshold
  textureSet?: string
}

export interface MapTerrainSteepnessStop {
  color: string         // hex e.g. '#888888'
  minSteepness: number  // slope angle threshold in degrees (0=flat, 90=vertical)
  textureSet?: string
}

export interface MapGrassColorStop {
  color: string
  weight: number  // relative weight, normalised internally
  textureSet?: string  // optional KTX2 texture set name
}

export interface MapObject {
  id: string
  name: string
  modelFile: string  // path inside zip e.g. 'models/tree.glb'
  visible: boolean
  position: [number, number, number]
  rotation: [number, number, number]
  scale: [number, number, number]
}

// Per-body manual level override stored in the mappack.
// When absent the runtime recomputes the level from terrain heights.
export interface WaterBodyOverride {
  bodyKey: string  // stable key = grid index of lowest-index cell in body
  level:   number  // manual water surface Y
}

export interface MapManifest {
  version: number
  terrain: {
    gridWidth: number    // = TERRAIN_VERTS
    gridHeight: number   // = TERRAIN_VERTS
    worldSize: number    // = TERRAIN_SIZE
    heightsFile: string  // path inside zip
    colorStops: MapTerrainColorStop[]
    colorBlendWidth?: number  // world-unit blend zone width between height stops (0 = hard)
    steepnessStops?: MapTerrainSteepnessStop[]
  }
  grass: {
    densityFile: string  // path inside zip
    seed: number
    maxDensity: number
    minScale: number
    maxScale: number
    tipSharpness?: number
    colorStops: MapGrassColorStop[]
  }
  objects: MapObject[]
  water?: { maskFile: string; overrides?: WaterBodyOverride[] }
  // KTX2 texture set names bundled in zip under textures/{name}/albedo.ktx2
  textures?: string[]
}

// ── Exported grass chunk result ────────────────────────────────────────────

export interface GrassChunkGroup {
  textureSet: string | null   // null = pure vertex colour, string = KTX2 set name
  count: number
  matrices: THREE.Matrix4[]
  colorArray: Float32Array    // count * 3, linear-space RGB
}

export interface GrassChunkInstances {
  count: number
  matrices: THREE.Matrix4[]
  colorArray: Float32Array    // count * 3, linear-space RGB (all blades combined)
  groups: GrassChunkGroup[]   // blades split by textureSet (or null for colour-only)
}

// ── MapLoadOptions ─────────────────────────────────────────────────────────

export interface MapLoadOptions {
  /**
   * Provide your WebGLRenderer to enable KTX2 texture support.
   * When omitted the map renders with vertex colours only.
   */
  renderer?: THREE.WebGLRenderer
  /**
   * URL path where basis_transcoder.js / .wasm are served.
   * Defaults to '/basis/' — copy public/basis/ from this repo to your project.
   */
  transcoderPath?: string
}

// ── Exported low-level functions ───────────────────────────────────────────
// These are the canonical implementations. Any change here is automatically
// reflected in both the editor preview and the exported runtime.

/** LCG seeded random — stable across runs for same seed. */
export function seededRandom(seed: number): () => number {
  let s = (seed | 0) >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

/** Pick a grass colour by CDF walk over weighted stops. */
export function pickGrassColor(stops: MapGrassColorStop[], rand: number): string {
  if (stops.length === 0) return '#3d8c2a'
  const total = stops.reduce((a, s) => a + s.weight, 0) || 1
  let cum = 0
  for (const stop of stops) {
    cum += stop.weight / total
    if (rand < cum) return stop.color
  }
  return stops[stops.length - 1].color
}

/** Pick a grass stop (colour + optional textureSet) by CDF walk over weighted stops. */
export function pickGrassStop(stops: MapGrassColorStop[], rand: number): MapGrassColorStop {
  if (stops.length === 0) return { color: '#3d8c2a', weight: 100 }
  const total = stops.reduce((a, s) => a + s.weight, 0) || 1
  let cum = 0
  for (const stop of stops) {
    cum += stop.weight / total
    if (rand < cum) return stop
  }
  return stops[stops.length - 1]
}

/** Bilinear sample from a flat Float32Array on a regular grid. */
export function sampleBilinear(
  data: Float32Array,
  wx: number,
  wz: number,
  gridW: number,
  gridH: number,
  worldSize: number
): number {
  const resX = gridW - 1
  const resZ = gridH - 1
  const gx = (wx / worldSize + 0.5) * resX
  const gz = (wz / worldSize + 0.5) * resZ
  const j0 = Math.max(0, Math.min(resX - 1, Math.floor(gx)))
  const i0 = Math.max(0, Math.min(resZ - 1, Math.floor(gz)))
  const j1 = Math.min(resX, j0 + 1)
  const i1 = Math.min(resZ, i0 + 1)
  const tx = gx - j0
  const tz = gz - i0
  return (
    data[i0 * gridW + j0] * (1 - tx) * (1 - tz) +
    data[i0 * gridW + j1] *      tx  * (1 - tz) +
    data[i1 * gridW + j0] * (1 - tx) *      tz  +
    data[i1 * gridW + j1] *      tx  *      tz
  )
}

/**
 * Pack a Float32Array into the .bin wire format:
 *   uint32 gridW  (little-endian)
 *   uint32 gridH  (little-endian)
 *   float32[]     data, row-major
 */
export function makeFloat32Bin(data: Float32Array, verts: number): ArrayBuffer {
  const buf = new ArrayBuffer(8 + data.byteLength)
  const view = new DataView(buf)
  view.setUint32(0, verts, true)
  view.setUint32(4, verts, true)
  new Float32Array(buf, 8).set(data)
  return buf
}

/** Parse a .bin buffer produced by makeFloat32Bin. */
export function parseFloat32Bin(buf: ArrayBuffer): {
  width: number
  height: number
  data: Float32Array
} {
  const view = new DataView(buf)
  return {
    width:  view.getUint32(0, true),
    height: view.getUint32(4, true),
    data:   new Float32Array(buf, 8),
  }
}

/**
 * Build terrain geometry from scratch.
 * Returns a BufferGeometry with position, normal, and colour attributes.
 */
export function buildTerrainGeometry(
  heights: Float32Array,
  gridW: number,
  gridH: number,
  worldSize: number,
  colorStops: MapTerrainColorStop[],
  colorBlendWidth = 0,
  steepnessStops: MapTerrainSteepnessStop[] = []
): THREE.BufferGeometry {
  const resX = gridW - 1
  const resZ = gridH - 1
  const geo  = new THREE.BufferGeometry()

  const positions = new Float32Array(gridW * gridH * 3)
  for (let i = 0; i < gridH; i++) {
    for (let j = 0; j < gridW; j++) {
      const k = (i * gridW + j) * 3
      positions[k]     = (j / resX - 0.5) * worldSize
      positions[k + 1] = heights[i * gridW + j]
      positions[k + 2] = (i / resZ - 0.5) * worldSize
    }
  }

  const indices: number[] = []
  for (let i = 0; i < resZ; i++) {
    for (let j = 0; j < resX; j++) {
      const a = i * gridW + j
      const b = a + 1
      const c = (i + 1) * gridW + j
      const d = c + 1
      indices.push(a, c, b, b, c, d)
    }
  }

  const uvs = new Float32Array(gridW * gridH * 2)
  for (let i = 0; i < gridH; i++) {
    for (let j = 0; j < gridW; j++) {
      const k = (i * gridW + j) * 2
      uvs[k]     = j / (gridW - 1)
      uvs[k + 1] = i / (gridH - 1)
    }
  }

  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geo.setAttribute('uv',       new THREE.BufferAttribute(uvs, 2))
  geo.setIndex(indices)
  geo.computeVertexNormals()
  applyTerrainColors(geo, heights, gridW, gridH, colorStops, colorBlendWidth, steepnessStops)
  return geo
}

/**
 * Update an existing terrain geometry in-place (no reallocation).
 * Use this during brush strokes to avoid rebuilding indices each frame.
 */
export function syncTerrainGeometry(
  geo: THREE.BufferGeometry,
  heights: Float32Array,
  gridW: number,
  gridH: number,
  worldSize: number,
  colorStops: MapTerrainColorStop[],
  colorBlendWidth = 0,
  steepnessStops: MapTerrainSteepnessStop[] = []
): void {
  const pos = geo.attributes.position as THREE.BufferAttribute
  const resX = gridW - 1
  const resZ = gridH - 1
  for (let i = 0; i < gridH; i++) {
    for (let j = 0; j < gridW; j++) {
      const idx = i * gridW + j
      const x = (j / resX - 0.5) * worldSize
      const z = (i / resZ - 0.5) * worldSize
      pos.setXYZ(idx, x, heights[idx], z)
    }
  }
  pos.needsUpdate = true
  geo.computeVertexNormals()
  applyTerrainColors(geo, heights, gridW, gridH, colorStops, colorBlendWidth, steepnessStops)
}

/**
 * Compute blade transforms and colours for a single grass chunk.
 * Pure function — no Three.js mesh created; apply the result to an
 * InstancedMesh with buildGrassChunkInstances().
 */
export function buildGrassChunkInstances(
  heights: Float32Array,
  densityMap: Float32Array,
  gridW: number,
  gridH: number,
  worldSize: number,
  chunkX: number,
  chunkZ: number,
  numChunks: number,
  config: {
    seed: number
    maxDensity: number
    minScale: number
    maxScale: number
    colorStops: MapGrassColorStop[]
  }
): GrassChunkInstances {
  const { seed, maxDensity, minScale, maxScale, colorStops } = config
  const chunkSize = worldSize / numChunks
  const cx0 = (chunkX / numChunks - 0.5) * worldSize
  const cz0 = (chunkZ / numChunks - 0.5) * worldSize

  const chunkSeed = ((seed * 10000 + chunkX * 100 + chunkZ) | 0) >>> 0
  const rng = seededRandom(chunkSeed)

  const dummy    = new THREE.Object3D()
  const colorObj = new THREE.Color()
  const matrices: THREE.Matrix4[]  = []
  const colorBuf: number[]         = []

  // Per-textureSet groups (null key = colour-only blades)
  const groupMap = new Map<string | null, { matrices: THREE.Matrix4[]; colorBuf: number[] }>()

  for (let k = 0; k < maxDensity; k++) {
    // Consume all random values upfront — order must never change
    const wx        = cx0 + rng() * chunkSize
    const wz        = cz0 + rng() * chunkSize
    const acceptR   = rng()
    const tilt      = (rng() - 0.5) * 0.5
    const yRot      = rng() * Math.PI * 2
    const scaleR    = rng()
    const colorR    = rng()

    const dens = sampleBilinear(densityMap, wx, wz, gridW, gridH, worldSize)
    if (acceptR >= dens) continue

    const wy = sampleBilinear(heights, wx, wz, gridW, gridH, worldSize)
    dummy.position.set(wx, wy, wz)
    dummy.rotation.set(tilt, yRot, 0)
    dummy.scale.setScalar(minScale + scaleR * (maxScale - minScale))
    dummy.updateMatrix()
    const mat = dummy.matrix.clone()
    matrices.push(mat)

    const stop = pickGrassStop(colorStops, colorR)
    colorObj.set(stop.color).convertSRGBToLinear()
    colorBuf.push(colorObj.r, colorObj.g, colorObj.b)

    const key = stop.textureSet ?? null
    if (!groupMap.has(key)) groupMap.set(key, { matrices: [], colorBuf: [] })
    const grp = groupMap.get(key)!
    grp.matrices.push(mat)
    grp.colorBuf.push(colorObj.r, colorObj.g, colorObj.b)

    if (matrices.length >= MAX_BLADES_PER_CHUNK) break
  }

  const groups: GrassChunkGroup[] = [...groupMap.entries()].map(([textureSet, g]) => ({
    textureSet,
    count: g.matrices.length,
    matrices: g.matrices,
    colorArray: new Float32Array(g.colorBuf),
  }))

  return {
    count: matrices.length,
    matrices,
    colorArray: new Float32Array(colorBuf),
    groups,
  }
}

// ── Splat shader builder functions (exported so the editor can import them) ─

export function buildSplatVertDecls(): string {
  return 'varying vec3 vTerrainWorld;\nvarying vec3 vTerrainNormal;'
}

export function buildSplatFragDecls(steepN: number): string {
  const stops = SPLAT_STOP_NAMES.map(({ h, c, t }) =>
    `uniform float ${h}; uniform vec3 ${c}; uniform float ${t};`
  ).join('\n')
  const steepStops = steepN > 0 ? STEEP_STOP_NAMES.slice(0, steepN).map(({ h, c, t }) =>
    `uniform float ${h}; uniform vec3 ${c}; uniform float ${t};`
  ).join('\n') : ''
  return [
    'varying vec3 vTerrainWorld;',
    'varying vec3 vTerrainNormal;',
    'uniform int   uSplatN;',
    'uniform float uSplatScale;',
    'uniform float uSplatBlend;',
    'uniform int   uSteepN;',
    stops,
    steepStops,
    'uniform sampler2D uSplatTex0, uSplatTex1, uSplatTex2, uSplatTex3;',
  ].join('\n')
}

export function buildSplatFragCode(steepN: number): string {
  // Flat if-chain to find which height stop applies
  const hChecks = SPLAT_STOP_NAMES.map(({ h }, i) =>
    i === 0 ? '' : `  if (uSplatN > ${i} && h >= ${h}) si = ${i};`
  ).filter(Boolean).join('\n')

  const cRead = SPLAT_STOP_NAMES.map(({ c }, i) =>
    i === 0 ? `  if (si == 0)      sc = ${c};` : `  else if (si == ${i}) sc = ${c};`
  ).join('\n')
  const tRead = SPLAT_STOP_NAMES.map(({ t }, i) =>
    i === 0 ? `  if (si == 0)      ti = ${t};` : `  else if (si == ${i}) ti = ${t};`
  ).join('\n')

  const snChecks = SPLAT_STOP_NAMES.map(({ h, c, t }, i) =>
    i === 0 ? '' : `  if (si == ${i - 1} && uSplatN > ${i}) { sn = ${i}; hn = ${h}; sc2 = ${c}; ti2 = ${t}; }`
  ).filter(Boolean).join('\n')

  const sampleTex = (colVar: string, tiVar: string) =>
    `  if (${tiVar} < 0.0) ${colVar} = sc${colVar === 'col2' ? '2' : ''};
  else if (${tiVar} < 0.5) ${colVar} = texture2D(uSplatTex0, wuv).rgb;
  else if (${tiVar} < 1.5) ${colVar} = texture2D(uSplatTex1, wuv).rgb;
  else if (${tiVar} < 2.5) ${colVar} = texture2D(uSplatTex2, wuv).rgb;
  else                      ${colVar} = texture2D(uSplatTex3, wuv).rgb;`

  // Steepness override block — blends height→steepness at the first threshold,
  // then between adjacent steepness stops above it.
  let steepBlock = ''
  if (steepN > 0) {
    // ssi always starts at 0 inside the blend zone; higher stops are checked explicitly
    const steepChecks = STEEP_STOP_NAMES.slice(0, steepN).map(({ h }, i) =>
      i === 0 ? '' : `  if (uSteepN > ${i} && slopeDeg >= ${h}) ssi = ${i};`
    ).filter(Boolean).join('\n')
    // Current stop color/tex
    const steepCRead = STEEP_STOP_NAMES.slice(0, steepN).map(({ c }, i) =>
      i === 0 ? `  if (ssi == 0)      stc = ${c};` : `  else if (ssi == ${i}) stc = ${c};`
    ).join('\n')
    const steepTRead = STEEP_STOP_NAMES.slice(0, steepN).map(({ t }, i) =>
      i === 0 ? `  if (ssi == 0)      stt = ${t};` : `  else if (ssi == ${i}) stt = ${t};`
    ).join('\n')
    // Next steepness stop for inter-stop blending
    const steepSnChecks = STEEP_STOP_NAMES.slice(0, steepN).map(({ h, c, t }, i) =>
      i === 0 ? '' : `  if (ssi == ${i-1} && uSteepN > ${i}) { ssn = ${i}; shn = ${h}; stc2 = ${c}; stt2 = ${t}; }`
    ).filter(Boolean).join('\n')

    const sampleSteepTex = (colVar: string, tiVar: string, srcVar: string) =>
      `  if (${tiVar} < 0.0) ${colVar} = ${srcVar};
  else if (${tiVar} < 0.5) ${colVar} = texture2D(uSplatTex0, wuv).rgb;
  else if (${tiVar} < 1.5) ${colVar} = texture2D(uSplatTex1, wuv).rgb;
  else if (${tiVar} < 2.5) ${colVar} = texture2D(uSplatTex2, wuv).rgb;
  else                     ${colVar} = texture2D(uSplatTex3, wuv).rgb;`

    steepBlock = `
  // Steepness — blend height→steepness at first threshold, then between stops
  float ny = normalize(vTerrainNormal).y;
  float slopeDeg = acos(clamp(ny, -1.0, 1.0)) * (180.0 / 3.14159265);
  // Entry alpha: 0 below blend zone, 1 once fully past first threshold
  float steepAlpha = smoothstep(${STEEP_STOP_NAMES[0].h} - uSplatBlend, ${STEEP_STOP_NAMES[0].h}, slopeDeg);
  if (steepAlpha > 0.0) {
  int ssi = 0; // start at first stop; higher stops checked below
${steepChecks}
  vec3 stc = vec3(1.0); float stt = -1.0;
${steepCRead}
${steepTRead}
  // Next steepness stop for inter-stop blending
  int ssn = ssi; float shn = slopeDeg + 1e6;
  vec3 stc2 = stc; float stt2 = stt;
${steepSnChecks}
  vec3 scol1 = vec3(0.0);
${sampleSteepTex('scol1', 'stt', 'stc')}
  vec3 scol2 = scol1;
  float sblend_t = (ssn == ssi || uSplatBlend <= 0.0) ? 0.0 : smoothstep(shn - uSplatBlend, shn, slopeDeg);
  if (sblend_t > 0.0) {
${sampleSteepTex('scol2', 'stt2', 'stc2')}
  }
  vec3 steepCol = mix(scol1, scol2, sblend_t);
  diffuseColor.rgb = mix(diffuseColor.rgb, steepCol, steepAlpha);
  }`
  }

  // KTX2 textures are decoded to linear by the GPU (sRGB hardware decode),
  // so no manual pow(2.2) is needed — that would double-decode and darken.
  return `#include <color_fragment>
{
  float h = vTerrainWorld.y;
  int si = 0;
${hChecks}
  vec3 sc = vec3(1.0); float ti = -1.0;
${cRead}
${tRead}
  // Next stop for blending
  int sn = si; float hn = h + 1e6;
  vec3 sc2 = sc; float ti2 = ti;
${snChecks}
  vec2 wuv = vTerrainWorld.xz / uSplatScale;
  vec3 col1 = vec3(0.0);
${sampleTex('col1', 'ti')}
  vec3 col2 = col1;
  float blend_t = (sn == si || uSplatBlend <= 0.0) ? 0.0 : smoothstep(hn - uSplatBlend, hn, h);
  if (blend_t > 0.0) {
${sampleTex('col2', 'ti2')}
  }
  diffuseColor.rgb = mix(col1, col2, blend_t);
${steepBlock}
}`
}

export function makeSplatInitUniforms(): Record<string, { value: any }> {
  const u: Record<string, { value: any }> = {
    uSplatN     : { value: 0 },
    uSplatScale : { value: 4.0 },
    uSplatBlend : { value: 0.0 },
    uSteepN     : { value: 0 },
    uSplatTex0  : { value: null },
    uSplatTex1  : { value: null },
    uSplatTex2  : { value: null },
    uSplatTex3  : { value: null },
  }
  SPLAT_STOP_NAMES.forEach(({ h, c, t }) => {
    u[h] = { value: 0 }
    u[c] = { value: new THREE.Color(0) }
    u[t] = { value: -1 }
  })
  STEEP_STOP_NAMES.forEach(({ h, c, t }) => {
    u[h] = { value: 0 }
    u[c] = { value: new THREE.Color(0) }
    u[t] = { value: -1 }
  })
  return u
}

// ── Private geometry helpers ───────────────────────────────────────────────

function applyTerrainColors(
  geo: THREE.BufferGeometry,
  heights: Float32Array,
  gridW: number,
  gridH: number,
  stops: MapTerrainColorStop[],
  blendWidth = 0,
  steepnessStops: MapTerrainSteepnessStop[] = []
): void {
  const n = gridW * gridH
  if (!geo.attributes.color) {
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3), 3))
  }
  const sorted = [...stops].sort((a, b) => a.minHeight - b.minHeight)
  const sortedSteep = [...steepnessStops].sort((a, b) => a.minSteepness - b.minSteepness)
  const attr   = geo.attributes.color as THREE.BufferAttribute
  const normAttr = geo.attributes.normal as THREE.BufferAttribute | undefined
  const lo     = new THREE.Color()
  const hi     = new THREE.Color()
  const RAD2DEG = 180 / Math.PI
  for (let i = 0; i < n; i++) {
    const h = heights[i]
    let si = 0
    for (let k = 1; k < sorted.length; k++) {
      if (h >= sorted[k].minHeight) si = k
      else break
    }
    lo.set(sorted[si].color)
    const next = sorted[si + 1]
    if (next && blendWidth > 0) {
      const t = Math.max(0, Math.min(1, (h - (next.minHeight - blendWidth)) / blendWidth))
      if (t > 0) {
        hi.set(next.color)
        lo.lerp(hi, t)
      }
    }
    // steepness — blend height→steepness at first threshold, then between stops
    if (sortedSteep.length > 0 && normAttr) {
      const ny = normAttr.getY(i)
      const slopeDeg = Math.acos(Math.max(-1, Math.min(1, ny))) * RAD2DEG
      const firstThresh = sortedSteep[0].minSteepness
      const steepAlpha = blendWidth > 0
        ? Math.max(0, Math.min(1, (slopeDeg - (firstThresh - blendWidth)) / blendWidth))
        : (slopeDeg >= firstThresh ? 1 : 0)
      if (steepAlpha > 0) {
        // find active steepness stop (start at 0)
        let ssi = 0
        for (let k = 1; k < sortedSteep.length; k++) {
          if (slopeDeg >= sortedSteep[k].minSteepness) ssi = k
          else break
        }
        hi.set(sortedSteep[ssi].color)
        const steepNext = sortedSteep[ssi + 1]
        if (steepNext && blendWidth > 0) {
          const t = Math.max(0, Math.min(1, (slopeDeg - (steepNext.minSteepness - blendWidth)) / blendWidth))
          if (t > 0) {
            const tmp = new THREE.Color(steepNext.color)
            hi.lerp(tmp, t)
          }
        }
        lo.lerp(hi, steepAlpha)
      }
    }
    attr.setXYZ(i, lo.r, lo.g, lo.b)
  }
  attr.needsUpdate = true
}

// ── Grass group builder (used internally by MapLoader.load) ────────────────

async function buildGrassGroup(
  heights: Float32Array,
  densityMap: Float32Array,
  gridW: number,
  gridH: number,
  worldSize: number,
  grassConfig: MapManifest['grass'],
  textureMap: Map<string, THREE.Texture> | null
): Promise<THREE.Group> {
  const group = new THREE.Group()
  group.name  = 'grass'

  const bladeGeo = new THREE.PlaneGeometry(0.13, 0.42)
  bladeGeo.translate(0, 0.21, 0)

  for (let ci = 0; ci < GRASS_CHUNKS; ci++) {
    for (let cj = 0; cj < GRASS_CHUNKS; cj++) {
      const inst = buildGrassChunkInstances(
        heights, densityMap, gridW, gridH, worldSize,
        cj, ci, GRASS_CHUNKS,
        {
          seed:       grassConfig.seed,
          maxDensity: grassConfig.maxDensity,
          minScale:   grassConfig.minScale,
          maxScale:   grassConfig.maxScale,
          colorStops: grassConfig.colorStops,
        }
      )
      if (inst.count === 0) continue

      // One InstancedMesh per texture group so each can have its own material
      for (const grp of inst.groups) {
        if (grp.count === 0) continue
        const mat = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide })
        let colorData: Float32Array

        if (grp.textureSet && textureMap?.has(grp.textureSet)) {
          // Texture blades use white so the texture shows at full brightness
          const tex = textureMap.get(grp.textureSet)!.clone()
          tex.wrapS = tex.wrapT = THREE.RepeatWrapping
          tex.repeat.set(1, 3)
          tex.needsUpdate = true
          mat.map = tex
          colorData = new Float32Array(grp.count * 3).fill(1)
        } else {
          colorData = grp.colorArray.slice()
        }

        const mesh = new THREE.InstancedMesh(bladeGeo, mat, grp.count)
        grp.matrices.forEach((m, i) => mesh.setMatrixAt(i, m))
        mesh.instanceColor = new THREE.InstancedBufferAttribute(colorData, 3)
        mesh.instanceMatrix.needsUpdate = true
        group.add(mesh)
      }
    }
  }

  return group
}

// ── MapLoader class ────────────────────────────────────────────────────────

export class MapLoader {
  private gltfLoader = new GLTFLoader()

  /**
   * Load a .mappack (zip) and return a populated THREE.Group.
   * @param source  File | Blob | ArrayBuffer | string URL
   * @param options Pass { renderer } to enable KTX2 texture support
   */
  async load(
    source: File | Blob | ArrayBuffer | string,
    options: MapLoadOptions = {}
  ): Promise<THREE.Group> {
    const { renderer, transcoderPath = '/basis/' } = options
    const zip      = await this.openZip(source)
    const manifest = await this.readManifest(zip)

    const [terrainBuf, grassBuf] = await Promise.all([
      this.readFile(zip, manifest.terrain.heightsFile),
      this.readFile(zip, manifest.grass.densityFile),
    ])

    const terrain    = parseFloat32Bin(terrainBuf)
    const grassDens  = parseFloat32Bin(grassBuf)
    const { width: gW, height: gH, data: heights }    = terrain
    const { data: densityMap } = grassDens

    const root = new THREE.Group()
    root.name  = 'map'

    // Register this map's heightmap so the player snaps to terrain surface.
    const worldSize = manifest.terrain.worldSize
    const unregisterHeightResolver = registerTerrainHeightResolver((wx: number, wz: number) =>
      sampleBilinear(heights, wx, wz, gW, gH, worldSize)
    )
    root.userData.disposeTerrainHeightResolver = unregisterHeightResolver

    // Load KTX2 textures when renderer is provided and textures are bundled
    let textureMap: Map<string, THREE.Texture> | null = null
    if (renderer && manifest.textures && manifest.textures.length > 0) {
      textureMap = await this.loadKtx2Textures(zip, manifest.textures, renderer, transcoderPath)
    }

    // Terrain
    const terrainGeo  = buildTerrainGeometry(
      heights, gW, gH, manifest.terrain.worldSize,
      manifest.terrain.colorStops,
      manifest.terrain.colorBlendWidth,
      manifest.terrain.steepnessStops
    )
    const terrainMat  = this.buildTerrainMaterial(manifest, textureMap)
    const terrainMesh = new THREE.Mesh(terrainGeo, terrainMat)
    terrainMesh.name  = 'terrain'
    root.add(terrainMesh)

    // Grass
    root.add(await buildGrassGroup(
      heights, densityMap, gW, gH, manifest.terrain.worldSize, manifest.grass, textureMap
    ))

    // Objects
    const objectsGroup = new THREE.Group()
    objectsGroup.name  = 'objects'
    const modelCache: Map<string, THREE.Group> = new Map()
    const blobUrls: string[] = []

    for (const obj of manifest.objects) {
      if (!obj.visible) continue
      try {
        let scene = modelCache.get(obj.modelFile)
        if (!scene) {
          const glbBuf = await zip.file(obj.modelFile)?.async('arraybuffer')
          if (!glbBuf) { console.warn(`[MapLoader] missing: ${obj.modelFile}`); continue }
          const url  = URL.createObjectURL(new Blob([glbBuf], { type: 'model/gltf-binary' }))
          blobUrls.push(url)
          const gltf = await this.gltfLoader.loadAsync(url)
          scene = normalisePivot(gltf.scene.clone(true) as THREE.Group)
          modelCache.set(obj.modelFile, scene)
        }
        const inst = scene.clone(true)
        inst.name  = obj.name
        inst.position.set(...obj.position)
        inst.rotation.set(...obj.rotation)
        inst.scale.set(...obj.scale)
        objectsGroup.add(inst)
      } catch (err) {
        console.warn(`[MapLoader] failed to load ${obj.modelFile}:`, err)
      }
    }

    root.add(objectsGroup)
    blobUrls.forEach((u) => URL.revokeObjectURL(u))
    return root
  }

  /** Expose manifest parsing so callers can inspect before loading. */
  async readManifest(zip: JSZip): Promise<MapManifest> {
    const raw = await zip.file('map.json')?.async('string')
    if (!raw) throw new Error('[MapLoader] map.json not found in package')
    return JSON.parse(raw) as MapManifest
  }

  // Load all KTX2 texture sets from the zip into a name→Texture map.
  private async loadKtx2Textures(
    zip: JSZip,
    textureNames: string[],
    renderer: THREE.WebGLRenderer,
    transcoderPath: string
  ): Promise<Map<string, THREE.Texture>> {
    const loader = new KTX2Loader()
    loader.setTranscoderPath(transcoderPath)
    loader.detectSupport(renderer)

    const map = new Map<string, THREE.Texture>()
    const blobUrls: string[] = []

    await Promise.all(textureNames.map(async (ts) => {
      const buf = await zip.file(`textures/${ts}/albedo.ktx2`)?.async('arraybuffer')
      if (!buf) {
        console.warn(`[MapLoader] missing texture in package: textures/${ts}/albedo.ktx2`)
        return
      }
      const url = URL.createObjectURL(new Blob([buf], { type: 'image/ktx2' }))
      blobUrls.push(url)
      try {
        const tex = await loader.loadAsync(url)
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping
        map.set(ts, tex)
      } catch (err) {
        console.warn(`[MapLoader] failed to decode texture ${ts}:`, err)
      }
    }))

    blobUrls.forEach((u) => URL.revokeObjectURL(u))
    return map
  }

  // Build a terrain material: splat shader when textures are available, vertex colours otherwise.
  private buildTerrainMaterial(
    manifest: MapManifest,
    textureMap: Map<string, THREE.Texture> | null
  ): THREE.MeshStandardMaterial {
    const colorStops    = manifest.terrain.colorStops
    const steepnessStops = manifest.terrain.steepnessStops ?? []

    const sorted     = [...colorStops].sort((a, b) => a.minHeight - b.minHeight)
    const sortedSteep = [...steepnessStops].sort((a, b) => a.minSteepness - b.minSteepness)
      .slice(0, MAX_STEEPNESS_STOPS)

    const hasTextures = !!textureMap && textureMap.size > 0 &&
      (sorted.some((s) => s.textureSet) || sortedSteep.some((s) => s.textureSet))

    if (!hasTextures) {
      return new THREE.MeshStandardMaterial({ flatShading: true, vertexColors: true, side: THREE.DoubleSide })
    }

    const allTexSets = [
      ...sorted.filter((s) => s.textureSet).map((s) => s.textureSet!),
      ...sortedSteep.filter((s) => s.textureSet).map((s) => s.textureSet!),
    ]
    const uniqTex = [...new Set(allTexSets)].slice(0, MAX_TERRAIN_SPLAT_TEXTURES)

    const u = makeSplatInitUniforms()
    u.uSplatN.value     = Math.min(sorted.length, 8)
    u.uSplatBlend.value = manifest.terrain.colorBlendWidth ?? 0
    u.uSteepN.value     = sortedSteep.length

    sorted.slice(0, 8).forEach((stop, i) => {
      const { h, c, t } = SPLAT_STOP_NAMES[i]
      u[h].value = stop.minHeight
      if (stop.textureSet) {
        u[t].value = uniqTex.indexOf(stop.textureSet)
        u[c].value = new THREE.Color(1, 1, 1)
      } else {
        u[t].value = -1
        u[c].value = new THREE.Color(stop.color).convertSRGBToLinear()
      }
    })

    sortedSteep.forEach((stop, i) => {
      const { h, c, t } = STEEP_STOP_NAMES[i]
      u[h].value = stop.minSteepness
      if (stop.textureSet) {
        u[t].value = uniqTex.indexOf(stop.textureSet)
        u[c].value = new THREE.Color(1, 1, 1)
      } else {
        u[t].value = -1
        u[c].value = new THREE.Color(stop.color).convertSRGBToLinear()
      }
    })

    uniqTex.forEach((ts, i) => {
      const tex = textureMap!.get(ts)
      if (tex) u[`uSplatTex${i}`].value = tex
    })

    const steepN = sortedSteep.length
    const mat    = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, vertexColors: false })
    mat.customProgramCacheKey = () => `maploader-splat-s${steepN}`
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, u)
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>',
          `#include <common>\n${buildSplatVertDecls()}`)
        .replace('#include <begin_vertex>',
          `#include <begin_vertex>
vTerrainWorld = (modelMatrix * vec4(position, 1.0)).xyz;
vTerrainNormal = normalize(mat3(modelMatrix) * normal);`)
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>',
          `#include <common>\n${buildSplatFragDecls(steepN)}`)
        .replace('#include <color_fragment>', buildSplatFragCode(steepN))
    }

    return mat
  }

  private async openZip(source: File | Blob | ArrayBuffer | string): Promise<JSZip> {
    if (typeof source === 'string') {
      const buf = await (await fetch(source)).arrayBuffer()
      return JSZip.loadAsync(buf)
    }
    return JSZip.loadAsync(source as Blob | ArrayBuffer)
  }

  private async readFile(zip: JSZip, path: string): Promise<ArrayBuffer> {
    const buf = await zip.file(path)?.async('arraybuffer')
    if (!buf) throw new Error(`[MapLoader] missing file in package: ${path}`)
    return buf
  }
}

// ── Internal pivot normalisation (shared between MapLoader and editor) ─────

/** Centre a GLTF scene on its bottom face — same logic as SelectableModel. */
export function normalisePivot(group: THREE.Group): THREE.Group {
  const box    = new THREE.Box3().setFromObject(group)
  const center = new THREE.Vector3()
  box.getCenter(center)
  group.position.sub(center)
  group.position.y -= box.min.y - center.y
  return group
}

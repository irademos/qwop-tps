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
 *   group.getObjectByName('objects')  – all placed GLB models (each instance carries
 *                                        userData.mapObject = { id, name, modelFile })
 *   group.getObjectByName('scatter')  – instanced rocks / bushes / flowers
 *   group.getObjectByName('water')    – animated water surface (if any)
 *   group.getObjectByName('sea')      – ocean plane at the sea level (if set)
 *   group.getObjectByName('seabed')   – opaque floor under the ocean (if set)
 *
 * Terrain, grass, scatter and water share a parent group offset by the
 * terrain centre. group.userData.water holds a MapWaterInfo for gameplay
 * queries — pass it to sampleMapWaterLevel() with world-space x/z.
 * Painted trails and roads are drawn into the terrain material; when the map
 * has any, group.userData.paths holds a MapPathInfo — pass it to
 * sampleMapPath() to find out whether a world x/z is on a trail or road.
 *
 * In Sword Showdown: loaded by bootstrapGameApp.js (`MAPS` / `_loadMap`) with the game's
 * renderer; the basis transcoder is served from public/basis/ (copied from
 * three/examples/jsm/libs/basis). Game edits to the editor's copy: userData.mapObject on
 * placed objects, the KTX2 loader is disposed after use, a failed fetch throws.
 */

import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js'
import JSZip from 'jszip'

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

export type MapScatterType = 'rocks' | 'bushes' | 'flowers'

// Scatter instance. position x/z are terrain-local (relative to the terrain
// centre); y is the terrain height at export time — the runtime re-samples it.
export interface MapScatterInstance {
  type:      MapScatterType
  position:  [number, number, number]
  rotationY: number
  scale:     [number, number, number]
  color:     string
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
    worldSize: number    // = TERRAIN_SIZE (legacy; prefer worldWidth/worldDepth)
    worldWidth?: number  // X extent in world units (defaults to worldSize)
    worldDepth?: number  // Z extent in world units (defaults to worldSize)
    shape?: 'rectangle' | 'circle'
    centerX?: number     // terrain group offset in world space
    centerZ?: number
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
  scatter?: {
    instances: MapScatterInstance[]
    assetProps?: Partial<Record<MapScatterType, { castShadows: boolean; receiveShadows: boolean }>>
  }
  water?: {
    maskFile?:  string           // painted water depths (lakes, ponds)
    overrides?: WaterBodyOverride[]
    seaLevel?:  number           // ocean surface Y; absent = no ocean
  }
  paths?: {
    maskFile:   string  // raw Uint8 RG (R = trail, G = road), resolution² texels
    resolution: number  // = PATH_RES
    styles:     Record<MapPathType, MapPathStyle>
  }
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
  worldSize: number,
  worldDepth?: number,
): number {
  const wW = worldSize
  const wD = worldDepth ?? worldSize
  const resX = gridW - 1
  const resZ = gridH - 1
  const gx = (wx / wW + 0.5) * resX
  const gz = (wz / wD + 0.5) * resZ
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
  steepnessStops: MapTerrainSteepnessStop[] = [],
  worldWidth?: number,
  worldDepth?: number,
): THREE.BufferGeometry {
  const wW = worldWidth ?? worldSize
  const wD = worldDepth ?? worldSize
  const resX = gridW - 1
  const resZ = gridH - 1
  const geo  = new THREE.BufferGeometry()

  const positions = new Float32Array(gridW * gridH * 3)
  for (let i = 0; i < gridH; i++) {
    for (let j = 0; j < gridW; j++) {
      const k = (i * gridW + j) * 3
      positions[k]     = (j / resX - 0.5) * wW
      positions[k + 1] = heights[i * gridW + j]
      positions[k + 2] = (i / resZ - 0.5) * wD
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
  steepnessStops: MapTerrainSteepnessStop[] = [],
  worldWidth?: number,
  worldDepth?: number,
): void {
  const wW = worldWidth ?? worldSize
  const wD = worldDepth ?? worldSize
  const pos = geo.attributes.position as THREE.BufferAttribute
  const resX = gridW - 1
  const resZ = gridH - 1
  for (let i = 0; i < gridH; i++) {
    for (let j = 0; j < gridW; j++) {
      const idx = i * gridW + j
      const x = (j / resX - 0.5) * wW
      const z = (i / resZ - 0.5) * wD
      pos.setXYZ(idx, x, heights[idx], z)
    }
  }
  pos.needsUpdate = true
  geo.computeBoundingSphere()
  geo.computeBoundingBox()
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
  },
  worldWidth?: number,
  worldDepth?: number,
  pathMask?: Uint8Array | null,
): GrassChunkInstances {
  const wW = worldWidth ?? worldSize
  const wD = worldDepth ?? worldSize
  const { seed, maxDensity, minScale, maxScale, colorStops } = config
  const chunkSizeX = wW / numChunks
  const chunkSizeZ = wD / numChunks
  const cx0 = (chunkX / numChunks - 0.5) * wW
  const cz0 = (chunkZ / numChunks - 0.5) * wD

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
    const wx        = cx0 + rng() * chunkSizeX
    const wz        = cz0 + rng() * chunkSizeZ
    const acceptR   = rng()
    const tilt      = (rng() - 0.5) * 0.5
    const yRot      = rng() * Math.PI * 2
    const scaleR    = rng()
    const colorR    = rng()

    const dens = sampleBilinear(densityMap, wx, wz, gridW, gridH, wW, wD)
    if (acceptR >= dens) continue
    if (pathMask && samplePathCoverage(pathMask, wx, wz, wW, wD) > PATH_GRASS_CUTOFF) continue

    const wy = sampleBilinear(heights, wx, wz, gridW, gridH, wW, wD)
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

// ── Paths (trails & roads) ─────────────────────────────────────────────────
// Paths are a PATH_RES×PATH_RES two-channel coverage mask (R = trail,
// G = road, 0–255) stretched over the whole terrain and drawn into the
// terrain material. Row index follows world Z, column follows world X —
// the same orientation as the terrain UVs. Stored raw in path_mask.bin.

export const PATH_RES = 256
export type MapPathType = 'trail' | 'road'
export const PATH_TYPES: MapPathType[] = ['trail', 'road']
/** Coverage above which grass blades are not grown. */
export const PATH_GRASS_CUTOFF = 0.35

export interface MapPathStyle {
  color:       string   // hex, used when no texture (or it failed to load)
  textureSet?: string   // optional KTX2 set name
  raggedness:  number   // 0 = clean edges (paved), 1 = very rough (dirt)
}

export const DEFAULT_PATH_STYLES: Record<MapPathType, MapPathStyle> = {
  trail: { color: '#8b6b47', raggedness: 0.7 },
  road:  { color: '#77746f', raggedness: 0.12 },
}

/** Parse path_mask.bin. Returns null when the size doesn't match. */
export function parsePathMask(buf: ArrayBuffer, res: number): Uint8Array<ArrayBuffer> | null {
  if (buf.byteLength !== res * res * 2) return null
  return new Uint8Array(buf.slice(0))
}

/**
 * Path coverage (0–1, the larger of trail/road) at terrain-local x/z.
 * Nearest-texel lookup; cheap enough for per-blade grass culling.
 */
export function samplePathCoverage(
  mask: Uint8Array, wx: number, wz: number, worldWidth: number, worldDepth: number,
): number {
  const res = Math.round(Math.sqrt(mask.length / 2))
  const col = Math.floor((wx / worldWidth + 0.5) * res)
  const row = Math.floor((wz / worldDepth + 0.5) * res)
  if (col < 0 || row < 0 || col >= res || row >= res) return 0
  const k = (row * res + col) * 2
  return Math.max(mask[k], mask[k + 1]) / 255
}

/** Wrap a path mask in a GPU texture. Set .needsUpdate after editing the array. */
export function createPathMaskTexture(mask: Uint8Array): THREE.DataTexture {
  const res = Math.round(Math.sqrt(mask.length / 2))
  const tex = new THREE.DataTexture(mask, res, res, THREE.RGFormat, THREE.UnsignedByteType)
  tex.magFilter = THREE.LinearFilter
  tex.minFilter = THREE.LinearFilter
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping
  tex.needsUpdate = true
  return tex
}

export function makePathInitUniforms(): Record<string, { value: any }> {
  return {
    uPathMask    : { value: null },
    uPathScale   : { value: 3.0 },
    uPathCol0    : { value: new THREE.Color(DEFAULT_PATH_STYLES.trail.color).convertSRGBToLinear() },
    uPathCol1    : { value: new THREE.Color(DEFAULT_PATH_STYLES.road.color).convertSRGBToLinear() },
    uPathRough0  : { value: DEFAULT_PATH_STYLES.trail.raggedness },
    uPathRough1  : { value: DEFAULT_PATH_STYLES.road.raggedness },
    uPathTex0    : { value: null },
    uPathTex1    : { value: null },
    uPathUseTex0 : { value: 0 },
    uPathUseTex1 : { value: 0 },
  }
}

/**
 * Write path style colours/raggedness into uniforms. Textures are passed
 * separately (null = use the colour) since loading differs per caller.
 */
export function setPathStyleUniforms(
  u: Record<string, { value: any }>,
  styles: Record<MapPathType, MapPathStyle>,
  textures: Partial<Record<MapPathType, THREE.Texture | null>> = {},
): void {
  PATH_TYPES.forEach((type, i) => {
    const style = styles[type] ?? DEFAULT_PATH_STYLES[type]
    u[`uPathCol${i}`].value = new THREE.Color(style.color).convertSRGBToLinear()
    u[`uPathRough${i}`].value = style.raggedness
    const tex = textures[type] ?? null
    u[`uPathTex${i}`].value = tex
    u[`uPathUseTex${i}`].value = tex ? 1 : 0
  })
}

const PATH_FRAG_DECLS = /* glsl */`
varying vec2 vPathUv;
uniform sampler2D uPathMask, uPathTex0, uPathTex1;
uniform float uPathScale, uPathRough0, uPathRough1, uPathUseTex0, uPathUseTex1;
uniform vec3  uPathCol0, uPathCol1;
float pathHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float pathNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(pathHash(i), pathHash(i + vec2(1.0, 0.0)), f.x),
             mix(pathHash(i + vec2(0.0, 1.0)), pathHash(i + vec2(1.0, 1.0)), f.x), f.y);
}`

// Runs after the base colour (vertex colours or splat) is resolved. The mask
// is thresholded at 0.5 with a noise offset so edges wander instead of
// following the brush circle; raggedness scales that offset.
const PATH_FRAG_CODE = /* glsl */`
{
  vec2 pm = texture2D(uPathMask, vPathUv).rg;
  if (max(pm.r, pm.g) > 0.004) {
    vec2 pw  = vTerrainWorld.xz;
    float pn = pathNoise(pw * 1.7) * 0.65 + pathNoise(pw * 6.3) * 0.35 - 0.5;
    float grain = 0.88 + 0.24 * pathNoise(pw * 11.0);
    vec2 puv = pw / uPathScale;
    float aT = smoothstep(0.44, 0.56, pm.r + pn * uPathRough0 * 1.6);
    float aR = smoothstep(0.44, 0.56, pm.g + pn * uPathRough1 * 1.6);
    vec3 cT = uPathUseTex0 > 0.5 ? texture2D(uPathTex0, puv).rgb : uPathCol0 * grain;
    vec3 cR = uPathUseTex1 > 0.5 ? texture2D(uPathTex1, puv).rgb : uPathCol1 * grain;
    diffuseColor.rgb = mix(diffuseColor.rgb, cT, aT);
    diffuseColor.rgb = mix(diffuseColor.rgb, cR, aR);
  }
}`

/**
 * Inject the terrain shader into a MeshStandardMaterial's onBeforeCompile.
 * steepN = null keeps the plain vertex-colour base (no splat); withPaths
 * adds the trail/road overlay. `uniforms` must hold the matching splat
 * and/or path uniforms.
 */
export function patchTerrainShader(
  shader: { uniforms: Record<string, { value: any }>; vertexShader: string; fragmentShader: string },
  uniforms: Record<string, { value: any }>,
  steepN: number | null,
  withPaths: boolean,
): void {
  Object.assign(shader.uniforms, uniforms)
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>',
      `#include <common>\n${buildSplatVertDecls()}${withPaths ? '\nvarying vec2 vPathUv;' : ''}`)
    .replace('#include <begin_vertex>',
      `#include <begin_vertex>
vTerrainWorld = (modelMatrix * vec4(position, 1.0)).xyz;
vTerrainNormal = normalize(mat3(modelMatrix) * normal);${withPaths ? '\nvPathUv = uv;' : ''}`)

  const decls = steepN !== null ? buildSplatFragDecls(steepN) : buildSplatVertDecls()
  const base  = steepN !== null ? buildSplatFragCode(steepN) : '#include <color_fragment>'
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>',
      `#include <common>\n${decls}${withPaths ? PATH_FRAG_DECLS : ''}`)
    .replace('#include <color_fragment>', `${base}${withPaths ? PATH_FRAG_CODE : ''}`)
}

export interface MapPathInfo {
  mask: Uint8Array
  worldWidth: number
  worldDepth: number
  centerX: number
  centerZ: number
}

/** Which path (if any) covers world-space x/z. */
export function sampleMapPath(p: MapPathInfo, x: number, z: number): MapPathType | null {
  const res = Math.round(Math.sqrt(p.mask.length / 2))
  const col = Math.floor(((x - p.centerX) / p.worldWidth + 0.5) * res)
  const row = Math.floor(((z - p.centerZ) / p.worldDepth + 0.5) * res)
  if (col < 0 || row < 0 || col >= res || row >= res) return null
  const k = (row * res + col) * 2
  const trail = p.mask[k], road = p.mask[k + 1]
  if (road >= 128 && road >= trail) return 'road'
  if (trail >= 128) return 'trail'
  return null
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

// ── Water ──────────────────────────────────────────────────────────────────
// Water is stored as a (gridW-1)×(gridH-1) per-cell depth grid (raw
// little-endian Float32, row-major, no header) in water_mask.bin. A cell is
// wet when its depth >= WATER_EPSILON; its surface sits at the cell's average
// terrain height + depth.

export const WATER_EPSILON = 0.0005

/** Average terrain height of each (gridW-1)×(gridH-1) cell. */
export function computeCellHeights(heights: Float32Array, gridW: number, gridH: number): Float32Array {
  const RX = gridW - 1, RZ = gridH - 1
  const cellH = new Float32Array(RX * RZ)
  for (let i = 0; i < RZ; i++) {
    for (let j = 0; j < RX; j++) {
      cellH[i * RX + j] = (
        heights[i * gridW + j] + heights[i * gridW + j + 1] +
        heights[(i + 1) * gridW + j] + heights[(i + 1) * gridW + j + 1]
      ) * 0.25
    }
  }
  return cellH
}

/**
 * Parse water_mask.bin into per-cell depths. Accepts the Float32 format and
 * the legacy one-byte-per-cell format. Returns null if the size doesn't match.
 */
export function parseWaterMask(buf: ArrayBuffer, resX: number, resZ: number): Float32Array<ArrayBuffer> | null {
  const n = resX * resZ
  if (buf.byteLength === n * 4) return new Float32Array(buf.slice(0))
  if (buf.byteLength === n) {
    const u8  = new Uint8Array(buf)
    const out = new Float32Array(n)
    for (let k = 0; k < n; k++) out[k] = u8[k] ? 0.5 : 0
    return out
  }
  return null
}

/**
 * Build a water surface geometry from per-cell water depths + terrain heights.
 * Each wet cell becomes a flat quad at (cell avg terrain height + depth).
 * Coordinates are terrain-local (centred on the origin).
 */
export function buildWaterGeometry(
  volume: Float32Array,
  heights: Float32Array,
  gridW: number,
  gridH: number,
  worldWidth: number,
  worldDepth: number,
): THREE.BufferGeometry {
  const RX = gridW - 1, RZ = gridH - 1
  const cellH = computeCellHeights(heights, gridW, gridH)

  const positions: number[] = []
  const normals:   number[] = []
  const indices:   number[] = []

  for (let i = 0; i < RZ; i++) {
    for (let j = 0; j < RX; j++) {
      const idx = i * RX + j
      if (!(volume[idx] >= WATER_EPSILON)) continue
      const level = cellH[idx] + volume[idx]

      const x0 = (j / RX - 0.5) * worldWidth
      const x1 = ((j + 1) / RX - 0.5) * worldWidth
      const z0 = (i / RZ - 0.5) * worldDepth
      const z1 = ((i + 1) / RZ - 0.5) * worldDepth

      const base = positions.length / 3
      positions.push(
        x0, level, z0,   x1, level, z0,
        x0, level, z1,   x1, level, z1,
      )
      normals.push(0,1,0, 0,1,0, 0,1,0, 0,1,0)
      indices.push(base, base+2, base+1,  base+1, base+2, base+3)
    }
  }

  const geo = new THREE.BufferGeometry()
  if (positions.length === 0) return geo
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3))
  geo.setAttribute('normal',   new THREE.BufferAttribute(new Float32Array(normals),   3))
  geo.setIndex(indices)
  geo.computeBoundingSphere()
  return geo
}

const WATER_VERT = /* glsl */`
#include <fog_pars_vertex>
uniform float uTime;
varying vec3  vWorld;

void main() {
  vWorld = position;
  vec3 pos = position;
  float wave = sin(pos.x * 1.8 + uTime * 1.4) * 0.03
             + sin(pos.z * 2.2 + uTime * 1.0) * 0.02
             + sin((pos.x + pos.z) * 1.2 - uTime * 0.8) * 0.01;
  pos.y += wave;
  vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`

const WATER_FRAG = /* glsl */`
uniform vec3  uShallowColor;
uniform vec3  uDeepColor;
uniform float uOpacity;
uniform float uTime;
varying vec3  vWorld;
#include <fog_pars_fragment>

void main() {
  // World-space UV for repeating pattern independent of polygon size
  vec2 wuv = vWorld.xz * 0.4;

  // Procedural animated normal for Fresnel
  float nx = sin(wuv.x * 2.5 + uTime * 1.1) * 0.35;
  float nz = cos(wuv.y * 2.0 + uTime * 0.85) * 0.35;
  vec3 N = normalize(vec3(nx, 1.0, nz));
  float fresnel = pow(1.0 - abs(N.y), 2.5);

  vec3 color = mix(uShallowColor, uDeepColor, 0.5);
  color = mix(color, vec3(0.88, 0.95, 1.0), fresnel * 0.35);

  float shimmer = max(0.0, sin(wuv.x * 6.0 + uTime * 3.5) * sin(wuv.y * 5.0 - uTime * 2.5));
  color += shimmer * 0.07;

  gl_FragColor = vec4(color, uOpacity);
  #include <fog_fragment>
}
`

/**
 * Animated water material. Advance `material.uniforms.uTime.value` (seconds)
 * each frame to animate it — MapLoader's water mesh does this automatically.
 */
export function createWaterMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader:   WATER_VERT,
    fragmentShader: WATER_FRAG,
    fog: true,
    uniforms: {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      uTime:         { value: 0 },
      uShallowColor: { value: new THREE.Color('#7ec8e3') },
      uDeepColor:    { value: new THREE.Color('#1a5b8e') },
      uOpacity:      { value: 0.78 },
    },
    transparent: true,
    depthWrite:  false,
    side:        THREE.DoubleSide,
  })
}

/**
 * Sample the water surface at a terrain-local (x, z). Returns the surface Y,
 * or null when that point is dry. Useful for swimming / splash checks.
 * Pass `seaLevel` to also count the ocean: points off the terrain, or where
 * the ground is below sea level, are wet up to the sea level.
 */
export function sampleWaterLevel(
  volume: Float32Array | null,
  heights: Float32Array,
  gridW: number,
  gridH: number,
  worldWidth: number,
  worldDepth: number,
  x: number,
  z: number,
  seaLevel: number | null = null,
): number | null {
  const RX = gridW - 1, RZ = gridH - 1
  const j = Math.floor((x / worldWidth + 0.5) * RX)
  const i = Math.floor((z / worldDepth + 0.5) * RZ)
  if (i < 0 || i >= RZ || j < 0 || j >= RX) return seaLevel
  const cellH = (
    heights[i * gridW + j] + heights[i * gridW + j + 1] +
    heights[(i + 1) * gridW + j] + heights[(i + 1) * gridW + j + 1]
  ) * 0.25
  const depth = volume ? volume[i * RX + j] : 0
  const painted = depth >= WATER_EPSILON ? cellH + depth : null
  const sea     = seaLevel !== null && cellH < seaLevel ? seaLevel : null
  if (painted === null) return sea
  if (sea === null) return painted
  return Math.max(painted, sea)
}

/** Water data MapLoader stores in group.userData.water. */
export interface MapWaterInfo {
  volume:     Float32Array | null  // painted water depths, null when none
  heights:    Float32Array
  gridW:      number
  gridH:      number
  worldWidth: number
  worldDepth: number
  shape:      'rectangle' | 'circle'
  centerX:    number
  centerZ:    number
  seaLevel:   number | null
}

/**
 * Sample the water surface at a world-space (x, z) using the info MapLoader
 * stores in group.userData.water. Off a circular terrain counts as open sea.
 * Returns the surface Y, or null when that point is dry.
 */
export function sampleMapWaterLevel(w: MapWaterInfo, x: number, z: number): number | null {
  const lx = x - w.centerX, lz = z - w.centerZ
  if (!isOnTerrain(lx, lz, w.worldWidth, w.worldDepth, w.shape)) return w.seaLevel
  return sampleWaterLevel(w.volume, w.heights, w.gridW, w.gridH, w.worldWidth, w.worldDepth, lx, lz, w.seaLevel)
}

// ── Sea ────────────────────────────────────────────────────────────────────
// An optional ocean: one flat water plane at the sea level that reaches far
// past the terrain, plus an opaque seabed underneath so the open sea doesn't
// show the empty void below the map. The seabed sits just under the lowest
// terrain point and starts in the terrain's lowest colour, so a coast that
// drops to the floor blends in, then fades to deep blue away from the map.

/** How far the sea reaches, as a multiple of the terrain's larger side. */
export const SEA_EXTENT = 12

/** Flat, subdivided sea plane centred on the terrain (terrain-local). */
export function buildSeaGeometry(worldWidth: number, worldDepth: number, seaLevel: number): THREE.BufferGeometry {
  const size = Math.max(worldWidth, worldDepth) * SEA_EXTENT
  const geo  = new THREE.PlaneGeometry(size, size, 128, 128)
  geo.rotateX(-Math.PI / 2)
  geo.translate(0, seaLevel, 0)
  return geo
}

/** Height of the seabed: just below the lowest terrain point, and at least 1 below the sea. */
export function computeSeabedLevel(heights: Float32Array, seaLevel: number): number {
  let min = seaLevel - 1
  for (let k = 0; k < heights.length; k++) if (heights[k] < min) min = heights[k]
  return min - 0.02
}

const SEABED_DEEP_COLOR = new THREE.Color('#0f2a3d')

/** Lowest-height terrain colour stop, used as the seabed's shore colour. */
export function lowestStopColor(stops: MapTerrainColorStop[]): string {
  let best: MapTerrainColorStop | null = null
  for (const s of stops) if (!best || s.minHeight < best.minHeight) best = s
  return best?.color ?? '#d8c48a'
}

export function buildSeabedGeometry(
  worldWidth: number, worldDepth: number, level: number,
  shoreColor: THREE.ColorRepresentation,
  shape: 'rectangle' | 'circle' = 'rectangle',
): THREE.BufferGeometry {
  const size = Math.max(worldWidth, worldDepth) * SEA_EXTENT
  const geo  = new THREE.PlaneGeometry(size, size, 96, 96)
  geo.rotateX(-Math.PI / 2)
  geo.translate(0, level, 0)

  // Distance from the terrain outline in terrain half-extents (1 = the edge)
  const shore = new THREE.Color(shoreColor)
  const pos   = geo.attributes.position
  const cols  = new Float32Array(pos.count * 3)
  const c     = new THREE.Color()
  for (let k = 0; k < pos.count; k++) {
    const nx = Math.abs(pos.getX(k)) / (worldWidth / 2)
    const nz = Math.abs(pos.getZ(k)) / (worldDepth / 2)
    const e  = shape === 'circle' ? Math.sqrt(nx * nx + nz * nz) : Math.max(nx, nz)
    const u  = Math.max(0, Math.min(1, (e - 1) / 2))
    c.copy(shore).lerp(SEABED_DEEP_COLOR, u * u * (3 - 2 * u))
    cols[k * 3] = c.r; cols[k * 3 + 1] = c.g; cols[k * 3 + 2] = c.b
  }
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3))
  return geo
}

export function createSeabedMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 })
}

// ── Scatter (rocks / bushes / flowers) ─────────────────────────────────────

export const SCATTER_TYPES: MapScatterType[] = ['rocks', 'bushes', 'flowers']

export const SCATTER_GEOMETRIES: Record<MapScatterType, THREE.BufferGeometry> = {
  rocks:   new THREE.IcosahedronGeometry(0.5, 0),
  bushes:  new THREE.IcosahedronGeometry(0.45, 1),
  flowers: new THREE.SphereGeometry(0.3, 8, 5),
}

/** True when a terrain-local (x, z) point lies on the terrain surface. */
export function isOnTerrain(
  x: number, z: number, worldWidth: number, worldDepth: number, shape: 'rectangle' | 'circle' = 'rectangle',
): boolean {
  const nx = x / (worldWidth / 2)
  const nz = z / (worldDepth / 2)
  if (shape === 'circle') return nx * nx + nz * nz <= 1
  return Math.abs(nx) <= 1 && Math.abs(nz) <= 1
}

/**
 * Write instance matrices + colours for scatter objects into an InstancedMesh,
 * snapping each instance's Y to the current terrain height.
 */
export function updateScatterInstancedMesh(
  mesh: THREE.InstancedMesh,
  instances: MapScatterInstance[],
  heights: Float32Array,
  gridW: number,
  gridH: number,
  worldWidth: number,
  worldDepth: number,
): void {
  const mat  = new THREE.Matrix4()
  const quat = new THREE.Quaternion()
  const euler = new THREE.Euler()
  const pos  = new THREE.Vector3()
  const sca  = new THREE.Vector3()
  const col  = new THREE.Color()
  for (let i = 0; i < instances.length; i++) {
    const inst = instances[i]
    const x = inst.position[0], z = inst.position[2]
    pos.set(x, sampleBilinear(heights, x, z, gridW, gridH, worldWidth, worldDepth), z)
    quat.setFromEuler(euler.set(0, inst.rotationY, 0))
    sca.set(inst.scale[0], inst.scale[1], inst.scale[2])
    mat.compose(pos, quat, sca)
    mesh.setMatrixAt(i, mat)
    mesh.setColorAt(i, col.set(inst.color))
  }
  mesh.count = instances.length
  mesh.instanceMatrix.needsUpdate = true
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
}

function buildScatterGroup(
  scatter: NonNullable<MapManifest['scatter']>,
  heights: Float32Array,
  gridW: number,
  gridH: number,
  worldWidth: number,
  worldDepth: number,
  shape: 'rectangle' | 'circle',
): THREE.Group {
  const group = new THREE.Group()
  group.name  = 'scatter'
  for (const type of SCATTER_TYPES) {
    const list = scatter.instances.filter((s) =>
      s.type === type && isOnTerrain(s.position[0], s.position[2], worldWidth, worldDepth, shape))
    if (list.length === 0) continue
    const mat  = new THREE.MeshStandardMaterial({ flatShading: type === 'rocks' })
    const mesh = new THREE.InstancedMesh(SCATTER_GEOMETRIES[type], mat, list.length)
    mesh.name  = type
    const props = scatter.assetProps?.[type]
    mesh.castShadow    = props?.castShadows ?? true
    mesh.receiveShadow = props?.receiveShadows ?? true
    updateScatterInstancedMesh(mesh, list, heights, gridW, gridH, worldWidth, worldDepth)
    group.add(mesh)
  }
  return group
}

// ── Grass group builder (used internally by MapLoader.load) ────────────────

async function buildGrassGroup(
  heights: Float32Array,
  densityMap: Float32Array,
  gridW: number,
  gridH: number,
  worldSize: number,
  grassConfig: MapManifest['grass'],
  textureMap: Map<string, THREE.Texture> | null,
  worldWidth?: number,
  worldDepth?: number,
  pathMask?: Uint8Array | null,
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
        },
        worldWidth, worldDepth, pathMask,
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

    // Load KTX2 textures when renderer is provided and textures are bundled
    let textureMap: Map<string, THREE.Texture> | null = null
    if (renderer && manifest.textures && manifest.textures.length > 0) {
      textureMap = await this.loadKtx2Textures(zip, manifest.textures, renderer, transcoderPath)
    }

    const worldWidth = manifest.terrain.worldWidth ?? manifest.terrain.worldSize
    const worldDepth = manifest.terrain.worldDepth ?? manifest.terrain.worldSize
    const shape      = manifest.terrain.shape ?? 'rectangle'

    // Terrain, grass and scatter are laid out in terrain-local space and
    // offset together by the terrain centre; placed objects are world-space.
    const terrainRoot = new THREE.Group()
    terrainRoot.position.set(manifest.terrain.centerX ?? 0, 0, manifest.terrain.centerZ ?? 0)
    root.add(terrainRoot)

    // Paths (trails / roads) — drawn by the terrain material, keep grass off them
    let pathMask: Uint8Array | null = null
    if (manifest.paths?.maskFile) {
      const buf = await zip.file(manifest.paths.maskFile)?.async('arraybuffer')
      pathMask  = buf ? parsePathMask(buf, manifest.paths.resolution ?? PATH_RES) : null
      if (buf && !pathMask) console.warn(`[MapLoader] ${manifest.paths.maskFile} has unexpected size; paths skipped`)
    }

    // Terrain
    const terrainGeo  = buildTerrainGeometry(
      heights, gW, gH, manifest.terrain.worldSize,
      manifest.terrain.colorStops,
      manifest.terrain.colorBlendWidth,
      manifest.terrain.steepnessStops,
      worldWidth, worldDepth,
    )
    const terrainMat  = this.buildTerrainMaterial(manifest, textureMap, pathMask)
    const terrainMesh = new THREE.Mesh(terrainGeo, terrainMat)
    terrainMesh.name  = 'terrain'
    terrainRoot.add(terrainMesh)

    // Grass
    terrainRoot.add(await buildGrassGroup(
      heights, densityMap, gW, gH, manifest.terrain.worldSize, manifest.grass, textureMap,
      worldWidth, worldDepth, pathMask,
    ))

    // Scatter
    if (manifest.scatter && manifest.scatter.instances.length > 0) {
      terrainRoot.add(buildScatterGroup(manifest.scatter, heights, gW, gH, worldWidth, worldDepth, shape))
    }

    // Water
    let waterVolume: Float32Array | null = null
    if (manifest.water?.maskFile) {
      const buf    = await zip.file(manifest.water.maskFile)?.async('arraybuffer')
      const volume = buf ? parseWaterMask(buf, gW - 1, gH - 1) : null
      if (volume && volume.some((v) => v >= WATER_EPSILON)) {
        waterVolume = volume
        const waterMat  = createWaterMaterial()
        const waterMesh = new THREE.Mesh(
          buildWaterGeometry(volume, heights, gW, gH, worldWidth, worldDepth),
          waterMat,
        )
        waterMesh.name        = 'water'
        waterMesh.renderOrder = 1
        waterMesh.onBeforeRender = () => { waterMat.uniforms.uTime.value = performance.now() / 1000 }
        terrainRoot.add(waterMesh)
      } else if (buf && !volume) {
        console.warn(`[MapLoader] ${manifest.water.maskFile} has unexpected size; water skipped`)
      }
    }

    // Sea
    const seaLevel = typeof manifest.water?.seaLevel === 'number' ? manifest.water.seaLevel : null
    if (seaLevel !== null) {
      const seaMat  = createWaterMaterial()
      const seaMesh = new THREE.Mesh(buildSeaGeometry(worldWidth, worldDepth, seaLevel), seaMat)
      seaMesh.name        = 'sea'
      seaMesh.renderOrder = 1
      seaMesh.onBeforeRender = () => { seaMat.uniforms.uTime.value = performance.now() / 1000 }
      terrainRoot.add(seaMesh)

      const seabed = new THREE.Mesh(
        buildSeabedGeometry(
          worldWidth, worldDepth, computeSeabedLevel(heights, seaLevel),
          lowestStopColor(manifest.terrain.colorStops), shape,
        ),
        createSeabedMaterial(),
      )
      seabed.name = 'seabed'
      seabed.receiveShadow = true
      terrainRoot.add(seabed)
    }

    if (waterVolume || seaLevel !== null) {
      const water: MapWaterInfo = {
        volume: waterVolume, heights, gridW: gW, gridH: gH, worldWidth, worldDepth, shape,
        centerX: terrainRoot.position.x, centerZ: terrainRoot.position.z, seaLevel,
      }
      root.userData.water = water
    }

    if (pathMask) {
      const paths: MapPathInfo = {
        mask: pathMask, worldWidth, worldDepth,
        centerX: terrainRoot.position.x, centerZ: terrainRoot.position.z,
      }
      root.userData.paths = paths
    }

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
        inst.userData.mapObject = { id: obj.id, name: obj.name, modelFile: obj.modelFile }
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
    loader.dispose() // frees the transcoder workers (only one KTX2Loader should be active)
    return map
  }

  // Build a terrain material: splat shader when textures are available, vertex
  // colours otherwise; either way with the trail/road overlay when painted.
  private buildTerrainMaterial(
    manifest: MapManifest,
    textureMap: Map<string, THREE.Texture> | null,
    pathMask: Uint8Array | null = null,
  ): THREE.MeshStandardMaterial {
    const colorStops    = manifest.terrain.colorStops
    const steepnessStops = manifest.terrain.steepnessStops ?? []

    const sorted     = [...colorStops].sort((a, b) => a.minHeight - b.minHeight)
    const sortedSteep = [...steepnessStops].sort((a, b) => a.minSteepness - b.minSteepness)
      .slice(0, MAX_STEEPNESS_STOPS)

    const hasTextures = !!textureMap && textureMap.size > 0 &&
      (sorted.some((s) => s.textureSet) || sortedSteep.some((s) => s.textureSet))

    const pathU = pathMask ? makePathInitUniforms() : null
    if (pathU && pathMask) {
      const styles = manifest.paths?.styles ?? DEFAULT_PATH_STYLES
      pathU.uPathMask.value = createPathMaskTexture(pathMask)
      setPathStyleUniforms(pathU, styles, {
        trail: styles.trail?.textureSet ? textureMap?.get(styles.trail.textureSet) ?? null : null,
        road:  styles.road?.textureSet  ? textureMap?.get(styles.road.textureSet)  ?? null : null,
      })
    }

    if (!hasTextures) {
      const mat = new THREE.MeshStandardMaterial({ flatShading: true, vertexColors: true, side: THREE.DoubleSide })
      if (pathU) {
        mat.customProgramCacheKey = () => 'maploader-vc-paths'
        mat.onBeforeCompile = (shader) => patchTerrainShader(shader, pathU, null, true)
      }
      return mat
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
    mat.customProgramCacheKey = () => `maploader-splat-s${steepN}${pathU ? '-paths' : ''}`
    mat.onBeforeCompile = (shader) => patchTerrainShader(shader, { ...u, ...(pathU ?? {}) }, steepN, !!pathU)

    return mat
  }

  private async openZip(source: File | Blob | ArrayBuffer | string): Promise<JSZip> {
    if (typeof source === 'string') {
      const res = await fetch(source)
      if (!res.ok) throw new Error(`[MapLoader] ${source}: HTTP ${res.status}`)
      const buf = await res.arrayBuffer()
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

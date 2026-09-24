// fluffyCharacter.ts: runtime for characters exported from the Character Maker
//
// Street Quest additions (see glbCharacterModel.js for the game integration):
//   - play(url, { excludeBones }) leaves whole bone subtrees (e.g. the arms) to
//     the caller instead of the clip
//   - play(url, { fade }) crossfades from the current pose to the new clip
//   - update(dt) is split into animate(dt) + stepFluff(dt) so procedural bone
//     control (arm IK) can run after the clip and before the fur springs
//
// Loads a rigged GLB exported by the Character Maker (Mixamo-named skeleton,
// optional painted hair meshes `Hair_N`), plays Mixamo FBX animations on it by
// retargeting, and adds the same "fluffy" secondary motion, hair swing and
// shell fur as the editor's pose tester.
//
// Requires only `three` (tested with 0.185). Framework-agnostic: call
// `character.update(dt)` once per frame after adding `character.root` to your scene.
//
//   const character = await loadFluffyCharacter('/models/character.glb', { enabled: true, shells: 12 })
//   scene.add(character.root)
//   await character.play('/assets/animations/Old Man Walk.fbx', { inPlace: true })
//   // every frame:
//   character.update(delta)

import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js'

// ── Settings ──────────────────────────────────────────────────────────────

export interface FluffySettings {
  enabled: boolean
  softness: number        // 0 = stiff (barely lags) … 1 = very loose
  bounce: number          // 0 = settles smoothly … 1 = springy overshoot
  amount: number          // how strongly the outer volume follows the lagged skeleton
  flutter: number         // idle noise wobble
  fuzz: number            // rim sheen + darker roots shading
  shells: number          // shell-fur layers (0 = off, no extra draws)
  furLength: number       // shell-fur length in world units
  shellsHairOnly: boolean // shell fur on painted hair only, not the body
}

export const DEFAULT_FLUFFY: FluffySettings = {
  enabled: false, softness: 0.5, bounce: 0.4, amount: 0.8, flutter: 0.3, fuzz: 0.5,
  shells: 0, furLength: 0.06, shellsHairOnly: false,
}

export interface PlayOptions {
  speed?: number    // playback rate, default 1
  inPlace?: boolean // drop the clip's horizontal root motion (use for game locomotion)
  fade?: number     // seconds to crossfade from the current pose (default 0 = snap)
  excludeBones?: string[] // bone names (any Mixamo prefix) the clip must not drive; their children are excluded too
}

// ── Mixamo animation sources ──────────────────────────────────────────────

// Mixamo names bones `mixamorig:Hips`; the loaders sanitise that to
// `mixamorigHips`, and some exports use `mixamorig1:` etc. Compare bare names.
export function boneKey(name: string) {
  return name.replace(/^mixamorig\d*[:_]?/i, '').toLowerCase()
}

interface AnimationTemplate {
  root: THREE.Group
  clip: THREE.AnimationClip
  restWorldQuats: Map<string, THREE.Quaternion>
  restWorldPositions: Map<string, THREE.Vector3>
  hipsHeight: number // rest hips height above the lowest joint
}

interface AnimationSource extends AnimationTemplate {
  bones: Map<string, THREE.Bone> // this character's private copy, by boneKey
}

const animationCache = new Map<string, Promise<AnimationTemplate>>()

function loadAnimationTemplate(url: string): Promise<AnimationTemplate> {
  let p = animationCache.get(url)
  if (!p) {
    p = new FBXLoader().loadAsync(url).then((root) => {
      const clip = root.animations[0]
      if (!clip) throw new Error(`${url} contains no animation`)
      // The loaded hierarchy sits in the clip's rest (T-)pose until a mixer drives it
      root.updateMatrixWorld(true)
      const restWorldQuats = new Map<string, THREE.Quaternion>()
      const restWorldPositions = new Map<string, THREE.Vector3>()
      root.traverse((o) => {
        if (!(o as THREE.Bone).isBone) return
        const key = boneKey(o.name)
        restWorldQuats.set(key, o.getWorldQuaternion(new THREE.Quaternion()))
        restWorldPositions.set(key, o.getWorldPosition(new THREE.Vector3()))
      })
      const minY = Math.min(...Array.from(restWorldPositions.values(), v => v.y))
      const hipsY = restWorldPositions.get('hips')?.y ?? minY
      return { root, clip, restWorldQuats, restWorldPositions, hipsHeight: hipsY - minY }
    })
    p.catch(() => animationCache.delete(url))
    animationCache.set(url, p)
  }
  return p
}

// Each character gets its own copy of the FBX hierarchy so several characters
// can play the same clip independently.
async function loadAnimation(url: string): Promise<AnimationSource> {
  const tpl = await loadAnimationTemplate(url)
  const root = cloneSkinned(tpl.root) as THREE.Group
  const bones = new Map<string, THREE.Bone>()
  root.traverse((o) => { if ((o as THREE.Bone).isBone) bones.set(boneKey(o.name), o as THREE.Bone) })
  return { ...tpl, root, bones }
}

// ── Rig (bones of the loaded GLB) ─────────────────────────────────────────

interface Rig {
  bones: THREE.Bone[]      // parents before children
  rigSpace: THREE.Object3D // parent of the top bone (the exported `Armature` node)
  restQuats: Map<THREE.Bone, THREE.Quaternion>
  restPositions: Map<THREE.Bone, THREE.Vector3>
}

function readRig(root: THREE.Object3D): Rig {
  const bones: THREE.Bone[] = []
  root.traverse((o) => { if ((o as THREE.Bone).isBone) bones.push(o as THREE.Bone) })
  if (bones.length === 0) throw new Error('The GLB has no skeleton')
  const restQuats = new Map(bones.map(b => [b, b.quaternion.clone()]))
  const restPositions = new Map(bones.map(b => [b, b.position.clone()]))
  return { bones, rigSpace: bones[0].parent ?? root, restQuats, restPositions }
}

function isBone(o: THREE.Object3D | null): o is THREE.Bone {
  return !!o && (o as THREE.Bone).isBone
}

// Bone transforms relative to rigSpace (so the character can be moved,
// rotated and scaled freely in the world)
function rigSpaceMatrices(rig: Rig) {
  const out = new Map<THREE.Bone, THREE.Matrix4>()
  for (const b of rig.bones) {
    // Compose instead of b.updateMatrix(): bones driven by the caller keep their matrix
    const local = new THREE.Matrix4().compose(b.position, b.quaternion, b.scale)
    const parent = isBone(b.parent) ? out.get(b.parent) : undefined
    out.set(b, parent ? parent.clone().multiply(local) : local)
  }
  return out
}

// ── Retargeting ───────────────────────────────────────────────────────────
// Retargets by rotation deltas: each frame, the source bone's rotation away
// from its rest pose is applied to the matching rig bone's rest pose. Both
// skeletons rest in a T-pose facing +Z, so the deltas transfer directly; any
// per-bone direction mismatch (e.g. a hand-placed joint) is corrected at rest
// so the rig bone follows the source bone's direction.

function createRetargeter(rig: Rig, source: AnimationSource, excluded: Set<THREE.Bone> = new Set()) {
  rig.bones.forEach((b) => { b.quaternion.copy(rig.restQuats.get(b)!); b.position.copy(rig.restPositions.get(b)!) })
  const restMats = rigSpaceMatrices(rig)
  const restPos = new Map<THREE.Bone, THREE.Vector3>()
  const restQuat = new Map<THREE.Bone, THREE.Quaternion>()
  restMats.forEach((m, b) => {
    const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3()
    m.decompose(p, q, s)
    restPos.set(b, p); restQuat.set(b, q)
  })

  interface Target { bone: THREE.Bone; srcKey: string | null; base: THREE.Quaternion }
  const targets: Target[] = rig.bones.filter(b => !excluded.has(b)).map((bone) => {
    const key = boneKey(bone.name)
    if (!source.bones.has(key)) return { bone, srcKey: null, base: rig.restQuats.get(bone)!.clone() }
    const base = restQuat.get(bone)!.clone()
    const child = bone.children.find(c => isBone(c) && source.bones.has(boneKey(c.name))) as THREE.Bone | undefined
    if (child) {
      const tDir = restPos.get(child)!.clone().sub(restPos.get(bone)!)
      const sDir = source.restWorldPositions.get(boneKey(child.name))!.clone()
        .sub(source.restWorldPositions.get(key)!)
      if (tDir.lengthSq() > 1e-10 && sDir.lengthSq() > 1e-10) {
        base.premultiply(new THREE.Quaternion().setFromUnitVectors(tDir.normalize(), sDir.normalize()))
      }
    }
    // Pre-multiply by the source's inverse rest rotation: rigRot = srcWorld(t) * base
    base.premultiply(source.restWorldQuats.get(key)!.clone().invert())
    return { bone, srcKey: key, base }
  })

  const minY = Math.min(...Array.from(restPos.values(), v => v.y))
  const hips = targets.find(t => t.srcKey === 'hips')?.bone
  const hipsScale = hips && source.hipsHeight > 1e-6 ? (restPos.get(hips)!.y - minY) / source.hipsHeight : 1
  const srcHips = source.bones.get('hips')

  const rigQuats = new Map<THREE.Bone, THREE.Quaternion>()
  const srcQ = new THREE.Quaternion(), tmpQ = new THREE.Quaternion(), identity = new THREE.Quaternion()
  const srcPos = new THREE.Vector3(), pos = new THREE.Vector3()

  return (inPlace: boolean) => {
    source.root.updateMatrixWorld(true)
    for (const t of targets) {
      const parentRot = (isBone(t.bone.parent) && rigQuats.get(t.bone.parent)) || identity
      let rot = rigQuats.get(t.bone)
      if (!rot) { rot = new THREE.Quaternion(); rigQuats.set(t.bone, rot) }
      if (t.srcKey) {
        source.bones.get(t.srcKey)!.getWorldQuaternion(srcQ)
        rot.multiplyQuaternions(srcQ, t.base)
        t.bone.quaternion.copy(tmpQ.copy(parentRot).invert().multiply(rot))
      } else {
        t.bone.quaternion.copy(t.base)
        rot.multiplyQuaternions(parentRot, t.base)
      }
    }
    // Root motion, scaled from the source's leg length to the rig's. Mixamo
    // clips stand on y = 0 around the origin, so map the hips relative to that.
    if (hips && srcHips) {
      srcHips.getWorldPosition(srcPos).multiplyScalar(hipsScale)
      if (inPlace) { srcPos.x = 0; srcPos.z = 0 }
      const rest = restPos.get(hips)!
      pos.set(rest.x + srcPos.x, minY + srcPos.y, rest.z + srcPos.z)
      if (hips.parent === rig.rigSpace) {
        hips.position.copy(pos)
      } else if (hips.parent) {
        rig.rigSpace.updateWorldMatrix(true, false)
        hips.parent.updateWorldMatrix(true, false)
        hips.position.copy(hips.parent.worldToLocal(rig.rigSpace.localToWorld(pos)))
      }
    }
  }
}

// ── Fluffy mode ───────────────────────────────────────────────────────────
// A second, "lagged" copy of the skeleton chases the animated one with damped
// springs. The vertex shader skins every vertex with both and blends toward the
// lagged result by how far the vertex sits from the bones (its `fluff`), so the
// outer volume trails, overshoots and settles while the core follows the bones
// exactly. Hair tips extrapolate past the lag so strands bend and swing. Shell
// fur redraws each mesh N times, pushed out along the normal and cut into
// strands in the fragment shader.

type FluffyUniforms = {
  lagBoneTexture: { value: THREE.DataTexture | null }
  fluffTime: { value: number }
  fluffAmount: { value: number }
  fluffFlutter: { value: number }
  fluffFuzz: { value: number }
  fluffFurLength: { value: number }
}

const FLUFF_NOISE_GLSL = /* glsl */`
float fluffHash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float fluffNoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(fluffHash(i), fluffHash(i + vec3(1, 0, 0)), f.x),
        mix(fluffHash(i + vec3(0, 1, 0)), fluffHash(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(fluffHash(i + vec3(0, 0, 1)), fluffHash(i + vec3(1, 0, 1)), f.x),
        mix(fluffHash(i + vec3(0, 1, 1)), fluffHash(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}
`

function distSqToSegment(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3, tmp: THREE.Vector3): number {
  const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z
  const lenSq = abx * abx + aby * aby + abz * abz
  let t = 0
  if (lenSq > 1e-12) {
    t = ((p.x - a.x) * abx + (p.y - a.y) * aby + (p.z - a.z) * abz) / lenSq
    t = Math.max(0, Math.min(1, t))
  }
  tmp.set(a.x + abx * t, a.y + aby * t, a.z + abz * t)
  return p.distanceToSquared(tmp)
}

// Per-vertex depth from the skeleton (bind pose), normalised so the outer ~10%
// of the body volume is fully fluffy. Hair vertices use the same scale, so
// strand roots match the surface they grow from and tips are fully fluffy.
function computeFluffAttribute(meshes: THREE.SkinnedMesh[]) {
  const segsFor = (mesh: THREE.SkinnedMesh) => {
    const bindInv = mesh.bindMatrix.clone().invert()
    const bones = mesh.skeleton.bones
    const heads = mesh.skeleton.boneInverses.map(inv =>
      new THREE.Vector3().setFromMatrixPosition(bindInv.clone().multiply(inv.clone().invert())))
    const segs: [THREE.Vector3, THREE.Vector3][] = []
    bones.forEach((b, i) => {
      const children = b.children.filter(isBone).map(c => bones.indexOf(c)).filter(ci => ci >= 0)
      if (children.length === 0) segs.push([heads[i], heads[i]])
      for (const ci of children) segs.push([heads[i], heads[ci]])
    })
    return segs
  }
  const p = new THREE.Vector3(), tmp = new THREE.Vector3()
  const dists = meshes.map((mesh) => {
    const segs = segsFor(mesh)
    const pos = mesh.geometry.attributes.position
    const out = new Float32Array(pos.count)
    for (let i = 0; i < pos.count; i++) {
      p.fromBufferAttribute(pos, i)
      let d = Infinity
      for (const [a, b] of segs) d = Math.min(d, distSqToSegment(p, a, b, tmp))
      out[i] = Math.sqrt(d)
    }
    return out
  })
  const body = dists.filter((_, i) => !meshes[i].userData.isHair)
  const all = new Float32Array(body.reduce((n, d) => n + d.length, 0))
  let o = 0
  for (const d of body) { all.set(d, o); o += d.length }
  all.sort()
  const ref = Math.max(1e-4, all[Math.floor((all.length - 1) * 0.9)] ?? 0)
  meshes.forEach((mesh, mi) => {
    const f = dists[mi].map(d => Math.min(1, d / ref) ** 1.5)
    mesh.geometry.setAttribute('fluff', new THREE.BufferAttribute(f, 1))
  })
}

// Clones `base` with the fluffy skinning (and, for lit materials, fuzz shading)
// patched into its shaders. With `shell` (0–1, base → tip) it becomes one layer
// of shell fur. With `hair`, strand tips swing past the lagged skeleton.
function makeFluffyMaterial(base: THREE.Material, uniforms: FluffyUniforms, shell?: number, hair = false): THREE.Material {
  const mat = base.clone()
  const m = mat as THREE.Material & Record<string, unknown>
  const lit = !!(m.isMeshStandardMaterial || m.isMeshPhongMaterial || m.isMeshLambertMaterial || m.isMeshToonMaterial)
  const isShell = shell !== undefined
  if (isShell) mat.defines = { ...mat.defines, FLUFF_SHELL: '' }
  if (hair) mat.defines = { ...mat.defines, FLUFF_HAIR: '' }
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms, { fluffShell: { value: shell ?? 0 } })
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
attribute float fluff;
#ifdef FLUFF_HAIR
attribute float hairTip;
#endif
varying float vFluff;
varying vec3 vFluffRest;
uniform highp sampler2D lagBoneTexture;
uniform float fluffTime;
uniform float fluffAmount;
uniform float fluffFlutter;
uniform float fluffFurLength;
uniform float fluffShell;
${FLUFF_NOISE_GLSL}
mat4 getLagBoneMatrix( const in float i ) {
  int size = textureSize( lagBoneTexture, 0 ).x;
  int j = int( i ) * 4;
  int x = j % size;
  int y = j / size;
  return mat4(
    texelFetch( lagBoneTexture, ivec2( x, y ), 0 ),
    texelFetch( lagBoneTexture, ivec2( x + 1, y ), 0 ),
    texelFetch( lagBoneTexture, ivec2( x + 2, y ), 0 ),
    texelFetch( lagBoneTexture, ivec2( x + 3, y ), 0 ) );
}`)
      .replace('#include <skinning_vertex>', `#include <skinning_vertex>
vFluff = fluff;
vFluffRest = position;
#ifdef USE_SKINNING
  vec4 lagSkinned = vec4( 0.0 );
  lagSkinned += getLagBoneMatrix( skinIndex.x ) * skinVertex * skinWeight.x;
  lagSkinned += getLagBoneMatrix( skinIndex.y ) * skinVertex * skinWeight.y;
  lagSkinned += getLagBoneMatrix( skinIndex.z ) * skinVertex * skinWeight.z;
  lagSkinned += getLagBoneMatrix( skinIndex.w ) * skinVertex * skinWeight.w;
  vec3 lagPos = ( bindMatrixInverse * lagSkinned ).xyz;
  // Rest position drives the noise so it sticks to the surface
  float lagVar = 0.6 + 0.8 * fluffNoise( position * 5.0 );
  vec3 fluffSkinned = transformed;
  transformed = mix( transformed, lagPos, clamp( fluffAmount * fluff * lagVar, 0.0, 1.0 ) );
  vec3 fluffQ = position * 4.0;
  float fluffT = fluffTime * 1.5;
  vec3 fluffWobble = vec3(
    fluffNoise( fluffQ + vec3( fluffT, 0.0, 0.0 ) ),
    fluffNoise( fluffQ + vec3( 17.0, fluffT, 0.0 ) ),
    fluffNoise( fluffQ + vec3( 0.0, 31.0, fluffT ) ) ) - 0.5;
  transformed += fluffWobble * 2.0 * fluffFlutter * fluff;
  #ifdef FLUFF_HAIR
    // Extrapolate past the lagged pose toward the tips so strands bend and swing
    transformed += ( lagPos - fluffSkinned ) * fluffAmount * hairTip * 1.5;
    transformed += fluffWobble * 3.0 * fluffFlutter * hairTip;
  #endif
  #ifdef FLUFF_SHELL
    // Tips trail further behind than roots
    transformed = mix( transformed, lagPos, clamp( fluffShell * fluffAmount * 0.5, 0.0, 1.0 ) );
    transformed += normalize( objectNormal ) * fluffShell * fluffFurLength * ( 0.4 + 0.6 * fluff );
  #endif
#endif`)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying float vFluff;
varying vec3 vFluffRest;
uniform float fluffFuzz;
uniform float fluffShell;
${FLUFF_NOISE_GLSL}`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
#ifdef FLUFF_SHELL
{
  // ~1cm cells; each holds a strand of random length that thins toward its tip
  vec3 cellP = vFluffRest * 90.0;
  float strandLen = fluffHash( floor( cellP ) );
  float r = length( fract( cellP ) - 0.5 );
  if ( strandLen < fluffShell || r > 0.55 * ( 1.0 - 0.7 * fluffShell ) ) discard;
}
#endif`)
      .replace('#include <tonemapping_fragment>', `${lit ? `{
  float fuzzRim = pow( 1.0 - abs( dot( normalize( normal ), normalize( vViewPosition ) ) ), 2.5 );
  gl_FragColor.rgb *= mix( 1.0, mix( 0.65, 1.0, vFluff ), fluffFuzz );
  gl_FragColor.rgb += ( gl_FragColor.rgb * 1.3 + 0.05 ) * fuzzRim * fluffFuzz;
}` : ''}
#ifdef FLUFF_SHELL
  gl_FragColor.rgb *= mix( 0.6, 1.15, fluffShell );
#endif
#include <tonemapping_fragment>`)
  }
  mat.customProgramCacheKey = () => `fluffy-${lit}-${isShell}-${hair}`
  return mat
}

interface SpringState {
  init: boolean
  pos: THREE.Vector3; vel: THREE.Vector3
  quat: THREE.Quaternion; angVel: THREE.Vector3
}

// Lagged skeleton: one damped spring (position + rotation) per bone, written
// into proxy bones whose matrices fill one bone texture per Skeleton.
class LagSkeletons {
  readonly uniforms = new Map<THREE.Skeleton, FluffyUniforms>()
  private states = new Map<THREE.Bone, SpringState>()
  private proxies = new Map<THREE.Bone, THREE.Bone>()
  private lagSkeletons: THREE.Skeleton[] = []
  private shared = {
    fluffTime: { value: 0 }, fluffAmount: { value: 0 }, fluffFlutter: { value: 0 },
    fluffFuzz: { value: 0 }, fluffFurLength: { value: 0 },
  }

  private root: THREE.Object3D

  constructor(root: THREE.Object3D, meshes: THREE.SkinnedMesh[]) {
    this.root = root
    // Each exported mesh has its own Skeleton object over the same bones
    for (const skeleton of new Set(meshes.map(m => m.skeleton))) {
      const proxies = skeleton.bones.map((b) => {
        let p = this.proxies.get(b)
        if (!p) {
          p = new THREE.Bone()
          this.proxies.set(b, p)
          this.states.set(b, {
            init: false, pos: new THREE.Vector3(), vel: new THREE.Vector3(),
            quat: new THREE.Quaternion(), angVel: new THREE.Vector3(),
          })
        }
        return p
      })
      const lag = new THREE.Skeleton(proxies, skeleton.boneInverses)
      lag.computeBoneTexture()
      this.lagSkeletons.push(lag)
      this.uniforms.set(skeleton, { lagBoneTexture: { value: lag.boneTexture }, ...this.shared })
    }
  }

  private tp = new THREE.Vector3(); private ts = new THREE.Vector3(); private tq = new THREE.Quaternion()
  private err = new THREE.Quaternion(); private dq = new THREE.Quaternion()
  private acc = new THREE.Vector3(); private e = new THREE.Vector3(); private axis = new THREE.Vector3()

  step(dt: number, s: FluffySettings) {
    const { tp, ts, tq, err, dq, acc, e, axis } = this
    // Bones were just moved by the animation / pose
    this.root.updateMatrixWorld(true)
    dt = Math.min(dt, 1 / 20)
    const k = THREE.MathUtils.lerp(700, 18, s.softness)
    const c = 2 * THREE.MathUtils.lerp(1.1, 0.12, s.bounce) * Math.sqrt(k)
    const substeps = Math.max(1, Math.ceil(dt * 120))
    const h = dt / substeps

    this.states.forEach((st, bone) => {
      bone.matrixWorld.decompose(tp, tq, ts)
      // Snap on first use and on teleports (e.g. a root-motion clip looping)
      if (!st.init || st.pos.distanceToSquared(tp) > 0.5 * 0.5) {
        st.init = true
        st.pos.copy(tp); st.vel.set(0, 0, 0)
        st.quat.copy(tq); st.angVel.set(0, 0, 0)
      }
      for (let n = 0; n < substeps; n++) {
        acc.subVectors(tp, st.pos).multiplyScalar(k).addScaledVector(st.vel, -c)
        st.vel.addScaledVector(acc, h)
        st.pos.addScaledVector(st.vel, h)

        // Rotation error as an axis-angle vector (shortest arc)
        err.copy(st.quat).invert().premultiply(tq)
        if (err.w < 0) { err.x = -err.x; err.y = -err.y; err.z = -err.z; err.w = -err.w }
        const sinHalf = Math.hypot(err.x, err.y, err.z)
        const angle = 2 * Math.atan2(sinHalf, err.w)
        if (sinHalf > 1e-8) e.set(err.x, err.y, err.z).multiplyScalar(angle / sinHalf)
        else e.set(0, 0, 0)
        acc.copy(e).multiplyScalar(k).addScaledVector(st.angVel, -c)
        st.angVel.addScaledVector(acc, h)
        const w = st.angVel.length() * h
        if (w > 1e-9) {
          axis.copy(st.angVel).normalize()
          st.quat.premultiply(dq.setFromAxisAngle(axis, w)).normalize()
        }
      }
      this.proxies.get(bone)!.matrixWorld.compose(st.pos, st.quat, ts)
    })
    this.lagSkeletons.forEach(l => l.update())

    this.shared.fluffTime.value += dt
    this.shared.fluffAmount.value = s.amount
    this.shared.fluffFlutter.value = s.flutter * 0.03
    this.shared.fluffFuzz.value = s.fuzz
    this.shared.fluffFurLength.value = s.furLength
  }

  dispose() { this.lagSkeletons.forEach(l => l.dispose()) }
}

// ── Character ─────────────────────────────────────────────────────────────

export class FluffyCharacter {
  readonly root: THREE.Object3D
  readonly meshes: THREE.SkinnedMesh[] = []
  paused = false
  private rig: Rig
  private settings: FluffySettings
  private originals = new Map<THREE.SkinnedMesh, THREE.Material | THREE.Material[]>()

  private anim: {
    source: AnimationSource
    mixer: THREE.AnimationMixer
    retarget: (inPlace: boolean) => void
    speed: number
    inPlace: boolean
  } | null = null
  private playToken = 0
  private fade: {
    duration: number
    elapsed: number
    quats: Map<THREE.Bone, THREE.Quaternion>
    positions: Map<THREE.Bone, THREE.Vector3>
  } | null = null

  private lag: LagSkeletons | null = null
  private fluffyMaterials: THREE.Material[] = []
  private shells: THREE.SkinnedMesh[] = []

  constructor(root: THREE.Object3D, settings: Partial<FluffySettings> = {}) {
    this.root = root
    this.rig = readRig(root)
    root.traverse((o) => {
      const mesh = o as THREE.SkinnedMesh
      if (!mesh.isSkinnedMesh || mesh.name === 'ArmatureBindMesh') return
      // Bounding volumes are computed in bind pose; animated limbs would get culled
      mesh.frustumCulled = false
      // Painted hair: GLTFLoader loads the `_hairTip` attribute as `_hairtip`
      const tip = mesh.geometry.getAttribute('_hairtip')
      if (tip) mesh.geometry.setAttribute('hairTip', tip)
      if (mesh.userData.isHair || /^Hair_\d+/.test(mesh.name)) mesh.userData.isHair = true
      this.meshes.push(mesh)
      this.originals.set(mesh, mesh.material)
    })
    if (this.meshes.length > 0) computeFluffAttribute(this.meshes)
    this.settings = { ...DEFAULT_FLUFFY, ...settings }
    this.rebuildFluffy()
  }

  // ── Animation

  /** Plays a Mixamo FBX clip (looping), retargeted by bone name. */
  async play(fbxUrl: string, opts: PlayOptions = {}) {
    const token = ++this.playToken
    const source = await loadAnimation(fbxUrl)
    if (token !== this.playToken) return // superseded by a later play()/stop()
    const excluded = this.bonesUnder(opts.excludeBones ?? [])
    // Snapshot the current pose before the retargeter resets the rig to rest
    const fadeSeconds = opts.fade ?? 0
    this.fade = fadeSeconds > 0 ? {
      duration: fadeSeconds, elapsed: 0,
      quats: new Map(this.rig.bones.filter(b => !excluded.has(b)).map(b => [b, b.quaternion.clone()])),
      positions: new Map(this.rig.bones.filter(b => !excluded.has(b)).map(b => [b, b.position.clone()])),
    } : null
    this.stopMixer()
    const mixer = new THREE.AnimationMixer(source.root)
    mixer.clipAction(source.clip).play()
    this.anim = {
      source, mixer,
      retarget: createRetargeter(this.rig, source, excluded),
      speed: opts.speed ?? 1,
      inPlace: opts.inPlace ?? false,
    }
  }

  /** Rig bones matching `names` (any Mixamo prefix) plus all their descendant bones. */
  bonesUnder(names: string[]): Set<THREE.Bone> {
    const keys = new Set(names.map(boneKey))
    const out = new Set<THREE.Bone>()
    for (const b of this.rig.bones) {
      if (keys.has(boneKey(b.name)) || (isBone(b.parent) && out.has(b.parent))) out.add(b)
    }
    return out
  }

  /** The rig's bone for a Mixamo name (`mixamorig:Head`, `mixamorigHead` or `Head`). */
  getBone(name: string): THREE.Bone | undefined {
    const key = boneKey(name)
    return this.rig.bones.find(b => boneKey(b.name) === key)
  }

  /** Parent of the top bone (the exported `Armature` node): the space the rig is animated in. */
  get rigSpace(): THREE.Object3D { return this.rig.rigSpace }

  setSpeed(speed: number) { if (this.anim) this.anim.speed = speed }
  setInPlace(inPlace: boolean) { if (this.anim) this.anim.inPlace = inPlace }

  /** Stops the animation and returns to the bind (T-)pose. */
  stop() {
    this.playToken++
    this.fade = null
    this.stopMixer()
    this.resetPose()
  }

  /** Manual posing (when no animation plays): bone-local XYZ euler offset in radians
   *  on top of the bind pose. Accepts `mixamorig:Head`, `mixamorigHead` or `Head`. */
  setBoneRotation(name: string, rotation: [number, number, number] | null) {
    const key = boneKey(name)
    const bone = this.rig.bones.find(b => boneKey(b.name) === key)
    if (!bone) return
    bone.quaternion.copy(this.rig.restQuats.get(bone)!)
    if (rotation) bone.quaternion.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)))
  }

  resetPose() {
    for (const b of this.rig.bones) {
      b.quaternion.copy(this.rig.restQuats.get(b)!)
      b.position.copy(this.rig.restPositions.get(b)!)
    }
  }

  private stopMixer() {
    if (!this.anim) return
    this.anim.mixer.stopAllAction()
    this.anim.mixer.uncacheRoot(this.anim.source.root)
    this.anim = null
  }

  // ── Fluffy / fur

  getFluffy(): FluffySettings { return { ...this.settings } }

  setFluffy(patch: Partial<FluffySettings>) {
    const prev = this.settings
    this.settings = { ...prev, ...patch }
    const s = this.settings
    // Sliders like softness/amount only change uniforms; these need new materials
    if (s.enabled !== prev.enabled || Math.round(s.shells) !== Math.round(prev.shells) || s.shellsHairOnly !== prev.shellsHairOnly) {
      this.rebuildFluffy()
    }
  }

  private rebuildFluffy() {
    this.teardownFluffy()
    const s = this.settings
    if (!s.enabled || this.meshes.length === 0) return
    const lag = new LagSkeletons(this.root, this.meshes)
    this.lag = lag

    const materialFor = (mesh: THREE.SkinnedMesh, shell?: number) => {
      const original = this.originals.get(mesh)!
      const base = Array.isArray(original) ? original[0] : original
      const hair = !!mesh.userData.isHair && !!mesh.geometry.getAttribute('hairTip')
      const mat = makeFluffyMaterial(base, lag.uniforms.get(mesh.skeleton)!, shell, hair)
      this.fluffyMaterials.push(mat)
      return mat
    }
    for (const mesh of this.meshes) mesh.material = materialFor(mesh)

    // Shell fur: extra copies of each mesh sharing its geometry and skeleton
    const layers = Math.round(s.shells)
    for (let layer = 1; layer <= layers; layer++) {
      for (const mesh of this.meshes) {
        if (s.shellsHairOnly && !mesh.userData.isHair) continue
        const shell = new THREE.SkinnedMesh(mesh.geometry, materialFor(mesh, layer / layers))
        shell.position.copy(mesh.position)
        shell.quaternion.copy(mesh.quaternion)
        shell.scale.copy(mesh.scale)
        shell.bind(mesh.skeleton, mesh.bindMatrix)
        shell.bindMode = mesh.bindMode
        shell.frustumCulled = false
        shell.renderOrder = layer
        shell.raycast = () => {}
        mesh.parent?.add(shell)
        this.shells.push(shell)
      }
    }
  }

  private teardownFluffy() {
    this.shells.forEach(s => s.removeFromParent())
    this.shells = []
    this.meshes.forEach(m => { m.material = this.originals.get(m)! })
    this.fluffyMaterials.forEach(m => m.dispose())
    this.fluffyMaterials = []
    this.lag?.dispose()
    this.lag = null
  }

  // ── Frame update: animation → retarget → (caller's procedural bones) → springs (order matters)

  update(dt: number) {
    this.animate(dt)
    this.stepFluff(dt)
  }

  /** Clip + retarget (+ crossfade). Call stepFluff() afterwards, once any procedural bones are posed. */
  animate(dt: number) {
    if (this.anim) {
      this.anim.mixer.update(this.paused ? 0 : dt * this.anim.speed)
      this.anim.retarget(this.anim.inPlace)
    }
    const fade = this.fade
    if (fade) {
      fade.elapsed += this.paused ? 0 : dt
      const t = Math.min(1, fade.elapsed / fade.duration)
      const w = t * t * (3 - 2 * t)
      const clipQ = new THREE.Quaternion(), clipP = new THREE.Vector3()
      fade.quats.forEach((q, b) => { clipQ.copy(b.quaternion); b.quaternion.copy(q).slerp(clipQ, w) })
      fade.positions.forEach((p, b) => { clipP.copy(b.position); b.position.copy(p).lerp(clipP, w) })
      if (t >= 1) this.fade = null
    }
  }

  /** Fur / fluffy secondary motion; reads the bones' final pose for this frame. */
  stepFluff(dt: number) {
    this.lag?.step(this.paused ? 0 : dt, this.settings)
  }

  dispose() {
    this.stop()
    this.teardownFluffy()
  }
}

export async function loadFluffyCharacter(url: string, settings: Partial<FluffySettings> = {}) {
  const gltf = await new GLTFLoader().loadAsync(url)
  return new FluffyCharacter(gltf.scene, settings)
}

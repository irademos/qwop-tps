// Town mode: seeing through the houses' doors (townRooms.js). Each room lives far off under the
// map (ROOMS_ORIGIN), so neither side of a door can show the other directly. Instead each side is
// a capture all round a point plus a small shader that looks it up as if it were really there
// ("interior mapping"):
//  - outside, a house's door pane shows its room: the room captured once (only the room — its
//    meshes put on PORTAL_LAYER for the capture), looked up by where the view ray through the pane,
//    carried into the room by the door-to-door transform, hits the room's walls / floor / ceiling
//    (box-projected — the walls are right, the counters and the bed a little off);
//  - inside, the doorway and the windows show the street: the outdoors captured at the door spot
//    outside when the player walks in (a face a frame, so no hitch), looked up where the view ray,
//    carried out through the door, hits the ground or a sphere round the spot.
// No live view: people walking past aren't seen. Cost: a texture lookup per pixel of a pane, plus
// a capture now and then (a room's draws only that room).
//
// The six views of a capture go in one 2D texture, 3 × 2 tiles (not a cube render target: drawing
// into a cube's faces left one face black on some GL drivers), looked up by `cubeLookup` below.

import * as THREE from 'three';

export const PORTAL_LAYER = 29;

// The six views: where each looks and its up (right = forward × up); tile k at column k % 3, row k / 3
const FACES = [
  [[1, 0, 0], [0, 1, 0]],
  [[-1, 0, 0], [0, 1, 0]],
  [[0, 1, 0], [0, 0, 1]],
  [[0, -1, 0], [0, 0, 1]],
  [[0, 0, 1], [0, 1, 0]],
  [[0, 0, -1], [0, 1, 0]],
];

const VERT = /* glsl */`
varying vec3 vWorld;
varying vec2 vUv;
void main() {
  vUv = uv;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

// The capture's colour in direction d (FACES' layout; a half texel in from each tile's edges)
const LOOKUP = /* glsl */`
uniform sampler2D uAtlas;
uniform float uTile;
vec3 cubeLookup(vec3 d) {
  vec3 a = abs(d);
  vec3 f; vec3 u; float k;
  if (a.x >= a.y && a.x >= a.z) { f = vec3(sign(d.x), 0.0, 0.0); u = vec3(0.0, 1.0, 0.0); k = d.x > 0.0 ? 0.0 : 1.0; }
  else if (a.y >= a.z) { f = vec3(0.0, sign(d.y), 0.0); u = vec3(0.0, 0.0, 1.0); k = d.y > 0.0 ? 2.0 : 3.0; }
  else { f = vec3(0.0, 0.0, sign(d.z)); u = vec3(0.0, 1.0, 0.0); k = d.z > 0.0 ? 4.0 : 5.0; }
  vec3 r = cross(f, u);
  float z = dot(d, f);
  vec2 s = vec2(dot(d, r), dot(d, u)) / z * 0.5 + 0.5;
  s = clamp(s, 0.5 / uTile, 1.0 - 0.5 / uTile);
  vec2 uv = (vec2(mod(k, 3.0), floor(k / 3.0)) + s) / vec2(3.0, 2.0);
  return texture2D(uAtlas, uv).rgb;
}`;

// Outside looking in: uToRoom = world → the room's world spot (through the two doors)
const INTERIOR_FRAG = /* glsl */`
uniform mat4 uToRoom;
uniform vec3 uBoxMin;
uniform vec3 uBoxMax;
uniform vec3 uProbe;
uniform float uArch;
varying vec3 vWorld;
varying vec2 vUv;
${LOOKUP}
void main() {
  // (an arched door: round at the top — uArch = its height / width)
  if (uArch > 0.0) {
    vec2 q = vec2(vUv.x - 0.5, (vUv.y - 1.0) * uArch + 0.5);
    if (q.y > 0.0 && dot(q, q) > 0.25) discard;
  }
  vec3 p = (uToRoom * vec4(vWorld, 1.0)).xyz;
  vec3 c = (uToRoom * vec4(cameraPosition, 1.0)).xyz;
  vec3 d = normalize(p - c);
  d += vec3(equal(d, vec3(0.0))) * 1e-5;
  vec3 tf = max((uBoxMax - p) / d, (uBoxMin - p) / d);
  float t = max(min(min(tf.x, tf.y), tf.z), 0.0);
  vec3 col = cubeLookup(p + d * t - uProbe);
  // (a little shade round the frame: the doorway's depth)
  vec2 e = min(vUv, 1.0 - vUv);
  col *= mix(0.55, 1.0, smoothstep(0.0, 0.12, min(e.x * 1.6, e.y)));
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

// Inside looking out: uToOut = world (in the room) → world outside (through the two doors)
const OUTSIDE_FRAG = /* glsl */`
uniform mat4 uToOut;
uniform vec3 uProbe;
uniform float uGround;
uniform float uRadius;
uniform float uReady;
uniform vec3 uFallback;
varying vec3 vWorld;
${LOOKUP}
void main() {
  vec3 col = uFallback;
  if (uReady > 0.5) {
    vec3 p = (uToOut * vec4(vWorld, 1.0)).xyz;
    vec3 c = (uToOut * vec4(cameraPosition, 1.0)).xyz;
    vec3 d = normalize(p - c);
    // (the far side of a sphere round the spot, or the ground before it)
    vec3 o = p - uProbe;
    float b = dot(o, d);
    float t = -b + sqrt(max(b * b - dot(o, o) + uRadius * uRadius, 0.0));
    if (d.y < -1e-3) t = min(t, max((uGround - p.y) / d.y, 0.0));
    col = cubeLookup(p + d * t - uProbe);
  }
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

const lookupUniforms = () => ({ uAtlas: { value: null }, uTile: { value: 128 } });

export const createInteriorMaterial = () => new THREE.ShaderMaterial({
  vertexShader: VERT,
  fragmentShader: INTERIOR_FRAG,
  uniforms: {
    ...lookupUniforms(),
    uToRoom: { value: new THREE.Matrix4() },
    uBoxMin: { value: new THREE.Vector3() },
    uBoxMax: { value: new THREE.Vector3() },
    uProbe: { value: new THREE.Vector3() },
    uArch: { value: 0 },
  },
});

export const createOutsideMaterial = (fallback) => new THREE.ShaderMaterial({
  vertexShader: VERT,
  fragmentShader: OUTSIDE_FRAG,
  uniforms: {
    ...lookupUniforms(),
    uToOut: { value: new THREE.Matrix4() },
    uProbe: { value: new THREE.Vector3() },
    uGround: { value: 0 },
    uRadius: { value: 30 },
    uReady: { value: 0 },
    uFallback: { value: new THREE.Color(fallback) },
  },
  side: THREE.DoubleSide,
});

// Points a material at a capture (null: none)
export const useCapture = (material, capture) => {
  material.uniforms.uAtlas.value = capture?.texture ?? null;
  if (capture) material.uniforms.uTile.value = capture.size;
};

// A capture all round a point: `size` px a view, the six in one texture; `position` = where from
export function createCubeCapture(size) {
  const target = new THREE.WebGLRenderTarget(size * 3, size * 2, {
    generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: true,
  });
  const position = new THREE.Vector3();
  const cams = FACES.map(() => new THREE.PerspectiveCamera(90, 1, 0.05, 400));
  return { target, texture: target.texture, size, position, cams, dispose: () => target.dispose() };
}

// Draws views [from, to) of a capture from its position. `layer`: just that layer (and lights put on
// it); otherwise what the main camera sees
const _at = new THREE.Vector3();
export function renderCubeFaces(renderer, scene, capture, from = 0, to = 6, { layer = null } = {}) {
  const { target, size, position, cams } = capture;
  const prevTarget = renderer.getRenderTarget();
  const prevShadow = renderer.shadowMap.autoUpdate;
  const prevXr = renderer.xr.enabled;
  renderer.shadowMap.autoUpdate = false;  // (the sun's shadows stay round the player)
  renderer.xr.enabled = false;
  target.scissorTest = true;
  for (let i = from; i < to; i++) {
    const [f, u] = FACES[i];
    const cam = cams[i];
    cam.position.copy(position);
    cam.up.set(u[0], u[1], u[2]);
    cam.lookAt(_at.set(position.x + f[0], position.y + f[1], position.z + f[2]));
    cam.updateMatrixWorld(true);
    if (layer != null) cam.layers.set(layer);
    else cam.layers.mask = 1;
    const x = (i % 3) * size;
    const y = Math.floor(i / 3) * size;
    target.viewport.set(x, y, size, size);
    target.scissor.set(x, y, size, size);
    renderer.setRenderTarget(target);
    renderer.render(scene, cam);
  }
  renderer.setRenderTarget(prevTarget);
  renderer.shadowMap.autoUpdate = prevShadow;
  renderer.xr.enabled = prevXr;
}

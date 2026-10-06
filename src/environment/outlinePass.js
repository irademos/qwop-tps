/**
 * Cartoon outlines — thin dark ink lines on silhouettes and creases, with small breaks in
 * them so they look hand-drawn (the look of abeto's Messenger).
 *
 * Screen-space post pass: the scene is rendered into a render target with a depth texture,
 * then one full-screen pass draws it to the screen and inks the edges found in the depth:
 *
 *  - Edge metric: the Laplacian of 1/viewZ. 1/z is exactly linear across any flat surface on
 *    screen, so flat or sloped ground gives 0 and only real edges show: silhouettes (big
 *    jumps) and creases (kinks). Divided by the centre's 1/z so it's distance independent.
 *  - Breaks: 3D value noise erases the line where it's low. It's sampled at a point fixed to
 *    the surface, so the gaps stay put instead of sliding along the lines:
 *      - the static map (`setStaticRoot`): the world position, reconstructed from depth;
 *      - everything else (characters, swords, props): its bind-pose / local position, from a
 *        small "anchor" pass that draws only those meshes (ANCHOR_LAYER, tagged every
 *        TAG_EVERY frames) with the skinning applied, so gaps ride along with the animation.
 *  - Lines fade out with distance so the far map doesn't turn into scribble.
 *
 * Cost: one full-screen pass with ~8 texture reads, the anchor pass (characters only, no
 * MSAA, no shadows), and the scene going through an 8-bit sRGB render target (which carries
 * the MSAA instead of the canvas). Tune in outlineConfig (read each frame).
 */

import * as THREE from 'three';

export const outlineConfig = {
  enabled: true,
  color: [0.02, 0.015, 0.025], // ink colour (linear rgb)…
  inkDarken: 0.3,             // …but never lighter than the scene colour × this (night)
  colorMix: 0.92,             // 0–1: how far the line covers the scene colour
  thickness: 1.5,            // line half-width in CSS pixels (scaled by the pixel ratio)
  silhouette: 0.05,           // relative 1/z Laplacian where lines start…
  silhouetteSoft: 0.06,       // …and the range over which they fade in to full strength
  breakScale: 5,              // noise cells per metre (world space): short gaps, so no object loses its whole outline
  breakAmount: 0.32,          // 0–1: share of the line that's erased
  breakSoft: 0.06,            // softness of a break's ends
  fadeStart: 25,              // metres: lines start fading…
  fadeEnd: 70,                // …and are gone here
};

// Meshes outside the static root are also put on this layer for the anchor pass
const ANCHOR_LAYER = 7;
const TAG_EVERY = 30; // frames between re-tagging (new enemies, swords, props)

// Anchor pass: rgb = the surface point in the mesh's own (bind pose) space, scaled to metres;
// a = view distance, so the outline pass can tell whether this mesh is the visible surface
const anchorMaterial = new THREE.ShaderMaterial({
  vertexShader: /* glsl */`
    #include <skinning_pars_vertex>
    varying vec3 vAnchor;
    varying float vDist;
    void main() {
      #include <skinbase_vertex>
      #include <begin_vertex>
      vAnchor = transformed * length(modelMatrix[0].xyz);
      #include <skinning_vertex>
      #include <project_vertex>
      vDist = -mvPosition.z;
    }
  `,
  fragmentShader: /* glsl */`
    varying vec3 vAnchor;
    varying float vDist;
    void main() {
      gl_FragColor = vec4(vAnchor, vDist);
    }
  `,
  side: THREE.DoubleSide,
});

const vertexShader = /* glsl */`
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const fragmentShader = /* glsl */`
  #include <packing>
  uniform sampler2D tColor;
  uniform sampler2D tDepth;
  uniform sampler2D tAnchor;
  uniform vec2 texel;            // 1 / render target size
  uniform float cameraNear;
  uniform float cameraFar;
  uniform mat4 projectionInverse;
  uniform mat4 cameraWorld;
  uniform float thickness;
  uniform vec3 inkColor;
  uniform float colorMix;
  uniform float inkDarken;
  uniform float edgeStart;
  uniform float edgeSoft;
  uniform float breakScale;
  uniform float breakAmount;
  uniform float breakSoft;
  uniform float fadeStart;
  uniform float fadeEnd;
  varying vec2 vUv;

  float viewZAt(vec2 uv) {
    return perspectiveDepthToViewZ(texture2D(tDepth, uv).x, cameraNear, cameraFar);
  }

  float hash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float noise3(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash(i + vec3(0, 0, 0)), hash(i + vec3(1, 0, 0)), f.x),
                   mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x),
                   mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
  }

  void main() {
    vec4 color = texture2D(tColor, vUv);
    float depthC = texture2D(tDepth, vUv).x;
    vec2 o = texel * thickness;

    // 1/z of the centre and its 4 neighbours (viewZ is negative in front of the camera).
    // Normalised by the nearest of them, so a silhouette is judged (and faded / broken) by
    // the object in front, not by the background behind it.
    float zc = viewZAt(vUv);
    float zl = viewZAt(vUv - vec2(o.x, 0.0));
    float zr = viewZAt(vUv + vec2(o.x, 0.0));
    float zd = viewZAt(vUv - vec2(0.0, o.y));
    float zu = viewZAt(vUv + vec2(0.0, o.y));
    float ic = -1.0 / zc, il = -1.0 / zl, ir = -1.0 / zr, id = -1.0 / zd, iu = -1.0 / zu;
    float lap = abs(il + ir - 2.0 * ic) + abs(id + iu - 2.0 * ic);
    float nearest = ic;
    vec2 nearestUv = vUv;
    if (il > nearest) { nearest = il; nearestUv = vUv - vec2(o.x, 0.0); }
    if (ir > nearest) { nearest = ir; nearestUv = vUv + vec2(o.x, 0.0); }
    if (id > nearest) { nearest = id; nearestUv = vUv - vec2(0.0, o.y); }
    if (iu > nearest) { nearest = iu; nearestUv = vUv + vec2(0.0, o.y); }
    float edge = smoothstep(edgeStart, edgeStart + edgeSoft, lap / nearest);

    // Where the line is in the world (the nearest surface) for the breaks and distance fade
    float dist = 1.0 / nearest;
    vec4 clip = vec4(vUv * 2.0 - 1.0, depthC * 2.0 - 1.0, 1.0);
    vec4 view = projectionInverse * clip;
    view.xyz /= view.w;
    view.xyz *= dist / max(1e-4, -view.z);
    vec3 world = (cameraWorld * vec4(view.xyz, 1.0)).xyz;

    // A moving mesh that is the visible surface here: its own anchor point instead
    vec4 anchor = texture2D(tAnchor, nearestUv);
    vec3 breakPos = world;
    if (anchor.a > 0.0 && abs(anchor.a - dist) < 0.06 * dist + 0.05) breakPos = anchor.xyz + 31.7;

    float n = noise3(breakPos * breakScale);
    edge *= smoothstep(breakAmount - breakSoft, breakAmount + breakSoft, n);
    edge *= 1.0 - smoothstep(fadeStart, fadeEnd, dist);

    vec3 ink = min(inkColor, color.rgb * inkDarken);
    gl_FragColor = vec4(mix(color.rgb, ink, edge * colorMix), color.a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/**
 * Wraps the renderer: `render(scene, camera)` draws the scene with outlines (or plainly when
 * disabled). `setSamples(n)` sets the MSAA of the scene target (0 on low-end devices).
 */
export function createOutlineRenderer(renderer) {
  const size = new THREE.Vector2();
  let samples = 4;
  let target = null;
  let anchorTarget = null;
  let staticRoot = null;
  let frame = 0;
  const clearColor = new THREE.Color();

  const material = new THREE.ShaderMaterial({
    uniforms: {
      tColor: { value: null },
      tDepth: { value: null },
      tAnchor: { value: null },
      texel: { value: new THREE.Vector2() },
      cameraNear: { value: 0.1 },
      cameraFar: { value: 1000 },
      projectionInverse: { value: new THREE.Matrix4() },
      cameraWorld: { value: new THREE.Matrix4() },
      thickness: { value: 1 },
      inkColor: { value: new THREE.Color() },
      colorMix: { value: 1 },
      inkDarken: { value: 0.3 },
      edgeStart: { value: 0 },
      edgeSoft: { value: 0 },
      breakScale: { value: 1 },
      breakAmount: { value: 0 },
      breakSoft: { value: 0 },
      fadeStart: { value: 0 },
      fadeEnd: { value: 0 },
    },
    vertexShader,
    fragmentShader,
    depthTest: false,
    depthWrite: false,
  });
  const quadScene = new THREE.Scene();
  const quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  quad.frustumCulled = false;
  quadScene.add(quad);

  const disposeTarget = () => {
    if (target) {
      target.depthTexture?.dispose();
      target.dispose();
      target = null;
    }
    anchorTarget?.dispose();
    anchorTarget = null;
  };

  const ensureTarget = () => {
    renderer.getDrawingBufferSize(size);
    const w = Math.max(1, size.x), h = Math.max(1, size.y);
    if (target && target.width === w && target.height === h && target.samples === samples) return;
    disposeTarget();
    const depthTexture = new THREE.DepthTexture(w, h);
    depthTexture.type = THREE.UnsignedIntType;
    // 8-bit sRGB storage: half the bandwidth of half float, and the hardware's sRGB encode
    // keeps the dark colours from banding
    target = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.UnsignedByteType,
      colorSpace: THREE.SRGBColorSpace,
      samples,
      depthTexture,
      depthBuffer: true,
    });
    anchorTarget = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType,
      depthBuffer: true,
    });
  };

  // Every visible opaque mesh outside the static root goes on ANCHOR_LAYER
  const tagAnchors = (scene) => {
    for (const child of scene.children) {
      if (child === staticRoot) continue;
      child.traverse((obj) => {
        if (!obj.isMesh || obj.userData.isBlobShadow) return;
        const mat = Array.isArray(obj.material) ? obj.material[0] : obj.material;
        if (mat?.transparent && mat.opacity < 0.999) obj.layers.disable(ANCHOR_LAYER);
        else obj.layers.enable(ANCHOR_LAYER);
      });
    }
  };

  const renderAnchors = (scene, camera) => {
    if (frame++ % TAG_EVERY === 0) tagAnchors(scene);
    const background = scene.background;
    const override = scene.overrideMaterial;
    const layerMask = camera.layers.mask;
    const shadowAuto = renderer.shadowMap.autoUpdate;
    renderer.getClearColor(clearColor);
    const clearAlpha = renderer.getClearAlpha();
    scene.background = null;
    scene.overrideMaterial = anchorMaterial;
    camera.layers.set(ANCHOR_LAYER);
    renderer.shadowMap.autoUpdate = false; // the shadows were drawn for this frame already
    renderer.setClearColor(0x000000, 0);
    renderer.setRenderTarget(anchorTarget);
    renderer.clear();
    renderer.render(scene, camera);
    renderer.setClearColor(clearColor, clearAlpha);
    renderer.shadowMap.autoUpdate = shadowAuto;
    camera.layers.mask = layerMask;
    scene.overrideMaterial = override;
    scene.background = background;
  };

  const render = (scene, camera) => {
    if (!outlineConfig.enabled) {
      renderer.render(scene, camera);
      return;
    }
    ensureTarget();
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);
    renderAnchors(scene, camera);
    renderer.setRenderTarget(null);

    const u = material.uniforms;
    const cfg = outlineConfig;
    u.tColor.value = target.texture;
    u.tDepth.value = target.depthTexture;
    u.tAnchor.value = anchorTarget.texture;
    u.texel.value.set(1 / target.width, 1 / target.height);
    u.cameraNear.value = camera.near;
    u.cameraFar.value = camera.far;
    u.projectionInverse.value.copy(camera.projectionMatrixInverse);
    u.cameraWorld.value.copy(camera.matrixWorld);
    u.thickness.value = Math.max(1, cfg.thickness * renderer.getPixelRatio());
    u.inkColor.value.setRGB(cfg.color[0], cfg.color[1], cfg.color[2]);
    u.colorMix.value = cfg.colorMix;
    u.inkDarken.value = cfg.inkDarken;
    u.edgeStart.value = cfg.silhouette;
    u.edgeSoft.value = Math.max(1e-4, cfg.silhouetteSoft);
    u.breakScale.value = cfg.breakScale;
    u.breakAmount.value = cfg.breakAmount;
    u.breakSoft.value = Math.max(1e-4, cfg.breakSoft);
    u.fadeStart.value = cfg.fadeStart;
    u.fadeEnd.value = Math.max(cfg.fadeStart + 0.01, cfg.fadeEnd);
    renderer.render(quadScene, quadCamera);
  };

  return {
    render,
    setEnabled(on) {
      outlineConfig.enabled = !!on;
      if (!on) disposeTarget();
    },
    setSamples(n) { samples = Math.max(0, n | 0); },
    /** The static world (the map): its line breaks use world positions, everything else its own */
    setStaticRoot(root) { staticRoot = root; },
    dispose() {
      disposeTarget();
      material.dispose();
      quad.geometry.dispose();
    },
  };
}

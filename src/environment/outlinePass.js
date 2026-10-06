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
 *  - Breaks: 3D value noise sampled at the pixel's world position (reconstructed from depth)
 *    erases the line where it's low. World space, so the gaps stay put on the map as the
 *    camera moves instead of swimming over everything.
 *  - Lines fade out with distance so the far map doesn't turn into scribble.
 *
 * No extra scene draw (normals come for free from the depth), so the cost is one
 * full-screen pass with a handful of texture reads. Tune in outlineConfig (read each frame).
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
    float nearest = max(max(max(il, ir), max(id, iu)), ic);
    float edge = smoothstep(edgeStart, edgeStart + edgeSoft, lap / nearest);

    // Where the line is in the world (the nearest surface) for the breaks and distance fade
    float dist = 1.0 / nearest;
    vec4 clip = vec4(vUv * 2.0 - 1.0, depthC * 2.0 - 1.0, 1.0);
    vec4 view = projectionInverse * clip;
    view.xyz /= view.w;
    view.xyz *= dist / max(1e-4, -view.z);
    vec3 world = (cameraWorld * vec4(view.xyz, 1.0)).xyz;

    float n = noise3(world * breakScale);
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

  const material = new THREE.ShaderMaterial({
    uniforms: {
      tColor: { value: null },
      tDepth: { value: null },
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
    if (!target) return;
    target.depthTexture?.dispose();
    target.dispose();
    target = null;
  };

  const ensureTarget = () => {
    renderer.getDrawingBufferSize(size);
    const w = Math.max(1, size.x), h = Math.max(1, size.y);
    if (target && target.width === w && target.height === h && target.samples === samples) return;
    disposeTarget();
    const depthTexture = new THREE.DepthTexture(w, h);
    depthTexture.type = THREE.UnsignedIntType;
    // Half float keeps the linear colours from banding before the sRGB conversion here
    target = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType,
      samples,
      depthTexture,
      depthBuffer: true,
    });
  };

  const render = (scene, camera) => {
    if (!outlineConfig.enabled) {
      renderer.render(scene, camera);
      return;
    }
    ensureTarget();
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);

    const u = material.uniforms;
    const cfg = outlineConfig;
    u.tColor.value = target.texture;
    u.tDepth.value = target.depthTexture;
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
    dispose() {
      disposeTarget();
      material.dispose();
      quad.geometry.dispose();
    },
  };
}

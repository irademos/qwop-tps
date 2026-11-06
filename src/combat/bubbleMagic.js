import * as THREE from 'three';

// The bubble's hand magic: while the player's bubble is up they hold their (anatomical) left
// hand out (userData.bubbleCast → BUBBLE_HAND in playerModel.js) and swirls of purple light
// spiral out of the palm to the bubble's shell, spreading over it — as if the hand were
// making it. A glow pulses on the palm meanwhile. createBubbleMagic(scene) →
// update(dt, on, palm, center, radius) each frame / clear().

const MAX_PARTICLES = 90;
const SPAWN_PER_S = 75;
const LIFE_S = [0.7, 1.1];
const SPIRAL_R = [0.03, 0.16];   // m round the line out of the palm: at the palm … at the shell
const SPIN = [7, 12];            // rad/s round that line
const SPREAD = 0.45;             // how far they fan out over the shell at the end (× radius)
const POINT_SIZE = 0.085;
const GLOW_SIZE = 0.26;
const COLOR_A = new THREE.Color(0x9b4dff); // violet
const COLOR_B = new THREE.Color(0xf07aff); // pink-purple

let _texture = null;
const softDot = () => {
  if (_texture) return _texture;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  _texture = new THREE.CanvasTexture(c);
  _texture.colorSpace = THREE.SRGBColorSpace;
  return _texture;
};

const rand = (a, b) => a + Math.random() * (b - a);
const _d = new THREE.Vector3();
const _u = new THREE.Vector3();
const _v = new THREE.Vector3();
const _p = new THREE.Vector3();
const _o = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _c = new THREE.Color();

export function createBubbleMagic(scene) {
  const positions = new Float32Array(MAX_PARTICLES * 3);
  const colors = new Float32Array(MAX_PARTICLES * 3);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const points = new THREE.Points(geometry, new THREE.PointsMaterial({
    size: POINT_SIZE,
    map: softDot(),
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  }));
  points.name = 'BubbleHandMagic';
  points.frustumCulled = false;
  points.renderOrder = 11;
  points.visible = false;
  scene.add(points);

  const glow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: softDot(),
    color: 0xb35cff,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  }));
  glow.name = 'BubbleHandGlow';
  glow.renderOrder = 11;
  glow.visible = false;
  scene.add(glow);

  // Each particle: its age / life, its turn round the line, spin, hue, where on the shell it fans out to
  const parts = Array.from({ length: MAX_PARTICLES }, () => ({
    alive: false, age: 0, life: 1, phase: 0, spin: 0, hue: 0, fanA: 0,
  }));
  let spawnCarry = 0;
  let glowLevel = 0;
  let time = 0;

  const spawn = () => {
    const p = parts.find((q) => !q.alive);
    if (!p) return;
    p.alive = true;
    p.age = 0;
    p.life = rand(LIFE_S[0], LIFE_S[1]);
    p.phase = Math.random() * Math.PI * 2;
    p.spin = rand(SPIN[0], SPIN[1]) * (Math.random() < 0.5 ? -1 : 1);
    p.hue = Math.random();
    p.fanA = Math.random() * Math.PI * 2;
  };

  const update = (dt, on, palm, center, radius) => {
    dt = Math.min(Math.max(dt || 0, 0), 0.05);
    time += dt;
    const anyAlive = parts.some((p) => p.alive);
    glowLevel += ((on ? 1 : 0) - glowLevel) * (1 - Math.exp(-8 * dt));
    if (!on && !anyAlive && glowLevel < 0.02) {
      points.visible = false;
      glow.visible = false;
      return;
    }
    if (!palm || !center) return;
    // The line out: from the bubble's middle through the palm, on to its shell
    _d.copy(palm).sub(center);
    const fromCenter = _d.length();
    if (fromCenter < 1e-4) _d.set(0, 0, 1); else _d.divideScalar(fromCenter);
    const travel = Math.max(0.15, radius - Math.min(fromCenter, radius));
    _u.crossVectors(_d, Math.abs(_d.y) > 0.95 ? _v.set(1, 0, 0) : _up).normalize();
    _v.crossVectors(_d, _u).normalize();

    if (on) {
      spawnCarry += SPAWN_PER_S * dt;
      while (spawnCarry >= 1) { spawn(); spawnCarry -= 1; }
    }
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const p = parts[i];
      if (p.alive) {
        p.age += dt;
        if (p.age >= p.life) p.alive = false;
      }
      if (!p.alive) {
        positions[i * 3] = palm.x; positions[i * 3 + 1] = palm.y; positions[i * 3 + 2] = palm.z;
        colors[i * 3] = colors[i * 3 + 1] = colors[i * 3 + 2] = 0;
        continue;
      }
      const t = p.age / p.life;
      const ease = 1 - (1 - t) * (1 - t);
      const r = THREE.MathUtils.lerp(SPIRAL_R[0], SPIRAL_R[1], t);
      const a = p.phase + p.spin * p.age;
      _p.copy(palm).addScaledVector(_d, travel * ease)
        .addScaledVector(_u, Math.cos(a) * r)
        .addScaledVector(_v, Math.sin(a) * r);
      // Near the shell: fanning out along it (kept on the sphere)
      if (t > 0.6) {
        const k = (t - 0.6) / 0.4;
        _p.addScaledVector(_u, Math.cos(p.fanA) * SPREAD * radius * k)
          .addScaledVector(_v, Math.sin(p.fanA) * SPREAD * radius * k);
        _o.copy(_p).sub(center);
        const len = _o.length() || radius;
        _p.copy(center).addScaledVector(_o, THREE.MathUtils.lerp(len, radius, k) / len);
      }
      positions[i * 3] = _p.x; positions[i * 3 + 1] = _p.y; positions[i * 3 + 2] = _p.z;
      const bright = Math.sin(Math.PI * Math.min(1, t * 1.15)) * (0.75 + 0.25 * Math.sin(time * 20 + p.phase));
      _c.copy(COLOR_A).lerp(COLOR_B, p.hue).multiplyScalar(Math.max(0, bright));
      colors[i * 3] = _c.r; colors[i * 3 + 1] = _c.g; colors[i * 3 + 2] = _c.b;
    }
    geometry.attributes.position.needsUpdate = true;
    geometry.attributes.color.needsUpdate = true;
    points.visible = true;

    glow.visible = glowLevel > 0.02;
    glow.position.copy(palm);
    const pulse = 1 + 0.18 * Math.sin(time * 9);
    glow.scale.setScalar(GLOW_SIZE * pulse * glowLevel);
    glow.material.opacity = 0.9 * glowLevel;
  };

  const clear = () => {
    parts.forEach((p) => { p.alive = false; });
    spawnCarry = 0;
    glowLevel = 0;
    points.visible = false;
    glow.visible = false;
  };

  return { update, clear };
}

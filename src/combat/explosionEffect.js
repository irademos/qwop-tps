import * as THREE from 'three';

// Bomb explosion: a white-hot flash, an additive fireball that billows out and cools
// from yellow to deep red, sparks thrown out under gravity, a ground shockwave ring,
// a scorch mark, and a column of smoke that rises, spreads and slowly fades.
// Call updateExplosionEffects(dt) once per frame.

const MAX_ACTIVE_EXPLOSIONS = 8;
const GRAVITY = 9.8;

const FLASH_DURATION = 0.18;
const FIREBALL_COUNT = 22;
const FIREBALL_LIFETIME = [0.45, 0.8];
const SPARK_COUNT = 28;
const SPARK_LIFETIME = [0.5, 0.9];
const SMOKE_COUNT = 18;
const SMOKE_LIFETIME = [2.2, 3.4];
const RING_DURATION = 0.45;
const SCORCH_LINGER = 3.5;
const SCORCH_FADE = 1.5;

const _fireHot = new THREE.Color(0xfff3c4);
const _fireMid = new THREE.Color(0xff8a1e);
const _fireCool = new THREE.Color(0x7a1606);
const _smokeDark = new THREE.Color(0x2b2622);
const _smokeLight = new THREE.Color(0x8a8480);
const _tmpColor = new THREE.Color();

const activeExplosions = [];

// ─── shared procedural textures ──────────────────────────────────────────────

let _glowTexture = null;
let _smokeTexture = null;
let _sparkTexture = null;

function makeCanvas(size) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  return canvas;
}

function getGlowTexture() {
  if (_glowTexture) return _glowTexture;
  const size = 128;
  const canvas = makeCanvas(size);
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.85)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.3)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  _glowTexture = new THREE.CanvasTexture(canvas);
  _glowTexture.colorSpace = THREE.SRGBColorSpace;
  return _glowTexture;
}

// Lumpy cloud: overlapping soft blobs so each puff doesn't read as a perfect circle
function getSmokeTexture() {
  if (_smokeTexture) return _smokeTexture;
  const size = 128;
  const canvas = makeCanvas(size);
  const ctx = canvas.getContext('2d');
  const blob = (x, y, r, a) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(255,255,255,${a})`);
    g.addColorStop(0.55, `rgba(255,255,255,${a * 0.45})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  };
  blob(64, 64, 52, 0.55);
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + 0.4;
    const d = 18 + (i % 3) * 6;
    blob(64 + Math.cos(a) * d, 64 + Math.sin(a) * d, 24 + (i % 4) * 5, 0.35);
  }
  _smokeTexture = new THREE.CanvasTexture(canvas);
  _smokeTexture.colorSpace = THREE.SRGBColorSpace;
  return _smokeTexture;
}

function getSparkTexture() {
  if (_sparkTexture) return _sparkTexture;
  const size = 32;
  const canvas = makeCanvas(size);
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.6)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  _sparkTexture = new THREE.CanvasTexture(canvas);
  return _sparkTexture;
}

const _ringGeometry = new THREE.RingGeometry(0.88, 1, 48, 1).rotateX(-Math.PI / 2);
const _scorchGeometry = new THREE.CircleGeometry(1, 32).rotateX(-Math.PI / 2);

const rand = (min, max) => min + Math.random() * (max - min);

function randomUnitVector(out, minY = -1) {
  const y = rand(minY, 1);
  const r = Math.sqrt(Math.max(0, 1 - y * y));
  const a = Math.random() * Math.PI * 2;
  return out.set(Math.cos(a) * r, y, Math.sin(a) * r);
}

function makeSprite(texture, blending, color, opacity) {
  const material = new THREE.SpriteMaterial({
    map: texture,
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    blending,
  });
  const sprite = new THREE.Sprite(material);
  sprite.frustumCulled = false;
  return sprite;
}

/**
 * @param {THREE.Object3D} scene
 * @param {THREE.Vector3}  position world-space blast origin (ground contact point)
 * @param {object}  [options]
 * @param {number}  [options.groundY] height of the ground under the blast (defaults to position.y)
 * @param {number}  [options.scale]   overall size multiplier (1 ≈ a 2.8 m bomb blast)
 */
export function spawnExplosion(scene, position, options = {}) {
  if (!scene || !position) return;
  const scale = THREE.MathUtils.clamp(options.scale ?? 1, 0.3, 4);
  const groundY = Number.isFinite(options.groundY) ? options.groundY : position.y;

  const root = new THREE.Group();
  root.name = 'BombExplosion';
  root.position.set(position.x, groundY, position.z);
  scene.add(root);
  const originY = Math.max(0.25, position.y - groundY + 0.3) * scale;

  // Flash: a big white-hot glow that pops and vanishes
  const flash = makeSprite(getGlowTexture(), THREE.AdditiveBlending, 0xfff6d8, 1);
  flash.position.set(0, originY, 0);
  flash.scale.setScalar(0.5 * scale);
  root.add(flash);

  // Fireball puffs
  const fire = [];
  for (let i = 0; i < FIREBALL_COUNT; i++) {
    const sprite = makeSprite(getGlowTexture(), THREE.AdditiveBlending, _fireHot, 1);
    const dir = randomUnitVector(new THREE.Vector3(), -0.15);
    dir.y = Math.abs(dir.y) * 0.8 + 0.2;
    const speed = rand(2.2, 4.8) * scale;
    sprite.position.set(0, originY, 0).addScaledVector(dir, rand(0, 0.25) * scale);
    sprite.material.rotation = Math.random() * Math.PI * 2;
    root.add(sprite);
    fire.push({
      sprite,
      vel: dir.multiplyScalar(speed),
      life: rand(FIREBALL_LIFETIME[0], FIREBALL_LIFETIME[1]),
      size: rand(0.9, 1.5) * scale,
      spin: rand(-2, 2),
    });
  }

  // Sparks: one Points cloud, CPU-simulated
  const sparkPositions = new Float32Array(SPARK_COUNT * 3);
  const sparkColors = new Float32Array(SPARK_COUNT * 3);
  const sparkGeometry = new THREE.BufferGeometry();
  sparkGeometry.setAttribute('position', new THREE.BufferAttribute(sparkPositions, 3));
  sparkGeometry.setAttribute('color', new THREE.BufferAttribute(sparkColors, 3));
  const sparkMaterial = new THREE.PointsMaterial({
    size: 0.14 * scale,
    map: getSparkTexture(),
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const sparkPoints = new THREE.Points(sparkGeometry, sparkMaterial);
  sparkPoints.frustumCulled = false;
  root.add(sparkPoints);
  const sparks = [];
  for (let i = 0; i < SPARK_COUNT; i++) {
    const dir = randomUnitVector(new THREE.Vector3(), 0.05);
    sparks.push({
      pos: new THREE.Vector3(0, originY, 0),
      vel: dir.multiplyScalar(rand(5, 11) * scale),
      life: rand(SPARK_LIFETIME[0], SPARK_LIFETIME[1]),
    });
  }

  // Smoke puffs: start hidden inside the fireball and take over as it burns out
  const smoke = [];
  for (let i = 0; i < SMOKE_COUNT; i++) {
    const sprite = makeSprite(getSmokeTexture(), THREE.NormalBlending, _smokeDark, 0);
    const dir = randomUnitVector(new THREE.Vector3(), 0);
    sprite.position.set(dir.x * 0.4 * scale, originY + dir.y * 0.3 * scale, dir.z * 0.4 * scale);
    sprite.material.rotation = Math.random() * Math.PI * 2;
    root.add(sprite);
    smoke.push({
      sprite,
      vel: new THREE.Vector3(dir.x * rand(0.8, 1.8), rand(0.9, 1.9), dir.z * rand(0.8, 1.8)).multiplyScalar(scale),
      delay: rand(0.05, 0.3),
      life: rand(SMOKE_LIFETIME[0], SMOKE_LIFETIME[1]),
      size: rand(1.0, 1.6) * scale,
      spin: rand(-0.6, 0.6),
      maxOpacity: rand(0.6, 0.85),
    });
  }

  // Ground shockwave ring
  const ringMaterial = new THREE.MeshBasicMaterial({
    color: 0xffc27a,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const ring = new THREE.Mesh(_ringGeometry, ringMaterial);
  ring.position.y = 0.06;
  ring.scale.setScalar(0.3 * scale);
  root.add(ring);

  // Scorch mark left on the ground
  const scorchMaterial = new THREE.MeshBasicMaterial({
    color: 0x0d0907,
    map: getGlowTexture(), // soft edge (its alpha falls off radially)
    transparent: true,
    opacity: 0.75,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
  });
  const scorch = new THREE.Mesh(_scorchGeometry, scorchMaterial);
  scorch.position.y = 0.03;
  scorch.scale.setScalar(1.6 * scale);
  scorch.rotation.y = Math.random() * Math.PI * 2;
  root.add(scorch);

  activeExplosions.push({
    root, scale, originY, age: 0,
    flash, fire, sparks, sparkPoints, sparkPositions, sparkColors, smoke, ring, scorch,
  });
  while (activeExplosions.length > MAX_ACTIVE_EXPLOSIONS) disposeExplosion(activeExplosions.shift());
}

function disposeExplosion(ex) {
  ex.root.parent?.remove(ex.root);
  ex.flash.material.dispose();
  for (const f of ex.fire) f.sprite.material.dispose();
  for (const s of ex.smoke) s.sprite.material.dispose();
  ex.sparkPoints.geometry.dispose();
  ex.sparkPoints.material.dispose();
  ex.ring.material.dispose();
  ex.scorch.material.dispose();
}

function updateExplosion(ex, dt) {
  ex.age += dt;
  const age = ex.age;
  let alive = false;

  // Flash
  if (ex.flash.visible) {
    const t = age / FLASH_DURATION;
    if (t >= 1) {
      ex.flash.visible = false;
    } else {
      ex.flash.scale.setScalar((0.5 + 3.8 * Math.sqrt(t)) * ex.scale);
      ex.flash.material.opacity = 1 - t * t;
      alive = true;
    }
  }

  // Fireball: fast outward burst with heavy drag, grows, cools yellow → orange → red
  const fireDrag = Math.exp(-4.5 * dt);
  for (const f of ex.fire) {
    if (!f.sprite.visible) continue;
    const t = age / f.life;
    if (t >= 1) { f.sprite.visible = false; continue; }
    alive = true;
    f.vel.multiplyScalar(fireDrag);
    f.vel.y += 1.6 * dt; // hot gas rises
    f.sprite.position.addScaledVector(f.vel, dt);
    f.sprite.material.rotation += f.spin * dt;
    f.sprite.scale.setScalar(f.size * (0.45 + 1.1 * Math.sqrt(t)));
    if (t < 0.35) _tmpColor.copy(_fireHot).lerp(_fireMid, t / 0.35);
    else _tmpColor.copy(_fireMid).lerp(_fireCool, (t - 0.35) / 0.65);
    f.sprite.material.color.copy(_tmpColor);
    f.sprite.material.opacity = t < 0.6 ? 1 : 1 - (t - 0.6) / 0.4;
  }

  // Sparks
  if (ex.sparkPoints.visible) {
    let anySpark = false;
    for (let i = 0; i < ex.sparks.length; i++) {
      const s = ex.sparks[i];
      const t = Math.min(1, age / s.life);
      if (t < 1) {
        anySpark = true;
        s.vel.multiplyScalar(Math.exp(-1.8 * dt));
        s.vel.y -= GRAVITY * dt;
        s.pos.addScaledVector(s.vel, dt);
        if (s.pos.y < 0.05) { s.pos.y = 0.05; s.vel.y *= -0.3; s.vel.x *= 0.6; s.vel.z *= 0.6; }
      }
      ex.sparkPositions[i * 3] = s.pos.x;
      ex.sparkPositions[i * 3 + 1] = s.pos.y;
      ex.sparkPositions[i * 3 + 2] = s.pos.z;
      // Additive: fading to black = fading out
      const k = 1 - t;
      ex.sparkColors[i * 3] = k;
      ex.sparkColors[i * 3 + 1] = 0.75 * k * k;
      ex.sparkColors[i * 3 + 2] = 0.35 * k * k * k;
    }
    ex.sparkPoints.geometry.attributes.position.needsUpdate = true;
    ex.sparkPoints.geometry.attributes.color.needsUpdate = true;
    if (!anySpark) ex.sparkPoints.visible = false;
    else alive = true;
  }

  // Smoke: billows up and out, lightens and fades
  const smokeDrag = Math.exp(-1.2 * dt);
  for (const s of ex.smoke) {
    const local = age - s.delay;
    if (local < 0) { alive = true; continue; }
    if (!s.sprite.visible) continue;
    const t = local / s.life;
    if (t >= 1) { s.sprite.visible = false; continue; }
    alive = true;
    s.vel.x *= smokeDrag;
    s.vel.z *= smokeDrag;
    s.vel.y = Math.max(0.35 * ex.scale, s.vel.y * smokeDrag);
    s.sprite.position.addScaledVector(s.vel, dt);
    s.sprite.material.rotation += s.spin * dt;
    s.sprite.scale.setScalar(s.size * (0.6 + 1.9 * Math.sqrt(t)));
    s.sprite.material.color.copy(_smokeDark).lerp(_smokeLight, Math.min(1, t * 1.4));
    const fadeIn = Math.min(1, t / 0.08);
    const fadeOut = t < 0.45 ? 1 : 1 - (t - 0.45) / 0.55;
    s.sprite.material.opacity = s.maxOpacity * fadeIn * fadeOut;
  }

  // Shockwave ring
  if (ex.ring.visible) {
    const t = age / RING_DURATION;
    if (t >= 1) {
      ex.ring.visible = false;
    } else {
      alive = true;
      const e = 1 - (1 - t) * (1 - t);
      ex.ring.scale.setScalar((0.3 + 3.2 * e) * ex.scale);
      ex.ring.material.opacity = 0.55 * (1 - t) * (1 - t);
    }
  }

  // Scorch mark
  if (ex.scorch.visible) {
    const t = (age - SCORCH_LINGER) / SCORCH_FADE;
    if (t >= 1) {
      ex.scorch.visible = false;
    } else {
      alive = true;
      if (t > 0) ex.scorch.material.opacity = 0.75 * (1 - t);
    }
  }

  return alive;
}

/** Advance all live explosions; call once per frame. */
export function updateExplosionEffects(dt) {
  if (!activeExplosions.length) return;
  const step = Math.min(Math.max(dt || 0, 0), 0.1);
  for (let i = activeExplosions.length - 1; i >= 0; i--) {
    const ex = activeExplosions[i];
    if (!updateExplosion(ex, step)) {
      disposeExplosion(ex);
      activeExplosions.splice(i, 1);
    }
  }
}

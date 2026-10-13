import * as THREE from 'three';
import { raycastMapSegment } from '../environment/mapCollision.js';
import { getTerrainHeight } from '../environment/terrainHeight.js';
import { spawnExplosion } from './explosionEffect.js';

// Sword Showdown magic: the wand's blasts and the ice they freeze people in.
//
// A blast is a glowing line (the shape of the swipe that cast it — horizontal, vertical,
// diagonal…) flying forward. It hits the first target whose body it sweeps through, unless
// that target is blocking with its blade along the same line (bladeBlocksBlast). Each blast
// is randomly FIRE (thrown back like a bomb blast, more damage) or ICE (less damage, frozen in
// ice cubes for a few seconds). What a hit does is up to the caller (target.onHit).
// Map surfaces stop blasts (raycastMapSegment). Call update(dt, getTargets) once per frame.

export const MAGIC_ELEMENTS = {
  fire: { key: 'fire', core: 0xfff0b0, glow: 0xff5a14, spark: 0xffa040 },
  ice: { key: 'ice', core: 0xf2fbff, glow: 0x3cc8ff, spark: 0xa8ecff },
};
export const randomMagicElement = () => (Math.random() < 0.5 ? 'fire' : 'ice');

// Blocking a blast: the blade has to lie along the blast's line (seen from the caster),
// within this many degrees
export const BLAST_BLOCK_MAX_ANGLE_DEG = 30;

const BLAST_HALF_THICKNESS = 0.07;
const SPARK_LIFE_S = 0.4;
const MAX_SPARKS = 160;
const ICE_SHARDS = 5;

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Vector3();
const _n = new THREE.Vector3();
const _basis = new THREE.Matrix4();
const _pB = new THREE.Vector3();
const _pL = new THREE.Vector3();

let _glowTexture = null;
const glowTexture = () => {
  if (_glowTexture) return _glowTexture;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.4, 'rgba(255,255,255,0.5)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  _glowTexture = new THREE.CanvasTexture(c);
  _glowTexture.colorSpace = THREE.SRGBColorSpace;
  return _glowTexture;
};

const additive = (color, opacity) => new THREE.MeshBasicMaterial({
  color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
});
// Unit capsule-ish bar along local X (scaled to the blast's length)
const _barGeometry = new THREE.CylinderGeometry(1, 1, 1, 12, 1).rotateZ(Math.PI / 2);
const _capGeometry = new THREE.SphereGeometry(1, 12, 8);
const _shardGeometry = new THREE.OctahedronGeometry(1, 0);

/**
 * True if a blade lying along `bladeDir` blocks a blast whose line is `lineDir`, flying along
 * `forward`: both are projected onto the plane facing the blast, and must be within
 * `maxDeg` of each other (a horizontal blast needs a horizontal block, and so on).
 */
export function bladeBlocksBlast(bladeDir, lineDir, forward, maxDeg = BLAST_BLOCK_MAX_ANGLE_DEG) {
  if (!bladeDir || !lineDir) return false;
  _n.copy(forward).normalize();
  _pB.copy(bladeDir).addScaledVector(_n, -bladeDir.dot(_n));
  _pL.copy(lineDir).addScaledVector(_n, -lineDir.dot(_n));
  if (_pB.lengthSq() < 1e-6 || _pL.lengthSq() < 1e-6) return false; // blade pointed at the caster covers nothing
  return Math.abs(_pB.normalize().dot(_pL.normalize())) >= Math.cos(maxDeg * Math.PI / 180);
}

/**
 * Line direction for a swipe vector seen by someone facing `forward`: the swipe projected
 * onto the plane facing forward (a swipe straight ahead becomes horizontal). Returns `out`.
 */
export function swipeToBlastLine(swipe, forward, out = new THREE.Vector3()) {
  _n.copy(forward).normalize();
  out.copy(swipe).addScaledVector(_n, -swipe.dot(_n));
  if (out.lengthSq() < 1e-6) out.set(0, 1, 0).cross(_n); // no sideways / vertical part: horizontal
  if (out.lengthSq() < 1e-6) out.set(1, 0, 0);
  return out.normalize();
}

export function createMagicBlasts({ scene }) {
  const blasts = [];
  const sparks = []; // { sprite, vel, life, max }

  const spawnSpark = (pos, element, speed = 1.2, size = 0.16) => {
    if (sparks.length >= MAX_SPARKS) {
      const old = sparks.shift();
      old.sprite.parent?.remove(old.sprite);
      old.sprite.material.dispose();
    }
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture(), color: MAGIC_ELEMENTS[element].spark, transparent: true, opacity: 0.9,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    }));
    sprite.position.copy(pos);
    sprite.scale.setScalar(size);
    scene.add(sprite);
    const vel = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.3, Math.random() - 0.5).multiplyScalar(speed);
    if (element === 'fire') vel.y += 0.8; // flames rise; ice dust falls (gravity below)
    sparks.push({ sprite, vel, life: SPARK_LIFE_S, max: SPARK_LIFE_S, size, element });
  };

  const burst = (pos, element, count = 18) => {
    for (let i = 0; i < count; i++) spawnSpark(pos, element, 4, 0.22);
    if (element === 'fire') {
      const groundY = getTerrainHeight(pos.x, pos.z);
      spawnExplosion(scene, pos, { scale: 0.4, groundY: Number.isFinite(groundY) ? Math.min(groundY, pos.y) : pos.y - 0.5 });
      window.audioManager?.playSFX?.('SFX/Explosions/Explosion 1.ogg', 0.35, { cooldownKey: 'magic-fire-hit', cooldownMs: 80 });
    } else {
      window.audioManager?.playSFX?.('SFX/Spells/Waterspray 1.ogg', 0.6, { cooldownKey: 'magic-ice-hit', cooldownMs: 80 });
    }
  };

  const removeBlast = (blast) => {
    const i = blasts.indexOf(blast);
    if (i !== -1) blasts.splice(i, 1);
    blast.group.parent?.remove(blast.group);
    blast.group.traverse((o) => { if (o.material) o.material.dispose(); });
  };

  /**
   * Fires a blast. `origin` = centre of the line, `forward` = flight direction,
   * `line` = the line's direction, `side` = who cast it ('player' | 'enemy', passed back to
   * getTargets), `element` = 'fire' | 'ice' (random when left out).
   */
  const spawn = ({ origin, forward, line, side = 'player', element = randomMagicElement(), speed = 15,
    length = 1.4, range = 22, caster = null }) => {
    const f = forward.clone();
    if (f.lengthSq() < 1e-6) f.set(0, 0, 1);
    f.normalize();
    const l = swipeToBlastLine(line, f);
    const up = new THREE.Vector3().crossVectors(f, l).normalize(); // thickness axis
    const colors = MAGIC_ELEMENTS[element] ?? MAGIC_ELEMENTS.fire;

    const group = new THREE.Group();
    group.name = `magic-blast-${element}`;
    _basis.makeBasis(l, up, f);
    group.quaternion.setFromRotationMatrix(_basis);
    group.position.copy(origin);
    const half = length / 2;
    const core = new THREE.Mesh(_barGeometry, additive(colors.core, 0.95));
    core.scale.set(length, BLAST_HALF_THICKNESS * 0.6, BLAST_HALF_THICKNESS * 0.6);
    const glow = new THREE.Mesh(_barGeometry, additive(colors.glow, 0.55));
    glow.scale.set(length * 1.04, BLAST_HALF_THICKNESS * 2.2, BLAST_HALF_THICKNESS * 2.2);
    group.add(core, glow);
    for (const s of [-1, 1]) {
      const cap = new THREE.Mesh(_capGeometry, additive(colors.glow, 0.6));
      cap.scale.setScalar(BLAST_HALF_THICKNESS * 2.4);
      cap.position.x = s * half;
      group.add(cap);
    }
    const shards = [];
    if (element === 'ice') {
      const shardMat = new THREE.MeshStandardMaterial({
        color: 0xbfefff, emissive: 0x3cc8ff, emissiveIntensity: 0.6, transparent: true, opacity: 0.8, roughness: 0.1,
      });
      for (let i = 0; i < ICE_SHARDS; i++) {
        const shard = new THREE.Mesh(_shardGeometry, i ? shardMat.clone() : shardMat);
        shard.scale.set(0.05, 0.05, 0.12);
        shard.position.set(-half + (length * (i + 0.5)) / ICE_SHARDS, 0, 0);
        group.add(shard);
        shards.push(shard);
      }
    }
    group.traverse((o) => { o.frustumCulled = false; o.renderOrder = 3; });
    scene.add(group);
    const blast = {
      group, element, side, caster, forward: f, line: l, length, speed, range,
      travelled: 0, age: 0, shards, done: false,
    };
    blasts.push(blast);
    window.audioManager?.playSFX?.('SFX/Spells/Spell Impact 1.ogg', side === 'player' ? 0.55 : 0.4, { cooldownKey: `magic-cast-${side}`, cooldownMs: 120 });
    return blast;
  };

  /**
   * Moves the blasts and resolves hits. `getTargets(blast)` returns what the blast can hit:
   * [{ center: Vector3, radius, blocks?(blast) → bool, onBlocked?(blast), onHit(blast) }].
   */
  const update = (dt, getTargets) => {
    for (let i = blasts.length - 1; i >= 0; i--) {
      const b = blasts[i];
      const step = Math.min(b.speed * dt, b.range - b.travelled);
      const from = _v.copy(b.group.position);
      const to = _v2.copy(from).addScaledVector(b.forward, step);
      b.age += dt;

      // First target on this frame's sweep (closest along the flight)
      let hit = null;
      let hitT = Infinity;
      const half = b.length / 2;
      for (const t of (getTargets?.(b) || [])) {
        if (!t?.center) continue;
        const r = t.radius ?? 0.45;
        const along = _q.subVectors(t.center, from).dot(b.forward);
        if (along < -r || along > step + r) continue;
        const k = THREE.MathUtils.clamp(along, 0, step);
        const d = _q.copy(t.center).sub(from).addScaledVector(b.forward, -k);
        const a = d.dot(b.line);
        if (Math.abs(a) > half + r * 0.5) continue;
        d.addScaledVector(b.line, -a);
        if (d.length() > r) continue;
        if (along < hitT) { hitT = along; hit = t; }
      }
      // The map stops it (only up to the target's distance)
      const mapHit = raycastMapSegment(from, to);
      if (mapHit && (!hit || mapHit.distance < hitT)) {
        const p = mapHit.point.clone();
        burst(p, b.element, 12);
        removeBlast(b);
        continue;
      }
      if (hit) {
        const p = from.clone().addScaledVector(b.forward, Math.max(0, hitT));
        if (hit.blocks?.(b)) {
          hit.onBlocked?.(b);
          burst(p, b.element, 10);
        } else {
          hit.onHit(b);
          burst(p, b.element, 22);
        }
        removeBlast(b);
        continue;
      }
      b.group.position.copy(to);
      b.travelled += step;
      // Flicker + trailing sparks / spinning ice shards
      const flick = 0.85 + Math.sin(b.age * 40) * 0.15;
      b.group.children[1].material.opacity = 0.55 * flick;
      b.shards.forEach((s, si) => { s.rotation.x += dt * (6 + si); s.rotation.y += dt * 4; });
      const fade = THREE.MathUtils.clamp((b.range - b.travelled) / 3, 0, 1);
      b.group.scale.setScalar(0.4 + 0.6 * fade);
      if (Math.random() < 0.9) {
        const p = b.group.position.clone().addScaledVector(b.line, (Math.random() - 0.5) * b.length);
        spawnSpark(p, b.element);
      }
      if (b.travelled >= b.range - 1e-3) removeBlast(b);
    }

    for (let i = sparks.length - 1; i >= 0; i--) {
      const s = sparks[i];
      s.life -= dt;
      if (s.life <= 0) {
        s.sprite.parent?.remove(s.sprite);
        s.sprite.material.dispose();
        sparks.splice(i, 1);
        continue;
      }
      if (s.element === 'ice') s.vel.y -= 4 * dt;
      s.sprite.position.addScaledVector(s.vel, dt);
      const k = s.life / s.max;
      s.sprite.material.opacity = 0.9 * k;
      s.sprite.scale.setScalar(s.size * (0.4 + 0.6 * k));
    }
  };

  const clear = () => {
    while (blasts.length) removeBlast(blasts[0]);
    while (sparks.length) {
      const s = sparks.pop();
      s.sprite.parent?.remove(s.sprite);
      s.sprite.material.dispose();
    }
  };

  return {
    spawn,
    update,
    clear,
    count: () => blasts.length,
    /** In-flight blasts (read-only use: tutorial / camera). */
    list: () => blasts,
  };
}

// ── Ice: transparent blue cubes around a frozen character ───────────────────
const _cubeGeometry = new THREE.BoxGeometry(1, 1, 1);
const _iceMaterial = new THREE.MeshStandardMaterial({
  color: 0x9fdcff, emissive: 0x2a7fb8, emissiveIntensity: 0.35, transparent: true, opacity: 0.42,
  roughness: 0.08, metalness: 0, depthWrite: false,
});
const _iceEdgeMaterial = new THREE.LineBasicMaterial({ color: 0xe6f8ff, transparent: true, opacity: 0.7 });
const _edgeGeometry = new THREE.EdgesGeometry(_cubeGeometry);

/**
 * A cluster of ice cubes for a character `height` m tall (local origin at its feet). Add it
 * to the character's group; setIceEncasingLevel() melts it away.
 */
export function createIceEncasing(height = 1) {
  const group = new THREE.Group();
  group.name = 'ice-encasing';
  const layers = 3;
  for (let layer = 0; layer < layers; layer++) {
    const y = ((layer + 0.5) / layers) * height * 1.05;
    const count = layer === layers - 1 ? 3 : 4;
    for (let i = 0; i < count; i++) {
      const size = height * (0.42 + Math.random() * 0.12);
      const a = (i / count) * Math.PI * 2 + layer * 0.6 + Math.random() * 0.4;
      const r = height * (0.14 + Math.random() * 0.06);
      const cube = new THREE.Mesh(_cubeGeometry, _iceMaterial);
      cube.scale.setScalar(size);
      cube.position.set(Math.cos(a) * r, y, Math.sin(a) * r);
      cube.rotation.set(Math.random() * 0.6, Math.random() * Math.PI, Math.random() * 0.6);
      cube.renderOrder = 4;
      const edges = new THREE.LineSegments(_edgeGeometry, _iceEdgeMaterial);
      cube.add(edges);
      group.add(cube);
    }
  }
  group.userData.cubes = group.children.map((c) => ({ cube: c, base: c.scale.x }));
  return group;
}

/** 1 = solid ice, 0 = melted away (cubes shrink as it melts / is shaken off). */
export function setIceEncasingLevel(group, level) {
  const k = THREE.MathUtils.clamp(level, 0, 1);
  for (const { cube, base } of group?.userData?.cubes || []) cube.scale.setScalar(base * (0.55 + 0.45 * k));
}

/** Small shake (shaking free): jitter the whole cluster. */
export function shakeIceEncasing(group, amount) {
  if (!group) return;
  group.position.set((Math.random() - 0.5) * amount, 0, (Math.random() - 0.5) * amount);
}

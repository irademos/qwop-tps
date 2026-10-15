import * as THREE from 'three';
import { buildItemMesh } from '../village/villageMode.js';
import { createBombMesh, getBombGLTF } from '../characters/BombThrowerEnemy.js';

// Multiplayer battles: pickup items scattered around the arena (src/multiplayer/matchMode.js).
// Every fighter starts with the sword only; walking over a pickup gives its item (the effect
// is applied by bootstrapGameApp.js — matchCtx.applyPickup — or, for a host bot, by
// matchMode). The layout is the same on every client (seeded by the match id); the battle's
// host decides who gets each pickup (take → taken), then it respawns after `respawnMs`.
//
// Each pickup: a spinning item model floating over a glowing ring + light beam, with an
// emoji badge above it, all in the item's colour. Taken: only a faint ring stays until it
// pops back.

export const PICKUP_TYPES = {
  gun: { label: 'Gun', emoji: '🔫', color: 0xf59e0b, respawnMs: 25000, weight: 2, mesh: 'gun' },
  ammo: { label: 'Bullets', emoji: '🔶', color: 0xfacc15, respawnMs: 14000, weight: 1.6, mesh: 'bullets' },
  shield: { label: 'Shield', emoji: '🛡️', color: 0x38bdf8, respawnMs: 25000, weight: 1.4, mesh: 'shield' },
  bomb: { label: 'Bombs', emoji: '💣', color: 0xf97316, respawnMs: 16000, weight: 1.8, mesh: 'bomb' },
  wand: { label: 'Magic Wand', emoji: '🪄', color: 0xa855f7, respawnMs: 30000, weight: 1, mesh: 'wand' },
  mana: { label: 'Mana', emoji: '🧪', color: 0x6366f1, respawnMs: 14000, weight: 1.3, mesh: 'manaPotion' },
  heart: { label: 'Heart', emoji: '❤️', color: 0xef4444, respawnMs: 12000, weight: 2.4, mesh: 'heart' },
  potion: { label: 'Life Potion', emoji: '💖', color: 0xec4899, respawnMs: 30000, weight: 0.8, mesh: 'lifePotion' },
  bubble: { label: 'Bubble', emoji: '🫧', color: 0x7dd3fc, respawnMs: 20000, weight: 1.1, mesh: 'bubble' },
};
export const PICKUP_TYPE_KEYS = Object.keys(PICKUP_TYPES);

const PICKUP_COUNT = 18;
const PICKUP_MIN_GAP = 3.2;            // metres between two pickups
const ITEM_FLOAT_Y = 0.85;
const ITEM_SCALE = 2.3;                // the village counter models are ~0.25 m
const BADGE_Y = 1.75;
const BEAM_HEIGHT = 2.4;
const POP_IN_S = 0.35;

// Same "random" numbers on every client
export const seededRandom = (seedText) => {
  let h = 2166136261;
  for (let i = 0; i < seedText.length; i++) h = Math.imul(h ^ seedText.charCodeAt(i), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
};

const hex = (c) => `#${c.toString(16).padStart(6, '0')}`;

let _glowTex = null;
const glowTexture = () => {
  if (_glowTex) return _glowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,0.9)');
  grad.addColorStop(0.45, 'rgba(255,255,255,0.35)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  _glowTex = new THREE.CanvasTexture(c);
  _glowTex.colorSpace = THREE.SRGBColorSpace;
  return _glowTex;
};

let _beamTex = null;
const beamTexture = () => {
  if (_beamTex) return _beamTex;
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 64);
  grad.addColorStop(0, 'rgba(255,255,255,0)');
  grad.addColorStop(1, 'rgba(255,255,255,1)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 64);
  _beamTex = new THREE.CanvasTexture(c);
  _beamTex.colorSpace = THREE.SRGBColorSpace;
  return _beamTex;
};

const additive = (color, opacity, extra = {}) => new THREE.MeshBasicMaterial({
  color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false,
  side: THREE.DoubleSide, toneMapped: false, ...extra,
});

// Round badge with the item's emoji, tinted ring (sprite, always faces the camera)
function makeBadge(type) {
  const size = 128;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  g.beginPath();
  g.arc(size / 2, size / 2, size / 2 - 6, 0, Math.PI * 2);
  g.fillStyle = 'rgba(10, 14, 24, 0.82)';
  g.fill();
  g.lineWidth = 7;
  g.strokeStyle = hex(type.color);
  g.stroke();
  g.font = '64px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(type.emoji, size / 2, size / 2 + 4);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sprite.scale.setScalar(0.5);
  sprite.renderOrder = 6;
  return sprite;
}

// Little potion bottle (life = pink, mana = blue)
function makePotion(color) {
  const g = new THREE.Group();
  const glass = new THREE.MeshPhysicalMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, roughness: 0.05, clearcoat: 1 });
  const liquid = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.55, roughness: 0.3 });
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.1, 20, 14), glass);
  bulb.position.y = 0.1;
  const fill = new THREE.Mesh(new THREE.SphereGeometry(0.085, 20, 14), liquid);
  fill.position.y = 0.095;
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.035, 0.08, 12), glass);
  neck.position.y = 0.22;
  const cork = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.028, 0.04, 12), new THREE.MeshStandardMaterial({ color: 0x8b5a2b, roughness: 0.9 }));
  cork.position.y = 0.275;
  g.add(bulb, fill, neck, cork);
  g.position.y = -0.12;
  return g;
}

function makeItemModel(type, bombGltf) {
  let model;
  if (type.mesh === 'bomb') model = createBombMesh(bombGltf);
  else if (type.mesh === 'lifePotion') model = makePotion(0xec4899);
  else if (type.mesh === 'manaPotion') model = makePotion(0x6366f1);
  else model = buildItemMesh(type.mesh);
  const holder = new THREE.Group();
  if (type.mesh === 'bomb') {
    model.scale.multiplyScalar(1.6);
  } else {
    model.scale.multiplyScalar(ITEM_SCALE);
  }
  holder.add(model);
  return holder;
}

export function createMatchPickups({ scene, getGroundY, isBlocked = null }) {
  const root = new THREE.Group();
  root.name = 'match-pickups';
  let pickups = [];
  let bombGltf = null;
  getBombGLTF().then((gltf) => { bombGltf = gltf; }).catch(() => {});

  const dispose = (obj) => {
    obj.traverse((o) => {
      if (o.userData?.sharedAsset) return;
      o.geometry?.dispose?.();
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach((m) => {
        if (!m || m.userData?.shared) return;
        if (m.map && m.map !== _glowTex && m.map !== _beamTex) m.map.dispose();
        m.dispose?.();
      });
    });
  };

  const clear = () => {
    pickups.forEach((p) => dispose(p.group));
    root.clear();
    root.parent?.remove(root);
    pickups = [];
  };

  // Types for `count` pickups: one of each, then by weight
  const pickTypes = (rand, count) => {
    const out = [...PICKUP_TYPE_KEYS];
    const total = PICKUP_TYPE_KEYS.reduce((s, k) => s + PICKUP_TYPES[k].weight, 0);
    while (out.length < count) {
      let r = rand() * total;
      const key = PICKUP_TYPE_KEYS.find((k) => (r -= PICKUP_TYPES[k].weight) <= 0) || 'heart';
      out.push(key);
    }
    // Shuffle (seeded) so the guaranteed ones aren't all on the inside
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out.slice(0, count);
  };

  const buildOne = (id, typeKey, x, y, z) => {
    const type = PICKUP_TYPES[typeKey];
    const group = new THREE.Group();
    group.position.set(x, y, z);
    const glow = new THREE.Mesh(new THREE.CircleGeometry(0.95, 32), additive(type.color, 0.5, { map: glowTexture() }));
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = 0.03;
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.62, 0.72, 48), additive(type.color, 0.9));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.04;
    const dashes = new THREE.Mesh(new THREE.RingGeometry(0.8, 0.86, 48, 1, 0, Math.PI * 1.5), additive(0xffffff, 0.35));
    dashes.rotation.x = -Math.PI / 2;
    dashes.position.y = 0.045;
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.42, 0.55, BEAM_HEIGHT, 24, 1, true),
      additive(type.color, 0.22, { map: beamTexture() })
    );
    beam.position.y = BEAM_HEIGHT / 2;
    const item = makeItemModel(type, bombGltf);
    item.position.y = ITEM_FLOAT_Y;
    item.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    const badge = makeBadge(type);
    badge.position.y = BADGE_Y;
    [glow, ring, dashes, beam, badge].forEach((m) => { m.renderOrder = Math.max(m.renderOrder, 4); });
    group.add(glow, ring, dashes, beam, item, badge);
    root.add(group);
    return {
      id, type: typeKey, group, ring, dashes, glow, beam, item, badge,
      pos: group.position, availableAt: 0, popT: 1, phase: Math.random() * Math.PI * 2,
    };
  };

  // Scatter PICKUP_COUNT pickups around `center` between rMin and rMax metres
  const build = (matchId, center, { count = PICKUP_COUNT, rMin = 3, rMax = 19 } = {}) => {
    clear();
    scene.add(root);
    const rand = seededRandom(`pickups:${matchId}`);
    const types = pickTypes(rand, count);
    const spots = [];
    for (let tries = 0; spots.length < count && tries < count * 40; tries++) {
      const a = rand() * Math.PI * 2;
      const r = Math.sqrt(rMin * rMin + rand() * (rMax * rMax - rMin * rMin)); // even over the area
      const x = center.x + Math.sin(a) * r;
      const z = center.z + Math.cos(a) * r;
      if (spots.some((s) => Math.hypot(s.x - x, s.z - z) < PICKUP_MIN_GAP)) continue;
      if (isBlocked?.(x, z)) continue;
      spots.push({ x, z });
    }
    spots.forEach((s, i) => {
      const gy = getGroundY(s.x, s.z);
      pickups.push(buildOne(`p${i}`, types[i], s.x, Number.isFinite(gy) ? gy : center.y ?? 0, s.z));
    });
  };

  const byId = (id) => pickups.find((p) => p.id === id) || null;
  const isAvailable = (p, now = Date.now()) => !!p && now >= p.availableAt;

  const setTaken = (id, until) => {
    const p = byId(id);
    if (!p) return;
    p.availableAt = until;
    p.popT = 0;
  };

  // First available pickup whose ring `pos` stands in
  const findTouching = (pos, radius, now = Date.now(), filter = null) => {
    for (const p of pickups) {
      if (!isAvailable(p, now)) continue;
      if (Math.hypot(p.pos.x - pos.x, p.pos.z - pos.z) > radius) continue;
      if (Math.abs(p.pos.y - pos.y) > 2.2) continue;
      if (filter && !filter(p)) continue;
      return p;
    }
    return null;
  };

  const update = (dt, now = Date.now()) => {
    if (!pickups.length) return;
    const t = performance.now() / 1000;
    for (const p of pickups) {
      const up = isAvailable(p, now);
      if (up && p.popT < 1) p.popT = Math.min(1, p.popT + dt / POP_IN_S);
      const s = up ? THREE.MathUtils.smoothstep(p.popT, 0, 1) : 0;
      // Overshoot a little on pop-in
      const pop = up ? s * (1 + Math.sin(p.popT * Math.PI) * 0.25) : 0;
      p.item.visible = up;
      p.beam.visible = up;
      p.badge.visible = up;
      p.dashes.visible = up;
      if (up) {
        p.item.scale.setScalar(Math.max(0.001, pop));
        p.item.position.y = ITEM_FLOAT_Y + Math.sin(t * 2.2 + p.phase) * 0.09;
        p.item.rotation.y += dt * 1.6;
        p.badge.position.y = BADGE_Y + Math.sin(t * 2.2 + p.phase) * 0.05;
        p.badge.scale.setScalar(0.5 * Math.max(0.001, pop));
        p.dashes.rotation.z += dt * 0.9;
        p.beam.material.opacity = 0.16 + Math.sin(t * 3 + p.phase) * 0.06;
      }
      p.ring.material.opacity = up ? 0.85 : 0.18;
      p.glow.material.opacity = up ? 0.42 + Math.sin(t * 3 + p.phase) * 0.12 : 0.08;
    }
  };

  return {
    build,
    clear,
    update,
    setTaken,
    findTouching,
    isAvailable: (id, now) => isAvailable(byId(id), now),
    get: byId,
    get list() { return pickups; },
  };
}

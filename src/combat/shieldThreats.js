import * as THREE from 'three';

// What makes a shield bearer raise its shield (createBossFighter in pembertonBoss.js): a bow
// being aimed at it, or now and then a wand blast cast its way. The game reports them here —
// setBowAim each frame while a bow is drawn (the local player), noteSpellCast for every blast
// (magicBlast.js spawn) — and each fighter asks isBowAimedAt / spellsSince.

const BOW_AIM_STALE_MS = 250;   // an aim not reported again for this long is gone
const SPELL_KEEP_MS = 1500;
const _toTarget = new THREE.Vector3();

const bowAims = new Map();      // key → { origin, dir (unit), at }
const spells = [];              // { id, origin, forward (unit, level), caster, side, at }
let spellSeq = 0;

/** A bow drawn by `key` from `origin` toward `dir` (null: not any more). */
export function setBowAim(key, origin, dir) {
  if (!origin || !dir || dir.lengthSq() < 1e-8) { bowAims.delete(key); return; }
  let a = bowAims.get(key);
  if (!a) { a = { origin: new THREE.Vector3(), dir: new THREE.Vector3(), at: 0 }; bowAims.set(key, a); }
  a.origin.copy(origin);
  a.dir.copy(dir).normalize();
  a.at = performance.now();
}

/**
 * Is a bow aimed at someone standing at `pos` (feet), `radius` m wide, `maxDist` m away at most?
 * (its body — feet to `height` up — comes within `radius` of the aim line, in front of the bow)
 */
export function isBowAimedAt(pos, { radius = 1.4, height = 1.8, maxDist = 45 } = {}) {
  const now = performance.now();
  for (const [key, a] of bowAims) {
    if (now - a.at > BOW_AIM_STALE_MS) { bowAims.delete(key); continue; }
    _toTarget.set(pos.x - a.origin.x, pos.y + height * 0.5 - a.origin.y, pos.z - a.origin.z);
    const along = _toTarget.dot(a.dir);
    if (along < 0.5 || along > maxDist) continue;
    _toTarget.addScaledVector(a.dir, -along);
    // (a body is tall: the up / down miss counts less)
    const miss = Math.hypot(_toTarget.x, _toTarget.z, Math.max(0, Math.abs(_toTarget.y) - height * 0.5));
    if (miss <= radius) return true;
  }
  return false;
}

/** A wand blast was cast (every blast, whoever cast it). */
export function noteSpellCast({ origin, forward, caster = null, side = null }) {
  const now = performance.now();
  while (spells.length && now - spells[0].at > SPELL_KEEP_MS) spells.shift();
  const f = forward.clone().setY(0);
  if (f.lengthSq() < 1e-8) return;
  spells.push({ id: ++spellSeq, origin: origin.clone(), forward: f.normalize(), caster, side, at: now });
}

/** Spells cast after id `afterId` (for a fighter to look at each once). */
export function spellsSince(afterId) {
  return spells.filter((s) => s.id > afterId);
}

/** Is `pos` in the way of spell `s` (within `radius` of its line, `maxDist` ahead)? */
export function spellHeadsAt(s, pos, { radius = 1.8, maxDist = 26 } = {}) {
  const dx = pos.x - s.origin.x;
  const dz = pos.z - s.origin.z;
  const along = dx * s.forward.x + dz * s.forward.z;
  if (along < 0 || along > maxDist) return false;
  return Math.abs(dx * s.forward.z - dz * s.forward.x) <= radius;
}

export const latestSpellId = () => spellSeq;

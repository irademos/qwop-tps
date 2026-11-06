import * as THREE from 'three';

// What makes a shield bearer raise its shield (createBossFighter in pembertonBoss.js): a bow
// being drawn near it, or now and then a wand blast cast its way. The game reports them here —
// setBowDrawn each frame while a bow is drawn (the local player), noteSpellCast for every blast
// (magicBlast.js spawn) — and each fighter asks isBowDrawnNear / spellsSince.

const BOW_DRAW_STALE_MS = 250;  // a draw not reported again for this long is over
const SPELL_KEEP_MS = 1500;

const bowDraws = new Map();     // key → { pos, at }
const spells = [];              // { id, origin, forward (unit, level), caster, side, at }
let spellSeq = 0;

/** A bow being drawn by `key` at `pos` (null: not any more) — reported each frame of the draw. */
export function setBowDrawn(key, pos) {
  if (!pos) { bowDraws.delete(key); return; }
  let d = bowDraws.get(key);
  if (!d) { d = { pos: new THREE.Vector3(), at: 0 }; bowDraws.set(key, d); }
  d.pos.copy(pos);
  d.at = performance.now();
}

/** Is a bow being drawn within `maxDist` m of `pos`? (cheap: a squared distance per draw) */
export function isBowDrawnNear(pos, maxDist = 30) {
  const now = performance.now();
  const max2 = maxDist * maxDist;
  for (const [key, d] of bowDraws) {
    if (now - d.at > BOW_DRAW_STALE_MS) { bowDraws.delete(key); continue; }
    const dx = pos.x - d.pos.x;
    const dz = pos.z - d.pos.z;
    if (dx * dx + dz * dz <= max2) return true;
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

// Hit feel: hit-stop (the world freezes for a few frames on impact) + a tiny camera shake.
// `impact(kind)` from a hit; the game loop asks `frozen()` each frame (true → render only, no
// simulation) and wraps `renderer.render` in `applyShake(camera, dt)` / `restoreShake(camera)`,
// so the shake is an offset on top of wherever the camera was put — it never builds up.
// Off with localStorage `sq:hitFeel` = '0' (Settings → Display → Hit Shake & Freeze).
import * as THREE from 'three';

// Per kind: freeze seconds, shake amplitude (m), shake seconds
export const HIT_FEEL = {
  light: { freeze: 0.07, amp: 0.08, dur: 0.22 },   // chop, town hit, blocked swing
  hit: { freeze: 0.14, amp: 0.16, dur: 0.3 },      // a sword hit
  heavy: { freeze: 0.2, amp: 0.24, dur: 0.38 },    // a strong swing
  kill: { freeze: 0.26, amp: 0.32, dur: 0.45 },    // the killing blow
  hurt: { freeze: 0, amp: 0.2, dur: 0.32 },        // the player was hit (shake only)
};
// (a long frame can't hold the freeze longer than this)
const MAX_FREEZE_S = 0.3;
const SHAKE_FREQ = 32; // Hz — fast jitter, not a sway
const ROLL_PER_M = 0.12; // radians of camera roll per metre of shake amplitude
const STORAGE_KEY = 'sq:hitFeel';

export const isHitFeelEnabled = () => {
  try { return localStorage.getItem(STORAGE_KEY) !== '0'; } catch { return true; }
};
export const setHitFeelEnabled = (on) => {
  try { localStorage.setItem(STORAGE_KEY, on ? '1' : '0'); } catch { /* private window */ }
};

export function createHitFeel() {
  let freezeUntil = 0;   // performance.now() ms
  let shakeT = 0, shakeDur = 0, shakeAmp = 0;
  let seed = Math.random() * 100;
  const offset = new THREE.Vector3();
  const right = new THREE.Vector3();
  const up = new THREE.Vector3();
  let applied = false;
  let roll = 0;

  const impact = (kind = 'hit', { freeze = true } = {}) => {
    if (!isHitFeelEnabled()) return;
    const k = HIT_FEEL[kind] || HIT_FEEL.hit;
    const now = performance.now();
    if (freeze && k.freeze > 0) freezeUntil = Math.max(freezeUntil, now + Math.min(k.freeze, MAX_FREEZE_S) * 1000);
    // A bigger shake replaces a smaller one still going; a smaller one doesn't cut a big one short
    const left = shakeDur > 0 ? shakeAmp * (1 - shakeT / shakeDur) : 0;
    if (k.amp >= left) { shakeAmp = k.amp; shakeDur = k.dur; shakeT = 0; seed = Math.random() * 100; }
  };

  const frozen = () => performance.now() < freezeUntil;

  const applyShake = (camera, dt) => {
    applied = false;
    if (!camera || shakeDur <= 0) return;
    shakeT += Math.min(dt || 0, 0.05);
    if (shakeT >= shakeDur) { shakeDur = 0; return; }
    const fade = 1 - shakeT / shakeDur;
    const a = shakeAmp * Math.pow(fade, 1.3);
    const t = (seed + shakeT) * SHAKE_FREQ;
    // two out-of-step waves per axis — jittery without random jumps
    const sx = Math.sin(t * 1.0) * 0.6 + Math.sin(t * 2.3 + 1.7) * 0.4;
    const sy = Math.sin(t * 1.3 + 0.5) * 0.6 + Math.sin(t * 2.9 + 2.1) * 0.4;
    right.set(1, 0, 0).applyQuaternion(camera.quaternion);
    up.set(0, 1, 0).applyQuaternion(camera.quaternion);
    offset.copy(right).multiplyScalar(sx * a).addScaledVector(up, sy * a);
    camera.position.add(offset);
    roll = Math.sin(t * 1.7 + 0.9) * a * ROLL_PER_M;
    camera.rotateZ(roll);
    camera.updateMatrixWorld();
    applied = true;
  };

  const restoreShake = (camera) => {
    if (!applied || !camera) return;
    camera.position.sub(offset);
    camera.rotateZ(-roll);
    camera.updateMatrixWorld();
    applied = false;
  };

  const cancel = () => { freezeUntil = 0; shakeDur = 0; };

  return { impact, frozen, applyShake, restoreShake, cancel };
}

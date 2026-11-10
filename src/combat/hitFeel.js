// Hit feel: hit-stop (the world freezes for a few frames) + a camera shake on explosions —
// bombs and fire blasts (`explosion(kind, dist)`, from spawnExplosion's listener; weaker the
// further from the player, nothing past `far`). The game loop asks `frozen()` each frame (true →
// render only, no simulation) and wraps `renderer.render` in `applyShake(camera, dt)` /
// `restoreShake(camera)`, so the shake is an offset on top of wherever the camera was put — it
// never builds up. Off with localStorage `sq:hitFeel` = '0' (Settings → Display → Hit Shake & Freeze).
import * as THREE from 'three';

// Per kind: freeze seconds, shake amplitude (m), shake seconds, at full strength within `near` m,
// fading to nothing at `far` m; the freeze only happens within `freezeDist` m
export const HIT_FEEL = {
  bomb: { freeze: 0.2, amp: 0.32, dur: 0.5, near: 4, far: 26, freezeDist: 12 },
  magic: { freeze: 0.12, amp: 0.2, dur: 0.36, near: 3, far: 18, freezeDist: 8 },
  // the sword's combo attacks (swordCombo.js): Ground Pound / Spin Attack + Sky Slash
  combo: { freeze: 0.14, amp: 0.3, dur: 0.45, near: 4, far: 20, freezeDist: 12 },
  comboLight: { freeze: 0.05, amp: 0.1, dur: 0.25, near: 4, far: 20, freezeDist: 12 },
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

  // An explosion `dist` m from the player
  const explosion = (kind = 'bomb', dist = 0) => {
    if (!isHitFeelEnabled()) return;
    const k = HIT_FEEL[kind] || HIT_FEEL.bomb;
    const d = Number.isFinite(dist) ? dist : 0;
    const f = THREE.MathUtils.clamp(1 - (d - k.near) / (k.far - k.near), 0, 1);
    if (f <= 0) return;
    if (k.freeze > 0 && d <= k.freezeDist) {
      const s = Math.min(k.freeze * Math.min(1, 0.4 + f), MAX_FREEZE_S);
      freezeUntil = Math.max(freezeUntil, performance.now() + s * 1000);
    }
    const amp = k.amp * f;
    // A bigger shake replaces a smaller one still going; a smaller one doesn't cut a big one short
    const left = shakeDur > 0 ? shakeAmp * (1 - shakeT / shakeDur) : 0;
    if (amp >= left) { shakeAmp = amp; shakeDur = k.dur; shakeT = 0; seed = Math.random() * 100; }
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

  return { explosion, frozen, applyShake, restoreShake, cancel };
}

const MIN_STRENGTH = 1;
const MAX_STRENGTH = 5;
const MIN_RECOVERY_MS = 1000;
const MAX_RECOVERY_MS = 5000;
const MIN_PUSH_SCALE = 0.1;
const MAX_PUSH_SCALE = 0.35;

const lerp = (start, end, amount) => start + (end - start) * amount;

export function clampKnockbackStrength(strength = 3) {
  if (!Number.isFinite(strength)) return 3;
  return Math.min(MAX_STRENGTH, Math.max(MIN_STRENGTH, Math.round(strength)));
}

export function getKnockbackProfile(strength = 3) {
  const clamped = clampKnockbackStrength(strength);
  const t = (clamped - MIN_STRENGTH) / (MAX_STRENGTH - MIN_STRENGTH);
  return {
    strength: clamped,
    recoveryMs: Math.round(lerp(MIN_RECOVERY_MS, MAX_RECOVERY_MS, t)),
    pushScale: lerp(MIN_PUSH_SCALE, MAX_PUSH_SCALE, t),
  };
}

export function getKnockbackImpulse(direction, strength = 3) {
  const profile = getKnockbackProfile(strength);
  const impulse = direction.clone();
  if (impulse.lengthSq() > 0) {
    impulse.normalize().multiplyScalar(profile.pushScale);
  } else {
    impulse.set(0, 0, 0);
  }
  return { impulse, profile };
}

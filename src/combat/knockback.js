const MIN_STRENGTH = 1;
const MAX_STRENGTH = 10;
const MIN_RECOVERY_MS = 600;
const MAX_RECOVERY_MS = 3500;
const MIN_PUSH_SCALE = 4.0;
const MAX_PUSH_SCALE = 22.0;
const VERTICAL_IMPULSE_SCALE = 0.5;
const MIN_TRAVEL_DISTANCE = 1.0;
const MAX_TRAVEL_DISTANCE = 5.0;

// Hits at or above this strength trigger a ragdoll tumble on EnemyPlayer
export const RAGDOLL_STRENGTH_THRESHOLD = 8;

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
    travelDistance: lerp(MIN_TRAVEL_DISTANCE, MAX_TRAVEL_DISTANCE, t),
  };
}

export function getKnockbackImpulse(direction, strength = 3) {
  const profile = getKnockbackProfile(strength);
  const impulse = direction.clone();
  if (impulse.lengthSq() > 0) {
    impulse.normalize().multiplyScalar(profile.pushScale);
    impulse.y *= VERTICAL_IMPULSE_SCALE;
  } else {
    impulse.set(0, 0, 0);
  }
  return { impulse, profile };
}

export function getKnockbackMotion(direction, strength = 3) {
  const profile = getKnockbackProfile(strength);
  const horizontalDirection = direction.clone();
  horizontalDirection.y = 0;
  if (horizontalDirection.lengthSq() <= 0.000001) {
    return {
      velocity: horizontalDirection.set(0, 0, 0),
      profile,
    };
  }
  horizontalDirection.normalize();
  const recoverySeconds = Math.max(0.001, profile.recoveryMs / 1000);
  const speed = profile.travelDistance / recoverySeconds;
  return {
    velocity: horizontalDirection.multiplyScalar(speed),
    profile,
  };
}

export const HUNGER_MAX_SEGMENTS = 20;
export const MAGIC_MAX_SEGMENTS = 20;

export function clampHungerSegments(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(HUNGER_MAX_SEGMENTS, Math.round(numeric)));
}

export function clampMagicSegments(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(MAGIC_MAX_SEGMENTS, Math.round(numeric)));
}

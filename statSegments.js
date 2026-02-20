export const BASE_HUNGER_SEGMENTS = 4;
export const BASE_MAGIC_SEGMENTS = 4;
export const HUNGER_MAX_SEGMENTS = 20;
export const MAGIC_MAX_SEGMENTS = 20;

export function clampHungerSegments(value, maxSegments = HUNGER_MAX_SEGMENTS) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  const safeMax = Math.max(0, Math.round(maxSegments || 0));
  return Math.max(0, Math.min(safeMax, Math.round(numeric)));
}

export function clampMagicSegments(value, maxSegments = MAGIC_MAX_SEGMENTS) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  const safeMax = Math.max(0, Math.round(maxSegments || 0));
  return Math.max(0, Math.min(safeMax, Math.round(numeric)));
}

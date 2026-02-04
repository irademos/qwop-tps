export const BASE_HEALTH_SEGMENTS = 10;
export const HEALTH_SEGMENT_VALUE = 10;

export const getMaxHealthSegments = (level = 1) => {
  const safeLevel = Math.max(1, Math.round(level || 1));
  return BASE_HEALTH_SEGMENTS + Math.max(0, safeLevel - 1);
};

export const normalizeHealthSegments = (value, level = 1) => {
  const maxSegments = getMaxHealthSegments(level);
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return maxSegments;
  }
  if (numeric > maxSegments) {
    if (numeric <= 100) {
      return Math.max(0, Math.min(maxSegments, Math.round((numeric / 100) * maxSegments)));
    }
    return maxSegments;
  }
  return Math.max(0, Math.min(maxSegments, Math.round(numeric)));
};

export const clampHealthSegments = (value, level = 1) => {
  const maxSegments = getMaxHealthSegments(level);
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return Math.max(0, Math.min(maxSegments, Math.round(numeric)));
};

export const convertPointsToSegments = (points, { minimum = 1 } = {}) => {
  const numeric = Number(points);
  if (!Number.isFinite(numeric)) {
    return minimum;
  }
  return Math.max(minimum, Math.round(numeric / HEALTH_SEGMENT_VALUE));
};

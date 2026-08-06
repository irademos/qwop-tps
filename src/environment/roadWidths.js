export const ROAD_WIDTHS = {
  footway: 0.4,
  path: 0.5,
  cycleway: 0.6,
  steps: 0.35,
  track: 0.7,
  service: 0.9,
  residential: 1.2,
  living_street: 1.1,
  unclassified: 1.1,
  tertiary: 1.5,
  secondary: 2.0,
  primary: 2.6,
  trunk: 3.0,
  motorway: 3.4
};

export const DEFAULT_ROAD_WIDTH = 1.0;
export const ROAD_WIDTH_SCALE = 10;

export function resolveRoadWidth(highway, { scale = ROAD_WIDTH_SCALE } = {}) {
  if (typeof highway !== 'string') return DEFAULT_ROAD_WIDTH * scale;
  const baseWidth = ROAD_WIDTHS[highway] ?? DEFAULT_ROAD_WIDTH;
  return baseWidth * scale;
}

const climbableAreasBySource = new Map();

const mergeClimbableAreas = () => {
  const merged = [];
  for (const areas of climbableAreasBySource.values()) {
    if (Array.isArray(areas)) merged.push(...areas);
  }
  return merged;
};

export const setClimbableAreas = (source, areas = []) => {
  climbableAreasBySource.set(source, areas);
  if (typeof window !== 'undefined') {
    window.climbableAreas = mergeClimbableAreas();
  }
};

export const clearClimbableAreas = (source) => {
  climbableAreasBySource.delete(source);
  if (typeof window !== 'undefined') {
    window.climbableAreas = mergeClimbableAreas();
  }
};

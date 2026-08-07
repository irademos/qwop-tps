const createStateBucket = () => Object.create(null);

export const appContext = {
  entities: createStateBucket(),
  systems: createStateBucket(),
  uiState: createStateBucket(),
  settings: createStateBucket(),
  debugFlags: createStateBucket()
};

export function setContextValue(bucket, key, value) {
  if (!appContext[bucket]) {
    throw new Error(`Unknown appContext bucket: ${bucket}`);
  }
  appContext[bucket][key] = value;
  return value;
}

export function getContextValue(bucket, key, fallback = undefined) {
  if (!appContext[bucket]) {
    return fallback;
  }
  return appContext[bucket][key] ?? fallback;
}

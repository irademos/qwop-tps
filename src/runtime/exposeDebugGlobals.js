import { appContext } from './appContext.js';

const MIRROR_CONFIG = {
  monsters: { bucket: 'entities', getter: () => appContext.entities.monsters },
  animals: { bucket: 'entities', getter: () => appContext.entities.animals },
  otherPlayers: { bucket: 'entities', getter: () => appContext.entities.otherPlayers },
  playerControls: { bucket: 'systems', getter: () => appContext.systems.playerControls },
  weapons: { bucket: 'entities', getter: () => appContext.entities.weapons },
  appState: { bucket: 'uiState', getter: () => appContext.uiState.appState },
  PERF: { bucket: 'debugFlags', getter: () => appContext.debugFlags.PERF },
  mapRenderer: { bucket: 'systems', getter: () => appContext.systems.mapRenderer },
  buildingsRenderer: { bucket: 'systems', getter: () => appContext.systems.buildingsRenderer },
  rapierWorld: { bucket: 'systems', getter: () => appContext.systems.rapierWorld },
  rbToMesh: { bucket: 'systems', getter: () => appContext.systems.rbToMesh }
};

const COMPAT_KEYS = ['monsters', 'animals', 'otherPlayers', 'playerControls', 'weapons', 'appState'];
const DEBUG_KEYS = ['PERF', 'mapRenderer', 'buildingsRenderer', 'rapierWorld', 'rbToMesh'];
const defined = new Set();

function defineMirroredProperty(target, key) {
  if (defined.has(key)) return;
  const config = MIRROR_CONFIG[key];
  if (!config) return;
  Object.defineProperty(target, key, {
    configurable: true,
    enumerable: false,
    get: config.getter,
    set(value) {
      appContext[config.bucket][key] = value;
    }
  });
  defined.add(key);
}

export function exposeDebugGlobals({ enableDebugMirror = false, enableCompatibilityShims = true } = {}) {
  if (typeof window === 'undefined') return;

  if (enableCompatibilityShims) {
    for (const key of COMPAT_KEYS) defineMirroredProperty(window, key);
  }

  if (!enableDebugMirror) return;
  for (const key of DEBUG_KEYS) defineMirroredProperty(window, key);
}

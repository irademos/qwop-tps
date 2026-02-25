import { appContext, defineCompatibilityGlobal } from './appContext.js';

export function exposeDebugGlobals({ enabled = false } = {}) {
  appContext.debugFlags.exposeGlobals = Boolean(enabled);
  if (!appContext.debugFlags.exposeGlobals || typeof window === 'undefined') {
    return;
  }

  const globals = {
    monsters: {
      get: () => appContext.entities.monsters,
      set: (value) => { appContext.entities.monsters = Array.isArray(value) ? value : []; }
    },
    playerControls: {
      get: () => appContext.entities.playerControls,
      set: (value) => { appContext.entities.playerControls = value; }
    },
    weapons: {
      get: () => appContext.entities.weapons,
      set: (value) => { appContext.entities.weapons = value || {}; }
    },
    appState: {
      get: () => appContext.systems.appState,
      set: (value) => { appContext.systems.appState = value; }
    }
  };

  Object.entries(globals).forEach(([name, descriptor]) => {
    defineCompatibilityGlobal(name, descriptor);
  });
}

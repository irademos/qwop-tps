export const appContext = {
  entities: {
    monsters: [],
    animals: [],
    friendlies: [],
    weapons: {},
    pickups: {
      mushrooms: [],
      apples: [],
      wood: [],
      meat: [],
      salt: []
    },
    playerModel: null,
    playerControls: null,
    questManager: null,
    rapierWorld: null,
    rbToMesh: null,
    localHealth: null
  },
  systems: {
    appState: null,
    openHomeStorage: null,
    inventory: {
      getInventory: null,
      addToInventory: null,
      removeFromInventory: null
    },
    crafting: {
      openCraftPanel: null,
      craftTableActions: null
    },
    pickups: {
      pickupMushroom: null,
      pickupApple: null,
      pickupWood: null,
      pickupMeat: null,
      pickupSalt: null
    },
    callbacks: {
      getPlayerStrength: null,
      onMonsterKill: null,
      onPlayerKill: null,
      onPlayerDeath: null
    }
  },
  uiState: {
    latestLocation: null
  },
  settings: {
    perf: null,
    debugConsole: false
  },
  debugFlags: {
    exposeGlobals: false
  }
};

export function defineCompatibilityGlobal(name, { get, set }) {
  if (typeof window === 'undefined') return;
  const descriptor = Object.getOwnPropertyDescriptor(window, name);
  if (descriptor && !descriptor.configurable) return;
  Object.defineProperty(window, name, {
    configurable: true,
    enumerable: true,
    get,
    set
  });
}

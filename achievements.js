const DEFAULT_TRACKERS = {
  questsCompleted: 0,
  treesClimbed: 0,
  animalsKilled: 0,
  zombiesKilled: 0,
  monstersKilled: 0,
  golemsKilled: 0,
  mushroomsCollected: 0,
  weaponsCollected: 0,
  bowShots: 0,
  rocksBlownUp: 0,
  bombsThrown: 0
};

export const ACHIEVEMENTS = [
  { id: 'quest_1', title: 'First Steps', description: 'Complete 1 quest.', metric: 'questsCompleted', target: 1, xp: 50, rewards: { coins: 15 } },
  { id: 'quest_5', title: 'Questing Apprentice', description: 'Complete 5 quests.', metric: 'questsCompleted', target: 5, xp: 120, rewards: { coins: 35, mushroom_amanita: 1 } },
  { id: 'quest_10', title: 'Questing Adept', description: 'Complete 10 quests.', metric: 'questsCompleted', target: 10, xp: 220, rewards: { coins: 80, bomb: 1 } },
  { id: 'quest_20', title: 'Questing Expert', description: 'Complete 20 quests.', metric: 'questsCompleted', target: 20, xp: 360, rewards: { coins: 160, bow: 1 } },
  { id: 'quest_50', title: 'Questing Legend', description: 'Complete 50 quests.', metric: 'questsCompleted', target: 50, xp: 700, rewards: { coins: 420, autumnSword: 1 } },
  { id: 'climb_tree', title: 'Tree Hugger', description: 'Climb a tree once.', metric: 'treesClimbed', target: 1, xp: 40, rewards: { coins: 10 } },
  { id: 'animal_1', title: 'Hunter Initiate', description: 'Kill 1 animal.', metric: 'animalsKilled', target: 1, xp: 45, rewards: { meat: 1 } },
  { id: 'animal_5', title: 'Hunter', description: 'Kill 5 animals.', metric: 'animalsKilled', target: 5, xp: 130, rewards: { meat: 3, coins: 20 } },
  { id: 'zombie_1', title: 'Zombie Down', description: 'Kill 1 zombie.', metric: 'zombiesKilled', target: 1, xp: 70, rewards: { coins: 18 } },
  { id: 'zombie_5', title: 'Zombie Exterminator', description: 'Kill 5 zombies.', metric: 'zombiesKilled', target: 5, xp: 180, rewards: { coins: 70, bomb: 1 } },
  { id: 'monster_1', title: 'Monster Slayer', description: 'Kill 1 monster.', metric: 'monstersKilled', target: 1, xp: 75, rewards: { coins: 20 } },
  { id: 'golem_1', title: 'Rock Breaker', description: 'Kill a golem monster.', metric: 'golemsKilled', target: 1, xp: 240, rewards: { coins: 120, autumnSword: 1 } },
  { id: 'mushroom_1', title: 'Forager', description: 'Collect a mushroom.', metric: 'mushroomsCollected', target: 1, xp: 35, rewards: { mushroom_amanita: 1 } },
  { id: 'weapon_1', title: 'Armed and Ready', description: 'Collect a weapon.', metric: 'weaponsCollected', target: 1, xp: 60, rewards: { coins: 25 } },
  { id: 'bow_shot_1', title: 'Bullseye Practice', description: 'Fire a bow and arrow.', metric: 'bowShots', target: 1, xp: 45, rewards: { coins: 12, bow: 1 } },
  { id: 'bomb_throw_1', title: 'Bombs Away', description: 'Throw a bomb.', metric: 'bombsThrown', target: 1, xp: 55, rewards: { coins: 15 } },
  { id: 'rock_boom_1', title: 'Pebble Pulverizer', description: 'Blow up a rock.', metric: 'rocksBlownUp', target: 1, xp: 95, rewards: { salt: 2, coins: 30 } }
];

const byId = new Map(ACHIEVEMENTS.map((achievement) => [achievement.id, achievement]));

export function mergeAchievementState(inputState) {
  const trackers = { ...DEFAULT_TRACKERS, ...(inputState?.trackers || {}) };
  const achievements = {};
  for (const definition of ACHIEVEMENTS) {
    const raw = inputState?.achievements?.[definition.id] || {};
    achievements[definition.id] = {
      unlockedAt: Number.isFinite(raw.unlockedAt) ? raw.unlockedAt : null,
      claimedAt: Number.isFinite(raw.claimedAt) ? raw.claimedAt : null,
      pendingClaim: raw.pendingClaim === true
    };
  }
  return { trackers, achievements };
}

export function recordAchievementProgress(state, metric, amount = 1) {
  if (!state || !metric || !Number.isFinite(amount) || amount <= 0) return [];
  if (!Object.prototype.hasOwnProperty.call(state.trackers, metric)) return [];
  state.trackers[metric] = Math.max(0, Math.floor((state.trackers[metric] || 0) + amount));
  const unlocked = [];
  for (const definition of ACHIEVEMENTS) {
    if (definition.metric !== metric) continue;
    const status = state.achievements[definition.id];
    if (!status || status.unlockedAt) continue;
    const value = state.trackers[metric] || 0;
    if (value >= definition.target) {
      status.unlockedAt = Date.now();
      status.pendingClaim = true;
      unlocked.push(definition);
    }
  }
  return unlocked;
}

export function getAchievementView(state) {
  if (!state) return [];
  return ACHIEVEMENTS.map((definition) => {
    const status = state.achievements[definition.id] || {};
    const progress = Math.min(definition.target, Math.max(0, state.trackers[definition.metric] || 0));
    return {
      ...definition,
      progress,
      unlockedAt: status.unlockedAt || null,
      claimedAt: status.claimedAt || null,
      pendingClaim: Boolean(status.pendingClaim)
    };
  });
}

export function claimAchievement(state, achievementId) {
  const definition = byId.get(achievementId);
  if (!definition || !state) return null;
  const status = state.achievements[achievementId];
  if (!status?.unlockedAt || !status.pendingClaim) return null;
  status.pendingClaim = false;
  status.claimedAt = Date.now();
  return { ...definition };
}

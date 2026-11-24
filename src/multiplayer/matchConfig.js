// The battle roster and arena spot — small constants the rest of the game needs (Showdown's
// characters, Endless, Town's bodies) without loading matchMode.js, which is only loaded
// when Multiplayer is picked (see _loadModeModules in bootstrapGameApp.js).
import { glbCharacterConfig } from '../models/glbCharacterModel.js';

export const MATCH_CHARACTERS = {
  villageBoy: { label: 'Village Boy', team: 'Village Boys', emoji: '👦', url: glbCharacterConfig.villageBoyUrl },
  // starter: unlocked from the start in Showdown (PS_START_CHARACTERS) and never a stage boss
  villageGirl: { label: 'Village Girl', team: 'Village Girls', emoji: '👧', url: glbCharacterConfig.villageGirlUrl, starter: true },
  antler: { label: 'Antler Guy', team: 'Antlers', emoji: '🦌', url: glbCharacterConfig.antlerGuyUrl },
  frog: { label: 'Frog Man', team: 'Frogs', emoji: '🐸', url: glbCharacterConfig.frogManUrl },
  gemhorn: { label: 'Gemhorn', team: 'Gemhorns', emoji: '💎', url: glbCharacterConfig.url },
  pumpkin: { label: 'Pumpkin', team: 'Pumpkins', emoji: '🎃', url: glbCharacterConfig.pumpkinUrl },
  wizard: { label: 'Wizard', team: 'Wizards', emoji: '🧙', url: glbCharacterConfig.wizardUrl },
  tree: { label: 'Tree Creature', team: 'Trees', emoji: '🌳', url: glbCharacterConfig.treeCreatureUrl },
  frogMom: { label: 'Frog Mom', team: 'Frog Moms', emoji: '🐸', url: glbCharacterConfig.frogMomUrl },
  oldGuy: { label: 'Old Guy', team: 'Old Guys', emoji: '👴', url: glbCharacterConfig.oldGuyUrl },
  panda: { label: 'Panda', team: 'Pandas', emoji: '🐼', url: glbCharacterConfig.pandaUrl },
  // story: not won from a Showdown boss — unlocked by the (future) story mode; locked
  // everywhere (Team Battle included) until then, and never given to bots
  villager: { label: 'Villager', team: 'Villagers', emoji: '🧑‍🌾', url: glbCharacterConfig.villagerUrl, story: true }
};

// Where battles happen (island town mappack; the same spot as duels — DUEL_LOCATION in
// duelMode.js). Fighters start around it; pickups and respawns spread wider (never in the
// sea). Paste Settings → Dev → Free Roam → "Copy location" here to move it.
export const ARENA_LOCATION = { x: -39.53, y: 0, z: -44.59, yaw: 0.84 };

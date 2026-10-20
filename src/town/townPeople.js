// Town mode: who lives in the town — roles, names, characters — and what they say.
// Pure data + helpers; the simulation is in townMode.js.

import { glbCharacterConfig } from '../models/glbCharacterModel.js';

export const TOWN_NAME = 'Brindlewick';

// hours: [start, end) on the town clock when the role works (end may pass midnight);
// hp: sword hits to beat them; brave: chance they fight back instead of running when hit;
// law: guards / the sheriff (they answer crimes and arrest); unhurt: a sword swing only scares them;
// outlaw: bandits (live at the camp outside town, raid at night, attack the player on sight —
// hurting them is no crime); gear: what they fight with (createBossFighter) — law gear grows
// with the stars (townMode fighterGear)
export const ROLES = {
  merchant:   { label: 'Merchant',   emoji: '🧺', work: 'market', hours: [7, 20], hp: 3, brave: 0.2 },
  guard:      { label: 'Guard',      emoji: '🛡️', work: 'patrol', hours: [6, 20], hp: 4, brave: 1, law: true },
  nightGuard: { label: 'Night Watch', emoji: '🏮', work: 'patrol', hours: [19, 7], hp: 4, brave: 1, law: true },
  sheriff:    { label: 'Sheriff',    emoji: '⭐', work: 'office', hours: [7, 21], hp: 6, brave: 1, law: true },
  woodcutter: { label: 'Woodcutter', emoji: '🪓', work: 'tree',   hours: [7, 17], hp: 3, brave: 0.6 },
  farmer:     { label: 'Farmer',     emoji: '🌾', work: 'field',  hours: [6, 17], hp: 3, brave: 0.35 },
  fisher:     { label: 'Fisher',     emoji: '🎣', work: 'shore',  hours: [5, 15], hp: 3, brave: 0.3 },
  townsfolk:  { label: 'Townsfolk',  emoji: '🏠', work: null,     hours: null,    hp: 2, brave: 0.15 },
  kid:        { label: 'Kid',        emoji: '🧒', work: null,     hours: null,    hp: 2, brave: 0, speed: 1.15, unhurt: true },
  drifter:    { label: 'Drifter',    emoji: '🍺', work: null,     hours: null,    hp: 3, brave: 0.5, nightOwl: true },
  bandit:     { label: 'Bandit',     emoji: '🗡️', work: null,     hours: null,    hp: 3, brave: 1, outlaw: true, nightOwl: true, bounty: 25 },
  banditBoss: { label: 'Bandit Chief', emoji: '💀', work: null,   hours: null,    hp: 6, brave: 1, outlaw: true, nightOwl: true, bounty: 60, gear: { gun: true } },
};
// The bandit camp's gang (outside the town's roster — they come back after a while)
export const BANDIT_ROLES = ['banditBoss', 'bandit', 'bandit', 'bandit'];

// Who lives here when the town is first founded (the roster is then saved; the dead are
// replaced by newcomers of the same role)
export const FOUNDING_ROLES = [
  'merchant', 'guard', 'nightGuard', 'sheriff',
  'woodcutter', 'woodcutter', 'farmer', 'farmer', 'farmer', 'fisher', 'fisher',
  'townsfolk', 'townsfolk', 'townsfolk', 'townsfolk', 'townsfolk',
  'kid', 'kid', 'drifter', 'townsfolk',
];

const CIVILIAN_URLS = [
  glbCharacterConfig.villagerUrl,
  glbCharacterConfig.pumpkinUrl,
  glbCharacterConfig.treeCreatureUrl,
  glbCharacterConfig.frogManUrl,
  glbCharacterConfig.wizardUrl,
  glbCharacterConfig.villageBoyUrl,
];
export const characterForRole = (role) => {
  if (role === 'guard' || role === 'nightGuard') return glbCharacterConfig.antlerGuyUrl;
  if (role === 'sheriff') return glbCharacterConfig.url; // gemhorn
  if (role === 'merchant') return glbCharacterConfig.wizardUrl;
  if (role === 'kid') return glbCharacterConfig.villageBoyUrl;
  if (role === 'bandit') return glbCharacterConfig.frogManUrl;
  if (role === 'banditBoss') return glbCharacterConfig.treeCreatureUrl;
  return CIVILIAN_URLS[Math.floor(Math.random() * CIVILIAN_URLS.length)];
};

const FIRST_NAMES = [
  'Mabel', 'Tobias', 'Wren', 'Hollis', 'Agnes', 'Barnaby', 'Clover', 'Dorian', 'Edda', 'Fenwick',
  'Gilda', 'Hugo', 'Ivy', 'Jasper', 'Kit', 'Linnea', 'Morris', 'Nell', 'Otto', 'Pip',
  'Quill', 'Rosalind', 'Silas', 'Tilda', 'Ulric', 'Vera', 'Wendell', 'Yara', 'Zeb', 'Bram',
  'Cora', 'Dunstan', 'Elsie', 'Fitz', 'Greta', 'Hamish', 'Iona', 'Jory', 'Lark', 'Marigold',
];
const TITLE_FOR_ROLE = { guard: 'Guard', nightGuard: 'Watchman', sheriff: 'Sheriff', banditBoss: 'Chief' };
const BANDIT_NAMES = ['Grub', 'Snag', 'Rotfang', 'Mudge', 'Scab', 'Knuckles', 'Slink', 'Bogwart', 'Gristle', 'Twitch'];
export const randomName = (role, taken = new Set()) => {
  const names = role === 'bandit' || role === 'banditBoss' ? BANDIT_NAMES : FIRST_NAMES;
  const free = names.filter((n) => !taken.has(n));
  const pool = free.length ? free : names;
  const first = pool[Math.floor(Math.random() * pool.length)];
  return TITLE_FOR_ROLE[role] ? `${TITLE_FOR_ROLE[role]} ${first}` : first;
};
// (the first name, for "taken" checks and gossip)
export const firstName = (name) => name.split(' ').pop();

const pick = (list) => list[Math.floor(Math.random() * list.length)];

// What they're up to, said when the player talks to them (by task / role)
const TASK_LINES = {
  work: {
    merchant: ['Fresh bread, fresh fish — two coins a loaf!', 'Business is slow today.', 'Mind the counter, it wobbles.'],
    guard: ['Keep your sword sheathed in town.', 'All quiet on my watch.', 'Move along, citizen.'],
    nightGuard: ['Strange folk about after dark.', 'Keep to the lamplight.', 'Nothing gets past the watch.'],
    sheriff: ['Brindlewick has laws. I keep them.', 'Cells are empty. Let\'s keep it that way.', 'Don\'t make me write you up.'],
    woodcutter: ['This old oak won\'t chop itself.', 'Mind your toes — timber!', 'Best wood on the island, this.'],
    farmer: ['The carrots are coming along.', 'Rain soon, I can smell it.', 'Long rows today.'],
    fisher: ['Fish are biting.', 'Shh — you\'ll scare them off.', 'Caught a big one this morning. Honest.'],
  },
  eat: ['Off to the market, I\'m starving.', 'Smells like fresh bread!', 'Just grabbing a bite.'],
  social: ['Nothing like a warm fire.', 'Pull up a log, friend.', 'Heard any good stories lately?'],
  sleep: ['Yawn… off to bed.', 'Long day. Goodnight.'],
  wander: ['Lovely day for a stroll.', 'Just stretching my legs.', 'Have you seen the ship off the coast?'],
  kid: ['Tag! You\'re it!', 'I\'m gonna be a guard when I grow up!', 'Mum says I can\'t talk to strangers.'],
  drifter: ['Got a coin to spare?', 'The fire\'s the only friend I need.', 'Hic. Lovely evening.'],
};
const FRIEND_LINES = ['Good to see you, {name}!', 'Ah, {name}! My favourite person in town.', 'Anything I can do for you, {name}?'];
const COLD_LINES = ['Hmph. What do you want?', 'I\'m watching you.', 'Make it quick.'];
const SCARED_LINES = ['Stay away from me!', 'Please, don\'t hurt me!', 'Guards! Guards!'];
const GIFT_LINES = ['For me? You\'re too kind!', 'Bless you, {name}!', 'I won\'t forget this.'];
const GIFT_BROKE = ['You\'re as broke as I am.'];

// A line for the player talking to `npc` (attitude −1..1: how they feel about the player).
// market: { scarce: { label, emoji, price } | null, foodOut, merchantGone } (townMode marketTalk)
export function talkLine(npc, { playerName = 'friend', taskType = null, market = null } = {}) {
  const fill = (s) => s.replace(/\{name\}/g, playerName);
  if (npc.fear > 0) return pick(SCARED_LINES);
  if (npc.attitude < -0.35) return pick(COLD_LINES);
  if (npc.attitude > 0.55 && Math.random() < 0.5) return fill(pick(FRIEND_LINES));
  // How the market's doing
  if (npc.role === 'merchant' && market?.scarce && Math.random() < 0.6) {
    return `${market.scarce.emoji} ${market.scarce.label} is scarce — ${market.scarce.price} coins a piece!`;
  }
  if (npc.needs.hunger > 0.6 && market?.foodOut) return 'The market\'s out of food… I\'m starving.';
  if (market?.merchantGone && Math.random() < 0.4) return 'With the merchant gone, where do we buy bread?';
  if (npc.role === 'merchant' && Math.random() < 0.3) return 'I buy wood, fish and veg — bring me some!';
  if (npc.role === 'kid') return pick(TASK_LINES.kid);
  if (npc.role === 'drifter' && Math.random() < 0.6) return pick(TASK_LINES.drifter);
  if (npc.needs.hunger > 0.75) return 'I could eat a whole pumpkin. Market\'s calling.';
  if (npc.needs.energy < 0.2) return 'I can barely keep my eyes open…';
  const t = taskType ?? 'wander';
  if (t === 'work') return pick(TASK_LINES.work[npc.role] ?? TASK_LINES.wander);
  return pick(TASK_LINES[t] ?? TASK_LINES.wander);
}
export const giftLine = (npc, playerName, broke = false) =>
  (broke ? pick(GIFT_BROKE) : pick(GIFT_LINES).replace(/\{name\}/g, playerName));

// Small talk between two townsfolk; gossip about recent events comes first
// (gossip: [{ kind: 'murder' | 'assault' | 'arrest' | 'newcomer', who, by, at }])
const SMALL_TALK = [
  ['Lovely weather.', 'Can\'t complain.'],
  ['Prices at the market, eh?', 'Robbery, I tell you.'],
  ['Did you see the ship?', 'Pirates, mark my words.'],
  ['How\'s the family?', 'Growing like weeds!'],
  ['Heard the sheriff snoring at noon.', 'Ha! Don\'t let him hear you.'],
  ['Fish or bread tonight?', 'Why not both?'],
];
export function chatLines(gossip, playerName) {
  const recent = gossip.filter((g) => g.fresh);
  const g = recent.length && Math.random() < 0.7 ? recent[recent.length - 1] : null;
  if (g?.kind === 'murder') return [`Did you hear? Poor ${g.who}…`, g.by === 'player' ? `They say ${playerName} did it!` : 'Terrible business.'];
  if (g?.kind === 'assault') return [`${playerName} attacked ${g.who}!`, 'In broad daylight?!'];
  if (g?.kind === 'arrest') return [`The sheriff locked up ${playerName}.`, 'About time.'];
  if (g?.kind === 'theft') return [`${playerName} was nicking veg${g.who ? ` from ${g.who}'s field` : ''}!`, 'Lock up your carrots.'];
  if (g?.kind === 'newcomer') return [`Have you met ${g.who}? New in town.`, 'Seems nice enough.'];
  return pick(SMALL_TALK);
}

// Shouts
export const SHOUT_HURT = ['Ow!', 'Hey!', 'Stop that!', 'Ouch!'];
export const SHOUT_HELP = ['Help! Guards!', 'Somebody help!', 'Guards!'];
export const SHOUT_MURDER = ['Murder!', 'Guards! Murder!', 'No!!'];
export const SHOUT_THIEF = ['Thief!', 'Stop, thief!', 'Guards! A thief!'];
export const SHOUT_FIGHT = ['You want a fight?!', 'That\'s it!', 'Come here!'];
export const SHOUT_LAW = ['Stop right there!', 'In the name of the law!', 'Halt, criminal!'];
export const SHOUT_EAT_BUY = ['One loaf, please.', 'The usual!', 'Two fish, thanks.'];
export const shout = (list) => pick(list);

// ── Phase 3 reactions ──
export const SHOUT_RALLY = ['Leave {who} alone!', 'Hands off {who}!', 'You\'ll pay for that!'];
export const SHOUT_VENDETTA = ['You killed my {rel}!', 'For my {rel}!', 'Murderer!'];
export const SHOUT_STAY_BACK = ['Stay back!', 'Don\'t come near me.', 'I\'m watching you…'];
export const SHOUT_MUG = ['Your purse. Now.', 'Hand it over!', 'Coins or else.'];
export const SHOUT_ARREST = ['You\'re under arrest!', 'Come quietly!', 'That\'s enough!'];
export const SHOUT_BANDIT = ['You were warned!', 'Get \'em!', 'Cut them down!'];
// The gang at its camp: a warning, a last warning, robbing someone with no weapon, and seeing
// them off
export const SHOUT_CAMP_WARN = ['Oi! This is our camp. Turn around.', 'Bandit ground, stranger. Keep walking.', 'Nothing here for you. Go back the way you came.'];
// (swords out, up close: what happens if they stay — armed: a fight, unarmed: a robbery)
export const SHOUT_CAMP_DRAW_ARMED = ['Swords out, lads! You walk into our camp with a blade, stranger? Leave now or we fight.', 'This is our camp. Walk away — or we cut you down.'];
export const SHOUT_CAMP_DRAW_UNARMED = ['This is our camp. Stay and we empty your pockets. Walk away!', 'No blade? Then leave now — or leave lighter.'];
export const SHOUT_CAMP_COUNT = ['{s} seconds. Walk away.', 'Still here? {s} seconds.', 'I\'m counting… {s}.'];
export const SHOUT_CAMP_LAST = ['Last warning!', 'Are you deaf? Get out of here!', 'One more moment and that\'s it!'];
export const SHOUT_CAMP_ROB = ['No blade? Then your purse. Now get lost!', 'Empty hands, full pockets. We\'ll take those.'];
export const SHOUT_CAMP_SPARE = ['Not even worth robbing. Go on, get out.', 'Nothing on you? Then get lost.'];
export const SHOUT_CAMP_LEAVE = ['And stay out!', 'Don\'t come back!', 'Run, then!'];
export const SHOUT_THANKS = ['Thank you, {name}!', 'You saved me!', 'My hero!'];
export const FOLLOW_LINES = {
  join: ['Lead the way, {name}!', 'Right behind you.', 'Let\'s go!'],
  leave: ['I\'ll head home then.', 'See you around, {name}.'],
  late: ['It\'s late — I\'m off to bed.'],
  wanted: ['I\'m not fighting the guards! You\'re on your own.'],
};
// A family member, by role (for the vendetta shout)
export const relationOf = (role) => (role === 'kid' ? 'child' : pick(['sister', 'brother', 'cousin', 'friend']));
export const fillLine = (text, vars) => text.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');

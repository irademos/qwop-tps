// Town mode: who lives in the town — roles, names, characters — and what they say.
// Pure data + helpers; the simulation is in townMode.js.

import { glbCharacterConfig } from '../models/glbCharacterModel.js';

export const TOWN_NAME = 'Brindlewick';

// hours: [start, end) on the town clock when the role works (end may pass midnight);
// hp: sword hits to beat them; brave: chance they fight back instead of running when hit;
// law: guards / the sheriff (they answer crimes and arrest); unhurt: a sword swing only scares them;
// outlaw: bandits (live at the camp outside town, raid at night, attack the player on sight —
// hurting them is no crime); hermit: lives out of town in a place of their own (the wizard, by
// his stall in the woods) — no town house; gear: what they fight with (createBossFighter) — law gear grows
// with the stars (townMode fighterGear)
export const ROLES = {
  merchant:   { label: 'Merchant',   emoji: '🧺', work: 'market', hours: [7, 20], hp: 3, brave: 0.2 },
  guard:      { label: 'Guard',      emoji: '🛡️', work: 'patrol', hours: [6, 20], hp: 4, brave: 1, law: true },
  nightGuard: { label: 'Night Watch', emoji: '🏮', work: 'patrol', hours: [19, 7], hp: 4, brave: 1, law: true },
  sheriff:    { label: 'Sheriff',    emoji: '⭐', work: 'office', hours: [7, 21], hp: 6, brave: 1, law: true },
  woodcutter: { label: 'Woodcutter', emoji: '🪓', work: 'tree',   hours: [7, 17], hp: 3, brave: 0.6 },
  farmer:     { label: 'Farmer',     emoji: '🌾', work: 'field',  hours: [6, 17], hp: 3, brave: 0.35 },
  fisher:     { label: 'Fisher',     emoji: '🎣', work: 'shore',  hours: [5, 15], hp: 3, brave: 0.3 },
  wizard:     { label: 'Wizard',     emoji: '🧙', work: 'wizard', hours: [8, 21], hp: 4, brave: 0.5, hermit: true },
  townsfolk:  { label: 'Townsfolk',  emoji: '🏠', work: null,     hours: null,    hp: 2, brave: 0.15 },
  kid:        { label: 'Kid',        emoji: '🧒', work: null,     hours: null,    hp: 2, brave: 0, speed: 1.15, unhurt: true },
  drifter:    { label: 'Drifter',    emoji: '🍺', work: null,     hours: null,    hp: 3, brave: 0.5, nightOwl: true },
  bandit:     { label: 'Bandit',     emoji: '🗡️', work: null,     hours: null,    hp: 3, brave: 1, outlaw: true, nightOwl: true, bounty: 25 },
  banditBoss: { label: 'Bandit Chief', emoji: '💀', work: null,   hours: null,    hp: 6, brave: 1, outlaw: true, nightOwl: true, bounty: 60, gear: { gun: true } },
};
// The bandit camp's gang (outside the town's roster — they come back after a while)
export const BANDIT_ROLES = ['banditBoss', 'bandit', 'bandit', 'bandit'];
// Out of town (the bandits, the wizard): no house of the town's (townHomes.js)
export const livesOut = (def) => !!(def?.outlaw || def?.hermit);

// Who lives here when the town is first founded, in the order the town needs them: one to a
// house, so a town with fewer free houses takes the first ones, and a player moving into a full
// town (townHomes.js) pushes out the last (never the first MIN_TOWNSFOLK). The roster is then
// saved; the dead are replaced by newcomers of the same role when there's a house free.
export const FOUNDING_ROLES = [
  'merchant', 'sheriff', 'guard', 'farmer', 'woodcutter', 'fisher',
  'nightGuard', 'farmer', 'fisher', 'kid', 'townsfolk', 'woodcutter',
  'drifter', 'farmer', 'townsfolk', 'kid', 'townsfolk', 'fisher', 'townsfolk', 'townsfolk',
];
const CIVILIAN_URLS = [
  glbCharacterConfig.villagerUrl,
  glbCharacterConfig.pumpkinUrl,
  glbCharacterConfig.treeCreatureUrl,
  glbCharacterConfig.frogManUrl,
  glbCharacterConfig.villageBoyUrl,
  glbCharacterConfig.villageGirlUrl,
];
export const characterForRole = (role) => {
  if (role === 'guard' || role === 'nightGuard') return glbCharacterConfig.antlerGuyUrl;
  if (role === 'sheriff') return glbCharacterConfig.url; // gemhorn
  if (role === 'merchant') return glbCharacterConfig.pumpkinUrl;
  if (role === 'wizard') return glbCharacterConfig.wizardUrl;
  if (role === 'kid') return Math.random() < 0.5 ? glbCharacterConfig.villageBoyUrl : glbCharacterConfig.villageGirlUrl;
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

// ── Who they are, by body: each kind of townsperson has their own way of talking (and their own
// accent — townMode.js voiceFamily). 'folk' = the plain people (villager / village boy / girl),
// who live next door to a talking pumpkin and have opinions about it. ──
export const speciesOf = (n) => {
  const url = n?.url;
  if (url === glbCharacterConfig.pumpkinUrl) return 'pumpkin';
  if (url === glbCharacterConfig.treeCreatureUrl) return 'tree';
  if (url === glbCharacterConfig.frogManUrl) return 'frog';
  if (url === glbCharacterConfig.antlerGuyUrl) return 'antler';
  if (url === glbCharacterConfig.url) return 'gem';
  if (url === glbCharacterConfig.wizardUrl) return 'wizard';
  return 'folk';
};

// What they're up to, said when the player talks to them (by task / role) — anyone's
const TASK_LINES = {
  work: {
    merchant: [
      'Wood, fish, veg. I buy it, I sell it, I pretend the difference is "overheads".',
      'Everything\'s on sale. Not cheaper, mind. Just on sale.',
      'Don\'t lean on the counter. It\'s held together by optimism.',
      'If it\'s not nailed down, it\'s for sale. If it is nailed down, make me an offer.',
    ],
    guard: [
      'Sword stays in the sheath in town. The sheath has feelings too.',
      'All quiet. Suspiciously quiet. I\'m writing that down.',
      'Move along. Not that way. Or that way. Actually just stand there.',
      'I\'ve been guarding this exact patch of road for six years. It\'s never been stolen.',
    ],
    nightGuard: [
      'Night shift. Me, the lamp, and whatever\'s rustling in that bush.',
      'Stay in the lamplight. The dark here has a criminal record.',
      'I don\'t sleep, I just blink very slowly.',
    ],
    sheriff: [
      'Brindlewick has three laws. Don\'t steal, don\'t stab, don\'t make me do paperwork.',
      'The cells are empty. I\'d like to keep them dusty.',
      'I\'ve got my eye on you. The other eye\'s on lunch.',
    ],
    woodcutter: [
      'Measure twice, chop once. Then chop about forty more times, it\'s a big tree.',
      'Timber! Sorry, habit. Nothing\'s falling. Yet.',
      'Best wood on the island. I\'d know, I\'ve hit all of it.',
    ],
    farmer: [
      'Carrots are coming along. Slowly. Like everything that\'s worth anything.',
      'Rain\'s coming. My knee says so, and my knee\'s never wrong about weather. Only about stairs.',
      'Fancy a field of your own? A hundred coins. Dirt included, free of charge.',
      'You plant a seed, you wait, you worry, you get a carrot. Farming\'s just parenting with soil.',
    ],
    wizard: [
      'Potions! Wands! Brooms! Refunds are not a kind of magic I practise.',
      'The trees whisper prices to me. They\'ve got expensive taste.',
      'Careful with the wand. It\'s a bit bitey before its morning tea.',
    ],
    fisher: [
      'Shh. Fish can hear you. They can\'t understand you, but they judge the tone.',
      'Caught one this big this morning. Then it got bigger on the way home.',
      'Fishing\'s easy. It\'s the catching that\'s hard.',
    ],
  },
  eat: ['Off to the market before my stomach files a complaint.', 'I can smell the bread from here. It\'s calling my name. My name\'s not even bread.', 'Just grabbing a bite. Or several. Who\'s counting.'],
  social: ['Nothing like a warm fire and somebody else\'s gossip.', 'Pull up a log. The comfy one\'s taken, it\'s always taken.', 'Got a story? Doesn\'t have to be true. Better if it isn\'t.'],
  sleep: ['Bed. Now. Goodnight. Go away. Lovingly.', 'Long day. My pillow and I have a standing appointment.'],
  browse: ['Just looking. Just looking very hard at things I can\'t afford.', 'Fine blade, that. Costs more than my house. Probably sharper too.', 'Seeds! I could grow my own veg. Or I could buy veg and keep my weekends.'],
  wander: ['Just walking. Thinking. Mostly walking.', 'Have you seen the ship off the coast? Nobody ever gets off it. Rude, if you ask me.', 'Nice day for it. For what? Don\'t know. It, generally.'],
  kid: ['Tag! You\'re it! No backsies!', 'When I grow up I\'m gonna be a guard. Or a frog. Haven\'t decided.', 'Mum says I can\'t talk to strangers. You\'re a bit strange. Bye!', 'Wanna see a rock? This is a rock. You can\'t have it.', 'I\'m not lost, I\'m exploring. There\'s a difference. Mum says there isn\'t.'],
  drifter: [
    'Spare a coin? I\'ll spend it wisely. On something unwise.',
    'They call me a drifter. I prefer "freelance resident".',
    'The fire\'s the only friend who never asks me for money back.',
    'Hic. Lovely evening. Is it evening? It\'s evening somewhere.',
  ],
};
const HUNGRY_LINES = ['I\'m so hungry I\'d eat the menu. We don\'t have a menu. I\'d eat the market.', 'My stomach just growled at a guard. We\'re both in trouble now.'];
const TIRED_LINES = ['I can barely keep my eyes open. One\'s already gone home.', 'If I yawn any wider I\'ll swallow the moon.'];
const FRIEND_LINES = ['{name}! My favourite person who isn\'t a sandwich.', 'Ah, {name}. The town\'s nicer when you\'re about.', 'Anything I can do for you, {name}? Within reason. Wide reason.'];
const COLD_LINES = ['Oh. It\'s you.', 'I\'m watching you. Both eyes. Even the lazy one.', 'Make it quick. I\'ve got a wall to stare at.'];
const SCARED_LINES = ['Stay away from me!', 'Please, I\'ve got a family! And a cat! The cat doesn\'t like me but still!', 'Guards! GUARDS!'];
const GIFT_LINES = ['For me? You shouldn\'t have. But you did, so, thank you.', 'Bless you, {name}. I\'ll spend it on something sensible. Probably cake.', 'I won\'t forget this. I forget most things, so that\'s saying something.'];
const GIFT_BROKE = ['That\'s a kind thought. A free one, I notice.', 'Your pockets are emptier than mine. And mine have moths.'];

// Each kind's own lines — used about half the time, the rest from the shared ones above.
// work: by role (any role missing → `any`); the other keys match the shared lines; `chat` =
// small-talk pairs between two townsfolk (the first speaker's kind); shouts are in SPECIES_SHOUTS.
const SPECIES_LINES = {
  pumpkin: {
    work: {
      merchant: [
        'Welcome! Everything\'s locally grown. Some of it is my cousin. Kidding. Mostly.',
        'Fresh veg! No pumpkins though. I don\'t stock family.',
        'I\'ve got a good head for business. Hollow, but good.',
        'Prices are seasonal. And it is always my season.',
      ],
      farmer: [
        'I grow carrots, mostly. Growing pumpkins felt a bit like running an orphanage.',
        'I\'m outstanding in my field. I\'m also a pumpkin standing in a field. Same thing, really.',
      ],
      any: ['Back to work. These vines won\'t untangle themselves. Well, they could. They just won\'t.'],
    },
    any: [
      'I\'ve got deep roots in this town. Literally. Took ages to pull them up.',
      'People ask why I\'m always smiling. It was carved that way, mate. I don\'t get a say.',
      'Don\'t say the word "pie" near me. I\'m not joking. I\'m a pumpkin and I\'m not joking.',
      'Every autumn folk start looking at me funny. Measuring. Holding knives. I lock my door in October.',
      'I\'m not thick-skinned. I\'m just a gourd. There\'s a difference and it\'s mostly legal.',
      'Some say I\'m hollow inside. They\'re right, but it\'s rude to say so.',
      'Me mum always said: grow where you\'re planted. Then a farmer moved her. Didn\'t like that saying after.',
    ],
    hungry: [
      'I\'m starving. I\'d eat a whole... carrot. That\'s what I was going to say. A carrot.',
      'Hungry enough to eat a pumpkin. I mean that as a figure of speech. A very upsetting figure of speech.',
    ],
    tired: ['I\'m knackered. Running on seeds and spite.', 'Need a lie down. I go soft if I don\'t sleep. Then mouldy. Then compost. It escalates.'],
    eat: ['Off to eat. Soup, probably. Not that soup. Never that soup.'],
    social: ['Lovely fire. I sit at a respectful distance. Roasting is a career-ending move.', 'I love a campfire. From a distance. A good, long distance.'],
    sleep: ['Bedtime. I sleep with one candle out. Long story.'],
    wander: ['Just rolling about. Not literally. That was one time, on a hill.', 'Out for a stroll. Gourd for the heart, they say. Nobody says that. I say that.'],
    friend: ['{name}! You\'re the pick of the patch, you are.', '{name}, you\'re a gem. A squash. A real one. That\'s high praise where I\'m from.'],
    cold: ['Oh, it\'s you. My face is smiling. I\'m not.', 'Go on, then. I\'ve seen friendlier knives.'],
    scared: ['Not the face! It\'s the only one I\'ve got and it\'s already got holes in!', 'Get away! I bruise like a — well, like a pumpkin!'],
    gift: ['A gift? You\'ve got a heart of gold, {name}. Mine\'s mostly seeds.', 'You absolute sweet potato. Different family, same energy.'],
    chat: [
      ['Heard they\'re doing a pie contest this year.', 'I\'m leaving town. Don\'t follow me.'],
      ['How\'s the family?', 'Spread out over three fields and one very bad soup.'],
      ['You look tired.', 'I\'m a pumpkin. We always look like this after September.'],
    ],
  },
  tree: {
    work: {
      woodcutter: [
        'Yes, I\'m a tree. Yes, I\'m a woodcutter. We all have to make peace with something.',
        'I only chop the rude ones. You can tell by the bark.',
        'Every swing, I whisper an apology. The trees don\'t answer. Rude, frankly.',
      ],
      farmer: ['Farming is easy when you can photosynthesise on your lunch break.'],
      any: ['Work. Work is like growing. Slow, and you only notice it in hindsight.'],
    },
    any: [
      'I\'m four hundred and twelve. Still getting carded at the tavern. It\'s the leaves.',
      'Patience, little sapling. I once waited eleven years for a squirrel to leave.',
      'A bird nested in my hair this spring. I didn\'t have the heart. I\'m mostly heart. And wood.',
      'Everyone\'s in such a hurry. Where are you going? Further away from where you were. Hm.',
      'I knew this town when it was a field. And before that, a different field.',
      'I don\'t mean to brag, but I have rings. Hundreds. All on the inside, where it counts.',
    ],
    hungry: ['Hungry. I could stand in the sun all afternoon, but frankly, I fancy a sandwich.', 'My roots are rumbling. That\'s like a stomach, only lower and much more embarrassing.'],
    tired: ['I\'m tired. Not sleepy. Tired in the sap.', 'I could nap for a century. Last time I did, they built a road over my foot.'],
    social: ['I sit back from the fire. Further. A bit further. Lovely. Ever so cosy.', 'A campfire is just a story told by a very unlucky tree. I try not to think about it.'],
    sleep: ['Bed? I just stand still and close my eyes. Folk keep hanging lanterns on me.'],
    wander: ['A walk. I like walks. My ancestors never got to take one.', 'I\'m branching out. That\'s a joke. I have four of them.'],
    friend: ['{name}. You are welcome in my shade any time.', 'Ah, {name}. You make an old tree feel like a sapling.'],
    cold: ['Leaf me alone.', 'I have watched mountains erode, {name}. I can outwait you.'],
    scared: ['Not the axe! Anything but the axe!', 'I\'m too old to be firewood!'],
    gift: ['For me? I shall keep it in a knot, close to my heart.', 'Thank you, {name}. I\'ll remember this for two hundred years. Minimum.'],
    chat: [
      ['Lovely weather.', 'Bit dry. My bark\'s been flaking all week.'],
      ['Did you hear about the woodcutter?', 'Every night, I hear about the woodcutter.'],
      ['How old are you now?', 'I stopped counting at three hundred. It was getting sappy.'],
    ],
  },
  frog: {
    work: {
      fisher: [
        'Some say it\'s unfair, a frog fishing. I say it\'s unfair the fish can\'t climb out and bite back.',
        'I could just jump in and grab one. But I have standards. Also, eels.',
        'Fishing\'s all about patience. And tongue control. Mainly patience.',
      ],
      any: ['Work, work, work. Every day\'s a slog. Or a bog. I prefer bog.'],
    },
    any: [
      'I\'m not croaking, I\'m enunciating.',
      'Is it humid today or am I just happy? Hard to tell. Both feel moist.',
      'Folk think kissing a frog turns them into a prince. Tried it, did nothing. Except make my afternoon.',
      'I\'m always leaping to conclusions. I\'m a frog. It\'s how I get everywhere.',
      'A fly went by just now and I didn\'t even look. Personal growth.',
      'I used to be a tadpole. Now I\'m a frog. Most people never change that much.',
    ],
    hungry: ['So hungry. Saw a fly earlier, nearly embarrassed myself in front of the sheriff.', 'My stomach\'s croaking louder than I am.'],
    tired: ['Need a rest. On a lily pad. Or a bed. A wet bed. Don\'t ask.'],
    eat: ['Off to eat. Fish, probably. Flies are for special occasions.'],
    social: ['Love a fire. Dries me right out. Then I go and sit in a puddle. It\'s a cycle.'],
    sleep: ['Goodnight. If you hear singing from the pond, no you didn\'t.'],
    wander: ['Hopping about. Not literally. Okay, a little literally.', 'Out for a hop. My knees are springs, my heart is a pond.'],
    friend: ['{name}! You\'re toad-ally my favourite. That\'s a pun. Sorry. No I\'m not.', 'Hey {name}! Ribbit. That means hello. It also means most things.'],
    cold: ['I\'m keeping my eye on you. Both of them. They go round the side.', 'Hop it.'],
    scared: ['Don\'t squish me!', 'I\'m slippery, I warn you! You won\'t get a grip!'],
    gift: ['A gift? I\'m so touched I\'m going green. Greener.', 'Thanks, {name}! That\'s worth a fly or two.'],
    chat: [
      ['Wet one today, eh?', 'Gorgeous. Absolutely gorgeous.'],
      ['Fancy a swim?', 'I fancy two.'],
      ['You hear the bandits are frogs?', 'Not all frogs! Some of us just like ponds.'],
    ],
  },
  antler: {
    work: {
      guard: [
        'Halt. Who goes there. Oh, it\'s you. Carry on. Slowly.',
        'These antlers are regulation height. I checked. Twice. With a ruler.',
        'Shedding season\'s coming. Then nobody takes me seriously for a month.',
        'I protect this town with my sword, my shield and my extremely pointy head.',
      ],
      nightGuard: [
        'Night watch. The bandits can\'t see me in the dark. Except my antlers. They see my antlers.',
        'I hang the lamp off my left antler. Hands free. Efficiency.',
      ],
      any: ['On duty. Antlers up, head high. Well, it\'s always high. They\'re antlers.'],
    },
    any: [
      'Doorways are my nemesis. Every single one of them.',
      'Yes, I can hang a coat on them. No, you can\'t try.',
      'I lock horns with criminals. Mostly literally.',
    ],
    hungry: ['Haven\'t eaten since dawn. Could graze the town square. I won\'t. It\'s against the bylaws.'],
    tired: ['My head weighs a ton by evening. It\'s not the job. It\'s the antlers.'],
    friend: ['{name}. Citizen of the month. I\'ve made a badge. It\'s in my head.', 'At ease, {name}. You\'re one of the good ones.'],
    cold: ['Move along. Before I get my notebook out.', 'I\'ve got my eye on you. And the points.'],
    scared: ['Back off! These things are pointy!'],
    gift: ['A gift? I\'ll have to log that. Then thank you. In that order.'],
    chat: [
      ['Anything to report?', 'A cat. On the roof. Again.'],
      ['Your antlers look sharp today.', 'Thank you. I filed them. And filed a report.'],
    ],
  },
  gem: {
    work: {
      sheriff: [
        'They say I\'ve got a heart of stone. Inaccurate. It\'s amethyst.',
        'Laws are like gems. Hard, polished, and expensive when you break them.',
        'I\'ve been the sheriff long enough to know trouble. You smell faintly of it.',
        'Under pressure, coal becomes a diamond. Under pressure, criminals become my cellmates.',
      ],
      any: ['Working. Shine on, as we say. Nobody says that. I say that.'],
    },
    any: [
      'I\'m multi-faceted. Literally. Fifty-eight of them.',
      'Everything\'s a bit rocky lately. Don\'t laugh, that one hurts.',
      'Folk try to chip a bit off me for luck. Bad luck, as it happens. For them.',
    ],
    hungry: ['I could use a meal. Minerals mostly. Bread\'s fine.'],
    tired: ['Long shift. Even a rock needs a rest.'],
    friend: ['{name}. Solid as granite, you are. That\'s high praise.', 'Good to see you, {name}. Town\'s quieter when you\'re about. Mostly.'],
    cold: ['You\'re on thin ice. Thin quartz. Whatever. Thin.', 'One more stunt and you\'ll be polishing my cell bars.'],
    scared: ['You\'ll crack before I do!'],
    gift: ['Bribing an officer? Ha. I\'ll call it a donation. To my pocket.'],
    chat: [
      ['Quiet day, sheriff?', 'Quiet as a stone. Which is to say, ominously.'],
    ],
  },
  wizard: {
    work: {
      wizard: [
        'Behold! Potions! Potent, pricey, and only lightly expired!',
        'A wand chooses its owner. Usually the one with the most coins.',
        'This broom flies. Steering is sold separately. Kidding. Mostly.',
        'I was trained at the finest academy of magic. It was a shed. It was a very magical shed.',
      ],
    },
    any: [
      'I\'ve seen the future. It\'s mostly Tuesdays.',
      'Magic is ninety percent confidence and ten percent not standing too close.',
      'I live in the woods because the town kept asking me to fix their roofs with magic. It\'s not a roof spell, Margaret.',
      'My beard holds three secrets, a quill and possibly a mouse.',
    ],
    hungry: ['I could conjure a feast. Or I could buy a fish. The fish is less paperwork.'],
    tired: ['Even wizards sleep. Usually in the hat.'],
    friend: ['Ah, {name}! The stars spoke of you. Briefly. Favourably, mind.'],
    cold: ['Begone, or I\'ll turn you into a newt. A small, sad newt.'],
    scared: ['I know a spell for this! I just can\'t remember it!'],
    gift: ['Coins? How delightfully mundane. I accept.'],
  },
  folk: {
    any: [
      'My neighbour\'s a pumpkin. Lovely chap. Can\'t look him in the eye at harvest time.',
      'There\'s a tree that walks about town. Nobody tells him he\'s a tree. Seems unkind.',
      'Half this town\'s frogs, pumpkins or furniture. I\'m the only normal one, and nobody believes me.',
      'Some say Brindlewick\'s cursed. I say it\'s just got character. Loud character.',
      'Did you know the sheriff\'s made of crystal? Don\'t mention it. He\'s sensitive about the sparkle.',
    ],
    hungry: ['I could eat a whole pumpkin. Not the merchant. A normal one. Do we have normal ones?'],
    chat: [
      ['Did you see the ship?', 'Pirates. Mark my words. Or tourists. Worse, tourists.'],
      ['Heard the sheriff snoring at noon.', 'That was the guard. The sheriff snores in crystal. It sort of chimes.'],
      ['Fish or bread tonight?', 'Why not both? Fish bread. I\'ve been saying it for years.'],
    ],
  },
};

// Shouts a kind says its own way (the rest from the shared lists) — `shout(list, n)`
const SPECIES_SHOUTS = {
  pumpkin: { hurt: ['Mind the rind!', 'Not the face!', 'Ow, my pulp!'], help: ['Guards! This is gourd-awful!', 'Help! Somebody fetch a guard, quick as a vine!'], fight: ['Right, you\'ve squashed my patience!', 'Time someone carved YOU!'], eatBuy: ['Something with no pumpkin in, please.', 'The usual. Hold the pie.'] },
  tree: { hurt: ['Ow! My bark!', 'Splinters!', 'That\'s a knot, that is!'], help: ['Guards! Someone! Hurry! Well, hurry for me. Within the century.', 'Help! Rustle up the guards!'], fight: ['You\'ve barked up the wrong tree!', 'Right. Leaf it to me.'], eatBuy: ['Something with plenty of water, please.'] },
  frog: { hurt: ['Ribbit! Ow!', 'Croak!', 'Oi, that stung!'], help: ['Guards! Hop to it!', 'Help! Someone leap into action!'], fight: ['You\'re going to croak!', 'Hop to it, then!'], eatBuy: ['One fish. Any flies going spare?'] },
  antler: { hurt: ['Ow! That\'s an assault on an officer!', 'Mind the antlers!'], fight: ['Prepare to be gored! Legally!', 'Right! Lowering my head!'] },
  gem: { hurt: ['You chipped me!', 'Hey! Mind the facets!'], fight: ['You\'re about to hit rock bottom!', 'Stone cold justice, coming up!'] },
  wizard: { hurt: ['Ow! My concentration!', 'Mind the beard!'], fight: ['Prepare to be transmogrified!', 'You dare?!'] },
};

const sp = (n) => SPECIES_LINES[speciesOf(n)];
// A kind's own line for `key` now and then (or the shared `fallback`)
const flavoured = (n, key, fallback, chance = 0.5) => {
  const own = sp(n)?.[key];
  return own?.length && Math.random() < chance ? pick(own) : pick(fallback);
};

// A line for the player talking to `npc` (attitude −1..1: how they feel about the player).
// market: { scarce: { label, emoji, price } | null, foodOut, merchantGone } (townMode marketTalk)
export function talkLine(npc, { playerName = 'friend', taskType = null, market = null } = {}) {
  const fill = (s) => s.replace(/\{name\}/g, playerName);
  if (npc.fear > 0) return flavoured(npc, 'scared', SCARED_LINES);
  if (npc.attitude < -0.35) return fill(flavoured(npc, 'cold', COLD_LINES));
  if (npc.attitude > 0.55 && Math.random() < 0.5) return fill(flavoured(npc, 'friend', FRIEND_LINES));
  // How the market's doing
  if (npc.role === 'merchant' && market?.scarce && Math.random() < 0.6) {
    return pick([
      `${market.scarce.label} is scarce. ${market.scarce.price} coins a piece. I don't make the rules. I do make the prices.`,
      `Short on ${market.scarce.label.toLowerCase()}. ${market.scarce.price} coins each, and that's me being generous.`,
    ]);
  }
  if (npc.needs.hunger > 0.6 && market?.foodOut) return pick(['The market\'s out of food. I\'m eyeing the fence posts.', 'No food at the market. I\'m this close to eating soup made of rumours.']);
  if (market?.merchantGone && Math.random() < 0.4) return pick(['With the merchant gone, where do we even buy bread? From the bread fairy?', 'No merchant. I tried bartering with a duck. The duck won.']);
  if (npc.role === 'merchant' && Math.random() < 0.3) return pick(['Bring me wood, fish or veg and I\'ll pay you. Not well. But promptly.', 'Got goods? I\'ve got coins. Let\'s both pretend this is fair.']);
  if (npc.role === 'kid') return pick(TASK_LINES.kid);
  if (npc.role === 'drifter' && Math.random() < 0.6) return pick(TASK_LINES.drifter);
  if (npc.needs.hunger > 0.75) return flavoured(npc, 'hungry', HUNGRY_LINES, 0.75);
  if (npc.needs.energy < 0.2) return flavoured(npc, 'tired', TIRED_LINES, 0.6);
  const own = sp(npc);
  const t = taskType ?? 'wander';
  if (own && Math.random() < 0.5) {
    const list = t === 'work' ? (own.work?.[npc.role] ?? own.work?.any) : own[t];
    if (list?.length) return fill(pick(list));
    if (own.any?.length && Math.random() < 0.6) return fill(pick(own.any));
  }
  if (t === 'work') return pick(TASK_LINES.work[npc.role] ?? TASK_LINES.wander);
  return pick(TASK_LINES[t] ?? TASK_LINES.wander);
}
export const giftLine = (npc, playerName, broke = false) =>
  (broke ? pick(GIFT_BROKE) : flavoured(npc, 'gift', GIFT_LINES).replace(/\{name\}/g, playerName));

// Small talk between two townsfolk; gossip about recent events comes first
// (gossip: [{ kind: 'murder' | 'assault' | 'arrest' | 'newcomer', who, by, at }]); `speaker` = who
// starts it (their kind's own small talk now and then)
const SMALL_TALK = [
  ['Lovely weather.', 'Don\'t jinx it.'],
  ['Prices at the market, eh?', 'Daylight robbery. At least the night robbery\'s honest about it.'],
  ['Did you see the ship?', 'Pirates. Or worse. Accountants.'],
  ['How\'s the family?', 'Loud. Hungry. Mostly mine.'],
  ['Heard the sheriff snoring at noon.', 'Ha! Don\'t let him hear you. He hears everything. Except the snoring.'],
  ['Fish or bread tonight?', 'Why not both? Live a little.'],
  ['Bandits were out again last night.', 'I sleep with a frying pan. Not for them. I just like the pan.'],
  ['You ever wonder what\'s past the sea?', 'More sea, I reckon. Then a bit of a beach.'],
  ['Did you lock your door?', 'I did. Then I went back to check. Then back again. I\'ve not slept since Tuesday.'],
];
export function chatLines(gossip, playerName, speaker = null) {
  const recent = gossip.filter((g) => g.fresh);
  const g = recent.length && Math.random() < 0.7 ? recent[recent.length - 1] : null;
  if (g?.kind === 'murder') return [`Did you hear? Poor ${g.who}...`, g.by === 'player' ? `They say ${playerName} did it. Keep your voice down.` : 'Terrible business. Lock your doors.'];
  if (g?.kind === 'assault') return pick([[`${playerName} attacked ${g.who}!`, 'In broad daylight?! The cheek of it.'], [`Did you see ${playerName} go after ${g.who}?`, 'I did. I\'m walking the long way home now.']]);
  if (g?.kind === 'arrest') return pick([[`The sheriff locked up ${playerName}.`, 'About time. Fine cell, that. I\'ve heard.'], [`${playerName}'s in the clink!`, 'I always said they had shifty elbows.']]);
  if (g?.kind === 'theft') return [`${playerName} was nicking veg${g.who ? ` from ${g.who}'s field` : ''}!`, 'Lock up your carrots. I\'m serious. Tie them down.'];
  if (g?.kind === 'burgled') return [`Bandits broke into ${g.who}'s house last night!`, 'Took the good spoons, I bet. They always take the good spoons.'];
  if (g?.kind === 'newcomer') return [`Have you met ${g.who}? New in town.`, 'Seems nice. Give it a week.'];
  const own = speaker ? sp(speaker)?.chat : null;
  if (own?.length && Math.random() < 0.5) return pick(own);
  return pick(SMALL_TALK);
}

// Shouts
export const SHOUT_HURT = ['Ow!', 'Hey!', 'Stop that!', 'Ouch! That\'s my everything!'];
export const SHOUT_HELP = ['Help! Guards!', 'Somebody help!', 'Guards! Someone! Anyone with a sword!'];
export const SHOUT_MURDER = ['Murder!', 'Guards! Murder!', 'No!!'];
export const SHOUT_THIEF = ['Thief!', 'Stop, thief!', 'Guards! A thief!', 'Oi! Put that back!'];
export const SHOUT_FIGHT = ['You want a fight?!', 'That\'s it! Hold my bread!', 'Come here!'];
export const SHOUT_LAW = ['Stop right there!', 'In the name of the law!', 'Halt, criminal!'];
export const SHOUT_EAT_BUY = ['One loaf, please.', 'The usual!', 'Two fish, thanks. Small ones. They\'re cheaper.'];
const SHOUT_KIND = new Map([[SHOUT_HURT, 'hurt'], [SHOUT_HELP, 'help'], [SHOUT_FIGHT, 'fight'], [SHOUT_EAT_BUY, 'eatBuy']]);
// A shout from `list` — said by `n` in their kind's own way now and then
export const shout = (list, n = null) => {
  const own = n && SHOUT_KIND.has(list) ? SPECIES_SHOUTS[speciesOf(n)]?.[SHOUT_KIND.get(list)] : null;
  return own?.length && Math.random() < 0.5 ? pick(own) : pick(list);
};

// ── Phase 3 reactions ──
export const SHOUT_RALLY = ['Leave {who} alone!', 'Hands off {who}!', 'You\'ll pay for that!'];
export const SHOUT_VENDETTA = ['You killed my {rel}!', 'For my {rel}!', 'Murderer!'];
export const SHOUT_STAY_BACK = ['Stay back!', 'Don\'t come near me.', 'I\'m watching you. I\'m not blinking. Ow, my eyes.'];
export const SHOUT_MUG = ['Your purse. Now.', 'Hand it over! Slowly. I bruise easy.', 'Coins or else. Or else what? Don\'t make me think of something.'];
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
export const SHOUT_THANKS = ['Thank you, {name}!', 'You saved me! I owe you. Not money. Gratitude. Lots of it.', 'My hero! Don\'t let it go to your head.'];
export const FOLLOW_LINES = {
  join: ['Lead the way, {name}!', 'Right behind you. Not too right. A polite distance.', 'Adventure! I\'ve packed a sandwich.'],
  leave: ['I\'ll head home then. Good adventure. Bit walky.', 'See you around, {name}.'],
  late: ['It\'s late. My bed misses me. Weirdly clingy, my bed.'],
  wanted: ['Fight the guards? I\'m loyal, not daft. You\'re on your own.', 'Wanted posters are not a good look on me. Bye!'],
};
// A family member, by role (for the vendetta shout)
export const relationOf = (role) => (role === 'kid' ? 'child' : pick(['sister', 'brother', 'cousin', 'friend']));
export const fillLine = (text, vars) => text.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');

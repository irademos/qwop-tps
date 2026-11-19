// Town's first day — DATA only (was townIntro.js' STEPS): a few townsfolk show a newcomer how
// Brindlewick lives, one small goal at a time, each paying a few coins. Run by the quest runner
// with Town's beats (townQuests.js) before the jobs (quests/jobs.js) — the same beats, plus:
//   goal { kind, n, at, guide, progress, tips, allowPick?, guideBuys? } — do something n times
//        (T.questNote(kind) from fishing 'fish' / cooking 'cook' / picking 'pick' / selling 'sell' /
//        splitting a log 'wood'); the guide leads the way to `at` (townGuide.js) and the player is
//        walked along behind them while `walk:on` (a talk choice), its button ringed
//   unless { has } — the quest's skipped if the player has that already ('sword')
//   banner { title, sub, feed }
// A talk choice's `then` can also: 'give:<item>' (a rod / sword if they've none), 'walk:on' /
// 'walk:off' (walked to the goal or not), 'skipDay' (a rod + sword, on to the jobs), 'buySword'.
// pay's `say`: the guide's done line (said aloud near them, else in the feed).
// {price} = what the sword costs them ({swordPrice} the number), {<role>} = that townsperson's name.

const LATER = { label: 'Later', then: ['later'] };

export const FIRST_DAY = [
  {
    id: 'welcome', tag: 'First day', title: 'Say hello at the shop',
    beats: [
      { do: 'seek', who: 'merchant', ifGone: 'done' },
      {
        do: 'talk', who: 'merchant', onLeave: 'later', reward: 'Reward: 🪙 3',
        lines: [['merchant', 'Welcome to Brindlewick, {name}! New in town, and not a coin to your name, by the look of you. Here — a few to start. I\'m the weaponsmith; food\'s at the stalls outside, sold by whoever made it. Folk around here will show you how we live: fishing, farming, the market. Shall I send someone round?']],
        choices: [{ label: 'Show me around' }, { label: 'I know my way around', then: ['skipDay'] }],
      },
      { do: 'pay', from: 'merchant', coins: 3, memory: 'Your first day', say: '{fisher} the fisher will come and find you — they\'ll show you the ropes.' },
    ],
  },
  {
    id: 'fish', tag: 'First day', title: 'Go fishing',
    beats: [
      { do: 'seek', who: 'fisher', ifGone: 'goto:do' },
      {
        do: 'talk', who: 'fisher', reward: 'Reward: 🪙 4',
        lines: [['fisher', 'Come fishing, {name}! Here — my old rod, it\'s yours. Walk out to the end of the dock with me and take it out. Swing it forward to cast. When the bobber goes under, pull the rod back sharp to hook it. Let it run, pull when it tires, then reel it in. Catch one and it\'s yours.']],
        choices: [{ label: 'Let\'s fish', then: ['give:rod', 'walk:on'] }, LATER],
      },
      {
        do: 'goal', label: 'do', checkpoint: true, kind: 'fish', n: 1, at: 'dock', guide: 'fisher',
        progress: 'Catch a fish off the end of the dock',
        tips: [
          'Face the water and swing the rod forward to cast — the harder the swing, the further it goes.',
          'Watch the bobber. When it goes right under, pull the rod back sharp — a little nibble first is just teasing.',
          'When the fish runs, don\'t fight it. When it tires, pull — then reel it in.',
          'No rod in your hand? Take it out with the Rod button.',
        ],
      },
      { do: 'pay', from: 'fisher', coins: 4, memory: 'Our fishing' },
    ],
  },
  {
    id: 'cook', tag: 'First day', title: 'Cook your catch',
    beats: [
      { do: 'seek', who: 'fisher', ifGone: 'goto:do' },
      {
        do: 'talk', who: 'fisher', onLeave: 'next',
        lines: [['fisher', 'Ha, a fine catch! You\'re a natural, {name}. Now let\'s cook it. Raw fish won\'t do you much good — grilled over the town campfire it heals far more, and sells for more too. Follow me to the fire, then press Grill by the pot and stay close while it grills.']],
        choices: [{ label: 'Lead the way', then: ['walk:on'] }, { label: 'I\'ll find my own way', then: ['walk:off'] }],
      },
      {
        do: 'goal', label: 'do', checkpoint: true, kind: 'cook', n: 1, at: 'fire', guide: 'fisher',
        progress: 'Grill a fish at the campfire',
        tips: [
          'Walk up to the fire with your fish and press Grill.',
          'Stay by the pot a few seconds while it cooks — wander off and it\'s ruined.',
          'Two veg make a stew, if you\'ve no fish.',
        ],
      },
      { do: 'pay', from: 'fisher', coins: 3, memory: 'Our fishing', say: 'Smells good! Cooked food heals more, and the merchant pays more for it too.' },
    ],
  },
  {
    id: 'harvest', tag: 'First day', title: 'Help with the harvest',
    beats: [
      { do: 'seek', who: 'farmer', ifGone: 'goto:do' },
      {
        do: 'talk', who: 'farmer', reward: 'Reward: 🪙 3',
        lines: [['farmer', 'Give me a hand with the harvest, {name}? Pick 3 veg from my field — press Pick — and keep them, they\'re yours. Mind, it\'s only my say-so that lets you: a field\'s veg are its owner\'s.']],
        choices: [{ label: 'Happy to help', then: ['walk:on'] }, LATER],
      },
      {
        do: 'goal', label: 'do', checkpoint: true, kind: 'pick', n: 3, at: 'guideWork', guide: 'farmer', allowPick: true,
        progress: 'Pick 3 veg from {farmer}\'s field',
        tips: [
          'Walk in among the crops and press Pick.',
          'It grows back in a while. Buy a field of your own and you can pick it whenever you like.',
        ],
      },
      { do: 'pay', from: 'farmer', coins: 3, memory: 'The harvest' },
    ],
  },
  {
    id: 'sell', tag: 'First day', title: 'Sell at the market',
    beats: [
      { do: 'seek', who: 'farmer', ifGone: 'goto:do' },
      {
        do: 'talk', who: 'farmer', onLeave: 'next',
        lines: [['farmer', 'Good hands! That\'s the harvest in. Those veg are yours to keep — so let\'s turn them into coin. Come to the market stalls outside the shop: stand behind a free one, press Sell here, and folk come to you. I\'ll be your first customer.']],
        choices: [{ label: 'Lead the way', then: ['walk:on'] }, { label: 'I\'ll find my own way', then: ['walk:off'] }],
      },
      {
        do: 'goal', label: 'do', checkpoint: true, kind: 'sell', n: 1, at: 'stall', guide: 'farmer', guideBuys: true,
        progress: 'Stand behind a free market stall, press Sell here, then sell to me',
        tips: [
          'Walk round behind a free stall — the sign says so — and press Sell here. There are spots inside the shop too, along the side counters.',
          'Cooked food fetches more than raw.',
          'You can sell to us sellers too: talk to me and press Sell. We pay less than folk at a stall, mind.',
        ],
      },
      { do: 'pay', from: 'farmer', coins: 3, memory: 'The harvest', say: 'There — coins in your pocket! Fish sells in the morning, veg in the afternoon. Stay at your stall and folk keep coming — you say yes or no to each.' },
    ],
  },
  {
    // (the merchant, from behind his counter: a sword, at a discount if the player's short)
    id: 'sword', tag: 'First day', title: 'Buy a sword',
    beats: [
      { do: 'unless', has: 'sword' },
      { do: 'seek', who: 'merchant', talkFrom: 6, ifGone: 'done' },
      {
        do: 'talk', who: 'merchant', reach: 7.5,
        lines: [['merchant', 'Coins in your pocket already, {name}! Now — you\'ll want a sword. It chops wood, keeps the bandits honest. {price}']],
        choices: [{ label: 'Buy the sword ({swordPrice} 🪙)', act: true, then: ['buySword'] }, LATER],
      },
      { do: 'pay', from: 'merchant', coins: 0, say: 'Mind where you swing it!' },
    ],
  },
  {
    id: 'camp', tag: 'First day', title: 'Meet the sheriff',
    beats: [
      { do: 'seek', who: 'sheriff', ifGone: 'done' },
      {
        do: 'talk', who: 'sheriff', reward: 'Reward: 🪙 3',
        lines: [['sheriff', 'A word, {name}. I keep the law in Brindlewick — keep your blade sheathed in town, and the guards won\'t trouble you. And stay away from the bandit camp, way out past the edge of town. They\'ll warn you once. Then it\'s swords.']],
        choices: [{ label: 'Understood' }, LATER],
      },
      { do: 'pay', from: 'sheriff', coins: 3, memory: 'Your first day', say: 'Good. And {woodcutter} the woodcutter was asking after you — something about firewood.' },
    ],
  },
  {
    id: 'chop', tag: 'First day', title: 'Chop some wood',
    beats: [
      { do: 'seek', who: 'woodcutter', ifGone: 'goto:do' },
      {
        do: 'talk', who: 'woodcutter', reward: 'Reward: 🪙 5',
        lines: [['woodcutter', 'There you are, {name}! Ever felled a tree? Come on, I\'ll find you a good one. Sword out, swing at the trunk till it comes down — then hack a log in two for your wood.']],
        choices: [{ label: 'Show me', then: ['give:sword', 'walk:on'] }, LATER],
      },
      {
        do: 'goal', label: 'do', checkpoint: true, kind: 'wood', n: 1, at: 'tree', guide: 'woodcutter',
        progress: 'Chop down the tree, then split a log for wood',
        tips: [
          'Take your sword out and swing it at the trunk.',
          'Keep at it — a few good hits and over she goes.',
          'Once it\'s down, swing at a log to split it. Each one\'s a piece of wood.',
        ],
      },
      { do: 'pay', from: 'woodcutter', coins: 5, memory: 'Your first day', say: 'Ha! Timber! That\'s a woodcutter\'s work — wood always sells.' },
      {
        do: 'banner', title: 'SETTLED IN!', sub: 'You know your way around Brindlewick now',
        feed: 'That\'s your first day done. The town\'s yours to make a living in — or trouble. Someone will have work for you soon.',
      },
    ],
  },
];

// (old saves kept the first day's step by its index: the steps as they were then)
export const OLD_STEP_IDS = ['welcome', 'fish', 'cook', 'harvest', 'sell', 'camp', 'chop'];

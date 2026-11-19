// Town's jobs after the first day — DATA only, run in order by the quest runner
// (src/quest/questRunner.js) with Town's beats (townQuests.js). Each job is a list of beats; the
// next job comes only once the one before is done (`waitS` after it). A new job is a new entry
// here made of the beats that exist; a new beat type only for something new.
//
// Job: { id, title, waitS?, failWaitS?, restartAt?, quiet?, beats: [...] }
//   quiet: the bandit camp leaves the player be while the job's under way (from a `board` on — no
//   warnings / hold-ups)
// Beats (townQuests.js BEATS — see there for every param):
//   seek    { who, anyTime?, talkFrom?, arrive? }  — the giver (a role) comes to find the player (❗ over them);
//           arrive: a place they come in by when they're far off (the wizard from his mountain → 'entrance')
//   talk    { who, lines: [[who, text]…], choices?: [{ label, then? }], reward?, reach? }
//           who: whose talk it is (a role, or an actor's id); lines' who: a role, an actor's id or
//           'you'. A choice's `then`: 'later' (back in a while), 'fail', 'goto:<label>'; none → on.
//   cart    { bring?, load? }   — the cart brought beside the player; `load` in its bed ('veg' / null)
//   board   { who }             — a townsperson climbs into the back of the cart
//   alight  { who }             — and gets out
//   drive   { to, r, text, need?, ifShort? } — glowing arrows to a place; done once the cart's within r of it
//           need: { good: count } it must carry there (short of it: back to the `ifShort` label)
//   cartGoods { good, count, text? } — the cart's store filled from the player's bag (by the
//           cart → Cart → Store; gathered the usual way); done once it holds `count`
//   unloadGoods { good, count, ifShort?, text? } — those goods taken out of the cart
//   ruin    { key, on, when? }  — a building torn down (on) / built back up (when: 'morning');
//           out of the player's sight (townRuins.js — keys: 'wizardCabin')
//   lockCart { on }             — the cart held where it is (or let go)
//   actor   { id, url, name, from, to, gap, scale?, voice?, text } — someone who isn't a townsperson
//           walks out from `from` to `gap` m short of `to` (the son)
//   bomb    { from, at }        — an actor throws a bomb at the cart: it's knocked over, everyone thrown out
//   actorLeave { id, to }       — an actor runs off (gone once out of sight)
//   ambush  { count, from, allies, onAlly, text } — that many bandits come at the player; allies
//           (roles) fight beside them; done once they're all down, failed if an ally or the player goes down
//   pay     { from, coins, memory } — the reward
//   wait    { until? } — the runner's own: nothing happens till a talk / action moves on
// Any beat: talks: { <role>: talk } — what that townsperson says if talked to while it's the beat
// (open-ended — talk to someone whenever); entry: the tracker's line.
//   unload  {}                  — the cart's load handed over
//   release { who, linger? }    — the townsperson back to their day (linger: s round where they are first)
// Places (`to` / `from`): 'wizard' (his stall up the mountain), 'camp' (the bandit camp), 'town'
// (by the shop, where the cart's parked), 'cart', 'entrance' (the newcomers' way into town).
// Text: {name} = the player's name, {<role>} = that townsperson's first name, {<role>.dad} /
// .father / .he / .him / .his / .man / .sir = the word for them (Dad or Mum…; capitalised as written).

const WIZARD_URL = 'wizard';  // (an actor's url: a glbCharacterConfig key + 'Url' — townQuests.js)

export const JOBS = [
  // ── Day 2: the farmer's veg up the mountain to the wizard ──
  {
    id: 'veg', title: 'Veg for the wizard', waitS: 40,
    beats: [
      { do: 'seek', who: 'farmer' },
      {
        do: 'talk', who: 'farmer', reward: 'The wizard pays on delivery',
        lines: [['farmer', 'Ah, {name} — just the one I wanted. The wizard who lives up the mountain has sent down for veg, and my knees won\'t take me up that slope any more. I\'ve loaded the cart for him — it\'s right here beside you. Get in, and follow the arrows up the mountain to his cabin. He pays well, the old sorcerer.']],
        choices: [{ label: 'I\'ll take it up' }, { label: 'Later', then: ['later'] }],
      },
      { do: 'cart', label: 'do', bring: true, load: 'veg', checkpoint: true },
      {
        do: 'drive', to: 'wizard', r: 9, text: 'Drive the cart up the mountain to the wizard\'s cabin',
        // (talk to the farmer meanwhile — open-ended: any beat can carry `talks`)
        talks: { farmer: { lines: [['farmer', 'Still here, {name}? The wizard\'s cabin is up the mountain — follow the arrows, and mind the steep bits. He pays well!']] } },
      },
    ],
  },
  {
    id: 'wizardPay', title: 'Veg for the wizard', waitS: 0,
    beats: [
      { do: 'cart', load: 'veg', checkpoint: true },
      { do: 'seek', who: 'wizard', anyTime: true, talkFrom: 6 },
      {
        do: 'talk', who: 'wizard', reach: 7.5, reward: 'Reward: 🪙 30',
        lines: [
          ['wizard', 'Well, well — a cartful of veg, all the way up my mountain! You\'ll be {name}; the farmer said someone would come. Here — thirty coins for your trouble, and my thanks. A wizard can\'t live on moonlight.'],
        ],
        choices: [{ label: 'Thank you' }],
      },
      { do: 'pay', from: 'wizard', coins: 30, memory: 'The veg you brought up' },
      { do: 'unload' },
    ],
  },
  // ── Day 2, after: the wizard's son, down at the bandit camp ──
  {
    id: 'wizardSon', title: 'The wizard\'s son', waitS: 3, failWaitS: 30, quiet: true,
    beats: [
      { do: 'seek', who: 'wizard', talkFrom: 6 },
      {
        do: 'talk', who: 'wizard', reach: 7.5, reward: 'A ride down the mountain',
        lines: [
          ['wizard', 'Before you go, {name}… might an old man beg a ride?'],
          ['wizard', 'My son, Rowan. He\'s fallen in with that crowd at the bandit camp. He won\'t come up the mountain any more — not for me, not even for supper.'],
          ['wizard', 'The road down passes right by their camp. Take me there? I only want to talk to him.'],
        ],
        choices: [{ label: 'Hop in the back' }, { label: 'Later', then: ['later'] }],
      },
      { do: 'cart', bring: true },
      { do: 'board', who: 'wizard' },
      { do: 'drive', to: 'camp', r: 26, text: 'Drive the wizard down to the bandit camp' },
      { do: 'lockCart', on: true },
      {
        do: 'actor', id: 'son', url: WIZARD_URL, name: 'Rowan', scale: 0.82, voice: { kind: 'male', family: 'wizard' },
        from: 'camp', to: 'cart', gap: 6.5, text: 'Someone\'s coming out of the camp',
      },
      {
        do: 'talk', who: 'wizard', reach: 16, onLeave: 'next', text: 'Rowan and {wizard} are talking',
        lines: [
          ['wizard', 'Rowan! Rowan, my boy — it\'s your {wizard.father}.'],
          ['son', '{wizard.Dad}?! What are you doing here? You\'ll get me laughed out of camp.'],
          ['wizard', 'Come home. The herbs need tending, the spellbooks need reading. Your grandmother\'s wand is still on its hook, waiting for you.'],
          ['son', 'I don\'t WANT that wand! I don\'t want the robes, or the books, or the stupid pointy hat. I\'m not a wizard, {wizard.Dad}. I never was.'],
          ['wizard', 'Nobody\'s born a wizard. You learn it, a little every day, like—'],
          ['son', 'Like you? Up a mountain on your own, talking to newts? No thanks.'],
          ['son', 'The lads here don\'t care whose son I am. Here I\'m just Rowan.'],
          ['wizard', 'Lads who rob farmers in the night? Rowan, please—'],
          ['son', 'Go home, old {wizard.man}. And take your cart with you!'],
        ],
        choices: [{ label: 'Look out!' }],
      },
      { do: 'bomb', from: 'son', at: 'cart' },
      { do: 'actorLeave', id: 'son', to: 'camp', shout: 'Lads! Get them!' },
      { do: 'ambush', count: 5, from: 'camp', allies: ['wizard'], onAlly: 2, text: 'Fight off Rowan\'s friends' },
      { do: 'seek', who: 'wizard', anyTime: true },
      {
        do: 'talk', who: 'wizard', reach: 8,
        lines: [
          ['wizard', 'Ohh, my old bones. Thank you, {name}. You fight like a wizard\'s apprentice.'],
          ['wizard', 'Rowan… ran off. Back to them, I suppose. A boy who\'d throw a bomb at his own {wizard.father}.'],
          ['wizard', 'No — he aimed at the cart, not at me. There\'s hope in that. A little.'],
          ['wizard', 'I can\'t face the mountain now. Take me into town? I could do with a hot meal, and some company that isn\'t a newt.'],
        ],
        choices: [{ label: 'Hop in' }],
      },
      { do: 'board', who: 'wizard', checkpoint: true },
      { do: 'drive', to: 'town', r: 9, text: 'Drive the wizard into town' },
      { do: 'alight', who: 'wizard' },
      {
        do: 'talk', who: 'wizard', reach: 8, reward: 'Reward: 🪙 40',
        lines: [
          ['wizard', 'Brindlewick! I haven\'t been down in years. It\'s louder than I remember.'],
          ['wizard', 'Here — for the ride, and the bruises. And {name}… if you see Rowan about, tell him the door\'s open.'],
        ],
        choices: [{ label: 'I will' }],
      },
      { do: 'pay', from: 'wizard', coins: 40, memory: 'The ride down to see Rowan' },
      { do: 'release', who: 'wizard', linger: 120 },
    ],
  },
  // ── Day 3: the bandits' revenge — the wizard's cabin torn down; fifteen logs up the mountain ──
  {
    id: 'wizardCabin', title: 'Logs for the wizard\'s cabin', waitS: 75,
    beats: [
      // (out of sight: his cabin a heap of dirt and logs — townRuins.js)
      { do: 'ruin', key: 'wizardCabin', on: true },
      { do: 'seek', who: 'wizard', arrive: 'entrance' },
      {
        do: 'talk', who: 'wizard', reach: 8, reward: 'Fill the cart with 15 logs',
        lines: [
          ['wizard', '{name}! Oh, thank goodness. I\'ve come all the way down the mountain to find you.'],
          ['wizard', 'While I was away, Rowan\'s friends went up to my cabin. Paying me back for the hiding you gave them.'],
          ['wizard', 'They tore it down. Every wall. It\'s a heap of dirt and splintered logs now — my books, my jars, my good kettle, all under it.'],
          ['wizard', 'Rowan wasn\'t with them, I\'m told. I\'m holding on to that.'],
          ['wizard', 'I can build it back up — a wizard knows a word or two for that — but magic can\'t make logs out of nothing. I need wood. Fifteen good logs.'],
          ['wizard', 'Chop them in the woods, put them in the cart — its bed holds plenty, more than your bag — and drive them up the mountain to me. Will you?'],
        ],
        choices: [{ label: 'I\'ll bring the logs' }, { label: 'Later', then: ['later'] }],
      },
      { do: 'release', who: 'wizard', linger: 25 },
      {
        do: 'cartGoods', label: 'do', checkpoint: true, good: 'wood', count: 15, text: 'Fill the cart with logs',
        talks: {
          woodcutter: { lines: [['woodcutter', 'Logs for the wizard? Fell a tree with your sword, then split the logs it leaves — one wood a log. Your bag holds fifteen; walk up to the cart and put them in its bed as you go.']] },
          farmer: { lines: [['farmer', 'They pulled his cabin down? Shameful. The woods are full of trees, {name} — and the cart\'s bed holds more than your bag does.']] },
        },
      },
      {
        do: 'drive', to: 'wizard', r: 9, need: { wood: 15 }, ifShort: 'do', text: 'Drive the logs up the mountain to the wizard',
        talks: { woodcutter: { lines: [['woodcutter', 'Fifteen logs in the cart — that\'ll build a cabin. Up the mountain with you, follow the arrows.']] } },
      },
      { do: 'seek', who: 'wizard', anyTime: true, talkFrom: 6 },
      {
        do: 'talk', who: 'wizard', reach: 8, reward: 'Reward: 🪙 50',
        lines: [
          ['wizard', 'Fifteen logs! And good straight ones, too. {name}, you\'re a marvel.'],
          ['wizard', 'Leave them with me. A few words of the old craft tonight, and by morning you won\'t know anything happened.'],
          ['wizard', 'Here — fifty coins. It\'s all they didn\'t find.'],
        ],
        choices: [{ label: 'Unload the logs' }],
      },
      { do: 'unloadGoods', good: 'wood', count: 15, ifShort: 'do', text: 'The logs are stacked by what\'s left of the cabin.' },
      { do: 'pay', from: 'wizard', coins: 50, memory: 'The logs for the cabin', say: 'Come and see it in the morning!' },
      // (up again by morning — out of sight)
      { do: 'ruin', key: 'wizardCabin', on: false, when: 'morning' },
    ],
  },
];

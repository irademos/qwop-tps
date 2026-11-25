// Town's jobs after the first day — DATA only, in BRANCHES: each branch a list of jobs done in
// order (the next only once the one before is done, `waitS` after it), run by the quest runner
// (src/quest/questRunner.js) with Town's beats (townQuests.js). The branches run side by side:
// any branch whose next job is ready can have its giver come and find the player — one at a
// time, in the order they came up (a queue; a giver near the player first), and never while
// another branch's job is under way, nor while the player's in a fight, out on the water, off on
// another island or far off. Talking to any waiting giver (❗) starts theirs. A new job is a new
// entry in a branch made of the beats that exist; a new branch is a new entry in BRANCHES; a new
// beat type only for something new.
//
// Branch: { id, title, from?, jobs: [...] }
//   from: when it opens — { day?: n (the town's day n or later), hours?: [from, to] (its givers
//   only come in those hours), after?: '<branch id>' | '<job id>' (once that's done) };
//   none: as soon as the first day's done (or skipped)
// Job: { id, title, waitS?, failWaitS?, restartAt?, quiet?, downText?, beats: [...] }
//   quiet: the bandit camp leaves the player be while the job's under way (from a `board` on — no
//   warnings / hold-ups); downText: what the feed says when the player goes down mid-job (it fails)
// Beats (townQuests.js BEATS — see there for every param):
//   seek    { who, anyTime?, talkFrom?, arrive?, queue? }  — the giver (a role) comes to find the player (❗ over them);
//           arrive: a place they come in by when they're far off (the wizard from his mountain → 'entrance');
//           queue: a seek part way through (back for another go — restartAt) waits its turn like the first
//   talk    { who, lines: [[who, text]…], choices?: [{ label, then? }], reward?, reach? }
//           who: whose talk it is (a role, or an actor's id); lines' who: a role, an actor's id or
//           'you'. A choice's `then`: 'later' (back in a while), 'fail', 'goto:<label>'; none → on.
//   bring   { who, good, count, text? } — the player brings them that many goods in the bag (taken
//           when talked to with enough)
//   build   { who, at, s, makes, text? } — they go to a place and work there s seconds; then `makes`
//           is there ('canoe': the canoe by the fishing spot — none in Town till then)
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
//   canoeCrew { who }         — they climb into the canoe's bow, and the player gets in too
//   paddle  { to, r, stop?, text } — glowing arrows on the water to a place (the oar out); done once the
//           canoe's within r — stop: it's stopped there and the rod comes out
//   fishHere { golden?, text } — a fish caught there (quick bites); golden: the golden fish hooked
//           (it won't come in — the next beat takes it away)
//   ship    { mode }          — the pirate ship: 'park' (out on the horizon, waiting), 'lurk' (all at
//           once a little way off the canoe — out of sight while the player's under water)
//   pirates { who, bombers, archers } — in comes the ship, a bomb shakes the golden fish off, then
//           the chase: `who` paddles, the crew (bomb throwers and archers, one at a time) attack, the
//           player knocks their bombs / arrows back; done once they're all down (townPirates.js)
//   say     { who, lines }    — `who` says these out loud (and in the feed), one after another — no
//           talk box, no buttons; the job goes straight on
//   pilotHome { who, text }   — `who` paddles the canoe home to its mooring
//   canoeLand { who }         — the player and `who` ashore, the canoe moored
//   needItem { item, who?, ifMissing } — the player has it (a town item: 'gun' = the bow — a bow
//           with no arrows gets a few from `who`) → on; else goto the `ifMissing` label
//   potion  { on }            — the wizard's potion: air under water for the player and the job's
//           swimmers till it's off (or the job ends)
//   diveOut { who }           — `who` climbs out of the canoe into the water; done once the player's
//           out and under too (Get out works anywhere on the water)
//   diveLead { who, to, r, text } — `who` swims down to a place under water ('diveA' / 'diveB'),
//           waiting if the player falls behind; done once both are there
//   diveFish { at, count?, golden?, text } — fish put there; done once one's speared with the bow
//           and wound in (golden: the golden fish)
//   surface { who, text }     — back up: `who` beside the canoe, the player up out of the dive
//   pirateBombs { who, count } — the ship (moved there while the player was under — ship 'lurk')
//           throws `count` bombs on the player and `who`; black; the player wakes lying in the
//           canoe, `who` taken by the pirates (out of the world — townQuests.js capture), the
//           ship off out to sea
//   chaseShip { s?, text }    — arrows on the water after the ship as it gets away; done once it's
//           gone or s seconds are up
//   feed    { lines, banner? } — lines in the feed (and a banner: [title, sub])
//   islandPlan { key, failText } — another island (Tree Island: 'treeIsland') loaded and looked
//           over: its beach, where the pirates moor — none → the job fails (failText)
//   giveItem { who, item, say? } — handed over unless the player has one ('lockpick', a town item)
//   night   { ifDay }         — on after dark; by day, goto the `ifDay` label
//   pirateMoor { key, who }   — the pirate ship moored off that island, `who` (the one taken) in a
//           cage on its deck, one pirate on watch at the rail with a lantern
//   sneak   { key, who, count } — along the shore to the ship, `who` beside the player; one arrow
//           kills the lookout and nobody wakes; a miss (or seen — too near) and `count` pirates
//           jump down and come at them. Done once they're all down
//   boardShip { text }        — Climb aboard by its hull; done once on its deck
//   pickCage { who }          — the cage's lock picked (the lockpick minigame); `who` steps out
//   boarders { count, text }  — `count` pirates over the rails; done once they're all down
//   freeCaptive { who }       — the pirates' prisoner no more (kept in the job)
//   giveGoods { who, good, count, text, popup? } — goods into the bag (the chest if it's full)
//   defender { who }          — fights beside the player in the night defense from now on
//   canoeCrew's `also`: a second passenger (the stern); canoeLand's `stay`: the canoe left where
//           it is (landed on another island), `who` (and `also`) following the player
//   seek's `nightOnly` (+ dayText): they only come after dark
//   seek's `needs: '<item>'` (+ needsText): the giver won't come till the player has it
//   wait    { until? } — the runner's own: nothing happens till a talk / action moves on
// Any beat: talks: { <role>: talk } — what that townsperson says if talked to while it's the beat
// (open-ended — talk to someone whenever); entry: the tracker's line.
// songs: false on a quest (or a beat) — no job songs while it's under way (the long, everyday
// jobs: gathering wood, deliveries); a beat's own `songs` wins over its quest's.
//   unload  {}                  — the cart's load handed over
//   release { who, linger? }    — the townsperson back to their day (linger: s round where they are first)
// Places (`to` / `from` / `at`): 'wizard' (his stall up the mountain), 'camp' (the bandit camp), 'town'
// (by the shop, where the cart's parked), 'cart', 'entrance' (the newcomers' way into town),
// 'fishSpot' (the fishing spot, where the canoe's moored), 'sea1' / 'sea2' (out on the water past
// it — townPirates.js' sea plan: part way out, and the far side of a ring of open water), 'dive'
// (where it gets deep past them), 'diveA' / 'diveB' (spots under water on out from there — the
// dive plan), 'mooring' (the canoe's mooring), 'islandLanding' / 'islandSea' (another island's
// beach facing home, the water just off it), 'ship' / 'shipShore' (the ship moored off it, the
// shore beside it — townPirates.js' island plan).
// Cast: a role, or 'cousin' — another of the role of someone the pirates took (another fisher,
// else a townsperson); someone taken (flags.taken) is who a job means by their role.
// Text: {name} = the player's name, {<role>} = that townsperson's first name, {<role>.dad} /
// .father / .he / .him / .his / .man / .sir = the word for them (Dad or Mum…; capitalised as written).

const WIZARD_URL = 'wizard';  // (an actor's url: a glbCharacterConfig key + 'Url' — townQuests.js)

// ── The wizard: veg up the mountain, his son, his cabin ──
const WIZARD_JOBS = [
  // ── Day 2: the farmer's veg up the mountain to the wizard ──
  {
    id: 'veg', title: 'Veg for the wizard', waitS: 40, songs: false,
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
    id: 'wizardPay', title: 'Veg for the wizard', waitS: 0, songs: false,
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
      // (out along the nearest stretch of the walk, the wizard at the player's side — beats/wave.js)
      {
        do: 'wave', label: 'fight', count: 7, level: 2, allies: ['wizard'], pathLen: 110,
        title: 'AMBUSH', sub: 'Rowan\'s friends are coming', text: 'Fight off Rowan\'s friends',
      },
      { do: 'lockCart', on: false },
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
      // (the fight walked them off down the trail: the cart brought round)
      { do: 'cart', bring: true },
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
    id: 'wizardCabin', title: 'Logs for the wizard\'s cabin', waitS: 75, songs: false,
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

// ── The fisher: a canoe ──
const FISHER_JOBS = [
  {
    id: 'canoe', title: 'A canoe for the fisher', waitS: 70, songs: false,
    beats: [
      { do: 'seek', who: 'fisher' },
      {
        do: 'talk', who: 'fisher', reward: 'Bring 10 wood',
        lines: [
          ['fisher', '{name}! Got a moment? The old canoe I had rotted through last winter, and the fish out past the docks are the best in the bay.'],
          ['fisher', 'I\'d build a new one, but I\'m no woodcutter. Bring me ten wood — fell a tree with your sword and split the logs it leaves — and I\'ll build us a canoe. You can take her out whenever you like.'],
        ],
        choices: [{ label: 'I\'ll get the wood' }, { label: 'Later', then: ['later'] }],
      },
      { do: 'release', who: 'fisher' },
      {
        do: 'bring', label: 'do', checkpoint: true, who: 'fisher', good: 'wood', count: 10, text: 'Bring {fisher} 10 wood',
        talks: { woodcutter: { lines: [['woodcutter', 'Wood for a canoe? Fell a tree with your sword, then split the logs it leaves — one wood a log. Ten will do it.']] } },
      },
      {
        do: 'talk', who: 'fisher', reach: 6, checkpoint: true,
        lines: [['fisher', 'Ten good logs! Right — leave it to me. Come down to the water and watch, if you like; it won\'t take long.']],
        choices: [{ label: 'Go on then' }],
      },
      { do: 'build', label: 'build', checkpoint: true, who: 'fisher', at: 'fishSpot', s: 30, makes: 'canoe', text: '{fisher} is building the canoe by the fishing spot' },
      { do: 'seek', who: 'fisher', anyTime: true, checkpoint: true },
      {
        do: 'talk', who: 'fisher', reach: 7, reward: 'The canoe is yours to use',
        lines: [
          ['fisher', 'There she is — moored by the fishing spot! Walk up to her and get in; tip the phone to paddle.'],
          ['fisher', 'Take a rod out there and fish anywhere on the water. And they say there\'s an island out past the bay…'],
        ],
        choices: [{ label: 'Thank you' }],
      },
      { do: 'pay', from: 'fisher', coins: 0, memory: 'The wood for the canoe' },
      { do: 'release', who: 'fisher' },
    ],
  },
  // ── After the canoe: out with the fisher after the golden fish — and the pirates ──
  {
    id: 'goldenFish', title: 'The golden fish', waitS: 90, failWaitS: 45, restartAt: 'retry',
    downText: 'You went down — {fisher} got you both back to shore somehow. {fisher.He}\'ll want another go.',
    beats: [
      { do: 'seek', who: 'fisher' },
      {
        do: 'talk', who: 'fisher', reward: 'Out in the canoe with {fisher}',
        lines: [
          ['fisher', '{name}! I\'ve been dying to take her out. And now I can go after the golden fish.'],
          ['fisher', 'My grandad saw her once, out past the docks — scales like a new coin, big as your arm. Nobody\'s ever landed her.'],
          ['fisher', 'Come out with me? You paddle, I\'ll keep watch. Bring a rod — here, take one if you need it.'],
        ],
        choices: [{ label: 'Let\'s find her', then: ['give:rod', 'goto:crew'] }, { label: 'Later', then: ['later'] }],
      },
      // (back for another go — after 'Later', or a go that went wrong: restartAt)
      { do: 'seek', label: 'retry', who: 'fisher', queue: true },
      {
        do: 'talk', who: 'fisher', reward: 'Out in the canoe with {fisher}',
        lines: [['fisher', 'Ready to go after the golden fish, {name}? She\'s out there somewhere — I can feel it.']],
        choices: [{ label: 'Let\'s go', then: ['give:rod'] }, { label: 'Later', then: ['later'] }],
      },
      { do: 'canoeCrew', label: 'crew', checkpoint: true, who: 'fisher' },
      // (the pirate ship: off its anchor, out on the horizon past the fishing grounds, waiting — townPirates.js)
      { do: 'ship', mode: 'park' },
      // (out on the water: no talk box, no buttons — he just says it, and the arrows go on)
      { do: 'say', who: 'fisher', lines: ['In we get! Follow the arrows out — the herring run just past the docks.', 'She might be swimming with them. Keep your eyes peeled.'] },
      { do: 'paddle', to: 'sea1', r: 5, stop: true, text: 'Paddle out to the first fishing spot' },
      { do: 'say', who: 'fisher', lines: ['Here\'ll do. Cast over the side and let\'s see what bites.'] },
      { do: 'fishHere', text: 'Catch a fish', talks: { fisher: { lines: [['fisher', 'Cast over the side — a swing forward. Pull when the bobber goes under, reel when it tires.']] } } },
      { do: 'say', who: 'fisher', lines: ['A herring! A fine one — but not her.', 'She keeps further out, where the water\'s deep. Oar out — follow the arrows.'] },
      { do: 'paddle', to: 'sea2', r: 5, stop: true, text: 'Paddle further out' },
      { do: 'say', who: 'fisher', lines: ['This is it. Grandad\'s spot.', 'That ship\'s been sat on the horizon all morning. Never mind it. Cast out — gently now.'] },
      { do: 'fishHere', golden: true, text: 'Fish for the golden fish' },
      { do: 'pirates', who: 'fisher', bombers: 3, archers: 2 },
      { do: 'pilotHome', who: 'fisher', text: '{fisher} paddles you back to shore' },
      { do: 'canoeLand', who: 'fisher' },
      {
        do: 'talk', who: 'fisher', reach: 14, reward: 'Reward: 🪙 60',
        lines: [
          ['fisher', 'Pirates! In our bay! Wait till the sheriff hears.'],
          ['fisher', 'And she got away… but I saw her, {name}. We both did. Golden as anything.'],
          ['fisher', 'Here — sixty coins, for the sword work. I\'d have been fish food out there without you. We\'ll go after her again one day.'],
        ],
        choices: [{ label: 'Any time' }],
      },
      { do: 'pay', from: 'fisher', coins: 60, memory: 'The pirates and the golden fish' },
      { do: 'release', who: 'fisher' },
    ],
  },
  // ── After the golden fish got away: down after her with a bow — and the pirates again ──
  {
    id: 'goldenDive', title: 'Under the waves', waitS: 120, failWaitS: 45, restartAt: 'retry',
    downText: 'You went down — {fisher} got you both back to shore somehow. {fisher.He}\'ll want another go.',
    beats: [
      { do: 'seek', who: 'fisher' },
      {
        do: 'talk', who: 'fisher', reward: 'Diving with {fisher}',
        lines: [
          ['fisher', '{name}! I can\'t stop thinking about her. The golden fish. She won\'t take a hook — so we go down after her.'],
          ['fisher', 'Under the water, with a bow. An arrow on a string — spear her and wind her in. Have you got a bow?'],
        ],
        choices: [{ label: 'Let\'s see' }, { label: 'Later', then: ['later'] }],
      },
      { do: 'needItem', item: 'gun', who: 'fisher', ifMissing: 'nobow' },
      { do: 'talk', who: 'fisher', lines: [['fisher', 'A bow! Perfect. Down to the canoe, then.']], choices: [{ label: 'Let\'s go', then: ['goto:crew'] }] },
      // (no bow yet: he comes back once there is one — the seek's `needs`)
      {
        do: 'talk', label: 'nobow', who: 'fisher',
        lines: [['fisher', 'No bow? The weaponsmith in the shop sells them. Come find me once you\'ve bought one.']],
        choices: [{ label: 'I will', then: ['later'] }],
      },
      { do: 'seek', label: 'retry', who: 'fisher', queue: true, needs: 'gun', needsText: 'Buy a bow at the shop, then go and see {fisher}' },
      {
        do: 'talk', who: 'fisher', reward: 'Diving with {fisher}',
        lines: [['fisher', 'Ready to go down after the golden fish, {name}? Bring your bow.']],
        choices: [{ label: 'Let\'s go' }, { label: 'Later', then: ['later'] }],
      },
      { do: 'needItem', item: 'gun', who: 'fisher', ifMissing: 'nobow' },
      { do: 'canoeCrew', label: 'crew', checkpoint: true, who: 'fisher' },
      { do: 'say', who: 'fisher', lines: ['Follow the arrows out past the herring grounds — where it gets deep.'] },
      { do: 'paddle', to: 'dive', r: 5, text: 'Paddle out to where it gets deep' },
      {
        do: 'say', who: 'fisher',
        lines: [
          'Here. Now — I bought a potion off the wizard this morning. Cost me a week\'s catch.',
          'A drop each, and we\'ll have a bubble of air round our heads under water. Lasts till the job\'s done.',
          'Over the side with you, then hold Dive to go under. Stay close!',
        ],
      },
      { do: 'potion', on: true },
      { do: 'diveOut', who: 'fisher' },
      { do: 'diveLead', who: 'fisher', to: 'diveA', r: 5, text: 'Follow {fisher} under water' },
      {
        do: 'say', who: 'fisher',
        lines: [
          'See them? Hold the Bow to aim — let go and the arrow flies on its string.',
          'Spear one, then wind it in on the reel. Go on — try it.',
        ],
      },
      { do: 'diveFish', at: 'diveA', count: 2, text: 'Spear a fish with the bow — hold Bow to aim, let go to shoot' },
      { do: 'say', who: 'fisher', lines: ['That\'s it! A natural.', 'Now follow me — she keeps deeper. I can feel it.'] },
      { do: 'diveLead', who: 'fisher', to: 'diveB', r: 5, text: 'Follow {fisher} deeper' },
      { do: 'say', who: 'fisher', lines: ['THERE! Golden as the sun… Easy now. Take your time.'] },
      { do: 'diveFish', at: 'diveB', golden: true, text: 'Spear the golden fish!' },
      // (while the player's still under: the pirate ship's there all at once, out of sight in the murk)
      { do: 'ship', mode: 'lurk' },
      { do: 'say', who: 'fisher', lines: ['WE GOT HER! Grandad, you should see this!', 'Up we go — let\'s show the whole town!'] },
      { do: 'surface', who: 'fisher', text: 'Swim back up to the surface' },
      { do: 'pirateBombs', who: 'fisher', count: 3 },
      {
        do: 'feed', banner: ['TAKEN', 'The pirates have {fisher}'],
        lines: ['You come to in the canoe. Your head\'s ringing.', 'The pirates have {fisher} — and the golden fish. Their ship\'s making off!'],
      },
      { do: 'chaseShip', text: 'After the pirate ship!' },
      { do: 'feed', lines: ['They\'re too fast — the ship\'s gone over the horizon.', 'You\'ll never catch them in a canoe. Back to shore…'] },
      { do: 'paddle', to: 'mooring', r: 6, text: 'Paddle back to shore' },
      { do: 'canoeLand' },
      { do: 'feed', lines: ['{fisher} is gone. Somewhere out there, the pirates have {fisher.him}.'] },
    ],
  },
  // ── After the pirates took him: his cousin, a night crossing to Tree Island, and the pirates'
  // ship moored off it (beats/rescue.js) ──
  {
    id: 'fisherRescue', title: 'Rescue the fisher', waitS: 60, failWaitS: 40, restartAt: 'retry', quiet: true,
    downText: 'You went down — {cousin} got you both back across somehow. {cousin.He}\'ll come for you again after dark.',
    beats: [
      { do: 'seek', who: 'cousin', anyTime: true },
      {
        do: 'talk', who: 'cousin', reward: 'Rescue {fisher}',
        lines: [
          ['cousin', '{name}… you went out on the water with my cousin {fisher}, didn\'t you? {fisher.He} never came home. Have you seen {fisher.him}?'],
          ['you', 'The pirates took {fisher.him}. They bombed us out on the water — when I came to, {fisher.he} was gone, and their ship was making off.'],
          ['cousin', 'Pirates?! …That ship. I saw a ship last night, lights low, anchored off the coast of Tree Island. It has to be them.'],
          ['cousin', 'We\'re going to get {fisher.him} back, you and me.'],
        ],
        choices: [{ label: 'We\'ll get {fisher.him} back' }, { label: 'Later', then: ['later'] }],
      },
      { do: 'needItem', item: 'gun', who: 'cousin', ifMissing: 'nobow' },
      { do: 'giveItem', item: 'lockpick', who: 'cousin', say: 'Here — a lock-pick. They\'ll have {fisher.him} locked up.' },
      { do: 'night', ifDay: 'tonight' },
      {
        do: 'talk', who: 'cousin',
        lines: [['cousin', 'It\'s dark already — good. Let\'s go now, while they sleep. The canoe\'s down by the fishing spot.']],
        choices: [{ label: 'Let\'s go', then: ['goto:go'] }, { label: 'Later', then: ['later'] }],
      },
      {
        do: 'talk', label: 'tonight', who: 'cousin',
        lines: [['cousin', 'Not in broad daylight, though — they\'d see us coming a mile off. I\'ll come and find you tonight, once it\'s dark.']],
        choices: [{ label: 'Tonight, then', then: ['goto:retry'] }],
      },
      // (no bow: back once there is one — after dark)
      {
        do: 'talk', label: 'nobow', who: 'cousin',
        lines: [['cousin', 'No bow? You\'ll need one — they\'ll have someone on watch. The weaponsmith in the shop sells them. Come find me once you\'ve bought one.']],
        choices: [{ label: 'I will', then: ['later'] }],
      },
      // (after dark — and back for another go after a fail / 'Later': restartAt)
      { do: 'seek', label: 'retry', who: 'cousin', nightOnly: true, queue: true, needs: 'gun', needsText: 'Buy a bow at the shop — {cousin} wants to rescue {fisher} after dark', dayText: '{cousin} will come and find you tonight, once it\'s dark' },
      {
        do: 'talk', who: 'cousin', reward: 'Rescue {fisher}',
        lines: [['cousin', 'It\'s dark, {name}. Ready to go after {fisher}? The pirates\' ship is off Tree Island — we\'ll take the canoe.']],
        choices: [{ label: 'Let\'s go' }, { label: 'Later', then: ['later'] }],
      },
      { do: 'needItem', item: 'gun', who: 'cousin', ifMissing: 'nobow' },
      { do: 'giveItem', item: 'lockpick', who: 'cousin', say: 'Take this lock-pick — they\'ll have {fisher.him} locked up.' },
      { do: 'islandPlan', label: 'go', key: 'treeIsland', failText: 'The sea\'s too rough to cross tonight — {cousin} will try again tomorrow night.' },
      { do: 'canoeCrew', who: 'cousin' },
      // (the pirates' ship moored off the island's coast, {fisher} in a cage on its deck, one on watch)
      { do: 'pirateMoor', key: 'treeIsland', who: 'fisher' },
      { do: 'say', who: 'cousin', lines: ['Follow the arrows across to Tree Island. Quiet as you can.', 'We\'ll land on the beach and walk the rest — a canoe\'s easy to spot on open water.'] },
      { do: 'paddle', to: 'islandLanding', r: 9, text: 'Paddle across to Tree Island' },
      { do: 'canoeLand', who: 'cousin', stay: true },
      { do: 'say', who: 'cousin', lines: ['The ship\'s round the point. Follow the shore — and keep low.'] },
      { do: 'sneak', key: 'treeIsland', who: 'cousin', count: 7 },
      { do: 'boardShip', text: 'Climb aboard the pirate ship — find {fisher}' },
      { do: 'pickCage', who: 'fisher' },
      { do: 'boarders', count: 7, text: 'Fight off the pirates coming over the rails' },
      { do: 'say', who: 'fisher', lines: ['That\'s the lot of them! Back to the canoe — before more wake up!'] },
      { do: 'canoeCrew', who: 'fisher', also: 'cousin' },
      { do: 'say', who: 'cousin', lines: ['Home we go. Follow the arrows back to Brindlewick.'] },
      { do: 'paddle', to: 'mooring', r: 6, text: 'Paddle home to Brindlewick' },
      { do: 'canoeLand', who: 'fisher', also: 'cousin' },
      { do: 'freeCaptive', who: 'fisher' },
      {
        do: 'talk', who: 'fisher', reach: 8, reward: 'The golden fish',
        lines: [
          ['fisher', 'Home. Solid ground under my feet. I never thought I\'d see Brindlewick again.'],
          ['cousin', 'You owe {name} for this, cousin. We both do.'],
          ['fisher', 'I know it. {name} — here. The golden fish. I grabbed her back off their captain\'s table on the way out.'],
          ['fisher', 'She\'s yours. Grandad would\'ve wanted her to go to whoever earned her.'],
          ['fisher', 'And when those bandits come for the town at night — I\'ll be out there with you and the sheriff, bow in hand. Count on it.'],
        ],
        choices: [{ label: 'Thank you' }],
      },
      {
        do: 'giveGoods', who: 'fisher', good: 'goldenFish', count: 1,
        text: '{fisher} gave you the golden fish.',
        popup: { icon: '🐠', title: 'The golden fish', sub: 'Cook it at the campfire for a golden elixir' },
      },
      { do: 'defender', who: 'fisher' },
      { do: 'pay', from: 'fisher', coins: 0, memory: 'The rescue from the pirates', say: 'I\'ll be ready when the bandits come.' },
      { do: 'release', who: 'cousin' },
      { do: 'release', who: 'fisher' },
    ],
  },
];

export const BRANCHES = [
  { id: 'wizard', title: 'The wizard', jobs: WIZARD_JOBS },
  { id: 'fisher', title: 'The fisher', jobs: FISHER_JOBS },
];

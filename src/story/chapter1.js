// Story mode — chapter 1, "Washed Up": the data. What's said, the choices, the steps, the
// quest tracker, the act labels and the notes. The engine (storyMode.js) runs it: no story text
// lives there, and nothing here touches the game. A new chapter is a new file shaped like this one.
//
// The story so far:
//   intro → the cut scene: washed up on Tree Island's coast, up onto a stone, the flute. The Crow
//           flies in: "Give me your flute." (talks.crow.arrive)
//   crow  → Give the flute (game over) / Throw a rock (a side quest — later) / What is this place?
//   fish  → it wants a fish first: the old rod leans on the canoe moored off the beach (the canoe is
//           holed — WOOD_NEEDED wood mends it), fish from the shore
//   tree  → the fish to the Crow: it tells of the sacred tree somewhere on the island that can help
//   wood  → the sacred tree (the wise tree — a face in its bark) gives the
//           player a sword: chop down trees for wood (Town's chopping — townTrees.js)
//   done  → the canoe mended → "To be continued…"
//
// The chapter is a quest (QUEST — run by the shared quest runner, src/quest/questRunner.js, as
// Town's first day and jobs are): its beats are the steps, each a `wait` with what talking to
// someone says while it's the step (`talks`) and the tracker's line (`entry`); a talk moves the
// story on with 'goto:<step>'. Open-ended: talk to whoever, whenever.
// Talks: TALKS[who][key] is { lines, choices?, then? } or a function of the state view
// (storyMode.js `view`: { step, fish, wood, hasRod, hasSword, canoeFixed }) returning one.
//   lines   — [who, text] pairs, one at a time (Go on between them)
//   choices — the last line's buttons: { label, then }; none → Okay
//   then    — actions run when it ends (or on a choice): 'goto:<step>' 'note:<key>'
//             'talk:<who>' (that one's talk for the step now) / 'talk:<who>:<key>' and the engine's own (ACTIONS in
//             storyMode.js): 'giveFlute' 'takeFish' 'putFluteAway' 'giveSword' 'endChapter'
// Speakers: VOICES (text to speech — Town's, speech.js).

export const CHAPTER = { id: 1, title: 'Washed Up', place: 'Tree Island', island: 'treeIsland' };


export const WOOD_NEEDED = 3;   // to mend the canoe (a felled tree's logs: one wood each)

export const CROW = 'Crow';
export const TREE = 'Sacred Tree';
export const VOICES = {
  [CROW]: { kind: 'gruff', family: 'crow' },
  [TREE]: { kind: 'old', family: 'tree' },
};

const CROW_CHOICES = [
  { label: 'Give the flute', then: ['giveFlute'] },
  { label: 'Throw a rock', then: ['note:rock', 'talk:crow'] },
  { label: 'What is this place?', then: ['talk:crow:info'] },
];

export const TALKS = {
  crow: {
    // (the cut scene: it's just landed)
    arrive: {
      lines: [[CROW, 'Caw! What a pretty tune.'], [CROW, "That's a fine flute, boy. Give me your flute."]],
      choices: CROW_CHOICES,
    },
    crow: { lines: [[CROW, "That's a fine flute, boy. Give me your flute."]], choices: CROW_CHOICES },
    give: { lines: [[CROW, 'Caw! A wise choice. Much obliged!']] },
    info: {
      lines: [
        [CROW, 'What is this place? Caw! Answers cost something on this island.'],
        [CROW, "Bring me a fish. Then we'll talk."],
        [CROW, "There's an old fishing rod leaning in that canoe off the beach. The canoe's holed through, mind — but you can fish from the shore."],
      ],
      then: ['putFluteAway', 'goto:fish', 'note:findRod'],
    },
    fish: (v) => (v.fish > 0
      ? {
        lines: [
          [CROW, "A fish! Caw! For me? Oh, you shouldn't have."],
          [CROW, "A deal's a deal. This is Tree Island. Nobody comes here on purpose."],
          [CROW, "There's a sacred tree somewhere on this island. Old — older than me, even. It can help you."],
          [CROW, "Head straight up the beach, into the trees. And look closely. It doesn't like to be found."],
        ],
        then: ['takeFish', 'goto:tree', 'note:findTree'],
      }
      : {
        lines: [
          [CROW, 'No fish, no talk. Caw!'],
          [CROW, v.hasRod ? 'Cast from the shore, boy. The fish are out in the water.' : 'The rod is leaning in the canoe, off the beach.'],
        ],
      }),
    tree: {
      lines: [[CROW, "The sacred tree, boy. Straight up the beach, into the trees. Look closely — it hides."]],
    },
    wood: (v) => ({
      lines: v.wood >= WOOD_NEEDED
        ? [[CROW, "That's wood enough. Mend that canoe of yours. Caw!"]]
        : [[CROW, 'A sword! The old tree likes you. Caw!'], [CROW, 'Plenty of trees on Tree Island. Chop one down, split the logs and mend that canoe.']],
    }),
    done: { lines: [[CROW, 'Caw! A canoe that floats. Where will you go, boy? More next time.']], then: ['endChapter'] },
  },
  tree: {
    // (talked to before the Crow's told the player about it: it stays a tree — no act shows)
    tree: {
      lines: [
        [TREE, 'Hrrm…? You can see me, little one?'],
        [TREE, 'Few do. I am the tree the Crow spoke of. They call me sacred. Mostly I am tired.'],
        [TREE, 'Washed up with a flute and nothing more, I see. This island is not kind to the empty-handed.'],
        [TREE, 'Take this. It was left here long ago, by another who washed up on these shores.'],
        [TREE, 'Fell a tree or two with it and split the logs. Three pieces of wood will mend that canoe.'],
        [TREE, 'Not me, mind. Nor my friends here.'],
      ],
      choices: [{ label: 'Thank you', then: ['giveSword', 'goto:wood', 'note:gotSword'] }],
    },
    wood: (v) => ({
      lines: v.wood >= WOOD_NEEDED
        ? [[TREE, 'Enough wood, little one. Go and mend your canoe.']]
        : [[TREE, `Fell a tree — not one of us — and split the logs. ${WOOD_NEEDED} pieces of wood.`], [TREE, 'Now let an old tree rest.']],
    }),
    done: { lines: [[TREE, 'Hrrm. The sea is wide, little one. Go carefully.']] },
  },
};

// Feed notes (the engine's own, and `note:<key>` in talks)
export const NOTES = {
  rock: 'Throwing a rock at the Crow — that side quest is coming later.',
  findRod: 'Get the rod from the canoe and catch the Crow a fish.',
  gotRod: 'You took the old fishing rod.',
  fishCaught: 'A fish! Take it to the Crow.',
  findTree: 'Find the sacred tree: up the beach, into the trees.',
  gotSword: 'The sacred tree gave you a sword.',
  canoeBroken: `The canoe is holed through. It needs ${WOOD_NEEDED} wood to mend.`,
  chopSwing: 'Swing your sword at a tree to chop it down, then at its logs.',
  canoeFixed: 'You mended the canoe.',
  bagFull: (max) => `You can't carry any more fish (${max}).`,
  noIsland: 'Tree Island failed to load.',
  noShore: "Couldn't find the shore of Tree Island.",
};

// The buttons (Town's acts, bottom centre)
export const ACTS = {
  crow: 'Talk to the Crow',
  tree: 'Talk to the tree',
  rod: 'Take the rod',
  fix: 'Mend the canoe',
  canoe: 'Get in the canoe',
  out: 'Get out',
  chop: 'Chop',
  lobby: 'Back to Lobby',
};

// Mending the canoe (the act, with the wood): what happens
export const FIX_CANOE_THEN = ['note:canoeFixed', 'goto:done', 'endChapter'];

export const BANNERS = {
  gameOver: ['GAME OVER', 'The Crow flew off with your flute.'],
  end: ['To be continued…', `Chapter ${CHAPTER.id} — ${CHAPTER.title}`],
};

// The chapter: its steps, in order (the save's `step` is the beat's label). intro = the cut
// scene (the engine moves on to crow when the Crow lands); entry = the quest tracker's line.
export const QUEST = {
  id: `chapter${CHAPTER.id}`, title: CHAPTER.title,
  beats: [
    { do: 'wait', label: 'intro', checkpoint: true },
    { do: 'wait', label: 'crow', checkpoint: true, talks: { crow: TALKS.crow.crow } },
    {
      do: 'wait', label: 'fish', checkpoint: true, talks: { crow: TALKS.crow.fish },
      entry: (v) => (v.fish > 0
        ? { icon: '❓', title: 'A fish for the Crow', progress: 'Take it to the Crow' }
        : { icon: '📍', title: 'A fish for the Crow', progress: v.hasRod ? 'Catch a fish' : 'Get the rod from the canoe' }),
    },
    {
      do: 'wait', label: 'tree', checkpoint: true, talks: { crow: TALKS.crow.tree, tree: TALKS.tree.tree },
      entry: { icon: '📍', title: 'The sacred tree', progress: 'Up the beach, into the trees' },
    },
    {
      do: 'wait', label: 'wood', checkpoint: true, talks: { crow: TALKS.crow.wood, tree: TALKS.tree.wood },
      entry: (v) => (v.wood >= WOOD_NEEDED
        ? { icon: '📍', title: 'Mend the canoe', progress: 'Take the wood to the canoe' }
        : { icon: '📍', title: 'Mend the canoe', progress: `Chop a tree for wood (${v.wood}/${WOOD_NEEDED})` }),
    },
    { do: 'wait', label: 'done', checkpoint: true, talks: { crow: TALKS.crow.done, tree: TALKS.tree.done } },
  ],
};
export const STEPS = QUEST.beats.map((b) => b.label);
export const stepAtLeast = (step, than) => STEPS.indexOf(step) >= STEPS.indexOf(than);

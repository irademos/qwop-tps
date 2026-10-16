// Sword Showdown: each stage's final enemy talks first, then fights (or, once, doesn't).
//
// When the player walks up to it (bootstrapGameApp.js, BOSS_TALK_DIST) everything holds its
// attacks and a box plays the conversation out a line at a time, like the villager's in the
// village (the same .village-talk look). The first ones only growl; stage by stage they find
// their words and tell the player what Pemberton really is — each "monster" is someone he
// took something from: the frog man's fen, the pumpkin's patch, the gemhorn's gems, the Mii's
// boat, the tree creature's wood, the wizard's herb gardens, the antler smith's forge (see
// VILLAGER_QUESTS in src/village/villageMode.js, Pemberton's side of the story). The stage before Pemberton's guards (SPARED_STAGE) has convinced the player:
// that one is spared — no fight, it joins them. After the talk the boss grows a little,
// glows red and fights with a health bar across the top of the screen (createStageBoss in
// pembertonBoss.js) with more gear every stage (stageBossGear).

// Gear added stage by stage: stage 1 sword only, stage 2 + shield, stage 3 + bubble, …
export const STAGE_BOSS_GEAR_ORDER = ['shield', 'bubble', 'bombs', 'gun', 'wand'];
const GEAR_ICONS = { shield: '🛡️', bubble: '🫧', bombs: '💣', gun: '🔫', wand: '🪄' };
export function stageBossGear(stage) {
  const n = Math.max(0, Math.min(STAGE_BOSS_GEAR_ORDER.length, Math.floor(stage) - 1));
  const gear = {};
  STAGE_BOSS_GEAR_ORDER.forEach((k, i) => { gear[k] = i < n; });
  return gear;
}
/** "🗡️🛡️🫧" — what the stage's boss fights with (village banner). */
export function stageBossGearIcons(stage) {
  const gear = stageBossGear(stage);
  return `🗡️${STAGE_BOSS_GEAR_ORDER.filter((k) => gear[k]).map((k) => GEAR_ICONS[k]).join('')}`;
}
/** First stage whose boss has the wand (the wizard; wand enemies come after it). */
export const FIRST_WAND_BOSS_STAGE = STAGE_BOSS_GEAR_ORDER.indexOf('wand') + 2;

// Who each fightable character is and what Pemberton did to them. Each story stage is written
// for its character (STORY_BOSSES `char`; PS_STORY_BOSSES / PS_FIXED_BOSSES in
// bootstrapGameApp.js put it there). If an old save has a different character on a stage, the
// boss tells its own story instead: `growl` before TALKING_FROM_STAGE, `tell` after (the boss
// then goes by `name`). `village` = what it says idling in the village once it has joined the
// player (over its 🔄 Switch button).
export const CHARACTER_STORIES = {
  frog: {
    name: 'Fenn',
    growl: [
      ['action', 'Its skin is cracked and dry, like mud at the bottom of a drained pond.'],
      ['them', 'Grrr… WATER… grrr…'],
    ],
    tell: [
      ['them', 'I’m Fenn. My people lived in Thornwick Fen for a hundred years, until Pemberton drained it to grow his wheat.'],
    ],
    village: 'The fen will fill again one day. Frogs are patient.',
  },
  pumpkin: {
    name: 'Hob',
    growl: [
      ['action', 'It stands in the ashes of a burned pumpkin patch.'],
      ['them', 'Grrr… MY… PATCH…'],
    ],
    tell: [
      ['them', 'Name’s Hob. Pemberton burned my pumpkin patch to make room for his fields.'],
    ],
    village: 'I’m planting again behind the market. Pumpkins grow back.',
  },
  gemhorn: {
    name: 'Flint',
    growl: [
      ['action', 'Its horn is chipped and empty where gems used to sit.'],
      ['them', 'Grrr… he… TOOK… my… stones…'],
    ],
    tell: [
      ['them', 'I’m Flint. Pemberton pried the gems out of my horn and sold them.'],
    ],
    village: 'My horn’s growing back. Slowly. Don’t stare.',
  },
  mii1: {
    name: 'Pip',
    growl: [
      ['action', 'A torn fishing net is still tangled round its arm.'],
      ['them', 'My… BOAT… grrr…'],
    ],
    tell: [
      ['them', 'I’m Pip. Pemberton took my fishing boat, and the whole harbour with it.'],
    ],
    village: 'Got my boat back. Fish don’t care who owns the docks.',
  },
  tree: {
    name: 'Oldbark',
    growl: [
      ['action', 'Sawdust clings to its bark. It stands between you and the woods, roots dug in.'],
      ['them', 'Grrr… not… my… TREES…'],
    ],
    tell: [
      ['them', 'I am Oldbark. I guard the Fenwick Wood, and Pemberton is cutting it down for his sawmill. Not one more tree.'],
    ],
    village: 'Mind the saplings, {name}. I planted every one of them.',
  },
  wizard: {
    name: 'Alder',
    growl: [
      ['action', 'Empty herb pouches hang from its belt.'],
      ['them', 'Grrr… potions… for the… SICK…'],
    ],
    tell: [
      ['them', 'I’m Alder, a healer. Pemberton bought every herb garden so only he could sell medicine.'],
    ],
    village: 'Potions are fairly priced again. I checked.',
  },
  antler: {
    name: 'Bram',
    growl: [
      ['action', 'Its arms are scarred with old forge burns.'],
      ['them', 'Grrr… my… FORGE…'],
    ],
    tell: [
      ['them', 'I’m Bram, the smith. Pemberton took my forge and sold my anvil.'],
    ],
    village: 'I’m back at the forge. If your blade ever needs mending, {name}…',
  },
};
// From this stage on the bosses talk (before it: growls)
const TALKING_FROM_STAGE = 5;
/** What a character says idling in the village (null: nothing). */
export function characterVillageLine(key) {
  return CHARACTER_STORIES[key]?.village ?? null;
}

// The story's stage bosses (stage 1 = index 0; stages 1–10, the guards are stage 10).
// `char` = the character the stage is written for, `name` = how it calls itself (else the
// character's name), `lines` = [who, text] with who = 'them' / 'you' (a reply button) /
// 'action' ({name} = the player's name — createBossTalk's `fill`), `fight` = the button that
// starts the fight. `spare`: no fight — the button spares it (it joins the player).
const STORY_BOSSES = [
  { char: 'frog', // Thornwick road: the drained fen
    lines: [
      ['action', 'Something crouches in the dry ditch by the road. Its skin is cracked, like mud at the bottom of a drained pond.'],
      ['them', 'Grrr… WATER… grrr…'],
      ['them', 'GRRAAAAH!'],
    ],
    fight: '⚔️ Fight' },
  { char: 'pumpkin', // Ashford: the burned pumpkin patch
    lines: [
      ['action', 'It stands in the ashes of a burned pumpkin patch, between rows of new wheat.'],
      ['them', 'Grrr… MY… PATCH…'],
      ['you', 'Did it just say “my”?'],
      ['them', 'RRRAAAH!'],
    ],
    fight: '⚔️ Fight' },
  { char: 'gemhorn', // Greyhollow quarry: the gems in its horn
    lines: [
      ['action', 'Its horn is chipped, with empty holes where gems used to sit.'],
      ['them', 'Grrr… he… TOOK… my… stones…'],
      ['you', 'Who did?'],
      ['them', 'GRRAAH!'],
    ],
    fight: '⚔️ Fight' },
  { char: 'mii1', // Saltmere docks: the boat
    lines: [
      ['action', 'It stands on the pier, a torn fishing net still round its arm.'],
      ['them', 'My… boat… you… took… my… BOAT…'],
      ['you', 'I didn’t take anything.'],
      ['them', 'You… work… for HIM… RRAAH!'],
    ],
    fight: '⚔️ Fight' },
  { char: 'tree', name: 'Oldbark', // Fenwick Wood: the trees
    lines: [
      ['action', 'Stumps everywhere. One of the trees steps out of the treeline.'],
      ['them', 'Stop. Not one step further.'],
      ['you', 'You can talk?'],
      ['them', 'We all can. You never listened. I am Oldbark. I have guarded this wood for six hundred years.'],
      ['them', 'Pemberton has cut down half of it for his sawmill. Every plank in his manor was one of my trees.'],
      ['them', 'Not one more tree. Not while I stand.'],
    ],
    fight: '🌳 Fight' },
  { char: 'wizard', name: 'Alder', // Riverbend camp: the healer
    lines: [
      ['them', 'Not the camp. Please. There are sick people here.'],
      ['you', 'Pemberton says you’re monsters.'],
      ['them', 'I’m Alder. I was the healer at Riverbend, until Pemberton bought every herb garden and sold medicine to the sick at ten times the price. Here I heal them for nothing.'],
      ['them', 'If you want this camp, you’ll have to go through me.'],
    ],
    fight: '⚔️ Fight' },
  { char: 'antler', name: 'Bram', // Old Hearth: the forge
    lines: [
      ['action', 'He lowers his blade, just a little.'],
      ['them', 'I saw you at the camp, {name}. You stopped. Why?'],
      ['you', 'I don’t know any more.'],
      ['them', 'My name is Bram. I was the smith here, until Pemberton took my forge and sold my anvil.'],
      ['them', 'Remember that name when he asks how many you killed. But I won’t let you through to my family. En garde.'],
    ],
    fight: '⚔️ En garde' },
  { char: 'antler', name: 'Wren', // Highcrest Gate: Bram's sister, the ledger
    lines: [
      ['them', 'Bram was my brother.'],
      ['you', 'I’m sorry.'],
      ['them', 'Sorry. Do you even know what you’re fighting for, {name}?'],
      ['you', 'He pays me.'],
      ['them', 'He keeps a ledger of everything he’s taken. The fen. The patch. The gems. The boat. The wood. The gardens. The forge. Read it. Then decide who the monster is.'],
      ['them', 'But you’ll have to get past me first.'],
    ],
    fight: '⚔️ Fight' },
  { name: 'Marta', // the road to Gould Manor: spared
    lines: [
      ['action', 'She steps into the road, blade up — then sees your face.'],
      ['them', 'So, {name}. You read the ledger.'],
      ['you', 'Every page. I’m going after him.'],
      ['them', 'Then for once we’re on the same side. I won’t fight you, and you won’t fight me.'],
      ['action', 'She lowers her blade.'],
      ['them', 'His guards are waiting at the manor. Go.'],
    ],
    spare: '🤝 Lower your sword' },
  { name: 'Guard Captain', // Gould Manor's guards
    lines: [
      ['them', 'Halt! Mr. Pemberton’s orders: no monsters past this gate.'],
      ['you', 'Read his ledger. He’s the monster.'],
      ['them', 'He pays me, {name}. Same as he paid you.'],
      ['them', 'GUARDS! Hold the line!'],
    ],
    fight: '⚔️ Fight' },
];
// The stage whose boss is spared (the last before Pemberton's guards)
export const SPARED_STAGE = STORY_BOSSES.findIndex((b) => b.spare) + 1;
// After the story (Pemberton beaten): the road's real monsters, a line each
const ROAD_BOSSES = [
  [['them', 'Grrr… Pemberton gone… road is OURS now… GRRAAH!']],
  [['action', 'It growls and blocks the road.'], ['them', 'GRRRRR!']],
  [['them', 'You beat Pemberton? Then beat me!']],
  [['them', 'Grrr… no… mercy… RRAAH!']],
];

/**
 * The talk of `stage`'s final enemy. `character` = its MATCH_CHARACTERS entry, `key` = its key.
 * @returns {{ speaker, name, lines, fight?, spare? }}
 * (`name` = shown over its health bar)
 */
export function stageBossTalk(stage, character, { afterStory = false, key = null } = {}) {
  const s = Math.max(1, Math.floor(stage) || 1);
  let story = !afterStory ? STORY_BOSSES[s - 1] : null;
  const emoji = character?.emoji ?? '👹';
  const own = CHARACTER_STORIES[key];
  const talking = s >= TALKING_FROM_STAGE;
  // A different character on a story stage (an old save had it unlocked): its own story
  if (story?.char && key && key !== story.char) {
    const lines = (talking ? own?.tell : own?.growl)
      ?? (talking ? [['them', 'Pemberton sent you, didn’t he?']] : [['action', 'It growls and blocks the road.']]);
    story = {
      name: talking ? own?.name : null,
      lines: [...lines, ['them', talking ? 'Then come on.' : 'GRRAAH!']],
      fight: '⚔️ Fight',
    };
  }
  const name = story?.name ?? character?.label ?? 'Monster';
  return {
    speaker: `${emoji} ${name}`,
    name: `${emoji} ${name}`,
    lines: story?.lines ?? ROAD_BOSSES[(s - 1) % ROAD_BOSSES.length],
    fight: story?.spare ? null : (story?.fight ?? '⚔️ Fight'),
    spare: story?.spare ?? null,
  };
}

const TALK_WORDS_PER_SEC = 13; // as the villager's

// Auto-continue: once a line has played out it waits long enough to read, then goes on by
// itself — and when it ends on buttons, picks the first one (the one that carries on / starts
// the fight or stage). Shared with the villager's talk (villageMode.js).
export const TALK_AUTO_BASE_S = 1.4;      // every line waits at least this long…
export const TALK_AUTO_PER_WORD_S = 0.28; // …plus this per word (line + buttons)
export const TALK_AUTO_CHOICE_S = 1.2;    // extra wait when buttons are showing
export const TALK_AUTO_MAX_S = 9;
/** Seconds a finished line waits before the talk goes on by itself. */
export function talkAutoHoldSeconds(words, choiceLabels = null) {
  const choiceWords = choiceLabels
    ? choiceLabels.reduce((n, label) => n + String(label).split(/\s+/).filter(Boolean).length, 0)
    : 0;
  return Math.min(TALK_AUTO_MAX_S,
    TALK_AUTO_BASE_S + (words + choiceWords) * TALK_AUTO_PER_WORD_S + (choiceLabels ? TALK_AUTO_CHOICE_S : 0));
}

/**
 * The talk box (bottom centre, over the HUD). One line at a time, played out a word or two at
 * a time; tapping it (or Enter) finishes the line / goes on. A 'you' line is a reply button;
 * the last line ends with the fight / spare button. `fill(text)` fills a line's {name}.
 * A finished line goes on by itself after talkAutoHoldSeconds (buttons: the first one).
 * @returns {{ open(talk, onDone: (choice: 'fight'|'spare') => void): void, close(): void,
 *             update(dt: number): void, isOpen(): boolean, interact(): void,
 *             interactLabel(): string|null }}
 */
export function createBossTalk({ fill = (text) => text } = {}) {
  const layer = document.createElement('div');
  layer.className = 'boss-talk-layer hidden';
  layer.innerHTML = `
    <div class="boss-talk village-talk ui-panel">
      <div class="village-talk-head"><span class="village-talk-who" data-b="who"></span><span class="village-talk-quest" data-b="sub"></span></div>
      <div class="village-talk-text" data-b="text"></div>
      <div class="village-talk-more hidden" data-b="more">▼</div>
      <div class="village-talk-choices" data-b="choices"></div>
    </div>`;
  document.body.appendChild(layer);
  const $ = (k) => layer.querySelector(`[data-b="${k}"]`);
  const box = layer.querySelector('.boss-talk');
  const el = { who: $('who'), sub: $('sub'), text: $('text'), more: $('more'), choices: $('choices') };
  let talk = null; // { data, onDone, i, who, words, shown, acc, done, choices, wait }

  const setLine = (who, text) => {
    talk.who = who;
    talk.words = String(fill(text)).split(/\s+/).filter(Boolean);
    talk.shown = 0;
    talk.acc = 0;
    talk.done = false;
    talk.choices = null;
    talk.wait = 0;
    box.classList.toggle('is-action', who === 'action');
    el.who.textContent = who === 'action' ? '' : talk.data.speaker;
    el.choices.replaceChildren();
    el.more.classList.add('hidden');
    render();
  };
  // (the rest of the line is laid out invisibly, so the box doesn't grow as it plays out)
  const render = () => {
    const shown = talk.words.slice(0, talk.shown).join(' ');
    const rest = talk.words.slice(talk.shown).join(' ');
    const restEl = document.createElement('span');
    restEl.className = 'village-talk-rest';
    restEl.textContent = (shown && rest ? ' ' : '') + rest;
    el.text.replaceChildren(document.createTextNode(shown), restEl);
  };
  const showChoices = (reply) => {
    const finish = (choice) => {
      const done = talk.onDone;
      close();
      done(choice);
    };
    const options = reply
      ? [[fill(reply[1]), () => { talk.i += 1; nextLine(); }, 'ui-btn-secondary']]
      : talk.data.spare
        ? [[talk.data.spare, () => finish('spare'), 'ui-btn']]
        : [[talk.data.fight, () => finish('fight'), 'ui-btn']];
    talk.choices = options;
    talk.wait = 0;
    el.more.classList.add('hidden');
    el.choices.replaceChildren(...options.map(([label, onClick, cls]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `${cls} village-talk-choice`;
      b.textContent = label;
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        if (talk?.choices === options) onClick();
      });
      return b;
    }));
  };
  const nextLine = () => {
    if (!talk) return;
    const line = talk.data.lines[talk.i + 1];
    if (!line || line[0] === 'you') {
      talk.shown = talk.words.length;
      talk.done = true;
      render();
      showChoices(line);
      return;
    }
    talk.i += 1;
    setLine(line[0], line[1]);
  };
  const finishLine = () => {
    talk.shown = talk.words.length;
    talk.done = true;
    render();
    const next = talk.data.lines[talk.i + 1];
    if (!next || next[0] === 'you') showChoices(next);
    else el.more.classList.remove('hidden');
  };
  const advance = () => {
    if (!talk) return;
    if (!talk.done) finishLine();
    else if (!talk.choices) nextLine();
  };
  // Enter / E / the phone's interact button: finish the line / next / the first button
  const interact = () => {
    if (!talk) return;
    if (talk.choices && talk.done) talk.choices[0][1]();
    else advance();
  };
  box.addEventListener('click', (e) => { if (!e.target.closest('button')) advance(); });
  const onKeyDown = (e) => {
    if (!talk || e.repeat || (e.key !== 'Enter' && e.key !== 'e' && e.key !== 'E')) return;
    if (e.target?.closest?.('input, textarea, select')) return;
    e.preventDefault();
    interact();
  };
  window.addEventListener('keydown', onKeyDown);

  function close() {
    talk = null;
    layer.classList.add('hidden');
    document.body.classList.remove('boss-talking');
  }

  return {
    isOpen: () => !!talk,
    interact,
    /** What the phone's interact button says right now. */
    interactLabel: () => (!talk ? null : talk.done && talk.choices ? `${talk.choices[0][0]}` : '▶ NEXT'),
    open(data, onDone) {
      talk = { data, onDone, i: -1, who: 'them', words: [], shown: 0, acc: 0, done: true, choices: null, wait: 0 };
      el.sub.textContent = data.spare ? '' : 'Final enemy';
      layer.classList.remove('hidden');
      document.body.classList.add('boss-talking');
      nextLine();
    },
    close,
    update(dt) {
      if (!talk) return;
      if (talk.done) {
        // (read it, then on by itself)
        talk.wait += dt;
        const hold = talkAutoHoldSeconds(talk.words.length, talk.choices?.map((c) => c[0]) ?? null);
        if (talk.wait >= hold) interact();
        return;
      }
      talk.acc += dt * TALK_WORDS_PER_SEC;
      const n = Math.min(talk.words.length, Math.floor(talk.acc));
      if (n === talk.shown) return;
      talk.shown = n;
      if (n >= talk.words.length) finishLine();
      else render();
    },
  };
}

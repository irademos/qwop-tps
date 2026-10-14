// Sword Showdown: each stage's final enemy talks first, then fights (or, once, doesn't).
//
// When the player walks up to it (bootstrapGameApp.js, BOSS_TALK_DIST) everything holds its
// attacks and a box plays the conversation out a line at a time, like the villager's in the
// village (the same .village-talk look). The first ones only growl; stage by stage they find
// their words and tell the player what Pemberton really is — the "monsters" are the people
// he ruined with debts (see VILLAGER_QUESTS in src/village/villageMode.js, the other side of
// the story). The stage before Pemberton's guards (SPARED_STAGE) has convinced the player:
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

// The story's stage bosses (stage 1 = index 0; stages 1–10, the guards are stage 10).
// `name` = how it calls itself (else the character's name), `lines` = [who, text] with who =
// 'them' / 'you' (a reply button) / 'action' ({name} = the player's name — createBossTalk's
// `fill`), `fight` = the button that starts the fight.
// `spare`: no fight — the button spares it (it joins the player).
const STORY_BOSSES = [
  { // → Thornwick (the letter)
    lines: [
      ['action', 'It blocks the road, teeth bared.'],
      ['them', 'Grrrrrr…'],
      ['them', 'GRRAAAAH!'],
    ],
    fight: '⚔️ Fight' },
  { // → Ashford (the granaries)
    lines: [
      ['them', 'Grrr… grain… OURS… grrr…'],
      ['you', 'Did it just say “ours”?'],
      ['them', 'RRRAAAH!'],
    ],
    fight: '⚔️ Fight' },
  { // → Greyhollow (the quarry)
    lines: [
      ['action', 'It holds its sword the way you’d hold a pickaxe.'],
      ['them', 'Grrr… go… HOME… grrr…'],
      ['you', 'I can’t. I’ve got a job to do.'],
      ['them', 'GRRAAH!'],
    ],
    fight: '⚔️ Fight' },
  { // → Saltmere (the docks)
    lines: [
      ['them', 'Grrr… you… don’t… KNOW…'],
      ['you', 'You can talk?'],
      ['them', 'He… sends you… grrr… HE is the… RRAAAH!'],
    ],
    fight: '⚔️ Fight' },
  { // → Fenwick (the mill)
    lines: [
      ['them', 'You again. The one he sends.'],
      ['you', 'You really can talk.'],
      ['them', 'We all can. Nobody listens. Pemberton bought this mill and stopped paying us. Twelve weeks of wages. We painted it on his walls so he’d remember.'],
      ['them', 'He sent you instead. So be it.'],
    ],
    fight: '⚔️ Fight' },
  { // → Riverbend (the camp)
    lines: [
      ['them', 'Not the camp. Please. There are children here.'],
      ['you', 'Pemberton says you’re monsters.'],
      ['them', 'Pemberton took our farms for debts we never signed. This camp is all we have left. If you want it, you’ll have to go through me.'],
    ],
    fight: '⚔️ Fight' },
  { // → Old Hearth (the road)
    name: 'Bram',
    lines: [
      ['action', 'He lowers his blade, just a little.'],
      ['them', 'I saw you at the camp, {name}. You stopped. Why?'],
      ['you', 'I don’t know any more.'],
      ['them', 'They say yours is {name}. Mine is Bram. I was the smith at Old Hearth, before the bank came for my forge. Remember that name when his man asks how many you killed.'],
      ['them', 'But I won’t let you through to my family. En garde.'],
    ],
    fight: '⚔️ En garde' },
  { // → Highcrest Gate
    name: 'Wren',
    lines: [
      ['them', 'Bram was my brother.'],
      ['you', 'I’m sorry.'],
      ['them', 'Sorry. Do you even know what you’re fighting for, {name}?'],
      ['you', 'He pays me.'],
      ['them', 'He pays you with our money. He keeps a ledger — every name, every debt. Bram’s in it. So am I. Find it. Read it. Then decide who the monster is.'],
      ['them', 'But you’ll have to get past me first. I can’t just let you through.'],
    ],
    fight: '⚔️ Fight' },
  { // → Gould Manor (after the ledger): spared
    name: 'Marta',
    lines: [
      ['action', 'She steps into the road, blade up — then sees your face.'],
      ['them', 'So, {name}. You read the ledger.'],
      ['you', 'Every name. I’m going after him.'],
      ['them', 'Then for once we’re on the same side. I won’t fight you, and you won’t fight me.'],
      ['action', 'She lowers her blade.'],
      ['them', 'His guards are waiting at the manor. Go — and make him pay what he owes.'],
    ],
    spare: '🤝 Lower your sword' },
  { // → Gould Manor's guards
    name: 'Guard Captain',
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
  [['them', 'Grrr… no… debts… no… mercy… RRAAH!']],
];

/**
 * The talk of `stage`'s final enemy. `character` = its MATCH_CHARACTERS entry.
 * @returns {{ speaker, name, lines, fight?, spare? }}
 * (`name` = shown over its health bar)
 */
export function stageBossTalk(stage, character, { afterStory = false } = {}) {
  const s = Math.max(1, Math.floor(stage) || 1);
  const story = !afterStory ? STORY_BOSSES[s - 1] : null;
  const emoji = character?.emoji ?? '👹';
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

/**
 * The talk box (bottom centre, over the HUD). One line at a time, played out a word or two at
 * a time; tapping it (or Enter) finishes the line / goes on. A 'you' line is a reply button;
 * the last line ends with the fight / spare button. `fill(text)` fills a line's {name}.
 * @returns {{ open(talk, onDone: (choice: 'fight'|'spare') => void): void, close(): void,
 *             update(dt: number): void, isOpen(): boolean }}
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
  let talk = null; // { data, onDone, i, who, words, shown, acc, done, choices }

  const setLine = (who, text) => {
    talk.who = who;
    talk.words = String(fill(text)).split(/\s+/).filter(Boolean);
    talk.shown = 0;
    talk.acc = 0;
    talk.done = false;
    talk.choices = null;
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
  box.addEventListener('click', (e) => { if (!e.target.closest('button')) advance(); });
  const onKeyDown = (e) => {
    if (!talk || e.repeat || (e.key !== 'Enter' && e.key !== 'e' && e.key !== 'E')) return;
    if (e.target?.closest?.('input, textarea, select')) return;
    e.preventDefault();
    if (talk.choices && talk.done) talk.choices[0][1]();
    else advance();
  };
  window.addEventListener('keydown', onKeyDown);

  function close() {
    talk = null;
    layer.classList.add('hidden');
    document.body.classList.remove('boss-talking');
  }

  return {
    isOpen: () => !!talk,
    open(data, onDone) {
      talk = { data, onDone, i: -1, who: 'them', words: [], shown: 0, acc: 0, done: true, choices: null };
      el.sub.textContent = data.spare ? '' : 'Final enemy';
      layer.classList.remove('hidden');
      document.body.classList.add('boss-talking');
      nextLine();
    },
    close,
    update(dt) {
      if (!talk || talk.done) return;
      talk.acc += dt * TALK_WORDS_PER_SEC;
      const n = Math.min(talk.words.length, Math.floor(talk.acc));
      if (n === talk.shown) return;
      talk.shown = n;
      if (n >= talk.words.length) finishLine();
      else render();
    },
  };
}

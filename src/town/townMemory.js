// Town: how townsfolk see the player — their mood (attitude, shown when talking to them), the
// town's opinion of the player (reputation: everyone's attitude together, a title in the top
// bar) and what they remember the player did (memories: gifts, help, harm — brought up when
// talked to, and what their attitude settles back to as it fades: someone the player saved stays
// fond of them, the family of someone they killed never forgets).
//
// A memory: { k: kind, d: town day, c: times (repeats the same day add up), ...data } — kept
// on the townsperson (n.mem, saved with the town; in a shared town with the player's own things).

import { firstName } from './townPeople.js';
import { FRIEND_ATTITUDE, GRUDGE_ATTITUDE, TALK_RANGE, el, pickOf } from './townConfig.js';

const MAX_MEMORIES = 6;
const MEMORY_DAYS = 14;              // days a memory lasts (the dead are remembered for good)
const MEMORY_TALK_S = 90;            // s between a townsperson bringing up the past
const MEMORY_TALK_CHANCE = 0.55;
const MEMORY_BIAS_MAX = 0.5;         // what memories can hold an attitude at, either way

// weight: how much it holds their attitude up (or down) as it fades; lines: what they say
// about it ({when}, {name}, {who}, {rel}, {what}, {c})
const KINDS = {
  gift:      { weight: 0.03, lines: ['You gave me coins {when}. I won\'t forget it.', 'Still thinking about those coins you gave me {when}, {name}.'] },
  helped:    { weight: 0.08, lines: ['You helped me out {when} — {what}. Thank you again.', 'Ah, {name}! You helped me {when}. Anything you need.'] },
  kidHome:   { weight: 0.15, lines: ['You brought {who} home {when}. I can\'t ever repay that.', 'Every time I see {who} playing, I think of you, {name}.'] },
  saved:     { weight: 0.12, lines: ['You saved me from {who} {when}! I owe you my life.', 'If you hadn\'t come along {when}… thank you, {name}.'] },
  intro:     { weight: 0.05, lines: ['Settling in, {name}? {what} {when} — you\'re a natural.', 'Good to see you, {name}. Remember {what} {when}?'] },
  customer:  { weight: 0.02, lines: ['My best supplier! That\'s {c} things you\'ve sold me {when}.', 'Bring me more like {when}, {name} — business is good.'], min: 4 },
  forgave:   { weight: 0.1, lines: ['You let my debt go {when}. I haven\'t forgotten.', 'Kindest thing anyone\'s done for me, {when}.'] },
  collected: { weight: -0.06, lines: ['You squeezed me for coins {when}. I remember.', 'Come to shake me down again, like {when}?'] },
  hurt:      { weight: -0.08, lines: ['You hit me {when}! I remember.', 'Stay back — you hit me {when}.'], over: ['You hit me {when}… but I suppose we\'re past that.'] },
  stole:     { weight: -0.05, lines: ['You took veg from my field {when}. I saw you.', 'Keep your hands off my crops this time.'] },
  sawMurder: { weight: -0.15, lines: ['I saw what you did to {who} {when}.', 'I know what you did to {who}. Everyone does.'] },
  killedKin: { weight: -0.6, lines: ['You killed my {rel}, {who}. I\'ll never forget.', '{who} was my {rel}. Murderer.'], forever: true },
  jailed:    { weight: -0.02, lines: ['Behaving yourself since the cell {when}?', 'Locked you up {when}. Don\'t make me do it again.'] },
};

// Mood toward the player (attitude −1..1), as shown when talking to them
export const moodOf = (a) => (a <= GRUDGE_ATTITUDE ? { emoji: '😠', label: 'Holds a grudge' }
  : a < -0.15 ? { emoji: '😒', label: 'Wary of you' }
    : a < 0.2 ? { emoji: '😐', label: 'Neutral' }
      : a < FRIEND_ATTITUDE ? { emoji: '🙂', label: 'Likes you' }
        : { emoji: '😊', label: 'Friend' });

// The town's opinion of the player (average attitude), as a title in the top bar
const REPUTATION = [
  { min: 0.55, emoji: '🌟', title: 'Hero of the town' },
  { min: 0.3, emoji: '😊', title: 'Well liked' },
  { min: 0.1, emoji: '🙂', title: 'Good neighbour' },
  { min: -0.1, emoji: '😐', title: 'Stranger' },
  { min: -0.35, emoji: '😒', title: 'Troublemaker' },
  { min: -Infinity, emoji: '😈', title: 'Menace' },
];
const reputationTier = (r) => REPUTATION.find((t) => r >= t.min);

// T: the town's shared state + functions (createTownMode in townMode.js); ctx: the game
export function installTownMemory(T, ctx) {
  // ── Memories ──
  const biasOf = (n) => {
    let b = 0;
    for (const m of n.mem ?? []) b += (KINDS[m.k]?.weight ?? 0) * Math.min(3, m.c ?? 1);
    return Math.max(-MEMORY_BIAS_MAX, Math.min(MEMORY_BIAS_MAX, b));
  };
  const remember = (n, k, data = {}) => {
    if (!n?.alive || !KINDS[k] || n.def.outlaw) return;
    const day = T.clock.day;
    n.mem = (n.mem ?? []).filter((m) => KINDS[m.k]?.forever || day - m.d <= MEMORY_DAYS);
    const same = n.mem.find((m) => m.k === k && m.d === day && (m.who ?? null) === (data.who ?? null));
    if (same) same.c = (same.c ?? 1) + 1;
    else {
      n.mem.push({ k, d: day, c: 1, ...data });
      // (too many: the oldest that isn't forever goes)
      while (n.mem.length > MAX_MEMORIES) {
        const i = n.mem.findIndex((m) => !KINDS[m.k]?.forever);
        n.mem.splice(i >= 0 ? i : 0, 1);
      }
    }
    n.memBias = biasOf(n);
  };
  const forget = (n) => { n.mem = []; n.memBias = 0; };
  const whenText = (m) => {
    const days = T.clock.day - m.d;
    return days <= 0 ? 'today' : days === 1 ? 'yesterday' : days < 5 ? 'a few days ago' : 'a while back';
  };
  // Something they remember, said when the player talks to them (null: nothing to bring up now)
  const memoryLine = (n) => {
    if (!n.mem?.length || T.simT - (n.memSaidAt ?? -1e9) < MEMORY_TALK_S || Math.random() > MEMORY_TALK_CHANCE) return null;
    // (the strongest feeling first, the most recent of equals)
    const m = [...n.mem].filter((x) => !KINDS[x.k].min || (x.c ?? 1) >= KINDS[x.k].min)
      .sort((a, b) => Math.abs(KINDS[b.k].weight) - Math.abs(KINDS[a.k].weight) || b.d - a.d)[0];
    if (!m) return null;
    n.memSaidAt = T.simT;
    const kind = KINDS[m.k];
    const lines = kind.over && n.attitude > 0.15 ? kind.over : kind.lines;
    const vars = { when: whenText(m), name: ctx.getPlayerName(), who: m.who ?? 'them', rel: m.rel ?? 'friend', what: m.what ?? 'that', c: m.c ?? 1 };
    const line = pickOf(lines).replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? '');
    return line.charAt(0).toUpperCase() + line.slice(1);
  };

  // ── Reputation ──
  const reputation = () => {
    const folk = T.npcs.filter((n) => n.alive && !n.def.outlaw);
    if (!folk.length) return 0;
    return folk.reduce((s, n) => s + n.attitude, 0) / folk.length;
  };
  const repEl = el('span', 'town-top-rep');
  T.top.append(el('span', 'town-top-sep', '·'), repEl);
  let repTitle = null;
  const updateReputation = () => {
    const tier = reputationTier(reputation());
    if (tier.title === repTitle) return;
    // (the first reading on arrival isn't news)
    if (repTitle) T.feedLine(`📣 The town now sees you as: ${tier.emoji} ${tier.title}`);
    repTitle = tier.title;
    repEl.replaceChildren(el('span', null, tier.emoji), el('span', 'town-top-rep-title', ` ${tier.title}`));
    repEl.title = 'What the town thinks of you';
  };

  // ── Who the player's talking to: their mood toward the player ──
  const relationEl = el('div', 'town-relation ui-panel hidden');
  const relWho = el('div', 'town-relation-who');
  const relBar = el('div', 'town-relation-bar');
  const relFill = el('div', 'town-relation-fill');
  relBar.append(relFill);
  const relNote = el('div', 'town-relation-note');
  relationEl.append(relWho, relBar, relNote);
  T.hud.append(relationEl);
  let relKey = '';
  const relationNote = (n) => {
    if (n.vendetta) return 'Wants revenge';
    if (n.attitude <= GRUDGE_ATTITUDE) return 'Won\'t trade with you';
    if (n.following) return 'Following you';
    if (n.attitude >= FRIEND_ATTITUDE) return n.role === 'merchant' ? 'Won\'t tell the guards · gives you a discount' : 'Won\'t tell the guards on you';
    return '';
  };
  const updateRelation = () => {
    const n = T.talking?.npc;
    const show = !!n && n.alive && !n.def.outlaw && !n.fighter && T.distToPlayer(n) < TALK_RANGE + 1.5 && !T.sequence;
    relationEl.classList.toggle('hidden', !show);
    if (!show) { relKey = ''; return; }
    const mood = moodOf(n.attitude);
    const key = `${n.id}|${mood.label}|${Math.round(n.attitude * 20)}|${relationNote(n)}`;
    if (key === relKey) return;
    relKey = key;
    relWho.textContent = `${mood.emoji} ${firstName(n.name)} · ${mood.label}`;
    relFill.style.width = `${Math.round((n.attitude + 1) * 50)}%`;
    relFill.dataset.mood = n.attitude <= GRUDGE_ATTITUDE ? 'bad' : n.attitude < -0.15 ? 'low' : n.attitude < FRIEND_ATTITUDE ? 'mid' : 'good';
    relNote.textContent = relationNote(n);
    relNote.classList.toggle('hidden', !relNote.textContent);
  };
  const resetMemoryHud = () => {
    repTitle = null;
    relKey = '';
    relationEl.classList.add('hidden');
  };

  Object.assign(T, {
    forget, memBiasOf: biasOf, memoryLine, moodOf, remember, reputation, resetMemoryHud, updateRelation, updateReputation,
  });
}

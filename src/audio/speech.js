// Text to speech for characters (Town's townsfolk and the player): the browser's Web Speech API
// (speechSynthesis) — free, no keys, no limits, the voices the system has (most offline).
// Each speaker gets their own voice: one of the system's English voices (picked by a hash of
// their key, from the pool that matches how they sound — `kind`) plus their own pitch and rate,
// so even a system with one voice gives everyone a different one. A `family` (a kind of speaker —
// Town's pumpkins, tree folk, frogs…) shares one accent: its preferred English locale if the system
// has it (`ACCENTS`), else one voice picked by the family's name — so the frogs all sound like
// frogs, not like a random draw.
// Some systems (Firefox on Linux — speech-dispatcher / eSpeak) list one voice per accent and none
// by gender: then every pool is the whole list and gender comes from pitch alone (`noPool`).
// Volume: the audio manager's master × voice volume × distance falloff (audioManager.js
// distanceGain — `at` = where the speaker is). The browser says one line at a time, so:
//   'talk'    — a conversation with the player: cuts off any ambient line; `interrupt` cuts off
//               everything (a new conversation line), otherwise it waits its turn (a reply, then
//               the answer to it);
//   'ambient' — someone near the player talking: only when nothing else is being said (dropped
//               otherwise — the town doesn't queue up chatter).
// Volume is set when a line is asked for (the API can't change it mid-line).

import { distanceGain } from './audioManager.js';

// (names in the system's voice list that tell how a voice sounds; "female" is checked first —
// it contains "male")
const FEMALE_VOICE = /\+f\d|female|woman|girl|samantha|victoria|karen|moira|tessa|fiona|zira|susan|hazel|serena|allison|\bava\b|kate|veena|catherine|libby|sonia|natasha|aria|jenny|emma|amy|joanna|salli|kimberly|ivy|kendra|nicky|martha|shelley|sandy|flo|grandma|kathy|vicki|princess|zoe|nora|linda|heera|michelle|ana\b|clara|luciana|monica|paulina/i;
const MALE_VOICE = /\+m\d|\bmale\d*\b|\bman\b|daniel|david|mark|\balex\b|fred|george|james|oliver|rishi|\btom\b|aaron|arthur|gordon|guy|ryan|thomas|brian|joey|justin|matthew|eddy|reed|rocko|ralph|albert|junior|grandpa|lee|nathan|evan|christopher|eric|roger|steffan|william|liam|ravi|prabhat/i;

// Pitch / rate by how a speaker sounds (each speaker then gets a little of their own on top)
// (`noPool`: the pitch when the system has no voice of that pool — most such voices are male,
// so a female one is pitched further up and a male one a little further down)
const KINDS = {
  female: { pool: 'female', pitch: 1.15, noPool: 1.45, rate: 1.0 },
  male: { pool: 'male', pitch: 0.9, noPool: 0.82, rate: 0.98 },
  kid: { pool: 'female', pitch: 1.6, noPool: 1.75, rate: 1.08 },
  gruff: { pool: 'male', pitch: 0.6, noPool: 0.55, rate: 0.92 },
  old: { pool: 'male', pitch: 0.75, noPool: 0.7, rate: 0.88 },
};
// The accent a family of speakers prefers (tested on "<lang> <name>", first match wins); one with
// none here, or none available, gets a voice picked by its name
const ACCENTS = {
  pumpkin: [/en[-_]us|america/i],
  gem: [/en[-_]us|america/i],
  tree: [/scot/i, /en[-_]ie|irish|ireland/i, /en[-_]gb|brit|england|\buk\b/i],
  frog: [/en[-_]au|austral/i, /en[-_]nz|zealand/i],
  antler: [/en[-_]gb|brit|england|\buk\b/i],
  wizard: [/en[-_]gb|brit|england|\buk\b|received/i, /scot/i],
};

const hashOf = (s) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
};

// What's read out: no emoji / icon glyphs / arrows (button labels carry some)
const speakable = (text) => String(text ?? '')
  .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{20E3}]/gu, '')
  .replace(/[›‹⬅➡★☆•·]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const STUCK_MS = 20000;    // the longest a line that never reported its end is waited on
const CANCEL_GAP_MS = 120; // after a cancel, before the next line starts

export function createSpeech({ audio = () => window.audioManager } = {}) {
  const synth = typeof window !== 'undefined' ? window.speechSynthesis : null;
  const Utterance = typeof window !== 'undefined' ? window.SpeechSynthesisUtterance : null;
  const supported = !!(synth && Utterance);
  let voices = [];
  let pools = { female: [], male: [], all: [] };
  const loadVoices = () => {
    if (!supported) return;
    const list = synth.getVoices() ?? [];
    const en = list.filter((v) => /^en/i.test(v.lang));
    voices = en.length ? en : list;
    // (local voices first: they start at once and work offline)
    voices = [...voices].sort((a, b) => (b.localService ? 1 : 0) - (a.localService ? 1 : 0) || a.name.localeCompare(b.name));
    const female = voices.filter((v) => FEMALE_VOICE.test(v.name));
    const male = voices.filter((v) => !FEMALE_VOICE.test(v.name) && MALE_VOICE.test(v.name));
    pools = { female, male, all: voices };
  };
  if (supported) {
    loadVoices();
    synth.addEventListener?.('voiceschanged', loadVoices);
  }

  // Our own queue (the browser's is left with one line at a time): `current` is being said,
  // `queue` waits. A line started right after synth.cancel() is often dropped silently (Chrome),
  // so after a cancel the next line waits CANCEL_GAP_MS.
  const queue = [];
  let current = null;
  let gapTimer = 0;
  const pump = () => {
    if (current || gapTimer || !queue.length) return;
    const entry = queue.shift();
    current = entry;
    const finish = () => {
      clearTimeout(entry.stuck);
      if (current !== entry) return;
      current = null;
      pump();
    };
    entry.u.onend = finish;
    entry.u.onerror = finish;
    // (a line that never reports its end — it happens — is given up on)
    entry.stuck = setTimeout(finish, Math.min(STUCK_MS, 3000 + entry.u.text.length * 110 / entry.u.rate));
    if (synth.paused) synth.resume(); // (Chrome can be left paused)
    synth.speak(entry.u);
  };
  const cancelAll = ({ keepQueue = false } = {}) => {
    if (!keepQueue) queue.length = 0;
    if (current) clearTimeout(current.stuck);
    current = null;
    synth.cancel();
    clearTimeout(gapTimer);
    gapTimer = setTimeout(() => { gapTimer = 0; pump(); }, CANCEL_GAP_MS);
  };
  const busy = () => !!current || queue.length > 0 || !!gapTimer;

  /**
   * A speaker's voice: `key` (a stable id — their name), `kind` ('female' | 'male' | 'kid' |
   * 'gruff' | 'old'), `family` (optional — speakers who share an accent). → { voice, pitch, rate }
   */
  const voiceFor = (key, kind = 'male', family = null) => {
    const k = KINDS[kind] ?? KINDS.male;
    const h = hashOf(String(key));
    const pooled = pools[k.pool]?.length > 0;
    const pool = pooled ? pools[k.pool] : pools.all;
    let voice = null;
    if (pool.length && family) {
      const accented = (ACCENTS[family] ?? []).map((re) => pool.filter((v) => re.test(`${v.lang} ${v.name}`))).find((l) => l.length);
      voice = accented ? accented[h % accented.length] : pool[hashOf(`family:${family}`) % pool.length];
    } else if (pool.length) voice = pool[h % pool.length];
    const jitter = (bits) => (((h >>> bits) & 0xff) / 255) * 2 - 1; // −1 … 1
    return {
      voice,
      pitch: Math.max(0.1, Math.min(2, (pooled ? k.pitch : k.noPool) + jitter(8) * 0.14)),
      rate: Math.max(0.5, Math.min(2, k.rate + jitter(16) * 0.08)),
    };
  };

  /**
   * Say `text`. `key` / `kind` / `family` pick the voice (voiceFor), `at` = where the speaker is (quieter
   * further from the listener — `falloff` = distanceGain options), `volume` a multiplier,
   * `priority` 'talk' | 'ambient', `interrupt` (talk) cuts off whatever's being said.
   * → true if it was said (or queued)
   */
  const say = (text, { key = 'someone', kind = 'male', family = null, at = null, falloff, volume = 1, priority = 'ambient', interrupt = false } = {}) => {
    if (!supported) return false;
    const words = speakable(text);
    if (!words) return false;
    const am = audio();
    const dist = at && am?.distanceTo ? am.distanceTo(at) : 0;
    const level = (am ? (am.masterVolume ?? 1) * (am.voiceVolume ?? 1) : 1) * volume * distanceGain(dist, falloff);
    if (level < 0.02) return false;
    const v = voiceFor(key, kind, family);
    const u = new Utterance(words);
    if (v.voice) { u.voice = v.voice; u.lang = v.voice.lang; }
    u.pitch = v.pitch;
    u.rate = v.rate;
    u.volume = Math.max(0, Math.min(1, level));
    const entry = { u, priority, stuck: 0 };
    if (priority === 'ambient') {
      if (busy() || synth.speaking) return false;
    } else if (interrupt) {
      if (current || synth.speaking || synth.pending) cancelAll();
      else queue.length = 0;
    } else if (current?.priority === 'ambient') {
      cancelAll({ keepQueue: true });
    }
    queue.push(entry);
    pump();
    return true;
  };

  return {
    supported,
    say,
    voiceFor,
    /** Stop everything being said (leaving a mode, a talk closed). */
    // (a line asked for straight after still waits out the cancel gap)
    stop: () => { if (supported && (busy() || synth.speaking || synth.pending)) cancelAll(); },
    /** Stop only if what's being said is ambient chatter. */
    stopAmbient: () => { if (supported && current?.priority === 'ambient') cancelAll({ keepQueue: true }); },
    isSpeaking: () => supported && (busy() || synth.speaking),
  };
}

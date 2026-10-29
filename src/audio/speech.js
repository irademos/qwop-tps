// Text to speech for characters (Town's townsfolk and the player): the browser's Web Speech API
// (speechSynthesis) — free, no keys, no limits, the voices the system has (most offline).
// Each speaker gets their own voice: one of the system's English voices (picked by a hash of
// their key, from the pool that matches how they sound — `kind`) plus their own pitch and rate,
// so even a system with one voice gives everyone a different one.
// Volume: the audio manager's master × voice volume × distance falloff (audioManager.js
// distanceGain — `at` = where the speaker is). The browser says one line at a time, so:
//   'talk'    — a conversation with the player: cuts off any ambient line; `interrupt` cuts off
//               everything (a new conversation line), otherwise it waits its turn (a reply, then
//               the answer to it);
//   'ambient' — someone near the player talking: only when nothing else is being said (dropped
//               otherwise — the town doesn't queue up chatter).
// Volume is set once a line starts (the API can't change it mid-line).

import { distanceGain } from './audioManager.js';

// (names in the system's voice list that tell how a voice sounds; "female" is checked first —
// it contains "male")
const FEMALE_VOICE = /female|woman|girl|samantha|victoria|karen|moira|tessa|fiona|zira|susan|hazel|serena|allison|\bava\b|kate|veena|catherine|libby|sonia|natasha|aria|jenny|emma|amy|joanna|salli|kimberly|ivy|kendra|nicky|martha|shelley|sandy|flo|grandma|kathy|vicki|princess|zoe|nora|linda|heera|michelle|ana\b|clara|luciana|monica|paulina/i;
const MALE_VOICE = /\bmale\b|\bman\b|daniel|david|mark|\balex\b|fred|george|james|oliver|rishi|\btom\b|aaron|arthur|gordon|guy|ryan|thomas|brian|joey|justin|matthew|eddy|reed|rocko|ralph|albert|junior|grandpa|lee|nathan|evan|christopher|eric|roger|steffan|william|liam|ravi|prabhat/i;

// Pitch / rate by how a speaker sounds (each speaker then gets a little of their own on top)
const KINDS = {
  female: { pool: 'female', pitch: 1.15, rate: 1.0 },
  male: { pool: 'male', pitch: 0.9, rate: 0.98 },
  kid: { pool: 'female', pitch: 1.6, rate: 1.08 },
  gruff: { pool: 'male', pitch: 0.6, rate: 0.92 },
  old: { pool: 'male', pitch: 0.75, rate: 0.88 },
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

const STUCK_MS = 20000; // a line that never reported its end is forgotten after this

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

  // The lines said / waiting (kept referenced so their end events fire — a Chrome quirk)
  const live = new Set();
  const prune = () => {
    const now = performance.now();
    for (const e of live) if (now - e.at > STUCK_MS) live.delete(e);
  };
  const cancelAll = () => {
    live.clear();
    synth.cancel();
  };

  /**
   * A speaker's voice: `key` (a stable id — their name), `kind` ('female' | 'male' | 'kid' |
   * 'gruff' | 'old'). → { voice, pitch, rate }
   */
  const voiceFor = (key, kind = 'male') => {
    const k = KINDS[kind] ?? KINDS.male;
    const h = hashOf(String(key));
    const pool = pools[k.pool]?.length ? pools[k.pool] : pools.all;
    const voice = pool.length ? pool[h % pool.length] : null;
    const jitter = (bits) => (((h >>> bits) & 0xff) / 255) * 2 - 1; // −1 … 1
    return {
      voice,
      pitch: Math.max(0.1, Math.min(2, k.pitch + jitter(8) * 0.14)),
      rate: Math.max(0.5, Math.min(2, k.rate + jitter(16) * 0.08)),
    };
  };

  /**
   * Say `text`. `key` / `kind` pick the voice (voiceFor), `at` = where the speaker is (quieter
   * further from the listener — `falloff` = distanceGain options), `volume` a multiplier,
   * `priority` 'talk' | 'ambient', `interrupt` (talk) cuts off whatever's being said.
   * → true if it was said (or queued)
   */
  const say = (text, { key = 'someone', kind = 'male', at = null, falloff, volume = 1, priority = 'ambient', interrupt = false } = {}) => {
    if (!supported) return false;
    const words = speakable(text);
    if (!words) return false;
    const am = audio();
    const dist = at && am?.distanceTo ? am.distanceTo(at) : 0;
    const level = (am ? (am.masterVolume ?? 1) * (am.voiceVolume ?? 1) : 1) * volume * distanceGain(dist, falloff);
    if (level < 0.02) return false;
    prune();
    if (priority === 'ambient') {
      if (live.size || synth.speaking || synth.pending) return false;
    } else if (interrupt || [...live].some((e) => e.priority === 'ambient')) {
      cancelAll();
    } else if (!live.size && (synth.speaking || synth.pending)) {
      synth.cancel(); // (something we lost track of)
    }
    const v = voiceFor(key, kind);
    const u = new Utterance(words);
    if (v.voice) { u.voice = v.voice; u.lang = v.voice.lang; }
    u.pitch = v.pitch;
    u.rate = v.rate;
    u.volume = Math.max(0, Math.min(1, level));
    const entry = { u, priority, at: performance.now() };
    const done = () => live.delete(entry);
    u.onend = done;
    u.onerror = done;
    live.add(entry);
    if (synth.paused) synth.resume(); // (Chrome can be left paused)
    synth.speak(u);
    return true;
  };

  return {
    supported,
    say,
    voiceFor,
    /** Stop everything being said (leaving a mode, a talk closed). */
    stop: () => { if (supported && (live.size || synth.speaking || synth.pending)) cancelAll(); },
    /** Stop only if what's being said is ambient chatter. */
    stopAmbient: () => { if (supported && [...live].some((e) => e.priority === 'ambient')) cancelAll(); },
    isSpeaking: () => supported && (live.size > 0 || synth.speaking),
  };
}

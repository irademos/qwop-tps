// Town: the night defense. From DEFENSE_HOURS[0], for three town hours, the sheriff goes looking
// for the player (❗ over him) to ask for help holding the bandits off tonight. Accepted, he leads
// the player (townGuide.js' lead, `at: 'point'`) to a spot on the Endless walk — the Showdown stage
// routes joined up — not far from where he asked (ctx.waveSpot), and there the wave begins
// (ctx.startWave → bootstrapGameApp.js `_townWave`: the player auto-walks a stretch of the
// walk from there while an Endless wave comes at them — the player's own Town gear, no auto-buy;
// every DEFENSE_HARDER_EVERY nights a step harder). The wave's bandits aren't the camp's: they're
// there for the wave only, and beating them doesn't shrink the gang.
//   won     — no raid tonight, the sheriff's reward
//   lost    — (the player went down) the wave's bandits they didn't beat raid the town
//   missed  — (the window went by, or "Not tonight") the whole wave's worth raid it
// The raid itself is townBandits.js' (startRaidNight(max) — as many of the camp's gang as that).
// The sheriff fights beside the player with his bow (townAllies.js); badly hurt he runs home and
// hides like everyone else, and the bandits after him turn back on the player.
// While the wave's on, every townsperson (the law too; not the bandits, nor the wizard up his
// mountain) runs home and hides in their room till it's over (`hideFromWave` — townFolk.js' decide
// sends them back if anything else comes up, townLife.js keeps them in).
// The authority's game only (own town / a shared town's host — its own player); not saved: leaving
// Town mid-fight drops it. In the player's own town the clock holds while they're led / fighting.

import { firstName, fillLine } from './townPeople.js';
import {
  DEFENSE_HARDER_EVERY, DEFENSE_HOURS, DEFENSE_LEVEL_MAX, DEFENSE_REASK_S, DEFENSE_REWARD, DEFENSE_START_R,
  TALK_RANGE, dist2, inHours, pickOf,
} from './townConfig.js';
import { newLead } from './townGuide.js';

const ASK = [
  '{name}! The bandits are gathering tonight — {n} of them. Help me hold them off before they reach town?',
  'There you are, {name}. Scouts say {n} cutthroats are coming. I could use a blade out there.',
];
const ACCEPTED = ['Good. Follow me — we meet them out on the trail.', 'Knew I could count on you. This way!'];
const DECLINED = ['Then lock your door tonight.', 'Suit yourself. Pray they pass you by.'];
const LEAD_TIPS = ['Stay close. They\'ll come down the trail.', 'Keep your blade ready.'];
const AT_START = ['Here they come! Hold the line!', 'This is it — don\'t let them through!'];
// The sheriff fighting beside the player (townAllies.js): his bow; badly hurt, he runs home to hide
const SHERIFF_ALLY = {
  hp: 10, attack: 'bow',
  lowHp: { at: 3, then: 'flee', line: 'I\'m done for — I\'ll bar the door! Give \'em hell, {name}!' },
  shouts: ['Hold the line, {name}!', 'Behind you!', 'Not in my town!', 'Keep at \'em!', 'That\'s one less!'],
};

export function installTownDefense(T, ctx) {
  T.defense = null; // { night, phase: seek | lead | fight | won | lost | missed | none, level, total, left, start, lead, sheriffId }
  // (the night an hour belongs to: the evening's day — as townBandits.js')
  const nightOf = () => (T.hour() >= 12 ? T.clock.day : T.clock.day - 1);
  const levelFor = (night) => Math.min(DEFENSE_LEVEL_MAX, 1 + Math.floor(Math.max(0, night - 1) / DEFENSE_HARDER_EVERY));
  const sheriffOf = () => T.npcs.find((n) => n.alive && n.role === 'sheriff' && !n.fighter && n.jailedUntil <= T.simT
    && !n.questing && !n.following) ?? null;
  const sheriffById = (id) => T.npcs.find((n) => n.id === id && n.alive && !n.fighter) ?? null;
  // The player can be asked / led now
  const playerFree = () => T.law.stars <= 0 && !T.jail && !ctx.isPlayerDead() && !T.sequence;
  const busy = () => !!T.defense && ['lead', 'fight'].includes(T.defense.phase);

  const miss = (D, why) => {
    D.phase = 'missed';
    D.left = D.total;
    if (why) T.feedLine(why);
  };

  // ── Each tick (0.5 s, townBandits' updateNightRaid): tonight's defense set up, the window running out ──
  const tickDefense = () => {
    if (!T.isHost()) return;
    const night = nightOf();
    let D = T.defense;
    if (!D || D.night !== night) {
      if (D && ['lead', 'fight'].includes(D.phase)) return; // (a fight going on past midnight: still tonight's)
      if (!inHours(T.hour(), DEFENSE_HOURS)) return;
      const level = levelFor(night);
      D = T.defense = { night, phase: 'seek', level, total: ctx.defenseWaveSize(level), left: 0, start: null, lead: null, sheriffId: null, askAt: 0 };
      // (no sheriff, or nothing to fight with: tonight's raid as it always was)
      if (!sheriffOf() || !ctx.hasWeapon()) { D.phase = 'none'; return; }
    }
    if (D.phase !== 'seek') return;
    if (!inHours(T.hour(), DEFENSE_HOURS)) {
      if (T.jobTalk.isOpen() && T.talking?.npc?.id === D.sheriffId) T.jobTalk.close();
      miss(D, 'The sheriff couldn\'t find you in time — the bandits are coming anyway!');
      return;
    }
    // (the sheriff on his way over: his task does the rest)
    const s = D.sheriffId != null ? sheriffById(D.sheriffId) : null;
    if (s?.task?.type === 'defend') return;
    const sheriff = s ?? sheriffOf();
    if (!sheriff) { miss(D, 'The sheriff is gone — nobody stands between the town and the bandits tonight.'); return; }
    if (!playerFree() || T.questEngaged?.() || !T.take(sheriff)) return;
    D.sheriffId = sheriff.id;
    sheriff.inside = false;
    T.clearTalk(sheriff);
    T.setTask(sheriff, { type: 'defend', dur: Infinity });
  };

  // ── The sheriff's frame (townReactions updateSpecialTask → 'defend') ──
  const updateDefenseNpc = (n, t, dt) => {
    const D = T.defense;
    const done = () => { n.task = null; T.decide(n); return true; };
    if (!D || D.sheriffId !== n.id || !n.def.law) return done();
    const p = T.playerPos();
    if (D.phase === 'lead') {
      if (T.inRoom || !playerFree()) { n.moving = false; n.path = null; T.faceToward(n, p.x, p.z, dt); return true; }
      return T.guide.leadFrame(n, D.lead, dt, { tips: LEAD_TIPS });
    }
    if (D.phase !== 'seek') return done();
    // Walking up to the player (indoors / in trouble: waits), then the question
    if (T.inRoom || !playerFree()) { n.moving = false; n.path = null; return true; }
    const d = T.distToPlayer(n);
    if (d > TALK_RANGE - 0.6) { T.chase(n, p.x, p.z, dt, d > 4); return true; }
    n.moving = false;
    n.path = null;
    T.faceToward(n, p.x, p.z, dt);
    if (T.jobTalk.isOpen() || T.simT < D.askAt || !n.body || T.stalls.view?.()) return true;
    D.askAt = T.simT + DEFENSE_REASK_S;
    ask(n, D);
    return true;
  };
  const ask = (n, D) => {
    T.talking = { npc: n };
    T.jobTalk.open({
      who: firstName(n.name), sub: 'Defend the town',
      text: fillLine(pickOf(ASK), { name: ctx.getPlayerName(), n: D.total }),
      choices: [
        { label: 'I\'ll help', primary: true, onClick: () => accept(n, D) },
        { label: 'Not tonight', onClick: () => {
          T.say(n, pickOf(DECLINED));
          miss(D, `You turned the sheriff down — ${D.total} bandits are heading for town.`);
          n.task = null;
          T.decide(n);
        } },
      ],
    });
  };
  const accept = (n, D) => {
    const p = T.playerPos();
    const nav = T.layout.nav;
    const start = ctx.waveSpot(n.x, n.z, (x, z) => nav.isWalkable(x, z)) ?? { x: p.x, z: p.z };
    D.start = { x: start.x, z: start.z };
    D.lead = newLead('point', true);
    D.lead.point = D.start;
    D.phase = 'lead';
    T.say(n, pickOf(ACCEPTED), { big: true });
    T.feedLine('Follow the sheriff to meet the bandits.');
    T.actsAt = 0;
  };

  // ── Each frame (townMode update): the player walked along, the start reached ──
  const updateDefense = (dt) => {
    const D = T.defense;
    if (!D || !T.isHost()) return;
    if (D.phase === 'lead') {
      const g = sheriffById(D.sheriffId);
      if (!T.inRoom && playerFree()) T.guide.walkFrame(D.lead, g, dt);
      const p = T.playerPos();
      if (!T.inRoom && playerFree() && dist2(p.x, p.z, D.start.x, D.start.z) < DEFENSE_START_R) startFight(D, g);
    }
  };
  // Off home to hide (true: sent)
  const hideFromWave = (n) => {
    if (!n.alive || n.fighter || n.questing || n.ally || n.def.outlaw || n.def.hermit || !n.home || n.jailedUntil > T.simT) return false;
    if (n.inside && n.task?.type === 'hide') return true;
    const to = n.home.room ? T.rooms.somewhereIn(n.home.room) : n.home;
    T.setTask(n, { type: 'flee', to, dur: 0, run: true, hide: true });
    return true;
  };
  const hideEveryone = () => {
    for (const n of T.npcs) {
      if (!n.alive || n.fighter || n.questing || n.ally || n.def.outlaw || n.def.hermit || !T.mine(n)) continue;
      if (n.inside && (n.task?.type === 'hide' || n.task?.type === 'sleep')) continue;
      if (!T.take(n)) continue;
      if (T.talking?.npc === n && T.jobTalk.isOpen()) T.jobTalk.close();
      T.clearTalk(n);
      T.endBrawl?.(n);
      n.following = false;
      hideFromWave(n);
    }
  };
  const startFight = (D, sheriff) => {
    D.phase = 'fight';
    D.total = ctx.startWave({ x: D.start.x, z: D.start.z, level: D.level, onEnd: (res) => endFight(D, res) }) || D.total;
    if (sheriff) {
      T.say(sheriff, pickOf(AT_START), { big: true });
      if (sheriff.task?.type === 'defend') sheriff.task = null;
      // (beside the player with his bow; badly hurt: off home to hide — the bandits after him let him go)
      T.allyJoin(sheriff, {
        ...SHERIFF_ALLY,
        onFlee: (n) => {
          T.feedLine(`${firstName(n.name)} is badly hurt — he runs for home.`);
          if (!hideFromWave(n)) T.decide(n);
        },
      });
    }
    hideEveryone();
    T.feedLine('The townsfolk bar their doors.');
    T.actsAt = 0;
  };
  const endFight = (D, { won, killed = 0, total = D.total }) => {
    if (D.phase !== 'fight') return;
    D.total = total;
    const ally = sheriffById(D.sheriffId);
    if (won) {
      D.phase = 'won';
      D.left = 0;
      const coins = DEFENSE_REWARD[0] + DEFENSE_REWARD[1] * D.level;
      ctx.addCoins(coins);
      ctx.playSfx('coin');
      if (ally && T.isAlly(ally)) T.say(ally, 'We did it! Nobody\'s raiding this town tonight.', { big: true });
      ctx.showBanner('TOWN DEFENDED', `The bandits won't come tonight · 🪙 +${coins}`, 3200);
      T.feedLine(`You held the bandits off — the sheriff pays you ${coins} coins.`);
      const s = sheriffById(D.sheriffId);
      if (s) s.attitude = Math.min(1, (s.attitude ?? 0) + 0.15);
    } else {
      D.phase = 'lost';
      D.left = Math.max(0, total - killed);
      T.feedLine(D.left
        ? `${D.left} bandit${D.left > 1 ? 's' : ''} got past you — they're heading into town!`
        : 'You went down, but none of them got past you.');
    }
    // (the fight's over: the sheriff back to his rounds)
    if (ally) T.allyLeave(ally);
    T.save();
  };

  // The player went down (townMode onPlayerDown): a fight going on is lost
  const defenseDown = () => {
    if (T.defense?.phase === 'fight') ctx.stopWave();
  };
  // Leaving Town: the wave taken away, nothing counted
  const resetDefense = () => {
    if (T.defense?.phase === 'fight') ctx.stopWave({ silent: true });
    const s = T.defense?.sheriffId != null ? T.npcById?.(T.defense.sheriffId) : null;
    if (s) T.allyLeave(s, { decide: false });
    T.defense = null;
  };

  // ── What townBandits.js' raid does tonight: null = as it always did (no defense tonight),
  // 'wait' = not yet, or the number of raiders (0: none) ──
  const defenseRaid = () => {
    const D = T.defense;
    if (!D || D.night !== nightOf() || D.phase === 'none') return null;
    if (['seek', 'lead', 'fight'].includes(D.phase)) return 'wait';
    return D.phase === 'won' ? 0 : D.left;
  };

  // ── HUD: the tracker line, the markers, the Follow act ──
  const defenseEntry = () => {
    const D = T.defense;
    if (!D) return null;
    if (D.phase === 'lead') return { title: 'Defend the town', progress: 'Follow the sheriff', icon: '📍' };
    if (D.phase === 'fight') {
      const s = ctx.waveState?.();
      return { title: 'Defend the town', progress: s ? `${s.killed} / ${s.total} bandits` : 'Hold them off', icon: '⚔️' };
    }
    return null;
  };
  const defenseMarkers = () => {
    const D = T.defense;
    if (!D) return [];
    if (D.phase === 'lead') return [T.guide.marker(D.lead)].filter(Boolean);
    if (D.phase === 'seek') {
      const s = sheriffById(D.sheriffId);
      if (s?.task?.type === 'defend' && !s.inside) return [{ icon: '❗', x: s.x, z: s.z, h: 2.2 }];
    }
    return [];
  };
  const defenseActs = () => {
    const D = T.defense;
    if (D?.phase !== 'lead' || T.inRoom) return [];
    return T.guide.acts(D.lead, sheriffById(D.sheriffId));
  };

  Object.assign(T, {
    tickDefense, updateDefense, hideFromWave, updateDefenseNpc, defenseDown, resetDefense, defenseRaid,
    defenseEntry, defenseMarkers, defenseActs,
    defenseBusy: busy,
    defenseFighting: () => T.defense?.phase === 'fight',
    // (the clock holds while the player's led / fighting — their own town only)
    defenseHoldsClock: () => busy() && !T.mp(),
    defenseDebug: () => ({ D: T.defense, night: nightOf(), level: levelFor(nightOf()), sheriff: sheriffOf()?.name ?? null }),
  });
}

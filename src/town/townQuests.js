// Town: the first day and the jobs after it, run by the shared quest runner
// (src/quest/questRunner.js) from their data (src/town/quests/firstDay.js, then the branches of
// quests/jobs.js). Each branch is a list of quests in order with a runner of its own; the first
// day is a branch too and the others open once it's done or skipped (or a branch's `from` says).
// The branches run side by side but one job at a time: while one's under way (past its giver's
// first talk — `engaged`) the rest wait; otherwise the branches whose giver is waiting to come up
// queue (`order`) and one at a time has the turn (`turn` — its seek beat may set off: W.mayApproach),
// a giver near the player first; nobody comes up while the player's in a fight, out on the water,
// off the island or far off. Talking to any waiting giver (❗) starts theirs. This file is Town's side of it:
//   - the WORLD the beats act in: places, the townspeople a job has taken over (its "cast"),
//     people who aren't townsfolk (actors — the wizard's son), the bandits of an ambush (foes)
//   - the BEATS (src/town/beats/ — people: seek, talk; goal: goal, unless, banner; cart: cart,
//     unload, lockCart, board, alight, drive; scene: actor, bomb, actorLeave; ambush; rewards: pay,
//     release; craft: bring, build; sea: canoeCrew, paddle, fishHere, ship, pirates, pilotHome,
//     canoeLand) — each a small piece any job can use, given this file's world W (a guide leading
//     the way to a goal, the player walked along: townGuide.js); plus the runner's own `wait` and,
//     on any beat, `talks` (talk to someone whenever — openTalk) and `entry`
//   - the hooks Town calls: tracker line (questEntry), markers (questMarkers), acts, the button to
//     ring (questHighlight), talking to someone (questTalk), a cast member's frame (updateQuestNpc —
//     the 'quest' task, townReactions.js), saves (questSnapshot / startQuests)
//
// A townsperson in a job (`n.questing`) does what their mode says (`n.qmode`): seek (walk up to
// the player), lead (show the way to a goal — townGuide.js), stand, follow, board (climb into the cart) → seated (crouched in its bed, carried
// along — n.seat, townFolk.js syncBody), toCanoe → canoe (kneeling in the canoe's bow — townCanoe.js), knocked (thrown down a moment), fight (an ally: wand
// blasts at the job's foes — ctx.castAllySpell), linger (strolling round after the job). Their
// health in a fight is the job's (ALLY_HP); bandits of an ambush can go for them
// (`questTarget` on the foe — the horde loop in bootstrapGameApp.js).

import * as THREE from 'three';
import { createQuestRunner } from '../quest/questRunner.js';
import { createTalkRunner } from '../quest/talk.js';
import { townBeats } from './beats/index.js';
import { BRANCHES } from './quests/jobs.js';
import { FIRST_DAY, OLD_STEP_IDS } from './quests/firstDay.js';
import { installTownGuide, newLead } from './townGuide.js';
import { FOOD_IDS, GOOD_IDS, SHOP_GEAR, goodPrice } from './townEconomy.js';
import { BANDIT_NAMES, firstName } from './townPeople.js';
import { createGLBCharacterInstance, glbCharacterConfig } from '../models/glbCharacterModel.js';
import { RUN_SPEED, WALK_SPEED, dist2, heightScale, inHours, pickOf } from './townConfig.js';

const SEEK_STOP = 2.0;        // m from the player a giver stops to talk
const SEEK_STUCK_S = 6;       // s getting no closer (no walk from their place to the player): they wait there
const SNOOZE_S = 90;          // s 'Later' leaves the player be
const SEAT_LZ = -0.42;        // m: the passenger's place in the cart's bed (behind the rider)
const BOARD_TIMEOUT_S = 10;   // s walking to the cart before they're simply in it
const BOARD_REACH = 1.4;      // m from the cart's side they climb in
const KNOCK_S = 2.4;          // s down after being thrown out of the cart
const ALLY_HP = 8;            // hits an ally takes in a fight before going down (the job fails)
const ALLY_KEEP = [4.5, 9];   // m an ally with a wand keeps from the nearest foe
const ALLY_CAST_S = [1.7, 2.6]; // s between their blasts
const ALLY_CAST_RANGE = 15;
const ALLY_SHOUTS = ['Fire and frost!', 'Mind yourself, {name}!', 'I taught that boy better than this…', 'Stand back, you ruffians!', 'Hah! Still got it.'];
const FOE_HEARTS = 2;
const FOE_SPAWN_DIST = [11, 15]; // m from the player, on the camp's side
const FOE_GEAR = [null, { shield: true }, null, { gun: true }, null]; // (by order; the ones going for an ally get none)
const FOE_COINS = 2;
const ACTOR_WALK = 1.6;       // m/s
const ACTOR_RUN = 4.2;
const ACTOR_GONE_DIST = 32;   // m from the player a leaving actor is taken away
const ACTOR_TIMEOUT_S = 25;
const BOMB_THROW_AT_S = 0.55; // s into the throw the bomb leaves the hand
const BOMB_AFTER_S = 1.8;     // s after the blast before the next beat
const LINGER_HOME_DIST = 30;  // m the player is away before a lingering townsperson goes home
const GUIDE_REACH = 22;       // m — a guide this close says their done line aloud (else the feed does)
// What someone's busy with that they'd drop to come and find the player (anything else — a fight,
// fleeing, the law's work, sleep — comes first)
const GUIDE_OVER = new Set(['work', 'sell', 'buyWood', 'eat', 'browse', 'social', 'wander', 'chat', 'guide', 'quest', 'talk']);
// The sword's shop price (the first day's merchant lets it go for less)
const SWORD_PRICE = SHOP_GEAR.find((g) => g.id === 'sword')?.price ?? 30;
// A townsperson's words in a job's lines ({wizard.dad}…): [his, hers]
const WORDS = {
  dad: ['dad', 'mum'], father: ['father', 'mother'], he: ['he', 'she'], him: ['him', 'her'], his: ['his', 'her'],
  man: ['man', 'woman'], sir: ['sir', 'madam'],
};
// When a giver may come and find the player (the branches' queue — see `updateBranches`)
const SEEK_NEAR = 40;         // m — a waiting giver this close goes before the queue's first
const SEEK_FAR = 200;         // m — no further off than this (another island, far out at sea)
const HOME_RADIUS = 165;      // m from the island town's middle: past it the player's off the island
const ATTACK_DIST = 25;       // m — a fighter after the player this close: nobody comes up meanwhile
// The first day is a branch of its own, before all the others (quests/firstDay.js)
const FIRST_BRANCH = { id: 'firstDay', title: 'First day', jobs: FIRST_DAY };
const ALL_QUESTS = [FIRST_BRANCH, ...BRANCHES].flatMap((b) => b.jobs);

export function installTownQuests(T, ctx) {
  const P = () => T.layout.places;
  const playerName = () => ctx.getPlayerName();
  installTownGuide(T, ctx);

  // ── The cast: townspeople a job has taken over ──
  // (who of a role a job has: the one it already took, else the last one of the role a job had —
  // the same fisher shows the player fishing then cooking — else the nearest)
  const lastCast = {};
  const usable = (x) => x?.alive && !x.fighter && !x.def.outlaw && x.jailedUntil <= T.simT;
  const roleNpc = (q, role) => {
    const keep = q?.cast?.[role] != null ? T.npcById(q.cast[role]) : null;
    if (keep?.alive) return keep;
    const p = T.playerPos();
    const last = lastCast[role] != null ? T.npcById(lastCast[role]) : null;
    const n = usable(last) && last.role === role ? last
      : T.npcs.filter((x) => usable(x) && x.role === role)
        .sort((a, b) => dist2(a.x, a.z, p.x, p.z) - dist2(b.x, b.z, p.x, p.z))[0] ?? null;
    if (n && q) { (q.cast ??= {})[role] = n.id; lastCast[role] = n.id; }
    return n;
  };
  const roleGone = (role) => !T.npcs.some((x) => x.alive && x.role === role);
  // Free to come and find the player (or carry on with them): not busy with something that matters
  const canTake = (n, anyTime = false) => usable(n) && !n.following && !n.lost && !n.netFight && !(n.fear > 0)
    && (n.questing || !n.task || GUIDE_OVER.has(n.task.type) || (anyTime && n.task.type === 'sleep'))
    && (!n.inside || n.questing || (anyTime && n.task?.type === 'sleep'));
  const control = (n, mode) => {
    if (!n?.alive || n.fighter) return false;
    if (!n.questing) {
      if (!T.take(n)) return false;
      n.questing = true;
      n.following = false;
    }
    n.inside = false;
    n.qmode = typeof mode === 'string' ? { kind: mode, t: 0 } : { t: 0, ...mode };
    if (n.task?.type !== 'quest' && n.task?.type !== 'talk') T.setTask(n, { type: 'quest', dur: Infinity });
    return true;
  };
  const release = (n) => {
    if (!n) return;
    n.questing = false;
    n.qmode = null;
    n.seat = null;
    if (n.body?.seated) { n.body.seated = false; n.body.character.endPose(); }
    if (n.task?.type === 'quest') n.task = null;
    if (n.alive) T.decide(n);
  };
  // Home once the player's away (a hermit has no walk home from town — put back at their place)
  const homeBound = new Set();
  const sendHome = (n) => { if (n) homeBound.add(n.id); };
  const updateHomeBound = () => {
    for (const id of homeBound) {
      const n = T.npcById(id);
      if (!n?.alive) { homeBound.delete(id); continue; }
      // (taken by the next job meanwhile: it sends them home when it's done with them)
      if (n.questing && n.qmode && n.qmode.kind !== 'linger') { homeBound.delete(id); continue; }
      if (n.questing && n.qmode?.kind === 'linger' && T.simT < n.qmode.until) continue;
      if (T.distToPlayer(n) < LINGER_HOME_DIST) continue;
      homeBound.delete(id);
      const h = n.def.hermit ? (P().wizard.hut ?? n.home) : n.home;
      n.x = h.x;
      n.z = h.z;
      n.path = null;
      release(n);
    }
  };

  // Walking a cast member somewhere: the nav path, else (no walk joins it — the wizard's place)
  // straight there
  const go = (n, x, z, dt, run = false) => {
    const speed = (run ? RUN_SPEED : WALK_SPEED * 1.4) * (n.speedScale ?? 1);
    const t = n.qmode;
    if (!n.path || n.pathI >= n.path.length || T.simT > (t.replanAt ?? 0) || dist2(x, z, t.tx ?? 1e9, t.tz ?? 1e9) > 1.5) {
      T.planPath(n, x, z);
      t.tx = x;
      t.tz = z;
      t.replanAt = T.simT + 1.5;
      t.direct = !n.path?.length;
    }
    if (!t.direct) { T.stepPath(n, dt, speed); return; }
    const dx = x - n.x;
    const dz = z - n.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.05) { n.moving = false; return; }
    const s = Math.min(d, speed * dt);
    n.x += (dx / d) * s;
    n.z += (dz / d) * s;
    n.yaw = Math.atan2(dx, dz);
    n.moving = true;
  };
  const stand = (n, x, z, dt) => {
    n.moving = false;
    n.path = null;
    if (x != null) T.faceToward(n, x, z, dt);
  };

  // ── Actors: people in a job who aren't townsfolk (a GLB character of their own) ──
  const actors = new Map();   // id → { id, name, voice, x, z, yaw, inst, to, speed, leaving, arrived, t }
  const spawnActor = (b, at) => {
    removeActor(b.id);
    const url = glbCharacterConfig[`${b.url}Url`] ?? b.url;
    const a = { id: b.id, name: b.name ?? b.id, voice: b.voice ?? { kind: 'male' }, x: at.x, z: at.z, yaw: 0, inst: null, to: null, speed: ACTOR_WALK, leaving: false, arrived: false, t: 0, scale: b.scale ?? 1, url };
    actors.set(b.id, a);
    createGLBCharacterInstance({ targetHeight: 1.0, url, armIK: false }).then((inst) => {
      if (actors.get(b.id) !== a || !T.active) { inst.character.dispose(); return; }
      a.inst = inst;
      inst.container.rotation.order = 'YXZ';
      inst.container.scale.setScalar(a.scale);
      T.root.add(inst.container);
    }).catch((e) => console.warn('[Town] quest actor load failed:', e));
    return a;
  };
  const removeActor = (id) => {
    const a = actors.get(id);
    if (!a) return;
    actors.delete(id);
    if (a.inst) { a.inst.container.removeFromParent(); a.inst.character.dispose(); }
  };
  const clearActors = () => { for (const id of [...actors.keys()]) removeActor(id); };
  const updateActors = (dt) => {
    for (const a of [...actors.values()]) {
      a.t += dt;
      if (a.to) {
        const dx = a.to.x - a.x;
        const dz = a.to.z - a.z;
        const d = Math.hypot(dx, dz);
        if (d > 0.1) {
          const s = Math.min(d, a.speed * dt);
          a.x += (dx / d) * s;
          a.z += (dz / d) * s;
          a.yaw = Math.atan2(dx, dz);
          a.moving = true;
        } else { a.moving = false; a.arrived = true; }
      } else a.moving = false;
      if (a.face && !a.moving) a.yaw = Math.atan2(a.face.x - a.x, a.face.z - a.z);
      if (a.leaving && (a.arrived || T.distToPlayer(a) > ACTOR_GONE_DIST)) { removeActor(a.id); continue; }
      const inst = a.inst;
      if (!inst) continue;
      inst.container.position.set(a.x, T.groundAt(a.x, a.z), a.z);
      inst.container.rotation.set(0, a.yaw, 0);
      inst.character.setMoving(a.moving);
      inst.character.animate(dt);
      inst.character.stepFluff(dt);
    }
  };
  // (an actor's line heard — text to speech, from where they stand)
  const actorSay = (a, text) => {
    T.speech?.say(text, { key: a.name, kind: a.voice.kind ?? 'male', family: a.voice.family ?? null, at: { x: a.x, y: T.groundAt(a.x, a.z) + 1.4, z: a.z }, priority: 'talk', interrupt: true, falloff: { ref: 4, rolloff: 1, max: 40 } });
  };

  // ── Foes: bandits of an ambush (stage fighters — ctx.spawnFighter — not townsfolk) ──
  const foes = { list: [] };   // list: { e, paid }
  const liveFoes = () => foes.list.filter((f) => !f.e.isDead);
  const clearFoes = () => {
    for (const f of foes.list) if (!f.e.isDead) ctx.removeFighter(f.e);
    foes.list = [];
  };

  // ── Said out loud: a cast member's lines one after another, each also in the feed (no talk box —
  // the `say` beat, out on the water) ──
  const sayQueue = [];   // { id, text, at (T.simT) }
  // (clear: what was still to be said goes — something's happening now)
  const sayNow = (n, text, clear = false) => {
    if (clear) sayQueue.length = 0;
    if (n?.alive && n.body) T.say(n, text, { big: true });
    T.feedLine(`${n ? firstName(n.name) : '?'}: ${text}`);
  };
  const sayLines = (n, lines) => {
    let at = Math.max(T.simT, sayQueue.length ? sayQueue[sayQueue.length - 1].at : 0);
    for (const text of lines) {
      sayQueue.push({ id: n?.id ?? null, text, at });
      at += 1.4 + text.split(/\s+/).length * 0.32; // (time to say it)
    }
  };
  const updateSay = () => {
    while (sayQueue.length && T.simT >= sayQueue[0].at) {
      const l = sayQueue.shift();
      sayNow(l.id != null ? T.npcById(l.id) : null, l.text);
    }
  };

  // ── Places ──
  const placeOf = (name) => {
    const pl = P();
    if (name === 'wizard') return pl.wizard.customer;
    if (name === 'camp') return pl.camp;
    if (name === 'town') return pl.spawn;
    if (name === 'cart') return T.cartPose?.() ?? T.playerPos();
    // (out on the water — townPirates.js' sea plan)
    if (name === 'sea1' || name === 'sea2' || name === 'seaPark') return T.seaPlace?.(name) ?? null;
    return pl[name] ?? null;
  };
  // The cart, out on the ground, and how far it is from a spot
  const cartAt = () => T.cartPose?.() ?? null;

  // ── Text ──
  // {name}: the player's; {<role>}: that townsperson's first name; {<role>.dad} / .father / .he /
  // .him / .his / .man: the word for them (Dad or Mum…), capitalised as written ({wizard.He})
  // (the sword the first day's merchant sells: the shop's price, or all the player has if that's less)
  const swordPrice = () => Math.min(SWORD_PRICE, Math.max(0, Math.floor(ctx.getCoins())));
  const priceLine = () => {
    const c = Math.max(0, Math.floor(ctx.getCoins()));
    return c >= SWORD_PRICE ? `${SWORD_PRICE} coins, and worth every one.`
      : c > 0 ? `It's ${SWORD_PRICE} coins… you've ${c}? Go on then — ${c} will do. Don't tell anyone.`
        : `It's ${SWORD_PRICE} coins… and your pockets are empty. Oh, take it. Pay me back in custom.`;
  };
  const fill = (text, q) => String(text ?? '').replace(/\{(\w+)(?:\.(\w+))?\}/g, (_, k, w) => {
    if (k === 'name') return playerName();
    if (k === 'price') return priceLine();
    if (k === 'swordPrice') return String(swordPrice());
    const n = q?.cast?.[k] != null ? T.npcById(q.cast[k]) : T.npcs.find((x) => x.alive && x.role === k);
    if (w) {
      const pair = WORDS[w.toLowerCase()];
      if (!pair) return w;
      const word = pair[n && T.isFeminine(n) ? 1 : 0];
      return w[0] === w[0].toUpperCase() ? word[0].toUpperCase() + word.slice(1) : word;
    }
    return n ? firstName(n.name) : k;
  });
  const speakerName = (who, q) => {
    if (who === 'you') return playerName();
    if (actors.has(who)) return actors.get(who).name;
    // (the job's own of that role, else whoever the talk's with, else anyone of the role)
    const n = (q?.cast?.[who] != null ? T.npcById(q.cast[who]) : null)
      ?? (talkC?.s?.n?.role === who ? talkC.s.n : T.npcs.find((x) => x.alive && x.role === who));
    return n ? firstName(n.name) : who;
  };

  const calm = () => !T.jobTalk.isOpen() && !T.storage.isOpen() && !T.fishing && !T.cooking && !T.sequence
    && !T.stalls.focused() && !T.lockpick.isOpen() && !T.jail && !ctx.isPlayerDead();
  const isNight = () => { const h = T.hour(); return h >= 21 || h < 6.5; };
  const npcMark = (n, icon = '❗') => (n && !n.inside ? { icon, x: n.x, z: n.z, h: 1.7 * heightScale(n.url) + 0.5 } : null);

  // (the beats: src/town/beats/ — one registry, beats/index.js — given the world W, below)

  // ── Talk: the shared talk (src/quest/talk.js) over Town's talk box ──
  let talkC = null;            // the run context of the talk it's for
  let talkEnd = null;          // what its ending does with its actions
  const talker = createTalkRunner({
    box: T.jobTalk,
    name: (who) => speakerName(who, talkC?.q),
    fill: (t) => fill(t, talkC?.q),
    onLine: (who) => {
      // (the speaker turns to whoever they're talking to; an actor talks to the anchor)
      const a = actors.get(who);
      if (a) { const n = talkC?.s.n; a.face = n ? { x: n.x, z: n.z } : T.playerPos(); }
    },
    run: (actions) => { const end = talkEnd; talkEnd = null; end?.(actions ?? []); },
  });
  // A talk beat's talk: its ending's actions handled in its update (on, unless they moved it)
  const open = (c) => {
    const { beat: b, s } = c;
    s.opened = true;
    talkC = c;
    talkEnd = (actions) => { c.s.actions = actions; };
    T.talking = s.n ? { npc: s.n, reach: b.reach } : null;
    talker.say({ lines: b.lines, choices: b.choices, reward: b.reward, then: b.then });
  };
  // A beat's open talk (its `talks` — talk to someone whenever while it's the beat): the
  // ending's actions in that beat (it stays the beat unless they move it on)
  const openTalk = (def, c, n) => {
    talkC = { q: c.q, s: { n } };
    talkEnd = (actions) => { c.world.branch.runner.act(actions); };
    T.talking = { npc: n, reach: def.reach };
    talker.say(def);
  };
  // Town's own talk actions (besides the runner's next / goto / done / later / fail)
  const actionsFor = (c) => ({
    note: (t) => T.feedLine(fill(t, c.q)),
    // (the talk's townsperson hands something over — unless the player has one)
    give: (item) => {
      if (ctx.getItems()?.[item] || !ctx.grantItem(item)) return;
      const n = c.s.n;
      T.feedLine(`${n ? firstName(n.name) : 'Someone'} gave you a ${item === 'rod' ? 'fishing rod' : item}.`);
    },
    // (walked to the next goal by its guide — or not)
    walk: (v) => { c.q.autoWalk = v !== 'off'; },
    buySword: () => buySword(c.s.n),
    // (the first day skipped: a rod and a sword to get going with, then the jobs)
    skipDay: () => {
      const given = ['rod', 'sword'].filter((id) => !ctx.getItems()?.[id] && ctx.grantItem(id));
      T.feedLine(`Skipped the first day.${given.length ? ` Here — ${given.map((id) => (id === 'rod' ? 'a fishing rod' : 'a sword')).join(' and ')} to get you going.` : ''}`);
      first.runner.finish();
      T.save();
    },
  });
  const buySword = (n) => {
    if (ctx.getItems()?.sword) return;
    const price = swordPrice();
    if (!ctx.grantItem('sword')) return;
    if (price > 0) { ctx.addCoins(-price); if (n) T.npcMoney(n, price); }
    ctx.playSfx?.('buy');
    T.feedLine(`Bought: Sword${price < SWORD_PRICE && n ? ` (${price} coins — ${firstName(n.name)} let it go cheap)` : ''}`);
  };
  // Talking to a guide on the way to a goal: a tip (another, and another)
  const tipTalk = (c, n) => {
    const { beat: b } = c;
    const tips = b.tips ?? [];
    const show = (k) => {
      const choices = [{ label: n.qmode?.kind === 'lead' ? 'Lead on' : 'Thanks', primary: true }];
      if (tips.length > 1) choices.push({ label: 'Another tip', act: true, onClick: () => { if (n.alive) show(k + 1); } });
      T.jobTalk.open({
        who: firstName(n.name),
        text: tips.length ? fill(tips[k % tips.length], c.q) : fill(b.progress ?? c.quest.title, c.q),
        reward: fill(b.progress ?? c.quest.title, c.q), choices,
      });
    };
    show(c.s.tipI ?? 0);
    c.s.tipI = (c.s.tipI ?? 0) + 1;
  };
  // The guide buys the first thing off the player's stall once in front of it (again a while after a no)
  const guideBuys = (c, g) => {
    if (!T.stand || !g?.alive) return;
    const st = T.stallByKey(T.stand.key);
    if (!st || dist2(g.x, g.z, st.customer.x, st.customer.z) > 6) return;
    if (T.offerPending(g) || T.simT - (c.s.askedAt ?? -1e9) < 20) return;
    const good = ['crops', ...FOOD_IDS, ...GOOD_IDS].find((x) => T.goods[x] > 0);
    if (!good) return;
    c.s.askedAt = T.simT;
    g.money = Math.max(g.money, goodPrice(good));
    T.askPlayer(g, good);
  };
  // The button a goal needs right now, ringed like the tutorial's (townActs.js refreshActs)
  const goalHighlight = (kind) => {
    if (T.jobTalk.isOpen() || T.sequence || T.jail || ctx.isPlayerDead()) return null;
    const held = ctx.heldWeapon?.() ?? null;
    const gyro = ctx.hasGyro();
    switch (kind) {
      case 'fish':
        if (T.fishing) return gyro ? null : { act: T.fishActKey?.() ?? 'fishpull' };
        if (held !== 'fishing_rod') return { gear: 'fishing_rod', phone: 'rod' };
        return gyro ? null : { act: 'fishcast' };
      case 'cook': return { act: 'cook:' };
      case 'pick': return { act: 'pick' };
      case 'sell': return T.stand ? null : { act: T.stalls.focused() ? 'back' : 'stand' };
      case 'wood':
        if (held !== 'foamSword') return { gear: 'foamSword', phone: 'sword' };
        return gyro ? null : { act: 'chop' };
      default: return null;
    }
  };

  // ── Seats: a passenger in the cart's bed ──
  const _seatPos = new THREE.Vector3();
  const _seatQuat = new THREE.Quaternion();
  const seat = (n) => {
    control(n, 'seated');
    n.seat = () => {
      if (T.cartFlipped?.()) return null;
      return T.cartSeat?.(SEAT_LZ) ? (() => { const s = T.cartSeat(SEAT_LZ); _seatPos.copy(s.pos); _seatQuat.copy(s.quat); return { pos: _seatPos, quat: _seatQuat }; })() : null;
    };
    ctx.playSfx?.('wood', { x: n.x, y: T.groundY(n), z: n.z });
  };
  const unseat = (n) => {
    if (!n || n.qmode?.kind !== 'seated') return;
    n.seat = null;
    const cp = cartAt();
    if (cp) {
      // (beside it, on the side with ground)
      const side = T.cartRide?.()?.sideSpots(0.9)?.find((s) => T.walkable(s.x, s.z)) ?? { x: cp.x + 1.2, z: cp.z };
      n.x = side.x;
      n.z = side.z;
    }
    control(n, 'stand');
  };
  // Thrown out of the cart (it went over): down a moment, then up
  const knock = (n, from) => {
    n.seat = null;
    const cp = cartAt() ?? { x: n.x, z: n.z };
    const dx = n.x - (from?.x ?? cp.x);
    const dz = n.z - (from?.z ?? cp.z);
    const d = Math.hypot(dx, dz) || 1;
    const tx = cp.x + (dx / d) * 1.8;
    const tz = cp.z + (dz / d) * 1.8;
    if (T.walkable(tx, tz)) { n.x = tx; n.z = tz; }
    control(n, { kind: 'knocked', until: T.simT + KNOCK_S, after: 'stand' });
    if (n.body) { n.body.seated = false; n.body.character.endPose(); n.body.character.playDeath(); }
  };
  // An ally hit by a foe: their health is the job's; at 0 they're down and the job fails
  const hitAlly = (c, n, dir) => {
    const hp = (c.q.allyHp[n.id] ?? ALLY_HP) - 1;
    c.q.allyHp[n.id] = hp;
    n.x += (dir?.x ?? 0) * 0.35;
    n.z += (dir?.z ?? 0) * 0.35;
    n.body?.character.playReaction?.(glbCharacterConfig.smallHitClip);
    ctx.playSfx?.('hit', { x: n.x, y: T.groundY(n) + 1, z: n.z });
    if (hp === 3) T.say(n, 'Ugh — {name}, I can\'t take much more of this!'.replace('{name}', playerName()), { big: true });
    if (hp > 0) return;
    control(n, { kind: 'knocked', until: Infinity });
    if (n.body) n.body.character.playDeath();
    c.fail(`${firstName(n.name)} went down. ${T.isFeminine(n) ? 'She' : 'He'} limps back home — the job's off for now.`);
  };

  // ── A cast member's frame (the 'quest' task) ──
  const updateQuestNpc = (n, t, dt) => {
    if (!n.questing) { T.decide(n); return true; }
    if (branches.some((br) => br.started && br.runner.npc(n, dt))) return true;
    const m = n.qmode ?? { kind: 'stand', t: 0 };
    m.t = (m.t ?? 0) + dt;
    const p = T.playerPos();
    switch (m.kind) {
      case 'seek': {
        // (the player indoors, they outside: to the door)
        const to = m.meet ?? p;
        const d = dist2(n.x, n.z, to.x, to.z);
        if (d > SEEK_STOP) go(n, to.x, to.z, dt, d > 12);
        else stand(n, p.x, p.z, dt);
        if (d < 9 && !m.called && n.body) { m.called = true; T.say(n, pickOf([`${playerName()}! A moment?`, `Ah, ${playerName()} — there you are!`, 'Hold on a moment!'])); }
        return true;
      }
      case 'wait': stand(n, p.x, p.z, dt); return true;
      case 'board': {
        const cp = cartAt();
        if (!cp) { stand(n, p.x, p.z, dt); return true; }
        const side = T.cartRide?.()?.sideSpots(0.6)?.[0] ?? cp;
        if (dist2(n.x, n.z, side.x, side.z) < BOARD_REACH || dist2(n.x, n.z, cp.x, cp.z) < BOARD_REACH) seat(n);
        else go(n, side.x, side.z, dt, dist2(n.x, n.z, side.x, side.z) > 8);
        return true;
      }
      case 'seated': {
        // (the cart went over: thrown out)
        if (T.cartFlipped?.()) { knock(n); return true; }
        const cp = cartAt();
        if (cp) { n.x = cp.x; n.z = cp.z; n.yaw = cp.yaw; }
        n.moving = false;
        n.path = null;
        return true;
      }
      case 'knocked': {
        n.moving = false;
        n.path = null;
        if (T.simT >= m.until) {
          n.body?.character.revive();
          if (m.after === 'fight') control(n, 'fight');
          else control(n, m.after ?? 'stand');
        }
        return true;
      }
      case 'fight': return allyFight(n, m, dt);
      case 'canoe': {
        // (kneeling in the canoe's bow — carried with it)
        const sp = T.canoeSeat?.();
        if (sp) { n.x = sp.pos.x; n.z = sp.pos.z; }
        n.moving = false;
        n.path = null;
        return true;
      }
      case 'follow': {
        const d = T.distToPlayer(n);
        if (d > 3) go(n, p.x, p.z, dt, d > 8); else stand(n, p.x, p.z, dt);
        return true;
      }
      case 'linger': {
        if (T.simT > (m.nextAt ?? 0) || !n.path?.length) {
          m.nextAt = T.simT + 6 + Math.random() * 8;
          const s = T.randomNear(m.ax, m.az, 6);
          T.planPath(n, s.x, s.z);
        }
        T.stepPath(n, dt, WALK_SPEED * (n.speedScale ?? 1));
        if (T.simT > m.until) release(n); // (home once the player's away — updateHomeBound)
        return true;
      }
      default: stand(n, p.x, p.z, dt); return true;
    }
  };
  // An ally with a wand: keeping a few metres off the nearest foe, a blast every couple of seconds
  const allyFight = (n, m, dt) => {
    const list = liveFoes();
    if (!list.length) { stand(n, T.playerPos().x, T.playerPos().z, dt); return true; }
    let foe = null;
    let best = Infinity;
    for (const f of list) {
      const fp = f.e.group.position;
      const d = dist2(n.x, n.z, fp.x, fp.z);
      if (d < best) { best = d; foe = fp; }
    }
    if (best > ALLY_KEEP[1]) go(n, foe.x, foe.z, dt, best > 14);
    else if (best < ALLY_KEEP[0]) {
      // (backing off, straight away from it)
      const dx = n.x - foe.x;
      const dz = n.z - foe.z;
      const d = Math.hypot(dx, dz) || 1;
      const tx = n.x + (dx / d) * 2;
      const tz = n.z + (dz / d) * 2;
      if (T.walkable(tx, tz)) { m.direct = true; go(n, tx, tz, dt, true); }
      n.yaw = Math.atan2(foe.x - n.x, foe.z - n.z);
    } else stand(n, foe.x, foe.z, dt);
    if (best < ALLY_CAST_RANGE && T.simT > (m.castAt ?? 0)) {
      m.castAt = T.simT + ALLY_CAST_S[0] + Math.random() * (ALLY_CAST_S[1] - ALLY_CAST_S[0]);
      n.yaw = Math.atan2(foe.x - n.x, foe.z - n.z);
      n.body?.character.playAction(glbCharacterConfig.throwClip);
      const d = Math.hypot(foe.x - n.x, foe.z - n.z) || 1;
      const dir = { x: (foe.x - n.x) / d, z: (foe.z - n.z) / d };
      ctx.castAllySpell?.({ x: n.x + dir.x * 0.6, y: T.groundY(n) + 0.95, z: n.z + dir.z * 0.6 }, dir);
      if (Math.random() < 0.3) T.say(n, pickOf(ALLY_SHOUTS).replace('{name}', playerName()), { big: true });
    }
    return true;
  };

  // ── The world the runner works in ──
  const cartState = { load: null, locked: false }; // what a job's put in the cart's bed ('veg' / null); held
  const world = {
    time: () => T.simT,
    feed: (text) => T.feedLine(text),
    laterS: SNOOZE_S,
    actions: actionsFor,
    // (talking to a townsperson: their role is the key of a beat's `talks`)
    talkKey: (n) => n?.role ?? n,
    openTalk,
    // (a quest restarting / dropped: everything it set going put away — per branch, below)
  };
  // (global: the job was under way — its talk, arrows, actors, foes, the cart; a giver who
  // never got past coming up has nothing of that, and another job may be using them)
  const cleanup = (q, global = true) => {
    if (global) {
      if (talker.isOpen()) talker.close();
      talkC = null;
      talkEnd = null;
      T.driveTo(null);
      clearActors();
      clearFoes();
      sayQueue.length = 0;
      if (cartState.locked) { T.lockCart?.(false); cartState.locked = false; }
      // (out on the water: the canoe's passenger out, no paddling for the player, the pirate ship
      // home, the golden fish off — townCanoe.js / townPirates.js / townFishing.js)
      T.questFish = null;
      T.canoePilot?.(null);
      T.setCanoeArmed?.(false);
      T.resetPirates?.();
      if (T.canoeHasPassenger?.()) { T.canoePassenger(null); if (!T.inCanoe?.()) T.moorCanoe?.(); }
    }
    for (const id of Object.values(q?.cast ?? {})) {
      const n = T.npcById(id);
      if (!n?.questing) continue;
      unseat(n);
      if (n.qmode?.kind === 'knocked') n.body?.character.revive();
      // (out of the canoe: back on the bank by the fishing spot)
      if (n.qmode?.kind === 'canoe' || n.qmode?.kind === 'toCanoe') {
        n.seat = null;
        const fs = P().fishSpot;
        if (n.qmode.kind === 'canoe' && fs) { n.x = fs.x; n.z = fs.z; n.path = null; }
      }
      // (the wizard: home once the player's away — no walk joins his mountain to town)
      if (n.def.hermit) { control(n, { kind: 'linger', until: T.simT, ax: n.x, az: n.z }); sendHome(n); }
      else release(n);
    }
    if (q) { q.cast = {}; q.failOnDown = false; }
  };
  // ── Town's quest world for the beats (src/town/beats/) ──
  const W = {
    T, ctx, P, THREE, roleNpc, roleGone, canTake, control, release, go, stand, fill, calm, isNight, npcMark, placeOf, cartAt,
    actors, spawnActor, actorSay, sayNow, sayLines, foes, liveFoes, clearFoes, seat, unseat, hitAlly, sendHome, open, talker, tipTalk,
    guideBuys, goalHighlight, cartState, newLead, glbCharacterConfig, BANDIT_NAMES, firstName, pickOf, dist2,
    mayApproach, make: (what, on) => makers[what]?.(on), SNOOZE_S, ALLY_HP, GUIDE_REACH, SEEK_STOP, SEEK_STUCK_S, BOARD_TIMEOUT_S, ACTOR_TIMEOUT_S, ACTOR_RUN,
    BOMB_THROW_AT_S, BOMB_AFTER_S, FOE_HEARTS, FOE_SPAWN_DIST, FOE_GEAR, FOE_COINS,
  };
  const BEATS = townBeats(W);

  // ── The branches: one runner each ──
  const firstSeek = (quest) => quest?.beats.findIndex((b) => b.do === 'seek') ?? -1;
  const branches = [FIRST_BRANCH, ...BRANCHES].map((def) => {
    const br = { id: def.id, def, quests: def.jobs, started: false, saved: null, runner: null, world: null };
    // (its quest's giver hasn't got past coming up: nothing of it is out in the world yet)
    br.world = {
      ...world,
      branch: br,
      questReset: (_quest, q) => cleanup(q, !pending(br)),
      questEnded: (_quest, q) => { cleanup(q, !pending(br)); T.save(); },
    };
    br.runner = createQuestRunner({ quests: br.quests, beats: BEATS, world: br.world, onChange: () => { T.actsAt = 0; } });
    return br;
  });
  const first = branches[0];
  const branchOf = (id) => branches.find((b) => b.id === id) ?? branches.find((b) => b.quests.some((x) => x.id === id)) ?? null;
  const live = (br) => br.started && br.runner.running() && !br.runner.waiting();
  // (waiting for its giver to come up — the quest's first seek beat, or before it)
  // (a seek beat marked `queue` — coming back for another go after a fail / 'Later' — counts too)
  const pending = (br) => {
    const k = firstSeek(br.runner.quest());
    return (k >= 0 && br.runner.bi() <= k) || (br.runner.beat()?.do === 'seek' && !!br.runner.beat().queue);
  };
  const engaged = (br) => live(br) && !pending(br);
  // A branch's saved state (running or not yet) → is quest id done?
  const stateOf = (br) => (br.started ? br.runner.snapshot() : br.saved);
  const questDone = (id) => {
    const br = branchOf(id);
    if (!br) return false;
    const st = stateOf(br);
    const at = (x) => br.quests.findIndex((q) => q.id === x);
    if (br.id === id) return !!st?.after && at(st.after) === br.quests.length - 1;
    if (st?.after) return at(st.after) >= at(id);
    if (st?.id) return at(st.id) > at(id);
    return false;
  };
  const opened = (br) => {
    if (br === first) return true;
    if (!questDone(first.id)) return false;
    const from = br.def.from ?? {};
    if (from.day && (T.clock?.day ?? 1) < from.day) return false;
    if (from.after && !questDone(from.after)) return false;
    return true;
  };

  // ── Who may come up to the player now ──
  const order = [];            // branch ids waiting for their giver to come up, in the order they came
  let turn = null;             // the one whose giver may set off now
  const giverOf = (br) => {
    const quest = br.runner.quest();
    const b = quest?.beats[firstSeek(quest)];
    return b ? roleNpc(br.runner.q(), b.who) : null;
  };
  const underAttack = () => liveFoes().length > 0
    || T.npcs.some((n) => n.alive && n.fighter && !n.fighter.isDead && !n.campStandoff && T.distToPlayer(n) < ATTACK_DIST);
  // (why nobody may come up now — null: they may)
  const busyReason = () => {
    const p = T.playerPos();
    if (T.inCanoe?.() || ctx.getControls?.()?.isSwimming) return 'water';
    if (Math.hypot(p.x, p.z) > HOME_RADIUS) return 'away';
    if (underAttack()) return 'fight';
    return null;
  };
  const approachable = (br) => {
    const hours = br.def.from?.hours;
    if (hours && !inHours(T.hour(), hours)) return false;
    const n = giverOf(br);
    const b = br.runner.beat();
    return !!n && (!!b?.arrive || T.distToPlayer(n) < SEEK_FAR);
  };
  const updateBranches = () => {
    for (const br of branches) {
      if (br.started || !opened(br)) continue;
      br.started = true;
      br.runner.start(br.saved);
      br.saved = null;
    }
    for (const br of branches) {
      const k = order.indexOf(br.id);
      if (live(br) && pending(br)) { if (k < 0) order.push(br.id); }
      else if (!live(br) && k >= 0) order.splice(k, 1);
    }
    if (branches.some(engaged) || busyReason()) { turn = null; return; }
    const cands = order.map(branchOf).filter((br) => br && live(br) && pending(br) && approachable(br));
    if (cands.includes(turn)) return;
    turn = cands.find((br) => { const n = giverOf(br); return n && T.distToPlayer(n) < SEEK_NEAR; }) ?? cands[0] ?? null;
  };
  // (the seek beat: may this branch's giver come up to the player now?)
  function mayApproach(c) {
    const br = c.world.branch;
    return !br || engaged(br) || turn === br;
  }
  // What a `build` beat makes, once it's done (and back on a save: flags)
  const flags = {};
  const makers = {
    canoe: (on) => { flags.canoe = on; T.setCanoeBuilt?.(on); },
  };
  const applyFlags = () => { T.setCanoeBuilt?.(!!flags.canoe); };

  // The branch shown on the tracker / asked for its buttons first: the job under way, else the
  // one whose giver's coming
  const focus = () => branches.find(engaged) ?? turn ?? null;
  // Every live branch, the focus first
  const liveList = () => {
    const f = focus();
    return [...(f ? [f] : []), ...branches.filter((b) => b !== f && live(b))];
  };
  let started = false;

  // ── Hooks for the rest of Town ──
  const update = (dt) => {
    updateActors(dt);
    updateHomeBound();
    updateSay();
    if (!started) return;
    updateBranches();
    for (const br of branches) {
      if (!br.started) continue;
      const q = br.runner.q();
      if (q?.failOnDown && ctx.isPlayerDead()) {
        br.runner.fail(fill(br.runner.quest().downText ?? 'You went down — {wizard} limps back home. {wizard.He}\'ll ask again.', q));
        continue;
      }
      br.runner.update(dt);
    }
  };
  const BUSY_TEXT = { water: 'once you\'re back on land', away: 'once you\'re back in Brindlewick' };
  const questEntry = () => {
    const br = focus();
    if (!br) {
      // (someone waiting to come up, but the player's out on the water / away)
      const why = busyReason();
      const w = order.map(branchOf).find((b) => b && live(b) && pending(b));
      const n = w && BUSY_TEXT[why] ? giverOf(w) : null;
      if (!n) return null;
      return { title: `${w.runner.quest().tag ?? 'Job'}: ${w.runner.quest().title}`, progress: `${firstName(n.name)} wants a word — ${BUSY_TEXT[why]}`, icon: '❗' };
    }
    const quest = br.runner.quest();
    const b = br.runner.beat();
    const progress = br.runner.entry() ?? fill(quest.title, br.runner.q());
    return { title: `${quest.tag ?? 'Job'}: ${quest.title}`, progress, icon: BEATS[b?.do]?.icon ?? '📍' };
  };
  // A quest's 'do' beat (its goal — an old save's step in its 'do' phase picks up there)
  const doBeat = (id) => Math.max(0, ALL_QUESTS.find((x) => x.id === id)?.beats.findIndex((b) => b.label === 'do') ?? 0);
  const FIRST_DONE = { after: FIRST_DAY[FIRST_DAY.length - 1].id };
  // (saved: { v: 2, b: { <branch>: runner state }, flags }; an older save — one runner over the
  // first day then the wizard's jobs: { id, bi } / { after } — goes to the branch holding that
  // quest, the first day done if it's past it; none: an old save's first day — the step machine
  // townIntro.js was — `{ id | step, phase }` / `{ after }` / null (from before the jobs: its first
  // day done); nothing at all — a new town: the first day from the start)
  const startQuests = (saved, legacyIntro) => {
    cartState.load = null;
    started = true;
    order.length = 0;
    turn = null;
    for (const k of Object.keys(flags)) delete flags[k];
    for (const br of branches) { br.started = false; br.saved = null; br.runner.stop(); }
    const put = (st) => {
      const id = st?.id ?? st?.after;
      const br = id ? branchOf(id) : null;
      if (!br) return;
      br.saved = st;
      if (br !== first) first.saved = FIRST_DONE;
    };
    if (saved?.v === 2) {
      for (const br of branches) br.saved = saved.b?.[br.id] ?? null;
      Object.assign(flags, saved.flags ?? {});
    } else if (saved !== undefined && saved !== null) put(saved);
    else if (legacyIntro === null) first.saved = FIRST_DONE;
    else if (legacyIntro) {
      const li = legacyIntro;
      if (li.after) put({ after: li.after });
      else {
        const id = li.id ?? OLD_STEP_IDS[li.step];
        if (ALL_QUESTS.some((x) => x.id === id)) put({ id, bi: li.phase === 'do' ? doBeat(id) : 0 });
      }
    }
    applyFlags();
    updateBranches();
  };
  const questSnapshot = () => {
    if (!started) return undefined;
    const b = {};
    for (const br of branches) b[br.id] = stateOf(br) ?? null;
    return { v: 2, b, flags: { ...flags } };
  };
  const resetQuests = () => {
    for (const br of branches) { if (br.started) cleanup(br.runner.q()); br.runner.stop(); br.started = false; }
    order.length = 0;
    turn = null;
    started = false;
    homeBound.clear();
    for (const n of T.npcs) if (n.questing) release(n);
    cartState.load = null;
  };
  // (dev console: on to a quest by id — in whichever branch has it; a job skips the first day)
  const jump = (id, label = null, waitS = 0) => {
    const br = branchOf(id);
    if (!br || !started) return false;
    if (br !== first && !questDone(first.id)) { if (!first.started) { first.started = true; first.runner.start(FIRST_DONE); } else first.runner.finish(); }
    if (!br.started) { br.started = true; br.runner.start(null); br.saved = null; }
    return br.runner.jump(id, label, waitS);
  };

  Object.assign(T, {
    updateQuests: update,
    updateQuestNpc,
    startQuests,
    resetQuests,
    // (something counted toward a goal — 'fish' / 'cook' / 'pick' / 'sell' / 'wood' / 'job')
    questNote: (kind, data) => started && liveList().some((br) => br.runner.event(kind, data)),
    // (picking a field is no theft while helping its farmer with the harvest)
    questAllowsPick: (field) => started && liveList().some((br) => {
      const b = br.runner.beat();
      if (b?.do !== 'goal' || !b.allowPick) return false;
      const g = b.guide ? T.npcById(br.runner.q()?.cast?.[b.guide]) : null;
      return !g || g.work === field;
    }),
    questSnapshot,
    questEntry,
    // (❗ over every giver waiting to come up, the 📍 of the job under way)
    questMarkers: () => (started ? liveList().map((br) => br.runner.marker()).filter(Boolean) : []),
    questActs: () => (started ? focus()?.runner.acts() ?? [] : []),
    questHighlight: () => (started ? focus()?.runner.highlight() ?? null : null),
    // (talking to someone: the job under way's; with none, any waiting giver's — the player picks)
    questTalk: (n) => {
      if (!started) return false;
      const busy = branches.find(engaged);
      if (busy) return busy.runner.talkTo(n);
      return liveList().some((br) => br.runner.talkTo(n));
    },
    isQuestGiver: (n) => started && !branches.some(engaged)
      && liveList().some((br) => br.runner.beat()?.do === 'seek' && br.runner.q()?.cast?.[br.runner.beat().who] === n.id),
    // (a quiet job, once it's under way — the wizard aboard: the camp leaves the player be)
    questQuiet: () => started && branches.some((br) => engaged(br) && !!br.runner.quest()?.quiet && !!br.runner.q()?.failOnDown),
    questDone: (id) => started && questDone(id),
    // (a job under way — any branch but the first day, past its giver coming up: Town's job songs)
    questJobActive: () => started && branches.some((br) => br !== first && engaged(br)),
    cartLoad: () => cartState.load,
    cartInUse: () => started && branches.some((br) => engaged(br) && !!br.runner.q()?.cast && Object.keys(br.runner.q().cast).length > 0),
    // (the sword / wand's camera auto-aim — townMode.js threats)
    questThreats: () => [...liveFoes().map((f) => f.e.group.position), ...(T.pirateThreats?.() ?? [])],
    // (the talk camera: an actor saying the line now)
    questTalkFocus: () => (talker.isOpen() ? actors.get(talker.speaker()) ?? null : null),
    // (text to speech for someone in a job who isn't a townsperson)
    questVoice: (who) => {
      for (const a of actors.values()) {
        if (a.name === who) return { key: a.name, kind: a.voice.kind ?? 'male', family: a.voice.family ?? null, at: { x: a.x, y: T.groundAt(a.x, a.z) + 1.4, z: a.z } };
      }
      return null;
    },
    // (dev console: town.debug().T.quests.jump('wizardSon') / .jump('canoe', 'do'))
    quests: { jump, branches, order: () => [...order], turn: () => turn?.id ?? null, busyReason },
    questDebug: () => ({ foes: foes.list, actors, cartLoad: cartState.load, started, turn: turn?.id ?? null, order: [...order], flags: { ...flags }, branches: branches.map((b) => ({ id: b.id, started: b.started, state: stateOf(b), live: live(b), pending: b.started && pending(b), engaged: engaged(b) })) }),
  });
}

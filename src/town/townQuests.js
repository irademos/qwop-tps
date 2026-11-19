// Town: the first day and the jobs after it, run by the shared quest runner
// (src/quest/questRunner.js) from their data (src/town/quests/firstDay.js, then quests/jobs.js —
// one list, in order). This file is Town's side of it:
//   - the WORLD the beats act in: places, the townspeople a job has taken over (its "cast"),
//     people who aren't townsfolk (actors — the wizard's son), the bandits of an ambush (foes)
//   - the BEATS (src/town/beats/ — people: seek, talk; goal: goal, unless, banner; cart: cart,
//     unload, lockCart, board, alight, drive; scene: actor, bomb, actorLeave; ambush; rewards: pay,
//     release) — each a small piece any job can use, given this file's world W (a guide leading
//     the way to a goal, the player walked along: townGuide.js); plus the runner's own `wait` and,
//     on any beat, `talks` (talk to someone whenever — openTalk) and `entry`
//   - the hooks Town calls: tracker line (questEntry), marker (questMarker), acts, the button to
//     ring (questHighlight), talking to someone (questTalk), a cast member's frame (updateQuestNpc —
//     the 'quest' task, townReactions.js), saves (questSnapshot / startQuests)
//
// A townsperson in a job (`n.questing`) does what their mode says (`n.qmode`): seek (walk up to
// the player), lead (show the way to a goal — townGuide.js), stand, follow, board (climb into the cart) → seated (crouched in its bed, carried
// along — n.seat, townFolk.js syncBody), knocked (thrown down a moment), fight (an ally: wand
// blasts at the job's foes — ctx.castAllySpell), linger (strolling round after the job). Their
// health in a fight is the job's (ALLY_HP); bandits of an ambush can go for them
// (`questTarget` on the foe — the horde loop in bootstrapGameApp.js).

import * as THREE from 'three';
import { createQuestRunner } from '../quest/questRunner.js';
import { createTalkRunner } from '../quest/talk.js';
import { townBeats } from './beats/index.js';
import { JOBS } from './quests/jobs.js';
import { FIRST_DAY, OLD_STEP_IDS } from './quests/firstDay.js';
import { installTownGuide, newLead } from './townGuide.js';
import { FOOD_IDS, GOOD_IDS, SHOP_GEAR, goodPrice } from './townEconomy.js';
import { BANDIT_NAMES, firstName } from './townPeople.js';
import { createGLBCharacterInstance, glbCharacterConfig } from '../models/glbCharacterModel.js';
import { RUN_SPEED, WALK_SPEED, dist2, heightScale, pickOf } from './townConfig.js';

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
// Everything in order: the first day's goals, then the jobs
const QUESTS = [...FIRST_DAY, ...JOBS];

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

  // ── Places ──
  const placeOf = (name) => {
    const pl = P();
    if (name === 'wizard') return pl.wizard.customer;
    if (name === 'camp') return pl.camp;
    if (name === 'town') return pl.spawn;
    if (name === 'cart') return T.cartPose?.() ?? T.playerPos();
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
    talkEnd = (actions) => { runner.act(actions); };
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
      runner.jump(JOBS[0].id, null, JOBS[0].waitS ?? 0);
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
        if (T.fishing) return gyro ? null : { act: 'fishpull' };
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
    if (runner.npc(n, dt)) return true;
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
    // (a quest restarting / dropped: everything it set going put away)
    questReset: (_quest, q) => cleanup(q),
    questEnded: (_quest, q) => { cleanup(q); T.save(); },
  };
  const cleanup = (q) => {
    if (talker.isOpen()) talker.close();
    talkC = null;
    talkEnd = null;
    T.driveTo(null);
    clearActors();
    clearFoes();
    if (cartState.locked) { T.lockCart?.(false); cartState.locked = false; }
    for (const id of Object.values(q?.cast ?? {})) {
      const n = T.npcById(id);
      if (!n?.questing) continue;
      unseat(n);
      if (n.qmode?.kind === 'knocked') n.body?.character.revive();
      // (the wizard: home once the player's away — no walk joins his mountain to town)
      if (n.def.hermit) { control(n, { kind: 'linger', until: T.simT, ax: n.x, az: n.z }); sendHome(n); }
      else release(n);
    }
    if (q) { q.cast = {}; q.failOnDown = false; }
  };
  // ── Town's quest world for the beats (src/town/beats/) ──
  const W = {
    T, ctx, P, THREE, roleNpc, roleGone, canTake, control, release, go, stand, fill, calm, isNight, npcMark, placeOf, cartAt,
    actors, spawnActor, actorSay, foes, liveFoes, clearFoes, seat, unseat, hitAlly, sendHome, open, talker, tipTalk,
    guideBuys, goalHighlight, cartState, newLead, glbCharacterConfig, BANDIT_NAMES, firstName, pickOf, dist2,
    SNOOZE_S, ALLY_HP, GUIDE_REACH, SEEK_STOP, SEEK_STUCK_S, BOARD_TIMEOUT_S, ACTOR_TIMEOUT_S, ACTOR_RUN,
    BOMB_THROW_AT_S, BOMB_AFTER_S, FOE_HEARTS, FOE_SPAWN_DIST, FOE_GEAR, FOE_COINS,
  };
  const BEATS = townBeats(W);
  const runner = createQuestRunner({ quests: QUESTS, beats: BEATS, world, onChange: () => { T.actsAt = 0; } });
  let started = false;

  // ── Hooks for the rest of Town ──
  const update = (dt) => {
    updateActors(dt);
    updateHomeBound();
    if (!started) return;
    const q = runner.q();
    if (q?.failOnDown && ctx.isPlayerDead()) {
      runner.fail(fill('You went down — {wizard} limps back home. {wizard.He}\'ll ask again.', q));
      return;
    }
    runner.update(dt);
  };
  const questEntry = () => {
    const quest = runner.quest();
    if (!quest || runner.waiting()) return null;
    const b = runner.beat();
    const progress = runner.entry() ?? fill(quest.title, runner.q());
    return { title: `${quest.tag ?? 'Job'}: ${quest.title}`, progress, icon: BEATS[b?.do]?.icon ?? '📍' };
  };
  // A quest's 'do' beat (its goal — an old save's step in its 'do' phase picks up there)
  const doBeat = (id) => Math.max(0, QUESTS.find((x) => x.id === id)?.beats.findIndex((b) => b.label === 'do') ?? 0);
  // (saved: the runner's state; none: an old save's first day — the step machine townIntro.js
  // was — `{ id | step, phase }` / `{ after }` / null (from before the jobs: its first day done);
  // nothing at all — a new town: the first day from the start)
  const startQuests = (saved, legacyIntro) => {
    cartState.load = null;
    started = true;
    if (saved !== undefined && saved !== null) { runner.start(saved); return; }
    const li = legacyIntro;
    if (li === undefined) { runner.start(null); return; }
    if (li === null) { runner.start({ after: FIRST_DAY[FIRST_DAY.length - 1].id }); return; }
    if (li.after) { runner.start({ after: li.after }); return; }
    const id = li.id ?? OLD_STEP_IDS[li.step];
    if (!QUESTS.some((x) => x.id === id)) { runner.start(null); return; }
    runner.start({ id, bi: li.phase === 'do' ? doBeat(id) : 0 });
  };
  const resetQuests = () => {
    cleanup(runner.q());
    runner.stop();
    started = false;
    homeBound.clear();
    for (const n of T.npcs) if (n.questing) release(n);
    cartState.load = null;
  };

  Object.assign(T, {
    updateQuests: update,
    updateQuestNpc,
    startQuests,
    resetQuests,
    // (something counted toward a goal — 'fish' / 'cook' / 'pick' / 'sell' / 'wood' / 'job')
    questNote: (kind, data) => started && runner.event(kind, data),
    // (picking a field is no theft while helping its farmer with the harvest)
    questAllowsPick: (field) => {
      const b = started ? runner.beat() : null;
      if (b?.do !== 'goal' || !b.allowPick || runner.waiting()) return false;
      const g = b.guide ? T.npcById(runner.q()?.cast?.[b.guide]) : null;
      return !g || g.work === field;
    },
    questSnapshot: () => (started ? runner.snapshot() : undefined),
    questEntry,
    questMarker: () => (started ? runner.marker() ?? null : null),
    questActs: () => (started ? runner.acts() : []),
    questHighlight: () => (started ? runner.highlight() : null),
    questTalk: (n) => started && runner.talkTo(n),
    isQuestGiver: (n) => started && runner.beat()?.do === 'seek' && !runner.waiting() && runner.q()?.cast?.[runner.beat().who] === n.id,
    // (a quiet job, once it's under way — the wizard aboard: the camp leaves the player be)
    questQuiet: () => started && !!runner.quest()?.quiet && !runner.waiting() && !!runner.q()?.failOnDown,
    cartLoad: () => cartState.load,
    cartInUse: () => started && !!runner.q()?.cast && Object.keys(runner.q().cast).length > 0,
    // (the sword / wand's camera auto-aim — townMode.js threats)
    questThreats: () => liveFoes().map((f) => f.e.group.position),
    // (the talk camera: an actor saying the line now)
    questTalkFocus: () => (talker.isOpen() ? actors.get(talker.speaker()) ?? null : null),
    // (text to speech for someone in a job who isn't a townsperson)
    questVoice: (who) => {
      for (const a of actors.values()) {
        if (a.name === who) return { key: a.name, kind: a.voice.kind ?? 'male', family: a.voice.family ?? null, at: { x: a.x, y: T.groundAt(a.x, a.z) + 1.4, z: a.z } };
      }
      return null;
    },
    quests: runner, // (dev console: town.debug().T.quests.jump('wizardSon'))
    questDebug: () => ({ foes: foes.list, actors, cartLoad: cartState.load, started }),
  });
}

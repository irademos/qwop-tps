// Town: the jobs after the first day, run by the shared quest runner (src/quest/questRunner.js)
// from their data (src/town/quests/jobs.js). This file is Town's side of it:
//   - the WORLD the beats act in: places, the townspeople a job has taken over (its "cast"),
//     people who aren't townsfolk (actors — the wizard's son), the bandits of an ambush (foes)
//   - the BEATS (BEATS below): seek, talk, cart, board, alight, drive, lockCart, actor, bomb,
//     actorLeave, ambush, pay, unload, release — each a small piece any job can use
//   - the hooks Town calls: tracker line (questEntry), marker (questMarker), acts, the button to
//     ring (questHighlight), talking to someone (questTalk), a cast member's frame (updateQuestNpc —
//     the 'quest' task, townReactions.js), saves (questSnapshot / startQuests)
// The first day (townIntro.js) still runs on its own; when it's done, the jobs start here
// (T.firstDayDone). Moving the first day onto beats too is the next step (see CLAUDE.md).
//
// A townsperson in a job (`n.questing`) does what their mode says (`n.qmode`): seek (walk up to
// the player), stand, follow, board (climb into the cart) → seated (crouched in its bed, carried
// along — n.seat, townFolk.js syncBody), knocked (thrown down a moment), fight (an ally: wand
// blasts at the job's foes — ctx.castAllySpell), linger (strolling round after the job). Their
// health in a fight is the job's (ALLY_HP); bandits of an ambush can go for them
// (`questTarget` on the foe — the horde loop in bootstrapGameApp.js).

import * as THREE from 'three';
import { createQuestRunner } from '../quest/questRunner.js';
import { createTalkRunner } from '../quest/talk.js';
import { runActions } from '../quest/actions.js';
import { JOBS } from './quests/jobs.js';
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
const LINGER_HOME_DIST = 30;
// A townsperson's words in a job's lines ({wizard.dad}…): [his, hers]
const WORDS = {
  dad: ['dad', 'mum'], father: ['father', 'mother'], he: ['he', 'she'], him: ['him', 'her'], his: ['his', 'her'],
  man: ['man', 'woman'], sir: ['sir', 'madam'],
};  // m the player is away before a lingering townsperson goes home

export function installTownQuests(T, ctx) {
  const P = () => T.layout.places;
  const playerName = () => ctx.getPlayerName();

  // ── The cast: townspeople a job has taken over ──
  const roleNpc = (q, role) => {
    const keep = q?.cast?.[role] != null ? T.npcById(q.cast[role]) : null;
    if (keep?.alive) return keep;
    const p = T.playerPos();
    const n = T.npcs.filter((x) => x.alive && x.role === role && !x.fighter && !x.def.outlaw && x.jailedUntil <= T.simT)
      .sort((a, b) => dist2(a.x, a.z, p.x, p.z) - dist2(b.x, b.z, p.x, p.z))[0] ?? null;
    if (n && q) (q.cast ??= {})[role] = n.id;
    return n;
  };
  const control = (n, mode) => {
    if (!n?.alive || n.fighter) return false;
    if (!n.questing) {
      if (!T.take(n)) return false;
      n.questing = true;
      n.guiding = false;
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
  let foes = [];              // { e, paid }
  const liveFoes = () => foes.filter((f) => !f.e.isDead);
  const clearFoes = () => {
    for (const f of foes) if (!f.e.isDead) ctx.removeFighter(f.e);
    foes = [];
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
  const fill = (text, q) => String(text ?? '').replace(/\{(\w+)(?:\.(\w+))?\}/g, (_, k, w) => {
    if (k === 'name') return playerName();
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
    const n = q?.cast?.[who] != null ? T.npcById(q.cast[who]) : null;
    return n ? firstName(n.name) : who;
  };

  const calm = () => !T.jobTalk.isOpen() && !T.storage.isOpen() && !T.fishing && !T.cooking && !T.sequence
    && !T.stalls.focused() && !T.lockpick.isOpen() && !T.jail && !ctx.isPlayerDead();
  const isNight = () => { const h = T.hour(); return h >= 21 || h < 6.5; };
  const npcMark = (n, icon = '❗') => (n && !n.inside ? { icon, x: n.x, z: n.z, h: 1.7 * heightScale(n.url) + 0.5 } : null);

  // ── The beats ──
  const BEATS = {
    // The giver comes to find the player (❗ over them); talking to them first does too
    seek: {
      start: (c) => { c.s.since = T.simT; c.s.best = Infinity; c.s.bestAt = T.simT; },
      update: (c) => {
        const { beat: b, s } = c;
        const n = roleNpc(c.q, b.who);
        s.n = n;
        if (!n) return false;
        if (isNight() && !b.anyTime) { if (n.questing) release(n); return false; }
        if (T.law.stars > 0 || T.inRoom) { if (n.questing && n.qmode?.kind === 'seek') control(n, 'stand'); return false; }
        if (!n.questing || !['seek', 'wait'].includes(n.qmode?.kind)) control(n, 'seek');
        const d = T.distToPlayer(n);
        // (no walk from their place to the player — the wizard's mountain: they wait there)
        if (d < s.best - 0.3) { s.best = d; s.bestAt = T.simT; }
        else if (n.qmode.kind === 'seek' && T.simT - s.bestAt > SEEK_STUCK_S && d > 12) control(n, 'wait');
        const reach = Math.max(SEEK_STOP + 0.6, b.talkFrom ?? 0);
        return d < reach && !!n.body && calm();
      },
      talkTo: (c, n) => (n === c.s.n ? (c.next(), true) : false),
      entry: (c) => {
        const n = c.s.n;
        if (!n) return 'Look around town';
        const who = `${firstName(n.name)} the ${n.def.label.toLowerCase()}`;
        if (isNight() && !c.beat.anyTime) return `${who} will come and find you in the morning`;
        if (n.qmode?.kind === 'wait') return `Go and see ${who}`;
        return T.distToPlayer(n) > 6 ? `${who} is coming to find you` : `Talk to ${who}`;
      },
      marker: (c) => npcMark(c.s.n),
      icon: '❗',
    },
    // A talk (lines, the last ending in choices) — its `who` stands facing the player meanwhile
    talk: {
      start: (c) => {
        const { beat: b, s } = c;
        const n = actors.has(b.who) ? null : roleNpc(c.q, b.who);
        if (!actors.has(b.who) && !n) return false; // (try again in update)
        s.n = n;
        open(c);
        return false;
      },
      update: (c) => {
        const { beat: b, s } = c;
        if (!s.opened) { s.n = roleNpc(c.q, b.who); if (s.n || actors.has(b.who)) open(c); return false; }
        if (s.actions) return flow(c, s.actions);
        if (talker.isOpen()) return false;
        // (closed without a choice — walked off)
        const leave = b.onLeave ?? (b.choices?.some((x) => x.then?.includes('later')) ? 'later' : 'reopen');
        if (leave === 'next') return true;
        if (leave === 'later') { c.later(SNOOZE_S); return false; }
        if (s.n && T.distToPlayer(s.n) < (b.reach ?? 3) && calm()) open(c);
        return false;
      },
      end: (c) => { if (talker.isOpen() && c.s.opened && !c.s.actions) talker.close(); },
      npc: (c, n, dt) => {
        if (n !== c.s.n) return false;
        if (n.seat || n.qmode?.kind === 'knocked') return false;
        stand(n, T.playerPos().x, T.playerPos().z, dt);
        return true;
      },
      entry: (c) => (c.beat.text ? fill(c.beat.text, c.q) : c.s.n ? `Talk to ${firstName(c.s.n.name)}` : null),
    },
    // The cart: brought beside the player (bring), its load (load: 'veg' / null)
    cart: {
      start: (c) => {
        const { beat: b } = c;
        if ('load' in b) cartLoad = b.load ?? null;
        if (b.bring && !T.bringCart?.()) T.feedLine('The cart\'s by the market — get in it there.');
        return true;
      },
    },
    unload: { start: () => { if (cartLoad) T.feedLine('The cart\'s load is handed over.'); cartLoad = null; return true; } },
    lockCart: { start: (c) => { T.lockCart?.(!!c.beat.on); cartLocked = !!c.beat.on; return true; } },
    // A townsperson climbs into the back of the cart (carried along, crouched in its bed)
    board: {
      start: (c) => { if (!cartAt()) T.bringCart?.(); c.s.t = 0; },
      update: (c, dt) => {
        const n = roleNpc(c.q, c.beat.who);
        c.s.n = n;
        if (!n) return false;
        if (n.qmode?.kind === 'seated') { c.q.failOnDown = true; return true; }
        if (T.cartFlipped?.() || !cartAt()) return false;
        c.s.t += dt;
        if (n.qmode?.kind !== 'board') control(n, 'board');
        if (c.s.t > BOARD_TIMEOUT_S) seat(n);
        return false;
      },
      entry: (c) => (T.cartFlipped?.() ? 'Wait for the cart to right itself' : c.s.n ? `${firstName(c.s.n.name)} is climbing into the cart` : null),
    },
    alight: {
      start: (c) => {
        const n = roleNpc(c.q, c.beat.who);
        if (n) { unseat(n); control(n, 'stand'); }
        c.q.failOnDown = false;
        return true;
      },
    },
    // Glowing arrows to a place; done once the cart's within r of it (with the player in it or by it)
    drive: {
      start: (c) => { c.s.planAt = 0; },
      update: (c) => {
        const { beat: b } = c;
        const to = placeOf(b.to);
        if (!to) return false;
        if (T.simT > c.s.planAt) { c.s.planAt = T.simT + 0.5; T.driveTo({ x: to.x, z: to.z, r: Math.min(4, b.r * 0.5) }); }
        const cp = cartAt();
        return !!cp && dist2(cp.x, cp.z, to.x, to.z) < b.r && (T.inCart() || T.distToPlayer(cp) < 5);
      },
      end: () => T.driveTo(null),
      entry: (c) => {
        const cp = cartAt();
        if (!T.inCart()) return cp && T.distToPlayer(cp) > 6 ? 'Back to the cart' : 'Get in the cart';
        return fill(c.beat.text, c.q);
      },
      marker: (c) => {
        const cp = !T.inCart() ? cartAt() : null;
        if (cp && T.distToPlayer(cp) > 6) return { icon: '📍', x: cp.x, z: cp.z, h: 1.6 };
        const to = placeOf(c.beat.to);
        return to ? { icon: '📍', x: to.x, z: to.z, h: 2.6 } : null;
      },
      highlight: () => (T.inCart() ? null : { act: 'cartin' }),
    },
    // Someone who isn't a townsperson walks out to meet the cart
    actor: {
      start: (c) => {
        const { beat: b } = c;
        const from = placeOf(b.from);
        const to = placeOf(b.to);
        const dx = from.x - to.x;
        const dz = from.z - to.z;
        const d = Math.hypot(dx, dz) || 1;
        const a = spawnActor(b, { x: from.x + 1.5, z: from.z + 1.5 });
        a.to = { x: to.x + (dx / d) * b.gap, z: to.z + (dz / d) * b.gap };
        a.face = to;
        c.s.a = a;
      },
      update: (c) => {
        const a = c.s.a;
        if (!actors.has(a.id)) return true;
        if (a.arrived) { a.to = null; return true; }
        if (a.t > ACTOR_TIMEOUT_S) { a.x = a.to.x; a.z = a.to.z; a.arrived = true; }
        return false;
      },
      entry: (c) => c.beat.text ?? null,
    },
    // An actor throws a bomb at the cart: it's knocked over, everyone in it thrown out
    bomb: {
      start: (c) => { c.s.t = 0; },
      update: (c, dt) => {
        const { beat: b, s } = c;
        const a = actors.get(b.from);
        const cp = cartAt();
        s.t += dt;
        if (!s.thrown) {
          if (!a || !cp) return true;
          a.face = cp;
          if (!s.wound) { s.wound = true; a.inst?.character.playAction(glbCharacterConfig.throwClip); }
          if (s.t < BOMB_THROW_AT_S) return false;
          s.thrown = true;
          const yaw = Math.atan2(cp.x - a.x, cp.z - a.z);
          const from = new THREE.Vector3(a.x + Math.sin(yaw) * 0.4, T.groundAt(a.x, a.z) + 1.4, a.z + Math.cos(yaw) * 0.4);
          // (just short of it, on his side: it goes over away from him)
          const to = new THREE.Vector3(cp.x - Math.sin(yaw) * 0.9, T.groundAt(cp.x, cp.z), cp.z - Math.cos(yaw) * 0.9);
          ctx.throwBomb?.(from, to, (at) => {
            s.blastAt = T.simT;
            T.knockCart?.({ x: at.x, z: at.z });
            // (standing beside it: thrown too)
            if (!T.inCart() && T.distToPlayer({ x: at.x, z: at.z }) < 3.5) {
              const p = T.playerPos();
              const d = Math.hypot(p.x - at.x, p.z - at.z) || 1;
              ctx.throwPlayer?.({ x: (p.x - at.x) / d, z: (p.z - at.z) / d });
            }
          });
          if (!ctx.throwBomb) { s.blastAt = T.simT; T.knockCart?.({ x: to.x, z: to.z }); }
          return false;
        }
        if (s.blastAt == null) return s.t > 6; // (lost somewhere: on anyway)
        return T.simT - s.blastAt > BOMB_AFTER_S;
      },
    },
    actorLeave: {
      start: (c) => {
        const a = actors.get(c.beat.id);
        if (!a) return true;
        if (c.beat.shout) actorSay(a, c.beat.shout);
        a.to = placeOf(c.beat.to);
        a.face = null;
        a.speed = ACTOR_RUN;
        a.arrived = false;
        a.leaving = true;
        return true;
      },
    },
    // Bandits come at the player; the job's allies fight beside them
    ambush: {
      start: (c) => {
        const { beat: b, q } = c;
        clearFoes();
        const p = T.playerPos();
        const from = placeOf(b.from) ?? p;
        const base = Math.atan2(from.x - p.x, from.z - p.z);
        const allies = (b.allies ?? []).map((r) => roleNpc(q, r)).filter(Boolean);
        q.allyHp = Object.fromEntries(allies.map((n) => [n.id, ALLY_HP]));
        for (const n of allies) {
          if (n.qmode?.kind === 'seated') unseat(n);
          if (n.qmode?.kind !== 'knocked') control(n, 'fight');
          else n.qmode.after = 'fight';
        }
        const url = glbCharacterConfig.frogManUrl;
        const used = new Set();
        for (let i = 0; i < b.count; i++) {
          const a = base + (i - (b.count - 1) / 2) * 0.32;
          const r = FOE_SPAWN_DIST[0] + Math.random() * (FOE_SPAWN_DIST[1] - FOE_SPAWN_DIST[0]);
          let x = p.x + Math.sin(a) * r;
          let z = p.z + Math.cos(a) * r;
          const cell = T.layout.nav.nearestWalkable(x, z);
          if (cell >= 0 && dist2(T.layout.nav.cellX(cell), T.layout.nav.cellZ(cell), x, z) < 4) { x = T.layout.nav.cellX(cell); z = T.layout.nav.cellZ(cell); }
          const ally = i < (b.onAlly ?? 0) ? allies[i % Math.max(1, allies.length)] ?? null : null;
          let name = pickOf(BANDIT_NAMES);
          for (let k = 0; k < 5 && used.has(name); k++) name = pickOf(BANDIT_NAMES);
          used.add(name);
          const e = ctx.spawnFighter({
            x, z, yaw: Math.atan2(p.x - x, p.z - z), url, hearts: FOE_HEARTS, swingChance: 0.32,
            gear: ally ? null : FOE_GEAR[i % FOE_GEAR.length], name,
          });
          if (!e) continue;
          e._questFoe = true;
          // (the ones going for an ally: at them while they're up)
          if (ally) {
            e.questTarget = () => {
              if (!ally.alive || !ally.body || (q.allyHp[ally.id] ?? 0) <= 0 || ally.qmode?.kind === 'knocked') return null;
              return {
                model: ally.body.container,
                onHit: (_m, dir) => { hitAlly(c, ally, dir); return 'hit'; },
              };
            };
          }
          foes.push({ e, paid: false });
        }
        c.s.total = foes.length;
        ctx.playSfx?.('unsheath');
      },
      update: (c) => {
        if (ctx.isPlayerDead()) { c.fail(fill('You went down — {wizard} limps back up the mountain. {wizard.He}\'ll ask again.', c.q)); return false; }
        for (const f of foes) {
          if (f.e.isDead && !f.paid) {
            f.paid = true;
            const at = f.e.group.position.clone();
            at.y += 0.3;
            ctx.dropCoins(at, FOE_COINS);
          }
        }
        return foes.length > 0 && !liveFoes().length;
      },
      end: (c) => {
        // (the allies: back to standing by)
        for (const id of Object.keys(c.q.allyHp ?? {})) {
          const n = T.npcById(+id);
          if (n?.questing && n.qmode?.kind === 'fight') control(n, 'stand');
        }
      },
      entry: (c) => `${fill(c.beat.text, c.q)} (${c.s.total - liveFoes().length} / ${c.s.total})`,
      icon: '⚔️',
    },
    pay: {
      start: (c) => {
        const { beat: b, q } = c;
        const n = roleNpc(q, b.from);
        if (b.coins > 0) { ctx.addCoins(b.coins); ctx.playSfx?.('coin'); }
        if (n) {
          n.attitude = Math.min(1, n.attitude + 0.15);
          if (b.memory) T.remember(n, 'intro', { what: b.memory });
        }
        T.feedLine(`${c.quest.title} — done${b.coins ? ` · +${b.coins} coins` : ''}`);
        return true;
      },
    },
    release: {
      start: (c) => {
        const n = roleNpc(c.q, c.beat.who);
        if (!n) return true;
        unseat(n);
        if (c.beat.linger) {
          control(n, { kind: 'linger', until: T.simT + c.beat.linger, ax: n.x, az: n.z });
          sendHome(n);
        } else release(n);
        // (kept out of the job's cleanup)
        if (c.q.cast) delete c.q.cast[c.beat.who];
        return true;
      },
    },
  };

  // ── Talk: the shared talk (src/quest/talk.js) over Town's talk box ──
  let talkC = null;            // the run context of the talk beat it's for
  const talker = createTalkRunner({
    box: T.jobTalk,
    name: (who) => speakerName(who, talkC?.q),
    fill: (t) => fill(t, talkC?.q),
    onLine: (who) => {
      // (the speaker turns to whoever they're talking to; an actor talks to the anchor)
      const a = actors.get(who);
      if (a) { const n = talkC?.s.n; a.face = n ? { x: n.x, z: n.z } : T.playerPos(); }
    },
    run: (actions) => { if (talkC) talkC.s.actions = actions ?? []; },
  });
  const open = (c) => {
    const { beat: b, s } = c;
    s.opened = true;
    talkC = c;
    T.talking = s.n ? { npc: s.n, reach: b.reach } : null;
    talker.say({ lines: b.lines, choices: b.choices, reward: b.reward, then: b.then });
  };
  // What a talk's ending does: 'later' / 'fail' / 'goto:<label>' / 'done', else on to the next beat
  const flow = (c, actions) => {
    let moved = false;
    runActions(actions, {
      next: () => { moved = true; c.next(); },
      later: (s) => { moved = true; c.later(Number(s) || SNOOZE_S); },
      fail: () => { moved = true; c.fail(); },
      goto: (label) => { moved = true; c.goto(label); },
      done: () => { moved = true; c.done(); },
      note: (t) => T.feedLine(fill(t, c.q)),
    }, { warn: '[Town job]' });
    return !moved;
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
        const d = T.distToPlayer(n);
        if (d > SEEK_STOP) go(n, p.x, p.z, dt, d > 12);
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
  let cartLoad = null;         // what a job's put in the cart's bed ('veg' / null)
  let cartLocked = false;
  const world = {
    time: () => T.simT,
    feed: (text) => T.feedLine(text),
    runActions: (list, c) => flow(c, list),
    // (a quest restarting / dropped: everything it set going put away)
    questReset: (_quest, q) => cleanup(q),
    questEnded: (_quest, q) => { cleanup(q); T.save(); },
  };
  const cleanup = (q) => {
    if (talker.isOpen()) talker.close();
    talkC = null;
    T.driveTo(null);
    clearActors();
    clearFoes();
    if (cartLocked) { T.lockCart?.(false); cartLocked = false; }
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
  const runner = createQuestRunner({ quests: JOBS, beats: BEATS, world, onChange: () => { T.actsAt = 0; } });
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
    return { title: `Job: ${quest.title}`, progress, icon: BEATS[b?.do]?.icon ?? '📍' };
  };
  // (saved: the runner's state; an old save's townIntro step for the jobs that used to be there)
  const startQuests = (saved, legacyIntro) => {
    started = false;
    cartLoad = null;
    if (saved !== undefined && saved !== null) { runner.start(saved); started = true; return; }
    const li = legacyIntro;
    if (li?.id === 'veg') { runner.start({ id: 'veg', bi: li.phase === 'do' ? 2 : 0 }); started = true; return; }
    if (li?.id === 'wizardPay') { runner.start({ id: 'wizardPay', bi: 0 }); started = true; return; }
    if (li?.after === 'wizardPay') { runner.start({ after: 'wizardPay' }); started = true; return; }
    // (the first day done — a save's null or `after` its last step: the jobs start)
    if (!T.intro) { runner.start(null); started = true; }
  };
  const firstDayDone = () => {
    if (started) return;
    runner.start(null);
    started = true;
    T.save();
  };
  const resetQuests = () => {
    cleanup(runner.q());
    runner.stop();
    started = false;
    homeBound.clear();
    for (const n of T.npcs) if (n.questing) release(n);
    cartLoad = null;
  };

  Object.assign(T, {
    updateQuests: update,
    updateQuestNpc,
    startQuests,
    firstDayDone,
    resetQuests,
    questSnapshot: () => (started ? runner.snapshot() : undefined),
    questEntry,
    questMarker: () => (started ? runner.marker() ?? null : null),
    questActs: () => (started ? runner.acts() : []),
    questHighlight: () => (started ? runner.highlight() : null),
    questTalk: (n) => started && runner.talkTo(n),
    isQuestGiver: (n) => started && runner.beat()?.do === 'seek' && !runner.waiting() && runner.q()?.cast?.[runner.beat().who] === n.id,
    // (a quiet job, once it's under way — the wizard aboard: the camp leaves the player be)
    questQuiet: () => started && !!runner.quest()?.quiet && !runner.waiting() && !!runner.q()?.failOnDown,
    cartLoad: () => cartLoad,
    cartInUse: () => started && !!runner.q()?.cast && Object.keys(runner.q().cast).length > 0,
    // (the sword / wand's camera auto-aim — townMode.js threats)
    questThreats: () => liveFoes().map((f) => f.e.group.position),
    // (text to speech for someone in a job who isn't a townsperson)
    questVoice: (who) => {
      for (const a of actors.values()) {
        if (a.name === who) return { key: a.name, kind: a.voice.kind ?? 'male', family: a.voice.family ?? null, at: { x: a.x, y: T.groundAt(a.x, a.z) + 1.4, z: a.z } };
      }
      return null;
    },
    quests: runner, // (dev console: town.debug().T.quests.jump('wizardSon'))
    questDebug: () => ({ foes, actors, cartLoad, started }),
  });
}

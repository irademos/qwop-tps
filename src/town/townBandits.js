// Town: the bandits — their camp (warning, standoff, fight or robbery), the nightly raid on the
// town (break-ins — the player's house too, now and then: its chest —, robberies, the fields; a
// raider who runs into the player fights an armed one, robs an unarmed one), the gang growing as
// the days go on, and the sheriff's thanks the morning after the player beats some of them (he
// comes over with a reward; some days he asks an armed player to stand watch — townMissions.js
// 'nightThanks' / 'nightWatch').

import { BANDIT_ROLES, ROLES, SHOUT_BANDIT, SHOUT_CAMP_COUNT, SHOUT_CAMP_DRAW_ARMED, SHOUT_CAMP_DRAW_UNARMED, SHOUT_CAMP_LAST, SHOUT_CAMP_ROB, SHOUT_CAMP_SPARE, SHOUT_CAMP_WARN, SHOUT_MUG, characterForRole, fillLine, firstName, randomName } from './townPeople.js';
import { GOODS, GOOD_IDS } from './townEconomy.js';
import {
  BANDIT_CAMP_R, BURGLE_CHEST_MAX, BURGLE_CHEST_SHARE, BURGLE_GOODS, BURGLE_MAX, BURGLE_S, BURGLE_SHARE,
  CAMP_ATTACK_DIST, CAMP_DEFENDERS, CAMP_GRACE_S, CAMP_REMIND_S, CAMP_ROB, CAMP_WARN_DIST, CROP_REGROW_S,
  GANG_GROW_EVERY_DAYS, GANG_MAX, NIGHT_KILL_REWARD, NIGHT_RAID_ACTS, NIGHT_RAID_HOURS, NIGHT_RAID_STAY,
  NIGHT_ROB, NIGHT_ROB_EVERY_S, RAID_NOTICE_DIST, RAID_PLAYER_HOUSE_CHANCE, RAID_TAKE, SHERIFF_SEEK_S,
  TALK_RANGE, dist2, inHours, pickOf, rand,
} from './townConfig.js';

// What raiders say running into the player in town at night (armed: a fight)
const SHOUT_RAID_FIGHT = ['Oi! Get out of our way!', 'Witness! Cut them down!', 'You picked the wrong night, hero.'];
const SHOUT_BURGLE_CAUGHT = ['Wrong house!', 'Leg it!', 'Nobody\'s supposed to be home!'];
const SHERIFF_GREET = {
  nightThanks: ['There you are, {name}! A word.', '{name}! Hold up — I\'ve been looking for you.'],
  nightWatch: ['{name}, a moment. I could use someone handy with a blade.', 'Got a minute, {name}? It\'s about the bandits.'],
};
// Raiders at their night's work (camp watch / auto-aim / the job's 📍 skip or look for them)
const RAIDING = new Set(['raid', 'burgle', 'prowl', 'mug']);

// T: the town's shared state + functions (createTownMode in townMode.js); ctx: the game
export function installTownBandits(T, ctx) {
  // The gang at home: someone near the camp is warned off, then warned again up close; staying
  // put after that, an armed one is fought (chased only off their ground — CAMP_CHASE_DIST),
  // an unarmed one robbed (once a visit)
  const campGang = () => {
    const P = T.layout.places;
    return T.npcs.filter((n) => n.alive && n.def.outlaw && !n.fighter && !n.inside && n.jailedUntil <= T.simT
      && !['raid', 'raidHome', 'mug', 'brawl', 'burgle', 'prowl'].includes(n.task?.type)
      && dist2(n.x, n.z, P.camp.x, P.camp.z) < CAMP_WARN_DIST);
  };
  const nearestOf = (list) => list.slice().sort((a, b) => T.distToPlayer(a) - T.distToPlayer(b))[0] ?? null;
  const standoffGang = () => T.npcs.filter((n) => n.alive && n.fighter && n.campStandoff);
  const sheatheAll = () => {
    for (const n of standoffGang()) { n.campStandoff = false; T.demote(n); }
  };
  // The standoff's over: everyone drawn fights, and the rest at the camp join in
  const campFightAll = () => {
    const P = T.layout.places;
    T.campWatch.closeT = 0;
    T.campChip.classList.add('hidden');
    const standing = standoffGang();
    for (const n of standing) {
      n.campStandoff = false;
      n.campFight = true;
      ctx.setFighterPassive(n.fighter, false);
    }
    const more = campGang().filter((n) => dist2(n.x, n.z, P.camp.x, P.camp.z) < CAMP_WARN_DIST)
      .sort((a, b) => T.distToPlayer(a) - T.distToPlayer(b)).slice(0, Math.max(1, CAMP_DEFENDERS + 1 - standing.length));
    for (const n of more) {
      T.say(n, pickOf(SHOUT_BANDIT), { big: true });
      n.campFight = true;
      T.promote(n);
    }
    T.feedLine('⚔️ The bandits attack!');
  };
  const updateCampWatch = () => {
    const P = T.layout.places;
    const p = T.playerPos();
    const d = dist2(p.x, p.z, P.camp.x, P.camp.z);
    const dt = Math.min(1, T.simT - (T.campWatch.tickAt || T.simT));
    T.campWatch.tickAt = T.simT;
    const hideChip = () => T.campChip.classList.add('hidden');
    if (d > CAMP_WARN_DIST + 6) {
      if (T.campWatch.drawn) sheatheAll();
      Object.assign(T.campWatch, { near: false, drawn: false, closeT: 0, remindAt: 0, robbed: false });
      hideChip();
      return;
    }
    if (T.sequence || T.jail || ctx.isPlayerDead() || T.npcs.some((n) => n.fighter && n.campFight)) { hideChip(); return; }
    const gang = campGang();
    const standing = standoffGang();
    if (!gang.length && !standing.length) { hideChip(); return; }
    // (the one who talks: a bandit not holding a sword — a fighter has no speech bubble)
    const lookout = nearestOf(gang);
    // (a bubble, and the feed: the warning mustn't be missed)
    const warn = (lines, vars = {}) => {
      const line = fillLine(pickOf(lines), vars);
      if (lookout) T.say(lookout, line, { big: true });
      T.feedLine(`💀 ${lookout ? firstName(lookout.name) : 'Bandits'}: “${line}”`);
    };
    const face = () => {
      for (const n of gang) if (n.task?.type === 'camp') { n.task.face = { x: p.x, z: p.z }; n.task.to = { x: n.x, z: n.z }; n.path = null; }
    };
    if (d > CAMP_WARN_DIST) { hideChip(); return; }
    face();
    if (!T.campWatch.near) {
      T.campWatch.near = true;
      warn(SHOUT_CAMP_WARN);
    }
    const armed = ctx.isPlayerArmed();
    // Robbed already and still unarmed: they've had what they wanted
    const threat = armed || !T.campWatch.robbed;
    if (d > CAMP_ATTACK_DIST || !threat) {
      // (backing off buys time back)
      T.campWatch.closeT = Math.max(0, T.campWatch.closeT - dt);
      if (T.campWatch.closeT > 0 && threat) showCampChip(armed);
      else hideChip();
      return;
    }
    // Up close: swords out (a standoff — no attacks yet) and what happens if they stay
    if (!T.campWatch.drawn) {
      T.campWatch.drawn = true;
      T.campWatch.remindAt = T.simT + CAMP_REMIND_S;
      const drawers = gang.filter((n) => n !== lookout).sort((a, b) => T.distToPlayer(a) - T.distToPlayer(b)).slice(0, CAMP_DEFENDERS);
      for (const n of drawers) T.promote(n, { standoff: true });
      warn(armed ? SHOUT_CAMP_DRAW_ARMED : SHOUT_CAMP_DRAW_UNARMED);
      if (drawers.length) T.feedLine('🗡️ The bandits draw their swords.');
    }
    T.campWatch.closeT += dt;
    const left = Math.max(0, Math.ceil(CAMP_GRACE_S - T.campWatch.closeT));
    showCampChip(armed);
    if (left > 0) {
      if (T.simT >= T.campWatch.remindAt) {
        T.campWatch.remindAt = T.simT + CAMP_REMIND_S;
        if (left <= CAMP_REMIND_S) warn(SHOUT_CAMP_LAST);
        else warn(SHOUT_CAMP_COUNT, { s: left });
      }
      return;
    }
    if (armed) {
      campFightAll();
    } else {
      T.campWatch.robbed = true;
      T.campWatch.closeT = 0;
      hideChip();
      const took = Math.min(CAMP_ROB, ctx.getCoins());
      if (took > 0) {
        ctx.addCoins(-took);
        T.npcMoney(lookout ?? standing[0], took);
        ctx.playSfx('coin');
        warn(SHOUT_CAMP_ROB);
        T.feedLine(`💰 The bandits took ${took} 🪙 off you.`);
      } else {
        warn(SHOUT_CAMP_SPARE);
      }
    }
  };
  // The countdown up top: what they'll do and how long the player has
  const showCampChip = (armed) => {
    const left = Math.max(0, Math.ceil(CAMP_GRACE_S - T.campWatch.closeT));
    T.campChip.textContent = armed
      ? `⚔️ Bandit camp — leave or they fight · ${left} s`
      : `💰 Bandit camp — leave or they rob you · ${left} s`;
    T.campChip.classList.remove('hidden');
  };
  // A bandit's day: loiter at the camp; on a raid night, the next thing on their list in town
  // (startRaidNight), back to the camp with whatever they got in between
  const raidHours = () => inHours(T.hour(), NIGHT_RAID_HOURS);
  const decideBandit = (n) => {
    const P = T.layout.places;
    if (n.loot && dist2(n.x, n.z, P.camp.x, P.camp.z) > BANDIT_CAMP_R) {
      T.setTask(n, { type: 'raidHome', to: T.randomNear(P.camp.x, P.camp.z, 3), dur: 2, run: true });
      return;
    }
    n.loot = 0;
    if ((n.raidsLeft ?? 0) > 0 && raidHours()) {
      n.raidsLeft -= 1;
      if (startNightRaid(n)) return;
    }
    if (!raidHours()) n.raidsLeft = 0;
    const near = Math.random() < 0.5 ? P.campFire : P.camp;
    T.setTask(n, { type: 'camp', to: T.randomNear(near.x, near.z, BANDIT_CAMP_R * 0.6), dur: rand(6, 16), face: P.campFire });
  };
  const startRaid = (n, field, jobId = null) => {
    T.setTask(n, { type: 'raid', to: T.randomNear(field.x, field.z, 1.5), dur: 5, run: true, field, jobId });
  };

  // ── Bandit raids ──
  // A raider at a field: takes what's ripe (stealing — if anyone sees, they're wanted)
  const raidField = (n, t) => {
    let took = 0;
    for (const c of t.field.crops) {
      if (took >= RAID_TAKE) break;
      if (!c.ripe) continue;
      c.ripe = false;
      c.growAt = T.simT + CROP_REGROW_S;
      c.mesh.visible = false;
      took += 1;
    }
    n.loot += took;
    if (took) noteRaid('fields');
    if (took && T.distToPlayer(n) < 30) T.say(n, 'Heh. Supper.');
    const owner = T.npcs.find((o) => o.alive && o.role === 'farmer' && o.work === t.field);
    if (took && owner) T.npcCrime(n, 'theft', owner);
  };
  // A raider back at the camp with the loot (a guarded field's raid got away)
  const onRaidHome = (n) => {
    for (const j of T.jobs) {
      if (j.status === 'active' && j.kind === 'guardField' && (j.data.raiders ?? []).includes(n.id) && !j.data.failed) {
        j.data.failed = true;
        T.feedLine('😞 The raiders got away with the harvest.');
      }
    }
  };
  // The camp's gang: fill it up (the first time, or an old save without bandits)
  const ensureGang = () => {
    const have = T.npcs.filter((n) => n.def.outlaw).length + T.arrivals.filter((a) => ROLES[a.role]?.outlaw).length;
    for (const role of BANDIT_ROLES.slice(have)) {
      const n = T.makeNpc({ id: T.nextId++, name: randomName(role, T.usedNames()), role, url: characterForRole(role) });
      T.npcs.push(n);
    }
  };
  // …and it grows as the days go on: newcomers turn up at the camp (updateArrivals)
  const gangTarget = () => Math.min(GANG_MAX, BANDIT_ROLES.length + Math.floor(Math.max(0, T.clock.day - 1) / GANG_GROW_EVERY_DAYS));
  const growGang = () => {
    const have = T.npcs.filter((n) => n.alive && n.def.outlaw).length + T.arrivals.filter((a) => ROLES[a.role]?.outlaw).length;
    const missing = gangTarget() - have;
    for (let k = 0; k < missing; k++) T.arrivals.push({ role: 'bandit', at: T.simT + rand(20, 90) });
    if (missing > 0 && T.gangNoteDay !== T.clock.day) {
      T.gangNoteDay = T.clock.day;
      T.feedLine('💀 Word is more cutthroats have joined the bandits out at the camp.');
    }
  };

  // ── The night raid ──
  // (the night an hour belongs to: the evening's day)
  const nightOf = () => (T.hour() >= 12 ? T.clock.day : T.clock.day - 1);
  const noteRaid = (kind) => { if (T.raidPlan?.tally) T.raidPlan.tally[kind] += 1; };
  // The gang sets off (the authority's): all but NIGHT_RAID_STAY (the chief first) into town,
  // NIGHT_RAID_ACTS things each; tonight's break-ins include a player's house now and then
  const startRaidNight = () => {
    T.raidNight = nightOf();
    const gang = T.npcs.filter((n) => n.alive && n.def.outlaw && T.mine(n) && !n.fighter && !n.campStandoff
      && n.jailedUntil <= T.simT && !n.following);
    const stay = gang.slice().sort((a, b) => (b.role === 'banditBoss') - (a.role === 'banditBoss'))
      .slice(0, Math.min(NIGHT_RAID_STAY, gang.length - 1));
    const raiders = gang.filter((n) => !stay.includes(n));
    const houses = Object.entries(T.houses).filter(([, h]) => h.b && Math.random() < RAID_PLAYER_HOUSE_CHANCE).map(([i]) => Number(i));
    T.raidPlan = { night: T.raidNight, houses, hit: new Set(), tally: { houses: 0, mugs: 0, fields: 0 }, reported: false };
    if (!raiders.length) return;
    for (const n of raiders) {
      n.raidsLeft = NIGHT_RAID_ACTS;
      if (!n.task || n.task.type === 'camp') T.decide(n);
    }
    const line = `🌙 ${raiders.length} bandits are heading into town! Lock your doors.`;
    T.feedLine(line);
    if (T.netMode === 'host') T.net.broadcast({ w: 1, op: 'raid', t: line });
  };
  const startNightRaid = (n) => {
    const P = T.layout.places;
    const plan = T.raidPlan;
    if (plan?.houses.length && startBurgle(n, plan.houses.shift())) return true;
    const r = Math.random();
    if (r < 0.45 && startBurgle(n, townHouse())) return true;
    if (r < 0.8 || !P.fields.length) {
      const C = P.center;
      T.setTask(n, { type: 'prowl', to: T.randomNear(C.x, C.z, 22), dur: rand(4, 10), run: true });
      return true;
    }
    startRaid(n, pickOf(P.fields));
    return true;
  };
  const residentsOf = (i) => T.npcs.filter((o) => o.alive && !o.def.outlaw && o.homeIndex === i);
  // A townsfolk house not broken into yet tonight (one with a room first)
  const townHouse = () => {
    const homes = T.layout.places.homes;
    const ok = homes.map((h, i) => i).filter((i) => !T.houses[i] && !T.raidPlan?.hit.has(i) && residentsOf(i).length);
    const roomed = ok.filter((i) => homes[i].room);
    return roomed.length ? pickOf(roomed) : ok.length ? pickOf(ok) : -1;
  };
  const startBurgle = (n, i) => {
    const home = T.layout.places.homes[i];
    if (!home) return false;
    T.raidPlan?.hit.add(i);
    const to = home.room ? T.rooms.somewhereIn(home.room) : T.randomNear(home.x, home.z, 0.8);
    T.setTask(n, { type: 'burgle', to, dur: rand(...BURGLE_S), run: true, home: i });
    return true;
  };
  // A burglar's done inside (townLife finishTask): the residents' money, the player's chest
  const burgle = (n, t) => {
    const home = T.layout.places.homes[t.home];
    if (!home) return;
    // (the player's in there: caught in the act — off they run)
    if (home.room && T.inRoom === home.room) {
      T.say(n, pickOf(SHOUT_BURGLE_CAUGHT), { big: true });
      n.raidsLeft = 0;
      return;
    }
    const victims = residentsOf(t.home);
    let coins = 0;
    for (const o of victims) {
      const took = Math.min(BURGLE_MAX, Math.floor(o.money * BURGLE_SHARE));
      if (took <= 0) continue;
      T.npcMoney(o, -took);
      coins += took;
    }
    const h = T.houses[t.home];
    if (h?.b) {
      if (h.k === T.homeKey()) coins += robChest();
      else if (T.netMode === 'host') T.net.broadcast({ w: 1, op: 'burgled', k: h.k });
    }
    if (coins > 0) T.npcMoney(n, coins);
    n.loot += 1;
    noteRaid('houses');
    if (victims.length) {
      const who = firstName(victims[0].name);
      T.gossip.push({ kind: 'burgled', who, at: T.simT, fresh: true });
      if (T.gossip.length > 12) T.gossip.shift();
      if (T.distToPlayer(n) < 40 || (T.inRoom && !T.rooms.roomAt(n.x, n.z))) T.feedLine(`🏚️ Bandits broke into ${who}'s house!`);
      T.npcCrime(n, 'theft', victims[0]);
    }
  };
  // The bandits in the player's house: some of the chest's coins and goods (→ the coins taken)
  const robChest = () => {
    const s = T.store;
    const coins = Math.min(BURGLE_CHEST_MAX, Math.ceil(s.coins * BURGLE_CHEST_SHARE));
    s.coins -= coins;
    const taken = {};
    for (let k = 0; k < BURGLE_GOODS; k++) {
      const have = GOOD_IDS.filter((g) => s.goods[g] > 0);
      if (!have.length) break;
      const g = pickOf(have);
      s.goods[g] -= 1;
      taken[g] = (taken[g] ?? 0) + 1;
    }
    const what = [coins ? `${coins} 🪙` : null, ...Object.entries(taken).map(([g, c]) => `${c} ${GOODS[g].emoji}`)].filter(Boolean).join(', ');
    if (what) {
      T.feedLine(`🏚️ Bandits broke into your house and took ${what} from your chest!`);
      ctx.showBanner('ROBBED!', `Bandits broke into your house · ${what}`, 3200);
    } else {
      T.feedLine('🏚️ Bandits broke into your house — but there was nothing in your chest to take.');
    }
    T.save();
    return coins;
  };
  // A raider who runs into the player (seen, close): an armed player is fought, an unarmed one
  // robbed. (Shared town: the host's game runs them — its own player only.)
  const watchForPlayer = () => {
    if (!T.isNight || T.inRoom || T.jail || T.sequence || ctx.isPlayerDead()) return;
    const armed = ctx.isPlayerArmed();
    for (const n of T.npcs) {
      if (!n.alive || !n.def.outlaw || n.fighter || n.inside || !n.body || !T.mine(n) || !RAIDING.has(n.task?.type)) continue;
      if (T.rooms.roomAt(n.x, n.z) || T.distToPlayer(n) > RAID_NOTICE_DIST || !T.sees(n)) continue;
      if (armed) {
        T.feedLine(`🗡️ ${firstName(n.name)}: “${pickOf(SHOUT_RAID_FIGHT)}”`);
        T.promote(n);
        continue;
      }
      if (T.simT - (T.nightRobAt ?? -1e9) < NIGHT_ROB_EVERY_S || ctx.getCoins() <= 0) continue;
      T.nightRobAt = T.simT;
      const took = Math.min(NIGHT_ROB, ctx.getCoins());
      ctx.addCoins(-took);
      T.npcMoney(n, took);
      ctx.playSfx('coin');
      n.loot += 1;
      T.say(n, pickOf(SHOUT_MUG), { big: true });
      T.feedLine(`💰 ${firstName(n.name)} robbed you of ${took} 🪙! (With a weapon out, they'd have to fight you for it.)`);
      const P = T.layout.places;
      T.setTask(n, { type: 'raidHome', to: T.randomNear(P.camp.x, P.camp.z, 3), dur: 2, run: true });
      return;
    }
  };
  // The raider nearest the player (the night watch's 📍)
  const nearestRaider = () => {
    let best = null;
    for (const n of T.npcs) {
      if (!n.alive || !n.def.outlaw || n.inside || T.rooms.roomAt(n.x, n.z) || !(n.fighter || RAIDING.has(n.task?.type))) continue;
      if (!best || T.distToPlayer(n) < T.distToPlayer(best)) best = n;
    }
    return best;
  };

  // ── The sheriff's thanks ──
  // The player beat a bandit at night: the sheriff will hear of it (onJobDeath)
  const noteNightKill = (n) => {
    T.nightKills.n += 1;
    T.nightKills.coins += NIGHT_KILL_REWARD * (n.role === 'banditBoss' ? 2 : 1);
    if (T.nightKillNote !== nightOf()) {
      T.nightKillNote = nightOf();
      T.feedLine('⭐ The sheriff will want a word with you in the morning.');
    }
    T.save();
  };
  const sheriffOf = () => T.npcs.find((n) => n.alive && n.role === 'sheriff' && !n.fighter && n.jailedUntil <= T.simT) ?? null;
  // Morning: the night's news, the sheriff's reward (a job ready to be paid — merged into one
  // already waiting), and him going over to the player about it
  const updateMorning = () => {
    if (T.isNight || T.hour() < 6) return;
    const plan = T.raidPlan;
    if (plan && !plan.reported && T.isHost()) {
      plan.reported = true;
      const { houses, mugs, fields } = plan.tally;
      const parts = [houses ? `broke into ${houses} house${houses > 1 ? 's' : ''}` : null, mugs ? `robbed ${mugs} ${mugs > 1 ? 'people' : 'person'}` : null,
        fields ? `raided the fields ${fields > 1 ? `${fields} times` : 'once'}` : null].filter(Boolean);
      if (parts.length) T.feedLine(`🌅 Last night the bandits ${parts.join(', ')}.`);
    }
    const sheriff = sheriffOf();
    if (!sheriff || !inHours(T.hour(), sheriff.def.hours)) return;
    if (T.nightKills.n > 0) {
      const { n: k, coins } = T.nightKills;
      T.nightKills = { n: 0, coins: 0 };
      const j = T.jobs.find((x) => x.giverId === sheriff.id && x.status === 'done' && (x.kind === 'nightThanks' || x.kind === 'nightWatch'));
      if (j) {
        j.data.beaten = (j.data.beaten ?? 0) + k;
        j.reward = { ...j.reward, coins: (j.reward.coins ?? 0) + coins };
        j.data.soughtFor = null;
      } else {
        T.jobs.push({
          id: T.nextJobId++, kind: 'nightThanks', status: 'done', giverId: sheriff.id,
          title: 'The sheriff\'s thanks', desc: '', data: { beaten: k },
          reward: { coins, attitude: 0.15, town: Math.min(0.1, 0.02 * k) },
        });
      }
      T.save();
    }
    seekPlayer(sheriff);
  };
  // The sheriff comes over: a reward waiting, or a night watch to ask about (once each)
  const seekPlayer = (sheriff) => {
    if (T.law.stars > 0 || T.inRoom || T.jail || ctx.isPlayerDead() || sheriff.inside || sheriff.guiding || sheriff.following) return;
    if (['seek', 'talk', 'respond', 'search', 'arrest', 'brawl', 'guide'].includes(sheriff.task?.type)) return;
    const j = T.jobs.find((x) => x.giverId === sheriff.id && x.data.soughtFor !== x.status
      && ((x.status === 'done' && (x.kind === 'nightThanks' || x.kind === 'nightWatch')) || (x.status === 'open' && x.kind === 'nightWatch')));
    if (!j || !T.take(sheriff)) return;
    j.data.soughtFor = j.status;
    T.clearTalk(sheriff);
    T.setTask(sheriff, { type: 'seek', dur: Infinity, jobId: j.id, until: T.simT + SHERIFF_SEEK_S, greet: j.kind });
  };
  // (townReactions updateSpecialTask) walking up to the player, then the talk box (the job's)
  const updateSeek = (n, t, dt) => {
    const j = T.jobs.find((x) => x.id === t.jobId);
    if (!j || !['open', 'done'].includes(j.status) || T.simT > t.until || T.law.stars > 0 || T.jail || ctx.isPlayerDead() || !n.def.law) {
      n.task = null;
      T.decide(n);
      return true;
    }
    const p = T.playerPos();
    // (the player's indoors: wait outside)
    if (T.inRoom) { n.moving = false; n.path = null; return true; }
    const d = T.distToPlayer(n);
    if (d > TALK_RANGE - 0.6) { T.chase(n, p.x, p.z, dt, d > 4); return true; }
    n.moving = false;
    n.path = null;
    T.faceToward(n, p.x, p.z, dt);
    if (!t.greeted) {
      t.greeted = true;
      T.say(n, fillLine(pickOf(SHERIFF_GREET[t.greet] ?? SHERIFF_GREET.nightThanks), { name: ctx.getPlayerName() }), { big: true });
    }
    if (n.body && !T.jobTalk.isOpen() && !T.sequence && !T.stalls.view?.()) {
      n.task = null;
      T.talkTo(n);
    }
    return true;
  };

  // ── Each tick (0.5 s) ──
  const updateNightRaid = () => {
    if (T.isHost()) {
      growGang();
      if (raidHours() && T.raidNight !== nightOf()) startRaidNight();
    }
    watchForPlayer();
    updateMorning();
  };
  // (shared town: the host's raid call, a player's house broken into)
  const handleBanditNet = (from, d) => {
    if (d.op !== 'raid' && d.op !== 'burgled') return false;
    if (from !== T.net.hostId() || T.netMode !== 'client') return true;
    if (d.op === 'raid' && typeof d.t === 'string') T.feedLine(d.t.slice(0, 120));
    if (d.op === 'burgled' && d.k === T.homeKey()) robChest();
    return true;
  };
  const restoreBandits = (state, own) => {
    T.raidNight = Number.isFinite(state?.raidNight) ? state.raidNight : null;
    T.raidPlan = null;
    const k = own?.nightKills;
    T.nightKills = { n: Math.max(0, Math.floor(k?.n || 0)), coins: Math.max(0, Math.floor(k?.coins || 0)) };
    T.nightRobAt = -1e9;
  };

  Object.assign(T, {
    burgle, campFightAll, decideBandit, ensureGang, handleBanditNet, nearestRaider, noteNightKill, noteRaid,
    onRaidHome, raidField, restoreBandits, standoffGang, startRaid, updateCampWatch, updateNightRaid, updateSeek,
  });
}

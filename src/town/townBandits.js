// Town: the bandits — their camp (warning, standoff, fight or robbery), their night decisions and
// raids on the fields, keeping the gang filled.

import { BANDIT_ROLES, ROLES, SHOUT_BANDIT, SHOUT_CAMP_COUNT, SHOUT_CAMP_DRAW_ARMED, SHOUT_CAMP_DRAW_UNARMED, SHOUT_CAMP_LAST, SHOUT_CAMP_ROB, SHOUT_CAMP_SPARE, SHOUT_CAMP_WARN, characterForRole, fillLine, firstName, randomName } from './townPeople.js';
import {
  BANDIT_CAMP_R, BANDIT_MUG_CHANCE, CAMP_ATTACK_DIST, CAMP_DEFENDERS, CAMP_GRACE_S, CAMP_REMIND_S,
  CAMP_ROB, CAMP_WARN_DIST, CROP_REGROW_S, RAID_CHANCE, RAID_TAKE, dist2, pickOf, rand,
} from './townConfig.js';

// T: the town's shared state + functions (createTownMode in townMode.js); ctx: the game
export function installTownBandits(T, ctx) {
  // The gang at home: someone near the camp is warned off, then warned again up close; staying
  // put after that, an armed one is fought (chased only off their ground — CAMP_CHASE_DIST),
  // an unarmed one robbed (once a visit)
  const campGang = () => {
    const P = T.layout.places;
    return T.npcs.filter((n) => n.alive && n.def.outlaw && !n.fighter && !n.inside && n.jailedUntil <= T.simT
      && !['raid', 'raidHome', 'mug', 'brawl'].includes(n.task?.type)
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
  // A bandit's day: loiter at the camp; at night raid a field or rob someone in town
  const decideBandit = (n, h) => {
    const P = T.layout.places;
    const night = h >= 21 || h < 4;
    if (night && !n.loot) {
      const r = Math.random();
      if (r < RAID_CHANCE && P.fields.length) { startRaid(n, pickOf(P.fields)); return; }
      if (r < RAID_CHANCE + BANDIT_MUG_CHANCE && T.startMugging(n)) return;
    }
    if (n.loot && dist2(n.x, n.z, P.camp.x, P.camp.z) > BANDIT_CAMP_R) {
      T.setTask(n, { type: 'raidHome', to: T.randomNear(P.camp.x, P.camp.z, 3), dur: 2, run: true });
      return;
    }
    n.loot = 0;
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

  Object.assign(T, {
    campFightAll, decideBandit, ensureGang, onRaidHome, raidField, standoffGang, startRaid,
    updateCampWatch,
  });
}

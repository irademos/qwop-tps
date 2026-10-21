// Town: fighting (a townsperson swapped for an EnemyPlayer), hurt / death, crime, witnesses and
// wanted stars, the guards; busted / knocked out, the jail cell (bail, bribe, lockpick, sleep).

import { FOLLOW_LINES, SHOUT_FIGHT, SHOUT_HELP, SHOUT_HURT, SHOUT_LAW, SHOUT_MURDER, SHOUT_THIEF, characterForRole, firstName, relationOf, shout } from './townPeople.js';
import * as THREE from 'three';
import {
  BAIL, BRIBE, BRIBE_ODDS, DEAD_BODY_S, ENGAGE_DIST, FINE_PER_STAR, FRIEND_ATTITUDE, HEAT_DECAY_S,
  JAIL_S, KO_COIN_SHARE, LAW_SIGHT, LOCK_SLIP_S, WAKE_HOUR, WITNESS_DIST, _v, dist2, heightScale,
} from './townConfig.js';

// T: the town's shared state + functions (createTownMode in townMode.js); ctx: the game
export function installTownLaw(T, ctx) {
  // ── Fighting (a townsperson swapped for an EnemyPlayer) ──
  // (standoff: sword drawn, facing the player, not attacking until ctx.setFighterPassive(e, false))
  const promote = (n, { standoff = false } = {}) => {
    if (n.fighter || !n.alive || !T.take(n)) return;
    T.releaseBody(n);
    n.inside = false;
    const e = ctx.spawnFighter({
      x: n.x, z: n.z, yaw: n.yaw, url: n.url, hearts: Math.max(1, n.hp),
      swingChance: n.def.law || n.def.outlaw ? 0.35 : 0.25,
      gear: T.fighterGear(n), name: `${n.def.emoji} ${n.name}`, passive: standoff,
    });
    if (!e) return;
    n.fighter = e;
    n.campStandoff = standoff;
    n.hostile = true;
    n.task = { type: 'fight', t: 0, phase: 'do' };
    n.fightSince = T.simT;
    const baseDamage = e.applyDamage.bind(e);
    e.applyDamage = (amount) => {
      const killed = baseDamage(amount);
      onFighterHurt(n, killed);
      return killed;
    };
  };
  const demote = (n, next = null) => {
    const e = n.fighter;
    if (!e) return;
    n.fighter = null;
    n.hostile = false;
    n.x = e.group.position.x;
    n.z = e.group.position.z;
    n.yaw = e.group.rotation.y;
    n.hp = Math.max(1, e.hearts ?? n.hp);
    ctx.removeFighter(e);
    n.vendetta = false; // (they've had their go)
    if (next) next();
    else T.decide(n);
  };
  const onFighterHurt = (n, killed) => {
    n.lastHurtAt = T.simT;
    // (a bandit hit in the standoff: the whole gang fights)
    if (n.campStandoff) T.campFightAll();
    // (a follower's blow is theirs, not the player's — they only take on outlaws and townsfolk
    // already fighting the player)
    // (another player's blow — shared town — isn't ours either)
    const by = n.remoteBy ?? null;
    const byPlayer = !n.followerHit && !by;
    n.followerHit = false;
    n.remoteBy = null;
    if (byPlayer) n.attitude = Math.max(-1, n.attitude - 0.3);
    if (byPlayer && !killed && !T.isOutlaw(n)) T.remember(n, 'hurt');
    if (killed) {
      n.hp = 0;
      ctx.releaseFighterGear(n.fighter);
      die(n, { byPlayer, bodyless: true, by, noCoins: !!by });
      if (byPlayer && !T.isOutlaw(n)) crime('murder', n);
    } else if (byPlayer && n.def.law && T.law.stars < 2) {
      crime('assault', n);
    }
  };

  // ── Hurt / death ──
  const hurt = (n, dir, amount = 1) => {
    n.lastHitAt = T.simT;
    // (someone another game runs: the hit goes there — the crime is still ours)
    if (!T.take(n)) { T.hurtRemote(n, dir, amount); return; }
    // (a claim the host hasn't agreed to yet: if it says no, this hit goes to whoever runs them)
    if (T.netMode === 'client' && !n.claimOk) {
      n.pendingHit = { amt: (n.pendingHit?.amt ?? 0) + amount, dir: [T.r2(dir.x), T.r2(dir.z)] };
    }
    // Kids can't be hurt: they just run off
    if (n.def.unhurt) {
      n.attitude = Math.max(-1, n.attitude - 0.3);
      T.say(n, shout(SHOUT_HURT));
      flee(n);
      return;
    }
    n.lastHurtAt = T.simT;
    n.hp -= amount;
    n.attitude = Math.max(-1, n.attitude - 0.6);
    const outlaw = T.isOutlaw(n);
    if (!outlaw) T.remember(n, 'hurt');
    const gy = T.groundY(n);
    ctx.spawnBlood(_v.set(n.x, gy + 0.55 * heightScale(n.url), n.z), gy);
    ctx.playSfx('hit');
    // a shove
    n.knock = { vx: dir.x * 3, vz: dir.z * 3, left: 0.25 };
    if (n.hp <= 0) {
      die(n, { byPlayer: true });
      if (outlaw) T.heroic(n);
      else crime('murder', n);
      return;
    }
    T.clearTalk(n);
    // Hitting an outlaw (a bandit, a mugger) is no crime — the town's grateful
    if (outlaw) T.heroic(n);
    else crime('assault', n);
    if (n.def.law || Math.random() < n.def.brave) {
      T.say(n, shout(n.def.law ? SHOUT_LAW : SHOUT_FIGHT));
      T.endBrawl(n);
      promote(n);
    } else {
      T.say(n, shout(SHOUT_HURT));
      flee(n);
    }
    if (!outlaw) T.rally(n);
  };
  // (by: the player who did it in a shared town — their game drops the coins: noCoins)
  const die = (n, { byPlayer = false, bodyless = false, by = null, noCoins = false } = {}) => {
    if (!n.alive) return;
    n.alive = false;
    n.moving = false;
    T.clearTalk(n);
    if (!bodyless && n.body) {
      T.clearBubble(n);
      n.body.character.playDeath();
      n.dying = { until: T.simT + DEAD_BODY_S };
    }
    const at = new THREE.Vector3(n.x, T.groundY(n) + 0.3, n.z);
    if (n.money >= 1 && !noCoins) ctx.dropCoins(at, Math.min(3, 1 + Math.floor(n.money / 8)));
    T.endBrawl(n);
    const killer = byPlayer ? T.myId() : by;
    if (T.netMode === 'client') T.net.send(T.net.hostId(), { w: 1, op: 'died', id: n.id, by: killer });
    else T.worldDeath(n, killer);
    if (n.def.outlaw) {
      // A bandit: the gang finds a new one in a while; no grief in town
      T.feedLine(`💀 ${n.name} is down.`);
      T.onJobDeath(n, byPlayer);
      T.save();
      return;
    }
    T.gossip.push({ kind: 'murder', who: firstName(n.name), by: byPlayer ? 'player' : null, at: T.simT, fresh: true });
    T.feedLine(`💀 ${n.name} the ${n.def.label} is dead.`);
    // Their family won't forget who did it
    if (byPlayer && !T.isOutlaw(n)) {
      for (const k of T.family(n)) {
        k.attitude = -1;
        T.remember(k, 'killedKin', { who: firstName(n.name), rel: relationOf(n.role) });
        if (!k.def.unhurt) { k.vendetta = true; k.vendettaFor = relationOf(n.role); }
      }
    }
    T.onJobDeath(n, byPlayer);
    // Everyone near runs
    for (const o of T.npcs) {
      if (o !== n && o.alive && !o.fighter && !o.def.law && dist2(o.x, o.z, n.x, n.z) < 14) flee(o);
    }
    T.save();
  };
  // (from: what they run from — the player by default)
  const flee = (n, from = null) => {
    if (!n.alive || n.fighter || n.jailedUntil > T.simT || !T.take(n)) return;
    n.fear = 12;
    T.clearTalk(n);
    T.endBrawl(n);
    if (n.following) n.following = false;
    const p = from ?? T.playerPos();
    // Home if it's away from the player, otherwise straight away from them
    const homeAway = dist2(n.home.x, n.home.z, p.x, p.z) > dist2(n.x, n.z, p.x, p.z) + 4;
    let to = n.home;
    if (!homeAway) {
      const ax = n.x - p.x;
      const az = n.z - p.z;
      const d = Math.hypot(ax, az) || 1;
      const tx = n.x + (ax / d) * 18;
      const tz = n.z + (az / d) * 18;
      const i = T.layout.nav.nearestWalkable(tx, tz);
      to = i >= 0 ? { x: T.layout.nav.cellX(i), z: T.layout.nav.cellZ(i) } : n.home;
    }
    T.setTask(n, { type: 'flee', to, dur: 0, run: true, hide: to === n.home });
  };

  // ── Crime and the law ──
  const lawNpcs = () => T.npcs.filter((n) => n.alive && n.def.law);
  // kind: 'assault' | 'murder' | 'theft' (victim: the owner, or null)
  const crime = (kind, victim) => {
    const p = T.playerPos();
    const witnesses = T.npcs.filter((n) => n.alive && !n.inside
      && (n === victim || n.attitude < FRIEND_ATTITUDE)
      && dist2(n.x, n.z, p.x, p.z) < WITNESS_DIST
      && ((n === victim && kind !== 'theft') || T.sees(n)));
    T.gossip.push({ kind, who: victim ? firstName(victim.name) : '', by: 'player', at: T.simT, fresh: true });
    if (T.gossip.length > 12) T.gossip.shift();
    if (!witnesses.length) {
      if (kind === 'murder') T.feedLine('🤫 Nobody saw that.');
      return;
    }
    const before = T.law.stars;
    if (kind === 'murder') T.law.stars = Math.min(3, Math.max(T.law.stars + 1, 2));
    else if (victim?.def.law) T.law.stars = Math.max(T.law.stars, 2);
    else T.law.stars = Math.max(T.law.stars, 1);
    T.law.peak = Math.max(T.law.peak, T.law.stars);
    T.law.lastSeenAt = T.simT;
    T.law.lastKnown.copy(p);
    for (const w of witnesses) {
      w.attitude = Math.max(-1, w.attitude - (kind === 'murder' ? 0.6 : kind === 'theft' ? 0.2 : 0.3));
      // (what they saw — townMemory.js; the victim of an assault remembers it from hurt)
      if (kind === 'murder' && w !== victim) T.remember(w, 'sawMurder', { who: victim ? firstName(victim.name) : 'them' });
      else if (kind === 'theft' && w === victim) T.remember(w, 'stole');
      if (w === victim || w.fighter || w.def.law) continue;
      if (kind === 'theft') { T.say(w, shout(SHOUT_THIEF)); continue; }
      flee(w);
      if (Math.random() < 0.6) T.say(w, kind === 'murder' ? shout(SHOUT_MURDER) : shout(SHOUT_HELP));
    }
    if (kind === 'theft' && victim?.alive && witnesses.includes(victim)) T.say(victim, 'Oi! Those are mine!');
    if (T.law.stars > before) {
      const w = witnesses.find((x) => x !== victim) ?? witnesses[0];
      T.feedLine(`🚨 ${firstName(w.name)} saw that! ${'★'.repeat(T.law.stars)}`);
    }
    T.renderStars();
  };
  const respond = (n) => {
    if (!T.take(n)) return;
    const target = { x: T.law.lastKnown.x, z: T.law.lastKnown.z };
    T.setTask(n, { type: 'respond', to: target, dur: 0, run: true });
    n.task.target = target;
    n.task.plannedAt = T.simT;
  };
  const standDown = () => {
    T.law.stars = 0;
    T.law.peak = 0;
    for (const n of T.npcs) {
      if (!n.alive || !n.def.law) continue;
      if (n.fighter) demote(n);
      else if (n.task?.type === 'respond' || n.task?.type === 'search') T.decide(n);
    }
    T.renderStars();
  };
  const updateLaw = () => {
    if (T.law.stars <= 0 || T.sequence) { T.law.seen = false; return; }
    const p = T.playerPos();
    // (in a shared town: those not already busy with another player)
    const officers = lawNpcs().filter((n) => T.mine(n) || (T.netMode === 'client' && !n.ctrl));
    // Who answers: the nearest guard at ★, the guards at ★★, everyone at ★★★
    officers.sort((a, b) => (a.role === 'sheriff') - (b.role === 'sheriff') || T.distToPlayer(a) - T.distToPlayer(b));
    const count = T.law.stars >= 3 ? officers.length : T.law.stars >= 2 ? Math.max(1, officers.filter((o) => o.role !== 'sheriff').length) : 1;
    const responders = officers.slice(0, count);
    let seen = false;
    for (const n of responders) {
      if (!T.take(n)) continue;
      if (n.inside) { n.inside = false; n.x = n.home.x; n.z = n.home.z; }
      const d = T.distToPlayer(n);
      const sight = d < LAW_SIGHT && T.sees(n);
      if (sight) seen = true;
      if (n.fighter) continue;
      if (sight && d < ENGAGE_DIST && !ctx.isPlayerDead()) {
        promote(n);
        continue;
      }
      // Run to where the player was last seen (again when that's moved on)
      const t = n.task;
      const chasing = t?.type === 'respond' || t?.type === 'search';
      const moved = chasing && dist2(t.target.x, t.target.z, T.law.lastKnown.x, T.law.lastKnown.z) > 2.5;
      if (!chasing || (moved && T.simT - t.plannedAt > 1.5)) {
        if (!chasing && Math.random() < 0.5) T.say(n, shout(SHOUT_LAW));
        respond(n);
      }
    }
    // Fighters see what's in front of them
    if (officers.some((n) => n.fighter && T.distToPlayer(n) < LAW_SIGHT)) seen = true;
    T.law.seen = seen;
    if (seen) {
      T.law.lastSeenAt = T.simT;
      T.law.lastKnown.copy(p);
    } else if (T.simT - T.law.lastSeenAt > HEAT_DECAY_S) {
      T.law.stars -= 1;
      T.law.lastSeenAt = T.simT;
      if (T.law.stars <= 0) {
        T.feedLine('😮‍💨 The guards gave up looking for you.');
        standDown();
      } else {
        T.feedLine(`👀 Lost them… ${'★'.repeat(T.law.stars)}`);
      }
    }
    T.renderStars();
  };

  // ── Busted / knocked out ──
  const fadeTo = (on) => T.fade.classList.toggle('town-fade-on', on);
  const later = (token, ms, fn) => setTimeout(() => { if (T.sequence === token && T.active) fn(); }, ms);
  const removeAllFighters = () => { for (const n of T.npcs) if (n.fighter) demote(n); };
  const busted = ({ surrendered = false } = {}) => {
    if (T.sequence) return;
    const token = {};
    T.sequence = token;
    const peak = Math.max(1, T.law.peak);
    const fine = Math.min(ctx.getCoins(), FINE_PER_STAR * peak);
    removeAllFighters();
    standDown();
    T.clearAllTalk();
    T.closeMarket();
    T.fishing = null;
    T.stopFishingRig();
    T.lockpick.stop();
    T.jobTalk.close();
    for (const f of T.followers()) T.dismiss(f, FOLLOW_LINES.wanted);
    ctx.showBanner('BUSTED!', surrendered ? 'You came quietly.' : 'The guards got you.', 2400);
    T.gossip.push({ kind: 'arrest', who: '', by: 'player', at: T.simT, fresh: true });
    // Two guards carry the player off (the Showdown death carry), then the cell
    later(token, 900, () => ctx.carryPlayerOff({
      carrierUrl: characterForRole('guard'),
      onDone: () => { if (T.sequence === token && T.active) toCell(); },
    }));
    const toCell = () => {
      fadeTo(true);
      later(token, 700, () => {
        const P = T.layout.places;
        ctx.revivePlayer(P.jail.x, P.jail.z, P.jailYaw + Math.PI);
        if (fine > 0) ctx.addCoins(-fine);
        T.feedLine(fine > 0 ? `⚖️ Fined ${fine} 🪙` : '⚖️ Locked up.');
        if (Object.values(ctx.getItems() ?? {}).some(Boolean)) {
          ctx.confiscate();
          T.feedLine('🗡️ The guards took your weapons.');
        }
        if (!T.mp()) T.advanceClock(3 * 60); // (a shared town's clock is everyone's)
        startJail();
        fadeTo(false);
        T.sequence = null;
      });
    };
  };
  const knockedOut = () => {
    if (T.sequence) return;
    const token = {};
    T.sequence = token;
    removeAllFighters();
    T.clearAllTalk();
    T.closeMarket();
    T.fishing = null;
    T.stopFishingRig();
    const lost = Math.floor(ctx.getCoins() * KO_COIN_SHARE);
    ctx.showBanner('KNOCKED OUT', 'You wake up by the fire…', 2400);
    later(token, 1800, () => {
      fadeTo(true);
      later(token, 700, () => {
        const P = T.layout.places;
        ctx.revivePlayer(P.spawn.x, P.spawn.z, Math.atan2(P.fire.x - P.spawn.x, P.fire.z - P.spawn.z));
        if (lost > 0) { ctx.addCoins(-lost); T.feedLine(`🪙 Someone helped themselves to ${lost} coins…`); }
        if (!T.mp()) T.advanceClock(2 * 60);
        fadeTo(false);
        T.sequence = null;
      });
    });
  };
  const startJail = () => {
    const P = T.layout.places;
    T.jail = { left: JAIL_S };
    T.layout.props.door.rotation.y = 0;
    const sheriff = T.npcs.find((n) => n.alive && n.role === 'sheriff');
    if (sheriff) T.remember(sheriff, 'jailed');
    ctx.setPositionConstraint((controls) => {
      const dx = controls.playerX - P.jail.x;
      const dz = controls.playerZ - P.jail.z;
      const d = Math.hypot(dx, dz);
      const max = 0.75;
      if (d > max) {
        controls.playerX = P.jail.x + (dx / d) * max;
        controls.playerZ = P.jail.z + (dz / d) * max;
      }
    });
    renderJail();
  };
  const endJail = (text) => {
    if (!T.jail) return;
    T.jail = null;
    ctx.setPositionConstraint(null);
    T.jailChip.classList.add('hidden');
    T.feedLine(text);
  };
  const payBail = () => {
    if (!T.jail) return;
    if (ctx.getCoins() < BAIL) { T.feedLine(`🪙 Bail is ${BAIL} coins.`); return; }
    ctx.addCoins(-BAIL);
    ctx.playSfx('coin');
    endJail('🔓 Bail paid. Behave yourself.');
  };
  // A bribe works if an officer near the cell doesn't mind the player (or by luck)
  const bribe = () => {
    if (!T.jail) return;
    if (ctx.getCoins() < BRIBE) { T.feedLine(`🪙 A bribe takes ${BRIBE} coins.`); return; }
    ctx.addCoins(-BRIBE);
    const P = T.layout.places;
    const officer = lawNpcs().filter((o) => !o.inside && dist2(o.x, o.z, P.jail.x, P.jail.z) < 30)
      .sort((a, b) => b.attitude - a.attitude)[0];
    const ok = (officer && officer.attitude >= -0.2) || Math.random() < BRIBE_ODDS;
    if (ok) {
      if (officer) T.npcMoney(officer, BRIBE);
      endJail(`🤝 ${officer ? firstName(officer.name) : 'The guard'} looks the other way. You\'re out.`);
    } else {
      T.jail.left += 15;
      T.feedLine('😠 The guard pockets the coins and laughs. +15 s');
    }
  };
  // Sleep it off: out in the morning (the clock jumps)
  const sleepItOff = () => {
    if (!T.jail || T.sequence) return;
    const token = {};
    T.sequence = token;
    fadeTo(true);
    later(token, 800, () => {
      const h = T.hour();
      if (!T.mp()) T.advanceClock(((WAKE_HOUR - h + 24) % 24 || 24) * 60);
      endJail('☀️ Morning. The guard lets you out.');
      fadeTo(false);
      T.sequence = null;
    });
  };
  // Pick the lock (townLockpick.js): out, but the guards come running
  const startLockpick = () => {
    if (!T.jail || T.lockpick.isOpen()) return;
    T.lockpick.start((success) => {
      if (!T.jail) return;
      if (success) {
        endJail('🔓 Click. The door swings open…');
        T.law.stars = Math.max(T.law.stars, 1);
        T.law.peak = Math.max(T.law.peak, T.law.stars);
        T.law.lastSeenAt = T.simT;
        T.law.lastKnown.copy(T.playerPos());
        T.feedLine('🚨 Jailbreak! The guards are after you.');
        T.renderStars();
      } else {
        T.jail.left += LOCK_SLIP_S;
        T.feedLine(`🔧 The pick slipped — a guard heard. +${LOCK_SLIP_S} s`);
      }
    });
  };
  const renderJail = () => {
    if (!T.jail) return;
    T.jailChip.classList.remove('hidden');
    T.jailChip.textContent = `🔒 In jail · ${Math.ceil(T.jail.left)} s`;
  };

  Object.assign(T, {
    bribe, busted, crime, demote, die, endJail, fadeTo, flee, hurt, knockedOut, lawNpcs, payBail,
    promote, renderJail, respond, sleepItOff, startLockpick, updateLaw,
  });
}

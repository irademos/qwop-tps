// Town: how townsfolk react — outlaws, family, rallying to help, grudges / vendettas, brawls and
// muggings between townsfolk, followers (🤝 Join me) and the special tasks they all run.

import { FOLLOW_LINES, SHOUT_ARREST, SHOUT_MUG, SHOUT_RALLY, SHOUT_STAY_BACK, SHOUT_THANKS, SHOUT_THIEF, SHOUT_VENDETTA, fillLine, firstName, shout } from './townPeople.js';
import * as THREE from 'three';
import { glbCharacterConfig } from '../models/glbCharacterModel.js';
import { raycastMapSegment } from '../environment/mapCollision.js';
import {
  AVOID_DIST, BRAWL_HIT_S, BRAWL_REACH, FOLLOW_ATTITUDE, FOLLOW_GAP, FOLLOW_HELP_DIST,
  FOLLOW_HIT_S, FRIEND_ATTITUDE, GRUDGE_ATTITUDE, LAW_SIGHT, MAX_FOLLOWERS, NPC_JAIL_S, OUTLAW_S,
  RALLY_DIST, RALLY_MAX, RUN_SPEED, VENDETTA_SIGHT, WALK_SPEED, WITNESS_DIST, _v, _v2, dist2,
  heightScale, pickOf, rand,
} from './townConfig.js';

// T: the town's shared state + functions (createTownMode in townMode.js); ctx: the game
export function installTownReactions(T, ctx) {
  // ── Reactions ──
  const isOutlaw = (n) => !!n.def.outlaw || n.outlawUntil > T.simT;
  // Same house = family (bandits have none)
  const family = (n) => (n.homeIndex < 0 ? [] : T.npcs.filter((o) => o !== n && o.alive && o.homeIndex === n.homeIndex));
  const followers = () => T.npcs.filter((n) => n.alive && n.following);
  // Guards carry a shield; the sheriff a gun too once it's ★★★; bandits' gear is their role's
  const fighterGear = (n) => {
    if (n.def.gear) return n.def.gear;
    if (n.role === 'sheriff') return T.law.stars >= 3 ? { gun: true, shield: true } : { shield: true };
    if (n.def.law) return { shield: true };
    return null;
  };
  // Line of sight from a townsperson's eyes to a point (the player: sees)
  const seesPoint = (n, x, y, z) => {
    _v.set(n.x, T.groundY(n) + 0.8, n.z);
    _v2.set(x, y + 0.8, z);
    return !raycastMapSegment(_v, _v2);
  };
  // The player hurt an outlaw: those who see it think better of them
  const heroic = (victim) => {
    const p = T.playerPos();
    for (const w of T.npcs) {
      if (!w.alive || w === victim || w.def.outlaw || dist2(w.x, w.z, p.x, p.z) > WITNESS_DIST) continue;
      w.attitude = Math.min(1, w.attitude + 0.12);
      if (victim.mugVictim === w) {
        T.remember(w, 'saved', { who: firstName(victim.name) });
        if (Math.random() < 0.7) T.say(w, fillLine(pickOf(SHOUT_THANKS), { name: ctx.getPlayerName() }));
      }
    }
  };
  // A townsperson the player hurt: their family and the brave nearby step in
  const rally = (victim) => {
    const kin = new Set(family(victim));
    let n = 0;
    for (const o of T.npcs) {
      if (n >= RALLY_MAX) break;
      if (o === victim || !o.alive || o.fighter || o.inside || o.def.law || o.def.outlaw || o.def.unhurt
        || o.following || o.jailedUntil > T.simT || o.attitude >= FRIEND_ATTITUDE) continue;
      const isKin = kin.has(o);
      if (T.distToPlayer(o) > (isKin ? RALLY_DIST * 1.6 : RALLY_DIST)) continue;
      if (!isKin && o.def.brave < 0.5) continue;
      T.say(o, fillLine(pickOf(SHOUT_RALLY), { who: firstName(victim.name) }));
      endBrawl(o);
      T.promote(o);
      n += 1;
    }
  };
  // Grudges: a vendetta attacks on sight; a deep grudge steps aside
  const reactToPlayer = (n) => {
    if (n.fighter || n.inside || n.jailedUntil > T.simT || T.sequence || ctx.isPlayerDead()) return;
    const d = T.distToPlayer(n);
    if (n.vendetta && d < VENDETTA_SIGHT && T.sees(n)) {
      T.say(n, fillLine(pickOf(SHOUT_VENDETTA), { rel: n.vendettaFor || 'friend' }));
      endBrawl(n);
      T.promote(n);
      return;
    }
    if (n.attitude < GRUDGE_ATTITUDE && d < AVOID_DIST && T.simT > n.avoidAt && !n.def.law
      && !['flee', 'sleep', 'brawl', 'arrest', 'mug', 'raid'].includes(n.task?.type)) {
      n.avoidAt = T.simT + 20;
      T.say(n, pickOf(SHOUT_STAY_BACK));
      T.flee(n);
      n.fear = 4;
    }
  };

  // ── Townsfolk fighting each other (light bodies: blows on a timer, no EnemyPlayers) ──
  // mode: 'mug' (the attacker takes the purse and goes), 'arrest' (a guard, until the other
  // gives up), 'fight'
  const startBrawl = (a, b, mode) => {
    if (!a.alive || !b.alive || a.fighter || b.fighter || !T.mine(a) || !T.mine(b)) return;
    a.task = { type: 'brawl', t: 0, phase: 'do', foe: b, mode, attacker: true };
    b.task = { type: 'brawl', t: 0, phase: 'do', foe: a, mode, attacker: false };
    a.path = null;
    b.path = null;
    a.nextBlowAt = T.simT + 0.4;
    b.nextBlowAt = T.simT + rand(...BRAWL_HIT_S);
    if (mode === 'mug') { T.say(a, pickOf(SHOUT_MUG)); b.mugVictim = null; a.mugVictim = b; }
    if (mode === 'arrest') T.say(a, pickOf(SHOUT_ARREST));
  };
  const endBrawl = (n) => {
    const t = n.task;
    if (t?.type !== 'brawl') return;
    n.task = null;
    const o = t.foe;
    if (o?.task?.type === 'brawl' && o.task.foe === n) o.task = null;
  };
  // One townsperson's blow on another
  const npcHit = (victim, attacker, amount = 1) => {
    if (!victim.alive || !T.mine(victim)) return;
    if (victim.def.unhurt) { T.flee(victim, attacker); return; }
    victim.hp -= amount;
    victim.lastHurtAt = T.simT;
    if (victim.body && T.distToPlayer(victim) < 25) {
      const gy = T.groundY(victim);
      ctx.spawnBlood(_v.set(victim.x, gy + 0.55 * heightScale(victim.url), victim.z), gy);
      if (T.distToPlayer(victim) < 12) ctx.playSfx('hit');
    }
    const dx = victim.x - attacker.x;
    const dz = victim.z - attacker.z;
    const d = Math.hypot(dx, dz) || 1;
    victim.knock = { vx: (dx / d) * 2.5, vz: (dz / d) * 2.5, left: 0.2 };
    if (victim.hp <= 0) {
      T.die(victim, { byPlayer: false });
      if (!victim.def.outlaw) npcCrime(attacker, 'murder', victim);
    }
  };
  // A townsperson (or bandit) seen attacking / robbing someone is wanted: a guard comes for them
  const npcCrime = (culprit, kind, victim) => {
    const seen = T.npcs.some((w) => w.alive && !w.inside && w !== culprit && !w.def.outlaw
      && dist2(w.x, w.z, culprit.x, culprit.z) < WITNESS_DIST
      && (w === victim || seesPoint(w, culprit.x, T.groundY(culprit), culprit.z)));
    if (!seen) return;
    culprit.outlawUntil = T.simT + OUTLAW_S;
    T.gossip.push({ kind: kind === 'murder' ? 'murder' : 'assault', who: firstName(victim.name), by: firstName(culprit.name), at: T.simT, fresh: true });
    if (T.distToPlayer(culprit) < 35) T.feedLine(`🚨 ${firstName(culprit.name)} ${kind === 'mug' ? 'robbed' : kind === 'theft' ? 'stole from' : 'attacked'} ${firstName(victim.name)}!`);
    sendGuard(culprit);
  };
  // The nearest free guard goes to arrest an outlaw townsperson
  const sendGuard = (culprit) => {
    if (T.law.stars > 0 && T.distToPlayer(culprit) < LAW_SIGHT) return; // (busy with the player)
    const guard = T.lawNpcs().filter((g) => T.mine(g) && !g.fighter && !g.inside && g.jailedUntil <= T.simT
      && !['respond', 'search', 'arrest', 'brawl'].includes(g.task?.type))
      .sort((a, b) => dist2(a.x, a.z, culprit.x, culprit.z) - dist2(b.x, b.z, culprit.x, culprit.z))[0];
    if (!guard) return;
    guard.task = { type: 'arrest', t: 0, phase: 'go', target: culprit, run: true };
    guard.path = null;
  };
  // An outlaw in the cell for a while
  const jailNpc = (n, by) => {
    endBrawl(n);
    n.outlawUntil = 0;
    n.jailedUntil = T.simT + NPC_JAIL_S;
    n.hp = Math.max(n.hp, 1);
    const P = T.layout.places;
    n.x = P.jail.x + rand(-0.4, 0.4);
    n.z = P.jail.z + rand(-0.4, 0.4);
    n.path = null;
    T.setTask(n, { type: 'jailed', dur: Infinity });
    if (T.distToPlayer(n) < 35 || T.distToPlayer(by) < 35) T.feedLine(`👮 ${firstName(by.name)} locked up ${firstName(n.name)}.`);
    T.gossip.push({ kind: 'jailed', who: firstName(n.name), by: firstName(by.name), at: T.simT, fresh: true });
  };
  // A drifter (or bandit) picks someone out on their own
  const startMugging = (n) => {
    const victim = T.npcs.filter((o) => o !== n && o.alive && T.mine(o) && !o.fighter && !o.inside && !o.def.law && !o.def.outlaw
      && !o.def.unhurt && !o.following && o.jailedUntil <= T.simT && o.money >= 2
      && dist2(o.x, o.z, n.x, n.z) < 28)
      .sort((a, b) => dist2(a.x, a.z, n.x, n.z) - dist2(b.x, b.z, n.x, n.z))[0];
    if (!victim) return false;
    n.task = { type: 'mug', t: 0, phase: 'go', target: victim, mugging: true };
    n.path = null;
    return true;
  };
  // Followers: friends who come along
  const canRecruit = (n) => n.alive && !n.following && n.attitude >= FOLLOW_ATTITUDE && !n.def.law && !n.def.outlaw
    && !n.def.unhurt && n.role !== 'merchant' && followers().length < MAX_FOLLOWERS && T.law.stars < 2;
  // (quiet: the line is returned for the talk box instead of said over their head)
  const recruit = (n, { quiet = false } = {}) => {
    if (!canRecruit(n) || !T.take(n)) return null;
    n.following = true;
    T.clearTalk(n);
    T.setTask(n, { type: 'follow', dur: Infinity });
    const said = fillLine(pickOf(FOLLOW_LINES.join), { name: ctx.getPlayerName() });
    if (!quiet) T.say(n, said, { big: true });
    T.feedLine(`🤝 ${firstName(n.name)} is coming with you.`);
    return said;
  };
  const dismiss = (n, line = FOLLOW_LINES.leave, { quiet = false } = {}) => {
    if (!n.following) return null;
    n.following = false;
    T.clearTalk(n);
    const said = fillLine(pickOf(line), { name: ctx.getPlayerName() });
    if (!quiet) T.say(n, said);
    T.decide(n);
    return said;
  };
  // Walk toward a moving spot (re-planned now and then)
  const chase = (n, x, z, dt, run) => {
    if (!n.path || n.pathI >= n.path.length || T.simT > (n.replanAt ?? 0)) {
      T.planPath(n, x, z);
      n.replanAt = T.simT + 1.2;
    }
    T.stepPath(n, dt, (run ? RUN_SPEED : WALK_SPEED) * n.speedScale);
  };
  // A swing (the throw clip) toward something
  const swingAt = (n, x, z) => {
    n.yaw = Math.atan2(x - n.x, z - n.z);
    if (n.body) n.body.character.playAction(glbCharacterConfig.throwClip);
  };
  // Tasks with their own per-frame logic; true when handled
  const updateSpecialTask = (n, t, dt) => {
    const P = T.layout.places;
    switch (t.type) {
      case 'jailed':
        n.moving = false;
        T.faceToward(n, P.jail.x + Math.sin(P.jailYaw) * 3, P.jail.z + Math.cos(P.jailYaw) * 3, dt);
        if (T.simT > n.jailedUntil) {
          n.jailedUntil = 0;
          n.x = P.officeSpot.x;
          n.z = P.officeSpot.z;
          n.task = null;
          T.decide(n);
        }
        return true;
      case 'lost':
        n.moving = false;
        if (!n.bubble && Math.random() < dt / 6) T.say(n, pickOf(['Mum? Dad?', 'I want to go home…', '*sniff*']));
        return true;
      case 'follow': {
        const p = T.playerPos();
        if (T.law.stars >= 2 && !n.escort) { dismiss(n, FOLLOW_LINES.wanted); n.attitude -= 0.2; return true; }
        // Help: the nearest hostile fighter (not the law, nor a bandit only standing its ground) near the
        // player (not a kid being walked home)
        const foe = n.def.unhurt ? null : T.npcs.filter((o) => o.fighter && !o.def.law && !o.campStandoff && !o.fighter.isDead
          && dist2(o.x, o.z, p.x, p.z) < FOLLOW_HELP_DIST)
          .sort((a, b) => dist2(a.x, a.z, n.x, n.z) - dist2(b.x, b.z, n.x, n.z))[0];
        if (foe) {
          const fp = foe.fighter.group.position;
          if (dist2(n.x, n.z, fp.x, fp.z) > BRAWL_REACH) chase(n, fp.x, fp.z, dt, true);
          else {
            n.moving = false;
            T.faceToward(n, fp.x, fp.z, dt);
            if (T.simT > n.nextBlowAt) {
              n.nextBlowAt = T.simT + FOLLOW_HIT_S;
              swingAt(n, fp.x, fp.z);
              foe.followerHit = true;
              const dir = new THREE.Vector3(fp.x - n.x, 0, fp.z - n.z).normalize();
              const killed = foe.fighter.applyDamage(1);
              if (!killed) foe.fighter.applyDirectKnockback?.({ direction: dir, horizSpeed: 3, upVelocity: 0.2, torqueMag: 0, ragdoll: false });
            }
          }
          return true;
        }
        // Keep up: a spot behind the player
        const d = dist2(n.x, n.z, p.x, p.z);
        if (T.stalls.shopAt(n.x, n.z) !== T.stalls.shopAt(p.x, p.z)) {
          // (the player's gone in / out of a shop: after them, through the door)
          chase(n, p.x, p.z, dt, false);
        } else if (d > FOLLOW_GAP + 1) {
          const k = (d - FOLLOW_GAP) / d;
          chase(n, n.x + (p.x - n.x) * k, n.z + (p.z - n.z) * k, dt, d > 6);
        } else {
          n.moving = false;
          n.path = null;
          T.faceToward(n, p.x, p.z, dt);
        }
        return true;
      }
      case 'mug': {
        const v = t.target;
        if (!v?.alive || v.fighter || v.inside || v.jailedUntil > T.simT) { n.task = null; T.decide(n); return true; }
        if (dist2(n.x, n.z, v.x, v.z) > BRAWL_REACH) chase(n, v.x, v.z, dt, true);
        else startBrawl(n, v, 'mug');
        return true;
      }
      case 'arrest': {
        const c = t.target;
        if (!c?.alive || c.fighter || c.jailedUntil > T.simT || !isOutlaw(c)) { n.task = null; T.decide(n); return true; }
        if (dist2(n.x, n.z, c.x, c.z) > BRAWL_REACH) chase(n, c.x, c.z, dt, true);
        else startBrawl(n, c, 'arrest');
        return true;
      }
      case 'brawl': {
        const o = t.foe;
        if (!o?.alive || o.task?.type !== 'brawl' || o.task.foe !== n) { n.task = null; return true; }
        n.moving = false;
        T.faceToward(n, o.x, o.z, dt);
        if (dist2(n.x, n.z, o.x, o.z) > BRAWL_REACH + 0.6) {
          // (knocked apart: close in again)
          if (t.attacker) chase(n, o.x, o.z, dt, true);
          return true;
        }
        if (T.simT < n.nextBlowAt) return true;
        n.nextBlowAt = T.simT + rand(...BRAWL_HIT_S);
        // The one defending may just run (the timid), or give up (an arrest)
        if (!t.attacker && t.mode === 'mug' && Math.random() > n.def.brave) {
          endBrawl(n);
          T.flee(n, o);
          return true;
        }
        swingAt(n, o.x, o.z);
        npcHit(o, n);
        if (!o.alive) { n.task = null; return true; }
        if (t.attacker && t.mode === 'mug') {
          // Got the purse: off with it
          const stolen = Math.ceil(o.money / 2);
          o.money -= stolen;
          n.money += stolen;
          n.loot += 1;
          endBrawl(n);
          T.say(o, shout(SHOUT_THIEF));
          npcCrime(n, 'mug', o);
          T.flee(o, n);
          if (n.def.outlaw) T.setTask(n, { type: 'raidHome', to: T.randomNear(P.camp.x, P.camp.z, 3), dur: 2, run: true });
          else T.startTask(n, 'wander');
          return true;
        }
        if (t.mode === 'arrest' && n.def.law && (o.hp <= 1 || Math.random() < 0.25)) {
          jailNpc(o, n);
          n.task = null;
          T.decide(n);
        }
        return true;
      }
      default:
        return false;
    }
  };

  Object.assign(T, {
    canRecruit, dismiss, endBrawl, family, fighterGear, followers, heroic, isOutlaw, npcCrime,
    rally, reactToPlayer, recruit, startMugging, updateSpecialTask,
  });
}

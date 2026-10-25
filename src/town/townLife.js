// Town: a townsperson's frame — moving, arriving, doing and finishing tasks, chatting with
// passers-by, stepping out of the player's way.

import { SHOUT_CAMP_LEAVE, chatLines, talkLine } from './townPeople.js';
import { glbCharacterConfig } from '../models/glbCharacterModel.js';
import {
  ATTITUDE_FADE, CAMP_CHASE_DIST, DISENGAGE_DIST, HOSTILE_CALM_S, NEEDS, PLAYER_PUSH_DIST, PRODUCE,
  RUN_SPEED, TALK_RANGE, WALK_SPEED, WORK_PAY, dist2, inHours, pickOf, rand,
} from './townConfig.js';

// T: the town's shared state + functions (createTownMode in townMode.js); ctx: the game
export function installTownLife(T, ctx) {
  // ── Per-frame townsperson ──
  const updateNpc = (n, dt) => {
    if (n.dying) {
      if (T.simT > n.dying.until) { n.dying = null; T.releaseBody(n); }
      else T.syncBody(n, dt);
      return;
    }
    if (!n.alive) return;
    // (someone the host / another player runs: drawn where the wire says)
    if (!T.mine(n)) { T.followNet(n, dt); return; }
    if (n.fighter) {
      const e = n.fighter;
      n.moving = Math.hypot(e.group.position.x - n.x, e.group.position.z - n.z) > dt * 0.3;
      n.x = e.group.position.x;
      n.z = e.group.position.z;
      n.yaw = e.group.rotation.y;
      n.hp = e.hearts ?? n.hp;
      if (e.isDead) {
        // (killed some other way than a counted hit — the stage code fades it out)
        ctx.releaseFighterGear(e);
        n.fighter = null;
        if (n.alive) T.die(n, { byPlayer: true, bodyless: true });
        return;
      }
      const d = T.distToPlayer(n);
      if (n.def.law) {
        if (d > DISENGAGE_DIST) T.demote(n, () => T.respond(n));
      } else if (n.def.outlaw && n.campStandoff) {
        // (swords drawn at the camp: the camp watch decides — updateCampWatch)
      } else if (n.def.outlaw) {
        // (bandits give up the chase and go back to the camp — defending it, as soon as the
        // player is off their ground)
        const P = T.layout.places;
        const p = T.playerPos();
        if (ctx.isPlayerDead() || d > DISENGAGE_DIST * 0.7
          || (n.campFight && dist2(p.x, p.z, P.camp.x, P.camp.z) > CAMP_CHASE_DIST)) {
          if (n.campFight && !ctx.isPlayerDead()) T.say(n, pickOf(SHOUT_CAMP_LEAVE), { big: true });
          n.campFight = false;
          T.demote(n);
        }
      } else if ((T.simT - n.lastHurtAt > HOSTILE_CALM_S && d > 6) || d > DISENGAGE_DIST) {
        T.demote(n, () => { T.flee(n); n.fear = 6; });
      }
      return;
    }

    // Needs
    const nd = n.needs;
    if (n.inside && n.task?.type === 'sleep') nd.energy = Math.min(1, nd.energy + NEEDS.sleepGain * dt);
    else nd.energy = Math.max(0, nd.energy - NEEDS.energyDrain * dt);
    nd.hunger = Math.min(1, nd.hunger + NEEDS.hungerRate * dt);
    nd.social = Math.min(1, nd.social + NEEDS.socialRate * dt);
    if (n.fear > 0) n.fear = Math.max(0, n.fear - dt);
    // Grudges and fondness fade (fondness slower) — back to what their memories of the player
    // hold it at (townMemory.js)
    const fromBias = n.attitude - (n.memBias || 0);
    n.attitude -= fromBias * ATTITUDE_FADE * dt * (fromBias > 0 ? 0.5 : 1);
    if (T.simT > (n.reactAt ?? 0)) {
      n.reactAt = T.simT + 0.5;
      T.reactToPlayer(n);
      if (n.fighter) return;
    }

    // A shove from a hit
    if (n.knock?.left > 0) {
      n.knock.left -= dt;
      const nx = n.x + n.knock.vx * dt;
      const nz = n.z + n.knock.vz * dt;
      if (T.walkable(nx, nz)) { n.x = nx; n.z = nz; }
    }

    if (!n.task) T.decide(n);
    const t = n.task;
    t.t += dt;
    if (T.updateSpecialTask(n, t, dt)) { pushFromPlayer(n); return; }

    if (n.inside) {
      // At home: out again when it's time for something else
      const h = T.hour();
      const sleepy = n.def.nightOwl ? (h >= 3 && h < 11) : (h >= 21.5 || h < 6);
      const done = t.type === 'sleep'
        ? (n.def.law ? inHours(h, n.def.hours) : !sleepy && nd.energy > 0.5)
        : t.t > 20 && n.fear <= 0;
      if (done) {
        n.inside = false;
        // (up and out of their room on foot — a house without one: out of its door)
        if (!T.rooms.roomAt(n.x, n.z)) { n.x = n.home.x; n.z = n.home.z; }
        T.decide(n);
      }
      return;
    }

    if (t.phase === 'go') {
      const speed = (t.run ? RUN_SPEED : WALK_SPEED) * n.speedScale;
      if (T.stepPath(n, dt, speed)) {
        t.phase = 'do';
        t.t = 0;
        onArrive(n, t);
      }
    } else {
      n.moving = false;
      if (t.type === 'talk') {
        const p = T.playerPos();
        T.faceToward(n, p.x, p.z, dt);
        if (t.t > t.dur || T.distToPlayer(n) > TALK_RANGE + 2) { T.clearTalk(n); T.decide(n); }
      } else if (t.type === 'chat') {
        const o = t.with;
        if (o?.alive) T.faceToward(n, o.x, o.z, dt);
        if (t.lines && !t.said2 && t.t > 2.4 && o?.task?.type === 'chat' && o.task.with === n) {
          t.said2 = true;
          T.say(o, t.lines[1]);
        }
        if (t.t > t.dur) T.decide(n);
      } else {
        if (t.face) T.faceToward(n, t.face.x, t.face.z, dt);
        doActivity(n, t, dt);
        if (t.t > t.dur) finishTask(n, t);
      }
    }
    pushFromPlayer(n);

    // Now and then they say something if the player's near
    if (T.simT > n.nextAmbientAt) {
      n.nextAmbientAt = T.simT + rand(14, 30);
      if (n.body && !n.bubble && T.distToPlayer(n) < 12 && !['talk', 'chat', 'flee', 'respond'].includes(t.type) && Math.random() < 0.3) {
        T.say(n, talkLine(n, { playerName: ctx.getPlayerName(), taskType: t.type, market: T.marketTalk() }));
      }
    }
  };
  const onArrive = (n, t) => {
    if (t.type === 'sleep') { n.inside = true; return; }
    if (t.type === 'flee') {
      if (t.hide) { n.inside = true; n.task = { type: 'hide', t: 0, phase: 'do' }; }
      else T.decide(n);
      return;
    }
    if (t.type === 'respond') {
      // Got there and lost them: look around
      if (!T.law.seen) {
        T.setTask(n, { type: 'search', to: T.randomNear(T.law.lastKnown.x, T.law.lastKnown.z, 8), dur: rand(1, 3) });
        n.task.target = { x: T.law.lastKnown.x, z: T.law.lastKnown.z };
        n.task.plannedAt = T.simT;
      }
      return;
    }
    if (t.type === 'eat') T.buyFood(n);
    if (t.type === 'deliver') T.deliverGoods(n);
    if (t.type === 'raid') T.raidField(n, t);
    if (t.type === 'raidHome') { n.loot = 0; T.onRaidHome(n); T.decide(n); return; }
    if (t.type === 'wander' && Math.random() < 0.35) tryStartChat(n);
    // (a raider prowling the town at night: whoever's still out)
    if (t.type === 'prowl') T.startMugging(n);
  };
  const doActivity = (n, t, dt) => {
    if (t.type === 'social') n.needs.social = Math.max(0, n.needs.social - dt / 25);
    if ((t.anim === 'chop' || t.anim === 'farm') && n.body && T.simT > n.actionAt) {
      n.actionAt = T.simT + (t.anim === 'chop' ? 2.2 : 3.4) + Math.random();
      n.body.character.playAction(glbCharacterConfig.throwClip);
      if (t.anim === 'chop' && T.distToPlayer(n) < 14) setTimeout(() => { if (T.active) ctx.playSfx('chop'); }, 450);
    }
    if (t.type === 'social' && !n.bubble && Math.random() < dt / 9) {
      const others = T.npcs.filter((o) => o !== n && o.alive && o.task?.type === 'social' && o.task.phase === 'do' && dist2(o.x, o.z, n.x, n.z) < 4);
      if (others.length) {
        const lines = chatLines(T.gossip, ctx.getPlayerName());
        T.say(n, lines[0]);
        const o = pickOf(others);
        setTimeout(() => { if (T.active && o.alive) T.say(o, lines[1]); }, 2200);
      }
    }
  };
  const finishTask = (n, t) => {
    if (t.type === 'work') {
      const made = PRODUCE[n.role];
      if (made) n.carry[made[0]] += Math.round(rand(made[1], made[2]));
      else if (n.def.law) n.money += WORK_PAY; // (the town pays its guards)
    }
    if (t.type === 'burgle') T.burgle(n, t);
    // (a guard who lost the player keeps looking round where they were last seen)
    if (t.type === 'search' && T.law.stars > 0) {
      T.setTask(n, { type: 'search', to: T.randomNear(T.law.lastKnown.x, T.law.lastKnown.z, 8), dur: rand(1, 3) });
      n.task.target = { x: T.law.lastKnown.x, z: T.law.lastKnown.z };
      n.task.plannedAt = T.simT;
      return;
    }
    T.decide(n);
  };

  const tryStartChat = (n) => {
    const o = T.npcs.find((m) => m !== n && m.alive && T.mine(m) && !m.fighter && !m.inside && m.fear <= 0
      && (m.task?.type === 'wander') && dist2(m.x, m.z, n.x, n.z) < 6);
    if (!o) return;
    const lines = chatLines(T.gossip, ctx.getPlayerName());
    const dur = rand(6, 9);
    n.task = { type: 'chat', t: 0, phase: 'do', with: o, dur, lines };
    o.task = { type: 'chat', t: 0, phase: 'do', with: n, dur };
    n.path = null;
    o.path = null;
    o.moving = false;
    T.say(n, lines[0]);
    n.task.said2 = false;
  };
  const pushFromPlayer = (n) => {
    const p = T.playerPos();
    const dx = n.x - p.x;
    const dz = n.z - p.z;
    const d = Math.hypot(dx, dz);
    if (d >= PLAYER_PUSH_DIST || d < 1e-4) return;
    const nx = p.x + (dx / d) * PLAYER_PUSH_DIST;
    const nz = p.z + (dz / d) * PLAYER_PUSH_DIST;
    if (T.walkable(nx, nz)) { n.x = nx; n.z = nz; }
  };

  Object.assign(T, {
    updateNpc,
  });
}

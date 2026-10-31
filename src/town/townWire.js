// Town: the shared town's wire (Multiplayer — townNet.js carries it): townsfolk sent as compact
// arrays, claims, remote hits and deaths, joining, host hand-over.

import { GOODS, GOOD_IDS } from './townEconomy.js';
import { ROLES, SHOUT_HURT, TOWN_NAME, firstName, relationOf, shout } from './townPeople.js';
import * as THREE from 'three';
import { glbCharacterConfig } from '../models/glbCharacterModel.js';
import {
  DEAD_BODY_S, NET_CLAIM_GRACE_S, NET_CLAIM_TIMEOUT_S, NET_FULL_S, NET_SEND_S,
  NET_WORLD_S, NEWCOMER_DELAY_S, SAVE_EVERY_S, _v, angleLerp, heightScale, rand,
} from './townConfig.js';

// T: the town's shared state + functions (createTownMode in townMode.js); ctx: the game
export function installTownWire(T, ctx) {
  // ── Shared town: the wire (Multiplayer — townNet.js carries it) ──
  // [id, x, z, yaw, flags, hp, controller id | 0, money]; flags: 1 moving, 2 inside, 4 fighting,
  // 8 in the cell, 16 lost, 32 following, 64 chopping, 128 farming, 256 at work
  const r2 = (v) => Math.round(v * 100) / 100;
  const dynOf = (n) => {
    const t = n.task;
    const own = T.mine(n);
    const anim = own ? (t?.phase === 'do' ? t.anim : null) : n.anim;
    let f = 0;
    if (n.moving) f |= 1;
    if (n.inside) f |= 2;
    if (n.fighter || (!own && n.netFight)) f |= 4;
    if (n.jailedUntil > T.simT) f |= 8;
    if (n.lost) f |= 16;
    if (n.following) f |= 32;
    if (anim === 'chop') f |= 64;
    if (anim === 'farm') f |= 128;
    if (T.isWorking(n)) f |= 256;
    return [n.id, r2(n.x), r2(n.z), r2(n.yaw), f, n.hp, n.ctrl || 0, Math.round(n.money)];
  };
  // (withMoney: the host's word — the host keeps everyone's purse)
  const applyDyn = (n, a, withMoney = true) => {
    const [, x, z, yaw, f, hp, , money] = a;
    if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(f)) return;
    n.net = { x, z, yaw: Number.isFinite(yaw) ? yaw : n.yaw };
    n.moving = !!(f & 1);
    const inside = !!(f & 2);
    if (inside !== n.inside) {
      n.inside = inside;
      if (!inside) { n.x = x; n.z = z; }
    }
    n.netFight = !!(f & 4);
    n.jailedUntil = f & 8 ? Math.max(n.jailedUntil, T.simT + 3) : Math.min(n.jailedUntil, T.simT);
    n.lost = !!(f & 16);
    n.anim = f & 64 ? 'chop' : f & 128 ? 'farm' : null;
    n.netWorking = !!(f & 256);
    if (Number.isFinite(hp)) n.hp = hp;
    if (withMoney && Number.isFinite(money)) n.money = money;
  };
  // A townsperson someone else runs: eased to where the wire says
  const followNet = (n, dt) => {
    const s = n.net;
    if (s) {
      const dx = s.x - n.x;
      const dz = s.z - n.z;
      if (dx * dx + dz * dz > 36) { n.x = s.x; n.z = s.z; n.yaw = s.yaw; }
      else {
        const k = 1 - Math.exp(-8 * dt);
        n.x += dx * k;
        n.z += dz * k;
        n.yaw = angleLerp(n.yaw, s.yaw, k);
      }
    }
    if (n.anim && n.body && T.simT > n.actionAt) {
      n.actionAt = T.simT + (n.anim === 'chop' ? 2.2 : 3.4) + Math.random();
      n.body.character.playAction(glbCharacterConfig.throwClip);
    }
    // (they still feel things about this player: a vendetta, a grudge — the reaction claims them)
    if (T.simT > (n.reactAt ?? 0)) {
      n.reactAt = T.simT + 0.5;
      T.reactToPlayer(n);
    }
  };
  // Our claim lost out (someone else's now, or the host's)
  const dropClaim = (n, ctrl) => {
    if (n.fighter) { ctx.removeFighter(n.fighter); n.fighter = null; n.hostile = false; n.campStandoff = false; }
    T.clearTalk(n);
    n.following = false;
    n.escort = false;
    n.ctrl = ctrl;
    n.pendingHit = null;
    n.task = null;
    n.path = null;
    n.net = { x: n.x, z: n.z, yaw: n.yaw };
  };
  // Our blow on someone another game runs
  const hurtRemote = (n, dir, amount) => {
    const p = T.playerPos();
    T.net.send(n.ctrl || T.net.hostId(), { w: 1, op: 'hit', id: n.id, amt: amount, dir: [r2(dir.x), r2(dir.z)], from: [r2(p.x), r2(p.z)], by: T.myId() });
    const gy = T.groundY(n);
    if (!n.def.unhurt) ctx.spawnBlood(_v.set(n.x, gy + 0.55 * heightScale(n.url), n.z), gy);
    ctx.playSfx('hit');
    n.attitude = Math.max(-1, n.attitude - (n.def.unhurt ? 0.3 : 0.6));
    if (n.def.unhurt) return;
    if (T.isOutlaw(n)) T.heroic(n);
    else T.crime('assault', n);
  };
  // Another player's blow on someone we run
  const applyRemoteHit = (n, d, by) => {
    const amt = Math.max(1, Math.min(3, Math.round(Number(d.amt) || 1)));
    const dir = Array.isArray(d.dir) && d.dir.every(Number.isFinite) ? { x: d.dir[0], z: d.dir[1] } : { x: 0, z: 0 };
    const from = Array.isArray(d.from) && d.from.every(Number.isFinite) ? { x: d.from[0], z: d.from[1] } : null;
    if (n.fighter) {
      n.remoteBy = by;
      const killed = n.fighter.applyDamage(amt);
      n.remoteBy = null;
      if (!killed) n.fighter.applyDirectKnockback?.({ direction: new THREE.Vector3(dir.x, 0, dir.z), horizSpeed: 3, upVelocity: 0.2, torqueMag: 0, ragdoll: false });
      return;
    }
    if (n.def.unhurt) { T.flee(n, from); return; }
    n.lastHurtAt = T.simT;
    n.lastHitAt = T.simT;
    n.hp -= amt;
    if (n.body && T.distToPlayer(n) < 25) {
      const gy = T.groundY(n);
      ctx.spawnBlood(_v.set(n.x, gy + 0.55 * heightScale(n.url), n.z), gy);
      ctx.playSfx('hit', { x: n.x, y: gy + 1, z: n.z });
    }
    n.knock = { vx: dir.x * 3, vz: dir.z * 3, left: 0.25 };
    if (n.hp <= 0) { T.die(n, { by, noCoins: true }); return; }
    T.clearTalk(n);
    T.say(n, shout(SHOUT_HURT, n));
    T.flee(n, from);
  };
  // The host's part of a death: someone moves in later, everyone's told
  const worldDeath = (n, killer, except = null) => {
    // (a bandit beaten is one fewer at the camp — the gang only grows back a morning at a time)
    if (n.def.outlaw) T.gangSize = Math.max(0, (T.gangSize ?? 0) - 1);
    else T.arrivals.push({ role: n.role, at: T.simT + rand(...NEWCOMER_DELAY_S) });
    if (!n.def.outlaw) T.departed = [...T.departed, firstName(n.name)].slice(-20);
    if (!T.mp()) return;
    for (const pid of T.net.peerIds()) if (pid !== except) T.net.send(pid, { w: 1, op: 'dead', id: n.id, by: killer ?? null });
  };
  // Someone died in another game (killer: whose blow it was — ours drops the coins, and counts)
  const remoteDeath = (n, killer) => {
    if (!n.alive) return;
    if (n.fighter) { ctx.removeFighter(n.fighter); n.fighter = null; }
    n.alive = false;
    n.moving = false;
    n.ctrl = null;
    T.clearTalk(n);
    if (n.body) {
      T.clearBubble(n);
      n.body.character.playDeath();
      n.dying = { until: T.simT + DEAD_BODY_S };
    }
    const byMe = !!killer && killer === T.myId();
    if (byMe && n.money >= 1) ctx.dropCoins(new THREE.Vector3(n.x, T.groundY(n) + 0.3, n.z), Math.min(3, 1 + Math.floor(n.money / 8)));
    if (byMe || T.distToPlayer(n) < 60) T.feedLine(n.def.outlaw ? `${n.name} is down.` : `${n.name} the ${n.def.label} is dead.`);
    if (!n.def.outlaw) T.gossip.push({ kind: 'murder', who: firstName(n.name), by: byMe ? 'player' : null, at: T.simT, fresh: true });
    if (byMe && !T.isOutlaw(n)) {
      T.crime('murder', n);
      for (const k of T.family(n)) {
        k.attitude = -1;
        if (!k.def.unhurt) { k.vendetta = true; k.vendettaFor = relationOf(n.role); }
      }
    }
    T.onJobDeath(n, byMe);
    T.save();
  };
  // Gone from the host's town without a word (died while we weren't listening)
  const vanish = (n) => {
    if (n.fighter) { ctx.removeFighter(n.fighter); n.fighter = null; }
    n.alive = false;
    n.dying = null;
    T.releaseBody(n);
  };
  const fullSnapshot = () => ({ ...T.worldSnapshot(), dyn: T.npcs.filter((n) => n.alive).map(dynOf) });
  const placeFromDyn = (dyn) => {
    for (const a of Array.isArray(dyn) ? dyn : []) {
      const n = Array.isArray(a) ? T.npcs.find((m) => m.id === a[0]) : null;
      if (!n?.alive || T.mine(n)) continue;
      n.ctrl = a[6] || null;
      if (n.ctrl === T.myId()) n.ctrl = null; // (a claim of ours the host still holds: it's let go below)
      const first = !n.net;
      applyDyn(n, a);
      if (first && n.net) { n.x = n.net.x; n.z = n.net.z; n.yaw = n.net.yaw; }
    }
  };
  // The whole town from the host: the first time it's the town; later, it puts ours right
  const applyFull = (s) => {
    if (!s || !Array.isArray(s.people)) return;
    if (!T.ready) {
      if (!T.cloudDone) return; // (the player's saves aren't in yet: the next one)
      T.spawnTown(s, T.loadPersonal());
      placeFromDyn(s.dyn);
      T.topPlace.textContent = `${TOWN_NAME} · ${T.net.playerCount()} online`;
      T.feedLine(`Welcome to ${TOWN_NAME}! ${T.net.playerCount() > 1 ? `${T.net.playerCount()} players are in town.` : 'Walk up to people to talk.'}`);
      return;
    }
    if (Number.isFinite(s.day)) T.clock.day = s.day;
    if (Number.isFinite(s.minutes)) T.clock.minutes = s.minutes;
    if (Array.isArray(s.departed)) T.departed = s.departed;
    if (Number.isFinite(s.raidNight)) T.raidNight = s.raidNight;
    if (Number.isFinite(s.gangSize)) T.gangSize = s.gangSize;
    if (Number.isFinite(s.gangDay)) T.gangDay = s.gangDay;
    if (s.houses) T.applyHouses(s.houses);
    if (s.fieldOwners) { T.applyFieldOwners(s.fieldOwners); T.assignWork(); }
    if (s.market) { for (const g of GOOD_IDS) if (Number.isFinite(s.market[g])) T.market.stock[g] = s.market[g]; T.noteStock(); }
    const ids = new Set();
    let added = false;
    for (const p of s.people) {
      if (!ROLES[p.role]) continue;
      ids.add(p.id);
      let n = T.npcs.find((m) => m.id === p.id);
      if (!n) {
        n = T.makeNpc({ ...p, attitude: 0 });
        T.npcs.push(n);
        added = true;
        T.nextId = Math.max(T.nextId, p.id + 1);
        T.feedLine(n.def.outlaw ? `${n.name} joined the bandits.` : `${n.name} the ${n.def.label} moved to ${TOWN_NAME}.`);
      }
      if (!T.mine(n) && n.alive) {
        if (Number.isFinite(p.money)) n.money = p.money;
        if (p.carry) n.carry = { ...n.carry, ...p.carry };
      }
    }
    for (const n of T.npcs) if (n.alive && !ids.has(n.id) && !T.mine(n)) vanish(n);
    if (added) T.assignWork();
    placeFromDyn(s.dyn);
  };
  // The host's townsfolk, a few times a second
  T.fullAskedAt = -1e9;
  const onNpcs = (list) => {
    const seen = new Set();
    let unknown = false;
    const me = T.myId();
    for (const a of list) {
      if (!Array.isArray(a)) continue;
      const n = T.npcs.find((m) => m.id === a[0]);
      if (!n) { unknown = true; continue; }
      seen.add(n.id);
      if (!n.alive) continue;
      let ctrl = a[6] || null;
      // (our release hasn't reached the host yet)
      if (ctrl === me && n.ctrl !== me && T.simT - (n.releasedAt ?? -1e9) < NET_CLAIM_GRACE_S) ctrl = null;
      if (n.ctrl === me && ctrl === me) { n.claimOk = true; n.pendingHit = null; }
      if (n.ctrl === me && ctrl !== me) {
        // (our claim hasn't reached the host yet — or went to someone else)
        if (T.simT - (n.claimAt ?? -1e9) < NET_CLAIM_GRACE_S) continue;
        dropClaim(n, ctrl);
      }
      n.ctrl = ctrl;
      if (T.mine(n)) continue; // (the host thinks we run them: back to it with the next decide)
      applyDyn(n, a);
    }
    for (const n of T.npcs) if (n.alive && !seen.has(n.id) && !T.mine(n)) vanish(n);
    if (unknown && T.simT - T.fullAskedAt > 3) {
      T.fullAskedAt = T.simT;
      T.net.send(T.net.hostId(), { w: 1, op: 'hello' });
    }
  };
  const handleNet = (from, d) => {
    if (!T.active || !T.layout || !T.net || typeof d?.op !== 'string') return;
    const n = Number.isFinite(d.id) ? T.npcs.find((m) => m.id === d.id) ?? null : null;
    const fromHost = from === T.net.hostId();
    // (who owns which house, a player asking for one / buying it — townHomes.js)
    if (T.handleHomesNet(from, d)) return;
    if (T.handleFarmNet(from, d)) return;
    if (T.handleTreeNet(from, d)) return;
    // (the night raid's call, a player's house broken into — townBandits.js)
    if (T.handleBanditNet(from, d)) return;
    switch (d.op) {
      case 'hello':
        if (T.netMode === 'host' && T.ready) T.net.send(from, { w: 1, op: 'full', s: fullSnapshot() });
        return;
      case 'full':
        if (!fromHost || T.netMode === 'host' || T.netMode === 'off' || !T.laidOut) return;
        T.netMode = 'client';
        applyFull(d.s);
        return;
      case 'npcs':
        if (fromHost && T.netMode === 'client' && T.ready && Array.isArray(d.l)) onNpcs(d.l);
        return;
      case 'w':
        if (!fromHost || T.netMode !== 'client' || !T.ready) return;
        if (Number.isFinite(d.d)) T.clock.day = d.d;
        if (Number.isFinite(d.m)) T.clock.minutes = d.m;
        if (d.mk) { for (const g of GOOD_IDS) if (Number.isFinite(d.mk[g])) T.market.stock[g] = d.mk[g]; T.noteStock(); }
        return;
      case 'dead':
        if (T.ready && n?.alive) remoteDeath(n, typeof d.by === 'string' ? d.by : null);
        return;
      case 'deny': {
        if (!n || n.ctrl !== T.myId()) return;
        const hit = n.pendingHit;
        dropClaim(n, d.c && d.c !== T.net.hostId() ? d.c : null);
        if (hit && n.alive) {
          const p = T.playerPos();
          T.net.send(n.ctrl || T.net.hostId(), { w: 1, op: 'hit', id: n.id, amt: hit.amt, dir: hit.dir, from: [r2(p.x), r2(p.z)], by: T.myId() });
        }
        return;
      }
      case 'say':
        if (!T.ready || !n?.alive || T.mine(n) || typeof d.t !== 'string') return;
        T.netSaying = true;
        T.say(n, d.t.slice(0, 140), { big: !!d.b });
        T.netSaying = false;
        if (T.netMode === 'host') for (const pid of T.net.peerIds()) if (pid !== from) T.net.send(pid, d);
        return;
      case 'hit': {
        if (!T.ready || !n?.alive) return;
        const by = typeof d.by === 'string' ? d.by : from;
        if (T.mine(n)) applyRemoteHit(n, d, by);
        else if (T.netMode === 'host' && n.ctrl && n.ctrl !== from) T.net.send(n.ctrl, d); // (claimed meanwhile)
        return;
      }
      default:
    }
    if (T.netMode !== 'host' || !T.ready) return;
    switch (d.op) {
      case 'claim': {
        if (!n?.alive) return;
        const busy = (n.ctrl && n.ctrl !== from && T.net.peerIds().includes(n.ctrl))
          || (!n.ctrl && (n.fighter || n.following || n.guiding || n.lost || T.talking?.npc === n
            || ['respond', 'search', 'talk', 'flee'].includes(n.task?.type)));
        if (busy) { T.net.send(from, { w: 1, op: 'deny', id: n.id, c: n.ctrl || T.myId() }); return; }
        T.endBrawl(n);
        n.ctrl = from;
        n.ctrlSeenAt = T.simT;
        n.task = null;
        n.path = null;
        if (Array.isArray(d.st)) applyDyn(n, d.st, false);
        return;
      }
      case 'rel':
        if (!n?.alive || n.ctrl !== from) return;
        if (Array.isArray(d.st)) applyDyn(n, d.st, false);
        if (n.net) { n.x = n.net.x; n.z = n.net.z; n.yaw = n.net.yaw; }
        n.ctrl = null;
        n.net = null;
        n.netFight = false;
        n.task = null;
        n.path = null;
        return;
      case 'own':
        if (!Array.isArray(d.l)) return;
        for (const a of d.l) {
          const m = Array.isArray(a) ? T.npcs.find((x) => x.id === a[0]) : null;
          if (!m?.alive || m.ctrl !== from) continue;
          m.ctrlSeenAt = T.simT;
          applyDyn(m, a, false);
        }
        return;
      case 'died':
        if (!n?.alive) return;
        remoteDeath(n, typeof d.by === 'string' ? d.by : null);
        worldDeath(n, typeof d.by === 'string' ? d.by : null, from);
        return;
      case 'trade': {
        if (!GOODS[d.g]) return;
        if (d.d < 0) T.market.take(d.g);
        else T.market.put(d.g);
        const m = T.workingMerchant() ?? T.npcs.find((x) => x.alive && x.role === 'merchant');
        if (m && Number.isFinite(d.cash)) m.money = Math.max(0, m.money + Math.max(-200, Math.min(200, d.cash)));
        T.noteStock();
        return;
      }
      case 'money':
        if (n?.alive && Number.isFinite(d.d)) n.money = Math.max(0, n.money + Math.max(-200, Math.min(200, d.d)));
        return;
      default:
    }
  };
  // Waiting on the room: its host loads the town (or founds it), the rest ask the host for it
  const tickJoin = () => {
    // (the player's saves in Firebase first — townMode.js fetchCloud, which times out itself)
    if (!T.cloudDone) return;
    const now = performance.now();
    if (T.netFailed || now > T.joinUntil) {
      const why = T.net.lastError() ?? (T.net.isHost() ? 'timed out' : T.net.joinTrouble());
      console.warn(`[Town] playing alone: ${why}`);
      T.net.stop();
      T.netMode = 'off';
      T.spawnTown();
      T.topPlace.textContent = `${TOWN_NAME} · just you`;
      T.feedLine(`No shared town (${why}) — this one's just yours.`);
      return;
    }
    // (the room's lookup failed: no need to wait out the timeout)
    if (!T.net.isOn() && T.net.lastError()) { T.joinUntil = 0; return; }
    if (!T.net.isOn() || !T.net.ready()) return;
    if (T.net.isHost()) {
      if (T.netLoading) return;
      T.netLoading = true;
      const token = T.enterToken;
      T.net.loadRoomState().then((state) => {
        T.netLoading = false;
        if (!T.active || token !== T.enterToken || T.netMode !== 'joining') return;
        T.netMode = 'host';
        T.spawnTown(state?.v === 1 && Array.isArray(state.people) ? state : null, T.loadPersonal());
        T.netT.full = 0;
        T.feedLine(`Welcome to ${TOWN_NAME}! ${T.net.playerCount() > 1 ? `${T.net.playerCount()} players are in town.` : 'Walk up to people to talk.'}`);
      });
      return;
    }
    if (now > T.helloAt) {
      T.helloAt = now + 2000;
      T.net.send(T.net.hostId(), { w: 1, op: 'hello' });
    }
  };
  // The host left (we run the town now) — or another game took over from us
  const checkNetRole = () => {
    if (!T.net.isOn()) {
      // (lost the room: everyone's ours, a town of our own from here)
      becomeHost();
      T.netMode = 'off';
      T.topPlace.textContent = `${TOWN_NAME} · just you`;
      T.feedLine(T.leftWhileAway
        ? 'You were away, so you left the shared town — go back to the lobby and into Town to rejoin.'
        : 'Lost the connection — the town carries on, just you now.');
      T.leftWhileAway = false;
      return;
    }
    if (!T.net.ready()) return;
    if (T.netMode === 'client' && T.net.isHost()) becomeHost();
    else if (T.netMode === 'host' && !T.net.isHost()) becomeClient();
  };
  const becomeHost = () => {
    T.netMode = 'host';
    const peers = new Set(T.net.peerIds());
    for (const n of T.npcs) {
      if (n.ctrl === T.myId() || (n.ctrl && !peers.has(n.ctrl))) n.ctrl = null;
      if (n.ctrl) { n.ctrlSeenAt = T.simT; continue; }
      if (!n.task) {
        if (n.net) { n.x = n.net.x; n.z = n.net.z; n.yaw = n.net.yaw; }
        n.net = null;
        n.netFight = false;
        n.netWorking = false;
        n.anim = null;
      }
    }
    if (T.isHost()) T.ensureGang();
    T.netT.full = 0;
    T.netT.send = 0;
  };
  const becomeClient = () => {
    T.netMode = 'client';
    const me = T.myId();
    for (const n of T.npcs) {
      if (!n.alive || n.ctrl) continue;
      const keep = n.fighter || n.following || n.guiding || n.lost || T.talking?.npc === n || ['respond', 'search', 'flee', 'talk'].includes(n.task?.type);
      if (keep) {
        n.ctrl = me;
        n.claimAt = T.simT;
        T.net.send(T.net.hostId(), { w: 1, op: 'claim', id: n.id, st: dynOf(n) });
      } else {
        n.task = null;
        n.path = null;
        n.net = { x: n.x, z: n.z, yaw: n.yaw };
      }
    }
    T.arrivals = [];
    T.fullAskedAt = T.simT;
    T.net.send(T.net.hostId(), { w: 1, op: 'hello' });
  };
  const netTick = () => {
    if (T.simT > T.netT.label) {
      T.netT.label = T.simT + 1;
      T.topPlace.textContent = `${TOWN_NAME} · ${T.net.playerCount()} online`;
    }
    if (T.netMode === 'host') {
      if (T.simT > T.netT.send) {
        T.netT.send = T.simT + NET_SEND_S;
        T.net.broadcast({ w: 1, op: 'npcs', l: T.npcs.filter((n) => n.alive).map(dynOf) });
      }
      if (T.simT > T.netT.world) {
        T.netT.world = T.simT + NET_WORLD_S;
        T.net.broadcast({ w: 1, op: 'w', d: T.clock.day, m: r2(T.clock.minutes), mk: T.market.snapshot() });
        // Claims of players who left (or went quiet) go back to the town
        const peers = new Set(T.net.peerIds());
        for (const n of T.npcs) {
          if (!n.ctrl || (peers.has(n.ctrl) && T.simT - (n.ctrlSeenAt ?? 0) < NET_CLAIM_TIMEOUT_S)) continue;
          n.ctrl = null;
          if (n.net) { n.x = n.net.x; n.z = n.net.z; }
          n.net = null;
          n.netFight = false;
          n.task = null;
          n.path = null;
        }
      }
      if (T.simT > T.netT.full) {
        T.netT.full = T.simT + NET_FULL_S;
        T.net.broadcast({ w: 1, op: 'full', s: fullSnapshot() });
      }
      if (T.simT > T.netT.save) {
        T.netT.save = T.simT + SAVE_EVERY_S;
        if (T.net.canSave()) T.net.saveRoomState(T.worldSnapshot());
      }
    } else if (T.simT > T.netT.send) {
      T.netT.send = T.simT + NET_SEND_S;
      T.netT.world = T.simT + NET_WORLD_S;
      const own = T.npcs.filter((n) => n.alive && n.ctrl === T.myId()).map(dynOf);
      if (own.length) T.net.send(T.net.hostId(), { w: 1, op: 'own', l: own });
    }
  };

  Object.assign(T, {
    checkNetRole, dynOf, followNet, handleNet, hurtRemote, netTick, r2, tickJoin, worldDeath,
  });
}

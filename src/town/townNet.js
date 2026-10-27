// Town mode in Multiplayer: a shared town per room of up to TOWN_ROOM_MAX players.
//
// Rooms (Firebase): the first time a player starts Town they join the oldest room with a free
// place (or a new one) and it's their town from then on (`townHome/<key>`; guests by a device
// key). A member who hasn't been back for MEMBER_STALE_MS loses their place (pruned whenever a
// room is looked at), so new players can move in.
//   townRoomSeq                     = the newest room's number (rooms are r1, r2…)
//   townRoomMembers/<roomId>/<key> = { name, seen }
//   townRoomState/<roomId>          = the town's world (townMode.js worldSnapshot), written by the host
//   townHome/<key>                  = roomId
//
// Transport: the PeerJS Multiplayer in room `town-<roomId>`; everyone is connected to everyone
// (sendTo). Its host (the oldest peer in the room) runs the townsfolk — townMode.js has the
// world protocol (messages with `w: 1`, handed to ctx.onWorldMessage). This module also does the
// players themselves: each sends `pl` (name, character, wanted stars, weapon, sword pose) a few
// times a second; their sword / wand / gun / shield are drawn on their models. Bullets: the
// shooter's game detects the hit (`pvp` with k 'gun'); bombs and spells go to everyone (`bomb` /
// `magic`) and each game checks them against its own player (who tells the attacker — `hurt`) and are hit targets for the local sword (PvP:
// the attacker detects the hit — `pvp` — the victim applies it); `bounty` pays whoever brought
// a wanted player down.

import * as THREE from 'three';
import { ref, get, set, update, remove, runTransaction } from 'firebase/database';
import { db } from '../core/firebase-init.js';

// (every player has a house of their own and the town has ~19 homes: kept low enough that some
// townsfolk always live there too — MIN_TOWNSFOLK in townConfig.js)
export const TOWN_ROOM_MAX = 12;
const MEMBER_STALE_MS = 21 * 24 * 3600 * 1000; // 3 weeks away: the place goes to someone else
const FIND_TIMEOUT_MS = 10000;
const PL_SEND_MS = 100;
const PLAYER_TIMEOUT_MS = 8000;
const SETTLE_MS = 1500;          // the room's host must hold this long before the town starts

const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
const isVec = (v, n) => Array.isArray(v) && v.length === n && v.every(Number.isFinite);
const round3 = (v) => Math.round(v * 1000) / 1000;
const live = (m, now) => m && now - (m.seen || 0) <= MEMBER_STALE_MS;

// Rooms in age order: r1, r2… (`townRoomSeq` = the newest); rooms from before that (push keys) first
const roomOrder = (a, b) => {
  const na = /^r\d+$/.test(a) ? Number(a.slice(1)) : -1;
  const nb = /^r\d+$/.test(b) ? Number(b.slice(1)) : -1;
  return na !== nb ? na - nb : (a < b ? -1 : a > b ? 1 : 0);
};

// The player's town room. key: the profile key, or a guest's device key (a guest holds a place
// like anyone — it lapses after MEMBER_STALE_MS too). A new room is only made when every room is
// full, through a transaction on the counter, so players starting at once land in the same one.
// Someone alone in their room while an older room has people and a free place moves in there.
export async function findTownRoom(key, name) {
  const now = Date.now();
  const all = (await get(ref(db, 'townRoomMembers'))).val() || {};
  const count = (roomId) => Object.values(all[roomId] || {}).filter((m) => live(m, now)).length;
  const rooms = Object.keys(all).sort(roomOrder);
  const home = (await get(ref(db, `townHome/${key}`))).val();
  if (typeof home === 'string' && live(all[home]?.[key], now)) {
    const older = count(home) === 1
      ? rooms.find((r) => roomOrder(r, home) < 0 && count(r) > 0 && count(r) < TOWN_ROOM_MAX)
      : null;
    if (older && await joinRoom(older, key, name)) {
      await remove(ref(db, `townRoomMembers/${home}/${key}`)).catch(() => {});
      return older;
    }
    await update(ref(db, `townRoomMembers/${home}/${key}`), { seen: now, name: name || '' });
    return home;
  }
  for (const roomId of rooms) {
    if (count(roomId) >= TOWN_ROOM_MAX) continue;
    if (await joinRoom(roomId, key, name)) return roomId;
  }
  // Every room full (or none yet): the newest one, made if need be
  for (let tries = 0; tries < 5; tries++) {
    const seq = Number((await get(ref(db, 'townRoomSeq'))).val()) || 0;
    if (seq > 0 && await joinRoom(`r${seq}`, key, name)) return `r${seq}`;
    await runTransaction(ref(db, 'townRoomSeq'), (cur) => ((Number(cur) || 0) === seq ? seq + 1 : undefined));
  }
  throw new Error('no town room could be joined');
}

// A place in the room (members away too long are dropped on the way); false when it's full
async function joinRoom(roomId, key, name) {
  const now = Date.now();
  const res = await runTransaction(ref(db, `townRoomMembers/${roomId}`), (cur) => {
    const next = {};
    for (const [k, m] of Object.entries(cur || {})) if (live(m, now)) next[k] = m;
    if (!next[key] && Object.keys(next).length >= TOWN_ROOM_MAX) return undefined; // full: abort
    next[key] = { name: name || '', seen: now };
    return next;
  });
  if (!res.committed) return false;
  await set(ref(db, `townHome/${key}`), roomId);
  return true;
}

export const loadTownRoomState = async (roomId) => {
  try { return (await get(ref(db, `townRoomState/${roomId}`))).val(); } catch (_) { return null; }
};
export const saveTownRoomState = (roomId, state) => set(ref(db, `townRoomState/${roomId}`), state).catch(() => {});

// ctx: getMultiplayer(), startMultiplayer(roomId), stopMultiplayer(), profileKey(), memberKey(), getPlayerName(),
//   scene, getRemoteModel(id), setRemoteCharacter(id, url), createSwordMesh(url), createWandMesh(), createRodMesh(),
//   getLocalWeapon() → 'sword' | 'gun' | 'shield' | 'wand' | null, getWeaponGear() (matchCtx's),
//   getLocalPosition(), launchRemoteBomb(origin, target, fromId), spawnRemoteMagic({ …, caster }),
//   getLocalSwordState(), getLocalCharacterUrl(), getStars(), getStatus() → { coins, hp, maxHp } (for
//   Settings → Town), applyPvpHit(dmg, dir, fromId),
//   onSwingBlocked(), onAttackPlayer(info), onBounty(fromName, coins), onWorldMessage(from, data)
export function createTownNet(ctx) {
  let on = false;
  let roomId = null;
  let startToken = 0;
  let plSentAt = 0;
  let hostSeen = { id: null, since: 0 };
  let lastError = null;       // why there's no shared town (shown in the town's HUD)
  const heardAt = new Map();  // peer id → when a message of theirs last came in (why a join failed)
  const players = new Map(); // peer id → { name, url, stars, coins, hp, maxHp, swordTarget, hand, blocking, sword, lastAt, combat }

  const mp = () => (on ? ctx.getMultiplayer() : null);
  const id = () => mp()?.getId?.() ?? null;
  const hostId = () => mp()?.getHostId?.() ?? null;
  const peerIds = () => {
    const m = mp();
    if (!m?.id) return [];
    return (m.roomPeerIds || []).filter((p) => p !== m.id && m.peersCache?.[p]);
  };
  const send = (to, data) => { if (to && to !== id()) mp()?.sendTo(to, { type: 'town', ...data }); };
  const broadcast = (data) => { for (const p of peerIds()) send(p, data); };

  const start = async () => {
    const token = ++startToken;
    try {
      lastError = null;
      roomId = await withTimeout(findTownRoom(ctx.memberKey(), ctx.getPlayerName()), FIND_TIMEOUT_MS);
    } catch (e) {
      lastError = /permission/i.test(e?.message || '') ? 'Firebase permission denied for the town rooms'
        : /timeout/i.test(e?.message || '') ? 'the room server didn\'t answer' : (e?.message || 'unknown error');
      console.warn('[Town] no shared town:', e);
      return false;
    }
    if (token !== startToken || !roomId) return false;
    on = true;
    hostSeen = { id: null, since: 0 };
    console.info(`[Town] room ${roomId}`);
    ctx.startMultiplayer(`town-${roomId}`);
    return true;
  };
  const stop = () => {
    startToken += 1;
    if (!on) return;
    for (const pid of [...players.keys()]) dropPlayer(pid);
    heardAt.clear();
    on = false;
    roomId = null;
    ctx.stopMultiplayer();
  };

  // ── Other players ──
  const bladeOffsets = [new THREE.Vector3(0, 0, -0.1), new THREE.Vector3(0, 0, 0.3), new THREE.Vector3(0, 0, 0.65)];
  const playerFor = (pid) => {
    let p = players.get(pid);
    if (!p) {
      p = {
        id: pid, name: 'Player', url: null, stars: 0, coins: null, hp: null, maxHp: null, lastAt: Date.now(), blocking: false, sword: null,
        swordTarget: { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), has: false },
        hand: new THREE.Vector3(),
      };
      p.combat = {
        id: `town:${pid}`,
        center: new THREE.Vector3(),
        position: new THREE.Vector3(),
        bladePoints: bladeOffsets.map(() => new THREE.Vector3()),
        bladeDir: new THREE.Vector3(),
        blocking: false,
        hasBlade: false,
        onHit: (dmg, dir) => {
          send(pid, { op: 'pvp', dmg, dir: [round3(dir.x), round3(dir.z)] });
          ctx.onAttackPlayer?.({ id: pid, name: p.name, stars: p.stars });
        },
        onBlocked: () => send(pid, { op: 'pvpb' }),
      };
      players.set(pid, p);
    }
    return p;
  };
  const dropPlayer = (pid) => {
    const p = players.get(pid);
    if (!p) return;
    for (const m of [p.sword, p.wand, p.rod, p.gunMesh, p.shieldMesh]) m?.parent?.remove(m);
    players.delete(pid);
  };

  const handleMessage = (from, data) => {
    if (!on || !data || typeof data.op !== 'string') return;
    heardAt.set(from, Date.now());
    if (data.w) { ctx.onWorldMessage(from, data); return; }
    switch (data.op) {
      case 'pl': {
        const p = playerFor(from);
        p.lastAt = Date.now();
        if (typeof data.n === 'string') p.name = data.n.slice(0, 24);
        p.stars = Math.max(0, Math.min(3, Math.floor(Number(data.st) || 0)));
        // (coins / health: Settings → Town)
        const num = (v) => (Number.isFinite(v) ? Math.max(0, Math.round(v)) : null);
        p.coins = num(data.co);
        p.hp = num(data.hp);
        p.maxHp = num(data.mh);
        if (typeof data.c === 'string' && data.c !== p.url) {
          p.url = data.c;
          ctx.setRemoteCharacter(from, p.url);
          if (p.sword) { p.sword.parent?.remove(p.sword); p.sword = null; }
        }
        const s = data.s;
        if (s && isVec(s.p, 3) && isVec(s.q, 4)) {
          p.swordTarget.pos.fromArray(s.p);
          p.swordTarget.quat.fromArray(s.q).normalize();
          p.swordTarget.has = true;
        } else p.swordTarget.has = false;
        if (isVec(data.h, 3)) p.hand.fromArray(data.h);
        p.blocking = !!data.b;
        p.weapon = ['sword', 'gun', 'shield', 'wand', 'rod'].includes(data.w) ? data.w : null;
        return;
      }
      case 'pvp': {
        // (a bullet: where it came from, for a shield facing it)
        const ranged = data.k === 'gun' && isVec(data.src, 2) ? { kind: 'gun', src: data.src } : null;
        ctx.applyPvpHit(Math.max(1, Math.min(2, Math.round(Number(data.dmg) || 1))), isVec(data.dir, 2) ? data.dir : null, from, ranged);
        return;
      }
      // Another player's bomb / spell: drawn here, and this game checks whether it hit us
      case 'bomb':
        if (isVec(data.o, 3) && isVec(data.t, 3)) ctx.launchRemoteBomb(new THREE.Vector3().fromArray(data.o), new THREE.Vector3().fromArray(data.t), from);
        return;
      case 'magic':
        if (isVec(data.o, 3) && isVec(data.f, 3) && isVec(data.l, 3)) {
          ctx.spawnRemoteMagic({
            origin: new THREE.Vector3().fromArray(data.o), forward: new THREE.Vector3().fromArray(data.f),
            line: new THREE.Vector3().fromArray(data.l), element: data.e === 'ice' ? 'ice' : 'fire', caster: from,
          });
        }
        return;
      // Our bomb / spell hurt them (their game said so): the attacker's crime, as for a blow
      case 'hurt': {
        const p = players.get(from);
        ctx.onAttackPlayer?.({ id: from, name: p?.name ?? 'Player', stars: Math.max(0, Math.floor(Number(data.st) || 0)) });
        return;
      }
      case 'pvpb':
        ctx.onSwingBlocked();
        return;
      case 'bounty': {
        const coins = Math.max(0, Math.min(200, Math.floor(Number(data.coins) || 0)));
        if (coins) ctx.onBounty(players.get(from)?.name ?? 'Someone', coins);
        return;
      }
      default:
    }
  };

  const update = () => {
    if (!on) return;
    const now = Date.now();
    // (the host the town waits on: settled once it hasn't changed for a moment)
    const h = hostId();
    if (h !== hostSeen.id) hostSeen = { id: h, since: now };
    const peers = new Set(peerIds());
    for (const pid of [...players.keys()]) {
      if (!peers.has(pid) || now - players.get(pid).lastAt > PLAYER_TIMEOUT_MS) dropPlayer(pid);
    }
    if (now - plSentAt >= PL_SEND_MS && peers.size) {
      plSentAt = now;
      const st = ctx.getLocalSwordState() || {};
      const me = ctx.getStatus?.() ?? {};
      broadcast({
        op: 'pl', n: ctx.getPlayerName(), c: ctx.getLocalCharacterUrl(), st: ctx.getStars(),
        s: st.sword ?? null, h: st.hand ?? null, b: st.blocking ? 1 : 0, w: ctx.getLocalWeapon(),
        co: me.coins, hp: me.hp, mh: me.maxHp,
      });
    }
    for (const p of players.values()) {
      const model = ctx.getRemoteModel(p.id);
      if (!model) continue;
      // Gun / shield: on their weapon hand, both hands on its grip (as they hold it)
      if (p.gearModel !== model && (p.weapon === 'gun' || p.weapon === 'shield')) attachGear(p, model);
      const held = p.gearModel === model ? p.weapon : null;
      if (p.gunMesh) p.gunMesh.visible = held === 'gun';
      if (p.shieldMesh) p.shieldMesh.visible = held === 'shield';
      const grip = held === 'gun' ? p.gripGun : held === 'shield' ? p.gripShield : null;
      // (hands on a weapon only while they hold one — otherwise their arms hang / walk as on their screen)
      model.userData.remoteArmed = !!grip || p.swordTarget.has;
      model.userData.remoteHandTarget = grip ?? p.hand;
      // Sword (or the wand / fishing rod, held the same way) where their game says it is
      const wand = p.weapon === 'wand';
      const rod = p.weapon === 'rod';
      if (!p.sword) {
        p.sword = ctx.createSwordMesh(p.url);
        if (p.sword) ctx.scene.add(p.sword);
      }
      if (wand && !p.wand) {
        p.wand = ctx.createWandMesh();
        if (p.wand) ctx.scene.add(p.wand);
      }
      if (rod && !p.rod) {
        p.rod = ctx.createRodMesh?.() ?? null;
        if (p.rod) ctx.scene.add(p.rod);
      }
      const show = model.visible && p.swordTarget.has;
      if (p.sword) p.sword.visible = show && !(wand && p.wand) && !(rod && p.rod);
      if (p.wand) p.wand.visible = show && wand;
      if (p.rod) p.rod.visible = show && rod;
      const blade = p.wand?.visible ? p.wand : p.rod?.visible ? p.rod : p.sword?.visible ? p.sword : null;
      p.blade = blade;
      if (blade) {
        blade.position.copy(p.swordTarget.pos);
        model.updateMatrixWorld();
        model.localToWorld(blade.position);
        blade.quaternion.copy(model.quaternion).multiply(p.swordTarget.quat);
      }
    }
  };
  // The gun and shield models on another player's model (the battles' way — ctx.getWeaponGear)
  const attachGear = (p, model) => {
    const gear = ctx.getWeaponGear();
    if (!gear) return; // (models still loading: next frame)
    p.gunMesh?.parent?.remove(p.gunMesh);
    p.shieldMesh?.parent?.remove(p.shieldMesh);
    // (the floating hand the player's own weapon goes on — labels are mirrored)
    const hand = model.children.find((child) => child.userData?.proceduralHand === 'left');
    const place = (kind) => {
      const g = gear[kind];
      const mesh = g.createMesh();
      mesh.position.copy(g.offset);
      if (!hand) mesh.position.add(g.grip);
      mesh.quaternion.copy(g.quaternion);
      mesh.visible = false;
      (hand || model).add(mesh);
      return mesh;
    };
    p.gripGun = gear.gun.grip.clone();
    p.gripShield = gear.shield.grip.clone();
    p.gunMesh = place('gun');
    p.shieldMesh = place('shield');
    p.gearModel = model;
  };

  // Everyone a bullet can stop at (projectiles.js pvpTargets): our own shots hurt them
  const shotTargets = new Map();
  const getShotTargets = () => {
    const out = [];
    for (const p of players.values()) {
      const model = ctx.getRemoteModel(p.id);
      if (!model?.visible) continue;
      let t = shotTargets.get(p.id);
      if (!t) {
        t = {
          id: p.id,
          position: null,
          onHit: (shooterId, dir) => {
            if (shooterId !== id()) return; // (someone else's shot, drawn here)
            const me = ctx.getLocalPosition();
            send(p.id, { op: 'pvp', dmg: 1, k: 'gun', dir: [round3(dir.x), round3(dir.z)], src: [round3(me.x), round3(me.z)] });
            ctx.onAttackPlayer?.({ id: p.id, name: p.name, stars: p.stars });
          },
        };
        shotTargets.set(p.id, t);
      }
      t.position = model.position;
      out.push(t);
    }
    return out;
  };

  // Everyone the local sword can hit (the duel opponent's shape — see _getPvpTargets)
  const getPvpTargets = () => {
    const out = [];
    for (const p of players.values()) {
      const model = ctx.getRemoteModel(p.id);
      if (!model?.visible) continue;
      const c = p.combat;
      c.position.copy(model.position);
      c.center.copy(model.position);
      c.center.y += 0.8;
      const blade = p.blade;
      c.hasBlade = !!blade?.visible && p.weapon !== 'rod'; // (a fishing rod blocks nothing)
      if (c.hasBlade) {
        bladeOffsets.forEach((o, i) => c.bladePoints[i].copy(o).applyQuaternion(blade.quaternion).add(blade.position));
        c.bladeDir.set(0, 0, 1).applyQuaternion(blade.quaternion);
      }
      c.blocking = p.blocking;
      out.push(c);
    }
    return out;
  };

  return {
    start,
    stop,
    update,
    handleMessage,
    getPvpTargets,
    getShotTargets,
    isOn: () => on,
    id,
    hostId,
    isHost: () => !!mp()?.isHost,
    // The room has a host that's held for a moment (the town can start)
    ready: () => !!(on && id() && hostSeen.id && Date.now() - hostSeen.since >= SETTLE_MS),
    peerIds,
    roomId: () => roomId,
    lastError: () => lastError,
    // Why the room's host hasn't sent the town (a failed join's message)
    joinTrouble: () => {
      if (!on) return lastError ?? 'the room wasn\'t found';
      if (!id()) return 'the multiplayer connection didn\'t start';
      const h = hostId();
      if (!h) return 'no host in the room';
      if (!mp()?.connections?.[h]?.open) return 'couldn\'t connect to the host player\'s game — the network may block peer-to-peer';
      if (!heardAt.has(h)) return 'the host player\'s game didn\'t answer — its tab may be in the background';
      return 'the town didn\'t arrive from the host';
    },
    canSave: () => !!ctx.profileKey(),
    send,
    broadcast,
    loadRoomState: () => (roomId ? loadTownRoomState(roomId) : Promise.resolve(null)),
    saveRoomState: (state) => { if (roomId) void saveTownRoomState(roomId, state); },
    acceptsPresenceFrom: (pid) => on && peerIds().includes(pid),
    getCharacterUrl: (pid) => players.get(pid)?.url ?? null,
    // ★★ after a wanted player's name
    nameSuffix: (pid) => { const s = players.get(pid)?.stars ?? 0; return s > 0 ? ` ${'★'.repeat(s)}` : ''; },
    playerName: (pid) => players.get(pid)?.name ?? null,
    // The other players here, as they last told us (Settings → Town)
    players: () => [...players.values()].map(({ id, name, stars, coins, hp, maxHp }) => ({ id, name, stars, coins, hp, maxHp })),
    playerCount: () => (on ? peerIds().length + 1 : 1),
    sendBounty: (to, coins) => send(to, { op: 'bounty', coins }),
    // Our bomb / spell — everyone draws it and checks it against themselves
    sendBomb: (origin, target) => broadcast({ op: 'bomb', o: origin.toArray().map(round3), t: target.toArray().map(round3) }),
    sendMagic: ({ origin, forward, line, element }) => broadcast({
      op: 'magic', o: origin.toArray().map(round3), f: forward.toArray().map(round3), l: line.toArray().map(round3), e: element,
    }),
    // A bomb / spell of theirs hurt us: tell them (their crime), with our stars
    sendHurt: (to, stars) => send(to, { op: 'hurt', st: stars }),
  };
}

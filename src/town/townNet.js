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
// players themselves: each sends `pl` (name, character, wanted stars, sword pose) a few times a
// second; their swords are drawn on their models and are hit targets for the local sword (PvP:
// the attacker detects the hit — `pvp` — the victim applies it); `bounty` pays whoever brought
// a wanted player down.

import * as THREE from 'three';
import { ref, get, set, update, remove, runTransaction } from 'firebase/database';
import { db } from '../core/firebase-init.js';

export const TOWN_ROOM_MAX = 15;
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

export const loadTownRoomState = async (roomId) => {
  try { return (await get(ref(db, `townRoomState/${roomId}`))).val(); } catch (_) { return null; }
};
export const saveTownRoomState = (roomId, state) => set(ref(db, `townRoomState/${roomId}`), state).catch(() => {});

// ctx: getMultiplayer(), startMultiplayer(roomId), stopMultiplayer(), profileKey(), memberKey(), getPlayerName(),
//   scene, getRemoteModel(id), setRemoteCharacter(id, url), createSwordMesh(url),
//   getLocalSwordState(), getLocalCharacterUrl(), getStars(), applyPvpHit(dmg, dir, fromId),
//   onSwingBlocked(), onAttackPlayer(info), onBounty(fromName, coins), onWorldMessage(from, data)
export function createTownNet(ctx) {
  let on = false;
  let roomId = null;
  let startToken = 0;
  let plSentAt = 0;
  let hostSeen = { id: null, since: 0 };
  let lastError = null;       // why there's no shared town (shown in the town's HUD)
  const players = new Map(); // peer id → { name, url, stars, swordTarget, hand, blocking, sword, lastAt, combat }

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
        id: pid, name: 'Player', url: null, stars: 0, lastAt: Date.now(), blocking: false, sword: null,
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
    p.sword?.parent?.remove(p.sword);
    players.delete(pid);
  };

  const handleMessage = (from, data) => {
    if (!on || !data || typeof data.op !== 'string') return;
    if (data.w) { ctx.onWorldMessage(from, data); return; }
    switch (data.op) {
      case 'pl': {
        const p = playerFor(from);
        p.lastAt = Date.now();
        if (typeof data.n === 'string') p.name = data.n.slice(0, 24);
        p.stars = Math.max(0, Math.min(3, Math.floor(Number(data.st) || 0)));
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
        return;
      }
      case 'pvp':
        ctx.applyPvpHit(Math.max(1, Math.min(2, Math.round(Number(data.dmg) || 1))), isVec(data.dir, 2) ? data.dir : null, from);
        return;
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
      broadcast({
        op: 'pl', n: ctx.getPlayerName(), c: ctx.getLocalCharacterUrl(), st: ctx.getStars(),
        s: st.sword ?? null, h: st.hand ?? null, b: st.blocking ? 1 : 0,
      });
    }
    for (const p of players.values()) {
      const model = ctx.getRemoteModel(p.id);
      if (!model) continue;
      model.userData.remoteHandTarget = p.hand;
      if (!p.sword) {
        p.sword = ctx.createSwordMesh(p.url);
        if (p.sword) ctx.scene.add(p.sword);
      }
      if (!p.sword) continue;
      p.sword.visible = model.visible && p.swordTarget.has;
      if (p.sword.visible) {
        p.sword.position.copy(p.swordTarget.pos);
        model.updateMatrixWorld();
        model.localToWorld(p.sword.position);
        p.sword.quaternion.copy(model.quaternion).multiply(p.swordTarget.quat);
      }
    }
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
      c.hasBlade = !!p.sword?.visible;
      if (c.hasBlade) {
        bladeOffsets.forEach((o, i) => c.bladePoints[i].copy(o).applyQuaternion(p.sword.quaternion).add(p.sword.position));
        c.bladeDir.set(0, 0, 1).applyQuaternion(p.sword.quaternion);
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
    isOn: () => on,
    id,
    hostId,
    isHost: () => !!mp()?.isHost,
    // The room has a host that's held for a moment (the town can start)
    ready: () => !!(on && id() && hostSeen.id && Date.now() - hostSeen.since >= SETTLE_MS),
    peerIds,
    roomId: () => roomId,
    lastError: () => lastError,
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
    playerCount: () => (on ? peerIds().length + 1 : 1),
    sendBounty: (to, coins) => send(to, { op: 'bounty', coins }),
  };
}

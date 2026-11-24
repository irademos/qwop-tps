// Town: a townsperson showing the player the way — the first day's guides (quests/firstDay.js,
// the `goal` beat in townQuests.js) and anything else that leads the player somewhere. Places (`at`):
//   dock      — the map's dock.glb nearest the middle: out to its far end (over the water)
//   fishSpot  — the signposted fishing spot
//   fire      — the town's campfire
//   guideWork — the guide's own work spot (a farmer's field: the nearest ripe crop)
//   tree      — a standing tree near the guide's work (a felled one's logs once it's down)
//   market    — in through the shop's door to its counter
//   stall     — behind a free market stall (the first one free)
//   point     — any spot (L.point = { x, z }): the sheriff's night defense start (townDefense.js)
// A lead L = { at, autoWalk, crumbs, leadAt, treeId, stallKey, stuck, resting, speed } (one per goal
// beat — townQuests.js keeps it): the guide walks to a spot by the goal (waiting when the player
// falls behind, fetching them when they wander off, a tip now and then once there — leadFrame), and
// with L.autoWalk the player is walked along behind them (the way they walked — crumbs), then up to
// the goal itself (walkFrame → ctx.autoWalk); the player's own joystick / WASD stops it, 🚶 Follow
// <name> / Walk me there (acts) starts it again.

import * as THREE from 'three';
import { firstName } from './townPeople.js';
import { RUN_SPEED, dist2, pickOf } from './townConfig.js';

const DOCK_RE = /(^|\/)dock\.glb$/i;
const DOCK_END_INSET = 0.9; // m in from a dock's far end the player is walked to
const LEAD_WAIT = 7;        // m — leading the way: further behind than this, they wait for the player
const LEAD_LOST = 26;       // m — further than this, they come back for them
const LEAD_SPEED = 2.6;     // m/s — a brisk walk while leading
const AUTO_WALK_SPEED = 3.2; // m/s the player is walked along at
const FOLLOW_STOP = 2.4;     // m behind the guide the walked-along player stops…
const FOLLOW_RESUME = 3.8;   // …and sets off again
const WALK_STUCK_S = 1.5;   // s getting no closer to a goal: that's as close as the player gets
const WALK_RESUME = 1.2;     // m past a goal's stop distance before walking on again
const CALL_EVERY_S = 8;     // s between "This way!"s
const TIP_EVERY_S = [22, 34];
const CALLS = ['This way, {name}!', 'Over here!', 'Keep up, {name}!', 'Come on — it\'s just along here.'];

const nearestOf = (list, p) => {
  let best = null;
  let bd = Infinity;
  for (const o of list) { const d = dist2(o.x, o.z, p.x, p.z); if (d < bd) { bd = d; best = o; } }
  return best;
};

export const newLead = (at, autoWalk) => ({
  at, autoWalk: !!autoWalk, crumbs: [], leadAt: null, treeId: null, stallKey: null,
  stuck: { d: Infinity, at: 0, gx: NaN, gz: NaN, blocked: false }, resting: false, speed: 0,
});

export function installTownGuide(T, ctx) {
  const P = () => T.layout.places;

  // ── The dock: { base: its shore end, end: a spot just in from its far end, dir, len, half } ──
  let dockCache;
  const dock = () => {
    if (dockCache !== undefined) return dockCache;
    dockCache = null;
    const C = P().center;
    const all = ctx.getMapObjects({ minX: -1e5, maxX: 1e5, minZ: -1e5, maxZ: 1e5 }).filter((o) => DOCK_RE.test(o.file));
    let bestD = Infinity;
    const v = new THREE.Vector3();
    for (const o of all) {
      const L = o.local;
      if (!L || L.isEmpty()) continue;
      const along = L.max.x - L.min.x >= L.max.z - L.min.z ? 'x' : 'z';
      const cx = (L.min.x + L.max.x) / 2;
      const cz = (L.min.z + L.max.z) / 2;
      const at = (k) => {
        v.set(along === 'x' ? (k ? L.max.x : L.min.x) : cx, L.max.y, along === 'z' ? (k ? L.max.z : L.min.z) : cz).applyMatrix4(o.matrix);
        return { x: v.x, z: v.z };
      };
      const a = at(1);
      const b = at(0);
      // (the far end is the one out over the water)
      const [far, near] = ctx.waterDepth(a.x, a.z) >= ctx.waterDepth(b.x, b.z) ? [a, b] : [b, a];
      const len = Math.hypot(far.x - near.x, far.z - near.z);
      if (len < 2) continue;
      const dir = { x: (far.x - near.x) / len, z: (far.z - near.z) / len };
      const side = new THREE.Vector3(along === 'x' ? cx : L.max.x, L.max.y, along === 'z' ? cz : L.max.z).applyMatrix4(o.matrix);
      const half = Math.max(0.4, Math.abs((side.x - (near.x + far.x) / 2) * -dir.z + (side.z - (near.z + far.z) / 2) * dir.x));
      const d = dist2(near.x, near.z, C.x, C.z);
      if (d >= bestD) continue;
      bestD = d;
      dockCache = { base: near, len, dir, half, end: { x: far.x - dir.x * DOCK_END_INSET, z: far.z - dir.z * DOCK_END_INSET } };
    }
    return dockCache;
  };
  const onDock = (D, p) => {
    const ax = p.x - D.base.x;
    const az = p.z - D.base.z;
    const t = ax * D.dir.x + az * D.dir.z;
    return t > -0.3 && t < D.len + 0.3 && Math.abs(ax * -D.dir.z + az * D.dir.x) < D.half + 0.3;
  };
  // The tree to fell (picked once; another once it's gone)
  const treeOf = (L, g) => {
    const keep = L.treeId != null ? T.treeInfo(L.treeId) : null;
    if (keep && (['standing', 'falling', 'lying'].includes(keep.state) || keep.logs.length)) return keep;
    const near = g?.work ?? T.playerPos();
    const t = T.standingTreeNear(near.x, near.z);
    L.treeId = t?.id ?? null;
    return t;
  };
  // The stall the player's shown to (the first free one — a seller may take it meanwhile)
  const stallOf = (L) => {
    const free = (st) => { const who = T.stallSeller(st.key); return !who || who.player; };
    if (T.stand) return T.stallByKey(T.stand.key);
    let st = L.stallKey ? T.stallByKey(L.stallKey) : null;
    if (!st || !free(st)) {
      const all = T.marketSpots();
      st = all.find((x) => !x.indoor && free(x)) ?? all.find(free) ?? null;
      L.stallKey = st?.key ?? null;
    }
    return st;
  };

  // Where its 📍 goes
  const marker = (L, g) => {
    const p = P();
    switch (L.at) {
      case 'guideWork': return g?.work ? { icon: '📍', x: g.work.x, z: g.work.z, h: 1.5 } : null;
      case 'fire': return { icon: '📍', ...p.fire, h: 1.9 };
      case 'dock': if (dock()) return { icon: '📍', ...dock().end, h: 1.5 }; // falls through
      case 'fishSpot': return p.fishSpot ? { icon: '📍', x: p.fishSpot.x, z: p.fishSpot.z, h: 1.5 } : null;
      case 'tree': {
        const t = treeOf(L, g);
        if (!t) return null;
        const log = t.state === 'standing' ? null : nearestOf(t.logs, T.playerPos());
        return log ? { icon: '📍', x: log.x, z: log.z, h: 1.1 } : { icon: '📍', x: t.x, z: t.z, h: 3 };
      }
      case 'market': return { icon: '📍', ...T.stalls.spot('shop', 'counter'), h: 1.6 };
      case 'stall': { const st = stallOf(L); return st ? { icon: '📍', ...st.keeper, h: 1.6 } : null; }
      case 'point': return L.point ? { icon: '📍', x: L.point.x, z: L.point.z, h: 1.5 } : null;
      default: return null;
    }
  };
  // Where the guide stands by the goal (picked once a lead)
  const leadSpot = (L, g) => {
    if (L.leadAt?.guideId === g.id) return L.leadAt;
    const p = P();
    let at = null;
    if (L.at === 'dock' && dock()) at = dock().base;
    else if (L.at === 'fishSpot' || L.at === 'dock') at = p.fishSpot;
    else if (L.at === 'tree') at = treeOf(L, g);
    else if (L.at === 'fire') at = p.fire;
    else if (L.at === 'guideWork') at = g.work;
    else if (L.at === 'market') at = p.rooms.shop?.door ?? null;
    else if (L.at === 'point') at = L.point ?? null;
    else if (L.at === 'stall') {
      const st = stallOf(L);
      if (st) { L.leadAt = { guideId: g.id, x: st.customer.x, z: st.customer.z, gx: st.x, gz: st.z }; return L.leadAt; }
    }
    if (!at) return null;
    const spot = T.randomNear(at.x, at.z, 2.2);
    L.leadAt = { guideId: g.id, x: spot.x, z: spot.z, gx: at.x, gz: at.z };
    return L.leadAt;
  };

  // ── The guide's frame while leading (true: handled) ──
  const walkTo = (n, t, x, z, speed, dt) => {
    if (!n.path || T.simT > (t.replanAt ?? 0) || dist2(x, z, t.tx ?? 1e9, t.tz ?? 1e9) > 1) {
      T.planPath(n, x, z);
      t.tx = x;
      t.tz = z;
      t.replanAt = T.simT + 1.5;
    }
    T.stepPath(n, dt, speed * n.speedScale);
  };
  const stand = (n, x, z, dt) => {
    n.moving = false;
    n.path = null;
    T.faceToward(n, x, z, dt);
  };
  const leadFrame = (n, L, dt, { tips = null, fill = (s) => s } = {}) => {
    const t = (L.frame ??= {});
    const p = T.playerPos();
    const pRoom = T.rooms.roomAt(p.x, p.z);
    const sameRoom = !!pRoom && pRoom === T.rooms.roomAt(n.x, n.z);
    // (the player indoors: met at the door outside)
    const meet = pRoom && !sameRoom ? P().rooms[pRoom].door : p;
    const dMeet = dist2(n.x, n.z, meet.x, meet.z);
    const say = (lines) => { if (n.body && !n.bubble) T.say(n, fill(pickOf(lines))); };
    const spot = leadSpot(L, n);
    if (!spot) { stand(n, p.x, p.z, dt); return true; }
    // (the way they walk — the player, walked along, follows it)
    const last = L.crumbs[L.crumbs.length - 1];
    if (!T.rooms.roomAt(n.x, n.z) && (!last || dist2(last.x, last.z, n.x, n.z) > 1)) {
      L.crumbs.push({ x: n.x, z: n.z });
      if (L.crumbs.length > 80) L.crumbs.shift();
    }
    const dSpot = dist2(n.x, n.z, spot.x, spot.z);
    const pSpot = dist2(meet.x, meet.z, spot.x, spot.z);
    if (dMeet > LEAD_LOST) walkTo(n, t, meet.x, meet.z, RUN_SPEED, dt);
    else if (dSpot > 1 && dMeet > LEAD_WAIT && dSpot < pSpot) {
      stand(n, p.x, p.z, dt);
      if (T.simT > (t.callAt ?? 0)) { t.callAt = T.simT + CALL_EVERY_S; say(CALLS); }
    } else if (dSpot > 1) walkTo(n, t, spot.x, spot.z, dSpot > pSpot + 4 ? RUN_SPEED : LEAD_SPEED, dt);
    else {
      stand(n, dMeet < 12 ? p.x : spot.gx, dMeet < 12 ? p.z : spot.gz, dt);
      if (!t.arrived) { t.arrived = true; t.tipAt = T.simT + 3; if (dMeet < 12) say(['Here we are!', 'This is the place.']); }
      if (tips?.length && dMeet < 12 && T.simT > (t.tipAt ?? 0)) {
        t.tipAt = T.simT + TIP_EVERY_S[0] + Math.random() * (TIP_EVERY_S[1] - TIP_EVERY_S[0]);
        say(tips);
      }
    }
    return true;
  };
  // Leading at all: a lead, a place and (if there's one) the guide still about
  const leading = (L, g) => !!g?.alive && !!L.at && !!leadSpot(L, g);

  // ── The player walked along ──
  const busy = () => T.jobTalk.isOpen() || T.storage.isOpen() || T.fishing || T.cooking
    || T.sequence || T.jail || T.stalls.focused() || T.lockpick.isOpen() || ctx.isPlayerDead() || T.law.stars > 0;
  // Where to walk the player now: { x, z, stop, behind? } (null: nowhere / there)
  const walkTarget = (L, g) => {
    if (!L.at) return null;
    const p = P();
    const pos = T.playerPos();
    const inRoom = T.inRoom;
    let goal = null;
    if (L.at === 'market') {
      if (inRoom === 'shop') goal = { ...T.stalls.spot('shop', 'counter'), stop: 2.2 };
      else if (!inRoom && p.rooms.shop) {
        // (just past the door's spot, toward the house: walking there goes in — walkInDoor)
        const r = p.rooms.shop;
        goal = { x: r.door.x - Math.sin(r.exitYaw) * 0.6, z: r.door.z - Math.cos(r.exitYaw) * 0.6, stop: 0.05 };
      }
    } else if (inRoom) return null;
    else if (L.at === 'stall') {
      if (T.stand) return null;
      const st = stallOf(L);
      if (!st) return null;
      goal = { x: st.keeper.x, z: st.keeper.z, stop: 0.3 };
    } else if (L.at === 'dock' && dock()) {
      const D = dock();
      goal = onDock(D, pos) ? { ...D.end, stop: 0.25 } : { x: D.base.x + D.dir.x * 0.4, z: D.base.z + D.dir.z * 0.4, stop: 0.35 };
    } else if ((L.at === 'fishSpot' || L.at === 'dock') && p.fishSpot) goal = { x: p.fishSpot.x, z: p.fishSpot.z, stop: 1.5 };
    else if (L.at === 'tree') {
      const t = treeOf(L, g);
      if (!t) return null;
      if (t.state === 'standing') goal = { x: t.x, z: t.z, stop: 1.15 };
      else {
        const log = nearestOf(t.logs, pos);
        if (!log) return null;
        goal = { x: log.x, z: log.z, stop: 0.9 };
      }
    } else if (L.at === 'fire') goal = { x: p.fire.x, z: p.fire.z, stop: 1.9 };
    else if (L.at === 'point' && L.point) goal = { x: L.point.x, z: L.point.z, stop: 0.8 };
    else if (L.at === 'guideWork' && g?.work) {
      const ripe = (g.work.crops ?? []).filter((c) => c.ripe)
        .sort((a, b) => dist2(a.x, a.z, pos.x, pos.z) - dist2(b.x, b.z, pos.x, pos.z))[0];
      goal = ripe ? { x: ripe.x, z: ripe.z, stop: 0.8 } : { x: g.work.x, z: g.work.z, stop: 1.5 };
    }
    if (!goal) return null;
    // Behind the guide while they're still on the way (and the player's further from the goal)
    if (((g?.questing && g.qmode?.kind === 'lead') || g?.task?.type === 'defend') && !inRoom && L.leadAt && dist2(g.x, g.z, L.leadAt.x, L.leadAt.z) > 1.5
      && dist2(pos.x, pos.z, goal.x, goal.z) > dist2(g.x, g.z, goal.x, goal.z)) {
      let k = -1;
      let best = Infinity;
      L.crumbs.forEach((c, i) => { const d = dist2(c.x, c.z, pos.x, pos.z); if (d < best) { best = d; k = i; } });
      if (k >= 0) L.crumbs.splice(0, best < 1.2 ? k + 1 : k);
      return L.crumbs[0] ? { x: L.crumbs[0].x, z: L.crumbs[0].z, stop: 0.3, behind: g } : { x: g.x, z: g.z, stop: 2.2 };
    }
    return goal;
  };
  const walkFrame = (L, g, dt) => {
    if (!L.autoWalk) return;
    if (ctx.isSteering()) { L.autoWalk = false; T.actsAt = 0; return; }
    if (busy()) return;
    const tgt = walkTarget(L, g);
    if (!tgt) return;
    const p = T.playerPos();
    const d = dist2(p.x, p.z, tgt.x, tgt.z);
    // Stopped once close enough, off again only past a margin; behind the guide, eased down near them
    const gap = tgt.behind ? dist2(p.x, p.z, tgt.behind.x, tgt.behind.z) : Infinity;
    const st = L.stuck;
    if (!tgt.behind) {
      if (!(dist2(tgt.x, tgt.z, st.gx, st.gz) <= 0.6)) L.stuck = { d, at: T.simT, gx: tgt.x, gz: tgt.z, blocked: false };
      else if (st.blocked) { L.speed = 0; return; }
      else if (d < st.d - 0.15) { st.d = d; st.at = T.simT; }
      else if (d > tgt.stop && T.simT - st.at > WALK_STUCK_S) { st.blocked = true; L.resting = true; L.speed = 0; return; }
    }
    if (L.resting) {
      if (tgt.behind ? gap < FOLLOW_RESUME : d <= tgt.stop + WALK_RESUME) return;
      L.resting = false;
    }
    if (gap < FOLLOW_STOP || d <= tgt.stop) { L.resting = true; L.speed = 0; return; }
    const ease = Math.min(1, (gap - FOLLOW_STOP) / (FOLLOW_RESUME - FOLLOW_STOP + 1.5), (d - tgt.stop) / 1.2 + 0.3);
    const want = AUTO_WALK_SPEED * Math.max(0.35, ease);
    L.speed += (want - L.speed) * Math.min(1, dt * 4);
    ctx.autoWalk((tgt.x - p.x) / d, (tgt.z - p.z) / d, Math.min(L.speed * dt, d - tgt.stop + 0.02), dt);
  };
  // 🚶 Follow <name> / Walk me there (walking themselves stopped it)
  const acts = (L, g) => {
    if (L.autoWalk || busy()) return [];
    const tgt = walkTarget(L, g);
    if (!tgt) return [];
    const p = T.playerPos();
    if (dist2(p.x, p.z, tgt.x, tgt.z) <= tgt.stop + 1) return [];
    const following = g?.qmode?.kind === 'lead' || (!!g?.alive && g.task?.type === 'defend');
    return [{ key: 'introwalk', label: following ? `Follow ${firstName(g.name)}` : 'Walk me there', onClick: () => { L.autoWalk = true; T.actsAt = 0; L.stuck.gx = NaN; } }];
  };

  T.guide = { dock, marker, leadFrame, leading, walkFrame, walkTarget, acts, stall: stallOf, tree: treeOf, LEAD_WAIT };
}

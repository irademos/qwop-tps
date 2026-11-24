// Town: townsfolk fighting beside the player — allies. Reusable by anything that has the player
// fight with townsfolk at their side: the sheriff in the night defense (townDefense.js), the
// wizard in his son's job (the `wave` / `ambush` beats — townQuests.js). Story could install it on
// its stand-in too.
//
//   T.allyJoin(n, opts)  — n fights beside the player until T.allyLeave(n). opts:
//     hp           hits they take (default ALLY_HP)
//     attack       'wand' (fire / ice blasts — ctx.castAllySpell) | 'bow' (arrows — ctx.allyShoot)
//     lowHp        { at: hits left, then: 'flee' | 'retreat', line } — what they do once that hurt:
//                  'flee' — out of the fight (onFlee(n), else T.decide), foes stop going for them;
//                  'retreat' — keep further back, still attacking
//     onDown(n)    at 0 hits (default: knocked down, out of the fight)
//     onFlee(n)    (with lowHp 'flee')
//     shouts       lines now and then as they attack ({name} = the player's)
//     drive        true (default): this module runs their frame — a townsperson's task 'ally'
//                  (townReactions.js); false: the caller does and calls T.allyFrame(n, dt) (a job's
//                  cast member — townQuests.js' 'fight' qmode)
//   T.allyFrame(n, dt)   — beside the player, a little way out (on whichever side they're on),
//                  keeping off the nearest foe, attacking it from range
//   T.allyTargetFor(foe) — for a foe (bootstrapGameApp.js sets it as a plain swordsman's
//                  questTarget): the ally it goes for, or null (→ the player). Each foe rolls once
//                  (ASSIGN_CHANCE, at most PER_ALLY on an ally); one that's fled / down is let go.
//   T.allyAssign(foe, n) — that foe goes for n (a job's ambush: `onAlly`)
//
// Who hurts whom: allies can't hurt each other. The player's sword / arrows / wand blasts / bombs
// don't hit an ally (`n.ally` — skipped like a job's cast in townMode trySwordHit / townTrade's
// weapon targets) — none of those hurt the player either; an ally's blasts / arrows hit only the
// fight's foes (`_fightFoe` — side 'ally', ctx.allyShoot). Foes hurt them (allyHit).
// Foes are ctx.fightFoes() — EnemyPlayers etc. the game spawned (a wave, an ambush).

import * as THREE from 'three';
import { glbCharacterConfig } from '../models/glbCharacterModel.js';
import { createBowMesh } from '../items/bowModel.js';
import { RUN_SPEED, WALK_SPEED, dist2, pickOf } from './townConfig.js';

export const ALLY_HP = 8;
const SIDE_DIST = 3.2;        // m out to the player's side (across the way to the foes)
const BACK_DIST = 1.0;        // m back from the player (away from the foes)
const KEEP_MIN = 3.6;         // m they'd like to keep off the nearest foe…
const KEEP_RETREAT = 7.5;     // …hurt and retreating
const KEEP_PUSH = 1.6;        // m at most their spot gives way to a foe (a foe after them still gets to them)…
const KEEP_PUSH_RETREAT = 5;  // …retreating
const NEAR_FOES = 25;         // m — foes further from the player than this don't set the sides
const STAND_GROUND = 3.2;     // m — a foe after them this near: they stand and fight it (not retreating)
const SPOT_SLACK = 1.1;       // m from their spot: close enough, they stand and fight
const CATCH_UP = 8;           // m off their spot: running at the most (CATCH_UP_SPEED×) — the player auto-walks
const CATCH_UP_SPEED = 1.9;
const ATTACK_RANGE = 16;      // m
const ATTACK_S = { wand: [2, 3], bow: [2.4, 3.4] }; // s between attacks
const SHOUT_CHANCE = 0.25;
const ASSIGN_CHANCE = 0.45;   // a plain swordsman near an ally (ASSIGN_DIST, nearer them than the player) going for them…
const ASSIGN_DIST = 7;        // m
const PER_ALLY = 2;           // …at most this many on one ally
const HIT_RADIUS = 1.0;       // m — a foe's sword tip this near an ally's middle hits (EnemyPlayer targetHitRadius: they stop
                              // a step off a townsperson's body, its tip short of the player's 0.55)

export function installTownAllies(T, ctx) {
  const allies = new Map(); // id → A
  const _v = new THREE.Vector3();
  const playerName = () => ctx.getPlayerName?.() ?? '';
  const say = (n, line) => line && T.say(n, line.replace('{name}', playerName()), { big: true });
  const liveFoes = () => ctx.fightFoes?.() ?? [];
  const up = (A) => A && !A.fled && !A.down && A.n.alive && A.hp > 0;

  // ── Joining / leaving ──
  const allyJoin = (n, opts = {}) => {
    if (!n?.alive) return null;
    const hp = opts.hp ?? ALLY_HP;
    const A = {
      n, hp, maxHp: hp, attack: opts.attack ?? 'wand', lowHp: opts.lowHp ?? null, onDown: opts.onDown ?? null,
      onFlee: opts.onFlee ?? null, shouts: opts.shouts ?? [], drive: opts.drive !== false,
      // (which side of the player: the other side from an ally already there)
      side: [...allies.values()].filter(up).reduce((s, o) => s - o.side, 1) >= 0 ? 1 : -1,
      attackAt: T.simT + 1 + Math.random(), low: false, fled: false, down: false, bow: null, mv: {},
    };
    allies.set(n.id, A);
    n.ally = true;
    n.following = false;
    n.inside = false;
    T.clearTalk?.(n);
    if (A.drive) T.setTask(n, { type: 'ally', dur: Infinity });
    return A;
  };
  const dropBow = (A) => {
    if (!A.bow) return;
    A.bow.removeFromParent();
    A.bow = null;
  };
  const allyLeave = (n, { decide = true } = {}) => {
    const A = n && allies.get(n.id);
    if (!A) return;
    allies.delete(n.id);
    dropBow(A);
    n.ally = false;
    if (A.drive && n.task?.type === 'ally') { n.task = null; if (decide && n.alive) T.decide(n); }
  };
  const allyLeaveAll = (opts) => { for (const A of [...allies.values()]) allyLeave(A.n, opts); };

  // ── Moving: the nav path, else straight there ──
  // (far: faster, up to CATCH_UP_SPEED× a run)
  const move = (A, x, z, dt, run, far = 0) => {
    const n = A.n;
    const m = A.mv;
    const boost = 1 + (CATCH_UP_SPEED - 1) * Math.min(1, Math.max(0, far));
    const speed = (run ? RUN_SPEED * boost : WALK_SPEED * 1.4) * (n.speedScale ?? 1);
    if (!n.path || n.pathI >= n.path.length || T.simT > (m.replanAt ?? 0) || dist2(x, z, m.tx ?? 1e9, m.tz ?? 1e9) > 2.25) {
      T.planPath(n, x, z);
      m.tx = x;
      m.tz = z;
      m.replanAt = T.simT + 1;
      m.direct = !n.path?.length;
    }
    if (!m.direct) { T.stepPath(n, dt, speed); return; }
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

  // ── The frame ──
  // Beside the player: across the way to the foes (or the way they face), a step back from them,
  // kept off the nearest foe; the nearest foe in range attacked
  const allyFrame = (n, dt) => {
    const A = allies.get(n.id);
    if (!A || !up(A)) { stand(n); return true; }
    const p = T.playerPos();
    const foes = liveFoes();
    let foe = null;
    let fd = Infinity;     // (the nearest foe to the ally)
    let other = null;
    let od = Infinity;     // (… of those not after them — the ones they give way to)
    let mine = false;      // (one after them close by: they stand their ground)
    let pf = null;
    let pd = Infinity;     // (… to the player)
    for (const e of foes) {
      const q = e.group.position;
      const d = dist2(n.x, n.z, q.x, q.z);
      if (d < fd) { fd = d; foe = e; }
      if (e._allyId === n.id) { if (d < STAND_GROUND * STAND_GROUND) mine = true; } else if (d < od) { od = d; other = e; }
      const dp = dist2(p.x, p.z, q.x, q.z);
      if (dp < pd) { pd = dp; pf = e; }
    }
    // (the way "forward": toward the foes near the player, else the way the player faces)
    let fx;
    let fz;
    if (pf && pd < NEAR_FOES * NEAR_FOES) {
      fx = pf.group.position.x - p.x;
      fz = pf.group.position.z - p.z;
    } else {
      const yaw = ctx.getPlayerYaw?.() ?? 0;
      fx = Math.sin(yaw);
      fz = Math.cos(yaw);
    }
    const fl = Math.hypot(fx, fz) || 1;
    fx /= fl;
    fz /= fl;
    // (to the side: across the forward way)
    let sx = p.x + fz * SIDE_DIST * A.side - fx * BACK_DIST;
    let sz = p.z - fx * SIDE_DIST * A.side - fz * BACK_DIST;
    // (kept off the nearest foe to that spot)
    const retreat = A.low && A.lowHp?.then === 'retreat';
    const keep = retreat ? KEEP_RETREAT : KEEP_MIN;
    // (retreating: away from any of them, theirs too)
    const away = retreat ? foe : other;
    if (away) {
      const q = away.group.position;
      const dx = sx - q.x;
      const dz = sz - q.z;
      const d = Math.hypot(dx, dz);
      if (d < keep) {
        // (given way, but only so far: they stay at the player's side)
        const push = Math.min(keep - d, retreat ? KEEP_PUSH_RETREAT : KEEP_PUSH);
        sx += d > 0.01 ? (dx / d) * push : -fx * push;
        sz += d > 0.01 ? (dz / d) * push : -fz * push;
      }
    }
    if (!T.walkable(sx, sz)) { sx = p.x - fx * 1.5; sz = p.z - fz * 1.5; }
    const ds = Math.hypot(sx - n.x, sz - n.z);
    const attacking = foe && fd < ATTACK_RANGE * ATTACK_RANGE;
    if (mine && !retreat && ds < CATCH_UP) stand(n, foe.group.position.x, foe.group.position.z, dt);
    else if (ds > SPOT_SLACK) move(A, sx, sz, dt, ds > 2, (ds - 2) / (CATCH_UP - 2));
    else if (attacking) stand(n, foe.group.position.x, foe.group.position.z, dt);
    else stand(n, p.x + fx * 5, p.z + fz * 5, dt);
    // (the attack: standing near their spot, or on the way if close)
    if (attacking && (ds < 4 || mine) && T.simT > A.attackAt) attack(A, foe);
    updateBow(A);
    return true;
  };

  const attack = (A, foe) => {
    const n = A.n;
    const [lo, hi] = ATTACK_S[A.attack] ?? ATTACK_S.wand;
    A.attackAt = T.simT + lo + Math.random() * (hi - lo);
    const q = foe.group.position;
    n.yaw = Math.atan2(q.x - n.x, q.z - n.z);
    const d = Math.hypot(q.x - n.x, q.z - n.z) || 1;
    const dir = { x: (q.x - n.x) / d, z: (q.z - n.z) / d };
    const y = T.groundY(n);
    if (A.attack === 'bow') {
      ctx.allyShoot?.({ x: n.x + dir.x * 0.5, y: y + 1.2, z: n.z + dir.z * 0.5 }, foe);
    } else {
      n.body?.character.playAction(glbCharacterConfig.throwClip);
      ctx.castAllySpell?.({ x: n.x + dir.x * 0.6, y: y + 0.95, z: n.z + dir.z * 0.6 }, dir);
    }
    if (A.shouts.length && Math.random() < SHOUT_CHANCE) say(n, pickOf(A.shouts));
  };

  // The sheriff's bow in his hand (nothing else for townsfolk bodies to hold)
  const updateBow = (A) => {
    if (A.attack !== 'bow') return;
    const body = A.n.body;
    if (!body) { dropBow(A); return; }
    if (!A.bow) {
      A.bow = createBowMesh();
      T.root.add(A.bow);
    }
    const ch = body.character;
    const at = ch.getPalmWorldPosition?.('left', _v) ?? _v.set(A.n.x, T.groundY(A.n) + 1, A.n.z);
    A.bow.position.copy(at);
    A.bow.rotation.set(0, A.n.yaw ?? 0, 0);
    A.bow.visible = body.container.visible !== false;
  };

  // ── Being hit (a foe's sword — allyTargetFor's onHit) ──
  const allyHit = (n, dir) => {
    const A = allies.get(n.id);
    if (!up(A)) return;
    A.hp -= 1;
    n.x += (dir?.x ?? 0) * 0.35;
    n.z += (dir?.z ?? 0) * 0.35;
    n.body?.character.playReaction?.(glbCharacterConfig.smallHitClip);
    ctx.playSfx?.('hit', { x: n.x, y: T.groundY(n) + 1, z: n.z });
    if (A.hp <= 0) {
      A.down = true;
      dropBow(A);
      if (A.onDown) A.onDown(n);
      else { n.body?.character.playDeath(); allyLeave(n); }
      return;
    }
    if (!A.low && A.lowHp && A.hp <= A.lowHp.at) {
      A.low = true;
      say(n, A.lowHp.line);
      if (A.lowHp.then === 'flee') {
        A.fled = true;
        const onFlee = A.onFlee;
        allyLeave(n, { decide: !onFlee });
        onFlee?.(n);
      }
    }
  };

  // ── Foes going for an ally ──
  const allyTargetFor = (foe) => {
    let A = foe._allyId != null ? allies.get(foe._allyId) : null;
    if (foe._allyId != null && !up(A)) { foe._allyId = null; A = null; } // (fled / down / gone: back to the player)
    if (!A && !foe._allyRolled && allies.size) {
      // (once it's come near an ally — nearer them than the player — it rolls once)
      const q = foe.group.position;
      const p = T.playerPos();
      const pd = dist2(q.x, q.z, p.x, p.z);
      const near = [...allies.values()].filter((o) => up(o) && o.n.body && dist2(q.x, q.z, o.n.x, o.n.z) < Math.min(pd, ASSIGN_DIST * ASSIGN_DIST));
      if (near.length) {
        foe._allyRolled = true;
        if (Math.random() < ASSIGN_CHANCE) {
          const counts = new Map();
          for (const e of liveFoes()) if (e._allyId != null) counts.set(e._allyId, (counts.get(e._allyId) ?? 0) + 1);
          const pick = near.filter((o) => (counts.get(o.n.id) ?? 0) < PER_ALLY)
            .sort((a, b) => (counts.get(a.n.id) ?? 0) - (counts.get(b.n.id) ?? 0))[0];
          if (pick) { foe._allyId = pick.n.id; A = pick; }
        }
      }
    }
    if (!A || !A.n.body) return null;
    const n = A.n;
    return { model: n.body.container, hitRadius: HIT_RADIUS, onHit: (_m, dir) => { allyHit(n, dir); return 'hit'; } };
  };
  const allyAssign = (foe, n) => {
    if (!foe || !n) return;
    foe._allyRolled = true;
    foe._allyId = n.id;
    foe.questTarget = () => allyTargetFor(foe);
  };

  // (a driven ally's task frame — townReactions.js updateSpecialTask 'ally')
  const updateAllyNpc = (n, t, dt) => {
    if (!allies.has(n.id)) { n.task = null; T.decide(n); return true; }
    return allyFrame(n, dt);
  };
  const resetAllies = () => allyLeaveAll({ decide: false });

  Object.assign(T, {
    allyJoin, allyLeave, allyLeaveAll, allyFrame, allyHit, allyTargetFor, allyAssign, updateAllyNpc, resetAllies,
    isAlly: (n) => !!n && allies.has(n.id),
    allyHp: (n) => allies.get(n?.id)?.hp ?? null,
    alliesDebug: () => [...allies.values()].map((A) => ({ name: A.n.name, hp: A.hp, low: A.low, fled: A.fled, down: A.down, attack: A.attack })),
  });
}

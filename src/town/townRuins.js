// Town: destroyed buildings. A building of the map (the wizard's cabin up the mountain) can be
// torn down — its placed GLB taken out of the world (ctx.setMapObjectGone: hidden, no ground /
// wall / cover any more) and a ruin put in its place (src/environment/ruins.js: a heap of dirt
// and logs, solid in its middle) — and built back up later. A job does it (the `ruin` beat —
// beats/scene.js): the bandits burning the wizard's cabin, the wizard rebuilding it with the
// logs the player brings up.
//
// Changes happen out of the player's sight (UNSEEN_DIST away, or indoors) so nothing pops in
// view; a rebuild can wait for a morning (`when: 'morning'` — the next day from WAKE_HOUR).
// Saved with the town's world (T.ruins — both the town of your own and a shared town's world
// snapshot); a shared town: `ruin` op to everyone (the host passes it on).
//
// What can be ruined (RUIN_TARGETS, by key): 'wizardCabin'. A house later: its key → the
// house's map object ({ object, x, z, radius }).
//
// T.ruinBuilding(key) / T.rebuildBuilding(key, { when }) / T.isRuined(key) / T.ruinObstacles()

import { createRuin, disposeRuin, ruinSeed } from '../environment/ruins.js';
import { WAKE_HOUR, dist2 } from './townConfig.js';

const UNSEEN_DIST = 45;   // m from the building the player is before it changes (unless indoors)
const CHECK_S = 1;

export function installTownRuins(T, ctx) {
  // key → { state: 'ruin' | 'ruined' | 'rebuild', day? } (saved); 'ruin' / 'rebuild' = waiting
  // to happen out of sight
  T.ruins = {};
  const shown = new Map();  // key → { group, target } — a ruin standing in the world now
  let checkAt = 0;

  const RUIN_TARGETS = {
    wizardCabin: () => {
      const c = T.layout?.places.wizard.cabin;
      return c?.object ? c : null;
    },
  };
  const targetOf = (key) => RUIN_TARGETS[key]?.() ?? null;

  // The world as T.ruins says: the ruin in, the building out (or back)
  const show = (key, on, refresh = true) => {
    const t = targetOf(key);
    if (!t) return;
    const have = shown.get(key);
    if (on && !have) {
      ctx.setMapObjectGone?.(t.object, true);
      const r = createRuin({ radius: t.radius, groundAt: (x, z) => T.groundAt(x, z, 0), x: t.x, z: t.z, seed: ruinSeed(key) });
      T.layout.props.group.add(r.group);
      shown.set(key, { group: r.group, obstacles: r.obstacles });
      if (refresh) refreshObstacles();
    } else if (!on && have) {
      disposeRuin(have.group);
      shown.delete(key);
      ctx.setMapObjectGone?.(t.object, false);
      if (refresh) refreshObstacles();
    }
  };
  const apply = () => { for (const key of Object.keys(RUIN_TARGETS)) show(key, T.ruins[key]?.state === 'ruined' || T.ruins[key]?.state === 'rebuild'); };
  const unseen = (key) => {
    if (T.inRoom || T.jail) return true;
    const t = targetOf(key);
    if (!t) return true;
    const p = T.playerPos();
    return dist2(p.x, p.z, t.x, t.z) > UNSEEN_DIST + t.radius;
  };
  const broadcast = (key) => {
    if (!T.mp?.() || !T.net) return;
    T.net.broadcast({ w: 1, op: 'ruin', k: key, s: T.ruins[key] ?? null });
  };

  // ── For a job ──
  const ruinBuilding = (key) => {
    if (!RUIN_TARGETS[key]) return;
    const r = T.ruins[key];
    if (r?.state === 'ruined' || r?.state === 'ruin') return;
    // (waiting to be rebuilt: it just stays a ruin)
    T.ruins[key] = r?.state === 'rebuild' ? { state: 'ruined' } : { state: 'ruin' };
    checkAt = 0;
    broadcast(key);
  };
  const rebuildBuilding = (key, { when = 'unseen' } = {}) => {
    const r = T.ruins[key];
    if (!r) return;
    if (r.state === 'ruin') { delete T.ruins[key]; broadcast(key); return; } // (never got torn down)
    T.ruins[key] = { state: 'rebuild', day: when === 'morning' ? T.clock.day + 1 : 0 };
    checkAt = 0;
    broadcast(key);
  };
  const isRuined = (key) => T.ruins[key]?.state === 'ruined' || T.ruins[key]?.state === 'rebuild';

  // ── Each frame (once a second): what's waiting happens, out of sight ──
  const updateRuins = () => {
    if (!T.ready || T.simT < checkAt) return;
    checkAt = T.simT + CHECK_S;
    for (const [key, r] of Object.entries(T.ruins)) {
      if (r.state === 'ruin' && unseen(key)) {
        r.state = 'ruined';
        show(key, true);
      } else if (r.state === 'rebuild' && (!r.day || T.clock.day > r.day || (T.clock.day === r.day && T.hour() >= WAKE_HOUR)) && unseen(key)) {
        delete T.ruins[key];
        show(key, false);
      }
    }
  };

  // ── Saves / a shared town ──
  const clean = (o) => {
    const out = {};
    if (!o || typeof o !== 'object') return out;
    for (const [k, v] of Object.entries(o)) {
      if (!RUIN_TARGETS[k] || !['ruin', 'ruined', 'rebuild'].includes(v?.state)) continue;
      out[k] = v.state === 'rebuild' ? { state: 'rebuild', day: Math.max(0, Math.floor(Number(v.day) || 0)) } : { state: v.state };
    }
    return out;
  };
  const ruinsSnapshot = () => ({ ruins: Object.keys(T.ruins).length ? { ...T.ruins } : undefined });
  // (a save's / a shared town's world: as it was — the ruin there at once, not waiting)
  // (live: a shared town's later full — what's waiting still waits, out of sight)
  const restoreRuins = (state, { live = false } = {}) => {
    T.ruins = clean(state?.ruins);
    if (!live) for (const r of Object.values(T.ruins)) if (r.state === 'ruin') r.state = 'ruined';
    apply();
  };
  const handleRuinNet = (from, d) => {
    if (d.op !== 'ruin') return false;
    if (!T.ready || !RUIN_TARGETS[d.k]) return true;
    const v = clean({ [d.k]: d.s })[d.k];
    if (v) T.ruins[d.k] = v; else delete T.ruins[d.k];
    checkAt = 0;
    if (T.netMode === 'host') for (const pid of T.net.peerIds()) if (pid !== from) T.net.send(pid, d);
    return true;
  };
  // Leaving Town: the map as it was (it's Showdown's too)
  const resetRuins = () => {
    for (const key of [...shown.keys()]) show(key, false, false);
  };
  const ruinObstacles = () => [...shown.values()].flatMap((s) => s.obstacles);
  // The town's solid props (obstacles.js — the player walks round them; a Rapier body for
  // enemies): the market stalls + the wizard's, the ruins' heaps, the parked cart (townCart.js) and the plots' planter boxes (townFarming.js)
  const refreshObstacles = () => {
    if (!T.layout) return;
    ctx.setPropObstacles?.([...T.stalls.obstacleBoxes(), ...ruinObstacles(), ...(T.cartObstacles?.() ?? []), ...(T.planterObstacles?.() ?? []), ...(T.cageObstacles?.() ?? [])]);
  };

  Object.assign(T, { ruinBuilding, rebuildBuilding, isRuined, updateRuins, ruinsSnapshot, restoreRuins, handleRuinNet, resetRuins, ruinObstacles, refreshObstacles });
}

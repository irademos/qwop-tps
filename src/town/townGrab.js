// Town: grabbing things with empty hands (✋ Hands — no weapon or rod out). Anything that can be
// picked up registers itself here (T.addGrabbable); near one, a single ✋ Grab <name> button
// shows (the nearest), and while something's in hand a single ✋ Drop <name> button (the phone's
// 🗡/✋ button drops it too — bootstrapGameApp.js). A grabbable can also take over the Block bar
// while it's held (`bar`: the bar's mode, e.g. the hose's 'water' — held down: use(true), let go:
// use(false)).
//
// A grabbable: { name, distance() → m (Infinity: not here), reach (m), grab() → false to refuse,
// drop({ quiet, keepConstraint }), bar?, use?(on) } — the hose (townFarming.js) for now.

// T: the town's shared state + functions (createTownMode in townMode.js); ctx: the game
export function installTownGrab(T, ctx) {
  const grabbables = [];
  T.held = null;              // the grabbable in hand

  const addGrabbable = (g) => { grabbables.push(g); return g; };
  const handsFree = () => !ctx.isPlayerArmed() && !ctx.isRodEquipped();
  const canGrab = () => T.active && T.ready && !T.held && !T.sequence && !T.jail && !T.inRoom && !ctx.isPlayerDead() && handsFree();
  // The nearest grabbable within its reach, or null
  const nearestGrabbable = () => {
    let best = null;
    let bd = Infinity;
    for (const g of grabbables) {
      const d = g.distance();
      if (d < g.reach && d < bd) { bd = d; best = g; }
    }
    return best;
  };
  const grab = (g) => {
    if (!canGrab() || g.grab() === false) return;
    T.held = g;
    ctx.refreshButtons?.();
    T.actsAt = 0;
  };
  // (quiet: no feed line; keepConstraint: something else has set the player's position
  // constraint since — a room, the jail)
  const dropHeld = (opts = {}) => {
    const g = T.held;
    if (!g) return;
    T.held = null;
    g.drop(opts);
    ctx.refreshButtons?.();
    T.actsAt = 0;
  };
  // One button: Drop while something's in hand, else Grab the nearest (empty hands only)
  const grabActs = () => {
    if (T.held) return [{ key: 'drop', label: `Drop ${T.held.name}`, onClick: () => dropHeld() }];
    const g = canGrab() ? nearestGrabbable() : null;
    return g ? [{ key: 'grab', label: `Grab ${g.name}`, onClick: () => grab(g) }] : [];
  };

  Object.assign(T, {
    addGrabbable, dropHeld, grabActs,
    heldBar: () => T.held?.bar ?? null,
    useHeld: (on) => T.held?.use?.(on),
  });
}

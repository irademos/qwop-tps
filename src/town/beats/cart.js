// Town's quest beats — The cart: brought round / loaded (cart, unload), held (lockCart), a passenger (board / alight), driven somewhere (drive).
// Part of townQuests.js' registry (beats/index.js): each beat type's hooks get the runner's
// context `c` (src/quest/questRunner.js); `W` is Town's quest world (townQuests.js).

export const cartBeats = (W) => {
  const { T, roleNpc, control, stand, fill, placeOf, cartAt, seat, unseat, cartState, firstName, dist2, BOARD_TIMEOUT_S } = W;
  return {
    // The cart: brought beside the player (bring), its load (load: 'veg' / null)
    cart: {
      start: (c) => {
        const { beat: b } = c;
        if ('load' in b) cartState.load = b.load ?? null;
        if (b.bring && !T.bringCart?.()) T.feedLine('The cart\'s by the market — get in it there.');
        return true;
      },
    },
    unload: { start: () => { if (cartState.load) T.feedLine('The cart\'s load is handed over.'); cartState.load = null; return true; } },
    lockCart: { start: (c) => { T.lockCart?.(!!c.beat.on); cartState.locked = !!c.beat.on; return true; } },
    // A townsperson climbs into the back of the cart (carried along, crouched in its bed)
    board: {
      start: (c) => { if (!cartAt()) T.bringCart?.(); c.s.t = 0; },
      update: (c, dt) => {
        const n = roleNpc(c.q, c.beat.who);
        c.s.n = n;
        if (!n) return false;
        if (n.qmode?.kind === 'seated') { c.q.failOnDown = true; return true; }
        if (T.cartFlipped?.() || !cartAt()) return false;
        c.s.t += dt;
        if (n.qmode?.kind !== 'board') control(n, 'board');
        if (c.s.t > BOARD_TIMEOUT_S) seat(n);
        return false;
      },
      entry: (c) => (T.cartFlipped?.() ? 'Wait for the cart to right itself' : c.s.n ? `${firstName(c.s.n.name)} is climbing into the cart` : null),
    },
    alight: {
      start: (c) => {
        const n = roleNpc(c.q, c.beat.who);
        if (n) { unseat(n); control(n, 'stand'); }
        c.q.failOnDown = false;
        return true;
      },
    },
    // Glowing arrows to a place; done once the cart's within r of it (with the player in it or by it)
    drive: {
      start: (c) => { c.s.planAt = 0; },
      update: (c) => {
        const { beat: b } = c;
        const to = placeOf(b.to);
        if (!to) return false;
        if (T.simT > c.s.planAt) { c.s.planAt = T.simT + 0.5; T.driveTo({ x: to.x, z: to.z, r: Math.min(4, b.r * 0.5) }); }
        const cp = cartAt();
        return !!cp && dist2(cp.x, cp.z, to.x, to.z) < b.r && (T.inCart() || T.distToPlayer(cp) < 5);
      },
      end: () => T.driveTo(null),
      entry: (c) => {
        const cp = cartAt();
        if (!T.inCart()) return cp && T.distToPlayer(cp) > 6 ? 'Back to the cart' : 'Get in the cart';
        return fill(c.beat.text, c.q);
      },
      marker: (c) => {
        const cp = !T.inCart() ? cartAt() : null;
        if (cp && T.distToPlayer(cp) > 6) return { icon: '📍', x: cp.x, z: cp.z, h: 1.6 };
        const to = placeOf(c.beat.to);
        return to ? { icon: '📍', x: to.x, z: to.z, h: 2.6 } : null;
      },
      highlight: () => (T.inCart() ? null : { act: 'cartin' }),
    },
  };
};

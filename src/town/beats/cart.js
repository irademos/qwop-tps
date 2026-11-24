// Town's quest beats — The cart: brought round / loaded (cart, unload), held (lockCart), a passenger (board / alight), driven somewhere (drive),
// filled with goods from the player's bag (cartGoods — the cart's store, townCart.js) and those goods taken (unloadGoods).
// Part of townQuests.js' registry (beats/index.js): each beat type's hooks get the runner's
// context `c` (src/quest/questRunner.js); `W` is Town's quest world (townQuests.js).

export const cartBeats = (W) => {
  const { T, roleNpc, control, stand, fill, placeOf, cartAt, seat, unseat, cartState, firstName, dist2, BOARD_TIMEOUT_S } = W;
  // (what a beat wants in the cart's store: { good: count } — short: the first good there isn't
  // enough of, { good, have, need })
  const shortOf = (need) => {
    for (const [good, n] of Object.entries(need ?? {})) {
      const have = T.cartHas?.(good) ?? 0;
      if (have < n) return { good, have, need: n };
    }
    return null;
  };
  const GOOD_WORD = { wood: 'wood', fish: 'fish', crops: 'veg' };
  return {
    // The cart's store filled from the player's bag (by the cart → Cart → Store): done once it
    // has `count` of `good` (gathered the usual way — chopping, fishing… — and loaded, a bagful
    // at a time). The cart's 📍 while the player's away from it; Cart ringed by it.
    cartGoods: {
      update: (c) => !shortOf({ [c.beat.good]: c.beat.count }),
      event: (c, kind) => kind === 'cartStore',
      entry: (c) => {
        const { beat: b } = c;
        const have = Math.min(b.count, T.cartHas?.(b.good) ?? 0);
        const carrying = T.goods?.[b.good] ?? 0;
        const what = GOOD_WORD[b.good] ?? b.good;
        const base = `${fill(b.text ?? `Fill the cart with ${what}`, c.q)}: ${have} / ${b.count}`;
        return carrying > 0 ? `${base} (load the ${carrying} you're carrying)` : base;
      },
      marker: (c) => {
        const cp = cartAt();
        if (!cp || T.inCart() || T.distToPlayer(cp) < 6 || !(T.goods?.[c.beat.good] > 0)) return null;
        return { icon: '📍', x: cp.x, z: cp.z, h: 1.6 };
      },
      highlight: (c) => {
        const cp = cartAt();
        if (T.storage?.isOpen()) return null;
        if (T.goods?.[c.beat.good] > 0) return cp && T.distToPlayer(cp) < 4 ? { act: 'cartstore' } : null;
        // (none carried: go and get some — the wood: the sword out, then Chop without a gyro)
        return c.beat.good === 'wood' && !T.inCart() ? W.goalHighlight('wood') : null;
      },
      icon: '🪵',
    },
    // The goods a job asked for taken out of the cart (short of them: back to `ifShort`'s label)
    unloadGoods: {
      start: (c) => {
        const { beat: b } = c;
        const short = shortOf({ [b.good]: b.count });
        if (short) {
          T.feedLine(`The cart's short — ${short.have} of ${short.need} ${GOOD_WORD[b.good] ?? b.good} in it.`);
          if (b.ifShort) c.goto(b.ifShort);
          return !b.ifShort;
        }
        T.takeFromCart?.(b.good, b.count);
        T.feedLine(b.text ? fill(b.text, c.q) : `Unloaded ${b.count} ${GOOD_WORD[b.good] ?? b.good} from the cart.`);
        return true;
      },
    },
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
      // (a cart a job held where it was is let go: it has to roll to get anywhere)
      start: (c) => { c.s.planAt = 0; T.lockCart?.(false); cartState.locked = false; },
      update: (c) => {
        const { beat: b } = c;
        const to = placeOf(b.to);
        if (!to) return false;
        // (a load it must carry — the wizard's logs: short of it, back to loading)
        if (b.need && shortOf(b.need)) { if (b.ifShort) c.goto(b.ifShort); return false; }
        if (T.simT > c.s.planAt) { c.s.planAt = T.simT + 0.5; T.driveTo({ x: to.x, z: to.z, r: Math.min(4, b.r * 0.5) }); }
        const cp = cartAt();
        const there = !!cp && dist2(cp.x, cp.z, to.x, to.z) < b.r && (T.inCart() || T.distToPlayer(cp) < 5);
        // (there: the cart held still till the next step's done — townQuests.js)
        if (there) W.arrive('cart');
        return there;
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

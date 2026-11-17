// Town: the cart (src/items/cart.js — the model and how it rolls). It's parked near where the
// player arrives (between the shop and the campfire — `places.spawn`), on the first spot round
// it where the whole cart fits (`findParking`). Walk up to it → Get in the cart (like the
// canoe): the player crouches in its bed (Crouch.fbx) and steers it by tilting the phone, like
// the broom but on the ground — tipped forward it rolls on, back it backs up, leaned left /
// right it turns (the joystick / WASD the same, the only way without a gyro). Whatever's in hand
// stays there and can be used (a gyro item stops the cart while it's out — as on the broom).
// Get out → the player steps down beside it, the cart stays there (back at its parking spot the
// next time Town opens). Dying / an arrest / a room / the canoe / leaving Town get them out too.
// No going into houses in it (townTrade.js — `ctx.isInCart`). Only the player's own: in a shared
// town the others don't see it (they'd see the player crouching as they go).

import { createCartRide } from '../items/cart.js';
import { CART_ACT_DIST, dist2 } from './townConfig.js';

const PARK_CLEARANCE = 1.1; // m from the cart's middle to a placed thing's bounds

// T: the town's shared state + functions (createTownMode in townMode.js); ctx: the game
export function installTownCart(T, ctx) {
  let ride = null;
  let home = null;            // { x, z, yaw } its parking spot
  let setupTried = false;

  // Its parking spot: round the player's arrival spot, the first pose it fits at — on the town's
  // walkable ground, clear of the map's placed things (lamp posts, trees, fences…)
  const findParking = () => {
    const sp = T.layout?.places.spawn;
    const fire = T.layout?.places.fire;
    if (!sp) return null;
    const R = 12;
    const objects = ctx.getMapObjects({ minX: sp.x - R - 6, maxX: sp.x + R + 6, minZ: sp.z - R - 6, maxZ: sp.z + R + 6 });
    const clear = (x, z) => T.layout.nav.isWalkable(x, z)
      && objects.every((o) => dist2(o.x, o.z, x, z) > Math.min(o.radius, 4) + PARK_CLEARANCE);
    // (pointing away from the fire — driving off into town)
    const away = fire ? Math.atan2(sp.x - fire.x, sp.z - fire.z) : 0;
    for (const r of [3.5, 4.5, 5.5, 7, 9, R]) {
      for (let k = 0; k < 16; k++) {
        const a = away + Math.PI / 2 + (k / 16) * Math.PI * 2;
        const x = sp.x + Math.sin(a) * r;
        const z = sp.z + Math.cos(a) * r;
        for (const yaw of [away, away + Math.PI / 2, away - Math.PI / 2]) {
          if (clear(x, z) && ride.fits(x, z, yaw)) return { x, z, yaw };
        }
      }
    }
    return null;
  };
  const setup = () => {
    ride = createCartRide({
      parent: T.layout.props.group,
      getControls: ctx.getControls,
      getPlayerModel: ctx.getPlayerModel,
      getGroundY: ctx.getGroundY,
      waterDepth: ctx.waterDepth,
      getTilt: ctx.getRideTilt,
      getSteer: ctx.getSteer,
      isHolding: ctx.isHoldingGyroItem,
      onHoldEnd: ctx.resetRideTilt,
      onBump: () => ctx.playSfx?.('thud', ctx.getPlayerPosition()),
    });
    home = findParking();
    if (!home) {
      ride.group.removeFromParent();
      ride = null;
      return;
    }
    ride.place(home.x, home.z, home.yaw);
  };

  const canBoard = () => !!ride && !ride.isRiding() && !ctx.isPlayerDead() && !T.sequence && !T.jail && !T.inRoom
    && !T.inCanoe() && !T.held && !T.fishing;
  const board = () => {
    if (!canBoard()) return;
    ctx.leaveBroom?.(); // (off the flying broom first: it lets go of the controls)
    ctx.resetRideTilt?.(); // (the phone's pose now is its rest — standing still)
    if (!ride.mount()) return;
    ctx.playSfx?.('wood', ctx.getPlayerPosition());
    ctx.onRideStart?.();
    T.feedLine(ctx.hasGyro()
      ? 'Tip the phone forward to roll, back to back up, and lean it left or right to turn.'
      : 'Roll with W / S or the joystick, turn with A / D.');
    T.actsAt = 0;
    ctx.refreshButtons?.();
  };
  // Out of it: the player beside it (on whichever side there's ground), or where they are
  const leave = ({ step = true } = {}) => {
    if (!ride?.isRiding()) return;
    const s = ride.standPoint();
    ride.dismount();
    if (step) {
      const spot = ride.sideSpots().find((p) => {
        const g = ctx.getGroundY(p.x, p.z);
        return Number.isFinite(g) && Math.abs(g - s.y) < 0.8 && !(ctx.waterDepth(p.x, p.z) > 0.3);
      });
      const at = spot ?? s;
      ctx.teleport(at.x, at.z, ride.pose().yaw);
    }
    T.actsAt = 0;
    ctx.refreshButtons?.();
  };

  // Each frame before the controls (bootstrapGameApp.js): out when Town can't have it any more,
  // else it rolls (and carries the player)
  const cartBeforeControls = (dt) => {
    if (!ride) {
      if (!setupTried && T.active && T.ready && T.layout) { setupTried = true; setup(); }
      return;
    }
    if (!ride.isRiding()) return;
    if (!T.active || ctx.isPlayerDead() || T.sequence || T.jail || T.inRoom || T.inCanoe()) { leave({ step: false }); return; }
    if (ride.update(dt) === 'left') leave({ step: false });
  };
  const cartAfterControls = () => ride?.afterControls();

  // ── Acts (townActs.js): Get in by it; in it, Get out ──
  const cartActs = (calm) => {
    if (!ride) return [];
    if (ride.isRiding()) return [{ key: 'cartout', label: 'Get out of the cart', onClick: () => leave() }];
    if (!calm || !canBoard()) return [];
    const p = T.playerPos();
    const c = ride.pose();
    return dist2(p.x, p.z, c.x, c.z) < CART_ACT_DIST ? [{ key: 'cartin', label: 'Get in the cart', onClick: board }] : [];
  };

  // Leaving Town: out of it, and back at its parking spot for next time
  const resetCart = () => {
    if (!ride) return;
    leave({ step: false });
    if (home) ride.place(home.x, home.z, home.yaw);
  };
  const inCart = () => !!ride?.isRiding();

  Object.assign(T, { cartActs, cartBeforeControls, cartAfterControls, inCart, resetCart });
}

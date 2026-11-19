// Town: the cart (src/items/cart.js — the model and how it rolls). It's parked near where the
// player arrives (between the shop and the campfire — `places.spawn`), on the first spot round
// it where the whole cart fits (`findParking`). Walk up to it → Get in the cart (like the
// canoe): the player crouches in its bed (the Crouch clip) and steers it by tilting the phone, like
// the broom but on the ground — tipped forward it rolls on, back it backs up, leaned left /
// right it turns (the joystick / WASD the same, the only way without a gyro). Whatever's in hand
// stays there and can be used (a gyro item stops the cart while it's out — as on the broom).
// Get out → the player steps down beside it, the cart stays there (back at its parking spot the
// next time Town opens). Dying / an arrest / a room / the canoe / leaving Town get them out too.
// Pushed into something it can't pass, it tips up onto two wheels (narrower — a tight alley may
// let it through); too far and it flips over, throwing the player out (ctx.throwPlayer), then
// rights itself (src/items/cart.js). No going into houses in it (townTrade.js — `ctx.isInCart`). Only the player's own: in a shared
// town the others don't see it (they'd see the player crouching as they go).
// A job can load it (the veg for the wizard — townQuests.js `cartLoad`): a heap of veg in its bed,
// the cart brought round beside the player (bringCart), and it isn't taken back to its parking
// spot while a job's using it (`T.cartInUse`). A job can also hold it where it is (lockCart), knock
// it over (knockCart — a bomb beside it) and seat a townsperson in its bed (cartSeat — the
// passenger's place, townQuests.js).

import * as THREE from 'three';
import { createCartRide } from '../items/cart.js';
import { buildItemMesh } from '../village/villageMode.js';
import { CART_ACT_DIST, dist2 } from './townConfig.js';

const PARK_CLEARANCE = 1.1; // m from the cart's middle to a placed thing's bounds
// Left somewhere (stuck, tipped over…): nobody in it this long and the player away from it and
// from its parking spot → back at its parking spot
const RETURN_S = 60;
const RETURN_AWAY = 12;     // m the player is from both (so it doesn't vanish / pop up in view)
const RETURN_MOVED = 3;     // m from its parking spot before it counts as left somewhere
const BRING_RINGS = [1.75, 2.3, 3, 4, 5.5]; // m from the player the cart's brought round to (bringCart — Get in within CART_ACT_DIST)

// A load of veg in the bed (cart-local: +Z its pole end; the rider crouches about the middle):
// a crate at each end heaped with veg
const makeCargo = () => {
  const g = new THREE.Group();
  g.name = 'cart-cargo';
  const crateMat = new THREE.MeshStandardMaterial({ color: 0x8a6239, roughness: 1, metalness: 0 });
  for (const [z, turn] of [[0.42, 0.2], [-0.44, -0.3]]) {
    const crate = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.2, 0.3), crateMat);
    crate.position.set(0, 0.36, z);
    crate.castShadow = true;
    g.add(crate);
    for (let k = 0; k < 4; k++) {
      const veg = buildItemMesh('veg');
      veg.scale.setScalar(1.7);
      veg.position.set(-0.2 + k * 0.13, 0.46 + (k % 2) * 0.04, z + (k % 2 ? 0.04 : -0.04));
      veg.rotation.y = turn + k * 1.1;
      g.add(veg);
    }
  }
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  g.visible = false;
  return g;
};
// T: the town's shared state + functions (createTownMode in townMode.js); ctx: the game
export function installTownCart(T, ctx) {
  let ride = null;
  let home = null;            // { x, z, yaw } its parking spot
  let setupTried = false;
  let idle = 0;               // s nobody's been in it
  let cargo = null;           // the veg in its bed (shown while T.cartLaden())

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
    cargo = makeCargo();
    ride.group.add(cargo);
  };
  const laden = () => T.cartLoad?.() === 'veg';
  const inUse = () => laden() || !!T.cartInUse?.();

  // Brought round beside the player (a job's loaded it): the first spot round them it fits,
  // pointing the way they face; true if it's there (or they're in it already)
  const bringCart = () => {
    if (!ride && T.layout) { setupTried = true; setup(); }
    if (!ride || ride.isFlipped()) return false;
    if (ride.isRiding()) return true;
    let p = T.playerPos();
    let yaw = ctx.getPlayerModel?.()?.rotation.y ?? 0;
    // (indoors: at the door outside)
    if (T.inRoom) { const r = T.layout.places.rooms[T.inRoom]; p = r.door; yaw = r.exitYaw; }
    for (const r of BRING_RINGS) {
      for (let k = 0; k < 12; k++) {
        const a = yaw + Math.PI / 2 + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * (Math.PI / 6);
        const x = p.x + Math.sin(a) * r;
        const z = p.z + Math.cos(a) * r;
        const g = ctx.getGroundY(x, z);
        if (!Number.isFinite(g) || ctx.waterDepth(x, z) > 0.2 || Math.abs(g - ctx.getGroundY(p.x, p.z)) > 1.2) continue;
        for (const y of [yaw, yaw + Math.PI / 2, yaw - Math.PI / 2]) {
          if (ride.fits(x, z, y)) {
            ride.place(x, z, y);
            idle = 0;
            return true;
          }
        }
      }
    }
    return false;
  };

  const canBoard = () => !!ride && !ride.isRiding() && !ride.isFlipped() && !ctx.isPlayerDead() && !T.sequence && !T.jail && !T.inRoom
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
    if (cargo) cargo.visible = laden();
    if (!ride.isRiding()) {
      ride.update(dt); // (its dust settling, a flip playing out)
      idle += dt;
      if (idle > RETURN_S && home && !ride.isFlipped() && !inUse()) {
        const c = ride.pose();
        const p = T.playerPos();
        if (dist2(c.x, c.z, home.x, home.z) > RETURN_MOVED
          && dist2(p.x, p.z, c.x, c.z) > RETURN_AWAY && dist2(p.x, p.z, home.x, home.z) > RETURN_AWAY) {
          ride.place(home.x, home.z, home.yaw);
          idle = 0;
        }
      }
      return;
    }
    idle = 0;
    if (!T.active || ctx.isPlayerDead() || T.sequence || T.jail || T.inRoom || T.inCanoe()) { leave({ step: false }); return; }
    const r = ride.update(dt);
    if (r === 'left') leave({ step: false });
    else if (r === 'flip') {
      // Over it goes: the player thrown out toward the side it falls
      const dir = ride.throwDir();
      leave({ step: false });
      ctx.throwPlayer?.(dir);
      T.feedLine(ride.state().flip?.phase === 'tumble' ? 'The cart went tumbling down the slope!' : 'The cart tipped over!');
    }
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

  // ── For a job (townQuests.js) ──
  // (held where it is: no rolling)
  const lockCart = (on) => ride?.lock(on);
  // (a blast at `from` beside it: over it goes, whoever's in it thrown out)
  const knockCart = (from) => !!ride?.knockOver(from);
  // (a passenger's place in the bed, `lz` m ahead of its middle — behind the rider: −0.42)
  const cartSeat = (lz = -0.42) => (ride ? ride.bedPose(lz) : null);
  const cartPose = () => (ride ? ride.pose() : null);
  const cartFlipped = () => !!ride?.isFlipped();

  Object.assign(T, { lockCart, knockCart, cartSeat, cartPose, cartFlipped, bringCart, cartActs, cartBeforeControls, cartAfterControls, inCart, resetCart, cartRide: () => ride }); // (cartRide: dev console — town.debug().T.cartRide())
}

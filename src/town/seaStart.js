// The guest's sea start: someone who isn't signed in opens the game out on the open sea,
// standing in a canoe with a fishing rod in hand, instead of on the start screen. It only needs
// the canoe, the water, the sky, the player and the rod / oar, so it starts before the island's
// mappack is in: until then a stand-in ocean (the mappack's own water material over a plain
// seabed) at the island's sea level, which goes once the map (with its own sea) is active. The
// island's numbers it needs before it loads — sea level, the fishing spot, the way its bank
// faces — come from the map's definition (`MAPS.islandTown.seaStart` in bootstrapGameApp.js).
//
// The only UI: 🎣 Rod and 🛶 Oar (bottom), ⬅ Lobby (top left) and Sign In (top right) — the rest
// of the HUD is hidden (body.sea-start), but for the phone QR / calibration popups. The canoe
// starts pointed at the island's fishing spot, the player facing over its side with the rod;
// 🛶 Oar puts the oar in hand, faces the player forward and (if it's drifted round) turns the
// canoe back to the fishing spot, so paddling straight on gets there (canoeBoat.js paddles: the
// oar's blade with a gyro, else W / S / A / D or — touch screens — the joystick). Near the spot with
// dry ground in reach, 🛶 Get out → onLanded: Town starts there as the guest, normal UI.
// ⬅ Lobby → onLobby (the start screen); Sign In → onSignIn (the login form).

import * as THREE from 'three';
import { registerTerrainHeightOverride } from '../environment/terrainHeight.js';
import { createCanoeBoat } from './canoeBoat.js';
import { CANOE_SHORE_DIST, dist2, el } from './townConfig.js';

const SEA_START_DIST = 140;       // m out from the fishing spot, the way its bank faces…
const SEA_START_SIDE = 4;         // …and this far to one side (headings exactly along a diagonal
                                  // look straight at a skybox cube edge, which some renderers draw badly)
const SEA_TURN_RATE = 2.2;        // rad/s — 🛶 Oar turning the canoe to face the fishing spot
const SEA_LAND_RADIUS = 14;       // m from the fishing spot: 🛶 Get out (with dry ground in reach)
const SEA_LAND_CHECK_S = 0.25;    // s between looks for the shore
const OCEAN_SIZE = 2400;          // m — the stand-in ocean, centred on the start
const SEABED_DEPTH = 7;           // m under the surface
const SEABED_COLOR = 0x1f5f78;

// ctx: the game (bootstrapGameApp.js); config: MAPS.islandTown.seaStart
//   { seaLevel, fishSpot: { x, z }, face: { x, z } (unit: from the spot out to the water) }
export function createSeaStart(ctx, config) {
  const { seaLevel, fishSpot, face } = config;
  let active = false;
  let boat = null;
  let unregisterFloor = null;
  let ocean = null;          // the stand-in ocean (until the map's own sea is in)
  let held = null;           // 'rod' | 'oar'
  let aimYaw = null;         // turning to face the fishing spot (🛶 Oar)
  let simT = 0;
  let landAt = 0;
  let landSpot = null;       // dry ground to step onto, near the fishing spot

  // The map's water once it's in, else the open sea everywhere
  const waterY = (x, z) => ctx.getMapWater()?.(x, z) ?? seaLevel;
  const waterDepth = (x, z) => (ctx.getMapWater() ? ctx.waterDepth(x, z) : Infinity);

  // ── The stand-in ocean ──
  const buildOcean = (x, z) => {
    const group = new THREE.Group();
    group.name = 'sea-start-ocean';
    group.position.set(x, 0, z);
    const bedGeo = new THREE.PlaneGeometry(OCEAN_SIZE, OCEAN_SIZE);
    bedGeo.rotateX(-Math.PI / 2);
    const bed = new THREE.Mesh(bedGeo, new THREE.MeshLambertMaterial({ color: SEABED_COLOR }));
    bed.position.y = seaLevel - SEABED_DEPTH;
    group.add(bed);
    // (the map's own water material, so nothing changes when its sea takes over)
    import('../map/MapLoader.ts').then(({ createWaterMaterial }) => {
      if (ocean !== group) return;
      const mat = createWaterMaterial();
      const geo = new THREE.PlaneGeometry(OCEAN_SIZE, OCEAN_SIZE, 160, 160);
      geo.rotateX(-Math.PI / 2);
      const water = new THREE.Mesh(geo, mat);
      water.position.y = seaLevel;
      water.renderOrder = 1;
      water.onBeforeRender = () => { mat.uniforms.uTime.value = performance.now() / 1000; };
      group.add(water);
    }).catch((err) => console.warn('[sea start] water material failed to load', err));
    return group;
  };
  const removeOcean = () => {
    if (!ocean) return;
    ocean.parent?.remove(ocean);
    ocean.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
    ocean = null;
  };

  // ── HUD ──
  const hud = el('div', 'sea-hud');
  hud.id = 'sea-hud';
  const btn = (cls, text, onClick) => {
    const b = el('button', cls, text);
    b.type = 'button';
    b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); onClick(); });
    return b;
  };
  const lobbyBtn = btn('sea-lobby ui-btn ui-btn-ghost', 'Lobby', () => ctx.onLobby());
  const signInBtn = btn('sea-signin ui-btn', 'Sign In', () => ctx.onSignIn());
  const rodBtn = btn('sea-tool ui-btn ui-btn-secondary', 'Rod', () => pick('rod'));
  const oarBtn = btn('sea-tool ui-btn ui-btn-secondary', 'Oar', () => pick('oar'));
  const outBtn = btn('sea-out ui-btn hidden', 'Get out', () => getOut());
  const tools = el('div', 'sea-tools');
  tools.append(rodBtn, oarBtn);
  hud.append(lobbyBtn, signInBtn, outBtn, tools);
  const renderTools = () => {
    rodBtn.classList.toggle('is-active', held === 'rod');
    oarBtn.classList.toggle('is-active', held === 'oar');
    // (touch screens with no gyro paddle with the joystick: it shows while the oar's out)
    document.body.classList.toggle('sea-steer', held === 'oar' && ctx.isTouch() && !ctx.hasGyro());
  };

  // ── Rod / oar ──
  // The rod: facing over the canoe's side (its right, as the bow points); the oar: facing the bow
  const faceFor = (kind) => {
    const s = boat.standPoint();
    ctx.teleport(s.x, s.z, boat.yaw + (kind === 'rod' ? -Math.PI / 2 : 0));
  };
  const pick = (kind) => {
    if (!active) return;
    held = kind;
    ctx.hold(kind);
    faceFor(kind);
    // (the oar: the canoe back round to the fishing spot, so paddling straight on gets there)
    if (kind === 'oar') {
      const s = boat.standPoint();
      aimYaw = Math.atan2(fishSpot.x - s.x, fishSpot.z - s.z);
    }
    renderTools();
  };

  // ── Getting out: near the fishing spot, onto dry ground ──
  const findLandSpot = () => {
    if (!ctx.getMapWater()) return null;
    const s = boat.standPoint();
    if (dist2(s.x, s.z, fishSpot.x, fishSpot.z) > SEA_LAND_RADIUS) return null;
    for (let r = 1; r <= CANOE_SHORE_DIST; r += 0.5) {
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        const x = s.x + Math.sin(a) * r;
        const z = s.z + Math.cos(a) * r;
        if (ctx.waterDepth(x, z) > 0) continue;
        const g = ctx.getGroundY(x, z);
        if (Number.isFinite(g) && g - waterY(x, z) < 1.5) return { x, z, yaw: Math.atan2(x - s.x, z - s.z) };
      }
    }
    return null;
  };
  const getOut = () => {
    if (!active || !landSpot) return;
    const spot = landSpot;
    exit();
    ctx.teleport(spot.x, spot.z, spot.yaw);
    ctx.onLanded(spot);
  };

  // ── Lifecycle ──
  // (the canoe's floor is the ground while aboard — wins over the map's — and the player stays
  // on it: playerControls.positionConstraint)
  const floorAt = (x, z) => (active ? boat.floorAt(x, z) : undefined);
  const pin = (c) => {
    if (!active) return;
    const s = boat.standPoint();
    c.playerX = s.x;
    c.playerZ = s.z;
  };

  const enter = () => {
    if (active) return;
    active = true;
    simT = 0;
    landSpot = null;
    aimYaw = null;
    // Out on the open sea off the fishing spot, pointed at it
    const x = fishSpot.x + face.x * SEA_START_DIST - face.z * SEA_START_SIDE;
    const z = fishSpot.z + face.z * SEA_START_DIST + face.x * SEA_START_SIDE;
    const yaw = Math.atan2(fishSpot.x - x, fishSpot.z - z);
    boat = createCanoeBoat({ waterY, waterDepth, x, z, yaw });
    boat.place(0);
    ctx.scene.add(boat.group);
    if (!ctx.getMapWater()) {
      ocean = buildOcean(x, z);
      ctx.scene.add(ocean);
    }
    unregisterFloor = registerTerrainHeightOverride(floorAt);
    const s = boat.standPoint();
    ctx.teleport(s.x, s.z, yaw);
    ctx.holdStill(true);
    ctx.setPositionConstraint(pin);
    document.body.classList.add('sea-start');
    document.body.append(hud);
    outBtn.classList.add('hidden');
    pick('rod');
  };

  const exit = () => {
    if (!active) return;
    active = false;
    held = null;
    unregisterFloor?.();
    unregisterFloor = null;
    ctx.holdStill(false);
    ctx.setPositionConstraint(null);
    ctx.hold(null);
    boat.group.parent?.remove(boat.group);
    boat = null;
    removeOcean();
    hud.remove();
    document.body.classList.remove('sea-start', 'sea-steer');
  };

  const update = (dt) => {
    if (!active) return;
    dt = Math.min(dt, 0.1);
    simT += dt;
    // The map's own sea is in: the stand-in goes
    if (ocean && ctx.getMapWater()) removeOcean();
    const yawBefore = boat.yaw;
    // 🛶 Oar: turning to face the fishing spot
    if (aimYaw != null) {
      const d = Math.atan2(Math.sin(aimYaw - boat.yaw), Math.cos(aimYaw - boat.yaw));
      const step = SEA_TURN_RATE * dt;
      boat.w = 0;
      if (Math.abs(d) <= step) { boat.yaw = aimYaw; aimYaw = null; } else boat.yaw += Math.sign(d) * step;
    }
    if (held === 'oar' && aimYaw == null) boat.paddle(dt, ctx.getOarModel(), ctx.getSteer());
    else boat.blade = null;
    boat.move(dt, simT);
    const s = boat.standPoint();
    ctx.carryPlayer(s.x, boat.floorY(), s.z, boat.yaw - yawBefore);
    if (simT >= landAt) {
      landAt = simT + SEA_LAND_CHECK_S;
      landSpot = findLandSpot();
      outBtn.classList.toggle('hidden', !landSpot);
    }
    renderTools();
  };

  return {
    enter,
    exit,
    update,
    isActive: () => active,
    // The phone's Block bar as an interact button: 🛶 Get out at the spot, else 🛶 Oar
    interactLabel: () => (!active ? null : landSpot ? 'Get out' : held === 'oar' ? null : 'Oar'),
    interact: () => {
      if (!active) return;
      if (landSpot) getOut();
      else if (held !== 'oar') pick('oar');
    },
    pick,
  };
}

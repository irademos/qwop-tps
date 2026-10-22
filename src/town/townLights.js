// Town: its lights. At night the map's road lamps glow (the game lights their glass —
// ctx.setRoadLampsLit) and the campfires' ground glow spreads (TOWN_FIRE_GLOW_NIGHT). Real
// light comes from a few point lights (TOWN_LIGHT_SLOTS) given to the lamps / fires nearest the
// player, fading over as the player walks; the fires keep theirs, dimmer, by day. The lights
// stay in the scene (intensity 0 when off) while Town is on, so nothing recompiles the
// scene's shaders as they come and go.

import * as THREE from 'three';
import {
  TOWN_FIRE_GLOW_NIGHT, TOWN_FIRE_LIGHT, TOWN_LAMP_LIGHT, TOWN_LIGHT_FADE_S, TOWN_LIGHT_MAX_DIST,
  TOWN_LIGHT_SLOTS,
} from './townConfig.js';

// T: the town's shared state + functions (createTownMode in townMode.js); ctx: the game
export function installTownLights(T, ctx) {
  let slots = null;   // [{ light, spot, level }]
  let spots = null;   // [{ kind: 'lamp' | 'fire', x, y, z, fire? }]
  let lampsLit = false;

  const buildSpots = () => {
    spots = [];
    for (const p of ctx.getRoadLamps?.() ?? []) spots.push({ kind: 'lamp', x: p.x, y: p.y, z: p.z });
    for (const fire of [T.layout.props.fire, T.layout.props.campFire]) {
      if (!fire) continue;
      const g = fire.group.position;
      spots.push({ kind: 'fire', x: g.x, y: g.y + TOWN_FIRE_LIGHT.y, z: g.z, fire });
    }
  };

  // (added to the town's root: in the scene while Town is on)
  T.addLights = (root) => {
    if (!slots) {
      slots = [];
      for (let i = 0; i < TOWN_LIGHT_SLOTS; i++) {
        const light = new THREE.PointLight(0xffffff, 0, 1, 1);
        light.castShadow = false;
        slots.push({ light, spot: null, level: 0 });
      }
    }
    for (const s of slots) { root.add(s.light); s.light.intensity = 0; s.spot = null; s.level = 0; }
    spots = null;
  };

  T.resetLights = () => {
    for (const s of slots ?? []) { s.light.intensity = 0; s.spot = null; s.level = 0; }
    for (const sp of spots ?? []) if (sp.fire) sp.fire.glow.scale.setScalar(1);
    if (lampsLit) { lampsLit = false; ctx.setRoadLampsLit?.(false); }
  };

  const _want = new Set();
  T.updateLights = (dt) => {
    if (!slots || !T.layout) return;
    if (!spots) buildSpots();
    const night = !!T.isNight;
    if (night !== lampsLit) { lampsLit = night; ctx.setRoadLampsLit?.(night); }
    for (const sp of spots) if (sp.fire) sp.fire.glow.scale.setScalar(night ? TOWN_FIRE_GLOW_NIGHT : 1);
    // Which spots get a light: the nearest lit ones (none while the player's in a house's room)
    _want.clear();
    if (!T.inRoom) {
      const p = T.playerPos();
      const max2 = TOWN_LIGHT_MAX_DIST * TOWN_LIGHT_MAX_DIST;
      const near = [];
      for (const sp of spots) {
        if (!night && sp.kind === 'lamp') continue;
        const d2 = (sp.x - p.x) ** 2 + (sp.z - p.z) ** 2;
        if (d2 <= max2) near.push([d2, sp]);
      }
      near.sort((a, b) => a[0] - b[0]);
      for (let i = 0; i < Math.min(near.length, slots.length); i++) _want.add(near[i][1]);
    }
    const step = dt / TOWN_LIGHT_FADE_S;
    // A slot whose spot is still wanted fades in; one whose isn't fades out, then is free
    for (const s of slots) {
      if (!s.spot) continue;
      if (_want.has(s.spot)) {
        s.level = Math.min(1, s.level + step);
        _want.delete(s.spot);
      } else {
        s.level = Math.max(0, s.level - step);
        if (s.level === 0) s.spot = null;
      }
    }
    // …and the spots left over take the free ones
    for (const sp of _want) {
      const s = slots.find((x) => !x.spot);
      if (!s) break;
      s.spot = sp;
      s.level = 0;
      const c = sp.kind === 'fire' ? TOWN_FIRE_LIGHT : TOWN_LAMP_LIGHT;
      s.light.color.setHex(c.color);
      s.light.distance = c.distance;
      s.light.decay = c.decay;
      s.light.position.set(sp.x, sp.y, sp.z);
    }
    for (const s of slots) {
      if (!s.spot) { s.light.intensity = 0; continue; }
      if (s.spot.kind === 'fire') {
        const t = T.simT;
        const flicker = 0.85 + Math.sin(t * 11) * 0.08 + Math.sin(t * 7.3 + 1) * 0.07;
        s.light.intensity = TOWN_FIRE_LIGHT.intensity * flicker * (night ? 1 : TOWN_FIRE_LIGHT.day) * s.level;
      } else {
        s.light.intensity = TOWN_LAMP_LIGHT.intensity * s.level;
      }
    }
  };
}

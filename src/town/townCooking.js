// Town: cooking at the campfire — a pot hangs over the town's fire (buildProps puts it there),
// and the player cooks what they caught or picked into food that heals more and sells for more
// (the cooked GOODS in townEconomy.js): fish → grilled fish, veg → stew. Cooking takes a few
// seconds standing by the fire (walking off stops it), like fishing.

import * as THREE from 'three';
import { GOODS } from './townEconomy.js';
import { dist2 } from './townConfig.js';

// from: goods it takes; secs: how long it cooks
export const RECIPES = [
  { id: 'grilledFish', from: { fish: 1 }, secs: 3, verb: 'Grill' },
  { id: 'stew', from: { crops: 2 }, secs: 4, verb: 'Cook' },
];
const COOK_DIST = 2.6;            // m from the fire for the 🍳 buttons
const COOK_CANCEL_DIST = 0.8;     // m walked off: cooking stops
const STEAM_PUFFS = 5;

const _steamTexture = (() => {
  let tex = null;
  return () => {
    if (tex) return tex;
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(32, 32, 2, 32, 32, 30);
    grad.addColorStop(0, 'rgba(255,255,255,0.9)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    tex = new THREE.CanvasTexture(c);
    return tex;
  };
})();

// T: the town's shared state + functions (createTownMode in townMode.js); ctx: the game
export function installTownCooking(T, ctx) {
  // The pot over the fire: a tripod of sticks, a chain and an iron pot (and its steam)
  const makeCookPot = () => {
    const group = new THREE.Group();
    const wood = new THREE.MeshStandardMaterial({ color: 0x5a3d22, roughness: 1, metalness: 0 });
    const iron = new THREE.MeshStandardMaterial({ color: 0x26262b, roughness: 0.7, metalness: 0.2 });
    const apex = 1.2;
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      const foot = new THREE.Vector3(Math.sin(a) * 0.62, 0, Math.cos(a) * 0.62);
      const top = new THREE.Vector3(0, apex, 0);
      const len = foot.distanceTo(top);
      const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.035, len + 0.12, 5), wood);
      stick.position.copy(foot).lerp(top, 0.5);
      stick.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), top.clone().sub(foot).normalize());
      stick.castShadow = true;
      group.add(stick);
    }
    const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.42, 4), iron);
    chain.position.y = apex - 0.21;
    group.add(chain);
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.16, 0.24, 12), iron);
    pot.position.y = apex - 0.54;
    pot.castShadow = true;
    group.add(pot);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.018, 5, 14), iron);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = pot.position.y + 0.12;
    group.add(rim);
    const steam = [];
    for (let i = 0; i < STEAM_PUFFS; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: _steamTexture(), transparent: true, depthWrite: false, opacity: 0 }));
      s.position.y = rim.position.y;
      s.userData.phase = i / STEAM_PUFFS;
      group.add(s);
      steam.push(s);
    }
    group.userData.steam = steam;
    group.userData.steamBase = rim.position.y;
    return group;
  };

  const nearFire = () => {
    const f = T.layout?.places.fire;
    if (!f) return false;
    const p = T.playerPos();
    return dist2(p.x, p.z, f.x, f.z) < COOK_DIST;
  };
  const canMake = (r) => Object.entries(r.from).every(([g, n]) => T.goods[g] >= n);
  const fromText = (r) => Object.entries(r.from).map(([g, n]) => `${n > 1 ? `${n} ` : ''}${GOODS[g].emoji}`).join(' + ');

  const startCooking = (r) => {
    if (T.cooking || !canMake(r)) return;
    const p = T.playerPos();
    T.cooking = { recipe: r, left: r.secs, x: p.x, z: p.z };
    T.feedLine(`🔥 ${GOODS[r.id].label} on the fire…`);
  };
  const stopCooking = () => { T.cooking = null; };
  const updateCooking = (dt) => {
    const pot = T.layout?.props.cookPot;
    if (pot) {
      // (steam while something's cooking)
      for (const s of pot.userData.steam) {
        const k = (T.simT * 0.6 + s.userData.phase) % 1;
        s.position.y = pot.userData.steamBase + k * 0.9;
        s.position.x = Math.sin((k + s.userData.phase) * 5) * 0.06;
        s.scale.setScalar(0.18 + k * 0.4);
        const target = T.cooking ? 0.5 * (1 - k) : 0;
        s.material.opacity += (target - s.material.opacity) * Math.min(1, dt * 4);
      }
    }
    const c = T.cooking;
    if (!c) return;
    const p = T.playerPos();
    if (dist2(p.x, p.z, c.x, c.z) > COOK_CANCEL_DIST || ctx.isPlayerDead() || T.sequence || T.jail) {
      T.cooking = null;
      return;
    }
    c.left -= dt;
    if (c.left > 0) return;
    T.cooking = null;
    const r = c.recipe;
    if (!canMake(r)) return;
    for (const [g, n] of Object.entries(r.from)) T.goods[g] -= n;
    T.goods[r.id] += 1;
    T.renderGoods();
    const G = GOODS[r.id];
    T.feedLine(`${G.emoji} ${G.label}! Heals +${G.heal} ❤️ — and sells for more than it's made of.`);
    T.introNote('cook', { good: r.id });
  };
  // The fire's buttons: what can be cooked with what the player carries
  const cookActs = () => {
    if (T.cooking) return [{ key: 'cooking', label: `🔥 Cooking… ${Math.ceil(T.cooking.left)}s`, onClick: stopCooking }];
    if (!nearFire()) return [];
    return RECIPES.filter(canMake).map((r) => ({
      key: `cook:${r.id}`,
      label: `🍳 ${r.verb} ${fromText(r)} → ${GOODS[r.id].emoji}`,
      onClick: () => startCooking(r),
    }));
  };

  Object.assign(T, {
    cookActs, makeCookPot, updateCooking,
  });
}

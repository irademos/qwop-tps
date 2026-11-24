// Town: a townsperson swimming — at the surface and under it (the fisher's dive — beats/dive.js).
// A job's cast member in the 'swim' qmode (townQuests.js) is moved here: T.diverStart(n, at) puts
// them in the water at `at` (treading at the surface), T.diverGo(n, to, { speed }) sends them
// somewhere — { x, y, z } under the surface, { x, z } (no y) along it, null: tread where they are
// — and T.diverFrame(n, dt) moves them each frame. Their body is posed through `n.seat`
// (townFolk.js syncBody: { pos, quat, pose }): the Swimming clip tipped the way they swim, the
// Treading Water clip upright when still. While a job's potion lasts (T.questAir) an air bubble
// sits over their head under water, as over the player's (bootstrapGameApp.js _updateDiveAir).
// T.diverEnd(n) takes them out of the water (the job puts them somewhere).

import * as THREE from 'three';
import { glbCharacterConfig } from '../models/glbCharacterModel.js';
import { heightScale } from './townConfig.js';

const SPEED = 2.0;           // m/s swimming (the player's dive: 2.4)
const TURN_RATE = 2.5;       // rad/s
const PITCH_MAX = 1.1;       // rad either way
const PITCH_RATE = 2.5;      // 1/s it eases toward the way they swim
const ARRIVE = 0.6;          // m: there
const PIVOT = 0.5;           // m over the feet the body tips about (× height scale)
const SURFACE_CENTER = 0.25; // m (× height scale) the body's middle sits under the surface treading
const UNDER_TOP = 0.45;      // m under the surface the middle keeps while under
const BOTTOM_CLEAR = 0.5;    // m over the bottom
const MAX_DEPTH = 40;        // m (off the map's ground: taken as this deep)
const AIR_RADIUS = 0.42;     // m (× height scale)
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// T: the town's shared state + functions (createTownMode in townMode.js); ctx: the game
export function installTownDiver(T, ctx) {
  const levelAt = (x, z) => ctx.getWaterY?.(x, z) ?? 0;
  const bottomAt = (x, z, level) => {
    const d = ctx.waterDepth?.(x, z) ?? 0;
    return level - (Number.isFinite(d) ? Math.min(d, MAX_DEPTH) : MAX_DEPTH);
  };
  const surfaceY = (n, x, z) => levelAt(x, z) - SURFACE_CENTER * heightScale(n.url);

  let airGeo = null;
  let airMat = null;
  const airMesh = () => {
    airGeo ??= new THREE.SphereGeometry(AIR_RADIUS, 20, 14);
    airMat ??= new THREE.MeshPhysicalMaterial({ color: 0xbfefff, transparent: true, opacity: 0.28, roughness: 0.05, depthWrite: false });
    const m = new THREE.Mesh(airGeo, airMat);
    m.renderOrder = 10;
    return m;
  };

  const _pos = new THREE.Vector3();
  const _quat = new THREE.Quaternion();
  const _eul = new THREE.Euler(0, 0, 0, 'YXZ');
  const _off = new THREE.Vector3();
  const pose = (n) => {
    const d = n.dive;
    if (!d) return null;
    const hs = heightScale(n.url);
    _eul.set(-d.pitch, d.yaw, 0, 'YXZ');
    _quat.setFromEuler(_eul);
    // (tipped about a point PIVOT over the feet: the feet = the middle − R·(0, pivot, 0))
    _off.set(0, PIVOT * hs, 0).applyQuaternion(_quat);
    _pos.set(d.x, d.y, d.z).sub(_off);
    return { pos: _pos, quat: _quat, pose: d.moving ? glbCharacterConfig.swimClip : glbCharacterConfig.treadClip };
  };

  const diverStart = (n, at) => {
    const x = at?.x ?? n.x;
    const z = at?.z ?? n.z;
    n.dive = { x, z, y: surfaceY(n, x, z), yaw: at?.yaw ?? n.yaw ?? 0, pitch: 0, to: null, speed: SPEED, moving: false, air: null };
    n.x = x;
    n.z = z;
    n.path = null;
    n.moving = false;
    n.seat = () => pose(n);
    ctx.playSfx?.('splash', { x, y: levelAt(x, z), z });
  };
  const diverGo = (n, to, { speed = SPEED } = {}) => {
    if (!n?.dive) return;
    n.dive.to = to ? { x: to.x, z: to.z, y: Number.isFinite(to.y) ? to.y : null } : null;
    n.dive.speed = speed;
  };
  const diverAt = (n) => (n?.dive ? { x: n.dive.x, y: n.dive.y, z: n.dive.z } : null);
  const isUnder = (n) => !!n?.dive && n.dive.y < levelAt(n.dive.x, n.dive.z) - UNDER_TOP * 0.9;
  // (there yet — within ARRIVE of where they were sent)
  const diverThere = (n) => {
    const d = n?.dive;
    if (!d?.to) return true;
    const ty = d.to.y ?? surfaceY(n, d.to.x, d.to.z);
    return Math.hypot(d.to.x - d.x, d.to.z - d.z, ty - d.y) < ARRIVE;
  };

  const diverFrame = (n, dt) => {
    const d = n.dive;
    if (!d) return false;
    const hs = heightScale(n.url);
    let moving = false;
    let wantPitch = 0;
    if (d.to) {
      const ty = d.to.y ?? surfaceY(n, d.to.x, d.to.z);
      const dx = d.to.x - d.x;
      const dy = ty - d.y;
      const dz = d.to.z - d.z;
      const dist = Math.hypot(dx, dy, dz);
      if (dist > ARRIVE * 0.5) {
        moving = true;
        const step = Math.min(dist, d.speed * dt);
        d.x += (dx / dist) * step;
        d.y += (dy / dist) * step;
        d.z += (dz / dist) * step;
        const h = Math.hypot(dx, dz);
        if (h > 0.05) d.yaw += THREE.MathUtils.clamp(wrap(Math.atan2(dx, dz) - d.yaw), -TURN_RATE * dt, TURN_RATE * dt);
        wantPitch = THREE.MathUtils.clamp(Math.atan2(dy, Math.max(h, 0.3)), -PITCH_MAX, PITCH_MAX);
      }
    } else {
      // (treading: turned toward the player)
      const p = T.playerPos();
      if (Math.hypot(p.x - d.x, p.z - d.z) > 0.5) d.yaw += THREE.MathUtils.clamp(wrap(Math.atan2(p.x - d.x, p.z - d.z) - d.yaw), -TURN_RATE * dt, TURN_RATE * dt);
    }
    // (kept in the water: under the surface, over the bottom — at the surface, treading on it)
    const level = levelAt(d.x, d.z);
    d.y = THREE.MathUtils.clamp(d.y, bottomAt(d.x, d.z, level) + BOTTOM_CLEAR, surfaceY(n, d.x, d.z));
    d.pitch += (wantPitch - d.pitch) * Math.min(1, PITCH_RATE * dt);
    d.moving = moving;
    n.x = d.x;
    n.z = d.z;
    n.yaw = d.yaw;
    n.moving = false;
    n.path = null;
    // (a job's potion: air over their head under water)
    const air = !!T.questAir && isUnder(n) && !!n.body;
    if (air && !d.air) { d.air = airMesh(); d.air.scale.setScalar(hs); T.root.add(d.air); }
    if (!air && d.air) { d.air.removeFromParent(); d.air = null; }
    if (d.air) {
      // (round the head: ahead swimming, over the middle treading)
      const fwd = moving ? 0.5 * hs : 0.1 * hs;
      const up = moving ? 0.1 * hs : 0.45 * hs;
      d.air.position.set(d.x + Math.sin(d.yaw) * fwd, d.y + up, d.z + Math.cos(d.yaw) * fwd);
      d.air.scale.setScalar(hs * (1 + Math.sin(T.simT * 6) * 0.04));
    }
    return true;
  };
  const diverEnd = (n) => {
    if (!n?.dive) return;
    n.dive.air?.removeFromParent();
    n.dive = null;
    n.seat = null;
  };

  Object.assign(T, { diverStart, diverGo, diverFrame, diverEnd, diverAt, diverThere, diverUnder: isUnder });
}

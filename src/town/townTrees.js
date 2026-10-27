// Town: chopping trees with the sword. Each hit shakes the tree, throws wood chips and cuts the
// notch bigger; TREE_FELL_HITS of them fell it: it tips over away from the player, speeding up
// as it goes, thuds down and bounces, lies there a moment and sinks away — leaving a stump and
// TREE_LOGS logs along where it lay. A sword hit splits a log: +1 wood. The stump sprouts a
// sapling after TREE_STUMP_S, which grows back into the tree over TREE_GROW_S. The stump is the
// pack's own stump model (STUMP_RE — a copy, sized to the trunk; a plain cylinder without it).
//
// The trees are the mappack's own placed objects (layout.trees[i].object — the placement
// wrapper, its origin at the bottom of the model): posed where they stand (tilted / sunk /
// scaled) and put back as they were on leaving Town (resetTrees). Shared town: a felling and a
// split log go to everyone (`tree` op, the host passes it on); each game plays the rest itself.
import * as THREE from 'three';
import {
  CHOP_REACH, LOG_LENGTH, TREE_FELL_HITS, TREE_GROW_S, TREE_LIE_S, TREE_LOGS, TREE_SINK_S,
  TREE_STUMP_S, dist2,
} from './townConfig.js';

const UP = new THREE.Vector3(0, 1, 0);
const HIT_GAP_S = 0.45;        // s between two hits that count on one tree / log
const SHAKE_S = 0.8;           // s a hit's shake lasts
const GRAVITY = 9.8;
const CHIP_POOL = 60;

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();

// Fresh-cut wood: rings on a pale face (the stump's top, the logs' ends)
const ringsTexture = () => {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#5e4129';
  g.fillRect(0, 0, 64, 64);
  for (let r = 30; r > 0; r -= 3) {
    g.beginPath();
    g.arc(32, 32, r, 0, Math.PI * 2);
    g.fillStyle = r > 27 ? '#6b4a2f' : (r / 3) % 2 ? '#d9b57c' : '#c99f63';
    g.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
};

// T: the town's shared state + functions (createTownMode in townMode.js); ctx: the game
export function installTownTrees(T, ctx) {
  let group = null;
  let trees = [];
  let stumpModel = null;       // { object, size } — the pack's stump (null: a cylinder)
  const byId = new Map();
  const active = new Set();    // trees doing something this frame (shaking, falling, lying…)
  const chips = [];
  const halves = [];           // a split log's two halves flying apart
  let logHitAt = -1;
  let youngNoteAt = -1;

  const barkMat = new THREE.MeshStandardMaterial({ color: 0x5e4129, roughness: 1 });
  const endMat = new THREE.MeshStandardMaterial({ map: ringsTexture(), roughness: 1 });
  const notchMat = new THREE.MeshStandardMaterial({ color: 0xd9b57c, roughness: 1 });
  const chipMat = new THREE.MeshStandardMaterial({ color: 0xd9b57c, roughness: 1 });
  const woodMats = [barkMat, endMat, endMat]; // (a cylinder's side, top, bottom)
  const logGeo = new THREE.CylinderGeometry(1, 1, 1, 10);
  const stumpGeo = new THREE.CylinderGeometry(1, 1.15, 1, 12).translate(0, 0.5, 0);
  const notchGeo = new THREE.BoxGeometry(1, 1, 1);
  const chipGeo = new THREE.BoxGeometry(0.07, 0.025, 0.045);

  // ── Setup (once, with the layout) ──
  const buildTrees = (parent, list, stumpObject = null) => {
    if (stumpObject) {
      stumpObject.updateWorldMatrix(true, true);
      const box = new THREE.Box3().setFromObject(stumpObject);
      const size = box.getSize(new THREE.Vector3());
      stumpModel = { object: stumpObject, width: Math.max(0.1, (size.x + size.z) / 2), scale: stumpObject.getWorldScale(new THREE.Vector3()) };
    }
    group = new THREE.Group();
    group.name = 'town-trees';
    parent.add(group);
    trees = list;
    for (const t of trees) {
      const o = t.object;
      if (!o) continue;
      o.updateWorldMatrix(true, true);
      const box = new THREE.Box3().setFromObject(o);
      const base = o.getWorldPosition(new THREE.Vector3());
      Object.assign(t, {
        state: 'standing', hits: 0, hitAt: -1, fells: 0, logs: [],
        bx: base.x, by: base.y, bz: base.z, height: Math.max(2, box.max.y - base.y),
        // (the ground at the trunk: some trees are placed sunk into it)
        gy: Math.max(base.y, T.groundAt(base.x, base.z, base.y)),
        p0: o.position.clone(), q0: o.quaternion.clone(), s0: o.scale.clone(),
        // (the parent's frame: tilt axes are turned into it, sinking scaled by it)
        parentQInv: o.parent.getWorldQuaternion(new THREE.Quaternion()).invert(),
        parentScale: o.parent.getWorldScale(new THREE.Vector3()).y || 1,
      });
      if (t.id != null) byId.set(String(t.id), t);
    }
    for (let i = 0; i < CHIP_POOL; i++) {
      const m = new THREE.Mesh(chipGeo, chipMat);
      m.visible = false;
      group.add(m);
      chips.push({ mesh: m, life: 0, vx: 0, vy: 0, vz: 0, floor: 0 });
    }
  };

  // The trunk: its middle and radius near the ground, from the model's vertices (once a tree is
  // first hit — the closest ring of vertices round the base, under the leaves)
  const measureTrunk = (t) => {
    if (t.r) return;
    const pts = [];
    t.object.updateWorldMatrix(true, true);
    t.object.traverse((m) => {
      const pos = m.isMesh ? m.geometry?.attributes?.position : null;
      if (!pos) return;
      const step = Math.max(1, Math.floor(pos.count / 6000));
      for (let i = 0; i < pos.count; i += step) {
        _v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
        const h = _v.y - t.gy;
        if (h > 0.1 && h < 1) pts.push([_v.x, _v.z, Math.hypot(_v.x - t.bx, _v.z - t.bz)]);
      }
    });
    t.cx = t.bx;
    t.cz = t.bz;
    t.r = 0.25;
    if (pts.length < 6) return;
    pts.sort((a, b) => a[2] - b[2]);
    const near = pts.slice(0, Math.max(6, Math.floor(pts.length * 0.3)));
    t.cx = near.reduce((s, p) => s + p[0], 0) / near.length;
    t.cz = near.reduce((s, p) => s + p[1], 0) / near.length;
    const d = near.map((p) => Math.hypot(p[0] - t.cx, p[1] - t.cz)).sort((a, b) => a - b);
    t.r = THREE.MathUtils.clamp(d[Math.floor(d.length / 2)], 0.12, 0.5);
  };

  // ── Posing a tree (in its parent's frame): tilted `angle` about its axis, sunk, scaled ──
  const pose = (t, angle = 0, sink = 0, scale = 1) => {
    const o = t.object;
    if (angle) o.quaternion.copy(_q.setFromAxisAngle(t.axisL, angle)).multiply(t.q0);
    else o.quaternion.copy(t.q0);
    o.position.copy(t.p0);
    o.position.y -= sink / t.parentScale;
    o.scale.copy(t.s0).multiplyScalar(scale);
  };
  // Tilt axis for a lean / fall toward `dirX, dirZ` (unit, world)
  const setAxis = (t, dirX, dirZ) => {
    t.dirX = dirX;
    t.dirZ = dirZ;
    const ax = _v.set(dirX, 0, dirZ).cross(UP).negate(); // (up × dir: tips the top toward dir)
    t.axisL = (t.axisL ?? new THREE.Vector3()).copy(ax).normalize().applyQuaternion(t.parentQInv);
  };

  // ── Chips ──
  const burst = (x, y, z, dirX, dirZ, n = 6, speed = 2.4) => {
    const floor = T.groundAt(x, z, y - 0.5);
    for (let k = 0; k < n; k++) {
      const c = chips.reduce((a, b) => (b.life < a.life ? b : a));
      c.mesh.position.set(x, y, z);
      c.mesh.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      c.mesh.visible = true;
      const s = speed * (0.5 + Math.random() * 0.7);
      c.vx = dirX * s + (Math.random() - 0.5) * 1.6;
      c.vz = dirZ * s + (Math.random() - 0.5) * 1.6;
      c.vy = 1.2 + Math.random() * 1.8;
      c.life = 0.9 + Math.random() * 0.5;
      c.floor = floor;
    }
  };
  const updateChips = (dt) => {
    for (const c of chips) {
      if (c.life <= 0) continue;
      c.life -= dt;
      const m = c.mesh;
      if (c.life <= 0) { m.visible = false; continue; }
      if (m.position.y > c.floor + 0.015) {
        c.vy -= GRAVITY * dt;
        m.position.x += c.vx * dt;
        m.position.y += c.vy * dt;
        m.position.z += c.vz * dt;
        m.rotation.x += 9 * dt;
        m.rotation.z += 7 * dt;
        if (m.position.y < c.floor + 0.015) m.position.y = c.floor + 0.015;
      }
    }
  };

  // ── Hitting a standing tree ──
  const hitTree = (t, tip) => {
    const p = T.playerPos();
    let dx = t.cx - p.x;
    let dz = t.cz - p.z;
    const dl = Math.hypot(dx, dz) || 1;
    dx /= dl;
    dz /= dl;
    t.hitAt = T.simT;
    t.hits += 1;
    ctx.playSfx('chop');
    // the notch: on the side first hit, cut deeper with every hit
    const gy = t.gy;
    if (!t.notch) {
      t.notchH = THREE.MathUtils.clamp(tip.y - gy, 0.3, 0.75);
      t.notchX = -dx;
      t.notchZ = -dz;
      t.notch = new THREE.Mesh(notchGeo, notchMat);
      t.notch.rotation.y = Math.atan2(t.notchX, t.notchZ);
      group.add(t.notch);
    }
    // (a pale cut face on the bark, taller with every hit)
    t.notch.scale.set(t.r * 1.3, 0.04 + 0.035 * t.hits, 0.025);
    t.notch.position.set(t.cx + t.notchX * t.r, gy + t.notchH, t.cz + t.notchZ * t.r);
    burst(t.cx + t.notchX * t.r, gy + t.notchH, t.cz + t.notchZ * t.r, t.notchX, t.notchZ, 5 + t.hits);
    if (t.hits >= TREE_FELL_HITS) {
      fell(t, dx, dz, true);
      return;
    }
    // a shake, leaning away from the player
    setAxis(t, dx, dz);
    t.shakeAt = T.simT;
    t.shakeAmp = 0.03 + 0.012 * t.hits;
    active.add(t);
  };

  // ── Felling (here, or another player's in a shared town) ──
  const fell = (t, dirX, dirZ, mine) => {
    measureTrunk(t);
    t.state = 'falling';
    t.fells += 1;
    t.hits = 0;
    setAxis(t, dirX, dirZ);
    t.angle = 0.04;
    t.spin = 0.25;
    t.landed = false;
    // where it comes to rest: the ground (or water) under its crown
    const L = t.height * 0.85;
    const tx = t.bx + dirX * L;
    const tz = t.bz + dirZ * L;
    const under = Math.max(T.groundAt(tx, tz, t.by), ctx.getWaterY(tx, tz) ?? -Infinity);
    t.endAngle = THREE.MathUtils.clamp(Math.PI / 2 - Math.atan2(under - t.by, L), 1.15, 1.95);
    // the stump, cut at the notch
    const h = t.notchH ?? 0.4;
    if (t.notch) { t.notch.parent?.remove(t.notch); t.notch = null; }
    t.notchH = null;
    if (!t.stump) {
      if (stumpModel) {
        // (the pack's stump: its roots spread to a few trunk radii)
        t.stump = stumpModel.object.clone(true);
        t.stump.quaternion.identity();
        t.stump.scale.copy(stumpModel.scale).multiplyScalar(THREE.MathUtils.clamp(3.6 * t.r / stumpModel.width, 0.5, 1.6));
      } else {
        t.stump = new THREE.Mesh(stumpGeo, woodMats);
        t.stump.scale.set(t.r * 1.08, h + 0.05, t.r * 1.08);
      }
      group.add(t.stump);
    }
    t.stump.rotation.y = t.fells * 2.4 + t.bx;
    t.stump.position.set(t.cx, t.gy - 0.05, t.cz);
    t.stump.visible = true;
    t.object.visible = true;
    active.add(t);
    if (mine && T.net && T.netMode !== 'off' && T.netMode !== 'joining') {
      T.net.broadcast({ w: 1, op: 'tree', t: String(t.id), a: 'fell', d: [Math.round(dirX * 1000) / 1000, Math.round(dirZ * 1000) / 1000] });
    }
  };

  // The logs, along where the trunk lay (none in the water: at least one by the stump)
  const spawnLogs = (t) => {
    const r = THREE.MathUtils.clamp(t.r * 0.85, 0.1, 0.3);
    const len = Math.min(LOG_LENGTH, t.height * 0.25);
    const along = [];
    for (let i = 0; i < TREE_LOGS; i++) {
      const d = t.r + 0.7 + i * (len + 0.35);
      if (d > t.height * 0.75) break;
      along.push(d);
    }
    let made = 0;
    along.forEach((d, i) => {
      const x = t.cx + t.dirX * d;
      const z = t.cz + t.dirZ * d;
      const g = T.groundAt(x, z, t.by);
      const water = ctx.getWaterY(x, z);
      if (water != null && water > g + 0.05) return;
      addLog(t, `${t.fells}-${i}`, x, g, z, r, len, ((i * 37) % 7 - 3) * 0.08);
      made += 1;
    });
    if (!made) {
      const x = t.cx - t.dirZ * (t.r + 0.8);
      const z = t.cz + t.dirX * (t.r + 0.8);
      addLog(t, `${t.fells}-0`, x, T.groundAt(x, z, t.by), z, r, len, 0);
    }
  };
  const addLog = (t, k, x, g, z, r, len, yaw) => {
    const dir = new THREE.Vector3(t.dirX, 0, t.dirZ).applyAxisAngle(UP, yaw);
    const mesh = new THREE.Mesh(logGeo, woodMats);
    mesh.quaternion.setFromUnitVectors(UP, dir);
    mesh.scale.set(r, len, r);
    mesh.position.set(x, g + r - 2 * r, z);
    mesh.castShadow = true;
    group.add(mesh);
    t.logs.push({ k, mesh, x, z, y: g + r, r, len, dx: dir.x, dz: dir.z, popAt: T.simT });
  };

  // A log split: two halves fly apart and shrink away
  const splitLog = (t, log) => {
    t.logs.splice(t.logs.indexOf(log), 1);
    log.mesh.parent?.remove(log.mesh);
    for (const side of [-1, 1]) {
      const m = new THREE.Mesh(logGeo, woodMats);
      m.quaternion.copy(log.mesh.quaternion);
      m.scale.set(log.r, log.len / 2, log.r);
      m.position.set(log.x + log.dx * side * log.len / 4, log.y, log.z + log.dz * side * log.len / 4);
      group.add(m);
      halves.push({ mesh: m, life: 0.8, vx: log.dx * side * 1.6 - log.dz * 0.6, vz: log.dz * side * 1.6 + log.dx * 0.6, vy: 2.2, floor: log.y - log.r, s: log.r, len: log.len / 2 });
    }
    burst(log.x, log.y + log.r, log.z, 0, 0, 8, 1.4);
    ctx.playSfx('chop');
  };
  const updateHalves = (dt) => {
    for (let i = halves.length - 1; i >= 0; i--) {
      const h = halves[i];
      h.life -= dt;
      if (h.life <= 0) { h.mesh.parent?.remove(h.mesh); halves.splice(i, 1); continue; }
      h.vy -= GRAVITY * dt;
      h.mesh.position.x += h.vx * dt;
      h.mesh.position.z += h.vz * dt;
      h.mesh.position.y = Math.max(h.floor + h.s, h.mesh.position.y + h.vy * dt);
      h.mesh.rotateX(5 * dt);
      const k = Math.min(1, h.life / 0.3);
      h.mesh.scale.set(h.s * k, h.len * k, h.s * k);
    }
  };

  // ── The player's sword tip at `tip` (world): a log or a tree it chops. True when it did. ──
  const tryChop = (tip) => {
    if (!group) return false;
    const p = T.playerPos();
    // a log
    for (const t of trees) {
      for (const log of t.logs) {
        if (dist2(log.x, log.z, p.x, p.z) > 3) continue;
        if (tip.y < log.y - log.r - 0.3 || tip.y > log.y + log.r + 0.7) continue;
        const along = THREE.MathUtils.clamp((tip.x - log.x) * log.dx + (tip.z - log.z) * log.dz, -log.len / 2, log.len / 2);
        if (dist2(log.x + log.dx * along, log.z + log.dz * along, tip.x, tip.z) > log.r + 0.35) continue;
        if (T.simT - logHitAt < HIT_GAP_S) return true;
        logHitAt = T.simT;
        if (T.bagRoom() <= 0) { ctx.playSfx('chop'); T.bagFullNote(); return true; }
        splitLog(t, log);
        T.gain('wood');
        T.feedLine(`+1 Wood (${T.goods.wood})`);
        if (T.net && T.netMode !== 'off' && T.netMode !== 'joining') T.net.broadcast({ w: 1, op: 'tree', t: String(t.id), a: 'log', k: log.k });
        return true;
      }
    }
    // a tree
    for (const t of trees) {
      if (!t.object || dist2(t.bx, t.bz, p.x, p.z) > 3.5) continue;
      if (t.state !== 'standing' && t.state !== 'growing') continue;
      if (dist2(t.bx, t.bz, tip.x, tip.z) > 1.8) continue;
      measureTrunk(t);
      if (dist2(t.cx, t.cz, tip.x, tip.z) > t.r + CHOP_REACH) continue;
      if (tip.y < t.gy + 0.1 || tip.y > t.gy + 2.6) continue;
      if (T.simT - t.hitAt < HIT_GAP_S) return true;
      if (t.state === 'growing') {
        t.hitAt = T.simT;
        if (T.simT - youngNoteAt > 4) { youngNoteAt = T.simT; T.feedLine('This tree is still growing.'); }
        return true;
      }
      hitTree(t, tip);
      return true;
    }
    return false;
  };

  // ── Each frame ──
  const updateTree = (t, dt) => {
    const now = T.simT;
    switch (t.state) {
      case 'standing': {
        const k = (now - (t.shakeAt ?? -99)) / SHAKE_S;
        if (k >= 1) { pose(t); active.delete(t); return; }
        pose(t, t.shakeAmp * Math.exp(-5 * k) * Math.cos(k * 14));
        return;
      }
      case 'falling': {
        // a falling pole: it speeds up as it goes over; bounces where it lands
        t.spin += (3 * GRAVITY / (2 * t.height)) * Math.sin(t.angle) * dt;
        t.angle += t.spin * dt;
        if (t.angle >= t.endAngle) {
          t.angle = t.endAngle;
          if (!t.landed) {
            t.landed = true;
            ctx.playSfx('fell');
            const d = t.height * 0.5;
            burst(t.bx + t.dirX * d, t.gy + 0.2, t.bz + t.dirZ * d, t.dirX, t.dirZ, 10, 1.2);
          }
          t.spin = -t.spin * 0.25;
          if (Math.abs(t.spin) < 0.35) { t.spin = 0; t.state = 'lying'; t.until = now + TREE_LIE_S; }
        }
        pose(t, t.angle);
        return;
      }
      case 'lying':
        if (now < t.until) return;
        spawnLogs(t);
        t.state = 'sinking';
        t.from = now;
        return;
      case 'sinking': {
        const k = Math.min(1, (now - t.from) / TREE_SINK_S);
        pose(t, t.angle, k * k * 2.5, 1 - 0.3 * k);
        if (k < 1) return;
        t.object.visible = false;
        pose(t, 0, 0, 0.001); // (tiny: hidden things still stop bullets)
        t.state = 'stump';
        t.until = now + TREE_STUMP_S;
        return;
      }
      case 'stump':
        if (now < t.until) return;
        t.state = 'growing';
        t.from = now;
        t.object.visible = true;
        return;
      case 'growing': {
        const k = Math.min(1, (now - t.from) / TREE_GROW_S);
        pose(t, 0, 0, 0.08 + 0.92 * k * k * (3 - 2 * k));
        // the stump goes as the sapling comes up
        if (t.stump?.visible) {
          const s = 1 - Math.min(1, (now - t.from) / 3);
          t.stump.position.y = t.gy - 0.05 - (1 - s) * 0.8;
          if (s <= 0) t.stump.visible = false;
        }
        if (k < 1) return;
        pose(t);
        t.state = 'standing';
        t.hits = 0;
        active.delete(t);
        return;
      }
      default:
    }
  };
  const updateTrees = (dt) => {
    if (!group) return;
    for (const t of active) updateTree(t, dt);
    // logs pop up out of the ground
    for (const t of trees) {
      for (const log of t.logs) {
        if (log.popAt == null) continue;
        const k = Math.min(1, (T.simT - log.popAt) / 0.35);
        log.mesh.position.y = log.y - 2 * log.r * (1 - k) + Math.sin(k * Math.PI) * 0.15;
        if (k >= 1) log.popAt = null;
      }
    }
    updateChips(dt);
    updateHalves(dt);
  };

  // ── Leaving Town: every tree back as it was ──
  const resetTrees = () => {
    for (const t of trees) {
      if (!t.object || !t.q0) continue;
      pose(t);
      t.object.visible = true;
      t.state = 'standing';
      t.hits = 0;
      t.shakeAt = null;
      if (t.notch) { t.notch.parent?.remove(t.notch); t.notch = null; }
      t.notchH = null;
      if (t.stump) t.stump.visible = false;
      for (const log of t.logs) log.mesh.parent?.remove(log.mesh);
      t.logs = [];
    }
    active.clear();
    for (const h of halves) h.mesh.parent?.remove(h.mesh);
    halves.length = 0;
    for (const c of chips) { c.life = 0; c.mesh.visible = false; }
  };

  // ── Shared town: another player felled a tree / split a log ──
  const handleTreeNet = (from, d) => {
    if (d.op !== 'tree') return false;
    if (!T.ready || !group) return true;
    const t = byId.get(String(d.t));
    if (!t) return true;
    if (d.a === 'fell' && Array.isArray(d.d) && (t.state === 'standing' || t.state === 'growing')) {
      const [x, z] = d.d.map(Number);
      const l = Math.hypot(x, z);
      if (!(l > 0.1)) return true;
      if (t.state === 'growing') pose(t);
      fell(t, x / l, z / l, false);
    } else if (d.a === 'log') {
      const log = t.logs.find((g) => g.k === d.k);
      if (log) splitLog(t, log);
    } else {
      return true;
    }
    if (T.netMode === 'host') for (const pid of T.net.peerIds()) if (pid !== from) T.net.send(pid, d);
    return true;
  };

  Object.assign(T, { buildTrees, handleTreeNet, resetTrees, tryChop, updateTrees });
}

import * as THREE from 'three';
import { raycastMapSegment } from '../environment/mapCollision.js';

// Sword swings + combo attacks (the phone-sword loop in bootstrapGameApp.js drives it).
//
// Swings: every frame the sword's tip moves fast counts toward a swing; a pause of SWING_GAP_S
// or the tip turning back on itself starts the next one (`swingId`). Each target can be hit
// once per swing (with HIT_MIN_GAP_S between hits), so three quick swings land three hits —
// one right after the other.
//
// Combo: COMBO_HITS hits, each from a new swing within COMBO_GAP_S of the last, charge a combo
// attack for COMBO_READY_S (a chime, the trail turns gold, a hint on screen). The next swing
// picks it by its direction in the player's frame (its elevation, COMBO_ELEV_DEG):
//   down-ish   → Ground Pound: a shockwave round the player's feet (POUND_*)
//   across     → Spin Attack: a blade of light sweeps all the way round (SPIN_*)
//   up-ish     → Sky Slash: a vertical crescent flies forward SLICE_RANGE m, through everyone
//                in its way, stopped by the map (SLICE_*)
//
// ctx: { scene, getPlayer() → the player's model, getTargets() → enemy-like targets (group,
// applyDamage(n, fromPos), applyBlastKnockback / applyDirectKnockback, isDead — as bombs hit),
// getPvpTargets() → other players ({ position, center, onHit(dmg, dir) }), canCombo() → combos
// allowed now, onTargetHit(target), onImpact(kind, pos) (shake / sound), onState(text|null, kind) }
export const SWING_GAP_S = 0.07;
export const HIT_MIN_GAP_S = 0.16;
export const COMBO_HITS = 3;
export const COMBO_GAP_S = 0.9;
export const COMBO_READY_S = 2.2;
const COMBO_SWING_MIN = 0.3;    // m the tip travels in the combo swing before it's read
const COMBO_SWING_READ_S = 0.14; // …or this long into it (with half that travel)
const COMBO_ELEV_DEG = 35;

const POUND_DELAY_S = 0.08;
const POUND_RADIUS = 4.5;
const POUND_AHEAD = 1.0;
const POUND_DAMAGE = 2;
const POUND_RING_S = 0.45;

const SPIN_RADIUS = 3.6;
const SPIN_DAMAGE = 2;
const SPIN_S = 0.36;
const SPIN_HEIGHT = 1.0;
const SPIN_WEDGE = 1.7;         // rad of the trailing wedge of light

const SLICE_RANGE = 10;
const SLICE_SPEED = 26;
const SLICE_DAMAGE = 2;
const SLICE_HALF_WIDTH = 0.9;   // m to either side of its path it hits
const SLICE_HEIGHT = 1.0;       // m over the feet it flies at
const SLICE_RADIUS = 1.25;       // the crescent's size

const COLOR = new THREE.Color(0xffd36a);
const COLOR_SLICE = new THREE.Color(0xbfe8ff);

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();

const additive = () => new THREE.MeshBasicMaterial({
  vertexColors: true, transparent: true, depthWrite: false,
  blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false,
});

// A flat ring (XZ plane), its inner edge dim
function ringGeometry(inner, outer, seg = 64) {
  const pos = [], col = [], idx = [];
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2, s = Math.sin(a), c = Math.cos(a);
    pos.push(s * inner, 0, c * inner, s * outer, 0, c * outer);
    col.push(0.15, 0.15, 0.15, 1, 1, 1);
    if (i < seg) { const k = i * 2; idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
}

// The spin's wedge: leading edge at bearing 0 (+Z), trailing back `wedge` rad the other way
// from `sign`, bright at the leading edge and the rim
function wedgeGeometry(inner, outer, wedge, sign, seg = 28) {
  const pos = [], col = [], idx = [];
  for (let i = 0; i <= seg; i++) {
    const u = i / seg;
    const a = -sign * u * wedge, s = Math.sin(a), c = Math.cos(a);
    const f = (1 - u) * (1 - u);
    pos.push(s * inner, 0, c * inner, s * outer, 0, c * outer);
    col.push(f * 0.1, f * 0.1, f * 0.1, f, f, f);
    if (i < seg) { const k = i * 2; idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
}

// The slash's wave: a tall blade of light standing upright across the way it flies (+Z),
// its middle bulging forward like a crescent seen from the side — from behind, a tall lens,
// bright down its middle
function crescentGeometry(r, seg = 24) {
  const pos = [], col = [], idx = [];
  const half = Math.PI * 0.42;
  for (let i = 0; i <= seg; i++) {
    const u = i / seg;
    const a = -half + u * half * 2;
    const th = Math.sin(u * Math.PI); // 0 at the ends, 1 in the middle
    const y = Math.sin(a) * r, z = (Math.cos(a) - Math.cos(half)) * r * 0.45;
    const w = 0.32 * th;
    pos.push(-w, y, z, 0, y, z + 0.05 * th, w, y, z);
    col.push(0, 0, 0, th, th, th, 0, 0, 0);
    if (i < seg) {
      const k = i * 3;
      idx.push(k, k + 3, k + 1, k + 1, k + 3, k + 4, k + 1, k + 4, k + 2, k + 2, k + 4, k + 5);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
}

export function createSwordCombo(ctx) {
  const { scene } = ctx;
  // Swing segmentation
  let swingId = 0;
  let inSwing = false;
  let lastFastAt = -Infinity;
  const swingStart = new THREE.Vector3();
  let swingStartAt = 0;
  // Combo
  let hitCount = 0, lastHitAt = -Infinity, lastHitSwing = -1;
  let ready = false, readyUntil = 0, readySwing = -1;
  const effects = []; // { update(dt, now) → false when done, dispose() }

  const setState = (text, kind) => ctx.onState?.(text, kind);

  const facing = (model) => _v.set(0, 0, 1).applyQuaternion(model.quaternion).setY(0).normalize();

  // ── Hitting ──
  const hitTarget = (t, dmg, dir, falloff, from) => {
    if (!t || t.isDead || !t.group) return;
    for (let i = 0; i < dmg && !t.isDead; i++) t.applyDamage?.(1, from);
    if (typeof t.applyBlastKnockback === 'function') t.applyBlastKnockback({ direction: dir, falloff });
    else t.applyDirectKnockback?.({ direction: dir, horizSpeed: 9 * falloff, upVelocity: 2.5 });
    ctx.onTargetHit?.(t);
  };
  const hitPvp = (o, dmg, dir) => { o.onHit?.(dmg, dir.clone()); ctx.onPvpHit?.(o); };
  const outward = (from, to) => {
    const d = new THREE.Vector3(to.x - from.x, 0, to.z - from.z);
    return d.lengthSq() > 1e-6 ? d.normalize() : d.set(0, 0, 1);
  };

  // ── Ground Pound ──
  const groundPound = (model) => {
    const center = model.position.clone().addScaledVector(facing(model), POUND_AHEAD);
    center.y = model.position.y;
    const from = model.position.clone();
    const rings = [0, 1].map((k) => {
      const m = new THREE.Mesh(ringGeometry(k ? 0.55 : 0.8, 1, 64), additive());
      m.material.color.copy(COLOR);
      m.position.copy(center).setY(center.y + 0.06 + k * 0.03);
      m.scale.setScalar(0.01);
      m.renderOrder = 2;
      m.frustumCulled = false;
      m.visible = false;
      scene.add(m);
      return m;
    });
    const flash = new THREE.Mesh(new THREE.CircleGeometry(1, 32), new THREE.MeshBasicMaterial({
      color: COLOR, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
    }));
    flash.rotation.x = -Math.PI / 2;
    flash.position.copy(center).setY(center.y + 0.05);
    flash.visible = false;
    scene.add(flash);
    // Rocks thrown up
    const rockGeo = new THREE.BoxGeometry(0.14, 0.14, 0.14);
    const rockMat = new THREE.MeshLambertMaterial({ color: 0x7a6a55 });
    const rocks = [];
    let t = -POUND_DELAY_S;
    let struck = false;
    effects.push({
      update(dt) {
        t += dt;
        if (t < 0) return true;
        if (!struck) {
          struck = true;
          rings.forEach((r) => { r.visible = true; });
          flash.visible = true;
          for (let i = 0; i < 14; i++) {
            const m = new THREE.Mesh(rockGeo, rockMat);
            const a = Math.random() * Math.PI * 2, r = 0.4 + Math.random() * 1.4;
            m.position.set(center.x + Math.sin(a) * r, center.y + 0.1, center.z + Math.cos(a) * r);
            m.userData.v = new THREE.Vector3(Math.sin(a) * (2 + Math.random() * 3), 3 + Math.random() * 4, Math.cos(a) * (2 + Math.random() * 3));
            m.userData.floor = center.y;
            scene.add(m);
            rocks.push(m);
          }
          ctx.onImpact?.('pound', center);
          for (const e of ctx.getTargets?.() ?? []) {
            if (!e || e.isDead || !e.group) continue;
            const d = Math.hypot(e.group.position.x - center.x, e.group.position.z - center.z);
            if (d > POUND_RADIUS || Math.abs(e.group.position.y - center.y) > 2.5) continue;
            hitTarget(e, POUND_DAMAGE, outward(center, e.group.position), 1 - 0.6 * d / POUND_RADIUS, from);
          }
          for (const o of ctx.getPvpTargets?.() ?? []) {
            if (Math.hypot(o.position.x - center.x, o.position.z - center.z) > POUND_RADIUS) continue;
            hitPvp(o, POUND_DAMAGE, outward(center, o.position));
          }
        }
        const u = Math.min(1, t / POUND_RING_S);
        const ease = 1 - (1 - u) * (1 - u);
        rings[0].scale.setScalar(Math.max(0.01, POUND_RADIUS * ease));
        rings[1].scale.setScalar(Math.max(0.01, POUND_RADIUS * 0.7 * Math.min(1, ease * 1.2)));
        rings.forEach((r, k) => r.material.color.copy(COLOR).multiplyScalar((1 - u) * (k ? 0.6 : 1)));
        flash.scale.setScalar(1.2 + u * 1.5);
        flash.material.opacity = Math.max(0, 0.7 - u * 2);
        for (const m of rocks) {
          m.userData.v.y -= 18 * dt;
          m.position.addScaledVector(m.userData.v, dt);
          m.rotation.x += dt * 8; m.rotation.z += dt * 6;
          if (m.position.y < m.userData.floor) { m.position.y = m.userData.floor; m.userData.v.multiplyScalar(0.3); }
        }
        if (t > 1.0) { rocks.forEach((m) => { m.scale.setScalar(Math.max(0.01, 1 - (t - 1) * 3)); }); }
        return t < 1.35;
      },
      dispose() {
        rings.forEach((r) => { scene.remove(r); r.geometry.dispose(); r.material.dispose(); });
        scene.remove(flash); flash.geometry.dispose(); flash.material.dispose();
        rocks.forEach((m) => scene.remove(m));
        rockGeo.dispose(); rockMat.dispose();
      },
    });
  };

  // ── Spin Attack ── (`sign`: +1 sweeps toward the player's +X — the swing's way)
  const spinAttack = (model, sign) => {
    const group = new THREE.Group();
    const wedge = new THREE.Mesh(wedgeGeometry(0.5, SPIN_RADIUS, SPIN_WEDGE, sign), additive());
    wedge.material.color.copy(COLOR);
    wedge.renderOrder = 2;
    wedge.frustumCulled = false;
    group.add(wedge);
    scene.add(group);
    const fwd = facing(model).clone();
    const start = Math.atan2(fwd.x, fwd.z) - sign * Math.PI * 0.5; // (from the swing's start side)
    const hit = new Set();
    let t = 0;
    ctx.onImpact?.('spin', model.position);
    effects.push({
      update(dt) {
        t += dt;
        const u = Math.min(1, t / SPIN_S);
        const swept = u * Math.PI * 2;
        group.position.copy(model.position).setY(model.position.y + SPIN_HEIGHT);
        group.rotation.y = start + sign * swept;
        const fade = t < SPIN_S ? 1 : Math.max(0, 1 - (t - SPIN_S) / 0.18);
        wedge.material.color.copy(COLOR).multiplyScalar(fade);
        if (u <= 1) {
          const c = model.position;
          for (const e of ctx.getTargets?.() ?? []) {
            if (!e || e.isDead || !e.group || hit.has(e)) continue;
            const dx = e.group.position.x - c.x, dz = e.group.position.z - c.z;
            const d = Math.hypot(dx, dz);
            if (d > SPIN_RADIUS || Math.abs(e.group.position.y - c.y) > 2) continue;
            // (reached once the sweep has passed its bearing)
            let rel = sign * (Math.atan2(dx, dz) - start);
            rel = ((rel % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
            if (rel > swept && u < 1) continue;
            hit.add(e);
            hitTarget(e, SPIN_DAMAGE, outward(c, e.group.position), 0.85, c.clone());
          }
          for (const o of ctx.getPvpTargets?.() ?? []) {
            if (hit.has(o.id ?? o)) continue;
            if (Math.hypot(o.position.x - c.x, o.position.z - c.z) > SPIN_RADIUS) continue;
            hit.add(o.id ?? o);
            hitPvp(o, SPIN_DAMAGE, outward(c, o.position));
          }
        }
        return fade > 0;
      },
      dispose() { scene.remove(group); wedge.geometry.dispose(); wedge.material.dispose(); },
    });
  };

  // ── Sky Slash ──
  const skySlash = (model) => {
    const dir = facing(model).clone();
    const mesh = new THREE.Mesh(crescentGeometry(SLICE_RADIUS), additive());
    mesh.material.color.copy(COLOR_SLICE);
    mesh.renderOrder = 2;
    mesh.frustumCulled = false;
    const pos = model.position.clone().addScaledVector(dir, 0.7);
    pos.y += SLICE_HEIGHT;
    mesh.position.copy(pos);
    mesh.quaternion.setFromUnitVectors(_v2.set(0, 0, 1), dir);
    scene.add(mesh);
    const prev = new THREE.Vector3();
    const hit = new Set();
    let travelled = 0, dying = 0, gone = false;
    ctx.onImpact?.('slice', pos);
    effects.push({
      update(dt) {
        if (gone) {
          dying += dt;
          mesh.scale.setScalar(1 + dying * 4);
          mesh.material.color.copy(COLOR_SLICE).multiplyScalar(Math.max(0, 1 - dying / 0.15));
          return dying < 0.15;
        }
        prev.copy(mesh.position);
        const step = Math.min(SLICE_SPEED * dt, SLICE_RANGE - travelled);
        mesh.position.addScaledVector(dir, step);
        travelled += step;
        const wall = raycastMapSegment(prev, mesh.position);
        if (wall) { mesh.position.copy(wall.point); gone = true; }
        // Everyone near the stretch it flew this frame
        const seg = _v.subVectors(mesh.position, prev);
        const len2 = Math.max(1e-6, seg.lengthSq());
        const near = (p, y0) => {
          const k = THREE.MathUtils.clamp(((p.x - prev.x) * seg.x + (p.z - prev.z) * seg.z) / len2, 0, 1);
          const cx = prev.x + seg.x * k, cz = prev.z + seg.z * k, cy = prev.y + seg.y * k;
          return Math.hypot(p.x - cx, p.z - cz) <= SLICE_HALF_WIDTH && Math.abs(y0 + 0.9 - cy) < 1.6;
        };
        for (const e of ctx.getTargets?.() ?? []) {
          if (!e || e.isDead || !e.group || hit.has(e)) continue;
          if (!near(e.group.position, e.group.position.y)) continue;
          hit.add(e);
          hitTarget(e, SLICE_DAMAGE, dir, 0.8, prev.clone());
        }
        for (const o of ctx.getPvpTargets?.() ?? []) {
          if (hit.has(o.id ?? o) || !near(o.position, o.position.y)) continue;
          hit.add(o.id ?? o);
          hitPvp(o, SLICE_DAMAGE, dir);
        }
        mesh.scale.setScalar(1 + travelled / SLICE_RANGE * 0.5);
        const fadeStart = SLICE_RANGE - 2;
        const f = travelled > fadeStart ? Math.max(0, 1 - (travelled - fadeStart) / 2) : 1;
        mesh.material.color.copy(COLOR_SLICE).multiplyScalar(f);
        if (travelled >= SLICE_RANGE - 1e-4) gone = true;
        return true;
      },
      dispose() { scene.remove(mesh); mesh.geometry.dispose(); mesh.material.dispose(); },
    });
  };

  const fire = (kind, model, sign) => {
    ready = false;
    hitCount = 0;
    const names = { pound: 'Ground Pound!', spin: 'Spin Attack!', slice: 'Sky Slash!' };
    setState(names[kind], 'attack');
    if (kind === 'pound') groundPound(model);
    else if (kind === 'spin') spinAttack(model, sign);
    else skySlash(model);
  };

  // Each frame the sword is out (tip + last frame's tip, `fast` = the tip moving at hit speed)
  const frame = (tip, prevTip, fast, nowSec) => {
    if (fast && prevTip) {
      const frameVec = _v2.subVectors(tip, prevTip);
      let fresh = !inSwing || nowSec - lastFastAt > SWING_GAP_S;
      if (!fresh) {
        const sv = _v.subVectors(prevTip, swingStart);
        const svLen = sv.length();
        // (the tip turning back on itself: a new swing the other way)
        if (svLen > 0.12 && frameVec.dot(sv) < -0.3 * svLen * frameVec.length()) fresh = true;
      }
      if (fresh) {
        swingId += 1;
        swingStart.copy(prevTip);
        swingStartAt = nowSec;
      }
      inSwing = true;
      lastFastAt = nowSec;
    } else if (nowSec - lastFastAt > SWING_GAP_S) {
      inSwing = false;
    }
    if (ready && nowSec > readyUntil) {
      ready = false;
      hitCount = 0;
      setState(null);
    }
    // The combo swing: read its direction and let the attack go
    if (ready && inSwing && swingId > readySwing && ctx.canCombo?.() !== false) {
      const travel = _v.subVectors(tip, swingStart);
      const len = travel.length();
      if (len >= COMBO_SWING_MIN || (nowSec - swingStartAt >= COMBO_SWING_READ_S && len >= COMBO_SWING_MIN * 0.5)) {
        const model = ctx.getPlayer?.();
        if (model) {
          _q.copy(model.quaternion).invert();
          const local = travel.clone().applyQuaternion(_q);
          const elev = Math.atan2(local.y, Math.hypot(local.x, local.z)) * 180 / Math.PI;
          const kind = elev < -COMBO_ELEV_DEG ? 'pound' : elev > COMBO_ELEV_DEG ? 'slice' : 'spin';
          fire(kind, model, local.x >= 0 ? 1 : -1);
        }
      }
    }
    return swingId;
  };

  // A sword hit landed (enemy / other player / townsperson) — counts toward the combo
  const noteHit = (nowSec) => {
    if (swingId === lastHitSwing || ready) return;
    if (nowSec - lastHitAt > COMBO_GAP_S) hitCount = 0;
    hitCount += 1;
    lastHitAt = nowSec;
    lastHitSwing = swingId;
    if (hitCount >= COMBO_HITS && ctx.canCombo?.() !== false) {
      ready = true;
      readyUntil = nowSec + COMBO_READY_S;
      readySwing = swingId;
      setState('Combo ready! Swing down, across or up', 'ready');
    }
  };

  // Combo broken (blocked, hurt, sword put away…) — a charged attack is kept until it runs out
  const breakChain = () => { hitCount = 0; };

  let timeScale = 1; // (dev console: slow motion — swordCombo.setTimeScale(0.1))
  const update = (dt) => {
    dt *= timeScale;
    for (let i = effects.length - 1; i >= 0; i--) {
      if (!effects[i].update(dt)) { effects[i].dispose(); effects.splice(i, 1); }
    }
  };

  const clear = () => {
    for (const e of effects) e.dispose();
    effects.length = 0;
    ready = false; hitCount = 0; inSwing = false;
    setState(null);
  };

  return {
    frame, noteHit, breakChain, update, clear,
    get swingId() { return swingId; },
    isReady: () => ready,
    debug: () => ({ swingId, inSwing, hitCount, ready, readyUntil, effects: effects.length }),
    // (dev console: fire one without the hits)
    setTimeScale: (k) => { timeScale = Math.max(0, Number(k) || 0); },
    test: (kind = 'spin') => { const m = ctx.getPlayer?.(); if (m) fire(kind, m, 1); },
  };
}

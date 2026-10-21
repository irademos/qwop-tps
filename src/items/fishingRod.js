import * as THREE from 'three';
import { characterHold } from '../models/glbCharacterModel.js';

// Town fishing rod: a procedural rod built like the wand / swords — origin at the grip,
// pointing along +Z — and the rig that uses it (createFishingRig): the player holds it in
// both hands (the weapon grip targets, `foamSwordMode`), casts a bobber out onto the water,
// the line sags between the rod tip and the bobber, a bite dunks the bobber and bends the
// rod, and reeling in brings the bobber back (with a fish on the hook when one was caught).
// The game decides when (townTrade.js); this only draws it.

const ROD_SEGMENTS = [ // the blank in three nested pieces, so it can bend
  { length: 0.63, r0: 0.014, r1: 0.01 },
  { length: 0.55, r0: 0.01, r1: 0.006 },
  { length: 0.5, r0: 0.006, r1: 0.003 },
];
const HANDLE_START = 0.12; // the blank starts where the cork ends

const BLANK_COLOR = 0x6b3f1f;
const CORK_COLOR = 0xc89a62;
const WRAP_COLOR = 0xe2b64a;
const REEL_COLOR = 0x3a3d42;
const BOBBER_TOP = 0xd83a2e;
const BOBBER_BOTTOM = 0xf4f1ea;
const FISH_COLOR = 0x8fb3c9;
const LINE_COLOR = 0xe8e8e8;

// Hold + motion (player-local, before the character's grip scale)
const HOLD = { x: 0.06, y: 0.95, z: 0.38, pitch: -0.6 }; // resting: tip up ~35°
const WINDUP = { x: 0.1, y: 1.25, z: 0.12, pitch: -1.75 }; // rod back over the shoulder
const FOLLOW = { x: 0.06, y: 0.9, z: 0.5, pitch: -0.3 };   // after the whip forward
const CAST_WINDUP_S = 0.35;
const CAST_WHIP_S = 0.2;
const CAST_SETTLE_S = 0.4;
const BOBBER_FLIGHT_S = 0.65;
const BOBBER_ARC = 1.6;        // m above the straight line at the top of the cast
const REEL_S = 0.55;
const SHOW_CATCH_S = 1.3;      // the fish dangles this long before it's put away
const LINE_POINTS = 18;
const LINE_SAG = 0.12;         // slack sag per m of line
const HAND_LERP = 18;          // matches the floating hands' own follow speed

const along = (geometry) => geometry.rotateX(Math.PI / 2); // cylinder axis Y → Z
const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0.05, ...extra });
const ease = (t) => t * t * (3 - 2 * t);
const lerpPose = (a, b, t, out) => {
  out.x = a.x + (b.x - a.x) * t;
  out.y = a.y + (b.y - a.y) * t;
  out.z = a.z + (b.z - a.z) * t;
  out.pitch = a.pitch + (b.pitch - a.pitch) * t;
  return out;
};

/** A new fishing rod model; `userData.bends` = the blank's pieces, `userData.tip` = its tip. */
export function createFishingRodModel() {
  const group = new THREE.Group();
  group.name = 'fishing-rod';

  // Cork handle (both hands on it), rubber butt cap, reel hanging under the rod
  const cork = new THREE.Mesh(along(new THREE.CylinderGeometry(0.019, 0.023, 0.42, 10)), std(CORK_COLOR, { roughness: 0.95 }));
  cork.position.z = -0.09;
  const butt = new THREE.Mesh(new THREE.SphereGeometry(0.025, 10, 8), std(0x1d1d1d));
  butt.position.z = -0.3;
  const reel = new THREE.Group();
  reel.position.set(0, -0.045, -0.06);
  const spool = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.034, 0.03, 16).rotateZ(Math.PI / 2), std(REEL_COLOR, { metalness: 0.5, roughness: 0.4 }));
  const foot = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.03, 0.05), std(REEL_COLOR, { metalness: 0.5, roughness: 0.4 }));
  foot.position.y = 0.025;
  // The crank turns about the spool's axle while reeling in
  const crank = new THREE.Group();
  crank.position.x = 0.022;
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.008, 0.045), std(REEL_COLOR, { metalness: 0.5, roughness: 0.4 }));
  arm.position.z = 0.012;
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.008, 8, 6), std(CORK_COLOR));
  knob.position.set(0.008, 0, 0.032);
  crank.add(arm, knob);
  reel.add(spool, foot, crank);
  reel.userData.crank = crank;
  group.add(cork, butt, reel);

  // The blank, each piece a child of the one before (bending one bends all after it)
  const bends = [];
  let parent = group;
  let start = HANDLE_START;
  let tip = null;
  ROD_SEGMENTS.forEach((s, i) => {
    const piece = new THREE.Group();
    piece.position.z = start;
    const blank = new THREE.Mesh(along(new THREE.CylinderGeometry(s.r1, s.r0, s.length, 8)), std(BLANK_COLOR, { roughness: 0.5 }));
    blank.position.z = s.length / 2;
    piece.add(blank);
    // A guide ring (wrapped on) at the end of each piece, under the blank
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.009 - i * 0.002, 0.0018, 6, 12), std(WRAP_COLOR, { metalness: 0.6, roughness: 0.35 }));
    ring.position.set(0, -0.016 + i * 0.004, s.length - 0.02);
    const wrap = new THREE.Mesh(along(new THREE.CylinderGeometry(s.r1 + 0.002, s.r1 + 0.002, 0.02, 8)), std(WRAP_COLOR, { metalness: 0.6, roughness: 0.35 }));
    wrap.position.z = s.length - 0.02;
    piece.add(ring, wrap);
    parent.add(piece);
    bends.push(piece);
    parent = piece;
    start = s.length;
    if (i === ROD_SEGMENTS.length - 1) {
      tip = new THREE.Object3D();
      tip.name = 'rod-tip';
      tip.position.z = s.length;
      piece.add(tip);
    }
  });

  group.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  group.userData.bends = bends;
  group.userData.tip = tip;
  group.userData.reel = reel;
  return group;
}

function createBobber() {
  const g = new THREE.Group();
  const top = new THREE.Mesh(new THREE.SphereGeometry(0.05, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), std(BOBBER_TOP, { roughness: 0.4 }));
  const bottom = new THREE.Mesh(new THREE.SphereGeometry(0.05, 14, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), std(BOBBER_BOTTOM, { roughness: 0.4 }));
  const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.06, 6), std(BOBBER_TOP));
  stick.position.y = 0.07;
  g.add(top, bottom, stick);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}

function createFish() {
  const g = new THREE.Group();
  const mat = std(FISH_COLOR, { metalness: 0.35, roughness: 0.4 });
  // Hangs head up from the hook: body along Y, tail at the bottom
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.1, 14, 10), mat);
  body.scale.set(0.4, 1, 0.75);
  body.position.y = -0.1;
  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.09, 4).rotateX(Math.PI), mat);
  tail.scale.set(0.3, 1, 1);
  tail.position.y = -0.23;
  const eyeMat = std(0x111111);
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.009, 6, 5), eyeMat);
    eye.position.set(side * 0.035, -0.04, 0.03);
    g.add(eye);
  }
  g.add(body, tail);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}

function createSplash() {
  const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.07, 0.1, 24).rotateX(-Math.PI / 2), mat);
  ring.visible = false;
  return ring;
}

/**
 * The rod + line + bobber for one fisher (the local player). `start(holder, target)` casts
 * at `target` (a world point on the water surface); `update(dt, { bite })` every frame
 * (`bite` 0…1 = how hard a fish is tugging); `reel(caught)` brings it in; `stop()` puts it
 * away at once.
 */
export function createFishingRig(scene) {
  const rod = createFishingRodModel();
  const bobber = createBobber();
  const fish = createFish();
  const splash = createSplash();
  const line = new THREE.Line(
    new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(LINE_POINTS * 3), 3)),
    new THREE.LineBasicMaterial({ color: LINE_COLOR, transparent: true, opacity: 0.85 }),
  );
  line.frustumCulled = false;
  bobber.add(fish);
  fish.visible = false;
  for (const o of [bobber, splash, line]) { o.visible = false; scene.add(o); }

  let holder = null;
  let phase = 'idle';  // idle | cast | wait | reel | show
  let t = 0;
  let caught = false;
  let splashT = 1;
  const target = new THREE.Vector3();
  const tipW = new THREE.Vector3();
  const from = new THREE.Vector3();
  const pose = { ...HOLD };
  const handPos = new THREE.Vector3();
  const _p = new THREE.Vector3();

  const hide = () => {
    rod.parent?.remove(rod);
    bobber.visible = line.visible = splash.visible = fish.visible = false;
    holder = null;
    phase = 'idle';
  };
  const doSplash = (at, big = false) => {
    splash.position.set(at.x, at.y + 0.01, at.z);
    splash.userData.big = big;
    splash.visible = true;
    splashT = 0;
  };

  // The hold pose for this moment (player-local), the rod bend, where the bobber is
  const poseNow = (bite) => {
    if (phase === 'cast') {
      if (t < CAST_WINDUP_S) return lerpPose(HOLD, WINDUP, ease(t / CAST_WINDUP_S), pose);
      if (t < CAST_WINDUP_S + CAST_WHIP_S) return lerpPose(WINDUP, FOLLOW, ease((t - CAST_WINDUP_S) / CAST_WHIP_S), pose);
      return lerpPose(FOLLOW, HOLD, ease(Math.min(1, (t - CAST_WINDUP_S - CAST_WHIP_S) / CAST_SETTLE_S)), pose);
    }
    if (phase === 'reel') return lerpPose(HOLD, WINDUP, ease(Math.min(1, t / REEL_S)) * 0.55, pose);
    if (phase === 'show') return lerpPose(HOLD, WINDUP, 0.55, pose);
    // waiting: a slow sway, a jerk when it bites
    pose.x = HOLD.x;
    pose.y = HOLD.y + Math.sin(t * 1.3) * 0.01;
    pose.z = HOLD.z;
    pose.pitch = HOLD.pitch + Math.sin(t * 0.9) * 0.025 + bite * 0.25;
    return pose;
  };

  const updateLine = (sag) => {
    const arr = line.geometry.attributes.position.array;
    const end = bobber.position;
    const dist = tipW.distanceTo(end);
    for (let i = 0; i < LINE_POINTS; i++) {
      const k = i / (LINE_POINTS - 1);
      _p.lerpVectors(tipW, end, k);
      _p.y -= sag * dist * 4 * k * (1 - k);
      arr[i * 3] = _p.x;
      arr[i * 3 + 1] = _p.y;
      arr[i * 3 + 2] = _p.z;
    }
    line.geometry.attributes.position.needsUpdate = true;
    line.geometry.computeBoundingSphere();
  };

  return {
    isBusy: () => phase !== 'idle',
    isCasting: () => phase === 'cast' && t < CAST_WINDUP_S + CAST_WHIP_S + BOBBER_FLIGHT_S,
    start(newHolder, at) {
      hide();
      holder = newHolder;
      target.copy(at);
      const hold = characterHold(holder.userData?.qwopRig?.characterUrl);
      rod.scale.setScalar(hold.sword);
      handPos.set(HOLD.x, HOLD.y, HOLD.z).multiplyScalar(hold.grip);
      rod.position.copy(handPos);
      holder.add(rod);
      phase = 'cast';
      t = 0;
      caught = false;
    },
    reel(gotOne) {
      if (phase !== 'cast' && phase !== 'wait') return;
      caught = !!gotOne;
      from.copy(bobber.visible ? bobber.position : tipW);
      if (bobber.visible) doSplash(bobber.position, caught);
      phase = 'reel';
      t = 0;
    },
    stop: hide,
    update(dt, { bite = 0 } = {}) {
      if (splash.visible) {
        splashT += dt;
        const k = Math.min(1, splashT / 0.8);
        splash.scale.setScalar(1 + k * (splash.userData.big ? 5 : 3));
        splash.material.opacity = 0.6 * (1 - k);
        if (k >= 1) splash.visible = false;
      }
      if (phase === 'idle' || !holder) return;
      t += dt;

      // Hands on the cork (the weapon grip targets — consumed by updateProceduralPlayerRig)
      const p = poseNow(bite);
      const hold = characterHold(holder.userData?.qwopRig?.characterUrl);
      holder.userData.foamSwordMode = true;
      const hand = holder.userData.foamSwordHandTarget ?? (holder.userData.foamSwordHandTarget = { x: 0, y: 0, z: 0 });
      hand.x = p.x; hand.y = p.y; hand.z = p.z;
      _p.set(p.x, p.y, p.z).multiplyScalar(hold.grip);
      handPos.lerp(_p, 1 - Math.exp(-HAND_LERP * dt));
      rod.position.copy(handPos);
      rod.rotation.set(p.pitch, 0, 0);

      // The blank bends toward the bobber under load (a bite, reeling in a fish)
      const load = phase === 'wait' ? bite * 0.9
        : phase === 'reel' ? (caught ? 0.7 : 0.25) * (1 - Math.min(1, t / REEL_S))
        : phase === 'show' ? 0.35 : 0;
      rod.userData.bends.forEach((b, i) => { b.rotation.x = load * (0.1 + i * 0.12); });
      rod.userData.reel.userData.crank.rotation.x = phase === 'reel' ? t * 25 : 0;

      rod.updateWorldMatrix(true, true);
      rod.userData.tip.getWorldPosition(tipW);

      let sag = LINE_SAG;
      if (phase === 'cast') {
        // The bobber leaves the tip as the whip ends and arcs out to the target
        const fly = (t - CAST_WINDUP_S - CAST_WHIP_S * 0.6) / BOBBER_FLIGHT_S;
        if (fly <= 0) {
          bobber.position.copy(tipW);
          bobber.position.y -= 0.25;
          if (t > CAST_WINDUP_S * 0.5) from.copy(bobber.position);
        } else if (fly < 1) {
          bobber.position.lerpVectors(from, target, fly);
          bobber.position.y += BOBBER_ARC * 4 * fly * (1 - fly);
          sag = 0.02;
        } else {
          bobber.position.copy(target);
          doSplash(target);
          phase = 'wait';
          t = 0;
        }
        bobber.visible = line.visible = true;
      } else if (phase === 'wait') {
        // Bobbing on the swell; a bite pulls it under and twitches it about
        const twitch = bite > 0 ? Math.sin(t * 38) * 0.03 * bite : 0;
        bobber.position.set(
          target.x + twitch,
          target.y + Math.sin(t * 2.2) * 0.015 - bite * 0.09,
          target.z + twitch * 0.6,
        );
        if (bite > 0.6 && Math.random() < dt * 4) doSplash(bobber.position);
        sag = LINE_SAG * (1 - bite);
      } else if (phase === 'reel') {
        // Line comes in fast: the bobber skims back and swings up to hang below the tip
        const k = Math.min(1, t / REEL_S);
        _p.copy(tipW);
        _p.y -= 0.45;
        bobber.position.lerpVectors(from, _p, ease(k));
        bobber.position.y += 0.4 * Math.sin(Math.PI * k);
        fish.visible = caught && k > 0.15;
        sag = 0.02;
        if (k >= 1) {
          if (!caught) { hide(); return; }
          phase = 'show';
          t = 0;
        }
      } else if (phase === 'show') {
        // The catch dangles and wriggles, then it all goes in the bag
        bobber.position.copy(tipW);
        bobber.position.y -= 0.45;
        fish.rotation.z = Math.sin(t * 14) * 0.35 * Math.max(0, 1 - t / SHOW_CATCH_S);
        fish.rotation.y = t * 1.5;
        sag = 0;
        if (t > SHOW_CATCH_S) { hide(); return; }
      }
      updateLine(sag);
    },
    dispose() {
      hide();
      for (const o of [bobber, splash, line]) scene.remove(o);
      for (const root of [rod, bobber, splash, line]) {
        root.traverse((o) => { o.geometry?.dispose?.(); o.material?.dispose?.(); });
      }
    },
  };
}

import * as THREE from 'three';

// Town fishing rod: a procedural rod built like the wand / swords — origin at the grip,
// pointing along +Z — so the game holds it as the sword weapon in rod form (FoamSword.rod,
// gyro-driven like the sword), and the rig that fishes with it (createFishingRig): a bobber
// cast out onto the water, the line between the rod tip and the bobber (slack while it floats,
// taut with a fish on), a bite dunks it, a hooked fish drags it about and bends the rod,
// reeling turns the crank, and reeling in brings the bobber back (with the fish on the hook
// when one was landed). The game decides when (townTrade.js); this only draws it.

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

// Held as the sword weapon, the rod leans forward of the sword's pose (rad about its grip's X):
// with the phone held like a sword it rests tip-up out in front, and pulling the phone back
// brings it up
export const ROD_HOLD_PITCH = 0.75;

const BOBBER_FLIGHT_S = [0.45, 0.9]; // s — a short cast … the longest
const BOBBER_ARC = 0.3;        // m above the straight line at the top of the cast, per m cast
const REEL_S = 0.55;
const SHOW_CATCH_S = 1.3;      // the fish dangles this long before it's put away
const LINE_POINTS = 18;
const LINE_SAG = 0.12;         // slack sag per m of line

const along = (geometry) => geometry.rotateX(Math.PI / 2); // cylinder axis Y → Z
const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0.05, ...extra });
const ease = (t) => t * t * (3 - 2 * t);

// (found by name, not kept in userData: Object3D.clone copies userData through JSON)
const rodParts = (rod) => ({
  tip: rod.getObjectByName('rod-tip'),
  crank: rod.getObjectByName('rod-crank'),
  bends: ROD_SEGMENTS.map((_, i) => rod.getObjectByName(`rod-piece-${i}`)).filter(Boolean),
});

/** A new fishing rod model (its tip is the `rod-tip` object, the blank's pieces `rod-piece-<i>`). */
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
  crank.name = 'rod-crank';
  crank.position.x = 0.022;
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.008, 0.045), std(REEL_COLOR, { metalness: 0.5, roughness: 0.4 }));
  arm.position.z = 0.012;
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.008, 8, 6), std(CORK_COLOR));
  knob.position.set(0.008, 0, 0.032);
  crank.add(arm, knob);
  reel.add(spool, foot, crank);
  group.add(cork, butt, reel);

  // The blank, each piece a child of the one before (bending one bends all after it)
  let parent = group;
  let start = HANDLE_START;
  ROD_SEGMENTS.forEach((s, i) => {
    const piece = new THREE.Group();
    piece.name = `rod-piece-${i}`;
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
    parent = piece;
    start = s.length;
    if (i === ROD_SEGMENTS.length - 1) {
      const tip = new THREE.Object3D();
      tip.name = 'rod-tip';
      tip.position.z = s.length;
      piece.add(tip);
    }
  });

  group.traverse((o) => { if (o.isMesh) o.castShadow = true; });
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
 * The line + bobber (+ the catch) for one fisher (the local player), on the rod they hold.
 * `cast(rod, target)` flies the bobber from the rod tip to `target` (a world point on the
 * water); `update(dt, { bite, load, fish, crank })` every frame — bite 0…1: a fish tugging at
 * the floating bobber; load 0…1: how hard the rod bends; fish {x, z}: where the bobber is
 * (reeled in a little, or a hooked fish dragging it under there); crank: radians the reel turned this frame; `reel(caught)` brings it in;
 * `stop()` takes it all away at once (the rod itself is the game's).
 */
export function createFishingRig(scene) {
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

  let rod = null;
  let parts = null;
  let phase = 'idle';  // idle | cast | wait | fight | reel | show
  let t = 0;
  let flightS = BOBBER_FLIGHT_S[0];
  let caught = false;
  let splashT = 1;
  const target = new THREE.Vector3();
  const tipW = new THREE.Vector3();
  const from = new THREE.Vector3();
  const _p = new THREE.Vector3();

  const unbend = () => {
    parts?.bends.forEach((b) => { b.rotation.x = 0; });
    if (parts?.crank) parts.crank.rotation.x = 0;
  };
  const hide = () => {
    unbend();
    bobber.visible = line.visible = splash.visible = fish.visible = false;
    rod = null;
    parts = null;
    phase = 'idle';
  };
  const doSplash = (at, big = false) => {
    splash.position.set(at.x, target.y + 0.01, at.z);
    splash.userData.big = big;
    splash.visible = true;
    splashT = 0;
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
    phase: () => phase,
    isBusy: () => phase !== 'idle',
    // The bobber's in the water (a fish can bite / be on)
    isOut: () => phase === 'wait' || phase === 'fight',
    bobberPosition: () => bobber.position,
    cast(holdRod, at) {
      hide();
      rod = holdRod;
      parts = rodParts(rod);
      if (!parts.tip) { hide(); return; }
      target.copy(at);
      rod.updateWorldMatrix(true, true);
      parts.tip.getWorldPosition(from);
      const d = Math.hypot(at.x - from.x, at.z - from.z);
      flightS = THREE.MathUtils.clamp(d / 10, 0, 1) * (BOBBER_FLIGHT_S[1] - BOBBER_FLIGHT_S[0]) + BOBBER_FLIGHT_S[0];
      phase = 'cast';
      t = 0;
      caught = false;
    },
    // A fish took the hook: from here `fish` moves the bobber
    hook() {
      if (phase !== 'wait') return;
      doSplash(bobber.position, true);
      phase = 'fight';
      t = 0;
    },
    reel(gotOne) {
      if (phase !== 'cast' && phase !== 'wait' && phase !== 'fight') return;
      caught = !!gotOne;
      from.copy(bobber.visible ? bobber.position : tipW);
      if (bobber.visible) doSplash(bobber.position, caught);
      phase = 'reel';
      t = 0;
    },
    stop: hide,
    update(dt, { bite = 0, load = 0, fish: fishAt = null, crank = 0 } = {}) {
      if (splash.visible) {
        splashT += dt;
        const k = Math.min(1, splashT / 0.8);
        splash.scale.setScalar(1 + k * (splash.userData.big ? 5 : 3));
        splash.material.opacity = 0.6 * (1 - k);
        if (k >= 1) splash.visible = false;
      }
      if (phase === 'idle' || !rod) return;
      // (the rod put away / swapped: everything goes)
      if (!rod.parent || !parts.tip) { hide(); return; }
      t += dt;

      // The blank bends toward the bobber under load; the crank turns as the reel does
      const bend = phase === 'reel' ? (caught ? 0.7 : 0.25) * (1 - Math.min(1, t / REEL_S))
        : phase === 'show' ? 0.35 : load;
      parts.bends.forEach((b, i) => { b.rotation.x = bend * (0.1 + i * 0.12); });
      if (parts.crank) parts.crank.rotation.x += phase === 'reel' ? dt * 25 : crank;

      rod.updateWorldMatrix(true, true);
      parts.tip.getWorldPosition(tipW);

      let sag = LINE_SAG;
      if (phase === 'cast') {
        // The bobber flies from the tip out to where it lands
        const fly = t / flightS;
        if (fly < 1) {
          bobber.position.lerpVectors(from, target, fly);
          bobber.position.y += BOBBER_ARC * from.distanceTo(target) * 4 * fly * (1 - fly);
          sag = 0.02;
        } else {
          bobber.position.copy(target);
          doSplash(target);
          phase = 'wait';
          t = 0;
        }
        bobber.visible = line.visible = true;
      } else if (phase === 'wait') {
        // Bobbing on the swell (reeled in a little: `fish` is where it is now); a bite pulls it
        // under and twitches it about
        if (fishAt) { target.x = fishAt.x; target.z = fishAt.z; }
        const twitch = bite > 0 ? Math.sin(t * 38) * 0.03 * bite : 0;
        bobber.position.set(
          target.x + twitch,
          target.y + Math.sin(t * 2.2) * 0.015 - bite * 0.09,
          target.z + twitch * 0.6,
        );
        if (bite > 0.6 && Math.random() < dt * 4) doSplash(bobber.position);
        sag = LINE_SAG * (1 - bite);
      } else if (phase === 'fight') {
        // A hooked fish drags it about, half under; the harder it pulls, the more it splashes
        if (fishAt) {
          const k = 1 - Math.exp(-6 * dt);
          bobber.position.x += (fishAt.x - bobber.position.x) * k;
          bobber.position.z += (fishAt.z - bobber.position.z) * k;
        }
        bobber.position.y = target.y - 0.03 - load * 0.05 + Math.sin(t * 30) * 0.01 * load;
        if (Math.random() < dt * (0.5 + load * 5)) doSplash(bobber.position, load > 0.7);
        sag = 0;
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
      for (const root of [bobber, splash, line]) {
        root.traverse((o) => { o.geometry?.dispose?.(); o.material?.dispose?.(); });
      }
    },
  };
}

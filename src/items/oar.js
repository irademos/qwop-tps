import * as THREE from 'three';

// Town canoe paddle: a procedural oar built like the wand / fishing rod — origin at the grip —
// but pointing the other way, along −Z: held as the sword weapon in oar form (FoamSword.oar),
// the phone held straight up holds the oar straight down, by its handle, the blade in the water.
// The top hand is on the grip (the origin, the T-handle just above it), the other hand lower
// down the shaft (OAR_SUPPORT_AT); the blade's middle is the `oar-blade` object (canoeBoat.js
// splashes where it goes in and out of the water), its end `oar-tip`.

const SHAFT_COLOR = 0x9a6a3c;
const BLADE_COLOR = 0xb98250;
const GRIP_COLOR = 0x5b3a1e;

const SHAFT_LENGTH = 1.3;      // m from the grip to the blade's throat
const BLADE_LENGTH = 0.45;
const BLADE_WIDTH = 0.18;
const BLADE_THICK = 0.014;
export const OAR_SUPPORT_AT = 0.55; // m down the shaft from the grip: the lower hand
export const OAR_HAND_OUT = 0.3;    // m out to the side the blade's on: the top hand (FoamSword.oarLean)
export const OAR_BLADE_AT = SHAFT_LENGTH + BLADE_LENGTH / 2; // m down from the grip: the blade's middle

// ── A paddle stroke: auto-animated (the joystick) — bootstrapGameApp.js ──
// u: 0…1 through the stroke. The blade's way from the top hand is a tilt from straight down
// and a swing fore / aft (+ ahead) of straight out to the side: it reaches ahead and dips in
// (catch), sweeps back through the water (pull — canoeBoat.js pushes the canoe meanwhile),
// lifts out (exit) and comes back to rest beside the hull, lifted. A back stroke runs the
// swing the other way. A timed stroke at a higher strength is quicker. lift (0…1) raises the
// blade out of the water. (The phone's tilt doesn't play strokes: it holds the oar directly, in
// these same terms — tilt / swing — bootstrapGameApp.js.)
export const OAR_STROKE_CATCH = 0.2;   // u: in the water from here…
export const OAR_STROKE_PULL = 0.62;   // …pulling till here…
export const OAR_STROKE_EXIT = 0.78;   // …out of it by here (the next stroke may start)
const OAR_STROKE_S = [0.95, 0.6];      // s: a stroke at no / full strength
const DEG = Math.PI / 180;
export const OAR_REST_TILT = 62 * DEG; // from straight down: at rest, lifted clear
const IN_TILT = 33 * DEG;              // in the water
const OUT_TILT = 74 * DEG;             // lifted out at the end of the pull
const AHEAD = 42 * DEG;                // swing at the catch…
const BEHIND = 40 * DEG;               // …and at the end of the pull
export const OAR_REST_SWING = 8 * DEG;
export const OAR_STROKE_SWEEP = AHEAD + BEHIND; // rad: a stroke's whole swing through the water (its full push — canoeBoat.js)

/** How long a stroke of this strength (0…1) takes, s. */
export const oarStrokeDuration = (strength) => OAR_STROKE_S[0] + (OAR_STROKE_S[1] - OAR_STROKE_S[0]) * Math.min(1, Math.max(0, strength));
/** How far through the pull at u (0…1). */
export const oarStrokePull = (u) => Math.min(1, Math.max(0, (u - OAR_STROKE_CATCH) / (OAR_STROKE_PULL - OAR_STROKE_CATCH)));
const ease = (a, b, t) => a + (b - a) * (t * t * (3 - 2 * t));
/** The blade's pose at u of a stroke (dir: 1 forward, −1 back; lift 0…1 out of the water): { tilt, swing } in radians. */
export function oarStrokePose(u, dir = 1, lift = 0) {
  let tilt;
  let swing;
  const reach = AHEAD * dir;
  if (u < OAR_STROKE_CATCH) {
    const t = u / OAR_STROKE_CATCH;
    tilt = ease(OAR_REST_TILT, IN_TILT, t);
    swing = ease(OAR_REST_SWING, reach, t);
  } else if (u < OAR_STROKE_PULL) {
    const t = oarStrokePull(u);
    tilt = IN_TILT - 5 * DEG * Math.sin(t * Math.PI); // (a little deeper mid-stroke)
    swing = ease(reach, -BEHIND * dir, t);
  } else if (u < OAR_STROKE_EXIT) {
    const t = (u - OAR_STROKE_PULL) / (OAR_STROKE_EXIT - OAR_STROKE_PULL);
    tilt = ease(IN_TILT, OUT_TILT, t);
    swing = -BEHIND * dir * (1 + 0.2 * t);
  } else {
    const t = Math.min(1, (u - OAR_STROKE_EXIT) / (1 - OAR_STROKE_EXIT));
    tilt = ease(OUT_TILT, OAR_REST_TILT, t);
    swing = ease(-BEHIND * dir * 1.2, OAR_REST_SWING, t);
  }
  if (lift > 0) tilt = Math.max(tilt, tilt + (OUT_TILT - tilt) * Math.min(1, lift));
  return { tilt, swing };
}

const along = (geometry) => geometry.rotateX(Math.PI / 2); // cylinder axis Y → Z
const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.8, metalness: 0.02, ...extra });

/** A new oar model (grip at the origin, blade along −Z; its `oar-blade` / `oar-tip` objects). */
export function createOarModel() {
  const group = new THREE.Group();
  group.name = 'oar';

  // T-handle just above the top hand
  const tBar = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.13, 8).rotateZ(Math.PI / 2), std(GRIP_COLOR));
  tBar.position.z = 0.07;
  const neck = new THREE.Mesh(along(new THREE.CylinderGeometry(0.016, 0.017, 0.07, 8)), std(GRIP_COLOR));
  neck.position.z = 0.035;
  // The shaft, down to the blade
  const shaft = new THREE.Mesh(along(new THREE.CylinderGeometry(0.017, 0.019, SHAFT_LENGTH, 10)), std(SHAFT_COLOR, { roughness: 0.6 }));
  shaft.position.z = -SHAFT_LENGTH / 2;
  // The throat (shaft → blade) and the blade itself, flat across X
  const throat = new THREE.Mesh(new THREE.BoxGeometry(BLADE_WIDTH * 0.5, BLADE_THICK * 1.6, 0.12), std(BLADE_COLOR));
  throat.position.z = -SHAFT_LENGTH - 0.04;
  const blade = new THREE.Mesh(new THREE.BoxGeometry(BLADE_WIDTH, BLADE_THICK, BLADE_LENGTH), std(BLADE_COLOR));
  blade.position.z = -SHAFT_LENGTH - BLADE_LENGTH / 2;
  // (a rounded end)
  const end = new THREE.Mesh(new THREE.CylinderGeometry(BLADE_WIDTH / 2, BLADE_WIDTH / 2, BLADE_THICK, 14, 1, false, 0, Math.PI), std(BLADE_COLOR));
  end.rotation.y = Math.PI / 2;
  end.position.z = -SHAFT_LENGTH - BLADE_LENGTH;
  group.add(tBar, neck, shaft, throat, blade, end);

  const mid = new THREE.Object3D();
  mid.name = 'oar-blade';
  mid.position.z = -SHAFT_LENGTH - BLADE_LENGTH * 0.55;
  const tip = new THREE.Object3D();
  tip.name = 'oar-tip';
  tip.position.z = -SHAFT_LENGTH - BLADE_LENGTH - BLADE_WIDTH / 2;
  group.add(mid, tip);

  group.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return group;
}

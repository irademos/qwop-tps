# Archive: gyro-held canoe paddling

Kept for reference only — **nothing here is imported or run.** This is the canoe paddling as it stood at
commit `8cf5fa0` (branch `claude/admiring-clarke-jis16c`, PR irademos/qwop-tps#277), before it was replaced by
tilt-to-steer (the phone's tilt acts as a joystick and the oar's strokes play by themselves to fit — see the
Town canoe row in `CLAUDE.md`).

## What it did

The phone's tilt **held the oar** directly:

- The top tilted left / right lowered the blade into the water on that side (`OAR_ROLL_WATER` … `OAR_ROLL_DEEP`).
- The top tilted toward / away swung the blade back / ahead (`OAR_PITCH_GAIN`, `OAR_SWING_*`).
- Held upright the oar pointed straight ahead and came round to its side as the phone leaned (`pose.s`).
- Changing sides took a moment (`OAR_SIDE_SWITCH_*`, `OAR_SIDE_RATE`).
- The blade was kept out of the hull (`_oarClearHull` — still in the live code, used by the timed strokes).

Two ways of turning the oar's motion into a push (`OAR_ASSIST`):

- **Literal** (`OAR_ASSIST = false`): the blade swept back through the water pushed the canoe on, swept ahead
  backed it up, through the air did nothing (`paddle` in `canoeBoat.js`: swing since last frame ÷
  `OAR_STROKE_SWEEP` × how deep the blade really was; `STROKE_COMMIT` stopped the recovery from dragging).
- **Assisted** (`OAR_ASSIST = true`, `_oarAssist`): a state machine — `armed` → `drive` → `lift` → `recover`.
  With the blade in, a sweep of `OAR_ASSIST_COMMIT` started a whole clean stroke the game played out
  (strength / speed from the phone's fastest motion), then the blade lifted out and stayed out while the phone
  came back. So: tilt to one side and rock the top toward / away to paddle. A shallow tilt was a wide sweep that
  turned the canoe, a deep one a power stroke that kept straight (`assist.wide`); the blade held still in the
  water was a rudder (`stroke.rudder`); only a planted blade swept ahead made a back stroke.

Why it was replaced: holding a real oar through the phone was hard to do well. It needed two tilt axes
coordinated at once, gave little feedback on whether the blade was in, and kept turning the canoe.

## Restoring it

`git show 8cf5fa0:src/bootstrap/bootstrapGameApp.js` (and `src/town/canoeBoat.js`, `src/town/townConfig.js`,
`src/items/oar.js`) has it whole. The pieces are below, too, in case that history is gone. The gyro loop called it like this:

```js
if (_oarActive) { _detectOarTilt(foamSword._holdQuaternion, nowSec); _oarPose(foamSword._holdQuaternion); }
```

## `src/bootstrap/bootstrapGameApp.js` — constants (module top)

```js
// Town's canoe oar (and the sea start's): the phone's tilt holds the oar directly — every degree
// of it moves the oar. Tilting the top left / right lowers the blade on that side, from lifted
// clear (held upright) to the waterline (OAR_ROLL_WATER) and on down (OAR_ROLL_DEEP); tilting the
// top toward / away swings the blade back / ahead (OAR_PITCH_GAIN) of the middle (OAR_MID_SWING —
// a little ahead), as far as OAR_SWING_BACK / OAR_SWING_AHEAD (near along the hull). Held upright
// (within OAR_ROLL_SIDE) it points straight out ahead, and comes round to its side as it leans. Whatever the blade does in the
// water is the stroke (canoeBoat.js): swept back it pushes the canoe on, swept ahead it backs it
// up (weaker); through the air it does nothing. So: tilt it over, pull the top toward you,
// straighten up, tilt the top away (the blade comes forward, out of the water), over again. The
// middle is how the phone's held when the oar comes out (not the calibration — the sea start
// never calibrates), followed slowly (OAR_REST_FOLLOW_S) while it's held near it (OAR_REST_ZONE).
const OAR_ROLL_DEAD = 3 * Math.PI / 180;   // sideways (or fore / aft) past this: the tilt's oar shows
const OAR_ROLL_SIDE = 14 * Math.PI / 180;  // sideways: round from straight ahead to out on its side
const OAR_ROLL_WATER = 18 * Math.PI / 180; // the blade at the waterline…
const OAR_ROLL_DEEP = 55 * Math.PI / 180;  // …in all the way
const OAR_WATER_TILT = 52 * Math.PI / 180; // (the blade's tilt from straight down there…
const OAR_DEEP_TILT = 22 * Math.PI / 180;  // …and there)
const OAR_PITCH_GAIN = 1.6;
const OAR_MID_SWING = 15 * Math.PI / 180;
const OAR_SWING_BACK = 80 * Math.PI / 180;
const OAR_SWING_AHEAD = 80 * Math.PI / 180;
const OAR_TILT_FOLLOW = 20;    // per s: the oar easing to the phone (smoothing)
const OAR_REST_ZONE = 6 * Math.PI / 180;
const OAR_REST_FOLLOW_S = 3;
const OAR_POSE_RATE = 16;  // per s: the oar easing into the stroke's pose
const OAR_LEAN_RATE = 6;   // per s: the hands moving over to the other side
// Changing sides takes a moment: the phone tilted over the other way past OAR_SIDE_SWITCH_ROLL
// for OAR_SIDE_SWITCH_S (till then the oar comes up to straight ahead, lifted), then it swings
// across at most OAR_SIDE_RATE (pose.s per s — −1 … 1, so a whole crossing takes 2 / that)
const OAR_SIDE_SWITCH_ROLL = 10 * Math.PI / 180;
const OAR_SIDE_SWITCH_S = 0.35;
const OAR_SIDE_RATE = 2.5;
// The hull the oar is kept out of (player-local, the player standing at CANOE_STAND_Z facing
// the bow): CANOE_HALF_WIDTH amidships, narrowing to the ends, up to OAR_HULL_GUNWALE over the
// floor, OAR_HULL_MARGIN to spare — _oarClearHull
const OAR_HULL_GUNWALE = 0.58;  // m over the floor (canoe.glb's gunwale)
const OAR_HULL_MARGIN = 0.06;   // m
// Assisted strokes (OAR_ASSIST; false = the literal oar above, every sweep pushing as it goes).
// In the air the phone still holds the oar; once the blade's in (tilted over past
// OAR_ROLL_WATER) and the phone sweeps OAR_ASSIST_COMMIT one way, the game takes the stroke
// over: a whole clean sweep (OAR_ASSIST_SWEEP_FWD back / _BACK ahead) over OAR_ASSIST_DUR_* —
// quicker and stronger the faster the phone moves (OAR_ASSIST_SPEED_*); tilted well over
// (OAR_ASSIST_POWER_ROLL) it goes straight, only just past the waterline it's a wide sweep that
// turns the canoe away from that side — then the blade lifts
// out and stays out (recovery) while the phone comes back the other way, dropping in again once
// it's come OAR_ASSIST_RECOVER back and slows / turns. So: keep it tilted to one side and rock
// it — top toward you strokes, away brings it back. The blade held in the water, still
// (OAR_ASSIST_STILL_SPEED, OAR_ASSIST_RUDDER_*), is a rudder: it slows the canoe and turns it
// toward that side (canoeBoat.js — stroke.rudder); only from there (planted) does sweeping it
// ahead make a back stroke — otherwise that's just reaching forward for the next catch.
const OAR_ASSIST = true;
const OAR_ASSIST_COMMIT = 12 * Math.PI / 180;     // the oar's swing (phone fore / aft × OAR_PITCH_GAIN)
const OAR_ASSIST_SWEEP_FWD = 70 * Math.PI / 180;
const OAR_ASSIST_SWEEP_BACK = 55 * Math.PI / 180;
const OAR_ASSIST_DUR_SLOW = 0.65;                 // s
const OAR_ASSIST_DUR_FAST = 0.35;
const OAR_ASSIST_SPEED_SLOW = 0.8;                // rad/s of swing: the weakest stroke (half strength)…
const OAR_ASSIST_SPEED_FAST = 4;                  // …the strongest
const OAR_ASSIST_DRIVE_TILT = 34 * Math.PI / 180; // the blade's tilt from straight down through the stroke
const OAR_ASSIST_LIFT_S = 0.12;                   // s: lifting out at the end
const OAR_ASSIST_POWER_ROLL = 40 * Math.PI / 180;  // tilted over this far a stroke goes straight; just past OAR_ROLL_WATER it's a sweep that turns
const OAR_ASSIST_RECOVER = 15 * Math.PI / 180;    // swung back the other way this far: ready again
const OAR_ASSIST_STILL_SPEED = 0.6;               // rad/s of swing: slower than this is holding still
const OAR_ASSIST_RUDDER_DELAY = 0.25;             // s held still in the water before it's a rudder…
const OAR_ASSIST_RUDDER_RAMP = 0.3;               // …coming on over this (and planted: sweeping ahead from there is a back stroke)
const OAR_ASSIST_REARM_STILL_S = 0.5;             // s: held still after a stroke, the blade goes back in
```

## `src/bootstrap/bootstrapGameApp.js` — the paddling section (inside `initCore`)

`_getSteer` (the joystick / WASD as `{ fwd, turn }`) and `foamSword` come from the surrounding code.

```js
  // ── Paddling: the phone's tilt holds the oar (OAR_ROLL_* / OAR_PITCH_* — _detectOarTilt), the
  // canoe pushed by the blade's sweep through the water (canoeBoat.js, via the ctx's getOarStroke).
  // Joystick / WASD paddling plays timed strokes (oarStrokePose) — for the look only (visual: its
  // push is canoeBoat's steer). A timed stroke: { id, side (1 = left, player-local +X), dir (1
  // forward, −1 back), strength, visual, u, lift, t0, dur }; the tilt's: { id, side, strength,
  // pose: { tilt, swing, s } } (swing: + ahead; s: −1 right … 0 straight ahead … 1 left).
  let _oarStroke = null;
  let _oarStrokeSeq = 0;
  let _oarSide = 1;          // the side the blade's on
  const _startOarStroke = (side, dir, strength, visual = false) => {
    _oarStroke = { id: ++_oarStrokeSeq, side, dir, strength, visual, t0: performance.now() / 1000, dur: oarStrokeDuration(strength), u: 0, lift: 0 };
  };
  // The phone's tilt (q: the phone's hold — its +Z the phone's top, player-local); active = it's
  // tilted off the middle at all (else the joystick's strokes / the rest pose show)
  const _oarTilt = { live: null, at: 0, active: false, rest: new THREE.Vector3() };
  // The stroke going on now, or null — the tilt's first
  const _currentOarStroke = () => {
    const now = performance.now() / 1000;
    const live = _oarTilt.live;
    // (the tilt's, unless it's held at the middle while the joystick paddles)
    if (live && now - _oarTilt.at < 0.5) {
      const steer = _getSteer();
      if (_oarTilt.active || !(Math.abs(steer.fwd) > 0.2 || Math.abs(steer.turn) > 0.3)) return live;
    }
    if (!_oarStroke) return null;
    const u = (now - _oarStroke.t0) / _oarStroke.dur;
    if (u >= 1) { _oarStroke = null; return null; }
    _oarStroke.u = u;
    return _oarStroke;
  };
  const _oarStrokeReset = () => { _oarStroke = null; _oarTilt.live = null; _oarTilt.at = 0; _oarTilt.active = false; };
  const _oarTop = new THREE.Vector3();
  // (the angle of a unit vector's lean along one axis)
  const _oarLean = (v) => Math.asin(THREE.MathUtils.clamp(v, -1, 1));
  // (OAR_ASSIST) The tilt's oar, helped along: live.assist.mode 'armed' (the phone holds it;
  // in the water, a sweep of OAR_ASSIST_COMMIT starts a stroke, held still it's a rudder) →
  // 'drive' (the stroke plays out: live.water 1) → 'lift' → 'recover' (lifted, following the
  // phone back) → 'armed'. tilt / swing: where the phone puts the oar; r / roll: its sideways tilt.
  const _oarAssist = (live, roll, r, tilt, swing, k, span, now) => {
    let as = live.assist;
    if (!as) as = live.assist = { mode: 'armed', entry: swing, last: swing, v: 0, still: now, armedAt: now, planted: false, t0: now, u: 0, dir: 1, from: 0, to: 0, peak: 0, ext: swing };
    // (the phone's swing speed, smoothed)
    as.v += ((swing - as.last) / span - as.v) * (1 - Math.exp(-span / 0.06));
    as.last = swing;
    if (Math.abs(as.v) > OAR_ASSIST_STILL_SPEED) as.still = now;
    const pose = live.pose;
    const inWater = r >= OAR_ROLL_WATER;
    live.water = 0;
    live.rudder = 0;
    // (lifted out by hand, or over to the other side: the phone has it again)
    const arm = () => { as.mode = 'armed'; as.entry = swing; as.armedAt = now; as.planted = false; };
    if ((as.mode === 'lift' || as.mode === 'recover') && (!inWater || Math.sign(roll) !== live.side)) arm();
    if (as.mode === 'armed') {
      pose.tilt += (tilt - pose.tilt) * k;
      pose.swing += (swing - pose.swing) * k;
      if (!inWater) { arm(); return; }
      const held = now - Math.max(as.still, as.armedAt) - OAR_ASSIST_RUDDER_DELAY;
      live.rudder = THREE.MathUtils.clamp(held / OAR_ASSIST_RUDDER_RAMP, 0, 1);
      if (held >= 0) as.planted = true;
      // (sweeping ahead without the blade planted is reaching for the catch, not a back stroke:
      // the stroke is the pull back from the furthest it reached)
      if (!as.planted) as.entry = Math.max(as.entry, swing);
      const moved = swing - as.entry;
      if (Math.abs(moved) < OAR_ASSIST_COMMIT) return;
      // A stroke: swept back (the top toward you) = forward, ahead = back
      as.dir = moved < 0 ? 1 : -1;
      as.from = pose.swing;
      as.to = THREE.MathUtils.clamp(pose.swing - as.dir * (as.dir > 0 ? OAR_ASSIST_SWEEP_FWD : OAR_ASSIST_SWEEP_BACK), -OAR_SWING_BACK, OAR_SWING_AHEAD);
      as.mode = 'drive'; as.u = 0; as.peak = 0; as.ext = swing;
      // (tilted only just past the waterline, the blade's far out: a sweep that turns it — a
      // power stroke tilted well over, close by the hull, goes straight — canoeBoat.js)
      live.assist.wide = 1 - THREE.MathUtils.clamp((r - OAR_ROLL_WATER) / (OAR_ASSIST_POWER_ROLL - OAR_ROLL_WATER), 0, 1);
      live.rudder = 0;
    }
    // (the way back starts as soon as the stroke does: the furthest the phone's gone that way)
    if (as.mode !== 'armed') as.ext = as.dir > 0 ? Math.min(as.ext, swing) : Math.max(as.ext, swing);
    if (as.mode === 'drive') {
      // As strong / quick as the phone's fastest through it so far
      as.peak = Math.max(as.peak, Math.abs(as.v));
      const t = THREE.MathUtils.clamp((as.peak - OAR_ASSIST_SPEED_SLOW) / (OAR_ASSIST_SPEED_FAST - OAR_ASSIST_SPEED_SLOW), 0, 1);
      live.strength = 0.5 + 0.5 * t;
      as.u = Math.min(1, as.u + span / THREE.MathUtils.lerp(OAR_ASSIST_DUR_SLOW, OAR_ASSIST_DUR_FAST, t));
      pose.swing = as.from + (as.to - as.from) * (as.u * as.u * (3 - 2 * as.u));
      pose.tilt += (OAR_ASSIST_DRIVE_TILT - pose.tilt) * (1 - Math.exp(-OAR_TILT_FOLLOW * 1.5 * span));
      live.water = 1;
      if (as.u >= 1) { as.mode = 'lift'; as.t0 = now; }
      return;
    }
    if (as.mode === 'lift') {
      pose.tilt += (OAR_REST_TILT - pose.tilt) * (1 - Math.exp(-14 * span));
      if (now - as.t0 >= OAR_ASSIST_LIFT_S) as.mode = 'recover';
      return;
    }
    // Recovery: lifted clear, brought round with the phone; ready again once it's come
    // OAR_ASSIST_RECOVER back the other way and isn't still swinging that way fast
    pose.tilt += (OAR_REST_TILT - pose.tilt) * k;
    pose.swing += (swing - pose.swing) * k;
    // (or held still a while: the blade goes back in where it is — a rudder)
    if (((swing - as.ext) * as.dir >= OAR_ASSIST_RECOVER && as.v * as.dir < OAR_ASSIST_STILL_SPEED)
      || now - as.still > OAR_ASSIST_REARM_STILL_S) arm();
  };
  const _detectOarTilt = (q, now) => {
    const ot = _oarTilt;
    _oarTop.set(0, 0, 1).applyQuaternion(q);
    const span = now - ot.at;
    // (just started, or the gyro went quiet: the middle is where it is now)
    if (!ot.at || span > 0.5) {
      ot.rest.copy(_oarTop); ot.at = now; ot.active = false;
      ot.live = { id: ++_oarStrokeSeq, side: _oarSide, strength: 1, visual: false, pose: { tilt: OAR_REST_TILT, swing: OAR_MID_SWING, s: 0 } };
      return;
    }
    if (span <= 1e-4) return;
    ot.at = now;
    const live = ot.live;
    // (sideways: + = the top to the left, player-local +X; fore / aft: + = the top away — each
    // apart from the other, so leaning over doesn't take away from the fore / aft or back)
    const roll = _oarLean(_oarTop.x) - _oarLean(ot.rest.x);
    const pitch = Math.atan2(_oarTop.z, _oarTop.y) - Math.atan2(ot.rest.z, ot.rest.y);
    if (ot.rest.angleTo(_oarTop) < OAR_REST_ZONE) ot.rest.lerp(_oarTop, 1 - Math.exp(-span / OAR_REST_FOLLOW_S)).normalize();
    const r = Math.abs(roll);
    ot.active = r > OAR_ROLL_DEAD || Math.abs(pitch) > OAR_ROLL_DEAD;
    // Down into the water with the sideways tilt — on the oar's side (tilted the other way it's
    // waiting to change sides: lifted); back / ahead with the fore / aft one
    const rs = Math.sign(roll) === live.side ? r : 0;
    const tilt = rs < OAR_ROLL_WATER
      ? THREE.MathUtils.lerp(OAR_REST_TILT, OAR_WATER_TILT, rs / OAR_ROLL_WATER)
      : THREE.MathUtils.lerp(OAR_WATER_TILT, OAR_DEEP_TILT, Math.min(1, (rs - OAR_ROLL_WATER) / (OAR_ROLL_DEEP - OAR_ROLL_WATER)));
    const swing = THREE.MathUtils.clamp(OAR_MID_SWING + pitch * OAR_PITCH_GAIN, -OAR_SWING_BACK, OAR_SWING_AHEAD);
    const k = 1 - Math.exp(-OAR_TILT_FOLLOW * span);
    if (OAR_ASSIST) _oarAssist(live, roll, rs, tilt, swing, k, span, now);
    else {
      live.pose.tilt += (tilt - live.pose.tilt) * k;
      live.pose.swing += (swing - live.pose.swing) * k;
    }
    // Which side: changed only once the phone's been tilted the other way a moment (kept
    // through an assisted stroke); straight ahead in the middle, all the way out by
    // OAR_ROLL_SIDE, and swung across no faster than OAR_SIDE_RATE
    const busy = live.assist && live.assist.mode !== 'armed';
    if (!busy && r > OAR_SIDE_SWITCH_ROLL && Math.sign(roll) !== live.side) {
      ot.switchAt ??= now;
      if (now - ot.switchAt >= OAR_SIDE_SWITCH_S) { live.side = Math.sign(roll); ot.switchAt = null; }
    } else ot.switchAt = null;
    const a = Math.min(1, rs / OAR_ROLL_SIDE);
    const sGo = ((busy ? 1 : a * a * (3 - 2 * a)) * live.side - live.pose.s) * k;
    live.pose.s += THREE.MathUtils.clamp(sGo, -OAR_SIDE_RATE * span, OAR_SIDE_RATE * span);
    if (ot.active) _oarStroke = null;
  };
  // (in place) The oar's hold for the stroke going on (or at rest, lifted beside the hull on
  // its side): the blade's way from the top hand eased toward the stroke's pose, crossing over
  // the canoe lifted when it changes sides; the hands go out over that side (FoamSword.oarLean)
  const _oarPoseV = new THREE.Vector3(1, -0.5, 0).normalize();
  // (in place) Keeps the blade out of the hull: the blade's way (unit, player-local) lifted out
  // over the side (side: 1 left, −1 right) just as far as it takes for every point from the
  // shaft's middle to the tip to be outside the hull or over its gunwale — the top hand where
  // FoamSword puts it for that way (oarGripPoint), the oar sized with the character's grip
  const _hullHand = { x: 0, y: 0, z: 0 };
  const _hullUp = new THREE.Vector3();
  const _hullTry = new THREE.Vector3();
  const _hullSafe = new THREE.Vector3();
  const _oarInHull = (dir, lean, len) => {
    oarGripPoint(_hullUp.copy(dir).negate(), lean, _hullHand);
    for (let i = 0; i <= 5; i++) {
      const d = len * (0.45 + 0.11 * i);
      const y = _hullHand.y + dir.y * d;
      if (y > OAR_HULL_GUNWALE) continue;
      const zc = CANOE_STAND_Z + _hullHand.z + dir.z * d; // along the canoe (bow +)
      const along = 1 - (zc / CANOE_HALF_LENGTH) ** 2;
      if (along <= 0) continue;
      if (Math.abs(_hullHand.x + dir.x * d) < CANOE_HALF_WIDTH * Math.sqrt(along) + OAR_HULL_MARGIN) return true;
    }
    return false;
  };
  const _oarClearHull = (dir, lean, side) => {
    const mesh = foamSword?.heldMesh || foamSword?.mesh;
    const len = OAR_TIP_AT * (mesh?.scale.x || 1);
    if (!_oarInHull(dir, lean, len)) return;
    // (out level over the gunwale, a little up — always clear)
    _hullSafe.set(side, 0.35, Math.max(0, dir.z) * 0.5).normalize();
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 7; i++) {
      const t = (lo + hi) / 2;
      if (_oarInHull(_hullTry.copy(dir).lerp(_hullSafe, t).normalize(), lean, len)) lo = t; else hi = t;
    }
    dir.lerp(_hullSafe, hi).normalize();
  };
  const _oarTarget = new THREE.Vector3();
  const _oarX = new THREE.Vector3();
  const _oarY = new THREE.Vector3();
  const _oarZ = new THREE.Vector3();
  const _oarBasis = new THREE.Matrix4();
  let _oarPoseAt = 0;
  const _oarPose = (q) => {
    const now = performance.now() / 1000;
    const dt = Math.min(0.1, Math.max(0, now - _oarPoseAt));
    _oarPoseAt = now;
    let st = _currentOarStroke();
    if (!st) {
      const steer = _getSteer();
      if (Math.abs(steer.fwd) > 0.2 || Math.abs(steer.turn) > 0.3) {
        const dir = steer.fwd < -0.2 ? -1 : 1;
        // (turning right: a forward stroke on the left / a back stroke on the right; else alternate)
        const side = Math.abs(steer.turn) > 0.3 ? Math.sign(steer.turn) * dir : -_oarSide;
        _startOarStroke(side, dir, 0.5, true);
        st = _currentOarStroke();
      }
    }
    if (st) _oarSide = st.side;
    let lean = _oarSide;
    if (st?.pose) {
      // The tilt's: round from straight ahead (s 0) to its side, swung back / ahead there — the
      // blade's way from forward (az) turns smoothly through the middle, no crossing over
      const { tilt, swing, s } = st.pose;
      const sinT = Math.sin(tilt);
      const az = Math.abs(s) * (Math.PI / 2 - swing);
      _oarTarget.set(Math.sign(s) * sinT * Math.sin(az), -Math.cos(tilt), sinT * Math.cos(az));
      lean = s;
    } else {
      const { tilt, swing } = st ? oarStrokePose(st.u, st.dir, st.lift) : { tilt: OAR_REST_TILT, swing: OAR_REST_SWING };
      const sinT = Math.sin(tilt);
      _oarTarget.set(_oarSide * sinT * Math.cos(swing), -Math.cos(tilt), sinT * Math.sin(swing));
      if (Math.sign(_oarPoseV.x) === -_oarSide && Math.abs(_oarPoseV.x) > 0.1) _oarTarget.set(0, 0.15, 1).normalize();
    }
    _oarPoseV.lerp(_oarTarget, 1 - Math.exp(-OAR_POSE_RATE * dt)).normalize();
    if (foamSword) foamSword.oarLean += (lean - foamSword.oarLean) * (1 - Math.exp(-OAR_LEAN_RATE * dt));
    _oarClearHull(_oarPoseV, foamSword?.oarLean ?? lean, Math.sign(lean) || _oarSide);
    // (the oar's +Z points to the handle — back up the blade's way; its blade's face fore / aft)
    _oarZ.copy(_oarPoseV).negate();
    _oarY.set(0, 0, 1).addScaledVector(_oarZ, -_oarZ.z);
    if (_oarY.lengthSq() < 1e-4) _oarY.set(1, 0, 0).addScaledVector(_oarZ, -_oarZ.x);
    _oarY.normalize();
    _oarX.crossVectors(_oarY, _oarZ);
    return q.setFromRotationMatrix(_oarBasis.makeBasis(_oarX, _oarY, _oarZ));
  };
```

## `src/town/canoeBoat.js` (whole file)

```js
// The canoe on the water: its model, where it is, and how it moves — paddled by the oar's blade
// through the water (or the joystick / WASD), slowed by drag, kept off water shallower than
// CANOE_MIN_DEPTH. Shared by Town's canoe (townCanoe.js — moored by the fishing spot, got in and
// out of) and the guest's sea start (seaStart.js — out on the open sea).
//
// Paddling is the oar's blade swept through the water (held by the phone's tilt — bootstrapGameApp.js;
// the joystick's strokes are only for the look): a whole stroke's sweep (OAR_STROKE_SWEEP, swept
// back, all in) pushes the canoe CANOE_STROKE_DV (m/s; swept ahead CANOE_PADDLE_BACK as hard, backing it up) and, since
// it's off to one side, turns it CANOE_STROKE_TURN (rad/s): a forward stroke on the left drives
// it forward and a little to the right, on the right forward and a little to the left.
// With OAR_ASSIST on (bootstrapGameApp.js) the stroke is helped along: it says when its blade's
// pushing (stroke.water) and is a whole clean sweep, pushing CANOE_ASSIST_PUSH as hard; a forward
// power stroke hardly turns it (CANOE_ASSIST_TURN), a wide sweep does (CANOE_ASSIST_SWEEP_TURN —
// stroke.assist.wide); a back one
// still turns it sharply; and the blade held still in the water (stroke.rudder) slows it and
// turns it toward that side (CANOE_RUDDER_*). The
// joystick / WASD paddle too (without a gyro the strokes they show are only for the look). The
// hull slides along easily and hardly sideways (CANOE_DRAG / CANOE_SIDE_DRAG). Up against the
// shore or a dock it slides / turns along it, pushed off a little (bump), instead of stopping dead.
//
// The blade splashes (waterSplash.js): going in and coming out, and drops thrown back off it
// through the pull (CANOE_SPLASH_EVERY, more for a stronger stroke).

import * as THREE from 'three';
import { createCanoe, CANOE_FLOOR_Y, CANOE_HALF_LENGTH, CANOE_HALF_WIDTH } from '../items/canoe.js';
import { OAR_STROKE_SWEEP, oarStrokePull } from '../items/oar.js';
import { createWaterSplash } from '../items/waterSplash.js';
import {
  CANOE_ASSIST_PUSH, CANOE_ASSIST_SWEEP_TURN, CANOE_ASSIST_TURN, CANOE_BACK_TURN, CANOE_BOB, CANOE_DRAG, CANOE_RUDDER_DRAG, CANOE_RUDDER_TURN,
  CANOE_RUDDER_TURN_PER_SPEED, CANOE_MAX_SPEED, CANOE_MIN_DEPTH, CANOE_PADDLE_BACK, CANOE_SETTLE_DRAG,
  CANOE_SIDE_DRAG, CANOE_SPLASH_EVERY, CANOE_STAND_Z, CANOE_STEER_ACCEL, CANOE_STEER_TURN, CANOE_STROKE_DV,
  CANOE_STROKE_TURN, CANOE_TURN_DRAG,
} from './townConfig.js';

const BLADE_DEPTH = 0.12;       // m under the surface: the blade's all in (full push)
const STROKE_COMMIT = 0.15;     // rad swept one way in the water: that's the stroke — the other way pushes nothing till it's out
const PULL_SWING_SPEED = 0.35;  // rad/s: the blade swept faster than this in the water throws drops
// Where the hull's water depth is checked (canoe-local m: across, along)
const HULL_PROBES = [[0, 0], [0, CANOE_HALF_LENGTH - 0.3], [0, -(CANOE_HALF_LENGTH - 0.3)], [CANOE_HALF_WIDTH, 0], [-CANOE_HALF_WIDTH, 0]];

// waterY(x, z): the water's surface there; waterDepth(x, z): m of water over the ground (0: dry)
export function createCanoeBoat({ waterY, waterDepth, x = 0, z = 0, yaw = 0 }) {
  const boat = {
    group: createCanoe(),
    x, z, yaw,
    vx: 0, vz: 0, w: 0, // m/s, rad/s
    blade: null,        // the oar blade's last world position + time
    bladeIn: false,     // its blade in the water (for the splash going in / coming out)
    splashAt: 0,        // s (real clock): the next drops off a stroke
    strokeId: null,     // the tilt's oar pushing it, and where its blade swung to last frame
    strokeSwing: 0,
    strokeDir: 0,       // the stroke this dip is (1 forward, −1 back, 0 not yet), and its sweep so far
    strokeSweep: 0,
  };
  // (world space: put beside the canoe in whatever holds it, the first time it moves)
  const splash = createWaterSplash();
  // Canoe-local (across +X — the player's left facing the bow —, along +Z) ↔ world
  const toWorld = (c, lx, lz, a = c.yaw) => ({
    x: c.x + lx * Math.cos(a) + lz * Math.sin(a),
    z: c.z - lx * Math.sin(a) + lz * Math.cos(a),
  });
  const toLocal = (wx, wz) => {
    const dx = wx - boat.x;
    const dz = wz - boat.z;
    return { x: dx * Math.cos(boat.yaw) - dz * Math.sin(boat.yaw), z: dx * Math.sin(boat.yaw) + dz * Math.cos(boat.yaw) };
  };
  // Deep enough under all of it there
  const fits = (fx, fz, fyaw) => HULL_PROBES.every(([lx, lz]) => {
    const p = toWorld({ x: fx, z: fz }, lx, lz, fyaw);
    return waterDepth(p.x, p.z) >= CANOE_MIN_DEPTH;
  });
  const floorY = () => boat.group.position.y + CANOE_FLOOR_Y;
  // Where the player stands in it
  const standPoint = () => toWorld(boat, 0, CANOE_STAND_Z);
  // Its floor's height at (x, z) inside the hull, else undefined
  const floorAt = (fx, fz) => {
    const l = toLocal(fx, fz);
    return Math.abs(l.x) < CANOE_HALF_WIDTH && Math.abs(l.z) < CANOE_HALF_LENGTH - 0.3 ? floorY() : undefined;
  };
  // On the water, bobbing (t: s)
  const place = (t) => {
    boat.group.position.set(boat.x, waterY(boat.x, boat.z) + Math.sin(t * 1.7) * CANOE_BOB, boat.z);
    boat.group.rotation.set(Math.sin(t * 1.1) * 0.015, boat.yaw, Math.sin(t * 1.3 + 1) * 0.02);
  };
  const stop = () => {
    boat.vx = 0;
    boat.vz = 0;
    boat.w = 0;
    boat.blade = null;
    boat.bladeIn = false;
  };

  // The paddler's push this frame: the oar's stroke (stroke: { id, side (1 left, −1 right),
  // dir (1 forward, −1 back), strength 0…1, u 0…1, visual (the look only) } or null), its blade
  // for the splashes (oar: the oar's model, or null) and the joystick / WASD (steer: { fwd, turn }, −1…1)
  const _b = new THREE.Vector3();
  const paddle = (dt, oar, steer, stroke = null) => {
    const c = boat;
    const fwdX = Math.sin(c.yaw);
    const fwdZ = Math.cos(c.yaw);
    // The phone's tilt holds the oar (stroke.pose): how far its blade swung since last frame
    // (+ ahead) — what pushes, if it's in the water (below). A timed stroke is only for the look.
    let pulling = false;
    let swung = 0;
    let depth = 0;
    // (an assisted stroke — bootstrapGameApp.js OAR_ASSIST: it says itself when the blade's
    // pushing (stroke.water) and when it's held as a rudder (stroke.rudder))
    const assist = stroke?.pose && !stroke.visual ? stroke.assist : null;
    if (stroke?.pose && !stroke.visual) {
      if (stroke.id === c.strokeId) swung = stroke.pose.swing - c.strokeSwing;
      c.strokeId = stroke.id;
      c.strokeSwing = stroke.pose.swing;
    } else {
      c.strokeId = null;
      if (stroke) {
        const p = oarStrokePull(stroke.u);
        pulling = p > 0 && p < 1;
      }
    }
    const blade = oar?.getObjectByName('oar-blade');
    if (blade) {
      blade.updateWorldMatrix(true, false);
      blade.getWorldPosition(_b);
      const prev = c.blade;
      // (its speed by the real clock: the caller's dt may be capped on a slow frame)
      const now = performance.now() / 1000;
      c.blade = { x: _b.x, y: _b.y, z: _b.z, t: now };
      const span = prev ? now - prev.t : 0;
      if (span > 1e-3 && span < 0.5) {
        const bvx = (_b.x - prev.x) / span - c.vx;
        const bvz = (_b.z - prev.z) / span - c.vz;
        const l = toLocal(_b.x, _b.z);
        const outside = Math.abs(l.x) > CANOE_HALF_WIDTH * 0.6 || Math.abs(l.z) > CANOE_HALF_LENGTH - 0.2;
        const surface = waterY(_b.x, _b.z);
        // How far under (0…1 over BLADE_DEPTH); swept through the water fast enough it's a pull
        depth = outside ? Math.min(1, Math.max(0, (surface + 0.02 - _b.y) / BLADE_DEPTH)) : 0;
        if (assist) depth = stroke.water || 0;
        if (stroke?.pose) pulling = depth > 0.3 && Math.abs(swung) > PULL_SWING_SPEED * dt;
        // Splashes: in and out of the water, and drops off it through the pull
        const nowIn = _b.y < surface + 0.02 && outside;
        if (nowIn !== c.bladeIn) {
          const speed = Math.min(6, Math.hypot(bvx, bvz, (_b.y - prev.y) / span));
          splash.drops({ x: _b.x, y: surface, z: _b.z, n: nowIn ? 6 + Math.min(10, Math.round(speed * 4)) : 5, speed: 0.4, up: nowIn ? 1.4 + Math.min(1.5, speed * 0.4) : 1.1 });
          splash.ring(_b.x, surface, _b.z, nowIn ? 0.25 : 0.15);
          c.bladeIn = nowIn;
        }
        // (drops thrown the way the blade goes, more for a stronger stroke)
        if (nowIn && pulling && now >= c.splashAt) {
          const bs = Math.hypot(bvx, bvz) || 1;
          const hard = 1 + 2 * (stroke.strength ?? 0.5);
          splash.drops({ x: _b.x, y: surface, z: _b.z, n: Math.round(2 + hard * 2), dx: bvx / bs, dz: bvz / bs, speed: 0.6 + hard * 0.5, up: 1.2 + hard * 0.5, spread: 0.35 });
          if (Math.random() < 0.35) splash.ring(_b.x, surface, _b.z, 0.12);
          c.splashAt = now + CANOE_SPLASH_EVERY;
        }
      }
    } else {
      c.blade = null;
      c.bladeIn = false;
    }
    // The blade swept back through the water pushes the canoe on, swept ahead backs it up (by how
    // much of a stroke's whole sweep it went, how deep it is). Once it's swept STROKE_COMMIT one
    // way that's the stroke: coming back the other way before it's out of the water (the end of
    // a stroke, straightening up) drags nothing
    // (an assisted stroke is a whole clean sweep already)
    if (assist) depth = stroke.water || 0;
    if (depth < 0.05 || assist) { c.strokeDir = 0; c.strokeSweep = 0; }
    else if (!c.strokeDir) {
      c.strokeSweep -= swung * depth;
      if (Math.abs(c.strokeSweep) > STROKE_COMMIT) c.strokeDir = Math.sign(c.strokeSweep);
    }
    let f = (-swung / OAR_STROKE_SWEEP) * depth * (stroke?.strength ?? 1);
    if (c.strokeDir && Math.sign(f) === -c.strokeDir) f = 0;
    if (f) {
      const back = f < 0;
      const dv = f * CANOE_STROKE_DV * (back ? CANOE_PADDLE_BACK : 1) * (assist ? CANOE_ASSIST_PUSH : 1);
      c.vx += fwdX * dv;
      c.vz += fwdZ * dv;
      // (off to its side: it turns — the left side forward turns it right, yaw −; assisted
      // forward strokes hardly, unless it's a wide sweep — assist.wide 0 … 1)
      const keep = assist && !back ? CANOE_ASSIST_TURN + (CANOE_ASSIST_SWEEP_TURN - CANOE_ASSIST_TURN) * (assist.wide || 0) : 1;
      c.w -= stroke.side * f * CANOE_STROKE_TURN * (back ? CANOE_BACK_TURN : 1) * keep;
    }
    // The blade held still in the water (assisted): a rudder — it drags, turning toward its side
    if (assist && stroke.rudder > 0) {
      const along = c.vx * fwdX + c.vz * fwdZ;
      const k = 1 - Math.exp(-CANOE_RUDDER_DRAG * stroke.rudder * dt);
      c.vx -= fwdX * along * k;
      c.vz -= fwdZ * along * k;
      c.w += stroke.side * stroke.rudder * (CANOE_RUDDER_TURN + CANOE_RUDDER_TURN_PER_SPEED * along) * dt;
    }
    // The joystick / WASD paddle for the player
    if (Math.abs(steer.fwd) > 0.05) {
      const a = steer.fwd * CANOE_STEER_ACCEL * (steer.fwd < 0 ? CANOE_PADDLE_BACK : 1) * dt;
      c.vx += Math.sin(c.yaw) * a;
      c.vz += Math.cos(c.yaw) * a;
    }
    if (Math.abs(steer.turn) > 0.05) c.w -= steer.turn * CANOE_STEER_TURN * dt;
  };

  // Up against the shore / a dock: the way off it (world, unit) — toward deeper water from the
  // hull probes that touch ground at that pose (else from them toward the middle); null if none do
  const SLOPE_STEP = 0.4; // m
  const awayFromShallow = (fx, fz, fyaw) => {
    let ax = 0;
    let az = 0;
    let mx = 0;
    let mz = 0;
    for (const [lx, lz] of HULL_PROBES) {
      const p = toWorld({ x: fx, z: fz }, lx, lz, fyaw);
      if (waterDepth(p.x, p.z) >= CANOE_MIN_DEPTH) continue;
      const deep = (x2, z2) => Math.min(CANOE_MIN_DEPTH * 2, waterDepth(x2, z2));
      ax += deep(p.x + SLOPE_STEP, p.z) - deep(p.x - SLOPE_STEP, p.z);
      az += deep(p.x, p.z + SLOPE_STEP) - deep(p.x, p.z - SLOPE_STEP);
      mx += fx - p.x;
      mz += fz - p.z;
    }
    if (Math.hypot(ax, az) < 1e-6) { ax = mx; az = mz; }
    const l = Math.hypot(ax, az);
    return l > 1e-6 ? { x: ax / l, z: az / l } : null;
  };
  // The move to (nx, nz, nyaw) ran it aground: rather than stopping dead, it turns / slides
  // along the bank, pushed off it a little if it has to — and loses only the speed into it
  const bump = (nx, nz, nyaw) => {
    const c = boat;
    const away = awayFromShallow(nx, nz, nyaw) || awayFromShallow(c.x, c.z, c.yaw);
    let into = 0;
    if (away) {
      into = Math.min(0, c.vx * away.x + c.vz * away.z);
      // (along the bank: the move without the part into it)
      const dx = nx - c.x;
      const dz = nz - c.z;
      const d = Math.min(0, dx * away.x + dz * away.z);
      const sx = c.x + dx - away.x * d;
      const sz = c.z + dz - away.z * d;
      // (keeping the turn if it can, pushed off as little as will do)
      for (const [px, pz, pyaw] of [[sx, sz, nyaw], [c.x, c.z, nyaw], [sx, sz, c.yaw]]) {
        for (const push of [0, 0.03, 0.08, 0.15]) {
          const tx = px + away.x * push;
          const tz = pz + away.z * push;
          if (!fits(tx, tz, pyaw)) continue;
          c.x = tx; c.z = tz;
          if (pyaw !== nyaw) c.w = 0;
          c.yaw = pyaw;
          c.vx -= away.x * into;
          c.vz -= away.z * into;
          return;
        }
      }
    }
    if (fits(c.x, c.z, nyaw)) { c.yaw = nyaw; c.vx = 0; c.vz = 0; }
    else if (fits(nx, nz, c.yaw)) { c.x = nx; c.z = nz; c.w = 0; }
    else { c.vx = 0; c.vz = 0; c.w = 0; }
  };

  // Drag (along it, sideways — it hardly slides —, turning), then moving it unless that runs it
  // aground; placed on the water at t. Returns its yaw before the move.
  const move = (dt, t) => {
    const c = boat;
    const fx = Math.sin(c.yaw);
    const fz = Math.cos(c.yaw);
    let along = c.vx * fx + c.vz * fz;
    const sx = c.vx - fx * along;
    const sz = c.vz - fz * along;
    along *= Math.exp(-CANOE_DRAG * dt);
    const side = Math.exp(-CANOE_SIDE_DRAG * dt);
    c.vx = fx * along + sx * side;
    c.vz = fz * along + sz * side;
    c.w *= Math.exp(-CANOE_TURN_DRAG * dt);
    const speed = Math.hypot(c.vx, c.vz);
    if (speed > CANOE_MAX_SPEED) { c.vx *= CANOE_MAX_SPEED / speed; c.vz *= CANOE_MAX_SPEED / speed; }

    const oldYaw = c.yaw;
    if (speed > 1e-3 || Math.abs(c.w) > 1e-4) {
      const nx = c.x + c.vx * dt;
      const nz = c.z + c.vz * dt;
      const nyaw = c.yaw + c.w * dt;
      // (stuck somewhere too shallow already: let it move off)
      if (fits(nx, nz, nyaw) || !fits(c.x, c.z, c.yaw)) { c.x = nx; c.z = nz; c.yaw = nyaw; }
      else bump(nx, nz, nyaw);
    }
    place(t);
    const holder = boat.group.parent;
    if (holder && splash.group.parent !== holder) holder.add(splash.group);
    splash.update(dt);
    return oldYaw;
  };
  // Coming to rest (the rod out: no paddling, and fishing wants it to stay put)
  const settle = (dt) => {
    const k = Math.exp(-CANOE_SETTLE_DRAG * dt);
    boat.vx *= k;
    boat.vz *= k;
    boat.w *= k;
  };
  // Gone for good (the sea start's canoe): its splashes too
  const dispose = () => splash.dispose();

  return Object.assign(boat, { fits, floorY, standPoint, floorAt, place, stop, paddle, settle, move, dispose });
}

```

## `src/town/townConfig.js` — the canoe constants

```js
export const CANOE_BOARD_DIST = 3;          // m from its middle: 🛶 Get in
export const CANOE_SHORE_DIST = 4;          // m — 🛶 Get out with dry ground this close
export const CANOE_STAND_Z = -0.35;         // m along it (bow = +): where the player stands
export const CANOE_MIN_DEPTH = 0.25;        // m of water it needs under it (else it runs aground)
export const CANOE_STROKE_DV = 3.2;         // m/s: a full-strength stroke's push (× the phone tilt's strength)…
export const CANOE_PADDLE_BACK = 0.6;       // …a back stroke this much as hard…
export const CANOE_STROKE_TURN = 0.4;       // rad/s: …and the turn it gives (off to one side)…
export const CANOE_BACK_TURN = 3;           // …a back stroke's turn this many times that
export const CANOE_ASSIST_PUSH = 0.6;       // an assisted stroke (bootstrapGameApp.js OAR_ASSIST — always a whole clean sweep): its push this much of a literal one's
export const CANOE_ASSIST_TURN = 0.15;      // …and a forward one's turn (× CANOE_STROKE_TURN): a power stroke (tilted well over) keeps it straight…
export const CANOE_ASSIST_SWEEP_TURN = 1.3; // …a wide sweep (only just in the water) turns it
export const CANOE_RUDDER_TURN = 0.5;       // rad/s² — the blade held still in the water: it turns toward that side…
export const CANOE_RUDDER_TURN_PER_SPEED = 0.4; // …more the faster it's going (per m/s)…
export const CANOE_RUDDER_DRAG = 0.8;       // …and slows it (per s)
export const CANOE_DRAG = 0.3;              // per s, along it
export const CANOE_SIDE_DRAG = 3.5;         // per s, sideways (the hull won't slide)
export const CANOE_TURN_DRAG = 1.8;         // per s
export const CANOE_MAX_SPEED = 30;          // m/s
export const CANOE_STEER_ACCEL = 2.5;      // m/s² — no gyro: the joystick / WASD paddle for you (back: CANOE_PADDLE_BACK as hard)…
export const CANOE_STEER_TURN = 8;          // rad/s² — …and turn it
export const CANOE_SPLASH_EVERY = 0.06;     // s — drops thrown off the blade through a stroke's pull this often
export const CANOE_SETTLE_DRAG = 1.5;       // per s — the rod out: the canoe coming to rest
export const CANOE_BOB = 0.015;             // m up and down on the water
```

## `src/items/oar.js` (whole file — `OAR_STROKE_SWEEP`, `oarStrokePose`, `oarGripPoint`)

```js
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
export const OAR_TIP_AT = SHAFT_LENGTH + BLADE_LENGTH + BLADE_WIDTH / 2; // m down from the grip: its end
// Where the top hand holds it (player-local m; FoamSword's oar hold — foamSword.js — and the
// hull check in bootstrapGameApp.js): out over the side the blade's on (lean −1 … 1, + = the
// player's left) by OAR_HAND_OUT, raised as the oar tilts away from upright (so the blade comes
// out of the water when tilted well over), following it forward a little. up: the oar's handle
// way (unit, player-local — the blade's way negated).
const OAR_HAND_Y = 0.95;
const OAR_HAND_LIFT = 0.35;
const OAR_HAND_Z = 0.32;
const OAR_HAND_FWD = 0.25;
export function oarGripPoint(up, lean, out) {
  out.x = Math.min(1, Math.max(-1, lean)) * OAR_HAND_OUT;
  out.y = OAR_HAND_Y + OAR_HAND_LIFT * (1 - Math.abs(up.y));
  out.z = Math.min(0.65, Math.max(0.1, OAR_HAND_Z + up.z * OAR_HAND_FWD));
  return out;
}

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

```

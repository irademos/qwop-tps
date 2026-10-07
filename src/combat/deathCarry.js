// Showdown death: two frog men walk in from off screen, reach down and pick the fallen
// player up (arm IK toward grip points on the body, like the hands holding the sword),
// turn and carry them off screen. The camera stays where it was meanwhile.
//
// Everything is laid out in a "carry frame": centre C (the body, on the ground) and a
// heading h. The carriers stand either side of the body facing h; the body keeps its
// yaw relative to h, so turning the frame turns the whole group together.
//
// Game access: createDeathCarry({ scene, camera, getTerrainHeight }); start({ body,
// character, onDone }) on death; update(dt) every frame after the player controls (it has
// the last word on the camera); cancel() when leaving the mode.

import * as THREE from 'three';
import { createGLBCharacterInstance, glbCharacterConfig } from '../models/glbCharacterModel.js';

const CARRIER_HEIGHT = 1.0;
const CARRIER_SIDE = 0.4;          // m from the body's centre line to each carrier
const CARRIER_BACK = 0.12;         // carriers stand this far behind the grips
const GRIP_SIDE = 0.12;            // grips: this far out from the centre line…
const GRIP_FRONT = 0.16;           // …outer hand this far ahead, inner hand GRIP_BACK behind
const GRIP_BACK = -0.04;
const HAND_REST = new THREE.Vector3(0.17, 0.4, 0.06);   // carrier-local, x mirrored per hand
const LIFT_HEIGHT = 0.4;           // m the body is lifted
const APPROACH_SPEED = 2.3;        // m/s
const CARRY_SPEED = 1.7;           // m/s
const TURN_SPEED = 2.4;            // rad/s
const REACH_S = 0.45;
const LIFT_S = 0.7;
const SPAWN_MIN_DIST = 5;          // carriers start at least this far out…
const SPAWN_MAX_DIST = 14;         // …pushed out until off screen (up to this)
const OFFSCREEN_NDC = 1.12;
const CARRY_MAX_S = 9;             // walk-off safety limit
const APPROACH_MAX_S = 9;
// The camera eases back to frame the pickup (from the side it was looking from), then stays
const CAM_BACK = 3.0;
const CAM_UP = 1.5;
const CAM_LOOK_UP = 0.35;
const CAM_FOV = 55;                // (the fight camera is very wide)
const CAM_EASE_S = 1.2;

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const easeInOut = (t) => t * t * (3 - 2 * t);
const angleDelta = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));

export function createDeathCarry({ scene, camera, getTerrainHeight }) {
  let run = null;   // the current carry, null when idle

  const groundY = (x, z, fallback) => {
    const y = getTerrainHeight?.(x, z);
    return Number.isFinite(y) ? y : fallback;
  };
  // Heading θ → forward h / side s (the frame's local +X, like an object with rotation.y = θ)
  const headingVectors = (theta, h, s) => {
    h.set(Math.sin(theta), 0, Math.cos(theta));
    s.set(h.z, 0, -h.x);
  };
  const offscreen = (p) => {
    _v2.copy(p).project(camera);
    return _v2.z > 1 || Math.abs(_v2.x) > OFFSCREEN_NDC || Math.abs(_v2.y) > OFFSCREEN_NDC;
  };

  /**
   * @param {{ body: THREE.Object3D, character?: object, onDone: () => void }} opts
   *   body: the dead player's model (moved / turned while carried); character: its GLBCharacter
   */
  function start({ body, character = null, onDone }) {
    cancel();
    camera.updateMatrixWorld();
    const r = {
      body,
      character,
      onDone,
      phase: 'loading',
      phaseT: 0,
      carriers: [],
      cam: null,
      camT: 0,
      center: new THREE.Vector3(body.position.x, groundY(body.position.x, body.position.z, body.position.y), body.position.z),
      bodyLift0: 0,
      bodyYawOffset: 0,
      theta: 0,
      thetaExit: 0,
      lift: 0,
      gripY: 0,
      h: new THREE.Vector3(),
      s: new THREE.Vector3(),
    };
    r.bodyLift0 = body.position.y - r.center.y;
    // Camera: from where it is now to a view of the body from a little further back and higher
    {
      const look = r.center.clone().add(_v.set(0, CAM_LOOK_UP, 0));
      const back = _v.subVectors(camera.position, r.center).setY(0);
      if (back.lengthSq() < 1e-6) back.set(0, 0, -1).applyQuaternion(camera.quaternion).setY(0).negate();
      back.normalize();
      const pos = r.center.clone().addScaledVector(back, CAM_BACK).add(_v2.set(0, CAM_UP, 0));
      const m = new THREE.Matrix4().lookAt(pos, look, new THREE.Vector3(0, 1, 0));
      r.cam = {
        fromPos: camera.position.clone(), fromQuat: camera.quaternion.clone(),
        pos, quat: new THREE.Quaternion().setFromRotationMatrix(m), fromFov: camera.fov, fov: CAM_FOV,
      };
      camera.position.copy(pos);
      camera.quaternion.copy(r.cam.quat);
      camera.fov = CAM_FOV;
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld();   // (the spawn distance below is checked from the final view)
    }
    // Leave sideways across the view: toward the camera's right or left (random)
    const camRight = _v.set(1, 0, 0).applyQuaternion(camera.quaternion).setY(0);
    if (camRight.lengthSq() < 1e-6) camRight.set(1, 0, 0);
    camRight.normalize();
    if (Math.random() < 0.5) camRight.negate();
    const exitDir = camRight.clone();
    r.thetaExit = Math.atan2(exitDir.x, exitDir.z);
    // The body lies along its own forward axis: start the frame along whichever way of it is
    // closer to the exit
    const bodyYaw = body.rotation.y;
    const fwd = _v.set(Math.sin(bodyYaw), 0, Math.cos(bodyYaw));
    r.theta = fwd.dot(exitDir) >= 0 ? bodyYaw : bodyYaw + Math.PI;
    r.bodyYawOffset = bodyYaw - r.theta;
    headingVectors(r.theta, r.h, r.s);
    // Spawn out along the exit, far enough to be off screen
    let dist = SPAWN_MIN_DIST;
    while (dist < SPAWN_MAX_DIST && !offscreen(_v.copy(r.center).addScaledVector(exitDir, dist).setY(r.center.y + 0.5))) dist += 1;
    camera.position.copy(r.cam.fromPos);
    camera.quaternion.copy(r.cam.fromQuat);
    camera.fov = r.cam.fromFov;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    run = r;
    const url = glbCharacterConfig.frogManUrl;
    [1, -1].forEach((sign) => {
      const c = { sign, container: null, character: null, hands: null, arrived: false, rest: null };
      r.carriers.push(c);
      createGLBCharacterInstance({ targetHeight: CARRIER_HEIGHT, url, armIK: true }).then(({ container, character: ch }) => {
        if (run !== r) { ch.dispose(); return; }
        c.container = container;
        c.character = ch;
        // Floating hand targets ('right' = local +X, as everywhere in the game)
        c.hands = { right: new THREE.Object3D(), left: new THREE.Object3D() };
        c.hands.right.position.set(HAND_REST.x, HAND_REST.y, HAND_REST.z);
        c.hands.left.position.set(-HAND_REST.x, HAND_REST.y, HAND_REST.z);
        container.add(c.hands.right, c.hands.left);
        const p = _v.copy(r.center).addScaledVector(exitDir, dist + (sign > 0 ? 0 : 0.9)).addScaledVector(r.s, sign * 0.6);
        container.position.set(p.x, groundY(p.x, p.z, r.center.y), p.z);
        container.rotation.y = Math.atan2(r.center.x - p.x, r.center.z - p.z);
        scene.add(container);
        ch.setMoving(true);
      }).catch((e) => {
        console.warn('[DeathCarry] carrier load failed:', e);
        if (run === r) finish();
      });
    });
  }

  // Carrier slot / grip points in the current frame
  const slotFor = (r, sign, out) => out.copy(r.center)
    .addScaledVector(r.s, sign * CARRIER_SIDE).addScaledVector(r.h, -CARRIER_BACK);
  const gripFor = (r, sign, hand, out) => {
    // The hand on the body's side of the carrier ('left' for the +side carrier) takes the back grip
    const inner = (sign > 0) === (hand === 'left');
    return out.copy(r.center)
      .addScaledVector(r.s, sign * GRIP_SIDE)
      .addScaledVector(r.h, inner ? GRIP_BACK : GRIP_FRONT)
      .setY(r.gripY + r.lift);
  };

  function placeBody(r) {
    const b = r.body;
    b.position.set(r.center.x, r.center.y + r.bodyLift0 + r.lift, r.center.z);
    b.rotation.y = r.theta + r.bodyYawOffset;
  }

  // Hands: rest pose blended toward the grips by `reach` (0..1)
  function poseCarrier(r, c, dt, reach) {
    const ch = c.character;
    ch.animate(dt);
    c.container.updateMatrixWorld(true);
    for (const hand of ['right', 'left']) {
      const t = c.hands[hand];
      t.position.set(hand === 'right' ? HAND_REST.x : -HAND_REST.x, HAND_REST.y, HAND_REST.z);
      if (reach > 0) {
        const rest = c.container.localToWorld(_v.copy(t.position));
        gripFor(r, c.sign, hand, _v2);
        rest.lerp(_v2, reach);
        t.position.copy(c.container.worldToLocal(rest));
      }
      t.updateMatrixWorld();
      ch.solveArm(hand, t, { writeBack: false });
    }
    ch.stepFluff(dt);
  }

  function setPhase(r, phase) {
    r.phase = phase;
    r.phaseT = 0;
  }

  function update(dt) {
    const r = run;
    if (!r) return;
    dt = Math.min(dt || 0.016, 0.1);
    r.phaseT += dt;
    // The camera eases to its spot, then stays put (first: the off-screen checks below
    // project with it)
    r.camT = Math.min(1, r.camT + dt / CAM_EASE_S);
    const k = easeInOut(r.camT);
    camera.position.lerpVectors(r.cam.fromPos, r.cam.pos, k);
    camera.quaternion.slerpQuaternions(r.cam.fromQuat, r.cam.quat, k);
    camera.fov = r.cam.fromFov + (r.cam.fov - r.cam.fromFov) * k;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    const ready = r.carriers.every((c) => c.character);

    if (ready) {
      if (r.phase === 'loading') setPhase(r, 'approach');
      if (r.phase === 'approach') {
        let all = true;
        for (const c of r.carriers) {
          const p = c.container.position;
          const to = slotFor(r, c.sign, _v);
          const dx = to.x - p.x;
          const dz = to.z - p.z;
          const d = Math.hypot(dx, dz);
          if (d > 0.05 && r.phaseT < APPROACH_MAX_S) {
            all = false;
            const step = Math.min(d, APPROACH_SPEED * dt);
            p.x += (dx / d) * step;
            p.z += (dz / d) * step;
            p.y = groundY(p.x, p.z, p.y);
            c.container.rotation.y += angleDelta(c.container.rotation.y, Math.atan2(dx, dz)) * Math.min(1, dt * 10);
          } else {
            p.set(to.x, groundY(to.x, to.z, p.y), to.z);
            c.character.setMoving(false);
            c.container.rotation.y += angleDelta(c.container.rotation.y, r.theta) * Math.min(1, dt * 8);
          }
        }
        if (all && r.carriers.every((c) => Math.abs(angleDelta(c.container.rotation.y, r.theta)) < 0.08)) {
          // Grip height: the lying body's hips (the clip has finished falling by now)
          const hips = r.character?.fluffy?.getBone?.('Hips');
          r.gripY = hips ? hips.getWorldPosition(_v).y : r.body.position.y + 0.12;
          r.gripY = Math.max(r.gripY, r.center.y + 0.06);
          setPhase(r, 'reach');
        }
      } else if (r.phase === 'reach') {
        if (r.phaseT >= REACH_S) setPhase(r, 'lift');
      } else if (r.phase === 'lift') {
        r.lift = LIFT_HEIGHT * easeInOut(Math.min(1, r.phaseT / LIFT_S));
        if (r.phaseT >= LIFT_S) {
          setPhase(r, 'turn');
          r.carriers.forEach((c) => c.character.setMoving(true));
        }
      } else if (r.phase === 'turn') {
        const d = angleDelta(r.theta, r.thetaExit);
        const step = Math.sign(d) * Math.min(Math.abs(d), TURN_SPEED * dt);
        r.theta += step;
        if (Math.abs(d) < 1e-3) setPhase(r, 'carry');
      } else if (r.phase === 'carry') {
        r.center.addScaledVector(r.h, CARRY_SPEED * dt);
        const gy = groundY(r.center.x, r.center.z, r.center.y);
        r.gripY += gy - r.center.y;
        r.center.y = gy;
        const gone = r.phaseT > 0.5 && offscreen(_v.copy(r.body.position).setY(r.center.y + 0.5))
          && r.carriers.every((c) => offscreen(_v.copy(c.container.position).setY(r.center.y + 0.5)));
        if (gone || r.phaseT > CARRY_MAX_S) { finish(); return; }
      }

      if (r.phase !== 'approach') {
        headingVectors(r.theta, r.h, r.s);
        placeBody(r);
        for (const c of r.carriers) {
          const to = slotFor(r, c.sign, _v);
          c.container.position.set(to.x, groundY(to.x, to.z, c.container.position.y), to.z);
          c.container.rotation.y = r.theta;
        }
      }
      const reach = r.phase === 'approach' ? 0
        : r.phase === 'reach' ? easeInOut(Math.min(1, r.phaseT / REACH_S)) : 1;
      for (const c of r.carriers) poseCarrier(r, c, dt, reach);
    }
  }

  function removeCarriers(r) {
    for (const c of r.carriers) {
      if (c.container) scene.remove(c.container);
      c.character?.dispose();
      c.character = null;
    }
  }

  function finish() {
    const r = run;
    if (!r) return;
    run = null;
    removeCarriers(r);
    r.onDone?.();
  }

  /** Stops a carry without calling onDone. */
  function cancel() {
    const r = run;
    if (!r) return;
    run = null;
    removeCarriers(r);
  }

  return { start, update, cancel, isActive: () => !!run };
}

/**
 * Sword Showdown heart bubbles: floating bubbles with a heart inside, placed around
 * the middle of a stage's path. When the player comes near, a bubble drifts to a spot
 * just in front of them (a little past the resting sword tip) and waits there; poking
 * it with the sword pops it for a health segment. If the player leaves it far behind,
 * it comes over again.
 */

import * as THREE from 'three';

const BUBBLE_RADIUS = 0.3;
const HOVER_HEIGHT = 0.85;       // m above the ground while waiting on the path
const ATTRACT_DIST = 4;          // m — within this the bubble drifts to the player
const REATTRACT_DIST = 6;        // m — player this far from the waiting spot: come over again
const PRESENT_AHEAD = 1.3;       // m in front of the player where it waits
const PRESENT_HEIGHT = 0.75;     // m above the player's feet (sword height)
const PRESENT_SIDE = 0.2;        // m toward the sword side (+X is the sword hand)
const DRIFT_RATE = 2.5;          // 1/s exponential approach
const POP_DURATION = 0.25;       // s — pop animation
const POP_REACH = BUBBLE_RADIUS + 0.06; // blade point within this of the center pops it

let _heartGeometry = null;
function getHeartGeometry() {
  if (_heartGeometry) return _heartGeometry;
  const s = new THREE.Shape();
  s.moveTo(0, -0.5);
  s.bezierCurveTo(-0.15, -0.35, -0.5, -0.15, -0.5, 0.12);
  s.bezierCurveTo(-0.5, 0.38, -0.28, 0.5, -0.14, 0.5);
  s.bezierCurveTo(-0.05, 0.5, 0, 0.42, 0, 0.34);
  s.bezierCurveTo(0, 0.42, 0.05, 0.5, 0.14, 0.5);
  s.bezierCurveTo(0.28, 0.5, 0.5, 0.38, 0.5, 0.12);
  s.bezierCurveTo(0.5, -0.15, 0.15, -0.35, 0, -0.5);
  const geo = new THREE.ExtrudeGeometry(s, {
    depth: 0.18, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.05, bevelSegments: 3, curveSegments: 10,
  });
  geo.center();
  _heartGeometry = geo;
  return geo;
}

let _sphereGeometry = null;
const getSphereGeometry = () => (_sphereGeometry ??= new THREE.SphereGeometry(BUBBLE_RADIUS, 24, 16));

const _target = new THREE.Vector3();
const _forward = new THREE.Vector3();
const _side = new THREE.Vector3();

export function createHeartBubbles({ scene, getGroundY }) {
  const bubbles = [];

  const spawn = (position) => {
    const group = new THREE.Group();
    group.name = 'HeartBubble';
    const shell = new THREE.Mesh(getSphereGeometry(), new THREE.MeshPhongMaterial({
      color: 0xffc2d6, emissive: 0x6a1a3a, specular: 0xffffff, shininess: 90,
      transparent: true, opacity: 0.32, depthWrite: false, side: THREE.DoubleSide,
    }));
    shell.renderOrder = 10;
    const heart = new THREE.Mesh(getHeartGeometry(), new THREE.MeshStandardMaterial({
      color: 0xff2a4a, emissive: 0xc0102a, emissiveIntensity: 0.7, roughness: 0.35, metalness: 0.1,
    }));
    heart.scale.setScalar(0.34);
    group.add(heart, shell);
    const groundY = getGroundY(position.x, position.z);
    const baseY = (Number.isFinite(groundY) ? groundY : position.y) + HOVER_HEIGHT;
    group.position.set(position.x, baseY, position.z);
    scene.add(group);
    bubbles.push({
      group, shell, heart, baseY,
      phase: Math.random() * Math.PI * 2,
      anchor: null, // THREE.Vector3 — waiting spot once it has come to the player
      popT: -1,
    });
  };

  const dispose = (b) => {
    scene.remove(b.group);
    b.shell.material.dispose();
    b.heart.material.dispose();
  };

  const clear = () => {
    bubbles.forEach(dispose);
    bubbles.length = 0;
  };

  /**
   * @param {number} dt
   * @param {object} opts
   * @param {THREE.Object3D|null} opts.playerModel – null while the player can't collect
   * @param {THREE.Vector3[]|null} opts.bladePoints – player's sword points (world)
   * @returns {number} bubbles popped this frame
   */
  const update = (dt, { playerModel = null, bladePoints = null } = {}) => {
    let popped = 0;
    const time = performance.now() * 0.001;
    for (let i = bubbles.length - 1; i >= 0; i--) {
      const b = bubbles[i];
      if (b.popT >= 0) {
        b.popT += dt;
        const k = Math.min(1, b.popT / POP_DURATION);
        b.group.scale.setScalar(1 + k * 0.8);
        b.shell.material.opacity = 0.32 * (1 - k);
        b.heart.scale.setScalar(0.34 * (1 - k));
        if (k >= 1) { dispose(b); bubbles.splice(i, 1); }
        continue;
      }
      b.heart.rotation.y += dt * 1.8;
      const bob = Math.sin(time * 2 + b.phase) * 0.06;
      if (playerModel) {
        const comeOver = b.anchor
          ? b.anchor.distanceTo(playerModel.position) > REATTRACT_DIST
          : b.group.position.distanceTo(playerModel.position) < ATTRACT_DIST;
        if (comeOver) {
          // Just came in range, or left far behind: pick a waiting spot in front of the player
          playerModel.getWorldDirection(_forward).setY(0);
          if (_forward.lengthSq() < 1e-6) _forward.set(0, 0, 1);
          _forward.normalize();
          _side.set(_forward.z, 0, -_forward.x); // model +X
          b.anchor = (b.anchor ?? new THREE.Vector3()).copy(playerModel.position)
            .addScaledVector(_forward, PRESENT_AHEAD)
            .addScaledVector(_side, PRESENT_SIDE);
          b.anchor.y += PRESENT_HEIGHT;
        }
      }
      if (b.anchor) {
        _target.copy(b.anchor);
        _target.y += bob;
        b.group.position.lerp(_target, 1 - Math.exp(-DRIFT_RATE * dt));
      } else {
        b.group.position.y = b.baseY + bob;
      }
      if (bladePoints) {
        for (const p of bladePoints) {
          if (p.distanceTo(b.group.position) < POP_REACH) {
            b.popT = 0;
            popped++;
            break;
          }
        }
      }
    }
    return popped;
  };

  return { spawn, update, clear, get count() { return bubbles.length; } };
}

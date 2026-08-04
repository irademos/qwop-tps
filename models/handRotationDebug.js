/**
 * Debug panel for tuning GLB hand rotation mapping.
 * Import and call initHandRotationDebug() once; then read handRotConfig
 * each frame from updateGLBHandSceneRotation.
 *
 * Remove this file and its import when tuning is done.
 */

import * as THREE from 'three';

// ── shared config object (mutated by UI, read by rotation code) ──────────────
export const handRotConfig = {
  // Euler offset post-multiplied onto the computed orientation (degrees).
  offsetX: 180,
  offsetY: -180,
  offsetZ: 0,
  offsetOrder: 'XYZ',

  // Extra rotation (degrees) around the hand's own FINGER axis (GLB local Y).
  // Useful for fixing "palm 180° off" without touching the global offset.
  palmAxisDeg: 0,

  // Flip the computed palm normal before deriving the right axis.
  // Equivalent to rotating 180° around the finger axis — try this first
  // when palm faces camera instead of forward.
  flipNormal: false,

  // Signs applied to the final quaternion components (1 or -1).
  signW: 1,
  signX: 1,
  signY: -1,
  signZ: 1,

  // Across-palm axis: +1 → pts[17]-pts[5], -1 → pts[5]-pts[17]
  acrossSign: 1,

  // Palm normal cross product order
  crossOrder: 'across_x_finger',

  // Which landmark indices define the finger direction (wrist, tip-of-palm).
  // Default 0→9 (wrist→middle MCP). Try 0→12 (wrist→middle tip) for fist.
  fingerLmA: 0,
  fingerLmB: 9,

  // Which landmark indices define the across-palm axis.
  // Default 17→5 (pinky MCP → index MCP).
  acrossLmA: 17,
  acrossLmB: 5,

  // Smoothing speed (1=slow, 40=instant)
  smoothing: 14,
};

// ── cached THREE objects (no allocation in hot path) ─────────────────────────
const _offsetQ    = new THREE.Quaternion();
const _offsetE    = new THREE.Euler();
const _palmAxisQ  = new THREE.Quaternion();
const _palmAxisV  = new THREE.Vector3(0, 1, 0); // GLB local Y = finger axis

export function getOffsetQuaternion() {
  _offsetE.set(
    handRotConfig.offsetX * (Math.PI / 180),
    handRotConfig.offsetY * (Math.PI / 180),
    handRotConfig.offsetZ * (Math.PI / 180),
    handRotConfig.offsetOrder,
  );
  _offsetQ.setFromEuler(_offsetE);

  if (handRotConfig.palmAxisDeg !== 0) {
    _palmAxisQ.setFromAxisAngle(_palmAxisV, handRotConfig.palmAxisDeg * (Math.PI / 180));
    _offsetQ.multiply(_palmAxisQ);
  }
  return _offsetQ;
}

// ── hand position offset (applied on top of tracked wrist position) ───────────
export const handPosOffset = { x: 0.0140, y: -0.0050, z: -0.0050 };

export const armConfig = { thickness: 0.4 };

export function initHandRotationDebug() {}

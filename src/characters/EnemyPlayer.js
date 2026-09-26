/**
 * EnemyPlayer — a horde-mode opponent that looks like the player (the shared GLB
 * character, whose arms reach for the floating hand targets) and always wields a foam sword.
 *
 * AI: chases the player; enters attack mode when close; swings right hand
 * sinusoidally so the sword tip sweeps through the player's hit sphere.
 *
 * Physics: dynamic Rapier capsule.  Sword hit detection is frame-by-frame
 * distance/sweep rather than a dedicated Rapier body (same approach the
 * rest of the game uses for melee weapons).
 */

import { spawnBloodBurst } from '../combat/bloodEffect.js';
import * as THREE from 'three';
import { getKnockbackImpulse, getKnockbackMotion, RAGDOLL_STRENGTH_THRESHOLD } from '../combat/knockback.js';
import { createGLBCharacterInstance } from '../models/glbCharacterModel.js';
import { getTerrainHeight } from '../environment/terrainHeight.js';

const _bloodOffset = new THREE.Vector3(0, 0.35, 0); // spray from chest height

// ─── constants ───────────────────────────────────────────────────────────────

const CAPSULE_RADIUS   = 0.28;
const CAPSULE_HEIGHT   = 1.0;

const CHASE_SPEED   = 3.2;   // m/s while chasing
const ATTACK_RANGE  = 2.8;   // switch to attack mode when this close
const CHASE_RANGE   = 0.9;   // stop moving closer when this close (during attack)
const BACKOFF_SPEED = 1.6;   // m/s retreat speed when yielding attack slot
const BACKOFF_DIST  = 3.8;   // target distance while backing off

// Sword tip distance threshold for registering a hit
const SWORD_TIP_HIT_RADIUS  = 0.55;

const SWORD_DAMAGE          = 2;  // health segments per hit
const HIT_COOLDOWN_MS       = 1200;

// Sword tip offset in the sword group's local space (+Z points toward tip)
const SWORD_TIP_LOCAL = new THREE.Vector3(0, 0, 0.69);

// ── Blade poses (body-local space; +Z = forward, +Y = up) ─────────────────────
// Blade directions are unit vectors; the sword quaternion is built so its +Z (blade)
// points along them. See bladeQuat() below.
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const N = (x, y, z) => new THREE.Vector3(x, y, z).normalize();

// Swings sweep the blade in an arc from one extreme side, through the front of the body
// (where it hits), to the opposite side. `from` is the wound-up blade direction, `mid` the
// direction as it passes in front, `to` the follow-through. The hand rides the same arc
// around SWING_PIVOT, so the whole sword sweeps rather than poking forward.
const SWING_PIVOT = V(0, 0.9, 0.18);
const SWING_REACH = 0.38;
export const SWING_PRESETS = [
  { from: N( 0.15,  1.0,  -0.35), mid: N( 0.0,  0.10, 1), to: N(-0.10, -0.85, 0.45) }, // overhead → slam down
  { from: N( 1.0,   0.15, -0.25), mid: N( 0.0, -0.05, 1), to: N(-1.0,  -0.10, 0.15) }, // right → left sweep
  { from: N(-1.0,   0.15, -0.25), mid: N( 0.0, -0.05, 1), to: N( 1.0,  -0.10, 0.15) }, // left → right sweep
  { from: N( 0.75,  0.75, -0.20), mid: N( 0.0,  0.0,  1), to: N(-0.70, -0.60, 0.20) }, // upper-right → lower-left
  { from: N(-0.75,  0.75, -0.20), mid: N( 0.0,  0.0,  1), to: N( 0.70, -0.60, 0.20) }, // upper-left → lower-right
  { from: N( 0.85, -0.45,  0.05), mid: N( 0.0,  0.10, 1), to: N(-0.70,  0.70, 0.0 ) }, // low-right → upper-left rising
];
// Roll reference for each swing: the normal of its swing plane, so the blade keeps a
// constant edge orientation through the arc.
for (const p of SWING_PRESETS) {
  p.flat = new THREE.Vector3().crossVectors(p.from, p.mid)
    .add(new THREE.Vector3().crossVectors(p.mid, p.to)).normalize();
}

// ── Block poses: hand position + blade direction (body-local) ─────────────────
// The blade always lies across the body — vertical, horizontal or diagonal — never
// pointing out at the opponent. Each enemy randomly picks one when entering a block.
export const BLOCK_PRESETS = [
  { hand: V( 0.12, 0.85, 0.28), dir: N( 0.0,  1.0, 0.08) }, // vertical, center
  { hand: V( 0.30, 1.10, 0.30), dir: N(-1.0,  0.05, 0.05) }, // horizontal, high (across face)
  { hand: V( 0.30, 0.85, 0.30), dir: N(-1.0,  0.0,  0.05) }, // horizontal, mid (across chest)
  { hand: V( 0.25, 0.80, 0.30), dir: N(-0.7,  0.7,  0.05) }, // diagonal, rising to the left
  { hand: V(-0.20, 0.80, 0.30), dir: N( 0.7,  0.7,  0.05) }, // diagonal, rising to the right
];
const BLOCK_FLAT_REF = V(0, 0, 1);

// ── Idle pose: sword held forward, tip tilted slightly up; neither blocking nor attacking
const IDLE_HAND      = V(0.12, 0.80, 0.30);
const IDLE_BLADE_DIR = N(0.05, 0.35, 1);
const IDLE_FLAT_REF  = V(1, 0, 0);

// Attack-loop timing (seconds)
const SWING_WINDUP_MIN = 0.60, SWING_WINDUP_RAND = 0.45; // wind-up before a swing
const SWING_EXEC_MIN   = 0.32, SWING_EXEC_RAND   = 0.10; // the swing itself
const SWING_END_HOLD   = 2.0;                            // follow-through hold
// Wind-up jostle: the sword circles restlessly at the wound-up extreme before the swing
const WINDUP_CIRCLE_HZ     = 2.2;   // revolutions per second
const WINDUP_CIRCLE_HAND   = 0.06;  // hand circle radius (m)
const WINDUP_CIRCLE_BLADE  = 0.22;  // blade-direction circle radius (unit-vector offset)

// Trail rendering for sword swings
const TRAIL_DURATION_MS  = 380;  // how long trail history is kept (ms)
const TRAIL_FADE_MS      = 450;  // how long trail fades after swing (ms)
const TRAIL_COLORS       = [0xff4986, 0xff79ab, 0xffaad0]; // three stacked lines

// Rapier capsule dimensions (must match body visual)
const PHYS_HALF_HEIGHT = 0.6;
const PHYS_RADIUS      = 0.3;

// Upper limits on the knockback a dead enemy can receive (the killing blow and anything
// after it), so the death ragdoll tumbles back instead of rocketing across the arena.
export const DEATH_KNOCKBACK_CAP = {
  horizSpeed: 7,   // m/s, horizontal
  upVelocity: 3,   // m/s, upward
  torqueMag: 40,   // torque impulse
  angSpeed: 10,    // rad/s, angular velocity
};

// Bomb blast: the enemy is thrown back a little harder than a death knockback and plays the
// flying-back death clip once, then gets up after BLAST_STUN_MS (if the blast didn't kill it).
// Also the velocity cap for an enemy the blast kills.
export const BLAST_KNOCKBACK = {
  horizSpeed: 9,   // m/s, horizontal
  upVelocity: 4,   // m/s, upward
  torqueMag: 20,   // torque impulse
  angSpeed: 12,    // rad/s, angular velocity
};
const BLAST_STUN_MS = 2200;

// Sword blade goes in +Z; default rest orientation (Euler, YXZ)
const DEG = Math.PI / 180;
const REST_SWORD_EULER = new THREE.Euler(360 * DEG, 90 * DEG, -90 * DEG, 'YXZ');

// ─── scratch objects (not per-instance, module-level) ────────────────────────
const _rootQ   = new THREE.Quaternion();
const _toTarget = new THREE.Vector3();
const _tmpV    = new THREE.Vector3();
const _tmpQ    = new THREE.Quaternion();
const _swordTipWorld  = new THREE.Vector3();
const _swordGuardWorld = new THREE.Vector3();
const _bladeDir = new THREE.Vector3();
const _swingDirWorld    = new THREE.Vector3();
const _playerBladeWorld = new THREE.Vector3();
const _upAxis  = new THREE.Vector3(0, 1, 0);
const _bladeX  = new THREE.Vector3();
const _bladeY  = new THREE.Vector3();
const _bladeM  = new THREE.Matrix4();

/** Body-local quaternion whose +Z (blade) points along `dir`; `flatRef` fixes the roll. */
function bladeQuat(dir, flatRef, out) {
  _bladeY.crossVectors(dir, flatRef);
  if (_bladeY.lengthSq() < 1e-6) _bladeY.crossVectors(dir, _upAxis);
  _bladeY.normalize();
  _bladeX.crossVectors(_bladeY, dir);
  _bladeM.makeBasis(_bladeX, _bladeY, dir);
  return out.setFromRotationMatrix(_bladeM);
}

/** Blade direction at progress `u` (0..1) of a swing: quadratic arc from → mid → to. */
function swingBladeDir(preset, u, out) {
  const a = (1 - u) * (1 - u), b = 2 * u * (1 - u), c = u * u;
  return out.set(0, 0, 0)
    .addScaledVector(preset.from, a)
    .addScaledVector(preset.mid, b)
    .addScaledVector(preset.to, c)
    .normalize();
}

// ── Directional blocking ──────────────────────────────────────────────────────
// A block only stops a swing that crosses the blocking blade. Seen from the attacker,
// if the swing's line of motion is within BLOCK_MIN_ANGLE_DEG of the blade's line
// (same or opposite direction), the swing slides along the blade and lands; otherwise
// it is blocked. E.g. a horizontal block stops an overhead chop but not a side sweep.
export const BLOCK_MIN_ANGLE_DEG = 30;
// The player's block is more forgiving: a wider reach around their blade, and only swings
// within this (smaller) angle of their blade's line slip past it.
const PLAYER_BLOCK_MIN_ANGLE_DEG = 15;
const PLAYER_BLOCK_REACH         = 0.85;  // m, from any point of the player's blade
const _blkS = new THREE.Vector3();
const _blkB = new THREE.Vector3();
const _blkV = new THREE.Vector3();

/**
 * True if a swing moving along `swingDir` is stopped by a blade lying along `bladeDir`.
 * Both are projected onto the plane facing the attacker (`viewDir` = attacker → defender).
 * Swings within `minAngleDeg` of the blade's line get through.
 */
export function swingCrossesBlade(swingDir, bladeDir, viewDir, minAngleDeg = BLOCK_MIN_ANGLE_DEG) {
  _blkV.copy(viewDir);
  if (_blkV.lengthSq() < 1e-8) _blkV.set(0, 0, 1);
  _blkV.normalize();
  _blkS.copy(swingDir).addScaledVector(_blkV, -swingDir.dot(_blkV));
  _blkB.copy(bladeDir).addScaledVector(_blkV, -bladeDir.dot(_blkV));
  if (_blkB.lengthSq() < 1e-6) return false; // blade pointed at the attacker covers nothing
  if (_blkS.lengthSq() < 1e-6) return true;  // straight thrust into the guard
  const cos = Math.abs(_blkS.normalize().dot(_blkB.normalize()));
  return cos < Math.cos(minAngleDeg * Math.PI / 180);
}

/**
 * Wind-up jostle: an offset of length `radius` circling in the plane perpendicular to the
 * wound-up blade direction (`preset.from`), at WINDUP_CIRCLE_HZ.
 */
const _circA = new THREE.Vector3();
const _circB = new THREE.Vector3();
function windupCircleOffset(preset, t, seed, radius, out) {
  _circA.copy(preset.flat);
  _circB.crossVectors(preset.from, preset.flat).normalize();
  const ang = t * WINDUP_CIRCLE_HZ * Math.PI * 2 + seed;
  return out.copy(_circA).multiplyScalar(Math.cos(ang) * radius)
    .addScaledVector(_circB, Math.sin(ang) * radius);
}

/** Ease-in-out used for swing progress. */
function easeSwing(p) {
  return p < 0.5 ? 2 * p * p : -1 + (4 - 2 * p) * p;
}

// ─── EnemyPlayer ─────────────────────────────────────────────────────────────

export class EnemyPlayer {
  /**
   * @param {THREE.Scene}  scene
   * @param {object}       rapier   – the RAPIER module
   * @param {object}       rapierWorld – the live Rapier World
   * @param {object}       [options]
   * @param {THREE.Vector3} [options.position]
   */
  constructor(scene, rapier, rapierWorld, options = {}) {
    this.scene       = scene;
    this.rapier      = rapier;
    this.rapierWorld = rapierWorld;

    const initHearts = options.hearts ?? 3;
    this.hearts    = initHearts;
    this.maxHearts = initHearts;
    this.isDead    = false;
    this.speedScale = options.speedScale ?? 1.0;
    // Chance each attack-phase decision is a swing (rest is block/idle); set per stage
    this.swingChance = options.swingChance ?? 0.35;
    // Never walks (tutorial targets); still faces the player and fights if the player comes close
    this.stationary = !!options.stationary;
    // Tutorial override of the attack AI (see _applyScript), or null for the normal loop:
    //   { mode: 'passive' }                    – stands idle, never attacks
    //   { mode: 'block', preset }              – holds BLOCK_PRESETS[preset] indefinitely
    //   { mode: 'windup', preset, release }    – winds up SWING_PRESETS[preset] and only swings
    //                                            when `release` is set (cleared on the swing;
    //                                            `swings` counts them)
    this.script = options.script ?? null;
    // Times this sword has been knocked back (player block, shield, bubble or a blocked swing)
    this.swordBounces = 0;

    this._swingT       = 0;
    this._lastHitTime  = 0;
    this._aiState      = 'chase';  // 'chase' | 'attack' | 'backoff' | 'hold'

    // ── Attack phase state machine ──────────────────────────────────────────
    // Phases: 'decide' | 'block' | 'idle' | 'swing_hold' | 'swing_execute' | 'swing_end_hold'
    this._attackPhase    = 'decide';
    this._attackPhaseT   = 0;
    this._attackPhaseDur = 0;

    // Block state
    this._blockPreset  = BLOCK_PRESETS[0];
    this._blockSeed    = Math.random() * 100;  // unique wobble offset per enemy

    // Swing state
    this._swingPreset    = null;          // chosen SWING_PRESETS entry

    // Trail state (sampled during swing_execute, fades afterwards)
    this._trailPoints    = [];            // { pos: THREE.Vector3, t: number }[]
    this._trailLines     = [];            // THREE.Line objects in scene
    this._trailFadeStart = -1;            // ms timestamp when fade began

    this._isRagdoll    = false;
    this._ragdollTimeout = null;
    this._deathKnockbackCap = DEATH_KNOCKBACK_CAP; // BLAST_KNOCKBACK once a bomb blast kills us

    // Sword bounce state (triggered when player sword collides with this sword)
    this._bounceActive  = false;
    this._bounceEndTime = 0;

    // Sword quaternion (updated each frame)
    this._swordQuaternion = new THREE.Quaternion().setFromEuler(REST_SWORD_EULER);

    // ── Three.js hierarchy ──────────────────────────────────────────────────
    this.group = new THREE.Group();
    this.group.name = 'EnemyPlayer';

    const startPos = options.position ?? new THREE.Vector3(5, 0, 5);
    this.group.position.copy(startPos);

    this._buildBody();
    this._buildSword();
    this._buildTrail();
    this._buildHealthBar();
    this._buildPhysics(startPos);

    scene.add(this.group);
  }

  // ─── body / arms ───────────────────────────────────────────────────────────

  _buildBody() {
    // Capsule — kept as physics reference but hidden; replaced by GLB character below
    const capsuleMat = new THREE.MeshStandardMaterial({ color: 0xcc3300, roughness: 0.75, metalness: 0.05 });
    const capsuleGeo = new THREE.CapsuleGeometry(CAPSULE_RADIUS, CAPSULE_HEIGHT - CAPSULE_RADIUS * 2, 8, 16);
    const capsuleMesh = new THREE.Mesh(capsuleGeo, capsuleMat);
    capsuleMesh.name = 'enemyBodyCapsule';
    capsuleMesh.castShadow = true;
    capsuleMesh.receiveShadow = true;
    capsuleMesh.position.y = CAPSULE_HEIGHT / 2;
    capsuleMesh.visible = false;
    this.group.add(capsuleMesh);
    this._capsuleMesh = capsuleMesh;

    // GLB character — loaded async. Its arms reach for the floating hand groups below.
    this._glbCharacter = null;
    createGLBCharacterInstance({ targetHeight: CAPSULE_HEIGHT }).then(({ container, character }) => {
      if (this._destroyed) { character.dispose(); return; }
      this.group.add(container);
      this._glbCharacter = character;
      if (this.isDead) { character.setFurEnabled(false); character.playDeath(); }
    }).catch(e => console.warn('[EnemyPlayer] GLB character load failed:', e));

    // Floating hand groups — invisible targets that move around each frame; the GLB
    // arms reach for them and the sword follows the right one.
    this._leftHandGroup  = new THREE.Group();
    this._leftHandGroup.name  = 'enemyLeftFloatingHand';
    this._leftHandGroup.position.set(-0.5, 0.82, 0.25);
    this.group.add(this._leftHandGroup);

    this._rightHandGroup = new THREE.Group();
    this._rightHandGroup.name = 'enemyRightFloatingHand';
    this._rightHandGroup.position.set( 0.5, 0.82, 0.25);
    this.group.add(this._rightHandGroup);
  }

  /** Pose the GLB arm for `side` so its hand reaches (and snaps) the floating hand group. */
  _solveArm(side) {
    this._glbCharacter?.solveArm(side, side === 'right' ? this._rightHandGroup : this._leftHandGroup);
  }

  // ─── sword trail ──────────────────────────────────────────────────────────

  _buildTrail() {
    for (let i = 0; i < TRAIL_COLORS.length; i++) {
      const mat = new THREE.LineBasicMaterial({
        color: TRAIL_COLORS[i],
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const geo = new THREE.BufferGeometry();
      const line = new THREE.Line(geo, mat);
      line.frustumCulled = false;
      this.scene.add(line);
      this._trailLines.push(line);
    }
  }

  _sampleTrail(nowMs) {
    // Sample the sword tip world position
    const tip = new THREE.Vector3();
    tip.copy(SWORD_TIP_LOCAL).applyQuaternion(this._swordGroup.quaternion).add(this._swordGroup.position);
    this._trailPoints.push({ pos: tip, t: nowMs });
    // Trim old points
    const cutoff = nowMs - TRAIL_DURATION_MS;
    while (this._trailPoints.length && this._trailPoints[0].t < cutoff) {
      this._trailPoints.shift();
    }
  }

  _updateTrailMeshes(nowMs) {
    const pts = this._trailPoints;
    const fading = this._trailFadeStart > 0;

    if (pts.length < 2) {
      this._trailLines.forEach(l => { l.material.opacity = 0; });
      return;
    }

    // Fade multiplier
    let fadeMult = 1;
    if (fading) {
      fadeMult = Math.max(0, 1 - (nowMs - this._trailFadeStart) / TRAIL_FADE_MS);
      if (fadeMult <= 0) {
        // Trail fully faded — clear points so we stop rendering
        this._trailPoints = [];
        this._trailFadeStart = -1;
        this._trailLines.forEach(l => { l.material.opacity = 0; });
        return;
      }
    }

    // Build positions for each stacked line (slight horizontal offsets for width)
    const offsets = [-0.018, 0, 0.018];
    this._trailLines.forEach((line, li) => {
      const off = offsets[li];
      const positions = new Float32Array(pts.length * 3);
      pts.forEach((p, i) => {
        positions[i * 3]     = p.pos.x + off;
        positions[i * 3 + 1] = p.pos.y;
        positions[i * 3 + 2] = p.pos.z;
      });
      line.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      line.geometry.setDrawRange(0, pts.length);
      line.geometry.computeBoundingSphere();

      const baseOpacity = li === 0 ? 0.82 : li === 1 ? 0.55 : 0.35;
      line.material.opacity = baseOpacity * fadeMult;
    });
  }

  // ─── foam sword ────────────────────────────────────────────────────────────

  _buildSword() {
    const swordGroup = new THREE.Group();
    swordGroup.name = 'enemyFoamSword';

    // Blade
    const bladeGeo = new THREE.CylinderGeometry(0.022, 0.032, 0.62, 12);
    bladeGeo.rotateX(Math.PI / 2);
    const blade = new THREE.Mesh(bladeGeo, new THREE.MeshStandardMaterial({ color: 0x2255dd, roughness: 0.55 }));
    blade.position.set(0, 0, 0.31);
    blade.castShadow = true;
    swordGroup.add(blade);

    // Tip
    const tipGeo = new THREE.CylinderGeometry(0, 0.022, 0.07, 10);
    tipGeo.rotateX(Math.PI / 2);
    const tip = new THREE.Mesh(tipGeo, new THREE.MeshStandardMaterial({ color: 0x66aaff }));
    tip.position.set(0, 0, 0.655);
    swordGroup.add(tip);

    // Guard
    const guardGeo = new THREE.CylinderGeometry(0.11, 0.11, 0.035, 14);
    guardGeo.rotateX(Math.PI / 2); // circular face perpendicular to blade
    const guard = new THREE.Mesh(
      guardGeo,
      new THREE.MeshStandardMaterial({ color: 0xcc2222 })
    );
    guard.position.set(0, 0, 0);
    swordGroup.add(guard);

    // Handle
    const handleGeo = new THREE.CylinderGeometry(0.028, 0.032, 0.16, 10);
    handleGeo.rotateX(Math.PI / 2);
    const handle = new THREE.Mesh(handleGeo, new THREE.MeshStandardMaterial({ color: 0xdd3333 }));
    handle.position.set(0, 0, -0.08);
    swordGroup.add(handle);

    // Pommel
    const pommel = new THREE.Mesh(
      new THREE.SphereGeometry(0.038, 10, 8),
      new THREE.MeshStandardMaterial({ color: 0xaa1111 })
    );
    pommel.position.set(0, 0, -0.175);
    swordGroup.add(pommel);

    this._swordGroup = swordGroup;
    this.scene.add(swordGroup); // added directly to scene so world transforms are straightforward
  }

  // ─── heart display ─────────────────────────────────────────────────────────

  _buildHealthBar() {
    const canvas = document.createElement('canvas');
    canvas.width  = 96;
    canvas.height = 32;
    this._hpCanvas  = canvas;
    this._hpCtx     = canvas.getContext('2d');
    this._hpTexture = new THREE.CanvasTexture(canvas);

    const mat = new THREE.MeshBasicMaterial({ map: this._hpTexture, transparent: true, depthWrite: false, side: THREE.DoubleSide });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(0.72, 0.24), mat);
    plane.name = 'enemyHealthBar';
    plane.position.y = CAPSULE_HEIGHT + 0.3;
    plane.visible = false;
    this.group.add(plane);
    this._hpPlane = plane;
    this._hpShowUntil = 0;
    this._updateHealthBarCanvas(true);
  }

  _updateHealthBarCanvas(silent = false) {
    const ctx = this._hpCtx;
    const W = 96, H = 32;
    ctx.clearRect(0, 0, W, H);
    const heartSize = 24;
    const gap = 4;
    const totalW = this.maxHearts * heartSize + (this.maxHearts - 1) * gap;
    const startX = (W - totalW) / 2;
    ctx.font = `${heartSize}px serif`;
    for (let i = 0; i < this.maxHearts; i++) {
      const x = startX + i * (heartSize + gap);
      const filled = i < this.hearts;
      ctx.globalAlpha = filled ? 1 : 0.25;
      ctx.fillStyle = filled ? '#ff2244' : '#000000';
      ctx.fillText('❤', x, H - 4);
    }
    ctx.globalAlpha = 1;
    this._hpTexture.needsUpdate = true;
    if (!silent) {
      // Show hearts for 3 seconds after a hit
      this._hpShowUntil = Date.now() + 3000;
      if (this._hpPlane) this._hpPlane.visible = true;
    }
  }

  // ─── Rapier physics ────────────────────────────────────────────────────────

  _buildPhysics(pos) {
    const RAPIER = this.rapier;
    const world  = this.rapierWorld;

    const rbDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(pos.x, pos.y + CAPSULE_HEIGHT / 2, pos.z)
      .setLinearDamping(2.0)
      .setAngularDamping(5.0);
    this.rigidBody = world.createRigidBody(rbDesc);
    // Lock rotations so the capsule stays upright
    this.rigidBody.setEnabledRotations(false, true, false, true);

    const colDesc = RAPIER.ColliderDesc.capsule(PHYS_HALF_HEIGHT, PHYS_RADIUS)
      .setFriction(0.5)
      .setRestitution(0.1);
    world.createCollider(colDesc, this.rigidBody);
  }

  // ─── update (called each frame) ────────────────────────────────────────────

  /**
   * @param {number}        dt          – seconds since last frame
   * @param {THREE.Object3D} targetModel – the player's Three.js group
   * @param {object|null}   targetControls – PlayerControls (for applyKnockback / applyDamage)
   * @param {boolean}       shieldActive – whether the player has shield equipped and facing us
   * @param {boolean}       allowAttack  – if false, yield attack slot: retreat and hold idle pose
   * @param {boolean}       attacksPaused – if true, hold position with an idle guard (no swings/hits);
   *                                        used while a bomb is flying at the player
   */
  update(dt, targetModel, targetControls, shieldActive, allowAttack = true, attacksPaused = false) {
    if (!this.rigidBody) return;

    // ── Sync visual group from physics ──────────────────────────────────────
    const t = this.rigidBody.translation();
    const physY = t.y - (PHYS_HALF_HEIGHT + PHYS_RADIUS);
    const terrainY = getTerrainHeight(t.x, t.z);
    const groupY = Number.isFinite(terrainY) ? Math.max(physY, terrainY) : physY;
    this.group.position.set(t.x, groupY, t.z);

    // Dead: ragdoll rotation from physics + the death clip; skip all AI and combat logic
    if (this.isDead) {
      this._clampDeathVelocity();
      if (this._isRagdoll) {
        const rot = this.rigidBody.rotation();
        this.group.quaternion.set(rot.x, rot.y, rot.z, rot.w);
      }
      this._glbCharacter?.animate(dt);
      this._solveArm('right');
      this._solveArm('left');
      this._glbCharacter?.stepFluff(dt);
      return;
    }

    // ── Ragdoll: sync full rotation from physics body ──────────────────────
    if (this._isRagdoll) {
      const rot = this.rigidBody.rotation();
      this.group.quaternion.set(rot.x, rot.y, rot.z, rot.w);
      // Still update arms/sword visuals but skip AI
      this._glbCharacter?.setMoving(false);
      this._glbCharacter?.animate(dt);
      this._updateHandPositions(dt, Infinity);
      this._solveArm('right');
      this._updateSword(dt);
      this._updateLeftHandToPommel(dt);
      this._solveArm('left');
      this._glbCharacter?.stepFluff(dt);
      this._updateTrailMeshes(Date.now());
      return;
    }

    // ── Face the player ────────────────────────────────────────────────────
    if (targetModel) {
      _toTarget.subVectors(targetModel.position, this.group.position);
      _toTarget.y = 0;
      if (_toTarget.lengthSq() > 0.001) {
        const targetYaw = Math.atan2(_toTarget.x, _toTarget.z);
        this.group.rotation.y = THREE.MathUtils.lerp(
          this.group.rotation.y, targetYaw, 1 - Math.exp(-8 * dt)
        );
      }
    }

    const distToTarget = targetModel
      ? this.group.position.distanceTo(targetModel.position)
      : Infinity;

    // ── AI state ───────────────────────────────────────────────────────────
    const scriptMode = this.script?.mode;
    if (scriptMode === 'passive') {
      this._aiState = 'hold';
    } else if (scriptMode === 'block' || scriptMode === 'windup') {
      // Scripted stances ignore attack slots and bomb pauses
      this._aiState = distToTarget < ATTACK_RANGE ? 'attack' : 'chase';
    } else if (attacksPaused && distToTarget < ATTACK_RANGE) {
      this._aiState = 'hold';
    } else if (!allowAttack && distToTarget < BACKOFF_DIST) {
      this._aiState = 'backoff';
    } else if (distToTarget < ATTACK_RANGE && allowAttack) {
      this._aiState = 'attack';
    } else {
      this._aiState = 'chase';
    }
    if (this.stationary && (this._aiState === 'chase' || this._aiState === 'backoff')) {
      this._aiState = 'hold';
    }

    // ── Movement ───────────────────────────────────────────────────────────
    if (this._aiState === 'backoff') {
      // Retreat away from player until we reach BACKOFF_DIST
      if (targetModel) {
        _toTarget.subVectors(this.group.position, targetModel.position);
        _toTarget.y = 0;
        if (_toTarget.lengthSq() > 0.001) {
          _toTarget.normalize().multiplyScalar(BACKOFF_SPEED * this.speedScale);
          const vel = this.rigidBody.linvel();
          this.rigidBody.setLinvel({ x: _toTarget.x, y: vel.y, z: _toTarget.z }, true);
        }
      }
    } else if (this._aiState === 'hold') {
      // Paused: slow to a stop and wait
      const vel = this.rigidBody.linvel();
      this.rigidBody.setLinvel({ x: vel.x * 0.8, y: vel.y, z: vel.z * 0.8 }, true);
    } else if (!this.stationary && (this._aiState === 'chase' || distToTarget > CHASE_RANGE * 1.5)) {
      if (targetModel && distToTarget > CHASE_RANGE) {
        _toTarget.subVectors(targetModel.position, this.group.position);
        _toTarget.y = 0;
        if (_toTarget.lengthSq() > 0.001) {
          _toTarget.normalize().multiplyScalar(CHASE_SPEED * this.speedScale);
          const vel = this.rigidBody.linvel();
          this.rigidBody.setLinvel(
            { x: _toTarget.x, y: vel.y, z: _toTarget.z }, true
          );
        }
      }
    } else {
      // Slow to a stop horizontally
      const vel = this.rigidBody.linvel();
      this.rigidBody.setLinvel({ x: vel.x * 0.8, y: vel.y, z: vel.z * 0.8 }, true);
    }

    // ── GLB character body animation (walk / idle; arms are posed below) ──
    this._glbCharacter?.setMoving(this._aiState === 'chase' || this._aiState === 'backoff');
    this._glbCharacter?.animate(dt);

    // ── Right hand (drives sword position) ────────────────────────────────
    this._updateHandPositions(dt, distToTarget);
    this._solveArm('right');

    // ── Sword (orientation depends on right hand) ──────────────────────────
    this._updateSword(dt);

    // ── Left hand grips pommel (depends on sword orientation) ─────────────
    this._updateLeftHandToPommel(dt);
    this._solveArm('left');
    this._glbCharacter?.stepFluff(dt);

    // ── Billboard health bar toward camera ─────────────────────────────────
    if (this._camera) {
      this._hpPlane.lookAt(this._camera.position);
    }
    if (this._hpPlane.visible && Date.now() > this._hpShowUntil) {
      this._hpPlane.visible = false;
    }

    // ── Update sword swing trail ───────────────────────────────────────────
    this._updateTrailMeshes(Date.now());

    // ── Sword hit detection ────────────────────────────────────────────────
    // Only the swing itself can hurt — blocking/idle/wind-up swords never poke the player.
    if (this._aiState === 'attack' && this._attackPhase === 'swing_execute' && targetModel) {
      this._checkSwordHitOnTarget(targetModel, targetControls, shieldActive);
    }
  }

  // ─── internal helpers ──────────────────────────────────────────────────────

  /**
   * Pick next attack phase randomly: `swingChance` swing, the rest split 40:25 between
   * block and idle (default 0.35 → 40% block, 25% idle, 35% swing).
   */
  _decideNextPhase() {
    const r = Math.random();
    const swing = Math.min(0.9, Math.max(0, this.swingChance));
    const blockCut = (1 - swing) * (40 / 65);
    if (r < blockCut) {
      this._attackPhase    = 'block';
      this._attackPhaseDur = 1.5 + Math.random() * 2.5;
      this._blockSeed      = Math.random() * 100;
      this._blockPreset    = BLOCK_PRESETS[Math.floor(Math.random() * BLOCK_PRESETS.length)];
    } else if (r < 1 - swing) {
      this._attackPhase    = 'idle';
      this._attackPhaseDur = 1.0 + Math.random() * 1.5;
      this._blockSeed      = Math.random() * 100;
    } else {
      // Wind up for a swing
      this._attackPhase    = 'swing_hold';
      this._attackPhaseDur = SWING_WINDUP_MIN + Math.random() * SWING_WINDUP_RAND;
      this._swingPreset    = SWING_PRESETS[Math.floor(Math.random() * SWING_PRESETS.length)];
      this._blockSeed      = Math.random() * 100;  // randomizes the wind-up circle's phase
    }
    this._attackPhaseT = 0;
  }

  /** Pins the attack phase to the tutorial script's stance (see `this.script`). */
  _applyScript() {
    const script = this.script;
    if (script?.mode === 'block') {
      const preset = BLOCK_PRESETS[script.preset] ?? BLOCK_PRESETS[0];
      if (this._attackPhase !== 'block' || this._blockPreset !== preset) {
        this._attackPhase = 'block';
        this._blockPreset = preset;
        this._attackPhaseT = 0;
      }
      this._attackPhaseDur = Infinity;
    } else if (script?.mode === 'windup') {
      const preset = SWING_PRESETS[script.preset] ?? SWING_PRESETS[0];
      const phase = this._attackPhase;
      // Let a released swing play out, with a short follow-through
      if (phase === 'swing_execute') return;
      if (phase === 'swing_end_hold' && this._attackPhaseT < 1.0) return;
      if (phase !== 'swing_hold' || this._swingPreset !== preset) {
        this._attackPhase = 'swing_hold';
        this._swingPreset = preset;
        this._attackPhaseT = 0;
      }
      if (script.release) {
        script.release = false;
        script.swings = (script.swings || 0) + 1;
        this._attackPhaseDur = 0; // swing on this frame's transition
      } else {
        this._attackPhaseDur = Infinity;
      }
    }
  }

  _updateHandPositions(dt, distToTarget) {
    if (!this._handTargetR) {
      this._handTargetR = new THREE.Vector3();
      this._handTargetL = new THREE.Vector3();
    }
    const lerpR = 1 - Math.exp(-(this._attackPhase === 'swing_execute' ? 22 : 12) * dt);

    if (this._aiState === 'attack') {
      this._attackPhaseT += dt;
      this._applyScript();

      // ── Phase transitions ────────────────────────────────────────────────
      if (this._attackPhase === 'decide' || this._attackPhaseT >= this._attackPhaseDur) {
        if (this._attackPhase === 'swing_hold') {
          // Wind-up done — swing across
          this._attackPhase    = 'swing_execute';
          this._attackPhaseDur = SWING_EXEC_MIN + Math.random() * SWING_EXEC_RAND;
          this._attackPhaseT   = 0;
          // Clear old trail points, start fresh
          this._trailPoints    = [];
          this._trailFadeStart = -1;
        } else if (this._attackPhase === 'swing_execute') {
          // Swing done — hold the follow-through, then fade trail and decide next
          this._trailFadeStart = Date.now();
          this._attackPhase    = 'swing_end_hold';
          this._attackPhaseDur = SWING_END_HOLD;
          this._attackPhaseT   = 0;
        } else {
          // block, idle, follow-through or decide
          this._decideNextPhase();
        }
      }

      // ── Per-phase hand targeting ─────────────────────────────────────────
      const p = Math.min(this._attackPhaseT / Math.max(0.001, this._attackPhaseDur), 1);
      const t = this._attackPhaseT;

      switch (this._attackPhase) {

        case 'block':
        case 'idle': {
          // Natural wobble: two overlapping sin waves at different frequencies
          const base = this._attackPhase === 'block' ? this._blockPreset.hand : IDLE_HAND;
          const wx = Math.sin(t * 3.1 + this._blockSeed) * 0.048
                   + Math.sin(t * 1.9 + this._blockSeed * 0.5) * 0.022;
          const wy = Math.sin(t * 2.4 + this._blockSeed * 0.7) * 0.035
                   + Math.sin(t * 4.3 + this._blockSeed * 1.3) * 0.018;
          const k = this._attackPhase === 'block' ? 1 : 0.6;
          this._handTargetR.set(base.x + wx * k, base.y + wy * k, base.z);
          break;
        }

        case 'swing_hold': {
          // Hand out at the wound-up extreme, jostling around in small circles
          this._handTargetR.copy(SWING_PIVOT).addScaledVector(this._swingPreset.from, SWING_REACH);
          windupCircleOffset(this._swingPreset, t, this._blockSeed, WINDUP_CIRCLE_HAND, _tmpV);
          this._handTargetR.add(_tmpV);
          break;
        }

        case 'swing_execute':
        case 'swing_end_hold': {
          // Hand rides the swing arc (held at the end of it during the follow-through)
          const u = this._attackPhase === 'swing_execute' ? easeSwing(p) : 1;
          swingBladeDir(this._swingPreset, u, _bladeDir);
          this._handTargetR.copy(SWING_PIVOT).addScaledVector(_bladeDir, SWING_REACH);
          if (this._attackPhase === 'swing_execute') this._sampleTrail(Date.now());
          break;
        }

        default:
          this._handTargetR.copy(IDLE_HAND);
      }

    } else {
      // idle / chase / backoff — arms at sides, reset attack phase
      const gait = this._aiState === 'backoff' ? 0 : Math.sin(Date.now() * 0.004);
      this._handTargetR.set( 0.4,  0.75 + gait * 0.06, 0.2);
      this._swingT       = 0;
      this._attackPhase  = 'decide';
      this._attackPhaseT = 0;
    }

    this._rightHandGroup.position.lerp(this._handTargetR, lerpR);
  }

  /**
   * Position the left hand at the sword pommel so both hands grip the sword.
   * Must be called AFTER _updateSword() so the sword quaternion is current.
   */
  _updateLeftHandToPommel(dt) {
    if (this._aiState !== 'attack') {
      // Idle/chase: natural arm swing at the side
      const gait = this._aiState === 'backoff' ? 0 : Math.sin(Date.now() * 0.004);
      this._handTargetL.set(-0.4, 0.75 - gait * 0.06, 0.2);
      this._leftHandGroup.position.lerp(this._handTargetL, 1 - Math.exp(-8 * dt));
      return;
    }

    // Pommel is at z = -0.175 in sword-local space; map to world then body-local
    _tmpV.set(0, 0, -0.175)
      .applyQuaternion(this._swordGroup.quaternion)
      .add(this._swordGroup.position);
    this.group.worldToLocal(_tmpV);
    this._handTargetL.copy(_tmpV);
    // Fast lerp during swing, a bit slower during block/hold so it feels natural
    const speed = this._attackPhase === 'swing_execute' ? 22 : 12;
    this._leftHandGroup.position.lerp(this._handTargetL, 1 - Math.exp(-speed * dt));
  }

  /** True while the enemy is deliberately holding a block stance. */
  isBlocking() {
    return !this.isDead && this._aiState === 'attack' && this._attackPhase === 'block';
  }

  /**
   * Whether this enemy's block stops a swing moving along `swingDir` (world space) from an
   * attacker at `attackerPos`. Only true in the block stance, and only when the swing crosses
   * the blade at more than BLOCK_MIN_ANGLE_DEG (see swingCrossesBlade).
   */
  blocksSwing(swingDir, attackerPos) {
    if (!this.isBlocking()) return false;
    // Use the stance's blade direction (not the live sword, which may be mid-recoil)
    this.group.getWorldQuaternion(_rootQ);
    _bladeDir.copy(this._blockPreset.dir).applyQuaternion(_rootQ);
    _toTarget.subVectors(this.group.position, attackerPos).setY(0);
    return swingCrossesBlade(swingDir, _bladeDir, _toTarget);
  }

  /** Called externally when the player's sword hits this sword. */
  applySwordBounce() {
    const dur = (window.phoneSwordSwingCfg?.enemyBounceHoldDur ?? 2.0) * 1000;
    this.swordBounces += 1;
    this._bounceActive    = true;
    this._bounceEndTime   = Date.now() + dur;
    this._bounceInitDone  = false; // force recoil target rebuild on next _updateSword
    // Cancel any in-flight swing so the bounce doesn't immediately re-hit
    if (this._attackPhase === 'swing_execute') {
      this._attackPhase    = 'swing_hold';
      this._attackPhaseT   = 0;
      this._attackPhaseDur = 0.6;
    }
    // Show enemy block flash (gray spiky) if a callback is registered
    window._pswShowBlockFlash?.('enemy');
  }

  _updateSword(dt) {
    // Sword origin = right hand world position
    this._rightHandGroup.getWorldPosition(_tmpV);

    // Bounce overrides normal sword motion for 0.5 s
    if (this._bounceActive) {
      if (Date.now() > this._bounceEndTime) {
        this._bounceActive = false;
      } else {
        const cfg = window.phoneSwordSwingCfg;
        const snapSpeed  = cfg?.bounceSnapSpeed ?? 18;
        const bounceAngle = ((cfg?.bounceAngle ?? 90) * Math.PI) / 180;
        // Build recoil target: rotate current sword Q by bounceAngle around world Y
        if (!this._bounceTargetQ) this._bounceTargetQ = new THREE.Quaternion();
        if (!this._bounceInitDone) {
          const yRot = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), bounceAngle);
          this._bounceTargetQ.copy(yRot).multiply(this._swordQuaternion);
          this._bounceInitDone = true;
        }
        this._swordQuaternion.slerp(this._bounceTargetQ, 1 - Math.exp(-snapSpeed * dt));
        this._swordGroup.position.copy(_tmpV);
        this._swordGroup.quaternion.copy(this._swordQuaternion);
        return;
      }
    }

    const phase = this._attackPhase;
    if (phase === 'block' || phase === 'idle') {
      // ── Block: blade across the body (vertical / horizontal / diagonal).
      // ── Idle: blade held forward, tip tilted slightly up. Both with a gentle sway.
      const isBlock = phase === 'block';
      const dir  = isBlock ? this._blockPreset.dir : IDLE_BLADE_DIR;
      const flat = isBlock ? BLOCK_FLAT_REF : IDLE_FLAT_REF;
      _bladeDir.set(
        dir.x + Math.sin(this._attackPhaseT * 1.8 + this._blockSeed * 0.6) * 0.05,
        dir.y + Math.sin(this._attackPhaseT * 2.7 + this._blockSeed) * 0.05,
        dir.z
      ).normalize();
      this.group.getWorldQuaternion(_rootQ);
      bladeQuat(_bladeDir, flat, _tmpQ).premultiply(_rootQ);
      this._swordQuaternion.slerp(_tmpQ, 1 - Math.exp(-8 * dt));

    } else if (phase === 'swing_hold' || phase === 'swing_execute' || phase === 'swing_end_hold') {
      // ── Wind-up: blade out to the starting extreme. Swing: blade sweeps across the
      // front of the body to the opposite extreme. Follow-through: held at the end.
      const preset = this._swingPreset;
      const p = Math.min(this._attackPhaseT / Math.max(0.001, this._attackPhaseDur), 1);
      const u = phase === 'swing_hold' ? 0 : phase === 'swing_execute' ? easeSwing(p) : 1;
      swingBladeDir(preset, u, _bladeDir);
      if (phase === 'swing_hold') {
        // Blade tip circles along with the hand while winding up
        windupCircleOffset(preset, this._attackPhaseT, this._blockSeed, WINDUP_CIRCLE_BLADE, _swingDirWorld);
        _bladeDir.add(_swingDirWorld).normalize();
      }
      this.group.getWorldQuaternion(_rootQ);
      bladeQuat(_bladeDir, preset.flat, _tmpQ).premultiply(_rootQ);
      const rate = phase === 'swing_hold' ? 16 : 30;
      this._swordQuaternion.slerp(_tmpQ, 1 - Math.exp(-rate * dt));

    } else {
      // Rest / chase orientation: blade points forward from hand
      this._rightHandGroup.getWorldQuaternion(_tmpQ);
      const restQ = new THREE.Quaternion().setFromEuler(REST_SWORD_EULER);
      _tmpQ.multiply(restQ);
      this._swordQuaternion.slerp(_tmpQ, 1 - Math.exp(-4 * dt));
    }

    this._swordGroup.position.copy(_tmpV);
    this._swordGroup.quaternion.copy(this._swordQuaternion);
  }

  _checkSwordHitOnTarget(targetModel, targetControls, shieldActive) {
    const now = Date.now();
    if (now - this._lastHitTime < HIT_COOLDOWN_MS) return;

    // Compute sword tip in world space
    _swordTipWorld.copy(SWORD_TIP_LOCAL).applyQuaternion(this._swordGroup.quaternion).add(this._swordGroup.position);

    const targetCenter = _tmpV.copy(targetModel.position);
    targetCenter.y += 0.7; // roughly torso height

    const dist = _swordTipWorld.distanceTo(targetCenter);

    // Protective bubble: the sword bounces off the bubble surface, no damage
    const bubbleRadius = window.getPlayerBubbleRadius?.() || 0;
    if (bubbleRadius > 0 && dist <= Math.max(bubbleRadius, SWORD_TIP_HIT_RADIUS)) {
      this.applySwordBounce();
      window.audioManager?.playSFX('SFX/Attacks/Sword Attacks Hits and Blocks/Sword Impact Hit 3.ogg', 0.45, { cooldownKey: 'psw-bubble-block', cooldownMs: 200 });
      this._lastHitTime = now;
      return;
    }

    if (dist > SWORD_TIP_HIT_RADIUS) return;

    // Player sword block: only while the player holds the block button, with their blade in
    // the way of this sword, and only if the swing crosses their blade (see swingCrossesBlade).
    const playerBladePoints = window.phoneSwordBladePoints;
    if (window.phoneSwordGyro?.blocking && playerBladePoints?.length >= 2) {
      // Forgiving reach: the enemy's tip or guard anywhere near the player's blade counts
      _swordGuardWorld.copy(this._swordGroup.position);
      const intercepted = playerBladePoints.some(pp =>
        _swordTipWorld.distanceTo(pp) < PLAYER_BLOCK_REACH ||
        _swordGuardWorld.distanceTo(pp) < PLAYER_BLOCK_REACH);
      if (intercepted) {
        // Swing direction = chord of the swing arc (wind-up side → follow-through side)
        this.group.getWorldQuaternion(_rootQ);
        _swingDirWorld.subVectors(this._swingPreset.to, this._swingPreset.from).applyQuaternion(_rootQ);
        _playerBladeWorld.subVectors(playerBladePoints[playerBladePoints.length - 1], playerBladePoints[0]);
        _toTarget.subVectors(targetModel.position, this.group.position).setY(0);
        if (swingCrossesBlade(_swingDirWorld, _playerBladeWorld, _toTarget, PLAYER_BLOCK_MIN_ANGLE_DEG)) {
          // Player's block holds — bounce this enemy sword, no damage
          this.applySwordBounce();
          window._pswShowBlockFlash?.('player');
          window.audioManager?.playSFX('SFX/Attacks/Sword Attacks Hits and Blocks/Sword Parry 2.ogg', 0.65, { cooldownKey: 'psw-parry', cooldownMs: 300 });
          this._lastHitTime = now;
          return;
        }
      }
    }

    // Shield check — delegate to existing game logic
    if (shieldActive && typeof window.tryBlockLocalPlayerHitWithShield === 'function') {
      const blocked = window.tryBlockLocalPlayerHitWithShield({
        attackerModel: this.group,
        damage: SWORD_DAMAGE
      });
      if (blocked) {
        this.applySwordBounce();
        window._pswShowBlockFlash?.('player');
        this._lastHitTime = now;
        return; // hit absorbed by shield
      }
    }

    // Apply knockback & damage to player
    const hitDir = new THREE.Vector3().subVectors(targetModel.position, this.group.position).normalize();
    hitDir.y = 0;

    // Visual knockback via callback set by the game loop
    if (typeof this._onHitPlayer === 'function') {
      this._onHitPlayer(hitDir);
    }

    // Reduce player health via window.localHealth
    if (typeof window.localHealth === 'number') {
      window.localHealth = Math.max(0, window.localHealth - SWORD_DAMAGE);
    }
    window.audioManager?.playSFX('SFX/Attacks/Sword Attacks Hits and Blocks/Sword Impact Hit 3.ogg', 0.6, { cooldownKey: 'psw-hit', cooldownMs: 200 });

    this._lastHitTime = now;

    // Flash the sword red briefly
    this._flashSword();
  }

  _flashSword() {
    this._swordGroup.traverse(obj => {
      if (!obj.isMesh) return;
      const mat = Array.isArray(obj.material) ? obj.material[0] : obj.material;
      if (!mat) return;
      const origColor = mat.color.getHex();
      mat.color.setHex(0xff2200);
      setTimeout(() => { if (mat) mat.color.setHex(origColor); }, 120);
    });
  }

  // ─── take damage (called externally when player's sword hits this enemy) ────

  applyDamage(amount) {
    if (this.isDead) return false;
    this.hearts = Math.max(0, this.hearts - 1);
    this._updateHealthBarCanvas();
    spawnBloodBurst(this.scene, this.getCenterWorldPos().add(_bloodOffset), { groundY: this.group.position.y });
    window.audioManager?.playEnemyOuch(`ouch-enemy-${this.group.uuid}`);
    if (this.hearts <= 0) {
      this._die();
      return true; // killing blow
    }
    return false; // survived
  }

  // Direct knockback — bypasses the strength/profile system for easy tuning.
  applyDirectKnockback({ direction, horizSpeed = 6, upVelocity = 2, torqueMag = 80, ragdoll = false } = {}) {
    if (!direction || !this.rigidBody) return;
    if (this.isDead) {
      const cap = this._deathKnockbackCap;
      horizSpeed = Math.min(horizSpeed, cap.horizSpeed);
      upVelocity = Math.min(upVelocity, cap.upVelocity);
      torqueMag  = Math.min(torqueMag, cap.torqueMag);
    }
    const vel = this.rigidBody.linvel();
    this.rigidBody.setLinvel({ x: direction.x * horizSpeed, y: vel.y + upVelocity, z: direction.z * horizSpeed }, true);
    if (ragdoll) {
      if (this._ragdollTimeout) clearTimeout(this._ragdollTimeout);
      this._isRagdoll = true;
      try {
        this.rigidBody.setEnabledRotations(true, true, true, true);
        const torqueAxis = new THREE.Vector3(-direction.z, 0.1, direction.x).normalize();
        this.rigidBody.applyTorqueImpulse(
          { x: torqueAxis.x * torqueMag, y: torqueAxis.y * torqueMag, z: torqueAxis.z * torqueMag }, true
        );
      } catch (e) {
        console.warn('[EnemyPlayer] direct ragdoll error:', e);
      }
      this._ragdollTimeout = setTimeout(() => this._endRagdoll(), 2000);
    }
    this._clampDeathVelocity();
  }

  /**
   * Bomb blast: thrown back (ragdoll) while the flying-back death clip plays once; gets up
   * after BLAST_STUN_MS. Call after applyDamage() — if that killed us, the death plays instead.
   * @param {THREE.Vector3} direction – horizontal unit vector away from the blast
   * @param {number} [falloff]        – 0..1 force scale (1 = centre of the blast)
   */
  applyBlastKnockback({ direction, falloff = 1 } = {}) {
    if (!direction || !this.rigidBody) return;
    const k = THREE.MathUtils.clamp(falloff, 0, 1);
    if (this.isDead) this._deathKnockbackCap = BLAST_KNOCKBACK;
    this.applyDirectKnockback({
      direction,
      horizSpeed: BLAST_KNOCKBACK.horizSpeed * k,
      upVelocity: BLAST_KNOCKBACK.upVelocity * k,
      torqueMag: BLAST_KNOCKBACK.torqueMag,
      ragdoll: !this.isDead,
    });
    if (this.isDead) return;
    this._glbCharacter?.playDeath();
    if (this._ragdollTimeout) clearTimeout(this._ragdollTimeout);
    this._ragdollTimeout = setTimeout(() => this._endRagdoll(), BLAST_STUN_MS);
  }

  applyKnockback({ direction, strength = 2 } = {}) {
    if (!direction || !this.rigidBody) return;
    const { impulse } = getKnockbackImpulse(direction, strength);
    const { velocity } = getKnockbackMotion(direction, strength);

    // Small upward pop that grows with strength — strong enough to feel physical, not
    // enough to send the enemy straight into the sky.
    const upwardVelocity = Math.max(0, (strength - 2) * 0.3);
    this.rigidBody.applyImpulse({ x: impulse.x, y: impulse.y, z: impulse.z }, true);
    const vel = this.rigidBody.linvel();
    this.rigidBody.setLinvel({ x: velocity.x, y: vel.y + upwardVelocity, z: velocity.z }, true);

    if (strength >= RAGDOLL_STRENGTH_THRESHOLD) {
      this._startRagdoll(direction, strength);
    }
    this._clampDeathVelocity();
  }

  /** Once dead, keep the body's linear/angular velocity within the death knockback cap. */
  _clampDeathVelocity() {
    if (!this.isDead || !this.rigidBody) return;
    const cap = this._deathKnockbackCap;
    const v = this.rigidBody.linvel();
    const h = Math.hypot(v.x, v.z);
    const k = h > cap.horizSpeed ? cap.horizSpeed / h : 1;
    const y = Math.min(v.y, cap.upVelocity);
    if (k < 1 || y !== v.y) this.rigidBody.setLinvel({ x: v.x * k, y, z: v.z * k }, true);
    const w = this.rigidBody.angvel();
    const ws = Math.hypot(w.x, w.y, w.z);
    if (ws > cap.angSpeed) {
      const s = cap.angSpeed / ws;
      this.rigidBody.setAngvel({ x: w.x * s, y: w.y * s, z: w.z * s }, true);
    }
  }

  _startRagdoll(direction, strength) {
    if (this._ragdollTimeout) clearTimeout(this._ragdollTimeout);
    this._isRagdoll = true;
    try {
      this.rigidBody.setEnabledRotations(true, true, true, true);
      const torqueAxis = new THREE.Vector3(-direction.z, 0.1, direction.x).normalize();
      const torqueMag = this.isDead ? Math.min(strength * 10, this._deathKnockbackCap.torqueMag) : strength * 10;
      this.rigidBody.applyTorqueImpulse(
        { x: torqueAxis.x * torqueMag, y: torqueAxis.y * torqueMag, z: torqueAxis.z * torqueMag },
        true
      );
    } catch (e) {
      console.warn('[EnemyPlayer] ragdoll start error:', e);
    }
    const durationMs = 1800 + (strength - RAGDOLL_STRENGTH_THRESHOLD) * 150;
    this._ragdollTimeout = setTimeout(() => this._endRagdoll(), durationMs);
  }

  _endRagdoll() {
    if (!this.rigidBody || this.isDead) return;
    this._isRagdoll = false;
    // Back on our feet after a bomb blast's flying-back clip (no-op otherwise)
    this._glbCharacter?.revive();
    try {
      this.rigidBody.setEnabledRotations(false, true, false, true);
      this.rigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
    } catch (e) {
      console.warn('[EnemyPlayer] ragdoll end error:', e);
    }
    this.group.rotation.x = 0;
    this.group.rotation.z = 0;
  }

  _die() {
    this.isDead = true;
    if (this._ragdollTimeout) { clearTimeout(this._ragdollTimeout); this._ragdollTimeout = null; }
    this._swordGroup.visible = false;

    // Ragdoll stays on for the whole death (free rotation, synced in update()) while the
    // flying-back death clip plays once on top of it.
    this._isRagdoll = true;
    try {
      this.rigidBody?.setEnabledRotations(true, true, true, true);
    } catch (e) {
      console.warn('[EnemyPlayer] death ragdoll error:', e);
    }
    this._glbCharacter?.playDeath();

    // Keep rigid body alive so knockback applied after _die() still has something to push.
    // destroy() will remove it when the fade finishes.

    // Fade out the group over 2 s then destroy.
    // Switch the fur off first: its shells/shader don't survive material.clone().
    this._glbCharacter?.setFurEnabled(false);
    // Clone materials first so the fade doesn't corrupt shared material state
    // (SkeletonUtils.clone shares materials by reference across all character instances).
    this.group.traverse(obj => {
      if (obj.isMesh && obj.material) {
        obj.material = obj.material.clone();
      }
    });
    const _startMs = Date.now();
    const _fadeDur = 2000;
    const _fadeGroup = this.group;
    const _fadeHp = this._hpPlane;
    const _tick = () => {
      const t = Math.min(1, (Date.now() - _startMs) / _fadeDur);
      const opacity = 1 - t;
      _fadeGroup.traverse(obj => {
        if (obj.material) {
          obj.material.transparent = true;
          obj.material.opacity = opacity;
        }
      });
      if (_fadeHp) _fadeHp.material.opacity = opacity;
      if (t < 1) requestAnimationFrame(_tick);
      else this.destroy();
    };
    requestAnimationFrame(_tick);
  }

  /**
   * Call when the enemy should be fully removed from the scene.
   */
  destroy() {
    this._destroyed = true;
    this._glbCharacter?.dispose();
    this._glbCharacter = null;
    if (this._ragdollTimeout) { clearTimeout(this._ragdollTimeout); this._ragdollTimeout = null; }
    if (this._swordGroup.parent) this.scene.remove(this._swordGroup);
    if (this.group.parent)       this.scene.remove(this.group);
    // Remove trail lines
    this._trailLines.forEach(l => {
      if (l.parent) l.parent.remove(l);
      l.geometry?.dispose?.();
      l.material?.dispose?.();
    });
    this._trailLines = [];
    if (this.rigidBody && this.rapierWorld?.getRigidBody?.(this.rigidBody.handle)) {
      this.rapierWorld.removeRigidBody(this.rigidBody);
      this.rigidBody = null;
    }
  }

  /**
   * World-space position of the sword tip — used by external hit checks.
   */
  getSwordTipWorldPos() {
    _swordTipWorld.copy(SWORD_TIP_LOCAL)
      .applyQuaternion(this._swordGroup.quaternion)
      .add(this._swordGroup.position);
    return _swordTipWorld.clone();
  }

  /**
   * World-space AABB center of the enemy capsule — used for sword hit tests
   * against the enemy from the player's side.
   */
  getCenterWorldPos() {
    return this.group.position.clone().add(new THREE.Vector3(0, CAPSULE_HEIGHT / 2, 0));
  }
}

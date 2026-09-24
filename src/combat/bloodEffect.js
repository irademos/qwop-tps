import * as THREE from 'three';

// Blood spray shown when a character takes damage. Each burst is one InstancedMesh
// of droplets that fly out, fall under gravity, flatten into splats on the ground
// and then fade out. Call updateBloodEffects(dt) once per frame.

const GRAVITY = 9.8;
const DROPLET_LIFETIME = 0.9;      // seconds a droplet can fly before it is forced down
const SPLAT_LINGER = 1.6;          // seconds splats stay on the ground before fading
const FADE_DURATION = 0.6;
const MAX_ACTIVE_BURSTS = 24;

const _dropletGeometry = new THREE.IcosahedronGeometry(1, 0);
const _matrix = new THREE.Matrix4();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const _pos = new THREE.Vector3();
const _identityQuat = new THREE.Quaternion();

const activeBursts = [];

/**
 * @param {THREE.Object3D} scene
 * @param {THREE.Vector3}  position  world-space origin of the spray (e.g. chest height)
 * @param {object}  [options]
 * @param {number}  [options.groundY]    height droplets land on (defaults to position.y - 1)
 * @param {THREE.Vector3} [options.direction] bias the spray toward this direction
 * @param {number}  [options.count]      droplet count
 * @param {number}  [options.intensity]  scales speed/size (1 = normal hit)
 */
export function spawnBloodBurst(scene, position, options = {}) {
  if (!scene || !position) return;
  const intensity = THREE.MathUtils.clamp(options.intensity ?? 1, 0.3, 3);
  const count = Math.max(4, Math.round(options.count ?? 18 * intensity));
  const groundY = Number.isFinite(options.groundY) ? options.groundY : position.y - 1;
  const bias = options.direction ? options.direction.clone().setY(0) : null;
  if (bias && bias.lengthSq() > 1e-6) bias.normalize();

  const material = new THREE.MeshBasicMaterial({
    color: 0x9a0007,
    transparent: true,
    opacity: 1,
    depthWrite: false
  });
  const mesh = new THREE.InstancedMesh(_dropletGeometry, material, count);
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;

  const droplets = [];
  for (let i = 0; i < count; i++) {
    const theta = Math.random() * Math.PI * 2;
    const horiz = (1.2 + Math.random() * 2.4) * intensity;
    const vel = new THREE.Vector3(Math.cos(theta) * horiz, (1.5 + Math.random() * 2.5) * intensity, Math.sin(theta) * horiz);
    if (bias) vel.addScaledVector(bias, 2.2 * intensity);
    droplets.push({
      pos: position.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.15, (Math.random() - 0.5) * 0.2, (Math.random() - 0.5) * 0.15)),
      vel,
      size: (0.025 + Math.random() * 0.045) * Math.sqrt(intensity),
      age: 0,
      landed: false,
      splatRot: Math.random() * Math.PI * 2
    });
  }

  scene.add(mesh);
  activeBursts.push({ mesh, material, droplets, groundY, age: 0, allLandedAt: -1 });
  while (activeBursts.length > MAX_ACTIVE_BURSTS) disposeBurst(activeBursts.shift());
  writeInstances(activeBursts[activeBursts.length - 1]);
}

export function updateBloodEffects(dt) {
  if (!activeBursts.length) return;
  const step = Math.min(Math.max(dt || 0, 0), 0.05);
  for (let b = activeBursts.length - 1; b >= 0; b--) {
    const burst = activeBursts[b];
    burst.age += step;
    let allLanded = true;
    for (const d of burst.droplets) {
      if (d.landed) continue;
      d.age += step;
      d.vel.y -= GRAVITY * step;
      d.vel.multiplyScalar(1 - 0.6 * step);
      d.pos.addScaledVector(d.vel, step);
      if (d.pos.y <= burst.groundY + 0.01 || d.age > DROPLET_LIFETIME * 2) {
        d.pos.y = burst.groundY + 0.01 + Math.random() * 0.005;
        d.landed = true;
      } else {
        allLanded = false;
      }
    }
    if (allLanded && burst.allLandedAt < 0) burst.allLandedAt = burst.age;

    if (burst.allLandedAt >= 0) {
      const fadeT = (burst.age - burst.allLandedAt - SPLAT_LINGER) / FADE_DURATION;
      if (fadeT >= 1) {
        disposeBurst(burst);
        activeBursts.splice(b, 1);
        continue;
      }
      burst.material.opacity = fadeT > 0 ? 1 - fadeT : 1;
    }
    writeInstances(burst);
  }
}

export function clearBloodEffects() {
  while (activeBursts.length) disposeBurst(activeBursts.pop());
}

function writeInstances(burst) {
  const { mesh, droplets } = burst;
  for (let i = 0; i < droplets.length; i++) {
    const d = droplets[i];
    if (d.landed) {
      // Flattened splat on the ground
      _quat.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, d.splatRot);
      _scale.set(d.size * 2.4, d.size * 0.12, d.size * 2.4);
    } else {
      // Stretch the droplet along its velocity for a streaky look
      const speed = d.vel.length();
      if (speed > 1e-4) {
        _pos.copy(d.vel).divideScalar(speed);
        _quat.setFromUnitVectors(THREE.Object3D.DEFAULT_UP, _pos);
      } else {
        _quat.copy(_identityQuat);
      }
      const stretch = 1 + Math.min(speed * 0.25, 1.5);
      _scale.set(d.size, d.size * stretch, d.size);
    }
    _matrix.compose(d.pos, _quat, _scale);
    mesh.setMatrixAt(i, _matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
}

function disposeBurst(burst) {
  if (!burst) return;
  burst.mesh.parent?.remove(burst.mesh);
  burst.mesh.dispose?.();
  burst.material.dispose();
}

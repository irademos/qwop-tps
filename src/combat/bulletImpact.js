import * as THREE from 'three';

// Bullet hitting the map: a short burst of sparks bouncing off the surface plus a dust
// puff. Call updateBulletImpacts(dt) once per frame.

const SPARK_COUNT = 8;
const SPARK_LIFETIME = 0.3;
const PUFF_LIFETIME = 0.45;
const GRAVITY = 9.8;
const MAX_ACTIVE_IMPACTS = 16;

const _sparkGeometry = new THREE.BoxGeometry(0.02, 0.02, 0.02);
const _puffGeometry = new THREE.SphereGeometry(1, 8, 6);
const _matrix = new THREE.Matrix4();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const _tangent = new THREE.Vector3();
const _bitangent = new THREE.Vector3();

const activeImpacts = [];

/**
 * @param {THREE.Object3D} scene
 * @param {THREE.Vector3}  point   world-space hit point
 * @param {THREE.Vector3}  normal  surface normal facing the shooter
 */
export function spawnBulletImpact(scene, point, normal) {
  if (!scene || !point) return;
  const n = normal?.lengthSq() > 1e-6 ? normal.clone().normalize() : new THREE.Vector3(0, 1, 0);
  _tangent.set(0, 1, 0).cross(n);
  if (_tangent.lengthSq() < 1e-4) _tangent.set(1, 0, 0).cross(n);
  _tangent.normalize();
  _bitangent.crossVectors(n, _tangent);

  const sparkMaterial = new THREE.MeshBasicMaterial({ color: 0xffd966, transparent: true, depthWrite: false });
  const sparks = new THREE.InstancedMesh(_sparkGeometry, sparkMaterial, SPARK_COUNT);
  sparks.frustumCulled = false;
  const sparkList = [];
  for (let i = 0; i < SPARK_COUNT; i++) {
    const a = Math.random() * Math.PI * 2;
    const spread = 0.4 + Math.random() * 0.9;
    const vel = n.clone().multiplyScalar(2 + Math.random() * 2.5)
      .addScaledVector(_tangent, Math.cos(a) * spread * 3)
      .addScaledVector(_bitangent, Math.sin(a) * spread * 3);
    sparkList.push({ pos: point.clone().addScaledVector(n, 0.02), vel });
  }

  const puffMaterial = new THREE.MeshBasicMaterial({ color: 0xb8ad9a, transparent: true, opacity: 0.55, depthWrite: false });
  const puff = new THREE.Mesh(_puffGeometry, puffMaterial);
  puff.position.copy(point).addScaledVector(n, 0.06);
  puff.scale.setScalar(0.04);

  scene.add(sparks, puff);
  activeImpacts.push({ sparks, sparkMaterial, sparkList, puff, puffMaterial, age: 0 });
  while (activeImpacts.length > MAX_ACTIVE_IMPACTS) disposeImpact(activeImpacts.shift());
  writeSparks(activeImpacts[activeImpacts.length - 1], 1);
}

export function updateBulletImpacts(dt) {
  if (!activeImpacts.length) return;
  const step = Math.min(Math.max(dt || 0, 0), 0.05);
  for (let i = activeImpacts.length - 1; i >= 0; i--) {
    const impact = activeImpacts[i];
    impact.age += step;
    if (impact.age >= Math.max(SPARK_LIFETIME, PUFF_LIFETIME)) {
      disposeImpact(impact);
      activeImpacts.splice(i, 1);
      continue;
    }
    const sparkT = impact.age / SPARK_LIFETIME;
    if (sparkT < 1) {
      for (const s of impact.sparkList) {
        s.vel.y -= GRAVITY * step;
        s.pos.addScaledVector(s.vel, step);
      }
      impact.sparkMaterial.opacity = 1 - sparkT;
      writeSparks(impact, 1 - sparkT * 0.6);
    } else {
      impact.sparks.visible = false;
    }
    const puffT = impact.age / PUFF_LIFETIME;
    impact.puff.scale.setScalar(0.04 + 0.16 * Math.sqrt(puffT));
    impact.puffMaterial.opacity = 0.55 * (1 - puffT);
  }
}

function writeSparks(impact, size) {
  _scale.setScalar(size);
  impact.sparkList.forEach((s, i) => {
    _matrix.compose(s.pos, _quat, _scale);
    impact.sparks.setMatrixAt(i, _matrix);
  });
  impact.sparks.instanceMatrix.needsUpdate = true;
}

function disposeImpact(impact) {
  impact.sparks.parent?.remove(impact.sparks);
  impact.puff.parent?.remove(impact.puff);
  impact.sparks.dispose?.();
  impact.sparkMaterial.dispose();
  impact.puffMaterial.dispose();
}

import * as THREE from "three";
import RAPIER from '@dimforge/rapier3d-compat';

const ARROW_GROUND_Y = 0.2;
const ARROW_MIN_SPEED_SQ = 0.0001;

const createArrowMesh = ({
  template,
  cloneArrowMesh,
  direction,
  scale
}) => {
  const arrowDirection = direction.clone().normalize();
  const forward = new THREE.Vector3(0, 0, 1);
  if (template && typeof cloneArrowMesh === 'function') {
    const arrowMesh = cloneArrowMesh(template, scale);
    if (arrowMesh) {
      arrowMesh.quaternion.setFromUnitVectors(forward, arrowDirection);
      return arrowMesh;
    }
  }
  const geometry = new THREE.CylinderGeometry(0.04, 0.05, 0.6, 8);
  const material = new THREE.MeshStandardMaterial({ color: 0x6a4b2a });
  const fallback = new THREE.Mesh(geometry, material);
  fallback.rotation.x = Math.PI / 2;
  return fallback;
};

export const spawnArrowProjectile = ({
  scene,
  list,
  position,
  direction,
  shooterId,
  template,
  cloneArrowMesh,
  scale,
  speed,
  lifetime,
  spawnProjectile,
  spawnPickup,
  pickupAmount = 1
}) => {
  if (typeof spawnProjectile !== 'function') return null;
  const createMesh = () => createArrowMesh({
    template,
    cloneArrowMesh,
    direction,
    scale
  });

  const colliderDesc = RAPIER.ColliderDesc.cuboid(0.05, 0.05, 0.35)
    .setRestitution(0.1)
    .setFriction(0.6);

  spawnProjectile(scene, list, position, direction, shooterId, {
    createMesh,
    colliderDesc,
    speed,
    lifetime,
    pickupOnRest: true,
    pickupAmount,
    spawnPickup,
    isArrow: true
  });

  const latest = list[list.length - 1];
  if (latest) {
    latest.userData.arrowGroundY = ARROW_GROUND_Y;
    latest.userData.arrowStuck = false;
  }
  return latest;
};

export const updateArrowProjectile = (proj, rb, velocity) => {
  if (!proj?.userData?.isArrow) return;
  if (!proj.userData.arrowStuck && velocity.lengthSq() > ARROW_MIN_SPEED_SQ) {
    const forward = new THREE.Vector3(0, 0, 1);
    proj.quaternion.setFromUnitVectors(forward, velocity.clone().normalize());
  }

  if (proj.userData.arrowStuck) return;

  const groundY = Number.isFinite(proj.userData.arrowGroundY)
    ? proj.userData.arrowGroundY
    : ARROW_GROUND_Y;
  if (proj.position.y <= groundY && velocity.y <= 0) {
    proj.userData.arrowStuck = true;
    rb.setLinvel({ x: 0, y: 0, z: 0 }, true);
    rb.setAngvel({ x: 0, y: 0, z: 0 }, true);
    rb.setGravityScale(0, true);
    rb.setBodyType(RAPIER.RigidBodyType.Fixed, true);
  }
};

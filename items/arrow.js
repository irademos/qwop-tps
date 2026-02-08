import * as THREE from "three";
import RAPIER from '@dimforge/rapier3d-compat';

const ARROW_GROUND_Y = 0.2;
const ARROW_MIN_SPEED_SQ = 0.0001;
const ARROW_TRAIL_MIN_SPEED = 0.2;
const ARROW_TRAIL_MAX_OPACITY = 0.35;
const ARROW_TRAIL_MAX_LENGTH = 1.6;

const createArrowTrailTexture = () => {
  const canvas = document.createElement('canvas');
  canvas.width = 8;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createLinearGradient(0, canvas.height, 0, 0);
  gradient.addColorStop(0, 'rgba(245,245,245,0.55)');
  gradient.addColorStop(1, 'rgba(245,245,245,0.0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
};

const createArrowTrail = () => {
  const geometry = new THREE.PlaneGeometry(0.06, 1.2);
  const material = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    map: createArrowTrailTexture(),
    transparent: true,
    opacity: ARROW_TRAIL_MAX_OPACITY,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });
  const trail = new THREE.Mesh(geometry, material);
  trail.rotation.x = Math.PI / 2;
  trail.position.z = -0.7;
  trail.visible = false;
  return trail;
};

const setTrailOpacity = (trail, opacity) => {
  if (!trail?.material) return;
  const materials = Array.isArray(trail.material) ? trail.material : [trail.material];
  materials.forEach(material => {
    material.opacity = opacity;
    material.transparent = true;
  });
};

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
      arrowMesh.rotation.x += Math.PI / 2;
      const trail = createArrowTrail();
      arrowMesh.add(trail);
      arrowMesh.userData.arrowTrail = trail;
      return arrowMesh;
    }
  }
  const geometry = new THREE.CylinderGeometry(0.04, 0.05, 0.6, 8);
  const material = new THREE.MeshStandardMaterial({ color: 0x6a4b2a });
  const fallback = new THREE.Mesh(geometry, material);
  fallback.rotation.x = Math.PI / 2;
  const trail = createArrowTrail();
  fallback.add(trail);
  fallback.userData.arrowTrail = trail;
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
  const trail = proj.userData.arrowTrail;
  const speed = velocity.length();
  if (trail) {
    if (proj.userData.arrowStuck || speed < ARROW_TRAIL_MIN_SPEED) {
      trail.visible = false;
    } else {
      trail.visible = true;
      const opacity = Math.min(ARROW_TRAIL_MAX_OPACITY, speed * 0.06);
      setTrailOpacity(trail, opacity);
      const lengthScale = THREE.MathUtils.clamp(speed * 0.08, 0.6, ARROW_TRAIL_MAX_LENGTH);
      trail.scale.set(1, lengthScale, 1);
    }
  }
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

import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { ref, update } from 'firebase/database';
import { db } from './firebase-init.js';

const HOME_INTERIOR_ORIGIN = new THREE.Vector3(10000, 0, 10000);
const HOME_INTERIOR_SIZE = {
  width: 12,
  depth: 12,
  height: 4
};
const HOME_INTERIOR_WALL_THICKNESS = 0.3;
const HOME_INTERIOR_FLOOR_THICKNESS = 0.2;
const HOME_INTERIOR_SPAWN_OFFSET = new THREE.Vector3(0, 1.1, 0);
const HOME_INTERIOR_DOOR_OFFSET = new THREE.Vector3(0, 0, -(HOME_INTERIOR_SIZE.depth / 2 - 0.5));
const HOME_DOOR_INTERACT_DISTANCE = 2.2;
const HOME_ENTER_DISTANCE = 6;
const BUILDING_RAYCAST_HEIGHT = 120;

function createInteriorMesh() {
  const group = new THREE.Group();
  group.name = 'home-interior';

  const floorMaterial = new THREE.MeshStandardMaterial({
    color: 0xb0b7c3,
    roughness: 0.9,
    metalness: 0.0
  });
  const wallMaterial = new THREE.MeshStandardMaterial({
    color: 0xdad1c1,
    roughness: 0.85,
    metalness: 0.0
  });
  const accentMaterial = new THREE.MeshStandardMaterial({
    color: 0x7b6d5b,
    roughness: 0.9,
    metalness: 0.0
  });

  const floor = new THREE.Mesh(
    new THREE.BoxGeometry(
      HOME_INTERIOR_SIZE.width,
      HOME_INTERIOR_FLOOR_THICKNESS,
      HOME_INTERIOR_SIZE.depth
    ),
    floorMaterial
  );
  floor.position.y = -HOME_INTERIOR_FLOOR_THICKNESS / 2;
  floor.receiveShadow = true;
  group.add(floor);

  const ceiling = new THREE.Mesh(
    new THREE.BoxGeometry(
      HOME_INTERIOR_SIZE.width,
      HOME_INTERIOR_FLOOR_THICKNESS,
      HOME_INTERIOR_SIZE.depth
    ),
    floorMaterial
  );
  ceiling.position.y = HOME_INTERIOR_SIZE.height + HOME_INTERIOR_FLOOR_THICKNESS / 2;
  ceiling.receiveShadow = true;
  group.add(ceiling);

  const wallDepth = HOME_INTERIOR_SIZE.depth - HOME_INTERIOR_WALL_THICKNESS;
  const wallWidth = HOME_INTERIOR_SIZE.width - HOME_INTERIOR_WALL_THICKNESS;
  const halfDepth = HOME_INTERIOR_SIZE.depth / 2;
  const halfWidth = HOME_INTERIOR_SIZE.width / 2;

  const backWall = new THREE.Mesh(
    new THREE.BoxGeometry(HOME_INTERIOR_SIZE.width, HOME_INTERIOR_SIZE.height, HOME_INTERIOR_WALL_THICKNESS),
    wallMaterial
  );
  backWall.position.set(0, HOME_INTERIOR_SIZE.height / 2, halfDepth - HOME_INTERIOR_WALL_THICKNESS / 2);
  group.add(backWall);

  const frontWall = new THREE.Mesh(
    new THREE.BoxGeometry(HOME_INTERIOR_SIZE.width, HOME_INTERIOR_SIZE.height, HOME_INTERIOR_WALL_THICKNESS),
    wallMaterial
  );
  frontWall.position.set(0, HOME_INTERIOR_SIZE.height / 2, -(halfDepth - HOME_INTERIOR_WALL_THICKNESS / 2));
  group.add(frontWall);

  const leftWall = new THREE.Mesh(
    new THREE.BoxGeometry(HOME_INTERIOR_WALL_THICKNESS, HOME_INTERIOR_SIZE.height, wallDepth),
    wallMaterial
  );
  leftWall.position.set(-(halfWidth - HOME_INTERIOR_WALL_THICKNESS / 2), HOME_INTERIOR_SIZE.height / 2, 0);
  group.add(leftWall);

  const rightWall = new THREE.Mesh(
    new THREE.BoxGeometry(HOME_INTERIOR_WALL_THICKNESS, HOME_INTERIOR_SIZE.height, wallDepth),
    wallMaterial
  );
  rightWall.position.set(halfWidth - HOME_INTERIOR_WALL_THICKNESS / 2, HOME_INTERIOR_SIZE.height / 2, 0);
  group.add(rightWall);

  const doorFrame = new THREE.Mesh(
    new THREE.BoxGeometry(2.2, 2.6, 0.2),
    accentMaterial
  );
  doorFrame.position.copy(HOME_INTERIOR_DOOR_OFFSET).setY(1.3);
  group.add(doorFrame);

  group.traverse((child) => {
    if (!child.isMesh) return;
    child.castShadow = true;
    child.receiveShadow = true;
  });

  return group;
}

function createInteriorColliders(world, origin) {
  if (!world) return null;
  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.fixed().setTranslation(origin.x, origin.y, origin.z)
  );

  const halfWidth = HOME_INTERIOR_SIZE.width / 2;
  const halfDepth = HOME_INTERIOR_SIZE.depth / 2;
  const halfHeight = HOME_INTERIOR_SIZE.height / 2;

  const floorHalf = {
    x: HOME_INTERIOR_SIZE.width / 2,
    y: HOME_INTERIOR_FLOOR_THICKNESS / 2,
    z: HOME_INTERIOR_SIZE.depth / 2
  };

  world.createCollider(
    RAPIER.ColliderDesc.cuboid(floorHalf.x, floorHalf.y, floorHalf.z)
      .setTranslation(0, -HOME_INTERIOR_FLOOR_THICKNESS / 2, 0),
    body
  );

  world.createCollider(
    RAPIER.ColliderDesc.cuboid(floorHalf.x, floorHalf.y, floorHalf.z)
      .setTranslation(0, HOME_INTERIOR_SIZE.height + HOME_INTERIOR_FLOOR_THICKNESS / 2, 0),
    body
  );

  world.createCollider(
    RAPIER.ColliderDesc.cuboid(halfWidth, halfHeight, HOME_INTERIOR_WALL_THICKNESS / 2)
      .setTranslation(0, halfHeight, halfDepth - HOME_INTERIOR_WALL_THICKNESS / 2),
    body
  );

  world.createCollider(
    RAPIER.ColliderDesc.cuboid(halfWidth, halfHeight, HOME_INTERIOR_WALL_THICKNESS / 2)
      .setTranslation(0, halfHeight, -(halfDepth - HOME_INTERIOR_WALL_THICKNESS / 2)),
    body
  );

  world.createCollider(
    RAPIER.ColliderDesc.cuboid(HOME_INTERIOR_WALL_THICKNESS / 2, halfHeight, halfDepth)
      .setTranslation(-(halfWidth - HOME_INTERIOR_WALL_THICKNESS / 2), halfHeight, 0),
    body
  );

  world.createCollider(
    RAPIER.ColliderDesc.cuboid(HOME_INTERIOR_WALL_THICKNESS / 2, halfHeight, halfDepth)
      .setTranslation(halfWidth - HOME_INTERIOR_WALL_THICKNESS / 2, halfHeight, 0),
    body
  );

  return body;
}

function syncPlayerPosition(playerModel, playerControls, position) {
  if (!playerModel || !position) return;
  playerModel.position.copy(position);
  if (playerControls?.body) {
    playerControls.body.setTranslation({ x: position.x, y: position.y, z: position.z }, true);
    playerControls.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    playerControls.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }
  if (playerControls) {
    playerControls.playerX = position.x;
    playerControls.playerY = position.y;
    playerControls.playerZ = position.z;
    playerControls.lastPosition.copy(position);
  }
}

export class HomeSystem {
  constructor({
    scene,
    playerModel,
    playerControls,
    buildingsRenderer,
    profileNameKey,
    initialHome,
    getLocalOrigin,
    localMetersToGeo,
    geoToLocal
  }) {
    this.scene = scene;
    this.playerModel = playerModel;
    this.playerControls = playerControls;
    this.buildingsRenderer = buildingsRenderer;
    this.profileNameKey = profileNameKey;
    this.getLocalOrigin = getLocalOrigin;
    this.localMetersToGeo = localMetersToGeo;
    this.geoToLocal = geoToLocal;

    this.homeData = initialHome || null;
    this.isInsideHome = false;
    this.lastExteriorPosition = null;

    this.interiorGroup = createInteriorMesh();
    this.interiorGroup.position.copy(HOME_INTERIOR_ORIGIN);
    this.interiorGroup.visible = false;
    this.scene?.add(this.interiorGroup);

    this.interiorDoorPosition = HOME_INTERIOR_ORIGIN.clone().add(HOME_INTERIOR_DOOR_OFFSET).setY(1.1);

    this.raycaster = new THREE.Raycaster();
    this.rayDirection = new THREE.Vector3(0, -1, 0);

    this.interiorBody = createInteriorColliders(window.rapierWorld, HOME_INTERIOR_ORIGIN);
  }

  getHomeLocalPosition() {
    if (!this.homeData) return null;
    if (Number.isFinite(this.homeData.localX) && Number.isFinite(this.homeData.localZ)) {
      return new THREE.Vector3(this.homeData.localX, 0, this.homeData.localZ);
    }
    if (Number.isFinite(this.homeData.lat) && Number.isFinite(this.homeData.lon)) {
      const origin = this.getLocalOrigin?.();
      if (!origin || !this.geoToLocal) return null;
      const local = this.geoToLocal(this.homeData.lat, this.homeData.lon, origin);
      if (!local) return null;
      return new THREE.Vector3(local.x, 0, local.z);
    }
    return null;
  }

  async persistHome(homeData) {
    if (!this.profileNameKey || !homeData) return;
    try {
      await update(ref(db, `profiles/${this.profileNameKey}`), {
        home: homeData,
        updatedAt: Date.now()
      });
    } catch (error) {
      console.error('Failed to save home selection', error);
    }
  }

  async selectHome() {
    if (!this.playerModel) return;
    const position = this.playerModel.position;
    const origin = this.getLocalOrigin?.();
    const nextHome = {
      localX: position.x,
      localZ: position.z,
      selectedAt: Date.now()
    };
    if (origin && this.localMetersToGeo) {
      const geo = this.localMetersToGeo(position.x, position.z, origin);
      if (geo) {
        nextHome.lat = geo.lat;
        nextHome.lon = geo.lon;
      }
    }
    this.homeData = nextHome;
    await this.persistHome(nextHome);
  }

  enterHome() {
    if (!this.playerModel) return;
    this.lastExteriorPosition = this.playerModel.position.clone();
    const interiorSpawn = HOME_INTERIOR_ORIGIN.clone().add(HOME_INTERIOR_SPAWN_OFFSET);
    syncPlayerPosition(this.playerModel, this.playerControls, interiorSpawn);
    this.isInsideHome = true;
    this.interiorGroup.visible = true;
  }

  exitHome() {
    const exterior = this.lastExteriorPosition || this.getHomeLocalPosition();
    if (!exterior) return;
    const exitPosition = exterior.clone();
    exitPosition.y = this.playerModel?.position?.y ?? exitPosition.y;
    syncPlayerPosition(this.playerModel, this.playerControls, exitPosition);
    this.isInsideHome = false;
    this.interiorGroup.visible = false;
  }

  isNearHomeDoor(position) {
    if (!position) return false;
    const distance = position.distanceTo(this.interiorDoorPosition);
    return distance <= HOME_DOOR_INTERACT_DISTANCE;
  }

  getDistanceToHome(position) {
    if (!position) return null;
    const homePos = this.getHomeLocalPosition();
    if (!homePos) return null;
    return Math.hypot(position.x - homePos.x, position.z - homePos.z);
  }

  getBuildingIntersection(position) {
    const buildingsGroup = this.buildingsRenderer?.group;
    if (!buildingsGroup || !position) return null;
    const rayOrigin = new THREE.Vector3(position.x, position.y + BUILDING_RAYCAST_HEIGHT, position.z);
    this.raycaster.set(rayOrigin, this.rayDirection);
    const intersections = this.raycaster.intersectObjects(buildingsGroup.children, true);
    for (const intersection of intersections) {
      if (intersection.object?.userData?.isBuildingSolid) {
        return intersection;
      }
    }
    return null;
  }

  getInteractionTarget(playerPosition, isMobile) {
    if (!playerPosition) return null;

    if (this.isInsideHome) {
      if (!this.isNearHomeDoor(playerPosition)) return null;
      return {
        type: 'home-exit',
        maxDistance: HOME_DOOR_INTERACT_DISTANCE,
        distance: playerPosition.distanceTo(this.interiorDoorPosition),
        promptText: isMobile ? 'click here to exit home' : "press 'x' to exit home"
      };
    }

    if (!this.homeData) {
      const hit = this.getBuildingIntersection(playerPosition);
      if (!hit) return null;
      return {
        type: 'home-select',
        maxDistance: 1,
        distance: 0,
        promptText: isMobile
          ? 'click here to select this as your home'
          : "press 'x' to select this as your home"
      };
    }

    const distanceToHome = this.getDistanceToHome(playerPosition);
    if (distanceToHome == null || distanceToHome > HOME_ENTER_DISTANCE) return null;
    return {
      type: 'home-enter',
      maxDistance: HOME_ENTER_DISTANCE,
      distance: distanceToHome,
      promptText: isMobile ? 'click here to enter home' : "press 'x' to enter home"
    };
  }

  handleInteraction(target) {
    if (!target) return;
    if (target.type === 'home-select') {
      void this.selectHome();
      return;
    }
    if (target.type === 'home-enter') {
      this.enterHome();
      return;
    }
    if (target.type === 'home-exit') {
      this.exitHome();
    }
  }
}

export function createHomeSystem(options) {
  return new HomeSystem(options);
}

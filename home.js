import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { ref, update } from 'firebase/database';
import { db } from './firebase-init.js';
import { getKtx2Loader } from './ktx2Loader.js';

const HOME_INTERIOR_ORIGIN = new THREE.Vector3(10000, -500, 10000);
const HOME_INTERIOR_SIZE = {
  width: 12,
  depth: 12,
  height: 4
};
const HOME_INTERIOR_WALL_THICKNESS = 0.3;
const HOME_INTERIOR_FLOOR_THICKNESS = 0.2;
const HOME_INTERIOR_SPAWN_OFFSET = new THREE.Vector3(0, 1.1, 0);
const HOME_INTERIOR_DOOR_OFFSET = new THREE.Vector3(0, 0, -(HOME_INTERIOR_SIZE.depth / 2 - 0.5));
const HOME_INTERIOR_STORAGE_OFFSET = new THREE.Vector3(3, 0, 3);
const HOME_DOOR_INTERACT_DISTANCE = 2.2;
const HOME_ENTER_DISTANCE = 8;
const BUILDING_RAYCAST_HEIGHT = 120;
const HOME_STORAGE_INTERACT_DISTANCE = 2.4;
const HOME_STORAGE_CHEST_SCALE = 0.015;
const HOME_STORAGE_CLAMP_MARGIN = 0.6;
const HOME_INTERIOR_TEXTURE_REPEAT = 0.05;
const HOME_TEXTURE_BASE_PATH = '/assets/textures/planks/planks';

function applyKtx2ToMaterial(ktx2, material, slot, url, { srgb = false, repeat = 2, anisotropy = null } = {}) {
  if (!material || !slot || !url || !ktx2) return;
  ktx2.load(
    url,
    (tex) => {
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(repeat, repeat);
      if (anisotropy) tex.anisotropy = anisotropy;
      if (srgb && tex.colorSpace !== undefined) tex.colorSpace = THREE.SRGBColorSpace;
      material[slot] = tex;
      material.needsUpdate = true;
    },
    undefined,
    (err) => console.warn('KTX2 load failed:', slot, url, err)
  );
}

function createInteriorMesh(renderer) {
  const group = new THREE.Group();
  group.name = 'home-interior';

  const floorMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.9,
    metalness: 0.0
  });
  const wallMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.85,
    metalness: 0.0
  });
  const accentMaterial = new THREE.MeshStandardMaterial({
    color: 0x7b6d5b,
    roughness: 0.9,
    metalness: 0.0
  });

  if (renderer) {
    const ktx2 = getKtx2Loader(renderer);
    const maxAnisotropy = renderer?.capabilities?.getMaxAnisotropy?.() ?? null;
    applyKtx2ToMaterial(
      ktx2,
      floorMaterial,
      'map',
      `${HOME_TEXTURE_BASE_PATH}_albedo.ktx2`,
      { srgb: true, repeat: HOME_INTERIOR_TEXTURE_REPEAT, anisotropy: maxAnisotropy }
    );
    applyKtx2ToMaterial(
      ktx2,
      wallMaterial,
      'map',
      `${HOME_TEXTURE_BASE_PATH}_albedo.ktx2`,
      { srgb: true, repeat: HOME_INTERIOR_TEXTURE_REPEAT, anisotropy: maxAnisotropy }
    );
    applyKtx2ToMaterial(
      ktx2,
      floorMaterial,
      'normalMap',
      `${HOME_TEXTURE_BASE_PATH}_normal.ktx2`,
      { repeat: HOME_INTERIOR_TEXTURE_REPEAT, anisotropy: maxAnisotropy }
    );
    applyKtx2ToMaterial(
      ktx2,
      wallMaterial,
      'normalMap',
      `${HOME_TEXTURE_BASE_PATH}_normal.ktx2`,
      { repeat: HOME_INTERIOR_TEXTURE_REPEAT, anisotropy: maxAnisotropy }
    );
    applyKtx2ToMaterial(
      ktx2,
      floorMaterial,
      'roughnessMap',
      `${HOME_TEXTURE_BASE_PATH}_roughness.ktx2`,
      { repeat: HOME_INTERIOR_TEXTURE_REPEAT, anisotropy: maxAnisotropy }
    );
    applyKtx2ToMaterial(
      ktx2,
      wallMaterial,
      'roughnessMap',
      `${HOME_TEXTURE_BASE_PATH}_roughness.ktx2`,
      { repeat: HOME_INTERIOR_TEXTURE_REPEAT, anisotropy: maxAnisotropy }
    );
  }

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

export class HomeSystem {
  constructor({
    scene,
    playerModel,
    playerControls,
    renderer,
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
    this.renderer = renderer;
    this.buildingsRenderer = buildingsRenderer;
    this.profileNameKey = profileNameKey;
    this.getLocalOrigin = getLocalOrigin;
    this.localMetersToGeo = localMetersToGeo;
    this.geoToLocal = geoToLocal;

    this.homeData = initialHome || null;
    this.isInsideHome = false;
    this.lastExteriorPosition = null;
    this.locationProvider = null;

    this.interiorGroup = createInteriorMesh(this.renderer);
    this.interiorGroup.position.copy(HOME_INTERIOR_ORIGIN);
    this.interiorGroup.visible = false;
    this.scene?.add(this.interiorGroup);

    this.interiorDoorPosition = HOME_INTERIOR_ORIGIN.clone().add(HOME_INTERIOR_DOOR_OFFSET).setY(1.1);

    this.raycaster = new THREE.Raycaster();
    this.rayDirection = new THREE.Vector3(0, -1, 0);

    this.interiorBody = null;
    this.storageChest = null;
    this.storageChestLoaded = false;
    this.savedGeoBounds = null;
  }

  setLocationProvider(locationProvider) {
    this.locationProvider = locationProvider || null;
  }

  async loadStorageChest() {
    if (this.storageChestLoaded) return;
    this.storageChestLoaded = true;
    const loader = new GLTFLoader();
    let chestMesh = null;
    try {
      const gltf = await loader.loadAsync('/assets/props/treasure_chest.glb');
      chestMesh = gltf.scene;
    } catch (error) {
      console.warn('Failed to load home storage chest model, using placeholder box.', error);
      chestMesh = new THREE.Mesh(
        new THREE.BoxGeometry(0.8, 0.6, 0.6),
        new THREE.MeshStandardMaterial({ color: 0x8b5a2b })
      );
    }
    if (!chestMesh) return;
    chestMesh.name = 'home-storage-chest';
    chestMesh.position.copy(HOME_INTERIOR_STORAGE_OFFSET);
    chestMesh.scale.setScalar(HOME_STORAGE_CHEST_SCALE);
    chestMesh.traverse((child) => {
      if (!child.isMesh) return;
      child.castShadow = true;
      child.receiveShadow = true;
    });
    this.storageChest = chestMesh;
    this.interiorGroup?.add(chestMesh);
  }

  getHomeLocalPosition() {
    if (!this.homeData) return null;
    if (Number.isFinite(this.homeData.lat) && Number.isFinite(this.homeData.lon)) {
      const origin = this.getLocalOrigin?.();
      if (!origin || !this.geoToLocal) return null;
      const local = this.geoToLocal(this.homeData.lat, this.homeData.lon, origin);
      if (!local) return null;
      return new THREE.Vector3(local.x, 0, local.z);
    }
    if (Number.isFinite(this.homeData.localX) && Number.isFinite(this.homeData.localZ)) {
      return new THREE.Vector3(this.homeData.localX, 0, this.homeData.localZ);
    }
    return null;
  }

  getHomeGeo() {
    if (!this.homeData) return null;
    if (Number.isFinite(this.homeData.lat) && Number.isFinite(this.homeData.lon)) {
      return { lat: this.homeData.lat, lon: this.homeData.lon };
    }
    const local = this.getHomeLocalPosition();
    const origin = this.getLocalOrigin?.();
    if (!local || !origin || !this.localMetersToGeo) return null;
    const geo = this.localMetersToGeo(local.x, local.z, origin);
    if (!geo || !Number.isFinite(geo.lat) || !Number.isFinite(geo.lon)) return null;
    return { lat: geo.lat, lon: geo.lon };
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

  async clearHomeSelection() {
    this.homeData = null;
    if (!this.profileNameKey) {
      return { status: 'missing-key' };
    }
    try {
      await update(ref(db, `profiles/${this.profileNameKey}`), {
        home: null,
        updatedAt: Date.now()
      });
      return { status: 'ok' };
    } catch (error) {
      console.error('Failed to clear home selection', error);
      return { status: 'error' };
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

  syncPlayerPosition(position) {
    if (!this.playerModel || !position) return;
    this.playerModel.position.copy(position);
    if (this.playerControls?.body?.setTranslation) {
      this.playerControls.body.setTranslation(
        { x: position.x, y: position.y, z: position.z },
        true
      );
      if (this.playerControls.body.setLinvel) {
        this.playerControls.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      }
    }
    if (this.playerControls) {
      this.playerControls.playerX = position.x;
      this.playerControls.playerY = position.y;
      this.playerControls.playerZ = position.z;
      this.playerControls.lastPosition?.copy?.(position);
    }
  }

  enterHome() {
    if (!this.playerModel) return;
    this.lastExteriorPosition = this.playerModel.position.clone();
    const interiorOrigin = new THREE.Vector3(
      this.playerModel.position.x,
      HOME_INTERIOR_ORIGIN.y,
      this.playerModel.position.z
    );
    this.interiorGroup.position.copy(interiorOrigin);
    this.interiorDoorPosition = interiorOrigin
      .clone()
      .add(HOME_INTERIOR_DOOR_OFFSET)
      .setY(interiorOrigin.y + 1.1);
    const spawnPosition = interiorOrigin.clone().add(HOME_INTERIOR_SPAWN_OFFSET);
    this.syncPlayerPosition(spawnPosition);
    if (this.interiorBody && window.rapierWorld?.getRigidBody(this.interiorBody.handle)) {
      window.rapierWorld.removeRigidBody(this.interiorBody);
    }
    this.interiorBody = createInteriorColliders(window.rapierWorld, interiorOrigin);
    this.playerControls?.clearGpsMoveTarget?.();
    if (this.playerControls) {
      this.playerControls.groundOverrideY = interiorOrigin.y;
    }
    this.isInsideHome = true;
    this.interiorGroup.visible = true;
    this.applyInteriorClamp(interiorOrigin);
    if (this.buildingsRenderer?.group) {
      this.buildingsRenderer.group.visible = false;
    }
  }

  exitHome() {
    if (this.interiorBody && window.rapierWorld?.getRigidBody(this.interiorBody.handle)) {
      window.rapierWorld.removeRigidBody(this.interiorBody);
    }
    this.interiorBody = null;
    this.isInsideHome = false;
    this.interiorGroup.visible = false;
    this.restoreExteriorClamp();
    if (this.playerControls) {
      this.playerControls.groundOverrideY = null;
    }
    if (this.buildingsRenderer?.group) {
      this.buildingsRenderer.group.visible = true;
    }
    if (this.lastExteriorPosition && this.playerModel) {
      this.syncPlayerPosition(this.lastExteriorPosition);
    }
  }

  isNearHomeDoor(position) {
    if (!position) return false;
    const distance = position.distanceTo(this.interiorDoorPosition);
    return distance <= HOME_DOOR_INTERACT_DISTANCE;
  }

  getStorageChestWorldPosition() {
    if (!this.storageChest) return null;
    const worldPosition = new THREE.Vector3();
    this.storageChest.getWorldPosition(worldPosition);
    return worldPosition;
  }

  isNearStorageChest(position) {
    if (!position || !this.storageChest) return false;
    const chestPosition = this.getStorageChestWorldPosition();
    if (!chestPosition) return false;
    return position.distanceTo(chestPosition) <= HOME_STORAGE_INTERACT_DISTANCE;
  }

  applyInteriorClamp(origin) {
    if (!this.playerControls) return;
    if (!this.savedGeoBounds) {
      this.savedGeoBounds = {
        center: this.playerControls.geoBoundsCenterXZ?.clone?.() ?? null,
        halfSize: this.playerControls.geoBoundHalfSizeM ?? null,
        edgeEps: this.playerControls.geoEdgeEpsM ?? null
      };
    }
    const halfSize = Math.max(
      1,
      (HOME_INTERIOR_SIZE.width / 2) - HOME_STORAGE_CLAMP_MARGIN
    );
    this.playerControls.geoBoundHalfSizeM = halfSize;
    this.playerControls.geoBoundsCenterXZ = new THREE.Vector3(origin.x, 0, origin.z);
    if (this.playerControls.geoBoundsShiftMeters) {
      this.playerControls.geoBoundsShiftMeters.x = 0;
      this.playerControls.geoBoundsShiftMeters.z = 0;
    }
  }

  restoreExteriorClamp() {
    if (!this.playerControls) return;
    if (!this.savedGeoBounds) return;
    const { center, halfSize, edgeEps } = this.savedGeoBounds;
    this.playerControls.geoBoundsCenterXZ = center ? center.clone() : null;
    if (typeof halfSize === 'number') {
      this.playerControls.geoBoundHalfSizeM = halfSize;
    }
    if (typeof edgeEps === 'number') {
      this.playerControls.geoEdgeEpsM = edgeEps;
    }
    if (this.playerControls.geoBoundsShiftMeters) {
      this.playerControls.geoBoundsShiftMeters.x = 0;
      this.playerControls.geoBoundsShiftMeters.z = 0;
    }
    this.savedGeoBounds = null;
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
      if (this.isNearStorageChest(playerPosition)) {
        return {
          type: 'home-storage',
          maxDistance: HOME_STORAGE_INTERACT_DISTANCE,
          distance: playerPosition.distanceTo(this.getStorageChestWorldPosition()),
          promptText: isMobile ? 'click here to access storage' : "press 'x' to access storage"
        };
      }
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

  getHomeEnterDistance() {
    return HOME_ENTER_DISTANCE;
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
    if (target.type === 'home-storage') {
      window.openHomeStorage?.();
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

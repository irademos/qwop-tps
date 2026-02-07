import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { ref, update } from 'firebase/database';
import { db } from './firebase-init.js';
import { getTerrainHeight } from './environment/water.js';

const HOME_STORAGE_INTERACT_DISTANCE = 2.4;
const HOME_STORAGE_CHEST_SCALE = 0.015;
const HOME_ROAD_LIGHT_SCALE = 1;

const HOME_BED_OFFSET = new THREE.Vector3(-3, 0, 3);
const HOME_CRAFT_TABLE_OFFSET = new THREE.Vector3(2.5, 0, -2.5);
const HOME_STORAGE_OFFSET = new THREE.Vector3(3, 0, 3);
const HOME_ROAD_LIGHT_OFFSET = new THREE.Vector3(-2.5, 0, -2.5);

const BED_VERTICAL_OFFSET = 0.5;
const CRAFT_TABLE_VERTICAL_OFFSET = 0.5;
const STORAGE_VERTICAL_OFFSET = 0.35;

export class HomeSystem {
  constructor({
    scene,
    playerModel,
    playerControls,
    profileNameKey,
    initialHome,
    getLocalOrigin,
    localMetersToGeo,
    geoToLocal
  }) {
    this.scene = scene;
    this.playerModel = playerModel;
    this.playerControls = playerControls;
    this.profileNameKey = profileNameKey;
    this.getLocalOrigin = getLocalOrigin;
    this.localMetersToGeo = localMetersToGeo;
    this.geoToLocal = geoToLocal;

    this.homeData = initialHome || null;
    this.isInsideHome = false;
    this.interiorGroup = null;

    this.bed = null;
    this.craftTable = null;

    this.storageChest = null;
    this.storageChestLoaded = false;
    this.roadLight = null;
    this.roadLightLoaded = false;

    this.lastPlacedHomeKey = null;
  }

  setLocationProvider(locationProvider) {
    this.locationProvider = locationProvider || null;
  }

  registerPlacedObjects({ bed = null, craftTable = null } = {}) {
    this.bed = bed;
    this.craftTable = craftTable;
    this.syncHomePlacement();
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
    chestMesh.scale.setScalar(HOME_STORAGE_CHEST_SCALE);
    chestMesh.traverse((child) => {
      if (!child.isMesh) return;
      child.castShadow = true;
      child.receiveShadow = true;
    });
    chestMesh.visible = false;
    this.storageChest = chestMesh;
    this.scene?.add(chestMesh);
    this.syncHomePlacement();
  }

  async loadRoadLight() {
    if (this.roadLightLoaded) return;
    this.roadLightLoaded = true;
    const loader = new GLTFLoader();
    let lightMesh = null;
    try {
      const gltf = await loader.loadAsync('/assets/props/road_light.glb');
      lightMesh = gltf.scene;
    } catch (error) {
      console.warn('Failed to load road light model, using placeholder pole.', error);
      const pole = new THREE.Mesh(
        new THREE.CylinderGeometry(0.08, 0.1, 3, 12),
        new THREE.MeshStandardMaterial({ color: 0x666666 })
      );
      const bulb = new THREE.Mesh(
        new THREE.SphereGeometry(0.15, 12, 12),
        new THREE.MeshStandardMaterial({ color: 0xfff0c8, emissive: 0xffd27a, emissiveIntensity: 1.2 })
      );
      bulb.position.set(0, 1.45, 0);
      lightMesh = new THREE.Group();
      lightMesh.add(pole);
      lightMesh.add(bulb);
    }
    if (!lightMesh) return;

    const existingRoadLights = this.scene?.children?.filter?.((child) => child?.name === 'home-road-light') ?? [];
    existingRoadLights.forEach((child) => {
      this.scene?.remove?.(child);
    });

    lightMesh.name = 'home-road-light';
    lightMesh.scale.setScalar(HOME_ROAD_LIGHT_SCALE);
    lightMesh.traverse((child) => {
      if (!child.isMesh) return;
      child.castShadow = true;
      child.receiveShadow = true;
    });
    lightMesh.visible = false;
    this.roadLight = lightMesh;
    this.scene?.add(lightMesh);
    this.syncHomePlacement();
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

  getGroundY(x, z) {
    const terrainHeight = getTerrainHeight(x, z);
    return Number.isFinite(terrainHeight) ? terrainHeight : 0;
  }

  setObjectPosition(mesh, x, z, yOffset = 0) {
    if (!mesh) return;
    mesh.position.set(x, this.getGroundY(x, z) + yOffset, z);
    mesh.visible = !!this.homeData;
  }

  syncHomePlacement() {
    const homePos = this.getHomeLocalPosition();
    const nextHomeKey = homePos
      ? `${homePos.x.toFixed(3)}:${homePos.z.toFixed(3)}`
      : 'none';
    this.lastPlacedHomeKey = nextHomeKey;

    if (!homePos) {
      if (this.bed?.mesh) this.bed.mesh.visible = false;
      if (this.craftTable?.mesh) this.craftTable.mesh.visible = false;
      if (this.storageChest) this.storageChest.visible = false;
      if (this.roadLight) this.roadLight.visible = false;
      return;
    }

    const bedPos = homePos.clone().add(HOME_BED_OFFSET);
    const craftPos = homePos.clone().add(HOME_CRAFT_TABLE_OFFSET);
    const storagePos = homePos.clone().add(HOME_STORAGE_OFFSET);
    const lightPos = homePos.clone().add(HOME_ROAD_LIGHT_OFFSET);

    if (this.bed?.mesh) {
      this.setObjectPosition(this.bed.mesh, bedPos.x, bedPos.z, BED_VERTICAL_OFFSET);
      this.bed.updateBounds?.();
    }
    if (this.craftTable?.mesh) {
      this.setObjectPosition(this.craftTable.mesh, craftPos.x, craftPos.z, CRAFT_TABLE_VERTICAL_OFFSET);
    }
    this.setObjectPosition(this.storageChest, storagePos.x, storagePos.z, STORAGE_VERTICAL_OFFSET);
    this.setObjectPosition(this.roadLight, lightPos.x, lightPos.z, 0);
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
    this.syncHomePlacement();
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
    this.syncHomePlacement();
    await this.persistHome(nextHome);
  }

  getStorageChestWorldPosition() {
    if (!this.storageChest || !this.storageChest.visible) return null;
    const worldPosition = new THREE.Vector3();
    this.storageChest.getWorldPosition(worldPosition);
    return worldPosition;
  }

  isNearStorageChest(position) {
    if (!position || !this.storageChest || !this.storageChest.visible) return false;
    const chestPosition = this.getStorageChestWorldPosition();
    if (!chestPosition) return false;
    return position.distanceTo(chestPosition) <= HOME_STORAGE_INTERACT_DISTANCE;
  }

  getInteractionTarget(playerPosition, isMobile) {
    if (!playerPosition) return null;

    if (this.isNearStorageChest(playerPosition)) {
      return {
        type: 'home-storage',
        maxDistance: HOME_STORAGE_INTERACT_DISTANCE,
        distance: playerPosition.distanceTo(this.getStorageChestWorldPosition()),
        promptText: isMobile ? 'click here to access storage' : "press 'x' to access storage"
      };
    }

    if (!this.homeData) {
      return {
        type: 'home-select',
        maxDistance: 1,
        distance: 0,
        promptText: isMobile
          ? 'click here to set this location as your home'
          : "press 'x' to set this location as your home"
      };
    }

    return null;
  }

  getHomeEnterDistance() {
    return null;
  }

  handleInteraction(target) {
    if (!target) return;
    if (target.type === 'home-select') {
      void this.selectHome();
      return;
    }
    if (target.type === 'home-storage') {
      window.openHomeStorage?.();
    }
  }
}

export function createHomeSystem(options) {
  return new HomeSystem(options);
}

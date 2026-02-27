import * as THREE from "three";
import { getKtx2Loader } from "../ktx2Loader.js";
import { getStampedTerrainHeight } from "./terrainHeight.js";

export const GROUND_TEX_REPEAT_PER_TILE = 6;
const GROUND_TEXTURE_URL = "/assets/textures/grass/grass_albedo.ktx2";

export function createGroundTiles({
  scene,
  renderer,
  tileSizeMeters = 300,
  tileResolution = 32,
  elevation = 0,
  terrainSeed = "default",
  terrainSettingsKey = "default",
  textureUrl = GROUND_TEXTURE_URL
} = {}) {
  const tiles = new Map();
  const geometryCache = new Map();

  const segmentCount = Math.max(1, Math.floor(tileResolution));
  const terrainKey = JSON.stringify({
    tileSizeMeters,
    tileResolution: segmentCount,
    terrainSeed,
    terrainSettingsKey
  });

  const repeatScale = (tileSizeMeters / 300) * GROUND_TEX_REPEAT_PER_TILE;
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: 0x1f1f1f,
    emissiveIntensity: 0.25
  });
  const state = { texture: null };

  const ktx2Loader = getKtx2Loader(renderer);
  ktx2Loader.load(textureUrl, (loaded) => {
    loaded.wrapS = THREE.RepeatWrapping;
    loaded.wrapT = THREE.RepeatWrapping;
    loaded.repeat.set(repeatScale, repeatScale);
    if (renderer?.capabilities?.getMaxAnisotropy) {
      loaded.anisotropy = renderer.capabilities.getMaxAnisotropy();
    }
    if ("colorSpace" in loaded && THREE.SRGBColorSpace) {
      loaded.colorSpace = THREE.SRGBColorSpace;
    }
    state.texture = loaded;
    material.map = loaded;
    material.needsUpdate = true;
  });

  const createGroundMesh = (tile) => {
    const cacheKey = `${tile.x},${tile.y}|${terrainKey}`;
    let geometry = geometryCache.get(cacheKey);
    if (!geometry) {
      geometry = new THREE.PlaneGeometry(tileSizeMeters, tileSizeMeters, segmentCount, segmentCount);
      const positions = geometry.attributes.position;
      const centerX = (tile.x + 0.5) * tileSizeMeters;
      const centerZ = -(tile.y + 0.5) * tileSizeMeters;

      for (let i = 0; i < positions.count; i += 1) {
        const localX = positions.getX(i);
        const localY = positions.getY(i);
        const worldX = centerX + localX;
        const worldZ = centerZ - localY;
        positions.setZ(i, getStampedTerrainHeight(worldX, worldZ));
      }

      positions.needsUpdate = true;
      geometry.computeVertexNormals();
      geometryCache.set(cacheKey, geometry);
    }

    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(
      (tile.x + 0.5) * tileSizeMeters,
      elevation,
      -(tile.y + 0.5) * tileSizeMeters
    );
    mesh.receiveShadow = true;
    mesh.userData.hideInMapView = true;
    return mesh;
  };

  const ensureTile = (tile, key = `${tile.x},${tile.y}`) => {
    if (!tile || tiles.has(key)) return tiles.get(key) || null;
    const mesh = createGroundMesh(tile);
    tiles.set(key, mesh);
    scene?.add(mesh);
    return mesh;
  };

  const removeTile = (key) => {
    const mesh = tiles.get(key);
    if (!mesh) return false;
    tiles.delete(key);
    if (mesh.parent) {
      mesh.parent.remove(mesh);
    }
    return true;
  };

  const clear = () => {
    for (const key of tiles.keys()) {
      removeTile(key);
    }
    for (const geometry of geometryCache.values()) {
      geometry.dispose?.();
    }
    geometryCache.clear();
  };

  return {
    tiles,
    material,
    get texture() {
      return state.texture;
    },
    ensureTile,
    removeTile,
    clear
  };
}

import * as THREE from "three";
import { getKtx2Loader } from "../ktx2Loader.js";

export const GROUND_TEX_REPEAT_PER_TILE = 6;
const GROUND_TEXTURE_URL = "/assets/textures/grass/grass_albedo.ktx2";

export function createGroundTiles({
  scene,
  renderer,
  tileSizeMeters = 300,
  elevation = 0,
  textureUrl = GROUND_TEXTURE_URL
} = {}) {
  const tiles = new Map();

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
    const geometry = new THREE.PlaneGeometry(tileSizeMeters, tileSizeMeters);
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
    mesh.geometry?.dispose?.();
    return true;
  };

  const clear = () => {
    for (const key of tiles.keys()) {
      removeTile(key);
    }
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

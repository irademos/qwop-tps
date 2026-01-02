import * as THREE from "three";
import { markSharedMaterial, markSharedTexture } from "./utils.js";

export const GROUND_TEX_REPEAT_PER_TILE = 6;
const GROUND_TEXTURE_URL =
  "/assets/textures/forrest_ground_01_4k.blend/textures/forrest_ground_01_diff_4k.jpg";

export function createGroundTiles({
  scene,
  renderer,
  tileSizeMeters = 300,
  elevation = 0,
  textureUrl = GROUND_TEXTURE_URL
} = {}) {
  const tiles = new Map();

  const texture = markSharedTexture(new THREE.TextureLoader().load(textureUrl));
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  const repeatScale = (tileSizeMeters / 300) * GROUND_TEX_REPEAT_PER_TILE;
  texture.repeat.set(repeatScale, repeatScale);
  if (renderer?.capabilities?.getMaxAnisotropy) {
    texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  }
  if ("colorSpace" in texture && THREE.SRGBColorSpace) {
    texture.colorSpace = THREE.SRGBColorSpace;
  }

  const material = markSharedMaterial(new THREE.MeshStandardMaterial({ map: texture }));

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
    texture,
    ensureTile,
    removeTile,
    clear
  };
}

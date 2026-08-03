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

  // Inject height-based color blending into the standard material shader.
  // uTerrainBlend controls transition sharpness: 0 = hard bands, 1 = wide smooth gradients.
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTerrainBlend = { value: 0.5 };

    shader.vertexShader = shader.vertexShader.replace(
      '#include <color_pars_vertex>',
      `#include <color_pars_vertex>
varying float vTerrainHeight;`
    );
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
vTerrainHeight = position.z;`
    );

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_pars_fragment>',
      `#include <color_pars_fragment>
varying float vTerrainHeight;
uniform float uTerrainBlend;`
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      `#include <color_fragment>
{
  float blendWidth = max(0.01, uTerrainBlend) * 5.0;
  vec3 lowColor  = vec3(0.45, 0.60, 0.32); // grass green
  vec3 midColor  = vec3(0.58, 0.46, 0.30); // earthy brown
  vec3 highColor = vec3(0.82, 0.82, 0.80); // rocky grey / snow
  float t1 = smoothstep(3.0, 3.0 + blendWidth, vTerrainHeight);
  float t2 = smoothstep(8.0, 8.0 + blendWidth, vTerrainHeight);
  vec3 heightTint = mix(mix(lowColor, midColor, t1), highColor, t2);
  diffuseColor.rgb *= heightTint;
}`
    );

    material.userData.terrainShader = shader;
  };
  material.customProgramCacheKey = () => 'groundTilesTerrain';

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
    mesh.userData.groundTileX = tile.x;
    mesh.userData.groundTileY = tile.y;
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


  const parseChunkKey = (chunkKey) => {
    if (!chunkKey || typeof chunkKey !== "string") return null;
    const [cxRaw, czRaw] = chunkKey.split(",");
    const cx = Number(cxRaw);
    const cz = Number(czRaw);
    if (!Number.isFinite(cx) || !Number.isFinite(cz)) return null;
    return { cx, cz };
  };

  const intersectsBounds = (a, b) => {
    if (!a || !b) return false;
    return !(a.maxX < b.minX || a.minX > b.maxX || a.maxZ < b.minZ || a.minZ > b.maxZ);
  };

  const rebuildTilesForChunks = (chunkKeys, chunkSizeMeters = 64) => {
    if (!Array.isArray(chunkKeys) || chunkKeys.length === 0) return 0;
    const chunkBoundsList = chunkKeys
      .map(parseChunkKey)
      .filter(Boolean)
      .map(({ cx, cz }) => ({
        minX: cx * chunkSizeMeters,
        maxX: (cx + 1) * chunkSizeMeters,
        minZ: cz * chunkSizeMeters,
        maxZ: (cz + 1) * chunkSizeMeters
      }));
    if (chunkBoundsList.length === 0) return 0;

    const tilesToRebuild = [];
    for (const [key, mesh] of tiles.entries()) {
      const tileX = Number(mesh?.userData?.groundTileX);
      const tileY = Number(mesh?.userData?.groundTileY);
      if (!Number.isFinite(tileX) || !Number.isFinite(tileY)) continue;
      const tileBounds = {
        minX: tileX * tileSizeMeters,
        maxX: (tileX + 1) * tileSizeMeters,
        minZ: -(tileY + 1) * tileSizeMeters,
        maxZ: -tileY * tileSizeMeters
      };
      const overlapsDirtyChunk = chunkBoundsList.some((chunkBounds) => intersectsBounds(tileBounds, chunkBounds));
      if (!overlapsDirtyChunk) continue;
      tilesToRebuild.push({ key, tileX, tileY });
    }

    for (const { key, tileX, tileY } of tilesToRebuild) {
      const cacheKey = `${tileX},${tileY}|${terrainKey}`;
      const geometry = geometryCache.get(cacheKey);
      if (geometry) {
        geometry.dispose?.();
        geometryCache.delete(cacheKey);
      }
      removeTile(key);
      ensureTile({ x: tileX, y: tileY }, key);
    }

    return tilesToRebuild.length;
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
    rebuildTilesForChunks,
    removeTile,
    clear
  };
}

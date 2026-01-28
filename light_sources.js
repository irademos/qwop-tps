import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export const LANTERN_LIGHT_SETTINGS = {
  intensity: 2.6,
  distance: 40,
  decay: 0.5,
  emissiveIntensity: 1.2
};

export const ROAD_LIGHT_SETTINGS = {
  intensity: 3.2,
  distance: 16,
  decay: 2,
  emissiveIntensity: 1.0
};

export const LIGHT_SOURCE_CONFIGS = {
  lantern: {
    modelUrl: '/assets/props/lantern.glb',
    scale: 0.1,
    emissiveColor: 0xffc16b,
    lightColor: 0xffd9a3,
    lightOffset: new THREE.Vector3(0, 6.0, 0),
    settings: LANTERN_LIGHT_SETTINGS
  },
  roadLight: {
    modelUrl: '/assets/props/road_light.glb',
    scale: 1,
    emissiveColor: 0xfff1c1,
    lightColor: 0xfff1c1,
    lightOffset: new THREE.Vector3(0, 3.4, 0),
    settings: ROAD_LIGHT_SETTINGS
  }
};

export const applyEmissiveGlow = (model, color, intensity) => {
  if (!model) return;
  model.traverse(child => {
    if (!child.isMesh || !child.material) return;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.forEach(material => {
      if (!material) return;
      if (material.emissive) {
        material.emissive.set(color);
        material.emissiveIntensity = intensity;
      }
      material.needsUpdate = true;
    });
  });
};

export const createLightSource = async (config, position) => {
  const loader = new GLTFLoader();
  const gltf = await loader.loadAsync(config.modelUrl);
  const model = gltf.scene;
  model.scale.setScalar(config.scale);
  model.position.copy(position);
  applyEmissiveGlow(model, config.emissiveColor, config.settings.emissiveIntensity);

  const light = new THREE.PointLight(
    config.lightColor,
    config.settings.intensity,
    config.settings.distance,
    config.settings.decay
  );
  light.position.copy(config.lightOffset);
  model.add(light);

  return { model, light };
};

export const createLightSources = async ({
  scene,
  playerModel,
  getTerrainHeight,
  liftPositionToBuildingTop
} = {}) => {
  if (!scene || !playerModel || !getTerrainHeight) return [];

  const lightSources = [];
  const basePosition = playerModel.position.clone();
  const lanternPosition = basePosition.clone().add(new THREE.Vector3(2.5, 0, 2));
  const terrainHeight = getTerrainHeight(lanternPosition.x, lanternPosition.z);
  lanternPosition.y = Number.isFinite(terrainHeight) ? terrainHeight + 0.2 : basePosition.y;
  if (liftPositionToBuildingTop) {
    liftPositionToBuildingTop(lanternPosition, 0.3);
  }

  const lantern = await createLightSource(LIGHT_SOURCE_CONFIGS.lantern, lanternPosition);
  scene.add(lantern.model);
  lightSources.push(lantern);

  return lightSources;
};

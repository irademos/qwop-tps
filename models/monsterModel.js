// /models/monsterModel.js
import * as THREE from "three";
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export function loadMonsterModel(scene, callback) {
  const loader = new GLTFLoader();
  const modelPath = '/models/Orc.glb';
  const configPath = modelPath.replace(/\.[^/.]+$/, '.json');
  fetch(configPath)
    .then((res) => (res.ok ? res.json() : {}))
    .catch(() => ({}))
    .then((config) => {
      loader.load(
        modelPath,
        (gltf) => {
          const model = gltf.scene;
          const scale = config.scale ?? 1;
          model.scale.set(scale, scale, scale);
          model.position.y += config.yOffset ?? 0;
          scene.add(model);

          const defaultAnimationSpeed = config.animationSpeed ?? 1.6;
          const perAnimationSpeeds = config.animationSpeeds ?? {};

          const mixer = new THREE.AnimationMixer(model);
          const actions = {};
          gltf.animations.forEach((clip) => {
            const name = clip.name.replace("CharacterArmature|", "");
            const action = mixer.clipAction(clip);
            const timeScale = perAnimationSpeeds[name] ?? defaultAnimationSpeed;
            action.setEffectiveTimeScale(timeScale);
            actions[name] = action;
          });

          model.userData.defaultAnimationSpeed = defaultAnimationSpeed;
          model.userData.animationSpeeds = perAnimationSpeeds;

          callback({ model, mixer, actions });
        },
        undefined,
        (err) => {
          console.error("Failed to load monster model:", err);
        }
      );
    });
}

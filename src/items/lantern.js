import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { stylizeObject } from '../environment/artStyle.js';

// Town: the lantern the player carries out of town at night (bootstrapGameApp.js hangs it on
// the left hand). lantern.glb is ≈ 7.4 units tall, upright, its ring handle on top (y ≈ 6.3),
// the glass (Material.001) around y ≈ 1.4.
export const LANTERN_MODEL_URL = '/assets/props/lantern.glb';
const LANTERN_HEIGHT = 0.25;           // player units, handle ring to base
const LANTERN_MODEL_HEIGHT = 7.36;
const LANTERN_HANDLE_Y = 6.0;          // model units: where the hand holds the ring
const LANTERN_GLASS_Y = 1.4;           // model units: the light sits in the glass
const LANTERN_GLASS_MATERIAL = 'Material.001';
const LANTERN_GLOW = Object.freeze({ color: 0xffd98a, intensity: 1.6 });
// Like the road lights' (ROAD_LIGHT_POINT_LIGHT_CONFIG), a little shorter reach
export const LANTERN_LIGHT_CONFIG = Object.freeze({ color: 0xfff1c1, intensity: 4, distance: 45, decay: 0.6 });

let templatePromise = null;
const loadTemplate = () => {
  if (!templatePromise) {
    templatePromise = new GLTFLoader().loadAsync(LANTERN_MODEL_URL)
      .then((gltf) => {
        const root = gltf?.scene || null;
        stylizeObject(root, { materials: false });
        // The glass glows
        root?.traverse((obj) => {
          if (!obj.isMesh) return;
          obj.castShadow = true;
          const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
          for (const mat of mats) {
            if (mat?.name !== LANTERN_GLASS_MATERIAL || !('emissive' in mat)) continue;
            mat.emissive = new THREE.Color(LANTERN_GLOW.color);
            mat.emissiveIntensity = LANTERN_GLOW.intensity;
          }
        });
        return root;
      })
      .catch((error) => {
        console.warn('Failed to load the lantern.', error);
        templatePromise = null;
        return null;
      });
  }
  return templatePromise;
};

/**
 * A lantern hanging from its handle at the group's origin, with a point light in its glass.
 * The model shows once loaded; `setLit(on)` shows / hides it — the light stays in the scene
 * (intensity 0 when off) so turning it on and off doesn't recompile every material.
 */
export function createLantern() {
  const group = new THREE.Group();
  group.name = 'lantern';
  const s = LANTERN_HEIGHT / LANTERN_MODEL_HEIGHT;
  const holder = new THREE.Group();
  holder.scale.setScalar(s);
  holder.position.y = -LANTERN_HANDLE_Y * s;
  holder.visible = false;
  group.add(holder);
  const { color, distance, decay } = LANTERN_LIGHT_CONFIG;
  const light = new THREE.PointLight(color, 0, distance, decay);
  light.position.y = (LANTERN_GLASS_Y - LANTERN_HANDLE_Y) * s;
  group.add(light);
  let lit = false;
  loadTemplate().then((template) => { if (template) holder.add(template.clone(true)); });
  return {
    group,
    setLit(on) {
      lit = !!on;
      holder.visible = lit;
      light.intensity = lit ? LANTERN_LIGHT_CONFIG.intensity : 0;
    },
    isLit: () => lit,
  };
}

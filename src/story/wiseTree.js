// Story mode's sacred tree: the wise tree (wise_tree.glb — an old, bare tree with a face in its
// bark) standing among the island's trees. Unrigged: it sways a little like any tree; talked to,
// it wakes — turns its face to the player, leans in and its branches stir — and left be, it turns
// back as it was and goes still.
//
// createWiseTree({ scene }) → { load(), placeAt(pos, yaw), hide(), reveal(on), lookAt(v3|null),
//   update(dt), position(), isPlaced(), height(), faceWorld(out), dispose() }
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { stylizeObject, whenStyleReferenceReady } from '../environment/artStyle.js';

export const WISE_TREE_MODEL_URL = '/assets/props/wise_tree.glb?v=1'; // (bump when the GLB changes)
const HEIGHT = 4.2;              // m tall (its origin is at its base, its face toward +Z)
const FACE_AT = 0.45;            // its face's height, × its height
const TURN_RATE = 0.7;           // rad/s turning its face to whoever it's talking to
const WAKE_RATE = 1.5;           // 1/s easing between still and awake
const LEAN = 0.06;               // rad leaning in toward the player while it talks
const SWAY = 0.012;              // rad of idle sway, like any tree in the wind
const STIR = 0.03;               // more sway while it's awake (its branches stir)

export function createWiseTree({ scene }) {
  const root = new THREE.Group();
  root.name = 'story-wise-tree';
  root.visible = false;
  scene.add(root);
  const body = new THREE.Group();  // leaned / swayed about the base
  root.add(body);
  let loading = null;
  let model = null;
  let h = HEIGHT;
  let awake = 0;                    // 0 still … 1 awake (talking)
  let revealed = false;
  let lookTarget = null;
  let baseYaw = 0;
  let t = Math.random() * 10;

  const load = () => {
    if (loading) return loading;
    loading = Promise.all([new GLTFLoader().loadAsync(WISE_TREE_MODEL_URL), whenStyleReferenceReady()])
      .then(([gltf]) => {
        model = gltf.scene;
        stylizeObject(model);
        model.traverse((o) => {
          if (!o.isMesh) return;
          o.castShadow = true;
          o.receiveShadow = true;
        });
        // Sized to HEIGHT, its base on the ground, centred over its trunk
        const box = new THREE.Box3().setFromObject(model);
        if (!box.isEmpty()) {
          const s = HEIGHT / Math.max(1e-6, box.max.y - box.min.y);
          model.scale.multiplyScalar(s);
          const c = box.getCenter(new THREE.Vector3());
          model.position.set(-c.x * s, -box.min.y * s, -c.z * s);
          h = HEIGHT;
        }
        body.add(model);
      })
      .catch((err) => { console.warn('[story] wise tree failed to load:', err); });
    return loading;
  };

  const placeAt = (pos, yaw) => {
    root.position.copy(pos);
    root.rotation.y = yaw;
    baseYaw = yaw;
    root.visible = true;
  };

  const update = (dt) => {
    if (!root.visible || !model) return;
    t += dt;
    awake += ((revealed ? 1 : 0) - awake) * Math.min(1, dt * WAKE_RATE);
    // Its face turned to the player while talking, back as it was after
    let yawWant = baseYaw;
    if (revealed && lookTarget) yawWant = Math.atan2(lookTarget.x - root.position.x, lookTarget.z - root.position.z);
    const d = Math.atan2(Math.sin(yawWant - root.rotation.y), Math.cos(yawWant - root.rotation.y));
    root.rotation.y += THREE.MathUtils.clamp(d, -TURN_RATE * dt, TURN_RATE * dt);
    // Swaying in the wind; awake it leans in and stirs
    const sway = SWAY + STIR * awake;
    body.rotation.x = LEAN * awake + Math.sin(t * 0.8) * sway * 0.6;
    body.rotation.z = Math.sin(t * 0.63 + 1.3) * sway;
  };

  return {
    load,
    placeAt,
    hide: () => { root.visible = false; revealed = false; lookTarget = null; },
    reveal: (on) => { revealed = !!on; if (!on) lookTarget = null; },
    lookAt: (v) => { lookTarget = v ? v.clone() : null; },
    update,
    position: () => root.position,
    isPlaced: () => root.visible,
    height: () => h,
    // Where its face is (its voice comes from here)
    faceWorld: (out = new THREE.Vector3()) => {
      root.updateMatrixWorld(true);
      return out.set(0, h * FACE_AT, h * 0.08).applyMatrix4(body.matrixWorld);
    },
    dispose: () => {
      root.parent?.remove(root);
      root.traverse((o) => { o.geometry?.dispose?.(); for (const m of [o.material].flat()) { m?.map?.dispose?.(); m?.dispose?.(); } });
    },
  };
}

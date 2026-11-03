// Story mode's sacred tree: the tree creature (tree_creature.glb) standing among the island's
// trees, hiding as one — arms up over its head, clumps of leaves round its hands, along its arms
// and on its head. Talked to, it lowers its arms (the leaves stay on) and turns to the player;
// left be, it puts them back up and goes still.
//
// createTreeCreature({ scene }) → { load(), placeAt(pos, yaw), hide(), reveal(on), lookAt(v3|null),
//   update(dt), position(), isPlaced(), handWorld(out), dispose() }
import * as THREE from 'three';
import { createGLBCharacterInstance, glbCharacterConfig } from '../models/glbCharacterModel.js';

const HEIGHT = 1.45;            // targetHeight (× the model's 1.4 height scale → ~2 m)
const ARMS_UP = { x: 0.32, y: 1.32, z: 0.06 };   // floating hand targets, × its height: overhead
const ARMS_DOWN = { x: 0.3, y: 0.52, z: 0.16 };  // talking: down, a little out in front
const ARM_RATE = 2.5;            // 1/s easing between the two
const TURN_RATE = 2;             // rad/s turning to whoever it's talking to
const SWAY = 0.03;               // the hands sway a little, like branches
const LEAF_COLORS = [0x3f7a32, 0x4f8f3a, 0x2f6528, 0x5c9a40, 0x6a8f2e];

const rand = (a, b) => a + Math.random() * (b - a);

// A clump of leaves: low-poly green blobs plus a few flat leaves sticking out
const makeClump = (size, n) => {
  const g = new THREE.Group();
  for (let i = 0; i < n; i++) {
    const r = size * rand(0.45, 0.8);
    const blob = new THREE.Mesh(
      new THREE.IcosahedronGeometry(r, 0),
      new THREE.MeshStandardMaterial({ color: LEAF_COLORS[i % LEAF_COLORS.length], roughness: 0.95, flatShading: true }),
    );
    blob.position.set(rand(-1, 1) * size * 0.6, rand(-0.6, 1) * size * 0.6, rand(-1, 1) * size * 0.6);
    blob.rotation.set(rand(0, 6), rand(0, 6), rand(0, 6));
    blob.castShadow = true;
    g.add(blob);
  }
  for (let i = 0; i < n + 2; i++) {
    const leaf = new THREE.Mesh(
      new THREE.CircleGeometry(size * 0.35, 5),
      new THREE.MeshStandardMaterial({ color: LEAF_COLORS[(i + 2) % LEAF_COLORS.length], roughness: 0.9, side: THREE.DoubleSide }),
    );
    leaf.scale.y = 1.8;
    const a = rand(0, Math.PI * 2);
    const e = rand(-0.5, 1.1);
    leaf.position.set(Math.cos(a) * size * 0.9, Math.sin(e) * size * 0.9, Math.sin(a) * size * 0.9);
    leaf.lookAt(leaf.position.clone().multiplyScalar(2));
    leaf.castShadow = true;
    g.add(leaf);
  }
  return g;
};

export function createTreeCreature({ scene }) {
  const root = new THREE.Group();
  root.name = 'story-tree-creature';
  root.visible = false;
  scene.add(root);
  let loading = null;
  let character = null;
  let body = null;
  let hands = null;          // floating hand targets ('right' = local +X, as everywhere)
  let h = HEIGHT * (glbCharacterConfig.heightScaleByUrl[glbCharacterConfig.treeCreatureUrl] ?? 1);
  let up = 1;                // 1 arms up (hiding) … 0 down (talking)
  let revealed = false;
  let lookTarget = null;
  let baseYaw = 0;
  let t = Math.random() * 10;
  // Leaf clumps, kept in the root's frame and moved onto the body each frame (the bones are
  // stretched by the arm IK — nothing hangs off them directly)
  const leaves = { right: [], left: [], head: null };

  const load = () => {
    if (loading) return loading;
    loading = createGLBCharacterInstance({ targetHeight: HEIGHT, url: glbCharacterConfig.treeCreatureUrl, armIK: true })
      .then(({ container, character: ch }) => {
        body = container;
        character = ch;
        hands = { right: new THREE.Object3D(), left: new THREE.Object3D() };
        body.add(hands.right, hands.left);
        root.add(body);
        // The box from the bind pose: its real height
        const box = new THREE.Box3().setFromObject(body);
        if (!box.isEmpty()) h = box.max.y - box.min.y;
        for (const side of ['right', 'left']) {
          // (the hand, the forearm, the elbow and the upper arm)
          for (const [size, n] of [[0.34, 8], [0.27, 7], [0.24, 6], [0.22, 6]]) {
            const c = makeClump(size * (h / 2), n);
            leaves[side].push(c);
            root.add(c);
          }
        }
        leaves.head = makeClump(0.4 * (h / 2), 10);
        root.add(leaves.head);
        ch.setMoving(false);
      })
      .catch((err) => { console.warn('[story] tree creature failed to load:', err); });
    return loading;
  };

  const placeAt = (pos, yaw) => {
    root.position.copy(pos);
    root.rotation.y = yaw;
    baseYaw = yaw;
    root.visible = true;
    up = revealed ? 0 : 1;
  };

  const _v = new THREE.Vector3();
  const _a = new THREE.Vector3();
  const _b = new THREE.Vector3();
  const _inv = new THREE.Matrix4();
  const toRoot = (v) => v.applyMatrix4(_inv);
  const setHand = (obj, sign, k) => {
    const sway = Math.sin(t * 0.9 + sign) * SWAY * k;
    obj.position.set(
      sign * THREE.MathUtils.lerp(ARMS_DOWN.x, ARMS_UP.x, k) * h + sway * h,
      THREE.MathUtils.lerp(ARMS_DOWN.y, ARMS_UP.y, k) * h,
      THREE.MathUtils.lerp(ARMS_DOWN.z, ARMS_UP.z, k) * h,
    );
  };

  const update = (dt) => {
    if (!root.visible || !character) return;
    t += dt;
    const want = revealed ? 0 : 1;
    up += (want - up) * Math.min(1, dt * ARM_RATE);
    // Turned to the player while talking, back as it was after
    let yawWant = baseYaw;
    if (revealed && lookTarget) yawWant = Math.atan2(lookTarget.x - root.position.x, lookTarget.z - root.position.z);
    const d = Math.atan2(Math.sin(yawWant - root.rotation.y), Math.cos(yawWant - root.rotation.y));
    root.rotation.y += THREE.MathUtils.clamp(d, -TURN_RATE * dt, TURN_RATE * dt);
    setHand(hands.right, 1, up);
    setHand(hands.left, -1, up);
    root.updateMatrixWorld(true);
    character.animate(dt);
    character.solveArm('right', hands.right, { writeBack: false });
    character.solveArm('left', hands.left, { writeBack: false });
    character.stepFluff(dt);
    // The leaves onto the arms and head
    _inv.copy(root.matrixWorld).invert();
    for (const side of ['right', 'left']) {
      const arm = character.arms[side];
      const list = leaves[side];
      if (!arm) { list.forEach((c) => { c.visible = false; }); continue; }
      character.getPalmWorldPosition(side, _v);
      list[0].position.copy(toRoot(_v));
      arm.fore.getWorldPosition(_a);
      arm.hand.getWorldPosition(_b);
      list[1].position.copy(toRoot(_v.copy(_a).lerp(_b, 0.5)));
      list[2].position.copy(toRoot(_a.clone()));
      arm.upper.getWorldPosition(_b);
      list[3].position.copy(toRoot(_v.copy(_a).lerp(_b, 0.5)));
    }
    const head = character.fluffy.getBone?.('Head');
    if (head && leaves.head) {
      head.getWorldPosition(_v);
      leaves.head.position.copy(toRoot(_v)).add(_a.set(0, 0.1 * h, 0));
    }
    // (a little rustle)
    const r = Math.sin(t * 1.7) * 0.04 * (0.4 + up);
    for (const c of [...leaves.right, ...leaves.left, leaves.head]) if (c) c.rotation.y = r;
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
    // Where its talking-hand is (the sword is handed over from here)
    handWorld: (out = new THREE.Vector3()) => (character ? character.getPalmWorldPosition('right', out) : out.copy(root.position).setY(root.position.y + h * 0.6)),
    dispose: () => {
      root.parent?.remove(root);
      character?.dispose();
      root.traverse((o) => { o.geometry?.dispose?.(); o.material?.dispose?.(); });
    },
  };
}

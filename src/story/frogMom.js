// Story mode: the frog mom (frog_mom.glb) — sitting on a stone of her own on Tree Island, the
// Sitting clip looped (glbCharacterConfig.sitClip, GLBCharacter.playPose). Just there for now
// (no talk yet); her spot comes from storyLayout.js (`frogMom`).
//
// createFrogMom({ scene }) → { load(), placeAt(pos, yaw), hide(), update(dt), position(), isPlaced(), dispose() }
import * as THREE from 'three';
import { createGLBCharacterInstance, glbCharacterConfig } from '../models/glbCharacterModel.js';
import { fitSeatStone, makeSeatStone } from './storyProps.js';

const HIPS_OVER_SEAT = 0.07;   // m the hips bone sits over the stone's top (the seat of the pants)

export function createFrogMom({ scene }) {
  const root = new THREE.Group();
  root.name = 'story-frog-mom';
  root.visible = false;
  scene.add(root);
  let loading = null;
  let character = null;
  let stone = null;
  let fitted = false;          // the stone sized to her hips once the clip has posed her
  const _v = new THREE.Vector3();

  const load = () => {
    if (loading) return loading;
    loading = createGLBCharacterInstance({ url: glbCharacterConfig.frogMomUrl, armIK: false })
      .then(({ container, character: ch }) => {
        character = ch;
        root.add(container);
        ch.playPose(glbCharacterConfig.sitClip, { fade: 0 });
      })
      .catch((err) => { console.warn('[story] frog mom failed to load:', err); });
    return loading;
  };

  const placeAt = (pos, yaw) => {
    root.position.copy(pos);
    root.rotation.y = yaw;
    root.visible = true;
    fitted = false;
  };

  // Her stone: under her hips, its top just under them (measured from the posed clip)
  const fitStone = () => {
    const hips = character?.fluffy?.getBone?.('Hips');
    if (!hips || !character._action?.started) return;
    root.updateMatrixWorld(true);
    root.worldToLocal(hips.getWorldPosition(_v));
    if (!Number.isFinite(_v.y) || _v.y < 0.1) return;
    if (!stone) { stone = makeSeatStone(); root.add(stone); }
    fitSeatStone(stone, 0, _v.y - HIPS_OVER_SEAT, _v.x, _v.z - 0.05);
    fitted = true;
  };

  let t = 0;
  const update = (dt) => {
    if (!root.visible || !character) return;
    t += dt;
    character.animate(dt);
    character.stepFluff(dt);
    if (!fitted && t > 0.3) fitStone();
  };

  return {
    load,
    placeAt,
    hide: () => { root.visible = false; },
    update,
    position: () => root.position,
    isPlaced: () => root.visible,
    dispose: () => {
      root.parent?.remove(root);
      character?.dispose();
      stone?.geometry?.dispose();
      stone?.material?.dispose();
    },
  };
}

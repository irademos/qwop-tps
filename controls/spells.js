import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export const FLY_WINGS_OFFSET = Object.freeze({ x: 0, y: 0.15, z: -0.2 });
// export const FLY_WINGS_SCALE = Object.freeze({ x: 0.0001, y: 0.0001, z: 0.0001 });
export const FLY_WINGS_SCALE = 10.0;
export const FLY_WINGS_ANIMATION_START_TIME = 0;
export const FLY_WINGS_ANIMATION_STOP_TIME = null;
const FLY_WINGS_MODEL_URL = '/assets/props/wings.glb';
const FLY_WINGS_ANIMATION_CLIP = 'Demon Wings Rig|animations';

const SPELL_DEFS = [
  {
    id: 'shield',
    label: 'Shield',
    magicCost: 25,
    cooldownMs: 60_000,
    durationMs: 5_000
  },
  {
    id: 'fly',
    label: 'Fly',
    magicCost: 60,
    cooldownMs: 180_000,
    durationMs: 45_000
  }
];

const SHIELD_COLOR = 0x7dd3fc;
const SHIELD_EMISSIVE = 0x38bdf8;
const gltfLoader = new GLTFLoader();
let wingsAssetPromise = null;

const getAvailableSpells = (spellsAvailable = {}) => (
  SPELL_DEFS.filter(spell => spellsAvailable[spell.id])
);

const createShieldBubble = () => {
  const geometry = new THREE.SphereGeometry(1.05, 32, 32);
  const material = new THREE.MeshStandardMaterial({
    color: SHIELD_COLOR,
    transparent: true,
    opacity: 0.25,
    emissive: SHIELD_EMISSIVE,
    emissiveIntensity: 0.35,
    depthWrite: false
  });
  const bubble = new THREE.Mesh(geometry, material);
  bubble.name = 'shield-bubble';
  bubble.renderOrder = 10;
  bubble.position.set(0, 1, 0);
  return bubble;
};

const findTorsoAnchor = (model) => {
  let anchor = null;
  model?.traverse?.((child) => {
    if (anchor) return;
    if (child.name && /spine|chest|torso|upper/i.test(child.name)) {
      anchor = child;
    }
  });
  return anchor;
};

const getWingsAsset = () => {
  if (wingsAssetPromise) return wingsAssetPromise;
  wingsAssetPromise = new Promise((resolve, reject) => {
    gltfLoader.load(FLY_WINGS_MODEL_URL, resolve, undefined, reject);
  }).catch((error) => {
    wingsAssetPromise = null;
    throw error;
  });
  return wingsAssetPromise;
};

export function initSpells({
  playerControls,
  getPlayerModel,
  spellsAvailable,
  getMagic,
  setMagic
} = {}) {
  const availableSpells = getAvailableSpells(spellsAvailable);
  const cooldowns = new Map();
  let shieldBubble = null;
  let shieldTimeout = null;
  let cooldownTimer = null;
  let flyTimeout = null;
  let wingsRoot = null;
  let wingsMixer = null;
  let wingsAnimationAction = null;

  const setInvincible = (durationMs) => {
    if (!playerControls) return;
    const until = Date.now() + durationMs;
    playerControls.isInvincible = true;
    playerControls.invincibleUntil = Math.max(playerControls.invincibleUntil || 0, until);
  };

  const clearInvincible = () => {
    if (!playerControls) return;
    const now = Date.now();
    if (playerControls.invincibleUntil && playerControls.invincibleUntil > now) {
      return;
    }
    playerControls.isInvincible = false;
    playerControls.invincibleUntil = 0;
  };

  const clearShieldBubble = () => {
    if (!shieldBubble) return;
    if (shieldBubble.parent) {
      shieldBubble.parent.remove(shieldBubble);
    }
    shieldBubble.geometry?.dispose?.();
    shieldBubble.material?.dispose?.();
    shieldBubble = null;
  };

  const activateShield = (spell) => {
    const targetModel = getPlayerModel?.() || playerControls?.playerModel;
    if (!targetModel) return;
    clearShieldBubble();
    shieldBubble = createShieldBubble();
    targetModel.add(shieldBubble);
    setInvincible(spell.durationMs);
    if (shieldTimeout) {
      clearTimeout(shieldTimeout);
    }
    shieldTimeout = setTimeout(() => {
      clearShieldBubble();
      clearInvincible();
    }, spell.durationMs);
  };

  const clearWings = () => {
    if (flyTimeout) {
      clearTimeout(flyTimeout);
      flyTimeout = null;
    }
    if (wingsAnimationAction) {
      wingsAnimationAction.stop();
      wingsAnimationAction = null;
    }
    wingsMixer = null;
    if (wingsRoot?.parent) {
      wingsRoot.parent.remove(wingsRoot);
    }
    wingsRoot = null;
    if (playerControls) {
      playerControls.flySpellActive = false;
      playerControls.onFlyJump = null;
      playerControls.flySpellEndsAt = 0;
    }
    playerControls?.refreshActionButtons?.();
  };

  const activateFly = async (spell) => {
    const targetModel = getPlayerModel?.() || playerControls?.playerModel;
    if (!targetModel) return;
    clearWings();
    try {
      const gltf = await getWingsAsset();
      const cloned = gltf.scene.clone(true);
      cloned.name = 'fly-wings';
      cloned.position.set(FLY_WINGS_OFFSET.x, FLY_WINGS_OFFSET.y, FLY_WINGS_OFFSET.z);
      // cloned.scale.set(FLY_WINGS_SCALE.x, FLY_WINGS_SCALE.y, FLY_WINGS_SCALE.z);
      cloned.scale.setScalar(FLY_WINGS_SCALE);
      const anchor = findTorsoAnchor(targetModel) || targetModel;
      anchor.add(cloned);
      wingsRoot = cloned;
      if (Array.isArray(gltf.animations) && gltf.animations.length > 0) {
        wingsMixer = new THREE.AnimationMixer(cloned);
        const flyClip = gltf.animations.find((clip) => clip.name === FLY_WINGS_ANIMATION_CLIP) || gltf.animations[0];
        if (flyClip) {
          wingsAnimationAction = wingsMixer.clipAction(flyClip);
          wingsAnimationAction.loop = THREE.LoopRepeat;
          wingsAnimationAction.clampWhenFinished = false;
          wingsAnimationAction.enabled = true;
          wingsAnimationAction.play();
          if (FLY_WINGS_ANIMATION_START_TIME > 0) {
            wingsAnimationAction.time = FLY_WINGS_ANIMATION_START_TIME;
          }
          wingsAnimationAction.paused = true;
        }
      }
      if (playerControls) {
        playerControls.flySpellActive = true;
        playerControls.flySpellEndsAt = Date.now() + spell.durationMs;
        playerControls.flyWingsAnimationAction = wingsAnimationAction;
        playerControls.onFlyJump = () => {
          if (!wingsAnimationAction) return;
          const clipDuration = wingsAnimationAction.getClip().duration;
          const stopAt = Number.isFinite(FLY_WINGS_ANIMATION_STOP_TIME)
            ? Math.max(FLY_WINGS_ANIMATION_START_TIME, FLY_WINGS_ANIMATION_STOP_TIME)
            : clipDuration;
          const clampedStart = Math.max(0, Math.min(FLY_WINGS_ANIMATION_START_TIME, clipDuration));
          wingsAnimationAction.reset();
          wingsAnimationAction.paused = false;
          wingsAnimationAction.time = clampedStart;
          if (Number.isFinite(stopAt) && stopAt > clampedStart) {
            setTimeout(() => {
              if (!wingsAnimationAction || !playerControls?.flySpellActive) return;
              wingsAnimationAction.paused = true;
            }, Math.max(100, (stopAt - clampedStart) * 1000));
          }
        };
      }
      flyTimeout = setTimeout(() => {
        clearWings();
      }, spell.durationMs);
    } catch (error) {
      console.warn('Failed to load fly wings spell asset.', error);
      clearWings();
    }
  };

  const canCastSpell = (spell) => {
    const magicValue = Number.isFinite(getMagic?.()) ? getMagic() : 0;
    if (magicValue < spell.magicCost) {
      return false;
    }
    const cooldownUntil = cooldowns.get(spell.id) || 0;
    return Date.now() >= cooldownUntil;
  };

  const setCooldown = (spell) => {
    cooldowns.set(spell.id, Date.now() + spell.cooldownMs);
  };

  const handleSpellCast = (spell) => {
    if (!canCastSpell(spell)) return;
    const currentMagic = Number.isFinite(getMagic?.()) ? getMagic() : 0;
    const nextMagic = Math.max(0, currentMagic - spell.magicCost);
    setMagic?.(nextMagic);
    if (spell.id === 'shield') {
      activateShield(spell);
    } else if (spell.id === 'fly') {
      void activateFly(spell);
    }
    setCooldown(spell);
    playerControls?.refreshActionButtons?.();
  };

  const getSpellState = (spell) => {
    const cooldownUntil = cooldowns.get(spell.id) || 0;
    const remainingMs = cooldownUntil - Date.now();
    const magicValue = Number.isFinite(getMagic?.()) ? getMagic() : 0;
    const hasMagic = magicValue >= spell.magicCost;
    return {
      disabled: remainingMs > 0 || !hasMagic,
      remainingSeconds: remainingMs > 0 ? Math.ceil(remainingMs / 1000) : 0
    };
  };

  const castSpellById = (spellId) => {
    const spell = availableSpells.find(entry => entry.id === spellId);
    if (!spell) return false;
    if (!canCastSpell(spell)) return false;
    handleSpellCast(spell);
    return true;
  };

  const getSpellStateById = (spellId) => {
    const spell = availableSpells.find(entry => entry.id === spellId);
    if (!spell) return { disabled: true, remainingSeconds: 0 };
    return getSpellState(spell);
  };

  if (playerControls) {
    playerControls.castSpellById = castSpellById;
    playerControls.getSpellStateById = getSpellStateById;
  }

  cooldownTimer = setInterval(() => {
    const deltaSec = Number.isFinite(playerControls?.deltaSeconds) ? playerControls.deltaSeconds : 0;
    if (wingsMixer && deltaSec > 0 && playerControls?.flySpellActive) {
      wingsMixer.update(deltaSec);
    }
    if (playerControls?.refreshActionButtons) {
      playerControls.refreshActionButtons();
    }
  }, 250);

  return {
    destroy: () => {
      if (cooldownTimer) {
        clearInterval(cooldownTimer);
      }
      if (shieldTimeout) {
        clearTimeout(shieldTimeout);
      }
      clearWings();
      clearShieldBubble();
      if (playerControls) {
        delete playerControls.castSpellById;
        delete playerControls.getSpellStateById;
        delete playerControls.flySpellActive;
        delete playerControls.flySpellEndsAt;
        delete playerControls.flyWingsAnimationAction;
        delete playerControls.onFlyJump;
      }
    }
  };
}

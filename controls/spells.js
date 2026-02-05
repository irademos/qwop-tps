import * as THREE from 'three';

const SPELL_DEFS = [
  {
    id: 'shield',
    label: 'Shield',
    magicCost: 25,
    cooldownMs: 60_000,
    durationMs: 5_000
  }
];

const SHIELD_COLOR = 0x7dd3fc;
const SHIELD_EMISSIVE = 0x38bdf8;

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
      clearShieldBubble();
      if (playerControls) {
        delete playerControls.castSpellById;
        delete playerControls.getSpellStateById;
      }
    }
  };
}

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
  const actionContainer = document.getElementById('action-buttons');
  if (!actionContainer) return null;

  let spellsButton = document.getElementById('spells-button');
  if (!spellsButton) {
    spellsButton = document.createElement('button');
    spellsButton.id = 'spells-button';
    spellsButton.className = 'action-button mobile-action';
    spellsButton.textContent = 'SPELLS';
    actionContainer.appendChild(spellsButton);
  }

  const availableSpells = getAvailableSpells(spellsAvailable);
  const cooldowns = new Map();
  const spellButtons = new Map();
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
    updateSpellButtonState(spell);
  };

  const updateSpellButtonState = (spell) => {
    const button = spellButtons.get(spell.id);
    if (!button) return;
    const cooldownUntil = cooldowns.get(spell.id) || 0;
    const remainingMs = cooldownUntil - Date.now();
    const timerLabel = button.querySelector('.spell-timer');
    const magicValue = Number.isFinite(getMagic?.()) ? getMagic() : 0;
    const hasMagic = magicValue >= spell.magicCost;
    if (remainingMs > 0) {
      const seconds = Math.ceil(remainingMs / 1000);
      button.disabled = true;
      button.classList.add('spell-disabled');
      if (timerLabel) {
        timerLabel.textContent = `${seconds}s`;
      }
    } else if (!hasMagic) {
      button.disabled = true;
      button.classList.add('spell-disabled');
      if (timerLabel) {
        timerLabel.textContent = '';
      }
    } else {
      button.disabled = false;
      button.classList.remove('spell-disabled');
      if (timerLabel) {
        timerLabel.textContent = '';
      }
    }
  };

  const showSpellMenu = () => {
    actionContainer.classList.add('spell-menu-active');
    actionContainer.classList.remove('mobile-expanded', 'mobile-punch-mode', 'mobile-equip-mode');
  };

  const hideSpellMenu = () => {
    actionContainer.classList.remove('spell-menu-active');
  };

  const closeButton = document.createElement('button');
  closeButton.className = 'action-button spell-action spell-close';
  closeButton.setAttribute('aria-label', 'Close spells');
  closeButton.textContent = '✕';
  closeButton.addEventListener('click', (event) => {
    event.preventDefault();
    hideSpellMenu();
  });
  actionContainer.appendChild(closeButton);

  availableSpells.forEach((spell) => {
    const button = document.createElement('button');
    button.className = 'action-button spell-action';
    button.dataset.spellId = spell.id;
    button.textContent = spell.label;
    const timerLabel = document.createElement('span');
    timerLabel.className = 'spell-timer';
    button.appendChild(timerLabel);
    button.addEventListener('click', (event) => {
      event.preventDefault();
      handleSpellCast(spell);
    });
    actionContainer.appendChild(button);
    spellButtons.set(spell.id, button);
  });

  spellsButton.addEventListener('click', (event) => {
    event.preventDefault();
    showSpellMenu();
  });

  cooldownTimer = setInterval(() => {
    availableSpells.forEach((spell) => updateSpellButtonState(spell));
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
      spellButtons.forEach(button => button.remove());
      closeButton.remove();
    }
  };
}

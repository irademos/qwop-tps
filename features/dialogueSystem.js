/**
 * Simple NPC dialogue system.
 *
 * Exports:
 *  - initDialogueSystem(THREE, { scene, playerModel, toasts, audioManager })
 *
 * The module creates a small NPC mesh in the world and a caption UI.
 * When the player comes close, the NPC offers a short line and up to
 * three numbered choices. The player selects a choice by pressing 1/2/3.
 *
 * No top-level side effects; initialization happens when initDialogueSystem is called.
 */

export function initDialogueSystem(THREE, { scene, playerModel, toasts, audioManager } = {}) {
  if (!THREE) throw new Error('THREE is required');
  if (!scene) throw new Error('scene is required');
  if (!playerModel) throw new Error('playerModel is required');

  const group = new THREE.Group();
  group.name = 'npc-dialogue';
  // Place NPC initially a few meters in front-right of player; we'll update on spawn
  group.position.set(3, 0.5, -2);
  scene.add(group);

  const bodyGeo = new THREE.SphereGeometry(0.26, 12, 10);
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0xffcc88, roughness: 0.8, metalness: 0.0 });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.castShadow = true;
  body.receiveShadow = true;
  body.position.set(0, 0.26, 0);
  group.add(body);

  // small chevron hat as a cone
  const hatGeo = new THREE.ConeGeometry(0.18, 0.28, 8);
  const hatMat = new THREE.MeshStandardMaterial({ color: 0x3355ff, roughness: 0.6 });
  const hat = new THREE.Mesh(hatGeo, hatMat);
  hat.position.set(0, 0.6, 0);
  hat.rotation.x = Math.PI;
  group.add(hat);

  // Simple bobbing animation state
  let bob = 0;

  // Dialogue content
  const script = {
    greeting: "Greetings, traveler! Care to help?",
    choices: [
      { text: "Yes — tell me what to do.", response: "Thank you! Fetch a glowing mushroom near the rocks." },
      { text: "Maybe later.", response: "Very well. I'll be here when you change your mind." },
      { text: "Who are you?", response: "I watch these woods. My name is Alder." }
    ]
  };

  // Interaction state
  let active = true;
  let inConversation = false;
  let lastTriggerAt = 0;
  const TRIGGER_COOLDOWN = 2500; // ms
  const TRIGGER_DISTANCE = 3.0; // meters

  // Create caption UI (scoped class names)
  const container = (typeof document !== 'undefined') ? document.createElement('div') : null;
  if (container) {
    container.className = 'ai-dialogue__container';
    container.setAttribute('aria-live', 'polite');
    // Minimal, scoped inline styles to avoid global CSS changes
    container.style.position = 'fixed';
    container.style.left = '50%';
    container.style.top = '12%';
    container.style.transform = 'translateX(-50%)';
    container.style.maxWidth = '640px';
    container.style.padding = '10px 14px';
    container.style.background = 'rgba(0,0,0,0.65)';
    container.style.color = '#fff';
    container.style.borderRadius = '8px';
    container.style.fontFamily = 'sans-serif';
    container.style.fontSize = '14px';
    container.style.display = 'none';
    container.style.zIndex = 9999;
    container.style.pointerEvents = 'none';

    const line = document.createElement('div');
    line.className = 'ai-dialogue__line';
    container.appendChild(line);

    const choices = document.createElement('div');
    choices.className = 'ai-dialogue__choices';
    choices.style.marginTop = '8px';
    choices.style.opacity = '0.95';
    container.appendChild(choices);

    document.body.appendChild(container);
  }

  // key handler for number keys 1..3 while in conversation
  function onKey(e) {
    if (!inConversation || !container) return;
    const key = e.key;
    if (!/^[1-3]$/.test(key)) return;
    const idx = Number(key) - 1;
    const choice = script.choices[idx];
    if (!choice) return;
    // show response
    showLine(choice.response);
    // optionally toast and play a small sfx
    try {
      toasts?.show?.(choice.response);
    } catch (err) { /* ignore */ }
    try {
      audioManager?.playSFX?.('ui/toggle-on.ogg', 0.5);
    } catch (e) { /* ignore missing assets */ }
    // end conversation after short delay
    setTimeout(() => {
      endConversation();
    }, 2200);
  }

  function showConversation() {
    if (!container) return;
    inConversation = true;
    container.style.display = 'block';
    const lineEl = container.querySelector('.ai-dialogue__line');
    const choicesEl = container.querySelector('.ai-dialogue__choices');
    lineEl.textContent = script.greeting;
    choicesEl.innerHTML = '';
    script.choices.forEach((c, i) => {
      const p = document.createElement('div');
      p.className = 'ai-dialogue__choice';
      p.textContent = `${i+1}. ${c.text}`;
      p.style.marginTop = '4px';
      choicesEl.appendChild(p);
    });
    // attach key handler
    document.addEventListener('keydown', onKey);
  }

  function showLine(text) {
    if (!container) return;
    const lineEl = container.querySelector('.ai-dialogue__line');
    const choicesEl = container.querySelector('.ai-dialogue__choices');
    lineEl.textContent = text;
    choicesEl.innerHTML = '';
  }

  function endConversation() {
    if (!container) return;
    inConversation = false;
    container.style.display = 'none';
    document.removeEventListener('keydown', onKey);
    lastTriggerAt = Date.now();
  }

  function setActive(v) {
    active = !!v;
    if (!active) {
      endConversation();
    }
  }

  function dispose() {
    try {
      if (group.parent) group.parent.remove(group);
    } catch (e) {}
    try { bodyGeo.dispose?.(); } catch (e) {}
    try { bodyMat.dispose?.(); } catch (e) {}
    try { hatGeo.dispose?.(); } catch (e) {}
    try { hatMat.dispose?.(); } catch (e) {}
    if (container && container.parentNode) container.parentNode.removeChild(container);
    document.removeEventListener('keydown', onKey);
  }

  /**
   * update(delta)
   * - call from main animate loop
   */
  function update(delta) {
    if (!active) return;

    // Keep NPC positioned near a static point relative to scene origin or player
    // If player moves far, reposition NPC to be near the player (so it's discoverable)
    const playerPos = playerModel.position;
    const distToPlayer = group.position.distanceTo(playerPos);
    // If NPC drifts far from player (>30m) teleport it near player
    if (distToPlayer > 30) {
      group.position.copy(playerPos).add(new THREE.Vector3(2 + Math.random() * 2, 0, -2 - Math.random() * 2));
    }

    // simple bob
    bob += delta * 2.2;
    group.position.y = 0.5 + Math.sin(bob) * 0.06;

    // trigger proximity
    const d = group.position.distanceTo(playerPos);
    if (!inConversation && Date.now() - lastTriggerAt > TRIGGER_COOLDOWN && d <= TRIGGER_DISTANCE) {
      // start conversation
      showConversation();
    }

    // keep caption visible while in conversation; optionally hide if player walks away
    if (inConversation && group.position.distanceTo(playerPos) > TRIGGER_DISTANCE * 1.7) {
      endConversation();
    }
  }

  return {
    update,
    setActive,
    dispose
  };
}

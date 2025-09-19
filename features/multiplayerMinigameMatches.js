/**
 * features/multiplayerMinigameMatches.js
 *
 * Small, self-contained demo of "multiplayer mini-game matches".
 * Exported initializer creates a simple in-world match area near the player,
 * runs automated short matches (countdown -> race -> winner) for visibility.
 *
 * - No top-level side effects.
 * - Exports initMultiplayerMinigames(THREE, { scene, playerModel, multiplayer, toasts })
 *
 * The controller exposes setActive(on), update(delta), dispose().
 */

/**
 * @param {any} THREE - three.js namespace
 * @param {object} opts
 * @param {THREE.Scene} opts.scene
 * @param {THREE.Object3D} opts.playerModel
 * @param {object} [opts.multiplayer] - optional multiplayer controller (not required)
 * @param {object} [opts.toasts] - optional toast manager with .show(msg)
 */
export function initMultiplayerMinigames(THREE, { scene, playerModel, multiplayer, toasts } = {}) {
  if (!THREE) throw new Error('THREE is required');
  if (!scene) throw new Error('scene is required');
  if (!playerModel) throw new Error('playerModel is required');

  const root = new THREE.Group();
  root.name = 'minigame-matches';
  scene.add(root);

  // Simple world HUD (canvas sprite) used as a scoreboard / status display
  function makeTextSprite(text, { width = 1.8, height = 0.6, bg = 'rgba(0,0,0,0.6)', color = '#fff' } = {}) {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.font = '28px sans-serif';
    ctx.fillText(text, canvas.width / 2, canvas.height / 2 + 10);
    const tex = new THREE.CanvasTexture(canvas);
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
    const spr = new THREE.Sprite(mat);
    spr.scale.set(width, height, 1);
    return { sprite: spr, texture: tex, update(text2) {
      const c = tex.image;
      const ctx2 = c.getContext('2d');
      ctx2.clearRect(0,0,c.width,c.height);
      ctx2.fillStyle = bg;
      ctx2.fillRect(0, 0, c.width, c.height);
      ctx2.fillStyle = color;
      ctx2.textAlign = 'center';
      ctx2.font = '28px sans-serif';
      ctx2.fillText(text2, c.width/2, c.height/2 + 10);
      tex.needsUpdate = true;
    } };
  }

  // Create a compact arena group positioned relative to the player
  const arena = new THREE.Group();
  arena.name = 'minigame-arena';
  root.add(arena);

  const baseGeo = new THREE.BoxGeometry(1.4, 0.06, 0.6);
  const baseMat = new THREE.MeshStandardMaterial({ color: 0x28323a, roughness: 0.9 });
  const base = new THREE.Mesh(baseGeo, baseMat);
  base.position.set(0, 0.02, 0);
  arena.add(base);

  // Create two simple racer markers (small boxes)
  const racerGeo = new THREE.BoxGeometry(0.18, 0.18, 0.18);

  function makeRacer(color) {
    const mat = new THREE.MeshStandardMaterial({ color, metalness: 0.1, roughness: 0.6 });
    const mesh = new THREE.Mesh(racerGeo, mat);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    return mesh;
  }

  const racerA = makeRacer(0x88ff88);
  const racerB = makeRacer(0xffcc88);
  arena.add(racerA);
  arena.add(racerB);

  // Scoreboard / status sprite
  const status = makeTextSprite('Mini-match: Ready', { width: 2.0, height: 0.6 });
  status.sprite.position.set(0, 0.5, 0);
  arena.add(status.sprite);

  // Local persistent score (keeps demo lively)
  let scores = { local: parseInt(localStorage.getItem('minigame_local_score')||'0',10), opponent: 0 };

  // Runtime state
  let active = false;
  let disposed = false;
  let scheduledId = null;
  let state = 'idle'; // idle | countdown | racing | finished
  let raceStart = 0;
  let raceDuration = 3.2; // seconds
  let countdown = 3; // seconds
  let progress = 0;
  let racerAStartX = -0.6, racerBStartX = -0.6;
  const finishX = 0.6;

  // Position arena in front of the player (updated before each match)
  function placeArenaNearPlayer() {
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(playerModel.quaternion).normalize();
    const pos = playerModel.position.clone().add(forward.multiplyScalar(2.6)).add(new THREE.Vector3(0, 0.6, 0));
    root.position.copy(pos);
    // face the camera/player
    root.lookAt(playerModel.position.x, playerModel.position.y + 0.6, playerModel.position.z);
  }

  function clearSchedule() {
    if (scheduledId != null) {
      clearTimeout(scheduledId);
      scheduledId = null;
    }
  }

  function scheduleNextMatch(delay = 6000) {
    clearSchedule();
    if (!active || disposed) return;
    scheduledId = setTimeout(() => {
      if (disposed) return;
      startCountdown();
    }, delay);
  }

  function startCountdown() {
    if (disposed || !active) return;
    placeArenaNearPlayer();
    state = 'countdown';
    countdown = 3;
    progress = 0;
    racerA.position.set(racerAStartX, 0.12, -0.14);
    racerB.position.set(racerBStartX, 0.12, 0.14);
    status.update(`Match starting in ${countdown}...`);
    let tick = 0;
    const tId = setInterval(() => {
      tick++;
      countdown--;
      if (countdown > 0) {
        status.update(`Match starting in ${countdown}...`);
      } else {
        clearInterval(tId);
        startRace();
      }
    }, 1000);
  }

  function startRace() {
    if (disposed || !active) return;
    state = 'racing';
    raceStart = performance.now() / 1000;
    // randomize duration slightly so results vary
    raceDuration = 2.8 + Math.random() * 1.4;
    status.update('Go!');
    if (toasts && typeof toasts.show === 'function') {
      try { toasts.show('Mini-match started!'); } catch (e) {}
    }
  }

  function finishRace(winner) {
    state = 'finished';
    if (winner === 'local') scores.local++;
    else scores.opponent++;
    try { localStorage.setItem('minigame_local_score', String(scores.local)); } catch (e) {}
    status.update(`Winner: ${winner === 'local' ? 'You' : 'Opponent'} • ${scores.local}-${scores.opponent}`);
    if (toasts && typeof toasts.show === 'function') {
      try { toasts.show(`Match finished — ${winner === 'local' ? 'You win!' : 'Opponent wins'}`); } catch (e) {}
    }
    // schedule next match
    scheduleNextMatch(5000 + Math.random() * 6000);
  }

  function updateRacers(nowS) {
    const elapsed = nowS - raceStart;
    progress = Math.min(1, Math.max(0, elapsed / raceDuration));
    // Simulate slightly different speeds (opponent may have small randomness)
    const aFactor = 0.95 + Math.sin(nowS * 2.3) * 0.02;
    const bFactor = 1.0 + Math.sin(nowS * 1.9) * 0.03 + (Math.random() * 0.01);
    const aPos = racerAStartX + (finishX - racerAStartX) * Math.min(1, progress * aFactor);
    const bPos = racerBStartX + (finishX - racerBStartX) * Math.min(1, progress * bFactor);
    racerA.position.x = aPos;
    racerB.position.x = bPos;

    // determine winner once someone crosses finish
    if (aPos >= finishX || bPos >= finishX) {
      const winner = aPos >= bPos ? 'local' : 'opponent';
      finishRace(winner);
    }
  }

  // Public API
  function setActive(next) {
    if (disposed) return;
    active = !!next;
    if (!active) {
      state = 'idle';
      clearSchedule();
      status.update('Mini-match: Paused');
    } else {
      status.update('Mini-match: Ready');
      scheduleNextMatch(1500);
    }
  }

  function update(delta) {
    if (disposed || !active) return;
    const nowS = performance.now() / 1000;
    // Keep arena positioned near the player while idle
    if (state === 'idle') {
      // slow follow for aesthetic
      placeArenaNearPlayer();
    } else if (state === 'racing') {
      updateRacers(nowS);
    }
  }

  function dispose() {
    disposed = true;
    clearSchedule();
    try {
      if (status && status.texture) status.texture.dispose();
    } catch (e) {}
    if (root.parent) root.parent.remove(root);
  }

  // Start inactive by default (app.js will enable by calling setActive(true))
  return { setActive, update, dispose, root };
}

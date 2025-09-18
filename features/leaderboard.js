/**
 * features/leaderboard.js
 *
 * Community Festival Leaderboard - in-world 3D billboard showing top scores.
 *
 * - No side-effects on import.
 * - Export initLeaderboard(THREE, { scene, camera, playerModel }) -> controller
 *
 * The implementation uses an offscreen canvas as a texture so it works without extra assets.
 */

/**
 * @param {object} THREE - three.js namespace
 * @param {object} options
 * @param {THREE.Scene} options.scene
 * @param {THREE.Camera} options.camera
 * @param {THREE.Object3D} options.playerModel
 */
export function initLeaderboard(THREE, { scene, camera, playerModel, position = null } = {}) {
  if (!THREE) throw new Error('THREE is required');
  if (!scene) throw new Error('scene is required');

  // Canvas texture for dynamic text
  const width = 512;
  const height = 320;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  function drawCanvas(scores = []) {
    // Background
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#08121a';
    ctx.fillRect(0, 0, width, height);

    // Header
    ctx.fillStyle = '#ffd54f';
    ctx.font = '28px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('Festival Leaderboard', width / 2, 42);

    // Subtitle
    ctx.fillStyle = '#bfe9ff';
    ctx.font = '14px monospace';
    ctx.fillText('(Top players this season)', width / 2, 68);

    // List
    ctx.textAlign = 'left';
    ctx.font = '20px monospace';
    const startY = 110;
    const lineH = 36;
    const max = Math.max(6, scores.length);
    for (let i = 0; i < max; i++) {
      const name = scores[i]?.name ?? `Anonymous${i+1}`;
      const score = scores[i]?.score ?? Math.max(0, Math.floor(1000 - i * 42 + (Math.random()*120 - 60)));
      const rank = i + 1;
      const y = startY + i * lineH;
      // Highlight top 3
      if (i === 0) ctx.fillStyle = '#ffe0b2';
      else if (i === 1) ctx.fillStyle = '#e6f7ff';
      else if (i === 2) ctx.fillStyle = '#f0fff4';
      else ctx.fillStyle = '#e8f8ff';
      ctx.fillText(`${rank}. ${name}`, 28, y);
      ctx.textAlign = 'right';
      ctx.fillText(`${score}`, width - 28, y);
      ctx.textAlign = 'left';
    }

    // Footer
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fillRect(0, height - 36, width, 36);
    ctx.fillStyle = '#cfeeff';
    ctx.font = '12px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('Visit the festival to compete and earn points!', width / 2, height - 14);
  }

  // Initial fake scores (will be replaceable via controller.updateScores)
  let scores = [
    { name: 'Aria', score: 1320 },
    { name: 'Borin', score: 1185 },
    { name: 'Cel', score: 1043 },
    { name: 'Doro', score: 978 },
    { name: 'Em', score: 921 },
    { name: 'Fenn', score: 870 }
  ];
  drawCanvas(scores);

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;

  const geo = new THREE.PlaneGeometry(2.0, 1.25);
  const mat = new THREE.MeshBasicMaterial({ map: texture, transparent: false });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'festival-leaderboard';
  mesh.renderOrder = 999;
  mesh.position.set(4, 2.2, -5);
  if (position && position.isVector3) mesh.position.copy(position);

  // Subtle frame (simple thin box)
  const frameGeo = new THREE.BoxGeometry(2.04, 1.29, 0.04);
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x332211, roughness: 0.9, metalness: 0.0 });
  const frame = new THREE.Mesh(frameGeo, frameMat);
  frame.position.copy(mesh.position);
  frame.position.z -= 0.03;
  frame.name = 'festival-leaderboard-frame';

  const group = new THREE.Group();
  group.add(mesh);
  group.add(frame);
  group.visible = true;
  scene.add(group);

  let active = true;
  let time = 0;

  function setActive(on) {
    active = !!on;
    group.visible = active;
  }

  function updateScores(newScores) {
    if (!Array.isArray(newScores)) return;
    scores = newScores.slice(0, 12);
    drawCanvas(scores);
    texture.needsUpdate = true;
  }

  function update(delta) {
    if (!active) return;
    time += delta || 0;
    // Slow bob
    const bob = Math.sin(time * 0.8) * 0.05;
    group.position.y = bob;

    // Face the camera if provided
    try {
      if (camera && camera.position) {
        group.lookAt(camera.position);
        // Keep upright: prevent flipping on X axis
        const e = group.rotation;
        group.rotation.x = 0;
      } else if (playerModel && playerModel.position) {
        // fallback: face player
        group.lookAt(playerModel.position);
        group.rotation.x = 0;
      }
    } catch (e) {}
  }

  // Small API for runtime control
  const controller = {
    setActive,
    updateScores,
    update,
    dispose() {
      scene.remove(group);
      geo.dispose();
      frameGeo.dispose();
      mat.map?.dispose();
      mat.dispose();
      frameMat.dispose();
    }
  };

  return controller;
}

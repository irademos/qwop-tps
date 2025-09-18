/**
 * features/seasonalMinigameLeaderboard.js
 *
 * Creates a small in-world 3D leaderboard that shows the current seasonal mini-game
 * name and top scores. Lazy-loaded and initialized from app.js. No top-level side-effects.
 *
 * Export:
 *   initSeasonalMinigameLeaderboard(THREE, { scene, playerModel, camera })
 *
 * Returns a controller: { setActive(bool), update(dt), dispose() }
 */

export function initSeasonalMinigameLeaderboard(THREE, { scene, playerModel, camera } = {}) {
  if (!THREE) throw new Error('THREE is required');
  if (!scene) throw new Error('scene is required');

  // Canvas texture for dynamic text rendering
  const CANVAS_W = 512;
  const CANVAS_H = 256;
  const canvas = document.createElement('canvas');
  canvas.width = CANVAS_W;
  canvas.height = CANVAS_H;
  const ctx = canvas.getContext('2d');

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.encoding = THREE.sRGBEncoding || THREE.LinearEncoding;

  // Simple board geometry
  const geo = new THREE.PlaneGeometry(1.6, 0.8);
  const mat = new THREE.MeshStandardMaterial({
    map: texture,
    side: THREE.DoubleSide,
    transparent: false,
    roughness: 0.8,
    metalness: 0.0,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'seasonal-mini-leaderboard';
  mesh.renderOrder = 999;
  mesh.castShadow = false;
  mesh.receiveShadow = false;

  // Pole
  const poleGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.7, 8);
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x4c4c4c, roughness: 0.9 });
  const pole = new THREE.Mesh(poleGeo, poleMat);
  pole.position.set(0, -0.65, 0);
  pole.castShadow = false;
  pole.receiveShadow = false;
  mesh.add(pole);

  // Place near player if available, otherwise at origin
  const basePos = (playerModel && playerModel.position) ? playerModel.position.clone() : new THREE.Vector3(0, 0, 0);
  mesh.position.copy(basePos).add(new THREE.Vector3(2.2, 1.2, -1.6));
  mesh.lookAt(basePos.clone().add(new THREE.Vector3(0, 1.2, 0))); // face roughly the player

  scene.add(mesh);

  let active = true;
  let disposed = false;

  // Dummy seasonal state and scores (rotate/demo). In a proper backend-enabled build this would be fed from server.
  const seasons = [
    { name: 'Autumn Fair', game: 'Leaf Rush' },
    { name: 'Winter Games', game: 'Snow Sprint' },
    { name: 'Spring Fete', game: 'Blossom Bash' },
    { name: 'Summer Carnival', game: 'Firefly Chase' }
  ];
  let seasonIndex = Math.floor((Date.now() / 1000) % seasons.length);

  let scores = [
    { name: 'Aria', score: 1320 },
    { name: 'Borin', score: 1185 },
    { name: 'Cel', score: 1043 },
    { name: 'Doro', score: 978 },
    { name: 'Em', score: 921 }
  ];

  let lastTick = performance.now();

  function draw() {
    // background
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.fillStyle = '#0b1b12';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // header
    ctx.fillStyle = '#ffd27f';
    ctx.font = '28px "Press Start 2P", monospace';
    ctx.textAlign = 'left';
    ctx.fillText(seasons[seasonIndex].name, 28, 42);

    // subheader: mini-game
    ctx.fillStyle = '#ffffff';
    ctx.font = '18px "Press Start 2P", monospace';
    ctx.fillText(seasons[seasonIndex].game, 28, 74);

    // divider
    ctx.fillStyle = '#66ccff';
    ctx.fillRect(24, 86, CANVAS_W - 48, 2);

    // scores
    ctx.font = '20px "Press Start 2P", monospace';
    for (let i = 0; i < Math.min(5, scores.length); i++) {
      const s = scores[i];
      const y = 120 + i * 28;
      ctx.fillStyle = '#cfe8ff';
      ctx.fillText(`${i + 1}. ${s.name}`, 28, y);
      ctx.textAlign = 'right';
      ctx.fillStyle = '#fffbe6';
      ctx.fillText(String(s.score), CANVAS_W - 28, y);
      ctx.textAlign = 'left';
    }

    // footer hint (non-interactive)
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.font = '12px "Press Start 2P", monospace';
    ctx.fillText('Seasonal mini-games • Top scores (demo)', 28, CANVAS_H - 16);

    texture.needsUpdate = true;
  }

  // Update loop: rotates demo scores and seasonal name occasionally.
  const intervalId = setInterval(() => {
    if (disposed || !active) return;
    // bump season occasionally
    if (Math.random() < 0.08) seasonIndex = (seasonIndex + 1) % seasons.length;

    // Randomly tweak scores a bit for demo liveliness
    scores.forEach(s => {
      s.score = Math.max(0, s.score + (Math.floor(Math.random() * 41) - 20));
    });
    scores.sort((a, b) => b.score - a.score);

    draw();
  }, 2200);

  // Initial draw
  draw();

  function setActive(on) {
    active = !!on;
    mesh.visible = !!on;
    if (!active) {
      // dim board slightly when inactive
      mat.opacity = 0.45;
      mat.transparent = true;
    } else {
      mat.opacity = 1.0;
      mat.transparent = false;
      draw();
    }
  }

  function update(dt) {
    // gently bob the board for a little life
    if (!mesh) return;
    const t = performance.now() / 1000;
    mesh.position.y += Math.sin(t * 0.8) * 0.0005;
    mesh.rotation.y = Math.sin(t * 0.3) * 0.02;
    // Optionally keep facing the player/camera
    try {
      const target = (playerModel && playerModel.position) ? playerModel.position.clone() : (camera ? camera.position.clone() : new THREE.Vector3(0, 0, 0));
      mesh.lookAt(target.clone().add(new THREE.Vector3(0, 1.2, 0)));
    } catch (e) {}
  }

  function dispose() {
    disposed = true;
    clearInterval(intervalId);
    if (mesh && mesh.parent) mesh.parent.remove(mesh);
    geo.dispose();
    poleGeo.dispose();
    mat.map && mat.map.dispose();
    mat.dispose();
    pole.material && pole.material.dispose();
  }

  return { setActive, update, dispose };
}

/**
 * features/leafPiles.js
 *
 * Lightweight, lazy-loadable leaf-pile interaction:
 * - Spawns several leaf piles in the world (no UI buttons).
 * - Player collects a pile by walking over it; a small burst of particles
 *   plays and a toast + sfx are triggered.
 *
 * Export: createLeafPiles(THREE, { scene, playerModel, audioManager, toasts })
 *
 * No top-level side-effects on import.
 */

export function createLeafPiles(THREE, { scene, playerModel, audioManager, toasts } = {}) {
  if (!THREE) throw new Error('THREE is required');
  if (!scene) throw new Error('scene is required');
  if (!playerModel) throw new Error('playerModel is required');

  const root = new THREE.Group();
  root.name = 'leaf-piles';
  scene.add(root);

  const piles = [];
  const particles = [];
  let active = true;

  const pileGeom = new THREE.CylinderGeometry(0.6, 0.8, 0.12, 12);
  const pileMat = new THREE.MeshStandardMaterial({ color: 0x7b5a2a, roughness: 0.9, metalness: 0.0 });

  const particleGeom = new THREE.SphereGeometry(0.04, 6, 6);

  // Spawn some piles around the world near origin for immediate visibility.
  function spawnInitialPiles(count = 10, radius = 12) {
    for (let i = 0; i < count; i++) {
      const theta = Math.random() * Math.PI * 2;
      const r = 2 + Math.random() * radius;
      const x = Math.cos(theta) * r;
      const z = Math.sin(theta) * r;
      const y = 0; // ground height (world is flat)
      spawnPile(new THREE.Vector3(x, y, z));
    }
  }

  function spawnPile(pos) {
    const mesh = new THREE.Mesh(pileGeom, pileMat.clone());
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.position.copy(pos);
    mesh.userData.collected = false;
    mesh.name = 'leaf-pile';
    root.add(mesh);
    piles.push({ mesh, spawnTime: performance.now() });
  }

  function playRustleSFX() {
    try {
      audioManager?.playSFX?.('ui/leaf-rustle.ogg', 0.55);
    } catch (e) {
      // ignore missing assets
    }
  }

  function collectPile(pile) {
    if (pile.mesh.userData.collected) return;
    pile.mesh.userData.collected = true;

    // spawn simple particles
    const count = 12 + Math.floor(Math.random() * 8);
    for (let i = 0; i < count; i++) {
      const mat = new THREE.MeshStandardMaterial({
        color: 0x9b6f2b,
        roughness: 0.9,
        metalness: 0,
        transparent: true,
        opacity: 1,
        depthWrite: false
      });
      const p = new THREE.Mesh(particleGeom, mat);
      p.position.copy(pile.mesh.position);
      // random offset so they don't all start exact center
      p.position.x += (Math.random() - 0.5) * 0.3;
      p.position.z += (Math.random() - 0.5) * 0.3;
      p.position.y += 0.1 + Math.random() * 0.2;
      p.userData = {
        vel: new THREE.Vector3((Math.random() - 0.5) * 2.2, 1 + Math.random() * 1.6, (Math.random() - 0.5) * 2.2),
        life: 0.9 + Math.random() * 0.7,
        age: 0
      };
      scene.add(p);
      particles.push(p);
    }

    // remove the pile mesh (keep in piles list for bookkeeping)
    root.remove(pile.mesh);

    // audio + toast feedback
    playRustleSFX();
    try {
      toasts?.show?.('Collected leaves +1');
    } catch (e) {}

    // optional light visual: small upward pop (no extra objects)
  }

  function updateParticles(delta) {
    if (particles.length === 0) return;
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.userData.age += delta;
      p.position.addScaledVector(p.userData.vel, delta);
      // gravity
      p.userData.vel.y -= 9.81 * delta * 0.6;
      // fade
      const rem = Math.max(0, p.userData.life - p.userData.age);
      p.material.opacity = Math.max(0, rem / p.userData.life);
      if (p.position.y < -20 || rem <= 0) {
        // cleanup
        scene.remove(p);
        p.geometry.dispose();
        if (Array.isArray(p.material)) {
          p.material.forEach(m => m.dispose && m.dispose());
        } else {
          p.material.dispose();
        }
        particles.splice(i, 1);
      }
    }
  }

  function update(delta) {
    if (!active) return;
    // gentle pile bobbing for visibility
    const t = performance.now() * 0.001;
    for (let i = 0; i < piles.length; i++) {
      const p = piles[i];
      if (p.mesh && !p.mesh.userData.collected) {
        p.mesh.position.y = 0 + Math.sin((t + i) * 0.6) * 0.02;
        p.mesh.rotation.y += (Math.sin(t + i) * 0.002);
      }
    }

    // proximity collection: walk-over to collect
    const playerPos = playerModel.position;
    for (let i = 0; i < piles.length; i++) {
      const p = piles[i];
      if (p.mesh && !p.mesh.userData.collected) {
        const dist = p.mesh.position.distanceTo(playerPos);
        if (dist < 1.2) {
          collectPile(p);
        }
      }
    }

    updateParticles(delta);
  }

  function setActive(next) {
    active = !!next;
    root.visible = !!next;
  }

  // Initialize default piles
  spawnInitialPiles(10, 10);

  return {
    update,
    setActive,
    root,
    spawnPile
  };
}

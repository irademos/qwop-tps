import * as THREE from "three";

/**
 * Click-to-confetti effect.
 * No side effects on import. Call createConfettiEffect(...) once after scene/renderer/camera exist.
 */
export function createConfettiEffect({
  scene,
  renderer,
  camera,
  piecesPerClick = 70,
  maxParticles = 400,
  gravity = 9.81,
  size = 0.06,
  lifetimeRange = [0.9, 1.6],
  speedRange = [2.2, 6.0],
  colors = [
    0xff3b30, 0xff9500, 0xffcc00,
    0x34c759, 0x5ac8fa, 0x007aff,
    0xaf52de, 0xff2d55
  ]
} = {}) {
  if (!scene || !renderer || !camera) {
    console.warn("[confetti] Missing scene/renderer/camera");
    return { update() {}, destroy() {} };
  }

  const dom = renderer.domElement;
  const particles = [];
  const raycaster = new THREE.Raycaster();
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  const sharedGeo = new THREE.BoxGeometry(size, size, size);

  function makeMaterial(color) {
    return new THREE.MeshStandardMaterial({
      color,
      roughness: 0.6,
      metalness: 0.0,
      transparent: true,
      opacity: 1.0,
      depthWrite: false
    });
  }

  function worldPointFromClient(clientX, clientY) {
    const rect = dom.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera({ x, y }, camera);
    const out = new THREE.Vector3();
    if (raycaster.ray.intersectPlane(groundPlane, out)) {
      return out;
    }
    // Fallback: 3m in front of camera
    return camera.position.clone().add(new THREE.Vector3(0, 0, -3).applyQuaternion(camera.quaternion));
  }

  function rand(min, max) {
    return min + Math.random() * (max - min);
  }

  function spawnConfettiAt(pos) {
    const count = piecesPerClick | 0;
    for (let i = 0; i < count; i++) {
      const color = colors[Math.floor(Math.random() * colors.length)];
      const mat = makeMaterial(color);
      const mesh = new THREE.Mesh(sharedGeo, mat);
      mesh.position.copy(pos).add(new THREE.Vector3(rand(-0.05, 0.05), rand(0.1, 0.3), rand(-0.05, 0.05)));
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      scene.add(mesh);

      const dir = new THREE.Vector3(
        rand(-1, 1),
        Math.abs(rand(0.4, 1.0)),
        rand(-1, 1)
      ).normalize();
      const speed = rand(speedRange[0], speedRange[1]);
      const vel = dir.multiplyScalar(speed);

      const angVel = new THREE.Vector3(rand(-6, 6), rand(-6, 6), rand(-6, 6));
      const life = rand(lifetimeRange[0], lifetimeRange[1]);

      particles.push({
        mesh,
        vel,
        angVel,
        life,
        maxLife: life
      });

      // Trim oldest if exceeding max
      if (particles.length > maxParticles) {
        const p = particles.shift();
        scene.remove(p.mesh);
        if (p.mesh.material) p.mesh.material.dispose();
        // shared geometry is disposed on destroy()
      }
    }
  }

  function onMouseDown(e) {
    // Ignore if UI elements (inputs) are focused
    const ae = document.activeElement;
    const tag = (ae?.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea" || ae?.isContentEditable) return;

    const pos = worldPointFromClient(e.clientX, e.clientY);
    spawnConfettiAt(pos);
  }

  function onTouchStart(e) {
    if (!e.touches || e.touches.length === 0) return;
    const t = e.touches[0];
    const pos = worldPointFromClient(t.clientX, t.clientY);
    spawnConfettiAt(pos);
  }

  dom.addEventListener("mousedown", onMouseDown);
  dom.addEventListener("touchstart", onTouchStart, { passive: true });

  function update(dt) {
    if (!particles.length) return;
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= dt;
      // Physics
      p.vel.y -= gravity * dt * 0.8; // lighter than full gravity for effect
      p.mesh.position.x += p.vel.x * dt;
      p.mesh.position.y += p.vel.y * dt;
      p.mesh.position.z += p.vel.z * dt;

      p.mesh.rotation.x += p.angVel.x * dt;
      p.mesh.rotation.y += p.angVel.y * dt;
      p.mesh.rotation.z += p.angVel.z * dt;

      // Fade out
      const a = Math.max(0, p.life / p.maxLife);
      p.mesh.material.opacity = a;

      // Ground bounce (simple)
      if (p.mesh.position.y < size * 0.5) {
        p.mesh.position.y = size * 0.5;
        p.vel.y *= -0.35;
        p.vel.x *= 0.92;
        p.vel.z *= 0.92;
      }

      if (p.life <= 0) {
        scene.remove(p.mesh);
        if (p.mesh.material) p.mesh.material.dispose();
        particles.splice(i, 1);
      }
    }
  }

  function destroy() {
    dom.removeEventListener("mousedown", onMouseDown);
    dom.removeEventListener("touchstart", onTouchStart);
    for (const p of particles) {
      scene.remove(p.mesh);
      if (p.mesh.material) p.mesh.material.dispose();
    }
    particles.length = 0;
    sharedGeo.dispose();
  }

  return { update, destroy };
}

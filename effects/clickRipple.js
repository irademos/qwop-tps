import * as THREE from "three";

/**
 * Ground click ripple visual effect.
 * Creates expanding ring(s) where user clicks/taps the ground plane (y=0).
 * No side effects on import; call createClickRipple(...) once after scene is ready.
 */
export function createClickRipple({
  scene,
  renderer,
  camera,
  color = 0x66ccff,
  lifetime = 0.6,
  startOpacity = 0.85,
  startInnerRadius = 0.18,
  startOuterRadius = 0.22,
  maxRipples = 12
} = {}) {
  if (!scene || !renderer || !camera) {
    throw new Error("createClickRipple: scene, renderer, and camera are required");
  }

  const dom = renderer.domElement;
  const raycaster = new THREE.Raycaster();
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0); // y = 0

  const ripples = [];

  function worldPointFromClient(clientX, clientY) {
    const rect = dom.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera({ x, y }, camera);
    const out = new THREE.Vector3();
    if (raycaster.ray.intersectPlane(groundPlane, out)) {
      return out;
    }
    return null;
  }

  function spawnRippleAt(pos) {
    if (!pos) return;

    const geom = new THREE.RingGeometry(startInnerRadius, startOuterRadius, 48);
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: startOpacity,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.rotation.x = -Math.PI / 2; // lay flat
    mesh.position.copy(pos);
    scene.add(mesh);

    ripples.push({ mesh, geom, mat, t: 0 });

    // Bound memory/objects
    if (ripples.length > maxRipples) {
      const old = ripples.shift();
      if (old) {
        scene.remove(old.mesh);
        old.geom.dispose();
        old.mat.dispose();
      }
    }
  }

  function onMouseDown(e) {
    if (typeof e.button === "number" && e.button !== 0) return; // left only
    const p = worldPointFromClient(e.clientX, e.clientY);
    spawnRippleAt(p);
  }

  function onTouchStart(e) {
    const t = e.touches && e.touches[0];
    if (!t) return;
    const p = worldPointFromClient(t.clientX, t.clientY);
    spawnRippleAt(p);
  }

  dom.addEventListener("mousedown", onMouseDown, { passive: true });
  dom.addEventListener("touchstart", onTouchStart, { passive: true });

  function update(dt) {
    if (!dt) return;
    for (let i = ripples.length - 1; i >= 0; i--) {
      const r = ripples[i];
      r.t += dt;
      const k = Math.min(1, r.t / lifetime);
      const scale = 1 + k * 4.5;
      r.mesh.scale.set(scale, scale, scale);
      r.mat.opacity = (1 - k) * startOpacity;

      if (r.t >= lifetime) {
        scene.remove(r.mesh);
        r.geom.dispose();
        r.mat.dispose();
        ripples.splice(i, 1);
      }
    }
  }

  function destroy() {
    dom.removeEventListener("mousedown", onMouseDown);
    dom.removeEventListener("touchstart", onTouchStart);
    for (const r of ripples) {
      scene.remove(r.mesh);
      r.geom.dispose();
      r.mat.dispose();
    }
    ripples.length = 0;
  }

  return { update, destroy };
}

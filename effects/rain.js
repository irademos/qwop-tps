import * as THREE from "three";

/**
 * GPU-friendly rain made of LineSegments.
 * Exported as a factory (no side effects on import).
 */
export function createRainEffect({
  scene,
  renderer,
  camera,
  maxDrops = 1500,
  area = 80,
  height = 25,
  dropLength = 0.9,
  speedRange = [18, 28],
  color = 0x66aaff,
  opacity = 0.6
} = {}) {
  const group = new THREE.Group();
  group.name = "RainEffect";

  const drops = maxDrops | 0;
  const positions = new Float32Array(drops * 2 * 3); // two verts per drop
  const headY = new Float32Array(drops);
  const xz = new Float32Array(drops * 2);
  const speeds = new Float32Array(drops);

  const half = area / 2;

  function randX() { return (Math.random() * area) - half; }
  function randZ() { return (Math.random() * area) - half; }
  function randSpeed() {
    const [min, max] = speedRange;
    return min + Math.random() * (max - min);
  }

  function resetDrop(i, placeAtTop = false) {
    const xi = randX();
    const zi = randZ();
    const yi = placeAtTop ? (height + Math.random() * 5) : (Math.random() * height);
    const sp = randSpeed();

    xz[i * 2] = xi;
    xz[i * 2 + 1] = zi;
    headY[i] = yi;
    speeds[i] = sp;

    // write both vertices
    const base = i * 6;
    positions[base + 0] = xi;
    positions[base + 1] = yi;
    positions[base + 2] = zi;

    positions[base + 3] = xi;
    positions[base + 4] = yi - dropLength;
    positions[base + 5] = zi;
  }

  for (let i = 0; i < drops; i++) resetDrop(i);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.computeBoundingSphere();

  const material = new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false
  });

  const lines = new THREE.LineSegments(geometry, material);
  lines.frustumCulled = false;
  group.add(lines);

  let active = false;

  function setActive(next) {
    const on = !!next;
    if (on === active) return;
    active = on;
    if (active) {
      if (!group.parent) scene.add(group);
    } else {
      if (group.parent) scene.remove(group);
    }
  }

  function update(delta = 0.016) {
    // Follow camera horizontally to keep rain around the player
    if (camera) {
      group.position.x = camera.position.x;
      group.position.z = camera.position.z;
    }

    if (!active) return;

    const groundY = 0;
    const pos = geometry.getAttribute("position");

    for (let i = 0; i < drops; i++) {
      let y = headY[i] - speeds[i] * delta;

      if (y < groundY) {
        resetDrop(i, true);
        continue;
      }

      headY[i] = y;

      const base = i * 6;
      // head
      pos.array[base + 1] = y;
      // tail
      pos.array[base + 4] = y - dropLength;
    }

    pos.needsUpdate = true;
  }

  function destroy() {
    if (group.parent) group.parent.remove(group);
    geometry.dispose();
    material.dispose();
  }

  return {
    setActive,
    isActive() { return active; },
    update,
    destroy
  };
}

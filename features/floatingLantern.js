/**
 * Small lazy-loadable floating lantern effect that follows the player.
 * Exported factory returns a controller { setActive(bool), update(dt), dispose() }.
 * No side-effects at import-time.
 */
export function createFloatingLantern(THREE, { scene, playerModel, audioManager } = {}) {
  if (!THREE) throw new Error('THREE is required');
  if (!scene) throw new Error('scene is required');
  if (!playerModel) throw new Error('playerModel is required');

  const group = new THREE.Group();
  group.name = 'floating-lantern';

  const geom = new THREE.SphereGeometry(0.07, 12, 8);
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffcc66,
    emissive: 0xff9966,
    emissiveIntensity: 0.8,
    roughness: 0.6,
    metalness: 0.0
  });
  const bulb = new THREE.Mesh(geom, mat);
  bulb.castShadow = false;
  bulb.receiveShadow = false;
  group.add(bulb);

  const light = new THREE.PointLight(0xffddaa, 0.8, 6, 2);
  light.castShadow = false;
  group.add(light);

  let active = false;
  let t = 0;

  function setActive(next) {
    if (next === active) return;
    active = !!next;
    if (active) {
      scene.add(group);
    } else {
      if (group.parent) group.parent.remove(group);
    }
  }

  function update(dt) {
    if (!active) return;
    t += dt;
    const base = playerModel.position || new THREE.Vector3();
    // orbit / bob offsets
    const offset = new THREE.Vector3(
      Math.sin(t * 0.8) * 0.3,
      0.9 + Math.sin(t * 1.6) * 0.06,
      Math.cos(t * 0.8) * 0.25
    );
    group.position.copy(base).add(offset);
    // subtle pulse
    const pulse = 0.9 + Math.sin(t * 6) * 0.08;
    mat.emissiveIntensity = 0.6 * pulse;
    light.intensity = 0.7 * pulse;
  }

  function dispose() {
    if (group.parent) group.parent.remove(group);
    geom.dispose?.();
    mat.dispose?.();
  }

  return { setActive, update, dispose };
}

/**
 * Create a small in-world arrow that shows the player's facing direction.
 * No top-level side-effects; consumer must add `group` to the scene and call update() each frame.
 *
 * @param {typeof import('three')} THREE
 * @param {object} [opts]
 * @param {number} [opts.color=0xffcc00]
 * @param {number} [opts.height=0.25]
 * @param {number} [opts.radius=0.08]
 * @param {number} [opts.distance=0.6]
 * @param {number} [opts.y=0.06]
 * @param {number} [opts.opacity=0.9]
 */
export function createHeadingArrow(
  THREE,
  {
    color = 0xffcc00,
    height = 0.25,
    radius = 0.08,
    distance = 0.6,
    y = 0.06,
    opacity = 0.9
  } = {}
) {
  const group = new THREE.Group();
  group.frustumCulled = false;

  // Arrow (cone) pointing toward -Z (player forward when yaw = 0)
  const coneGeo = new THREE.ConeGeometry(radius, height, 16);
  const coneMat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false
  });
  const cone = new THREE.Mesh(coneGeo, coneMat);
  cone.rotation.x = -Math.PI / 2; // point along -Z
  cone.position.y = y;
  group.add(cone);

  const up = new THREE.Vector3(0, 1, 0);
  const forward = new THREE.Vector3(0, 0, -1);

  function update(playerModel) {
    if (!playerModel) return;
    const yaw = playerModel.rotation?.y || 0;

    // Compute offset directly in world space so the arrow sits in front of the player
    const offset = forward.clone().applyAxisAngle(up, yaw).multiplyScalar(distance);

    group.position.set(
      playerModel.position.x + offset.x,
      y,
      playerModel.position.z + offset.z
    );
    group.rotation.set(0, yaw, 0);
  }

  function setVisible(v) {
    group.visible = !!v;
  }

  function dispose() {
    coneGeo.dispose();
    coneMat.dispose();
  }

  return { group, update, setVisible, dispose };
}
